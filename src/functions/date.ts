/**
 * The date and time function pack.
 *
 * Everything here is a thin shell over `src/date`: read serials out of the
 * arguments, do the calendar work in the date module, hand a number back. The
 * engine has no date *type* — a date is a number with a format on it — so a
 * function that returns a date returns a serial and the display layer decides
 * whether it looks like one.
 *
 * `TODAY` and `NOW` are the exception every recalculation model has to make
 * room for: their answer depends on when they are asked. They read a clock
 * that the host can replace, which is what makes them testable and what would
 * let a workbook be evaluated "as at" a date other than the wall clock.
 */

import { NUM_ERROR, VALUE_ERROR, isFormulaError } from "../engine/errors.js";
import type { FormulaError } from "../engine/errors.js";
import { kindOf } from "../engine/value.js";
import type { Value } from "../engine/value.js";
import {
  addMonths,
  civilFromSerial,
  clockFromSerial,
  daysBetween,
  daysInMonth,
  endOfMonth,
  isValidSerial,
  serialFromCivil,
  timeFraction,
  weekdayIndex,
} from "../date/serial.js";
import { days360, isDayCountBasis, yearFraction } from "../date/daycount.js";
import type { DayCountBasis } from "../date/daycount.js";
import { argValue, argValues, defineFunction, numberArg } from "./registry.js";
import type { Arg } from "./registry.js";

// ---------------------------------------------------------------------------
// Argument reading
// ---------------------------------------------------------------------------

/** A serial from an argument, rejecting anything outside the 1900 system. */
export function serialArg(arg: Arg | undefined): number | Value {
  const n = numberArg(arg);
  if (isFormulaError(n)) return n;
  if (!isValidSerial(n)) return NUM_ERROR;
  return n;
}

function wholeSerialArg(arg: Arg | undefined): number | Value {
  const n = serialArg(arg);
  return typeof n === "number" ? Math.floor(n) : n;
}

function basisArg(
  args: readonly Arg[],
  index: number,
): DayCountBasis | FormulaError {
  if (args.length <= index) return 0;
  const n = numberArg(args[index]);
  if (isFormulaError(n)) return n;
  const basis = Math.trunc(n);
  if (!isDayCountBasis(basis)) return NUM_ERROR;
  return basis;
}

function isSerial(value: number | Value): value is number {
  return typeof value === "number";
}

// ---------------------------------------------------------------------------
// The clock TODAY and NOW read
// ---------------------------------------------------------------------------

export interface Clock {
  /** Milliseconds since the Unix epoch, in the sheet's own timezone terms. */
  now(): number;
}

let clock: Clock = { now: () => Date.now() };

/** Replace the clock `TODAY` and `NOW` read. Returns the previous one. */
export function setClock(next: Clock): Clock {
  const previous = clock;
  clock = next;
  return previous;
}

/**
 * The current moment as a serial.
 *
 * Read in UTC deliberately: a sheet that changes its answers because the
 * machine evaluating it sits in a different timezone is a sheet nobody can
 * reconcile. A host that wants local time supplies a clock offset to match.
 */
function nowSerial(): number {
  const ms = clock.now();
  const days = ms / 86400000;
  // 25569 days from 1899-12-30 to 1970-01-01.
  return days + 25569;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

defineFunction({
  name: "DATE",
  description: "Date serial number from year, month and day.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const year = numberArg(args[0]);
    if (isFormulaError(year)) return year;
    const month = numberArg(args[1]);
    if (isFormulaError(month)) return month;
    const day = numberArg(args[2]);
    if (isFormulaError(day)) return day;
    const serial = serialFromCivil(
      Math.trunc(year),
      Math.trunc(month),
      Math.trunc(day),
    );
    return isValidSerial(serial) ? serial : NUM_ERROR;
  },
});

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const ISO_DATETIME =
  /^(\d{4})-(\d{1,2})-(\d{1,2})[ Tt](\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const CLOCK_ONLY = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function parseDateText(text: string): number | null {
  const date = ISO_DATE.exec(text);
  if (date !== null) {
    return checkedCivil(Number(date[1]), Number(date[2]), Number(date[3]));
  }
  const stamp = ISO_DATETIME.exec(text);
  if (stamp !== null) {
    const day = checkedCivil(
      Number(stamp[1]),
      Number(stamp[2]),
      Number(stamp[3]),
    );
    if (day === null) return null;
    return day;
  }
  return null;
}

/** A serial, but only if the parts name a date that exists. */
function checkedCivil(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) {
    // 1900-02-29 is the one impossible date the system still addresses.
    if (!(year === 1900 && month === 2 && day === 29)) return null;
  }
  const serial = serialFromCivil(year, month, day);
  return isValidSerial(serial) ? serial : null;
}

defineFunction({
  name: "DATEVALUE",
  description: "Date serial number from an ISO date string.",
  minArgs: 1,
  maxArgs: 1,
  call(args) {
    const text = argValue(args[0]!);
    if (isFormulaError(text)) return text;
    if (typeof text !== "string") return VALUE_ERROR;
    const serial = parseDateText(text.trim());
    return serial === null ? VALUE_ERROR : serial;
  },
});

defineFunction({
  name: "TIME",
  description: "Fraction of a day from hours, minutes and seconds.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const hour = numberArg(args[0]);
    if (isFormulaError(hour)) return hour;
    const minute = numberArg(args[1]);
    if (isFormulaError(minute)) return minute;
    const second = numberArg(args[2]);
    if (isFormulaError(second)) return second;
    if (hour < 0 || minute < 0 || second < 0) return NUM_ERROR;
    return timeFraction(
      Math.trunc(hour),
      Math.trunc(minute),
      Math.trunc(second),
    );
  },
});

defineFunction({
  name: "TIMEVALUE",
  description: "Fraction of a day from a clock string.",
  minArgs: 1,
  maxArgs: 1,
  call(args) {
    const text = argValue(args[0]!);
    if (isFormulaError(text)) return text;
    if (typeof text !== "string") return VALUE_ERROR;
    const trimmed = text.trim();
    const clockOnly = CLOCK_ONLY.exec(trimmed);
    if (clockOnly !== null) {
      return timeFraction(
        Number(clockOnly[1]),
        Number(clockOnly[2]),
        clockOnly[3] === undefined ? 0 : Number(clockOnly[3]),
      );
    }
    const stamp = ISO_DATETIME.exec(trimmed);
    if (stamp === null) return VALUE_ERROR;
    return timeFraction(
      Number(stamp[4]),
      Number(stamp[5]),
      stamp[6] === undefined ? 0 : Number(stamp[6]),
    );
  },
});

defineFunction({
  name: "TODAY",
  description: "Today's date, as a whole serial number.",
  minArgs: 0,
  maxArgs: 0,
  call: () => Math.floor(nowSerial()),
});

defineFunction({
  name: "NOW",
  description: "The current date and time, as a serial number.",
  minArgs: 0,
  maxArgs: 0,
  call: () => nowSerial(),
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function component(
  name: string,
  description: string,
  read: (serial: number) => number,
): void {
  defineFunction({
    name,
    description,
    minArgs: 1,
    maxArgs: 1,
    call(args) {
      const serial = serialArg(args[0]);
      if (!isSerial(serial)) return serial;
      return read(serial);
    },
  });
}

component("YEAR", "The year of a date.", (s) => civilFromSerial(s).year);
component("MONTH", "The month of a date, 1–12.", (s) => civilFromSerial(s).month);
component("DAY", "The day of the month of a date.", (s) => civilFromSerial(s).day);
component("HOUR", "The hour of a time, 0–23.", (s) => clockFromSerial(s).hour);
component("MINUTE", "The minute of a time, 0–59.", (s) => clockFromSerial(s).minute);
component("SECOND", "The second of a time, 0–59.", (s) => clockFromSerial(s).second);

/**
 * `WEEKDAY` with the three numbering schemes spreadsheets offer.
 *
 * Type 1 is Sunday-first counting from 1, type 2 Monday-first from 1, type 3
 * Monday-first from 0. They exist because a sheet that indexes into a list of
 * day names needs whichever one matches how the list was written.
 */
defineFunction({
  name: "WEEKDAY",
  description: "Day of the week of a date, numbered by scheme.",
  minArgs: 1,
  maxArgs: 2,
  call(args) {
    const serial = serialArg(args[0]);
    if (!isSerial(serial)) return serial;
    let type = 1;
    if (args.length > 1) {
      const n = numberArg(args[1]);
      if (isFormulaError(n)) return n;
      type = Math.trunc(n);
    }
    const sunday = weekdayIndex(serial);
    switch (type) {
      case 1:
        return sunday + 1;
      case 2:
        return ((sunday + 6) % 7) + 1;
      case 3:
        return (sunday + 6) % 7;
      default:
        return NUM_ERROR;
    }
  },
});

/**
 * `WEEKNUM`, counting the week containing 1 January as week 1.
 *
 * Type 1 starts weeks on Sunday and type 2 on Monday, which between them cover
 * the two conventions in common use for this simple scheme. ISO week numbering
 * is a genuinely different rule — its week 1 is the one holding the first
 * Thursday — and is not what this function computes.
 */
defineFunction({
  name: "WEEKNUM",
  description: "Week of the year a date falls in.",
  minArgs: 1,
  maxArgs: 2,
  call(args) {
    const serial = serialArg(args[0]);
    if (!isSerial(serial)) return serial;
    let type = 1;
    if (args.length > 1) {
      const n = numberArg(args[1]);
      if (isFormulaError(n)) return n;
      type = Math.trunc(n);
    }
    if (type !== 1 && type !== 2) return NUM_ERROR;
    const startOfWeek = type === 1 ? 0 : 1;
    const { year } = civilFromSerial(serial);
    const jan1 = serialFromCivil(year, 1, 1);
    const offset = (weekdayIndex(jan1) - startOfWeek + 7) % 7;
    return Math.floor((daysBetween(jan1, serial) + offset) / 7) + 1;
  },
});

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

defineFunction({
  name: "EDATE",
  description: "A date moved by whole months, clamped to the month end.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const serial = wholeSerialArg(args[0]);
    if (!isSerial(serial)) return serial;
    const months = numberArg(args[1]);
    if (isFormulaError(months)) return months;
    const moved = addMonths(serial, Math.trunc(months));
    return isValidSerial(moved) ? moved : NUM_ERROR;
  },
});

defineFunction({
  name: "EOMONTH",
  description: "The last day of the month a number of months away.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const serial = wholeSerialArg(args[0]);
    if (!isSerial(serial)) return serial;
    const months = numberArg(args[1]);
    if (isFormulaError(months)) return months;
    const moved = endOfMonth(addMonths(serial, Math.trunc(months)));
    return isValidSerial(moved) ? moved : NUM_ERROR;
  },
});

defineFunction({
  name: "DAYS",
  description: "Calendar days between two dates, end minus start.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const end = wholeSerialArg(args[0]);
    if (!isSerial(end)) return end;
    const start = wholeSerialArg(args[1]);
    if (!isSerial(start)) return start;
    return daysBetween(start, end);
  },
});

defineFunction({
  name: "DAYS360",
  description: "Days between two dates on a 360-day year.",
  minArgs: 2,
  maxArgs: 3,
  call(args) {
    const start = wholeSerialArg(args[0]);
    if (!isSerial(start)) return start;
    const end = wholeSerialArg(args[1]);
    if (!isSerial(end)) return end;
    let european = false;
    if (args.length > 2) {
      const flag = argValue(args[2]!);
      if (isFormulaError(flag)) return flag;
      if (kindOf(flag) === "text") return VALUE_ERROR;
      european = flag === true || flag === 1;
    }
    return days360(start, end, { european });
  },
});

/**
 * `DATEDIF`, whose unit codes are the reason it still exists.
 *
 * `"Y"`, `"M"` and `"D"` are whole elapsed years, months and days. `"MD"`,
 * `"YM"` and `"YD"` are the remainders after taking the larger units out,
 * which is how a sheet writes "3 years and 4 months" without doing the
 * borrowing by hand.
 */
defineFunction({
  name: "DATEDIF",
  description: "Elapsed time between two dates in a chosen unit.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const start = wholeSerialArg(args[0]);
    if (!isSerial(start)) return start;
    const end = wholeSerialArg(args[1]);
    if (!isSerial(end)) return end;
    const unit = argValue(args[2]!);
    if (isFormulaError(unit)) return unit;
    if (typeof unit !== "string") return VALUE_ERROR;
    if (end < start) return NUM_ERROR;

    const a = civilFromSerial(start);
    const b = civilFromSerial(end);
    const wholeMonths =
      (b.year - a.year) * 12 + (b.month - a.month) - (b.day < a.day ? 1 : 0);

    switch (unit.trim().toUpperCase()) {
      case "D":
        return daysBetween(start, end);
      case "M":
        return wholeMonths;
      case "Y":
        return Math.floor(wholeMonths / 12);
      case "MD": {
        // Days since the same day-of-month, borrowing from the previous month.
        if (b.day >= a.day) return b.day - a.day;
        const previous = addMonths(serialFromCivil(b.year, b.month, 1), -1);
        const previousMonth = civilFromSerial(previous);
        const borrowed = Math.min(
          a.day,
          daysInMonth(previousMonth.year, previousMonth.month),
        );
        return (
          daysInMonth(previousMonth.year, previousMonth.month) - borrowed + b.day
        );
      }
      case "YM":
        return ((wholeMonths % 12) + 12) % 12;
      case "YD": {
        // Days since the anniversary that precedes the end date.
        const years = Math.floor(wholeMonths / 12);
        const anniversary = addMonths(start, years * 12);
        return daysBetween(anniversary, end);
      }
      default:
        return NUM_ERROR;
    }
  },
});

defineFunction({
  name: "YEARFRAC",
  description: "Fraction of a year between two dates on a day-count basis.",
  minArgs: 2,
  maxArgs: 3,
  call(args) {
    const start = wholeSerialArg(args[0]);
    if (!isSerial(start)) return start;
    const end = wholeSerialArg(args[1]);
    if (!isSerial(end)) return end;
    const basis = basisArg(args, 2);
    if (isFormulaError(basis)) return basis;
    return yearFraction(start, end, basis);
  },
});

// ---------------------------------------------------------------------------
// Working days
// ---------------------------------------------------------------------------

/**
 * The holiday list argument, as a set of whole serials.
 *
 * Text and blanks in the range are ignored rather than rejected: a holiday
 * column on a real sheet has a header on it, and refusing to work because of
 * one would be unhelpful.
 */
function holidaySet(arg: Arg | undefined): Set<number> | Value {
  const out = new Set<number>();
  if (arg === undefined) return out;
  for (const value of argValues(arg)) {
    if (isFormulaError(value)) return value;
    if (kindOf(value) !== "number") continue;
    out.add(Math.floor(value as number));
  }
  return out;
}

function isWeekend(serial: number): boolean {
  const day = weekdayIndex(serial);
  return day === 0 || day === 6;
}

function isWorkingDay(serial: number, holidays: Set<number>): boolean {
  return !isWeekend(serial) && !holidays.has(serial);
}

defineFunction({
  name: "NETWORKDAYS",
  description: "Working days between two dates, weekends and holidays out.",
  minArgs: 2,
  maxArgs: 3,
  call(args) {
    const start = wholeSerialArg(args[0]);
    if (!isSerial(start)) return start;
    const end = wholeSerialArg(args[1]);
    if (!isSerial(end)) return end;
    const holidays = holidaySet(args[2]);
    if (!(holidays instanceof Set)) return holidays;

    const sign = end < start ? -1 : 1;
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    let count = 0;
    for (let s = from; s <= to; s++) {
      if (isWorkingDay(s, holidays)) count++;
    }
    return count * sign;
  },
});

defineFunction({
  name: "WORKDAY",
  description: "The date a number of working days from a start date.",
  minArgs: 2,
  maxArgs: 3,
  call(args) {
    const start = wholeSerialArg(args[0]);
    if (!isSerial(start)) return start;
    const days = numberArg(args[1]);
    if (isFormulaError(days)) return days;
    const holidays = holidaySet(args[2]);
    if (!(holidays instanceof Set)) return holidays;

    let remaining = Math.trunc(days);
    const step = remaining < 0 ? -1 : 1;
    remaining = Math.abs(remaining);
    let serial = start;
    while (remaining > 0) {
      serial += step;
      if (!isValidSerial(serial)) return NUM_ERROR;
      if (isWorkingDay(serial, holidays)) remaining--;
    }
    return serial;
  },
});
