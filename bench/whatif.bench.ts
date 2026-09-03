import { goalSeek } from "../src/analysis/goalseek.js";
import { series, twoWayTable } from "../src/analysis/table.js";
import { Workbook } from "../src/engine/workbook.js";

/**
 * What what-if analysis actually costs.
 *
 * The claim being measured is the one that decides whether a sensitivity grid
 * is a feature or a progress bar: a trial recalculates what the substituted
 * input invalidated, not the sheet. So a table over a model with a long tail
 * of unrelated cells should cost roughly what the same table costs over the
 * model alone.
 *
 * Like the recalculation benchmark, this prints numbers rather than asserting
 * bounds. Timings on a shared machine are not something to fail a build over.
 *
 * Run with `npm run bench:whatif`.
 */

interface Row {
  readonly shape: string;
  readonly points: number;
  readonly total: number;
  readonly each: number;
}

function time(runs: number, body: () => void): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    body();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  return samples[samples.length >> 1] as number;
}

/**
 * A model of `depth` chained cells, plus `ballast` cells that nothing in the
 * model reads and that read nothing in it.
 *
 * The ballast is the point: it makes the sheet large without making the model
 * large, which is exactly the shape of a real workbook — a few hundred cells
 * of logic sitting in a sheet of tens of thousands.
 */
function model(depth: number, ballast: number): Workbook {
  const book = new Workbook();
  const cells: Record<string, string | number> = { A1: 10, A2: 3 };
  // A3 seeds the chain from both inputs, so both reach the result. Without it
  // A1 would be orphaned and the analysis would rightly refuse to run.
  cells["A3"] = "=A1+A2";
  for (let i = 4; i <= depth; i += 1) {
    cells[`A${i}`] = `=A${i - 1}*1.01+A2`;
  }
  cells["C1"] = `=A${depth}-500`;
  for (let i = 0; i < ballast; i += 1) {
    cells[`E${i + 1}`] = i;
    cells[`F${i + 1}`] = `=E${i + 1}*2`;
  }
  book.setCells(cells);
  book.clearHistory();
  return book;
}

function grid(depth: number, ballast: number, side: number): Row {
  const book = model(depth, ballast);
  const values = series(1, 20, side);

  const total = time(5, () => {
    twoWayTable(book, {
      rowInput: "A1",
      rowValues: values,
      columnInput: "A2",
      columnValues: values,
      result: "C1",
    });
  });

  const points = side * side;
  return {
    shape: `${side}x${side} over depth ${depth}, ${ballast * 2} idle cells`,
    points,
    total,
    each: total / points,
  };
}

function seek(depth: number, ballast: number): Row {
  const book = model(depth, ballast);
  let calls = 0;
  const total = time(10, () => {
    const result = goalSeek(book, { target: "C1", to: 0, changing: "A1" });
    calls = result.evaluations;
  });
  return {
    shape: `goal seek over depth ${depth}, ${ballast * 2} idle cells`,
    points: calls,
    total,
    each: total / Math.max(calls, 1),
  };
}

function ms(value: number): string {
  if (value >= 10) return value.toFixed(1);
  if (value >= 0.01) return value.toFixed(3);
  return value.toExponential(2);
}

function report(rows: readonly Row[]): void {
  const headers = ["shape", "recalcs", "total ms", "ms each"];
  const body = rows.map((row) => [
    row.shape,
    row.points.toLocaleString("en-US"),
    ms(row.total),
    ms(row.each),
  ]);

  const widths = headers.map((header, i) =>
    Math.max(header.length, ...body.map((row) => (row[i] as string).length)),
  );

  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, i) =>
        i === 0
          ? cell.padEnd(widths[i] as number)
          : cell.padStart(widths[i] as number),
      )
      .join("  ");

  process.stdout.write(`${line(headers)}\n`);
  process.stdout.write(`${widths.map((w) => "-".repeat(w)).join("  ")}\n`);
  for (const row of body) process.stdout.write(`${line(row)}\n`);
}

function main(): void {
  process.stdout.write("\nrecalc - what-if analysis cost\n\n");

  report([
    grid(50, 0, 10),
    grid(50, 5_000, 10),
    grid(50, 25_000, 10),
    grid(200, 0, 10),
    grid(200, 25_000, 10),
    grid(50, 25_000, 25),
    seek(50, 0),
    seek(50, 25_000),
    seek(200, 25_000),
  ]);

  process.stdout.write(
    "\nRows 1-3 are the claim under test: the same grid over the same model,\n" +
      "with 0, 10,000 and 50,000 unrelated cells sitting beside it. A trial\n" +
      "costs what the substituted input invalidated, so the three should be\n" +
      "close. Rows 4-5 show the cost tracking model depth, which it should.\n\n",
  );
}

main();
