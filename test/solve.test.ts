import { describe, expect, it } from "vitest";

import { findRoot, scaleStep } from "../src/analysis/solve.js";

/**
 * The root finder is tested against functions whose roots are known exactly,
 * across the range of scales a spreadsheet actually asks about: rates near
 * 0.03, prices near 40, balances in the millions. A solver that only works
 * near 1 is a solver that only works in its own test suite.
 */
describe("scaleStep", () => {
  it("scales with the starting point", () => {
    expect(scaleStep(1000)).toBeCloseTo(1, 12);
    expect(scaleStep(0.05)).toBeCloseTo(5e-5, 12);
  });

  it("is symmetric about zero", () => {
    expect(scaleStep(-250)).toBe(scaleStep(250));
  });

  it("borrows a scale when there is none", () => {
    expect(scaleStep(0)).toBeGreaterThan(0);
    expect(scaleStep(1e-20)).toBe(1e-4);
  });
});

describe("findRoot", () => {
  const near = (outcome: { x: number }, expected: number) =>
    expect(outcome.x).toBeCloseTo(expected, 6);

  it("solves a line", () => {
    const out = findRoot((x) => 2 * x - 7, { start: 0 });
    expect(out.converged).toBe(true);
    near(out, 3.5);
  });

  it("returns the starting point when it is already the root", () => {
    const out = findRoot((x) => x - 5, { start: 5 });
    expect(out.converged).toBe(true);
    expect(out.x).toBe(5);
    expect(out.evaluations).toBe(1);
  });

  it("solves a quadratic from a start on the near side", () => {
    const out = findRoot((x) => x * x - 9, { start: 1 });
    expect(out.converged).toBe(true);
    near(out, 3);
  });

  it("finds a root to the left of the start", () => {
    const out = findRoot((x) => x + 40, { start: 0 });
    expect(out.converged).toBe(true);
    near(out, -40);
  });

  it("solves at a small scale", () => {
    const out = findRoot((r) => 1000 * (1 + r) ** 10 - 1500, { start: 0.02 });
    expect(out.converged).toBe(true);
    expect(out.x).toBeCloseTo(1.5 ** 0.1 - 1, 9);
  });

  it("solves at a large scale", () => {
    const out = findRoot((x) => x * 0.065 - 552_500, { start: 1_000_000 });
    expect(out.converged).toBe(true);
    expect(out.x).toBeCloseTo(8_500_000, 4);
  });

  it("solves a cubic with a turning point between start and root", () => {
    // Roots at -3, 1 and 2; a start at 1.4 sits between two of them, where a
    // bare Newton or secant step walks the wrong way.
    const f = (x: number) => (x + 3) * (x - 1) * (x - 2);
    const out = findRoot(f, { start: 1.4 });
    expect(out.converged).toBe(true);
    expect([-3, 1, 2].some((r) => Math.abs(out.x - r) < 1e-6)).toBe(true);
  });

  it("solves through a flat region", () => {
    const out = findRoot((x) => Math.tanh(x - 4) - 0.5, { start: -20 });
    expect(out.converged).toBe(true);
    near(out, 4 + Math.atanh(0.5));
  });

  it("steps over an input where the function is undefined", () => {
    // A hole at x = 2, the way a cell holding =1/(A1-2) has one.
    const f = (x: number) => (x === 2 ? Number.NaN : x - 6);
    const out = findRoot(f, { start: 2 });
    expect(out.converged).toBe(true);
    near(out, 6);
  });

  it("steps over a whole undefined interval", () => {
    const f = (x: number) => (x > 0 && x < 3 ? Number.NaN : x - 8);
    const out = findRoot(f, { start: 1 });
    expect(out.converged).toBe(true);
    near(out, 8);
  });

  it("reports not-numeric when nothing evaluates", () => {
    const out = findRoot(() => Number.NaN, { start: 1 });
    expect(out.converged).toBe(false);
    expect(out.failure).toBe("not-numeric");
  });

  it("reports no-bracket for a function that never crosses zero", () => {
    const out = findRoot((x) => x * x + 1, { start: 0 });
    expect(out.converged).toBe(false);
    expect(out.failure).toBe("no-bracket");
  });

  it("keeps the closest point it found when it fails", () => {
    // x^2 + 1 has no root; its closest approach is 1, at x = 0. The search
    // should come back holding that, not the point it happened to stop on.
    const out = findRoot((x) => x * x + 1, { start: 5 });
    expect(out.converged).toBe(false);
    expect(out.fx).toBeCloseTo(1, 3);
    expect(Math.abs(out.x)).toBeLessThan(0.05);
  });

  it("respects a lower bound", () => {
    const out = findRoot((x) => x - -10, { start: 5, lower: 0 });
    expect(out.converged).toBe(false);
    expect(out.x).toBeGreaterThanOrEqual(0);
  });

  it("respects an upper bound", () => {
    const out = findRoot((x) => x - 500, { start: 5, upper: 100 });
    expect(out.converged).toBe(false);
    expect(out.x).toBeLessThanOrEqual(100);
  });

  it("finds a root that sits inside the bounds", () => {
    const out = findRoot((x) => x - 60, { start: 5, lower: 0, upper: 100 });
    expect(out.converged).toBe(true);
    near(out, 60);
  });

  it("stays within the evaluation budget", () => {
    const out = findRoot((x) => Math.sin(x) - 2, {
      start: 0,
      maxEvaluations: 40,
    });
    expect(out.evaluations).toBeLessThanOrEqual(40);
    expect(out.converged).toBe(false);
  });

  it("counts the evaluations it made", () => {
    let calls = 0;
    const out = findRoot(
      (x) => {
        calls++;
        return x - 12;
      },
      { start: 0 },
    );
    expect(out.evaluations).toBe(calls);
  });

  it("honours a loose tolerance", () => {
    const out = findRoot((x) => x - 3, { start: 0, tolerance: 0.5 });
    expect(out.converged).toBe(true);
    expect(Math.abs(out.x - 3)).toBeLessThanOrEqual(0.5);
  });

  it("solves a discontinuity as a failure rather than a wrong answer", () => {
    // A step function crosses zero without ever being near it.
    const f = (x: number) => (x < 1 ? -5 : 5);
    const out = findRoot(f, { start: 0 });
    expect(out.converged).toBe(false);
    expect(Math.abs(out.fx)).toBe(5);
  });

  it.each([
    [1, 25],
    [-1, -25],
    [1e6, 4.2e7],
    [1e-4, 3.5e-3],
  ])("solves x - t = 0 from %p for t = %p", (start, target) => {
    const out = findRoot((x) => x - target, { start });
    expect(out.converged).toBe(true);
    expect(out.x).toBeCloseTo(target, 6);
  });
});
