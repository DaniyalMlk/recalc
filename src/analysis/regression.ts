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
import type { Workbook } from "../engine/workbook.js";

export class RegressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegressionError";
  }
}

/** One predictor's line in the summary. */
export interface Term {
  /** `intercept`, or the address of the column the predictor came from. */
  readonly label: string;
  readonly coefficient: number;
  readonly standardError: number;
  /** Coefficient over its standard error; how many errors from zero it sits. */
  readonly t: number;
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
): Summary {
  const yBlock = valuesOf(book, yRange);
  if ((yBlock[0]?.length ?? 0) !== 1) {
    throw new RegressionError("the outcome has to be a single column");
  }
  const y = yBlock.map((row) => row[0]!);
  const x = valuesOf(book, xRange);
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
    throw new RegressionError("the predictors are linearly dependent");
  }

  const n = y.length;
  const df = n - parameters;
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
  if (withIntercept) {
    const se = sey * Math.sqrt(Math.max(fit.variance[0]!, 0));
    terms.push({
      label: "intercept",
      coefficient: fit.coefficients[0]!,
      standardError: se,
      t: se === 0 ? Number.NaN : fit.coefficients[0]! / se,
    });
  }
  for (let j = 0; j < k; j++) {
    const se = sey * Math.sqrt(Math.max(fit.variance[offset + j]!, 0));
    terms.push({
      label: labelFor(xRange, j),
      coefficient: fit.coefficients[offset + j]!,
      standardError: se,
      t: se === 0 ? Number.NaN : fit.coefficients[offset + j]! / se,
    });
  }

  const rSquared = ssTotal === 0 ? 1 : ssRegression / ssTotal;
  // Adjusted for how many predictors were spent reaching it: adding a column
  // can only raise R-squared, so the unadjusted figure always rewards a bigger
  // model and says nothing about whether the column was worth including.
  const adjustedRSquared = withIntercept
    ? 1 - ((1 - rSquared) * (n - 1)) / df
    : 1 - ((1 - rSquared) * n) / df;

  return {
    terms,
    observations: n,
    predictors: k,
    df,
    rSquared,
    adjustedRSquared,
    standardError: sey,
    f: ssResidual === 0 ? Number.POSITIVE_INFINITY : (ssRegression / k) / (ssResidual / df),
    ssRegression,
    ssResidual,
  };
}

/** `<y> by <x>` — the shape the shell command takes. */
export function parseRegressCommand(
  tail: string,
): { y: RangeRef; x: RangeRef; withIntercept: boolean } | string {
  const text = tail.trim();
  const match = /^(\S+)\s+by\s+(\S+)(\s+through\s+zero)?$/i.exec(text);
  if (match === null) {
    return "usage: .regress B2:B12 by C2:F12 [through zero]";
  }
  try {
    return {
      y: parseA1Range(match[1]!),
      x: parseA1Range(match[2]!),
      withIntercept: match[3] === undefined,
    };
  } catch {
    return "both arguments have to be blocks, like B2:B12";
  }
}
