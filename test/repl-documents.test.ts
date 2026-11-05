import { describe, expect, it } from "vitest";
import { ReplSession } from "../src/repl.js";

/**
 * `.save` and `.open` at the prompt.
 *
 * The library round trip is tested in `document.test.ts`; what is tested here
 * is that the shell is where the feature actually becomes usable, and the two
 * things a shell can get wrong that a library cannot. One is that `.open` has
 * to replace the session rather than read into it — a document is a whole
 * sheet, and merging one into the sheet already open leaves the previous
 * model's cells wherever the new one has nothing. The other is that the
 * scenarios have to go with it, which is the whole reason the format exists.
 */

/** A session with an in-memory filesystem, plus the files it wrote. */
function withFiles(seed: Record<string, string> = {}): {
  session: ReplSession;
  files: Map<string, string>;
} {
  const files = new Map(Object.entries(seed));
  const session = new ReplSession({
    read: (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return text;
    },
    write: (path, text) => {
      files.set(path, text);
    },
  });
  return { session, files };
}

describe("saving and opening a model at the prompt", () => {
  it("writes cells, formats, names and scenarios, and counts each", () => {
    const { session, files } = withFiles();
    session.handle("B1 = 0.1");
    session.handle("B2 = 200");
    session.handle("A1 = =B2*(1+B1)");
    session.handle(".format A1 = #,##0.00");
    session.handle(".name Rate = B1");
    session.handle(".scenario Base = B1:B2");
    session.handle(".scenario High = B1=0.25");
    expect(session.handle(".save m.json")).toBe(
      "  3 cells, 1 format, 1 name, 2 scenarios to m.json",
    );
    const written = files.get("m.json") as string;
    expect(JSON.parse(written)).toMatchObject({ recalc: 1 });
    expect(written.endsWith("\n")).toBe(true);
  });

  it("counts the empty parts too", () => {
    // A line that leaves out whatever happens to be empty cannot answer the
    // question the line is read for, which is whether the formats and the
    // scenarios came with the file.
    const { session } = withFiles();
    session.handle("A1 = 1");
    expect(session.handle(".save m.json")).toBe(
      "  1 cell, 0 formats, 0 names, 0 scenarios to m.json",
    );
  });

  it("reads one back over an empty sheet", () => {
    const { session, files } = withFiles();
    session.handle(".demo");
    session.handle(".format B6 = #,##0.00");
    session.handle(".scenario Base = B1:B3");
    const saved = session.handle(".save m.json") as string;
    expect(saved).toContain("1 format");
    expect(saved).toContain("1 scenario");
    expect(session.handle(".reset")).toContain("new sheet");
    expect(session.handle(".list")).toContain("empty sheet");

    expect(session.handle(".open m.json")).toBe(
      `${(saved.split(" to ")[0] as string).trimEnd()} from m.json`,
    );
    // The formula is a formula, the format is applied to it, and the scenario
    // came with the sheet it was captured over.
    expect(session.handle("B6")).toContain("=B3+NPV(B1,C3:F3)");
    expect(session.handle("B6")).toContain("60,708.38");
    expect(session.handle(".scenarios")).toContain("Base");
    expect(session.handle(".summary B6:B8")).toContain("Base");
    expect(files.size).toBe(1);
  });

  it("replaces the sheet rather than reading into it", () => {
    const { session } = withFiles();
    session.handle("A1 = 1");
    session.handle("Z9 = leftover");
    session.handle(".scenario Old = A1:A1");
    session.handle(".save first.json");
    session.handle(".reset");
    session.handle("A1 = 2");
    session.handle(".save second.json");

    session.handle(".open first.json");
    expect(session.handle("A1")).toContain("1");
    expect(session.handle("Z9")).toContain("leftover");
    expect(session.handle(".scenarios")).toContain("Old");

    // The second document has no Z9 and no scenarios, so after opening it
    // there must be none: a merge would leave both behind.
    session.handle(".open second.json");
    expect(session.handle("A1")).toContain("2");
    expect(session.handle("Z9")).toContain("(blank)");
    expect(session.handle(".scenarios")).toContain("no scenarios defined");
    expect(session.workbook.cellCount).toBe(1);
  });

  it("starts the opened sheet's undo history at the document", () => {
    const { session } = withFiles();
    session.handle("A1 = 1");
    session.handle(".save m.json");
    session.handle(".reset");
    session.handle(".open m.json");
    expect(session.handle(".undo")).toContain("nothing to undo");
    expect(session.handle("A1")).toContain("1");
  });

  it("refuses a document it cannot read, and says why", () => {
    const { session } = withFiles({
      "later.json": '{"recalc": 2, "cells": {}}',
      "junk.json": "{nope",
      "wrong.json": '{"recalc": 1, "cells": {"A1": 5}}',
    });
    expect(session.handle(".open later.json")).toContain(
      "document version 2, and this reads version 1",
    );
    expect(session.handle(".open junk.json")).toContain("not a document");
    expect(session.handle(".open wrong.json")).toContain("cells.A1 must be text");
    // A refused document leaves the session alone.
    session.handle("A1 = 7");
    session.handle(".open later.json");
    expect(session.handle("A1")).toContain("7");
  });

  it("says what it wants when given no path", () => {
    const { session } = withFiles();
    expect(session.handle(".save")).toContain("usage: .save model.json");
    expect(session.handle(".open")).toContain("usage: .open model.json");
  });

  it("refuses both commands with no file access at all", () => {
    const session = new ReplSession();
    expect(session.handle(".save m.json")).toContain("no file access");
    expect(session.handle(".open m.json")).toContain("no file access");
  });

  it("is listed in the help", () => {
    const { session } = withFiles();
    const help = session.handle(".help") as string;
    expect(help).toContain(".save model.json");
    expect(help).toContain(".open model.json");
  });
});
