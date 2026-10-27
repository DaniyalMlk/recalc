/**
 * A coupon schedule from outside this package.
 *
 * Every other check on the coupon family compares the engine with the
 * arithmetic the engine is made of: the period closes, the counts agree, the
 * dates step evenly. None of that can catch a *convention* error, because a
 * schedule built on the wrong rule is perfectly self-consistent. Only a
 * reference settles it.
 *
 * The table below is transcribed from a published transcript of a reference
 * spreadsheet's `COUPPCD` and `COUPNCD` output (PHPOffice/PhpSpreadsheet issue
 * 1265, which records the figures while reporting a discrepancy against them).
 * Its value is in how it is laid out rather than in its size: each block walks
 * a maturity down through a month end and out the other side, so the rule's
 * *boundary* is pinned and not only its interior. A schedule generator that
 * applied the month-end rule one day too widely — to the 29th as well as the
 * 30th — would satisfy a table of month ends alone and fail here.
 *
 * Three of the blocks cover the cases where the two rules disagree on the
 * calendar: a September month end whose day is not the 31st, a February month
 * end in a common year, and a February month end in a leap year. The fourth
 * covers the one a day-of-month clamp gets right by accident, maturity on the
 * 31st, which is why the defect this table found could hide behind a test
 * named for it.
 */

import { serialFromCivil } from "../src/date/serial.js";
import type { CouponFrequency } from "../src/date/coupons.js";
import type { DayCountBasis } from "../src/date/daycount.js";

/** One line of the reference transcript. */
export interface CouponCase {
  /** What the block is demonstrating, for a failure message. */
  readonly block: string;
  readonly settlement: number;
  readonly maturity: number;
  readonly frequency: CouponFrequency;
  readonly basis: DayCountBasis;
  /** The reference's `COUPPCD`. */
  readonly previous: number;
  /** The reference's `COUPNCD`. */
  readonly next: number;
}

const date = (year: number, month: number, day: number): number =>
  serialFromCivil(year, month, day);

/** A block of maturities walking across one month end, settlement held fixed. */
function block(
  name: string,
  settlement: readonly [number, number, number],
  rows: readonly (readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ])[],
): readonly CouponCase[] {
  return rows.map(([maturity, previous, next]) => ({
    block: name,
    settlement: date(...settlement),
    maturity: date(...maturity),
    frequency: 2 as CouponFrequency,
    basis: 4 as DayCountBasis,
    previous: date(...previous),
    next: date(...next),
  }));
}

/**
 * The transcript, every row a maturity and the two coupon dates around it.
 *
 * Read down a block: the first row is past the month end, the second is on it,
 * and the rest walk back into the month. Only the second row of a block is
 * under the month-end rule, and the row above and below it are what say so.
 */
export const COUPON_REFERENCE: readonly CouponCase[] = [
  ...block("a September month end, maturity below the 31st", [2019, 5, 1], [
    [[2019, 10, 1], [2019, 4, 1], [2019, 10, 1]],
    [[2019, 9, 30], [2019, 3, 31], [2019, 9, 30]],
    [[2019, 9, 29], [2019, 3, 29], [2019, 9, 29]],
    [[2019, 9, 28], [2019, 3, 28], [2019, 9, 28]],
    [[2019, 9, 27], [2019, 3, 27], [2019, 9, 27]],
    [[2019, 9, 26], [2019, 3, 26], [2019, 9, 26]],
  ]),
  ...block("a February month end in a common year", [2010, 5, 1], [
    [[2013, 3, 1], [2010, 3, 1], [2010, 9, 1]],
    [[2013, 2, 28], [2010, 2, 28], [2010, 8, 31]],
    [[2013, 2, 27], [2010, 2, 27], [2010, 8, 27]],
    [[2013, 2, 26], [2010, 2, 26], [2010, 8, 26]],
    [[2013, 2, 25], [2010, 2, 25], [2010, 8, 25]],
    [[2013, 2, 24], [2010, 2, 24], [2010, 8, 24]],
  ]),
  ...block("a February month end in a leap year", [2010, 5, 1], [
    [[2012, 3, 1], [2010, 3, 1], [2010, 9, 1]],
    [[2012, 2, 29], [2010, 2, 28], [2010, 8, 31]],
    // 28 February 2012 is *not* a month end, and is scheduled by the clamp:
    // the pair below the leap day is the row that separates the two rules.
    [[2012, 2, 28], [2010, 2, 28], [2010, 8, 28]],
    [[2012, 2, 27], [2010, 2, 27], [2010, 8, 27]],
    [[2012, 2, 26], [2010, 2, 26], [2010, 8, 26]],
    [[2012, 2, 25], [2010, 2, 25], [2010, 8, 25]],
  ]),
  ...block("an August month end, the case a clamp gets right", [2010, 5, 1], [
    [[2012, 9, 1], [2010, 3, 1], [2010, 9, 1]],
    [[2012, 8, 31], [2010, 2, 28], [2010, 8, 31]],
    [[2012, 8, 30], [2010, 2, 28], [2010, 8, 30]],
    [[2012, 8, 29], [2010, 2, 28], [2010, 8, 29]],
    [[2012, 8, 28], [2010, 2, 28], [2010, 8, 28]],
    [[2012, 8, 27], [2010, 2, 27], [2010, 8, 27]],
  ]),
];
