import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import { serialFromCivil } from "../src/date/serial.js";
import {
  couponDateBack,
  couponPosition,
  couponsRemaining,
  isCouponFrequency,
} from "../src/date/coupons.js";
import type { Value } from "../src/engine/value.js";

function sheet(cells: Record<string, string | number | boolean> = {}) {
  const book = new Workbook();
  book.setCells(cells);
  return {
    eval(formula: string): Value {
      book.setCell("Z100", formula);
      return book.getValue("Z100");
    },
    display(formula: string): string {
      book.setCell("Z100", formula);
      return book.getDisplay("Z100");
    },
    num(formula: string): number {
      const value = this.eval(formula);
      if (typeof value !== "number") {
        throw new Error(`${formula} produced ${JSON.stringify(value)}`);
      }
      return value;
    },
    text(formula: string): string {
      const value = this.eval(formula);
      if (typeof value !== "string") {
        throw new Error(`${formula} produced ${JSON.stringify(value)}`);
      }
      return value;
    },
  };
}

const plain = sheet();
const s = (y: number, m: number, d: number) => serialFromCivil(y, m, d);

describe("coupon schedules", () => {
  it("steps back from maturity, not forward from issue", () => {
    const maturity = s(2030, 11, 15);
    expect(couponDateBack(maturity, 2, 0)).toBe(maturity);
    expect(couponDateBack(maturity, 2, 1)).toBe(s(2030, 5, 15));
    expect(couponDateBack(maturity, 2, 3)).toBe(s(2029, 5, 15));
    expect(couponDateBack(maturity, 4, 3)).toBe(s(2030, 2, 15));
    expect(couponDateBack(maturity, 1, 2)).toBe(s(2028, 11, 15));
  });

  it("keeps a month-end schedule on month ends", () => {
    // Every step is taken from maturity, so a clamp never compounds: a bond
    // maturing on the 31st still pays on the 31st of every long month.
    const maturity = s(2030, 8, 31);
    expect(couponDateBack(maturity, 4, 1)).toBe(s(2030, 5, 31));
    expect(couponDateBack(maturity, 4, 2)).toBe(s(2030, 2, 28));
    expect(couponDateBack(maturity, 4, 3)).toBe(s(2029, 11, 30));
    expect(couponDateBack(maturity, 4, 4)).toBe(s(2029, 8, 31));
  });

  it("counts the coupons still to come", () => {
    const maturity = s(2030, 11, 15);
    expect(couponsRemaining(s(2030, 11, 14), maturity, 2)).toBe(1);
    expect(couponsRemaining(s(2030, 5, 16), maturity, 2)).toBe(1);
    expect(couponsRemaining(s(2030, 5, 14), maturity, 2)).toBe(2);
    expect(couponsRemaining(s(2026, 3, 17), maturity, 2)).toBe(10);
    expect(couponsRemaining(s(2026, 3, 17), maturity, 4)).toBe(19);
  });

  it("does not count a coupon paid on the settlement date itself", () => {
    const maturity = s(2030, 11, 15);
    expect(couponsRemaining(s(2030, 5, 15), maturity, 2)).toBe(1);
    const position = couponPosition(s(2030, 5, 15), maturity, 2, 0);
    expect(position.previous).toBe(s(2030, 5, 15));
    expect(position.next).toBe(maturity);
    expect(position.daysBefore).toBe(0);
  });

  it("splits the period exactly, whatever the basis", () => {
    for (const basis of [0, 1, 2, 3, 4] as const) {
      for (const frequency of [1, 2, 4] as const) {
        const position = couponPosition(
          s(2026, 3, 17),
          s(2033, 9, 30),
          frequency,
          basis,
        );
        expect(position.daysBefore + position.daysAfter).toBeCloseTo(
          position.periodDays,
          12,
        );
        expect(position.previous).toBeLessThanOrEqual(s(2026, 3, 17));
        expect(position.next).toBeGreaterThan(s(2026, 3, 17));
      }
    }
  });

  it("knows which frequencies a bond may pay at", () => {
    expect(isCouponFrequency(1)).toBe(true);
    expect(isCouponFrequency(2)).toBe(true);
    expect(isCouponFrequency(4)).toBe(true);
    expect(isCouponFrequency(3)).toBe(false);
    expect(isCouponFrequency(12)).toBe(false);
  });
});

describe("the coupon-position functions", () => {
  // The published worked example: settled 25 January 2011, maturing
  // 15 November 2011, semi-annual, actual/actual.
  const args = "DATE(2011,1,25),DATE(2011,11,15),2,1";

  it("reproduces the published day counts", () => {
    expect(plain.num(`=COUPDAYBS(${args})`)).toBe(71);
    expect(plain.num(`=COUPDAYS(${args})`)).toBe(181);
    expect(plain.num(`=COUPDAYSNC(${args})`)).toBe(110);
    expect(plain.text(`=TEXT(COUPPCD(${args}),"yyyy-mm-dd")`)).toBe("2010-11-15");
    expect(plain.text(`=TEXT(COUPNCD(${args}),"yyyy-mm-dd")`)).toBe("2011-05-15");
    expect(plain.num("=COUPNUM(DATE(2007,1,25),DATE(2008,11,15),2,1)")).toBe(4);
  });

  it("adds up on every basis", () => {
    for (const basis of [0, 1, 2, 3, 4]) {
      const before = plain.num(`=COUPDAYBS(DATE(2011,1,25),DATE(2011,11,15),2,${basis})`);
      const after = plain.num(`=COUPDAYSNC(DATE(2011,1,25),DATE(2011,11,15),2,${basis})`);
      const period = plain.num(`=COUPDAYS(DATE(2011,1,25),DATE(2011,11,15),2,${basis})`);
      expect(before + after).toBeCloseTo(period, 12);
    }
  });

  it("makes a 30/360 period exactly half a notional year", () => {
    expect(plain.num("=COUPDAYS(DATE(2011,1,25),DATE(2011,11,15),2,0)")).toBe(180);
    expect(plain.num("=COUPDAYS(DATE(2011,1,25),DATE(2011,11,15),4,0)")).toBe(90);
    expect(plain.num("=COUPDAYS(DATE(2011,1,25),DATE(2011,11,15),2,3)")).toBe(182.5);
  });

  it("refuses terms that are not a bond", () => {
    expect(plain.display("=COUPNUM(DATE(2011,11,15),DATE(2011,1,25),2,0)")).toBe(
      "#NUM!",
    );
    expect(plain.display("=COUPNUM(DATE(2011,1,25),DATE(2011,11,15),3,0)")).toBe(
      "#NUM!",
    );
    expect(plain.display("=COUPNUM(DATE(2011,1,25),DATE(2011,11,15),2,9)")).toBe(
      "#NUM!",
    );
  });
});

describe("PRICE and YIELD", () => {
  it("reproduces the published price", () => {
    expect(
      plain.num("=PRICE(DATE(2008,2,15),DATE(2017,11,15),0.0575,0.065,100,2,0)"),
    ).toBeCloseTo(94.63436162, 7);
  });

  it("reproduces the published yield", () => {
    expect(
      plain.num(
        "=YIELD(DATE(2008,2,15),DATE(2016,11,15),0.0575,95.04287,100,2,0)",
      ),
    ).toBeCloseTo(0.065, 6);
  });

  it("inverts itself across coupons, yields, frequencies and bases", () => {
    for (const [coupon, yld, frequency, basis] of [
      [0.05, 0.04, 2, 0],
      [0.03, 0.075, 4, 1],
      [0.08, 0.02, 1, 3],
      [0, 0.05, 2, 4],
      [0.0625, 0.0625, 2, 2],
    ] as const) {
      const price = plain.num(
        `=PRICE(DATE(2026,3,17),DATE(2033,9,30),${coupon},${yld},100,${frequency},${basis})`,
      );
      expect(
        plain.num(
          `=YIELD(DATE(2026,3,17),DATE(2033,9,30),${coupon},${price},100,${frequency},${basis})`,
        ),
      ).toBeCloseTo(yld, 8);
    }
  });

  it("prices a par bond at par when it settles on a coupon date", () => {
    // Coupon equal to yield, no accrued interest: the price is the redemption.
    expect(
      plain.num("=PRICE(DATE(2026,9,30),DATE(2033,9,30),0.05,0.05,100,2,0)"),
    ).toBeCloseTo(100, 9);
  });

  it("agrees with a discounted cash flow written out by hand", () => {
    // Settling on a coupon date makes every exponent a whole period, so the
    // price is a plain sum nothing in the module computed.
    const coupon = 2.5;
    const periodic = 0.06 / 2;
    let expected = 100 / Math.pow(1 + periodic, 14);
    for (let k = 1; k <= 14; k++) {
      expected += coupon / Math.pow(1 + periodic, k);
    }
    expect(
      plain.num("=PRICE(DATE(2026,9,30),DATE(2033,9,30),0.05,0.06,100,2,0)"),
    ).toBeCloseTo(expected, 9);
  });

  it("falls as the yield rises, and rises as the coupon does", () => {
    const at = (yld: number) =>
      plain.num(
        `=PRICE(DATE(2026,3,17),DATE(2036,3,17),0.05,${yld},100,2,0)`,
      );
    expect(at(0.03)).toBeGreaterThan(at(0.05));
    expect(at(0.05)).toBeGreaterThan(at(0.07));
    const withCoupon = (coupon: number) =>
      plain.num(
        `=PRICE(DATE(2026,3,17),DATE(2036,3,17),${coupon},0.05,100,2,0)`,
      );
    expect(withCoupon(0.06)).toBeGreaterThan(withCoupon(0.04));
  });

  it("prices the last coupon period on simple interest", () => {
    // One coupon left, so the discount is linear rather than compounded — and
    // inverting it still returns the yield it was priced at.
    const price = plain.num(
      "=PRICE(DATE(2026,6,1),DATE(2026,9,30),0.05,0.045,100,2,0)",
    );
    expect(price).toBeCloseTo(100.15043759, 7);
    expect(
      plain.num(`=YIELD(DATE(2026,6,1),DATE(2026,9,30),0.05,${price},100,2,0)`),
    ).toBeCloseTo(0.045, 9);
  });

  it("meets the compounded formula at the boundary between the two rules", () => {
    // A day either side of the second-to-last coupon date, the price must not
    // jump: the two formulas agree in the limit where the stub is a whole
    // period.
    const before = plain.num(
      "=PRICE(DATE(2026,3,30),DATE(2026,9,30),0.05,0.045,100,2,0)",
    );
    const after = plain.num(
      "=PRICE(DATE(2026,4,1),DATE(2026,9,30),0.05,0.045,100,2,0)",
    );
    expect(Math.abs(before - after)).toBeLessThan(0.05);
  });

  it("refuses prices and terms that are not a bond", () => {
    expect(
      plain.display("=PRICE(DATE(2033,1,1),DATE(2026,1,1),0.05,0.05,100,2,0)"),
    ).toBe("#NUM!");
    expect(
      plain.display("=PRICE(DATE(2026,1,1),DATE(2033,1,1),0.05,-0.01,100,2,0)"),
    ).toBe("#NUM!");
    expect(
      plain.display("=PRICE(DATE(2026,1,1),DATE(2033,1,1),0.05,0.05,0,2,0)"),
    ).toBe("#NUM!");
    expect(
      plain.display("=YIELD(DATE(2026,1,1),DATE(2033,1,1),0.05,0,100,2,0)"),
    ).toBe("#NUM!");
  });
});

describe("accrued interest", () => {
  it("reproduces the published figures", () => {
    expect(
      plain.num(
        "=ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0)",
      ),
    ).toBeCloseTo(16.666667, 6);
    expect(
      plain.num("=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,1000,3)"),
    ).toBeCloseTo(20.547945, 6);
  });

  it("is the par amount times the rate times the year fraction", () => {
    const fraction = plain.num(
      "=YEARFRAC(DATE(2026,1,15),DATE(2026,7,20),1)",
    );
    expect(
      plain.num("=ACCRINTM(DATE(2026,1,15),DATE(2026,7,20),0.07,5000,1)"),
    ).toBeCloseTo(5000 * 0.07 * fraction, 9);
  });

  it("refuses a settlement that is not after issue", () => {
    expect(
      plain.display("=ACCRINTM(DATE(2026,6,1),DATE(2026,6,1),0.1,1000,0)"),
    ).toBe("#NUM!");
    expect(
      plain.display("=ACCRINTM(DATE(2026,6,1),DATE(2026,7,1),0,1000,0)"),
    ).toBe("#NUM!");
  });
});

describe("DURATION and MDURATION", () => {
  const args = "DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,1";

  it("reproduces the published durations", () => {
    expect(plain.num(`=DURATION(${args})`)).toBeCloseTo(5.99377496, 7);
    expect(plain.num(`=MDURATION(${args})`)).toBeCloseTo(5.73566981, 7);
  });

  it("differs from Macaulay by exactly one period's discounting", () => {
    expect(plain.num(`=MDURATION(${args})`)).toBeCloseTo(
      plain.num(`=DURATION(${args})`) / (1 + 0.09 / 2),
      12,
    );
  });

  it("equals the term for a bond that pays no coupon", () => {
    // With one cash flow, the weighted average time to a cash flow is the time
    // to that cash flow.
    expect(
      plain.num("=DURATION(DATE(2026,1,1),DATE(2031,1,1),0,0.05,1,0)"),
    ).toBeCloseTo(5, 9);
  });

  it("shortens as the coupon rises", () => {
    const at = (coupon: number) =>
      plain.num(`=DURATION(DATE(2026,1,1),DATE(2036,1,1),${coupon},0.05,2,0)`);
    expect(at(0)).toBeGreaterThan(at(0.04));
    expect(at(0.04)).toBeGreaterThan(at(0.08));
  });

  it("predicts how far the price moves for a small yield change", () => {
    // Modified duration is the first-order price sensitivity, so a one basis
    // point move should be within a hair of it.
    const price = (yld: number) =>
      plain.num(`=PRICE(DATE(2026,1,1),DATE(2036,1,1),0.05,${yld},100,2,0)`);
    const modified = plain.num(
      "=MDURATION(DATE(2026,1,1),DATE(2036,1,1),0.05,0.05,2,0)",
    );
    const predicted = -modified * 0.0001 * price(0.05);
    expect(price(0.0501) - price(0.05)).toBeCloseTo(predicted, 3);
  });
});
