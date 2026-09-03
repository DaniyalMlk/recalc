import { describe, expect, it } from "vitest";

import { ScenarioError, ScenarioSet } from "../src/analysis/scenarios.js";
import { Workbook } from "../src/engine/workbook.js";

/**
 * The model is a small appraisal: three assumptions feeding three outputs.
 * Enough that a scenario has something to move and a summary has something to
 * compare, small enough that every expected number can be worked out by hand.
 */
function appraisal(): Workbook {
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
    A6: "Revenue",
    B6: "=B1*B2",
    A7: "Profit",
    B7: "=(B1-B3)*B2-B4",
    A8: "Verdict",
    B8: '=IF(B7>0,"go","no")',
  });
  book.clearHistory();
  return book;
}

function withCases(): { book: Workbook; set: ScenarioSet } {
  const book = appraisal();
  const set = new ScenarioSet();
  set.capture(book, "Base", ["B1", "B2", "B3"]);
  set.define("Downside", [
    ["B1", "25"],
    ["B2", "700"],
    ["B3", "20"],
  ]);
  set.define("Upside", [
    ["B1", "34"],
    ["B2", "1400"],
    ["B3", "17"],
  ]);
  return { book, set };
}

describe("defining scenarios", () => {
  it("stores the assumptions it was given", () => {
    const set = new ScenarioSet();
    set.define("Downside", [["B1", "25"]]);
    expect(set.get("Downside")?.assumptions).toEqual([
      { address: "B1", input: "25" },
    ]);
  });

  it("looks up case-insensitively but keeps the spelling", () => {
    const set = new ScenarioSet();
    set.define("Downside", [["B1", "25"]]);
    expect(set.has("DOWNSIDE")).toBe(true);
    expect(set.get("downside")?.name).toBe("Downside");
  });

  it("normalises anchored addresses", () => {
    const set = new ScenarioSet();
    set.define("X", [["$B$1", "25"]]);
    expect(set.get("X")?.assumptions[0]?.address).toBe("B1");
  });

  it("merges two entries for the same cell, last one winning", () => {
    const set = new ScenarioSet();
    set.define("X", [["B1", "25"], ["$B$1", "30"]]);
    expect(set.get("X")?.assumptions).toEqual([
      { address: "B1", input: "30" },
    ]);
  });

  it("replaces in place, keeping the column order of a summary stable", () => {
    const set = new ScenarioSet();
    set.define("A", [["B1", "1"]]);
    set.define("B", [["B1", "2"]]);
    set.define("A", [["B1", "9"]]);
    expect(set.list().map((s) => s.name)).toEqual(["A", "B"]);
  });

  it("refuses an empty name", () => {
    expect(() => new ScenarioSet().define("  ", [])).toThrow(ScenarioError);
  });

  it("refuses an address that is not a cell", () => {
    expect(() => new ScenarioSet().define("X", [["nope", "1"]])).toThrow(
      ScenarioError,
    );
  });

  it("deletes and reports whether there was anything to delete", () => {
    const set = new ScenarioSet();
    set.define("X", [["B1", "1"]]);
    expect(set.delete("x")).toBe(true);
    expect(set.delete("x")).toBe(false);
    expect(set.size).toBe(0);
  });
});

describe("capture", () => {
  it("records what the cells hold now", () => {
    const book = appraisal();
    const set = new ScenarioSet();
    set.capture(book, "Base", ["B1", "B2"]);
    expect(set.get("Base")?.assumptions).toEqual([
      { address: "B1", input: "30" },
      { address: "B2", input: "1000" },
    ]);
  });

  it("records a formula as a formula", () => {
    const book = appraisal();
    const set = new ScenarioSet();
    set.capture(book, "Base", ["B7"]);
    expect(set.get("Base")?.assumptions[0]?.input).toBe("=(B1-B3)*B2-B4");
  });

  it("records an empty cell as empty", () => {
    const set = new ScenarioSet();
    set.capture(appraisal(), "Base", ["Z9"]);
    expect(set.get("Base")?.assumptions[0]?.input).toBe("");
  });

  it("gives a way back after applying something else", () => {
    const { book, set } = withCases();
    set.apply(book, "Downside");
    expect(book.getValue("B1")).toBe(25);
    set.apply(book, "Base");
    expect(book.getValue("B1")).toBe(30);
    expect(book.getValue("B7")).toBe((30 - 18) * 1000 - 8000);
  });
});

describe("apply", () => {
  it("writes every assumption", () => {
    const { book, set } = withCases();
    const result = set.apply(book, "Downside");
    expect(result.changed).toBe(3);
    expect(book.getValue("B1")).toBe(25);
    expect(book.getValue("B2")).toBe(700);
    expect(book.getValue("B3")).toBe(20);
  });

  it("recalculates what depends on the assumptions", () => {
    const { book, set } = withCases();
    set.apply(book, "Downside");
    expect(book.getValue("B7")).toBe((25 - 20) * 700 - 8000);
    expect(book.getValue("B8")).toBe("no");
  });

  it("is one undoable step", () => {
    const { book, set } = withCases();
    set.apply(book, "Upside");
    expect(book.canUndo).toBe(true);
    book.undo();
    expect(book.getValue("B1")).toBe(30);
    expect(book.getValue("B2")).toBe(1000);
    expect(book.canUndo).toBe(false);
  });

  it("restores an overwritten formula on undo", () => {
    const { book, set } = withCases();
    set.define("Flat", [["B7", "0"]]);
    set.apply(book, "Flat");
    expect(book.getFormula("B7")).toBeNull();
    book.undo();
    expect(book.getFormula("B7")).toBe("=(B1-B3)*B2-B4");
    expect(book.getValue("B7")).toBe((30 - 18) * 1000 - 8000);
  });

  it("clears a cell for an empty assumption", () => {
    const { book, set } = withCases();
    set.define("Blank", [["B4", ""]]);
    set.apply(book, "Blank");
    expect(book.has("B4")).toBe(false);
    expect(book.getValue("B7")).toBe((30 - 18) * 1000);
  });

  it("applies a formula assumption", () => {
    const { book, set } = withCases();
    set.define("Tied", [["B4", "=B2*10"]]);
    set.apply(book, "Tied");
    expect(book.getFormula("B4")).toBe("=B2*10");
    expect(book.getValue("B7")).toBe((30 - 18) * 1000 - 10000);
  });

  it("refuses a scenario that does not exist", () => {
    expect(() => new ScenarioSet().apply(appraisal(), "nope")).toThrow(
      /no scenario called nope/,
    );
  });
});

describe("conflicts", () => {
  it("finds nothing when every assumption lands on a value", () => {
    const { book, set } = withCases();
    expect(set.conflicts(book, "Downside")).toEqual([]);
  });

  it("reports a formula that would be overwritten", () => {
    const { book, set } = withCases();
    set.define("Flat", [["B7", "0"]]);
    expect(set.conflicts(book, "Flat")).toEqual([
      { address: "B7", formula: "=(B1-B3)*B2-B4" },
    ]);
  });

  it("is reported by apply as well, after the fact", () => {
    const { book, set } = withCases();
    set.define("Flat", [["B7", "0"]]);
    expect(set.apply(book, "Flat").overwrote).toHaveLength(1);
  });

  it("does not count a scenario that restores the same formula", () => {
    const { book, set } = withCases();
    set.capture(book, "Same", ["B7"]);
    expect(set.conflicts(book, "Same")).toEqual([]);
  });

  it("sees a conflict that only appeared later", () => {
    const { book, set } = withCases();
    // B2 held a number when the scenario was captured.
    expect(set.conflicts(book, "Downside")).toEqual([]);
    book.setCell("B2", "=B1*40");
    expect(set.conflicts(book, "Downside").map((c) => c.address)).toEqual([
      "B2",
    ]);
  });
});

describe("preview", () => {
  it("reads results under a scenario without applying it", () => {
    const { book, set } = withCases();
    expect(set.preview(book, "Downside", ["B6", "B7"])).toEqual([
      25 * 700,
      (25 - 20) * 700 - 8000,
    ]);
    expect(book.getValue("B1")).toBe(30);
    expect(book.canUndo).toBe(false);
  });

  it("previews a formula assumption", () => {
    const { book, set } = withCases();
    set.define("Tied", [["B4", "=B2*10"]]);
    expect(set.preview(book, "Tied", ["B7"])).toEqual([
      (30 - 18) * 1000 - 10000,
    ]);
    expect(book.getValue("B4")).toBe(8000);
  });
});

describe("summarise", () => {
  it("puts every scenario beside the current sheet", () => {
    const { book, set } = withCases();
    const summary = set.summarise(book, ["B6", "B7", "B8"]);
    expect(summary.results).toEqual(["B6", "B7", "B8"]);
    expect(summary.current).toEqual([30000, 4000, "go"]);
    expect(summary.columns.map((c) => c.name)).toEqual([
      "Base",
      "Downside",
      "Upside",
    ]);
  });

  it("computes each column independently of the others", () => {
    const { book, set } = withCases();
    const summary = set.summarise(book, ["B7"]);
    expect(summary.columns[0]?.values).toEqual([4000]);
    expect(summary.columns[1]?.values).toEqual([(25 - 20) * 700 - 8000]);
    expect(summary.columns[2]?.values).toEqual([(34 - 17) * 1400 - 8000]);
  });

  it("leaves the sheet and the history untouched", () => {
    const { book, set } = withCases();
    set.summarise(book, ["B6", "B7", "B8"]);
    expect(book.getValue("B1")).toBe(30);
    expect(book.getValue("B2")).toBe(1000);
    expect(book.getValue("B7")).toBe(4000);
    expect(book.canUndo).toBe(false);
  });

  it("marks the rows that actually move", () => {
    const { book, set } = withCases();
    const summary = set.summarise(book, ["B4", "B6", "B7"]);
    // B4 is not touched by any scenario, so it is the same everywhere.
    expect(summary.varying).toEqual(["B6", "B7"]);
  });

  it("marks nothing when no scenario moves anything", () => {
    const book = appraisal();
    const set = new ScenarioSet();
    set.capture(book, "Base", ["B1", "B2"]);
    expect(set.summarise(book, ["B6", "B7"]).varying).toEqual([]);
  });

  it("counts a text result as varying when it flips", () => {
    const { book, set } = withCases();
    expect(set.summarise(book, ["B8"]).varying).toEqual(["B8"]);
  });

  it("treats the same error in two columns as one value", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, B1: "=A1/A2" });
    const set = new ScenarioSet();
    set.define("P", [["A2", "0"]]);
    set.define("Q", [["A2", "0"]]);
    const summary = set.summarise(book, ["B1"]);
    expect(summary.columns[0]?.values[0]).toMatchObject({ code: "#DIV/0!" });
    // Both columns error, but the base case does not, so the row still varies.
    expect(summary.varying).toEqual(["B1"]);
  });

  it("does not mark a row where every column matches the base case error", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 0, B1: "=A1/A2", C1: "=A1*2" });
    const set = new ScenarioSet();
    set.define("P", [["A1", "5"]]);
    const summary = set.summarise(book, ["B1", "C1"]);
    expect(summary.varying).toEqual(["C1"]);
  });

  it("returns an empty summary for an empty set", () => {
    const summary = new ScenarioSet().summarise(appraisal(), ["B7"]);
    expect(summary.columns).toEqual([]);
    expect(summary.current).toEqual([4000]);
    expect(summary.varying).toEqual([]);
  });
});

describe("structural edits", () => {
  it("moves assumptions down when a row is inserted above them", () => {
    const { book, set } = withCases();
    book.insertRows(0, 2);
    set.adjust({ axis: "row", operation: "insert", at: 0, count: 2 });
    expect(set.get("Downside")?.assumptions[0]?.address).toBe("B3");
    set.apply(book, "Downside");
    expect(book.getValue("B3")).toBe(25);
    expect(book.getValue("B9")).toBe((25 - 20) * 700 - 8000);
  });

  it("moves assumptions across when a column is inserted", () => {
    const { book, set } = withCases();
    book.insertColumns(0, 1);
    set.adjust({ axis: "column", operation: "insert", at: 0, count: 1 });
    expect(set.get("Downside")?.assumptions[0]?.address).toBe("C1");
  });

  it("drops an assumption whose row was deleted", () => {
    const { book, set } = withCases();
    book.deleteRows(1, 1);
    set.adjust({ axis: "row", operation: "delete", at: 1, count: 1 });
    const addresses = set
      .get("Downside")
      ?.assumptions.map((a) => a.address);
    expect(addresses).toEqual(["B1", "B2"]);
  });

  it("pulls assumptions up when a row above them is deleted", () => {
    const { book, set } = withCases();
    book.deleteRows(0, 1);
    set.adjust({ axis: "row", operation: "delete", at: 0, count: 1 });
    expect(set.get("Downside")?.assumptions.map((a) => a.address)).toEqual([
      "B1",
      "B2",
    ]);
  });

  it("leaves a scenario pointing at the wrong cell if it is not adjusted", () => {
    // The failure mode the adjustment exists to prevent. Two rows in, the
    // model has slid down to B3:B5, so B1 and B2 are empty and `missing`
    // catches them - but B3 now holds what used to be B1, so the third
    // assumption points at a real cell that means something else entirely.
    // That is precisely what `missing` cannot see, and why adjust() exists.
    const { book, set } = withCases();
    book.insertRows(0, 2);
    expect(set.missing(book, "Downside")).toEqual(["B1", "B2"]);
    expect(book.getValue("B3")).toBe(30);
  });

  it("reports nothing missing once the scenario has been adjusted", () => {
    const { book, set } = withCases();
    book.insertRows(0, 2);
    set.adjust({ axis: "row", operation: "insert", at: 0, count: 2 });
    expect(set.missing(book, "Downside")).toEqual([]);
  });

  it("does not call an assumption missing when it clears a cell", () => {
    const { book, set } = withCases();
    set.define("Blank", [["Z9", ""]]);
    expect(set.missing(book, "Blank")).toEqual([]);
  });
});
