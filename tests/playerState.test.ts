import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../server/db.js';
import { allPlayerStates, organizationPlayerStates, playerState, playerStates } from '../server/playerState.js';
import { IDS } from './fixture';

/**
 * Current State reads what OOTP's export says, field by field, and says where
 * each field came from. These pin down that nothing is re-derived from a
 * heuristic or from history when the export states it, and that a field the
 * export does not carry is unknown with a reason, never a guess.
 */

const restore: Array<() => void> = [];
/** Sets columns on a table row for one test and puts the row back afterwards. */
function set(table: string, playerId: number, values: Record<string, number | null>): void {
  const before = db.prepare(`SELECT * FROM ${table} WHERE player_id = ?`).get(playerId) as Record<string, unknown>;
  const cols = Object.keys(values);
  db.prepare(`UPDATE ${table} SET ${cols.map((c) => `"${c}" = ?`).join(', ')} WHERE player_id = ?`)
    .run(...cols.map((c) => values[c]), playerId);
  restore.push(() => {
    const keys = Object.keys(before);
    db.prepare(`UPDATE ${table} SET ${keys.map((c) => `"${c}" = ?`).join(', ')} WHERE player_id = ?`)
      .run(...keys.map((k) => before[k]), playerId);
  });
}
const status = (id: number, values: Record<string, number | null>) => set('players_roster_status', id, values);

afterEach(() => restore.splice(0).reverse().forEach((r) => r()));

describe('current state comes from the export, with provenance', () => {
  it('reads organization, team, level, roster and 40-man straight from their export fields', () => {
    const s = playerState(IDS.optioned)!;
    expect(s.organizationId).toMatchObject({ value: IDS.mlbTeam, provenance: 'explicit_export', source: 'players.organization_id' });
    expect(s.teamId).toMatchObject({ value: IDS.aaaTeam, provenance: 'explicit_export', source: 'players.team_id' });
    expect(s.level).toMatchObject({ value: 2, provenance: 'explicit_export', source: 'teams.level' });
    expect(s.activeRoster).toMatchObject({ value: false, provenance: 'explicit_export', source: 'players_roster_status.is_active' });
    expect(s.fortyMan).toMatchObject({ value: true, provenance: 'explicit_export', source: 'players_roster_status.is_on_secondary' });
    expect(playerState(IDS.starter)!.activeRoster.value).toBe(true);
  });

  it('takes 40-man membership from the export flag, not from a heuristic', () => {
    // The old inference: active OR secondary OR on the MLB injured list.
    // A 60-day-IL player the export leaves off the 40-man is exactly where they differ.
    status(IDS.injured, { is_active: 0, is_on_dl: 1, is_on_dl60: 1, is_on_secondary: 0 });
    const s = playerState(IDS.injured)!;
    expect(s.level.value).toBe(1);
    expect(s.injuredList.onIl60.value).toBe(true);
    expect(s.fortyMan).toMatchObject({ value: false, provenance: 'explicit_export' });

    status(IDS.injured, { is_on_secondary: 1 });
    expect(playerState(IDS.injured)!.fortyMan.value).toBe(true);
  });

  it('preserves DFA state and the DFA countdown, and waivers', () => {
    status(IDS.optioned, { designated_for_assignment: 1, days_on_dfa_left: 7, is_on_waivers: 1, days_on_waivers_left: 3, irrevocable_waivers: 1 });
    const s = playerState(IDS.optioned)!;
    expect(s.dfa.designated).toMatchObject({ value: true, provenance: 'explicit_export' });
    expect(s.dfa.daysLeft).toMatchObject({ value: 7, source: 'players_roster_status.days_on_dfa_left' });
    expect(s.dfa.onWaivers.value).toBe(true);
    expect(s.dfa.waiverDaysLeft.value).toBe(3);
    expect(s.dfa.irrevocableWaivers.value).toBe(true);
    expect(s.standing.value).toMatchObject({ label: 'DFA', daysLeft: 7, available: false });
  });

  it('preserves service time exactly as exported', () => {
    status(IDS.optioned, { mlb_service_years: 3, mlb_service_days: 55, mlb_service_days_this_year: 41, pro_service_years: 6, pro_service_days: 12 });
    const t = playerState(IDS.optioned)!.serviceTime;
    expect(t.mlbYears.value).toBe(3);
    expect(t.mlbDays.value).toBe(55);
    expect(t.mlbDaysThisSeason.value).toBe(41);
    expect(t.professionalYears.value).toBe(6);
    expect(t.professionalDays.value).toBe(12);
    expect(t.mlbYears.provenance).toBe('explicit_export');
  });

  it('preserves option counters and the Rule 5 protection count without reading them as optionability', () => {
    status(IDS.optioned, { options_used: 2, options_used_this_year: 1, years_protected_from_rule_5: 3 });
    const o = playerState(IDS.optioned)!.options;
    expect(o.used).toMatchObject({ value: 2, provenance: 'explicit_export', source: 'players_roster_status.options_used' });
    expect(o.usedThisYear.value).toBe(1);
    expect(o.yearsProtectedFromRule5.value).toBe(3);
    // The state carries counters only; there is no "can be optioned" field to misread
    expect(Object.keys(o).sort()).toEqual(['used', 'usedThisYear', 'yearsProtectedFromRule5']);
  });

  it('reads major- versus minor-league contract from the contract table', () => {
    expect(playerState(IDS.optioned)!.contract.majorLeague).toMatchObject({ value: true, provenance: 'explicit_export', source: 'players_contract.is_major' });
    expect(playerState(IDS.minorDeal)!.contract.majorLeague.value).toBe(false);
  });

  it('keeps a blank export value unknown with its reason instead of filling it in', () => {
    const s = playerState(IDS.optioned)!; // the fixture leaves options_used NULL
    expect(s.options.used).toEqual({
      value: null, provenance: 'unknown', source: 'players_roster_status.options_used',
      reason: 'not_exported_by_ootp', note: 'options_used is blank in the export.',
    });
    // ...and does not pretend it is zero
    expect(s.options.used.value).not.toBe(0);
  });

  it('distinguishes a missing column, a missing table, and a player with no row', () => {
    db.exec('ALTER TABLE players_roster_status RENAME COLUMN was_traded TO was_traded_x');
    restore.push(() => db.exec('ALTER TABLE players_roster_status RENAME COLUMN was_traded_x TO was_traded'));
    expect(playerState(IDS.starter)!.wasTraded).toMatchObject({ value: null, provenance: 'unknown', reason: 'not_exported_by_ootp' });
    restore.pop()!();

    db.prepare('DELETE FROM players_roster_status WHERE player_id = ?').run(IDS.minorDeal);
    const noRow = playerState(IDS.minorDeal)!;
    expect(noRow.fortyMan).toMatchObject({ value: null, reason: 'not_exported_by_ootp' });
    expect(noRow.fortyMan.note).toMatch(/no row for this player/);
    db.prepare('INSERT INTO players_roster_status (player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary) VALUES (?, 0, 0, 0, 0)').run(IDS.minorDeal);

    db.exec('ALTER TABLE players_roster_status RENAME TO players_roster_status_gone');
    try {
      const s = playerState(IDS.starter)!;
      expect(s.fortyMan).toMatchObject({ value: null, provenance: 'unknown', reason: 'source_unavailable' });
      expect(s.activeRoster.reason).toBe('source_unavailable');
      // What the players table still says survives the missing status table
      expect(s.teamId.value).toBe(IDS.mlbTeam);
      expect(s.standing.value).toBeNull();
    } finally {
      db.exec('ALTER TABLE players_roster_status_gone RENAME TO players_roster_status');
    }
  });

  it('only derives display conveniences when every field they read was exported', () => {
    const s = playerState(IDS.starter)!;
    expect(s.standing.provenance).toBe('derived');
    expect(s.standing.value).toMatchObject({ label: 'Active' });
    status(IDS.starter, { designated_for_assignment: null });
    const missing = playerState(IDS.starter)!;
    expect(missing.standing).toMatchObject({ value: null, provenance: 'unknown' });
  });

  it('serves single players, batches, organizations, and the whole league consistently', () => {
    const one = playerState(IDS.optioned)!;
    expect(playerStates([IDS.optioned, IDS.starter]).get(IDS.optioned)).toEqual(one);
    expect(organizationPlayerStates(IDS.mlbTeam).some((p) => p.playerId === IDS.optioned)).toBe(true);
    expect(allPlayerStates().find((p) => p.playerId === IDS.optioned)).toEqual(one);
    expect(playerState(999_999)).toBeNull();
  });
});

describe('the state layer never reaches for history or snapshots', () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), 'server', f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('does not import roster-state history or the transaction log', () => {
    for (const f of ['playerState.ts', 'transactionLog.ts', 'assignmentContext.ts', 'dataFreshness.ts']) {
      expect(read(f), f).not.toMatch(/rosterStateHistory|roster_state_snapshot|history\.js/);
    }
    expect(read('playerState.ts')).not.toMatch(/transactionLog|liveLogSnapshot/);
  });

  it('never opens the live database in place: only the snapshot module knows how to read it', () => {
    for (const f of ['playerState.ts', 'transactionLog.ts', 'dataStatus.ts', 'assignmentContext.ts', 'playerContext.ts']) {
      expect(read(f), f).not.toMatch(/new Database\(/);
    }
    expect(read('liveLogSnapshot.ts')).toMatch(/readonly: true/);
  });
});
