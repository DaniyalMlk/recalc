import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import {
  MAX_SCHEDULE_PERIODS,
  ScheduleError,
  amortisationSchedule,
  writeSchedule,
} from "../src/analysis/amortisation.js";
import {
  amortiseCommand,
  parseAmortiseCommand,
} from "../src/analysis/commands.js";
import type { LoanTerms } from "../src/functions/amortisation.js";
import type { Value } from "../src/engine/value.js";

function sheet(cells: Record<string, string | number | boolean> = {}) {
  const book = new Workbook();
  book.setCells(cells);
  return {
    book,
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

describe("IPMT and PPMT", () => {
  it("matches the published first-period split", () => {
    // 8,000 at 10% nominal over three years, monthly.
    expect(plain.num("=IPMT(0.1/12,1,36,8000)")).toBeCloseTo(-66.666666667, 8);
    expect(plain.num("=PPMT(0.1/12,1,36,8000)")).toBeCloseTo(-191.470830884, 8);
  });

  it("adds up to the instalment in every period", () => {
    const payment = plain.num("=PMT(0.09/12,360,125000)");
    for (const period of [1, 2, 12, 180, 359, 360]) {
      const interest = plain.num(`=IPMT(0.09/12,${period},360,125000)`);
      const principal = plain.num(`=PPMT(0.09/12,${period},360,125000)`);
      expect(interest + principal).toBeCloseTo(payment, 9);
    }
  });

  it("charges the rate on what the previous period left", () => {
    // FV after k-1 payments is the balance the k-th period opens on.
    for (const period of [2, 24, 200]) {
      const opening = plain.num(
        `=FV(0.09/12,${period - 1},PMT(0.09/12,360,125000),125000)`,
      );
      expect(plain.num(`=IPMT(0.09/12,${period},360,125000)`)).toBeCloseTo(
        opening * (0.09 / 12),
        9,
      );
    }
  });

  it("repays exactly the loan over the full term", () => {
    let total = 0;
    for (let period = 1; period <= 60; period++) {
      total += plain.num(`=PPMT(0.06/12,${period},60,30000)`);
    }
    expect(total).toBeCloseTo(-30000, 6);
  });

  it("charges no interest at a zero rate, and repays in equal slices", () => {
    expect(plain.num("=IPMT(0,5,24,5000)")).toBe(0);
    expect(plain.num("=PPMT(0,5,24,5000)")).toBeCloseTo(-5000 / 24, 9);
  });

  it("puts no interest in the first payment of an annuity due", () => {
    expect(plain.num("=IPMT(0.1/12,1,36,8000,0,1)")).toBe(0);
    // And the second payment covers the interest the first payment left behind.
    const payment = plain.num("=PMT(0.1/12,36,8000,0,1)");
    expect(plain.num("=IPMT(0.1/12,2,36,8000,0,1)")).toBeCloseTo(
      (-8000 - payment) * (0.1 / 12),
      9,
    );
  });

  it("still repays the loan exactly as an annuity due", () => {
    let total = 0;
    for (let period = 1; period <= 36; period++) {
      total += plain.num(`=PPMT(0.1/12,${period},36,8000,0,1)`);
    }
    expect(total).toBeCloseTo(-8000, 6);
  });

  it("refuses a period outside the term", () => {
    expect(plain.display("=IPMT(0.05,0,10,1000)")).toBe("#NUM!");
    expect(plain.display("=IPMT(0.05,11,10,1000)")).toBe("#NUM!");
    expect(plain.display("=PPMT(0.05,1,0,1000)")).toBe("#NUM!");
    expect(plain.display("=IPMT(0.05,1,10,1000,0,2)")).toBe("#NUM!");
  });
});

describe("CUMIPMT and CUMPRINC", () => {
  // 125,000 at 9% nominal over thirty years, monthly; the second year.
  const terms = "0.09/12,360,125000,13,24,0";

  it("reproduces the published second-year figures", () => {
    expect(plain.num(`=CUMIPMT(${terms})`)).toBeCloseTo(-11135.23213075, 7);
    expect(plain.num(`=CUMPRINC(${terms})`)).toBeCloseTo(-934.1071234209, 7);
  });

  it("agrees with summing the periods it spans", () => {
    let interest = 0;
    for (let period = 13; period <= 24; period++) {
      interest += plain.num(`=IPMT(0.09/12,${period},360,125000)`);
    }
    expect(plain.num(`=CUMIPMT(${terms})`)).toBeCloseTo(interest, 9);
  });

  it("covers the whole term when asked for it", () => {
    expect(plain.num("=CUMPRINC(0.09/12,360,125000,1,360,0)")).toBeCloseTo(
      -125000,
      6,
    );
    const payment = plain.num("=PMT(0.09/12,360,125000)");
    expect(
      plain.num("=CUMIPMT(0.09/12,360,125000,1,360,0)") +
        plain.num("=CUMPRINC(0.09/12,360,125000,1,360,0)"),
    ).toBeCloseTo(payment * 360, 6);
  });

  it("refuses a span that is not inside the term", () => {
    expect(plain.display("=CUMIPMT(0.09/12,360,125000,0,24,0)")).toBe("#NUM!");
    expect(plain.display("=CUMIPMT(0.09/12,360,125000,25,24,0)")).toBe("#NUM!");
    expect(plain.display("=CUMIPMT(0.09/12,360,125000,1,361,0)")).toBe("#NUM!");
    expect(plain.display("=CUMPRINC(0.09/12,360,125000,1,24,3)")).toBe("#NUM!");
  });
});

describe("ISPMT", () => {
  it("falls linearly to nothing over the term", () => {
    // Equal principal slices, so the interest is a straight line.
    expect(plain.num("=ISPMT(0.1,0,10,10000)")).toBeCloseTo(-1000, 9);
    expect(plain.num("=ISPMT(0.1,5,10,10000)")).toBeCloseTo(-500, 9);
    expect(plain.num("=ISPMT(0.1,10,10,10000)")).toBeCloseTo(0, 9);
  });

  it("is not the same shape as IPMT", () => {
    const straight = plain.num("=ISPMT(0.1,5,10,10000)");
    const level = plain.num("=IPMT(0.1,6,10,10000)");
    expect(Math.abs(straight - level)).toBeGreaterThan(1);
  });
});

const LOAN: LoanTerms = {
  rate: 0.09 / 12,
  nper: 360,
  pv: 125000,
  fv: 0,
  type: 0,
};

describe("debt schedules", () => {
  it("opens on the loan and closes on nothing", () => {
    const schedule = amortisationSchedule(LOAN);
    expect(schedule.periods).toHaveLength(360);
    expect(schedule.periods[0]!.opening).toBeCloseTo(125000, 9);
    expect(schedule.periods.at(-1)!.closing).toBe(0);
  });

  it("holds its invariants on every row", () => {
    const schedule = amortisationSchedule(LOAN);
    for (const row of schedule.periods) {
      expect(row.closing).toBeCloseTo(row.opening + row.principal, 6);
      expect(row.payment).toBeCloseTo(row.interest + row.principal, 6);
    }
  });

  it("carries each row's opening from the row before it", () => {
    const schedule = amortisationSchedule(LOAN);
    schedule.periods.slice(1).forEach((row, index) => {
      expect(row.opening).toBeCloseTo(schedule.periods[index]!.closing, 6);
    });
  });

  it("totals to the loan and to the interest on it", () => {
    const schedule = amortisationSchedule(LOAN);
    expect(schedule.totalPrincipal).toBeCloseTo(-125000, 6);
    expect(schedule.totalInterest + schedule.totalPrincipal).toBeCloseTo(
      schedule.periods.reduce((sum, row) => sum + row.payment, 0),
      6,
    );
  });

  it("lands exactly on a balloon rather than near it", () => {
    const schedule = amortisationSchedule({
      rate: 0.06 / 4,
      nper: 20,
      pv: 1_000_000,
      fv: -400_000,
      type: 0,
    });
    expect(schedule.periods.at(-1)!.closing).toBe(400_000);
    expect(schedule.totalPrincipal).toBeCloseTo(-600_000, 6);
  });

  it("works at a zero rate", () => {
    const schedule = amortisationSchedule({
      rate: 0,
      nper: 12,
      pv: 6000,
      fv: 0,
      type: 0,
    });
    expect(schedule.payment).toBeCloseTo(-500, 9);
    expect(schedule.totalInterest).toBe(0);
    expect(schedule.periods.at(-1)!.closing).toBe(0);
  });

  it("moves the last payment, not the last balance", () => {
    const schedule = amortisationSchedule({
      rate: 0.0733,
      nper: 7,
      pv: 13_337,
      fv: 0,
      type: 0,
    });
    const last = schedule.periods.at(-1)!;
    expect(last.closing).toBe(0);
    // The residue is tiny, so the final instalment is only a hair from level.
    expect(Math.abs(last.payment - schedule.payment)).toBeLessThan(1e-6);
  });

  it("refuses terms it cannot tabulate", () => {
    expect(() => amortisationSchedule({ ...LOAN, nper: 0 })).toThrow(
      ScheduleError,
    );
    expect(() =>
      amortisationSchedule({ ...LOAN, nper: MAX_SCHEDULE_PERIODS + 1 }),
    ).toThrow(/above the limit/);
    expect(() => amortisationSchedule({ ...LOAN, type: 1 })).toThrow(
      /annuity due/,
    );
  });
});

describe("writing a schedule into the sheet", () => {
  it("lays out headers and one row per period", () => {
    const book = new Workbook();
    const schedule = amortisationSchedule({
      rate: 0.05,
      nper: 10,
      pv: 50_000,
      fv: 0,
      type: 0,
    });
    const { cells } = writeSchedule(book, "D1", schedule);
    expect(cells).toBe(6 * 11);
    expect(book.getValue("D1")).toBe("Period");
    expect(book.getValue("I1")).toBe("Closing");
    expect(book.getValue("D2")).toBe(1);
    expect(book.getValue("E2")).toBeCloseTo(50_000, 9);
    expect(book.getValue("I11")).toBe(0);
  });
});

describe("the .amortise command", () => {
  it("reads a rate quoted the way a term sheet quotes it", () => {
    expect(parseAmortiseCommand("250000 at 5.5%/12 over 360")).toEqual({
      principal: 250000,
      rate: 0.055 / 12,
      periods: 360,
      balloon: 0,
      into: undefined,
    });
    expect(parseAmortiseCommand("50000 at 0.05 over 10")).toMatchObject({
      rate: 0.05,
      periods: 10,
    });
    expect(
      parseAmortiseCommand("1_000_000 at 6%/4 over 20 balloon 400000"),
    ).toMatchObject({ principal: 1000000, balloon: 400000 });
    expect(
      parseAmortiseCommand("50000 at 5% over 10 into D1"),
    ).toMatchObject({ into: "D1" });
  });

  it("says what it wanted when it cannot read the line", () => {
    expect(parseAmortiseCommand("")).toMatch(/usage/);
    expect(parseAmortiseCommand("nonsense")).toMatch(/usage/);
    expect(parseAmortiseCommand("abc at 5% over 10")).toMatch(/not an amount/);
    expect(parseAmortiseCommand("1000 at x% over 10")).toMatch(/not a rate/);
    expect(parseAmortiseCommand("1000 at 5% over 2.5")).toMatch(
      /whole number of periods/,
    );
    expect(parseAmortiseCommand("1000 at 5% over 10 into ZZZZ9")).toMatch(
      /not a cell address/,
    );
  });

  it("prints a short schedule in full and a long one elided", () => {
    const book = new Workbook();
    const short = amortiseCommand(book, "50000 at 5% over 10");
    expect(short).toContain("period");
    expect(short).toContain("total");
    expect(short).not.toContain("more");
    expect(short.split("\n")).toHaveLength(12);

    const long = amortiseCommand(book, "250000 at 5.5%/12 over 360");
    expect(long).toContain("… 348 more");
    expect(long.split("\n")).toHaveLength(15);
  });

  it("writes into the sheet when asked", () => {
    const book = new Workbook();
    const out = amortiseCommand(book, "50000 at 5% over 10 into D1");
    expect(out).toContain("66 cell(s) written at D1");
    expect(book.getValue("D1")).toBe("Period");
    expect(book.getValue("I11")).toBe(0);
  });

  it("reports a refusal rather than throwing", () => {
    const book = new Workbook();
    expect(amortiseCommand(book, "50000 at 5% over 5000")).toMatch(
      /above the limit/,
    );
  });
});
