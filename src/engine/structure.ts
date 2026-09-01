/**
 * Structural edits: inserting and deleting whole rows and columns.
 *
 * Moving the cells is the easy half. The hard half is that every formula in the
 * sheet is written in terms of positions that the edit is about to change, so
 * each one has to be rewritten to mean what it meant before. A reference whose
 * target survives shifts by the delta; a reference whose target is deleted has
 * no honest answer left and becomes `#REF!`.
 *
 * All of that is arithmetic on one axis at a time, so the rules below are
 * written once over plain indices and applied to columns or rows by picking
 * which coordinate to feed in.
 */

import type { Node } from "./ast.js";
import { MAX_COLUMNS, MAX_ROWS } from "./reference.js";
import type { CellRef, Coord, RangeRef } from "./reference.js";

export type Axis = "row" | "column";
export type StructuralOperation = "insert" | "delete";

/** One structural edit: `count` lines inserted at, or deleted from, `at`. */
export interface StructuralEdit {
  readonly axis: Axis;
  readonly operation: StructuralOperation;
  /** Zero-based index of the first affected row or column. */
  readonly at: number;
  /** How many lines the edit covers. At least one. */
  readonly count: number;
}

/** Thrown for an edit that does not describe a possible operation. */
export class StructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructureError";
  }
}

/** The number of addressable lines on an axis. */
export function axisLimit(axis: Axis): number {
  return axis === "row" ? MAX_ROWS : MAX_COLUMNS;
}

export function validateEdit(edit: StructuralEdit): void {
  const limit = axisLimit(edit.axis);
  if (!Number.isInteger(edit.at) || edit.at < 0 || edit.at >= limit) {
    throw new StructureError(
      `${edit.axis} index out of range: ${edit.at} (0 to ${limit - 1})`,
    );
  }
  if (!Number.isInteger(edit.count) || edit.count < 1) {
    throw new StructureError(`count must be a positive integer: ${edit.count}`);
  }
  if (edit.operation === "delete" && edit.at + edit.count > limit) {
    throw new StructureError(
      `cannot delete ${edit.count} ${edit.axis}s from ${edit.at}: past the end of the sheet`,
    );
  }
}

/**
 * Where a single line index ends up, or `null` if it does not survive.
 *
 * This is the rule for both a stored cell and a lone reference, which is not a
 * coincidence: a reference to one cell has to follow that cell, and a cell that
 * was deleted leaves nothing to point at.
 */
export function adjustIndex(index: number, edit: StructuralEdit): number | null {
  const { at, count, operation } = edit;
  if (operation === "insert") {
    if (index < at) return index;
    const moved = index + count;
    // An insert can push the tail of the sheet past the last addressable line.
    return moved >= axisLimit(edit.axis) ? null : moved;
  }
  if (index < at) return index;
  if (index < at + count) return null;
  return index - count;
}

/**
 * Where the two ends of a span end up, or `null` if the whole span is gone.
 *
 * The interesting cases are the ones where the edit lands partly inside:
 *
 * - inserting above a span moves it; inserting inside it stretches it, because
 *   the new lines are within what the span was describing;
 * - deleting part of a span shortens it, and an end that was itself deleted
 *   collapses onto the surviving line next to it — the start onto the first
 *   line after the hole, the end onto the last line before it.
 *
 * Those two collapses are what makes a fully deleted span detectable without a
 * special case: the start lands one past the end, and an inverted span is the
 * signal that nothing is left.
 */
export function adjustSpan(
  start: number,
  end: number,
  edit: StructuralEdit,
): readonly [number, number] | null {
  const { at, count, operation } = edit;
  const limit = axisLimit(edit.axis);

  if (operation === "insert") {
    if (at > end) return [start, end];
    if (at <= start) {
      const movedStart = start + count;
      if (movedStart >= limit) return null;
      return [movedStart, Math.min(end + count, limit - 1)];
    }
    // at is inside the span: the span grows to cover the new lines.
    return [start, Math.min(end + count, limit - 1)];
  }

  const newStart = start < at ? start : start >= at + count ? start - count : at;
  const newEnd = end < at ? end : end >= at + count ? end - count : at - 1;
  return newEnd < newStart ? null : [newStart, newEnd];
}

function axisOf(coord: Coord, axis: Axis): number {
  return axis === "row" ? coord.row : coord.col;
}

/** Where a stored cell moves to, or `null` if the edit removes it. */
export function adjustCoord(coord: Coord, edit: StructuralEdit): Coord | null {
  const moved = adjustIndex(axisOf(coord, edit.axis), edit);
  if (moved === null) return null;
  return edit.axis === "row"
    ? { col: coord.col, row: moved }
    : { col: moved, row: coord.row };
}

/** Rewrite a cell reference, or `null` when its target is gone. */
export function adjustRef(ref: CellRef, edit: StructuralEdit): CellRef | null {
  const moved = adjustIndex(axisOf(ref, edit.axis), edit);
  if (moved === null) return null;
  return edit.axis === "row" ? { ...ref, row: moved } : { ...ref, col: moved };
}

/**
 * Rewrite a range reference, or `null` when nothing of it is left.
 *
 * The range is treated as already normalised — every range reaching the engine
 * has been through `normalizeRange` — so `start` really is the top-left corner
 * and the span rules apply directly.
 */
export function adjustRange(
  range: RangeRef,
  edit: StructuralEdit,
): RangeRef | null {
  const { start, end } = range;
  const span = adjustSpan(
    axisOf(start, edit.axis),
    axisOf(end, edit.axis),
    edit,
  );
  if (span === null) return null;
  const [low, high] = span;
  return edit.axis === "row"
    ? { start: { ...start, row: low }, end: { ...end, row: high } }
    : { start: { ...start, col: low }, end: { ...end, col: high } };
}

const REF_NODE: Node = { kind: "error", code: "#REF!" };

/**
 * Rewrite every reference in a formula for one structural edit.
 *
 * The returned tree is the same object when nothing in it moved. That identity
 * is load-bearing rather than an optimisation: the caller uses it to tell which
 * formulas were actually affected, and so leaves the rest of the sheet spelled
 * exactly as the user typed it instead of reprinting it canonically.
 */
export function adjustAst(node: Node, edit: StructuralEdit): Node {
  switch (node.kind) {
    case "reference": {
      const ref = adjustRef(node.ref, edit);
      if (ref === null) return REF_NODE;
      return ref.col === node.ref.col && ref.row === node.ref.row
        ? node
        : { kind: "reference", ref };
    }
    case "range": {
      const range = adjustRange(node.range, edit);
      if (range === null) return REF_NODE;
      return sameRange(range, node.range) ? node : { kind: "range", range };
    }
    case "unary": {
      const operand = adjustAst(node.operand, edit);
      return operand === node.operand
        ? node
        : { kind: "unary", op: node.op, operand };
    }
    case "percent": {
      const operand = adjustAst(node.operand, edit);
      return operand === node.operand ? node : { kind: "percent", operand };
    }
    case "group": {
      const inner = adjustAst(node.inner, edit);
      return inner === node.inner ? node : { kind: "group", inner };
    }
    case "binary": {
      const left = adjustAst(node.left, edit);
      const right = adjustAst(node.right, edit);
      return left === node.left && right === node.right
        ? node
        : { kind: "binary", op: node.op, left, right };
    }
    case "call": {
      let changed = false;
      const args = node.args.map((arg) => {
        const next = adjustAst(arg, edit);
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
