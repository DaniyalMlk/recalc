import type { CellId, DependencyGraph, RecalcPlan } from "./graph.js";
import { parseCellKey } from "./reference.js";
import type { Coord } from "./reference.js";

/**
 * What a recalculation pass does at each cell.
 *
 * Evaluation is injected rather than built in, so the scheduling in this
 * module can be tested against a stub that records the order it was called in,
 * with no evaluator and no value model involved.
 */
export interface RecalcHooks<V> {
  /** Compute the cell's new value. Called in dependency order. */
  evaluate(coord: Coord): V;
  /** Value for a cell that is part of a circular reference. */
  cycleValue(coord: Coord, cycle: readonly Coord[]): V;
  /** Store a computed value. */
  write(coord: Coord, value: V): void;
}

export interface RecalcStats {
  /** Cells whose formula was evaluated. */
  readonly evaluated: number;
  /** Cells short-circuited because they sit inside a circular reference. */
  readonly cycled: number;
  /** The plan that was executed, kept for inspection. */
  readonly plan: RecalcPlan;
}

function toCoords(ids: readonly CellId[]): Coord[] {
  return ids.map(parseCellKey);
}

/**
 * Recalculate everything a set of edits invalidated.
 *
 * Cells inside a circular reference are never evaluated — evaluating them
 * would either loop forever or return whatever stale value happened to be
 * there. They get a cycle value instead, and because the plan still places
 * them ahead of their dependents, cells that merely read a cycle evaluate
 * normally and propagate that value like any other error.
 */
export function recalculate<V>(
  graph: DependencyGraph,
  seeds: readonly Coord[],
  hooks: RecalcHooks<V>,
): RecalcStats {
  const plan = graph.planRecalculation(seeds);

  const cycleFor = new Map<CellId, Coord[]>();
  for (const cycle of plan.cycles) {
    const coords = toCoords(cycle);
    for (const member of cycle) cycleFor.set(member, coords);
  }

  let evaluated = 0;
  let cycled = 0;

  for (const cellId of plan.order) {
    const coord = parseCellKey(cellId);
    const cycle = cycleFor.get(cellId);
    if (cycle !== undefined) {
      hooks.write(coord, hooks.cycleValue(coord, cycle));
      cycled++;
      continue;
    }
    hooks.write(coord, hooks.evaluate(coord));
    evaluated++;
  }

  return { evaluated, cycled, plan };
}
