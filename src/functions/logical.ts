import { NA_ERROR, VALUE_ERROR, isFormulaError } from "../engine/errors.js";
import { toBoolean } from "../engine/value.js";
import type { Value } from "../engine/value.js";
import { argValue, argValues, defineFunction, flatten } from "./registry.js";
import type { Arg } from "./registry.js";

function booleansOf(args: readonly Arg[]): boolean[] | Value {
  const out: boolean[] = [];
  for (const value of flatten(args)) {
    if (isFormulaError(value)) return value;
    // Blanks and text inside a range are skipped rather than coerced, the
    // same way aggregates skip them.
    if (value === null) continue;
    const coerced = toBoolean(value);
    if (isFormulaError(coerced)) continue;
    out.push(coerced);
  }
  return out;
}

defineFunction({
  name: "IF",
  description: "Returns one of two values depending on a condition.",
  lazy: true,
  minArgs: 2,
  maxArgs: 3,
  call(args) {
    // Lazy on purpose: `IF(TRUE, 1, 1/0)` must be 1, so the untaken branch is
    // never evaluated and its errors never surface.
    const conditionValue = argValue(args[0]!());
    if (isFormulaError(conditionValue)) return conditionValue;
    const condition = toBoolean(conditionValue);
    if (isFormulaError(condition)) return condition;
    if (condition) return argValue(args[1]!());
    return args.length > 2 ? argValue(args[2]!()) : false;
  },
});

defineFunction({
  name: "IFERROR",
  description: "Returns a fallback when the first argument is an error.",
  lazy: true,
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const value = argValue(args[0]!());
    return isFormulaError(value) ? argValue(args[1]!()) : value;
  },
});

defineFunction({
  name: "IFNA",
  description: "Returns a fallback only for #N/A.",
  lazy: true,
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const value = argValue(args[0]!());
    if (isFormulaError(value) && value.code === "#N/A") {
      return argValue(args[1]!());
    }
    return value;
  },
});

defineFunction({
  name: "IFS",
  description: "Returns the value paired with the first true condition.",
  lazy: true,
  minArgs: 2,
  maxArgs: Infinity,
  call(args) {
    if (args.length % 2 !== 0) return VALUE_ERROR;
    for (let i = 0; i < args.length; i += 2) {
      const conditionValue = argValue(args[i]!());
      if (isFormulaError(conditionValue)) return conditionValue;
      const condition = toBoolean(conditionValue);
      if (isFormulaError(condition)) return condition;
      if (condition) return argValue(args[i + 1]!());
    }
    return NA_ERROR;
  },
});

defineFunction({
  name: "AND",
  description: "True when every argument is true.",
  minArgs: 1,
  maxArgs: Infinity,
  call(args) {
    const booleans = booleansOf(args);
    if (!Array.isArray(booleans)) return booleans;
    if (booleans.length === 0) return VALUE_ERROR;
    return booleans.every(Boolean);
  },
});

defineFunction({
  name: "OR",
  description: "True when any argument is true.",
  minArgs: 1,
  maxArgs: Infinity,
  call(args) {
    const booleans = booleansOf(args);
    if (!Array.isArray(booleans)) return booleans;
    if (booleans.length === 0) return VALUE_ERROR;
    return booleans.some(Boolean);
  },
});

defineFunction({
  name: "XOR",
  description: "True when an odd number of arguments are true.",
  minArgs: 1,
  maxArgs: Infinity,
  call(args) {
    const booleans = booleansOf(args);
    if (!Array.isArray(booleans)) return booleans;
    if (booleans.length === 0) return VALUE_ERROR;
    return booleans.filter(Boolean).length % 2 === 1;
  },
});

defineFunction({
  name: "NOT",
  description: "Inverts a logical value.",
  minArgs: 1,
  maxArgs: 1,
  call(args) {
    const value = toBoolean(argValue(args[0]!));
    return isFormulaError(value) ? value : !value;
  },
});

defineFunction({
  name: "TRUE",
  description: "The boolean TRUE.",
  minArgs: 0,
  maxArgs: 0,
  call: () => true,
});

defineFunction({
  name: "FALSE",
  description: "The boolean FALSE.",
  minArgs: 0,
  maxArgs: 0,
  call: () => false,
});

defineFunction({
  name: "SWITCH",
  description: "Matches a value against cases, with an optional default.",
  minArgs: 3,
  maxArgs: Infinity,
  call(args) {
    const subject = argValue(args[0]!);
    if (isFormulaError(subject)) return subject;
    let i = 1;
    for (; i + 1 < args.length; i += 2) {
      const candidate = argValue(args[i]!);
      if (isFormulaError(candidate)) return candidate;
      if (looseEquals(subject, candidate)) return argValue(args[i + 1]!);
    }
    // A trailing odd argument is the default.
    return i < args.length ? argValue(args[i]!) : NA_ERROR;
  },
});

function looseEquals(a: Value, b: Value): boolean {
  if (typeof a === "string" && typeof b === "string") {
    return a.toUpperCase() === b.toUpperCase();
  }
  return a === b;
}

defineFunction({
  name: "COUNTUNIQUE",
  description: "Counts distinct non-blank values.",
  minArgs: 1,
  maxArgs: Infinity,
  acceptsErrors: true,
  call(args) {
    const seen = new Set<string>();
    for (const arg of args) {
      for (const value of argValues(arg)) {
        if (value === null) continue;
        seen.add(
          isFormulaError(value)
            ? `e:${value.code}`
            : `${typeof value}:${typeof value === "string" ? value.toUpperCase() : String(value)}`,
        );
      }
    }
    return seen.size;
  },
});
