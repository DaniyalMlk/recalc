import { describe, expect, it } from "vitest";
import { ScenarioSet } from "../src/analysis/scenarios.js";
import { err } from "../src/engine/errors.js";
import { Workbook } from "../src/engine/workbook.js";
import {
  DOCUMENT_VERSION,
  readDocument,
  toDocument,
  writeDocument,
} from "../src/io/document.js";

/** A sheet with one of everything a document has to carry. */
function model(): { book: Workbook; scenarios: ScenarioSet } {
  const book = new Workbook();
  book.defineName("REV", "B1:B3");
  book.setName("RATE", 0.05);
  book.setName("FLAG", true);
  book.setName("LABEL", "base");
  book.setCells({
    A1: "=SUM(REV)*RATE",
    A2: "=IF(FLAG,LABEL,\"off\")",
    B1: "10",
    B2: "20",
    B3: "30",
    C1: "=SEQUENCE(3)",
    E1: "text",
    E2: "TRUE",
  });
  book.setFormat("A1", "#,##0.00");
  book.setFormat("B1:B3", "0.0");
  // A format on a cell that holds nothing: it cannot be recovered from any
  // value, which is the reason formats are written separately at all.
  book.setFormat("D5", "0%");
  const scenarios = new ScenarioSet();
  scenarios.capture(book, "Base", ["B1", "B2", "B3"]);
  scenarios.define("High", [
    ["B1", "100"],
    ["B2", "200"],
    ["B3", "=B2*2"],
  ]);
  return { book, scenarios };
}

const sortedInputs = (book: Workbook): [string, string][] =>
  Object.entries(book.toInputMap()).sort(([a], [b]) => a.localeCompare(b));

describe("a document reads back as the sheet it was written from", () => {
  it("keeps the inputs, not the values", () => {
    const { book, scenarios } = model();
    const { book: again } = readDocument(writeDocument(book, scenarios));
    expect(sortedInputs(again)).toEqual(sortedInputs(book));
    // The point of inputs: the formula is still a formula on the way back.
    expect(again.getFormula("A1")).toBe("=SUM(REV)*RATE");
    expect(again.getValue("A1")).toBe(book.getValue("A1"));
    expect(again.getValue("A1")).toBe(3);
  });

  it("keeps the formats, including one on an empty cell", () => {
    const { book, scenarios } = model();
    const { book: again } = readDocument(writeDocument(book, scenarios));
    expect(again.formatEntries()).toEqual(book.formatEntries());
    expect(again.formatOf("D5")).toBe("0%");
    expect(again.getDisplay("A1")).toBe("3.00");
    expect(again.getDisplay("B1")).toBe("10.0");
  });

  it("keeps both kinds of name", () => {
    const { book, scenarios } = model();
    const { book: again } = readDocument(writeDocument(book, scenarios));
    expect(again.names()).toEqual(book.names());
    expect(again.lookupName("REV")).toEqual({
      kind: "range",
      range: {
        start: { col: 1, row: 0, colAbsolute: false, rowAbsolute: false },
        end: { col: 1, row: 2, colAbsolute: false, rowAbsolute: false },
      },
    });
    expect(again.lookupName("FLAG")).toEqual({ kind: "value", value: true });
    expect(again.lookupName("LABEL")).toEqual({ kind: "value", value: "base" });
    // The distinction a shared representation would lose: the boolean name is
    // a boolean and not the text "true", so the formula using it still picks
    // the first branch.
    expect(again.getValue("A2")).toBe("base");
  });

  it("keeps the scenarios, which is the gap it closes", () => {
    const { book, scenarios } = model();
    const read = readDocument(writeDocument(book, scenarios));
    expect(read.scenarios.list()).toEqual(scenarios.list());
    expect(read.scenarios.size).toBe(2);
    // And they still work on the sheet that came back with them.
    expect(read.scenarios.apply(read.book, "High").changed).toBe(3);
    expect(read.book.getValue("B3")).toBe(400);
    read.scenarios.apply(read.book, "Base");
    expect(read.book.getValue("B3")).toBe(30);
    expect(read.book.getValue("A1")).toBe(3);
  });

  it("does not write the cells a spill filled in", () => {
    const { book, scenarios } = model();
    const document = toDocument(book, scenarios);
    expect(book.isSpilled("C2")).toBe(true);
    expect(book.getValue("C2")).toBe(2);
    expect(Object.keys(document.cells)).not.toContain("C2");
    expect(Object.keys(document.cells)).not.toContain("C3");
    expect(document.cells["C1"]).toBe("=SEQUENCE(3)");
    // Reading it back rebuilds the block from the anchor rather than from
    // literals, so the spilled cells are spilled and not typed.
    const { book: again } = readDocument(writeDocument(book, scenarios));
    expect(again.isSpilled("C2")).toBe(true);
    expect(again.isSpillAnchor("C1")).toBe(true);
    expect(again.getValue("C3")).toBe(3);
  });

  it("writes the same bytes for the same sheet, and again after a round trip", () => {
    const { book, scenarios } = model();
    const text = writeDocument(book, scenarios);
    expect(writeDocument(book, scenarios)).toBe(text);
    const read = readDocument(text);
    expect(writeDocument(read.book, read.scenarios)).toBe(text);
    // Entered in a different order, the same sheet still writes the same
    // document: cells are sorted by position and not by when they arrived.
    const shuffled = new Workbook();
    shuffled.setCells({ B3: "3", A1: "1", B1: "2" });
    const forwards = new Workbook();
    forwards.setCells({ A1: "1", B1: "2", B3: "3" });
    expect(writeDocument(shuffled)).toBe(writeDocument(forwards));
    expect(text.endsWith("\n")).toBe(true);
  });

  it("carries a name bound to an error, detail and all", () => {
    const book = new Workbook();
    book.setName("BAD", err("#DIV/0!", "divided by zero"));
    book.setName("PLAIN", err("#N/A"));
    const document = toDocument(book);
    expect(document.names).toEqual([
      {
        name: "BAD",
        kind: "value",
        value: { error: "#DIV/0!", detail: "divided by zero" },
      },
      { name: "PLAIN", kind: "value", value: { error: "#N/A" } },
    ]);
    const { book: again } = readDocument(writeDocument(book));
    expect(again.lookupName("BAD")).toEqual({
      kind: "value",
      value: { type: "error", code: "#DIV/0!", detail: "divided by zero" },
    });
    expect(again.lookupName("PLAIN")).toEqual({
      kind: "value",
      value: { type: "error", code: "#N/A" },
    });
  });

  it("starts the opened sheet's history at the document", () => {
    const { book, scenarios } = model();
    const { book: again } = readDocument(writeDocument(book, scenarios));
    // Opening a file is not an edit to be undone: there is nothing behind it
    // but an empty grid, and arriving there by pressing undo is a bug and not
    // a feature.
    expect(again.undo()).toBe(false);
    expect(again.getValue("A1")).toBe(3);
    again.setCell("B1", "40");
    expect(again.undo()).toBe(true);
    expect(again.getValue("B1")).toBe(10);
  });

  it("writes a version, and the one it reads", () => {
    expect(toDocument(new Workbook()).recalc).toBe(DOCUMENT_VERSION);
    expect(DOCUMENT_VERSION).toBe(1);
  });

  it("round-trips a sheet of randomly placed formulas and literals", () => {
    // A hundred generated sheets rather than one written by hand, because the
    // interesting failures of a serialiser are the shapes nobody thought to
    // write down: an empty sheet, a cell holding text that looks like a
    // number, a formula whose precedent is written after it.
    let seed = 20261105;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const literals = ["0", "-1", "3.5", "1e9", "TRUE", "text", "0.1", "007"];
    let withFormulas = 0;
    for (let trial = 0; trial < 100; trial += 1) {
      const book = new Workbook();
      const entries: Record<string, string> = {};
      const used: string[] = [];
      const count = Math.floor(next() * 12);
      for (let i = 0; i < count; i += 1) {
        const column = String.fromCharCode(65 + Math.floor(next() * 5));
        const row = 1 + Math.floor(next() * 6);
        const address = `${column}${row}`;
        if (next() < 0.3 && used.length > 0) {
          const target = used[Math.floor(next() * used.length)] as string;
          entries[address] = `=${target}*2+1`;
          withFormulas += 1;
        } else {
          entries[address] = literals[
            Math.floor(next() * literals.length)
          ] as string;
        }
        used.push(address);
      }
      book.setCells(entries);
      if (next() < 0.5) book.setFormat("A1:B2", "0.00");
      const text = writeDocument(book);
      const { book: again } = readDocument(text);
      expect(sortedInputs(again), text).toEqual(sortedInputs(book));
      expect(again.formatEntries()).toEqual(book.formatEntries());
      expect(writeDocument(again)).toBe(text);
      for (const address of Object.keys(entries)) {
        expect(again.getDisplay(address), `${address} in ${text}`).toBe(
          book.getDisplay(address),
        );
      }
    }
    // The generator has to have generated the case worth generating.
    expect(withFormulas).toBeGreaterThan(50);
  });
});
