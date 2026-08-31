/**
 * Sizes and offsets along one axis of the grid.
 *
 * A sheet is 16,384 columns by 1,048,576 rows. Materialising a prefix-sum
 * array over the row axis would cost eight megabytes to answer a question that
 * is almost always `row * defaultSize`, so nothing is materialised. Instead the
 * axis keeps only the indices whose size differs from the default, sorted, with
 * a running total of how much those overrides have displaced everything after
 * them. An offset is then one binary search over that sparse list, and a hit
 * test is one binary search over the index space on top of it.
 *
 * Both stay fast when a hundred columns have been resized, which is the real
 * upper bound on hand-resizing, and cost nothing at all when none have.
 */

/** A resized index and the size it was given. */
interface Override {
  readonly index: number;
  readonly size: number;
}

export interface AxisSpan {
  /** First index in the span. */
  readonly start: number;
  /** Index one past the end of the span. */
  readonly end: number;
}

export class AxisMetrics {
  /** Sorted by index, and kept sorted on every write. */
  private overrides: Override[] = [];

  /**
   * `cumulative[i]` is the total displacement contributed by overrides
   * `0..i` inclusive — the sum of `size - defaultSize` over that prefix.
   * Rebuilt on write, which is rare, and read on every offset query.
   */
  private cumulative: number[] = [];

  constructor(
    /** Number of addressable indices on this axis. */
    readonly count: number,
    /** Size of an index that has not been resized. */
    readonly defaultSize: number,
    /** Smallest size a resize may produce. */
    readonly minSize = 24,
  ) {
    if (count <= 0) throw new RangeError("axis count must be positive");
    if (defaultSize <= 0) throw new RangeError("default size must be positive");
  }

  /** Total displacement contributed by every override. */
  private get totalDelta(): number {
    return this.cumulative.length === 0
      ? 0
      : (this.cumulative[this.cumulative.length - 1] as number);
  }

  /** Combined size of the whole axis. */
  get totalSize(): number {
    return this.count * this.defaultSize + this.totalDelta;
  }

  /** How many indices have been given an explicit size. */
  get resizedCount(): number {
    return this.overrides.length;
  }

  /** Size of one index. */
  sizeOf(index: number): number {
    const at = this.findOverride(index);
    return at < 0 ? this.defaultSize : (this.overrides[at] as Override).size;
  }

  /** True when this index has been given a size of its own. */
  isResized(index: number): boolean {
    return this.findOverride(index) >= 0;
  }

  /**
   * Give one index an explicit size. Sizes below {@link minSize} are clamped
   * rather than rejected, because the caller is usually a drag handle and a
   * drag that overshoots should stop at the minimum, not throw.
   */
  resize(index: number, size: number): void {
    this.assertIndex(index);
    const clamped = Math.max(this.minSize, Math.round(size));
    const at = this.findOverride(index);

    if (clamped === this.defaultSize) {
      if (at >= 0) {
        this.overrides.splice(at, 1);
        this.rebuild();
      }
      return;
    }

    if (at >= 0) {
      const existing = this.overrides[at] as Override;
      if (existing.size === clamped) return;
      this.overrides[at] = { index, size: clamped };
    } else {
      this.overrides.splice(~at, 0, { index, size: clamped });
    }
    this.rebuild();
  }

  /** Drop an explicit size, returning the index to the default. */
  reset(index: number): void {
    const at = this.findOverride(index);
    if (at < 0) return;
    this.overrides.splice(at, 1);
    this.rebuild();
  }

  /** Drop every explicit size. */
  resetAll(): void {
    this.overrides = [];
    this.cumulative = [];
  }

  /**
   * Distance from the start of the axis to the leading edge of `index`.
   *
   * Defined for `index === count` as well, which is the trailing edge of the
   * last index and is what a renderer needs to size the scrollable canvas.
   */
  offsetOf(index: number): number {
    if (index <= 0) return 0;
    const clamped = Math.min(index, this.count);
    return clamped * this.defaultSize + this.deltaBefore(clamped);
  }

  /** Leading and trailing edge of one index. */
  spanOf(index: number): AxisSpan {
    const start = this.offsetOf(index);
    return { start, end: start + this.sizeOf(index) };
  }

  /**
   * The index containing `position`, clamped into range.
   *
   * Binary search over the index space rather than over the override list:
   * `offsetOf` is monotonic because every size is positive, so the standard
   * lower-bound search applies even though no array of offsets exists.
   */
  indexAt(position: number): number {
    if (position <= 0) return 0;
    if (position >= this.totalSize) return this.count - 1;

    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsetOf(mid) <= position) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Every index whose span intersects `[from, to)`, clamped into range. */
  rangeAt(from: number, to: number): AxisSpan {
    if (to <= from) {
      const only = this.indexAt(from);
      return { start: only, end: only + 1 };
    }
    const start = this.indexAt(from);
    const last = this.indexAt(to - 1);
    return { start, end: last + 1 };
  }

  /** Serialise the explicit sizes, for persistence. */
  toJSON(): Record<number, number> {
    const out: Record<number, number> = {};
    for (const entry of this.overrides) out[entry.index] = entry.size;
    return out;
  }

  /** Restore explicit sizes produced by {@link toJSON}. */
  load(sizes: Record<number, number>): void {
    this.resetAll();
    const entries = Object.entries(sizes)
      .map(([key, size]) => ({ index: Number(key), size }))
      .filter(
        (entry) =>
          Number.isInteger(entry.index) &&
          entry.index >= 0 &&
          entry.index < this.count,
      )
      .sort((a, b) => a.index - b.index);

    this.overrides = entries.map((entry) => ({
      index: entry.index,
      size: Math.max(this.minSize, Math.round(entry.size)),
    }));
    this.rebuild();
  }

  /** Total displacement contributed by overrides strictly below `index`. */
  private deltaBefore(index: number): number {
    if (this.overrides.length === 0) return 0;
    // Largest override position with `overrides[position].index < index`.
    let lo = 0;
    let hi = this.overrides.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((this.overrides[mid] as Override).index < index) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found < 0 ? 0 : (this.cumulative[found] as number);
  }

  /**
   * Index of `target` in the override list, or `~insertionPoint` when absent —
   * the same negative-complement convention `Array.prototype.indexOf` would
   * have if it reported where a miss belonged.
   */
  private findOverride(target: number): number {
    let lo = 0;
    let hi = this.overrides.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const at = (this.overrides[mid] as Override).index;
      if (at === target) return mid;
      if (at < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return ~lo;
  }

  private rebuild(): void {
    this.cumulative = new Array<number>(this.overrides.length);
    let running = 0;
    for (let i = 0; i < this.overrides.length; i += 1) {
      running += (this.overrides[i] as Override).size - this.defaultSize;
      this.cumulative[i] = running;
    }
  }

  private assertIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) {
      throw new RangeError(`index ${index} is outside the axis`);
    }
  }
}
