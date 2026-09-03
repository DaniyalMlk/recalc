/**
 * Reading a table axis from one line of text.
 *
 * A sensitivity axis is nearly always described one of three ways, and asking
 * someone to type out eleven rates when they meant "5% to 15% in eleven steps"
 * is how a feature goes unused. The three forms are:
 *
 * - `20..40/5` — five points from 20 to 40 inclusive.
 * - `30~5/7` — seven points centred on 30, stepping by 5.
 * - `20, 25, hold, =B3*2` — exactly these, whatever they are.
 *
 * The list form deliberately accepts anything a cell accepts, so a scenario
 * switch spelled `grow` sits in an axis next to a rate without ceremony. That
 * is also why the two generated forms are recognised by shape rather than by a
 * keyword: `..` and `~` cannot begin a number, so there is no ambiguity to
 * resolve and no escape hatch to document.
 */

import { TableError, around, series } from "./table.js";

const RANGE = /^(-?[0-9.eE+-]+)\.\.(-?[0-9.eE+-]+)\/([0-9]+)$/;
const CENTRED = /^(-?[0-9.eE+-]+)~(-?[0-9.eE+-]+)\/([0-9]+)$/;

function number(text: string, what: string): number {
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new TableError(`${what} is not a number: ${text}`);
  }
  return value;
}

function count(text: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1) {
    throw new TableError(`a step count must be a positive whole number`);
  }
  return value;
}

/**
 * Turn axis text into the values to substitute.
 *
 * Entries in a list are trimmed, and an entry that reads as a number becomes
 * one so a table over `20, 25` produces numeric results rather than text that
 * happens to add up.
 */
export function parseAxis(text: string): (string | number)[] {
  const trimmed = text.trim();
  if (trimmed === "") throw new TableError("an axis needs some values");

  const range = RANGE.exec(trimmed);
  if (range !== null) {
    return series(
      number(range[1]!, "the start"),
      number(range[2]!, "the end"),
      count(range[3]!),
    );
  }

  const centred = CENTRED.exec(trimmed);
  if (centred !== null) {
    return around(
      number(centred[1]!, "the centre"),
      number(centred[2]!, "the step"),
      count(centred[3]!),
    );
  }

  const parts = trimmed.split(",").map((part) => part.trim());
  if (parts.some((part) => part === "")) {
    throw new TableError(`empty value in the list: ${trimmed}`);
  }
  return parts.map((part) => {
    const value = Number(part);
    return part !== "" && Number.isFinite(value) ? value : part;
  });
}
