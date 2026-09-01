import { rangeKey } from "./precedents.js";
import type { Precedents } from "./precedents.js";
import { cellKey, parseCellKey, rangeContains } from "./reference.js";
import type { Coord, RangeRef } from "./reference.js";

/** A cell identity, as produced by {@link cellKey}. */
export type CellId = string;

interface RangeSubscription {
  readonly range: RangeRef;
  readonly subscribers: Set<CellId>;
}

/**
 * A plan for one recalculation pass.
 *
 * `order` lists every cell that has to be recomputed, precedents before
 * dependents. Cells inside a circular reference appear in `order` too — the
 * caller still has to write `#CYCLE!` into them — but are also listed in
 * `cycleMembers` so they can be told apart from cells that merely *read* a
 * cycle and should evaluate normally, propagating the error as a value.
 */
export interface RecalcPlan {
  readonly order: readonly CellId[];
  readonly cycleMembers: ReadonlySet<CellId>;
  /** One entry per circular reference, listing the cells that form it. */
  readonly cycles: readonly (readonly CellId[])[];
}

/**
 * The dependency graph.
 *
 * Both directions are stored. `precedentsOf` answers "what does this formula
 * read", which is a question tooling asks; `dependentsOf` answers "what has to
 * be recomputed when this cell changes", which is the question on the hot path
 * of every edit. Only the second one needs to be fast, and keeping the reverse
 * edges materialised is what makes it O(out-degree) instead of a full scan.
 */
export class DependencyGraph {
  /** cell -> the cells it reads directly. */
  private readonly precedents = new Map<CellId, Set<CellId>>();
  /** cell -> the cells that read it directly. */
  private readonly dependents = new Map<CellId, Set<CellId>>();
  /** cell -> the ranges it reads. */
  private readonly rangesRead = new Map<CellId, string[]>();
  /** range key -> the range and the cells subscribed to it. */
  private readonly rangeSubscriptions = new Map<string, RangeSubscription>();

  /** Replace everything `cell` reads. Old edges are removed first. */
  setPrecedents(cell: Coord, precedents: Precedents): void {
    const id = cellKey(cell);
    this.clearPrecedents(cell);

    const cellIds = new Set<CellId>();
    for (const ref of precedents.cells) {
      // A self-reference produces a self-edge on purpose: dropping it as a
      // no-op would hide a one-cell circular reference from the detector.
      const precedentId = cellKey(ref);
      cellIds.add(precedentId);
      this.addDependent(precedentId, id);
    }
    if (cellIds.size > 0) this.precedents.set(id, cellIds);

    if (precedents.ranges.length > 0) {
      const keys: string[] = [];
      for (const range of precedents.ranges) {
        const key = rangeKey(range);
        keys.push(key);
        const existing = this.rangeSubscriptions.get(key);
        if (existing === undefined) {
          this.rangeSubscriptions.set(key, {
            range,
            subscribers: new Set([id]),
          });
        } else {
          existing.subscribers.add(id);
        }
      }
      this.rangesRead.set(id, keys);
    }
  }

  /** Drop every edge out of `cell`. */
  clearPrecedents(cell: Coord): void {
    const id = cellKey(cell);
    const cellIds = this.precedents.get(id);
    if (cellIds !== undefined) {
      for (const precedentId of cellIds) {
        const set = this.dependents.get(precedentId);
        if (set === undefined) continue;
        set.delete(id);
        if (set.size === 0) this.dependents.delete(precedentId);
      }
      this.precedents.delete(id);
    }

    const keys = this.rangesRead.get(id);
    if (keys !== undefined) {
      for (const key of keys) {
        const subscription = this.rangeSubscriptions.get(key);
        if (subscription === undefined) continue;
        subscription.subscribers.delete(id);
        if (subscription.subscribers.size === 0) {
          this.rangeSubscriptions.delete(key);
        }
      }
      this.rangesRead.delete(id);
    }
  }

  /**
   * Drop every edge in the graph.
   *
   * A structural edit moves most of the sheet at once, so rebuilding the graph
   * wholesale is both simpler and cheaper than unpicking each edge: the edit is
   * already linear in the number of cells because every one of them may have
   * to move.
   */
  clear(): void {
    this.precedents.clear();
    this.dependents.clear();
    this.rangesRead.clear();
    this.rangeSubscriptions.clear();
  }

  private addDependent(precedentId: CellId, dependentId: CellId): void {
    const set = this.dependents.get(precedentId);
    if (set === undefined) {
      this.dependents.set(precedentId, new Set([dependentId]));
    } else {
      set.add(dependentId);
    }
  }

  /** The cells `cell` reads directly, excluding range members. */
  precedentsOf(cell: Coord): CellId[] {
    return [...(this.precedents.get(cellKey(cell)) ?? [])];
  }

  /** The range keys `cell` reads. */
  rangePrecedentsOf(cell: Coord): RangeRef[] {
    const keys = this.rangesRead.get(cellKey(cell)) ?? [];
    const out: RangeRef[] = [];
    for (const key of keys) {
      const subscription = this.rangeSubscriptions.get(key);
      if (subscription !== undefined) out.push(subscription.range);
    }
    return out;
  }

  /**
   * The cells that read `cell`, directly.
   *
   * Range subscriptions are resolved by containment. That is a linear scan
   * over the *distinct* ranges in the sheet, not over cells: a workbook with
   * ten thousand formulas typically has far fewer distinct ranges, and each
   * test is four integer comparisons. Bringing it below linear would need a
   * spatial index, which is deferred until a benchmark says it is worth it.
   */
  dependentsOf(cell: Coord): CellId[] {
    const id = cellKey(cell);
    const out = new Set<CellId>(this.dependents.get(id) ?? []);
    for (const { range, subscribers } of this.rangeSubscriptions.values()) {
      if (!rangeContains(range, cell)) continue;
      // A formula whose range covers its own cell — `A1: =SUM(A1:A5)` — is a
      // circular reference, so the self-edge is kept here too.
      for (const subscriber of subscribers) out.add(subscriber);
    }
    return [...out];
  }

  /** Every cell reachable from `seeds` through dependent edges, seeds included. */
  transitiveDependents(seeds: readonly Coord[]): Set<CellId> {
    const visited = new Set<CellId>();
    const stack: CellId[] = [];

    for (const seed of seeds) {
      const id = cellKey(seed);
      if (!visited.has(id)) {
        visited.add(id);
        stack.push(id);
      }
    }

    while (stack.length > 0) {
      const id = stack.pop()!;
      for (const next of this.dependentsOf(parseCellKey(id))) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }

    return visited;
  }

  /**
   * Order the cells affected by a change so that every cell is recomputed
   * after everything it reads.
   *
   * The ordering runs over the subgraph reachable from `seeds`, never the
   * whole graph, so editing one cell in a large sheet costs work proportional
   * to what that edit actually invalidated.
   *
   * Cycles are found with Tarjan's strongly-connected-components algorithm,
   * which gives both the answer and the ordering in one pass: it emits each
   * component only once every component reachable from it has been emitted, so
   * reversing the emission order is exactly a topological sort of the
   * condensation.
   */
  planRecalculation(seeds: readonly Coord[]): RecalcPlan {
    const scope = this.transitiveDependents(seeds);

    const index = new Map<CellId, number>();
    const lowLink = new Map<CellId, number>();
    const onStack = new Set<CellId>();
    const stack: CellId[] = [];
    const components: CellId[][] = [];
    let counter = 0;

    // Iterative Tarjan: a deep dependency chain would blow the call stack in
    // the recursive form, and chains of thousands of cells are ordinary.
    type Frame = { id: CellId; children: CellId[]; next: number };

    const strongConnect = (root: CellId): void => {
      const frames: Frame[] = [
        { id: root, children: this.scopedDependents(root, scope), next: 0 },
      ];
      index.set(root, counter);
      lowLink.set(root, counter);
      counter++;
      stack.push(root);
      onStack.add(root);

      while (frames.length > 0) {
        const frame = frames[frames.length - 1]!;
        if (frame.next < frame.children.length) {
          const child = frame.children[frame.next]!;
          frame.next++;
          if (!index.has(child)) {
            index.set(child, counter);
            lowLink.set(child, counter);
            counter++;
            stack.push(child);
            onStack.add(child);
            frames.push({
              id: child,
              children: this.scopedDependents(child, scope),
              next: 0,
            });
          } else if (onStack.has(child)) {
            lowLink.set(
              frame.id,
              Math.min(lowLink.get(frame.id)!, index.get(child)!),
            );
          }
          continue;
        }

        frames.pop();
        if (lowLink.get(frame.id) === index.get(frame.id)) {
          const component: CellId[] = [];
          for (;;) {
            const member = stack.pop()!;
            onStack.delete(member);
            component.push(member);
            if (member === frame.id) break;
          }
          components.push(component);
        }
        const parent = frames[frames.length - 1];
        if (parent !== undefined) {
          lowLink.set(
            parent.id,
            Math.min(lowLink.get(parent.id)!, lowLink.get(frame.id)!),
          );
        }
      }
    };

    for (const id of scope) {
      if (!index.has(id)) strongConnect(id);
    }

    const order: CellId[] = [];
    const cycleMembers = new Set<CellId>();
    const cycles: CellId[][] = [];

    // Tarjan emits sinks first; reversing yields precedents-before-dependents.
    for (let i = components.length - 1; i >= 0; i--) {
      const component = components[i]!;
      const isCycle =
        component.length > 1 || this.hasSelfEdge(component[0]!, scope);
      if (isCycle) {
        cycles.push([...component].sort());
        for (const member of component) cycleMembers.add(member);
      }
      order.push(...component);
    }

    return { order, cycleMembers, cycles };
  }

  private scopedDependents(id: CellId, scope: ReadonlySet<CellId>): CellId[] {
    return this.dependentsOf(parseCellKey(id)).filter((next) => scope.has(next));
  }

  private hasSelfEdge(id: CellId, scope: ReadonlySet<CellId>): boolean {
    return this.scopedDependents(id, scope).includes(id);
  }

  /** Number of cells with outgoing edges; used in tests and diagnostics. */
  get formulaCount(): number {
    const ids = new Set<CellId>([
      ...this.precedents.keys(),
      ...this.rangesRead.keys(),
    ]);
    return ids.size;
  }

  /** Number of distinct ranges currently subscribed to. */
  get rangeCount(): number {
    return this.rangeSubscriptions.size;
  }
}
