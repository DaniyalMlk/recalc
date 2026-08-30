# Roadmap

The engine is built bottom-up: text becomes tokens, tokens become an AST, the AST
yields a dependency graph, and the graph drives evaluation. Each phase leaves the
tree green and the public API usable.

## Phase 1 — Formula grammar

- [ ] Tokenizer covering numbers, strings, booleans, operators, references, ranges and error literals
- [ ] Pratt parser producing a typed AST with correct precedence and associativity
- [ ] Parse errors carry source offsets
- [ ] Table-driven parser tests

## Phase 2 — Reference model

- [ ] A1 notation encode/decode, including multi-letter columns
- [ ] Absolute, relative and mixed anchors (`$A$1`, `A$1`, `$A1`)
- [ ] Ranges, normalisation and iteration
- [ ] Reference translation for fill-down / fill-across
- [ ] Cell store with sparse addressing

## Phase 3 — Dependency graph and recalculation

- [ ] Precedent extraction from the AST, including whole-range precedents
- [ ] Dependency graph with reverse edges for dependents
- [ ] Cycle detection reporting the participating cells
- [ ] Topological ordering of the dirty set only
- [ ] Incremental recalculation on cell edit

## Phase 4 — Evaluator and core functions

- [ ] Value model with numbers, strings, booleans, blanks and typed errors
- [ ] Coercion rules and error propagation matching spreadsheet semantics
- [ ] Arithmetic, comparison, text-join and unary/postfix operators
- [ ] Math, statistical, logical, text and lookup function packs
- [ ] Argument arity and type validation with per-function signatures

## Phase 5 — Financial function pack

- [ ] Time-value-of-money core: `PV`, `FV`, `PMT`, `NPER`, `RATE`
- [ ] Discounted cash flow: `NPV`, `IRR`, `XNPV`, `XIRR`
- [ ] Robust root-finding with bracketing fallback for `IRR` / `RATE`
- [ ] Numerics validated against closed-form results and published worked examples

## Phase 6 — Web interface

- [ ] Virtualised grid with keyboard navigation and selection
- [ ] Formula bar with reference highlighting
- [ ] Live recalculation surfaced as the sheet is edited
- [ ] Precedent / dependent inspection for the selected cell

## Phase 7 — Interchange and performance

- [ ] CSV import and export
- [ ] Named ranges
- [ ] Benchmark harness over large dependency chains
- [ ] Recalculation profiling and hot-path tuning
