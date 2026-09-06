/**
 * `.ttest` — compare two columns of the sheet without writing a formula.
 *
 * `T.TEST` returns one number, which is the right shape for a cell and the
 * wrong shape for a person deciding something. A bare `0.196` does not say
 * whether the two means differed by a lot or a little, how many observations
 * stood behind it, or which of the three tests produced it — and those are
 * exactly the things that change the reading. This lays all of it out.
 *
 * The three kinds are named rather than numbered. `T.TEST(...,1)` has to be
 * looked up; `paired` does not.
 */

import { matrix, numericRows } from "../engine/array.js";
import { isFormulaError } from "../engine/errors.js";
import {
  formatRange,
  iterateRange,
  normalizeRange,
  parseA1Range,
  rangeHeight,
  rangeWidth,
} from "../engine/reference.js";
import type { RangeRef } from "../engine/reference.js";
import type { Workbook } from "../engine/workbook.js";
import {
  pairedT,
  pooledT,
  sampleMean,
  sampleVariance,
  welchT,
} from "../numeric/inference.js";
import type { TTestResult } from "../numeric/inference.js";

export type TTestKind = "paired" | "pooled" | "welch";

export interface TTestCommand {
  readonly first: RangeRef;
  readonly second: RangeRef;
  readonly kind: TTestKind;
  readonly tails: 1 | 2;
}

export const TTEST_USAGE =
  "usage: .ttest A1:A9 vs B1:B9 [paired|pooled|welch] [one-tailed]";

/**
 * `<range> vs <range> [paired|pooled|welch] [one-tailed]`
 *
 * Welch is the default rather than the pooled test. Pooling assumes the two
 * samples share a variance, and when they do not — which is the ordinary case
 * for two groups of different sizes — it reports a smaller p-value than the
 * evidence supports. Welch costs nothing when the assumption does hold, since
 * the two then agree, so the safe one is the one that does not have to be
 * asked for.
 */
export function parseTTestCommand(tail: string): TTestCommand | string {
  const text = tail.trim();
  const match = /^(\S+)\s+vs\s+(\S+)((?:\s+\S+)*)$/i.exec(text);
  if (match === null) return TTEST_USAGE;

  let first: RangeRef;
  let second: RangeRef;
  try {
    first = parseA1Range(match[1]!);
    second = parseA1Range(match[2]!);
  } catch {
    return "both arguments have to be blocks, like A1:A9";
  }

  let kind: TTestKind = "welch";
  let tails: 1 | 2 = 2;
  for (const word of (match[3] ?? "").trim().split(/\s+/).filter(Boolean)) {
    const lower = word.toLowerCase();
    if (lower === "paired" || lower === "pooled" || lower === "welch") {
      kind = lower;
    } else if (lower === "one-tailed" || lower === "one") {
      tails = 1;
    } else if (lower === "two-tailed" || lower === "two") {
      tails = 2;
    } else {
      return `${word} is not one of paired, pooled, welch or one-tailed`;
    }
  }
  return { first, second, kind, tails };
}

export class TTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TTestError";
  }
}

function columnOf(book: Workbook, range: RangeRef): number[] {
  const normalized = normalizeRange(range);
  const flat = [...iterateRange(normalized)].map((coord) =>
    book.getValue(coord),
  );
  const rows = numericRows(
    matrix(rangeHeight(normalized), rangeWidth(normalized), flat),
  );
  if (isFormulaError(rows)) {
    throw new TTestError(
      `${formatRange(normalized)} has to hold numbers and nothing else`,
    );
  }
  return rows.flat();
}

export interface TTestReport {
  readonly kind: TTestKind;
  readonly tails: 1 | 2;
  readonly first: SampleSummary;
  readonly second: SampleSummary;
  readonly difference: number;
  readonly t: number;
  readonly df: number;
  readonly p: number;
}

export interface SampleSummary {
  readonly label: string;
  readonly count: number;
  readonly mean: number;
  readonly variance: number;
}

export function runTTest(
  book: Workbook,
  command: TTestCommand,
): TTestReport {
  const a = columnOf(book, command.first);
  const b = columnOf(book, command.second);
  if (a.length < 2 || b.length < 2) {
    throw new TTestError("each sample needs at least two observations");
  }
  if (command.kind === "paired" && a.length !== b.length) {
    throw new TTestError(
      `a paired test needs the same count on both sides; ${formatRange(command.first)} has ${a.length} and ${formatRange(command.second)} has ${b.length}`,
    );
  }

  let result: TTestResult;
  if (command.kind === "paired") result = pairedT(a, b);
  else if (command.kind === "pooled") result = pooledT(a, b);
  else result = welchT(a, b);

  return {
    kind: command.kind,
    tails: command.tails,
    first: {
      label: formatRange(normalizeRange(command.first)),
      count: a.length,
      mean: sampleMean(a),
      variance: sampleVariance(a),
    },
    second: {
      label: formatRange(normalizeRange(command.second)),
      count: b.length,
      mean: sampleMean(b),
      variance: sampleVariance(b),
    },
    difference: sampleMean(a) - sampleMean(b),
    t: result.t,
    df: result.df,
    p: command.tails === 1 ? result.p / 2 : result.p,
  };
}
