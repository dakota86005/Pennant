import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { historyDb } from '../server/history.js';
import { forgetHistoryKey } from '../server/historyIdentity.js';
import { forgetMemoryCaches, recordStandingsSnapshot, type StandingsRow } from '../server/frontOfficeMemory.js';
import { forgetWire, wireBuilds, wireFacts, WIRE_STREAK_POLICY, type WireFact } from '../server/leagueWire.js';
import { captureRosterStateSnapshot } from '../server/rosterStateHistory.js';
import { importedAt } from '../server/playerStateRoutes.js';
import { KIND_ORDER, wireEntry, wireOrder, wireWords, type Followed } from '../server/presentation/frontOffice/wire.js';
import { buildSave, dropTable, type BuiltSave } from './syntheticSave';

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
    fact({ id: 'news:1', source: 'news', kind: 'news', ownWords: 'A sweep', day: '2040-05-05', clubs: [{ teamId: 3, name: 'Club 3 N', abbr: 'C3' }], players: [] }),
    fact({ id: 'log:2', day: '2040-05-04' }),
    fact({ id: 'trades:1', source: 'trades', kind: 'trade', ownWords: 'A trade', day: '2040-05-05', clubs: [{ teamId: 2, name: 'Club 2 N', abbr: 'C2' }], players: [] }),
    fact({ id: 'log:3', day: null, date: null }),
    fact({ id: 'log:4', day: '2040-05-05', clubs: [{ teamId: 4, name: 'Club 4 N', abbr: 'C4' }] }),
  ];

  it('orders by the newest day, then the kind in its stated order, then the source\'s own order; a day not known last', () => {
    expect(wireOrder(facts, none, false).map((f) => f.id)).toEqual(['trades:1', 'log:4', 'news:1', 'log:2', 'log:3']);
    expect(KIND_ORDER).toEqual(['trade', 'move', 'injury', 'award', 'streak', 'standings', 'news']);
  });

  it('puts followed clubs first only when asked, and following changes no entry\'s words (case 20)', () => {
    const followed: Followed = { clubs: new Set([3]), players: new Set() };
    expect(wireOrder(facts, followed, true).map((f) => f.id)[0]).toBe('news:1');
    expect(wireOrder(facts, followed, false).map((f) => f.id)).toEqual(wireOrder(facts, none, false).map((f) => f.id));
    const plain = facts.map((f) => wireEntry(f, none, ctx).headline.text);
    const withFollow = facts.map((f) => wireEntry(f, followed, ctx).headline.text);
    expect(withFollow).toEqual(plain);
    const q = { sinceDay: null, sinceRaw: null, sinceFrom: 'season' as const, club: null, kind: null, followedOnly: false, followedFirst: true, limit: 50 };
    const wire = wireWords(1, { facts, gaps: [], fromLog: true, gameDate: '2040-5-6', previousGameDate: null }, followed, q, ctx);
    expect(wire.order.line.display).toBe('Followed first, then newest');
    expect(wire.entries[0].followed).toBe(true);
    expect(wireWords(1, { facts, gaps: [], fromLog: true, gameDate: '2040-5-6', previousGameDate: null }, followed, { ...q, followedOnly: true }, ctx).entries.map((e) => e.id)).toEqual(['news:1']);
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

  it('reads the trades, news, injuries, awards and streaks the export records, each in its own words or established names', () => {
    const w = wireFacts(importedAt.value, save.org);
    const kinds = new Set(w.facts.map((f) => f.kind));
    for (const k of ['trade', 'news', 'injury', 'award', 'streak'] as const) expect(kinds.has(k), k).toBe(true);
    expect(w.facts.find((f) => f.kind === 'award')!.detail).toMatchObject({ award: 'Player of the Week' });
    expect(w.facts.find((f) => f.kind === 'trade')!.ownWords).toMatch(/^The Club 2 traded /);
    // Gathered once per import: the second ask is the kept one
    const builds = wireBuilds();
    wireFacts(importedAt.value, save.org);
    expect(wireBuilds()).toBe(builds);
  });

  it('shows a streak only from its stated line, and only a streak whose meaning is established', () => {
    db.prepare(`INSERT INTO players_streak (player_id, streak_id, value, started, has_ended) VALUES (?, 0, ?, '2040-4-30', 0)`).run(save.regular, WIRE_STREAK_POLICY.hitting - 1);
    db.prepare(`INSERT INTO players_streak (player_id, streak_id, value, started, has_ended) VALUES (?, 5, 40, '2040-4-1', 0)`).run(save.regular);
    const streaks = wireFacts(importedAt.value, save.org).facts.filter((f) => f.kind === 'streak');
    expect(streaks.every((f) => f.detail.kind === 'streak' && f.detail.games >= f.detail.line)).toBe(true);
    expect(streaks.some((f) => f.players[0].playerId === save.regular)).toBe(false);
    db.prepare(`DELETE FROM players_streak WHERE player_id = ?`).run(save.regular);
  });

  it('names a table the export lacks as a gap, never an empty league', () => {
    dropTable('trade_history');
    const w = wireFacts(importedAt.value, save.org);
    expect(w.gaps).toContainEqual({ source: 'trades', why: 'not_in_export', detail: 'trade_history' });
    expect(w.facts.some((f) => f.kind === 'trade')).toBe(false);
    const words = wireWords(save.org, w, none, { sinceDay: null, sinceRaw: null, sinceFrom: 'season', club: null, kind: null, followedOnly: false, followedFirst: false, limit: 50 }, ctx);
    expect(words.gaps.map((g) => g.display)).toContain('The export has no trade record, so trades aren\'t on the wire.');
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
});
