import { ParseError } from "../../../src/engine/errors.js";
import { tokenize } from "../../../src/engine/lexer.js";
import type { Token } from "../../../src/engine/lexer.js";
import {
  formatA1,
  normalizeRange,
  parseA1,
} from "../../../src/engine/reference.js";
import type { CellRef, RangeRef } from "../../../src/engine/reference.js";

/**
 * Colouring for the formula being edited.
 *
 * The lexer deliberately does not decide whether `LOG10` is a function name or
 * a reference to column `LOG` row 10 — only the parser knows, because only the
 * parser can see whether a `(` follows. Highlighting needs the same decision
 * one token earlier than the parser makes it, and it needs to keep working on
 * text that does not parse at all, because a formula is unparseable for most of
 * the time it is being typed. So this walks the token stream with one token of
 * lookahead and classifies without ever building a tree.
 *
 * Every reference gets a palette slot, and the same reference always gets the
 * same slot within one formula. The grid paints matching outlines on the cells,
 * which is the whole point: the colour is a line between the text and the sheet.
 */

export type SpanKind =
  | "plain"
  | "function"
  | "reference"
  | "name"
  | "number"
  | "string"
  | "error"
  | "operator"
  | "paren";

export interface HighlightSpan {
  readonly kind: SpanKind;
  /** Offset into the original text, inclusive. */
  readonly start: number;
  /** Offset into the original text, exclusive. */
  readonly end: number;
  readonly text: string;
  /** Palette slot, present only on `reference` spans. */
  readonly slot?: number;
}

/** A reference the formula mentions, resolved and given a colour. */
export interface HighlightedReference {
  /** Canonical A1 text: `B2` or `A1:C9`. */
  readonly label: string;
  readonly range: RangeRef;
  readonly slot: number;
  /** Where it sits in the source, for cursor-aware emphasis. */
  readonly start: number;
  readonly end: number;
}

export interface Highlight {
  readonly spans: readonly HighlightSpan[];
  readonly references: readonly HighlightedReference[];
  /** Set when the text could not even be tokenised. */
  readonly error: string | null;
}

/** How many distinct colours the grid outlines cycle through. */
export const PALETTE_SLOTS = 6;

/** Nothing to highlight: an empty or non-formula cell. */
function plainOnly(text: string): Highlight {
  return {
    spans: text === "" ? [] : [{ kind: "plain", start: 0, end: text.length, text }],
    references: [],
    error: null,
  };
}

/**
 * Highlight formula text.
 *
 * Input that does not start with `=` is a literal, not a formula, and comes
 * back as a single plain span. The spans always tile the input exactly, gaps
 * included, so a renderer can concatenate them and get the source back.
 */
export function highlightFormula(text: string): Highlight {
  if (!text.startsWith("=")) return plainOnly(text);

  let tokens: Token[];
  try {
    tokens = tokenize(text);
  } catch (error) {
    return {
      ...plainOnly(text),
      error: error instanceof ParseError ? error.message : String(error),
    };
  }

  const spans: HighlightSpan[] = [{ kind: "operator", start: 0, end: 1, text: "=" }];
  const references: HighlightedReference[] = [];
  const slots = new Map<string, number>();

  const slotFor = (key: string): number => {
    const existing = slots.get(key);
    if (existing !== undefined) return existing;
    const slot = slots.size % PALETTE_SLOTS;
    slots.set(key, slot);
    return slot;
  };

  let cursor = 1;
  let i = 0;

  const push = (span: HighlightSpan): void => {
    if (span.start > cursor) {
      spans.push({
        kind: "plain",
        start: cursor,
        end: span.start,
        text: text.slice(cursor, span.start),
      });
    }
    spans.push(span);
    cursor = span.end;
  };

  while (i < tokens.length) {
    const token = tokens[i] as Token;
    if (token.type === "eof") break;

    const next = tokens[i + 1];

    if (token.type === "word") {
      // A word followed by `(` is a call, whatever else it might spell.
      if (next?.type === "lparen") {
        push({
          kind: "function",
          start: token.start,
          end: token.end,
          text: token.text,
        });
        i += 1;
        continue;
      }

      const start = asRef(token.text);
      if (start !== null) {
        // `A1:B2` is three tokens but one reference, and it should light up as
        // one block rather than two cells with a colon between them.
        const after = tokens[i + 2];
        const end =
          next?.type === "op" && next.text === ":" && after?.type === "word"
            ? asRef(after.text)
            : null;

        if (end !== null && after !== undefined) {
          const range = relativeRange(normalizeRange({ start, end }));
          const label = canonicalLabel(range);
          const slot = slotFor(label);
          push({
            kind: "reference",
            start: token.start,
            end: after.end,
            text: text.slice(token.start, after.end),
            slot,
          });
          references.push({
            label,
            range,
            slot,
            start: token.start,
            end: after.end,
          });
          i += 3;
          continue;
        }

        const range = relativeRange(normalizeRange({ start, end: start }));
        const label = canonicalLabel(range);
        const slot = slotFor(label);
        push({
          kind: "reference",
          start: token.start,
          end: token.end,
          text: token.text,
          slot,
        });
        references.push({
          label,
          range,
          slot,
          start: token.start,
          end: token.end,
        });
        i += 1;
        continue;
      }

      push({ kind: "name", start: token.start, end: token.end, text: token.text });
      i += 1;
      continue;
    }

    push({
      kind: kindOfToken(token),
      start: token.start,
      end: token.end,
      text: token.text,
    });
    i += 1;
  }

  if (cursor < text.length) {
    spans.push({
      kind: "plain",
      start: cursor,
      end: text.length,
      text: text.slice(cursor),
    });
  }

  return { spans, references, error: null };
}

/** The reference whose span contains the caret, if any. */
export function referenceAt(
  highlight: Highlight,
  caret: number,
): HighlightedReference | null {
  for (const reference of highlight.references) {
    if (caret >= reference.start && caret <= reference.end) return reference;
  }
  return null;
}

/** Palette slot painted on a cell, or `null` when the formula does not read it. */
export function slotForCell(
  highlight: Highlight,
  row: number,
  col: number,
): number | null {
  for (const reference of highlight.references) {
    const { start, end } = reference.range;
    if (row >= start.row && row <= end.row && col >= start.col && col <= end.col) {
      return reference.slot;
    }
  }
  return null;
}

/** Strip the `$` anchors: `$A$1` and `A1` are the same cell to a reader. */
function relative(ref: CellRef): CellRef {
  return { col: ref.col, row: ref.row, colAbsolute: false, rowAbsolute: false };
}

/**
 * The name a reader would give this reference — anchors dropped and a
 * one-cell range written as the cell rather than as `A1:A1`.
 *
 * It doubles as the palette key, which is why `$A$1` and `A1` in the same
 * formula light up in the same colour: they point at one cell, so showing them
 * as two would be a lie about the sheet.
 */
function canonicalLabel(range: RangeRef): string {
  const start = relative(range.start);
  const end = relative(range.end);
  return start.col === end.col && start.row === end.row
    ? formatA1(start)
    : `${formatA1(start)}:${formatA1(end)}`;
}

/** A range with anchors dropped, so two spellings of one cell compare equal. */
function relativeRange(range: RangeRef): RangeRef {
  return { start: relative(range.start), end: relative(range.end) };
}

function kindOfToken(token: Token): SpanKind {
  switch (token.type) {
    case "number":
      return "number";
    case "string":
      return "string";
    case "error":
      return "error";
    case "op":
      return "operator";
    case "lparen":
    case "rparen":
      return "paren";
    case "comma":
      return "operator";
    default:
      return "plain";
  }
}

/** Parse a word as an A1 reference, or `null` if it is a name instead. */
function asRef(text: string): CellRef | null {
  try {
    return parseA1(text);
  } catch {
    return null;
  }
}
