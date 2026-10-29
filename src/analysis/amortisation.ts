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
}

export interface Schedule {
  readonly terms: LoanTerms;
  readonly payment: number;
  readonly periods: readonly SchedulePeriod[];
  /** Interest over the whole term, negative like the payments. */
  readonly totalInterest: number;
  /** Principal over the whole term; it repays the loan exactly. */
  readonly totalPrincipal: number;
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
    });
  }

  const totalInterest = periods.reduce((sum, row) => sum + row.interest, 0);
  const totalPrincipal = periods.reduce((sum, row) => sum + row.principal, 0);

  return { terms: settled, payment, periods, totalInterest, totalPrincipal };
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

  HEADERS.forEach((header, column) => put(column, 0, `'${header}`));
  schedule.periods.forEach((row, index) => {
    put(0, index + 1, row.period);
    put(1, index + 1, row.opening);
    put(2, index + 1, row.payment);
    put(3, index + 1, row.interest);
    put(4, index + 1, row.principal);
    put(5, index + 1, row.closing);
  });

  book.setCells(entries);
  return { cells: Object.keys(entries).length };
}
