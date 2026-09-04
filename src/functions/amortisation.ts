/**
 * Splitting an instalment into interest and principal.
 *
 * A level-payment loan pays the same amount every period, but the *shape* of
 * that payment changes: early on it is almost all interest, late on almost all
 * principal. Every debt schedule is that split, and every covenant test, tax
 * computation and interest-cover ratio is downstream of it.
 *
 * There are two ways to compute the split and only one of them is right. The
 * obvious one is to walk the loan period by period, accumulating the balance;
 * it is O(n) per call and, worse, its rounding depends on how many periods came
 * before. The closed form used here comes out of the annuity identity: after
 * `k−1` payments the outstanding balance is a future value, and the interest
 * charged next is the rate on that balance. Nothing accumulates, so `IPMT` for
 * period 300 costs the same as for period 1 and does not depend on the order
 * the sheet happened to evaluate them in.
 *
 * Sign convention throughout is the spreadsheet one: money paid out is
 * negative. A positive `pv` is money borrowed, so the payments that repay it
 * come back negative.
 */

import { NUM_ERROR, isFormulaError } from "../engine/errors.js";
import type { FormulaError } from "../engine/errors.js";
import type { Value } from "../engine/value.js";
import { defineFunction, numberArg } from "./registry.js";
import type { Arg } from "./registry.js";

function guard(n: number): Value {
  if (!Number.isFinite(n)) return NUM_ERROR;
  // A zero-rate loan charges `-balance * 0`, which is a true −0 and a bad thing
  // to hand to a sheet: it prints as `0` but divides as if it were signed.
  return n === 0 ? 0 : n;
}

function optional(
  args: readonly Arg[],
  index: number,
  fallback: number,
): number | FormulaError {
  if (args.length <= index) return fallback;
  const n = numberArg(args[index]);
  return isFormulaError(n) ? n : n;
}

/** The terms every function here reads, in the order spreadsheets write them. */
export interface LoanTerms {
  readonly rate: number;
  readonly nper: number;
  readonly pv: number;
  readonly fv: number;
  /** 1 for payments at the start of each period, 0 at the end. */
  readonly type: 0 | 1;
}

/**
 * The level payment that takes `pv` to `fv` over `nper` periods.
 *
 * The same identity `PMT` uses, restated here rather than imported so the
 * amortisation module stands on its own arithmetic.
 */
export function levelPayment(terms: LoanTerms): number {
  const { rate, nper, pv, fv, type } = terms;
  if (rate === 0) return -(pv + fv) / nper;
  const growth = Math.pow(1 + rate, nper);
  const factor = ((growth - 1) / rate) * (1 + rate * type);
  return -(pv * growth + fv) / factor;
}

/**
 * The balance still outstanding after `periods` payments.
 *
 * This is the future value of the loan under its own payment stream, which is
 * what makes the whole split closed-form.
 */
export function balanceAfter(terms: LoanTerms, periods: number): number {
  const { rate, pv, type } = terms;
  const payment = levelPayment(terms);
  if (rate === 0) return -(pv + payment * periods);
  const growth = Math.pow(1 + rate, periods);
  const factor = ((growth - 1) / rate) * (1 + rate * type);
  return -(pv * growth + payment * factor);
}

/**
 * The interest charged in period `period`, one-based.
 *
 * With payments at the end of a period, the interest is the rate on what was
 * outstanding when the period began. With payments at the start (an annuity
 * due), the first payment is made before any interest has accrued, so period 1
 * carries none; every later period charges interest on the balance *after* that
 * period's payment has already been made, which is why the payment is added
 * back before the rate is applied.
 */
export function interestPart(terms: LoanTerms, period: number): number {
  const { rate, type } = terms;
  const payment = levelPayment(terms);
  let opening: number;
  if (type === 1) {
    opening =
      period === 1 ? 0 : balanceAfter(terms, period - 2) - payment;
  } else {
    opening = balanceAfter(terms, period - 1);
  }
  // `opening` already carries the sign the balance is held in — negative while
  // money is owed — so the interest comes out with the payment's sign.
  return opening * rate;
}

/** The principal repaid in period `period`, one-based. */
export function principalPart(terms: LoanTerms, period: number): number {
  return levelPayment(terms) - interestPart(terms, period);
}

function readTerms(
  args: readonly Arg[],
  periodIndex: number,
  nperIndex: number,
  pvIndex: number,
  fvIndex: number,
  typeIndex: number,
): { terms: LoanTerms; period: number } | FormulaError {
  const rate = numberArg(args[0]);
  if (isFormulaError(rate)) return rate;
  const period = numberArg(args[periodIndex]);
  if (isFormulaError(period)) return period;
  const nper = numberArg(args[nperIndex]);
  if (isFormulaError(nper)) return nper;
  const pv = numberArg(args[pvIndex]);
  if (isFormulaError(pv)) return pv;
  const fv = optional(args, fvIndex, 0);
  if (isFormulaError(fv)) return fv;
  const type = optional(args, typeIndex, 0);
  if (isFormulaError(type)) return type;
  const flag = Math.trunc(type);
  if (flag !== 0 && flag !== 1) return NUM_ERROR;
  if (nper <= 0) return NUM_ERROR;
  if (period < 1 || period > nper) return NUM_ERROR;
  return {
    terms: { rate, nper, pv, fv, type: flag },
    period: Math.trunc(period),
  };
}

defineFunction({
  name: "IPMT",
  description: "The interest part of one payment of a level-payment loan.",
  minArgs: 4,
  maxArgs: 6,
  call(args) {
    const read = readTerms(args, 1, 2, 3, 4, 5);
    if (isFormulaError(read)) return read;
    return guard(interestPart(read.terms, read.period));
  },
});

defineFunction({
  name: "PPMT",
  description: "The principal part of one payment of a level-payment loan.",
  minArgs: 4,
  maxArgs: 6,
  call(args) {
    const read = readTerms(args, 1, 2, 3, 4, 5);
    if (isFormulaError(read)) return read;
    return guard(principalPart(read.terms, read.period));
  },
});

/**
 * `ISPMT`: interest when the principal is repaid in equal slices.
 *
 * A different loan, not a different rounding of the same one. The balance falls
 * linearly, so the interest does too, and the total payment shrinks every
 * period instead of staying level. Written to match the convention that period
 * numbering starts at 0 for this function alone — an inconsistency inherited
 * from the spreadsheet it comes from, and not one worth silently fixing when
 * every sheet that uses it was written against the original.
 */
defineFunction({
  name: "ISPMT",
  description: "Interest on a loan whose principal is repaid in equal slices.",
  minArgs: 4,
  maxArgs: 4,
  call(args) {
    const rate = numberArg(args[0]);
    if (isFormulaError(rate)) return rate;
    const period = numberArg(args[1]);
    if (isFormulaError(period)) return period;
    const nper = numberArg(args[2]);
    if (isFormulaError(nper)) return nper;
    const pv = numberArg(args[3]);
    if (isFormulaError(pv)) return pv;
    if (nper === 0) return NUM_ERROR;
    return guard(-pv * rate * (1 - period / nper));
  },
});

function cumulative(
  args: readonly Arg[],
  part: (terms: LoanTerms, period: number) => number,
): Value {
  const rate = numberArg(args[0]);
  if (isFormulaError(rate)) return rate;
  const nper = numberArg(args[1]);
  if (isFormulaError(nper)) return nper;
  const pv = numberArg(args[2]);
  if (isFormulaError(pv)) return pv;
  const start = numberArg(args[3]);
  if (isFormulaError(start)) return start;
  const end = numberArg(args[4]);
  if (isFormulaError(end)) return end;
  const type = numberArg(args[5]);
  if (isFormulaError(type)) return type;

  const flag = Math.trunc(type);
  if (flag !== 0 && flag !== 1) return NUM_ERROR;
  const from = Math.trunc(start);
  const to = Math.trunc(end);
  if (nper <= 0 || from < 1 || to < from || to > nper) return NUM_ERROR;

  const terms: LoanTerms = { rate, nper, pv, fv: 0, type: flag };
  let total = 0;
  for (let period = from; period <= to; period++) {
    total += part(terms, period);
  }
  return guard(total);
}

defineFunction({
  name: "CUMIPMT",
  description: "Interest paid between two periods of a level-payment loan.",
  minArgs: 6,
  maxArgs: 6,
  call: (args) => cumulative(args, interestPart),
});

defineFunction({
  name: "CUMPRINC",
  description: "Principal repaid between two periods of a level-payment loan.",
  minArgs: 6,
  maxArgs: 6,
  call: (args) => cumulative(args, principalPart),
});
