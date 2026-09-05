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

## Phase 14 — Scenarios

- [x] A named set of assumptions, stored as inputs rather than values
- [x] Capture the current contents of a set of cells as a scenario
- [x] Apply a scenario as one undoable edit
- [x] Report the formulas an apply would overwrite, before it writes
- [x] Scenarios follow rows and columns through a structural edit
- [x] A summary across every scenario, marking the results that actually move
- [x] `.scenario`, `.scenarios`, `.apply`, `.unscenario` and `.summary` in the shell

## Phase 15 — What-if in the grid

- [x] A second sidebar panel, switched by tabs, keeping its state across selection changes
- [x] Goal seek from the grid, prefilled from the selection, solving without applying by default
- [x] A refusal about the graph shown as an answer rather than as an error
- [x] Sensitivity tables rendered in the panel, or written into the sheet
- [x] Scenarios captured from the selection, applied, and summarised side by side
- [x] Scenarios moved with the sheet by structural edits made from the grid
- [x] Panel view logic separated from the DOM and tested that way

## Phase 16 — Dates and day-count conventions

- [x] Serial date core on the 1900 system, phantom leap day included, with civil conversion both ways
- [x] Component and arithmetic functions: `YEAR` … `SECOND`, `WEEKDAY`, `WEEKNUM`, `EDATE`, `EOMONTH`, `DAYS`, `DAYS360`, `DATEDIF`
- [x] The five day-count bases behind `YEARFRAC`, validated against the published 30/360 table
- [x] `XNPV` and `XIRR` discounting through the shared day-count module
- [x] Working-day functions with a holiday list: `NETWORKDAYS`, `WORKDAY`
- [x] `TODAY` and `NOW` on a clock the host can replace
- [x] Date, time and elapsed codes in the format compiler and renderer
- [x] Date and duration presets in the grid's format menu and the shell's help

## Phase 17 — Amortisation

- [x] `IPMT` and `PPMT` in closed form, so a period costs the same wherever it sits in the term
- [x] `CUMIPMT` and `CUMPRINC` over a span, validated against the published worked examples
- [x] `ISPMT` for a loan whose principal is repaid in equal slices
- [x] A schedule builder whose closing balance lands exactly on zero, or on a balloon
- [x] `.amortise` in the shell, reading a rate the way a term sheet quotes it
- [x] The schedule laid into the sheet as well as printed

## Phase 18 — Bond analytics

- [x] Coupon schedules generated backwards from maturity, each date derived from maturity rather than stepped
- [x] `COUPPCD`, `COUPNCD`, `COUPNUM`, `COUPDAYBS`, `COUPDAYS`, `COUPDAYSNC`, with the period split exactly
- [x] `PRICE` and `YIELD`, inverses of each other, with the separate rule for the final coupon period
- [x] `ACCRINT` and `ACCRINTM`
- [x] `DURATION` and `MDURATION`, checked against the price move they predict
- [x] Every published worked example reproduced in the test suite

## Phase 19 — Array values and spilling

- [x] A matrix value with a shape, kept out of `Value` so storage and formats stay scalar
- [x] An array argument beside scalar and range, so every existing function accepts one unchanged
- [x] Elementwise broadcasting for the operators, a length of one stretching and anything else refused
- [x] Spilling: the anchor keeps the formula, the rest of the block is derived and unjournalled
- [x] `#SPILL!` naming the cell in the way, writing nothing, and retried when the way is cleared
- [x] Re-seeding on a changed footprint, since a block's size is not an edge in the graph
- [x] `SEQUENCE`, `TRANSPOSE`, `TOROW`, `TOCOL` and the shape functions
- [x] `.spill` in the shell, and a block outlined in the grid with its origin named
