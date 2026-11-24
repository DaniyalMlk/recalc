import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSite, INSTALL_FROM_SOURCE, PACKAGE } from "../docs/site.js";
import * as recalc from "../src/index.js";

/**
 * What a reader copies off the README or the front page, checked against the
 * package it has to run against.
 *
 * The README's ISO-week example imported `isoWeekOf` and `isoWeeksInYear`
 * from the package, and the root had never re-exported the date module, so
 * neither existed there — nor did anything else in `src/date/`. The suite
 * could not see it: every test imports `../src/date/...` directly, which is
 * right for a test and says nothing about what a caller can reach.
 */

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const page = buildSite().get("index.html") ?? "";
const rootSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const SRC = new URL("../src/", import.meta.url);
const roadmap = readFileSync(new URL("../ROADMAP.md", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  repository: { url: string };
};

/** The text of every fenced or `<pre>` code block in `text`. */
export function codeBlocks(text: string): string[] {
  const fenced = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
  const pre = [...text.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => m[1] ?? "");
  return [...fenced, ...pre];
}

/** Every name an `import { ... } from "<pkg>"` in `text` asks for. */
export function importedNames(text: string, pkg: string): string[] {
  const quoted = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"]${quoted}['"]`, "g");
  const names: string[] = [];
  for (const match of text.matchAll(pattern)) {
    for (const raw of (match[1] ?? "").split(",")) {
      const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0] ?? "";
      if (name !== "") names.push(name);
    }
  }
  return names;
}

/** The directories under `src/` that a root's source re-exports from. */
export function reachedDirectories(source: string): Set<string> {
  return new Set([...source.matchAll(/from\s+["']\.\/([a-z_-]+)\//g)].map((m) => m[1] ?? ""));
}

/**
 * Directories deliberately kept off the root. `numeric` is the distribution
 * and linear-algebra machinery behind the worksheet functions; the functions
 * are the interface, and no example offers the machinery to a caller.
 */
const INTERNAL = new Set(["numeric"]);

describe("the example import parser", () => {
  it("reads names across lines, past `type` and `as`, from one package only", () => {
    const text = [
      'import {\n  alpha,\n  type Beta,\n  gamma as g,\n} from "recalc-formula";',
      "import type { Delta } from 'recalc-formula';",
      'import { epsilon } from "recalc-formula-other";',
      'import { zeta } from "./local.js";',
    ].join("\n");
    expect(importedNames(text, PACKAGE)).toEqual(["alpha", "Beta", "gamma", "Delta"]);
  });

  it("reads the directories a root re-exports, and not its files", () => {
    const source = 'export * from "./date/index.js";\nexport { W } from "./engine/workbook.js";\nexport * from "./cli.js";';
    expect([...reachedDirectories(source)].sort()).toEqual(["date", "engine"]);
  });
});

describe("every name an example imports is one the package exports", () => {
  it.each([
    ["the README", readme, 12],
    ["the front page", page, 1],
  ])("in %s", (_label, text, atLeast) => {
    const names = importedNames(text, PACKAGE);
    // A parser that matched nothing would find nothing missing.
    expect(names.length).toBeGreaterThanOrEqual(atLeast);
    expect(names.filter((name) => !(name in recalc))).toEqual([]);
  });
});

describe("every directory under src reaches the package root", () => {
  const directories = readdirSync(SRC).filter((entry) => statSync(new URL(entry, SRC)).isDirectory());
  const reached = reachedDirectories(rootSource);

  it("is read from a source tree that has directories at all", () => {
    expect(directories.length).toBeGreaterThan(4);
    expect(directories).toEqual(expect.arrayContaining(["date", "engine", "functions"]));
  });

  it("unless it is named as internal", () => {
    expect(directories.filter((dir) => !reached.has(dir) && !INTERNAL.has(dir))).toEqual([]);
  });

  it("and what is named as internal really is", () => {
    // An exemption that outlives the reason for it hides the next directory
    // of the same name, and says something false about this one.
    expect([...INTERNAL].filter((dir) => reached.has(dir) || !directories.includes(dir))).toEqual([]);
  });

  it("reaches every value the date module defines, as the same object", async () => {
    const date = await import("../src/date/index.js");
    const names = Object.keys(date);
    expect(names.length).toBeGreaterThan(30);
    expect(names.filter((name) => (recalc as Record<string, unknown>)[name] !== (date as Record<string, unknown>)[name])).toEqual([]);
  });
});

describe("the README's ISO-week example, run from the package root", () => {
  // Each figure is pinned to the line that prints it, so a right answer
  // quoted against the wrong call cannot pass.
  it("prints what it says", () => {
    const week = recalc.isoWeekOf(recalc.serialFromCivil(2027, 1, 1));
    expect(week).toEqual({ week: 53, weekYear: 2026 });
    expect(readme).toContain(`isoWeekOf(serialFromCivil(2027, 1, 1));   // { week: ${week.week}, weekYear: ${week.weekYear} }`);
    expect(readme).toContain(`isoWeeksInYear(2026);                     // ${recalc.isoWeeksInYear(2026)}`);
    expect(readme).toContain(`isoWeeksInYear(2025);                     // ${recalc.isoWeeksInYear(2025)}`);
  });
});

describe("the install lines say what is true today", () => {
  // Whether the package is on the registry is recorded once, as phase 22's
  // last item, so the install lines are read against it and the check turns
  // over when the item is ticked.
  const releaseLine = /^- \[( |x)\] The trusted publisher registered on npm for `recalc-formula`/m.exec(roadmap);
  const published = releaseLine?.[1] === "x";
  const registryInstall = `npm install ${PACKAGE}`;
  const sourceInstall = `npm install ${INSTALL_FROM_SOURCE}`;

  it("reads the release state off the roadmap", () => {
    expect(releaseLine).not.toBeNull();
  });

  it("installs from the repository it describes", () => {
    const [owner, repo] = INSTALL_FROM_SOURCE.replace(/^github:/, "").split("/");
    expect(manifest.repository.url).toBe(`git+https://github.com/${owner}/${repo}.git`);
  });

  it("finds code in both fenced and HTML blocks, and nothing outside them", () => {
    expect(codeBlocks("a `npm x` b\n```bash\nnpm y\n```\n<pre><code>npm z</code></pre>")).toEqual([
      "npm y\n",
      "npm z",
    ]);
  });

  it.each([
    ["the README", readme],
    ["the front page", page],
  ])("gives %s a command that works", (_label, text) => {
    const blocks = codeBlocks(text).join("\n");
    if (published) {
      expect(blocks).toContain(registryInstall);
    } else {
      // Only a command is checked: the prose may say what the line will be.
      expect(blocks).not.toContain(registryInstall);
      expect(blocks).toContain(sourceInstall);
    }
  });
});

describe("the front page's first example, run from the package root", () => {
  // The page said `lastRecalculated` was 4 after editing B2. It is 5: the
  // count is of cells the edit evaluated, and the edited cell is one of them.
  it("prints what it says", () => {
    const book = new recalc.Workbook();
    book.setCells({
      B1: 1200,
      B2: 24.5,
      B3: 15.25,
      B4: 6000,
      B6: "=B1*B2",
      B8: "=B6-B1*B3",
      B9: "=B8-B4",
      B12: '=IF(B9>0,"profitable","loss-making")',
    });
    const cells = book.cellCount;
    expect(page).toContain(`book.getValue("B9");     // ${String(book.getValue("B9"))}`);
    book.setCell("B2", 26);
    const dependents = book.recalculationOrder("B2").length - 1;
    expect(book.lastRecalculated).toBe(dependents + 1);
    expect(page).toContain(`book.setCell("B2", 26);  // B2 and its ${dependents} dependents, not all ${cells}`);
    expect(page).toContain(`book.lastRecalculated;   // ${book.lastRecalculated}`);
  });
});
