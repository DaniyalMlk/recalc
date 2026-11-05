import { describe, expect, it } from "vitest";
import { solveRate } from "../src/functions/solver.js";

/**
 * The window the caller asks for, and whether the answer is inside it.
 *
 * `lower` and `upper` are documented as the lowest and highest rate to
 * consider. Newton honoured them — a step outside the interval is a failure —
 * but the bracketing search that takes over when Newton fails did not, and nor
 * did the point Newton started from. The grid was built by checking each half
 * against the end it was nearer, so a positive point was never compared with
 * `lower`, a negative one never with `upper`, and zero went in unconditionally.
 *
 * That leaves three ways out of the window, and the interesting part is that
 * the search was not merely sloppy: on a function with a root inside the
 * window and another outside it, the scan ran into the outside one first and
 * returned it, so the caller was given the wrong root rather than no root.
 */

/** Roots at 0.05 and 0.40. */
const twoRoots = (rate: number): number => (rate - 0.05) * (rate - 0.4);
/** One root, at -0.05. */
const oneRoot = (rate: number): number => rate + 0.05;
/** One root, at exactly 0.4, with `f(0.4)` exactly zero. */
const line = (rate: number): number => rate - 0.4;

describe("a rate outside the window is not an answer", () => {
  it("returns the root that is in the window, not the one that is not", () => {
    // 0.05 and 0.40 are both roots; only 0.40 is in the window. Before the
    // fix this returned 0.05000000006092875.
    const root = solveRate(twoRoots, { lower: 0.25, upper: 1 });
    expect(root).not.toBeNull();
    expect(root).toBeGreaterThan(0.25);
    expect(root).toBeCloseTo(0.4, 8);
  });

  it("reports no root when the window holds none", () => {
    // Both roots are outside [0.1, 0.3] and the function does not change sign
    // inside it. Before the fix this returned 0.05000000006092875 — a rate
    // below the window, and the one the caller had just excluded.
    expect(solveRate(twoRoots, { lower: 0.1, upper: 0.3, guess: 0.2 })).toBeNull();
    // The upper end leaks the same way round. -0.05 is above -0.1, and before
    // the fix came back as -0.05000000006092875.
    expect(solveRate(oneRoot, { lower: -0.9, upper: -0.1 })).toBeNull();
  });

  it("still finds a root that is in the window", () => {
    // The half of the claim a narrowing bug would also satisfy: a fix that
    // simply searched less would pass every assertion above. Move the upper
    // bound past -0.05 and the same root comes back.
    expect(solveRate(oneRoot, { lower: -0.9, upper: -0.01 })).toBeCloseTo(-0.05, 9);
    expect(solveRate(twoRoots, { lower: -0.9, upper: 0.2 })).toBeCloseTo(0.05, 9);
    expect(solveRate(twoRoots)).toBeCloseTo(0.05, 9);
  });

  it("does not start from a guess outside the window", () => {
    // Newton checked every step against the bounds but not its starting
    // point, so a guess outside the window would be returned the moment the
    // function was within tolerance there. 0.05 is a root and is below the
    // window; the answer is the one inside.
    expect(solveRate(twoRoots, { lower: 0.25, upper: 1, guess: 0.05 })).toBeCloseTo(
      0.4,
      8,
    );
    expect(solveRate(line, { lower: 0.41, upper: 1, guess: 0.4 })).toBeNull();
  });

  it("answers an empty or inverted window without searching", () => {
    expect(solveRate(twoRoots, { lower: 0.4, upper: 0.4 })).toBeNull();
    expect(solveRate(twoRoots, { lower: 1, upper: 0.25 })).toBeNull();
  });

  it("finds a root sitting exactly on the lower bound", () => {
    // The scan tests each point against the one before it, so its first point
    // is only ever a bracket end. A sign change at zero is not a change —
    // `previousF * fx < 0` is false when `previousF` is zero, whatever `fx`
    // is — so a root exactly on the lower bound was invisible to it. Here the
    // default guess of 0.1 is below the window, which keeps Newton out and
    // leaves the scan to answer.
    expect(line(0.4)).toBe(0);
    expect(solveRate(line, { lower: 0.4, upper: 1 })).toBe(0.4);
  });

  it("keeps every answer inside the window, over a sweep of windows", () => {
    // A single assertion of the whole claim rather than case by case, and one
    // that counts its hits: "no answer was outside the window" is satisfied by
    // never answering at all.
    const bounds = [-0.9, -0.3, -0.04, 0, 0.04, 0.06, 0.2, 0.3, 0.39, 0.41, 0.8, 5];
    let found = 0;
    let refused = 0;
    for (const lower of bounds) {
      for (const upper of bounds) {
        if (!(lower < upper)) continue;
        for (const guess of [-0.5, 0, 0.1, 0.35, 2]) {
          const root = solveRate(twoRoots, { lower, upper, guess });
          if (root === null) {
            refused += 1;
            continue;
          }
          found += 1;
          expect(root, `window [${lower}, ${upper}] guess ${guess}`).toBeGreaterThanOrEqual(
            lower,
          );
          expect(root, `window [${lower}, ${upper}] guess ${guess}`).toBeLessThanOrEqual(
            upper,
          );
        }
      }
    }
    expect(found).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(20);
    // And a window containing a root always finds one, so the sweep is not
    // passing by refusing everything awkward.
    for (const guess of [-0.5, 0, 0.1, 0.35, 2]) {
      expect(solveRate(twoRoots, { lower: 0.3, upper: 0.8, guess })).toBeCloseTo(0.4, 7);
    }
  });
});

describe("the default window is unchanged", () => {
  it("solves the reversal and the turning point exactly as before", () => {
    const flows = [-1000, 2500, -1560];
    const presentValue = (rate: number): number =>
      flows.reduce((sum, flow, period) => sum + flow / Math.pow(1 + rate, period), 0);
    expect(solveRate(presentValue)).toBe(0.19999999999999843);

    const turningPoint = (rate: number): number => Math.pow(rate - 0.1, 2) - 0.04;
    expect(solveRate(turningPoint)).toBe(-0.1000000001818186);

    // The two budget thresholds measured when the cap was threaded through
    // bisection: narrowing the grid would move both of them.
    const smallest = (f: (x: number) => number): number => {
      for (let cap = 1; cap <= 400; cap += 1) {
        if (solveRate(f, { maxIterations: cap }) !== null) return cap;
      }
      return -1;
    };
    expect(smallest(turningPoint)).toBe(26);
    const wide = (rate: number): number =>
      Math.pow(rate - 0.1, 2) - Math.pow(949999.9, 2);
    expect(smallest(wide)).toBe(49);
  });
});
