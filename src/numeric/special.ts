/**
 * The special functions every statistical distribution is really made of.
 *
 * There are only two integrals here, and eleven distributions sit on them. The
 * regularised incomplete gamma covers the normal, chi-squared, gamma, Poisson
 * and exponential families; the regularised incomplete beta covers Student's
 * t, F, beta, binomial and negative binomial. Writing them once and building
 * upward is not only less code — it is the only way the families stay
 * *consistent with each other*, so that `T.DIST` with a large degrees of
 * freedom actually converges on `NORM.S.DIST`, and `CHISQ.DIST` with one
 * degree of freedom actually agrees with the square of a normal.
 *
 * Each integral is computed by whichever of two expansions converges where the
 * argument lies. That is not an optimisation. The series for `P(a, x)` is
 * alternating in effect for `x` much larger than `a` and loses every digit it
 * has to cancellation, while the continued fraction stalls for small `x`. The
 * crossover at `x = a + 1` is where each is comfortably inside its own region.
 */

/** Relative tolerance the iterations are driven to; about 4 ulp. */
const TOLERANCE = 1e-15;

/**
 * Iteration cap for the continued fractions.
 *
 * Both of them converge in well under two hundred terms anywhere in the region
 * they are used for, so this is a safety bound rather than a working limit.
 */
const MAX_ITERATIONS = 10000;

/**
 * Iteration cap for the gamma *series*, which unlike the fractions genuinely
 * needs more terms as its argument grows.
 *
 * The number of terms is order `sqrt(a)` near the handover point `x = a + 1`,
 * and that point is not an exotic corner: for a chi-squared on a million
 * degrees of freedom the median lands within one of it. A fixed cap therefore
 * does not fail on absurd input, it fails on the middle of a large
 * distribution — and it fails *silently*, returning a partial sum that looks
 * like a probability. This scales, and non-convergence is reported.
 */
function seriesIterationLimit(a: number): number {
  return Math.ceil(1000 + 100 * Math.sqrt(a));
}

/** Smallest positive normal double, used to keep Lentz's method off zero. */
const TINY = 1e-300;

/** `ln(sqrt(2*pi))`, which appears in every Stirling-shaped expression here. */
const LN_SQRT_TWO_PI = 0.9189385332046727417803297;

/**
 * Lanczos coefficients for `g = 7`, `n = 9`.
 *
 * This particular set is the one whose relative error stays below about 1e-15
 * across the right half plane, which is the accuracy the rest of the file
 * assumes. Recomputing the coefficients for a different `g` without also
 * changing the `g + 0.5` below produces a function that is smoothly and
 * silently wrong, so the two travel together.
 */
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
] as const;

const LANCZOS_G = 7;

/**
 * `ln |Gamma(x)|` for `x > 0`.
 *
 * The log rather than the value because the value overflows a double at about
 * `x = 172`, while binomial coefficients and Poisson densities routinely need
 * arguments far past that. Every consumer here works in logs and exponentiates
 * once at the end, which is also what keeps a density like `C(1000, 500) *
 * p^500 * q^500` — a vast number times two vanishing ones — representable at
 * every step.
 */
export function lnGamma(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  if (x <= 0) {
    // Reflection: Gamma(x) Gamma(1-x) = pi / sin(pi x). Only the poles at the
    // non-positive integers are genuinely undefined.
    if (Number.isInteger(x)) return Number.NaN;
    const sin = Math.sin(Math.PI * x);
    if (sin === 0) return Number.NaN;
    return Math.log(Math.PI / Math.abs(sin)) - lnGamma(1 - x);
  }
  const z = x - 1;
  let series = LANCZOS[0]!;
  for (let i = 1; i < LANCZOS.length; i++) {
    series += LANCZOS[i]! / (z + i);
  }
  const t = z + LANCZOS_G + 0.5;
  return LN_SQRT_TWO_PI + (z + 0.5) * Math.log(t) - t + Math.log(series);
}

/** `Gamma(x)`, for the range where it is representable. */
export function gamma(x: number): number {
  if (x > 0) return Math.exp(lnGamma(x));
  if (Number.isInteger(x)) return Number.NaN;
  // Keep the reflection in value space so the sign, which the log discards,
  // survives: Gamma is negative on (-1, 0), positive on (-2, -1), and so on.
  return Math.PI / (Math.sin(Math.PI * x) * Math.exp(lnGamma(1 - x)));
}

/** `ln B(a, b)` — the beta function in logs, for the same reason as above. */
export function lnBeta(a: number, b: number): number {
  return lnGamma(a) + lnGamma(b) - lnGamma(a + b);
}

/** `ln C(n, k)`, exact for the integer arguments a distribution supplies. */
export function lnChoose(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  if (k === 0 || k === n) return 0;
  return lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
}

/** `ln(x!)` for a non-negative integer, and for anything else its gamma. */
export function lnFactorial(n: number): number {
  return lnGamma(n + 1);
}

/**
 * The series expansion of `P(a, x)`, convergent for `x < a + 1`.
 *
 * Every term is positive, so there is no cancellation to worry about and the
 * stopping test on the relative size of the last term is honest.
 */
function gammaSeries(a: number, x: number): number {
  const limit = seriesIterationLimit(a);
  let term = 1 / a;
  let sum = term;
  let ap = a;
  let converged = false;
  for (let i = 0; i < limit; i++) {
    ap += 1;
    term *= x / ap;
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * TOLERANCE) {
      converged = true;
      break;
    }
  }
  if (!converged) return Number.NaN;
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

/**
 * The continued fraction for `Q(a, x)`, convergent for `x > a + 1`.
 *
 * Evaluated by the modified Lentz algorithm, which walks the fraction from the
 * front rather than needing to know where to truncate it in advance. The
 * `TINY` guards are the part of Lentz that matters: a zero denominator is a
 * removable feature of the recurrence, not a singularity of the fraction, and
 * nudging it to the smallest representable value steps over it without
 * measurably disturbing the result.
 */
function gammaContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  let converged = false;
  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < TOLERANCE) {
      converged = true;
      break;
    }
  }
  if (!converged) return Number.NaN;
  return h * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

/**
 * The regularised lower incomplete gamma `P(a, x)`, in `[0, 1]`.
 *
 * This is the cumulative of a gamma distribution with unit scale, and through
 * that the cumulative of the chi-squared, the Poisson upper tail, and — at
 * `a = 1/2` — the error function.
 */
export function gammaP(a: number, x: number): number {
  if (Number.isNaN(a) || Number.isNaN(x)) return Number.NaN;
  if (x <= 0) return 0;
  if (a <= 0) return Number.NaN;
  if (!Number.isFinite(x)) return 1;
  return x < a + 1 ? gammaSeries(a, x) : 1 - gammaContinuedFraction(a, x);
}

/**
 * The regularised upper incomplete gamma `Q(a, x) = 1 - P(a, x)`.
 *
 * Kept as its own entry point rather than left to the caller to subtract: in
 * the far tail `P` is one to every bit a double has, and `1 - P` is exactly
 * zero, while the continued fraction that `Q` uses there returns the small
 * number that was actually wanted. A survival function has to be computed as a
 * survival function.
 */
export function gammaQ(a: number, x: number): number {
  if (Number.isNaN(a) || Number.isNaN(x)) return Number.NaN;
  if (x <= 0) return 1;
  if (a <= 0) return Number.NaN;
  if (!Number.isFinite(x)) return 0;
  return x < a + 1 ? 1 - gammaSeries(a, x) : gammaContinuedFraction(a, x);
}

/**
 * The error function.
 *
 * Defined here through `P(1/2, x^2)` rather than by its own approximation. A
 * dedicated rational fit would be faster and is what most libraries carry, but
 * it would also be a *second* approximation to keep consistent with the first,
 * and `NORM.S.DIST` and `CHISQ.DIST(x, 1)` would then disagree in their last
 * digits for no reason a reader could discover.
 */
export function erf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x === 0) return 0;
  return x < 0 ? -gammaP(0.5, x * x) : gammaP(0.5, x * x);
}

/**
 * The complementary error function, `1 - erf(x)`, without the cancellation.
 *
 * For `x` around 5 the true value is near 1.5e-12 and `1 - erf(x)` retains
 * about four digits of it; the upper integral retains all of them.
 */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x === 0) return 1;
  return x < 0 ? 1 + gammaP(0.5, x * x) : gammaQ(0.5, x * x);
}

/**
 * The continued fraction behind the incomplete beta, again by Lentz.
 *
 * Convergent for `x < (a + 1) / (a + b + 2)`; the caller is responsible for
 * reflecting arguments that fall on the other side.
 */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITERATIONS; m++) {
    const m2 = 2 * m;
    // The even step.
    let an = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + an * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    // The odd step.
    an = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + an * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < TOLERANCE) return h;
  }
  return Number.NaN;
}

/**
 * The regularised incomplete beta `I_x(a, b)`, in `[0, 1]`.
 *
 * The cumulative of a beta distribution, and through the standard identities
 * the cumulative of Student's t, F, the binomial and the negative binomial.
 */
export function incompleteBeta(a: number, b: number, x: number): number {
  return incompleteBetaWithComplement(a, b, x, 1 - x);
}

/**
 * `I_x(a, b)` where the caller can supply `1 - x` more accurately than
 * subtraction would.
 *
 * The distributions that reach this function do not start from `x`. Student's
 * t starts from `t` and forms `v / (v + t^2)`, whose complement is
 * `t^2 / (v + t^2)` — two exact divisions of the same pair of numbers. Letting
 * the function subtract instead throws that away: at `t = 0.0125` on a million
 * degrees of freedom, `x` is `1 - 1.6e-10`, and `1 - x` recovered from the
 * stored double keeps six digits of a quantity that was known to sixteen.
 *
 * So the complement is a parameter. Every branch below uses whichever of the
 * two the caller measured, and neither is ever reconstructed.
 */
export function incompleteBetaWithComplement(
  a: number,
  b: number,
  x: number,
  xc: number,
): number {
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(x)) return Number.NaN;
  if (a <= 0 || b <= 0) return Number.NaN;
  if (x <= 0) return 0;
  if (xc <= 0) return 1;
  const front = Math.exp(
    a * Math.log(x) + b * Math.log(xc) - lnBeta(a, b),
  );
  // The fraction converges quickly only on the side of the mode where the
  // integrand is still rising. Past it, reflect and subtract — and past it is
  // also where the answer is the large one, so the subtraction has nothing
  // small to destroy.
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, xc)) / b;
}

/**
 * Invert a non-decreasing function on a bracket, to full relative precision.
 *
 * Bisection, deliberately, and not Newton. The functions inverted here are
 * cumulative distributions, which are flat to the last bit over most of their
 * tails; a Newton step there divides by a density that has underflowed and
 * throws the iterate to infinity. Bisection cannot diverge, needs no
 * derivative, and at roughly one bit per step reaches the full width of a
 * double in under 80 iterations — which for a function costing a few dozen
 * flops is not a cost worth optimising away.
 *
 * The convergence test is on the *relative* width of the bracket, so the
 * result carries full precision for a quantile of 1e-8 as much as for one of
 * 1e8. An absolute test would stop far too early out in the tail.
 */
export function invertMonotone(
  f: (x: number) => number,
  target: number,
  lo: number,
  hi: number,
): number {
  let a = lo;
  let b = hi;
  if (f(a) > target) return a;
  if (f(b) < target) return b;
  for (let i = 0; i < 200; i++) {
    const mid = a + (b - a) / 2;
    if (mid === a || mid === b) break;
    if (b - a <= Math.abs(mid) * 1e-16) break;
    if (f(mid) < target) a = mid;
    else b = mid;
  }
  return a + (b - a) / 2;
}

/**
 * Grow a bracket outward from a starting guess until it straddles the root.
 *
 * Used where a distribution has unbounded support and no useful a-priori
 * bound — the quantile of a gamma with a shape of 1e6 is nowhere near the
 * quantile of one with a shape of 0.01. Doubling the width rather than
 * stepping keeps the search logarithmic in how wrong the guess was.
 */
export function bracketAbove(
  f: (x: number) => number,
  target: number,
  start: number,
  floor = 0,
): [number, number] {
  let hi = start > floor ? start : floor + 1;
  for (let i = 0; i < 200 && f(hi) < target; i++) {
    hi = floor + (hi - floor) * 2;
  }
  return [floor, hi];
}
