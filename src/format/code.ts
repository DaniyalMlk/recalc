/**
 * Number format codes.
 *
 * A format code is the small language spreadsheets use to say how a value
 * should look: `#,##0.00`, `0.0%`, `$#,##0;[Red]($#,##0)`. It is parsed once
 * into the description below and then applied to values many times, which is
 * the only reason the shape here is a struct rather than a closure — a cell's
 * format is re-applied on every repaint, and re-parsing per repaint would put
 * a string scan on the render path.
 *
 * Deliberately absent: date and fraction codes. Dates need a serial-number
 * value type this engine does not have, and `# ?/?` needs a rational
 * approximation that has nothing to do with the digit machinery here. Both are
 * rejected at parse time with a position, which is a better answer than
 * silently formatting a date code as a plain number.
 */

/** Where a parse gave up, so a caller can point at the offending character. */
export class FormatCodeError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
    this.name = "FormatCodeError";
  }
}

/**
 * Colour modifiers a section may carry.
 *
 * These are the eight colour names spreadsheets accept in square brackets.
 * The formatter does not render colour — it reports it, and the display layer
 * decides what to do with it. That split keeps the format engine free of any
 * assumption about where the text is going.
 */
export const FORMAT_COLOURS = [
  "black",
  "blue",
  "cyan",
  "green",
  "magenta",
  "red",
  "white",
  "yellow",
] as const;

export type FormatColour = (typeof FORMAT_COLOURS)[number];

const COLOUR_SET: ReadonlySet<string> = new Set<string>(FORMAT_COLOURS);

/** One piece of a section's output template. */
export type FormatToken =
  /** A digit position. `0` pads with zero, `#` drops, `?` pads with a space. */
  | { readonly kind: "digit"; readonly pad: "zero" | "none" | "space" }
  /** The decimal point. At most one per section. */
  | { readonly kind: "point" }
  /** A group separator sitting between digit positions. */
  | { readonly kind: "group" }
  /** Literal text: quoted runs, escapes and pass-through punctuation. */
  | { readonly kind: "literal"; readonly text: string }
  /** `_c` — a gap the width of `c`, rendered as one space. */
  | { readonly kind: "skip"; readonly char: string }
  /** `*c` — repeat `c` to fill the column. Rendered as nothing here. */
  | { readonly kind: "fill"; readonly char: string }
  /** `@` — the whole incoming text, in a text section. */
  | { readonly kind: "text" }
  /** The exponent marker of a scientific code, with its sign rule. */
  | { readonly kind: "exponent"; readonly signAlways: boolean };

/** One `;`-delimited branch of a format code. */
export interface FormatSection {
  readonly tokens: readonly FormatToken[];
  readonly colour: FormatColour | null;
  /** Digit positions before the decimal point. */
  readonly intDigits: number;
  /** Minimum integer digits, i.e. how many of those are `0` or `?`. */
  readonly minIntDigits: number;
  /** Digit positions after the decimal point. */
  readonly decimals: number;
  /** Whether any group separator appears between digit positions. */
  readonly grouped: boolean;
  /** Powers of a thousand to divide by, one per trailing comma. */
  readonly scaleBy: number;
  /** How many `%` appear; each multiplies the value by 100. */
  readonly percents: number;
  /** Digit positions in the exponent, when the section is scientific. */
  readonly exponentDigits: number;
  /** Whether the section contains an `@` placeholder. */
  readonly hasTextPlaceholder: boolean;
  /** True when the section contains no digit positions and no `@`. */
  readonly literalOnly: boolean;
}

/**
 * A compiled format code.
 *
 * Section selection follows the spreadsheet rule, which depends on how many
 * sections were written:
 *
 * - one   — every number uses it; negatives get a `-` in front
 * - two   — positives and zero use the first, negatives the second
 * - three — positive, negative, zero
 * - four  — the fourth handles text
 *
 * With two or more sections the negative branch is responsible for showing the
 * sign itself, which is how `0;(0)` puts a negative in parentheses instead of
 * printing `(-1)`.
 */
export interface FormatCode {
  readonly source: string;
  readonly sections: readonly FormatSection[];
}

/** The general format: whatever the value's own text representation is. */
export const GENERAL_FORMAT = "General";

export function isGeneralFormat(code: string): boolean {
  return code.trim().toLowerCase() === "general";
}

const PASS_THROUGH = new Set([
  "$",
  "+",
  "-",
  "(",
  ")",
  ":",
  " ",
  "/",
  "^",
  "'",
  "{",
  "}",
  "<",
  ">",
  "=",
  "!",
  "&",
  "~",
]);

const DATE_CHARS = new Set(["y", "m", "d", "h", "s", "Y", "M", "D", "H", "S"]);

/**
 * Compile a format code.
 *
 * Throws `FormatCodeError` with an offset for anything it cannot represent,
 * including the date and fraction codes listed as out of scope above.
 */
export function parseFormatCode(source: string): FormatCode {
  if (source.length === 0) {
    throw new FormatCodeError("a format code cannot be empty", 0);
  }

  const sections: FormatSection[] = [];
  let start = 0;
  let index = 0;

  // Sections split on `;`, but a `;` inside quotes or after a backslash is a
  // literal semicolon, so the split cannot be a plain `String.split`.
  while (index <= source.length) {
    if (index === source.length || source[index] === ";") {
      sections.push(parseSection(source, start, index));
      start = index + 1;
      index += 1;
      continue;
    }
    const char = source[index]!;
    if (char === '"') {
      index = skipQuoted(source, index);
      continue;
    }
    if (char === "\\") {
      index += 2;
      continue;
    }
    index += 1;
  }

  if (sections.length > 4) {
    throw new FormatCodeError(
      "a format code has at most four sections",
      source.length,
    );
  }

  return { source, sections };
}

function skipQuoted(source: string, open: number): number {
  const close = source.indexOf('"', open + 1);
  if (close === -1) {
    throw new FormatCodeError("unterminated quoted literal", open);
  }
  return close + 1;
}

function parseSection(
  source: string,
  from: number,
  to: number,
): FormatSection {
  const tokens: FormatToken[] = [];
  let colour: FormatColour | null = null;
  let intDigits = 0;
  let minIntDigits = 0;
  let decimals = 0;
  let exponentDigits = 0;
  let grouped = false;
  let percents = 0;
  let seenPoint = false;
  let seenExponent = false;
  let hasText = false;

  /**
   * A comma's meaning depends on what comes after it: between digit positions
   * it separates thousands, after the last one it divides by a thousand. That
   * cannot be decided while reading it, so every comma is emitted as a `group`
   * token and the ones that turn out to sit past the final digit are converted
   * to scaling once the section has been read.
   */
  let lastDigitToken = -1;

  let i = from;
  while (i < to) {
    const char = source[i]!;

    switch (char) {
      case "0":
      case "#":
      case "?": {
        const pad = char === "0" ? "zero" : char === "#" ? "none" : "space";
        lastDigitToken = tokens.length;
        tokens.push({ kind: "digit", pad });
        if (seenExponent) {
          exponentDigits += 1;
        } else if (seenPoint) {
          decimals += 1;
        } else {
          intDigits += 1;
          if (pad !== "none") minIntDigits += 1;
        }
        i += 1;
        break;
      }

      case ".": {
        if (seenPoint) {
          throw new FormatCodeError("a section has one decimal point", i);
        }
        seenPoint = true;
        tokens.push({ kind: "point" });
        i += 1;
        break;
      }

      case ",": {
        if (intDigits + decimals > 0) {
          tokens.push({ kind: "group" });
        } else {
          // Nothing numeric precedes it, so there is nothing to group or
          // scale and the comma is just punctuation: `"(",#0`.
          tokens.push({ kind: "literal", text: "," });
        }
        i += 1;
        break;
      }

      case "%": {
        percents += 1;
        tokens.push({ kind: "literal", text: "%" });
        i += 1;
        break;
      }

      case '"': {
        const close = source.indexOf('"', i + 1);
        if (close === -1 || close >= to) {
          throw new FormatCodeError("unterminated quoted literal", i);
        }
        tokens.push({ kind: "literal", text: source.slice(i + 1, close) });
        i = close + 1;
        break;
      }

      case "\\": {
        const next = source[i + 1];
        if (next === undefined || i + 1 >= to) {
          throw new FormatCodeError("a backslash must escape a character", i);
        }
        tokens.push({ kind: "literal", text: next });
        i += 2;
        break;
      }

      case "_": {
        const next = source[i + 1];
        if (next === undefined || i + 1 >= to) {
          throw new FormatCodeError("`_` must be followed by a character", i);
        }
        tokens.push({ kind: "skip", char: next });
        i += 2;
        break;
      }

      case "*": {
        const next = source[i + 1];
        if (next === undefined || i + 1 >= to) {
          throw new FormatCodeError("`*` must be followed by a character", i);
        }
        tokens.push({ kind: "fill", char: next });
        i += 2;
        break;
      }

      case "@": {
        hasText = true;
        tokens.push({ kind: "text" });
        i += 1;
        break;
      }

      case "[": {
        const close = source.indexOf("]", i + 1);
        if (close === -1 || close >= to) {
          throw new FormatCodeError("unterminated `[` modifier", i);
        }
        const body = source.slice(i + 1, close).trim().toLowerCase();
        if (!COLOUR_SET.has(body)) {
          throw new FormatCodeError(
            `unsupported format modifier [${source.slice(i + 1, close)}]`,
            i,
          );
        }
        colour = body as FormatColour;
        i = close + 1;
        break;
      }

      case "E":
      case "e": {
        const sign = source[i + 1];
        if ((sign === "+" || sign === "-") && i + 1 < to) {
          seenExponent = true;
          tokens.push({ kind: "exponent", signAlways: sign === "+" });
          i += 2;
          break;
        }
        tokens.push({ kind: "literal", text: char });
        i += 1;
        break;
      }

      case "/": {
        // A `/` between digit positions is a fraction code, which is out of
        // scope; standing alone it is an ordinary separator.
        if (intDigits + decimals > 0 && isDigitChar(source[i + 1])) {
          throw new FormatCodeError("fraction format codes are not supported", i);
        }
        tokens.push({ kind: "literal", text: "/" });
        i += 1;
        break;
      }

      default: {
        if (DATE_CHARS.has(char)) {
          throw new FormatCodeError(
            "date and time format codes are not supported",
            i,
          );
        }
        if (PASS_THROUGH.has(char)) {
          tokens.push({ kind: "literal", text: char });
          i += 1;
          break;
        }
        throw new FormatCodeError(
          `unexpected character ${JSON.stringify(char)} in a format code`,
          i,
        );
      }
    }
  }

  // Every comma past the final digit position is a scale. Drop those tokens
  // so they do not also print; what remains is grouping.
  let scaleBy = 0;
  const tokenList: FormatToken[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== "group") {
      tokenList.push(token);
      return;
    }
    if (index > lastDigitToken) {
      scaleBy += 1;
      return;
    }
    grouped = true;
    tokenList.push(token);
  });

  return {
    tokens: tokenList,
    colour,
    intDigits,
    minIntDigits,
    decimals,
    grouped,
    scaleBy,
    percents,
    exponentDigits,
    hasTextPlaceholder: hasText,
    literalOnly: intDigits + decimals === 0 && !hasText,
  };
}

function isDigitChar(char: string | undefined): boolean {
  return char === "0" || char === "#" || char === "?";
}
