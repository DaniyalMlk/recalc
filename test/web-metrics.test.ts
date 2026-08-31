import { describe, expect, it } from "vitest";

import { AxisMetrics } from "../web/src/core/metrics.js";

describe("AxisMetrics with no overrides", () => {
  const axis = new AxisMetrics(100, 24);

  it("reports the default size everywhere", () => {
    expect(axis.sizeOf(0)).toBe(24);
    expect(axis.sizeOf(99)).toBe(24);
    expect(axis.resizedCount).toBe(0);
  });

  it("offsets are a plain multiple", () => {
    expect(axis.offsetOf(0)).toBe(0);
    expect(axis.offsetOf(10)).toBe(240);
    expect(axis.totalSize).toBe(2400);
  });

  it("offsetOf accepts count itself as the trailing edge", () => {
    expect(axis.offsetOf(100)).toBe(2400);
    expect(axis.offsetOf(101)).toBe(2400);
  });

  it("negative offsets clamp to the start", () => {
    expect(axis.offsetOf(-5)).toBe(0);
  });
});

describe("AxisMetrics.indexAt", () => {
  const axis = new AxisMetrics(100, 24);

  const cases: [position: number, index: number][] = [
    [0, 0],
    [23, 0],
    [24, 1],
    [25, 1],
    [47, 1],
    [48, 2],
    [2399, 99],
  ];

  it.each(cases)("position %i lands on index %i", (position, index) => {
    expect(axis.indexAt(position)).toBe(index);
  });

  it("clamps outside the axis", () => {
    expect(axis.indexAt(-100)).toBe(0);
    expect(axis.indexAt(999_999)).toBe(99);
  });
});

describe("AxisMetrics with overrides", () => {
  function build(): AxisMetrics {
    const axis = new AxisMetrics(20, 100, 24);
    axis.resize(2, 300);
    axis.resize(5, 50);
    return axis;
  }

  it("keeps the overridden sizes and leaves the rest alone", () => {
    const axis = build();
    expect(axis.sizeOf(2)).toBe(300);
    expect(axis.sizeOf(5)).toBe(50);
    expect(axis.sizeOf(3)).toBe(100);
    expect(axis.resizedCount).toBe(2);
  });

  it("displaces every offset after an override", () => {
    const axis = build();
    expect(axis.offsetOf(0)).toBe(0);
    expect(axis.offsetOf(2)).toBe(200);
    // Index 3 starts after the widened index 2.
    expect(axis.offsetOf(3)).toBe(500);
    expect(axis.offsetOf(5)).toBe(700);
    // Index 6 starts after the narrowed index 5.
    expect(axis.offsetOf(6)).toBe(750);
  });

  it("totals the axis including both displacements", () => {
    const axis = build();
    expect(axis.totalSize).toBe(20 * 100 + 200 - 50);
  });

  it("offsets stay monotonic across every index", () => {
    const axis = build();
    for (let i = 1; i <= axis.count; i += 1) {
      expect(axis.offsetOf(i)).toBeGreaterThan(axis.offsetOf(i - 1));
    }
  });

  it("hit tests agree with the spans they came from", () => {
    const axis = build();
    for (let i = 0; i < axis.count; i += 1) {
      const span = axis.spanOf(i);
      expect(axis.indexAt(span.start)).toBe(i);
      expect(axis.indexAt(span.end - 1)).toBe(i);
      expect(span.end - span.start).toBe(axis.sizeOf(i));
    }
  });

  it("resizing back to the default drops the override entirely", () => {
    const axis = build();
    axis.resize(2, 100);
    expect(axis.resizedCount).toBe(1);
    expect(axis.offsetOf(3)).toBe(300);
  });

  it("reset returns one index to the default", () => {
    const axis = build();
    axis.reset(5);
    expect(axis.sizeOf(5)).toBe(100);
    expect(axis.resizedCount).toBe(1);
  });

  it("resetAll clears the axis", () => {
    const axis = build();
    axis.resetAll();
    expect(axis.resizedCount).toBe(0);
    expect(axis.totalSize).toBe(2000);
  });

  it("clamps a resize below the minimum instead of throwing", () => {
    const axis = build();
    axis.resize(7, 1);
    expect(axis.sizeOf(7)).toBe(24);
  });

  it("rejects an index outside the axis", () => {
    const axis = build();
    expect(() => axis.resize(20, 100)).toThrow(RangeError);
    expect(() => axis.resize(-1, 100)).toThrow(RangeError);
    expect(() => axis.resize(1.5, 100)).toThrow(RangeError);
  });

  it("repeated resizes of one index do not accumulate", () => {
    const axis = build();
    axis.resize(2, 400);
    axis.resize(2, 250);
    expect(axis.sizeOf(2)).toBe(250);
    expect(axis.totalSize).toBe(20 * 100 + 150 - 50);
  });
});

describe("AxisMetrics.rangeAt", () => {
  const axis = new AxisMetrics(100, 20);

  it("covers every index the interval touches", () => {
    expect(axis.rangeAt(0, 100)).toEqual({ start: 0, end: 5 });
    expect(axis.rangeAt(10, 30)).toEqual({ start: 0, end: 2 });
  });

  it("an interval ending exactly on a boundary excludes the next index", () => {
    expect(axis.rangeAt(0, 40)).toEqual({ start: 0, end: 2 });
  });

  it("an empty interval still yields the index under it", () => {
    expect(axis.rangeAt(45, 45)).toEqual({ start: 2, end: 3 });
  });
});

describe("AxisMetrics persistence", () => {
  it("round-trips explicit sizes", () => {
    const axis = new AxisMetrics(50, 80);
    axis.resize(1, 200);
    axis.resize(9, 40);
    const saved = axis.toJSON();

    const restored = new AxisMetrics(50, 80);
    restored.load(saved);

    expect(restored.toJSON()).toEqual(saved);
    expect(restored.totalSize).toBe(axis.totalSize);
    expect(restored.offsetOf(10)).toBe(axis.offsetOf(10));
  });

  it("discards sizes that fall outside the axis", () => {
    const axis = new AxisMetrics(10, 80);
    axis.load({ 2: 120, 99: 400, [-1]: 30 });
    expect(axis.resizedCount).toBe(1);
    expect(axis.sizeOf(2)).toBe(120);
  });
});

describe("AxisMetrics at spreadsheet scale", () => {
  it("answers offsets on a million-row axis without materialising it", () => {
    const rows = new AxisMetrics(1_048_576, 22);
    rows.resize(500_000, 60);

    expect(rows.offsetOf(499_999)).toBe(499_999 * 22);
    expect(rows.offsetOf(500_001)).toBe(500_001 * 22 + 38);
    expect(rows.totalSize).toBe(1_048_576 * 22 + 38);
    expect(rows.indexAt(rows.offsetOf(900_000))).toBe(900_000);
  });
});
