import { describe, expect, it } from 'vitest';
import { historyDb } from '../server/history';
import { adoptedCalibration, calibrationAttempted, latestCalibrationAttempt, recordCalibration, type CalibrationRecord } from '../server/saveCalibrationStore';
import { recordCalibrationRefits, type PendingCalibration } from '../server/saveCalibration';
import { saveIdentity } from '../server/saveIdentity';
import { rosterReviewCalibration, clearRosterReviewCalibrationCache } from '../server/mlbCalibration';
import { STARTING_STANDARDS } from '../server/roleStandards';

const L = 100;
const record = (over: Partial<CalibrationRecord> & { passed: boolean; season?: number | null; date?: string | null; component?: string; method?: string }): CalibrationRecord => ({
  leagueId: L, subsystem: 'test', component: over.component ?? 'thing', method: over.method ?? 'm-1',
  basis: { throughSeason: over.season === undefined ? 2025 : over.season, gameDate: over.date ?? null },
  window: { seasons: [2024, 2025], skipped: [], sample: 10, unit: 'pairs' }, heldOut: [], priorWeight: { overall: 0.3, byPart: {} },
  gate: { passed: over.passed, reason: over.passed ? 'Every check passed.' : 'Not adopted: a check failed.', failures: over.passed ? [] : ['x'] },
  priorSource: 'test', notes: [],
});
const clear = () => historyDb.exec(`DELETE FROM save_calibration_fits`);

describe('the per-save calibration store', () => {
  it('is idempotent: a second record of the same key writes nothing', () => {
    clear();
    expect(recordCalibration({ model: { v: 1 }, record: record({ passed: true }) }, { fitMs: 1 })).toBe(1);
    expect(recordCalibration({ model: { v: 2 }, record: record({ passed: true }) }, { fitMs: 1 })).toBe(0);
    expect(adoptedCalibration<{ v: number }>(L, 'test', 'thing', 'm-1')!.model.v).toBe(1);
    expect(calibrationAttempted(L, 'test', 'thing', 'm-1', '2025')).toBe(true);
  });

  it('is keyed by the save\'s identity: another save under the same league id finds nothing', () => {
    clear();
    recordCalibration({ model: {}, record: record({ passed: true }) }, { fitMs: 1 });
    historyDb.prepare(`UPDATE save_calibration_fits SET save_name = ?`).run('another save|00000000');
    expect(adoptedCalibration(L, 'test', 'thing', 'm-1')).toBeNull();
    expect(saveIdentity(L)).not.toBe('another save|00000000');
  });

  it('a failed fit never replaces an adopted one, even when forced', () => {
    clear();
    recordCalibration({ model: { v: 'good' }, record: record({ passed: true }) }, { fitMs: 1 });
    expect(recordCalibration({ model: { v: 'bad' }, record: record({ passed: false }) }, { fitMs: 1, force: true })).toBe(0);
    expect(adoptedCalibration<{ v: string }>(L, 'test', 'thing', 'm-1')!.model.v).toBe('good');
  });

  it('a failed newer fit is recorded with its reason and the earlier adopted fit stays in force', () => {
    clear();
    recordCalibration({ model: { v: 2024 }, record: record({ passed: true, season: 2024 }) }, { fitMs: 1 });
    recordCalibration({ model: { v: 2025 }, record: record({ passed: false, season: 2025 }) }, { fitMs: 1 });
    expect(adoptedCalibration<{ v: number }>(L, 'test', 'thing', 'm-1')!.model.v).toBe(2024);
    expect(latestCalibrationAttempt(L, 'test', 'thing', 'm-1')!.reason).toMatch(/Not adopted/);
  });

  it('never serves a fit through a season the league has not completed', () => {
    clear();
    recordCalibration({ model: {}, record: record({ passed: true, season: 2030 }) }, { fitMs: 1 });
    expect(adoptedCalibration(L, 'test', 'thing', 'm-1', { throughMax: 2025 })).toBeNull();
  });

  it('a measurement keyed by game date serves the latest one', () => {
    clear();
    recordCalibration({ model: { d: 'may' }, record: record({ passed: true, season: null, date: '2026-05-16' }) }, { fitMs: 1 });
    recordCalibration({ model: { d: 'june' }, record: record({ passed: true, season: null, date: '2026-06-02' }) }, { fitMs: 1 });
    expect(adoptedCalibration<{ d: string }>(L, 'test', 'thing', 'm-1')!.model.d).toBe('june');
  });

  it('a reverted save serves its latest measurement at or before its game date, compared as dates', () => {
    clear();
    const at = (date: string, passed = true) => recordCalibration({ model: { d: date }, record: record({ passed, season: null, date }) }, { fitMs: 1 });
    at('2026-5-20');
    at('2026-6-10');
    // the save reverted to 2026-5-20 (OOTP writes dates unpadded): the June measurement is later and never served; May's is
    expect(adoptedCalibration<{ d: string }>(L, 'test', 'thing', 'm-1', { gameDateMax: '2026-5-20' })!.model.d).toBe('2026-5-20');
    // a date between them, never measured: still May's, not the starting values
    expect(adoptedCalibration<{ d: string }>(L, 'test', 'thing', 'm-1', { gameDateMax: '2026-6-9' })!.model.d).toBe('2026-5-20');
    // unpadded dates compare as dates: 2026-6-9 is before 2026-6-10
    at('2026-6-9');
    expect(adoptedCalibration<{ d: string }>(L, 'test', 'thing', 'm-1', { gameDateMax: '2026-6-10' })!.model.d).toBe('2026-6-10');
    // before any measurement, or an unreadable date today: nothing dated is served
    expect(adoptedCalibration(L, 'test', 'thing', 'm-1', { gameDateMax: '2026-4-1' })).toBeNull();
    expect(adoptedCalibration(L, 'test', 'thing', 'm-1', { gameDateMax: 'not established' })).toBeNull();
    // the last attempt shown is never a later export's
    at('2026-7-1', false);
    expect(latestCalibrationAttempt(L, 'test', 'thing', 'm-1', { gameDateMax: '2026-6-10' })!.adopted).toBe(true);
  });

  it('recording refits computed elsewhere keeps the outcomes and never throws', () => {
    clear();
    const pending: PendingCalibration[] = [
      { run: { model: {}, record: record({ passed: true }) }, ms: 3, force: false, outcome: { leagueId: L, subsystem: 'test', component: 'thing', method: 'm-1', basis: '2025', refit: true, adopted: true, reason: 'ok', ms: 3 } },
      { run: null, ms: null, force: false, outcome: { leagueId: L, subsystem: 'test', component: 'other', method: 'm-1', basis: null, refit: false, adopted: null, reason: 'nothing to fit', ms: null } },
    ];
    const out = recordCalibrationRefits(pending);
    expect(out.map((o) => o.reason)).toEqual(['ok', 'nothing to fit']);
  });
});

describe('the roster review reads the yardsticks in force', () => {
  it('with nothing stored, every group is the starting values, and the line says so', () => {
    clear();
    clearRosterReviewCalibrationCache();
    const y = rosterReviewCalibration(L);
    expect(y.groups.every((g) => g.source === 'starting')).toBe(true);
    expect(y.line).toMatch(/^Using starting yardsticks/);
    expect(y.standards.source).toBe('starting');
    expect(y.review.aging).toBeNull();
  });

  it('an adopted standards measurement is served; a failed one never moves a floor', () => {
    clear();
    clearRosterReviewCalibrationCache();
    const served = { ...STARTING_STANDARDS, source: 'save' as const, roles: { ...STARTING_STANDARDS.roles, pos3: { typical: 60, bat: 70 } } };
    const rec = (passed: boolean, date: string) => ({ ...record({ passed, season: null, date, component: 'standards', method: 'standards-1' }), subsystem: 'mlb_operations' });
    // a failed measurement: the starting floor stays
    recordCalibration({ model: { served, roles: {} }, record: rec(false, '2000-01-01') }, { fitMs: 1 });
    expect(rosterReviewCalibration(L).standards.hitter(3)!.floor).toBe(57);
    // an adopted one, from an export no later than today's: its floor is served
    recordCalibration({ model: { served, roles: {} }, record: rec(true, '2000-01-02') }, { fitMs: 1 });
    clearRosterReviewCalibrationCache();
    const y = rosterReviewCalibration(L);
    expect(y.standards.hitter(3)!.typical).toBe(60);
    expect(y.groups.find((g) => g.key === 'standards')!.source).toBe('save');
    expect(y.line).toBe("Some yardsticks are this league's own; others are starting values");
    clear();
    clearRosterReviewCalibrationCache();
  });
});
