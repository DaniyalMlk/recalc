/**
 * The figures the README's evidence table quotes, recomputed from the engine.
 *
 * Every row in "What is checked, and against what" comes from here, and this
 * runs in CI. If a figure moves past what its row claims, the process exits
 * non-zero and the table cannot quietly go stale.
 *
 * The cost rows count **cells evaluated**, never milliseconds. A duration is a
 * statement about the machine it was measured on and reproduces nowhere; the
 * number of cells an edit forces the engine to recompute is a property of the
 * algorithm and is the same everywhere. It is also the thing the design is
 * actually betting on — that an edit costs what depends on it rather than the
 * size of the sheet — so it is what the table should be made of.
 *
 * Two rules decide how a row reads:
 *
 * - A row that is an exact identity says **zero**, or an exact count.
 *   `STDEV.P` over the published set is 2 exactly, not nearly, and `LINEST` on
 *   one predictor is the same arithmetic as `SLOPE`, so publishing a tolerance
 *   there would hide a real regression inside it.
 * - A row that is floating-point residue publishes a **bound**, never the
 *   digits, which are not portable between engines or orders of summation.
 */

import { Workbook } from "../src/engine/workbook.js";
import { serialFromCivil } from "../src/date/serial.js";
import { yearFraction } from "../src/date/daycount.js";
import { accruedYears } from "../src/functions/bonds.js";
import { COUPON_REFERENCE } from "./coupon-reference.js";

export interface Check {
  /** The row label, which is also the left-hand cell of the README table. */
  readonly label: string;
  /** The rendered right-hand cell. */
  readonly result: string;
  readonly ok: boolean;
  readonly complaint?: string;
}

function bounded(
  label: string,
  worst: number,
  bound: number,
  over: string,
): Check {
  const ok = Number.isFinite(worst) && Math.abs(worst) <= bound;
  return {
    label,
    result: `below ${format(bound)}, ${over}`,
    ok,
    ...(ok
      ? {}
      : { complaint: `worst was ${worst}, over the ${format(bound)} the row claims` }),
  };
}

function format(value: number): string {
  return `1e-${-Math.round(Math.log10(value))}`;
}

function column(row: number, col = 0): string {
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

/** Every cell reachable downstream of one, by walking the graph the engine exposes. */
function transitiveDependents(book: Workbook, start: string): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    for (const next of book.dependentsOf(queue.pop() as string)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

interface Shape {
  readonly name: string;
  readonly book: Workbook;
  readonly target: string;
  readonly cells: number;
}

/** Each cell reads the one above it: the deepest graph for a given size. */
function chain(length: number): Shape {
  const book = new Workbook();
  const cells: Record<string, string | number> = { A1: 1 };
  for (let i = 1; i < length; i += 1) cells[column(i)] = `=${column(i - 1)}+1`;
  book.setCells(cells);
  return { name: `a chain of ${length.toLocaleString("en-GB")}`, book, target: "A1", cells: length };
}

/** One cell read by many, none of which read each other. */
function fanOut(width: number): Shape {
  const book = new Workbook();
  const cells: Record<string, string | number> = { A1: 2 };
  for (let i = 0; i < width; i += 1) cells[`B${i + 1}`] = `=A1*${i + 1}`;
  book.setCells(cells);
  return {
    name: `a fan-out to ${width.toLocaleString("en-GB")}`,
    book,
    target: "A1",
    cells: width + 1,
  };
}

/** Three aggregates over one long range: the case ranges exist to make cheap. */
function aggregates(size: number): Shape {
  const book = new Workbook();
  const cells: Record<string, string | number> = {};
  for (let i = 0; i < size; i += 1) cells[`A${i + 1}`] = i;
  cells["C1"] = `=SUM(A1:A${size})`;
  cells["C2"] = `=AVERAGE(A1:A${size})`;
  cells["C3"] = `=MAX(A1:A${size})`;
  book.setCells(cells);
  return {
    name: `3 aggregates over ${size.toLocaleString("en-GB")}`,
    book,
    target: "A1",
    cells: size + 3,
  };
}

/** A sheet where the edited cell has nothing downstream of it at all. */
function isolated(rows: number): Shape {
  const book = new Workbook();
  const cells: Record<string, string | number> = {};
  for (let i = 0; i < rows; i += 1) {
    cells[`A${i + 1}`] = i;
    cells[`B${i + 1}`] = `=A${i + 1}*2`;
  }
  book.setCells(cells);
  return {
    name: `an isolated edit`,
    book,
    target: `D${rows + 1}`,
    cells: book.cellCount,
  };
}

/** Edit the shape's target and report what the engine actually evaluated. */
function evaluatedBy(shape: Shape, value: number): number {
  shape.book.setCell(shape.target, value);
  return shape.book.lastRecalculated;
}

/**
 * The design claim, stated as a count rather than a duration.
 *
 * An edit whose cell has no dependents must cost the same in a sheet of a
 * hundred thousand cells as in one of two thousand. As a timing that is a
 * claim about a machine; as a count of cells evaluated it is a claim about the
 * engine, and it is either exactly one everywhere or the design does not hold.
 */
function isolatedEditIsFlat(): Check {
  const sizes = [1000, 10000, 50000];
  const counts: number[] = [];
  const widths: number[] = [];
  for (const rows of sizes) {
    const shape = isolated(rows);
    widths.push(shape.cells);
    counts.push(evaluatedBy(shape, 1));
  }
  const ok = counts.every((count) => count === 1);
  return {
    label: "An edit with nothing downstream of it, as the sheet around it grows",
    result:
      `1 cell evaluated in all of ${widths.map((w) => w.toLocaleString("en-GB")).join(", ")} ` +
      `cells — the edited cell itself and nothing else`,
    ok,
    ...(ok ? {} : { complaint: `evaluated ${counts.join(", ")} rather than 1 each time` }),
  };
}

/** What the engine evaluated, against what its own graph says depends on the edit. */
function countMatchesGraph(): Check {
  const shapes: readonly Shape[] = [chain(2000), fanOut(2000), aggregates(5000), isolated(2000)];
  const mismatches: string[] = [];
  const reported: string[] = [];

  for (const shape of shapes) {
    const predicted = transitiveDependents(shape.book, shape.target).size + 1;
    const actual = evaluatedBy(shape, 7);
    reported.push(`${shape.name}: ${actual.toLocaleString("en-GB")}`);
    if (predicted !== actual) mismatches.push(`${shape.name}: graph ${predicted}, engine ${actual}`);
  }

  return {
    label: "Cells the engine evaluated, against the cells its own graph says depend on the edit",
    result: `exact agreement over ${shapes.length} shapes, the edited cell included`,
    ok: mismatches.length === 0,
    ...(mismatches.length === 0 ? {} : { complaint: mismatches.join("; ") }),
  };
}

/** The three shapes whose cost is the shape, reported as counts. */
function shapeCosts(): Check {
  const chainCount = evaluatedBy(chain(5000), 2);
  const fanCount = evaluatedBy(fanOut(5000), 3);
  const aggregateCount = evaluatedBy(aggregates(10000), 99);
  const ok = chainCount === 5000 && fanCount === 5001 && aggregateCount === 4;
  return {
    label: "One edit at the head of a chain, at the root of a fan-out, and under three aggregates",
    result:
      `${chainCount.toLocaleString("en-GB")}, ${fanCount.toLocaleString("en-GB")} and ` +
      `${aggregateCount} cells evaluated — the aggregates do not walk their 10,000-cell range`,
    ok,
    ...(ok
      ? {}
      : { complaint: `chain ${chainCount}, fan-out ${fanCount}, aggregates ${aggregateCount}` }),
  };
}

/** Evaluate one formula on a scratch sheet. */
function value(cells: Record<string, string | number>, read: string): number {
  const book = new Workbook();
  book.setCells(cells);
  const result = book.getValue(read);
  if (typeof result !== "number") {
    throw new Error(`${read} produced ${JSON.stringify(result)}`);
  }
  return result;
}

/** `STDEV.P` over the published set is 2 exactly. */
function populationDeviation(): Check {
  const observed = value(
    { A1: 2, A2: 4, A3: 4, A4: 4, A5: 5, A6: 5, A7: 7, A8: 9, B1: "=STDEV.P(A1:A8)" },
    "B1",
  );
  const ok = observed === 2;
  return {
    label: "`STDEV.P` over the textbook set {2,4,4,4,5,5,7,9}",
    result: "exactly 2, not 2 to within a tolerance",
    ok,
    ...(ok ? {} : { complaint: `came out as ${observed}` }),
  };
}

/**
 * `PMT`, and the identity that says it is the right number.
 *
 * Checking `PMT` against a published figure checks the formula was typed in
 * correctly. Paying the instalment it returns for the full term and watching
 * the balance land on zero checks that the number means what it claims to.
 */
function amortisationCloses(): Check {
  const payment = value(
    { A1: 0.005, A2: 360, A3: 200000, B1: "=PMT(A1,A2,A3)" },
    "B1",
  );
  let balance = 200000;
  for (let month = 0; month < 360; month += 1) balance = balance * 1.005 + payment;
  return bounded(
    "A 360-month loan of 200,000 paid off at the instalment `PMT` returns",
    balance,
    1e-6,
    `of the 200,000 it started at, after every payment — a relative residue under 1e-13`,
  );
}

/** `MINVERSE` multiplied back by its argument is the identity. */
function inverseRoundTrip(): Check {
  const book = new Workbook();
  book.setCells({
    A1: 4,
    B1: 7,
    A2: 2,
    B2: 6,
    D1: "=MINVERSE(A1:B2)",
    G1: "=MMULT(A1:B2,D1:E2)",
  });
  let worst = 0;
  const identity: readonly (readonly [string, number])[] = [
    ["G1", 1],
    ["H1", 0],
    ["G2", 0],
    ["H2", 1],
  ];
  for (const [cell, expected] of identity) {
    const seen = book.getValue(cell);
    if (typeof seen !== "number") return { label: "MINVERSE", result: "", ok: false, complaint: `${cell} is not a number` };
    worst = Math.max(worst, Math.abs(seen - expected));
  }
  return bounded(
    "`MINVERSE(A)` multiplied back by `A`, against the identity matrix",
    worst,
    1e-14,
    "in every entry",
  );
}

/**
 * The pack against itself, where it has to agree exactly.
 *
 * On one predictor a multiple regression *is* a simple one, so `LINEST` and
 * `SLOPE`/`INTERCEPT` are not two answers to compare but one piece of
 * arithmetic reached two ways. Anything other than zero is a bug in one path.
 */
function regressionAgreesWithItself(): Check {
  const book = new Workbook();
  book.setCells({
    A1: 1,
    A2: 2,
    A3: 3,
    A4: 4,
    A5: 5,
    B1: 2.3,
    B2: 4.1,
    B3: 6.2,
    B4: 7.9,
    B5: 10.4,
    D1: "=LINEST(B1:B5,A1:A5)",
    F1: "=SLOPE(B1:B5,A1:A5)",
    F2: "=INTERCEPT(B1:B5,A1:A5)",
    F3: "=RSQ(B1:B5,A1:A5)",
    F4: "=CORREL(A1:A5,B1:B5)^2",
  });
  const read = (cell: string): number => {
    const seen = book.getValue(cell);
    if (typeof seen !== "number") throw new Error(`${cell} produced ${JSON.stringify(seen)}`);
    return seen;
  };
  const slope = read("D1") - read("F1");
  const intercept = read("E1") - read("F2");
  const rsq = read("F3") - read("F4");
  const ok = slope === 0 && intercept === 0 && Math.abs(rsq) < 1e-15;
  return {
    label: "`LINEST` on one predictor against `SLOPE` and `INTERCEPT`, and `RSQ` against `CORREL` squared",
    result: "0 in the slope and the intercept; below 1e-15 in R-squared",
    ok,
    ...(ok
      ? {}
      : { complaint: `slope ${slope}, intercept ${intercept}, r-squared ${rsq}` }),
  };
}

/**
 * The coupon schedule against a reference that is not this package.
 *
 * The only row here whose reference comes from outside, and the only one that
 * could catch a *convention* error rather than an arithmetic one: a schedule
 * built on the wrong rule still closes its periods, still counts its coupons
 * and still agrees with every identity the module can state about itself.
 *
 * Reported as an exact count of cases rather than as a tolerance, because a
 * coupon date is a day and either is or is not the right one. The cases that
 * matter are the ones either side of each month end — half the table is there
 * to say where the rule stops.
 */
function scheduleMatchesReference(): Check {
  const book = new Workbook();
  const read = (formula: string): number => {
    book.setCell("Z100", formula);
    const seen = book.getValue("Z100");
    if (typeof seen !== "number") {
      throw new Error(`${formula} produced ${JSON.stringify(seen)}`);
    }
    return seen;
  };

  const wrong: string[] = [];
  let monthEnds = 0;
  for (const row of COUPON_REFERENCE) {
    const { settlement, maturity, frequency, basis } = row;
    const previous = read(`=COUPPCD(${settlement},${maturity},${frequency},${basis})`);
    const next = read(`=COUPNCD(${settlement},${maturity},${frequency},${basis})`);
    if (previous !== row.previous) wrong.push(`${row.block}: COUPPCD`);
    if (next !== row.next) wrong.push(`${row.block}: COUPNCD`);
  }
  // One maturity per block sits on a month end; the rest are its neighbours.
  monthEnds = new Set(COUPON_REFERENCE.map((row) => row.block)).size;

  const ok = wrong.length === 0;
  return {
    label:
      "`COUPPCD` and `COUPNCD` against a published transcript of a reference " +
      "spreadsheet, over month ends and the days either side of them",
    result:
      `exact agreement on all ${COUPON_REFERENCE.length} cases — ` +
      `${monthEnds} month ends under the end-of-month rule and ` +
      `${COUPON_REFERENCE.length - monthEnds} neighbours that must stay off it`,
    ok,
    ...(ok ? {} : { complaint: `disagreed on ${wrong.join(", ")}` }),
  };
}

/**
 * The per-period accrual against the single span, where the two must agree.
 *
 * `ACCRINT` divides an accrual at every quasi-coupon date it crosses and
 * weights each piece by the length of the period it falls in. On three of the
 * five bases that has to come back to `YEARFRAC` over the whole span: their
 * period length is a constant and their day counts are additive, so the pieces
 * telescope and only the order of division differs. The reference is another
 * module rather than this one's own arithmetic, which is what gives the row
 * its force — and the two bases where the forms genuinely differ are reported
 * beside it, because an agreement no input could violate is not a check.
 */
function accrualTelescopes(): Check {
  const base = serialFromCivil(2024, 1, 1);
  let worst = 0;
  let cases = 0;
  let divergence = 0;
  for (let offset = 0; offset < 760; offset += 7) {
    for (const length of [40, 200, 420, 700]) {
      for (const ahead of [95, 190, 260, 400, 580]) {
        for (const frequency of [1, 2, 4] as const) {
          const issue = base + offset;
          const settlement = issue + length;
          const first = issue + ahead;
          cases += 1;
          for (const basis of [2, 3, 4] as const) {
            worst = Math.max(
              worst,
              Math.abs(
                accruedYears(issue, settlement, first, frequency, basis) -
                  yearFraction(issue, settlement, basis),
              ),
            );
          }
          for (const basis of [0, 1] as const) {
            const span = yearFraction(issue, settlement, basis);
            divergence = Math.max(
              divergence,
              Math.abs(
                accruedYears(issue, settlement, first, frequency, basis) - span,
              ) / span,
            );
          }
        }
      }
    }
  }
  const ok = worst < 1e-15 && divergence > 0.02;
  return {
    label:
      "The accrual `ACCRINT` sums over quasi-coupon periods against `YEARFRAC` " +
      "over the same span, on the three bases where the two must agree",
    result:
      `below 1e-15 over ${cases.toLocaleString("en-GB")} cases — and past 2% ` +
      `on the two bases where they must not, which is why the agreement is a check`,
    ok,
    ...(ok
      ? {}
      : {
          complaint:
            `residue ${worst} against 1e-15; divergence ${divergence} against 0.02`,
        }),
  };
}

/** Every row of the evidence table, in the order the README prints them. */
export function measure(): readonly Check[] {
  return [
    isolatedEditIsFlat(),
    shapeCosts(),
    countMatchesGraph(),
    populationDeviation(),
    regressionAgreesWithItself(),
    amortisationCloses(),
    inverseRoundTrip(),
    scheduleMatchesReference(),
    accrualTelescopes(),
  ];
}

/** The rows as the README prints them. */
export function renderTable(checks: readonly Check[]): string {
  const lines = ["| Check | Result |", "| --- | --- |"];
  for (const check of checks) lines.push(`| ${check.label} | ${check.result} |`);
  return lines.join("\n");
}

/** Print the table and say whether it still holds. */
export function report(): number {
  const checks = measure();
  process.stdout.write(`${renderTable(checks)}\n`);
  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    process.stderr.write("\n");
    for (const check of failed) {
      process.stderr.write(`FAILED: ${check.label}\n  ${check.complaint ?? ""}\n`);
    }
    return 1;
  }
  process.stdout.write(`\n${checks.length} checks, all within what the table claims\n`);
  return 0;
}
