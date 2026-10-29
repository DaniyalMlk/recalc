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

**[The engine running in a browser](https://daniyalmlk.github.io/recalc/)**, with
the evidence table below it. The grid on that page imports the engine from
source, so what recalculates there is what recalculates here.

## Status

Every phase in [ROADMAP.md](ROADMAP.md) is complete: the formula grammar, the
reference model, the dependency graph, the evaluator, a function library of 205
functions including financial, date, amortisation, bond, matrix, regression,
distribution, inference and table packs, day-count
conventions, debt schedules, CSV interchange, named ranges, a
benchmark harness, structural editing that rewrites every formula in the sheet
when rows and columns move, block editing with fill, clipboard and undo, number
formats that follow their cells through every one of those operations, array
values that spill a formula's block across the sheet, dense linear algebra and
least-squares regression, what-if
analysis with goal seek, sensitivity tables and named scenarios, and a web
interface where all of it is reachable from a virtualised grid — the analysis
included.

## What is checked, and against what

A recalculation engine is easy to describe and hard to believe: every one of
them says an edit costs what depends on it rather than the size of the sheet.
So here is what was measured. Every figure is produced by `npm run evidence`,
which runs in CI and exits non-zero if any of them moves:

| Check | Result |
| --- | --- |
| An edit with nothing downstream of it, as the sheet around it grows | 1 cell evaluated in all of 2,000, 20,000, 100,000 cells — the edited cell itself and nothing else |
| One edit at the head of a chain, at the root of a fan-out, and under three aggregates | 5,000, 5,001 and 4 cells evaluated — the aggregates do not walk their 10,000-cell range |
| Cells the engine evaluated, against the cells its own graph says depend on the edit | exact agreement over 4 shapes, the edited cell included |
| `STDEV.P` over the textbook set {2,4,4,4,5,5,7,9} | exactly 2, not 2 to within a tolerance |
| `LINEST` on one predictor against `SLOPE` and `INTERCEPT`, and `RSQ` against `CORREL` squared | 0 in the slope and the intercept; below 1e-15 in R-squared |
| A 360-month loan of 200,000 paid off at the instalment `PMT` returns | below 1e-6, of the 200,000 it started at, after every payment — a relative residue under 1e-13 |
| `MINVERSE(A)` multiplied back by `A`, against the identity matrix | below 1e-14, in every entry |
| `COUPPCD` and `COUPNCD` against a published transcript of a reference spreadsheet, over month ends and the days either side of them | exact agreement on all 24 cases — 4 month ends under the end-of-month rule and 20 neighbours that must stay off it |
| The accrual `ACCRINT` sums over quasi-coupon periods against `YEARFRAC` over the same span, on the three bases where the two must agree | below 1e-15 over 6,540 cases — and past 2% on the two bases where they must not, which is why the agreement is a check |

**The cost rows are counts, not durations.** Milliseconds are a statement about
the machine they were measured on and can be asserted nowhere else — which is
why the timings further down are still labelled as one run on one box. The
number of cells an edit forces the engine to recompute is a property of the
algorithm, identical everywhere, and it is the thing the design is actually
betting on. As a timing, "flat as the sheet grows" is a shape on a chart; as a
count it is 1, 1 and 1 in sheets of 2,000, 20,000 and 100,000 cells.

**The engine is checked against its own graph, not only against itself.** The
workbook now reports how many cells a mutation evaluated, which until recently
it computed and discarded. That matters because the dependency graph is the
engine's *prediction* of the work it will do, and the count is a record of what
it did: an engine that re-evaluated a whole sheet while its graph reported
three dependents would look identical from the outside and be wrong in exactly
the way that matters. The two agreeing over four shapes is a row of its own.

The gate was checked by breaking the thing it guards. Making one call site
recalculate from every cell instead of from the edited ones — the regression
the whole design exists to avoid — fails three of the eight rows and takes the
isolated-edit row from 1 evaluated cell to 100,001.

**One row's reference is not this package.** Every other row above compares the
engine with arithmetic the engine is made of, which is the right way to check a
calculation and no way at all to check a *convention*: a bond schedule built on
the wrong rule still closes its periods, still counts its coupons, and still
satisfies every identity the module can state about itself. The coupon row is
checked against a transcript of another implementation's output instead, and
half of its cases are there to say where the end-of-month rule stops rather
than that it exists — a rule applied one day too widely passes a table of month
ends alone and fails two of these.

**An agreement no input could violate is not a check.** The accrual row says
two things, and the second is what makes the first worth printing: the summed
form comes back to `YEARFRAC` on the three bases whose coupon periods are all
one length, and departs from it by more than 2% on the two where they are not.
A row that reported only the agreement would be satisfied by an `ACCRINT` that
had never been changed.

**An identity says zero; a residue gets a bound.** `STDEV.P` over the textbook
set is 2 exactly, and on one predictor `LINEST` is not a second opinion about
`SLOPE` but the same arithmetic reached another way, so both say zero and a
tolerance there would hide a real regression. The amortisation and matrix rows
are floating-point residue and publish bounds instead, since the digits of a
residue are not portable. A coupon date is neither: it is a day, so its row is
a count of cases rather than a tolerance.

## Installing it

```bash
npm install recalc-formula
```

**The package is `recalc-formula`, not `recalc`.** `recalc` on npm is an
unrelated package, so the distribution name differs; the command line is still
called `recalc`, and so is this repository. Node 20.19 or newer. The package
ships compiled JavaScript and type declarations and has no runtime
dependencies.

```bash
npx recalc        # the REPL
```

## Using it as a library

```ts
import { Workbook } from "recalc-formula";

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
import { setClock } from "recalc-formula";

setClock({ now: () => Date.UTC(2026, 2, 4) });   // evaluate "as at" a date
```

Dates are formatted, not typed. A cell holding 46085 shows as a date because it
is wearing `yyyy-mm-dd`, which is the next section.

## Number formats

A format code is compiled once into digit positions, literals and up to four
sections, then applied to values as often as needed:

```ts
import { formatWith, parseFormatCode, applyFormat } from "recalc-formula";

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
fraction, date and time codes below.

### Fraction codes

A fraction code lays out a whole part, a numerator and a denominator instead of
digits around a point, and the number it needs is a rational approximation
rather than a rounded decimal:

```ts
formatWith("# ?/?", 1.75).text;        // "1 3/4"
formatWith("# ??/??", 3.14159).text;   // "3 14/99"
formatWith("# ???/???", 3.14159).text; // "3  16/113"
formatWith("?/?", 1.75).text;          // "7/4"  - improper
formatWith("# ?/8", 1.3).text;         // "1 2/8"
```

Written as digit positions, the denominator is *bounded*: `# ??/??` asks for
the closest fraction whose denominator has at most two digits. That is a
different question from truncating the decimal expansion, and it has a
different answer — 0.3 under `# ?/?` is `2/7`, because `3/10` does not fit in
one digit and `1/3` is more than twice as far away. The search is a
continued-fraction expansion with the semiconvergents considered, which is what
makes it the closest fraction and not merely a close one; the exhaustive scan
that answers the same question is in the tests, as the reference.

Written as a literal, the denominator is *fixed*: `# ?/8` names eighths, so a
third renders as `3/8` and is left unreduced, because a format asking for
eighths is answered in eighths. The overlap is `0`, and it goes with the rest
of its run — the zero of `/10` is part of ten, the zero of `/00` is a place to
put a digit.

Three details make a column of them readable. The numerator pads on its left
and the denominator on its right, so the bar sits in the same place on every
row — that is the whole reason `?` exists alongside `0` and `#`. A fraction
that rounds up to a whole carries, so 0.99 in eighths is `1` and not `8/8`;
an improper code has no whole part to carry into, which is the point of it.
And a numerator that rounds away takes the fraction with it but leaves the
width behind, so a row holding a whole number still lines up with its
neighbours.

Whether a `/` starts a fraction depends on what surrounds it: digit positions
on the left and a denominator on the right. A lone one is a separator, which is
what keeps `d/m/yyyy` a date.

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
=ACCRINT(DATE(2008,3,1), DATE(2008,8,31), DATE(2008,5,1), 0.1, 1000, 2, 1) → 16.576087
```

Where settlement sits inside its coupon period is the whole problem, and the
coupon family answers it: `COUPPCD` and `COUPNCD` for the dates either side,
`COUPNUM` for how many coupons are left, and `COUPDAYBS`, `COUPDAYS`,
`COUPDAYSNC` for the position within the period on a chosen basis.

Five things the implementation is careful about.

**Coupon dates are generated backwards from maturity.** Counting forwards from
issue leaves the last period a stub, and a bond's last period is the one that is
never a stub — the final coupon is paid with the principal, on the day the bond
matures. Each date is derived from maturity directly rather than stepped from
the one before it, so a bond maturing on the 31st still pays on the 31st of
every long month instead of walking itself off month ends one February at a
time.

**A month-end maturity anchors the whole schedule to month ends.** Maturity
alone decides the rule. Inside its month, a maturity keeps its day of the month
and clamps where the target month is short: a bond maturing on the 30th pays on
the 30th, and on the 28th or 29th of a February. *On* its month's last day, it
pays on month ends — 28 February pairs with 31 August, not with 28 August,
which is the convention a month-end bond is issued under and the one
`YEARFRAC` basis 0 already assumes when it makes that pair a clean 180 days.

Without that second rule, clamping gets a maturity on the 31st right by
accident — 31 clamped into a 30-day month is that month's end — and every other
month end wrong, so two bonds both maturing on a month end would be scheduled
under two conventions chosen by which month it happened to be. Only one basis
can see the difference in a price: actual/actual is the only one that measures
the coupon period it is in, and on the rest the period length is a constant, so
a wrong next coupon date shows up in `COUPNCD` and nowhere else.

**`COUPDAYSNC` is derived, not measured.** The price formula divides both ends
by the period length and treats the results as a position in `[0, 1]`. Measuring
each end independently on a 30/360 basis lets that pair miss 1 by a day, and the
discount exponent then steps in a way nothing in the bond did. Subtracting makes
`COUPDAYBS + COUPDAYSNC = COUPDAYS` exact.

**An accrual is broken at every quasi-coupon date it crosses.** Interest
between two dates that are not coupon dates is still quoted as a fraction of a
coupon period — so many days of a period that is so many days long — so a
stretch that crosses one of the dates a coupon *would* fall on crosses into a
period of a different length, and the two pieces cannot share a denominator.
`ACCRINT` sums them instead, which is what makes its first-interest date matter:
that date is what anchors the periods. Moving it over a 1 March to 1 May
accrual spans 16.576 to 16.758 on actual/actual, 1.1% of the figure, with
nothing else changed.

Which bases that moves is not the obvious half. Actual/360, actual/365 and
30/360 European divide by a constant period length and count days additively,
so the pieces telescope back to one span exactly — a residue below 1e-15 over a
6,540-case sweep. Actual/actual is the only basis that measures the period it is
in, and runs −0.82% to +2.53% of the single span. 30/360 US moves too, for an
unrelated reason: it is the one basis whose day count is not a property of the
stretch alone, since it pulls a 31st back to a 30th only when the other end is
already at 30, and treats a February month end as a 30th. Splitting a span
there changes the total in 188 of those 6,540 cases, by −4 to +1 days.

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

## An argument written as nothing

`=IF(A1,,2)` is ordinary spreadsheet writing, and so are `=ROUND(1.5,)` and
`=SUM(,1)`. An argument written as nothing is not a missing argument: it is a
**blank**, which this engine already has as a value, so the whole of it is a
node the parser can produce where it used to fail.

```
=IF(A1,,2)       three arguments, the middle one blank
=SUM(1,)         two arguments, the second blank — not one argument
=SUM()           no arguments at all, which is still an error for SUM
```

What that buys is that nothing else had to be told. A gap behaves exactly as a
reference to an empty cell would, across the whole function surface — sixteen
pairs of formulas, one written with a gap and one pointing at an empty cell,
are asserted to agree in value and in display. `IF` coerces a blank condition
to false; `AND` and `OR` *skip* a blank rather than reading it as false, which
is how they already behave over a range with empty cells; `ROUND`'s digit count
takes the zero a blank coerces to.

A gap is **not** the same as leaving the argument out, and the difference shows
where a function's default is not the blank's coercion: `VLOOKUP`'s fourth
argument defaults to TRUE, so `=VLOOKUP(25,F1:G3,2)` finds the approximate
match and `=VLOOKUP(25,F1:G3,2,)` asks for an exact one and gets `#N/A`.

Arity still counts the gaps, so `=IF(,,,)` passes four arguments and is refused
for it, and printing puts nothing back where nothing was written — `IF(A1,,2)`
prints as itself rather than as `IF(A1,0,2)`, which is what an editor needs.

## Sorting, filtering and deduplicating a table

`SEQUENCE` and `TRANSPOSE` exist because they make the spill path reachable —
one builds a block from nothing, one reshapes an existing one. These four exist
because they are what someone writes on their own data.

```
=SORT(A1:C20, 3, -1)        the table by its third column, largest first
=SORTBY(A1:C20, E1:E20)     the same table ordered by a column outside it
=SORTBY(A1:C20, D1:D20, 1, E1:E20, -1)   second key breaks the first's ties
=FILTER(A1:C20, C1:C20>100) the rows where the third column clears 100
=FILTER(A1:C20, C1:C20>100, "none")      with something to show if none do
=UNIQUE(A1:B20)             the distinct rows, first appearance kept
=UNIQUE(A1:A20, FALSE, TRUE)             only the values appearing once
```

All four work on whole lines rather than cells — sorting a table by its third
column has to carry the other columns along, and the distinct values of a table
are its distinct rows. Each is written once over a list of lines and run either
on the rows or on the transpose, so `by_col` costs a transpose rather than a
second implementation. The sort index counts across a line, which means it
names a column when sorting rows and a row when sorting columns: on a 4x3 block
the bound is 3 one way round and 4 the other.

**A sort is stable, and that is this function's promise rather than the host's.**
`Array.prototype.sort` is specified as stable, but the guarantee here is that a
later key speaks only where every earlier one ties and that lines tied on all of
them keep their input order — so the original position is the final tiebreaker
and the comparison never has to rely on what the runtime does with equal
elements. Descending reverses the keys and not the ties.

**Order and equality come from the engine, not from these functions.**
`compareValues` is what `<` and `=` are built on, so `SORT` agrees with the
sheet that `"a"` and `"A"` are the same text and `UNIQUE` agrees with it about
what a blank cell is. A `localeCompare` or an `includes` here would be a second
notion of equality living next to the first.

That inheritance has a consequence worth knowing. The sheet's equality is **not
transitive**: a blank cell takes the type of whatever it is compared with and
that type's zero, so a blank equals `0` and a blank equals `""` while `0` and
`""` are not equal to each other — `=(A1=A3)`, `=(A2=A3)` and `=(A1=A2)` report
TRUE, TRUE and FALSE on exactly that triple. No hash can represent a
non-transitive equivalence, which is why `UNIQUE` compares each line against
every line it has already kept instead. The visible effect is that `UNIQUE` over
a blank, a `0` and an empty string answers with two lines or with one depending
on which of them arrives first, and that is the comparison rules showing
through rather than a defect.

**An empty answer is `#CALC!`.** A `FILTER` nothing matches, and a
`UNIQUE(..., TRUE)` over a list with no singletons, have no lines to return. A
block with no lines has no cell to anchor it, so there is nowhere on the sheet
for the result to be, and a blank would be a wrong answer rather than no
answer — the question was answered with none. `FILTER`'s third argument
overrides it with something to show. Like `#SPILL!`, `#CALC!` is produced by the
engine rather than typed, so neither is in the set of error literals a formula
can write.

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

**A dependent column is dropped, not refused.** Someone who includes a total
and both its parts, or the same series in two units, has handed over a design
matrix whose columns are not independent. That leaves the *coefficients*
undetermined — infinitely many vectors give the same fit — but it does not
touch the *fitted values*, which are the projection of `y` onto the column
space and are the same however the space is spanned. So the fit is reported
over a basis: the columns outside it carry the zero they contribute, their
standard error is `#N/A` rather than a zero that would read as measured and
exactly nothing, and adding such a column changes the residual sum of squares
and the R-squared by exactly zero.

Which column goes is the order they were written in — the earlier of a
dependent pair survives. That is a choice and not an arithmetic fact: in a
total and its two parts, each column is a combination of the other two, and
making the order decide puts the choice with the person who wrote it.

**The degrees of freedom then have to come from the rank**, and this is the
part that is easy to get wrong quietly. A dropped column costs no degree of
freedom, and that number divides into every standard error, every t, the F
statistic and its significance. Taking it from the columns handed in instead
multiplies every reported error by the square root of the ratio of the two
counts — 11.8% on an eight-observation fit that loses one of four columns, in
the direction that looks conservative. The coefficients would be perfectly
right and everything beside them wrong.

**`LOGEST` and `GROWTH` are the same fit with a transform either side.**
`y = b · m₁^x₁ · m₂^x₂ · …` becomes a plain multiple regression once both sides
are logged, so these are the linear pair with the log taken on the way in and
the exponential on the way out — not a second fitting routine. `LOGEST` is the
exponential of `LINEST` on the logged outcome, bit for bit, and `GROWTH` the
exponential of `TREND` on it. Everything in a `LOGEST` statistics block below
the first row is the log-space fit's, untouched: the standard errors are the
errors on the *exponents*, on `ln m` rather than on `m`, and exponentiating one
does not give the other.

```
=LOGEST(B1:B6, A1:A6)         the multiplier and the constant, across one row
=GROWTH(B1:B6, A1:A6, 7)      the curve at a point the data does not cover
```

**That transform changes what is being minimised, and the change is the
interesting part.** Least squares on `ln y` makes every residual a *ratio*
rather than a difference, so a point predicted at half its value counts the
same whether the value is 2 or 2,000,000. The curve `GROWTH` draws therefore
has the smallest squared *relative* error, and it is **not** the exponential
with the smallest squared error in `y`. Those are two different curves, and how
different depends on the spread of the outcome. Measured against a search for
the absolute optimum:

| outcome spans | fitted curve's squared error in `y` | absolute optimum's squared error in `ln y` |
| --- | --- | --- |
| under 2x | within 1% of the optimum | within 1% |
| about 7x | 8% worse | 11% worse |
| about 100x | 12.7 times worse | 38.8 times worse |

Each wins decisively on its own criterion once the data has any spread in it.
Which one is wanted depends on the question — a forecast judged in percentage
terms wants the relative fit, which is what spreadsheets have always given —
but "the best-fitting exponential" without qualification names the wrong curve.
A non-positive outcome is refused rather than dropped, since dropping it would
answer a different question with nothing to show that it had.

From the shell, `.regress` lays the same fit out the way a summary is read
rather than the way `LINEST` returns it:

```
recalc> .regress E1:E11 by A1:D11
       term  coefficient  std error           t         p
  intercept    52317.831  12237.362   4.2752541  0.005233
          A    27.641387   5.429374   5.0910818  0.002241
          B    12529.768  400.06684   31.319187   7.04e-8
          C    2553.2107  530.66915   4.8113041  0.002966
          D   -234.23716  13.268011  -17.654278   2.12e-6

        observations          11
          predictors           4
  degrees of freedom           6
           r squared  0.99674799
  adjusted r squared  0.99457999
      standard error   970.57846
                   f   459.75367
      significance f     1.37e-7
```

Adjusted R-squared sits beside the raw one because the raw one can only go up
as columns are added, and on its own says nothing about whether the column was
worth including.

The p column is the same reasoning applied to each term. A t of 4.28 is
significant at the 1% level on six degrees of freedom and is not on two, and a
statistic that has to be looked up in a table is half an answer. The
significance of the F is the question to ask *first*, though: each per-term
p-value asks about one predictor with the others held in the model, and with
enough predictors one of them clears any threshold by chance, whereas the F
asks whether the fit as a whole is worth anything.

## Statistical distributions

Eleven families, and underneath them two integrals.

```
=NORM.DIST(x, mean, sd, cumulative)     =NORM.INV(p, mean, sd)
=NORM.S.DIST(z, cumulative)             =NORM.S.INV(p)
=T.DIST(t, df, cumulative)              =T.INV(p, df)
=T.DIST.RT(t, df)                       =T.INV.2T(p, df)
=T.DIST.2T(t, df)
=CHISQ.DIST(x, df, cumulative)          =CHISQ.INV(p, df)
=CHISQ.DIST.RT(x, df)                   =CHISQ.INV.RT(p, df)
=F.DIST(x, df1, df2, cumulative)        =F.INV(p, df1, df2)
=F.DIST.RT(x, df1, df2)                 =F.INV.RT(p, df1, df2)
=GAMMA.DIST / =GAMMA.INV / =GAMMA / =GAMMALN
=BETA.DIST / =BETA.INV                  (optionally over an interval)
=LOGNORM.DIST / =LOGNORM.INV / =EXPON.DIST / =WEIBULL.DIST
=BINOM.DIST / =BINOM.INV / =POISSON.DIST
=HYPGEOM.DIST / =NEGBINOM.DIST
=PHI / =GAUSS / =STANDARDIZE
```

**Every family is written on the same two special functions.** The regularised
incomplete gamma `P(a, x)` carries the normal, chi-squared, gamma, Poisson and
exponential; the regularised incomplete beta `Iₓ(a, b)` carries Student's t, F,
beta, binomial and negative binomial. That is not economy for its own sake. It
is the only arrangement in which the identities between the families hold to
the last bit rather than to the accuracy of eleven separate approximations:
`F.DIST.RT(t², 1, v)` is *exactly* `T.DIST.2T(t, v)` here, and
`CHISQ.DIST(z², 1)` is exactly `2·NORM.S.DIST(z) − 1`, because both sides are
the same call.

**Each integral is evaluated by whichever expansion converges where the
argument lies.** The series for `P(a, x)` loses every digit it has to
cancellation once `x` is much larger than `a`; the continued fraction stalls
for small `x`. The crossover at `x = a + 1` puts each comfortably inside its
own region. The number of terms the series needs grows like `√a`, so its
iteration cap grows with it — a fixed cap does not fail on exotic input, it
fails silently in the *middle* of a large distribution, and returns a partial
sum that still looks like a probability.

**A right tail is computed as a right tail.** `T.DIST.RT`, `CHISQ.DIST.RT` and
`F.DIST.RT` are not `1 −` the cumulative. For `t = 30` on a hundred degrees of
freedom the answer is `4.2e-52`, the cumulative is one to every bit a double
has, and the subtraction gives exactly zero. The same applies in reverse to the
inverses: `CHISQ.INV.RT(1e-10, 10)` inverts the survival function directly,
because `1 − 1e-10` is a double that pins the tail down to seven digits rather
than sixteen.

**And where a caller knows a complement exactly, it passes it.** Student's t
reaches the incomplete beta at `x = v / (v + t²)`, whose complement is
`t² / (v + t²)` — the same two numbers, divided the other way. Letting the
function recover `1 − x` by subtraction instead throws that away: at `t = 0.0125`
on a million degrees of freedom, `x` is `1 − 1.6e-10`, and a double stores it
with sixteen digits of absolute room, leaving six in the part that carries all
the information. So the complement is a parameter, and nothing is ever
reconstructed.

Densities are computed in logs and exponentiated once, which is what keeps
`BINOM.DIST(500000, 1000000, 0.5, FALSE)` — a coefficient far past the largest
double, multiplied by two vanishing powers — representable at every step on the
way to an answer near `8e-4`.

### Hypothesis tests

```
=T.TEST(A1:A9, B1:B9, tails, type)   1 paired, 2 equal variance, 3 Welch
=F.TEST(A1:A9, B1:B9)                do the two samples share a variance
=CHISQ.TEST(observed, expected)      independence, over two blocks
=Z.TEST(A1:A9, mu, [sigma])          a sample mean against a hypothesis
=CONFIDENCE.NORM(alpha, sigma, n)    half-width of an interval
=CONFIDENCE.T(alpha, sigma, n)       and when the spread is estimated
```

**`CHISQ.TEST` takes its degrees of freedom from the shape of the blocks, not
from how many cells they hold.** A 2×2 contingency table has one degree of
freedom, because fixing the margins fixes that many cells; the same four
numbers laid out as a single row are a goodness-of-fit test with three.
Counting cells would give three in both cases, and would be wrong for every
table that is not a strip.

**Welch's degrees of freedom are not rounded.** The Satterthwaite
approximation almost never lands on a whole number, and rounding it is a habit
inherited from printed tables, which could only be indexed by integers. It
moves the p-value in the third digit for no reason once the distribution can be
evaluated at any real degrees of freedom.

From the shell, `.ttest` runs the comparison with the things that decide how to
read it — a bare `0.196` does not say how many observations stood behind it or
which of the three tests produced it:

```
recalc> .ttest A1:A9 vs B1:B9
  sample  n       mean   variance
   A1:A9  9  4.5555556  6.7777778
   B1:B9  9  7.8888889  47.111111

                 test  welch, two-tailed
  difference in means         -3.3333333
                    t         -1.3622298
   degrees of freedom          10.255209
                    p           0.202294
```

Welch is the default rather than the pooled test. Pooling assumes the two
samples share a variance, and when they do not — the ordinary case for two
groups of different sizes — it reports a smaller p-value than the evidence
supports. Welch costs nothing when the assumption does hold, since the two then
agree, so the safe one is the one that does not have to be asked for.

## What-if analysis

A model's single number is the least interesting thing about it. The two
questions worth asking of one are *what input gets me this output* and *how
does the output move as the input moves*, and both are the same primitive: run
the sheet with a cell temporarily holding something else, read a result, put
the sheet back.

```ts
import { Workbook, goalSeek, twoWayTable, series } from "recalc-formula";

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
`.regress E1:E11 by A1:D11 [through zero]`; for a comparison
`.ttest A1:A9 vs B1:B9 [paired|pooled|welch] [one-tailed]`; and for CSV
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
- The distributions are checked against published critical values — the whole
  95% and 99% rows of the t, chi-squared and F tables — and against the closed
  forms they collapse to: `P(1, x)` is `1 − e⁻ˣ`, t at one degree of freedom is
  the Cauchy, chi-squared at two is the exponential, and the gamma at shape one
  is the exponential again.
- Every quantile round-trips through its own cumulative across fourteen decades
  of probability, from `1e-14` to `1 − 1e-3`, to better than `1e-9` relative —
  including a chi-squared on a million degrees of freedom, where a fixed
  iteration cap silently returns a partial sum instead.
- The discrete families are checked against exact arithmetic: the binomial
  against the longhand sum for every `k` at four parameter settings, the
  hypergeometric against the ratio of binomial coefficients written out, and
  each cumulative against the running total of its own density.
- Two hundred values across eight distributions agree with an independent
  implementation to `5e-12` relative or better.
- Each hypothesis test reproduces a published worked example, and is checked
  against the distribution it is built on rather than only against that number:
  every t test's p equals `T.DIST.2T` of its own statistic, `F.TEST` equals
  twice the upper tail of the ratio it forms, and `CHISQ.TEST` equals
  `CHISQ.DIST.RT` of Pearson's statistic.
- The tests are checked against each other where they have to agree: the paired
  test equals a one-sample test on the differences, and the pooled and Welch
  tests coincide — statistic, degrees of freedom and p — on two samples of the
  same size and spread.
- On a single-predictor fit, the significance of the F equals the p-value on
  the slope, since with one predictor the two are the same question and F is
  the square of t.

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

- The benchmark is not run in continuous integration, only locally: its figures
  are a statement about one machine and nothing can be asserted of them
  elsewhere. The suite, the type check, the build and the evidence gate do run
  there, across the Node range `engines` claims.
- Implicit intersection is not implemented. A block in a position that needs
  one value is `#VALUE!` rather than a silent pick from the calling row.
- A block cannot be entered over a range the way a legacy array formula was.
  Spilling from a single anchor is the only form.
- `SORT`, `SORTBY`, `FILTER` and `UNIQUE` work on whole lines and nothing
  narrower: there is no `SORT` of one column in place within a wider block, and
  no `FILTER` that keeps part of a row.
- A dropped column is reported as a zero coefficient, which is what it
  contributes, but nothing says *which* column went other than the zero
  itself: there is no list of the columns a fit discarded, and `LINEST` has
  nowhere in its five-row block to put one. The shell's `.regress` prints the
  rank, which is as close as the surface gets.
- `LOGEST` and `GROWTH` are the only non-linear fits. A power curve
  (`y = b · x^m`, which is a log on both sides rather than one) has no
  function of its own.
- A formula whose result is a blank shows as empty rather than as a zero.
  Some spreadsheets render `=IF(TRUE,,2)` as `0`; here the result is a blank
  and is reported as one, since `ISBLANK` on it says TRUE and showing `0`
  would make the display disagree with that.
- Only one sheet; there are no cross-sheet references.
- Scenarios are not serialised: they live for the length of a session, and CSV
  has nowhere to put them.
- Sub-second format codes (`ss.00`) are not supported, and neither is ISO week
  numbering — `WEEKNUM` counts the week holding 1 January as week 1.
- A fraction code cannot be combined with a decimal point or a scientific
  exponent in the same section; both are refused with an offset. There is no
  reading of `0.0 ?/?` that is not already a fraction.
- A date is recognised by the format on its cell, not by what was typed: an
  entered `2026-03-04` is text until `DATEVALUE` turns it into a serial.
- A format belongs to a cell, not to a row, a column or the sheet, so
  formatting a whole column means selecting it and applying the format to the
  cells in it.
- CSV carries no formats: an export in `display` mode writes what the sheet
  shows, but that text does not read back in as the same numbers.
- A debt schedule is built for payments at the end of each period; an annuity
  due is available per period through `IPMT` and `PPMT` but not as a table.
- Names can only be defined from the library or the shell, not from the grid.
- Reference highlighting outlines only references written out in the formula.
  A name is underlined in the formula bar and resolved in the inspector, but
  the cells behind it are not outlined on the grid.

## Releasing

A release is a tag. `v0.1.0` publishes `0.1.0` and nothing else publishes
anything: the workflow refuses a tag that disagrees with `package.json`, runs
the suite and the type check, then installs the packed tarball into a bare
project and evaluates a formula through it before anything reaches the
registry.

The publish job holds one permission, `id-token: write`. There is no npm token
in this repository, in its secrets, or in any log: npm trusted publishing
exchanges a short-lived OIDC token for the right to publish this package from
this repository, and attaches build provenance automatically. That also means
the trusted publisher has to be registered on npm for `recalc-formula` before
the first tag is pushed — the registry does not validate the arrangement until
a publish is attempted.

## License

MIT
