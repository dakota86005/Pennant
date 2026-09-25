import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db';
import { historyDb } from '../server/history';
import { recordCalibration, type CalibrationRecord } from '../server/saveCalibrationStore';
import { clearRosterReviewCalibrationCache } from '../server/mlbCalibration';
import { reviewPorts, yardsticksFor } from '../server/mlbOperations';
import { clearResultsCaches, currentSeason } from '../server/resultsEvidence';
import { blendStabilization, RESULTS_PRIOR } from '../server/resultsMetrics';
import { RESULTS_METHOD } from '../server/mlbResultsFit';
import { clearStatCaches } from '../server/stats';
import { IDS } from './fixture';

/*
 * The results lens's season weights and stabilization reach every consumer as the fit IN FORCE (D-053, cycle 2): no reader holds a
 * default, and one request reads one set.
 */

const SERVER = path.join(process.cwd(), 'server');
const LEAGUE = IDS.league;
const P = [9101, 9102, 9103, 9104];
const STARTER = { kind: 'starting_pitcher', position: 1, label: 'starting pitcher' } as never;

const record = (k: number): CalibrationRecord => ({
  leagueId: LEAGUE, subsystem: 'mlb_operations', component: 'results', method: RESULTS_METHOD,
  basis: { throughSeason: 1991, gameDate: null }, window: { seasons: [1985, 1991], skipped: [], sample: 5000, unit: 'player-seasons' },
  heldOut: [], priorWeight: { overall: 0.1, byPart: {} }, gate: { passed: true, reason: 'test', failures: [] }, priorSource: 'test', notes: [],
});
const model = (k: number) => ({
  parts: Object.fromEntries(['hitter', 'starter', 'reliever', 'baserunning', 'defense'].map((p) => [p, { part: p, source: p === 'starter' || p === 'hitter' ? 'save' : 'starting', reason: null, served: { weights: [5, 3, 1], k } }])),
  params: { weights: RESULTS_PRIOR.weights, stabilization: { ...RESULTS_PRIOR.stabilization, hitter: k, starter: k } },
});

function withFit(k: number | null) {
  historyDb.exec(`DELETE FROM save_calibration_fits`);
  if (k !== null) recordCalibration({ model: model(k), record: record(k) }, { fitMs: 1 });
  clearRosterReviewCalibrationCache();
  clearResultsCaches();
}

beforeAll(() => {
  clearStatCaches(); clearResultsCaches();
  const year = currentSeason(LEAGUE) as number;
  const ins = db.prepare(`INSERT INTO players_career_pitching_stats (player_id, year, team_id, league_id, level_id, split_id, outs, er, ra, ha, bb, k, hra, hp, bf, g, gs, w, l, s, hld, war)
    VALUES (?, ?, 1, ?, 1, 1, ?, ?, ?, 0, ?, ?, ?, 1, ?, ?, ?, 0, 0, 0, 0, 1.0)`);
  P.forEach((id, i) => {
    ins.run(id, year, LEAGUE, 300, 30 + 10 * i, 32 + 10 * i, 15 + 10 * i, 130 - 20 * i, 6 + 4 * i, 400 + 20 * i, 15, 15);
    ins.run(id, year - 1, LEAGUE, 500, 60 + 10 * i, 62 + 10 * i, 30 + 10 * i, 210 - 30 * i, 12 + 4 * i, 690 + 10 * i, 26, 26);
  });
});

afterAll(() => {
  db.prepare(`DELETE FROM players_career_pitching_stats WHERE player_id IN (${P.join(',')})`).run();
  withFit(null);
  clearStatCaches();
});

describe('every consumer reads the results params in force', () => {
  it('the yardsticks serve the league\'s own once adopted, the starting values otherwise', () => {
    withFit(null);
    expect(yardsticksFor(IDS.mlbTeam).results).toBe(RESULTS_PRIOR);
    withFit(5000);
    expect(yardsticksFor(IDS.mlbTeam).results.stabilization.starter).toBe(5000);
  });

  it('the review\'s holder evidence and platoon reads change with the fit in force', () => {
    withFit(null);
    const before = reviewPorts(IDS.mlbTeam).holderEvidence(P, STARTER).get(P[0])!.reliability;
    const platoonBefore = [...reviewPorts(IDS.mlbTeam).platoon([IDS.starter]).values()][0]?.recordStabilization;
    withFit(5000);
    const after = reviewPorts(IDS.mlbTeam).holderEvidence(P, STARTER).get(P[0])!.reliability;
    expect(before).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    const platoonAfter = [...reviewPorts(IDS.mlbTeam).platoon([IDS.starter]).values()][0]?.recordStabilization;
    expect(platoonBefore).toBe(blendStabilization('hitter', RESULTS_PRIOR));
    expect(platoonAfter).toBe(blendStabilization('hitter', { ...RESULTS_PRIOR, stabilization: { ...RESULTS_PRIOR.stabilization, hitter: 5000 } }));
  });

  it('the standards refit may measure under the params it has just decided (what is checked is what is served)', () => {
    withFit(null);
    const override = { ...RESULTS_PRIOR, stabilization: { ...RESULTS_PRIOR.stabilization, starter: 5000 } };
    const r = reviewPorts(IDS.mlbTeam, { results: override }).holderEvidence(P, STARTER).get(P[0])!.reliability;
    expect(r).toBeLessThan(reviewPorts(IDS.mlbTeam).holderEvidence(P, STARTER).get(P[0])!.reliability);
  });
});

describe('no reader holds a default (static)', () => {
  const files = fs.readdirSync(SERVER).filter((f) => f.endsWith('.ts'));
  const code = (f: string) => fs.readFileSync(path.join(SERVER, f), 'utf8');

  it('the starting values are named only where they are declared or where the fallback is chosen, and no reader falls back to them', () => {
    const allowed = new Set(['resultsMetrics.ts', 'mlbCalibration.ts', 'mlbResultsFit.ts']);
    for (const f of files) if (!allowed.has(f)) expect(code(f), f).not.toMatch(/\bRESULTS_PRIOR\b/);
    // the fields the evidence carries are required: a lens builder that forgets one fails to compile, never serves the starting values
    expect(code('roleReview.ts')).toMatch(/\n  stabilization: number;/);
    expect(code('platoon.ts')).toMatch(/\n  recordStabilization: number;/);
    expect(code('roleReview.ts')).not.toMatch(/stabilization \?\?/);
    expect(code('platoon.ts')).not.toMatch(/recordStabilization \?\?/);
  });

  it('the old constants are gone: nothing can read a season weight or stabilization but through the params', () => {
    for (const f of files) expect(code(f), f).not.toMatch(/\b(SEASON_WEIGHTS|STABILIZATION)\b(?!_)/);
  });

  it('every request-scoped port reads the yardsticks once and passes their results params', () => {
    const src = code('mlbOperations.ts');
    expect(src).toMatch(/holderEvidence\(orgId, ids, role, opts \?\? \{\}, yardsticks\.results, yardsticks\.bullpen, yardsticks\.tools\)/);
    expect(src).toMatch(/platoonInputs\(orgId, ids, yardsticks\.results, yardsticks\.platoon, yardsticks\.tools\)/);
    expect(src).toMatch(/holderEvidence\(orgId, ids, role, \{\}, results, bullpen, tools\)/);
    expect(src).toMatch(/platoonInputs\(orgId, ids, results, yardsticks\.platoon, tools\)/);
    // plans, scenarios and the report reach evidence only through these ports
    for (const f of ['mlbPlans.ts', 'mlbReport.ts', 'mlbResponses.ts', 'mlbReview.ts', 'rosterScenario.ts']) {
      expect(code(f), f).not.toMatch(/\b(loadHitterResults|loadPitcherResults|loadDefenseResults|platoonInputs)\(/);
      expect(code(f), f).not.toMatch(/import \{[^}]*\bholderEvidence\b[^}]*\} from '\.\/mlbEvidence/);
    }
  });
});
