import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { assignmentContextFor, latestRehabEpisode, type LogAvailability } from '../server/assignmentContext.js';
import { playerState } from '../server/playerState.js';
import { parseTransaction, type TransactionEvent } from '../server/transactionLog.js';
import { IDS } from './fixture';
import { tx } from './liveLogFixture';

/**
 * The real failure: a player on an injury-rehab assignment appears in the
 * export as Triple-A, on the 40-man, not active, with no flag saying so — the
 * same as an optioned player. Pennant treated him as one. The fixture's
 * optioned player stands in for Merrill Kelly here.
 */

const KELLY: [number, string] = [IDS.optioned, 'Merrill Kelly'];
const ARIZONA: [number, string] = [IDS.mlbTeam, 'Arizona'];
const RENO: [number, string] = [IDS.aaaTeam, 'Reno'];

let logId = 0;
/** Events as the reader would produce them: oldest first, each with its own log row. */
function events(rows: Array<[date: string, text: string, teamId?: number]>): TransactionEvent[] {
  return rows.map(([date, text, teamId]) =>
    parseTransaction(text, { logId: ++logId, teamId: teamId ?? IDS.mlbTeam, rawType: 0, rawDate: date, season: 2030 })
  );
}

const rehabStart = (date = '20300512') => events([
  [date, tx.rehabSent(KELLY, 'SP', RENO), IDS.mlbTeam],
  [date, tx.rehabReceived(KELLY, 'SP', ARIZONA), IDS.aaaTeam],
]);

const CURRENT: LogAvailability = { available: true, behind: false };
const restore: Array<() => void> = [];
afterEach(() => restore.splice(0).reverse().forEach((r) => r()));

function setExport(table: 'players' | 'players_roster_status', values: Record<string, number | null>): void {
  const before = db.prepare(`SELECT * FROM ${table} WHERE player_id = ?`).get(IDS.optioned) as Record<string, unknown>;
  const cols = Object.keys(values);
  db.prepare(`UPDATE ${table} SET ${cols.map((c) => `"${c}" = ?`).join(', ')} WHERE player_id = ?`).run(...cols.map((c) => values[c]), IDS.optioned);
  restore.push(() => {
    const keys = Object.keys(before);
    db.prepare(`UPDATE ${table} SET ${keys.map((c) => `"${c}" = ?`).join(', ')} WHERE player_id = ?`).run(...keys.map((k) => before[k]), IDS.optioned);
  });
}
const state = () => playerState(IDS.optioned)!;

describe('rehab assignment is first-class', () => {
  it('the export alone cannot tell rehab from an option: same team, level, 40-man, not active', () => {
    const s = state();
    expect(s.level.value).toBe(2);
    expect(s.fortyMan.value).toBe(true);
    expect(s.activeRoster.value).toBe(false);
    expect(s.injuredList.onIl.value).toBe(false);
    // Nothing exported says "rehab": there is no such field to read
    expect(JSON.stringify(s)).not.toMatch(/rehab/i);
  });

  it('identifies rehab from explicit log evidence when the export agrees', () => {
    const ctx = assignmentContextFor(state(), rehabStart(), CURRENT)!;
    expect(ctx.kind).toBe('rehab_assignment');
    expect(ctx.label).toBe('Rehab assignment');
    expect(ctx.provenance).toBe('explicit_log');
    expect(ctx.source).toBe('OOTP transaction log');
    expect(ctx.sinceLabel).toBe('Sent on rehab');
    expect(ctx.since).toBe('2030-05-12');
    expect(ctx.exportAgrees).toBe(true);
    expect(ctx.rehab).toMatchObject({
      status: 'active', sentOn: '2030-05-12',
      parent: { id: IDS.mlbTeam, name: 'Arizona' }, club: { id: IDS.aaaTeam, name: 'Reno', levelLabel: 'Triple A' },
    });
    expect(ctx.evidence.map((e) => e.kind)).toEqual(['rehab_assigned', 'rehab_received']);
  });

  it('is NOT an ordinary option or a demotion', () => {
    const rehab = assignmentContextFor(state(), rehabStart(), CURRENT)!;
    expect(rehab.ordinaryOption).toBe(false);
    expect(rehab.kind).not.toBe('optioned');

    // ...where a real option, in the very same export state, is one
    const option = assignmentContextFor(state(), events([['20300512', tx.optioned(KELLY, 'SP', RENO)]]), CURRENT)!;
    expect(option.kind).toBe('optioned');
    expect(option.ordinaryOption).toBe(true);
    expect(option).toMatchObject({ sinceLabel: 'Optioned', since: '2030-05-12', provenance: 'explicit_log' });
  });

  it('is identified from the affiliate row alone, or the parent row alone', () => {
    const received = events([['20300512', tx.rehabReceived(KELLY, 'SP', ARIZONA), IDS.aaaTeam]]);
    expect(assignmentContextFor(state(), received, CURRENT)!.kind).toBe('rehab_assignment');
    const sent = events([['20300512', tx.rehabSent(KELLY, 'SP', RENO), IDS.mlbTeam]]);
    expect(assignmentContextFor(state(), sent, CURRENT)!.kind).toBe('rehab_assignment');
  });

  it('ends when the log records him returning, being recalled, or being optioned', () => {
    for (const ending of [
      tx.rehabReturned(KELLY, 'SP'),
      tx.promotedToMlb(KELLY, 'SP', ARIZONA),
      tx.recalled(KELLY, 'SP', RENO),
      tx.purchased(KELLY, 'SP', RENO),
      tx.optioned(KELLY, 'SP', RENO),
      tx.dfa(KELLY, 'SP'),
      tx.released(KELLY, 'SP'),
    ]) {
      const history = [...rehabStart('20300505'), ...events([['20300511', ending]])];
      expect(latestRehabEpisode(history)!.ended, ending).not.toBeNull();
      expect(assignmentContextFor(state(), history, CURRENT)?.kind, ending).not.toBe('rehab_assignment');
    }
  });

  it('a later injured-list move or an unparsed row does not end it', () => {
    const history = [
      ...rehabStart('20300505'),
      ...events([
        ['20300506', tx.ilPlaced(KELLY, 'SP')],
        ['20300507', `Some brand-new kind of entry about ${tx.signed(KELLY, 'SP')}`],
      ]),
    ];
    expect(latestRehabEpisode(history)!.ended).toBeNull();
    expect(assignmentContextFor(state(), history, CURRENT)!.kind).toBe('rehab_assignment');
  });

  it('a second rehab after the first ended is a new episode', () => {
    const history = [
      ...rehabStart('20300505'),
      ...events([['20300509', tx.rehabReturned(KELLY, 'SP')]]),
      ...rehabStart('20300520'),
    ];
    const ctx = assignmentContextFor(state(), history, CURRENT)!;
    expect(ctx.kind).toBe('rehab_assignment');
    expect(ctx.since).toBe('2030-05-20');
  });

  it('the export outranks the log: rehab does not survive the player being back in the majors', () => {
    setExport('players', { team_id: IDS.mlbTeam });
    setExport('players_roster_status', { is_active: 1 });
    const ctx = assignmentContextFor(state(), rehabStart(), CURRENT);
    expect(ctx?.kind).not.toBe('rehab_assignment');
    expect(ctx).toBeNull();
  });

  it('the export outranks the log: a different club than the rehab club is not rehab, and says why', () => {
    setExport('players', { team_id: IDS.otherMlbTeam });
    const ctx = assignmentContextFor(state(), rehabStart(), CURRENT);
    expect(ctx?.kind).not.toBe('rehab_assignment');
  });

  it('flags the mismatch on a 40-man player below the majors instead of trusting stale rehab evidence', () => {
    // Log still says rehab at Reno, but the export has him somewhere else in the minors
    db.prepare('INSERT INTO teams (team_id, name, nickname, abbr, level, league_id, sub_league_id, division_id, parent_team_id, allstar_team, human_team) VALUES (77, ?, ?, ?, 3, ?, 0, 0, ?, 0, 0)')
      .run('Elsewhere', 'AA', 'ELS', IDS.league, IDS.mlbTeam);
    restore.push(() => db.prepare('DELETE FROM teams WHERE team_id = 77').run());
    setExport('players', { team_id: 77 });
    const ctx = assignmentContextFor(state(), rehabStart(), CURRENT)!;
    expect(ctx.kind).toBe('unattributed');
    expect(ctx.ordinaryOption).toBeNull();
    expect(ctx.note).toMatch(/rehab assignment from 2030-05-12 that the current export no longer matches/);
  });
});

describe('when the cause cannot be established, it says so and why', () => {
  const noEvents: TransactionEvent[] = [];

  it('log unavailable: never assumes an option', () => {
    const ctx = assignmentContextFor(state(), null, { available: false, behind: false })!;
    expect(ctx.kind).toBe('unattributed');
    expect(ctx.ordinaryOption).toBeNull();
    expect(ctx.reason).toBe('source_unavailable');
    expect(ctx.provenance).toBe('unknown');
    expect(ctx.note).toMatch(/cannot be told apart from an option or a rehab assignment/);
  });

  it('log behind the save: the reason is a stale source', () => {
    const ctx = assignmentContextFor(state(), noEvents, { available: true, behind: true })!;
    expect(ctx).toMatchObject({ kind: 'unattributed', reason: 'source_stale', ordinaryOption: null });
  });

  it('log current but holding nothing for him: no explicit event', () => {
    const ctx = assignmentContextFor(state(), noEvents, CURRENT)!;
    expect(ctx).toMatchObject({ kind: 'unattributed', reason: 'no_explicit_event', ordinaryOption: null });
  });

  it('says nothing for a player whose assignment needs no explaining', () => {
    setExport('players_roster_status', { is_on_secondary: 0 }); // minor-league deal, not on the 40-man
    expect(assignmentContextFor(state(), noEvents, CURRENT)).toBeNull();
    expect(assignmentContextFor(playerState(IDS.starter)!, noEvents, CURRENT)).toBeNull();
  });
});

describe('other assignment context', () => {
  it('DFA and waivers come from the export, with the log adding detail', () => {
    setExport('players_roster_status', { designated_for_assignment: 1, days_on_dfa_left: 6 });
    const bare = assignmentContextFor(state(), [], CURRENT)!;
    expect(bare).toMatchObject({ kind: 'designated_for_assignment', provenance: 'explicit_export', source: 'OOTP CSV export', ordinaryOption: false });
    expect(bare.details.daysLeft).toBe(6);

    const detailed = assignmentContextFor(state(), events([['20300514', tx.dfa(KELLY, 'SP', true)]]), CURRENT)!;
    expect(detailed.details).toMatchObject({ daysLeft: 6, waiverStatus: 'irrevocable_waivers' });
    expect(detailed.since).toBe('2030-05-14');
    expect(detailed.source).toMatch(/CSV export.*transaction log/);
  });

  it('DFA in the export outranks an open rehab in the log', () => {
    setExport('players_roster_status', { designated_for_assignment: 1, days_on_dfa_left: 6 });
    expect(assignmentContextFor(state(), rehabStart(), CURRENT)!.kind).toBe('designated_for_assignment');
  });

  it('waivers are reported from the export', () => {
    setExport('players_roster_status', { is_on_waivers: 1, days_on_waivers_left: 2 });
    expect(assignmentContextFor(state(), [], CURRENT)).toMatchObject({ kind: 'waivers', details: { daysLeft: 2 } });
  });

  it('IL placement is context only while the export has him on the IL', () => {
    setExport('players_roster_status', { is_on_dl: 1 });
    const placed = events([['20300510', tx.ilPlaced(KELLY, 'SP', '05/09/2030')]]);
    expect(assignmentContextFor(state(), placed, CURRENT)).toMatchObject({
      kind: 'injured_list', since: '2030-05-10', details: { days: 15, retroactiveTo: '2030-05-09', sixtyDay: false },
    });
    // Activated in the log and off the IL in the export: nothing to say
    restore.pop()!();
    const activated = [...placed, ...events([['20300520', tx.ilActivated(KELLY, 'SP')]])];
    expect(assignmentContextFor(state(), activated, CURRENT)?.kind).not.toBe('injured_list');
  });

  it('a recall counts only if the export has him in the majors', () => {
    const recalled = events([['20300512', tx.recalled(KELLY, 'SP', RENO)]]);
    expect(assignmentContextFor(state(), recalled, CURRENT)!.kind).toBe('unattributed'); // still at AAA in the export
    setExport('players', { team_id: IDS.mlbTeam });
    setExport('players_roster_status', { is_active: 1 });
    expect(assignmentContextFor(state(), recalled, CURRENT)).toMatchObject({ kind: 'recalled', ordinaryOption: false, exportAgrees: true });
  });

  it('a stale option no longer describes a player who has since moved', () => {
    db.prepare('INSERT INTO teams (team_id, name, nickname, abbr, level, league_id, sub_league_id, division_id, parent_team_id, allstar_team, human_team) VALUES (78, ?, ?, ?, 3, ?, 0, 0, ?, 0, 0)')
      .run('Deeper', 'AA', 'DPR', IDS.league, IDS.mlbTeam);
    restore.push(() => db.prepare('DELETE FROM teams WHERE team_id = 78').run());
    setExport('players', { team_id: 78 });
    const ctx = assignmentContextFor(state(), events([['20300512', tx.optioned(KELLY, 'SP', RENO)]]), CURRENT)!;
    expect(ctx.kind).toBe('unattributed');
    expect(ctx.note).toMatch(/latest option .* no longer matches/);
  });

  it('restricted list is reported from the log alone, since the export has no flag for it', () => {
    const ctx = assignmentContextFor(state(), events([['20300512', tx.restricted(KELLY, 'SP')]]), CURRENT)!;
    expect(ctx).toMatchObject({ kind: 'restricted_list', provenance: 'explicit_log', exportAgrees: null });
  });
});
