import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { historyDb, noteSnapshotsWritten } from '../server/history.js';
import { currentHistoryKey } from '../server/historyIdentity.js';
import { importedAt } from '../server/playerStateRoutes.js';
import { MAX_OPENED, limitOpenedForTests, playerDossierJsonNow, playerDossierNow, playerViewStats, readyMainThread, resetPlayerViews, warmPlayerDossiers } from '../server/playerViewService.js';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * The player window's cache (N11; BEHAVIOR_CASES.md "Player card"): our club's players are read ahead after an import,
 * off the request path; another club's player on his first open, then kept; nothing outlives the import, the settings,
 * the live log or the save's rating snapshots it was built from (the key is the Front Office's, with the snapshot writes).
 */

let save: BuiltSave;
let ours: number[];
let theirs: number;

beforeAll(() => {
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 40, playedShare: 0.5, clubs: 4, seed: 5, minors: true });
  resetFrontOfficeCache();
  resetPlayerViews();
  ours = (db.prepare('SELECT player_id FROM players WHERE organization_id = ?').all(save.org) as Array<{ player_id: number }>).map((r) => r.player_id);
  theirs = (db.prepare('SELECT player_id FROM players WHERE organization_id <> ? AND organization_id > 0 LIMIT 1').get(save.org) as { player_id: number }).player_id;
}, 120_000);

describe('our club\'s players are ready when the GM opens them', () => {
  it('reads every player the organization holds ahead, and serves them from the cache', async () => {
    await warmPlayerDossiers(save.org);
    const stats = playerViewStats();
    expect(stats.warmBuilds).toBe(1);
    expect(stats.players).toBe(ours.length);
    const before = playerViewStats().hits;
    const v = await playerDossierNow(String(ours[0]), String(save.org));
    expect(v.playerId).toBe(ours[0]);
    expect(playerViewStats().hits).toBe(before + 1);
    expect(playerViewStats().opened).toBe(0);
  });

  it('reads another club\'s player on his first open, then keeps him', async () => {
    await playerDossierNow(String(theirs), String(save.org));
    expect(playerViewStats().opened).toBe(1);
    await playerDossierNow(String(theirs), String(save.org));
    expect(playerViewStats().opened).toBe(1);
  });

  it('never serves a dossier past a new rating snapshot of the save or a new import', async () => {
    const first = await playerDossierNow(String(ours[0]), String(save.org));
    expect(first.ratings.history.points.length).toBe(0);
    // A rating snapshot written after the views warmed (the import's own, by its post-import hook) moves the key
    historyDb.prepare('INSERT INTO save_rating_snapshots (save_key, game_date, player_id, name, org_id, cur, pot) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(currentHistoryKey(), '2040-6-1', ours[0], 'P', save.org, 50, 60);
    noteSnapshotsWritten();
    const previous = importedAt.value;
    try {
      const second = await playerDossierNow(String(ours[0]), String(save.org));
      expect(second).not.toBe(first);
      expect(second.ratings.history.points.map((p) => p.now)).toEqual([50]);
      // And a new import
      importedAt.value = '2040-06-02T12:00:00.000Z';
      const third = await playerDossierNow(String(ours[0]), String(save.org));
      expect(third.importStamp).toBe('2040-06-02T12:00:00.000Z');
    } finally {
      importedAt.value = previous;
      historyDb.prepare('DELETE FROM save_rating_snapshots WHERE save_key = ? AND player_id = ? AND game_date = ?').run(currentHistoryKey(), ours[0], '2040-6-1');
    }
  });

  it('says in a sentence that it doesn\'t know a player the save doesn\'t have', async () => {
    await expect(playerDossierNow('99999999', String(save.org))).rejects.toMatchObject({ status: 404, message: 'Pennant doesn\'t know that player in this save.' });
    await expect(playerDossierNow('nobody', String(save.org))).rejects.toMatchObject({ status: 404 });
  });
});

describe('the kept dossiers are bytes, a bounded set, and the first open is ready (review M5)', () => {
  it('keeps a dossier as the JSON the route sends, the same bytes each time, readable as the dossier', async () => {
    const a = await playerDossierJsonNow(String(ours[1]), String(save.org));
    const b = await playerDossierJsonNow(String(ours[1]), String(save.org));
    expect(Buffer.isBuffer(a)).toBe(true);
    expect(b).toBe(a);
    expect(JSON.parse(a.toString('utf8')).playerId).toBe(ours[1]);
    expect((await playerDossierNow(String(ours[1]), String(save.org))).playerId).toBe(ours[1]);
  });

  it('keeps at most its limit of other clubs\' players, the least recently opened let go first, and all of ours', async () => {
    expect(MAX_OPENED).toBeLessThanOrEqual(150);
    // The small league has fewer other players than the limit: a limit of 20 shows it at work
    const LIMIT = 20;
    limitOpenedForTests(LIMIT);
    resetPlayerViews();
    await warmPlayerDossiers(save.org);
    const others = (db.prepare('SELECT player_id FROM players WHERE organization_id <> ? AND organization_id > 0 ORDER BY player_id LIMIT ?').all(save.org, LIMIT + 3) as Array<{ player_id: number }>).map((r) => r.player_id);
    expect(others.length).toBe(LIMIT + 3);
    await playerDossierJsonNow(String(others[0]), String(save.org));
    for (const id of others.slice(1)) {
      await playerDossierJsonNow(String(id), String(save.org));
      // The first one opened again each time: recently used, so never the one let go
      await playerDossierJsonNow(String(others[0]), String(save.org));
    }
    try {
      expect(playerViewStats().players).toBe(ours.length + LIMIT);
      const opened = playerViewStats().opened;
      await playerDossierJsonNow(String(others[0]), String(save.org));
      expect(playerViewStats().opened).toBe(opened);
      await playerDossierJsonNow(String(others[1]), String(save.org));
      expect(playerViewStats().opened).toBe(opened + 1);
    } finally {
      limitOpenedForTests(null);
    }
  }, 120_000);

  it('makes the server\'s thread ready for a first open once, when idle, keeping nothing', async () => {
    resetPlayerViews();
    readyMainThread(save.org);
    readyMainThread(save.org);
    await new Promise((resolve) => setImmediate(resolve));
    expect(playerViewStats().readyMs).toBeGreaterThan(0);
    expect(playerViewStats().players).toBe(0);
  });
});
