import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { solveRate } from "../src/functions/solver.js";

/**
 * Every optional property, and whether anything outside its module uses it.
 *
 * An optional property is a claim. On an options bag it says the caller may
 * choose; on a result it says the engine may report. Either way the code that
 * reads it runs, so the lines are covered — but if the only value it has ever
 * held is the one the author wrote down, the claim has never been tested, and
 * a parameter that is wrong for every value except its default passes a green
 * suite without a murmur.
 *
 * So the gate is mechanical. It parses the source, collects the optional
 * properties of every exported interface, and requires of each one that
 *
 * - something outside the declaring file **chooses** it, or
 * - the declaring file **produces** it and something outside **reads** it.
 *
 * The two arms are the two kinds of optional property, and the gate does not
 * have to tell them apart to apply the right one, which matters: a result
 * shape is routinely passed into a renderer, so "appears as a parameter type"
 * does not identify an input, and three of this repository's own result types
 * would have been misfiled by that test. An options bag satisfies the first
 * arm because callers set it. A result shape satisfies the second because its
 * own module fills it in and somebody downstream looks. A property that
 * satisfies neither is a promise nothing has ever taken up.
 *
 * Exported interfaces only: an optional field on a type a module keeps to
 * itself is a shape rather than an offer.
 *
 * There are no exemptions and the gate has no way to grant one. That machinery
 * is the first thing that will be wanted the next time this fails and it is
 * the wrong thing, because an option nobody will choose once in a test is an
 * option to delete.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEARCH = ["src", "test", "scripts", "docs", "web", "bench"];

function sources(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist" || entry === "build") {
        continue;
      }
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (extname(path) === ".ts") found.push(path);
    }
  };
  for (const directory of SEARCH) walk(join(ROOT, directory));
  return found;
}

export interface Declared {
  readonly type: string;
  readonly property: string;
  readonly file: string;
}

/**
 * An optional or defaulted parameter of an exported function.
 *
 * The same claim as an optional property in a different syntax, and the first
 * version of this gate did not see it. Extending it to parameters found
 * `charsForWidth(pixels, charWidth = 7.55, padding = 16)` in the grid's
 * display layer, where nothing had ever passed either argument and both were
 * wrong — the padding by two pixels against the stylesheet and the advance by
 * a twentieth of one against what a browser measures.
 */
export interface DeclaredParameter {
  readonly fn: string;
  readonly name: string;
  /** Its position, which is what a call site has to reach to choose it. */
  readonly index: number;
  readonly file: string;
}

/** Which files mention a property name, by the way they mention it. */
export interface Mentions {
  /** Files containing `{ name: ... }` or `{ name }`. */
  readonly chosen: ReadonlyMap<string, ReadonlySet<string>>;
  /** Files containing `x.name`, `x["name"]` or a destructuring of it. */
  readonly inspected: ReadonlyMap<string, ReadonlySet<string>>;
}

function survey(): {
  declared: Declared[];
  mentions: Mentions;
  parameters: DeclaredParameter[];
  /** Function name to file to the most arguments any call there passed. */
  arities: Map<string, Map<string, number>>;
} {
  const declared: Declared[] = [];
  const parameters: DeclaredParameter[] = [];
  const arities = new Map<string, Map<string, number>>();
  const chosen = new Map<string, Set<string>>();
  const inspected = new Map<string, Set<string>>();

  for (const file of sources()) {
    const tree = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.ES2022,
      true,
    );
    const note = (into: Map<string, Set<string>>, key: string): void => {
      const files = into.get(key) ?? new Set<string>();
      files.add(file);
      into.set(key, files);
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isInterfaceDeclaration(node) &&
        node.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        ) === true
      ) {
        for (const member of node.members) {
          if (
            ts.isPropertySignature(member) &&
            member.questionToken !== undefined &&
            member.name !== undefined &&
            ts.isIdentifier(member.name)
          ) {
            declared.push({
              type: node.name.text,
              property: member.name.text,
              file,
            });
          }
        }
      }
      const collect = (
        fn: string,
        list: ts.NodeArray<ts.ParameterDeclaration>,
      ): void => {
        list.forEach((parameter, index) => {
          if (!ts.isIdentifier(parameter.name)) return;
          if (
            parameter.questionToken === undefined &&
            parameter.initializer === undefined
          ) {
            return;
          }
          parameters.push({ fn, name: parameter.name.text, index, file });
        });
      };
      if (
        ts.isFunctionDeclaration(node) &&
        node.name !== undefined &&
        ts.canHaveModifiers(node) &&
        ts.getModifiers(node)?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        ) === true
      ) {
        collect(node.name.text, node.parameters);
      }
      // A method of an exported class is the same claim again. Private ones
      // are not: a parameter nobody outside the class can reach is a shape
      // rather than an offer, exactly as an optional property of an
      // unexported interface is.
      if (
        ts.isMethodDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        ts.isClassDeclaration(node.parent) &&
        ts.getModifiers(node.parent)?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        ) === true &&
        ts.getModifiers(node)?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword,
        ) !== true
      ) {
        collect(node.name.text, node.parameters);
      }
      if (ts.isCallExpression(node)) {
        // Matched by name, which cannot tell two functions with the same name
        // apart. That is the forgiving direction: a call to the other one
        // counts as exercising this one, so the gate under-reports rather than
        // inventing an offender.
        const callee = ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : null;
        if (callee !== null) {
          const perFile = arities.get(callee) ?? new Map<string, number>();
          perFile.set(
            file,
            Math.max(perFile.get(file) ?? 0, node.arguments.length),
          );
          arities.set(callee, perFile);
        }
      }
      if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
        if (ts.isIdentifier(node.name)) note(chosen, node.name.text);
      }
      if (ts.isPropertyAccessExpression(node)) note(inspected, node.name.text);
      if (
        ts.isElementAccessExpression(node) &&
        node.argumentExpression !== undefined &&
        ts.isStringLiteral(node.argumentExpression)
      ) {
        note(inspected, node.argumentExpression.text);
      }
      if (ts.isBindingElement(node)) {
        const key = node.propertyName ?? node.name;
        if (ts.isIdentifier(key)) note(inspected, key.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return { declared, mentions: { chosen, inspected }, parameters, arities };
}

/**
 * The gate's rule, as a function of the survey rather than of the repository.
 *
 * It is extracted because a rule the current source happens not to exercise is
 * untested: with everything passing, an arm of this condition could be wrong
 * in either direction and nothing would say so. The tests below drive it with
 * a map built for the purpose.
 */
export function unusedOptional(
  declared: readonly Declared[],
  mentions: Mentions,
): string[] {
  const somewhereElse = (
    where: ReadonlyMap<string, ReadonlySet<string>>,
    property: string,
    own: string,
  ): boolean => {
    const files = where.get(property);
    if (files === undefined) return false;
    return [...files].some((file) => file !== own);
  };
  const unused = declared.filter((entry) => {
    const chosenElsewhere = somewhereElse(
      mentions.chosen,
      entry.property,
      entry.file,
    );
    const producedHere =
      mentions.chosen.get(entry.property)?.has(entry.file) === true;
    const inspectedElsewhere = somewhereElse(
      mentions.inspected,
      entry.property,
      entry.file,
    );
    return !(chosenElsewhere || (producedHere && inspectedElsewhere));
  });
  return [...new Set(unused.map((e) => `${e.type}.${e.property}`))].sort();
}

/**
 * The parameter rule: somewhere outside the declaring file must pass an
 * argument in that position.
 *
 * Positional rather than by name, because that is what choosing an optional
 * parameter actually requires — a caller reaching the third parameter has
 * passed the second whether it wanted to or not, which is a property of the
 * syntax and a reason to prefer an options bag once there are two of them.
 */
export function unpassedParameter(
  parameters: readonly DeclaredParameter[],
  arities: ReadonlyMap<string, ReadonlyMap<string, number>>,
): string[] {
  const unpassed = parameters.filter((parameter) => {
    const perFile = arities.get(parameter.fn);
    if (perFile === undefined) return true;
    let most = 0;
    for (const [file, count] of perFile) {
      if (file !== parameter.file) most = Math.max(most, count);
    }
    return most <= parameter.index;
  });
  return [
    ...new Set(
      unpassed.map((p) => `${p.fn}(#${p.index} ${p.name})`),
    ),
  ].sort();
}

const { declared, mentions, parameters, arities } = survey();

describe("every optional property is used outside the module that declares it", () => {
  it("surveyed the source it claims to have surveyed", () => {
    // A gate of the form "nothing is unused" passes trivially over an empty
    // survey, so the survey is asserted first: enough files, enough optional
    // properties, and four that are certainly among them.
    expect(sources().length).toBeGreaterThan(140);
    expect(declared.length).toBeGreaterThan(30);
    const names = new Set(declared.map((e) => `${e.type}.${e.property}`));
    for (const certain of [
      "SolveOptions.maxIterations",
      "RootOptions.maxEvaluations",
      "CsvOptions.delimiter",
      "GoalSeekResult.problem",
    ]) {
      expect(names).toContain(certain);
    }
  });

  it("leaves none of them unused", () => {
    expect(unusedOptional(declared, mentions)).toEqual([]);
  });

  it("surveyed the exported functions' parameters too", () => {
    expect(parameters.length).toBeGreaterThan(30);
    const names = new Set(parameters.map((p) => `${p.fn}(#${p.index})`));
    for (const certain of [
      "charsForWidth(#1)",
      "charsForWidth(#2)",
      "displayValue(#1)",
      // A method of an exported class, which the first version of this could
      // not see at all.
      "insertRows(#1)",
      "advance(#1)",
    ]) {
      expect(names).toContain(certain);
    }
    expect(
      parameters.filter((p) => p.fn === "insertRows").length,
    ).toBeGreaterThan(0);
    // And the call-site survey found calls at all, since "every parameter was
    // passed" is satisfied by a table that thinks everything was called with
    // every argument.
    expect(arities.size).toBeGreaterThan(200);
  });

  it("leaves no optional or defaulted parameter unpassed", () => {
    expect(unpassedParameter(parameters, arities)).toEqual([]);
  });
});

describe("the rule itself", () => {
  const map = (
    entries: readonly (readonly [string, readonly string[]])[],
  ): Map<string, Set<string>> =>
    new Map(entries.map(([key, files]) => [key, new Set(files)]));

  const option: Declared = { type: "Opts", property: "cap", file: "own.ts" };

  it("accepts an option something elsewhere chooses", () => {
    expect(
      unusedOptional([option], {
        chosen: map([["cap", ["own.ts", "caller.ts"]]]),
        inspected: map([["cap", ["own.ts"]]]),
      }),
    ).toEqual([]);
  });

  it("rejects an option only its own file ever sets", () => {
    expect(
      unusedOptional([option], {
        chosen: map([["cap", ["own.ts"]]]),
        inspected: map([["cap", ["own.ts"]]]),
      }),
    ).toEqual(["Opts.cap"]);
  });

  it("rejects an option nothing mentions at all", () => {
    expect(
      unusedOptional([option], { chosen: map([]), inspected: map([]) }),
    ).toEqual(["Opts.cap"]);
  });

  it("accepts a result its own file fills in and something else reads", () => {
    expect(
      unusedOptional([option], {
        chosen: map([["cap", ["own.ts"]]]),
        inspected: map([["cap", ["reader.ts"]]]),
      }),
    ).toEqual([]);
  });

  it("rejects a result nothing outside reads, however widely the name is read inside", () => {
    expect(
      unusedOptional([option], {
        chosen: map([["cap", ["own.ts"]]]),
        inspected: map([["cap", ["own.ts"]]]),
      }),
    ).toEqual(["Opts.cap"]);
  });

  it("rejects a field read elsewhere that its own module never fills in", () => {
    // The second arm needs both halves. A property nothing ever assigns is not
    // rescued by being read: the read is of a field that is never there.
    expect(
      unusedOptional([option], {
        chosen: map([]),
        inspected: map([["cap", ["reader.ts"]]]),
      }),
    ).toEqual(["Opts.cap"]);
  });

  const arity = (
    entries: readonly (readonly [string, readonly (readonly [string, number])[]])[],
  ): Map<string, Map<string, number>> =>
    new Map(entries.map(([fn, files]) => [fn, new Map(files)]));

  const parameter: DeclaredParameter = {
    fn: "charsForWidth",
    name: "padding",
    index: 2,
    file: "own.ts",
  };

  it("accepts a parameter a call elsewhere reaches", () => {
    expect(
      unpassedParameter([parameter], arity([["charsForWidth", [["caller.ts", 3]]]])),
    ).toEqual([]);
  });

  it("rejects a parameter no call elsewhere reaches", () => {
    // Two arguments does not reach the third parameter, which is the whole
    // point of counting positions rather than calls.
    expect(
      unpassedParameter([parameter], arity([["charsForWidth", [["caller.ts", 2]]]])),
    ).toEqual(["charsForWidth(#2 padding)"]);
  });

  it("does not count a call in the declaring file", () => {
    expect(
      unpassedParameter([parameter], arity([["charsForWidth", [["own.ts", 3]]]])),
    ).toEqual(["charsForWidth(#2 padding)"]);
  });

  it("rejects a parameter of a function nothing calls", () => {
    expect(unpassedParameter([parameter], arity([]))).toEqual([
      "charsForWidth(#2 padding)",
    ]);
  });

  it("takes the longest call, not the last", () => {
    expect(
      unpassedParameter(
        [parameter],
        arity([["charsForWidth", [["a.ts", 3], ["b.ts", 1]]]]),
      ),
    ).toEqual([]);
  });

  it("names every offender once, and sorted", () => {
    const two: Declared[] = [
      { type: "Zed", property: "a", file: "z.ts" },
      { type: "Abc", property: "b", file: "a.ts" },
      { type: "Abc", property: "b", file: "a.ts" },
    ];
    expect(unusedOptional(two, { chosen: map([]), inspected: map([]) })).toEqual([
      "Abc.b",
      "Zed.a",
    ]);
  });
});

describe("the option that had never been chosen", () => {
  // `SolveOptions.maxIterations` was the one thing the gate found, and it was
  // wrong in the way the gate is built to find: it bounded Newton's steps and
  // nothing else, because bisection had 200 written into it as a literal. The
  // measurements below are the whole case, and they are what the fix had to
  // leave alone and what it had to change.
  const flows = [-1000, 2500, -1560];
  const presentValue = (rate: number): number =>
    flows.reduce((sum, flow, period) => sum + flow / Math.pow(1 + rate, period), 0);

  function counted(f: (x: number) => number): {
    f: (x: number) => number;
    calls: () => number;
  } {
    let calls = 0;
    return {
      f: (x) => {
        calls += 1;
        return f(x);
      },
      calls: () => calls,
    };
  }

  /** The smallest budget at which a root is found at all. */
  function smallestBudget(f: (x: number) => number): number {
    for (let cap = 1; cap <= 400; cap += 1) {
      if (solveRate(f, { maxIterations: cap }) !== null) return cap;
    }
    return -1;
  }

  it("solves the reversal by Newton, at the default budget", () => {
    // Roots at exactly 20% and 30%: clearing the denominators leaves
    // 1000u² - 2500u + 1560 = 0 in u = 1 + r, which factors at 1.2 and 1.3.
    // Newton from the default guess of 0.1 reaches the first in seven steps
    // and nineteen evaluations, and lands within two parts in 10^15.
    const probe = counted(presentValue);
    const root = solveRate(probe.f);
    expect(Math.abs((root ?? 0) - 0.2)).toBeLessThan(2e-15);
    expect(probe.calls()).toBe(19);
    expect(smallestBudget(presentValue)).toBe(7);
  });

  it("reports no root when the budget is too small to find one", () => {
    // Before the fix every one of these returned 0.20000000000056695 —
    // bisection's answer, three hundred and fifty times further from 0.2 than
    // Newton's, found by a search the budget did not reach, at thirteen times
    // the evaluations. A cap of five is not a licence to run a different
    // search; it is five iterations.
    for (const maxIterations of [1, 2, 3, 4, 5, 6]) {
      expect(solveRate(presentValue, { maxIterations })).toBeNull();
    }
  });

  it("spends nothing at all on a budget that is not a number of iterations", () => {
    for (const maxIterations of [
      0,
      -3,
      2.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const probe = counted(presentValue);
      expect(solveRate(probe.f, { maxIterations })).toBeNull();
      expect(probe.calls()).toBe(0);
    }
  });

  it("bounds bisection, which is the search the option never reached", () => {
    // Newton cannot start on this one: the numerical derivative at the default
    // guess is exactly zero, because the guess sits on the turning point. So
    // the bracketing search decides, and that is the path the literal 200 used
    // to govern on its own.
    const turningPoint = (rate: number): number =>
      Math.pow(rate - 0.1, 2) - 0.04; // roots at -0.1 and 0.3
    expect(solveRate(turningPoint)).toBeCloseTo(-0.1, 9);
    // Twenty-six halvings to narrow the bracket the scan hands it, and not
    // twenty-five: the cap now decides whether the search finishes.
    expect(smallestBudget(turningPoint)).toBe(26);
    expect(solveRate(turningPoint, { maxIterations: 25 })).toBeNull();

    // The worst case the scan can produce — a root just under the upper bound,
    // with Newton again refused — takes forty-nine. The default of two
    // hundred is not close to binding, which is why nothing had noticed that
    // only one of the two searches was bounded by the option.
    const wide = (rate: number): number =>
      Math.pow(rate - 0.1, 2) - Math.pow(949999.9, 2);
    expect(solveRate(wide)).toBeCloseTo(950000, 6);
    expect(smallestBudget(wide)).toBe(49);
  });

  it("leaves every existing caller exactly where it was", () => {
    // Nothing in the repository passes the option, so the default is the whole
    // of the observable behaviour: the same budget reaches Newton, and
    // bisection's budget is the same 200 it had as a literal.
    const probe = counted(presentValue);
    expect(solveRate(probe.f, { maxIterations: 200 })).toBe(
      solveRate(presentValue),
    );
    expect(probe.calls()).toBe(19);
  });
});
