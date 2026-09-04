/**
 * Day-count conventions.
 *
 * Two parties can agree on a start date, an end date and a rate and still
 * disagree on the interest, because "a year" is a matter of convention. A bond
 * quoted on 30/360 counts every month as thirty days; a money-market
 * instrument on actual/360 counts real days but divides by a year that is five
 * days short. The five bases below are the ones spreadsheets number 0–4, and
 * they are the vocabulary `YEARFRAC`, `XNPV`, accrued interest and every bond
 * price in this engine speak.
 *
 * The 30/360 family is the interesting part. Both variants slide the day
 * numbers onto a 360-day grid before subtracting, and they disagree about what
 * to do at a month end — which is exactly where real coupon dates fall.
 */

import {
  civilFromSerial,
  daysBetween,
  daysInMonth,
  daysInYear,
  isLeapYear,
  serialFromCivil,
} from "./serial.js";
import type { CivilDate } from "./serial.js";

/** The basis numbers spreadsheets use, in their conventional order. */
export const DAY_COUNT_BASES = [0, 1, 2, 3, 4] as const;

export type DayCountBasis = (typeof DAY_COUNT_BASES)[number];

export function isDayCountBasis(n: number): n is DayCountBasis {
  return Number.isInteger(n) && n >= 0 && n <= 4;
}

/** A human name for a basis, for help text and error messages. */
export const BASIS_NAMES: Readonly<Record<DayCountBasis, string>> = {
  0: "30/360 US (NASD)",
  1: "actual/actual",
  2: "actual/360",
  3: "actual/365",
  4: "30/360 European",
};

/**
 * Days between two dates on a 360-day grid.
 *
 * `european` picks the simpler rule: any 31st becomes a 30th, on either end,
 * and nothing else is special. The US rule instead treats the second date's
 * 31st as a 30th only when the first date has already been pulled back to a
 * 30th, so that a stub from, say, the 15th to the 31st keeps its extra day.
 *
 * `februaryRule` is the difference between `DAYS360` and `YEARFRAC` basis 0.
 * `YEARFRAC` additionally treats a February month end as a 30th — so
 * 28 February to 31 August is a clean 180 days — while `DAYS360` never has,
 * and both behaviours have to be reproducible from the same code.
 */
export function days360(
  start: number,
  end: number,
  options: { european?: boolean; februaryRule?: boolean } = {},
): number {
  const { european = false, februaryRule = false } = options;
  const a = civilFromSerial(start);
  const b = civilFromSerial(end);
  let d1 = a.day;
  let d2 = b.day;

  if (european) {
    if (d1 === 31) d1 = 30;
    if (d2 === 31) d2 = 30;
  } else {
    if (februaryRule && isFebruaryEnd(a)) {
      if (isFebruaryEnd(b)) d2 = 30;
      d1 = 30;
    }
    if (d2 === 31 && d1 >= 30) d2 = 30;
    if (d1 === 31) d1 = 30;
  }

  return (b.year - a.year) * 360 + (b.month - a.month) * 30 + (d2 - d1);
}

function isFebruaryEnd(date: CivilDate): boolean {
  return date.month === 2 && date.day === daysInMonth(date.year, 2);
}

/** Elapsed calendar days, which bases 1, 2 and 3 all count the same way. */
export function actualDays(start: number, end: number): number {
  return daysBetween(start, end);
}

/**
 * The denominator basis 1 divides by.
 *
 * Actual/actual has no single year length, so the convention picks one. For a
 * span of a year or less it asks whether a 29 February falls inside the span
 * and answers 366 or 365. For a longer span it averages the lengths of every
 * calendar year the span touches, endpoints included, which is what keeps a
 * multi-year fraction from drifting against the number of leap days actually
 * crossed.
 */
export function actualYearLength(start: number, end: number): number {
  const a = civilFromSerial(start);
  const b = civilFromSerial(end);
  const withinOneYear =
    a.year === b.year ||
    (b.year === a.year + 1 &&
      (a.month > b.month || (a.month === b.month && a.day >= b.day)));

  if (!withinOneYear) {
    let total = 0;
    for (let year = a.year; year <= b.year; year++) total += daysInYear(year);
    return total / (b.year - a.year + 1);
  }

  if (a.year === b.year && isLeapYear(a.year)) return 366;
  if (spansLeapDay(a.year, start, end) || spansLeapDay(b.year, start, end)) {
    return 366;
  }
  return 365;
}

function spansLeapDay(year: number, start: number, end: number): boolean {
  if (!isLeapYear(year)) return false;
  const leapDay = serialFromCivil(year, 2, 29);
  return start <= leapDay && leapDay <= end;
}

/**
 * The fraction of a year between two dates on a given basis.
 *
 * The dates are ordered before counting, so the result is never negative —
 * a fraction of a year is a length, and the sign of a period belongs to the
 * caller that knows which way round it meant them.
 */
export function yearFraction(
  startSerial: number,
  endSerial: number,
  basis: DayCountBasis,
): number {
  const start = Math.min(startSerial, endSerial);
  const end = Math.max(startSerial, endSerial);
  if (start === end) return 0;

  switch (basis) {
    case 0:
      return days360(start, end, { februaryRule: true }) / 360;
    case 1:
      return actualDays(start, end) / actualYearLength(start, end);
    case 2:
      return actualDays(start, end) / 360;
    case 3:
      return actualDays(start, end) / 365;
    case 4:
      return days360(start, end, { european: true }) / 360;
  }
}

/** Days in the notional year a basis divides by, for a given span. */
export function basisYearLength(
  startSerial: number,
  endSerial: number,
  basis: DayCountBasis,
): number {
  switch (basis) {
    case 0:
    case 4:
      return 360;
    case 1:
      return actualYearLength(
        Math.min(startSerial, endSerial),
        Math.max(startSerial, endSerial),
      );
    case 2:
      return 360;
    case 3:
      return 365;
  }
}

/** Days between two dates counted the way the basis counts them. */
export function basisDays(
  start: number,
  end: number,
  basis: DayCountBasis,
): number {
  switch (basis) {
    case 0:
      return days360(start, end, { februaryRule: true });
    case 4:
      return days360(start, end, { european: true });
    default:
      return actualDays(start, end);
  }
}
