/**
 * A root finder for an arbitrary, unknown function.
 *
 * `functions/solver.ts` already finds roots, but it knows what it is looking
 * for: a discount rate, somewhere just above -1, clustered near zero, and it
 * scans geometrically on that assumption. Goal seek has no such luxury. The
 * unknown might be a unit price near 40, a headcount near 12, a growth rate
 * near 0.03 or a loan balance near 8,000,000, and a search tuned for one of
 * those is useless for the others.
 *
 * So the search here is *scale-aware*: every step is measured relative to the
 * starting point rather than in absolute units, which is the only way one
 * routine covers all four. The strategy is the usual three-part one:
 *
 * 1. **Secant.** Two points, a straight line through them, jump to where that
 *    line crosses zero. Superlinear when it works and needs no derivative,
 *    which matters here because each evaluation is a recalculation of a
 *    spreadsheet and there is no analytic derivative to be had.
 * 2. **Expanding bracket.** Secant diverges on a flat or turning curve. When
 *    it does, step outward from the start in growing multiples until the
 *    function changes sign.
 * 3. **Bisection.** Once a sign change is trapped, halving cannot fail. It is
 *    slow and it always arrives.
 *
 * The function is allowed to return a non-finite number: a spreadsheet cell
 * can hold `#DIV/0!` at some inputs and a number at others, and a search that
 * gave up at the first error would fail on any model with a divide in it.
 * Non-finite points are treated as holes to step over.
 */

/** Why a search stopped. */
export type SolveFailure =
  /** The value never came within tolerance of the target. */
  | "no-convergence"
  /** Every point tried produced an error or a non-finite value. */
  | "not-numeric"
  /** No sign change was found anywhere in the searched interval. */
  | "no-bracket";

export interface SolveOutcome {
  readonly converged: boolean;
  /** The best input found, whether or not it converged. */
  readonly x: number;
  /** The function's value there. */
  readonly fx: number;
  /** How many times the function was called. */
  readonly evaluations: number;
  readonly failure?: SolveFailure;
}

export interface RootOptions {
  /** Where to start. Usually the value the cell already holds. */
  readonly start?: number;
  /** Absolute tolerance on the function value. */
  readonly tolerance?: number;
  /** Cap on function evaluations across all three strategies. */
  readonly maxEvaluations?: number;
  /** Hard lower bound on the input, if the caller knows one. */
  readonly lower?: number;
  /** Hard upper bound on the input. */
  readonly upper?: number;
}

const DEFAULT_TOLERANCE = 1e-9;
const DEFAULT_MAX_EVALUATIONS = 400;

/**
 * A step that means something at this scale.
 *
 * Solving for a price near 40 wants a first step of about 0.04; solving for a
 * rate near 0.03 wants about 0.00003. Both fall out of the same rule. A start
 * at exactly zero has no scale of its own, so it borrows one.
 */
export function scaleStep(start: number): number {
  const magnitude = Math.abs(start);
  return magnitude < 1e-8 ? 1e-4 : magnitude * 1e-3;
}

/** Wrap `f` so it counts its calls and clamps to the allowed interval. */
class Counter {
  evaluations = 0;

  constructor(
    private readonly f: (x: number) => number,
    private readonly limit: number,
    private readonly lower: number,
    private readonly upper: number,
  ) {}

  get exhausted(): boolean {
    return this.evaluations >= this.limit;
  }

  inBounds(x: number): boolean {
    return x >= this.lower && x <= this.upper;
  }

  /** `NaN` for a point outside the bounds or past the evaluation budget. */
  at(x: number): number {
    if (!this.inBounds(x) || this.exhausted) return Number.NaN;
    this.evaluations++;
    const value = this.f(x);
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : Number.NaN;
  }
}

/**
 * Find `x` with `f(x) = 0`.
 *
 * The result always carries the best point seen, so a caller can show how
 * close a failed search got — which is often the useful part of the answer,
 * because "it reached 0.4% and stalled" and "it never got anywhere" call for
 * different responses from whoever asked.
 */
export function findRoot(
  f: (x: number) => number,
  options: RootOptions = {},
): SolveOutcome {
  const {
    start = 0,
    tolerance = DEFAULT_TOLERANCE,
    maxEvaluations = DEFAULT_MAX_EVALUATIONS,
    lower = -Number.MAX_VALUE,
    upper = Number.MAX_VALUE,
  } = options;

  const counter = new Counter(f, maxEvaluations, lower, upper);
  const best = { x: start, fx: Number.POSITIVE_INFINITY };
  let anyNumeric = false;

  const consider = (x: number, fx: number): boolean => {
    if (Number.isNaN(fx)) return false;
    anyNumeric = true;
    if (Math.abs(fx) < Math.abs(best.fx)) {
      best.x = x;
      best.fx = fx;
    }
    return Math.abs(fx) <= tolerance;
  };

  const done = (failure?: SolveFailure): SolveOutcome => ({
    converged: failure === undefined,
    x: best.x,
    fx: Number.isFinite(best.fx) ? best.fx : Number.NaN,
    evaluations: counter.evaluations,
    ...(failure === undefined ? {} : { failure }),
  });

  const step = scaleStep(start);
  const f0 = counter.at(start);
  if (consider(start, f0)) return done();

  const secant = trySecant(counter, consider, start, f0, step, tolerance);
  if (secant) return done();

  const bracket = findBracket(counter, consider, start, step);
  if (bracket === null) {
    if (!anyNumeric) return done("not-numeric");
    return done(counter.exhausted ? "no-convergence" : "no-bracket");
  }

  if (bisect(counter, consider, bracket, tolerance)) return done();
  return done("no-convergence");
}

/** A sign-changing interval, with the function's value at each end. */
interface Bracket {
  a: number;
  fa: number;
  b: number;
  fb: number;
}

/**
 * The secant method, starting from `start` and one step to its right.
 *
 * The guards are what keep it from wandering: a near-zero slope means the line
 * through the two points crosses zero somewhere absurd, and a jump of more
 * than a factor of a million past the current scale is not a refinement of
 * anything. In both cases it is cheaper to hand over to bracketing than to
 * follow the tangent into the distance.
 */
function trySecant(
  counter: Counter,
  consider: (x: number, fx: number) => boolean,
  start: number,
  f0: number,
  step: number,
  tolerance: number,
): boolean {
  let x0 = start;
  let y0 = f0;
  let x1 = start + step;
  let y1 = counter.at(x1);

  // A hole immediately to the right — an error at that input — leaves nothing
  // to draw a line through, so try the other side before giving up on secant.
  if (Number.isNaN(y1)) {
    x1 = start - step;
    y1 = counter.at(x1);
  }
  if (Number.isNaN(y0) || Number.isNaN(y1)) return false;
  if (consider(x1, y1)) return true;

  const limit = Math.max(Math.abs(start), 1) * 1e6;

  for (let i = 0; i < 60 && !counter.exhausted; i++) {
    const slope = (y1 - y0) / (x1 - x0);
    if (!Number.isFinite(slope) || Math.abs(slope) < 1e-300) return false;

    const next = x1 - y1 / slope;
    if (!Number.isFinite(next) || Math.abs(next) > limit) return false;
    if (!counter.inBounds(next)) return false;

    const value = counter.at(next);
    if (Number.isNaN(value)) return false;
    if (consider(next, value)) return true;

    // Converged in x but not in f: the curve is flat here and the target is
    // not on it. Bracketing will not do better, so stop rather than spin.
    if (Math.abs(next - x1) <= 1e-14 * Math.max(1, Math.abs(next))) {
      return Math.abs(value) <= tolerance;
    }

    x0 = x1;
    y0 = y1;
    x1 = next;
    y1 = value;
  }
  return false;
}

/**
 * Step outward from `start` until the function changes sign.
 *
 * Both directions are walked together, in geometrically growing steps, so a
 * root to the left is found as quickly as one to the right. Growing by 1.6
 * each time reaches a factor of ten thousand in about twenty steps while
 * still placing enough points near the start to catch a nearby root.
 */
function findBracket(
  counter: Counter,
  consider: (x: number, fx: number) => boolean,
  start: number,
  step: number,
): Bracket | null {
  let left = start;
  let fLeft = counter.at(start);
  let right = start;
  let fRight = fLeft;
  let width = step;

  for (let i = 0; i < 90 && !counter.exhausted; i++) {
    const nextRight = start + width;
    const fNextRight = counter.at(nextRight);
    if (!Number.isNaN(fNextRight)) {
      if (consider(nextRight, fNextRight)) {
        return { a: nextRight, fa: 0, b: nextRight, fb: 0 };
      }
      if (!Number.isNaN(fRight) && fRight * fNextRight < 0) {
        return { a: right, fa: fRight, b: nextRight, fb: fNextRight };
      }
      right = nextRight;
      fRight = fNextRight;
    }

    const nextLeft = start - width;
    const fNextLeft = counter.at(nextLeft);
    if (!Number.isNaN(fNextLeft)) {
      if (consider(nextLeft, fNextLeft)) {
        return { a: nextLeft, fa: 0, b: nextLeft, fb: 0 };
      }
      if (!Number.isNaN(fLeft) && fLeft * fNextLeft < 0) {
        return { a: nextLeft, fa: fNextLeft, b: left, fb: fLeft };
      }
      left = nextLeft;
      fLeft = fNextLeft;
    }

    width *= 1.6;
  }
  return null;
}

/**
 * Halve a bracketed interval until the value is within tolerance.
 *
 * A hole in the middle of the interval is stepped around by nudging the
 * midpoint: the bracket is still valid, only that one point is unusable.
 */
function bisect(
  counter: Counter,
  consider: (x: number, fx: number) => boolean,
  bracket: Bracket,
  tolerance: number,
): boolean {
  let { a, fa, b, fb } = bracket;
  if (a === b) return Math.abs(fa) <= tolerance;

  for (let i = 0; i < 200 && !counter.exhausted; i++) {
    let mid = (a + b) / 2;
    let fMid = counter.at(mid);

    if (Number.isNaN(fMid)) {
      mid = a + (b - a) * 0.25;
      fMid = counter.at(mid);
      if (Number.isNaN(fMid)) return false;
    }

    if (consider(mid, fMid)) return true;
    // The interval has collapsed to the limit of the representation and the
    // value is still outside tolerance: the root is a jump, not a crossing.
    if (Math.abs(b - a) <= 1e-15 * Math.max(1, Math.abs(mid))) return false;

    if (fa * fMid < 0) {
      b = mid;
      fb = fMid;
    } else {
      a = mid;
      fa = fMid;
    }
  }
  return false;
}
