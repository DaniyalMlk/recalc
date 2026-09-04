import { describe, expect, it } from "vitest";
import { formatWith } from "../src/format/render.js";
import { serialFromCivil, timeFraction } from "../src/date/serial.js";

const at = (
  y: number,
  m: number,
  d: number,
  hh = 0,
  mm = 0,
  ss = 0,
): number => serialFromCivil(y, m, d) + timeFraction(hh, mm, ss);

const show = (code: string, value: number) => formatWith(code, value).text;

describe("date codes", () => {
  const wednesday = at(2026, 3, 4);

  it("lays out the common date orders", () => {
    expect(show("yyyy-mm-dd", wednesday)).toBe("2026-03-04");
    expect(show("dd/mm/yyyy", wednesday)).toBe("04/03/2026");
    expect(show("mm/dd/yy", wednesday)).toBe("03/04/26");
    expect(show("m/d/yyyy", wednesday)).toBe("3/4/2026");
  });

  it("widens month and day into names", () => {
    expect(show("mmm", wednesday)).toBe("Mar");
    expect(show("mmmm", wednesday)).toBe("March");
    expect(show("mmmmm", wednesday)).toBe("M");
    expect(show("ddd", wednesday)).toBe("Wed");
    expect(show("dddd", wednesday)).toBe("Wednesday");
    expect(show("dddd, d mmmm yyyy", wednesday)).toBe("Wednesday, 4 March 2026");
  });

  it("names the right weekday for dates a spreadsheet would show", () => {
    expect(show("dddd", at(2026, 1, 1))).toBe("Thursday");
    expect(show("dddd", at(2024, 2, 29))).toBe("Thursday");
    expect(show("dddd", at(2000, 1, 1))).toBe("Saturday");
  });

  it("takes two-digit years from the century", () => {
    expect(show("yy", at(2007, 6, 1))).toBe("07");
    expect(show("yy", at(1998, 6, 1))).toBe("98");
    expect(show("mmm-yy", at(2026, 3, 4))).toBe("Mar-26");
  });
});

describe("time codes", () => {
  const afternoon = at(2026, 3, 4, 13, 45, 9);

  it("lays out a 24-hour clock", () => {
    expect(show("hh:mm", afternoon)).toBe("13:45");
    expect(show("hh:mm:ss", afternoon)).toBe("13:45:09");
    expect(show("h:mm", afternoon)).toBe("13:45");
    expect(show("h:mm", at(2026, 3, 4, 6, 5, 0))).toBe("6:05");
  });

  it("switches to a 12-hour clock when a meridiem marker is present", () => {
    expect(show("h:mm AM/PM", afternoon)).toBe("1:45 PM");
    expect(show("h:mm A/P", afternoon)).toBe("1:45 P");
    expect(show("h:mm AM/PM", at(2026, 3, 4, 0, 30))).toBe("12:30 AM");
    expect(show("h:mm AM/PM", at(2026, 3, 4, 12, 30))).toBe("12:30 PM");
    expect(show("h:mm AM/PM", at(2026, 3, 4, 9, 5))).toBe("9:05 AM");
  });

  it("combines a date and a time in one code", () => {
    expect(show("yyyy-mm-dd hh:mm:ss", afternoon)).toBe("2026-03-04 13:45:09");
  });

  it("reads a minute correctly on both sides of an hour", () => {
    expect(show("mm:ss", at(2026, 3, 4, 1, 2, 3))).toBe("02:03");
    expect(show("hh:mm", at(2026, 3, 4, 1, 2, 3))).toBe("01:02");
    // Standing alone, m is still a month.
    expect(show("mm", at(2026, 3, 4, 1, 2, 3))).toBe("03");
  });
});

describe("elapsed codes", () => {
  it("does not wrap at a day", () => {
    expect(show("[h]:mm", 1.5)).toBe("36:00");
    expect(show("[h]:mm", 0.25)).toBe("6:00");
    expect(show("[hh]:mm", 0.25)).toBe("06:00");
  });

  it("totals minutes and seconds", () => {
    expect(show("[m]", 1.5)).toBe("2160");
    expect(show("[s]", timeFraction(0, 1, 30))).toBe("90");
    expect(show("[m]:ss", timeFraction(1, 30, 15))).toBe("90:15");
  });

  it("counts a duration built by subtracting two times", () => {
    const start = at(2026, 3, 4, 22, 30);
    const end = at(2026, 3, 5, 6, 15);
    expect(show("[h]:mm", end - start)).toBe("7:45");
  });
});

describe("what a date code will not do", () => {
  it("shows a value it cannot read as a date unformatted", () => {
    expect(show("yyyy-mm-dd", -5)).toBe("-5");
    expect(show("[h]:mm", -0.5)).toBe("-0.5");
  });

  it("leaves text, booleans and blanks alone", () => {
    expect(formatWith("yyyy-mm-dd", "not a date").text).toBe("not a date");
    expect(formatWith("yyyy-mm-dd", true).text).toBe("TRUE");
    expect(formatWith("yyyy-mm-dd", null).text).toBe("");
  });

  it("still honours a section colour", () => {
    expect(formatWith("[Red]yyyy-mm-dd", at(2026, 3, 4))).toEqual({
      text: "2026-03-04",
      colour: "red",
    });
  });
});

describe("rounding inside a date code", () => {
  it("never lets the fields disagree with each other", () => {
    // A serial a hair under midnight must not print as 24:00 or roll the date.
    const almost = serialFromCivil(2026, 3, 4) + 1 - 1e-9;
    expect(show("yyyy-mm-dd hh:mm:ss", almost)).toBe("2026-03-04 00:00:00");
  });

  it("rounds a time arrived at by arithmetic to the second it means", () => {
    const noon = serialFromCivil(2026, 3, 4) + 1 / 3 + 1 / 6;
    expect(show("hh:mm:ss", noon)).toBe("12:00:00");
  });
});
