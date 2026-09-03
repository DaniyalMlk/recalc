import { describe, expect, it } from "vitest";

import { parseAxis } from "../src/analysis/axis.js";
import {
  goalSeekCommand,
  parseTableCommand,
  tableCommand,
} from "../src/analysis/commands.js";
import { TableError } from "../src/analysis/table.js";
import { Workbook } from "../src/engine/workbook.js";

function model(): Workbook {
  const book = new Workbook();
  book.setCells({
    B1: 30,
    B2: 1000,
    B3: 18,
    B4: 8000,
    B5: "=B1*B2",
    B6: "=(B1-B3)*B2-B4",
  });
  book.clearHistory();
  return book;
}

describe("parseAxis", () => {
  it("reads a from..to/count range", () => {
    expect(parseAxis("20..40/5")).toEqual([20, 25, 30, 35, 40]);
  });

  it("reads a centre~step/count range", () => {
    expect(parseAxis("30~5/5")).toEqual([20, 25, 30, 35, 40]);
  });

  it("reads a comma list", () => {
    expect(parseAxis("25, 30, 35")).toEqual([25, 30, 35]);
  });

  it("keeps a non-numeric entry as text", () => {
    expect(parseAxis("grow, hold, shrink")).toEqual(["grow", "hold", "shrink"]);
  });

  it("mixes numbers and text in one list", () => {
    expect(parseAxis("1, up, 3")).toEqual([1, "up", 3]);
  });

  it("keeps a formula as text", () => {
    expect(parseAxis("=B3*2, =B3*3")).toEqual(["=B3*2", "=B3*3"]);
  });

  it("reads negative endpoints", () => {
    expect(parseAxis("-10..10/3")).toEqual([-10, 0, 10]);
  });

  it("reads decimal rates", () => {
    expect(parseAxis("0.05..0.15/3")).toEqual([0.05, 0.1, 0.15]);
  });

  it("reads a single value", () => {
    expect(parseAxis("42")).toEqual([42]);
  });

  it("rejects an empty axis", () => {
    expect(() => parseAxis("   ")).toThrow(TableError);
  });

  it("rejects an empty entry in a list", () => {
    expect(() => parseAxis("1,,3")).toThrow(/empty value/);
  });

  it("rejects a non-positive step count", () => {
    expect(() => parseAxis("1..5/0")).toThrow(TableError);
  });
});

describe("parseTableCommand", () => {
  it("reads one result against one axis", () => {
    expect(parseTableCommand("B6 by B1 = 20..40/5")).toEqual({
      results: ["B6"],
      rowInput: "B1",
      rowAxis: "20..40/5",
    });
  });

  it("reads several results", () => {
    const parsed = parseTableCommand("B5, B6 by B1 = 20..40/5");
    expect(typeof parsed === "object" && parsed.results).toEqual(["B5", "B6"]);
  });

  it("reads a crossed axis", () => {
    expect(parseTableCommand("B6 by B1 = 25,30 x B2 = 500..2000/4")).toEqual({
      results: ["B6"],
      rowInput: "B1",
      rowAxis: "25,30",
      columnInput: "B2",
      columnAxis: "500..2000/4",
    });
  });

  it("reads a destination", () => {
    const parsed = parseTableCommand("B6 by B1 = 20..40/5 into D10");
    expect(typeof parsed === "object" && parsed.into).toBe("D10");
  });

  it("reads a destination on a crossed table", () => {
    const parsed = parseTableCommand("B6 by B1 = 1,2 x B2 = 3,4 into H2");
    expect(typeof parsed === "object" && parsed.into).toBe("H2");
    expect(typeof parsed === "object" && parsed.columnInput).toBe("B2");
  });

  it("normalises addresses to upper case", () => {
    const parsed = parseTableCommand("b6 by b1 = 1,2");
    expect(typeof parsed === "object" && parsed.results).toEqual(["B6"]);
    expect(typeof parsed === "object" && parsed.rowInput).toBe("B1");
  });

  it("leaves a comma inside an axis alone", () => {
    const parsed = parseTableCommand("B6 by B1 = 25,30,35");
    expect(typeof parsed === "object" && parsed.rowAxis).toBe("25,30,35");
  });

  it("rejects a line with no `by`", () => {
    expect(parseTableCommand("B6 = 20..40/5")).toContain("usage:");
  });

  it("rejects an axis with no values", () => {
    expect(parseTableCommand("B6 by B1 =")).toContain("values");
  });

  it("names the argument that is not a cell", () => {
    expect(parseTableCommand("total by B1 = 1,2")).toContain("total");
  });

  it("names a bad destination", () => {
    expect(parseTableCommand("B6 by B1 = 1,2 into nowhere")).toContain(
      "nowhere",
    );
  });
});

describe("goalSeekCommand", () => {
  it("reports the answer without changing the sheet", () => {
    const book = model();
    const out = goalSeekCommand(book, " B6 = 0 by B1");
    expect(out).toContain("B1 = 26");
    expect(out).toContain("not applied");
    expect(book.getValue("B1")).toBe(30);
  });

  it("says how far the target moved and at what cost", () => {
    const out = goalSeekCommand(model(), " B6 = 0 by B1");
    expect(out).toContain("B6 reaches 0");
    expect(out).toContain("from 30");
    expect(out).toMatch(/\d+ recalculation\(s\)/);
  });

  it("writes the answer when asked to apply", () => {
    const book = model();
    const out = goalSeekCommand(book, " B6 = 0 by B1 apply");
    expect(out).toContain("B1 set to 26");
    expect(book.getValue("B1")).toBe(26);
    expect(book.getValue("B6")).toBe(0);
  });

  it("applies as one undoable step", () => {
    const book = model();
    goalSeekCommand(book, " B6 = 0 by B1 apply");
    book.undo();
    expect(book.getValue("B1")).toBe(30);
  });

  it("explains a target that does not depend on the input", () => {
    const book = model();
    const out = goalSeekCommand(book, " B6 = 0 by A9");
    expect(out).toContain("does not depend on");
    expect(out).not.toContain("closest");
  });

  it("explains a changing cell holding a formula", () => {
    expect(goalSeekCommand(model(), " B6 = 0 by B5")).toContain(
      "holds a formula",
    );
  });

  it("shows the closest approach when it cannot converge", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, B1: "=A1*A1+5" });
    const out = goalSeekCommand(book, " B1 = 0 by A1");
    expect(out).toContain("no value of A1");
    expect(out).toContain("closest");
  });

  it("rejects a goal that is not a number", () => {
    expect(goalSeekCommand(model(), " B6 = soon by B1")).toContain(
      "must be a number",
    );
  });

  it("shows usage for a malformed line", () => {
    expect(goalSeekCommand(model(), " nonsense")).toContain("usage:");
    expect(goalSeekCommand(model(), "")).toContain("usage:");
  });
});

describe("tableCommand", () => {
  it("prints a one-way table with a header", () => {
    const out = tableCommand(model(), " B5,B6 by B1 = 25..35/3");
    const lines = out.split("\n").map((line) => line.trim());
    expect(lines[0]).toBe("B1     B5     B6");
    expect(lines[1]).toBe("25  25000  -1000");
    expect(lines[3]).toBe("35  35000   9000");
  });

  it("prints a two-way table", () => {
    const out = tableCommand(model(), " B6 by B1 = 25,35 x B2 = 1000,2000");
    const lines = out.split("\n").map((line) => line.trim());
    expect(lines[0]).toBe("B6   1000   2000");
    expect(lines[1]).toBe("25  -1000   6000");
    expect(lines[2]).toBe("35   9000  26000");
  });

  it("aligns columns to the widest entry", () => {
    const out = tableCommand(model(), " B6 by B1 = 25,35");
    const widths = out
      .split("\n")
      .map((line) => line.replace(/^\s+/, "").split(/\s+/).length);
    expect(new Set(widths).size).toBe(1);
  });

  it("leaves the sheet alone when only printing", () => {
    const book = model();
    tableCommand(book, " B6 by B1 = 20..40/9");
    expect(book.getValue("B1")).toBe(30);
    expect(book.canUndo).toBe(false);
  });

  it("writes a one-way table into the sheet", () => {
    const book = model();
    const out = tableCommand(book, " B6 by B1 = 25,35 into D1");
    expect(out).toContain("6 cell(s) written at D1");
    expect(book.getValue("D1")).toBe("B1");
    expect(book.getValue("E1")).toBe("B6");
    expect(book.getValue("E2")).toBe(-1000);
    expect(book.getValue("E3")).toBe(9000);
  });

  it("writes a two-way table into the sheet", () => {
    const book = model();
    tableCommand(book, " B6 by B1 = 25,35 x B2 = 1000,2000 into D1");
    expect(book.getValue("D1")).toBe("B6");
    expect(book.getValue("E1")).toBe("1000");
    expect(book.getValue("F3")).toBe(26000);
  });

  it("refuses two results on a crossed table", () => {
    expect(
      tableCommand(model(), " B5,B6 by B1 = 1,2 x B2 = 3,4"),
    ).toContain("exactly one result");
  });

  it("refuses a table above the cell limit", () => {
    expect(
      tableCommand(model(), " B6 by B1 = 1..500/500 x B2 = 1..500/500"),
    ).toContain("above the limit");
  });

  it("reports a bad axis rather than throwing", () => {
    expect(tableCommand(model(), " B6 by B1 = 1..5/0")).toContain("whole");
  });

  it("shows a flat table when the input does not matter", () => {
    const out = tableCommand(model(), " B6 by A9 = 1,2");
    const lines = out.split("\n").map((line) => line.trim());
    expect(lines[1]).toBe("1  4000");
    expect(lines[2]).toBe("2  4000");
  });

  it("prints an error code in the body", () => {
    const book = new Workbook();
    book.setCells({ A1: 4, B1: "=100/(A1-2)" });
    const out = tableCommand(book, " B1 by A1 = 2,4");
    expect(out).toContain("#DIV/0!");
  });
});
