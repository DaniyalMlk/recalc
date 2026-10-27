import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import { parseFormula } from "../src/engine/parser.js";
import { printFormula } from "../src/engine/printer.js";
import { walk } from "../src/engine/ast.js";
import type { Value } from "../src/engine/value.js";

function sheet(cells: Record<string, string | number | boolean> = {}) {
  const book = new Workbook();
  book.setCells(cells);
  return {
    value(formula: string): Value {
      book.setCell("Z1", formula);
      return book.getValue("Z1");
    },
    display(formula: string): string {
      book.setCell("Z1", formula);
      return book.getDisplay("Z1");
    },
  };
}

/** `A1` is TRUE, `A2` is 5, and `B1` is deliberately left empty. */
const plain = sheet({ A1: true, A2: 5, C1: 3 });

describe("the parser", () => {
  it("accepts a gap where it used to fail", () => {
    for (const formula of [
      "=IF(A1,,2)",
      "=IF(A1,1,)",
      "=SUM(1,)",
      "=SUM(,1)",
      "=ROUND(1.567,)",
      "=IF(,1,2)",
      "=IF(A1,,)",
    ]) {
      expect(() => parseFormula(formula), formula).not.toThrow();
    }
  });

  it("counts a gap as an argument", () => {
    const node = parseFormula("=IF(A1,,2)");
    expect(node.kind).toBe("call");
    expect(node.kind === "call" ? node.args.length : 0).toBe(3);
    const omitted = [...walk(node)].filter((child) => child.kind === "omitted");
    expect(omitted.length).toBe(1);
  });

  it("still means no arguments by an empty list", () => {
    // `F()` is genuinely nothing, and has to stay distinguishable from `F(,)`,
    // which passes two blanks.
    expect(parseFormula("=SUM()").kind === "call" ? 0 : -1).toBe(0);
    const none = parseFormula("=SUM()");
    const two = parseFormula("=SUM(,)");
    expect(none.kind === "call" ? none.args.length : -1).toBe(0);
    expect(two.kind === "call" ? two.args.length : -1).toBe(2);
    expect(plain.display("=SUM()")).toBe("#VALUE!");
    expect(plain.value("=SUM(,)")).toBe(0);
  });

  it("does not accept a gap outside an argument list", () => {
    for (const formula of ["=,", "=1+,2", "=(,)", "=,1"]) {
      expect(() => parseFormula(formula), formula).toThrow();
    }
  });

  it("round-trips: nothing prints back as nothing", () => {
    for (const formula of [
      "IF(A1,,2)",
      "IF(A1,1,)",
      "SUM(1,)",
      "SUM(,1)",
      "IF(A1,,)",
      "IF(,,)",
      "ROUND(1.567,)",
      "SUM(1,,2,,3)",
    ]) {
      const printed = printFormula(parseFormula(`=${formula}`));
      expect(printed, formula).toBe(formula);
      // And printing the reparsed tree is stable, which is what an editor
      // needs: a formula that drifts on every save is not round-tripping.
      expect(printFormula(parseFormula(`=${printed}`))).toBe(printed);
    }
  });
});

describe("an omitted argument is a blank", () => {
  it("is not a zero and not an empty string, by the three comparisons", () => {
    // The same non-transitive triple a blank cell produces, reached through a
    // formula: a blank equals both, and those two do not equal each other.
    expect(plain.value("=IF(A1,,2)=0")).toBe(true);
    expect(plain.value('=IF(A1,,2)=""')).toBe(true);
    expect(plain.value('=0=""')).toBe(false);
    expect(plain.value("=ISBLANK(IF(A1,,2))")).toBe(true);
  });

  it("is falsy where a condition is coerced", () => {
    // `IF` coerces its condition, and a blank coerces to false.
    expect(plain.value("=IF(,1,2)")).toBe(2);
    expect(plain.value("=IF(,)")).toBe(false);
  });

  it("is skipped, not coerced, where a blank is ignored", () => {
    // The other half, and the distinction is not a quibble: `AND` and `OR`
    // ignore a blank rather than reading it as false, which is how they
    // already behave over a range with empty cells. A blank that coerced to
    // false here would make `AND(TRUE,)` false and disagree with
    // `AND(TRUE,B1)` on an empty B1.
    expect(plain.value("=AND(TRUE,)")).toBe(true);
    expect(plain.value("=OR(FALSE,)")).toBe(false);
    expect(plain.value("=AND(TRUE,FALSE)")).toBe(false);
    expect(plain.value("=OR(FALSE,TRUE)")).toBe(true);
  });

  it("reports as blank rather than as a zero", () => {
    // A deliberate choice, and the one place this differs visibly from how
    // some spreadsheets render the same formula. The engine has a real blank
    // value: `ISBLANK` says TRUE and `=0` says TRUE, which is exactly what a
    // blank does. Showing 0 in the cell would make the display disagree with
    // `ISBLANK` about the same result.
    expect(plain.display("=IF(A1,,2)")).toBe("");
    expect(plain.value("=IF(A1,,2)")).toBeNull();
    expect(plain.value("=ISBLANK(IF(A1,,2))")).toBe(true);
  });
});

describe("a gap and a blank cell are the same argument", () => {
  // The broad claim, and the one worth having: an omitted argument behaves
  // exactly as a reference to an empty cell would. It is an identity across
  // the whole function surface rather than a list of cases, which means
  // nothing has to be told about omitted arguments to handle them.
  const book = new Workbook();
  book.setCells({ A1: 1, A2: 3, C1: 2, D1: 1.567 });
  // B1 and B2 are empty.
  const read = (formula: string): Value => {
    book.setCell("Z1", formula);
    return book.getValue("Z1");
  };
  const display = (formula: string): string => {
    book.setCell("Z1", formula);
    return book.getDisplay("Z1");
  };

  const pairs: readonly (readonly [string, string])[] = [
    ["=SUM(A1,,C1)", "=SUM(A1,B1,C1)"],
    ["=SUM(,A1)", "=SUM(B1,A1)"],
    ["=COUNT(A1,,C1)", "=COUNT(A1,B1,C1)"],
    ["=COUNTA(A1,,C1)", "=COUNTA(A1,B1,C1)"],
    ["=AVERAGE(A1,,C1)", "=AVERAGE(A1,B1,C1)"],
    ["=MAX(A1,,C1)", "=MAX(A1,B1,C1)"],
    ["=MIN(A1,,C1)", "=MIN(A1,B1,C1)"],
    ["=PRODUCT(A1,,C1)", "=PRODUCT(A1,B1,C1)"],
    ["=ROUND(D1,)", "=ROUND(D1,B1)"],
    ["=IF(A1,,C1)", "=IF(A1,B1,C1)"],
    ["=IF(,A1,C1)", "=IF(B1,A1,C1)"],
    ["=CONCATENATE(A1,,C1)", "=CONCATENATE(A1,B1,C1)"],
    ["=AND(A1,)", "=AND(A1,B1)"],
    ["=OR(,A1)", "=OR(B1,A1)"],
    ["=STDEV.P(A1,,A2)", "=STDEV.P(A1,B1,A2)"],
    ["=MEDIAN(A1,,C1)", "=MEDIAN(A1,B1,C1)"],
  ];

  it("gives the same answer, formula for formula", () => {
    for (const [gap, blank] of pairs) {
      expect(read(gap), `${gap} against ${blank}`).toStrictEqual(read(blank));
      expect(display(gap), `${gap} against ${blank}`).toBe(display(blank));
    }
  });

  it("covers enough of the surface to be a claim", () => {
    expect(pairs.length).toBeGreaterThanOrEqual(16);
    // And the pairs are not all the same answer, which would make the
    // agreement above vacuous — a list of formulas that all returned 1 would
    // pass it with the blank handling broken in any direction.
    const answers = new Set(pairs.map(([gap]) => JSON.stringify(read(gap))));
    expect(answers.size).toBeGreaterThan(4);
  });

  it("differs from leaving the argument out where the function has a default", () => {
    // Both halves. For a function whose optional argument defaults to the
    // zero its blank coerces to, a gap and an absence agree — and where the
    // default is something else, they must not.
    expect(read("=ROUND(D1,)")).toStrictEqual(read("=ROUND(D1,0)"));
    // `VLOOKUP`'s fourth argument defaults to TRUE and a blank is falsy, so
    // writing the gap asks for the exact match that leaving it out does not.
    book.setCells({ F1: 10, G1: "ten", F2: 20, G2: "twenty", F3: 30, G3: "thirty" });
    expect(read("=VLOOKUP(25,F1:G3,2)")).toBe("twenty");
    expect(display("=VLOOKUP(25,F1:G3,2,)")).toBe("#N/A");
  });
});

describe("arity still counts the gaps", () => {
  it("refuses too many arguments, written or not", () => {
    expect(plain.display("=IF(,,,)")).toBe("#VALUE!");
    expect(plain.display("=ROUND(1,2,)")).toBe("#VALUE!");
    expect(plain.display("=ISBLANK(,)")).toBe("#VALUE!");
  });

  it("accepts a gap in a required position and lets the function judge it", () => {
    // Not the parser's business whether a blank is a sensible argument there;
    // the function says so, with its own message.
    expect(plain.display("=ROUND(,2)")).toBe("0");
    expect(plain.display("=LN()")).toBe("#VALUE!");
    expect(plain.display("=LN(,)")).toBe("#VALUE!");
  });
});
