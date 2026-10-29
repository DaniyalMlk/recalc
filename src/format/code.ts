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
 * Date and time codes live here too, but as a separate kind of section: a
 * section that contains any of them lays out calendar fields rather than digit
 * positions, and the two never mix. That split is what keeps `m` from having
 * to mean "month" and "a digit place" at once.
 *
 * Fraction codes are a third kind of section, split off for the same reason:
 * `# ?/?` lays out a whole part, a numerator and a denominator rather than a
 * run of digit positions around a point, and the number it needs is a
 * rational approximation rather than a rounded decimal. The approximation
 * lives in `rational.ts`; what is here is only the layout.
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
  | { readonly kind: "exponent"; readonly signAlways: boolean }
  /** A calendar or clock field, `width` being how many letters were written. */
  | {
      readonly kind: "datetime";
      readonly field: DateTimeField;
      readonly width: number;
    };

/**
 * The fields a date section can lay out.
 *
 * `elapsedHour` and friends are the bracketed codes `[h]`, `[m]`, `[s]`: they
 * do not wrap at a day, an hour or a minute, which is what makes a duration
 * of 30 hours print as `30:00` instead of `06:00`.
 */
export type DateTimeField =
  | "year"
  | "month"
  | "day"
  | "hour"
  | "minute"
  | "second"
  | "meridiem"
  | "elapsedHour"
  | "elapsedMinute"
  | "elapsedSecond";

/**
 * How a fraction section is laid out.
 *
 * The split between the whole part and the numerator is positional: the
 * numerator is the run of digit positions immediately before the `/`, and
 * whatever digit positions come before that run, separated from it by
 * anything at all, are the whole part. So `# ??/??` has a whole part and
 * `??/??` does not — the second is an improper fraction, and 1.75 under it is
 * `7/4` rather than `1 3/4`.
 *
 * The denominator is written one of two ways and they mean different things.
 * Digit positions (`?/??`) bound it: the result is the closest fraction whose
 * denominator fits in that many digits. A literal (`?/8`) fixes it: the value
 * is rounded to the nearest eighth whether or not something closer exists.
 */
export interface FractionSpec {
  /** Digit positions for the whole part. Zero means an improper fraction. */
  readonly wholeDigits: number;
  /** Digit positions in the numerator. At least one. */
  readonly numeratorDigits: number;
  /** The denominator a literal code fixed, or null when the code bounds it. */
  readonly fixedDenominator: number | null;
  /** The largest denominator allowed: the literal, or `10^digits - 1`. */
  readonly maxDenominator: number;
  /** How many characters the denominator occupies, for the blanking rule. */
  readonly denominatorWidth: number;
}

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
  /** True when the section lays out calendar fields rather than digits. */
  readonly dateTime: boolean;
  /** True when an `AM/PM` marker puts the hour field on a 12-hour clock. */
  readonly clock12: boolean;
  /** How to lay out a fraction, when the section is one. */
  readonly fraction: FractionSpec | null;
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

/** What a letter means before the `m` ambiguity is resolved. */
const RAW_DATE_FIELDS: Readonly<Record<string, DateTimeField>> = {
  y: "year",
  m: "month",
  d: "day",
  h: "hour",
  s: "second",
};

const ELAPSED_FIELDS: Readonly<Record<string, DateTimeField>> = {
  h: "elapsedHour",
  m: "elapsedMinute",
  s: "elapsedSecond",
};

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
      // Clamped, so a code ending in a lone backslash still closes its
      // section and reaches the parser that rejects it, rather than stepping
      // past the terminator and losing the section altogether.
      index = Math.min(index + 2, source.length);
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
  let sawDateField = false;
  let firstDateFieldAt = -1;
  let clock12 = false;
  let fractionBarAt = -1;
  let denominatorDigits = 0;
  let denominatorWidth = 0;
  let fixedDenominator: number | null = null;

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
        const elapsed = ELAPSED_FIELDS[body[0] ?? ""];
        if (elapsed !== undefined && isRepeatOf(body, body[0]!)) {
          tokens.push({ kind: "datetime", field: elapsed, width: body.length });
          if (!sawDateField) firstDateFieldAt = i;
          sawDateField = true;
          i = close + 1;
          break;
        }
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
        // A `/` with digit positions on its left and something numeric on its
        // right is a fraction bar. Standing alone it is an ordinary separator,
        // which is what keeps `d/m/yyyy` a date.
        const run = denominatorRun(source, i + 1, to);
        const precededByDigit = tokens[tokens.length - 1]?.kind === "digit";
        if (!precededByDigit || run.length === 0) {
          tokens.push({ kind: "literal", text: "/" });
          i += 1;
          break;
        }
        if (fractionBarAt >= 0) {
          throw new FormatCodeError("a section has one fraction bar", i);
        }
        if (seenPoint) {
          throw new FormatCodeError(
            "a fraction code cannot also have a decimal point",
            i,
          );
        }
        if (seenExponent) {
          throw new FormatCodeError(
            "a fraction code cannot also be scientific",
            i,
          );
        }

        fractionBarAt = tokens.length;
        tokens.push({ kind: "literal", text: "/" });

        // The denominator's own characters are consumed here rather than left
        // to the loop, because `0` is both a digit position and a literal
        // digit and only its neighbours settle which: the `0` of `?/10` is
        // part of the number ten, and the `0` of `?/00` is a place to put one.
        if (run.fixed === null) {
          for (let d = 0; d < run.length; d += 1) {
            const pad =
              run.text[d] === "0" ? "zero" : run.text[d] === "#" ? "none" : "space";
            tokens.push({ kind: "digit", pad });
          }
          denominatorDigits = run.length;
          fixedDenominator = null;
        } else {
          tokens.push({ kind: "literal", text: run.text });
          denominatorDigits = 0;
          fixedDenominator = run.fixed;
        }
        denominatorWidth = run.length;
        i += 1 + run.length;
        break;
      }

      case "A":
      case "a": {
        // `AM/PM` and its short form `A/P`. Anything else starting with an `a`
        // is not a format code this engine knows.
        const upper = source.slice(i, Math.min(i + 5, to)).toUpperCase();
        if (upper.startsWith("AM/PM")) {
          tokens.push({ kind: "datetime", field: "meridiem", width: 5 });
          if (!sawDateField) firstDateFieldAt = i;
          sawDateField = true;
          clock12 = true;
          i += 5;
          break;
        }
        if (upper.startsWith("A/P")) {
          tokens.push({ kind: "datetime", field: "meridiem", width: 1 });
          if (!sawDateField) firstDateFieldAt = i;
          sawDateField = true;
          clock12 = true;
          i += 3;
          break;
        }
        throw new FormatCodeError(
          `unexpected character ${JSON.stringify(char)} in a format code`,
          i,
        );
      }

      default: {
        if (DATE_CHARS.has(char)) {
          // A run of the same letter; its length picks the width.
          const letter = char.toLowerCase();
          let end = i;
          while (end < to && source[end]!.toLowerCase() === letter) end += 1;
          tokens.push({
            kind: "datetime",
            field: RAW_DATE_FIELDS[letter]!,
            width: end - i,
          });
          if (!sawDateField) firstDateFieldAt = i;
          sawDateField = true;
          i = end;
          break;
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

  if (sawDateField) {
    if (intDigits + decimals > 0 || hasText) {
      throw new FormatCodeError(
        "a section mixes date fields with digit positions",
        firstDateFieldAt,
      );
    }
    return {
      tokens: resolveMinutes(tokenList),
      colour,
      intDigits: 0,
      minIntDigits: 0,
      decimals: 0,
      grouped: false,
      scaleBy: 0,
      percents: 0,
      exponentDigits: 0,
      hasTextPlaceholder: false,
      literalOnly: false,
      dateTime: true,
      clock12,
      fraction: null,
    };
  }

  if (fractionBarAt >= 0) {
    if (hasText) {
      throw new FormatCodeError(
        "a fraction code cannot also carry a text placeholder",
        from,
      );
    }
    const split = splitAtFractionBar(tokens, fractionBarAt);
    // The numerator is every digit position that is not in the whole part and
    // not in the denominator, so what remains for the whole part is what the
    // section's integer layout should use.
    const pads = tokens
      .filter((token) => token.kind === "digit")
      .slice(0, split.wholeDigits);
    return {
      tokens: tokenList,
      colour,
      intDigits: split.wholeDigits,
      minIntDigits: pads.filter(
        (token) => token.kind === "digit" && token.pad !== "none",
      ).length,
      decimals: 0,
      grouped,
      scaleBy,
      percents,
      exponentDigits: 0,
      hasTextPlaceholder: false,
      literalOnly: false,
      dateTime: false,
      clock12: false,
      fraction: {
        wholeDigits: split.wholeDigits,
        numeratorDigits: split.numeratorDigits,
        fixedDenominator,
        maxDenominator:
          fixedDenominator ?? Math.max(1, 10 ** denominatorDigits - 1),
        denominatorWidth,
      },
    };
  }

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
    dateTime: false,
    clock12: false,
    fraction: null,
  };
}

/**
 * Decide what each `m` run meant.
 *
 * `m` is the one genuinely ambiguous code: it is a month unless it sits next to
 * an hour or a second, in which case it is a minute. That cannot be settled
 * while reading left to right — `m:ss` is a minute and only the `ss` says so —
 * so every `m` is parsed as a month and corrected here, by looking outward from
 * each one for the nearest other clock or calendar field.
 */
function resolveMinutes(tokens: readonly FormatToken[]): FormatToken[] {
  return tokens.map((token, index) => {
    if (token.kind !== "datetime" || token.field !== "month") return token;
    if (isClockField(previousDateField(tokens, index))) {
      return { ...token, field: "minute" as const };
    }
    if (nextDateField(tokens, index) === "second") {
      return { ...token, field: "minute" as const };
    }
    return token;
  });
}

function previousDateField(
  tokens: readonly FormatToken[],
  index: number,
): DateTimeField | null {
  for (let i = index - 1; i >= 0; i--) {
    const token = tokens[i]!;
    if (token.kind === "datetime") return token.field;
  }
  return null;
}

function nextDateField(
  tokens: readonly FormatToken[],
  index: number,
): DateTimeField | null {
  for (let i = index + 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind === "datetime") return token.field;
  }
  return null;
}

function isClockField(field: DateTimeField | null): boolean {
  return field === "hour" || field === "elapsedHour";
}

function isRepeatOf(body: string, letter: string): boolean {
  for (const char of body) {
    if (char !== letter) return false;
  }
  return body.length > 0;
}

function isDigitChar(char: string | undefined): boolean {
  return char === "0" || char === "#" || char === "?";
}

/**
 * Read the denominator sitting after a `/`.
 *
 * The run is every character from there that could belong to a denominator:
 * the digit positions `0`, `#` and `?`, and the plain digits `0` to `9`. What
 * the run *means* then depends on whether a plain digit other than zero
 * appears in it. `?/16` names sixteenths; `?/??` asks for any denominator up
 * to two digits. `0` is the overlap, and it goes with the rest of its run:
 * the zero of `/10` is part of ten, and the zero of `/00` is a place.
 *
 * A run of length zero means there was no denominator, so the `/` was not a
 * fraction bar at all.
 */
function denominatorRun(
  source: string,
  from: number,
  to: number,
): { readonly length: number; readonly text: string; readonly fixed: number | null } {
  let end = from;
  while (end < to && (isDigitChar(source[end]) || /[0-9]/.test(source[end]!))) {
    end += 1;
  }
  const text = source.slice(from, end);
  if (text.length === 0) return { length: 0, text, fixed: null };
  const literal = /^[0-9]+$/.test(text) && /[1-9]/.test(text);
  return { length: text.length, text, fixed: literal ? Number(text) : null };
}

/**
 * Where the numerator ends and the whole part begins.
 *
 * The numerator is the unbroken run of digit positions ending at the fraction
 * bar. Anything before that run — a digit position with so much as a space
 * between it and the numerator — belongs to the whole part.
 */
function splitAtFractionBar(
  tokens: readonly FormatToken[],
  barAt: number,
): { readonly wholeDigits: number; readonly numeratorDigits: number } {
  let start = barAt;
  while (start > 0 && tokens[start - 1]!.kind === "digit") start -= 1;
  let wholeDigits = 0;
  for (let k = 0; k < start; k += 1) {
    if (tokens[k]!.kind === "digit") wholeDigits += 1;
  }
  return { wholeDigits, numeratorDigits: barAt - start };
}
