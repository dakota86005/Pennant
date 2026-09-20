/**
 * Small, dependency-free fitting helpers for the calibration harness
 * (`scripts/calibrate.ts`): weighted least squares, correlation, and a grid search.
 *
 * Pure numeric code with no database or domain knowledge, so it can be tested on
 * known answers. The harness decides what to fit; this only does the arithmetic.
 */

export interface Fit {
  /** Coefficients in the order of the columns given; the intercept first when one was requested. */
  coefficients: number[];
  /** Weighted share of variance explained. */
  r2: number;
  /** Weighted root mean squared error of the fit. */
  rmse: number;
  n: number;
}

/** Solve A x = b by Gaussian elimination with partial pivoting; null when the system is singular. */
export function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = col + 1; r < n; r += 1) {
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c += 1) m[r][c] -= f * m[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let s = m[r][n];
    for (let c = r + 1; c < n; c += 1) s -= m[r][c] * x[c];
    x[r] = s / m[r][r];
  }
  return x;
}

/**
 * Weighted least squares of `y` on the columns of `x` (one row per observation), with an
 * intercept unless `intercept` is false. Returns null when there are too few rows or the
 * design is singular.
 */
export function wls(x: number[][], y: number[], weights?: number[], intercept = true): Fit | null {
  const n = y.length;
  const k = (x[0]?.length ?? 0) + (intercept ? 1 : 0);
  if (n <= k || k === 0) return null;
  const w = weights ?? new Array<number>(n).fill(1);
  const design = x.map((row) => (intercept ? [1, ...row] : row));
  const xtx = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let a = 0; a < k; a += 1) {
      xty[a] += w[i] * design[i][a] * y[i];
      for (let b = 0; b < k; b += 1) xtx[a][b] += w[i] * design[i][a] * design[i][b];
    }
  }
  const coefficients = solve(xtx, xty);
  if (!coefficients) return null;
  const sw = w.reduce((s, v) => s + v, 0);
  const mean = w.reduce((s, v, i) => s + v * y[i], 0) / sw;
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i += 1) {
    const pred = design[i].reduce((s, v, a) => s + v * coefficients[a], 0);
    sse += w[i] * (y[i] - pred) ** 2;
    sst += w[i] * (y[i] - mean) ** 2;
  }
  return { coefficients, r2: sst > 0 ? 1 - sse / sst : 0, rmse: Math.sqrt(sse / sw), n };
}

/** Weighted Pearson correlation. */
export function correlation(xs: number[], ys: number[], weights?: number[]): number | null {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  const w = weights ?? new Array<number>(n).fill(1);
  const sw = w.reduce((s, v) => s + v, 0);
  const mx = w.reduce((s, v, i) => s + v * xs[i], 0) / sw;
  const my = w.reduce((s, v, i) => s + v * ys[i], 0) / sw;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += w[i] * (xs[i] - mx) * (ys[i] - my);
    sxx += w[i] * (xs[i] - mx) ** 2;
    syy += w[i] * (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Weighted root mean squared error between predictions and actuals. */
export function weightedRmse(pred: number[], actual: number[], weights?: number[]): number {
  const w = weights ?? new Array<number>(pred.length).fill(1);
  const sw = w.reduce((s, v) => s + v, 0);
  return Math.sqrt(pred.reduce((s, p, i) => s + w[i] * (p - actual[i]) ** 2, 0) / sw);
}

/** Every combination of the value lists, as arrays in list order. */
export function grid(...axes: number[][]): number[][] {
  return axes.reduce<number[][]>((acc, axis) => acc.flatMap((prefix) => axis.map((v) => [...prefix, v])), [[]]);
}

/** The point of a grid that minimizes `score`; ties keep the first. */
export function bestOf<T>(points: T[], score: (point: T) => number): { point: T; score: number } | null {
  let best: { point: T; score: number } | null = null;
  for (const point of points) {
    const s = score(point);
    if (Number.isFinite(s) && (best === null || s < best.score)) best = { point, score: s };
  }
  return best;
}

export const mean = (values: number[]): number => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0);
export const stdev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
};
