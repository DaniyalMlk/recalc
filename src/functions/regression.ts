import { matrix, numericRows } from "../engine/array.js";
import type { Matrix } from "../engine/array.js";
import {
  DIV0_ERROR,
  NA_ERROR,
  VALUE_ERROR,
  err,
  isFormulaError,
} from "../engine/errors.js";
import type { FormulaError } from "../engine/errors.js";
import { leastSquares } from "../numeric/linalg.js";
import type { Fit } from "../numeric/linalg.js";
import type { Value } from "../engine/value.js";
import { argMatrix, argValues, defineFunction, numberArg } from "./registry.js";
import type { Arg } from "./registry.js";

/**
 * Linear regression, and the statistics that come with a fit.
 *
 * All of it runs through one function: read the observations, build a design
 * matrix, fit it once, and answer whichever question was asked from the same
 * `Fit`. `SLOPE` and `LINEST` and `TREND` and `RSQ` are then four views of one
 * computation rather than four re-derivations that can drift apart, and the
 * tests can check them against each other because they are supposed to agree
 * exactly rather than nearly.
 */

// ---------------------------------------------------------------------------
// Reading the observations
// ---------------------------------------------------------------------------

/** Observations laid out as one row per case and one column per predictor. */
interface Observations {
  /** One row per case; each row is the predictors for that case. */
  readonly x: number[][];
  readonly y: number[];
  /** Number of predictors. */
  readonly k: number;
}

/**
 * A block of numbers, refusing anything that is not one.
 *
 * Unlike an aggregate, a fit cannot skip a stray text cell: dropping one entry
 * from `known_y` without dropping the matching row of `known_x` silently pairs
 * every later observation with the wrong case.
 */
function numericBlock(arg: Arg): number[][] | FormulaError {
  return numericRows(argMatrix(arg));
}

/** A block read as a flat list of numbers, row-major. */
function numericList(arg: Arg): number[] | FormulaError {
  const rows = numericBlock(arg);
  if (isFormulaError(rows)) return rows;
  return rows.flat();
}

/**
 * Line up `known_y` with `known_x`.
 *
 * The orientation of `known_y` decides everything: a column of y means each
 * *column* of x is a variable, a row of y means each *row* of x is. This is
 * the spreadsheet convention and it is not arbitrary — it is what lets a
 * multiple regression be written by selecting the block of predictors that
 * sits beside the column of outcomes, in the direction the data is laid out.
 */
function observationsOf(
  yArg: Arg,
  xArg: Arg | undefined,
): Observations | FormulaError {
  const yBlock = numericBlock(yArg);
  if (isFormulaError(yBlock)) return yBlock;

  const yRows = yBlock.length;
  const yCols = yBlock[0]?.length ?? 0;
  if (yRows === 0 || yCols === 0) return VALUE_ERROR;
  if (yRows > 1 && yCols > 1) {
    return err("#REF!", "known_y has to be a single row or a single column");
  }

  const y = yBlock.flat();
  const n = y.length;
  const asColumn = yCols === 1;

  if (xArg === undefined) {
    // The default predictor is 1, 2, 3, ... which makes TREND a fit against
    // position and LINEST a fit against the index.
    return { x: y.map((_, i) => [i + 1]), y, k: 1 };
  }

  const xBlock = numericBlock(xArg);
  if (isFormulaError(xBlock)) return xBlock;
  const xRows = xBlock.length;
  const xCols = xBlock[0]?.length ?? 0;
  if (xRows === 0 || xCols === 0) return VALUE_ERROR;

  // Cases run down the block when y is a column, and across it when y is a row.
  if (asColumn) {
    if (xRows !== n) return err("#REF!", "known_x and known_y disagree in length");
    return { x: xBlock.map((row) => [...row]), y, k: xCols };
  }
  if (xCols !== n) return err("#REF!", "known_x and known_y disagree in length");
  const x: number[][] = [];
  for (let i = 0; i < n; i++) {
    x.push(xBlock.map((row) => row[i]!));
  }
  return { x, y, k: xRows };
}

/** The design matrix, with a leading column of ones unless told otherwise. */
function designOf(obs: Observations, withIntercept: boolean): number[][] {
  return obs.x.map((row) => (withIntercept ? [1, ...row] : [...row]));
}

/** A trailing optional argument read as a flag, defaulting to true. */
function flagArg(arg: Arg | undefined, fallback = true): boolean | FormulaError {
  if (arg === undefined) return fallback;
  const values = argValues(arg);
  const value = values[0] ?? null;
  if (isFormulaError(value)) return value;
  if (value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return VALUE_ERROR;
}

// ---------------------------------------------------------------------------
// The fit and its statistics
// ---------------------------------------------------------------------------

interface Regression {
  readonly fit: Fit;
  readonly obs: Observations;
  readonly withIntercept: boolean;
  /** Predictor count, not counting the intercept. */
  readonly k: number;
  /** Residual degrees of freedom. */
  readonly df: number;
  readonly ssResidual: number;
  readonly ssRegression: number;
  readonly ssTotal: number;
}

/**
 * Fit, and work out the sums of squares the statistics are built on.
 *
 * With an intercept the total is measured about the mean of `y`, because the
 * model is being compared against "predict the mean every time". Forced through
 * zero the comparison is against "predict zero every time", so the total is the
 * raw sum of squares. Using the centred total in the second case is the classic
 * way to end up with a negative R-squared.
 */
function regress(
  obs: Observations,
  withIntercept: boolean,
): Regression | FormulaError {
  const n = obs.y.length;
  const parameters = obs.k + (withIntercept ? 1 : 0);
  if (n <= parameters) {
    return err("#DIV/0!", "not enough observations for the predictors given");
  }

  const fit = leastSquares(designOf(obs, withIntercept), obs.y);
  if (fit === null) {
    return err("#NUM!", "the predictors are linearly dependent");
  }

  let ssTotal = 0;
  if (withIntercept) {
    const mean = obs.y.reduce((a, b) => a + b, 0) / n;
    for (const value of obs.y) ssTotal += (value - mean) * (value - mean);
  } else {
    for (const value of obs.y) ssTotal += value * value;
  }

  const ssResidual = fit.ssResidual;
  return {
    fit,
    obs,
    withIntercept,
    k: obs.k,
    df: n - parameters,
    ssResidual,
    ssRegression: ssTotal - ssResidual,
    ssTotal,
  };
}

/** Fit from the raw arguments, the path every function here begins with. */
function fitFrom(
  yArg: Arg,
  xArg: Arg | undefined,
  constArg: Arg | undefined,
): Regression | FormulaError {
  const obs = observationsOf(yArg, xArg);
  if (isFormulaError(obs)) return obs;
  const withIntercept = flagArg(constArg);
  if (isFormulaError(withIntercept)) return withIntercept;
  return regress(obs, withIntercept);
}

/** Standard error of the estimate: the residual standard deviation. */
function standardError(r: Regression): number {
  return Math.sqrt(r.ssResidual / r.df);
}

/** Coefficients in the order a spreadsheet reports them: last slope first. */
function reportedCoefficients(r: Regression): number[] {
  const c = r.fit.coefficients;
  const slopes = r.withIntercept ? c.slice(1) : [...c];
  const intercept = r.withIntercept ? c[0]! : 0;
  return [...slopes.reverse(), intercept];
}

function reportedStandardErrors(r: Regression): number[] {
  const sey = standardError(r);
  const se = r.fit.variance.map((v) => sey * Math.sqrt(Math.max(v, 0)));
  const slopes = r.withIntercept ? se.slice(1) : [...se];
  // With no intercept there is no intercept to have an error, and #N/A says so
  // rather than a zero that reads as "measured, and exactly nothing".
  const intercept = r.withIntercept ? se[0]! : Number.NaN;
  return [...slopes.reverse(), intercept];
}

// ---------------------------------------------------------------------------
// LINEST
// ---------------------------------------------------------------------------

/**
 * The five-row statistics block.
 *
 * Row 1 the coefficients, row 2 their standard errors, row 3 the R-squared and
 * the standard error of the estimate, row 4 the F statistic and the degrees of
 * freedom, row 5 the regression and residual sums of squares. Rows 3 to 5 use
 * only their first two columns; the rest are `#N/A`, which is the shape a
 * spreadsheet expects and is more honest than padding with blanks that would
 * read as zeros.
 */
function linestStatistics(r: Regression): Matrix {
  const width = r.k + 1;
  const coefficients = reportedCoefficients(r);
  const errors = reportedStandardErrors(r);
  const sey = standardError(r);
  const r2 = r.ssTotal === 0 ? 1 : r.ssRegression / r.ssTotal;
  const regressionDf = r.withIntercept ? r.k : r.k;
  const f =
    r.ssResidual === 0
      ? Number.POSITIVE_INFINITY
      : (r.ssRegression / regressionDf) / (r.ssResidual / r.df);

  const values: Value[] = [];
  const pad = (first: Value, second: Value): void => {
    values.push(first, second);
    for (let i = 2; i < width; i++) values.push(NA_ERROR);
  };

  for (const value of coefficients) values.push(value);
  for (const value of errors) {
    values.push(Number.isNaN(value) ? NA_ERROR : value);
  }
  if (width === 1) {
    // A single-column block has no room for the second statistic of each pair,
    // which is exactly the shape a one-predictor no-intercept fit produces.
    values.push(r2, Number.isFinite(f) ? f : NA_ERROR, r.ssRegression);
  } else {
    pad(r2, sey);
    pad(Number.isFinite(f) ? f : NA_ERROR, r.df);
    pad(r.ssRegression, r.ssResidual);
  }
  return matrix(5, width, values);
}

defineFunction({
  name: "LINEST",
  description:
    "Least-squares fit: LINEST(known_y, [known_x], [const], [stats]).",
  minArgs: 1,
  maxArgs: 4,
  call(args) {
    const r = fitFrom(args[0]!, args[1], args[2]);
    if (isFormulaError(r)) return r;
    const wantStats = flagArg(args[3], false);
    if (isFormulaError(wantStats)) return wantStats;

    if (!wantStats) {
      const coefficients = reportedCoefficients(r);
      return matrix(1, coefficients.length, coefficients);
    }
    return linestStatistics(r);
  },
});

/**
 * The cases a fitted-value function is asked about.
 *
 * Shared by `TREND` and `GROWTH`, which differ only in what they do with the
 * fitted number — and the reading of `new_x` is where the fiddly part is, so
 * having it in one place is the point.
 */
function casesFor(
  r: Regression,
  newXArg: Arg | undefined,
): number[][] | FormulaError {
  // No new points asked for, so the answer is the fit at the points given.
  if (newXArg === undefined) return r.obs.x.map((row) => [...row]);

  const newX = numericBlock(newXArg);
  if (isFormulaError(newX)) return newX;
  if (newX.length === 0) return VALUE_ERROR;

  // A single predictor may be given as a row or a column; more than one has
  // to be laid out one case per row, matching how known_x was read.
  const cases =
    r.k === 1 && (newX[0]?.length ?? 0) !== 1
      ? newX.flat().map((v) => [v])
      : newX;
  if ((cases[0]?.length ?? 0) !== r.k) {
    return err("#REF!", `each new case needs ${r.k} predictor(s)`);
  }
  return cases;
}

defineFunction({
  name: "TREND",
  description:
    "Fitted values along a linear fit: TREND(known_y, [known_x], [new_x], [const]).",
  minArgs: 1,
  maxArgs: 4,
  call(args) {
    const r = fitFrom(args[0]!, args[1], args[3]);
    if (isFormulaError(r)) return r;
    const cases = casesFor(r, args[2]);
    if (isFormulaError(cases)) return cases;
    const fitted = cases.map((row) => predict(r, row));
    return matrix(fitted.length, 1, fitted);
  },
});

// ---------------------------------------------------------------------------
// The exponential pair
// ---------------------------------------------------------------------------

/**
 * `y = b · m₁^x₁ · m₂^x₂ · …`, fitted by taking the log of both sides.
 *
 * Logging turns the model into `ln y = ln b + x₁ ln m₁ + …`, which is a plain
 * multiple regression, so these two functions are the linear pair with a
 * transform on the way in and its inverse on the way out rather than a second
 * fitting routine.
 *
 * **The transform changes what is being minimised, and that is not a detail.**
 * Least squares on `ln y` makes the residuals *ratios* rather than differences:
 * a point predicted at half its value counts the same whether the value is 2
 * or 2,000,000. So the curve these draw is the one with the smallest squared
 * *relative* error, and it is not the exponential with the smallest squared
 * error in `y` — the two are different curves, and on a series with any spread
 * in it they are visibly different. Which is wanted depends on the question,
 * and spreadsheets have always answered the relative one, but a reader who
 * takes `GROWTH` for "the best-fitting exponential" without qualification has
 * the wrong curve.
 *
 * A non-positive `known_y` has no log, so it is refused rather than dropped:
 * dropping it would answer a different question with no sign that it had.
 */
function loggedObservations(obs: Observations): Observations | FormulaError {
  const y: number[] = [];
  for (const value of obs.y) {
    if (!(value > 0)) {
      return err("#NUM!", "an exponential fit needs every known_y above zero");
    }
    y.push(Math.log(value));
  }
  return { x: obs.x, y, k: obs.k };
}

/** The log-space fit the exponential pair is read off. */
function exponentialFitFrom(
  yArg: Arg,
  xArg: Arg | undefined,
  constArg: Arg | undefined,
): Regression | FormulaError {
  const obs = observationsOf(yArg, xArg);
  if (isFormulaError(obs)) return obs;
  const logged = loggedObservations(obs);
  if (isFormulaError(logged)) return logged;
  const withIntercept = flagArg(constArg);
  if (isFormulaError(withIntercept)) return withIntercept;
  return regress(logged, withIntercept);
}

defineFunction({
  name: "LOGEST",
  description:
    "Exponential fit: LOGEST(known_y, [known_x], [const], [stats]).",
  minArgs: 1,
  maxArgs: 4,
  call(args) {
    const r = exponentialFitFrom(args[0]!, args[1], args[2]);
    if (isFormulaError(r)) return r;
    const wantStats = flagArg(args[3], false);
    if (isFormulaError(wantStats)) return wantStats;

    // The multipliers are the exponentials of the log-space coefficients.
    // Forced through `b = 1`, the intercept in log space is zero and its
    // exponential is one, which is the constraint rather than a special case.
    const multipliers = reportedCoefficients(r).map((value) => Math.exp(value));
    if (!wantStats) {
      return matrix(1, multipliers.length, multipliers);
    }

    // Everything below the first row is the log-space fit's, unchanged. The
    // standard errors in particular belong to the *exponents*: the error on
    // `ln m`, not on `m`, and exponentiating one does not give the other.
    const stats = linestStatistics(r);
    const values = [...stats.values];
    for (const [index, value] of multipliers.entries()) values[index] = value;
    return matrix(stats.rows, stats.cols, values);
  },
});

defineFunction({
  name: "GROWTH",
  description:
    "Fitted values along an exponential fit: GROWTH(known_y, [known_x], [new_x], [const]).",
  minArgs: 1,
  maxArgs: 4,
  call(args) {
    const r = exponentialFitFrom(args[0]!, args[1], args[3]);
    if (isFormulaError(r)) return r;
    const cases = casesFor(r, args[2]);
    if (isFormulaError(cases)) return cases;
    const fitted = cases.map((row) => Math.exp(predict(r, row)));
    return matrix(fitted.length, 1, fitted);
  },
});

/** The fitted value at one case's predictors. */
function predict(r: Regression, predictors: readonly number[]): number {
  const c = r.fit.coefficients;
  let total = r.withIntercept ? c[0]! : 0;
  const offset = r.withIntercept ? 1 : 0;
  for (let j = 0; j < predictors.length; j++) {
    total += c[offset + j]! * predictors[j]!;
  }
  return total;
}

// ---------------------------------------------------------------------------
// The single-variable statistics
// ---------------------------------------------------------------------------

/** A simple fit of one y against one x, which several functions need. */
function simpleFit(yArg: Arg, xArg: Arg): Regression | FormulaError {
  const r = fitFrom(yArg, xArg, undefined);
  if (isFormulaError(r)) return r;
  if (r.k !== 1) {
    return err("#N/A", "this takes one predictor, not several");
  }
  return r;
}

defineFunction({
  name: "SLOPE",
  description: "Slope of the least-squares line through the points.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const r = simpleFit(args[0]!, args[1]!);
    if (isFormulaError(r)) return r;
    return r.fit.coefficients[1]!;
  },
});

defineFunction({
  name: "INTERCEPT",
  description: "Where the least-squares line crosses the y axis.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const r = simpleFit(args[0]!, args[1]!);
    if (isFormulaError(r)) return r;
    return r.fit.coefficients[0]!;
  },
});

defineFunction({
  name: "STEYX",
  description: "Standard error of the predicted y for each x.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const r = simpleFit(args[0]!, args[1]!);
    if (isFormulaError(r)) return r;
    return standardError(r);
  },
});

defineFunction({
  name: "FORECAST",
  description: "The fitted y at a new x: FORECAST(x, known_y, known_x).",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const x = numberArg(args[0]);
    if (isFormulaError(x)) return x;
    const r = simpleFit(args[1]!, args[2]!);
    if (isFormulaError(r)) return r;
    return predict(r, [x]);
  },
});

defineFunction({
  name: "FORECAST.LINEAR",
  description: "The fitted y at a new x, the same as FORECAST.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const x = numberArg(args[0]);
    if (isFormulaError(x)) return x;
    const r = simpleFit(args[1]!, args[2]!);
    if (isFormulaError(r)) return r;
    return predict(r, [x]);
  },
});

// ---------------------------------------------------------------------------
// Correlation and covariance
// ---------------------------------------------------------------------------

/** Two equally long lists of numbers, or the reason there are not. */
function pairsOf(
  aArg: Arg,
  bArg: Arg,
): { a: number[]; b: number[] } | FormulaError {
  const a = numericList(aArg);
  if (isFormulaError(a)) return a;
  const b = numericList(bArg);
  if (isFormulaError(b)) return b;
  if (a.length !== b.length) {
    return err("#N/A", "the two ranges have different lengths");
  }
  if (a.length === 0) return DIV0_ERROR;
  return { a, b };
}

/** Sums about the means, which every one of these statistics is built from. */
function moments(a: readonly number[], b: readonly number[]) {
  const n = a.length;
  const meanA = a.reduce((x, y) => x + y, 0) / n;
  const meanB = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return { n, meanA, meanB, sab, saa, sbb };
}

function correlation(a: readonly number[], b: readonly number[]): Value {
  const { sab, saa, sbb } = moments(a, b);
  const denominator = Math.sqrt(saa * sbb);
  // Either list being constant leaves the correlation undefined rather than
  // zero: there is no direction to agree or disagree with.
  if (denominator === 0) return DIV0_ERROR;
  return sab / denominator;
}

for (const name of ["CORREL", "PEARSON"] as const) {
  defineFunction({
    name,
    description: "Pearson correlation coefficient of two ranges.",
    minArgs: 2,
    maxArgs: 2,
    call(args) {
      const pair = pairsOf(args[0]!, args[1]!);
      if (isFormulaError(pair)) return pair;
      return correlation(pair.a, pair.b);
    },
  });
}

defineFunction({
  name: "RSQ",
  description: "Square of the Pearson correlation coefficient.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const pair = pairsOf(args[0]!, args[1]!);
    if (isFormulaError(pair)) return pair;
    const r = correlation(pair.a, pair.b);
    return typeof r === "number" ? r * r : r;
  },
});

defineFunction({
  name: "COVARIANCE.P",
  description: "Population covariance of two ranges.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const pair = pairsOf(args[0]!, args[1]!);
    if (isFormulaError(pair)) return pair;
    const { n, sab } = moments(pair.a, pair.b);
    return sab / n;
  },
});

defineFunction({
  name: "COVARIANCE.S",
  description: "Sample covariance of two ranges.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const pair = pairsOf(args[0]!, args[1]!);
    if (isFormulaError(pair)) return pair;
    const { n, sab } = moments(pair.a, pair.b);
    if (n < 2) return DIV0_ERROR;
    return sab / (n - 1);
  },
});
