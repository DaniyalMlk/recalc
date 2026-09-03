import { describe, expect, it } from "vitest";

import {
  applyScenarioCommand,
  expandAddresses,
  forgetScenarioCommand,
  parseAssumptions,
  scenarioCommand,
  summaryCommand,
} from "../src/analysis/scenario-commands.js";
import { ScenarioSet } from "../src/analysis/scenarios.js";
import { ReplSession } from "../src/repl.js";
import { Workbook } from "../src/engine/workbook.js";

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

function loaded(): { book: Workbook; set: ScenarioSet } {
  const book = model();
  const set = new ScenarioSet();
  scenarioCommand(book, set, "Base = B1:B3");
  scenarioCommand(book, set, "Downside = B1=25, B2=700, B3=20");
  return { book, set };
}

describe("expandAddresses", () => {
  it("reads a single cell", () => {
    expect(expandAddresses("B1")).toEqual(["B1"]);
  });

  it("expands a block down a column", () => {
    expect(expandAddresses("B1:B3")).toEqual(["B1", "B2", "B3"]);
  });

  it("expands a rectangular block row-major", () => {
    expect(expandAddresses("A1:B2")).toEqual(["A1", "B1", "A2", "B2"]);
  });

  it("mixes cells and blocks", () => {
    expect(expandAddresses("B4, B6:B7")).toEqual(["B4", "B6", "B7"]);
  });

  it("drops a duplicate rather than reading it twice", () => {
    expect(expandAddresses("B1, B1:B2")).toEqual(["B1", "B2"]);
  });

  it("names an entry that is not a cell", () => {
    expect(expandAddresses("B1, oops")).toBe("oops is not a cell or block");
  });

  it("rejects an empty entry", () => {
    expect(expandAddresses("B1,,B2")).toContain("empty entry");
  });
});

describe("parseAssumptions", () => {
  it("reads assignments", () => {
    expect(parseAssumptions("B1=25, B2=700")).toEqual([
      ["B1", "25"],
      ["B2", "700"],
    ]);
  });

  it("splits on the first equals so a formula survives", () => {
    expect(parseAssumptions("B4==B2*10")).toEqual([["B4", "=B2*10"]]);
  });

  it("reads an empty right-hand side as clearing the cell", () => {
    expect(parseAssumptions("B4=")).toEqual([["B4", ""]]);
  });

  it("keeps text as text", () => {
    expect(parseAssumptions("B9=grow")).toEqual([["B9", "grow"]]);
  });

  it("rejects an entry with no equals", () => {
    expect(parseAssumptions("B1")).toContain("not an assignment");
  });

  it("rejects a block on the left", () => {
    expect(parseAssumptions("B1:B3=25")).toContain("is a block, not a cell");
  });
});

describe("scenarioCommand", () => {
  it("captures a block as it stands", () => {
    const book = model();
    const set = new ScenarioSet();
    const out = scenarioCommand(book, set, "Base = B1:B3");
    expect(out).toContain("captured Base from 3 cell(s)");
    expect(set.get("Base")?.assumptions).toEqual([
      { address: "B1", input: "30" },
      { address: "B2", input: "1000" },
      { address: "B3", input: "18" },
    ]);
  });

  it("defines from assignments", () => {
    const book = model();
    const set = new ScenarioSet();
    const out = scenarioCommand(book, set, "Down = B1=25, B2=700");
    expect(out).toContain("Down: 2 assumption(s)");
    expect(set.get("Down")?.assumptions[1]?.input).toBe("700");
  });

  it("tells capture from define by whether there is an assignment", () => {
    const book = model();
    const set = new ScenarioSet();
    scenarioCommand(book, set, "A = B1:B2");
    scenarioCommand(book, set, "B = B1=1");
    expect(set.get("A")?.assumptions[0]?.input).toBe("30");
    expect(set.get("B")?.assumptions[0]?.input).toBe("1");
  });

  it("lists every scenario when given nothing", () => {
    const { book, set } = loaded();
    const out = scenarioCommand(book, set, "");
    expect(out).toContain("Base");
    expect(out).toContain("Downside");
    expect(out).toContain("B1=25");
  });

  it("says so when there are no scenarios", () => {
    expect(scenarioCommand(model(), new ScenarioSet(), "")).toContain(
      "no scenarios defined",
    );
  });

  it("shows one scenario against the sheet", () => {
    const { book, set } = loaded();
    const lines = scenarioCommand(book, set, "Downside")
      .split("\n")
      .map((line) => line.trim());
    expect(lines[0]).toBe("Downside");
    expect(lines[1]).toBe("B1    30  ->   25");
  });

  it("warns when showing a scenario that would overwrite a formula", () => {
    const { book, set } = loaded();
    scenarioCommand(book, set, "Flat = B7=0");
    expect(scenarioCommand(book, set, "Flat")).toContain("would overwrite");
  });

  it("notes an assumption pointing at an empty cell", () => {
    const { book, set } = loaded();
    scenarioCommand(book, set, "Odd = Z9=1");
    expect(scenarioCommand(book, set, "Odd")).toContain("empty on the sheet");
  });

  it("reports an unknown scenario", () => {
    expect(scenarioCommand(model(), new ScenarioSet(), "Nope")).toContain(
      "no scenario called Nope",
    );
  });

  it("rejects a bad address rather than throwing", () => {
    expect(scenarioCommand(model(), new ScenarioSet(), "X = Q=1")).toContain(
      "not a cell",
    );
  });

  it("rejects an empty body", () => {
    expect(scenarioCommand(model(), new ScenarioSet(), "X =")).toContain(
      "nothing to capture or set",
    );
  });
});

describe("applyScenarioCommand", () => {
  it("writes the scenario", () => {
    const { book, set } = loaded();
    expect(applyScenarioCommand(book, set, "Downside")).toContain(
      "applied Downside to 3 cell(s)",
    );
    expect(book.getValue("B7")).toBe((25 - 20) * 700 - 8000);
  });

  it("warns about formulas it overwrote", () => {
    const { book, set } = loaded();
    scenarioCommand(book, set, "Flat = B7=0");
    const out = applyScenarioCommand(book, set, "Flat");
    expect(out).toContain("overwrote 1 formula(s): B7");
  });

  it("reports an unknown scenario", () => {
    expect(applyScenarioCommand(model(), new ScenarioSet(), "Nope")).toContain(
      "no scenario called Nope",
    );
  });

  it("shows usage when given nothing", () => {
    expect(applyScenarioCommand(model(), new ScenarioSet(), "")).toContain(
      "usage:",
    );
  });
});

describe("forgetScenarioCommand", () => {
  it("removes a scenario", () => {
    const { set } = loaded();
    expect(forgetScenarioCommand(set, "downside")).toContain("removed");
    expect(set.has("Downside")).toBe(false);
  });

  it("reports one that was not there", () => {
    expect(forgetScenarioCommand(new ScenarioSet(), "Nope")).toContain(
      "no scenario called",
    );
  });
});

describe("summaryCommand", () => {
  it("puts every scenario beside the current sheet", () => {
    const { book, set } = loaded();
    const lines = summaryCommand(book, set, "B6:B8")
      .split("\n")
      .map((line) => line.trim());
    expect(lines[0]).toBe("current   Base  Downside");
    expect(lines[1]).toBe("B6    30000  30000     17500");
    expect(lines[3]).toBe("B8       go     go        no");
  });

  it("marks a row that is the same under every scenario", () => {
    const { book, set } = loaded();
    const out = summaryCommand(book, set, "B4, B6:B7");
    expect(out).toContain("B4 =");
    expect(out).toContain("rows marked = are the same");
  });

  it("omits the note when every row moves", () => {
    const { book, set } = loaded();
    expect(summaryCommand(book, set, "B6:B8")).not.toContain("rows marked");
  });

  it("leaves the sheet untouched", () => {
    const { book, set } = loaded();
    summaryCommand(book, set, "B6:B8");
    expect(book.getValue("B1")).toBe(30);
    expect(book.canUndo).toBe(false);
  });

  it("says so when there is nothing to summarise", () => {
    expect(summaryCommand(model(), new ScenarioSet(), "B6")).toContain(
      "no scenarios defined",
    );
  });

  it("shows usage when given nothing", () => {
    const { book, set } = loaded();
    expect(summaryCommand(book, set, "")).toContain("usage:");
  });
});

describe("scenarios in the shell", () => {
  function session(): ReplSession {
    const repl = new ReplSession();
    for (const line of [
      "B1 = 30",
      "B2 = 1000",
      "B3 = 18",
      "B4 = 8000",
      "B7 = =(B1-B3)*B2-B4",
    ]) {
      repl.handle(line);
    }
    return repl;
  }

  it("keeps a scenario across commands", () => {
    const repl = session();
    repl.handle(".scenario Base = B1:B3");
    expect(repl.handle(".scenarios")).toContain("Base");
  });

  it("applies from the prompt and undoes", () => {
    const repl = session();
    repl.handle(".scenario Down = B1=25");
    repl.handle(".apply Down");
    expect(repl.workbook.getValue("B1")).toBe(25);
    repl.handle(".undo");
    expect(repl.workbook.getValue("B1")).toBe(30);
  });

  it("moves scenarios when a row is inserted", () => {
    const repl = session();
    repl.handle(".scenario Down = B1=25, B2=700");
    repl.handle(".insertrow 1 2");
    expect(repl.scenarioSet.get("Down")?.assumptions).toEqual([
      { address: "B3", input: "25" },
      { address: "B4", input: "700" },
    ]);
  });

  it("applies correctly after the sheet has moved", () => {
    const repl = session();
    repl.handle(".scenario Down = B1=25, B2=700, B3=20");
    repl.handle(".insertrow 1 2");
    repl.handle(".apply Down");
    expect(repl.workbook.getValue("B3")).toBe(25);
    expect(repl.workbook.getValue("B9")).toBe((25 - 20) * 700 - 8000);
  });

  it("moves scenarios when a column is inserted", () => {
    const repl = session();
    repl.handle(".scenario Down = B1=25");
    repl.handle(".insertcol A");
    expect(repl.scenarioSet.get("Down")?.assumptions[0]?.address).toBe("C1");
  });

  it("forgets scenarios on reset", () => {
    const repl = session();
    repl.handle(".scenario Down = B1=25");
    repl.handle(".reset");
    expect(repl.handle(".scenarios")).toContain("no scenarios defined");
  });

  it("lists the commands in the help text", () => {
    const help = new ReplSession().handle(".help");
    expect(typeof help === "string" && help).toContain(".summary");
    expect(typeof help === "string" && help).toContain(".scenario");
  });
});
