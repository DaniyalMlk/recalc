import { describe, expect, it } from "vitest";

import { applyGoalSeek, goalSeek } from "../src/analysis/goalseek.js";
import { Workbook } from "../src/engine/workbook.js";

/**
 * The models here are the ones goal seek exists for: a break-even price, a
 * loan payment, an IRR hurdle. Each has an answer that can be worked out in
 * closed form, so the test asserts the number rather than "it converged".
 */
function breakEven(): Workbook {
  const book = new Workbook();
  book.setCells({
    A1: "Unit price",
    B1: 30,
    A2: "Units",
    B2: 1200,
    A3: "Variable cost",
    B3: 18,
    A4: "Fixed cost",
    B4: 20000,
    A5: "Profit",
    B5: "=(B1-B3)*B2-B4",
  });
  book.clearHistory();
  return book;
}

describe("goalSeek", () => {
  it("solves a linear model exactly", () => {
    const book = breakEven();
    const result = goalSeek(book, { target: "B5", to: 0, changing: "B1" });
    expect(result.converged).toBe(true);
    // (p - 18) * 1200 = 20000  ->  p = 18 + 50/3
    expect(result.value).toBeCloseTo(18 + 20000 / 1200, 9);
    expect(result.achieved).toBeCloseTo(0, 6);
  });

  it("reports where the input started", () => {
    const book = breakEven();
    expect(goalSeek(book, { target: "B5", to: 0, changing: "B1" }).startedFrom)
      .toBe(30);
  });

  it("leaves the sheet untouched", () => {
    const book = breakEven();
    goalSeek(book, { target: "B5", to: 0, changing: "B1" });
    expect(book.getValue("B1")).toBe(30);
    expect(book.getValue("B5")).toBe((30 - 18) * 1200 - 20000);
    expect(book.canUndo).toBe(false);
  });

  it("aims at a non-zero goal", () => {
    const book = breakEven();
    const result = goalSeek(book, { target: "B5", to: 50_000, changing: "B1" });
    expect(result.converged).toBe(true);
    expect(result.value).toBeCloseTo(18 + 70000 / 1200, 9);
  });

  it("solves for a quantity rather than a price", () => {
    const book = breakEven();
    const result = goalSeek(book, { target: "B5", to: 0, changing: "B2" });
    expect(result.converged).toBe(true);
    expect(result.value).toBeCloseTo(20000 / 12, 9);
  });

  it("solves through a chain of formulas", () => {
    const book = new Workbook();
    book.setCells({
      A1: 4,
      B1: "=A1*A1",
      C1: "=B1+10",
      D1: "=C1*2",
    });
    const result = goalSeek(book, { target: "D1", to: 92, changing: "A1" });
    expect(result.converged).toBe(true);
    expect(Math.abs(result.value)).toBeCloseTo(6, 7);
  });

  it("solves through a range", () => {
    const book = new Workbook();
    book.setCells({
      A1: 10,
      A2: 20,
      A3: 30,
      B1: "=SUM(A1:A3)",
    });
    const result = goalSeek(book, { target: "B1", to: 100, changing: "A2" });
    expect(result.converged).toBe(true);
    expect(result.value).toBeCloseTo(60, 9);
  });

  it("solves a rate hidden inside a compounding formula", () => {
    const book = new Workbook();
    book.setCells({
      A1: 0.05,
      B1: 250000,
      C1: 10,
      D1: "=B1*(1+A1)^C1",
    });
    const result = goalSeek(book, { target: "D1", to: 500_000, changing: "A1" });
    expect(result.converged).toBe(true);
    expect(result.value).toBeCloseTo(2 ** 0.1 - 1, 9);
  });

  it("solves for a discount rate that hits an NPV", () => {
    const book = new Workbook();
    book.setCells({
      A1: 0.1,
      B1: -100000,
      C1: 40000,
      D1: 45000,
      E1: 50000,
      F1: "=B1+NPV(A1,C1:E1)",
    });
    const result = goalSeek(book, { target: "F1", to: 0, changing: "A1" });
    expect(result.converged).toBe(true);

    // The rate at which NPV is zero is the IRR by definition, and the engine
    // computes that a completely different way — a dedicated root find inside
    // the function pack, not a search over the sheet. The two answers agreeing
    // is a real cross-check rather than a restatement.
    book.setCell("G1", "=IRR(B1:E1)");
    expect(result.value).toBeCloseTo(book.getValue("G1") as number, 8);
  });

  it("solves a loan payment for a target balance", () => {
    const book = new Workbook();
    book.setCells({
      A1: 0.06 / 12,
      A2: 360,
      A3: 2200,
      B1: "=PV(A1,A2,-A3)",
    });
    const result = goalSeek(book, {
      target: "B1",
      to: 400_000,
      changing: "A3",
    });
    expect(result.converged).toBe(true);
    expect(result.value).toBeGreaterThan(2300);
    expect(result.value).toBeLessThan(2500);
    // Check the answer by substituting it back through the sheet itself.
    expect(book.probe([["A3", String(result.value)]], "B1")).toBeCloseTo(
      400_000,
      4,
    );
  });

  it("finds a root left of the starting point", () => {
    const book = new Workbook();
    book.setCells({ A1: 100, B1: "=A1*3+600" });
    const result = goalSeek(book, { target: "B1", to: 0, changing: "A1" });
    expect(result.converged).toBe(true);
    expect(result.value).toBeCloseTo(-200, 9);
  });

  it("starts from an empty changing cell", () => {
    const book = new Workbook();
    book.setCells({ B1: "=A1*4-20" });
    const result = goalSeek(book, { target: "B1", to: 0, changing: "A1" });
    expect(result.converged).toBe(true);
    expect(result.value).toBeCloseTo(5, 9);
    expect(book.has("A1")).toBe(false);
  });

  it("counts the recalculations it needed", () => {
    const book = breakEven();
    const result = goalSeek(book, { target: "B5", to: 0, changing: "B1" });
    expect(result.evaluations).toBeGreaterThan(0);
    expect(result.evaluations).toBeLessThan(40);
  });

  it("honours an evaluation cap", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, B1: "=A1*A1+5" });
    const result = goalSeek(book, {
      target: "B1",
      to: 0,
      changing: "A1",
      maxEvaluations: 25,
    });
    expect(result.converged).toBe(false);
    expect(result.evaluations).toBeLessThanOrEqual(25);
  });

  it("stays inside bounds it was given", () => {
    const book = breakEven();
    const result = goalSeek(book, {
      target: "B5",
      to: 0,
      changing: "B1",
      lower: 40,
      upper: 100,
    });
    expect(result.converged).toBe(false);
    expect(result.value).toBeGreaterThanOrEqual(40);
  });
});

describe("goalSeek refusals", () => {
  it("refuses to overwrite a formula", () => {
    const book = new Workbook();
    book.setCells({ A1: 2, B1: "=A1*2", C1: "=B1+1" });
    const result = goalSeek(book, { target: "C1", to: 10, changing: "B1" });
    expect(result.converged).toBe(false);
    expect(result.problem).toBe("changing-is-formula");
    expect(result.message).toContain("holds a formula");
  });

  it("refuses a changing cell holding text", () => {
    const book = new Workbook();
    book.setCells({ A1: "hello", B1: "=LEN(A1)" });
    const result = goalSeek(book, { target: "B1", to: 8, changing: "A1" });
    expect(result.problem).toBe("changing-not-numeric");
  });

  it("refuses a target that is not a formula", () => {
    const book = new Workbook();
    book.setCells({ A1: 2, B1: 9 });
    const result = goalSeek(book, { target: "B1", to: 10, changing: "A1" });
    expect(result.problem).toBe("target-not-formula");
  });

  it("says so when the target does not read the changing cell", () => {
    const book = new Workbook();
    book.setCells({ A1: 2, B1: 5, C1: "=B1*2" });
    const result = goalSeek(book, { target: "C1", to: 20, changing: "A1" });
    expect(result.converged).toBe(false);
    expect(result.problem).toBe("target-independent");
    expect(result.message).toContain("does not depend on");
    expect(result.evaluations).toBe(0);
  });

  it("does not confuse independence with non-convergence", () => {
    const book = new Workbook();
    book.setCells({ A1: 2, B1: 5, C1: "=B1*2" });
    expect(goalSeek(book, { target: "C1", to: 20, changing: "A1" }).problem)
      .not.toBe("no-convergence");
  });

  it("reports non-convergence when the goal is unreachable", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, B1: "=A1*A1+5" });
    const result = goalSeek(book, { target: "B1", to: 0, changing: "A1" });
    expect(result.converged).toBe(false);
    expect(result.problem).toBe("no-convergence");
    // A1*A1+5 bottoms out at 5, so the closest approach is just above it.
    expect(result.achieved).toBeGreaterThanOrEqual(5);
    expect(result.achieved).toBeLessThan(5.05);
  });

  it("keeps the closest approach on a failure", () => {
    const book = new Workbook();
    book.setCells({ A1: 3, B1: "=A1*A1+9" });
    const result = goalSeek(book, { target: "B1", to: 0, changing: "A1" });
    expect(result.converged).toBe(false);
    expect(result.achieved).toBeGreaterThanOrEqual(9);
    expect(result.achieved).toBeLessThan(9.1);
  });

  it("reports a target that errors everywhere", () => {
    const book = new Workbook();
    book.setCells({ A1: 5, B1: '=IF(TRUE,"text",A1)', C1: "=B1&A1" });
    const result = goalSeek(book, { target: "C1", to: 1, changing: "A1" });
    expect(result.converged).toBe(false);
    expect(result.problem).toBe("target-not-numeric");
  });

  it("solves a target that errors at some inputs but not others", () => {
    const book = new Workbook();
    book.setCells({ A1: 4, B1: "=100/(A1-2)" });
    const result = goalSeek(book, { target: "B1", to: 25, changing: "A1" });
    expect(result.converged).toBe(true);
    expect(result.value).toBeCloseTo(6, 7);
  });
});

describe("applyGoalSeek", () => {
  it("writes the answer into the changing cell", () => {
    const book = breakEven();
    const result = applyGoalSeek(book, {
      target: "B5",
      to: 0,
      changing: "B1",
    });
    expect(result.converged).toBe(true);
    expect(book.getValue("B1")).toBeCloseTo(result.value, 12);
    expect(book.getValue("B5")).toBeCloseTo(0, 6);
  });

  it("is one undoable step", () => {
    const book = breakEven();
    applyGoalSeek(book, { target: "B5", to: 0, changing: "B1" });
    expect(book.canUndo).toBe(true);
    book.undo();
    expect(book.getValue("B1")).toBe(30);
    expect(book.canUndo).toBe(false);
  });

  it("writes nothing when the search fails", () => {
    const book = new Workbook();
    book.setCells({ A1: 1, B1: "=A1*A1+5" });
    book.clearHistory();
    const result = applyGoalSeek(book, {
      target: "B1",
      to: 0,
      changing: "A1",
    });
    expect(result.converged).toBe(false);
    expect(book.getValue("A1")).toBe(1);
    expect(book.canUndo).toBe(false);
  });
});
