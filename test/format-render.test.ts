import { describe, expect, it } from "vitest";
import { err, isFormulaError } from "../src/engine/errors.js";
import { Workbook } from "../src/engine/workbook.js";
import type { Value } from "../src/engine/value.js";
import { formatWith } from "../src/format/render.js";
import { roundToPlaces, base10Exponent } from "../src/format/decimal.js";

function show(code: string, value: Value): string {
  return formatWith(code, value).text;
}

/**
 * Each row is `[format, value, expected]`, and every expectation is what a
 * conventional spreadsheet shows for that pair. Keeping them as data makes the
 * disagreements obvious when a rule changes.
 */
function table(rows: readonly (readonly [string, Value, string])[]): void {
  for (const [code, value, expected] of rows) {
    it(`${code} on ${JSON.stringify(value)} shows ${JSON.stringify(expected)}`, () => {
      expect(show(code, value)).toBe(expected);
    });
  }
}

describe("digit placeholders", () => {
  table([
    ["0", 5, "5"],
    ["0", 0, "0"],
    ["#", 0, ""],
    ["00000", 42, "00042"],
    ["0.00", 3.1, "3.10"],
    ["0.##", 3.1, "3.1"],
    ["0.##", 3, "3"],
    ["0.?", 3, "3. "],
    ["#.##", 0.5, ".5"],
    ["0.##", 0.5, "0.5"],
    ["00", 12345, "12345"],
    ["???0", 7, "   7"],
  ]);
});

describe("grouping", () => {
  table([
    ["#,##0", 1234, "1,234"],
    ["#,##0", 5, "5"],
    ["#,##0", 999, "999"],
    ["#,##0", 1000, "1,000"],
    ["#,##0", 12345678, "12,345,678"],
    ["#,##0.00", 237560.620691, "237,560.62"],
    ["#,##0", 1234567890123, "1,234,567,890,123"],
  ]);
});

describe("scaling", () => {
  table([
    ["0.0,,", 2400000, "2.4"],
    ['#,##0,,"M"', 2400000, "2M"],
    ['#,##0.0,,"M"', 2400000, "2.4M"],
    ['#,##0,"k"', 1500, "2k"],
    ['#,##0.0,"k"', 1500, "1.5k"],
    ["0%", 0.25, "25%"],
    ["0.0%", 0.1356486793, "13.6%"],
    ["0.00%", 1, "100.00%"],
  ]);
});

describe("rounding at the format's precision", () => {
  table([
    ["0.00", 1.005, "1.01"],
    ["0.00", 2.675, "2.68"],
    ["0", 0.5, "1"],
    ["0", 1.5, "2"],
    ["0", 2.5, "3"],
    ["0.00", 9.999, "10.00"],
    ["#,##0.0", 999.95, "1,000.0"],
    ["0.00", 0.0001, "0.00"],
    ["0.0", -0.04, "0.0"],
    ["0", -0.4, "0"],
  ]);
});

describe("section selection", () => {
  table([
    // One section: the renderer supplies the sign.
    ["0.00", -1.5, "-1.50"],
    ["$#,##0.00", -1234.5, "-$1,234.50"],
    // Two sections: the negative branch owns the sign, so it sees a magnitude.
    ["#,##0;(#,##0)", -1234, "(1,234)"],
    ["#,##0;(#,##0)", 1234, "1,234"],
    ["#,##0;(#,##0)", 0, "0"],
    // Three sections split out zero.
    ['0;(0);"—"', 0, "—"],
    ['0;(0);"—"', -3, "(3)"],
    ['0;(0);"—"', 3, "3"],
    // An empty branch hides its case entirely.
    ["#,##0;;", 0, ""],
    ["#,##0;;", -7, ""],
    ["#,##0;;", 7, "7"],
  ]);

  it("reports the colour a section asked for", () => {
    expect(formatWith("#,##0;[Red](#,##0)", -1234)).toEqual({
      text: "(1,234)",
      colour: "red",
    });
    expect(formatWith("#,##0;[Red](#,##0)", 1234).colour).toBeNull();
  });
});

describe("literals", () => {
  table([
    ['"Total: "#,##0', 900000, "Total: 900,000"],
    ['#,##0" units"', 12, "12 units"],
    ["$#,##0", 1234, "$1,234"],
    ["_(0_)", 5, " 5 "],
    ["0*-", 5, "5"],
    ["\\#0", 5, "#5"],
  ]);
});

describe("text", () => {
  table([
    ['@" (note)"', "hello", "hello (note)"],
    ['"<"@">"', "x", "<x>"],
    // A numeric format leaves text alone rather than mangling it.
    ["#,##0.00", "Revenue", "Revenue"],
    ["0;0;0;@", "abc", "abc"],
    ['0;0;0;"n/a"', "abc", "n/a"],
  ]);
});

describe("values a format does not describe", () => {
  table([
    ["0.00", null, ""],
    ["0.00", true, "TRUE"],
    ["0.00", false, "FALSE"],
  ]);

  it("shows an error code untouched", () => {
    expect(show("#,##0.00", err("#DIV/0!"))).toBe("#DIV/0!");
  });

  it("falls back to the general rendering for a non-finite number", () => {
    expect(show("#,##0.00", Number.POSITIVE_INFINITY)).toBe("Infinity");
  });

  it("passes General straight through", () => {
    expect(show("General", 1234.5)).toBe("1234.5");
    expect(show("general", "text")).toBe("text");
  });
});

describe("scientific notation", () => {
  table([
    ["0.00E+00", 12345, "1.23E+04"],
    ["0.00E+00", 0.000123, "1.23E-04"],
    ["0.00E+00", 0, "0.00E+00"],
    ["0.00E+00", -12345, "-1.23E+04"],
    ["0E+0", 1000, "1E+3"],
    ["0.0E-0", 1000, "1.0E3"],
    // Three integer positions force the exponent to a multiple of three.
    ["##0.0E+0", 12345, "12.3E+3"],
    ["##0.0E+0", 1234567, "1.2E+6"],
  ]);

  it("steps the exponent when rounding overflows the mantissa", () => {
    // 9.999e3 at one decimal would print 10.0E+3; the exponent moves instead.
    expect(show("0.0E+00", 9999)).toBe("1.0E+04");
  });
});

describe("decimal rounding helper", () => {
  it("rounds half away from zero on the decimal, not the float", () => {
    expect(roundToPlaces(1.005, 2)).toEqual({ int: "1", frac: "01" });
    expect(roundToPlaces(0.125, 2)).toEqual({ int: "0", frac: "13" });
  });

  it("carries out of the top of the number", () => {
    expect(roundToPlaces(9.999, 2)).toEqual({ int: "10", frac: "00" });
    expect(roundToPlaces(0.999, 0)).toEqual({ int: "1", frac: "" });
  });

  it("rounds a value that lies entirely below the boundary", () => {
    expect(roundToPlaces(0.4, 0)).toEqual({ int: "0", frac: "" });
    expect(roundToPlaces(0.6, 0)).toEqual({ int: "1", frac: "" });
    expect(roundToPlaces(0.04, 1)).toEqual({ int: "0", frac: "0" });
  });

  it("keeps every digit of a large integer", () => {
    expect(roundToPlaces(1e21, 0).int).toBe("1" + "0".repeat(21));
  });

  it("reads the exponent from the decimal expansion", () => {
    // Math.log10(1000) lands a hair under 3 on some inputs; this must not.
    expect(base10Exponent(1000)).toBe(3);
    expect(base10Exponent(999.9)).toBe(2);
    expect(base10Exponent(0.001)).toBe(-3);
    expect(base10Exponent(0)).toBe(0);
  });
});

describe("the TEXT function", () => {
  const book = new Workbook();
  const evaluate = (formula: string): Value => {
    book.setCell("Z90", formula);
    return book.getValue("Z90");
  };

  it("formats a number with a code", () => {
    expect(evaluate('=TEXT(1234.5,"#,##0.00")')).toBe("1,234.50");
  });

  it("uses the same section rules as a cell format", () => {
    expect(evaluate('=TEXT(-8,"0;(0)")')).toBe("(8)");
  });

  it("reads its arguments from cells", () => {
    // The code needs the apostrophe escape: typed bare, `0.0%` is a number.
    book.setCells({ A1: 0.075, B1: "'0.0%" });
    expect(evaluate("=TEXT(A1,B1)")).toBe("7.5%");
  });

  it("returns #VALUE! for a code it cannot compile", () => {
    const value = evaluate('=TEXT(1,"yyyy")');
    expect(isFormulaError(value) && value.code).toBe("#VALUE!");
    expect(isFormulaError(value) && value.detail).toMatch(/date and time/);
  });

  it("propagates an error argument", () => {
    const value = evaluate('=TEXT(1/0,"0.00")');
    expect(isFormulaError(value) && value.code).toBe("#DIV/0!");
  });

  it("is arity checked", () => {
    const value = evaluate('=TEXT(1)');
    expect(isFormulaError(value) && value.code).toBe("#VALUE!");
  });
});
