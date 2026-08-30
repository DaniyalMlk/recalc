import { ParseError, isErrorCode } from "./errors.js";
import type { ErrorCode } from "./errors.js";

export type TokenType =
  | "number"
  | "string"
  | "error"
  | "word"
  | "op"
  | "lparen"
  | "rparen"
  | "comma"
  | "eof";

export type Operator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "^"
  | "&"
  | "%"
  | ":"
  | "="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">=";

export interface Token {
  readonly type: TokenType;
  /** Exact source text of the token. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** Decoded payload for literals. */
  readonly value?: number | string | ErrorCode;
}

/**
 * Multi-character operators must be tried before their prefixes, or `<=` lexes
 * as `<` followed by a stray `=`.
 */
const OPERATORS: readonly Operator[] = [
  "<>",
  "<=",
  ">=",
  "<",
  ">",
  "=",
  "+",
  "-",
  "*",
  "/",
  "^",
  "&",
  "%",
  ":",
];

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isWordStart(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_" || ch === "$";
}

/**
 * A dot may continue a word but never start one, so `STDEV.P` and `ERROR.TYPE`
 * lex as single words while `.5` still reaches the number branch.
 */
function isWordPart(ch: string): boolean {
  return isWordStart(ch) || isDigit(ch) || ch === ".";
}

/**
 * Turn formula text into tokens.
 *
 * A leading `=` is stripped, so both `=1+1` and `1+1` lex the same way.
 *
 * Words are deliberately *not* classified here. `LOG10` is both a valid A1
 * reference (column `LOG`, row 10) and the name of a function; only the parser
 * knows whether a `(` follows, so the decision belongs there. The lexer emits
 * an undifferentiated `word` token and lets the parser resolve it.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  if (source.startsWith("=")) {
    i = 1;
  }

  while (i < source.length) {
    const ch = source[i]!;

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "lparen", text: "(", start: i, end: i + 1 });
      i++;
      continue;
    }

    if (ch === ")") {
      tokens.push({ type: "rparen", text: ")", start: i, end: i + 1 });
      i++;
      continue;
    }

    if (ch === "," || ch === ";") {
      tokens.push({ type: "comma", text: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    if (ch === '"') {
      const start = i;
      i++;
      let out = "";
      let closed = false;
      while (i < source.length) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            out += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        out += source[i];
        i++;
      }
      if (!closed) {
        throw new ParseError("unterminated string literal", source, start);
      }
      tokens.push({
        type: "string",
        text: source.slice(start, i),
        start,
        end: i,
        value: out,
      });
      continue;
    }

    if (ch === "#") {
      const start = i;
      // Error literals are a fixed set; match the longest one that fits.
      let matched: string | null = null;
      for (const code of ["#DIV/0!", "#VALUE!", "#NAME?", "#NULL!", "#CYCLE!", "#REF!", "#NUM!", "#N/A"]) {
        if (source.startsWith(code, start)) {
          matched = code;
          break;
        }
      }
      if (matched === null || !isErrorCode(matched)) {
        throw new ParseError("unknown error literal", source, start);
      }
      i = start + matched.length;
      tokens.push({
        type: "error",
        text: matched,
        start,
        end: i,
        value: matched,
      });
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1] ?? ""))) {
      const start = i;
      while (i < source.length && isDigit(source[i]!)) i++;
      if (source[i] === ".") {
        i++;
        while (i < source.length && isDigit(source[i]!)) i++;
      }
      if (source[i] === "e" || source[i] === "E") {
        const expStart = i;
        i++;
        if (source[i] === "+" || source[i] === "-") i++;
        if (i < source.length && isDigit(source[i]!)) {
          while (i < source.length && isDigit(source[i]!)) i++;
        } else {
          // Not an exponent after all: `1E` is a reference, `1EA` is nonsense.
          i = expStart;
        }
      }
      const text = source.slice(start, i);
      const value = Number(text);
      if (!Number.isFinite(value)) {
        throw new ParseError(`malformed number: ${text}`, source, start);
      }
      tokens.push({ type: "number", text, start, end: i, value });
      continue;
    }

    if (isWordStart(ch)) {
      const start = i;
      while (i < source.length && isWordPart(source[i]!)) i++;
      tokens.push({ type: "word", text: source.slice(start, i), start, end: i });
      continue;
    }

    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (op !== undefined) {
      tokens.push({ type: "op", text: op, start: i, end: i + op.length });
      i += op.length;
      continue;
    }

    throw new ParseError(`unexpected character ${JSON.stringify(ch)}`, source, i);
  }

  tokens.push({ type: "eof", text: "", start: source.length, end: source.length });
  return tokens;
}
