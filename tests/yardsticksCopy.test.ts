import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { historyDb } from '../server/history';
import { recordCalibration, type CalibrationRecord } from '../server/saveCalibrationStore';
import { clearRosterReviewCalibrationCache, rosterReviewCalibration } from '../server/mlbCalibration';
import { AGING_METHOD, priorAgingTable } from '../server/mlbCalibrationFit';
import { RESULTS_METHOD } from '../server/mlbResultsFit';
import { RESULTS_PRIOR } from '../server/resultsMetrics';
import { DEFENSE_WEIGHT } from '../server/roleReview';
import { STARTING_STANDARDS } from '../server/roleStandards';
import { PLATOON_METHOD } from '../server/mlbPlatoonFit';
import { TOOLS_METHOD } from '../server/mlbToolsFit';
import { BULLPEN_PRIOR } from '../server/bullpenRoles';
import { PLATOON_PRIOR } from '../server/platoon';

/**
 * The roster review's yardsticks line is written for a GM (AGENTS.md "Writing for the GM"): short, plain, and its reason is always the
 * true one. The record behind it (checks, windows, verdicts) is the API's.
 */
const BANNED = /\bprior\b|\bgate\b|held-out|coverage|calibrat|\bcentral\b|quantile|D-0\d/i;
const L = 100;

const rec = (component: string, method: string, passed: boolean, basis: Partial<CalibrationRecord['basis']> = {}, failures: string[] = []): CalibrationRecord => ({
  leagueId: L, subsystem: 'mlb_operations', component, method,
  basis: { throughSeason: basis.throughSeason ?? null, gameDate: basis.gameDate ?? null },
  window: { seasons: [2016, 2017, 2018], skipped: [], sample: 700, unit: 'pairs' },
  heldOut: [{ kind: 'club_split', part: 'estimate:hitter:floor', n: 120, expected: 0.1, observed: 0.12, passed: true },
    { kind: 'history', part: 'results:hitter:floor', n: 1600, expected: 0.1, observed: 0.126, passed: true },
    { kind: 'age_band', part: 'hitter:30-33', n: 400, expected: 0, observed: -0.002, passed: true }],
  priorWeight: { overall: 0.4, byPart: {} },
  gate: { passed, reason: passed ? 'Every check passed.' : 'Not adopted.', failures: passed ? [] : failures },
  priorSource: 'test', notes: [],
});
const standardsFailing = (failure: string) => () => recordCalibration({ model: null, record: rec('standards', 'standards-1', false, { gameDate: '2000-01-01' }, [failure]) }, { fitMs: 1 });
const ownStandards = () => recordCalibration({ model: { served: { ...STARTING_STANDARDS, source: 'save' }, roles: {} }, record: rec('standards', 'standards-1', true, { gameDate: '2000-01-02' }) }, { fitMs: 1 });
const agingModel = (serve: 'save' | 'starting', previous: 'save' | 'starting' = 'starting') => ({
  table: serve === 'save' ? priorAgingTable() : { firstAge: 20, hitter: [], pitcher: [] }, fitted: priorAgingTable(), cells: { hitter: [], pitcher: [] },
  serve: { hitter: serve, pitcher: serve }, decisions: { hitter: { previous }, pitcher: { previous } },
});
const ownAging = () => recordCalibration({ model: agingModel('save'), record: rec('aging', AGING_METHOD, true, { throughSeason: 1991 }) }, { fitMs: 1 });
const keptAging = () => recordCalibration({ model: agingModel('starting'), record: rec('aging', AGING_METHOD, true, { throughSeason: 1991 }) }, { fitMs: 1 });
const returnedAging = () => recordCalibration({ model: agingModel('starting', 'save'), record: rec('aging', AGING_METHOD, true, { throughSeason: 1991 }) }, { fitMs: 1 });
const resultsModel = (source: 'save' | 'starting') => ({
  parts: Object.fromEntries(['hitter', 'starter', 'reliever', 'baserunning', 'defense'].map((p) => [p, { part: p, source: ['baserunning', 'defense'].includes(p) ? 'starting' : source, reason: source === 'save' ? null : 'kept', served: { weights: [5, 3, 3], k: 500 } }])),
  params: { weights: RESULTS_PRIOR.weights, stabilization: { ...RESULTS_PRIOR.stabilization, hitter: source === 'save' ? 900 : 500 } },
});
const ownResults = () => recordCalibration({ model: resultsModel('save'), record: rec('results', RESULTS_METHOD, true, { throughSeason: 1991 }) }, { fitMs: 1 });
const keptResults = () => recordCalibration({ model: resultsModel('starting'), record: rec('results', RESULTS_METHOD, true, { throughSeason: 1991 }) }, { fitMs: 1 });
const platoonModel = (source: 'save' | 'starting', reason: string | null) => ({ source, served: source === 'save' ? 2500 : 5000, fitted: 2500, fittedServed: 2500, cases: 6614, priorWeight: 0.1, decision: null, reason });
const ownPlatoon = () => recordCalibration({ model: platoonModel('save', null), record: rec('platoon', PLATOON_METHOD, true, { throughSeason: 1991 }) }, { fitMs: 1 });
const toolsPart = (source: 'save' | 'starting', reason: string | null, served: unknown) => ({ source, served, fitted: served, fittedServed: served, cases: 1500, priorWeight: 0.2, decision: null, reason });
const ownTools = () => recordCalibration({ model: { bat: toolsPart('save', null, [0.0016, 0.0003, 0.0013, 0.0009, 0]), blend: toolsPart('starting', 'kept', 1), forwardSeasons: 6 }, record: rec('tools', TOOLS_METHOD, true, { throughSeason: 1991 }) }, { fitMs: 1 });
const noForward = () => recordCalibration({ model: { bat: toolsPart('starting', 'forward', [0.00155, 0.00033, 0.00122, 0.00086, 0]), blend: toolsPart('starting', 'forward', 1), forwardSeasons: 0 }, record: rec('tools', TOOLS_METHOD, false, { throughSeason: 1991 }, ['forward: 0 of 5 forward seasons']) }, { fitMs: 1 });
const keptPlatoon = () => recordCalibration({ model: platoonModel('starting', 'kept'), record: rec('platoon', PLATOON_METHOD, true, { throughSeason: 1991 }) }, { fitMs: 1 });
const noSplits = () => recordCalibration({ model: null, record: rec('platoon', PLATOON_METHOD, false, { throughSeason: 1991 }, ['no_splits: The export carries no batting lines against left- and right-handed pitching.']) }, { fitMs: 1 });
const linesModel = (source: 'save' | 'starting', reason: 'relievers' | 'check_failed' | null) => ({
  served: { ...STARTING_STANDARDS, source: 'save' }, roles: {},
  bullpen: {
    lines: { ...BULLPEN_PRIOR, long: source === 'save' ? 1.733 : 1.6, source, leagueLeverage: 1.02 }, basis: source === 'save' ? 'measured' : 'starting',
    measuredOn: '2026-5-16', measured: 1.733, relievers: 219, seasonSplit: 'passed', seasonSplitWhy: null,
    attempt: { gameDate: '2026-5-16', measured: 1.733, relievers: 219, reason: reason ?? 'measured' },
  },
});
const ownStandardsWithLine = () => recordCalibration({ model: linesModel('save', null), record: rec('standards', 'standards-2', true, { gameDate: '2000-01-02' }) }, { fitMs: 1 });
const standardsTooFewRelievers = () => recordCalibration({ model: linesModel('starting', 'relievers'), record: rec('standards', 'standards-2', true, { gameDate: '2000-01-02' }) }, { fitMs: 1 });
const ownDefense = () => recordCalibration({ model: { weights: DEFENSE_WEIGHT, positions: {} }, record: rec('defense', 'defense-1', true, { throughSeason: 1991 }) }, { fitMs: 1 });

function state(setup: Array<() => unknown>, league: number | null = L) {
  historyDb.exec(`DELETE FROM save_calibration_fits`);
  for (const s of setup) s();
  clearRosterReviewCalibrationCache();
  const y = rosterReviewCalibration(league);
  historyDb.exec(`DELETE FROM save_calibration_fits`);
  clearRosterReviewCalibrationCache();
  return y;
}

const STATES: Array<[string, Array<() => unknown>, number | null, string]> = [
  ['a club with no major league', [], null, 'Using starting yardsticks: this club has no major league in the export'],
  ['nothing measured yet (a first start, a refit still running)', [], L, 'Using starting yardsticks for now: this league has not been measured yet'],
  ['too early in the season', [standardsFailing('games')], L, 'Using starting yardsticks: it is too early in the season to tell who the regulars are'],
  ['games played not in the export', [standardsFailing('games_unknown')], L, 'Using starting yardsticks: the export does not say how many games the clubs have played'],
  ['too few clubs', [standardsFailing('clubs')], L, 'Using starting yardsticks: too few clubs have a settled lineup to measure'],
  ['not enough seasons', [standardsFailing("seasons: the league's own past seasons could not be checked")], L, 'Using starting yardsticks: not enough seasons in this league yet'],
  ['a check failed', [standardsFailing('club_split estimate:hitter:floor: 0.200 against 0.100')], L, "Using starting yardsticks: the league's own ones did not hold up when checked"],
  ['some own', [ownStandards], L, "Some yardsticks are this league's own; others are starting values"],
  ['all own', [ownStandardsWithLine, ownAging, ownDefense, ownResults, ownPlatoon, ownTools], L, "Yardsticks set from this league's own seasons (through 1991)"],
  ['own standards measured before the long-man line was (the line not yet measured)', [ownStandards, ownAging, ownDefense, ownResults, ownPlatoon], L, "Some yardsticks are this league's own; others are starting values"],
  ['own standards; aging and recent seasons checked and held up', [ownStandards, keptAging, keptResults], L, "Some yardsticks are this league's own; others are starting values"],
  ['nothing of the league\'s own serves, the first one held up', [keptAging, keptResults, standardsFailing('games')], L, 'Using starting yardsticks: it is too early in the season to tell who the regulars are'],
];

describe('the yardsticks line gives the true reason, plainly', () => {
  it.each(STATES)('%s', (_name, setup, league, line) => {
    const y = state(setup, league);
    expect(y.line).toBe(line);
    expect(y.line.length).toBeLessThan(90);
    expect(y.line).not.toMatch(BANNED);
    expect(y.tip).not.toMatch(BANNED);
  });

  it('the hover says how the league\'s own yardsticks were checked, in plain words', () => {
    const y = state([ownStandards, ownAging, ownDefense, ownResults]);
    expect(y.tip).toMatch(/half the clubs/);
    expect(y.tip).toMatch(/How much recent seasons count: How much a player's last three seasons count/);
    expect(y.tip).toMatch(/clearly better for hitters and starting pitchers and relievers/);
    expect(y.tip).toMatch(/next season/);
    expect(y.tip).toMatch(/seasons it had not seen/);
  });

  it('the hover gives each starting yardstick its own reason', () => {
    const y = state([standardsFailing('games')]);
    expect(y.tip).toMatch(/The line for each job: the starting values, because it is too early in the season/);
    expect(y.tip).toMatch(/How players age: the starting values, because this league has not been measured yet/);
  });

  it('a starting value the league was checked against says so: it held up, it is not "not measured"', () => {
    const y = state([ownStandards, keptAging, keptResults]);
    expect(y.tip).toMatch(/How players age: the starting values, because they were checked on this league's seasons and held up\./);
    expect(y.tip).toMatch(/How much recent seasons count: the starting values, because they were checked on this league's seasons and held up\./);
    expect(y.groups.find((g) => g.key === 'results')).toMatchObject({ source: 'starting', reason: 'kept' });
    // the review is served the starting values, never the league's own under another name
    expect(y.review.aging).toBeNull();
    expect(y.results).toBe(RESULTS_PRIOR);
    const waiting = state([() => recordCalibration({ model: { ...agingModel('starting'), decisions: { hitter: { previous: 'starting', streak: 1 }, pitcher: { previous: 'starting', streak: 0 } } }, record: rec('aging', AGING_METHOD, true, { throughSeason: 1991 }) }, { fitMs: 1 })]);
    expect(waiting.tip).toMatch(/How players age: the starting values, because this league's own did better at the last check and must do so once more before they are used\./);
    expect(waiting.tip).not.toMatch(BANNED);
    const back = state([returnedAging]);
    expect(back.tip).toMatch(/How players age: the starting values, because they did better than this league's own when checked again\./);
  });

  it('the league\'s own serve the review only where they were clearly better', () => {
    const y = state([ownResults, ownAging]);
    expect(y.results.stabilization.hitter).toBe(900);
    expect(y.results.stamp.status).toBe('calibrated');
    expect(y.review.aging).not.toBeNull();
  });

  it('how much a hitter\'s own split counts, and who counts as a long man, are said plainly with their true reason', () => {
    const own = state([ownStandardsWithLine, ownPlatoon]);
    expect(own.tip).toMatch(/How much a hitter's own split counts: From 700 hitter-seasons in this league/);
    expect(own.tip).toMatch(/It applies where his platoon ratings are not visible\./);
    expect(own.tip).toMatch(/Who counts as a long man: A reliever who averages 1\.7 or more innings an appearance, about the longest-working 15 in 100 of this league's relievers \(219 relievers, as of May 16, 2026\)/);
    expect(own.tip).toMatch(/half the clubs picked out about the same share of the rest, and so did a line drawn from the first half of the season/);
    expect(own.platoon).toMatchObject({ shrinkAroundLeague: 2500, source: 'save' });
    expect(own.bullpen.long).toBe(1.733);
    const kept = state([keptPlatoon, standardsTooFewRelievers]);
    expect(kept.tip).toMatch(/How much a hitter's own split counts: the starting values, because they were checked on this league's seasons and held up\./);
    expect(kept.tip).toMatch(/Who counts as a long man: the starting value \(a reliever who averages 1\.6 or more innings an appearance\), because too few relievers have pitched enough to measure\./);
    expect(kept.platoon).toBe(PLATOON_PRIOR);
    expect(kept.bullpen.long).toBe(1.6);
    const missing = state([noSplits]);
    expect(missing.tip).toMatch(/How much a hitter's own split counts: the starting values, because this league's export has no batting records against left- and right-handed pitchers\./);
    // the Pitching Staff page's hover on how long a reliever throws says what a long man is here, and whose line it is
    expect(own.longMan).toMatch(/averages 1\.7 or more innings an appearance: about the longest-working 15 in 100 of this league's relievers\./);
    expect(kept.longMan).toMatch(/1\.6 or more innings an appearance: Pennant's starting line, because too few relievers have pitched enough to measure/);
    expect(state([]).longMan).toMatch(/because this league has not been measured yet/);
    for (const y of [own, kept, missing]) {
      expect(y.tip).not.toMatch(BANNED);
      expect(y.line).not.toMatch(BANNED);
      expect(y.longMan).not.toMatch(BANNED);
    }
  });

  it('the page component adds no visible words of its own', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/pages/mlb/Yardsticks.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const jsxText = [...src.matchAll(/>([^<>{}]+)</g)].map((m) => m[1].trim()).filter(Boolean);
    expect(jsxText).toEqual([]);
  });
});

describe('what the tools say (cycle 4)', () => {
  it('a league with no ratings saved before a season says so in the hover, never "not measured", and serves the starting values', () => {
    const y = state([noForward]);
    const g = y.groups.find((x) => x.key === 'tools');
    expect(g).toMatchObject({ source: 'starting', reason: 'no_forward_ratings' });
    expect(y.tip).toMatch(/What a hitter's tools say, and how much they hold his results back: the starting values, because this league has no ratings saved before a season to check them against yet/);
    expect(y.tip).not.toMatch(BANNED);
  });

  it('the league\'s own slopes serve where adopted, and the Lineup page reads the same ones', async () => {
    const { toolsParamsFor } = await import('../server/toolsCalibration');
    historyDb.exec(`DELETE FROM save_calibration_fits`);
    ownTools();
    clearRosterReviewCalibrationCache();
    const y = rosterReviewCalibration(L);
    const lineup = toolsParamsFor(L);
    historyDb.exec(`DELETE FROM save_calibration_fits`);
    clearRosterReviewCalibrationCache();
    expect(y.groups.find((x) => x.key === 'tools')?.source).toBe('save');
    expect(y.tools.source).toBe('save');
    expect(lineup).toEqual(y.tools);
  });
});

describe('the tools weight in force reaches the results params', () => {
  it('where the league\'s own tools weight serves, every working estimate is blended with it; otherwise the starting 1', () => {
    const ownWeight = () => recordCalibration({ model: { bat: toolsPart('starting', 'kept', [0.00155, 0.00033, 0.00122, 0.00086, 0]), blend: toolsPart('save', null, 1.5), forwardSeasons: 6 }, record: rec('tools', TOOLS_METHOD, true, { throughSeason: 1991 }) }, { fitMs: 1 });
    expect(state([ownWeight]).results.toolsWeight).toEqual({ hitter: 1.5, starter: 1, reliever: 1 });
    expect(state([noForward]).results.toolsWeight).toEqual({ hitter: 1, starter: 1, reliever: 1 });
  });
});
