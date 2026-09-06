import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import "../src/functions/index.js";
import type { Value } from "../src/engine/value.js";
import {
  chiSquareTest,
  confidenceNormal,
  confidenceStudent,
  oneSampleT,
  pairedT,
  pooledT,
  sampleVariance,
  varianceRatioTest,
  welchT,
  zTest,
} from "../src/numeric/inference.js";
import {
  chiSquaredSf,
  fSf,
  studentTTwoTail,
} from "../src/numeric/distributions.js";

function expectRelative(actual: number, expected: number, tolerance = 1e-11) {
  if (expected === 0) {
    expect(Math.abs(actual)).toBeLessThan(tolerance);
    return;
  }
  const error = Math.abs(actual - expected) / Math.abs(expected);
  expect(
    error,
    `expected ${actual} to match ${expected} to ${tolerance} relative, was ${error}`,
  ).toBeLessThan(tolerance);
}

/** The two samples the worked examples below are all run on. */
const FIRST = [3, 4, 5, 8, 9, 1, 2, 4, 5];
const SECOND = [6, 19, 3, 2, 14, 4, 5, 17, 1];

describe("the t tests", () => {
  it("makes the paired test a one-sample test on the differences", () => {
    const differences = FIRST.map((value, index) => value - SECOND[index]!);
    const paired = pairedT(FIRST, SECOND);
    const oneSample = oneSampleT(differences, 0);
    expect(paired.t).toBe(oneSample.t);
    expect(paired.df).toBe(oneSample.df);
    expect(paired.df).toBe(8);
    expectRelative(paired.p, 0.19601578492528204, 1e-12);
  });

  it("reproduces the pooled and the Welch results", () => {
    const pooled = pooledT(FIRST, SECOND);
    expect(pooled.df).toBe(16);
    expectRelative(pooled.p, 0.19199588676039622, 1e-12);

    const welch = welchT(FIRST, SECOND);
    expectRelative(welch.p, 0.20229392336867796, 1e-12);
    // Satterthwaite gives a fractional degrees of freedom, and it is kept.
    expect(Number.isInteger(welch.df)).toBe(false);
    expect(welch.df).toBeGreaterThan(10);
    expect(welch.df).toBeLessThan(16);
  });

  it("agrees with the t distribution applied to its own statistic", () => {
    for (const result of [
      pairedT(FIRST, SECOND),
      pooledT(FIRST, SECOND),
      welchT(FIRST, SECOND),
    ]) {
      expectRelative(result.p, studentTTwoTail(result.t, result.df), 1e-14);
    }
  });

  it("gives the pooled and Welch tests the same answer on equal variances", () => {
    // Same size, same spread: the two are the same test, and the degrees of
    // freedom the approximation produces are the exact ones.
    const a = [10, 12, 14, 16, 18];
    const b = [11, 13, 15, 17, 19];
    const pooled = pooledT(a, b);
    const welch = welchT(a, b);
    expectRelative(welch.t, pooled.t, 1e-14);
    expectRelative(welch.df, pooled.df, 1e-12);
    expectRelative(welch.p, pooled.p, 1e-12);
  });

  it("is unaffected by shifting both samples by the same amount", () => {
    const shift = 1e6;
    const base = pooledT(FIRST, SECOND);
    const shifted = pooledT(
      FIRST.map((v) => v + shift),
      SECOND.map((v) => v + shift),
    );
    expectRelative(shifted.t, base.t, 1e-9);
  });
});

describe("the variance ratio test", () => {
  it("puts the larger variance on top whichever order it is given", () => {
    const forward = varianceRatioTest(FIRST, SECOND);
    const backward = varianceRatioTest(SECOND, FIRST);
    expect(forward.f).toBeGreaterThanOrEqual(1);
    expect(backward.f).toBeGreaterThanOrEqual(1);
    expectRelative(forward.p, backward.p, 1e-14);
    expectRelative(forward.p, 0.012763404751747401, 1e-12);
  });

  it("is twice the upper tail of the ratio it computes", () => {
    const result = varianceRatioTest(FIRST, SECOND);
    expectRelative(
      result.f,
      Math.max(sampleVariance(FIRST), sampleVariance(SECOND)) /
        Math.min(sampleVariance(FIRST), sampleVariance(SECOND)),
      1e-14,
    );
    expectRelative(result.p, 2 * fSf(result.f, result.df1, result.df2), 1e-14);
  });

  it("returns certainty when the two variances are identical", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [11, 12, 13, 14, 15];
    const result = varianceRatioTest(a, b);
    expectRelative(result.f, 1, 1e-14);
    expectRelative(result.p, 1, 1e-12);
  });
});

describe("the chi-squared test", () => {
  const observed = [58, 11, 35, 25];
  const expected = [48.9, 20.1, 44.1, 15.9];

  it("takes its degrees of freedom from the shape, not the count", () => {
    // The same four numbers: as a 2x2 table one degree of freedom, as a strip
    // three. Counting cells would give three in both cases.
    expect(chiSquareTest(observed, expected, 2, 2).df).toBe(1);
    expect(chiSquareTest(observed, expected, 1, 4).df).toBe(3);
    expect(chiSquareTest(observed, expected, 4, 1).df).toBe(3);
    expect(chiSquareTest(new Array(12).fill(5), new Array(12).fill(5), 3, 4).df).toBe(6);
  });

  it("reproduces the statistic and the probability", () => {
    const result = chiSquareTest(observed, expected, 2, 2);
    expectRelative(result.statistic, 12.899310408638984, 1e-12);
    expectRelative(result.p, 0.0003287032174651276, 1e-11);
    expectRelative(result.p, chiSquaredSf(result.statistic, 1), 1e-14);
  });

  it("gives a statistic of zero when the observed matches the expected", () => {
    const result = chiSquareTest(expected, expected, 2, 2);
    expect(result.statistic).toBe(0);
    expect(result.p).toBe(1);
  });
});

describe("the z test and the confidence intervals", () => {
  it("reproduces the one-tailed probability", () => {
    expectRelative(zTest(FIRST, 4), 0.26102636185764405, 1e-12);
    // With the deviation supplied rather than estimated.
    expectRelative(zTest(FIRST, 4, 2.5), 0.252492537546923, 1e-11);
  });

  it("keeps a strongly significant result rather than rounding it to zero", () => {
    // A mean sixteen standard errors above the hypothesis: a tail near 1e-58,
    // which `1 - cdf` would return as exactly zero.
    const sample = [100, 100, 100, 100, 100];
    const tail = zTest(sample, 0, 7);
    expect(tail).toBeGreaterThan(0);
    expect(tail).toBeLessThan(1e-50);
  });

  it("computes both interval half-widths", () => {
    expectRelative(confidenceNormal(0.05, 2.5, 50), 0.6929519121748389, 1e-12);
    expectRelative(confidenceStudent(0.05, 1, 50), 0.28419685549572987, 1e-10);
    // The t interval is the wider of the two, since the spread is estimated.
    expect(confidenceStudent(0.05, 2.5, 50)).toBeGreaterThan(
      confidenceNormal(0.05, 2.5, 50),
    );
    // And converges on it as the sample grows.
    expectRelative(
      confidenceStudent(0.05, 2.5, 200000),
      confidenceNormal(0.05, 2.5, 200000),
      1e-4,
    );
  });
});

describe("the test functions on a sheet", () => {
  function book() {
    const b = new Workbook();
    FIRST.forEach((value, index) => b.setCell(`A${index + 1}`, value));
    SECOND.forEach((value, index) => b.setCell(`B${index + 1}`, value));
    b.setCells({
      D1: 58,
      E1: 11,
      D2: 35,
      E2: 25,
      F1: 48.9,
      G1: 20.1,
      F2: 44.1,
      G2: 15.9,
    });
    return b;
  }

  function run(formula: string): Value {
    const b = book();
    b.setCell("Z1", formula);
    return b.getValue("Z1");
  }

  function code(formula: string): string {
    const value = run(formula);
    if (typeof value === "object" && value !== null && "code" in value) {
      return value.code as string;
    }
    return `not an error: ${JSON.stringify(value)}`;
  }

  it("runs all three kinds of t test", () => {
    expect(run("=T.TEST(A1:A9,B1:B9,2,1)")).toBeCloseTo(0.196015784925282, 12);
    expect(run("=T.TEST(A1:A9,B1:B9,2,2)")).toBeCloseTo(0.191995886760396, 12);
    expect(run("=T.TEST(A1:A9,B1:B9,2,3)")).toBeCloseTo(0.202293923368678, 12);
  });

  it("halves the two-tailed probability for a one-tailed test", () => {
    const two = run("=T.TEST(A1:A9,B1:B9,2,1)") as number;
    const one = run("=T.TEST(A1:A9,B1:B9,1,1)") as number;
    expect(one * 2).toBeCloseTo(two, 15);
  });

  it("runs the F, chi-squared and z tests", () => {
    expect(run("=F.TEST(A1:A9,B1:B9)")).toBeCloseTo(0.0127634047517474, 12);
    expect(run("=CHISQ.TEST(D1:E2,F1:G2)")).toBeCloseTo(
      0.000328703217465127,
      14,
    );
    expect(run("=Z.TEST(A1:A9,4)")).toBeCloseTo(0.261026361857644, 12);
    expect(run("=CONFIDENCE.NORM(0.05,2.5,50)")).toBeCloseTo(
      0.692951912174839,
      12,
    );
    expect(run("=CONFIDENCE.T(0.05,1,50)")).toBeCloseTo(0.284196855495729, 12);
  });

  it("reads the chi-squared degrees of freedom from the ranges given", () => {
    // The 2x2 table has one degree of freedom; the same numbers laid out as a
    // single row have three, and the probabilities differ accordingly.
    const table = run("=CHISQ.TEST(D1:E2,F1:G2)") as number;
    const strip = run("=CHISQ.TEST(D1:E1,F1:G1)") as number;
    expect(table).not.toBeCloseTo(strip, 6);
  });

  it("refuses mismatched, malformed and degenerate arguments", () => {
    expect(code("=T.TEST(A1:A9,B1:B8,2,1)")).toBe("#N/A");
    expect(code("=T.TEST(A1:A9,B1:B9,3,1)")).toBe("#NUM!");
    expect(code("=T.TEST(A1:A9,B1:B9,2,4)")).toBe("#NUM!");
    expect(code("=T.TEST(A1:A1,B1:B1,2,2)")).toBe("#DIV/0!");
    expect(code("=CHISQ.TEST(D1:E2,F1:G1)")).toBe("#N/A");
    expect(code("=F.TEST(A1:A1,B1:B1)")).toBe("#DIV/0!");
    expect(code("=Z.TEST(A1:A9,4,0)")).toBe("#NUM!");
    expect(code("=CONFIDENCE.NORM(0,2.5,50)")).toBe("#NUM!");
    expect(code("=CONFIDENCE.NORM(0.05,0,50)")).toBe("#NUM!");
    expect(code("=CONFIDENCE.T(0.05,1,1)")).toBe("#DIV/0!");
  });

  it("propagates an error found inside a sample", () => {
    const b = book();
    b.setCell("A3", "=1/0");
    b.setCell("Z1", "=T.TEST(A1:A9,B1:B9,2,2)");
    const value = b.getValue("Z1");
    expect((value as { code: string }).code).toBe("#DIV/0!");
  });

  it("skips text and blanks inside a block rather than coercing them", () => {
    const b = new Workbook();
    b.setCells({
      A1: "heading",
      A2: 3,
      A3: 4,
      A4: 5,
      B1: "heading",
      B2: 6,
      B3: 19,
      B4: 3,
    });
    b.setCell("Z1", "=T.TEST(A1:A4,B1:B4,2,1)");
    b.setCell("Z2", "=T.TEST(A2:A4,B2:B4,2,1)");
    expect(b.getValue("Z1")).toBe(b.getValue("Z2"));
  });
});
