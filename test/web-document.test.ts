import { describe, expect, it } from "vitest";

import { ScenarioSet } from "../src/analysis/scenarios.js";
import { Workbook } from "../src/engine/workbook.js";
import { writeDocument } from "../src/io/document.js";
import {
  documentFileName,
  openDocument,
  replaceSheet,
  saveDocument,
} from "../web/src/core/document.js";
import type { Sheet } from "../web/src/core/document.js";
import {
  SAMPLE_FORMATS,
  SAMPLE_NAMES,
  SAMPLE_SHEET,
  sampleFormulas,
} from "../web/src/sample.js";

/**
 * Opening and saving a document from the browser.
 *
 * The browser cannot swap in a new workbook the way the shell does, because
 * the one it has is held by the app and the what-if panel at once. So it
 * empties that one and refills it, and every test here is about something an
 * empty-and-refill can get wrong that building a new workbook cannot: a cell,
 * a format, a name or a scenario left over from the sheet that was open.
 */

function blank(): Sheet {
  return { workbook: new Workbook(), scenarios: new ScenarioSet() };
}

/** The browser's own worked example, with two scenarios captured over it. */
function example(): Sheet {
  const sheet = blank();
  for (const [name, target] of Object.entries(SAMPLE_NAMES)) {
    sheet.workbook.defineName(name, target);
  }
  sheet.workbook.setCells({ ...SAMPLE_SHEET, ...sampleFormulas() });
  for (const [block, code] of Object.entries(SAMPLE_FORMATS)) {
    sheet.workbook.setFormat(block, code);
  }
  sheet.workbook.setName("TAX", 0.25);
  const inputs = Object.keys(SAMPLE_SHEET).filter(
    (address) => !String(SAMPLE_SHEET[address]).startsWith("="),
  );
  const first = inputs.find((address) => typeof sheet.workbook.getValue(address) === "number");
  if (first === undefined) throw new Error("the example has no numeric input");
  sheet.scenarios.define("Low", [[first, "1"]]);
  sheet.scenarios.define("High", [[first, "1000"]]);
  sheet.workbook.clearHistory();
  return sheet;
}

/** A sheet holding one of everything that must not survive an open. */
function cluttered(): Sheet {
  const sheet = blank();
  sheet.workbook.defineName("STALE", "Z900");
  sheet.workbook.setCells({ Z900: "7", Z901: "=STALE*2", AA1: "left behind" });
  sheet.workbook.setFormat("Y50", "0.00%");
  sheet.scenarios.define("Old", [["Z900", "99"]]);
  return sheet;
}

describe("opening a document in the browser", () => {
  it("leaves the sheet writing the same bytes it was opened from", () => {
    const text = saveDocument(example());
    const target = cluttered();
    const opened = openDocument(target, text);
    expect(opened.ok).toBe(true);
    expect(saveDocument(target)).toBe(text);
  });

  it("carries something of every kind, so the round trip is not vacuous", () => {
    const source = example();
    const target = blank();
    const opened = openDocument(target, saveDocument(source));
    if (!opened.ok) throw new Error(opened.message);
    expect(opened.cells).toBeGreaterThan(20);
    expect(opened.names).toBe(Object.keys(SAMPLE_NAMES).length + 1);
    expect(opened.scenarios).toBe(2);
    // Formats are reported per cell, not per block as the example sets them.
    expect(target.workbook.formatEntries().length).toBeGreaterThan(
      Object.keys(SAMPLE_FORMATS).length,
    );
    expect(target.workbook.formatEntries()).toEqual(source.workbook.formatEntries());
  });

  it("computes the same values as the sheet it was saved from", () => {
    const source = example();
    const target = cluttered();
    openDocument(target, saveDocument(source));
    for (const address of Object.keys(source.workbook.toInputMap())) {
      expect(target.workbook.getValue(address), address).toEqual(
        source.workbook.getValue(address),
      );
    }
  });

  it("keeps a value-bound name a value, not the text of one", () => {
    const target = blank();
    openDocument(target, saveDocument(example()));
    const tax = target.workbook.names().find((entry) => entry.name === "TAX");
    expect(tax?.binding).toEqual({ kind: "value", value: 0.25 });
  });

  it("leaves nothing of the sheet that was open", () => {
    const target = cluttered();
    openDocument(target, saveDocument(example()));
    expect(target.workbook.has("Z900")).toBe(false);
    expect(target.workbook.has("Z901")).toBe(false);
    expect(target.workbook.has("AA1")).toBe(false);
    expect(target.workbook.names().map((entry) => entry.name)).not.toContain("STALE");
    expect(target.workbook.formatEntries().map((entry) => entry.address)).not.toContain("Y50");
    expect(target.scenarios.has("Old")).toBe(false);
  });

  it("cannot be undone back to the sheet that was open", () => {
    const target = cluttered();
    expect(target.workbook.canUndo).toBe(true);
    openDocument(target, saveDocument(example()));
    expect(target.workbook.canUndo).toBe(false);
  });

  it.each([
    ["text that is not JSON", "Year,Revenue\n2026,100\n", /not a document/],
    ["JSON that is not a document", "[1, 2, 3]\n", /must be an object/],
    ["a document from a later version", '{"recalc": 2, "cells": {}}\n', /version 2/],
    [
      "a document whose last part is broken",
      JSON.stringify({ recalc: 1, cells: { A1: "5" }, formats: "0.00" }),
      /formats must be a list/,
    ],
  ])("refuses %s and leaves the open sheet untouched", (_label, text, message) => {
    const target = cluttered();
    const before = writeDocument(target.workbook, target.scenarios);
    const opened = openDocument(target, text);
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.message).toMatch(message);
    expect(writeDocument(target.workbook, target.scenarios)).toBe(before);
    expect(target.workbook.canUndo).toBe(true);
  });
});

describe("replacing the sheet with nothing", () => {
  it("clears the scenarios along with the cells", () => {
    // Clear sheet and Load example both used to leave these behind, and a
    // scenario applied to a sheet it was not captured over writes its values
    // into cells that now mean something else.
    const sheet = cluttered();
    replaceSheet(sheet, null);
    expect(sheet.scenarios.size).toBe(0);
    expect(sheet.workbook.cellCount).toBe(0);
    expect(sheet.workbook.names()).toEqual([]);
    expect(sheet.workbook.formatEntries()).toEqual([]);
    expect(sheet.workbook.canUndo).toBe(false);
  });
});

describe("the name a saved document is given", () => {
  it.each([
    ["project appraisal", "project-appraisal.json"],
    ["model.json", "model.json"],
    ["Q3 Forecast (v2).JSON", "q3-forecast-v2.json"],
    ["  ", "sheet.json"],
    ["../../etc", "etc.json"],
    ["empty sheet", "empty-sheet.json"],
  ])("%j saves as %j", (title, file) => {
    expect(documentFileName(title)).toBe(file);
  });
});
