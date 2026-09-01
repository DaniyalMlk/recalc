import { ParseError } from "../../../src/engine/errors.js";
import {
  MAX_COLUMNS,
  MAX_ROWS,
  columnToLabel,
  formatA1,
  parseA1,
} from "../../../src/engine/reference.js";
import type { Coord } from "../../../src/engine/reference.js";
import { StructureError } from "../../../src/engine/structure.js";
import { Workbook } from "../../../src/engine/workbook.js";
import type { Clipboard } from "../../../src/engine/workbook.js";
import { CsvError, exportCsv, importCsv } from "../../../src/io/csv.js";
import {
  columnCommands,
  editCommands,
  historyCommands,
  rowCommands,
} from "../core/commands.js";
import type { Command, CommandContext, CommandId } from "../core/commands.js";
import { charsForWidth, displayValue } from "../core/display.js";
import { highlightFormula } from "../core/highlight.js";
import type { Highlight } from "../core/highlight.js";
import { AxisMetrics } from "../core/metrics.js";
import { Selection } from "../core/selection.js";
import { rectContains } from "../core/selection.js";
import type { CellRect, Direction } from "../core/selection.js";
import { pageStep } from "../core/viewport.js";
import {
  SAMPLE_NAMES,
  SAMPLE_SHEET,
  SAMPLE_WIDTHS,
  sampleFormulas,
} from "../sample.js";
import { GridView } from "./grid-view.js";
import type { CellPaint, MenuTarget } from "./grid-view.js";
import { Inspector } from "./inspector.js";
import { ContextMenu } from "./menu.js";

/**
 * A working area big enough to be a real sheet and small enough that walking
 * it is instant. The engine addresses the full spreadsheet space — see
 * `MAX_ROWS` and `MAX_COLUMNS` — but `Ctrl`+`Down` across a million empty rows
 * is a scan the user has to wait for, and no one has ever wanted that.
 */
const SHEET_ROWS = Math.min(4096, MAX_ROWS);
const SHEET_COLS = Math.min(64, MAX_COLUMNS);

/**
 * Modifier shortcuts, keyed by the lower-cased key.
 *
 * `z` covers redo too, through Shift, which is the convention everywhere
 * except Windows-only applications that also bind Ctrl+Y.
 */
const SHORTCUTS: Record<string, CommandId> = {
  c: "copy",
  x: "cut",
  v: "paste",
  d: "fill-down",
  r: "fill-right",
  z: "undo",
  y: "redo",
};

/** Whether to spell shortcuts with the Command symbol. */
function isMac(): boolean {
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}

const ARROWS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

interface Editing {
  readonly coord: Coord;
  buffer: string;
  /** Which input the caret is in. */
  host: "cell" | "bar";
}

export interface AppElements {
  readonly body: HTMLElement;
  readonly canvas: HTMLElement;
  readonly cellLayer: HTMLElement;
  readonly markLayer: HTMLElement;
  readonly colHeadTrack: HTMLElement;
  readonly rowHeadTrack: HTMLElement;
  readonly cellInput: HTMLInputElement;
  readonly formulaInput: HTMLInputElement;
  readonly formulaInk: HTMLElement;
  readonly formulaNote: HTMLElement;
  readonly addressBox: HTMLElement;
  readonly inspectorTitle: HTMLElement;
  readonly inspectorKind: HTMLElement;
  readonly inspectorBody: HTMLElement;
  readonly statusSelection: HTMLElement;
  readonly statusStats: HTMLElement;
  readonly statusRecalc: HTMLElement;
  readonly sheetName: HTMLElement;
  readonly loadSample: HTMLButtonElement;
  readonly clearSheet: HTMLButtonElement;
  readonly undo: HTMLButtonElement;
  readonly redo: HTMLButtonElement;
  readonly importCsv: HTMLButtonElement;
  readonly exportCsv: HTMLButtonElement;
  readonly fileInput: HTMLInputElement;
  readonly dropzone: HTMLElement;
  readonly sheet: HTMLElement;
}

export class App {
  private readonly workbook = new Workbook();
  private readonly rows = new AxisMetrics(SHEET_ROWS, 26, 18);
  private readonly cols = new AxisMetrics(SHEET_COLS, 104, 40);
  private readonly selection = new Selection({
    rows: SHEET_ROWS,
    cols: SHEET_COLS,
  });

  private readonly grid: GridView;
  private readonly inspector: Inspector;
  private readonly menu: ContextMenu;

  private editing: Editing | null = null;
  private highlight: Highlight | null = null;
  private lastRecalc = "";

  /** The copied block, and where it came from, for the outline on the grid. */
  private clipboard: Clipboard | null = null;
  private copied: CellRect | null = null;

  constructor(private readonly el: AppElements) {
    this.grid = new GridView(
      {
        body: el.body,
        canvas: el.canvas,
        cellLayer: el.cellLayer,
        markLayer: el.markLayer,
        colHeadTrack: el.colHeadTrack,
        rowHeadTrack: el.rowHeadTrack,
      },
      this.rows,
      this.cols,
      {
        paint: (row, col) => this.paint(row, col),
        onPick: (coord, extending) => {
          this.commitEdit();
          if (extending) this.selection.extendTo(coord);
          else this.selection.moveTo(coord);
          this.syncSelection();
        },
        onDrag: (coord) => {
          if (this.editing !== null) return;
          if (this.selection.extendTo(coord)) this.syncSelection();
        },
        onOpenEditor: (coord) => {
          this.selection.moveTo(coord);
          this.syncSelection();
          this.beginEdit(this.workbook.getInput(this.address(coord)), "cell");
        },
        onResize: () => this.positionEditor(),
        onPickLine: (axis, index, extending) => this.pickLine(axis, index, extending),
        onMenu: (target, x, y) => this.openMenu(target, x, y),
      },
    );

    this.menu = new ContextMenu((id) => this.run(id));

    this.inspector = new Inspector(
      {
        title: el.inspectorTitle,
        kind: el.inspectorKind,
        body: el.inspectorBody,
      },
      (address) => this.goTo(address),
    );

    this.bindKeyboard();
    this.bindEditors();
    this.bindActions();
    this.bindInterchange();
  }

  /** Fill the sheet with the worked example and draw everything. */
  start(): void {
    this.loadSample();
  }

  // ------------------------------------------------------------- painting --

  private paint(row: number, col: number): CellPaint {
    const address = this.address({ row, col });
    const value = this.workbook.getValue(address);
    const display = displayValue(value, charsForWidth(this.cols.sizeOf(col)));
    return {
      text: display.text,
      kind: display.kind,
      isFormula: this.workbook.getFormula(address) !== null,
    };
  }

  /**
   * Redraw everything that follows the selection.
   *
   * `reveal` is the cell to scroll into view, and it is not always the focus.
   * Extending with the arrow keys should follow the moving end, but selecting a
   * whole row by its header puts the focus on column 64 — scrolling there would
   * throw the sheet off the side of the screen for what the user experienced as
   * a click on the row number.
   */
  private syncSelection(reveal: Coord = this.selection.focus): void {
    const active = this.selection.active;
    const address = this.address(active);

    this.grid.setSelection(this.selection.rect, active);
    this.grid.reveal(reveal);
    this.el.addressBox.textContent = this.describeSelection(address);

    if (this.editing === null) {
      this.setFormulaText(this.workbook.getInput(address));
      this.el.formulaNote.textContent = "";
    }

    this.inspector.render(this.workbook, active);
    this.updateStatus();
    this.refreshToolbar();
  }

  private describeSelection(address: string): string {
    const rect = this.selection.rect;
    if (this.selection.isSingle) return address;
    const rows = rect.bottom - rect.top + 1;
    const cols = rect.right - rect.left + 1;
    return `${address} · ${rows}×${cols}`;
  }

  private updateStatus(): void {
    const rect = this.selection.rect;
    const cells = (rect.bottom - rect.top + 1) * (rect.right - rect.left + 1);
    this.el.statusSelection.textContent =
      cells === 1 ? "1 cell" : `${cells.toLocaleString()} cells selected`;

    let count = 0;
    let sum = 0;
    let filled = 0;
    for (const coord of this.selection.cells()) {
      const value = this.workbook.getValue(this.address(coord));
      if (value !== null) filled += 1;
      if (typeof value === "number") {
        count += 1;
        sum += value;
      }
    }

    if (count === 0) {
      // "1 non-empty" next to "1 cell" is noise; the inspector already says it.
      this.el.statusStats.textContent =
        filled === 0 || cells === 1 ? "" : `${filled} non-empty`;
    } else if (cells === 1) {
      this.el.statusStats.textContent = "";
    } else {
      const average = sum / count;
      this.el.statusStats.textContent = `sum ${trim(sum)} · average ${trim(
        average,
      )} · count ${count}`;
    }

    this.el.statusRecalc.textContent = this.lastRecalc;
  }

  // -------------------------------------------------------------- editing --

  private beginEdit(initial: string, host: "cell" | "bar"): void {
    const coord = this.selection.active;
    this.editing = { coord, buffer: initial, host };

    this.el.cellInput.hidden = host !== "cell";
    this.el.cellInput.value = initial;
    this.positionEditor();
    this.setFormulaText(initial);

    const input = host === "cell" ? this.el.cellInput : this.el.formulaInput;
    input.focus();
    const end = initial.length;
    input.setSelectionRange(end, end);
    this.refreshHighlight(initial);
  }

  /**
   * Put the editor over its cell, and let it spill sideways over the ones
   * next to it when the formula is longer than the column is wide.
   *
   * A formula is routinely wider than the cell holding it, and an editor
   * clipped to the column scrolls its own text out of sight the moment the
   * caret reaches the end — you end up typing into a keyhole. The width comes
   * from `scrollWidth` rather than from a character count, so it is the
   * browser's own measurement of the text actually in the box.
   */
  private positionEditor(): void {
    if (this.editing === null) return;

    const rect = this.grid.rectOf(this.editing.coord);
    const style = this.el.cellInput.style;
    style.left = `${rect.left}px`;
    style.top = `${rect.top}px`;
    style.height = `${rect.height}px`;
    style.width = `${rect.width}px`;

    const room = this.grid.viewport.width - 8;
    const needed = this.el.cellInput.scrollWidth + 24;
    style.width = `${Math.min(Math.max(rect.width, needed), room)}px`;
  }

  /** Write the edit into the sheet. Returns false when the formula is bad. */
  private commitEdit(): boolean {
    const editing = this.editing;
    if (editing === null) return true;

    const address = this.address(editing.coord);
    const before = this.workbook.getInput(address);
    if (editing.buffer === before) {
      this.endEdit();
      return true;
    }

    try {
      this.workbook.setCell(address, editing.buffer);
    } catch (error) {
      if (error instanceof ParseError) {
        this.el.formulaNote.textContent = error.message;
        return false;
      }
      throw error;
    }

    const touched = this.workbook.dependentsOf(address).length;
    this.lastRecalc =
      touched === 0
        ? `${address} recalculated`
        : `${address} recalculated, ${touched} dependent${
            touched === 1 ? "" : "s"
          } refreshed`;

    this.endEdit();
    this.grid.refresh();
    return true;
  }

  private cancelEdit(): void {
    this.endEdit();
    this.setFormulaText(this.workbook.getInput(this.address(this.selection.active)));
  }

  private endEdit(): void {
    this.editing = null;
    this.highlight = null;
    this.el.cellInput.hidden = true;
    this.el.cellInput.value = "";
    this.el.formulaNote.textContent = "";
    this.grid.setHighlight(null);
    this.el.body.focus();
  }

  private refreshHighlight(text: string): void {
    const highlight = highlightFormula(text);
    this.highlight = highlight;
    this.grid.setHighlight(text.startsWith("=") ? highlight : null);
    this.el.formulaNote.textContent = highlight.error ?? "";
    this.paintInk(highlight);
  }

  /** Render the coloured text that sits beneath the transparent input. */
  private paintInk(highlight: Highlight): void {
    this.el.formulaInk.replaceChildren(
      ...highlight.spans.map((span) => {
        const node = document.createElement("span");
        node.className =
          span.kind === "reference"
            ? `tok-ref-${span.slot ?? 0}`
            : `tok-${span.kind}`;
        node.textContent = span.text;
        return node;
      }),
    );
  }

  private setFormulaText(text: string): void {
    this.el.formulaInput.value = text;
    this.paintInk(highlightFormula(text));
  }

  // ------------------------------------------------------------- commands --

  private goTo(address: string): void {
    // Precedents can be ranges; land on the corner the reader would expect.
    const first = address.includes(":") ? (address.split(":")[0] as string) : address;
    try {
      const ref = parseA1(first);
      this.selection.moveTo(ref);
      this.syncSelection();
      this.el.body.focus();
    } catch {
      /* A name, not a reference: nothing to navigate to. */
    }
  }

  // ------------------------------------------------------- block commands --

  /** The selection as an `A1:C9` block, which is what the workbook takes. */
  private selectedBlock(): string {
    const rect = this.selection.rect;
    const from = this.address({ row: rect.top, col: rect.left });
    const to = this.address({ row: rect.bottom, col: rect.right });
    return `${from}:${to}`;
  }

  private selectionHasContent(): boolean {
    for (const coord of this.selection.cells()) {
      if (this.workbook.has(this.address(coord))) return true;
    }
    return false;
  }

  private commandContext(): CommandContext {
    return {
      rect: this.selection.rect,
      hasClipboard: this.clipboard !== null,
      hasContent: this.selectionHasContent(),
      canUndo: this.workbook.canUndo,
      canRedo: this.workbook.canRedo,
      undoLabel: this.workbook.undoLabel,
      redoLabel: this.workbook.redoLabel,
      mac: isMac(),
    };
  }

  /**
   * Run one command and put the screen back in step with the sheet.
   *
   * Every command goes through here rather than being wired separately to a
   * key, a menu item and a button, so the three can never drift apart in what
   * they actually do.
   */
  private run(id: CommandId): void {
    this.commitEdit();
    const rect = this.selection.rect;
    const rows = rect.bottom - rect.top + 1;
    const cols = rect.right - rect.left + 1;

    try {
      switch (id) {
        case "copy":
          this.copySelection();
          return;
        case "cut":
          this.copySelection();
          this.workbook.clearBlock(this.selectedBlock());
          this.lastRecalc = "cut";
          break;
        case "paste": {
          if (this.clipboard === null) return;
          const at = this.address(this.selection.active);
          this.workbook.paste(this.clipboard, at);
          this.lastRecalc = `pasted ${this.clipboard.width}x${this.clipboard.height} at ${at}`;
          break;
        }
        case "fill-down":
          if (rows < 2) return;
          this.workbook.fillDown(this.selectedBlock());
          this.lastRecalc = `filled ${this.selectedBlock()}`;
          break;
        case "fill-right":
          if (cols < 2) return;
          this.workbook.fillRight(this.selectedBlock());
          this.lastRecalc = `filled ${this.selectedBlock()}`;
          break;
        case "clear":
          this.workbook.clearBlock(this.selectedBlock());
          this.lastRecalc = "cleared";
          break;
        case "insert-rows":
          this.workbook.insertRows(rect.top, rows);
          this.lastRecalc = `${rows} row${rows === 1 ? "" : "s"} inserted`;
          break;
        case "delete-rows":
          this.workbook.deleteRows(rect.top, rows);
          this.lastRecalc = `${rows} row${rows === 1 ? "" : "s"} deleted`;
          break;
        case "insert-columns":
          this.workbook.insertColumns(rect.left, cols);
          this.lastRecalc = `${cols} column${cols === 1 ? "" : "s"} inserted`;
          break;
        case "delete-columns":
          this.workbook.deleteColumns(rect.left, cols);
          this.lastRecalc = `${cols} column${cols === 1 ? "" : "s"} deleted`;
          break;
        case "undo":
        case "redo": {
          const label =
            id === "undo" ? this.workbook.undoLabel : this.workbook.redoLabel;
          const done = id === "undo" ? this.workbook.undo() : this.workbook.redo();
          if (!done) return;
          this.lastRecalc = `${id === "undo" ? "undid" : "redid"} ${label ?? "the last edit"}`;
          break;
        }
      }
    } catch (error) {
      if (!(error instanceof StructureError)) throw error;
      this.lastRecalc = error.message;
    }

    // A structural edit can move the cell the clipboard was taken from, so the
    // outline would point at the wrong block; the copy itself stays usable.
    if (id.startsWith("insert-") || id.startsWith("delete-") || id === "cut") {
      this.setCopied(null);
    }

    this.grid.render();
    this.syncSelection();
  }

  private copySelection(): void {
    const rect = this.selection.rect;
    this.clipboard = this.workbook.copy(this.selectedBlock());
    this.setCopied(rect);
    this.lastRecalc = `copied ${this.clipboard.width}x${this.clipboard.height}`;
    this.updateStatus();
    this.refreshToolbar();
  }

  private setCopied(rect: CellRect | null): void {
    this.copied = rect;
    this.grid.setMarquee(rect);
  }

  private pickLine(
    axis: "row" | "column",
    index: number,
    extending: boolean,
  ): void {
    this.commitEdit();
    const far =
      axis === "row"
        ? { row: index, col: SHEET_COLS - 1 }
        : { row: SHEET_ROWS - 1, col: index };
    const near = axis === "row" ? { row: index, col: 0 } : { row: 0, col: index };
    if (extending) {
      this.selection.extendTo(far);
    } else {
      this.selection.selectRect(near, far);
    }
    this.syncSelection(near);
  }

  /**
   * Open the context menu for whatever was right-clicked.
   *
   * A right click outside the selection moves it first, which is what every
   * grid does: acting on a block the user cannot see selected is how a menu
   * deletes the wrong row.
   */
  private openMenu(target: MenuTarget, x: number, y: number): void {
    if (target.kind === "cell") {
      if (!rectContains(this.selection.rect, target.coord)) {
        this.selection.moveTo(target.coord);
        this.syncSelection();
      }
    } else {
      const rect = this.selection.rect;
      const inside =
        target.kind === "row"
          ? target.index >= rect.top && target.index <= rect.bottom
          : target.index >= rect.left && target.index <= rect.right;
      if (!inside) this.pickLine(target.kind, target.index, false);
    }

    const context = this.commandContext();
    const groups: Command[][] = [];
    if (target.kind === "row") groups.push(rowCommands(context));
    if (target.kind === "column") groups.push(columnCommands(context));
    groups.push(editCommands(context));
    groups.push(historyCommands(context));
    this.menu.show(groups, x, y);
  }

  private refreshToolbar(): void {
    this.el.undo.disabled = !this.workbook.canUndo;
    this.el.redo.disabled = !this.workbook.canRedo;
    this.el.undo.title =
      this.workbook.undoLabel === null
        ? "Nothing to undo"
        : `Undo ${this.workbook.undoLabel}`;
    this.el.redo.title =
      this.workbook.redoLabel === null
        ? "Nothing to redo"
        : `Redo ${this.workbook.redoLabel}`;
  }

  private loadSample(): void {
    this.workbook.setCells(
      Object.fromEntries(
        Object.keys(this.workbook.toInputMap()).map((address) => [address, null]),
      ),
    );
    this.cols.resetAll();
    for (const [col, width] of Object.entries(SAMPLE_WIDTHS)) {
      this.cols.resize(Number(col), width);
    }
    for (const [name, target] of Object.entries(SAMPLE_NAMES)) {
      this.workbook.defineName(name, target);
    }
    this.workbook.setCells({ ...SAMPLE_SHEET, ...sampleFormulas() });

    this.setCopied(null);
    this.workbook.clearHistory();
    this.el.sheetName.textContent = "project appraisal";
    this.lastRecalc = `${this.workbook.cellCount} cells loaded`;
    this.selection.moveTo({ row: 0, col: 0 });
    this.grid.render();
    this.syncSelection();
  }

  private clearSheet(): void {
    for (const entry of this.workbook.names()) {
      this.workbook.deleteName(entry.name);
    }
    this.workbook.setCells(
      Object.fromEntries(
        Object.keys(this.workbook.toInputMap()).map((address) => [address, null]),
      ),
    );
    this.cols.resetAll();
    this.setCopied(null);
    this.workbook.clearHistory();
    this.el.sheetName.textContent = "empty sheet";
    this.lastRecalc = "";
    this.selection.moveTo({ row: 0, col: 0 });
    this.grid.render();
    this.syncSelection();
  }

  /**
   * Read CSV text into the sheet at the selected cell.
   *
   * The selection is the origin rather than A1, because pasting a column of
   * figures next to an existing model is the reason to import at all.
   */
  private importText(text: string, name: string): void {
    const origin = this.address(this.selection.active);
    try {
      const result = importCsv(this.workbook, text, { origin });
      this.el.sheetName.textContent = name;
      this.lastRecalc =
        result.range === null
          ? "nothing to import"
          : `${result.cells} cells imported at ${origin}`;
    } catch (error) {
      this.lastRecalc =
        error instanceof CsvError ? error.message : "could not read that file";
    }
    this.grid.render();
    this.syncSelection();
  }

  /**
   * Hand the sheet back as a file.
   *
   * Formula text, not computed values: a file the user can re-open and keep
   * working in is worth more than one that has forgotten how it was derived.
   */
  private downloadCsv(): void {
    const text = exportCsv(this.workbook, { mode: "formulas" });
    if (text === "") {
      this.lastRecalc = "nothing to export";
      this.updateStatus();
      return;
    }

    const url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "sheet.csv";
    link.click();
    URL.revokeObjectURL(url);

    this.lastRecalc = `${this.workbook.cellCount} cells exported`;
    this.updateStatus();
  }

  private bindInterchange(): void {
    this.el.importCsv.addEventListener("click", () => {
      this.el.fileInput.click();
    });

    this.el.fileInput.addEventListener("change", () => {
      const file = this.el.fileInput.files?.[0];
      if (file === undefined) return;
      void file.text().then((text) => {
        this.importText(text, file.name);
        this.el.fileInput.value = "";
        this.el.body.focus();
      });
    });

    this.el.exportCsv.addEventListener("click", () => {
      this.downloadCsv();
      this.el.body.focus();
    });

    // A drag that never entered stays counted, so track depth rather than
    // toggling on enter and leave — child elements fire both on the way past.
    let depth = 0;
    const show = (visible: boolean): void => {
      this.el.dropzone.hidden = !visible;
    };

    this.el.sheet.addEventListener("dragenter", (event) => {
      event.preventDefault();
      depth += 1;
      show(true);
    });

    this.el.sheet.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
    });

    this.el.sheet.addEventListener("dragleave", (event) => {
      event.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) show(false);
    });

    this.el.sheet.addEventListener("drop", (event) => {
      event.preventDefault();
      depth = 0;
      show(false);
      const file = event.dataTransfer?.files?.[0];
      if (file === undefined) return;
      void file.text().then((text) => this.importText(text, file.name));
    });
  }

  private usedRect(): CellRect | null {
    const extent = this.workbook.extent();
    if (extent === null) return null;
    return {
      top: extent.start.row,
      left: extent.start.col,
      bottom: extent.end.row,
      right: extent.end.col,
    };
  }

  private address(coord: Coord): string {
    return formatA1({ ...coord, colAbsolute: false, rowAbsolute: false });
  }

  private occupied = (coord: Coord): boolean =>
    this.workbook.has(this.address(coord));

  // ------------------------------------------------------------ listeners --

  private bindActions(): void {
    this.el.loadSample.addEventListener("click", () => {
      this.loadSample();
      this.el.body.focus();
    });
    this.el.clearSheet.addEventListener("click", () => {
      this.clearSheet();
      this.el.body.focus();
    });
    this.el.undo.addEventListener("click", () => {
      this.run("undo");
      this.el.body.focus();
    });
    this.el.redo.addEventListener("click", () => {
      this.run("redo");
      this.el.body.focus();
    });
  }

  private bindEditors(): void {
    const onInput = (host: "cell" | "bar") => (): void => {
      const input = host === "cell" ? this.el.cellInput : this.el.formulaInput;
      if (this.editing === null) {
        this.beginEdit(input.value, host);
        return;
      }
      this.editing.buffer = input.value;
      this.editing.host = host;
      const mirror = host === "cell" ? this.el.formulaInput : this.el.cellInput;
      mirror.value = input.value;
      this.positionEditor();
      this.refreshHighlight(input.value);
    };

    this.el.cellInput.addEventListener("input", onInput("cell"));
    this.el.formulaInput.addEventListener("input", onInput("bar"));

    this.el.formulaInput.addEventListener("focus", () => {
      if (this.editing === null) {
        this.beginEdit(this.el.formulaInput.value, "bar");
      }
    });

    // Keep the coloured layer under the caret when the input scrolls sideways.
    this.el.formulaInput.addEventListener("scroll", () => {
      this.el.formulaInk.scrollLeft = this.el.formulaInput.scrollLeft;
    });

    const onEditorKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancelEdit();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (!this.commitEdit()) return;
        this.selection.advance("row", event.shiftKey);
        this.syncSelection();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        if (!this.commitEdit()) return;
        this.selection.advance("col", event.shiftKey);
        this.syncSelection();
      }
    };

    this.el.cellInput.addEventListener("keydown", onEditorKey);
    this.el.formulaInput.addEventListener("keydown", onEditorKey);

    /*
     * Clicking away commits, but the two editors hand focus to each other and
     * `endEdit` hands it back to the grid. Committing on any blur would close
     * the editor the instant it opened, so the destination decides.
     */
    const onEditorBlur = (event: FocusEvent): void => {
      const next = event.relatedTarget;
      if (next === this.el.cellInput || next === this.el.formulaInput) return;
      if (this.editing !== null) this.commitEdit();
    };

    this.el.cellInput.addEventListener("blur", onEditorBlur);
    this.el.formulaInput.addEventListener("blur", onEditorBlur);
  }

  private bindKeyboard(): void {
    this.el.body.addEventListener("keydown", (event) => {
      if (this.editing !== null) return;

      /*
       * Shortcuts come first, and none of them animates anything. These are
       * pressed hundreds of times in a session, and an animation on a keystroke
       * makes the whole application feel like it is lagging behind the user.
       */
      if (event.ctrlKey || event.metaKey) {
        const command = SHORTCUTS[event.key.toLowerCase()];
        if (command !== undefined) {
          event.preventDefault();
          this.run(command === "undo" && event.shiftKey ? "redo" : command);
          return;
        }
      }

      const direction = ARROWS[event.key];
      if (direction !== undefined) {
        event.preventDefault();
        const jumping = event.ctrlKey || event.metaKey;
        if (jumping && event.shiftKey) {
          this.selection.jumpExtend(direction, this.occupied);
        } else if (jumping) {
          this.selection.jump(direction, this.occupied);
        } else if (event.shiftKey) {
          this.selection.extend(direction);
        } else {
          this.selection.move(direction);
        }
        this.syncSelection();
        return;
      }

      switch (event.key) {
        case "Enter": {
          // Enter on a closed cell moves on; F2 is what opens one.
          event.preventDefault();
          this.selection.advance("row", event.shiftKey);
          this.syncSelection();
          return;
        }
        case "F2": {
          event.preventDefault();
          this.beginEdit(
            this.workbook.getInput(this.address(this.selection.active)),
            "cell",
          );
          return;
        }
        case "Tab": {
          event.preventDefault();
          this.selection.advance("col", event.shiftKey);
          this.syncSelection();
          return;
        }
        case "Delete":
        case "Backspace": {
          event.preventDefault();
          this.run("clear");
          return;
        }
        case "Home": {
          event.preventDefault();
          if (event.ctrlKey || event.metaKey) {
            this.selection.documentStart(event.shiftKey);
          } else {
            this.selection.home(event.shiftKey);
          }
          this.syncSelection();
          return;
        }
        case "End": {
          event.preventDefault();
          this.selection.documentEnd(this.usedRect(), event.shiftKey);
          this.syncSelection();
          return;
        }
        case "PageDown":
        case "PageUp": {
          event.preventDefault();
          const step = pageStep(
            this.rows,
            this.selection.active.row,
            this.grid.viewport.height,
          );
          this.selection.page(
            event.key === "PageDown" ? "down" : "up",
            step,
            event.shiftKey,
          );
          this.syncSelection();
          return;
        }
        case "Escape": {
          // Escape drops the copy outline first: it is the thing on screen the
          // user is most likely trying to dismiss.
          if (this.copied !== null) this.setCopied(null);
          this.selection.moveTo(this.selection.active);
          this.syncSelection();
          return;
        }
        default:
          break;
      }

      // Any other single printable character starts an edit with that
      // character already typed, which is how a grid is supposed to behave.
      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        this.beginEdit(event.key, "cell");
      }
    });

  }
}

/** Short number for the status bar, where precision matters less than width. */
function trim(value: number): string {
  const rounded = Math.round(value * 1e4) / 1e4;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString("en-US")
    : rounded.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export { columnToLabel };
