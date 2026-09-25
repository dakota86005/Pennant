import { describe, expect, it } from 'vitest';
import { backtestPlatoon, consecutivePlatoon, fitK, fitPlatoon, PLATOON_FIT_POLICY, predictSplit, shrinkK, type PlatoonCase, type PlatoonInputCases, type PlatoonModel } from '../server/mlbPlatoonFit';
import { PLATOON_PRIOR } from '../server/platoon';

/*
 * How much a hitter's own platoon split counts, per league (D-053, cycle 3): the league's own K replaces the starting one only where it is
 * CLEARLY better on seasons it never saw (cycle 2's detector, its policy unchanged), with hysteresis and a confirming second refit.
 *
 * Synthetic leagues: each hitter has a constant platoon skill around his hand's norm, with a known spread; a season's split is the skill
 * plus noise from wOBA's per-plate-appearance variance (.26 on the Arizona import), so the best K is noise / spread.
 */

const VPA = 0.262;
const SEASONS = Array.from({ length: 20 }, (_, i) => 2006 + i);

function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
  return { u, n: () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()) };
}

/** A league of hitters with careers: each season about 330 hitter-seasons to predict, skill sd = sqrt(VPA / trueK). */
function league(trueK: number, seed: number, seasons = SEASONS): PlatoonInputCases {
  const r = rng(seed);
  const sd = Math.sqrt(VPA / trueK);
  const cases: PlatoonCase[] = [];
  let id = 1;
  for (const t of seasons) {
    for (let i = 0; i < 330; i += 1) {
      const skill = sd * r.n();
      const effIn = 150 + 500 * r.u();
      const effT = 60 + 140 * r.u();
      const norm = r.u() < 0.35 ? 0.015 : -0.012;
      cases.push({
        playerId: id++, target: t, norm, effective: effIn, weight: effT,
        observed: norm + skill + Math.sqrt(VPA / effIn) * r.n(),
        y: norm + skill + Math.sqrt(VPA / effT) * r.n(),
      });
    }
  }
  return { cases, seasons, skipped: [], missing: null };
}

const basis = (through: number) => ({ leagueId: 1, throughSeason: through, gameDate: null });

describe('how much a hitter\'s own split counts, per league', () => {
  it('reproduces the production arithmetic around the league norm', () => {
    const c = { observed: 0.06, effective: 500, norm: 0.015 };
    expect(predictSplit(c, 5000)).toBeCloseTo(0.015 + (500 / 5500) * 0.045, 12);
    expect(shrinkK(500, 5000, 1000, 1000).k).toBe(Math.round(Math.sqrt(500 * 5000)));
  });

  it('a league whose hitters\' splits are as individual as the starting value assumes keeps it, and says it held up', () => {
    const run = fitPlatoon(league(PLATOON_PRIOR.shrinkAroundLeague, 11), basis(2025), null);
    expect(run.record.gate.passed).toBe(true);
    expect(run.model!.source).toBe('starting');
    expect(run.model!.served).toBe(PLATOON_PRIOR.shrinkAroundLeague);
    expect(run.model!.reason).toBe('kept');
  });

  it('a league whose gain is under the practical minimum keeps the starting value too (a true K of 2,000 costs about 0.1%)', () => {
    for (const seed of [21, 22, 23]) expect(fitPlatoon(league(2000, seed), basis(2025), null).model!.source).toBe('starting');
  });

  it('a league whose hitters\' splits are much more individual adopts its own once a second refit confirms it, moved the right way', () => {
    const lg = league(300, 31);
    const first = fitPlatoon(lg, basis(2024), null);
    expect(first.model!.source).toBe('starting');
    expect(first.model!.reason).toBe('confirming');
    const second = fitPlatoon(lg, basis(2025), consecutivePlatoon(first.model as PlatoonModel, true));
    expect(second.model!.source).toBe('save');
    expect(second.model!.served).toBeLessThan(1000);
    expect(second.model!.fitted).toBeLessThan(1000);
    // the count is consecutive: a gap in between starts it again
    const gap = fitPlatoon(lg, basis(2025), consecutivePlatoon(first.model as PlatoonModel, false));
    expect(gap.model!.source).toBe('starting');
  });

  it('a held-out season never takes part in choosing what it judges', () => {
    const lg = league(800, 41);
    const targets = lg.seasons;
    const bt = backtestPlatoon(lg.cases, targets, PLATOON_PRIOR.shrinkAroundLeague);
    // scramble the last held-out season: every choice made before it is unchanged
    const last = targets[targets.length - 1];
    const scrambled = lg.cases.map((c) => (c.target === last ? { ...c, y: -c.y * 7 } : c));
    const again = backtestPlatoon(scrambled, targets, PLATOON_PRIOR.shrinkAroundLeague);
    expect(again.perOrigin.map((o) => o.fitted)).toEqual(bt.perOrigin.map((o) => o.fitted));
    expect(bt.perOrigin.length).toBe(PLATOON_FIT_POLICY.maxOrigins);
  });

  it('too few seasons to judge keeps the value in force and is not a verdict', () => {
    const run = fitPlatoon(league(300, 51, SEASONS.slice(0, 8)), basis(2013), null);
    expect(run.record.gate.passed).toBe(false);
    expect(run.record.gate.failures[0]).toMatch(/^seasons:/);
    expect(run.model!.source).toBe('starting');
  });

  it('a league whose export has no batting splits by hand keeps the starting value and says so', () => {
    const run = fitPlatoon({ cases: [], seasons: SEASONS, skipped: [], missing: 'The export carries no batting lines against left- and right-handed pitching.' }, basis(2025), null);
    expect(run.model).toBeNull();
    expect(run.record.gate.failures[0]).toMatch(/^no_splits:/);
  });

  it('the grid chooses the K nearest the league\'s own dynamics', () => {
    expect(fitK(league(500, 61).cases)!.k).toBeLessThanOrEqual(1000);
    expect(fitK(league(15000, 62).cases)!.k).toBeGreaterThanOrEqual(5000);
  });
});
