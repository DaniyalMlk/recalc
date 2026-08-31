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
