import { describe, expect, it } from "vitest";
import {
  MAX_COLUMNS,
  MAX_ROWS,
  ReferenceError_,
  cellKey,
  columnToLabel,
  formatA1,
  formatRange,
  iterateRange,
  labelToColumn,
  makeRef,
  normalizeRange,
  parseA1,
  parseCellKey,
  rangeContains,
  rangeSize,
  translateRange,
  translateRef,
} from "../src/engine/reference.js";

describe("column labels", () => {
  const cases: Array<[number, string]> = [
    [0, "A"],
    [1, "B"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
    [51, "AZ"],
    [52, "BA"],
    [701, "ZZ"],
    [702, "AAA"],
    [703, "AAB"],
    [16383, "XFD"],
  ];

  it.each(cases)("encodes column %i as %s", (col, label) => {
    expect(columnToLabel(col)).toBe(label);
  });

  it.each(cases)("decodes %s back to column %i", (col, label) => {
    expect(labelToColumn(label)).toBe(col);
  });

  it("round-trips every column index", () => {
    for (let col = 0; col < MAX_COLUMNS; col += 37) {
      expect(labelToColumn(columnToLabel(col))).toBe(col);
    }
    expect(labelToColumn(columnToLabel(MAX_COLUMNS - 1))).toBe(MAX_COLUMNS - 1);
  });

  it("is case-insensitive", () => {
    expect(labelToColumn("aa")).toBe(26);
    expect(labelToColumn("aA")).toBe(26);
  });

  it("rejects out-of-range indices and labels", () => {
    expect(() => columnToLabel(-1)).toThrow(ReferenceError_);
    expect(() => columnToLabel(MAX_COLUMNS)).toThrow(ReferenceError_);
    expect(() => labelToColumn("")).toThrow(ReferenceError_);
    expect(() => labelToColumn("A1")).toThrow(ReferenceError_);
    expect(() => labelToColumn("XFE")).toThrow(ReferenceError_);
  });
});

describe("A1 parsing", () => {
  it("parses relative references", () => {
    expect(parseA1("A1")).toEqual(makeRef(0, 0, false, false));
    expect(parseA1("B7")).toEqual(makeRef(1, 6, false, false));
    expect(parseA1("AA100")).toEqual(makeRef(26, 99, false, false));
  });

  it("parses each anchor combination", () => {
    expect(parseA1("$B7")).toEqual(makeRef(1, 6, true, false));
    expect(parseA1("B$7")).toEqual(makeRef(1, 6, false, true));
    expect(parseA1("$B$7")).toEqual(makeRef(1, 6, true, true));
  });

  it("accepts lower case", () => {
    expect(parseA1("b7")).toEqual(makeRef(1, 6, false, false));
  });

  it("collapses anchor spellings to one cell key", () => {
    const keys = ["B7", "$B7", "B$7", "$B$7"].map((t) => cellKey(parseA1(t)));
    expect(new Set(keys).size).toBe(1);
  });

  it("rejects malformed references", () => {
    for (const bad of ["", "1A", "A", "7", "A0", "$$A1", "A1:B2", "A 1"]) {
      expect(() => parseA1(bad), bad).toThrow(ReferenceError_);
    }
  });

  it("rejects rows past the sheet limit", () => {
    expect(() => parseA1(`A${MAX_ROWS + 1}`)).toThrow(ReferenceError_);
    expect(parseA1(`A${MAX_ROWS}`).row).toBe(MAX_ROWS - 1);
  });

  it("round-trips formatting", () => {
    for (const text of ["A1", "$A1", "A$1", "$A$1", "XFD1048576", "AA27"]) {
      expect(formatA1(parseA1(text))).toBe(text);
    }
  });
});

describe("cell keys", () => {
  it("round-trips through parseCellKey", () => {
    const coord = { col: 12, row: 340 };
    expect(parseCellKey(cellKey(coord))).toEqual(coord);
  });

  it("rejects malformed keys", () => {
    expect(() => parseCellKey("12")).toThrow(ReferenceError_);
    expect(() => parseCellKey("a:b")).toThrow(ReferenceError_);
  });
});

const range = (a: string, b: string) => ({ start: parseA1(a), end: parseA1(b) });

describe("ranges", () => {
  it("normalises reversed corners", () => {
    expect(formatRange(normalizeRange(range("C5", "A1")))).toBe("A1:C5");
    expect(formatRange(normalizeRange(range("A1", "C5")))).toBe("A1:C5");
  });

  it("orders columns and rows independently", () => {
    expect(formatRange(normalizeRange(range("C1", "A5")))).toBe("A1:C5");
  });

  it("keeps each anchor with the coordinate that carried it", () => {
    const normalised = normalizeRange(range("$C5", "A$1"));
    expect(formatRange(normalised)).toBe("A$1:$C5");
  });

  it("computes size", () => {
    expect(rangeSize(range("A1", "A1"))).toBe(1);
    expect(rangeSize(range("A1", "C5"))).toBe(15);
    expect(rangeSize(range("C5", "A1"))).toBe(15);
  });

  it("tests containment regardless of corner order", () => {
    expect(rangeContains(range("A1", "C5"), parseA1("B3"))).toBe(true);
    expect(rangeContains(range("C5", "A1"), parseA1("B3"))).toBe(true);
    expect(rangeContains(range("A1", "C5"), parseA1("D3"))).toBe(false);
    expect(rangeContains(range("A1", "C5"), parseA1("B6"))).toBe(false);
  });

  it("iterates in row-major order", () => {
    const seen = [...iterateRange(range("A1", "B2"))].map(
      (c) => `${c.col},${c.row}`,
    );
    expect(seen).toEqual(["0,0", "1,0", "0,1", "1,1"]);
  });

  it("iterates exactly rangeSize cells", () => {
    const r = range("B2", "E9");
    expect([...iterateRange(r)]).toHaveLength(rangeSize(r));
  });
});

describe("translation", () => {
  it("shifts relative axes only", () => {
    expect(formatA1(translateRef(parseA1("B7"), 2, 3)!)).toBe("D10");
    expect(formatA1(translateRef(parseA1("$B7"), 2, 3)!)).toBe("$B10");
    expect(formatA1(translateRef(parseA1("B$7"), 2, 3)!)).toBe("D$7");
    expect(formatA1(translateRef(parseA1("$B$7"), 2, 3)!)).toBe("$B$7");
  });

  it("is a no-op for a zero delta", () => {
    expect(translateRef(parseA1("Q42"), 0, 0)).toEqual(parseA1("Q42"));
  });

  it("composes additively", () => {
    const once = translateRef(translateRef(parseA1("C3"), 1, 1)!, 2, 4)!;
    const direct = translateRef(parseA1("C3"), 3, 5)!;
    expect(once).toEqual(direct);
  });

  it("returns null when pushed off the sheet", () => {
    expect(translateRef(parseA1("A1"), -1, 0)).toBeNull();
    expect(translateRef(parseA1("A1"), 0, -1)).toBeNull();
    expect(translateRef(parseA1("XFD1"), 1, 0)).toBeNull();
    expect(translateRef(parseA1(`A${MAX_ROWS}`), 0, 1)).toBeNull();
  });

  it("keeps anchored references on-sheet when the delta would not be", () => {
    expect(translateRef(parseA1("$A$1"), -5, -5)).toEqual(parseA1("$A$1"));
  });

  it("translates both corners of a range", () => {
    const moved = translateRange(range("A1", "B2"), 1, 1)!;
    expect(formatRange(moved)).toBe("B2:C3");
  });

  it("fails the whole range if one corner falls off", () => {
    expect(translateRange(range("A1", "B2"), -1, 0)).toBeNull();
  });
});
