import { matrix, scalarMatrix } from "../engine/array.js";
import type { CallResult, Matrix } from "../engine/array.js";
import { NAME_ERROR, VALUE_ERROR, err, isFormulaError } from "../engine/errors.js";
import type { FormulaError } from "../engine/errors.js";
import { rangeHeight, rangeWidth, rangeSize } from "../engine/reference.js";
import type { RangeRef } from "../engine/reference.js";
import { kindOf, toNumber } from "../engine/value.js";
import type { Value } from "../engine/value.js";

export interface ScalarArg {
  readonly kind: "scalar";
  readonly value: Value;
}

export interface RangeArg {
  readonly kind: "range";
  readonly range: RangeRef;
  /** Row-major, blanks included as `null`, so the shape is preserved. */
  readonly values: readonly Value[];
}

/**
 * A block of values that came from a formula rather than from the sheet.
 *
 * It is kept separate from {@link RangeArg} because a range also carries *where
 * it is*, which lookup functions and the dependency graph both use. An array
 * has a shape and nothing else.
 */
export interface ArrayArg {
  readonly kind: "array";
  readonly matrix: Matrix;
}

export type Arg = ScalarArg | RangeArg | ArrayArg;

/** A not-yet-evaluated argument, memoised by the evaluator. */
export type LazyArg = () => Arg;

interface BaseFunction {
  readonly name: string;
  readonly minArgs: number;
  /** `Infinity` for variadic functions. */
  readonly maxArgs: number;
  readonly description: string;
}

export interface EagerFunction extends BaseFunction {
  readonly lazy?: false;
  /**
   * When true the function sees error arguments itself instead of the engine
   * short-circuiting. Needed by `ISERROR` and friends.
   */
  readonly acceptsErrors?: boolean;
  call(args: readonly Arg[]): CallResult;
}

export interface LazyFunction extends BaseFunction {
  readonly lazy: true;
  call(args: readonly LazyArg[]): CallResult;
}

export type FunctionDef = EagerFunction | LazyFunction;

const REGISTRY = new Map<string, FunctionDef>();

export function defineFunction(def: FunctionDef): FunctionDef {
  const name = def.name.toUpperCase();
  if (REGISTRY.has(name)) {
    throw new Error(`function ${name} is already registered`);
  }
  REGISTRY.set(name, def);
  return def;
}

export function lookupFunction(name: string): FunctionDef | undefined {
  return REGISTRY.get(name.toUpperCase());
}

export function registeredFunctionNames(): string[] {
  return [...REGISTRY.keys()].sort();
}

/** `#NAME?` for an unknown function; arity failures are `#VALUE!`. */
export function checkArity(
  def: FunctionDef | undefined,
  name: string,
  count: number,
): FormulaError | null {
  if (def === undefined) {
    return err("#NAME?", `unknown function ${name}`);
  }
  if (count < def.minArgs) {
    return err(
      "#VALUE!",
      `${def.name} needs at least ${def.minArgs} argument${def.minArgs === 1 ? "" : "s"}`,
    );
  }
  if (count > def.maxArgs) {
    return err(
      "#VALUE!",
      `${def.name} takes at most ${def.maxArgs} argument${def.maxArgs === 1 ? "" : "s"}`,
    );
  }
  return null;
}

export const NAME_NOT_FOUND = NAME_ERROR;

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

export function scalar(value: Value): ScalarArg {
  return { kind: "scalar", value };
}

export function array(m: Matrix): ArrayArg {
  return { kind: "array", matrix: m };
}

/**
 * Read an argument as a single value.
 *
 * A 1x1 range or array collapses to its one cell; anything larger in a scalar
 * position is `#VALUE!`. (Real spreadsheets attempt an implicit intersection
 * against the calling cell's row or column; that is deliberately not
 * implemented, and the explicit error is better than a silently wrong pick.)
 */
export function argValue(arg: Arg): Value {
  switch (arg.kind) {
    case "scalar":
      return arg.value;
    case "array":
      if (arg.matrix.rows * arg.matrix.cols === 1) {
        return arg.matrix.values[0] ?? null;
      }
      return err("#VALUE!", "a block was used where a single value is required");
    case "range":
      if (rangeSize(arg.range) === 1) return arg.values[0] ?? null;
      return err("#VALUE!", "a range was used where a single value is required");
  }
}

/** Every value an argument covers, blocks expanded row-major. */
export function argValues(arg: Arg): readonly Value[] {
  switch (arg.kind) {
    case "scalar":
      return [arg.value];
    case "array":
      return arg.matrix.values;
    case "range":
      return arg.values;
  }
}

/**
 * An argument as a shaped block.
 *
 * A scalar becomes 1x1, a range keeps the shape it occupies on the sheet, and
 * an array is already one. This is what lets operators broadcast without
 * caring where their operands came from.
 */
export function argMatrix(arg: Arg): Matrix {
  switch (arg.kind) {
    case "scalar":
      return scalarMatrix(arg.value);
    case "array":
      return arg.matrix;
    case "range":
      return matrix(
        rangeHeight(arg.range),
        rangeWidth(arg.range),
        arg.values,
      );
  }
}

/** Whether the argument covers exactly one cell. */
export function isSingleValue(arg: Arg): boolean {
  switch (arg.kind) {
    case "scalar":
      return true;
    case "array":
      return arg.matrix.rows * arg.matrix.cols === 1;
    case "range":
      return rangeSize(arg.range) === 1;
  }
}

export function flatten(args: readonly Arg[]): Value[] {
  const out: Value[] = [];
  for (const arg of args) out.push(...argValues(arg));
  return out;
}

/** First error found anywhere in the arguments, or `null`. */
export function firstError(args: readonly Arg[]): FormulaError | null {
  for (const arg of args) {
    for (const value of argValues(arg)) {
      if (isFormulaError(value)) return value;
    }
  }
  return null;
}

/**
 * Collect the numbers an aggregate should operate on.
 *
 * The rule is not uniform, and the difference is load-bearing: text and
 * booleans found *inside a block* are ignored, because a column of figures
 * with a header should still sum, but the same values passed *directly* are
 * coerced, because `SUM(TRUE, "3")` was written on purpose. An array counts as
 * a block for this, so `SUM(TRANSPOSE(A1:C1))` skips a header exactly as
 * `SUM(A1:C1)` does. Errors are never ignored and abort the aggregate wherever
 * they are found.
 */
export function aggregateNumbers(
  args: readonly Arg[],
): number[] | FormulaError {
  const out: number[] = [];
  for (const arg of args) {
    if (arg.kind === "scalar") {
      const coerced = toNumber(arg.value);
      if (isFormulaError(coerced)) return coerced;
      out.push(coerced);
      continue;
    }
    for (const value of argValues(arg)) {
      if (isFormulaError(value)) return value;
      if (kindOf(value) === "number") out.push(value as number);
    }
  }
  return out;
}

/** Coerce one argument to a number, surfacing errors. */
export function numberArg(arg: Arg | undefined): number | FormulaError {
  if (arg === undefined) return VALUE_ERROR;
  const value = argValue(arg);
  return toNumber(value);
}
