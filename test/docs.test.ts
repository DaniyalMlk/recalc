import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSite, DEMO, PACKAGE, SITE_FILES } from "../docs/site.js";
import { measure } from "../scripts/evidence.js";
import type { Check } from "../scripts/evidence.js";
import { registeredFunctionNames } from "../src/functions/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = buildSite();
const page = site.get("index.html") as string;
const checks: readonly Check[] = measure();

/**
 * Text with the tags taken out, which is what a reader actually sees.
 *
 * Inline tags close up and block tags become a space. Turning every tag into
 * a space instead would put one in front of the comma in
 * `<code>INTERCEPT</code>, and`, and the gate's label has none there — the
 * stripper has to leave the sentence as a reader would read it, or it is
 * comparing against its own artefacts.
 */
const prose = page
  .replace(/<\/?(?:code|strong|em|span|a)\b[^>]*>/g, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&mdash;/g, "—")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&gt;/g, ">")
  .replace(/&lt;/g, "<")
  .replace(/&rsquo;/g, "’")
  .replace(/&ldquo;|&rdquo;/g, "“")
  .replace(/\s+/g, " ");

describe("the generator", () => {
  it("produces the files the site is made of, and no others", () => {
    expect([...site.keys()].sort()).toEqual([...SITE_FILES].sort());
  });

  it("produces a page and a stylesheet that are not empty", () => {
    expect(page.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(page.length).toBeGreaterThan(4000);
    expect((site.get("style.css") as string).length).toBeGreaterThan(2000);
  });
});

describe("the page against the evidence gate", () => {
  // Both directions, which is the whole point of generating the page from the
  // gate rather than writing it beside the gate. One direction alone would
  // let the page quietly drop a row or quietly keep a figure that moved.

  it("carries every row the gate produces", () => {
    for (const check of checks) {
      // The label as the page renders it: backticks become <code>, so compare
      // against the prose with the tags stripped.
      const label = check.label.replace(/`/g, "");
      expect(prose, check.label).toContain(label);
    }
  });

  it("carries as many rows as the gate has, and no extras", () => {
    const rows = page.match(/<tbody>([\s\S]*?)<\/tbody>/);
    expect(rows).not.toBeNull();
    const count = ((rows as RegExpMatchArray)[1] as string).match(/<tr>/g)?.length ?? 0;
    expect(count).toBe(checks.length);
  });

  it("quotes no figure in the table that the gate does not produce", () => {
    const body = (page.match(/<tbody>([\s\S]*?)<\/tbody>/) as RegExpMatchArray)[1] as string;
    const produced = checks.map((check) => `${check.label} ${check.result}`).join(" ");
    for (const figure of body.matchAll(/\d+(?:[.,]\d+)*(?:e-?\d+)?/g)) {
      expect(produced, `the table quotes ${figure[0]}`).toContain(figure[0]);
    }
  });
});

describe("the figures outside the table", () => {
  it("states the function count the registry actually has", () => {
    const count = registeredFunctionNames().length;
    expect(prose).toContain(`${count} functions`);
    // And not a different one: a stale count is exactly the failure this
    // whole arrangement exists to prevent, and it is the one the README
    // carried for months. The number to allow comes from the registry, not
    // from a literal -- a guard against a stale count that carries its own
    // copy of the count is the same defect one level up.
    expect(prose).not.toMatch(
      new RegExp(`\\b(?!${count}\\b)\\d{3} functions`),
    );
  });

  it("repeats the isolated-edit figure from the gate rather than typing it", () => {
    const row = checks.find((check) => check.label.includes("nothing downstream"));
    expect(row).toBeDefined();
    expect(prose).toContain((row as Check).result);
  });

  it("installs under the name the manifest publishes", () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as { name: string };
    expect(PACKAGE).toBe(manifest.name);
    expect(prose).toContain(`npm install ${manifest.name}`);
    // The import name is the distribution name on npm, so the example has to
    // use it too — a page showing `from "recalc"` would not run.
    expect(page).toContain(`from "${manifest.name}"`);
    expect(page).not.toMatch(/from "recalc"/);
  });
});

describe("the page links to the demo it publishes", () => {
  it("points the frame and the fallback link at the demo directory", () => {
    expect(page).toContain(`src="${DEMO}"`);
    expect(page).toContain(`href="${DEMO}"`);
  });

  it("uses relative links throughout, since the site is served from a subpath", () => {
    // GitHub Pages serves a project site under /<repo>/, so an absolute path
    // would resolve to the account's root and 404.
    for (const match of page.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const target = match[1] as string;
      if (target.startsWith("http") || target.startsWith("#") || target.startsWith("data:")) {
        continue;
      }
      expect(target.startsWith("/"), `absolute link: ${target}`).toBe(false);
    }
  });

  it("says the install line does not work yet, while that is true", () => {
    // The page is allowed to print an install line for a package nobody can
    // install, but not silently: until the publisher is registered this
    // sentence is the honest half, and removing it needs the tag to exist.
    expect(prose).toMatch(/trusted publisher is registered/);
  });
});

describe("the workflow that publishes it", () => {
  const workflow = readFileSync(join(ROOT, ".github/workflows/pages.yml"), "utf8");

  it("builds the demo and the site, in that order", () => {
    expect(workflow).toContain("npm run build:web");
    expect(workflow).toContain("npm run docs");
    expect(workflow.indexOf("npm run build:web")).toBeLessThan(
      workflow.indexOf("npm run docs"),
    );
  });

  it("checks the page agrees with the code before publishing it", () => {
    // Before, not after. The generator will happily produce a page whose
    // figures have drifted; this is what says they have not, and publishing
    // first would mean the wrong numbers were public for however long the
    // failure took to notice.
    expect(workflow).toContain("test/docs.test.ts");
    expect(workflow.indexOf("test/docs.test.ts")).toBeLessThan(
      workflow.indexOf("upload-pages-artifact"),
    );
  });

  it("publishes from the default branch only", () => {
    expect(workflow).toMatch(/branches:\s*\[main\]/);
  });

  it("holds id-token: write for the deployment and nothing wider", () => {
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("pages: write");
  });
});
