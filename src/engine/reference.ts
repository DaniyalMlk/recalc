/**
 * The A1 reference model.
 *
 * Coordinates are zero-based internally: `A1` is `{ col: 0, row: 0 }`. The
 * absolute flags are stored independently of the coordinates, which is what
 * makes translation (fill-down, fill-across) a pure arithmetic operation and
 * lets `B7`, `$B7` and `B$7` collapse to a single dependency-graph node.
 */

/** Number of addressable columns, matching the conventional sheet limit. */
export const MAX_COLUMNS = 16384;
/** Number of addressable rows, matching the conventional sheet limit. */
export const MAX_ROWS = 1048576;

export interface Coord {
  readonly col: number;
  readonly row: number;
}

export interface CellRef extends Coord {
  readonly colAbsolute: boolean;
  readonly rowAbsolute: boolean;
}

export interface RangeRef {
  readonly start: CellRef;
  readonly end: CellRef;
}

const A_CODE = 65;
const LETTERS = 26;

export class ReferenceError_ extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceError";
  }
}

/** `0 -> "A"`, `25 -> "Z"`, `26 -> "AA"`, `702 -> "AAA"`. */
export function columnToLabel(col: number): string {
  if (!Number.isInteger(col) || col < 0 || col >= MAX_COLUMNS) {
    throw new ReferenceError_(`column index out of range: ${col}`);
  }
  let n = col;
  let out = "";
  // Bijective base-26: there is no zero digit, so borrow one on each step.
  while (n >= 0) {
    out = String.fromCharCode(A_CODE + (n % LETTERS)) + out;
    n = Math.floor(n / LETTERS) - 1;
  }
  return out;
}

/** Inverse of {@link columnToLabel}. Case-insensitive. */
export function labelToColumn(label: string): number {
  if (label.length === 0) {
    throw new ReferenceError_("empty column label");
  }
  let n = 0;
  for (let i = 0; i < label.length; i++) {
    const code = label.charCodeAt(i) & ~0x20; // fold to upper case
    if (code < A_CODE || code > A_CODE + LETTERS - 1) {
      throw new ReferenceError_(`invalid column label: ${label}`);
    }
    n = n * LETTERS + (code - A_CODE + 1);
  }
  const col = n - 1;
  if (col >= MAX_COLUMNS) {
    throw new ReferenceError_(`column label out of range: ${label}`);
  }
  return col;
}

export function makeRef(
  col: number,
  row: number,
  colAbsolute = false,
  rowAbsolute = false,
): CellRef {
  return { col, row, colAbsolute, rowAbsolute };
}

const A1_PATTERN = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})$/;

/** Parse `A1`, `$A1`, `A$1` or `$A$1` into a {@link CellRef}. */
export function parseA1(text: string): CellRef {
  const m = A1_PATTERN.exec(text);
  if (!m) {
    throw new ReferenceError_(`not an A1 reference: ${text}`);
  }
  const [, colDollar, letters, rowDollar, digits] = m as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  const rowNumber = Number(digits);
  if (rowNumber < 1 || rowNumber > MAX_ROWS) {
    throw new ReferenceError_(`row out of range: ${text}`);
  }
  return {
    col: labelToColumn(letters),
    row: rowNumber - 1,
    colAbsolute: colDollar === "$",
    rowAbsolute: rowDollar === "$",
  };
}

/** Render a {@link CellRef} back to A1 notation, preserving anchors. */
export function formatA1(ref: CellRef): string {
  const col = `${ref.colAbsolute ? "$" : ""}${columnToLabel(ref.col)}`;
  const row = `${ref.rowAbsolute ? "$" : ""}${ref.row + 1}`;
  return col + row;
}

/**
 * A stable identity for a coordinate, ignoring anchors. Two references that
 * point at the same cell always produce the same key.
 */
export function cellKey(coord: Coord): string {
  return `${coord.col}:${coord.row}`;
}

export function parseCellKey(key: string): Coord {
  const idx = key.indexOf(":");
  if (idx < 0) throw new ReferenceError_(`malformed cell key: ${key}`);
  const col = Number(key.slice(0, idx));
  const row = Number(key.slice(idx + 1));
  if (!Number.isInteger(col) || !Number.isInteger(row)) {
    throw new ReferenceError_(`malformed cell key: ${key}`);
  }
  return { col, row };
}

export function sameCell(a: Coord, b: Coord): boolean {
  return a.col === b.col && a.row === b.row;
}

/**
 * Put a range into canonical top-left / bottom-right order.
 *
 * Columns and rows are ordered independently, and each anchor flag travels
 * with the coordinate it belongs to, so `$C5:A$1` normalises to `A5:$C$1`'s
 * coordinates with the `$` still attached to the column that carried it.
 */
export function normalizeRange(range: RangeRef): RangeRef {
  const { start, end } = range;
  const [minCol, maxCol] =
    start.col <= end.col
      ? [
          { col: start.col, abs: start.colAbsolute },
          { col: end.col, abs: end.colAbsolute },
        ]
      : [
          { col: end.col, abs: end.colAbsolute },
          { col: start.col, abs: start.colAbsolute },
        ];
  const [minRow, maxRow] =
    start.row <= end.row
      ? [
          { row: start.row, abs: start.rowAbsolute },
          { row: end.row, abs: end.rowAbsolute },
        ]
      : [
          { row: end.row, abs: end.rowAbsolute },
          { row: start.row, abs: start.rowAbsolute },
        ];
  return {
    start: makeRef(minCol.col, minRow.row, minCol.abs, minRow.abs),
    end: makeRef(maxCol.col, maxRow.row, maxCol.abs, maxRow.abs),
  };
}

export function rangeContains(range: RangeRef, coord: Coord): boolean {
  const r = normalizeRange(range);
  return (
    coord.col >= r.start.col &&
    coord.col <= r.end.col &&
    coord.row >= r.start.row &&
    coord.row <= r.end.row
  );
}

/** Cell count of a range. */
export function rangeSize(range: RangeRef): number {
  const r = normalizeRange(range);
  return (r.end.col - r.start.col + 1) * (r.end.row - r.start.row + 1);
}

/** Iterate a range in row-major order. */
export function* iterateRange(range: RangeRef): Generator<Coord> {
  const r = normalizeRange(range);
  for (let row = r.start.row; row <= r.end.row; row++) {
    for (let col = r.start.col; col <= r.end.col; col++) {
      yield { col, row };
    }
  }
}

/**
 * Parse `A1:C9` into a normalised range.
 *
 * A single address is accepted and read as the one-cell range covering it, so
 * callers that take "a block" do not need a second code path for the case where
 * the block happens to be one cell.
 */
export function parseA1Range(text: string): RangeRef {
  const trimmed = text.trim();
  const colon = trimmed.indexOf(":");
  if (colon < 0) {
    const ref = parseA1(trimmed);
    return { start: ref, end: ref };
  }
  return normalizeRange({
    start: parseA1(trimmed.slice(0, colon)),
    end: parseA1(trimmed.slice(colon + 1)),
  });
}

export function formatRange(range: RangeRef): string {
  return `${formatA1(range.start)}:${formatA1(range.end)}`;
}

/**
 * Shift a reference by a delta, moving only the axes that are not anchored.
 *
 * Returns `null` when the shift pushes the reference off the sheet — the
 * caller turns that into `#REF!`.
 */
export function translateRef(
  ref: CellRef,
  deltaCol: number,
  deltaRow: number,
): CellRef | null {
  const col = ref.colAbsolute ? ref.col : ref.col + deltaCol;
  const row = ref.rowAbsolute ? ref.row : ref.row + deltaRow;
  if (col < 0 || col >= MAX_COLUMNS || row < 0 || row >= MAX_ROWS) {
    return null;
  }
  return { col, row, colAbsolute: ref.colAbsolute, rowAbsolute: ref.rowAbsolute };
}

/** Translate both corners of a range; `null` if either corner falls off. */
export function translateRange(
  range: RangeRef,
  deltaCol: number,
  deltaRow: number,
): RangeRef | null {
  const start = translateRef(range.start, deltaCol, deltaRow);
  if (start === null) return null;
  const end = translateRef(range.end, deltaCol, deltaRow);
  if (end === null) return null;
  return { start, end };
}
