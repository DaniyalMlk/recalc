import { describe, expect, it } from "vitest";

import { EditJournal, diffInputs } from "../src/engine/history.js";
import { Workbook } from "../src/engine/workbook.js";

describe("diffInputs", () => {
  const map = (o: Record<string, string>) => new Map(Object.entries(o));

  it("reports a changed cell", () => {
    expect(diffInputs(map({ A1: "1" }), map({ A1: "2" }))).toEqual([
      { address: "A1", before: "1", after: "2" },
    ]);
  });

  it("reports a cell that only exists afterwards", () => {
    expect(diffInputs(map({}), map({ A1: "9" }))).toEqual([
      { address: "A1", before: "", after: "9" },
    ]);
  });

  it("reports a cell that only existed before", () => {
    expect(diffInputs(map({ A1: "9" }), map({}))).toEqual([
      { address: "A1", before: "9", after: "" },
    ]);
  });

  it("ignores a cell that did not change", () => {
    expect(diffInputs(map({ A1: "1" }), map({ A1: "1" }))).toEqual([]);
  });
});

describe("EditJournal", () => {
  const change = (label: string) => ({
    label,
    cells: [{ address: "A1", before: "", after: "1" }],
  });

  it("starts with nothing to undo or redo", () => {
    const journal = new EditJournal();
    expect(journal.canUndo).toBe(false);
    expect(journal.canRedo).toBe(false);
    expect(journal.undoLabel).toBeNull();
  });

  it("records an operation and offers it back", () => {
    const journal = new EditJournal();
    journal.record(change("edit A1"));
    expect(journal.canUndo).toBe(true);
    expect(journal.undoLabel).toBe("edit A1");
    expect(journal.takeUndo()?.label).toBe("edit A1");
    expect(journal.canUndo).toBe(false);
    expect(journal.canRedo).toBe(true);
  });

  it("ignores an operation that changed nothing", () => {
    const journal = new EditJournal();
    journal.record({ label: "no-op", cells: [] });
    expect(journal.canUndo).toBe(false);
  });

  it("keeps a name-only operation", () => {
    const journal = new EditJournal();
    journal.record({ label: "name", cells: [], names: { before: [], after: [] } });
    expect(journal.canUndo).toBe(true);
  });

  it("moves an operation between the two stacks", () => {
    const journal = new EditJournal();
    journal.record(change("one"));
    journal.takeUndo();
    expect(journal.redoLabel).toBe("one");
    expect(journal.takeRedo()?.label).toBe("one");
    expect(journal.canUndo).toBe(true);
    expect(journal.canRedo).toBe(false);
  });

  it("discards the redo stack once a new operation lands", () => {
    const journal = new EditJournal();
    journal.record(change("one"));
    journal.takeUndo();
    expect(journal.canRedo).toBe(true);
    journal.record(change("two"));
    expect(journal.canRedo).toBe(false);
  });

  it("drops the oldest operation past the limit", () => {
    const journal = new EditJournal(2);
    journal.record(change("one"));
    journal.record(change("two"));
    journal.record(change("three"));
    expect(journal.depth).toBe(2);
    journal.takeUndo();
    expect(journal.undoLabel).toBe("two");
  });

  it("rejects a limit that is not a positive integer", () => {
    expect(() => new EditJournal(0)).toThrow(RangeError);
  });

  it("clears both stacks", () => {
    const journal = new EditJournal();
    journal.record(change("one"));
    journal.takeUndo();
    journal.clear();
    expect(journal.canUndo).toBe(false);
    expect(journal.canRedo).toBe(false);
  });
});

describe("undo and redo on a workbook", () => {
  it("reverses a single edit", () => {
    const book = new Workbook();
    book.setCell("A1", 1);
    book.setCell("A1", 2);
    expect(book.undo()).toBe(true);
    expect(book.getValue("A1")).toBe(1);
  });

  it("puts an undone edit back", () => {
    const book = new Workbook();
    book.setCell("A1", 1);
    book.setCell("A1", 2);
    book.undo();
    expect(book.redo()).toBe(true);
    expect(book.getValue("A1")).toBe(2);
  });

  it("removes a cell that did not exist before the edit", () => {
    const book = new Workbook();
    book.setCell("A1", 5);
    book.undo();
    expect(book.has("A1")).toBe(false);
    expect(book.cellCount).toBe(0);
  });

  it("restores a cleared cell", () => {
    const book = new Workbook();
    book.setCell("A1", 5);
    book.clearCell("A1");
    book.undo();
    expect(book.getValue("A1")).toBe(5);
  });

  it("recomputes dependents after an undo", () => {
    const book = new Workbook();
    book.setCells({ A1: 2, B1: "=A1*10" });
    book.setCell("A1", 3);
    expect(book.getValue("B1")).toBe(30);
    book.undo();
    expect(book.getValue("B1")).toBe(20);
  });

  it("reports there is nothing to undo", () => {
    const book = new Workbook();
    expect(book.undo()).toBe(false);
    expect(book.canUndo).toBe(false);
  });

  it("treats a batch as one operation", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, A3: 3 });
    book.undo();
    expect(book.cellCount).toBe(0);
  });

  it("treats a fill as one operation", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, A3: 3, B1: "=A1*2" });
    book.fillDown("B1:B3");
    expect(book.getValue("B3")).toBe(6);
    book.undo();
    expect(book.has("B2")).toBe(false);
    expect(book.has("B3")).toBe(false);
    expect(book.getInput("B1")).toBe("=A1*2");
  });

  it("reverses a paste, including the cells it blanked", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, C1: 99, D1: 100 });
    book.paste(book.copy("A1:B1"), "C1");
    expect(book.has("D1")).toBe(false);
    book.undo();
    expect(book.getValue("C1")).toBe(99);
    expect(book.getValue("D1")).toBe(100);
  });

  it("reverses a cleared block", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, B1: 3 });
    book.clearBlock("A1:B2");
    book.undo();
    expect(book.toInputMap()).toEqual({ A1: "1", A2: "2", B1: "3" });
  });

  it("reverses a row insertion, formula rewriting included", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, C1: "=SUM(A1:A2)" });
    book.insertRows(1, 1);
    expect(book.getInput("C1")).toBe("=SUM(A1:A3)");
    book.undo();
    expect(book.getInput("C1")).toBe("=SUM(A1:A2)");
    expect(book.getValue("A2")).toBe(2);
    expect(book.getValue("C1")).toBe(3);
  });

  it("reverses a row deletion, #REF! included", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, C3: "=A2*2" });
    book.deleteRows(1, 1);
    expect(book.getValue("C2")).toMatchObject({ code: "#REF!" });
    book.undo();
    expect(book.getInput("C3")).toBe("=A2*2");
    expect(book.getValue("C3")).toBe(4);
  });

  it("redoes a structural edit", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2 });
    book.insertRows(0, 1);
    book.undo();
    book.redo();
    expect(book.getValue("A2")).toBe(1);
    expect(book.getValue("A3")).toBe(2);
  });

  it("reverses a name definition and rebinds its users", () => {
    const book = new Workbook();
    book.setCells({ B2: 10, B3: 20, D1: "=SUM(Revenue)" });
    book.defineName("Revenue", "B2:B3");
    expect(book.getValue("D1")).toBe(30);
    book.undo();
    expect(book.names()).toEqual([]);
    expect(book.getValue("D1")).toMatchObject({ code: "#NAME?" });
  });

  it("reverses a name removal", () => {
    const book = new Workbook();
    book.setCells({ B2: 10, B3: 20, D1: "=SUM(Revenue)" });
    book.defineName("Revenue", "B2:B3");
    book.deleteName("Revenue");
    expect(book.getValue("D1")).toMatchObject({ code: "#NAME?" });
    book.undo();
    expect(book.getValue("D1")).toBe(30);
  });

  it("restores a name that a deletion turned into #REF!", () => {
    const book = new Workbook();
    book.setCells({ B2: 10, B3: 20, D1: "=SUM(Revenue)" });
    book.defineName("Revenue", "B2:B3");
    book.deleteRows(1, 2);
    expect(book.names()[0]?.target).toBe("#REF!");
    book.undo();
    expect(book.names()[0]?.target).toBe("B2:B3");
    expect(book.getValue("D1")).toBe(30);
  });

  it("keeps invalidation working after an undo", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, B1: "=A1*2" });
    book.setCell("B1", 0);
    book.undo();
    book.setCell("A1", 7);
    expect(book.getValue("B1")).toBe(14);
  });

  it("walks back through several operations in order", () => {
    const book = new Workbook();
    book.setCell("A1", 1);
    book.setCell("A1", 2);
    book.setCell("A1", 3);
    book.undo();
    expect(book.getValue("A1")).toBe(2);
    book.undo();
    expect(book.getValue("A1")).toBe(1);
    book.undo();
    expect(book.has("A1")).toBe(false);
    expect(book.undo()).toBe(false);
  });

  it("labels what undo and redo would do", () => {
    const book = new Workbook();
    book.setCell("B7", 1);
    expect(book.undoLabel).toBe("edit B7");
    book.insertRows(2, 3);
    expect(book.undoLabel).toBe("insert 3 rows at 3");
    book.undo();
    expect(book.redoLabel).toBe("insert 3 rows at 3");
  });

  it("labels a column edit by its letter", () => {
    const book = new Workbook();
    book.setCell("C1", 1);
    book.deleteColumns(2, 1);
    expect(book.undoLabel).toBe("delete 1 column at C");
  });

  it("records nothing for a structural edit that moved nothing", () => {
    const book = new Workbook();
    book.setCell("A1", 1);
    book.clearHistory();
    book.deleteColumns(2, 1);
    expect(book.canUndo).toBe(false);
  });

  it("drops the redo stack once a new edit lands", () => {
    const book = new Workbook();
    book.setCell("A1", 1);
    book.setCell("A1", 2);
    book.undo();
    book.setCell("A1", 9);
    expect(book.canRedo).toBe(false);
    expect(book.getValue("A1")).toBe(9);
  });

  it("records nothing for an edit that changed nothing", () => {
    const book = new Workbook();
    book.setCell("A1", 1);
    book.clearHistory();
    book.setCell("A1", 1);
    expect(book.canUndo).toBe(false);
  });

  it("forgets the history on request without touching the sheet", () => {
    const book = new Workbook();
    book.setCell("A1", 1);
    book.clearHistory();
    expect(book.canUndo).toBe(false);
    expect(book.getValue("A1")).toBe(1);
  });
});
