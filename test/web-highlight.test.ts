import { describe, expect, it } from "vitest";

import {
  PALETTE_SLOTS,
  highlightFormula,
  referenceAt,
  slotForCell,
} from "../web/src/core/highlight.js";
import type { Highlight } from "../web/src/core/highlight.js";

function kinds(highlight: Highlight): string[] {
  return highlight.spans.map((span) => span.kind);
}

function labels(highlight: Highlight): string[] {
  return highlight.references.map((reference) => reference.label);
}

/** The spans must tile the source exactly, or a rendered overlay drifts. */
function rejoin(highlight: Highlight): string {
  return highlight.spans.map((span) => span.text).join("");
}

describe("highlightFormula on literals", () => {
  it("leaves plain text alone", () => {
    const highlight = highlightFormula("hello");
    expect(kinds(highlight)).toEqual(["plain"]);
    expect(highlight.references).toEqual([]);
  });

  it("returns no spans for empty input", () => {
    expect(highlightFormula("").spans).toEqual([]);
  });

  it("treats a bare number as text, not a formula", () => {
    expect(kinds(highlightFormula("42"))).toEqual(["plain"]);
  });
});

describe("highlightFormula token classification", () => {
  it("separates a call from its arguments", () => {
    const highlight = highlightFormula("=SUM(A1,2)");
    expect(kinds(highlight)).toEqual([
      "operator",
      "function",
      "paren",
      "reference",
      "operator",
      "number",
      "paren",
    ]);
  });

  it("classifies a word before a paren as a function even when it reads as a reference", () => {
    // `LOG10` is both a function name and column LOG row 10.
    const call = highlightFormula("=LOG10(100)");
    expect(call.spans[1]?.kind).toBe("function");
    expect(call.references).toEqual([]);

    const reference = highlightFormula("=LOG10");
    expect(reference.spans[1]?.kind).toBe("reference");
    expect(labels(reference)).toEqual(["LOG10"]);
  });

  it("marks an unknown bare word as a name", () => {
    const highlight = highlightFormula("=TaxRate*2");
    expect(kinds(highlight)).toEqual(["operator", "name", "operator", "number"]);
  });

  it("keeps strings and error literals distinct", () => {
    const highlight = highlightFormula('="ok"&#N/A');
    expect(kinds(highlight)).toEqual([
      "operator",
      "string",
      "operator",
      "error",
    ]);
  });
});

describe("highlightFormula references", () => {
  it("collapses a range into one span", () => {
    const highlight = highlightFormula("=SUM(A1:B2)");
    const range = highlight.spans.find((span) => span.kind === "reference");
    expect(range?.text).toBe("A1:B2");
    expect(labels(highlight)).toEqual(["A1:B2"]);
  });

  it("gives every distinct reference its own slot", () => {
    const highlight = highlightFormula("=A1+B2+C3");
    expect(highlight.references.map((r) => r.slot)).toEqual([0, 1, 2]);
  });

  it("reuses a slot for a repeated reference", () => {
    const highlight = highlightFormula("=A1+B2+A1");
    expect(highlight.references.map((r) => r.slot)).toEqual([0, 1, 0]);
  });

  it("ignores anchors when deciding whether two references match", () => {
    const highlight = highlightFormula("=$A$1+A1");
    expect(highlight.references.map((r) => r.slot)).toEqual([0, 0]);
    expect(labels(highlight)).toEqual(["A1", "A1"]);
  });

  it("normalises a range written from the far corner", () => {
    const highlight = highlightFormula("=SUM(C3:A1)");
    expect(labels(highlight)).toEqual(["A1:C3"]);
  });

  it("cycles the palette once every slot is used", () => {
    const cells = ["A1", "B1", "C1", "D1", "E1", "F1", "G1"];
    const highlight = highlightFormula(`=${cells.join("+")}`);
    expect(highlight.references.map((r) => r.slot)).toEqual([
      0, 1, 2, 3, 4, 5, 0,
    ]);
    expect(PALETTE_SLOTS).toBe(6);
  });

  it("does not treat a colon between non-references as a range", () => {
    const highlight = highlightFormula("=Alpha:Beta");
    expect(highlight.references).toEqual([]);
    expect(kinds(highlight)).toEqual(["operator", "name", "operator", "name"]);
  });
});

describe("highlightFormula span integrity", () => {
  const sources = [
    "=SUM(A1:B2)+Rate",
    "=  A1  +  2  ",
    '=IF(A1>0,"yes","no")',
    "=-A1%",
    "=SUM(A1:A9)/COUNT(A1:A9)",
    "=((A1))",
  ];

  it.each(sources)("spans tile %s exactly", (source) => {
    const highlight = highlightFormula(source);
    expect(rejoin(highlight)).toBe(source);
  });

  it.each(sources)("spans of %s are contiguous and ordered", (source) => {
    const highlight = highlightFormula(source);
    let cursor = 0;
    for (const span of highlight.spans) {
      expect(span.start).toBe(cursor);
      expect(span.end).toBeGreaterThan(span.start);
      expect(span.text).toBe(source.slice(span.start, span.end));
      cursor = span.end;
    }
    expect(cursor).toBe(source.length);
  });
});

describe("highlightFormula on text that will not tokenise", () => {
  it("reports the error and still returns the whole text", () => {
    const highlight = highlightFormula('="unterminated');
    expect(highlight.error).toContain("unterminated string");
    expect(rejoin(highlight)).toBe('="unterminated');
  });

  it("keeps highlighting a formula that is merely incomplete", () => {
    // Half-typed, so it will not parse, but it tokenises fine.
    const highlight = highlightFormula("=SUM(A1:B2");
    expect(highlight.error).toBeNull();
    expect(labels(highlight)).toEqual(["A1:B2"]);
  });
});

describe("reference lookup helpers", () => {
  const highlight = highlightFormula("=SUM(A1:B2)+D4");

  it("finds the reference under the caret", () => {
    expect(referenceAt(highlight, 6)?.label).toBe("A1:B2");
    expect(referenceAt(highlight, 13)?.label).toBe("D4");
    expect(referenceAt(highlight, 2)).toBeNull();
  });

  it("colours every cell inside a referenced range", () => {
    expect(slotForCell(highlight, 0, 0)).toBe(0);
    expect(slotForCell(highlight, 1, 1)).toBe(0);
    expect(slotForCell(highlight, 3, 3)).toBe(1);
  });

  it("leaves unreferenced cells uncoloured", () => {
    expect(slotForCell(highlight, 5, 5)).toBeNull();
    expect(slotForCell(highlight, 2, 0)).toBeNull();
  });
});
