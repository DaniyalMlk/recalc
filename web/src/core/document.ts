import type { ScenarioSet } from "../../../src/analysis/scenarios.js";
import type { Workbook } from "../../../src/engine/workbook.js";
import {
  DocumentError,
  readDocument,
  writeDocument,
} from "../../../src/io/document.js";
import type { Model } from "../../../src/io/document.js";

/**
 * Putting a different model in front of the browser, and writing one down.
 *
 * The shell replaces its session's sheet and scenarios in one callback, so
 * that `.open` cannot leave the previous sheet's scenarios sitting over the
 * new one. The browser cannot do the same thing the same way: its workbook
 * and its scenario set are owned by the app and the what-if panel and handed
 * to both, so a new pair would have to be threaded through every holder. It
 * empties the pair it has and fills it instead.
 *
 * That is one operation, {@link replaceSheet}, used by every action that puts
 * a new sheet up. Before it existed the browser had two such actions, and
 * neither cleared the scenarios: a scenario captured over the example survived
 * "Clear sheet" and "Load example", and could then be applied to a sheet it
 * had never seen, writing its overrides into cells that meant something else.
 */

/** The two things a document is a document of, as the browser holds them. */
export interface Sheet {
  readonly workbook: Workbook;
  readonly scenarios: ScenarioSet;
}

/**
 * Replace everything on the sheet with a model, or with nothing.
 *
 * Names go in before cells, as `fromDocument` does, so no formula is ever
 * evaluated against a name that has not arrived. The history is cleared last:
 * undo should not walk back through the act of opening a file.
 */
export function replaceSheet(sheet: Sheet, model: Model | null): void {
  const { workbook, scenarios } = sheet;

  scenarios.clear();
  for (const entry of workbook.names()) workbook.deleteName(entry.name);
  // Formats belong to positions, not to contents, so they survive clearing
  // the cells and have to go separately.
  for (const entry of workbook.formatEntries()) {
    workbook.clearFormat(entry.address);
  }
  workbook.setCells(
    Object.fromEntries(
      Object.keys(workbook.toInputMap()).map((address) => [address, null]),
    ),
  );

  if (model !== null) {
    for (const entry of model.book.names()) {
      if (entry.binding.kind === "value") {
        workbook.setName(entry.name, entry.binding.value);
      } else {
        workbook.defineName(entry.name, entry.target);
      }
    }
    workbook.setCells(model.book.toInputMap());
    for (const { address, code } of model.book.formatEntries()) {
      workbook.setFormat(address, code);
    }
    for (const scenario of model.scenarios.list()) {
      scenarios.define(
        scenario.name,
        scenario.assumptions.map(({ address, input }) => [address, input] as const),
      );
    }
  }

  workbook.clearHistory();
}

export type Opened =
  | {
      readonly ok: true;
      readonly cells: number;
      readonly names: number;
      readonly scenarios: number;
    }
  | { readonly ok: false; readonly message: string };

/**
 * Read a document into the sheet, or say why it could not be read.
 *
 * The text is read in full before anything on the sheet is touched, so a file
 * that turns out not to be a document — or to be one from a later version —
 * leaves the open sheet exactly as it was rather than half replaced.
 */
export function openDocument(sheet: Sheet, text: string): Opened {
  let model: Model;
  try {
    model = readDocument(text);
  } catch (problem) {
    if (problem instanceof DocumentError) {
      return { ok: false, message: problem.message };
    }
    throw problem;
  }
  replaceSheet(sheet, model);
  return {
    ok: true,
    cells: sheet.workbook.cellCount,
    names: sheet.workbook.names().length,
    scenarios: sheet.scenarios.size,
  };
}

/** The document for the sheet: the same bytes `.save` writes in the shell. */
export function saveDocument(sheet: Sheet): string {
  return writeDocument(sheet.workbook, sheet.scenarios);
}

/**
 * A file name for a sheet's title.
 *
 * The title is what the toolbar shows — "project appraisal", or the name of
 * the file it was opened from — and the saved file should be recognisably the
 * same thing. Anything a file system might object to is folded into a hyphen.
 */
export function documentFileName(title: string): string {
  const stem = title
    .replace(/\.json$/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "");
  return `${stem === "" ? "sheet" : stem}.json`;
}
