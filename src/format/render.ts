import { isFormulaError } from "../engine/errors.js";
import { formatValue as generalText, kindOf } from "../engine/value.js";
import type { Value } from "../engine/value.js";
import { base10Exponent, roundToPlaces } from "./decimal.js";
import { isGeneralFormat, parseFormatCode } from "./code.js";
import type { FormatCode, FormatColour, FormatSection } from "./code.js";
import {
  civilFromSerial,
  clockFromSerial,
  isValidSerial,
  weekdayIndex,
} from "../date/serial.js";

/** What a format produced: the text, and any colour the section asked for. */
export interface FormattedValue {
  readonly text: string;
  readonly colour: FormatColour | null;
}

const GROUP_SEPARATOR = ",";
const DECIMAL_POINT = ".";

/**
 * Apply a compiled format to a value.
 *
 * Booleans and errors are not formatted. A format code describes how to lay
 * out digits, and `TRUE` has none; spreadsheets show the underlying value in
 * that case and so does this. Blanks stay empty for the same reason — a format
 * on an empty cell should not conjure a `0` onto the grid.
 */
export function applyFormat(code: FormatCode, value: Value): FormattedValue {
  const kind = kindOf(value);
  if (kind === "error" || kind === "boolean" || kind === "blank") {
    return { text: generalText(value), colour: null };
  }

  if (kind === "text") {
    const section = textSection(code.sections);
    if (section === null) return { text: value as string, colour: null };
    return { text: renderText(section, value as string), colour: section.colour };
  }

  const number = value as number;
  if (!Number.isFinite(number)) {
    return { text: generalText(value), colour: null };
  }

  const picked = pickSection(code.sections, number);
  if (picked === null) return { text: generalText(value), colour: null };

  const { section, negate, signed } = picked;
  if (section.dateTime) {
    // A date code has nothing to say about a value that is not a date. Rather
    // than invent one, the value is shown as it would be with no format at all,
    // which at least tells the reader what is actually in the cell.
    if (!isValidSerial(number)) {
      return { text: generalText(value), colour: null };
    }
    return { text: renderDateTime(section, number), colour: section.colour };
  }
  const text = renderNumber(section, negate ? -number : number, signed);
  return { text, colour: section.colour };
}

/** Parse and apply in one step. Convenient for one-off calls such as `TEXT`. */
export function formatWith(source: string, value: Value): FormattedValue {
  if (isGeneralFormat(source)) {
    return { text: generalText(value), colour: null };
  }
  return applyFormat(parseFormatCode(source), value);
}

/**
 * The branch that formats text, if any.
 *
 * A four-section code dedicates its fourth branch to text. A one-section code
 * has no dedicated branch, but if that single section carries an `@` then it
 * was plainly written for text and applies. Anything else leaves text alone,
 * which is what keeps a currency format from mangling a column header.
 */
function textSection(sections: readonly FormatSection[]): FormatSection | null {
  if (sections.length === 4) return sections[3]!;
  const first = sections[0];
  if (sections.length === 1 && first !== undefined && first.hasTextPlaceholder) {
    return first;
  }
  return null;
}

interface Picked {
  readonly section: FormatSection;
  /** Whether to flip the sign before rendering, the section supplying its own. */
  readonly negate: boolean;
  /** Whether the renderer should print a leading `-` itself. */
  readonly signed: boolean;
}

/**
 * Choose the branch of the format that applies to a number.
 *
 * With a single section every number shares it and the renderer prints the
 * minus sign. From two sections upward the negative branch owns the sign, and
 * is handed the magnitude — which is exactly what lets `0;(0)` render -5 as
 * `(5)` rather than `(-5)`.
 */
function pickSection(
  sections: readonly FormatSection[],
  value: number,
): Picked | null {
  const count = sections.length;
  if (count === 0) return null;
  if (count === 1) {
    return { section: sections[0]!, negate: false, signed: value < 0 };
  }
  if (value < 0) {
    return { section: sections[1]!, negate: true, signed: false };
  }
  if (value === 0 && count >= 3) {
    return { section: sections[2]!, negate: false, signed: false };
  }
  return { section: sections[0]!, negate: false, signed: false };
}

function renderText(section: FormatSection, text: string): string {
  let out = "";
  for (const token of section.tokens) {
    switch (token.kind) {
      case "text":
        out += text;
        break;
      case "literal":
        out += token.text;
        break;
      case "skip":
        out += " ";
        break;
      default:
        break;
    }
  }
  return out;
}

function renderNumber(
  section: FormatSection,
  value: number,
  signed: boolean,
): string {
  // A section with no digit positions at all is pure decoration: `"paid"` or
  // an empty branch that hides the value. Nothing numeric to lay out.
  if (section.literalOnly) {
    return renderText(section, "");
  }

  let scaled = value;
  for (let i = 0; i < section.percents; i += 1) scaled *= 100;
  for (let i = 0; i < section.scaleBy; i += 1) scaled /= 1000;

  const abs = Math.abs(scaled);

  const digits =
    section.exponentDigits > 0
      ? scientificDigits(section, abs)
      : { ...roundToPlaces(abs, section.decimals), exponent: null };

  // A value that rounds away to nothing at the format's precision is shown
  // without a sign: -0.04 under `0.0` is `0.0`, not `-0.0`. The sign would be
  // claiming a precision the format has already declined to show.
  const vanished = !/[1-9]/.test(digits.int + digits.frac);
  const body = splice(section, digits.int, digits.frac, digits.exponent);
  return signed && !vanished ? "-" + body : body;
}

interface Digits {
  readonly int: string;
  readonly frac: string;
  readonly exponent: number | null;
}

/**
 * Normalise a magnitude for a scientific section.
 *
 * The mantissa is shifted so its integer part fills the section's integer
 * placeholders, which is what makes `##0.0E+0` an engineering format: three
 * integer positions force the exponent to a multiple of three. Rounding can
 * push the mantissa over that width (9.99 at one position becomes 10.0), so
 * the result is checked and the exponent stepped once if it did.
 */
function scientificDigits(section: FormatSection, abs: number): Digits {
  const width = Math.max(section.intDigits, 1);
  if (abs === 0) {
    return { int: "0".repeat(width), frac: "0".repeat(section.decimals), exponent: 0 };
  }

  const magnitude = base10Exponent(abs);
  let exponent = Math.floor(magnitude / width) * width;
  if (width === 1) exponent = magnitude;

  let mantissa = abs / 10 ** exponent;
  let rounded = roundToPlaces(mantissa, section.decimals);
  if (rounded.int.length > width) {
    exponent += width;
    mantissa = abs / 10 ** exponent;
    rounded = roundToPlaces(mantissa, section.decimals);
  }
  return { int: rounded.int, frac: rounded.frac, exponent };
}

/**
 * Lay the digits out over the section's tokens.
 *
 * Integer positions are filled right to left so the units digit lands in the
 * rightmost one and any excess piles up in the leftmost, which is how `00`
 * still shows all of 12345. Fractional positions fill left to right, and a
 * trailing run of them backed by `#` disappears when it would only show
 * zeros — taking the decimal point with it if nothing is left.
 */
function splice(
  section: FormatSection,
  int: string,
  frac: string,
  exponent: number | null,
): string {
  const intPieces = layoutInteger(section, int);
  const fracPieces = layoutFraction(section, frac);
  const fracVisible = fracPieces.some((piece) => piece !== "");

  let intIndex = 0;
  let fracIndex = 0;
  let afterPoint = false;
  let afterExponent = false;
  let exponentIndex = 0;
  const exponentDigits =
    exponent === null ? "" : String(Math.abs(exponent)).padStart(section.exponentDigits, "0");

  let out = "";
  for (const token of section.tokens) {
    switch (token.kind) {
      case "digit":
        if (afterExponent) {
          // The exponent's own digits are laid out as one block at its first
          // position; later positions were already accounted for by the pad.
          if (exponentIndex === 0) out += exponentDigits;
          exponentIndex += 1;
        } else if (afterPoint) {
          out += fracPieces[fracIndex] ?? "";
          fracIndex += 1;
        } else {
          out += intPieces[intIndex] ?? "";
          intIndex += 1;
        }
        break;
      case "point":
        afterPoint = true;
        if (fracVisible) out += DECIMAL_POINT;
        break;
      case "exponent":
        afterExponent = true;
        out += "E";
        if (exponent !== null && exponent < 0) out += "-";
        else if (token.signAlways) out += "+";
        break;
      case "group":
        // Separators are placed while the digits are laid out, so the token
        // itself prints nothing.
        break;
      case "literal":
        out += token.text;
        break;
      case "skip":
        out += " ";
        break;
      case "fill":
        break;
      case "text":
        break;
    }
  }
  return out;
}

function layoutInteger(section: FormatSection, digits: string): string[] {
  const count = section.intDigits;
  const pads = section.tokens
    .filter((token): token is Extract<typeof token, { kind: "digit" }> =>
      token.kind === "digit",
    )
    .slice(0, count)
    .map((token) => token.pad);

  const pieces: string[] = new Array(count).fill("");
  const trimmed = digits === "0" && section.minIntDigits === 0 ? "" : digits;

  let source = trimmed.length - 1;
  let emitted = 0;

  const separatorAfter = (): string =>
    section.grouped && emitted > 0 && emitted % 3 === 0 ? GROUP_SEPARATOR : "";

  for (let position = count - 1; position >= 0; position -= 1) {
    if (position === 0) {
      let chunk = "";
      while (source >= 0) {
        chunk = trimmed[source]! + separatorAfter() + chunk;
        emitted += 1;
        source -= 1;
      }
      if (chunk === "") chunk = padCharacter(pads[0]);
      pieces[0] = chunk;
      break;
    }
    if (source >= 0) {
      pieces[position] = trimmed[source]! + separatorAfter();
      emitted += 1;
      source -= 1;
    } else {
      pieces[position] = padCharacter(pads[position]);
    }
  }
  return pieces;
}

function layoutFraction(section: FormatSection, digits: string): string[] {
  const pads = section.tokens
    .filter((token): token is Extract<typeof token, { kind: "digit" }> =>
      token.kind === "digit",
    )
    .slice(section.intDigits, section.intDigits + section.decimals)
    .map((token) => token.pad);

  const pieces: string[] = [];
  for (let i = 0; i < section.decimals; i += 1) {
    pieces.push(digits[i] ?? "0");
  }

  // Walk in from the right dropping zeros that no placeholder insists on.
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    if (pieces[i] !== "0") break;
    const pad = pads[i];
    if (pad === "zero") break;
    pieces[i] = pad === "space" ? " " : "";
  }
  return pieces;
}

function padCharacter(pad: "zero" | "none" | "space" | undefined): string {
  if (pad === "zero") return "0";
  if (pad === "space") return " ";
  return "";
}

/** True when the value should be right-aligned, i.e. it reads as a number. */
export function isNumericValue(value: Value): boolean {
  return !isFormulaError(value) && kindOf(value) === "number";
}

// ---------------------------------------------------------------------------
// Date and time sections
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function pad(value: number, width: number): string {
  const text = String(Math.abs(value));
  return (value < 0 ? "-" : "") + text.padStart(width, "0");
}

/**
 * Lay out a serial through a date section.
 *
 * The clock fields are read from a single rounded second count so that a
 * format showing hours and minutes cannot disagree with itself — rounding each
 * field separately is how 11:59:60 gets printed.
 */
function renderDateTime(section: FormatSection, serial: number): string {
  const date = civilFromSerial(serial);
  const clock = clockFromSerial(serial);
  const hour12 = clock.hour % 12 === 0 ? 12 : clock.hour % 12;
  const totalSeconds = Math.round(serial * 86400);

  let out = "";
  for (const token of section.tokens) {
    switch (token.kind) {
      case "literal":
        out += token.text;
        break;
      case "skip":
        out += " ";
        break;
      case "datetime":
        out += renderField(token.field, token.width, {
          serial,
          date,
          clock,
          hour12,
          totalSeconds,
          clock12: section.clock12,
        });
        break;
      default:
        break;
    }
  }
  return out;
}

interface DateParts {
  readonly serial: number;
  readonly date: { readonly year: number; readonly month: number; readonly day: number };
  readonly clock: { readonly hour: number; readonly minute: number; readonly second: number };
  readonly hour12: number;
  readonly totalSeconds: number;
  readonly clock12: boolean;
}

function renderField(
  field: string,
  width: number,
  parts: DateParts,
): string {
  const { serial, date, clock, hour12, totalSeconds, clock12 } = parts;
  switch (field) {
    case "year":
      return width <= 2
        ? pad(((date.year % 100) + 100) % 100, 2)
        : pad(date.year, 4);
    case "month":
      if (width === 1) return String(date.month);
      if (width === 2) return pad(date.month, 2);
      if (width === 3) return MONTH_NAMES[date.month - 1]!.slice(0, 3);
      if (width === 4) return MONTH_NAMES[date.month - 1]!;
      return MONTH_NAMES[date.month - 1]!.slice(0, 1);
    case "day":
      if (width === 1) return String(date.day);
      if (width === 2) return pad(date.day, 2);
      if (width === 3) return DAY_NAMES[weekdayIndex(serial)]!.slice(0, 3);
      return DAY_NAMES[weekdayIndex(serial)]!;
    case "hour":
      return pad(clock12 ? hour12 : clock.hour, Math.min(width, 2));
    case "minute":
      return pad(clock.minute, Math.min(width, 2));
    case "second":
      return pad(clock.second, Math.min(width, 2));
    case "meridiem":
      return width === 5
        ? clock.hour < 12
          ? "AM"
          : "PM"
        : clock.hour < 12
          ? "A"
          : "P";
    case "elapsedHour":
      return pad(Math.floor(totalSeconds / 3600), width);
    case "elapsedMinute":
      return pad(Math.floor(totalSeconds / 60), width);
    case "elapsedSecond":
      return pad(totalSeconds, width);
    default:
      return "";
  }
}
