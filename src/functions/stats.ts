import { DIV0_ERROR, NUM_ERROR, isFormulaError } from "../engine/errors.js";
import { compareValues, kindOf } from "../engine/value.js";
import type { Value } from "../engine/value.js";
import {
  aggregateNumbers,
  argValues,
  defineFunction,
  flatten,
  numberArg,
} from "./registry.js";
import type { Arg } from "./registry.js";

function numbersOf(args: readonly Arg[]): number[] | Value {
  const numbers = aggregateNumbers(args);
  return isFormulaError(numbers) ? numbers : numbers;
}

defineFunction({
  name: "AVERAGE",
  description: "Arithmetic mean of the numbers found.",
  minArgs: 1,
  maxArgs: Infinity,
  call(args) {
    const numbers = numbersOf(args);
    if (!Array.isArray(numbers)) return numbers;
    if (numbers.length === 0) return DIV0_ERROR;
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  },
});

defineFunction({
  name: "COUNT",
  description: "Counts the numeric values.",
  minArgs: 1,
  maxArgs: Infinity,
  acceptsErrors: true,
  call(args) {
    let count = 0;
    for (const arg of args) {
      for (const value of argValues(arg)) {
        if (kindOf(value) === "number") count++;
      }
    }
    return count;
  },
});

defineFunction({
  name: "COUNTA",
  description: "Counts values that are not blank.",
  minArgs: 1,
  maxArgs: Infinity,
  acceptsErrors: true,
  call: (args) => flatten(args).filter((value) => value !== null).length,
});

defineFunction({
  name: "COUNTBLANK",
  description: "Counts blank cells.",
  minArgs: 1,
  maxArgs: Infinity,
  acceptsErrors: true,
  call: (args) => flatten(args).filter((value) => value === null).length,
});

defineFunction({
  name: "MIN",
  description: "Smallest number found; 0 when there are none.",
  minArgs: 1,
  maxArgs: Infinity,
  call(args) {
    const numbers = numbersOf(args);
    if (!Array.isArray(numbers)) return numbers;
    return numbers.length === 0 ? 0 : Math.min(...numbers);
  },
});

defineFunction({
  name: "MAX",
  description: "Largest number found; 0 when there are none.",
  minArgs: 1,
  maxArgs: Infinity,
  call(args) {
    const numbers = numbersOf(args);
    if (!Array.isArray(numbers)) return numbers;
    return numbers.length === 0 ? 0 : Math.max(...numbers);
  },
});

defineFunction({
  name: "MEDIAN",
  description: "Middle value, averaging the two middles for an even count.",
  minArgs: 1,
  maxArgs: Infinity,
  call(args) {
    const numbers = numbersOf(args);
    if (!Array.isArray(numbers)) return numbers;
    if (numbers.length === 0) return NUM_ERROR;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2;
  },
});

/**
 * Sum of squared deviations from the mean, computed in two passes.
 *
 * The one-pass `E[x^2] - E[x]^2` shortcut loses catastrophically when the
 * values are large and their spread is small — a column of prices around
 * 10,000 with a spread of pennies can come out negative. Two passes cost one
 * extra traversal and are exact enough to be trusted.
 */
function sumSquaredDeviations(numbers: readonly number[]): number {
  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  let total = 0;
  for (const n of numbers) {
    const d = n - mean;
    total += d * d;
  }
  return total;
}

function variance(args: readonly Arg[], sample: boolean): Value {
  const numbers = numbersOf(args);
  if (!Array.isArray(numbers)) return numbers;
  const denominator = sample ? numbers.length - 1 : numbers.length;
  if (denominator <= 0) return DIV0_ERROR;
  return sumSquaredDeviations(numbers) / denominator;
}

defineFunction({
  name: "VAR.S",
  description: "Sample variance.",
  minArgs: 1,
  maxArgs: Infinity,
  call: (args) => variance(args, true),
});

defineFunction({
  name: "VAR.P",
  description: "Population variance.",
  minArgs: 1,
  maxArgs: Infinity,
  call: (args) => variance(args, false),
});

defineFunction({
  name: "STDEV.S",
  description: "Sample standard deviation.",
  minArgs: 1,
  maxArgs: Infinity,
  call(args) {
    const v = variance(args, true);
    return typeof v === "number" ? Math.sqrt(v) : v;
  },
});

defineFunction({
  name: "STDEV.P",
  description: "Population standard deviation.",
  minArgs: 1,
  maxArgs: Infinity,
  call(args) {
    const v = variance(args, false);
    return typeof v === "number" ? Math.sqrt(v) : v;
  },
});

function nthOrderStatistic(args: readonly Arg[], fromLargest: boolean): Value {
  const source = args.slice(0, 1);
  const numbers = numbersOf(source);
  if (!Array.isArray(numbers)) return numbers;
  const k = numberArg(args[1]);
  if (isFormulaError(k)) return k;
  const index = Math.trunc(k);
  if (index < 1 || index > numbers.length) return NUM_ERROR;
  const sorted = [...numbers].sort((a, b) => (fromLargest ? b - a : a - b));
  return sorted[index - 1]!;
}

defineFunction({
  name: "LARGE",
  description: "The k-th largest number in a range.",
  minArgs: 2,
  maxArgs: 2,
  call: (args) => nthOrderStatistic(args, true),
});

defineFunction({
  name: "SMALL",
  description: "The k-th smallest number in a range.",
  minArgs: 2,
  maxArgs: 2,
  call: (args) => nthOrderStatistic(args, false),
});

defineFunction({
  name: "COUNTIF",
  description: "Counts values in a range equal to a criterion.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const values = argValues(args[0]!);
    const criterion = argValues(args[1]!)[0] ?? null;
    let count = 0;
    for (const value of values) {
      const cmp = compareValues(value, criterion);
      if (isFormulaError(cmp)) continue;
      if (cmp === 0) count++;
    }
    return count;
  },
});
