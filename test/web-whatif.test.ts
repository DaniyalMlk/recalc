import { describe, expect, it } from "vitest";

import { ScenarioSet } from "../src/analysis/scenarios.js";
import { Workbook } from "../src/engine/workbook.js";
import {
  applyScenario,
  captureScenario,
  cellText,
  readAddress,
  runGoalSeek,
  runSummary,
  runTable,
  scenarioRows,
  short,
} from "../web/src/core/whatif.js";

function model(): Workbook {
  const book = new Workbook();
  book.setCells({
    B1: 30,
    B2: 1000,
    B3: 18,
    B4: 8000,
    B6: "=B1*B2",
    B7: "=(B1-B3)*B2-B4",
    B8: '=IF(B7>0,"go","no")',
  });
  book.clearHistory();
  return book;
}

const form = (over: Partial<Record<string, string>> = {}) => ({
  target: "B7",
  to: "0",
  changing: "B1",
  ...over,
});

describe("short", () => {
  it("groups a whole number", () => {
    expect(short(1234567)).toBe("1,234,567");
  });

  it("keeps a fraction readable", () => {
    expect(short(0.13564868)).toBe("0.13564868");
  });

  it("trims noise beyond eight significant figures", () => {
    expect(short(0.1 + 0.2)).toBe("0.3");
  });

  it("says so for a non-number", () => {
    expect(short(Number.NaN)).toBe("n/a");
  });
});

describe("cellText", () => {
  it("renders each kind of value", () => {
    expect(cellText(null)).toBe("");
    expect(cellText(1500)).toBe("1,500");
    expect(cellText(true)).toBe("TRUE");
    expect(cellText("go")).toBe("go");
    expect(cellText({ type: "error", code: "#DIV/0!" })).toBe("#DIV/0!");
  });
});

describe("readAddress", () => {
  it("normalises what it accepts", () => {
    expect(readAddress(" $b$7 ")).toBe("B7");
  });

  it("rejects what is not an address", () => {
    expect(readAddress("")).toBeNull();
    expect(readAddress("total")).toBeNull();
    expect(readAddress("B7:B9")).toBeNull();
  });
});

describe("runGoalSeek", () => {
  it("reports the answer without writing it", () => {
    const book = model();
    const view = runGoalSeek(book, form());
    expect(view.kind).toBe("seek");
    if (view.kind !== "seek") return;
    expect(view.converged).toBe(true);
    expect(view.headline).toBe("B1 = 26");
    expect(view.applied).toBe(false);
    expect(book.getValue("B1")).toBe(30);
  });

  it("says the goal was reached rather than quoting a residual", () => {
    const view = runGoalSeek(model(), form());
    if (view.kind !== "seek") throw new Error("expected a seek view");
    expect(view.detail).toContain("B7 reaches 0");
    expect(view.detail).not.toContain("e-");
  });

  it("writes when asked to apply", () => {
    const book = model();
    const view = runGoalSeek(book, form(), true);
    if (view.kind !== "seek") throw new Error("expected a seek view");
    expect(view.applied).toBe(true);
    expect(book.getValue("B1")).toBe(26);
  });

  it("marks a refusal about the graph as structural", () => {
    const view = runGoalSeek(model(), form({ changing: "A9" }));
    if (view.kind !== "seek") throw new Error("expected a seek view");
    expect(view.structural).toBe(true);
    expect(view.headline).toContain("does not depend on");
  });

  it("marks a changing cell holding a formula as structural", () => {
    const view = runGoalSeek(model(), form({ changing: "B6" }));
    if (view.kind !== "seek") throw new Error("expected a seek view");
    expect(view.structural).toBe(true);
  });

  it("does not mark a failed search as structural", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, B1: "=A1*A1+5" });
    const view = runGoalSeek(book, {
      target: "B1",
      to: "0",
      changing: "A1",
    });
    if (view.kind !== "seek") throw new Error("expected a seek view");
    expect(view.structural).toBe(false);
    expect(view.detail).toContain("Closest");
  });

  it("asks for a result address", () => {
    expect(runGoalSeek(model(), form({ target: "" }))).toEqual({
      kind: "error",
      message: "Give the result cell as an address.",
    });
  });

  it("asks for an input address", () => {
    expect(runGoalSeek(model(), form({ changing: "nope" })).kind).toBe("error");
  });

  it("refuses the same cell twice", () => {
    const view = runGoalSeek(model(), form({ target: "B1", changing: "B1" }));
    expect(view).toMatchObject({ kind: "error" });
  });

  it("asks for a numeric goal", () => {
    expect(runGoalSeek(model(), form({ to: "soon" }))).toMatchObject({
      kind: "error",
      message: "The goal has to be a number.",
    });
  });
});

const table = (over: Partial<Record<string, string>> = {}) => ({
  result: "B7",
  input: "B1",
  axis: "25,30,35",
  crossInput: "",
  crossAxis: "",
  ...over,
});

describe("runTable", () => {
  it("builds a one-way table", () => {
    const view = runTable(model(), table());
    if (view.kind !== "table") throw new Error("expected a table");
    expect(view.header).toEqual(["B1", "B7"]);
    expect(view.rows.map((row) => row.cells)).toEqual([
      ["25", "-1,000"],
      ["30", "4,000"],
      ["35", "9,000"],
    ]);
    expect(view.note).toContain("Base case");
  });

  it("builds a crossed table", () => {
    const view = runTable(
      model(),
      table({ crossInput: "B2", crossAxis: "1000,2000" }),
    );
    if (view.kind !== "table") throw new Error("expected a table");
    expect(view.header).toEqual(["B7", "1000", "2000"]);
    expect(view.rows[0]?.cells).toEqual(["25", "-1,000", "6,000"]);
    expect(view.note).toBe("B1 down, B2 across.");
  });

  it("leaves the sheet alone when previewing", () => {
    const book = model();
    runTable(book, table());
    expect(book.getValue("B1")).toBe(30);
    expect(book.canUndo).toBe(false);
  });

  it("writes into the sheet when given a destination", () => {
    const book = model();
    const view = runTable(book, table(), "D1");
    expect(view).toMatchObject({ kind: "note" });
    expect(book.getValue("D1")).toBe("B1");
    expect(book.getValue("E2")).toBe(-1000);
  });

  it("reports a malformed axis rather than throwing", () => {
    expect(runTable(model(), table({ axis: "1..5/0" })).kind).toBe("error");
  });

  it("refuses a second axis with no second input", () => {
    expect(runTable(model(), table({ crossAxis: "1,2" })).kind).toBe("error");
  });

  it("refuses the same cell as result and input", () => {
    expect(runTable(model(), table({ input: "B7" })).kind).toBe("error");
  });
});

describe("scenarios in the panel", () => {
  function loaded(): { book: Workbook; set: ScenarioSet } {
    const book = model();
    const set = new ScenarioSet();
    set.capture(book, "Base", ["B1", "B2", "B3"]);
    set.define("Downside", [
      ["B1", "25"],
      ["B2", "700"],
      ["B3", "20"],
    ]);
    return { book, set };
  }

  it("captures the selection", () => {
    const book = model();
    const set = new ScenarioSet();
    expect(captureScenario(book, set, "Base", "B1:B3")).toMatchObject({
      kind: "note",
    });
    expect(set.get("Base")?.assumptions).toHaveLength(3);
  });

  it("asks for a name", () => {
    expect(
      captureScenario(model(), new ScenarioSet(), "  ", "B1:B3"),
    ).toMatchObject({ kind: "error" });
  });

  it("reports a bad block", () => {
    expect(
      captureScenario(model(), new ScenarioSet(), "Base", "nope"),
    ).toMatchObject({ kind: "error" });
  });

  it("lists what is defined, shortening a long one", () => {
    const { book, set } = loaded();
    set.define("Wide", [
      ["B1", "1"],
      ["B2", "2"],
      ["B3", "3"],
      ["B4", "4"],
      ["B9", "5"],
    ]);
    const rows = scenarioRows(book, set);
    expect(rows.map((row) => row.name)).toEqual(["Base", "Downside", "Wide"]);
    expect(rows[2]?.summary).toContain("+2 more");
    expect(rows[0]?.summary).toBe("B1=30 · B2=1000 · B3=18");
  });

  it("flags a scenario that would overwrite a formula", () => {
    const { book, set } = loaded();
    set.define("Flat", [["B7", "0"]]);
    const row = scenarioRows(book, set).find((r) => r.name === "Flat");
    expect(row?.conflicts).toEqual(["B7"]);
  });

  it("shows a blank assumption as such rather than as nothing", () => {
    const book = model();
    const set = new ScenarioSet();
    set.define("Blank", [["B4", ""]]);
    expect(scenarioRows(book, set)[0]?.summary).toBe("B4=(blank)");
  });

  it("applies a scenario", () => {
    const { book, set } = loaded();
    expect(applyScenario(book, set, "Downside")).toMatchObject({
      kind: "note",
    });
    expect(book.getValue("B7")).toBe((25 - 20) * 700 - 8000);
  });

  it("reports what an apply overwrote", () => {
    const { book, set } = loaded();
    set.define("Flat", [["B7", "0"]]);
    expect(applyScenario(book, set, "Flat")).toMatchObject({
      kind: "error",
      message: expect.stringContaining("overwriting 1 formula: B7"),
    });
  });

  it("reports an unknown scenario", () => {
    expect(applyScenario(model(), new ScenarioSet(), "Nope")).toMatchObject({
      kind: "error",
    });
  });
});

describe("runSummary", () => {
  function loaded(): { book: Workbook; set: ScenarioSet } {
    const book = model();
    const set = new ScenarioSet();
    set.capture(book, "Base", ["B1", "B2", "B3"]);
    set.define("Downside", [["B1", "25"], ["B2", "700"], ["B3", "20"]]);
    return { book, set };
  }

  it("puts every scenario beside the sheet", () => {
    const { book, set } = loaded();
    const view = runSummary(book, set, "B6:B8");
    if (view.kind !== "table") throw new Error("expected a table");
    expect(view.header).toEqual(["", "current", "Base", "Downside"]);
    expect(view.rows[0]?.cells).toEqual(["B6", "30,000", "30,000", "17,500"]);
  });

  it("dims a row that never moves", () => {
    const { book, set } = loaded();
    const view = runSummary(book, set, "B4,B6:B7");
    if (view.kind !== "table") throw new Error("expected a table");
    expect(view.rows[0]?.muted).toBe(true);
    expect(view.rows[1]?.muted).toBe(false);
    expect(view.note).toContain("Dimmed rows");
  });

  it("omits the note when every row moves", () => {
    const { book, set } = loaded();
    const view = runSummary(book, set, "B6:B8");
    if (view.kind !== "table") throw new Error("expected a table");
    expect(view.note).toBeUndefined();
  });

  it("says so when there is nothing defined", () => {
    expect(runSummary(model(), new ScenarioSet(), "B7")).toMatchObject({
      kind: "note",
    });
  });

  it("reports a bad result list", () => {
    const { book, set } = loaded();
    expect(runSummary(book, set, "nope")).toMatchObject({ kind: "error" });
  });

  it("leaves the sheet alone", () => {
    const { book, set } = loaded();
    runSummary(book, set, "B6:B8");
    expect(book.getValue("B1")).toBe(30);
    expect(book.canUndo).toBe(false);
  });
});
