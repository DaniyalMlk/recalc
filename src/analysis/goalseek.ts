/**
 * Goal seek: what input makes this output equal that?
 *
 * The search is the easy half. The valuable half is refusing to search when
 * the question is malformed, and saying which way it was malformed. A goal
 * seek that grinds through four hundred recalculations and reports "did not
 * converge" is indistinguishable, to whoever asked, from one where the target
 * simply does not read the cell being changed - and those two answers call for
 * completely different responses. The dependency graph already knows the
 * difference, so it is asked first.
 */

import { isFormulaError } from "../engine/errors.js";
import { formatA1, parseA1 } from "../engine/reference.js";
import type { Coord } from "../engine/reference.js";
import type { Address, Workbook } from "../engine/workbook.js";
import { findRoot } from "./solve.js";
import type { SolveFailure } from "./solve.js";

/** Why a goal seek could not be attempted or did not succeed. */
export type GoalSeekProblem =
  /** The changing cell holds a formula, so overwriting it would be an edit. */
  | "changing-is-formula"
  /** The changing cell holds something that is not a number. */
  | "changing-not-numeric"
  /** The target cell holds no formula, so nothing about it can move. */
  | "target-not-formula"
  /** The target does not read the changing cell, directly or indirectly. */
  | "target-independent"
  /** The target is an error or non-numeric at its current input. */
  | "target-not-numeric"
  /** The target never reached the goal. */
  | "no-convergence";

export interface GoalSeekRequest {
  /** The formula cell whose value is being aimed at. */
  readonly target: Address;
  /** The value it should reach. */
  readonly to: number;
  /** The input cell to vary. */
  readonly changing: Address;
  /** How close counts as arrived. Defaults to a relative-to-goal tolerance. */
  readonly tolerance?: number;
  /** Cap on recalculations. */
  readonly maxEvaluations?: number;
  /** Bounds on the input, when the model only makes sense inside them. */
  readonly lower?: number;
  readonly upper?: number;
}

export interface GoalSeekResult {
  readonly converged: boolean;
  /** The input value found, or the closest one tried. */
  readonly value: number;
  /** What the target reached there. */
  readonly achieved: number;
  /** The input the changing cell started from. */
  readonly startedFrom: number;
  /** How many times the sheet was recalculated. */
  readonly evaluations: number;
  readonly problem?: GoalSeekProblem;
  /** A sentence explaining a failure, ready to show. */
  readonly message?: string;
}

/**
 * The default tolerance, scaled to the goal.
 *
 * An absolute tolerance is wrong in both directions: 1e-9 is unreachable when
 * the goal is 8,500,000 and floating-point noise alone exceeds it, while being
 * far looser than needed when the goal is 0.03. Ten significant figures either
 * way is the same statement about precision at any magnitude.
 */
function defaultTolerance(goal: number): number {
  return Math.max(Math.abs(goal), 1) * 1e-10;
}

function numericOr(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function label(coord: Coord): string {
  return formatA1({ ...coord, colAbsolute: false, rowAbsolute: false });
}

function toCoord(address: Address): Coord {
  return typeof address === "string" ? parseA1(address) : address;
}

const MESSAGES: Record<GoalSeekProblem, (a: string, b: string) => string> = {
  "changing-is-formula": (changing) =>
    `${changing} holds a formula; goal seek can only vary a cell that holds a value`,
  "changing-not-numeric": (changing) =>
    `${changing} does not hold a number`,
  "target-not-formula": (_changing, target) =>
    `${target} holds a value rather than a formula, so nothing can move it`,
  "target-independent": (changing, target) =>
    `${target} does not depend on ${changing}, so changing it cannot move the result`,
  "target-not-numeric": (_changing, target) =>
    `${target} is not a number at the current input`,
  "no-convergence": (changing, target) =>
    `no value of ${changing} brought ${target} to the goal`,
};

/**
 * Solve for the input that brings `target` to `to`.
 *
 * The sheet is left exactly as it was found, whatever the outcome: a converged
 * search reports the answer rather than applying it, so a caller can show the
 * value and let someone decide. {@link applyGoalSeek} is the one that commits.
 */
export function goalSeek(
  book: Workbook,
  request: GoalSeekRequest,
): GoalSeekResult {
  const changing = toCoord(request.changing);
  const target = toCoord(request.target);
  const changingLabel = label(changing);
  const targetLabel = label(target);

  const fail = (
    problem: GoalSeekProblem,
    startedFrom: number,
    value = startedFrom,
    achieved = Number.NaN,
    evaluations = 0,
  ): GoalSeekResult => ({
    converged: false,
    value,
    achieved,
    startedFrom,
    evaluations,
    problem,
    message: MESSAGES[problem](changingLabel, targetLabel),
  });

  const startInput = book.getInput(changingLabel);
  const start = numericOr(book.getValue(changingLabel)) ?? 0;

  if (startInput.startsWith("=")) return fail("changing-is-formula", start);
  if (startInput !== "" && numericOr(book.getValue(changingLabel)) === null) {
    return fail("changing-not-numeric", start);
  }
  if (book.getFormula(targetLabel) === null) {
    return fail("target-not-formula", start);
  }
  if (!book.dependsOn(targetLabel, changingLabel)) {
    return fail("target-independent", start);
  }

  const current = book.getValue(targetLabel);
  if (numericOr(current) === null && !isFormulaError(current)) {
    return fail("target-not-numeric", start);
  }

  const goal = request.to;
  const tolerance = request.tolerance ?? defaultTolerance(goal);

  // Each evaluation is one incremental recalculation of the sheet under a
  // trial value. Nothing here is journalled and nothing survives the call.
  const outcome = findRoot(
    (x) => {
      const value = book.probe([[changingLabel, String(x)]], targetLabel);
      const numeric = numericOr(value);
      return numeric === null ? Number.NaN : numeric - goal;
    },
    {
      start,
      tolerance,
      ...(request.maxEvaluations === undefined
        ? {}
        : { maxEvaluations: request.maxEvaluations }),
      ...(request.lower === undefined ? {} : { lower: request.lower }),
      ...(request.upper === undefined ? {} : { upper: request.upper }),
    },
  );

  const achieved = Number.isNaN(outcome.fx) ? Number.NaN : outcome.fx + goal;

  if (outcome.converged) {
    return {
      converged: true,
      value: outcome.x,
      achieved,
      startedFrom: start,
      evaluations: outcome.evaluations,
    };
  }

  const problem: GoalSeekProblem =
    outcome.failure === "not-numeric" ? "target-not-numeric" : "no-convergence";
  return fail(problem, start, outcome.x, achieved, outcome.evaluations);
}

/** What the solver could not do, in the solver's own words. */
export type { SolveFailure };

/**
 * Goal seek, and write the answer into the changing cell.
 *
 * The write goes through the ordinary edit path, so it is one undoable step
 * with a label that says what it was — the whole point of committing here
 * rather than making the caller do it. A search that failed writes nothing.
 */
export function applyGoalSeek(
  book: Workbook,
  request: GoalSeekRequest,
): GoalSeekResult {
  const result = goalSeek(book, request);
  if (!result.converged) return result;
  book.setCell(request.changing, result.value);
  return result;
}
