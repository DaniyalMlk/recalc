import { describe, expect, it } from "vitest";
import { FormatCodeError, parseFormatCode } from "../src/format/code.js";
import { formatWith } from "../src/format/render.js";
import { civilFromSerial, serialFromCivil } from "../src/date/serial.js";

function show(code: string, serial: number): string {
  return formatWith(code, serial).text;
}

/** The offset a refusal reports, or `null` when the code is accepted. */
function refusalOffset(code: string): number | null {
  try {
    parseFormatCode(code);
    return null;
  } catch (error) {
    if (error instanceof FormatCodeError) return error.offset;
    throw error;
  }
}

/**
 * Dates spread over the cases a separator could plausibly interact with:
 * single and double digit days and months, a month end, a leap day, the turn
 * of a year, and the two months around the phantom 1900 leap day.
 */
const DATES = [
  [2026, 3, 4],
  [2026, 12, 31],
  [2024, 2, 29],
  [2000, 1, 1],
  [1900, 1, 31],
  [1900, 3, 1],
  [2026, 10, 9],
  [9999, 12, 31],
] as const;

const SERIALS = DATES.map(([y, m, d]) => serialFromCivil(y, m, d));

describe("a dot as a date separator", () => {
  it("renders the codes written with it across Europe", () => {
    const serial = serialFromCivil(2026, 3, 4);
    expect(show("d.m.yyyy", serial)).toBe("4.3.2026");
    expect(show("dd.mm.yyyy", serial)).toBe("04.03.2026");
    expect(show("dd.mm.yy", serial)).toBe("04.03.26");
    expect(show("yyyy.mm.dd", serial)).toBe("2026.03.04");
    expect(show("d.m", serial)).toBe("4.3");
    expect(show("d.m.yyyy hh:mm", serial + 0.5)).toBe("4.3.2026 12:00");
  });

  it("differs from the same code written with a slash only in the separator", () => {
    // The slash form already worked, so it is the reference: the dot has to
    // reach the same fields, in the same widths, in the same order. A rule
    // that dropped a separator, or read one as a decimal point and rounded
    // the serial, would not survive this.
    const shapes = ["d*m*yyyy", "dd*mm*yyyy", "yyyy*mm*dd", "d*m", "mmm*yyyy"];
    let compared = 0;
    for (const shape of shapes) {
      for (const serial of SERIALS) {
        const withSlash = show(shape.replaceAll("*", "/"), serial);
        const withDot = show(shape.replaceAll("*", "."), serial);
        expect(withDot).toBe(withSlash.replaceAll("/", "."));
        compared += 1;
      }
    }
    expect(compared).toBe(shapes.length * SERIALS.length);
    expect(compared).toBe(40);
  });

  it("puts the fields where the date module says they are", () => {
    // The renderer and the serial module are separate; this is the one
    // assertion that says they agree about what day it is.
    for (const serial of SERIALS) {
      const date = civilFromSerial(serial);
      expect(show("d.m.yyyy", serial)).toBe(
        `${date.day}.${date.month}.${date.year}`,
      );
    }
  });

  it("carries as many separators as the code writes", () => {
    const serial = serialFromCivil(2026, 3, 4);
    expect(show("d.m.yyyy.", serial)).toBe("4.3.2026.");
    expect(show(".d.m.yyyy", serial)).toBe(".4.3.2026");
    expect(show("d..m", serial)).toBe("4..3");
    expect(show("yyyy.mm.dd.hh.mm", serial + 0.5)).toBe("2026.03.04.12.00");
  });

  it("leaves the sub-second point alone", () => {
    const serial = serialFromCivil(2026, 3, 4) + 0.5;
    expect(show("hh:mm:ss.00", serial)).toBe("12:00:00.00");
    expect(parseFormatCode("hh:mm:ss.00").sections[0]!.subSecondDigits).toBe(2);
    // A separator and a precision point in one section, which is the case
    // that needs both readings to coexist.
    expect(show("d.m.yyyy hh:mm:ss.000", serial)).toBe("4.3.2026 12:00:00.000");
    expect(
      parseFormatCode("d.m.yyyy hh:mm:ss.000").sections[0]!.subSecondDigits,
    ).toBe(3);
    // Precision first, separator after it.
    expect(show("ss.00 d.m", serial)).toBe("00.00 4.3");
  });

  it("holds no digit positions, so a date section's points are not decimals", () => {
    const section = parseFormatCode("d.m.yyyy").sections[0]!;
    expect(section.dateTime).toBe(true);
    expect(section.decimals).toBe(0);
    expect(section.intDigits).toBe(0);
    expect(section.tokens.some((token) => token.kind === "point")).toBe(false);
  });
});

describe("a dot in a section that lays out digits", () => {
  it("is still the decimal point, and still only one of them", () => {
    expect(show("0.0", 3.75)).toBe("3.8");
    expect(show("#,##0.00", 1234.5)).toBe("1,234.50");
    expect(refusalOffset("0.0.0")).toBe(3);
    expect(() => parseFormatCode("0.0.0")).toThrow(/one decimal point/);
    // The offset is the second point's, not the first's and not the end.
    expect(refusalOffset("#,##0.00.0")).toBe(8);
  });

  it("refuses a section that mixes calendar fields with digit positions", () => {
    for (const code of ["d 0.0", "0.0 d", "ss..00", "hh:mm.00", "d.0"]) {
      expect(() => parseFormatCode(code)).toThrow(
        /mixes date fields with digit positions/,
      );
    }
  });
});

describe("a fraction bar beside a point or an exponent", () => {
  it("is refused whichever order the two are written in", () => {
    for (const code of ["0.0 ?/?", "?/? 0.0", "# ?/?.0", "?/?.0", "# ??/16 0.0"]) {
      expect(() => parseFormatCode(code)).toThrow(
        /fraction code cannot also have a decimal point/,
      );
    }
    for (const code of ["0E+0 ?/?", "?/? 0E+0", "?/? E+0"]) {
      expect(() => parseFormatCode(code)).toThrow(
        /fraction code cannot also be scientific/,
      );
    }
  });

  it("reports the offset of whichever of the two came second", () => {
    // The bar is second in `0.0 ?/?` and the point is second in `?/? 0.0`,
    // and both codes are seven characters long, so the two offsets agreeing
    // is not the same assertion twice.
    expect(refusalOffset("0.0 ?/?")).toBe(5);
    expect(refusalOffset("?/? 0.0")).toBe(5);
    expect("0.0 ?/?".charAt(5)).toBe("/");
    expect("?/? 0.0".charAt(5)).toBe(".");
    expect(refusalOffset("0E+0 ?/?")).toBe(6);
    expect("0E+0 ?/?".charAt(6)).toBe("/");
    expect(refusalOffset("?/? 0E+0")).toBe(5);
    expect("?/? 0E+0".charAt(5)).toBe("E");
  });

  it("still accepts the fractions and the exponents that stand alone", () => {
    expect(show("# ?/?", 3.75)).toBe("3 3/4");
    expect(show("?/?", 3.75)).toBe("15/4");
    expect(show("# ??/16", 3.75)).toBe("3 12/16");
    expect(show("0.00E+0", 3750)).toBe("3.75E+3");
    // A `/` that is not a bar is a separator, which is the rule that keeps a
    // date a date, and it is unaffected by any of this.
    expect(show("d/m/yyyy", serialFromCivil(2026, 3, 4))).toBe("4/3/2026");
  });
});
