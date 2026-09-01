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
  importCsv: need<HTMLButtonElement>("action-import"),
  exportCsv: need<HTMLButtonElement>("action-export"),
  fileInput: need<HTMLInputElement>("file-input"),
  dropzone: need("dropzone"),
  sheet: need("sheet"),
};

const app = new App(elements);
app.start();
elements.body.focus();
