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

import {
  addMonths,
  civilFromSerial,
  daysBetween,
  endOfMonth,
  isMonthEnd,
} from "./serial.js";
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
 * True when a bond's schedule is anchored to month ends.
 *
 * The anchor is maturity and nothing else. A bond maturing 30 September pays
 * on month ends; a bond maturing 29 September, in the same month, does not —
 * one day apart on the calendar and a different convention, which is what
 * makes this a predicate rather than a tolerance.
 */
export function isMonthEndSchedule(maturity: number): boolean {
  return isMonthEnd(maturity);
}

/**
 * The `i`-th coupon date counting back from maturity.
 *
 * Two rules, and maturity alone decides which. A maturity inside its month
 * keeps its day of the month, clamped where the target month is short: a bond
 * maturing on the 30th pays on the 30th, and on the 28th or 29th of a
 * February. A maturity *on* its month's last day instead puts every coupon on
 * a month end, which is the convention a month-end bond is issued under — 28
 * February pairs with 31 August, not with 28 August.
 *
 * Without that second rule the first one produces the right answer for a
 * maturity on the 31st and the wrong one for every other month end, since
 * clamping the 31st into a short month happens to land on its end. Two bonds
 * both maturing on a month end would then be put on schedules under two
 * conventions, chosen by which month it happened to be. The engine's own
 * day-count code assumes they are not: `YEARFRAC` basis 0 carries a February
 * rule so that 28 February to 31 August is a clean 180 days, a rule written
 * for a pair of dates the schedule would otherwise never generate.
 *
 * Either way the date is derived from maturity rather than stepped from its
 * neighbour, so no clamp compounds: one clamp from the 31st into February is
 * recoverable, a chain of them is not.
 */
export function couponDateBack(
  maturity: number,
  frequency: CouponFrequency,
  steps: number,
): number {
  const stepped = addMonths(maturity, (-12 / frequency) * steps);
  return isMonthEndSchedule(maturity) ? endOfMonth(stepped) : stepped;
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
 * The step whose coupon date is the last one on or before `date`.
 *
 * Found by estimating from the month difference and then walking, because the
 * month arithmetic and the calendar disagree by a few days wherever a clamp or
 * the end-of-month rule moved a boundary — never by a whole period, which is
 * what makes one step of slack enough to start from. Negative steps are
 * ordinary: a quasi-coupon schedule runs forwards from its anchor as readily
 * as backwards.
 */
export function stepAtOrBefore(
  anchor: number,
  frequency: CouponFrequency,
  date: number,
): number {
  const monthsPerPeriod = 12 / frequency;
  const a = civilFromSerial(anchor);
  const d = civilFromSerial(date);
  const months = (a.year - d.year) * 12 + (a.month - d.month);
  let step = Math.ceil(months / monthsPerPeriod) + 1;
  // The estimate is meant to be past `date`; nudge it out if a clamp left it
  // short. Bounded, so a pathological anchor cannot spin here.
  for (let guard = 0; guard < 8 && couponDateBack(anchor, frequency, step) > date; guard += 1) {
    step += 1;
  }
  for (let guard = 0; guard < 8 && couponDateBack(anchor, frequency, step - 1) <= date; guard += 1) {
    step -= 1;
  }
  return step;
}

/** A stretch of an accrual that falls inside one quasi-coupon period. */
export interface AccrualSpan {
  /** Start of the accrued stretch: the accrual's own start, or a period start. */
  readonly from: number;
  /** End of the accrued stretch: a period end, or the accrual's own end. */
  readonly to: number;
  /** The quasi-coupon date the containing period opens on. */
  readonly periodStart: number;
  /** The quasi-coupon date it closes on. */
  readonly periodEnd: number;
}

/**
 * An accrual broken at every quasi-coupon date it crosses.
 *
 * "Quasi-coupon" because these are the dates a bond's coupon schedule *would*
 * fall on, extended through a stretch where no coupon is actually paid — the
 * period between issue and the first interest date, which may be longer or
 * shorter than a regular one. Interest over that stretch is still quoted as a
 * fraction of a coupon period, so the question "how far through a period is
 * this" has to be answered for each period the accrual touches rather than
 * once for the whole span.
 *
 * The anchor is the first interest date, since that is the one date on the
 * regular schedule that the instrument states. Dates are generated by the same
 * function a priced bond's schedule uses, so the end-of-month rule applies
 * here too: a first interest date on a month end puts every quasi-coupon date
 * on a month end.
 *
 * Spans are returned in order and tile `[from, to]` exactly — no gaps, no
 * overlaps — which is the invariant that makes summing them a day count rather
 * than an approximation of one.
 */
export function quasiCouponSpans(
  from: number,
  to: number,
  anchor: number,
  frequency: CouponFrequency,
): readonly AccrualSpan[] {
  if (to <= from) return [];
  const spans: AccrualSpan[] = [];
  const first = stepAtOrBefore(anchor, frequency, from);
  // One period is at least three months, so the walk is bounded by the span.
  const maxSpans = Math.ceil(daysBetween(from, to) / 80) + 2;
  for (let index = 0; index < maxSpans; index += 1) {
    const step = first - index;
    const periodStart = couponDateBack(anchor, frequency, step);
    const periodEnd = couponDateBack(anchor, frequency, step - 1);
    const start = Math.max(periodStart, from);
    const end = Math.min(periodEnd, to);
    if (end > start) spans.push({ from: start, to: end, periodStart, periodEnd });
    if (periodEnd >= to) break;
  }
  return spans;
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
