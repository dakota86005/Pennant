import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { historyDb, noteSnapshotsWritten } from '../server/history.js';
import { currentHistoryKey } from '../server/historyIdentity.js';
import { importedAt } from '../server/playerStateRoutes.js';
import { playerDossierNow, playerViewStats, resetPlayerViews, warmPlayerDossiers } from '../server/playerViewService.js';
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
