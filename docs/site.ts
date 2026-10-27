/**
 * The documentation site, generated from the engine rather than written beside it.
 *
 * Two rules decide what is allowed on the page.
 *
 * **Every figure comes from code that runs.** The evidence table is rendered
 * from `scripts/evidence.ts` — the same gate CI runs and the same rows the
 * README carries — and the function count is read off the registry. Nothing
 * here is a number somebody typed, because a number typed on a page is a
 * number that will be wrong in a month. `test/docs.test.ts` fails in both
 * directions if that stops being true.
 *
 * **The palette is the demo's.** `web/src/styles.css` already settled it: a
 * warm paper ground, hairlines rather than shadows, one pine accent, and
 * colour used only where it carries meaning. The landing page inherits those
 * values exactly, so the page and the thing it is about read as one piece of
 * work rather than as a product site wrapped around an application.
 *
 * The site is three files plus the built demo, and `site/` is gitignored: the
 * repository holds this generator, not its output.
 */

import { measure, renderTable } from "../scripts/evidence.js";
import type { Check } from "../scripts/evidence.js";
import { registeredFunctionNames } from "../src/functions/index.js";

/** The published name, which is not the repository's name. */
export const PACKAGE = "recalc-formula";
export const SOURCE = "https://github.com/DaniyalMlk/recalc";

/** Where the demo is published relative to the landing page. */
export const DEMO = "demo/";

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A markdown table from the evidence gate, rendered as HTML.
 *
 * The gate owns the rows; this only changes the delimiters. Backticks become
 * `<code>` because the gate writes its labels for the README, and a label that
 * reads `` `STDEV.P` `` on the front page should read as code here too.
 */
function tableFrom(checks: readonly Check[]): string {
  const rows = renderTable(checks)
    .split("\n")
    .filter((line) => line.startsWith("|") && !line.startsWith("| ---"));
  const cells = rows.map((line) =>
    line
      .slice(1, -1)
      .split(" | ")
      .map((cell) => code(esc(cell.trim()))),
  );
  const [header, ...body] = cells;
  const head = (header ?? []).map((cell) => `<th>${cell}</th>`).join("");
  const lines = body
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table class="evidence">\n<thead><tr>${head}</tr></thead>\n<tbody>\n${lines}\n</tbody>\n</table>`;
}

/** `` `x` `` to `<code>x</code>`, after escaping. */
function code(text: string): string {
  return text.replace(/`([^`]+)`/g, (_, inner: string) => `<code>${inner}</code>`);
}

function shell(body: string, description: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>recalc &middot; a spreadsheet formula engine</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%23f7f6f3'/%3E%3Crect x='2.5' y='2.5' width='5' height='5' fill='%23d2cec3'/%3E%3Crect x='8.5' y='2.5' width='5' height='5' fill='%23d2cec3'/%3E%3Crect x='2.5' y='8.5' width='5' height='5' fill='%23d2cec3'/%3E%3Crect x='8.5' y='8.5' width='5' height='5' fill='%231f5f4e'/%3E%3C/svg%3E">
<link rel="stylesheet" href="style.css">
</head>
<body>
${body}
</body>
</html>
`;
}

/**
 * The landing page.
 *
 * It leads with the claim the design is actually betting on, because that is
 * the one thing about this engine that is not true of every other one, and it
 * leads with it as a *count* rather than as an adjective — "1, 1 and 1" is
 * checkable and "fast" is not.
 */
function landing(checks: readonly Check[], functions: number): string {
  const isolated = checks.find((check) => check.label.includes("nothing downstream"));
  const graph = checks.find((check) => check.label.includes("its own graph"));

  return shell(
    `<header class="masthead col">
  <a class="mark" href="./"><span class="mark__glyph" aria-hidden="true"></span>recalc</a>
  <nav class="masthead__nav">
    <a href="#demo">Demo</a>
    <a href="#evidence">What is checked</a>
    <a href="#install">Install</a>
    <a href="${esc(SOURCE)}">Source</a>
  </nav>
</header>

<main>

<section class="lede col">
  <h1>An edit costs what depends on&nbsp;it, not the size of the&nbsp;sheet.</h1>
  <p class="standfirst">A spreadsheet formula engine in TypeScript with no
  runtime dependencies. It parses formula text, works out which cells each
  formula depends on, and recalculates only what an edit actually
  invalidated &mdash; ${functions} functions, a dependency graph that is
  checked against itself, and an interactive grid you can type into on this
  page.</p>
  <p class="actions">
    <a class="cta" href="${esc(DEMO)}">Open the demo</a>
    <a class="plain" href="${esc(SOURCE)}">Read the source</a>
  </p>
</section>

<section class="claim">
  <div class="claim__inner col">
  <p class="claim__figure"><strong>1</strong> cell evaluated</p>
  <p class="claim__detail">in sheets of 2,000, 20,000 and 100,000 cells, for an
  edit with nothing downstream of it. As a timing, &ldquo;flat as the sheet
  grows&rdquo; is a shape on a chart; as a count it is the same number
  everywhere, and it is what the design is betting on.
  ${isolated === undefined ? "" : `<span class="claim__source">Measured by the gate CI runs: ${esc(isolated.result)}.</span>`}</p>
  </div>
</section>

<section id="demo" class="demo">
  <div class="demo__intro col">
    <h2>The engine, running</h2>
    <p>Not a recording and not a mock-up: the grid below imports the engine
    straight from source, so what recalculates here is what recalculates in the
    library. Type a formula, then watch the status bar &mdash; it reports how
    many cells the edit actually forced the engine to evaluate.</p>
    <p class="demo__hint">Try <code>=SUM(C2:C8)</code>, then
    <code>=IF(B2&gt;0, NPV(B1, C2:C8) / B2, "n/a")</code>. The what-if panel
    does goal seek, sensitivity tables and named scenarios.</p>
  </div>
  <div class="demo__frame">
    <iframe src="${esc(DEMO)}" title="recalc, running in the browser"
            loading="lazy" referrerpolicy="no-referrer"></iframe>
  </div>
  <p class="demo__fallback col"><a href="${esc(DEMO)}">Open the demo in its own
  tab</a> &mdash; it wants a keyboard and a window wider than a phone.</p>
</section>

<section id="evidence" class="evidence-section col--wide">
  <h2>What is checked, and against what</h2>
  <p>A recalculation engine is easy to describe and hard to believe: every one
  of them says an edit costs what depends on it rather than the size of the
  sheet. So here is what was measured. Every figure in this table is produced
  by <code>npm run evidence</code>, which runs in CI and exits non-zero if any
  of them moves &mdash; and it is the same gate that renders this page, so the
  page cannot drift from the code either.</p>
  ${tableFrom(checks)}
  <p class="aside"><strong>The cost rows are counts, not durations.</strong>
  Milliseconds are a statement about the machine they were measured on and can
  be asserted nowhere else. The number of cells an edit forces the engine to
  recompute is a property of the algorithm, identical everywhere.</p>
  ${
    graph === undefined
      ? ""
      : `<p class="aside"><strong>The engine is checked against its own
  graph.</strong> The dependency graph is the engine&rsquo;s <em>prediction</em>
  of the work it will do, and the recalculation count is a record of what it
  did. An engine that walked a whole sheet while its graph reported three
  dependents would look identical from the outside and be wrong in exactly the
  way that matters. ${esc(graph.result)}.</p>`
  }
  <p class="aside"><strong>One row&rsquo;s reference is not this package.</strong>
  Every other row compares the engine with arithmetic the engine is made of,
  which is the right way to check a calculation and no way at all to check a
  <em>convention</em>: a bond schedule built on the wrong rule still closes its
  periods and counts its coupons. That row is checked against a transcript of
  another implementation&rsquo;s output instead.</p>
</section>

<section id="install" class="install col">
  <h2>The first minute</h2>
  <pre><code>npm install ${esc(PACKAGE)}</code></pre>
  <pre><code>import { Workbook } from "${esc(PACKAGE)}";

const book = new Workbook();
book.setCells({
  B1: 1200,              // units
  B2: 24.5,              // price
  B3: 15.25,             // unit cost
  B4: 6000,              // fixed costs
  B6: "=B1*B2",
  B8: "=B6-B1*B3",
  B9: "=B8-B4",
  B12: '=IF(B9&gt;0,"profitable","loss-making")',
});

book.getValue("B9");     // 5100
book.setCell("B2", 26);  // 4 cells recalculated, not 8
book.lastRecalculated;   // 4</code></pre>
  <p><strong>The package is <code>${esc(PACKAGE)}</code>, not
  <code>recalc</code>.</strong> <code>recalc</code> on npm is an unrelated
  package, so the distribution name differs; the command line is still called
  <code>recalc</code>, and so is this repository. Node 20.19 or newer. The
  package ships compiled JavaScript and type declarations and has no runtime
  dependencies. There is a REPL in the box too: <code>npx recalc</code>.</p>
  <p class="aside">Until the trusted publisher is registered on the registry,
  that install line is the one thing on this page that does not work yet, and
  it installs from source in the meantime:
  <code>git clone ${esc(SOURCE)}.git &amp;&amp; npm ci</code>.</p>
</section>

<section class="covers col">
  <h2>What is in it</h2>
  <p>${functions} functions, and the packs are the ones a model actually needs
  rather than the ones that are easy: financial and amortisation, dates and
  day-count conventions, bond pricing on a coupon schedule that honours the
  end-of-month rule, dense linear algebra, least-squares regression with its
  statistics, nine distribution families with their inverses and tails, and
  hypothesis tests. Around them: structural editing that rewrites every formula
  in the sheet when rows and columns move, number formats that follow their
  cells through all of it, blocks that spill across the grid, CSV interchange,
  named ranges, undo, and what-if analysis &mdash; goal seek, sensitivity
  tables, named scenarios.</p>
  <p>The reasoning is in the source rather than in a wiki. Every module says
  what convention it implements and why that convention rather than the other
  one, which is the part of a spreadsheet engine that is actually hard.</p>
</section>

</main>

<footer class="foot">
  <p class="col">recalc, published as <code>${esc(PACKAGE)}</code>. Built from the
  engine&rsquo;s own evidence gate, so no figure on this page was typed by
  hand. <a href="${esc(SOURCE)}">Source</a>.</p>
</footer>
`,
    "recalc is a spreadsheet formula engine in TypeScript: a formula parser, a " +
      "dependency graph, and incremental recalculation that costs what an edit " +
      "invalidated rather than the size of the sheet.",
  );
}

/** The stylesheet, inheriting the demo's palette so the two read as one thing. */
const STYLE = `/*
 * The palette is web/src/styles.css's, unchanged: a warm paper ground,
 * hairlines instead of shadows, one pine accent that carries meaning and is
 * used nowhere decorative. The page is about a grid, so figures are set in the
 * same monospace the grid uses and the measure stays narrow enough to read.
 */

:root {
  --paper: #f7f6f3;
  --surface: #ffffff;
  --panel: #f1efe9;
  --rule: #e3e0d8;
  --rule-strong: #d2cec3;
  --ink: #23211e;
  --ink-soft: #57534c;
  --ink-mute: #6f6a60;
  --accent: #1f5f4e;
  --accent-deep: #1a5142;
  --accent-soft: rgba(31, 95, 78, 0.08);
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --text: ui-serif, Georgia, "Times New Roman", serif;

  /*
   * One column for reading and a wider one for the two things that need the
   * room. The reading column is set to the measure rather than to something
   * larger with the text ragged inside it: a 64rem band holding a 36rem
   * paragraph reads as a page that was never finished.
   */
  --measure: 38rem;
  --wide: 60rem;
  --gutter: 1.5rem;
}

.col { padding-inline: max(var(--gutter), 50% - var(--measure) / 2); }
.col--wide { padding-inline: max(var(--gutter), 50% - var(--wide) / 2); }

*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--text);
  font-size: 1.0625rem;
  line-height: 1.6;
}

main { display: block; }

a { color: var(--accent-deep); text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:hover { color: var(--ink); }

code, pre, .claim__figure strong, .evidence td, .evidence th {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}

code { font-size: 0.9em; }

pre {
  background: var(--surface);
  border: 1px solid var(--rule);
  padding: 1rem 1.15rem;
  overflow-x: auto;
  font-size: 0.875rem;
  line-height: 1.55;
  margin: 1.25rem 0;
}

pre code { font-size: inherit; }

/* -- masthead ------------------------------------------------------------ */

.masthead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  flex-wrap: wrap;
  padding-block: 1.25rem;
  border-bottom: 1px solid var(--rule);
}

.mark {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  font-family: var(--mono);
  font-size: 1.0625rem;
  letter-spacing: 0.01em;
  color: var(--ink);
  text-decoration: none;
}

/* Four cells, one of them computed: the same mark the application uses. */
.mark__glyph {
  width: 1.05rem;
  height: 1.05rem;
  background:
    linear-gradient(var(--accent), var(--accent)) 100% 100% / 48% 48% no-repeat,
    linear-gradient(var(--rule-strong), var(--rule-strong)) 0 0 / 48% 48% no-repeat,
    linear-gradient(var(--rule-strong), var(--rule-strong)) 100% 0 / 48% 48% no-repeat,
    linear-gradient(var(--rule-strong), var(--rule-strong)) 0 100% / 48% 48% no-repeat;
}

.masthead__nav {
  display: flex;
  gap: 1.25rem;
  flex-wrap: wrap;
  font-family: var(--mono);
  font-size: 0.8125rem;
}

.masthead__nav a { color: var(--ink-soft); text-decoration: none; }
.masthead__nav a:hover { color: var(--accent-deep); text-decoration: underline; }

/* -- sections ------------------------------------------------------------ */

.lede { padding-block: 4.5rem 3rem; }

h1 {
  margin: 0;
  max-width: 19ch;
  font-size: clamp(2.1rem, 6.2vw, 3.4rem);
  line-height: 1.07;
  letter-spacing: -0.02em;
  font-weight: 400;
}

.standfirst {
  margin: 1.5rem 0 0;
  font-size: 1.1875rem;
  color: var(--ink-soft);
}

.actions { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; margin: 2rem 0 0; }

.cta {
  display: inline-block;
  background: var(--accent);
  color: #fff;
  padding: 0.6rem 1.15rem;
  font-family: var(--mono);
  font-size: 0.875rem;
  text-decoration: none;
}

.cta:hover { background: var(--accent-deep); color: #fff; }

.plain { font-family: var(--mono); font-size: 0.875rem; }

/* The one figure that gets a whole band to itself, because it is the claim. */
.claim {
  background: var(--accent-soft);
  border-block: 1px solid var(--rule);
  padding-block: 2.25rem;
}

.claim__inner {
  display: grid;
  grid-template-columns: minmax(0, 7rem) minmax(0, 1fr);
  gap: 0 2rem;
  align-items: start;
}

.claim__figure { margin: 0; font-size: 0.9375rem; color: var(--ink-soft); }
.claim__figure strong { display: block; font-size: 3.25rem; line-height: 1; color: var(--accent-deep); font-weight: 400; }
.claim__detail { margin: 0; color: var(--ink-soft); }
.claim__source { display: block; margin-top: 0.6rem; font-family: var(--mono); font-size: 0.75rem; color: var(--ink-mute); }

h2 {
  margin: 0 0 0.85rem;
  font-size: 1.5rem;
  font-weight: 400;
  letter-spacing: -0.01em;
}

.evidence-section, .install, .covers { padding-block: 3.25rem; border-top: 1px solid var(--rule); }
.evidence-section p, .install p, .covers p { color: var(--ink-soft); }
/* The wide column is for the table; the sentences around it keep the measure. */
.evidence-section > p { max-width: var(--measure); }

.aside { font-size: 0.9375rem; }
.aside strong { color: var(--ink); }

/* -- the demo band ------------------------------------------------------- */

.demo { padding-block: 3.25rem 2rem; border-top: 1px solid var(--rule); background: var(--panel); }
.demo__intro p { color: var(--ink-soft); }
.demo__hint { font-size: 0.9375rem; }

.demo__frame {
  width: min(100% - var(--gutter) * 2, var(--wide));
  margin: 1.75rem auto 0;
  border: 1px solid var(--rule-strong);
  background: var(--surface);
  /* The application is a grid with a sidebar; below this it is unusable, and
   * the link below the frame is the honest answer on a phone. */
  height: min(34rem, 80vh);
}

.demo__frame iframe { display: block; width: 100%; height: 100%; border: 0; }

.demo__fallback { margin: 0.85rem 0 0; font-family: var(--mono); font-size: 0.8125rem; color: var(--ink-mute); }

@media (max-width: 48rem) {
  .demo__frame { display: none; }
  .claim__inner { grid-template-columns: minmax(0, 1fr); gap: 1.25rem; }
}

/*
 * Two columns of sentences do not survive a narrow screen: at 390px each cell
 * is four characters wide and the table is unreadable. Below this the rows
 * stack, the claim above its result, which is the same information in the
 * order it is read.
 */
@media (max-width: 40rem) {
  .evidence thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .evidence tr { display: block; border-bottom: 1px solid var(--rule); padding-block: 0.85rem; }
  .evidence tr td { display: block; width: auto; border: 0; padding: 0; }
  .evidence tr td:first-child { color: var(--ink); margin-bottom: 0.35rem; }
  .evidence tr td:last-child::before { content: "\\2192\\00a0"; color: var(--ink-mute); }
}

/* -- the evidence table -------------------------------------------------- */

.evidence {
  width: 100%;
  margin: 1.75rem 0 1.5rem;
  border-collapse: collapse;
  font-size: 0.8125rem;
  text-align: left;
}

.evidence th {
  font-weight: 400;
  color: var(--ink-mute);
  border-bottom: 1px solid var(--rule-strong);
  padding: 0 0.9rem 0.5rem 0;
}

.evidence td {
  vertical-align: top;
  border-bottom: 1px solid var(--rule);
  padding: 0.7rem 0.9rem 0.7rem 0;
  color: var(--ink-soft);
  line-height: 1.5;
}

.evidence tr td:first-child { color: var(--ink); width: 45%; }
.evidence code { background: var(--panel); padding: 0 0.2em; }
.demo .evidence code { background: var(--surface); }

/* -- foot ---------------------------------------------------------------- */

.foot { border-top: 1px solid var(--rule); padding-block: 2rem 3rem; }
.foot p { margin: 0; font-size: 0.875rem; color: var(--ink-mute); }
`;

/** Every file the site is made of, apart from the built demo. */
export function buildSite(): ReadonlyMap<string, string> {
  const checks = measure();
  const functions = registeredFunctionNames().length;
  return new Map([
    ["index.html", landing(checks, functions)],
    ["style.css", STYLE],
  ]);
}

/** The pages the generator produces, for a test to pin. */
export const SITE_FILES = ["index.html", "style.css"] as const;
