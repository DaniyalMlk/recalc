import { describe, expect, it } from "vitest";
import { ParseError } from "../src/engine/errors.js";
import { ReplSession } from "../src/repl.js";

/** Run a script of lines and return each line's output. */
function run(lines: string[]): string[] {
  const session = new ReplSession();
  return lines.map((line) => {
    const out = session.handle(line);
    if (out === ReplSession.QUIT) return "<quit>";
    return out ?? "";
  });
}

const one = (line: string, before: string[] = []) => run([...before, line]).at(-1)!;

describe("entering data", () => {
  it("stores a number and echoes it back", () => {
    expect(one("A1 = 42")).toContain("42");
  });

  it("stores text", () => {
    expect(one("A1 = hello")).toContain("hello");
  });

  it("stores a formula and shows its canonical spelling", () => {
    const out = one("B1 = =1+ 2*3", ["A1 = 1"]);
    expect(out).toContain("7");
    expect(out).toContain("=1+2*3");
  });

  it("tolerates spacing around the assignment", () => {
    expect(one("A1=5")).toContain("5");
    expect(one("A1   =   5")).toContain("5");
  });

  it("reads a cell back by address alone", () => {
    expect(one("A1", ["A1 = 9"])).toContain("9");
  });

  it("marks an empty cell as blank", () => {
    expect(one("Q9")).toContain("blank");
  });

  it("recalculates a dependent when its precedent changes", () => {
    const out = run(["A1 = 2", "B1 = =A1*10", "A1 = 5", "B1"]);
    expect(out[1]).toContain("20");
    expect(out[3]).toContain("50");
  });
});

describe("inspection commands", () => {
  const model = ["A1 = 2", "A2 = 3", "B1 = =SUM(A1:A2)", "C1 = =B1*2"];

  it("lists precedents including ranges", () => {
    expect(one(".prec B1", model)).toContain("A1:A2");
  });

  it("lists dependents", () => {
    expect(one(".deps B1", model)).toContain("C1");
  });

  it("shows a recalculation order with precedents first", () => {
    const plan = one(".plan A1", model);
    expect(plan.indexOf("B1")).toBeLessThan(plan.indexOf("C1"));
  });

  it("says when nothing else would change", () => {
    expect(one(".plan C1", model)).toContain("nothing else");
  });

  it("lists every occupied cell", () => {
    const listing = one(".list", model);
    for (const address of ["A1", "A2", "B1", "C1"]) {
      expect(listing, address).toContain(address);
    }
  });

  it("shows a block", () => {
    const block = one(".show A1:A2", model);
    expect(block).toContain("A1");
    expect(block).toContain("A2");
    expect(block).not.toContain("C1");
  });

  it("reports an empty sheet and an empty block", () => {
    expect(one(".list")).toContain("empty sheet");
    expect(one(".show Y1:Y9", model)).toContain("(empty)");
  });
});

describe("circular references", () => {
  it("finds none in a clean sheet", () => {
    expect(one(".cycles", ["A1 = 1"])).toContain("no circular");
  });

  it("reports a self-reference and clears it once fixed", () => {
    const out = run(["A1 = =A1+1", ".cycles", "A1 = 1", ".cycles"]);
    expect(out[0]).toContain("#CYCLE!");
    expect(out[1]).toContain("A1");
    expect(out[3]).toContain("no circular");
  });

  it("names the participants of a two-cell loop", () => {
    const out = run(["A1 = =B1", "B1 = =A1", ".cycles"]);
    expect(out[2]).toContain("A1 -> B1");
  });
});

describe("function help", () => {
  it("describes a function", () => {
    const out = one(".help IRR");
    expect(out).toContain("IRR");
    expect(out).toContain("1-2 args");
  });

  it("marks a variadic function", () => {
    expect(one(".help SUM")).toContain("...");
  });

  it("rejects an unknown name", () => {
    expect(one(".help NOSUCH")).toContain("no function");
  });

  it("filters the function list by prefix", () => {
    const out = one(".fns IS");
    expect(out).toContain("ISBLANK");
    expect(out).not.toContain("SUM");
  });
});

describe("the demo model", () => {
  it("loads and computes a discounted cash flow", () => {
    const session = new ReplSession();
    session.handle(".demo");
    const book = session.workbook;
    const npv = book.getValue("B6");
    const irr = book.getValue("B7");
    expect(typeof npv).toBe("number");
    expect(typeof irr).toBe("number");
    expect(npv as number).toBeCloseTo(60708.3833431352, 6);
    // The engine's own two answers have to agree: NPV at the IRR is zero.
    expect(book.getValue("B10")).toBe("accept");
    book.setCell("B1", irr as number);
    expect(Math.abs(book.getValue("B6") as number)).toBeLessThan(1e-6);
  });

  it("flips the verdict at a high enough discount rate", () => {
    const session = new ReplSession();
    session.handle(".demo");
    session.handle("B1 = 0.25");
    expect(session.workbook.getValue("B10")).toBe("reject");
  });
});

describe("session control", () => {
  it("clears a cell", () => {
    const out = run(["A1 = 5", ".clear A1", "A1"]);
    expect(out[1]).toContain("cleared");
    expect(out[2]).toContain("blank");
  });

  it("resets to an empty sheet", () => {
    const out = run(["A1 = 5", ".reset", "A1"]);
    expect(out[2]).toContain("blank");
  });

  it("signals a quit rather than exiting the process", () => {
    expect(run([".quit"])[0]).toBe("<quit>");
    expect(run([".exit"])[0]).toBe("<quit>");
  });
});

describe("bad input", () => {
  it("lets a parse error escape for the caller to render", () => {
    const session = new ReplSession();
    expect(() => session.handle("A1 = =1+")).toThrow(ParseError);
  });

  it("rejects an unknown command", () => {
    expect(one(".nope")).toContain("unknown command");
  });

  it("rejects a line that is neither an assignment nor an address", () => {
    expect(one("what is this")).toContain("not understood");
  });

  it("rejects a malformed .show", () => {
    expect(one(".show A1")).toContain("usage");
  });
});

describe("CSV commands", () => {
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

  it("prints the sheet as CSV", () => {
    const { session } = withFiles();
    session.handle("A1 = Units");
    session.handle("B1 = 1200");
    expect(session.handle(".csv")).toBe("Units,1200");
  });

  it("prints formula text when asked", () => {
    const { session } = withFiles();
    session.handle("A1 = 6");
    session.handle("B1 = =A1*2");
    expect(session.handle(".csv")).toBe("6,12");
    expect(session.handle(".csv formulas")).toBe("6,=A1*2");
  });

  it("says so when the sheet is empty", () => {
    const { session } = withFiles();
    expect(session.handle(".csv")).toContain("empty sheet");
  });

  it("writes a file and reports the count", () => {
    const { session, files } = withFiles();
    session.handle("A1 = 1");
    session.handle("B1 = 2");
    expect(session.handle(".export out.csv")).toContain("2 cell(s)");
    expect(files.get("out.csv")).toBe("1,2");
  });

  it("reads a file into the sheet and recalculates it", () => {
    const { session } = withFiles({
      "in.csv": "Region,Units\nNorth,1200\nTotal,=SUM(B2:B2)\n",
    });
    expect(session.handle(".import in.csv")).toContain("A1:B3");
    expect(session.handle("B3")).toContain("1200");
  });

  it("imports at a given origin", () => {
    const { session } = withFiles({ "in.csv": "x" });
    expect(session.handle(".import in.csv C5")).toContain("C5:C5");
    expect(session.handle("C5")).toContain("x");
  });

  it("round-trips a sheet through a file", () => {
    const { session } = withFiles();
    session.handle("A1 = Item, with comma");
    session.handle("B1 = =LEN(A1)");
    const before = session.handle("B1");

    session.handle(".export out.csv formulas");
    session.handle(".reset");
    session.handle(".import out.csv");

    // The comma inside the field must survive quoting, or LEN would differ.
    expect(session.handle("B1")).toBe(before);
    expect(session.handle("A1")).toContain("Item, with comma");
  });

  it("refuses the file commands with no file access", () => {
    const session = new ReplSession();
    expect(session.handle(".import x.csv")).toContain("no file access");
    expect(session.handle(".export x.csv")).toContain("no file access");
  });

  it("reports usage for a missing path", () => {
    const { session } = withFiles();
    expect(session.handle(".import ")).toContain("usage");
    expect(session.handle(".export ")).toContain("usage");
  });
});

describe("name commands", () => {
  const sheet = ["B2 = 100", "B3 = 250", "B4 = 400"];

  it("names a range and aggregates it", () => {
    expect(
      one("D1 = =SUM(Revenue)", [...sheet, ".name Revenue = B2:B4"]),
    ).toContain("750");
  });

  it("names a constant when the target is not a reference", () => {
    expect(one("A1 = =Rate*100", [".name Rate = 0.11"])).toContain("11");
  });

  it("stores a text constant", () => {
    expect(one(".name Label = growth")).toContain("(value)");
  });

  it("lists what is defined", () => {
    const out = one(".names", [".name Rate = 0.11", ".name Revenue = B2:B4"]);
    expect(out).toContain("RATE");
    expect(out).toContain("REVENUE");
    expect(out).toContain("B2:B4");
  });

  it("says so when nothing is named", () => {
    expect(one(".names")).toContain("no names defined");
  });

  it("recalculates a user when the target changes", () => {
    const before = [...sheet, ".name Revenue = B2:B4", "D1 = =SUM(Revenue)"];
    expect(one("D1", [...before, ".name Revenue = B2:B3"])).toContain("350");
  });

  it("recalculates a user when a cell inside the range changes", () => {
    const before = [...sheet, ".name Revenue = B2:B4", "D1 = =SUM(Revenue)"];
    expect(one("D1", [...before, "B3 = 1250"])).toContain("1750");
  });

  it("removes a name and leaves its users with #NAME?", () => {
    const before = [...sheet, ".name Revenue = B2:B4", "D1 = =SUM(Revenue)"];
    expect(one(".unname Revenue", before)).toContain("removed REVENUE");
    expect(one("D1", [...before, ".unname Revenue"])).toContain("#NAME?");
  });

  it("reports removing a name that does not exist", () => {
    expect(one(".unname Nope")).toContain("no name called");
  });

  it("refuses a name that reads as a cell reference", () => {
    expect(one(".name A1 = B2")).toContain("cell reference");
  });

  it("reports usage for a malformed definition", () => {
    expect(one(".name broken")).toContain("usage");
  });
});

describe("rows and columns", () => {
  const sheet = ["A1 = 1", "A2 = 2", "A3 = 3", "C1 = =SUM(A1:A3)"];

  it("inserts a row and reports what it did", () => {
    expect(one(".insertrow 2", sheet)).toContain("1 row inserted at 2");
  });

  it("moves the cells the insertion pushed down", () => {
    expect(one("A4", [...sheet, ".insertrow 2"])).toContain("3");
  });

  it("stretches a range an insertion lands inside", () => {
    expect(one("C1", [...sheet, ".insertrow 2"])).toContain("=SUM(A1:A4)");
  });

  it("inserts several rows at once", () => {
    expect(one(".insertrow 2 3", sheet)).toContain("3 rows inserted at 2");
  });

  it("deletes a row and shrinks the range", () => {
    expect(one("C1", [...sheet, ".deleterow 2"])).toContain("=SUM(A1:A2)");
  });

  it("leaves #REF! where a deleted cell was referenced", () => {
    const before = ["A1 = 5", "C1 = =A2*2", "A2 = 7"];
    expect(one("C1", [...before, ".deleterow 2"])).toContain("#REF!");
  });

  it("inserts a column by its letter", () => {
    expect(one(".insertcol B", sheet)).toContain("1 column inserted at B");
    expect(one("D1", [...sheet, ".insertcol B"])).toContain("=SUM(A1:A3)");
  });

  it("deletes a column by its letter", () => {
    expect(one(".deletecol A", sheet)).toContain("1 column deleted from A");
  });

  it("accepts a lower-case column letter", () => {
    expect(one(".insertcol b", sheet)).toContain("inserted at B");
  });

  it("rejects a row that is not a number", () => {
    expect(one(".insertrow zz")).toContain("not a row");
  });

  it("rejects row zero, since rows are numbered from one", () => {
    expect(one(".deleterow 0")).toContain("not a row");
  });

  it("rejects a count that is not a positive whole number", () => {
    expect(one(".deleterow 1 0")).toContain("positive whole number");
    expect(one(".deleterow 1 x")).toContain("positive whole number");
  });

  it("reports usage when the line is missing", () => {
    expect(one(".insertrow")).toContain("usage");
    expect(one(".deletecol")).toContain("usage");
  });

  it("lists the structural commands in the help text", () => {
    const help = one(".help");
    expect(help).toContain(".insertrow");
    expect(help).toContain(".deletecol");
  });
});

describe("blocks, clipboard and history", () => {
  const sheet = ["A1 = 1", "A2 = 2", "A3 = 3", "B1 = =A1*2"];

  it("fills a block down and translates the formula", () => {
    expect(one(".filldown B1:B3", sheet)).toContain("filled B1:B3");
    expect(one("B3", [...sheet, ".filldown B1:B3"])).toContain("=A3*2");
  });

  it("fills a block across", () => {
    const before = ["A1 = 5", "B1 = 6", "A2 = =A1*10"];
    expect(one("B2", [...before, ".fillright A2:B2"])).toContain("=B1*10");
  });

  it("copies a block and pastes it with translation", () => {
    const script = [...sheet, ".filldown B1:B3", ".copy B1:B3", ".paste D1"];
    expect(one(".copy B1:B3", [...sheet])).toContain("copied 1x3");
    expect(one("D3", script)).toContain("=C3*2");
  });

  it("refuses to paste with an empty clipboard", () => {
    expect(one(".paste D1", sheet)).toContain("nothing copied");
  });

  it("clears a whole block", () => {
    expect(one(".clear A1:B3", sheet)).toContain("cleared A1:B3");
    expect(one(".list", [...sheet, ".clear A1:B3"])).toContain("empty sheet");
  });

  it("still clears a single cell", () => {
    expect(one(".clear A1", sheet)).toContain("cleared A1");
  });

  it("undoes the last edit and says what it undid", () => {
    expect(one(".undo", sheet)).toContain("edit B1");
    expect(one("B1", [...sheet, ".undo"])).toContain("(blank)");
  });

  it("redoes an undone edit", () => {
    expect(one(".redo", [...sheet, ".undo"])).toContain("edit B1");
    expect(one("B1", [...sheet, ".undo", ".redo"])).toContain("=A1*2");
  });

  it("reports when there is nothing to undo or redo", () => {
    expect(one(".undo")).toContain("nothing to undo");
    expect(one(".redo")).toContain("nothing to redo");
  });

  it("undoes a fill as one operation", () => {
    const before = [...sheet, ".filldown B1:B3", ".undo"];
    expect(one("B3", before)).toContain("(blank)");
    expect(one("B1", before)).toContain("=A1*2");
  });

  it("undoes a row insertion", () => {
    const before = [...sheet, ".insertrow 2", ".undo"];
    expect(one("A2", before)).toContain("2");
  });

  it("rejects a malformed block", () => {
    expect(one(".filldown zz")).toContain("not a block");
    expect(one(".clear 99")).toContain("not a cell or block");
  });

  it("reports usage for a missing argument", () => {
    expect(one(".filldown")).toContain("usage");
    expect(one(".copy")).toContain("usage");
    expect(one(".paste nope", [".copy A1"])).toContain("usage");
  });

  it("lists the block commands in the help text", () => {
    const help = one(".help");
    expect(help).toContain(".filldown");
    expect(help).toContain(".undo");
  });

  it("forgets the clipboard when the sheet is reset", () => {
    expect(one(".paste D1", [...sheet, ".copy B1", ".reset"])).toContain(
      "nothing copied",
    );
  });
});

describe("number formats", () => {
  it("applies a format to a cell", () => {
    expect(one(".format A1 = #,##0.00", ["A1 = 1234.5"])).toContain(
      "formatted A1",
    );
    expect(one("A1", ["A1 = 1234.5", ".format A1 = #,##0.00"])).toContain(
      "1,234.50",
    );
  });

  it("applies a format to a block", () => {
    const out = one(".format A1:A3 = 0%", ["A1 = 0.5", "A2 = 0.25"]);
    expect(out).toContain("formatted A1:A3");
    expect(one("A2", ["A1 = 0.5", "A2 = 0.25", ".format A1:A3 = 0%"])).toContain(
      "25%",
    );
  });

  it("shows the code on a cell when asked without an assignment", () => {
    expect(one(".format A1", ["A1 = 1", ".format A1 = 0.00"])).toContain("0.00");
  });

  it("says so when a cell has no format", () => {
    expect(one(".format A1", ["A1 = 1"])).toContain("general format");
  });

  it("lists every formatted cell", () => {
    const out = one(".formats", ["A1 = 1", "B2 = 2", ".format A1 = 0.00"]);
    expect(out).toContain("A1");
    expect(out).toContain("0.00");
    expect(out).not.toContain("B2");
  });

  it("says so when nothing is formatted", () => {
    expect(one(".formats", ["A1 = 1"])).toContain("no formats");
  });

  it("reports a malformed code with its position", () => {
    const out = one(".format A1 = 0yyyy", ["A1 = 1"]);
    expect(out).toContain("mixes date fields");
    expect(out).toContain("(at 1)");
  });

  it("applies a date code and shows the cell as a date", () => {
    const out = one(".format A1 = yyyy-mm-dd", ["A1 = =DATE(2026,3,4)"]);
    expect(out).toContain("yyyy-mm-dd");
    expect(one("A1", ["A1 = =DATE(2026,3,4)", ".format A1 = yyyy-mm-dd"])).toContain(
      "2026-03-04",
    );
  });

  it("applies an elapsed code to a duration", () => {
    const shown = one("A1", ["A1 = 1.5", ".format A1 = [h]:mm"]);
    expect(shown).toContain("36:00");
  });

  it("clears a format back to General", () => {
    const out = one(".format A1 = General", ["A1 = 1", ".format A1 = 0.00"]);
    expect(out).toContain("cleared the format on A1");
  });

  it("refuses a target that is not a cell or block", () => {
    expect(one(".format nonsense = 0.00")).toContain("not a cell or block");
  });

  it("names the format in the undo history", () => {
    expect(one(".undo", ["A1 = 1", ".format A1 = 0.00"])).toContain(
      "undid format A1",
    );
  });

  it("shows the code alongside the value in a listing", () => {
    const out = one(".list", ["A1 = 0.5", ".format A1 = 0%"]);
    expect(out).toContain("50%");
    expect(out).toContain("[0%]");
  });
});

describe("exporting what the sheet shows", () => {
  it("writes the underlying value by default", () => {
    const out = one(".csv", ["A1 = 1234.5", ".format A1 = #,##0.00"]);
    expect(out).toContain("1234.5");
    expect(out).not.toContain("1,234.50");
  });

  it("writes the formatted text on request", () => {
    const out = one(".csv display", ["A1 = 1234.5", ".format A1 = #,##0.00"]);
    expect(out).toContain("1,234.50");
  });

  it("still writes formulas on request", () => {
    const out = one(".csv formulas", ["A1 = 2", "B1 = =A1*3"]);
    expect(out).toContain("=A1*3");
  });
});

describe("blocks in the shell", () => {
  const sheet = ["A1 = 1", "B1 = 2", "C1 = 3", "A2 = 4", "B2 = 5", "C2 = 6"];
  const spilled = [...sheet, "E1 = =TRANSPOSE(A1:C2)"];

  it("shows where a formula's block reaches", () => {
    expect(one("E1 = =TRANSPOSE(A1:C2)", sheet)).toContain("E1:F3");
  });

  it("reports the region and its size", () => {
    const out = one(".spill E1", spilled);
    expect(out).toContain("E1:F3");
    expect(out).toContain("3x2");
    expect(out).toContain("TRANSPOSE(A1:C2)");
  });

  it("answers from a cell inside the block, naming the anchor", () => {
    expect(one(".spill F3", spilled)).toContain("from E1");
  });

  it("says when a cell is not part of a block", () => {
    expect(one(".spill A1", spilled)).toContain("not part of a block");
  });

  it("refuses a .spill on something that is not a cell", () => {
    expect(one(".spill nonsense", spilled)).toContain("not a cell");
  });

  it("marks a spilled cell with the formula it came from", () => {
    const out = one(".show E1:F3", spilled);
    expect(out).toContain("spilled from E1");
    expect(out.match(/spilled from E1/g)).toHaveLength(5);
  });

  it("lists spilled cells alongside entered ones", () => {
    const out = one(".list", spilled);
    expect(out).toContain("F3");
  });

  it("reports a block that has nowhere to land", () => {
    const out = one("E1 = =TRANSPOSE(A1:C2)", [...sheet, "F2 = in the way"]);
    expect(out).toContain("#SPILL!");
    expect(out).toContain("F2");
  });

  it("clears the whole block when the formula goes", () => {
    const out = run([...spilled, ".clear E1", ".show E1:F3"]).at(-1)!;
    expect(out).toContain("(empty)");
  });

  it("builds a block out of nothing with SEQUENCE", () => {
    const out = run(["A1 = =SEQUENCE(3,2)", ".spill B3"]).at(-1)!;
    expect(out).toContain("A1:B3");
    expect(out).toContain("3x2");
  });
});
