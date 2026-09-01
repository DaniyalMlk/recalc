import { describe, expect, it } from "vitest";

import { parseFormula } from "../src/engine/parser.js";
import { printFormula } from "../src/engine/printer.js";
import {
  StructureError,
  adjustAst,
  adjustCoord,
  adjustRange,
  adjustRef,
  adjustSpan,
  validateEdit,
} from "../src/engine/structure.js";
import type { StructuralEdit } from "../src/engine/structure.js";
import { MAX_COLUMNS, MAX_ROWS, parseA1 } from "../src/engine/reference.js";

const insertRows = (at: number, count = 1): StructuralEdit => ({
  axis: "row",
  operation: "insert",
  at,
  count,
});
const deleteRows = (at: number, count = 1): StructuralEdit => ({
  axis: "row",
  operation: "delete",
  at,
  count,
});
const insertCols = (at: number, count = 1): StructuralEdit => ({
  axis: "column",
  operation: "insert",
  at,
  count,
});
const deleteCols = (at: number, count = 1): StructuralEdit => ({
  axis: "column",
  operation: "delete",
  at,
  count,
});

describe("validateEdit", () => {
  it("accepts an edit inside the sheet", () => {
    expect(() => validateEdit(insertRows(0, 1))).not.toThrow();
    expect(() => validateEdit(deleteCols(MAX_COLUMNS - 1, 1))).not.toThrow();
  });

  it("rejects a negative or fractional index", () => {
    expect(() => validateEdit(insertRows(-1))).toThrow(StructureError);
    expect(() => validateEdit(insertRows(1.5))).toThrow(StructureError);
  });

  it("rejects an index past the end of the axis", () => {
    expect(() => validateEdit(insertRows(MAX_ROWS))).toThrow(StructureError);
    expect(() => validateEdit(insertCols(MAX_COLUMNS))).toThrow(StructureError);
  });

  it("rejects a count below one", () => {
    expect(() => validateEdit(insertRows(0, 0))).toThrow(StructureError);
    expect(() => validateEdit(deleteRows(0, -3))).toThrow(StructureError);
  });

  it("rejects a delete that runs off the end of the axis", () => {
    expect(() => validateEdit(deleteRows(MAX_ROWS - 2, 5))).toThrow(
      StructureError,
    );
  });
});

describe("adjustSpan", () => {
  // start, end, edit, expected span or null
  const cases: [string, number, number, StructuralEdit, [number, number] | null][] =
    [
      ["insert above the span moves it", 4, 8, insertRows(0, 2), [6, 10]],
      ["insert at the span start moves it", 4, 8, insertRows(4, 2), [6, 10]],
      ["insert inside the span stretches it", 4, 8, insertRows(5, 2), [4, 10]],
      ["insert at the span end stretches it", 4, 8, insertRows(8, 3), [4, 11]],
      ["insert just past the span leaves it", 4, 8, insertRows(9, 3), [4, 8]],
      ["insert far below leaves it", 4, 8, insertRows(100), [4, 8]],
      ["delete above the span moves it", 4, 8, deleteRows(0, 2), [2, 6]],
      ["delete below the span leaves it", 4, 8, deleteRows(9, 4), [4, 8]],
      ["delete inside the span shrinks it", 4, 8, deleteRows(5, 2), [4, 6]],
      ["delete over the span start", 4, 8, deleteRows(3, 3), [3, 5]],
      ["delete over the span end", 4, 8, deleteRows(7, 4), [4, 6]],
      ["delete the whole span", 4, 8, deleteRows(4, 5), null],
      ["delete more than the whole span", 4, 8, deleteRows(2, 20), null],
      ["delete a one-line span", 4, 4, deleteRows(4, 1), null],
      ["delete every line but one", 4, 8, deleteRows(4, 4), [4, 4]],
    ];

  for (const [name, start, end, edit, expected] of cases) {
    it(name, () => {
      expect(adjustSpan(start, end, edit)).toEqual(expected);
    });
  }

  it("refuses a span pushed off the end of the sheet", () => {
    expect(adjustSpan(MAX_ROWS - 2, MAX_ROWS - 1, insertRows(0, 5))).toBeNull();
  });

  it("clamps a span whose end is pushed off the sheet", () => {
    expect(adjustSpan(0, MAX_ROWS - 1, insertRows(1, 3))).toEqual([
      0,
      MAX_ROWS - 1,
    ]);
  });
});

describe("adjustRef", () => {
  it("shifts a reference below an inserted row", () => {
    expect(adjustRef(parseA1("B7"), insertRows(2, 3))).toMatchObject({
      col: 1,
      row: 9,
    });
  });

  it("leaves a reference above an inserted row alone", () => {
    expect(adjustRef(parseA1("B2"), insertRows(5))).toMatchObject({
      col: 1,
      row: 1,
    });
  });

  it("moves an absolute reference too", () => {
    const moved = adjustRef(parseA1("$B$7"), insertRows(0, 1));
    expect(moved).toMatchObject({ row: 7, colAbsolute: true, rowAbsolute: true });
  });

  it("returns null for a deleted target", () => {
    expect(adjustRef(parseA1("B7"), deleteRows(6, 1))).toBeNull();
  });

  it("pulls a reference back over a deleted block", () => {
    expect(adjustRef(parseA1("B7"), deleteRows(0, 3))).toMatchObject({ row: 3 });
  });

  it("adjusts columns on the column axis", () => {
    expect(adjustRef(parseA1("D2"), insertCols(1, 2))).toMatchObject({
      col: 5,
      row: 1,
    });
    expect(adjustRef(parseA1("D2"), deleteCols(3, 1))).toBeNull();
  });

  it("returns null when an insert pushes it off the sheet", () => {
    const last = { col: 0, row: MAX_ROWS - 1, colAbsolute: false, rowAbsolute: false };
    expect(adjustRef(last, insertRows(0, 1))).toBeNull();
  });
});

describe("adjustRange", () => {
  const range = (text: string) => {
    const [a, b] = text.split(":") as [string, string];
    return { start: parseA1(a), end: parseA1(b) };
  };

  it("stretches a range an insert lands inside", () => {
    expect(adjustRange(range("B2:B13"), insertRows(5, 1))).toMatchObject({
      start: { row: 1 },
      end: { row: 13 },
    });
  });

  it("shrinks a range a delete lands inside", () => {
    expect(adjustRange(range("B2:B13"), deleteRows(5, 3))).toMatchObject({
      start: { row: 1 },
      end: { row: 9 },
    });
  });

  it("keeps anchors while moving the coordinates", () => {
    const adjusted = adjustRange(range("$B$2:$B$13"), insertRows(0, 1));
    expect(adjusted?.start).toMatchObject({ row: 2, rowAbsolute: true });
    expect(adjusted?.end).toMatchObject({ row: 13, rowAbsolute: true });
  });

  it("returns null when the whole range is deleted", () => {
    expect(adjustRange(range("B2:B13"), deleteRows(1, 12))).toBeNull();
  });

  it("adjusts a range on the column axis", () => {
    expect(adjustRange(range("B2:E2"), deleteCols(2, 1))).toMatchObject({
      start: { col: 1 },
      end: { col: 3 },
    });
  });
});

describe("adjustCoord", () => {
  it("moves a stored cell down past an insert", () => {
    expect(adjustCoord({ col: 1, row: 6 }, insertRows(0, 2))).toEqual({
      col: 1,
      row: 8,
    });
  });

  it("removes a stored cell inside a delete", () => {
    expect(adjustCoord({ col: 1, row: 6 }, deleteRows(5, 3))).toBeNull();
  });

  it("leaves other axes untouched", () => {
    expect(adjustCoord({ col: 4, row: 2 }, insertRows(0, 1))).toEqual({
      col: 4,
      row: 3,
    });
  });
});

describe("adjustAst", () => {
  const rewrite = (formula: string, edit: StructuralEdit) =>
    printFormula(adjustAst(parseFormula(formula), edit), true);

  it("rewrites every reference in the tree", () => {
    expect(rewrite("=A1+SUM(B2:B9)*C3", insertRows(0, 1))).toBe(
      "=A2+SUM(B3:B10)*C4",
    );
  });

  it("turns a deleted cell into #REF!", () => {
    expect(rewrite("=A1*2", deleteRows(0, 1))).toBe("=#REF!*2");
  });

  it("turns a fully deleted range into #REF!", () => {
    expect(rewrite("=SUM(B2:B4)", deleteRows(1, 3))).toBe("=SUM(#REF!)");
  });

  it("keeps a partly deleted range as a smaller range", () => {
    expect(rewrite("=SUM(B2:B9)", deleteRows(3, 2))).toBe("=SUM(B2:B7)");
  });

  it("leaves names and literals alone", () => {
    expect(rewrite('=IF(Rate>0,"yes",Revenue)', insertRows(0, 4))).toBe(
      '=IF(RATE>0,"yes",REVENUE)',
    );
  });

  it("returns the same tree when nothing moved", () => {
    const ast = parseFormula("=A1+B2");
    expect(adjustAst(ast, insertRows(50))).toBe(ast);
  });

  it("returns a new tree when something moved", () => {
    const ast = parseFormula("=A1+B2");
    expect(adjustAst(ast, insertRows(0))).not.toBe(ast);
  });

  it("rewrites through unary, percent and grouping nodes", () => {
    expect(rewrite("=-(A1%)", insertRows(0, 2))).toBe("=-(A3%)");
  });

  it("rewrites both sides of a comparison", () => {
    expect(rewrite("=A1<=B1", insertCols(0, 1))).toBe("=B1<=C1");
  });
});
