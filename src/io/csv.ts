import { formatA1, normalizeRange, parseA1 } from "../engine/reference.js";
import type { Coord, RangeRef } from "../engine/reference.js";
import { formatValue } from "../engine/value.js";
import type { Workbook } from "../engine/workbook.js";

/**
 * CSV, read and written properly.
 *
 * `line.split(",")` is wrong on the first field that contains a comma, and
 * `text.split("\n")` is wrong on the first field that contains a newline —
 * which, in exported spreadsheet data, is roughly every other file. So this is
 * a character scanner over the whole text rather than a line loop: quoting is a
 * mode the scanner is in, not a special case applied afterwards.
 *
 * The grammar is RFC 4180 with the concessions every real file needs: bare
 * `LF` as well as `CRLF`, a leading byte order mark, and rows that are shorter
 * than their neighbours.
 */

export interface CsvOptions {
  /** Field separator. A single character. */
  readonly delimiter?: string;
}

export interface CsvWriteOptions extends CsvOptions {
  /** Line terminator. RFC 4180 says `CRLF`; most tools accept either. */
  readonly newline?: string;
}

const DEFAULT_DELIMITER = ",";
const BOM = "﻿";

/** Thrown when the text cannot be read as CSV at all. */
export class CsvError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} (at offset ${offset})`);
    this.name = "CsvError";
  }
}

/**
 * Parse CSV text into rows of fields.
 *
 * Empty input is zero rows, not one empty row. A trailing newline terminates
 * the last row rather than starting an empty one, because every writer emits
 * one and no reader should invent a row from it.
 */
export function parseCsv(text: string, options: CsvOptions = {}): string[][] {
  const delimiter = delimiterOf(options);
  const source = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  if (source === "") return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = "";
    started = true;
  };

  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  while (i < source.length) {
    const ch = source[i] as string;

    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      // A quote is only an opening quote at the start of a field. Anywhere
      // else it is a literal character, which is what `he said "no"` needs.
      if (field === "") {
        quoted = true;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === delimiter) {
      endField();
      i += 1;
      continue;
    }

    if (ch === "\r" || ch === "\n") {
      endRow();
      i += ch === "\r" && source[i + 1] === "\n" ? 2 : 1;
      continue;
    }

    field += ch;
    started = true;
    i += 1;
  }

  if (quoted) throw new CsvError("unterminated quoted field", source.length);
  if (field !== "" || started || row.length > 0) endRow();

  return rows;
}

/** Serialise rows to CSV, quoting only the fields that need it. */
export function formatCsv(
  rows: readonly (readonly string[])[],
  options: CsvWriteOptions = {},
): string {
  const delimiter = delimiterOf(options);
  const newline = options.newline ?? "\r\n";

  return rows
    .map((row) => row.map((field) => quoteField(field, delimiter)).join(delimiter))
    .join(newline);
}

/**
 * A field needs quoting when leaving it bare would change how it reads back:
 * it holds the delimiter, a quote, or a line break, or it has edge whitespace
 * that a lenient reader might trim.
 */
function quoteField(field: string, delimiter: string): string {
  const needsQuotes =
    field.includes(delimiter) ||
    field.includes('"') ||
    field.includes("\n") ||
    field.includes("\r") ||
    field !== field.trim();

  return needsQuotes ? `"${field.replace(/"/g, '""')}"` : field;
}

function delimiterOf(options: CsvOptions): string {
  const delimiter = options.delimiter ?? DEFAULT_DELIMITER;
  if (delimiter.length !== 1) {
    throw new CsvError("delimiter must be a single character", 0);
  }
  if (delimiter === '"' || delimiter === "\n" || delimiter === "\r") {
    throw new CsvError("delimiter must not be a quote or a line break", 0);
  }
  return delimiter;
}

// ------------------------------------------------------------------ sheet --

export interface ImportOptions {
  /** Top-left cell the first field lands in. Defaults to `A1`. */
  readonly origin?: string;
  /**
   * Whether a field starting with `=` becomes a formula.
   *
   * True by default, because that is what the text means in a spreadsheet.
   * Turn it off for data where a leading `=` is just a character.
   */
  readonly formulas?: boolean;
}

export interface ExportOptions {
  /** What to write for a cell holding a formula. */
  readonly mode?: "values" | "formulas";
  /** Region to write. Defaults to the sheet's used range. */
  readonly range?: RangeRef | string;
}

/** How many cells an import wrote, and where they landed. */
export interface ImportResult {
  readonly cells: number;
  readonly range: RangeRef | null;
}

/**
 * Write rows into a workbook, one field per cell.
 *
 * Empty fields clear their cell rather than storing an empty string, so
 * importing a ragged file does not leave a rectangle of invisible values that
 * `COUNTA` would then count.
 */
export function importRows(
  workbook: Workbook,
  rows: readonly (readonly string[])[],
  options: ImportOptions = {},
): ImportResult {
  const origin = parseA1(options.origin ?? "A1");
  const asFormulas = options.formulas ?? true;

  const entries: Record<string, string | null> = {};
  let count = 0;
  let maxCol = -1;
  let maxRow = -1;

  rows.forEach((row, rowOffset) => {
    row.forEach((field, colOffset) => {
      const coord: Coord = {
        row: origin.row + rowOffset,
        col: origin.col + colOffset,
      };
      const address = addressOf(coord);

      if (field === "") {
        entries[address] = null;
        return;
      }

      // With formulas off, a field that would otherwise be read as a formula
      // — or as an escape itself — is escaped so it lands as the text it is.
      const needsEscape =
        !asFormulas && (field.startsWith("=") || field.startsWith("'"));

      entries[address] = needsEscape ? `'${field}` : field;
      count += 1;
      if (colOffset > maxCol) maxCol = colOffset;
      if (rowOffset > maxRow) maxRow = rowOffset;
    });
  });

  workbook.setCells(entries);

  if (count === 0) return { cells: 0, range: null };

  return {
    cells: count,
    range: normalizeRange({
      start: { ...origin, colAbsolute: false, rowAbsolute: false },
      end: {
        col: origin.col + maxCol,
        row: origin.row + maxRow,
        colAbsolute: false,
        rowAbsolute: false,
      },
    }),
  };
}

/**
 * Read a region of a workbook out as rows.
 *
 * `values` writes what each cell shows, which is what another tool wants.
 * `formulas` writes what was typed, which is what a round trip wants — and the
 * two are only the same on a sheet with no formulas in it.
 */
export function exportRows(
  workbook: Workbook,
  options: ExportOptions = {},
): string[][] {
  const range = resolveRange(workbook, options.range);
  if (range === null) return [];

  const mode = options.mode ?? "values";
  const rows: string[][] = [];

  for (let row = range.start.row; row <= range.end.row; row += 1) {
    const line: string[] = [];
    for (let col = range.start.col; col <= range.end.col; col += 1) {
      const address = addressOf({ row, col });
      line.push(
        mode === "formulas"
          ? workbook.getInput(address)
          : formatValue(workbook.getValue(address)),
      );
    }
    rows.push(line);
  }

  return rows;
}

/** Read CSV text straight into a workbook. */
export function importCsv(
  workbook: Workbook,
  text: string,
  options: ImportOptions & CsvOptions = {},
): ImportResult {
  return importRows(workbook, parseCsv(text, options), options);
}

/** Write a workbook out as CSV text. */
export function exportCsv(
  workbook: Workbook,
  options: ExportOptions & CsvWriteOptions = {},
): string {
  return formatCsv(exportRows(workbook, options), options);
}

function resolveRange(
  workbook: Workbook,
  range: RangeRef | string | undefined,
): RangeRef | null {
  if (range === undefined) return workbook.extent();
  if (typeof range !== "string") return normalizeRange(range);

  const colon = range.indexOf(":");
  if (colon < 0) {
    const only = parseA1(range);
    return normalizeRange({ start: only, end: only });
  }
  return normalizeRange({
    start: parseA1(range.slice(0, colon)),
    end: parseA1(range.slice(colon + 1)),
  });
}

function addressOf(coord: Coord): string {
  return formatA1({ ...coord, colAbsolute: false, rowAbsolute: false });
}
