# recalc

A spreadsheet formula engine written in TypeScript, with no runtime dependencies.

`recalc` takes formula text, parses it into an AST, works out which cells each
formula depends on, and recalculates only what an edit actually invalidated.

```
=IF(B2>0, NPV(B1, C2:C8) / B2, "n/a")
   │        │        │
   │        │        └── range precedent, tracked whole, not expanded
   │        └── function call, arity- and type-checked
   └── comparison against a scalar, with spreadsheet coercion rules
```

## Status

Phases 1–9 of [ROADMAP.md](ROADMAP.md) are complete: the formula grammar, the
reference model, the dependency graph, the evaluator, a function library of 97
functions including a financial pack, a web interface with a virtualised grid,
CSV interchange, named ranges, a benchmark harness, structural editing that
rewrites every formula in the sheet when rows and columns move, and block
editing — fill, clipboard and an undo history — on top of it.

## Using it as a library

```ts
import { Workbook } from "recalc";

const book = new Workbook();
book.setCells({
  B1: 1200,          // units
  B2: 24.5,          // price
  B3: 15.25,         // unit cost
  B4: 6000,          // fixed costs
  B6: "=B1*B2",
  B8: "=B6-B1*B3",
  B9: "=B8-B4",
  B12: '=IF(B9>0,"profitable","loss-making")',
});

book.getValue("B9");        // 5100
book.getValue("B12");       // "profitable"
book.setCell("B1", 500);    // four dependent cells recompute, nothing else
book.getValue("B12");       // "loss-making"
book.precedentsOf("B9");    // ["B8", "B4"]
book.recalculationOrder("B1"); // ["B1", "B6", "B8", "B9", "B12"]

book.defineName("Volume", "B1");
book.setCell("B14", "=Volume*2");   // 1000
book.setCell("B1", 700);            // 1400 - the name follows the cell

book.insertRows(0, 1);      // a blank row 1; everything below shifts down
book.getInput("B10");       // "=B9-B5" - the formula followed its inputs
book.names()[0].target;     // "B2" - so did the name

book.deleteRows(1, 1);      // delete the row the unit count was on
book.getInput("B6");        // "=#REF!*B2" - there is nothing left to read
book.names()[0].target;     // "#REF!" - and the name says so too
```

Filling and pasting translate the relative parts of a reference and leave the
anchored parts alone, and every operation is one step in the undo history:

```ts
const sheet = new Workbook();
sheet.setCells({ A1: 100, A2: 250, A3: 90, B1: "=A1*0.2" });

sheet.fillDown("B1:B3");
sheet.getInput("B3");                    // "=A3*0.2"

sheet.paste(sheet.copy("B1:B3"), "D1");
sheet.getInput("D1");                    // "=C1*0.2"

sheet.undoLabel;                         // "paste"
sheet.undo();                            // all three pasted cells, in one step
```

## Using it from the browser

```bash
npm run web        # dev server
npm run build:web  # static bundle in web/dist
```

The grid is virtualised: only the cells inside the viewport plus a small
overscan band exist as DOM nodes, so a 4,096-row sheet and a 30-row one cost the
same to render. Arrow keys move, `Shift`+arrows extend, `Ctrl`+arrows jump to the
edge of a block of content, `F2` opens a cell, and `Tab` walks a marked-out block
without leaving it. Selecting a cell shows what it reads, what reads it, and the
order the engine would recompute in; editing a formula outlines each reference on
the grid in the colour it is shown in the formula bar.

## Using it from the shell

```bash
npm run repl
```

```
recalc> .demo
  B1  0.09
  B3  -250000
  ...
  B6  60708.38334313518   =B3+NPV(B1,C3:F3)
  B7  0.18188124729113628  =IRR(B3:F3)
  B10 accept               =IF(B6>0,"accept","reject")

recalc> .plan B1
  B1 -> B8 -> B6 -> B10

recalc> B1 = 0.25
recalc> B10
  B10  reject              =IF(B6>0,"accept","reject")
```

`.help` lists the commands: `.list`, `.show A1:C9`, `.prec`, `.deps`, `.plan`,
`.cycles`, `.fns`, `.help FN`, `.demo`, `.clear`, `.reset`; for names
`.name Revenue = B2:B13`, `.names`, `.unname Revenue`; for blocks
`.filldown B1:B9`, `.fillright B2:F2`, `.copy A1:C3`, `.paste D5`, `.undo`,
`.redo`; for rows and columns
`.insertrow 3 [n]`, `.deleterow 3 [n]`, `.insertcol C [n]`, `.deletecol C [n]`;
and for CSV `.csv [formulas]`, `.import data.csv [A1]`,
`.export out.csv [formulas]`.

## Install and run

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run build     # emits dist/
npm run build:web # emits web/dist/
npm run repl      # interactive shell
npm run web       # dev server for the grid
npm run bench     # recalculation measurements
```

## Design decisions that mattered

**References are structured values, not strings.** A parsed `$B7` is
`{ col: 1, row: 6, colAbsolute: true, rowAbsolute: false }`. Keeping references
as text is easier to write and wrong in two places: fill-down has to shift every
relative reference by the row delta, which with strings means parsing and
reprinting on every filled cell; and the dependency graph needs one node per
cell, which strings cannot give you, because `B7`, `$B7` and `B$7` address the
same cell but are three different strings. Splitting the anchors from the
coordinates makes translation arithmetic and lets the graph key come from the
coordinates alone.

**Ranges are tracked whole, never expanded.** `SUM(A1:A1000)` reads a thousand
cells but is one precedent. Expanding at extraction time would put a thousand
edges in the graph for a formula that only ever needs one. Instead the graph
keeps the range and, when a cell changes, tests it for containment against the
distinct ranges in the sheet — linear in ranges, not in cells.

**Ordering and cycle detection are one pass.** Tarjan's algorithm emits each
strongly-connected component only after everything reachable from it, so
reversing the emission order is exactly a topological sort of the condensation.
One traversal yields both the evaluation order and the circular references. It
is written iteratively: dependency chains of several thousand cells are ordinary
and would overflow the call stack in the recursive form.

**Blank is its own type.** A blank cell is skipped by `COUNT` and by `AVERAGE`'s
denominator, yet compares equal to both `0` and `""` — while `0` and `""` stay
unequal to each other. That is only expressible if blank survives as its own
value through the whole engine and is resolved at the point of comparison.

**Spreadsheet arithmetic is not JavaScript arithmetic.** `MOD(-3,2)` is 1, not
-1, because MOD takes the sign of the divisor. `ROUND(2.675,2)` is 2.68 even
though the stored double is 2.67499999…. `-2^2` is 4, because negation binds
tighter than exponentiation. Each is reproduced deliberately and pinned by a
test.

**Rate solving does not give up.** `IRR`, `XIRR` and `RATE` have no closed form.
Newton's method is tried first and diverges on cash flows with a late reversal,
so a bracketing search takes over: once a sign change is found the root is
trapped and bisection cannot miss.

## Numerical validation

The financial functions are checked against closed-form results and published
worked examples rather than against their own output:

- `PMT(0.06/12, 360, 200000)` gives −1199.1010503055, and paying that instalment
  for the full term leaves a balance of zero — the amortisation identity.
- `NPV` at the rate `IRR` returns is zero, on flows where Newton alone diverges.
- `XIRR` agrees with `IRR` to ten places when the dates are exactly a year apart.
- `MIRR` reproduces the three published example results for the standard
  {−120000, 39000, 30000, 21000, 37000, 46000} cash flow.
- `STDEV.P` over {2,4,4,4,5,5,7,9} is exactly 2, and variance stays accurate on
  values around 100,000,000 with a spread of 1, where the one-pass formula
  collapses.

**A named range is expanded into the graph, not resolved at evaluation time.**
If `Revenue` is `B2:B13`, then editing `B7` has to recalculate everything that
mentions `Revenue`, even though nothing mentions `B7`. Resolving the name only
when the formula runs would leave no edge for the invalidation to travel along,
and the total on screen would be silently stale — the worst kind of spreadsheet
bug, because nothing about it looks wrong. So the name is expanded when the
formula is stored. The other direction needs its own bookkeeping: redefining a
name has to reach its users, and they are not reachable through the graph
either, since the graph holds what the name resolved *to* and not the name
itself. A separate name-to-users index keeps that cost proportional to the
users rather than to the sheet.

**A structural edit rewrites formulas, and says so when it cannot.** Inserting a
row moves cells, which is the easy half; the other half is that every formula in
the sheet is written in terms of positions that just changed. A reference whose
target survives is shifted, but a reference whose target was deleted has no
honest answer left, so it becomes `#REF!` rather than quietly pointing at
whatever slid into that address. The range rules follow from treating a range as
a span rather than two independent corners: an insert inside a span stretches
it, a delete inside shortens it, and an end that was itself deleted collapses
onto the surviving line beside it — the start onto the first line after the
hole, the end onto the last line before it. A span that was entirely deleted
then comes out inverted, which is how "nothing is left" is detected without a
special case for it.

**Only the formulas that moved are reprinted.** The rewrite returns the
identical syntax tree when nothing inside it changed, and the workbook uses that
identity to decide whether to touch the cell's stored text at all. It is the
difference between a sheet that survives a hundred row inserts with its formulas
still spelled the way they were typed, and one where an unrelated edit silently
reformats `=A1 + A2` into `=A1+A2` everywhere.

**Translation and structural adjustment are different operations.** Both move
references, and it is tempting to write one and reuse it. The difference is the
anchors: a structural edit moves the cells themselves, so `$A$1` has to follow
them, while a fill or a paste moves the *formula* over cells that did not move,
which is exactly the case a `$` exists to opt out of. One shared routine with a
flag would keep the two apart in the caller's head and nowhere else.

**The undo journal records inputs, not values.** Values are derived, so
restoring the inputs and letting the engine recompute reproduces them exactly;
a journal of values would go stale the moment anything upstream changed. It
records the difference an operation made rather than a snapshot of the sheet,
because snapshotting on every keystroke is quadratic in the size of the sheet
over a session of ordinary typing. The exception is a structural edit, which
can move every cell at once and honestly says its scope is the whole sheet
rather than pretending to a bound it does not have.

**CSV is scanned, not split.** `line.split(",")` is wrong on the first field
containing a comma and `text.split("\n")` is wrong on the first field containing
a newline, which in exported spreadsheet data is roughly every other file. The
reader is a character scanner over the whole text, so quoting is a mode it is in
rather than a repair applied afterwards; it takes `CRLF` and bare `LF`, a byte
order mark, doubled quotes, and ragged rows. Export makes the value-or-formula
choice explicit, because those are different files and only one of them
round-trips.

**The grid's rules are separated from its pixels.** Axis geometry, the visible
window, the selection model and formula highlighting are ordinary modules with no
DOM import, and the renderer only turns their output into nodes. The reason is
that these are the parts that are hard to get right and impossible to check
through a browser: that `Ctrl`+`Down` stops at the end of a block rather than the
end of the sheet, that `Shift`+`Down` grows the selection while leaving the
typing cursor where it was, that a resized row does not scroll its own top out of
view. All of it is exercised under vitest with no DOM environment at all.

**Column offsets are sparse, not materialised.** A prefix-sum array over a
million rows would cost eight megabytes to answer a question that is almost
always `row * defaultHeight`. Instead only the resized indices are stored, sorted,
with a running total of how far they displace everything after them; an offset is
one binary search over that list, and a hit test is one binary search over the
index space on top of it.

**Highlighting classifies tokens the parser has not reached yet.** A formula is
unparseable for most of the time it is being typed, so the formula bar cannot
wait for an AST. It walks the token stream with one token of lookahead instead,
which is enough to make the one decision that matters — a word followed by `(` is
a function, so `LOG10(100)` colours as a call while `LOG10` alone colours as the
cell it addresses.

## Measured cost

`npm run bench` prints the recalculation measurements. The numbers below are
from one run on an ordinary machine; the shape is what matters, not the
absolute values.

```
shape                            cells  build ms  edit ms  recalculated
chain of 5000                    5,000      51.3     14.4         5,000
fan-out to 5000                  5,001      41.6     11.6         5,000
3 aggregates over 10000         10,003      91.5    6.018             3
3 named aggregates over 10000   10,003     109.7    7.196             3
isolated edit in 2000 cells      2,001      22.5    0.006             0
isolated edit in 20000 cells    20,001     216.3    0.005             0
isolated edit in 100000 cells  100,001    1500.6    0.007             0
```

The last three rows are the design claim under test: an edit whose cell has no
dependents costs the same in a 100,000-cell sheet as in a 2,000-cell one. Going
through a named range rather than a written-out one costs about a fifth more on
this workload, which is the price of the extra indirection at definition time.

## Known gaps

- No CI is configured, so the suite and the benchmark run locally only.
- Implicit intersection is not implemented: a multi-cell range in a scalar
  position is `#VALUE!` rather than a silent pick from the calling row.
- Omitted arguments (`IF(A1,,2)`) are a parse error.
- Only one sheet; there are no cross-sheet references.
- No number formats: the grid shows the general format only, so a rate reads as
  `0.1356486793` rather than `13.56%`.
- The grid has no undo, no clipboard and no fill handle, and names can only be
  defined from the library or the shell, not from the grid.
- Reference highlighting outlines only references written out in the formula.
  A name is underlined in the formula bar and resolved in the inspector, but
  the cells behind it are not outlined on the grid.

## License

MIT
