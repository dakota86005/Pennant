import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { developmentTrendByPlayer, historyDb, playerRatingHistory, scaleFilter, snapshotScales, stampSnapshotMode, takeSnapshot } from '../server/history.js';
import { currentHistoryKey } from '../server/historyIdentity.js';
import { loadScoutedObservations, ratingScale } from '../server/scoutedEvidence.js';
import { setExportRatingMode } from './ratingModeFixture';

/*
 * A change of OOTP's rating display scale is never development (B-90, deep hunt SRVDEV-04; the owner's decision of 2026-10-28: stamp
 * the scale on each snapshot from now on; older snapshots read as scale unknown, never guessed). Snapshots keep OOTP's native grades;
 * read with today's scale, the same scouting opinion shown as 5 of 10 and then 50 of 80 was a +45 jump.
 */

const SAVE = (): string => currentHistoryKey();
const PLAYER = 931_001;
const DATES = ['2029-4-1', '2029-5-1', '2029-6-1'];
const SCOUTED = { mode: 'scouted' as const, additionalScouted: null, source: 'export_settings' as const, reason: null };

function clear(): void {
  historyDb.prepare('DELETE FROM save_rating_snapshots WHERE save_key = ? AND player_id = ?').run(SAVE(), PLAYER);
  historyDb.prepare(`DELETE FROM save_rating_snapshot_modes WHERE save_key = ? AND game_date IN (${DATES.map(() => '?').join(', ')})`).run(SAVE(), ...DATES);
}

/** The same player, the same scouting opinion, on the given native grade (his ceiling a notch above). */
function snapshot(date: string, grade: number, ceiling: number): void {
  historyDb.prepare(
    `INSERT INTO save_rating_snapshots (save_key, game_date, player_id, name, team_id, org_id, level, position, age, cur, pot, con, gap, pow, eye, avk, conP, gapP, powP, eyeP, avkP)
     VALUES (?, ?, ?, 'Scale Case', 931900, 931900, 2, 6, 22, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(SAVE(), date, PLAYER, grade, ceiling, grade, grade, grade, grade, grade, ceiling, ceiling, ceiling, ceiling, ceiling);
}

beforeEach(() => {
  clear();
  setExportRatingMode('scouted');
});
afterAll(() => {
  clear();
  setExportRatingMode(null);
});

describe('each rating snapshot is stamped with its display scale', () => {
  it('the snapshot an import takes carries today\'s scale, and its stamp keeps it', () => {
    const taken = takeSnapshot();
    expect(taken?.scaleMax).toBe(ratingScale().max);
    stampSnapshotMode(taken!.gameDate, SCOUTED, null, taken!.scaleMax);
    expect(snapshotScales().get(taken!.gameDate)).toBe(ratingScale().max);
    // A later stamp of the same date that names no scale doesn't erase it
    stampSnapshotMode(taken!.gameDate, SCOUTED, null);
    expect(snapshotScales().get(taken!.gameDate)).toBe(ratingScale().max);
    historyDb.prepare('DELETE FROM save_rating_snapshots WHERE save_key = ? AND game_date = ?').run(SAVE(), taken!.gameDate);
    historyDb.prepare('DELETE FROM save_rating_snapshot_modes WHERE save_key = ? AND game_date = ?').run(SAVE(), taken!.gameDate);
  });
});

describe('a change of display scale is a switch, never development', () => {
  it('stamped on 1-10, then 20-80: the 1-10 snapshot is left out, and the change is said', () => {
    expect(ratingScale().max).toBe(80);
    snapshot(DATES[0], 5, 6);
    snapshot(DATES[1], 50, 55);
    stampSnapshotMode(DATES[0], SCOUTED, null, 10);
    stampSnapshotMode(DATES[1], SCOUTED, null, 80);
    expect(scaleFilter().excluded.has(DATES[0])).toBe(true);
    const observed = loadScoutedObservations([PLAYER]).get(PLAYER) ?? [];
    expect(observed.map((o) => o.gameDate)).toEqual(['2029-05-01']);
    expect(Math.abs(developmentTrendByPlayer().get(PLAYER)?.currentDelta ?? 0)).toBeLessThan(1);
    const history = playerRatingHistory(PLAYER);
    expect(history.rows.map((r) => r.game_date)).toEqual([DATES[1]]);
    expect(history.modeSwitches.join(' ')).toMatch(/rating scale changed between April 1, 2029 and May 1, 2029, from 1–10 to 20–80/);
  });

  it('an unstamped snapshot whose own grades fall off today\'s scale is left out, its scale never guessed', () => {
    snapshot(DATES[0], 5, 6); // taken before the stamp: below 20, so not on today's 20-80
    snapshot(DATES[1], 50, 55);
    stampSnapshotMode(DATES[1], SCOUTED, null, 80);
    expect(scaleFilter().excluded.has(DATES[0])).toBe(true);
    for (const o of loadScoutedObservations([PLAYER]).get(PLAYER) ?? []) if (o.ability.current !== null) expect(o.ability.current).toBeGreaterThanOrEqual(20);
    expect(scaleFilter().texts.join(' ')).toMatch(/April 1, 2029 was taken on another rating scale than today's 20–80/);
  });

  it('unstamped snapshots consistent with today\'s scale stay in, as an unrecorded kind does (control)', () => {
    snapshot(DATES[0], 45, 55);
    snapshot(DATES[1], 50, 55);
    snapshot(DATES[2], 52, 56);
    stampSnapshotMode(DATES[2], SCOUTED, null, 80);
    expect(scaleFilter().excluded.size).toBe(0);
    expect((loadScoutedObservations([PLAYER]).get(PLAYER) ?? []).length).toBe(3);
  });
});
