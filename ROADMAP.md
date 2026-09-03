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

## Phase 8 — Structural editing

- [x] Insert and delete rows and columns, with a count
- [x] Reference rewriting across the sheet, shifting what survives
- [x] Range adjustment for edits that land inside, above or across a range
- [x] `#REF!` for references whose target no longer exists
- [x] Named ranges adjusted alongside the formulas
- [x] Shell commands for structural edits

## Phase 9 — Fill, clipboard and history

- [x] Fill down and fill across, translating relative references
- [x] Copy a block and paste it anywhere, with the same translation
- [x] Clear a block in one operation
- [x] An edit journal with undo and redo
- [x] Shell commands for filling, copying and undoing

## Phase 10 — Editing in the grid

- [x] Row and column insertion and deletion from the headers
- [x] Fill and clipboard shortcuts on a selected block
- [x] Undo and redo wired to the keyboard
- [x] The toolbar reflects what the current selection can do

## Phase 11 — Number formats

- [x] Format code parser: sections, digit placeholders, literals, escapes, colours
- [x] Decimal rounding that matches what a spreadsheet shows, not what the float holds
- [x] Section selection by sign, with the negative branch owning its own sign
- [x] Grouping, percent and thousands scaling, scientific notation
- [x] `TEXT`, built on the same compiler as the cell display

## Phase 12 — Formats on the sheet

- [x] A format applied to a cell or a block, stored beside the values
- [x] Formats follow structural edits, fills and pastes
- [x] Formatting recorded in the edit journal, so undo reaches it
- [x] Shell commands to apply, inspect and clear a format
- [x] Format menu in the grid, previewing each choice on the selected value
- [x] CSV export of the sheet as it is shown, alongside values and formulas

## Phase 13 — What-if analysis

- [x] Evaluate the sheet under temporary overrides, restoring it afterwards and journalling nothing
- [x] Answer from the graph whether a result depends on an input at all
- [x] A scale-aware root finder: secant, expanding bracket, bisection
- [x] Goal seek, refusing the malformed cases before iterating and saying which one
- [x] One-way and two-way sensitivity tables, written into the sheet or printed
- [x] `.goalseek` and `.table` in the shell, with a compact axis syntax
