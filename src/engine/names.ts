import { REF_ERROR } from "./errors.js";
import {
  ReferenceError_,
  formatA1,
  formatRange,
  normalizeRange,
  parseA1,
} from "./reference.js";
import type { CellRef, RangeRef } from "./reference.js";
import { adjustRange, adjustRef } from "./structure.js";
import type { StructuralEdit } from "./structure.js";
import type { Value } from "./value.js";

/**
 * Defined names, and what they are allowed to be.
 *
 * A name can stand for a constant or for a piece of the sheet. The second is
 * the interesting one, because it puts an edge in the dependency graph that no
 * formula spells out: if `Revenue` is `B2:B13`, then editing `B7` has to
 * recalculate everything that mentions `Revenue`, even though nothing mentions
 * `B7`. The table below is deliberately just storage and validation — the
 * graph work happens where the graph is.
 */

/** What a name stands for. */
export type NameBinding =
  | { readonly kind: "value"; readonly value: Value }
  | { readonly kind: "cell"; readonly ref: CellRef }
  | { readonly kind: "range"; readonly range: RangeRef };

/** A name as reported to a user interface. */
export interface NameEntry {
  /** The name in its canonical, upper-case form. */
  readonly name: string;
  readonly binding: NameBinding;
  /** What was given when the name was defined, for display. */
  readonly target: string;
}

/** Thrown when a name or its target is not usable. */
export class NameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NameError";
  }
}

/**
 * Names follow the same shape as a formula word, which is what makes them
 * usable without quoting. The lexer already accepts this shape, so anything
 * matching here will reach the evaluator as a `name` node.
 */
const NAME_SHAPE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

/**
 * Reject a name that a formula would read as something else.
 *
 * `A1` is out because it is a cell, and `TRUE` is out because it is a boolean
 * literal. Allowing either would create text that means two things depending
 * on which resolver ran first, which is a bug that only shows up in somebody
 * else's sheet.
 */
export function validateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") throw new NameError("a name cannot be empty");

  // The collision checks come before the shape check so the message names the
  // real problem: `$B$7` is a reference, not merely an odd choice of letters.
  if (looksLikeReference(trimmed)) {
    throw new NameError(`${trimmed} is a cell reference, not a name`);
  }

  const upper = trimmed.toUpperCase();
  if (upper === "TRUE" || upper === "FALSE") {
    throw new NameError(`${trimmed} is a boolean literal, not a name`);
  }

  if (!NAME_SHAPE.test(trimmed)) {
    throw new NameError(
      `${trimmed} is not a valid name: use a letter or underscore, then letters, digits, dots or underscores`,
    );
  }

  return upper;
}

function looksLikeReference(text: string): boolean {
  try {
    parseA1(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a name's target text.
 *
 * `B2`, `B2:B13` and `$B$2:$B$13` become references; anything else is not a
 * reference at all and the caller decides whether to store it as a constant.
 */
export function parseTarget(target: string): NameBinding | null {
  const text = target.trim();
  if (text === "") return null;

  const colon = text.indexOf(":");
  try {
    if (colon < 0) return { kind: "cell", ref: parseA1(text) };
    return {
      kind: "range",
      range: normalizeRange({
        start: parseA1(text.slice(0, colon)),
        end: parseA1(text.slice(colon + 1)),
      }),
    };
  } catch (error) {
    if (error instanceof ReferenceError_) return null;
    throw error;
  }
}

export class NameTable {
  private readonly entries = new Map<string, NameEntry>();

  get size(): number {
    return this.entries.size;
  }

  /** Bind a name to a constant. */
  setValue(name: string, value: Value): string {
    const key = validateName(name);
    this.entries.set(key, {
      name: key,
      binding: { kind: "value", value },
      target: value === null ? "" : String(value),
    });
    return key;
  }

  /**
   * Bind a name to a cell or range, given as A1 text.
   *
   * Throws rather than storing an unresolvable target: a name that has never
   * pointed anywhere is a typo at definition time, and reporting it then is
   * far more useful than a `#NAME?` in a cell somebody else opens later.
   */
  setReference(name: string, target: string): string {
    const key = validateName(name);
    const binding = parseTarget(target);
    if (binding === null) {
      throw new NameError(`${target} is not a cell or a range`);
    }
    this.entries.set(key, { name: key, binding, target: target.trim() });
    return key;
  }

  get(name: string): NameBinding | undefined {
    return this.entries.get(name.toUpperCase())?.binding;
  }

  has(name: string): boolean {
    return this.entries.has(name.toUpperCase());
  }

  delete(name: string): boolean {
    return this.entries.delete(name.toUpperCase());
  }

  clear(): void {
    this.entries.clear();
  }

  /** Replace the whole table, for restoring a recorded state. */
  restore(entries: readonly NameEntry[]): void {
    this.entries.clear();
    for (const entry of entries) this.entries.set(entry.name, entry);
  }

  /**
   * Move every name that points at part of the sheet through one structural
   * edit, and report which ones moved.
   *
   * A name is a reference with a label on it, so it has to follow the rows and
   * columns exactly as a written-out reference does. A name whose entire target
   * is deleted keeps its label and becomes `#REF!` rather than disappearing:
   * the formulas that mention it would otherwise turn into `#NAME?`, which
   * says the name was never defined when in fact its target was destroyed.
   */
  adjust(edit: StructuralEdit): string[] {
    const moved: string[] = [];
    for (const [key, entry] of this.entries) {
      const { binding } = entry;
      if (binding.kind === "value") continue;

      if (binding.kind === "cell") {
        const ref = adjustRef(binding.ref, edit);
        if (ref === null) {
          this.entries.set(key, {
            name: key,
            binding: { kind: "value", value: REF_ERROR },
            target: "#REF!",
          });
          moved.push(key);
          continue;
        }
        if (ref.col === binding.ref.col && ref.row === binding.ref.row) continue;
        this.entries.set(key, {
          name: key,
          binding: { kind: "cell", ref },
          target: formatA1(ref),
        });
        moved.push(key);
        continue;
      }

      const range = adjustRange(binding.range, edit);
      if (range === null) {
        this.entries.set(key, {
          name: key,
          binding: { kind: "value", value: REF_ERROR },
          target: "#REF!",
        });
        moved.push(key);
        continue;
      }
      const before = formatRange(binding.range);
      const after = formatRange(range);
      if (before === after) continue;
      this.entries.set(key, {
        name: key,
        binding: { kind: "range", range },
        target: after,
      });
      moved.push(key);
    }
    return moved;
  }

  /** Every name, sorted, for listing in a UI. */
  list(): NameEntry[] {
    return [...this.entries.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }
}
