import { describe, expect, it } from "vitest";
import { ParseError } from "../src/engine/errors.js";
import { tokenize } from "../src/engine/lexer.js";

const kinds = (src: string) =>
  tokenize(src)
    .filter((t) => t.type !== "eof")
    .map((t) => `${t.type}:${t.text}`);

describe("tokenize", () => {
  it("strips a leading equals sign", () => {
    expect(kinds("=1")).toEqual(["number:1"]);
    expect(kinds("1")).toEqual(["number:1"]);
  });

  it("always ends with an eof token at the source length", () => {
    const tokens = tokenize("=A1+1");
    const last = tokens[tokens.length - 1]!;
    expect(last.type).toBe("eof");
    expect(last.start).toBe("=A1+1".length);
  });

  it("skips whitespace but keeps offsets accurate", () => {
    const tokens = tokenize("=  A1  +  2");
    expect(tokens[0]!.text).toBe("A1");
    expect(tokens[0]!.start).toBe(3);
    expect(tokens[2]!.text).toBe("2");
    expect(tokens[2]!.start).toBe(10);
  });

  const numbers: Array<[string, number]> = [
    ["0", 0],
    ["42", 42],
    ["3.5", 3.5],
    [".5", 0.5],
    ["1e3", 1000],
    ["1E3", 1000],
    ["1.5e-3", 0.0015],
    ["2e+2", 200],
  ];

  it.each(numbers)("lexes %s as %d", (text, value) => {
    const tokens = tokenize(text);
    expect(tokens[0]!.type).toBe("number");
    expect(tokens[0]!.value).toBe(value);
    expect(tokens[0]!.end).toBe(text.length);
  });

  it("backtracks when 'e' is not an exponent", () => {
    // `1EA` is a number followed by a word, not a malformed exponent.
    expect(kinds("1EA")).toEqual(["number:1", "word:EA"]);
  });

  it("decodes doubled quotes inside strings", () => {
    const tokens = tokenize('="a""b"');
    expect(tokens[0]!.type).toBe("string");
    expect(tokens[0]!.value).toBe('a"b');
  });

  it("lexes an empty string literal", () => {
    expect(tokenize('=""')[0]!.value).toBe("");
  });

  it("rejects an unterminated string", () => {
    expect(() => tokenize('="abc')).toThrow(ParseError);
  });

  it("lexes every error literal", () => {
    for (const code of [
      "#NULL!",
      "#DIV/0!",
      "#VALUE!",
      "#REF!",
      "#NAME?",
      "#NUM!",
      "#N/A",
      "#CYCLE!",
    ]) {
      const tokens = tokenize(`=${code}`);
      expect(tokens[0]!.type, code).toBe("error");
      expect(tokens[0]!.value, code).toBe(code);
    }
  });

  it("rejects an unknown error literal", () => {
    expect(() => tokenize("=#BOGUS!")).toThrow(ParseError);
  });

  it("prefers two-character operators over their prefixes", () => {
    expect(kinds("=1<>2")).toEqual(["number:1", "op:<>", "number:2"]);
    expect(kinds("=1<=2")).toEqual(["number:1", "op:<=", "number:2"]);
    expect(kinds("=1>=2")).toEqual(["number:1", "op:>=", "number:2"]);
    expect(kinds("=1<2")).toEqual(["number:1", "op:<", "number:2"]);
  });

  it("keeps dollar anchors inside the word token", () => {
    expect(kinds("=$A$1")).toEqual(["word:$A$1"]);
  });

  it("treats both comma and semicolon as argument separators", () => {
    expect(kinds("=F(1,2)")).toEqual([
      "word:F",
      "lparen:(",
      "number:1",
      "comma:,",
      "number:2",
      "rparen:)",
    ]);
    expect(kinds("=F(1;2)").filter((k) => k.startsWith("comma"))).toEqual([
      "comma:;",
    ]);
  });

  it("reports the offset of an unexpected character", () => {
    try {
      tokenize("=1 @ 2");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      expect((error as ParseError).offset).toBe(3);
      expect((error as ParseError).annotate()).toContain("^");
    }
  });
});
