/**
 * The shell's what-if commands, kept out of the shell.
 *
 * Parsing `.goalseek B5 = 0 by B1` and rendering the answer are two different
 * jobs from reading a line of input, and only the first two are worth testing
 * directly. Both are pure: text in, text out, with the workbook as the only
 * thing they touch.
 */

import { formatA1, parseA1 } from "../engine/reference.js";
import { ReferenceError_ } from "../engine/reference.js";
import type { Value } from "../engine/value.js";
import type { Workbook } from "../engine/workbook.js";
import { parseAxis } from "./axis.js";
import { applyGoalSeek, goalSeek } from "./goalseek.js";
import {
  TableError,
  oneWayTable,
  twoWayTable,
  writeOneWayTable,
  writeTwoWayTable,
} from "./table.js";
import type { OneWayTable, TwoWayTable } from "./table.js";
import { ScheduleError, amortisationSchedule, writeSchedule } from "./amortisation.js";
import type { Schedule } from "./amortisation.js";
import { RegressionError, parseRegressCommand, summarise } from "./regression.js";
import type { Summary } from "./regression.js";

/** How the caller wants a line of output decorated. */
export interface Ink {
  ok(text: string): string;
  bad(text: string): string;
  dim(text: string): string;
}

/** No decoration at all, which is what the tests want. */
export const PLAIN: Ink = {
  ok: (text) => text,
  bad: (text) => text,
  dim: (text) => text,
};

/** `B5 = 0 by B1 [apply]` */
const GOAL_SEEK =
  /^(\$?[A-Za-z]{1,3}\$?[0-9]{1,7})\s*=\s*(\S+)\s+by\s+(\$?[A-Za-z]{1,3}\$?[0-9]{1,7})\s*(apply)?$/i;

const ADDRESS = /^\$?[A-Za-z]{1,3}\$?[0-9]{1,7}$/;

function address(text: string): string | null {
  if (!ADDRESS.test(text.trim())) return null;
  try {
    const coord = parseA1(text.trim());
    return formatA1({ ...coord, colAbsolute: false, rowAbsolute: false });
  } catch (error) {
    if (error instanceof ReferenceError_) return null;
    throw error;
  }
}

/** Six significant figures, trailing zeros dropped. */
function short(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  return String(Number(value.toPrecision(8)));
}

/** One computed value, as a table cell. */
function cell(value: Value): string {
  if (value === null) return "";
  if (typeof value === "number") return short(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value;
  return value.code;
}

export const GOAL_SEEK_USAGE = "usage: .goalseek B5 = 0 by B1 [apply]";

/**
 * `.goalseek <target> = <value> by <changing> [apply]`
 *
 * Without `apply` the sheet is not touched: the answer is reported and
 * whoever asked decides. That is the safer default for a command that would
 * otherwise silently overwrite an assumption.
 */
export function goalSeekCommand(
  book: Workbook,
  tail: string,
  ink: Ink = PLAIN,
): string {
  const match = GOAL_SEEK.exec(tail.trim());
  if (match === null) return ink.bad(`  ${GOAL_SEEK_USAGE}`);

  const target = address(match[1]!);
  const changing = address(match[3]!);
  if (target === null || changing === null) {
    return ink.bad(`  ${GOAL_SEEK_USAGE}`);
  }

  const to = Number(match[2]!);
  if (!Number.isFinite(to)) {
    return ink.bad(`  the goal must be a number: ${match[2]}`);
  }

  const commit = match[4] !== undefined;
  const request = { target, to, changing };
  const result = commit
    ? applyGoalSeek(book, request)
    : goalSeek(book, request);

  if (!result.converged) {
    const detail = result.message ?? "the search did not converge";
    const closest =
      result.evaluations === 0
        ? ""
        : ink.dim(
            `\n  closest: ${changing} = ${short(result.value)} gives ` +
              `${target} = ${short(result.achieved)} ` +
              `after ${result.evaluations} recalculation(s)`,
          );
    return ink.bad(`  ${detail}`) + closest;
  }

  // Inside the tolerance is arrival, by the caller's own definition, so the
  // line says the goal rather than giving eight significant figures to a
  // residual that means nothing at this scale.
  const reached =
    Math.abs(result.achieved - to) <= result.tolerance ? to : result.achieved;

  const applied = commit
    ? `  ${changing} set to ${short(result.value)}`
    : `  ${changing} = ${short(result.value)}` +
      ink.dim("  (not applied - add `apply` to write it)");

  return (
    `${applied}\n` +
    ink.dim(
      `  ${target} reaches ${short(reached)} ` +
        `from ${short(result.startedFrom)} ` +
        `in ${result.evaluations} recalculation(s)`,
    )
  );
}

export const TABLE_USAGE =
  "usage: .table B6 by B1 = 20..40/5 [x B2 = 500..2000/4] [into D1]";

/** `B5,B6 by B1 = 20..40/5 x B2 = 1,2,3 into D1` */
interface TableCommand {
  readonly results: string[];
  readonly rowInput: string;
  readonly rowAxis: string;
  readonly columnInput?: string;
  readonly columnAxis?: string;
  readonly into?: string;
}

/**
 * Pull a command apart on its keywords.
 *
 * `into` is taken from the end first, then `x` splits the two axes, and each
 * axis splits on its own `=`. Doing it in that order means an axis is free to
 * contain a comma, a `..` or a formula without any of them being mistaken for
 * structure.
 */
export function parseTableCommand(tail: string): TableCommand | string {
  let rest = tail.trim();
  if (rest === "") return TABLE_USAGE;

  let into: string | undefined;
  const intoAt = rest.search(/\s+into\s+/i);
  if (intoAt >= 0) {
    const target = rest.slice(intoAt).replace(/^\s+into\s+/i, "").trim();
    const parsed = address(target);
    if (parsed === null) return `${target} is not a cell`;
    into = parsed;
    rest = rest.slice(0, intoAt);
  }

  const byAt = rest.search(/\s+by\s+/i);
  if (byAt < 0) return TABLE_USAGE;

  const resultText = rest.slice(0, byAt).trim();
  const results: string[] = [];
  for (const part of resultText.split(",")) {
    const parsed = address(part);
    if (parsed === null) return `${part.trim()} is not a cell`;
    results.push(parsed);
  }

  let axes = rest.slice(byAt).replace(/^\s+by\s+/i, "");
  let columnInput: string | undefined;
  let columnAxis: string | undefined;

  const crossAt = axes.search(/\s+x\s+/i);
  if (crossAt >= 0) {
    const second = axes.slice(crossAt).replace(/^\s+x\s+/i, "");
    const split = splitAxis(second);
    if (typeof split === "string") return split;
    columnInput = split.input;
    columnAxis = split.axis;
    axes = axes.slice(0, crossAt);
  }

  const first = splitAxis(axes);
  if (typeof first === "string") return first;

  return {
    results,
    rowInput: first.input,
    rowAxis: first.axis,
    ...(columnInput === undefined ? {} : { columnInput }),
    ...(columnAxis === undefined ? {} : { columnAxis }),
    ...(into === undefined ? {} : { into }),
  };
}

function splitAxis(text: string): { input: string; axis: string } | string {
  const equals = text.indexOf("=");
  if (equals < 0) return TABLE_USAGE;
  const input = address(text.slice(0, equals));
  if (input === null) return `${text.slice(0, equals).trim()} is not a cell`;
  const axis = text.slice(equals + 1).trim();
  if (axis === "") return "an axis needs some values";
  return { input, axis };
}

/** `.table ...` — build a sensitivity table and print it. */
export function tableCommand(
  book: Workbook,
  tail: string,
  ink: Ink = PLAIN,
): string {
  const parsed = parseTableCommand(tail);
  if (typeof parsed === "string") return ink.bad(`  ${parsed}`);

  try {
    if (parsed.columnInput !== undefined && parsed.columnAxis !== undefined) {
      const first = parsed.results[0];
      if (first === undefined || parsed.results.length !== 1) {
        return ink.bad("  a two-way table reads exactly one result cell");
      }
      const table = twoWayTable(book, {
        rowInput: parsed.rowInput,
        rowValues: parseAxis(parsed.rowAxis),
        columnInput: parsed.columnInput,
        columnValues: parseAxis(parsed.columnAxis),
        result: first,
      });
      if (parsed.into !== undefined) {
        const { cells } = writeTwoWayTable(book, parsed.into, table);
        return `  ${cells} cell(s) written at ${parsed.into}`;
      }
      return renderTwoWay(table, ink);
    }

    const table = oneWayTable(book, {
      input: parsed.rowInput,
      values: parseAxis(parsed.rowAxis),
      results: parsed.results,
    });
    if (parsed.into !== undefined) {
      const { cells } = writeOneWayTable(book, parsed.into, table);
      return `  ${cells} cell(s) written at ${parsed.into}`;
    }
    return renderOneWay(table, ink);
  } catch (error) {
    if (error instanceof TableError) return ink.bad(`  ${error.message}`);
    throw error;
  }
}

/** Lay out rows of text in aligned, right-justified columns. */
function grid(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((text, i) => {
      widths[i] = Math.max(widths[i] ?? 0, text.length);
    });
  }
  return rows.map(
    (row) =>
      "  " +
      row.map((text, i) => text.padStart(widths[i] ?? 0)).join("  "),
  );
}

function renderOneWay(table: OneWayTable, ink: Ink): string {
  if (table.values.length === 0) return ink.dim("  (no values to try)");
  const header = [table.input, ...table.results];
  const body = table.values.map((value, r) => [
    value,
    ...(table.rows[r] ?? []).map(cell),
  ]);
  const lines = grid([header, ...body]);
  const [first, ...rest] = lines;
  return [ink.ok(first ?? ""), ...rest].join("\n");
}

function renderTwoWay(table: TwoWayTable, ink: Ink): string {
  if (table.rowValues.length === 0 || table.columnValues.length === 0) {
    return ink.dim("  (no values to try)");
  }
  const header = [table.result, ...table.columnValues];
  const body = table.rowValues.map((value, r) => [
    value,
    ...(table.grid[r] ?? []).map(cell),
  ]);
  const lines = grid([header, ...body]);
  const [first, ...rest] = lines;
  return [ink.ok(first ?? ""), ...rest].join("\n");
}


// ---------------------------------------------------------------------------
// `.amortise`
// ---------------------------------------------------------------------------

const AMORTISE_USAGE =
  "usage: .amortise 250000 at 5.5%/12 over 360 [balloon 100000] [into D1]";

interface AmortiseCommand {
  readonly principal: number;
  readonly rate: number;
  readonly periods: number;
  /** What is still owed at the end, as a positive amount. */
  readonly balloon: number;
  readonly into?: string | undefined;
}

/**
 * `250000 at 5.5%/12 over 360 [balloon 100000] [into D1]`
 *
 * The rate is written the way it is quoted — an annual percentage over the
 * number of payments in a year — because that is how a term sheet states it,
 * and dividing it by hand before typing is exactly the step people get wrong.
 */
export function parseAmortiseCommand(tail: string): AmortiseCommand | string {
  const text = tail.trim();
  if (text === "") return AMORTISE_USAGE;

  let rest = text;
  let into: string | undefined;
  const intoMatch = /\s+into\s+(\S+)$/i.exec(rest);
  if (intoMatch !== null) {
    const target = address(intoMatch[1]!);
    if (target === null) return `not a cell address: ${intoMatch[1]}`;
    into = target;
    rest = rest.slice(0, intoMatch.index);
  }

  let balloon = 0;
  const balloonMatch = /\s+balloon\s+(\S+)$/i.exec(rest);
  if (balloonMatch !== null) {
    const amount = amount_(balloonMatch[1]!);
    if (amount === null) return `not an amount: ${balloonMatch[1]}`;
    balloon = amount;
    rest = rest.slice(0, balloonMatch.index);
  }

  const main =
    /^(\S+)\s+at\s+(\S+?)(?:\s*\/\s*(\S+))?\s+over\s+(\S+)$/i.exec(rest.trim());
  if (main === null) return AMORTISE_USAGE;

  const principal = amount_(main[1]!);
  if (principal === null) return `not an amount: ${main[1]}`;
  const quoted = rate_(main[2]!);
  if (quoted === null) return `not a rate: ${main[2]}`;
  let perYear = 1;
  if (main[3] !== undefined) {
    const divisor = Number(main[3]);
    if (!Number.isFinite(divisor) || divisor <= 0) {
      return `not a number of periods a year: ${main[3]}`;
    }
    perYear = divisor;
  }
  const periods = Number(main[4]);
  if (!Number.isInteger(periods) || periods < 1) {
    return `not a whole number of periods: ${main[4]}`;
  }

  return { principal, rate: quoted / perYear, periods, balloon, into };
}

function amount_(text: string): number | null {
  const cleaned = text.replace(/[_,]/g, "");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function rate_(text: string): number | null {
  if (text.endsWith("%")) {
    const value = Number(text.slice(0, -1));
    return Number.isFinite(value) ? value / 100 : null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** `.amortise ...` — build a debt schedule and print it, or lay it into the sheet. */
export function amortiseCommand(
  book: Workbook,
  tail: string,
  ink: Ink = PLAIN,
): string {
  const parsed = parseAmortiseCommand(tail);
  if (typeof parsed === "string") return ink.bad(`  ${parsed}`);

  try {
    const schedule = amortisationSchedule({
      rate: parsed.rate,
      nper: parsed.periods,
      pv: parsed.principal,
      fv: -parsed.balloon,
      type: 0,
    });
    if (parsed.into !== undefined) {
      const { cells } = writeSchedule(book, parsed.into, schedule);
      return `  ${cells} cell(s) written at ${parsed.into}`;
    }
    return renderSchedule(schedule, ink);
  } catch (error) {
    if (error instanceof ScheduleError) return ink.bad(`  ${error.message}`);
    throw error;
  }
}

/**
 * Print a schedule, eliding the middle when it is long.
 *
 * A 360-row schedule scrolled past is worse than useless. What a reader checks
 * is the first rows, the last rows and the totals, so those are what a long
 * schedule prints, with a count of what was left out.
 */
function renderSchedule(schedule: Schedule, ink: Ink): string {
  const header = [
    "period",
    "opening",
    "payment",
    "interest",
    "principal",
    "closing",
  ];
  const row = (period: Schedule["periods"][number]): string[] => [
    String(period.period),
    short(period.opening),
    short(period.payment),
    short(period.interest),
    short(period.principal),
    short(period.closing),
  ];

  const shown = schedule.periods.length <= 14
    ? schedule.periods.map(row)
    : [
        ...schedule.periods.slice(0, 6).map(row),
        [`… ${schedule.periods.length - 12} more`, "", "", "", "", ""],
        ...schedule.periods.slice(-6).map(row),
      ];

  const totals = [
    "total",
    "",
    short(schedule.totalInterest + schedule.totalPrincipal),
    short(schedule.totalInterest),
    short(schedule.totalPrincipal),
    "",
  ];

  const lines = grid([header, ...shown, totals]);
  const [first, ...rest] = lines;
  const last = rest.pop() ?? "";
  return [ink.ok(first ?? ""), ...rest, ink.dim(last)].join("\n");
}

export const REGRESS_USAGE = "usage: .regress B2:B12 by C2:F12 [through zero]";

/**
 * `.regress <y> by <x> [through zero]`
 *
 * A fit, laid out the way a summary is read rather than the way `LINEST`
 * returns it: one line per term with its coefficient, standard error and t
 * statistic, then the fit's own statistics underneath.
 */
export function regressCommand(
  book: Workbook,
  tail: string,
  ink: Ink = PLAIN,
): string {
  const parsed = parseRegressCommand(tail);
  if (typeof parsed === "string") return ink.bad(`  ${parsed}`);

  try {
    return renderSummary(
      summarise(book, parsed.y, parsed.x, parsed.withIntercept),
      ink,
    );
  } catch (error) {
    if (error instanceof RegressionError) return ink.bad(`  ${error.message}`);
    throw error;
  }
}

function renderSummary(summary: Summary, ink: Ink): string {
  const header = ["term", "coefficient", "std error", "t"];
  const rows = summary.terms.map((term) => [
    term.label,
    short(term.coefficient),
    short(term.standardError),
    short(term.t),
  ]);
  const lines = grid([header, ...rows]);
  const [first, ...rest] = lines;

  // Adjusted R-squared beside the raw one, because the raw one can only go up
  // as columns are added and on its own says nothing about whether they helped.
  const stats = grid([
    ["observations", String(summary.observations)],
    ["predictors", String(summary.predictors)],
    ["degrees of freedom", String(summary.df)],
    ["r squared", short(summary.rSquared)],
    ["adjusted r squared", short(summary.adjustedRSquared)],
    ["standard error", short(summary.standardError)],
    ["f", short(summary.f)],
  ]).map((line) => ink.dim(line));

  return [ink.ok(first ?? ""), ...rest, "", ...stats].join("\n");
}
