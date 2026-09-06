/**
 * The distribution families, each expressed through the special functions
 * rather than approximated on its own.
 *
 * Nothing here does any numerical work of its own beyond arranging arguments:
 * a chi-squared cumulative *is* `P(k/2, x/2)`, an F cumulative *is* an
 * incomplete beta at a transformed argument, and writing them that way is what
 * makes the relationships between the families hold to the last bit rather
 * than to the accuracy of two independent fits. `T.DIST` with a million
 * degrees of freedom really does agree with `NORM.S.DIST`, and `F.DIST(x, 1,
 * v)` really is the square of a t, because both sides are the same integral.
 *
 * Densities are computed in logs and exponentiated once. A binomial density at
 * `n = 1000` is a colossal coefficient multiplied by two vanishing powers, and
 * every ordering of that product in value space overflows or underflows on the
 * way to an answer near 0.02.
 */

import {
  bracketAbove,
  erfc,
  gammaP,
  gammaQ,
  incompleteBeta,
  invertMonotone,
  lnBeta,
  lnChoose,
  lnFactorial,
  lnGamma,
} from "./special.js";

const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);

// ---------------------------------------------------------------------------
// Normal
// ---------------------------------------------------------------------------

export function normalPdf(x: number, mean: number, sd: number): number {
  if (sd <= 0) return Number.NaN;
  const z = (x - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * SQRT_TWO_PI);
}

/**
 * The normal cumulative, written on `erfc` of the *negative* argument.
 *
 * `0.5 * (1 + erf(z / sqrt 2))` is the form usually quoted and it is wrong in
 * the left tail: for `z = -8` the true probability is 6e-16, and that
 * expression computes it as the difference of two numbers near one, keeping
 * about one digit. Feeding `-z` to `erfc` keeps the small number small all the
 * way through.
 */
export function normalCdf(x: number, mean: number, sd: number): number {
  if (sd <= 0) return Number.NaN;
  return 0.5 * erfc(-(x - mean) / (sd * Math.SQRT2));
}

/**
 * Acklam's rational approximation to the standard normal quantile.
 *
 * Good to about 1.15e-9 relative on its own, which is not enough, but it is a
 * seed that never needs bracketing and is close enough that one Halley step
 * lands on the correctly rounded answer.
 */
function acklam(p: number): number {
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      ((((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
        c[5]!) /
        ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1))
    );
  }
  if (p > 1 - low) return -acklam(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) *
    q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

/**
 * The standard normal quantile, to the last bit a double holds.
 *
 * One Halley step on the seed, which triples the correct digits and so takes
 * 1e-9 past 1e-15 in a single evaluation. Far enough into the tail the step
 * cannot be taken at all — it multiplies by `exp(z^2 / 2)`, which overflows
 * past about `z = -37` even though the product it appears in is small — and
 * there the seed is polished by bisection instead.
 */
export function standardNormalInv(p: number): number {
  if (Number.isNaN(p)) return Number.NaN;
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  if (p === 0.5) return 0;
  const seed = acklam(p);
  const error = 0.5 * erfc(-seed / Math.SQRT2) - p;
  const u = error * SQRT_TWO_PI * Math.exp((seed * seed) / 2);
  const refined = seed - u / (1 + (seed * u) / 2);
  if (Number.isFinite(refined)) return refined;
  return invertMonotone(
    (x) => 0.5 * erfc(-x / Math.SQRT2),
    p,
    seed - 1,
    seed + 1,
  );
}

export function normalInv(p: number, mean: number, sd: number): number {
  if (sd <= 0) return Number.NaN;
  return mean + sd * standardNormalInv(p);
}

// ---------------------------------------------------------------------------
// A shared quantile routine for the families with unbounded support
// ---------------------------------------------------------------------------

/**
 * The quantile of a cumulative supported on `[floor, infinity)`.
 *
 * The bracket is grown from a guess rather than fixed, because no fixed upper
 * bound is right for every parameter: the 99th percentile of a chi-squared on
 * two degrees of freedom is 9, and on a million degrees of freedom it is over
 * a million.
 */
function quantileAbove(
  cdf: (x: number) => number,
  p: number,
  guess: number,
  floor = 0,
): number {
  if (Number.isNaN(p)) return Number.NaN;
  if (p <= 0) return floor;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  const [lo, hi] = bracketAbove(cdf, p, guess, floor);
  return invertMonotone(cdf, p, lo, hi);
}

/**
 * The point whose *upper* tail is `p`, inverted against the tail itself.
 *
 * The obvious implementation of a right-tail quantile is `quantile(1 - p)`,
 * and it throws away most of the answer whenever `p` is small. `1 - 1e-10` is
 * a double whose distance from the true value is about 1e-17; asking for the
 * quantile of that number asks for a tail of `1e-10 +/- 1e-17`, which is seven
 * digits, not sixteen. Inverting the survival function keeps `p` as the small
 * number it is, and the reflection never happens.
 *
 * Negated because the tail decreases where the bracketing helpers expect an
 * increase; the sign is the whole of the adaptation.
 */
function quantileFromTail(
  sf: (x: number) => number,
  p: number,
  guess: number,
  floor = 0,
): number {
  if (Number.isNaN(p)) return Number.NaN;
  if (p <= 0) return Number.POSITIVE_INFINITY;
  if (p >= 1) return floor;
  const rising = (x: number) => -sf(x);
  const [lo, hi] = bracketAbove(rising, -p, guess, floor);
  return invertMonotone(rising, -p, lo, hi);
}

// ---------------------------------------------------------------------------
// Chi-squared
// ---------------------------------------------------------------------------

export function chiSquaredPdf(x: number, df: number): number {
  if (df <= 0) return Number.NaN;
  if (x < 0) return 0;
  if (x === 0) return df < 2 ? Number.POSITIVE_INFINITY : df === 2 ? 0.5 : 0;
  const k = df / 2;
  return Math.exp((k - 1) * Math.log(x) - x / 2 - k * Math.LN2 - lnGamma(k));
}

export function chiSquaredCdf(x: number, df: number): number {
  if (df <= 0) return Number.NaN;
  return gammaP(df / 2, x / 2);
}

/** The upper tail, kept as its own call so the far tail survives. */
export function chiSquaredSf(x: number, df: number): number {
  if (df <= 0) return Number.NaN;
  return gammaQ(df / 2, x / 2);
}

/**
 * Wilson-Hilferty: the cube root of a chi-squared over its mean is close to
 * normal, which puts the seed within a few percent for any useful df.
 */
function chiSquaredSeed(p: number, df: number): number {
  const z = standardNormalInv(Math.min(Math.max(p, 1e-12), 1 - 1e-12));
  const h = 2 / (9 * df);
  const guess = df * Math.pow(1 - h + z * Math.sqrt(h), 3);
  return Number.isFinite(guess) && guess > 0 ? guess : df;
}

export function chiSquaredInv(p: number, df: number): number {
  if (df <= 0) return Number.NaN;
  return quantileAbove(
    (x) => chiSquaredCdf(x, df),
    p,
    chiSquaredSeed(p, df),
  );
}

/** The chi-squared whose right tail is `p`, inverted against the tail. */
export function chiSquaredInvRt(p: number, df: number): number {
  if (df <= 0) return Number.NaN;
  return quantileFromTail(
    (x) => chiSquaredSf(x, df),
    p,
    chiSquaredSeed(1 - p, df),
  );
}

// ---------------------------------------------------------------------------
// Student's t
// ---------------------------------------------------------------------------

export function studentTPdf(t: number, df: number): number {
  if (df <= 0) return Number.NaN;
  const logConstant =
    lnGamma((df + 1) / 2) - lnGamma(df / 2) - 0.5 * Math.log(df * Math.PI);
  return Math.exp(
    logConstant - ((df + 1) / 2) * Math.log1p((t * t) / df),
  );
}

/**
 * The left-tail cumulative of Student's t.
 *
 * `I_x(v/2, 1/2)` at `x = v / (v + t^2)` is the two-tailed probability; the
 * sign of `t` decides which half of it the answer is. Branching on the sign
 * rather than subtracting keeps both tails accurate: the small one is computed
 * as the small one.
 */
export function studentTCdf(t: number, df: number): number {
  if (df <= 0) return Number.NaN;
  if (t === 0) return 0.5;
  const x = df / (df + t * t);
  const half = 0.5 * incompleteBeta(df / 2, 0.5, x);
  return t > 0 ? 1 - half : half;
}

/** The two-tailed probability that `|T|` exceeds `|t|`. */
export function studentTTwoTail(t: number, df: number): number {
  if (df <= 0) return Number.NaN;
  return incompleteBeta(df / 2, 0.5, df / (df + t * t));
}

/**
 * `P(T > t)`, computed as a tail rather than as `1 - P(T <= t)`.
 *
 * The subtraction is what a p-value is usually written as and it is exactly
 * wrong for the case a p-value matters in: for `t = 8` on a hundred degrees of
 * freedom the answer is around 1e-12, the cumulative is one to every bit a
 * double has, and the difference is zero. Only the positive branch needs the
 * care — on the other side the answer is order one and there is nothing small
 * to lose.
 */
export function studentTSf(t: number, df: number): number {
  if (df <= 0) return Number.NaN;
  if (t === 0) return 0.5;
  const half = 0.5 * incompleteBeta(df / 2, 0.5, df / (df + t * t));
  return t > 0 ? half : 1 - half;
}

/** A normal quantile inflated for the heavier tail — a serviceable seed. */
function tSeed(p: number, df: number): number {
  const z = Math.abs(standardNormalInv(Math.min(Math.max(p, 1e-300), 0.5)));
  const guess = z * Math.sqrt(df / Math.max(df - 2, 0.5));
  return Number.isFinite(guess) && guess > 0 ? guess : 1;
}

/**
 * The magnitude whose one-sided upper tail is `p`.
 *
 * Everything else about the t quantile is built from this, because the
 * distribution is symmetric and this is the only piece where the arithmetic
 * can go wrong.
 */
function studentTUpperQuantile(p: number, df: number): number {
  return quantileFromTail((x) => studentTSf(x, df), p, tSeed(p, df), 0);
}

export function studentTInv(p: number, df: number): number {
  if (df <= 0 || Number.isNaN(p)) return Number.NaN;
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  if (p === 0.5) return 0;
  // Both halves invert an upper tail: the left one against `p` itself, which
  // is what keeps a quantile at p = 1e-12 exact rather than seven digits.
  return p < 0.5
    ? -studentTUpperQuantile(p, df)
    : studentTUpperQuantile(1 - p, df);
}

/** The `t` whose two-tailed probability is `p` — always positive. */
export function studentTInvTwoTail(p: number, df: number): number {
  if (df <= 0 || Number.isNaN(p) || p < 0 || p > 1) return Number.NaN;
  if (p >= 1) return 0;
  if (p <= 0) return Number.POSITIVE_INFINITY;
  return quantileFromTail((x) => studentTTwoTail(x, df), p, tSeed(p / 2, df), 0);
}

// ---------------------------------------------------------------------------
// F
// ---------------------------------------------------------------------------

export function fPdf(x: number, d1: number, d2: number): number {
  if (d1 <= 0 || d2 <= 0) return Number.NaN;
  if (x < 0) return 0;
  if (x === 0) return d1 < 2 ? Number.POSITIVE_INFINITY : d1 === 2 ? 1 : 0;
  const log =
    0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2)) -
    0.5 * (d1 + d2) * Math.log(d1 * x + d2) -
    Math.log(x) -
    lnBeta(d1 / 2, d2 / 2);
  return Math.exp(log);
}

export function fCdf(x: number, d1: number, d2: number): number {
  if (d1 <= 0 || d2 <= 0) return Number.NaN;
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return 1;
  return incompleteBeta(d1 / 2, d2 / 2, (d1 * x) / (d1 * x + d2));
}

/**
 * The upper tail of F, which is the one a significance test asks for.
 *
 * Computed by reflecting the incomplete beta rather than by subtracting the
 * lower tail, so a p-value of 1e-14 comes back as 1e-14 and not as zero.
 */
export function fSf(x: number, d1: number, d2: number): number {
  if (d1 <= 0 || d2 <= 0) return Number.NaN;
  if (x <= 0) return 1;
  if (!Number.isFinite(x)) return 0;
  return incompleteBeta(d2 / 2, d1 / 2, d2 / (d1 * x + d2));
}

export function fInv(p: number, d1: number, d2: number): number {
  if (d1 <= 0 || d2 <= 0) return Number.NaN;
  return quantileAbove((x) => fCdf(x, d1, d2), p, 1);
}

/** The `F` whose right tail is `p`, inverted against the tail. */
export function fInvRt(p: number, d1: number, d2: number): number {
  if (d1 <= 0 || d2 <= 0) return Number.NaN;
  return quantileFromTail((x) => fSf(x, d1, d2), p, 1);
}

// ---------------------------------------------------------------------------
// Gamma, beta, lognormal, exponential, Weibull
// ---------------------------------------------------------------------------

export function gammaPdf(x: number, shape: number, scale: number): number {
  if (shape <= 0 || scale <= 0) return Number.NaN;
  if (x < 0) return 0;
  if (x === 0) {
    return shape < 1
      ? Number.POSITIVE_INFINITY
      : shape === 1
        ? 1 / scale
        : 0;
  }
  return Math.exp(
    (shape - 1) * Math.log(x) -
      x / scale -
      shape * Math.log(scale) -
      lnGamma(shape),
  );
}

export function gammaCdf(x: number, shape: number, scale: number): number {
  if (shape <= 0 || scale <= 0) return Number.NaN;
  return gammaP(shape, x / scale);
}

export function gammaInv(p: number, shape: number, scale: number): number {
  if (shape <= 0 || scale <= 0) return Number.NaN;
  return quantileAbove(
    (x) => gammaCdf(x, shape, scale),
    p,
    shape * scale || 1,
  );
}

export function betaPdf(x: number, a: number, b: number): number {
  if (a <= 0 || b <= 0) return Number.NaN;
  if (x < 0 || x > 1) return 0;
  if (x === 0) return a < 1 ? Number.POSITIVE_INFINITY : a === 1 ? b : 0;
  if (x === 1) return b < 1 ? Number.POSITIVE_INFINITY : b === 1 ? a : 0;
  return Math.exp(
    (a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - lnBeta(a, b),
  );
}

export function betaCdf(x: number, a: number, b: number): number {
  return incompleteBeta(a, b, x);
}

export function betaInv(p: number, a: number, b: number): number {
  if (a <= 0 || b <= 0 || Number.isNaN(p)) return Number.NaN;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return invertMonotone((x) => incompleteBeta(a, b, x), p, 0, 1);
}

export function lognormalPdf(x: number, mean: number, sd: number): number {
  if (sd <= 0) return Number.NaN;
  if (x <= 0) return 0;
  return normalPdf(Math.log(x), mean, sd) / x;
}

export function lognormalCdf(x: number, mean: number, sd: number): number {
  if (sd <= 0) return Number.NaN;
  if (x <= 0) return 0;
  return normalCdf(Math.log(x), mean, sd);
}

export function lognormalInv(p: number, mean: number, sd: number): number {
  if (sd <= 0) return Number.NaN;
  return Math.exp(normalInv(p, mean, sd));
}

export function exponentialPdf(x: number, lambda: number): number {
  if (lambda <= 0) return Number.NaN;
  return x < 0 ? 0 : lambda * Math.exp(-lambda * x);
}

export function exponentialCdf(x: number, lambda: number): number {
  if (lambda <= 0) return Number.NaN;
  return x < 0 ? 0 : -Math.expm1(-lambda * x);
}

export function weibullPdf(x: number, shape: number, scale: number): number {
  if (shape <= 0 || scale <= 0) return Number.NaN;
  if (x < 0) return 0;
  const z = x / scale;
  return (shape / scale) * Math.pow(z, shape - 1) * Math.exp(-Math.pow(z, shape));
}

export function weibullCdf(x: number, shape: number, scale: number): number {
  if (shape <= 0 || scale <= 0) return Number.NaN;
  if (x < 0) return 0;
  return -Math.expm1(-Math.pow(x / scale, shape));
}

// ---------------------------------------------------------------------------
// Discrete families
// ---------------------------------------------------------------------------

export function binomialPmf(k: number, n: number, p: number): number {
  if (n < 0 || p < 0 || p > 1) return Number.NaN;
  if (k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(
    lnChoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p),
  );
}

/**
 * `P(X <= k)` for a binomial, through the incomplete beta rather than by
 * summing the terms.
 *
 * The sum is the definition, and for `n` in the millions — a perfectly
 * ordinary sample size — it is also millions of `exp` calls with a rounding
 * error that grows with every one of them. The identity gives the same number
 * in constant time.
 */
export function binomialCdf(k: number, n: number, p: number): number {
  if (n < 0 || p < 0 || p > 1) return Number.NaN;
  const floor = Math.floor(k);
  if (floor < 0) return 0;
  if (floor >= n) return 1;
  if (p === 0) return 1;
  if (p === 1) return 0;
  return incompleteBeta(n - floor, floor + 1, 1 - p);
}

/** Smallest `k` whose cumulative reaches `alpha` — the `BINOM.INV` criterion. */
export function binomialInv(n: number, p: number, alpha: number): number {
  if (n < 0 || p < 0 || p > 1 || alpha < 0 || alpha > 1) return Number.NaN;
  if (alpha === 0) return 0;
  const total = Math.floor(n);
  // Binary search on a non-decreasing step function, so a sample size of a
  // million costs twenty evaluations rather than a million.
  let lo = 0;
  let hi = total;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (binomialCdf(mid, total, p) >= alpha) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function poissonPmf(k: number, mean: number): number {
  if (mean < 0) return Number.NaN;
  if (k < 0) return 0;
  if (mean === 0) return k === 0 ? 1 : 0;
  return Math.exp(-mean + k * Math.log(mean) - lnFactorial(k));
}

export function poissonCdf(k: number, mean: number): number {
  if (mean < 0) return Number.NaN;
  const floor = Math.floor(k);
  if (floor < 0) return 0;
  if (mean === 0) return 1;
  return gammaQ(floor + 1, mean);
}

export function hypergeometricPmf(
  k: number,
  draws: number,
  successes: number,
  population: number,
): number {
  if (k < 0 || k > draws || k > successes) return 0;
  if (draws - k > population - successes) return 0;
  return Math.exp(
    lnChoose(successes, k) +
      lnChoose(population - successes, draws - k) -
      lnChoose(population, draws),
  );
}

/**
 * The hypergeometric cumulative, by summation.
 *
 * There is no incomplete-beta identity to lean on here, but the support is
 * bounded by the number of draws, so the sum is finite and short by
 * construction rather than by luck.
 */
export function hypergeometricCdf(
  k: number,
  draws: number,
  successes: number,
  population: number,
): number {
  const floor = Math.floor(k);
  if (floor < 0) return 0;
  let sum = 0;
  const start = Math.max(0, draws - (population - successes));
  for (let i = start; i <= Math.min(floor, draws, successes); i++) {
    sum += hypergeometricPmf(i, draws, successes, population);
  }
  return Math.min(sum, 1);
}

export function negativeBinomialPmf(
  failures: number,
  successes: number,
  p: number,
): number {
  if (p <= 0 || p > 1 || successes <= 0 || failures < 0) return Number.NaN;
  return Math.exp(
    lnChoose(failures + successes - 1, failures) +
      successes * Math.log(p) +
      failures * Math.log1p(-p),
  );
}

export function negativeBinomialCdf(
  failures: number,
  successes: number,
  p: number,
): number {
  if (p <= 0 || p > 1 || successes <= 0) return Number.NaN;
  const floor = Math.floor(failures);
  if (floor < 0) return 0;
  return incompleteBeta(successes, floor + 1, p);
}
