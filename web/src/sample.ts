/**
 * A worked example that exercises the engine rather than decorating the page.
 *
 * It is a small project appraisal: a capital outlay, six years of operating
 * cash flow, and the two numbers anyone would actually compute from them. The
 * point is that almost every cell below row 6 is a formula, so the dependency
 * graph has real depth — changing the tax rate in B4 walks through thirty cells
 * to reach the IRR, and the inspector will show that chain.
 */
export const SAMPLE_SHEET: Record<string, string> = {
  A1: "Project appraisal",

  A3: "Discount rate",
  B3: "11%",
  A4: "Tax rate",
  B4: "23%",

  A6: "Year",
  B6: "Revenue",
  C6: "Operating cost",
  D6: "EBITDA",
  E6: "Tax",
  F6: "Capex",
  G6: "Free cash flow",

  A7: "0",
  B7: "0",
  C7: "0",
  F7: "2400000",

  A8: "1",
  B8: "900000",
  C8: "620000",
  F8: "120000",

  A9: "2",
  B9: "1650000",
  C9: "980000",
  F9: "120000",

  A10: "3",
  B10: "2300000",
  C10: "1240000",
  F10: "180000",

  A11: "4",
  B11: "2750000",
  C11: "1380000",
  F11: "180000",

  A12: "5",
  B12: "3000000",
  C12: "1450000",
  F12: "180000",

  A13: "6",
  B13: "3150000",
  C13: "1490000",
  F13: "180000",

  A15: "Net present value",
  // The first flow is already at time zero, so it sits outside the discounting.
  B15: "=NPV(DiscountRate,G8:G13)+G7",
  A16: "Internal rate of return",
  B16: "=IRR(CashFlow)",
  A17: "Undiscounted total",
  B17: "=SUM(CashFlow)",
  A18: "Peak funding need",
  B18: "=MIN(CashFlow)",
  A19: "Payback achieved",
  B19: '=IF(B17>0,"yes","no")',
};

/**
 * Names the example defines.
 *
 * They are not decoration: `SUM(CashFlow)` has to recalculate when a cell
 * inside `G7:G13` changes, even though nothing in that formula names the cell.
 * The example is where that behaviour is visible.
 */
export const SAMPLE_NAMES: Record<string, string> = {
  DiscountRate: "B3",
  TaxRate: "B4",
  CashFlow: "G7:G13",
};

/** Formula columns, filled down over the seven project years. */
export function sampleFormulas(): Record<string, string> {
  const cells: Record<string, string> = {};
  for (let row = 7; row <= 13; row += 1) {
    cells[`D${row}`] = `=B${row}-C${row}`;
    cells[`E${row}`] = `=MAX(0,D${row}*TaxRate)`;
    cells[`G${row}`] = `=D${row}-E${row}-F${row}`;
  }
  return cells;
}

/** Column widths the example reads best at, by column index. */
export const SAMPLE_WIDTHS: Record<number, number> = {
  0: 176,
  1: 118,
  2: 128,
  3: 118,
  4: 112,
  5: 112,
  6: 132,
};
