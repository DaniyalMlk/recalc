import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import type { Value } from "../src/engine/value.js";

/** A sheet with x down column A and y down column B. */
function series(x: readonly number[], y: readonly number[]) {
  const book = new Workbook();
  const cells: Record<string, number> = {};
  for (const [index, value] of x.entries()) cells[`A${index + 1}`] = value;
  for (const [index, value] of y.entries()) cells[`B${index + 1}`] = value;
  book.setCells(cells);
  const n = Math.max(x.length, y.length);
  for (let index = 0; index < y.length; index += 1) {
    book.setCell(`C${index + 1}`, `=LN(B${index + 1})`);
  }
  return {
    xRange: `A1:A${x.length}`,
    yRange: `B1:B${y.length}`,
    /** `known_y` logged by the sheet itself, for the identity checks. */
    logRange: `C1:C${y.length}`,
    n,
    /** Evaluate at a free corner and read a block back. */
    block(formula: string, rows: number, cols = 1): Value[][] {
      book.setCell("P1", formula);
      const out: Value[][] = [];
      for (let row = 0; row < rows; row += 1) {
        const line: Value[] = [];
        for (let col = 0; col < cols; col += 1) {
          line.push(book.getValue(`${String.fromCharCode(80 + col)}${row + 1}`) ?? null);
        }
        out.push(line);
      }
      return out;
    },
    row(formula: string, cols: number): Value[] {
      return this.block(formula, 1, cols)[0] as Value[];
    },
    column(formula: string, rows: number): number[] {
      return this.block(formula, rows).map((line) => {
        const value = line[0];
        if (typeof value !== "number") throw new Error(JSON.stringify(value));
        return value;
      });
    },
    display(formula: string): string {
      book.setCell("P40", formula);
      return book.getDisplay("P40");
    },
  };
}

/** y = 3 * 2^x, exactly. */
const EXACT = series([1, 2, 3, 4, 5], [6, 12, 24, 48, 96]);

describe("LOGEST", () => {
  it("recovers an exactly exponential series", () => {
    const [m, b] = EXACT.row(`=LOGEST(${EXACT.yRange},${EXACT.xRange})`, 2);
    expect(m as number).toBeCloseTo(2, 12);
    expect(b as number).toBeCloseTo(3, 12);
  });

  it("is the linear fit of the logged outcome, exponentiated — exactly", () => {
    // Not a second opinion: on this path `LOGEST` and `LINEST` are the same
    // arithmetic reached two ways, so the two agree bit for bit and a
    // tolerance here would hide a real divergence.
    const exponential = EXACT.row(`=LOGEST(${EXACT.yRange},${EXACT.xRange})`, 2);
    const linear = EXACT.row(`=LINEST(${EXACT.logRange},${EXACT.xRange})`, 2);
    expect(exponential[0]).toBe(Math.exp(linear[0] as number));
    expect(exponential[1]).toBe(Math.exp(linear[1] as number));
  });

  it("forces the constant to exactly 1 when told to", () => {
    // The constraint is that the log-space intercept is zero, and the
    // exponential of zero is one — so this is 1 and not 1 to within a
    // tolerance.
    const [, b] = EXACT.row(`=LOGEST(${EXACT.yRange},${EXACT.xRange},FALSE)`, 2);
    expect(b).toBe(1);
  });

  it("reports the log-space statistics, with only the first row exponentiated", () => {
    const stats = EXACT.block(`=LOGEST(${EXACT.yRange},${EXACT.xRange},TRUE,TRUE)`, 5, 2);
    const linear = EXACT.block(`=LINEST(${EXACT.logRange},${EXACT.xRange},TRUE,TRUE)`, 5, 2);

    // Row 1 is the multipliers.
    expect(stats[0]?.[0]).toBe(Math.exp(linear[0]?.[0] as number));
    expect(stats[0]?.[1]).toBe(Math.exp(linear[0]?.[1] as number));

    // Rows 2 to 5 are the logged fit's, untouched. The standard errors are
    // the errors on the *exponents* — on `ln m`, not on `m` — and a reader
    // who exponentiated them would be wrong, so this says which they are.
    for (let row = 1; row < 5; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        expect(stats[row]?.[col], `row ${row + 1} col ${col + 1}`).toBe(
          linear[row]?.[col],
        );
      }
    }
    // And they are not the exponentials of themselves, which is what makes
    // the assertion above a statement rather than a coincidence.
    expect(stats[1]?.[0]).not.toBe(Math.exp(linear[1]?.[0] as number));
  });

  it("refuses an outcome whose log does not exist", () => {
    const negative = series([1, 2, 3], [4, -2, 9]);
    const zero = series([1, 2, 3], [4, 0, 9]);
    expect(negative.display(`=LOGEST(${negative.yRange},${negative.xRange})`)).toBe(
      "#NUM!",
    );
    expect(zero.display(`=LOGEST(${zero.yRange},${zero.xRange})`)).toBe("#NUM!");
    // Dropping the point instead would answer a different question silently,
    // and the remaining two would still fit a line.
    expect(negative.display(`=LINEST(${negative.yRange},${negative.xRange})`)).not.toBe(
      "#NUM!",
    );
  });

  it("takes more than one predictor", () => {
    // y = 2 * 1.5^u * 0.8^v, built so the answer is known.
    const book = new Workbook();
    const rows: [number, number][] = [
      [1, 1],
      [2, 1],
      [3, 2],
      [1, 3],
      [4, 2],
      [2, 4],
    ];
    const cells: Record<string, number> = {};
    for (const [index, [u, v]] of rows.entries()) {
      cells[`A${index + 1}`] = u;
      cells[`B${index + 1}`] = v;
      cells[`C${index + 1}`] = 2 * Math.pow(1.5, u) * Math.pow(0.8, v);
    }
    book.setCells(cells);
    book.setCell("P1", "=LOGEST(C1:C6,A1:B6)");
    // Reported last slope first, then the constant.
    expect(book.getValue("P1") as number).toBeCloseTo(0.8, 10);
    expect(book.getValue("Q1") as number).toBeCloseTo(1.5, 10);
    expect(book.getValue("R1") as number).toBeCloseTo(2, 10);
  });
});

describe("GROWTH", () => {
  it("returns the curve at the points it was given", () => {
    expect(EXACT.column(`=GROWTH(${EXACT.yRange},${EXACT.xRange})`, 5)).toEqual([
      expect.closeTo(6, 10),
      expect.closeTo(12, 10),
      expect.closeTo(24, 10),
      expect.closeTo(48, 10),
      expect.closeTo(96, 10),
    ]);
  });

  it("is the exponential of TREND on the logged outcome, exactly", () => {
    const grown = EXACT.column(`=GROWTH(${EXACT.yRange},${EXACT.xRange})`, 5);
    const trended = EXACT.column(`=TREND(${EXACT.logRange},${EXACT.xRange})`, 5);
    for (const [index, value] of grown.entries()) {
      expect(value).toBe(Math.exp(trended[index] as number));
    }
  });

  it("extrapolates to new points, and keeps the constraint when forced", () => {
    expect(EXACT.column(`=GROWTH(${EXACT.yRange},${EXACT.xRange},6)`, 1)[0]).toBeCloseTo(
      192,
      9,
    );
    // Forced through b = 1 the curve is a different one, and passes through
    // exp(slope) at x = 1 rather than through the data.
    const forced = EXACT.column(
      `=GROWTH(${EXACT.yRange},${EXACT.xRange},1,FALSE)`,
      1,
    )[0] as number;
    const [m] = EXACT.row(`=LOGEST(${EXACT.yRange},${EXACT.xRange},FALSE)`, 2);
    expect(forced).toBeCloseTo(m as number, 10);
  });

  it("refuses new cases of the wrong width", () => {
    const book = new Workbook();
    book.setCells({
      A1: 1,
      B1: 1,
      C1: 2,
      A2: 2,
      B2: 1,
      C2: 3,
      A3: 3,
      B3: 2,
      C3: 4,
      A4: 1,
      B4: 3,
      C4: 5,
      E1: 7,
    });
    book.setCell("P40", "=GROWTH(C1:C4,A1:B4,E1)");
    expect(book.getDisplay("P40")).toBe("#REF!");
  });
});

describe("what fitting the log actually minimises", () => {
  /**
   * The exponential with the smallest squared error in `y`, found by search.
   *
   * For a fixed `m` the constant is linear and has a closed form, so only one
   * dimension is left. The search over it is a plain golden section — a weak
   * optimiser on purpose: anything it finds that beats the fitted curve is a
   * curve the fitted one is not, and a sophisticated optimiser finding the
   * same thing would prove less.
   */
  function absoluteBest(
    x: readonly number[],
    y: readonly number[],
  ): { readonly b: number; readonly m: number } {
    const constantFor = (m: number): number => {
      let top = 0;
      let bottom = 0;
      for (const [index, value] of x.entries()) {
        top += (y[index] as number) * Math.pow(m, value);
        bottom += Math.pow(m, 2 * value);
      }
      return top / bottom;
    };
    const cost = (logM: number): number => {
      const m = Math.exp(logM);
      const b = constantFor(m);
      let total = 0;
      for (const [index, value] of x.entries()) {
        const residual = (y[index] as number) - b * Math.pow(m, value);
        total += residual * residual;
      }
      return total;
    };
    let low = Math.log(1.0001);
    let high = Math.log(20);
    const phi = (Math.sqrt(5) - 1) / 2;
    let left = high - phi * (high - low);
    let right = low + phi * (high - low);
    for (let step = 0; step < 300; step += 1) {
      if (cost(left) < cost(right)) {
        high = right;
        right = left;
        left = high - phi * (high - low);
      } else {
        low = left;
        left = right;
        right = low + phi * (high - low);
      }
    }
    const m = Math.exp((low + high) / 2);
    return { b: constantFor(m), m };
  }

  const squared = (
    x: readonly number[],
    y: readonly number[],
    b: number,
    m: number,
  ): number => {
    let total = 0;
    for (const [index, value] of x.entries()) {
      const residual = (y[index] as number) - b * Math.pow(m, value);
      total += residual * residual;
    }
    return total;
  };

  const squaredRelative = (
    x: readonly number[],
    y: readonly number[],
    b: number,
    m: number,
  ): number => {
    let total = 0;
    for (const [index, value] of x.entries()) {
      const ratio = Math.log((y[index] as number) / (b * Math.pow(m, value)));
      total += ratio * ratio;
    }
    return total;
  };

  function compare(x: readonly number[], y: readonly number[]) {
    const sheet = series(x, y);
    const [m, b] = sheet.row(`=LOGEST(${sheet.yRange},${sheet.xRange})`, 2) as [
      number,
      number,
    ];
    const best = absoluteBest(x, y);
    return {
      absolute: squared(x, y, b, m) / squared(x, y, best.b, best.m),
      relative:
        squaredRelative(x, y, best.b, best.m) / squaredRelative(x, y, b, m),
      spread: Math.max(...y) / Math.min(...y),
    };
  }

  it("each curve wins decisively on its own criterion", () => {
    // A series spanning two orders of magnitude, which is where the two
    // criteria disagree. The fitted curve is 12.7 times worse on squared
    // error in y; the absolute optimum is 38.8 times worse on squared error
    // in the log. Reporting only the first half would read as a defect.
    const spread = compare([1, 2, 3, 4, 5, 6], [2, 5, 9, 25, 40, 200]);
    expect(spread.absolute).toBeCloseTo(12.67, 1);
    expect(spread.relative).toBeCloseTo(38.77, 1);
    expect(spread.absolute).toBeGreaterThan(1);
    expect(spread.relative).toBeGreaterThan(1);
  });

  it("agrees with the absolute fit when the data is tight", () => {
    // Which is the half that keeps the figure above in proportion: the two
    // criteria pick nearly the same curve until the outcome has real spread,
    // and the gap grows with it.
    const tight = compare([1, 2, 3, 4, 5, 6], [10, 11, 12.5, 13, 14.6, 16]);
    expect(tight.spread).toBeLessThan(2);
    expect(tight.absolute).toBeLessThan(1.01);
    expect(tight.relative).toBeLessThan(1.01);

    const middling = compare([1, 2, 3, 4, 5, 6], [100, 150, 220, 320, 480, 700]);
    expect(middling.spread).toBeGreaterThan(2);
    expect(middling.absolute).toBeGreaterThan(tight.absolute);
    expect(middling.absolute).toBeLessThan(1.2);
  });

  it("leaves nothing for either criterion when the series is exponential", () => {
    // The one case with a known answer, and the control for the two above: a
    // ratio of errors is meaningless when both are zero, so both are bounded
    // instead.
    const x = [1, 2, 3, 4, 5];
    const y = [6, 12, 24, 48, 96];
    const sheet = series(x, y);
    const [m, b] = sheet.row(`=LOGEST(${sheet.yRange},${sheet.xRange})`, 2) as [
      number,
      number,
    ];
    expect(squaredRelative(x, y, b, m)).toBeLessThan(1e-28);
    expect(squared(x, y, b, m)).toBeLessThan(1e-20);
  });
});
