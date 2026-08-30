import { VALUE_ERROR, isFormulaError } from "./errors.js";
import type { FormulaError } from "./errors.js";

/**
 * A cell value.
 *
 * `null` is *blank*, which is not the same thing as `0` or `""`. A blank cell
 * is skipped by `COUNT` and by `AVERAGE`'s denominator, but it still compares
 * equal to both `0` and `""`. Collapsing blank into either one at the storage
 * layer loses that distinction permanently, so it is kept separate here and
 * resolved only at the point of comparison.
 */
export type Value = number | string | boolean | FormulaError | null;

export type ValueKind = "number" | "text" | "boolean" | "blank" | "error";

export function kindOf(value: Value): ValueKind {
  if (value === null) return "blank";
  if (isFormulaError(value)) return "error";
  switch (typeof value) {
    case "number":
      return "number";
    case "string":
      return "text";
    default:
      return "boolean";
  }
}

export function isBlank(value: Value): value is null {
  return value === null;
}

/** Text that spreadsheets accept as a number, including a percent suffix. */
const NUMERIC_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?%?$/;

/**
 * Parse text the way a formula does when text meets an arithmetic operator.
 * Returns `null` when the text is not numeric.
 */
export function parseNumericText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "" || !NUMERIC_TEXT.test(trimmed)) return null;
  if (trimmed.endsWith("%")) {
    const n = Number(trimmed.slice(0, -1));
    return Number.isFinite(n) ? n / 100 : null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Coerce to a number for arithmetic.
 *
 * Blank is 0, `TRUE` is 1, `FALSE` is 0, numeric text converts, and anything
 * else is `#VALUE!`. Errors pass straight through.
 */
export function toNumber(value: Value): number | FormulaError {
  switch (kindOf(value)) {
    case "number":
      return value as number;
    case "blank":
      return 0;
    case "boolean":
      return value === true ? 1 : 0;
    case "error":
      return value as FormulaError;
    case "text": {
      const parsed = parseNumericText(value as string);
      return parsed === null ? VALUE_ERROR : parsed;
    }
  }
}

/** Coerce to text for concatenation. */
export function toText(value: Value): string | FormulaError {
  switch (kindOf(value)) {
    case "text":
      return value as string;
    case "blank":
      return "";
    case "number":
      return formatNumber(value as number);
    case "boolean":
      return value === true ? "TRUE" : "FALSE";
    case "error":
      return value as FormulaError;
  }
}

/** Coerce to a boolean for logical contexts. */
export function toBoolean(value: Value): boolean | FormulaError {
  switch (kindOf(value)) {
    case "boolean":
      return value as boolean;
    case "blank":
      return false;
    case "number":
      return (value as number) !== 0;
    case "error":
      return value as FormulaError;
    case "text": {
      const upper = (value as string).trim().toUpperCase();
      if (upper === "TRUE") return true;
      if (upper === "FALSE") return false;
      return VALUE_ERROR;
    }
  }
}

/** Render a number the way a cell displays it. */
export function formatNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
  return String(n);
}

/** Render any value for display, including errors. */
export function formatValue(value: Value): string {
  if (value === null) return "";
  if (isFormulaError(value)) return value.code;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return formatNumber(value);
  return value;
}

/**
 * Rank used when comparing values of different types.
 *
 * Spreadsheets do not refuse a cross-type comparison; they impose a total
 * order on the type tags first: every number sorts below every text, which
 * sorts below `FALSE`, which sorts below `TRUE`. So `="a">1` is TRUE.
 */
const TYPE_RANK: Readonly<Record<Exclude<ValueKind, "error" | "blank">, number>> =
  {
    number: 0,
    text: 1,
    boolean: 2,
  };

/**
 * Three-way comparison following spreadsheet rules.
 *
 * A blank operand takes the *other* operand's type and its zero value, which
 * is how a blank cell manages to equal both `0` and `""` without those two
 * equalling each other.
 *
 * Text comparison is case-insensitive: `"a"="A"` is TRUE.
 */
export function compareValues(
  left: Value,
  right: Value,
): number | FormulaError {
  if (isFormulaError(left)) return left;
  if (isFormulaError(right)) return right;

  let a = left;
  let b = right;

  if (isBlank(a) && isBlank(b)) return 0;
  if (isBlank(a)) a = zeroOf(b);
  if (isBlank(b)) b = zeroOf(a);

  const kindA = kindOf(a) as keyof typeof TYPE_RANK;
  const kindB = kindOf(b) as keyof typeof TYPE_RANK;
  if (kindA !== kindB) {
    return TYPE_RANK[kindA] - TYPE_RANK[kindB];
  }

  switch (kindA) {
    case "number": {
      const x = a as number;
      const y = b as number;
      return x < y ? -1 : x > y ? 1 : 0;
    }
    case "text": {
      const x = (a as string).toUpperCase();
      const y = (b as string).toUpperCase();
      return x < y ? -1 : x > y ? 1 : 0;
    }
    case "boolean": {
      const x = a === true ? 1 : 0;
      const y = b === true ? 1 : 0;
      return x - y;
    }
  }
}

function zeroOf(other: Value): number | string | boolean {
  switch (kindOf(other)) {
    case "text":
      return "";
    case "boolean":
      return false;
    default:
      return 0;
  }
}

/** Guard against `Infinity` and `NaN` escaping into a cell. */
export function finiteOrNum(n: number, onBad: FormulaError): Value {
  return Number.isFinite(n) ? n : onBad;
}
