/**
 * Named scenarios: a dozen assumptions moved together.
 *
 * A sensitivity table moves one input, or two. A real case moves a dozen at
 * once — the downside is not "price 10% lower", it is lower price *and* slower
 * ramp *and* higher cost of capital, together, because the things that go
 * wrong go wrong in company.
 *
 * A scenario is a name against a set of `{address: input}` pairs. Inputs, not
 * values, for the same reason the clipboard holds text: a scenario that stores
 * `-8000` cannot express "fixed cost, but tied to headcount", and one that
 * stores `=B9*12000` can.
 *
 * The set is deliberately not part of the workbook. Applying a scenario is an
 * ordinary edit and belongs in the journal; *defining* one is not an edit at
 * all, and putting it in the journal would mean undo silently forgetting
 * scenarios. Keeping them beside the sheet rather than inside it draws that
 * line in the one place it matters.
 */

import { formatA1, parseA1 } from "../engine/reference.js";
import { ReferenceError_ } from "../engine/reference.js";
import type { Coord } from "../engine/reference.js";
import { adjustCoord } from "../engine/structure.js";
import type { StructuralEdit } from "../engine/structure.js";
import type { Value } from "../engine/value.js";
import type { Address, Workbook } from "../engine/workbook.js";

export class ScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioError";
  }
}

/** One assumption in a scenario: a cell and what to put in it. */
export interface Assumption {
  readonly address: string;
  /** Exactly what would be typed, `=` and all. An empty string clears. */
  readonly input: string;
}

export interface Scenario {
  readonly name: string;
  readonly assumptions: readonly Assumption[];
}

/** What applying a scenario would disturb beyond the values it sets. */
export interface ScenarioConflict {
  readonly address: string;
  /** The formula that would be overwritten. */
  readonly formula: string;
}

export interface ApplyResult {
  readonly name: string;
  readonly changed: number;
  /** Formulas overwritten by the apply, in address order. */
  readonly overwrote: readonly ScenarioConflict[];
}

/** One column of a summary: a scenario and what the results come to under it. */
export interface SummaryColumn {
  readonly name: string;
  readonly values: readonly Value[];
}

export interface Summary {
  readonly results: readonly string[];
  /** The sheet as it stands, before any scenario is considered. */
  readonly current: readonly Value[];
  readonly columns: readonly SummaryColumn[];
  /**
   * Which result cells take more than one distinct value across the columns.
   *
   * A summary of nine outputs where six are identical everywhere is mostly
   * noise, and the reader has to diff the rows by eye to find that out. The
   * engine already computed every cell, so it can say which rows carry the
   * differences.
   */
  readonly varying: readonly string[];
}

function label(address: Address): string {
  const coord: Coord = typeof address === "string" ? parseA1(address) : address;
  return formatA1({ ...coord, colAbsolute: false, rowAbsolute: false });
}

function normaliseName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") throw new ScenarioError("a scenario needs a name");
  return trimmed;
}

/** Case-insensitive, the way names behave everywhere else in the engine. */
function key(name: string): string {
  return name.toUpperCase();
}

/**
 * Compare two values the way a summary needs to.
 *
 * Errors compare by code, so `#DIV/0!` in two columns is one value and not
 * two objects. Everything else compares by identity, which is right for
 * numbers, text and booleans alike.
 */
function sameValue(a: Value, b: Value): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === "object" || typeof b === "object") {
    return (
      typeof a === "object" &&
      typeof b === "object" &&
      a.code === b.code
    );
  }
  return a === b;
}

/**
 * A collection of scenarios over one sheet.
 *
 * Nothing here holds a reference to the workbook: the same set can be run
 * against a sheet, then against a copy of it, which is the point of storing
 * addresses and text rather than anything live.
 */
export class ScenarioSet {
  private readonly byKey = new Map<string, Scenario>();

  get size(): number {
    return this.byKey.size;
  }

  /** Every scenario, in the order they were first defined. */
  list(): Scenario[] {
    return [...this.byKey.values()];
  }

  get(name: string): Scenario | undefined {
    return this.byKey.get(key(name));
  }

  has(name: string): boolean {
    return this.byKey.has(key(name));
  }

  /**
   * Define or replace a scenario.
   *
   * Addresses are normalised on the way in, so `$b$2` and `B2` are one
   * assumption rather than two that fight each other on apply. The last one
   * given wins, which is the only rule that makes a re-definition predictable.
   */
  define(
    name: string,
    assumptions: Iterable<readonly [Address, string]>,
  ): Scenario {
    const clean = normaliseName(name);
    const merged = new Map<string, string>();
    for (const [address, input] of assumptions) {
      try {
        merged.set(label(address), input);
      } catch (error) {
        if (error instanceof ReferenceError_) {
          throw new ScenarioError(`${String(address)} is not a cell`);
        }
        throw error;
      }
    }

    const scenario: Scenario = {
      name: clean,
      assumptions: [...merged].map(([address, input]) => ({ address, input })),
    };
    // Replacing keeps the original insertion position, so re-capturing a
    // scenario does not shuffle the summary's columns around.
    this.byKey.set(key(clean), scenario);
    return scenario;
  }

  /**
   * Record what a set of cells currently holds, as a named scenario.
   *
   * This is what makes the rest safe to use: without a captured base case
   * there is no way back after applying anything, and a feature you cannot
   * undo is a feature nobody tries.
   */
  capture(
    book: Workbook,
    name: string,
    addresses: Iterable<Address>,
  ): Scenario {
    return this.define(
      name,
      [...addresses].map(
        (address) => [address, book.getInput(label(address))] as const,
      ),
    );
  }

  delete(name: string): boolean {
    return this.byKey.delete(key(name));
  }

  clear(): void {
    this.byKey.clear();
  }

  /**
   * The formulas an apply would overwrite.
   *
   * Worth asking before writing rather than discovering afterwards: a scenario
   * captured while a cell held a number, applied after that cell has become a
   * formula, destroys the formula and looks like nothing happened.
   */
  conflicts(book: Workbook, name: string): ScenarioConflict[] {
    const scenario = this.require(name);
    const out: ScenarioConflict[] = [];
    for (const { address, input } of scenario.assumptions) {
      const formula = book.getFormula(address);
      if (formula === null || formula === input) continue;
      out.push({ address, formula });
    }
    return out;
  }

  /** Write a scenario into the sheet, as one undoable edit. */
  apply(book: Workbook, name: string): ApplyResult {
    const scenario = this.require(name);
    const overwrote = this.conflicts(book, name);

    const entries: Record<string, string> = {};
    for (const { address, input } of scenario.assumptions) {
      entries[address] = input;
    }
    book.setCells(entries);

    return {
      name: scenario.name,
      changed: scenario.assumptions.length,
      overwrote,
    };
  }

  /** What the results would come to under one scenario, changing nothing. */
  preview(
    book: Workbook,
    name: string,
    results: Iterable<Address>,
  ): Value[] {
    const scenario = this.require(name);
    const addresses = [...results].map(label);
    return book.trial(
      scenario.assumptions.map(
        ({ address, input }) => [address, input] as const,
      ),
      () => addresses.map((address) => book.getValue(address)),
    );
  }

  /**
   * Every scenario, read over the same results, side by side.
   *
   * The output the whole feature exists for. Each column is one trial, so the
   * sheet is not touched and the columns cannot influence one another — which
   * matters more than it sounds, because a summary computed by applying each
   * scenario in turn would report every column against the leftovers of the
   * one before it.
   */
  summarise(book: Workbook, results: Iterable<Address>): Summary {
    const addresses = [...results].map(label);
    const current = addresses.map((address) => book.getValue(address));

    const columns = this.list().map((scenario) => ({
      name: scenario.name,
      values: this.preview(book, scenario.name, addresses),
    }));

    // A row varies when the sheet as it stands and every column do not all
    // agree. The base case counts: a scenario that moves nothing is still
    // worth seeing next to one that does.
    const varying = addresses.filter((_address, row) => {
      const baseline = current[row] ?? null;
      return columns.some(
        (column) => !sameValue(column.values[row] ?? null, baseline),
      );
    });

    return { results: addresses, current, columns, varying };
  }

  /**
   * Move every assumption through a structural edit.
   *
   * A scenario is not part of the sheet, so inserting a row cannot move it the
   * way it moves the formulas. Left alone, a scenario captured against `B7`
   * would quietly start setting whatever landed at `B7` afterwards — the worst
   * kind of wrong, because nothing about it looks wrong.
   *
   * The addresses are rewritten with the same rule the cells and the names
   * move by, and an assumption whose cell was deleted is dropped rather than
   * clamped to the edge. Callers pass the same edit they gave the workbook,
   * after giving it: the two are separate objects and staying in step is the
   * caller's job, which is the price of keeping scenarios out of the sheet.
   */
  adjust(edit: StructuralEdit): void {
    for (const [mapKey, scenario] of this.byKey) {
      const moved: Assumption[] = [];
      for (const { address, input } of scenario.assumptions) {
        const target = adjustCoord(parseA1(address), edit);
        if (target === null) continue;
        moved.push({ address: label(target), input });
      }
      this.byKey.set(mapKey, { name: scenario.name, assumptions: moved });
    }
  }

  /**
   * Assumptions pointing at a cell the sheet currently has nothing in.
   *
   * Not an error on its own — a scenario is free to fill a blank — but after a
   * structural edit that went through without {@link adjust}, this is the
   * visible symptom.
   */
  missing(book: Workbook, name: string): string[] {
    return this.require(name)
      .assumptions.filter(
        ({ address, input }) => input !== "" && !book.has(address),
      )
      .map(({ address }) => address);
  }

  private require(name: string): Scenario {
    const scenario = this.get(name);
    if (scenario === undefined) {
      throw new ScenarioError(`no scenario called ${name.trim()}`);
    }
    return scenario;
  }
}
