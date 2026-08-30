import { describe, expect, it } from "vitest";
import { parseFormula } from "../src/engine/parser.js";
import {
  describePrecedents,
  extractPrecedents,
  rangeKey,
} from "../src/engine/precedents.js";
import { formatRange, parseA1 } from "../src/engine/reference.js";

const of = (src: string) => extractPrecedents(parseFormula(src));

describe("extractPrecedents", () => {
  it("finds nothing in a constant expression", () => {
    const p = of("=1+2*3");
    expect(p.cells).toHaveLength(0);
    expect(p.ranges).toHaveLength(0);
    expect(p.names).toHaveLength(0);
  });

  it("collects direct cell references", () => {
    expect(describePrecedents(of("=A1+B2"))).toEqual(["A1", "B2"]);
  });

  it("descends into calls, groups and unary operators", () => {
    expect(describePrecedents(of("=-(SUM(A1,B2)/C3)"))).toEqual([
      "A1",
      "B2",
      "C3",
    ]);
  });

  it("keeps ranges unexpanded", () => {
    const p = of("=SUM(A1:A1000)");
    expect(p.cells).toHaveLength(0);
    expect(p.ranges).toHaveLength(1);
    expect(formatRange(p.ranges[0]!)).toBe("A1:A1000");
  });

  it("collects cells and ranges together", () => {
    expect(describePrecedents(of("=SUM(A1:A9)/B1"))).toEqual(["B1", "A1:A9"]);
  });

  it("deduplicates repeated references", () => {
    expect(describePrecedents(of("=A1+A1*A1"))).toEqual(["A1"]);
  });

  it("deduplicates anchor spellings of the same cell", () => {
    const p = of("=A1+$A1+A$1+$A$1");
    expect(p.cells).toHaveLength(1);
  });

  it("deduplicates ranges written with reversed corners", () => {
    const p = of("=SUM(A1:C3)+SUM(C3:A1)");
    expect(p.ranges).toHaveLength(1);
  });

  it("collects bare names", () => {
    expect(of("=Revenue*2").names).toEqual(["REVENUE"]);
  });

  it("does not treat a function name as a name precedent", () => {
    expect(of("=SUM(A1:A2)").names).toEqual([]);
  });
});

describe("rangeKey", () => {
  const range = (a: string, b: string) => ({ start: parseA1(a), end: parseA1(b) });

  it("is stable across corner order and anchors", () => {
    const keys = [
      rangeKey(range("A1", "C3")),
      rangeKey(range("C3", "A1")),
      rangeKey(range("$A$1", "$C$3")),
      rangeKey(range("A$1", "$C3")),
    ];
    expect(new Set(keys).size).toBe(1);
  });

  it("separates different ranges", () => {
    expect(rangeKey(range("A1", "C3"))).not.toBe(rangeKey(range("A1", "C4")));
  });
});
