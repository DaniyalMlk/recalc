import type { AxisMetrics } from "./metrics.js";

/**
 * Which cells a scroll position actually puts on screen.
 *
 * The renderer draws this window and nothing else, so the window is the entire
 * cost model of the grid: a sheet with a million rows and one with fifty
 * render the same number of nodes. The overscan band exists because a scroll
 * event arrives after the pixels have already moved, and drawing a few rows
 * beyond the fold gives the next frame something to reveal instead of a gap.
 */

export interface Viewport {
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly height: number;
  readonly width: number;
}

/** A half-open rectangle of indices: rows `[rowStart, rowEnd)`. */
export interface CellWindow {
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly colStart: number;
  readonly colEnd: number;
}

export interface OverscanOptions {
  /** Extra rows drawn above and below the fold. */
  readonly rows?: number;
  /** Extra columns drawn either side. */
  readonly cols?: number;
}

const DEFAULT_OVERSCAN: Required<OverscanOptions> = { rows: 4, cols: 2 };

/** Number of cells the window covers. */
export function windowSize(window: CellWindow): number {
  return (
    Math.max(0, window.rowEnd - window.rowStart) *
    Math.max(0, window.colEnd - window.colStart)
  );
}

export function sameWindow(a: CellWindow, b: CellWindow): boolean {
  return (
    a.rowStart === b.rowStart &&
    a.rowEnd === b.rowEnd &&
    a.colStart === b.colStart &&
    a.colEnd === b.colEnd
  );
}

export function windowContains(
  window: CellWindow,
  row: number,
  col: number,
): boolean {
  return (
    row >= window.rowStart &&
    row < window.rowEnd &&
    col >= window.colStart &&
    col < window.colEnd
  );
}

/** The cells visible at this scroll position, plus the overscan band. */
export function computeWindow(
  viewport: Viewport,
  rows: AxisMetrics,
  cols: AxisMetrics,
  overscan: OverscanOptions = {},
): CellWindow {
  const padRows = overscan.rows ?? DEFAULT_OVERSCAN.rows;
  const padCols = overscan.cols ?? DEFAULT_OVERSCAN.cols;

  const rowSpan = rows.rangeAt(viewport.scrollTop, viewport.scrollTop + viewport.height);
  const colSpan = cols.rangeAt(viewport.scrollLeft, viewport.scrollLeft + viewport.width);

  return {
    rowStart: Math.max(0, rowSpan.start - padRows),
    rowEnd: Math.min(rows.count, rowSpan.end + padRows),
    colStart: Math.max(0, colSpan.start - padCols),
    colEnd: Math.min(cols.count, colSpan.end + padCols),
  };
}

/** The cells visible with no overscan — what the user can genuinely see. */
export function visibleWindow(
  viewport: Viewport,
  rows: AxisMetrics,
  cols: AxisMetrics,
): CellWindow {
  return computeWindow(viewport, rows, cols, { rows: 0, cols: 0 });
}

/**
 * The smallest scroll adjustment that brings a cell fully into view.
 *
 * Returns the viewport's own scroll position unchanged when the cell already
 * fits, so a caller can assign the result unconditionally without causing a
 * scroll event on every keystroke.
 */
export function scrollToCell(
  viewport: Viewport,
  rows: AxisMetrics,
  cols: AxisMetrics,
  row: number,
  col: number,
): { scrollTop: number; scrollLeft: number } {
  return {
    scrollTop: scrollAxisInto(
      viewport.scrollTop,
      viewport.height,
      rows.offsetOf(row),
      rows.sizeOf(row),
    ),
    scrollLeft: scrollAxisInto(
      viewport.scrollLeft,
      viewport.width,
      cols.offsetOf(col),
      cols.sizeOf(col),
    ),
  };
}

/**
 * How far a page-up or page-down should travel on one axis, expressed as a
 * number of indices rather than pixels so the caller can move the cursor.
 *
 * The cursor lands on the last index that was visible, so the row the user was
 * reading at the fold becomes the row at the top. Always at least one, or
 * paging inside a viewport shorter than a single row would not move at all.
 */
export function pageStep(
  axis: AxisMetrics,
  from: number,
  extent: number,
): number {
  const start = axis.offsetOf(from);
  const last = axis.indexAt(start + Math.max(1, extent) - 1);
  return Math.max(1, last - from);
}

function scrollAxisInto(
  scroll: number,
  extent: number,
  offset: number,
  size: number,
): number {
  // A cell taller or wider than the viewport cannot be fully exposed. Align
  // its leading edge instead of its trailing one, or a resized row would
  // scroll its own top out of sight the moment the cursor reached it.
  if (size >= extent) return offset;
  if (offset < scroll) return offset;
  if (offset + size > scroll + extent) return offset + size - extent;
  return scroll;
}
