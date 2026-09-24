/**
 * The Trade Center's difference bar, laid out (D-054: a chart's geometry is a pure function beside it). The scale is
 * symmetric about zero, so a distance to the left reads the same as one to the right, and zero ("even") is always on it;
 * the range and the most likely reading are placed on it in order. Nothing about the deal is computed here: the figure is
 * the server's, as served.
 */

export interface DifferenceFigure {
  low: number;
  central: number | null;
  high: number;
  centralRange: { low: number; high: number } | null;
}

export interface DifferenceGeometry {
  width: number;
  /** The value at the left and right ends, symmetric about zero. */
  domain: [number, number];
  zero: number;
  low: number;
  high: number;
  /** The most likely reading: a point (equal edges) or the range of readings where a season is open. */
  likelyLow: number;
  likelyHigh: number;
  /** Where a value falls on the bar, in pixels from the left, clamped inside the width. */
  x: (v: number) => number;
}

/** Room at each end so a marker at the edge of the scale is drawn whole. */
export const BAR_PAD = 10;

export function differenceGeometry(f: DifferenceFigure, width: number): DifferenceGeometry {
  const likely = f.central !== null ? { low: f.central, high: f.central } : f.centralRange ?? { low: f.low, high: f.high };
  const values = [f.low, f.high, likely.low, likely.high].filter((v) => Number.isFinite(v));
  const reach = Math.max(0, ...values.map((v) => Math.abs(v)));
  // A little air past the furthest edge; a deal whose every figure is zero still gets a scale
  const half = reach > 0 ? reach * 1.12 : 1;
  const inner = Math.max(1, width - 2 * BAR_PAD);
  const x = (v: number) => {
    const at = BAR_PAD + ((Math.max(-half, Math.min(half, v)) + half) / (2 * half)) * inner;
    return Math.max(0, Math.min(width, at));
  };
  return {
    width,
    domain: [-half, half],
    zero: x(0),
    low: x(f.low),
    high: x(f.high),
    likelyLow: x(likely.low),
    likelyHigh: x(likely.high),
    x,
  };
}
