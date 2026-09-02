/**
 * The formats the grid offers, and what the current selection is wearing.
 *
 * A format code is a language, and a menu is a bad place to type one. The
 * presets are the handful of shapes a financial sheet actually uses, each
 * spelled out as the code it applies — so what the menu does is the same
 * operation the shell and the library expose, not a parallel one.
 *
 * The logic here is arithmetic over the selection, so it lives away from the
 * DOM and is checked directly rather than through a browser.
 */

import { formatWith } from "../../../src/format/render.js";
import { formatValue, kindOf } from "../../../src/engine/value.js";
import type { Value } from "../../../src/engine/value.js";
import type { Command, CommandContext } from "./commands.js";

export type FormatPresetId =
  | "format-general"
  | "format-number"
  | "format-integer"
  | "format-currency"
  | "format-thousands"
  | "format-millions"
  | "format-percent"
  | "format-scientific";

export interface FormatPreset {
  readonly id: FormatPresetId;
  readonly label: string;
  /** The code applied. Empty means back to the general format. */
  readonly code: string;
}

export const FORMAT_PRESETS: readonly FormatPreset[] = [
  { id: "format-general", label: "General", code: "" },
  { id: "format-number", label: "Number", code: "#,##0.00" },
  { id: "format-integer", label: "Whole number", code: "#,##0" },
  {
    id: "format-currency",
    label: "Currency",
    code: "$#,##0.00;[Red]($#,##0.00)",
  },
  { id: "format-thousands", label: "Thousands", code: '#,##0.0,"k"' },
  { id: "format-millions", label: "Millions", code: '#,##0.0,,"M"' },
  { id: "format-percent", label: "Percent", code: "0.0%" },
  { id: "format-scientific", label: "Scientific", code: "0.00E+00" },
];

/**
 * The number a preview falls back to when the cell has no number in it.
 *
 * Large enough to show grouping and small enough to stay readable as a
 * percentage, which is the pair of demands the eight presets make of one
 * value.
 */
const STAND_IN = 1234.5;

const BY_ID = new Map(FORMAT_PRESETS.map((preset) => [preset.id, preset]));

export function formatPreset(id: FormatPresetId): FormatPreset {
  const preset = BY_ID.get(id);
  if (preset === undefined) {
    throw new Error(`unknown format preset: ${id}`);
  }
  return preset;
}

export function isFormatPresetId(id: string): id is FormatPresetId {
  return BY_ID.has(id as FormatPresetId);
}

/**
 * What format the selection is wearing.
 *
 * `null` is the general format and `"mixed"` is a selection that disagrees
 * with itself — which is a real answer and not an error, so the menu shows
 * nothing as current rather than picking one arbitrarily.
 */
export type SelectionFormat = string | null | "mixed";

export function selectionFormat(
  codes: readonly (string | null)[],
): SelectionFormat {
  if (codes.length === 0) return null;
  const first = codes[0] ?? null;
  return codes.every((code) => (code ?? null) === first) ? first : "mixed";
}

/**
 * How the selection's format reads in the inspector.
 *
 * A code the presets know is named; anything else — typed from the shell, or
 * pasted in — is shown as itself rather than as "custom", because the code is
 * the more useful thing to see.
 */
export function describeFormat(current: SelectionFormat): string {
  if (current === "mixed") return "mixed";
  if (current === null || current === "") return "general";
  const preset = FORMAT_PRESETS.find((entry) => entry.code === current);
  return preset === undefined ? current : preset.label;
}

/**
 * What a preset would do to a value, for the menu's right-hand column.
 *
 * Previewing against the selected cell's own number is the difference between
 * a list of names and a decision: "Millions" means nothing next to a figure
 * of 2,400,000 until it reads `2.4M`. A cell holding text or nothing has no
 * number to preview, so a stand-in stands in.
 */
export function previewFormat(preset: FormatPreset, value: Value): string {
  const subject = kindOf(value) === "number" ? value : STAND_IN;
  if (preset.code === "") return formatValue(subject);
  return formatWith(preset.code, subject).text;
}

/**
 * The format menu for a selection.
 *
 * Every preset is always available: applying a format to an empty cell is
 * meaningful, since the format waits there for whatever is typed next.
 */
export function formatCommands(
  _context: CommandContext,
  current: SelectionFormat,
  value: Value = null,
): Command[] {
  return FORMAT_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    enabled: true,
    hint: previewFormat(preset, value),
    checked: current !== "mixed" && (current ?? "") === preset.code,
  }));
}
