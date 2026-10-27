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

## Phase 20 — Linear algebra and regression

- [x] LU with partial pivoting behind the determinant, the inverse and the solve
- [x] A pivot tested against a tolerance that scales with the matrix, not against zero
- [x] Householder QR behind the fit, so the design matrix is never squared
- [x] Standard errors read off `R` inverse rather than by inverting `X` transpose `X`
- [x] `MMULT`, `MINVERSE`, `MDETERM`, `MUNIT`, `MSOLVE`
- [x] `LINEST`, coefficients alone and the full five-row statistics block
- [x] `TREND` and `FORECAST` over the same fit, in both orientations and through zero
- [x] `SLOPE`, `INTERCEPT`, `RSQ`, `PEARSON`, `CORREL`, `COVARIANCE.P`, `COVARIANCE.S`, `STEYX`
- [x] Every figure of the published multiple-regression example reproduced
- [x] `.regress` in the shell, laid out as a summary with a t statistic per term

## Phase 21 — Distributions and inference

- [x] Log-gamma, the error functions, and the two regularised incomplete integrals behind every family
- [x] Each integral by whichever expansion converges where the argument lies, with an iteration cap that scales rather than truncating silently
- [x] Right tails and right-tailed inverses computed as tails, never as one minus the other side
- [x] The complement passed in where the caller already knows it exactly, rather than recovered by subtraction
- [x] Normal, Student's t, chi-squared, F, gamma, beta, lognormal, exponential and Weibull
- [x] Binomial, Poisson, hypergeometric and negative binomial, over exact identities rather than summation
- [x] The spreadsheet functions under their dotted names, with per-family domain checks
- [x] Hypothesis tests: `T.TEST`, `F.TEST`, `CHISQ.TEST`, `Z.TEST`
- [x] Confidence intervals: `CONFIDENCE.NORM` and `CONFIDENCE.T`
- [x] A p-value beside every coefficient in the regression summary, and a significance for the F
- [x] `.ttest` in the shell, naming the three tests rather than numbering them

## Phase 22 — Installable, and tested somewhere other than a laptop

- [x] Published under `recalc-formula`, since `recalc` on npm is an unrelated
      package. The repository, the command line and the import surface keep
      their own name; only the distribution name moves, and the README says so
      rather than leaving somebody to install the wrong thing.
- [x] `repository` set and matching this repository exactly, which npm trusted
      publishing compares against the publishing workflow and refuses the
      publish without
- [x] `exports`, `engines`, `publishConfig`, `bugs`, `homepage` and `author`
- [x] `prepack` wired to the build, so packing cannot ship a stale `dist`
- [x] Source maps off in the published build: `files` is `["dist"]`, so every
      map that shipped pointed at a `src/` path the tarball does not contain.
      198 files and 1.2 MB down to 133 and 743 KB.
- [x] Tests over what `npm pack` would ship, which is the one thing a suite
      that imports from `../src` cannot see, each verified against the defect
      it exists for
- [x] Continuous integration across the Node range `engines` claims, the web
      demo built separately since it has its own bundler, and the tarball
      installed into a bare project and evaluated from there
- [x] A tag-driven release that refuses a tag disagreeing with the manifest and
      holds `id-token: write` and nothing else, so no credential is stored
- [x] The count of cells an edit evaluates reported by the workbook rather than
      computed and discarded, and checked against the dependency graph that
      predicts it
- [x] An evidence table of what was checked and against what, in counts rather
      than durations, recomputed by a gate CI runs and pinned to the document
      in both directions
- [ ] The trusted publisher registered on npm for `recalc-formula`. Until then
      the workflow is committed and no tag is pushed.

## Phase 23 — The end-of-month rule in a coupon schedule

- [x] Maturity as the only thing that decides the rule: on its month's last
      day the whole schedule is pulled to month ends, anywhere else the day of
      the month is kept and clamped
- [x] The asymmetry that made this a defect rather than an omission — clamping
      the 31st into a short month lands on that month's end, so a bond
      maturing 31 August was already scheduled on month ends while one
      maturing 30 September was not
- [x] The convention stated where the schedule is generated, including that
      `YEARFRAC` basis 0 already assumes it when it makes 28 February to
      31 August a clean 180 days
- [x] A reference from outside this package, since a schedule built on the
      wrong rule closes its periods and counts its coupons perfectly well
- [x] Each block of that reference walking a maturity through a month end and
      out the other side, so the rule's boundary is pinned and not only its
      interior
- [x] Both halves of what moved: a wrong previous coupon is invisible on the
      two 30/360 bases, which map a 31st to a 30th, and a wrong next coupon is
      invisible on every basis but actual/actual, which is the only one that
      measures the period it is in
- [x] Five ways of reintroducing it confirmed to fail, the one-day-too-wide
      rule caught only by the neighbour rows
- [x] A row on the front page, as a count of cases rather than a tolerance

## Phase 24 — An accrual summed over quasi-coupon periods

- [x] A quasi-coupon schedule anchored on the first-interest date, from the
      same generator a priced bond's schedule uses, so the end-of-month rule
      reaches the stub period too
- [x] Spans that tile the accrual exactly — no gap, no overlap — which is what
      makes summing them a day count rather than an approximation of one
- [x] `ACCRINT` taking the first-interest date it previously read, validated
      and discarded, with a comment saying it could not matter
- [x] The size of that: moving the date over one accrual spans 16.576 to
      16.758 on actual/actual, 1.1% of the figure, nothing else changed
- [x] Which bases this moves, measured rather than assumed. The front page had
      both halves wrong
- [x] Actual/360, actual/365 and 30/360 European telescoping back to one span,
      asserted as an integer identity on the day counts and a residue below
      1e-15 on the accrual
- [x] Actual/actual as the only basis that measures the period it is in, at
      −0.82% to +2.53% of the single span
- [x] 30/360 US moving for an unrelated reason — its day count is not a
      property of the stretch alone — in 188 of 6,540 cases, by −4 to +1 days
- [x] The eighth argument, saying whether a settlement past the first interest
      date accrues from issue or from that date, and agreeing with itself
      anywhere at or before it
- [x] Six ways of reintroducing the defect confirmed to fail, two of them
      caught by a single test apiece
- [x] A row on the front page carrying both halves, since the agreement alone
      would be vacuous

## Phase 26 — The exponential pair

- [x] `LOGEST` reporting the multipliers of `y = b · m₁^x₁ · m₂^x₂ · …`, over
      one predictor or several
- [x] `GROWTH` evaluating the curve at the points given or at new ones, with
      `TREND`'s reading of `new_x` shared rather than copied
- [x] Both as the linear pair with a transform either side rather than a second
      fitting routine, which makes them exact identities against `LINEST` and
      `TREND` on the logged outcome rather than second opinions
- [x] `const` FALSE giving exactly 1, since the constraint is that the
      log-space intercept is zero
- [x] The statistics block below its first row left as the log fit's, with the
      standard errors named as the errors on the exponents — and the test
      asserting they are *not* their own exponentials, so the agreement is a
      statement rather than a coincidence
- [x] A non-positive outcome refused rather than dropped
- [x] What the fit minimises measured rather than described: against a
      golden-section search for the exponential with the smallest squared
      error in `y`, the fitted curve is 12.7 times worse on that criterion on
      a series spanning two orders of magnitude, and the absolute optimum is
      38.8 times worse on squared error in the log
- [x] The other half of that figure, so it reads in proportion: under a spread
      of 2 the two criteria pick curves within 1% of each other, and at a
      spread of 7 within 8%
- [x] An exactly exponential series as the control, where a ratio of errors
      would be meaningless and both are bounded instead
- [x] Five ways of getting the transform wrong confirmed to fail, including
      exponentiating the standard errors with the coefficients — caught by one
      test, which is the one that says which space they live in
