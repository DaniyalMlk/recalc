import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import type { Value } from "../src/engine/value.js";

/**
 * The regression pack, checked from the sheet rather than from the library.
 *
 * Every one of these functions is reached through a formula, because that is
 * how they are used and because it exercises the array plumbing at the same
 * time: a `LINEST` that computes the right numbers and cannot spill them is
 * not a working `LINEST`.
 */

function sheet(cells: Record<string, string | number>): Workbook {
  const book = new Workbook();
  book.setCells(cells);
  return book;
}

/** Enter a formula and read back the block it spilled, as nested rows. */
function spill(
  book: Workbook,
  anchor: string,
  formula: string,
  rows: number,
  cols: number,
): Value[][] {
  book.setCell(anchor, formula);
  const start = parseAddress(anchor);
  const out: Value[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Value[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(book.getValue({ col: start.col + c, row: start.row + r }));
    }
    out.push(row);
  }
  return out;
}

function parseAddress(address: string): { col: number; row: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(address)!;
  let col = 0;
  for (const ch of match[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(match[2]) - 1 };
}

const value = (book: Workbook, address: string, formula: string): Value => {
  book.setCell(address, formula);
  return book.getValue(address);
};

// ---------------------------------------------------------------------------
// The published multiple-regression worked example
// ---------------------------------------------------------------------------

/**
 * Office building valuation: assessed value against floor space, number of
 * offices, number of entrances and age. Eleven buildings, four predictors.
 *
 * This is the worked example the `LINEST` documentation is built around, and
 * every figure it quotes is checked below.
 */
const OFFICES: Array<[number, number, number, number, number]> = [
  [2310, 2, 2, 20, 142000],
  [2333, 2, 2, 12, 144000],
  [2356, 3, 1.5, 33, 151000],
  [2379, 3, 2, 43, 150000],
  [2402, 2, 3, 53, 139000],
  [2425, 4, 2, 23, 169000],
  [2448, 2, 1.5, 99, 126000],
  [2471, 2, 2, 34, 142900],
  [2494, 3, 3, 23, 163000],
  [2517, 4, 4, 55, 169000],
  [2540, 2, 3, 22, 149000],
];

function officeSheet(): Workbook {
  const cells: Record<string, string | number> = {};
  OFFICES.forEach((row, i) => {
    const r = i + 1;
    cells[`A${r}`] = row[0];
    cells[`B${r}`] = row[1];
    cells[`C${r}`] = row[2];
    cells[`D${r}`] = row[3];
    cells[`E${r}`] = row[4];
  });
  return sheet(cells);
}

describe("the published multiple-regression example", () => {
  it("reproduces the five coefficients", () => {
    const book = officeSheet();
    const [row] = spill(book, "G1", "=LINEST(E1:E11,A1:D11)", 1, 5);
    // Reported last predictor first, intercept last: age, entrances, offices,
    // floor space, then b.
    expect(row![0] as number).toBeCloseTo(-234.2371645, 6);
    expect(row![1] as number).toBeCloseTo(2553.21066, 4);
    expect(row![2] as number).toBeCloseTo(12529.76817, 4);
    expect(row![3] as number).toBeCloseTo(27.64138737, 6);
    expect(row![4] as number).toBeCloseTo(52317.83051, 3);
  });

  it("reproduces the five standard errors", () => {
    const book = officeSheet();
    const rows = spill(book, "G1", "=LINEST(E1:E11,A1:D11,TRUE,TRUE)", 5, 5);
    const se = rows[1]!;
    expect(se[0] as number).toBeCloseTo(13.26801148, 6);
    expect(se[1] as number).toBeCloseTo(530.6691519, 5);
    expect(se[2] as number).toBeCloseTo(400.0668382, 5);
    expect(se[3] as number).toBeCloseTo(5.429374042, 6);
    expect(se[4] as number).toBeCloseTo(12237.3616, 3);
  });

  it("reproduces R squared and the standard error of the estimate", () => {
    const book = officeSheet();
    const rows = spill(book, "G1", "=LINEST(E1:E11,A1:D11,TRUE,TRUE)", 5, 5);
    expect(rows[2]![0] as number).toBeCloseTo(0.996747993, 8);
    expect(rows[2]![1] as number).toBeCloseTo(970.5784629, 5);
  });

  it("reproduces the F statistic and the degrees of freedom", () => {
    const book = officeSheet();
    const rows = spill(book, "G1", "=LINEST(E1:E11,A1:D11,TRUE,TRUE)", 5, 5);
    expect(rows[3]![0] as number).toBeCloseTo(459.7536742, 4);
    expect(rows[3]![1]).toBe(6);
  });

  it("reproduces both sums of squares", () => {
    const book = officeSheet();
    const rows = spill(book, "G1", "=LINEST(E1:E11,A1:D11,TRUE,TRUE)", 5, 5);
    expect(rows[4]![0] as number).toBeCloseTo(1732393319, 0);
    expect(rows[4]![1] as number).toBeCloseTo(5652135.316, 2);
  });

  it("fills the unused columns of the statistics rows with #N/A", () => {
    const book = officeSheet();
    const rows = spill(book, "G1", "=LINEST(E1:E11,A1:D11,TRUE,TRUE)", 5, 5);
    for (const r of [2, 3, 4]) {
      for (const c of [2, 3, 4]) {
        expect(rows[r]![c]).toMatchObject({ code: "#N/A" });
      }
    }
  });

  it("has sums of squares that add to the total", () => {
    const book = officeSheet();
    const rows = spill(book, "G1", "=LINEST(E1:E11,A1:D11,TRUE,TRUE)", 5, 5);
    const ssreg = rows[4]![0] as number;
    const ssresid = rows[4]![1] as number;

    let mean = 0;
    for (const row of OFFICES) mean += row[4];
    mean /= OFFICES.length;
    let sstot = 0;
    for (const row of OFFICES) sstot += (row[4] - mean) ** 2;

    expect(ssreg + ssresid).toBeCloseTo(sstot, 3);
  });

  it("has an F that is the ratio the degrees of freedom imply", () => {
    const book = officeSheet();
    const rows = spill(book, "G1", "=LINEST(E1:E11,A1:D11,TRUE,TRUE)", 5, 5);
    const ssreg = rows[4]![0] as number;
    const ssresid = rows[4]![1] as number;
    const df = rows[3]![1] as number;
    expect(rows[3]![0] as number).toBeCloseTo((ssreg / 4) / (ssresid / df), 6);
  });

  it("has a standard error of the estimate matching the residual variance", () => {
    const book = officeSheet();
    const rows = spill(book, "G1", "=LINEST(E1:E11,A1:D11,TRUE,TRUE)", 5, 5);
    const ssresid = rows[4]![1] as number;
    const df = rows[3]![1] as number;
    expect(rows[2]![1] as number).toBeCloseTo(Math.sqrt(ssresid / df), 8);
  });

  it("predicts the sheet's own values back through TREND", () => {
    const book = officeSheet();
    const fitted = spill(book, "G1", "=TREND(E1:E11,A1:D11)", 11, 1);
    let ssresid = 0;
    OFFICES.forEach((row, i) => {
      ssresid += (row[4] - (fitted[i]![0] as number)) ** 2;
    });
    expect(ssresid).toBeCloseTo(5652135.316, 2);
  });

  it("predicts a new building", () => {
    const book = officeSheet();
    book.setCells({ H1: 2500, I1: 3, J1: 2, K1: 25 });
    const predicted = spill(book, "M1", "=TREND(E1:E11,A1:D11,H1:K1)", 1, 1);
    // 52317.83051 + 27.64138737*2500 + 12529.76817*3 + 2553.21066*2 - 234.2371645*25
    const expected =
      52317.83051 +
      27.64138737 * 2500 +
      12529.76817 * 3 +
      2553.21066 * 2 -
      234.2371645 * 25;
    expect(predicted[0]![0] as number).toBeCloseTo(expected, 2);
  });
});

// ---------------------------------------------------------------------------
// Simple regression, and the identities that tie the pack together
// ---------------------------------------------------------------------------

const SIMPLE = {
  A1: 2,
  A2: 3,
  A3: 9,
  A4: 1,
  A5: 8,
  B1: 6,
  B2: 5,
  B3: 11,
  B4: 7,
  B5: 5,
};

describe("simple regression", () => {
  it("matches the closed form for the slope", () => {
    const book = sheet(SIMPLE);
    // Sxy / Sxx computed by hand: 16.6 / 24.8.
    expect(value(book, "D1", "=SLOPE(A1:A5,B1:B5)") as number).toBeCloseTo(
      16.6 / 24.8,
      12,
    );
  });

  it("matches the closed form for the intercept", () => {
    const book = sheet(SIMPLE);
    const expected = 4.6 - (16.6 / 24.8) * 6.8;
    expect(value(book, "D1", "=INTERCEPT(A1:A5,B1:B5)") as number).toBeCloseTo(
      expected,
      12,
    );
  });

  it("agrees with LINEST on one predictor", () => {
    const book = sheet(SIMPLE);
    const [row] = spill(book, "D1", "=LINEST(A1:A5,B1:B5)", 1, 2);
    const slope = value(book, "G1", "=SLOPE(A1:A5,B1:B5)") as number;
    const intercept = value(book, "G2", "=INTERCEPT(A1:A5,B1:B5)") as number;
    expect(row![0] as number).toBeCloseTo(slope, 12);
    expect(row![1] as number).toBeCloseTo(intercept, 12);
  });

  it("has an RSQ equal to CORREL squared", () => {
    const book = sheet(SIMPLE);
    const r = value(book, "D1", "=CORREL(A1:A5,B1:B5)") as number;
    const rsq = value(book, "D2", "=RSQ(A1:A5,B1:B5)") as number;
    expect(rsq).toBeCloseTo(r * r, 12);
  });

  it("has an RSQ matching the one LINEST reports", () => {
    const book = sheet(SIMPLE);
    const rows = spill(book, "D1", "=LINEST(A1:A5,B1:B5,TRUE,TRUE)", 5, 2);
    const rsq = value(book, "H1", "=RSQ(A1:A5,B1:B5)") as number;
    expect(rows[2]![0] as number).toBeCloseTo(rsq, 12);
  });

  it("has a STEYX matching the one LINEST reports", () => {
    const book = sheet(SIMPLE);
    const rows = spill(book, "D1", "=LINEST(A1:A5,B1:B5,TRUE,TRUE)", 5, 2);
    const steyx = value(book, "H1", "=STEYX(A1:A5,B1:B5)") as number;
    expect(rows[2]![1] as number).toBeCloseTo(steyx, 12);
  });

  it("treats PEARSON and CORREL as the same statistic", () => {
    const book = sheet(SIMPLE);
    expect(value(book, "D1", "=PEARSON(A1:A5,B1:B5)")).toEqual(
      value(book, "D2", "=CORREL(A1:A5,B1:B5)"),
    );
  });

  it("forecasts a point on the fitted line", () => {
    const book = sheet(SIMPLE);
    const slope = 16.6 / 24.8;
    const intercept = 4.6 - slope * 6.8;
    expect(
      value(book, "D1", "=FORECAST(10,A1:A5,B1:B5)") as number,
    ).toBeCloseTo(intercept + slope * 10, 10);
    expect(
      value(book, "D2", "=FORECAST.LINEAR(10,A1:A5,B1:B5)") as number,
    ).toBeCloseTo(intercept + slope * 10, 10);
  });

  it("is a perfect fit on collinear points", () => {
    const book = sheet({
      A1: 3,
      A2: 5,
      A3: 7,
      A4: 9,
      B1: 1,
      B2: 2,
      B3: 3,
      B4: 4,
    });
    expect(value(book, "D1", "=SLOPE(A1:A4,B1:B4)") as number).toBeCloseTo(2, 12);
    expect(value(book, "D2", "=INTERCEPT(A1:A4,B1:B4)") as number).toBeCloseTo(1, 10);
    expect(value(book, "D3", "=RSQ(A1:A4,B1:B4)") as number).toBeCloseTo(1, 12);
    expect(value(book, "D4", "=STEYX(A1:A4,B1:B4)") as number).toBeCloseTo(0, 10);
  });

  it("works with the observations laid out across rather than down", () => {
    const book = sheet({
      A1: 2, B1: 3, C1: 9, D1: 1, E1: 8,
      A2: 6, B2: 5, C2: 11, D2: 7, E2: 5,
    });
    expect(value(book, "A4", "=SLOPE(A1:E1,A2:E2)") as number).toBeCloseTo(
      16.6 / 24.8,
      12,
    );
    const [row] = spill(book, "A6", "=LINEST(A1:E1,A2:E2)", 1, 2);
    expect(row![0] as number).toBeCloseTo(16.6 / 24.8, 12);
  });
});

describe("covariance and correlation", () => {
  it("relates the two covariances by the sample size", () => {
    const book = sheet(SIMPLE);
    const p = value(book, "D1", "=COVARIANCE.P(A1:A5,B1:B5)") as number;
    const s = value(book, "D2", "=COVARIANCE.S(A1:A5,B1:B5)") as number;
    expect(p * 5).toBeCloseTo(s * 4, 12);
  });

  it("matches the closed forms", () => {
    const book = sheet(SIMPLE);
    expect(value(book, "D1", "=COVARIANCE.P(A1:A5,B1:B5)") as number).toBeCloseTo(
      16.6 / 5,
      12,
    );
    expect(value(book, "D2", "=COVARIANCE.S(A1:A5,B1:B5)") as number).toBeCloseTo(
      16.6 / 4,
      12,
    );
  });

  it("is 1 for a series correlated with itself", () => {
    const book = sheet(SIMPLE);
    expect(value(book, "D1", "=CORREL(A1:A5,A1:A5)") as number).toBeCloseTo(1, 12);
  });

  it("is -1 for a series correlated with its negation", () => {
    const book = sheet({ A1: 1, A2: 2, A3: 5, B1: -1, B2: -2, B3: -5 });
    expect(value(book, "D1", "=CORREL(A1:A3,B1:B3)") as number).toBeCloseTo(-1, 12);
  });

  it("is #DIV/0! against a constant series", () => {
    const book = sheet({ A1: 1, A2: 2, A3: 3, B1: 5, B2: 5, B3: 5 });
    expect(book.getDisplay(
      (book.setCell("D1", "=CORREL(A1:A3,B1:B3)"), "D1"),
    )).toBe("#DIV/0!");
  });

  it("is #N/A when the ranges are different lengths", () => {
    const book = sheet({ A1: 1, A2: 2, A3: 3, B1: 5, B2: 6 });
    book.setCell("D1", "=CORREL(A1:A3,B1:B2)");
    expect(book.getDisplay("D1")).toBe("#N/A");
  });
});

describe("the intercept forced through zero", () => {
  it("fits a line through the origin", () => {
    const book = sheet({ A1: 2, A2: 4, A3: 6, B1: 1, B2: 2, B3: 3 });
    const [row] = spill(book, "D1", "=LINEST(A1:A3,B1:B3,FALSE)", 1, 2);
    expect(row![0] as number).toBeCloseTo(2, 10);
    expect(row![1]).toBe(0);
  });

  it("gives a different slope from the fit with an intercept", () => {
    const book = sheet({ A1: 3, A2: 4, A3: 6, B1: 1, B2: 2, B3: 3 });
    const free = spill(book, "D1", "=LINEST(A1:A3,B1:B3)", 1, 2);
    const forced = spill(book, "G1", "=LINEST(A1:A3,B1:B3,FALSE)", 1, 2);
    expect(free[0]![0]).not.toBe(forced[0]![0]);
  });

  it("keeps one more degree of freedom", () => {
    const book = sheet({ A1: 3, A2: 4, A3: 6, A4: 9, B1: 1, B2: 2, B3: 3, B4: 4 });
    const free = spill(book, "D1", "=LINEST(A1:A4,B1:B4,TRUE,TRUE)", 5, 2);
    const forced = spill(book, "G1", "=LINEST(A1:A4,B1:B4,FALSE,TRUE)", 5, 2);
    expect(forced[3]![1] as number).toBe((free[3]![1] as number) + 1);
  });
});

describe("what the regression refuses", () => {
  it("refuses text among the observations", () => {
    const book = sheet({ A1: 1, A2: "two", A3: 3, B1: 1, B2: 2, B3: 3 });
    book.setCell("D1", "=SLOPE(A1:A3,B1:B3)");
    expect(book.getDisplay("D1")).toBe("#VALUE!");
  });

  it("refuses mismatched lengths", () => {
    const book = sheet({ A1: 1, A2: 2, A3: 3, B1: 1, B2: 2 });
    book.setCell("D1", "=LINEST(A1:A3,B1:B2)");
    expect(book.getDisplay("D1")).toBe("#REF!");
  });

  it("refuses a known_y that is a block rather than a line", () => {
    const book = sheet({ A1: 1, A2: 2, B1: 3, B2: 4 });
    book.setCell("D1", "=LINEST(A1:B2)");
    expect(book.getDisplay("D1")).toBe("#REF!");
  });

  it("refuses more predictors than observations", () => {
    const book = sheet({ A1: 1, A2: 2, B1: 1, B2: 2, C1: 3, C2: 4 });
    book.setCell("E1", "=LINEST(A1:A2,B1:C2)");
    expect(book.getDisplay("E1")).toBe("#DIV/0!");
  });

  it("refuses linearly dependent predictors", () => {
    const book = sheet({
      A1: 1, A2: 4, A3: 2, A4: 7,
      B1: 1, B2: 2, B3: 3, B4: 4,
      C1: 2, C2: 4, C3: 6, C4: 8,
    });
    book.setCell("E1", "=LINEST(A1:A4,B1:C4)");
    expect(book.getDisplay("E1")).toBe("#NUM!");
  });

  it("refuses a SLOPE over several predictors", () => {
    const book = sheet({
      A1: 1, A2: 4, A3: 2, A4: 7,
      B1: 1, B2: 2, B3: 3, B4: 5,
      C1: 2, C2: 5, C3: 6, C4: 1,
    });
    book.setCell("E1", "=SLOPE(A1:A4,B1:C4)");
    expect(book.getDisplay("E1")).toBe("#N/A");
  });
});

describe("regression against position", () => {
  it("fits against 1, 2, 3 when no predictor is given", () => {
    const book = sheet({ A1: 10, A2: 20, A3: 30, A4: 40 });
    const [row] = spill(book, "C1", "=LINEST(A1:A4)", 1, 2);
    expect(row![0] as number).toBeCloseTo(10, 10);
    expect(row![1] as number).toBeCloseTo(0, 8);
  });

  it("extends a series through TREND", () => {
    // The predictor is written out rather than left implicit: an omitted
    // middle argument is a parse error in this engine, not an empty slot.
    const book = sheet({
      A1: 10, A2: 20, A3: 30, A4: 40,
      B1: 1, B2: 2, B3: 3, B4: 4,
      C1: 5, C2: 6,
    });
    const out = spill(book, "E1", "=TREND(A1:A4,B1:B4,C1:C2)", 2, 1);
    expect(out[0]![0] as number).toBeCloseTo(50, 8);
    expect(out[1]![0] as number).toBeCloseTo(60, 8);
  });

  it("gives the same fit whether position is implicit or written out", () => {
    const book = sheet({
      A1: 10, A2: 22, A3: 29, A4: 41,
      B1: 1, B2: 2, B3: 3, B4: 4,
    });
    const implicit = spill(book, "D1", "=LINEST(A1:A4)", 1, 2);
    const explicit = spill(book, "G1", "=LINEST(A1:A4,B1:B4)", 1, 2);
    expect(implicit[0]![0] as number).toBeCloseTo(explicit[0]![0] as number, 12);
    expect(implicit[0]![1] as number).toBeCloseTo(explicit[0]![1] as number, 12);
  });
});
