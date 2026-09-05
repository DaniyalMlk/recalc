import { describe, expect, it } from "vitest";
import {
  MatrixShapeError,
  broadcast,
  broadcastShape,
  collapse,
  elementAt,
  firstMatrixError,
  fromNumericRows,
  isMatrix,
  isSingleCell,
  mapMatrix,
  matrix,
  matrixOfRows,
  numericRows,
  scalarMatrix,
  toRows,
  transposeMatrix,
} from "../src/engine/array.js";
import type { Matrix } from "../src/engine/array.js";
import { VALUE_ERROR, err, isFormulaError } from "../src/engine/errors.js";
import type { FormulaError } from "../src/engine/errors.js";
import { toNumber } from "../src/engine/value.js";
import type { Value } from "../src/engine/value.js";

/** Assert the broadcast succeeded and hand back the block it produced. */
function block(result: Matrix | FormulaError): Matrix {
  if (isFormulaError(result)) {
    throw new Error(`expected a block, got ${result.code}`);
  }
  return result;
}

const add = (a: Value, b: Value): Value => {
  const x = toNumber(a);
  const y = toNumber(b);
  if (isFormulaError(x)) return x;
  if (isFormulaError(y)) return y;
  return x + y;
};

describe("construction", () => {
  it("holds values row-major", () => {
    const m = matrix(2, 3, [1, 2, 3, 4, 5, 6]);
    expect(elementAt(m, 0, 0)).toBe(1);
    expect(elementAt(m, 0, 2)).toBe(3);
    expect(elementAt(m, 1, 0)).toBe(4);
    expect(elementAt(m, 1, 2)).toBe(6);
  });

  it("refuses a value count that does not match the shape", () => {
    expect(() => matrix(2, 3, [1, 2, 3])).toThrow(MatrixShapeError);
  });

  it("refuses a negative or fractional shape", () => {
    expect(() => matrix(-1, 2, [])).toThrow(MatrixShapeError);
    expect(() => matrix(1.5, 2, [])).toThrow(MatrixShapeError);
  });

  it("builds from nested rows", () => {
    const m = matrixOfRows([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    expect(m.rows).toBe(3);
    expect(m.cols).toBe(2);
    expect(m.values).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("refuses ragged rows", () => {
    expect(() => matrixOfRows([[1, 2], [3]])).toThrow(MatrixShapeError);
  });

  it("treats no rows as an empty block", () => {
    const m = matrixOfRows([]);
    expect(m.rows).toBe(0);
    expect(m.cols).toBe(0);
  });

  it("round-trips through nested rows", () => {
    const m = matrix(2, 3, [1, 2, 3, 4, 5, 6]);
    expect(toRows(m)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("recognises a matrix and refuses a look-alike", () => {
    expect(isMatrix(scalarMatrix(1))).toBe(true);
    expect(isMatrix({ rows: 1, cols: 1, values: [1] })).toBe(false);
    expect(isMatrix(null)).toBe(false);
    expect(isMatrix(err("#VALUE!"))).toBe(false);
  });

  it("reads out of bounds as blank rather than throwing", () => {
    const m = matrix(1, 1, [7]);
    expect(elementAt(m, 1, 0)).toBeNull();
    expect(elementAt(m, 0, -1)).toBeNull();
  });
});

describe("collapsing", () => {
  it("gives back the value of a one-cell block", () => {
    expect(collapse(scalarMatrix(42))).toBe(42);
    expect(isSingleCell(scalarMatrix(42))).toBe(true);
  });

  it("leaves anything larger as a block", () => {
    const m = matrix(1, 2, [1, 2]);
    expect(collapse(m)).toBe(m);
    expect(isSingleCell(m)).toBe(false);
  });

  it("collapses a blank to null rather than to undefined", () => {
    expect(collapse(matrix(1, 1, [null]))).toBeNull();
  });
});

describe("transpose", () => {
  it("turns rows into columns", () => {
    const m = matrix(2, 3, [1, 2, 3, 4, 5, 6]);
    const t = transposeMatrix(m);
    expect(t.rows).toBe(3);
    expect(t.cols).toBe(2);
    expect(toRows(t)).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
  });

  it("is its own inverse", () => {
    const m = matrix(3, 2, ["a", "b", true, null, 1, 2]);
    expect(transposeMatrix(transposeMatrix(m))).toEqual(m);
  });
});

describe("broadcasting", () => {
  it("combines equal shapes elementwise", () => {
    const result = broadcast(matrix(1, 3, [1, 2, 3]), matrix(1, 3, [10, 20, 30]), add);
    expect(block(result).values).toEqual([11, 22, 33]);
  });

  it("stretches a single value across a block", () => {
    const result = broadcast(matrix(2, 2, [1, 2, 3, 4]), scalarMatrix(10), add);
    expect(block(result).values).toEqual([11, 12, 13, 14]);
  });

  it("stretches a column against a row into the outer shape", () => {
    const m = block(broadcast(matrix(3, 1, [1, 2, 3]), matrix(1, 2, [10, 20]), add));
    expect(m.rows).toBe(3);
    expect(m.cols).toBe(2);
    expect(toRows(m)).toEqual([
      [11, 21],
      [12, 22],
      [13, 23],
    ]);
  });

  it("refuses shapes that do not stretch", () => {
    const result = broadcast(matrix(1, 3, [1, 2, 3]), matrix(1, 2, [1, 2]), add);
    expect(isFormulaError(result)).toBe(true);
    expect(isFormulaError(result) ? result.code : null).toBe("#VALUE!");
  });

  it("reports the shapes it could not combine", () => {
    const result = broadcast(
      matrix(2, 3, [1, 2, 3, 4, 5, 6]),
      matrix(3, 3, new Array<Value>(9).fill(0)),
      add,
    );
    const detail = isFormulaError(result) ? result.detail : undefined;
    expect(detail).toContain("2x3");
    expect(detail).toContain("3x3");
  });

  it("agrees with the shape rule it is built on", () => {
    expect(broadcastShape(matrix(3, 1, [1, 2, 3]), matrix(1, 4, [1, 2, 3, 4]))).toEqual({
      rows: 3,
      cols: 4,
    });
    expect(broadcastShape(matrix(1, 2, [1, 2]), matrix(1, 3, [1, 2, 3]))).toBeNull();
  });
});

describe("mapping and inspection", () => {
  it("maps every element, keeping the shape", () => {
    const doubled = mapMatrix(matrix(2, 2, [1, 2, 3, 4]), (v) => (v as number) * 2);
    expect(doubled.rows).toBe(2);
    expect(doubled.values).toEqual([2, 4, 6, 8]);
  });

  it("finds the first error anywhere in the block", () => {
    const m = matrix(1, 3, [1, VALUE_ERROR, 3]);
    expect(firstMatrixError(m)).toBe(VALUE_ERROR);
    expect(firstMatrixError(matrix(1, 2, [1, 2]))).toBeNull();
  });
});

describe("numeric extraction", () => {
  it("reads a block of numbers as rows", () => {
    expect(numericRows(matrix(2, 2, [1, 2, 3, 4]))).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("surfaces an error in the block rather than the type failure", () => {
    const divide = err("#DIV/0!");
    expect(numericRows(matrix(1, 2, [1, divide]))).toBe(divide);
  });

  it("refuses text, blanks and booleans", () => {
    expect(numericRows(matrix(1, 2, [1, "x"]))).toEqual(VALUE_ERROR);
    expect(numericRows(matrix(1, 2, [1, null]))).toEqual(VALUE_ERROR);
    expect(numericRows(matrix(1, 2, [1, true]))).toEqual(VALUE_ERROR);
  });

  it("refuses a non-finite number", () => {
    expect(numericRows(matrix(1, 1, [Infinity]))).toEqual(VALUE_ERROR);
  });

  it("round-trips numeric rows", () => {
    const rows = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    expect(numericRows(fromNumericRows(rows))).toEqual(rows);
  });
});
