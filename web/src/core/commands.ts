/**
 * What the current selection can do, and what to call it.
 *
 * The menus and the toolbar both need the same answers — is there anything to
 * paste, how many rows would an insert open, what does undo actually undo — and
 * the labels have to agree with what the command will really do. Working that
 * out is arithmetic over the selection, so it lives here with no DOM in sight
 * and is checked directly rather than through a browser.
 */

import { columnToLabel } from "../../../src/engine/reference.js";
import type { CellRect } from "./selection.js";

export type CommandId =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "fill-down"
  | "fill-right"
  | "clear"
  | "insert-rows"
  | "delete-rows"
  | "insert-columns"
  | "delete-columns";

export interface Command {
  readonly id: CommandId;
  readonly label: string;
  readonly enabled: boolean;
  /** Keyboard shortcut, already spelled for this platform. */
  readonly hint?: string;
}

export interface CommandContext {
  readonly rect: CellRect;
  /** Whether anything has been copied yet. */
  readonly hasClipboard: boolean;
  /** Whether the selection covers at least one non-empty cell. */
  readonly hasContent: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  /** Spell shortcuts with the Command symbol rather than "Ctrl". */
  readonly mac: boolean;
}

export function rowCount(rect: CellRect): number {
  return rect.bottom - rect.top + 1;
}

export function columnCount(rect: CellRect): number {
  return rect.right - rect.left + 1;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : `${count} ${many}`;
}

/** `4`, or `4–6` for a span. */
function rowSpan(rect: CellRect): string {
  return rect.top === rect.bottom
    ? String(rect.top + 1)
    : `${rect.top + 1}–${rect.bottom + 1}`;
}

/** `C`, or `C–E` for a span. */
function columnSpan(rect: CellRect): string {
  return rect.left === rect.right
    ? columnToLabel(rect.left)
    : `${columnToLabel(rect.left)}–${columnToLabel(rect.right)}`;
}

function shortcut(context: CommandContext, key: string, shift = false): string {
  const modifier = context.mac ? "⌘" : "Ctrl+";
  return `${modifier}${shift ? "Shift+" : ""}${key}`;
}

/**
 * The clipboard and fill commands.
 *
 * Fill is only offered when there is somewhere to fill into: a one-row
 * selection has no rows beneath it inside the block, so the command would be a
 * no-op and a menu item that does nothing is worse than one that is not there.
 */
export function editCommands(context: CommandContext): Command[] {
  const { rect } = context;
  return [
    {
      id: "cut",
      label: "Cut",
      enabled: context.hasContent,
      hint: shortcut(context, "X"),
    },
    {
      id: "copy",
      label: "Copy",
      enabled: context.hasContent,
      hint: shortcut(context, "C"),
    },
    {
      id: "paste",
      label: "Paste",
      enabled: context.hasClipboard,
      hint: shortcut(context, "V"),
    },
    {
      id: "fill-down",
      label: "Fill down",
      enabled: rowCount(rect) > 1,
      hint: shortcut(context, "D"),
    },
    {
      id: "fill-right",
      label: "Fill right",
      enabled: columnCount(rect) > 1,
      hint: shortcut(context, "R"),
    },
    {
      id: "clear",
      label: "Clear contents",
      enabled: context.hasContent,
      hint: "Delete",
    },
  ];
}

/** The commands offered from a row header. */
export function rowCommands(context: CommandContext): Command[] {
  const { rect } = context;
  const count = rowCount(rect);
  return [
    {
      id: "insert-rows",
      label: `Insert ${plural(count, "row above", "rows above")}`,
      enabled: true,
    },
    {
      id: "delete-rows",
      label: `Delete ${count === 1 ? "row" : "rows"} ${rowSpan(rect)}`,
      enabled: true,
    },
  ];
}

/** The commands offered from a column header. */
export function columnCommands(context: CommandContext): Command[] {
  const { rect } = context;
  const count = columnCount(rect);
  return [
    {
      id: "insert-columns",
      label: `Insert ${plural(count, "column left", "columns left")}`,
      enabled: true,
    },
    {
      id: "delete-columns",
      label: `Delete ${count === 1 ? "column" : "columns"} ${columnSpan(rect)}`,
      enabled: true,
    },
  ];
}

/**
 * The two history commands, labelled with what they would actually do.
 *
 * "Undo" alone makes the user guess; "Undo insert 3 rows at 4" does not. The
 * label comes from the workbook's own journal, so it can never drift from what
 * pressing the button will do.
 */
export function historyCommands(context: CommandContext): Command[] {
  return [
    {
      id: "undo",
      label:
        context.undoLabel === null ? "Undo" : `Undo ${context.undoLabel}`,
      enabled: context.canUndo,
      hint: shortcut(context, "Z"),
    },
    {
      id: "redo",
      label:
        context.redoLabel === null ? "Redo" : `Redo ${context.redoLabel}`,
      enabled: context.canRedo,
      hint: shortcut(context, "Z", true),
    },
  ];
}
