import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import { leastSquares, qrFactor } from "../src/numeric/linalg.js";
import type { Value } from "../src/engine/value.js";

/** Eight observations, so there is room to lose a column and still have df. */
const X: readonly (readonly number[])[] = [
  [1, 1],
  [1, 2],
  [1, 3],
  [1, 5],
  [1, 4],
  [1, 7],
  [1, 6],
  [1, 9],
];
const Y: readonly number[] = [2.1, 3.9, 6.2, 9.8, 8.1, 13.9, 12.2, 17.8];
/** A fourth column that is genuinely independent, so the rank is 3 of 4. */
const EXTRA: readonly number[] = [3, 1, 4, 1, 5, 9, 2, 6];

/** `[1, x, 2x, extra]` — column 3 is twice column 2 and nothing else is. */
const DEPENDENT: readonly (readonly number[])[] = X.map((row, index) => [
  row[0] as number,
  row[1] as number,
  2 * (row[1] as number),
  EXTRA[index] as number,
]);
/** The same design with the dependent column simply left out. */
const REDUCED: readonly (readonly number[])[] = X.map((row, index) => [
  row[0] as number,
  row[1] as number,
  EXTRA[index] as number,
]);

describe("the basis the factorisation reports", () => {
  it("keeps the earlier column of a dependent pair", () => {
    expect(qrFactor(DEPENDENT, Y).kept).toEqual([0, 1, 3]);
    // And the other way round, so the rule is the order and not the values.
    const swapped = X.map((row, index) => [
      row[0] as number,
      2 * (row[1] as number),
      row[1] as number,
      EXTRA[index] as number,
    ]);
    expect(qrFactor(swapped, Y).kept).toEqual([0, 1, 3]);
  });

  it("calls a scalar multiple dependent whatever the scale", () => {
    // Not a statement about small numbers: a column a million times the size
    // of its partner is just as dependent on it.
    for (const scale of [2, 2.001, 1e6, 1e-6]) {
      const design = X.map((row) => [
        row[0] as number,
        row[1] as number,
        (row[1] as number) * scale,
      ]);
      expect(qrFactor(design, Y).kept, `scale ${scale}`).toEqual([0, 1]);
    }
  });

  it("drops a column of zeros, and keeps one constant column", () => {
    const zeros = X.map((row) => [row[0] as number, row[1] as number, 0]);
    expect(qrFactor(zeros, Y).kept).toEqual([0, 1]);
    // The leading column of ones is the intercept and is kept; a second
    // constant column repeats it and is not.
    const twice = X.map((row) => [row[0] as number, row[1] as number, 1]);
    expect(qrFactor(twice, Y).kept).toEqual([0, 1]);
  });

  it("drops both repeats of a column repeated three times", () => {
    const thrice = X.map((row) => [
      row[0] as number,
      row[1] as number,
      row[1] as number,
      row[1] as number,
    ]);
    expect(qrFactor(thrice, Y).kept).toEqual([0, 1]);
  });

  it("builds the triangle over the basis rather than over the columns", () => {
    // Which is what lets the factorisation be used. A square R with a zero
    // pivot could be inspected and not solved.
    const { r, kept, rankDeficient } = qrFactor(DEPENDENT, Y);
    expect(rankDeficient).toBe(true);
    expect(kept.length).toBe(3);
    expect(r.length).toBe(3);
    for (const [index, line] of r.entries()) {
      expect(line.length).toBe(3);
      expect(Math.abs(line[index] as number)).toBeGreaterThan(1e-8);
    }
  });
});

describe("what dropping a column does and does not change", () => {
  const wide = leastSquares(DEPENDENT, Y);
  const narrow = leastSquares(REDUCED, Y);

  it("fits at all, rather than refusing", () => {
    expect(wide).not.toBeNull();
    expect((wide as NonNullable<typeof wide>).rank).toBe(3);
  });

  it("leaves the fitted values exactly where they were", () => {
    // The identity that says dropping was the right thing to do: the fitted
    // values are the projection of y onto the column space, and a projection
    // does not depend on how the space is spanned. So this is zero, not
    // nearly — and if it were not zero, the dropped column had been doing
    // something and should not have gone.
    const a = wide as NonNullable<typeof wide>;
    const b = narrow as NonNullable<typeof narrow>;
    expect(a.ssResidual).toBe(b.ssResidual);
    for (const [index, residual] of b.residuals.entries()) {
      expect(a.residuals[index]).toBe(residual);
    }
    // The surviving coefficients are the same numbers, in their own slots.
    expect(a.coefficients[0]).toBe(b.coefficients[0]);
    expect(a.coefficients[1]).toBe(b.coefficients[1]);
    expect(a.coefficients[3]).toBe(b.coefficients[2]);
  });

  it("reports the dropped column as a zero with no standard error", () => {
    const a = wide as NonNullable<typeof wide>;
    expect(a.coefficients[2]).toBe(0);
    expect(Number.isNaN(a.variance[2] as number)).toBe(true);
    for (const index of [0, 1, 3]) {
      expect(Number.isNaN(a.variance[index] as number), `column ${index}`).toBe(
        false,
      );
    }
  });
});

describe("the degrees of freedom have to come from the rank", () => {
  // The half of this that a test of the coefficients alone would miss. Every
  // standard error, every t, the F and its significance divide by the
  // residual degrees of freedom, so getting that number from the columns
  // handed in rather than from the rank leaves all of them wrong at once —
  // and wrong by a factor, not by a rounding.

  const fit = leastSquares(DEPENDENT, Y) as NonNullable<
    ReturnType<typeof leastSquares>
  >;
  const observations = Y.length;
  const columns = (DEPENDENT[0] as readonly number[]).length;

  it("counts the rank, not the columns", () => {
    expect(fit.rank).toBe(3);
    expect(columns).toBe(4);
    expect(observations - fit.rank).toBe(5);
    expect(observations - columns).toBe(4);
  });

  it("inflates every reported error by a measured factor when it does not", () => {
    const fromRank = Math.sqrt(fit.ssResidual / (observations - fit.rank));
    const fromColumns = Math.sqrt(fit.ssResidual / (observations - columns));
    // The ratio is the square root of the ratio of the two counts, exactly,
    // and it multiplies the standard error of the estimate and every
    // coefficient's standard error alike — 11.8% on this design.
    expect(fromColumns / fromRank).toBeCloseTo(Math.sqrt(5 / 4), 12);
    expect(fromColumns / fromRank).toBeCloseTo(1.118034, 6);
    for (const index of [0, 1, 3]) {
      const variance = fit.variance[index] as number;
      const a = fromRank * Math.sqrt(variance);
      const b = fromColumns * Math.sqrt(variance);
      expect(b / a, `column ${index}`).toBeCloseTo(1.118034, 6);
      expect(b).toBeGreaterThan(a);
    }
  });

  it("is what the regression layer actually uses", () => {
    const book = new Workbook();
    const cells: Record<string, number> = {};
    for (const [index, row] of DEPENDENT.entries()) {
      cells[`A${index + 1}`] = Y[index] as number;
      cells[`B${index + 1}`] = row[1] as number;
      cells[`C${index + 1}`] = row[2] as number;
      cells[`D${index + 1}`] = row[3] as number;
    }
    book.setCells(cells);
    book.setCell("H1", "=LINEST(A1:A8,B1:D8,TRUE,TRUE)");
    // Row 4 of the statistics block is the F and the residual degrees of
    // freedom, and the df cell is where the rank shows through.
    expect(book.getValue("I4")).toBe(5);
  });
});

describe("the tolerance that decides dependence", () => {
  /** The rank of `[1, scale·x, 2·scale·x + a nudge in one row]`. */
  const rankWith = (scale: number, nudge: number): number =>
    qrFactor(
      X.map((row, index) => [
        row[0] as number,
        (row[1] as number) * scale,
        (row[1] as number) * scale * 2 + (index === 3 ? nudge : 0),
      ]),
      Y,
    ).kept.length;

  /** Where the rank changes from 2 to 3, found by bisecting on the log. */
  const crossover = (scale: number): number => {
    let low = 1e-20;
    let high = 1;
    for (let step = 0; step < 200; step += 1) {
      const middle = Math.sqrt(low * high);
      if (rankWith(scale, middle) === 3) high = middle;
      else low = middle;
    }
    return Math.sqrt(low * high);
  };

  it("drops a column that differs from a multiple by less than it, and keeps one that differs by more", () => {
    expect(rankWith(1, 0)).toBe(2);
    expect(rankWith(1, 1e-14)).toBe(2);
    expect(rankWith(1, 1e-12)).toBe(3);
  });

  it("moves with the size of the matrix, by the same factor", () => {
    // What the threshold is for: it has to mean the same thing in a matrix of
    // units and a matrix of millions, or a design in dollars and the same
    // design in cents would disagree about which of its columns exist.
    const units = crossover(1);
    const millions = crossover(1e6);
    expect(units).toBeGreaterThan(1e-14);
    expect(units).toBeLessThan(1e-11);
    // Six orders of magnitude of scaling move the threshold by six orders of
    // magnitude, to better than a tenth of a per cent.
    expect(millions / units).toBeCloseTo(1e6, -4);
    // The residue is not zero and is not noise either: the threshold is a
    // product of the largest entry and a count, and scaling one column does
    // not scale the largest entry by exactly the same amount, which leaves
    // about a tenth of a per cent.
    const residue = Math.abs(millions / units / 1e6 - 1);
    expect(residue).toBeGreaterThan(1e-4);
    expect(residue).toBeLessThan(2e-3);
  });

  it("is not so loose that it eats a real predictor", () => {
    // The other half. A design whose third column is a plausible, noisy
    // variable keeps all of them.
    const design = X.map((row, index) => [
      row[0] as number,
      row[1] as number,
      EXTRA[index] as number,
    ]);
    expect(qrFactor(design, Y).kept).toEqual([0, 1, 2]);
  });
});

describe("LINEST over a dependent predictor", () => {
  function sheet() {
    const book = new Workbook();
    const cells: Record<string, number> = {};
    for (const [index, row] of X.entries()) {
      cells[`A${index + 1}`] = Y[index] as number;
      cells[`B${index + 1}`] = row[1] as number;
      cells[`C${index + 1}`] = 2 * (row[1] as number);
    }
    book.setCells(cells);
    return {
      block(formula: string, rows: number, cols: number): Value[][] {
        book.setCell("H1", formula);
        const out: Value[][] = [];
        for (let row = 0; row < rows; row += 1) {
          const line: Value[] = [];
          for (let col = 0; col < cols; col += 1) {
            line.push(book.getValue(`${String.fromCharCode(72 + col)}${row + 1}`) ?? null);
          }
          out.push(line);
        }
        return out;
      },
      display(formula: string): string {
        book.setCell("P40", formula);
        return book.getDisplay("P40");
      },
    };
  }

  const plain = sheet();

  it("answers rather than refusing", () => {
    expect(plain.display("=LINEST(A1:A8,B1:C8)")).not.toBe("#NUM!");
  });

  it("puts the zero on the column it dropped, reported last slope first", () => {
    const [coefficients] = plain.block("=LINEST(A1:A8,B1:C8)", 1, 3);
    // C is twice B, so C goes; the reported order is C, B, intercept.
    expect(coefficients?.[0]).toBe(0);
    expect(typeof coefficients?.[1]).toBe("number");
    expect(coefficients?.[1]).not.toBe(0);
  });

  it("gives the dropped column no standard error", () => {
    // #N/A rather than a zero, which would read as measured and exactly
    // nothing — the same choice the no-intercept case already made.
    expect(plain.display("=INDEX(LINEST(A1:A8,B1:C8,TRUE,TRUE),2,1)")).toBe("#N/A");
    const stats = plain.block("=LINEST(A1:A8,B1:C8,TRUE,TRUE)", 5, 3);
    expect(stats[1]?.[0]).toMatchObject({ code: "#N/A" });
    expect(typeof stats[1]?.[1]).toBe("number");
  });

  it("agrees with the fit that never had the column, on everything measurable", () => {
    const wide = plain.block("=LINEST(A1:A8,B1:C8,TRUE,TRUE)", 5, 3);
    const narrow = plain.block("=LINEST(A1:A8,B1:B8,TRUE,TRUE)", 5, 2);
    // Row 3 is R-squared and the standard error of the estimate, row 4 the F
    // and the residual degrees of freedom, row 5 the two sums of squares.
    // Both blocks have five rows; only their width differs.
    for (const [row, col] of [
      [2, 0],
      [2, 1],
      [3, 0],
      [3, 1],
      [4, 0],
      [4, 1],
    ] as const) {
      expect(wide[row]?.[col], `row ${row + 1} col ${col + 1}`).toBe(
        narrow[row]?.[col],
      );
    }
    // The F in particular: it divides by the slopes actually fitted rather
    // than by the columns handed in, which is the figure a numerator df taken
    // from the column count would spoil.
    expect(typeof wide[3]?.[0]).toBe("number");
  });

  it("still refuses more columns than observations", () => {
    // The refusal that remains, and should: too few rows is not something a
    // basis can rescue.
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, B1: 1, B2: 2, C1: 3, C2: 4 });
    book.setCell("E1", "=LINEST(A1:A2,B1:C2)");
    expect(book.getDisplay("E1")).toBe("#DIV/0!");
  });
});
