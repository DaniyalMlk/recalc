import type { BinaryNode, Node } from "./ast.js";
import { broadcast, collapse, isMatrix, mapMatrix } from "./array.js";
import type { CallResult } from "./array.js";
import {
  DIV0_ERROR,
  NUM_ERROR,
  REF_ERROR,
  err,
  isFormulaError,
} from "./errors.js";
import type { FormulaError } from "./errors.js";
import {
  argMatrix,
  argValue,
  array,
  checkArity,
  firstError,
  isSingleValue,
  lookupFunction,
  scalar,
} from "../functions/registry.js";
import type { Arg, LazyArg } from "../functions/registry.js";
import type { NameBinding } from "./names.js";
import type { Coord, RangeRef } from "./reference.js";
import { compareValues, toNumber, toText } from "./value.js";
import type { Value } from "./value.js";

/** Everything the evaluator needs from the world outside a single formula. */
export interface EvalContext {
  /** The value currently stored in a cell; blank cells return `null`. */
  readCell(coord: Coord): Value;
  /** Row-major values of a range, blanks included. */
  readRange(range: RangeRef): Value[];
  /**
   * Resolve a bare name. Return `undefined` for an unknown name.
   *
   * A name may stand for a constant or for a piece of the sheet, and the two
   * cannot be collapsed: `SUM(Revenue)` needs the range itself, not a value
   * squeezed out of it, or a named range could never be aggregated.
   */
  resolveName?(name: string): NameBinding | undefined;
}

/** Evaluate a formula AST to a single value. */
export function evaluate(node: Node, context: EvalContext): Value {
  return argValue(evaluateArg(node, context));
}

/**
 * Evaluate a formula to whatever it produces — one value, or a block.
 *
 * This is what a cell is evaluated with. {@link evaluate} stays the scalar
 * entry point because most callers (an operand, a probe, a goal seek) want one
 * number and would only have to collapse a block again; the sheet is the one
 * place that can do something with the shape, so it is the one place that
 * asks for it.
 */
export function evaluateResult(node: Node, context: EvalContext): CallResult {
  const arg = evaluateArg(node, context);
  if (arg.kind === "array") return collapse(arg.matrix);
  return argValue(arg);
}

/**
 * Evaluate a node in *argument* position, where a range stays a range.
 *
 * The distinction only exists here. `SUM(A1:A9)` hands the function a range,
 * while `A1:A9+1` collapses to `#VALUE!` because an operator has nowhere to
 * put nine values.
 */
export function evaluateArg(node: Node, context: EvalContext): Arg {
  switch (node.kind) {
    case "number":
      return scalar(node.value);

    case "string":
      return scalar(node.value);

    case "boolean":
      return scalar(node.value);

    case "error":
      return scalar(err(node.code));

    case "group":
      return evaluateArg(node.inner, context);

    case "reference":
      return scalar(context.readCell(node.ref));

    case "range":
      return {
        kind: "range",
        range: node.range,
        values: context.readRange(node.range),
      };

    case "name": {
      const resolved = context.resolveName?.(node.name);
      if (resolved === undefined) {
        return scalar(err("#NAME?", `unknown name ${node.name}`));
      }
      switch (resolved.kind) {
        case "value":
          return scalar(resolved.value);
        case "cell":
          return scalar(context.readCell(resolved.ref));
        case "range":
          // Deliberately the same shape a written-out range produces, so a
          // name behaves exactly as though it had been typed in full.
          return {
            kind: "range",
            range: resolved.range,
            values: context.readRange(resolved.range),
          };
      }
    }

    case "unary":
      // Unary plus is an identity, not a coercion: `+"abc"` is `"abc"`.
      return elementwise(node.operand, context, (value) => {
        if (isFormulaError(value)) return value;
        if (node.op === "+") return value;
        const n = toNumber(value);
        return isFormulaError(n) ? n : -n;
      });

    case "percent":
      return elementwise(node.operand, context, (value) => {
        const n = toNumber(value);
        return isFormulaError(n) ? n : n / 100;
      });

    case "binary":
      return evaluateBinary(node, context);

    case "call": {
      const result = evaluateCall(node.name, node.args, context);
      return isMatrix(result) ? array(result) : scalar(result);
    }
  }
}

/**
 * Apply a unary operator across whatever the operand turned out to be.
 *
 * One value in, one value out; a block in, a block of the same shape out.
 */
function elementwise(
  operand: Node,
  context: EvalContext,
  f: (value: Value) => Value,
): Arg {
  const arg = evaluateArg(operand, context);
  if (isSingleValue(arg)) return scalar(f(argValue(arg)));
  return array(mapMatrix(argMatrix(arg), f));
}

/**
 * Apply a binary operator, broadcasting when either side is a block.
 *
 * The scalar case is kept on its own path rather than routed through a 1x1
 * broadcast, because it is overwhelmingly the common one and it is on the hot
 * path of every recalculation.
 */
function evaluateBinary(node: BinaryNode, context: EvalContext): Arg {
  const left = evaluateArg(node.left, context);
  const right = evaluateArg(node.right, context);
  const combine = (a: Value, b: Value): Value => combineValues(node.op, a, b);

  if (isSingleValue(left) && isSingleValue(right)) {
    return scalar(combine(argValue(left), argValue(right)));
  }
  const result = broadcast(argMatrix(left), argMatrix(right), combine);
  return isFormulaError(result) ? scalar(result) : array(result);
}

function combineValues(
  op: BinaryNode["op"],
  left: Value,
  right: Value,
): Value {
  if (isFormulaError(left)) return left;
  if (isFormulaError(right)) return right;

  switch (op) {
    case "&": {
      const a = toText(left);
      if (isFormulaError(a)) return a;
      const b = toText(right);
      if (isFormulaError(b)) return b;
      return a + b;
    }

    case "=":
    case "<>":
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const cmp = compareValues(left, right);
      if (isFormulaError(cmp)) return cmp;
      switch (op) {
        case "=":
          return cmp === 0;
        case "<>":
          return cmp !== 0;
        case "<":
          return cmp < 0;
        case "<=":
          return cmp <= 0;
        case ">":
          return cmp > 0;
        default:
          return cmp >= 0;
      }
    }

    default: {
      const a = toNumber(left);
      if (isFormulaError(a)) return a;
      const b = toNumber(right);
      if (isFormulaError(b)) return b;
      return arithmetic(op, a, b);
    }
  }
}

function arithmetic(op: "+" | "-" | "*" | "/" | "^", a: number, b: number): Value {
  switch (op) {
    case "+":
      return guard(a + b);
    case "-":
      return guard(a - b);
    case "*":
      return guard(a * b);
    case "/":
      return b === 0 ? DIV0_ERROR : guard(a / b);
    case "^": {
      // `0^0` is 1 by spreadsheet convention; a negative base with a
      // fractional exponent has no real result and is `#NUM!`.
      if (a === 0 && b === 0) return 1;
      if (a === 0 && b < 0) return DIV0_ERROR;
      const result = Math.pow(a, b);
      return Number.isNaN(result) ? NUM_ERROR : guard(result);
    }
  }
}

/** Overflow to infinity is `#NUM!`, matching how a sheet reports it. */
function guard(n: number): Value {
  return Number.isFinite(n) ? n : NUM_ERROR;
}

function evaluateCall(
  name: string,
  argNodes: readonly Node[],
  context: EvalContext,
): CallResult {
  const def = lookupFunction(name);
  const arityError = checkArity(def, name, argNodes.length);
  if (arityError !== null) return arityError;
  if (def === undefined) return REF_ERROR; // unreachable; checkArity covers it

  if (def.lazy === true) {
    const thunks: LazyArg[] = argNodes.map((argNode) => {
      let cached: Arg | undefined;
      return () => (cached ??= evaluateArg(argNode, context));
    });
    return def.call(thunks);
  }

  const args = argNodes.map((argNode) => evaluateArg(argNode, context));
  if (def.acceptsErrors !== true) {
    const error: FormulaError | null = firstError(args);
    if (error !== null) return error;
  }
  return def.call(args);
}
