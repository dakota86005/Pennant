import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ConeSeason, ConeUnestablished, ProductionCone } from '../src/api';
import { CHART_COLOR } from '../src/chartTheme';
import {
  coneGeometry, coneLabel, coneSummary, coverageText, formatWins, labelModeFor, niceTicks, winsDomain,
} from '../src/productionConeGeometry';
import { ProductionConeChart, SeasonDetail, UnestablishedDetail } from '../src/ProductionCone';
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
    // A band is stated as its target (hardening F2, D-19): "80% of outcomes fall inside" is a claim
    // the calibration line and each season's observed coverage qualify
    expect(html).toMatch(/80% band \(target\)/);
    expect(html).toMatch(/50% band \(target\)/);
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

  it("shows each season's cost as served, with its basis, and an unknown cost as not established with its reason (phase 4a)", () => {
    const arb = s(2032, 2.6, [0.1, 5.2], [1.4, 3.8], {
      control: { ...control('Arbitration 2–3', 'Arb 2–3', 'A2–3'), cost: { low: 4_100_000, high: 31_700_000 }, costDetail: 'Arbitration class 2–3: the save\'s ladder (class 2 measured on 51 contracts).' },
    });
    const html = renderToStaticMarkup(createElement(SeasonDetail, { season: arb, basis: 'x' }));
    expect(html).toMatch(/Cost/);
    expect(html).toMatch(/\$4\.1M–\$31\.7M/);
    expect(html).toMatch(/measured on 51 contracts/);
    const unknown = s(2033, 2.3, [-0.4, 5.1], [1.0, 3.6], {
      control: { ...control('Arbitration 3', 'Arb 3', 'A3'), cost: null, costDetail: 'His production in 2032, a platform season, is not established.' },
    });
    const u = renderToStaticMarkup(createElement(SeasonDetail, { season: unknown, basis: 'x' }));
    expect(u).toMatch(/not established/);
    expect(u).not.toMatch(/\$0/);
    // Every figure the detail shows is also in the hidden table
    const table = renderToStaticMarkup(createElement(ProductionConeChart, { cone: cone([REGULAR[0], REGULAR[1], arb]), width: 640 }));
    expect(table).toMatch(/<th>Cost<\/th>/);
    expect(table).toMatch(/\$4\.1M–\$31\.7M/);
  });
});

/* Hardening (F2, 2026-09-23): D-19, D-20, D-22, D-23 and D-24. */
describe('the production cone, hardening (F2)', () => {
  const prior = (seasons: ConeSeason[]) => cone(seasons, {
    calibration: { source: 'fallback_prior', calibrated: false, status: 'Not yet calibrated on this save (0 seasons)', detail: 'the fallback prior' },
  });
  const render = (c: ProductionCone, width = 640) => renderToStaticMarkup(createElement(ProductionConeChart, { cone: c, width }));

  it('never says "80% of outcomes fall inside" while the prior is in force: the bands are reasonable readings', () => {
    const html = render(prior(REGULAR));
    expect(html).not.toMatch(/of outcomes fall inside/);
    expect(html).toMatch(/reasonable readings/);
    expect(coneSummary(prior(REGULAR))).not.toMatch(/of outcomes/);
  });

  it('carries every value the detail shows in the table for screen readers, and keeps the image\'s name short', () => {
    const html = render(cone(REGULAR));
    const table = html.slice(html.indexOf('<table'));
    for (const heading of ['Age', 'Banked', 'Playing time', 'Control']) expect(table).toMatch(new RegExp(`<th[^>]*>${heading}`));
    expect(table).toMatch(/0\.6/);
    expect(table).toMatch(/about 560 PA/);
    expect(table).toMatch(/Under contract\./);
    expect(table).toMatch(/Rests on: Major-league results/);
    const label = /<svg[^>]*aria-label="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThan(200);
  });

  it('gives the season controls a visible focus ring', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src', 'styles.css'), 'utf8');
    expect(css).toMatch(/\.cone-hit:focus-visible\s*\{[^}]*outline:\s*2px/);
  });

  it('never prints a near-zero edge as "0.0"', () => {
    expect(formatWins(0.04)).toBe('<0.1');
    expect(formatWins(-0.04)).toBe('−<0.1');
    expect(formatWins(0)).toBe('0.0');
    expect(formatWins(0.05)).toBe('0.1');
  });

  it('never lets a non-finite number blank the card', () => {
    expect(formatWins(Number.NaN)).toBe('—');
    expect(formatWins(null as unknown as number)).toBe('—');
    const broken = cone([s(2030, Number.NaN, [1, 2], [1.2, 1.8]), s(2031, 1.5, [0.5, Number.POSITIVE_INFINITY], [1, 2])]);
    expect(() => render(broken)).not.toThrow();
    expect(render(broken)).toMatch(/could not be drawn/);
  });
});

/* Hardening F6 (2026-09-23): the arrival model adopted horizon by horizon; later seasons are not established. */
describe('the production cone, a known-then-unknown path (hardening F6)', () => {
  const REASON = '4 seasons out: the save\'s held-out arrival chance ran 17% low, outside the gate';
  const pending = (season: number, over: Partial<ConeUnestablished> = {}): ConeUnestablished => ({
    season, age: 27 + (season - 2030), reason: REASON.replace('4', String(season - 2030)), control: control('Arbitration 2', 'Arb 2', 'A2'), ...over,
  });
  const PENDING = [pending(2032), pending(2033, { control: control('Arbitration 3', 'Arb 3', 'A3', true) })];
  const KNOWN = REGULAR.slice(0, 2);
  const partial = () => cone(KNOWN, {
    notEstablished: PENDING,
    calibration: { source: 'save_fit', calibrated: false, status: 'Not yet calibrated on this save: arrival calibrated through 1 season out (2032–2036 not established)', detail: 'test' },
  });
  const render = (c: ProductionCone, width = 640) => renderToStaticMarkup(createElement(ProductionConeChart, { cone: c, width }));

  it('draws the bands and the central over the established seasons only, and keeps a slot and a label for each season not established', () => {
    const g = coneGeometry(KNOWN, 640, PENDING);
    expect(g.x).toHaveLength(4);
    expect(g.labels.map((l) => l.lines[0])).toEqual(['2030', '2031', '2032', '2033']);
    expect(g.outer).toHaveLength(2);
    expect(g.inner).toHaveLength(2);
    expect(g.path).toHaveLength(2);
    expect(g.shape).toBe('area');
    // The axis is the established seasons' own: nothing is drawn, and nothing is scaled, for a season with no figure
    expect(g.domain).toEqual(winsDomain(KNOWN));
    expect(g.unestablished).not.toBeNull();
    expect(g.unestablished!.left).toBeCloseTo(g.x[1] + g.slot / 2, 6);
    expect(g.unestablished!.right).toBeCloseTo(g.plot.right, 6);
    expect(g.unestablished!.seasons).toEqual([2032, 2033]);
    // One established season is still an interval, not an invisible area
    expect(coneGeometry(KNOWN.slice(0, 1), 640, PENDING).shape).toBe('interval');
    // Fully established: no region
    expect(coneGeometry(REGULAR, 640).unestablished).toBeNull();
  });

  it('marks the later seasons not established, with the reason on hover and in the table, and no band or zero drawn there', () => {
    const html = render(partial());
    expect(html).toMatch(/Production not established/);
    expect(html.match(/tabindex="0"/g)?.length ?? 0).toBe(4);
    expect(html).toMatch(/aria-label="2032, Arbitration 2: expected production not established/);
    const table = html.slice(html.indexOf('<table'));
    expect(table).toMatch(/2032/);
    expect(table).toMatch(/2 seasons out: the save&#x27;s held-out arrival chance ran 17% low/);
    expect(coneSummary(partial())).toMatch(/2033, arbitration 3: expected production not established/);
    expect(coneSummary(partial())).toMatch(/through 1 season out/);
    expect(coneLabel(partial())).toMatch(/2030 to 2033/);
    const detail = renderToStaticMarkup(createElement(UnestablishedDetail, { season: PENDING[0] }));
    expect(detail).toMatch(/not established/i);
    expect(detail).toMatch(/2 seasons out/);
    expect(detail).not.toMatch(/80% band/);
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
