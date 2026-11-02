import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import {
  ScheduleError,
  amortisationSchedule,
  steppedSchedule,
} from "../src/analysis/amortisation.js";
import type { RateStep, Schedule } from "../src/analysis/amortisation.js";
import {
  amortiseCommand,
  parseAmortiseCommand,
} from "../src/analysis/commands.js";
import type { LoanTerms } from "../src/functions/amortisation.js";

const SMALL: LoanTerms = { rate: 0.01, nper: 6, pv: 1000, fv: 0, type: 0 };
const MORTGAGE: LoanTerms = {
  rate: 0.055 / 12,
  nper: 360,
  pv: 200_000,
  fv: 0,
  type: 0,
};

const COLUMNS = ["opening", "payment", "interest", "principal", "closing"] as const;

/** The largest gap between two schedules over every row and every column. */
function widestGap(left: Schedule, right: Schedule): number {
  expect(left.periods.length).toBe(right.periods.length);
  let worst = 0;
  for (let i = 0; i < left.periods.length; i++) {
    for (const column of COLUMNS) {
      worst = Math.max(
        worst,
        Math.abs(left.periods[i]![column] - right.periods[i]![column]),
      );
    }
  }
  return worst;
}

describe("a schedule with no steps in it", () => {
  it("is the single-rate schedule, to the last bit", () => {
    // Not a delegation: `steppedSchedule` computes this through the segment
    // path, so the two builders agreeing is a check on the segment arithmetic
    // and not a tautology. Over one segment there is nothing to chain, so the
    // agreement is exact rather than close.
    for (const terms of [SMALL, MORTGAGE, { ...SMALL, rate: 0 }]) {
      expect(widestGap(steppedSchedule(terms, []), amortisationSchedule(terms))).toBe(0);
    }
  });

  it("reports one segment, covering the whole term", () => {
    const flat = amortisationSchedule(MORTGAGE);
    expect(flat.segments).toEqual([
      { from: 1, through: 360, rate: MORTGAGE.rate, payment: flat.payment },
    ]);
    expect(flat.periods.every((row) => row.rate === MORTGAGE.rate)).toBe(true);
  });
});

describe("a schedule whose steps name the rate it already had", () => {
  it("is the single-rate schedule to within the boundary residue", () => {
    // Every boundary chains: the balance entering a segment is carried from
    // the closed form of the one before it. This is the only place error can
    // collect, and these are the two halves of the claim -- it is there, and
    // it is this small.
    const steps: RateStep[] = [60, 120, 180, 240, 300].map((from) => ({
      from,
      rate: MORTGAGE.rate,
    }));
    const gap = widestGap(
      steppedSchedule(MORTGAGE, steps),
      amortisationSchedule(MORTGAGE),
    );
    expect(gap).toBeGreaterThan(0);
    expect(gap / MORTGAGE.pv).toBeLessThan(1e-13);
    // Measured at 1.892e-10 absolute on a 200,000 loan over five boundaries
    // -- 9.5e-16 of the principal, which is a handful of units in the last
    // place of a double and does not grow with the number of boundaries: one
    // gives 2.328e-10 and eleven give 1.528e-10. A tolerance that caught
    // nothing would pass the second assertion and fail the first.
    expect(gap).toBeLessThan(1e-8);
  });

  it("still totals to the loan", () => {
    const stepped = steppedSchedule(MORTGAGE, [{ from: 181, rate: MORTGAGE.rate }]);
    expect(stepped.totalPrincipal).toBeCloseTo(-MORTGAGE.pv, 6);
    expect(stepped.periods.at(-1)!.closing).toBe(0);
  });
});

describe("a schedule whose rate moves", () => {
  const stepped = steppedSchedule(SMALL, [{ from: 4, rate: 0.02 }]);

  it("charges each row's own rate on each row's own opening", () => {
    for (const row of stepped.periods) {
      // Exactly, not nearly: the row's interest is that product and nothing
      // else, which is what makes a rate column readable beside it.
      expect(row.interest).toBe(-(row.opening * row.rate));
    }
    expect(stepped.periods.map((row) => row.rate)).toEqual([
      0.01, 0.01, 0.01, 0.02, 0.02, 0.02,
    ]);
  });

  it("carries every closing balance into the next opening", () => {
    for (let i = 0; i + 1 < stepped.periods.length; i++) {
      expect(stepped.periods[i]!.closing).toBeCloseTo(
        stepped.periods[i + 1]!.opening,
        10,
      );
      expect(stepped.periods[i]!.opening + stepped.periods[i]!.principal).toBeCloseTo(
        stepped.periods[i]!.closing,
        10,
      );
    }
    expect(stepped.periods.at(-1)!.closing).toBe(0);
    expect(stepped.totalPrincipal).toBeCloseTo(-SMALL.pv, 10);
  });

  it("re-amortises the payment at the step and holds it level between steps", () => {
    const twice = steppedSchedule(SMALL, [
      { from: 3, rate: 0.02 },
      { from: 5, rate: 0.03 },
    ]);
    expect(twice.segments.map((segment) => [segment.from, segment.through])).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    const payments = twice.segments.map((segment) => segment.payment);
    // Level inside a segment.
    for (const segment of twice.segments) {
      const inside = twice.periods.filter(
        (row) => row.period >= segment.from && row.period < segment.through,
      );
      for (const row of inside) expect(row.payment).toBe(segment.payment);
    }
    // And different across one -- asserted, because an implementation that
    // never recomputed the payment would satisfy everything above.
    expect(new Set(payments).size).toBe(3);
    expect(payments[1]).toBeLessThan(payments[0]!);
    expect(payments[2]).toBeLessThan(payments[1]!);
    // The last row's payment absorbs the residue, so it is the one row that
    // may differ from its own segment's.
    expect(twice.periods.at(-1)!.payment).toBeCloseTo(payments[2]!, 8);
  });

  it("lands exactly on a balloon", () => {
    const balloon = steppedSchedule(
      { ...SMALL, fv: -100 },
      [{ from: 4, rate: 0.02 }],
    );
    expect(balloon.periods.at(-1)!.closing).toBe(100);
    expect(balloon.totalPrincipal).toBeCloseTo(-900, 10);
  });

  it("works when the rate steps to zero and away from it", () => {
    const toZero = steppedSchedule(SMALL, [{ from: 4, rate: 0 }]);
    expect(toZero.periods.slice(3).every((row) => row.interest === 0)).toBe(true);
    expect(toZero.periods.at(-1)!.closing).toBe(0);
    const fromZero = steppedSchedule({ ...SMALL, rate: 0 }, [{ from: 4, rate: 0.02 }]);
    expect(fromZero.periods[0]!.interest).toBe(0);
    expect(fromZero.periods[3]!.interest).toBeLessThan(0);
    expect(fromZero.periods.at(-1)!.closing).toBe(0);
  });

  it("steps on the last period, which is one row at the new rate", () => {
    const late = steppedSchedule(SMALL, [{ from: 6, rate: 0.02 }]);
    expect(late.segments.length).toBe(2);
    expect(late.periods[5]!.rate).toBe(0.02);
    expect(late.periods.at(-1)!.closing).toBe(0);
  });
});

describe("what a step costs", () => {
  const lo = 0.055 / 12;
  const hi = 0.07 / 12;
  const flatLo = amortisationSchedule({ ...MORTGAGE, rate: lo });
  const flatHi = amortisationSchedule({ ...MORTGAGE, rate: hi });
  const up = steppedSchedule({ ...MORTGAGE, rate: lo }, [{ from: 181, rate: hi }]);
  const down = steppedSchedule({ ...MORTGAGE, rate: hi }, [{ from: 181, rate: lo }]);

  it("sits strictly between the two flat loans", () => {
    for (const schedule of [up, down]) {
      expect(schedule.totalInterest).toBeLessThan(flatLo.totalInterest);
      expect(schedule.totalInterest).toBeGreaterThan(flatHi.totalInterest);
    }
  });

  it("is not the average of them, which is the naive reading", () => {
    // Half the term at each rate, so the average of the two flat loans looks
    // like the answer. It is out by 6% in one direction and 5% in the other,
    // and the two are not even on the same side of it.
    const average = (flatLo.totalInterest + flatHi.totalInterest) / 2;
    const upError = (up.totalInterest - average) / average;
    const downError = (down.totalInterest - average) / average;
    expect(upError).toBeLessThan(-0.05);
    expect(upError).toBeGreaterThan(-0.07);
    expect(downError).toBeGreaterThan(0.05);
    expect(downError).toBeLessThan(0.06);
  });

  it("depends on which way round the two rates come", () => {
    // The same two rates over the same two halves, 28,000 apart on a 200,000
    // loan. Low first is cheaper, because the low rate is charged while the
    // balance is still large.
    // Interest is negative, so the dearer loan is the lower number: the one
    // that pays the high rate first charges more of it.
    expect(down.totalInterest).toBeLessThan(up.totalInterest);
    const spread = Math.abs(down.totalInterest) - Math.abs(up.totalInterest);
    expect(spread).toBeGreaterThan(27_000);
    expect(spread).toBeLessThan(29_000);
    // And the mechanism, which is the part that is easy to get backwards: the
    // high-rate-first loan has the *larger* payment and still amortises more
    // slowly, because more of each payment is interest.
    expect(down.segments[0]!.payment).toBeLessThan(up.segments[0]!.payment);
    expect(down.periods[179]!.closing).toBeGreaterThan(up.periods[179]!.closing);
  });
});

describe("terms a stepped schedule refuses", () => {
  it("refuses a step that is not a period inside the term", () => {
    expect(() => steppedSchedule(SMALL, [{ from: 1, rate: 0.02 }])).toThrow(
      /period 2 or later/,
    );
    expect(() => steppedSchedule(SMALL, [{ from: 7, rate: 0.02 }])).toThrow(
      /past the last period, 6/,
    );
    expect(() => steppedSchedule(SMALL, [{ from: 3.5, rate: 0.02 }])).toThrow(
      /whole period/,
    );
    expect(() => steppedSchedule(SMALL, [{ from: 3, rate: Number.NaN }])).toThrow(
      /finite/,
    );
  });

  it("refuses steps written out of order or twice at one period", () => {
    const out = [
      { from: 4, rate: 0.02 },
      { from: 3, rate: 0.03 },
    ];
    expect(() => steppedSchedule(SMALL, out)).toThrow(/in order/);
    const twice = [
      { from: 4, rate: 0.02 },
      { from: 4, rate: 0.03 },
    ];
    expect(() => steppedSchedule(SMALL, twice)).toThrow(/in order/);
  });

  it("refuses a step with payments in advance, and says why", () => {
    expect(() =>
      steppedSchedule({ ...SMALL, type: 1 }, [{ from: 4, rate: 0.02 }]),
    ).toThrow(ScheduleError);
    expect(() =>
      steppedSchedule({ ...SMALL, type: 1 }, [{ from: 4, rate: 0.02 }]),
    ).toThrow(/accrued over the previous period at the old one/);
    // With no steps there is no such row, so the refusal does not apply.
    expect(widestGap(
      steppedSchedule({ ...SMALL, type: 1 }, []),
      amortisationSchedule({ ...SMALL, type: 1 }),
    )).toBe(0);
  });
});

describe("the .amortise command with steps", () => {
  it("reads a reset quoted the way a term sheet quotes it", () => {
    const parsed = parseAmortiseCommand("200000 at 5.5%/12 over 360 then 7% from 181");
    expect(typeof parsed).not.toBe("string");
    if (typeof parsed === "string") return;
    // The reset inherits the loan's own divisor: 7% a year, not 7% a month.
    expect(parsed.steps).toEqual([{ from: 181, rate: 0.07 / 12 }]);
    expect(parsed.rate).toBe(0.055 / 12);
  });

  it("takes a divisor of its own when one is written", () => {
    const parsed = parseAmortiseCommand("200000 at 5.5%/12 over 360 then 7%/4 from 181");
    if (typeof parsed === "string") throw new Error(parsed);
    expect(parsed.steps).toEqual([{ from: 181, rate: 0.07 / 4 }]);
  });

  it("takes more than one, in the order written", () => {
    const parsed = parseAmortiseCommand(
      "1000 at 1% over 6 then 2% from 3 then 3% from 5",
    );
    if (typeof parsed === "string") throw new Error(parsed);
    expect(parsed.steps).toEqual([
      { from: 3, rate: 0.02 },
      { from: 5, rate: 0.03 },
    ]);
  });

  it("reads a step on either side of a balloon or a target", () => {
    for (const tail of [
      "1000 at 1% over 6 then 2% from 4 balloon 100",
      "1000 at 1% over 6 then 2% from 4 into B2",
    ]) {
      const parsed = parseAmortiseCommand(tail);
      if (typeof parsed === "string") throw new Error(`${tail}: ${parsed}`);
      expect(parsed.steps).toEqual([{ from: 4, rate: 0.02 }]);
    }
  });

  it("prints a rate column only once there is more than one rate", () => {
    const book = new Workbook();
    const stepped = amortiseCommand(book, "1000 at 1% over 6 then 2% from 4");
    expect(stepped).toMatch(/period\s+rate\s+opening/);
    expect(stepped).toContain("2.0000%");
    const flat = amortiseCommand(book, "1000 at 1% over 6");
    expect(flat).toMatch(/period\s+opening/);
    expect(flat).not.toContain("rate");
  });

  it("writes the rate into the sheet only on the same condition", () => {
    const stepped = new Workbook();
    expect(amortiseCommand(stepped, "1000 at 1% over 3 then 2% from 3 into A1")).toContain(
      "28 cell(s)",
    );
    expect(stepped.getDisplay("B1")).toBe("Rate");
    expect(stepped.getValue("B4")).toBe(0.02);
    expect(stepped.getValue("G4")).toBe(0);

    const flat = new Workbook();
    // Unchanged, down to the cell count: six columns and no rate among them.
    expect(amortiseCommand(flat, "1000 at 1% over 3 into A1")).toContain("24 cell(s)");
    expect(flat.getDisplay("B1")).toBe("Opening");
  });

  it("reports the refusals rather than throwing out of the shell", () => {
    const book = new Workbook();
    expect(amortiseCommand(book, "1000 at 1% over 6 then 2% from 1")).toContain(
      "not a period a rate can step at",
    );
    expect(amortiseCommand(book, "1000 at 1% over 6 then 2% from 9")).toContain(
      "past the last period",
    );
    expect(
      amortiseCommand(book, "1000 at 1% over 6 in advance then 2% from 4"),
    ).toContain("do not combine");
    expect(amortiseCommand(book, "1000 at 1% over 6 then zz% from 4")).toContain(
      "not a rate",
    );
  });
});
