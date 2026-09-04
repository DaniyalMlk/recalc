import { describe, expect, it } from "vitest";
import { FormatCodeError } from "../src/format/code.js";
import { Workbook } from "../src/engine/workbook.js";

function book(cells: Record<string, string | number | boolean> = {}) {
  const sheet = new Workbook();
  sheet.setCells(cells);
  sheet.clearHistory();
  return sheet;
}

describe("applying a format", () => {
  it("changes the display and leaves the value alone", () => {
    const sheet = book({ A1: 1234.5678 });
    sheet.setFormat("A1", "#,##0.00");
    expect(sheet.getDisplay("A1")).toBe("1,234.57");
    expect(sheet.getValue("A1")).toBe(1234.5678);
    expect(sheet.getInput("A1")).toBe("1234.5678");
  });

  it("applies to a whole block at once", () => {
    const sheet = book({ A1: 0.1, A2: 0.25, A3: 0.5 });
    sheet.setFormat("A1:A3", "0%");
    expect([1, 2, 3].map((row) => sheet.getDisplay(`A${row}`))).toEqual([
      "10%",
      "25%",
      "50%",
    ]);
  });

  it("reports the code on a cell", () => {
    const sheet = book({ A1: 1 });
    expect(sheet.formatOf("A1")).toBeNull();
    sheet.setFormat("A1", "0.00");
    expect(sheet.formatOf("A1")).toBe("0.00");
  });

  it("reports the colour the format asked for", () => {
    const sheet = book({ A1: -5, A2: 5 });
    sheet.setFormat("A1:A2", "#,##0;[Red](#,##0)");
    expect(sheet.getFormatted("A1")).toEqual({ text: "(5)", colour: "red" });
    expect(sheet.getFormatted("A2")).toEqual({ text: "5", colour: null });
  });

  it("refuses a malformed code and leaves the sheet untouched", () => {
    const sheet = book({ A1: 1 });
    expect(() => sheet.setFormat("A1", "0yyyy")).toThrow(FormatCodeError);
    expect(sheet.formatOf("A1")).toBeNull();
    expect(sheet.getDisplay("A1")).toBe("1");
  });

  it("treats General and the empty code as no format", () => {
    const sheet = book({ A1: 0.5 });
    sheet.setFormat("A1", "0%");
    sheet.setFormat("A1", "General");
    expect(sheet.formatOf("A1")).toBeNull();
    expect(sheet.getDisplay("A1")).toBe("0.5");
  });

  it("lands on empty cells and holds there until they are filled", () => {
    const sheet = book();
    sheet.setFormat("B2", "0.00");
    expect(sheet.getDisplay("B2")).toBe("");
    sheet.setCell("B2", 3);
    expect(sheet.getDisplay("B2")).toBe("3.00");
  });

  it("formats what a formula produces", () => {
    const sheet = book({ A1: 0.11, A2: 100000, A3: "=A2*A1" });
    sheet.setFormat("A3", "$#,##0");
    expect(sheet.getDisplay("A3")).toBe("$11,000");
  });

  it("recomputes the display when the value behind it changes", () => {
    const sheet = book({ A1: 2, B1: "=A1*3" });
    sheet.setFormat("B1", "0.00");
    expect(sheet.getDisplay("B1")).toBe("6.00");
    sheet.setCell("A1", 5);
    expect(sheet.getDisplay("B1")).toBe("15.00");
  });
});

describe("clearing", () => {
  it("clearing contents keeps the format", () => {
    const sheet = book({ A1: 5 });
    sheet.setFormat("A1", "0.00");
    sheet.clearCell("A1");
    expect(sheet.formatOf("A1")).toBe("0.00");
    expect(sheet.getDisplay("A1")).toBe("");
    sheet.setCell("A1", 7);
    expect(sheet.getDisplay("A1")).toBe("7.00");
  });

  it("clearing a block's contents keeps its formats", () => {
    const sheet = book({ A1: 1, A2: 2 });
    sheet.setFormat("A1:A2", "0.0");
    sheet.clearBlock("A1:A2");
    expect(sheet.formatOf("A2")).toBe("0.0");
  });

  it("clearing the format keeps the contents", () => {
    const sheet = book({ A1: 5 });
    sheet.setFormat("A1", "0.00");
    sheet.clearFormat("A1");
    expect(sheet.formatOf("A1")).toBeNull();
    expect(sheet.getValue("A1")).toBe(5);
    expect(sheet.getDisplay("A1")).toBe("5");
  });
});

describe("formats follow the cells", () => {
  it("shifts down when a row is inserted above", () => {
    const sheet = book({ A5: 1000 });
    sheet.setFormat("A5", "#,##0");
    sheet.insertRows(0);
    expect(sheet.formatOf("A5")).toBeNull();
    expect(sheet.formatOf("A6")).toBe("#,##0");
    expect(sheet.getDisplay("A6")).toBe("1,000");
  });

  it("shifts across when a column is inserted to the left", () => {
    const sheet = book({ C1: 0.5 });
    sheet.setFormat("C1", "0%");
    sheet.insertColumns(0, 2);
    expect(sheet.getDisplay("E1")).toBe("50%");
  });

  it("moves with a deletion", () => {
    const sheet = book({ A1: 1, A5: 1000 });
    sheet.setFormat("A5", "#,##0");
    sheet.deleteRows(1, 2);
    expect(sheet.formatOf("A3")).toBe("#,##0");
  });

  it("survives on a cell that holds nothing", () => {
    const sheet = book();
    sheet.setFormat("B3", "0.00");
    sheet.insertRows(0);
    expect(sheet.formatOf("B4")).toBe("0.00");
  });

  it("is dropped when its cell is pushed off the sheet", () => {
    const sheet = book();
    sheet.setFormat("A1048576", "0.00");
    sheet.insertRows(0);
    expect(sheet.formatCount).toBe(0);
  });
});

describe("fill and clipboard carry the format", () => {
  it("fills a format down with the contents", () => {
    const sheet = book({ B1: 0.1, B2: 0.2, B3: 0.3 });
    sheet.setFormat("B1", "0.0%");
    sheet.fillDown("B1:B3");
    expect(sheet.getDisplay("B3")).toBe("10.0%");
    expect(sheet.formatOf("B3")).toBe("0.0%");
  });

  it("fills a format across", () => {
    const sheet = book({ A1: 1000 });
    sheet.setFormat("A1", "#,##0");
    sheet.fillRight("A1:C1");
    expect(sheet.formatOf("C1")).toBe("#,##0");
  });

  it("pastes a format with the block", () => {
    const sheet = book({ A1: 1234 });
    sheet.setFormat("A1", "#,##0");
    sheet.paste(sheet.copy("A1"), "D4");
    expect(sheet.getDisplay("D4")).toBe("1,234");
  });

  it("pasting an unformatted cell clears the target's format", () => {
    const sheet = book({ A1: 5, D4: 9 });
    sheet.setFormat("D4", "0.00");
    sheet.paste(sheet.copy("A1"), "D4");
    expect(sheet.formatOf("D4")).toBeNull();
    expect(sheet.getDisplay("D4")).toBe("5");
  });
});

describe("undo reaches formats", () => {
  it("reverses applying a format", () => {
    const sheet = book({ A1: 0.5 });
    sheet.setFormat("A1", "0%");
    expect(sheet.undoLabel).toBe("format A1");
    expect(sheet.undo()).toBe(true);
    expect(sheet.formatOf("A1")).toBeNull();
    expect(sheet.getDisplay("A1")).toBe("0.5");
  });

  it("reapplies it on redo", () => {
    const sheet = book({ A1: 0.5 });
    sheet.setFormat("A1", "0%");
    sheet.undo();
    expect(sheet.redo()).toBe(true);
    expect(sheet.getDisplay("A1")).toBe("50%");
  });

  it("reverses a format change over a block in one step", () => {
    const sheet = book({ A1: 1, A2: 2, A3: 3 });
    sheet.setFormat("A1:A3", "0.00");
    sheet.undo();
    expect(sheet.formatCount).toBe(0);
  });

  it("restores the format a paste overwrote", () => {
    const sheet = book({ A1: 5, D4: 9 });
    sheet.setFormat("D4", "0.00");
    sheet.paste(sheet.copy("A1"), "D4");
    sheet.undo();
    expect(sheet.formatOf("D4")).toBe("0.00");
    expect(sheet.getDisplay("D4")).toBe("9.00");
  });

  it("puts a format back where a structural edit had moved it", () => {
    const sheet = book({ A5: 1000 });
    sheet.setFormat("A5", "#,##0");
    sheet.insertRows(0);
    sheet.undo();
    expect(sheet.formatOf("A5")).toBe("#,##0");
    expect(sheet.formatOf("A6")).toBeNull();
  });

  it("does not record an entry when the format did not change", () => {
    const sheet = book({ A1: 1 });
    sheet.setFormat("A1", "0.00");
    sheet.setFormat("A1", "0.00");
    sheet.undo();
    expect(sheet.formatOf("A1")).toBeNull();
    expect(sheet.canUndo).toBe(false);
  });

  it("leaves the format alone when only the contents are undone", () => {
    const sheet = book({ A1: 1 });
    sheet.setFormat("A1", "0.00");
    sheet.setCell("A1", 2);
    sheet.undo();
    expect(sheet.getValue("A1")).toBe(1);
    expect(sheet.formatOf("A1")).toBe("0.00");
  });
});
