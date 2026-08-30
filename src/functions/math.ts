import { DIV0_ERROR, NUM_ERROR, isFormulaError } from "../engine/errors.js";
import { kindOf, toNumber } from "../engine/value.js";
import type { Value } from "../engine/value.js";
import {
  aggregateNumbers,
  argValue,
  argValues,
  defineFunction,
  numberArg,
} from "./registry.js";
import type { Arg } from "./registry.js";

function guard(n: number): Value {
  return Number.isFinite(n) ? n : NUM_ERROR;
}

/** Round half away from zero, the spreadsheet convention. */
export function roundHalfAwayFromZero(n: number, digits: number): number {
  const factor = Math.pow(10, digits);
  const scaled = n * factor;
  // Nudge by one ulp-ish epsilon so 2.675 at 2 digits rounds to 2.68 rather
  // than 2.67, which is what the binary representation would otherwise give.
  const corrected = Number(scaled.toPrecision(15));
  const rounded =
    corrected >= 0 ? Math.round(corrected) : -Math.round(-corrected);
  return rounded / factor;
}

function unary(
  name: string,
  description: string,
  fn: (n: number) => Value,
): void {
  defineFunction({
    name,
    description,
    minArgs: 1,
    maxArgs: 1,
    call(args) {
      const n = numberArg(args[0]);
      return isFormulaError(n) ? n : fn(n);
    },
  });
}

defineFunction({
  name: "SUM",
  description: "Adds its arguments; text and booleans inside ranges are ignored.",
  minArgs: 1,
  maxArgs: Infinity,
  call(args) {
    const numbers = aggregateNumbers(args);
    if (isFormulaError(numbers)) return numbers;
    return guard(numbers.reduce((a, b) => a + b, 0));
  },
});

defineFunction({
  name: "PRODUCT",
  description: "Multiplies its arguments.",
  minArgs: 1,
  maxArgs: Infinity,
  call(args) {
    const numbers = aggregateNumbers(args);
    if (isFormulaError(numbers)) return numbers;
    if (numbers.length === 0) return 0;
    return guard(numbers.reduce((a, b) => a * b, 1));
  },
});

defineFunction({
  name: "SUMPRODUCT",
  description: "Sums the element-wise products of equally sized ranges.",
  minArgs: 1,
  maxArgs: Infinity,
  call(args) {
    const columns = args.map((arg) => [...argValues(arg)]);
    const length = columns[0]!.length;
    if (columns.some((column) => column.length !== length)) {
      return NUM_ERROR;
    }
    let total = 0;
    for (let i = 0; i < length; i++) {
      let product = 1;
      for (const column of columns) {
        const value = column[i]!;
        if (isFormulaError(value)) return value;
        // Non-numeric entries contribute zero rather than aborting, which is
        // what makes the boolean-mask idiom `SUMPRODUCT((A:A>0)*B:B)` work.
        if (kindOf(value) !== "number") {
          product = 0;
          break;
        }
        product *= value as number;
      }
      total += product;
    }
    return guard(total);
  },
});

defineFunction({
  name: "MOD",
  description: "Remainder after division; the result takes the divisor's sign.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const n = numberArg(args[0]);
    if (isFormulaError(n)) return n;
    const d = numberArg(args[1]);
    if (isFormulaError(d)) return d;
    if (d === 0) return DIV0_ERROR;
    // Not `%`: JavaScript's remainder takes the sign of the dividend, so
    // `-3 % 2` is -1 where a spreadsheet's MOD(-3,2) is 1.
    return guard(n - d * Math.floor(n / d));
  },
});

defineFunction({
  name: "POWER",
  description: "Raises a number to a power.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const base = numberArg(args[0]);
    if (isFormulaError(base)) return base;
    const exponent = numberArg(args[1]);
    if (isFormulaError(exponent)) return exponent;
    if (base === 0 && exponent < 0) return DIV0_ERROR;
    const result = Math.pow(base, exponent);
    return Number.isNaN(result) ? NUM_ERROR : guard(result);
  },
});

defineFunction({
  name: "ROUND",
  description: "Rounds to a number of digits, half away from zero.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const n = numberArg(args[0]);
    if (isFormulaError(n)) return n;
    const digits = numberArg(args[1]);
    if (isFormulaError(digits)) return digits;
    return guard(roundHalfAwayFromZero(n, Math.trunc(digits)));
  },
});

defineFunction({
  name: "ROUNDUP",
  description: "Rounds away from zero.",
  minArgs: 2,
  maxArgs: 2,
  call: (args) => directedRound(args, "up"),
});

defineFunction({
  name: "ROUNDDOWN",
  description: "Rounds toward zero.",
  minArgs: 2,
  maxArgs: 2,
  call: (args) => directedRound(args, "down"),
});

function directedRound(args: readonly Arg[], mode: "up" | "down"): Value {
  const n = numberArg(args[0]);
  if (isFormulaError(n)) return n;
  const digits = numberArg(args[1]);
  if (isFormulaError(digits)) return digits;
  const factor = Math.pow(10, Math.trunc(digits));
  const scaled = Number((n * factor).toPrecision(15));
  const rounded =
    mode === "up"
      ? Math.sign(scaled) * Math.ceil(Math.abs(scaled))
      : Math.sign(scaled) * Math.floor(Math.abs(scaled));
  return guard(rounded / factor);
}

defineFunction({
  name: "CEILING",
  description: "Rounds up to the nearest multiple of a significance.",
  minArgs: 2,
  maxArgs: 2,
  call: (args) => toMultiple(args, Math.ceil),
});

defineFunction({
  name: "FLOOR",
  description: "Rounds down to the nearest multiple of a significance.",
  minArgs: 2,
  maxArgs: 2,
  call: (args) => toMultiple(args, Math.floor),
});

function toMultiple(
  args: readonly Arg[],
  round: (n: number) => number,
): Value {
  const n = numberArg(args[0]);
  if (isFormulaError(n)) return n;
  const significance = numberArg(args[1]);
  if (isFormulaError(significance)) return significance;
  if (significance === 0) return n === 0 ? 0 : DIV0_ERROR;
  if (n > 0 && significance < 0) return NUM_ERROR;
  return guard(round(n / significance) * significance);
}

defineFunction({
  name: "PI",
  description: "The constant pi.",
  minArgs: 0,
  maxArgs: 0,
  call: () => Math.PI,
});

defineFunction({
  name: "LOG",
  description: "Logarithm of a number in a given base, default 10.",
  minArgs: 1,
  maxArgs: 2,
  call(args) {
    const n = numberArg(args[0]);
    if (isFormulaError(n)) return n;
    const base = args.length > 1 ? numberArg(args[1]) : 10;
    if (isFormulaError(base)) return base;
    if (n <= 0 || base <= 0 || base === 1) return NUM_ERROR;
    return guard(Math.log(n) / Math.log(base));
  },
});

defineFunction({
  name: "ABS",
  description: "Absolute value.",
  minArgs: 1,
  maxArgs: 1,
  call(args) {
    const value = argValue(args[0]!);
    const n = toNumber(value);
    return isFormulaError(n) ? n : Math.abs(n);
  },
});

unary("SIGN", "Sign of a number: -1, 0 or 1.", (n) => Math.sign(n));
unary("SQRT", "Square root.", (n) => (n < 0 ? NUM_ERROR : Math.sqrt(n)));
unary("EXP", "e raised to a power.", (n) => guard(Math.exp(n)));
unary("LN", "Natural logarithm.", (n) => (n <= 0 ? NUM_ERROR : Math.log(n)));
unary("LOG10", "Base-10 logarithm.", (n) =>
  n <= 0 ? NUM_ERROR : Math.log10(n),
);
unary("INT", "Rounds down to the nearest integer.", (n) => Math.floor(n));
unary("TRUNC", "Discards the fractional part.", (n) => Math.trunc(n));
