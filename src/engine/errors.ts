/**
 * Spreadsheet error values.
 *
 * Errors are ordinary values in this engine, not exceptions. A formula that
 * fails produces an error value, that value propagates through any operator or
 * function that touches it, and it lands in the cell. Exceptions are reserved
 * for programmer mistakes (bad API use), never for user formula mistakes.
 */

export const ERROR_CODES = [
  "#NULL!",
  "#DIV/0!",
  "#VALUE!",
  "#REF!",
  "#NAME?",
  "#NUM!",
  "#N/A",
  "#CYCLE!",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set<string>(ERROR_CODES);

export function isErrorCode(text: string): text is ErrorCode {
  return ERROR_CODE_SET.has(text);
}

/** An error value carried through evaluation. */
export interface FormulaError {
  readonly type: "error";
  readonly code: ErrorCode;
  /** Human-readable detail, shown alongside the code in tooling. */
  readonly detail?: string;
}

export function err(code: ErrorCode, detail?: string): FormulaError {
  return detail === undefined
    ? { type: "error", code }
    : { type: "error", code, detail };
}

export function isFormulaError(value: unknown): value is FormulaError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "error"
  );
}

/** `#NULL!` — a range intersection that is empty. */
export const NULL_ERROR = err("#NULL!");
/** `#DIV/0!` — division or modulo by zero. */
export const DIV0_ERROR = err("#DIV/0!");
/** `#VALUE!` — an argument of the wrong type. */
export const VALUE_ERROR = err("#VALUE!");
/** `#REF!` — a reference that does not point at a cell. */
export const REF_ERROR = err("#REF!");
/** `#NAME?` — an unknown function or name. */
export const NAME_ERROR = err("#NAME?");
/** `#NUM!` — a numerically invalid or non-convergent result. */
export const NUM_ERROR = err("#NUM!");
/** `#N/A` — a lookup with no match. */
export const NA_ERROR = err("#N/A");
/**
 * `#CYCLE!` — the cell participates in a circular reference.
 *
 * This is an extension. Spreadsheet applications report circularity out of
 * band, in a status bar or a dialog; an engine with no chrome has to put it
 * somewhere, and the cell value is the only place the caller is already
 * looking.
 */
export const CYCLE_ERROR = err("#CYCLE!");

/** Thrown for malformed input, as opposed to a formula that evaluates badly. */
export class ParseError extends Error {
  readonly offset: number;
  readonly source: string;

  constructor(message: string, source: string, offset: number) {
    super(`${message} (at offset ${offset})`);
    this.name = "ParseError";
    this.source = source;
    this.offset = offset;
  }

  /** A two-line caret diagram pointing at the offending character. */
  annotate(): string {
    const caretPad = " ".repeat(Math.max(0, this.offset));
    return `${this.source}\n${caretPad}^ ${this.message}`;
  }
}
