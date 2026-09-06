/**
 * The statistical distribution functions, in the modern dotted names.
 *
 * These are thin: every one of them validates its arguments, calls into
 * `src/numeric/distributions.ts`, and turns a `NaN` into `#NUM!`. The
 * validation is the part worth reading. A spreadsheet distribution has a
 * domain — a probability is in `[0, 1]`, degrees of freedom are positive, a
 * standard deviation is not — and the difference between returning `#NUM!` and
 * returning a number that happens to be `NaN` is the difference between a
 * sheet that shows the mistake and a sheet that carries it silently into a
 * total.
 *
 * Degrees of freedom are truncated rather than rounded, and the argument order
 * follows the established spreadsheet convention even where it is inconsistent
 * between families, because a formula written elsewhere has to mean the same
 * thing here.
 */

import { NUM_ERROR, isFormulaError } from "../engine/errors.js";
import type { FormulaError } from "../engine/errors.js";
import { toBoolean } from "../engine/value.js";
import type { Value } from "../engine/value.js";
import {
  betaCdf,
  betaInv,
  betaPdf,
  binomialCdf,
  binomialInv,
  binomialPmf,
  chiSquaredCdf,
  chiSquaredInv,
  chiSquaredInvRt,
  chiSquaredPdf,
  chiSquaredSf,
  exponentialCdf,
  exponentialPdf,
  fCdf,
  fInv,
  fInvRt,
  fPdf,
  fSf,
  gammaCdf,
  gammaInv,
  gammaPdf,
  hypergeometricCdf,
  hypergeometricPmf,
  lognormalCdf,
  lognormalInv,
  lognormalPdf,
  negativeBinomialCdf,
  negativeBinomialPmf,
  normalCdf,
  normalInv,
  normalPdf,
  poissonCdf,
  poissonPmf,
  standardNormalInv,
  studentTCdf,
  studentTInv,
  studentTInvTwoTail,
  studentTPdf,
  studentTSf,
  studentTTwoTail,
  weibullCdf,
  weibullPdf,
} from "../numeric/distributions.js";
import { gamma, lnGamma } from "../numeric/special.js";
import { argValue, defineFunction, numberArg } from "./registry.js";
import type { Arg } from "./registry.js";

/** A finite number, or `#NUM!` — the shape every function here ends in. */
function guard(n: number): Value {
  return Number.isFinite(n) ? n : NUM_ERROR;
}

/** Read the trailing cumulative flag, defaulting to the density. */
function cumulativeArg(
  args: readonly Arg[],
  index: number,
): boolean | FormulaError {
  if (args.length <= index) return false;
  return toBoolean(argValue(args[index]!));
}

/**
 * Read a list of numeric arguments in one go.
 *
 * Every function here starts by coercing three to five scalars and abandoning
 * the call at the first that fails, and writing that out per function buries
 * the actual formula under argument handling.
 */
function numbers(
  args: readonly Arg[],
  count: number,
): number[] | FormulaError {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const value = numberArg(args[i]);
    if (isFormulaError(value)) return value;
    out.push(value);
  }
  return out;
}

/** Degrees of freedom: truncated, and at least one. */
function degrees(value: number): number | FormulaError {
  const df = Math.trunc(value);
  return df < 1 ? NUM_ERROR : df;
}

/** A probability strictly inside `(0, 1)`, as every `.INV` requires. */
function openProbability(p: number): number | FormulaError {
  return p <= 0 || p >= 1 ? NUM_ERROR : p;
}

// ---------------------------------------------------------------------------
// Normal
// ---------------------------------------------------------------------------

defineFunction({
  name: "NORM.DIST",
  description: "Normal density or cumulative at x, for a mean and deviation.",
  minArgs: 4,
  maxArgs: 4,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [x, mean, sd] = read as [number, number, number];
    const cumulative = cumulativeArg(args, 3);
    if (isFormulaError(cumulative)) return cumulative;
    if (sd <= 0) return NUM_ERROR;
    return guard(cumulative ? normalCdf(x, mean, sd) : normalPdf(x, mean, sd));
  },
});

defineFunction({
  name: "NORM.INV",
  description: "The value whose normal cumulative is the given probability.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [p, mean, sd] = read as [number, number, number];
    const probability = openProbability(p);
    if (isFormulaError(probability)) return probability;
    if (sd <= 0) return NUM_ERROR;
    return guard(normalInv(probability, mean, sd));
  },
});

defineFunction({
  name: "NORM.S.DIST",
  description: "Standard normal density or cumulative at z.",
  minArgs: 1,
  maxArgs: 2,
  call(args) {
    const read = numbers(args, 1);
    if (isFormulaError(read)) return read;
    const z = read[0]!;
    // The one-argument form is the cumulative, which is the older `NORMSDIST`
    // behaviour and the one a sheet written without the flag expects.
    const cumulative =
      args.length < 2 ? true : cumulativeArg(args, 1);
    if (isFormulaError(cumulative)) return cumulative;
    return guard(cumulative ? normalCdf(z, 0, 1) : normalPdf(z, 0, 1));
  },
});

defineFunction({
  name: "NORM.S.INV",
  description: "The z whose standard normal cumulative is the probability.",
  minArgs: 1,
  maxArgs: 1,
  call(args) {
    const read = numbers(args, 1);
    if (isFormulaError(read)) return read;
    const probability = openProbability(read[0]!);
    if (isFormulaError(probability)) return probability;
    return guard(standardNormalInv(probability));
  },
});

defineFunction({
  name: "PHI",
  description: "The standard normal density at z.",
  minArgs: 1,
  maxArgs: 1,
  call(args) {
    const read = numbers(args, 1);
    if (isFormulaError(read)) return read;
    return guard(normalPdf(read[0]!, 0, 1));
  },
});

defineFunction({
  name: "GAUSS",
  description: "The probability between the mean and z, standard normal.",
  minArgs: 1,
  maxArgs: 1,
  call(args) {
    const read = numbers(args, 1);
    if (isFormulaError(read)) return read;
    return guard(normalCdf(read[0]!, 0, 1) - 0.5);
  },
});

defineFunction({
  name: "STANDARDIZE",
  description: "The z score of x for a mean and deviation.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [x, mean, sd] = read as [number, number, number];
    if (sd <= 0) return NUM_ERROR;
    return guard((x - mean) / sd);
  },
});

// ---------------------------------------------------------------------------
// Student's t
// ---------------------------------------------------------------------------

defineFunction({
  name: "T.DIST",
  description: "Left-tailed t density or cumulative.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const read = numbers(args, 2);
    if (isFormulaError(read)) return read;
    const [t, rawDf] = read as [number, number];
    const df = degrees(rawDf);
    if (isFormulaError(df)) return df;
    const cumulative = cumulativeArg(args, 2);
    if (isFormulaError(cumulative)) return cumulative;
    return guard(cumulative ? studentTCdf(t, df) : studentTPdf(t, df));
  },
});

defineFunction({
  name: "T.DIST.RT",
  description: "Right-tailed t probability.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const read = numbers(args, 2);
    if (isFormulaError(read)) return read;
    const df = degrees(read[1]!);
    if (isFormulaError(df)) return df;
    return guard(studentTSf(read[0]!, df));
  },
});

defineFunction({
  name: "T.DIST.2T",
  description: "Two-tailed t probability; the value has to be non-negative.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const read = numbers(args, 2);
    if (isFormulaError(read)) return read;
    const [t, rawDf] = read as [number, number];
    if (t < 0) return NUM_ERROR;
    const df = degrees(rawDf);
    if (isFormulaError(df)) return df;
    return guard(studentTTwoTail(t, df));
  },
});

defineFunction({
  name: "T.INV",
  description: "The left-tailed t value for a probability.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const read = numbers(args, 2);
    if (isFormulaError(read)) return read;
    const probability = openProbability(read[0]!);
    if (isFormulaError(probability)) return probability;
    const df = degrees(read[1]!);
    if (isFormulaError(df)) return df;
    return guard(studentTInv(probability, df));
  },
});

defineFunction({
  name: "T.INV.2T",
  description: "The t whose two-tailed probability is the one given.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const read = numbers(args, 2);
    if (isFormulaError(read)) return read;
    const [p, rawDf] = read as [number, number];
    if (p <= 0 || p > 1) return NUM_ERROR;
    const df = degrees(rawDf);
    if (isFormulaError(df)) return df;
    return guard(studentTInvTwoTail(p, df));
  },
});

// ---------------------------------------------------------------------------
// Chi-squared
// ---------------------------------------------------------------------------

defineFunction({
  name: "CHISQ.DIST",
  description: "Left-tailed chi-squared density or cumulative.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const read = numbers(args, 2);
    if (isFormulaError(read)) return read;
    const [x, rawDf] = read as [number, number];
    if (x < 0) return NUM_ERROR;
    const df = degrees(rawDf);
    if (isFormulaError(df)) return df;
    const cumulative = cumulativeArg(args, 2);
    if (isFormulaError(cumulative)) return cumulative;
    return guard(cumulative ? chiSquaredCdf(x, df) : chiSquaredPdf(x, df));
  },
});

defineFunction({
  name: "CHISQ.DIST.RT",
  description: "Right-tailed chi-squared probability.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const read = numbers(args, 2);
    if (isFormulaError(read)) return read;
    const [x, rawDf] = read as [number, number];
    if (x < 0) return NUM_ERROR;
    const df = degrees(rawDf);
    if (isFormulaError(df)) return df;
    return guard(chiSquaredSf(x, df));
  },
});

defineFunction({
  name: "CHISQ.INV",
  description: "The chi-squared value for a left-tailed probability.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const read = numbers(args, 2);
    if (isFormulaError(read)) return read;
    const [p, rawDf] = read as [number, number];
    if (p < 0 || p >= 1) return NUM_ERROR;
    const df = degrees(rawDf);
    if (isFormulaError(df)) return df;
    return guard(chiSquaredInv(p, df));
  },
});

defineFunction({
  name: "CHISQ.INV.RT",
  description: "The chi-squared value for a right-tailed probability.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const read = numbers(args, 2);
    if (isFormulaError(read)) return read;
    const [p, rawDf] = read as [number, number];
    if (p <= 0 || p > 1) return NUM_ERROR;
    const df = degrees(rawDf);
    if (isFormulaError(df)) return df;
    return guard(chiSquaredInvRt(p, df));
  },
});

// ---------------------------------------------------------------------------
// F
// ---------------------------------------------------------------------------

defineFunction({
  name: "F.DIST",
  description: "Left-tailed F density or cumulative.",
  minArgs: 4,
  maxArgs: 4,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [x, raw1, raw2] = read as [number, number, number];
    if (x < 0) return NUM_ERROR;
    const d1 = degrees(raw1);
    if (isFormulaError(d1)) return d1;
    const d2 = degrees(raw2);
    if (isFormulaError(d2)) return d2;
    const cumulative = cumulativeArg(args, 3);
    if (isFormulaError(cumulative)) return cumulative;
    return guard(cumulative ? fCdf(x, d1, d2) : fPdf(x, d1, d2));
  },
});

defineFunction({
  name: "F.DIST.RT",
  description: "Right-tailed F probability.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [x, raw1, raw2] = read as [number, number, number];
    if (x < 0) return NUM_ERROR;
    const d1 = degrees(raw1);
    if (isFormulaError(d1)) return d1;
    const d2 = degrees(raw2);
    if (isFormulaError(d2)) return d2;
    return guard(fSf(x, d1, d2));
  },
});

defineFunction({
  name: "F.INV",
  description: "The F value for a left-tailed probability.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [p, raw1, raw2] = read as [number, number, number];
    if (p < 0 || p >= 1) return NUM_ERROR;
    const d1 = degrees(raw1);
    if (isFormulaError(d1)) return d1;
    const d2 = degrees(raw2);
    if (isFormulaError(d2)) return d2;
    return guard(fInv(p, d1, d2));
  },
});

defineFunction({
  name: "F.INV.RT",
  description: "The F value for a right-tailed probability.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [p, raw1, raw2] = read as [number, number, number];
    if (p <= 0 || p > 1) return NUM_ERROR;
    const d1 = degrees(raw1);
    if (isFormulaError(d1)) return d1;
    const d2 = degrees(raw2);
    if (isFormulaError(d2)) return d2;
    return guard(fInvRt(p, d1, d2));
  },
});

// ---------------------------------------------------------------------------
// Gamma, beta and the rest of the continuous families
// ---------------------------------------------------------------------------

defineFunction({
  name: "GAMMA",
  description: "The gamma function.",
  minArgs: 1,
  maxArgs: 1,
  call(args) {
    const read = numbers(args, 1);
    if (isFormulaError(read)) return read;
    const x = read[0]!;
    if (x <= 0 && Number.isInteger(x)) return NUM_ERROR;
    return guard(gamma(x));
  },
});

defineFunction({
  name: "GAMMALN",
  description: "The natural log of the gamma function.",
  minArgs: 1,
  maxArgs: 1,
  call(args) {
    const read = numbers(args, 1);
    if (isFormulaError(read)) return read;
    if (read[0]! <= 0) return NUM_ERROR;
    return guard(lnGamma(read[0]!));
  },
});

defineFunction({
  name: "GAMMA.DIST",
  description: "Gamma density or cumulative for a shape and a scale.",
  minArgs: 4,
  maxArgs: 4,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [x, shape, scale] = read as [number, number, number];
    if (x < 0 || shape <= 0 || scale <= 0) return NUM_ERROR;
    const cumulative = cumulativeArg(args, 3);
    if (isFormulaError(cumulative)) return cumulative;
    return guard(
      cumulative ? gammaCdf(x, shape, scale) : gammaPdf(x, shape, scale),
    );
  },
});

defineFunction({
  name: "GAMMA.INV",
  description: "The gamma value for a cumulative probability.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [p, shape, scale] = read as [number, number, number];
    if (p < 0 || p >= 1 || shape <= 0 || scale <= 0) return NUM_ERROR;
    return guard(gammaInv(p, shape, scale));
  },
});

/**
 * `BETA.DIST` and `BETA.INV` accept an optional interval `[A, B]`, and rescale
 * onto the unit interval the distribution is actually defined on.
 */
function betaBounds(
  args: readonly Arg[],
  from: number,
): [number, number] | FormulaError {
  let lower = 0;
  let upper = 1;
  if (args.length > from) {
    const value = numberArg(args[from]);
    if (isFormulaError(value)) return value;
    lower = value;
  }
  if (args.length > from + 1) {
    const value = numberArg(args[from + 1]);
    if (isFormulaError(value)) return value;
    upper = value;
  }
  return upper <= lower ? NUM_ERROR : [lower, upper];
}

defineFunction({
  name: "BETA.DIST",
  description: "Beta density or cumulative, optionally over an interval.",
  minArgs: 4,
  maxArgs: 6,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [x, a, b] = read as [number, number, number];
    if (a <= 0 || b <= 0) return NUM_ERROR;
    const cumulative = cumulativeArg(args, 3);
    if (isFormulaError(cumulative)) return cumulative;
    const bounds = betaBounds(args, 4);
    if (isFormulaError(bounds)) return bounds;
    const [lower, upper] = bounds;
    if (x < lower || x > upper) return NUM_ERROR;
    const width = upper - lower;
    const scaled = (x - lower) / width;
    return guard(
      cumulative ? betaCdf(scaled, a, b) : betaPdf(scaled, a, b) / width,
    );
  },
});

defineFunction({
  name: "BETA.INV",
  description: "The beta value for a cumulative probability.",
  minArgs: 3,
  maxArgs: 5,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [p, a, b] = read as [number, number, number];
    if (p < 0 || p > 1 || a <= 0 || b <= 0) return NUM_ERROR;
    const bounds = betaBounds(args, 3);
    if (isFormulaError(bounds)) return bounds;
    const [lower, upper] = bounds;
    return guard(lower + (upper - lower) * betaInv(p, a, b));
  },
});

defineFunction({
  name: "LOGNORM.DIST",
  description: "Lognormal density or cumulative.",
  minArgs: 4,
  maxArgs: 4,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [x, mean, sd] = read as [number, number, number];
    if (sd <= 0) return NUM_ERROR;
    const cumulative = cumulativeArg(args, 3);
    if (isFormulaError(cumulative)) return cumulative;
    if (x <= 0) return cumulative ? 0 : NUM_ERROR;
    return guard(
      cumulative ? lognormalCdf(x, mean, sd) : lognormalPdf(x, mean, sd),
    );
  },
});

defineFunction({
  name: "LOGNORM.INV",
  description: "The lognormal value for a cumulative probability.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [p, mean, sd] = read as [number, number, number];
    const probability = openProbability(p);
    if (isFormulaError(probability)) return probability;
    if (sd <= 0) return NUM_ERROR;
    return guard(lognormalInv(probability, mean, sd));
  },
});

defineFunction({
  name: "EXPON.DIST",
  description: "Exponential density or cumulative for a rate.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const read = numbers(args, 2);
    if (isFormulaError(read)) return read;
    const [x, lambda] = read as [number, number];
    if (x < 0 || lambda <= 0) return NUM_ERROR;
    const cumulative = cumulativeArg(args, 2);
    if (isFormulaError(cumulative)) return cumulative;
    return guard(
      cumulative ? exponentialCdf(x, lambda) : exponentialPdf(x, lambda),
    );
  },
});

defineFunction({
  name: "WEIBULL.DIST",
  description: "Weibull density or cumulative for a shape and a scale.",
  minArgs: 4,
  maxArgs: 4,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [x, shape, scale] = read as [number, number, number];
    if (x < 0 || shape <= 0 || scale <= 0) return NUM_ERROR;
    const cumulative = cumulativeArg(args, 3);
    if (isFormulaError(cumulative)) return cumulative;
    return guard(
      cumulative ? weibullCdf(x, shape, scale) : weibullPdf(x, shape, scale),
    );
  },
});

// ---------------------------------------------------------------------------
// Discrete families
// ---------------------------------------------------------------------------

defineFunction({
  name: "BINOM.DIST",
  description: "Binomial density or cumulative.",
  minArgs: 4,
  maxArgs: 4,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [rawK, rawN, p] = read as [number, number, number];
    const k = Math.trunc(rawK);
    const n = Math.trunc(rawN);
    if (n < 0 || k < 0 || k > n || p < 0 || p > 1) return NUM_ERROR;
    const cumulative = cumulativeArg(args, 3);
    if (isFormulaError(cumulative)) return cumulative;
    return guard(cumulative ? binomialCdf(k, n, p) : binomialPmf(k, n, p));
  },
});

defineFunction({
  name: "BINOM.INV",
  description: "The smallest count whose cumulative reaches the criterion.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [rawN, p, alpha] = read as [number, number, number];
    const n = Math.trunc(rawN);
    if (n < 0 || p < 0 || p > 1 || alpha < 0 || alpha > 1) return NUM_ERROR;
    return guard(binomialInv(n, p, alpha));
  },
});

defineFunction({
  name: "POISSON.DIST",
  description: "Poisson density or cumulative for a mean.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const read = numbers(args, 2);
    if (isFormulaError(read)) return read;
    const [rawK, mean] = read as [number, number];
    const k = Math.trunc(rawK);
    if (k < 0 || mean < 0) return NUM_ERROR;
    const cumulative = cumulativeArg(args, 2);
    if (isFormulaError(cumulative)) return cumulative;
    return guard(cumulative ? poissonCdf(k, mean) : poissonPmf(k, mean));
  },
});

defineFunction({
  name: "HYPGEOM.DIST",
  description: "Hypergeometric density or cumulative for a sample and a pool.",
  minArgs: 5,
  maxArgs: 5,
  call(args) {
    const read = numbers(args, 4);
    if (isFormulaError(read)) return read;
    const [rawK, rawDraws, rawSuccesses, rawPopulation] = read as [
      number,
      number,
      number,
      number,
    ];
    const k = Math.trunc(rawK);
    const draws = Math.trunc(rawDraws);
    const successes = Math.trunc(rawSuccesses);
    const population = Math.trunc(rawPopulation);
    if (population <= 0 || draws < 0 || successes < 0) return NUM_ERROR;
    if (draws > population || successes > population) return NUM_ERROR;
    if (k < 0 || k > draws || k > successes) return NUM_ERROR;
    if (draws - k > population - successes) return NUM_ERROR;
    const cumulative = cumulativeArg(args, 4);
    if (isFormulaError(cumulative)) return cumulative;
    return guard(
      cumulative
        ? hypergeometricCdf(k, draws, successes, population)
        : hypergeometricPmf(k, draws, successes, population),
    );
  },
});

defineFunction({
  name: "NEGBINOM.DIST",
  description: "Negative binomial density or cumulative.",
  minArgs: 4,
  maxArgs: 4,
  call(args) {
    const read = numbers(args, 3);
    if (isFormulaError(read)) return read;
    const [rawFailures, rawSuccesses, p] = read as [number, number, number];
    const failures = Math.trunc(rawFailures);
    const successes = Math.trunc(rawSuccesses);
    if (failures < 0 || successes < 1 || p <= 0 || p > 1) return NUM_ERROR;
    const cumulative = cumulativeArg(args, 3);
    if (isFormulaError(cumulative)) return cumulative;
    return guard(
      cumulative
        ? negativeBinomialCdf(failures, successes, p)
        : negativeBinomialPmf(failures, successes, p),
    );
  },
});
