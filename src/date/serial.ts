/**
 * The serial date system.
 *
 * A spreadsheet stores a date as a number: whole days since an epoch, with the
 * fractional part carrying the time of day. Everything downstream — arithmetic
 * on dates, day-count conventions, date format codes — is ordinary numeric work
 * once this module has settled what a serial means.
 *
 * The convention implemented here is the 1900 system, serial 1 being
 * 1900-01-01. It contains a famous defect: serial 60 is 1900-02-29, a day that
 * did not exist, carried since the first spreadsheets copied it from each other
 * for file compatibility. This engine reproduces it rather than quietly
 * correcting it, because a serial is an interchange value — a workbook that
 * corrected the phantom day would disagree by one with every other spreadsheet
 * for the two months where the bug is visible.
 *
 * Reproducing it properly means going all the way: the system behaves as if a
 * calendar containing 29 February 1900 were real. Serials and that calendar are
 * in bijection, so the difference between two dates is the difference between
 * their serials, always, with no correction anywhere. The cost is paid once, at
 * the boundary — 1900-01-01 reports as a Sunday when it was in fact a Monday,
 * because the weekday cycle is anchored so that every date after 1900-02-28,
 * which is to say every date anyone models, comes out right.
 */

/** 1899-12-30, the anchor that makes serial 61 fall on 1900-03-01. */
const ANCHOR_DAYS = daysFromCivil(1899, 12, 30);

/** The serial spreadsheets assign to the day that never happened. */
export const PHANTOM_LEAP_SERIAL = 60;

/** 9999-12-31, the last date the 1900 system addresses. */
export const MAX_SERIAL = 2958465;

/** A calendar date, with month and day one-based. */
export interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** A time of day split out of a serial's fractional part. */
export interface ClockTime {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return MONTH_LENGTHS[month - 1] ?? 0;
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/**
 * Days from 1970-01-01 for a proleptic Gregorian date, after Howard Hinnant's
 * `days_from_civil`. Chosen over `Date.UTC` because it stays exact for years
 * outside the range a `Date` handles comfortably and never consults a timezone.
 *
 * Out-of-range months and days are normalised the way a spreadsheet's `DATE`
 * normalises them: month 13 rolls into the next year, day 0 is the last day of
 * the previous month.
 */
export function daysFromCivil(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  // Normalise the month first so the year is settled before the day is added.
  const monthIndex = m - 1;
  y += Math.floor(monthIndex / 12);
  m = ((monthIndex % 12) + 12) % 12 + 1;

  const shifted = m <= 2 ? y - 1 : y;
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear =
    Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + 1 - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  // `day` is added last and unclamped, which is what makes day 0 and day 32
  // roll into the neighbouring months.
  return era * 146097 + dayOfEra - 719468 + (day - 1);
}

/** The inverse of {@link daysFromCivil}, after Hinnant's `civil_from_days`. */
export function civilFromDays(days: number): CivilDate {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) / 365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: month <= 2 ? year + 1 : year, month, day };
}

/**
 * The serial for a calendar date, normalising out-of-range parts.
 *
 * 1900-02-29 is accepted and answers the phantom serial, so that a round trip
 * through {@link civilFromSerial} is stable for every serial the system can
 * produce.
 */
export function serialFromCivil(year: number, month: number, day: number): number {
  if (year === 1900 && month === 2 && day === 29) return PHANTOM_LEAP_SERIAL;
  const index = daysFromCivil(year, month, day) - ANCHOR_DAYS;
  return index >= PHANTOM_LEAP_SERIAL + 1 ? index : index - 1;
}

/** The calendar date a whole serial names. */
export function civilFromSerial(serial: number): CivilDate {
  const whole = Math.floor(serial);
  if (whole === PHANTOM_LEAP_SERIAL) return { year: 1900, month: 2, day: 29 };
  if (whole === 0) return { year: 1900, month: 1, day: 0 };
  const index = whole > PHANTOM_LEAP_SERIAL ? whole : whole + 1;
  return civilFromDays(index + ANCHOR_DAYS);
}

/**
 * Days between two serials.
 *
 * Plain subtraction, which is the whole point of a serial system: the calendar
 * the serials describe includes the phantom day, so no correction is owed and
 * every day-count in the engine can be a difference of two numbers.
 */
export function daysBetween(from: number, to: number): number {
  return Math.floor(to) - Math.floor(from);
}

/** True when a serial addresses a date the 1900 system can represent. */
export function isValidSerial(serial: number): boolean {
  return Number.isFinite(serial) && serial >= 0 && serial < MAX_SERIAL + 1;
}

/**
 * Day of the week for a serial, 0 = Sunday.
 *
 * The cycle runs on the serial itself, so it inherits the phantom day: serial 1
 * reports as a Sunday even though 1900-01-01 was a Monday. Anchoring it the
 * other way would make that one date right and shift every date after
 * 1900-02-28 wrong by one, which is the wrong trade by about a century.
 */
export function weekdayIndex(serial: number): number {
  // Serial 1 ≡ Sunday under this anchor, which puts 2026-01-01 on a Thursday.
  return ((Math.floor(serial) % 7) + 7 + 6) % 7;
}

const SECONDS_PER_DAY = 86400;

/**
 * The clock time in a serial's fractional part.
 *
 * Rounded to the nearest second before splitting: a serial arrived at by
 * arithmetic is rarely an exact multiple of 1/86400, and truncating would turn
 * 12:00:00 into 11:59:59 whenever the float landed a hair low.
 */
export function clockFromSerial(serial: number): ClockTime {
  const fraction = serial - Math.floor(serial);
  let seconds = Math.round(fraction * SECONDS_PER_DAY);
  if (seconds >= SECONDS_PER_DAY) seconds = 0;
  return {
    hour: Math.floor(seconds / 3600),
    minute: Math.floor(seconds / 60) % 60,
    second: seconds % 60,
  };
}

/** The fractional day a clock time represents, hours beyond 24 wrapping. */
export function timeFraction(
  hour: number,
  minute: number,
  second: number,
): number {
  const total = hour * 3600 + minute * 60 + second;
  const wrapped = ((total % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  return wrapped / SECONDS_PER_DAY;
}

/** The serial of the last day of the month a serial falls in. */
export function endOfMonth(serial: number): number {
  const { year, month } = civilFromSerial(serial);
  return serialFromCivil(year, month, daysInMonth(year, month));
}

/**
 * A serial moved by whole months, clamped to the target month's length.
 *
 * Stepping a month from the 31st has to land somewhere; every spreadsheet
 * clamps to the month end rather than spilling into the next month, so that a
 * schedule generated from a month end stays on month ends.
 */
export function addMonths(serial: number, months: number): number {
  const { year, month, day } = civilFromSerial(serial);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (((index % 12) + 12) % 12) + 1;
  const clamped = Math.min(day, daysInMonth(targetYear, targetMonth));
  return serialFromCivil(targetYear, targetMonth, clamped);
}

/** True when a serial sits on the final day of its month. */
export function isMonthEnd(serial: number): boolean {
  if (Math.floor(serial) === PHANTOM_LEAP_SERIAL) return true;
  const { year, month, day } = civilFromSerial(serial);
  return day === daysInMonth(year, month);
}
