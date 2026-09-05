import { columnToLabel } from "../../../src/engine/reference.js";
import type { Coord } from "../../../src/engine/reference.js";
import { AxisMetrics } from "../core/metrics.js";
import type { Highlight } from "../core/highlight.js";
import { slotForCell } from "../core/highlight.js";
import type { CellRect } from "../core/selection.js";
import {
  computeWindow,
  sameWindow,
  scrollToCell,
  visibleWindow,
} from "../core/viewport.js";
import type { CellWindow, Viewport } from "../core/viewport.js";

/** What the grid needs to know about one cell in order to draw it. */
export interface CellPaint {
  readonly text: string;
  readonly kind: "number" | "text" | "boolean" | "error" | "blank";
  readonly isFormula: boolean;
  /**
   * Whether the value was spilled here by a formula in another cell.
   *
   * Typing into a spilled cell displaces the whole block, so it is worth
   * being able to see, at a glance, which values are derived and which were
   * put there by hand.
   */
  readonly isSpilled: boolean;
  /**
   * A colour the cell's number format asked for, as a CSS custom-property
   * name, or `null` to leave the cell in the sheet's own ink.
   */
  readonly colour: string | null;
}

export interface GridElements {
  readonly body: HTMLElement;
  readonly canvas: HTMLElement;
  readonly cellLayer: HTMLElement;
  readonly markLayer: HTMLElement;
  readonly colHeadTrack: HTMLElement;
  readonly rowHeadTrack: HTMLElement;
}

/** Where a right click landed, which decides what the menu offers. */
export type MenuTarget =
  | { readonly kind: "cell"; readonly coord: Coord }
  | { readonly kind: "row"; readonly index: number }
  | { readonly kind: "column"; readonly index: number };

export interface GridHandlers {
  readonly paint: (row: number, col: number) => CellPaint;
  readonly onPick: (coord: Coord, extending: boolean) => void;
  readonly onDrag: (coord: Coord) => void;
  readonly onOpenEditor: (coord: Coord) => void;
  readonly onResize: () => void;
  /** A whole row or column picked from its header. */
  readonly onPickLine: (
    axis: "row" | "column",
    index: number,
    extending: boolean,
  ) => void;
  readonly onMenu: (target: MenuTarget, x: number, y: number) => void;
}

/**
 * The DOM half of the grid: it owns nodes and nothing else.
 *
 * Every question about *what* to draw is answered by the pure modules — the
 * window comes from `viewport`, the geometry from `metrics`, the outlines from
 * `highlight`. This file only turns those answers into elements, and its one
 * real trick is that it reuses them. Scrolling a sheet of a million cells
 * touches the same few hundred nodes over and over, and a scroll that stays
 * inside the current window touches none of them at all.
 */
export class GridView {
  private readonly cellPool: HTMLDivElement[] = [];
  private readonly colHeadPool: HTMLDivElement[] = [];
  private readonly rowHeadPool: HTMLDivElement[] = [];
  private readonly markPool: HTMLDivElement[] = [];

  private window: CellWindow = { rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 0 };
  private selection: CellRect = { top: 0, left: 0, bottom: 0, right: 0 };
  private active: Coord = { row: 0, col: 0 };
  private highlight: Highlight | null = null;
  private marquee: CellRect | null = null;
  private spill: CellRect | null = null;

  private dragging = false;
  private resizing: { col: number; startX: number; startWidth: number } | null =
    null;
  private frame = 0;

  constructor(
    private readonly el: GridElements,
    readonly rows: AxisMetrics,
    readonly cols: AxisMetrics,
    private readonly handlers: GridHandlers,
  ) {
    this.el.canvas.style.width = `${cols.totalSize}px`;
    this.el.canvas.style.height = `${rows.totalSize}px`;

    this.el.body.addEventListener("scroll", this.onScroll, { passive: true });
    this.el.cellLayer.addEventListener("mousedown", this.onCellMouseDown);
    this.el.cellLayer.addEventListener("dblclick", this.onCellDoubleClick);
    this.el.colHeadTrack.addEventListener("mousedown", this.onHeadMouseDown);
    this.el.rowHeadTrack.addEventListener("mousedown", this.onRowHeadMouseDown);
    this.el.cellLayer.addEventListener("contextmenu", this.onCellMenu);
    this.el.colHeadTrack.addEventListener("contextmenu", this.onColHeadMenu);
    this.el.rowHeadTrack.addEventListener("contextmenu", this.onRowHeadMenu);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("resize", this.onWindowResize);
  }

  get viewport(): Viewport {
    return {
      scrollTop: this.el.body.scrollTop,
      scrollLeft: this.el.body.scrollLeft,
      height: this.el.body.clientHeight,
      width: this.el.body.clientWidth,
    };
  }

  /** The cells the user can actually see, with no overscan. */
  get visible(): CellWindow {
    return visibleWindow(this.viewport, this.rows, this.cols);
  }

  setSelection(rect: CellRect, active: Coord): void {
    this.selection = rect;
    this.active = active;
    this.paintMarks();
    this.paintHeadState();
  }

  /**
   * Outline the block currently on the clipboard, or clear the outline.
   *
   * A copy leaves no other trace on screen, so without this the user has to
   * remember what they took — and a paste that lands the wrong thing is only
   * noticed after it has overwritten something.
   */
  setMarquee(rect: CellRect | null): void {
    this.marquee = rect;
    this.paintMarks();
  }

  /**
   * Outline the block the selection sits inside, or clear the outline.
   *
   * The cells of a block look like any others until you try to type in one,
   * and then the whole thing moves. Drawing its boundary while the selection
   * is inside it is what makes that predictable rather than surprising.
   */
  setSpill(rect: CellRect | null): void {
    this.spill = rect;
    this.paintMarks();
  }

  setHighlight(highlight: Highlight | null): void {
    this.highlight = highlight;
    this.paintMarks();
    this.paintCells(true);
  }

  /** Redraw the cells, whether or not the window moved. */
  refresh(): void {
    this.paintCells(true);
    this.paintMarks();
  }

  /** Draw everything from scratch, after a scroll or a resize. */
  render(): void {
    this.el.canvas.style.width = `${this.cols.totalSize}px`;
    this.el.canvas.style.height = `${this.rows.totalSize}px`;

    const next = computeWindow(this.viewport, this.rows, this.cols);
    const moved = !sameWindow(next, this.window);
    this.window = next;

    this.el.colHeadTrack.style.transform = `translateX(${-this.viewport.scrollLeft}px)`;
    this.el.rowHeadTrack.style.transform = `translateY(${-this.viewport.scrollTop}px)`;

    this.paintCells(moved);
    this.paintHeads();
    this.paintMarks();
  }

  /** Scroll the smallest distance that brings a cell fully into view. */
  reveal(coord: Coord): void {
    const target = scrollToCell(
      this.viewport,
      this.rows,
      this.cols,
      coord.row,
      coord.col,
    );
    if (target.scrollTop !== this.viewport.scrollTop) {
      this.el.body.scrollTop = target.scrollTop;
    }
    if (target.scrollLeft !== this.viewport.scrollLeft) {
      this.el.body.scrollLeft = target.scrollLeft;
    }
  }

  /** Screen rectangle of a cell, for positioning the in-cell editor. */
  rectOf(coord: Coord): {
    left: number;
    top: number;
    width: number;
    height: number;
  } {
    return {
      left: this.cols.offsetOf(coord.col),
      top: this.rows.offsetOf(coord.row),
      width: this.cols.sizeOf(coord.col),
      height: this.rows.sizeOf(coord.row),
    };
  }

  /** The cell under a pointer event, in sheet coordinates. */
  coordAt(clientX: number, clientY: number): Coord {
    const box = this.el.body.getBoundingClientRect();
    return {
      row: this.rows.indexAt(clientY - box.top + this.el.body.scrollTop),
      col: this.cols.indexAt(clientX - box.left + this.el.body.scrollLeft),
    };
  }

  private paintCells(force: boolean): void {
    const { rowStart, rowEnd, colStart, colEnd } = this.window;
    let index = 0;

    for (let row = rowStart; row < rowEnd; row += 1) {
      const top = this.rows.offsetOf(row);
      const height = this.rows.sizeOf(row);

      for (let col = colStart; col < colEnd; col += 1) {
        const node = this.cellAt(index);
        index += 1;

        const left = this.cols.offsetOf(col);
        const width = this.cols.sizeOf(col);
        const paint = this.handlers.paint(row, col);
        const slot =
          this.highlight === null ? null : slotForCell(this.highlight, row, col);

        const signature = `${row}:${col}|${paint.text}|${paint.kind}|${paint.isFormula ? 1 : 0}|${paint.isSpilled ? 1 : 0}|${slot ?? ""}|${paint.colour ?? ""}`;
        if (!force && node.dataset["sig"] === signature) continue;
        node.dataset["sig"] = signature;
        node.dataset["row"] = String(row);
        node.dataset["col"] = String(col);

        node.style.transform = `translate(${left}px, ${top}px)`;
        node.style.width = `${width}px`;
        node.style.height = `${height}px`;
        node.textContent = paint.text;
        node.className = `cell cell--${paint.kind}${
          paint.isFormula ? " cell--formula" : ""
        }${paint.isSpilled ? " cell--spilled" : ""}`;
        // Cells are recycled, so a colour has to be cleared as explicitly as
        // it is set — otherwise a scrolled-away red negative tints whatever
        // cell inherits its node.
        node.style.color = paint.colour === null ? "" : `var(${paint.colour})`;
        node.hidden = false;
      }
    }

    for (let i = index; i < this.cellPool.length; i += 1) {
      const node = this.cellPool[i] as HTMLDivElement;
      if (!node.hidden) {
        node.hidden = true;
        node.dataset["sig"] = "";
      }
    }
  }

  private paintHeads(): void {
    const { rowStart, rowEnd, colStart, colEnd } = this.window;

    let index = 0;
    for (let col = colStart; col < colEnd; col += 1) {
      const node = this.headAt(this.colHeadPool, this.el.colHeadTrack, "col", index);
      index += 1;
      node.style.transform = `translateX(${this.cols.offsetOf(col)}px)`;
      node.style.width = `${this.cols.sizeOf(col)}px`;
      node.firstChild!.textContent = columnToLabel(col);
      node.dataset["col"] = String(col);
      node.hidden = false;
    }
    this.hideFrom(this.colHeadPool, index);

    index = 0;
    for (let row = rowStart; row < rowEnd; row += 1) {
      const node = this.headAt(this.rowHeadPool, this.el.rowHeadTrack, "row", index);
      index += 1;
      node.style.transform = `translateY(${this.rows.offsetOf(row)}px)`;
      node.style.height = `${this.rows.sizeOf(row)}px`;
      node.firstChild!.textContent = String(row + 1);
      node.dataset["row"] = String(row);
      node.hidden = false;
    }
    this.hideFrom(this.rowHeadPool, index);

    this.paintHeadState();
  }

  private paintHeadState(): void {
    for (const node of this.colHeadPool) {
      const col = Number(node.dataset["col"]);
      node.classList.toggle(
        "is-active",
        !node.hidden && col >= this.selection.left && col <= this.selection.right,
      );
    }
    for (const node of this.rowHeadPool) {
      const row = Number(node.dataset["row"]);
      node.classList.toggle(
        "is-active",
        !node.hidden && row >= this.selection.top && row <= this.selection.bottom,
      );
    }
  }

  private paintMarks(): void {
    let index = 0;

    const place = (
      className: string,
      rect: CellRect,
      inset: number,
    ): void => {
      const node = this.markAt(index);
      index += 1;
      const left = this.cols.offsetOf(rect.left);
      const top = this.rows.offsetOf(rect.top);
      const width = this.cols.offsetOf(rect.right + 1) - left;
      const height = this.rows.offsetOf(rect.bottom + 1) - top;
      node.className = className;
      node.style.transform = `translate(${left - inset}px, ${top - inset}px)`;
      node.style.width = `${width + inset * 2 - 1}px`;
      node.style.height = `${height + inset * 2 - 1}px`;
      node.hidden = false;
    };

    const isSingle =
      this.selection.top === this.selection.bottom &&
      this.selection.left === this.selection.right;

    // Under the selection, so an active cell inside a block still reads as
    // the active cell.
    if (this.spill !== null) place("mark mark--spill", this.spill, 1);

    if (this.marquee !== null) place("mark mark--copy", this.marquee, 1);

    if (!isSingle) place("mark mark--range", this.selection, 0);
    place("mark mark--active", {
      top: this.active.row,
      bottom: this.active.row,
      left: this.active.col,
      right: this.active.col,
    }, 1);

    if (this.highlight !== null) {
      for (const reference of this.highlight.references) {
        place(
          `mark mark--ref mark--ref-${reference.slot}`,
          {
            top: reference.range.start.row,
            bottom: reference.range.end.row,
            left: reference.range.start.col,
            right: reference.range.end.col,
          },
          1,
        );
      }
    }

    this.hideFrom(this.markPool, index);
  }

  private cellAt(index: number): HTMLDivElement {
    const existing = this.cellPool[index];
    if (existing !== undefined) return existing;
    const node = document.createElement("div");
    node.className = "cell";
    this.cellPool.push(node);
    this.el.cellLayer.append(node);
    return node;
  }

  private markAt(index: number): HTMLDivElement {
    const existing = this.markPool[index];
    if (existing !== undefined) return existing;
    const node = document.createElement("div");
    node.className = "mark";
    this.markPool.push(node);
    this.el.markLayer.append(node);
    return node;
  }

  private headAt(
    pool: HTMLDivElement[],
    host: HTMLElement,
    axis: "col" | "row",
    index: number,
  ): HTMLDivElement {
    const existing = pool[index];
    if (existing !== undefined) return existing;

    const node = document.createElement("div");
    node.className = `head head--${axis}`;
    node.append(document.createElement("span"));
    if (axis === "col") {
      const grip = document.createElement("span");
      grip.className = "head__grip";
      node.append(grip);
    }
    pool.push(node);
    host.append(node);
    return node;
  }

  private hideFrom(pool: HTMLDivElement[], from: number): void {
    for (let i = from; i < pool.length; i += 1) {
      const node = pool[i] as HTMLDivElement;
      node.hidden = true;
    }
  }

  private readonly onScroll = (): void => {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  };

  private readonly onWindowResize = (): void => {
    this.render();
    this.handlers.onResize();
  };

  private readonly onCellMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    const coord = this.coordAt(event.clientX, event.clientY);
    this.dragging = true;
    this.handlers.onPick(coord, event.shiftKey);
    event.preventDefault();
    this.el.body.focus();
  };

  private readonly onCellDoubleClick = (event: MouseEvent): void => {
    this.handlers.onOpenEditor(this.coordAt(event.clientX, event.clientY));
  };

  private readonly onHeadMouseDown = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains("head__grip")) {
      if (event.button !== 0) return;
      const picked = lineIndexOf(target, "col");
      if (picked === null) return;
      this.handlers.onPickLine("column", picked, event.shiftKey);
      event.preventDefault();
      this.el.body.focus();
      return;
    }
    const col = Number((target.parentElement as HTMLElement).dataset["col"]);
    if (!Number.isInteger(col)) return;

    this.resizing = {
      col,
      startX: event.clientX,
      startWidth: this.cols.sizeOf(col),
    };
    document.body.style.cursor = "col-resize";
    event.preventDefault();
  };

  private readonly onRowHeadMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    const row = lineIndexOf(event.target as HTMLElement, "row");
    if (row === null) return;
    this.handlers.onPickLine("row", row, event.shiftKey);
    event.preventDefault();
    this.el.body.focus();
  };

  private readonly onCellMenu = (event: MouseEvent): void => {
    event.preventDefault();
    // A right click on a non-focusable header or cell would otherwise hand
    // focus to the document, and every key press after it would go nowhere.
    this.el.body.focus();
    this.handlers.onMenu(
      { kind: "cell", coord: this.coordAt(event.clientX, event.clientY) },
      event.clientX,
      event.clientY,
    );
  };

  private readonly onColHeadMenu = (event: MouseEvent): void => {
    const col = lineIndexOf(event.target as HTMLElement, "col");
    if (col === null) return;
    event.preventDefault();
    this.el.body.focus();
    this.handlers.onMenu(
      { kind: "column", index: col },
      event.clientX,
      event.clientY,
    );
  };

  private readonly onRowHeadMenu = (event: MouseEvent): void => {
    const row = lineIndexOf(event.target as HTMLElement, "row");
    if (row === null) return;
    event.preventDefault();
    this.el.body.focus();
    this.handlers.onMenu(
      { kind: "row", index: row },
      event.clientX,
      event.clientY,
    );
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.resizing !== null) {
      const width = this.resizing.startWidth + (event.clientX - this.resizing.startX);
      this.cols.resize(this.resizing.col, width);
      this.render();
      return;
    }
    if (!this.dragging) return;
    this.handlers.onDrag(this.coordAt(event.clientX, event.clientY));
  };

  private readonly onMouseUp = (): void => {
    this.dragging = false;
    if (this.resizing !== null) {
      this.resizing = null;
      document.body.style.cursor = "";
      this.handlers.onResize();
    }
  };
}

/**
 * The row or column a header event belongs to.
 *
 * Header cells hold a label element, so the event target is often a child of
 * the node carrying the index; `closest` walks up to it. Returns null for an
 * event on the track itself, past the last header.
 */
function lineIndexOf(target: HTMLElement, axis: "row" | "col"): number | null {
  const head = target.closest(`[data-${axis}]`) as HTMLElement | null;
  if (head === null) return null;
  const index = Number(head.dataset[axis]);
  return Number.isInteger(index) ? index : null;
}
