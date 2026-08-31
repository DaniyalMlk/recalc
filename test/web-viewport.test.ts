import { describe, expect, it } from "vitest";

import { AxisMetrics } from "../web/src/core/metrics.js";
import {
  computeWindow,
  pageStep,
  sameWindow,
  scrollToCell,
  visibleWindow,
  windowContains,
  windowSize,
} from "../web/src/core/viewport.js";
import type { Viewport } from "../web/src/core/viewport.js";

function axes(): { rows: AxisMetrics; cols: AxisMetrics } {
  return {
    rows: new AxisMetrics(1000, 20),
    cols: new AxisMetrics(200, 100),
  };
}

const AT_ORIGIN: Viewport = {
  scrollTop: 0,
  scrollLeft: 0,
  height: 200,
  width: 500,
};

describe("computeWindow", () => {
  it("covers the visible cells plus the overscan band", () => {
    const { rows, cols } = axes();
    const window = computeWindow(AT_ORIGIN, rows, cols, { rows: 3, cols: 1 });

    // Ten rows fit in 200px; three more below, none above at the top edge.
    expect(window).toEqual({
      rowStart: 0,
      rowEnd: 13,
      colStart: 0,
      colEnd: 6,
    });
  });

  it("clamps the band at the start of the sheet", () => {
    const { rows, cols } = axes();
    const window = computeWindow(AT_ORIGIN, rows, cols, { rows: 50, cols: 50 });
    expect(window.rowStart).toBe(0);
    expect(window.colStart).toBe(0);
  });

  it("clamps the band at the end of the sheet", () => {
    const { rows, cols } = axes();
    const window = computeWindow(
      { ...AT_ORIGIN, scrollTop: rows.totalSize - 100 },
      rows,
      cols,
      { rows: 20, cols: 0 },
    );
    expect(window.rowEnd).toBe(rows.count);
  });

  it("scrolls the window without changing how much it draws", () => {
    const { rows, cols } = axes();
    const top = computeWindow(AT_ORIGIN, rows, cols, { rows: 2, cols: 2 });
    const middle = computeWindow(
      { ...AT_ORIGIN, scrollTop: 4000 },
      rows,
      cols,
      { rows: 2, cols: 2 },
    );
    expect(middle.rowStart).toBe(198);
    expect(windowSize(middle)).toBeGreaterThan(0);
    // The band at the very top is half-clipped, so the moved window is larger
    // by exactly the rows that were clipped off the top.
    expect(windowSize(middle) - windowSize(top)).toBe(
      2 * (top.colEnd - top.colStart),
    );
  });

  it("a million-row sheet still draws a screenful", () => {
    const rows = new AxisMetrics(1_048_576, 22);
    const cols = new AxisMetrics(16_384, 96);
    const window = computeWindow(
      { scrollTop: 10_000_000, scrollLeft: 400_000, height: 800, width: 1200 },
      rows,
      cols,
    );
    expect(windowSize(window)).toBeLessThan(1000);
    expect(window.rowStart).toBeGreaterThan(450_000);
  });

  it("respects a resized row when deciding what is visible", () => {
    const { cols } = axes();
    const rows = new AxisMetrics(1000, 20);
    rows.resize(0, 180);

    const window = visibleWindow(AT_ORIGIN, rows, cols);
    // The tall first row leaves only 20px, so one more row shows.
    expect(window).toEqual({ rowStart: 0, rowEnd: 2, colStart: 0, colEnd: 5 });
  });
});

describe("window helpers", () => {
  const window = { rowStart: 2, rowEnd: 6, colStart: 1, colEnd: 3 };

  it("reports containment on the half-open bounds", () => {
    expect(windowContains(window, 2, 1)).toBe(true);
    expect(windowContains(window, 5, 2)).toBe(true);
    expect(windowContains(window, 6, 2)).toBe(false);
    expect(windowContains(window, 5, 3)).toBe(false);
  });

  it("counts the cells it covers", () => {
    expect(windowSize(window)).toBe(8);
  });

  it("compares windows by value", () => {
    expect(sameWindow(window, { ...window })).toBe(true);
    expect(sameWindow(window, { ...window, rowEnd: 7 })).toBe(false);
  });
});

describe("scrollToCell", () => {
  it("leaves the scroll alone when the cell already fits", () => {
    const { rows, cols } = axes();
    const next = scrollToCell(AT_ORIGIN, rows, cols, 3, 2);
    expect(next).toEqual({ scrollTop: 0, scrollLeft: 0 });
  });

  it("scrolls up just enough to expose a cell above the fold", () => {
    const { rows, cols } = axes();
    const viewport: Viewport = { ...AT_ORIGIN, scrollTop: 400 };
    const next = scrollToCell(viewport, rows, cols, 15, 0);
    expect(next.scrollTop).toBe(300);
  });

  it("scrolls down so the cell's trailing edge lands on the fold", () => {
    const { rows, cols } = axes();
    const next = scrollToCell(AT_ORIGIN, rows, cols, 20, 0);
    // Row 20 ends at 420; a 200px viewport must start at 220.
    expect(next.scrollTop).toBe(220);
  });

  it("never scrolls past the start of the sheet", () => {
    const rows = new AxisMetrics(1000, 20);
    const cols = new AxisMetrics(200, 100);
    const next = scrollToCell(
      { scrollTop: 0, scrollLeft: 0, height: 10, width: 10 },
      rows,
      cols,
      0,
      0,
    );
    expect(next.scrollTop).toBe(0);
    expect(next.scrollLeft).toBe(0);
  });
});

describe("pageStep", () => {
  it("moves the cursor to the last row that was visible", () => {
    const rows = new AxisMetrics(1000, 20);
    // A 200px viewport shows rows 0..9, so paging lands on row 9.
    expect(pageStep(rows, 0, 200)).toBe(9);
  });

  it("always moves at least one index", () => {
    const rows = new AxisMetrics(1000, 20);
    expect(pageStep(rows, 0, 5)).toBe(1);
    expect(pageStep(rows, 0, 0)).toBe(1);
  });

  it("accounts for rows that were resized inside the page", () => {
    const rows = new AxisMetrics(1000, 20);
    rows.resize(3, 120);
    // The tall row eats five rows' worth of the page.
    expect(pageStep(rows, 0, 200)).toBe(4);
  });
});
