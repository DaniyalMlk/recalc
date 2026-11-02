import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import { RegressionError, summarise } from "../src/analysis/regression.js";
import type { RegressionModel, Summary } from "../src/analysis/regression.js";
import { regressCommand } from "../src/analysis/commands.js";
import { parseA1Range } from "../src/engine/reference.js";

/** Lay `y` in column A and the predictors from column B, then fit. */
function fit(
  ys: readonly number[],
  xs: readonly (number | readonly number[])[],
  model: RegressionModel,
  withIntercept = true,
): Summary {
  const book = new Workbook();
  const width = Array.isArray(xs[0]) ? (xs[0] as readonly number[]).length : 1;
  ys.forEach((y, row) => {
    book.setCell(`A${row + 1}`, y);
    const columns = Array.isArray(xs[row])
      ? (xs[row] as readonly number[])
      : [xs[row] as number];
    columns.forEach((value, column) => {
      book.setCell(`${String.fromCharCode(66 + column)}${row + 1}`, value);
    });
  });
  const last = String.fromCharCode(66 + width - 1);
  return summarise(
    book,
    parseA1Range(`A1:A${ys.length}`),
    parseA1Range(`B1:${last}${ys.length}`),
    withIntercept,
    model,
  );
}

const POWERS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];

describe("a power curve", () => {
  it("recovers an exact power law to machine precision", () => {
    const ys = POWERS.map((x) => 3 * Math.pow(x, 1.5));
    const summary = fit(ys, POWERS, "power");
    expect(summary.curve).not.toBeNull();
    expect(summary.curve!.scale).toBeCloseTo(3, 12);
    expect(summary.curve!.factors[0]).toBeCloseTo(1.5, 12);
    expect(summary.rSquared).toBeCloseTo(1, 14);
    expect(summary.rSquaredOnData).toBeCloseTo(1, 12);
  });

  it("reports the curve's scale, not the log-space intercept", () => {
    // The distinction the curve line exists for: the table's intercept is
    // `ln b`, and a reader taking it for `b` is out by a factor of e^1.0986.
    const ys = POWERS.map((x) => 3 * Math.pow(x, 1.5));
    const summary = fit(ys, POWERS, "power");
    const intercept = summary.terms[0]!;
    expect(intercept.label).toBe("intercept");
    expect(intercept.coefficient).toBeCloseTo(Math.log(3), 12);
    expect(summary.curve!.scale).toBeCloseTo(Math.exp(intercept.coefficient), 12);
    expect(summary.curve!.scale / intercept.coefficient).toBeGreaterThan(2.7);
  });

  it("agrees with this engine's own fit over logged columns", () => {
    // The reference is another module: `SLOPE` and `INTERCEPT` over `LN` of
    // the same two columns. A transform applied to the wrong side, or a log
    // in the wrong base, does not survive it.
    const ys = POWERS.map((x, i) => 3 * Math.pow(x, 1.5) * (1 + 0.1 * ((i % 3) - 1)));
    const book = new Workbook();
    POWERS.forEach((x, row) => {
      book.setCell(`A${row + 1}`, ys[row]!);
      book.setCell(`B${row + 1}`, x);
      book.setCell(`C${row + 1}`, `=LN(A${row + 1})`);
      book.setCell(`D${row + 1}`, `=LN(B${row + 1})`);
    });
    book.setCell("F1", "=SLOPE(C1:C10,D1:D10)");
    book.setCell("F2", "=INTERCEPT(C1:C10,D1:D10)");
    const summary = summarise(
      book,
      parseA1Range("A1:A10"),
      parseA1Range("B1:B10"),
      true,
      "power",
    );
    expect(summary.curve!.factors[0]).toBeCloseTo(book.getValue("F1") as number, 12);
    expect(summary.terms[0]!.coefficient).toBeCloseTo(
      book.getValue("F2") as number,
      12,
    );
  });

  it("takes several predictors as a product of powers", () => {
    // `y = 2 x1^0.5 x2^1.5`, which is one fit in log space and a
    // multiplicative form coming back out.
    const rows = [
      [1, 1],
      [2, 3],
      [3, 2],
      [4, 7],
      [5, 4],
      [9, 5],
      [16, 11],
      [25, 13],
    ] as const;
    const ys = rows.map(([a, b]) => 2 * Math.pow(a, 0.5) * Math.pow(b, 1.5));
    const summary = fit(ys, rows, "power");
    expect(summary.curve!.scale).toBeCloseTo(2, 10);
    expect(summary.curve!.factors[0]).toBeCloseTo(0.5, 10);
    expect(summary.curve!.factors[1]).toBeCloseTo(1.5, 10);
  });

  it("fits a scale of exactly one when sent through zero", () => {
    const ys = POWERS.map((x) => Math.pow(x, 1.5));
    const summary = fit(ys, POWERS, "power", false);
    expect(summary.withIntercept).toBe(false);
    // No intercept in log space is `ln b = 0`, which is `b = 1` exactly
    // rather than nearly.
    expect(summary.curve!.scale).toBe(1);
    expect(summary.curve!.factors[0]).toBeCloseTo(1.5, 12);
  });
});

describe("the two numbers called R-squared", () => {
  // The log fit tolerates a large absolute miss at a large value, because in
  // log space it is a small one. This is a power law with one point at 45% of
  // where it belongs, at the largest x.
  const ys = POWERS.map((x, i) => 3 * Math.pow(x, 1.5) * (i === 9 ? 0.45 : 1));
  const summary = fit(ys, POWERS, "power");

  it("pull apart, and the reported one is the flattering one", () => {
    expect(summary.fittedOn).toBe("ln y");
    expect(summary.rSquared).toBeCloseTo(0.994928, 5);
    expect(summary.rSquaredOnData).toBeCloseTo(0.588149, 5);
    // The one a spreadsheet prints beside a power trendline is the first.
    expect(summary.rSquared - summary.rSquaredOnData).toBeGreaterThan(0.4);
  });

  it("is left negative when the curve is worse than the mean", () => {
    // Not clamped: a curve can be worse than a flat line through the mean,
    // and that is exactly the case worth seeing.
    const ruined = [1, 2, 3, 4, 5, 6, 7, 8].map((x) => (x === 8 ? 1 : Math.pow(10, x)));
    const bad = fit(ruined, [1, 2, 3, 4, 5, 6, 7, 8], "power");
    expect(bad.rSquaredOnData).toBeLessThan(0);
    expect(bad.rSquared).toBeGreaterThan(0);
  });

  it("agree, and the space is `y`, for a model that logs no outcome", () => {
    const linear = fit([2, 4, 6, 8], [1, 2, 3, 4], "linear");
    expect(linear.fittedOn).toBe("y");
    expect(linear.curve).toBeNull();
    expect(linear.rSquaredOnData).toBe(linear.rSquared);
    // A logarithmic fit transforms `x` and not `y`, so its least squares is
    // still taken over `y` and there is only one R-squared to report.
    const log = fit([1, 2, 3, 4, 5], [1, 2.718_281_828, 7.389_056_099, 20.085_536_923, 54.598_150_033], "logarithmic");
    expect(log.fittedOn).toBe("y");
    expect(log.curve).toBeNull();
    expect(log.rSquaredOnData).toBe(log.rSquared);
    expect(log.terms[1]!.coefficient).toBeCloseTo(1, 6);
  });
});

describe("what the log-log fit is not", () => {
  it("is not the least-squares curve in y, and a crude search beats it", () => {
    // A deliberately weak optimiser: a coordinate search on a halving step,
    // started at the log-log answer. If even this finds a smaller residual in
    // `y`, the log-log fit is provably not the minimiser there.
    const noise = [1.25, 0.82, 1.1, 0.9, 1.05, 0.95, 1.3, 0.78, 1.02, 0.97];
    const ys = POWERS.map((x, i) => 3 * Math.pow(x, 1.5) * noise[i]!);
    const summary = fit(ys, POWERS, "power");
    const scale = summary.curve!.scale;
    const exponent = summary.curve!.factors[0]!;

    const residual = (s: number, m: number): number =>
      POWERS.reduce((total, x, i) => {
        const gap = ys[i]! - s * Math.pow(x, m);
        return total + gap * gap;
      }, 0);

    let best = { s: scale, m: exponent, error: residual(scale, exponent) };
    let stepS = scale / 2;
    let stepM = 0.5;
    for (let round = 0; round < 60; round++) {
      let moved = false;
      for (const ds of [-stepS, 0, stepS]) {
        for (const dm of [-stepM, 0, stepM]) {
          const s = best.s + ds;
          if (s <= 0) continue;
          const error = residual(s, best.m + dm);
          if (error < best.error) {
            best = { s, m: best.m + dm, error };
            moved = true;
          }
        }
      }
      if (!moved) {
        stepS /= 2;
        stepM /= 2;
      }
    }

    const found = residual(scale, exponent);
    expect(best.error).toBeLessThan(found);
    // Measured at 10.8% worse. Both bounds, so the test says how much and not
    // merely that there is some gap, which a search that moved by a hair
    // would also satisfy.
    const excess = (found - best.error) / best.error;
    expect(excess).toBeGreaterThan(0.09);
    expect(excess).toBeLessThan(0.13);
    // Almost all of the difference is in the scale rather than the exponent.
    expect(Math.abs(best.m - exponent)).toBeLessThan(1e-3);
    expect(best.s).toBeGreaterThan(scale);
  });
});

describe("values a transformed fit refuses", () => {
  const ys = [1, 2, 3, 4, 5];
  const xs = [1, 2, 3, 4, 5];

  it("refuses an outcome with no logarithm, on the models that take one", () => {
    for (const model of ["power", "exponential"] as const) {
      expect(() => fit([1, 2, 0, 4, 5], xs, model)).toThrow(RegressionError);
      expect(() => fit([1, 2, -1, 4, 5], xs, model)).toThrow(/above zero/);
    }
  });

  it("refuses a predictor with no logarithm, on the models that take one", () => {
    for (const model of ["power", "logarithmic"] as const) {
      expect(() => fit(ys, [1, 2, 0, 4, 5], model)).toThrow(/above zero/);
      expect(() => fit(ys, [1, 2, -3, 4, 5], model)).toThrow(/above zero/);
    }
  });

  it("takes them where no log is taken of that side", () => {
    // An exponential logs the outcome only, so a negative predictor is fine;
    // a logarithmic logs the predictor only, so a negative outcome is.
    expect(fit(ys, [-1, -2, 3, 4, 5], "exponential").observations).toBe(5);
    expect(fit([-1, -2, 3, 4, 5], xs, "logarithmic").observations).toBe(5);
    expect(fit([-1, 0, 3, -4, 5], [-1, 0, 3, -4, 5], "linear").observations).toBe(5);
  });

  it("names the value it found, so the row can be located", () => {
    expect(() => fit([1, 2, -7.5, 4, 5], xs, "power")).toThrow(/-7\.5/);
  });
});

describe("the .regress command with a curve", () => {
  const book = new Workbook();
  POWERS.forEach((x, row) => {
    book.setCell(`A${row + 1}`, 3 * Math.pow(x, 1.5));
    book.setCell(`B${row + 1}`, x);
  });

  it("fits the curve named and writes it out in its own parameters", () => {
    const out = regressCommand(book, "A1:A10 by B1:B10 as power");
    expect(out).toContain("y = 3 · B^1.5");
    expect(out).toContain("fitted on");
    expect(out).toContain("r squared (on ln y)");
    expect(out).toContain("r squared (on the data)");
  });

  it("writes an exponential the other way round", () => {
    const exp = new Workbook();
    for (let i = 1; i <= 8; i++) {
      exp.setCell(`A${i}`, 5 * Math.pow(2, i));
      exp.setCell(`B${i}`, i);
    }
    const out = regressCommand(exp, "A1:A8 by B1:B8 as exponential");
    // The base goes under the exponent for an exponential, and the predictor
    // goes there for a power curve.
    expect(out).toMatch(/y = 5 · 2\^B/);
  });

  it("leaves a linear fit reporting one R-squared, as before", () => {
    const out = regressCommand(book, "A1:A10 by B1:B10");
    expect(out).toContain("r squared");
    expect(out).not.toContain("fitted on");
    expect(out).not.toContain("on the data");
    expect(out).not.toContain("y = ");
  });

  it("reads the clause on either side of through zero", () => {
    for (const tail of [
      "A1:A10 by B1:B10 as power through zero",
      "A1:A10 by B1:B10 through zero as power",
    ]) {
      const out = regressCommand(book, tail);
      expect(out).toContain("y = 1 · B^");
      expect(out).not.toContain("intercept");
    }
  });

  it("names the curves it knows when given one it does not", () => {
    const out = regressCommand(book, "A1:A10 by B1:B10 as cubic");
    expect(out).toContain("not a curve this fits: cubic");
    for (const model of ["linear", "exponential", "power", "logarithmic"]) {
      expect(out).toContain(model);
    }
  });

  it("reports a refusal rather than throwing out of the shell", () => {
    const bad = new Workbook();
    for (let i = 1; i <= 5; i++) {
      bad.setCell(`A${i}`, i === 3 ? -1 : i);
      bad.setCell(`B${i}`, i);
    }
    expect(regressCommand(bad, "A1:A5 by B1:B5 as power")).toContain("above zero");
  });
});
