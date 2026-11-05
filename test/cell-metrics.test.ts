import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CELL_FONT_SIZE,
  CELL_PADDING,
  CHAR_WIDTH_RATIO,
  charsForWidth,
  displayValue,
} from "../web/src/core/display.js";

/**
 * The two numbers that decide how much of a number a column can show.
 *
 * Both were written down in `display.ts` as defaults nobody had ever passed,
 * and both were wrong. The padding said sixteen where the stylesheet says
 * `0 7px`; the advance said 7.55 where Chromium measures 7.5015625 at the
 * stylesheet's `12.5px`. They erred in the same direction and compounded, so
 * the function reported fewer characters than fit and `displayValue` rounded
 * numbers to fit a cell narrower than the cell is.
 *
 * A layout constant written down in two places with nothing comparing them is
 * how that happened, so the padding is compared with the stylesheet here. The
 * advance cannot be: it is a font metric, the grid names a stack of five
 * fonts, and which one a visitor has decides the answer. The browser measures
 * it instead, and what is left to check is that the fallback follows the font
 * size rather than sitting beside it as a second independent number.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = readFileSync(join(ROOT, "web/src/styles.css"), "utf8");

/** One declaration from one rule of the stylesheet. */
function declaration(selector: string, property: string): string {
  const rule = new RegExp(`(^|\\})\\s*\\${selector}\\s*\\{([^}]*)\\}`, "m").exec(
    CSS,
  );
  expect(rule, `no rule for ${selector}`).not.toBeNull();
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "m").exec(
    (rule as RegExpExecArray)[2] as string,
  );
  expect(found, `${selector} has no ${property}`).not.toBeNull();
  return ((found as RegExpExecArray)[1] as string).trim();
}

describe("the cell metrics agree with the stylesheet", () => {
  it("reads the stylesheet it claims to read", () => {
    // Every "the constant matches the stylesheet" check passes when the
    // stylesheet cannot be found, so the parse is asserted first.
    expect(CSS.length).toBeGreaterThan(5000);
    expect(declaration(".cell", "padding")).toBe("0 7px");
    expect(declaration(".cell", "font-size")).toBe("12.5px");
  });

  it("takes the padding from the two sides the stylesheet gives", () => {
    const padding = declaration(".cell", "padding");
    const sides = /^0 (\d+(?:\.\d+)?)px$/.exec(padding);
    expect(sides, `.cell padding is "${padding}", which this cannot read`).not.toBeNull();
    const each = Number.parseFloat((sides as RegExpExecArray)[1] as string);
    expect(CELL_PADDING).toBe(2 * each);
  });

  it("takes the font size from the stylesheet too", () => {
    expect(`${CELL_FONT_SIZE}px`).toBe(declaration(".cell", "font-size"));
  });

  it("keeps the fallback advance a ratio of the font size", () => {
    // Chromium measures 7.5015625 for this stack at 12.5px, which is 0.6 of
    // it to within a five-thousandth. The ratio is what is written down, so
    // changing the font size in the stylesheet moves the fallback with it
    // rather than leaving a stale pixel count behind.
    expect(CHAR_WIDTH_RATIO).toBe(0.6);
    expect(CELL_FONT_SIZE * CHAR_WIDTH_RATIO).toBeCloseTo(7.5015625, 2);
    // And the stack is the one those measurements were taken against: a font
    // added to the front of it is a reason to measure again.
    expect(declaration(":root", "--mono").replace(/\s+/g, " ")).toBe(
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    );
  });

  it("fits the characters the default column was built for", () => {
    // 104 pixels is the grid's default column width, and (104 - 14) / 7.5 is
    // exactly 12: the width was chosen to hold twelve characters. The old
    // constants returned 11.
    expect(charsForWidth(104)).toBe(12);
    expect((104 - CELL_PADDING) / (CELL_FONT_SIZE * CHAR_WIDTH_RATIO)).toBe(12);
    expect(charsForWidth(104, 7.55, 16)).toBe(11);
  });

  it("was low and never high, over every width the grid allows", () => {
    // The defect in one line: how many of the column widths between the grid's
    // minimum and a wide one the old pair got wrong, and in which direction.
    let wrong = 0;
    for (let pixels = 40; pixels <= 400; pixels += 1) {
      const before = charsForWidth(pixels, 7.55, 16);
      const after = charsForWidth(pixels);
      expect(before, `${pixels}px`).toBeLessThanOrEqual(after);
      if (before !== after) wrong += 1;
    }
    expect(wrong).toBe(172);
  });

  it("costs a digit of the number in the cell", () => {
    // The point of the count: it is the width `displayValue` rounds to. At the
    // default column width the old pair showed one significant digit fewer of
    // a number that had the room for it.
    const value = 237560.62069063215;
    expect(displayValue(value, charsForWidth(104, 7.55, 16)).text).toBe("237560.6207");
    expect(displayValue(value, charsForWidth(104)).text).toBe("237560.62069");
    expect(displayValue(value, charsForWidth(104)).text.length).toBe(12);
    // A third, which has no end to round to, so the extra character is simply
    // another digit of it.
    expect(displayValue(1 / 3, charsForWidth(104, 7.55, 16)).text).toBe("0.333333333");
    expect(displayValue(1 / 3, charsForWidth(104)).text).toBe("0.3333333333");
  });

  it("never reports less than one character, however narrow", () => {
    for (const pixels of [0, 1, 13, 14, 15, 40]) {
      expect(charsForWidth(pixels)).toBeGreaterThanOrEqual(1);
    }
    expect(charsForWidth(14)).toBe(1);
    expect(charsForWidth(21)).toBe(1);
    expect(charsForWidth(22)).toBe(1);
  });
});
