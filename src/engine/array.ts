import { VALUE_ERROR, err, isFormulaError } from "./errors.js";
import type { FormulaError } from "./errors.js";
import type { Value } from "./value.js";

/**
 * A rectangular block of values, produced by a formula rather than read from
 * the sheet.
 *
 * This is deliberately *not* a member of {@link Value}. A cell holds one value,
 * a format renders one value, and a comparison takes two values; widening
 * `Value` to include a block would push a shape parameter through every one of
 * those and buy nothing, because the sheet never stores a block in a cell
 * anyway — it spills it across several. So a matrix lives only between the
 * point a function returns it and the point the workbook lays it down.
 *
 * Values are row-major, and the length is exactly `rows * cols`: a ragged
 * matrix cannot be constructed.
 */
export interface Matrix {
  readonly type: "matrix";
  readonly rows: number;
  readonly cols: number;
  /** Row-major, `rows * cols` entries, blanks included as `null`. */
  readonly values: readonly Value[];
}

export function isMatrix(candidate: unknown): candidate is Matrix {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    (candidate as { type?: unknown }).type === "matrix"
  );
}

/** What a function is allowed to return: one value, or a block of them. */
export type CallResult = Value | Matrix;

export class MatrixShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatrixShapeError";
  }
}

/**
 * Build a matrix from row-major values.
 *
 * Throws when the value count does not match the shape. That is a programmer
 * error in a function definition, not a formula error, so it is an exception
 * rather than a `#VALUE!`.
 */
export function matrix(
  rows: number,
  cols: number,
  values: readonly Value[],
): Matrix {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 0 || cols < 0) {
    throw new MatrixShapeError(`invalid matrix shape ${rows}x${cols}`);
  }
  if (values.length !== rows * cols) {
    throw new MatrixShapeError(
      `matrix ${rows}x${cols} needs ${rows * cols} values, got ${values.length}`,
    );
  }
  return { type: "matrix", rows, cols, values };
}

/** Build a matrix from nested rows. Every row must be the same length. */
export function matrixOfRows(rows: readonly (readonly Value[])[]): Matrix {
  if (rows.length === 0) return matrix(0, 0, []);
  const width = rows[0]!.length;
  const flat: Value[] = [];
  for (const row of rows) {
    if (row.length !== width) {
      throw new MatrixShapeError("matrix rows have different lengths");
    }
    flat.push(...row);
  }
  return matrix(rows.length, width, flat);
}

/** A 1x1 matrix holding one value. */
export function scalarMatrix(value: Value): Matrix {
  return { type: "matrix", rows: 1, cols: 1, values: [value] };
}

/** Zero-based element access. Out-of-bounds reads are blank. */
export function elementAt(m: Matrix, row: number, col: number): Value {
  if (row < 0 || col < 0 || row >= m.rows || col >= m.cols) return null;
  return m.values[row * m.cols + col] ?? null;
}

/** The matrix as nested rows, for code that reads more clearly that way. */
export function toRows(m: Matrix): Value[][] {
  const out: Value[][] = [];
  for (let r = 0; r < m.rows; r++) {
    out.push(m.values.slice(r * m.cols, (r + 1) * m.cols) as Value[]);
  }
  return out;
}

export function isSingleCell(m: Matrix): boolean {
  return m.rows === 1 && m.cols === 1;
}

/** A 1x1 matrix collapses back to its value; anything larger stays a matrix. */
export function collapse(m: Matrix): CallResult {
  return isSingleCell(m) ? (m.values[0] ?? null) : m;
}

/** Rows become columns. */
export function transposeMatrix(m: Matrix): Matrix {
  const out: Value[] = new Array<Value>(m.rows * m.cols);
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      out[c * m.rows + r] = m.values[r * m.cols + c] ?? null;
    }
  }
  return matrix(m.cols, m.rows, out);
}

/**
 * The shape two operands combine into, or `null` when they do not combine.
 *
 * A dimension of one stretches to meet the other side, and any other mismatch
 * has no sensible answer. A 3x1 column against a 1x4 row therefore gives a 3x4
 * block — the outer-product shape — which is what makes a one-formula
 * sensitivity grid possible.
 */
export function broadcastShape(
  a: Matrix,
  b: Matrix,
): { rows: number; cols: number } | null {
  const rows = stretch(a.rows, b.rows);
  const cols = stretch(a.cols, b.cols);
  if (rows === null || cols === null) return null;
  return { rows, cols };
}

function stretch(a: number, b: number): number | null {
  if (a === b) return a;
  if (a === 1) return b;
  if (b === 1) return a;
  return null;
}

/**
 * Combine two matrices elementwise under the broadcast rule.
 *
 * Shapes that do not combine give one `#VALUE!` for the whole result rather
 * than a block padded with `#N/A`. The padding convention hides the mistake
 * inside a plausible-looking grid; a single error says what happened.
 */
export function broadcast(
  a: Matrix,
  b: Matrix,
  combine: (left: Value, right: Value) => Value,
): Matrix | FormulaError {
  const shape = broadcastShape(a, b);
  if (shape === null) {
    return err(
      "#VALUE!",
      `cannot combine a ${a.rows}x${a.cols} block with a ${b.rows}x${b.cols} block`,
    );
  }
  const { rows, cols } = shape;
  const out: Value[] = new Array<Value>(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const left = elementAt(a, a.rows === 1 ? 0 : r, a.cols === 1 ? 0 : c);
      const right = elementAt(b, b.rows === 1 ? 0 : r, b.cols === 1 ? 0 : c);
      out[r * cols + c] = combine(left, right);
    }
  }
  return matrix(rows, cols, out);
}

/** Apply a function to every element, keeping the shape. */
export function mapMatrix(
  m: Matrix,
  f: (value: Value) => Value,
): Matrix {
  return matrix(m.rows, m.cols, m.values.map(f));
}

/** First error anywhere in the block, or `null`. */
export function firstMatrixError(m: Matrix): FormulaError | null {
  for (const value of m.values) {
    if (isFormulaError(value)) return value;
  }
  return null;
}

/**
 * Read a matrix as a rectangular array of finite numbers.
 *
 * Every numeric routine that takes a block — matrix multiplication, inversion,
 * a least-squares fit — needs the same check, and needs it to fail the same
 * way, so it lives here rather than being written out five times.
 */
export function numericRows(m: Matrix): number[][] | FormulaError {
  const error = firstMatrixError(m);
  if (error !== null) return error;
  const out: number[][] = [];
  for (let r = 0; r < m.rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < m.cols; c++) {
      const value = m.values[r * m.cols + c] ?? null;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return VALUE_ERROR;
      }
      row.push(value);
    }
    out.push(row);
  }
  return out;
}

/** Build a matrix from rows of numbers. */
export function fromNumericRows(rows: readonly (readonly number[])[]): Matrix {
  return matrixOfRows(rows.map((row) => [...row]));
}
