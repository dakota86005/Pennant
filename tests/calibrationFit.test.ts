import { describe, expect, it } from 'vitest';
import { bestOf, correlation, grid, mean, solve, stdev, weightedRmse, wls } from '../scripts/lib/fit.js';

describe('the calibration fitting helpers', () => {
  it('solves a linear system', () => {
    expect(solve([[2, 1], [1, 3]], [5, 10])?.map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 3]);
    expect(solve([[1, 2], [2, 4]], [1, 2])).toBeNull();
  });

  it('recovers the coefficients of an exact linear relation and reports a perfect fit', () => {
    const x = [[1, 0], [2, 1], [3, 5], [4, 2], [5, 9], [6, 3]];
    const y = x.map(([a, b]) => 2 + 3 * a - 0.5 * b);
    const fit = wls(x, y);
    expect(fit).not.toBeNull();
    expect(fit!.coefficients[0]).toBeCloseTo(2, 6);
    expect(fit!.coefficients[1]).toBeCloseTo(3, 6);
    expect(fit!.coefficients[2]).toBeCloseTo(-0.5, 6);
    expect(fit!.r2).toBeCloseTo(1, 9);
    expect(fit!.rmse).toBeCloseTo(0, 6);
  });

  it('weights count: a heavily weighted point pulls the line', () => {
    const x = [[0], [1], [2], [3]];
    const y = [0, 1, 2, 10];
    const flat = wls(x, y)!;
    const heavy = wls(x, y, [1, 1, 1, 100])!;
    expect(heavy.coefficients[1]).toBeGreaterThan(flat.coefficients[1]);
  });

  it('returns null when there are too few rows or the design is singular', () => {
    expect(wls([[1]], [1])).toBeNull();
    expect(wls([[1, 2], [2, 4], [3, 6], [4, 8]], [1, 2, 3, 4])).toBeNull();
  });

  it('correlation is one for a line, minus one for its mirror, and null when nothing varies', () => {
    expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 9);
    expect(correlation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 9);
    expect(correlation([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
    expect(correlation([1, 2], [1, 2])).toBeNull();
  });

  it('weighted rmse, grid and best-of', () => {
    expect(weightedRmse([1, 2], [1, 4])).toBeCloseTo(Math.sqrt(2), 9);
    expect(weightedRmse([1, 2], [1, 4], [3, 1])).toBeCloseTo(1, 9);
    expect(grid([1, 2], [10, 20])).toEqual([[1, 10], [1, 20], [2, 10], [2, 20]]);
    expect(bestOf([1, 2, 3, 4], (v) => (v - 3) ** 2)).toEqual({ point: 3, score: 0 });
    expect(bestOf<number>([], () => 0)).toBeNull();
    expect(mean([1, 2, 3])).toBe(2);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });
});
