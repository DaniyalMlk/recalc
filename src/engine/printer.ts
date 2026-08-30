import type { Node } from "./ast.js";
import { formatA1, formatRange } from "./reference.js";

/**
 * Precedence used for printing. It mirrors the parser's binding powers, but
 * as a single number per node kind — printing only needs to know whether a
 * child binds looser than its parent.
 */
const PRECEDENCE: Readonly<Record<string, number>> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  "<=": 1,
  ">": 1,
  ">=": 1,
  "&": 2,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
  "^": 5,
};

const PERCENT_PRECEDENCE = 6;
const UNARY_PRECEDENCE = 7;
const ATOM_PRECEDENCE = 100;

function precedenceOf(node: Node): number {
  switch (node.kind) {
    case "binary":
      return PRECEDENCE[node.op] ?? ATOM_PRECEDENCE;
    case "percent":
      return PERCENT_PRECEDENCE;
    case "unary":
      return UNARY_PRECEDENCE;
    case "group":
      return precedenceOf(node.inner);
    default:
      return ATOM_PRECEDENCE;
  }
}

function quote(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

/** Format a number so it reparses to exactly the same value. */
function numberLiteral(value: number): string {
  if (Number.isFinite(value)) return String(value);
  // Non-finite values cannot appear in a well-formed formula; surface it
  // rather than emitting `Infinity`, which would not reparse.
  throw new RangeError(`cannot print non-finite number: ${value}`);
}

/**
 * Render an AST back to formula text.
 *
 * Explicit parentheses from the source are not preserved as such; parentheses
 * are re-derived from precedence, so the output is the canonical spelling of
 * the tree. `((1+2))*3` and `(1+2)*3` both print as `(1+2)*3`.
 */
export function printFormula(node: Node, withLeadingEquals = false): string {
  return (withLeadingEquals ? "=" : "") + print(node);
}

function print(node: Node): string {
  switch (node.kind) {
    case "number":
      return numberLiteral(node.value);
    case "string":
      return quote(node.value);
    case "boolean":
      return node.value ? "TRUE" : "FALSE";
    case "error":
      return node.code;
    case "reference":
      return formatA1(node.ref);
    case "range":
      return formatRange(node.range);
    case "name":
      return node.name;
    case "call":
      return `${node.name}(${node.args.map(print).join(",")})`;
    case "group":
      return print(node.inner);
    case "percent":
      return `${wrap(node.operand, PERCENT_PRECEDENCE)}%`;
    case "unary":
      return `${node.op}${wrap(node.operand, UNARY_PRECEDENCE)}`;
    case "binary": {
      const own = PRECEDENCE[node.op] ?? ATOM_PRECEDENCE;
      // `^` is right-associative, everything else left-associative: the side
      // that does *not* absorb same-precedence operators needs the parens.
      const rightAssociative = node.op === "^";
      const left = wrap(node.left, rightAssociative ? own + 1 : own);
      const right = wrap(node.right, rightAssociative ? own : own + 1);
      return `${left}${node.op}${right}`;
    }
  }
}

function wrap(node: Node, minPrecedence: number): string {
  const text = print(node);
  return precedenceOf(node) < minPrecedence ? `(${text})` : text;
}

/**
 * Drop `group` nodes so two trees can be compared for structural equality
 * regardless of how the source spelled its parentheses.
 */
export function stripGroups(node: Node): Node {
  switch (node.kind) {
    case "group":
      return stripGroups(node.inner);
    case "unary":
      return { kind: "unary", op: node.op, operand: stripGroups(node.operand) };
    case "percent":
      return { kind: "percent", operand: stripGroups(node.operand) };
    case "binary":
      return {
        kind: "binary",
        op: node.op,
        left: stripGroups(node.left),
        right: stripGroups(node.right),
      };
    case "call":
      return { kind: "call", name: node.name, args: node.args.map(stripGroups) };
    default:
      return node;
  }
}
