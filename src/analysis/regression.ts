/**
 * A regression read off the sheet and laid out the way a summary is read.
 *
 * `LINEST` returns the numbers; this arranges them. The two are separate on
 * purpose — the function has to return the block a spreadsheet expects, with
 * the coefficients backwards and the unused corners full of `#N/A`, and that
 * layout is a compatibility obligation rather than a readable one. A person
 * reading a fit wants each predictor on its own line with its coefficient, its
 * standard error and the t statistic beside it, which is what this produces.
 */

import { matrix, numericRows } from "../engine/array.js";
import { isFormulaError } from "../engine/errors.js";
import {
  formatA1,
  formatRange,
  iterateRange,
  normalizeRange,
  parseA1Range,
  rangeHeight,
  rangeWidth,
} from "../engine/reference.js";
import type { RangeRef } from "../engine/reference.js";
import { leastSquares } from "../numeric/linalg.js";
import { fSignificance, twoTailedP } from "../numeric/inference.js";
import type { Workbook } from "../engine/workbook.js";

export class RegressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegressionError";
  }
}

/**
 * The curve families a summary can fit.
 *
 * Three of the four are a linear fit with a transform on the way in: the
 * fitting routine never changes, only what it is handed. Which transform is
 * applied is the whole of the difference between them.
 *
 * - `linear` — `y = b + m x`, fitted on `y`
 * - `exponential` — `y = b m^x`, fitted on `ln y`
 * - `power` — `y = b x^m`, fitted on `ln y` against `ln x`
 * - `logarithmic` — `y = b + m ln x`, fitted on `y` against `ln x`
 */
export const REGRESSION_MODELS = [
  "linear",
  "exponential",
  "power",
  "logarithmic",
] as const;

export type RegressionModel = (typeof REGRESSION_MODELS)[number];

/** Whether the model takes the log of the outcome before fitting. */
function logsOutcome(model: RegressionModel): boolean {
  return model === "exponential" || model === "power";
}

/** Whether the model takes the log of each predictor before fitting. */
function logsPredictors(model: RegressionModel): boolean {
  return model === "power" || model === "logarithmic";
}

/**
 * `ln` of every value, refusing any that has no logarithm.
 *
 * Refused rather than dropped: dropping a row would answer a different
 * question with nothing in the output to say it had.
 */
function logged(values: readonly number[], what: string): number[] {
  return values.map((value) => {
    if (!(value > 0)) {
      throw new RegressionError(
        `a ${what} fit needs every value above zero, and found ${value}`,
      );
    }
    return Math.log(value);
  });
}

/** One predictor's line in the summary. */
export interface Term {
  /** `intercept`, or the address of the column the predictor came from. */
  readonly label: string;
  readonly coefficient: number;
  readonly standardError: number;
  /** Coefficient over its standard error; how many errors from zero it sits. */
  readonly t: number;
  /**
   * The two-tailed probability of a `t` at least this far from zero, if the
   * coefficient really were zero.
   *
   * This is the column the summary was missing. A `t` of 2.31 is significant
   * at the 5% level on eight degrees of freedom and is not on two, and the
   * statistic alone leaves the reader to look that up.
   */
  readonly p: number;
  /**
   * Whether this term's column formed part of the basis.
   *
   * `false` for a column dropped as a linear combination of the others. Its
   * coefficient is zero — which is what it contributes — and that zero is
   * indistinguishable at a glance from a predictor measured to have no
   * effect, which is the reason this flag exists rather than being inferred.
   */
  readonly counted: boolean;
}

export interface Summary {
  readonly terms: readonly Term[];
  readonly observations: number;
  readonly predictors: number;
  readonly df: number;
  readonly rSquared: number;
  readonly adjustedRSquared: number;
  readonly standardError: number;
  readonly f: number;
  readonly ssRegression: number;
  readonly ssResidual: number;
  /**
   * The probability of an `F` this large if every coefficient were zero.
   *
   * The per-term p-values do not answer this. Each of them asks about one
   * predictor with the others held in the model, and with enough predictors
   * one of them clears any threshold by chance; the `F` asks whether the fit
   * as a whole is worth anything, which is the question to ask first.
   */
  readonly significanceF: number;
  /**
   * Columns of the design that formed a basis, intercept included.
   *
   * Equal to `predictors` plus an intercept unless a column was dependent and
   * dropped, which is the one case where the degrees of freedom below cannot
   * be worked out from the predictor count.
   */
  readonly rank: number;
  /** Whether an intercept was fitted, which the rank has to be read against. */
  readonly withIntercept: boolean;
  /**
   * Labels of the predictors that did not count, in the order they were given.
   *
   * Empty unless a column was dropped as dependent. *Which* of a dependent
   * set appears here is settled by the order the columns were given in rather
   * than by the data: they are visited left to right, so the earlier one
   * wins, and two orderings of the same columns drop different ones and fit
   * the same curve. So this names the column the fit did without, not the
   * column that was redundant — there is no such thing, only a redundant set.
   *
   * Never the intercept, which is visited first and so always kept.
   */
  readonly dropped: readonly string[];
  /** The curve family that was fitted. */
  readonly model: RegressionModel;
  /**
   * What the least squares was taken over, which is not always `y`.
   *
   * Every statistic above — the standard errors, the t values, the F, and
   * `rSquared` — belongs to the fit in *this* space. For a model that logs
   * the outcome that is a fit on ratios, so a point predicted at half its
   * value counts the same whether the value is 2 or 2,000,000.
   */
  readonly fittedOn: "y" | "ln y";
  /**
   * R-squared of the curve against the data as given.
   *
   * The same fit has two numbers called R-squared when the outcome was
   * transformed, and spreadsheets report the one in the fitted space — which
   * on a power or an exponential trendline is the log fit's, routinely quoted
   * as though it described the curve against the data. This is the other one,
   * computed from the curve's own predictions in `y`. It is left as it comes
   * out, negative included: a curve can be worse than the mean, and clamping
   * it to zero would hide exactly the case worth seeing.
   *
   * Equal to `rSquared` for a model fitted on `y`.
   */
  readonly rSquaredOnData: number;
  /**
   * The curve's parameters in its own form, for a model fitted on `ln y`.
   *
   * `scale` is the `b` of `y = b x^m` or `y = b m^x` — the exponential of the
   * log-space intercept, not the intercept itself, which is the back-transform
   * a reader is left to do by hand otherwise. `factors` are the exponents `m`
   * of a power curve and the bases `m` of an exponential one, one per
   * predictor. `null` for a model whose coefficients are already in the
   * curve's form.
   */
  readonly curve: {
    readonly scale: number;
    readonly factors: readonly number[];
  } | null;
}

function valuesOf(book: Workbook, range: RangeRef): number[][] {
  const normalized = normalizeRange(range);
  const height = rangeHeight(normalized);
  const width = rangeWidth(normalized);
  const flat = [...iterateRange(normalized)].map((coord) =>
    book.getValue(coord),
  );
  const rows = numericRows(matrix(height, width, flat));
  if (isFormulaError(rows)) {
    throw new RegressionError(
      `${formatRange(normalized)} has to hold numbers and nothing else`,
    );
  }
  return rows;
}

/** A label for the predictor in column `index` of the x block. */
function labelFor(range: RangeRef, index: number): string {
  const normalized = normalizeRange(range);
  return formatA1({
    col: normalized.start.col + index,
    row: normalized.start.row,
    colAbsolute: false,
    rowAbsolute: false,
  }).replace(/\d+$/, "");
}

/**
 * Fit `y` against the columns of `x`, both read from the sheet.
 *
 * `y` has to be a single column; a row would be readable too, but a summary
 * command is written against data laid out in columns and accepting both would
 * only make the error message vaguer when the wrong range is given.
 */
export function summarise(
  book: Workbook,
  yRange: RangeRef,
  xRange: RangeRef,
  withIntercept = true,
  model: RegressionModel = "linear",
): Summary {
  const yBlock = valuesOf(book, yRange);
  if ((yBlock[0]?.length ?? 0) !== 1) {
    throw new RegressionError("the outcome has to be a single column");
  }
  const observed = yBlock.map((row) => row[0]!);
  const given = valuesOf(book, xRange);

  // The transform, and the only thing that distinguishes the four families.
  const y = logsOutcome(model) ? logged(observed, model) : observed;
  const x = logsPredictors(model)
    ? given.map((row) => logged(row, model))
    : given;
  if (x.length !== y.length) {
    throw new RegressionError(
      `${formatRange(yRange)} has ${y.length} rows and ${formatRange(xRange)} has ${x.length}`,
    );
  }

  const k = x[0]?.length ?? 0;
  if (k === 0) throw new RegressionError("there are no predictors");
  const parameters = k + (withIntercept ? 1 : 0);
  if (y.length <= parameters) {
    throw new RegressionError(
      `${y.length} observations cannot fit ${parameters} parameter(s)`,
    );
  }

  const design = x.map((row) => (withIntercept ? [1, ...row] : [...row]));
  const fit = leastSquares(design, y);
  if (fit === null) {
    throw new RegressionError("the design matrix has no rows or no columns");
  }

  const n = y.length;
  // From the rank rather than from the parameter count: a dependent column was
  // dropped and costs no degree of freedom, and this number divides into every
  // standard error, every t, the F and its significance.
  const slopes = fit.rank - (withIntercept ? 1 : 0);
  const df = n - fit.rank;
  const ssResidual = fit.ssResidual;
  let ssTotal = 0;
  if (withIntercept) {
    const mean = y.reduce((a, b) => a + b, 0) / n;
    for (const value of y) ssTotal += (value - mean) * (value - mean);
  } else {
    for (const value of y) ssTotal += value * value;
  }
  const ssRegression = ssTotal - ssResidual;
  const sey = Math.sqrt(ssResidual / df);

  const terms: Term[] = [];
  const offset = withIntercept ? 1 : 0;
  // Which design columns formed the basis. The set is read per term rather
  // than inferred from a zero coefficient, since a predictor can honestly
  // measure zero.
  const basis = new Set(fit.basis);
  if (withIntercept) {
    const se = sey * Math.sqrt(Math.max(fit.variance[0]!, 0));
    const t = se === 0 ? Number.NaN : fit.coefficients[0]! / se;
    terms.push({
      label: "intercept",
      coefficient: fit.coefficients[0]!,
      standardError: se,
      t,
      p: Number.isNaN(t) ? Number.NaN : twoTailedP(t, df),
      counted: basis.has(0),
    });
  }
  for (let j = 0; j < k; j++) {
    const se = sey * Math.sqrt(Math.max(fit.variance[offset + j]!, 0));
    const t = se === 0 ? Number.NaN : fit.coefficients[offset + j]! / se;
    terms.push({
      label: labelFor(xRange, j),
      coefficient: fit.coefficients[offset + j]!,
      standardError: se,
      t,
      p: Number.isNaN(t) ? Number.NaN : twoTailedP(t, df),
      counted: basis.has(offset + j),
    });
  }

  const rSquared = ssTotal === 0 ? 1 : ssRegression / ssTotal;
  // Adjusted for how many predictors were spent reaching it: adding a column
  // can only raise R-squared, so the unadjusted figure always rewards a bigger
  // model and says nothing about whether the column was worth including.
  const adjustedRSquared = withIntercept
    ? 1 - ((1 - rSquared) * (n - 1)) / df
    : 1 - ((1 - rSquared) * n) / df;

  const f =
    ssResidual === 0 || slopes === 0
      ? Number.POSITIVE_INFINITY
      : ssRegression / slopes / (ssResidual / df);

  // The curve's own parameters, and its R-squared against the data as given.
  // Both are read off the same coefficients; what differs is that one of them
  // undoes the transform first.
  const intercept = withIntercept ? fit.coefficients[0]! : 0;
  const slopeList = fit.coefficients.slice(offset, offset + k);
  const curve = logsOutcome(model)
    ? {
        scale: Math.exp(intercept),
        factors:
          model === "power" ? [...slopeList] : slopeList.map((s) => Math.exp(s)),
      }
    : null;

  let rSquaredOnData = rSquared;
  if (logsOutcome(model)) {
    const meanObserved =
      observed.reduce((total, value) => total + value, 0) / n;
    let residual = 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      // The prediction in the fitted space, then undone -- the curve itself,
      // which is what a reader plots and compares against the points.
      let logPrediction = intercept;
      for (let j = 0; j < k; j++) logPrediction += slopeList[j]! * x[i]![j]!;
      const prediction = Math.exp(logPrediction);
      residual += (observed[i]! - prediction) * (observed[i]! - prediction);
      total += withIntercept
        ? (observed[i]! - meanObserved) * (observed[i]! - meanObserved)
        : observed[i]! * observed[i]!;
    }
    rSquaredOnData = total === 0 ? 1 : 1 - residual / total;
  }

  return {
    terms,
    observations: n,
    predictors: k,
    df,
    rSquared,
    adjustedRSquared,
    standardError: sey,
    f,
    ssRegression,
    ssResidual,
    significanceF: Number.isFinite(f) ? fSignificance(f, slopes, df) : 0,
    rank: fit.rank,
    withIntercept,
    dropped: terms
      .filter((term) => !term.counted && term.label !== "intercept")
      .map((term) => term.label),
    model,
    fittedOn: logsOutcome(model) ? "ln y" : "y",
    rSquaredOnData,
    curve,
  };
}

/** `<y> by <x>` — the shape the shell command takes. */
export function parseRegressCommand(
  tail: string,
):
  | {
      y: RangeRef;
      x: RangeRef;
      withIntercept: boolean;
      model: RegressionModel;
    }
  | string {
  let text = tail.trim();

  // `as <model>` is lifted out first so that it and `through zero` can be
  // written in either order, as the amortise clauses can.
  let model: RegressionModel = "linear";
  const asMatch = /\s+as\s+(\S+)/i.exec(text);
  if (asMatch !== null) {
    const named = asMatch[1]!.toLowerCase();
    const found = REGRESSION_MODELS.find((candidate) => candidate === named);
    if (found === undefined) {
      return `not a curve this fits: ${asMatch[1]} — ${REGRESSION_MODELS.join(", ")}`;
    }
    model = found;
    text = (text.slice(0, asMatch.index) + text.slice(asMatch.index + asMatch[0].length)).trim();
  }

  const match = /^(\S+)\s+by\s+(\S+)(\s+through\s+zero)?$/i.exec(text);
  if (match === null) {
    return "usage: .regress B2:B12 by C2:F12 [as power] [through zero]";
  }
  try {
    return {
      y: parseA1Range(match[1]!),
      x: parseA1Range(match[2]!),
      withIntercept: match[3] === undefined,
      model,
    };
  } catch {
    return "both arguments have to be blocks, like B2:B12";
  }
}
