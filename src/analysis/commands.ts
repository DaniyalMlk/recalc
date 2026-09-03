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

  const applied = commit
    ? `  ${changing} set to ${short(result.value)}`
    : `  ${changing} = ${short(result.value)}` +
      ink.dim("  (not applied - add `apply` to write it)");

  return (
    `${applied}\n` +
    ink.dim(
      `  ${target} reaches ${short(result.achieved)} ` +
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
