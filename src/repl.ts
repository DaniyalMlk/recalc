import { Workbook, interpretInput } from "./engine/workbook.js";
import type { Clipboard } from "./engine/workbook.js";
import {
  MAX_ROWS,
  formatA1,
  ReferenceError_,
  formatRange,
  iterateRange,
  labelToColumn,
  parseA1,
  parseA1Range,
} from "./engine/reference.js";
import { StructureError } from "./engine/structure.js";
import type { Axis, StructuralOperation } from "./engine/structure.js";
import { registeredFunctionNames, lookupFunction } from "./functions/index.js";
import { formatValue } from "./engine/value.js";
import { NameError, parseTarget } from "./engine/names.js";
import { exportCsv, importCsv } from "./io/csv.js";

// Written as an escape sequence so the source stays plain text.
const ESC = "\u001b[";
const DIM = `${ESC}2m`;
const BOLD = `${ESC}1m`;
const RED = `${ESC}31m`;
const CYAN = `${ESC}36m`;
const RESET = `${ESC}0m`;

const useColour = process.stdout.isTTY === true;
export const paint = (code: string, text: string) =>
  useColour ? `${code}${text}${RESET}` : text;

const ASSIGNMENT = /^(\$?[A-Za-z]{1,3}\$?[0-9]{1,7})\s*=\s*(.*)$/;
const ADDRESS = /^\$?[A-Za-z]{1,3}\$?[0-9]{1,7}$/;

export const HELP = `
  ${paint(BOLD, "Entering data")}
    A1 = 42                 store a number
    A1 = hello              store text
    B1 = =SUM(A1:A9)        store a formula (note the second =)
    A1                      show a cell's value and formula

  ${paint(BOLD, "Inspecting")}
    .list                   every non-empty cell
    .show A1:C9             a rectangular block
    .prec A1                what A1 reads
    .deps A1                what reads A1
    .plan A1                recalculation order if A1 changed
    .cycles                 circular references in the sheet

  ${paint(BOLD, "Other")}
    .fns [prefix]           registered functions
    .help FN                one function's signature
    .demo                   load a small discounted cash flow model
    .clear A1               empty a cell, or .clear A1:C9 a block
    .reset                  start an empty sheet
    .quit

  ${paint(BOLD, "Names")}
    .name Revenue = B2:B13  name a cell or a range
    .name Rate = 0.11       name a constant
    .names                  every defined name
    .unname Revenue         remove a name

  ${paint(BOLD, "Blocks")}
    .filldown B1:B9         copy the first row of the block down
    .fillright B2:F2        copy the first column of the block across
    .copy A1:C3             take a copy of a block
    .paste D5               paste it, with references translated
    .undo / .redo           step back and forward through the edits

  ${paint(BOLD, "Rows and columns")}
    .insertrow 3 [n]        open n blank rows above row 3
    .deleterow 3 [n]        remove n rows from row 3 down
    .insertcol C [n]        open n blank columns left of column C
    .deletecol C [n]        remove n columns from column C right

  ${paint(BOLD, "CSV")}
    .csv [formulas]         print the sheet as CSV
    .import data.csv [A1]   read a CSV file into the sheet
    .export out.csv [formulas]
                            write the sheet to a CSV file
`;

/**
 * File access, injected rather than imported.
 *
 * `handle` is deliberately free of I/O so tests can drive it directly, and
 * reaching for `node:fs` here would end that. The shell passes the real thing
 * in; a test passes an in-memory pair; anything else gets a clear refusal
 * instead of a crash.
 */
export interface FileAccess {
  read(path: string): string;
  write(path: string, text: string): void;
}

const DEMO: Record<string, string | number> = {
  A1: "Discount rate",
  B1: 0.09,
  A2: "Year",
  B2: 0,
  C2: 1,
  D2: 2,
  E2: 3,
  F2: 4,
  A3: "Free cash flow",
  B3: -250000,
  C3: 60000,
  D3: 85000,
  E3: 110000,
  F3: 140000,
  A4: "Cumulative",
  C4: "=B3+C3",
  D4: "=C4+D3",
  E4: "=D4+E3",
  F4: "=E4+F3",
  A6: "NPV",
  B6: "=B3+NPV(B1,C3:F3)",
  A7: "IRR",
  B7: "=IRR(B3:F3)",
  A8: "Profitability index",
  B8: "=NPV(B1,C3:F3)/-B3",
  A9: "Years to payback",
  B9: "=MATCH(0,C4:F4,1)+1",
  A10: "Verdict",
  B10: '=IF(B6>0,"accept","reject")',
};

function loadDemo(book: Workbook): void {
  book.setCells(DEMO);
}

function describeCell(book: Workbook, address: string): string {
  const formula = book.getFormula(address);
  const value = book.getValue(address);
  const rendered = formatValue(value);
  const shown = rendered === "" ? paint(DIM, "(blank)") : rendered;
  const detail =
    typeof value === "object" && value !== null && "detail" in value
      ? paint(DIM, `  ${value.detail ?? ""}`)
      : "";
  const source = formula === null ? "" : paint(DIM, `   ${formula}`);
  return `  ${paint(CYAN, address)}  ${shown}${source}${detail}`;
}

function listCells(book: Workbook): string[] {
  const extent = book.extent();
  if (extent === null) return [paint(DIM, "  (empty sheet)")];
  const lines: string[] = [];
  for (const coord of iterateRange(extent)) {
    const address = formatA1({
      ...coord,
      colAbsolute: false,
      rowAbsolute: false,
    });
    if (book.has(address)) lines.push(describeCell(book, address));
  }
  return lines;
}

/**
 * A shell session over one workbook.
 *
 * The command handling is kept separate from the readline loop so it can be
 * driven directly by tests: `handle` takes a line and returns what would have
 * been printed, with no I/O of its own.
 */
export class ReplSession {
  private book = new Workbook();

  /**
   * The copied block, if there is one.
   *
   * It belongs to the session rather than the workbook: a clipboard outlives
   * the sheet it was taken from, which is the whole reason it stores text.
   */
  private clipboard: Clipboard | null = null;

  /** Signals that the caller should exit; `handle` never exits by itself. */
  static readonly QUIT = Symbol("quit");

  constructor(private readonly files: FileAccess | null = null) {}

  get workbook(): Workbook {
    return this.book;
  }

  handle(line: string): string | typeof ReplSession.QUIT | null {
    return handle(
      line,
      this.book,
      () => {
        this.book = new Workbook();
        this.clipboard = null;
      },
      this.files,
      {
        get: () => this.clipboard,
        set: (clipboard) => {
          this.clipboard = clipboard;
        },
      },
    );
  }
}

/** The session's clipboard slot, handed to the command handler. */
export interface ClipboardSlot {
  get(): Clipboard | null;
  set(clipboard: Clipboard): void;
}

const STRUCTURAL_COMMANDS: readonly [string, Axis, StructuralOperation][] = [
  [".insertrow", "row", "insert"],
  [".deleterow", "row", "delete"],
  [".insertcol", "column", "insert"],
  [".deletecol", "column", "delete"],
];

/**
 * Read the line a structural command names.
 *
 * Rows are given the way they are shown, one-based, and columns by their
 * letter — `.deletecol C` and not `.deletecol 2`. The engine indexes from zero,
 * so the conversion happens here rather than leaking a second numbering into
 * what the user types.
 */
function parseLineIndex(axis: Axis, text: string): number | null {
  if (axis === "column") {
    try {
      return labelToColumn(text);
    } catch {
      return null;
    }
  }
  if (!/^[0-9]{1,7}$/.test(text)) return null;
  const row = Number(text);
  if (row < 1 || row > MAX_ROWS) return null;
  return row - 1;
}

function structuralEdit(
  book: Workbook,
  tail: string,
  axis: Axis,
  operation: StructuralOperation,
): string {
  const usageAt = axis === "row" ? "3" : "C";
  const command = `.${operation}${axis === "row" ? "row" : "col"}`;
  const [where, howMany] = splitArgs(tail);
  if (where === undefined) {
    return paint(RED, `  usage: ${command} ${usageAt} [n]`);
  }

  const at = parseLineIndex(axis, where);
  if (at === null) {
    return paint(RED, `  ${where} is not a ${axis}`);
  }

  const count = howMany === undefined ? 1 : Number(howMany);
  if (!Number.isInteger(count) || count < 1) {
    return paint(RED, `  count must be a positive whole number: ${howMany}`);
  }

  try {
    book.applyStructuralEdit({ axis, operation, at, count });
  } catch (error) {
    if (error instanceof StructureError) return paint(RED, `  ${error.message}`);
    throw error;
  }

  const noun = `${axis}${count === 1 ? "" : "s"}`;
  const label = axis === "row" ? String(at + 1) : where.toUpperCase();
  return operation === "insert"
    ? `  ${count} ${noun} inserted at ${label}`
    : `  ${count} ${noun} deleted from ${label}`;
}

/**
 * Read a block argument, accepting a single address as a one-cell block.
 *
 * Returns null rather than throwing so the caller can answer with a message
 * instead of a stack trace: a mistyped address is a normal thing to do at a
 * prompt, not a programmer error.
 */
function readBlock(text: string) {
  try {
    return parseA1Range(text);
  } catch (error) {
    if (error instanceof ReferenceError_) return null;
    throw error;
  }
}

/** Split a command tail into its whitespace-separated arguments. */
function splitArgs(tail: string): (string | undefined)[] {
  return tail.trim().split(/\s+/).filter((part) => part !== "");
}

function handle(
  line: string,
  book: Workbook,
  reset: () => void,
  files: FileAccess | null = null,
  clipboard: ClipboardSlot | null = null,
): string | typeof ReplSession.QUIT | null {
  if (line === ".quit" || line === ".exit") {
    return ReplSession.QUIT;
  }

  if (line === ".help") return HELP;

  if (line.startsWith(".help ")) {
    const name = line.slice(6).trim().toUpperCase();
    const def = lookupFunction(name);
    if (def === undefined) return paint(RED, `  no function named ${name}`);
    const max = def.maxArgs === Infinity ? "..." : String(def.maxArgs);
    return `  ${paint(CYAN, def.name)}  ${def.minArgs}-${max} args\n  ${def.description}`;
  }

  if (line === ".reset") {
    reset();
    return "  new sheet";
  }

  if (line === ".demo") {
    loadDemo(book);
    return listCells(book).join("\n");
  }

  if (line === ".list") return listCells(book).join("\n");

  if (line === ".cycles") {
    const cycles = book.cycles();
    if (cycles.length === 0) return paint(DIM, "  no circular references");
    return cycles.map((cycle) => `  ${cycle.join(" -> ")}`).join("\n");
  }

  if (line.startsWith(".fns")) {
    const prefix = line.slice(4).trim().toUpperCase();
    const names = registeredFunctionNames().filter((name) =>
      name.startsWith(prefix),
    );
    if (names.length === 0) return paint(DIM, "  none");
    return `  ${names.join("  ")}\n  ${paint(DIM, `${names.length} function(s)`)}`;
  }

  if (line.startsWith(".show ")) {
    const [from, to] = line.slice(6).trim().split(":");
    if (from === undefined || to === undefined) {
      return paint(RED, "  usage: .show A1:C9");
    }
    const range = { start: parseA1(from), end: parseA1(to) };
    const lines: string[] = [];
    for (const coord of iterateRange(range)) {
      const address = formatA1({
        ...coord,
        colAbsolute: false,
        rowAbsolute: false,
      });
      if (book.has(address)) lines.push(describeCell(book, address));
    }
    return lines.length === 0 ? paint(DIM, "  (empty)") : lines.join("\n");
  }

  for (const [command, action] of [
    [".prec ", (address: string) => book.precedentsOf(address)],
    [".deps ", (address: string) => book.dependentsOf(address)],
  ] as const) {
    if (line.startsWith(command)) {
      const address = line.slice(command.length).trim();
      const result = action(address);
      return result.length === 0
        ? paint(DIM, "  none")
        : `  ${result.join("  ")}`;
    }
  }

  if (line.startsWith(".plan ")) {
    const address = line.slice(6).trim();
    const order = book.recalculationOrder(address);
    return order.length <= 1
      ? `  ${address}` + paint(DIM, "  (nothing else would change)")
      : `  ${order.join(" -> ")}`;
  }

  if (line.startsWith(".clear ")) {
    const target = line.slice(7).trim();
    const range = readBlock(target);
    if (range === null) return paint(RED, `  ${target} is not a cell or block`);
    book.clearBlock(range);
    return `  cleared ${formatRange(range)}`;
  }

  if (line === ".undo" || line === ".redo") {
    const label = line === ".undo" ? book.undoLabel : book.redoLabel;
    const done = line === ".undo" ? book.undo() : book.redo();
    if (!done) {
      return paint(DIM, `  nothing to ${line === ".undo" ? "undo" : "redo"}`);
    }
    return `  ${line === ".undo" ? "undid" : "redid"} ${label ?? "the last edit"}`;
  }

  for (const [command, fill] of [
    [".filldown", (block: string) => book.fillDown(block)],
    [".fillright", (block: string) => book.fillRight(block)],
  ] as const) {
    if (line !== command && !line.startsWith(`${command} `)) continue;
    const target = line.slice(command.length).trim();
    if (target === "") return paint(RED, `  usage: ${command} B1:B9`);
    const range = readBlock(target);
    if (range === null) return paint(RED, `  ${target} is not a block`);
    fill(formatRange(range));
    return `  filled ${formatRange(range)}`;
  }

  if (line === ".copy" || line.startsWith(".copy ")) {
    if (clipboard === null) return paint(RED, "  no clipboard in this session");
    const target = line.slice(5).trim();
    if (target === "") return paint(RED, "  usage: .copy A1:C3");
    const range = readBlock(target);
    if (range === null) return paint(RED, `  ${target} is not a block`);
    const copied = book.copy(range);
    clipboard.set(copied);
    return `  copied ${copied.width}x${copied.height} from ${formatRange(range)}`;
  }

  if (line === ".paste" || line.startsWith(".paste ")) {
    if (clipboard === null) return paint(RED, "  no clipboard in this session");
    const held = clipboard.get();
    if (held === null) return paint(DIM, "  nothing copied yet");
    const target = line.slice(6).trim();
    if (!ADDRESS.test(target)) return paint(RED, "  usage: .paste D5");
    book.paste(held, target);
    return `  pasted ${held.width}x${held.height} at ${target.toUpperCase()}`;
  }

  if (line === ".names") {
    const names = book.names();
    if (names.length === 0) return paint(DIM, "  no names defined");
    const width = Math.max(...names.map((entry) => entry.name.length));
    return names
      .map(
        (entry) =>
          `  ${paint(CYAN, entry.name.padEnd(width))}  ${entry.target}` +
          paint(DIM, `  (${entry.binding.kind})`),
      )
      .join("\n");
  }

  if (line.startsWith(".name ")) {
    const equals = line.indexOf("=", 6);
    if (equals < 0) return paint(RED, "  usage: .name Revenue = B2:B13");
    const name = line.slice(6, equals).trim();
    const target = line.slice(equals + 1).trim();

    try {
      // A target that reads as a reference becomes one; anything else is
      // stored as the constant it looks like, using the same rules a cell uses.
      if (parseTarget(target) !== null) {
        book.defineName(name, target);
      } else {
        book.setName(name, interpretInput(target).literal);
      }
    } catch (error) {
      if (error instanceof NameError) return paint(RED, `  ${error.message}`);
      throw error;
    }

    const binding = book.lookupName(name);
    return `  ${name.toUpperCase()} = ${target}` + paint(DIM, `  (${binding?.kind})`);
  }

  if (line.startsWith(".unname ")) {
    const name = line.slice(8).trim();
    return book.deleteName(name)
      ? `  removed ${name.toUpperCase()}`
      : paint(RED, `  no name called ${name}`);
  }

  for (const [command, axis, operation] of STRUCTURAL_COMMANDS) {
    if (line !== command && !line.startsWith(`${command} `)) continue;
    return structuralEdit(book, line.slice(command.length), axis, operation);
  }

  if (line === ".csv" || line.startsWith(".csv ")) {
    const mode = line.slice(4).trim() === "formulas" ? "formulas" : "values";
    const text = exportCsv(book, { mode, newline: "\n" });
    return text === "" ? paint(DIM, "  (empty sheet)") : text;
  }

  if (line.startsWith(".import ")) {
    if (files === null) return paint(RED, "  no file access in this session");
    const [path, origin] = splitArgs(line.slice(8));
    if (path === undefined) return paint(RED, "  usage: .import data.csv [A1]");
    const result = importCsv(book, files.read(path), {
      ...(origin === undefined ? {} : { origin }),
    });
    return result.range === null
      ? paint(DIM, "  nothing to import")
      : `  ${result.cells} cell(s) into ${formatRange(result.range)}`;
  }

  if (line.startsWith(".export ")) {
    if (files === null) return paint(RED, "  no file access in this session");
    const [path, mode] = splitArgs(line.slice(8));
    if (path === undefined) {
      return paint(RED, "  usage: .export out.csv [formulas]");
    }
    const text = exportCsv(book, {
      mode: mode === "formulas" ? "formulas" : "values",
    });
    files.write(path, text);
    return `  ${book.cellCount} cell(s) to ${path}`;
  }

  if (line.startsWith(".")) {
    return paint(RED, `  unknown command: ${line.split(" ")[0]}`);
  }

  const assignment = ASSIGNMENT.exec(line);
  if (assignment !== null) {
    const address = assignment[1]!;
    book.setCell(address, assignment[2]!);
    return describeCell(book, address);
  }

  if (ADDRESS.test(line)) {
    return describeCell(book, line);
  }

  return paint(RED, "  not understood - try .help");
}
