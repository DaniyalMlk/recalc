import type { ErrorCode } from "./errors.js";
import type { CellRef, RangeRef } from "./reference.js";

export type BinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "^"
  | "&"
  | "="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">=";

export type UnaryOperator = "+" | "-";

export interface NumberNode {
  readonly kind: "number";
  readonly value: number;
}

export interface StringNode {
  readonly kind: "string";
  readonly value: string;
}

export interface BooleanNode {
  readonly kind: "boolean";
  readonly value: boolean;
}

export interface ErrorNode {
  readonly kind: "error";
  readonly code: ErrorCode;
}

export interface ReferenceNode {
  readonly kind: "reference";
  readonly ref: CellRef;
}

export interface RangeNode {
  readonly kind: "range";
  readonly range: RangeRef;
}

/** A bare word that is neither a reference nor a call, e.g. a named range. */
export interface NameNode {
  readonly kind: "name";
  readonly name: string;
}

export interface CallNode {
  readonly kind: "call";
  /** Upper-cased at parse time; lookup is case-insensitive. */
  readonly name: string;
  readonly args: readonly Node[];
}

export interface UnaryNode {
  readonly kind: "unary";
  readonly op: UnaryOperator;
  readonly operand: Node;
}

export interface PercentNode {
  readonly kind: "percent";
  readonly operand: Node;
}

export interface BinaryNode {
  readonly kind: "binary";
  readonly op: BinaryOperator;
  readonly left: Node;
  readonly right: Node;
}

/** Explicit parentheses, kept so printing can round-trip the source. */
export interface GroupNode {
  readonly kind: "group";
  readonly inner: Node;
}

export type Node =
  | NumberNode
  | StringNode
  | BooleanNode
  | ErrorNode
  | ReferenceNode
  | RangeNode
  | NameNode
  | CallNode
  | UnaryNode
  | PercentNode
  | BinaryNode
  | GroupNode;

/** Depth-first walk over every node in the tree, parents before children. */
export function* walk(node: Node): Generator<Node> {
  yield node;
  switch (node.kind) {
    case "call":
      for (const arg of node.args) yield* walk(arg);
      return;
    case "unary":
    case "percent":
      yield* walk(node.operand);
      return;
    case "binary":
      yield* walk(node.left);
      yield* walk(node.right);
      return;
    case "group":
      yield* walk(node.inner);
      return;
    default:
      return;
  }
}
