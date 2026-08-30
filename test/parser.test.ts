import { describe, expect, it } from "vitest";
import { walk } from "../src/engine/ast.js";
import type { Node } from "../src/engine/ast.js";
import { ParseError } from "../src/engine/errors.js";
import { parseFormula } from "../src/engine/parser.js";
import { printFormula, stripGroups } from "../src/engine/printer.js";
import { formatA1, formatRange } from "../src/engine/reference.js";

const canon = (src: string) => printFormula(parseFormula(src));

describe("literals", () => {
  it("parses numbers, strings, booleans and errors", () => {
    expect(parseFormula("=1.5")).toEqual({ kind: "number", value: 1.5 });
    expect(parseFormula('="hi"')).toEqual({ kind: "string", value: "hi" });
    expect(parseFormula("=TRUE")).toEqual({ kind: "boolean", value: true });
    expect(parseFormula("=false")).toEqual({ kind: "boolean", value: false });
    expect(parseFormula("=#N/A")).toEqual({ kind: "error", code: "#N/A" });
  });
});

describe("references", () => {
  it("parses a cell reference", () => {
    const node = parseFormula("=$B7");
    expect(node.kind).toBe("reference");
    expect(node.kind === "reference" && formatA1(node.ref)).toBe("$B7");
  });

  it("parses and normalises a range", () => {
    const node = parseFormula("=C5:A1");
    expect(node.kind).toBe("range");
    expect(node.kind === "range" && formatRange(node.range)).toBe("A1:C5");
  });

  it("treats an unrecognisable word as a name", () => {
    expect(parseFormula("=Revenue")).toEqual({ kind: "name", name: "REVENUE" });
  });

  it("rejects a range built from non-references", () => {
    expect(() => parseFormula("=1:A2")).toThrow(ParseError);
    expect(() => parseFormula("=A1:SUM(B1:B2)")).toThrow(ParseError);
  });
});

describe("the word/reference ambiguity", () => {
  it("reads LOG10 as a function when followed by a paren", () => {
    const node = parseFormula("=LOG10(100)");
    expect(node.kind).toBe("call");
    expect(node.kind === "call" && node.name).toBe("LOG10");
  });

  it("reads LOG10 as a cell reference when it stands alone", () => {
    const node = parseFormula("=LOG10");
    expect(node.kind).toBe("reference");
    expect(node.kind === "reference" && formatA1(node.ref)).toBe("LOG10");
  });

  it("reads TRUE as a boolean but TRUE() as a call", () => {
    expect(parseFormula("=TRUE").kind).toBe("boolean");
    expect(parseFormula("=TRUE()").kind).toBe("call");
  });
});

describe("operator precedence", () => {
  const cases: Array<[string, string]> = [
    ["=1+2*3", "1+2*3"],
    ["=(1+2)*3", "(1+2)*3"],
    ["=1*2+3", "1*2+3"],
    ["=1+2-3", "1+2-3"],
    ["=1-2-3", "1-2-3"],
    ["=1-(2-3)", "1-(2-3)"],
    ["=2/3/4", "2/3/4"],
    ["=2/(3/4)", "2/(3/4)"],
    ["=1&2+3", "1&2+3"],
    ["=(1&2)+3", "(1&2)+3"],
    ["=1=2&3", "1=2&3"],
    ["=1<2+3", "1<2+3"],
    ["=2^3*4", "2^3*4"],
    ["=2*3^4", "2*3^4"],
    ["=2^3^4", "2^3^4"],
    ["=(2^3)^4", "(2^3)^4"],
    ["=2%*3", "2%*3"],
    ["=2*3%", "2*3%"],
    ["=2%^3", "2%^3"],
    ["=A1:B2+1", "A1:B2+1"],
  ];

  it.each(cases)("canonicalises %s to %s", (src, expected) => {
    expect(canon(src)).toBe(expected);
  });

  it("binds negation tighter than exponentiation, as spreadsheets do", () => {
    // The distinguishing case: `-2^2` is `(-2)^2`, so the tree's root is `^`.
    const node = parseFormula("=-2^2");
    expect(node.kind).toBe("binary");
    expect(node.kind === "binary" && node.op).toBe("^");
    expect(node.kind === "binary" && node.left.kind).toBe("unary");
  });

  it("allows a signed exponent on the right of ^", () => {
    const node = parseFormula("=2^-3");
    expect(node.kind === "binary" && node.right.kind).toBe("unary");
  });

  it("chains prefix signs", () => {
    expect(canon("=--2")).toBe("--2");
    expect(canon("=-+-2")).toBe("-+-2");
  });

  it("keeps comparison lowest", () => {
    const node = parseFormula("=1+2<3*4");
    expect(node.kind === "binary" && node.op).toBe("<");
  });
});

describe("function calls", () => {
  it("parses a call with no arguments", () => {
    expect(parseFormula("=NOW()")).toEqual({ kind: "call", name: "NOW", args: [] });
  });

  it("upper-cases the function name", () => {
    const node = parseFormula("=sum(A1:A3)");
    expect(node.kind === "call" && node.name).toBe("SUM");
  });

  it("parses nested calls and keeps argument order", () => {
    const node = parseFormula('=IF(A1>0,SUM(B1:B3),"no")');
    expect(node.kind).toBe("call");
    if (node.kind !== "call") throw new Error("expected a call");
    expect(node.args).toHaveLength(3);
    expect(node.args[0]!.kind).toBe("binary");
    expect(node.args[1]!.kind).toBe("call");
    expect(node.args[2]!).toEqual({ kind: "string", value: "no" });
  });

  it("accepts semicolons as separators", () => {
    expect(canon("=MAX(1;2;3)")).toBe("MAX(1,2,3)");
  });

  it("rejects a missing closing paren", () => {
    expect(() => parseFormula("=SUM(A1")).toThrow(ParseError);
  });

  it("rejects an empty argument slot", () => {
    expect(() => parseFormula("=IF(A1,,2)")).toThrow(ParseError);
  });
});

describe("parse errors", () => {
  const bad = [
    "=",
    "=1+",
    "=*2",
    "=)",
    "=1 2",
    "=(1",
    "=1)",
    "=,",
    "=SUM(1))",
  ];

  it.each(bad)("rejects %s", (src) => {
    expect(() => parseFormula(src)).toThrow(ParseError);
  });

  it("points at the offending offset", () => {
    try {
      parseFormula("=1+*2");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ParseError).offset).toBe(3);
    }
  });
});

describe("printing", () => {
  it("adds a leading equals on request", () => {
    expect(printFormula(parseFormula("=1+1"), true)).toBe("=1+1");
  });

  it("re-quotes doubled quotes", () => {
    expect(canon('="a""b"')).toBe('"a""b"');
  });

  it("collapses redundant parentheses", () => {
    expect(canon("=((1+2))*3")).toBe("(1+2)*3");
    expect(canon("=(1)")).toBe("1");
  });

  const roundTrip = [
    "=1+2*3",
    "=(1+2)*3",
    "=-2^2",
    "=2^-3",
    "=2^3^4",
    "=A1:B2",
    "=$A$1+B$2-$C3",
    '=IF(A1>=0,"pos"&A1,SUM(B1:B9)/2)',
    "=1%+2%",
    "=#DIV/0!",
    "=MAX(-1,-2,-3)",
    "=NOT(A1<>B1)",
    "=1.5e-3*2",
  ];

  it.each(roundTrip)("round-trips %s", (src) => {
    const first = parseFormula(src);
    const second = parseFormula(printFormula(first));
    expect(stripGroups(second)).toEqual(stripGroups(first));
  });

  it("is idempotent after one canonicalisation pass", () => {
    for (const src of roundTrip) {
      const once = canon(src);
      expect(canon(once)).toBe(once);
    }
  });
});

describe("walk", () => {
  it("visits every node parents-first", () => {
    const node: Node = parseFormula("=SUM(A1:A3,B1)*2");
    const kindList = [...walk(node)].map((n) => n.kind);
    expect(kindList[0]).toBe("binary");
    expect(kindList).toContain("call");
    expect(kindList).toContain("range");
    expect(kindList).toContain("reference");
    expect(kindList.filter((k) => k === "number")).toHaveLength(1);
  });

  it("descends through groups and unary operators", () => {
    const kindList = [...walk(parseFormula("=-(A1)"))].map((n) => n.kind);
    expect(kindList).toEqual(["unary", "group", "reference"]);
  });
});
