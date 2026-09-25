import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { historyDb } from '../server/history';
import { recordCalibration, type CalibrationRecord } from '../server/saveCalibrationStore';
import { clearRosterReviewCalibrationCache, rosterReviewCalibration } from '../server/mlbCalibration';
import { priorAgingTable } from '../server/mlbCalibrationFit';
import { DEFENSE_WEIGHT } from '../server/roleReview';
import { STARTING_STANDARDS } from '../server/roleStandards';

/**
 * The roster review's yardsticks line is written for a GM (AGENTS.md "Writing for the GM"): the visible line and its hover carry no
 * method words. The record behind them (checks, windows, verdicts) is the API's.
 */
const BANNED = /\bprior\b|\bgate\b|held-out|coverage|calibrat|\bcentral\b|quantile|D-0\d/i;
const L = 100;

const rec = (component: string, method: string, passed: boolean, over: Partial<CalibrationRecord['basis']> = {}, failures: string[] = []): CalibrationRecord => ({
  leagueId: L, subsystem: 'mlb_operations', component, method,
  basis: { throughSeason: over.throughSeason ?? null, gameDate: over.gameDate ?? null },
  window: { seasons: [2016, 2017, 2018], skipped: [], sample: 700, unit: 'pairs' },
  heldOut: [{ kind: 'club_split', part: 'estimate:hitter:floor', n: 120, expected: 0.1, observed: 0.12, passed: true },
    { kind: 'history', part: 'results:hitter:floor', n: 1600, expected: 0.1, observed: 0.126, passed: true },
    { kind: 'age_band', part: 'hitter:30-33', n: 400, expected: 0, observed: -0.002, passed: true }],
  priorWeight: { overall: 0.4, byPart: {} }, gate: { passed, reason: passed ? 'Every check passed.' : 'Not adopted: a check failed.', failures: passed ? [] : failures.length ? failures : ['club_split estimate:hitter:floor'] },
  priorSource: 'test', notes: [],
});

function states() {
  const out: Array<{ line: string; tip: string }> = [];
  const snap = () => { clearRosterReviewCalibrationCache(); const y = rosterReviewCalibration(L); out.push({ line: y.line, tip: y.tip }); return y; };
  historyDb.exec(`DELETE FROM save_calibration_fits`);
  snap(); // nothing measured
  recordCalibration({ model: null, record: rec('standards', 'standards-1', false, { gameDate: '2000-01-01' }, ['games']) }, { fitMs: 1 });
  snap(); // too early in the season
  recordCalibration({ model: null, record: rec('aging', 'aging-1', false, { throughSeason: 1990 }) }, { fitMs: 1 });
  snap(); // a check failed
  recordCalibration({ model: { served: { ...STARTING_STANDARDS, source: 'save' }, roles: {} }, record: rec('standards', 'standards-1', true, { gameDate: '2000-01-02' }) }, { fitMs: 1 });
  snap(); // some own
  recordCalibration({ model: { table: priorAgingTable(), cells: { hitter: [], pitcher: [] } }, record: rec('aging', 'aging-1', true, { throughSeason: 1991 }) }, { fitMs: 1 });
  recordCalibration({ model: { weights: DEFENSE_WEIGHT, positions: {} }, record: rec('defense', 'defense-1', true, { throughSeason: 1991 }) }, { fitMs: 1 });
  const all = snap(); // all own
  historyDb.exec(`DELETE FROM save_calibration_fits`);
  clearRosterReviewCalibrationCache();
  return { out, all };
}

describe('the yardsticks line is plain', () => {
  const { out, all } = states();

  it('every state has one short line and no method words, visible or in the hover', () => {
    for (const s of out) {
      expect(s.line, s.line).not.toMatch(BANNED);
      expect(s.line.length).toBeLessThan(90);
      expect(s.tip, s.tip).not.toMatch(BANNED);
    }
  });

  it('the lines are the four the page may show', () => {
    const lines = new Set(out.map((s) => s.line.replace(/ \(through \d+\)$/, '')));
    expect([...lines].sort()).toEqual([
      "Some yardsticks set from this league's own seasons; others are starting values",
      "Using starting yardsticks: not enough seasons in this league yet",
      "Using starting yardsticks: the league's own ones did not hold up when checked",
      "Yardsticks set from this league's own seasons",
    ].sort());
    expect(all.line).toBe("Yardsticks set from this league's own seasons (through 1991)");
  });

  it('the hover says how the league\'s own yardsticks were checked, in plain words', () => {
    expect(all.tip).toMatch(/half the clubs/);
    expect(all.tip).toMatch(/next season/);
    expect(all.tip).toMatch(/seasons it had not seen/);
  });

  it('the page component adds no visible words of its own', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/pages/mlb/Yardsticks.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const jsxText = [...src.matchAll(/>([^<>{}]+)</g)].map((m) => m[1].trim()).filter(Boolean);
    expect(jsxText).toEqual([]);
  });
});
