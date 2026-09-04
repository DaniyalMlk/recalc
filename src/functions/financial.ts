import { NUM_ERROR, VALUE_ERROR, isFormulaError } from "../engine/errors.js";
import { kindOf } from "../engine/value.js";
import type { Value } from "../engine/value.js";
import {
  argValues,
  defineFunction,
  flatten,
  numberArg,
} from "./registry.js";
import type { Arg } from "./registry.js";
import { solveRate } from "./solver.js";
import { yearFraction } from "../date/daycount.js";

function guard(n: number): Value {
  return Number.isFinite(n) ? n : NUM_ERROR;
}

/** Numbers from a range argument, ignoring blanks and text as aggregates do. */
function seriesOf(arg: Arg | undefined): number[] | Value {
  if (arg === undefined) return VALUE_ERROR;
  const out: number[] = [];
  for (const value of argValues(arg)) {
    if (isFormulaError(value)) return value;
    if (kindOf(value) === "number") out.push(value as number);
  }
  return out;
}

function optional(
  args: readonly Arg[],
  index: number,
  fallback: number,
): number | Value {
  if (args.length <= index) return fallback;
  const n = numberArg(args[index]);
  return isFormulaError(n) ? n : n;
}

/**
 * The annuity identity every time-value function is a rearrangement of:
 *
 *   pv·(1+r)^n + pmt·(1+r·type)·((1+r)^n − 1)/r + fv = 0
 *
 * `type` is 1 for payments at the start of the period (an annuity due) and 0
 * at the end. The sign convention is the spreadsheet one: money you pay out is
 * negative, money you receive is positive, which is why `PMT` on a positive
 * loan principal comes back negative.
 */
function annuityFactor(rate: number, nper: number, type: number): number {
  if (rate === 0) return nper;
  return ((Math.pow(1 + rate, nper) - 1) / rate) * (1 + rate * type);
}

defineFunction({
  name: "FV",
  description: "Future value of an annuity.",
  minArgs: 3,
  maxArgs: 5,
  call(args) {
    const rate = numberArg(args[0]);
    if (isFormulaError(rate)) return rate;
    const nper = numberArg(args[1]);
    if (isFormulaError(nper)) return nper;
    const pmt = numberArg(args[2]);
    if (isFormulaError(pmt)) return pmt;
    const pv = optional(args, 3, 0);
    if (typeof pv !== "number") return pv;
    const type = optional(args, 4, 0);
    if (typeof type !== "number") return type;

    if (rate === 0) return guard(-(pv + pmt * nper));
    return guard(
      -(pv * Math.pow(1 + rate, nper) + pmt * annuityFactor(rate, nper, type)),
    );
  },
});

defineFunction({
  name: "PV",
  description: "Present value of an annuity.",
  minArgs: 3,
  maxArgs: 5,
  call(args) {
    const rate = numberArg(args[0]);
    if (isFormulaError(rate)) return rate;
    const nper = numberArg(args[1]);
    if (isFormulaError(nper)) return nper;
    const pmt = numberArg(args[2]);
    if (isFormulaError(pmt)) return pmt;
    const fv = optional(args, 3, 0);
    if (typeof fv !== "number") return fv;
    const type = optional(args, 4, 0);
    if (typeof type !== "number") return type;

    if (rate === 0) return guard(-(fv + pmt * nper));
    return guard(
      -(fv + pmt * annuityFactor(rate, nper, type)) /
        Math.pow(1 + rate, nper),
    );
  },
});

defineFunction({
  name: "PMT",
  description: "Periodic payment for an annuity.",
  minArgs: 3,
  maxArgs: 5,
  call(args) {
    const rate = numberArg(args[0]);
    if (isFormulaError(rate)) return rate;
    const nper = numberArg(args[1]);
    if (isFormulaError(nper)) return nper;
    const pv = numberArg(args[2]);
    if (isFormulaError(pv)) return pv;
    const fv = optional(args, 3, 0);
    if (typeof fv !== "number") return fv;
    const type = optional(args, 4, 0);
    if (typeof type !== "number") return type;
    if (nper === 0) return NUM_ERROR;

    if (rate === 0) return guard(-(pv + fv) / nper);
    return guard(
      -(pv * Math.pow(1 + rate, nper) + fv) / annuityFactor(rate, nper, type),
    );
  },
});

defineFunction({
  name: "NPER",
  description: "Number of periods for an annuity.",
  minArgs: 3,
  maxArgs: 5,
  call(args) {
    const rate = numberArg(args[0]);
    if (isFormulaError(rate)) return rate;
    const pmt = numberArg(args[1]);
    if (isFormulaError(pmt)) return pmt;
    const pv = numberArg(args[2]);
    if (isFormulaError(pv)) return pv;
    const fv = optional(args, 3, 0);
    if (typeof fv !== "number") return fv;
    const type = optional(args, 4, 0);
    if (typeof type !== "number") return type;

    if (rate === 0) {
      if (pmt === 0) return NUM_ERROR;
      return guard(-(pv + fv) / pmt);
    }
    // Solving pv·x + k·(x−1) + fv = 0 for x = (1+r)^n, with
    // k = pmt·(1+r·type)/r, gives x = (k − fv)/(pv + k).
    const k = (pmt * (1 + rate * type)) / rate;
    const numerator = k - fv;
    const denominator = pv + k;
    if (denominator === 0) return NUM_ERROR;
    const x = numerator / denominator;
    if (!(x > 0)) return NUM_ERROR;
    return guard(Math.log(x) / Math.log(1 + rate));
  },
});

defineFunction({
  name: "RATE",
  description: "Interest rate per period of an annuity.",
  minArgs: 3,
  maxArgs: 6,
  call(args) {
    const nper = numberArg(args[0]);
    if (isFormulaError(nper)) return nper;
    const pmt = numberArg(args[1]);
    if (isFormulaError(pmt)) return pmt;
    const pv = numberArg(args[2]);
    if (isFormulaError(pv)) return pv;
    const fv = optional(args, 3, 0);
    if (typeof fv !== "number") return fv;
    const type = optional(args, 4, 0);
    if (typeof type !== "number") return type;
    const guess = optional(args, 5, 0.1);
    if (typeof guess !== "number") return guess;
    if (nper <= 0) return NUM_ERROR;

    const balance = (rate: number): number => {
      if (rate === 0) return pv + pmt * nper + fv;
      return (
        pv * Math.pow(1 + rate, nper) + pmt * annuityFactor(rate, nper, type) + fv
      );
    };

    const solved = solveRate(balance, { guess });
    return solved === null ? NUM_ERROR : guard(solved);
  },
});

/**
 * Net present value.
 *
 * The first value is discounted by one period, not zero — the spreadsheet
 * convention, and the one that trips people up. An initial outlay at t=0 is
 * written outside the call: `=A1 + NPV(rate, A2:A10)`.
 */
function netPresentValue(rate: number, values: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    total += values[i]! / Math.pow(1 + rate, i + 1);
  }
  return total;
}

defineFunction({
  name: "NPV",
  description: "Net present value; the first value is discounted one period.",
  minArgs: 2,
  maxArgs: Infinity,
  call(args) {
    const rate = numberArg(args[0]);
    if (isFormulaError(rate)) return rate;
    if (rate === -1) return NUM_ERROR;
    const values: number[] = [];
    for (const value of flatten(args.slice(1))) {
      if (isFormulaError(value)) return value;
      if (kindOf(value) === "number") values.push(value as number);
    }
    return guard(netPresentValue(rate, values));
  },
});

/** IRR's present value, where the first flow sits at t=0. */
function presentValueAtZero(rate: number, flows: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < flows.length; i++) {
    total += flows[i]! / Math.pow(1 + rate, i);
  }
  return total;
}

defineFunction({
  name: "IRR",
  description: "Internal rate of return; the first value sits at period zero.",
  minArgs: 1,
  maxArgs: 2,
  call(args) {
    const flows = seriesOf(args[0]);
    if (!Array.isArray(flows)) return flows;
    if (flows.length < 2) return NUM_ERROR;
    if (!flows.some((f) => f > 0) || !flows.some((f) => f < 0)) {
      // Without a sign change there is no rate at which the flows net to zero.
      return NUM_ERROR;
    }
    const guess = optional(args, 1, 0.1);
    if (typeof guess !== "number") return guess;

    const solved = solveRate((rate) => presentValueAtZero(rate, flows), {
      guess,
    });
    return solved === null ? NUM_ERROR : guard(solved);
  },
});

defineFunction({
  name: "MIRR",
  description: "Modified IRR with separate finance and reinvestment rates.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const flows = seriesOf(args[0]);
    if (!Array.isArray(flows)) return flows;
    const financeRate = numberArg(args[1]);
    if (isFormulaError(financeRate)) return financeRate;
    const reinvestRate = numberArg(args[2]);
    if (isFormulaError(reinvestRate)) return reinvestRate;
    const n = flows.length;
    if (n < 2) return NUM_ERROR;

    // Both legs discount from period 1, because the definition is written in
    // terms of the NPV *function*, which offsets by one — not in terms of a
    // present value at t=0. Discounting from period 0 here gives an answer
    // that is close enough to look right and does not match any spreadsheet.
    let positive = 0;
    let negative = 0;
    for (let i = 0; i < n; i++) {
      const flow = flows[i]!;
      if (flow > 0) positive += flow / Math.pow(1 + reinvestRate, i + 1);
      else if (flow < 0) negative += flow / Math.pow(1 + financeRate, i + 1);
    }
    if (positive === 0 || negative === 0) return NUM_ERROR;

    const ratio =
      (-positive * Math.pow(1 + reinvestRate, n)) /
      (negative * (1 + financeRate));
    if (!(ratio > 0)) return NUM_ERROR;
    return guard(Math.pow(ratio, 1 / (n - 1)) - 1);
  },
});

/**
 * Discounting for irregular dates.
 *
 * The exponent is a year fraction on the actual/365 basis, which is the
 * convention `XNPV` and `XIRR` are defined on. It comes from the shared
 * day-count module rather than a bare subtraction of serials, so the two
 * months around the 1900 phantom leap day discount by the number of days that
 * actually elapsed rather than the number the serials suggest.
 */
function irregularPresentValue(
  rate: number,
  flows: readonly number[],
  dates: readonly number[],
): number {
  const start = dates[0]!;
  let total = 0;
  for (let i = 0; i < flows.length; i++) {
    total += flows[i]! / Math.pow(1 + rate, yearFraction(start, dates[i]!, 3));
  }
  return total;
}

function seriesPair(
  args: readonly Arg[],
  valuesIndex: number,
  datesIndex: number,
): FlowSeries | Value {
  const flows = seriesOf(args[valuesIndex]);
  if (!Array.isArray(flows)) return flows;
  const dates = seriesOf(args[datesIndex]);
  if (!Array.isArray(dates)) return dates;
  if (flows.length !== dates.length || flows.length < 2) return NUM_ERROR;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i]! < dates[0]!) return NUM_ERROR;
  }
  return { flows, dates };
}

interface FlowSeries {
  readonly flows: number[];
  readonly dates: number[];
}

function isFlowSeries(pair: FlowSeries | Value): pair is FlowSeries {
  return typeof pair === "object" && pair !== null && "flows" in pair;
}

defineFunction({
  name: "XNPV",
  description: "Net present value for cash flows on irregular dates.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const rate = numberArg(args[0]);
    if (isFormulaError(rate)) return rate;
    const pair = seriesPair(args, 1, 2);
    if (!isFlowSeries(pair)) return pair;
    if (rate <= -1) return NUM_ERROR;
    return guard(irregularPresentValue(rate, pair.flows, pair.dates));
  },
});

defineFunction({
  name: "XIRR",
  description: "Internal rate of return for cash flows on irregular dates.",
  minArgs: 2,
  maxArgs: 3,
  call(args) {
    const pair = seriesPair(args, 0, 1);
    if (!isFlowSeries(pair)) return pair;
    if (!pair.flows.some((f) => f > 0) || !pair.flows.some((f) => f < 0)) {
      return NUM_ERROR;
    }
    const guess = optional(args, 2, 0.1);
    if (typeof guess !== "number") return guess;

    const solved = solveRate(
      (rate) => irregularPresentValue(rate, pair.flows, pair.dates),
      { guess },
    );
    return solved === null ? NUM_ERROR : guard(solved);
  },
});

defineFunction({
  name: "SLN",
  description: "Straight-line depreciation for one period.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const cost = numberArg(args[0]);
    if (isFormulaError(cost)) return cost;
    const salvage = numberArg(args[1]);
    if (isFormulaError(salvage)) return salvage;
    const life = numberArg(args[2]);
    if (isFormulaError(life)) return life;
    if (life === 0) return NUM_ERROR;
    return guard((cost - salvage) / life);
  },
});

defineFunction({
  name: "SYD",
  description: "Sum-of-years-digits depreciation for one period.",
  minArgs: 4,
  maxArgs: 4,
  call(args) {
    const cost = numberArg(args[0]);
    if (isFormulaError(cost)) return cost;
    const salvage = numberArg(args[1]);
    if (isFormulaError(salvage)) return salvage;
    const life = numberArg(args[2]);
    if (isFormulaError(life)) return life;
    const period = numberArg(args[3]);
    if (isFormulaError(period)) return period;
    if (life <= 0 || period < 1 || period > life) return NUM_ERROR;
    return guard(
      ((cost - salvage) * (life - period + 1) * 2) / (life * (life + 1)),
    );
  },
});

defineFunction({
  name: "DDB",
  description: "Double-declining-balance depreciation for one period.",
  minArgs: 4,
  maxArgs: 5,
  call(args) {
    const cost = numberArg(args[0]);
    if (isFormulaError(cost)) return cost;
    const salvage = numberArg(args[1]);
    if (isFormulaError(salvage)) return salvage;
    const life = numberArg(args[2]);
    if (isFormulaError(life)) return life;
    const period = numberArg(args[3]);
    if (isFormulaError(period)) return period;
    const factor = optional(args, 4, 2);
    if (typeof factor !== "number") return factor;
    if (life <= 0 || period < 1 || period > life || factor <= 0) {
      return NUM_ERROR;
    }

    // Accumulate period by period: the closed form is only valid while the
    // book value stays above salvage, and the clamp has to be applied on the
    // period where it first bites.
    let book = cost;
    let depreciation = 0;
    for (let p = 1; p <= Math.ceil(period); p++) {
      depreciation = Math.min(
        (book * factor) / life,
        Math.max(0, book - salvage),
      );
      book -= depreciation;
    }
    return guard(depreciation);
  },
});

defineFunction({
  name: "EFFECT",
  description: "Effective annual rate from a nominal rate.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const nominal = numberArg(args[0]);
    if (isFormulaError(nominal)) return nominal;
    const periods = numberArg(args[1]);
    if (isFormulaError(periods)) return periods;
    const n = Math.trunc(periods);
    if (nominal <= 0 || n < 1) return NUM_ERROR;
    return guard(Math.pow(1 + nominal / n, n) - 1);
  },
});

defineFunction({
  name: "NOMINAL",
  description: "Nominal annual rate from an effective rate.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const effective = numberArg(args[0]);
    if (isFormulaError(effective)) return effective;
    const periods = numberArg(args[1]);
    if (isFormulaError(periods)) return periods;
    const n = Math.trunc(periods);
    if (effective <= 0 || n < 1) return NUM_ERROR;
    return guard((Math.pow(1 + effective, 1 / n) - 1) * n);
  },
});
