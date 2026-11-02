import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import { parseFormatCode } from "../src/format/code.js";
import { steppedSchedule } from "../src/analysis/amortisation.js";
import { registeredFunctionNames } from "../src/functions/index.js";
import { exportCsv, importCsv } from "../src/io/csv.js";

/**
 * The README's known gaps, and whether each one is still a gap.
 *
 * What an engine does *not* do is harder to find out than what it does, and
 * the suite will not tell you: a test says nothing about the cases nobody
 * wrote. So the README carries the list, and this file pairs every line of it
 * with a check.
 *
 * The failure worth guarding against is not an incomplete list but a stale
 * one. A line saying something is missing after it has been built is worse
 * than no line at all, because it is believed — and this list had three such
 * lines at once. One claimed a `d.m.yyyy` code renders as `432026` *and* that
 * a second decimal point in a section is refused, which cannot both hold of a
 * code with two of them. One claimed a fraction code combined with a decimal
 * point is refused, which was true in one order and not the other. One said
 * the shell printing the rank was as close as the surface got to naming a
 * dropped column. All three were written in good faith and went out of date
 * where nothing was watching them.
 *
 * So the gate fails five ways: a bullet with no entry here, an entry with no
 * bullet, the list shrinking, a bullet going thin, and a check that no longer
 * holds because the thing it says is missing has been built. Closing a gap
 * therefore breaks this file, which is the point — the line comes out
 * deliberately rather than being left behind.
 *
 * Where a gap is a *behaviour*, the check runs the engine, which is as sharp
 * as a check can be: `=IF(TRUE,,2)` either displays as empty or it does not.
 * Where it is an absence, the check asks whether anything in the source is
 * named for the missing thing, which is weaker — and weaker in the safe
 * direction, since a name can appear without the behaviour and then the line
 * comes out and is replaced by something sharper. What cannot happen is the
 * behaviour arriving while the line stays.
 *
 * There is no exemption mechanism, deliberately.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (extname(path) === ".ts") found.push(path);
    }
  };
  walk(join(ROOT, "src"));
  return found;
}

interface Surface {
  /** Every name the source declares, at any depth, exported or not. */
  readonly names: ReadonlySet<string>;
  /** The property and method names of each interface and class, by name. */
  readonly members: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * The inventory the name-based checks read, built by parsing rather than
 * grepping.
 *
 * Parsed, because a grep over the source finds the concept in the prose that
 * explains why it is absent: this repository's comments discuss implicit
 * intersection, cross-sheet references and column formats at the points where
 * it does without them, and a grep-backed check would read those paragraphs
 * as the feature arriving.
 */
function readSurface(): Surface {
  const names = new Set<string>();
  const members = new Map<string, Set<string>>();

  for (const file of sourceFiles()) {
    const tree = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.ES2022,
      true,
    );
    const visit = (node: ts.Node): void => {
      const named = node as { name?: ts.Node };
      if (named.name !== undefined && ts.isIdentifier(named.name)) {
        names.add(named.name.text);
      }
      if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
        const own = new Set<string>();
        for (const member of node.members) {
          if (member.name !== undefined && ts.isIdentifier(member.name)) {
            own.add(member.name.text);
          }
        }
        const existing = members.get(node.name?.text ?? "") ?? new Set<string>();
        for (const name of own) existing.add(name);
        if (node.name !== undefined) members.set(node.name.text, existing);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }

  return { names, members };
}

const SURFACE = readSurface();

/** True when the source declares no name matching `pattern`. */
function nothingNamed(pattern: RegExp): boolean {
  for (const name of SURFACE.names) if (pattern.test(name)) return false;
  return true;
}

/** True when the named declaration has no member matching `pattern`. */
function noMemberNamed(declaration: string, pattern: RegExp): boolean {
  const own = SURFACE.members.get(declaration);
  if (own === undefined) return false; // a missing declaration proves nothing
  for (const name of own) if (pattern.test(name)) return false;
  return true;
}

/** True when a file exists and its text does not match `pattern`. */
function fileLacks(path: string, pattern: RegExp): boolean {
  return !pattern.test(readFileSync(join(ROOT, path), "utf8"));
}

/** Whether a format code is refused outright. */
function refusesCode(code: string): boolean {
  try {
    parseFormatCode(code);
    return false;
  } catch {
    return true;
  }
}

/** Whether writing `input` into a fresh sheet throws before it lands. */
function refusesInput(input: string): boolean {
  try {
    new Workbook().setCell("A1", input);
    return false;
  } catch {
    return true;
  }
}

interface Gap {
  /** Text that identifies the bullet, which must appear in exactly one. */
  readonly anchor: string;
  readonly stillOpen: () => boolean;
}

/** One entry per bullet, in the order the README prints them. */
const GAPS: readonly Gap[] = [
  {
    anchor: "The benchmark is not run in continuous integration",
    stillOpen: () => fileLacks(".github/workflows/ci.yml", /run bench/),
  },
  {
    anchor: "Implicit intersection is not implemented",
    // Narrow on purpose. A first attempt at this matched `isSingleValue`,
    // which is the evaluator's test for the *shape* of a value and has
    // nothing to do with intersecting a block against the calling row.
    stillOpen: () => nothingNamed(/implicitIntersection|intersectAt|atOperator/i),
  },
  {
    anchor: "A block cannot be entered over a range",
    stillOpen: () => nothingNamed(/arrayFormula|legacyArray|enteredOver/i),
  },
  {
    anchor: "work on whole lines and nothing narrower",
    stillOpen: () => nothingNamed(/sortWithin|sortColumn|partialRow|narrowSort/i),
  },
  {
    anchor: "`LINEST` does not say which column",
    // The basis exists and the summary reports it; this is about the one
    // surface that cannot, so the check is that the module behind `LINEST`
    // does not read it.
    stillOpen: () => fileLacks("src/functions/regression.ts", /\.basis\b/),
  },
  {
    anchor: "only `LOGEST` and `GROWTH` have worksheet functions",
    stillOpen: () => {
      const registered = new Set(registeredFunctionNames());
      return (
        registered.has("LOGEST") &&
        registered.has("GROWTH") &&
        !["POWEST", "POWERFIT", "POWFIT", "POWERTREND", "CURVEFIT"].some(
          (name) => registered.has(name),
        )
      );
    },
  },
  {
    anchor: "A formula whose result is a blank shows as empty",
    stillOpen: () => {
      const book = new Workbook();
      book.setCells({ A1: "=IF(TRUE,,2)", A2: "=ISBLANK(A1)" });
      // Both halves: it shows as empty, and the sheet agrees it is blank —
      // which is the reason the display is what it is.
      return book.getDisplay("A1") === "" && book.getValue("A2") === true;
    },
  },
  {
    anchor: "Only one sheet",
    // The parser has no sheet-qualified reference at all: `Sheet2!A1` stops
    // at the `!`, which is a stronger statement than any name search.
    stillOpen: () =>
      refusesInput("=Sheet2!A1") && nothingNamed(/addSheet|sheetNamed|activeSheet/i),
  },
  {
    anchor: "Scenarios are not serialised",
    stillOpen: () => noMemberNamed("ScenarioSet", /serialis|serializ|toJSON|fromJSON/i),
  },
  {
    anchor: "A fraction code cannot be combined with a decimal point",
    // This one asserts the limitation rather than its absence, and in both
    // orders, because for a while it held in only one of them.
    stillOpen: () =>
      refusesCode("0.0 ?/?") &&
      refusesCode("?/? 0.0") &&
      refusesCode("0E+0 ?/?") &&
      refusesCode("?/? 0E+0"),
  },
  {
    anchor: "A date is recognised by the format on its cell",
    stillOpen: () => {
      const book = new Workbook();
      book.setCell("A1", "2026-03-04");
      return typeof book.getValue("A1") === "string";
    },
  },
  {
    anchor: "A format belongs to a cell, not to a row",
    stillOpen: () => noMemberNamed("FormatTable", /column|sheetWide|defaultFor/i),
  },
  {
    anchor: "CSV carries no formats",
    stillOpen: () => {
      const book = new Workbook();
      book.setCell("A1", -2_400_000);
      book.setFormat("A1", "#,##0;(#,##0)");
      const text = exportCsv(book, { mode: "display" });
      const second = new Workbook();
      importCsv(second, text);
      // What the sheet showed does not read back as the number it showed it
      // for, which is the whole of the gap.
      return book.getDisplay("A1") === "(2,400,000)" && second.getValue("A1") !== -2_400_000;
    },
  },
  {
    anchor: "A rate step and payments in advance do not combine",
    stillOpen: () => {
      try {
        steppedSchedule({ rate: 0.01, nper: 6, pv: 1000, fv: 0, type: 1 }, [
          { from: 4, rate: 0.02 },
        ]);
        return false;
      } catch {
        return true;
      }
    },
  },
  {
    anchor: "A rate step has to be written out",
    // Also narrowed: `rateIndex` is an argument position in the bond
    // functions, and a search for it read that as a rate index.
    stillOpen: () =>
      noMemberNamed("RateStep", /curve|index|schedule/i) &&
      nothingNamed(/rateCurve|indexedRate|resetOffIndex|floatingIndex/i),
  },
  {
    anchor: "Names can only be defined from the library or the shell",
    stillOpen: () => nothingNamed(/defineNameFromGrid|nameBox|newNameDialog/i),
  },
  {
    anchor: "Reference highlighting outlines only references written out",
    stillOpen: () => fileLacks("src/engine/precedents.ts", /resolveName/),
  },
];

/** The bullets of the README's gap list, split on the leading dash. */
function bullets(): readonly string[] {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const section = /\n## Known gaps\n([\s\S]*?)(?=\n## )/.exec(readme);
  if (section === null) throw new Error("the README has no known-gaps section");
  return section[1]!
    .split(/\n(?=- )/)
    // Collapsed to one line each: the list is wrapped at the margin, so a
    // phrase that identifies a bullet will often straddle a line break.
    .map((chunk) => chunk.trim().replace(/\s+/g, " "))
    .filter((chunk) => chunk.startsWith("- "));
}

describe("the known-gaps list", () => {
  it("surveyed the source it claims to have surveyed", () => {
    // Every check of the form "nothing is named X" passes trivially over an
    // empty inventory, so the inventory is asserted before any of them runs.
    expect(sourceFiles().length).toBeGreaterThan(60);
    expect(SURFACE.names.size).toBeGreaterThan(1500);
    for (const certain of ["Workbook", "parseFormatCode", "steppedSchedule", "FormatTable"]) {
      expect(SURFACE.names).toContain(certain);
    }
    expect(nothingNamed(/steppedSchedule/)).toBe(false);
    expect(SURFACE.members.get("FormatTable")?.size).toBeGreaterThan(5);
    expect(SURFACE.members.get("RateStep")?.size).toBe(2);
    // And a declaration that is not there proves nothing, rather than
    // satisfying a check by being absent.
    expect(noMemberNamed("NoSuchDeclaration", /anything/)).toBe(false);
    expect(registeredFunctionNames().length).toBeGreaterThan(200);
  });

  it("has one bullet for every entry, and in the same order", () => {
    const written = bullets();
    expect(written).toHaveLength(GAPS.length);
    // Each anchor finds exactly one bullet, and finds them in order: a line
    // with no entry here, or an entry with no line, lands on this.
    GAPS.forEach((gap, index) => {
      const matches = written.filter((bullet) => bullet.includes(gap.anchor));
      expect(matches, `the anchor "${gap.anchor}" matched ${matches.length} bullets`).toHaveLength(1);
      expect(written[index], `bullet ${index + 1} is not the one "${gap.anchor}" names`).toContain(
        gap.anchor,
      );
    });
  });

  it("has not quietly shrunk, or grown", () => {
    // The pairing above catches a bullet or an entry added or removed on its
    // own, so loosening this line alone changes nothing. What it catches is
    // the case the pairing cannot see: a line added to *both* places at
    // once, which is how a list of what is missing grows without anyone
    // deciding that it should.
    expect(GAPS).toHaveLength(17);
  });

  it("says what each gap costs, rather than only naming it", () => {
    // A bullet reduced to its first clause is a list entry, not a
    // disclosure: it has to say what the absence means for someone who
    // assumed otherwise. One floor for all of them, and no exemption --
    // `Only one sheet` was four words when this check was written, which is
    // the shortest a sentence can be and still be the whole of a fact, and
    // was not. The shortest bullet now runs to 124 characters.
    for (const gap of GAPS) {
      const bullet = bullets().find((entry) => entry.includes(gap.anchor))!;
      expect(
        bullet.length,
        `the bullet "${gap.anchor}" has gone thin`,
      ).toBeGreaterThan(120);
    }
  });

  it("is still true of every line", () => {
    const closed = GAPS.filter((gap) => !gap.stillOpen()).map((gap) => gap.anchor);
    expect(
      closed,
      "these gaps look closed; take the lines out of the README and the entries out of this table",
    ).toEqual([]);
  });
});
