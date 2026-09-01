import { describe, expect, it } from "vitest";

import { Workbook } from "../src/engine/workbook.js";

describe("fillDown", () => {
  it("copies a formula down and shifts its references", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, A3: 3, B1: "=A1*2" });
    book.fillDown("B1:B3");
    expect(book.getInput("B2")).toBe("=A2*2");
    expect(book.getInput("B3")).toBe("=A3*2");
    expect(book.getValue("B3")).toBe(6);
  });

  it("holds an anchored reference still", () => {
    const book = new Workbook();
    book.setCells({ A1: 10, B1: "=$A$1*2" });
    book.fillDown("B1:B3");
    expect(book.getInput("B3")).toBe("=$A$1*2");
    expect(book.getValue("B3")).toBe(20);
  });

  it("moves only the relative half of a mixed reference", () => {
    const book = new Workbook();
    book.setCell("C1", "=$A1+B$1");
    book.fillDown("C1:C3");
    expect(book.getInput("C3")).toBe("=$A3+B$1");
  });

  it("copies literals verbatim", () => {
    const book = new Workbook();
    book.setCells({ A1: "widget" });
    book.fillDown("A1:A3");
    expect(book.getValue("A3")).toBe("widget");
  });

  it("fills every column of a block", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, B1: 2, A2: 0, B2: 0, C1: "=A1+B1" });
    book.setCells({ A2: 5, B2: 6 });
    book.fillDown("C1:C2");
    expect(book.getValue("C2")).toBe(11);
  });

  it("blanks the target when the source cell is empty", () => {
    const book = new Workbook();
    book.setCells({ A2: 7, A3: 8 });
    book.fillDown("A1:A3");
    expect(book.cellCount).toBe(0);
  });

  it("does nothing for a single-row block", () => {
    const book = new Workbook();
    book.setCell("A1", "=1+1");
    book.fillDown("A1:A1");
    expect(book.cellCount).toBe(1);
  });

  it("recalculates the filled cells once, correctly", () => {
    const book = new Workbook();
    book.setCells({ A1: 100, A2: 200, A3: 300, B1: "=A1/10" });
    book.fillDown("B1:B3");
    expect([1, 2, 3].map((r) => book.getValue(`B${r}`))).toEqual([10, 20, 30]);
  });

  it("keeps the dependency graph pointing at the new precedents", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, B1: "=A1" });
    book.fillDown("B1:B2");
    expect(book.precedentsOf("B2")).toEqual(["A2"]);
    book.setCell("A2", 9);
    expect(book.getValue("B2")).toBe(9);
  });

  it("carries a range reference down with it", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, A3: 3, A4: 4, C1: "=SUM(A1:A2)" });
    book.fillDown("C1:C3");
    expect(book.getInput("C3")).toBe("=SUM(A3:A4)");
    expect(book.getValue("C3")).toBe(7);
  });
});

describe("fillRight", () => {
  it("copies a formula across and shifts its references", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, B1: 2, C1: 3, A2: "=A1*10" });
    book.fillRight("A2:C2");
    expect(book.getInput("C2")).toBe("=C1*10");
    expect(book.getValue("C2")).toBe(30);
  });

  it("fills every row of a block", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, B1: "=A1+1", B2: "=A2+1" });
    book.fillRight("B1:C2");
    expect(book.getValue("C1")).toBe(3);
    expect(book.getValue("C2")).toBe(4);
  });

  it("does nothing for a single-column block", () => {
    const book = new Workbook();
    book.setCell("A1", 5);
    book.fillRight("A1:A9");
    expect(book.cellCount).toBe(1);
  });
});

describe("copy and paste", () => {
  it("captures what was typed, not what was shown", () => {
    const book = new Workbook();
    book.setCells({ A1: 2, A2: "=A1*3" });
    const clip = book.copy("A1:A2");
    expect(clip.cells).toEqual([["2"], ["=A1*3"]]);
    expect(clip.width).toBe(1);
    expect(clip.height).toBe(2);
  });

  it("records blanks as blanks", () => {
    const book = new Workbook();
    book.setCell("A1", 1);
    expect(book.copy("A1:B1").cells).toEqual([["1", null]]);
  });

  it("translates formulas by the distance moved", () => {
    const book = new Workbook();
    book.setCells({ A1: 5, B1: "=A1*2" });
    book.paste(book.copy("B1"), "B4");
    expect(book.getInput("B4")).toBe("=A4*2");
  });

  it("pastes a block and keeps its internal references relative", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, B1: "=A1", B2: "=A2+B1" });
    const clip = book.copy("B1:B2");
    book.paste(clip, "D5");
    expect(book.getInput("D5")).toBe("=C5");
    expect(book.getInput("D6")).toBe("=C6+D5");
  });

  it("blanks the target where the copied cell was blank", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, C1: 99 });
    book.paste(book.copy("A1:B1"), "C1");
    expect(book.getValue("C1")).toBe(1);
    expect(book.has("D1")).toBe(false);
  });

  it("survives the source being edited after the copy", () => {
    const book = new Workbook();
    book.setCells({ A1: 5, B1: "=A1*2" });
    const clip = book.copy("B1");
    book.setCell("B1", 0);
    book.paste(clip, "B3");
    expect(book.getInput("B3")).toBe("=A3*2");
  });

  it("leaves a pasted anchored reference pointing where it did", () => {
    const book = new Workbook();
    book.setCells({ A1: 4, B1: "=$A$1+A1" });
    book.paste(book.copy("B1"), "C3");
    expect(book.getInput("C3")).toBe("=$A$1+B3");
  });

  it("produces #REF! when a paste pushes a reference off the sheet", () => {
    const book = new Workbook();
    book.setCells({ B2: 1, C2: "=B2" });
    book.paste(book.copy("C2"), "A1");
    expect(book.getInput("A1")).toBe("=#REF!");
    expect(book.getValue("A1")).toMatchObject({ code: "#REF!" });
  });

  it("pastes to the same place without changing anything", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, B1: "=A1*2" });
    book.paste(book.copy("B1"), "B1");
    expect(book.getInput("B1")).toBe("=A1*2");
  });
});

describe("clearBlock", () => {
  it("empties every occupied cell in the block", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, A2: 2, B1: 3, C1: 4 });
    book.clearBlock("A1:B2");
    expect(book.toInputMap()).toEqual({ C1: "4" });
  });

  it("recalculates whatever read the cleared cells", () => {
    const book = new Workbook();
    book.setCells({ A1: 2, A2: 3, C1: "=SUM(A1:A2)" });
    book.clearBlock("A1:A2");
    expect(book.getValue("C1")).toBe(0);
  });

  it("costs nothing on an empty block", () => {
    const book = new Workbook();
    book.setCell("A1", 1);
    book.clearBlock("D1:Z99");
    expect(book.cellCount).toBe(1);
  });
});
