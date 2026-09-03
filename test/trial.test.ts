import { describe, expect, it } from "vitest";

import { Workbook } from "../src/engine/workbook.js";

/**
 * A trial is a lie the sheet tells itself and then takes back. The tests that
 * matter are not about the answer it produces but about what it leaves behind:
 * the cells, the graph, the formats and the undo history all have to come out
 * the way they went in, including when the body throws.
 */
describe("trial", () => {
  function model(): Workbook {
    const book = new Workbook();
    book.setCells({
      A1: 10,
      A2: 3,
      B1: "=A1*A2",
      B2: "=B1+100",
      C1: "=SUM(A1:A2)",
    });
    book.clearHistory();
    return book;
  }

  it("evaluates the sheet as though the override had been typed", () => {
    const book = model();
    expect(book.probe([["A1", "20"]], "B2")).toBe(160);
  });

  it("restores the original input afterwards", () => {
    const book = model();
    book.probe([["A1", "20"]], "B2");
    expect(book.getInput("A1")).toBe("10");
    expect(book.getValue("B1")).toBe(30);
    expect(book.getValue("B2")).toBe(130);
  });

  it("puts a formula back as a formula, not as its value", () => {
    const book = model();
    book.probe([["B1", "999"]], "B2");
    expect(book.getInput("B1")).toBe("=A1*A2");
    expect(book.getFormula("B1")).toBe("=A1*A2");
    expect(book.getValue("B2")).toBe(130);
  });

  it("overrides a cell that was empty and leaves it empty", () => {
    const book = model();
    expect(book.probe([["A3", "5"]], "C1")).toBe(13);
    expect(book.has("A3")).toBe(false);
    expect(book.getValue("C1")).toBe(13);
  });

  it("records nothing in the undo history", () => {
    const book = model();
    book.probe([["A1", "20"]], "B2");
    expect(book.canUndo).toBe(false);
    expect(book.canRedo).toBe(false);
  });

  it("leaves the history alone even when there is one", () => {
    const book = model();
    book.setCell("A1", 11);
    const label = book.undoLabel;
    book.probe([["A1", "20"]], "B2");
    expect(book.undoLabel).toBe(label);
    book.undo();
    expect(book.getValue("A1")).toBe(10);
  });

  it("restores the sheet when the body throws", () => {
    const book = model();
    expect(() =>
      book.trial([["A1", "20"]], () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(book.getInput("A1")).toBe("10");
    expect(book.getValue("B2")).toBe(130);
    expect(book.canUndo).toBe(false);
  });

  it("overrides several cells at once", () => {
    const book = model();
    expect(book.probe([["A1", "2"], ["A2", "5"]], "B1")).toBe(10);
    expect(book.getValue("B1")).toBe(30);
  });

  it("supports a trial inside a trial", () => {
    const book = model();
    const inner = book.trial([["A1", "20"]], () =>
      book.probe([["A2", "10"]], "B1"),
    );
    expect(inner).toBe(200);
    expect(book.getInput("A1")).toBe("10");
    expect(book.getInput("A2")).toBe("3");
    expect(book.canUndo).toBe(false);
  });

  it("substitutes a formula, not just a literal", () => {
    const book = model();
    expect(book.probe([["A1", "=A2*4"]], "B1")).toBe(36);
    expect(book.getValue("B1")).toBe(30);
    expect(book.precedentsOf("A1")).toEqual([]);
  });

  it("leaves the dependency graph as it found it", () => {
    const book = model();
    const before = book.dependentsOf("A1").sort();
    book.probe([["A1", "=A2"]], "B1");
    expect(book.dependentsOf("A1").sort()).toEqual(before);
    expect(book.precedentsOf("B1").sort()).toEqual(["A1", "A2"]);
  });

  it("returns whatever the body returns", () => {
    const book = model();
    const seen = book.trial([["A1", "4"]], () => [
      book.getValue("B1"),
      book.getValue("B2"),
    ]);
    expect(seen).toEqual([12, 112]);
  });

  it("keeps formats through a trial", () => {
    const book = model();
    book.setFormat("B2", "#,##0.00");
    book.probe([["A1", "20"]], "B2");
    expect(book.formatOf("B2")).toBe("#,##0.00");
    expect(book.getDisplay("B2")).toBe("130.00");
  });
});

describe("dependsOn", () => {
  function chain(): Workbook {
    const book = new Workbook();
    book.setCells({
      A1: 2,
      B1: "=A1*2",
      C1: "=B1+1",
      D1: 7,
      E1: "=SUM(A1:B1)",
    });
    return book;
  }

  it("sees a direct read", () => {
    expect(chain().dependsOn("B1", "A1")).toBe(true);
  });

  it("sees a read through a chain", () => {
    expect(chain().dependsOn("C1", "A1")).toBe(true);
  });

  it("sees a read through a range", () => {
    expect(chain().dependsOn("E1", "A1")).toBe(true);
  });

  it("is false for an unrelated cell", () => {
    expect(chain().dependsOn("C1", "D1")).toBe(false);
  });

  it("is false in the wrong direction", () => {
    expect(chain().dependsOn("A1", "C1")).toBe(false);
  });

  it("is false for a cell and itself", () => {
    expect(chain().dependsOn("B1", "B1")).toBe(false);
  });

  it("follows a name to what it stands for", () => {
    const book = new Workbook();
    book.setCell("A1", 5);
    book.defineName("Rate", "A1");
    book.setCell("B1", "=Rate*2");
    expect(book.dependsOn("B1", "A1")).toBe(true);
  });
});
