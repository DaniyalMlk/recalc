/**
 * Bond analytics.
 *
 * A bond is a schedule of coupons and a redemption, and its price is what those
 * are worth today. The arithmetic is a discounted cash flow and would be dull,
 * except for one thing: a bond is almost never bought on a coupon date. Buying
 * between two coupons means the first discount period is a fraction, the seller
 * is owed the interest that accrued while they held it, and the quoted price
 * excludes that interest while the money actually paid includes it.
 *
 * That fraction — where settlement sits inside its coupon period — is what
 * `src/date/coupons.ts` computes and what every function here is built on. The
 * conventions are the ones a term sheet states: a frequency, a day-count basis,
 * a redemption per 100 of face.
 *
 * Prices are per 100 of face throughout, which is how bonds are quoted.
 */

import { NUM_ERROR, isFormulaError } from "../engine/errors.js";
import type { FormulaError } from "../engine/errors.js";
import type { Value } from "../engine/value.js";
import { isDayCountBasis, yearFraction } from "../date/daycount.js";
import type { DayCountBasis } from "../date/daycount.js";
import { couponPosition, isCouponFrequency } from "../date/coupons.js";
import type { CouponFrequency, CouponPosition } from "../date/coupons.js";
import { defineFunction, numberArg } from "./registry.js";
import type { Arg } from "./registry.js";
import { serialArg } from "./date.js";
import { solveRate } from "./solver.js";

function guard(n: number): Value {
  return Number.isFinite(n) ? n : NUM_ERROR;
}

function basisArg(
  args: readonly Arg[],
  index: number,
): DayCountBasis | FormulaError {
  if (args.length <= index) return 0;
  const n = numberArg(args[index]);
  if (isFormulaError(n)) return n;
  const basis = Math.trunc(n);
  if (!isDayCountBasis(basis)) return NUM_ERROR;
  return basis;
}

function frequencyArg(
  args: readonly Arg[],
  index: number,
): CouponFrequency | FormulaError {
  const n = numberArg(args[index]);
  if (isFormulaError(n)) return n;
  const frequency = Math.trunc(n);
  if (!isCouponFrequency(frequency)) return NUM_ERROR;
  return frequency;
}

/** The terms a priced bond is described by. */
export interface BondTerms {
  readonly settlement: number;
  readonly maturity: number;
  /** Annual coupon rate, as a fraction of face. */
  readonly rate: number;
  /** Redemption amount per 100 of face. */
  readonly redemption: number;
  readonly frequency: CouponFrequency;
  readonly basis: DayCountBasis;
}

function readTerms(
  args: readonly Arg[],
  rateIndex: number,
  redemptionIndex: number,
  frequencyIndex: number,
  basisIndex: number,
): BondTerms | FormulaError {
  const settlement = serialArg(args[0]);
  if (isFormulaError(settlement)) return settlement;
  const maturity = serialArg(args[1]);
  if (isFormulaError(maturity)) return maturity;
  const rate = numberArg(args[rateIndex]);
  if (isFormulaError(rate)) return rate;
  const redemption = numberArg(args[redemptionIndex]);
  if (isFormulaError(redemption)) return redemption;
  const frequency = frequencyArg(args, frequencyIndex);
  if (isFormulaError(frequency)) return frequency;
  const basis = basisArg(args, basisIndex);
  if (isFormulaError(basis)) return basis;

  if (settlement >= maturity) return NUM_ERROR;
  if (rate < 0 || redemption <= 0) return NUM_ERROR;
  return { settlement, maturity, rate, redemption, frequency, basis };
}

function positionOf(terms: BondTerms): CouponPosition {
  return couponPosition(
    terms.settlement,
    terms.maturity,
    terms.frequency,
    terms.basis,
  );
}

/** Interest accrued since the last coupon, per 100 of face. */
export function accruedInterest(terms: BondTerms): number {
  const position = positionOf(terms);
  if (position.periodDays === 0) return 0;
  return (
    ((100 * terms.rate) / terms.frequency) *
    (position.daysBefore / position.periodDays)
  );
}

/**
 * The clean price of a bond at a given yield, per 100 of face.
 *
 * Two formulas, and which one applies is a question about the calendar rather
 * than about the maths. With more than one coupon left, each cash flow is
 * discounted at the periodic yield over a number of periods that starts at a
 * fraction. With exactly one left the market does not compound over a period
 * it will not see: the single remaining payment is discounted at simple
 * interest, which is the money-market convention every last coupon period is
 * quoted on.
 *
 * Both subtract accrued interest at the end. The result is the *clean* price,
 * which is what is quoted; the money that changes hands is that plus accrued.
 */
export function bondPrice(terms: BondTerms, yld: number): number {
  const position = positionOf(terms);
  const { count, daysBefore, daysAfter, periodDays } = position;
  const coupon = (100 * terms.rate) / terms.frequency;
  const periodicYield = yld / terms.frequency;
  const accrued = coupon * (daysBefore / periodDays);

  if (count <= 1) {
    const total = terms.redemption + coupon;
    const discount = 1 + (daysAfter / periodDays) * periodicYield;
    if (discount === 0) return Number.NaN;
    return total / discount - accrued;
  }

  const stub = daysAfter / periodDays;
  const growth = 1 + periodicYield;
  if (growth <= 0) return Number.NaN;

  let present = terms.redemption / Math.pow(growth, count - 1 + stub);
  for (let k = 1; k <= count; k++) {
    present += coupon / Math.pow(growth, k - 1 + stub);
  }
  return present - accrued;
}

/**
 * The yield a clean price implies.
 *
 * With one coupon left the relation is linear and inverts in closed form. With
 * more, price falls monotonically in yield, so a root of `price(y) − quoted`
 * is unique and the general-purpose solver finds it — the same solver `IRR` and
 * `RATE` use, for the same reason.
 */
export function bondYield(terms: BondTerms, price: number): number | null {
  const position = positionOf(terms);
  const { count, daysBefore, daysAfter, periodDays } = position;
  const coupon = (100 * terms.rate) / terms.frequency;

  if (count <= 1) {
    const paid = price + coupon * (daysBefore / periodDays);
    if (paid <= 0 || daysAfter === 0) return null;
    const total = terms.redemption + coupon;
    return ((total - paid) / paid) * (terms.frequency * (periodDays / daysAfter));
  }

  return solveRate((y) => bondPrice(terms, y) - price, {
    guess: terms.rate > 0 ? terms.rate : 0.05,
  });
}

/**
 * Macaulay duration in years: the average time to a cash flow, weighted by what
 * that cash flow is worth today.
 *
 * The weights are present values of the *whole* payment stream, accrued
 * interest included — the denominator is the dirty price, because duration
 * answers a question about the money actually at risk, not about the quoted
 * number that excludes what the seller is owed.
 */
export function macaulayDuration(terms: BondTerms, yld: number): number | null {
  const position = positionOf(terms);
  const { count, daysAfter, periodDays } = position;
  if (count < 1) return null;
  const coupon = (100 * terms.rate) / terms.frequency;
  const stub = daysAfter / periodDays;
  const growth = 1 + yld / terms.frequency;
  if (growth <= 0) return null;

  let weighted = 0;
  let total = 0;
  for (let k = 1; k <= count; k++) {
    const periods = k - 1 + stub;
    const flow = coupon + (k === count ? terms.redemption : 0);
    const present = flow / Math.pow(growth, periods);
    weighted += periods * present;
    total += present;
  }
  if (total === 0) return null;
  return weighted / total / terms.frequency;
}

// ---------------------------------------------------------------------------
// The coupon-position family
// ---------------------------------------------------------------------------

function couponFunction(
  name: string,
  description: string,
  read: (position: CouponPosition) => number,
): void {
  defineFunction({
    name,
    description,
    minArgs: 3,
    maxArgs: 4,
    call(args) {
      const settlement = serialArg(args[0]);
      if (isFormulaError(settlement)) return settlement;
      const maturity = serialArg(args[1]);
      if (isFormulaError(maturity)) return maturity;
      const frequency = frequencyArg(args, 2);
      if (isFormulaError(frequency)) return frequency;
      const basis = basisArg(args, 3);
      if (isFormulaError(basis)) return basis;
      if (settlement >= maturity) return NUM_ERROR;
      return guard(
        read(couponPosition(settlement, maturity, frequency, basis)),
      );
    },
  });
}

couponFunction(
  "COUPPCD",
  "The coupon date on or before settlement.",
  (position) => position.previous,
);
couponFunction(
  "COUPNCD",
  "The coupon date after settlement.",
  (position) => position.next,
);
couponFunction(
  "COUPNUM",
  "Coupons payable between settlement and maturity.",
  (position) => position.count,
);
couponFunction(
  "COUPDAYBS",
  "Days from the last coupon to settlement.",
  (position) => position.daysBefore,
);
couponFunction(
  "COUPDAYS",
  "Days in the coupon period containing settlement.",
  (position) => position.periodDays,
);
couponFunction(
  "COUPDAYSNC",
  "Days from settlement to the next coupon.",
  (position) => position.daysAfter,
);

// ---------------------------------------------------------------------------
// Price, yield and duration
// ---------------------------------------------------------------------------

defineFunction({
  name: "PRICE",
  description: "Clean price per 100 face of a bond at a given yield.",
  minArgs: 6,
  maxArgs: 7,
  call(args) {
    const yld = numberArg(args[3]);
    if (isFormulaError(yld)) return yld;
    if (yld < 0) return NUM_ERROR;
    const terms = readTerms(args, 2, 4, 5, 6);
    if (isFormulaError(terms)) return terms;
    return guard(bondPrice(terms, yld));
  },
});

defineFunction({
  name: "YIELD",
  description: "Yield of a bond from its clean price.",
  minArgs: 6,
  maxArgs: 7,
  call(args) {
    const price = numberArg(args[3]);
    if (isFormulaError(price)) return price;
    if (price <= 0) return NUM_ERROR;
    const terms = readTerms(args, 2, 4, 5, 6);
    if (isFormulaError(terms)) return terms;
    const solved = bondYield(terms, price);
    return solved === null ? NUM_ERROR : guard(solved);
  },
});

defineFunction({
  name: "ACCRINT",
  description: "Interest accrued on a bond from issue to settlement.",
  minArgs: 6,
  maxArgs: 7,
  call(args) {
    const issue = serialArg(args[0]);
    if (isFormulaError(issue)) return issue;
    // The first-interest date is read and validated but does not enter the
    // result: interest accrues from issue, and the first coupon date only says
    // when it is first paid out.
    const first = serialArg(args[1]);
    if (isFormulaError(first)) return first;
    const settlement = serialArg(args[2]);
    if (isFormulaError(settlement)) return settlement;
    const rate = numberArg(args[3]);
    if (isFormulaError(rate)) return rate;
    const par = numberArg(args[4]);
    if (isFormulaError(par)) return par;
    const frequency = frequencyArg(args, 5);
    if (isFormulaError(frequency)) return frequency;
    const basis = basisArg(args, 6);
    if (isFormulaError(basis)) return basis;
    if (first <= issue) return NUM_ERROR;
    if (rate <= 0 || par <= 0 || settlement <= issue) return NUM_ERROR;
    return guard(par * rate * yearFraction(issue, settlement, basis));
  },
});

defineFunction({
  name: "ACCRINTM",
  description: "Interest accrued on a bond that pays only at maturity.",
  minArgs: 4,
  maxArgs: 5,
  call(args) {
    const issue = serialArg(args[0]);
    if (isFormulaError(issue)) return issue;
    const settlement = serialArg(args[1]);
    if (isFormulaError(settlement)) return settlement;
    const rate = numberArg(args[2]);
    if (isFormulaError(rate)) return rate;
    const par = numberArg(args[3]);
    if (isFormulaError(par)) return par;
    const basis = basisArg(args, 4);
    if (isFormulaError(basis)) return basis;
    if (rate <= 0 || par <= 0 || settlement <= issue) return NUM_ERROR;
    return guard(par * rate * yearFraction(issue, settlement, basis));
  },
});

/**
 * `DURATION` and `MDURATION`, which differ only by a final division.
 *
 * Neither takes a redemption: duration is quoted on a bond redeeming at par, so
 * the terms are assembled here rather than read, and the argument positions are
 * one to the left of `PRICE`'s.
 */
function durationFunction(
  name: string,
  description: string,
  modified: boolean,
): void {
  defineFunction({
    name,
    description,
    minArgs: 5,
    maxArgs: 6,
    call(args) {
      const settlement = serialArg(args[0]);
      if (isFormulaError(settlement)) return settlement;
      const maturity = serialArg(args[1]);
      if (isFormulaError(maturity)) return maturity;
      const rate = numberArg(args[2]);
      if (isFormulaError(rate)) return rate;
      const yld = numberArg(args[3]);
      if (isFormulaError(yld)) return yld;
      const frequency = frequencyArg(args, 4);
      if (isFormulaError(frequency)) return frequency;
      const basis = basisArg(args, 5);
      if (isFormulaError(basis)) return basis;
      if (settlement >= maturity) return NUM_ERROR;
      if (rate < 0 || yld < 0) return NUM_ERROR;

      const terms: BondTerms = {
        settlement,
        maturity,
        rate,
        redemption: 100,
        frequency,
        basis,
      };
      const macaulay = macaulayDuration(terms, yld);
      if (macaulay === null) return NUM_ERROR;
      if (!modified) return guard(macaulay);
      return guard(macaulay / (1 + yld / frequency));
    },
  });
}

durationFunction(
  "DURATION",
  "Macaulay duration in years of a bond paying periodic interest.",
  false,
);
durationFunction(
  "MDURATION",
  "Modified duration in years of a bond paying periodic interest.",
  true,
);
