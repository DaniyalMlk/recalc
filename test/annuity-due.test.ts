import { describe, expect, it } from "vitest";
import {
  amortisationSchedule,
  ScheduleError,
} from "../src/analysis/amortisation.js";
import { amortiseCommand, parseAmortiseCommand } from "../src/analysis/commands.js";
import {
  interestPart,
  levelPayment,
  principalPart,
} from "../src/functions/amortisation.js";
import type { LoanTerms } from "../src/functions/amortisation.js";
import { Workbook } from "../src/engine/workbook.js";

function due(over: Partial<LoanTerms> = {}): LoanTerms {
  return { rate: 0.05, nper: 5, pv: 10000, fv: 0, type: 1, ...over };
}

/**
 * The grid the identities below are checked over.
 *
 * Rates and terms a loan is actually written at. A rate of 25% a period over
 * 360 periods overflows `(1+r)^n` and the closed forms return garbage, which
 * is a pre-existing limit of the arithmetic and not something these
 * identities can say anything about.
 */
const GRID: ReadonlyArray<LoanTerms> = (() => {
  const rows: LoanTerms[] = [];
  for (const rate of [0.05 / 12, 0.09 / 12, 0.04, 0.07]) {
    for (const nper of [3, 5, 12, 60, 120]) {
      for (const pv of [1000, 125000, 2_500_000]) {
        for (const fv of [0, -50000]) {
          rows.push({ rate, nper, pv, fv, type: 1 });
        }
      }
    }
  }
  return rows;
})();

describe("a schedule for payments in advance", () => {
  it("charges no interest in the first period", () => {
    // Nothing has accrued when the first payment is made, so the whole of it
    // repays principal. That is the entire difference between the two
    // conventions, compounded.
    const schedule = amortisationSchedule(due());
    expect(schedule.periods[0]!.interest).toBe(0);
    expect(schedule.periods[0]!.principal).toBeCloseTo(schedule.payment, 10);
    // ...and the ordinary schedule does charge interest there.
    expect(
      amortisationSchedule(due({ type: 0 })).periods[0]!.interest,
    ).toBeLessThan(0);
  });

  it("opens each row where the previous one closed", () => {
    // The single invariant, and the one the refusal used to be protecting.
    // It has real content here: a row's closing balance is its own opening
    // less what the payment repaid, while the next row's opening is the
    // closed form two periods back. Two routes to the same number.
    let worst = 0;
    for (const terms of GRID) {
      const rows = amortisationSchedule(terms).periods;
      for (let i = 0; i + 1 < rows.length; i += 1) {
        const scale = Math.max(1, Math.abs(rows[i]!.closing));
        worst = Math.max(worst, Math.abs(rows[i]!.closing - rows[i + 1]!.opening) / scale);
      }
    }
    // Measured: the worst disagreement over the grid is 9.5e-12, at 120
    // periods of 7% on two and a half million. A bound of 1e-10 catches a
    // change in the arithmetic; 1e-13 would be catching the float.
    expect(worst).toBeLessThan(1e-10);
    expect(worst).toBeGreaterThan(0);
  });

  it("closes each row at its opening plus that period's principal", () => {
    // For payments in advance this is how the closing balance is built, so
    // it is exact by construction and the assertion is really about the
    // ordinary schedule, where the closing balance comes from the closed
    // form instead and the agreement is a result. Both are run, and the
    // exactness is asserted separately for the one that should have it.
    for (const type of [0, 1] as const) {
      let worst = 0;
      for (const terms of GRID) {
        for (const row of amortisationSchedule({ ...terms, type }).periods) {
          const scale = Math.max(1, Math.abs(row.closing));
          worst = Math.max(
            worst,
            Math.abs(row.closing - (row.opening + row.principal)) / scale,
          );
        }
      }
      expect(worst, `type ${type}`).toBeLessThan(1e-10);
      if (type === 1) expect(worst, "by construction in advance").toBe(0);
    }
  });

  it("repays the loan exactly, down to the balloon", () => {
    for (const terms of GRID) {
      const schedule = amortisationSchedule(terms);
      const last = schedule.periods[schedule.periods.length - 1]!;
      // The last row is made to clear, so this is an equality and not a
      // tolerance: a schedule that ends a penny away is the thing the
      // residue absorption exists to prevent. Written as a sum because the
      // module normalises a closing zero to `+0` and `-fv` of zero is `-0`.
      expect(last.closing + terms.fv).toBe(0);
      // The total is a sum of up to 120 rows, so it carries summation error
      // where the final balance does not: a relative bound, measured at a
      // worst of 5.0e-13 across the grid.
      const owed = -(terms.pv + terms.fv);
      expect(
        Math.abs(schedule.totalPrincipal - owed) / Math.abs(owed),
        JSON.stringify(terms),
      ).toBeLessThan(1e-11);
    }
  });

  it("splits every row the way IPMT and PPMT do", () => {
    // The table and the per-period functions must not be able to drift.
    for (const terms of GRID.slice(0, 40)) {
      const schedule = amortisationSchedule(terms);
      schedule.periods.forEach((row, index) => {
        const period = index + 1;
        expect(row.interest, `interest ${period}`).toBeCloseTo(
          interestPart(terms, period),
          6,
        );
        if (period < terms.nper) {
          // The final row is deliberately not the closed form: it absorbs
          // whatever residue is left, which is why it is excluded here and
          // checked by the clearing assertion above instead.
          expect(row.principal, `principal ${period}`).toBeCloseTo(
            principalPart(terms, period),
            6,
          );
          expect(row.payment).toBeCloseTo(levelPayment(terms), 10);
        }
      });
    }
  });

  it("costs less than the same loan paid in arrears, by exactly one period of discounting", () => {
    for (const terms of GRID) {
      const inAdvance = amortisationSchedule(terms);
      const inArrears = amortisationSchedule({ ...terms, type: 0 });
      // The payment is the ordinary one discounted a period, which is the
      // closed-form statement of "you pay sooner, so you pay less".
      expect(inAdvance.payment * (1 + terms.rate)).toBeCloseTo(
        inArrears.payment,
        6,
      );
      expect(Math.abs(inAdvance.totalInterest)).toBeLessThan(
        Math.abs(inArrears.totalInterest),
      );
    }
  });

  it("has the ordinary schedule's principal column, rotated by a row", () => {
    // Not an invariant anyone designed: it falls out of the two conventions
    // sharing a closed form. Worth pinning precisely because nothing in the
    // code says it, so a change that quietly altered the split would show up
    // here first.
    //
    // It holds for the interior rows only. Both schedules override their
    // final row to absorb the residue, so the last row of each is excluded.
    let compared = 0;
    let worst = 0;
    for (const terms of GRID) {
      const advance = amortisationSchedule(terms).periods;
      const arrears = amortisationSchedule({ ...terms, type: 0 }).periods;
      for (let k = 1; k < terms.nper - 1; k += 1) {
        const a = advance[k]!.principal;
        const b = arrears[k - 1]!.principal;
        const scale = Math.max(Math.abs(a), Math.abs(b));
        if (scale > 0) worst = Math.max(worst, Math.abs(a - b) / scale);
        compared += 1;
      }
    }
    expect(compared).toBe(4560);
    // The bound is measured, not chosen: the worst deviation over the grid is
    // 1.2e-12, so 1e-11 catches a real change and 1e-13 would be float noise.
    expect(worst).toBeLessThan(1e-11);
    expect(worst).toBeGreaterThan(0);
  });

  it("is a genuinely different column, not the same one twice", () => {
    // Without this the rotation above would be satisfied by the two
    // schedules simply agreeing everywhere.
    const advance = amortisationSchedule(due()).periods.map((r) => r.principal);
    const arrears = amortisationSchedule(due({ type: 0 })).periods.map(
      (r) => r.principal,
    );
    expect(advance[0]).not.toBeCloseTo(arrears[0]!, 2);
    expect(advance.slice(1)).toEqual(
      arrears.slice(0, -1).map((x) => expect.closeTo(x, 8)),
    );
  });

  it("still refuses the things it refused before", () => {
    expect(() => amortisationSchedule(due({ nper: 0 }))).toThrow(ScheduleError);
    expect(() => amortisationSchedule(due({ nper: 10_000 }))).toThrow(
      /above the limit/,
    );
    expect(() => amortisationSchedule(due({ rate: Number.NaN }))).toThrow(
      /finite/,
    );
  });

  it("leaves the ordinary schedule exactly as it was", () => {
    const rows = amortisationSchedule(due({ type: 0 })).periods;
    expect(rows[0]).toMatchObject({ opening: 10000 });
    expect(rows[0]!.interest).toBeCloseTo(-500, 10);
    expect(rows[0]!.principal).toBeCloseTo(-1809.7479809, 6);
    expect(rows[4]!.closing).toBe(0);
  });
});

describe("the shell asks for it in words", () => {
  it("reads `in advance`", () => {
    expect(parseAmortiseCommand("10000 at 5% over 5")).toMatchObject({ type: 0 });
    expect(parseAmortiseCommand("10000 at 5% over 5 in advance")).toMatchObject({
      type: 1,
      principal: 10000,
      periods: 5,
    });
  });

  it("reads it beside a balloon and a target, in either order", () => {
    expect(
      parseAmortiseCommand("10000 at 5% over 5 in advance balloon 2000"),
    ).toMatchObject({ type: 1, balloon: 2000 });
    expect(
      parseAmortiseCommand("10000 at 5% over 5 in advance into D1"),
    ).toMatchObject({ type: 1, into: "D1" });
  });

  it("names it in the usage line", () => {
    expect(parseAmortiseCommand("")).toContain("in advance");
  });

  it("prints a first row with no interest", () => {
    const text = amortiseCommand(new Workbook(), "10000 at 5% over 5 in advance");
    const first = text.split("\n")[1] as string;
    expect(first).toMatch(/\s1\s+10000\s+-2199\.76\s+0\s/);
    // And the ordinary one does not, so the line above is about the flag.
    const arrears = amortiseCommand(new Workbook(), "10000 at 5% over 5");
    expect(arrears.split("\n")[1]).toMatch(/-500/);
  });

  it("lays an advance schedule into the sheet", () => {
    const book = new Workbook();
    const result = amortiseCommand(book, "10000 at 5% over 5 in advance into D1");
    expect(result).toMatch(/cell\(s\) written at D1/);
    expect(book.getValue("D1")).toBe("Period");
    // Row 1 of the body: no interest, and the payment is all principal.
    expect(book.getValue("G2")).toBe(0);
    expect(book.getValue("H2")).toBeCloseTo(-2199.7599821, 6);
  });
});
