# Roadmap

The engine is built bottom-up: text becomes tokens, tokens become an AST, the AST
yields a dependency graph, and the graph drives evaluation. Each phase leaves the
tree green and the public API usable.

## Phase 1 — Formula grammar

- [x] Tokenizer covering numbers, strings, booleans, operators, references, ranges and error literals
- [x] Pratt parser producing a typed AST with correct precedence and associativity
- [x] Parse errors carry source offsets
- [x] Table-driven parser tests

## Phase 2 — Reference model

- [x] A1 notation encode/decode, including multi-letter columns
- [x] Absolute, relative and mixed anchors (`$A$1`, `A$1`, `$A1`)
- [x] Ranges, normalisation and iteration
- [x] Reference translation for fill-down / fill-across
- [x] Cell store with sparse addressing

## Phase 3 — Dependency graph and recalculation

- [x] Precedent extraction from the AST, including whole-range precedents
- [x] Dependency graph with reverse edges for dependents
- [x] Cycle detection reporting the participating cells
- [x] Topological ordering of the dirty set only
- [x] Incremental recalculation on cell edit

## Phase 4 — Evaluator and core functions

- [x] Value model with numbers, strings, booleans, blanks and typed errors
- [x] Coercion rules and error propagation matching spreadsheet semantics
- [x] Arithmetic, comparison, text-join and unary/postfix operators
- [x] Math, statistical, logical, text and lookup function packs
- [x] Argument arity and type validation with per-function signatures

## Phase 5 — Financial function pack

- [x] Time-value-of-money core: `PV`, `FV`, `PMT`, `NPER`, `RATE`
- [x] Discounted cash flow: `NPV`, `IRR`, `XNPV`, `XIRR`
- [x] Robust root-finding with bracketing fallback for `IRR` / `RATE`
- [x] Numerics validated against closed-form results and published worked examples
- [x] Interactive shell for entering and inspecting a sheet

## Phase 6 — Web interface

- [x] Virtualised grid with keyboard navigation and selection
- [x] Formula bar with reference highlighting
- [x] Live recalculation surfaced as the sheet is edited
- [x] Precedent / dependent inspection for the selected cell
- [x] Resizable columns backed by sparse axis metrics

## Phase 7 — Interchange and performance

- [x] CSV import and export, in the library, the shell and the grid
- [x] Named ranges, expanded into the dependency graph
- [x] Benchmark harness over large dependency chains
- [x] Recalculation profiling and hot-path tuning
