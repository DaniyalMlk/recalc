/**
 * Root finding for the rate functions.
 *
 * `IRR`, `XIRR` and `RATE` all reduce to "find the rate at which this present
 * value is zero", and none of them has a closed form. Newton's method is the
 * obvious choice and is fast when it works, but it walks off to infinity on
 * cash flows whose present-value curve is flat near the root or has a turning
 * point — which is exactly what a project with a late reversal looks like.
 *
 * So Newton is tried first, and a bracketing search takes over when it fails.
 * Bisection cannot diverge: once a sign change is found, the root is trapped,
 * and each step halves the interval. It is slower per iteration and cannot
 * miss.
 */

export interface SolveOptions {
  /** Starting point for Newton's method. */
  readonly guess?: number;
  /** Lowest rate to consider when bracketing. */
  readonly lower?: number;
  /** Highest rate to consider when bracketing. */
  readonly upper?: number;
  /** Absolute tolerance on the function value. */
  readonly tolerance?: number;
  /**
   * Cap on the iterations of *each* search: Newton's steps, and bisection's
   * halvings. It is not a cap on function evaluations, and it does not bound
   * the bracketing scan, which enumerates a fixed geometric grid whose length
   * follows from the bounds rather than from any convergence test.
   *
   * A budget too small to converge means no root, not a shorter answer:
   * bisection returns the midpoint of an interval it has not finished
   * narrowing, and that midpoint is not a root. Nor is a value that is not a
   * positive whole number a number of iterations, so `0`, `-3` and `2.5` are
   * refused the same way, by returning `null` — `solveRate` has one failure
   * channel and callers in the function layer turn it into `#NUM!`.
   */
  readonly maxIterations?: number;
}

const DEFAULTS = {
  guess: 0.1,
  // Below -1 the discount factors flip sign and the problem stops meaning
  // anything, so the search starts just above it.
  lower: -0.9999999,
  upper: 1e6,
  tolerance: 1e-10,
  maxIterations: 200,
};

/** Newton's method with a numerical derivative. Returns `null` if it fails. */
function newton(
  f: (x: number) => number,
  guess: number,
  tolerance: number,
  maxIterations: number,
  lower: number,
  upper: number,
): number | null {
  let x = guess;
  for (let i = 0; i < maxIterations; i++) {
    const fx = f(x);
    if (!Number.isFinite(fx)) return null;
    if (Math.abs(fx) < tolerance) return x;

    const h = Math.max(1e-7, Math.abs(x) * 1e-7);
    const derivative = (f(x + h) - f(x - h)) / (2 * h);
    if (!Number.isFinite(derivative) || derivative === 0) return null;

    const next = x - fx / derivative;
    if (!Number.isFinite(next) || next <= lower || next >= upper) return null;
    if (Math.abs(next - x) < 1e-14 * Math.max(1, Math.abs(x))) {
      return Math.abs(f(next)) < tolerance * 1e4 ? next : null;
    }
    x = next;
  }
  return null;
}

/** Scan for a sign change, then bisect. Returns `null` if none is found. */
function bracketAndBisect(
  f: (x: number) => number,
  lower: number,
  upper: number,
  tolerance: number,
  maxIterations: number,
): number | null {
  // Geometric scan: rates of interest cluster near zero but the search still
  // has to reach the far tail, and a linear scan fine enough for the first
  // would need millions of steps to cover the second.
  const points: number[] = [lower];
  for (let exponent = -6; exponent <= 6; exponent += 0.05) {
    const magnitude = Math.pow(10, exponent);
    if (-magnitude > lower) points.push(-magnitude);
  }
  points.push(0);
  for (let exponent = -6; exponent <= 6; exponent += 0.05) {
    const magnitude = Math.pow(10, exponent);
    if (magnitude < upper) points.push(magnitude);
  }
  points.push(upper);
  points.sort((a, b) => a - b);

  let previousX = points[0]!;
  let previousF = f(previousX);

  for (let i = 1; i < points.length; i++) {
    const x = points[i]!;
    const fx = f(x);
    if (!Number.isFinite(fx)) {
      previousX = x;
      previousF = fx;
      continue;
    }
    if (fx === 0) return x;
    if (Number.isFinite(previousF) && previousF * fx < 0) {
      return bisect(f, previousX, x, tolerance, maxIterations);
    }
    previousX = x;
    previousF = fx;
  }
  return null;
}

/**
 * Halve a bracket until the function value is within tolerance or the interval
 * is narrower than any answer could distinguish.
 *
 * Returns `null` when neither happens inside the budget. The old code returned
 * the midpoint regardless, which is the one thing a bisection must not do: a
 * midpoint of an interval still a hundredth wide is not a root, and handing it
 * back makes a search that ran out of allowance indistinguishable from one
 * that succeeded. The branch is unreachable at the default budget — the widest
 * bracket the scan can produce needs about seventy halvings and gets two
 * hundred — so only a caller tightening {@link SolveOptions.maxIterations}
 * ever sees it, which is exactly the case the option exists to serve.
 */
function bisect(
  f: (x: number) => number,
  low: number,
  high: number,
  tolerance: number,
  maxIterations: number,
): number | null {
  let a = low;
  let b = high;
  let fa = f(a);
  for (let i = 0; i < maxIterations; i++) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < tolerance || (b - a) / 2 < 1e-15) return mid;
    if (fa * fm < 0) {
      b = mid;
    } else {
      a = mid;
      fa = fm;
    }
  }
  return null;
}

/**
 * Find a rate `r` with `f(r) = 0`.
 *
 * Returns `null` when no root can be found, which callers turn into `#NUM!`.
 */
export function solveRate(
  f: (rate: number) => number,
  options: SolveOptions = {},
): number | null {
  const {
    guess = DEFAULTS.guess,
    lower = DEFAULTS.lower,
    upper = DEFAULTS.upper,
    tolerance = DEFAULTS.tolerance,
    maxIterations = DEFAULTS.maxIterations,
  } = options;

  if (!Number.isInteger(maxIterations) || maxIterations < 1) return null;

  const fromNewton = newton(f, guess, tolerance, maxIterations, lower, upper);
  if (fromNewton !== null) return fromNewton;

  return bracketAndBisect(f, lower, upper, tolerance, maxIterations);
}
