import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import type { Value } from "../src/engine/value.js";

/** Lay a block of numbers into the sheet starting at A1, row-major. */
function withBlock(rows: readonly (readonly number[])[]): Workbook {
  const book = new Workbook();
  const cells: Record<string, number> = {};
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      cells[`${String.fromCharCode(65 + c)}${r + 1}`] = value;
    });
  });
  book.setCells(cells);
  return book;
}

function read(
  book: Workbook,
  anchor: { col: number; row: number },
  rows: number,
  cols: number,
): Value[][] {
  const out: Value[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Value[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(book.getValue({ col: anchor.col + c, row: anchor.row + r }));
    }
    out.push(row);
  }
  return out;
}

function display(book: Workbook, formula: string): string {
  book.setCell("Z1", formula);
  return book.getDisplay("Z1");
}

describe("MMULT", () => {
  it("multiplies two blocks", () => {
    const book = withBlock([
      [1, 2],
      [3, 4],
    ]);
    book.setCells({ D1: 5, E1: 6, D2: 7, E2: 8 });
    book.setCell("G1", "=MMULT(A1:B2,D1:E2)");
    expect(read(book, { col: 6, row: 0 }, 2, 2)).toEqual([
      [19, 22],
      [43, 50],
    ]);
  });

  it("collapses a 1x1 product to a plain value", () => {
    const book = withBlock([[1, 2, 3]]);
    book.setCells({ A2: 4, A3: 5, A4: 6 });
    book.setCell("E1", "=MMULT(A1:C1,A2:A4)");
    expect(book.getValue("E1")).toBe(32);
    expect(book.isSpillAnchor("E1")).toBe(false);
  });

  it("refuses a dimension mismatch and says what it could not multiply", () => {
    const book = withBlock([
      [1, 2],
      [3, 4],
    ]);
    book.setCell("G1", "=MMULT(A1:B2,A1:B1)");
    expect(book.getDisplay("G1")).toBe("#VALUE!");
    const value = book.getValue("G1");
    expect((value as { detail?: string }).detail).toContain("2x2");
  });

  it("refuses a block containing text", () => {
    const book = withBlock([
      [1, 2],
      [3, 4],
    ]);
    book.setCell("B2", "four");
    expect(display(book, "=MMULT(A1:B2,A1:B2)")).toBe("#VALUE!");
  });

  it("composes with TRANSPOSE", () => {
    const book = withBlock([[1, 2, 3]]);
    // A row times its own transpose is the sum of the squares.
    book.setCell("E1", "=MMULT(A1:C1,TRANSPOSE(A1:C1))");
    expect(book.getValue("E1")).toBe(14);
  });
});

describe("MINVERSE", () => {
  it("inverts a 2x2 to its closed form", () => {
    const book = withBlock([
      [4, 7],
      [2, 6],
    ]);
    book.setCell("D1", "=MINVERSE(A1:B2)");
    const inverse = read(book, { col: 3, row: 0 }, 2, 2);
    expect(inverse[0]![0] as number).toBeCloseTo(0.6, 12);
    expect(inverse[0]![1] as number).toBeCloseTo(-0.7, 12);
    expect(inverse[1]![0] as number).toBeCloseTo(-0.2, 12);
    expect(inverse[1]![1] as number).toBeCloseTo(0.4, 12);
  });

  it("multiplies back to the identity from the sheet", () => {
    const book = withBlock([
      [2, -1, 3],
      [0, 4, 5],
      [7, 1, -2],
    ]);
    book.setCell("E1", "=MMULT(A1:C3,MINVERSE(A1:C3))");
    const product = read(book, { col: 4, row: 0 }, 3, 3);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        expect(product[r]![c] as number).toBeCloseTo(r === c ? 1 : 0, 10);
      }
    }
  });

  it("is #NUM! for a singular matrix", () => {
    const book = withBlock([
      [1, 2],
      [2, 4],
    ]);
    expect(display(book, "=MINVERSE(A1:B2)")).toBe("#NUM!");
  });

  it("is #NUM! for a matrix that is singular only after rounding", () => {
    const book = withBlock([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
    expect(display(book, "=MINVERSE(A1:C3)")).toBe("#NUM!");
  });

  it("is #VALUE! for a block that is not square", () => {
    const book = withBlock([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(display(book, "=MINVERSE(A1:C2)")).toBe("#VALUE!");
  });

  it("inverts a matrix whose leading entry is zero", () => {
    const book = withBlock([
      [0, 1],
      [1, 0],
    ]);
    book.setCell("D1", "=MINVERSE(A1:B2)");
    expect(read(book, { col: 3, row: 0 }, 2, 2)).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });
});

describe("MDETERM", () => {
  it("matches the closed form for 2x2", () => {
    const book = withBlock([
      [3, 8],
      [4, 6],
    ]);
    expect(display(book, "=MDETERM(A1:B2)")).toBe("-14");
  });

  it("matches cofactor expansion for 3x3", () => {
    const book = withBlock([
      [6, 1, 1],
      [4, -2, 5],
      [2, 8, 7],
    ]);
    book.setCell("E1", "=MDETERM(A1:C3)");
    expect(book.getValue("E1") as number).toBeCloseTo(-306, 9);
  });

  it("is exactly zero for a singular matrix", () => {
    const book = withBlock([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
    book.setCell("E1", "=MDETERM(A1:C3)");
    expect(book.getValue("E1")).toBe(0);
  });

  it("is one for the identity, built from MUNIT", () => {
    const book = new Workbook();
    book.setCell("A1", "=MDETERM(MUNIT(5))");
    expect(book.getValue("A1") as number).toBeCloseTo(1, 12);
  });

  it("is #VALUE! for a block that is not square", () => {
    const book = withBlock([[1, 2, 3]]);
    expect(display(book, "=MDETERM(A1:C1)")).toBe("#VALUE!");
  });
});

describe("MUNIT", () => {
  it("spills an identity block", () => {
    const book = new Workbook();
    book.setCell("A1", "=MUNIT(3)");
    expect(read(book, { col: 0, row: 0 }, 3, 3)).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  it("leaves a matrix unchanged when multiplied by it", () => {
    const book = withBlock([
      [2, -1],
      [5, 3],
    ]);
    book.setCell("D1", "=MMULT(A1:B2,MUNIT(2))");
    expect(read(book, { col: 3, row: 0 }, 2, 2)).toEqual([
      [2, -1],
      [5, 3],
    ]);
  });

  it("refuses a size below one", () => {
    const book = new Workbook();
    expect(display(book, "=MUNIT(0)")).toBe("#VALUE!");
    expect(display(book, "=MUNIT(-2)")).toBe("#VALUE!");
  });

  it("refuses a size that would fill the sheet", () => {
    const book = new Workbook();
    expect(display(book, "=MUNIT(5000)")).toBe("#NUM!");
  });
});

describe("MSOLVE", () => {
  it("solves a system whose answer is known", () => {
    // x + y = 5, 2x - y = 1  ->  x = 2, y = 3
    const book = withBlock([
      [1, 1],
      [2, -1],
    ]);
    book.setCells({ D1: 5, D2: 1 });
    book.setCell("F1", "=MSOLVE(A1:B2,D1:D2)");
    const x = read(book, { col: 5, row: 0 }, 2, 1);
    expect(x[0]![0] as number).toBeCloseTo(2, 10);
    expect(x[1]![0] as number).toBeCloseTo(3, 10);
  });

  it("agrees with multiplying by the inverse", () => {
    const book = withBlock([
      [2, -1, 3],
      [0, 4, 5],
      [7, 1, -2],
    ]);
    book.setCells({ E1: 9, E2: 4, E3: -6 });
    book.setCell("G1", "=MSOLVE(A1:C3,E1:E3)");
    book.setCell("I1", "=MMULT(MINVERSE(A1:C3),E1:E3)");
    for (let r = 0; r < 3; r++) {
      expect(book.getValue({ col: 6, row: r }) as number).toBeCloseTo(
        book.getValue({ col: 8, row: r }) as number,
        9,
      );
    }
  });

  it("reproduces the right-hand side when multiplied back", () => {
    const book = withBlock([
      [2, -1, 3],
      [0, 4, 5],
      [7, 1, -2],
    ]);
    book.setCells({ E1: 9, E2: 4, E3: -6 });
    book.setCell("G1", "=MSOLVE(A1:C3,E1:E3)");
    book.setCell("K1", "=MMULT(A1:C3,G1:G3)");
    for (let r = 0; r < 3; r++) {
      expect(book.getValue({ col: 10, row: r }) as number).toBeCloseTo(
        book.getValue({ col: 4, row: r }) as number,
        9,
      );
    }
  });

  it("is #NUM! for a singular system", () => {
    const book = withBlock([
      [1, 2],
      [2, 4],
    ]);
    book.setCells({ D1: 1, D2: 2 });
    expect(display(book, "=MSOLVE(A1:B2,D1:D2)")).toBe("#NUM!");
  });

  it("refuses a right-hand side of the wrong height", () => {
    const book = withBlock([
      [1, 1],
      [2, -1],
    ]);
    book.setCells({ D1: 5, D2: 1, D3: 7 });
    expect(display(book, "=MSOLVE(A1:B2,D1:D3)")).toBe("#VALUE!");
  });
});
