import { describe, expect, it } from 'vitest';
import {
  hitterRates, percentileAmong, pitcherRates, reliability, RESULTS_CALIBRATION, SEASON_WEIGHTS, STABILIZATION,
  weightedBatting, weightedPitching, wobaOf, type BattingLine, type PitchingLine, type SeasonEnvironment,
} from '../server/resultsMetrics';

/*
 * Results are arithmetic on facts: league-relative, recency weighted, and honest about sample.
 */

const bat = (year: number, over: Partial<BattingLine> = {}): BattingLine => ({
  year, g: 150, gs: 150, pa: 600, ab: 540, h: 150, d: 30, t: 3, hr: 20, bb: 50, ibb: 0, hp: 5, sf: 5, k: 120, sb: 5, cs: 2, gdp: 10, war: 3, ubr: 0, ...over,
});
const pit = (year: number, over: Partial<PitchingLine> = {}): PitchingLine => ({
  year, g: 30, gs: 30, gf: 0, outs: 540, bf: 750, er: 70, r: 75, ha: 170, hra: 20, bb: 50, hp: 5, k: 180, sv: 0, hld: 0, war: 3, li: 0, ...over,
});
const env = (years: number[], woba = 0.320): Map<number, SeasonEnvironment> =>
  new Map(years.map((y) => [y, { year: y, woba, fipRaw: 0.9, era: 4.2 }]));

describe('wOBA and rates', () => {
  it('computes wOBA from the linear weights and is null with no opportunities', () => {
    const w = wobaOf(bat(2030));
    expect(w).toBeGreaterThan(0.3);
    expect(w).toBeLessThan(0.4);
    expect(wobaOf(bat(2030, { ab: 0, bb: 0, hp: 0, sf: 0, h: 0, d: 0, t: 0, hr: 0 }))).toBeNull();
  });

  it('a better hitter has a higher wOBA', () => {
    expect(wobaOf(bat(2030, { hr: 40, h: 170 }))!).toBeGreaterThan(wobaOf(bat(2030))!);
  });

  it('reports the usual rates', () => {
    const r = hitterRates(bat(2030));
    expect(r.avg).toBeCloseTo(150 / 540);
    expect(r.kRate).toBeCloseTo(120 / 600);
    expect(r.iso).toBeCloseTo(r.slg! - r.avg!);
  });

  it('a pitcher\'s FIP surrogate sits on the league ERA scale, and ERA is exact', () => {
    const p = pitcherRates(pit(2030), env([2030]).get(2030));
    expect(p.era).toBeCloseTo((70 * 9) / 180);
    expect(p.fip).not.toBeNull();
    expect(p.ip).toBe(180);
  });

  it('FIP is not scaled by nine: a pitcher exactly at the league rate sits at the league ERA, and each 0.1 above it adds 0.1', () => {
    // raw = (13 HR + 3 (BB+HBP) - 2 K) / IP; choose a line whose raw is exactly the league's 0.9 per inning
    const atLeague = pit(2030, { outs: 540, hra: 0, hp: 0, bb: 0, k: 0 }); // raw 0 ...
    const raw = (l: PitchingLine) => (13 * l.hra + 3 * (l.bb + l.hp) - 2 * l.k) / (l.outs / 3);
    const line = pit(2030, { outs: 300, hra: 10, bb: 20, hp: 0, k: 30 }); // 13*10 + 60 - 60 = 130 over 100 IP: 1.3
    expect(raw(atLeague)).toBe(0);
    expect(raw(line)).toBeCloseTo(1.3);
    const e = env([2030]).get(2030) as SeasonEnvironment; // league raw 0.9, league ERA 4.2
    expect(pitcherRates(line, e).fip as number).toBeCloseTo(4.2 + (1.3 - 0.9), 6);
    // and the relative measure the ranking uses is the same difference, in runs on the ERA scale
    const w = weightedPitching([line], env([2030]), 2030);
    expect(w.skills.value as number).toBeCloseTo(1.3 - 0.9, 6);
  });
});

describe('weighting seasons', () => {
  it('measures each season against ITS league before combining', () => {
    const lines = [bat(2030), bat(2029)];
    const hot = weightedBatting(lines, new Map([[2030, { year: 2030, woba: 0.300, fipRaw: 0, era: 4 }], [2029, { year: 2029, woba: 0.340, fipRaw: 0, era: 4 }]]), 2030);
    const flat = weightedBatting(lines, env([2030, 2029]), 2030);
    expect(Math.abs((hot.value as number) - (flat.value as number))).toBeGreaterThan(0.001);
    expect(hot.seasons.map((s) => s.year).sort()).toEqual([2029, 2030]);
  });

  it('uses only the last three seasons, and weights the recent ones more', () => {
    const lines = [bat(2030, { h: 200, hr: 40 }), bat(2029), bat(2028), bat(2027, { h: 250, hr: 60 })];
    const w = weightedBatting(lines, env([2030, 2029, 2028, 2027]), 2030);
    expect(w.seasons.map((s) => s.year).sort()).toEqual([2028, 2029, 2030]);
    expect(SEASON_WEIGHTS.hitter).toEqual([5, 3, 3]);
    expect(SEASON_WEIGHTS.starter).toEqual([5, 3, 1]);
    expect(SEASON_WEIGHTS.reliever).toEqual([5, 3, 2]);
    // the current season is the best by far, so a weighted value sits above the older two alone
    const older = weightedBatting([bat(2029), bat(2028)], env([2029, 2028]), 2030);
    expect(w.value as number).toBeGreaterThan(older.value as number);
  });

  it('a short current season cannot dominate, and the effective sample says so', () => {
    const w = weightedBatting([bat(2030, { pa: 100, ab: 90, h: 40, hr: 8, d: 8, t: 0, bb: 8, hp: 1, sf: 1 }), bat(2029), bat(2028)], env([2030, 2029, 2028]), 2030);
    expect(w.rawSample).toBe(1300);
    expect(w.sample).toBeCloseTo(100 + 600 * 0.6 + 600 * 0.6);
    // the same hot rates over a full season would pull the value up much more
    const full = weightedBatting([bat(2030, { pa: 600, ab: 540, h: 240, hr: 48, d: 48, t: 0, bb: 48, hp: 6, sf: 6 }), bat(2029), bat(2028)], env([2030, 2029, 2028]), 2030);
    expect(full.value as number).toBeGreaterThan(w.value as number + 0.02);
  });

  it('no qualifying season means no value, not zero', () => {
    const w = weightedBatting([bat(2020)], env([2020]), 2030);
    expect(w).toMatchObject({ value: null, sample: 0 });
    expect(w.calibration).toBe(RESULTS_CALIBRATION);
  });

  it('keeps pitcher skills and runs apart: a lucky ERA does not hide the peripherals', () => {
    const lucky = pit(2030, { er: 40, k: 120, bb: 90, hra: 30 });
    const w = weightedPitching([lucky], env([2030]), 2030);
    expect(w.runs.value as number).toBeLessThan(0);   // ERA better than the league
    expect(w.skills.value as number).toBeGreaterThan(0); // peripherals worse than the league
  });
});

describe('reliability and percentiles', () => {
  it('is n / (n + k), zero for no sample, and grows with sample', () => {
    expect(reliability(0, STABILIZATION.starter)).toBe(0);
    expect(reliability(STABILIZATION.starter, STABILIZATION.starter)).toBe(0.5);
    expect(reliability(2000, STABILIZATION.starter)).toBeGreaterThan(reliability(300, STABILIZATION.starter));
  });

  it('ranks among a population, in either direction, counting ties half', () => {
    const pop = [1, 2, 3, 4, 5];
    expect(percentileAmong(pop, 5, true)).toBe(90);
    expect(percentileAmong(pop, 1, true)).toBe(10);
    expect(percentileAmong(pop, 1, false)).toBe(90); // lowest runs allowed is best
    expect(percentileAmong([3], 3, true)).toBe(50);
    expect(percentileAmong([], 3, true)).toBeNull();
  });
});
