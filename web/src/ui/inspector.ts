import { isFormulaError } from "../../../src/engine/errors.js";
import { formatA1 } from "../../../src/engine/reference.js";
import type { Coord } from "../../../src/engine/reference.js";
import { kindOf } from "../../../src/engine/value.js";
import type { Workbook } from "../../../src/engine/workbook.js";

/**
 * The dependency graph, made legible for one cell.
 *
 * A spreadsheet's hardest question is "why did this change?", and the engine
 * already knows: it keeps precedents, dependents and the order it would
 * recompute in. This panel is just those three answers, written out. The
 * recalculation chain in particular is the thing a normal spreadsheet will
 * never show you, and it is the whole reason the graph is worth building.
 */

export interface InspectorElements {
  readonly title: HTMLElement;
  readonly kind: HTMLElement;
  readonly body: HTMLElement;
}

const EMPTY_SHEET = `
<div class="empty">
  <p>Nothing selected yet.</p>
  <p>Type a value, or start with <code>=</code> to write a formula. Every edit
  recalculates the cells that depend on it and nothing else.</p>
</div>`;

export class Inspector {
  constructor(
    private readonly el: InspectorElements,
    private readonly onNavigate: (address: string) => void,
  ) {
    this.el.body.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const address = target.dataset["goto"];
      if (address !== undefined) this.onNavigate(address);
    });
  }

  render(workbook: Workbook, coord: Coord): void {
    const address = formatA1({
      ...coord,
      colAbsolute: false,
      rowAbsolute: false,
    });
    this.el.title.textContent = address;

    const value = workbook.getValue(address);
    const kind = kindOf(value);
    this.el.kind.textContent = kind;

    if (!workbook.has(address)) {
      this.el.body.innerHTML = EMPTY_SHEET;
      return;
    }

    const parts: string[] = [];
    const input = workbook.getInput(address);
    const formula = workbook.getFormula(address);

    parts.push(field("Entered", escape(input)));

    if (formula !== null && formula !== input) {
      parts.push(field("Canonical", escape(formula)));
    }

    // A literal's value is the text that was typed, so printing it a second
    // time under a different heading says nothing.
    const display = workbook.getDisplay(address);
    if (formula !== null || display !== input) {
      parts.push(
        field(
          "Value",
          display === "" ? muted("blank") : escape(display),
          isFormulaError(value) ? "field__value--error" : "",
        ),
      );
    }

    if (isFormulaError(value) && value.detail !== undefined) {
      parts.push(field("Detail", escape(value.detail), "field__value--error"));
    }

    const precedents = workbook.precedentsOf(address);
    parts.push(
      field(
        "Reads",
        precedents.length === 0 ? muted("nothing") : chips(precedents),
      ),
    );

    // A named range appears in "Reads" as the cells it expanded to, which is
    // the truth about the graph but not the truth about the formula. Naming
    // the names as well is what connects the two.
    const used = namesUsedBy(workbook, formula ?? input);
    if (used.length > 0) {
      parts.push(field("Through", used.join("<br>")));
    }

    const dependents = workbook.dependentsOf(address);
    parts.push(
      field(
        "Read by",
        dependents.length === 0 ? muted("nothing") : chips(dependents),
      ),
    );

    if (dependents.length > 0) {
      const order = workbook.recalculationOrder(address);
      parts.push(field("Recalculates", chain(order)));
    }

    this.el.body.innerHTML = parts.join("");
  }
}

/** Defined names the formula text mentions, with what each stands for. */
function namesUsedBy(workbook: Workbook, formula: string): string[] {
  if (!formula.startsWith("=")) return [];

  return workbook
    .names()
    .filter((entry) => new RegExp(`\\b${entry.name}\\b`, "i").test(formula))
    .map(
      (entry) =>
        `${escape(entry.name)} <span class="field__value--muted">${escape(
          entry.target,
        )}</span>`,
    );
}

function field(label: string, value: string, extra = ""): string {
  return `<div class="field">
    <div class="field__label">${label}</div>
    <div class="field__value ${extra}">${value}</div>
  </div>`;
}

function muted(text: string): string {
  return `<span class="field__value--muted">${escape(text)}</span>`;
}

function chips(addresses: readonly string[]): string {
  const items = addresses
    .map(
      (address) =>
        `<button type="button" class="chip" data-goto="${escape(address)}">${escape(
          address,
        )}</button>`,
    )
    .join("");
  return `<div class="chips">${items}</div>`;
}

function chain(order: readonly string[]): string {
  const steps = order
    .map((address) => `<span class="chain__step">${escape(address)}</span>`)
    .join('<span class="chain__arrow">&rarr;</span>');
  return `<div class="chain">${steps}</div>`;
}

/** Cell contents are user text and end up in `innerHTML`, so escape them. */
function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
