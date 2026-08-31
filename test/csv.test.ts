import { describe, expect, it } from "vitest";

import {
  CsvError,
  exportCsv,
  exportRows,
  formatCsv,
  importCsv,
  importRows,
  parseCsv,
} from "../src/io/csv.js";
import { formatRange } from "../src/engine/reference.js";
import { Workbook } from "../src/engine/workbook.js";

describe("parseCsv", () => {
  it("reads plain rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("returns no rows for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("does not invent a row from a trailing newline", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
    expect(parseCsv("a,b\r\n")).toEqual([["a", "b"]]);
  });

  it("keeps an empty trailing field", () => {
    expect(parseCsv("a,b,")).toEqual([["a", "b", ""]]);
  });

  it("keeps a row of nothing but separators", () => {
    expect(parseCsv(",,")).toEqual([["", "", ""]]);
  });

  it("accepts both line endings, including mixed", () => {
    expect(parseCsv("a\r\nb\nc")).toEqual([["a"], ["b"], ["c"]]);
  });

  it("strips a byte order mark", () => {
    expect(parseCsv("﻿a,b")).toEqual([["a", "b"]]);
  });

  it("allows ragged rows", () => {
    expect(parseCsv("a,b,c\nd\ne,f")).toEqual([
      ["a", "b", "c"],
      ["d"],
      ["e", "f"],
    ]);
  });
});

describe("parseCsv quoting", () => {
  it("keeps a delimiter inside quotes", () => {
    expect(parseCsv('"Smith, John",42')).toEqual([["Smith, John", "42"]]);
  });

  it("keeps a newline inside quotes", () => {
    expect(parseCsv('"line one\nline two",x')).toEqual([
      ["line one\nline two", "x"],
    ]);
  });

  it("keeps a CRLF inside quotes verbatim", () => {
    expect(parseCsv('"a\r\nb"')).toEqual([["a\r\nb"]]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('"she said ""no"""')).toEqual([['she said "no"']]);
  });

  it("reads an empty quoted field", () => {
    expect(parseCsv('a,"",b')).toEqual([["a", "", "b"]]);
  });

  it("treats a quote mid-field as a literal character", () => {
    expect(parseCsv('he said "no",x')).toEqual([['he said "no"', "x"]]);
  });

  it("preserves whitespace inside quotes", () => {
    expect(parseCsv('"  padded  ",x')).toEqual([["  padded  ", "x"]]);
  });

  it("rejects an unterminated quoted field", () => {
    expect(() => parseCsv('"never closed')).toThrow(CsvError);
  });
});

describe("parseCsv delimiters", () => {
  it("reads semicolon-separated data", () => {
    expect(parseCsv("a;b;c", { delimiter: ";" })).toEqual([["a", "b", "c"]]);
  });

  it("reads tab-separated data", () => {
    expect(parseCsv("a\tb", { delimiter: "\t" })).toEqual([["a", "b"]]);
  });

  it("leaves a comma alone when the delimiter is something else", () => {
    expect(parseCsv("a,b;c", { delimiter: ";" })).toEqual([["a,b", "c"]]);
  });

  it("rejects a delimiter that would break the grammar", () => {
    expect(() => parseCsv("a", { delimiter: '"' })).toThrow(CsvError);
    expect(() => parseCsv("a", { delimiter: "\n" })).toThrow(CsvError);
    expect(() => parseCsv("a", { delimiter: ",," })).toThrow(CsvError);
  });
});

describe("formatCsv", () => {
  it("leaves ordinary fields bare", () => {
    expect(formatCsv([["a", "b"]], { newline: "\n" })).toBe("a,b");
  });

  it("quotes only what needs it", () => {
    const text = formatCsv([["plain", "has,comma", 'has"quote', "has\nnewline"]], {
      newline: "\n",
    });
    expect(text).toBe('plain,"has,comma","has""quote","has\nnewline"');
  });

  it("quotes fields with edge whitespace", () => {
    expect(formatCsv([[" padded "]], { newline: "\n" })).toBe('" padded "');
  });

  it("uses CRLF by default", () => {
    expect(formatCsv([["a"], ["b"]])).toBe("a\r\nb");
  });

  it("does not quote a comma when the delimiter is a semicolon", () => {
    expect(formatCsv([["a,b"]], { delimiter: ";", newline: "\n" })).toBe("a,b");
  });
});

describe("CSV round trip", () => {
  const awkward = [
    ["plain", "with,comma", 'with"quote'],
    ["with\nnewline", "with\r\ncrlf", "  padded  "],
    ["", "0", "-1.5e10"],
    ['"', ",", "\n"],
    ["unicode ✓", "tab\there", "'apostrophe"],
  ];

  it.each([",", ";", "\t", "|"])(
    "survives a round trip with %j as the delimiter",
    (delimiter) => {
      const text = formatCsv(awkward, { delimiter, newline: "\r\n" });
      expect(parseCsv(text, { delimiter })).toEqual(awkward);
    },
  );

  it("survives a round trip through LF line endings", () => {
    const text = formatCsv(awkward, { newline: "\n" });
    expect(parseCsv(text)).toEqual(awkward);
  });
});

describe("importRows", () => {
  it("lands the first field on the origin", () => {
    const book = new Workbook();
    const result = importRows(book, [
      ["Region", "Units"],
      ["North", "1200"],
    ]);

    expect(book.getValue("A1")).toBe("Region");
    expect(book.getValue("B2")).toBe(1200);
    expect(result.cells).toBe(4);
    expect(formatRange(result.range!)).toBe("A1:B2");
  });

  it("honours a different origin", () => {
    const book = new Workbook();
    const result = importRows(book, [["x"]], { origin: "C5" });
    expect(book.getValue("C5")).toBe("x");
    expect(formatRange(result.range!)).toBe("C5:C5");
  });

  it("clears rather than storing an empty string", () => {
    const book = new Workbook();
    book.setCell("B1", "leftover");
    importRows(book, [["a", ""]]);
    expect(book.has("B1")).toBe(false);
  });

  it("reads a leading equals as a formula by default", () => {
    const book = new Workbook();
    importRows(book, [
      ["2", "3"],
      ["=A1*B1", ""],
    ]);
    expect(book.getValue("A2")).toBe(6);
  });

  it("keeps a leading equals as text when formulas are off", () => {
    const book = new Workbook();
    importRows(book, [["=A1*B1"]], { formulas: false });
    expect(book.getValue("A1")).toBe("=A1*B1");
    expect(book.getFormula("A1")).toBeNull();
  });

  it("keeps a leading apostrophe as text when formulas are off", () => {
    const book = new Workbook();
    importRows(book, [["'quoted"]], { formulas: false });
    expect(book.getValue("A1")).toBe("'quoted");
  });

  it("reports no range when every field was empty", () => {
    const book = new Workbook();
    const result = importRows(book, [["", ""], [""]]);
    expect(result).toEqual({ cells: 0, range: null });
  });

  it("excludes trailing empty rows and columns from the range", () => {
    const book = new Workbook();
    const result = importRows(book, [
      ["a", "", ""],
      ["", "", ""],
    ]);
    expect(formatRange(result.range!)).toBe("A1:A1");
  });
});

describe("exportRows", () => {
  function model(): Workbook {
    const book = new Workbook();
    book.setCells({
      A1: "Units",
      B1: "Price",
      C1: "Revenue",
      A2: 1200,
      B2: 24.5,
      C2: "=A2*B2",
    });
    return book;
  }

  it("writes the used range by default", () => {
    expect(exportRows(model())).toEqual([
      ["Units", "Price", "Revenue"],
      ["1200", "24.5", "29400"],
    ]);
  });

  it("writes formula text in formulas mode", () => {
    expect(exportRows(model(), { mode: "formulas" })[1]).toEqual([
      "1200",
      "24.5",
      "=A2*B2",
    ]);
  });

  it("writes a named region only", () => {
    expect(exportRows(model(), { range: "A1:B1" })).toEqual([
      ["Units", "Price"],
    ]);
  });

  it("writes a single cell", () => {
    expect(exportRows(model(), { range: "C2" })).toEqual([["29400"]]);
  });

  it("writes nothing for an empty sheet", () => {
    expect(exportRows(new Workbook())).toEqual([]);
  });

  it("writes blanks inside the used range as empty fields", () => {
    const book = new Workbook();
    book.setCells({ A1: "a", C1: "c" });
    expect(exportRows(book)).toEqual([["a", "", "c"]]);
  });

  it("writes an error by its code", () => {
    const book = new Workbook();
    book.setCell("A1", "=1/0");
    expect(exportRows(book)).toEqual([["#DIV/0!"]]);
  });
});

describe("CSV against a workbook", () => {
  it("re-imports an exported sheet unchanged", () => {
    const book = new Workbook();
    book.setCells({
      A1: "Item, with comma",
      B1: 'quote " inside',
      A2: "=LEN(A1)",
      B2: "=UPPER(A1)",
    });

    const text = exportCsv(book, { mode: "formulas" });
    const restored = new Workbook();
    importCsv(restored, text);

    expect(restored.toInputMap()).toEqual(book.toInputMap());
    expect(restored.getValue("A2")).toBe(book.getValue("A2"));
    expect(restored.getValue("B2")).toBe(book.getValue("B2"));
  });

  it("recalculates the imported formulas rather than trusting the file", () => {
    const book = new Workbook();
    importCsv(book, "2,3,=A1*B1");
    expect(book.getValue("C1")).toBe(6);

    book.setCell("A1", 10);
    expect(book.getValue("C1")).toBe(30);
  });

  it("carries a multi-line field through the sheet and back", () => {
    const book = new Workbook();
    importCsv(book, '"first\nsecond",x');
    expect(book.getValue("A1")).toBe("first\nsecond");
    expect(exportCsv(book, { newline: "\n" })).toBe('"first\nsecond",x');
  });
});
