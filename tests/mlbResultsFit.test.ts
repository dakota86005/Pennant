import { describe, expect, it } from 'vitest';
import { backtestPart, fitResults, minCarriedSeasons, priorValues, RESULTS_FIT_POLICY, type ResultsCase, type ResultsInput, type ResultsModel } from '../server/mlbResultsFit';
import { RESULTS_PRIOR } from '../server/resultsMetrics';
import { HETEROGENEOUS, HITTER_BASE, lifetime, RELIEVER_BASE, simulateLeague, STARTER_BASE, trial, type SimSpec } from '../scripts/lib/resultsDetectorSimulation';

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

describe('a league whose true dynamics clearly differ adopts its own, once confirmed', () => {
  it.each([1, 2, 3])('league %i: clearly better at two refits in a row, the save\'s own values serve, moved the right way', (seed) => {
    const { cases, targets } = simulateLeague(league(SHIFTED, 15, seed));
    const at = (n: number, previous: ResultsModel | null) => {
      const window = targets.slice(0, n);
      return fitResults(input(cases.filter((c) => window.includes(c.target)), window), { leagueId: 1, throughSeason: window[window.length - 1], gameDate: null }, previous);
    };
    const first = (at(14, null).model as ResultsModel).parts.hitter;
    // the first refit that finds them clearly better waits for the next to confirm it
    expect(first).toMatchObject({ source: 'starting', reason: 'confirming' });
    expect(first.decision?.streak).toBe(1);
    const run = at(15, at(14, null).model as ResultsModel);
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

describe('over a save\'s lifetime of refits (one refit a season, hysteresis and confirmation as the refit does)', () => {
  it.each([1, 2, 3])('a league whose starting values are within the practical minimum of the best, seasons differing, never adopts its own (league %i)', (seed) => {
    const life = lifetime(league({ ...HITTER_BASE, ...HETEROGENEOUS, talentSd: 0.0215 }, 14, 400 + seed), 'hitter', 10, 14);
    expect(life.ever).toBe(false);
  });

  it('a league that clearly differs adopts its own, and not before a second refit confirms it', () => {
    const life = lifetime(league(SHIFTED, 14, 11), 'hitter', 10, 14);
    expect(life.ever).toBe(true);
    expect(life.firstAt as number).toBeGreaterThanOrEqual(11);
    expect(life.atEnd).toBe('save');
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

describe('a K-only part is judged on K alone', () => {
  it('against a rival with the SAME fixed weights and the starting K: where the candidate\'s K is the starting K, nothing differs', () => {
    const { cases, targets } = simulateLeague(league({ ...HITTER_BASE, talentSd: 0.002, noise: 0.06, minTarget: RESULTS_FIT_POLICY.minTarget.baserunning }, 14, 9));
    const fixed = () => ({ weights: [5, 4, 2], k: 0 });
    const onlyStartingK = { ...RESULTS_FIT_POLICY, grid: { ...RESULTS_FIT_POLICY.grid, k: { ...RESULTS_FIT_POLICY.grid.k, baserunning: [RESULTS_PRIOR.stabilization.baserunning] } } };
    const bt = backtestPart(cases, 'baserunning', targets, 0.85, { fixed, policy: onlyStartingK });
    expect(bt.unshrunk.length).toBeGreaterThan(0);
    for (const c of bt.unshrunk) expect(c.candidate).toBe(c.rival);
    for (const c of bt.served) expect(c.candidate).toBe(c.rival);
    // and with K free, the whole difference is K's: the candidate's weights are the rival's
    const free = backtestPart(cases, 'baserunning', targets, 0.85, { fixed });
    for (const o of free.perOrigin) expect(o.fitted.weights).toEqual([5, 4, 2]);
  });

  it('defense is weighted evenly, as production sums a fielder\'s seasons, and so is its starting rival', () => {
    expect(priorValues('defense').weights).toEqual([5, 5, 5]);
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
    const adopted = run(SHIFTED, 1, run(SHIFTED, 1, null).model as ResultsModel).model as ResultsModel;
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
    // the seasons it needs are stated, and are the seasons judging actually takes
    expect(minCarriedSeasons()).toBe(10);
    expect(r.record.notes.join(' ')).toMatch(/judging it needs 10/);
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
