import { describe, expect, it } from "vitest";
import {
  FormatCodeError,
  isGeneralFormat,
  parseFormatCode,
} from "../src/format/code.js";

function section(source: string, index = 0) {
  const parsed = parseFormatCode(source);
  const picked = parsed.sections[index];
  if (picked === undefined) {
    throw new Error(`${source} has no section ${index}`);
  }
  return picked;
}

function kinds(source: string, index = 0): string[] {
  return section(source, index).tokens.map((token) => token.kind);
}

describe("sections", () => {
  it("splits on semicolons", () => {
    expect(parseFormatCode("0;(0);\"-\";@").sections).toHaveLength(4);
  });

  it("keeps a semicolon inside a quoted literal out of the split", () => {
    const parsed = parseFormatCode('0" ; "0');
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]!.tokens).toContainEqual({
      kind: "literal",
      text: " ; ",
    });
  });

  it("keeps an escaped semicolon out of the split", () => {
    expect(parseFormatCode("0\\;0").sections).toHaveLength(1);
  });

  it("allows an empty section, which suppresses its branch", () => {
    const parsed = parseFormatCode("0;;");
    expect(parsed.sections).toHaveLength(3);
    expect(parsed.sections[2]!.tokens).toEqual([]);
  });

  it("refuses a fifth section", () => {
    expect(() => parseFormatCode("0;0;0;0;0")).toThrow(FormatCodeError);
  });

  it("refuses an empty code", () => {
    expect(() => parseFormatCode("")).toThrow(FormatCodeError);
  });
});

describe("digit positions", () => {
  it("counts integer and decimal placeholders", () => {
    const parsed = section("#,##0.00");
    expect(parsed.intDigits).toBe(4);
    expect(parsed.decimals).toBe(2);
    expect(parsed.minIntDigits).toBe(1);
  });

  it("treats ? as a padding placeholder that still demands a position", () => {
    const parsed = section("??0.0?");
    expect(parsed.intDigits).toBe(3);
    expect(parsed.minIntDigits).toBe(3);
    expect(parsed.decimals).toBe(2);
  });

  it("counts no minimum integer digits for a code made only of hashes", () => {
    expect(section("###").minIntDigits).toBe(0);
  });

  it("refuses a second decimal point", () => {
    expect(() => parseFormatCode("0.0.0")).toThrow(/one decimal point/);
  });
});

describe("commas", () => {
  it("reads a comma between digits as grouping", () => {
    const parsed = section("#,##0");
    expect(parsed.grouped).toBe(true);
    expect(parsed.scaleBy).toBe(0);
  });

  it("reads commas after the last digit as scaling", () => {
    const parsed = section("#,##0,,");
    expect(parsed.grouped).toBe(true);
    expect(parsed.scaleBy).toBe(2);
    // The grouping comma survives; only the two trailing ones are consumed.
    expect(kinds("#,##0,,").filter((kind) => kind === "group")).toHaveLength(1);
  });

  it("scales even when a literal follows the commas", () => {
    expect(section('#,##0,"M"').scaleBy).toBe(1);
  });

  it("keeps a comma with nothing numeric before it as a literal", () => {
    expect(kinds('",",#0')).toContain("literal");
    expect(section('",",#0').scaleBy).toBe(0);
  });
});

describe("literals and escapes", () => {
  it("reads a quoted run as one literal", () => {
    expect(section('"USD "#,##0').tokens[0]).toEqual({
      kind: "literal",
      text: "USD ",
    });
  });

  it("refuses an unterminated quote", () => {
    expect(() => parseFormatCode('0"abc')).toThrow(/unterminated/);
  });

  it("reads a backslash escape as the literal character", () => {
    expect(section("\\#0").tokens[0]).toEqual({ kind: "literal", text: "#" });
  });

  it("reads _ as a width skip and * as a fill", () => {
    expect(kinds("_(0*-")).toEqual(["skip", "digit", "fill"]);
  });

  it("passes currency and punctuation straight through", () => {
    expect(section("$#0").tokens[0]).toEqual({ kind: "literal", text: "$" });
  });

  it("refuses a trailing escape with nothing to escape", () => {
    expect(() => parseFormatCode("0\\")).toThrow(/backslash/);
  });
});

describe("modifiers", () => {
  it("reads a colour", () => {
    expect(section("[Red]0").colour).toBe("red");
  });

  it("normalises colour case", () => {
    expect(section("[BLUE]0").colour).toBe("blue");
  });

  it("carries a colour per section", () => {
    const parsed = parseFormatCode("[Green]0;[Red]0");
    expect(parsed.sections[0]!.colour).toBe("green");
    expect(parsed.sections[1]!.colour).toBe("red");
  });

  it("refuses a modifier that is not a colour", () => {
    expect(() => parseFormatCode("[>100]0")).toThrow(/unsupported format modifier/);
  });

  it("refuses an unterminated bracket", () => {
    expect(() => parseFormatCode("[Red0")).toThrow(/unterminated/);
  });
});

describe("scientific codes", () => {
  it("records exponent digits", () => {
    const parsed = section("0.00E+00");
    expect(parsed.exponentDigits).toBe(2);
    expect(parsed.decimals).toBe(2);
    expect(parsed.intDigits).toBe(1);
  });

  it("distinguishes E+ from E-", () => {
    expect(section("0E+0").tokens).toContainEqual({
      kind: "exponent",
      signAlways: true,
    });
    expect(section("0E-0").tokens).toContainEqual({
      kind: "exponent",
      signAlways: false,
    });
  });

  it("treats a bare E as a literal", () => {
    expect(section("0E").tokens).toContainEqual({ kind: "literal", text: "E" });
  });
});

describe("date and time codes", () => {
  it("reads a run of letters as one field of that width", () => {
    expect(section("yyyy-mm-dd").tokens).toEqual([
      { kind: "datetime", field: "year", width: 4 },
      { kind: "literal", text: "-" },
      { kind: "datetime", field: "month", width: 2 },
      { kind: "literal", text: "-" },
      { kind: "datetime", field: "day", width: 2 },
    ]);
    expect(section("yyyy-mm-dd").dateTime).toBe(true);
    expect(section("0.00").dateTime).toBe(false);
  });

  it("reads m as a month unless a clock field is next to it", () => {
    const fields = (code: string) =>
      section(code)
        .tokens.filter((token) => token.kind === "datetime")
        .map((token) => (token as { field: string }).field);
    expect(fields("mm")).toEqual(["month"]);
    expect(fields("mm/dd")).toEqual(["month", "day"]);
    expect(fields("hh:mm")).toEqual(["hour", "minute"]);
    expect(fields("mm:ss")).toEqual(["minute", "second"]);
    expect(fields("yyyy-mm-dd hh:mm:ss")).toEqual([
      "year",
      "month",
      "day",
      "hour",
      "minute",
      "second",
    ]);
    expect(fields("[h]:mm")).toEqual(["elapsedHour", "minute"]);
  });

  it("reads the meridiem markers and marks the section as 12-hour", () => {
    expect(section("h:mm AM/PM").clock12).toBe(true);
    expect(section("h:mm A/P").tokens).toContainEqual({
      kind: "datetime",
      field: "meridiem",
      width: 1,
    });
    expect(section("hh:mm").clock12).toBe(false);
  });

  it("reads the bracketed elapsed codes", () => {
    expect(section("[hh]").tokens).toEqual([
      { kind: "datetime", field: "elapsedHour", width: 2 },
    ]);
    expect(section("[s]").tokens).toEqual([
      { kind: "datetime", field: "elapsedSecond", width: 1 },
    ]);
    // A bracket that is neither a colour nor an elapsed code is still refused.
    expect(() => parseFormatCode("[wat]")).toThrow(/unsupported format modifier/);
  });

  it("keeps colours working alongside date fields", () => {
    expect(section("[Red]yyyy").colour).toBe("red");
  });

  it("refuses to mix date fields with digit positions", () => {
    try {
      parseFormatCode("0yyyy");
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(FormatCodeError);
      expect((error as FormatCodeError).offset).toBe(1);
      expect((error as FormatCodeError).message).toMatch(/mixes date fields/);
    }
    expect(() => parseFormatCode("yyyy@")).toThrow(/mixes date fields/);
  });
});

describe("out of scope codes", () => {
  it("rejects fraction codes", () => {
    expect(() => parseFormatCode("# ?/?")).toThrow(/fraction/);
  });

  it("rejects an unknown character", () => {
    expect(() => parseFormatCode("0§0")).toThrow(/unexpected character/);
  });
});

describe("general", () => {
  it("recognises the general format however it is cased", () => {
    expect(isGeneralFormat("General")).toBe(true);
    expect(isGeneralFormat("  general ")).toBe(true);
    expect(isGeneralFormat("0.00")).toBe(false);
  });
});
