import { fromNumericRows, numericRows } from "../engine/array.js";
import type { Matrix } from "../engine/array.js";
import { NUM_ERROR, VALUE_ERROR, err, isFormulaError } from "../engine/errors.js";
import type { FormulaError } from "../engine/errors.js";
import {
  determinant,
  identity,
  invert,
  isSquare,
  multiply,
  solve,
} from "../numeric/linalg.js";
import type { Rows } from "../numeric/linalg.js";
import { argMatrix, defineFunction, numberArg } from "./registry.js";
import type { Arg } from "./registry.js";

/**
 * The matrix functions.
 *
 * Each one is a thin shell over `numeric/linalg`: read the argument as a block
 * of numbers, check the shape, hand it over, wrap the answer back up. The
 * refusals are where the thinking is, and they are uniform — a block that is
 * not numbers is `#VALUE!`, a shape that does not work is `#VALUE!`, and a
 * matrix that has no answer is `#NUM!`.
 */

/** Read an argument as a block of numbers, or the error explaining why not. */
function numbersOf(arg: Arg): number[][] | FormulaError {
  return numericRows(argMatrix(arg));
}

function squareNumbersOf(arg: Arg): number[][] | FormulaError {
  const rows = numbersOf(arg);
  if (isFormulaError(rows)) return rows;
  if (!isSquare(rows)) {
    return err("#VALUE!", "the block has to be square");
  }
  return rows;
}

/** Every entry finite, so an overflow is reported rather than spilled as ∞. */
function finite(rows: Rows): Matrix | FormulaError {
  for (const row of rows) {
    for (const value of row) {
      if (!Number.isFinite(value)) return NUM_ERROR;
    }
  }
  return fromNumericRows(rows);
}

defineFunction({
  name: "MMULT",
  description: "Matrix product of two blocks of numbers.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const a = numbersOf(args[0]!);
    if (isFormulaError(a)) return a;
    const b = numbersOf(args[1]!);
    if (isFormulaError(b)) return b;

    const product = multiply(a, b);
    if (product === null) {
      return err(
        "#VALUE!",
        `cannot multiply a ${a.length}x${a[0]?.length ?? 0} block by a ${
          b.length
        }x${b[0]?.length ?? 0} block`,
      );
    }
    return finite(product);
  },
});

defineFunction({
  name: "MINVERSE",
  description: "Inverse of a square block of numbers.",
  minArgs: 1,
  maxArgs: 1,
  call(args) {
    const a = squareNumbersOf(args[0]!);
    if (isFormulaError(a)) return a;
    const inverse = invert(a);
    // A singular matrix has no inverse at all, which is a fact about the
    // numbers rather than about their arrangement, so it is #NUM! and not
    // #VALUE!.
    if (inverse === null) return NUM_ERROR;
    return finite(inverse);
  },
});

defineFunction({
  name: "MDETERM",
  description: "Determinant of a square block of numbers.",
  minArgs: 1,
  maxArgs: 1,
  call(args) {
    const a = squareNumbersOf(args[0]!);
    if (isFormulaError(a)) return a;
    const value = determinant(a);
    return Number.isFinite(value) ? value : NUM_ERROR;
  },
});

defineFunction({
  name: "MUNIT",
  description: "The identity block of a given size.",
  minArgs: 1,
  maxArgs: 1,
  call(args) {
    const n = numberArg(args[0]);
    if (isFormulaError(n)) return n;
    const size = Math.trunc(n);
    if (size < 1) return VALUE_ERROR;
    // Anything past a few hundred is a mistake rather than a request: the
    // block is square, so the cell count is the square of this.
    if (size > 1024) return NUM_ERROR;
    return fromNumericRows(identity(size));
  },
});

defineFunction({
  name: "MSOLVE",
  description: "Solves A x = b for a square A and a column b.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const a = squareNumbersOf(args[0]!);
    if (isFormulaError(a)) return a;
    const b = numbersOf(args[1]!);
    if (isFormulaError(b)) return b;
    if (b.length !== a.length) {
      return err(
        "#VALUE!",
        `A has ${a.length} rows and b has ${b.length}`,
      );
    }
    // Solved through the factorisation rather than by forming the inverse and
    // multiplying: inverting costs more and is less accurate, and the inverse
    // itself is not wanted.
    const x = solve(a, b);
    if (x === null) return NUM_ERROR;
    return finite(x);
  },
});
