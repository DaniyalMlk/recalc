import { describe, expect, it } from "vitest";
import {
  MAX_SERIAL,
  PHANTOM_LEAP_SERIAL,
  addMonths,
  civilFromDays,
  civilFromSerial,
  clockFromSerial,
  daysBetween,
  daysFromCivil,
  daysInMonth,
  daysInYear,
  endOfMonth,
  isLeapYear,
  isMonthEnd,
  isValidSerial,
  serialFromCivil,
  timeFraction,
  weekdayIndex,
} from "../src/date/serial.js";

const s = (y: number, m: number, d: number) => serialFromCivil(y, m, d);

describe("civil day arithmetic", () => {
  it("round-trips every day across a leap year boundary", () => {
    for (let day = daysFromCivil(2023, 12, 1); day <= daysFromCivil(2024, 3, 5); day++) {
      const civil = civilFromDays(day);
      expect(daysFromCivil(civil.year, civil.month, civil.day)).toBe(day);
    }
  });

  it("normalises months and days out of range the way DATE does", () => {
    expect(daysFromCivil(2026, 13, 1)).toBe(daysFromCivil(2027, 1, 1));
    expect(daysFromCivil(2026, 0, 1)).toBe(daysFromCivil(2025, 12, 1));
    expect(daysFromCivil(2026, 3, 0)).toBe(daysFromCivil(2026, 2, 28));
    expect(daysFromCivil(2026, 1, 32)).toBe(daysFromCivil(2026, 2, 1));
  });

  it("knows the Gregorian leap rule at the century marks", () => {
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(daysInYear(2024)).toBe(366);
    expect(daysInYear(2023)).toBe(365);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
  });
});

describe("the 1900 serial system", () => {
  it("places the anchors where every spreadsheet places them", () => {
    expect(s(1900, 1, 1)).toBe(1);
    expect(s(1900, 2, 28)).toBe(59);
    expect(s(1900, 3, 1)).toBe(61);
    expect(s(2026, 1, 1)).toBe(46023);
    expect(s(2000, 1, 1)).toBe(36526);
    expect(s(9999, 12, 31)).toBe(MAX_SERIAL);
  });

  it("keeps the phantom leap day", () => {
    expect(s(1900, 2, 29)).toBe(PHANTOM_LEAP_SERIAL);
    expect(civilFromSerial(PHANTOM_LEAP_SERIAL)).toEqual({
      year: 1900,
      month: 2,
      day: 29,
    });
    // The fiction is self-consistent: the day sits between its neighbours.
    expect(civilFromSerial(59).day).toBe(28);
    expect(civilFromSerial(61).day).toBe(1);
    expect(isMonthEnd(PHANTOM_LEAP_SERIAL)).toBe(true);
  });

  it("round-trips serials to dates and back", () => {
    for (const serial of [1, 59, 60, 61, 1000, 25569, 36526, 46023, MAX_SERIAL]) {
      const civil = civilFromSerial(serial);
      expect(serialFromCivil(civil.year, civil.month, civil.day)).toBe(serial);
    }
  });

  it("counts days by plain subtraction", () => {
    expect(daysBetween(s(2026, 1, 1), s(2027, 1, 1))).toBe(365);
    expect(daysBetween(s(2024, 1, 1), s(2025, 1, 1))).toBe(366);
    expect(daysBetween(s(2026, 2, 1), s(2026, 3, 1))).toBe(28);
    expect(daysBetween(0, 365)).toBe(365);
  });

  it("bounds the representable range", () => {
    expect(isValidSerial(0)).toBe(true);
    expect(isValidSerial(-1)).toBe(false);
    expect(isValidSerial(MAX_SERIAL)).toBe(true);
    expect(isValidSerial(MAX_SERIAL + 1)).toBe(false);
    expect(isValidSerial(Number.NaN)).toBe(false);
  });
});

describe("weekdays", () => {
  it("puts known dates on the right day", () => {
    // 0 = Sunday.
    expect(weekdayIndex(s(2026, 1, 1))).toBe(4); // Thursday
    expect(weekdayIndex(s(2023, 3, 15))).toBe(3); // Wednesday
    expect(weekdayIndex(s(2000, 1, 1))).toBe(6); // Saturday
    expect(weekdayIndex(s(2024, 2, 29))).toBe(4); // Thursday
  });

  it("cycles with a seven-day period", () => {
    const base = s(2026, 6, 10);
    for (let i = 0; i < 40; i++) {
      expect(weekdayIndex(base + i)).toBe(weekdayIndex(base + i + 7));
    }
  });

  it("inherits the phantom day at the 1900 boundary, as spreadsheets do", () => {
    expect(weekdayIndex(1)).toBe(0);
  });
});

describe("clock times", () => {
  it("splits a fraction of a day into hours, minutes and seconds", () => {
    expect(clockFromSerial(0.5)).toEqual({ hour: 12, minute: 0, second: 0 });
    expect(clockFromSerial(0.75)).toEqual({ hour: 18, minute: 0, second: 0 });
    expect(clockFromSerial(46023.25)).toEqual({ hour: 6, minute: 0, second: 0 });
  });

  it("rounds to the nearest second rather than truncating", () => {
    // 12:00:00 arrived at by arithmetic lands a hair below one half.
    const noon = 1 / 3 + 1 / 6 - 1e-12;
    expect(clockFromSerial(noon)).toEqual({ hour: 12, minute: 0, second: 0 });
  });

  it("round-trips a clock time through the fraction", () => {
    for (const [h, m, sec] of [
      [0, 0, 0],
      [1, 2, 3],
      [12, 34, 56],
      [23, 59, 59],
    ] as const) {
      expect(clockFromSerial(timeFraction(h, m, sec))).toEqual({
        hour: h,
        minute: m,
        second: sec,
      });
    }
  });

  it("wraps hours past a day", () => {
    expect(timeFraction(25, 0, 0)).toBeCloseTo(1 / 24, 12);
    expect(timeFraction(0, 0, 86400)).toBe(0);
  });
});

describe("month arithmetic", () => {
  it("clamps a month step onto a shorter month", () => {
    expect(civilFromSerial(addMonths(s(2026, 1, 31), 1))).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(civilFromSerial(addMonths(s(2024, 1, 31), 1))).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    expect(civilFromSerial(addMonths(s(2026, 3, 31), -1))).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
  });

  it("does not restore a clamped day on the way back", () => {
    // 31 Jan → 28 Feb → 28 Mar. Clamping loses information, by design.
    const there = addMonths(s(2026, 1, 31), 1);
    expect(civilFromSerial(addMonths(there, 1)).day).toBe(28);
  });

  it("crosses year boundaries in both directions", () => {
    expect(civilFromSerial(addMonths(s(2026, 11, 15), 3))).toEqual({
      year: 2027,
      month: 2,
      day: 15,
    });
    expect(civilFromSerial(addMonths(s(2026, 2, 15), -14))).toEqual({
      year: 2024,
      month: 12,
      day: 15,
    });
  });

  it("finds month ends", () => {
    expect(endOfMonth(s(2026, 2, 3))).toBe(s(2026, 2, 28));
    expect(endOfMonth(s(2024, 2, 3))).toBe(s(2024, 2, 29));
    expect(endOfMonth(s(2026, 12, 25))).toBe(s(2026, 12, 31));
    expect(isMonthEnd(s(2026, 4, 30))).toBe(true);
    expect(isMonthEnd(s(2026, 4, 29))).toBe(false);
  });
});
