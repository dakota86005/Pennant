import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db';
import { historyDb } from '../server/history';
import { recordCalibration, type CalibrationRecord } from '../server/saveCalibrationStore';
import { clearRosterReviewCalibrationCache } from '../server/mlbCalibration';
import { reviewPorts, yardsticksFor } from '../server/mlbOperations';
import { clearResultsCaches, currentSeason } from '../server/resultsEvidence';
import { reviewClub, type ReviewPorts } from '../server/mlbReview';
import { BULLPEN_PRIOR, type BullpenLines } from '../server/bullpenRoles';
import { PLATOON_PRIOR } from '../server/platoon';
import { PLATOON_METHOD } from '../server/mlbPlatoonFit';
import { STANDARDS_METHOD } from '../server/mlbCalibrationFit';
import { STARTING_STANDARDS } from '../server/roleStandards';
import { clearStatCaches } from '../server/stats';
import type { LensEvidence } from '../server/roleReview';
import { IDS } from './fixture';
import { healthy26, viewOf } from './mlbFixtures';

/*
 * The platoon weights and the bullpen lines reach every consumer as the values IN FORCE (D-053, cycle 3): the review's reliever roles and
 * pen findings, a reliever's usage notes (which responses, plans and the report read) and the platoon reads. No reader holds a default.
 */

const SERVER = path.join(process.cwd(), 'server');
const LEAGUE = IDS.league;
const RELIEVER = 9201;
const RP = { kind: 'relief_pitcher', position: 1, label: 'relief pitcher' } as never;

const record = (component: string, method: string, basis: CalibrationRecord['basis']): CalibrationRecord => ({
  leagueId: LEAGUE, subsystem: 'mlb_operations', component, method, basis,
  window: { seasons: [1985, 1991], skipped: [], sample: 5000, unit: 'cases' }, heldOut: [], priorWeight: { overall: 0.1, byPart: {} },
  gate: { passed: true, reason: 'test', failures: [] }, priorSource: 'test', notes: [],
});
const EXTREME: BullpenLines = { ...BULLPEN_PRIOR, long: 3.0, source: 'save' };

function withFits(fits: { platoonK?: number; long?: BullpenLines }) {
  historyDb.exec('DELETE FROM save_calibration_fits');
  if (fits.platoonK !== undefined) {
    recordCalibration({ model: { source: 'save', served: fits.platoonK, fitted: fits.platoonK, fittedServed: fits.platoonK, cases: 6000, priorWeight: 0.1, decision: null, reason: null }, record: record('platoon', PLATOON_METHOD, { throughSeason: 1991, gameDate: null }) }, { fitMs: 1 });
  }
  if (fits.long) {
    recordCalibration({ model: { served: { ...STARTING_STANDARDS, source: 'save' }, roles: {}, bullpen: { lines: fits.long, measured: 3, asServed: 3, relievers: 200, passed: true, reason: null } }, record: record('standards', STANDARDS_METHOD, { throughSeason: null, gameDate: '1991-1-1' }) }, { fitMs: 1 });
  }
  clearRosterReviewCalibrationCache();
  clearResultsCaches();
}

beforeAll(() => {
  clearStatCaches(); clearResultsCaches();
  const year = currentSeason(LEAGUE) as number;
  // The fixture's export carries no leverage; this file's copy of it does (each test file builds its own fixture)
  db.exec('ALTER TABLE players_career_pitching_stats ADD COLUMN li REAL');
  // A reliever this season: 20 appearances, 34 innings (1.7 an appearance), low leverage (0.8 per batter faced)
  db.prepare(`INSERT INTO players_career_pitching_stats (player_id, year, team_id, league_id, level_id, split_id, outs, er, ra, ha, bb, k, hra, hp, bf, g, gs, w, l, s, hld, war, li)
    VALUES (?, ?, 1, ?, 1, 1, 102, 15, 16, 30, 12, 35, 4, 1, 150, 20, 0, 0, 0, 0, 0, 0.5, 120)`).run(RELIEVER, year, LEAGUE);
});

afterAll(() => {
  db.prepare('DELETE FROM players_career_pitching_stats WHERE player_id = ?').run(RELIEVER);
  withFits({});
  clearStatCaches();
});

describe('every consumer reads the platoon weights and bullpen lines in force', () => {
  it('the yardsticks serve the league\'s own once in force, the starting values otherwise', () => {
    withFits({});
    expect(yardsticksFor(IDS.mlbTeam).platoon).toBe(PLATOON_PRIOR);
    expect(yardsticksFor(IDS.mlbTeam).bullpen).toBe(BULLPEN_PRIOR);
    withFits({ platoonK: 100, long: EXTREME });
    expect(yardsticksFor(IDS.mlbTeam).platoon).toMatchObject({ shrinkAroundLeague: 100, shrinkAroundRatings: PLATOON_PRIOR.shrinkAroundRatings, source: 'save' });
    expect(yardsticksFor(IDS.mlbTeam).bullpen.long).toBe(3);
  });

  it('the review\'s ports carry them: the platoon reads and a reliever\'s usage notes change with the values in force', () => {
    withFits({});
    const before = reviewPorts(IDS.mlbTeam);
    expect([...before.platoon!([IDS.starter]).values()][0]?.platoon).toBe(PLATOON_PRIOR);
    expect(before.holderEvidence([RELIEVER], RP).get(RELIEVER)!.usage.join(' ')).toMatch(/Used as a long man/);
    withFits({ platoonK: 100, long: EXTREME });
    const after = reviewPorts(IDS.mlbTeam);
    expect(after.bullpen.long).toBe(3);
    expect([...after.platoon!([IDS.starter]).values()][0]?.platoon.shrinkAroundLeague).toBe(100);
    expect(after.holderEvidence([RELIEVER], RP).get(RELIEVER)!.usage.join(' ')).toMatch(/Used as a low-leverage arm/);
  });

  it('the refit may measure the standards under the lines it has just measured (what is checked is what is served)', () => {
    withFits({});
    expect(reviewPorts(IDS.mlbTeam, { bullpen: EXTREME }).holderEvidence([RELIEVER], RP).get(RELIEVER)!.usage.join(' ')).toMatch(/low-leverage arm/);
  });

  it('the review reads every reliever\'s role and the pen-wide findings under the lines it is given', () => {
    // RP1..RP8 = 105..112: three work 1.7 innings an appearance in low leverage (long men at 1.6), the rest one inning
    const ev = (id: number): LensEvidence => ({
      ratingsPct: 50, ratingsEvidence: 'complete', skillsPct: 50, runsPct: 50, sample: 600, sampleUnit: 'BF', toolsWeight: 1, reliability: 0.6, currentSample: 150, usage: [],
      ...(id >= 105 ? { bullpen: { g: 20, ip: id <= 107 ? 34 : 20, sv: id === 112 ? 10 : 0, hld: 0, leverage: id === 112 ? 2.0 : 0.8 } } : {}),
    });
    const ports = (bullpen: BullpenLines): ReviewPorts => ({ holderEvidence: (ids) => new Map(ids.map((id) => [id, ev(id)] as const)), bullpen });
    const view = viewOf(healthy26());
    const pen = (b: BullpenLines) => reviewClub(view, ports(b)).find((g) => g.kind === 'relief_pitcher')!;
    const starting = pen(BULLPEN_PRIOR);
    expect(starting.holders.filter((h) => h.tier === 'long')).toHaveLength(3);
    expect(starting.pen!.some((f) => f.kind === 'crowded_role')).toBe(true);
    const own = pen(EXTREME);
    expect(own.holders.filter((h) => h.tier === 'long')).toHaveLength(0);
    expect(own.pen!.some((f) => f.kind === 'crowded_role')).toBe(false);
  });
});

describe('no reader holds a default (static)', () => {
  const files = fs.readdirSync(SERVER).filter((f) => f.endsWith('.ts'));
  const code = (f: string) => fs.readFileSync(path.join(SERVER, f), 'utf8');

  it('the starting values are named only where they are declared or where the fallback is chosen', () => {
    const platoonAllowed = new Set(['platoon.ts', 'mlbCalibration.ts', 'mlbPlatoonFit.ts']);
    const bullpenAllowed = new Set(['bullpenRoles.ts', 'mlbCalibration.ts', 'mlbBullpenLines.ts', 'mlbCalibrationRefit.ts']);
    for (const f of files) {
      if (!platoonAllowed.has(f)) expect(code(f), f).not.toMatch(/\bPLATOON_PRIOR\b/);
      if (!bullpenAllowed.has(f)) expect(code(f), f).not.toMatch(/\b(BULLPEN_PRIOR|LONG_LINE_PRIOR)\b/);
    }
    // the refit names the starting lines only to run the one review whose tiers it then re-reads under the measured lines
    const refit = code('mlbCalibrationRefit.ts');
    expect(refit).toMatch(/standardsSample\(b\.leagueId, results, BULLPEN_PRIOR, toolsParamsForRefit\(b\.leagueId, b\.throughSeason\)\);/);
    expect(refit).toMatch(/return measureStandards\(rekeyRelievers\(sample, record\.lines\)/);
    expect(refit.match(/\bBULLPEN_PRIOR\b/g)).toHaveLength(2); // the import and that one review
  });

  it('the old constants are gone', () => {
    for (const f of files) expect(code(f), f).not.toMatch(/\b(PLATOON_SHRINK_K|RATING_PRIOR_WEIGHT|DEFAULT_LEFT_SHARE|LONG_INNINGS)\b/);
  });

  it('the lines and weights are required arguments, never defaulted', () => {
    expect(code('platoon.ts')).toMatch(/\n  platoon: PlatoonParams;/);
    expect(code('platoon.ts')).toMatch(/\n  leagueLeftShare: number \| null;/);
    expect(code('mlbReview.ts')).toMatch(/\n  bullpen: BullpenLines;/);
    expect(code('bullpenRoles.ts')).toMatch(/export function roleOf\(u: BullpenUsage, lines: BullpenLines\)/);
    expect(code('bullpenRoles.ts')).toMatch(/export function penFindings\(arms: PenArm\[\], lines: BullpenLines\)/);
    expect(code('mlbReview.ts')).toMatch(/leverage: b\.leverage \}, ports\.bullpen\)/);
    expect(code('mlbReview.ts')).toMatch(/\}\), ports\.bullpen\),/);
    const ops = code('mlbOperations.ts');
    expect(ops).toMatch(/holderEvidence\(orgId, ids, role, opts \?\? \{\}, yardsticks\.results, yardsticks\.bullpen, yardsticks\.tools\)/);
    expect(ops).toMatch(/platoonInputs\(orgId, ids, yardsticks\.results, yardsticks\.platoon, yardsticks\.tools\)/);
    expect(ops).toMatch(/const bullpen = override\?\.bullpen \?\? yardsticks\.bullpen;/);
    // the only callers of the tier and the pen findings pass the lines they were handed
    const users = files.filter((f) => /import \{[^}]*\b(roleOf|penFindings)\b[^}]*\} from '\.\/bullpenRoles\.js'/.test(code(f)));
    expect(users.sort()).toEqual(['mlbCalibrationFit.ts', 'mlbEvidence.ts', 'mlbReview.ts']);
    let checked = 0;
    for (const f of [...users, 'bullpenRoles.ts']) {
      const src = code(f);
      // the name bullpenRoles' roleOf goes by in this file (it is aliased where another roleOf exists)
      const alias = /\broleOf as (\w+)[^}]*\} from '\.\/bullpenRoles\.js'/.exec(src)?.[1] ?? 'roleOf';
      const calls = new RegExp(`(?<!function )\\b(?:${alias}|penFindings)\\((?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\))*\\)`, 'g');
      for (const m of src.matchAll(calls)) { checked += 1; expect(m[0], f).toMatch(/(ports\.bullpen|, bullpen|lines)\)$/); }
    }
    // the review's tiers and pen findings, the evidence's notes and the standards' re-read: every call site was seen
    expect(checked).toBeGreaterThanOrEqual(4);
  });
});
