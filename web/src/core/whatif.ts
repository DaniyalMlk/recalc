/**
 * What the what-if panel shows, worked out without a DOM in sight.
 *
 * The panel is three forms over one engine, and almost all of its behaviour is
 * in deciding what to put on screen: which field is wrong, whether a refusal
 * is a mistake or a fact about the graph, how a table of values becomes a
 * table of strings. None of that needs an element, so none of it is written
 * against one — the same split the rest of `web/src/core` uses.
 */

import { parseAxis } from "../../../src/analysis/axis.js";
import { goalSeek, applyGoalSeek } from "../../../src/analysis/goalseek.js";
import type { GoalSeekResult } from "../../../src/analysis/goalseek.js";
import { expandAddresses } from "../../../src/analysis/scenario-commands.js";
import { ScenarioError } from "../../../src/analysis/scenarios.js";
import type { ScenarioSet } from "../../../src/analysis/scenarios.js";
import {
  TableError,
  oneWayTable,
  twoWayTable,
  writeOneWayTable,
  writeTwoWayTable,
} from "../../../src/analysis/table.js";
import { formatA1, parseA1 } from "../../../src/engine/reference.js";
import { ReferenceError_ } from "../../../src/engine/reference.js";
import type { Value } from "../../../src/engine/value.js";
import type { Workbook } from "../../../src/engine/workbook.js";

export type WhatIfTab = "seek" | "table" | "cases";

export interface GoalSeekForm {
  readonly target: string;
  readonly to: string;
  readonly changing: string;
}

export interface TableForm {
  readonly result: string;
  readonly input: string;
  readonly axis: string;
  /** Empty for a one-way table. */
  readonly crossInput: string;
  readonly crossAxis: string;
}

/** A rendered grid: a header row and body rows, all already strings. */
export interface TableView {
  readonly kind: "table";
  readonly header: readonly string[];
  readonly rows: readonly TableRow[];
  /** A line under the table, when there is something worth saying. */
  readonly note?: string;
}

export interface TableRow {
  readonly cells: readonly string[];
  /** Drawn back, for a row that is the same in every column. */
  readonly muted?: boolean;
}

export interface MessageView {
  readonly kind: "error" | "note";
  readonly message: string;
}

export interface GoalSeekView {
  readonly kind: "seek";
  readonly converged: boolean;
  /** `B1 = 26`, or the refusal. */
  readonly headline: string;
  readonly detail: string;
  /**
   * Whether the headline is a fact about the graph rather than a failed
   * search. The panel says these differently: one is an answer, the other is
   * something that went wrong.
   */
  readonly structural: boolean;
  readonly applied: boolean;
}

export type WhatIfView = TableView | MessageView | GoalSeekView;

/** Six to eight significant figures, trailing zeros dropped. */
export function short(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (Number.isInteger(value) && Math.abs(value) < 1e15) {
    return value.toLocaleString("en-US");
  }
  return Number(value.toPrecision(8)).toLocaleString("en-US", {
    maximumFractionDigits: 10,
  });
}

/** One computed value as a table cell. */
export function cellText(value: Value): string {
  if (value === null) return "";
  if (typeof value === "number") return short(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value;
  return value.code;
}

/** Normalise a typed address, or `null` when it is not one. */
export function readAddress(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  try {
    const coord = parseA1(trimmed);
    return formatA1({ ...coord, colAbsolute: false, rowAbsolute: false });
  } catch (error) {
    if (error instanceof ReferenceError_) return null;
    throw error;
  }
}

const error = (message: string): MessageView => ({ kind: "error", message });
const note = (message: string): MessageView => ({ kind: "note", message });

/**
 * Refusals that are facts about the sheet rather than mistakes in the form.
 *
 * The distinction is the whole reason the engine reports a problem code: "this
 * output does not read that input" is a true and useful answer, and dressing
 * it up in the same red as a mistyped address teaches people to ignore both.
 */
const STRUCTURAL = new Set([
  "target-independent",
  "changing-is-formula",
  "target-not-formula",
]);

/**
 * Run a goal seek for the panel.
 *
 * `apply` is a deliberate argument rather than a second function: solving and
 * applying differ only in whether the answer is written, and having one code
 * path guarantees the panel cannot report one thing and write another.
 */
export function runGoalSeek(
  book: Workbook,
  form: GoalSeekForm,
  apply = false,
): WhatIfView {
  const target = readAddress(form.target);
  if (target === null) return error("Give the result cell as an address.");

  const changing = readAddress(form.changing);
  if (changing === null) return error("Give the input cell as an address.");

  if (target === changing) {
    return error("The result and the input have to be different cells.");
  }

  const to = Number(form.to.trim());
  if (form.to.trim() === "" || !Number.isFinite(to)) {
    return error("The goal has to be a number.");
  }

  const request = { target, to, changing };
  const result: GoalSeekResult = apply
    ? applyGoalSeek(book, request)
    : goalSeek(book, request);

  if (!result.converged) {
    const structural =
      result.problem !== undefined && STRUCTURAL.has(result.problem);
    return {
      kind: "seek",
      converged: false,
      headline: result.message ?? "No value reached the goal.",
      detail:
        result.evaluations === 0
          ? ""
          : `Closest: ${changing} = ${short(result.value)} puts ${target} at ` +
            `${short(result.achieved)}, after ${result.evaluations} ` +
            `recalculation${result.evaluations === 1 ? "" : "s"}.`,
      structural,
      applied: false,
    };
  }

  // Inside the tolerance is arrival, by the engine's own definition, so the
  // line says the goal rather than handing eight significant figures to a
  // residual that means nothing at this scale.
  const reached =
    Math.abs(result.achieved - to) <= result.tolerance ? to : result.achieved;

  return {
    kind: "seek",
    converged: true,
    headline: `${changing} = ${short(result.value)}`,
    detail:
      `${target} reaches ${short(reached)}, from ` +
      `${short(result.startedFrom)}, in ${result.evaluations} ` +
      `recalculation${result.evaluations === 1 ? "" : "s"}.`,
    structural: false,
    applied: apply,
  };
}

/**
 * Build a sensitivity table for the panel, and optionally write it in.
 *
 * `into` being an address is what turns this from a preview into an edit, so
 * it is the only way the function touches the sheet.
 */
export function runTable(
  book: Workbook,
  form: TableForm,
  into: string | null = null,
): WhatIfView {
  const result = readAddress(form.result);
  if (result === null) return error("Give the result cell as an address.");

  const input = readAddress(form.input);
  if (input === null) return error("Give the input cell as an address.");
  if (input === result) {
    return error("The result and the input have to be different cells.");
  }

  const crossed = form.crossInput.trim() !== "" || form.crossAxis.trim() !== "";
  const crossInput = crossed ? readAddress(form.crossInput) : null;
  if (crossed && crossInput === null) {
    return error("Give the second input cell as an address.");
  }
  if (crossInput === input) {
    return error("The two inputs have to be different cells.");
  }

  try {
    const values = parseAxis(form.axis);

    if (crossInput !== null) {
      const table = twoWayTable(book, {
        rowInput: input,
        rowValues: values,
        columnInput: crossInput,
        columnValues: parseAxis(form.crossAxis),
        result,
      });
      if (into !== null) {
        const { cells } = writeTwoWayTable(book, into, table);
        return note(`${cells} cells written at ${into}.`);
      }
      if (table.rowValues.length === 0 || table.columnValues.length === 0) {
        return note("Nothing to try.");
      }
      return {
        kind: "table",
        header: [result, ...table.columnValues],
        rows: table.rowValues.map((value, r) => ({
          cells: [value, ...(table.grid[r] ?? []).map(cellText)],
        })),
        note: `${input} down, ${crossInput} across.`,
      };
    }

    const table = oneWayTable(book, { input, values, results: [result] });
    if (into !== null) {
      const { cells } = writeOneWayTable(book, into, table);
      return note(`${cells} cells written at ${into}.`);
    }
    if (table.values.length === 0) return note("Nothing to try.");
    return {
      kind: "table",
      header: [input, result],
      rows: table.values.map((value, r) => ({
        cells: [value, ...(table.rows[r] ?? []).map(cellText)],
      })),
      note: `Base case: ${cellText(table.base[0] ?? null)}.`,
    };
  } catch (problem) {
    if (problem instanceof TableError) return error(problem.message);
    throw problem;
  }
}

/** One row of the scenario list. */
export interface ScenarioRow {
  readonly name: string;
  /** `B1=25 · B2=700`, shortened when there are many. */
  readonly summary: string;
  readonly assumptions: number;
  /** Formulas this scenario would overwrite if applied now. */
  readonly conflicts: readonly string[];
}

export function scenarioRows(
  book: Workbook,
  set: ScenarioSet,
): ScenarioRow[] {
  return set.list().map((scenario) => {
    const shown = scenario.assumptions.slice(0, 3);
    const rest = scenario.assumptions.length - shown.length;
    return {
      name: scenario.name,
      summary:
        shown
          .map(({ address, input }) => `${address}=${input || "(blank)"}`)
          .join(" · ") + (rest > 0 ? ` · +${rest} more` : ""),
      assumptions: scenario.assumptions.length,
      conflicts: set.conflicts(book, scenario.name).map((c) => c.address),
    };
  });
}

/**
 * The summary table, with the rows that never move drawn back.
 *
 * A comparison of nine outputs where six are identical everywhere is mostly
 * noise. The engine already knows which rows carry the differences, so the
 * panel dims the rest rather than making the reader diff them by eye.
 */
export function runSummary(
  book: Workbook,
  set: ScenarioSet,
  resultsText: string,
): WhatIfView {
  if (set.size === 0) return note("No scenarios yet.");

  const addresses = expandAddresses(resultsText);
  if (typeof addresses === "string") return error(capitalise(addresses));

  const summary = set.summarise(book, addresses);
  const varying = new Set(summary.varying);

  return {
    kind: "table",
    header: ["", "current", ...summary.columns.map((column) => column.name)],
    rows: summary.results.map((address, row) => ({
      cells: [
        address,
        cellText(summary.current[row] ?? null),
        ...summary.columns.map((column) => cellText(column.values[row] ?? null)),
      ],
      muted: !varying.has(address),
    })),
    ...(summary.varying.length === summary.results.length
      ? {}
      : { note: "Dimmed rows are the same under every scenario." }),
  };
}

/** Capture the selected block as a scenario, reporting what happened. */
export function captureScenario(
  book: Workbook,
  set: ScenarioSet,
  name: string,
  block: string,
): MessageView {
  if (name.trim() === "") return error("Give the scenario a name.");
  const addresses = expandAddresses(block);
  if (typeof addresses === "string") return error(capitalise(addresses));
  try {
    const scenario = set.capture(book, name, addresses);
    return note(
      `Captured ${scenario.name} from ${scenario.assumptions.length} ` +
        `cell${scenario.assumptions.length === 1 ? "" : "s"}.`,
    );
  } catch (problem) {
    if (problem instanceof ScenarioError) return error(capitalise(problem.message));
    throw problem;
  }
}

/** Apply a scenario, reporting the formulas it overwrote. */
export function applyScenario(
  book: Workbook,
  set: ScenarioSet,
  name: string,
): MessageView {
  try {
    const result = set.apply(book, name);
    if (result.overwrote.length === 0) {
      return note(`Applied ${result.name} to ${result.changed} cells.`);
    }
    return error(
      `Applied ${result.name}, overwriting ` +
        `${result.overwrote.length} formula` +
        `${result.overwrote.length === 1 ? "" : "s"}: ` +
        result.overwrote.map((c) => c.address).join(", "),
    );
  } catch (problem) {
    if (problem instanceof ScenarioError) return error(capitalise(problem.message));
    throw problem;
  }
}

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}
