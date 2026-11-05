import { describe, expect, it } from "vitest";
import { Workbook } from "../src/engine/workbook.js";
import {
  DocumentError,
  fromDocument,
  readDocument,
  writeDocument,
} from "../src/io/document.js";

/**
 * What a reader refuses, and what it says.
 *
 * A file format is a promise to a stranger, so the interesting half of one is
 * what it does with data it did not write. The rule here is that a document is
 * either read as itself or refused by name: there is no repairing, no
 * defaulting of a field that was present but wrong, and no partial sheet left
 * behind for the caller to discover later.
 *
 * The version is the sharpest case. A reader that meets a document from a
 * later writer and reads the fields it recognises produces a sheet that is
 * quietly missing whatever the newer version added, which is worse than no
 * sheet at all because nothing says so.
 */

describe("a document reader refuses what it cannot read", () => {
  const refuses = (document: unknown, message: RegExp): void => {
    expect(() => fromDocument(document)).toThrow(DocumentError);
    expect(() => fromDocument(document)).toThrow(message);
  };

  it("refuses anything that is not an object", () => {
    for (const value of [7, "x", null, true, [], [{ recalc: 1 }]]) {
      refuses(value, /must be an object/);
    }
  });

  it("refuses a document with no version, and one from a later writer", () => {
    refuses({ cells: {} }, /not a recalc document: no version/);
    refuses({ recalc: "1", cells: {} }, /no version/);
    refuses({ recalc: 2, cells: {} }, /document version 2, and this reads version 1/);
    refuses({ recalc: 0, cells: {} }, /document version 0, and this reads version 1/);
    refuses({ recalc: 0.5, cells: {} }, /document version 0.5 is not a version/);
  });

  it("refuses cells that are not text", () => {
    refuses({ recalc: 1, cells: [] }, /cells must be an object/);
    refuses({ recalc: 1, cells: { A1: 5 } }, /cells\.A1 must be text/);
    refuses({ recalc: 1, cells: { A1: null } }, /cells\.A1 must be text/);
  });

  it("refuses a name that does not say which kind it is", () => {
    refuses({ recalc: 1, cells: {}, names: {} }, /names must be a list/);
    refuses(
      { recalc: 1, cells: {}, names: [{ name: "X", value: 1 }] },
      /names\[0\]\.kind must be "value" or "reference"/,
    );
    refuses(
      { recalc: 1, cells: {}, names: [{ name: "X", kind: "ref", target: "A1" }] },
      /names\[0\]\.kind/,
    );
    refuses(
      { recalc: 1, cells: {}, names: [{ kind: "value", value: 1 }] },
      /names\[0\]\.name must be text/,
    );
    refuses(
      { recalc: 1, cells: {}, names: [{ name: "X", kind: "reference", target: 3 }] },
      /names\[0\]\.target must be text/,
    );
  });

  it("refuses a stored value that is not one", () => {
    const name = (value: unknown): unknown => ({
      recalc: 1,
      cells: {},
      names: [{ name: "X", kind: "value", value }],
    });
    refuses(name([]), /names\[0\]\.value: \[\] is not a value/);
    refuses(name({}), /names\[0\]\.value: \{\} is not a value/);
    refuses(name({ error: "#NOPE!" }), /is not a value/);
    refuses(
      name({ error: "#N/A", detail: 7 }),
      /names\[0\]\.value\.detail must be text/,
    );
    // A finite number, text, a boolean and a blank are all values, so these
    // are the cases the refusals must not catch.
    for (const value of [0, -1.5, "", "text", true, false, null]) {
      expect(() => fromDocument(name(value))).not.toThrow();
    }
  });

  it("refuses a malformed format or scenario by position", () => {
    refuses(
      { recalc: 1, cells: {}, formats: [{ address: "A1" }] },
      /formats\[0\]\.code must be text/,
    );
    refuses(
      { recalc: 1, cells: {}, formats: [{ code: "0.00" }] },
      /formats\[0\]\.address must be text/,
    );
    refuses(
      {
        recalc: 1,
        cells: {},
        scenarios: [{ name: "S", assumptions: [{ address: "A1" }] }],
      },
      /scenarios\[0\]\.assumptions\[0\]\.input must be text/,
    );
    refuses(
      { recalc: 1, cells: {}, scenarios: [{ assumptions: [] }] },
      /scenarios\[0\]\.name must be text/,
    );
    // The index is the one in the document, so a later entry is reported at
    // its own position rather than at the first.
    refuses(
      {
        recalc: 1,
        cells: {},
        formats: [
          { address: "A1", code: "0" },
          { address: "A2", code: "0" },
          { address: "A3", code: 0 },
        ],
      },
      /formats\[2\]\.code must be text/,
    );
  });

  it("refuses text that is not JSON, and says where", () => {
    expect(() => readDocument("{nope")).toThrow(DocumentError);
    expect(() => readDocument("{nope")).toThrow(/not a document/);
    expect(() => readDocument("")).toThrow(DocumentError);
  });

  it("refuses to write a value JSON cannot carry", () => {
    // `JSON.stringify(NaN)` is `null`, which would read back as a blank, so a
    // name bound to one is refused at write time rather than written as
    // something it is not. The engine does not produce a non-finite number in
    // a cell — arithmetic that would overflow is `#NUM!` — but the library
    // lets a name be bound to any value at all.
    const book = new Workbook();
    book.setName("WRONG", Number.NaN);
    expect(() => writeDocument(book)).toThrow(DocumentError);
    expect(() => writeDocument(book)).toThrow(/NaN cannot be written/);
    book.setName("WRONG", Number.POSITIVE_INFINITY);
    expect(() => writeDocument(book)).toThrow(/Infinity cannot be written/);
    book.setName("WRONG", 1);
    expect(() => writeDocument(book)).not.toThrow();
    // And a non-finite number arriving in a document is refused on the way in
    // too, which it has to be separately: JSON has no literal for one, but a
    // caller can hand `fromDocument` the object directly.
    expect(() =>
      fromDocument({
        recalc: 1,
        cells: {},
        names: [{ name: "X", kind: "value", value: Number.NaN }],
      }),
    ).toThrow(/names\[0\]\.value: NaN is not a value/);
  });

  it("accepts a document carrying only cells", () => {
    // Everything but the version and the cells is optional on the way in, so a
    // document written by hand is a version and a map of cells.
    const read = fromDocument({ recalc: 1, cells: { A1: "=1+1" } });
    expect(read.book.getValue("A1")).toBe(2);
    expect(read.scenarios.size).toBe(0);
    expect(read.book.formatEntries()).toEqual([]);
    const empty = fromDocument({ recalc: 1 });
    expect(empty.book.extent()).toBeNull();
    expect(writeDocument(empty.book)).toBe(
      '{\n  "recalc": 1,\n  "cells": {},\n  "formats": [],\n  "names": [],\n  "scenarios": []\n}\n',
    );
  });

  it("leaves nothing behind when it refuses", () => {
    // A reader that built the sheet as it went and threw partway would hand
    // back nothing, but the sheet it had half-built is not observable: the
    // only way to see one is to be given it. So the guarantee is simply that
    // the call produces no model, and the test is that the error is thrown
    // rather than a model with a missing half returned.
    const partial = {
      recalc: 1,
      cells: { A1: "1", B1: "2" },
      names: [{ name: "GOOD", kind: "reference", target: "A1" }],
      formats: [{ address: "A1", code: 0 }],
    };
    expect(() => fromDocument(partial)).toThrow(/formats\[0\]\.code/);
    const fixed = { ...partial, formats: [{ address: "A1", code: "0" }] };
    const read = fromDocument(fixed);
    expect(read.book.getValue("A1")).toBe(1);
    expect(read.book.lookupName("GOOD")).toEqual({
      kind: "cell",
      ref: { col: 0, row: 0, colAbsolute: false, rowAbsolute: false },
    });
  });
});
