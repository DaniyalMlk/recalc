import type {
  BinaryOperator,
  CallNode,
  Node,
  RangeNode,
  ReferenceNode,
  UnaryOperator,
} from "./ast.js";
import { ParseError } from "./errors.js";
import type { ErrorCode } from "./errors.js";
import { tokenize } from "./lexer.js";
import type { Token } from "./lexer.js";
import { normalizeRange, parseA1 } from "./reference.js";
import type { CellRef } from "./reference.js";

/**
 * Binding powers, lowest binds loosest.
 *
 * The order follows spreadsheet convention rather than the one a programming
 * language would pick, and the difference is not cosmetic: negation binds
 * *tighter* than exponentiation, so `-2^2` is `(-2)^2 = 4`, not `-(2^2) = -4`.
 * A engine that "fixes" this quietly changes the meaning of formulas people
 * paste in from a real sheet, so the quirk is reproduced deliberately.
 *
 *   comparison  <  &  <  + -  <  * /  <  ^  <  %  <  unary -  <  :
 */
interface InfixPower {
  readonly left: number;
  readonly right: number;
}

const INFIX_POWERS: Readonly<Record<string, InfixPower>> = {
  "=": { left: 1, right: 2 },
  "<>": { left: 1, right: 2 },
  "<": { left: 1, right: 2 },
  "<=": { left: 1, right: 2 },
  ">": { left: 1, right: 2 },
  ">=": { left: 1, right: 2 },
  "&": { left: 3, right: 4 },
  "+": { left: 5, right: 6 },
  "-": { left: 5, right: 6 },
  "*": { left: 7, right: 8 },
  "/": { left: 7, right: 8 },
  // Right-associative: the right power is one below the left power, so a
  // second `^` at the same level is pulled into the right operand.
  "^": { left: 10, right: 9 },
  ":": { left: 14, right: 15 },
};

const POSTFIX_PERCENT_POWER = 11;
const PREFIX_SIGN_POWER = 12;

const BINARY_OPERATORS = new Set<string>([
  "+",
  "-",
  "*",
  "/",
  "^",
  "&",
  "=",
  "<>",
  "<",
  "<=",
  ">",
  ">=",
]);

class Parser {
  private index = 0;

  constructor(
    private readonly source: string,
    private readonly tokens: Token[],
  ) {}

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private advance(): Token {
    const token = this.tokens[this.index]!;
    if (token.type !== "eof") this.index++;
    return token;
  }

  private fail(message: string, token: Token): never {
    throw new ParseError(message, this.source, token.start);
  }

  parse(): Node {
    const node = this.parseExpression(0);
    const trailing = this.peek();
    if (trailing.type !== "eof") {
      this.fail(`unexpected ${JSON.stringify(trailing.text)}`, trailing);
    }
    return node;
  }

  parseExpression(minPower: number): Node {
    let left = this.parsePrefix();

    for (;;) {
      const token = this.peek();
      if (token.type !== "op") break;

      if (token.text === "%") {
        if (POSTFIX_PERCENT_POWER < minPower) break;
        this.advance();
        left = { kind: "percent", operand: left };
        continue;
      }

      const power = INFIX_POWERS[token.text];
      if (power === undefined || power.left < minPower) break;
      this.advance();
      const right = this.parseExpression(power.right);

      if (token.text === ":") {
        left = this.makeRange(left, right, token);
        continue;
      }

      if (!BINARY_OPERATORS.has(token.text)) {
        this.fail(`operator ${token.text} cannot be used here`, token);
      }
      left = {
        kind: "binary",
        op: token.text as BinaryOperator,
        left,
        right,
      };
    }

    return left;
  }

  private makeRange(left: Node, right: Node, token: Token): RangeNode {
    if (left.kind !== "reference" || right.kind !== "reference") {
      this.fail("both sides of `:` must be cell references", token);
    }
    return {
      kind: "range",
      range: normalizeRange({ start: left.ref, end: right.ref }),
    };
  }

  private parsePrefix(): Node {
    const token = this.advance();

    switch (token.type) {
      case "number":
        return { kind: "number", value: token.value as number };

      case "string":
        return { kind: "string", value: token.value as string };

      case "error":
        return { kind: "error", code: token.value as ErrorCode };

      case "lparen": {
        const inner = this.parseExpression(0);
        const close = this.advance();
        if (close.type !== "rparen") {
          this.fail("expected `)`", close);
        }
        return { kind: "group", inner };
      }

      case "op": {
        if (token.text === "-" || token.text === "+") {
          const operand = this.parseExpression(PREFIX_SIGN_POWER);
          return { kind: "unary", op: token.text as UnaryOperator, operand };
        }
        return this.fail(`unexpected operator ${JSON.stringify(token.text)}`, token);
      }

      case "word":
        return this.parseWord(token);

      case "comma":
        return this.fail("unexpected `,`", token);

      case "rparen":
        return this.fail("unexpected `)`", token);

      case "eof":
        return this.fail("unexpected end of formula", token);

      default:
        return this.fail(`unexpected token ${JSON.stringify(token.text)}`, token);
    }
  }

  /**
   * Resolve a bare word.
   *
   * The order matters. `LOG10` is a syntactically valid A1 reference (column
   * `LOG`, row 10) *and* a function name, so a following `(` is what decides,
   * exactly as it does in a spreadsheet application.
   */
  private parseWord(token: Token): Node {
    if (this.peek().type === "lparen") {
      return this.parseCall(token);
    }

    const upper = token.text.toUpperCase();
    if (upper === "TRUE") return { kind: "boolean", value: true };
    if (upper === "FALSE") return { kind: "boolean", value: false };

    const ref = tryParseRef(token.text);
    if (ref !== null) {
      return { kind: "reference", ref } satisfies ReferenceNode;
    }

    return { kind: "name", name: upper };
  }

  private parseCall(nameToken: Token): CallNode {
    this.advance(); // consume `(`
    const args: Node[] = [];

    if (this.peek().type === "rparen") {
      this.advance();
      return { kind: "call", name: nameToken.text.toUpperCase(), args };
    }

    for (;;) {
      args.push(this.parseExpression(0));
      const next = this.advance();
      if (next.type === "comma") continue;
      if (next.type === "rparen") break;
      this.fail("expected `,` or `)` in argument list", next);
    }

    return { kind: "call", name: nameToken.text.toUpperCase(), args };
  }
}

function tryParseRef(text: string): CellRef | null {
  try {
    return parseA1(text);
  } catch {
    return null;
  }
}

/** Parse formula text into an AST. Throws {@link ParseError} on bad input. */
export function parseFormula(source: string): Node {
  return new Parser(source, tokenize(source)).parse();
}
