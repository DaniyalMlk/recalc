import { describe, expect, it } from "vitest";

import { StructureError } from "../src/engine/structure.js";
import { Workbook } from "../src/engine/workbook.js";

function model(): Workbook {
  const book = new Workbook();
  book.setCells({
    A1: "Revenue",
    B1: 1000,
    A2: "Cost",
    B2: 400,
    A3: "Profit",
    B3: "=B1-B2",
    A5: "Margin",
    B5: "=B3/B1",
  });
  return book;
}

describe("insertRows", () => {
  it("moves the cells below the insertion point down", () => {
    const book = model();
    book.insertRows(1, 1); // above row 2
    expect(book.getValue("B1")).toBe(1000);
    expect(book.getValue("B3")).toBe(400);
    expect(book.has("B2")).toBe(false);
  });

  it("rewrites the formulas that moved", () => {
    const book = model();
    book.insertRows(1, 1);
    expect(book.getInput("B4")).toBe("=B1-B3");
    expect(book.getValue("B4")).toBe(600);
  });

  it("keeps the values correct after the shift", () => {
    const book = model();
    book.insertRows(0, 2);
    expect(book.getValue("B5")).toBe(600);
    expect(book.getValue("B7")).toBeCloseTo(0.6, 12);
  });

  it("leaves untouched formulas spelled exactly as they were typed", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, A3: "=A1 + A2", C9: "=SUM(A1:A2)" });
    book.insertRows(20, 1);
    expect(book.getInput("A3")).toBe("=A1 + A2");
    expect(book.getInput("C9")).toBe("=SUM(A1:A2)");
  });

  it("reprints only the formulas whose references moved", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, A4: "=A1 + A2", A5: "=1 + 2" });
    book.insertRows(0, 1);
    expect(book.getInput("A5")).toBe("=A2+A3");
    expect(book.getInput("A6")).toBe("=1 + 2");
  });

  it("stretches a range the insertion lands inside", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, A3: 3, C1: "=SUM(A1:A3)" });
    book.insertRows(1, 1);
    expect(book.getInput("C1")).toBe("=SUM(A1:A4)");
    // The blank row is inside the range now, so filling it counts.
    book.setCell("A2", 10);
    expect(book.getValue("C1")).toBe(16);
  });

  it("recalculates dependents of a cell that moved", () => {
    const book = new Workbook();
    book.setCells({ A1: 5, B1: "=A1*2" });
    book.insertRows(0, 1);
    expect(book.getValue("B2")).toBe(10);
    book.setCell("A2", 7);
    expect(book.getValue("B2")).toBe(14);
  });

  it("keeps the graph consistent with the new addresses", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: "=A1+1" });
    book.insertRows(0, 1);
    expect(book.precedentsOf("A3")).toEqual(["A2"]);
    expect(book.dependentsOf("A2")).toEqual(["A3"]);
  });

  it("drops a cell pushed past the last row", () => {
    const book = new Workbook();
    book.setCells({ A1048576: 1, A1: 2 });
    expect(book.cellCount).toBe(2);
    book.insertRows(0, 1);
    expect(book.cellCount).toBe(1);
    expect(book.getValue("A2")).toBe(2);
  });
});

describe("deleteRows", () => {
  it("removes the cells in the deleted band", () => {
    const book = model();
    book.deleteRows(1, 1); // row 2, the cost line
    expect(book.getValue("A2")).toBe("Profit");
    expect(book.cellCount).toBe(6);
  });

  it("turns a reference to a deleted cell into #REF!", () => {
    const book = model();
    book.deleteRows(1, 1);
    expect(book.getInput("B2")).toBe("=B1-#REF!");
    expect(book.getValue("B2")).toMatchObject({ code: "#REF!" });
  });

  it("propagates the error to whatever read the broken formula", () => {
    const book = model();
    book.deleteRows(1, 1);
    expect(book.getValue("B4")).toMatchObject({ code: "#REF!" });
  });

  it("pulls references back over the deleted band", () => {
    const book = new Workbook();
    book.setCells({ A5: 3, C6: "=A5*2" });
    book.deleteRows(0, 2);
    expect(book.getInput("C4")).toBe("=A3*2");
    expect(book.getValue("C4")).toBe(6);
  });

  it("shrinks a range the deletion lands inside", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, A3: 3, A4: 4, C1: "=SUM(A1:A4)" });
    expect(book.getValue("C1")).toBe(10);
    book.deleteRows(1, 2);
    expect(book.getInput("C1")).toBe("=SUM(A1:A2)");
    expect(book.getValue("C1")).toBe(5);
  });

  it("breaks a range only when all of it is deleted", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, C5: "=SUM(A1:A2)" });
    book.deleteRows(0, 2);
    expect(book.getInput("C3")).toBe("=SUM(#REF!)");
    expect(book.getValue("C3")).toMatchObject({ code: "#REF!" });
  });

  it("deletes several rows at once", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, A3: 3, A4: 4, A5: 5 });
    book.deleteRows(1, 3);
    expect(book.toInputMap()).toEqual({ A1: "1", A2: "5" });
  });
});

describe("column edits", () => {
  it("moves cells right on an insert", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, B1: 2, C1: "=A1+B1" });
    book.insertColumns(1, 1);
    expect(book.getInput("D1")).toBe("=A1+C1");
    expect(book.getValue("D1")).toBe(3);
  });

  it("breaks references to a deleted column", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, B1: 2, C1: "=A1+B1" });
    book.deleteColumns(0, 1);
    expect(book.getInput("B1")).toBe("=#REF!+A1");
  });

  it("shrinks a horizontal range", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, B1: 2, C1: 3, D1: "=SUM(A1:C1)" });
    book.deleteColumns(1, 1);
    expect(book.getInput("C1")).toBe("=SUM(A1:B1)");
    expect(book.getValue("C1")).toBe(4);
  });

  it("leaves the other axis alone", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: "=A1+1" });
    book.insertColumns(5, 3);
    expect(book.getInput("A2")).toBe("=A1+1");
    expect(book.getValue("A2")).toBe(2);
  });
});

describe("names through a structural edit", () => {
  it("follows a named range down an insert", () => {
    const book = new Workbook();
    book.setCells({ B2: 10, B3: 20, D1: "=SUM(Revenue)" });
    book.defineName("Revenue", "B2:B3");
    expect(book.getValue("D1")).toBe(30);

    book.insertRows(0, 1);
    expect(book.lookupName("Revenue")).toMatchObject({ kind: "range" });
    expect(book.names()[0]?.target).toBe("B3:B4");
    expect(book.getValue("D2")).toBe(30);
  });

  it("keeps invalidation working through the moved name", () => {
    const book = new Workbook();
    book.setCells({ B2: 10, B3: 20, D1: "=SUM(Revenue)" });
    book.defineName("Revenue", "B2:B3");
    book.insertRows(0, 1);
    book.setCell("B4", 25);
    expect(book.getValue("D2")).toBe(35);
  });

  it("stretches a named range when a row is inserted inside it", () => {
    const book = new Workbook();
    book.setCells({ B2: 10, B3: 20, B4: 30, D1: "=SUM(Revenue)" });
    book.defineName("Revenue", "B2:B4");
    book.insertRows(2, 1);
    expect(book.names()[0]?.target).toBe("B2:B5");
    // B3 is the blank row the insert opened up, and the name now covers it.
    book.setCell("B3", 5);
    expect(book.getValue("D1")).toBe(65);
  });

  it("makes a name whose whole target is deleted read #REF!", () => {
    const book = new Workbook();
    book.setCells({ B2: 10, B3: 20, D1: "=SUM(Revenue)" });
    book.defineName("Revenue", "B2:B3");
    book.deleteRows(1, 2);
    expect(book.names()[0]?.target).toBe("#REF!");
    expect(book.getValue("D1")).toMatchObject({ code: "#REF!" });
  });

  it("leaves a named constant alone", () => {
    const book = new Workbook();
    book.setName("Rate", 0.09);
    book.setCell("A1", "=Rate*100");
    book.insertRows(0, 3);
    expect(book.getValue("A4")).toBeCloseTo(9, 12);
  });
});

describe("structural edit validation", () => {
  it("rejects a negative index", () => {
    expect(() => new Workbook().insertRows(-1)).toThrow(StructureError);
  });

  it("rejects a count of zero", () => {
    expect(() => new Workbook().deleteColumns(0, 0)).toThrow(StructureError);
  });

  it("leaves the sheet untouched when the edit is rejected", () => {
    const book = model();
    expect(() => book.deleteRows(-2, 1)).toThrow(StructureError);
    expect(book.getValue("B3")).toBe(600);
  });
});

describe("cycles and structural edits", () => {
  it("does not invent a circular reference by moving cells", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: "=A1", A3: "=A2" });
    book.insertRows(1, 1);
    expect(book.cycles()).toEqual([]);
    expect(book.getValue("A4")).toBe(1);
  });

  it("keeps reporting a circular reference after a shift", () => {
    const book = new Workbook();
    book.setCells({ A2: "=A3", A3: "=A2" });
    expect(book.cycles()).toHaveLength(1);
    book.insertRows(0, 1);
    expect(book.cycles()).toEqual([["A3", "A4"]]);
  });
});
