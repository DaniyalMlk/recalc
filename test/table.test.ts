import { describe, expect, it } from "vitest";

import {
  MAX_TABLE_CELLS,
  TableError,
  around,
  oneWayTable,
  series,
  twoWayTable,
  writeTwoWayTable,
} from "../src/analysis/table.js";
import { Workbook } from "../src/engine/workbook.js";

function margin(): Workbook {
  const book = new Workbook();
  book.setCells({
    A1: "Price",
    B1: 30,
    A2: "Units",
    B2: 1000,
    A3: "Unit cost",
    B3: 18,
    A4: "Fixed",
    B4: 8000,
    A5: "Revenue",
    B5: "=B1*B2",
    A6: "Profit",
    B6: "=(B1-B3)*B2-B4",
    A7: "Margin",
    B7: "=B6/B5",
  });
  book.clearHistory();
  return book;
}

describe("series", () => {
  it("walks from one end to the other", () => {
    expect(series(0, 10, 5)).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it("lands on the endpoint exactly", () => {
    const values = series(0.05, 0.15, 11);
    expect(values[10]).toBe(0.15);
    expect(values[0]).toBe(0.05);
  });

  it("runs downward", () => {
    expect(series(10, 0, 3)).toEqual([10, 5, 0]);
  });

  it("returns just the start for a single step", () => {
    expect(series(4, 9, 1)).toEqual([4]);
  });

  it("rejects a non-positive count", () => {
    expect(() => series(0, 1, 0)).toThrow(TableError);
    expect(() => series(0, 1, 2.5)).toThrow(TableError);
  });
});

describe("around", () => {
  it("centres an odd count on the base case", () => {
    expect(around(30, 5, 5)).toEqual([20, 25, 30, 35, 40]);
  });

  it("straddles the centre for an even count", () => {
    expect(around(10, 2, 4)).toEqual([7, 9, 11, 13]);
  });

  it("returns the centre alone for one point", () => {
    expect(around(0.1, 0.01, 1)).toEqual([0.1]);
  });

  it("rejects a non-positive count", () => {
    expect(() => around(1, 1, -3)).toThrow(TableError);
  });
});

describe("oneWayTable", () => {
  it("reads every result at every input", () => {
    const book = margin();
    const table = oneWayTable(book, {
      input: "B1",
      values: [25, 30, 35],
      results: ["B5", "B6"],
    });
    expect(table.rows).toEqual([
      [25 * 1000, (25 - 18) * 1000 - 8000],
      [30 * 1000, (30 - 18) * 1000 - 8000],
      [35 * 1000, (35 - 18) * 1000 - 8000],
    ]);
  });

  it("records the addresses it worked over", () => {
    const table = oneWayTable(margin(), {
      input: "b1",
      values: [30],
      results: ["b6"],
    });
    expect(table.input).toBe("B1");
    expect(table.results).toEqual(["B6"]);
  });

  it("carries the base case alongside the table", () => {
    const table = oneWayTable(margin(), {
      input: "B1",
      values: [25, 35],
      results: ["B5", "B6"],
    });
    expect(table.base).toEqual([30 * 1000, (30 - 18) * 1000 - 8000]);
  });

  it("leaves the sheet as it found it", () => {
    const book = margin();
    oneWayTable(book, {
      input: "B1",
      values: [25, 40, 55],
      results: ["B5", "B6", "B7"],
    });
    expect(book.getValue("B1")).toBe(30);
    expect(book.getValue("B6")).toBe((30 - 18) * 1000 - 8000);
    expect(book.canUndo).toBe(false);
  });

  it("substitutes text as readily as numbers", () => {
    const book = new Workbook();
    book.setCells({
      A1: "grow",
      B1: '=IF(A1="grow",1.2,0.9)',
      C1: 500,
      D1: "=C1*B1",
    });
    const table = oneWayTable(book, {
      input: "A1",
      values: ["grow", "hold"],
      results: ["D1"],
    });
    expect(table.rows).toEqual([[600], [450]]);
    expect(book.getValue("A1")).toBe("grow");
  });

  it("substitutes a formula", () => {
    const book = margin();
    const table = oneWayTable(book, {
      input: "B1",
      values: ["=B3*2", "=B3*3"],
      results: ["B6"],
    });
    expect(table.rows).toEqual([
      [(36 - 18) * 1000 - 8000],
      [(54 - 18) * 1000 - 8000],
    ]);
  });

  it("keeps an error as an error rather than a hole", () => {
    const book = new Workbook();
    book.setCells({ A1: 4, B1: "=100/(A1-2)" });
    const table = oneWayTable(book, {
      input: "A1",
      values: [2, 4],
      results: ["B1"],
    });
    expect(table.rows[0]?.[0]).toMatchObject({ code: "#DIV/0!" });
    expect(table.rows[1]?.[0]).toBe(50);
  });

  it("reads a result that does not move", () => {
    const table = oneWayTable(margin(), {
      input: "B1",
      values: [25, 30],
      results: ["B4"],
    });
    expect(table.rows).toEqual([[8000], [8000]]);
  });

  it("accepts an empty list of values", () => {
    const table = oneWayTable(margin(), {
      input: "B1",
      values: [],
      results: ["B6"],
    });
    expect(table.rows).toEqual([]);
    expect(table.base).toEqual([(30 - 18) * 1000 - 8000]);
  });

  it("refuses a table with no result cells", () => {
    expect(() =>
      oneWayTable(margin(), { input: "B1", values: [1], results: [] }),
    ).toThrow(TableError);
  });

  it("refuses a table above the cell limit", () => {
    expect(() =>
      oneWayTable(margin(), {
        input: "B1",
        values: series(1, MAX_TABLE_CELLS + 1, MAX_TABLE_CELLS + 1),
        results: ["B6"],
      }),
    ).toThrow(/above the limit/);
  });
});

describe("twoWayTable", () => {
  it("crosses two inputs", () => {
    const table = twoWayTable(margin(), {
      rowInput: "B1",
      rowValues: [25, 30],
      columnInput: "B2",
      columnValues: [1000, 2000],
      result: "B6",
    });
    expect(table.grid).toEqual([
      [(25 - 18) * 1000 - 8000, (25 - 18) * 2000 - 8000],
      [(30 - 18) * 1000 - 8000, (30 - 18) * 2000 - 8000],
    ]);
  });

  it("is indexed rows-then-columns", () => {
    const table = twoWayTable(margin(), {
      rowInput: "B1",
      rowValues: [25, 30, 35],
      columnInput: "B3",
      columnValues: [15, 18],
      result: "B6",
    });
    expect(table.grid).toHaveLength(3);
    expect(table.grid[0]).toHaveLength(2);
    expect(table.grid[2]?.[1]).toBe((35 - 18) * 1000 - 8000);
  });

  it("carries the base case", () => {
    const table = twoWayTable(margin(), {
      rowInput: "B1",
      rowValues: [25],
      columnInput: "B2",
      columnValues: [500],
      result: "B6",
    });
    expect(table.base).toBe((30 - 18) * 1000 - 8000);
  });

  it("leaves the sheet as it found it", () => {
    const book = margin();
    twoWayTable(book, {
      rowInput: "B1",
      rowValues: series(20, 40, 9),
      columnInput: "B2",
      columnValues: series(500, 2000, 7),
      result: "B7",
    });
    expect(book.getValue("B1")).toBe(30);
    expect(book.getValue("B2")).toBe(1000);
    expect(book.getValue("B7")).toBeCloseTo(4000 / 30000, 12);
    expect(book.canUndo).toBe(false);
  });

  it("refuses to cross a cell with itself", () => {
    expect(() =>
      twoWayTable(margin(), {
        rowInput: "B1",
        rowValues: [1],
        columnInput: "B1",
        columnValues: [2],
        result: "B6",
      }),
    ).toThrow(/cannot be both/);
  });

  it("refuses a grid above the cell limit", () => {
    expect(() =>
      twoWayTable(margin(), {
        rowInput: "B1",
        rowValues: series(1, 200, 200),
        columnInput: "B2",
        columnValues: series(1, 200, 200),
        result: "B6",
      }),
    ).toThrow(/above the limit/);
  });

  it("finds where a result crosses zero", () => {
    // The point of a sensitivity grid: reading the sign change off it.
    const table = twoWayTable(margin(), {
      rowInput: "B1",
      rowValues: [18, 18.5, 19],
      columnInput: "B2",
      columnValues: [10000],
      result: "B6",
    });
    const column = table.grid.map((row) => row[0] as number);
    expect(column[0]).toBeLessThan(0);
    expect(column[2]).toBeGreaterThan(0);
  });
});

describe("writeTwoWayTable", () => {
  function grid(): ReturnType<typeof twoWayTable> {
    return twoWayTable(margin(), {
      rowInput: "B1",
      rowValues: [25, 30],
      columnInput: "B2",
      columnValues: [1000, 2000],
      result: "B6",
    });
  }

  it("writes headers and body at the origin", () => {
    const book = margin();
    const table = grid();
    writeTwoWayTable(book, "D1", table);
    expect(book.getValue("D1")).toBe("B6");
    expect(book.getValue("E1")).toBe("1000");
    expect(book.getValue("F1")).toBe("2000");
    expect(book.getValue("D2")).toBe("25");
    expect(book.getValue("E2")).toBe((25 - 18) * 1000 - 8000);
    expect(book.getValue("F3")).toBe((30 - 18) * 2000 - 8000);
  });

  it("reports how many cells it wrote", () => {
    const book = margin();
    expect(writeTwoWayTable(book, "D1", grid()).cells).toBe(9);
  });

  it("writes literals, not formulas", () => {
    const book = margin();
    writeTwoWayTable(book, "D1", grid());
    expect(book.getFormula("E2")).toBeNull();
  });

  it("does not move when the model later changes", () => {
    const book = margin();
    writeTwoWayTable(book, "D1", grid());
    const before = book.getValue("E2");
    book.setCell("B3", 5);
    expect(book.getValue("E2")).toBe(before);
  });

  it("is one undoable step", () => {
    const book = margin();
    writeTwoWayTable(book, "D1", grid());
    book.undo();
    expect(book.has("E2")).toBe(false);
  });

  it("writes an error cell as its code", () => {
    const book = new Workbook();
    book.setCells({ A1: 4, A2: 1, B1: "=A2*100/(A1-2)" });
    const table = twoWayTable(book, {
      rowInput: "A1",
      rowValues: [2, 4],
      columnInput: "A2",
      columnValues: [1],
      result: "B1",
    });
    writeTwoWayTable(book, "D1", table);
    expect(book.getValue("E2")).toBe("#DIV/0!");
    expect(book.getValue("E3")).toBe(50);
  });

  it("writes a boolean result as a boolean", () => {
    const book = new Workbook();
    book.setCells({ A1: 5, A2: 1, B1: "=A1*A2>10" });
    const table = twoWayTable(book, {
      rowInput: "A1",
      rowValues: [1, 20],
      columnInput: "A2",
      columnValues: [1],
      result: "B1",
    });
    writeTwoWayTable(book, "D1", table);
    expect(book.getValue("E2")).toBe(false);
    expect(book.getValue("E3")).toBe(true);
  });
});
