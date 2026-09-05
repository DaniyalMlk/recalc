import { isMatrix } from "./array.js";
import type { CallResult, Matrix } from "./array.js";
import { SPILL_ERROR, err, isFormulaError } from "./errors.js";
import { SparseGrid } from "./grid.js";
import {
  MAX_COLUMNS,
  MAX_ROWS,
  cellKey,
  formatA1,
  iterateRange,
  parseCellKey,
} from "./reference.js";
import type { Coord, RangeRef } from "./reference.js";
import type { Value } from "./value.js";

/** One cell of a spill, and the formula it came out of. */
export interface SpilledCell {
  readonly anchor: Coord;
  readonly value: Value;
}

/** The outcome of trying to lay a block down on the sheet. */
export interface Placement {
  /** What the anchor cell itself should hold. */
  readonly value: Value;
  /** Cells whose value changed, so their dependents can be invalidated. */
  readonly touched: readonly Coord[];
}

function coordOf(col: number, row: number): Coord {
  return { col, row };
}

const parseId = parseCellKey;

function regionFrom(anchor: Coord, rows: number, cols: number): RangeRef {
  return {
    start: { ...anchor, colAbsolute: false, rowAbsolute: false },
    end: {
      col: anchor.col + cols - 1,
      row: anchor.row + rows - 1,
      colAbsolute: false,
      rowAbsolute: false,
    },
  };
}

/** Whether two values are the same value, errors compared by code. */
function identical(a: Value, b: Value): boolean {
  if (isFormulaError(a) || isFormulaError(b)) {
    return isFormulaError(a) && isFormulaError(b) && a.code === b.code;
  }
  return Object.is(a, b);
}

/**
 * Where the blocks currently on the sheet are.
 *
 * A spilled cell is *derived*: nothing was typed into it, it holds no formula,
 * and it is not part of the edit history. That is what keeps undo honest —
 * undoing the edit that created a spill restores the inputs, and the spill
 * simply is not recomputed, rather than having to be unwound.
 *
 * The table is separate from the cell store for the same reason. Merging them
 * would make every read of "is there a cell here" ambiguous, and that question
 * is exactly the one a spill has to ask before it lands.
 */
export class SpillTable {
  /** Every cell covered by a spill, including each anchor. */
  private readonly covered = new SparseGrid<SpilledCell>();
  /** Anchor id -> the region it occupies. */
  private readonly regions = new Map<string, RangeRef>();
  /**
   * Anchors whose last result was refused for want of room.
   *
   * A refused block leaves no trace on the sheet, so nothing links it to the
   * cell that was in the way, and clearing that cell cannot reach it through
   * the dependency graph. Keeping the short list of blocked anchors is what
   * lets a spill reappear the moment its obstruction is removed.
   */
  private readonly blocked = new Set<string>();

  get size(): number {
    return this.covered.size;
  }

  /** The spilled value at a coordinate, or `undefined` if none. */
  at(coord: Coord): SpilledCell | undefined {
    return this.covered.get(coord);
  }

  /** Whether a spill covers this coordinate. */
  covers(coord: Coord): boolean {
    return this.covered.has(coord);
  }

  /** The anchor whose spill covers this coordinate, if any. */
  anchorAt(coord: Coord): Coord | undefined {
    return this.covered.get(coord)?.anchor;
  }

  /** The region an anchor's block occupies, or `null` if it does not spill. */
  regionOf(anchor: Coord): RangeRef | null {
    return this.regions.get(cellKey(anchor)) ?? null;
  }

  /** Bounding box of every spilled cell, or `null` when there are none. */
  extent(): RangeRef | null {
    return this.covered.extent();
  }

  entries(): Generator<[Coord, SpilledCell]> {
    return this.covered.entries();
  }

  /** Anchors currently reporting `#SPILL!`, so they can be retried. */
  blockedAnchors(): Coord[] {
    return [...this.blocked].map(parseId);
  }

  /** Forget every spill. Callers that do this must recompute the sheet. */
  clear(): void {
    this.covered.clear();
    this.regions.clear();
    this.blocked.clear();
  }

  /**
   * Take down the block anchored at `anchor`, reporting what it uncovered.
   *
   * Only cells the anchor actually owns are removed, so a stale region entry
   * can never delete a neighbour's spill.
   */
  retract(anchor: Coord): Coord[] {
    const anchorId = cellKey(anchor);
    this.blocked.delete(anchorId);
    const region = this.regions.get(anchorId);
    if (region === undefined) return [];
    const touched: Coord[] = [];
    for (const coord of iterateRange(region)) {
      const held = this.covered.get(coord);
      if (held === undefined || cellKey(held.anchor) !== anchorId) continue;
      this.covered.delete(coord);
      // The anchor's own value is written by the caller either way, so it is
      // not reported as uncovered; everything else genuinely became blank.
      if (!identical(held.value, null) && cellKey(coord) !== anchorId) {
        touched.push(coord);
      }
    }
    this.regions.delete(anchorId);
    return touched;
  }

  /**
   * Lay a result down at `anchor`.
   *
   * A single value is not a spill at all and simply retracts whatever was
   * there. A block claims the cells below and to the right, and is refused
   * outright — `#SPILL!`, nothing written — if any of them is occupied by a
   * typed cell or by another formula's block. Refusing is the only safe
   * answer: writing over the obstruction destroys data, and shrinking the
   * result to fit reports a different answer from the one computed.
   */
  place(
    anchor: Coord,
    result: CallResult,
    isOccupied: (coord: Coord) => boolean,
  ): Placement {
    if (!isMatrix(result)) {
      return { value: result, touched: this.retract(anchor) };
    }
    return this.placeMatrix(anchor, result, isOccupied);
  }

  private placeMatrix(
    anchor: Coord,
    block: Matrix,
    isOccupied: (coord: Coord) => boolean,
  ): Placement {
    const { rows, cols } = block;
    if (rows === 0 || cols === 0) {
      return {
        value: err("#VALUE!", "the formula produced an empty block"),
        touched: this.retract(anchor),
      };
    }
    if (rows === 1 && cols === 1) {
      return {
        value: block.values[0] ?? null,
        touched: this.retract(anchor),
      };
    }
    if (anchor.row + rows > MAX_ROWS || anchor.col + cols > MAX_COLUMNS) {
      return {
        value: err("#REF!", "the block runs off the edge of the sheet"),
        touched: this.retract(anchor),
      };
    }

    const anchorId = cellKey(anchor);
    const region = regionFrom(anchor, rows, cols);

    const blocker = this.findBlocker(region, anchorId, isOccupied);
    if (blocker !== null) {
      // Whatever this anchor spilled before is taken down: the formula's
      // answer is now an error, and leaving the old block on the sheet would
      // show results that no longer belong to anything.
      const touched = this.retract(anchor);
      this.blocked.add(anchorId);
      return {
        value: err(
          "#SPILL!",
          `the block needs ${rows}x${cols} cells and ${formatA1({
            ...blocker,
            colAbsolute: false,
            rowAbsolute: false,
          })} is not empty`,
        ),
        touched,
      };
    }

    // What this anchor covered a moment ago, read before anything moves, so
    // the comparison below is against the real previous state.
    const before = new Map<string, Value>();
    const previous = this.regions.get(anchorId);
    if (previous !== undefined) {
      for (const coord of iterateRange(previous)) {
        const held = this.covered.get(coord);
        if (held === undefined || cellKey(held.anchor) !== anchorId) continue;
        before.set(cellKey(coord), held.value);
        this.covered.delete(coord);
      }
    }

    const touched: Coord[] = [];
    let index = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const coord = coordOf(anchor.col + c, anchor.row + r);
        const id = cellKey(coord);
        const value = block.values[index++] ?? null;
        this.covered.set(coord, { anchor, value });
        if (id !== anchorId && !identical(before.get(id) ?? null, value)) {
          touched.push(coord);
        }
        before.delete(id);
      }
    }

    // Whatever the old region covered and the new one does not has just gone
    // blank, and a formula reading it has to hear about that.
    for (const [id, value] of before) {
      if (id === anchorId || identical(value, null)) continue;
      touched.push(parseId(id));
    }

    this.regions.set(anchorId, region);
    return { value: block.values[0] ?? null, touched };
  }

  /**
   * The first cell in the region that is not free, or `null` when it is clear.
   *
   * The anchor itself is always free — it is where the formula lives — and so
   * is anything this same anchor already covers, or a block could never grow.
   */
  private findBlocker(
    region: RangeRef,
    anchorId: string,
    isOccupied: (coord: Coord) => boolean,
  ): Coord | null {
    for (const coord of iterateRange(region)) {
      if (cellKey(coord) === anchorId) continue;
      if (isOccupied(coord)) return coord;
      const held = this.covered.get(coord);
      if (held !== undefined && cellKey(held.anchor) !== anchorId) return coord;
    }
    return null;
  }
}

export { SPILL_ERROR };
