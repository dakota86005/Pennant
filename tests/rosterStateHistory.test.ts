import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { historyDb } from '../server/history.js';
import {
  captureRosterStateSnapshot,
  compareRosterStateSnapshots,
  correlateRosterTransition,
  rosterStateEventsForSnapshot,
  type PersistentRosterState,
  type RosterStateSnapshot,
} from '../server/rosterStateHistory.js';
import { IDS } from './fixture';

const SAVE_NAME = 'unknown';

function clearRosterHistory(): void {
  historyDb.prepare(
    `DELETE FROM roster_state_transitions WHERE snapshot_id IN
       (SELECT id FROM roster_state_snapshots WHERE save_name = ?)`
  ).run(SAVE_NAME);
  historyDb.prepare(
    `DELETE FROM roster_state_snapshot_players WHERE snapshot_id IN
       (SELECT id FROM roster_state_snapshots WHERE save_name = ?)`
  ).run(SAVE_NAME);
  historyDb.prepare('DELETE FROM roster_state_snapshots WHERE save_name = ?').run(SAVE_NAME);
}

const player = (overrides: Partial<PersistentRosterState> = {}): PersistentRosterState => ({
  playerId: IDS.optioned,
  name: 'Optioned Prospect',
  organizationId: IDS.mlbTeam,
  teamId: IDS.aaaTeam,
  teamLevel: 2,
  position: 2,
  role: 0,
  activeMlb: false,
  fortyMan: true,
  onIl: false,
  onIl60: false,
  designatedForAssignment: false,
  onWaivers: false,
  majorLeagueContract: true,
  unknowns: [],
  ...overrides,
});

const snapshot = (id: number, gameDate: string, players: PersistentRosterState[]): RosterStateSnapshot => ({
  id,
  saveName: SAVE_NAME,
  leagueId: IDS.league,
  gameDate,
  observedAt: `${gameDate}T12:00:00.000Z`,
  stateHash: String(id),
  players,
});

beforeEach(() => {
  clearRosterHistory();
  db.prepare('UPDATE leagues SET "current_date" = ? WHERE league_id = ?').run('2030-06-01', IDS.league);
  db.prepare(
    `UPDATE players_roster_status
     SET is_active = 0, is_on_dl = 0, is_on_dl60 = 0,
         designated_for_assignment = 0, is_on_waivers = 0, is_on_secondary = 1
     WHERE player_id = ?`
  ).run(IDS.optioned);
  db.prepare('UPDATE players SET team_id = ?, organization_id = ? WHERE player_id = ?')
    .run(IDS.aaaTeam, IDS.mlbTeam, IDS.optioned);
  db.exec('DROP TABLE IF EXISTS trade_history');
  db.exec('DROP TABLE IF EXISTS players_injury_history');
});

afterEach(() => clearRosterHistory());

describe('persistent observed roster history', () => {
  it('records only changed meaningful import states, including distinct states on one OOTP date', () => {
    const first = captureRosterStateSnapshot();
    expect(first.status).toBe('created');
    expect(first.snapshot?.players.length).toBeGreaterThan(0);
    expect(first.events).toEqual([]); // no predecessor means no invented prior history

    expect(captureRosterStateSnapshot().status).toBe('duplicate');

    db.prepare('UPDATE players_roster_status SET is_active = 1 WHERE player_id = ?').run(IDS.optioned);
    const changedSameDate = captureRosterStateSnapshot();
    expect(changedSameDate.status).toBe('created');
    expect(changedSameDate.snapshot?.gameDate).toBe('2030-06-01');
    expect(changedSameDate.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ transition: expect.objectContaining({ playerId: IDS.optioned }) }),
    ]));
    expect(captureRosterStateSnapshot().status).toBe('duplicate');

    db.prepare('UPDATE leagues SET "current_date" = ? WHERE league_id = ?').run('2030-06-02', IDS.league);
    expect(captureRosterStateSnapshot().status).toBe('created');
  });

  it('preserves all simultaneous factual changes, including appearance and disappearance', () => {
    const before = snapshot(1, '2030-06-01', [
      player(),
      player({ playerId: 999_001, name: 'Disappeared Player' }),
    ]);
    const after = snapshot(2, '2030-06-02', [
      player({
        organizationId: IDS.otherMlbTeam, teamId: IDS.otherMlbTeam, teamLevel: 1,
        activeMlb: true, fortyMan: false, onIl: true, onIl60: true,
        designatedForAssignment: true, onWaivers: true, majorLeagueContract: false,
      }),
      player({ playerId: 999_002, name: 'Appeared Player' }),
    ]);
    const transitions = compareRosterStateSnapshots(before, after);
    const changed = transitions.find((transition) => transition.playerId === IDS.optioned)!;
    expect(changed.kind).toBe('changed');
    expect(changed.provenance).toBe('observed');
    expect(changed.changes.map((change) => change.field)).toEqual(expect.arrayContaining([
      'organizationId', 'teamId', 'teamLevel', 'activeMlb', 'fortyMan', 'onIl', 'onIl60',
      'designatedForAssignment', 'onWaivers', 'majorLeagueContract',
    ]));
    expect(transitions.map((transition) => transition.kind)).toEqual(expect.arrayContaining(['appeared', 'disappeared']));

    const reverse = compareRosterStateSnapshots(after, before).find((transition) => transition.playerId === IDS.optioned)!;
    expect(reverse.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'activeMlb', before: true, after: false }),
      expect.objectContaining({ field: 'onIl', before: true, after: false }),
      expect.objectContaining({ field: 'onIl60', before: true, after: false }),
    ]));
  });

  it('corroborates a matching explicit trade, but leaves an unmatched organization change unknown', () => {
    const before = snapshot(1, '2030-06-01', [player()]);
    const after = snapshot(2, '2030-06-03', [player({ organizationId: IDS.otherMlbTeam, teamId: IDS.otherMlbTeam, teamLevel: 1 })]);
    const transition = compareRosterStateSnapshots(before, after)[0];
    db.exec('CREATE TABLE trade_history (date TEXT, summary TEXT, message_id INTEGER, team_id_0 INTEGER, team_id_1 INTEGER, player_id_0_0 INTEGER)');
    db.prepare('INSERT INTO trade_history VALUES (?, ?, ?, ?, ?, ?)')
      .run('2030-06-02', 'Observed trade', 71, IDS.mlbTeam, IDS.otherMlbTeam, IDS.optioned);
    const corroborated = correlateRosterTransition(transition, before, after);
    expect(corroborated).toMatchObject({
      conclusion: 'trade_associated_organization_change', provenance: 'corroborated',
      evidence: [expect.objectContaining({ provenance: 'explicit', event: expect.objectContaining({ kind: 'trade' }) })],
    });

    db.prepare('UPDATE trade_history SET team_id_1 = ?').run(8888);
    expect(correlateRosterTransition(transition, before, after)).toEqual({ conclusion: 'unknown', provenance: 'unknown', evidence: [] });
  });

  it('corroborates an IL entry with an injury record, never injury history alone', () => {
    const before = snapshot(1, '2030-06-01', [player()]);
    const ilAfter = snapshot(2, '2030-06-03', [player({ onIl: true })]);
    db.exec('CREATE TABLE players_injury_history (player_id INTEGER, date TEXT, length INTEGER, setbacks INTEGER, day_to_day INTEGER, effect INTEGER, body_part TEXT)');
    db.prepare('INSERT INTO players_injury_history VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(IDS.optioned, '2030-06-02', 14, 1, 0, 5, 'shoulder');
    const ilTransition = compareRosterStateSnapshots(before, ilAfter)[0];
    expect(correlateRosterTransition(ilTransition, before, ilAfter)).toMatchObject({
      conclusion: 'injury_associated_il_change', provenance: 'corroborated',
      evidence: [expect.objectContaining({ event: expect.objectContaining({ details: expect.objectContaining({ length: 14, setbacks: 1, body_part: 'shoulder' }) }) })],
    });

    const assignmentAfter = snapshot(3, '2030-06-03', [player({ teamId: IDS.mlbTeam, teamLevel: 1, activeMlb: true })]);
    expect(correlateRosterTransition(compareRosterStateSnapshots(before, assignmentAfter)[0], before, assignmentAfter))
      .toEqual({ conclusion: 'unknown', provenance: 'unknown', evidence: [] });
  });

  it('persists correlated events and stays tolerant when optional history sources are absent', () => {
    const first = captureRosterStateSnapshot();
    expect(first.status).toBe('created');
    db.prepare('UPDATE players_roster_status SET is_active = 1 WHERE player_id = ?').run(IDS.optioned);
    const second = captureRosterStateSnapshot();
    expect(second.status).toBe('created');
    expect(second.events.find((event) => event.transition.playerId === IDS.optioned)?.causalCorrelation)
      .toEqual({ conclusion: 'unknown', provenance: 'unknown', evidence: [] });
    expect(rosterStateEventsForSnapshot(second.snapshot!.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ transition: expect.objectContaining({ playerId: IDS.optioned }) }),
    ]));
  });

  it('does not manufacture a pre-Front Office roster transition from older explicit history', () => {
    db.exec('CREATE TABLE trade_history (date TEXT, summary TEXT, message_id INTEGER, team_id_0 INTEGER, team_id_1 INTEGER, player_id_0_0 INTEGER)');
    db.prepare('INSERT INTO trade_history VALUES (?, ?, ?, ?, ?, ?)')
      .run('2030-05-20', 'Older trade', 91, IDS.mlbTeam, IDS.otherMlbTeam, IDS.optioned);
    const firstObserved = captureRosterStateSnapshot();
    expect(firstObserved.status).toBe('created');
    expect(firstObserved.events).toEqual([]);
  });
});
