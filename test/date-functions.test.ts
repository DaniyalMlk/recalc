import { afterEach, describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import { setClock } from "../src/functions/date.js";
import { serialFromCivil } from "../src/date/serial.js";
import type { Value } from "../src/engine/value.js";

function sheet(cells: Record<string, string | number | boolean> = {}) {
  const book = new Workbook();
  book.setCells(cells);
  return {
    eval(formula: string): Value {
      book.setCell("Z100", formula);
      return book.getValue("Z100");
    },
    display(formula: string): string {
      book.setCell("Z100", formula);
      return book.getDisplay("Z100");
    },
    num(formula: string): number {
      const value = this.eval(formula);
      if (typeof value !== "number") {
        throw new Error(`${formula} produced ${JSON.stringify(value)}`);
      }
      return value;
    },
  };
}

const plain = sheet();
const s = (y: number, m: number, d: number) => serialFromCivil(y, m, d);

describe("DATE, DATEVALUE and TIME", () => {
  it("builds serials from calendar parts", () => {
    expect(plain.num("=DATE(2026,1,1)")).toBe(46023);
    expect(plain.num("=DATE(2024,2,29)")).toBe(s(2024, 2, 29));
    expect(plain.num("=DATE(1900,1,1)")).toBe(1);
  });

  it("normalises parts outside their range", () => {
    expect(plain.num("=DATE(2026,13,1)")).toBe(plain.num("=DATE(2027,1,1)"));
    expect(plain.num("=DATE(2026,0,15)")).toBe(plain.num("=DATE(2025,12,15)"));
    expect(plain.num("=DATE(2026,3,0)")).toBe(plain.num("=DATE(2026,2,28)"));
    expect(plain.num("=DATE(2026,2,30)")).toBe(plain.num("=DATE(2026,3,2)"));
  });

  it("refuses dates outside the system", () => {
    expect(plain.display("=DATE(1899,12,29)")).toBe("#NUM!");
    expect(plain.display("=DATE(10000,1,1)")).toBe("#NUM!");
  });

  it("parses ISO dates, and rejects impossible ones", () => {
    expect(plain.num('=DATEVALUE("2026-01-01")')).toBe(46023);
    expect(plain.num('=DATEVALUE("2024-2-29")')).toBe(s(2024, 2, 29));
    expect(plain.num('=DATEVALUE("2026-03-04 09:30")')).toBe(s(2026, 3, 4));
    expect(plain.display('=DATEVALUE("2026-02-30")')).toBe("#VALUE!");
    expect(plain.display('=DATEVALUE("2026-13-01")')).toBe("#VALUE!");
    expect(plain.display('=DATEVALUE("not a date")')).toBe("#VALUE!");
  });

  it("builds and reads times", () => {
    expect(plain.num("=TIME(12,0,0)")).toBeCloseTo(0.5, 12);
    expect(plain.num("=TIME(6,30,0)")).toBeCloseTo(6.5 / 24, 12);
    expect(plain.num("=TIME(25,0,0)")).toBeCloseTo(1 / 24, 12);
    expect(plain.display("=TIME(-1,0,0)")).toBe("#NUM!");
    expect(plain.num('=TIMEVALUE("18:45")')).toBeCloseTo(18.75 / 24, 12);
    expect(plain.num('=TIMEVALUE("2026-03-04T06:00:00")')).toBeCloseTo(0.25, 12);
    expect(plain.display('=TIMEVALUE("teatime")')).toBe("#VALUE!");
  });
});

describe("TODAY and NOW", () => {
  const original = setClock({ now: () => Date.UTC(2026, 2, 4, 6, 0, 0) });
  afterEach(() => {
    setClock({ now: () => Date.UTC(2026, 2, 4, 6, 0, 0) });
  });

  it("reads the clock the host supplies", () => {
    expect(plain.num("=TODAY()")).toBe(s(2026, 3, 4));
    expect(plain.num("=NOW()")).toBeCloseTo(s(2026, 3, 4) + 0.25, 9);
    expect(plain.num("=NOW()-TODAY()")).toBeCloseTo(0.25, 9);
  });

  it("moves when the clock moves", () => {
    setClock({ now: () => Date.UTC(2030, 0, 1) });
    expect(plain.num("=TODAY()")).toBe(s(2030, 1, 1));
    setClock(original);
    // Restoring the real clock still yields a plausible modern serial.
    expect(plain.num("=TODAY()")).toBeGreaterThan(s(2020, 1, 1));
  });
});

describe("date components", () => {
  const book = sheet({ A1: "=DATE(2026,3,4)", A2: "=DATE(2026,3,4)+0.53125" });

  it("takes a date apart", () => {
    expect(book.num("=YEAR(A1)")).toBe(2026);
    expect(book.num("=MONTH(A1)")).toBe(3);
    expect(book.num("=DAY(A1)")).toBe(4);
  });

  it("takes a time apart", () => {
    // 0.53125 of a day is 12:45:00.
    expect(book.num("=HOUR(A2)")).toBe(12);
    expect(book.num("=MINUTE(A2)")).toBe(45);
    expect(book.num("=SECOND(A2)")).toBe(0);
  });

  it("numbers weekdays under each scheme", () => {
    // 2026-03-04 is a Wednesday.
    expect(book.num("=WEEKDAY(A1)")).toBe(4);
    expect(book.num("=WEEKDAY(A1,1)")).toBe(4);
    expect(book.num("=WEEKDAY(A1,2)")).toBe(3);
    expect(book.num("=WEEKDAY(A1,3)")).toBe(2);
    expect(book.display("=WEEKDAY(A1,7)")).toBe("#NUM!");
  });

  it("numbers weeks from the week holding 1 January", () => {
    // 2026-01-01 is a Thursday, so the Sunday-start week 1 is short.
    expect(plain.num("=WEEKNUM(DATE(2026,1,1))")).toBe(1);
    expect(plain.num("=WEEKNUM(DATE(2026,1,3))")).toBe(1);
    expect(plain.num("=WEEKNUM(DATE(2026,1,4))")).toBe(2);
    // Monday-start pushes the boundary two days later.
    expect(plain.num("=WEEKNUM(DATE(2026,1,4),2)")).toBe(1);
    expect(plain.num("=WEEKNUM(DATE(2026,1,5),2)")).toBe(2);
    expect(plain.num("=WEEKNUM(DATE(2026,12,31))")).toBe(53);
    expect(plain.display("=WEEKNUM(DATE(2026,1,1),9)")).toBe("#NUM!");
  });

  it("rejects a negative serial", () => {
    expect(plain.display("=YEAR(-1)")).toBe("#NUM!");
  });
});

describe("EDATE and EOMONTH", () => {
  it("steps whole months, clamping onto short months", () => {
    expect(plain.num("=EDATE(DATE(2026,1,31),1)")).toBe(s(2026, 2, 28));
    expect(plain.num("=EDATE(DATE(2024,1,31),1)")).toBe(s(2024, 2, 29));
    expect(plain.num("=EDATE(DATE(2026,3,31),-1)")).toBe(s(2026, 2, 28));
    expect(plain.num("=EDATE(DATE(2026,6,15),18)")).toBe(s(2027, 12, 15));
  });

  it("lands on month ends", () => {
    expect(plain.num("=EOMONTH(DATE(2026,3,4),0)")).toBe(s(2026, 3, 31));
    expect(plain.num("=EOMONTH(DATE(2026,3,4),-1)")).toBe(s(2026, 2, 28));
    expect(plain.num("=EOMONTH(DATE(2024,1,15),1)")).toBe(s(2024, 2, 29));
    expect(plain.num("=EOMONTH(DATE(2026,12,1),1)")).toBe(s(2027, 1, 31));
  });

  it("generates a month-end schedule that stays on month ends", () => {
    const schedule = sheet({ A1: "=DATE(2026,1,31)" });
    for (let i = 1; i <= 12; i++) {
      const serial = schedule.num(`=EOMONTH(A1,${i})`);
      expect(schedule.num(`=DAY(${serial})`)).toBe(
        schedule.num(`=DAY(EOMONTH(${serial},0))`),
      );
    }
  });
});

describe("DAYS, DAYS360 and DATEDIF", () => {
  it("counts calendar days, end minus start", () => {
    expect(plain.num("=DAYS(DATE(2027,1,1),DATE(2026,1,1))")).toBe(365);
    expect(plain.num("=DAYS(DATE(2026,1,1),DATE(2027,1,1))")).toBe(-365);
  });

  it("counts on a 360-day year, US and European", () => {
    expect(plain.num("=DAYS360(DATE(2007,1,15),DATE(2007,1,31))")).toBe(16);
    expect(plain.num("=DAYS360(DATE(2007,1,15),DATE(2007,1,31),TRUE)")).toBe(15);
    expect(plain.num("=DAYS360(DATE(2007,2,28),DATE(2007,3,31))")).toBe(33);
    expect(plain.num("=DAYS360(DATE(2007,2,28),DATE(2007,3,31),TRUE)")).toBe(32);
  });

  it("splits an elapsed period into units", () => {
    const from = "DATE(2020,3,15)";
    const to = "DATE(2026,7,4)";
    expect(plain.num(`=DATEDIF(${from},${to},"Y")`)).toBe(6);
    expect(plain.num(`=DATEDIF(${from},${to},"M")`)).toBe(75);
    expect(plain.num(`=DATEDIF(${from},${to},"D")`)).toBe(2302);
    expect(plain.num(`=DATEDIF(${from},${to},"YM")`)).toBe(3);
    expect(plain.num(`=DATEDIF(${from},${to},"MD")`)).toBe(19);
    expect(plain.num(`=DATEDIF(${from},${to},"YD")`)).toBe(111);
  });

  it("reassembles the whole period from its parts", () => {
    const from = "DATE(2020,3,15)";
    const to = "DATE(2026,7,4)";
    const years = plain.num(`=DATEDIF(${from},${to},"Y")`);
    const months = plain.num(`=DATEDIF(${from},${to},"YM")`);
    const days = plain.num(`=DATEDIF(${from},${to},"MD")`);
    expect(plain.num(`=DATEDIF(${from},${to},"M")`)).toBe(years * 12 + months);
    // Stepping the whole months then the leftover days lands on the end date.
    const stepped = plain.num(`=EDATE(${from},${years * 12 + months})+${days}`);
    expect(stepped).toBe(plain.num(`=${to}`));
  });

  it("borrows across a short month for MD", () => {
    // 31 January to 1 March: the borrowed month is February.
    expect(plain.num('=DATEDIF(DATE(2026,1,31),DATE(2026,3,1),"MD")')).toBe(1);
    expect(plain.num('=DATEDIF(DATE(2024,1,31),DATE(2024,3,1),"MD")')).toBe(1);
  });

  it("refuses a reversed period and an unknown unit", () => {
    expect(plain.display('=DATEDIF(DATE(2026,2,1),DATE(2026,1,1),"D")')).toBe(
      "#NUM!",
    );
    expect(plain.display('=DATEDIF(DATE(2026,1,1),DATE(2026,2,1),"Q")')).toBe(
      "#NUM!",
    );
  });
});

describe("YEARFRAC as a function", () => {
  it("reproduces the published example on every basis", () => {
    const from = "DATE(2012,1,1)";
    const to = "DATE(2012,7,30)";
    expect(plain.num(`=YEARFRAC(${from},${to})`)).toBeCloseTo(0.58055556, 8);
    expect(plain.num(`=YEARFRAC(${from},${to},1)`)).toBeCloseTo(0.57650273, 8);
    expect(plain.num(`=YEARFRAC(${from},${to},2)`)).toBeCloseTo(0.58611111, 8);
    expect(plain.num(`=YEARFRAC(${from},${to},3)`)).toBeCloseTo(0.57808219, 8);
    expect(plain.num(`=YEARFRAC(${from},${to},4)`)).toBeCloseTo(0.58055556, 8);
  });

  it("rejects a basis it does not know", () => {
    expect(plain.display("=YEARFRAC(DATE(2026,1,1),DATE(2026,7,1),5)")).toBe(
      "#NUM!",
    );
  });
});

describe("working days", () => {
  // 2026-03-02 is a Monday.
  const monday = "DATE(2026,3,2)";

  it("counts a plain working week", () => {
    expect(plain.num(`=NETWORKDAYS(${monday},${monday}+4)`)).toBe(5);
    expect(plain.num(`=NETWORKDAYS(${monday},${monday}+6)`)).toBe(5);
    expect(plain.num(`=NETWORKDAYS(${monday},${monday}+7)`)).toBe(6);
    expect(plain.num(`=NETWORKDAYS(${monday},${monday})`)).toBe(1);
  });

  it("signs the count when the dates are the wrong way round", () => {
    expect(plain.num(`=NETWORKDAYS(${monday}+4,${monday})`)).toBe(-5);
  });

  it("drops holidays that fall on working days only once", () => {
    const book = sheet({
      A1: "=DATE(2026,3,4)",
      A2: "=DATE(2026,3,7)",
      A3: "=DATE(2026,3,4)",
      A4: "a note",
    });
    // A1 is a Wednesday, A2 a Saturday, A3 a repeat of A1, A4 not a date.
    expect(book.num(`=NETWORKDAYS(${monday},${monday}+4,A1:A4)`)).toBe(4);
  });

  it("steps forward and back over weekends", () => {
    expect(plain.num(`=WORKDAY(${monday},4)`)).toBe(plain.num(`=${monday}+4`));
    expect(plain.num(`=WORKDAY(${monday},5)`)).toBe(plain.num(`=${monday}+7`));
    expect(plain.num(`=WORKDAY(${monday},-1)`)).toBe(plain.num(`=${monday}-3`));
    expect(plain.num(`=WORKDAY(${monday},0)`)).toBe(plain.num(`=${monday}`));
  });

  it("skips a holiday when stepping", () => {
    const book = sheet({ A1: "=DATE(2026,3,4)" });
    // Wednesday is out, so four working days from Monday reaches Friday+1.
    expect(book.num(`=WORKDAY(${monday},4,A1:A1)`)).toBe(
      book.num(`=${monday}+7`),
    );
  });

  it("agrees with itself: stepping n working days spans n+1 working days", () => {
    for (let n = 1; n <= 15; n++) {
      const landed = plain.num(`=WORKDAY(${monday},${n})`);
      expect(plain.num(`=NETWORKDAYS(${monday},${landed})`)).toBe(n + 1);
    }
  });
});
