/**
 * Pennant remembers (D-058, N7 Stage A): what each import's reports and standings said, the GM's desk statuses and his
 * follows, kept in `history.db` beside the rating snapshots (D-009: persistent observations survive every re-import).
 *
 * - **Keyed by the save's identity** (D-064, `historyIdentity.ts`), never by its name: two saves called "New Game" never
 *   share a desk, a follow or a comparison. The key is resolved on the server's own thread (`currentHistoryKey`).
 * - **Additive.** Every table here is new; the watchlist is copied into Following, never moved, so the Electron app
 *   keeps its own. Before the first row is written, `history.db` is copied once into `backups/` (as D-064 did).
 * - **Attention, never transactions** (D-004). A desk status or a follow records what the GM looked at; nothing here
 *   writes to OOTP, and nothing here changes what a department said. A snapshot records what was served, so a later
 *   import can say what changed; a difference says what changed, never which transaction did it (D-020).
 * - **Filed only when certain.** A snapshot is taken only while the league served is certainly the save's own
 *   (`servedLeagueCertain`), as D-064 files rating history.
 *
 * Nothing here words anything: the presentation modules do (`presentation/frontOffice/attention.ts`). Nothing here reads
 * the league database beyond the players' names the watchlist copy compares.
 */
import fs from 'node:fs';
import path from 'node:path';
import { historyDb } from './history.js';
import { BACKUP_DIR, currentHistoryKey, leaguePlayerNames, looseName, rollbackName, servedLeagueCertain } from './historyIdentity.js';
import type { DeptId } from './contract/presentation.js';

historyDb.exec(`
  /* One row per import whose Front Office was recorded for a club: the league's day and each department's state. */
  CREATE TABLE IF NOT EXISTS report_snapshot_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    save_key TEXT NOT NULL,
    org_id INTEGER NOT NULL,
    import_stamp TEXT NOT NULL,
    game_date TEXT,
    departments TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_report_snapshot_imports ON report_snapshot_imports (save_key, org_id, import_stamp);
  /* Every item each department raised at that import: its key, its plain severity and its headline as served. */
  CREATE TABLE IF NOT EXISTS report_snapshots (
    snapshot_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    department TEXT NOT NULL,
    severity TEXT NOT NULL,
    headline TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (snapshot_id, item_key)
  );
  /* Each department's key figures at that import, as served (their line and value). */
  CREATE TABLE IF NOT EXISTS report_snapshot_figures (
    snapshot_id INTEGER NOT NULL,
    department TEXT NOT NULL,
    position INTEGER NOT NULL,
    text TEXT NOT NULL,
    display TEXT,
    n REAL,
    PRIMARY KEY (snapshot_id, department, position)
  );
  /* Each club's record, place and runs at an import (every club of the served club's league). */
  CREATE TABLE IF NOT EXISTS standings_snapshots (
    save_key TEXT NOT NULL,
    import_stamp TEXT NOT NULL,
    game_date TEXT,
    team_id INTEGER NOT NULL,
    name TEXT,
    abbr TEXT,
    league_id INTEGER,
    sub_league_id INTEGER,
    division_id INTEGER,
    division TEXT,
    w INTEGER,
    l INTEGER,
    t INTEGER,
    pos INTEGER,
    division_clubs INTEGER,
    gb REAL,
    runs_scored INTEGER,
    runs_allowed INTEGER,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (save_key, import_stamp, team_id)
  );
  /* The GM's desk: what he did with an item (open, reviewed, deferred until a game date, handled in OOTP) and his note. */
  CREATE TABLE IF NOT EXISTS desk_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    save_key TEXT NOT NULL,
    org_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    status TEXT NOT NULL,
    defer_until TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    set_import TEXT,
    resolved_at TEXT,
    resolved_import TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_desk_items_open ON desk_items (save_key, org_id, item_key, resolved_at);
  /* Following: the clubs and players the GM follows in a save, with his note. */
  CREATE TABLE IF NOT EXISTS following (
    save_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    subject_id INTEGER NOT NULL,
    name TEXT,
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (save_key, kind, subject_id)
  );
  /* Each watchlist row copied into Following, so a player the GM stops following is never copied back. */
  CREATE TABLE IF NOT EXISTS following_watchlist_copies (
    save_key TEXT NOT NULL,
    player_id INTEGER NOT NULL,
    save_name TEXT NOT NULL,
    copied_at TEXT NOT NULL,
    PRIMARY KEY (save_key, player_id)
  );
`);

// ── the one-time backup ────────────────────────────────────────────────────

const BACKUP_PREFIX = 'history-before-remembering-';
const BACKUP_META = 'remembering_backup';

/** Why the one-time backup could not be made at the last try; null when it was (or has not been tried). */
export const memoryBackupState: { failed: string | null } = { failed: null };

let backingUp: Promise<void> | null = null;

/** The backup made before the first row was remembered, or null when none has been made. */
export function memoryBackupPath(): string | null {
  const r = historyDb.prepare(`SELECT value FROM history_identity_meta WHERE key = ?`).get(BACKUP_META) as { value: string } | undefined;
  return r?.value ?? null;
}

/**
 * A copy of `history.db` in `backups/`, made once per data folder before the first row is remembered (D-064's rule for a
 * migration), with SQLite's online backup, off the event loop's turn: a large history is copied in steps while the
 * server answers. Written under a temporary name and renamed, so a copy cut short is never taken for a backup. Every
 * writer here waits on it. A backup that fails is logged and said; the writes go ahead, since they add rows to new
 * tables and change nothing that was there.
 */
export function ensureMemoryBackup(): Promise<void> {
  if (memoryBackupPath()) return Promise.resolve();
  if (backingUp) return backingUp;
  backingUp = (async () => {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      for (const f of fs.readdirSync(BACKUP_DIR)) if (f.startsWith(BACKUP_PREFIX) && f.endsWith('.partial')) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
      const done = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith('.db')).sort();
      let file = done[0] ? path.join(BACKUP_DIR, done[0]) : null;
      if (!file) {
        const final = path.join(BACKUP_DIR, `${BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
        await historyDb.backup(`${final}.partial`);
        fs.renameSync(`${final}.partial`, final);
        file = final;
      }
      historyDb.prepare(`INSERT OR REPLACE INTO history_identity_meta (key, value) VALUES (?, ?)`).run(BACKUP_META, file);
      memoryBackupState.failed = null;
    } catch (err) {
      memoryBackupState.failed = (err as Error).message;
      console.warn('[history] could not back up history.db before remembering the reports:', memoryBackupState.failed);
    } finally {
      backingUp = null;
    }
  })();
  return backingUp;
}

// ── the revision: moved by every write, so the served views built on it are rebuilt ─────────────

let revision = 0;
const listeners = new Set<() => void>();

/** Moves whenever anything remembered here changes (a snapshot, a desk status, a follow). */
export const memoryRevision = (): number => revision;

function changed(): void {
  revision += 1;
  followCache = null;
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error('[history] a listener on the remembered state failed:', err);
    }
  }
}

/** Called after every change to what is remembered. */
export function onMemoryChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The save the remembered state is filed under now (D-064). */
export const memoryKey = (): string => currentHistoryKey();

// ── report and standings snapshots ─────────────────────────────────────────

/** The desk's scale (`presentation/severity.ts`), as stored. */
export type DeskSeverity = 'critical' | 'attention' | 'noted';

export interface SnapshotItem {
  key: string;
  department: DeptId;
  /** The department's plain severity, the one the desk goes by. */
  severity: DeskSeverity;
  headline: string;
  count: number;
}

export interface SnapshotFigure {
  department: DeptId;
  text: string;
  display: string | null;
  n: number | null;
}

/** A department's state at the import: read (`ready`), not read (`unavailable`) or with nothing to report yet. */
export type SnapshotDepartmentState = 'ready' | 'unavailable' | 'notYet';

export interface ReportSnapshotInput {
  orgId: number;
  importStamp: string;
  gameDate: string | null;
  departments: Partial<Record<DeptId, SnapshotDepartmentState>>;
  items: readonly SnapshotItem[];
  figures: readonly SnapshotFigure[];
}

export interface ReportSnapshot {
  id: number;
  orgId: number;
  importStamp: string;
  gameDate: string | null;
  recordedAt: string;
  departments: Partial<Record<DeptId, SnapshotDepartmentState>>;
  items: Map<string, SnapshotItem>;
}

export interface StandingsRow {
  teamId: number;
  name: string;
  abbr: string | null;
  leagueId: number | null;
  subLeagueId: number | null;
  divisionId: number | null;
  /** "NL West", as the export names it; null for a league with no divisions. */
  division: string | null;
  w: number | null;
  l: number | null;
  t: number | null;
  /** The club's place in its division, as the Morning Report reads it; null without a record. */
  pos: number | null;
  divisionClubs: number | null;
  gb: number | null;
  runsScored: number | null;
  runsAllowed: number | null;
}

export interface StandingsSnapshot {
  importStamp: string;
  gameDate: string | null;
  recordedAt: string;
  rows: StandingsRow[];
}

/** Whether a snapshot may be filed now: only while the league served is certainly the save's own (D-064). */
export const snapshotsAllowed = (): boolean => servedLeagueCertain();

/**
 * Records what the Front Office served for a club at an import, replacing an earlier record of the same import (a
 * rebuild of the same import records its latest answer). Returns false when it was not filed (the league is not
 * certainly the save's own). Idempotent: the same input twice leaves one record.
 */
export async function recordReportSnapshot(input: ReportSnapshotInput): Promise<boolean> {
  if (!snapshotsAllowed()) return false;
  await ensureMemoryBackup();
  const saveKey = memoryKey();
  const now = new Date().toISOString();
  const write = historyDb.transaction(() => {
    const old = historyDb.prepare(`SELECT id FROM report_snapshot_imports WHERE save_key = ? AND org_id = ? AND import_stamp = ?`)
      .get(saveKey, input.orgId, input.importStamp) as { id: number } | undefined;
    if (old) {
      historyDb.prepare(`DELETE FROM report_snapshots WHERE snapshot_id = ?`).run(old.id);
      historyDb.prepare(`DELETE FROM report_snapshot_figures WHERE snapshot_id = ?`).run(old.id);
      historyDb.prepare(`DELETE FROM report_snapshot_imports WHERE id = ?`).run(old.id);
    }
    const id = Number(historyDb.prepare(
      `INSERT INTO report_snapshot_imports (save_key, org_id, import_stamp, game_date, departments, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(saveKey, input.orgId, input.importStamp, input.gameDate, JSON.stringify(input.departments), now).lastInsertRowid);
    const item = historyDb.prepare(`INSERT OR REPLACE INTO report_snapshots (snapshot_id, item_key, department, severity, headline, count) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const it of input.items) item.run(id, it.key, it.department, it.severity, it.headline, it.count);
    const figure = historyDb.prepare(`INSERT OR REPLACE INTO report_snapshot_figures (snapshot_id, department, position, text, display, n) VALUES (?, ?, ?, ?, ?, ?)`);
    const position = new Map<string, number>();
    for (const f of input.figures) {
      const at = position.get(f.department) ?? 0;
      position.set(f.department, at + 1);
      figure.run(id, f.department, at, f.text, f.display, f.n);
    }
  });
  write.immediate();
  changed();
  return true;
}

function snapshotById(id: number): ReportSnapshot | null {
  const meta = historyDb.prepare(`SELECT * FROM report_snapshot_imports WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!meta) return null;
  const items = new Map<string, SnapshotItem>();
  for (const r of historyDb.prepare(`SELECT item_key, department, severity, headline, count FROM report_snapshots WHERE snapshot_id = ?`).all(id) as Array<Record<string, unknown>>) {
    items.set(String(r.item_key), { key: String(r.item_key), department: r.department as DeptId, severity: r.severity as DeskSeverity, headline: String(r.headline), count: Number(r.count) || 1 });
  }
  let departments: ReportSnapshot['departments'] = {};
  try {
    departments = JSON.parse(String(meta.departments));
  } catch {
    departments = {};
  }
  return {
    id, orgId: Number(meta.org_id), importStamp: String(meta.import_stamp), gameDate: typeof meta.game_date === 'string' ? meta.game_date : null,
    recordedAt: String(meta.recorded_at), departments, items,
  };
}

/** The latest report snapshot of the club in this save from an import other than `importStamp`; null when none. */
export function previousReportSnapshot(orgId: number, importStamp: string | null, saveKey: string = memoryKey()): ReportSnapshot | null {
  const r = historyDb.prepare(
    `SELECT id FROM report_snapshot_imports WHERE save_key = ? AND org_id = ? AND import_stamp <> ? ORDER BY id DESC LIMIT 1`,
  ).get(saveKey, orgId, importStamp ?? '') as { id: number } | undefined;
  return r ? snapshotById(r.id) : null;
}

/** The report snapshot of this very import for the club; null when it has not been recorded. */
export function reportSnapshotOf(orgId: number, importStamp: string, saveKey: string = memoryKey()): ReportSnapshot | null {
  const r = historyDb.prepare(`SELECT id FROM report_snapshot_imports WHERE save_key = ? AND org_id = ? AND import_stamp = ?`)
    .get(saveKey, orgId, importStamp) as { id: number } | undefined;
  return r ? snapshotById(r.id) : null;
}

/** How many imports of this save have a report snapshot for the club. */
export function reportSnapshotCount(orgId: number, saveKey: string = memoryKey()): number {
  return (historyDb.prepare(`SELECT COUNT(*) AS n FROM report_snapshot_imports WHERE save_key = ? AND org_id = ?`).get(saveKey, orgId) as { n: number }).n;
}

/** Records every club's standings at an import (replacing an earlier record of the same import). */
export async function recordStandingsSnapshot(importStamp: string, gameDate: string | null, rows: readonly StandingsRow[]): Promise<boolean> {
  if (!snapshotsAllowed() || rows.length === 0) return false;
  await ensureMemoryBackup();
  const saveKey = memoryKey();
  const now = new Date().toISOString();
  historyDb.transaction(() => {
    historyDb.prepare(`DELETE FROM standings_snapshots WHERE save_key = ? AND import_stamp = ?`).run(saveKey, importStamp);
    const insert = historyDb.prepare(
      `INSERT INTO standings_snapshots (save_key, import_stamp, game_date, team_id, name, abbr, league_id, sub_league_id, division_id, division,
         w, l, t, pos, division_clubs, gb, runs_scored, runs_allowed, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of rows) {
      insert.run(saveKey, importStamp, gameDate, r.teamId, r.name, r.abbr, r.leagueId, r.subLeagueId, r.divisionId, r.division,
        r.w, r.l, r.t, r.pos, r.divisionClubs, r.gb, r.runsScored, r.runsAllowed, now);
    }
  }).immediate();
  changed();
  return true;
}

function standingsAt(saveKey: string, importStamp: string): StandingsSnapshot | null {
  const rows = historyDb.prepare(`SELECT * FROM standings_snapshots WHERE save_key = ? AND import_stamp = ? ORDER BY team_id`).all(saveKey, importStamp) as Array<Record<string, unknown>>;
  if (!rows.length) return null;
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const s = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  return {
    importStamp,
    gameDate: s(rows[0].game_date),
    recordedAt: String(rows[0].recorded_at),
    rows: rows.map((r) => ({
      teamId: Number(r.team_id), name: s(r.name) ?? `Club ${r.team_id}`, abbr: s(r.abbr), leagueId: n(r.league_id), subLeagueId: n(r.sub_league_id),
      divisionId: n(r.division_id), division: s(r.division), w: n(r.w), l: n(r.l), t: n(r.t), pos: n(r.pos), divisionClubs: n(r.division_clubs),
      gb: n(r.gb), runsScored: n(r.runs_scored), runsAllowed: n(r.runs_allowed),
    })),
  };
}

/** The latest standings snapshot of this save from an import other than `importStamp`; null when none. */
export function previousStandings(importStamp: string | null, saveKey: string = memoryKey()): StandingsSnapshot | null {
  const r = historyDb.prepare(
    `SELECT import_stamp FROM standings_snapshots WHERE save_key = ? AND import_stamp <> ? ORDER BY recorded_at DESC, rowid DESC LIMIT 1`,
  ).get(saveKey, importStamp ?? '') as { import_stamp: string } | undefined;
  return r ? standingsAt(saveKey, r.import_stamp) : null;
}

/** The standings snapshot of this very import; null when it has not been recorded. */
export function standingsOf(importStamp: string, saveKey: string = memoryKey()): StandingsSnapshot | null {
  return standingsAt(saveKey, importStamp);
}

// ── the GM's desk ───────────────────────────────────────────────────────────

/** What the GM did with an item. `open` is the default: an item with no record is open. */
export type DeskStatus = 'open' | 'reviewed' | 'deferred' | 'handled';
export const DESK_STATUSES: readonly DeskStatus[] = ['open', 'reviewed', 'deferred', 'handled'];

export interface DeskRecord {
  itemKey: string;
  status: DeskStatus;
  /** The game date a deferral runs to, as sent (validated through `parseGameDate`); null otherwise. */
  until: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /** The import in force when the status was set. */
  setImport: string | null;
}

const deskRecordOf = (r: Record<string, unknown>): DeskRecord => ({
  itemKey: String(r.item_key),
  status: DESK_STATUSES.includes(r.status as DeskStatus) ? r.status as DeskStatus : 'open',
  until: typeof r.defer_until === 'string' ? r.defer_until : null,
  note: typeof r.note === 'string' && r.note !== '' ? r.note : null,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  setImport: typeof r.set_import === 'string' ? r.set_import : null,
});

/** The club's desk records still in force (their items not yet resolved), by item key. */
export function deskRecords(orgId: number, saveKey: string = memoryKey()): Map<string, DeskRecord> {
  const rows = historyDb.prepare(
    `SELECT * FROM desk_items WHERE save_key = ? AND org_id = ? AND resolved_at IS NULL ORDER BY id`,
  ).all(saveKey, orgId) as Array<Record<string, unknown>>;
  return new Map(rows.map((r) => [String(r.item_key), deskRecordOf(r)]));
}

export interface DeskWrite {
  status: DeskStatus;
  until: string | null;
  /** The note to keep; undefined keeps the note as it is ('' clears it). */
  note?: string;
}

/**
 * Sets an item's status (and note): the record in force is updated, or one is made. Returns the record it replaced (null
 * when the item had none, so it was open with no note) and the new one, so the change can be undone in one step.
 * Nothing about the item itself changes: its severity and its department's answer are the department's (case 15).
 */
export async function setDeskRecord(orgId: number, itemKey: string, write: DeskWrite, importStamp: string | null): Promise<{ previous: DeskRecord | null; now: DeskRecord }> {
  await ensureMemoryBackup();
  const saveKey = memoryKey();
  const now = new Date().toISOString();
  let previous: DeskRecord | null = null;
  historyDb.transaction(() => {
    const row = historyDb.prepare(`SELECT * FROM desk_items WHERE save_key = ? AND org_id = ? AND item_key = ? AND resolved_at IS NULL ORDER BY id DESC LIMIT 1`)
      .get(saveKey, orgId, itemKey) as Record<string, unknown> | undefined;
    previous = row ? deskRecordOf(row) : null;
    const note = write.note === undefined ? previous?.note ?? null : write.note === '' ? null : write.note;
    const until = write.status === 'deferred' ? write.until : null;
    if (row) {
      historyDb.prepare(`UPDATE desk_items SET status = ?, defer_until = ?, note = ?, updated_at = ?, set_import = ? WHERE id = ?`)
        .run(write.status, until, note, now, importStamp, row.id);
    } else {
      historyDb.prepare(
        `INSERT INTO desk_items (save_key, org_id, item_key, status, defer_until, note, created_at, updated_at, set_import) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(saveKey, orgId, itemKey, write.status, until, note, now, now, importStamp);
    }
  }).immediate();
  changed();
  return { previous, now: deskRecords(orgId, saveKey).get(itemKey)! };
}

/**
 * The items an import no longer produces are resolved: a record in force whose item the department was read for and did
 * not raise stops applying, so an item that comes back later is a new item with no status (D-058). A department that
 * could not be read resolves nothing (its absence is not evidence, D-018). Returns how many records were resolved.
 */
export async function resolveDeskRecords(orgId: number, present: ReadonlySet<string>, readDepartments: ReadonlySet<string>, importStamp: string | null): Promise<number> {
  const saveKey = memoryKey();
  const open = [...deskRecords(orgId, saveKey).keys()].filter((key) => readDepartments.has(key.split(':')[0]) && !present.has(key));
  if (!open.length) return 0;
  await ensureMemoryBackup();
  const now = new Date().toISOString();
  historyDb.transaction(() => {
    const resolve = historyDb.prepare(`UPDATE desk_items SET resolved_at = ?, resolved_import = ? WHERE save_key = ? AND org_id = ? AND item_key = ? AND resolved_at IS NULL`);
    for (const key of open) resolve.run(now, importStamp, saveKey, orgId, key);
  }).immediate();
  changed();
  return open.length;
}

// ── following ──────────────────────────────────────────────────────────────

export type FollowKind = 'club' | 'player';

export interface FollowRecord {
  kind: FollowKind;
  id: number;
  name: string | null;
  note: string | null;
  /** How the follow began: the GM, or a copy of his watchlist. */
  source: 'gm' | 'watchlist';
  createdAt: string;
  updatedAt: string;
}

const followOf = (r: Record<string, unknown>): FollowRecord => ({
  kind: r.kind === 'club' ? 'club' : 'player',
  id: Number(r.subject_id),
  name: typeof r.name === 'string' && r.name !== '' ? r.name : null,
  note: typeof r.note === 'string' && r.note !== '' ? r.note : null,
  source: r.source === 'watchlist' ? 'watchlist' : 'gm',
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

let followCache: { key: string; list: FollowRecord[] } | null = null;

/** Everything the GM follows in this save, oldest first. */
export function follows(saveKey: string = memoryKey()): FollowRecord[] {
  if (followCache?.key === saveKey) return followCache.list;
  const list = (historyDb.prepare(`SELECT * FROM following WHERE save_key = ? ORDER BY created_at, kind, subject_id`).all(saveKey) as Array<Record<string, unknown>>).map(followOf);
  followCache = { key: saveKey, list };
  return list;
}

/** The followed clubs and players as sets, for ordering (never for any figure). */
export function followedSets(saveKey: string = memoryKey()): { clubs: Set<number>; players: Set<number> } {
  const list = follows(saveKey);
  return {
    clubs: new Set(list.filter((f) => f.kind === 'club').map((f) => f.id)),
    players: new Set(list.filter((f) => f.kind === 'player').map((f) => f.id)),
  };
}

/** Follows a club or a player (or changes the note of one followed). Returns the record it replaced, and the new one. */
export async function follow(kind: FollowKind, id: number, name: string | null, note: string | undefined): Promise<{ previous: FollowRecord | null; now: FollowRecord }> {
  await ensureMemoryBackup();
  const saveKey = memoryKey();
  const now = new Date().toISOString();
  const row = historyDb.prepare(`SELECT * FROM following WHERE save_key = ? AND kind = ? AND subject_id = ?`).get(saveKey, kind, id) as Record<string, unknown> | undefined;
  const previous = row ? followOf(row) : null;
  const kept = note === undefined ? previous?.note ?? '' : note;
  if (row) {
    historyDb.prepare(`UPDATE following SET name = COALESCE(?, name), note = ?, updated_at = ? WHERE save_key = ? AND kind = ? AND subject_id = ?`)
      .run(name, kept, now, saveKey, kind, id);
  } else {
    historyDb.prepare(`INSERT INTO following (save_key, kind, subject_id, name, note, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'gm', ?, ?)`)
      .run(saveKey, kind, id, name, kept, now, now);
  }
  changed();
  return { previous, now: follows(saveKey).find((f) => f.kind === kind && f.id === id)! };
}

/** Stops following a club or a player; returns the record removed (null when it was not followed). */
export async function unfollow(kind: FollowKind, id: number): Promise<FollowRecord | null> {
  const saveKey = memoryKey();
  const previous = follows(saveKey).find((f) => f.kind === kind && f.id === id) ?? null;
  if (!previous) return null;
  await ensureMemoryBackup();
  historyDb.prepare(`DELETE FROM following WHERE save_key = ? AND kind = ? AND subject_id = ?`).run(saveKey, kind, id);
  changed();
  return previous;
}

/** Puts back a follow exactly as it was (the undo of an unfollow): its note, its source and when it began. */
export async function restoreFollow(record: FollowRecord): Promise<void> {
  await ensureMemoryBackup();
  const saveKey = memoryKey();
  historyDb.prepare(
    `INSERT OR REPLACE INTO following (save_key, kind, subject_id, name, note, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(saveKey, record.kind, record.id, record.name, record.note ?? '', record.source, record.createdAt, new Date().toISOString());
  changed();
}

/** What the last copy of the watchlist found: rows copied, and rows left because the player isn't this league's. */
export interface WatchlistCopy {
  copied: number;
  /** Watchlist rows of this save's name whose player this league doesn't have under that name (another save's). */
  notInLeague: number;
  /** Whether the copy could look at all (the league is certainly the save's, and it has players). */
  looked: boolean;
}

/**
 * Copies the watchlist into Following (D-058): the watchlist rows filed under the served save's own name (the name the
 * Electron build files them under), for players this league has under the same name, with their notes and when they
 * were added. Each row is copied once per save (recorded), so a player the GM stops following is never copied back; the
 * watchlist itself is left exactly as it is. A row whose player this league doesn't have, or has under another name,
 * belongs to another save of the same name and is left where it is. Only while the league is certainly the save's own.
 */
export async function copyWatchlist(): Promise<WatchlistCopy> {
  const result = await copyWatchlistNow();
  if (result.looked) lastWatchlistCopy = { key: memoryKey(), notInLeague: result.notInLeague };
  return result;
}

/** What the last look at the watchlist left uncopied (rows of another save of the same name), per save. */
let lastWatchlistCopy: { key: string; notInLeague: number } | null = null;

/** The watchlist's rows copied into this save's Following, ever, and those the last look left (another save's). */
export function watchlistCopies(saveKey: string = memoryKey()): { copied: number; notInLeague: number; looked: boolean } {
  const copied = (historyDb.prepare(`SELECT COUNT(*) AS n FROM following_watchlist_copies WHERE save_key = ?`).get(saveKey) as { n: number }).n;
  const last = lastWatchlistCopy?.key === saveKey ? lastWatchlistCopy : null;
  return { copied, notInLeague: last?.notInLeague ?? 0, looked: last !== null };
}

async function copyWatchlistNow(): Promise<WatchlistCopy> {
  const name = rollbackName();
  if (name === null) return { copied: 0, notInLeague: 0, looked: false };
  const saveKey = memoryKey();
  const pending = historyDb.prepare(
    `SELECT w.player_id, w.name, w.note, w.added_at, w.updated_at FROM watchlist w
     WHERE w.save_name = ? AND NOT EXISTS (SELECT 1 FROM following_watchlist_copies c WHERE c.save_key = ? AND c.player_id = w.player_id)`,
  ).all(name, saveKey) as Array<{ player_id: number; name: string | null; note: string | null; added_at: string | null; updated_at: string | null }>;
  if (!pending.length) return { copied: 0, notInLeague: 0, looked: true };
  const league = leaguePlayerNames();
  if (!league) return { copied: 0, notInLeague: 0, looked: false };
  const same = pending.filter((w) => {
    const here = league.get(Number(w.player_id));
    return here !== undefined && looseName(here) !== null && looseName(here) === looseName(w.name);
  });
  if (!same.length) return { copied: 0, notInLeague: pending.length, looked: true };
  await ensureMemoryBackup();
  const now = new Date().toISOString();
  historyDb.transaction(() => {
    const insert = historyDb.prepare(
      `INSERT OR IGNORE INTO following (save_key, kind, subject_id, name, note, source, created_at, updated_at) VALUES (?, 'player', ?, ?, ?, 'watchlist', ?, ?)`,
    );
    const record = historyDb.prepare(`INSERT OR IGNORE INTO following_watchlist_copies (save_key, player_id, save_name, copied_at) VALUES (?, ?, ?, ?)`);
    for (const w of same) {
      insert.run(saveKey, w.player_id, w.name, w.note ?? '', w.added_at ?? now, w.updated_at ?? w.added_at ?? now);
      record.run(saveKey, w.player_id, name, now);
    }
  }).immediate();
  changed();
  return { copied: same.length, notInLeague: pending.length - same.length, looked: true };
}

/** For the tests: forget the cached follows (a test changed the save or wrote the tables itself). */
export function forgetMemoryCaches(): void {
  followCache = null;
  revision += 1;
}
