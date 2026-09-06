import { describe, expect, it } from "vitest";
import {
  bracketAbove,
  erf,
  erfc,
  gamma,
  gammaP,
  gammaQ,
  incompleteBeta,
  invertMonotone,
  lnBeta,
  lnChoose,
  lnFactorial,
  lnGamma,
} from "../src/numeric/special.js";

/**
 * Assert a *relative* agreement.
 *
 * `toBeCloseTo` is absolute, which makes it far too lenient for a value of
 * 1e-45 and far too strict for one of 1e6. Everything in this file is judged
 * on the digits it got right rather than on the distance to the answer.
 */
function expectRelative(actual: number, expected: number, tolerance = 1e-13) {
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

describe("lnGamma", () => {
  it("reproduces the factorials it generalises", () => {
    let factorial = 1;
    for (let n = 1; n <= 20; n++) {
      factorial *= n;
      expectRelative(Math.exp(lnGamma(n + 1)), factorial, 1e-13);
    }
  });

  it("hits the closed forms at the half integers", () => {
    // Gamma(1/2) = sqrt(pi), and each step up multiplies by the argument.
    expectRelative(gamma(0.5), Math.sqrt(Math.PI));
    expectRelative(gamma(1.5), Math.sqrt(Math.PI) / 2);
    expectRelative(gamma(2.5), (3 * Math.sqrt(Math.PI)) / 4);
    expectRelative(gamma(4.5), (105 * Math.sqrt(Math.PI)) / 16);
  });

  it("satisfies the recurrence that defines it", () => {
    for (const x of [0.3, 1.7, 6.25, 40.5, 130]) {
      expectRelative(lnGamma(x + 1), lnGamma(x) + Math.log(x));
    }
  });

  it("satisfies the duplication formula", () => {
    // Gamma(z) Gamma(z + 1/2) = 2^(1 - 2z) sqrt(pi) Gamma(2z).
    for (const z of [0.4, 1.1, 3.75, 12]) {
      const left = lnGamma(z) + lnGamma(z + 0.5);
      const right =
        (1 - 2 * z) * Math.LN2 + 0.5 * Math.log(Math.PI) + lnGamma(2 * z);
      expectRelative(left, right, 1e-13);
    }
  });

  it("reflects through the negative axis", () => {
    expectRelative(gamma(-0.5), -2 * Math.sqrt(Math.PI));
    expectRelative(gamma(-1.5), (4 / 3) * Math.sqrt(Math.PI));
  });

  it("stays finite where the value itself would overflow", () => {
    // 200! is about 1e375, past the largest double.
    expect(Number.isFinite(lnGamma(201))).toBe(true);
    expect(lnGamma(201)).toBeGreaterThan(800);
    expect(Number.isFinite(lnFactorial(1e6))).toBe(true);
  });

  it("is not defined at the poles", () => {
    expect(Number.isNaN(lnGamma(0))).toBe(true);
    expect(Number.isNaN(lnGamma(-3))).toBe(true);
    expect(Number.isNaN(gamma(-2))).toBe(true);
  });
});

describe("lnChoose", () => {
  it("agrees with the exact integer coefficient", () => {
    const exact = (n: number, k: number): number => {
      let acc = 1;
      for (let i = 0; i < k; i++) acc = (acc * (n - i)) / (i + 1);
      return acc;
    };
    for (const [n, k] of [
      [5, 2],
      [10, 5],
      [20, 7],
      [30, 15],
      [52, 5],
    ] as const) {
      expectRelative(Math.exp(lnChoose(n, k)), exact(n, k), 1e-12);
    }
  });

  it("is symmetric, and empty outside the range", () => {
    expectRelative(lnChoose(17, 6), lnChoose(17, 11));
    expect(lnChoose(5, 6)).toBe(Number.NEGATIVE_INFINITY);
    expect(lnChoose(5, -1)).toBe(Number.NEGATIVE_INFINITY);
    expect(lnChoose(9, 0)).toBe(0);
  });

  it("stays finite for a coefficient that would not fit a double", () => {
    expect(Number.isFinite(lnChoose(2000, 1000))).toBe(true);
  });
});

describe("lnBeta", () => {
  it("matches the closed form for integer arguments", () => {
    // B(a, b) = (a-1)!(b-1)!/(a+b-1)! for positive integers.
    expectRelative(Math.exp(lnBeta(3, 4)), (2 * 6) / 720);
    expectRelative(Math.exp(lnBeta(1, 1)), 1);
    expectRelative(Math.exp(lnBeta(2, 5)), 1 / 30);
  });

  it("is symmetric in its arguments", () => {
    expectRelative(lnBeta(2.5, 7.25), lnBeta(7.25, 2.5));
  });
});

describe("the incomplete gamma integrals", () => {
  it("collapse to the exponential at a shape of one", () => {
    // P(1, x) = 1 - exp(-x) exactly.
    for (const x of [0.01, 0.1, 1, 5, 20]) {
      expectRelative(gammaP(1, x), -Math.expm1(-x));
    }
  });

  it("keep the far upper tail rather than rounding it away", () => {
    // Q(1, 50) = exp(-50), about 2e-22. Computing it as 1 - P would give zero.
    expectRelative(gammaQ(1, 50), Math.exp(-50));
    expectRelative(gammaQ(1, 300), Math.exp(-300));
    expect(1 - gammaP(1, 300)).toBe(0);
  });

  it("relate to the error function at a shape of one half", () => {
    for (const x of [0.25, 1, 2.5]) {
      expectRelative(gammaP(0.5, x * x), erf(x));
    }
  });

  it("sum to one across the crossover between the two expansions", () => {
    // x = a + 1 is where the series hands over to the continued fraction; the
    // two have to agree there or every distribution has a seam in it.
    for (const a of [0.5, 1, 2, 7.5, 30, 200]) {
      for (const x of [a * 0.5, a, a + 0.999, a + 1, a + 1.001, a * 3]) {
        expectRelative(gammaP(a, x) + gammaQ(a, x), 1, 1e-14);
      }
    }
  });

  it("reproduce the published table values", () => {
    // P(a, x) from Abramowitz & Stegun's tabulation of the incomplete gamma.
    expectRelative(gammaP(2, 1), 1 - 2 * Math.exp(-1));
    expectRelative(gammaP(3, 2), 1 - 5 * Math.exp(-2));
    // P(n, x) for integer n is the Poisson upper tail with mean x.
    const poissonUpper = (n: number, x: number): number => {
      let sum = 0;
      for (let k = n; k < n + 400; k++) {
        sum += Math.exp(-x + k * Math.log(x) - lnFactorial(k));
      }
      return sum;
    };
    for (const [n, x] of [
      [3, 1.5],
      [6, 4],
      [12, 10],
    ] as const) {
      expectRelative(gammaP(n, x), poissonUpper(n, x), 1e-12);
    }
  });

  it("refuses a non-positive shape and clamps its support", () => {
    expect(Number.isNaN(gammaP(0, 1))).toBe(true);
    expect(Number.isNaN(gammaQ(-1, 1))).toBe(true);
    expect(gammaP(2, 0)).toBe(0);
    expect(gammaP(2, -5)).toBe(0);
    expect(gammaQ(2, 0)).toBe(1);
    expect(gammaP(2, Infinity)).toBe(1);
  });
});

describe("erf and erfc", () => {
  it("hit the published values", () => {
    expectRelative(erf(0.5), 0.5204998778130465);
    expectRelative(erf(1), 0.8427007929497149);
    expectRelative(erf(2), 0.995322265018953);
    expectRelative(erf(3), 0.9999779095030014);
  });

  it("keep the tail where subtraction would lose it", () => {
    expectRelative(erfc(5), 1.5374597944280351e-12, 1e-12);
    expectRelative(erfc(10), 2.088487583762545e-45, 1e-12);
    expect(1 - erf(10)).toBe(0);
  });

  it("is odd, and complementary to erfc", () => {
    for (const x of [0.1, 0.75, 2, 4.5]) {
      expectRelative(erf(-x), -erf(x));
      expectRelative(erf(x) + erfc(x), 1, 1e-14);
      expectRelative(erfc(-x), 2 - erfc(x), 1e-14);
    }
    expect(erf(0)).toBe(0);
    expect(erfc(0)).toBe(1);
  });
});

describe("the incomplete beta", () => {
  it("collapses to the identity when both shapes are one", () => {
    for (const x of [0.1, 0.5, 0.9]) expectRelative(incompleteBeta(1, 1, x), x);
  });

  it("collapses to a power when one shape is one", () => {
    // I_x(1, b) = 1 - (1 - x)^b and I_x(a, 1) = x^a.
    expectRelative(incompleteBeta(1, 5, 0.2), 1 - Math.pow(0.8, 5));
    expectRelative(incompleteBeta(4, 1, 0.7), Math.pow(0.7, 4));
  });

  it("reflects across the reflection point without a seam", () => {
    // I_x(a, b) + I_{1-x}(b, a) = 1, and the implementation switches branch
    // somewhere in the middle, so this is the test that the branches agree.
    for (const [a, b] of [
      [2.5, 3.5],
      [0.5, 0.5],
      [12, 3],
      [1, 40],
      [80, 80],
    ] as const) {
      for (const x of [0.05, 0.2, 0.4, 0.5, 0.6, 0.8, 0.95]) {
        expectRelative(
          incompleteBeta(a, b, x) + incompleteBeta(b, a, 1 - x),
          1,
          1e-13,
        );
      }
    }
  });

  it("agrees with the binomial sum it is the closed form of", () => {
    // sum_{j=0..k} C(n,j) p^j (1-p)^(n-j) = I_{1-p}(n-k, k+1).
    const sum = (n: number, k: number, p: number): number => {
      let acc = 0;
      for (let j = 0; j <= k; j++) {
        acc += Math.exp(
          lnChoose(n, j) + j * Math.log(p) + (n - j) * Math.log1p(-p),
        );
      }
      return acc;
    };
    for (const [n, k, p] of [
      [20, 7, 0.3],
      [50, 25, 0.5],
      [12, 2, 0.1],
    ] as const) {
      expectRelative(incompleteBeta(n - k, k + 1, 1 - p), sum(n, k, p), 1e-12);
    }
  });

  it("clamps its support and refuses non-positive shapes", () => {
    expect(incompleteBeta(2, 3, 0)).toBe(0);
    expect(incompleteBeta(2, 3, 1)).toBe(1);
    expect(incompleteBeta(2, 3, -0.5)).toBe(0);
    expect(incompleteBeta(2, 3, 4)).toBe(1);
    expect(Number.isNaN(incompleteBeta(0, 3, 0.5))).toBe(true);
    expect(Number.isNaN(incompleteBeta(2, -1, 0.5))).toBe(true);
  });
});

describe("invertMonotone", () => {
  it("finds a root to full relative precision", () => {
    const root = invertMonotone((x) => x * x, 2, 0, 4);
    expectRelative(root, Math.SQRT2, 1e-15);
  });

  it("keeps its precision on a root far from one", () => {
    const tiny = invertMonotone((x) => x * x, 1e-20, 0, 1);
    expectRelative(tiny, 1e-10, 1e-12);
  });

  it("returns the bracket ends when the target is outside them", () => {
    expect(invertMonotone((x) => x, 5, 0, 1)).toBe(1);
    expect(invertMonotone((x) => x, -5, 0, 1)).toBe(0);
  });

  it("inverts a cumulative that is flat in its tail", () => {
    // The point of bisection over Newton: the derivative here has underflowed.
    const cdf = (x: number) => 1 - Math.exp(-x);
    const q = invertMonotone(cdf, 0.5, 0, 100);
    expectRelative(q, Math.LN2, 1e-14);
  });
});

describe("bracketAbove", () => {
  it("grows until it straddles the target", () => {
    const [lo, hi] = bracketAbove((x) => x, 1000, 1);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThanOrEqual(1000);
  });

  it("produces a bracket the inverter can then use", () => {
    const cdf = (x: number) => 1 - Math.exp(-x / 1e6);
    const [lo, hi] = bracketAbove(cdf, 0.99, 1);
    expectRelative(invertMonotone(cdf, 0.99, lo, hi), -1e6 * Math.log(0.01));
  });

  it("respects a floor other than zero", () => {
    const [lo, hi] = bracketAbove((x) => x, 50, 11, 10);
    expect(lo).toBe(10);
    expect(hi).toBeGreaterThanOrEqual(50);
  });
});
