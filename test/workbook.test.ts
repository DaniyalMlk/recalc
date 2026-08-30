import { describe, expect, it } from "vitest";
import { ParseError } from "../src/engine/errors.js";
import { formatRange } from "../src/engine/reference.js";
import { Workbook, interpretInput } from "../src/engine/workbook.js";

describe("interpretInput", () => {
  it("treats a leading equals as a formula", () => {
    expect(interpretInput("=1+1").ast).not.toBeNull();
  });

  it("reads numeric text as a number", () => {
    expect(interpretInput("007").literal).toBe(7);
    expect(interpretInput("-2.5").literal).toBe(-2.5);
    expect(interpretInput("25%").literal).toBe(0.25);
  });

  it("reads TRUE and FALSE as booleans", () => {
    expect(interpretInput("true").literal).toBe(true);
    expect(interpretInput("FALSE").literal).toBe(false);
  });

  it("leaves anything else as text", () => {
    expect(interpretInput("hello").literal).toBe("hello");
    expect(interpretInput("1a").literal).toBe("1a");
  });

  it("reads empty input as blank", () => {
    expect(interpretInput("").literal).toBeNull();
  });
});

describe("basic storage", () => {
  it("stores and reads values", () => {
    const book = new Workbook();
    book.setCell("A1", 42);
    expect(book.getValue("A1")).toBe(42);
    expect(book.getInput("A1")).toBe("42");
    expect(book.getDisplay("A1")).toBe("42");
    expect(book.cellCount).toBe(1);
  });

  it("reports a blank cell as null", () => {
    const book = new Workbook();
    expect(book.getValue("A1")).toBeNull();
    expect(book.getDisplay("A1")).toBe("");
    expect(book.has("A1")).toBe(false);
  });

  it("accepts coordinates as well as A1 text", () => {
    const book = new Workbook();
    book.setCell({ col: 1, row: 2 }, 5);
    expect(book.getValue("B3")).toBe(5);
  });

  it("returns the canonical formula, or null for a literal", () => {
    const book = new Workbook();
    book.setCell("A1", "=1+ 2*3");
    book.setCell("A2", 7);
    expect(book.getFormula("A1")).toBe("=1+2*3");
    expect(book.getFormula("A2")).toBeNull();
  });

  it("reports the occupied extent", () => {
    const book = new Workbook();
    book.setCells({ B2: 1, D5: 2 });
    expect(formatRange(book.extent()!)).toBe("A1:D5");
  });

  it("round-trips through an input map", () => {
    const book = new Workbook();
    book.setCells({ A1: 2, A2: 3, A3: "=A1*A2" });
    expect(book.toInputMap()).toEqual({ A1: "2", A2: "3", A3: "=A1*A2" });
  });
});

describe("recalculation", () => {
  it("computes a formula when it is entered", () => {
    const book = new Workbook();
    book.setCells({ A1: 2, A2: 3 });
    book.setCell("A3", "=A1*A2");
    expect(book.getValue("A3")).toBe(6);
  });

  it("updates dependents when a precedent changes", () => {
    const book = new Workbook();
    book.setCells({ A1: 2, B1: "=A1*10", C1: "=B1+1" });
    expect(book.getValue("C1")).toBe(21);
    book.setCell("A1", 5);
    expect(book.getValue("B1")).toBe(50);
    expect(book.getValue("C1")).toBe(51);
  });

  it("updates through a range precedent", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, A3: 3, B1: "=SUM(A1:A3)" });
    expect(book.getValue("B1")).toBe(6);
    book.setCell("A2", 20);
    expect(book.getValue("B1")).toBe(24);
  });

  it("notices a cell written into the middle of a range for the first time", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A3: 3, B1: "=SUM(A1:A3)" });
    expect(book.getValue("B1")).toBe(4);
    book.setCell("A2", 10);
    expect(book.getValue("B1")).toBe(14);
  });

  it("recomputes after a cell is cleared", () => {
    const book = new Workbook();
    book.setCells({ A1: 5, B1: "=A1+1" });
    expect(book.getValue("B1")).toBe(6);
    book.clearCell("A1");
    expect(book.getValue("B1")).toBe(1);
    expect(book.has("A1")).toBe(false);
  });

  it("treats setting a cell to empty as clearing it", () => {
    const book = new Workbook();
    book.setCells({ A1: 5, B1: "=A1+1" });
    book.setCell("A1", "");
    expect(book.has("A1")).toBe(false);
    expect(book.getValue("B1")).toBe(1);
  });

  it("stops depending on a cell once the formula changes", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, C1: 100, B1: "=A1" });
    book.setCell("B1", "=C1");
    book.setCell("A1", 999);
    expect(book.getValue("B1")).toBe(100);
  });

  it("propagates down a long chain", () => {
    const book = new Workbook();
    book.setCell("A1", 1);
    for (let row = 2; row <= 200; row++) {
      book.setCell(`A${row}`, `=A${row - 1}+1`);
    }
    expect(book.getValue("A200")).toBe(200);
    book.setCell("A1", 1000);
    expect(book.getValue("A200")).toBe(1199);
  });

  it("recalculates a batch once", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: "=A1*2", A3: "=A2*2", A4: "=A3*2" });
    expect(book.getValue("A4")).toBe(8);
  });

  it("recalculates everything on demand", () => {
    const book = new Workbook();
    book.setCells({ A1: 3, B1: "=A1^2" });
    book.recalculateAll();
    expect(book.getValue("B1")).toBe(9);
  });
});

describe("named values", () => {
  it("resolves a name and updates when it changes", () => {
    const book = new Workbook();
    book.setName("RATE", 0.1);
    book.setCell("A1", "=100*RATE");
    expect(book.getValue("A1")).toBeCloseTo(10, 10);
    book.setName("RATE", 0.2);
    expect(book.getValue("A1")).toBeCloseTo(20, 10);
  });
});

describe("circular references", () => {
  it("marks a self-reference", () => {
    const book = new Workbook();
    book.setCell("A1", "=A1+1");
    expect(book.getDisplay("A1")).toBe("#CYCLE!");
    expect(book.cycles()).toEqual([["A1"]]);
  });

  it("marks both cells of a two-cell loop", () => {
    const book = new Workbook();
    book.setCell("A1", "=B1");
    book.setCell("B1", "=A1");
    expect(book.getDisplay("A1")).toBe("#CYCLE!");
    expect(book.getDisplay("B1")).toBe("#CYCLE!");
    expect(book.cycles()).toEqual([["A1", "B1"]]);
  });

  it("names the participants in the error detail", () => {
    const book = new Workbook();
    book.setCells({ A1: "=B1", B1: "=A1" });
    const value = book.getValue("A1");
    expect(typeof value === "object" && value !== null && "detail" in value
      ? value.detail
      : "").toContain("A1 -> B1");
  });

  it("propagates the cycle error to a reader without marking it circular", () => {
    const book = new Workbook();
    book.setCells({ A1: "=B1", B1: "=A1", C1: "=A1*2" });
    expect(book.getDisplay("C1")).toBe("#CYCLE!");
    expect(book.cycles().flat()).not.toContain("C1");
  });

  it("clears the cycle when the offending formula is replaced", () => {
    const book = new Workbook();
    book.setCells({ A1: "=B1", B1: "=A1" });
    book.setCell("B1", 5);
    expect(book.getValue("A1")).toBe(5);
    expect(book.cycles()).toEqual([]);
  });

  it("catches a cycle made through a range", () => {
    const book = new Workbook();
    book.setCell("A3", "=SUM(A1:A3)");
    expect(book.getDisplay("A3")).toBe("#CYCLE!");
  });
});

describe("inspection", () => {
  it("lists precedents including ranges", () => {
    const book = new Workbook();
    book.setCell("D1", "=A1+SUM(B1:C9)");
    expect(book.precedentsOf("D1").sort()).toEqual(["A1", "B1:C9"]);
  });

  it("lists dependents", () => {
    const book = new Workbook();
    book.setCells({ B1: "=A1", C1: "=A1*2" });
    expect(book.dependentsOf("A1").sort()).toEqual(["B1", "C1"]);
  });

  it("lists a range subscriber as a dependent of every covered cell", () => {
    const book = new Workbook();
    book.setCell("B1", "=SUM(A1:A9)");
    expect(book.dependentsOf("A5")).toEqual(["B1"]);
    expect(book.dependentsOf("A10")).toEqual([]);
  });
});

describe("malformed input", () => {
  it("throws on a bad formula", () => {
    const book = new Workbook();
    expect(() => book.setCell("A1", "=1+")).toThrow(ParseError);
  });

  it("leaves the sheet untouched when an edit is rejected", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, B1: "=A1+1" });
    expect(() => book.setCell("A1", "=)(")).toThrow(ParseError);
    expect(book.getValue("A1")).toBe(1);
    expect(book.getValue("B1")).toBe(2);
  });
});

describe("a worked sheet", () => {
  it("computes a small margin model end to end", () => {
    const book = new Workbook();
    book.setCells({
      A1: "Units",
      B1: 1200,
      A2: "Price",
      B2: 24.5,
      A3: "Unit cost",
      B3: 15.25,
      A4: "Fixed costs",
      B4: 6000,
      A6: "Revenue",
      B6: "=B1*B2",
      A7: "COGS",
      B7: "=B1*B3",
      A8: "Gross profit",
      B8: "=B6-B7",
      A9: "Operating profit",
      B9: "=B8-B4",
      A10: "Gross margin",
      B10: "=ROUND(B8/B6,4)",
      A11: "Break-even units",
      B11: "=ROUNDUP(B4/(B2-B3),0)",
      A12: "Verdict",
      B12: '=IF(B9>0,"profitable","loss-making")',
    });

    expect(book.getValue("B6")).toBeCloseTo(29400, 10);
    expect(book.getValue("B7")).toBeCloseTo(18300, 10);
    expect(book.getValue("B8")).toBeCloseTo(11100, 10);
    expect(book.getValue("B9")).toBeCloseTo(5100, 10);
    expect(book.getValue("B10")).toBeCloseTo(0.3776, 10);
    expect(book.getValue("B11")).toBe(649);
    expect(book.getValue("B12")).toBe("profitable");

    // Halving volume should flip the verdict, through six dependent cells.
    book.setCell("B1", 500);
    expect(book.getValue("B9")).toBeCloseTo(500 * (24.5 - 15.25) - 6000, 10);
    expect(book.getValue("B12")).toBe("loss-making");
    // Break-even does not depend on units, so it must not have moved.
    expect(book.getValue("B11")).toBe(649);
  });
});
