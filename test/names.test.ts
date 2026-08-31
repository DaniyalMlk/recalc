import { describe, expect, it } from "vitest";

import {
  NameError,
  NameTable,
  parseTarget,
  validateName,
} from "../src/engine/names.js";
import { formatRange } from "../src/engine/reference.js";
import { Workbook } from "../src/engine/workbook.js";

describe("validateName", () => {
  it("accepts the shape a formula word takes", () => {
    expect(validateName("Revenue")).toBe("REVENUE");
    expect(validateName("_private")).toBe("_PRIVATE");
    expect(validateName("tax.rate.2")).toBe("TAX.RATE.2");
  });

  it("upper-cases and trims", () => {
    expect(validateName("  MixedCase  ")).toBe("MIXEDCASE");
  });

  it("rejects an empty name", () => {
    expect(() => validateName("   ")).toThrow(NameError);
  });

  it("rejects a name that would not lex as one word", () => {
    expect(() => validateName("has space")).toThrow(NameError);
    expect(() => validateName("2fast")).toThrow(NameError);
    expect(() => validateName("has-dash")).toThrow(NameError);
  });

  it("rejects anything a formula already reads as something else", () => {
    // These would mean two things depending on which resolver ran first.
    expect(() => validateName("A1")).toThrow(/cell reference/);
    expect(() => validateName("$B$7")).toThrow(/cell reference/);
    expect(() => validateName("TRUE")).toThrow(/boolean literal/);
    expect(() => validateName("false")).toThrow(/boolean literal/);
  });

  it("allows a word that only looks like a reference", () => {
    // Four letters is past the column limit, so this is a name.
    expect(validateName("ABCD1")).toBe("ABCD1");
  });
});

describe("parseTarget", () => {
  it("reads a cell", () => {
    expect(parseTarget("B2")).toMatchObject({ kind: "cell" });
  });

  it("reads a range and normalises it", () => {
    const binding = parseTarget("C9:A1");
    expect(binding?.kind).toBe("range");
    if (binding?.kind === "range") {
      expect(formatRange(binding.range)).toBe("A1:C9");
    }
  });

  it("keeps anchors out of the way", () => {
    expect(parseTarget("$B$2:$B$13")?.kind).toBe("range");
  });

  it("returns null for anything that is not a reference", () => {
    expect(parseTarget("hello")).toBeNull();
    expect(parseTarget("")).toBeNull();
    expect(parseTarget("B2:")).toBeNull();
  });
});

describe("NameTable", () => {
  it("stores and reads back a constant", () => {
    const table = new NameTable();
    table.setValue("Rate", 0.11);
    expect(table.get("rate")).toEqual({ kind: "value", value: 0.11 });
  });

  it("stores a reference", () => {
    const table = new NameTable();
    table.setReference("Revenue", "B2:B13");
    expect(table.get("REVENUE")?.kind).toBe("range");
  });

  it("refuses a target that points nowhere", () => {
    const table = new NameTable();
    expect(() => table.setReference("Bad", "not a range")).toThrow(NameError);
    expect(table.has("Bad")).toBe(false);
  });

  it("redefines rather than duplicating", () => {
    const table = new NameTable();
    table.setValue("Rate", 0.11);
    table.setReference("Rate", "B3");
    expect(table.size).toBe(1);
    expect(table.get("Rate")?.kind).toBe("cell");
  });

  it("deletes and reports whether anything went", () => {
    const table = new NameTable();
    table.setValue("Rate", 1);
    expect(table.delete("RATE")).toBe(true);
    expect(table.delete("RATE")).toBe(false);
  });

  it("lists names in order", () => {
    const table = new NameTable();
    table.setValue("Zeta", 1);
    table.setValue("Alpha", 2);
    expect(table.list().map((entry) => entry.name)).toEqual(["ALPHA", "ZETA"]);
  });
});

describe("named constants in a workbook", () => {
  it("resolves a bare word in a formula", () => {
    const book = new Workbook();
    book.setName("Rate", 0.2);
    book.setCell("A1", 1000);
    book.setCell("A2", "=A1*Rate");
    expect(book.getValue("A2")).toBe(200);
  });

  it("is case-insensitive at the point of use", () => {
    const book = new Workbook();
    book.setName("Rate", 0.2);
    book.setCell("A1", "=rate*10");
    expect(book.getValue("A1")).toBe(2);
  });

  it("reports an unknown name rather than throwing", () => {
    const book = new Workbook();
    book.setCell("A1", "=Missing+1");
    expect(book.getDisplay("A1")).toBe("#NAME?");
  });

  it("recalculates the users when the constant changes", () => {
    const book = new Workbook();
    book.setName("Rate", 0.2);
    book.setCell("A1", 1000);
    book.setCell("A2", "=A1*Rate");

    book.setName("Rate", 0.5);
    expect(book.getValue("A2")).toBe(500);
  });
});

describe("named ranges in a workbook", () => {
  function model(): Workbook {
    const book = new Workbook();
    book.setCells({
      B2: 100,
      B3: 250,
      B4: 400,
      C1: 7,
    });
    book.defineName("Revenue", "B2:B4");
    book.defineName("Units", "C1");
    return book;
  }

  it("aggregates a named range", () => {
    const book = model();
    book.setCell("D1", "=SUM(Revenue)");
    expect(book.getValue("D1")).toBe(750);
  });

  it("behaves exactly like the written-out range", () => {
    const book = model();
    book.setCell("D1", "=SUM(Revenue)");
    book.setCell("D2", "=SUM(B2:B4)");
    book.setCell("D3", "=AVERAGE(Revenue)");
    book.setCell("D4", "=AVERAGE(B2:B4)");

    expect(book.getValue("D1")).toBe(book.getValue("D2"));
    expect(book.getValue("D3")).toBe(book.getValue("D4"));
  });

  it("resolves a single-cell name in scalar position", () => {
    const book = model();
    book.setCell("D1", "=Units*2");
    expect(book.getValue("D1")).toBe(14);
  });

  it("is #VALUE! when a multi-cell name lands in scalar position", () => {
    const book = model();
    book.setCell("D1", "=Revenue+1");
    expect(book.getDisplay("D1")).toBe("#VALUE!");
  });

  it("recalculates when a cell inside the named range changes", () => {
    const book = model();
    book.setCell("D1", "=SUM(Revenue)");

    // Nothing in D1's text mentions B3, so this only works if the name was
    // expanded into the graph when the formula was stored.
    book.setCell("B3", 1250);
    expect(book.getValue("D1")).toBe(1750);
  });

  it("recalculates when a named single cell changes", () => {
    const book = model();
    book.setCell("D1", "=Units*2");
    book.setCell("C1", 10);
    expect(book.getValue("D1")).toBe(20);
  });

  it("records the named cells as precedents", () => {
    const book = model();
    book.setCell("D1", "=SUM(Revenue)");
    expect(book.precedentsOf("D1")).toContain("B2:B4");
    expect(book.dependentsOf("B3")).toContain("D1");
  });

  it("follows the name when it is pointed somewhere else", () => {
    const book = model();
    book.setCells({ E2: 1, E3: 2 });
    book.setCell("D1", "=SUM(Revenue)");
    expect(book.getValue("D1")).toBe(750);

    book.defineName("Revenue", "E2:E3");
    expect(book.getValue("D1")).toBe(3);

    // And the old range must no longer reach it.
    book.setCell("B2", 99999);
    expect(book.getValue("D1")).toBe(3);
    // While the new one must.
    book.setCell("E3", 20);
    expect(book.getValue("D1")).toBe(21);
  });

  it("falls back to #NAME? when the name is deleted", () => {
    const book = model();
    book.setCell("D1", "=SUM(Revenue)");
    expect(book.deleteName("Revenue")).toBe(true);
    expect(book.getDisplay("D1")).toBe("#NAME?");
  });

  it("comes back to life when the name is defined again", () => {
    const book = model();
    book.setCell("D1", "=SUM(Revenue)");
    book.deleteName("Revenue");
    book.defineName("Revenue", "B2:B4");
    expect(book.getValue("D1")).toBe(750);
  });

  it("reports deleting a name that was never defined", () => {
    expect(new Workbook().deleteName("Nope")).toBe(false);
  });

  it("refuses a name that a formula would read as a cell", () => {
    const book = new Workbook();
    expect(() => book.defineName("B2", "C3")).toThrow(NameError);
  });

  it("lists what is defined", () => {
    const book = model();
    expect(book.names().map((entry) => entry.name)).toEqual([
      "REVENUE",
      "UNITS",
    ]);
    expect(book.names()[0]?.target).toBe("B2:B4");
  });

  it("survives a name pointing at an empty region", () => {
    const book = new Workbook();
    book.defineName("Empty", "Z1:Z9");
    book.setCell("A1", "=SUM(Empty)");
    expect(book.getValue("A1")).toBe(0);
    expect(book.getValue("A1")).toBe(0);
  });

  it("threads a name through a chain of formulas", () => {
    const book = model();
    book.setCells({
      D1: "=SUM(Revenue)",
      D2: "=D1*2",
      D3: "=D2+Units",
    });
    expect(book.getValue("D3")).toBe(750 * 2 + 7);

    book.setCell("B4", 0);
    expect(book.getValue("D3")).toBe(350 * 2 + 7);
  });

  it("does not recalculate cells that never mentioned the name", () => {
    const book = model();
    book.setCells({ D1: "=SUM(Revenue)", D5: "=C1*3" });
    // D5 reads C1 directly, so pointing Units elsewhere must not move it.
    book.defineName("Units", "B2");
    expect(book.getValue("D5")).toBe(21);
  });
});
