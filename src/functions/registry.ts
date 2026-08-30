import { NAME_ERROR, VALUE_ERROR, err, isFormulaError } from "../engine/errors.js";
import type { FormulaError } from "../engine/errors.js";
import { rangeSize } from "../engine/reference.js";
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

export type Arg = ScalarArg | RangeArg;

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
  call(args: readonly Arg[]): Value;
}

export interface LazyFunction extends BaseFunction {
  readonly lazy: true;
  call(args: readonly LazyArg[]): Value;
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

/**
 * Read an argument as a single value.
 *
 * A 1x1 range collapses to its cell; any larger range in a scalar position is
 * `#VALUE!`. (Real spreadsheets attempt an implicit intersection against the
 * calling cell's row or column; that is deliberately not implemented, and the
 * explicit error is better than a silently wrong pick.)
 */
export function argValue(arg: Arg): Value {
  if (arg.kind === "scalar") return arg.value;
  if (rangeSize(arg.range) === 1) return arg.values[0] ?? null;
  return err("#VALUE!", "a range was used where a single value is required");
}

/** Every value an argument covers, ranges expanded row-major. */
export function argValues(arg: Arg): readonly Value[] {
  return arg.kind === "scalar" ? [arg.value] : arg.values;
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
 * booleans found *inside a range* are ignored, because a column of figures
 * with a header should still sum, but the same values passed *directly* are
 * coerced, because `SUM(TRUE, "3")` was written on purpose. Errors are never
 * ignored and abort the aggregate wherever they are found.
 */
export function aggregateNumbers(
  args: readonly Arg[],
): number[] | FormulaError {
  const out: number[] = [];
  for (const arg of args) {
    if (arg.kind === "range") {
      for (const value of arg.values) {
        if (isFormulaError(value)) return value;
        if (kindOf(value) === "number") out.push(value as number);
      }
      continue;
    }
    const coerced = toNumber(arg.value);
    if (isFormulaError(coerced)) return coerced;
    out.push(coerced);
  }
  return out;
}

/** Coerce one argument to a number, surfacing errors. */
export function numberArg(arg: Arg | undefined): number | FormulaError {
  if (arg === undefined) return VALUE_ERROR;
  const value = argValue(arg);
  return toNumber(value);
}
