import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { historyDb } from '../server/history.js';
import {
  captureRosterStateSnapshot,
  compareRosterStateSnapshots,
  correlateRosterTransition,
  logEvidenceForTransition,
  rosterStateEventsForSnapshot,
  type PersistentRosterState,
  type RosterStateSnapshot,
} from '../server/rosterStateHistory.js';
import { assignmentContextFor } from '../server/assignmentContext.js';
import { playerState } from '../server/playerState.js';
import { readTransactionLog, type TransactionLog } from '../server/transactionLog.js';
import { IDS } from './fixture';
import { makeSave, tx, type FakeSave, type LogRow } from './liveLogFixture';

const SAVE_NAME = 'unknown';
const KELLY: [number, string] = [IDS.optioned, 'Merrill Kelly'];

function clearRosterHistory(): void {
  historyDb.prepare(`DELETE FROM roster_state_transitions WHERE snapshot_id IN (SELECT id FROM roster_state_snapshots WHERE save_name = ?)`).run(SAVE_NAME);
  historyDb.prepare(`DELETE FROM roster_state_snapshot_players WHERE snapshot_id IN (SELECT id FROM roster_state_snapshots WHERE save_name = ?)`).run(SAVE_NAME);
  historyDb.prepare('DELETE FROM roster_state_snapshots WHERE save_name = ?').run(SAVE_NAME);
}

const player = (o: Partial<PersistentRosterState> = {}): PersistentRosterState => ({
  playerId: IDS.optioned, name: 'Optioned Prospect', organizationId: IDS.mlbTeam, teamId: IDS.aaaTeam, teamLevel: 2,
  position: null, role: null, activeMlb: false, fortyMan: true, onIl: false, onIl60: false,
  injuryActive: false, injuryDayToDay: false, injuryDaysLeft: 0, designatedForAssignment: false,
  onWaivers: false, majorLeagueContract: true, unknowns: [], ...o,
});
const snapshot = (id: number, gameDate: string, players: PersistentRosterState[]): RosterStateSnapshot => ({
  id, saveName: SAVE_NAME, leagueId: IDS.league, gameDate, observedAt: `${gameDate}T12:00:00.000Z`, stateHash: String(id), players,
});

const saves: FakeSave[] = [];
function logWith(rows: LogRow[]): TransactionLog {
  const s = makeSave({ rows });
  saves.push(s);
  return readTransactionLog(s.files);
}

beforeEach(() => {
  clearRosterHistory();
  db.prepare('UPDATE leagues SET "current_date" = ? WHERE league_id = ?').run('2030-06-01', IDS.league);
  db.prepare(`UPDATE players_roster_status SET is_active = 0, is_on_dl = 0, is_on_dl60 = 0, designated_for_assignment = 0, is_on_waivers = 0, is_on_secondary = 1 WHERE player_id = ?`).run(IDS.optioned);
  db.prepare('UPDATE players SET team_id = ?, organization_id = ? WHERE player_id = ?').run(IDS.aaaTeam, IDS.mlbTeam, IDS.optioned);
  db.exec('DROP TABLE IF EXISTS trade_history');
  db.exec('DROP TABLE IF EXISTS players_injury_history');
});
afterEach(() => {
  clearRosterHistory();
  saves.splice(0).forEach((s) => s.cleanup());
});

describe('observed snapshots record what changed, and only that', () => {
  it('records changed imports once, including distinct states on one OOTP date', () => {
    const none = { log: null };
    const first = captureRosterStateSnapshot(none);
    expect(first.status).toBe('created');
    expect(first.events).toEqual([]); // no predecessor means no invented prior history
    expect(captureRosterStateSnapshot(none).status).toBe('duplicate');

    db.prepare('UPDATE players_roster_status SET is_active = 1 WHERE player_id = ?').run(IDS.optioned);
    const changed = captureRosterStateSnapshot(none);
    expect(changed.status).toBe('created');
    expect(changed.snapshot?.gameDate).toBe('2030-06-01');
    expect(captureRosterStateSnapshot(none).status).toBe('duplicate');

    db.prepare('UPDATE leagues SET "current_date" = ? WHERE league_id = ?').run('2030-06-02', IDS.league);
    expect(captureRosterStateSnapshot(none).status).toBe('created');
  });

  it('a snapshot difference is labelled as observed and never names a transaction', () => {
    const before = snapshot(1, '2030-06-01', [player({ teamId: IDS.mlbTeam, teamLevel: 1, activeMlb: true })]);
    const after = snapshot(2, '2030-06-02', [player()]); // active MLB → Triple-A: looks like an option, might be rehab
    const [transition] = compareRosterStateSnapshots(before, after);
    expect(transition.provenance).toBe('observed_snapshot');
    expect(transition.kind).toBe('changed');
    expect(transition.changes.map((c) => c.field)).toEqual(expect.arrayContaining(['teamId', 'teamLevel', 'activeMlb']));
    // Everything but the player's display name (the fixture's is "Optioned Prospect")
    const { playerName: _name, ...facts } = transition;
    const text = JSON.stringify(facts).toLowerCase();
    for (const word of ['optioned', 'recalled', 'designated', 'dfa', 'rehab', 'released', 'purchased']) {
      expect(text, word).not.toContain(`"${word}`);
    }
    expect(Object.keys(transition)).not.toContain('transaction');
  });

  it('preserves all simultaneous factual changes, including appearance and disappearance', () => {
    const before = snapshot(1, '2030-06-01', [player(), player({ playerId: 999_001, name: 'Gone' })]);
    const after = snapshot(2, '2030-06-02', [
      player({ organizationId: IDS.otherMlbTeam, teamId: IDS.otherMlbTeam, teamLevel: 1, activeMlb: true, fortyMan: false, onIl: true, onIl60: true, designatedForAssignment: true, onWaivers: true, majorLeagueContract: false }),
      player({ playerId: 999_002, name: 'New' }),
    ]);
    const ts = compareRosterStateSnapshots(before, after);
    expect(ts.find((t) => t.playerId === IDS.optioned)!.changes.map((c) => c.field)).toEqual(expect.arrayContaining([
      'organizationId', 'teamId', 'teamLevel', 'activeMlb', 'fortyMan', 'onIl', 'onIl60', 'designatedForAssignment', 'onWaivers', 'majorLeagueContract',
    ]));
    expect(ts.map((t) => t.kind)).toEqual(expect.arrayContaining(['appeared', 'disappeared']));
  });

  it('an optional field becoming available is not a change', () => {
    const before = snapshot(1, '2030-06-01', [player({ fortyMan: null })]);
    const after = snapshot(2, '2030-06-02', [player({ fortyMan: true })]);
    expect(compareRosterStateSnapshots(before, after)).toEqual([]);
  });
});

describe('explicit log evidence outranks snapshot inference', () => {
  const before = snapshot(1, '2030-06-01', [player({ teamId: IDS.mlbTeam, teamLevel: 1, activeMlb: true })]);
  const after = snapshot(2, '2030-06-03', [player()]);
  const [transition] = compareRosterStateSnapshots(before, after);

  it('attaches the explicit events in the interval, and lets them say what happened', () => {
    const log = logWith([
      { date: '20300602', teamId: IDS.mlbTeam, text: tx.rehabSent(KELLY, 'SP', [IDS.aaaTeam, 'Reno']) },
      { date: '20300602', teamId: IDS.aaaTeam, text: tx.rehabReceived(KELLY, 'SP', [IDS.mlbTeam, 'Arizona']) },
      { date: '20300520', teamId: IDS.mlbTeam, text: tx.released([1234, 'Someone Else'], 'RP') },
    ]);
    const evidence = logEvidenceForTransition(transition, before, after, { log });
    expect(evidence.status).toBe('events_in_window');
    expect(evidence.events.map((e) => e.kind)).toEqual(['rehab_assigned', 'rehab_received']);

    // The snapshots alone suggest a demotion. The explicit log says rehab, and wins
    const ctx = assignmentContextFor(playerState(IDS.optioned)!, log.byPlayer.get(IDS.optioned)!, { available: true, behind: false })!;
    expect(ctx.kind).toBe('rehab_assignment');
    expect(ctx.ordinaryOption).toBe(false);
  });

  it('a change the covering log does not mention is flagged as unexplained, not given a cause', () => {
    const log = logWith([{ date: '20300603', teamId: 5, text: tx.released([1234, 'Someone Else'], 'RP') }]);
    const evidence = logEvidenceForTransition(transition, before, after, { log });
    expect(evidence.status).toBe('none_in_window');
    expect(evidence.events).toEqual([]);
  });

  it('says the log is behind, or unavailable, instead of calling the change unexplained', () => {
    const behind = logWith([{ date: '20300601', teamId: 5, text: tx.released([1234, 'Someone Else'], 'RP') }]);
    expect(logEvidenceForTransition(transition, before, after, { log: behind }).status).toBe('log_behind');
    expect(logEvidenceForTransition(transition, before, after, { log: null }).status).toBe('log_unavailable');
  });

  it('persists structured events with the evidence and the unexplained flag', () => {
    const none = { log: null };
    captureRosterStateSnapshot(none);
    db.prepare('UPDATE players_roster_status SET is_active = 1 WHERE player_id = ?').run(IDS.optioned);
    const second = captureRosterStateSnapshot(none);
    const event = second.events.find((e) => e.transition.playerId === IDS.optioned)!;
    expect(event.logEvidence.status).toBe('log_unavailable');
    expect(event.unexplained).toBe(false); // no log to say so: not "unexplained"
    expect(event.transition.provenance).toBe('observed_snapshot');
    expect(rosterStateEventsForSnapshot(second.snapshot!.id).find((e) => e.transition.playerId === IDS.optioned)).toEqual(event);

    // With a log that covers the interval and is silent, the same change is unexplained
    db.prepare('UPDATE leagues SET "current_date" = ? WHERE league_id = ?').run('2030-06-02', IDS.league);
    db.prepare('UPDATE players_roster_status SET is_active = 0 WHERE player_id = ?').run(IDS.optioned);
    const log = logWith([{ date: '20300601', teamId: 5, text: tx.released([1234, 'Someone Else'], 'RP') }]);
    const third = captureRosterStateSnapshot({ log });
    const flagged = third.events.find((e) => e.transition.playerId === IDS.optioned)!;
    expect(flagged.logEvidence.status).toBe('none_in_window');
    expect(flagged.unexplained).toBe(true);
  });
});

describe('history never overrides current state', () => {
  it('current state and assignment context are read from the export, whatever the snapshots say', () => {
    captureRosterStateSnapshot({ log: null });
    // A later export changes the player; a prior snapshot still says otherwise
    db.prepare('UPDATE players_roster_status SET is_active = 1 WHERE player_id = ?').run(IDS.optioned);
    db.prepare('UPDATE players SET team_id = ? WHERE player_id = ?').run(IDS.mlbTeam, IDS.optioned);
    const s = playerState(IDS.optioned)!;
    expect(s.activeRoster.value).toBe(true);
    expect(s.teamId.value).toBe(IDS.mlbTeam);
    expect(s.level.value).toBe(1);
    db.prepare('UPDATE players SET team_id = ? WHERE player_id = ?').run(IDS.aaaTeam, IDS.optioned);
  });
});

describe('explicit export tables still corroborate, but never name a roster move', () => {
  const before = snapshot(1, '2030-06-01', [player()]);

  it('corroborates a matching explicit trade, and leaves an unmatched organization change unknown', () => {
    const after = snapshot(2, '2030-06-03', [player({ organizationId: IDS.otherMlbTeam, teamId: IDS.otherMlbTeam, teamLevel: 1 })]);
    const transition = compareRosterStateSnapshots(before, after)[0];
    db.exec('CREATE TABLE trade_history (date TEXT, summary TEXT, message_id INTEGER, team_id_0 INTEGER, team_id_1 INTEGER, player_id_0_0 INTEGER)');
    db.prepare('INSERT INTO trade_history VALUES (?, ?, ?, ?, ?, ?)').run('2030-06-02', 'Observed trade', 71, IDS.mlbTeam, IDS.otherMlbTeam, IDS.optioned);
    expect(correlateRosterTransition(transition, before, after)).toMatchObject({
      conclusion: 'trade_associated_organization_change', provenance: 'derived',
      evidence: [expect.objectContaining({ provenance: 'explicit_export', event: expect.objectContaining({ kind: 'trade' }) })],
    });
    db.prepare('UPDATE trade_history SET team_id_1 = ?').run(8888);
    expect(correlateRosterTransition(transition, before, after)).toEqual({ conclusion: 'unknown', provenance: 'unknown', evidence: [] });
  });

  it('associates an IL entry with an injury record, never injury history alone', () => {
    const ilAfter = snapshot(2, '2030-06-03', [player({ onIl: true })]);
    db.exec('CREATE TABLE players_injury_history (player_id INTEGER, date TEXT, length INTEGER, setbacks INTEGER, day_to_day INTEGER, effect INTEGER, body_part TEXT)');
    db.prepare('INSERT INTO players_injury_history VALUES (?, ?, ?, ?, ?, ?, ?)').run(IDS.optioned, '2030-06-02', 14, 1, 0, 5, 'shoulder');
    expect(correlateRosterTransition(compareRosterStateSnapshots(before, ilAfter)[0], before, ilAfter)).toMatchObject({
      conclusion: 'injury_associated_il_change', provenance: 'derived',
    });
    const assignmentOnly = snapshot(3, '2030-06-03', [player({ teamId: IDS.mlbTeam, teamLevel: 1, activeMlb: true })]);
    expect(correlateRosterTransition(compareRosterStateSnapshots(before, assignmentOnly)[0], before, assignmentOnly).conclusion).toBe('unknown');
  });

  it('does not manufacture a pre-Pennant transition from older explicit history', () => {
    db.exec('CREATE TABLE trade_history (date TEXT, summary TEXT, message_id INTEGER, team_id_0 INTEGER, team_id_1 INTEGER, player_id_0_0 INTEGER)');
    db.prepare('INSERT INTO trade_history VALUES (?, ?, ?, ?, ?, ?)').run('2030-05-20', 'Older trade', 91, IDS.mlbTeam, IDS.otherMlbTeam, IDS.optioned);
    const first = captureRosterStateSnapshot({ log: null });
    expect(first.status).toBe('created');
    expect(first.events).toEqual([]);
  });
});
