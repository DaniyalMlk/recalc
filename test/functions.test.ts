import { describe, expect, it } from "vitest";
import { registeredFunctionNames } from "../src/functions/index.js";
import { Workbook } from "../src/engine/workbook.js";
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
  };
}

const plain = sheet();
const ev = (formula: string) => plain.eval(formula);
const disp = (formula: string) => plain.display(formula);

describe("registry", () => {
  it("registers every pack", () => {
    const names = registeredFunctionNames();
    for (const name of ["SUM", "AVERAGE", "IF", "LEFT", "VLOOKUP", "ISBLANK"]) {
      expect(names, name).toContain(name);
    }
  });

  it("has no duplicate registrations", () => {
    const names = registeredFunctionNames();
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("SUM and the aggregate rule", () => {
  const data = sheet({ A1: 1, A2: "text", A3: 3, A4: true, A5: 5 });

  it("adds direct arguments", () => {
    expect(ev("=SUM(1,2,3)")).toBe(6);
  });

  it("ignores text and booleans found inside a range", () => {
    expect(data.eval("=SUM(A1:A5)")).toBe(9);
  });

  it("coerces the same values when passed directly", () => {
    expect(ev('=SUM(TRUE,"3")')).toBe(4);
  });

  it("mixes ranges and scalars", () => {
    expect(data.eval("=SUM(A1:A5,10)")).toBe(19);
  });

  it("sums an empty range to zero", () => {
    expect(ev("=SUM(Q1:Q9)")).toBe(0);
  });
});

describe("math", () => {
  const cases: Array<[string, number]> = [
    ["=ABS(-3)", 3],
    ["=SIGN(-2)", -1],
    ["=SQRT(16)", 4],
    ["=POWER(2,8)", 256],
    ["=EXP(0)", 1],
    ["=LN(1)", 0],
    ["=LOG10(1000)", 3],
    ["=LOG(8,2)", 3],
    ["=LOG(100)", 2],
    ["=INT(-1.5)", -2],
    ["=TRUNC(-1.5)", -1],
    ["=PRODUCT(2,3,4)", 24],
    ["=CEILING(2.1,1)", 3],
    ["=FLOOR(2.9,1)", 2],
    ["=CEILING(7,5)", 10],
  ];

  it.each(cases)("%s is %d", (formula, expected) => {
    expect(ev(formula)).toBeCloseTo(expected, 10);
  });

  it("has PI", () => {
    expect(ev("=PI()")).toBeCloseTo(Math.PI, 12);
  });

  it("rounds half away from zero", () => {
    expect(ev("=ROUND(2.5,0)")).toBe(3);
    expect(ev("=ROUND(-2.5,0)")).toBe(-3);
    expect(ev("=ROUND(1.5,0)")).toBe(2);
  });

  it("rounds a value the binary representation would get wrong", () => {
    // 2.675 is stored as 2.67499999..., so a naive scale-and-round gives 2.67.
    expect(ev("=ROUND(2.675,2)")).toBe(2.68);
    expect(ev("=ROUND(1.005,2)")).toBe(1.01);
  });

  it("rounds to negative digit positions", () => {
    expect(ev("=ROUND(1234,-2)")).toBe(1200);
    expect(ev("=ROUND(1250,-2)")).toBe(1300);
  });

  it("rounds up and down away from and toward zero", () => {
    expect(ev("=ROUNDUP(1.1,0)")).toBe(2);
    expect(ev("=ROUNDUP(-1.1,0)")).toBe(-2);
    expect(ev("=ROUNDDOWN(1.9,0)")).toBe(1);
    expect(ev("=ROUNDDOWN(-1.9,0)")).toBe(-1);
  });

  it("gives MOD the divisor's sign, unlike the JavaScript remainder", () => {
    expect(ev("=MOD(-3,2)")).toBe(1);
    expect(ev("=MOD(3,-2)")).toBe(-1);
    expect(ev("=MOD(7,3)")).toBe(1);
    expect(disp("=MOD(1,0)")).toBe("#DIV/0!");
  });

  it("reports domain errors", () => {
    expect(disp("=SQRT(-1)")).toBe("#NUM!");
    expect(disp("=LN(0)")).toBe("#NUM!");
    expect(disp("=LOG10(-1)")).toBe("#NUM!");
    expect(disp("=LOG(8,1)")).toBe("#NUM!");
    expect(disp("=POWER(0,-1)")).toBe("#DIV/0!");
  });

  it("computes SUMPRODUCT over equal-length ranges", () => {
    const book = sheet({
      A1: 2,
      A2: 3,
      A3: 4,
      B1: 10,
      B2: 100,
      B3: 1000,
    });
    expect(book.eval("=SUMPRODUCT(A1:A3,B1:B3)")).toBe(2 * 10 + 3 * 100 + 4 * 1000);
  });

  it("rejects mismatched SUMPRODUCT shapes", () => {
    const book = sheet({ A1: 1, A2: 2, B1: 1 });
    expect(book.display("=SUMPRODUCT(A1:A2,B1:B1)")).toBe("#NUM!");
  });
});

describe("statistics", () => {
  const data = sheet({
    A1: 2,
    A2: 4,
    A3: 4,
    A4: 4,
    A5: 5,
    A6: 5,
    A7: 7,
    A8: 9,
  });

  it("averages", () => {
    expect(data.eval("=AVERAGE(A1:A8)")).toBe(5);
  });

  it("reports an average with nothing to average", () => {
    expect(disp("=AVERAGE(Q1:Q9)")).toBe("#DIV/0!");
  });

  it("computes the population and sample deviations of a known set", () => {
    // The classic worked example: population sd 2, sample sd ~2.13809.
    expect(data.eval("=STDEV.P(A1:A8)")).toBeCloseTo(2, 12);
    expect(data.eval("=VAR.P(A1:A8)")).toBeCloseTo(4, 12);
    expect(data.eval("=STDEV.S(A1:A8)")).toBeCloseTo(2.138089935299395, 10);
    expect(data.eval("=VAR.S(A1:A8)")).toBeCloseTo(32 / 7, 12);
  });

  it("stays accurate when the values are large and the spread is small", () => {
    // A one-pass E[x^2]-E[x]^2 variance loses all precision here and can even
    // come out negative; the two-pass form does not.
    const big = sheet({ A1: 100000001, A2: 100000002, A3: 100000003 });
    expect(big.eval("=VAR.S(A1:A3)")).toBeCloseTo(1, 9);
    expect(big.eval("=STDEV.P(A1:A3)")).toBeCloseTo(Math.sqrt(2 / 3), 9);
  });

  it("counts by type", () => {
    const mixed = sheet({ A1: 1, A2: "x", A3: true, A5: 5 });
    expect(mixed.eval("=COUNT(A1:A5)")).toBe(2);
    expect(mixed.eval("=COUNTA(A1:A5)")).toBe(4);
    expect(mixed.eval("=COUNTBLANK(A1:A5)")).toBe(1);
  });

  it("finds extremes", () => {
    expect(data.eval("=MIN(A1:A8)")).toBe(2);
    expect(data.eval("=MAX(A1:A8)")).toBe(9);
    expect(ev("=MIN(Q1:Q9)")).toBe(0);
  });

  it("takes the median of odd and even counts", () => {
    expect(data.eval("=MEDIAN(A1:A8)")).toBe(4.5);
    expect(ev("=MEDIAN(1,3,2)")).toBe(2);
  });

  it("picks order statistics", () => {
    expect(data.eval("=LARGE(A1:A8,1)")).toBe(9);
    expect(data.eval("=LARGE(A1:A8,2)")).toBe(7);
    expect(data.eval("=SMALL(A1:A8,1)")).toBe(2);
    expect(data.display("=LARGE(A1:A8,99)")).toBe("#NUM!");
  });

  it("counts matches", () => {
    expect(data.eval("=COUNTIF(A1:A8,4)")).toBe(3);
    expect(data.eval("=COUNTIF(A1:A8,99)")).toBe(0);
  });
});

describe("logical", () => {
  it("branches", () => {
    expect(ev('=IF(1>0,"yes","no")')).toBe("yes");
    expect(ev('=IF(1<0,"yes","no")')).toBe("no");
    expect(ev("=IF(1<0,1)")).toBe(false);
  });

  it("combines", () => {
    expect(ev("=AND(TRUE,TRUE)")).toBe(true);
    expect(ev("=AND(TRUE,FALSE)")).toBe(false);
    expect(ev("=OR(FALSE,TRUE)")).toBe(true);
    expect(ev("=XOR(TRUE,TRUE)")).toBe(false);
    expect(ev("=XOR(TRUE,TRUE,TRUE)")).toBe(true);
    expect(ev("=NOT(FALSE)")).toBe(true);
    expect(ev("=TRUE()")).toBe(true);
    expect(ev("=FALSE()")).toBe(false);
  });

  it("skips blanks and text inside a range when combining", () => {
    const mixed = sheet({ A1: true, A2: "note", A4: true });
    expect(mixed.eval("=AND(A1:A4)")).toBe(true);
  });

  it("catches errors", () => {
    expect(ev('=IFERROR(1/0,"fallback")')).toBe("fallback");
    expect(ev("=IFERROR(2,0)")).toBe(2);
    expect(ev('=IFNA(NA(),"gone")')).toBe("gone");
    expect(disp("=IFNA(1/0,0)")).toBe("#DIV/0!");
  });

  it("selects the first true case", () => {
    expect(ev('=IFS(FALSE,"a",TRUE,"b")')).toBe("b");
    expect(disp('=IFS(FALSE,"a",FALSE,"b")')).toBe("#N/A");
  });

  it("switches on a value with a default", () => {
    expect(ev('=SWITCH(2,1,"one",2,"two","other")')).toBe("two");
    expect(ev('=SWITCH(9,1,"one",2,"two","other")')).toBe("other");
    expect(disp('=SWITCH(9,1,"one",2,"two")')).toBe("#N/A");
  });
});

describe("text", () => {
  const cases: Array<[string, string | number | boolean]> = [
    ['=CONCAT("a","b","c")', "abc"],
    ['=CONCATENATE("a",1,TRUE)', "a1TRUE"],
    ['=LEN("hello")', 5],
    ['=LEFT("spreadsheet",6)', "spread"],
    ['=RIGHT("spreadsheet",5)', "sheet"],
    ['=LEFT("abc")', "a"],
    ['=MID("spreadsheet",7,5)', "sheet"],
    ['=UPPER("aBc")', "ABC"],
    ['=LOWER("aBc")', "abc"],
    ['=TRIM("  a   b  ")', "a b"],
    ['=PROPER("hello wide world")', "Hello Wide World"],
    ['=REPT("ab",3)', "ababab"],
    ['=FIND("d","abcdcd")', 4],
    ['=SEARCH("D","abcdcd")', 4],
    ['=SUBSTITUTE("a-b-c","-","+")', "a+b+c"],
    ['=SUBSTITUTE("a-b-c","-","+",2)', "a-b+c"],
    ['=EXACT("a","A")', false],
    ['=EXACT("a","a")', true],
    ['=VALUE("1.5")', 1.5],
    ['=T("x")', "x"],
    ["=T(1)", ""],
  ];

  it.each(cases)("%s is %o", (formula, expected) => {
    expect(ev(formula)).toEqual(expected);
  });

  it("joins with a delimiter", () => {
    const data = sheet({ A1: "a", A3: "c" });
    expect(data.eval('=TEXTJOIN("-",TRUE,A1:A3)')).toBe("a-c");
    expect(data.eval('=TEXTJOIN("-",FALSE,A1:A3)')).toBe("a--c");
  });

  it("reports a failed FIND and a bad VALUE", () => {
    expect(disp('=FIND("z","abc")')).toBe("#VALUE!");
    expect(disp('=VALUE("abc")')).toBe("#VALUE!");
    expect(disp('=MID("abc",0,1)')).toBe("#VALUE!");
  });

  it("produces #N/A on demand", () => {
    expect(disp("=NA()")).toBe("#N/A");
  });
});

describe("lookup", () => {
  const table = sheet({
    A1: 0,
    B1: "F",
    A2: 60,
    B2: "D",
    A3: 70,
    B3: "C",
    A4: 80,
    B4: "B",
    A5: 90,
    B5: "A",
  });

  it("does an approximate VLOOKUP by default", () => {
    expect(table.eval("=VLOOKUP(85,A1:B5,2)")).toBe("B");
    expect(table.eval("=VLOOKUP(90,A1:B5,2)")).toBe("A");
    expect(table.eval("=VLOOKUP(0,A1:B5,2)")).toBe("F");
    expect(table.eval("=VLOOKUP(1000,A1:B5,2)")).toBe("A");
  });

  it("returns #N/A below the first key", () => {
    expect(table.display("=VLOOKUP(-1,A1:B5,2)")).toBe("#N/A");
  });

  it("does an exact VLOOKUP when asked", () => {
    expect(table.eval("=VLOOKUP(70,A1:B5,2,FALSE)")).toBe("C");
    expect(table.display("=VLOOKUP(85,A1:B5,2,FALSE)")).toBe("#N/A");
  });

  it("rejects a column index outside the table", () => {
    expect(table.display("=VLOOKUP(70,A1:B5,3)")).toBe("#REF!");
    expect(table.display("=VLOOKUP(70,A1:B5,0)")).toBe("#VALUE!");
  });

  it("does an HLOOKUP across a row", () => {
    const row = sheet({ A1: 1, B1: 2, C1: 3, A2: "x", B2: "y", C2: "z" });
    expect(row.eval("=HLOOKUP(2,A1:C2,2)")).toBe("y");
    expect(row.eval("=HLOOKUP(2,A1:C2,2,FALSE)")).toBe("y");
  });

  it("matches positions", () => {
    expect(table.eval("=MATCH(70,A1:A5,0)")).toBe(3);
    expect(table.eval("=MATCH(85,A1:A5,1)")).toBe(4);
    expect(table.display("=MATCH(85,A1:A5,0)")).toBe("#N/A");
  });

  it("matches down a descending vector", () => {
    const desc = sheet({ A1: 10, A2: 8, A3: 5, A4: 1 });
    expect(desc.eval("=MATCH(6,A1:A4,-1)")).toBe(2);
  });

  it("indexes a column, a row and a block", () => {
    expect(table.eval("=INDEX(A1:A5,3)")).toBe(70);
    expect(table.eval("=INDEX(A1:B5,3,2)")).toBe("C");
    expect(table.display("=INDEX(A1:A5,9)")).toBe("#REF!");
  });

  it("composes INDEX with MATCH", () => {
    expect(table.eval("=INDEX(B1:B5,MATCH(80,A1:A5,0))")).toBe("B");
  });

  it("chooses by position", () => {
    expect(ev('=CHOOSE(2,"a","b","c")')).toBe("b");
    expect(disp('=CHOOSE(4,"a","b","c")')).toBe("#VALUE!");
  });
});

describe("information", () => {
  const data = sheet({ A1: 1, A2: "text", A3: true, A5: "=1/0", A6: "=NA()" });

  const cases: Array<[string, boolean]> = [
    ["=ISBLANK(A4)", true],
    ["=ISBLANK(A1)", false],
    ["=ISNUMBER(A1)", true],
    ["=ISTEXT(A2)", true],
    ["=ISNONTEXT(A1)", true],
    ["=ISLOGICAL(A3)", true],
    ["=ISERROR(A5)", true],
    ["=ISERROR(A6)", true],
    ["=ISERR(A6)", false],
    ["=ISERR(A5)", true],
    ["=ISNA(A6)", true],
    ["=ISNA(A5)", false],
  ];

  it.each(cases)("%s is %s", (formula, expected) => {
    expect(data.eval(formula)).toBe(expected);
  });

  it("reports type codes", () => {
    expect(data.eval("=TYPE(A1)")).toBe(1);
    expect(data.eval("=TYPE(A2)")).toBe(2);
    expect(data.eval("=TYPE(A3)")).toBe(4);
    expect(data.eval("=TYPE(A5)")).toBe(16);
  });

  it("reports error codes", () => {
    expect(data.eval("=ERROR.TYPE(A5)")).toBe(2);
    expect(data.eval("=ERROR.TYPE(A6)")).toBe(7);
  });
});
