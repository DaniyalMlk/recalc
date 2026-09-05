import { describe, expect, it } from "vitest";

import {
  columnCommands,
  columnCount,
  editCommands,
  historyCommands,
  rowCommands,
  rowCount,
} from "../web/src/core/commands.js";
import type {
  Command,
  CommandContext,
  CommandId,
} from "../web/src/core/commands.js";
import type { CellRect } from "../web/src/core/selection.js";
import { Workbook } from "../src/engine/workbook.js";

const rect = (
  top: number,
  left: number,
  bottom = top,
  right = left,
): CellRect => ({ top, left, bottom, right });

const context = (over: Partial<CommandContext> = {}): CommandContext => ({
  rect: rect(0, 0),
  hasClipboard: false,
  hasContent: true,
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
  mac: false,
  ...over,
});

const find = (list: readonly Command[], id: CommandId): Command =>
  list.find((command) => command.id === id)!;

describe("counting a selection", () => {
  it("counts a single cell as one row and one column", () => {
    expect(rowCount(rect(3, 3))).toBe(1);
    expect(columnCount(rect(3, 3))).toBe(1);
  });

  it("counts a block", () => {
    expect(rowCount(rect(2, 1, 5, 4))).toBe(4);
    expect(columnCount(rect(2, 1, 5, 4))).toBe(4);
  });
});

describe("editCommands", () => {
  it("disables paste until something has been copied", () => {
    expect(find(editCommands(context()), "paste").enabled).toBe(false);
    expect(
      find(editCommands(context({ hasClipboard: true })), "paste").enabled,
    ).toBe(true);
  });

  it("disables copy and clear on an empty selection", () => {
    const commands = editCommands(context({ hasContent: false }));
    expect(find(commands, "copy").enabled).toBe(false);
    expect(find(commands, "cut").enabled).toBe(false);
    expect(find(commands, "clear").enabled).toBe(false);
  });

  it("offers fill down only when there is a row to fill into", () => {
    expect(find(editCommands(context()), "fill-down").enabled).toBe(false);
    expect(
      find(editCommands(context({ rect: rect(0, 0, 4, 0) })), "fill-down")
        .enabled,
    ).toBe(true);
  });

  it("offers fill right only when there is a column to fill into", () => {
    expect(find(editCommands(context()), "fill-right").enabled).toBe(false);
    expect(
      find(editCommands(context({ rect: rect(0, 0, 0, 3) })), "fill-right")
        .enabled,
    ).toBe(true);
  });

  it("spells shortcuts for the platform", () => {
    expect(find(editCommands(context()), "copy").hint).toBe("Ctrl+C");
    expect(find(editCommands(context({ mac: true })), "copy").hint).toBe("⌘C");
  });
});

describe("rowCommands", () => {
  it("names one row in the singular", () => {
    const commands = rowCommands(context({ rect: rect(3, 0) }));
    expect(find(commands, "insert-rows").label).toBe("Insert row above");
    expect(find(commands, "delete-rows").label).toBe("Delete row 4");
  });

  it("counts the rows an insert would open", () => {
    const commands = rowCommands(context({ rect: rect(3, 0, 5, 0) }));
    expect(find(commands, "insert-rows").label).toBe("Insert 3 rows above");
  });

  it("names the span a delete would remove", () => {
    const commands = rowCommands(context({ rect: rect(3, 0, 5, 0) }));
    expect(find(commands, "delete-rows").label).toBe("Delete rows 4–6");
  });
});

describe("columnCommands", () => {
  it("names one column by its letter", () => {
    const commands = columnCommands(context({ rect: rect(0, 2) }));
    expect(find(commands, "insert-columns").label).toBe("Insert column left");
    expect(find(commands, "delete-columns").label).toBe("Delete column C");
  });

  it("names a span of columns by their letters", () => {
    const commands = columnCommands(context({ rect: rect(0, 2, 0, 4) }));
    expect(find(commands, "insert-columns").label).toBe(
      "Insert 3 columns left",
    );
    expect(find(commands, "delete-columns").label).toBe("Delete columns C–E");
  });

  it("keeps working past the single-letter columns", () => {
    const commands = columnCommands(context({ rect: rect(0, 26) }));
    expect(find(commands, "delete-columns").label).toBe("Delete column AA");
  });
});

describe("historyCommands", () => {
  it("is disabled with an empty history", () => {
    const commands = historyCommands(context());
    expect(find(commands, "undo").enabled).toBe(false);
    expect(find(commands, "undo").label).toBe("Undo");
  });

  it("says what it would undo", () => {
    const commands = historyCommands(
      context({ canUndo: true, undoLabel: "insert 3 rows at 4" }),
    );
    expect(find(commands, "undo").label).toBe("Undo insert 3 rows at 4");
    expect(find(commands, "undo").enabled).toBe(true);
  });

  it("says what it would redo", () => {
    const commands = historyCommands(
      context({ canRedo: true, redoLabel: "paste" }),
    );
    expect(find(commands, "redo").label).toBe("Redo paste");
    expect(find(commands, "redo").hint).toBe("Ctrl+Shift+Z");
  });
});

describe("clearing the sheet", () => {
  it("takes the formats with it", () => {
    const book = new Workbook();
    book.setCell("B3", 0.11);
    book.setFormat("B3:B4", "0.0%");
    expect(book.formatEntries()).toHaveLength(2);

    // The same two steps the toolbar's Clear sheet performs.
    for (const entry of book.formatEntries()) book.clearFormat(entry.address);
    book.setCells(
      Object.fromEntries(
        Object.keys(book.toInputMap()).map((address) => [address, null]),
      ),
    );

    expect(book.formatEntries()).toEqual([]);
    book.setCell("B3", 3);
    expect(book.getDisplay("B3")).toBe("3");
  });
});
