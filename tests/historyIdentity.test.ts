import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DATA_DIR, saveConfig } from '../server/config.js';
import { db, forgetImportRecord, LAST_IMPORT_PATH } from '../server/db.js';
import { getDataStatus } from '../server/dataStatus.js';
import { baselineSnapshot, developmentTrendByPlayer, historyDb, snapshotDates, stampSnapshotMode, takeSnapshot } from '../server/history.js';
import {
  CONTINUITY_POLICY,
  continuityOf,
  currentHistoryKey,
  decideLegacyDate,
  forgetHistoryKey,
  historyIdentityDeps,
  historyNote,
  historyOffers,
  historySave,
  legacyBackupPath,
  servedLeagueCertain,
  servedSave,
  type FolderState,
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
 * as development. One folder is one history; the players test only ever refuses; a save that might have moved is asked
 * about, never adopted; history filed under the name before is used only where it is certainly the save's.
 */

const EXTRA_FROM = 960_000;
const EXTRA = 30;
const LEAGUE_DATE = '2030-06-01';

let root: string;

function saveFolder(label: string, name: string): { lgPath: string; csvDir: string } {
  const lgPath = path.join(root, label, `${name}.lg`);
  const csvDir = path.join(lgPath, 'import_export', 'csv');
  fs.mkdirSync(csvDir, { recursive: true });
  return { lgPath, csvDir };
}

/** Choose a save and import it, as the earlier build does (its import names no folder; `last-import.json` is written after). */
function useSave(csvDir: string | null, name: string | null): void {
  saveConfig({ csvDir, saveName: name });
  fs.writeFileSync(LAST_IMPORT_PATH, JSON.stringify({ startedAt: `import-${Date.now()}-${Math.random()}` }));
  const later = new Date(Date.now() + 1000);
  fs.utimesSync(LAST_IMPORT_PATH, later, later);
  forgetHistoryKey();
}

/** Choose a save without importing it: the league on disk is still the last import's. */
function chooseOnly(csvDir: string, name: string): void {
  saveConfig({ csvDir, saveName: name });
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(DATA_DIR, 'config.json'), later, later);
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
const keyedRows = (key: string): unknown[] => historyDb.prepare(`SELECT * FROM save_rating_snapshots WHERE save_key = ? ORDER BY game_date, player_id`).all(key);

const clearAll = (): void => {
  for (const table of ['save_rating_snapshots', 'save_rating_snapshot_modes', 'history_saves', 'history_legacy_review', 'history_identity_meta',
    'history_dual_writes', 'history_offer_choices', 'roster_state_snapshot_saves', 'rating_snapshots', 'rating_snapshot_modes']) {
    historyDb.exec(`DELETE FROM ${table}`);
  }
};

const knownSaves: SaveInfo[] = [];
let unreadableRoots: string[] = [];
const folderStates = new Map<string, FolderState>();

async function post(url: string, body: unknown): Promise<{ status: number; body: any }> {
  await request('/api/v2/rating-history'); // starts the test server
  const res = await fetch(`http://127.0.0.1:${process.env.OOTP_FO_PORT}${url}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-history-key-'));
  // Enough players that a comparison of two sets of players is evidence (CONTINUITY_POLICY.minCompared)
  const insert = db.prepare(`INSERT INTO players (player_id, first_name, last_name, age, position, team_id, organization_id, retired) VALUES (?, ?, ?, 24, 6, ?, ?, 0)`);
  for (let i = 0; i < EXTRA; i += 1) insert.run(EXTRA_FROM + i, 'Depth', `Player${i}`, IDS.mlbTeam, IDS.mlbTeam);
  historyIdentityDeps.knownSaves = () => ({ saves: knownSaves, unreadable: unreadableRoots });
  historyIdentityDeps.folderState = (p) => folderStates.get(p) ?? (fs.existsSync(p) ? 'present' : 'gone');
});

afterAll(() => {
  db.prepare(`DELETE FROM players WHERE player_id >= ? AND player_id < ?`).run(EXTRA_FROM, EXTRA_FROM + EXTRA);
  clearAll();
  saveConfig({ csvDir: null, saveName: null });
  fs.rmSync(LAST_IMPORT_PATH, { force: true });
  forgetHistoryKey();
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  clearAll();
  knownSaves.length = 0;
  unreadableRoots = [];
  folderStates.clear();
  historyIdentityDeps.beforeLegacyDate = () => {};
  fs.rmSync(path.join(DATA_DIR, 'backups'), { recursive: true, force: true });
});

afterEach(() => {
  saveConfig({ csvDir: null, saveName: null });
  fs.rmSync(LAST_IMPORT_PATH, { force: true });
  forgetHistoryKey();
});

describe('what counts as the same league', () => {
  const names = new Map(Array.from({ length: 2000 }, (_, i) => [i, `Player ${i}`] as const));
  const rows = (matching: number, total: number) =>
    Array.from({ length: total }, (_, i) => ({ player_id: i, name: i < matching ? `Player ${i}` : `Someone Else ${i}` }));

  it('is the same league only when all but one shared player in a thousand has the same name, a hair either side of the line', () => {
    expect(continuityOf(rows(1998, 2000), names).verdict).toBe('same'); // 0.999
    expect(continuityOf(rows(1997, 2000), names).verdict).toBe('unclear'); // 0.9985
  });

  it('reads two saves of one real-life database (measured 98.9% to 99.8% alike) as unclear, never the same', () => {
    expect(continuityOf(rows(1996, 2000), names).verdict).toBe('unclear');
    expect(continuityOf(rows(1978, 2000), names).verdict).toBe('unclear');
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
    decideLegacyDate({ date: '2030-4-1', rows: ours, names, leagueDate: '2030-06-01', otherCarriers: () => 0, ...over });

  it('brings over a date whose rows have this league\'s players, and only those rows', () => {
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

  it('leaves unused any date whose name another known save carries, or when a folder of saves couldn\'t be read', () => {
    expect(decide({ otherCarriers: () => 1 })).toMatchObject({ verdict: 'unattributed', reason: 'twin_exists' });
    expect(decide({ otherCarriers: () => null })).toMatchObject({ verdict: 'unattributed', reason: 'saves_unreadable' });
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
    expect(snapshotDates()).toEqual([]);
    expect(developmentTrendByPlayer().size).toBe(0);
    expect(loadScoutedObservations([IDS.starter]).get(IDS.starter) ?? []).toEqual([]);
    expect((await request(`/api/development-history/${IDS.mlbTeam}`)).rows).toEqual([]);

    // B's snapshot of the same date, with a rating moved, leaves A's exactly as it was
    const before = keyedRows(keyA);
    db.prepare(`UPDATE players_batting SET batting_ratings_overall_contact = batting_ratings_overall_contact + 7 WHERE player_id = ?`).run(IDS.starter);
    try {
      takeSnapshot();
    } finally {
      db.prepare(`UPDATE players_batting SET batting_ratings_overall_contact = batting_ratings_overall_contact - 7 WHERE player_id = ?`).run(IDS.starter);
    }
    expect(keyedRows(keyA)).toEqual(before);

    useSave(a.csvDir, 'New Game');
    expect(currentHistoryKey()).toBe(keyA);
    expect(snapshotDates()).toEqual([LEAGUE_DATE]);
    expect((await request(`/api/development/${IDS.mlbTeam}`)).snapshots).toBe(1);
  });

  it('keep the history of a save across restarts and re-imports', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    takeSnapshot();
    useSave(a.csvDir, 'New Game'); // a re-import of the same save
    expect(currentHistoryKey()).toBe(key);
    expect(historySave(key)).toMatchObject({ origin: 'new', bound: true, saveName: 'New Game' });
  });

  it('never compare their roster states with each other', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    const b = saveFolder('application-support', 'New Game');
    useSave(a.csvDir, 'New Game');
    expect(captureRosterStateSnapshot({ log: null }).status).toBe('created');
    useSave(b.csvDir, 'New Game');
    const first = captureRosterStateSnapshot({ log: null });
    expect(first.status).toBe('created');
    expect(first.events).toEqual([]);
  });
});

describe('a save chosen but not yet imported', () => {
  it('never has the league on disk filed under it: the start-up baseline waits for its own import', () => {
    const a = saveFolder('mac-app-store', 'New Game 6');
    const b = saveFolder('mac-app-store-2', 'New Game 5');
    useSave(a.csvDir, 'New Game 6');
    const keyA = currentHistoryKey();
    expect(baselineSnapshot()?.gameDate).toBe(LEAGUE_DATE);
    const aRows = keyedRows(keyA);
    // The GM chooses New Game 5; the earlier build's import on disk (no folder named) is still New Game 6's league
    chooseOnly(b.csvDir, 'New Game 5');
    expect(servedLeagueCertain()).toBe(false);
    expect(baselineSnapshot()).toBeNull();
    const keyB = currentHistoryKey();
    expect(snapshotDates()).toEqual([]);
    expect(historyDb.prepare(`SELECT COUNT(*) AS n FROM rating_snapshots WHERE save_name = 'New Game 5'`).get()).toEqual({ n: 0 });
    // New Game 6's history is untouched and still its own
    expect(keyedRows(keyA)).toEqual(aRows);
    expect(historySave(keyA)?.bound).toBe(true);
    // New Game 5's own import lands: now it is certain, and the baseline is taken, under its own key
    useSave(b.csvDir, 'New Game 5');
    expect(servedLeagueCertain()).toBe(true);
    expect(currentHistoryKey()).toBe(keyB);
    expect(baselineSnapshot()?.gameDate).toBe(LEAGUE_DATE);
    expect(historySave(keyB)?.origin).toBe('new');
    expect(historyNote(keyB).note).toBeNull();
  });
});

describe('one folder, one history: the players test only refuses', () => {
  it('starts fresh, and never writes over the earlier history, when the folder now holds a league with other players', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    takeSnapshot();
    const before = keyedRows(key);
    db.exec(`UPDATE players SET first_name = 'New' || first_name`);
    try {
      useSave(a.csvDir, 'New Game'); // a new league made under the same name in the same folder, imported
      const fresh = currentHistoryKey();
      expect(fresh).not.toBe(key);
      expect(historySave(key)?.bound).toBe(false);
      expect(historySave(fresh)?.origin).toBe('fresh_new_league');
      takeSnapshot(); // the same date as the earlier history's
      expect(keyedRows(key)).toEqual(before);
      expect(snapshotDates()).toEqual([LEAGUE_DATE]);
      expect(historyNote().note).toMatch(/starts fresh: its players don't match/);
    } finally {
      db.exec(`UPDATE players SET first_name = substr(first_name, 4) WHERE first_name LIKE 'New%'`);
    }
  });

  it('starts fresh, and says so, when the same players come back at an earlier date than the folder\'s history', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    takeSnapshot();
    historyDb.prepare(`UPDATE save_rating_snapshots SET game_date = '2031-1-1' WHERE save_key = ?`).run(key);
    const before = keyedRows(key);
    useSave(a.csvDir, 'New Game');
    const fresh = currentHistoryKey();
    expect(historySave(fresh)?.origin).toBe('fresh_went_back');
    takeSnapshot();
    expect(keyedRows(key)).toEqual(before);
    expect(historyNote().note).toMatch(/its date is earlier/);
  });

  it('never writes over the folder\'s history when the league is earlier than it, even with too few players to compare', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    takeSnapshot();
    historyDb.prepare(`UPDATE save_rating_snapshots SET cur = -1 WHERE save_key = ?`).run(key);
    historyDb.prepare(`INSERT INTO save_rating_snapshots (save_key, game_date, player_id, name) VALUES (?, '2031-1-1', 999999, 'Nobody Here')`).run(key);
    const before = keyedRows(key);
    useSave(a.csvDir, 'New Game');
    expect(currentHistoryKey()).not.toBe(key);
    takeSnapshot();
    expect(keyedRows(key)).toEqual(before);
  });

  it('keeps appending when the history holds too few of the league\'s players to compare (no evidence is not a refusal)', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    historyDb.prepare(`INSERT INTO save_rating_snapshots (save_key, game_date, player_id, name) VALUES (?, '2030-5-1', 999999, 'Nobody Here')`).run(key);
    useSave(a.csvDir, 'New Game');
    expect(currentHistoryKey()).toBe(key);
  });
});

describe('a save that might have moved is asked about, never adopted', () => {
  it('never takes the history of a save whose folder can\'t be seen (a drive not mounted), even for a copy with every player the same', () => {
    const a = saveFolder('external', 'New Game');
    const copy = saveFolder('copies', 'New Game');
    useSave(a.csvDir, 'New Game');
    const keyA = currentHistoryKey();
    takeSnapshot();
    folderStates.set(a.lgPath, 'unknown');
    useSave(copy.csvDir, 'New Game');
    const keyCopy = currentHistoryKey();
    takeSnapshot();
    expect(keyCopy).not.toBe(keyA);
    expect(historyOffers()).toEqual([]);
    expect(snapshotDates()).toEqual([LEAGUE_DATE]);
    // The original comes back: its history is exactly its own, still bound to its folder
    folderStates.clear();
    useSave(a.csvDir, 'New Game');
    expect(currentHistoryKey()).toBe(keyA);
    expect(historySave(keyA)).toMatchObject({ bound: true, folderPath: a.lgPath, origin: 'new' });
  });

  it('asks, and carries the history over only on a yes: the offer and its answer, round trip', async () => {
    const a = saveFolder('mac-app-store', 'New Game');
    const renamed = saveFolder('mac-app-store', 'Dynasty');
    useSave(a.csvDir, 'New Game');
    const keyA = currentHistoryKey();
    takeSnapshot();
    stampSnapshotMode(LEAGUE_DATE, { mode: 'scouted', additionalScouted: null, source: 'export_settings', reason: null }, null);
    fs.rmSync(a.lgPath, { recursive: true });
    useSave(renamed.csvDir, 'Dynasty');
    const keyNew = currentHistoryKey();
    takeSnapshot();
    // Nothing is joined by itself
    expect(currentHistoryKey()).toBe(keyNew);
    expect(historySave(keyA)?.folderPath).toBe(a.lgPath);
    const view = await request('/api/v2/rating-history');
    expect(view.offers).toHaveLength(1);
    expect(view.offers[0]).toMatchObject({ id: keyA, saveName: 'New Game', imports: 1 });
    expect(view.offers[0].question.text).toMatch(/^This save has no rating history yet\. Is it "New Game", the save that used to be in /);
    for (const banned of BANNED_JARGON) expect(view.offers[0].question.text).not.toMatch(banned);
    // A stale or unknown answer is refused in words
    expect((await post('/api/v2/rating-history/choice', { offerId: 'save-nothing', choice: 'adopt' })).status).toBe(400);
    const answered = await post('/api/v2/rating-history/choice', { offerId: keyA, choice: 'adopt' });
    expect(answered.status).toBe(200);
    expect(answered.body.offers).toEqual([]);
    expect(currentHistoryKey()).toBe(keyA);
    expect(historySave(keyA)).toMatchObject({ origin: 'adopted', folderPath: renamed.lgPath, saveName: 'Dynasty', bound: true });
    expect(historySave(keyNew)?.bound).toBe(false);
    expect(snapshotDates()).toEqual([LEAGUE_DATE]);
    expect(historyDb.prepare(`SELECT choice FROM history_offer_choices WHERE save_key = ?`).all(keyNew)).toEqual([{ choice: 'adopt' }]);
    // The answer holds across a re-import
    useSave(renamed.csvDir, 'Dynasty');
    expect(currentHistoryKey()).toBe(keyA);
  });

  it('starts fresh on a no, and asks nothing again', async () => {
    const a = saveFolder('mac-app-store', 'New Game');
    const renamed = saveFolder('mac-app-store', 'Dynasty');
    useSave(a.csvDir, 'New Game');
    const keyA = currentHistoryKey();
    takeSnapshot();
    fs.rmSync(a.lgPath, { recursive: true });
    useSave(renamed.csvDir, 'Dynasty');
    const keyNew = currentHistoryKey();
    expect(historyOffers().map((o) => o.id)).toEqual([keyA]);
    const answered = await post('/api/v2/rating-history/choice', { offerId: keyA, choice: 'fresh' });
    expect(answered.status).toBe(200);
    expect(answered.body.offers).toEqual([]);
    expect(currentHistoryKey()).toBe(keyNew);
    expect(historySave(keyA)?.folderPath).toBe(a.lgPath);
  });

  it('never offers a history with another league\'s players, or one later than this league\'s date', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    const b = saveFolder('elsewhere', 'Another');
    useSave(a.csvDir, 'New Game');
    const keyA = currentHistoryKey();
    takeSnapshot();
    historyDb.prepare(`UPDATE save_rating_snapshots SET game_date = '2031-1-1' WHERE save_key = ?`).run(keyA);
    folderStates.set(a.lgPath, 'gone');
    useSave(b.csvDir, 'Another');
    expect(historyOffers()).toEqual([]);
    historyDb.prepare(`UPDATE save_rating_snapshots SET game_date = '2030-5-1', name = 'Stranger ' || player_id WHERE save_key = ?`).run(keyA);
    forgetHistoryKey();
    expect(historyOffers()).toEqual([]);
  });

  it('reads the history of the save whose league is served, not of a save chosen but not yet imported', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    const b = saveFolder('application-support', 'New Game');
    const startedAt = '2040-07-01T12:00:00.000Z';
    db.exec('CREATE TABLE IF NOT EXISTS pennant_import (key TEXT PRIMARY KEY, value TEXT)');
    db.prepare(`INSERT OR REPLACE INTO pennant_import (key, value) VALUES ('import', ?)`).run(JSON.stringify({ startedAt, csvDir: a.csvDir }));
    try {
      useSave(b.csvDir, 'New Game');
      fs.writeFileSync(LAST_IMPORT_PATH, JSON.stringify({ startedAt }));
      forgetImportRecord();
      forgetHistoryKey();
      expect(servedSave()).toMatchObject({ folderPath: a.lgPath, name: 'New Game' });
      expect(servedLeagueCertain()).toBe(true);
    } finally {
      db.prepare(`DELETE FROM pennant_import WHERE key = 'import'`).run();
      forgetImportRecord();
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
    knownSaves.push(describeSave(a.lgPath, null, 'times'));
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    expect(snapshotDates()).toEqual(['2030-4-1', '2030-5-1']);
    expect(historyDb.prepare(`SELECT mode FROM save_rating_snapshot_modes WHERE save_key = ? AND game_date = '2030-5-1'`).get(key)).toEqual({ mode: 'scouted' });
    expect(legacyFingerprint()).toBe(legacyBefore);
    const backup = legacyBackupPath();
    expect(backup && fs.existsSync(backup)).toBe(true);
    expect(path.dirname(backup!)).toBe(path.join(DATA_DIR, 'backups'));
    expect(historyDb.prepare(`SELECT game_date, verdict, reason FROM history_legacy_review WHERE save_key = ? ORDER BY game_date`).all(key)).toEqual([
      { game_date: '2030-4-1', verdict: 'attributed', reason: 'matched' },
      { game_date: '2030-4-15', verdict: 'another_save', reason: 'different_league' },
      { game_date: '2030-4-20', verdict: 'unattributed', reason: 'unclear' },
      { game_date: '2030-5-1', verdict: 'attributed', reason: 'matched' },
      { game_date: '2031-1-1', verdict: 'unattributed', reason: 'after_league_date' },
    ]);
    const note = historyNote();
    expect(note.note).toBe('Rating history from 2 earlier imports couldn\'t be matched to this save for sure, so it isn\'t used.');
    expect(note.because.join(' ')).toMatch(/another save of the same name/);
    const status = getDataStatus();
    expect(status.history.note).toBe(note.note);
    const claim = dataStatusView(status).ratingHistory;
    expect(claim?.text).toBe(note.note);
    for (const banned of BANNED_JARGON) expect(claim?.text ?? '').not.toMatch(banned);
    expect(developmentTrendByPlayer().get(IDS.starter)?.reasons).toContain(note.note);
  });

  it('is given to neither of two saves that share the name, whatever their players', () => {
    writeLegacy('New Game');
    const a = saveFolder('mac-app-store', 'New Game');
    const b = saveFolder('application-support', 'New Game');
    knownSaves.push(describeSave(a.lgPath, null, 'times'), describeSave(b.lgPath, null, 'times'));
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    expect(snapshotDates()).toEqual([]);
    expect(historyDb.prepare(`SELECT reason FROM history_legacy_review WHERE save_key = ? AND game_date = '2030-4-1'`).get(key)).toEqual({ reason: 'twin_exists' });
    expect(historyNote().note).toMatch(/4 earlier imports couldn't be matched/);
  });

  it('is left unused while a folder of saves can\'t be looked inside', () => {
    writeLegacy('New Game');
    const a = saveFolder('mac-app-store', 'New Game');
    unreadableRoots = ['/Volumes/Elsewhere/saved_games'];
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    expect(historyDb.prepare(`SELECT reason FROM history_legacy_review WHERE save_key = ? AND game_date = '2030-4-1'`).get(key)).toEqual({ reason: 'saves_unreadable' });
  });

  it('is reviewed once: a second look copies nothing, and a backup whose record was lost is not made again', () => {
    writeLegacy('New Game');
    const a = saveFolder('mac-app-store', 'New Game');
    useSave(a.csvDir, 'New Game');
    currentHistoryKey();
    const rows = historyDb.prepare(`SELECT COUNT(*) AS n FROM save_rating_snapshots`).get();
    const backup = legacyBackupPath();
    // A crash after the copy was renamed and before it was recorded
    historyDb.exec(`DELETE FROM history_identity_meta`);
    historyDb.exec(`DELETE FROM history_legacy_review WHERE verdict != 'attributed'`);
    forgetHistoryKey();
    currentHistoryKey();
    expect(historyDb.prepare(`SELECT COUNT(*) AS n FROM save_rating_snapshots`).get()).toEqual(rows);
    expect(legacyBackupPath()).toBe(backup);
    expect(fs.readdirSync(path.join(DATA_DIR, 'backups'))).toHaveLength(1);
  });

  it('survives a crash part way through: every date is done or not, it says so, and the next look carries on', () => {
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
    expect(snapshotDates()).toEqual(['2030-4-1']);
    expect(historyNote().note).toMatch(/couldn't all be brought over this time/);
    historyIdentityDeps.beforeLegacyDate = () => {};
    forgetHistoryKey();
    expect(currentHistoryKey()).toBe(key);
    expect(snapshotDates()).toEqual(['2030-4-1', '2030-5-1']);
    expect(historyNote().note).not.toMatch(/couldn't all be brought over/);
    expect(historyDb.prepare(`SELECT COUNT(*) AS n FROM history_legacy_review WHERE save_key = ?`).get(key)).toEqual({ n: 5 });
    expect(historyDb.prepare(`SELECT COUNT(*) AS n FROM save_rating_snapshots WHERE save_key = ?`).get(key)).toEqual({ n: 2 * leaguePlayers().length });
  });

  it('looks again, against the next import, at a date it left unused', () => {
    const players = leaguePlayers();
    for (const p of players) legacyRow('New Game', '2030-4-1', p.player_id, `Real ${p.name}`, 40);
    const a = saveFolder('mac-app-store', 'New Game');
    useSave(a.csvDir, 'New Game');
    const key = currentHistoryKey();
    expect(snapshotDates()).toEqual([]);
    const first = historyDb.prepare(`SELECT verdict, league_import FROM history_legacy_review WHERE save_key = ?`).get(key) as { verdict: string; league_import: string };
    expect(first.verdict).toBe('another_save');
    db.exec(`UPDATE players SET first_name = 'Real ' || first_name`);
    try {
      historyDb.prepare(`DELETE FROM save_rating_snapshots WHERE save_key = ?`).run(key);
      useSave(a.csvDir, 'New Game'); // the save's own import
      expect(currentHistoryKey()).toBe(key);
      expect(snapshotDates()).toEqual(['2030-4-1']);
      expect(historyDb.prepare(`SELECT verdict FROM history_legacy_review WHERE save_key = ?`).get(key)).toEqual({ verdict: 'attributed' });
    } finally {
      db.exec(`UPDATE players SET first_name = substr(first_name, 6) WHERE first_name LIKE 'Real %'`);
    }
  });
});

describe('the earlier (Electron) build after a rollback', () => {
  it('reads every snapshot this build takes, under the save\'s name, as it always wrote them; and they are never taken for earlier history', () => {
    const a = saveFolder('mac-app-store', 'New Game');
    const b = saveFolder('application-support', 'New Game');
    knownSaves.push(describeSave(a.lgPath, null, 'times'), describeSave(b.lgPath, null, 'times'));
    useSave(a.csvDir, 'New Game');
    const taken = takeSnapshot();
    stampSnapshotMode(taken!.gameDate, { mode: 'scouted', additionalScouted: null, source: 'export_settings', reason: null }, null);
    // What the earlier build reads: its table, by the name
    const legacy = historyDb.prepare(`SELECT player_id, con, cur FROM rating_snapshots WHERE save_name = 'New Game' AND game_date = ? ORDER BY player_id`).all(LEAGUE_DATE);
    expect(legacy).toEqual(historyDb.prepare(`SELECT player_id, con, cur FROM save_rating_snapshots WHERE save_key = ? AND game_date = ? ORDER BY player_id`).all(currentHistoryKey(), LEAGUE_DATE));
    expect(legacy.length).toBe(leaguePlayers().length);
    expect(historyDb.prepare(`SELECT mode FROM rating_snapshot_modes WHERE save_name = 'New Game' AND game_date = ?`).get(LEAGUE_DATE)).toEqual({ mode: 'scouted' });
    // Neither this save nor its same-named twin reads this build's own dates as earlier history left unused
    useSave(a.csvDir, 'New Game');
    currentHistoryKey();
    expect(historyNote().note).toBeNull();
    useSave(b.csvDir, 'New Game');
    currentHistoryKey();
    expect(historyNote().note).toBeNull();
    expect(snapshotDates()).toEqual([]);
  });
});
