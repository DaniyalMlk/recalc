import type { BinaryNode, Node } from "./ast.js";
import {
  DIV0_ERROR,
  NUM_ERROR,
  REF_ERROR,
  err,
  isFormulaError,
} from "./errors.js";
import type { FormulaError } from "./errors.js";
import {
  argValue,
  checkArity,
  firstError,
  lookupFunction,
  scalar,
} from "../functions/registry.js";
import type { Arg, LazyArg } from "../functions/registry.js";
import type { Coord, RangeRef } from "./reference.js";
import { compareValues, toNumber, toText } from "./value.js";
import type { Value } from "./value.js";

/** Everything the evaluator needs from the world outside a single formula. */
export interface EvalContext {
  /** The value currently stored in a cell; blank cells return `null`. */
  readCell(coord: Coord): Value;
  /** Row-major values of a range, blanks included. */
  readRange(range: RangeRef): Value[];
  /** Resolve a bare name. Return `undefined` for an unknown name. */
  resolveName?(name: string): Value | undefined;
}

/** Evaluate a formula AST to a single value. */
export function evaluate(node: Node, context: EvalContext): Value {
  return argValue(evaluateArg(node, context));
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
      return scalar(
        resolved === undefined
          ? err("#NAME?", `unknown name ${node.name}`)
          : resolved,
      );
    }

    case "unary": {
      const operand = evaluate(node.operand, context);
      if (isFormulaError(operand)) return scalar(operand);
      // Unary plus is an identity, not a coercion: `+"abc"` is `"abc"`.
      if (node.op === "+") return scalar(operand);
      const n = toNumber(operand);
      return scalar(isFormulaError(n) ? n : -n);
    }

    case "percent": {
      const operand = evaluate(node.operand, context);
      const n = toNumber(operand);
      return scalar(isFormulaError(n) ? n : n / 100);
    }

    case "binary":
      return scalar(evaluateBinary(node, context));

    case "call":
      return scalar(evaluateCall(node.name, node.args, context));
  }
}

function evaluateBinary(node: BinaryNode, context: EvalContext): Value {
  const left = evaluate(node.left, context);
  if (isFormulaError(left)) return left;
  const right = evaluate(node.right, context);
  if (isFormulaError(right)) return right;

  switch (node.op) {
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
      switch (node.op) {
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
      return arithmetic(node.op, a, b);
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
): Value {
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
