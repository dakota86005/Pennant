import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DATA_DIR, saveConfig } from '../server/config.js';
import { db, forgetImportRecord, LAST_IMPORT_PATH } from '../server/db.js';
import { getDataStatus } from '../server/dataStatus.js';
import { developmentTrendByPlayer, historyDb, snapshotDates, stampSnapshotMode, takeSnapshot } from '../server/history.js';
import {
  CONTINUITY_POLICY,
  continuityOf,
  currentHistoryKey,
  decideLegacyDate,
  forgetHistoryKey,
  historyIdentityDeps,
  historyNote,
  historySave,
  legacyBackupPath,
  servedSave,
} from '../server/historyIdentity.js';
import { describeSave, type SaveInfo } from '../server/paths.js';
import { dataStatusView } from '../server/presentation/dataStatusWords.js';
import { captureRosterStateSnapshot } from '../server/rosterStateHistory.js';
import { loadScoutedObservations } from '../server/scoutedEvidence.js';
import { BANNED_JARGON } from './bannedJargon';
import { IDS } from './fixture';
import request from './request';

/**
 * Rating history belongs to a save, not to a save's name (D-064, BEHAVIOR_CASES "Rating history belongs to the save").
 * OOTP names every new league "New Game", so two saves of one name are ordinary; neither may read the other's ratings
 * as development, and history filed under the name before each save had a key of its own is used only where it is
 * certainly that save's.
 */

const EXTRA_FROM = 960_000;
const EXTRA = 30;
const LEAGUE_DATE = '2030-06-01';

let root: string;
const folders: Record<string, { lgPath: string; csvDir: string }> = {};

function saveFolder(label: string, name: string): { lgPath: string; csvDir: string } {
  const lgPath = path.join(root, label, `${name}.lg`);
  const csvDir = path.join(lgPath, 'import_export', 'csv');
  fs.mkdirSync(csvDir, { recursive: true });
  folders[label] = { lgPath, csvDir };
  return folders[label];
}

/** Choose a save the way the app does (its export folder and name), and forget the key resolved for the last one. */
function useSave(csvDir: string | null, name: string | null): void {
  saveConfig({ csvDir, saveName: name });
  forgetHistoryKey();
}

/** The league's players, id and name, as a snapshot files them. */
const leaguePlayers = (): Array<{ player_id: number; name: string }> =>
  db.prepare(`SELECT player_id, first_name || ' ' || last_name AS name FROM players ORDER BY player_id`).all() as Array<{ player_id: number; name: string }>;

/** A snapshot row filed under the save's NAME, as every build before D-064 wrote one. */
function legacyRow(saveName: string, date: string, playerId: number, name: string, cur: number): void {
  historyDb.prepare(
    `INSERT OR REPLACE INTO rating_snapshots (save_name, game_date, player_id, name, team_id, org_id, level, position, age, cur, pot, con, gap, pow, eye, avk)
     VALUES (?, ?, ?, ?, ?, ?, 1, 6, 25, ?, 60, ?, ?, ?, ?, ?)`
  ).run(saveName, date, playerId, name, IDS.mlbTeam, IDS.mlbTeam, cur, cur, cur, cur, cur, cur);
}

const legacyFingerprint = (): string => JSON.stringify(historyDb.prepare(`SELECT * FROM rating_snapshots ORDER BY save_name, game_date, player_id`).all());

const clearKeyed = (): void => {
  for (const table of ['save_rating_snapshots', 'save_rating_snapshot_modes', 'history_saves', 'history_legacy_review', 'history_identity_meta', 'roster_state_snapshot_saves', 'rating_snapshots', 'rating_snapshot_modes']) {
    historyDb.exec(`DELETE FROM ${table}`);
  }
};

const knownSaves: SaveInfo[] = [];

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-history-key-'));
  // Enough players that a comparison of two sets of players is evidence (CONTINUITY_POLICY.minCompared)
  const insert = db.prepare(`INSERT INTO players (player_id, first_name, last_name, age, position, team_id, organization_id, retired) VALUES (?, ?, ?, 24, 6, ?, ?, 0)`);
  for (let i = 0; i < EXTRA; i += 1) insert.run(EXTRA_FROM + i, 'Depth', `Player${i}`, IDS.mlbTeam, IDS.mlbTeam);
  historyIdentityDeps.knownSaves = () => knownSaves;
});

afterAll(() => {
  db.prepare(`DELETE FROM players WHERE player_id >= ? AND player_id < ?`).run(EXTRA_FROM, EXTRA_FROM + EXTRA);
  clearKeyed();
  useSave(null, null);
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  clearKeyed();
  knownSaves.length = 0;
  historyIdentityDeps.folderExists = (p) => fs.existsSync(p);
  historyIdentityDeps.beforeLegacyDate = () => {};
  fs.rmSync(path.join(DATA_DIR, 'backups'), { recursive: true, force: true });
});

afterEach(() => {
  useSave(null, null);
});

describe('what counts as the same league', () => {
  const names = new Map(Array.from({ length: 2000 }, (_, i) => [i, `Player ${i}`] as const));
  const rows = (matching: number, total: number) =>
    Array.from({ length: total }, (_, i) => ({ player_id: i, name: i < matching ? `Player ${i}` : `Someone Else ${i}` }));

  it('is the same league only when all but one shared player in a thousand has the same name, a hair either side of the line', () => {
    expect(continuityOf(rows(1998, 2000), names).verdict).toBe('same'); // 0.999
    expect(continuityOf(rows(1997, 2000), names).verdict).toBe('unclear'); // 0.9985
  });

  it('tells apart two saves of one real-life database by the players each generated (measured 99.2% to 99.8% alike)', () => {
    expect(continuityOf(rows(1996, 2000), names).verdict).toBe('unclear'); // 99.8%
    expect(continuityOf(rows(1984, 2000), names).verdict).toBe('unclear'); // 99.2%
  });

  it('is a different league when most shared players have other names, a hair either side of the line', () => {
    expect(continuityOf(rows(19, 40), names).verdict).toBe('different'); // 0.475
    expect(continuityOf(rows(20, 40), names).verdict).toBe('unclear'); // 0.5
  });

  it('is no evidence either way when too few players are shared, never a match', () => {
    const few = rows(CONTINUITY_POLICY.minCompared - 1, CONTINUITY_POLICY.minCompared - 1);
    expect(continuityOf(few, names)).toMatchObject({ verdict: 'no_evidence', matched: CONTINUITY_POLICY.minCompared - 1 });
    expect(continuityOf(rows(40, 40), null).verdict).toBe('no_evidence');
    // A player the league no longer has is not evidence either way
    expect(continuityOf([...rows(30, 30), ...Array.from({ length: 50 }, (_, i) => ({ player_id: 5000 + i, name: 'Gone' }))], names)).toMatchObject({ verdict: 'same', compared: 30 });
  });
});

describe('earlier history filed under a name is used only where it is certainly the save\'s', () => {
  const names = new Map(Array.from({ length: 30 }, (_, i) => [i, `Player ${i}`] as const));
  const ours = Array.from({ length: 30 }, (_, i) => ({ player_id: i, name: `Player ${i}` }));
  const theirs = Array.from({ length: 30 }, (_, i) => ({ player_id: i, name: `Other ${i}` }));
  const decide = (over: Partial<Parameters<typeof decideLegacyDate>[0]>) =>
    decideLegacyDate({ date: '2030-4-1', rows: ours, names, leagueDate: '2030-06-01', twins: () => [], ...over });

  it('brings over a date whose rows have this league\'s players, and only those rows', () => {
    // A thousand and one players, one of them since renamed by the GM, and one no longer in the league
    const many = new Map(Array.from({ length: 1001 }, (_, i) => [i, `Player ${i}`] as const));
    const rows = [...Array.from({ length: 1000 }, (_, i) => ({ player_id: i + 1, name: `Player ${i + 1}` })), { player_id: 0, name: 'Renamed' }, { player_id: 5000, name: 'Not In League' }];
    const d = decide({ rows, names: many });
    expect(d).toMatchObject({ verdict: 'attributed', reason: 'matched' });
    expect(d.playerIds).not.toContain(0);
    expect(d.playerIds).not.toContain(5000);
    expect(d.playerIds).toHaveLength(1000);
  });

  it('keeps apart a date with another league\'s players, and leaves unused one it cannot tell', () => {
    expect(decide({ rows: theirs })).toMatchObject({ verdict: 'another_save', playerIds: [] });
    expect(decide({ rows: [...ours.slice(0, 20), ...theirs.slice(20)] })).toMatchObject({ verdict: 'unattributed', reason: 'unclear', playerIds: [] });
    expect(decide({ rows: ours.slice(0, 5) })).toMatchObject({ verdict: 'unattributed', reason: 'no_evidence' });
  });

  it('never takes a date later than the league\'s own date as the save\'s past', () => {
    expect(decide({ date: '2030-6-2' })).toMatchObject({ verdict: 'unattributed', reason: 'after_league_date' });
    expect(decide({ date: '2030-6-1' }).verdict).toBe('attributed');
  });

  it('leaves unused a date another save of the same name could have written, or couldn\'t be checked against', () => {
    expect(decide({ twins: () => [names] })).toMatchObject({ verdict: 'unattributed', reason: 'twin_matches' });
    expect(decide({ twins: () => [null] })).toMatchObject({ verdict: 'unattributed', reason: 'twin_unreadable' });
    const other = new Map(theirs.map((r) => [r.player_id, r.name] as const));
    expect(decide({ twins: () => [other] }).verdict).toBe('attributed');
  });
});

describe('two saves that share a name', () => {
  it('have two histories: a snapshot of one is never read as the other\'s, even on the same date', async () => {
    const a = saveFolder('mac-app-store', 'New Game');
    const b = saveFolder('application-support', 'New Game');
    useSave(a.csvDir, 'New Game');
    const keyA = currentHistoryKey();
    expect(takeSnapshot()?.gameDate).toBe(LEAGUE_DATE);

    useSave(b.csvDir, 'New Game');
    const keyB = currentHistoryKey();
    expect(keyB).not.toBe(keyA);
    // B has never been imported: no history, whatever A has
    expect(snapshotDates()).toEqual([]);
    expect(developmentTrendByPlayer().size).toBe(0);
    expect(loadScoutedObservations([IDS.starter]).get(IDS.starter) ?? []).toEqual([]);
    expect((await request(`/api/development-history/${IDS.mlbTeam}`)).rows).toEqual([]);

    // B's snapshot of the same date, with a rating moved, leaves A's exactly as it was
    const before = historyDb.prepare(`SELECT con FROM save_rating_snapshots WHERE save_key = ? AND player_id = ?`).get(keyA, IDS.starter) as { con: number };
    db.prepare(`UPDATE players_batting SET batting_ratings_overall_contact = batting_ratings_overall_contact + 7 WHERE player_id = ?`).run(IDS.starter);
    try {
      takeSnapshot();
    } finally {
      db.prepare(`UPDATE players_batting SET batting_ratings_overall_contact = batting_ratings_overall_contact - 7 WHERE player_id = ?`).run(IDS.starter);
    }
    expect(historyDb.prepare(`SELECT con FROM save_rating_snapshots WHERE save_key = ? AND player_id = ?`).get(keyA, IDS.starter)).toEqual(before);
    expect((historyDb.prepare(`SELECT con FROM save_rating_snapshots WHERE save_key = ? AND player_id = ?`).get(keyB, IDS.starter) as { con: number }).con).toBe(before.con + 7);

    // Back to A: its own history, one snapshot, no change read from B's
    useSave(a.csvDir, 'New Game');
    expect(currentHistoryKey()).toBe(keyA);
    expect(snapshotDates()).toEqual([LEAGUE_DATE]);
    const changes = await request(`/api/development/${IDS.mlbTeam}`);
    expect(changes.snapshots).toBe(1);
  });

  it('keep the history of a save across restarts and re-imports', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    takeSnapshot();
    forgetHistoryKey(); // a restart, or a re-import of the same save
    expect(currentHistoryKey()).toBe(key);
    expect(historySave(key)).toMatchObject({ origin: 'new', bound: true, saveName: 'New Game' });
  });

  it('never compare their roster states with each other', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    const b = saveFolder('application-support', 'New Game');
    useSave(a.csvDir, 'New Game');
    expect(captureRosterStateSnapshot({ log: null }).status).toBe('created');
    useSave(b.csvDir, 'New Game');
    // The first snapshot of B: nothing earlier of B's to compare with, so no change is observed
    const first = captureRosterStateSnapshot({ log: null });
    expect(first.status).toBe('created');
    expect(first.events).toEqual([]);
  });
});

describe('a save that moves, or a folder that holds a new league', () => {
  it('follows a save moved or renamed in OOTP when exactly one earlier history\'s folder has gone and has its players', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    takeSnapshot();
    const renamed = path.join(root, 'mac-app-store', 'Renamed.lg');
    fs.renameSync(a.lgPath, renamed);
    try {
      useSave(path.join(renamed, 'import_export', 'csv'), 'Renamed');
      expect(currentHistoryKey()).toBe(key);
      expect(historySave(key)).toMatchObject({ origin: 'moved', saveName: 'Renamed' });
      expect(snapshotDates()).toEqual([LEAGUE_DATE]);
    } finally {
      fs.renameSync(renamed, a.lgPath);
    }
  });

  it('never follows a history dated later than the league: a save doesn\'t go back in time', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    const b = saveFolder('elsewhere', 'Another');
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    takeSnapshot();
    historyDb.prepare(`UPDATE save_rating_snapshots SET game_date = '2031-1-1' WHERE save_key = ?`).run(key);
    historyIdentityDeps.folderExists = (p) => !p.startsWith(path.join(root, 'mac-app-store'));
    useSave(b.csvDir, 'Another');
    expect(currentHistoryKey()).not.toBe(key);
    expect(historySave(currentHistoryKey())?.origin).toBe('new');
  });

  it('reads the history of the save whose league is served, not of a save chosen but not yet imported', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    const b = saveFolder('application-support', 'New Game');
    const startedAt = '2040-07-01T12:00:00.000Z';
    db.exec('CREATE TABLE IF NOT EXISTS pennant_import (key TEXT PRIMARY KEY, value TEXT)');
    db.prepare(`INSERT OR REPLACE INTO pennant_import (key, value) VALUES ('import', ?)`).run(JSON.stringify({ startedAt, csvDir: a.csvDir }));
    fs.writeFileSync(LAST_IMPORT_PATH, JSON.stringify({ tables: 0, rows: 0, startedAt, finishedAt: startedAt, files: [] }));
    forgetImportRecord();
    try {
      useSave(b.csvDir, 'New Game');
      expect(servedSave()).toMatchObject({ folderPath: a.lgPath, name: 'New Game' });
    } finally {
      db.prepare(`DELETE FROM pennant_import WHERE key = 'import'`).run();
      fs.rmSync(LAST_IMPORT_PATH, { force: true });
      forgetImportRecord();
    }
  });

  it('starts a copy of a save fresh while the original is still there, and says nothing is lost', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    const copy = saveFolder('copies', 'New Game copy');
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    takeSnapshot();
    useSave(copy.csvDir, 'New Game copy');
    expect(currentHistoryKey()).not.toBe(key);
    expect(snapshotDates()).toEqual([]);
    expect(historyNote().note).toBeNull();
  });

  it('starts fresh, and says so, when more than one gone history could be this save', () => {
    const a = saveFolder('one', 'New Game');
    const b = saveFolder('two', 'New Game');
    const c = saveFolder('three', 'New Game');
    for (const f of [a, b]) {
      useSave(f.csvDir, 'New Game');
      currentHistoryKey();
      takeSnapshot();
    }
    historyIdentityDeps.folderExists = (p) => !p.startsWith(path.join(root, 'one')) && !p.startsWith(path.join(root, 'two'));
    useSave(c.csvDir, 'New Game');
    const key = currentHistoryKey();
    expect(historySave(key)?.origin).toBe('fresh_moved_unclear');
    expect(snapshotDates()).toEqual([]);
    expect(historyNote().note).toMatch(/starts fresh/);
  });

  it('starts fresh, and says so, when the folder now holds a league with other players', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    takeSnapshot();
    // A new league made under the same name in the same folder: the same ids, other people
    db.exec(`UPDATE players SET first_name = 'New' || first_name`);
    try {
      forgetHistoryKey();
      const fresh = currentHistoryKey();
      expect(fresh).not.toBe(key);
      expect(historySave(key)?.bound).toBe(false);
      expect(historySave(fresh)?.origin).toBe('fresh_new_league');
      expect(snapshotDates()).toEqual([]);
      expect(historyNote().note).toMatch(/starts fresh/);
    } finally {
      db.exec(`UPDATE players SET first_name = substr(first_name, 4) WHERE first_name LIKE 'New%'`);
    }
  });
});

describe('the history filed under a name before D-064', () => {
  /** A save's legacy history: dates of its own players, one of another league's, one mixed, one past the league's date. */
  function writeLegacy(name: string): void {
    const players = leaguePlayers();
    for (const [date, cur] of [['2030-4-1', 40], ['2030-5-1', 42]] as const) for (const p of players) legacyRow(name, date, p.player_id, p.name, cur);
    for (const p of players) legacyRow(name, '2030-4-15', p.player_id, `Stranger ${p.player_id}`, 70);
    players.forEach((p, i) => legacyRow(name, '2030-4-20', p.player_id, i % 2 ? p.name : `Stranger ${p.player_id}`, 55));
    for (const p of players) legacyRow(name, '2031-1-1', p.player_id, p.name, 45);
    historyDb.prepare(`INSERT INTO rating_snapshot_modes (save_name, game_date, mode, recorded_at) VALUES (?, '2030-5-1', 'scouted', 'x')`).run(name);
  }

  it('brings over only the save\'s own dates, backs up first, leaves the name-keyed rows exactly as they were, and says what it left out', () => {
    writeLegacy('New Game');
    const legacyBefore = legacyFingerprint();
    const a = saveFolder('mac-app-store', 'New Game');
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    expect(snapshotDates()).toEqual(['2030-4-1', '2030-5-1']);
    // The rating kind's stamp came with its date
    expect(historyDb.prepare(`SELECT mode FROM save_rating_snapshot_modes WHERE save_key = ? AND game_date = '2030-5-1'`).get(key)).toEqual({ mode: 'scouted' });
    // The earlier build's rows are untouched
    expect(legacyFingerprint()).toBe(legacyBefore);
    // A copy of history.db was made before anything was brought over, once
    const backup = legacyBackupPath();
    expect(backup && fs.existsSync(backup)).toBe(true);
    expect(path.dirname(backup!)).toBe(path.join(DATA_DIR, 'backups'));
    const reviews = historyDb.prepare(`SELECT game_date, verdict, reason FROM history_legacy_review WHERE save_key = ? ORDER BY game_date`).all(key);
    expect(reviews).toEqual([
      { game_date: '2030-4-1', verdict: 'attributed', reason: 'matched' },
      { game_date: '2030-4-15', verdict: 'another_save', reason: 'different_league' },
      { game_date: '2030-4-20', verdict: 'unattributed', reason: 'unclear' },
      { game_date: '2030-5-1', verdict: 'attributed', reason: 'matched' },
      { game_date: '2031-1-1', verdict: 'unattributed', reason: 'after_league_date' },
    ]);
    const note = historyNote();
    expect(note.note).toBe('Rating history from 2 earlier imports couldn\'t be matched to this save for sure, so it isn\'t used.');
    expect(note.because.join(' ')).toMatch(/another save of the same name/);
    // Served on the data status, as a claim with its basis, in plain words
    const status = getDataStatus();
    expect(status.history.note).toBe(note.note);
    const claim = dataStatusView(status).ratingHistory;
    expect(claim?.text).toBe(note.note);
    for (const banned of BANNED_JARGON) expect(claim?.text ?? '').not.toMatch(banned);
    // ...and on every development trend's basis
    expect(developmentTrendByPlayer().get(IDS.starter)?.reasons).toContain(note.note);
  });

  it('is reviewed once: a second look copies nothing and makes no second backup', () => {
    writeLegacy('New Game');
    const a = saveFolder('mac-app-store', 'New Game');
    useSave(a.csvDir, 'New Game');
    currentHistoryKey();
    const rows = historyDb.prepare(`SELECT COUNT(*) AS n FROM save_rating_snapshots`).get();
    const backup = legacyBackupPath();
    forgetHistoryKey();
    currentHistoryKey();
    expect(historyDb.prepare(`SELECT COUNT(*) AS n FROM save_rating_snapshots`).get()).toEqual(rows);
    expect(legacyBackupPath()).toBe(backup);
    expect(fs.readdirSync(path.join(DATA_DIR, 'backups'))).toHaveLength(1);
  });

  it('survives a crash part way through: every date is done or not, and the next look carries on', () => {
    writeLegacy('New Game');
    const a = saveFolder('mac-app-store', 'New Game');
    useSave(a.csvDir, 'New Game');
    let seen = 0;
    historyIdentityDeps.beforeLegacyDate = () => {
      seen += 1;
      if (seen === 3) throw new Error('killed');
    };
    const key = currentHistoryKey();
    expect(historyDb.prepare(`SELECT COUNT(*) AS n FROM history_legacy_review WHERE save_key = ?`).get(key)).toEqual({ n: 2 });
    // The history is usable as it stands: the dates done so far
    expect(snapshotDates()).toEqual(['2030-4-1']);
    historyIdentityDeps.beforeLegacyDate = () => {};
    forgetHistoryKey();
    expect(currentHistoryKey()).toBe(key);
    expect(snapshotDates()).toEqual(['2030-4-1', '2030-5-1']);
    expect(historyDb.prepare(`SELECT COUNT(*) AS n FROM history_legacy_review WHERE save_key = ?`).get(key)).toEqual({ n: 5 });
    expect(historyDb.prepare(`SELECT COUNT(*) AS n FROM save_rating_snapshots WHERE save_key = ?`).get(key)).toEqual({ n: 2 * leaguePlayers().length });
  });

  it('looks again, against the next import, at a date it left unused: the league it was compared with may not have been this save\'s', () => {
    // The history under the name is this save's, but the league served when it was first looked at was another's
    const players = leaguePlayers();
    for (const p of players) legacyRow('New Game', '2030-4-1', p.player_id, `Real ${p.name}`, 40);
    const a = saveFolder('mac-app-store', 'New Game');
    fs.writeFileSync(LAST_IMPORT_PATH, JSON.stringify({ startedAt: 'import-1' }));
    try {
      useSave(a.csvDir, 'New Game');
      const key = currentHistoryKey();
      expect(snapshotDates()).toEqual([]);
      // Looked at again against the same import: nothing changes
      forgetHistoryKey();
      currentHistoryKey();
      expect(historyDb.prepare(`SELECT verdict, league_import FROM history_legacy_review WHERE save_key = ?`).get(key)).toEqual({ verdict: 'another_save', league_import: 'import-1' });
      // The save's own import arrives: its players are the history's, and the date is brought over
      db.exec(`UPDATE players SET first_name = 'Real ' || first_name`);
      fs.writeFileSync(LAST_IMPORT_PATH, JSON.stringify({ startedAt: 'import-2' }));
      forgetHistoryKey();
      expect(currentHistoryKey()).toBe(key);
      expect(snapshotDates()).toEqual(['2030-4-1']);
      expect(historyDb.prepare(`SELECT verdict, league_import FROM history_legacy_review WHERE save_key = ?`).get(key)).toEqual({ verdict: 'attributed', league_import: 'import-2' });
    } finally {
      db.exec(`UPDATE players SET first_name = substr(first_name, 6) WHERE first_name LIKE 'Real %'`);
      fs.rmSync(LAST_IMPORT_PATH, { force: true });
    }
  });

  it('is never given to either of two same-named saves when both have the players', () => {
    writeLegacy('New Game');
    const a = saveFolder('mac-app-store', 'New Game');
    const b = saveFolder('application-support', 'New Game');
    // B's export has the same players (two leagues started from one real-life database)
    fs.writeFileSync(path.join(b.csvDir, 'players.csv'), ['player_id,first_name,last_name', ...leaguePlayers().map((p) => `${p.player_id},${p.name.split(' ')[0]},${p.name.split(' ').slice(1).join(' ')}`)].join('\n'));
    knownSaves.push(describeSave(a.lgPath, null, 'times'), describeSave(b.lgPath, null, 'times'));
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    expect(snapshotDates()).toEqual([]);
    expect(historyDb.prepare(`SELECT reason FROM history_legacy_review WHERE save_key = ? AND game_date = '2030-4-1'`).get(key)).toEqual({ reason: 'twin_matches' });
    expect(historyNote().note).toMatch(/4 earlier imports couldn't be matched/);
  });

  it('is given to the save whose players it has when the same-named other save is another league', () => {
    writeLegacy('New Game');
    const a = saveFolder('mac-app-store', 'New Game');
    const b = saveFolder('application-support', 'New Game');
    fs.writeFileSync(path.join(b.csvDir, 'players.csv'), ['player_id,first_name,last_name', ...leaguePlayers().map((p) => `${p.player_id},Other,Person${p.player_id}`)].join('\n'));
    knownSaves.push(describeSave(a.lgPath, null, 'times'), describeSave(b.lgPath, null, 'times'));
    useSave(a.csvDir, 'New Game');
    currentHistoryKey();
    expect(snapshotDates()).toEqual(['2030-4-1', '2030-5-1']);
  });

  it('files every new snapshot under the save\'s key and never writes the name-keyed table', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    useSave(a.csvDir, 'New Game');
    const before = legacyFingerprint();
    const taken = takeSnapshot();
    stampSnapshotMode(taken!.gameDate, { mode: 'scouted', additionalScouted: null, source: 'export_settings', reason: null }, null);
    expect(legacyFingerprint()).toBe(before);
    expect(historyDb.prepare(`SELECT COUNT(*) AS n FROM rating_snapshot_modes`).get()).toEqual({ n: 0 });
    expect(servedSave()).toMatchObject({ folderPath: a.lgPath, name: 'New Game', legacyName: 'New Game' });
  });
});
