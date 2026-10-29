import { describe, expect, it } from "vitest";
import {
  FormatCodeError,
  MAX_SUB_SECOND_DIGITS,
  parseFormatCode,
} from "../src/format/code.js";
import { formatWith } from "../src/format/render.js";
import { MAX_SERIAL, serialFromCivil } from "../src/date/serial.js";

function show(code: string, serial: number): string {
  return formatWith(code, serial).text;
}

/** A serial for 2026-03-04 plus a number of seconds into the day. */
function at(seconds: number): number {
  return serialFromCivil(2026, 3, 4) + seconds / 86400;
}

function digits(code: string): number {
  const section = parseFormatCode(code).sections[0];
  if (section === undefined) throw new Error(`${code} has no first section`);
  return section.subSecondDigits;
}

describe("compiling a sub-second code", () => {
  it("reads the digit places behind a seconds field", () => {
    expect(digits("hh:mm:ss.0")).toBe(1);
    expect(digits("hh:mm:ss.00")).toBe(2);
    expect(digits("hh:mm:ss.000")).toBe(3);
    expect(digits("[s].00")).toBe(2);
    expect(digits("hh:mm:ss")).toBe(0);
  });

  it("only reads digit places that sit directly behind a seconds field", () => {
    // A `.` anywhere else in a date section is not sub-second precision and
    // is not quietly treated as it: both of these are refused, by the rule
    // that a date section cannot also hold digit positions. (What a date
    // section does with a lone `.` is a separate gap and not touched here.)
    expect(() => parseFormatCode("hh:mm.00")).toThrow(FormatCodeError);
    expect(() => parseFormatCode("hh:mm:ss .00")).toThrow(FormatCodeError);
    // A point with nothing behind it is not precision either, and is left
    // for the main loop rather than eaten here -- which is what keeps a
    // second point in the same section refused instead of quietly accepted.
    expect(digits("hh:mm:ss.")).toBe(0);
    expect(digits("hh:mm:ss.mm")).toBe(0);
    expect(() => parseFormatCode("ss..00")).toThrow(/one decimal point/);
    expect(() => parseFormatCode("hh:mm:ss.d.m")).toThrow(/one decimal point/);
  });

  it("refuses more digits than a serial can carry", () => {
    expect(() => parseFormatCode("hh:mm:ss.0000")).toThrow(
      /cannot carry more than 3/,
    );
    try {
      parseFormatCode("hh:mm:ss.0000");
      throw new Error("expected a parse failure");
    } catch (error) {
      expect(error).toBeInstanceOf(FormatCodeError);
      // Pointing at the first digit it will not accept, rather than at the
      // point, so an editor can underline the offending character.
      expect((error as FormatCodeError).offset).toBe(12);
    }
  });

  it("refuses two sub-second fields in one section", () => {
    expect(() => parseFormatCode("ss.00 ss.00")).toThrow(/twice/);
  });

  it("names a limit the serial actually has, and a tight one", () => {
    // The limit is measured, so this is the measurement: one unit in the
    // last place of a serial at the furthest date the system represents,
    // expressed in seconds.
    const step = Math.pow(2, Math.floor(Math.log2(MAX_SERIAL)) - 52) * 86400;
    expect(step).toBeCloseTo(4.02e-5, 7);

    // A digit is worth printing when the representation step is well under
    // its unit -- a tenth of it, say. The smallest unit allowed clears that
    // by a factor of two and a half, and the next one down fails it by four,
    // which is what makes three the boundary rather than a round number.
    const smallestAllowed = 10 ** -MAX_SUB_SECOND_DIGITS;
    const nextOneDown = 10 ** -(MAX_SUB_SECOND_DIGITS + 1);
    expect(step).toBeLessThan(smallestAllowed / 10);
    expect(step).toBeGreaterThan(nextOneDown / 10);
  });

  it("confirms a thousandth survives a round trip at the furthest date", () => {
    const base = Math.floor(MAX_SERIAL) - 1;
    const moved = base + 0.001 / 86400;
    expect(moved).not.toBe(base);
    // Recovered to within 1% of itself, which is the thing the third digit
    // needs to be worth printing.
    const recovered = (moved - base) * 86400;
    expect(Math.abs(recovered - 0.001) / 0.001).toBeLessThan(0.01);

    // And the fourth digit would not be: at that date the step is 40% of a
    // ten-thousandth, so the digit would carry the float's noise.
    const finer = base + 0.0001 / 86400;
    expect(Math.abs((finer - base) * 86400 - 0.0001) / 0.0001).toBeGreaterThan(0.1);
  });
});

describe("rendering a sub-second code", () => {
  it("shows the digits the code asked for", () => {
    expect(show("hh:mm:ss.00", at(45296.25))).toBe("12:34:56.25");
    expect(show("hh:mm:ss.000", at(45296.1239))).toBe("12:34:56.124");
    expect(show("hh:mm:ss", at(45296.25))).toBe("12:34:56");
  });

  it("rounds at the precision shown, not at the second", () => {
    // The same instant at three precisions. Each one rounds its own last
    // digit, so the answers differ rather than one being a truncation of
    // another -- which is the whole claim.
    const serial = at(45296.96);
    expect(show("hh:mm:ss.000", serial)).toBe("12:34:56.960");
    expect(show("hh:mm:ss.0", serial)).toBe("12:34:57.0");
    expect(show("hh:mm:ss", serial)).toBe("12:34:57");
  });

  it("does not let a sub-second remainder round up into the seconds field", () => {
    // The trap: handing the unrounded serial to the clock splitter rounds
    // .75 up and prints 56.75 as 57.75.
    expect(show("hh:mm:ss.00", at(45296.75))).toBe("12:34:56.75");
    expect(show("hh:mm:ss.0", at(45296.9))).toBe("12:34:56.9");
    expect(show("hh:mm:ss.000", at(45296.999))).toBe("12:34:56.999");
  });

  it("carries the date at the finer precision too", () => {
    // A hundredth before midnight: under `ss.00` the clock does not reach
    // the next day and under `ss` it does, and the date agrees with its own
    // format both times.
    expect(show("yyyy-mm-dd hh:mm:ss.00", at(86399.994))).toBe(
      "2026-03-04 23:59:59.99",
    );
    expect(show("yyyy-mm-dd hh:mm:ss.00", at(86399.996))).toBe(
      "2026-03-05 00:00:00.00",
    );
    expect(show("yyyy-mm-dd hh:mm:ss", at(86399.994))).toBe("2026-03-05 00:00:00");
  });

  it("keeps the whole-second behaviour exactly as it was", () => {
    expect(show("hh:mm:ss", at(45296.4))).toBe("12:34:56");
    expect(show("hh:mm:ss", at(45296.6))).toBe("12:34:57");
    expect(show("yyyy-mm-dd hh:mm", at(86380))).toBe("2026-03-04 23:59");
  });

  it("works on the elapsed codes", () => {
    expect(show("[s].00", 1.5)).toBe("129600.00");
    expect(show("[h]:mm:ss.0", 1 + 45296.25 / 86400)).toBe("36:34:56.3");
  });

  it("reads back to within half a unit of the precision shown", () => {
    // The property: whatever digits come out, the timestamp they spell is
    // within half of its own last place of the instant in the cell. A field
    // that rounded on a different count than its neighbours breaks this.
    let checked = 0;
    for (const places of [0, 1, 2, 3]) {
      const code = places === 0 ? "hh:mm:ss" : `hh:mm:ss.${"0".repeat(places)}`;
      const unit = 10 ** -places;
      for (let step = 0; step <= 300; step += 1) {
        const seconds = 45000 + step * 1.0417;
        const text = show(code, at(seconds));
        const parsed = readClock(text);
        expect(parsed, `${code} on ${seconds}`).not.toBeNull();
        expect(Math.abs(parsed! - seconds), `${code} on ${seconds}`).toBeLessThanOrEqual(
          unit / 2 + 1e-6,
        );
        checked += 1;
      }
    }
    expect(checked).toBe(4 * 301);
  });
});

/** Read `12:34:56.25` back into seconds into the day. */
function readClock(text: string): number | null {
  const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(text);
  if (match === null) return null;
  const [, h, m, s, frac] = match;
  const whole = Number(h) * 3600 + Number(m) * 60 + Number(s);
  return whole + (frac === undefined ? 0 : Number(`0.${frac}`));
}
