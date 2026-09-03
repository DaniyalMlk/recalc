/**
 * The what-if panel: three forms, one output area, no logic of its own.
 *
 * Everything this file decides is about elements. What to *say* is worked out
 * in `core/whatif.ts`, which never touches the DOM and is tested on its own —
 * the same split the grid, the selection and the formats already use.
 */

import { ScenarioSet } from "../../../src/analysis/scenarios.js";
import type { Workbook } from "../../../src/engine/workbook.js";
import {
  applyScenario,
  captureScenario,
  readAddress,
  runGoalSeek,
  runSummary,
  runTable,
  scenarioRows,
} from "../core/whatif.js";
import type { WhatIfView } from "../core/whatif.js";

export type AnalysisMode = "seek" | "table" | "cases";

export interface WhatIfElements {
  readonly panel: HTMLElement;
  readonly modes: Record<AnalysisMode, HTMLButtonElement>;
  readonly forms: Record<AnalysisMode, HTMLFormElement>;
  readonly out: HTMLElement;

  readonly seekTarget: HTMLInputElement;
  readonly seekTo: HTMLInputElement;
  readonly seekChanging: HTMLInputElement;
  readonly seekApply: HTMLButtonElement;

  readonly tableResult: HTMLInputElement;
  readonly tableInput: HTMLInputElement;
  readonly tableAxis: HTMLInputElement;
  readonly tableCross: HTMLInputElement;
  readonly tableCrossAxis: HTMLInputElement;
  readonly tableWrite: HTMLButtonElement;

  readonly caseName: HTMLInputElement;
  readonly caseSource: HTMLElement;
  readonly caseList: HTMLElement;
  readonly caseResults: HTMLInputElement;
  readonly caseSummary: HTMLButtonElement;
}

/** What the panel needs to know about the sheet around it. */
export interface WhatIfHost {
  readonly workbook: Workbook;
  /** The active cell, as `B7`. */
  activeAddress(): string;
  /** The selection, as `B7` or `B7:B9`. */
  selectionBlock(): string;
  /** Redraw the grid after the panel has written to the sheet. */
  afterEdit(message: string): void;
}

export class WhatIfPanel {
  private mode: AnalysisMode = "seek";
  readonly scenarios = new ScenarioSet();

  constructor(
    private readonly el: WhatIfElements,
    private readonly host: WhatIfHost,
  ) {
    for (const mode of ["seek", "table", "cases"] as const) {
      this.el.modes[mode].addEventListener("click", () => this.setMode(mode));
    }

    this.el.panel.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-fill]",
      );
      if (button === null) return;
      this.fill(button.dataset["fill"] ?? "");
    });

    this.el.forms.seek.addEventListener("submit", (event) => {
      event.preventDefault();
      this.solve(false);
    });
    this.el.seekApply.addEventListener("click", () => this.solve(true));

    this.el.forms.table.addEventListener("submit", (event) => {
      event.preventDefault();
      this.buildTable(null);
    });
    this.el.tableWrite.addEventListener("click", () => {
      this.buildTable(this.host.activeAddress());
    });

    this.el.forms.cases.addEventListener("submit", (event) => {
      event.preventDefault();
      this.capture();
    });
    this.el.caseSummary.addEventListener("click", () => this.summarise());

    this.el.caseList.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-case]",
      );
      if (button === null) return;
      const name = button.dataset["case"] ?? "";
      if (button.dataset["act"] === "forget") {
        this.scenarios.delete(name);
        this.renderCases();
        this.show({ kind: "note", message: `Removed ${name}.` });
        return;
      }
      this.render(applyScenario(this.host.workbook, this.scenarios, name));
      this.host.afterEdit(`applied ${name}`);
      this.renderCases();
    });

    this.setMode("seek");
  }

  /**
   * Prefill whatever the selection can sensibly fill.
   *
   * Only fields that are still empty: someone who typed `B12` and then clicked
   * a cell to read its value off the grid has not asked for their form to be
   * rewritten, and a panel that helpfully undid their typing would be worse
   * than one that did nothing.
   */
  syncSelection(): void {
    const active = this.host.activeAddress();
    const block = this.host.selectionBlock();
    this.el.caseSource.textContent = `Takes ${block} as it stands.`;

    for (const input of [
      this.el.seekTarget,
      this.el.tableResult,
    ]) {
      if (input.value.trim() === "") input.value = active;
    }
    if (this.el.caseResults.value.trim() === "") {
      this.el.caseResults.value = block;
    }
  }

  /** Called when the sheet changed under the panel. */
  refresh(): void {
    this.renderCases();
  }

  /** Move the scenarios with a structural edit, as the shell does. */
  get scenarioSet(): ScenarioSet {
    return this.scenarios;
  }

  private setMode(mode: AnalysisMode): void {
    this.mode = mode;
    for (const key of ["seek", "table", "cases"] as const) {
      const on = key === mode;
      this.el.modes[key].setAttribute("aria-selected", String(on));
      this.el.forms[key].hidden = !on;
    }
    this.el.out.replaceChildren();
    if (mode === "cases") this.renderCases();
    this.seedDefaults();
  }

  /**
   * Give the forms something workable the first time each is opened.
   *
   * An empty axis field is a small puzzle - the syntax is in the hint below it
   * but a reader has to stop and compose one. Seeding a span around whatever
   * the input cell currently holds turns the first use into pressing Build.
   */
  private seedDefaults(): void {
    if (this.mode !== "table" || this.el.tableAxis.value.trim() !== "") return;
    const input = readAddress(this.el.tableInput.value);
    const current = input === null ? null : this.host.workbook.getValue(input);
    if (typeof current === "number" && Number.isFinite(current)) {
      const step = current === 0 ? 1 : Math.abs(current) / 10;
      this.el.tableAxis.value = `${trim(current)}~${trim(step)}/5`;
    }
  }

  private fill(id: string): void {
    const field = this.field(id);
    if (field === null) return;
    field.value =
      id === "case-results" || id === "table-axis"
        ? this.host.selectionBlock()
        : this.host.activeAddress();
    field.focus();
    if (id === "table-input") this.seedDefaults();
  }

  private field(id: string): HTMLInputElement | null {
    const found = this.el.panel.querySelector<HTMLInputElement>(`#${id}`);
    return found;
  }

  private solve(apply: boolean): void {
    const view = runGoalSeek(
      this.host.workbook,
      {
        target: this.el.seekTarget.value,
        to: this.el.seekTo.value,
        changing: this.el.seekChanging.value,
      },
      apply,
    );
    this.render(view);
    if (apply && view.kind === "seek" && view.converged) {
      this.host.afterEdit("goal seek");
    }
  }

  private buildTable(into: string | null): void {
    const view = runTable(
      this.host.workbook,
      {
        result: this.el.tableResult.value,
        input: this.el.tableInput.value,
        axis: this.el.tableAxis.value,
        crossInput: this.el.tableCross.value,
        crossAxis: this.el.tableCrossAxis.value,
      },
      into,
    );
    this.render(view);
    if (into !== null && view.kind === "note") this.host.afterEdit("table");
  }

  private capture(): void {
    this.render(
      captureScenario(
        this.host.workbook,
        this.scenarios,
        this.el.caseName.value,
        this.host.selectionBlock(),
      ),
    );
    this.el.caseName.value = "";
    this.renderCases();
  }

  private summarise(): void {
    this.render(
      runSummary(this.host.workbook, this.scenarios, this.el.caseResults.value),
    );
  }

  private show(view: WhatIfView): void {
    this.render(view);
  }

  private render(view: WhatIfView): void {
    this.el.out.replaceChildren(renderView(view));
  }

  private renderCases(): void {
    const rows = scenarioRows(this.host.workbook, this.scenarios);
    this.el.caseList.replaceChildren(
      ...rows.map((row) => {
        const item = document.createElement("li");
        item.className = "case";

        const body = document.createElement("div");
        body.className = "case__body";

        const name = document.createElement("div");
        name.className = "case__name";
        name.textContent = row.name;

        const detail = document.createElement("div");
        detail.className =
          row.conflicts.length > 0
            ? "case__detail case__detail--warn"
            : "case__detail";
        detail.textContent =
          row.conflicts.length > 0
            ? `would overwrite ${row.conflicts.join(", ")}`
            : row.summary;
        detail.title = row.summary;

        body.append(name, detail);

        const apply = document.createElement("button");
        apply.type = "button";
        apply.className = "pick";
        apply.textContent = "Apply";
        apply.dataset["case"] = row.name;

        const forget = document.createElement("button");
        forget.type = "button";
        forget.className = "pick";
        forget.textContent = "Drop";
        forget.dataset["case"] = row.name;
        forget.dataset["act"] = "forget";

        item.append(body, apply, forget);
        return item;
      }),
    );
  }
}

/** Two significant figures for a seeded axis, without a trailing `.00`. */
function trim(value: number): string {
  return String(Number(value.toPrecision(3)));
}

function renderView(view: WhatIfView): HTMLElement {
  if (view.kind === "table") return renderTable(view);

  const box = document.createElement("div");
  if (view.kind === "seek") {
    box.className = view.converged
      ? "result"
      : view.structural
        ? "result result--structural"
        : "result result--error";

    const headline = document.createElement("div");
    headline.className = "result__headline";
    headline.textContent = view.headline;
    box.append(headline);

    if (view.detail !== "") {
      const detail = document.createElement("p");
      detail.className = "result__detail";
      detail.textContent = view.detail;
      box.append(detail);
    }
    if (view.applied) {
      const flag = document.createElement("span");
      flag.className = "result__flag";
      flag.textContent = "written to the sheet";
      box.append(flag);
    }
    return box;
  }

  box.className =
    view.kind === "error" ? "result result--error" : "result result--note";
  const headline = document.createElement("div");
  headline.className = "result__headline";
  headline.textContent = view.message;
  box.append(headline);
  return box;
}

function renderTable(view: Extract<WhatIfView, { kind: "table" }>): HTMLElement {
  const wrap = document.createElement("div");

  const scroller = document.createElement("div");
  scroller.className = "grid-wrap";

  const table = document.createElement("table");
  table.className = "grid-out";

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const text of view.header) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = text;
    headRow.append(th);
  }
  head.append(headRow);

  const body = document.createElement("tbody");
  for (const row of view.rows) {
    const tr = document.createElement("tr");
    if (row.muted === true) tr.dataset["muted"] = "true";
    for (const text of row.cells) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    body.append(tr);
  }

  table.append(head, body);
  scroller.append(table);
  wrap.append(scroller);

  if (view.note !== undefined) {
    const note = document.createElement("p");
    note.className = "out-note";
    note.textContent = view.note;
    wrap.append(note);
  }
  return wrap;
}
