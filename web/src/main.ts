import { App } from "./ui/app.js";
import type { AppElements } from "./ui/app.js";

function need<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing element #${id}`);
  return node as T;
}

const elements: AppElements = {
  body: need("body"),
  canvas: need("canvas"),
  cellLayer: need("cell-layer"),
  markLayer: need("mark-layer"),
  colHeadTrack: need("colhead-track"),
  rowHeadTrack: need("rowhead-track"),
  cellInput: need<HTMLInputElement>("cell-input"),
  formulaInput: need<HTMLInputElement>("formula-input"),
  formulaInk: need("formula-ink"),
  formulaNote: need("formula-note"),
  addressBox: need("address-box"),
  inspectorTitle: need("inspector-title"),
  inspectorKind: need("inspector-kind"),
  inspectorBody: need("inspector-body"),
  statusSelection: need("status-selection"),
  statusStats: need("status-stats"),
  statusRecalc: need("status-recalc"),
  sheetName: need("sheet-name"),
  loadSample: need<HTMLButtonElement>("action-sample"),
  clearSheet: need<HTMLButtonElement>("action-clear"),
  undo: need<HTMLButtonElement>("action-undo"),
  redo: need<HTMLButtonElement>("action-redo"),
  formatButton: need<HTMLButtonElement>("action-format"),
  importCsv: need<HTMLButtonElement>("action-import"),
  exportCsv: need<HTMLButtonElement>("action-export"),
  fileInput: need<HTMLInputElement>("file-input"),
  dropzone: need("dropzone"),
  sheet: need("sheet"),
  cellPanel: need("panel-cell"),
  cellTab: need<HTMLButtonElement>("tab-cell"),
  whatIfTab: need<HTMLButtonElement>("tab-whatif"),
  whatIf: {
    panel: need("panel-whatif"),
    modes: {
      seek: need<HTMLButtonElement>("mode-seek"),
      table: need<HTMLButtonElement>("mode-table"),
      cases: need<HTMLButtonElement>("mode-cases"),
    },
    forms: {
      seek: need<HTMLFormElement>("form-seek"),
      table: need<HTMLFormElement>("form-table"),
      cases: need<HTMLFormElement>("form-cases"),
    },
    out: need("whatif-out"),

    seekTarget: need<HTMLInputElement>("seek-target"),
    seekTo: need<HTMLInputElement>("seek-to"),
    seekChanging: need<HTMLInputElement>("seek-changing"),
    seekApply: need<HTMLButtonElement>("seek-apply"),

    tableResult: need<HTMLInputElement>("table-result"),
    tableInput: need<HTMLInputElement>("table-input"),
    tableAxis: need<HTMLInputElement>("table-axis"),
    tableCross: need<HTMLInputElement>("table-cross"),
    tableCrossAxis: need<HTMLInputElement>("table-cross-axis"),
    tableWrite: need<HTMLButtonElement>("table-write"),

    caseName: need<HTMLInputElement>("case-name"),
    caseSource: need("case-source"),
    caseList: need("case-list"),
    caseResults: need<HTMLInputElement>("case-results"),
    caseSummary: need<HTMLButtonElement>("case-summary"),
  },
};

const app = new App(elements);
app.start();
elements.body.focus();
