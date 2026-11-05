import {
  CELL_FONT_SIZE,
  CELL_PADDING,
  CHAR_WIDTH_RATIO,
} from "../core/display.js";

/**
 * The cell metrics, taken off the page rather than written down.
 *
 * A character's advance is a font metric. The stylesheet names a stack —
 * `ui-monospace`, `SF Mono`, `Menlo`, `Consolas`, `Liberation Mono` — and which
 * of them a visitor has decides the answer: most are 0.6 of the font size and
 * Consolas, which is what Windows reaches, is 0.55. A constant is therefore
 * wrong by nine per cent on one of the two commonest platforms, whichever
 * value it is given, and the grid's whole use of it is to decide how many
 * digits of a number to show.
 *
 * The browser knows. One hidden element in the cell's own font, twenty
 * characters wide, gives the advance to a fraction of a pixel; the cell's own
 * computed style gives the padding, which is better than reading the number
 * out of the stylesheet because a later rule may have overridden it.
 *
 * Measured once, at startup: it is two layout reads, and the answer only
 * changes if the page's fonts do.
 */
export interface CellMetrics {
  /** Advance of one character in the cell font, in pixels. */
  readonly charWidth: number;
  /** Left plus right padding on a cell, in pixels. */
  readonly padding: number;
}

/** The fallback for a caller with no page: the stylesheet's own numbers. */
export const ASSUMED_METRICS: CellMetrics = {
  charWidth: CELL_FONT_SIZE * CHAR_WIDTH_RATIO,
  padding: CELL_PADDING,
};

/**
 * Measure a cell's metrics, given one cell element to read the font from.
 *
 * Returns the assumed metrics unchanged if the measurement comes back as
 * something that cannot be a character — zero, negative or not finite — which
 * is what a detached element or a display:none ancestor produces. A guessed
 * width is wrong by a character here and there; a zero one divides by zero and
 * shows every cell as one character wide.
 */
export function measureCell(cell: Element): CellMetrics {
  const style = getComputedStyle(cell);
  const probe = document.createElement("span");
  probe.setAttribute(
    "style",
    "position:absolute;visibility:hidden;white-space:pre;top:0;left:0",
  );
  probe.style.font = style.font;
  probe.style.fontFamily = style.fontFamily;
  probe.style.fontSize = style.fontSize;
  probe.style.fontVariantNumeric = style.fontVariantNumeric;
  probe.textContent = "00000000000000000000";
  document.body.append(probe);
  const measured = probe.getBoundingClientRect().width / 20;
  probe.remove();

  const padding =
    Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);

  return {
    charWidth:
      Number.isFinite(measured) && measured > 0
        ? measured
        : ASSUMED_METRICS.charWidth,
    padding: Number.isFinite(padding) && padding >= 0
      ? padding
      : ASSUMED_METRICS.padding,
  };
}

/**
 * Measure the metrics of a cell that is not on the grid yet.
 *
 * At startup there are no painted cells to read, so one is made, put in the
 * layer the real ones live in so that any rule depending on an ancestor
 * applies to it, measured, and removed.
 */
export function probeCellMetrics(layer: Element): CellMetrics {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.setAttribute("style", "position:absolute;visibility:hidden;top:0;left:0");
  layer.append(cell);
  try {
    return measureCell(cell);
  } finally {
    cell.remove();
  }
}
