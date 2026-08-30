import { describe, expect, it } from "vitest";
import { SparseGrid } from "../src/engine/grid.js";
import { formatRange, parseA1 } from "../src/engine/reference.js";

const at = (a1: string) => parseA1(a1);
const range = (a: string, b: string) => ({ start: at(a), end: at(b) });

describe("SparseGrid", () => {
  it("stores and reads back by coordinate", () => {
    const grid = new SparseGrid<number>();
    grid.set(at("B3"), 7);
    expect(grid.get(at("B3"))).toBe(7);
    expect(grid.has(at("B3"))).toBe(true);
    expect(grid.get(at("B4"))).toBeUndefined();
    expect(grid.size).toBe(1);
  });

  it("ignores anchors when addressing", () => {
    const grid = new SparseGrid<string>();
    grid.set(at("$B$3"), "x");
    expect(grid.get(at("B3"))).toBe("x");
    grid.set(at("B$3"), "y");
    expect(grid.size).toBe(1);
    expect(grid.get(at("$B3"))).toBe("y");
  });

  it("allocates nothing for untouched cells", () => {
    const grid = new SparseGrid<number>();
    grid.set(at("XFD1048576"), 1);
    expect(grid.size).toBe(1);
  });

  it("removes entries on delete", () => {
    const grid = new SparseGrid<number>();
    grid.set(at("A1"), 1);
    expect(grid.delete(at("A1"))).toBe(true);
    expect(grid.delete(at("A1"))).toBe(false);
    expect(grid.size).toBe(0);
    expect(grid.has(at("A1"))).toBe(false);
  });

  it("reports the occupied extent", () => {
    const grid = new SparseGrid<number>();
    expect(grid.extent()).toBeNull();
    grid.set(at("B2"), 1);
    grid.set(at("D7"), 2);
    expect(formatRange(grid.extent()!)).toBe("A1:D7");
  });

  it("shrinks the extent after the far corner is deleted", () => {
    const grid = new SparseGrid<number>();
    grid.set(at("B2"), 1);
    grid.set(at("D7"), 2);
    grid.delete(at("D7"));
    expect(formatRange(grid.extent()!)).toBe("A1:B2");
  });

  it("keeps the extent when an interior cell is deleted", () => {
    const grid = new SparseGrid<number>();
    grid.set(at("B2"), 1);
    grid.set(at("D7"), 2);
    grid.delete(at("B2"));
    expect(formatRange(grid.extent()!)).toBe("A1:D7");
  });

  it("resets fully on clear", () => {
    const grid = new SparseGrid<number>();
    grid.set(at("C3"), 1);
    grid.clear();
    expect(grid.size).toBe(0);
    expect(grid.extent()).toBeNull();
  });

  it("iterates a range row-major and skips blanks", () => {
    const grid = new SparseGrid<string>();
    grid.set(at("A1"), "a1");
    grid.set(at("B2"), "b2");
    grid.set(at("C9"), "outside");
    const seen = [...grid.entriesInRange(range("A1", "B2"))].map(([, v]) => v);
    expect(seen).toEqual(["a1", "b2"]);
  });

  it("round-trips coordinates through the key encoding", () => {
    const grid = new SparseGrid<number>();
    const coords = ["A1", "Z26", "AA100", "XFD1048576"].map(at);
    coords.forEach((c, i) => grid.set(c, i));
    const readBack = [...grid.entries()].map(([coord, value]) => [
      coord.col,
      coord.row,
      value,
    ]);
    expect(readBack).toEqual(coords.map((c, i) => [c.col, c.row, i]));
  });

  it("lists coordinates without payloads", () => {
    const grid = new SparseGrid<number>();
    grid.set(at("A1"), 1);
    grid.set(at("B1"), 2);
    expect([...grid.coords()].map((c) => c.col)).toEqual([0, 1]);
  });
});
