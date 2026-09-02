/**
 * The sheet's format table.
 *
 * Formats live beside the values rather than inside `CellRecord`, for two
 * reasons. A format outlives its contents — clearing a cell in a spreadsheet
 * leaves the column still reading as money — so binding the two together
 * would delete the format every time the cell was emptied. And a format is
 * frequently applied to a block where most cells are empty, which a table
 * keyed by coordinate handles and a per-record field cannot.
 *
 * Codes are stored as the text the user wrote and compiled on demand. The
 * compiled form is cached because the grid re-renders a cell's format on every
 * repaint, and re-parsing per repaint would put a string scan on the render
 * path; the cache is keyed by the code text, so a column sharing one format
 * compiles it once for the whole column.
 */

import { SparseGrid } from "./grid.js";
import type { Coord, RangeRef } from "./reference.js";
import { isGeneralFormat, parseFormatCode } from "../format/code.js";
import type { FormatCode } from "../format/code.js";
import { applyFormat } from "../format/render.js";
import type { FormattedValue } from "../format/render.js";
import { formatValue } from "./value.js";
import type { Value } from "./value.js";

const GENERAL: FormattedValue = { text: "", colour: null };

export class FormatTable {
  private readonly codes = new SparseGrid<string>();
  private readonly compiled = new Map<string, FormatCode>();

  get size(): number {
    return this.codes.size;
  }

  /**
   * Attach a format to a cell.
   *
   * The code is compiled here rather than at render time, so a malformed one
   * is rejected — with `FormatCodeError` and an offset — before it can get
   * into the sheet. `General` and the empty string remove the format instead
   * of storing one, which is what makes "back to normal" expressible.
   */
  set(coord: Coord, code: string): void {
    if (code === "" || isGeneralFormat(code)) {
      this.codes.delete(coord);
      return;
    }
    this.compile(code);
    this.codes.set(coord, code);
  }

  delete(coord: Coord): boolean {
    return this.codes.delete(coord);
  }

  /** The code attached to a cell, or `null` when it uses the general format. */
  get(coord: Coord): string | null {
    return this.codes.get(coord) ?? null;
  }

  clear(): void {
    this.codes.clear();
  }

  *entries(): Generator<[Coord, string]> {
    yield* this.codes.entries();
  }

  *entriesInRange(range: RangeRef): Generator<[Coord, string]> {
    yield* this.codes.entriesInRange(range);
  }

  /**
   * Render a value as the cell displays it.
   *
   * A cell with no format falls back to the general rendering, which is the
   * same answer the sheet gave before formats existed.
   */
  render(coord: Coord, value: Value): FormattedValue {
    const code = this.codes.get(coord);
    if (code === undefined) {
      return value === null ? GENERAL : { text: formatValue(value), colour: null };
    }
    return applyFormat(this.compile(code), value);
  }

  private compile(code: string): FormatCode {
    const cached = this.compiled.get(code);
    if (cached !== undefined) return cached;
    const parsed = parseFormatCode(code);
    this.compiled.set(code, parsed);
    return parsed;
  }
}
