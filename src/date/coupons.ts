/**
 * Coupon schedules.
 *
 * A bond's cash flows do not fall on a regular calendar grid; they fall on
 * dates generated *backwards* from maturity. That direction matters. Counting
 * forwards from issue leaves the last period a stub, and a bond's last period
 * is the one thing that is never a stub — the final coupon is paid with the
 * principal, on the day the bond matures.
 *
 * Everything a bond price needs about the calendar reduces to three numbers:
 * how many coupons are still to come, how far through the current coupon
 * period the settlement date sits, and how long that period is. The first two
 * are counts; the third is where the day-count basis enters, because "how long
 * is a coupon period" is a convention rather than a fact.
 */

import { addMonths, daysBetween } from "./serial.js";
import { basisDays } from "./daycount.js";
import type { DayCountBasis } from "./daycount.js";

/** The coupon frequencies a bond may pay at: annual, semi-annual, quarterly. */
export const COUPON_FREQUENCIES = [1, 2, 4] as const;

export type CouponFrequency = (typeof COUPON_FREQUENCIES)[number];

export function isCouponFrequency(n: number): n is CouponFrequency {
  return n === 1 || n === 2 || n === 4;
}

/** Where a settlement date sits inside the coupon period that contains it. */
export interface CouponPosition {
  /** The coupon date on or before settlement. */
  readonly previous: number;
  /** The coupon date after settlement. */
  readonly next: number;
  /** Coupons still to be paid, settlement exclusive, maturity inclusive. */
  readonly count: number;
  /** Days from the previous coupon to settlement, on the basis. */
  readonly daysBefore: number;
  /** Length of the coupon period containing settlement, on the basis. */
  readonly periodDays: number;
  /** Days from settlement to the next coupon; `periodDays - daysBefore`. */
  readonly daysAfter: number;
}

/**
 * The `i`-th coupon date counting back from maturity.
 *
 * Always derived from maturity rather than stepped from the previous date, so
 * a bond maturing on the 31st does not walk itself off month ends: a single
 * clamp from the 31st into February is recoverable, a chain of them is not.
 */
export function couponDateBack(
  maturity: number,
  frequency: CouponFrequency,
  steps: number,
): number {
  return addMonths(maturity, (-12 / frequency) * steps);
}

/**
 * How many coupons remain after `settlement`.
 *
 * Counted rather than computed from a month difference, because the clamping
 * that keeps a month-end schedule on month ends means the arithmetic and the
 * calendar can disagree by a day at exactly the dates that matter.
 */
export function couponsRemaining(
  settlement: number,
  maturity: number,
  frequency: CouponFrequency,
): number {
  // Bound the walk: a coupon period is at least three months, so a bond can
  // hold at most four coupons per year of term, and the term is bounded by the
  // representable date range.
  const maxSteps = Math.ceil(daysBetween(settlement, maturity) / 80) + 2;
  let count = 0;
  for (let step = 0; step < maxSteps; step++) {
    if (couponDateBack(maturity, frequency, step) <= settlement) break;
    count += 1;
  }
  return count;
}

/**
 * The length of the coupon period containing settlement, on a basis.
 *
 * The 30/360 and money-market bases define a year and divide it: a semi-annual
 * period is 180 days on 30/360 whether or not 180 days pass. Only actual/actual
 * measures the period that is actually there, which is why a bond quoted on
 * basis 1 has coupon periods of different lengths through the year.
 */
export function couponPeriodDays(
  previous: number,
  next: number,
  frequency: CouponFrequency,
  basis: DayCountBasis,
): number {
  switch (basis) {
    case 1:
      return daysBetween(previous, next);
    case 3:
      return 365 / frequency;
    default:
      return 360 / frequency;
  }
}

/**
 * Locate a settlement date inside its coupon period.
 *
 * `daysAfter` is derived by subtraction rather than measured, so that
 * `daysBefore + daysAfter` is exactly `periodDays`. A price formula divides
 * both by the period length and treats the results as a position in `[0, 1]`;
 * measuring each end independently on a 30/360 basis lets that pair miss 1 by
 * a day, and the discount exponent then steps in a way nothing in the bond did.
 */
export function couponPosition(
  settlement: number,
  maturity: number,
  frequency: CouponFrequency,
  basis: DayCountBasis,
): CouponPosition {
  const count = couponsRemaining(settlement, maturity, frequency);
  const next = couponDateBack(maturity, frequency, count - 1);
  const previous = couponDateBack(maturity, frequency, count);
  const periodDays = couponPeriodDays(previous, next, frequency, basis);
  const daysBefore =
    basis === 1
      ? daysBetween(previous, settlement)
      : basisDays(previous, settlement, basis);
  return {
    previous,
    next,
    count,
    daysBefore,
    periodDays,
    daysAfter: periodDays - daysBefore,
  };
}
