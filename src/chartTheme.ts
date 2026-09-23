/**
 * Pennant's chart conventions (D-054). Charts are SVG drawn with visx and styled only through the
 * theme's CSS variables, so every club's generated palette, light and dark, reaches them with no chart
 * of its own colours (src/theme.ts sets the variables; tests/productionCone.test.ts checks each token
 * here is one the palette sets in both modes).
 *
 * What lives here is library-independent: colour tokens, mark sizes, the text measure used to keep
 * labels from colliding, and clean axis ticks. A chart's own geometry lives in a pure module beside it
 * (e.g. productionConeGeometry.ts) and is tested without rendering.
 */

/** Colour tokens. Text wears ink or muted, never the data colour; marks wear `mark`. */
export const CHART_COLOR = {
  /** Primary text: values, the active season. */
  ink: 'var(--text)',
  /** Secondary text: ticks, labels, notes. */
  muted: 'var(--muted)',
  /** Gridlines: a hairline one step off the surface. */
  grid: 'var(--border)',
  /** The surface the chart sits on: the ring around a marker. */
  surface: 'var(--panel)',
  /** The data. */
  mark: 'var(--accent)',
} as const;

/** Washes of the mark colour for bands: an outer interval and a visibly stronger inner one. */
export const CHART_OPACITY = { outerBand: 0.16, innerBand: 0.34 } as const;

/** Mark sizes in pixels (the dataviz spec: 2px lines, markers of at least 8px with a 2px surface ring). */
export const CHART_MARK = { line: 2, marker: 4, markerActive: 5, ring: 2, interval: 20, hit: 24 } as const;

/** Chart text: the card's body face at the size of its small print. */
export const CHART_TEXT = { family: 'var(--font-body)', size: 11, lineHeight: 14 } as const;

/**
 * A conservative estimate of a label's rendered width. Used before render to choose a label length
 * that fits, so labels are shortened by rule rather than clipped or overlapped.
 */
export function textWidth(text: string, size: number = CHART_TEXT.size): number {
  return [...text].length * size * 0.56;
}

/** A tick step of 1, 2 or 5 times a power of ten, near (hi − lo) / count. */
export function tickStep(lo: number, hi: number, count = 5): number {
  const raw = Math.abs(hi - lo) / Math.max(1, count);
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = Math.floor(Math.log10(raw));
  const error = raw / 10 ** power;
  const factor = error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.sqrt(2) ? 2 : 1;
  return factor * 10 ** power;
}

/** Clean ticks inside [lo, hi], rounded so floating-point steps print cleanly. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const step = tickStep(lo, hi, count);
  const out: number[] = [];
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + step * 1e-9; t += step) {
    const v = Number(t.toFixed(decimals));
    out.push(Object.is(v, -0) ? 0 : v);
  }
  return out;
}

/** A number with a true minus sign, as the card prints signed values. */
export function signed(v: number, digits = 1): string {
  const text = v.toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : text.replace('-', '−');
}
