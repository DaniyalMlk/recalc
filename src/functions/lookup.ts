import { NA_ERROR, REF_ERROR, VALUE_ERROR, isFormulaError } from "../engine/errors.js";
import { normalizeRange } from "../engine/reference.js";
import { compareValues, toBoolean } from "../engine/value.js";
import type { Value } from "../engine/value.js";
import { argValue, argValues, defineFunction } from "./registry.js";
import type { Arg, RangeArg } from "./registry.js";

interface Shape {
  readonly rows: number;
  readonly cols: number;
  cell(row: number, col: number): Value;
}

/** Interpret a range argument as a rectangular block, zero-indexed. */
function shapeOf(arg: Arg): Shape | Value {
  if (arg.kind === "scalar") {
    return { rows: 1, cols: 1, cell: () => arg.value };
  }
  const range = normalizeRange((arg as RangeArg).range);
  const rows = range.end.row - range.start.row + 1;
  const cols = range.end.col - range.start.col + 1;
  const values = arg.values;
  return {
    rows,
    cols,
    cell(row, col) {
      if (row < 0 || row >= rows || col < 0 || col >= cols) return REF_ERROR;
      return values[row * cols + col] ?? null;
    },
  };
}

/**
 * Approximate match: the largest entry less than or equal to the target,
 * assuming the vector is sorted ascending.
 *
 * Binary search, not a linear scan. An approximate lookup down a sorted column
 * of a few thousand rows is exactly where a spreadsheet spends its time, and
 * the sortedness precondition is already assumed by the semantics, so there is
 * no reason not to use it.
 */
function approximateIndex(vector: readonly Value[], target: Value): number {
  let low = 0;
  let high = vector.length - 1;
  let best = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const cmp = compareValues(vector[mid]!, target);
    if (isFormulaError(cmp)) return -1;
    if (cmp <= 0) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function exactIndex(vector: readonly Value[], target: Value): number {
  for (let i = 0; i < vector.length; i++) {
    const cmp = compareValues(vector[i]!, target);
    if (isFormulaError(cmp)) continue;
    if (cmp === 0) return i;
  }
  return -1;
}

function lookup(args: readonly Arg[], byRow: boolean): Value {
  const target = argValue(args[0]!);
  if (isFormulaError(target)) return target;

  const shape = shapeOf(args[1]!);
  if (!isShape(shape)) return shape;

  const indexValue = argValue(args[2]!);
  if (isFormulaError(indexValue)) return indexValue;
  const offset = Math.trunc(Number(indexValue));
  if (!Number.isFinite(offset) || offset < 1) return VALUE_ERROR;

  const limit = byRow ? shape.cols : shape.rows;
  if (offset > limit) return REF_ERROR;

  const approximate =
    args.length > 3 ? toBoolean(argValue(args[3]!)) : true;
  if (isFormulaError(approximate)) return approximate;

  const searchLength = byRow ? shape.rows : shape.cols;
  const vector: Value[] = [];
  for (let i = 0; i < searchLength; i++) {
    vector.push(byRow ? shape.cell(i, 0) : shape.cell(0, i));
  }

  const found = approximate
    ? approximateIndex(vector, target)
    : exactIndex(vector, target);
  if (found < 0) return NA_ERROR;

  return byRow ? shape.cell(found, offset - 1) : shape.cell(offset - 1, found);
}

function isShape(value: Shape | Value): value is Shape {
  return typeof value === "object" && value !== null && "rows" in value;
}

defineFunction({
  name: "VLOOKUP",
  description: "Looks a value up in the first column and returns from another.",
  minArgs: 3,
  maxArgs: 4,
  call: (args) => lookup(args, true),
});

defineFunction({
  name: "HLOOKUP",
  description: "Looks a value up in the first row and returns from another.",
  minArgs: 3,
  maxArgs: 4,
  call: (args) => lookup(args, false),
});

defineFunction({
  name: "MATCH",
  description: "Position of a value in a vector; type 1, 0 or -1.",
  minArgs: 2,
  maxArgs: 3,
  call(args) {
    const target = argValue(args[0]!);
    if (isFormulaError(target)) return target;
    const vector = [...argValues(args[1]!)];
    const typeValue = args.length > 2 ? argValue(args[2]!) : 1;
    const type = Math.trunc(Number(typeValue));
    if (!Number.isFinite(type)) return VALUE_ERROR;

    if (type === 0) {
      const index = exactIndex(vector, target);
      return index < 0 ? NA_ERROR : index + 1;
    }
    if (type === 1) {
      const index = approximateIndex(vector, target);
      return index < 0 ? NA_ERROR : index + 1;
    }
    // Descending vector: the smallest entry greater than or equal to target.
    let best = -1;
    for (let i = 0; i < vector.length; i++) {
      const cmp = compareValues(vector[i]!, target);
      if (isFormulaError(cmp)) continue;
      if (cmp >= 0) best = i;
      else break;
    }
    return best < 0 ? NA_ERROR : best + 1;
  },
});

defineFunction({
  name: "INDEX",
  description: "Value at a row and column offset within a range, 1-indexed.",
  minArgs: 2,
  maxArgs: 3,
  call(args) {
    const shape = shapeOf(args[0]!);
    if (!isShape(shape)) return shape;
    const rowValue = argValue(args[1]!);
    if (isFormulaError(rowValue)) return rowValue;
    const row = Math.trunc(Number(rowValue));
    const colValue = args.length > 2 ? argValue(args[2]!) : 1;
    if (isFormulaError(colValue)) return colValue;
    const col = Math.trunc(Number(colValue));
    if (!Number.isFinite(row) || !Number.isFinite(col)) return VALUE_ERROR;

    // A one-dimensional range indexes by its long axis, so INDEX(A1:A9, 3)
    // means the third row even though only one argument was supplied.
    if (args.length === 2 && shape.cols === 1) {
      if (row < 1 || row > shape.rows) return REF_ERROR;
      return shape.cell(row - 1, 0);
    }
    if (args.length === 2 && shape.rows === 1) {
      if (row < 1 || row > shape.cols) return REF_ERROR;
      return shape.cell(0, row - 1);
    }
    if (row < 1 || row > shape.rows || col < 1 || col > shape.cols) {
      return REF_ERROR;
    }
    return shape.cell(row - 1, col - 1);
  },
});

defineFunction({
  name: "CHOOSE",
  description: "Picks the n-th of the following arguments.",
  minArgs: 2,
  maxArgs: Infinity,
  call(args) {
    const indexValue = argValue(args[0]!);
    if (isFormulaError(indexValue)) return indexValue;
    const index = Math.trunc(Number(indexValue));
    if (!Number.isFinite(index) || index < 1 || index > args.length - 1) {
      return VALUE_ERROR;
    }
    return argValue(args[index]!);
  },
});
