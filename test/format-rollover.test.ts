import { describe, expect, it } from "vitest";
import { formatWith } from "../src/format/render.js";
import {
  civilFromSerial,
  clockFromSerial,
  serialFromCivil,
} from "../src/date/serial.js";

/** A serial for a civil date plus a number of seconds into the day. */
function at(
  year: number,
  month: number,
  day: number,
  seconds: number,
): number {
  return serialFromCivil(year, month, day) + seconds / 86400;
}

function show(code: string, serial: number): string {
  return formatWith(code, serial).text;
}

const JUST_BEFORE_MIDNIGHT = 86399.6;

/** Read `2026-03-05 00:00:00` back into a serial, or null if it is not one. */
function readTimestamp(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (match === null) return null;
  const [, y, mo, d, h, mi, s] = match;
  return (
    serialFromCivil(Number(y), Number(mo), Number(d)) +
    (Number(h) * 3600 + Number(mi) * 60 + Number(s)) / 86400
  );
}

describe("the last half-second of a day", () => {
  it("carries the date when the clock rounds past midnight", () => {
    // The clock rounds to the nearest second, so 23:59:59.6 shows as 00:00:00.
    // The date it is shown beside has to be the day that clock belongs to, or
    // the timestamp names an instant twenty-four hours from the real one.
    const serial = at(2026, 3, 4, JUST_BEFORE_MIDNIGHT);
    expect(show("yyyy-mm-dd hh:mm:ss", serial)).toBe("2026-03-05 00:00:00");
    expect(show("dddd hh:mm:ss", serial)).toBe("Thursday 00:00:00");
    expect(show("d mmm yyyy h:mm:ss AM/PM", serial)).toBe("5 Mar 2026 12:00:00 AM");
  });

  it("carries over a month end, a year end and a leap day", () => {
    expect(show("yyyy-mm-dd hh:mm", at(2026, 1, 31, JUST_BEFORE_MIDNIGHT))).toBe(
      "2026-02-01 00:00",
    );
    expect(show("yyyy-mm-dd hh:mm", at(2026, 12, 31, JUST_BEFORE_MIDNIGHT))).toBe(
      "2027-01-01 00:00",
    );
    expect(show("yyyy-mm-dd hh:mm", at(2028, 2, 28, JUST_BEFORE_MIDNIGHT))).toBe(
      "2028-02-29 00:00",
    );
    expect(show("yyyy-mm-dd hh:mm", at(2026, 2, 28, JUST_BEFORE_MIDNIGHT))).toBe(
      "2026-03-01 00:00",
    );
  });

  it("does not carry when the clock does not round past midnight", () => {
    const serial = at(2026, 3, 4, 86399.4);
    expect(show("yyyy-mm-dd hh:mm:ss", serial)).toBe("2026-03-04 23:59:59");
    expect(show("dddd hh:mm:ss", serial)).toBe("Wednesday 23:59:59");
  });

  it("leaves a date-only format truncating, because an instant late on the 4th is on the 4th", () => {
    const serial = at(2026, 3, 4, JUST_BEFORE_MIDNIGHT);
    expect(show("yyyy-mm-dd", serial)).toBe("2026-03-04");
    expect(show("dddd", serial)).toBe("Wednesday");
    expect(show("mmm-yy", serial)).toBe("Mar-26");
    // ...and the worksheet's own view of the day is unchanged: a serial is on
    // the day it floors to, whatever a clock format decides to show.
    expect(civilFromSerial(serial).day).toBe(4);
  });

  it("keeps minutes and hours truncating from the rounded second", () => {
    // The convention this preserves: the rounding is to the second, and
    // coarser fields are truncated from it. 23:59:40 is still 23:59 and is
    // still on the 4th, which is what a reader of a clock expects.
    const serial = at(2026, 3, 4, 86380);
    expect(show("yyyy-mm-dd hh:mm", serial)).toBe("2026-03-04 23:59");
    expect(show("yyyy-mm-dd hh", serial)).toBe("2026-03-04 23");
  });

  it("renders an instant within half a second of itself, across the boundary", () => {
    // The property behind the fix, rather than a list of worked cases. The
    // formatter rounds to the nearest second, so the timestamp it prints must
    // be within half a second of the one in the cell. Reading the text back
    // and comparing is what makes that one claim about the date and the clock
    // together: the defect missed by 86,400 seconds while every individual
    // field looked ordinary.
    //
    // The sweep runs across three midnights and deliberately avoids landing
    // on an exact half second, where which way the tie falls is a property of
    // the float and not of the formatter.
    let checked = 0;
    for (const day of [[2026, 3, 4], [2026, 12, 31], [2028, 2, 28]] as const) {
      for (let step = 0; step <= 300; step += 1) {
        // A step of 0.137s so the sweep actually lands inside the last half
        // second, which is the only place the defect lives: a coarser stride
        // walks straight over the window and the check becomes vacuous.
        const serial = at(day[0], day[1], day[2], 86390 + step * 0.137);
        const text = show("yyyy-mm-dd hh:mm:ss", serial);
        const parsed = readTimestamp(text);
        expect(parsed, `${serial} rendered ${JSON.stringify(text)}`).not.toBeNull();
        const secondsApart = Math.abs(parsed! - serial) * 86400;
        expect(secondsApart, `at ${serial}`).toBeLessThanOrEqual(0.5 + 1e-6);
        checked += 1;
      }
    }
    expect(checked).toBe(903);
  });

  it("carries the elapsed-hour codes with the same rounding", () => {
    // `[h]` counts from the epoch rather than wrapping, so it has no date to
    // disagree with -- but it must round the same way or two fields of one
    // format would be a second apart.
    expect(show("[h]:mm:ss", 1 + 86399.6 / 86400)).toBe("48:00:00");
    expect(show("[h]:mm:ss", 1 + 86399.4 / 86400)).toBe("47:59:59");
  });
});
