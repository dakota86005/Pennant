import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { developmentTrendByPlayer, historyDb, modeFilter, modeSwitches, snapshotModes, stampSnapshotMode } from '../server/history.js';
import { takeImportSnapshots } from '../server/importSnapshots.js';
import { loadScoutedObservations } from '../server/scoutedEvidence.js';
import type { RatingMode } from '../server/ratingMode.js';
import { setExportRatingMode } from './ratingModeFixture';
import request from './request';

/**
 * A switch in the kind of ratings is never development (D-061, BEHAVIOR_CASES "The import and the export's ratings"):
 * each rating snapshot is stamped with the kind its export carried, and a snapshot in another known kind than today's
 * export is left out of development and said, never compared.
 */
const SAVE = 'unknown';
const PLAYER = 930_001;
const ORG = 930_900;

const series: Array<{ date: string; cur: number; mode: RatingMode | null }> = [
  { date: '2031-4-1', cur: 40, mode: 'real' },
  { date: '2031-5-1', cur: 41, mode: 'real' },
  { date: '2031-6-1', cur: 50, mode: 'scouted' },
  { date: '2031-7-1', cur: 50.5, mode: null }, // taken before the kind was recorded: never evidence of a switch
  { date: '2031-8-20', cur: 51, mode: 'scouted' },
];

function clear(): void {
  historyDb.prepare('DELETE FROM rating_snapshots WHERE save_name = ? AND player_id = ?').run(SAVE, PLAYER);
  historyDb.prepare(`DELETE FROM rating_snapshot_modes WHERE save_name = ? AND game_date LIKE '2031-%'`).run(SAVE);
}

describe('rating history across a switch in the kind of ratings', () => {
  beforeAll(() => {
    clear();
    const insert = historyDb.prepare(
      `INSERT INTO rating_snapshots (save_name, game_date, player_id, name, team_id, org_id, level, position, age, cur, pot, con, gap, pow, eye, avk)
       VALUES (?, ?, ?, 'Switch Case', ?, ?, 1, 6, 25, ?, 60, ?, ?, ?, ?, ?)`
    );
    for (const s of series) {
      insert.run(SAVE, s.date, PLAYER, ORG, ORG, s.cur, s.cur, s.cur, s.cur, s.cur, s.cur);
      if (s.mode) stampSnapshotMode(s.date, { mode: s.mode, additionalScouted: null, source: 'export_settings', reason: null }, null);
    }
  });
  afterAll(() => {
    clear();
    setExportRatingMode(null);
  });

  it('reads a jump across a switch as a switch, never as development, and says so', () => {
    setExportRatingMode('scouted');
    const trend = developmentTrendByPlayer().get(PLAYER)!;
    // Across the three snapshots in today's kind (and the unrecorded one), +1: flat, not the +11 the switch would read
    expect(trend.firstDate).toBe('2031-6-1');
    expect(trend.snapshotCount).toBe(3);
    expect(trend.currentDelta).toBe(1);
    expect(trend.status).toBe('flat');
    expect(trend.reasons.join(' ')).toMatch(/kind of ratings changed .* from true ratings to your scouts' view/i);
  });

  it('never treats an unrecorded or unknown kind as a switch', () => {
    // Today's kind unknown: nothing is left out (an unknown kind is not evidence of a switch)
    setExportRatingMode('unknown');
    expect(modeFilter().excluded.size).toBe(0);
    setExportRatingMode(null);
    expect(modeFilter().excluded.size).toBe(0);
    // The unrecorded snapshot sits between two in today's kind and stays
    setExportRatingMode('scouted');
    expect(modeFilter().excluded.has('2031-7-1')).toBe(false);
    expect(modeSwitches().filter((s) => s.before.startsWith('2031-'))).toEqual([
      expect.objectContaining({ before: '2031-5-1', after: '2031-6-1', fromMode: 'real', toMode: 'scouted' }),
    ]);
  });

  it('leaves the other kind out of observed history too', () => {
    setExportRatingMode('scouted');
    const dates = (loadScoutedObservations([PLAYER]).get(PLAYER) ?? []).map((o) => o.gameDate);
    expect(dates).toEqual(['2031-06-01', '2031-07-01', '2031-08-20']);
    const modes = (loadScoutedObservations([PLAYER]).get(PLAYER) ?? []).map((o) => o.ratingMode);
    expect(modes).toEqual(['scouted', null, 'scouted']);
  });

  it('shows the switch, and no changes, between two snapshots in different kinds', async () => {
    const body = await request(`/api/development/${ORG}?from=2031-5-1&to=2031-6-1`);
    expect(body.changes).toBeNull();
    expect(body.ratingModeSwitch).toMatchObject({ before: '2031-5-1', after: '2031-6-1', fromMode: 'real', toMode: 'scouted' });
  });

  it('stamps the snapshot an import takes with the kind its export carried', async () => {
    const outcome = await takeImportSnapshots({
      importFinishedAt: null, importStartedAt: '2040-07-01T12:00:00.000Z',
      ratingMode: { mode: 'osa', additionalScouted: null, source: 'export_settings', reason: null },
    }, async () => {});
    expect(outcome.ratings).not.toBeNull();
    expect(snapshotModes().get(outcome.ratings!.gameDate)).toBe('osa');
    historyDb.prepare('DELETE FROM rating_snapshot_modes WHERE save_name = ? AND game_date = ?').run(SAVE, outcome.ratings!.gameDate);
  });
});
