import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { historyDb } from '../server/history.js';
import { forgetHistoryKey } from '../server/historyIdentity.js';
import { forgetMemoryCaches, recordStandingsSnapshot, type StandingsRow } from '../server/frontOfficeMemory.js';
import { forgetWire, leagueClubs, logFacts, wireBuilds, wireFacts, WIRE_STREAK_POLICY, type WireFact } from '../server/leagueWire.js';
import { captureRosterStateSnapshot } from '../server/rosterStateHistory.js';
import { importedAt } from '../server/playerStateRoutes.js';
import { KIND_ORDER, gapWords, wireEntry, wireOrder, wireWords, type Followed } from '../server/presentation/frontOffice/wire.js';
import { buildSave, dropColumn, dropTable, insert, type BuiltSave } from './syntheticSave';

/**
 * The league wire (BEHAVIOR_CASES.md "Pennant for Mac", `leagueWire.test.ts`, cases 17 and 18; D-059): the log's own
 * words, a roster difference stated as a change, a stated order with no hidden score, and a missing source named.
 */

const TRANSACTIONS = /\b(optioned|recalled|designated|released|traded|claimed|activated|purchased)\b/i;
const none: Followed = { clubs: new Set(), players: new Set() };
const ctx = { importStamp: 'i1', gameDate: '2040-5-6' };

const fact = (over: Partial<WireFact>): WireFact => ({
  id: 'log:1', source: 'log', kind: 'move', date: '2040-5-5', day: '2040-05-05', clubs: [{ teamId: 1, name: 'Club 1 N', abbr: 'C1' }],
  players: [{ playerId: 7, name: 'Sam Arm' }], ownWords: 'Optioned RHP Sam Arm to Triple A Reno.',
  detail: { kind: 'log', logKind: 'optioned', supported: true, logIds: [1] }, ...over,
});

describe('a wire entry says what its source says (case 17)', () => {
  it('keeps the transaction log\'s own sentence, word for word', () => {
    const entry = wireEntry(fact({}), none, ctx);
    expect(entry.headline.text).toBe('Optioned RHP Sam Arm to Triple A Reno.');
    expect(entry.headline.hint).toBe('In the transaction log\'s own words');
    expect(entry.headline.basis.because).toContainEqual({ label: 'From', value: 'OOTP\'s transaction log' });
  });

  it('shows wording Pennant does not read as the log wrote it, and says so', () => {
    const entry = wireEntry(fact({ ownWords: 'Signed a minor league deal with the Tides.', detail: { kind: 'log', logKind: 'unsupported', supported: false, logIds: [2] } }), none, ctx);
    expect(entry.headline.text).toBe('Signed a minor league deal with the Tides.');
    expect(entry.headline.basis.unknown).toContain('Pennant doesn\'t read this wording, so it is shown as the log wrote it.');
  });

  it('states a roster difference between two exports as a change and never names a transaction', () => {
    const changes: WireFact['detail'][] = [
      { kind: 'snapshot', change: { what: 'injuredList', on: true } },
      { kind: 'snapshot', change: { what: 'fortyMan', on: false } },
      { kind: 'snapshot', change: { what: 'activeRoster', on: true, club: { teamId: 1, name: 'Club 1 N', abbr: 'C1' } } },
      { kind: 'snapshot', change: { what: 'organization', from: { teamId: 1, name: 'Club 1 N', abbr: 'C1' }, to: { teamId: 2, name: 'Club 2 N', abbr: 'C2' } } },
    ];
    const lines = changes.map((detail) => wireEntry(fact({ source: 'snapshots', ownWords: null, detail }), none, ctx).headline);
    expect(lines.map((l) => l.text)).toEqual([
      'Sam Arm: now on the injured list', 'Sam Arm: no longer on the 40-man roster', 'Sam Arm: now on the Club 1 N active roster', 'Sam Arm: now with the Club 2 N',
    ]);
    for (const l of lines) {
      expect(l.text).not.toMatch(TRANSACTIONS);
      expect(l.hint).toBe('A change between two exports, not a transaction');
      expect(l.basis.unknown.join(' ')).toMatch(/not which move changed it/);
    }
  });
});

describe('the wire\'s order is stated and has no hidden score (case 18)', () => {
  const facts = [
    fact({ id: 'awards:1', source: 'awards', kind: 'award', ownWords: null, day: '2040-05-05', clubs: [{ teamId: 3, name: 'Club 3 N', abbr: 'C3' }], detail: { kind: 'award', award: 'Player of the Week', league: null } }),
    fact({ id: 'log:2', day: '2040-05-04' }),
    fact({ id: 'trades:1', source: 'trades', kind: 'trade', ownWords: 'A trade', day: '2040-05-05', clubs: [{ teamId: 2, name: 'Club 2 N', abbr: 'C2' }], players: [] }),
    fact({ id: 'log:3', day: null, date: null }),
    fact({ id: 'log:4', day: '2040-05-05', clubs: [{ teamId: 4, name: 'Club 4 N', abbr: 'C4' }] }),
  ];

  it('orders by the newest day, then the kind in its stated order, then the source\'s own order; a day not known last', () => {
    expect(wireOrder(facts, none, false).map((f) => f.id)).toEqual(['trades:1', 'log:4', 'awards:1', 'log:2', 'log:3']);
    expect(KIND_ORDER).toEqual(['trade', 'move', 'injury', 'award', 'streak', 'standings']);
  });

  it('puts followed clubs first only when asked, and following changes no entry\'s words (case 20)', () => {
    const followed: Followed = { clubs: new Set([3]), players: new Set() };
    expect(wireOrder(facts, followed, true).map((f) => f.id)[0]).toBe('awards:1');
    expect(wireOrder(facts, followed, false).map((f) => f.id)).toEqual(wireOrder(facts, none, false).map((f) => f.id));
    const plain = facts.map((f) => wireEntry(f, none, ctx).headline.text);
    const withFollow = facts.map((f) => wireEntry(f, followed, ctx).headline.text);
    expect(withFollow).toEqual(plain);
    const q = { sinceDay: null, sinceRaw: null, sinceFrom: 'season' as const, club: null, kind: null, followedOnly: false, followedFirst: true, limit: 50 };
    const wire = wireWords(1, { facts, gaps: [], fromLog: true, gameDate: '2040-5-6', previousGameDate: null }, followed, q, ctx);
    expect(wire.order.line.display).toBe('Followed first, then newest');
    expect(wire.entries[0].followed).toBe(true);
    expect(wireWords(1, { facts, gaps: [], fromLog: true, gameDate: '2040-5-6', previousGameDate: null }, followed, { ...q, followedOnly: true }, ctx).entries.map((e) => e.id)).toEqual(['awards:1']);
  });
});

describe('the wire on the synthetic save: its sources, and the ones it lacks', () => {
  let save: BuiltSave;
  const realStamp = importedAt.value;

  beforeAll(() => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
  });
  afterAll(() => {
    importedAt.value = realStamp;
  });
  beforeEach(() => {
    forgetWire();
    forgetHistoryKey();
    forgetMemoryCaches();
    importedAt.value = '2040-05-06T10:00:00.000Z';
  });

  it('reads the trades, injuries, awards and streaks the export records, each in its own words or established names', () => {
    const w = wireFacts(importedAt.value, save.org);
    const kinds = new Set(w.facts.map((f) => f.kind));
    for (const k of ['trade', 'injury', 'award', 'streak'] as const) expect(kinds.has(k), k).toBe(true);
    expect(w.facts.find((f) => f.kind === 'award')!.detail).toMatchObject({ award: 'Player of the Week' });
    expect(w.facts.find((f) => f.kind === 'trade')!.ownWords).toMatch(/^The Club 2 traded /);
    // Gathered once per import: the second ask is the kept one
    const builds = wireBuilds();
    wireFacts(importedAt.value, save.org);
    expect(wireBuilds()).toBe(builds);
  });

  it('never reads the GM\'s inbox as league news: no staff note, no trade proposal, and news named as a gap (H1)', () => {
    // The synthetic save's messages hold a staff note on a trade target and another club's trade proposal
    expect(db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE recipient_id = 1`).get()).toEqual({ n: 2 });
    const w = wireFacts(importedAt.value, save.org);
    const words = w.facts.map((f) => f.ownWords ?? '').join(' | ');
    expect(words).not.toMatch(/Trade Proposal|could be the answer|Sweep a Three-Game Set/);
    expect(w.facts.some((f) => (f.source as string) === 'news' || (f.kind as string) === 'news')).toBe(false);
    expect(w.gaps).toContainEqual({ source: 'news', why: 'not_read', detail: null });
    const line = gapWords({ source: 'news', why: 'not_read', detail: null });
    expect(line.display).toBe('League news isn\'t on the wire: the export files it with your own mail, and Pennant can\'t tell the two apart.');
    expect(line.tone).toBe('unknown');
  });

  it('shows a streak only from its stated line: a hitting streak from exactly 15, an on-base streak from exactly 25, and only a streak whose meaning is established (L10)', () => {
    // Four regulars on major-league clubs with no streak yet
    const [h14, h15, ob24, ob25] = (db.prepare(`SELECT p.player_id FROM players p JOIN teams t ON t.team_id = p.team_id
      WHERE t.level = 1 AND COALESCE(p.retired, 0) = 0 AND p.player_id NOT IN (SELECT player_id FROM players_streak) ORDER BY p.player_id LIMIT 4`).all() as Array<{ player_id: number }>).map((r) => r.player_id);
    const add = (player: number, type: number, games: number) => db.prepare(`INSERT INTO players_streak (player_id, streak_id, value, started, has_ended) VALUES (?, ?, ?, '2040-4-1', 0)`).run(player, type, games);
    add(h14, 0, WIRE_STREAK_POLICY.hitting - 1);
    add(h15, 0, WIRE_STREAK_POLICY.hitting);
    add(ob24, 9, WIRE_STREAK_POLICY.onBase - 1);
    add(ob25, 9, WIRE_STREAK_POLICY.onBase);
    add(save.regular, 5, 40);
    expect([WIRE_STREAK_POLICY.hitting, WIRE_STREAK_POLICY.onBase]).toEqual([15, 25]);
    forgetWire();
    const streaks = wireFacts(importedAt.value, save.org).facts.filter((f) => f.kind === 'streak');
    const shown = new Set(streaks.map((f) => f.players[0].playerId));
    expect([h14, h15, ob24, ob25].map((p) => shown.has(p))).toEqual([false, true, false, true]);
    expect(streaks.find((f) => f.players[0].playerId === h15)!.detail).toMatchObject({ streak: 'hitting', games: 15, line: 15 });
    expect(streaks.find((f) => f.players[0].playerId === ob25)!.detail).toMatchObject({ streak: 'onBase', games: 25, line: 25 });
    // An unpinned streak type is never shown, however long
    expect(shown.has(save.regular)).toBe(false);
    db.prepare(`DELETE FROM players_streak WHERE player_id IN (?, ?, ?, ?, ?)`).run(h14, h15, ob24, ob25, save.regular);
    forgetWire();
  });

  it('names a table the export lacks as a gap, never an empty league', () => {
    dropTable('trade_history');
    const w = wireFacts(importedAt.value, save.org);
    expect(w.gaps).toContainEqual({ source: 'trades', why: 'not_in_export', detail: 'trade_history' });
    expect(w.facts.some((f) => f.kind === 'trade')).toBe(false);
    const words = wireWords(save.org, w, none, { sinceDay: null, sinceRaw: null, sinceFrom: 'season', club: null, kind: null, followedOnly: false, followedFirst: false, limit: 50 }, ctx);
    expect(words.gaps.map((g) => g.display)).toContain('The export has no trade record, so trades aren\'t on the wire.');
  });

  it('says a table it could not read couldn\'t be read, never that the export lacks it (D-018)', () => {
    expect(gapWords({ source: 'trades', why: 'unreadable', detail: 'trade_history' }).display).toBe('Trades couldn\'t be read this time.');
    expect(gapWords({ source: 'trades', why: 'not_in_export', detail: 'trade_history' }).display).toBe('The export has no trade record, so trades aren\'t on the wire.');
  });

  it('without the log, states a roster change between two exports as a change', () => {
    historyDb.exec(`DELETE FROM roster_state_snapshots; DELETE FROM roster_state_snapshot_players; DELETE FROM roster_state_transitions; DELETE FROM roster_state_snapshot_saves;`);
    const hurt = save.hitters[1];
    expect(captureRosterStateSnapshot({ log: null }).status).toBe('created');
    db.prepare(`UPDATE players_roster_status SET is_active = 0, is_on_dl = 1 WHERE player_id = ?`).run(hurt);
    db.prepare(`UPDATE players SET injury_is_injured = 1, injury_left = 20 WHERE player_id = ?`).run(hurt);
    expect(captureRosterStateSnapshot({ log: null }).status).toBe('created');
    forgetWire();
    const w = wireFacts(importedAt.value, save.org);
    expect(w.fromLog).toBe(false);
    expect(w.gaps.map((g) => g.why)).toContain('log_unavailable');
    const change = w.facts.find((f) => f.source === 'snapshots' && f.players[0]?.playerId === hurt && f.detail.kind === 'snapshot' && f.detail.change.what === 'injuredList');
    expect(change).toBeDefined();
    expect(wireEntry(change!, none, ctx).headline.text).toMatch(/: now on the injured list$/);
  });

  it('reads standings movement from the standings kept at the last two imports: a new division leader, and places moved in ours', async () => {
    const row = (teamId: number, pos: number, gb: number): StandingsRow => ({
      teamId, name: `Club ${teamId} N`, abbr: `C${teamId}`, leagueId: save.leagueId, subLeagueId: 0, divisionId: 0, division: 'East', w: 20 - pos, l: 10 + pos,
      t: 0, pos, divisionClubs: 4, gb, runsScored: 100, runsAllowed: 90,
    });
    await recordStandingsSnapshot('2040-05-05T10:00:00.000Z', '2040-5-5', [row(1, 2, 1), row(2, 1, 0), row(3, 3, 2), row(4, 4, 3)]);
    await recordStandingsSnapshot(importedAt.value!, '2040-5-6', [row(1, 1, 0), row(2, 2, 1), row(3, 3, 2), row(4, 4, 3)]);
    forgetWire();
    const standings = wireFacts(importedAt.value, save.org).facts.filter((f) => f.kind === 'standings');
    expect(standings.map((f) => f.clubs[0].teamId).sort()).toEqual([1, 2]);
    const leader = wireEntry(standings.find((f) => f.clubs[0].teamId === 1)!, none, ctx);
    expect(leader.headline.text).toBe('Club 1 N: 1st in the East (was 2nd)');
  });

  it('covers this season only: a trade or a log move from last season is not on "This season", and the count follows (M2)', () => {
    insert('trade_history', { date: '2039-7-30', summary: 'The Club 3 traded P 1 to the Club 4 for P 2.', message_id: 8001, team_id_0: save.clubs[2], player_id_0_0: 0, player_id_0_1: 0, team_id_1: save.clubs[3], player_id_1_0: 0, player_id_1_1: 0 });
    forgetWire();
    const w = wireFacts(importedAt.value, save.org);
    expect(w.facts.some((f) => f.ownWords === 'The Club 3 traded P 1 to the Club 4 for P 2.')).toBe(false);
    const all = wireWords(save.org, w, none, { sinceDay: null, sinceRaw: null, sinceFrom: 'season', club: null, kind: null, followedOnly: false, followedFirst: false, limit: 50 }, ctx);
    expect(all.since.display).toBe('This season');
    expect(all.total).toBe(w.facts.length);
    // The log's moves by its own season: last season's, and one whose season the log doesn't give but whose day is last year
    const club = save.org;
    const event = (id: string, date: string | null, season: number | null) => ({
      id, date, season, kind: 'optioned', supported: true, playerId: 7, playerName: 'Sam Arm', from: null, to: null, text: `Move ${id}`,
      sources: [{ teamId: club, logId: 1 }],
    });
    const moves = logFacts({ events: [event('a', '2040-05-01', 2040), event('b', '2039-09-01', 2039), event('c', '2039-09-02', null), event('d', null, null)] } as never, leagueClubs(), 2040);
    expect(moves.map((f) => f.ownWords)).toEqual(['Move a', 'Move d']);
  });

  it('keeps the gathered wire for a few clubs, so asking for another club\'s wire doesn\'t gather ours again (L6)', () => {
    forgetWire();
    const other = save.clubs.find((c) => c !== save.org)!;
    wireFacts(importedAt.value, save.org);
    const once = wireBuilds();
    wireFacts(importedAt.value, other);
    wireFacts(importedAt.value, save.org);
    wireFacts(importedAt.value, other);
    expect(wireBuilds()).toBe(once + 1);
  });

  it('names a column a source needs that the export lacks, never an empty list (M3)', () => {
    dropColumn('players_awards', 'year');
    forgetWire();
    const w = wireFacts(importedAt.value, save.org);
    expect(w.gaps).toContainEqual({ source: 'awards', why: 'not_in_export', detail: 'players_awards.year' });
    expect(gapWords({ source: 'awards', why: 'not_in_export', detail: 'players_awards.year' })).toMatchObject({
      display: 'The export\'s awards lack what the wire needs.', tone: 'unknown', hint: 'Not in the export: players_awards.year',
    });
  });
});
