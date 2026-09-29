import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { historyDb } from '../server/history.js';
import { forgetHistoryKey, rollbackName } from '../server/historyIdentity.js';
import { followNow, followingView, searchNow, unfollowNow, wireView } from '../server/aroundTheLeague.js';
import { forgetMemoryCaches, follows } from '../server/frontOfficeMemory.js';
import { frontOfficeSummaryNow, resetAttention } from '../server/frontOfficeAttention.js';
import { resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { forgetWire } from '../server/leagueWire.js';
import { importedAt } from '../server/playerStateRoutes.js';
import { forgetSearchIndex } from '../server/search.js';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * Following (BEHAVIOR_CASES.md "Pennant for Mac", `following.test.ts`, case 20; D-058): the watchlist copied and left in
 * place, follows kept per save, rivals suggested and never followed by themselves, and nothing but order changed.
 */

describe('Following (case 20)', () => {
  let save: BuiltSave;
  const realStamp = importedAt.value;
  const name = () => rollbackName() ?? 'unknown';

  beforeAll(() => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
  });
  afterAll(() => {
    importedAt.value = realStamp;
  });
  beforeEach(() => {
    for (const t of ['following', 'following_watchlist_copies', 'watchlist']) historyDb.exec(`DELETE FROM ${t}`);
    forgetHistoryKey();
    forgetMemoryCaches();
    forgetWire();
    forgetSearchIndex();
    resetFrontOfficeCache();
    resetAttention();
    importedAt.value = '2040-05-06T10:00:00.000Z';
  });

  const watch = (playerId: number, who: string, note: string) => historyDb.prepare(
    `INSERT INTO watchlist (save_name, player_id, name, note, added_at, updated_at) VALUES (?, ?, ?, ?, '2040-01-01T00:00:00.000Z', '2040-01-01T00:00:00.000Z')`,
  ).run(name(), playerId, who, note);
  const nameOf = (id: number) => (db.prepare(`SELECT first_name || ' ' || last_name AS n FROM players WHERE player_id = ?`).get(id) as { n: string }).n;

  it('copies the watchlist in with its notes, leaves the watchlist as it was, and never copies back a player unfollowed', async () => {
    watch(save.regular, nameOf(save.regular), 'Keep an eye on his walks');
    watch(424_242, 'Nobody Here', 'Another save\'s man');
    const view = await followingView();
    expect(view.players.map((p) => [p.id, p.note])).toEqual([[save.regular, 'Keep an eye on his walks']]);
    expect(view.players[0].since.display).toBe('Copied from your watchlist');
    expect(view.watchlist!.display).toBe('1 player from your watchlist, with your notes');
    // The watchlist itself is untouched, for the older app
    expect((historyDb.prepare(`SELECT COUNT(*) AS n FROM watchlist`).get() as { n: number }).n).toBe(2);
    await unfollowNow({ kind: 'player', id: String(save.regular) });
    forgetMemoryCaches();
    const again = await followingView();
    expect(again.players).toEqual([]);
  });

  it('suggests the division\'s other clubs with why, and follows none of them by itself', async () => {
    const view = await followingView();
    expect(view.clubs).toEqual([]);
    expect(view.suggestions.length).toBeGreaterThan(0);
    for (const s of view.suggestions) {
      expect(s.id).not.toBe(save.org);
      expect(s.why.display).toMatch(/^In your division/);
    }
    expect(follows()).toEqual([]);
  });

  it('answers a follow and an unfollow with the request that undoes it', async () => {
    const club = save.clubs.find((c) => c !== save.org)!;
    const followed = await followNow({ kind: 'club', id: club, note: 'Rival' });
    expect(followed.following).toBe(true);
    expect(followed.undo).toEqual({ action: 'unfollow', request: { kind: 'club', id: club } });
    const dropped = await unfollowNow({ kind: 'club', id: String(club) });
    expect(dropped.undo).toEqual({ action: 'follow', request: { kind: 'club', id: club, note: 'Rival' } });
    await expect(followNow({ kind: 'club', id: 99_999 })).rejects.toThrow('Pennant doesn\'t know that club in this save.');
  });

  it('changes no figure, place or severity anywhere: only the wire\'s and the search\'s order', async () => {
    const before = await frontOfficeSummaryNow(save.org);
    const wireBefore = wireView(String(save.org), { since: 'season' });
    const club = save.clubs.find((c) => c !== save.org)!;
    await followNow({ kind: 'club', id: club });
    await followNow({ kind: 'player', id: save.regular });
    const after = await frontOfficeSummaryNow(save.org);
    const strip = (s: typeof before) => JSON.stringify({ ...s, wire: null, deskStamp: null });
    expect(strip(after)).toBe(strip(before));
    const wireAfter = wireView(String(save.org), { since: 'season' });
    expect(wireAfter.entries.map((e) => [e.id, e.headline.text]).sort()).toEqual(wireBefore.entries.map((e) => [e.id, e.headline.text]).sort());
    const first = wireView(String(save.org), { since: 'season', followed: 'first' });
    const followedCount = first.entries.filter((e) => e.followed).length;
    expect(first.entries.slice(0, followedCount).every((e) => e.followed)).toBe(true);
    const found = searchNow('club');
    expect(found.groups.find((g) => g.kind === 'club')!.results[0]).toMatchObject({ id: String(club), followed: true });
  });

  it('keeps follows per save: another save\'s follows are never this save\'s (D-064)', async () => {
    const club = save.clubs.find((c) => c !== save.org)!;
    await followNow({ kind: 'club', id: club });
    historyDb.prepare(`UPDATE following SET save_key = 'save-another-folder'`).run();
    forgetMemoryCaches();
    expect(follows()).toEqual([]);
    expect((await followingView()).clubs).toEqual([]);
  });
});
