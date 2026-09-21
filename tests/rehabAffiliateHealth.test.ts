import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DATA_DIR, saveConfig } from '../server/config.js';
import { resetTransactionLogCache } from '../server/dataStatus.js';
import { db } from '../server/db.js';
import { farmConsequence } from '../server/mlbEvidence.js';
import { computeMinorLeagueRosterHealth } from '../server/minorLeagueRoster.js';
import { computeFarmSystem } from '../server/farmOperations.js';
import { IDS } from './fixture';
import { makeSave, tx, type FakeSave, type LogRow } from './liveLogFixture';

/*
 * Regression: a parent-club player on an injury-rehab assignment looks exactly
 * like an optioned player in the export, and was counted as an ordinary member
 * of the affiliate's roster health and pitching staff. Only the explicit log
 * tells them apart (D-020), so: excluded when the log establishes it, counted
 * and named as ambiguous when nothing explains him, and counted plainly when
 * the log shows an ordinary option.
 */

const KELLY: [number, string] = [IDS.optioned, 'Merrill Kelly'];
const saves: FakeSave[] = [];

function useSave(rows: LogRow[] | null): void {
  const s = makeSave({ rows: rows ?? [], withLog: rows !== null });
  saves.push(s);
  saveConfig({ csvDir: s.csvDir, saveName: null });
  resetTransactionLogCache();
}

const listRows: Array<[number, number, number]> = [];
let original: { position: number; role: number; team_id: number } | null = null;
beforeEach(() => {
  original = db.prepare('SELECT position, role, team_id FROM players WHERE player_id = ?').get(IDS.optioned) as typeof original;
  // The fixture has no Triple-A active list; give the affiliate the optioned player as a starter beside another.
  const roster = db.prepare('INSERT INTO team_roster VALUES (?, ?, 2)');
  for (const id of [IDS.optioned]) {
    roster.run(IDS.aaaTeam, id);
    listRows.push([IDS.aaaTeam, id, 2]);
  }
  db.prepare('UPDATE players SET position = 1, role = 11, team_id = ? WHERE player_id = ?').run(IDS.aaaTeam, IDS.optioned);
  resetTransactionLogCache();
});
afterEach(() => {
  if (original) db.prepare('UPDATE players SET position = ?, role = ?, team_id = ? WHERE player_id = ?').run(original.position, original.role, original.team_id, IDS.optioned);
  for (const [team, id, list] of listRows.splice(0)) db.prepare('DELETE FROM team_roster WHERE team_id = ? AND player_id = ? AND list_id = ?').run(team, id, list);
  saves.splice(0).forEach((s) => s.cleanup());
  resetTransactionLogCache();
});
afterAll(() => fs.rmSync(path.join(DATA_DIR, 'config.json'), { force: true }));

const affiliate = () => computeMinorLeagueRosterHealth(IDS.mlbTeam).find((t) => t.teamId === IDS.aaaTeam)!;
const rehabRows = (): LogRow[] => [
  { date: '20300512', teamId: IDS.mlbTeam, text: tx.rehabSent(KELLY, 'SP', [IDS.aaaTeam, 'Reno']) },
  { date: '20300512', teamId: IDS.aaaTeam, text: tx.rehabReceived(KELLY, 'SP', [IDS.mlbTeam, 'Arizona']) },
  { date: '20300531', teamId: IDS.mlbTeam, text: tx.released([777, 'Someone Else'], 'RP') },
];

describe('rehab assignees and affiliate roster health', () => {
  it('excludes a player the log shows on a rehab assignment from roster health and the pitching staff', () => {
    useSave(rehabRows());
    const h = affiliate();
    expect(h.rosterTreatment.rehab).toEqual([{ playerId: IDS.optioned, name: expect.any(String) }]);
    expect(h.pitching.starters).toBe(0);
    expect(h.roster.pitchers).toBe(0);
    const farm = computeFarmSystem(IDS.mlbTeam);
    const club = farm.affiliates.find((a) => a.teamId === IDS.aaaTeam)!;
    expect(club.rosterTreatment.rehab.map((p) => p.playerId)).toContain(IDS.optioned);
    expect(farm.organization.scope.rehab).toBeGreaterThanOrEqual(1);
  });

  it('does not let a rehab assignee prop up the rotation: removing him changes nothing, and adding him is not free', () => {
    useSave(rehabRows());
    const before = affiliate();
    const without = computeMinorLeagueRosterHealth(IDS.mlbTeam, { removePlayerIds: [IDS.optioned], onlyTeamIds: [IDS.aaaTeam] })[0];
    expect(without.roster.total).toBe(before.roster.total);
    expect(without.pitching.starters).toBe(before.pitching.starters);
  });

  it('counts an ordinarily optioned player as a member of the club', () => {
    useSave([
      { date: '20300520', teamId: IDS.mlbTeam, text: tx.optioned(KELLY, 'SP', [IDS.aaaTeam, 'Reno']) },
      { date: '20300531', teamId: IDS.mlbTeam, text: tx.released([777, 'Someone Else'], 'RP') },
    ]);
    const h = affiliate();
    expect(h.pitching.starters).toBe(1);
    expect(h.rosterTreatment).toEqual({ rehab: [], ambiguous: [], injured: [] });
  });

  it('with no log he may be on rehab or optioned: counted, and named as ambiguous rather than assumed', () => {
    useSave(null);
    const h = affiliate();
    expect(h.pitching.starters).toBe(1);
    expect(h.rosterTreatment.rehab).toEqual([]);
    expect(h.rosterTreatment.ambiguous).toEqual([
      expect.objectContaining({ playerId: IDS.optioned, reason: expect.stringMatching(/./) }),
    ]);
  });

  it('tells the GM, in the consequence of recalling him, that a rehab assignee changes nothing below', () => {
    useSave(rehabRows());
    const c = farmConsequence(IDS.mlbTeam, IDS.optioned, { kind: 'starting_pitcher', label: 'starting pitcher', position: 1 }, 'leaves', IDS.aaaTeam)!;
    expect(c.rosterNotes.join(' ')).toMatch(/rehab assignment, so this club does not count him/);
    // Not counted before, not counted after: the rotation line does not move
    const rotation = c.changes.find((x) => x.label === 'Rotation')!;
    expect(rotation.before).toBe(rotation.after);
    expect(c.overall.before).toBe(c.overall.after);
    expect(c.farm?.affiliateImpact?.absorbed).toBe(true);
  });

  it('and, when nothing explains him, that the consequence may be overstated', () => {
    useSave(null);
    const c = farmConsequence(IDS.mlbTeam, IDS.optioned, { kind: 'starting_pitcher', label: 'starting pitcher', position: 1 }, 'leaves', IDS.aaaTeam)!;
    expect(c.rosterNotes.join(' ')).toMatch(/Nothing establishes whether he is on a rehab assignment or was optioned/);
  });
});
