import { describe, expect, it } from "vitest";
import {
  isoWeekOf,
  isoWeeksInYear,
  serialFromCivil,
  weekdayIndex,
} from "../src/date/serial.js";
import { Workbook } from "../src/engine/workbook.js";

function week(year: number, month: number, day: number) {
  return isoWeekOf(serialFromCivil(year, month, day));
}

/**
 * An independent reading of the ISO rule, built on the platform's own
 * calendar rather than on the serial machinery under test.
 *
 * This is a reference and not a second implementation of the same code: it
 * goes through `Date` in UTC, counts milliseconds between two Thursdays, and
 * shares none of the serial arithmetic, the epoch or the phantom leap day
 * with the thing it is checking. Where the two agree, they agree for reasons
 * that are not the same reasons.
 */
function reference(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const fromMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - fromMonday + 3);
  const weekYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3,
  );
  const number =
    1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return { week: number, weekYear };
}

describe("the ISO week rule", () => {
  it("starts week 1 on the week holding the first Thursday", () => {
    // 2026 starts on a Thursday, so 1 January is already in week 1 and the
    // week reaches back into December 2025.
    expect(week(2026, 1, 1)).toEqual({ week: 1, weekYear: 2026 });
    expect(week(2025, 12, 29)).toEqual({ week: 1, weekYear: 2026 });
    expect(week(2025, 12, 28)).toEqual({ week: 52, weekYear: 2025 });
  });

  it("puts the first days of a year in the previous year's last week", () => {
    // 2028 starts on a Saturday: its first Thursday is the 6th, so 1 and 2
    // January belong to the last week of 2027.
    expect(week(2028, 1, 1)).toEqual({ week: 52, weekYear: 2027 });
    expect(week(2028, 1, 2)).toEqual({ week: 52, weekYear: 2027 });
    expect(week(2028, 1, 3)).toEqual({ week: 1, weekYear: 2028 });
  });

  it("puts the last days of a year in the next year's week 1", () => {
    expect(week(2025, 12, 29)).toEqual({ week: 1, weekYear: 2026 });
    expect(week(2019, 12, 30)).toEqual({ week: 1, weekYear: 2020 });
  });

  it("gives a year 53 weeks when it starts on a Thursday, or is a leap year starting on a Wednesday", () => {
    // The two shapes, and nothing else, put a 53rd Thursday inside a year.
    expect(isoWeeksInYear(2026)).toBe(53); // starts Thursday
    expect(isoWeeksInYear(2020)).toBe(53); // leap year starting Wednesday
    expect(isoWeeksInYear(2025)).toBe(52);
    expect(isoWeeksInYear(2024)).toBe(52); // leap year starting Monday

    for (let year = 1905; year <= 2100; year += 1) {
      const startsOn = weekdayIndex(serialFromCivil(year, 1, 1));
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const long = startsOn === 4 || (leap && startsOn === 3);
      expect(isoWeeksInYear(year), `${year}`).toBe(long ? 53 : 52);
    }
  });

  it("agrees with the platform calendar across two centuries of boundaries", () => {
    // The days either side of a year boundary are where the rule can be
    // wrong; the midsummer date is the control that says the sweep is
    // looking at the ordinary case too.
    const days: ReadonlyArray<readonly [number, number]> = [
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [1, 5],
      [1, 6],
      [1, 7],
      [6, 15],
      [12, 25],
      [12, 28],
      [12, 29],
      [12, 30],
      [12, 31],
    ];
    let compared = 0;
    for (let year = 1905; year <= 2100; year += 1) {
      for (const [month, day] of days) {
        expect(
          { year, month, day, ...week(year, month, day) },
          `${year}-${month}-${day}`,
        ).toEqual({ year, month, day, ...reference(year, month, day) });
        compared += 1;
      }
    }
    expect(compared).toBe(196 * 13);
  });

  it("covers a year starting on each of the seven weekdays", () => {
    const seen = new Set<number>();
    for (let year = 2015; year <= 2030; year += 1) {
      seen.add(weekdayIndex(serialFromCivil(year, 1, 1)));
      for (const [month, day] of [
        [1, 1],
        [12, 31],
      ] as const) {
        expect(week(year, month, day)).toEqual(reference(year, month, day));
      }
    }
    expect(seen.size).toBe(7);
  });

  it("numbers every week of a long year once, ending at 53", () => {
    // Walk 2026 week by week from its first Monday. A rule that drifts by a
    // day somewhere in the middle of a year passes every boundary check
    // above and fails this one.
    const start = serialFromCivil(2026, 1, 1);
    const firstMonday = start - ((weekdayIndex(start) + 6) % 7);
    for (let index = 0; index < 53; index += 1) {
      const monday = firstMonday + index * 7;
      expect(isoWeekOf(monday)).toEqual({ week: index + 1, weekYear: 2026 });
      // ...and every day of that week carries the same number.
      for (let offset = 1; offset < 7; offset += 1) {
        expect(isoWeekOf(monday + offset).week).toBe(index + 1);
      }
    }
    expect(isoWeekOf(firstMonday + 53 * 7)).toEqual({ week: 1, weekYear: 2027 });
  });

  it("reads the week off the whole days of a serial carrying a time", () => {
    const monday = serialFromCivil(2026, 3, 2);
    expect(isoWeekOf(monday + 0.999).week).toBe(isoWeekOf(monday).week);
  });
});

describe("WEEKNUM and ISOWEEKNUM on a sheet", () => {
  function run(formula: string) {
    const book = new Workbook();
    book.setCells({ A1: formula });
    return book.getValue("A1");
  }

  it("answers type 21 with the ISO number and type 1 with the simple one", () => {
    // The same date, two rules, a year apart in what they mean.
    expect(run("=WEEKNUM(DATE(2027,1,1),1)")).toBe(1);
    expect(run("=WEEKNUM(DATE(2027,1,1),21)")).toBe(53);
    expect(run("=ISOWEEKNUM(DATE(2027,1,1))")).toBe(53);
  });

  it("starts the week on the day each return type names", () => {
    // 2026 opens on a Thursday and 2026-01-11 is a Sunday. Under a
    // Sunday-start that Sunday opens week 3; under a Monday-start it closes
    // week 2. Under a Friday- or Saturday-start it is week 3 again, because
    // week 1 under those is the single day Thursday 1 January — the simple
    // scheme puts 1 January in week 1 whatever day it falls on, so a year's
    // first week can be one day long.
    const sunday = "DATE(2026,1,11)";
    const byType = [1, 2, 11, 12, 13, 14, 15, 16, 17].map((type) =>
      run(`=WEEKNUM(${sunday},${type})`),
    );
    expect(byType).toEqual([3, 2, 2, 2, 2, 2, 3, 3, 3]);
    // A date where every type agreed would make the row above vacuous.
    expect(new Set(byType).size).toBeGreaterThan(1);
  });

  it("puts 1 January in week 1 under every simple type, however short that week", () => {
    for (const year of [2024, 2025, 2026, 2027, 2028, 2029, 2030]) {
      for (const type of [1, 2, 11, 12, 13, 14, 15, 16, 17]) {
        expect(run(`=WEEKNUM(DATE(${year},1,1),${type})`), `${year} type ${type}`).toBe(1);
      }
      // ...which is exactly what the ISO rule declines to do.
      expect(run(`=WEEKNUM(DATE(${year},1,1),21)`)).toBe(
        week(year, 1, 1).week,
      );
    }
    // And over those seven years the ISO answer is not always 1, so the
    // contrast above is a real one.
    const isoFirsts = [2024, 2025, 2026, 2027, 2028, 2029, 2030].map(
      (year) => week(year, 1, 1).week,
    );
    expect(new Set(isoFirsts).size).toBeGreaterThan(1);
  });

  it("treats 2 and 11 as the same rule, because they are", () => {
    for (const day of [1, 5, 11, 12, 31]) {
      expect(run(`=WEEKNUM(DATE(2026,1,${day}),2)`)).toBe(
        run(`=WEEKNUM(DATE(2026,1,${day}),11)`),
      );
    }
  });

  it("refuses a return type that is not one of them", () => {
    for (const type of [0, 3, 10, 18, 20, 22, -1]) {
      const value = run(`=WEEKNUM(DATE(2026,1,1),${type})`);
      expect(
        typeof value === "object" && value !== null && "code" in value
          ? (value as { code: string }).code
          : value,
        `type ${type}`,
      ).toBe("#NUM!");
    }
  });

  it("agrees with the library across a year boundary, through the sheet", () => {
    const book = new Workbook();
    const cells: Record<string, string> = {};
    const dates: Array<readonly [number, number, number]> = [];
    let row = 1;
    for (const [year, month, day] of [
      [2025, 12, 28],
      [2025, 12, 29],
      [2025, 12, 31],
      [2026, 1, 1],
      [2026, 12, 31],
      [2027, 1, 1],
      [2027, 1, 4],
    ] as const) {
      cells[`A${row}`] = `=ISOWEEKNUM(DATE(${year},${month},${day}))`;
      dates.push([year, month, day]);
      row += 1;
    }
    book.setCells(cells);
    dates.forEach(([year, month, day], index) => {
      expect(book.getValue(`A${index + 1}`), `${year}-${month}-${day}`).toBe(
        week(year, month, day).week,
      );
    });
  });

  it("propagates an error and refuses a value that is not a date", () => {
    expect(run("=ISOWEEKNUM(1/0)")).toMatchObject({ code: "#DIV/0!" });
    expect(run("=ISOWEEKNUM(-5)")).toMatchObject({ code: "#NUM!" });
    expect(run('=ISOWEEKNUM("banana")')).toMatchObject({ code: "#VALUE!" });
  });
});
