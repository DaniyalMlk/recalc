import { walk } from "./ast.js";
import type { Node } from "./ast.js";
import { cellKey, formatA1, formatRange, normalizeRange } from "./reference.js";
import type { CellRef, RangeRef } from "./reference.js";

/** Everything a formula reads. */
export interface Precedents {
  /** Individual cells named directly by the formula. */
  readonly cells: readonly CellRef[];
  /** Whole ranges, kept unexpanded. */
  readonly ranges: readonly RangeRef[];
  /** Bare words that are not references — named ranges, or typos. */
  readonly names: readonly string[];
}

const EMPTY: Precedents = { cells: [], ranges: [], names: [] };

/** A stable identity for a range, ignoring anchors and corner order. */
export function rangeKey(range: RangeRef): string {
  const r = normalizeRange(range);
  return `${cellKey(r.start)}~${cellKey(r.end)}`;
}

/**
 * Collect the cells, ranges and names a formula reads.
 *
 * Ranges are deliberately *not* expanded here. `SUM(A1:A1000)` reads a
 * thousand cells but is one precedent; expanding it at extraction time would
 * put a thousand edges in the graph for a formula that only ever needs one.
 * The graph stores the range whole and asks a containment question when a cell
 * inside it changes.
 */
export function extractPrecedents(node: Node): Precedents {
  const cells: CellRef[] = [];
  const ranges: RangeRef[] = [];
  const names: string[] = [];
  const seenCells = new Set<string>();
  const seenRanges = new Set<string>();
  const seenNames = new Set<string>();

  for (const current of walk(node)) {
    switch (current.kind) {
      case "reference": {
        const key = cellKey(current.ref);
        if (!seenCells.has(key)) {
          seenCells.add(key);
          cells.push(current.ref);
        }
        break;
      }
      case "range": {
        const key = rangeKey(current.range);
        if (!seenRanges.has(key)) {
          seenRanges.add(key);
          ranges.push(normalizeRange(current.range));
        }
        break;
      }
      case "name": {
        if (!seenNames.has(current.name)) {
          seenNames.add(current.name);
          names.push(current.name);
        }
        break;
      }
      default:
        break;
    }
  }

  if (cells.length === 0 && ranges.length === 0 && names.length === 0) {
    return EMPTY;
  }
  return { cells, ranges, names };
}

/** Human-readable precedent list, used in diagnostics and the CLI. */
export function describePrecedents(precedents: Precedents): string[] {
  return [
    ...precedents.cells.map(formatA1),
    ...precedents.ranges.map(formatRange),
    ...precedents.names,
  ];
}
