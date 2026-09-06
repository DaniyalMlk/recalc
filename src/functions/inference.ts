/**
 * The hypothesis-test functions.
 *
 * These read blocks rather than scalars, which is what makes them different
 * from the distribution pack: the shape of the argument is part of the
 * question. `CHISQ.TEST` takes its degrees of freedom from whether the blocks
 * are a strip or a table, and `T.TEST` in its paired form requires the two
 * ranges to line up. Reading them as flat lists of numbers and counting would
 * give an answer in both cases, and the wrong one in the second.
 */

import { DIV0_ERROR, NA_ERROR, NUM_ERROR, isFormulaError } from "../engine/errors.js";
import type { FormulaError } from "../engine/errors.js";
import { kindOf } from "../engine/value.js";
import type { Value } from "../engine/value.js";
import {
  chiSquareTest,
  confidenceNormal,
  confidenceStudent,
  pairedT,
  pooledT,
  varianceRatioTest,
  welchT,
  zTest,
} from "../numeric/inference.js";
import { argMatrix, defineFunction, numberArg } from "./registry.js";
import type { Arg } from "./registry.js";

function guard(n: number): Value {
  return Number.isFinite(n) ? n : NUM_ERROR;
}

/** A block's numbers, its shape kept, with text and blanks dropped. */
interface Sample {
  readonly values: number[];
  readonly rows: number;
  readonly cols: number;
}

/**
 * Read one argument as a sample.
 *
 * Text and blanks are skipped rather than coerced, which is the aggregate rule
 * the rest of the engine uses for a block: a column of figures under a heading
 * should still be testable. An error anywhere is fatal, because a test run over
 * a value that failed to compute is not a test.
 */
function sampleArg(arg: Arg | undefined): Sample | FormulaError {
  if (arg === undefined) return NUM_ERROR;
  const block = argMatrix(arg);
  const values: number[] = [];
  for (const value of block.values) {
    if (isFormulaError(value)) return value;
    if (kindOf(value) === "number") values.push(value as number);
  }
  return { values, rows: block.rows, cols: block.cols };
}

defineFunction({
  name: "T.TEST",
  description:
    "Probability from a t test: 1 paired, 2 equal variance, 3 unequal.",
  minArgs: 4,
  maxArgs: 4,
  call(args) {
    const first = sampleArg(args[0]);
    if (isFormulaError(first)) return first;
    const second = sampleArg(args[1]);
    if (isFormulaError(second)) return second;
    const tailsValue = numberArg(args[2]);
    if (isFormulaError(tailsValue)) return tailsValue;
    const typeValue = numberArg(args[3]);
    if (isFormulaError(typeValue)) return typeValue;

    const tails = Math.trunc(tailsValue);
    const type = Math.trunc(typeValue);
    if (tails !== 1 && tails !== 2) return NUM_ERROR;
    if (type !== 1 && type !== 2 && type !== 3) return NUM_ERROR;
    if (first.values.length < 2 || second.values.length < 2) return DIV0_ERROR;

    if (type === 1) {
      // Pairing needs the two samples to correspond one for one; unequal
      // lengths are `#N/A` rather than a silent truncation to the shorter.
      if (first.values.length !== second.values.length) return NA_ERROR;
      const result = pairedT(first.values, second.values);
      return guard(tails === 1 ? result.p / 2 : result.p);
    }
    const result =
      type === 2 ? pooledT(first.values, second.values) : welchT(first.values, second.values);
    return guard(tails === 1 ? result.p / 2 : result.p);
  },
});

defineFunction({
  name: "F.TEST",
  description: "Two-tailed probability that two samples share a variance.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const first = sampleArg(args[0]);
    if (isFormulaError(first)) return first;
    const second = sampleArg(args[1]);
    if (isFormulaError(second)) return second;
    if (first.values.length < 2 || second.values.length < 2) return DIV0_ERROR;
    const result = varianceRatioTest(first.values, second.values);
    if (!Number.isFinite(result.f)) return DIV0_ERROR;
    return guard(result.p);
  },
});

defineFunction({
  name: "CHISQ.TEST",
  description: "Independence test over an observed and an expected block.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const observed = sampleArg(args[0]);
    if (isFormulaError(observed)) return observed;
    const expected = sampleArg(args[1]);
    if (isFormulaError(expected)) return expected;
    if (
      observed.rows !== expected.rows ||
      observed.cols !== expected.cols ||
      observed.values.length !== expected.values.length
    ) {
      return NA_ERROR;
    }
    if (observed.values.length < 2) return NA_ERROR;
    for (const value of expected.values) {
      if (value <= 0) return DIV0_ERROR;
    }
    const result = chiSquareTest(
      observed.values,
      expected.values,
      observed.rows,
      observed.cols,
    );
    if (result.df < 1) return NA_ERROR;
    return guard(result.p);
  },
});

defineFunction({
  name: "Z.TEST",
  description: "One-tailed probability of a sample mean against a hypothesis.",
  minArgs: 2,
  maxArgs: 3,
  call(args) {
    const sample = sampleArg(args[0]);
    if (isFormulaError(sample)) return sample;
    const hypothesised = numberArg(args[1]);
    if (isFormulaError(hypothesised)) return hypothesised;
    let sigma: number | undefined;
    if (args.length > 2) {
      const value = numberArg(args[2]);
      if (isFormulaError(value)) return value;
      if (value <= 0) return NUM_ERROR;
      sigma = value;
    }
    if (sample.values.length < 2) return DIV0_ERROR;
    return guard(zTest(sample.values, hypothesised, sigma));
  },
});

defineFunction({
  name: "CONFIDENCE.NORM",
  description: "Half-width of a normal confidence interval.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const alpha = numberArg(args[0]);
    if (isFormulaError(alpha)) return alpha;
    const sigma = numberArg(args[1]);
    if (isFormulaError(sigma)) return sigma;
    const sizeValue = numberArg(args[2]);
    if (isFormulaError(sizeValue)) return sizeValue;
    const size = Math.trunc(sizeValue);
    if (alpha <= 0 || alpha >= 1 || sigma <= 0 || size < 1) return NUM_ERROR;
    return guard(confidenceNormal(alpha, sigma, size));
  },
});

defineFunction({
  name: "CONFIDENCE.T",
  description: "Half-width of an interval when the deviation is estimated.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const alpha = numberArg(args[0]);
    if (isFormulaError(alpha)) return alpha;
    const sigma = numberArg(args[1]);
    if (isFormulaError(sigma)) return sigma;
    const sizeValue = numberArg(args[2]);
    if (isFormulaError(sizeValue)) return sizeValue;
    const size = Math.trunc(sizeValue);
    if (alpha <= 0 || alpha >= 1 || sigma <= 0 || size < 1) return NUM_ERROR;
    // A single observation has no degrees of freedom left to estimate a spread
    // from, so the interval is unbounded rather than merely wide.
    if (size === 1) return DIV0_ERROR;
    return guard(confidenceStudent(alpha, sigma, size));
  },
});
