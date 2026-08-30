import { describe, expect, it } from "vitest";
import { DependencyGraph } from "../src/engine/graph.js";
import type { CellId } from "../src/engine/graph.js";
import { parseFormula } from "../src/engine/parser.js";
import { extractPrecedents } from "../src/engine/precedents.js";
import { cellKey, columnToLabel, parseA1 } from "../src/engine/reference.js";
import type { Coord } from "../src/engine/reference.js";

const at = (a1: string) => parseA1(a1);
const id = (a1: string) => cellKey(at(a1));

function label(coord: Coord): string {
  return `${columnToLabel(coord.col)}${coord.row + 1}`;
}

function labelOf(cellId: CellId): string {
  const [col, row] = cellId.split(":").map(Number) as [number, number];
  return label({ col, row });
}

/** Build a graph from `{ "B1": "=A1*2" }`-shaped sheets. */
function build(sheet: Record<string, string>): DependencyGraph {
  const graph = new DependencyGraph();
  for (const [cell, formula] of Object.entries(sheet)) {
    graph.setPrecedents(at(cell), extractPrecedents(parseFormula(formula)));
  }
  return graph;
}

const sorted = (ids: Iterable<CellId>) => [...ids].map(labelOf).sort();

describe("edges", () => {
  it("records precedents and dependents in both directions", () => {
    const graph = build({ B1: "=A1*2" });
    expect(graph.precedentsOf(at("B1"))).toEqual([id("A1")]);
    expect(graph.dependentsOf(at("A1"))).toEqual([id("B1")]);
    expect(graph.dependentsOf(at("B1"))).toEqual([]);
  });

  it("counts formula cells and distinct ranges", () => {
    const graph = build({ B1: "=SUM(A1:A9)", B2: "=SUM(A1:A9)", B3: "=A1" });
    expect(graph.formulaCount).toBe(3);
    expect(graph.rangeCount).toBe(1);
  });

  it("drops stale edges when a formula is replaced", () => {
    const graph = build({ B1: "=A1" });
    expect(graph.dependentsOf(at("A1"))).toEqual([id("B1")]);
    graph.setPrecedents(at("B1"), extractPrecedents(parseFormula("=C1")));
    expect(graph.dependentsOf(at("A1"))).toEqual([]);
    expect(graph.dependentsOf(at("C1"))).toEqual([id("B1")]);
  });

  it("drops every edge when precedents are cleared", () => {
    const graph = build({ B1: "=A1+SUM(C1:C9)" });
    graph.clearPrecedents(at("B1"));
    expect(graph.dependentsOf(at("A1"))).toEqual([]);
    expect(graph.dependentsOf(at("C5"))).toEqual([]);
    expect(graph.formulaCount).toBe(0);
    expect(graph.rangeCount).toBe(0);
  });

  it("keeps a shared range alive until its last subscriber leaves", () => {
    const graph = build({ B1: "=SUM(A1:A9)", B2: "=SUM(A1:A9)" });
    graph.clearPrecedents(at("B1"));
    expect(graph.rangeCount).toBe(1);
    expect(graph.dependentsOf(at("A5"))).toEqual([id("B2")]);
    graph.clearPrecedents(at("B2"));
    expect(graph.rangeCount).toBe(0);
  });
});

describe("range precedents", () => {
  it("makes every cell inside the range a precedent", () => {
    const graph = build({ B1: "=SUM(A1:A9)" });
    for (const cell of ["A1", "A5", "A9"]) {
      expect(graph.dependentsOf(at(cell)), cell).toEqual([id("B1")]);
    }
  });

  it("ignores cells outside the range", () => {
    const graph = build({ B1: "=SUM(A1:A9)" });
    expect(graph.dependentsOf(at("A10"))).toEqual([]);
    expect(graph.dependentsOf(at("B5"))).toEqual([]);
  });

  it("handles two-dimensional ranges", () => {
    const graph = build({ E1: "=SUM(B2:D4)" });
    expect(graph.dependentsOf(at("C3"))).toEqual([id("E1")]);
    expect(graph.dependentsOf(at("E3"))).toEqual([]);
  });

  it("reports the ranges a cell reads", () => {
    const graph = build({ B1: "=SUM(A1:A9)+SUM(C1:C9)" });
    expect(graph.rangePrecedentsOf(at("B1"))).toHaveLength(2);
  });

  it("unions cell and range dependents without duplicates", () => {
    const graph = build({ B1: "=A1+SUM(A1:A9)" });
    expect(graph.dependentsOf(at("A1"))).toEqual([id("B1")]);
  });
});

describe("transitiveDependents", () => {
  it("includes the seed itself", () => {
    const graph = build({});
    expect(sorted(graph.transitiveDependents([at("A1")]))).toEqual(["A1"]);
  });

  it("walks a chain to the end", () => {
    const graph = build({ B1: "=A1", C1: "=B1", D1: "=C1" });
    expect(sorted(graph.transitiveDependents([at("A1")]))).toEqual([
      "A1",
      "B1",
      "C1",
      "D1",
    ]);
  });

  it("stops at cells that do not depend on the seed", () => {
    const graph = build({ B1: "=A1", Z1: "=Y1" });
    expect(sorted(graph.transitiveDependents([at("A1")]))).toEqual(["A1", "B1"]);
  });

  it("visits a diamond once", () => {
    const graph = build({ B1: "=A1", C1: "=A1", D1: "=B1+C1" });
    expect(sorted(graph.transitiveDependents([at("A1")]))).toEqual([
      "A1",
      "B1",
      "C1",
      "D1",
    ]);
  });

  it("accepts several seeds", () => {
    const graph = build({ C1: "=A1", D1: "=B1" });
    expect(sorted(graph.transitiveDependents([at("A1"), at("B1")]))).toEqual([
      "A1",
      "B1",
      "C1",
      "D1",
    ]);
  });
});

describe("planRecalculation ordering", () => {
  const positions = (order: readonly CellId[]) => {
    const map = new Map<string, number>();
    order.forEach((cellId, i) => map.set(labelOf(cellId), i));
    return map;
  };

  it("puts a precedent before its dependent", () => {
    const graph = build({ B1: "=A1", C1: "=B1" });
    const pos = positions(graph.planRecalculation([at("A1")]).order);
    expect(pos.get("A1")!).toBeLessThan(pos.get("B1")!);
    expect(pos.get("B1")!).toBeLessThan(pos.get("C1")!);
  });

  it("orders a diamond so the join comes last", () => {
    const graph = build({ B1: "=A1", C1: "=A1", D1: "=B1+C1" });
    const pos = positions(graph.planRecalculation([at("A1")]).order);
    expect(pos.get("A1")!).toBeLessThan(pos.get("B1")!);
    expect(pos.get("A1")!).toBeLessThan(pos.get("C1")!);
    expect(pos.get("D1")!).toBe(3);
  });

  it("respects a range precedent's ordering", () => {
    const graph = build({ B1: "=A1*2", C1: "=SUM(B1:B9)" });
    const pos = positions(graph.planRecalculation([at("A1")]).order);
    expect(pos.get("A1")!).toBeLessThan(pos.get("B1")!);
    expect(pos.get("B1")!).toBeLessThan(pos.get("C1")!);
  });

  it("touches only what the edit invalidated", () => {
    const graph = build({ B1: "=A1", C1: "=B1", Y1: "=X1", Z1: "=Y1" });
    const plan = graph.planRecalculation([at("A1")]);
    expect(sorted(plan.order)).toEqual(["A1", "B1", "C1"]);
  });

  it("plans nothing beyond the seed for an isolated cell", () => {
    const graph = build({ B1: "=A1" });
    expect(sorted(graph.planRecalculation([at("Q42")]).order)).toEqual(["Q42"]);
  });

  it("handles a deep chain without exhausting the call stack", () => {
    const graph = new DependencyGraph();
    const depth = 5000;
    for (let row = 1; row < depth; row++) {
      graph.setPrecedents(
        { col: 0, row },
        extractPrecedents(parseFormula(`=A${row}`)),
      );
    }
    const plan = graph.planRecalculation([at("A1")]);
    expect(plan.order).toHaveLength(depth);
    expect(plan.cycles).toHaveLength(0);
    const pos = positions(plan.order);
    expect(pos.get("A1")).toBe(0);
    expect(pos.get(`A${depth}`)).toBe(depth - 1);
  });
});

describe("cycle detection", () => {
  it("finds a self-reference", () => {
    const graph = build({ A1: "=A1+1" });
    const plan = graph.planRecalculation([at("A1")]);
    expect(plan.cycles.map((c) => c.map(labelOf))).toEqual([["A1"]]);
    expect(plan.cycleMembers.has(id("A1"))).toBe(true);
  });

  it("finds a self-reference made through a range", () => {
    const graph = build({ A1: "=SUM(A1:A5)" });
    const plan = graph.planRecalculation([at("A1")]);
    expect(plan.cycles.map((c) => c.map(labelOf))).toEqual([["A1"]]);
  });

  it("finds a two-cell loop", () => {
    const graph = build({ A1: "=B1", B1: "=A1" });
    const plan = graph.planRecalculation([at("A1")]);
    expect(plan.cycles).toHaveLength(1);
    expect(plan.cycles[0]!.map(labelOf)).toEqual(["A1", "B1"]);
  });

  it("finds a longer loop and names every participant", () => {
    const graph = build({ A1: "=C1", B1: "=A1", C1: "=B1" });
    const plan = graph.planRecalculation([at("A1")]);
    expect(plan.cycles).toHaveLength(1);
    expect(plan.cycles[0]!.map(labelOf)).toEqual(["A1", "B1", "C1"]);
  });

  it("finds two independent loops separately", () => {
    const graph = build({
      A1: "=B1",
      B1: "=A1",
      D1: "=E1",
      E1: "=D1",
      F1: "=A1+D1",
    });
    const plan = graph.planRecalculation([at("A1"), at("D1")]);
    expect(plan.cycles).toHaveLength(2);
    expect(plan.cycles.map((c) => c.map(labelOf)).sort()).toEqual([
      ["A1", "B1"],
      ["D1", "E1"],
    ]);
  });

  it("separates a cell in a cycle from a cell that only reads one", () => {
    const graph = build({ A1: "=B1", B1: "=A1", C1: "=A1*2" });
    const plan = graph.planRecalculation([at("A1")]);
    expect(plan.cycleMembers.has(id("A1"))).toBe(true);
    expect(plan.cycleMembers.has(id("B1"))).toBe(true);
    expect(plan.cycleMembers.has(id("C1"))).toBe(false);
    expect(sorted(plan.order)).toEqual(["A1", "B1", "C1"]);
  });

  it("still orders a reader after the cycle it reads", () => {
    const graph = build({ A1: "=B1", B1: "=A1", C1: "=A1*2" });
    const order = graph.planRecalculation([at("A1")]).order.map(labelOf);
    expect(order.indexOf("C1")).toBeGreaterThan(order.indexOf("A1"));
  });

  it("reports no cycles for an acyclic sheet", () => {
    const graph = build({ B1: "=A1", C1: "=A1+B1", D1: "=SUM(A1:C1)" });
    const plan = graph.planRecalculation([at("A1")]);
    expect(plan.cycles).toHaveLength(0);
    expect(plan.cycleMembers.size).toBe(0);
  });

  it("clears the cycle once the offending formula is replaced", () => {
    const graph = build({ A1: "=B1", B1: "=A1" });
    expect(graph.planRecalculation([at("A1")]).cycles).toHaveLength(1);
    graph.setPrecedents(at("B1"), extractPrecedents(parseFormula("=42")));
    expect(graph.planRecalculation([at("A1")]).cycles).toHaveLength(0);
  });
});
