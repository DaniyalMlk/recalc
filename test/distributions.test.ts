import { describe, expect, it } from "vitest";
import {
  betaCdf,
  betaInv,
  betaPdf,
  binomialCdf,
  binomialInv,
  binomialPmf,
  chiSquaredCdf,
  chiSquaredInv,
  chiSquaredInvRt,
  chiSquaredPdf,
  chiSquaredSf,
  exponentialCdf,
  exponentialPdf,
  fCdf,
  fInv,
  fInvRt,
  fPdf,
  fSf,
  gammaCdf,
  gammaInv,
  gammaPdf,
  hypergeometricCdf,
  hypergeometricPmf,
  lognormalCdf,
  lognormalInv,
  negativeBinomialCdf,
  negativeBinomialPmf,
  normalCdf,
  normalInv,
  normalPdf,
  poissonCdf,
  poissonPmf,
  standardNormalInv,
  studentTCdf,
  studentTInv,
  studentTInvTwoTail,
  studentTPdf,
  studentTSf,
  studentTTwoTail,
  weibullCdf,
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

/** The probabilities a round-trip is checked at, spanning fourteen decades. */
const PROBABILITIES = [
  1e-14, 1e-10, 1e-6, 0.001, 0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99, 0.999,
];

describe("the normal family", () => {
  it("hits the quantiles every table prints", () => {
    expectRelative(standardNormalInv(0.975), 1.959963984540054, 1e-14);
    expectRelative(standardNormalInv(0.95), 1.6448536269514722, 1e-14);
    expectRelative(standardNormalInv(0.99), 2.3263478740408408, 1e-14);
    expectRelative(standardNormalInv(0.995), 2.5758293035489004, 1e-14);
    expectRelative(normalCdf(1.96, 0, 1), 0.9750021048517795, 1e-14);
    expectRelative(normalCdf(-1.96, 0, 1), 0.024997895148220435, 1e-13);
  });

  it("integrates to its own density", () => {
    // Trapezoid over a fine grid; a crude check, but it is checking that the
    // pdf and the cdf describe the same distribution and not two of them.
    const step = 0.001;
    let area = 0;
    for (let x = -6; x < 2; x += step) {
      area += ((normalPdf(x, 0, 1) + normalPdf(x + step, 0, 1)) / 2) * step;
    }
    expect(area).toBeCloseTo(normalCdf(2, 0, 1), 7);
  });

  it("scales and shifts", () => {
    expectRelative(normalCdf(110, 100, 15), normalCdf(2 / 3, 0, 1));
    expectRelative(normalInv(0.9, 100, 15), 100 + 15 * standardNormalInv(0.9));
    expectRelative(normalPdf(110, 100, 15), normalPdf(2 / 3, 0, 1) / 15);
  });

  it("keeps the far tail rather than saturating at zero or one", () => {
    // Around z = -36 the probability is 4e-284: still a double, and a form
    // built on `1 + erf(z/sqrt 2)` would have rounded it to zero long before.
    expectRelative(normalCdf(-36, 0, 1), 4.182624065796808e-284, 1e-11);
    expect(normalCdf(-36, 0, 1)).toBeLessThan(1e-283);
    expect(standardNormalInv(1e-300)).toBeLessThan(-37);
    expect(standardNormalInv(1e-300)).toBeGreaterThan(-38);
    // Past about z = -39 the answer is smaller than the smallest subnormal,
    // and zero is then the right answer rather than a lost one.
    expect(normalCdf(-45, 0, 1)).toBe(0);
  });

  it("round-trips its own quantiles", () => {
    for (const p of [...PROBABILITIES, 1e-100, 1e-300]) {
      expectRelative(normalCdf(standardNormalInv(p), 0, 1), p, 1e-12);
    }
  });

  it("refuses a non-positive spread", () => {
    expect(Number.isNaN(normalCdf(1, 0, 0))).toBe(true);
    expect(Number.isNaN(normalPdf(1, 0, -2))).toBe(true);
    expect(Number.isNaN(normalInv(0.5, 0, 0))).toBe(true);
  });
});

describe("Student's t", () => {
  it("reproduces the published critical values", () => {
    // The two-sided 95% row of a t table, which is the one people quote.
    expectRelative(studentTInv(0.975, 1), 12.706204736174694, 1e-11);
    expectRelative(studentTInv(0.975, 2), 4.302652729749462, 1e-11);
    expectRelative(studentTInv(0.975, 10), 2.228138851986274, 1e-11);
    expectRelative(studentTInv(0.975, 30), 2.0422724563012378, 1e-11);
    expectRelative(studentTInv(0.995, 20), 2.8453397097861077, 1e-11);
    expectRelative(studentTInv(0.95, 1), 6.313751514675037, 1e-11);
  });

  it("converges on the normal as the degrees of freedom grow", () => {
    expect(Math.abs(studentTCdf(1.96, 1e8) - normalCdf(1.96, 0, 1))).toBeLessThan(
      1e-8,
    );
    expect(Math.abs(studentTInv(0.975, 1e8) - 1.959963984540054)).toBeLessThan(
      1e-6,
    );
  });

  it("is symmetric about zero", () => {
    for (const t of [0.3, 1.5, 4]) {
      for (const df of [1, 7, 40]) {
        expectRelative(studentTCdf(-t, df), 1 - studentTCdf(t, df), 1e-12);
        expectRelative(studentTPdf(-t, df), studentTPdf(t, df));
        expectRelative(studentTTwoTail(t, df), 2 * studentTSf(t, df), 1e-12);
      }
    }
    expect(studentTCdf(0, 5)).toBe(0.5);
    expect(studentTSf(0, 5)).toBe(0.5);
  });

  it("is the Cauchy at one degree of freedom", () => {
    // t with df = 1 has cdf 1/2 + atan(t)/pi in closed form.
    for (const t of [-3, -0.5, 0.5, 3]) {
      expectRelative(studentTCdf(t, 1), 0.5 + Math.atan(t) / Math.PI, 1e-12);
    }
  });

  it("keeps a small p-value small", () => {
    // 1 - cdf would be exactly zero here; the survival function is not.
    const tail = studentTSf(30, 100);
    expect(tail).toBeGreaterThan(0);
    expect(tail).toBeLessThan(1e-50);
    expect(1 - studentTCdf(30, 100)).toBe(0);
  });

  it("round-trips both tails and the two-tailed form", () => {
    for (const df of [1, 2, 5, 30, 1000, 1e6]) {
      for (const p of PROBABILITIES) {
        expectRelative(studentTCdf(studentTInv(p, df), df), p, 1e-9);
        expectRelative(
          studentTTwoTail(studentTInvTwoTail(p, df), df),
          p,
          1e-10,
        );
      }
    }
  });

  it("refuses non-positive degrees of freedom", () => {
    expect(Number.isNaN(studentTCdf(1, 0))).toBe(true);
    expect(Number.isNaN(studentTInv(0.5, -3))).toBe(true);
  });
});

describe("chi-squared", () => {
  it("reproduces the published critical values", () => {
    expectRelative(chiSquaredInv(0.95, 1), 3.841458820694124, 1e-11);
    expectRelative(chiSquaredInv(0.95, 10), 18.307038053275146, 1e-11);
    expectRelative(chiSquaredInv(0.99, 1), 6.634896601021213, 1e-11);
    expectRelative(chiSquaredInv(0.99, 20), 37.56623478662507, 1e-11);
    expectRelative(chiSquaredInv(0.05, 10), 3.9402991361190605, 1e-11);
  });

  it("is the square of a standard normal at one degree of freedom", () => {
    for (const z of [0.5, 1, 2, 3]) {
      expectRelative(chiSquaredCdf(z * z, 1), 2 * normalCdf(z, 0, 1) - 1, 1e-11);
    }
  });

  it("is the exponential at two degrees of freedom", () => {
    for (const x of [0.5, 2, 9]) {
      expectRelative(chiSquaredCdf(x, 2), -Math.expm1(-x / 2));
      expectRelative(chiSquaredPdf(x, 2), Math.exp(-x / 2) / 2);
    }
  });

  it("has a right tail that survives being small", () => {
    expectRelative(chiSquaredSf(100, 10) + chiSquaredCdf(100, 10), 1, 1e-12);
    expectRelative(chiSquaredSf(600, 10), 1.7609176946831897e-122, 1e-11);
    expect(1 - chiSquaredCdf(600, 10)).toBe(0);
  });

  it("round-trips both tails, including at very large df", () => {
    for (const df of [1, 2, 7, 100, 1e6]) {
      for (const p of PROBABILITIES) {
        expectRelative(chiSquaredCdf(chiSquaredInv(p, df), df), p, 1e-9);
        expectRelative(chiSquaredSf(chiSquaredInvRt(p, df), df), p, 1e-8);
      }
    }
  });

  it("places the median of a very large chi-squared where theory does", () => {
    // The median is close to df(1 - 2/(9df))^3, near df - 2/3.
    const median = chiSquaredInv(0.5, 1e6);
    expect(median).toBeGreaterThan(1e6 - 1);
    expect(median).toBeLessThan(1e6);
  });
});

describe("F", () => {
  it("reproduces the published critical values", () => {
    expectRelative(fInv(0.95, 5, 10), 3.3258345304130104, 1e-11);
    expectRelative(fInv(0.95, 1, 1), 161.4476387975882, 1e-11);
    expectRelative(fInv(0.95, 10, 20), 2.3478775669983114, 1e-11);
    expectRelative(fInv(0.99, 3, 20), 4.938193382310538, 1e-11);
  });

  it("is the square of a t with one numerator degree of freedom", () => {
    for (const df of [1, 4, 10, 50]) {
      for (const t of [0.5, 2.5, 6]) {
        expectRelative(fSf(t * t, 1, df), studentTTwoTail(t, df), 1e-12);
      }
    }
  });

  it("inverts to the reciprocal when the degrees of freedom swap", () => {
    // F(p; a, b) = 1 / F(1 - p; b, a).
    expectRelative(fInv(0.95, 5, 10), 1 / fInv(0.05, 10, 5), 1e-10);
    expectRelative(fInv(0.99, 3, 7), 1 / fInv(0.01, 7, 3), 1e-10);
  });

  it("has a right tail that survives being small", () => {
    expectRelative(fSf(3, 5, 10) + fCdf(3, 5, 10), 1, 1e-12);
    expect(fSf(1e12, 5, 10)).toBeGreaterThan(0);
  });

  it("round-trips both tails", () => {
    for (const [a, b] of [
      [1, 1],
      [3, 5],
      [20, 20],
      [1, 100],
      [100, 1],
    ] as const) {
      for (const p of PROBABILITIES) {
        expectRelative(fCdf(fInv(p, a, b), a, b), p, 1e-9);
        expectRelative(fSf(fInvRt(p, a, b), a, b), p, 1e-9);
      }
    }
  });

  it("clamps its support and refuses bad degrees of freedom", () => {
    expect(fCdf(-1, 3, 4)).toBe(0);
    expect(fPdf(-1, 3, 4)).toBe(0);
    expect(fCdf(Infinity, 3, 4)).toBe(1);
    expect(Number.isNaN(fCdf(1, 0, 4))).toBe(true);
  });
});

describe("gamma, beta, lognormal, exponential and Weibull", () => {
  it("matches the published gamma figures", () => {
    expectRelative(gammaCdf(10, 9, 2), 0.0680936347218484, 1e-12);
    expectRelative(gammaPdf(10, 9, 2), 0.032639019674079325, 1e-12);
  });

  it("makes the gamma collapse to the exponential at shape one", () => {
    for (const x of [0.5, 3, 12]) {
      expectRelative(gammaCdf(x, 1, 4), exponentialCdf(x, 1 / 4));
      expectRelative(gammaPdf(x, 1, 4), exponentialPdf(x, 1 / 4));
    }
  });

  it("makes the gamma collapse to the chi-squared at scale two", () => {
    for (const df of [1, 5, 12]) {
      expectRelative(gammaCdf(4, df / 2, 2), chiSquaredCdf(4, df));
    }
  });

  it("matches the beta's closed forms", () => {
    expectRelative(betaCdf(0.4, 1, 1), 0.4);
    expectRelative(betaPdf(0.4, 1, 1), 1);
    expectRelative(betaInv(0.5, 1, 1), 0.5);
    // Beta(2, 2) has cdf 3x^2 - 2x^3.
    for (const x of [0.2, 0.5, 0.9]) {
      expectRelative(betaCdf(x, 2, 2), 3 * x * x - 2 * x * x * x);
    }
  });

  it("relates the beta to the binomial it counts", () => {
    // I_p(k, n-k+1) = P(at least k successes in n trials).
    expectRelative(betaCdf(0.3, 8, 13), 1 - binomialCdf(7, 20, 0.3), 1e-11);
  });

  it("makes the lognormal the exponential of a normal", () => {
    expectRelative(lognormalCdf(Math.exp(1.5), 1, 0.5), normalCdf(1.5, 1, 0.5));
    expectRelative(lognormalInv(0.75, 1, 0.5), Math.exp(normalInv(0.75, 1, 0.5)));
    expect(lognormalCdf(0, 1, 0.5)).toBe(0);
    expect(lognormalCdf(-3, 1, 0.5)).toBe(0);
  });

  it("matches the published Weibull figure", () => {
    expectRelative(weibullCdf(105, 20, 100), 0.9295813900692769, 1e-12);
    // Shape one is the exponential again.
    expectRelative(weibullCdf(3, 1, 4), exponentialCdf(3, 1 / 4));
  });

  it("round-trips the gamma and beta quantiles", () => {
    for (const [shape, scale] of [
      [0.5, 1],
      [2, 3],
      [100, 0.1],
    ] as const) {
      for (const p of PROBABILITIES) {
        expectRelative(gammaCdf(gammaInv(p, shape, scale), shape, scale), p, 1e-9);
      }
    }
    for (const [a, b] of [
      [0.5, 0.5],
      [3, 5],
      [40, 2],
    ] as const) {
      for (const p of PROBABILITIES) {
        expectRelative(betaCdf(betaInv(p, a, b), a, b), p, 1e-9);
      }
    }
  });
});

describe("the discrete families", () => {
  /** The binomial written out longhand, for cases small enough to check. */
  function exactBinomial(k: number, n: number, p: number): number {
    let sum = 0;
    for (let j = 0; j <= k; j++) {
      let coefficient = 1;
      for (let i = 0; i < j; i++) coefficient = (coefficient * (n - i)) / (i + 1);
      sum += coefficient * Math.pow(p, j) * Math.pow(1 - p, n - j);
    }
    return sum;
  }

  it("gives the binomial the coefficients arithmetic gives", () => {
    // Six heads in ten fair tosses: 210/1024.
    expectRelative(binomialPmf(6, 10, 0.5), 210 / 1024);
    expectRelative(binomialPmf(0, 10, 0.5), 1 / 1024);
    expectRelative(binomialPmf(10, 10, 0.5), 1 / 1024);
    expectRelative(binomialCdf(6, 10, 0.5), exactBinomial(6, 10, 0.5), 1e-12);
  });

  it("agrees with the longhand sum across a range of parameters", () => {
    for (const [n, p] of [
      [10, 0.5],
      [20, 0.3],
      [35, 0.85],
      [50, 0.02],
    ] as const) {
      for (let k = 0; k <= n; k++) {
        expectRelative(binomialCdf(k, n, p), exactBinomial(k, n, p), 1e-10);
      }
    }
  });

  it("sums its own density to its cumulative", () => {
    let running = 0;
    for (let k = 0; k <= 30; k++) {
      running += binomialPmf(k, 30, 0.4);
      expectRelative(binomialCdf(k, 30, 0.4), running, 1e-11);
    }
    expectRelative(running, 1, 1e-12);
  });

  it("stays representable at a sample size that would overflow", () => {
    // C(1000000, 500000) is far past a double; the density is about 8e-4.
    const density = binomialPmf(500000, 1000000, 0.5);
    expect(Number.isFinite(density)).toBe(true);
    expectRelative(density, Math.sqrt(2 / (Math.PI * 1000000)), 1e-6);
    expectRelative(binomialCdf(500000, 1000000, 0.5), 0.5 + density / 2, 1e-9);
  });

  it("finds the criterion BINOM.INV asks for", () => {
    expect(binomialInv(10, 0.5, 0.75)).toBe(6);
    expect(binomialInv(6, 0.5, 0.75)).toBe(4);
    expect(binomialInv(10, 0.5, 0)).toBe(0);
    expect(binomialInv(10, 0.5, 1)).toBe(10);
    // The definition: the smallest k whose cumulative reaches alpha.
    for (const alpha of [0.05, 0.3, 0.5, 0.9, 0.99]) {
      const k = binomialInv(40, 0.35, alpha);
      expect(binomialCdf(k, 40, 0.35)).toBeGreaterThanOrEqual(alpha);
      if (k > 0) expect(binomialCdf(k - 1, 40, 0.35)).toBeLessThan(alpha);
    }
  });

  it("gives the Poisson its closed forms", () => {
    expectRelative(poissonPmf(2, 3), (9 * Math.exp(-3)) / 2);
    expectRelative(poissonCdf(2, 3), (1 + 3 + 4.5) * Math.exp(-3), 1e-12);
    expectRelative(poissonCdf(0, 3), Math.exp(-3));
    expect(poissonPmf(0, 0)).toBe(1);
    expect(poissonPmf(3, 0)).toBe(0);
  });

  it("sums the Poisson density to its cumulative", () => {
    let running = 0;
    for (let k = 0; k <= 40; k++) {
      running += poissonPmf(k, 8);
      expectRelative(poissonCdf(k, 8), running, 1e-11);
    }
  });

  it("gives the hypergeometric the count it is", () => {
    // One defective in a sample of four from twenty containing eight:
    // C(8,1) C(12,3) / C(20,4) = 8 * 220 / 4845.
    expectRelative(hypergeometricPmf(1, 4, 8, 20), (8 * 220) / 4845, 1e-12);
    let total = 0;
    for (let k = 0; k <= 4; k++) total += hypergeometricPmf(k, 4, 8, 20);
    expectRelative(total, 1, 1e-12);
    expectRelative(hypergeometricCdf(4, 4, 8, 20), 1, 1e-12);
    expect(hypergeometricPmf(5, 4, 8, 20)).toBe(0);
  });

  it("gives the negative binomial its coefficient and its beta identity", () => {
    expectRelative(negativeBinomialPmf(10, 5, 0.25), 0.05504866037517788, 1e-12);
    let running = 0;
    for (let f = 0; f <= 20; f++) {
      running += negativeBinomialPmf(f, 5, 0.25);
      expectRelative(negativeBinomialCdf(f, 5, 0.25), running, 1e-10);
    }
  });

  it("refuses parameters outside their domains", () => {
    expect(Number.isNaN(binomialPmf(3, 10, 1.5))).toBe(true);
    expect(Number.isNaN(poissonPmf(3, -1))).toBe(true);
    expect(Number.isNaN(negativeBinomialPmf(3, 0, 0.5))).toBe(true);
    expect(binomialPmf(11, 10, 0.5)).toBe(0);
    expect(binomialCdf(-1, 10, 0.5)).toBe(0);
    expect(binomialCdf(11, 10, 0.5)).toBe(1);
  });
});
