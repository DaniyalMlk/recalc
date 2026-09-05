/**
 * Dense linear algebra, in the two decompositions the sheet actually needs.
 *
 * LU with partial pivoting answers the questions a spreadsheet asks directly —
 * a determinant, an inverse, the solution of a square system — and it is the
 * right tool for them: those functions are *defined* as those quantities, and
 * the caller wants the number, not a factorisation.
 *
 * Householder QR answers the fitting question, and it is a different tool on
 * purpose. A least-squares fit can be had from the normal equations in a few
 * lines, and the price is that it squares the condition number of the design
 * matrix: a regression on a column of years around 2000, or on any nearly
 * collinear pair of predictors, loses roughly twice the digits it needs to. QR
 * works on the design matrix itself and does not pay that.
 */

export type Rows = readonly (readonly number[])[];
export type MutableRows = number[][];

/** Spacing between 1 and the next representable double. */
const EPSILON = Number.EPSILON;

/**
 * How small a pivot has to be before the matrix counts as singular.
 *
 * Testing a pivot against exact zero is the wrong test. Elimination on
 * `[[1,2,3],[4,5,6],[7,8,9]]` — singular by inspection, its third row being the
 * second plus the difference of the first two — leaves a final pivot of about
 * 1e-16 rather than 0, so an exact test calls it invertible and then divides by
 * rounding error. The threshold instead scales with the size of the matrix and
 * the size of the numbers in it, which is what makes it mean the same thing for
 * a matrix of units and a matrix of millions. The factor of 8 is slack: real
 * pivots in a well-conditioned problem sit many orders of magnitude above this,
 * and the residue of a genuinely dependent column sits below it.
 */
function singularityTolerance(a: Rows): number {
  let max = 0;
  for (const row of a) {
    for (const value of row) {
      const magnitude = Math.abs(value);
      if (magnitude > max) max = magnitude;
    }
  }
  if (max === 0) return 0;
  const extent = Math.max(rowCount(a), colCount(a));
  return 8 * EPSILON * extent * max;
}

export function rowCount(a: Rows): number {
  return a.length;
}

export function colCount(a: Rows): number {
  return a[0]?.length ?? 0;
}

/** Whether every row is the same length. */
export function isRectangular(a: Rows): boolean {
  const width = colCount(a);
  return a.every((row) => row.length === width);
}

export function isSquare(a: Rows): boolean {
  return isRectangular(a) && rowCount(a) === colCount(a) && rowCount(a) > 0;
}

export function identity(n: number): MutableRows {
  const out: MutableRows = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n).fill(0);
    row[i] = 1;
    out.push(row);
  }
  return out;
}

export function transpose(a: Rows): MutableRows {
  const rows = rowCount(a);
  const cols = colCount(a);
  const out: MutableRows = [];
  for (let c = 0; c < cols; c++) {
    const row = new Array<number>(rows);
    for (let r = 0; r < rows; r++) row[r] = a[r]![c]!;
    out.push(row);
  }
  return out;
}

/** Matrix product, or `null` when the inner dimensions disagree. */
export function multiply(a: Rows, b: Rows): MutableRows | null {
  const inner = colCount(a);
  if (inner !== rowCount(b)) return null;
  const rows = rowCount(a);
  const cols = colCount(b);
  const out: MutableRows = [];
  for (let i = 0; i < rows; i++) {
    const arow = a[i]!;
    const row = new Array<number>(cols).fill(0);
    for (let k = 0; k < inner; k++) {
      const factor = arow[k]!;
      if (factor === 0) continue;
      const brow = b[k]!;
      for (let j = 0; j < cols; j++) row[j] = row[j]! + factor * brow[j]!;
    }
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// LU with partial pivoting
// ---------------------------------------------------------------------------

export interface LU {
  /** Combined factors: `L` below the diagonal, `U` on and above it. */
  readonly lu: MutableRows;
  /** Row `i` of the factorisation is row `perm[i]` of the input. */
  readonly perm: number[];
  /** `+1` or `-1`, the sign the row swaps contributed to the determinant. */
  readonly sign: number;
  /** True when a pivot came out at zero: the matrix is singular. */
  readonly singular: boolean;
}

/**
 * Factor a square matrix, choosing the largest available pivot each step.
 *
 * Pivoting is not optional here. Without it a perfectly well-conditioned
 * matrix with a zero in the corner fails outright, and one with a merely small
 * corner returns an answer with most of its digits gone.
 */
export function decompose(a: Rows): LU {
  const n = rowCount(a);
  const tolerance = singularityTolerance(a);
  const lu: MutableRows = a.map((row) => [...row]);
  const perm = Array.from({ length: n }, (_, i) => i);
  let sign = 1;
  let singular = false;

  for (let k = 0; k < n; k++) {
    let pivotRow = k;
    let best = Math.abs(lu[k]![k]!);
    for (let i = k + 1; i < n; i++) {
      const candidate = Math.abs(lu[i]![k]!);
      if (candidate > best) {
        best = candidate;
        pivotRow = i;
      }
    }

    if (best <= tolerance) {
      singular = true;
      continue;
    }

    if (pivotRow !== k) {
      const tmp = lu[k]!;
      lu[k] = lu[pivotRow]!;
      lu[pivotRow] = tmp;
      const t = perm[k]!;
      perm[k] = perm[pivotRow]!;
      perm[pivotRow] = t;
      sign = -sign;
    }

    const pivot = lu[k]![k]!;
    for (let i = k + 1; i < n; i++) {
      const factor = lu[i]![k]! / pivot;
      lu[i]![k] = factor;
      if (factor === 0) continue;
      for (let j = k + 1; j < n; j++) {
        lu[i]![j] = lu[i]![j]! - factor * lu[k]![j]!;
      }
    }
  }

  return { lu, perm, sign, singular };
}

/** Determinant of a square matrix. Singular gives exactly zero. */
export function determinant(a: Rows): number {
  const n = rowCount(a);
  if (n === 0) return 0;
  const { lu, sign, singular } = decompose(a);
  if (singular) return 0;
  let product = sign;
  for (let i = 0; i < n; i++) product *= lu[i]![i]!;
  return product;
}

/**
 * Solve `A x = b` for one or more right-hand sides, or `null` if `A` is
 * singular. `b` is given with one column per right-hand side.
 */
export function solve(a: Rows, b: Rows): MutableRows | null {
  const n = rowCount(a);
  const factored = decompose(a);
  if (factored.singular) return null;
  const { lu, perm } = factored;
  const width = colCount(b);

  // Permute the right-hand sides the same way the rows were permuted.
  const x: MutableRows = [];
  for (let i = 0; i < n; i++) x.push([...b[perm[i]!]!]);

  // Forward substitution through L, whose diagonal is an implicit 1.
  for (let i = 1; i < n; i++) {
    for (let k = 0; k < i; k++) {
      const factor = lu[i]![k]!;
      if (factor === 0) continue;
      for (let j = 0; j < width; j++) {
        x[i]![j] = x[i]![j]! - factor * x[k]![j]!;
      }
    }
  }

  // Back substitution through U.
  for (let i = n - 1; i >= 0; i--) {
    for (let k = i + 1; k < n; k++) {
      const factor = lu[i]![k]!;
      if (factor === 0) continue;
      for (let j = 0; j < width; j++) {
        x[i]![j] = x[i]![j]! - factor * x[k]![j]!;
      }
    }
    const pivot = lu[i]![i]!;
    for (let j = 0; j < width; j++) x[i]![j] = x[i]![j]! / pivot;
  }

  return x;
}

/** Inverse of a square matrix, or `null` when it is singular. */
export function invert(a: Rows): MutableRows | null {
  return solve(a, identity(rowCount(a)));
}

// ---------------------------------------------------------------------------
// Householder QR and least squares
// ---------------------------------------------------------------------------

export interface QR {
  /** `R`, upper triangular, `cols` by `cols`. */
  readonly r: MutableRows;
  /** `Q^T y` for the y that was supplied, or `null` if none was. */
  readonly qty: number[] | null;
  /** True when a column turned out to be dependent on the ones before it. */
  readonly rankDeficient: boolean;
}

/**
 * Householder QR of a tall matrix, applying the reflections to `y` as it goes.
 *
 * `Q` is never formed. Every use here — the fitted coefficients, the residual
 * sum of squares, the standard errors — needs only `R` and `Q^T y`, and both
 * come out of the same sweep. Building the full `Q` would cost more memory
 * than the problem does and would be thrown away immediately.
 */
export function qrFactor(a: Rows, y: readonly number[]): QR {
  const m = rowCount(a);
  const n = colCount(a);
  const tolerance = singularityTolerance(a);
  const work: MutableRows = a.map((row) => [...row]);
  const rhs = [...y];
  let rankDeficient = false;

  for (let k = 0; k < n; k++) {
    // The Householder vector that zeroes column k below the diagonal.
    let norm = 0;
    for (let i = k; i < m; i++) norm += work[i]![k]! * work[i]![k]!;
    norm = Math.sqrt(norm);
    if (norm <= tolerance) {
      rankDeficient = true;
      continue;
    }

    // Reflect away from the current entry rather than towards it: choosing the
    // same sign as the pivot avoids subtracting two nearly equal numbers, which
    // is the one place this algorithm can lose its accuracy.
    const alpha = work[k]![k]! >= 0 ? -norm : norm;
    const v = new Array<number>(m).fill(0);
    for (let i = k; i < m; i++) v[i] = work[i]![k]!;
    v[k] = v[k]! - alpha;

    let vnorm = 0;
    for (let i = k; i < m; i++) vnorm += v[i]! * v[i]!;
    if (vnorm === 0) {
      rankDeficient = true;
      continue;
    }

    for (let j = k; j < n; j++) {
      let dot = 0;
      for (let i = k; i < m; i++) dot += v[i]! * work[i]![j]!;
      const scale = (2 * dot) / vnorm;
      for (let i = k; i < m; i++) work[i]![j] = work[i]![j]! - scale * v[i]!;
    }

    let dotY = 0;
    for (let i = k; i < m; i++) dotY += v[i]! * rhs[i]!;
    const scaleY = (2 * dotY) / vnorm;
    for (let i = k; i < m; i++) rhs[i] = rhs[i]! - scaleY * v[i]!;
  }

  const r: MutableRows = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n).fill(0);
    for (let j = i; j < n; j++) row[j] = work[i]![j]!;
    r.push(row);
  }
  for (let i = 0; i < n; i++) {
    if (Math.abs(r[i]![i]!) <= tolerance) rankDeficient = true;
  }

  return { r, qty: rhs.slice(0, n), rankDeficient };
}

/** Solve `R x = b` for upper-triangular `R`, or `null` if a pivot is zero. */
export function backSubstitute(
  r: Rows,
  b: readonly number[],
): number[] | null {
  const n = rowCount(r);
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i]!;
    for (let j = i + 1; j < n; j++) sum -= r[i]![j]! * x[j]!;
    const pivot = r[i]![i]!;
    if (pivot === 0) return null;
    x[i] = sum / pivot;
  }
  return x;
}

/** Inverse of an upper-triangular matrix, or `null` if it is singular. */
export function invertUpper(r: Rows): MutableRows | null {
  const n = rowCount(r);
  const inv = identity(n);
  for (let col = 0; col < n; col++) {
    const column = new Array<number>(n);
    for (let i = 0; i < n; i++) column[i] = inv[i]![col]!;
    const solved = backSubstitute(r, column);
    if (solved === null) return null;
    for (let i = 0; i < n; i++) inv[i]![col] = solved[i]!;
  }
  return inv;
}

export interface Fit {
  /** One coefficient per column of the design matrix, in column order. */
  readonly coefficients: number[];
  /** `y` minus the fitted values. */
  readonly residuals: number[];
  /** Sum of the squared residuals. */
  readonly ssResidual: number;
  /**
   * Diagonal of `(X^T X)^-1`, which is what turns the residual variance into a
   * standard error per coefficient. Read off `R^-1` rather than by forming and
   * inverting `X^T X`, for the same reason the fit itself uses QR.
   */
  readonly variance: number[];
}

/** Least-squares fit of `design x = y`, or `null` when the columns are dependent. */
export function leastSquares(design: Rows, y: readonly number[]): Fit | null {
  const m = rowCount(design);
  const n = colCount(design);
  if (m === 0 || n === 0 || y.length !== m) return null;

  const { r, qty, rankDeficient } = qrFactor(design, y);
  if (rankDeficient || qty === null) return null;

  const coefficients = backSubstitute(r, qty);
  if (coefficients === null) return null;

  const residuals = new Array<number>(m).fill(0);
  let ssResidual = 0;
  for (let i = 0; i < m; i++) {
    let fitted = 0;
    for (let j = 0; j < n; j++) fitted += design[i]![j]! * coefficients[j]!;
    const residual = y[i]! - fitted;
    residuals[i] = residual;
    ssResidual += residual * residual;
  }

  const rInv = invertUpper(r);
  if (rInv === null) return null;
  const variance = new Array<number>(n).fill(0);
  for (let j = 0; j < n; j++) {
    let sum = 0;
    for (let i = j; i < n; i++) sum += rInv[j]![i]! * rInv[j]![i]!;
    variance[j] = sum;
  }

  return { coefficients, residuals, ssResidual, variance };
}
