import "../functions/index.js";

import type { Node } from "./ast.js";
import { CYCLE_ERROR, err } from "./errors.js";
import { evaluate } from "./evaluator.js";
import type { EvalContext } from "./evaluator.js";
import { DependencyGraph } from "./graph.js";
import { SparseGrid } from "./grid.js";
import { parseFormula } from "./parser.js";
import { extractPrecedents } from "./precedents.js";
import { printFormula } from "./printer.js";
import { recalculate } from "./recalc.js";
import {
  cellKey,
  formatA1,
  formatRange,
  iterateRange,
  parseA1,
} from "./reference.js";
import type { CellRef, Coord, RangeRef } from "./reference.js";
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
 */
export function interpretInput(input: string): {
  ast: Node | null;
  literal: Value;
} {
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
  private readonly names = new Map<string, Value>();

  private readonly context: EvalContext = {
    readCell: (coord) => this.cells.get(coord)?.value ?? null,
    readRange: (range) => this.readRange(range),
    resolveName: (name) => this.names.get(name.toUpperCase()),
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

    if (ast === null) {
      this.graph.clearPrecedents(coord);
    } else {
      this.graph.setPrecedents(coord, extractPrecedents(ast));
    }

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
      if (ast === null) {
        this.graph.clearPrecedents(coord);
      } else {
        this.graph.setPrecedents(coord, extractPrecedents(ast));
      }
      seeds.push(coord);
    }
    this.recalculateFrom(seeds);
  }

  clearCell(address: Address): void {
    const coord = toCoord(address);
    this.cells.delete(coord);
    this.graph.clearPrecedents(coord);
    this.recalculateFrom([coord]);
  }

  /** Define a named value, usable as a bare word in formulas. */
  setName(name: string, value: Value): void {
    this.names.set(name.toUpperCase(), value);
    this.recalculateAll();
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
