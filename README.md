# recalc

A spreadsheet formula engine written in TypeScript, with no runtime dependencies.

`recalc` takes formula text, parses it into an AST, works out which cells each
formula depends on, and recalculates only what an edit actually invalidated.

```
=IF(B2>0, NPV(B1, C2:C8) / B2, "n/a")
   │        │        │
   │        │        └── range precedent, expanded lazily
   │        └── function call, arity- and type-checked
   └── comparison against a scalar, with spreadsheet coercion rules
```

## Status

Phases 1–4 of [ROADMAP.md](ROADMAP.md) are complete: the formula grammar, the
reference model, the dependency graph, and the evaluator with its function
library. Later phases add a financial function pack, a web interface and CSV
interchange.

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
```

## Install and run

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run build     # emits dist/
```

## Design decision that mattered

The parser produces references as **structured values, not strings**. A parsed
`$B7` is `{ col: 1, row: 6, colAbsolute: true, rowAbsolute: false }`, not the
text `"$B7"`.

The alternative — keeping references as text and re-parsing them whenever they
are needed — is simpler to write and wrong in two places that matter. Fill-down
has to translate every relative reference by the row delta, which means parsing
and reprinting text on every filled cell. And the dependency graph needs a stable
key per cell, which string references cannot give you, because `B7`, `$B7` and
`B$7` all point at the same cell but are three different strings.

Encoding the anchor flags separately from the coordinates makes both operations
arithmetic. Translation adds a delta to the coordinate when the matching anchor
flag is false. The graph key is derived from the coordinates alone, so the three
spellings above collapse to one node without any special casing.

## License

MIT
