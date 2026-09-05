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
reference model, the dependency graph, the evaluator, a function library of 158
functions including financial, date, amortisation, bond, matrix and regression
packs, day-count
conventions, debt schedules, CSV interchange, named ranges, a
benchmark harness, structural editing that rewrites every formula in the sheet
when rows and columns move, block editing with fill, clipboard and undo, number
formats that follow their cells through every one of those operations, array
values that spill a formula's block across the sheet, dense linear algebra and
least-squares regression, what-if
analysis with goal seek, sensitivity tables and named scenarios, and a web
interface where all of it is reachable from a virtualised grid — the analysis
included.

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

## Dates and day-count conventions

A date is a number: whole days from an epoch, with the fractional part carrying
the time. That is the whole model, and everything else — arithmetic, day counts,
date formats — is ordinary numeric work on top of it.

```ts
book.setCells({
  B1: "=DATE(2026, 3, 4)",           // 46085
  B2: "=EOMONTH(B1, 0)",             // the last day of March
  B3: "=EDATE(B1, 18)",              // eighteen months on
  B4: "=WORKDAY(B1, 10, Holidays)",  // ten working days, a holiday list out
  B5: "=YEARFRAC(B1, B3, 0)",        // 1.5 exactly, on 30/360
});
```

The serial system is the 1900 one every other spreadsheet uses, phantom leap day
and all: serial 60 is 29 February 1900, a day that never happened. Reproducing
it is a deliberate choice — a serial is an interchange value, and correcting the
bug would put this engine one day out from every other for two months of 1900
while agreeing everywhere else. Reproducing it properly means going all the way,
so the system behaves as if that calendar were real and a difference of dates is
a difference of serials, with no correction anywhere.

`YEARFRAC` is where the conventions live. The same two dates give five different
answers, and which one is right is a matter of what was agreed, not of what is
true:

| basis | convention | 1 Jan 2012 → 30 Jul 2012 |
| --- | --- | --- |
| 0 | 30/360 US (NASD) | 0.58055556 |
| 1 | actual/actual | 0.57650273 |
| 2 | actual/360 | 0.58611111 |
| 3 | actual/365 | 0.57808219 |
| 4 | 30/360 European | 0.58055556 |

The 30/360 family is the fiddly part, and the fiddliness is all at month ends.
Both variants slide the day numbers onto a 360-day grid before subtracting;
they disagree about what a 31st becomes, and `YEARFRAC` basis 0 additionally
treats a February month end as a 30th while `DAYS360` never has. That last
difference is why 28 February to 31 August is 183 days through `DAYS360` and a
clean 180 through `YEARFRAC` — one is a day count, the other is half a coupon.
Both behaviours come out of one function with a flag, and the published
comparison table is in the test suite as a table-driven case.

`XNPV` and `XIRR` discount on actual/365 through the same module rather than
subtracting serials themselves, so a dated schedule and a `YEARFRAC` on the same
two dates cannot disagree.

`TODAY` and `NOW` read a clock the host can replace:

```ts
import { setClock } from "recalc";

setClock({ now: () => Date.UTC(2026, 2, 4) });   // evaluate "as at" a date
```

Dates are formatted, not typed. A cell holding 46085 shows as a date because it
is wearing `yyyy-mm-dd`, which is the next section.

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
`*` fills, `@` for text, `[Red]`-style colours, `E+00` scientific codes, and the
date and time codes below. Fraction codes (`# ?/?`) are rejected with the offset
of the offending character rather than silently mis-formatted.

### Date and time codes

A section that contains a calendar field lays out a date instead of digits, and
the two never mix — `0yyyy` is refused, with the offset of the `y`.

```ts
formatWith("yyyy-mm-dd", 46081).text;            // "2026-02-28"
formatWith("dddd, d mmmm yyyy", 46081).text;     // "Saturday, 28 February 2026"
formatWith("mmm-yy", 46081).text;                // "Feb-26"
formatWith("h:mm AM/PM", 46081.5729).text;       // "1:44 PM"
formatWith("[h]:mm", 1.5).text;                  // "36:00" - not "12:00"
```

`y` `m` `d` `h` `s` widen with repetition: `m` is a bare month, `mm` pads it,
`mmm` and `mmmm` name it, `mmmmm` gives its initial; `ddd` and `dddd` name the
weekday. `m` is the one ambiguous code — it means minute next to an hour or a
second and a month everywhere else, which is decided after the whole section has
been read, because in `m:ss` only the `ss` says so. `AM/PM` (or `A/P`) puts the
hour on a 12-hour clock. The bracketed codes `[h]`, `[m]` and `[s]` are
durations: they accumulate rather than wrap, which is what makes a day and a
half print as `36:00`.

## Debt schedules

`PMT` gives the instalment. What a model is actually built on is the *split*:
how much of that instalment is interest and how much repays principal, period
by period.

```
=IPMT(0.09/12, 13, 360, 125000)          →  -931.10
=PPMT(0.09/12, 13, 360, 125000)          →   -74.68
=CUMIPMT(0.09/12, 360, 125000, 13, 24, 0) → -11135.23   (a year's interest)
=CUMPRINC(0.09/12, 360, 125000, 13, 24, 0) →  -934.11   (a year's principal)
```

The split is computed in closed form, not by walking the loan. After `k−1`
payments the outstanding balance is a future value, and the interest charged
next is the rate on that balance — so `IPMT` for period 300 costs the same as
for period 1, and its answer does not depend on how many other periods the
sheet happened to evaluate first.

The whole loan laid out is a schedule, from the shell or from the library:

```
> .amortise 250000 at 5.5%/12 over 360
    period    opening     payment    interest   principal    closing
         1     250000  -1419.4725  -1145.8333  -273.63917  249726.36
         2  249726.36  -1419.4725  -1144.5792  -274.89335  249451.47
         3  249451.47  -1419.4725  -1143.3192  -276.15328  249175.31
  … 354 more
       359  2819.5459  -1419.4725  -12.922919  -1406.5496  1412.9963
       360  1412.9963  -1419.4725  -6.4762329  -1412.9963          0
     total              -511010.1   -261010.1     -250000
```

The rate is written the way a term sheet writes it — an annual percentage over
the number of payments in a year — because dividing it by hand before typing is
exactly the step people get wrong. A balloon is a balance left at the end:

```
> .amortise 1000000 at 6%/4 over 20 balloon 400000
> .amortise 50000 at 5% over 10 into D1     # lay it into the sheet instead
```

Two details the schedule gets right. Each row's opening balance is the closed
form for that period rather than the previous row's closing balance, so a
360-row schedule does not accumulate its own rounding down the page. And the
final payment absorbs whatever residue is left, so the closing balance is
exactly `0` (or exactly the balloon) rather than a float a hair away from it —
which is also what a lender does, since the last instalment on a real loan is a
different number from the other 359.

Payments at the end of each period only. An annuity due settles interest and
principal in a different order, so those five columns would quietly mean
something else; `IPMT`, `PPMT` and `CUMIPMT` take a `type` argument and handle
it per period.

## Bonds

A bond is a schedule of coupons and a redemption, and its price is what those
are worth today. That would be a dull discounted cash flow except for one
thing: a bond is almost never bought on a coupon date. Settling between two
coupons makes the first discount period a fraction, and the seller is owed the
interest that accrued while they held it.

```
=PRICE(DATE(2008,2,15), DATE(2017,11,15), 0.0575, 0.065, 100, 2, 0)   →  94.634362
=YIELD(DATE(2008,2,15), DATE(2016,11,15), 0.0575, 95.04287, 100, 2, 0) →   0.065
=DURATION(DATE(2008,1,1), DATE(2016,1,1), 0.08, 0.09, 2, 1)            →   5.993775
=MDURATION(DATE(2008,1,1), DATE(2016,1,1), 0.08, 0.09, 2, 1)           →   5.735670
=ACCRINT(DATE(2008,3,1), DATE(2008,8,31), DATE(2008,5,1), 0.1, 1000, 2, 0) → 16.666667
```

Where settlement sits inside its coupon period is the whole problem, and the
coupon family answers it: `COUPPCD` and `COUPNCD` for the dates either side,
`COUPNUM` for how many coupons are left, and `COUPDAYBS`, `COUPDAYS`,
`COUPDAYSNC` for the position within the period on a chosen basis.

Three things the implementation is careful about.

**Coupon dates are generated backwards from maturity.** Counting forwards from
issue leaves the last period a stub, and a bond's last period is the one that is
never a stub — the final coupon is paid with the principal, on the day the bond
matures. Each date is derived from maturity directly rather than stepped from
the one before it, so a bond maturing on the 31st still pays on the 31st of
every long month instead of walking itself off month ends one February at a
time.

**`COUPDAYSNC` is derived, not measured.** The price formula divides both ends
by the period length and treats the results as a position in `[0, 1]`. Measuring
each end independently on a 30/360 basis lets that pair miss 1 by a day, and the
discount exponent then steps in a way nothing in the bond did. Subtracting makes
`COUPDAYBS + COUPDAYSNC = COUPDAYS` exact.

**The last coupon period prices differently.** With more than one coupon left,
each flow is discounted at the compounded periodic yield. With exactly one left
the market does not compound over a period it will not see: the single remaining
payment is discounted at simple interest, which is the convention every last
coupon period is quoted on. The two rules agree at the boundary, which is a
test.

## Blocks and spilling

Every function returned one value, which put a ceiling on what could be
written. `TRANSPOSE` had nowhere to put its answer, `A1:A3*2` was a `#VALUE!`
rather than three results, and a regression could produce a slope or an
intercept but never both. So a formula may now produce a block, and the sheet
lays it down across the cells below and to the right of the one it was entered
in.

```
=SEQUENCE(3)              in E1  ->  1, 2, 3 down E1:E3
=TRANSPOSE(A1:C2)         in E1  ->  the 2x3 range as a 3x2 block in E1:F3
=A1:A3*2                  in E1  ->  each of the three doubled, down E1:E3
=1/(1+Rate)^SEQUENCE(7,1,0,1)  ->  a whole discount curve from one formula
```

Only the anchor holds a formula. The rest of the block is derived: nothing was
typed into those cells, they carry no input, and none of them appears in the
edit history — so undoing the edit that created a block simply does not
recompute it, rather than having to unwind seven cells one at a time.

Three things the implementation is careful about.

**A block that does not fit writes nothing.** If any cell it needs is occupied,
the formula reports `#SPILL!` and names the cell in the way. The two
alternatives are both worse: overwriting destroys data the user typed, and
truncating the result to the space available reports a different answer from the
one that was computed. Clearing the obstruction makes the block appear without
the formula being touched, which needs a little machinery — a refused block
leaves no trace on the sheet, so nothing links it to its obstruction and the
dependency graph cannot walk from one to the other. The short list of refused
anchors is kept and retried on any edit.

**A block's footprint is not an edge in the graph.** A formula reading `C3` has
a dependency on `C3`, but whether `C3` holds anything at all can depend on the
*size* of a block three columns away — and that size is only known once the
block has been computed. One recalculation pass cannot see this. So a pass
records every cell a block covered or uncovered, and those cells are fed back as
a second wave of seeds; the pass repeats until nothing moves, bounded so a sheet
whose block sizes chase each other stops rather than grinding.

**The operators broadcast, and the shape rule is the whole of it.** A dimension
of one stretches to meet the other side and anything else is refused, so
`A1:A3*2` is elementwise and a 3x1 column against a 1x4 row gives the 3x4 outer
shape. Shapes that do not combine give one `#VALUE!` naming both, rather than a
plausible-looking grid padded with `#N/A` — padding hides the mistake inside the
answer. Where a single value is genuinely required, a block is still an error:
`ROUND(A1:A3, 0)` has nowhere to put three results.

The example sheet reaches its net present value twice, once through `NPV` and
once by summing a discounted column built from two spilled blocks. The two
agree to the cent, and the sheet says so.

## Linear algebra and regression

Blocks make the functions whose answer is a block reachable, and the ones worth
having are the fitting ones.

```
=MMULT(A1:B2, D1:E2)          the matrix product, spilled
=MINVERSE(A1:C3)              the inverse
=MDETERM(A1:C3)               the determinant
=MSOLVE(A1:C3, E1:E3)         A x = b, without forming the inverse
=LINEST(E1:E11, A1:D11)       five coefficients across one row
=LINEST(E1:E11, A1:D11, TRUE, TRUE)
                              a 5x5 block: coefficients, standard errors,
                              R-squared, the standard error of the estimate,
                              F, degrees of freedom, both sums of squares
=TREND(E1:E11, A1:D11, H1:K1) the fit evaluated at a new case
=SLOPE / =INTERCEPT / =RSQ / =STEYX / =CORREL / =COVARIANCE.S
```

Two decompositions, chosen separately.

**LU with partial pivoting backs the determinant, the inverse and the solve.**
Those functions are *defined* as those quantities, and LU computes them
directly. Pivoting is not optional: without it a perfectly well-conditioned
matrix with a zero in the corner fails outright, and one with a merely small
corner returns an answer with most of its digits gone.

**Householder QR backs the fit, and that is a different tool on purpose.** A
least-squares fit can be had from the normal equations in a few lines, and the
price is that forming `XᵀX` squares the condition number of the design matrix:
a regression on a column of years around 2000, or on any nearly collinear pair
of predictors, loses roughly twice the digits it needs to. QR works on the
design matrix itself and does not pay that. The standard errors come from the
same factorisation — the diagonal of `(XᵀX)⁻¹` is read off `R⁻¹` rather than by
inverting `XᵀX`, for exactly the same reason.

**A pivot is never tested against zero.** Elimination on a matrix that is
singular by inspection leaves a final pivot around `1e-16` rather than `0`, so
an exact test calls it invertible and then divides by rounding error. The
threshold scales with the size of the matrix and the size of the numbers in it,
which is what makes it mean the same thing for a matrix of units and a matrix
of millions.

Every regression function runs through one fit. `SLOPE`, `LINEST`, `TREND`,
`RSQ` and `STEYX` are five views of one computation rather than five
re-derivations, which is why the tests can check them against each other and
expect exact agreement rather than approximate.

From the shell, `.regress` lays the same fit out the way a summary is read
rather than the way `LINEST` returns it:

```
recalc> .regress E1:E11 by A1:D11
       term  coefficient  std error           t
  intercept    52317.831  12237.362   4.2752541
          A    27.641387   5.429374   5.0910818
          B    12529.768  400.06684   31.319187
          C    2553.2107  530.66915   4.8113041
          D   -234.23716  13.268011  -17.654278

        observations          11
          predictors           4
  degrees of freedom           6
           r squared  0.99674799
  adjusted r squared  0.99457999
      standard error   970.57846
                   f   459.75367
```

Adjusted R-squared sits beside the raw one because the raw one can only go up
as columns are added, and on its own says nothing about whether the column was
worth including.

## What-if analysis

A model's single number is the least interesting thing about it. The two
questions worth asking of one are *what input gets me this output* and *how
does the output move as the input moves*, and both are the same primitive: run
the sheet with a cell temporarily holding something else, read a result, put
the sheet back.

```ts
import { Workbook, goalSeek, twoWayTable, series } from "recalc";

const book = new Workbook();
book.setCells({
  B1: 30,       // price
  B2: 1000,     // units
  B3: 18,       // unit cost
  B4: 8000,     // fixed cost
  B6: "=(B1-B3)*B2-B4",
});

goalSeek(book, { target: "B6", to: 0, changing: "B1" });
// { converged: true, value: 26, achieved: 0, startedFrom: 30, evaluations: 4 }

twoWayTable(book, {
  rowInput: "B1", rowValues: [25, 30, 35],
  columnInput: "B2", columnValues: series(500, 2000, 4),
  result: "B6",
}).grid;
// [[-4500, -1000,  2500,  6000],
//  [-2000,  4000, 10000, 16000],
//  [  500,  9000, 17500, 26000]]
```

Nothing above touches the sheet. `Workbook.trial` writes the overrides,
suspends journalling, runs the body and restores the original input in a
`finally`, so a body that throws cannot leave a trial value behind and the undo
history never sees any of it. `applyGoalSeek` is the one function that commits,
and it writes one undoable edit.

**Goal seek says why it failed.** A search that grinds through four hundred
recalculations and reports non-convergence looks identical, from the outside,
to one where the target never read the changing cell — and those call for
completely different responses. The graph can tell them apart, so it is asked
first:

```
recalc> .goalseek B6 = 0 by B1
  B1 = 26  (not applied - add `apply` to write it)
  B6 reaches 0 from 30 in 4 recalculation(s)

recalc> .goalseek B6 = 0 by B5
  B5 holds a formula; goal seek can only vary a cell that holds a value

recalc> .goalseek B6 = 0 by A9
  B6 does not depend on A9, so changing it cannot move the result
```

The last one costs zero recalculations. It is a fact about the graph, not a
search that gave up.

**Tables take an axis, not a list.** `20..40/5` is five points across a span,
`30~5/7` is seven points centred on a base case, and a comma list is exactly
what it says — including text, so a scenario switch spelled `grow` sits in an
axis beside a rate:

```
recalc> .table B6 by B1 = 25,30,35 x B2 = 500..2000/4
  B6    500   1000   1500   2000
  25  -4500  -1000   2500   6000
  30  -2000   4000  10000  16000
  35    500   9000  17500  26000

recalc> .table B5,B6 by B1 = 30~5/3 into D1
  12 cell(s) written at D1
```

A written table lands as literals rather than formulas: it is a record of what
the model produced under those inputs, and re-deriving it later from a sheet
that has moved on would make it silently wrong.

## Scenarios

A sensitivity table moves one input, or two. A real case moves a dozen at once
— the downside is not "price 10% lower", it is lower price *and* slower ramp
*and* higher cost of capital, together, because the things that go wrong go
wrong in company.

```
recalc> .scenario Base = B1:B3
  captured Base from 3 cell(s)
recalc> .scenario Downside = B1=25, B2=700, B3=20
  Downside: 3 assumption(s)
recalc> .scenario Upside = B1=34, B2=1400, B3=17
  Upside: 3 assumption(s)

recalc> .summary B4,B6:B8
        current   Base  Downside  Upside
  B4 =     8000   8000      8000    8000
  B6      30000  30000     17500   47600
  B7       4000   4000     -4500   15800
  B8         go     go        no      go
  rows marked = are the same under every scenario
```

Every column of that summary is a trial, so the sheet is not touched and the
columns cannot influence one another — which matters more than it sounds,
because a summary computed by applying each scenario in turn would report every
column against the leftovers of the one before it.

A scenario stores *inputs*, so `B4==B2*10` is an assumption like any other:
"fixed cost, but tied to volume" is a case worth comparing, and a scenario that
could only hold numbers could not express it.

Three decisions worth naming:

**Scenarios live beside the sheet, not in it.** Applying one is an ordinary
edit and belongs in the undo journal; *defining* one is not an edit at all, and
journalling it would mean undo silently forgetting scenarios.

**Capture comes first.** Without a captured base case there is no way back
after applying anything, and a feature you cannot reverse is a feature nobody
tries.

**A conflict is reported before the write, not after.** A scenario captured
while a cell held a number, applied after that cell has become a formula,
destroys the formula and looks like nothing happened:

```
recalc> .apply Flat
  applied Flat to 1 cell(s)
  overwrote 1 formula(s): B7
```

Because scenarios are not part of the sheet, a structural edit cannot move them
on its own — left alone, a scenario captured against `B7` would quietly start
setting whatever landed at `B7` afterwards. `ScenarioSet.adjust` moves them by
the same rule the formulas and names move by, and the shell calls it on every
structural edit.

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

A formula whose answer is a block spills it across the cells beside it, and the
grid says so: the block is outlined while the selection is anywhere inside it,
its cells carry the same faint wash as any other computed cell, and selecting
one leaves the formula bar empty rather than inviting an edit in the wrong
place — the note beside it names the cell the value came from, and the
inspector makes that a chip you can click. The example sheet ships with two
blocks, a discount curve and a discounted cash flow column, each written once.

The **Format** menu applies a number format to the selection. Each choice is
previewed against the number in the selected cell rather than against a stock
figure, because "Millions" means nothing beside a capital outlay until it reads
`-2.4M`; the format already in effect is ticked, and a selection whose cells
disagree ticks nothing. A format's `[Red]` section is honoured on the grid, so
a negative in an accounting format arrives in parentheses and in red.

### What-if in the grid

The sidebar holds two panels and shows one. The inspector follows the
selection; the what-if forms do not, which is why they are tabs rather than
something stacked — they are two states of the same space. Switching is a
`hidden` toggle with no transition, because it is a control someone presses
dozens of times an hour and an animation on it would be slower on the twentieth
press than on the first.

Three modes sit behind it. **Goal seek** takes a result, a goal and an input,
prefilled from the selection, and solves without applying unless the second
button is pressed. **Sensitivity** builds a one-way or crossed table in the
panel, or writes it into the sheet at the selection. **Scenarios** captures the
selected cells under a name, lists what is defined, applies one, and summarises
them all side by side.

Two details the panel gets right and most would not:

**A refusal about the graph is not an error.** "This result does not depend on
that input" is a true and useful answer, so it is shown on the panel's ordinary
surface with a rule down the side. Dressing it in the same red as a mistyped
address would teach people to ignore both.

**Prefill only touches empty fields.** Someone who typed `B12` and then clicked
a cell to read a value off the grid has not asked for their form to be
rewritten, and a panel that helpfully undid their typing would be worse than
one that did nothing at all.

Structural edits made from the grid move the scenarios with the sheet, the same
way the shell does.

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
`.cycles`, `.spill A1`, `.fns`, `.help FN`, `.demo`, `.clear`, `.reset`; for names
`.name Revenue = B2:B13`, `.names`, `.unname Revenue`; for blocks
`.filldown B1:B9`, `.fillright B2:F2`, `.copy A1:C3`, `.paste D5`, `.undo`,
`.redo`; for rows and columns
`.insertrow 3 [n]`, `.deleterow 3 [n]`, `.insertcol C [n]`, `.deletecol C [n]`;
for number formats `.format B2:B13 = #,##0.00`, `.format B2`, `.formats`; for
what-if `.goalseek B6 = 0 by B1 [apply]` and
`.table B6 by B1 = 20..40/5 [x B2 = 500..2000/4] [into D1]`; for scenarios
`.scenario Base = B1:B3`, `.scenario Down = B1=25`, `.scenarios`,
`.apply Down`, `.unscenario Down`, `.summary B6:B8`; for a fit
`.regress E1:E11 by A1:D11 [through zero]`; and for CSV
`.csv [formulas|display]`, `.import data.csv [A1]`,
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
npm run bench:whatif # goal seek and sensitivity table measurements
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
- `LINEST` reproduces every figure of the published multiple-regression worked
  example — a valuation of eleven office buildings on four predictors: five
  coefficients, five standard errors, R-squared, the standard error of the
  estimate, F, degrees of freedom and both sums of squares.
- `MINVERSE(A)` multiplied back by `A` gives the identity, and `MDETERM` matches
  cofactor expansion, is multiplicative, and changes sign on a row swap.
- The pack is checked against itself where it is supposed to agree exactly:
  `LINEST` on one predictor equals `SLOPE` and `INTERCEPT`, `RSQ` equals
  `CORREL` squared, the two sums of squares add to the total, and `F` is the
  ratio the degrees of freedom imply.
- The QR fit recovers a slope of exactly 0.25 from a design matrix of years
  around 2000, where the normal equations would lose most of their digits.

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

`npm run bench:whatif` measures the same claim from the analysis side. The same
10x10 sensitivity grid over the same model, with 0, 10,000 and 50,000 unrelated
cells sitting beside it:

```
shape                                       recalcs  total ms  ms each
10x10 over depth 50, 0 idle cells               100      26.9    0.269
10x10 over depth 50, 10000 idle cells           100      26.3    0.263
10x10 over depth 50, 50000 idle cells           100      29.0    0.290
10x10 over depth 200, 50000 idle cells          100     115.4    1.154
25x25 over depth 50, 50000 idle cells           625     149.6    0.239
```

Flat as the sheet grows around the model, and proportional to the model's own
depth — which is what makes a grid of several hundred points a table rather
than a wait.

## Known gaps

- No CI is configured, so the suite and the benchmark run locally only.
- Implicit intersection is not implemented. A block in a position that needs
  one value is `#VALUE!` rather than a silent pick from the calling row.
- A block cannot be entered over a range the way a legacy array formula was.
  Spilling from a single anchor is the only form.
- `SORT`, `FILTER` and `UNIQUE` are not implemented; the block-producing
  functions are `SEQUENCE`, `TRANSPOSE`, `TOROW`, `TOCOL` and the matrix and
  regression packs.
- `LINEST` refuses linearly dependent predictors rather than dropping columns
  to the rank of the design matrix, which is what a rank-revealing
  factorisation would allow.
- There is no t or F distribution, so `.regress` reports each t statistic and
  the F but not a p value for either.
- `LOGEST` and `GROWTH`, the exponential counterparts of `LINEST` and `TREND`,
  are not implemented.
- Omitted arguments (`IF(A1,,2)`) are a parse error.
- Only one sheet; there are no cross-sheet references.
- Scenarios are not serialised: they live for the length of a session, and CSV
  has nowhere to put them.
- Fraction format codes (`# ?/?`) are rejected rather than supported: the
  rational approximation they need has nothing to do with the digit machinery
  the rest of the compiler is built from.
- Sub-second format codes (`ss.00`) are not supported, and neither is ISO week
  numbering — `WEEKNUM` counts the week holding 1 January as week 1.
- A date is recognised by the format on its cell, not by what was typed: an
  entered `2026-03-04` is text until `DATEVALUE` turns it into a serial.
- A format belongs to a cell, not to a row, a column or the sheet, so
  formatting a whole column means selecting it and applying the format to the
  cells in it.
- CSV carries no formats: an export in `display` mode writes what the sheet
  shows, but that text does not read back in as the same numbers.
- A debt schedule is built for payments at the end of each period; an annuity
  due is available per period through `IPMT` and `PPMT` but not as a table.
- Bond coupon schedules follow the day of the month maturity falls on, with no
  end-of-month rule: a bond maturing on 28 February pays on the 28th, not on
  the month end, of every other period.
- `ACCRINT` accrues from issue to settlement as one span rather than summing
  quasi-coupon periods. The two agree on the 30/360 bases and can differ by a
  day's interest on the actual ones.
- Names can only be defined from the library or the shell, not from the grid.
- Reference highlighting outlines only references written out in the formula.
  A name is underlined in the formula bar and resolved in the inspector, but
  the cells behind it are not outlined on the grid.

## License

MIT
