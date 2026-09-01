/**
 * The edit journal behind undo and redo.
 *
 * An entry records what an operation changed rather than what the sheet looked
 * like before it. Snapshotting the sheet on every keystroke is the obvious
 * implementation and is quadratic in the size of the sheet for a session of
 * ordinary typing; recording the difference makes a one-cell edit cost one
 * entry no matter how large the sheet is.
 *
 * What is recorded is the *input* of each cell, never its value. Values are
 * derived, so restoring the inputs and recalculating reproduces them exactly,
 * and a journal of values would go stale the moment anything upstream changed.
 */

import type { NameEntry } from "./names.js";

/** One cell's text before and after an operation. `""` means empty. */
export interface CellChange {
  readonly address: string;
  readonly before: string;
  readonly after: string;
}

/** One undoable operation. */
export interface Change {
  /** Short description, for an undo menu. */
  readonly label: string;
  readonly cells: readonly CellChange[];
  /**
   * The whole name table before and after, when the operation touched it.
   *
   * Names are few and the table is small, so there is nothing to gain from
   * recording them individually, and an operation that redefines a name can
   * change several at once.
   */
  readonly names?: {
    readonly before: readonly NameEntry[];
    readonly after: readonly NameEntry[];
  };
}

/** How many operations a journal keeps by default. */
export const DEFAULT_HISTORY_LIMIT = 200;

/**
 * A bounded undo stack.
 *
 * Recording a new operation discards the redo stack, which is the behaviour
 * every editor has: once you have branched away from a future, that future is
 * no longer reachable and pretending otherwise makes redo unpredictable.
 */
export class EditJournal {
  private readonly past: Change[] = [];
  private readonly future: Change[] = [];

  constructor(private readonly limit: number = DEFAULT_HISTORY_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`history limit must be a positive integer: ${limit}`);
    }
  }

  /** Add an operation. Ignored when it changed nothing. */
  record(change: Change): void {
    if (change.cells.length === 0 && change.names === undefined) return;
    this.past.push(change);
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** What undo would reverse, for labelling a menu item. */
  get undoLabel(): string | null {
    return this.past[this.past.length - 1]?.label ?? null;
  }

  /** What redo would reapply. */
  get redoLabel(): string | null {
    return this.future[this.future.length - 1]?.label ?? null;
  }

  get depth(): number {
    return this.past.length;
  }

  /** Take the most recent operation off the undo stack, for reversing. */
  takeUndo(): Change | null {
    const change = this.past.pop();
    if (change === undefined) return null;
    this.future.push(change);
    return change;
  }

  /** Take the most recently undone operation back, for reapplying. */
  takeRedo(): Change | null {
    const change = this.future.pop();
    if (change === undefined) return null;
    this.past.push(change);
    return change;
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}

/**
 * Build the cell half of a change from two input maps.
 *
 * The union of the two key sets is what matters, not either one alone: a cell
 * that only exists afterwards has to be recorded so undo can remove it, and one
 * that only existed before has to be recorded so undo can put it back.
 */
export function diffInputs(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): CellChange[] {
  const changes: CellChange[] = [];
  const addresses = new Set([...before.keys(), ...after.keys()]);
  for (const address of addresses) {
    const from = before.get(address) ?? "";
    const to = after.get(address) ?? "";
    if (from !== to) changes.push({ address, before: from, after: to });
  }
  return changes;
}
