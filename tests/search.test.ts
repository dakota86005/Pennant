import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { historyDb } from '../server/history.js';
import { forgetHistoryKey } from '../server/historyIdentity.js';
import { followNow, searchNow } from '../server/aroundTheLeague.js';
import { forgetMemoryCaches } from '../server/frontOfficeMemory.js';
import { importedAt } from '../server/playerStateRoutes.js';
import { fold, forgetSearchIndex, searchIndexBuilds } from '../server/search.js';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * Search (BEHAVIOR_CASES.md "Pennant for Mac", `search.test.ts`): players, clubs and views by every word typed, each with
 * where it opens, followed first then a stated order, from an index built once per import.
 */

describe('search', () => {
  let save: BuiltSave;
  const realStamp = importedAt.value;

  beforeAll(() => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
  });
  afterAll(() => {
    importedAt.value = realStamp;
  });
  beforeEach(() => {
    historyDb.exec(`DELETE FROM following`);
    forgetHistoryKey();
    forgetMemoryCaches();
    forgetSearchIndex();
    importedAt.value = '2040-05-06T10:00:00.000Z';
  });

  it('finds players, clubs and views by every word typed, each opening where it belongs', () => {
    const player = db.prepare(`SELECT player_id, first_name, last_name FROM players WHERE player_id = ?`).get(save.regular) as { player_id: number; first_name: string; last_name: string };
    const found = searchNow(`${player.first_name} ${player.last_name}`);
    const players = found.groups.find((g) => g.kind === 'player')!;
    // His organization's club rides along, the nearest view the Mac app opens for a player until player windows (N7 B)
    expect(players.results[0]).toMatchObject({ id: String(save.regular), open: { kind: 'player', playerId: save.regular, teamId: save.org } });
    const views = searchNow('depth chart').groups.find((g) => g.kind === 'view')!;
    expect(views.results[0]).toMatchObject({ title: 'Depth Chart', line: 'Major League Ops', open: { kind: 'view', department: 'majorLeague', view: 'depthChart' } });
    const clubs = searchNow('club 2').groups.find((g) => g.kind === 'club')!;
    expect(clubs.results[0]).toMatchObject({ open: { kind: 'club', teamId: save.clubs[1] } });
  });

  it('matches plain words, whatever their case or accents', () => {
    expect(fold('José RAMÍREZ')).toBe('jose ramirez');
    db.prepare(`UPDATE players SET first_name = 'José', last_name = 'Ramírez' WHERE player_id = ?`).run(save.regular);
    forgetSearchIndex();
    expect(searchNow('jose ram').groups.find((g) => g.kind === 'player')!.results[0].id).toBe(String(save.regular));
  });

  it('finds a name written with punctuation without it, and needs a word of the name for each word typed (L7)', () => {
    const [oneil, jojo] = save.hitters.slice(5, 7);
    const rename = db.prepare(`UPDATE players SET first_name = ?, last_name = ? WHERE player_id = ?`);
    rename.run('Shay', 'O\'Neil', oneil);
    rename.run('Jo', 'Jo Reyes', jojo);
    forgetSearchIndex();
    const ids = (q: string) => (searchNow(q).groups.find((g) => g.kind === 'player')?.results ?? []).map((r) => r.id);
    expect(ids('oneil')).toContain(String(oneil));
    expect(ids('shay oneil')).toContain(String(oneil));
    expect(ids('o\'neil')).toContain(String(oneil));
    // Each word typed takes a word of its own: "jo jo" finds Jo Jo Reyes, and one "jo" twice finds no one with one "Jo"
    expect(ids('jo jo')).toContain(String(jojo));
    expect(ids('reyes reyes')).not.toContain(String(jojo));
    expect(ids('oneil o')).not.toContain(String(oneil));
  });

  it('says what to type when nothing is typed, and that nothing matches when nothing does', () => {
    expect(searchNow('').empty!.display).toBe('Type a player, a club or a view');
    expect(searchNow('zzzzqx').empty!.display).toBe('No players, clubs or views match');
  });

  it('puts what the GM follows first, then names that start with what was typed, and says so', async () => {
    const all = searchNow('club').groups.find((g) => g.kind === 'club')!;
    const last = all.results[all.results.length - 1];
    await followNow({ kind: 'club', id: Number(last.id) });
    const again = searchNow('club');
    expect(again.groups.find((g) => g.kind === 'club')!.results[0]).toMatchObject({ id: last.id, followed: true });
    expect(again.order.hint).toBe('Followed first, then names starting with what you typed, then ours');
  });

  it('reads an index built once per import, never the league on every keystroke', () => {
    searchNow('c');
    const built = searchIndexBuilds();
    for (const q of ['cl', 'clu', 'club', 'club 1']) searchNow(q);
    expect(searchIndexBuilds()).toBe(built);
    importedAt.value = '2040-05-07T10:00:00.000Z';
    searchNow('club');
    expect(searchIndexBuilds()).toBe(built + 1);
  });
});
