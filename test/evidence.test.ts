import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { measure, renderTable, type Check } from "../scripts/evidence.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const README = readFileSync(join(ROOT, "README.md"), "utf8");

const checks: readonly Check[] = measure();

/** The rows of the README's evidence table, exactly as written. */
function readmeRows(): readonly string[] {
  const section = /## What is checked, and against what\n([\s\S]*?)\n## /.exec(README);
  if (section === null) throw new Error("the README has no evidence section");
  return (section[1] as string)
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.trim());
}

describe("the evidence gate", () => {
  it("measures something, and every check passes", () => {
    expect(checks.length).toBeGreaterThan(4);
    for (const check of checks) {
      expect(check.ok, `${check.label}: ${check.complaint ?? ""}`).toBe(true);
    }
  });

  it("is run by CI, or the table is pinned to nothing", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(workflow).toContain("npm run evidence");
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["evidence"]).toBeDefined();
  });
});

describe("the README table against the gate", () => {
  const rows = readmeRows();

  it("has the header and one row per check", () => {
    expect(rows[0]).toBe("| Check | Result |");
    expect(rows[1]).toBe("| --- | --- |");
    expect(rows.length - 2).toBe(checks.length);
  });

  it("prints every check as the gate renders it, row for row", () => {
    // The whole rendered row, in order. Checking the figures alone would pass
    // a table whose numbers had been shuffled between rows — each would still
    // appear somewhere on the page — and a figure under the wrong claim is
    // worse than one that is merely out of date.
    expect(rows.join("\n")).toBe(renderTable(checks));
  });

  it("carries the label of every check", () => {
    for (const check of checks) expect(README).toContain(check.label);
  });

  it("quotes no figure the gate does not produce", () => {
    for (const [index, check] of checks.entries()) {
      const row = rows[index + 2] as string;
      for (const figure of row.matchAll(/\d+(?:[.,]\d+)*(?:e-?\d+)?/g)) {
        expect(`${check.label} ${check.result}`).toContain(figure[0]);
      }
    }
  });
});

describe("the prose around the table", () => {
  it("states the cost figures as counts rather than durations", () => {
    const section = README.slice(
      README.indexOf("## What is checked, and against what"),
      README.indexOf("## Installing it"),
    );
    // The point of the section is that the gated figures do not depend on the
    // machine. A millisecond inside it would contradict that in place.
    expect(section).not.toMatch(/\bms\b/);
    expect(section).toContain("counts, not durations");
  });

  it("quotes the isolated-edit sheet sizes the gate measured", () => {
    const row = checks.find((check) => check.label.includes("nothing downstream"));
    expect(row).toBeDefined();
    for (const size of ["2,000", "20,000", "100,000"]) {
      expect((row as Check).result).toContain(size);
      expect(README).toContain(size);
    }
  });

  it("still labels the timing table as one run on one machine", () => {
    // The millisecond measurements are kept — they answer a question the
    // counts do not — but they are not evidence, and the README has to go on
    // saying so.
    expect(README).toContain("from one run on an ordinary machine");
  });
});
