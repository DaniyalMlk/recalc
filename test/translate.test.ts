import { describe, expect, it } from "vitest";

import { parseFormula } from "../src/engine/parser.js";
import { printFormula } from "../src/engine/printer.js";
import { translateAst } from "../src/engine/translate.js";

const shift = (formula: string, dCol: number, dRow: number) =>
  printFormula(translateAst(parseFormula(formula), dCol, dRow), true);

describe("translateAst", () => {
  it("shifts a relative reference by the row delta", () => {
    expect(shift("=A1*2", 0, 1)).toBe("=A2*2");
    expect(shift("=A1*2", 0, 5)).toBe("=A6*2");
  });

  it("shifts a relative reference by the column delta", () => {
    expect(shift("=A1*2", 2, 0)).toBe("=C1*2");
  });

  it("leaves a fully anchored reference where it is", () => {
    expect(shift("=$A$1*2", 3, 4)).toBe("=$A$1*2");
  });

  it("moves only the unanchored half of a mixed reference", () => {
    expect(shift("=$A1", 2, 3)).toBe("=$A4");
    expect(shift("=A$1", 2, 3)).toBe("=C$1");
  });

  it("shifts both corners of a range", () => {
    expect(shift("=SUM(B2:B5)", 1, 1)).toBe("=SUM(C3:C6)");
  });

  it("holds an anchored range still while a relative one moves", () => {
    expect(shift("=SUM(B2:B5)/COUNT($B$2:$B$5)", 0, 3)).toBe(
      "=SUM(B5:B8)/COUNT($B$2:$B$5)",
    );
  });

  it("anchors one end of a range independently", () => {
    expect(shift("=SUM($B$2:B5)", 0, 2)).toBe("=SUM($B$2:B7)");
  });

  it("leaves names, numbers and text alone", () => {
    expect(shift('=IF(Rate>0,"up","down")', 4, 4)).toBe(
      '=IF(RATE>0,"up","down")',
    );
  });

  it("produces #REF! when a reference is pushed off the top of the sheet", () => {
    expect(shift("=A1+B2", 0, -1)).toBe("=#REF!+B1");
  });

  it("produces #REF! when a range is pushed off the left edge", () => {
    expect(shift("=SUM(A1:B1)", -1, 0)).toBe("=SUM(#REF!)");
  });

  it("returns the identical tree for a zero delta", () => {
    const ast = parseFormula("=A1+B2");
    expect(translateAst(ast, 0, 0)).toBe(ast);
  });

  it("returns the identical tree when everything in it is anchored", () => {
    const ast = parseFormula("=$A$1+SUM($B$1:$B$9)+7");
    expect(translateAst(ast, 3, 3)).toBe(ast);
  });

  it("walks into every node kind", () => {
    expect(shift("=-(A1%)+SUM(B1:B2)&C1", 0, 1)).toBe(
      "=-(A2%)+SUM(B2:B3)&C2",
    );
  });
});
