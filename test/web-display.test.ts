import { describe, expect, it } from "vitest";

import { err } from "../src/engine/errors.js";
import {
  charsForWidth,
  displayValue,
  generalNumber,
} from "../web/src/core/display.js";

describe("generalNumber", () => {
  it("leaves a number that already fits alone", () => {
    expect(generalNumber(42, 12)).toBe("42");
    expect(generalNumber(-2400000, 12)).toBe("-2400000");
    expect(generalNumber(0, 12)).toBe("0");
  });

  it("removes float representation noise", () => {
    expect(generalNumber(0.1 + 0.2, 20)).toBe("0.3");
    expect(generalNumber(1 / 3, 20)).toBe("0.333333333333");
  });

  it("shrinks the fraction until the number fits", () => {
    expect(generalNumber(237560.62069063215, 12)).toBe("237560.62069");
    expect(generalNumber(237560.62069063215, 9)).toBe("237560.62");
    expect(generalNumber(237560.62069063215, 7)).toBe("237561");
  });

  it("never drops an integer digit to make room", () => {
    // Six integer digits cannot be shown in four characters, so the result
    // overflows rather than lying about the magnitude.
    const text = generalNumber(237560.62, 4);
    expect(Number(text)).toBeCloseTo(237561, 0);
    expect(text.length).toBeGreaterThan(4);
  });

  it("keeps the sign in its budget", () => {
    expect(generalNumber(-0.13564867934, 8)).toBe("-0.13565");
  });

  it("rounds rather than truncates", () => {
    expect(generalNumber(0.135648679, 6)).toBe("0.1356");
    expect(generalNumber(0.999999, 4)).toBe("1");
  });

  it("switches to exponential for very large and very small magnitudes", () => {
    expect(generalNumber(1.5e18, 12)).toBe("1.5e18");
    expect(generalNumber(0.0000001234, 12)).toBe("1.234e-7");
  });

  it("shortens the exponential form when the column is narrow", () => {
    const text = generalNumber(1.23456789e20, 6);
    expect(text.length).toBeLessThanOrEqual(6);
    expect(text).toContain("e");
  });

  it("handles values that are not finite", () => {
    expect(generalNumber(Number.NaN, 8)).toBe("NaN");
    expect(generalNumber(Number.POSITIVE_INFINITY, 8)).toBe("∞");
  });

  it("round-trips within the precision it claims", () => {
    const samples = [1, -1, 12345.6789, 0.000123456, 9.87654321e9, -0.5];
    for (const sample of samples) {
      const text = generalNumber(sample, 20);
      expect(Number(text)).toBeCloseTo(sample, 6);
    }
  });
});

describe("displayValue", () => {
  it("classifies each kind of value", () => {
    expect(displayValue(null)).toEqual({ text: "", kind: "blank" });
    expect(displayValue("hello")).toEqual({ text: "hello", kind: "text" });
    expect(displayValue(true)).toEqual({ text: "TRUE", kind: "boolean" });
    expect(displayValue(false)).toEqual({ text: "FALSE", kind: "boolean" });
    expect(displayValue(12.5)).toEqual({ text: "12.5", kind: "number" });
  });

  it("shows an error by its code", () => {
    expect(displayValue(err("#DIV/0!", "division by zero"))).toEqual({
      text: "#DIV/0!",
      kind: "error",
    });
  });

  it("passes the column width through to the number format", () => {
    expect(displayValue(1 / 3, 6).text).toBe("0.3333");
  });
});

describe("charsForWidth", () => {
  it("grows with the column", () => {
    expect(charsForWidth(104)).toBeGreaterThan(charsForWidth(60));
  });

  it("never reports less than one character", () => {
    expect(charsForWidth(4)).toBe(1);
    expect(charsForWidth(0)).toBe(1);
  });
});

describe("a spilled value in a cell", () => {
  it("shows #SPILL! as an error like any other code", () => {
    const display = displayValue(err("#SPILL!", "C2 is not empty"));
    expect(display.text).toBe("#SPILL!");
    expect(display.kind).toBe("error");
  });
});
