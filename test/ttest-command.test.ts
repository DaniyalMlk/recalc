import { describe, expect, it } from "vitest";
import { PLAIN, tTestCommand } from "../src/analysis/commands.js";
import {
  TTEST_USAGE,
  parseTTestCommand,
  runTTest,
} from "../src/analysis/ttest.js";
import { Workbook } from "../src/engine/workbook.js";
import { pairedT, pooledT, welchT } from "../src/numeric/inference.js";

const FIRST = [3, 4, 5, 8, 9, 1, 2, 4, 5];
const SECOND = [6, 19, 3, 2, 14, 4, 5, 17, 1];

function sheet(): Workbook {
  const book = new Workbook();
  FIRST.forEach((value, index) => book.setCell(`A${index + 1}`, value));
  SECOND.forEach((value, index) => book.setCell(`B${index + 1}`, value));
  return book;
}

const run = (tail: string) => tTestCommand(sheet(), tail, PLAIN);

describe("parsing the command", () => {
  it("defaults to Welch, two-tailed", () => {
    const parsed = parseTTestCommand("A1:A9 vs B1:B9");
    expect(typeof parsed).not.toBe("string");
    if (typeof parsed === "string") return;
    expect(parsed.kind).toBe("welch");
    expect(parsed.tails).toBe(2);
  });

  it("reads each kind by name, in any order with the tail count", () => {
    for (const kind of ["paired", "pooled", "welch"] as const) {
      const parsed = parseTTestCommand(`A1:A9 vs B1:B9 ${kind} one-tailed`);
      if (typeof parsed === "string") throw new Error(parsed);
      expect(parsed.kind).toBe(kind);
      expect(parsed.tails).toBe(1);
    }
    const swapped = parseTTestCommand("A1:A9 vs B1:B9 one-tailed pooled");
    if (typeof swapped === "string") throw new Error(swapped);
    expect(swapped.kind).toBe("pooled");
    expect(swapped.tails).toBe(1);
  });

  it("is case-insensitive on the keywords", () => {
    const parsed = parseTTestCommand("A1:A9 VS B1:B9 PAIRED");
    if (typeof parsed === "string") throw new Error(parsed);
    expect(parsed.kind).toBe("paired");
  });

  it("refuses a line it cannot read", () => {
    expect(parseTTestCommand("nonsense")).toBe(TTEST_USAGE);
    expect(parseTTestCommand("")).toBe(TTEST_USAGE);
  });

  it("refuses something that is not a block", () => {
    expect(parseTTestCommand("hello vs there")).toContain("blocks");
  });

  it("refuses an unknown word rather than ignoring it", () => {
    expect(parseTTestCommand("A1:A9 vs B1:B9 sideways")).toContain("sideways");
  });
});

describe("running the test", () => {
  it("agrees with the library function it wraps", () => {
    const book = sheet();
    for (const [kind, expected] of [
      ["paired", pairedT(FIRST, SECOND)],
      ["pooled", pooledT(FIRST, SECOND)],
      ["welch", welchT(FIRST, SECOND)],
    ] as const) {
      const parsed = parseTTestCommand(`A1:A9 vs B1:B9 ${kind}`);
      if (typeof parsed === "string") throw new Error(parsed);
      const report = runTTest(book, parsed);
      expect(report.t).toBeCloseTo(expected.t, 14);
      expect(report.df).toBeCloseTo(expected.df, 12);
      expect(report.p).toBeCloseTo(expected.p, 14);
    }
  });

  it("halves the probability for a one-tailed test and nothing else", () => {
    const book = sheet();
    const two = parseTTestCommand("A1:A9 vs B1:B9 pooled");
    const one = parseTTestCommand("A1:A9 vs B1:B9 pooled one-tailed");
    if (typeof two === "string" || typeof one === "string") throw new Error();
    const a = runTTest(book, two);
    const b = runTTest(book, one);
    expect(b.p * 2).toBeCloseTo(a.p, 15);
    expect(b.t).toBe(a.t);
    expect(b.df).toBe(a.df);
  });

  it("summarises each sample separately", () => {
    const book = sheet();
    const parsed = parseTTestCommand("A1:A9 vs B1:B9");
    if (typeof parsed === "string") throw new Error(parsed);
    const report = runTTest(book, parsed);
    expect(report.first.count).toBe(9);
    expect(report.second.count).toBe(9);
    expect(report.first.mean).toBeCloseTo(41 / 9, 12);
    expect(report.second.mean).toBeCloseTo(71 / 9, 12);
    expect(report.difference).toBeCloseTo(
      report.first.mean - report.second.mean,
      15,
    );
  });

  it("reads samples of different lengths for an unpaired test", () => {
    const book = sheet();
    const parsed = parseTTestCommand("A1:A9 vs B1:B5");
    if (typeof parsed === "string") throw new Error(parsed);
    const report = runTTest(book, parsed);
    expect(report.first.count).toBe(9);
    expect(report.second.count).toBe(5);
    expect(report.p).toBeCloseTo(welchT(FIRST, SECOND.slice(0, 5)).p, 14);
  });
});

describe("what the command prints", () => {
  it("lays out both samples and the statistics", () => {
    const out = run("A1:A9 vs B1:B9");
    expect(out).toContain("sample");
    expect(out).toContain("A1:A9");
    expect(out).toContain("B1:B9");
    expect(out).toContain("variance");
    expect(out).toContain("difference in means");
    expect(out).toContain("degrees of freedom");
    expect(out).toContain("welch, two-tailed");
    expect(out).toContain("0.202294");
  });

  it("names the test and the tails it was run with", () => {
    expect(run("A1:A9 vs B1:B9 paired")).toContain("paired, two-tailed");
    expect(run("A1:A9 vs B1:B9 pooled one-tailed")).toContain(
      "pooled, one-tailed",
    );
  });

  it("shows Welch's fractional degrees of freedom rather than rounding", () => {
    const out = run("A1:A9 vs B1:B5");
    const line = out
      .split("\n")
      .find((text) => text.includes("degrees of freedom"));
    expect(line).toBeDefined();
    expect(line).toMatch(/\d+\.\d+/);
  });

  it("refuses a paired test on samples of different lengths", () => {
    expect(run("A1:A9 vs B1:B8 paired")).toContain("same count");
  });

  it("refuses a sample too small to have a spread", () => {
    expect(run("A1:A1 vs B1:B1")).toContain("at least two");
  });

  it("refuses a block holding text", () => {
    const book = sheet();
    book.setCell("A4", "eight");
    expect(tTestCommand(book, "A1:A9 vs B1:B9", PLAIN)).toContain("numbers");
  });

  it("refuses a usage it cannot parse without throwing", () => {
    expect(run("nonsense")).toContain("usage:");
  });
});
