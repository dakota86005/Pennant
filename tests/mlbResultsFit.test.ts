import { describe, expect, it } from 'vitest';
import { backtestPart, fitResults, RESULTS_FIT_POLICY, type ResultsCase, type ResultsInput, type ResultsModel } from '../server/mlbResultsFit';
import { RESULTS_PRIOR } from '../server/resultsMetrics';
import { HITTER_BASE, RELIEVER_BASE, simulateLeague, STARTER_BASE, trial, type SimSpec } from '../scripts/lib/resultsDetectorSimulation';

/*
 * The results lens's season weights and stabilization, fitted per save and served only where CLEARLY better than the starting values
 * on held-out seasons (D-053 amendment, owner 2026-09-25). Small synthetic leagues with known dynamics, both directions.
 */

const league = (spec: Omit<SimSpec, 'seed' | 'seasons'>, seasons: number, seed: number) => ({ ...spec, seasons, seed });

/** A synthetic league as the refit's input: its hitters (or relievers) only. */
function input(cases: ResultsCase[], targets: number[], part: 'hitter' | 'reliever' = 'hitter'): ResultsInput {
  return {
    cases: { hitter: part === 'hitter' ? cases : [], starter: [], reliever: part === 'reliever' ? cases : [], baserunning: [], defense: [] },
    seasons: targets, skipped: [], mix: 0.85, carries: { baserunning: [], defense: [] },
  };
}

// Leagues whose truth is a clear shift from the starting values: talent drifts faster and results are noisier (best about 5/2.5/2, K 1500)
const SHIFTED = { ...HITTER_BASE, permanentShare: 0.3, rho: 0.5, talentSd: 0.017 };

describe('a league whose true dynamics are the starting values keeps them', () => {
  it.each([1, 2, 3, 4, 5])('hitters, league %i: judged, and the starting values held up', (seed) => {
    const d = trial(league(HITTER_BASE, 14, seed), 'hitter');
    expect(d.decided).toBe(true);
    expect(d.serve).toBe('starting');
  });

  it.each([1, 2, 3])('relievers, league %i: the starting values held up', (seed) => {
    expect(trial(league(RELIEVER_BASE, 14, seed), 'reliever').serve).toBe('starting');
  });
});

describe('a league whose true dynamics clearly differ adopts its own', () => {
  it.each([1, 2, 3])('league %i: the save\'s own values serve, moved the right way', (seed) => {
    const { cases, targets } = simulateLeague(league(SHIFTED, 14, seed));
    const run = fitResults(input(cases, targets), { leagueId: 1, throughSeason: targets[targets.length - 1], gameDate: null }, null);
    const hitter = (run.model as ResultsModel).parts.hitter;
    expect(hitter.source).toBe('save');
    expect(hitter.decision?.served.clearlyBetter).toBe(true);
    expect(hitter.decision?.unshrunk.clearlyBetter).toBe(true);
    // noisier results need more sample before they count; faster drift makes older seasons count less
    expect(hitter.served.k).toBeGreaterThan(RESULTS_PRIOR.stabilization.hitter);
    expect(hitter.served.weights[2]).toBeLessThan(RESULTS_PRIOR.weights.hitter[2]);
    expect((run.model as ResultsModel).params.stabilization.hitter).toBe(hitter.served.k);
  });
});

describe('no selection optimism: each season is judged by values chosen without it', () => {
  it('changing a held-out season\'s results changes nothing about the choice it is scored on', () => {
    const { cases, targets } = simulateLeague(league(HITTER_BASE, 12, 7));
    const base = backtestPart(cases, 'hitter', targets, 0.85);
    const last = base.origins[base.origins.length - 1];
    const heldSeason = targets[targets.indexOf(last) + 1];
    // Scramble the held-out season: the fit made at its origin must be identical
    const scrambled = cases.map((c) => (c.target === heldSeason ? { ...c, y: -c.y * 3 } : c));
    const again = backtestPart(scrambled, 'hitter', targets, 0.85);
    expect(again.perOrigin.find((o) => o.origin === last)?.fitted).toEqual(base.perOrigin.find((o) => o.origin === last)?.fitted);
    // and every origin trains only on the seasons up to it
    for (const o of base.perOrigin) expect(o.training).toBe(cases.filter((c) => c.target <= o.origin).length);
  });
});

describe('the refit\'s verdict and its hysteresis', () => {
  // A whole league: hitters as given, starters and relievers whose truth is the starting values
  const run = (spec: Omit<SimSpec, 'seed' | 'seasons'>, seed: number, previous: ResultsModel | null, seasons = 14) => {
    const { cases, targets } = simulateLeague(league(spec, seasons, seed));
    const all = input(cases, targets);
    all.cases.starter = simulateLeague(league(STARTER_BASE, seasons, seed + 100)).cases;
    all.cases.reliever = simulateLeague(league(RELIEVER_BASE, seasons, seed + 200)).cases;
    return fitResults(all, { leagueId: 1, throughSeason: targets[targets.length - 1], gameDate: null }, previous);
  };

  it('the starting values holding up is a verdict: adopted, serving them, with the reason kept', () => {
    const r = run(HITTER_BASE, 11, null);
    expect(r.record.gate.passed).toBe(true);
    expect(r.record.gate.reason).toMatch(/starting values held up/);
    expect((r.model as ResultsModel).parts.hitter).toMatchObject({ source: 'starting', reason: 'kept' });
    expect(r.record.notes.join(' ')).toMatch(/nested/);
    expect(r.record.heldOut.some((c) => c.kind === 'detector' && c.part === 'hitter:served')).toBe(true);
    expect(r.record.heldOut.some((c) => c.kind === 'slope' && c.passed === null)).toBe(true);
  });

  it('once the save\'s own serve, a league where the difference is noise keeps them (no flip-flop)', () => {
    const adopted = run(SHIFTED, 1, null).model as ResultsModel;
    expect(adopted.parts.hitter.source).toBe('save');
    // the next refit sees a league where the starting values are as good: the save's own stay unless the starting values are clearly better
    const next = run(HITTER_BASE, 21, adopted).model as ResultsModel;
    expect(next.parts.hitter.decision?.rule).toBe('return_if_fallback_clearly_better');
    expect(next.parts.hitter.source).toBe('save');
  });

  it('too few seasons to judge is not a verdict: the values in force stay, and the reason is the seasons', () => {
    const r = run(HITTER_BASE, 3, null, 8);
    expect(r.record.gate.passed).toBe(false);
    expect(r.record.gate.failures[0]).toMatch(/^seasons:/);
  });

  it('baserunning and defense wait for seasons that carry their runs, and say so', () => {
    const r = run(HITTER_BASE, 4, null);
    const m = r.model as ResultsModel;
    expect(m.parts.baserunning).toMatchObject({ source: 'starting', reason: 'no_runs', served: { k: RESULTS_PRIOR.stabilization.baserunning } });
    expect(m.parts.defense).toMatchObject({ source: 'starting', reason: 'no_runs', served: { k: RESULTS_PRIOR.stabilization.defense } });
    expect(r.record.notes.join(' ')).toMatch(/Baserunning stabilization is not fitted/);
  });

  it('once the export carries baserunning runs for enough seasons, baserunning is judged the same way', () => {
    const { cases, targets } = simulateLeague(league(HITTER_BASE, 14, 5));
    const all = input(cases, targets);
    all.cases.starter = simulateLeague(league(STARTER_BASE, 14, 105)).cases;
    all.cases.reliever = simulateLeague(league(RELIEVER_BASE, 14, 205)).cases;
    // baserunning runs per PA: a small, noisy rate (about 1.4 runs per 600 PA of spread)
    all.cases.baserunning = simulateLeague({ ...league(HITTER_BASE, 14, 305), talentSd: 0.002, noise: 0.06, minTarget: RESULTS_FIT_POLICY.minTarget.baserunning }).cases;
    all.carries.baserunning = targets;
    const m = fitResults(all, { leagueId: 1, throughSeason: targets[targets.length - 1], gameDate: null }, null).model as ResultsModel;
    expect(m.parts.baserunning.decision?.decided).toBe(true);
    expect(m.parts.baserunning.reason).not.toBe('no_runs');
    // K only: the weights are the hitters' in force
    expect(m.parts.baserunning.fitted?.weights).toEqual(m.parts.hitter.served.weights);
  });
});
