import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import {
  clearProductionCaches, fitProductionModel, fitRatingsModel, productionCalibration, productionModelFor, projectProduction, refitOffThread,
  refitProductionIfNeeded, refitRatingsIfNeeded,
  type CoverageRow, type FitHistory, type FitPlayer, type FitRecord, type FitRun, type ProductionInput, type RatingsFitInput, type RatingsFitRecord,
} from '../server/playerValue.js';
import { holmSignificant, judgeGate, logisticFit, ratioEffect, seasonTotals, type FitOptions, type GateRow } from '../server/playerValueProductionFit.js';
import { recordProductionFit } from '../server/playerValueFitStore.js';
import { PRODUCTION_PRIOR, RATINGS_METHOD, RATINGS_POLICY, RATINGS_PRIOR } from '../server/playerValueCalibration.js';
import { currentSaveName, historyDb } from '../server/history.js';
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
    const thin = fitProductionModel(syntheticLeague(2022, 2025, 100, 7), { prior: PRODUCTION_PRIOR });
    const rich = fitProductionModel(syntheticLeague(2008, 2025, 300, 7), { prior: PRODUCTION_PRIOR });
    // The weight is set by sample size: more history, less prior
    expect(thin.record.priorWeight.overall).toBeGreaterThan(rich.record.priorWeight.overall);
    expect(thin.record.priorWeight.overall).toBeGreaterThanOrEqual(0.5);
    // ...and it is said, never presented as the save's own calibration
    expect(thin.record.label).toMatch(/not yet calibrated on this save \(4 seasons\)/);
    expect(rich.record.label).toMatch(/calibrated on this save's seasons 2008–2025/);
    // The bands it serves are wider than the same fit without the prior's weight
    const served = projectProduction(input(), { model: thin.model, provenance: { source: 'save_fit', label: thin.record.label, stamp: { status: 'calibrated', basis: 'test', run: 'test' }, fitId: thin.record.id, priorWeight: thin.record.priorWeight.overall } });
    const bare = projectProduction(input(), {
      model: { ...thin.model, kinds: { ...thin.model.kinds, hitter: { ...thin.model.kinds.hitter, priorWeight: 0, horizons: thin.model.kinds.hitter.horizons.map((h) => ({ ...h, priorWeight: 0 })) } } },
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
    // The verdict agrees with the numbers it names: the gate's own rule on the subgroups as fitted
    const rows = Object.entries(r.coverage.subgroups ?? {}).flatMap(([group, xs]) => xs.map((x) => ({ ...x, group })));
    expect(rows.some((x) => x.group === 'pooled')).toBe(true);
    expect(r.gate.passed).toBe(judgeGate(rows).passed);
  });
});

/**
 * A league whose playing time follows a talent that drifts: each player's true rate takes a random walk,
 * and a club keeps a player only while his true rate is good enough. The players who keep playing are the
 * ones who stayed good, so the rate of those who play is not the rate projected for everyone.
 */
function selectionLeague(first: number, last: number, perSeason: number, seed: number): FitHistory {
  const rnd = random(seed);
  const normal = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const players: FitPlayer[] = [];
  let id = 1;
  for (let debut = first - 4; debut <= last; debut += 1) {
    for (let n = 0; n < perSeason / 4; n += 1) {
      const pitcher = rnd() < 0.4;
      let talent = (pitcher ? 1.0 : 2.0) + 1.3 * normal();
      const age = 22 + Math.floor(rnd() * 5);
      const p: FitPlayer = { playerId: id, birth: { year: debut - age, month: 3, day: 1 }, proneness: null, batting: [], pitching: [], position: pitcher ? 1 : 6, role: pitcher ? 12 : 0 };
      id += 1;
      for (let s = debut; s <= last; s += 1) {
        // Talent drifts, and ages
        talent += 0.9 * normal() - 0.25 * Math.max(0, s - debut + age - 29);
        // A club plays him only while he is good enough, more the better he is
        if (talent < (pitcher ? 0.2 : 0.8) + 0.3 * normal()) break;
        const opp = Math.max(20, Math.round((pitcher ? 200 : 450) + (pitcher ? 25 : 60) * talent + (pitcher ? 40 : 80) * normal()));
        const war = (talent * opp) / 600 + Math.sqrt(opp / 600) * 1.2 * normal();
        if (s < first) continue;
        if (pitcher) p.pitching.push({ season: s, opportunities: opp, war, games: Math.round(opp / 4), starts: 0 });
        else p.batting.push({ season: s, opportunities: opp, war });
      }
      if (p.batting.length + p.pitching.length > 0) players.push(p);
    }
  }
  const seasons = [];
  for (let s = first; s <= last; s += 1) seasons.push({ season: s, scheduleShare: 1, games: 162 });
  return { leagueId: 1, throughSeason: last, seasons, players };
}

describe('the central is the expected wins (hardening, 2026-09-23)', () => {
  it('on a league whose playing time follows a talent that drifts, the held-out central is unbiased at every horizon', () => {
    const run = fitProductionModel(selectionLeague(2004, 2025, 400, 5), { prior: PRODUCTION_PRIOR });
    const rows = run.record.coverage.asFitted.filter((r) => r.cases >= 200);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) {
      // Never materially AND significantly off: within 10% of the mean outcome, or within three standard errors (by player)
      const meanAbsolute = (r as { meanAbsolute?: number | null }).meanAbsolute ?? NaN;
      const se = (r as { biasSe?: number | null }).biasSe ?? 0;
      expect(Math.abs(r.bias!), `horizon ${r.horizon}: bias ${r.bias} (se ${se}) against a mean absolute outcome ${meanAbsolute}`)
        .toBeLessThanOrEqual(Math.max(0.1 * meanAbsolute, 3 * se));
    }
  });

  it('a listed pitcher\'s batting never enters the hitter fit: the hitter model is the same with or without pitchers who batted', () => {
    const league = syntheticLeague(2008, 2025, 300, 13);
    const tagged: FitHistory = { ...league, players: league.players.map((p) => ({ ...p, position: p.pitching.length > 0 ? 1 : 6, role: p.pitching.length > 0 ? 11 : 0 })) };
    // National League starters before the universal DH: about 70 plate appearances a season, far below replacement
    const batting: FitHistory = {
      ...tagged,
      players: tagged.players.map((p) => (p.pitching.length > 0 && p.playerId % 2 === 0
        ? { ...p, batting: p.pitching.map((l) => ({ season: l.season, opportunities: 70, war: (-5 * 70) / 600 })) }
        : p)),
    };
    const clean = fitProductionModel(tagged, { prior: PRODUCTION_PRIOR });
    const mixed = fitProductionModel(batting, { prior: PRODUCTION_PRIOR });
    expect(mixed.model.kinds.hitter.mean600).toBeCloseTo(clean.model.kinds.hitter.mean600, 9);
    expect(mixed.model.kinds.hitter.stabilization).toBe(clean.model.kinds.hitter.stabilization);
    expect(mixed.record.sample.cases.hitter).toEqual(clean.record.sample.cases.hitter);
  });

  it('a target season with a blank WAR is left out of the backtest, never scored as zero', () => {
    const league = syntheticLeague(2008, 2025, 300, 17);
    const blanked: FitHistory = {
      ...league,
      players: league.players.map((p) => (p.playerId % 7 === 0 ? { ...p, batting: p.batting.map((l) => (l.season === 2025 ? { ...l, war: null } : l)) } : p)),
    };
    const count = league.players.filter((p) => p.playerId % 7 === 0 && p.batting.some((l) => l.season === 2025)).length;
    expect(count).toBeGreaterThan(0);
    const a = fitProductionModel(league, { prior: PRODUCTION_PRIOR });
    const b = fitProductionModel(blanked, { prior: PRODUCTION_PRIOR });
    // 2025 is only ever a target season (no window reads it): fewer held-out cases, none scored as a zero
    expect(b.record.sample.holdoutCases.reduce((x, y) => x + y, 0)).toBeLessThan(a.record.sample.holdoutCases.reduce((x, y) => x + y, 0));
  });

  it('the record reports coverage for the players who played beside everyone, and the gate\'s subgroups as fitted', () => {
    const run = fitProductionModel(syntheticLeague(2008, 2025, 300, 11), { prior: PRODUCTION_PRIOR });
    const coverage = run.record.coverage as FitRecord['coverage'] & { played?: CoverageRow[]; subgroups?: Record<string, CoverageRow[]> };
    expect(coverage.played?.map((r) => r.horizon)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(Object.keys(coverage.subgroups ?? {})).toEqual(expect.arrayContaining(['kind:hitter', 'usage:high', 'quality:top', 'age:≤25']));
  });
});

describe('the gate cannot pass a miscalibrated fit (hardening, 2026-09-23)', () => {
  const row = (over: Partial<GateRow>): GateRow => ({ group: 'pooled', horizon: 1, cases: 2000, outer: 0.8, inner: 0.5, bias: 0, meanAbsolute: 1, biasSe: 0.01, ...over });

  it('rejects a fit whose pooled coverage is on target but whose regulars\' band covers half the time', () => {
    const verdict = judgeGate([row({}), row({ group: 'usage:high', cases: 600, outer: 0.5, inner: 0.27 })]);
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toMatch(/usage:high/);
  });

  it('rejects a central materially and significantly biased in a subgroup, and not one that is only noisy or small', () => {
    expect(judgeGate([row({}), row({ group: 'kind:starter', cases: 1200, bias: 0.25, meanAbsolute: 1.2, biasSe: 0.03 })]).passed).toBe(false);
    // Material but not significant: a noisy subgroup
    expect(judgeGate([row({}), row({ group: 'kind:starter', cases: 300, bias: 0.25, meanAbsolute: 1.2, biasSe: 0.2 })]).passed).toBe(true);
    // Significant but not material
    expect(judgeGate([row({}), row({ group: 'kind:starter', cases: 5000, bias: 0.05, meanAbsolute: 1.2, biasSe: 0.005 })]).passed).toBe(true);
    // Too few cases to judge
    expect(judgeGate([row({}), row({ group: 'age:34+', cases: 150, outer: 0.5, inner: 0.2 })]).passed).toBe(true);
  });

  it('holds the pooled coverage tighter than a subgroup, and needs horizon 1', () => {
    expect(judgeGate([row({ outer: 0.73 })]).passed).toBe(false);
    expect(judgeGate([row({ outer: 0.77 }), row({ group: 'kind:reliever', outer: 0.72 })]).passed).toBe(true);
    expect(judgeGate([row({ horizon: 2 })]).passed).toBe(false);
  });

  it('keeps each horizon\'s prior weight: a save with nine seasons labels the horizons it has no cases for and widens them as the prior', () => {
    const run = fitProductionModel(syntheticLeague(2016, 2025, 300, 7), { prior: PRODUCTION_PRIOR });
    const byHorizon = (run.record.priorWeight as FitRecord['priorWeight'] & { byHorizon?: Record<string, number[]> }).byHorizon;
    expect(byHorizon?.hitter?.[0]).toBeLessThan(0.5);
    expect(byHorizon?.hitter?.[6]).toBeGreaterThanOrEqual(0.5);
    expect(run.record.label).toMatch(/horizons? [0-9–]+ .*prior|prior.*horizons? [0-9–]+/);
    const h7 = run.model.kinds.hitter.horizons[6] as { priorWeight?: number };
    expect(h7.priorWeight).toBeGreaterThanOrEqual(0.5);
  });

  it('a prior fitted on the save\'s own held-out seasons is not used, and the record says so', () => {
    const league = syntheticLeague(2008, 2025, 300, 11);
    const run = fitProductionModel(league, { prior: PRODUCTION_PRIOR, priorSource: seasonTotals(league) } as FitOptions);
    expect((run.record as FitRecord & { priorOverlapsHoldout?: boolean }).priorOverlapsHoldout).toBe(true);
    expect(run.record.priorWeight.overall).toBe(0);
    const clean = fitProductionModel(league, { prior: PRODUCTION_PRIOR, priorSource: {} } as FitOptions);
    expect((clean.record as FitRecord & { priorOverlapsHoldout?: boolean }).priorOverlapsHoldout).toBe(false);
  });
});

describe('the fit\'s statistics (hardening, 2026-09-23)', () => {
  it('repeating one player\'s rows never makes an effect significant: the standard error is clustered by player', () => {
    const rnd = random(3);
    const rows = Array.from({ length: 20 }, (_, i) => ({ a: 100 + 30 * (rnd() - 0.5), p: 100, cluster: i }));
    const once = ratioEffect(rows);
    const repeated = ratioEffect(rows.flatMap((r) => Array.from({ length: 9 }, () => r)));
    expect(repeated.m).toBeCloseTo(once.m, 12);
    expect(repeated.se).toBeCloseTo(once.se, 12);
  });

  it('a family of tests is held to the two-standard-error rule together (Holm): one of eighteen at 2.1 is not significant', () => {
    const z = [2.1, ...Array.from({ length: 17 }, () => 0.3)];
    expect(holmSignificant(z, 2)).toEqual(z.map(() => false));
    expect(holmSignificant([4, 0.3, 0.2], 2)).toEqual([true, false, false]);
  });

  it('a separable logistic is finite and flagged, never a silent cliff', () => {
    const x = Array.from({ length: 60 }, (_, i) => [1, 270 + i]);
    const y = x.map(([, v]) => (v >= 300 ? 1 : 0));
    const fit = logisticFit(x, y, [1]) as unknown as { coefficients: number[]; separated: boolean; converged: boolean };
    expect(fit.separated).toBe(true);
    expect(fit.coefficients.every((c) => Number.isFinite(c))).toBe(true);
    expect(Math.abs(fit.coefficients[1])).toBeLessThan(1);
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
    // Stamped by its run record: calibrated where the fit calls itself so, provisional while it is mostly the prior (D-09)
    expect(inForce.provenance.stamp.status).toBe(inForce.provenance.label.startsWith('not yet calibrated') ? 'provisional' : 'calibrated');
    expect(inForce.provenance.stamp.run).toContain(`${IDS.league}:2030:`);
    const status = productionCalibration(IDS.league);
    expect(status.inForce.fit?.throughSeason).toBe(2030);
    expect(status.coverageTargets).toEqual({ outer: 0.8, inner: 0.5 });
  });

  it('the ratings model (3b) is fitted once per completed season beside the results fit, and refitted by itself when the save\'s rating snapshots become enough for its own development path', () => {
    const fits: number[] = [];
    const fitter = (input: RatingsFitInput) => {
      fits.push(input.observations.length);
      return fitRatingsModel(input, { prior: RATINGS_PRIOR });
    };
    const first = refitRatingsIfNeeded({ fit: fitter, leagues: [IDS.league] });
    expect(first).toEqual([expect.objectContaining({ throughSeason: 2030, refit: true })]);
    expect(productionCalibration(IDS.league).ratings.latestAttempt?.throughSeason).toBe(2030);
    // A re-import with nothing new fits nothing
    expect(refitRatingsIfNeeded({ fit: fitter, leagues: [IDS.league] })).toEqual([expect.objectContaining({ refit: false })]);
    expect(fits).toHaveLength(1);
    // The save's own snapshots a season apart arrive: enough of them refit it once, with no new season
    const bat = historyDb.prepare(
      `INSERT OR REPLACE INTO rating_snapshots (save_name, game_date, player_id, position, level, age, con, gap, pow, eye, avk, conP, gapP, powP, eyeP, avkP)
       VALUES (?, ?, ?, 6, 3, ?, ?, ?, ?, ?, ?, 60, 60, 60, 60, 60)`
    );
    const arm = historyDb.prepare(
      `INSERT OR REPLACE INTO rating_snapshots (save_name, game_date, player_id, position, level, age, stu, mov, ctl, stuP, movP, ctlP)
       VALUES (?, ?, ?, 1, 3, ?, ?, ?, ?, 60, 60, 60)`
    );
    const save = currentSaveName();
    for (let n = 0; n < RATINGS_POLICY.longitudinal.minimumPairs; n += 1) {
      // Unpadded game dates, as OOTP writes them, a season apart
      if (n % 2 === 0) {
        bat.run(save, '2029-4-1', 70_000 + n, 20, 40, 40, 40, 40, 40);
        bat.run(save, '2030-4-1', 70_000 + n, 21, 48, 48, 48, 48, 48);
      } else {
        arm.run(save, '2029-4-1', 70_000 + n, 20, 40, 40, 40);
        arm.run(save, '2030-4-1', 70_000 + n, 21, 48, 48, 48);
      }
    }
    try {
      const again = refitRatingsIfNeeded({ fit: fitter, leagues: [IDS.league] });
      expect(again).toEqual([expect.objectContaining({ throughSeason: 2030, refit: true })]);
      expect(fits).toHaveLength(2);
      const record = latestRatingsRecord();
      expect(record?.development.source).toBe('save_fit');
      expect(record?.development.pairs).toBeGreaterThanOrEqual(RATINGS_POLICY.longitudinal.minimumPairs);
      // ...and once it has, a further re-import fits nothing
      expect(refitRatingsIfNeeded({ fit: fitter, leagues: [IDS.league] })).toEqual([expect.objectContaining({ refit: false })]);
    } finally {
      historyDb.prepare(`DELETE FROM rating_snapshots WHERE player_id >= 70000 AND player_id < 71000`).run();
    }
  });
});

describe('the fit store keeps the fit in force honest (hardening, 2026-09-23)', () => {
  // The league's history changed above (its earlier seasons were removed): its identity is measured afresh
  beforeAll(() => clearProductionCaches());
  const league = (): FitHistory => ({ leagueId: IDS.league, throughSeason: 2030, seasons: [], players: [] });
  const run = (passed: boolean, throughSeason = 2030): FitRun => {
    const real = fitProductionModel({ ...league(), throughSeason }, { prior: PRODUCTION_PRIOR });
    return {
      ...real,
      record: { ...real.record, id: `${IDS.league}:${throughSeason}:${real.record.method}`, throughSeason, label: "calibrated on this save's seasons 2010–2030 (21), held out 2021–2030", gate: { ...real.record.gate, passed, reason: passed ? 'test: adopted' : 'test: rejected' } },
    };
  };

  it('a refit that fails the gate never replaces the fit in force, even when forced', () => {
    recordProductionFit(run(true), { gameDate: '2031-04-01', fitMs: 1 });
    expect(productionModelFor(IDS.league).provenance.stamp.run).toContain(`${IDS.league}:2030:`);
    const written = recordProductionFit(run(false), { gameDate: '2031-04-02', fitMs: 1, force: true });
    expect(written).toBe(0);
    expect(productionModelFor(IDS.league).provenance.source).toBe('save_fit');
    // A passing forced refit may replace it
    expect(recordProductionFit(run(true), { gameDate: '2031-04-03', fitMs: 1, force: true })).toBe(1);
  });

  it('a new save under a reused name and league id never inherits the fit in force', () => {
    expect(productionModelFor(IDS.league).provenance.source).toBe('save_fit');
    const name = (db.prepare(`SELECT name FROM leagues WHERE league_id = ?`).get(IDS.league) as { name: string }).name;
    db.prepare(`UPDATE leagues SET name = ? WHERE league_id = ?`).run('A Different League', IDS.league);
    try {
      clearProductionCaches();
      expect(productionModelFor(IDS.league).provenance.source).toBe('fallback_prior');
    } finally {
      db.prepare(`UPDATE leagues SET name = ? WHERE league_id = ?`).run(name, IDS.league);
      clearProductionCaches();
    }
    expect(productionModelFor(IDS.league).provenance.source).toBe('save_fit');
  });

  it('a fit through a season the league has not completed is never in force', () => {
    recordProductionFit(run(true, 2036), { gameDate: '2037-04-01', fitMs: 1 });
    expect(productionModelFor(IDS.league).provenance.fitId).not.toContain(':2036:');
  });

  it('an adopted fit that is mostly the prior is stamped provisional, never calibrated', () => {
    const thin = run(true, 2029);
    thin.record.label = 'not yet calibrated on this save (4 seasons): mostly the fallback prior';
    thin.record.priorWeight = { ...thin.record.priorWeight, overall: 0.8 };
    // Only thin: make it the one in force by removing the others for this key range
    historyDb.prepare(`DELETE FROM value_production_fits WHERE league_id = ? AND method = ? AND through_season >= 2030`).run(IDS.league, thin.record.method);
    recordProductionFit(thin, { gameDate: '2030-04-01', fitMs: 1 });
    const inForce = productionModelFor(IDS.league);
    expect(inForce.provenance.source).toBe('save_fit');
    expect(inForce.provenance.stamp.status).not.toBe('calibrated');
  });

  it('a season is complete only with its major-league lines: a season number bumped over last season\'s standings is not fitted through', () => {
    const season = (db.prepare(`SELECT season_year AS y FROM leagues WHERE league_id = ?`).get(IDS.league) as { y: number }).y;
    db.prepare(`UPDATE leagues SET season_year = ? WHERE league_id = ?`).run(season + 1, IDS.league);
    try {
      const out = refitProductionIfNeeded({ fit: (h) => fitProductionModel(h, { prior: PRODUCTION_PRIOR }), leagues: [IDS.league] });
      expect(out.every((o) => o.throughSeason !== season + 1)).toBe(true);
    } finally {
      db.prepare(`UPDATE leagues SET season_year = ? WHERE league_id = ?`).run(season, IDS.league);
    }
  });

  it('the refit runs off the event loop and never records a result read across an import', async () => {
    let ran = false;
    const pending = refitOffThread({
      compute: async () => { ran = true; return { production: [], ratings: [] }; },
      stale: () => true,
    });
    // Nothing ran synchronously: the caller's turn of the event loop is not blocked
    expect(ran).toBe(false);
    expect(await pending).toEqual([]);
    expect(ran).toBe(true);
  });
});

/** The latest ratings fit's run record for the fixture league, as stored. */
function latestRatingsRecord(): RatingsFitRecord | null {
  const row = historyDb.prepare(`SELECT record_json FROM value_production_fits WHERE league_id = ? AND method = ? ORDER BY through_season DESC LIMIT 1`)
    .get(IDS.league, RATINGS_METHOD) as { record_json: string } | undefined;
  return row ? JSON.parse(row.record_json) as RatingsFitRecord : null;
}
