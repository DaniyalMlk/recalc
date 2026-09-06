import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import "../src/functions/index.js";
import type { Value } from "../src/engine/value.js";

function sheet(cells: Record<string, string | number | boolean> = {}) {
  const book = new Workbook();
  book.setCells(cells);
  return {
    eval(formula: string): Value {
      book.setCell("Z100", formula);
      return book.getValue("Z100");
    },
  };
}

const plain = sheet();
const ev = (formula: string) => plain.eval(formula);

/** The numeric result of a formula, or a failure naming what came back. */
function num(formula: string): number {
  const value = ev(formula);
  if (typeof value !== "number") {
    throw new Error(`${formula} produced ${JSON.stringify(value)}`);
  }
  return value;
}

function expectClose(formula: string, expected: number, tolerance = 1e-11) {
  const actual = num(formula);
  const error =
    expected === 0
      ? Math.abs(actual)
      : Math.abs(actual - expected) / Math.abs(expected);
  expect(error, `${formula} gave ${actual}, wanted ${expected}`).toBeLessThan(
    tolerance,
  );
}

/** The error code a formula produces, for the refusal tests. */
function code(formula: string): string {
  const value = ev(formula);
  if (typeof value === "object" && value !== null && "code" in value) {
    return value.code as string;
  }
  return `not an error: ${JSON.stringify(value)}`;
}

describe("the normal functions", () => {
  it("computes the cumulative and the density", () => {
    expectClose("=NORM.S.DIST(1.96, TRUE)", 0.9750021048517795);
    expectClose("=NORM.S.DIST(1.96)", 0.9750021048517795);
    expectClose("=NORM.S.DIST(0, FALSE)", 1 / Math.sqrt(2 * Math.PI));
    expectClose("=NORM.DIST(42, 40, 1.5, TRUE)", 0.9087887802741321);
    expectClose("=NORM.DIST(42, 40, 1.5, FALSE)", 0.10934004978399577);
  });

  it("inverts back to where it started", () => {
    expectClose("=NORM.S.INV(0.975)", 1.959963984540054);
    expectClose("=NORM.INV(0.908788780274132, 40, 1.5)", 42, 1e-9);
    expectClose("=NORM.S.INV(NORM.S.DIST(-2.5, TRUE))", -2.5, 1e-12);
  });

  it("standardises, and the pieces agree", () => {
    expectClose("=STANDARDIZE(42, 40, 1.5)", 4 / 3);
    expectClose("=PHI(0.5)", 0.3520653267642995);
    expectClose("=GAUSS(1.96)", 0.4750021048517795);
    // GAUSS is the cumulative less its half, by definition.
    expectClose("=GAUSS(1) - (NORM.S.DIST(1, TRUE) - 0.5)", 0, 1e-15);
  });

  it("refuses a deviation of zero and a probability outside the unit", () => {
    expect(code("=NORM.DIST(1, 0, 0, TRUE)")).toBe("#NUM!");
    expect(code("=NORM.DIST(1, 0, -1, TRUE)")).toBe("#NUM!");
    expect(code("=NORM.S.INV(0)")).toBe("#NUM!");
    expect(code("=NORM.S.INV(1)")).toBe("#NUM!");
    expect(code("=NORM.S.INV(1.5)")).toBe("#NUM!");
    expect(code("=STANDARDIZE(1, 0, 0)")).toBe("#NUM!");
  });

  it("refuses the wrong number of arguments", () => {
    expect(code("=NORM.DIST(1, 0, 1)")).toBe("#VALUE!");
    expect(code("=NORM.S.INV(1, 2)")).toBe("#VALUE!");
  });
});

describe("the t functions", () => {
  it("reproduces the values a t table prints", () => {
    expectClose("=T.INV.2T(0.05, 10)", 2.228138851986274);
    expectClose("=T.INV(0.975, 10)", 2.228138851986274);
    expectClose("=T.INV.2T(0.01, 20)", 2.8453397097861077);
    expectClose("=T.DIST.2T(2.228138851986274, 10)", 0.05, 1e-10);
    expectClose("=T.DIST.RT(2.228138851986274, 10)", 0.025, 1e-10);
    expectClose("=T.DIST(2.228138851986274, 10, TRUE)", 0.975, 1e-11);
  });

  it("keeps the three tails consistent with each other", () => {
    expectClose("=T.DIST(1.4, 7, TRUE) + T.DIST.RT(1.4, 7)", 1, 1e-13);
    expectClose("=T.DIST.2T(1.4, 7) - 2 * T.DIST.RT(1.4, 7)", 0, 1e-15);
    expectClose("=T.INV(0.975, 15) - T.INV.2T(0.05, 15)", 0, 1e-12);
  });

  it("truncates degrees of freedom rather than rounding them", () => {
    expectClose("=T.INV(0.975, 10.9)", num("=T.INV(0.975, 10)"), 1e-15);
  });

  it("refuses degrees of freedom below one and a negative two-tail", () => {
    expect(code("=T.DIST(1, 0, TRUE)")).toBe("#NUM!");
    expect(code("=T.DIST(1, 0.5, TRUE)")).toBe("#NUM!");
    expect(code("=T.DIST.2T(-1, 10)")).toBe("#NUM!");
    expect(code("=T.INV(0, 10)")).toBe("#NUM!");
    expect(code("=T.INV.2T(0, 10)")).toBe("#NUM!");
    expect(code("=T.INV.2T(1.5, 10)")).toBe("#NUM!");
  });
});

describe("the chi-squared functions", () => {
  it("reproduces the values a chi-squared table prints", () => {
    expectClose("=CHISQ.INV.RT(0.05, 10)", 18.307038053275146, 1e-10);
    expectClose("=CHISQ.INV(0.95, 10)", 18.307038053275146, 1e-10);
    expectClose("=CHISQ.INV.RT(0.01, 20)", 37.56623478662507, 1e-10);
    expectClose("=CHISQ.DIST.RT(18.307038053275146, 10)", 0.05, 1e-10);
    expectClose("=CHISQ.DIST(18.307038053275146, 10, TRUE)", 0.95, 1e-11);
  });

  it("keeps the two tails complementary", () => {
    expectClose("=CHISQ.DIST(7, 4, TRUE) + CHISQ.DIST.RT(7, 4)", 1, 1e-13);
    expectClose("=CHISQ.INV(0.3, 6) - CHISQ.INV.RT(0.7, 6)", 0, 1e-10);
  });

  it("gives the density at zero the value the shape implies", () => {
    // One degree of freedom has an integrable pole at the origin; two has a
    // finite density of a half; more starts at zero.
    expect(num("=CHISQ.DIST(0, 2, FALSE)")).toBe(0.5);
    expect(num("=CHISQ.DIST(0, 4, FALSE)")).toBe(0);
    expect(code("=CHISQ.DIST(0, 1, FALSE)")).toBe("#NUM!");
  });

  it("refuses a negative value and bad degrees of freedom", () => {
    expect(code("=CHISQ.DIST(-1, 3, TRUE)")).toBe("#NUM!");
    expect(code("=CHISQ.DIST(1, 0, TRUE)")).toBe("#NUM!");
    expect(code("=CHISQ.INV(1, 3)")).toBe("#NUM!");
    expect(code("=CHISQ.INV.RT(0, 3)")).toBe("#NUM!");
  });
});

describe("the F functions", () => {
  it("reproduces the values an F table prints", () => {
    expectClose("=F.INV.RT(0.05, 5, 10)", 3.3258345304130104, 1e-10);
    expectClose("=F.INV(0.95, 5, 10)", 3.3258345304130104, 1e-10);
    expectClose("=F.INV.RT(0.05, 10, 20)", 2.3478775669983114, 1e-10);
    expectClose("=F.DIST.RT(3.3258345304130104, 5, 10)", 0.05, 1e-10);
  });

  it("is the square of a t with one numerator degree of freedom", () => {
    expectClose(
      "=F.DIST.RT(2.5 * 2.5, 1, 12) - T.DIST.2T(2.5, 12)",
      0,
      1e-15,
    );
  });

  it("keeps the two tails complementary", () => {
    expectClose("=F.DIST(2, 4, 9, TRUE) + F.DIST.RT(2, 4, 9)", 1, 1e-13);
  });

  it("refuses a negative value and bad degrees of freedom", () => {
    expect(code("=F.DIST(-1, 3, 4, TRUE)")).toBe("#NUM!");
    expect(code("=F.DIST(1, 0, 4, TRUE)")).toBe("#NUM!");
    expect(code("=F.INV(1, 3, 4)")).toBe("#NUM!");
    expect(code("=F.INV.RT(0, 3, 4)")).toBe("#NUM!");
  });
});

describe("the gamma and beta functions", () => {
  it("computes gamma and its logarithm", () => {
    expectClose("=GAMMA(0.5)", Math.sqrt(Math.PI), 1e-14);
    expectClose("=GAMMA(6)", 120, 1e-13);
    expectClose("=GAMMALN(10)", 12.801827480081469, 1e-13);
    expectClose("=EXP(GAMMALN(6))", 120, 1e-12);
    // The poles, and only the poles, are refused.
    expect(code("=GAMMA(0)")).toBe("#NUM!");
    expect(code("=GAMMA(-2)")).toBe("#NUM!");
    expectClose("=GAMMA(-0.5)", -2 * Math.sqrt(Math.PI), 1e-13);
    expect(code("=GAMMALN(0)")).toBe("#NUM!");
    expect(code("=GAMMALN(-1)")).toBe("#NUM!");
  });

  it("computes the gamma distribution and inverts it", () => {
    expectClose("=GAMMA.DIST(10, 9, 2, TRUE)", 0.0680936347218484, 1e-12);
    expectClose("=GAMMA.DIST(10, 9, 2, FALSE)", 0.032639019674079325, 1e-12);
    expectClose("=GAMMA.INV(0.0680936347218484, 9, 2)", 10, 1e-9);
  });

  it("scales the beta onto the interval it is given", () => {
    expectClose("=BETA.DIST(0.4, 2, 3, TRUE)", 0.5248, 1e-12);
    expectClose("=BETA.INV(0.5, 2, 3)", 0.38572756813238956, 1e-11);
    // The same shape on [10, 20]: the quantile moves with the interval.
    expectClose("=BETA.INV(0.5, 2, 3, 10, 20)", 13.857275681323896, 1e-11);
    expectClose("=BETA.DIST(14, 2, 3, TRUE, 10, 20)", num("=BETA.DIST(0.4, 2, 3, TRUE)"), 1e-13);
    // A density over a ten-wide interval is a tenth of the unit one.
    expectClose(
      "=BETA.DIST(14, 2, 3, FALSE, 10, 20) * 10",
      num("=BETA.DIST(0.4, 2, 3, FALSE)"),
      1e-13,
    );
  });

  it("refuses shapes and intervals that make no sense", () => {
    expect(code("=GAMMA.DIST(-1, 9, 2, TRUE)")).toBe("#NUM!");
    expect(code("=GAMMA.DIST(1, 0, 2, TRUE)")).toBe("#NUM!");
    expect(code("=BETA.DIST(0.5, 0, 3, TRUE)")).toBe("#NUM!");
    expect(code("=BETA.DIST(25, 2, 3, TRUE, 10, 20)")).toBe("#NUM!");
    expect(code("=BETA.DIST(15, 2, 3, TRUE, 20, 10)")).toBe("#NUM!");
  });
});

describe("the remaining continuous families", () => {
  it("computes the lognormal both ways", () => {
    expectClose("=LOGNORM.DIST(4, 3.5, 1.2, TRUE)", 0.0390835557068005, 1e-11);
    expectClose("=LOGNORM.INV(0.0390835557068005, 3.5, 1.2)", 4, 1e-9);
    // Zero and below carry no probability, and the cumulative says so.
    expect(num("=LOGNORM.DIST(0, 3.5, 1.2, TRUE)")).toBe(0);
    expect(code("=LOGNORM.DIST(0, 3.5, 1.2, FALSE)")).toBe("#NUM!");
  });

  it("computes the exponential and the Weibull", () => {
    expectClose("=EXPON.DIST(0.2, 10, TRUE)", 0.8646647167633873, 1e-13);
    expectClose("=EXPON.DIST(0.2, 10, FALSE)", 1.353352832366127, 1e-13);
    expectClose("=WEIBULL.DIST(105, 20, 100, TRUE)", 0.9295813900692769, 1e-12);
    expectClose(
      "=WEIBULL.DIST(105, 20, 100, FALSE)",
      0.035588864024504334,
      1e-12,
    );
    // Shape one is the exponential with the reciprocal rate.
    expectClose(
      "=WEIBULL.DIST(3, 1, 4, TRUE) - EXPON.DIST(3, 0.25, TRUE)",
      0,
      1e-15,
    );
  });

  it("refuses a negative value or rate", () => {
    expect(code("=EXPON.DIST(-1, 10, TRUE)")).toBe("#NUM!");
    expect(code("=EXPON.DIST(1, 0, TRUE)")).toBe("#NUM!");
    expect(code("=WEIBULL.DIST(-1, 2, 3, TRUE)")).toBe("#NUM!");
  });
});

describe("the discrete families", () => {
  it("computes the binomial and its criterion", () => {
    expectClose("=BINOM.DIST(6, 10, 0.5, FALSE)", 210 / 1024, 1e-13);
    expectClose("=BINOM.DIST(6, 10, 0.5, TRUE)", 848 / 1024, 1e-13);
    expect(num("=BINOM.INV(10, 0.5, 0.75)")).toBe(6);
    expect(num("=BINOM.INV(6, 0.5, 0.75)")).toBe(4);
  });

  it("computes the Poisson", () => {
    expectClose("=POISSON.DIST(2, 3, FALSE)", (9 * Math.exp(-3)) / 2, 1e-13);
    expectClose(
      "=POISSON.DIST(2, 3, TRUE)",
      (1 + 3 + 4.5) * Math.exp(-3),
      1e-13,
    );
  });

  it("computes the hypergeometric", () => {
    expectClose("=HYPGEOM.DIST(1, 4, 8, 20, FALSE)", (8 * 220) / 4845, 1e-12);
    expectClose("=HYPGEOM.DIST(4, 4, 8, 20, TRUE)", 1, 1e-12);
  });

  it("computes the negative binomial", () => {
    expectClose(
      "=NEGBINOM.DIST(10, 5, 0.25, FALSE)",
      0.05504866037517788,
      1e-12,
    );
    expectClose(
      "=NEGBINOM.DIST(0, 5, 0.25, TRUE)",
      Math.pow(0.25, 5),
      1e-12,
    );
  });

  it("truncates counts and refuses impossible ones", () => {
    expectClose("=BINOM.DIST(6.9, 10, 0.5, FALSE)", 210 / 1024, 1e-13);
    expect(code("=BINOM.DIST(11, 10, 0.5, FALSE)")).toBe("#NUM!");
    expect(code("=BINOM.DIST(-1, 10, 0.5, FALSE)")).toBe("#NUM!");
    expect(code("=BINOM.DIST(3, 10, 1.5, FALSE)")).toBe("#NUM!");
    expect(code("=POISSON.DIST(-1, 3, FALSE)")).toBe("#NUM!");
    expect(code("=POISSON.DIST(1, -3, FALSE)")).toBe("#NUM!");
    // More successes drawn than the pool holds.
    expect(code("=HYPGEOM.DIST(5, 4, 8, 20, FALSE)")).toBe("#NUM!");
    expect(code("=HYPGEOM.DIST(1, 25, 8, 20, FALSE)")).toBe("#NUM!");
    expect(code("=NEGBINOM.DIST(3, 0, 0.5, FALSE)")).toBe("#NUM!");
  });
});

describe("distributions inside a sheet", () => {
  it("reads its arguments from cells and recalculates", () => {
    const book = new Workbook();
    book.setCells({
      A1: 0.05,
      A2: 10,
      B1: "=T.INV.2T(A1, A2)",
      B2: "=T.DIST.2T(B1, A2)",
    });
    expect(book.getValue("B1")).toBeCloseTo(2.228138851986274, 10);
    expect(book.getValue("B2")).toBeCloseTo(0.05, 12);
    book.setCell("A1", 0.01);
    expect(book.getValue("B1")).toBeCloseTo(3.169272672617331, 8);
    expect(book.getValue("B2")).toBeCloseTo(0.01, 12);
  });

  it("propagates an error from a precedent rather than coercing it", () => {
    const book = new Workbook();
    book.setCells({ A1: "=1/0", B1: "=NORM.S.DIST(A1, TRUE)" });
    const value = book.getValue("B1");
    expect(typeof value === "object" && value !== null && "code" in value).toBe(
      true,
    );
    expect((value as { code: string }).code).toBe("#DIV/0!");
  });

  it("accepts a single-cell range where a scalar is wanted", () => {
    const book = new Workbook();
    book.setCells({ A1: 1.96, B1: "=NORM.S.DIST(A1:A1, TRUE)" });
    expect(book.getValue("B1")).toBeCloseTo(0.9750021048517795, 12);
  });

  it("refuses a multi-cell range where a scalar is wanted", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, B1: "=NORM.S.DIST(A1:A2, TRUE)" });
    const value = book.getValue("B1");
    expect((value as { code: string }).code).toBe("#VALUE!");
  });
});
