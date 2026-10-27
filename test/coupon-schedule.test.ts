import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import {
  civilFromSerial,
  daysBetween,
  isMonthEnd,
  serialFromCivil,
} from "../src/date/serial.js";
import { basisDays } from "../src/date/daycount.js";
import type { DayCountBasis } from "../src/date/daycount.js";
import { couponDateBack, couponPosition } from "../src/date/coupons.js";
import { COUPON_REFERENCE } from "../scripts/coupon-reference.js";

const s = (y: number, m: number, d: number) => serialFromCivil(y, m, d);

const iso = (serial: number): string => {
  const { year, month, day } = civilFromSerial(serial);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

function sheet() {
  const book = new Workbook();
  return {
    num(formula: string): number {
      book.setCell("Z100", formula);
      const value = book.getValue("Z100");
      if (typeof value !== "number") {
        throw new Error(`${formula} produced ${JSON.stringify(value)}`);
      }
      return value;
    },
  };
}

const plain = sheet();

const ALL_BASES: readonly DayCountBasis[] = [0, 1, 2, 3, 4];

describe("the coupon schedule against a reference transcript", () => {
  it("carries the whole transcript, not a prefix of it", () => {
    // A table that lost rows would still pass case by case while testing less
    // than it claims, and the blocks only pin a boundary if both sides of each
    // month end survive.
    expect(COUPON_REFERENCE.length).toBe(24);
    const blocks = new Set(COUPON_REFERENCE.map((row) => row.block));
    expect(blocks.size).toBe(4);
    for (const block of blocks) {
      expect(COUPON_REFERENCE.filter((row) => row.block === block).length).toBe(6);
    }
  });

  it("includes a month end and both of its neighbours in every block", () => {
    // The point of the layout: each block holds exactly one maturity under the
    // month-end rule. A table of month ends alone would be satisfied by a rule
    // applied one day too widely.
    for (const block of new Set(COUPON_REFERENCE.map((row) => row.block))) {
      const rows = COUPON_REFERENCE.filter((row) => row.block === block);
      const ends = rows.filter((row) => isMonthEnd(row.maturity));
      expect(ends.length, block).toBe(1);
    }
  });

  it("reproduces every COUPPCD and COUPNCD in it", () => {
    for (const row of COUPON_REFERENCE) {
      const where = `${row.block}: maturity ${iso(row.maturity)}`;
      const previous = plain.num(
        `=COUPPCD(${row.settlement},${row.maturity},${row.frequency},${row.basis})`,
      );
      const next = plain.num(
        `=COUPNCD(${row.settlement},${row.maturity},${row.frequency},${row.basis})`,
      );
      expect(iso(previous), `${where} previous`).toBe(iso(row.previous));
      expect(iso(next), `${where} next`).toBe(iso(row.next));
    }
  });

  it("brackets settlement with the pair it reports, over the whole transcript", () => {
    // An agreement on dates that did not surround settlement would be an
    // agreement about the wrong period.
    for (const row of COUPON_REFERENCE) {
      const position = couponPosition(
        row.settlement,
        row.maturity,
        row.frequency,
        row.basis,
      );
      expect(position.previous).toBeLessThanOrEqual(row.settlement);
      expect(position.next).toBeGreaterThan(row.settlement);
      expect(position.daysBefore + position.daysAfter).toBe(position.periodDays);
    }
  });
});

describe("the month-end rule", () => {
  it("puts a month-end maturity below the 31st on month ends", () => {
    // The mirror of the 31st case, which a day-of-month clamp gets right by
    // accident. These are the dates the clamp got wrong.
    const september = s(2019, 9, 30);
    expect(couponDateBack(september, 2, 1)).toBe(s(2019, 3, 31));
    expect(couponDateBack(september, 2, 2)).toBe(s(2018, 9, 30));
    expect(couponDateBack(september, 4, 1)).toBe(s(2019, 6, 30));
    expect(couponDateBack(september, 4, 3)).toBe(s(2018, 12, 31));

    const february = s(2013, 2, 28);
    expect(couponDateBack(february, 2, 1)).toBe(s(2012, 8, 31));
    expect(couponDateBack(february, 2, 2)).toBe(s(2012, 2, 29));
    expect(couponDateBack(february, 4, 1)).toBe(s(2012, 11, 30));
  });

  it("treats two month-end maturities under one rule, not two", () => {
    // The defect, stated as the thing a reader would check: both of these
    // mature on the last day of a month, so both schedules are month-end
    // schedules. Under a day-of-month clamp only the August one was.
    for (const maturity of [s(2019, 8, 31), s(2019, 9, 30), s(2019, 11, 30)]) {
      expect(isMonthEnd(maturity)).toBe(true);
      for (let step = 1; step <= 6; step += 1) {
        const date = couponDateBack(maturity, 2, step);
        expect(isMonthEnd(date), `${iso(maturity)} step ${step} -> ${iso(date)}`).toBe(
          true,
        );
      }
    }
  });

  it("leaves a maturity one day inside its month alone", () => {
    // The rule has to stop at the boundary. A maturity on the 29th of a
    // 30-day month keeps the 29th, including where the target month is short
    // enough to clamp it further.
    const maturity = s(2019, 9, 29);
    expect(couponDateBack(maturity, 2, 1)).toBe(s(2019, 3, 29));
    expect(couponDateBack(maturity, 4, 2)).toBe(s(2019, 3, 29));
    expect(isMonthEnd(couponDateBack(maturity, 2, 1))).toBe(false);

    // And a non-month-end maturity still clamps into February rather than
    // spilling over, which is the behaviour the rule replaced for month ends
    // and kept for everything else.
    expect(couponDateBack(s(2019, 8, 30), 2, 1)).toBe(s(2019, 2, 28));
    expect(couponDateBack(s(2020, 8, 30), 2, 1)).toBe(s(2020, 2, 29));
  });

  it("does not move a maturity on the 31st, which the clamp already placed", () => {
    const maturity = s(2030, 8, 31);
    expect(couponDateBack(maturity, 4, 1)).toBe(s(2030, 5, 31));
    expect(couponDateBack(maturity, 4, 2)).toBe(s(2030, 2, 28));
    expect(couponDateBack(maturity, 4, 3)).toBe(s(2029, 11, 30));
    expect(couponDateBack(maturity, 2, 1)).toBe(s(2030, 2, 28));
  });
});

describe("which bases can see a schedule error", () => {
  // Both halves. A 30/360 grid pulls a 31st back to a 30th, so moving the
  // previous coupon from 30 to 31 March is *invisible* on bases 0 and 4 — and
  // the period length on every basis but actual/actual is a constant, so
  // moving the next coupon is invisible on all four of the others. Which is
  // why a schedule built on the wrong rule could price a month-end bond and
  // leave a whole suite green.

  const settlement = s(2019, 5, 1);
  const maturity = s(2019, 9, 30);
  /** Where the clamp put the previous coupon, and where the rule puts it. */
  const clamped = s(2019, 3, 30);
  const monthEnd = s(2019, 3, 31);

  it("counts the accrual from the month end, not from the clamped date", () => {
    for (const basis of ALL_BASES) {
      const observed = plain.num(
        `=COUPDAYBS(${settlement},${maturity},2,${basis})`,
      );
      expect(observed, `basis ${basis}`).toBe(
        basisDays(monthEnd, settlement, basis),
      );
    }
  });

  it("separates the two candidate dates on the three actual bases", () => {
    for (const basis of [1, 2, 3] as const) {
      const fromClamped = basisDays(clamped, settlement, basis);
      const fromMonthEnd = basisDays(monthEnd, settlement, basis);
      expect(fromClamped - fromMonthEnd, `basis ${basis}`).toBe(1);
      expect(plain.num(`=COUPDAYBS(${settlement},${maturity},2,${basis})`)).toBe(
        fromMonthEnd,
      );
    }
  });

  it("cannot separate them at all on the two 30/360 bases", () => {
    // Not a weakness of the test: 30 and 31 March are the same day on a
    // 30/360 grid, so no accrual figure on basis 0 or 4 could ever have
    // reported this. The exposure there is the date itself.
    for (const basis of [0, 4] as const) {
      expect(basisDays(clamped, settlement, basis), `basis ${basis}`).toBe(
        basisDays(monthEnd, settlement, basis),
      );
    }
    for (const basis of [0, 4] as const) {
      expect(
        iso(plain.num(`=COUPPCD(${settlement},${maturity},2,${basis})`)),
      ).toBe("2019-03-31");
    }
  });

  it("only actual/actual prices a wrong next coupon differently", () => {
    // A February-end bond, where the rule moves the *next* coupon from 28 to
    // 31 August. Every basis but 1 divides by a fixed period length, so the
    // accrual is unchanged on four of the five and the price moves on one.
    const feb = s(2013, 2, 28);
    const may = s(2010, 5, 1);
    const periods = ALL_BASES.map((basis) =>
      plain.num(`=COUPDAYS(${may},${feb},2,${basis})`),
    );
    expect(periods).toEqual([180, 184, 180, 182.5, 180]);
    // 184 is the real length of 28 February to 31 August 2010; 181 would be
    // the length of the period the clamp described.
    expect(daysBetween(s(2010, 2, 28), s(2010, 8, 31))).toBe(184);
    expect(daysBetween(s(2010, 2, 28), s(2010, 8, 28))).toBe(181);
    for (const basis of ALL_BASES) {
      expect(
        iso(plain.num(`=COUPNCD(${may},${feb},2,${basis})`)),
        `basis ${basis}`,
      ).toBe("2010-08-31");
    }
  });
});

describe("a month-end bond priced on the corrected schedule", () => {
  it("prices the September bond, with the two blind bases agreeing", () => {
    const at = (basis: DayCountBasis) =>
      plain.num(
        `=PRICE(DATE(2019,5,1),DATE(2019,9,30),0.05,0.045,100,2,${basis})`,
      );
    expect(at(1)).toBeCloseTo(100.19607145, 7);
    expect(at(2)).toBeCloseTo(100.19528811, 7);
    expect(at(3)).toBeCloseTo(100.19594263, 7);
    // Bases 0 and 4 land on the same price here and on the same price as
    // basis 2, because all three count 31 days over a 180-day period.
    expect(at(0)).toBe(at(4));
    expect(at(0)).toBe(at(2));
  });

  it("prices the February bond, where only actual/actual moved", () => {
    const at = (basis: DayCountBasis) =>
      plain.num(
        `=PRICE(DATE(2010,5,1),DATE(2013,2,28),0.05,0.045,100,2,${basis})`,
      );
    expect(at(0)).toBeCloseTo(101.30880593, 7);
    expect(at(1)).toBeCloseTo(101.30924461, 7);
    expect(at(2)).toBeCloseTo(101.30754579, 7);
    expect(at(3)).toBeCloseTo(101.30861595, 7);
    expect(at(4)).toBeCloseTo(101.30628721, 7);
  });

  it("still inverts: the yield of the price it was priced at", () => {
    for (const basis of ALL_BASES) {
      for (const [settlement, maturity] of [
        ["DATE(2019,5,1)", "DATE(2019,9,30)"],
        ["DATE(2010,5,1)", "DATE(2013,2,28)"],
        ["DATE(2010,5,1)", "DATE(2012,2,29)"],
      ] as const) {
        const price = plain.num(
          `=PRICE(${settlement},${maturity},0.05,0.045,100,2,${basis})`,
        );
        expect(
          plain.num(
            `=YIELD(${settlement},${maturity},0.05,${price},100,2,${basis})`,
          ),
          `basis ${basis} ${maturity}`,
        ).toBeCloseTo(0.045, 8);
      }
    }
  });

  it("leaves a bond maturing inside its month exactly where it was", () => {
    expect(
      iso(plain.num("=COUPPCD(DATE(2026,3,17),DATE(2030,11,15),2,1)")),
    ).toBe("2025-11-15");
    expect(
      iso(plain.num("=COUPNCD(DATE(2026,3,17),DATE(2030,11,15),2,1)")),
    ).toBe("2026-05-15");
    expect(
      plain.num("=PRICE(DATE(2008,2,15),DATE(2017,11,15),0.0575,0.065,100,2,0)"),
    ).toBeCloseTo(94.63436162, 7);
  });
});
