import { Workbook } from "../src/engine/workbook.js";

/**
 * Measurements for the recalculation path.
 *
 * This is a script, not a test: it prints numbers for a human to read rather
 * than asserting bounds, because timings on a shared machine are not something
 * to fail a build over. What it is for is answering one question honestly —
 * does an edit cost what depends on it, or does it cost the size of the sheet?
 * The whole design of the graph is a bet on the first, and a bet is worth
 * measuring.
 *
 * Run with `npm run bench`.
 */

interface Row {
  readonly shape: string;
  readonly cells: number;
  readonly build: number;
  readonly edit: number;
  readonly touched: number;
}

/** Median of several runs, which is far steadier than a mean on a shared box. */
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

function address(row: number, col = 0): string {
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

/** Each cell reads the one above it: the deepest graph for a given size. */
function chain(length: number): Row {
  let book = new Workbook();

  const build = time(5, () => {
    book = new Workbook();
    const cells: Record<string, string | number> = { A1: 1 };
    for (let i = 1; i < length; i += 1) {
      cells[address(i)] = `=${address(i - 1)}+1`;
    }
    book.setCells(cells);
  });

  // Editing the head invalidates the entire chain: the worst case.
  let flip = 0;
  const edit = time(20, () => {
    flip = flip === 0 ? 1 : 0;
    book.setCell("A1", flip);
  });

  return {
    shape: `chain of ${length}`,
    cells: length,
    build,
    edit,
    touched: book.dependentsOf("A1").length === 0 ? 0 : length,
  };
}

/** One cell read by many, none of which read each other. */
function fanOut(width: number): Row {
  let book = new Workbook();

  const build = time(5, () => {
    book = new Workbook();
    const cells: Record<string, string | number> = { A1: 2 };
    for (let i = 0; i < width; i += 1) cells[`B${i + 1}`] = `=A1*${i + 1}`;
    book.setCells(cells);
  });

  let flip = 0;
  const edit = time(20, () => {
    flip = flip === 0 ? 2 : 3;
    book.setCell("A1", flip);
  });

  return {
    shape: `fan-out to ${width}`,
    cells: width + 1,
    build,
    edit,
    touched: book.dependentsOf("A1").length,
  };
}

/**
 * A large sheet where the edited cell has nothing downstream of it.
 *
 * This is the measurement that matters. If the engine is doing what it claims,
 * this stays flat as the sheet grows, because the work is bounded by the
 * dependents of the edit and there are none.
 */
function isolatedEdit(size: number): Row {
  const book = new Workbook();
  const build = time(3, () => {
    const cells: Record<string, string | number> = {};
    for (let i = 0; i < size; i += 1) {
      cells[`A${i + 1}`] = i;
      cells[`B${i + 1}`] = `=A${i + 1}*2`;
    }
    book.setCells(cells);
  });

  // Row `size + 1` is empty and unreferenced, so nothing depends on it.
  const target = `D${size + 1}`;
  let flip = 0;
  const edit = time(50, () => {
    flip += 1;
    book.setCell(target, flip);
  });

  return {
    shape: `isolated edit in ${size * 2} cells`,
    cells: book.cellCount,
    build,
    edit,
    touched: book.dependentsOf(target).length,
  };
}

/** One aggregate over a long range: the case ranges exist to make cheap. */
function rangeAggregate(size: number): Row {
  const book = new Workbook();
  const build = time(3, () => {
    const cells: Record<string, string | number> = {};
    for (let i = 0; i < size; i += 1) cells[`A${i + 1}`] = i;
    cells[`C1`] = `=SUM(A1:A${size})`;
    cells[`C2`] = `=AVERAGE(A1:A${size})`;
    cells[`C3`] = `=MAX(A1:A${size})`;
    book.setCells(cells);
  });

  let flip = 0;
  const edit = time(20, () => {
    flip += 1;
    book.setCell(`A${size >> 1}`, flip);
  });

  return {
    shape: `3 aggregates over ${size}`,
    cells: book.cellCount,
    build,
    edit,
    touched: book.dependentsOf(`A${size >> 1}`).length,
  };
}

/** A named range over the same data, to price the extra indirection. */
function namedAggregate(size: number): Row {
  const book = new Workbook();
  const build = time(3, () => {
    const cells: Record<string, string | number> = {};
    for (let i = 0; i < size; i += 1) cells[`A${i + 1}`] = i;
    book.setCells(cells);
    book.defineName("Data", `A1:A${size}`);
    book.setCells({
      C1: "=SUM(Data)",
      C2: "=AVERAGE(Data)",
      C3: "=MAX(Data)",
    });
  });

  let flip = 0;
  const edit = time(20, () => {
    flip += 1;
    book.setCell(`A${size >> 1}`, flip);
  });

  return {
    shape: `3 named aggregates over ${size}`,
    cells: book.cellCount,
    build,
    edit,
    touched: book.dependentsOf(`A${size >> 1}`).length,
  };
}

function ms(value: number): string {
  return value >= 10 ? value.toFixed(1) : value.toFixed(3);
}

function report(rows: readonly Row[]): void {
  const headers = ["shape", "cells", "build ms", "edit ms", "recalculated"];
  const body = rows.map((row) => [
    row.shape,
    row.cells.toLocaleString("en-US"),
    ms(row.build),
    ms(row.edit),
    row.touched.toLocaleString("en-US"),
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
  process.stdout.write("\nrecalc - recalculation cost\n\n");

  report([
    chain(100),
    chain(1_000),
    chain(5_000),
    fanOut(100),
    fanOut(1_000),
    fanOut(5_000),
    rangeAggregate(1_000),
    rangeAggregate(10_000),
    namedAggregate(10_000),
    isolatedEdit(1_000),
    isolatedEdit(10_000),
    isolatedEdit(50_000),
  ]);

  process.stdout.write(
    "\nThe last three rows are the claim under test: an edit with no dependents\n" +
      "should cost the same in a 2,000-cell sheet as in a 100,000-cell one.\n\n",
  );
}

main();
