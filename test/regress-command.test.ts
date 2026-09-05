import { describe, expect, it } from "vitest";
import { PLAIN, regressCommand } from "../src/analysis/commands.js";
import { parseRegressCommand, summarise } from "../src/analysis/regression.js";
import { parseA1Range } from "../src/engine/reference.js";
import { Workbook } from "../src/engine/workbook.js";

const OFFICES: readonly (readonly number[])[] = [
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
  const book = new Workbook();
  const cells: Record<string, number> = {};
  OFFICES.forEach((row, i) => {
    row.forEach((value, c) => {
      cells[`${String.fromCharCode(65 + c)}${i + 1}`] = value;
    });
  });
  book.setCells(cells);
  return book;
}

const run = (book: Workbook, tail: string) => regressCommand(book, tail, PLAIN);

describe("parsing the command", () => {
  it("reads a fit with an intercept", () => {
    const parsed = parseRegressCommand("E1:E11 by A1:D11");
    expect(typeof parsed).not.toBe("string");
    expect(typeof parsed === "string" ? null : parsed.withIntercept).toBe(true);
  });

  it("reads the through-zero form", () => {
    const parsed = parseRegressCommand("E1:E11 by A1:D11 through zero");
    expect(typeof parsed === "string" ? null : parsed.withIntercept).toBe(false);
  });

  it("is case-insensitive on the keywords", () => {
    expect(typeof parseRegressCommand("E1:E11 BY A1:D11 THROUGH ZERO")).not.toBe(
      "string",
    );
  });

  it("refuses a line it cannot read", () => {
    expect(parseRegressCommand("nonsense")).toContain("usage:");
    expect(parseRegressCommand("E1:E11 A1:D11")).toContain("usage:");
  });

  it("refuses something that is not a block", () => {
    expect(parseRegressCommand("hello by world")).toContain("blocks");
  });
});

describe("the summary", () => {
  it("reproduces the published coefficients", () => {
    const summary = summarise(
      officeSheet(),
      parseA1Range("E1:E11"),
      parseA1Range("A1:D11"),
    );
    const byLabel = Object.fromEntries(
      summary.terms.map((t) => [t.label, t.coefficient]),
    );
    expect(byLabel["intercept"]!).toBeCloseTo(52317.83051, 3);
    expect(byLabel["A"]!).toBeCloseTo(27.64138737, 6);
    expect(byLabel["B"]!).toBeCloseTo(12529.76817, 4);
    expect(byLabel["C"]!).toBeCloseTo(2553.21066, 4);
    expect(byLabel["D"]!).toBeCloseTo(-234.2371645, 6);
  });

  it("reproduces the published standard errors", () => {
    const summary = summarise(
      officeSheet(),
      parseA1Range("E1:E11"),
      parseA1Range("A1:D11"),
    );
    const bySe = Object.fromEntries(
      summary.terms.map((t) => [t.label, t.standardError]),
    );
    expect(bySe["intercept"]!).toBeCloseTo(12237.3616, 3);
    expect(bySe["A"]!).toBeCloseTo(5.429374042, 6);
    expect(bySe["D"]!).toBeCloseTo(13.26801148, 6);
  });

  it("reports each t as its coefficient over its standard error", () => {
    const summary = summarise(
      officeSheet(),
      parseA1Range("E1:E11"),
      parseA1Range("A1:D11"),
    );
    for (const term of summary.terms) {
      expect(term.t).toBeCloseTo(term.coefficient / term.standardError, 9);
    }
  });

  it("reports the fit's own statistics", () => {
    const summary = summarise(
      officeSheet(),
      parseA1Range("E1:E11"),
      parseA1Range("A1:D11"),
    );
    expect(summary.observations).toBe(11);
    expect(summary.predictors).toBe(4);
    expect(summary.df).toBe(6);
    expect(summary.rSquared).toBeCloseTo(0.996747993, 8);
    expect(summary.standardError).toBeCloseTo(970.5784629, 5);
    expect(summary.f).toBeCloseTo(459.7536742, 4);
  });

  it("adjusts R squared downwards for the predictors spent", () => {
    const summary = summarise(
      officeSheet(),
      parseA1Range("E1:E11"),
      parseA1Range("A1:D11"),
    );
    expect(summary.adjustedRSquared).toBeLessThan(summary.rSquared);
    expect(summary.adjustedRSquared).toBeCloseTo(
      1 - ((1 - summary.rSquared) * 10) / 6,
      10,
    );
  });

  it("drops the intercept when told to fit through zero", () => {
    const summary = summarise(
      officeSheet(),
      parseA1Range("E1:E11"),
      parseA1Range("A1:D11"),
      false,
    );
    expect(summary.terms.map((t) => t.label)).toEqual(["A", "B", "C", "D"]);
    expect(summary.df).toBe(7);
  });

  it("has sums of squares that add to the total", () => {
    const summary = summarise(
      officeSheet(),
      parseA1Range("E1:E11"),
      parseA1Range("A1:D11"),
    );
    const y = OFFICES.map((row) => row[4]!);
    const mean = y.reduce((a, b) => a + b, 0) / y.length;
    const sstot = y.reduce((a, b) => a + (b - mean) ** 2, 0);
    expect(summary.ssRegression + summary.ssResidual).toBeCloseTo(sstot, 3);
  });
});

describe("what the command prints", () => {
  it("puts every term on its own line, intercept first", () => {
    const out = run(officeSheet(), "E1:E11 by A1:D11");
    const lines = out.split("\n").filter((line) => line.trim() !== "");
    expect(lines[0]).toContain("coefficient");
    expect(lines[1]).toContain("intercept");
    expect(out).toContain("52317.831");
    expect(out).toContain("r squared");
  });

  it("labels each predictor by the column it came from", () => {
    const out = run(officeSheet(), "E1:E11 by A1:D11");
    for (const label of ["A", "B", "C", "D"]) {
      expect(out).toMatch(new RegExp(`\\s${label}\\s`));
    }
  });

  it("leaves the intercept out of a through-zero fit", () => {
    const out = run(officeSheet(), "E1:E11 by A1:D11 through zero");
    expect(out).not.toContain("intercept");
  });

  it("refuses a y that is a block rather than a column", () => {
    expect(run(officeSheet(), "A1:B11 by C1:C11")).toContain("single column");
  });

  it("refuses ranges of different heights", () => {
    expect(run(officeSheet(), "E1:E11 by A1:D5")).toContain("11 rows");
  });

  it("refuses more parameters than observations", () => {
    expect(run(officeSheet(), "E1:E3 by A1:D3")).toContain("cannot fit");
  });

  it("refuses a block holding text", () => {
    const book = officeSheet();
    book.setCell("B4", "three");
    expect(run(book, "E1:E11 by A1:D11")).toContain("numbers");
  });

  it("refuses linearly dependent predictors", () => {
    const book = new Workbook();
    book.setCells({
      A1: 1, A2: 4, A3: 2, A4: 7, A5: 3,
      B1: 1, B2: 2, B3: 3, B4: 4, B5: 5,
      C1: 2, C2: 4, C3: 6, C4: 8, C5: 10,
    });
    expect(run(book, "A1:A5 by B1:C5")).toContain("dependent");
  });
});
