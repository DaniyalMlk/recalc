import { describe, expect, it } from "vitest";
import {
  backSubstitute,
  colCount,
  decompose,
  determinant,
  identity,
  invert,
  invertUpper,
  isRectangular,
  isSquare,
  leastSquares,
  multiply,
  qrFactor,
  rowCount,
  solve,
  transpose,
} from "../src/numeric/linalg.js";
import type { Rows } from "../src/numeric/linalg.js";

/** Assert two matrices agree to `digits` decimal places. */
function expectClose(actual: Rows | null, expected: Rows, digits = 10): void {
  expect(actual).not.toBeNull();
  const got = actual as Rows;
  expect(rowCount(got)).toBe(rowCount(expected));
  expect(colCount(got)).toBe(colCount(expected));
  for (let i = 0; i < rowCount(expected); i++) {
    for (let j = 0; j < colCount(expected); j++) {
      expect(got[i]![j]!).toBeCloseTo(expected[i]![j]!, digits);
    }
  }
}

describe("shape helpers", () => {
  it("recognises a rectangle and a square", () => {
    expect(isRectangular([[1, 2], [3, 4], [5, 6]])).toBe(true);
    expect(isRectangular([[1, 2], [3]])).toBe(false);
    expect(isSquare([[1, 2], [3, 4]])).toBe(true);
    expect(isSquare([[1, 2, 3], [4, 5, 6]])).toBe(false);
    expect(isSquare([])).toBe(false);
  });

  it("transposes", () => {
    expect(transpose([[1, 2, 3], [4, 5, 6]])).toEqual([[1, 4], [2, 5], [3, 6]]);
  });

  it("builds an identity", () => {
    expect(identity(3)).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  });
});

describe("multiplication", () => {
  it("multiplies conformable matrices", () => {
    expect(multiply([[1, 2], [3, 4]], [[5, 6], [7, 8]])).toEqual([
      [19, 22],
      [43, 50],
    ]);
  });

  it("multiplies non-square matrices", () => {
    expect(multiply([[1, 2, 3]], [[4], [5], [6]])).toEqual([[32]]);
  });

  it("refuses a dimension mismatch", () => {
    expect(multiply([[1, 2]], [[1, 2]])).toBeNull();
  });

  it("leaves a matrix alone when multiplied by the identity", () => {
    const a = [[2, -1, 3], [0, 4, 5], [7, 1, -2]];
    expectClose(multiply(a, identity(3)), a);
    expectClose(multiply(identity(3), a), a);
  });
});

describe("determinant", () => {
  it("matches the closed form for 2x2", () => {
    expect(determinant([[3, 8], [4, 6]])).toBeCloseTo(3 * 6 - 8 * 4, 10);
  });

  it("matches cofactor expansion for 3x3", () => {
    const a = [[6, 1, 1], [4, -2, 5], [2, 8, 7]];
    // 6(-2*7 - 5*8) - 1(4*7 - 5*2) + 1(4*8 - -2*2) = -306
    expect(determinant(a)).toBeCloseTo(-306, 9);
  });

  it("is zero for a singular matrix", () => {
    expect(determinant([[1, 2], [2, 4]])).toBe(0);
    expect(determinant([[1, 2, 3], [4, 5, 6], [7, 8, 9]])).toBeCloseTo(0, 9);
  });

  it("is one for the identity, at every size", () => {
    for (const n of [1, 2, 3, 5, 8]) {
      expect(determinant(identity(n))).toBeCloseTo(1, 10);
    }
  });

  it("changes sign when two rows are swapped", () => {
    const a = [[1, 2, 3], [0, 1, 4], [5, 6, 0]];
    const swapped = [a[1]!, a[0]!, a[2]!];
    expect(determinant(swapped)).toBeCloseTo(-determinant(a), 9);
  });

  it("is multiplicative", () => {
    const a = [[2, 1], [1, 3]];
    const b = [[4, -1], [2, 5]];
    const product = multiply(a, b)!;
    expect(determinant(product)).toBeCloseTo(
      determinant(a) * determinant(b),
      8,
    );
  });

  it("survives a zero in the pivot position", () => {
    // Without pivoting this divides by zero on the first step.
    expect(determinant([[0, 1], [1, 0]])).toBeCloseTo(-1, 10);
  });
});

describe("inversion", () => {
  it("multiplies back to the identity", () => {
    const a = [[4, 7], [2, 6]];
    expectClose(multiply(a, invert(a)!), identity(2));
    expectClose(multiply(invert(a)!, a), identity(2));
  });

  it("matches the closed form for 2x2", () => {
    expectClose(invert([[4, 7], [2, 6]]), [
      [0.6, -0.7],
      [-0.2, 0.4],
    ]);
  });

  it("multiplies back to the identity for a larger matrix", () => {
    const a = [
      [2, -1, 0, 3],
      [1, 4, -2, 0],
      [0, 5, 3, -1],
      [7, 0, 1, 2],
    ];
    expectClose(multiply(a, invert(a)!), identity(4), 9);
  });

  it("refuses a singular matrix", () => {
    expect(invert([[1, 2], [2, 4]])).toBeNull();
    expect(invert([[1, 2, 3], [4, 5, 6], [7, 8, 9]])).toBeNull();
  });

  it("inverts a matrix whose first pivot is zero", () => {
    const a = [[0, 1, 2], [1, 0, 3], [4, -3, 8]];
    expectClose(multiply(a, invert(a)!), identity(3), 9);
  });
});

describe("solving", () => {
  it("solves a system whose answer is known", () => {
    // x + y = 5, 2x - y = 1  ->  x = 2, y = 3
    const x = solve([[1, 1], [2, -1]], [[5], [1]]);
    expectClose(x, [[2], [3]]);
  });

  it("solves several right-hand sides at once", () => {
    const a = [[2, 1], [1, 3]];
    const x = solve(a, [[1, 0], [0, 1]])!;
    expectClose(multiply(a, x), identity(2));
  });

  it("reports a singular system", () => {
    expect(solve([[1, 2], [2, 4]], [[1], [2]])).toBeNull();
  });

  it("records the row swaps it made", () => {
    const { perm, sign } = decompose([[0, 1], [1, 0]]);
    expect(perm).toEqual([1, 0]);
    expect(sign).toBe(-1);
  });
});

describe("triangular routines", () => {
  it("back-substitutes", () => {
    // 2x + 3y = 8, 4y = 8  ->  y = 2, x = 1
    expect(backSubstitute([[2, 3], [0, 4]], [8, 8])).toEqual([1, 2]);
  });

  it("reports a zero pivot", () => {
    expect(backSubstitute([[0, 1], [0, 2]], [1, 2])).toBeNull();
  });

  it("inverts an upper triangular matrix back to the identity", () => {
    const r = [[2, 3, 1], [0, 4, -2], [0, 0, 5]];
    expectClose(multiply(r, invertUpper(r)!), identity(3));
  });
});

describe("QR factorisation", () => {
  it("produces an R whose product with itself is X transpose X", () => {
    const x = [[1, 1], [1, 2], [1, 3], [1, 4]];
    const { r } = qrFactor(x, [0, 0, 0, 0]);
    const rtr = multiply(transpose(r), r)!;
    const xtx = multiply(transpose(x), x)!;
    expectClose(rtr, xtx, 9);
  });

  it("notices a dependent column", () => {
    // The second column is twice the first.
    const { rankDeficient } = qrFactor([[1, 2], [2, 4], [3, 6]], [1, 2, 3]);
    expect(rankDeficient).toBe(true);
  });
});

describe("least squares", () => {
  it("recovers an exact fit exactly", () => {
    // y = 3 + 2x, sampled without noise.
    const design = [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]];
    const fit = leastSquares(design, [5, 7, 9, 11, 13])!;
    expect(fit.coefficients[0]!).toBeCloseTo(3, 10);
    expect(fit.coefficients[1]!).toBeCloseTo(2, 10);
    expect(fit.ssResidual).toBeCloseTo(0, 18);
  });

  it("leaves residuals that sum to zero when there is an intercept", () => {
    const design = [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]];
    const fit = leastSquares(design, [2, 5, 4, 9, 8])!;
    const total = fit.residuals.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(0, 10);
  });

  it("leaves residuals orthogonal to every predictor", () => {
    const design = [[1, 1, 4], [1, 2, 1], [1, 3, 7], [1, 4, 2], [1, 5, 9]];
    const fit = leastSquares(design, [2, 5, 4, 9, 8])!;
    for (let j = 0; j < 3; j++) {
      let dot = 0;
      for (let i = 0; i < 5; i++) dot += design[i]![j]! * fit.residuals[i]!;
      expect(dot).toBeCloseTo(0, 9);
    }
  });

  it("agrees with the normal-equation solution on a well-conditioned problem", () => {
    const design = [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]];
    const y = [2, 5, 4, 9, 8];
    const fit = leastSquares(design, y)!;

    const xtx = multiply(transpose(design), design)!;
    const xty = multiply(transpose(design), y.map((v) => [v]))!;
    const normal = solve(xtx, xty)!;

    expect(fit.coefficients[0]!).toBeCloseTo(normal[0]![0]!, 9);
    expect(fit.coefficients[1]!).toBeCloseTo(normal[1]![0]!, 9);
  });

  it("gives a variance diagonal matching the inverse of X transpose X", () => {
    const design = [[1, 1, 4], [1, 2, 1], [1, 3, 7], [1, 4, 2], [1, 5, 9]];
    const fit = leastSquares(design, [2, 5, 4, 9, 8])!;
    const xtxInv = invert(multiply(transpose(design), design)!)!;
    for (let j = 0; j < 3; j++) {
      expect(fit.variance[j]!).toBeCloseTo(xtxInv[j]![j]!, 9);
    }
  });

  it("stays accurate where the normal equations would not", () => {
    // Years around 2000 make X^T X badly conditioned; the fit is still exact.
    const design = [1995, 1996, 1997, 1998, 1999, 2000].map((x) => [1, x]);
    const y = design.map((row) => 7 + 0.25 * row[1]!);
    const fit = leastSquares(design, y)!;
    expect(fit.coefficients[1]!).toBeCloseTo(0.25, 9);
    expect(fit.coefficients[0]!).toBeCloseTo(7, 5);
  });

  it("refuses a design with a dependent column", () => {
    expect(leastSquares([[1, 2], [1, 2], [1, 2]], [1, 2, 3])).toBeNull();
  });

  it("refuses a y of the wrong length", () => {
    expect(leastSquares([[1, 1], [1, 2]], [1, 2, 3])).toBeNull();
  });

  it("refuses an empty design", () => {
    expect(leastSquares([], [])).toBeNull();
  });
});
