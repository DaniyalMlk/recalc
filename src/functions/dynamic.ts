/**
 * The functions that reshape a table: sort it, filter it, deduplicate it.
 *
 * `src/functions/arrays.ts` holds the five block-producing functions that made
 * the spill path reachable at all — one that reshapes a block and one that
 * builds a block from nothing. These four are the ones someone would actually
 * write: a table ordered by one of its columns, the rows of it that match a
 * condition, the distinct values in it.
 *
 * Three things are shared by all of them and are the reason they live
 * together.
 *
 * **They work on whole rows, not cells.** Sorting a table by its third column
 * has to carry the other columns along, and the distinct values of a table are
 * its distinct *rows*. Every one of these is therefore written once over a
 * list of lines and run either on the rows or on the transpose, rather than
 * twice with the indices swapped.
 *
 * **Order and equality come from the engine, not from here.** `compareValues`
 * is what `<` and `=` are built on, so a sort that reached for `localeCompare`
 * or an `Array.prototype.includes` would disagree with the sheet about whether
 * `"a"` precedes `"B"` and about what a blank cell is. A second notion of
 * equality inside these functions would be the bug, not the feature.
 *
 * **An empty answer is an error, not an empty block.** A block with no rows
 * has no cell to anchor it, so there is nowhere on the sheet for it to be;
 * `#CALC!` says that, and `FILTER`'s third argument overrides it with
 * something to show instead.
 */

import { matrixOfRows, transposeMatrix } from "../engine/array.js";
import type { Matrix } from "../engine/array.js";
import { CALC_ERROR, err, isFormulaError } from "../engine/errors.js";
import type { FormulaError } from "../engine/errors.js";
import { compareValues, toBoolean } from "../engine/value.js";
import type { Value } from "../engine/value.js";
import { argMatrix, argValue, defineFunction, numberArg } from "./registry.js";
import type { Arg } from "./registry.js";

/** The lines of a block, as rows or as columns. */
function linesOf(block: Matrix, byColumn: boolean): readonly (readonly Value[])[] {
  const source = byColumn ? transposeMatrix(block) : block;
  const lines: Value[][] = [];
  for (let row = 0; row < source.rows; row += 1) {
    lines.push(source.values.slice(row * source.cols, (row + 1) * source.cols) as Value[]);
  }
  return lines;
}

/**
 * Lines back into a block, undoing the transpose that made them lines.
 *
 * `#CALC!` rather than an empty matrix: a result with no lines has no anchor
 * cell, so it has nowhere to be.
 */
function blockOf(
  lines: readonly (readonly Value[])[],
  byColumn: boolean,
): Matrix | FormulaError {
  if (lines.length === 0 || lines[0]?.length === 0) return CALC_ERROR;
  const block = matrixOfRows(lines);
  return byColumn ? transposeMatrix(block) : block;
}

/** The `by_col` flag every one of these takes, defaulting to working on rows. */
function byColumnArg(
  args: readonly Arg[],
  index: number,
): boolean | FormulaError {
  if (args.length <= index) return false;
  const flag = toBoolean(argValue(args[index]!));
  return flag;
}

/**
 * A sort order: 1 ascending, -1 descending, and nothing else.
 *
 * Refused rather than coerced, because a caller who passes 2 meant something,
 * and guessing which of the two they meant is worse than saying no.
 */
function orderArg(args: readonly Arg[], index: number): number | FormulaError {
  if (args.length <= index) return 1;
  const n = numberArg(args[index]);
  if (isFormulaError(n)) return n;
  if (n !== 1 && n !== -1) {
    return err("#VALUE!", "a sort order is 1 for ascending or -1 for descending");
  }
  return n;
}

/** One key of a sort: which values to order by, and in which direction. */
interface SortKey {
  readonly values: readonly Value[];
  readonly order: number;
}

/**
 * Order a list of line indices by a list of keys, stably.
 *
 * Stability is the whole contract: a later key only speaks where every earlier
 * one ties, and where *all* of them tie the lines come out in the order they
 * went in. `Array.prototype.sort` is specified as stable, but relying on that
 * alone would make the guarantee a property of the host rather than of this
 * function, so the original position is the final tiebreaker and the sort
 * cannot depend on it.
 */
function orderedIndices(
  count: number,
  keys: readonly SortKey[],
): readonly number[] | FormulaError {
  const indices = Array.from({ length: count }, (_, index) => index);
  let failure: FormulaError | null = null;
  indices.sort((left, right) => {
    if (failure !== null) return 0;
    for (const key of keys) {
      const comparison = compareValues(
        key.values[left] ?? null,
        key.values[right] ?? null,
      );
      if (isFormulaError(comparison)) {
        failure = comparison;
        return 0;
      }
      if (comparison !== 0) return key.order * comparison;
    }
    return left - right;
  });
  return failure ?? indices;
}

defineFunction({
  name: "SORT",
  description:
    "Sorts a block by one of its own lines: SORT(block, [index], [order], [by_col]).",
  minArgs: 1,
  maxArgs: 4,
  call(args) {
    const block = argMatrix(args[0]!);
    const byColumn = byColumnArg(args, 3);
    if (isFormulaError(byColumn)) return byColumn;
    const order = orderArg(args, 2);
    if (isFormulaError(order)) return order;

    const lines = linesOf(block, byColumn);
    const width = lines[0]?.length ?? 0;
    if (lines.length === 0 || width === 0) return CALC_ERROR;

    // The index counts across a line, so it is a column when sorting rows and
    // a row when sorting columns — which is the same number either way once
    // the block has been turned into lines.
    const index = args[1] === undefined ? 1 : numberArg(args[1]);
    if (isFormulaError(index)) return index;
    const key = Math.trunc(index);
    if (key < 1 || key > width) {
      return err("#VALUE!", `a sort index of ${key} is outside the block`);
    }

    const ordered = orderedIndices(lines.length, [
      { values: lines.map((line) => line[key - 1] ?? null), order },
    ]);
    if (isFormulaError(ordered)) return ordered;
    return blockOf(
      ordered.map((position) => lines[position] as readonly Value[]),
      byColumn,
    );
  },
});

defineFunction({
  name: "SORTBY",
  description:
    "Sorts a block by vectors outside it: SORTBY(block, by1, [order1], ...).",
  minArgs: 2,
  maxArgs: 13,
  call(args) {
    const block = argMatrix(args[0]!);
    // `SORTBY` has no `by_col`: the vectors say which way round it runs. A
    // column of keys sorts rows, a row of keys sorts columns.
    const first = argMatrix(args[1]!);
    const byColumn = first.rows === 1 && first.cols > 1;
    const lines = linesOf(block, byColumn);
    if (lines.length === 0 || (lines[0]?.length ?? 0) === 0) return CALC_ERROR;

    const keys: SortKey[] = [];
    for (let index = 1; index < args.length; index += 2) {
      const by = argMatrix(args[index]!);
      if (by.rows !== 1 && by.cols !== 1) {
        return err("#VALUE!", "a sort key has to be a single row or column");
      }
      if (by.values.length !== lines.length) {
        return err(
          "#VALUE!",
          `a sort key of ${by.values.length} has to match the ${lines.length} it orders`,
        );
      }
      const order = orderArg(args, index + 1);
      if (isFormulaError(order)) return order;
      keys.push({ values: by.values, order });
    }

    const ordered = orderedIndices(lines.length, keys);
    if (isFormulaError(ordered)) return ordered;
    return blockOf(
      ordered.map((position) => lines[position] as readonly Value[]),
      byColumn,
    );
  },
});

defineFunction({
  name: "FILTER",
  description:
    "Keeps the lines of a block a condition selects: FILTER(block, include, [if_empty]).",
  minArgs: 2,
  maxArgs: 3,
  call(args) {
    const block = argMatrix(args[0]!);
    const include = argMatrix(args[1]!);
    if (include.rows !== 1 && include.cols !== 1) {
      return err("#VALUE!", "a condition has to be a single row or column");
    }
    // A row of conditions selects columns and a column of them selects rows,
    // the same way `SORTBY` reads its keys. A single condition is ambiguous in
    // shape, so it is read against whichever dimension it can match.
    const byColumn =
      include.rows === 1 && include.cols > 1
        ? true
        : include.cols === 1 && include.rows > 1
          ? false
          : block.rows === 1 && block.cols !== 1;

    const lines = linesOf(block, byColumn);
    if (include.values.length !== lines.length) {
      return err(
        "#VALUE!",
        `a condition of ${include.values.length} has to match the ${lines.length} it selects`,
      );
    }

    const kept: (readonly Value[])[] = [];
    for (const [position, line] of lines.entries()) {
      const flag = toBoolean(include.values[position] ?? null);
      if (isFormulaError(flag)) return flag;
      if (flag) kept.push(line);
    }
    if (kept.length === 0) {
      // The whole point of the third argument: nothing matched is an answer,
      // and a caller may have something to show for it.
      return args[2] === undefined ? CALC_ERROR : argValue(args[2]!);
    }
    return blockOf(kept, byColumn);
  },
});

defineFunction({
  name: "UNIQUE",
  description:
    "The distinct lines of a block: UNIQUE(block, [by_col], [exactly_once]).",
  minArgs: 1,
  maxArgs: 3,
  call(args) {
    const block = argMatrix(args[0]!);
    const byColumn = byColumnArg(args, 1);
    if (isFormulaError(byColumn)) return byColumn;
    const onlyOnce = byColumnArg(args, 2);
    if (isFormulaError(onlyOnce)) return onlyOnce;

    const lines = linesOf(block, byColumn);
    if (lines.length === 0 || (lines[0]?.length ?? 0) === 0) return CALC_ERROR;

    // Compared with `compareValues` rather than hashed, so that two lines are
    // the same here exactly when the sheet's `=` says they are: case-blind in
    // text, and a blank equal to the zero of whatever it is next to. A hash
    // would be faster and would quietly disagree.
    const distinct: { line: readonly Value[]; count: number }[] = [];
    for (const line of lines) {
      const existing = distinct.find((candidate) => {
        for (const [position, value] of line.entries()) {
          const comparison = compareValues(value, candidate.line[position] ?? null);
          if (isFormulaError(comparison) || comparison !== 0) return false;
        }
        return true;
      });
      if (existing === undefined) distinct.push({ line, count: 1 });
      else existing.count += 1;
    }

    const kept = distinct
      .filter((entry) => (onlyOnce ? entry.count === 1 : true))
      .map((entry) => entry.line);
    if (kept.length === 0) return CALC_ERROR;
    return blockOf(kept, byColumn);
  },
});
