import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import {
  fitProductionModel, productionCalibration, productionModelFor, projectProduction, refitProductionIfNeeded,
  type FitHistory, type FitPlayer, type FitRun, type ProductionInput,
} from '../server/playerValue.js';
import { PRODUCTION_PRIOR } from '../server/playerValueCalibration.js';
import { IDS } from './fixture';

/*
 * Calibration belongs to the save (D-053, PLAYER_VALUE.md Part 7). The production model is fitted
 * from the save's own history, stored per save, adopted only through the gate, refitted once per
 * newer completed season, and shrunk toward the provisional fallback prior while the history is
 * thin. The fit cases use a synthetic league (a seeded generator, no real save); the store and
 * refit cases run against the fixture league with the fit injected, so they test the plumbing and
 * not any number.
 */

/** A small seeded generator, so a synthetic league is the same on every run. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A synthetic league: hitters and relievers with a true rate, careers of a few seasons, noisy seasons. */
function syntheticLeague(first: number, last: number, perSeason: number, seed: number): FitHistory {
  const rnd = random(seed);
  const normal = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const players: FitPlayer[] = [];
  let id = 1;
  for (let debut = first - 4; debut <= last; debut += 1) {
    for (let n = 0; n < perSeason / 5; n += 1) {
      const pitcher = rnd() < 0.4;
      const rate600 = (pitcher ? 0.9 : 1.8) + 1.6 * normal();
      const age = 22 + Math.floor(rnd() * 6);
      const length = 2 + Math.floor(rnd() * 9);
      const p: FitPlayer = { playerId: id, birth: { year: debut - age, month: 3, day: 1 }, proneness: 20 + Math.floor(rnd() * 120), batting: [], pitching: [] };
      id += 1;
      for (let s = debut; s < debut + length && s <= last; s += 1) {
        const opp = Math.max(20, Math.round((pitcher ? 150 : 350) + (pitcher ? 60 : 200) * normal() + 60 * rate600));
        const true600 = rate600 - 0.3 * Math.max(0, s - debut + age - 29);
        const war = (true600 * opp) / 600 + Math.sqrt(opp / 600) * 1.2 * normal();
        if (s < first) continue;
        if (pitcher) p.pitching.push({ season: s, opportunities: opp, war, games: Math.round(opp / 4), starts: 0 });
        else p.batting.push({ season: s, opportunities: opp, war });
      }
      if (p.batting.length + p.pitching.length > 0) players.push(p);
    }
  }
  const seasons = [];
  for (let s = first; s <= last; s += 1) seasons.push({ season: s, scheduleShare: 1 });
  return { leagueId: 1, throughSeason: last, seasons, players };
}

const input = (): ProductionInput => ({
  playerId: 1, season: 2026, seasonPlayed: 0.3, age: 28,
  batting: [{ season: 2023, opportunities: 600, war: 3 }, { season: 2024, opportunities: 620, war: 3.4 }, { season: 2025, opportunities: 580, war: 2.6 }, { season: 2026, opportunities: 180, war: 1 }],
  pitching: [],
});

const width = (b: { low: number; high: number }) => b.high - b.low;

describe('the save\'s own fit: thin history and the prior (D-053)', () => {
  it('a save with no history at all is not calibrated: the fit is the prior, it cannot be validated, and it is not adopted', () => {
    const run = fitProductionModel({ leagueId: 1, throughSeason: 2025, seasons: [], players: [] }, { prior: PRODUCTION_PRIOR });
    expect(run.record.gate.passed).toBe(false);
    expect(run.record.gate.reason).toMatch(/Too few held-out seasons/);
    expect(run.record.priorWeight.overall).toBe(1);
    expect(run.record.label).toMatch(/not yet calibrated on this save \(0 seasons\)/);
  });

  it('thin history shrinks toward the prior by its sample, widens the bands it serves, and says so', () => {
    const thin = fitProductionModel(syntheticLeague(2021, 2025, 150, 7), { prior: PRODUCTION_PRIOR });
    const rich = fitProductionModel(syntheticLeague(2008, 2025, 300, 7), { prior: PRODUCTION_PRIOR });
    // The weight is set by sample size: more history, less prior
    expect(thin.record.priorWeight.overall).toBeGreaterThan(rich.record.priorWeight.overall);
    expect(thin.record.priorWeight.overall).toBeGreaterThanOrEqual(0.5);
    // ...and it is said, never presented as the save's own calibration
    expect(thin.record.label).toMatch(/not yet calibrated on this save \(5 seasons\)/);
    expect(rich.record.label).toMatch(/calibrated on this save's seasons 2008–2025/);
    // The bands it serves are wider than the same fit without the prior's weight
    const served = projectProduction(input(), { model: thin.model, provenance: { source: 'save_fit', label: thin.record.label, stamp: { status: 'calibrated', basis: 'test', run: 'test' }, fitId: thin.record.id, priorWeight: thin.record.priorWeight.overall } });
    const bare = projectProduction(input(), {
      model: { ...thin.model, kinds: { ...thin.model.kinds, hitter: { ...thin.model.kinds.hitter, priorWeight: 0 } } },
      provenance: served.basis.model,
    });
    expect(thin.model.kinds.hitter.priorWeight).toBeGreaterThan(0);
    served.seasons.forEach((s, i) => expect(width(s.wins), `${s.season}`).toBeGreaterThan(width(bare.seasons[i].wins)));
  });

  it('a fit records its window, its held-out coverage for both bands per horizon, and the gate\'s verdict', () => {
    const run = fitProductionModel(syntheticLeague(2008, 2025, 300, 11), { prior: PRODUCTION_PRIOR });
    const r = run.record;
    expect(r.window.seasons[0]).toBe(2008);
    expect(r.window.holdout.length).toBeGreaterThan(0);
    expect(r.window.trainingThrough).toBeLessThan(r.window.holdout[0]);
    expect(r.coverage.asFitted.map((x) => x.horizon)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const row of r.coverage.asFitted.filter((x) => x.cases > 0)) {
      expect(row.outer).not.toBeNull();
      expect(row.inner).not.toBeNull();
      expect(row.inner!).toBeLessThanOrEqual(row.outer! + 1e-9);
    }
    // The verdict agrees with the numbers it names
    const evaluable = r.coverage.asFitted.filter((x) => x.cases >= r.gate.minimumCases);
    const off = evaluable.filter((x) => {
      return Math.abs(x.outer! - 0.8) > r.gate.tolerance || Math.abs(x.inner! - 0.5) > r.gate.tolerance;
    });
    expect(r.gate.passed).toBe(evaluable.some((x) => x.horizon === 1) && off.length === 0);
  });
});

describe('the fit store and the refit after an import (fixture league)', () => {
  const calls: number[] = [];
  const fitter = (passed: boolean) => (history: FitHistory): FitRun => {
    calls.push(history.throughSeason);
    const real = fitProductionModel(history, { prior: PRODUCTION_PRIOR });
    return { ...real, record: { ...real.record, gate: { ...real.record.gate, passed, reason: passed ? 'test: within tolerance' : 'test: held-out coverage outside tolerance' } } };
  };

  beforeAll(() => {
    db.exec(`ALTER TABLE leagues ADD COLUMN rules_schedule_games_per_team INTEGER`);
    db.prepare(`UPDATE leagues SET rules_schedule_games_per_team = 162 WHERE league_id = ?`).run(IDS.league);
    for (const team of [IDS.mlbTeam, IDS.otherMlbTeam]) {
      db.prepare(`INSERT INTO team_record (team_id, g, w, l, t, pos, pct, gb, streak, magic_number) VALUES (?, 54, 27, 27, 0, 1, .5, 0, 0, 0)`).run(team);
    }
    // Major-league seasons behind this one, so the league has a completed season to fit
    const line = db.prepare(`INSERT INTO players_career_batting_stats (player_id, year, team_id, league_id, level_id, split_id, pa, war) VALUES (?, ?, ?, ?, 1, 1, ?, ?)`);
    for (const year of [2027, 2028, 2029]) line.run(IDS.starter, year, IDS.mlbTeam, IDS.league, 550, 2.5);
  });

  afterAll(() => {
    db.prepare(`DELETE FROM players_career_batting_stats WHERE player_id = ? AND year < 2030`).run(IDS.starter);
  });

  it('a completed season with no fit is fitted once and recorded per save; a fit that fails the gate is not adopted, and says why', () => {
    const first = refitProductionIfNeeded({ fit: fitter(false), leagues: [IDS.league] });
    expect(first).toEqual([expect.objectContaining({ leagueId: IDS.league, throughSeason: 2029, refit: true, adopted: false })]);
    expect(calls).toEqual([2029]);
    const inForce = productionModelFor(IDS.league);
    expect(inForce.provenance.source).toBe('fallback_prior');
    expect(inForce.provenance.label).toMatch(/not yet calibrated on this save/);
    expect(inForce.provenance.label).toContain('test: held-out coverage outside tolerance');
    expect(productionCalibration(IDS.league).latestAttempt).toEqual(expect.objectContaining({ throughSeason: 2029, adopted: false }));
  });

  it('a re-import without a newer completed season fits nothing', () => {
    const again = refitProductionIfNeeded({ fit: fitter(true), leagues: [IDS.league] });
    expect(again).toEqual([expect.objectContaining({ throughSeason: 2029, refit: false })]);
    expect(calls).toEqual([2029]);
  });

  it('a newer completed season triggers exactly one refit, and an adopted fit is the one in force, stamped with its run record', () => {
    // Every game of 2030 played: 2030 is now a completed season
    db.prepare(`UPDATE team_record SET g = 162`).run();
    const refit = refitProductionIfNeeded({ fit: fitter(true), leagues: [IDS.league] });
    expect(refit).toEqual([expect.objectContaining({ throughSeason: 2030, refit: true, adopted: true })]);
    expect(refitProductionIfNeeded({ fit: fitter(true), leagues: [IDS.league] })).toEqual([expect.objectContaining({ refit: false })]);
    expect(calls).toEqual([2029, 2030]);
    const inForce = productionModelFor(IDS.league);
    expect(inForce.provenance.source).toBe('save_fit');
    expect(inForce.provenance.stamp.status).toBe('calibrated');
    expect(inForce.provenance.stamp.run).toContain(`${IDS.league}:2030:`);
    const status = productionCalibration(IDS.league);
    expect(status.inForce.fit?.throughSeason).toBe(2030);
    expect(status.coverageTargets).toEqual({ outer: 0.8, inner: 0.5 });
  });
});
