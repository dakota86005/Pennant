import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ConeSeason, ProductionCone } from '../src/api';
import { CHART_COLOR } from '../src/chartTheme';
import {
  coneGeometry, coneSummary, coverageText, formatWins, labelModeFor, niceTicks, winsDomain,
} from '../src/productionConeGeometry';
import { ProductionConeChart, SeasonDetail } from '../src/ProductionCone';
import { derivePalette } from '../src/theme';

/*
 * The player card's production cone: the geometry is pure and library-independent, and the chart draws
 * only what Player Value served. These cases pin the drawing to the answer: bands nest, negative wins
 * stay on the axis, a single season still reads, unknown production draws nothing, a narrowing cone is
 * never widened, and coverage that was not measured is never shown as the target.
 */

const cov = (outer: number | null, inner: number | null): ConeSeason['coverage'] => ({
  outer: { target: 0.8, observed: outer }, inner: { target: 0.5, observed: inner }, cases: outer === null ? null : 300,
  note: outer === null ? 'Not measured on this save: the fallback prior was not tested on its held-out seasons.' : 'Observed on 300 held-out player-seasons.',
});

const control = (label = 'Signed', short = 'Signed', code = 'Sgn', after = false): ConeSeason['control'] => ({
  status: 'under_contract', label, short, code, detail: 'Under contract.',
  after: after ? { label: 'Free agent after', short: 'FA after', code: 'FA›' } : null,
});

const s = (season: number, central: number, outer: [number, number], inner: [number, number], over: Partial<ConeSeason> = {}): ConeSeason => ({
  season, age: 27 + (season - 2030), central,
  outer: { low: outer[0], high: outer[1] }, inner: { low: inner[0], high: inner[1] },
  toDate: season === 2030 ? 0.6 : null, usage: [{ unit: 'PA', low: 400, central: 560, high: 650 }],
  coverage: cov(0.82, 0.49), control: control(), notes: [],
  ...over,
});

const cone = (seasons: ConeSeason[], over: Partial<ProductionCone> = {}): ProductionCone => ({
  playerId: 1, status: 'projected', reason: null, unit: "wins above replacement, in the export's own WAR units",
  seasons, basis: 'Major-league results 2027–2030: 2,040 PA as a hitter',
  control: { standing: 'held', note: null },
  calibration: { source: 'save_fit', calibrated: true, status: 'Calibrated on this save: 2006–2025, refit after the 2025 season', detail: 'calibrated' },
  ...over,
});

const REGULAR = [
  s(2030, 2.9, [1.6, 4.1], [2.3, 3.5]),
  s(2031, 2.8, [0.6, 5.0], [1.8, 3.8]),
  s(2032, 2.6, [0.1, 5.2], [1.4, 3.8], { control: control('Arbitration 2', 'Arb 2', 'A2') }),
  s(2033, 2.3, [-0.4, 5.1], [1.0, 3.6], { control: control('Arbitration 3', 'Arb 3', 'A3', true) }),
];

describe('the production cone geometry', () => {
  it('draws the 50% band inside the 80% band at every season', () => {
    const g = coneGeometry(REGULAR, 640);
    g.outer.forEach((o, i) => {
      const n = g.inner[i];
      // SVG y grows downwards: the top edge is the smaller number
      expect(n.top).toBeGreaterThanOrEqual(o.top);
      expect(n.bottom).toBeLessThanOrEqual(o.bottom);
      expect(g.path[i].y).toBeGreaterThanOrEqual(n.top);
      expect(g.path[i].y).toBeLessThanOrEqual(n.bottom);
    });
  });

  it('keeps negative wins and replacement level on the axis', () => {
    const below = [s(2030, -0.3, [-1.4, 0.6], [-0.8, 0.1]), s(2031, -0.5, [-1.9, 0.7], [-1.1, 0.1])];
    const [lo, hi] = winsDomain(below);
    expect(lo).toBeLessThanOrEqual(-1.9);
    expect(hi).toBeGreaterThanOrEqual(0.7);
    const g = coneGeometry(below, 640);
    expect(g.baseline).toBeGreaterThan(g.plot.top);
    expect(g.baseline).toBeLessThan(g.plot.bottom);
    expect(g.ticks).toContain(0);
    expect(g.ticks.some((t) => t < 0)).toBe(true);

    // A player entirely above replacement still shows the replacement line
    const [lo2] = winsDomain([s(2030, 6, [4, 8], [5, 7])]);
    expect(lo2).toBeLessThanOrEqual(0);
  });

  it('draws a single season as a nested interval at the centre, not an invisible area', () => {
    const g = coneGeometry([s(2030, 1.2, [0.2, 2.1], [0.7, 1.6])], 640);
    expect(g.shape).toBe('interval');
    expect(g.x).toHaveLength(1);
    expect(g.x[0]).toBeCloseTo((g.plot.left + g.plot.right) / 2, 6);
    expect(g.inner[0].top).toBeGreaterThanOrEqual(g.outer[0].top);
    expect(coneGeometry(REGULAR, 640).shape).toBe('area');
  });

  it('never widens a narrowing cone: each band is drawn at exactly its served width', () => {
    const narrowing = [s(2030, 1.0, [0.2, 1.9], [0.6, 1.4]), s(2031, 0.6, [-0.3, 1.4], [0.2, 1.0]), s(2032, 0.3, [-0.2, 0.8], [0.05, 0.55])];
    const g = coneGeometry(narrowing, 640);
    const perWin = (g.plot.bottom - g.plot.top) / (g.domain[1] - g.domain[0]);
    narrowing.forEach((x, i) => {
      expect(g.outer[i].bottom - g.outer[i].top).toBeCloseTo((x.outer.high - x.outer.low) * perWin, 6);
    });
    expect(g.outer[2].bottom - g.outer[2].top).toBeLessThan(g.outer[1].bottom - g.outer[1].top);
  });

  it('shortens season labels with a stated convention as the card narrows, so they never collide', () => {
    const seven = Array.from({ length: 7 }, (_, i) => s(2030 + i, 2, [0, 4], [1, 3], {
      control: control('Pre-arbitration', 'Pre-arb', 'Pre'),
    }));
    expect(labelModeFor(seven, 900)).toBe('full');
    expect(labelModeFor(seven, 480)).toBe('short');
    expect(labelModeFor(seven, 300)).toBe('code');
    for (const w of [300, 420, 560, 760, 900]) {
      const g = coneGeometry(seven, w);
      for (let i = 1; i < g.labels.length; i += 1) {
        expect(g.labels[i].left, `labels overlap at ${w}px`).toBeGreaterThanOrEqual(g.labels[i - 1].right);
      }
      expect(g.width).toBe(w);
    }
  });

  it('rounds the axis to clean ticks', () => {
    expect(niceTicks(-0.4, 5.2)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(niceTicks(-1.9, 0.7)).toEqual([-1.5, -1, -0.5, 0, 0.5]);
  });
});

describe('the production cone labels are honest', () => {
  it('says "not measured" when observed coverage is null, never the target as if measured', () => {
    expect(coverageText({ target: 0.8, observed: 0.82 })).toBe('80% target · 82% observed');
    expect(coverageText({ target: 0.5, observed: null })).toBe('50% target · not measured on this save');
    expect(coverageText({ target: 0.8, observed: null })).not.toMatch(/80% observed/);
  });

  it('formats wins with a true minus sign', () => {
    expect(formatWins(-0.43)).toBe('−0.4');
    expect(formatWins(2.26)).toBe('2.3');
    expect(formatWins(0)).toBe('0.0');
  });

  it('summarises the cone in words for a screen reader', () => {
    const text = coneSummary(cone(REGULAR));
    expect(text).toMatch(/2030/);
    expect(text).toMatch(/2033/);
    expect(text).toMatch(/80%/);
    expect(text).toMatch(/free agent after 2033/i);
  });
});

describe('the production cone renders', () => {
  it('draws a labelled image with its legend and calibration line', () => {
    const html = renderToStaticMarkup(createElement(ProductionConeChart, { cone: cone(REGULAR), width: 640 }));
    expect(html).toMatch(/role="img"/);
    expect(html).toMatch(/aria-label="[^"]*2030/);
    expect(html).toMatch(/80% of outcomes fall inside/);
    expect(html).toMatch(/50% of outcomes fall inside/);
    expect(html).toMatch(/Replacement/);
    expect(html).toMatch(/Calibrated on this save: 2006–2025, refit after the 2025 season/);
    // A focusable control per season, for the hover detail by keyboard
    expect(html.match(/tabindex="0"/g)?.length ?? 0).toBeGreaterThanOrEqual(REGULAR.length);
  });

  it('draws no cone for unknown production, only the reason', () => {
    const html = renderToStaticMarkup(createElement(ProductionConeChart, {
      cone: cone([], { status: 'unknown', reason: 'No major-league results in the projection window (2027–2030): pending ratings-based projection (phase 3b).' }),
      width: 640,
    }));
    expect(html).not.toMatch(/<svg/);
    expect(html).not.toMatch(/<path/);
    expect(html).toMatch(/Expected production not yet established/);
    expect(html).toMatch(/pending ratings-based projection/);
  });

  it('shows target beside observed on hover, and "not measured" where it was not', () => {
    const measured = renderToStaticMarkup(createElement(SeasonDetail, { season: REGULAR[0], basis: 'Major-league results 2027–2030: 2,040 PA as a hitter' }));
    expect(measured).toMatch(/80% target · 82% observed/);
    expect(measured).toMatch(/50% target · 49% observed/);
    expect(measured).toMatch(/2,040 PA/);
    expect(measured).toMatch(/Signed/);

    const prior = renderToStaticMarkup(createElement(SeasonDetail, { season: s(2031, 2, [0, 4], [1, 3], { coverage: cov(null, null) }), basis: 'x' }));
    expect(prior).toMatch(/80% target · not measured on this save/);
    expect(prior).toMatch(/50% target · not measured on this save/);
    expect(prior).not.toMatch(/\d+% observed/);
  });
});

describe('the chart theme', () => {
  it('uses only tokens the palette sets in both modes', () => {
    const colors = { bg: '#AB0003', fg: '#FFFFFF', secondary: '#14225A', cap: '#0A2351' };
    for (const mode of ['dark', 'light'] as const) {
      const palette = derivePalette(colors, mode);
      for (const value of Object.values(CHART_COLOR)) {
        const token = /^var\((--[a-z-]+)\)$/.exec(value)?.[1];
        expect(token, value).toBeDefined();
        expect(Object.keys(palette), `${token} in ${mode}`).toContain(token);
      }
    }
  });
});
