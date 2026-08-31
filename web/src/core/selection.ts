import type { Coord } from "../../../src/engine/reference.js";

/**
 * Cursor and selection behaviour, with no DOM anywhere in it.
 *
 * Everything a key press means to a spreadsheet lives here: where the cursor
 * lands, what the selection covers, and how `Ctrl`+arrow finds the edge of a
 * block. Keeping it separate from the renderer is what makes the semantics
 * testable — the jump rules below are the part people notice immediately when
 * they are wrong, and they are impossible to pin down through a browser.
 */

export type Direction = "up" | "down" | "left" | "right";

/** Whether a cell holds anything. The model never reads the sheet directly. */
export type Occupancy = (coord: Coord) => boolean;

export interface Bounds {
  readonly rows: number;
  readonly cols: number;
}

/** A normalised rectangle of cells, both corners inclusive. */
export interface CellRect {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

const STEPS: Record<Direction, Coord> = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
};

export function rectContains(rect: CellRect, coord: Coord): boolean {
  return (
    coord.row >= rect.top &&
    coord.row <= rect.bottom &&
    coord.col >= rect.left &&
    coord.col <= rect.right
  );
}

export function rectSize(rect: CellRect): number {
  return (rect.bottom - rect.top + 1) * (rect.right - rect.left + 1);
}

export function sameCoord(a: Coord, b: Coord): boolean {
  return a.row === b.row && a.col === b.col;
}

/**
 * The three points a spreadsheet selection actually needs.
 *
 * `anchor` and `focus` are the corners of the selected rectangle: the anchor is
 * where extension started and the focus is the end the arrow keys drag. `active`
 * is the cell that receives typing, and it is *not* the focus — pressing
 * `Shift`+`Down` in A1 selects A1:A2 while leaving the cursor in A1, which is
 * why `Tab` can then walk the block without collapsing it. Collapsing the three
 * into two is the mistake that makes a grid feel subtly wrong to anyone who
 * uses one daily.
 *
 * Every mutator returns `true` when something actually changed, so a caller can
 * skip a repaint on a key press that ran into the edge of the sheet.
 */
export class Selection {
  private anchorCell: Coord;
  private focusCell: Coord;
  private activeCell: Coord;

  constructor(
    private bounds: Bounds,
    start: Coord = { row: 0, col: 0 },
  ) {
    const clamped = this.clamp(start);
    this.anchorCell = clamped;
    this.focusCell = clamped;
    this.activeCell = clamped;
  }

  /** The cell that receives typing. Always inside {@link rect}. */
  get active(): Coord {
    return this.activeCell;
  }

  /** The fixed corner of the selection. */
  get anchor(): Coord {
    return this.anchorCell;
  }

  /** The corner the arrow keys drag. */
  get focus(): Coord {
    return this.focusCell;
  }

  /** The selected rectangle, normalised so `top <= bottom`. */
  get rect(): CellRect {
    return {
      top: Math.min(this.anchorCell.row, this.focusCell.row),
      bottom: Math.max(this.anchorCell.row, this.focusCell.row),
      left: Math.min(this.anchorCell.col, this.focusCell.col),
      right: Math.max(this.anchorCell.col, this.focusCell.col),
    };
  }

  /** True when the selection is a single cell. */
  get isSingle(): boolean {
    return sameCoord(this.anchorCell, this.focusCell);
  }

  /** Resize the addressable area, pulling the selection back inside it. */
  setBounds(bounds: Bounds): void {
    this.bounds = bounds;
    this.anchorCell = this.clamp(this.anchorCell);
    this.focusCell = this.clamp(this.focusCell);
    this.activeCell = this.clamp(this.activeCell);
  }

  /** Put the cursor on a cell and collapse the selection onto it. */
  moveTo(coord: Coord): boolean {
    const target = this.clamp(coord);
    if (sameCoord(target, this.activeCell) && this.isSingle) return false;
    this.anchorCell = target;
    this.focusCell = target;
    this.activeCell = target;
    return true;
  }

  /** Drag the focus corner, leaving the anchor and the typing cursor put. */
  extendTo(coord: Coord): boolean {
    const target = this.clamp(coord);
    if (sameCoord(target, this.focusCell)) return false;
    this.focusCell = target;
    this.activeCell = this.anchorCell;
    return true;
  }

  /** Select a rectangle outright, leaving the cursor on the anchor corner. */
  selectRect(from: Coord, to: Coord): boolean {
    const anchor = this.clamp(from);
    const focus = this.clamp(to);
    if (
      sameCoord(anchor, this.anchorCell) &&
      sameCoord(focus, this.focusCell) &&
      sameCoord(anchor, this.activeCell)
    ) {
      return false;
    }
    this.anchorCell = anchor;
    this.focusCell = focus;
    this.activeCell = anchor;
    return true;
  }

  /** One step in a direction, measured from the typing cursor. */
  move(direction: Direction): boolean {
    return this.moveTo(step(this.activeCell, direction));
  }

  /** One step of the focus corner, extending the selection. */
  extend(direction: Direction): boolean {
    return this.extendTo(step(this.focusCell, direction));
  }

  /** `Ctrl`+arrow: jump to the edge of the current block of content. */
  jump(direction: Direction, occupied: Occupancy): boolean {
    return this.moveTo(this.findEdge(this.activeCell, direction, occupied));
  }

  /** `Ctrl`+`Shift`+arrow: the same jump, dragging the focus corner. */
  jumpExtend(direction: Direction, occupied: Occupancy): boolean {
    return this.extendTo(this.findEdge(this.focusCell, direction, occupied));
  }

  /** A viewport's worth of rows, in either direction. */
  page(direction: "up" | "down", rows: number, extending = false): boolean {
    const delta = direction === "down" ? rows : -rows;
    const from = extending ? this.focusCell : this.activeCell;
    const target = { row: from.row + delta, col: from.col };
    return extending ? this.extendTo(target) : this.moveTo(target);
  }

  /** `Home`: the first column of the current row. */
  home(extending = false): boolean {
    const from = extending ? this.focusCell : this.activeCell;
    const target = { row: from.row, col: 0 };
    return extending ? this.extendTo(target) : this.moveTo(target);
  }

  /** `Ctrl`+`Home`: the top-left of the sheet. */
  documentStart(extending = false): boolean {
    const target = { row: 0, col: 0 };
    return extending ? this.extendTo(target) : this.moveTo(target);
  }

  /** `Ctrl`+`End`: the far corner of the used area, or the origin if empty. */
  documentEnd(used: CellRect | null, extending = false): boolean {
    const target = used === null
      ? { row: 0, col: 0 }
      : { row: used.bottom, col: used.right };
    return extending ? this.extendTo(target) : this.moveTo(target);
  }

  /**
   * `Tab` and `Enter` inside a multi-cell selection.
   *
   * With more than one cell selected the typing cursor walks the selection
   * instead of leaving it, wrapping at each edge — the behaviour that makes
   * filling in a marked-out block work. The rectangle itself never moves. With
   * a single cell selected there is nothing to walk, so the cursor simply steps
   * and takes the selection with it.
   */
  advance(axis: "row" | "col", backwards = false): boolean {
    if (this.isSingle) {
      const direction: Direction =
        axis === "row"
          ? backwards
            ? "up"
            : "down"
          : backwards
            ? "left"
            : "right";
      return this.move(direction);
    }

    const rect = this.rect;
    const width = rect.right - rect.left + 1;
    const height = rect.bottom - rect.top + 1;
    const cells = width * height;

    // Position within the selection, counted along the walking axis first.
    const row = this.activeCell.row - rect.top;
    const col = this.activeCell.col - rect.left;
    const index = axis === "col" ? row * width + col : col * height + row;
    const next = (index + (backwards ? -1 : 1) + cells) % cells;

    const target =
      axis === "col"
        ? {
            row: rect.top + Math.floor(next / width),
            col: rect.left + (next % width),
          }
        : {
            row: rect.top + (next % height),
            col: rect.left + Math.floor(next / height),
          };

    if (sameCoord(target, this.activeCell)) return false;
    this.activeCell = target;
    return true;
  }

  /** Every cell in the selection, row-major. */
  *cells(): Generator<Coord> {
    const rect = this.rect;
    for (let row = rect.top; row <= rect.bottom; row += 1) {
      for (let col = rect.left; col <= rect.right; col += 1) {
        yield { row, col };
      }
    }
  }

  /**
   * Where a jump in this direction lands.
   *
   * Three cases, in the order a spreadsheet resolves them:
   *
   * 1. Standing on content with more content next to it — run to the far end
   *    of that block and stop on its last filled cell.
   * 2. Standing anywhere else — skip forward over the blanks to the first
   *    filled cell found.
   * 3. Nothing filled ahead at all — go to the edge of the sheet.
   */
  private findEdge(from: Coord, direction: Direction, occupied: Occupancy): Coord {
    const delta = STEPS[direction];
    const next = { row: from.row + delta.row, col: from.col + delta.col };
    if (this.outside(next)) return from;

    if (occupied(from) && occupied(next)) {
      let current = next;
      for (;;) {
        const ahead = { row: current.row + delta.row, col: current.col + delta.col };
        if (this.outside(ahead) || !occupied(ahead)) return current;
        current = ahead;
      }
    }

    let current = next;
    let lastInside = next;
    while (!this.outside(current)) {
      if (occupied(current)) return current;
      lastInside = current;
      current = { row: current.row + delta.row, col: current.col + delta.col };
    }
    return lastInside;
  }

  private outside(coord: Coord): boolean {
    return (
      coord.row < 0 ||
      coord.col < 0 ||
      coord.row >= this.bounds.rows ||
      coord.col >= this.bounds.cols
    );
  }

  private clamp(coord: Coord): Coord {
    return {
      row: Math.min(Math.max(0, Math.trunc(coord.row)), this.bounds.rows - 1),
      col: Math.min(Math.max(0, Math.trunc(coord.col)), this.bounds.cols - 1),
    };
  }
}

function step(coord: Coord, direction: Direction): Coord {
  const delta = STEPS[direction];
  return { row: coord.row + delta.row, col: coord.col + delta.col };
}
