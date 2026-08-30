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

Phases 1–5 of [ROADMAP.md](ROADMAP.md) are complete: the formula grammar, the
reference model, the dependency graph, the evaluator, and a function library of
97 functions including a financial pack. Later phases add a web interface and
CSV interchange.

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
```

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
`.cycles`, `.fns`, `.help FN`, `.demo`, `.clear`, `.reset`.

## Install and run

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run build     # emits dist/
npm run repl      # interactive shell
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

## Known gaps

- No CI is configured, so the suite runs locally only.
- Implicit intersection is not implemented: a multi-cell range in a scalar
  position is `#VALUE!` rather than a silent pick from the calling row.
- Omitted arguments (`IF(A1,,2)`) are a parse error.
- Only one sheet; there are no cross-sheet references.

## License

MIT
