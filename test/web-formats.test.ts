import { describe, expect, it } from "vitest";
import { err } from "../src/engine/errors.js";
import {
  FORMAT_PRESETS,
  describeFormat,
  formatCommands,
  formatPreset,
  isFormatPresetId,
  previewFormat,
  selectionFormat,
} from "../web/src/core/formats.js";
import { parseFormatCode } from "../src/format/code.js";
import type { CommandContext } from "../web/src/core/commands.js";

const context: CommandContext = {
  rect: { top: 0, left: 0, bottom: 0, right: 0 },
  hasClipboard: false,
  hasContent: true,
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
  mac: false,
};

describe("the presets", () => {
  it("all compile", () => {
    for (const preset of FORMAT_PRESETS) {
      if (preset.code === "") continue;
      expect(() => parseFormatCode(preset.code)).not.toThrow();
    }
  });

  it("have unique ids and labels", () => {
    const ids = new Set(FORMAT_PRESETS.map((preset) => preset.id));
    const labels = new Set(FORMAT_PRESETS.map((preset) => preset.label));
    expect(ids.size).toBe(FORMAT_PRESETS.length);
    expect(labels.size).toBe(FORMAT_PRESETS.length);
  });

  it("start with the way back to the general format", () => {
    expect(FORMAT_PRESETS[0]!.id).toBe("format-general");
    expect(FORMAT_PRESETS[0]!.code).toBe("");
  });

  it("are looked up by id", () => {
    expect(formatPreset("format-percent").code).toBe("0.0%");
    expect(() => formatPreset("format-nope" as never)).toThrow(/unknown/);
  });

  it("recognises its own ids and nothing else", () => {
    expect(isFormatPresetId("format-currency")).toBe(true);
    expect(isFormatPresetId("paste")).toBe(false);
  });
});

describe("what the selection is wearing", () => {
  it("is the shared code when every cell agrees", () => {
    expect(selectionFormat(["0.00", "0.00"])).toBe("0.00");
  });

  it("is null when nothing is formatted", () => {
    expect(selectionFormat([null, null])).toBeNull();
  });

  it("is mixed when the cells disagree", () => {
    expect(selectionFormat(["0.00", null])).toBe("mixed");
    expect(selectionFormat(["0.00", "0%"])).toBe("mixed");
  });

  it("is null for an empty selection rather than mixed", () => {
    expect(selectionFormat([])).toBeNull();
  });
});

describe("describing a format", () => {
  it("names a preset", () => {
    expect(describeFormat("0.0%")).toBe("Percent");
  });

  it("shows a code the presets do not know as itself", () => {
    expect(describeFormat('#,##0" units"')).toBe('#,##0" units"');
  });

  it("names the general format and a mixed selection", () => {
    expect(describeFormat(null)).toBe("general");
    expect(describeFormat("")).toBe("general");
    expect(describeFormat("mixed")).toBe("mixed");
  });
});

describe("previews", () => {
  it("show each preset against the cell's own number", () => {
    expect(previewFormat(formatPreset("format-millions"), -2400000)).toBe(
      "-2.4M",
    );
    expect(previewFormat(formatPreset("format-currency"), -2400000)).toBe(
      "($2,400,000.00)",
    );
    expect(previewFormat(formatPreset("format-percent"), 0.125)).toBe("12.5%");
  });

  it("show the general format as the value's own rendering", () => {
    expect(previewFormat(formatPreset("format-general"), 1234.5)).toBe("1234.5");
  });

  it("fall back to a stand-in when the cell holds no number", () => {
    for (const value of [null, "text", true, err("#DIV/0!")]) {
      expect(previewFormat(formatPreset("format-number"), value)).toBe(
        "1,234.50",
      );
    }
  });
});

describe("the format menu", () => {
  it("offers every preset, always enabled", () => {
    const commands = formatCommands(context, null);
    expect(commands).toHaveLength(FORMAT_PRESETS.length);
    expect(commands.every((command) => command.enabled)).toBe(true);
  });

  it("ticks the preset in effect and nothing else", () => {
    const commands = formatCommands(context, "0.0%");
    const checked = commands.filter((command) => command.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0]!.id).toBe("format-percent");
  });

  it("ticks General when the selection carries no format", () => {
    const checked = formatCommands(context, null).filter((c) => c.checked);
    expect(checked[0]!.id).toBe("format-general");
  });

  it("ticks nothing for a mixed selection", () => {
    expect(
      formatCommands(context, "mixed").some((command) => command.checked),
    ).toBe(false);
  });

  it("ticks nothing for a code no preset covers", () => {
    expect(
      formatCommands(context, '0" units"').some((command) => command.checked),
    ).toBe(false);
  });

  it("previews against the value it is given", () => {
    const commands = formatCommands(context, null, 2400000);
    const millions = commands.find((c) => c.id === "format-millions");
    expect(millions?.hint).toBe("2.4M");
  });
});
