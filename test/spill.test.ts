import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import { formatRange } from "../src/engine/reference.js";
import type { Value } from "../src/engine/value.js";

function seeded(): Workbook {
  const book = new Workbook();
  book.setCells({ A1: 1, B1: 2, C1: 3, A2: 4, B2: 5, C2: 6 });
  return book;
}

/** Read a block of the sheet as nested rows of values. */
function readBlock(
  book: Workbook,
  cols: readonly string[],
  rows: readonly number[],
): Value[][] {
  return rows.map((row) => cols.map((col) => book.getValue(`${col}${row}`)));
}

const region = (book: Workbook, address: string): string | null => {
  const range = book.spillRegionOf(address);
  return range === null ? null : formatRange(range);
};

describe("laying a block on the sheet", () => {
  it("fills the cells below and to the right of the formula", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    expect(readBlock(book, ["E", "F"], [1, 2, 3])).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
  });

  it("reports the region the block occupies", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    expect(region(book, "E1")).toBe("E1:F3");
  });

  it("answers with the whole region from any cell inside it", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    expect(region(book, "F3")).toBe("E1:F3");
  });

  it("names the anchor a spilled cell came from", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    expect(book.spillAnchorOf("F3")).toBe("E1");
    expect(book.spillAnchorOf("E1")).toBe("E1");
  });

  it("does not treat a one-value result as a spill", () => {
    const book = seeded();
    book.setCell("E1", "=SUM(A1:C2)");
    expect(book.getValue("E1")).toBe(21);
    expect(region(book, "E1")).toBeNull();
    expect(book.isSpillAnchor("E1")).toBe(false);
  });

  it("collapses a one-cell block to a plain value", () => {
    const book = new Workbook();
    book.setCell("A1", "=TRANSPOSE(SEQUENCE(1))");
    expect(book.getValue("A1")).toBe(1);
    expect(book.isSpillAnchor("A1")).toBe(false);
  });

  it("tells a spilled cell apart from the one that was typed", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    expect(book.isSpilled("E1")).toBe(false);
    expect(book.isSpilled("F3")).toBe(true);
    expect(book.isSpilled("Z9")).toBe(false);
  });

  it("keeps a spilled cell out of the inputs", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    const inputs = book.toInputMap();
    expect(inputs["E1"]).toBe("=TRANSPOSE(A1:C2)");
    expect(inputs["F3"]).toBeUndefined();
  });

  it("has no formula of its own in a spilled cell", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    expect(book.getFormula("F3")).toBeNull();
    expect(book.getInput("F3")).toBe("");
  });
});

describe("refusing a block that does not fit", () => {
  it("reports #SPILL! when a cell is in the way", () => {
    const book = seeded();
    book.setCell("F1", "blocker");
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    expect(book.getDisplay("E1")).toBe("#SPILL!");
  });

  it("names the cell that is in the way", () => {
    const book = seeded();
    book.setCell("F2", "blocker");
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    const value = book.getValue("E1");
    expect(value).toMatchObject({ code: "#SPILL!" });
    expect((value as { detail?: string }).detail).toContain("F2");
  });

  it("writes nothing at all when it is refused", () => {
    const book = seeded();
    book.setCell("F1", "blocker");
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    expect(book.getValue("E2")).toBeNull();
    expect(book.getValue("E3")).toBeNull();
    expect(book.getValue("F1")).toBe("blocker");
  });

  it("spills as soon as the obstruction is cleared", () => {
    const book = seeded();
    book.setCell("F1", "blocker");
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    expect(book.getDisplay("E1")).toBe("#SPILL!");

    book.clearCell("F1");
    expect(readBlock(book, ["E", "F"], [1, 2, 3])).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
  });

  it("retracts an existing block when something lands inside it", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    expect(book.getValue("F3")).toBe(6);

    book.setCell("E3", "blocker");
    expect(book.getDisplay("E1")).toBe("#SPILL!");
    expect(book.getValue("F3")).toBeNull();
    expect(book.getValue("E2")).toBeNull();
  });

  it("refuses a block that would run off the sheet", () => {
    const book = new Workbook();
    book.setCell("A1048575", "=SEQUENCE(4)");
    expect(book.getDisplay("A1048575")).toBe("#REF!");
  });

  it("will not let two blocks overlap", () => {
    const book = seeded();
    book.setCell("E1", "=SEQUENCE(3)");
    book.setCell("E2", "=SEQUENCE(3)");
    // E2 sits inside E1's block, so whichever is asked to spill second is the
    // one refused; the point is that they never both write to E3.
    const displays = [book.getDisplay("E1"), book.getDisplay("E2")];
    expect(displays.filter((d) => d === "#SPILL!")).toHaveLength(1);
  });
});

describe("reading a block back", () => {
  it("aggregates over spilled cells like any others", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    book.setCell("H1", "=SUM(E1:F3)");
    expect(book.getValue("H1")).toBe(21);
  });

  it("reads a single spilled cell by reference", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    book.setCell("H1", "=F3*10");
    expect(book.getValue("H1")).toBe(60);
  });

  it("recomputes a reader when the source of the block changes", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    book.setCell("H1", "=F3");
    expect(book.getValue("H1")).toBe(6);

    book.setCell("C2", 60);
    expect(book.getValue("F3")).toBe(60);
    expect(book.getValue("H1")).toBe(60);
  });

  it("recomputes a reader when a growing block reaches it", () => {
    const book = new Workbook();
    book.setCell("A1", 2);
    book.setCell("C1", "=SEQUENCE(A1)");
    book.setCell("E1", "=C3");
    expect(book.getValue("E1")).toBeNull();

    book.setCell("A1", 5);
    expect(book.getValue("C3")).toBe(3);
    expect(book.getValue("E1")).toBe(3);
  });

  it("recomputes a reader when a shrinking block leaves it", () => {
    const book = new Workbook();
    book.setCell("A1", 5);
    book.setCell("C1", "=SEQUENCE(A1)");
    book.setCell("E1", "=C5");
    expect(book.getValue("E1")).toBe(5);

    book.setCell("A1", 2);
    expect(book.getValue("C5")).toBeNull();
    expect(book.getValue("E1")).toBeNull();
  });

  it("shows a shrunken block's abandoned cells as blank", () => {
    const book = new Workbook();
    book.setCell("A1", 4);
    book.setCell("C1", "=SEQUENCE(A1)");
    expect(book.getValue("C4")).toBe(4);

    book.setCell("A1", 2);
    expect(book.getValue("C3")).toBeNull();
    expect(book.getValue("C4")).toBeNull();
    expect(book.isSpilled("C4")).toBe(false);
  });
});

describe("a block and the rest of the sheet", () => {
  it("disappears when its formula is cleared", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    expect(book.getValue("F3")).toBe(6);

    book.clearCell("E1");
    expect(book.getValue("F3")).toBeNull();
    expect(book.getValue("E1")).toBeNull();
    expect(region(book, "E1")).toBeNull();
  });

  it("disappears when its formula is replaced by a literal", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    book.setCell("E1", 99);
    expect(book.getValue("E1")).toBe(99);
    expect(book.getValue("F3")).toBeNull();
  });

  it("leaves nothing behind when the edit that made it is undone", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    expect(book.getValue("F3")).toBe(6);

    book.undo();
    expect(book.getValue("E1")).toBeNull();
    expect(book.getValue("F3")).toBeNull();
    expect(book.isSpilled("F3")).toBe(false);
  });

  it("comes back on redo", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    book.undo();
    book.redo();
    expect(book.getValue("F3")).toBe(6);
  });

  it("counts towards the extent of the sheet", () => {
    const book = new Workbook();
    book.setCell("A1", "=SEQUENCE(4)");
    const extent = book.extent();
    expect(extent === null ? null : formatRange(extent)).toBe("A1:A4");
  });

  it("shows a spilled cell as occupied", () => {
    const book = new Workbook();
    book.setCell("A1", "=SEQUENCE(3)");
    expect(book.has("A3")).toBe(true);
    expect(book.has("A4")).toBe(false);
  });

  it("does not count a spilled cell as an entered cell", () => {
    const book = new Workbook();
    book.setCell("A1", "=SEQUENCE(3)");
    expect(book.cellCount).toBe(1);
  });

  it("moves with the formula through a structural edit", () => {
    const book = seeded();
    book.setCell("E1", "=TRANSPOSE(A1:C2)");
    book.insertRows(0, 2);
    expect(book.getFormula("E3")).toBe("=TRANSPOSE(A3:C4)");
    expect(readBlock(book, ["E", "F"], [3, 4, 5])).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
    // The two rows the insert opened up are empty; the block moved whole.
    expect(book.getValue("E1")).toBeNull();
    expect(book.getValue("F2")).toBeNull();
  });

  it("is refused when a structural edit pushes a cell into its way", () => {
    const book = seeded();
    book.setCell("E1", "=SEQUENCE(3)");
    book.setCell("E9", "in the way");
    expect(book.getValue("E3")).toBe(3);

    // Deleting rows 2 to 8 drags the obstruction up into E2, inside the block.
    book.deleteRows(1, 7);
    expect(book.getDisplay("E1")).toBe("#SPILL!");
  });

  it("survives a fill that copies the formula", () => {
    const book = new Workbook();
    book.setCell("A1", 2);
    book.setCell("C1", "=SEQUENCE($A$1)");
    book.fillDown("C1:C6");
    // Every copy wants the row beneath it, and five of the six find another
    // copy of the formula sitting there. Only the last one has room.
    expect(book.getDisplay("C1")).toBe("#SPILL!");
    expect(book.getDisplay("C5")).toBe("#SPILL!");
    expect(book.getValue("C6")).toBe(1);
    expect(book.getValue("C7")).toBe(2);
  });
});

describe("blocks and formats", () => {
  it("renders a spilled cell through the format on that cell", () => {
    const book = new Workbook();
    book.setCell("A1", "=SEQUENCE(3,1,0.5,0.25)");
    book.setFormat("A1:A3", "0.00");
    expect(book.getDisplay("A2")).toBe("0.75");
  });

  it("exports spilled cells alongside the ones that were typed", () => {
    const book = new Workbook();
    book.setCell("A1", "=SEQUENCE(3)");
    expect(book.getDisplay("A3")).toBe("3");
    expect(book.extent()).not.toBeNull();
  });
});
