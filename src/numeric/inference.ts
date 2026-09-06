/**
 * Hypothesis tests, kept away from the spreadsheet layer.
 *
 * These take arrays of numbers and return statistics and probabilities. The
 * argument reading, the domain refusals and the error values all live in
 * `src/functions/inference.ts`; what is here is the arithmetic, which is worth
 * being able to test without a sheet around it.
 *
 * Every test produces its statistic *and* its degrees of freedom, not just a
 * p-value. A p-value alone cannot be checked against anything — it is the end
 * of a chain — whereas a statistic and a degrees of freedom can be checked
 * against a published table, and the p-value that follows is then one call
 * into the distribution pack.
 */

import {
  chiSquaredSf,
  fSf,
  normalCdf,
  standardNormalInv,
  studentTInv,
  studentTInvTwoTail,
  studentTTwoTail,
} from "./distributions.js";

export interface TTestResult {
  readonly t: number;
  readonly df: number;
  readonly p: number;
}

/** Mean and *sample* variance. */
function moments(values: readonly number[]): { mean: number; variance: number } {
  const n = values.length;
  if (n === 0) return { mean: Number.NaN, variance: Number.NaN };
  let mean = 0;
  for (const value of values) mean += value;
  mean /= n;
  // The two-pass form, deliberately. The one-pass sum-of-squares identity
  // collapses on values around 1e8 with a spread of 1 — exactly the shape a
  // column of revenue figures has — and returns a negative variance.
  let sum = 0;
  for (const value of values) {
    const deviation = value - mean;
    sum += deviation * deviation;
  }
  return { mean, variance: n > 1 ? sum / (n - 1) : Number.NaN };
}

export function sampleMean(values: readonly number[]): number {
  return moments(values).mean;
}

export function sampleVariance(values: readonly number[]): number {
  return moments(values).variance;
}

/** A one-sample t against a hypothesised mean. */
export function oneSampleT(
  values: readonly number[],
  hypothesised: number,
): TTestResult {
  const n = values.length;
  const { mean, variance } = moments(values);
  const df = n - 1;
  const t = (mean - hypothesised) / Math.sqrt(variance / n);
  return { t, df, p: studentTTwoTail(t, df) };
}

/**
 * The paired test — a one-sample test on the differences, which is what it is.
 *
 * Pairing is the whole point: it removes whatever the two measurements have in
 * common, so a difference that would be swamped by the spread *between*
 * subjects is measured against the spread *within* them.
 */
export function pairedT(
  first: readonly number[],
  second: readonly number[],
): TTestResult {
  const differences = first.map((value, index) => value - second[index]!);
  return oneSampleT(differences, 0);
}

/** Two samples, assuming they share a variance: the pooled-variance test. */
export function pooledT(
  first: readonly number[],
  second: readonly number[],
): TTestResult {
  const n1 = first.length;
  const n2 = second.length;
  const a = moments(first);
  const b = moments(second);
  const df = n1 + n2 - 2;
  const pooled = ((n1 - 1) * a.variance + (n2 - 1) * b.variance) / df;
  const t = (a.mean - b.mean) / Math.sqrt(pooled * (1 / n1 + 1 / n2));
  return { t, df, p: studentTTwoTail(t, df) };
}

/**
 * Two samples without assuming a shared variance — Welch's test.
 *
 * The degrees of freedom are the Satterthwaite approximation and are almost
 * never a whole number; they are *not* rounded here. Rounding them is a
 * habit from printed tables, which could only be indexed by integers, and it
 * moves the p-value in the third digit for no reason once the distribution can
 * be evaluated at any real degrees of freedom.
 */
export function welchT(
  first: readonly number[],
  second: readonly number[],
): TTestResult {
  const n1 = first.length;
  const n2 = second.length;
  const a = moments(first);
  const b = moments(second);
  const s1 = a.variance / n1;
  const s2 = b.variance / n2;
  const df =
    ((s1 + s2) * (s1 + s2)) /
    ((s1 * s1) / (n1 - 1) + (s2 * s2) / (n2 - 1));
  const t = (a.mean - b.mean) / Math.sqrt(s1 + s2);
  return { t, df, p: studentTTwoTail(t, df) };
}

/** Halve a two-tailed probability; the sign of the statistic does not matter. */
export function oneTailed(result: TTestResult): number {
  return result.p / 2;
}

export interface FTestResult {
  /** Larger variance over smaller, so the ratio is always at least one. */
  readonly f: number;
  readonly df1: number;
  readonly df2: number;
  readonly p: number;
}

/**
 * The two-tailed test that two samples share a variance.
 *
 * Written with the larger variance on top so the statistic lands in the upper
 * tail whichever way round the samples were given, and doubled because the
 * question — *are these different* — does not say which direction.
 */
export function varianceRatioTest(
  first: readonly number[],
  second: readonly number[],
): FTestResult {
  const v1 = sampleVariance(first);
  const v2 = sampleVariance(second);
  const firstIsLarger = v1 >= v2;
  const f = firstIsLarger ? v1 / v2 : v2 / v1;
  const df1 = (firstIsLarger ? first.length : second.length) - 1;
  const df2 = (firstIsLarger ? second.length : first.length) - 1;
  return { f, df1, df2, p: Math.min(1, 2 * fSf(f, df1, df2)) };
}

export interface ChiSquareResult {
  readonly statistic: number;
  readonly df: number;
  readonly p: number;
}

/**
 * Pearson's statistic over an observed and an expected block.
 *
 * The degrees of freedom come from the *shape* of the blocks, not from how
 * many cells they hold: a two-dimensional contingency table of `r` by `c` has
 * `(r-1)(c-1)`, because fixing the margins fixes that many cells, while a
 * single row or column is a goodness-of-fit test with `n - 1`. Taking the
 * count alone would give the wrong answer for every table that is not a strip.
 */
export function chiSquareTest(
  observed: readonly number[],
  expected: readonly number[],
  rows: number,
  cols: number,
): ChiSquareResult {
  let statistic = 0;
  for (let i = 0; i < observed.length; i++) {
    const e = expected[i]!;
    const deviation = observed[i]! - e;
    statistic += (deviation * deviation) / e;
  }
  const df = rows === 1 || cols === 1 ? rows * cols - 1 : (rows - 1) * (cols - 1);
  return { statistic, df, p: chiSquaredSf(statistic, df) };
}

/**
 * The one-tailed probability of a sample mean at least this far above `mu`.
 *
 * A z test rather than a t test because the population deviation is taken as
 * known; when it is not given, the sample deviation stands in, which is the
 * established spreadsheet behaviour even though it is really a t test then.
 */
export function zTest(
  values: readonly number[],
  hypothesised: number,
  sigma?: number,
): number {
  const n = values.length;
  const { mean, variance } = moments(values);
  const deviation = sigma ?? Math.sqrt(variance);
  const z = (mean - hypothesised) / (deviation / Math.sqrt(n));
  // `normalCdf(-z)` rather than `1 - normalCdf(z)`: the answer wanted here is
  // a tail, and a strongly significant result is precisely where subtracting
  // from one would round it to zero.
  return normalCdf(-z, 0, 1);
}

/** Half-width of a normal confidence interval at the given significance. */
export function confidenceNormal(
  alpha: number,
  sigma: number,
  size: number,
): number {
  return -standardNormalInv(alpha / 2) * (sigma / Math.sqrt(size));
}

/** Half-width when the deviation is estimated from the sample. */
export function confidenceStudent(
  alpha: number,
  sigma: number,
  size: number,
): number {
  return studentTInvTwoTail(alpha, size - 1) * (sigma / Math.sqrt(size));
}

/** The two-tailed p-value of a t statistic — the summary's missing column. */
export function twoTailedP(t: number, df: number): number {
  return studentTTwoTail(t, df);
}

/** The probability of an F ratio at least this large under the null. */
export function fSignificance(f: number, df1: number, df2: number): number {
  return fSf(f, df1, df2);
}

/** The multiplier on a standard error that a `level` interval needs. */
export function tCriticalValue(level: number, df: number): number {
  return studentTInv(1 - (1 - level) / 2, df);
}


