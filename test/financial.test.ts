import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import { solveRate } from "../src/functions/solver.js";
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
  };
}

const plain = sheet();

describe("time value of money", () => {
  it("prices a 30-year mortgage payment", () => {
    // 200,000 at 6% nominal, monthly. The published instalment is 1199.10.
    expect(plain.num("=PMT(0.06/12,360,200000)")).toBeCloseTo(
      -1199.1010503055,
      8,
    );
  });

  it("satisfies the amortisation identity", () => {
    // Paying the computed instalment for the full term must clear the loan:
    // the balance left over is zero, not merely small.
    const balance = plain.num("=FV(0.06/12,360,PMT(0.06/12,360,200000),200000)");
    expect(Math.abs(balance)).toBeLessThan(1e-6);
  });

  it("prices an annuity due below an ordinary annuity", () => {
    const ordinary = plain.num("=PMT(0.005,360,200000)");
    const due = plain.num("=PMT(0.005,360,200000,0,1)");
    expect(due).toBeCloseTo(-1193.1353734383, 8);
    // Paying at the start of each period earns a period of interest, so the
    // instalment is smaller in magnitude.
    expect(Math.abs(due)).toBeLessThan(Math.abs(ordinary));
  });

  it("falls back to simple division at a zero rate", () => {
    expect(plain.num("=PMT(0,10,1000)")).toBe(-100);
    expect(plain.num("=FV(0,10,-100)")).toBe(1000);
    expect(plain.num("=PV(0,10,-100)")).toBe(1000);
    expect(plain.num("=NPER(0,-100,1000)")).toBe(10);
  });

  it("values a 20-year annuity", () => {
    expect(plain.num("=PV(0.08,20,-1000)")).toBeCloseTo(9818.1474074493, 8);
  });

  it("accumulates a savings plan", () => {
    expect(plain.num("=FV(0.06/12,120,-200,-5000)")).toBeCloseTo(
      41872.8530314531,
      7,
    );
  });

  it("inverts PV and FV against each other", () => {
    // PV(r, n, pmt, FV(r, n, pmt, pv)) collapses back to pv exactly, because
    // both are the same annuity identity solved for different unknowns.
    const future = plain.num("=FV(0.07,15,-500,-2000)");
    expect(plain.num(`=PV(0.07,15,-500,${future})`)).toBeCloseTo(-2000, 6);
  });

  it("recovers the term from the payment", () => {
    expect(plain.num("=NPER(0.005,PMT(0.005,360,200000),200000)")).toBeCloseTo(
      360,
      6,
    );
  });

  it("recovers the rate from the payment", () => {
    expect(plain.num("=RATE(360,PMT(0.005,360,200000),200000)")).toBeCloseTo(
      0.005,
      10,
    );
  });

  it("solves a rate that Newton alone would not reach from the default guess", () => {
    // A short, very high-rate loan: the balance curve is steep enough that
    // Newton from 10% overshoots below -1, where the powers stop being real.
    const rate = plain.num("=RATE(4,-2000,5000)");
    expect(rate).toBeCloseTo(0.2186, 3);
    // Verified structurally: the balance really is zero at the returned rate.
    expect(plain.num(`=FV(${rate},4,-2000,5000)`)).toBeCloseTo(0, 6);
  });

  it("returns a negative term when the flows never repay, as a sheet does", () => {
    // Depositing rather than repaying: there is a real solution to the
    // annuity equation, it is just in the past. Reporting #NUM! here would
    // disagree with every spreadsheet.
    expect(plain.num("=NPER(0.1,100,1000)")).toBeCloseTo(-7.2725408973, 9);
  });

  it("reports genuinely impossible inputs", () => {
    // pv + pmt/r is exactly zero, so the term is undefined rather than large.
    expect(plain.display("=NPER(0.1,100,-1000)")).toBe("#NUM!");
    expect(plain.display("=PMT(0.1,0,1000)")).toBe("#NUM!");
    expect(plain.display("=RATE(0,-100,1000)")).toBe("#NUM!");
  });
});

describe("discounted cash flow", () => {
  const project = sheet({
    A1: -70000,
    A2: 12000,
    A3: 15000,
    A4: 18000,
    A5: 21000,
    A6: 26000,
  });

  it("discounts NPV from period one", () => {
    expect(plain.num("=NPV(0.1,100,200,300)")).toBeCloseTo(481.5927873779, 9);
  });

  it("matches the hand-written discount sum", () => {
    const manual = 100 / 1.1 + 200 / 1.1 ** 2 + 300 / 1.1 ** 3;
    expect(plain.num("=NPV(0.1,100,200,300)")).toBeCloseTo(manual, 12);
  });

  it("leaves the period-zero outlay to the caller", () => {
    // The idiom for an investment made today: NPV over the later flows, with
    // the outlay added outside the call rather than passed into it.
    const withOutlay = project.num("=A1+NPV(0.1,A2:A6)");
    const inside = project.num("=NPV(0.1,A1:A6)");
    // Passing the outlay in shifts every flow one period later, so the whole
    // result is the correct one discounted once more.
    expect(inside).toBeCloseTo(withOutlay / 1.1, 9);
    expect(inside).not.toBeCloseTo(withOutlay, 3);
  });

  it("computes IRR", () => {
    expect(project.num("=IRR(A1:A6)")).toBeCloseTo(0.0866309480365, 10);
  });

  it("makes NPV zero at the IRR, which is the definition", () => {
    const irr = project.num("=IRR(A1:A6)");
    const npv = project.num(`=A1+NPV(${irr},A2:A6)`);
    expect(Math.abs(npv)).toBeLessThan(1e-6);
  });

  it("finds an IRR on flows where Newton's method diverges", () => {
    // A late reversal puts a turning point near the root; Newton walks off and
    // the bracketing fallback has to take over.
    const awkward = sheet({
      A1: -1000,
      A2: 6000,
      A3: -11000,
      A4: 6000,
    });
    const irr = awkward.num("=IRR(A1:A4)");
    const check = awkward.num(`=A1+NPV(${irr},A2:A4)`);
    expect(Math.abs(check)).toBeLessThan(1e-6);
  });

  it("refuses flows with no sign change", () => {
    const allPositive = sheet({ A1: 100, A2: 200, A3: 300 });
    expect(allPositive.display("=IRR(A1:A3)")).toBe("#NUM!");
  });

  it("computes MIRR against the published worked example", () => {
    const mirr = sheet({
      A1: -120000,
      A2: 39000,
      A3: 30000,
      A4: 21000,
      A5: 37000,
      A6: 46000,
    });
    expect(mirr.num("=MIRR(A1:A6,0.1,0.12)")).toBeCloseTo(0.1260941303659, 10);
    expect(mirr.num("=MIRR(A1:A4,0.1,0.12)")).toBeCloseTo(-0.048044655250, 10);
    expect(mirr.num("=MIRR(A1:A6,0.1,0.14)")).toBeCloseTo(0.1347591108283, 10);
  });
});

describe("dated cash flows", () => {
  const dated = sheet({
    A1: -10000,
    B1: 0,
    A2: 2750,
    B2: 365,
    A3: 4250,
    B3: 730,
    A4: 3250,
    B4: 1095,
    A5: 2750,
    B5: 1460,
  });

  it("discounts by day count", () => {
    const rate = 0.05;
    const manual =
      -10000 +
      2750 / (1 + rate) ** 1 +
      4250 / (1 + rate) ** 2 +
      3250 / (1 + rate) ** 3 +
      2750 / (1 + rate) ** 4;
    expect(dated.num("=XNPV(0.05,A1:A5,B1:B5)")).toBeCloseTo(manual, 9);
  });

  it("agrees with IRR when the dates are exactly one year apart", () => {
    const xirr = dated.num("=XIRR(A1:A5,B1:B5)");
    const irr = dated.num("=IRR(A1:A5)");
    expect(xirr).toBeCloseTo(irr, 9);
  });

  it("makes XNPV zero at the XIRR", () => {
    const xirr = dated.num("=XIRR(A1:A5,B1:B5)");
    expect(Math.abs(dated.num(`=XNPV(${xirr},A1:A5,B1:B5)`))).toBeLessThan(1e-6);
  });

  it("handles genuinely irregular spacing", () => {
    const irregular = sheet({
      A1: -5000,
      B1: 45000,
      A2: 2000,
      B2: 45050,
      A3: 4000,
      B3: 45400,
    });
    const xirr = irregular.num("=XIRR(A1:A3,B1:B3)");
    expect(
      Math.abs(irregular.num(`=XNPV(${xirr},A1:A3,B1:B3)`)),
    ).toBeLessThan(1e-6);
  });

  it("rejects mismatched or unordered inputs", () => {
    const bad = sheet({ A1: -100, A2: 200, B1: 100, B2: 50 });
    expect(bad.display("=XIRR(A1:A2,B1:B2)")).toBe("#NUM!");
    const short = sheet({ A1: -100, A2: 200, B1: 0 });
    expect(short.display("=XNPV(0.1,A1:A2,B1:B1)")).toBe("#NUM!");
  });

  it("builds serial dates from calendar parts", () => {
    // 2026-01-01 is serial 46023 in the usual spreadsheet epoch.
    expect(plain.num("=DATE(2026,1,1)")).toBe(46023);
    expect(plain.num('=DATEVALUE("2026-01-01")')).toBe(46023);
    expect(plain.num("=DATE(2027,1,1)-DATE(2026,1,1)")).toBe(365);
    expect(plain.num("=DATE(2024,3,1)-DATE(2024,2,1)")).toBe(29);
  });

  it("prices a dated schedule built from DATE", () => {
    const schedule = sheet({
      A1: -1000,
      B1: "=DATE(2026,1,1)",
      A2: 600,
      B2: "=DATE(2026,7,1)",
      A3: 600,
      B3: "=DATE(2027,1,1)",
    });
    const xirr = schedule.num("=XIRR(A1:A3,B1:B3)");
    expect(xirr).toBeGreaterThan(0);
    expect(
      Math.abs(schedule.num(`=XNPV(${xirr},A1:A3,B1:B3)`)),
    ).toBeLessThan(1e-6);
  });
});

describe("depreciation and rate conversion", () => {
  it("computes straight-line depreciation", () => {
    expect(plain.num("=SLN(30000,7500,10)")).toBe(2250);
  });

  it("computes sum-of-years-digits", () => {
    expect(plain.num("=SYD(30000,7500,10,1)")).toBeCloseTo(4090.9090909091, 9);
    expect(plain.num("=SYD(30000,7500,10,10)")).toBeCloseTo(409.0909090909, 9);
  });

  it("makes the SYD schedule sum to the depreciable base", () => {
    let total = 0;
    for (let period = 1; period <= 10; period++) {
      total += plain.num(`=SYD(30000,7500,10,${period})`);
    }
    expect(total).toBeCloseTo(30000 - 7500, 8);
  });

  it("computes declining balance against the published example", () => {
    expect(plain.num("=DDB(2400,300,10,1)")).toBeCloseTo(480, 10);
    expect(plain.num("=DDB(2400,300,10,2)")).toBeCloseTo(384, 10);
  });

  it("never depreciates below salvage", () => {
    let book = 2400;
    for (let period = 1; period <= 10; period++) {
      book -= plain.num(`=DDB(2400,300,10,${period})`);
    }
    expect(book).toBeGreaterThanOrEqual(300 - 1e-9);
  });

  it("converts between nominal and effective rates", () => {
    expect(plain.num("=EFFECT(0.0525,4)")).toBeCloseTo(0.0535426673708, 12);
    expect(plain.num("=NOMINAL(EFFECT(0.0525,4),4)")).toBeCloseTo(0.0525, 12);
  });

  it("rejects invalid depreciation and rate inputs", () => {
    expect(plain.display("=SLN(1,0,0)")).toBe("#NUM!");
    expect(plain.display("=SYD(1,0,10,11)")).toBe("#NUM!");
    expect(plain.display("=DDB(1,0,10,0)")).toBe("#NUM!");
    expect(plain.display("=EFFECT(0.05,0)")).toBe("#NUM!");
    expect(plain.display("=NOMINAL(0,4)")).toBe("#NUM!");
  });
});

describe("solveRate", () => {
  it("finds a root Newton reaches directly", () => {
    const root = solveRate((x) => x - 0.25, { guess: 0.1 });
    expect(root).toBeCloseTo(0.25, 10);
  });

  it("falls back to bracketing when the derivative is useless", () => {
    // Flat everywhere except at the root: the numerical derivative is zero, so
    // Newton cannot take a step and the bracketing search has to find it.
    const f = (x: number) => (x < 0.5 ? -1 : 1);
    const root = solveRate(f, { guess: 0.1, tolerance: 1e-9 });
    expect(root).not.toBeNull();
    expect(root!).toBeCloseTo(0.5, 6);
  });

  it("returns null when there is no root", () => {
    expect(solveRate(() => 1)).toBeNull();
  });

  it("finds a negative rate", () => {
    const root = solveRate((x) => x + 0.3, { guess: 0.1 });
    expect(root).toBeCloseTo(-0.3, 9);
  });
});
