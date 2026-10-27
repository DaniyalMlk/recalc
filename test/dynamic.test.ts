import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import { ERROR_CODES, isErrorCode } from "../src/engine/errors.js";
import { tokenize } from "../src/engine/lexer.js";
import { registeredFunctionNames } from "../src/functions/index.js";
import type { Value } from "../src/engine/value.js";

/** A sheet with the fixture laid down, and readers for a spilled block. */
function sheet(cells: Record<string, string | number | boolean>) {
  const book = new Workbook();
  book.setCells(cells);
  return {
    /** Evaluate at H1 and read the block back as rows of values. */
    block(formula: string, rows: number, cols = 1): Value[][] {
      book.setCell("H1", formula);
      const out: Value[][] = [];
      for (let row = 0; row < rows; row += 1) {
        const line: Value[] = [];
        for (let col = 0; col < cols; col += 1) {
          line.push(book.getValue(`${String.fromCharCode(72 + col)}${row + 1}`) ?? null);
        }
        out.push(line);
      }
      return out;
    },
    column(formula: string, rows: number): Value[] {
      return this.block(formula, rows).map((line) => line[0] as Value);
    },
    value(formula: string): Value {
      book.setCell("Z90", formula);
      return book.getValue("Z90");
    },
    display(formula: string): string {
      book.setCell("Z90", formula);
      return book.getDisplay("Z90");
    },
    num(formula: string): number {
      const seen = this.value(formula);
      if (typeof seen !== "number") {
        throw new Error(`${formula} produced ${JSON.stringify(seen)}`);
      }
      return seen;
    },
  };
}

/**
 * A region with ties in two of its three columns, so that a sort has
 * something to be stable about and a second key has something to say.
 */
const REGIONS = {
  A1: "north",
  B1: "beta",
  C1: 2,
  A2: "north",
  B2: "alpha",
  C2: 2,
  A3: "south",
  B3: "gamma",
  C3: 1,
  A4: "north",
  B4: "delta",
  C4: 2,
} as const;

describe("the functions are registered and reachable", () => {
  it("is on the function list under the names a sheet would use", () => {
    const names = registeredFunctionNames();
    for (const name of ["SORT", "SORTBY", "FILTER", "UNIQUE"]) {
      expect(names, name).toContain(name);
    }
  });

  it("spills onto the sheet, and refuses to when the room is taken", () => {
    const book = new Workbook();
    book.setCells({ A1: 3, A2: 1, A3: 2 });
    book.setCell("H1", "=SORT(A1:A3)");
    expect([book.getValue("H1"), book.getValue("H2"), book.getValue("H3")]).toEqual([
      1, 2, 3,
    ]);
    book.setCell("H5", "in the way");
    book.setCell("H4", "=SORT(A1:A3)");
    expect(book.getDisplay("H4")).toBe("#SPILL!");
  });
});

describe("SORT", () => {
  const plain = sheet(REGIONS);

  it("sorts rows by one of its own columns, carrying the rest along", () => {
    expect(plain.block("=SORT(A1:C4,3)", 4, 3)).toEqual([
      ["south", "gamma", 1],
      ["north", "beta", 2],
      ["north", "alpha", 2],
      ["north", "delta", 2],
    ]);
  });

  it("is stable: tied lines come out in the order they went in", () => {
    // The three `north` rows all hold 2 in the sort column, and they appear
    // in their original order — beta, alpha, delta — which is neither
    // alphabetical nor reversed, so nothing but input order produces it.
    const sorted = plain.block("=SORT(A1:C4,3)", 4, 3);
    expect(sorted.slice(1).map((line) => line[1])).toEqual(["beta", "alpha", "delta"]);
    // Descending reverses the keys and *not* the ties, which is the half of
    // stability a reversed comparator would get wrong.
    const descending = plain.block("=SORT(A1:C4,3,-1)", 4, 3);
    expect(descending.map((line) => line[1])).toEqual([
      "beta",
      "alpha",
      "delta",
      "gamma",
    ]);
  });

  it("orders text the way the sheet's own comparison does", () => {
    // Case-blind, so `Apple` and `apple` tie and stay in input order rather
    // than being separated by their character codes.
    const mixed = sheet({ A1: "pear", A2: "Apple", A3: "fig", A4: "apple" });
    expect(mixed.column("=SORT(A1:A4)", 4)).toEqual(["Apple", "apple", "fig", "pear"]);
    expect(mixed.value("=EXACT(\"Apple\",\"apple\")")).toBe(false);
    expect(mixed.value("=(\"Apple\"=\"apple\")")).toBe(true);
  });

  it("sorts columns instead when asked", () => {
    const across = sheet({ E1: 3, F1: 1, G1: 2, E2: "c", F2: "a", G2: "b" });
    expect(across.block("=SORT(E1:G2,1,1,TRUE)", 2, 3)).toEqual([
      [1, 2, 3],
      ["a", "b", "c"],
    ]);
  });

  it("refuses an index outside the block and an order that is neither way", () => {
    expect(plain.display("=SORT(A1:C4,4)")).toBe("#VALUE!");
    expect(plain.display("=SORT(A1:C4,0)")).toBe("#VALUE!");
    expect(plain.display("=SORT(A1:C4,1,2)")).toBe("#VALUE!");
    expect(plain.display("=SORT(A1:C4,1,0)")).toBe("#VALUE!");
    // The index counts across a line, and turning the block into columns
    // turns its 4 rows into the line length — so the bound is 3 one way round
    // and 4 the other, on the same block. Which is the thing to assert: an
    // index checked against the wrong dimension would pass one of these.
    expect(plain.display("=SORT(A1:C4,4)")).toBe("#VALUE!");
    expect(plain.display("=SORT(A1:C4,4,1,TRUE)")).toBe("2");
    expect(plain.display("=SORT(A1:C4,5,1,TRUE)")).toBe("#VALUE!");
  });
});

describe("SORTBY", () => {
  const plain = sheet(REGIONS);

  it("sorts by a vector that is not in the block", () => {
    expect(plain.column("=SORTBY(B1:B4,C1:C4,1)", 4)).toEqual([
      "gamma",
      "beta",
      "alpha",
      "delta",
    ]);
  });

  it("lets a second key speak only where the first ties", () => {
    // The first key alone leaves beta, alpha, delta in input order. A second
    // key reorders exactly those three and leaves gamma where it was, which
    // is what makes this a tiebreak rather than a second sort.
    const first = plain.column("=SORTBY(B1:B4,C1:C4,1)", 4);
    const ascending = plain.column("=SORTBY(B1:B4,C1:C4,1,B1:B4,1)", 4);
    const descending = plain.column("=SORTBY(B1:B4,C1:C4,1,B1:B4,-1)", 4);
    expect(ascending).toEqual(["gamma", "alpha", "beta", "delta"]);
    expect(descending).toEqual(["gamma", "delta", "beta", "alpha"]);
    expect(ascending).not.toEqual(first);
    expect(descending).not.toEqual(first);
    for (const result of [first, ascending, descending]) {
      expect(result[0]).toBe("gamma");
    }
  });

  it("reads a row of keys as sorting columns", () => {
    const across = sheet({ E1: 3, F1: 1, G1: 2, E2: "c", F2: "a", G2: "b" });
    expect(across.block("=SORTBY(E2:G2,E1:G1,1)", 1, 3)).toEqual([["a", "b", "c"]]);
  });

  it("refuses a key of the wrong length, or one that is not a vector", () => {
    expect(plain.display("=SORTBY(B1:B4,C1:C3,1)")).toBe("#VALUE!");
    expect(plain.display("=SORTBY(B1:B4,A1:C4,1)")).toBe("#VALUE!");
    expect(plain.display("=SORTBY(B1:B4,C1:C4,3)")).toBe("#VALUE!");
  });
});

describe("FILTER", () => {
  const plain = sheet(REGIONS);

  it("keeps the rows a column of conditions selects", () => {
    expect(plain.block("=FILTER(A1:C4,C1:C4=2)", 3, 3)).toEqual([
      ["north", "beta", 2],
      ["north", "alpha", 2],
      ["north", "delta", 2],
    ]);
  });

  it("keeps columns when the conditions are a row", () => {
    const across = sheet({ E1: 3, F1: 1, G1: 2, E2: "c", F2: "a", G2: "b" });
    expect(across.block("=FILTER(E1:G2,E1:G1>1)", 2, 2)).toEqual([
      [3, 2],
      ["c", "b"],
    ]);
  });

  it("reports that nothing matched rather than spilling nothing", () => {
    expect(plain.display("=FILTER(A1:C4,C1:C4>99)")).toBe("#CALC!");
  });

  it("shows the third argument instead, when there is one", () => {
    expect(plain.value('=FILTER(A1:C4,C1:C4>99,"none matched")')).toBe("none matched");
    expect(plain.value("=FILTER(A1:C4,C1:C4>99,0)")).toBe(0);
    // And the third argument is not consulted when something did match.
    expect(plain.block('=FILTER(A1:C4,C1:C4=1,"none matched")', 1, 3)).toEqual([
      ["south", "gamma", 1],
    ]);
  });

  it("refuses a condition of the wrong length, and passes an error through", () => {
    expect(plain.display("=FILTER(A1:C4,C1:C3=2)")).toBe("#VALUE!");
    expect(plain.display("=FILTER(A1:C4,A1:C4=2)")).toBe("#VALUE!");
    // `north` is not a condition, and saying so is better than treating it as
    // one: a filter that silently dropped unreadable rows would report a
    // subset as the answer.
    expect(plain.display("=FILTER(A1:C4,A1:A4)")).toBe("#VALUE!");
  });
});

describe("UNIQUE", () => {
  it("gives the distinct rows, in the order they first appear", () => {
    const plain = sheet(REGIONS);
    expect(plain.column("=UNIQUE(A1:A4)", 2)).toEqual(["north", "south"]);
    expect(plain.block("=UNIQUE(A1:C4)", 4, 3).length).toBe(4);
  });

  it("compares whole rows, not cells", () => {
    const repeated = sheet({
      A1: "x",
      B1: 1,
      A2: "x",
      B2: 2,
      A3: "x",
      B3: 1,
    });
    expect(repeated.block("=UNIQUE(A1:B3)", 2, 2)).toEqual([
      ["x", 1],
      ["x", 2],
    ]);
  });

  it("can keep only the lines that appear once", () => {
    const plain = sheet(REGIONS);
    expect(plain.column("=UNIQUE(A1:A4,FALSE,TRUE)", 1)).toEqual(["south"]);
    // Every line repeated means nothing appears once, which is the empty
    // answer again.
    const twice = sheet({ A1: "x", A2: "x" });
    expect(twice.display("=UNIQUE(A1:A2,FALSE,TRUE)")).toBe("#CALC!");
  });

  it("works across a row when asked", () => {
    const across = sheet({ E1: 3, F1: 1, G1: 3 });
    expect(across.block("=UNIQUE(E1:G1,TRUE)", 1, 2)).toEqual([[3, 1]]);
  });

  it("calls two lines the same exactly when the sheet's `=` does", () => {
    const mixed = sheet({ A1: "Fig", A2: "fig" });
    expect(mixed.value("=(A1=A2)")).toBe(true);
    expect(mixed.column("=UNIQUE(A1:A2)", 1)).toEqual(["Fig"]);
    expect(mixed.num("=ARRAYROWS(UNIQUE(A1:A2))")).toBe(1);
  });
});

describe("the equality UNIQUE inherits is not transitive", () => {
  // Which is the reason the distinct lines are found by comparing against
  // each one kept rather than by hashing. A blank cell takes the *type* of
  // whatever it is compared with and that type's zero, so it equals both 0
  // and the empty string while those two are not equal to each other. No
  // hash can represent that, and the consequence is that the answer depends
  // on the order the lines arrive in — which is a property of the sheet's
  // comparison rules, not a defect in this function.

  it("has the sheet itself report the non-transitive triple", () => {
    // A2 holds a real empty string: typing one into a cell clears it.
    const book = new Workbook();
    book.setCells({ A1: 0, A2: '=""' });
    const read = (formula: string): Value => {
      book.setCell("Z90", formula);
      return book.getValue("Z90");
    };
    expect(read("=ISBLANK(A3)")).toBe(true);
    expect(read("=(A1=A3)")).toBe(true);
    expect(read("=(A2=A3)")).toBe(true);
    expect(read("=(A1=A2)")).toBe(false);
  });

  it("answers with a different number of lines depending on the order", () => {
    const rows = (cells: Record<string, string | number>): number => {
      const book = new Workbook();
      book.setCells(cells);
      book.setCell("Z90", "=ARRAYROWS(UNIQUE(A1:A3))");
      const seen = book.getValue("Z90");
      if (typeof seen !== "number") throw new Error(JSON.stringify(seen));
      return seen;
    };
    // 0 first: the blank joins the 0, and the empty string stands alone.
    expect(rows({ A1: 0, A2: '=""' })).toBe(2);
    // The empty string first: the blank joins it, and the 0 stands alone.
    expect(rows({ A1: '=""', A2: 0 })).toBe(2);
    // The blank first: it absorbs both, and one line comes back.
    expect(rows({ A2: 0, A3: '=""' })).toBe(1);
  });
});

describe("#CALC!", () => {
  it("is an error code the engine can carry", () => {
    expect(ERROR_CODES).toContain("#CALC!");
    expect(isErrorCode("#CALC!")).toBe(true);
  });

  it("is not something a formula can type, the way #SPILL! is not", () => {
    // Both are produced by the engine rather than written by a user, and the
    // lexer's literal list is where that distinction lives.
    expect(() => tokenize("=#CALC!")).toThrow();
    expect(() => tokenize("=#SPILL!")).toThrow();
    expect(() => tokenize("=#VALUE!")).not.toThrow();
  });

  it("is caught by IFERROR like any other", () => {
    const plain = sheet(REGIONS);
    expect(plain.value('=IFERROR(FILTER(A1:C4,C1:C4>99),"nothing")')).toBe("nothing");
    expect(plain.value("=ISERROR(FILTER(A1:C4,C1:C4>99))")).toBe(true);
  });
});
