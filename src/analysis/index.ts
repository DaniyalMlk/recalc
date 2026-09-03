/**
 * What-if analysis: the two questions a model exists to answer.
 *
 * Everything here is built on `Workbook.trial`, so no analysis can leave a
 * mark on the sheet it was run over. The one exception is stated in its name:
 * `applyGoalSeek` writes the answer it found, as one undoable edit.
 */

export { applyGoalSeek, goalSeek } from "./goalseek.js";
export type {
  GoalSeekProblem,
  GoalSeekRequest,
  GoalSeekResult,
} from "./goalseek.js";

export { parseAxis } from "./axis.js";

export { findRoot, scaleStep } from "./solve.js";
export type { RootOptions, SolveFailure, SolveOutcome } from "./solve.js";

export {
  MAX_TABLE_CELLS,
  TableError,
  around,
  oneWayTable,
  series,
  twoWayTable,
  writeOneWayTable,
  writeTwoWayTable,
} from "./table.js";
export type {
  OneWayRequest,
  OneWayTable,
  TwoWayRequest,
  TwoWayTable,
} from "./table.js";

export { ScenarioError, ScenarioSet } from "./scenarios.js";
export type {
  ApplyResult,
  Assumption,
  Scenario,
  ScenarioConflict,
  Summary,
  SummaryColumn,
} from "./scenarios.js";
