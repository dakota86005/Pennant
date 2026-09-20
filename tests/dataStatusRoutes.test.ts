import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { DATA_DIR, saveConfig } from '../server/config.js';
import { resetTransactionLogCache } from '../server/dataStatus.js';
import request, { post } from './request';
import { IDS } from './fixture';
import { fingerprint, makeSave, tx, type FakeSave, type LogRow } from './liveLogFixture';

/**
 * End to end: the app is pointed at nothing but a CSV export folder, as it is
 * in normal use, and must find the save and its live log by itself.
 * The fixture league's current_date is 2030-06-01, so its export reflects 5/31.
 */

const KELLY: [number, string] = [IDS.optioned, 'Merrill Kelly'];
const rehabRows = (): LogRow[] => [
  { date: '20300512', teamId: IDS.mlbTeam, text: tx.rehabSent(KELLY, 'SP', [IDS.aaaTeam, 'Reno']) },
  { date: '20300512', teamId: IDS.aaaTeam, text: tx.rehabReceived(KELLY, 'SP', [IDS.mlbTeam, 'Arizona']) },
  { date: '20300531', teamId: IDS.mlbTeam, text: tx.released([777, 'Someone Else'], 'RP') },
];

const saves: FakeSave[] = [];
function useSave(opts: Parameters<typeof makeSave>[0] = {}): FakeSave {
  const s = makeSave({ rows: rehabRows(), ...opts });
  saves.push(s);
  saveConfig({ csvDir: s.csvDir, saveName: null });
  resetTransactionLogCache();
  return s;
}

const restore: Array<() => void> = [];
function setStatus(id: number, values: Record<string, number | null>) {
  const before = db.prepare('SELECT * FROM players_roster_status WHERE player_id = ?').get(id) as Record<string, unknown>;
  const cols = Object.keys(values);
  db.prepare(`UPDATE players_roster_status SET ${cols.map((c) => `"${c}" = ?`).join(', ')} WHERE player_id = ?`).run(...cols.map((c) => values[c]), id);
  restore.push(() => {
    const keys = Object.keys(before);
    db.prepare(`UPDATE players_roster_status SET ${keys.map((c) => `"${c}" = ?`).join(', ')} WHERE player_id = ?`).run(...keys.map((k) => before[k]), id);
  });
}

beforeEach(() => resetTransactionLogCache());
afterEach(() => {
  restore.splice(0).reverse().forEach((r) => r());
  saves.splice(0).forEach((s) => s.cleanup());
  resetTransactionLogCache();
});
afterAll(() => fs.rmSync(path.join(DATA_DIR, 'config.json'), { force: true }));

describe('GET /api/data-status', () => {
  it('finds the save and its live log from the export path alone: current', async () => {
    const s = useSave();
    const st = await request('/api/data-status');
    expect(st.save).toMatchObject({ found: true, discovery: 'csv_layout', lgPath: s.lg, simulatedThrough: '2030-05-31', dateSource: 'last_date_simulated.dat' });
    expect(st.csv).toMatchObject({ currentDate: '2030-06-01', simulatedThrough: '2030-05-31' });
    expect(st.transactionLog).toMatchObject({ found: true, readable: true, error: null });
    expect(st.transactionLog.coverage.coveredThrough).toBe('2030-05-31');
    expect(st.freshness).toMatchObject({ level: 'current', headline: 'Current', action: null });
  });

  it('partial: the log is one day behind the save while the export is current', async () => {
    // Save and export both at 5/31; OOTP has written its log only through 5/30
    useSave({ rows: [{ date: '20300530', teamId: IDS.mlbTeam, text: tx.released([777, 'Someone Else'], 'RP') }] });
    const st = await request('/api/data-status');
    expect(st.freshness.csv.state).toBe('current');
    expect(st.freshness.log).toMatchObject({ state: 'behind', lagDays: 1, through: '2030-05-30' });
    expect(st.freshness).toMatchObject({ level: 'partial', headline: 'Partial — transaction log 1 day behind', action: null });
  });

  it('stale: the export is behind the save', async () => {
    useSave({ simulated: [2030, 6, 3] });
    const st = await request('/api/data-status');
    expect(st.freshness.level).toBe('stale');
    expect(st.freshness.action).toMatch(/Export fresh database data/);
  });

  it('partial, not stale, when only the transaction log is missing', async () => {
    useSave({ withLog: false });
    const st = await request('/api/data-status');
    expect(st.save.found).toBe(true);
    expect(st.transactionLog).toMatchObject({ found: false, readable: false, unavailableReason: 'database_missing' });
    expect(st.freshness).toMatchObject({ level: 'partial', headline: 'Partial — transaction log unavailable', action: null });
    expect(st.freshness.csv.state).toBe('current');
  });

  it('falls back to CSV-only when no .lg can be found, and reports that plainly', async () => {
    const elsewhere = fs.mkdtempSync(path.join(DATA_DIR, 'no-save-'));
    saveConfig({ csvDir: path.join(elsewhere, 'csv'), saveName: null });
    resetTransactionLogCache();
    const st = await request('/api/data-status');
    expect(st.save).toMatchObject({ found: false, discovery: 'not_found', lgPath: null, simulatedThrough: null });
    expect(st.transactionLog).toMatchObject({ found: false, readable: false, unavailableReason: 'save_not_found' });
    expect(st.freshness.level).toBe('partial');
    expect(st.freshness.reasons.join(' ')).toMatch(/save folder could not be found/);
    // The rest of the app is unaffected
    const roster = await request(`/api/roster/${IDS.mlbTeam}`);
    expect(roster.players.length).toBeGreaterThan(0);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });

  it('a manual folder is a fallback only, and clearing it returns to automatic', async () => {
    const s = makeSave({ rows: rehabRows() });
    saves.push(s);
    const elsewhere = fs.mkdtempSync(path.join(DATA_DIR, 'no-save-'));
    saveConfig({ csvDir: path.join(elsewhere, 'csv'), saveName: null });
    resetTransactionLogCache();

    expect((await request('/api/data-status')).save.found).toBe(false);
    const set = await post('/api/save-source', { lgPath: s.lg });
    expect(set.status.save).toMatchObject({ found: true, discovery: 'manual_override', lgPath: s.lg });
    const cleared = await post('/api/save-source', { lgPath: '' });
    expect(cleared.status.save.found).toBe(false);
    await expect(post('/api/save-source', { lgPath: elsewhere })).rejects.toThrow(/400/);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });

  it('picks up OOTP writing to the log without a restart', async () => {
    const s = useSave({ keepWriterOpen: true });
    expect((await request('/api/data-status')).transactionLog.counts.events).toBe(3);
    s.add([{ date: '20300531', teamId: 9, text: tx.released([888, 'Another'], 'RP') }]);
    expect((await request('/api/data-status')).transactionLog.counts.events).toBe(4);
  });

  it('never writes to the save: reading status, rosters and players leaves it byte-identical', async () => {
    const s = useSave({ keepWriterOpen: true });
    s.add([{ date: '20300531', teamId: 9, text: tx.released([888, 'Another'], 'RP') }]); // frames in the WAL
    const before = fingerprint(s.root);
    await request('/api/data-status');
    await request(`/api/roster/${IDS.aaaTeam}`);
    await request(`/api/roster-crunch/${IDS.mlbTeam}`);
    await request(`/api/player/${IDS.optioned}`);
    await request(`/api/player-state/${IDS.optioned}`);
    expect(fingerprint(s.root)).toEqual(before);
  });
});

describe('rehab reaches the pages that used to mistake it for an option', () => {
  it('roster rows carry the assignment context', async () => {
    useSave();
    const { players } = await request(`/api/roster/${IDS.aaaTeam}`);
    const kelly = players.find((p: { player_id: number }) => p.player_id === IDS.optioned);
    expect(kelly.assignment).toMatchObject({
      kind: 'rehab_assignment', label: 'Rehab assignment', since: '2030-05-12', sinceLabel: 'Sent on rehab',
      source: 'OOTP transaction log', ordinaryOption: false, provenance: 'explicit_log',
    });
    // Players with nothing notable carry nothing
    const majors = await request(`/api/roster/${IDS.mlbTeam}`);
    expect(majors.players.find((p: { player_id: number }) => p.player_id === IDS.starter).assignment).toBeNull();
  });

  it('the player card carries it too', async () => {
    useSave();
    const card = await request(`/api/player/${IDS.optioned}`);
    expect(card.assignment).toMatchObject({ kind: 'rehab_assignment', since: '2030-05-12' });
  });

  it('roster crunch does not give a rehab player option-year warnings, but does for a real option', async () => {
    setStatus(IDS.optioned, { options_used: 3, options_used_this_year: 0 });
    useSave();
    let crunch = await request(`/api/roster-crunch/${IDS.mlbTeam}`);
    let kelly = crunch.fortyMan.find((p: { player_id: number }) => p.player_id === IDS.optioned);
    expect(kelly.assignment.kind).toBe('rehab_assignment');
    expect(kelly.issues).not.toContain('out of options');
    expect(kelly.optionsUsed).toBe(3); // the counter itself is still shown, as exported

    // The same export, but the log says he was optioned
    saves.splice(0).forEach((x) => x.cleanup());
    useSave({ rows: [{ date: '20300512', teamId: IDS.mlbTeam, text: tx.optioned(KELLY, 'SP', [IDS.aaaTeam, 'Reno']) }] });
    crunch = await request(`/api/roster-crunch/${IDS.mlbTeam}`);
    kelly = crunch.fortyMan.find((p: { player_id: number }) => p.player_id === IDS.optioned);
    expect(kelly.assignment).toMatchObject({ kind: 'optioned', ordinaryOption: true });
    expect(kelly.issues).toContain('out of options');
  });

  it('does not call a player out of options when the export does not say whether this season charged one', async () => {
    setStatus(IDS.optioned, { options_used: 3, options_used_this_year: null });
    useSave({ rows: [{ date: '20300512', teamId: IDS.mlbTeam, text: tx.optioned(KELLY, 'SP', [IDS.aaaTeam, 'Reno']) }] });
    const crunch = await request(`/api/roster-crunch/${IDS.mlbTeam}`);
    const kelly = crunch.fortyMan.find((p: { player_id: number }) => p.player_id === IDS.optioned);
    expect(kelly.issues).not.toContain('out of options');
    expect(kelly.rights.optionYears.standing).toBe('indeterminate');
  });

  it('with no log, a 40-man minor leaguer is reported as not established, never as optioned', async () => {
    useSave({ withLog: false });
    const crunch = await request(`/api/roster-crunch/${IDS.mlbTeam}`);
    const kelly = crunch.fortyMan.find((p: { player_id: number }) => p.player_id === IDS.optioned);
    expect(kelly.assignment).toMatchObject({ kind: 'unattributed', reason: 'source_unavailable', ordinaryOption: null, provenance: 'unknown' });
    const picture = await request(`/api/player-state/${IDS.optioned}`);
    expect(picture.assignment.reason).toBe('source_unavailable');
    expect(picture.chronology).toEqual([]);
    expect(picture.chronologyNote).toMatch(/unavailable/);
  });

  it('the 40-man count is the export count: an IL-60 player it leaves off is not counted', async () => {
    useSave();
    setStatus(IDS.injured, { is_active: 0, is_on_dl: 1, is_on_dl60: 1, is_on_secondary: 0 });
    const crunch = await request(`/api/roster-crunch/${IDS.mlbTeam}`);
    const exported = (db.prepare(
      `SELECT COUNT(*) AS n FROM players p JOIN players_roster_status rs ON rs.player_id = p.player_id
       WHERE p.organization_id = ? AND p.retired = 0 AND rs.is_on_secondary = 1`
    ).get(IDS.mlbTeam) as { n: number }).n;
    expect(crunch.counts.fortyMan).toBe(exported);
    expect(crunch.fortyMan.some((p: { player_id: number }) => p.player_id === IDS.injured)).toBe(false);
  });
});

describe('GET /api/player-state/:id', () => {
  it('returns state, assignment context and explicit chronology together but separate', async () => {
    useSave();
    const pic = await request(`/api/player-state/${IDS.optioned}`);
    expect(pic.state.fortyMan).toMatchObject({ value: true, provenance: 'explicit_export' });
    expect(pic.assignment.kind).toBe('rehab_assignment');
    expect(pic.chronology.map((e: { kind: string }) => e.kind)).toEqual(['rehab_received', 'rehab_assigned']); // newest first
    expect(pic.chronology[0]).toMatchObject({ provenance: 'explicit_log', playerId: IDS.optioned });
    expect(pic.freshness.level).toBe('current');
    expect(pic.chronologyNote).toBeNull();
  });

  it('states that a behind log may be missing recent moves', async () => {
    useSave({ simulated: [2030, 6, 2] });
    const pic = await request(`/api/player-state/${IDS.optioned}`);
    expect(pic.chronologyNote).toMatch(/behind the save/);
  });

  it('404s for an unknown player', async () => {
    useSave();
    await expect(request('/api/player-state/999999')).rejects.toThrow(/404/);
  });
});
