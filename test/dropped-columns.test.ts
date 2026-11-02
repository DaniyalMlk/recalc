import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import { summarise } from "../src/analysis/regression.js";
import { regressCommand } from "../src/analysis/commands.js";
import { parseA1Range } from "../src/engine/reference.js";
import { leastSquares } from "../src/numeric/linalg.js";

/**
 * A sheet with `y` in A and the given columns from B onwards.
 *
 * The outcome is a straight line in the first column with a wobble on it, so
 * the fit is a real one rather than exact.
 */
function sheet(columns: readonly (readonly number[])[]): Workbook {
  const book = new Workbook();
  const rows = columns[0]!.length;
  for (let row = 0; row < rows; row++) {
    book.setCell(`A${row + 1}`, 3 + 2 * (row + 1) + 0.5 * ((row + 1) % 3));
    columns.forEach((column, index) => {
      book.setCell(`${String.fromCharCode(66 + index)}${row + 1}`, column[row]!);
    });
  }
  return book;
}

const ONE_TO_EIGHT = [1, 2, 3, 4, 5, 6, 7, 8];
const DOUBLED = ONE_TO_EIGHT.map((n) => 2 * n);
const SQUARED = ONE_TO_EIGHT.map((n) => n * n);

function fitOf(book: Workbook, columns: number, rows = 8) {
  const last = String.fromCharCode(66 + columns - 1);
  return summarise(
    book,
    parseA1Range(`A1:A${rows}`),
    parseA1Range(`B1:${last}${rows}`),
  );
}

describe("the basis a fit was taken over", () => {
  it("comes out of the solver rather than being inferred", () => {
    const design = ONE_TO_EIGHT.map((n) => [1, n, 2 * n]);
    const fit = leastSquares(design, ONE_TO_EIGHT.map((n) => 2 * n + 1));
    expect(fit).not.toBeNull();
    expect(fit!.basis).toEqual([0, 1]);
    expect(fit!.basis.length).toBe(fit!.rank);
    expect(fit!.coefficients[2]).toBe(0);
    // The dropped column has no standard error rather than one of zero.
    expect(Number.isNaN(fit!.variance[2]!)).toBe(true);
  });

  it("is every column when the design has full rank", () => {
    const design = ONE_TO_EIGHT.map((n) => [1, n, n * n]);
    const fit = leastSquares(design, ONE_TO_EIGHT.map((n) => n * n));
    expect(fit!.basis).toEqual([0, 1, 2]);
    expect(fit!.rank).toBe(3);
  });
});

describe("a summary with a dependent column in it", () => {
  const summary = fitOf(sheet([ONE_TO_EIGHT, DOUBLED, SQUARED]), 3);

  it("names the column rather than leaving a zero to be read", () => {
    expect(summary.dropped).toEqual(["C"]);
    expect(summary.rank).toBe(3);
    const byLabel = new Map(summary.terms.map((term) => [term.label, term]));
    expect(byLabel.get("C")!.counted).toBe(false);
    expect(byLabel.get("C")!.coefficient).toBe(0);
    for (const label of ["intercept", "B", "D"]) {
      expect(byLabel.get(label)!.counted).toBe(true);
    }
  });

  it("gives the dropped column no statistics at all", () => {
    // Not zero: zero reads as measured and exactly nothing, which is the
    // claim this is careful not to make.
    const dropped = summary.terms.find((term) => term.label === "C")!;
    expect(Number.isNaN(dropped.standardError)).toBe(true);
    expect(Number.isNaN(dropped.t)).toBe(true);
    expect(Number.isNaN(dropped.p)).toBe(true);
  });

  it("distinguishes a dropped column from one measured at exactly nothing", () => {
    // The confusion the whole feature is about. This predictor alternates
    // sign and is orthogonal to both the intercept and the other column, so
    // its coefficient comes out as a *bitwise* zero while the column itself
    // counted — the same number a dropped column carries, meaning the
    // opposite thing.
    const alternating = [1, -1, 1, -1, 1, -1, 1, -1];
    const symmetric = [1, 2, 3, 4, 4, 3, 2, 1];
    const book = new Workbook();
    symmetric.forEach((value, row) => {
      book.setCell(`A${row + 1}`, 2 + 2 * value);
      book.setCell(`B${row + 1}`, alternating[row]!);
      book.setCell(`C${row + 1}`, value);
    });
    const summary = summarise(
      book,
      parseA1Range("A1:A8"),
      parseA1Range("B1:C8"),
    );
    const measured = summary.terms.find((term) => term.label === "B")!;
    expect(measured.coefficient).toBe(0);
    expect(measured.counted).toBe(true);
    // The discriminator is that it *has* a standard error, where a dropped
    // column has none. The number happens to be zero as well, because this
    // fit is exact and so every standard error in it is — which is why `NaN`
    // against a number, and not a magnitude, is what the two differ by.
    expect(Number.isNaN(measured.standardError)).toBe(false);
    expect(measured.standardError).toBe(0);
    expect(summary.ssResidual).toBe(0);
    expect(summary.rank).toBe(3);
    expect(summary.dropped).toEqual([]);
    const out = regressCommand(book, "A1:A8 by B1:C8");
    expect(out).not.toContain("(dropped)");
    expect(out).not.toContain("fitted without");
  });

  it("keeps the statistics of a column that merely fits badly", () => {
    // The same shape with a residual in it, so the standard errors are real
    // numbers. The coefficient is now a float hair from zero rather than
    // zero — and the column still counted, still carries a standard error,
    // and is still not named as dropped.
    const alternating = [1, -1, 1, -1, 1, -1, 1, -1];
    const symmetric = [1, 2, 3, 4, 4, 3, 2, 1];
    const wobble = [1, 1, 0, 0, -1, -1, 0, 0];
    const book = new Workbook();
    symmetric.forEach((value, row) => {
      book.setCell(`A${row + 1}`, 2 + 2 * value + wobble[row]!);
      book.setCell(`B${row + 1}`, alternating[row]!);
      book.setCell(`C${row + 1}`, value);
    });
    const summary = summarise(book, parseA1Range("A1:A8"), parseA1Range("B1:C8"));
    const measured = summary.terms.find((term) => term.label === "B")!;
    expect(Math.abs(measured.coefficient)).toBeLessThan(1e-14);
    expect(measured.coefficient).not.toBe(0);
    expect(measured.counted).toBe(true);
    expect(measured.standardError).toBeGreaterThan(0);
    expect(summary.ssResidual).toBeCloseTo(2.4, 12);
    expect(summary.dropped).toEqual([]);
  });

  it("leaves a full-rank fit with nothing to report", () => {
    const full = fitOf(sheet([ONE_TO_EIGHT, SQUARED]), 2);
    expect(full.dropped).toEqual([]);
    expect(full.terms.every((term) => term.counted)).toBe(true);
    expect(full.rank).toBe(3);
  });
});

describe("which column goes", () => {
  it("follows the order the columns were given in, not the data", () => {
    // The same two columns, `x` and `2x`, in both orders. The second one is
    // dropped either way, because columns are visited left to right.
    const first = fitOf(sheet([ONE_TO_EIGHT, DOUBLED]), 2);
    const second = fitOf(sheet([DOUBLED, ONE_TO_EIGHT]), 2);
    expect(first.dropped).toEqual(["C"]);
    expect(second.dropped).toEqual(["C"]);
    // And the column kept is a different column in each, which is the point:
    // 2.017857 on `x` is the same line as 1.008929 on `2x`.
    const keptFirst = first.terms[1]!.coefficient;
    const keptSecond = second.terms[1]!.coefficient;
    expect(keptFirst).toBeCloseTo(2 * keptSecond, 12);
  });

  it("changes nothing about the fit itself", () => {
    const first = fitOf(sheet([ONE_TO_EIGHT, DOUBLED]), 2);
    const second = fitOf(sheet([DOUBLED, ONE_TO_EIGHT]), 2);
    // The fitted values are the projection of `y` onto the column space, and
    // the space is the same however it is spanned -- so these agree exactly
    // rather than closely.
    expect(second.ssResidual).toBe(first.ssResidual);
    expect(second.rSquared).toBe(first.rSquared);
    expect(second.df).toBe(first.df);
    expect(second.rank).toBe(first.rank);
    expect(second.terms[0]!.coefficient).toBe(first.terms[0]!.coefficient);
  });

  it("is never the intercept, which is visited first", () => {
    // A constant predictor is dependent with the intercept, so one of the two
    // has to go -- and it is the predictor, every time, because the intercept
    // is column zero. Four shapes of dependence, none of which drops it.
    const constant = ONE_TO_EIGHT.map(() => 5);
    for (const columns of [
      [constant, ONE_TO_EIGHT],
      [ONE_TO_EIGHT, constant],
      [constant, DOUBLED, ONE_TO_EIGHT],
      [ONE_TO_EIGHT, DOUBLED, constant],
    ]) {
      const summary = fitOf(sheet(columns), columns.length);
      expect(summary.terms[0]!.label).toBe("intercept");
      expect(summary.terms[0]!.counted).toBe(true);
      expect(summary.dropped).not.toContain("intercept");
      expect(summary.dropped.length).toBeGreaterThan(0);
    }
  });

  it("names something whenever the rank is short of the columns", () => {
    // The two have to agree, or the line would be printed with nothing on it.
    for (const columns of [
      [ONE_TO_EIGHT, DOUBLED],
      [ONE_TO_EIGHT, DOUBLED, SQUARED],
      [ONE_TO_EIGHT, SQUARED, DOUBLED],
      [ONE_TO_EIGHT, ONE_TO_EIGHT, ONE_TO_EIGHT],
    ]) {
      const summary = fitOf(sheet(columns), columns.length);
      const short = summary.rank < summary.predictors + 1;
      expect(short).toBe(summary.dropped.length > 0);
      expect(summary.predictors + 1 - summary.rank).toBe(summary.dropped.length);
    }
  });
});

describe("the .regress output", () => {
  const book = sheet([ONE_TO_EIGHT, DOUBLED, SQUARED]);

  it("marks the row and names the column under the statistics", () => {
    const out = regressCommand(book, "A1:A8 by B1:D8");
    expect(out).toContain("C (dropped)");
    expect(out).toContain("fitted without");
    expect(out).toMatch(/fitted without\s+C/);
    expect(out).toContain("columns that counted");
  });

  it("puts dashes where a dropped column has no statistic", () => {
    const out = regressCommand(book, "A1:A8 by B1:D8");
    const row = out.split("\n").find((line) => line.includes("C (dropped)"))!;
    // The coefficient is a real zero and is printed; the other three are not
    // numbers and are not printed as any.
    expect(row).toContain("0");
    expect(row.match(/—/g)?.length).toBe(3);
    expect(row).not.toContain("n/a");
  });

  it("says none of it when every column counted", () => {
    const full = sheet([ONE_TO_EIGHT, SQUARED]);
    const out = regressCommand(full, "A1:A8 by B1:C8");
    expect(out).not.toContain("(dropped)");
    expect(out).not.toContain("fitted without");
    expect(out).not.toContain("columns that counted");
    expect(out).not.toContain("—");
  });

  it("names more than one when more than one went", () => {
    const many = sheet([
      ONE_TO_EIGHT,
      DOUBLED,
      ONE_TO_EIGHT.map((n) => 3 * n),
      SQUARED,
    ]);
    const summary = fitOf(many, 4);
    expect(summary.dropped).toEqual(["C", "D"]);
    expect(regressCommand(many, "A1:A8 by B1:E8")).toMatch(/fitted without\s+C, D/);
  });
});
