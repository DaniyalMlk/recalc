import { describe, expect, it } from "vitest";
import { bestRationalUnder, nearestMultiple } from "../src/format/rational.js";
import type { Rational } from "../src/format/rational.js";

/**
 * The reference: every denominator in range, the best numerator for each.
 *
 * This is the definition of "closest fraction under a bound" written out
 * directly, which is what makes it a reference rather than a second
 * implementation of the same idea. It is O(N) per call, which is exactly why
 * the engine does not use it.
 */
function scan(value: number, maxDenominator: number): Rational {
  let best: Rational = { numerator: Math.round(value), denominator: 1 };
  let bestError = Math.abs(value - best.numerator);
  for (let den = 2; den <= maxDenominator; den += 1) {
    const num = Math.round(value * den);
    const error = Math.abs(value - num / den);
    // Strictly closer only: an equal error leaves the smaller denominator in
    // place, which is the tie rule the engine documents.
    if (error < bestError) {
      best = { numerator: num, denominator: den };
      bestError = error;
    }
  }
  return best;
}

describe("bestRationalUnder", () => {
  it("is the closest fraction under the bound, not the truncated decimal", () => {
    // 3/10 is the decimal expansion and is out of range at one digit. What
    // fits is 2/7, wrong by 1.4% — and notably not 1/3, the obvious guess,
    // which is wrong by 3.3%.
    expect(bestRationalUnder(0.3, 9)).toEqual({ numerator: 2, denominator: 7 });
    expect(bestRationalUnder(0.3, 99)).toEqual({ numerator: 3, denominator: 10 });
  });

  it("returns an exact fraction exactly when it fits", () => {
    expect(bestRationalUnder(0.75, 9)).toEqual({ numerator: 3, denominator: 4 });
    expect(bestRationalUnder(0.125, 9)).toEqual({ numerator: 1, denominator: 8 });
    expect(bestRationalUnder(2, 9)).toEqual({ numerator: 2, denominator: 1 });
    expect(bestRationalUnder(0, 9)).toEqual({ numerator: 0, denominator: 1 });
  });

  it("beats the famous convergent of pi when the bound leaves room for better", () => {
    // 22/7 is the approximation everyone knows, and under a two-digit bound it
    // is the wrong answer: 311/99 is seven times closer. The folklore value is
    // the best one up to a denominator of 56, not up to 99.
    expect(bestRationalUnder(Math.PI, 7)).toEqual({ numerator: 22, denominator: 7 });
    expect(bestRationalUnder(Math.PI, 56)).toEqual({ numerator: 22, denominator: 7 });
    expect(bestRationalUnder(Math.PI, 99)).toEqual({ numerator: 311, denominator: 99 });
    expect(bestRationalUnder(Math.PI, 999)).toEqual({ numerator: 355, denominator: 113 });
  });

  it("picks a semiconvergent, and leaves it alone when the convergent is closer", () => {
    // The convergents of 0.3 are 0/1, 1/3, 3/10. At a bound of 9 the last one
    // does not fit, and the choice is between the convergent 1/3 (0.0333 off)
    // and the best semiconvergent below the bound, 2/7 (0.0143 off). The
    // semiconvergent wins, which is the whole reason it is considered.
    expect(bestRationalUnder(0.3, 9)).toEqual({ numerator: 2, denominator: 7 });
    expect(scan(0.3, 9)).toEqual({ numerator: 2, denominator: 7 });

    // The other way round. The convergents of pi are 3/1, 22/7, 333/106; at a
    // bound of 8 the semiconvergent available is 25/8 (0.0166 off) and the
    // convergent 22/7 (0.0013 off) is thirteen times closer, so it stands.
    expect(bestRationalUnder(Math.PI, 8)).toEqual({ numerator: 22, denominator: 7 });
    expect(scan(Math.PI, 8)).toEqual({ numerator: 22, denominator: 7 });
    expect(Math.abs(Math.PI - 25 / 8)).toBeGreaterThan(Math.abs(Math.PI - 22 / 7));
  });

  it("agrees with an exhaustive scan over a grid of values and bounds", () => {
    let compared = 0;
    for (const max of [1, 2, 3, 4, 8, 9, 16, 31, 64, 99, 100, 255, 999]) {
      for (let i = 0; i <= 400; i += 1) {
        const value = i / 400;
        const got = bestRationalUnder(value, max);
        const want = scan(value, max);
        // Two different fractions of equal error are both correct answers to
        // "which is closest"; the tie rule is what makes the result unique, so
        // the comparison is on the pair and not only on the error.
        expect(
          { value, max, ...got },
          `${value} under ${max}`,
        ).toEqual({ value, max, ...want });
        compared += 1;
      }
    }
    expect(compared).toBe(13 * 401);
  });

  it("agrees with an exhaustive scan on values above one", () => {
    for (const max of [9, 99, 999]) {
      for (let i = 0; i < 300; i += 1) {
        const value = 1 + i * 0.37;
        expect({ max, ...bestRationalUnder(value, max) }).toEqual({
          max,
          ...scan(value, max),
        });
      }
    }
  });

  it("agrees with an exhaustive scan on irrational values", () => {
    const values = [
      Math.PI,
      Math.E,
      Math.SQRT2,
      Math.LN2,
      (1 + Math.sqrt(5)) / 2,
      Math.sqrt(3) / 3,
      Math.PI / 4,
      1 / Math.E,
    ];
    for (const value of values) {
      for (const max of [2, 5, 9, 17, 50, 99, 500, 999]) {
        expect({ value, max, ...bestRationalUnder(value, max) }).toEqual({
          value,
          max,
          ...scan(value, max),
        });
      }
    }
  });

  it("never returns a denominator outside the bound", () => {
    for (const max of [1, 2, 7, 9, 99, 999]) {
      for (let i = 0; i <= 200; i += 1) {
        const { denominator } = bestRationalUnder(i / 97, max);
        expect(denominator).toBeGreaterThanOrEqual(1);
        expect(denominator).toBeLessThanOrEqual(max);
      }
    }
  });

  it("is no worse than the truncated decimal whenever that one fits", () => {
    // A weaker claim than the scan, but it is the claim a reader of a
    // spreadsheet actually cares about: the fraction shown is never further
    // away than the obvious thing would have been.
    for (let i = 0; i <= 999; i += 1) {
      const value = i / 1000;
      const got = bestRationalUnder(value, 1000);
      expect(Math.abs(value - got.numerator / got.denominator)).toBeLessThanOrEqual(
        Math.abs(value - i / 1000) + 1e-15,
      );
    }
  });

  it("refuses a negative value or a bound below one", () => {
    expect(() => bestRationalUnder(-0.5, 9)).toThrow(RangeError);
    expect(() => bestRationalUnder(Number.NaN, 9)).toThrow(RangeError);
    expect(() => bestRationalUnder(0.5, 0)).toThrow(RangeError);
    expect(() => bestRationalUnder(0.5, 1.5)).toThrow(RangeError);
  });
});

describe("nearestMultiple", () => {
  it("rounds to the denominator asked for, closer fraction or not", () => {
    // 1/3 is 0.3333; in eighths it is 3/8, which is 0.0417 away. A bounded
    // code would have found 1/3 exactly. A fixed one is not looking.
    expect(nearestMultiple(1 / 3, 8)).toEqual({ numerator: 3, denominator: 8 });
    expect(nearestMultiple(0.75, 8)).toEqual({ numerator: 6, denominator: 8 });
  });

  it("does not reduce the fraction it returns", () => {
    expect(nearestMultiple(0.5, 8)).toEqual({ numerator: 4, denominator: 8 });
    expect(nearestMultiple(0.25, 100)).toEqual({ numerator: 25, denominator: 100 });
  });

  it("can round up to the denominator itself", () => {
    expect(nearestMultiple(0.99, 8)).toEqual({ numerator: 8, denominator: 8 });
  });

  it("refuses a negative value or a denominator below one", () => {
    expect(() => nearestMultiple(-0.5, 8)).toThrow(RangeError);
    expect(() => nearestMultiple(0.5, 0)).toThrow(RangeError);
  });
});
