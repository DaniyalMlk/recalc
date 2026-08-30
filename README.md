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

Phases 1–2 of [ROADMAP.md](ROADMAP.md) are complete: the formula grammar and the
reference model. Later phases add the dependency graph, the evaluator, a
financial function pack and a web interface.

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
