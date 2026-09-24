/**
 * The production cone's geometry: pure, library-independent and tested without rendering
 * (tests/productionCone.test.ts). It lays out what Player Value served and computes nothing about the
 * player: every band, central and label comes from the API (`ProductionCone`). A band is drawn at
 * exactly its served width, so a narrowing cone narrows and nothing is widened for looks.
 */

import type { ConeCoverage, ConeSeason, ConeUnestablished, ProductionCone } from './api';
import { CHART_TEXT, niceTicks, signed, textWidth, tickStep } from './chartTheme';

export { niceTicks };

/** Fixed layout: margins around the plot, the plot's height, and the label rows below it. */
export const CONE_LAYOUT = { top: 12, right: 12, left: 34, plotHeight: 180, labelGap: 10, bottom: 4, labelPad: 6 } as const;

/** Replacement level's direct label, set in the right margin where the card is wide enough to give it one. */
export const REPLACEMENT_LABEL = 'Replacement';
const REPLACEMENT_ROOM = 560;
const replacementMargin = (width: number): number =>
  (width >= REPLACEMENT_ROOM ? Math.ceil(textWidth(REPLACEMENT_LABEL, CHART_TEXT.size - 1)) + 10 : 0);

/** How long a season's labels are: in full, shortened, or as codes with a key beneath the chart. */
export type LabelMode = 'full' | 'short' | 'code';

export interface BandSpan {
  x: number;
  /** Pixel y of the band's high edge (SVG y grows downwards, so top < bottom). */
  top: number;
  bottom: number;
}

export interface SeasonLabel {
  x: number;
  left: number;
  right: number;
  lines: string[];
}

export interface ConeGeometry {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  domain: [number, number];
  ticks: number[];
  /** Pixel y of a value in wins. */
  y: (wins: number) => number;
  /** Pixel y of replacement level (0 wins). */
  baseline: number;
  /** Whether replacement level carries a direct label in the right margin (the legend always names it). */
  replacementLabel: boolean;
  /** Pixel x of each season, at the centre of its slot. */
  x: number[];
  slot: number;
  /** One season has no width to fill, so it is drawn as nested intervals rather than an area. */
  shape: 'area' | 'interval';
  outer: BandSpan[];
  inner: BandSpan[];
  path: Array<{ x: number; y: number }>;
  labelMode: LabelMode;
  labels: SeasonLabel[];
  labelTop: number;
  /** In code mode, what each code used stands for. */
  key: Array<{ code: string; label: string }>;
  /**
   * The slots of the seasons whose production is not established, after the established ones (hardening F6): nothing
   * is drawn in them but a mark saying so. Null when every season is established.
   */
  unestablished: { left: number; right: number; seasons: number[] } | null;
}

/** What a season's label reads: its year and control, established or not. */
type Labelled = Pick<ConeSeason, 'season' | 'control'>;

/** The wins axis: every band edge and central, and replacement level always, padded and rounded to ticks. */
export function winsDomain(seasons: ConeSeason[]): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const s of seasons) {
    lo = Math.min(lo, s.outer.low, s.inner.low, s.central);
    hi = Math.max(hi, s.outer.high, s.inner.high, s.central);
  }
  if (hi - lo < 1) {
    const mid = (hi + lo) / 2;
    lo = Math.min(lo, mid - 0.5);
    hi = Math.max(hi, mid + 0.5);
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const step = tickStep(lo, hi);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

const yearText = (season: number, mode: LabelMode): string => (mode === 'code' ? `’${String(season).slice(-2)}` : String(season));

function linesOf(s: Labelled, mode: LabelMode): string[] {
  const pick = (l: { label: string; short: string; code: string }) => (mode === 'full' ? l.label : mode === 'short' ? l.short : l.code);
  const lines = [yearText(s.season, mode), pick(s.control)];
  if (s.control.after) lines.push(pick(s.control.after));
  return lines;
}

const labelWidth = (lines: string[]): number => Math.max(...lines.map((l) => textWidth(l)));

const plotWidth = (width: number): number => Math.max(1, width - CONE_LAYOUT.left - CONE_LAYOUT.right - replacementMargin(width));

/** The longest labels that fit every season's slot at this width. */
export function labelModeFor(seasons: Labelled[], width: number): LabelMode {
  const slot = plotWidth(width) / Math.max(1, seasons.length);
  for (const mode of ['full', 'short'] as const) {
    if (seasons.every((s) => labelWidth(linesOf(s, mode)) + CONE_LAYOUT.labelPad <= slot)) return mode;
  }
  return 'code';
}

/**
 * The cone's layout. `pending` are the seasons after the established ones whose production is not established
 * (hardening F6): each keeps a slot and its label, and nothing is drawn or scaled for it.
 */
export function coneGeometry(seasons: ConeSeason[], width: number, pending: ConeUnestablished[] = []): ConeGeometry {
  const slots: Labelled[] = [...seasons, ...pending];
  const n = Math.max(1, slots.length);
  const plot = {
    left: CONE_LAYOUT.left,
    right: CONE_LAYOUT.left + plotWidth(width),
    top: CONE_LAYOUT.top,
    bottom: CONE_LAYOUT.top + CONE_LAYOUT.plotHeight,
  };
  const domain = winsDomain(seasons);
  const y = (v: number): number => plot.bottom - ((v - domain[0]) / (domain[1] - domain[0])) * (plot.bottom - plot.top);
  const slot = (plot.right - plot.left) / n;
  const x = slots.map((_, i) => plot.left + slot * (i + 0.5));

  const labelMode = labelModeFor(slots, width);
  const labels = slots.map((s, i) => {
    const lines = linesOf(s, labelMode);
    const w = labelWidth(lines);
    return { x: x[i], left: x[i] - w / 2, right: x[i] + w / 2, lines };
  });
  const rows = Math.max(2, ...labels.map((l) => l.lines.length));
  const labelTop = plot.bottom + CONE_LAYOUT.labelGap;

  const key = new Map<string, string>();
  if (labelMode === 'code') {
    for (const s of slots) {
      key.set(s.control.code, s.control.label);
      if (s.control.after) key.set(s.control.after.code, s.control.after.label);
    }
  }

  return {
    width,
    height: labelTop + rows * CHART_TEXT.lineHeight + CONE_LAYOUT.bottom,
    plot,
    domain,
    ticks: niceTicks(domain[0], domain[1]),
    y,
    baseline: y(0),
    replacementLabel: replacementMargin(width) > 0,
    x,
    slot,
    shape: seasons.length === 1 ? 'interval' : 'area',
    outer: seasons.map((s, i) => ({ x: x[i], top: y(s.outer.high), bottom: y(s.outer.low) })),
    inner: seasons.map((s, i) => ({ x: x[i], top: y(s.inner.high), bottom: y(s.inner.low) })),
    path: seasons.map((s, i) => ({ x: x[i], y: y(s.central) })),
    labelMode,
    labels,
    labelTop,
    key: [...key.entries()].map(([code, label]) => ({ code, label })),
    unestablished: pending.length === 0
      ? null
      : { left: plot.left + slot * seasons.length, right: plot.right, seasons: pending.map((p) => p.season) },
  };
}

/** Wins as the card prints them: one decimal and a true minus sign. */
export const formatWins = (v: number): string => signed(v, 1);

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** A band's coverage: its target beside what was observed, or "not measured" — never the target as if measured. */
export function coverageText(c: ConeCoverage): string {
  return `${pct(c.target)} target · ${c.observed === null ? 'not measured on this save' : `${pct(c.observed)} observed`}`;
}

/**
 * What the bands are, in words (D-19). With the save's own fit in force a band is stated as its
 * target, which each season's observed coverage then qualifies; with the fallback prior it is a range
 * of reasonable readings, never a claim that 80% of outcomes fall inside. Since Player Value phase 6e the legend says it in
 * plain words (AGENTS.md "Writing for the GM") and `tip` carries the method's words on hover.
 */
export function bandWords(cone: ProductionCone): { outer: string; inner: string; tip: string } {
  return cone.calibration.calibrated
    ? {
      outer: '80% range (target)', inner: '50% range (target)',
      tip: "Each band's target: the 80% band is meant to hold 8 seasons in 10 and the 50% band 5 in 10. How often they did on "
        + "this save's own seasons is in each season's detail, beside the target.",
    }
    : {
      outer: '80% range (not yet checked on this save)', inner: '50% range',
      tip: "A range of reasonable readings, not yet calibrated: not yet checked against how this save's players actually did, "
        + 'so it is not a claim that 8 seasons in 10 land inside it.',
    };
}

/** The line under the chart in plain words; the calibration statement itself (the server's) is on hover. */
export function calibrationWords(cone: ProductionCone): string {
  return cone.calibration.calibrated ? "Checked against this save's own seasons" : "Not yet checked against this save's own seasons";
}

/** Every figure a season carries is a finite number: otherwise the cone is not drawn (D-24). */
export function coneIsDrawable(cone: ProductionCone): boolean {
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  return cone.seasons.every((s) =>
    [s.central, s.outer.low, s.outer.high, s.inner.low, s.inner.high].every(finite)
    && (s.toDate === null || finite(s.toDate))
    && s.usage.every((u) => [u.low, u.central, u.high].every(finite)));
}

/** The image's accessible name: short, the seasons it spans; the figures are in the table beside it. */
export function coneLabel(cone: ProductionCone): string {
  const s = cone.seasons;
  if (s.length === 0) return 'Expected production not yet established.';
  const pending = cone.notEstablished ?? [];
  const end = pending.length > 0 ? pending[pending.length - 1].season : s[s.length - 1].season;
  const range = s[0].season === end ? `${end}` : `${s[0].season} to ${end}`;
  const later = pending.length === 0 ? '' : ` From ${pending[0].season} not established.`;
  return `Expected wins above replacement per season, ${range}.${later} Each season's figures are in the table that follows.`;
}

/** The whole cone in words, for a screen reader: every season's central, both bands and control. */
export function coneSummary(cone: ProductionCone): string {
  const s = cone.seasons;
  if (s.length === 0) return `Expected production not yet established: ${cone.reason ?? 'no reason stated'}.`;
  const pending = cone.notEstablished ?? [];
  const end = pending.length > 0 ? pending[pending.length - 1].season : s[s.length - 1].season;
  const range = s[0].season === end ? `${end}` : `${s[0].season} to ${end}`;
  const words = cone.calibration.calibrated ? { outer: '80% band', inner: '50% band' } : { outer: '80% readings', inner: '50% readings' };
  const each = s.map((x) =>
    `${x.season}, ${x.control.label.toLowerCase()}: ${formatWins(x.central)} wins expected; ` +
    `${words.outer} ${formatWins(x.outer.low)} to ${formatWins(x.outer.high)}, ${words.inner} ${formatWins(x.inner.low)} to ${formatWins(x.inner.high)}` +
    (x.control.after ? `; ${x.control.after.label.toLowerCase()} ${x.season}` : ''));
  // A season not established says so and why: never a zero, never left out silently (hardening F6)
  for (const x of cone.notEstablished ?? []) {
    each.push(`${x.season}, ${x.control.label.toLowerCase()}: expected production not established (${x.reason.replace(/\.$/, '')})` +
      (x.control.after ? `; ${x.control.after.label.toLowerCase()} ${x.season}` : ''));
  }
  return `Expected wins above replacement per season, ${range}. ${each.join('. ')}. ${cone.calibration.status}.`;
}
