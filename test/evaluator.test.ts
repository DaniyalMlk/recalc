import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import type { Value } from "../src/engine/value.js";

/** Evaluate a formula in a scratch sheet, optionally seeded with cells. */
function evaluate(
  formula: string,
  sheet: Record<string, string | number | boolean> = {},
): Value {
  const book = new Workbook();
  book.setCells(sheet);
  book.setCell("Z100", formula);
  return book.getValue("Z100");
}

const display = (
  formula: string,
  sheet: Record<string, string | number | boolean> = {},
) => {
  const book = new Workbook();
  book.setCells(sheet);
  book.setCell("Z100", formula);
  return book.getDisplay("Z100");
};

describe("arithmetic", () => {
  const cases: Array<[string, number]> = [
    ["=1+2", 3],
    ["=5-8", -3],
    ["=3*4", 12],
    ["=7/2", 3.5],
    ["=2^10", 1024],
    ["=0^0", 1],
    ["=-3+1", -2],
    ["=+5", 5],
    ["=50%", 0.5],
    ["=200%*3", 6],
    ["=1+2*3-4/2", 5],
  ];

  it.each(cases)("%s is %d", (formula, expected) => {
    expect(evaluate(formula)).toBe(expected);
  });

  it("reports division by zero", () => {
    expect(display("=1/0")).toBe("#DIV/0!");
    expect(display("=0/0")).toBe("#DIV/0!");
  });

  it("reports a negative base with a fractional exponent", () => {
    expect(display("=(-8)^0.5")).toBe("#NUM!");
  });

  it("reports overflow as #NUM!", () => {
    expect(display("=1e308*10")).toBe("#NUM!");
  });

  it("treats 0 to a negative power as division by zero", () => {
    expect(display("=0^-1")).toBe("#DIV/0!");
  });
});

describe("coercion in operators", () => {
  it("coerces numeric text in arithmetic", () => {
    expect(evaluate('="3"+1')).toBe(4);
  });

  it("rejects non-numeric text in arithmetic", () => {
    expect(display('="a"+1')).toBe("#VALUE!");
  });

  it("coerces booleans in arithmetic", () => {
    expect(evaluate("=TRUE+TRUE")).toBe(2);
    expect(evaluate("=FALSE*5")).toBe(0);
  });

  it("treats a blank cell as zero in arithmetic", () => {
    expect(evaluate("=A1+5")).toBe(5);
  });

  it("keeps unary plus an identity rather than a coercion", () => {
    expect(evaluate('=+"abc"')).toBe("abc");
  });

  it("makes unary minus numeric", () => {
    expect(evaluate('=-"3"')).toBe(-3);
    expect(display('=-"abc"')).toBe("#VALUE!");
  });
});

describe("concatenation", () => {
  it("joins values as text", () => {
    expect(evaluate('="a"&"b"')).toBe("ab");
    expect(evaluate('=1&2')).toBe("12");
    expect(evaluate('="n="&TRUE')).toBe("n=TRUE");
  });

  it("renders a blank cell as empty text", () => {
    expect(evaluate('="["&A1&"]"')).toBe("[]");
  });
});

describe("comparison", () => {
  const cases: Array<[string, boolean]> = [
    ["=1=1", true],
    ["=1<>1", false],
    ["=1<2", true],
    ["=2<=2", true],
    ["=3>4", false],
    ["=3>=3", true],
    ['="a"="A"', true],
    ['="a"<"b"', true],
    ['="a">1', true],
    ['=TRUE>"z"', true],
    ["=TRUE>FALSE", true],
  ];

  it.each(cases)("%s is %s", (formula, expected) => {
    expect(evaluate(formula)).toBe(expected);
  });

  it("makes a blank cell equal both zero and empty text", () => {
    expect(evaluate("=A1=0")).toBe(true);
    expect(evaluate('=A1=""')).toBe(true);
  });
});

describe("error propagation", () => {
  it("propagates through arithmetic", () => {
    expect(display("=1/0+1")).toBe("#DIV/0!");
    expect(display("=1+1/0")).toBe("#DIV/0!");
  });

  it("propagates through concatenation and comparison", () => {
    expect(display('=1/0&"x"')).toBe("#DIV/0!");
    expect(display("=1/0>1")).toBe("#DIV/0!");
  });

  it("lets the leftmost error win", () => {
    expect(display("=NA()+1/0")).toBe("#N/A");
    expect(display("=1/0+NA()")).toBe("#DIV/0!");
  });

  it("propagates through a function", () => {
    expect(display("=SUM(1,1/0)")).toBe("#DIV/0!");
  });

  it("propagates an error found inside a range", () => {
    expect(display("=SUM(A1:A3)", { A1: 1, A2: "=1/0", A3: 3 })).toBe(
      "#DIV/0!",
    );
  });

  it("surfaces an error literal typed directly", () => {
    expect(display("=#REF!")).toBe("#REF!");
  });
});

describe("references and ranges", () => {
  it("reads a cell", () => {
    expect(evaluate("=A1*2", { A1: 21 })).toBe(42);
  });

  it("reads through anchors identically", () => {
    expect(evaluate("=$A$1+A1+$A1+A$1", { A1: 1 })).toBe(4);
  });

  it("broadcasts an operator across a multi-cell range", () => {
    // The result is a block now, not an error: the cell holds the first of the
    // three results and the other two spill below it.
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, A3: 3 });
    book.setCell("C1", "=A1:A3+1");
    expect([book.getValue("C1"), book.getValue("C2"), book.getValue("C3")]).toEqual([
      2, 3, 4,
    ]);
  });

  it("still refuses a block where a single value is required", () => {
    expect(display("=ROUND(A1:A3+1,0)", { A1: 1, A2: 2, A3: 3 })).toBe("#VALUE!");
  });

  it("collapses a one-cell range to its value", () => {
    expect(evaluate("=A1:A1+1", { A1: 5 })).toBe(6);
  });
});

describe("function dispatch", () => {
  it("reports an unknown function", () => {
    expect(display("=NOSUCHFN(1)")).toBe("#NAME?");
  });

  it("reports too few arguments", () => {
    expect(display("=ROUND(1)")).toBe("#VALUE!");
  });

  it("reports too many arguments", () => {
    expect(display("=NOT(1,2)")).toBe("#VALUE!");
  });

  it("is case-insensitive on names", () => {
    expect(evaluate("=sUm(1,2)")).toBe(3);
  });

  it("reports an unknown bare name", () => {
    expect(display("=Revenue*2")).toBe("#NAME?");
  });

  it("resolves a defined name", () => {
    const book = new Workbook();
    book.setName("TAXRATE", 0.21);
    book.setCell("A1", "=TAXRATE*100");
    expect(book.getValue("A1")).toBeCloseTo(21, 10);
  });
});

describe("laziness", () => {
  it("does not evaluate the untaken IF branch", () => {
    expect(evaluate("=IF(TRUE,1,1/0)")).toBe(1);
    expect(evaluate("=IF(FALSE,1/0,2)")).toBe(2);
  });

  it("does not evaluate the IFERROR fallback when there is no error", () => {
    expect(evaluate("=IFERROR(1,1/0)")).toBe(1);
  });

  it("still surfaces an error in the taken branch", () => {
    expect(display("=IF(TRUE,1/0,2)")).toBe("#DIV/0!");
  });
});
