import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { caughtStealingRunsFrom, computeBatting, STEAL_RUNS_FALLBACK, WOBA_SCALE_FALLBACK, wobaScaleFrom, type LeagueBaseline, type RunTotals } from '../server/stats.js';

// A major-league season's batting totals (a modern run environment: about 4.45 runs a game)
const MODERN: RunTotals = {
  pa: 182926, ab: 163664, h: 40138, d: 7745, t: 628, hr: 5650, bb: 15379, ibb: 556, hp: 1928, sf: 1307, sh: 560, sb: 3440, cs: 989, gdp: 3121, r: 21614,
};

describe('the wOBA scale is the league-season\'s own (cycle 2, D-053)', () => {
  it('derives about 1.2 for a modern major-league season from its totals', () => {
    const s = wobaScaleFrom(MODERN);
    expect(s.basis).toBe('derived');
    expect(s.value).toBeGreaterThan(1.18);
    expect(s.value).toBeLessThan(1.23);
  });

  it('a low-scoring environment makes a point of wOBA worth more runs, a high-scoring one fewer', () => {
    const low = wobaScaleFrom({ ...MODERN, r: Math.round(MODERN.r * 0.8) });
    const high = wobaScaleFrom({ ...MODERN, r: Math.round(MODERN.r * 1.15) });
    expect(low.value).toBeGreaterThan(wobaScaleFrom(MODERN).value);
    expect(high.value).toBeLessThan(wobaScaleFrom(MODERN).value);
  });

  it('a total the export does not record is unknown, never zero: the labelled fallback serves, with why', () => {
    for (const k of ['cs', 'sf', 'gdp', 'ibb', 'hp', 'sb'] as const) {
      const s = wobaScaleFrom({ ...MODERN, [k]: undefined });
      expect(s).toMatchObject({ value: WOBA_SCALE_FALLBACK, basis: 'fallback' });
      expect(s.reason).toContain(k.toUpperCase());
      expect(wobaScaleFrom({ ...MODERN, [k]: 0 }).basis).toBe('fallback');
    }
    expect(wobaScaleFrom({ ...MODERN, pa: 5000 }).reason).toMatch(/fewer than/);
    // sacrifice bunts can truly be few (zero is zero), but an unrecorded column is unknown
    expect(wobaScaleFrom({ ...MODERN, sh: 0 }).basis).toBe('derived');
    expect(wobaScaleFrom({ ...MODERN, sh: undefined }).reason).toMatch(/SH/);
  });

  it('a caught stealing needs only the runs and the outs: an unrecorded walk or steal total does not stop it', () => {
    expect(caughtStealingRunsFrom({ ...MODERN, ibb: undefined, hp: undefined, sb: undefined }).basis).toBe('derived');
    expect(caughtStealingRunsFrom({ ...MODERN, gdp: undefined }).basis).toBe('fallback');
  });

  it('a caught stealing costs about -(2 x runs per out + 0.075), else the fallback', () => {
    const cs = caughtStealingRunsFrom(MODERN);
    expect(cs.basis).toBe('derived');
    expect(cs.value).toBeGreaterThan(-0.43);
    expect(cs.value).toBeLessThan(-0.39);
    expect(caughtStealingRunsFrom({ ...MODERN, cs: undefined })).toMatchObject({ value: STEAL_RUNS_FALLBACK.cs, basis: 'fallback' });
  });

  it('wRC+ reads the season\'s scale: a larger scale pulls a hitter toward 100', () => {
    const base = (value: number): LeagueBaseline => ({
      year: 2030, lgOBP: 0.32, lgSLG: 0.41, lgWOBA: 0.315, lgRperPA: 0.118, lgERA: 4.2, lgFIPRaw: 1.1,
      wobaScale: { value, basis: 'derived', reason: null }, caughtStealingRuns: { value: -0.4, basis: 'derived', reason: null }, parkFactor: new Map(),
    });
    const line = { pa: 600, ab: 520, h: 160, d: 35, t: 3, hr: 30, bb: 70, ibb: 5, hp: 5, sf: 5 };
    const at = (v: number) => computeBatting(line, base(v), null).wrcPlus as number;
    expect(at(1.1)).toBeGreaterThan(at(1.2));
    expect(at(1.3)).toBeLessThan(at(1.2));
  });

  it('one source: no module holds its own wOBA scale literal', () => {
    for (const file of ['stats.ts', 'mlbCalibrationRefit.ts']) {
      const code = readFileSync(new URL(`../server/${file}`, import.meta.url), 'utf8');
      expect(code, file).not.toMatch(/\bWOBA_SCALE\s*=/);
      expect(code, file).not.toMatch(/\/\s*1\.2\b/);
    }
  });
});
