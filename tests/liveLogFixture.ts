import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { liveDatabaseFiles, type LiveDatabaseFiles } from '../server/ootpSave.js';

/**
 * A synthetic OOTP save on disk: `<Name>.lg/` with the export folder, the
 * simulated-date file, and a live transaction database in `temp/` shaped like
 * the one a real save keeps there. Nothing is copied from anyone's save.
 *
 * The database is a real WAL-mode SQLite file, so a writer left open leaves a
 * real `-wal` and `-shm` beside it, exactly as OOTP does while it runs.
 */

export const link = {
  player: (id: number, name: string) => `<a href="../players/player_${id}.html">${name}</a>`,
  team: (id: number, name: string) => `<a href="../teams/team_${id}.html">${name}</a>`,
};

/** Sentences worded as the real log words them. */
export const tx = {
  rehabSent: (p: [number, string], pos: string, club: [number, string]) =>
    `Sent ${pos} ${link.player(...p)} to Triple A ${link.team(...club)} for injury rehab.`,
  rehabReceived: (p: [number, string], pos: string, parent: [number, string]) =>
    `Received ${pos} ${link.player(...p)} from Major League ${link.team(...parent)} for injury rehab.`,
  rehabReturned: (p: [number, string], pos: string) =>
    `${pos} ${link.player(...p)} returns from his rehab assignment.`,
  optioned: (p: [number, string], pos: string, club: [number, string]) =>
    `Optioned ${pos} ${link.player(...p)} to Triple A ${link.team(...club)}.`,
  recalled: (p: [number, string], pos: string, club: [number, string]) =>
    `Recalled ${pos} ${link.player(...p)} from Triple A ${link.team(...club)}.`,
  promotedToMlb: (p: [number, string], pos: string, parent: [number, string]) =>
    `Promoted ${pos} ${link.player(...p)} to Major League ${link.team(...parent)}.`,
  purchased: (p: [number, string], pos: string, club: [number, string]) =>
    `Purchased the contract of ${pos} ${link.player(...p)} from Triple A ${link.team(...club)}.`,
  dfa: (p: [number, string], pos: string, irrevocable = true) =>
    `${pos} ${link.player(...p)} was designated for assignment and placed on ${irrevocable ? 'irrevocable waivers' : 'waivers'}.`,
  ilPlaced: (p: [number, string], pos: string, retro = '05/14/2030') =>
    `Placed ${pos} ${link.player(...p)} on the 15-day injured list, retroactive to ${retro}.`,
  ilActivated: (p: [number, string], pos: string) =>
    `Activated ${pos} ${link.player(...p)} from the injured list.`,
  restricted: (p: [number, string], pos: string) =>
    `Placed ${pos} ${link.player(...p)} on the restricted list.`,
  released: (p: [number, string], pos: string) => `Released ${pos} ${link.player(...p)}.`,
  signed: (p: [number, string], pos: string) =>
    `Signed free agent ${pos} ${link.player(...p)} to a minor league contract.`,
};

export interface LogRow {
  /** `YYYYMMDD`, as OOTP stores it. */
  date: string;
  text: string | Buffer;
  teamId?: number;
  type?: number;
}

export interface FakeSave {
  root: string;
  lg: string;
  csvDir: string;
  files: LiveDatabaseFiles;
  /** The open writer, when `keepWriterOpen` was asked for. */
  writer: InstanceType<typeof Database> | null;
  /** Adds rows through the writer, or opens one briefly. */
  add(rows: LogRow[]): void;
  /** Closes the writer, leaving a checkpointed database with no WAL. */
  closeWriter(): void;
  cleanup(): void;
}

/** The seven bytes OOTP writes: day, month, year (little-endian 16-bit), three zeros. */
export const simulatedDateBytes = (year: number, month: number, day: number): Buffer =>
  Buffer.from([day, month, year & 0xff, (year >> 8) & 0xff, 0, 0, 0]);

const SCHEMA = `
  CREATE TABLE league_transactions (transaction_id INTEGER PRIMARY KEY AUTOINCREMENT, league_id INTEGER, transaction_date VARCHAR(8), transaction_type INTEGER DEFAULT 0, transaction_text TEXT, season INTEGER);
  CREATE TABLE team_transactions (transaction_id INTEGER PRIMARY KEY AUTOINCREMENT, team_id INTEGER, transaction_date VARCHAR(8), transaction_type INTEGER DEFAULT 0, transaction_text TEXT, season INTEGER);
  CREATE INDEX team_transactions_season ON team_transactions(season);
  CREATE TABLE league_news (news_id INTEGER PRIMARY KEY AUTOINCREMENT, league_id INTEGER, news_date VARCHAR(8), news_text TEXT, season INTEGER);
  CREATE TABLE league_injuries (injury_id INTEGER PRIMARY KEY AUTOINCREMENT, league_id INTEGER, injury_date VARCHAR(8), injury_text TEXT, season INTEGER);
  CREATE TABLE player_history (history_id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER, history_date VARCHAR(8), history_text TEXT, season INTEGER);
`;

export function insertRows(db: InstanceType<typeof Database>, rows: LogRow[]): void {
  const insert = db.prepare(
    `INSERT INTO team_transactions (team_id, transaction_date, transaction_type, transaction_text, season)
     VALUES (?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    for (const row of rows) {
      insert.run(row.teamId ?? 1, row.date, row.type ?? 0, row.text, Number(row.date.slice(0, 4)));
    }
  })();
}

export function makeSave(
  opts: {
    name?: string;
    /** The simulated date to write, or null to leave the date file out. */
    simulated?: [year: number, month: number, day: number] | null;
    /** Skip the live database entirely. */
    withLog?: boolean;
    keepWriterOpen?: boolean;
    rows?: LogRow[];
  } = {}
): FakeSave {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-fake-ootp-'));
  const lg = path.join(root, `${opts.name ?? 'Test Save'}.lg`);
  const csvDir = path.join(lg, 'import_export', 'csv');
  fs.mkdirSync(csvDir, { recursive: true });
  fs.mkdirSync(path.join(lg, 'settings'), { recursive: true });
  fs.mkdirSync(path.join(lg, 'temp'), { recursive: true });
  fs.writeFileSync(path.join(csvDir, 'players.csv'), 'player_id\n1\n');
  const simulated = opts.simulated === undefined ? ([2030, 5, 31] as const) : opts.simulated;
  if (simulated) {
    fs.writeFileSync(path.join(lg, 'settings', 'last_date_simulated.dat'), simulatedDateBytes(...simulated));
  }

  const files = liveDatabaseFiles(lg);
  let writer: InstanceType<typeof Database> | null = null;

  if (opts.withLog !== false) {
    writer = new Database(files.db);
    writer.pragma('journal_mode = WAL');
    // Keep frames in the WAL, as a busy OOTP does, rather than folding them in
    writer.pragma('wal_autocheckpoint = 0');
    writer.exec(SCHEMA);
    if (opts.rows?.length) insertRows(writer, opts.rows);
    // Whatever is added after this exists only in the WAL until the writer closes
    writer.pragma('wal_checkpoint(TRUNCATE)');
    if (!opts.keepWriterOpen) {
      writer.close();
      writer = null;
    }
  }

  const save: FakeSave = {
    root,
    lg,
    csvDir,
    files: liveDatabaseFiles(lg),
    writer,
    add(rows) {
      if (save.writer) {
        insertRows(save.writer, rows);
        return;
      }
      const brief = new Database(files.db);
      insertRows(brief, rows);
      brief.close();
    },
    closeWriter() {
      save.writer?.close();
      save.writer = null;
    },
    cleanup() {
      try {
        save.writer?.close();
      } catch {
        // Already closed
      }
      fs.chmodSync(root, 0o755);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  return save;
}

/** Stable fingerprint of every file under a directory: name, size, mtime, content hash. */
export function fingerprint(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        out.push(`${path.relative(dir, full)}/`);
        walk(full);
      } else {
        const hash = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        out.push(`${path.relative(dir, full)}|${st.size}|${st.mtimeMs}|${hash}`);
      }
    }
  };
  walk(dir);
  return out;
}
