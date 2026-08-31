import { isFormulaError } from "../../../src/engine/errors.js";
import type { Value } from "../../../src/engine/value.js";

/**
 * Turning a value into the characters that fit in a cell.
 *
 * The engine stores full double precision and formats losslessly, which is
 * right for a library and wrong for a column 104 pixels wide: nobody wants to
 * read `237560.62069063215`, and `0.30000000000000004` is a true answer to a
 * question nobody asked. A general format therefore does two separate jobs —
 * hide the binary-representation noise, then shrink what is left until it fits
 * — and it must never round so far that the number becomes a different number.
 */

/** Digits beyond this are float representation noise, not information. */
const SIGNIFICANT_DIGITS = 12;

/** Widest a number may get before it is written in exponential form. */
const EXPONENT_ABOVE = 1e15;
const EXPONENT_BELOW = 1e-5;

export type DisplayKind = "number" | "text" | "boolean" | "error" | "blank";

export interface Display {
  readonly text: string;
  readonly kind: DisplayKind;
}

/**
 * Format a number the way a general-format cell would.
 *
 * `width` is how many characters the column has room for. The result may still
 * be longer when even a single significant digit will not fit, because a
 * truncated number is worse than an overflowing one — the caller clips it.
 */
export function generalNumber(value: number, width = 12): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? "NaN" : "∞";
  if (value === 0) return "0";

  const magnitude = Math.abs(value);
  if (magnitude >= EXPONENT_ABOVE || magnitude < EXPONENT_BELOW) {
    return exponential(value, width);
  }

  // Strip the representation noise first, so `0.1 + 0.2` reads as `0.3`
  // before anything starts worrying about column width.
  const clean = Number(value.toPrecision(SIGNIFICANT_DIGITS));
  const plain = String(clean);
  if (plain.length <= width) return plain;

  // Integer digits are never negotiable: dropping one changes the number.
  const integerDigits = Math.max(1, Math.floor(Math.log10(Math.abs(clean))) + 1);
  const sign = clean < 0 ? 1 : 0;
  const room = width - integerDigits - sign - 1; // one character for the point

  for (let decimals = Math.min(room, 10); decimals >= 0; decimals -= 1) {
    const text = trimZeros(clean.toFixed(decimals));
    if (text.length <= width) return text;
  }

  // Nothing fits. Overflow rather than switching to exponential, which would
  // round away integer digits and quietly show a different number.
  return clean.toFixed(0);
}

/** A value as it appears in a cell, with the alignment class it implies. */
export function displayValue(value: Value, width = 12): Display {
  if (value === null) return { text: "", kind: "blank" };
  if (isFormulaError(value)) return { text: value.code, kind: "error" };
  if (typeof value === "boolean") {
    return { text: value ? "TRUE" : "FALSE", kind: "boolean" };
  }
  if (typeof value === "number") {
    return { text: generalNumber(value, width), kind: "number" };
  }
  return { text: value, kind: "text" };
}

/** How many characters fit in a cell of this pixel width. */
export function charsForWidth(pixels: number, charWidth = 7.55, padding = 16): number {
  return Math.max(1, Math.floor((pixels - padding) / charWidth));
}

function exponential(value: number, width: number): string {
  // The argument-less form is the shortest string that round-trips, which is
  // usually already the right answer: `1.5e18`, not `1.500000e18`.
  const shortest = tidyExponent(value.toExponential());
  if (shortest.length <= width) return shortest;

  for (let digits = 6; digits >= 0; digits -= 1) {
    const text = tidyExponent(value.toExponential(digits));
    if (text.length <= width) return text;
  }
  return tidyExponent(value.toExponential(0));
}

function tidyExponent(text: string): string {
  const split = text.indexOf("e");
  if (split < 0) return text;
  return `${trimZeros(text.slice(0, split))}e${text.slice(split + 1).replace("+", "")}`;
}

function trimZeros(text: string): string {
  if (!text.includes(".")) return text;
  return text.replace(/\.?0+$/, "");
}
