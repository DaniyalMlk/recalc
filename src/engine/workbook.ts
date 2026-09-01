import "../functions/index.js";

import type { Node } from "./ast.js";
import { CYCLE_ERROR, err } from "./errors.js";
import { evaluate } from "./evaluator.js";
import type { EvalContext } from "./evaluator.js";
import { DependencyGraph } from "./graph.js";
import { SparseGrid } from "./grid.js";
import { NameTable } from "./names.js";
import type { NameBinding, NameEntry } from "./names.js";
import { parseFormula } from "./parser.js";
import { extractPrecedents } from "./precedents.js";
import type { Precedents } from "./precedents.js";
import { printFormula } from "./printer.js";
import { recalculate } from "./recalc.js";
import {
  cellKey,
  formatA1,
  formatRange,
  iterateRange,
  parseA1,
  parseCellKey,
} from "./reference.js";
import type { CellRef, Coord, RangeRef } from "./reference.js";
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

function toCoord(address: Address): CellRef | Coord {
  return typeof address === "string" ? parseA1(address) : address;
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

  private readonly context: EvalContext = {
    readCell: (coord) => this.cells.get(coord)?.value ?? null,
    readRange: (range) => this.readRange(range),
    resolveName: (name) => this.nameTable.get(name),
  };

  /**
   * Enter a value or formula into a cell.
   *
   * Throws {@link ParseError} for a malformed formula; the cell is left
   * untouched in that case, so a bad edit cannot corrupt the sheet.
   */
  setCell(address: Address, input: string | number | boolean | null): void {
    const coord = toCoord(address);
    const text = input === null ? "" : String(input);

    if (text === "") {
      this.clearCell(coord);
      return;
    }

    const { ast, literal } = interpretInput(text);
    this.cells.set(coord, { input: text, ast, literal, value: literal });

    this.writePrecedents(coord, ast);
    this.recalculateFrom([coord]);
  }

  /** Enter many cells, then recalculate once for the whole batch. */
  setCells(entries: Record<string, string | number | boolean | null>): void {
    const seeds: Coord[] = [];
    for (const [address, input] of Object.entries(entries)) {
      const coord = parseA1(address);
      const text = input === null ? "" : String(input);
      if (text === "") {
        this.cells.delete(coord);
        this.graph.clearPrecedents(coord);
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
    this.cells.delete(coord);
    this.writePrecedents(coord, null);
    this.recalculateFrom([coord]);
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
    this.rebindName(this.nameTable.setValue(name, value));
  }

  /**
   * Define a name for a cell or a range, given as A1 text.
   *
   * `book.defineName("Revenue", "B2:B13")` makes `SUM(Revenue)` behave exactly
   * as though the range had been typed out, invalidation included.
   */
  defineName(name: string, target: string): void {
    this.rebindName(this.nameTable.setReference(name, target));
  }

  /** Remove a name. Formulas that used it fall back to `#NAME?`. */
  deleteName(name: string): boolean {
    const removed = this.nameTable.delete(name);
    if (removed) this.rebindName(name.toUpperCase());
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
