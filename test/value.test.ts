import { describe, expect, it } from "vitest";
import { NA_ERROR, isFormulaError } from "../src/engine/errors.js";
import {
  compareValues,
  formatValue,
  kindOf,
  parseNumericText,
  toBoolean,
  toNumber,
  toText,
} from "../src/engine/value.js";
import type { Value } from "../src/engine/value.js";

describe("kindOf", () => {
  const cases: Array<[Value, string]> = [
    [1, "number"],
    [0, "number"],
    ["x", "text"],
    ["", "text"],
    [true, "boolean"],
    [false, "boolean"],
    [null, "blank"],
    [NA_ERROR, "error"],
  ];

  it.each(cases)("classifies %o as %s", (value, kind) => {
    expect(kindOf(value)).toBe(kind);
  });
});

describe("parseNumericText", () => {
  const good: Array<[string, number]> = [
    ["1", 1],
    ["  2.5  ", 2.5],
    ["-3", -3],
    ["+4", 4],
    [".5", 0.5],
    ["1e3", 1000],
    ["1.5E-2", 0.015],
    ["50%", 0.5],
    ["-25%", -0.25],
  ];

  it.each(good)("parses %s", (text, value) => {
    expect(parseNumericText(text)).toBeCloseTo(value, 12);
  });

  it.each([["abc"], [""], ["  "], ["1a"], ["1 2"], ["$5"], ["1,000"], ["--1"]])(
    "rejects %s",
    (text) => {
      expect(parseNumericText(text)).toBeNull();
    },
  );
});

describe("toNumber", () => {
  it("passes numbers through", () => {
    expect(toNumber(3.5)).toBe(3.5);
  });

  it("treats blank as zero", () => {
    expect(toNumber(null)).toBe(0);
  });

  it("coerces booleans", () => {
    expect(toNumber(true)).toBe(1);
    expect(toNumber(false)).toBe(0);
  });

  it("coerces numeric text", () => {
    expect(toNumber("42")).toBe(42);
  });

  it("rejects non-numeric text", () => {
    const result = toNumber("abc");
    expect(isFormulaError(result) && result.code).toBe("#VALUE!");
  });

  it("passes errors through unchanged", () => {
    expect(toNumber(NA_ERROR)).toBe(NA_ERROR);
  });
});

describe("toText", () => {
  it("renders each type", () => {
    expect(toText("x")).toBe("x");
    expect(toText(null)).toBe("");
    expect(toText(12)).toBe("12");
    expect(toText(1.5)).toBe("1.5");
    expect(toText(true)).toBe("TRUE");
    expect(toText(false)).toBe("FALSE");
  });

  it("passes errors through", () => {
    expect(toText(NA_ERROR)).toBe(NA_ERROR);
  });
});

describe("toBoolean", () => {
  it("coerces by type", () => {
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(null)).toBe(false);
    expect(toBoolean(0)).toBe(false);
    expect(toBoolean(-1)).toBe(true);
    expect(toBoolean("true")).toBe(true);
    expect(toBoolean("FALSE")).toBe(false);
  });

  it("rejects other text", () => {
    const result = toBoolean("maybe");
    expect(isFormulaError(result) && result.code).toBe("#VALUE!");
  });
});

describe("compareValues", () => {
  const sign = (a: Value, b: Value) => {
    const result = compareValues(a, b);
    return isFormulaError(result) ? "error" : Math.sign(result);
  };

  it("compares numbers", () => {
    expect(sign(1, 2)).toBe(-1);
    expect(sign(2, 2)).toBe(0);
    expect(sign(3, 2)).toBe(1);
  });

  it("compares text case-insensitively", () => {
    expect(sign("a", "A")).toBe(0);
    expect(sign("a", "b")).toBe(-1);
  });

  it("orders number below text below boolean", () => {
    expect(sign("a", 1)).toBe(1);
    expect(sign(true, "z")).toBe(1);
    expect(sign(false, "z")).toBe(1);
    expect(sign(999999, "")).toBe(-1);
  });

  it("orders FALSE below TRUE", () => {
    expect(sign(false, true)).toBe(-1);
  });

  it("makes a blank equal both zero and empty text", () => {
    expect(sign(null, 0)).toBe(0);
    expect(sign(null, "")).toBe(0);
    expect(sign(null, false)).toBe(0);
  });

  it("still keeps zero and empty text apart", () => {
    expect(sign(0, "")).toBe(-1);
  });

  it("says two blanks are equal", () => {
    expect(sign(null, null)).toBe(0);
  });

  it("propagates errors from either side", () => {
    expect(sign(NA_ERROR, 1)).toBe("error");
    expect(sign(1, NA_ERROR)).toBe("error");
  });
});

describe("formatValue", () => {
  it("renders each type the way a cell would", () => {
    expect(formatValue(null)).toBe("");
    expect(formatValue(12)).toBe("12");
    expect(formatValue(true)).toBe("TRUE");
    expect(formatValue("text")).toBe("text");
    expect(formatValue(NA_ERROR)).toBe("#N/A");
  });
});
