import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CEILING_LINES, evaluateDevelopmentProtection, startingLines, type CeilingLinesInForce, type DevelopmentalContext, type LastImportReading } from '../server/developmentFit.js';
import { historyDb } from '../server/history.js';
import { syntheticScoutedAbility } from '../server/scoutedEvidence.js';
import { recordCalibration } from '../server/saveCalibrationStore.js';
import {
  measureCeilingLines, nearestRank, STAKES_LINES_COMPONENT, STAKES_LINES_METHOD, STAKES_SUBSYSTEM, stakesLinesFor, type MajorLeaguer,
} from '../server/stakesLines.js';
import { openDevelopmentalContext } from '../server/developmentalContext.js';
import { IDS } from './fixture.js';

/**
 * The ceiling lines of the developmental-stakes model are a measurement of the league's own major leaguers at each import (cycle 4 of
 * the per-save calibration, D-050 as amended, D-053): served as measured once a club split holds, never pulled toward the starting
 * lines, kept in force when a later measurement does not hold up, and the starting lines only where the league cannot be measured,
 * named as Pennant's, never as the league's.
 */

let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
/** A league of `clubs` clubs, `per` hitters and `per` pitchers each, composites integers around a centre (a normal, rounded). */
function league(clubs: number, per: number, centre: { hitter: number; pitcher: number }, clubEffect = 0): MajorLeaguer[] {
  seed = 11;
  const out: MajorLeaguer[] = [];
  for (let c = 1; c <= clubs; c += 1) {
    const shift = clubEffect * (c % 2 === 0 ? 1 : -1);
    for (const kind of ['hitter', 'pitcher'] as const) {
      for (let i = 0; i < per; i += 1) {
        const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
        out.push({ clubId: c, kind, composite: Math.round(centre[kind] + shift + 4 * z) });
      }
    }
  }
  return out;
}
const basis = { leagueId: 999, gameDate: '2031-05-01', throughSeason: 2030 };
const START = startingLines('not_measured');

describe('the ceiling lines are measured from the league\'s own major leaguers', () => {
  it('a league like the one the starting lines came from is measured, checked and served as measured', () => {
    const players = league(30, 13, { hitter: 50, pitcher: 48 });
    const { model, record } = measureCeilingLines(players, basis, START);
    expect(record.gate.passed).toBe(true);
    expect(model.inForce.source).toBe('save');
    const hitters = players.filter((p) => p.kind === 'hitter').map((p) => p.composite);
    // what is checked is what is served: the nearest-rank quantiles themselves, actual composite values, no pull toward the starting lines
    expect(model.inForce.lines.hitter).toEqual({ fringe: nearestRank(hitters, 0.1), regular: nearestRank(hitters, 0.5), impact: nearestRank(hitters, 0.9) });
    for (const v of Object.values(model.inForce.lines.hitter)) expect(Number.isInteger(v)).toBe(true);
  });

  it('a league far from the starting lines is served its own, not failed for being different', () => {
    const { model, record } = measureCeilingLines(league(30, 13, { hitter: 60, pitcher: 58 }), basis, START);
    expect(record.gate.passed).toBe(true);
    expect(model.inForce.lines.hitter.regular).toBeGreaterThanOrEqual(58);
    expect(model.inForce.lines.pitcher.regular).toBeGreaterThanOrEqual(56);
  });

  it('many major leaguers exactly on a line (integer composites) do not fail the check: it is read at and under the line', () => {
    // every pitcher's composite is one of three values: most sit exactly on a line
    const players = league(30, 13, { hitter: 50, pitcher: 48 }).map((p) => (p.kind === 'pitcher' ? { ...p, composite: p.composite < 46 ? 45 : p.composite < 51 ? 48 : 53 } : p));
    const { record } = measureCeilingLines(players, basis, START);
    expect(record.gate.passed).toBe(true);
  });

  it('a small or fictional league keeps Pennant\'s starting lines, and says why', () => {
    const few = measureCeilingLines(league(8, 13, { hitter: 50, pitcher: 48 }), basis, START);
    expect(few.model.inForce).toMatchObject({ source: 'starting', reason: 'players', lines: CEILING_LINES });
    const thin = measureCeilingLines(league(20, 4, { hitter: 50, pitcher: 48 }), basis, START);
    expect(thin.model.inForce).toMatchObject({ source: 'starting', reason: 'players' });
    expect(thin.record.gate.reason).toMatch(/fewer than 100/);
  });

  it('a measurement that swings with which clubs drew it is not served', () => {
    const { model, record } = measureCeilingLines(league(30, 13, { hitter: 50, pitcher: 48 }, 7), basis, START);
    expect(record.gate.passed).toBe(false);
    expect(model.inForce).toMatchObject({ source: 'starting', reason: 'check_failed' });
  });

  it('a measurement that does not hold up keeps the league\'s own lines in force, never flipping back to the starting ones', () => {
    const own = measureCeilingLines(league(30, 13, { hitter: 55, pitcher: 52 }), basis, START).model.inForce;
    const later = measureCeilingLines(league(30, 13, { hitter: 50, pitcher: 48 }, 7), { ...basis, gameDate: '2031-06-01' }, own);
    expect(later.model.inForce).toMatchObject({ source: 'save', reason: 'carried', lines: own.lines, measuredOn: own.measuredOn });
  });
});

describe('what a tier says about the lines', () => {
  const ability = syntheticScoutedAbility({ current: 40, potential: 51 });
  const tier = (lines: CeilingLinesInForce) => evaluateDevelopmentProtection({ age: 20, ability, lines, context: null });

  it('the starting lines are named as Pennant\'s, never as the league\'s', () => {
    const r = tier(START).reasons.join(' ');
    expect(r).toMatch(/Pennant's starting line/);
    expect(r).not.toMatch(/this league's|organization's major league/);
  });

  it('the league\'s own lines are named as his organization\'s major league\'s (a minor leaguer plays in another league)', () => {
    const own: CeilingLinesInForce = { lines: CEILING_LINES, source: 'save', reason: 'measured', measuredOn: '2031-05-01', previous: null };
    const r = tier(own).reasons.join(' ');
    expect(r).toMatch(/hitters in his organization's major league/);
    expect(r).not.toMatch(/this league's/);
  });

  const movedAt = (date: string, regular = 52): CeilingLinesInForce => ({
    lines: { ...CEILING_LINES, hitter: { fringe: 45, regular, impact: 58 } }, source: 'save', reason: 'measured', measuredOn: date,
    previous: { lines: CEILING_LINES, source: 'starting', measuredOn: null, replacedOn: '2031-05-01' },
  });
  const AT_A: DevelopmentalContext = { level: 4, levelName: 'A', leagueName: 'Test League', ageRelativeToLevel: 0, ageProfile: { scope: 'league', players: 200, averageAge: 20 } };
  const read = (current: number, potential: number, lines: CeilingLinesInForce, lastImport: LastImportReading | null, age = 20) =>
    evaluateDevelopmentProtection({ age, ability: syntheticScoutedAbility({ current, potential }), lines, context: AT_A, lastImport }).reasons.join(' ');

  it('the lines moved and nothing about him did (same ratings, age and level as at the import before), and his tier changed: said so', () => {
    const reasons = read(40, 51, movedAt('2031-05-01'), { current: 40, potential: 51, age: 20, level: 4 });
    expect(reasons).toMatch(/The ceiling lines moved when his organization's major leaguers were measured on May 1, 2031 \(a regular: 50 to 52; an impact player: 56 to 58\)/);
    expect(reasons).toMatch(/His ratings, age and level are what they were at the import before, when his stakes read/);
    expect(reasons).toMatch(/not anything about him/);
  });

  it('the lines moved but his own potential moved too (the regular line 50 to 49 while his potential fell 51 to 49): no line-move sentence', () => {
    const lines = movedAt('2031-05-01', 49);
    expect(read(40, 49, lines, { current: 40, potential: 51, age: 20, level: 4 })).not.toMatch(/moved|not anything about him/);
  });

  it('no sentence either when his age, his level or his current rating changed, or when the import before is not known', () => {
    const lines = movedAt('2031-05-01');
    expect(read(40, 51, lines, { current: 40, potential: 51, age: 19, level: 4 })).not.toMatch(/moved/);
    expect(read(40, 51, lines, { current: 40, potential: 51, age: 20, level: 5 })).not.toMatch(/moved/);
    expect(read(40, 51, lines, { current: 39, potential: 51, age: 20, level: 4 })).not.toMatch(/moved/);
    expect(read(40, 51, lines, null)).not.toMatch(/moved/);
  });

  it('a tier the move did not change says nothing about it, even where his ceiling band moved (the tier is what is compared)', () => {
    expect(read(40, 60, movedAt('2031-05-01'), { current: 40, potential: 60, age: 20, level: 4 })).not.toMatch(/moved/);
    // at 29 his development is behind him: fringe and below both set the lowest tier, so a band move there changes no tier
    const lines = { ...movedAt('2031-05-01'), lines: { ...CEILING_LINES, hitter: { fringe: 46, regular: 52, impact: 58 } } };
    expect(read(45, 45, lines, { current: 45, potential: 45, age: 29, level: 4 }, 29)).not.toMatch(/moved/);
  });

  it('after the import that moved the lines, the sentence is not given: his own ratings may have moved since', () => {
    expect(read(40, 51, movedAt('2031-06-01'), { current: 40, potential: 51, age: 20, level: 4 })).not.toMatch(/moved/);
  });

  it('the evaluator refuses to tier without the lines in force (never a default)', () => {
    expect(() => evaluateDevelopmentProtection({ age: 20, ability, context: null } as unknown as Parameters<typeof evaluateDevelopmentProtection>[0])).toThrow(/ceiling lines/);
  });
});

describe('the lines in force for a save', () => {
  const run = (gameDate: string, hitter: number, clubEffect = 0, previous: CeilingLinesInForce = START) =>
    measureCeilingLines(league(30, 13, { hitter, pitcher: 48 }, clubEffect), { leagueId: IDS.league, gameDate, throughSeason: 2029 }, previous);
  afterAll(() => historyDb.prepare(`DELETE FROM save_calibration_fits WHERE subsystem = ?`).run(STAKES_SUBSYSTEM));

  it('nothing measured yet: the starting lines, "not measured"; a league not in the export: "no league"', () => {
    historyDb.prepare(`DELETE FROM save_calibration_fits WHERE subsystem = ?`).run(STAKES_SUBSYSTEM);
    expect(stakesLinesFor(IDS.league)).toMatchObject({ source: 'starting', reason: 'not_measured' });
    expect(stakesLinesFor(null)).toMatchObject({ source: 'starting', reason: 'no_league' });
  });

  it('serves the latest measurement at or before the export\'s game date (a reverted save never serves a later one), and a failed one\'s carried lines', () => {
    const first = run('2030-04-01', 55);
    recordCalibration(first, { fitMs: 1 });
    recordCalibration(run('2030-12-01', 60), { fitMs: 1 }); // after the fixture's game date (2030-06-01): never served
    expect(stakesLinesFor(IDS.league)).toMatchObject({ source: 'save', measuredOn: '2030-04-01' });
    const failed = run('2030-05-01', 50, 7, first.model.inForce);
    expect(failed.record.gate.passed).toBe(false);
    recordCalibration(failed, { fitMs: 1 });
    expect(stakesLinesFor(IDS.league)).toMatchObject({ source: 'save', reason: 'carried', lines: first.model.inForce.lines });
  });

  it('the lines a move replaced are served only on the export the move was measured on', () => {
    historyDb.prepare(`DELETE FROM save_calibration_fits WHERE subsystem = ?`).run(STAKES_SUBSYSTEM);
    const today = run('2030-06-01', 58);
    expect(today.model.inForce.previous).toMatchObject({ replacedOn: '2030-06-01' });
    recordCalibration(today, { fitMs: 1 });
    expect(stakesLinesFor(IDS.league).previous).toMatchObject({ source: 'starting', replacedOn: '2030-06-01' });
    historyDb.prepare(`DELETE FROM save_calibration_fits WHERE subsystem = ?`).run(STAKES_SUBSYSTEM);
    recordCalibration(run('2030-05-01', 58), { fitMs: 1 });
    expect(stakesLinesFor(IDS.league)).toMatchObject({ source: 'save', previous: null });
  });

  it('the context reader hands a club\'s tiers its organization\'s major league\'s lines, an affiliate\'s included', () => {
    const reader = openDevelopmentalContext();
    expect(reader.lines(IDS.mlbTeam)).toMatchObject({ source: 'save' });
    expect(reader.lines(IDS.aaaTeam)).toEqual(reader.lines(IDS.mlbTeam));
  });
});

describe('boundaries', () => {
  const code = (file: string) => fs.readFileSync(path.join(process.cwd(), 'server', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('the lines read no result, no usage, no philosophy, no Player Value and no MLB Operations answer', () => {
    for (const file of ['stakesLines.ts', 'stakesLinesRefit.ts']) {
      const source = code(file);
      expect(source, file).not.toMatch(/from '\.\/(philosophy|settings|assignmentPreference|staffPreference|playerValue[A-Za-z]*|mlb[A-Za-z]*|farm[A-Za-z]*|resultsEvidence|resultsMetrics|roleReview)\.js'/);
      expect(source, file).not.toMatch(/players_career_|players_game_|players_value|batting_ratings_|pitching_ratings_/);
    }
  });

  it('only the context reader resolves the lines for a tier; the refit alone measures them', () => {
    const files = fs.readdirSync(path.join(process.cwd(), 'server')).filter((f) => f.endsWith('.ts'));
    const readers = files.filter((f) => /from '\.\/stakesLines\.js'/.test(code(f)));
    expect(readers.sort()).toEqual(['developmentalContext.ts', 'stakesLinesRefit.ts']);
    expect(files.filter((f) => /from '\.\/stakesLinesRefit\.js'|import '\.\/stakesLinesRefit\.js'/.test(code(f)))).toEqual(['calibrationRefitWorker.ts']);
  });
});

describe('a line move is dated when it happened', () => {
  it('a later import that measures the same lines keeps the move\'s own date, not its own', () => {
    const moved = measureCeilingLines(league(30, 13, { hitter: 55, pitcher: 52 }), { ...basis, gameDate: '2031-05-01' }, START).model.inForce;
    const again = measureCeilingLines(league(30, 13, { hitter: 55, pitcher: 52 }), { ...basis, gameDate: '2031-06-01' }, moved).model.inForce;
    expect(again.measuredOn).toBe('2031-06-01');
    expect(again.previous).toMatchObject({ source: 'starting', replacedOn: '2031-05-01' });
    // At the later import the move is recorded but not claimed: his own ratings may have changed since
    const r = evaluateDevelopmentProtection({ age: 20, ability: syntheticScoutedAbility({ current: 40, potential: 51 }), lines: again, context: null }).reasons.join(' ');
    expect(r).not.toMatch(/moved/);
  });
});

describe('plain and true words', () => {
  it('a league too thin to measure keeps its own earlier lines and says it was not measured, never that it failed a check', () => {
    const own = measureCeilingLines(league(30, 13, { hitter: 55, pitcher: 52 }), basis, START).model.inForce;
    const thin = measureCeilingLines(league(8, 13, { hitter: 50, pitcher: 48 }), { ...basis, gameDate: '2031-06-01' }, own);
    expect(thin.model.inForce).toMatchObject({ source: 'save', reason: 'carried_unmeasured', lines: own.lines });
    expect(thin.record.notes.join(' ')).toMatch(/too few major leaguers to measure/);
    expect(thin.record.notes.join(' ')).not.toMatch(/did not hold up/);
  });

  it('the stakes stamps shown on the farm\'s thresholds table carry no cycle, decision number or file name', async () => {
    const { STAKES_CALIBRATION } = await import('../server/developmentFit.js');
    for (const c of STAKES_CALIBRATION) expect(c.stamp.basis, c.name).not.toMatch(/cycle \d|D-0\d\d|\.ts\b|`/);
  });
});
