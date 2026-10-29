import { describe, expect, it } from "vitest";
import { FormatCodeError, parseFormatCode } from "../src/format/code.js";
import { formatWith } from "../src/format/render.js";
import { bestRationalUnder } from "../src/format/rational.js";
import { Workbook } from "../src/engine/workbook.js";

function show(code: string, value: number): string {
  return formatWith(code, value).text;
}

function spec(code: string) {
  const section = parseFormatCode(code).sections[0];
  if (section === undefined) throw new Error(`${code} has no first section`);
  return section.fraction;
}

describe("compiling a fraction code", () => {
  it("splits the whole part from the numerator at the gap before the bar", () => {
    expect(spec("# ?/?")).toMatchObject({ wholeDigits: 1, numeratorDigits: 1 });
    expect(spec("# ??/??")).toMatchObject({ wholeDigits: 1, numeratorDigits: 2 });
    expect(spec("#,##0 ??/??")).toMatchObject({ wholeDigits: 4, numeratorDigits: 2 });
  });

  it("treats a bar with nothing before the gap as an improper fraction", () => {
    expect(spec("?/?")).toMatchObject({ wholeDigits: 0, numeratorDigits: 1 });
    expect(spec("???/???")).toMatchObject({ wholeDigits: 0, numeratorDigits: 3 });
  });

  it("bounds the denominator by its digit count", () => {
    expect(spec("# ?/?")).toMatchObject({ fixedDenominator: null, maxDenominator: 9 });
    expect(spec("# ??/??")).toMatchObject({ fixedDenominator: null, maxDenominator: 99 });
    expect(spec("# ???/???")).toMatchObject({
      fixedDenominator: null,
      maxDenominator: 999,
    });
  });

  it("takes a run containing a non-zero digit as a literal denominator", () => {
    expect(spec("# ?/8")).toMatchObject({ fixedDenominator: 8, maxDenominator: 8 });
    expect(spec("# ??/16")).toMatchObject({ fixedDenominator: 16, maxDenominator: 16 });
    expect(spec("# ??/100")).toMatchObject({ fixedDenominator: 100, denominatorWidth: 3 });
    // All zeros is a run of digit positions, not the number zero.
    expect(spec("# ??/00")).toMatchObject({ fixedDenominator: null, maxDenominator: 99 });
  });

  it("leaves a lone slash as a separator, so dates still parse", () => {
    expect(spec("d/m/yyyy")).toBeNull();
    expect(spec("mm/dd/yy")).toBeNull();
    expect(spec("0/")).toBeNull();
    expect(spec('0"x"/?')).toBeNull();
  });

  it("refuses a fraction that also wants a point, an exponent or text", () => {
    expect(() => parseFormatCode("#.0 ?/?")).toThrow(FormatCodeError);
    expect(() => parseFormatCode("#E+0 ?/?")).toThrow(FormatCodeError);
    expect(() => parseFormatCode("# ?/? @")).toThrow(FormatCodeError);
    expect(() => parseFormatCode("# ?/?/?")).toThrow(/one fraction bar/);
  });

  it("points at the character it gave up on", () => {
    try {
      parseFormatCode("#.0 ?/?");
      throw new Error("expected a parse failure");
    } catch (error) {
      expect(error).toBeInstanceOf(FormatCodeError);
      expect((error as FormatCodeError).offset).toBe(5);
    }
  });
});

describe("rendering a fraction", () => {
  const table: ReadonlyArray<readonly [string, number, string]> = [
    ["# ?/?", 1.75, "1 3/4"],
    ["# ?/?", 0.75, " 3/4"],
    ["# ?/?", -1.75, "-1 3/4"],
    ["0 ?/?", 0.75, "0 3/4"],
    ["# ??/??", 3.14159, "3 14/99"],
    ["# ???/???", 3.14159, "3  16/113"],
    ["?/?", 1.75, "7/4"],
    ["??/??", 3.14159, "311/99"],
    ["# ?/8", 1.3, "1 2/8"],
    ["# ??/16", 2.0625, "2  1/16"],
    ["$# ??/??", 12.375, "$12  3/8 "],
    ["#,##0 ??/??", 1234.5, "1,234  1/2 "],
  ];

  for (const [code, value, expected] of table) {
    it(`renders ${value} under ${code} as ${JSON.stringify(expected)}`, () => {
      expect(show(code, value)).toBe(expected);
    });
  }

  it("is the closest fraction in range and not the decimal put over ten", () => {
    // The whole point of a bounded denominator. 3/10 does not fit in one
    // digit; 2/7 does, and is closer than the 1/3 a reader might expect.
    expect(show("# ?/?", 0.3)).toBe(" 2/7");
    expect(show("# ??/??", 0.3)).toBe("  3/10");
  });

  it("rounds to the denominator a literal code names, closer one or not", () => {
    // A third is exactly representable under a one-digit bound and not in
    // eighths, so the two codes disagree on the same value by 4%.
    expect(show("# ?/?", 1 / 3)).toBe(" 1/3");
    expect(show("# ?/8", 1 / 3)).toBe(" 3/8");
    expect(Math.abs(1 / 3 - 3 / 8)).toBeGreaterThan(0.04);
  });

  it("does not reduce a literal denominator", () => {
    // `?/8` was asked for eighths. Four of them is the answer to that.
    expect(show("# ?/8", 0.5)).toBe(" 4/8");
    expect(show("# ?/?", 0.5)).toBe(" 1/2");
  });
});

describe("carrying and the zero numerator", () => {
  it("carries a fraction that rounds up to a whole", () => {
    expect(show("# ?/8", 0.99)).toBe("1    ");
    expect(show("# ?/?", 2.99)).toBe("3    ");
    expect(show("# ??/??", 1.999)).toBe("2      ");
  });

  it("leaves an improper code uncarried, which is what it is for", () => {
    // No whole part to carry into: 2.99 stays as a single fraction.
    expect(show("?/?", 2.99)).toBe("3/1");
    expect(show("??/??", 0.99)).toBe("98/99");
  });

  it("drops the fraction when the numerator rounds away, keeping the width", () => {
    const two = show("# ?/?", 2);
    expect(two).toBe("2    ");
    // `2 x/y` is five characters and so is this, which is what lets a column
    // of them line up even when some rows have no fraction.
    expect(two).toHaveLength(show("# ?/?", 2.5).length);
  });

  it("keeps a zero numerator that was written as a zero", () => {
    expect(show("# 0/0", 2)).toBe("2 0/1");
  });

  it("reserves no width when the code asked for none", () => {
    // `#` says drop it. Blanking to spaces would be ignoring that.
    expect(show("# #/#", 2)).toBe("2 ");
  });

  it("shows a zero rather than nothing when both halves vanish", () => {
    expect(show("# ?/?", 0)).toBe("0    ");
    expect(show("# ?/?", 0.04)).toBe("0    ");
    // ...and without a sign, since the format declined to show the precision
    // that would have made it negative.
    expect(show("# ?/?", -0.04)).toBe("0    ");
    expect(show("# ?/?", -1.75)).toBe("-1 3/4");
  });
});

describe("the bar stays in one column", () => {
  it("puts the slash at the same offset for every value in a column", () => {
    const code = "0 ??/??";
    // One integer digit throughout: a wider whole part moves the bar and is
    // meant to, so mixing widths here would make the check vacuous.
    const values = [0, 0.5, 1 / 3, 2.0625, 7.875, 9.01, 4.3, 6.125];
    const offsets = values.map((value) => show(code, value).indexOf("/"));
    const present = offsets.filter((offset) => offset >= 0);
    // A dropped fraction has no slash at all; every row that has one puts it
    // in the same place, which is the only thing `?` padding buys.
    expect(present.length).toBeGreaterThanOrEqual(6);
    for (const offset of present) {
      expect(offset).toBe(present[0]);
    }
    // And a wider whole part does move it, so the agreement above is a
    // property of the padding and not of every value rendering the same.
    expect(show(code, 100.5).indexOf("/")).toBeGreaterThan(present[0]!);
  });

  it("gives every row the same width, fraction or not", () => {
    const code = "0 ??/??";
    const widths = [0, 0.5, 1 / 3, 2.0625, 7.875, 9.01].map(
      (value) => show(code, value).length,
    );
    expect(new Set(widths).size).toBe(1);
  });

  it("widens rather than truncating when a value does not fit", () => {
    // A wide column is a nuisance; a wrong number is a defect.
    expect(show("0 ?/?", 1234.5)).toBe("1234 1/2");
    expect(show("# ?/100", 0.25)).toBe(" 25/100");
  });
});

describe("a rendered fraction says what it is worth", () => {
  it("reads back as a value no further from the input than the bound allows", () => {
    const codes: ReadonlyArray<readonly [string, number]> = [
      ["# ?/?", 9],
      ["# ??/??", 99],
      ["# ???/???", 999],
    ];
    let checked = 0;
    for (const [code, bound] of codes) {
      for (let i = 0; i <= 250; i += 1) {
        const value = i * 0.0417;
        const text = show(code, value);
        const parsed = readFraction(text);
        expect(parsed, `${code} on ${value} rendered ${JSON.stringify(text)}`).not.toBeNull();

        // The rendered text is worth what the best approximation under this
        // bound is worth. Parsing it back is the only check that covers the
        // layout and the arithmetic at once: a numerator placed in the wrong
        // column, or a carry that moved the wrong way, changes this number.
        const whole = Math.floor(value);
        const best = bestRationalUnder(value - whole, bound);
        const want = whole + best.numerator / best.denominator;
        expect(parsed!).toBeCloseTo(want, 12);
        checked += 1;
      }
    }
    expect(checked).toBe(3 * 251);
  });

  it("reads back exactly for an improper code", () => {
    for (let i = 0; i <= 120; i += 1) {
      const value = i * 0.083;
      const text = show("???/???", value);
      const best = bestRationalUnder(value, 999);
      expect(readFraction(text)).toBeCloseTo(best.numerator / best.denominator, 12);
    }
  });
});

/**
 * Read `-12  3/8 ` back as a number, or null if it is not one.
 *
 * The space between the whole part and the numerator is required, not
 * optional. Without that, a greedy whole part eats the numerator's leading
 * digit and ` 39/85` reads as three and nine eighty-fifths.
 */
function readFraction(text: string): number | null {
  const match = /^\s*(-?)\s*(?:(\d+)\s+)?(?:(\d+)\s*\/\s*(\d+))?\s*$/.exec(text);
  if (match === null) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const whole = match[2] === undefined ? 0 : Number(match[2]);
  if (match[3] === undefined || match[4] === undefined) return sign * whole;
  const denominator = Number(match[4]);
  if (denominator === 0) return null;
  return sign * (whole + Number(match[3]) / denominator);
}

describe("TEXT reaches the fraction codes", () => {
  function evaluate(formula: string) {
    const book = new Workbook();
    book.setCells({ A1: formula });
    return book.getValue("A1");
  }

  it("formats through a fraction code", () => {
    expect(evaluate('=TEXT(1.75,"# ?/?")')).toBe("1 3/4");
    expect(evaluate('=TEXT(2.0625,"# ??/16")')).toBe("2  1/16");
  });

  it("formats a fraction computed on the sheet", () => {
    const book = new Workbook();
    book.setCells({ A1: 7, A2: 8, A3: '=TEXT(A1/A2,"# ??/??")' });
    expect(book.getValue("A3")).toBe("  7/8 ");
  });
});
