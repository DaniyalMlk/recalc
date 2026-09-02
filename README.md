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

Every phase in [ROADMAP.md](ROADMAP.md) is complete: the formula grammar, the
reference model, the dependency graph, the evaluator, a function library of 98
functions including a financial pack, CSV interchange, named ranges, a
benchmark harness, structural editing that rewrites every formula in the sheet
when rows and columns move, block editing with fill, clipboard and undo, number
formats that follow their cells through every one of those operations, and a
web interface where all of it is reachable from a virtualised grid.

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

## Number formats

A format code is compiled once into digit positions, literals and up to four
sections, then applied to values as often as needed:

```ts
import { formatWith, parseFormatCode, applyFormat } from "recalc";

formatWith("#,##0.00", 237560.620691).text;   // "237,560.62"
formatWith("0.0%", 0.1356486793).text;        // "13.6%"
formatWith('#,##0.0,,"M"', 2400000).text;     // "2.4M"
formatWith("0.00E+00", 0.000123).text;        // "1.23E-04"

// Sections split by sign: positive; negative; zero; text.
formatWith('#,##0;[Red](#,##0);"—"', -1234);  // { text: "(1,234)", colour: "red" }

// Compile once when the same code is applied repeatedly.
const code = parseFormatCode("$#,##0.00");
applyFormat(code, -1234.5).text;              // "-$1,234.50"
```

A format is attached to a cell rather than to its contents, which is what lets
a column stay formatted as money while its figures come and go:

```ts
const book = new Workbook();
book.setCells({ B15: 237560.620691, B16: 0.1356486793 });
book.setFormat("B15", "$#,##0;[Red]($#,##0)");
book.setFormat("B16", "0.0%");

book.getDisplay("B15");     // "$237,561"
book.getValue("B15");       // 237560.620691 - untouched
book.getFormatted("B16");   // { text: "13.6%", colour: null }

book.clearCell("B15");      // contents go
book.formatOf("B15");       // "$#,##0;[Red]($#,##0)" - the format stays
```

Formats move with their cells through an insert, a delete, a fill or a paste,
and undo reverses a format change like any other edit.

The same compiler backs the `TEXT` worksheet function, so what a formula
produces and what a cell displays cannot drift apart:

```
=TEXT(B15, "$#,##0")     →  "$237,561"
=TEXT(B16, "0.0%")       →  "13.6%"
```

Supported: digit placeholders `0` `#` `?`, a decimal point, grouping and
thousands-scaling commas, `%`, quoted literals, `\` escapes, `_` width skips,
`*` fills, `@` for text, `[Red]`-style colours, and `E+00` scientific codes.
Date and fraction codes are rejected with the offset of the offending
character rather than silently mis-formatted.

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

Editing works on blocks as well as cells. `Ctrl`+`D` and `Ctrl`+`R` fill a
selection down and across, `Ctrl`+`C`/`X`/`V` copy, cut and paste one — with the
references translated by the distance moved, and the copied block outlined until
it is dropped — and `Ctrl`+`Z` steps back through the whole session. Clicking a
row or column header selects the line; right-clicking one offers to insert or
delete it, with the menu naming what it would do to the current selection rather
than in the abstract.

The **Format** menu applies a number format to the selection. Each choice is
previewed against the number in the selected cell rather than against a stock
figure, because "Millions" means nothing beside a capital outlay until it reads
`-2.4M`; the format already in effect is ticked, and a selection whose cells
disagree ticks nothing. A format's `[Red]` section is honoured on the grid, so
a negative in an accounting format arrives in parentheses and in red.

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

recalc> .format B6 = $#,##0.00
  formatted B6 as $#,##0.00
recalc> B6
  B6  -$33,936.00          =B3+NPV(B1,C3:F3)   [$#,##0.00]
```

`.help` lists the commands: `.list`, `.show A1:C9`, `.prec`, `.deps`, `.plan`,
`.cycles`, `.fns`, `.help FN`, `.demo`, `.clear`, `.reset`; for names
`.name Revenue = B2:B13`, `.names`, `.unname Revenue`; for blocks
`.filldown B1:B9`, `.fillright B2:F2`, `.copy A1:C3`, `.paste D5`, `.undo`,
`.redo`; for rows and columns
`.insertrow 3 [n]`, `.deleterow 3 [n]`, `.insertcol C [n]`, `.deletecol C [n]`;
for number formats `.format B2:B13 = #,##0.00`, `.format B2`, `.formats`; and
for CSV `.csv [formulas|display]`, `.import data.csv [A1]`,
`.export out.csv [formulas|display]`.

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

**Display rounding happens on the decimal, not on the double.** `toFixed` is
the obvious tool and gives the wrong answer often enough to matter:
`(1.005).toFixed(2)` is `"1.00"`, because 1.005 is really 1.00499999999999989
in binary. No spreadsheet shows that. A value is instead decomposed into
exactly 15 significant decimal digits — the precision at which a double
round-trips through a decimal string unambiguously — and rounded there, half
away from zero. The same decomposition supplies the base-ten exponent for
scientific formats, because `Math.floor(Math.log10(1000))` can land on 2 and
print a thousand as `1.00E+02`.

**A format belongs to the cell, not to its contents.** They are stored in a
separate sparse table rather than inside the cell record, and the difference
shows up twice. Clearing a cell in a spreadsheet leaves the column still
reading as money, which a field on the record could not survive. And a format
is usually applied to a block where most cells are empty, which a table keyed
by coordinate handles for free.

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

**The grid's commands are computed, not hard-coded into three places.** A
command exists in a menu item, a keyboard shortcut and sometimes a toolbar
button, and the tempting shape is to wire each of those up where it lives. Then
the menu says "Fill down" over a one-row selection that cannot fill, or the
button stays enabled with an empty history. Instead one module works out what
the current selection can do and what to call it — "Insert 3 rows above",
"Delete columns C–E", "Undo insert 3 rows at 4" — and everything on screen reads
from that. The labels come from the workbook's own journal, so a button can
never promise something different from what pressing it does.

**Nothing driven by a keystroke animates.** Copy, paste, fill and undo are
pressed hundreds of times in a working session, and an animation on any of them
turns into a delay the user feels every single time. The context menu is the one
thing that moves, because a right click is rare and a popup that grows from the
pointer reads as attached to the click rather than dropped onto the page.

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
- Date and fraction format codes are rejected rather than supported: the value
  model has no date serial type, so `yyyy-mm-dd` would have nothing to format.
- A format belongs to a cell, not to a row, a column or the sheet, so
  formatting a whole column means selecting it and applying the format to the
  cells in it.
- CSV carries no formats: an export in `display` mode writes what the sheet
  shows, but that text does not read back in as the same numbers.
- Names can only be defined from the library or the shell, not from the grid.
- Reference highlighting outlines only references written out in the formula.
  A name is underlined in the formula bar and resolved in the inspector, but
  the cells behind it are not outlined on the grid.

## License

MIT
