import { NA_ERROR, VALUE_ERROR, err, isFormulaError } from "../engine/errors.js";
import { parseNumericText, toText } from "../engine/value.js";
import type { Value } from "../engine/value.js";
import { FormatCodeError } from "../format/code.js";
import { formatWith } from "../format/render.js";
import {
  argValue,
  defineFunction,
  flatten,
  numberArg,
} from "./registry.js";
import type { Arg } from "./registry.js";

function textArg(arg: Arg | undefined): string | Value {
  if (arg === undefined) return VALUE_ERROR;
  const value = toText(argValue(arg));
  return isFormulaError(value) ? value : value;
}

defineFunction({
  name: "CONCAT",
  description: "Joins every argument into one string.",
  minArgs: 1,
  maxArgs: Infinity,
  call(args) {
    let out = "";
    for (const value of flatten(args)) {
      const text = toText(value);
      if (isFormulaError(text)) return text;
      out += text;
    }
    return out;
  },
});

defineFunction({
  name: "CONCATENATE",
  description: "Joins its arguments into one string.",
  minArgs: 1,
  maxArgs: Infinity,
  call(args) {
    let out = "";
    for (const arg of args) {
      const text = toText(argValue(arg));
      if (isFormulaError(text)) return text;
      out += text;
    }
    return out;
  },
});

defineFunction({
  name: "TEXTJOIN",
  description: "Joins values with a delimiter, optionally skipping blanks.",
  minArgs: 3,
  maxArgs: Infinity,
  call(args) {
    const delimiter = textArg(args[0]);
    if (typeof delimiter !== "string") return delimiter;
    const skipBlanksValue = argValue(args[1]!);
    const skipBlanks = skipBlanksValue !== false && skipBlanksValue !== 0;
    const parts: string[] = [];
    for (const value of flatten(args.slice(2))) {
      if (skipBlanks && value === null) continue;
      const text = toText(value);
      if (isFormulaError(text)) return text;
      parts.push(text);
    }
    return parts.join(delimiter);
  },
});

defineFunction({
  name: "LEN",
  description: "Length of a text value.",
  minArgs: 1,
  maxArgs: 1,
  call(args) {
    const text = textArg(args[0]);
    return typeof text === "string" ? text.length : text;
  },
});

function sliceFunction(
  name: string,
  description: string,
  take: (text: string, count: number) => string,
): void {
  defineFunction({
    name,
    description,
    minArgs: 1,
    maxArgs: 2,
    call(args) {
      const text = textArg(args[0]);
      if (typeof text !== "string") return text;
      const count = args.length > 1 ? numberArg(args[1]) : 1;
      if (isFormulaError(count)) return count;
      if (count < 0) return VALUE_ERROR;
      return take(text, Math.trunc(count));
    },
  });
}

sliceFunction("LEFT", "Leading characters of a string.", (text, count) =>
  text.slice(0, count),
);
sliceFunction("RIGHT", "Trailing characters of a string.", (text, count) =>
  count === 0 ? "" : text.slice(-count),
);

defineFunction({
  name: "MID",
  description: "Characters from the middle of a string, 1-indexed.",
  minArgs: 3,
  maxArgs: 3,
  call(args) {
    const text = textArg(args[0]);
    if (typeof text !== "string") return text;
    const start = numberArg(args[1]);
    if (isFormulaError(start)) return start;
    const count = numberArg(args[2]);
    if (isFormulaError(count)) return count;
    if (start < 1 || count < 0) return VALUE_ERROR;
    const from = Math.trunc(start) - 1;
    return text.slice(from, from + Math.trunc(count));
  },
});

function transform(
  name: string,
  description: string,
  fn: (text: string) => string,
): void {
  defineFunction({
    name,
    description,
    minArgs: 1,
    maxArgs: 1,
    call(args) {
      const text = textArg(args[0]);
      return typeof text === "string" ? fn(text) : text;
    },
  });
}

transform("UPPER", "Upper-cases a string.", (t) => t.toUpperCase());
transform("LOWER", "Lower-cases a string.", (t) => t.toLowerCase());
// TRIM collapses runs of interior spaces as well as trimming the ends, which
// is what makes it useful on data pasted out of a report.
transform("TRIM", "Trims and collapses whitespace.", (t) =>
  t.trim().replace(/\s+/g, " "),
);
transform("PROPER", "Capitalises the first letter of each word.", (t) =>
  t.replace(/\p{L}+/gu, (word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase()),
);

defineFunction({
  name: "REPT",
  description: "Repeats a string a number of times.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const text = textArg(args[0]);
    if (typeof text !== "string") return text;
    const count = numberArg(args[1]);
    if (isFormulaError(count)) return count;
    const times = Math.trunc(count);
    if (times < 0) return VALUE_ERROR;
    if (text.length * times > 32767) return VALUE_ERROR;
    return text.repeat(times);
  },
});

function search(
  name: string,
  description: string,
  caseSensitive: boolean,
): void {
  defineFunction({
    name,
    description,
    minArgs: 2,
    maxArgs: 3,
    call(args) {
      const needle = textArg(args[0]);
      if (typeof needle !== "string") return needle;
      const haystack = textArg(args[1]);
      if (typeof haystack !== "string") return haystack;
      const start = args.length > 2 ? numberArg(args[2]) : 1;
      if (isFormulaError(start)) return start;
      if (start < 1) return VALUE_ERROR;
      const from = Math.trunc(start) - 1;
      const index = caseSensitive
        ? haystack.indexOf(needle, from)
        : haystack.toUpperCase().indexOf(needle.toUpperCase(), from);
      return index < 0 ? VALUE_ERROR : index + 1;
    },
  });
}

search("FIND", "Case-sensitive substring position, 1-indexed.", true);
search("SEARCH", "Case-insensitive substring position, 1-indexed.", false);

defineFunction({
  name: "SUBSTITUTE",
  description: "Replaces occurrences of a substring.",
  minArgs: 3,
  maxArgs: 4,
  call(args) {
    const text = textArg(args[0]);
    if (typeof text !== "string") return text;
    const oldText = textArg(args[1]);
    if (typeof oldText !== "string") return oldText;
    const newText = textArg(args[2]);
    if (typeof newText !== "string") return newText;
    if (oldText === "") return text;

    if (args.length === 3) return text.split(oldText).join(newText);

    const occurrence = numberArg(args[3]);
    if (isFormulaError(occurrence)) return occurrence;
    const target = Math.trunc(occurrence);
    if (target < 1) return VALUE_ERROR;

    let index = -1;
    for (let seen = 0; seen < target; seen++) {
      index = text.indexOf(oldText, index + (seen === 0 ? 0 : oldText.length));
      if (index < 0) return text;
    }
    return text.slice(0, index) + newText + text.slice(index + oldText.length);
  },
});

defineFunction({
  name: "EXACT",
  description: "Case-sensitive text equality.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const a = textArg(args[0]);
    if (typeof a !== "string") return a;
    const b = textArg(args[1]);
    if (typeof b !== "string") return b;
    return a === b;
  },
});

defineFunction({
  name: "VALUE",
  description: "Converts numeric text to a number.",
  minArgs: 1,
  maxArgs: 1,
  call(args) {
    const value = argValue(args[0]!);
    if (typeof value === "number") return value;
    const text = toText(value);
    if (isFormulaError(text)) return text;
    const parsed = parseNumericText(text);
    return parsed === null ? VALUE_ERROR : parsed;
  },
});

defineFunction({
  name: "T",
  description: "Returns its argument if it is text, otherwise empty text.",
  minArgs: 1,
  maxArgs: 1,
  call(args) {
    const value = argValue(args[0]!);
    return typeof value === "string" ? value : "";
  },
});

defineFunction({
  name: "NA",
  description: "The #N/A error.",
  minArgs: 0,
  maxArgs: 0,
  call: () => NA_ERROR,
});

defineFunction({
  name: "TEXT",
  description: "Formats a value with a number format code.",
  minArgs: 2,
  maxArgs: 2,
  call(args) {
    const code = textArg(args[1]);
    if (typeof code !== "string") return code;
    const value = argValue(args[0]!);
    if (isFormulaError(value)) return value;
    try {
      return formatWith(code, value).text;
    } catch (error) {
      // A malformed code is a mistake in the formula, not a crash. `#VALUE!`
      // is what a spreadsheet answers, and the parser's message rides along
      // as the detail so tooling can say what was actually wrong with it.
      if (error instanceof FormatCodeError) {
        return err("#VALUE!", error.message);
      }
      throw error;
    }
  },
});
