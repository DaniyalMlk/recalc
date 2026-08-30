import { isFormulaError } from "../engine/errors.js";
import { kindOf } from "../engine/value.js";
import type { Value } from "../engine/value.js";
import { argValue, defineFunction } from "./registry.js";

function predicate(
  name: string,
  description: string,
  test: (value: Value) => boolean,
): void {
  defineFunction({
    name,
    description,
    minArgs: 1,
    maxArgs: 1,
    // Information functions have to see errors rather than propagate them —
    // that is the whole point of ISERROR.
    acceptsErrors: true,
    call: (args) => test(argValue(args[0]!)),
  });
}

predicate("ISBLANK", "True for a blank cell.", (value) => value === null);
predicate(
  "ISNUMBER",
  "True for a numeric value.",
  (value) => kindOf(value) === "number",
);
predicate("ISTEXT", "True for a text value.", (value) => kindOf(value) === "text");
predicate(
  "ISNONTEXT",
  "True for anything that is not text.",
  (value) => kindOf(value) !== "text",
);
predicate(
  "ISLOGICAL",
  "True for a boolean value.",
  (value) => kindOf(value) === "boolean",
);
predicate("ISERROR", "True for any error, including #N/A.", isFormulaError);
predicate(
  "ISERR",
  "True for any error except #N/A.",
  (value) => isFormulaError(value) && value.code !== "#N/A",
);
predicate(
  "ISNA",
  "True only for #N/A.",
  (value) => isFormulaError(value) && value.code === "#N/A",
);

defineFunction({
  name: "TYPE",
  description: "Type code: 1 number, 2 text, 4 boolean, 16 error.",
  minArgs: 1,
  maxArgs: 1,
  acceptsErrors: true,
  call(args) {
    switch (kindOf(argValue(args[0]!))) {
      case "number":
        return 1;
      case "blank":
        return 1;
      case "text":
        return 2;
      case "boolean":
        return 4;
      case "error":
        return 16;
    }
  },
});

defineFunction({
  name: "ERROR.TYPE",
  description: "Numeric code of an error value.",
  minArgs: 1,
  maxArgs: 1,
  acceptsErrors: true,
  call(args) {
    const value = argValue(args[0]!);
    if (!isFormulaError(value)) return { type: "error", code: "#N/A" };
    const codes: Record<string, number> = {
      "#NULL!": 1,
      "#DIV/0!": 2,
      "#VALUE!": 3,
      "#REF!": 4,
      "#NAME?": 5,
      "#NUM!": 6,
      "#N/A": 7,
      "#CYCLE!": 8,
    };
    return codes[value.code] ?? 7;
  },
});
