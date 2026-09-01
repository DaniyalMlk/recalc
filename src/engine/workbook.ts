import "../functions/index.js";

import type { Node } from "./ast.js";
import { CYCLE_ERROR, err } from "./errors.js";
import { evaluate } from "./evaluator.js";
import type { EvalContext } from "./evaluator.js";
import { DependencyGraph } from "./graph.js";
import { EditJournal, diffInputs } from "./history.js";
import type { Change } from "./history.js";
import { SparseGrid } from "./grid.js";
import { NameTable } from "./names.js";
import type { NameBinding, NameEntry } from "./names.js";
import { parseFormula } from "./parser.js";
import { extractPrecedents } from "./precedents.js";
import type { Precedents } from "./precedents.js";
import { printFormula } from "./printer.js";
import { recalculate } from "./recalc.js";
import {
  MAX_COLUMNS,
  MAX_ROWS,
  cellKey,
  columnToLabel,
  formatA1,
  formatRange,
  iterateRange,
  normalizeRange,
  parseA1,
  parseA1Range,
  parseCellKey,
} from "./reference.js";
import type { CellRef, Coord, RangeRef } from "./reference.js";
import { translateAst } from "./translate.js";
import { adjustAst, adjustCoord, validateEdit } from "./structure.js";
import type { StructuralEdit } from "./structure.js";
import { formatValue, parseNumericText } from "./value.js";
import type { Value } from "./value.js";

/** What the user typed, plus everything derived from it. */
export interface CellRecord {
  /** Exactly what was entered, including any leading `=`. */
  readonly input: string;
  /** Parsed formula, or `null` for a literal. */
  readonly ast: Node | null;
  /** Literal value, for non-formula cells. */
  readonly literal: Value;
  /** Last computed value. */
  value: Value;
}

/** A cell address, given either as A1 text or as coordinates. */
export type Address = string | Coord;

/** A rectangular block, given either as `A1:C9` text or as a range. */
export type BlockAddress = string | RangeRef;

function toCoord(address: Address): CellRef | Coord {
  return typeof address === "string" ? parseA1(address) : address;
}

function toRange(block: BlockAddress): RangeRef {
  return typeof block === "string"
    ? parseA1Range(block)
    : normalizeRange(block);
}

/** Render a coordinate as a plain, unanchored A1 address. */
function addressOf(coord: Coord): string {
  return formatA1({ ...coord, colAbsolute: false, rowAbsolute: false });
}

/** A short description of a structural edit, for the undo history. */
function structuralLabel(edit: StructuralEdit): string {
  const noun = `${edit.axis}${edit.count === 1 ? "" : "s"}`;
  const where =
    edit.axis === "row" ? String(edit.at + 1) : columnToLabel(edit.at);
  return `${edit.operation} ${edit.count} ${noun} at ${where}`;
}

/**
 * Whether two name tables hold the same thing.
 *
 * Compared by serialised form because a binding is a small closed union of
 * plain data - a value, a reference or a range - and writing the comparison out
 * by hand would be three cases that have to be kept in step with the union.
 */
function sameNames(
  before: readonly NameEntry[],
  after: readonly NameEntry[],
): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

/**
 * A copied block of cells, holding what was typed rather than what it showed.
 *
 * `origin` is where the block was taken from, which is the only reason a paste
 * can translate: the delta is the distance between the origin and wherever the
 * block lands. A `null` entry is a cell that was blank when it was copied, and
 * pasting one blanks its target rather than leaving what was underneath.
 */
export interface Clipboard {
  readonly origin: Coord;
  readonly width: number;
  readonly height: number;
  /** Row-major, `height` rows of `width` entries. */
  readonly cells: readonly (readonly (string | null)[])[];
}

/** Render a dependency-graph cell id as a plain A1 address. */
function addressOfId(id: string): string {
  const [col, row] = id.split(":").map(Number) as [number, number];
  return formatA1({ col, row, colAbsolute: false, rowAbsolute: false });
}

/**
 * Interpret typed input the way a cell does.
 *
 * The order is deliberate: a leading `=` makes it a formula whatever follows,
 * then numeric text becomes a number, then `TRUE`/`FALSE` become booleans, and
 * anything left over stays text. `"007"` therefore becomes the number 7, which
 * is the behaviour people expect and complain about in equal measure.
 *
 * A leading apostrophe comes before all of that and forces text: `'007` keeps
 * its zeros and `'=A1` is the characters, not a formula. The apostrophe is
 * consumed rather than stored, because it is a prefix on the *input* and not
 * the first character of the value — but `getInput` still returns it, since
 * that is what was typed and reopening the cell has to show it again.
 */
export function interpretInput(input: string): {
  ast: Node | null;
  literal: Value;
} {
  if (input.startsWith("'")) {
    return { ast: null, literal: input.slice(1) };
  }
  if (input.startsWith("=")) {
    return { ast: parseFormula(input), literal: null };
  }
  if (input === "") return { ast: null, literal: null };

  const numeric = parseNumericText(input);
  if (numeric !== null) return { ast: null, literal: numeric };

  const upper = input.trim().toUpperCase();
  if (upper === "TRUE") return { ast: null, literal: true };
  if (upper === "FALSE") return { ast: null, literal: false };

  return { ast: null, literal: input };
}

/**
 * Move one cell's typed text by a delta.
 *
 * Pasted text arrives as a string rather than a parsed record, so the formula
 * has to make the round trip through the parser. That is the price of a
 * clipboard that holds text: it can outlive the sheet it came from, and a
 * pre-parsed tree could not.
 */
function translateInputText(
  input: string,
  deltaCol: number,
  deltaRow: number,
): string {
  if (!input.startsWith("=")) return input;
  const ast = parseFormula(input);
  const moved = translateAst(ast, deltaCol, deltaRow);
  return moved === ast ? input : printFormula(moved, true);
}

/**
 * A single sheet: storage, dependency tracking and evaluation behind one API.
 *
 * Every mutation recalculates immediately, and only what the mutation
 * invalidated. There is no explicit "recalculate now" step to forget.
 */
export class Workbook {
  private readonly cells = new SparseGrid<CellRecord>();
  private readonly graph = new DependencyGraph();
  private readonly nameTable = new NameTable();

  /**
   * Which cells mention which name.
   *
   * Redefining a name has to reach the formulas that use it, and those
   * formulas are not reachable through the graph — the graph holds the cells a
   * name resolved *to*, not the name itself. Recalculating the whole sheet
   * would be correct and would also throw away the entire point of the graph,
   * so the users are tracked here instead.
   */
  private readonly nameUsers = new Map<string, Set<string>>();

  private readonly journal = new EditJournal();

  /**
   * Set while an operation is being recorded or replayed.
   *
   * Mutators call each other, and undo is itself a write. Only the outermost
   * call is one operation from the user's point of view; anything nested inside
   * belongs to it rather than being a second entry in the journal.
   */
  private recording = false;

  private readonly context: EvalContext = {
    readCell: (coord) => this.cells.get(coord)?.value ?? null,
    readRange: (range) => this.readRange(range),
    resolveName: (name) => this.nameTable.get(name),
  };

  /** Whether there is an operation to undo. */
  get canUndo(): boolean {
    return this.journal.canUndo;
  }

  /** Whether there is an undone operation to reapply. */
  get canRedo(): boolean {
    return this.journal.canRedo;
  }

  /** A short description of what undo would reverse, for a menu. */
  get undoLabel(): string | null {
    return this.journal.undoLabel;
  }

  /** A short description of what redo would reapply. */
  get redoLabel(): string | null {
    return this.journal.redoLabel;
  }

  /**
   * Reverse the most recent operation. Returns false when there is none.
   *
   * The journal holds inputs, so undo restores what was typed and lets the
   * engine recompute the rest. Restoring values instead would be faster and
   * wrong the moment anything the sheet depends on has moved on.
   */
  undo(): boolean {
    const change = this.journal.takeUndo();
    if (change === null) return false;
    this.applyChange(change, "before");
    return true;
  }

  /** Reapply the most recently undone operation. */
  redo(): boolean {
    const change = this.journal.takeRedo();
    if (change === null) return false;
    this.applyChange(change, "after");
    return true;
  }

  /** Forget the edit history, keeping the sheet as it is. */
  clearHistory(): void {
    this.journal.clear();
  }

  /**
   * Run one operation and record what it changed.
   *
   * `scope` is where to look for changes: the addresses the operation could
   * possibly touch, or `"sheet"` when it could touch anything. Narrowing it is
   * what keeps a one-cell edit from costing a scan of the whole sheet, and
   * getting it wrong loses edits from the journal rather than corrupting
   * anything — so operations that cannot bound their reach say so honestly.
   */
  private transact(
    label: string,
    scope: readonly Coord[] | "sheet",
    body: () => void,
  ): void {
    if (this.recording) {
      body();
      return;
    }

    const namesBefore = this.nameTable.list();
    const before = this.captureInputs(scope);

    this.recording = true;
    try {
      body();
    } finally {
      this.recording = false;
    }

    const after = this.captureInputs(scope);
    const namesAfter = this.nameTable.list();
    const cells = diffInputs(before, after);
    const names = sameNames(namesBefore, namesAfter)
      ? undefined
      : { before: namesBefore, after: namesAfter };

    this.journal.record(
      names === undefined ? { label, cells } : { label, cells, names },
    );
  }

  private captureInputs(
    scope: readonly Coord[] | "sheet",
  ): Map<string, string> {
    const out = new Map<string, string>();
    if (scope === "sheet") {
      for (const [coord, record] of this.cells.entries()) {
        out.set(addressOf(coord), record.input);
      }
      return out;
    }
    for (const coord of scope) {
      const record = this.cells.get(coord);
      if (record !== undefined) out.set(addressOf(coord), record.input);
    }
    return out;
  }

  /**
   * Put the sheet into one side of a recorded change.
   *
   * Restoring names needs more than a table swap: the formulas that mention a
   * name carry the cells it resolved to in the graph, so those edges have to be
   * rebuilt before anything is recomputed.
   */
  private applyChange(change: Change, side: "before" | "after"): void {
    this.recording = true;
    try {
      if (change.names !== undefined) {
        this.nameTable.restore(change.names[side]);
      }
      this.writeInputs(
        change.cells.map(
          (cell) => [parseA1(cell.address), cell[side]] as const,
        ),
      );
      if (change.names !== undefined) this.rebuildPrecedents();
    } finally {
      this.recording = false;
    }
  }

  /** Re-derive every formula's edges, then recompute the sheet. */
  private rebuildPrecedents(): void {
    this.graph.clear();
    this.nameUsers.clear();
    for (const [coord, record] of this.cells.entries()) {
      this.writePrecedents(coord, record.ast);
    }
    this.recalculateAll();
  }

  /**
   * Enter a value or formula into a cell.
   *
   * Throws {@link ParseError} for a malformed formula; the cell is left
   * untouched in that case, so a bad edit cannot corrupt the sheet.
   */
  setCell(address: Address, input: string | number | boolean | null): void {
    const coord = toCoord(address);
    const text = input === null ? "" : String(input);
    this.transact(`edit ${addressOf(coord)}`, [coord], () => {
      this.writeInputs([[coord, text]]);
    });
  }

  /** Enter many cells, then recalculate once for the whole batch. */
  setCells(entries: Record<string, string | number | boolean | null>): void {
    const updates = Object.entries(entries).map(
      ([address, input]) =>
        [parseA1(address), input === null ? "" : String(input)] as const,
    );
    this.transact(
      `enter ${updates.length} cell${updates.length === 1 ? "" : "s"}`,
      updates.map(([coord]) => coord),
      () => {
        this.writeInputs(updates);
      },
    );
  }

  /**
   * Write a batch of cells and recalculate once for the whole batch.
   *
   * Every bulk operation — filling, pasting, clearing a block, undoing — comes
   * through here, so they all get the one recalculation pass rather than one
   * per cell. An empty string clears its cell.
   */
  private writeInputs(entries: Iterable<readonly [Coord, string]>): void {
    const seeds: Coord[] = [];
    for (const [coord, text] of entries) {
      if (text === "") {
        this.cells.delete(coord);
        this.writePrecedents(coord, null);
        seeds.push(coord);
        continue;
      }
      const { ast, literal } = interpretInput(text);
      this.cells.set(coord, { input: text, ast, literal, value: literal });
      this.writePrecedents(coord, ast);
      seeds.push(coord);
    }
    this.recalculateFrom(seeds);
  }

  clearCell(address: Address): void {
    const coord = toCoord(address);
    this.transact(`clear ${addressOf(coord)}`, [coord], () => {
      this.writeInputs([[coord, ""]]);
    });
  }

  /**
   * Copy the first row of a block into the rows beneath it.
   *
   * The source row is part of the block, the way a spreadsheet's fill handle
   * works: `fillDown("B2:B10")` copies row 2 into rows 3 to 10. Formulas are
   * translated by the distance travelled, so `=A2*Rate` becomes `=A3*Rate` one
   * row down, while `=A$2*Rate` does not move at all.
   */
  fillDown(block: BlockAddress): void {
    const range = toRange(block);
    const height = range.end.row - range.start.row + 1;
    if (height < 2) return;

    const updates: [Coord, string][] = [];
    // The source row is read before anything is written, so a block that
    // overlaps its own source still fills from the original.
    for (let col = range.start.col; col <= range.end.col; col++) {
      const source = this.cells.get({ col, row: range.start.row });
      for (let row = range.start.row + 1; row <= range.end.row; row++) {
        updates.push([
          { col, row },
          source === undefined
            ? ""
            : this.translatedInput(source, 0, row - range.start.row),
        ]);
      }
    }
    this.transact("fill down", updates.map(([coord]) => coord), () => {
      this.writeInputs(updates);
    });
  }

  /** Copy the first column of a block into the columns to its right. */
  fillRight(block: BlockAddress): void {
    const range = toRange(block);
    const width = range.end.col - range.start.col + 1;
    if (width < 2) return;

    const updates: [Coord, string][] = [];
    for (let row = range.start.row; row <= range.end.row; row++) {
      const source = this.cells.get({ col: range.start.col, row });
      for (let col = range.start.col + 1; col <= range.end.col; col++) {
        updates.push([
          { col, row },
          source === undefined
            ? ""
            : this.translatedInput(source, col - range.start.col, 0),
        ]);
      }
    }
    this.transact("fill across", updates.map(([coord]) => coord), () => {
      this.writeInputs(updates);
    });
  }

  /** Take a copy of a block, as typed, ready to paste elsewhere. */
  copy(block: BlockAddress): Clipboard {
    const range = toRange(block);
    const cells: (string | null)[][] = [];
    for (let row = range.start.row; row <= range.end.row; row++) {
      const line: (string | null)[] = [];
      for (let col = range.start.col; col <= range.end.col; col++) {
        line.push(this.cells.get({ col, row })?.input ?? null);
      }
      cells.push(line);
    }
    return {
      origin: { col: range.start.col, row: range.start.row },
      width: range.end.col - range.start.col + 1,
      height: range.end.row - range.start.row + 1,
      cells,
    };
  }

  /**
   * Paste a copied block with its top-left corner at `target`.
   *
   * Formulas are translated by the distance from where the block was copied,
   * which is why the clipboard remembers its origin. Cells that fall off the
   * edge of the sheet are dropped rather than wrapping or clamping.
   */
  paste(clipboard: Clipboard, target: Address): void {
    const at = toCoord(target);
    const deltaCol = at.col - clipboard.origin.col;
    const deltaRow = at.row - clipboard.origin.row;

    const updates: [Coord, string][] = [];
    for (let row = 0; row < clipboard.height; row++) {
      const line = clipboard.cells[row] ?? [];
      for (let col = 0; col < clipboard.width; col++) {
        const coord = { col: at.col + col, row: at.row + row };
        if (coord.col >= MAX_COLUMNS || coord.row >= MAX_ROWS) continue;
        const input = line[col] ?? null;
        updates.push([
          coord,
          input === null ? "" : translateInputText(input, deltaCol, deltaRow),
        ]);
      }
    }
    this.transact("paste", updates.map(([coord]) => coord), () => {
      this.writeInputs(updates);
    });
  }

  /** Empty every occupied cell in a block, in one recalculation pass. */
  clearBlock(block: BlockAddress): void {
    const range = toRange(block);
    const updates: [Coord, string][] = [];
    for (const [coord] of this.cells.entriesInRange(range)) {
      updates.push([coord, ""]);
    }
    if (updates.length === 0) return;
    this.transact(
      `clear ${formatRange(range)}`,
      updates.map(([coord]) => coord),
      () => {
        this.writeInputs(updates);
      },
    );
  }

  /**
   * What a cell's input becomes once it has been moved by a delta.
   *
   * A literal is copied exactly, including a leading apostrophe: it is text,
   * and text does not depend on where it sits. A formula is only reprinted when
   * translation actually moved something inside it, so filling a column of
   * `=$B$1*2` leaves every copy spelled the way the first one was.
   */
  private translatedInput(
    record: CellRecord,
    deltaCol: number,
    deltaRow: number,
  ): string {
    if (record.ast === null) return record.input;
    const moved = translateAst(record.ast, deltaCol, deltaRow);
    return moved === record.ast ? record.input : printFormula(moved, true);
  }

  /**
   * Insert blank rows above `at`, pushing everything below them down.
   *
   * `at` is zero-based, so `insertRows(0)` puts a row above row 1.
   */
  insertRows(at: number, count = 1): void {
    this.applyStructuralEdit({ axis: "row", operation: "insert", at, count });
  }

  /** Delete `count` rows starting at `at`, pulling everything below them up. */
  deleteRows(at: number, count = 1): void {
    this.applyStructuralEdit({ axis: "row", operation: "delete", at, count });
  }

  /** Insert blank columns to the left of `at`. */
  insertColumns(at: number, count = 1): void {
    this.applyStructuralEdit({ axis: "column", operation: "insert", at, count });
  }

  /** Delete `count` columns starting at `at`. */
  deleteColumns(at: number, count = 1): void {
    this.applyStructuralEdit({ axis: "column", operation: "delete", at, count });
  }

  /**
   * Move the sheet through one structural edit.
   *
   * Three things move at once and all three have to agree afterwards: the
   * cells, the formulas written in terms of where those cells were, and the
   * names pointing at them. The graph is rebuilt from scratch rather than
   * patched, because an edit on one axis can move every cell in the sheet, so
   * there is no smaller set of edges to repair.
   *
   * A formula is only reprinted when a reference inside it actually moved.
   * `adjustAst` returns the identical tree when nothing changed, which is how a
   * sheet survives a hundred structural edits with the untouched formulas still
   * spelled the way they were typed.
   */
  applyStructuralEdit(edit: StructuralEdit): void {
    validateEdit(edit);
    this.transact(structuralLabel(edit), "sheet", () => {
      this.rewriteSheet(edit);
    });
  }

  private rewriteSheet(edit: StructuralEdit): void {
    const moved: [Coord, CellRecord][] = [];
    for (const [coord, record] of this.cells.entries()) {
      const target = adjustCoord(coord, edit);
      // A cell pushed past the last row or column of the sheet has nowhere to
      // go, so the insert drops it rather than silently keeping two cells at
      // the same address.
      if (target === null) continue;

      let ast = record.ast;
      let input = record.input;
      if (record.ast !== null) {
        const rewritten = adjustAst(record.ast, edit);
        if (rewritten !== record.ast) {
          ast = rewritten;
          input = printFormula(rewritten, true);
        }
      }

      moved.push([
        target,
        { input, ast, literal: record.literal, value: record.literal },
      ]);
    }

    this.cells.clear();
    this.graph.clear();
    this.nameUsers.clear();
    this.nameTable.adjust(edit);

    for (const [coord, record] of moved) this.cells.set(coord, record);
    for (const [coord, record] of moved) this.writePrecedents(coord, record.ast);

    this.recalculateAll();
  }

  /** Define a named constant, usable as a bare word in formulas. */
  setName(name: string, value: Value): void {
    this.transact(`name ${name.toUpperCase()}`, [], () => {
      this.rebindName(this.nameTable.setValue(name, value));
    });
  }

  /**
   * Define a name for a cell or a range, given as A1 text.
   *
   * `book.defineName("Revenue", "B2:B13")` makes `SUM(Revenue)` behave exactly
   * as though the range had been typed out, invalidation included.
   */
  defineName(name: string, target: string): void {
    this.transact(`name ${name.toUpperCase()}`, [], () => {
      this.rebindName(this.nameTable.setReference(name, target));
    });
  }

  /** Remove a name. Formulas that used it fall back to `#NAME?`. */
  deleteName(name: string): boolean {
    let removed = false;
    this.transact(`remove name ${name.toUpperCase()}`, [], () => {
      removed = this.nameTable.delete(name);
      if (removed) this.rebindName(name.toUpperCase());
    });
    return removed;
  }

  /** What a name currently stands for, or `undefined`. */
  lookupName(name: string): NameBinding | undefined {
    return this.nameTable.get(name);
  }

  /** Every defined name, sorted. */
  names(): NameEntry[] {
    return this.nameTable.list();
  }

  getValue(address: Address): Value {
    return this.cells.get(toCoord(address))?.value ?? null;
  }

  /** The value as it would be displayed in the cell. */
  getDisplay(address: Address): string {
    return formatValue(this.getValue(address));
  }

  /** Exactly what was typed into the cell. */
  getInput(address: Address): string {
    return this.cells.get(toCoord(address))?.input ?? "";
  }

  /** The canonical spelling of the cell's formula, or `null` for a literal. */
  getFormula(address: Address): string | null {
    const ast = this.cells.get(toCoord(address))?.ast;
    return ast == null ? null : printFormula(ast, true);
  }

  has(address: Address): boolean {
    return this.cells.has(toCoord(address));
  }

  get cellCount(): number {
    return this.cells.size;
  }

  /** Bounding box of the occupied cells, or `null` when empty. */
  extent(): RangeRef | null {
    return this.cells.extent();
  }

  /** A1 addresses of the cells this cell reads directly. */
  precedentsOf(address: Address): string[] {
    const coord = toCoord(address);
    return [
      ...this.graph.precedentsOf(coord).map(addressOfId),
      ...this.graph.rangePrecedentsOf(coord).map(formatRange),
    ];
  }

  /** A1 addresses of the cells that read this cell. */
  dependentsOf(address: Address): string[] {
    return this.graph.dependentsOf(toCoord(address)).map(addressOfId);
  }

  /**
   * The order cells would be recomputed in if `address` changed, as A1
   * addresses. Useful for explaining why an edit is expensive.
   */
  recalculationOrder(address: Address): string[] {
    return this.graph
      .planRecalculation([toCoord(address)])
      .order.map(addressOfId);
  }

  /** Circular references currently in the sheet, as A1 address groups. */
  cycles(): string[][] {
    const seeds = [...this.cells.coords()];
    const plan = this.graph.planRecalculation(seeds);
    return plan.cycles.map((cycle) => cycle.map(addressOfId));
  }

  /** Recompute every cell, in dependency order. */
  recalculateAll(): void {
    this.recalculateFrom([...this.cells.coords()]);
  }

  /**
   * Record what a cell reads, with any names it mentions expanded to the
   * cells and ranges they stand for.
   *
   * The expansion is what makes a named range behave like a written-out one.
   * Without it, `SUM(Revenue)` would carry no edge to `B7` and editing `B7`
   * would leave a stale total on screen — the worst kind of spreadsheet bug,
   * because nothing about it looks wrong.
   */
  private writePrecedents(coord: Coord, ast: Node | null): void {
    const key = cellKey(coord);
    for (const users of this.nameUsers.values()) users.delete(key);

    if (ast === null) {
      this.graph.clearPrecedents(coord);
      return;
    }

    const precedents = extractPrecedents(ast);
    for (const name of precedents.names) {
      const users = this.nameUsers.get(name);
      if (users === undefined) this.nameUsers.set(name, new Set([key]));
      else users.add(key);
    }

    this.graph.setPrecedents(coord, this.expandNames(precedents));
  }

  /** Add the cells and ranges the mentioned names resolve to. */
  private expandNames(precedents: Precedents): Precedents {
    if (precedents.names.length === 0) return precedents;

    const cells = [...precedents.cells];
    const ranges = [...precedents.ranges];
    let expanded = false;

    for (const name of precedents.names) {
      const binding = this.nameTable.get(name);
      if (binding === undefined) continue;
      if (binding.kind === "cell") {
        cells.push(binding.ref);
        expanded = true;
      } else if (binding.kind === "range") {
        ranges.push(binding.range);
        expanded = true;
      }
    }

    return expanded ? { cells, ranges, names: precedents.names } : precedents;
  }

  /**
   * Re-point every formula that mentions a name, then recalculate from them.
   *
   * Only the users are touched, so defining a name in a large sheet costs what
   * the name is actually used by rather than the size of the sheet.
   */
  private rebindName(key: string): void {
    const users = this.nameUsers.get(key);
    if (users === undefined || users.size === 0) return;

    const seeds: Coord[] = [];
    for (const id of [...users]) {
      const coord = parseCellKey(id);
      const record = this.cells.get(coord);
      if (record === undefined || record.ast === null) continue;
      this.graph.setPrecedents(
        coord,
        this.expandNames(extractPrecedents(record.ast)),
      );
      seeds.push(coord);
    }

    this.recalculateFrom(seeds);
  }

  private recalculateFrom(seeds: readonly Coord[]): void {
    recalculate(this.graph, seeds, {
      evaluate: (coord) => this.evaluateCell(coord),
      cycleValue: (_coord, cycle) =>
        err(
          "#CYCLE!",
          `circular reference: ${cycle
            .map((c) =>
              formatA1({ ...c, colAbsolute: false, rowAbsolute: false }),
            )
            .join(" -> ")}`,
        ),
      write: (coord, value) => {
        const record = this.cells.get(coord);
        if (record !== undefined) record.value = value;
      },
    });
  }

  private evaluateCell(coord: Coord): Value {
    const record = this.cells.get(coord);
    if (record === undefined) return null;
    if (record.ast === null) return record.literal;
    return evaluate(record.ast, this.context);
  }

  private readRange(range: RangeRef): Value[] {
    const out: Value[] = [];
    for (const coord of iterateRange(range)) {
      out.push(this.cells.get(coord)?.value ?? null);
    }
    return out;
  }

  /** Every occupied cell as `{ A1: input }`, for serialisation and tests. */
  toInputMap(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [coord, record] of this.cells.entries()) {
      out[
        formatA1({ ...coord, colAbsolute: false, rowAbsolute: false })
      ] = record.input;
    }
    return out;
  }
}

export { CYCLE_ERROR, cellKey };
