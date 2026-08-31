import { describe, expect, it } from "vitest";

import { Selection, rectContains, rectSize } from "../web/src/core/selection.js";
import type { Occupancy } from "../web/src/core/selection.js";
import type { Coord } from "../src/engine/reference.js";

const BOUNDS = { rows: 20, cols: 10 };

/** Occupancy from a list of A1-ish coordinates, for readable fixtures. */
function filled(...cells: [row: number, col: number][]): Occupancy {
  const keys = new Set(cells.map(([row, col]) => `${row}:${col}`));
  return (coord: Coord) => keys.has(`${coord.row}:${coord.col}`);
}

const NOTHING: Occupancy = () => false;

describe("Selection movement", () => {
  it("starts as a single cell at the origin", () => {
    const selection = new Selection(BOUNDS);
    expect(selection.active).toEqual({ row: 0, col: 0 });
    expect(selection.isSingle).toBe(true);
    expect(rectSize(selection.rect)).toBe(1);
  });

  it("moves the cursor and drags the anchor with it", () => {
    const selection = new Selection(BOUNDS, { row: 3, col: 3 });
    expect(selection.move("down")).toBe(true);
    expect(selection.active).toEqual({ row: 4, col: 3 });
    expect(selection.anchor).toEqual({ row: 4, col: 3 });
    expect(selection.isSingle).toBe(true);
  });

  it("reports no change when a move runs into the edge", () => {
    const selection = new Selection(BOUNDS);
    expect(selection.move("up")).toBe(false);
    expect(selection.move("left")).toBe(false);
    expect(selection.active).toEqual({ row: 0, col: 0 });
  });

  it("clamps a move at the far edge", () => {
    const selection = new Selection(BOUNDS, { row: 19, col: 9 });
    expect(selection.move("down")).toBe(false);
    expect(selection.active).toEqual({ row: 19, col: 9 });
  });
});

describe("Selection extension", () => {
  it("drags the focus corner and leaves the anchor behind", () => {
    const selection = new Selection(BOUNDS, { row: 2, col: 2 });
    selection.extend("down");
    selection.extend("right");

    expect(selection.anchor).toEqual({ row: 2, col: 2 });
    expect(selection.focus).toEqual({ row: 3, col: 3 });
    expect(selection.rect).toEqual({ top: 2, bottom: 3, left: 2, right: 3 });
    expect(selection.isSingle).toBe(false);
  });

  it("keeps the typing cursor on the anchor while extending", () => {
    const selection = new Selection(BOUNDS, { row: 2, col: 2 });
    selection.extend("down");
    selection.extend("down");
    // Shift+Down in a spreadsheet grows the selection downwards but still
    // types into the cell it started from.
    expect(selection.active).toEqual({ row: 2, col: 2 });
    expect(selection.focus).toEqual({ row: 4, col: 2 });
  });

  it("normalises a rectangle extended up and to the left", () => {
    const selection = new Selection(BOUNDS, { row: 5, col: 5 });
    selection.extend("up");
    selection.extend("up");
    selection.extend("left");

    expect(selection.rect).toEqual({ top: 3, bottom: 5, left: 4, right: 5 });
    expect(rectSize(selection.rect)).toBe(6);
  });

  it("collapses back to one cell on a plain move", () => {
    const selection = new Selection(BOUNDS, { row: 5, col: 5 });
    selection.extend("down");
    selection.move("right");
    expect(selection.isSingle).toBe(true);
  });

  it("enumerates its cells row-major", () => {
    const selection = new Selection(BOUNDS, { row: 1, col: 1 });
    selection.selectRect({ row: 1, col: 1 }, { row: 2, col: 2 });
    expect([...selection.cells()]).toEqual([
      { row: 1, col: 1 },
      { row: 1, col: 2 },
      { row: 2, col: 1 },
      { row: 2, col: 2 },
    ]);
  });
});

describe("Selection jump to content edge", () => {
  // Column 0 holds a block in rows 2..5, then an isolated cell at row 10.
  const column = filled([2, 0], [3, 0], [4, 0], [5, 0], [10, 0]);

  it("from above the block, lands on its first cell", () => {
    const selection = new Selection(BOUNDS, { row: 0, col: 0 });
    selection.jump("down", column);
    expect(selection.active).toEqual({ row: 2, col: 0 });
  });

  it("from the head of the block, runs to its last cell", () => {
    const selection = new Selection(BOUNDS, { row: 2, col: 0 });
    selection.jump("down", column);
    expect(selection.active).toEqual({ row: 5, col: 0 });
  });

  it("from the tail of the block, skips the gap to the next cell", () => {
    const selection = new Selection(BOUNDS, { row: 5, col: 0 });
    selection.jump("down", column);
    expect(selection.active).toEqual({ row: 10, col: 0 });
  });

  it("with nothing ahead, runs to the edge of the sheet", () => {
    const selection = new Selection(BOUNDS, { row: 10, col: 0 });
    selection.jump("down", column);
    expect(selection.active).toEqual({ row: 19, col: 0 });
  });

  it("on an empty sheet, goes straight to the edge", () => {
    const selection = new Selection(BOUNDS, { row: 4, col: 4 });
    selection.jump("right", NOTHING);
    expect(selection.active).toEqual({ row: 4, col: 9 });
    selection.jump("up", NOTHING);
    expect(selection.active).toEqual({ row: 0, col: 9 });
  });

  it("does not move when already against the edge", () => {
    const selection = new Selection(BOUNDS, { row: 0, col: 0 });
    expect(selection.jump("up", column)).toBe(false);
  });

  it("a single occupied cell alone counts as a whole block", () => {
    const selection = new Selection(BOUNDS, { row: 10, col: 0 });
    selection.jump("up", column);
    expect(selection.active).toEqual({ row: 5, col: 0 });
  });

  it("extends instead of collapsing when asked to", () => {
    const selection = new Selection(BOUNDS, { row: 2, col: 0 });
    selection.jumpExtend("down", column);
    expect(selection.anchor).toEqual({ row: 2, col: 0 });
    expect(selection.rect).toEqual({ top: 2, bottom: 5, left: 0, right: 0 });
  });
});

describe("Selection paging and document keys", () => {
  it("pages down by the given number of rows", () => {
    const selection = new Selection(BOUNDS, { row: 1, col: 4 });
    selection.page("down", 9);
    expect(selection.active).toEqual({ row: 10, col: 4 });
  });

  it("clamps a page against the end of the sheet", () => {
    const selection = new Selection(BOUNDS, { row: 15, col: 0 });
    selection.page("down", 100);
    expect(selection.active).toEqual({ row: 19, col: 0 });
  });

  it("Home stays on the row", () => {
    const selection = new Selection(BOUNDS, { row: 7, col: 6 });
    selection.home();
    expect(selection.active).toEqual({ row: 7, col: 0 });
  });

  it("Ctrl+Home returns to the origin", () => {
    const selection = new Selection(BOUNDS, { row: 7, col: 6 });
    selection.documentStart();
    expect(selection.active).toEqual({ row: 0, col: 0 });
  });

  it("Ctrl+End lands on the far corner of the used area", () => {
    const selection = new Selection(BOUNDS, { row: 0, col: 0 });
    selection.documentEnd({ top: 1, left: 1, bottom: 8, right: 4 });
    expect(selection.active).toEqual({ row: 8, col: 4 });
  });

  it("Ctrl+End on an empty sheet stays at the origin", () => {
    const selection = new Selection(BOUNDS, { row: 5, col: 5 });
    selection.documentEnd(null);
    expect(selection.active).toEqual({ row: 0, col: 0 });
  });
});

describe("Selection advance", () => {
  it("steps out of a single cell", () => {
    const selection = new Selection(BOUNDS, { row: 2, col: 2 });
    selection.advance("col");
    expect(selection.active).toEqual({ row: 2, col: 3 });
    expect(selection.isSingle).toBe(true);
  });

  it("walks a block across then down, wrapping at the right edge", () => {
    const selection = new Selection(BOUNDS);
    selection.selectRect({ row: 1, col: 1 }, { row: 2, col: 2 });

    const visited = [selection.active];
    for (let i = 0; i < 4; i += 1) {
      selection.advance("col");
      visited.push(selection.active);
    }

    expect(visited).toEqual([
      { row: 1, col: 1 },
      { row: 1, col: 2 },
      { row: 2, col: 1 },
      { row: 2, col: 2 },
      { row: 1, col: 1 },
    ]);
  });

  it("walks a block down then across when advancing by row", () => {
    const selection = new Selection(BOUNDS);
    selection.selectRect({ row: 1, col: 1 }, { row: 2, col: 2 });

    const visited = [selection.active];
    for (let i = 0; i < 4; i += 1) {
      selection.advance("row");
      visited.push(selection.active);
    }

    expect(visited).toEqual([
      { row: 1, col: 1 },
      { row: 2, col: 1 },
      { row: 1, col: 2 },
      { row: 2, col: 2 },
      { row: 1, col: 1 },
    ]);
  });

  it("walks backwards and wraps the other way", () => {
    const selection = new Selection(BOUNDS);
    selection.selectRect({ row: 1, col: 1 }, { row: 2, col: 2 });
    selection.advance("col", true);
    expect(selection.active).toEqual({ row: 2, col: 2 });
  });

  it("never leaves the selection while walking it", () => {
    const selection = new Selection(BOUNDS);
    selection.selectRect({ row: 3, col: 0 }, { row: 5, col: 4 });
    const rect = selection.rect;
    for (let i = 0; i < 40; i += 1) {
      selection.advance("col");
      expect(rectContains(rect, selection.active)).toBe(true);
    }
    expect(selection.rect).toEqual(rect);
  });
});

describe("Selection bounds changes", () => {
  it("pulls the cursor back inside a shrunken sheet", () => {
    const selection = new Selection(BOUNDS, { row: 18, col: 8 });
    selection.setBounds({ rows: 5, cols: 5 });
    expect(selection.active).toEqual({ row: 4, col: 4 });
    expect(selection.anchor).toEqual({ row: 4, col: 4 });
  });

  it("clamps a constructed position that is out of range", () => {
    const selection = new Selection({ rows: 3, cols: 3 }, { row: 99, col: -4 });
    expect(selection.active).toEqual({ row: 2, col: 0 });
  });
});
