import { cellKey, iterateRange, parseCellKey } from "./reference.js";
import type { Coord, RangeRef } from "./reference.js";

/**
 * Sparse cell storage.
 *
 * A sheet is 16384 x 1048576 cells, so the grid is a hash map keyed by
 * coordinate rather than an array. Nothing is allocated for a cell until it is
 * written, and clearing a cell removes the entry so an empty sheet costs
 * nothing again.
 *
 * The payload type is a parameter: the engine stores cell records here, but
 * the same structure backs anything addressed by coordinate.
 */
export class SparseGrid<T> {
  private readonly cells = new Map<string, T>();
  private maxCol = -1;
  private maxRow = -1;
  /** Set once a delete may have invalidated the cached extent. */
  private extentDirty = false;

  get size(): number {
    return this.cells.size;
  }

  has(coord: Coord): boolean {
    return this.cells.has(cellKey(coord));
  }

  get(coord: Coord): T | undefined {
    return this.cells.get(cellKey(coord));
  }

  set(coord: Coord, value: T): void {
    this.cells.set(cellKey(coord), value);
    if (coord.col > this.maxCol) this.maxCol = coord.col;
    if (coord.row > this.maxRow) this.maxRow = coord.row;
  }

  delete(coord: Coord): boolean {
    const removed = this.cells.delete(cellKey(coord));
    if (removed && (coord.col === this.maxCol || coord.row === this.maxRow)) {
      this.extentDirty = true;
    }
    return removed;
  }

  clear(): void {
    this.cells.clear();
    this.maxCol = -1;
    this.maxRow = -1;
    this.extentDirty = false;
  }

  /** Occupied coordinates, in insertion order. */
  *coords(): Generator<Coord> {
    for (const key of this.cells.keys()) {
      yield parseCellKey(key);
    }
  }

  *entries(): Generator<[Coord, T]> {
    for (const [key, value] of this.cells) {
      yield [parseCellKey(key), value];
    }
  }

  /** Every occupied cell in a range, row-major, skipping blanks. */
  *entriesInRange(range: RangeRef): Generator<[Coord, T]> {
    for (const coord of iterateRange(range)) {
      const value = this.cells.get(cellKey(coord));
      if (value !== undefined) yield [coord, value];
    }
  }

  /**
   * The bounding box of the occupied cells, or `null` for an empty grid.
   *
   * Deletions only mark the cached extent stale rather than rescanning, so a
   * bulk clear stays O(1) per cell and the rescan happens at most once, the
   * next time the extent is actually asked for.
   */
  extent(): RangeRef | null {
    if (this.cells.size === 0) return null;
    if (this.extentDirty) this.recomputeExtent();
    return {
      start: { col: 0, row: 0, colAbsolute: false, rowAbsolute: false },
      end: {
        col: this.maxCol,
        row: this.maxRow,
        colAbsolute: false,
        rowAbsolute: false,
      },
    };
  }

  private recomputeExtent(): void {
    this.maxCol = -1;
    this.maxRow = -1;
    for (const key of this.cells.keys()) {
      const { col, row } = parseCellKey(key);
      if (col > this.maxCol) this.maxCol = col;
      if (row > this.maxRow) this.maxRow = row;
    }
    this.extentDirty = false;
  }
}
