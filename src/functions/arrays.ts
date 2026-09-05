import { matrix, transposeMatrix } from "../engine/array.js";
import { NUM_ERROR, VALUE_ERROR, err, isFormulaError } from "../engine/errors.js";
import { MAX_COLUMNS, MAX_ROWS } from "../engine/reference.js";
import type { Value } from "../engine/value.js";
import { argMatrix, defineFunction, numberArg } from "./registry.js";
import type { Arg } from "./registry.js";

/**
 * The functions whose answer is a block rather than a value.
 *
 * They are what makes the spill path reachable from a formula, and they are
 * deliberately the simplest two that do so: one reshapes an existing block and
 * one builds a block out of nothing, which between them cover both ways a
 * spill region can come into existence.
 */

defineFunction({
  name: "TRANSPOSE",
  description: "Flips a block so its rows become columns.",
  minArgs: 1,
  maxArgs: 1,
  acceptsErrors: true,
  call(args) {
    return transposeMatrix(argMatrix(args[0]!));
  },
});

/** A count argument: a positive whole number, or an error explaining why not. */
function countArg(arg: Arg | undefined, fallback: number): number | Value {
  if (arg === undefined) return fallback;
  const n = numberArg(arg);
  if (isFormulaError(n)) return n;
  const whole = Math.trunc(n);
  if (whole < 1) return VALUE_ERROR;
  return whole;
}

defineFunction({
  name: "SEQUENCE",
  description:
    "Builds a block of consecutive numbers: SEQUENCE(rows, [cols], [start], [step]).",
  minArgs: 1,
  maxArgs: 4,
  call(args) {
    const rows = countArg(args[0], 1);
    if (typeof rows !== "number") return rows;
    const cols = countArg(args[1], 1);
    if (typeof cols !== "number") return cols;

    // The limit is the sheet's, not an arbitrary one: a block that cannot be
    // laid down is better refused here than spilled into a `#REF!`.
    if (rows > MAX_ROWS || cols > MAX_COLUMNS) return NUM_ERROR;

    const start = args[2] === undefined ? 1 : numberArg(args[2]);
    if (isFormulaError(start)) return start;
    const step = args[3] === undefined ? 1 : numberArg(args[3]);
    if (isFormulaError(step)) return step;

    const values: Value[] = new Array<Value>(rows * cols);
    for (let i = 0; i < rows * cols; i++) {
      const n = start + i * step;
      values[i] = Number.isFinite(n) ? n : NUM_ERROR;
    }
    return matrix(rows, cols, values);
  },
});

defineFunction({
  name: "ARRAYROWS",
  description: "Row count of a block.",
  minArgs: 1,
  maxArgs: 1,
  acceptsErrors: true,
  call: (args) => argMatrix(args[0]!).rows,
});

defineFunction({
  name: "ARRAYCOLS",
  description: "Column count of a block.",
  minArgs: 1,
  maxArgs: 1,
  acceptsErrors: true,
  call: (args) => argMatrix(args[0]!).cols,
});

defineFunction({
  name: "TOROW",
  description: "Flattens a block into a single row, row-major.",
  minArgs: 1,
  maxArgs: 1,
  acceptsErrors: true,
  call(args) {
    const block = argMatrix(args[0]!);
    if (block.rows * block.cols === 0) {
      return err("#VALUE!", "TOROW needs a block with at least one value");
    }
    return matrix(1, block.rows * block.cols, block.values);
  },
});

defineFunction({
  name: "TOCOL",
  description: "Flattens a block into a single column, row-major.",
  minArgs: 1,
  maxArgs: 1,
  acceptsErrors: true,
  call(args) {
    const block = argMatrix(args[0]!);
    if (block.rows * block.cols === 0) {
      return err("#VALUE!", "TOCOL needs a block with at least one value");
    }
    return matrix(block.rows * block.cols, 1, block.values);
  },
});
