/**
 * Debt schedules.
 *
 * `IPMT` and `PPMT` answer for one period. A schedule is the whole loan laid
 * out — opening balance, payment, interest, principal, closing balance, one row
 * per period — which is the form the number is actually used in: covenant
 * headroom is read off it, interest cover is a column of it, and a refinancing
 * is a schedule that stops early.
 *
 * Two decisions shape what comes out.
 *
 * **Rows are computed, not chained.** Each row's opening balance is the closed
 * form for that period rather than the previous row's closing balance. A chain
 * accumulates its own rounding, so a 360-row schedule ends a few pence away
 * from zero and every reader wonders which row is wrong. Here the rows are
 * independent, and the only place error can collect is the last one.
 *
 * **The last payment absorbs the residue.** Even in closed form, the final
 * closing balance is a float, not a zero. Rather than print `-0.0000000001`
 * and pretend, the final row's principal is set to whatever clears the balance
 * exactly and its payment follows. That is what a lender does too: the last
 * instalment on a real loan is a different number from the other 359.
 *
 * **Both annuity conventions, read in the right order.** With payments at the
 * end of a period, a row's interest accrued during that row's own period and
 * the payment at its close settles it. With payments at the start, the
 * payment lands first, so a row's interest is what accrued over the
 * *previous* period — and period 1 carries none, because no time has passed
 * before the first payment.
 *
 * Read that way the five columns mean the same things in both conventions and
 * the same single invariant holds: `closing` of one row is `opening` of the
 * next, and `closing` is `opening` plus the period's principal. What differs
 * is only which period a row's interest accrued in, which is a fact about
 * annuities due rather than a reason not to tabulate one.
 */

import { formatA1, parseA1 } from "../engine/reference.js";
import type { Coord } from "../engine/reference.js";
import type { Address, Workbook } from "../engine/workbook.js";
import {
  balanceAfter,
  interestPart,
  levelPayment,
  principalPart,
} from "../functions/amortisation.js";
import type { LoanTerms } from "../functions/amortisation.js";

/** The most periods a schedule may hold, so a typo cannot hang the sheet. */
export const MAX_SCHEDULE_PERIODS = 2_000;

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

export interface SchedulePeriod {
  /** One-based period number. */
  readonly period: number;
  /** What was owed when the period began, as a positive amount. */
  readonly opening: number;
  /** The instalment, negative in the spreadsheet sign convention. */
  readonly payment: number;
  readonly interest: number;
  readonly principal: number;
  /** What is owed once the period's payment has been made. */
  readonly closing: number;
  /** The periodic rate this row's interest was charged at. */
  readonly rate: number;
}

/** A rate change: from this period onward, this is the rate. */
export interface RateStep {
  /** The first period the new rate applies to; two or more. */
  readonly from: number;
  readonly rate: number;
}

/** A stretch of the term over which the rate, and so the payment, is level. */
export interface RateSegment {
  readonly from: number;
  readonly through: number;
  readonly rate: number;
  /** The instalment this stretch was re-amortised to, negative. */
  readonly payment: number;
}

export interface Schedule {
  readonly terms: LoanTerms;
  readonly payment: number;
  readonly periods: readonly SchedulePeriod[];
  /** Interest over the whole term, negative like the payments. */
  readonly totalInterest: number;
  /** Principal over the whole term; it repays the loan exactly. */
  readonly totalPrincipal: number;
  /**
   * The term cut at its rate changes, one entry per level stretch.
   *
   * A loan on a single rate has exactly one, which is what lets everything
   * downstream read a schedule the same way whether or not its rate moves.
   */
  readonly segments: readonly RateSegment[];
}

/**
 * Build the schedule a set of loan terms implies.
 *
 * Balances are reported as positive amounts owed rather than in the sign
 * convention the payment functions use. A schedule is read by people, and a
 * column of negative opening balances beside negative payments is a column
 * nobody can scan.
 */
/** −0 is a true answer here and a bad one to print, so it is normalised away. */
function unsignZero(n: number): number {
  return n === 0 ? 0 : n;
}

/**
 * What is owed when a period's payment is made.
 *
 * In arrears that is the closed-form balance after the previous period, which
 * includes the interest that accrued during it. In advance the payment lands
 * before any interest accrues, so what it meets is the balance left by the
 * previous payment — the closed form for two periods back, less that payment.
 * Period 1 in advance meets the loan itself, untouched.
 *
 * This is the same quantity `interestPart` charges its rate on, which is why
 * a row's interest is always `opening * rate` outside of period 1.
 */
function openingBalance(
  terms: LoanTerms,
  payment: number,
  period: number,
): number {
  if (terms.type !== 1) return -balanceAfter(terms, period - 1);
  if (period === 1) return terms.pv;
  return -(balanceAfter(terms, period - 2) - payment);
}

export function amortisationSchedule(terms: LoanTerms): Schedule {
  const count = Math.trunc(terms.nper);
  if (!Number.isFinite(terms.rate) || !Number.isFinite(terms.pv)) {
    throw new ScheduleError("the loan terms must be finite numbers");
  }
  if (count < 1) {
    throw new ScheduleError("a schedule needs at least one period");
  }
  if (count > MAX_SCHEDULE_PERIODS) {
    throw new ScheduleError(
      `a schedule of ${count} periods is above the limit of ${MAX_SCHEDULE_PERIODS}`,
    );
  }
  const payment = levelPayment({ ...terms, nper: count });
  const settled: LoanTerms = { ...terms, nper: count };
  const periods: SchedulePeriod[] = [];

  for (let period = 1; period <= count; period++) {
    const opening = openingBalance(settled, payment, period);
    const isLast = period === count;
    const interest = interestPart(settled, period);
    let principal = principalPart(settled, period);
    // With payments in arrears the closed form for the next period's balance
    // is the closing balance directly. With payments in advance it is not:
    // the next period's opening is this payment's balance carried forward
    // *before* interest accrues, which is this row's opening less what the
    // payment repaid. Both forms satisfy `closing = opening + principal`;
    // taking it from the same place in both is what keeps that true.
    let closing =
      settled.type === 1 ? opening + principal : -balanceAfter(settled, period);

    if (isLast) {
      // Clear whatever the closed form left behind, and let the payment move
      // rather than the balance: the balance is the thing a reader checks.
      principal = unsignZero(-(opening + settled.fv));
      closing = unsignZero(-settled.fv);
    }

    periods.push({
      period,
      opening: unsignZero(opening),
      payment: unsignZero(isLast ? interest + principal : payment),
      interest: unsignZero(interest),
      principal,
      closing,
      rate: settled.rate,
    });
  }

  const totalInterest = periods.reduce((sum, row) => sum + row.interest, 0);
  const totalPrincipal = periods.reduce((sum, row) => sum + row.principal, 0);

  return {
    terms: settled,
    payment,
    periods,
    totalInterest,
    totalPrincipal,
    segments: [{ from: 1, through: count, rate: settled.rate, payment }],
  };
}

/**
 * Cut a term at its rate changes.
 *
 * Each segment runs to the period before the next step, or to the end of the
 * term. The steps are checked here rather than where they are used so that a
 * schedule is either built from a coherent set of them or not built at all.
 */
function segmentTerm(
  count: number,
  baseRate: number,
  steps: readonly RateStep[],
): readonly { from: number; through: number; rate: number }[] {
  let previousFrom = 1;
  for (const step of steps) {
    if (!Number.isFinite(step.rate)) {
      throw new ScheduleError("a rate step must be a finite number");
    }
    if (!Number.isInteger(step.from)) {
      throw new ScheduleError(
        `a rate step starts at a whole period, not ${step.from}`,
      );
    }
    if (step.from < 2) {
      throw new ScheduleError(
        "a rate step starts at period 2 or later; period 1 is the loan's own rate",
      );
    }
    if (step.from > count) {
      throw new ScheduleError(
        `a rate step at period ${step.from} is past the last period, ${count}`,
      );
    }
    if (step.from <= previousFrom) {
      throw new ScheduleError(
        "rate steps run in order, one to a period",
      );
    }
    previousFrom = step.from;
  }

  const starts = [1, ...steps.map((step) => step.from)];
  const rates = [baseRate, ...steps.map((step) => step.rate)];
  return starts.map((from, index) => ({
    from,
    through: (starts[index + 1] ?? count + 1) - 1,
    rate: rates[index]!,
  }));
}

/**
 * Build the schedule a loan implies when its rate changes partway.
 *
 * Between two changes the rate is level, so that stretch is an ordinary
 * annuity and the closed form still applies to it — on the balance entering
 * the stretch, over the periods remaining to the original maturity. That last
 * part is the convention a reset actually follows: the lender re-amortises
 * what is left so the loan still retires on its maturity date at the new rate,
 * which is why the payment moves rather than the term.
 *
 * So the rows inside a segment are computed, not chained, exactly as a
 * single-rate schedule's are; only the boundaries chain. The error that can
 * collect is bounded by the number of resets rather than the number of
 * periods, which for any loan anyone writes is a handful.
 *
 * **Payments in advance are refused.** A reset in advance has the two rates
 * meeting inside one row: the payment at the start of the period is the one
 * the new rate re-amortised, while the interest that payment settles accrued
 * over the period just gone, at the old rate. Which of the two the row should
 * report is a question about the instrument, not about arithmetic, and
 * answering it by picking whichever rate the code reached first is how a
 * schedule comes to disagree with the loan it describes.
 */
export function steppedSchedule(
  terms: LoanTerms,
  steps: readonly RateStep[],
): Schedule {
  if (steps.length === 0) {
    // Not a delegation to `amortisationSchedule`: a one-segment stepped
    // schedule going through the same arithmetic as a many-segment one is
    // what makes the agreement between the two builders worth asserting.
    if (terms.type === 1) return amortisationSchedule(terms);
  }
  if (terms.type === 1 && steps.length > 0) {
    throw new ScheduleError(
      "a rate step and payments in advance do not combine: the payment " +
        "starting the period is the new rate's, and the interest it settles " +
        "accrued over the previous period at the old one",
    );
  }

  const count = Math.trunc(terms.nper);
  if (!Number.isFinite(terms.rate) || !Number.isFinite(terms.pv)) {
    throw new ScheduleError("the loan terms must be finite numbers");
  }
  if (count < 1) {
    throw new ScheduleError("a schedule needs at least one period");
  }
  if (count > MAX_SCHEDULE_PERIODS) {
    throw new ScheduleError(
      `a schedule of ${count} periods is above the limit of ${MAX_SCHEDULE_PERIODS}`,
    );
  }

  const cuts = segmentTerm(count, terms.rate, steps);
  const periods: SchedulePeriod[] = [];
  const segments: RateSegment[] = [];
  let entering = terms.pv;

  for (const cut of cuts) {
    // The stretch as a loan in its own right: what is owed entering it, at
    // its rate, over everything left of the original term.
    const remaining = count - cut.from + 1;
    const sub: LoanTerms = {
      rate: cut.rate,
      nper: remaining,
      pv: entering,
      fv: terms.fv,
      type: 0,
    };
    const payment = levelPayment(sub);
    segments.push({
      from: cut.from,
      through: cut.through,
      rate: cut.rate,
      payment,
    });

    for (let local = 1; local <= cut.through - cut.from + 1; local++) {
      const period = cut.from + local - 1;
      const isLast = period === count;
      const opening = -balanceAfter(sub, local - 1);
      const interest = interestPart(sub, local);
      let principal = principalPart(sub, local);
      let closing = -balanceAfter(sub, local);

      if (isLast) {
        principal = unsignZero(-(opening + terms.fv));
        closing = unsignZero(-terms.fv);
      }

      periods.push({
        period,
        opening: unsignZero(opening),
        payment: unsignZero(isLast ? interest + principal : payment),
        interest: unsignZero(interest),
        principal,
        closing,
        rate: cut.rate,
      });
    }

    entering = -balanceAfter(sub, cut.through - cut.from + 1);
  }

  const totalInterest = periods.reduce((sum, row) => sum + row.interest, 0);
  const totalPrincipal = periods.reduce((sum, row) => sum + row.principal, 0);

  return {
    terms: { ...terms, nper: count },
    payment: segments[0]!.payment,
    periods,
    totalInterest,
    totalPrincipal,
    segments,
  };
}

const HEADERS = [
  "Period",
  "Opening",
  "Payment",
  "Interest",
  "Principal",
  "Closing",
] as const;

/**
 * Lay a schedule into the sheet as literals, headers included.
 *
 * Literals rather than formulas for the same reason the sensitivity tables are
 * literals: the rows are a record of what these terms produced, and re-deriving
 * them from a sheet that has since moved on would make them quietly wrong.
 */
export function writeSchedule(
  book: Workbook,
  at: Address,
  schedule: Schedule,
): { cells: number } {
  const origin: Coord =
    typeof at === "string" ? parseA1(at) : { col: at.col, row: at.row };
  const entries: Record<string, string | number> = {};
  const put = (col: number, row: number, input: string | number): void => {
    const address = formatA1({
      col: origin.col + col,
      row: origin.row + row,
      colAbsolute: false,
      rowAbsolute: false,
    });
    entries[address] = input;
  };

  // The rate goes in only when it moves. A column of one repeated number is
  // the loan's heading rather than a column, and a schedule laid into a sheet
  // whose rate does move cannot be audited without it.
  const stepped = schedule.segments.length > 1;
  const headers = stepped
    ? [HEADERS[0], "Rate", ...HEADERS.slice(1)]
    : [...HEADERS];

  headers.forEach((header, column) => put(column, 0, `'${header}`));
  schedule.periods.forEach((row, index) => {
    const values = stepped
      ? [row.period, row.rate, row.opening, row.payment, row.interest, row.principal, row.closing]
      : [row.period, row.opening, row.payment, row.interest, row.principal, row.closing];
    values.forEach((value, column) => put(column, index + 1, value));
  });

  book.setCells(entries);
  return { cells: Object.keys(entries).length };
}
