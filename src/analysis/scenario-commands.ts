/**
 * The shell's scenario commands.
 *
 * Same shape as the what-if commands next door: parsing and rendering live
 * here, the readline loop does not, and the only decoration is whatever ink
 * the caller passes in.
 */

import { formatA1, parseA1Range } from "../engine/reference.js";
import { ReferenceError_ } from "../engine/reference.js";
import type { Value } from "../engine/value.js";
import type { Workbook } from "../engine/workbook.js";
import { PLAIN } from "./commands.js";
import type { Ink } from "./commands.js";
import { ScenarioError, ScenarioSet } from "./scenarios.js";
import type { Summary } from "./scenarios.js";

export { PLAIN };

/**
 * Expand a comma-separated list of cells and blocks into addresses.
 *
 * `B1, B4:B6` is two arguments and four cells. Accepting blocks matters more
 * for scenarios than elsewhere: assumptions and results both tend to sit in a
 * column, and typing six addresses to name a column of six is the kind of
 * friction that stops people using a feature.
 */
export function expandAddresses(text: string): string[] | string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") return `empty entry in the list: ${text.trim()}`;
    let range;
    try {
      range = parseA1Range(trimmed);
    } catch (error) {
      if (error instanceof ReferenceError_) {
        return `${trimmed} is not a cell or block`;
      }
      throw error;
    }
    for (let row = range.start.row; row <= range.end.row; row++) {
      for (let col = range.start.col; col <= range.end.col; col++) {
        const address = formatA1({
          col,
          row,
          colAbsolute: false,
          rowAbsolute: false,
        });
        if (seen.has(address)) continue;
        seen.add(address);
        out.push(address);
      }
    }
  }
  return out.length === 0 ? "no cells given" : out;
}

/**
 * Read `B1=25, B2=700, B4=` into assumptions.
 *
 * Each entry splits on its *first* `=`, so `B4==B2*10` sets B4 to the formula
 * `=B2*10` rather than being rejected as two equals signs. An entry with
 * nothing after the `=` clears its cell, which is a real thing to want in a
 * scenario and not a typo to guess about.
 */
export function parseAssumptions(
  text: string,
): [string, string][] | string {
  const out: [string, string][] = [];
  for (const part of text.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") return `empty entry in the list: ${text.trim()}`;
    const equals = trimmed.indexOf("=");
    if (equals < 0) return `${trimmed} is not an assignment like B1=25`;
    const addresses = expandAddresses(trimmed.slice(0, equals));
    if (typeof addresses === "string") return addresses;
    if (addresses.length !== 1) {
      return `${trimmed.slice(0, equals).trim()} is a block, not a cell`;
    }
    out.push([addresses[0]!, trimmed.slice(equals + 1).trim()]);
  }
  return out.length === 0 ? "no assumptions given" : out;
}

function cell(value: Value): string {
  if (value === null) return "";
  if (typeof value === "number") {
    return Number.isInteger(value) && Math.abs(value) < 1e15
      ? String(value)
      : String(Number(value.toPrecision(8)));
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value;
  return value.code;
}

function grid(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((text, i) => {
      widths[i] = Math.max(widths[i] ?? 0, text.length);
    });
  }
  return rows.map((row) =>
    "  " +
    row
      .map((text, i) =>
        i === 0 ? text.padEnd(widths[i] ?? 0) : text.padStart(widths[i] ?? 0),
      )
      .join("  ")
      .trimEnd(),
  );
}

export const SCENARIO_USAGE =
  "usage: .scenario Downside = B1=25, B2=700   or   .scenario Base = B1:B3";

/**
 * `.scenario` — define, capture, show or list.
 *
 * The single command covers all four because they are the same question asked
 * with more or less detail, and four command names for one noun is how a shell
 * becomes unmemorable. `= B1:B3` with no assignments captures those cells as
 * they stand; `= B1=25` sets them.
 */
export function scenarioCommand(
  book: Workbook,
  set: ScenarioSet,
  tail: string,
  ink: Ink = PLAIN,
): string {
  const text = tail.trim();
  if (text === "") return listScenarios(set, ink);

  const equals = text.indexOf("=");
  if (equals < 0) return showScenario(book, set, text, ink);

  const name = text.slice(0, equals).trim();
  const body = text.slice(equals + 1).trim();
  if (name === "") return ink.bad(`  ${SCENARIO_USAGE}`);
  if (body === "") return ink.bad("  nothing to capture or set");

  try {
    // A body with no assignment in it is a list of cells to capture. That is
    // decidable without a keyword: `B1=25` has an `=` and `B1:B3` does not.
    const isCapture = !body.includes("=");
    if (isCapture) {
      const addresses = expandAddresses(body);
      if (typeof addresses === "string") return ink.bad(`  ${addresses}`);
      const scenario = set.capture(book, name, addresses);
      return `  captured ${scenario.name} from ${scenario.assumptions.length} cell(s)`;
    }

    const assumptions = parseAssumptions(body);
    if (typeof assumptions === "string") return ink.bad(`  ${assumptions}`);
    const scenario = set.define(name, assumptions);
    return `  ${scenario.name}: ${scenario.assumptions.length} assumption(s)`;
  } catch (error) {
    if (error instanceof ScenarioError) return ink.bad(`  ${error.message}`);
    throw error;
  }
}

function listScenarios(set: ScenarioSet, ink: Ink): string {
  const all = set.list();
  if (all.length === 0) return ink.dim("  no scenarios defined");
  const width = Math.max(...all.map((s) => s.name.length));
  return all
    .map(
      (scenario) =>
        `  ${ink.ok(scenario.name.padEnd(width))}  ` +
        scenario.assumptions
          .map(({ address, input }) => `${address}=${input}`)
          .join("  "),
    )
    .join("\n");
}

function showScenario(
  book: Workbook,
  set: ScenarioSet,
  name: string,
  ink: Ink,
): string {
  const scenario = set.get(name);
  if (scenario === undefined) {
    return ink.bad(`  no scenario called ${name}`);
  }

  const rows = scenario.assumptions.map(({ address, input }) => [
    address,
    book.getInput(address),
    "->",
    input,
  ]);
  const lines = [ink.ok(`  ${scenario.name}`), ...grid(rows)];

  const conflicts = set.conflicts(book, scenario.name);
  if (conflicts.length > 0) {
    lines.push(
      ink.bad(
        `  would overwrite ${conflicts.length} formula(s): ` +
          conflicts.map((c) => c.address).join(", "),
      ),
    );
  }

  const missing = set.missing(book, scenario.name);
  if (missing.length > 0) {
    lines.push(ink.dim(`  empty on the sheet: ${missing.join(", ")}`));
  }

  return lines.join("\n");
}

/** `.apply Downside` — write a scenario into the sheet. */
export function applyScenarioCommand(
  book: Workbook,
  set: ScenarioSet,
  tail: string,
  ink: Ink = PLAIN,
): string {
  const name = tail.trim();
  if (name === "") return ink.bad("  usage: .apply Downside");
  try {
    const result = set.apply(book, name);
    const warning =
      result.overwrote.length === 0
        ? ""
        : ink.bad(
            `\n  overwrote ${result.overwrote.length} formula(s): ` +
              result.overwrote.map((c) => c.address).join(", "),
          );
    return `  applied ${result.name} to ${result.changed} cell(s)` + warning;
  } catch (error) {
    if (error instanceof ScenarioError) return ink.bad(`  ${error.message}`);
    throw error;
  }
}

/** `.unscenario Downside` */
export function forgetScenarioCommand(
  set: ScenarioSet,
  tail: string,
  ink: Ink = PLAIN,
): string {
  const name = tail.trim();
  if (name === "") return ink.bad("  usage: .unscenario Downside");
  return set.delete(name)
    ? `  removed ${name}`
    : ink.bad(`  no scenario called ${name}`);
}

/**
 * `.summary B6:B8` — every scenario read over the same results.
 *
 * Rows that come out the same everywhere are marked, because a summary of nine
 * outputs where six never move is mostly noise and the reader should not have
 * to diff it by eye.
 */
export function summaryCommand(
  book: Workbook,
  set: ScenarioSet,
  tail: string,
  ink: Ink = PLAIN,
): string {
  const text = tail.trim();
  if (text === "") return ink.bad("  usage: .summary B6:B8");
  if (set.size === 0) return ink.dim("  no scenarios defined");

  const addresses = expandAddresses(text);
  if (typeof addresses === "string") return ink.bad(`  ${addresses}`);

  return renderSummary(set.summarise(book, addresses), ink);
}

export function renderSummary(summary: Summary, ink: Ink): string {
  const varying = new Set(summary.varying);
  const header = [
    "",
    "current",
    ...summary.columns.map((column) => column.name),
  ];
  const body = summary.results.map((address, row) => [
    varying.has(address) ? address : `${address} =`,
    cell(summary.current[row] ?? null),
    ...summary.columns.map((column) => cell(column.values[row] ?? null)),
  ]);

  const lines = grid([header, ...body]);
  const [first, ...rest] = lines;
  const note =
    summary.varying.length === summary.results.length
      ? ""
      : ink.dim("\n  rows marked = are the same under every scenario");
  return [ink.ok(first ?? ""), ...rest].join("\n") + note;
}
