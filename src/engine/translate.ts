/**
 * Formula translation: moving a formula to a different address and keeping it
 * meaning the same thing relative to where it now sits.
 *
 * This is the operation behind fill-down, fill-across and paste. It is not the
 * same operation as a structural edit, and the difference is the anchors. A
 * structural edit moves the cells themselves, so `$A$1` has to follow them; a
 * translation moves the *formula* over cells that did not move, which is
 * exactly when a `$` means "do not follow me".
 */

import type { Node } from "./ast.js";
import { translateRange, translateRef } from "./reference.js";
import type { RangeRef } from "./reference.js";

const REF_NODE: Node = { kind: "error", code: "#REF!" };

/**
 * Shift every relative reference in a formula by a delta.
 *
 * As with the structural rewrite, the returned tree is the identical object
 * when nothing in it moved — a formula of anchored references and constants
 * fills down without being reprinted.
 */
export function translateAst(
  node: Node,
  deltaCol: number,
  deltaRow: number,
): Node {
  if (deltaCol === 0 && deltaRow === 0) return node;

  switch (node.kind) {
    case "reference": {
      const ref = translateRef(node.ref, deltaCol, deltaRow);
      if (ref === null) return REF_NODE;
      return ref.col === node.ref.col && ref.row === node.ref.row
        ? node
        : { kind: "reference", ref };
    }
    case "range": {
      const range = translateRange(node.range, deltaCol, deltaRow);
      if (range === null) return REF_NODE;
      return sameRange(range, node.range) ? node : { kind: "range", range };
    }
    case "unary": {
      const operand = translateAst(node.operand, deltaCol, deltaRow);
      return operand === node.operand
        ? node
        : { kind: "unary", op: node.op, operand };
    }
    case "percent": {
      const operand = translateAst(node.operand, deltaCol, deltaRow);
      return operand === node.operand ? node : { kind: "percent", operand };
    }
    case "group": {
      const inner = translateAst(node.inner, deltaCol, deltaRow);
      return inner === node.inner ? node : { kind: "group", inner };
    }
    case "binary": {
      const left = translateAst(node.left, deltaCol, deltaRow);
      const right = translateAst(node.right, deltaCol, deltaRow);
      return left === node.left && right === node.right
        ? node
        : { kind: "binary", op: node.op, left, right };
    }
    case "call": {
      let changed = false;
      const args = node.args.map((arg) => {
        const next = translateAst(arg, deltaCol, deltaRow);
        if (next !== arg) changed = true;
        return next;
      });
      return changed ? { kind: "call", name: node.name, args } : node;
    }
    default:
      return node;
  }
}

function sameRange(a: RangeRef, b: RangeRef): boolean {
  return (
    a.start.col === b.start.col &&
    a.start.row === b.start.row &&
    a.end.col === b.end.col &&
    a.end.row === b.end.row
  );
}
