import { describe, expect, it } from "vitest";
import { serialFromCivil } from "../src/date/serial.js";
import {
  BASIS_NAMES,
  actualYearLength,
  basisDays,
  basisYearLength,
  days360,
  isDayCountBasis,
  yearFraction,
} from "../src/date/daycount.js";
import type { DayCountBasis } from "../src/date/daycount.js";

const s = (y: number, m: number, d: number) => serialFromCivil(y, m, d);

/**
 * The published 30/360 comparison table, the one every day-count reference
 * reproduces. Each row is a start date, an end date, the US (NASD) bond count
 * and the European count. It is the sharpest test there is of the month-end
 * rules, because that is the only place the two conventions disagree.
 */
const THIRTY_360: ReadonlyArray<
  readonly [readonly [number, number, number], readonly [number, number, number], number, number]
> = [
  [[2007, 1, 15], [2007, 1, 30], 15, 15],
  [[2007, 1, 15], [2007, 2, 15], 30, 30],
  [[2007, 1, 15], [2007, 7, 15], 180, 180],
  [[2007, 9, 30], [2008, 3, 31], 180, 180],
  [[2007, 9, 30], [2007, 10, 31], 30, 30],
  [[2007, 9, 30], [2008, 9, 30], 360, 360],
  [[2007, 1, 15], [2007, 1, 31], 16, 15],
  [[2007, 1, 31], [2007, 2, 28], 28, 28],
  [[2007, 2, 28], [2007, 3, 31], 33, 32],
  [[2006, 8, 31], [2007, 2, 28], 178, 178],
  [[2007, 2, 28], [2007, 8, 31], 183, 182],
  [[2007, 8, 31], [2008, 2, 29], 179, 179],
  [[2008, 2, 29], [2008, 8, 31], 182, 181],
  [[2008, 8, 31], [2009, 2, 28], 178, 178],
  [[2009, 2, 28], [2009, 8, 31], 183, 182],
];

describe("the 30/360 family", () => {
  it.each(THIRTY_360)(
    "counts %j to %j as %i US and %i European",
    (from, to, us, european) => {
      const start = s(...from);
      const end = s(...to);
      expect(days360(start, end)).toBe(us);
      expect(days360(start, end, { european: true })).toBe(european);
    },
  );

  it("adds the February rule only for YEARFRAC, not for DAYS360", () => {
    // A whole coupon period, February month end to August month end. DAYS360
    // makes it 183 days; the bond basis behind YEARFRAC makes it a clean 180.
    const start = s(2007, 2, 28);
    const end = s(2007, 8, 31);
    expect(days360(start, end)).toBe(183);
    expect(days360(start, end, { februaryRule: true })).toBe(180);
    expect(yearFraction(start, end, 0)).toBeCloseTo(0.5, 12);
  });

  it("applies the February rule in a leap year too", () => {
    expect(days360(s(2008, 2, 29), s(2008, 8, 31), { februaryRule: true })).toBe(
      180,
    );
    // 28 February 2008 is not a month end, so the rule must not fire.
    expect(days360(s(2008, 2, 28), s(2008, 8, 31), { februaryRule: true })).toBe(
      183,
    );
  });

  it("shortens February-to-February to a whole year", () => {
    expect(days360(s(2007, 2, 28), s(2008, 2, 29), { februaryRule: true })).toBe(
      360,
    );
  });
});

describe("YEARFRAC across the five bases", () => {
  /**
   * The worked example carried in the published documentation for `YEARFRAC`:
   * 1 January 2012 to 30 July 2012, which is 211 actual days inside a leap
   * year and 209 days on a 30/360 grid.
   */
  const start = s(2012, 1, 1);
  const end = s(2012, 7, 30);

  it.each([
    [0, 0.58055556],
    [1, 0.57650273],
    [2, 0.58611111],
    [3, 0.57808219],
    [4, 0.58055556],
  ] as ReadonlyArray<readonly [DayCountBasis, number]>)(
    "matches the published value on basis %i",
    (basis, expected) => {
      expect(yearFraction(start, end, basis)).toBeCloseTo(expected, 8);
    },
  );

  it("reduces to the ratio the basis promises", () => {
    expect(yearFraction(start, end, 2)).toBeCloseTo(211 / 360, 12);
    expect(yearFraction(start, end, 3)).toBeCloseTo(211 / 365, 12);
    expect(yearFraction(start, end, 0)).toBeCloseTo(209 / 360, 12);
  });

  it("is a length, so it never comes back negative", () => {
    for (const basis of [0, 1, 2, 3, 4] as const) {
      expect(yearFraction(end, start, basis)).toBe(yearFraction(start, end, basis));
    }
  });

  it("is zero on a zero-length period", () => {
    for (const basis of [0, 1, 2, 3, 4] as const) {
      expect(yearFraction(start, start, basis)).toBe(0);
    }
  });
});

describe("actual/actual year lengths", () => {
  it("uses 366 inside a leap year", () => {
    expect(actualYearLength(s(2024, 1, 1), s(2024, 6, 1))).toBe(366);
  });

  it("uses 366 when the span crosses a 29 February", () => {
    expect(actualYearLength(s(2023, 12, 1), s(2024, 3, 1))).toBe(366);
    expect(actualYearLength(s(2019, 3, 1), s(2020, 2, 29))).toBe(366);
  });

  it("uses 365 when the span misses the leap day", () => {
    expect(actualYearLength(s(2023, 1, 1), s(2023, 12, 31))).toBe(365);
    expect(actualYearLength(s(2024, 3, 1), s(2025, 1, 1))).toBe(365);
  });

  it("averages the calendar years a longer span touches", () => {
    // 2020 through 2023 inclusive: one leap year in four.
    expect(actualYearLength(s(2020, 1, 1), s(2023, 1, 1))).toBeCloseTo(
      1461 / 4,
      12,
    );
    expect(yearFraction(s(2020, 1, 1), s(2023, 1, 1), 1)).toBeCloseTo(
      1096 / 365.25,
      12,
    );
  });
});

describe("basis metadata", () => {
  it("names every basis it accepts", () => {
    for (const basis of [0, 1, 2, 3, 4] as const) {
      expect(isDayCountBasis(basis)).toBe(true);
      expect(BASIS_NAMES[basis]).toMatch(/\S/);
    }
    expect(isDayCountBasis(5)).toBe(false);
    expect(isDayCountBasis(-1)).toBe(false);
    expect(isDayCountBasis(1.5)).toBe(false);
  });

  it("reports the denominator each basis divides by", () => {
    const start = s(2024, 1, 1);
    const end = s(2024, 7, 1);
    expect(basisYearLength(start, end, 0)).toBe(360);
    expect(basisYearLength(start, end, 1)).toBe(366);
    expect(basisYearLength(start, end, 2)).toBe(360);
    expect(basisYearLength(start, end, 3)).toBe(365);
    expect(basisYearLength(start, end, 4)).toBe(360);
  });

  it("counts days the way the basis counts them", () => {
    const start = s(2026, 1, 31);
    const end = s(2026, 3, 31);
    // Two whole months on either 30/360 grid; 59 real days, February being short.
    expect(basisDays(start, end, 0)).toBe(60);
    expect(basisDays(start, end, 4)).toBe(60);
    expect(basisDays(start, end, 2)).toBe(59);
  });

  it("agrees with its own numerator and denominator", () => {
    const start = s(2021, 4, 15);
    const end = s(2023, 9, 3);
    for (const basis of [0, 1, 2, 3, 4] as const) {
      expect(yearFraction(start, end, basis)).toBeCloseTo(
        basisDays(start, end, basis) / basisYearLength(start, end, basis),
        12,
      );
    }
  });
});
