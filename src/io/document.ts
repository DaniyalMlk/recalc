import { ScenarioSet } from "../analysis/scenarios.js";
import { ERROR_CODES, err, isFormulaError } from "../engine/errors.js";
import type { ErrorCode } from "../engine/errors.js";
import { parseA1 } from "../engine/reference.js";
import type { Value } from "../engine/value.js";
import { Workbook } from "../engine/workbook.js";

/**
 * A whole sheet, written down and read back.
 *
 * CSV was the only thing the engine could write, and CSV carries the *values*
 * of one rectangle. Everything that makes a sheet a model rather than a table
 * is lost by a round trip through it: the formulas, the number formats, the
 * defined names, and the scenarios. For an engine whose premise is that a
 * model is a graph of formulas, that is the wrong format to be the only one.
 *
 * So this writes inputs rather than values. A document is JSON, laid out for a
 * diff — keys in a fixed order, cells sorted by position — because a model
 * kept in a repository is read by people and merged by tools, and a format
 * whose byte order depends on the order cells were typed in is useless to
 * both.
 *
 * Four things besides the cells have to be carried, and each has a reason it
 * cannot be inferred on the way back in:
 *
 * - **Formats** belong to cells and not to contents, so they sit on empty
 *   cells too and cannot be recovered from the values.
 * - **Names** come in two kinds that need different representations. A name
 *   bound to a cell or a range keeps the text it was defined with. A name
 *   bound to a value cannot: its display target is `String(value)`, which
 *   cannot tell `true` from `"true"` and renders an error as
 *   `[object Object]`.
 * - **Scenarios** are the gap this closes. They are sets of overrides and CSV
 *   has nowhere to put them, so until now a sheet reopened from a file came
 *   back with its scenarios gone.
 * - **The version** so that a reader meeting a document from a later writer
 *   refuses it instead of guessing. A format that silently half-reads an
 *   unknown version is worse than one that cannot read it at all.
 *
 * Spilled cells are not written. A spilled block is a consequence of its
 * anchor's formula, and writing the filled cells as cells of their own would
 * produce a document that read back as a sheet full of literal values with a
 * spill underneath them.
 */

export const DOCUMENT_VERSION = 1;

/** A {@link Value} in the form JSON can carry. */
export type StoredValue =
  | number
  | string
  | boolean
  | null
  | { readonly error: ErrorCode; readonly detail?: string };

export type StoredName =
  | { readonly name: string; readonly kind: "value"; readonly value: StoredValue }
  | { readonly name: string; readonly kind: "reference"; readonly target: string };

export interface StoredFormat {
  readonly address: string;
  readonly code: string;
}

export interface StoredAssumption {
  readonly address: string;
  readonly input: string;
}

export interface StoredScenario {
  readonly name: string;
  readonly assumptions: readonly StoredAssumption[];
}

export interface RecalcDocument {
  /** The format version. {@link DOCUMENT_VERSION} is the one this reads. */
  readonly recalc: number;
  /** Every occupied cell, as the text that would be typed into it. */
  readonly cells: Readonly<Record<string, string>>;
  readonly formats: readonly StoredFormat[];
  readonly names: readonly StoredName[];
  readonly scenarios: readonly StoredScenario[];
}

/** A sheet and the scenarios over it: what a document is a document of. */
export interface Model {
  readonly book: Workbook;
  readonly scenarios: ScenarioSet;
}

/** Thrown when text or data cannot be read as a document. */
export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentError";
  }
}

const CODES = new Set<string>(ERROR_CODES);

function storeValue(value: Value): StoredValue {
  if (isFormulaError(value)) {
    return value.detail === undefined
      ? { error: value.code }
      : { error: value.code, detail: value.detail };
  }
  // A non-finite number has no JSON form: `JSON.stringify(NaN)` is `null`,
  // which would read back as a blank. The engine does not produce one in a
  // cell — arithmetic that would overflow is `#NUM!` — but a name can be
  // bound to any `Value` at all through the library, so it is refused here
  // rather than written as something it is not.
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new DocumentError(`${String(value)} cannot be written to a document`);
  }
  return value;
}

function loadValue(stored: unknown, where: string): Value {
  if (stored === null) return null;
  const type = typeof stored;
  if (type === "number") {
    if (!Number.isFinite(stored)) {
      throw new DocumentError(`${where}: ${String(stored)} is not a value`);
    }
    return stored as number;
  }
  if (type === "string" || type === "boolean") return stored as string | boolean;
  if (type === "object" && !Array.isArray(stored)) {
    const record = stored as Record<string, unknown>;
    const code = record["error"];
    if (typeof code !== "string" || !CODES.has(code)) {
      throw new DocumentError(`${where}: ${JSON.stringify(stored)} is not a value`);
    }
    const detail = record["detail"];
    if (detail !== undefined && typeof detail !== "string") {
      throw new DocumentError(`${where}: detail must be text`);
    }
    return err(code as ErrorCode, detail as string | undefined);
  }
  throw new DocumentError(`${where}: ${JSON.stringify(stored) ?? type} is not a value`);
}

/**
 * The document for a sheet, and the scenarios over it if there are any.
 *
 * Cells are sorted by row and then column rather than by the order they were
 * entered, so the same sheet always writes the same bytes.
 */
export function toDocument(
  book: Workbook,
  scenarios: ScenarioSet = new ScenarioSet(),
): RecalcDocument {
  const inputs = book.toInputMap();
  const addresses = Object.keys(inputs).sort((a, b) => {
    const left = parseA1(a);
    const right = parseA1(b);
    return left.row - right.row || left.col - right.col;
  });
  const cells: Record<string, string> = {};
  for (const address of addresses) cells[address] = inputs[address] as string;

  const names: StoredName[] = book.names().map((entry) =>
    entry.binding.kind === "value"
      ? {
          name: entry.name,
          kind: "value" as const,
          value: storeValue(entry.binding.value),
        }
      : { name: entry.name, kind: "reference" as const, target: entry.target },
  );

  return {
    recalc: DOCUMENT_VERSION,
    cells,
    formats: book.formatEntries(),
    names,
    scenarios: scenarios.list().map((scenario) => ({
      name: scenario.name,
      assumptions: scenario.assumptions.map(({ address, input }) => ({
        address,
        input,
      })),
    })),
  };
}

/** A document as text: JSON, two-space indented, newline-terminated. */
export function writeDocument(
  book: Workbook,
  scenarios?: ScenarioSet,
): string {
  return `${JSON.stringify(toDocument(book, scenarios), null, 2)}\n`;
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DocumentError(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, where: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new DocumentError(`${where} must be a list`);
  return value;
}

function asText(value: unknown, where: string): string {
  if (typeof value !== "string") throw new DocumentError(`${where} must be text`);
  return value;
}

/**
 * Build a sheet from a document.
 *
 * Names are defined before cells, so a formula using one is never evaluated
 * against a name that has not arrived yet. Formats come last because they
 * attach to positions and do not care what is in them.
 */
export function fromDocument(document: unknown): Model {
  const root = asRecord(document, "a document");
  const version = root["recalc"];
  if (typeof version !== "number") {
    throw new DocumentError("not a recalc document: no version");
  }
  if (!Number.isInteger(version)) {
    throw new DocumentError(`document version ${version} is not a version`);
  }
  if (version !== DOCUMENT_VERSION) {
    throw new DocumentError(
      `document version ${version}, and this reads version ${DOCUMENT_VERSION}`,
    );
  }

  const book = new Workbook();

  for (const [index, entry] of asArray(root["names"], "names").entries()) {
    const record = asRecord(entry, `names[${index}]`);
    const name = asText(record["name"], `names[${index}].name`);
    const kind = record["kind"];
    if (kind === "value") {
      book.setName(name, loadValue(record["value"], `names[${index}].value`));
    } else if (kind === "reference") {
      book.defineName(name, asText(record["target"], `names[${index}].target`));
    } else {
      throw new DocumentError(
        `names[${index}].kind must be "value" or "reference"`,
      );
    }
  }

  const cells = root["cells"];
  if (cells !== undefined) {
    const record = asRecord(cells, "cells");
    const entries: Record<string, string> = {};
    for (const [address, input] of Object.entries(record)) {
      entries[address] = asText(input, `cells.${address}`);
    }
    book.setCells(entries);
  }

  for (const [index, entry] of asArray(root["formats"], "formats").entries()) {
    const record = asRecord(entry, `formats[${index}]`);
    book.setFormat(
      asText(record["address"], `formats[${index}].address`),
      asText(record["code"], `formats[${index}].code`),
    );
  }

  const scenarios = new ScenarioSet();
  for (const [index, entry] of asArray(
    root["scenarios"],
    "scenarios",
  ).entries()) {
    const record = asRecord(entry, `scenarios[${index}]`);
    const name = asText(record["name"], `scenarios[${index}].name`);
    const assumptions = asArray(
      record["assumptions"],
      `scenarios[${index}].assumptions`,
    ).map((item, position) => {
      const assumption = asRecord(
        item,
        `scenarios[${index}].assumptions[${position}]`,
      );
      return [
        asText(
          assumption["address"],
          `scenarios[${index}].assumptions[${position}].address`,
        ),
        asText(
          assumption["input"],
          `scenarios[${index}].assumptions[${position}].input`,
        ),
      ] as const;
    });
    scenarios.define(name, assumptions);
  }

  // The history starts at the document, not at an empty sheet: undo should not
  // be able to walk back through the act of opening a file and leave the
  // reader looking at nothing.
  book.clearHistory();
  return { book, scenarios };
}

/** Read a document from text. */
export function readDocument(text: string): Model {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new DocumentError(
      `not a document: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return fromDocument(parsed);
}
