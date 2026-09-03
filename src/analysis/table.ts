/**
 * Sensitivity tables: how the answer moves as the assumptions move.
 *
 * A model's single number is the least interesting thing about it. What a
 * reader wants is the shape around it — where the result turns negative, how
 * hard it leans on one assumption, whether two assumptions compound or cancel.
 * That is a grid of trials, and the engine can already run one trial without
 * disturbing the sheet.
 *
 * Two shapes cover almost every use:
 *
 * - **One-way**: one input walked across a list of values, several results
 *   read at each. Down the page: assumptions as rows, outputs as columns.
 * - **Two-way**: two inputs crossed against each other, one result at each
 *   intersection. The classic price-against-volume grid.
 *
 * Substituted values are *inputs*, not numbers: the same text a cell accepts.
 * A sensitivity run over `"yes"`/`"no"` or over a formula is as valid as one
 * over a column of rates, and restricting it to numbers would rule out the
 * scenario switches that models are actually built around.
 */

import { formatA1, parseA1 } from "../engine/reference.js";
import type { Coord } from "../engine/reference.js";
import type { Value } from "../engine/value.js";
import type { Address, Workbook } from "../engine/workbook.js";

/** The most cells a table may hold, so a typo cannot hang the sheet. */
export const MAX_TABLE_CELLS = 20_000;

export class TableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableError";
  }
}

export interface OneWayRequest {
  /** The cell to substitute into. */
  readonly input: Address;
  /** The inputs to walk through, as they would be typed. */
  readonly values: readonly (string | number)[];
  /** The result cells to read at each step. */
  readonly results: readonly Address[];
}

export interface OneWayTable {
  readonly input: string;
  /** The substituted inputs, as given. */
  readonly values: readonly string[];
  readonly results: readonly string[];
  /** One row per substituted value, one entry per result cell. */
  readonly rows: readonly (readonly Value[])[];
  /** What the sheet held before the table was run, for each result. */
  readonly base: readonly Value[];
}

export interface TwoWayRequest {
  /** The cell substituted across the columns. */
  readonly columnInput: Address;
  readonly columnValues: readonly (string | number)[];
  /** The cell substituted down the rows. */
  readonly rowInput: Address;
  readonly rowValues: readonly (string | number)[];
  /** The single result read at each intersection. */
  readonly result: Address;
}

export interface TwoWayTable {
  readonly rowInput: string;
  readonly columnInput: string;
  readonly result: string;
  readonly rowValues: readonly string[];
  readonly columnValues: readonly string[];
  /** `grid[row][column]`, matching the order of the value lists. */
  readonly grid: readonly (readonly Value[])[];
  /** The result before the table was run. */
  readonly base: Value;
}

function label(address: Address): string {
  const coord: Coord = typeof address === "string" ? parseA1(address) : address;
  return formatA1({ ...coord, colAbsolute: false, rowAbsolute: false });
}

function asInput(value: string | number): string {
  return typeof value === "number" ? String(value) : value;
}

function requireSize(cells: number, what: string): void {
  if (cells > MAX_TABLE_CELLS) {
    throw new TableError(
      `${what} would be ${cells} cells, above the limit of ${MAX_TABLE_CELLS}`,
    );
  }
}

/**
 * Walk one input through a list of values, reading a row of results at each.
 *
 * The whole table runs inside a single trial, so the sheet is restored once at
 * the end rather than after every point. That is not only faster: it also
 * means a table cannot half-apply if something throws partway through.
 */
export function oneWayTable(
  book: Workbook,
  request: OneWayRequest,
): OneWayTable {
  const input = label(request.input);
  const results = request.results.map(label);
  if (results.length === 0) {
    throw new TableError("a table needs at least one result cell");
  }
  requireSize(request.values.length * results.length, "the table");

  const base = results.map((address) => book.getValue(address));
  const values = request.values.map(asInput);

  const rows = book.trial([], () =>
    values.map((value) =>
      book.trial([[input, value]], () =>
        results.map((address) => book.getValue(address)),
      ),
    ),
  );

  return { input, values, results, rows, base };
}

/**
 * Cross two inputs and read one result at every intersection.
 *
 * The row input is substituted in the outer loop and held while the column
 * input walks across, so a sheet with an expensive dependency below the row
 * input recomputes that part once per row instead of once per cell. On a wide
 * grid that is the difference between a table and a wait.
 */
export function twoWayTable(
  book: Workbook,
  request: TwoWayRequest,
): TwoWayTable {
  const rowInput = label(request.rowInput);
  const columnInput = label(request.columnInput);
  const result = label(request.result);

  if (rowInput === columnInput) {
    throw new TableError(
      `${rowInput} cannot be both the row input and the column input`,
    );
  }
  requireSize(
    request.rowValues.length * request.columnValues.length,
    "the table",
  );

  const rowValues = request.rowValues.map(asInput);
  const columnValues = request.columnValues.map(asInput);
  const base = book.getValue(result);

  const grid = book.trial([], () =>
    rowValues.map((down) =>
      book.trial([[rowInput, down]], () =>
        columnValues.map((across) =>
          book.probe([[columnInput, across]], result),
        ),
      ),
    ),
  );

  return {
    rowInput,
    columnInput,
    result,
    rowValues,
    columnValues,
    grid,
    base,
  };
}

/**
 * A list of `count` values from `from` to `to`, inclusive.
 *
 * The endpoints are produced exactly rather than accumulated, so a series from
 * 0.05 to 0.15 ends at 0.15 and not at 0.14999999999999999 — which would be
 * arithmetically defensible and would look like a bug in a table header.
 */
export function series(from: number, to: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new TableError("a series needs a positive whole number of steps");
  }
  if (count === 1) return [from];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(i === count - 1 ? to : from + ((to - from) * i) / (count - 1));
  }
  return out;
}

/**
 * A series centred on `centre`, `count` points wide, stepping by `step`.
 *
 * This is how a sensitivity range is usually described out loud — "the base
 * case plus or minus two points" — and building it from the centre keeps the
 * base case exactly in the middle instead of somewhere near it.
 */
export function around(centre: number, step: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new TableError("a series needs a positive whole number of steps");
  }
  const half = (count - 1) / 2;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(centre + (i - half) * step);
  return out;
}

/**
 * Lay a two-way table into the sheet as literals, with its headers.
 *
 * The corner cell carries the result's address, the way a spreadsheet's own
 * data table does, so the grid says what it is a table *of* without a caption.
 * Values are written as literals rather than formulas: they are a record of
 * what the model produced under those inputs, and re-deriving them later from
 * a sheet that has moved on would make them silently wrong.
 */
export function writeTwoWayTable(
  book: Workbook,
  at: Address,
  table: TwoWayTable,
): { cells: number } {
  const origin: Coord =
    typeof at === "string" ? parseA1(at) : { col: at.col, row: at.row };

  const entries: Record<string, string | number> = {};
  const put = (col: number, row: number, input: string | number) => {
    entries[label({ col: origin.col + col, row: origin.row + row })] = input;
  };

  put(0, 0, `'${table.result}`);
  table.columnValues.forEach((value, i) => put(i + 1, 0, `'${value}`));
  table.rowValues.forEach((value, r) => {
    put(0, r + 1, `'${value}`);
    (table.grid[r] ?? []).forEach((cell, c) => {
      put(c + 1, r + 1, cell === null ? "" : formatCell(cell));
    });
  });

  book.setCells(entries);
  return { cells: Object.keys(entries).length };
}

/**
 * One computed cell, as the input that would reproduce it.
 *
 * An error is written as text rather than as the error itself: there is no
 * input that makes a cell hold `#DIV/0!`, and writing `=1/0` to fake one would
 * be a lie about where it came from.
 */
function formatCell(value: Value): string | number {
  if (value === null) return "";
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return `'${value}`;
  return `'${value.code}`;
}
