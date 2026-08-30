import { describe, expect, it } from "vitest";
import { DependencyGraph } from "../src/engine/graph.js";
import { parseFormula } from "../src/engine/parser.js";
import { extractPrecedents } from "../src/engine/precedents.js";
import { recalculate } from "../src/engine/recalc.js";
import type { RecalcHooks } from "../src/engine/recalc.js";
import { columnToLabel, parseA1 } from "../src/engine/reference.js";
import type { Coord } from "../src/engine/reference.js";

const at = (a1: string) => parseA1(a1);
const label = (c: Coord) => `${columnToLabel(c.col)}${c.row + 1}`;

function build(sheet: Record<string, string>): DependencyGraph {
  const graph = new DependencyGraph();
  for (const [cell, formula] of Object.entries(sheet)) {
    graph.setPrecedents(at(cell), extractPrecedents(parseFormula(formula)));
  }
  return graph;
}

/** A stub evaluator that records the order it was asked to work in. */
function recorder() {
  const evaluated: string[] = [];
  const cycled: string[] = [];
  const written: Array<[string, string]> = [];
  const hooks: RecalcHooks<string> = {
    evaluate(coord) {
      evaluated.push(label(coord));
      return `value(${label(coord)})`;
    },
    cycleValue(coord, cycle) {
      cycled.push(`${label(coord)}<-${cycle.map(label).join(",")}`);
      return "#CYCLE!";
    },
    write(coord, value) {
      written.push([label(coord), value]);
    },
  };
  return { hooks, evaluated, cycled, written };
}

describe("recalculate", () => {
  it("evaluates a chain in dependency order", () => {
    const graph = build({ B1: "=A1", C1: "=B1", D1: "=C1" });
    const rec = recorder();
    const stats = recalculate(graph, [at("A1")], rec.hooks);
    expect(rec.evaluated).toEqual(["A1", "B1", "C1", "D1"]);
    expect(stats.evaluated).toBe(4);
    expect(stats.cycled).toBe(0);
  });

  it("writes every value it evaluates", () => {
    const graph = build({ B1: "=A1" });
    const rec = recorder();
    recalculate(graph, [at("A1")], rec.hooks);
    expect(rec.written).toEqual([
      ["A1", "value(A1)"],
      ["B1", "value(B1)"],
    ]);
  });

  it("evaluates a diamond join exactly once, after both arms", () => {
    const graph = build({ B1: "=A1", C1: "=A1", D1: "=B1+C1" });
    const rec = recorder();
    recalculate(graph, [at("A1")], rec.hooks);
    expect(rec.evaluated.filter((c) => c === "D1")).toHaveLength(1);
    expect(rec.evaluated.indexOf("D1")).toBe(3);
  });

  it("leaves untouched cells alone", () => {
    const graph = build({ B1: "=A1", Z1: "=Y1" });
    const rec = recorder();
    recalculate(graph, [at("A1")], rec.hooks);
    expect(rec.evaluated).toEqual(["A1", "B1"]);
  });

  it("never evaluates a cell inside a cycle", () => {
    const graph = build({ A1: "=B1", B1: "=A1" });
    const rec = recorder();
    const stats = recalculate(graph, [at("A1")], rec.hooks);
    expect(rec.evaluated).toEqual([]);
    expect(stats.cycled).toBe(2);
    expect(rec.written.map(([cell, value]) => `${cell}=${value}`).sort()).toEqual(
      ["A1=#CYCLE!", "B1=#CYCLE!"],
    );
  });

  it("hands the cycle membership to the hook", () => {
    const graph = build({ A1: "=C1", B1: "=A1", C1: "=B1" });
    const rec = recorder();
    recalculate(graph, [at("A1")], rec.hooks);
    expect(rec.cycled).toHaveLength(3);
    for (const entry of rec.cycled) {
      expect(entry).toContain("A1,B1,C1");
    }
  });

  it("evaluates a reader of a cycle after the cycle is resolved", () => {
    const graph = build({ A1: "=B1", B1: "=A1", C1: "=A1*2" });
    const rec = recorder();
    const stats = recalculate(graph, [at("A1")], rec.hooks);
    expect(rec.evaluated).toEqual(["C1"]);
    expect(stats.cycled).toBe(2);
    const order = rec.written.map(([cell]) => cell);
    expect(order.indexOf("C1")).toBeGreaterThan(order.indexOf("A1"));
  });

  it("recalculates only the affected subgraph on a second edit", () => {
    const graph = build({ B1: "=A1", C1: "=B1", E1: "=D1" });
    const first = recorder();
    recalculate(graph, [at("A1")], first.hooks);
    expect(first.evaluated).toEqual(["A1", "B1", "C1"]);

    const second = recorder();
    recalculate(graph, [at("D1")], second.hooks);
    expect(second.evaluated).toEqual(["D1", "E1"]);
  });

  it("accepts several seeds and evaluates each cell once", () => {
    const graph = build({ C1: "=A1+B1" });
    const rec = recorder();
    recalculate(graph, [at("A1"), at("B1")], rec.hooks);
    expect(rec.evaluated.filter((c) => c === "C1")).toHaveLength(1);
    expect(rec.evaluated).toHaveLength(3);
  });

  it("returns the plan it executed", () => {
    const graph = build({ B1: "=A1" });
    const stats = recalculate(graph, [at("A1")], recorder().hooks);
    expect(stats.plan.order).toHaveLength(2);
    expect(stats.plan.cycles).toHaveLength(0);
  });
});
