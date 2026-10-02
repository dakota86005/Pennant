import Database from 'better-sqlite3';
import { Router } from 'express';
import path from 'node:path';
import { db as leagueDb, importRecord, tableExists } from './db.js';
import { DATA_DIR, loadConfig } from './config.js';
import { evidenceRecord, isModeSwitch, ratingModeNamed, type RatingMode, type RatingModeRecord } from './ratingMode.js';
import { evidenceRatingMode, inPopulationView, populationSource, ratingFrom, ratingsFromOf } from './scoutedEvidence.js';
import { boundKeyNow, currentHistoryKey, historyNote, releaseCarried, releaseCarriedPopulation, rollbackName, servedLeagueCertain } from './historyIdentity.js';

/**
 * Persistent store that SURVIVES reimports (league.db is rebuilt on every
 * import). Holds rating snapshots for development tracking and the watchlist.
 */
export const historyDb = new Database(path.join(DATA_DIR, 'history.db'));
historyDb.pragma('journal_mode = WAL');
historyDb.exec(`
  CREATE TABLE IF NOT EXISTS rating_snapshots (
    save_name TEXT NOT NULL,
    game_date TEXT NOT NULL,
    player_id INTEGER NOT NULL,
    name TEXT,
    team_id INTEGER,
    org_id INTEGER,
    level INTEGER,
    position INTEGER,
    age INTEGER,
    con REAL, gap REAL, pow REAL, eye REAL, avk REAL, spd REAL,
    conP REAL, gapP REAL, powP REAL, eyeP REAL, avkP REAL,
    stu REAL, mov REAL, ctl REAL,
    stuP REAL, movP REAL, ctlP REAL,
    cur REAL, pot REAL,
    PRIMARY KEY (save_name, game_date, player_id)
  );
  CREATE INDEX IF NOT EXISTS idx_snap_player ON rating_snapshots (save_name, player_id, game_date);
  CREATE TABLE IF NOT EXISTS watchlist (
    save_name TEXT NOT NULL,
    player_id INTEGER NOT NULL,
    name TEXT,
    note TEXT DEFAULT '',
    added_at TEXT,
    updated_at TEXT,
    PRIMARY KEY (save_name, player_id)
  );
  /*
   * Notes kept on a player, one row each rather than one field overwritten.
   *
   * The watchlist already had a note, but it holds a single string tied to
   * watching the man — no good for the thing this is actually for, which is
   * keeping what a member of staff told you. A pitch-count plan for a starter
   * coming off the injured list is worth nothing in a chat thread you will
   * have scrolled past by the time he is throwing again; it belongs on his
   * page, with who said it and the date of the game when they did.
   *
   * Lives in history.db so it survives re-importing the save, which wipes and
   * rebuilds the league database entirely.
   */
  CREATE TABLE IF NOT EXISTS player_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    save_name TEXT NOT NULL,
    player_id INTEGER NOT NULL,
    player_name TEXT,
    source TEXT,
    body TEXT NOT NULL,
    game_date TEXT,
    created_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_notes_player ON player_notes (save_name, player_id);
`);

/**
 * Tools a snapshot keeps since cycle 4 of the per-save calibration (D-053): a hitter's tools against left- and right-handed pitching and
 * his baserunning and stealing ratings. A per-save check of the platoon read's rating weight and of the running model needs them as they
 * stood BEFORE a season, and nothing else in the export keeps them, so every import without them is evidence lost for good. Additive and
 * nullable: added to an existing table when absent; a snapshot taken before they existed reads them as unknown, never as zero.
 */
export const SNAPSHOT_SPLIT_COLUMNS = ['lcon', 'lgap', 'lpow', 'leye', 'lavk', 'rcon', 'rgap', 'rpow', 'reye', 'ravk'] as const;
export const SNAPSHOT_RUNNING_COLUMNS = ['brn', 'stl'] as const;
{
  const present = new Set((historyDb.prepare(`PRAGMA table_info(rating_snapshots)`).all() as Array<{ name: string }>).map((c) => c.name));
  for (const column of [...SNAPSHOT_SPLIT_COLUMNS, ...SNAPSHOT_RUNNING_COLUMNS]) {
    if (!present.has(column)) historyDb.exec(`ALTER TABLE rating_snapshots ADD COLUMN ${column} REAL`);
  }
  // Where each player's ratings came from (D-067): our scouts' full reports or OSA's view filling in; null before it was kept
  if (!present.has('src')) historyDb.exec(`ALTER TABLE rating_snapshots ADD COLUMN src TEXT`);
}

/*
 * Which kind of ratings each rating snapshot holds (D-061): the export's rating mode, read from OOTP's export settings
 * at the import that took the snapshot. Additive: its own table keyed like the snapshots (save, game date), never a
 * column on them. A snapshot taken before this table existed has no row: its mode is unrecorded, which is never
 * evidence of a switch. Two snapshots in different KNOWN modes are a switch, and a switch is never read as development.
 */
historyDb.exec(`
  CREATE TABLE IF NOT EXISTS rating_snapshot_modes (
    save_name TEXT NOT NULL,
    game_date TEXT NOT NULL,
    mode TEXT NOT NULL,
    additional_scouted INTEGER,
    source TEXT,
    import_started_at TEXT,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (save_name, game_date)
  );
`);

/*
 * Rating history keyed by the save's identity (D-064), not its name. Two saves can share a name (OOTP names every new
 * league "New Game"), and `rating_snapshots` is keyed by the name, so two such saves would read each other's ratings as
 * development, and a snapshot of one on a date the other also has would overwrite part of the other's. These tables are
 * new and additive: the tables above keep their shape and meaning, and the earlier (Electron) build keeps reading and
 * writing them under the name. This build reads only these; it writes each snapshot here AND, as the earlier build
 * would, under the name (so a rolled-back Electron build still sees it; its own same-name defect stays its own). The
 * earlier rows are brought over for a save only where they are certainly its own (`historyIdentity.ts`); the rest stay
 * where they are, unused. `history_dual_writes` names the dates this build wrote under a name, which are never taken
 * for earlier history; `history_offer_choices` records the GM's answer to "is this the save that used to be at...?".
 *
 * `history_saves` names each save's history (its key, the folder it was last seen in, and why it began), and
 * `history_legacy_review` records, for each save and each date of the name-keyed history, whether its rows were brought
 * over and why, and against which import, so a date is brought over once, a date left unused is looked at again only
 * against another import, and a crash part way through resumes where it stopped.
 */
/** Every column a rating snapshot keeps besides its save, in both tables (the legacy one has them since cycle 4 of D-053). */
export const SNAPSHOT_DATA_COLUMNS = [
  'game_date', 'player_id', 'name', 'team_id', 'org_id', 'level', 'position', 'age',
  'con', 'gap', 'pow', 'eye', 'avk', 'spd', 'conP', 'gapP', 'powP', 'eyeP', 'avkP',
  'stu', 'mov', 'ctl', 'stuP', 'movP', 'ctlP', 'cur', 'pot',
  ...SNAPSHOT_SPLIT_COLUMNS, ...SNAPSHOT_RUNNING_COLUMNS, 'src',
] as const;
historyDb.exec(`
  CREATE TABLE IF NOT EXISTS save_rating_snapshots (
    save_key TEXT NOT NULL,
    game_date TEXT NOT NULL,
    player_id INTEGER NOT NULL,
    name TEXT,
    team_id INTEGER,
    org_id INTEGER,
    level INTEGER,
    position INTEGER,
    age INTEGER,
    con REAL, gap REAL, pow REAL, eye REAL, avk REAL, spd REAL,
    conP REAL, gapP REAL, powP REAL, eyeP REAL, avkP REAL,
    stu REAL, mov REAL, ctl REAL,
    stuP REAL, movP REAL, ctlP REAL,
    cur REAL, pot REAL,
    ${[...SNAPSHOT_SPLIT_COLUMNS, ...SNAPSHOT_RUNNING_COLUMNS].map((c) => `${c} REAL`).join(', ')},
    src TEXT,
    PRIMARY KEY (save_key, game_date, player_id)
  );
  CREATE INDEX IF NOT EXISTS idx_save_snap_player ON save_rating_snapshots (save_key, player_id, game_date);
  CREATE TABLE IF NOT EXISTS save_rating_snapshot_modes (
    save_key TEXT NOT NULL,
    game_date TEXT NOT NULL,
    mode TEXT NOT NULL,
    additional_scouted INTEGER,
    source TEXT,
    import_started_at TEXT,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (save_key, game_date)
  );
  CREATE TABLE IF NOT EXISTS history_saves (
    save_key TEXT PRIMARY KEY,
    folder_id TEXT NOT NULL,
    folder_path TEXT,
    save_name TEXT,
    bound INTEGER NOT NULL DEFAULT 1,
    origin TEXT NOT NULL,
    replaces TEXT,
    refused_at TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_history_saves_folder ON history_saves (folder_id, bound);
  CREATE TABLE IF NOT EXISTS history_legacy_review (
    save_key TEXT NOT NULL,
    legacy_name TEXT NOT NULL,
    game_date TEXT NOT NULL,
    verdict TEXT NOT NULL,
    reason TEXT NOT NULL,
    rows_total INTEGER NOT NULL,
    rows_attributed INTEGER NOT NULL,
    compared INTEGER,
    matched INTEGER,
    league_import TEXT,
    reviewed_at TEXT NOT NULL,
    PRIMARY KEY (save_key, legacy_name, game_date)
  );
  CREATE TABLE IF NOT EXISTS history_identity_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS history_dual_writes (
    save_name TEXT NOT NULL,
    game_date TEXT NOT NULL,
    save_key TEXT NOT NULL,
    written_at TEXT NOT NULL,
    PRIMARY KEY (save_name, game_date)
  );
  CREATE TABLE IF NOT EXISTS history_offer_choices (
    save_key TEXT NOT NULL,
    candidate_key TEXT NOT NULL,
    choice TEXT NOT NULL,
    chosen_at TEXT NOT NULL,
    PRIMARY KEY (save_key, candidate_key)
  );
  CREATE TABLE IF NOT EXISTS history_carry_overs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    save_key TEXT NOT NULL,
    from_key TEXT NOT NULL,
    from_name TEXT,
    from_path TEXT,
    through_date TEXT,
    rows_copied INTEGER NOT NULL,
    mode_dates TEXT NOT NULL,
    backup TEXT,
    carried_at TEXT NOT NULL,
    undone_at TEXT
  );
  CREATE TABLE IF NOT EXISTS history_carried_rows (
    carry_id INTEGER NOT NULL,
    game_date TEXT NOT NULL,
    player_id INTEGER NOT NULL,
    PRIMARY KEY (carry_id, game_date, player_id)
  );
  /*
   * Which save each roster-state snapshot belongs to (D-064): its history key, not its name, so two saves that share a
   * name are never compared with each other. The snapshot rows (rosterStateHistory.ts) keep a name as before; one
   * taken before this table existed has no row here and is never a comparator for any save.
   */
  CREATE TABLE IF NOT EXISTS roster_state_snapshot_saves (
    snapshot_id INTEGER PRIMARY KEY,
    save_key TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_roster_state_snapshot_saves_key
    ON roster_state_snapshot_saves (save_key, snapshot_id);
`);

{
  // A data folder that ran an earlier build of this branch has history_saves without the later columns: added, nullable
  const present = new Set((historyDb.prepare(`PRAGMA table_info(history_saves)`).all() as Array<{ name: string }>).map((c) => c.name));
  for (const column of ['replaces', 'refused_at']) if (!present.has(column)) historyDb.exec(`ALTER TABLE history_saves ADD COLUMN ${column} TEXT`);
}
{
  // A save's snapshots kept before D-067 have no per-player source: added, null (never evidence of a source switch)
  const present = new Set((historyDb.prepare(`PRAGMA table_info(save_rating_snapshots)`).all() as Array<{ name: string }>).map((c) => c.name));
  if (!present.has('src')) historyDb.exec(`ALTER TABLE save_rating_snapshots ADD COLUMN src TEXT`);
}

/*
 * OSA's view of every player at each snapshot, when it is the league's yardstick and the evidence is another source
 * (D-068): the history the per-save fits read, kept apart from the evidence's snapshots so each stays in one source.
 * `kind` is the population source's id (`populationSource().id`); a fit reads only rows of the kind it is fitted on.
 */
historyDb.exec(`
  CREATE TABLE IF NOT EXISTS save_population_snapshots (
    save_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    game_date TEXT NOT NULL,
    player_id INTEGER NOT NULL,
    name TEXT, team_id INTEGER, org_id INTEGER, level INTEGER, position INTEGER, age INTEGER,
    con REAL, gap REAL, pow REAL, eye REAL, avk REAL, spd REAL,
    conP REAL, gapP REAL, powP REAL, eyeP REAL, avkP REAL,
    stu REAL, mov REAL, ctl REAL, stuP REAL, movP REAL, ctlP REAL,
    cur REAL, pot REAL,
    ${[...SNAPSHOT_SPLIT_COLUMNS, ...SNAPSHOT_RUNNING_COLUMNS].map((c) => `${c} REAL`).join(', ')},
    PRIMARY KEY (save_key, kind, game_date, player_id)
  );
  CREATE INDEX IF NOT EXISTS idx_save_population_player ON save_population_snapshots (save_key, kind, player_id, game_date);
  /* The population rows a carry-over copied (D-064, review M4), by kind, so its undo removes exactly those. */
  CREATE TABLE IF NOT EXISTS history_carried_population_rows (
    carry_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    game_date TEXT NOT NULL,
    player_id INTEGER NOT NULL,
    PRIMARY KEY (carry_id, kind, game_date, player_id)
  );
`);

/** A population snapshot's data columns: the evidence snapshot's, without the per-player source (one kind per row). */
export const POPULATION_DATA_COLUMNS = SNAPSHOT_DATA_COLUMNS.filter((c) => c !== 'src');

/**
 * Records the rating mode of the snapshot of `gameDate` (replacing it, as the snapshot itself is replaced on a re-import
 * of that date). No record (an import from before N3.5 recorded none) stamps nothing: the snapshot stays unrecorded,
 * never `unknown`, which would leave it out of development (N3.5 B2 review).
 */
export function stampSnapshotMode(gameDate: string, record: RatingModeRecord | null, importStartedAt: string | null): void {
  if (!record) return;
  const values = [
    gameDate, record.mode,
    record.additionalScouted === null || record.additionalScouted === undefined ? null : record.additionalScouted ? 1 : 0,
    record.source ?? null, importStartedAt, new Date().toISOString(),
  ];
  const resolved = currentHistoryKey();
  const name = rollbackName();
  historyDb.transaction(() => {
    // The key still bound for this save now (another thread may have answered a question since this one resolved it)
    const saveKey = boundKeyNow(resolved);
    if (saveKey === null) return;
    historyDb
      .prepare(
        `INSERT OR REPLACE INTO save_rating_snapshot_modes
         (save_key, game_date, mode, additional_scouted, source, import_started_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(saveKey, ...values);
    // The save's own stamp now: no carry-over's undo removes it
    releaseCarried(saveKey, gameDate, null);
    // And under the served save's name, as the earlier build writes it, so a rolled-back Electron build reads it (D-064);
    // never when the league served isn't certainly the configured save's
    if (name === null) return;
    historyDb
      .prepare(
        `INSERT OR REPLACE INTO rating_snapshot_modes
         (save_name, game_date, mode, additional_scouted, source, import_started_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      // An earlier build doesn't know our scouts' full reports as a kind (D-067): it reads them as a kind it never compares
      .run(name, values[0], record.mode === 'scouted-complete' ? 'unknown' : record.mode, ...values.slice(2));
  }).immediate();
}

/** The recorded rating mode of each snapshot date of this save (dates as the snapshots store them); unrecorded dates are absent. */
export function snapshotModes(): Map<string, RatingMode> {
  const rows = historyDb
    .prepare(`SELECT game_date, mode FROM save_rating_snapshot_modes WHERE save_key = ?`)
    .all(currentHistoryKey()) as Array<{ game_date: string; mode: string }>;
  return new Map(rows.map((r) => [r.game_date, r.mode as RatingMode]));
}

/** The rating mode of the export imported now (its own record of its import), or null for an import from before N3.5. */
export function currentRatingMode(): RatingModeRecord | null {
  const record = importRecord()?.ratingMode;
  return record && typeof record === 'object' && typeof (record as RatingModeRecord).mode === 'string' ? (record as RatingModeRecord) : null;
}

/** A switch in the kind of ratings, as rating history shows it. */
export interface RatingModeSwitch {
  /** The last snapshot before the switch, and the first after it (game dates as stored). */
  before: string;
  after: string;
  fromMode: RatingMode;
  toMode: RatingMode;
  /** The switch in words. */
  text: string;
}

/**
 * The snapshot dates rating history reads now: every date except those recorded in a known mode other than the
 * current export's (a switch, never development). With no known current mode no known one is left out: an unknown mode
 * is not evidence of a switch. A snapshot stamped "no ratings" is always left out, and so is one stamped with an
 * unknown kind (N3.5 Stage B2, D-018): its ratings may be of another kind, so comparing it could read a switch as
 * movement. Returns the dates left out, the switches and the unknown-kind dates, for the reasons a consumer shows.
 */
export function modeFilter(): { excluded: Set<string>; switches: RatingModeSwitch[]; unknownKind: string[] } {
  // The kind the evidence is read in now: our scouts' full reports when the export carries them (D-067), else the export's
  const current = evidenceRatingMode();
  const modes = snapshotModes();
  const excluded = new Set<string>();
  if (current && current !== 'unknown') for (const [date, mode] of modes) if (isModeSwitch(mode, current)) excluded.add(date);
  // A snapshot of an export that carried no ratings observes none, whatever its columns hold (D-018)
  for (const [date, mode] of modes) if (mode === 'none') excluded.add(date);
  const unknownKind = [...modes].filter(([, mode]) => mode === 'unknown').map(([date]) => date).sort(compareGameDates);
  for (const date of unknownKind) excluded.add(date);
  return { excluded, switches: modeSwitches(modes), unknownKind };
}

/** Why the snapshots of an unknown kind are left out, in a sentence; null when there are none. */
export function unknownKindReason(dates: readonly string[]): string | null {
  if (dates.length === 0) return null;
  const list = dates.length <= 3 ? dates.join(', ') : `${dates.slice(0, 3).join(', ')} and ${dates.length - 3} more`;
  return `The kind of ratings in the snapshot${dates.length === 1 ? '' : 's'} of ${list} couldn't be read, so ${dates.length === 1 ? 'it is' : 'they are'} not compared.`;
}

/** Every switch between consecutive snapshots in known, different modes. */
export function modeSwitches(modes: Map<string, RatingMode> = snapshotModes()): RatingModeSwitch[] {
  const dates = [...modes.keys()].sort(compareGameDates);
  const out: RatingModeSwitch[] = [];
  let last: { date: string; mode: RatingMode } | null = null;
  for (const date of dates) {
    const mode = modes.get(date)!;
    if (mode === 'unknown') continue;
    if (last && isModeSwitch(last.mode, mode)) {
      out.push({
        before: last.date, after: date, fromMode: last.mode, toMode: mode,
        text: `The kind of ratings changed between ${last.date} and ${date}, from ${ratingModeNamed(last.mode)} to ${ratingModeNamed(mode)}: the change is a switch, not development.`,
      });
    }
    last = { date, mode };
  }
  return out;
}

/** A player's ratings source in the GM's words (D-067). */
const SOURCE_NAMES: Record<string, string> = { our_scouts: 'our scouts\' full reports', osa: 'OSA\'s view' };

/** A recorded per-player source (D-067), or null when the row kept none (never evidence of a switch). */
const recordedSource = (src: unknown): 'our_scouts' | 'osa' | null => (src === 'our_scouts' || src === 'osa' ? src : null);

/** One player's change of ratings source between two of his snapshots, in a sentence: a switch, never development. */
export function sourceSwitchText(from: 'our_scouts' | 'osa', to: 'our_scouts' | 'osa'): string {
  return `His ratings changed source, from ${SOURCE_NAMES[from]} to ${SOURCE_NAMES[to]}: the change is a switch, not development.`;
}

/**
 * Whether a snapshot row's recorded source differs from this player's source now (D-067): then the row is another
 * source's view of him, left out of his trend and observed history as a snapshot in another kind is (D-061). Only while
 * our scouts' full reports are the evidence (otherwise those snapshots are another kind altogether); a row with no
 * recorded source is never evidence of a switch.
 */
export function otherSource(playerId: number, src: unknown): 'our_scouts' | 'osa' | null {
  const recorded = recordedSource(src);
  if (!recorded || evidenceRatingMode() !== 'scouted-complete') return null;
  const now = ratingsFromOf(playerId);
  return now !== 'export' && now !== recorded ? recorded : null;
}

/**
 * The configured save's name. Rating history is no longer filed under it (D-064: `currentHistoryKey()`); the watchlist and
 * player notes still are, and the name-keyed rating history written before D-064 is looked up by it.
 */
export function currentSaveName(): string {
  return loadConfig().saveName ?? 'unknown';
}

/** The imported league's current game date, as the export writes it (the date a snapshot is filed under); null when none. */
export function snapshotGameDate(): string | null {
  return leagueGameDate();
}

function leagueGameDate(): string | null {
  try {
    const row = leagueDb
      .prepare(
        `SELECT "current_date" AS d FROM leagues WHERE league_id IN
         (SELECT DISTINCT league_id FROM teams WHERE level = 1) LIMIT 1`
      )
      .get() as { d: string } | undefined;
    return row?.d ?? null;
  } catch {
    return null;
  }
}

/** The ratings a snapshot keeps for every rostered player, read from the given sources (the evidence's or the league's population view). */
function snapshotRows(
  battingFrom: { from: string; columns: Set<string> },
  pitchingFrom: { from: string; columns: Set<string> } | null,
): Array<Record<string, number | string | null>> {
  // The split and running columns are read where the export has them; a missing one is stored as unknown (NULL), never guessed
  const battingColumns = battingFrom.columns;
  const optional = (column: string, as: string) => (battingColumns.has(column) ? `b.${column} AS ${as}` : `NULL AS ${as}`);
  const splitSelect = (['l', 'r'] as const).flatMap((side) => (['contact', 'gap', 'power', 'eye', 'strikeouts'] as const).map((tool, i) =>
    optional(`batting_ratings_vs${side}_${tool}`, `${side}${['con', 'gap', 'pow', 'eye', 'avk'][i]}`)));
  const runningSelect = [optional('running_ratings_baserunning', 'brn'), optional('running_ratings_stealing', 'stl')];
  return leagueDb
    .prepare(
      `SELECT p.player_id, p.first_name || ' ' || p.last_name AS name, p.team_id,
              p.organization_id AS org_id, t.level, p.position, p.age,
              b.batting_ratings_overall_contact AS con, b.batting_ratings_overall_gap AS gap,
              b.batting_ratings_overall_power AS pow, b.batting_ratings_overall_eye AS eye,
              b.batting_ratings_overall_strikeouts AS avk, b.running_ratings_speed AS spd,
              b.batting_ratings_talent_contact AS conP, b.batting_ratings_talent_gap AS gapP,
              b.batting_ratings_talent_power AS powP, b.batting_ratings_talent_eye AS eyeP,
              b.batting_ratings_talent_strikeouts AS avkP,
              pi.pitching_ratings_overall_stuff AS stu, pi.pitching_ratings_overall_movement AS mov,
              pi.pitching_ratings_overall_control AS ctl,
              pi.pitching_ratings_talent_stuff AS stuP, pi.pitching_ratings_talent_movement AS movP,
              pi.pitching_ratings_talent_control AS ctlP,
              ${[...splitSelect, ...runningSelect].join(', ')}
       FROM players p
       JOIN teams t ON t.team_id = p.team_id
       LEFT JOIN ${battingFrom.from} b ON b.player_id = p.player_id
       LEFT JOIN ${pitchingFrom?.from ?? '(SELECT NULL AS player_id WHERE 0)'} pi ON pi.player_id = p.player_id
       WHERE p.retired = 0 AND p.team_id > 0`
    )
    .all() as Array<Record<string, number | string | null>>;
}

/** Capture a ratings snapshot of every rostered player. Idempotent per game date. */
export function takeSnapshot(): { gameDate: string; players: number; ourScouts: boolean; evidenceMode: RatingMode | null } | null {
  // The ratings the evidence reads: our scouts' full reports when the export carries them (D-067), else the main tables
  const battingFrom = ratingFrom('batting');
  const pitchingFrom = ratingFrom('pitching');
  if (!tableExists('players') || !battingFrom) return null;
  // The kind the evidence is read in (our scouts' reports, OSA's view in place of true ratings, else the export's): the stamp
  const evidenceMode = evidenceRatingMode();
  const ourScouts = evidenceMode === 'scouted-complete';
  const gameDate = leagueGameDate();
  if (!gameDate) return null;
  const resolved = currentHistoryKey();
  const saveName = rollbackName();

  const rows = snapshotRows(battingFrom, pitchingFrom);
  // OSA's view of every player too, when it is the league's yardstick and differs from the evidence (D-068): the fits'
  // history, kept apart so the evidence's snapshots stay in one source
  const population = populationSource();
  const populationRows = population.id === 'osa_file'
    ? inPopulationView(() => {
      const b = ratingFrom('batting');
      return b ? snapshotRows(b, ratingFrom('pitching')) : [];
    })
    : [];

  const insertInto = (table: string, keyColumn: string) => historyDb.prepare(
    `INSERT OR REPLACE INTO ${table}
     (${keyColumn}, game_date, player_id, name, team_id, org_id, level, position, age,
      con, gap, pow, eye, avk, spd, conP, gapP, powP, eyeP, avkP,
      stu, mov, ctl, stuP, movP, ctlP, cur, pot,
      ${[...SNAPSHOT_SPLIT_COLUMNS, ...SNAPSHOT_RUNNING_COLUMNS].join(', ')}, src)
     VALUES (${new Array(29 + SNAPSHOT_SPLIT_COLUMNS.length + SNAPSHOT_RUNNING_COLUMNS.length).fill('?').join(', ')})`
  );
  const insert = insertInto('save_rating_snapshots', 'save_key');
  const insertPopulation = historyDb.prepare(
    `INSERT OR REPLACE INTO save_population_snapshots
     (save_key, kind, game_date, player_id, name, team_id, org_id, level, position, age,
      con, gap, pow, eye, avk, spd, conP, gapP, powP, eyeP, avkP,
      stu, mov, ctl, stuP, movP, ctlP, cur, pot,
      ${[...SNAPSHOT_SPLIT_COLUMNS, ...SNAPSHOT_RUNNING_COLUMNS].join(', ')})
     VALUES (${new Array(29 + SNAPSHOT_SPLIT_COLUMNS.length + SNAPSHOT_RUNNING_COLUMNS.length).fill('?').join(', ')})`
  );
  // The same snapshot under the save's name, exactly as the earlier (Electron) build writes it, so a rolled-back build
  // still has it (D-064); the date is recorded as this build's own, never taken for earlier history
  const insertByName = insertInto('rating_snapshots', 'save_name');
  const dualWrite = historyDb.prepare(
    `INSERT OR REPLACE INTO history_dual_writes (save_name, game_date, save_key, written_at) VALUES (?, ?, ?, ?)`
  );
  const avg = (vals: Array<number | string | null>): number | null => {
    const nums = vals.filter((v): v is number => typeof v === 'number');
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  };
  let filed = true;
  const insertAll = historyDb.transaction(() => {
    // The key still bound for this save now: a worker that resolved it before the GM answered a question files the
    // snapshot where the answer put this save's history, and never on a key that has been set aside (D-064)
    const saveKey = boundKeyNow(resolved);
    if (saveKey === null) {
      filed = false;
      return;
    }
    const composites = (r: Record<string, number | string | null>) => {
      const isPitcher = r.position === 1;
      return {
        cur: isPitcher ? avg([r.stu, r.mov, r.ctl]) : avg([r.con, r.gap, r.pow, r.eye, r.avk]),
        pot: isPitcher ? avg([r.stuP, r.movP, r.ctlP]) : avg([r.conP, r.gapP, r.powP, r.eyeP, r.avkP]),
      };
    };
    for (const r of populationRows) {
      const { cur, pot } = composites(r);
      insertPopulation.run(
        saveKey, population.id, gameDate, r.player_id, r.name, r.team_id, r.org_id, r.level, r.position, r.age,
        r.con, r.gap, r.pow, r.eye, r.avk, r.spd, r.conP, r.gapP, r.powP, r.eyeP, r.avkP,
        r.stu, r.mov, r.ctl, r.stuP, r.movP, r.ctlP, cur, pot,
        ...[...SNAPSHOT_SPLIT_COLUMNS, ...SNAPSHOT_RUNNING_COLUMNS].map((c) => r[c] ?? null),
      );
    }
    for (const r of rows) {
      const { cur, pot } = composites(r);
      const values = [
        gameDate, r.player_id, r.name, r.team_id, r.org_id, r.level, r.position, r.age,
        r.con, r.gap, r.pow, r.eye, r.avk, r.spd, r.conP, r.gapP, r.powP, r.eyeP, r.avkP,
        r.stu, r.mov, r.ctl, r.stuP, r.movP, r.ctlP, cur, pot,
        ...[...SNAPSHOT_SPLIT_COLUMNS, ...SNAPSHOT_RUNNING_COLUMNS].map((c) => r[c] ?? null),
        // Where his ratings came from (D-067): kept per player, so a change of source is never read as development
        ourScouts ? ratingsFromOf(Number(r.player_id)) : null,
      ];
      insert.run(saveKey, ...values);
      if (saveName !== null) insertByName.run(saveName, ...values);
    }
    // The save's own ratings now: what a carry-over copied at this date and player is no longer the carry-over's (D-064)
    releaseCarried(saveKey, gameDate, rows.map((r) => Number(r.player_id)));
    if (populationRows.length) releaseCarriedPopulation(saveKey, population.id, gameDate, populationRows.map((r) => Number(r.player_id)));
    if (saveName !== null) dualWrite.run(saveName, gameDate, saveKey, new Date().toISOString());
  });
  insertAll.immediate();
  if (!filed) return null;
  console.log(`[history] snapshot ${gameDate}: ${rows.length} players${populationRows.length ? ` (and OSA's view of ${populationRows.length}, the league's yardstick)` : ''}`);
  return { gameDate, players: rows.length, ourScouts, evidenceMode };
}

/**
 * The start-up baseline: a snapshot of the league already imported, for a save with no rating history yet (none for an
 * export that carries no ratings; stamped with the kind the export carries, N3.5). Only when the league served is
 * certainly the configured save's (D-064): a save chosen after the earlier build's last import (which names no folder)
 * is not the league on disk, and its history must never be given another save's ratings.
 */
export function baselineSnapshot(): { gameDate: string; players: number } | null {
  const mode = currentRatingMode();
  if (!tableExists('players') || !servedLeagueCertain() || mode?.mode === 'none' || snapshotDates().length > 0) return null;
  const snapshot = takeSnapshot();
  if (snapshot) stampSnapshotMode(snapshot.gameDate, evidenceRecord(mode, snapshot.evidenceMode), null);
  return snapshot;
}

function gameDateEpoch(value: string): number {
  const match =
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(
      value
    );

  if (!match) return Number.NaN;

  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
}

function compareGameDates(
  a: string,
  b: string
): number {
  const aTime =
    gameDateEpoch(a);

  const bTime =
    gameDateEpoch(b);

  if (
    Number.isFinite(aTime) &&
    Number.isFinite(bTime)
  ) {
    return aTime - bTime;
  }

  return a.localeCompare(b);
}

export function snapshotDates(): string[] {
  return (
    historyDb
      .prepare(
        `SELECT DISTINCT game_date
         FROM save_rating_snapshots
         WHERE save_key = ?`
      )
      .all(
        currentHistoryKey()
      ) as Array<{
        game_date: string;
      }>
  )
    .map(
      (row) =>
        row.game_date
    )
    .sort(
      compareGameDates
    );
}


export type DevelopmentTrendStatus =
  | 'insufficient'
  | 'improving'
  | 'flat'
  | 'declining'
  | 'mixed';

export interface PlayerDevelopmentTrend {
  status:
    DevelopmentTrendStatus;

  snapshotCount: number;

  firstDate:
    string | null;

  latestDate:
    string | null;

  observationDays:
    number | null;

  /*
   * These are changes in the history database's scouting composites:
   *
   * hitters:
   * contact / gap / power / eye / avoid-K
   *
   * pitchers:
   * stuff / movement / control
   *
   * They are deliberately NOT the player's displayed OVR grade.
   */
  currentDelta:
    number | null;

  potentialDelta:
    number | null;

  reasons:
    string[];
}

interface DevelopmentTrendRow {
  player_id: number;
  game_date: string;
  /** Where his ratings came from in this snapshot (D-067); null before it was kept. */
  src?: string | null;

  cur:
    number | null;

  pot:
    number | null;
}

const MIN_TREND_SNAPSHOTS = 3;
const MIN_TREND_DAYS = 75;

function numericDelta(
  latest: number | null,
  first: number | null
): number | null {
  if (
    typeof latest !== 'number' ||
    !Number.isFinite(latest) ||
    typeof first !== 'number' ||
    !Number.isFinite(first)
  ) {
    return null;
  }

  return (
    Math.round(
      (latest - first) * 10
    ) / 10
  );
}

/**
 * Persistent observed scouting development, keyed by player.
 *
 * The Development page already stores one rating snapshot on each import.
 * This exposes the same history to baseball-decision engines without making
 * those engines independently reinterpret history.db.
 *
 * Classification is intentionally conservative. A couple of closely spaced
 * imports do not constitute evidence that development has stopped.
 */
function developmentTrendByPlayerForScope(
  orgId: number | null
):
  Map<number, PlayerDevelopmentTrend> {
  const rows =
    (
      orgId === null
        ? historyDb
            .prepare(
              `SELECT
                 player_id,
                 game_date,
                 src,
                 cur,
                 pot
               FROM save_rating_snapshots
               WHERE save_key = ?`
            )
            .all(
              currentHistoryKey()
            )
        : historyDb
            .prepare(
              `SELECT
                 player_id,
                 game_date,
                 src,
                 cur,
                 pot
               FROM save_rating_snapshots
               WHERE save_key = ?
                 AND org_id = ?`
            )
            .all(
              currentHistoryKey(),
              orgId
            )
    ) as DevelopmentTrendRow[];

  // Snapshots in another known kind of ratings are a switch, never development (D-061): left out, and said
  const { excluded: otherMode, switches, unknownKind } = modeFilter();
  const unknownReason = unknownKindReason(unknownKind);
  // Rating history this save's earlier name held but that couldn't be matched to it is not used, and said (D-064)
  const historyLeftOut = historyNote().note;

  const byPlayer =
    new Map<
      number,
      DevelopmentTrendRow[]
    >();

  // A row of his from another source than today's is a switch, never development (D-067): left out, and said
  const switchedFrom = new Map<number, 'our_scouts' | 'osa'>();
  for (const row of rows) {
    if (otherMode.has(row.game_date)) continue;
    const other = otherSource(row.player_id, row.src);
    if (other) {
      switchedFrom.set(row.player_id, other);
      continue;
    }
    const existing =
      byPlayer.get(
        row.player_id
      );

    if (existing) {
      existing.push(row);
    } else {
      byPlayer.set(
        row.player_id,
        [row]
      );
    }
  }

  const out =
    new Map<
      number,
      PlayerDevelopmentTrend
    >();

  for (
    const [
      playerId,
      snapshots,
    ] of byPlayer
  ) {
    snapshots.sort(
      (a, b) =>
        compareGameDates(
          a.game_date,
          b.game_date
        )
    );

    const first =
      snapshots[0];

    const latest =
      snapshots[
        snapshots.length - 1
      ];

    const firstTime =
      gameDateEpoch(
        first.game_date
      );

    const latestTime =
      gameDateEpoch(
        latest.game_date
      );

    const observationDays =
      Number.isFinite(
        firstTime
      ) &&
      Number.isFinite(
        latestTime
      )
        ? Math.round(
            (
              latestTime -
              firstTime
            ) /
              86_400_000
          )
        : null;

    const currentDelta =
      numericDelta(
        latest.cur,
        first.cur
      );

    const potentialDelta =
      numericDelta(
        latest.pot,
        first.pot
      );

    let status:
      DevelopmentTrendStatus;

    const reasons:
      string[] = [];

    if (
      snapshots.length <
        MIN_TREND_SNAPSHOTS ||
      observationDays === null ||
      observationDays <
        MIN_TREND_DAYS ||
      currentDelta === null
    ) {
      status =
        'insufficient';

      reasons.push(
        `Only ${snapshots.length} usable snapshot${snapshots.length === 1 ? '' : 's'} across ${
          observationDays === null
            ? 'an unknown observation window'
            : `${observationDays} in-game days`
        }; trend classification requires at least ${MIN_TREND_SNAPSHOTS} snapshots across ${MIN_TREND_DAYS} days.`
      );
    } else if (
      currentDelta >= 2
    ) {
      status =
        'improving';

      reasons.push(
        `Current-skill scouting composite improved by ${currentDelta.toFixed(1)} across ${snapshots.length} snapshots and ${observationDays} in-game days.`
      );
    } else if (
      currentDelta <= -2
    ) {
      status =
        'declining';

      reasons.push(
        `Current-skill scouting composite declined by ${Math.abs(currentDelta).toFixed(1)} across ${snapshots.length} snapshots and ${observationDays} in-game days.`
      );
    } else if (
      Math.abs(
        currentDelta
      ) <= 1
    ) {
      status =
        'flat';

      reasons.push(
        `Current-skill scouting composite changed only ${currentDelta >= 0 ? '+' : ''}${currentDelta.toFixed(1)} across ${snapshots.length} snapshots and ${observationDays} in-game days.`
      );
    } else {
      status =
        'mixed';

      reasons.push(
        `Current-skill scouting composite changed ${currentDelta >= 0 ? '+' : ''}${currentDelta.toFixed(1)} across ${snapshots.length} snapshots and ${observationDays} in-game days; movement is not strong enough for a directional classification.`
      );
    }

    if (
      potentialDelta !== null &&
      Math.abs(
        potentialDelta
      ) >= 1
    ) {
      reasons.push(
        `Scouted projected ceiling changed ${potentialDelta >= 0 ? '+' : ''}${potentialDelta.toFixed(1)} over the same observation window.`
      );
    }

    if (otherMode.size > 0) {
      reasons.push(...switches.map((sw) => `${sw.text} Snapshots in the earlier kind are not compared.`));
      if (unknownReason) reasons.push(unknownReason);
    }
    if (historyLeftOut) reasons.push(historyLeftOut);
    const switched = switchedFrom.get(playerId);
    if (switched) reasons.push(`${sourceSwitchText(switched, switched === 'osa' ? 'our_scouts' : 'osa')} Snapshots from ${SOURCE_NAMES[switched]} are not compared.`);

    out.set(
      playerId,
      {
        status,

        snapshotCount:
          snapshots.length,

        firstDate:
          first.game_date,

        latestDate:
          latest.game_date,

        observationDays,

        currentDelta,

        potentialDelta,

        reasons,
      }
    );
  }

  return out;
}


/** Save-wide history for consumers that intentionally follow a player across organizations. */
export function developmentTrendByPlayer():
  Map<number, PlayerDevelopmentTrend> {
  return developmentTrendByPlayerForScope(
    null
  );
}


/** History observed while each player belonged to one organization. */
export function developmentTrendByPlayerForOrg(
  orgId: number
): Map<number, PlayerDevelopmentTrend> {
  return developmentTrendByPlayerForScope(
    orgId
  );
}



/**
 * How the organization's observed development of a player compares with
 * similarly situated minor leaguers.
 *
 * This is deliberately scouting-relative evidence, not omniscient player
 * truth. The ratings are the observations persisted by the Development
 * history system on each import.
 */
export type PeerDevelopmentPace =
  | 'insufficient'
  | 'behind'
  | 'typical'
  | 'ahead';

export interface PeerDevelopmentTrend {
  pace: PeerDevelopmentPace;

  percentile: number | null;

  /*
   * Current-skill composite change normalized to 100 in-game days.
   * Normalizing matters once players have different observation windows.
   */
  ratePer100Days: number | null;

  cohortMedianRate: number | null;

  peerAdjustedRate: number | null;

  cohortSize: number;

  cohort: {
    kind: 'hitter' | 'pitcher';
    ageBand: string;
    startingLevel: number | null;
    levelMatched: boolean;
  } | null;

  reasons: string[];
}

interface PeerSnapshotRow {
  player_id: number;
  game_date: string;
  src?: string | null;
  age: number | null;
  level: number | null;
  position: number | null;
  cur: number | null;
}

interface PeerObservation {
  playerId: number;

  kind:
    | 'hitter'
    | 'pitcher';

  ageBand: string;

  startingLevel:
    number | null;

  snapshotCount: number;

  observationDays: number;

  currentDelta: number;

  ratePer100Days: number;
}

function developmentAgeBand(
  age: number
): string {
  if (age <= 19) return '<=19';
  if (age <= 22) return '20-22';
  if (age <= 25) return '23-25';
  if (age <= 29) return '26-29';
  return '30+';
}

function medianNumber(
  values: number[]
): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b
    );

  const mid =
    Math.floor(
      sorted.length / 2
    );

  if (
    sorted.length % 2 === 1
  ) {
    return sorted[mid];
  }

  return (
    sorted[mid - 1] +
    sorted[mid]
  ) / 2;
}

/**
 * Mid-rank percentile.
 *
 * Rating changes are discrete — especially pitcher composites, where one
 * tool moving five points changes the three-rating average by about 1.67.
 * Mid-rank avoids pretending all tied observations have different ranks.
 */
function percentileNumber(
  values: number[],
  value: number
): number | null {
  if (values.length === 0) {
    return null;
  }

  let below = 0;
  let equal = 0;

  for (const candidate of values) {
    if (candidate < value) {
      below += 1;
    } else if (
      candidate === value
    ) {
      equal += 1;
    }
  }

  return (
    (
      below +
      equal * 0.5
    ) /
    values.length
  ) * 100;
}

function peerKey(
  kind: 'hitter' | 'pitcher',
  ageBand: string,
  level?: number | null
): string {
  return level == null
    ? `${kind}|${ageBand}`
    : `${kind}|${ageBand}|${level}`;
}

/**
 * Peer-adjusted scouting development.
 *
 * Primary cohort:
 *   player type + age band + STARTING level
 *
 * Starting level is used because the change being measured began there. A
 * player who earned a promotion should not have his whole development window
 * judged against players who began at the more advanced destination.
 *
 * When that cohort is too small, type + age band is used as the fallback.
 */
function peerDevelopmentTrendByPlayerForScope(
  orgId: number | null
):
  Map<number, PeerDevelopmentTrend> {
  const rows =
    (
      orgId === null
        ? historyDb
            .prepare(
              `SELECT
                 player_id,
                 game_date,
                 src,
                 age,
                 level,
                 position,
                 cur
               FROM save_rating_snapshots
               WHERE save_key = ?`
            )
            .all(
              currentHistoryKey()
            )
        : historyDb
            .prepare(
              `SELECT
                 player_id,
                 game_date,
                 src,
                 age,
                 level,
                 position,
                 cur
               FROM save_rating_snapshots
               WHERE save_key = ?
                 AND org_id = ?`
            )
            .all(
              currentHistoryKey(),
              orgId
            )
    ) as PeerSnapshotRow[];

  // As the player's own trend: snapshots in another known kind of ratings are a switch, never development (D-061)
  const { excluded: otherMode } = modeFilter();

  const byPlayer =
    new Map<
      number,
      PeerSnapshotRow[]
    >();

  for (const row of rows) {
    if (otherMode.has(row.game_date) || otherSource(row.player_id, row.src)) continue;
    const group =
      byPlayer.get(
        row.player_id
      );

    if (group) {
      group.push(row);
    } else {
      byPlayer.set(
        row.player_id,
        [row]
      );
    }
  }

  const observations:
    PeerObservation[] = [];

  for (
    const [
      playerId,
      snapshots,
    ] of byPlayer
  ) {
    snapshots.sort(
      (a, b) =>
        compareGameDates(
          a.game_date,
          b.game_date
        )
    );

    if (
      snapshots.length <
      MIN_TREND_SNAPSHOTS
    ) {
      continue;
    }

    const first =
      snapshots[0];

    const latest =
      snapshots[
        snapshots.length - 1
      ];

    if (
      typeof first.cur !==
        'number' ||
      typeof latest.cur !==
        'number' ||
      typeof first.age !==
        'number' ||
      typeof first.position !==
        'number'
    ) {
      continue;
    }

    const firstTime =
      gameDateEpoch(
        first.game_date
      );

    const latestTime =
      gameDateEpoch(
        latest.game_date
      );

    if (
      !Number.isFinite(
        firstTime
      ) ||
      !Number.isFinite(
        latestTime
      )
    ) {
      continue;
    }

    const observationDays =
      Math.round(
        (
          latestTime -
          firstTime
        ) /
        86_400_000
      );

    if (
      observationDays <
      MIN_TREND_DAYS
    ) {
      continue;
    }

    /*
     * Only players who began this observation window in the minor leagues
     * belong in the minor-league development baseline.
     */
    if (
      typeof first.level !==
        'number' ||
      first.level <= 1
    ) {
      continue;
    }

    const currentDelta =
      latest.cur -
      first.cur;

    const ratePer100Days =
      currentDelta *
      100 /
      observationDays;

    observations.push({
      playerId,

      kind:
        first.position === 1
          ? 'pitcher'
          : 'hitter',

      ageBand:
        developmentAgeBand(
          first.age
        ),

      startingLevel:
        first.level,

      snapshotCount:
        snapshots.length,

      observationDays,

      currentDelta,

      ratePer100Days,
    });
  }

  const detailed =
    new Map<
      string,
      number[]
    >();

  const broad =
    new Map<
      string,
      number[]
    >();

  for (
    const observation of
    observations
  ) {
    const detailedKey =
      peerKey(
        observation.kind,
        observation.ageBand,
        observation.startingLevel
      );

    const broadKey =
      peerKey(
        observation.kind,
        observation.ageBand
      );

    const detailedValues =
      detailed.get(
        detailedKey
      ) ?? [];

    detailedValues.push(
      observation.ratePer100Days
    );

    detailed.set(
      detailedKey,
      detailedValues
    );

    const broadValues =
      broad.get(
        broadKey
      ) ?? [];

    broadValues.push(
      observation.ratePer100Days
    );

    broad.set(
      broadKey,
      broadValues
    );
  }

  const out =
    new Map<
      number,
      PeerDevelopmentTrend
    >();

  for (
    const observation of
    observations
  ) {
    const detailedKey =
      peerKey(
        observation.kind,
        observation.ageBand,
        observation.startingLevel
      );

    const broadKey =
      peerKey(
        observation.kind,
        observation.ageBand
      );

    const detailedValues =
      detailed.get(
        detailedKey
      ) ?? [];

    const levelMatched =
      detailedValues.length >= 50;

    const cohortValues =
      levelMatched
        ? detailedValues
        : (
            broad.get(
              broadKey
            ) ?? []
          );

    const median =
      medianNumber(
        cohortValues
      );

    const percentile =
      percentileNumber(
        cohortValues,
        observation.ratePer100Days
      );

    if (
      median === null ||
      percentile === null ||
      cohortValues.length < 20
    ) {
      out.set(
        observation.playerId,
        {
          pace:
            'insufficient',

          percentile:
            null,

          ratePer100Days:
            null,

          cohortMedianRate:
            null,

          peerAdjustedRate:
            null,

          cohortSize:
            cohortValues.length,

          cohort: {
            kind:
              observation.kind,

            ageBand:
              observation.ageBand,

            startingLevel:
              observation
                .startingLevel,

            levelMatched,
          },

          reasons: [
            'Peer evidence is still insufficient: not enough comparable scouting-history observations are available for a stable baseline.',
          ],
        }
      );

      continue;
    }

    const peerAdjustedRate =
      observation.ratePer100Days -
      median;

    const pace:
      PeerDevelopmentPace =
        percentile <= 20
          ? 'behind'
          : percentile >= 80
            ? 'ahead'
            : 'typical';

    const paceLabel =
      pace === 'ahead'
        ? 'ahead of'
        : pace === 'behind'
          ? 'behind'
          : 'within the typical range for';

    out.set(
      observation.playerId,
      {
        pace,

        percentile:
          Math.round(
            percentile
          ),

        ratePer100Days:
          Math.round(
            observation
              .ratePer100Days *
            10
          ) / 10,

        cohortMedianRate:
          Math.round(
            median * 10
          ) / 10,

        peerAdjustedRate:
          Math.round(
            peerAdjustedRate *
            10
          ) / 10,

        cohortSize:
          cohortValues.length,

        cohort: {
          kind:
            observation.kind,

          ageBand:
            observation.ageBand,

          startingLevel:
            observation
              .startingLevel,

          levelMatched,
        },

        reasons: [
          `Observed current-skill change ranks at the ${Math.round(percentile)}th percentile among ${cohortValues.length} comparable ${observation.kind}s.`,
          `Development pace is ${paceLabel} the comparison cohort.`,
          levelMatched
            ? `Comparison cohort matches player type, age band, and starting level ${observation.startingLevel}.`
            : 'Starting-level cohort was too small, so comparison falls back to player type and age band.',
        ],
      }
    );
  }

  return out;
}


/** Save-wide peer history for callers that intentionally compare across organizations. */
export function peerDevelopmentTrendByPlayer():
  Map<number, PeerDevelopmentTrend> {
  return peerDevelopmentTrendByPlayerForScope(
    null
  );
}


/** Peer history built only from observations recorded for one organization. */
export function peerDevelopmentTrendByPlayerForOrg(
  orgId: number
): Map<number, PeerDevelopmentTrend> {
  return peerDevelopmentTrendByPlayerForScope(
    orgId
  );
}


// ── Development tracking ────────────────────────────────────────────────

export const historyRoutes = Router();


/**
 * Full scouting-history series for an organization.
 *
 * This is observational data only: the ratings captured at each import.
 * It deliberately does not reinterpret those snapshots as true talent.
 * Player Development and Retention already consume the derived trend models;
 * this route exists so the UI can show the underlying history honestly.
 */
historyRoutes.get('/development-history/:orgId', (req, res) => {
  const orgId =
    Number(req.params.orgId);

  if (!Number.isFinite(orgId)) {
    return res.status(400).json({
      error:
        'Invalid organization id',
    });
  }

  const saveKey =
    currentHistoryKey();

  const allRows =
    historyDb
      .prepare(
        `SELECT
           game_date,
           player_id,
           name,
           team_id,
           org_id,
           level,
           position,
           age,
           cur,
           pot,
           con,
           gap,
           pow,
           eye,
           avk,
           spd,
           stu,
           mov,
           ctl,
           src
         FROM save_rating_snapshots
         WHERE save_key = ?
           AND org_id = ?`
      )
      .all(
        saveKey,
        orgId
      ) as Array<{
        game_date: string;
        player_id: number;
        name: string;
        team_id: number;
        org_id: number;
        level: number;
        position: number;
        age: number;
        cur: number | null;
        pot: number | null;
        con: number | null;
        gap: number | null;
        pow: number | null;
        eye: number | null;
        avk: number | null;
        spd: number | null;
        stu: number | null;
        mov: number | null;
        ctl: number | null;
      }>;

  // Snapshots in another known kind of ratings than today's export are a switch, never movement (D-061): left out here
  // as in every trend, so the Development page's changes never read a switch; the switches themselves are served below
  const { excluded: otherMode } = modeFilter();
  // And a player's rows from another source than his today's (D-067): a switch, never movement, served below
  const sourceSwitches = new Map<number, string>();
  const rows = allRows.filter((row) => {
    if (otherMode.has(row.game_date)) return false;
    const other = otherSource(row.player_id, (row as { src?: unknown }).src);
    if (other) sourceSwitches.set(row.player_id, sourceSwitchText(other, other === 'osa' ? 'our_scouts' : 'osa'));
    return !other;
  });

  rows.sort(
    (a, b) =>
      a.player_id -
        b.player_id ||
      compareGameDates(
        a.game_date,
        b.game_date
      )
  );

  const dates =
    [
      ...new Set(
        rows.map(
          (row) =>
            row.game_date
        )
      ),
    ].sort(
      compareGameDates
    );

  let observationDays:
    number | null =
      null;

  if (dates.length >= 2) {
    const first =
      gameDateEpoch(
        dates[0]
      );

    const latest =
      gameDateEpoch(
        dates[
          dates.length - 1
        ]
      );

    if (
      Number.isFinite(first) &&
      Number.isFinite(latest)
    ) {
      observationDays =
        Math.round(
          (
            latest -
            first
          ) /
          86_400_000
        );
    }
  }

  res.json({
    snapshots:
      dates.length,

    dates,

    observationDays,

    rows,

    // The kind of ratings each date holds, and every switch between them (D-061), so a jump reads as a switch
    ratingModes: Object.fromEntries(snapshotModes()),

    ratingModeSwitches: modeSwitches(),

    // Players whose ratings changed source (our scouts' full reports, OSA's view): their other rows are left out (D-067)
    ratingSourceSwitches: [...sourceSwitches].map(([playerId, text]) => ({ playerId, text })),

    // Whether any of this save's rating history is not used or started fresh, in a sentence, with its basis (D-064)
    history: historyNote(),
  });
});


historyRoutes.get('/development/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  const saveKey = currentHistoryKey();
  const dates = snapshotDates();
  // Whether any of this save's rating history is not used or started fresh (D-064), on every answer
  const history = historyNote();
  if (dates.length < 2) {
    return res.json({ snapshots: dates.length, dates, changes: null, history });
  }
  const from = String(req.query.from ?? dates[dates.length - 2]);
  const to = String(req.query.to ?? dates[dates.length - 1]);
  // Two snapshots in different known kinds of ratings: a switch, shown as one, never read as development (D-061)
  const modes = snapshotModes();
  if (isModeSwitch(modes.get(from), modes.get(to))) {
    const ratingModeSwitch = modeSwitches(new Map([[from, modes.get(from)!], [to, modes.get(to)!]]))[0];
    return res.json({ snapshots: dates.length, dates, from, to, changes: null, ratingModeSwitch, history });
  }
  // A snapshot stamped with an unknown kind of ratings is never compared (D-018): no changes, and why
  const unknownEnds = [from, to].filter((d) => modes.get(d) === 'unknown');
  if (unknownEnds.length > 0) {
    return res.json({ snapshots: dates.length, dates, from, to, changes: null, ratingModeUnknown: { dates: unknownEnds, text: unknownKindReason(unknownEnds) }, history });
  }

  const rows = historyDb
    .prepare(
      `SELECT a.player_id, b.name, b.age, b.position, b.level, b.team_id,
              a.cur AS cur_from, b.cur AS cur_to, a.pot AS pot_from, b.pot AS pot_to,
              a.con AS con_a, b.con AS con_b, a.gap AS gap_a, b.gap AS gap_b,
              a.pow AS pow_a, b.pow AS pow_b, a.eye AS eye_a, b.eye AS eye_b,
              a.avk AS avk_a, b.avk AS avk_b, a.spd AS spd_a, b.spd AS spd_b,
              a.stu AS stu_a, b.stu AS stu_b, a.mov AS mov_a, b.mov AS mov_b,
              a.ctl AS ctl_a, b.ctl AS ctl_b, a.src AS src_a, b.src AS src_b
       FROM save_rating_snapshots a
       JOIN save_rating_snapshots b
         ON b.save_key = a.save_key AND b.player_id = a.player_id AND b.game_date = ?
       WHERE a.save_key = ? AND a.game_date = ? AND b.org_id = ?`
    )
    .all(to, saveKey, from, orgId) as Array<Record<string, number | string | null>>;

  // A player whose ratings came from another source at each end is a source switch, stated, never a change (D-067)
  const sourceSwitches: Array<{ playerId: number; name: unknown; text: string }> = [];
  const changes = rows
    .filter((r) => {
      const a = recordedSource(r.src_a);
      const b = recordedSource(r.src_b);
      if (a && b && a !== b) {
        sourceSwitches.push({ playerId: Number(r.player_id), name: r.name, text: sourceSwitchText(a, b) });
        return false;
      }
      return true;
    })
    .map((r) => {
      const details: Array<{ rating: string; from: number; to: number }> = [];
      const pairs: Array<[string, string, string]> = [
        ['Contact', 'con_a', 'con_b'], ['Gap', 'gap_a', 'gap_b'], ['Power', 'pow_a', 'pow_b'],
        ['Eye', 'eye_a', 'eye_b'], ['Avoid K', 'avk_a', 'avk_b'], ['Speed', 'spd_a', 'spd_b'],
        ['Stuff', 'stu_a', 'stu_b'], ['Movement', 'mov_a', 'mov_b'], ['Control', 'ctl_a', 'ctl_b'],
      ];
      for (const [label, ka, kb] of pairs) {
        const a = r[ka] as number | null;
        const b = r[kb] as number | null;
        if (a !== null && b !== null && a !== b) details.push({ rating: label, from: a, to: b });
      }
      const curDelta = (r.cur_to as number ?? 0) - (r.cur_from as number ?? 0);
      const potDelta = (r.pot_to as number ?? 0) - (r.pot_from as number ?? 0);
      return {
        player_id: r.player_id,
        name: r.name,
        age: r.age,
        position: r.position,
        level: r.level,
        cur: r.cur_to,
        pot: r.pot_to,
        curDelta: Number(curDelta.toFixed(1)),
        potDelta: Number(potDelta.toFixed(1)),
        details,
      };
    })
    .filter((c) => c.details.length > 0)
    .sort((a, b) => Math.abs(b.curDelta) + Math.abs(b.potDelta) - (Math.abs(a.curDelta) + Math.abs(a.potDelta)));

  res.json({ snapshots: dates.length, dates, from, to, changes, ratingSourceSwitches: sourceSwitches, history });
});

// ── Watchlist ───────────────────────────────────────────────────────────

historyRoutes.get('/watchlist', (_req, res) => {
  const rows = historyDb
    .prepare(`SELECT * FROM watchlist WHERE save_name = ? ORDER BY updated_at DESC`)
    .all(currentSaveName()) as Array<{ player_id: number; name: string; note: string; added_at: string }>;
  // Enrich with live info from the current league DB
  const enriched = rows.map((w) => {
    const p = tableExists('players')
      ? (leagueDb
          .prepare(
            `SELECT p.age, p.position, p.free_agent, t.name AS team_name, t.nickname, t.level
             FROM players p LEFT JOIN teams t ON t.team_id = p.team_id WHERE p.player_id = ?`
          )
          .get(w.player_id) as Record<string, unknown> | undefined)
      : undefined;
    return {
      ...w,
      age: p?.age ?? null,
      position: p?.position ?? null,
      team: p?.team_name ? `${p.team_name} ${p.nickname}` : p?.free_agent === 1 ? 'Free Agent' : null,
      level: p?.level ?? null,
    };
  });
  res.json(enriched);
});

historyRoutes.post('/watchlist', (req, res) => {
  const { player_id, name, note } = req.body as { player_id: number; name?: string; note?: string };
  if (!player_id) return res.status(400).json({ error: 'player_id required' });
  const now = new Date().toISOString();
  historyDb
    .prepare(
      `INSERT INTO watchlist (save_name, player_id, name, note, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (save_name, player_id)
       DO UPDATE SET note = COALESCE(excluded.note, note), name = COALESCE(excluded.name, name), updated_at = excluded.updated_at`
    )
    .run(currentSaveName(), player_id, name ?? null, note ?? '', now, now);
  res.json({ ok: true });
});

historyRoutes.delete('/watchlist/:playerId', (req, res) => {
  historyDb
    .prepare(`DELETE FROM watchlist WHERE save_name = ? AND player_id = ?`)
    .run(currentSaveName(), Number(req.params.playerId));
  res.json({ ok: true });
});

historyRoutes.get('/watchlist/:playerId', (req, res) => {
  const row = historyDb
    .prepare(`SELECT note FROM watchlist WHERE save_name = ? AND player_id = ?`)
    .get(currentSaveName(), Number(req.params.playerId)) as { note: string } | undefined;
  res.json({ watched: !!row, note: row?.note ?? '' });
});

// ── Notes on a player ───────────────────────────────────────────────────

historyRoutes.get('/player-notes/:playerId', (req, res) => {
  const rows = historyDb
    .prepare(
      `SELECT id, player_id, player_name, source, body, game_date, created_at
       FROM player_notes WHERE save_name = ? AND player_id = ?
       ORDER BY id DESC`
    )
    .all(currentSaveName(), Number(req.params.playerId));
  res.json({ notes: rows });
});

historyRoutes.post('/player-notes', (req, res) => {
  const { player_id, player_name, source, body } = req.body as {
    player_id?: number;
    player_name?: string;
    source?: string;
    body?: string;
  };
  if (!Number.isFinite(Number(player_id)) || !body || !body.trim()) {
    return res.status(400).json({ error: 'A player and some text are required' });
  }
  const info = historyDb
    .prepare(
      `INSERT INTO player_notes (save_name, player_id, player_name, source, body, game_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      currentSaveName(),
      Number(player_id),
      player_name ?? null,
      source ?? 'You',
      body.trim(),
      // The in-game date, not today's: a plan made in May is judged against the
      // season, and the wall clock means nothing to a save being simmed
      leagueGameDate(),
      new Date().toISOString()
    );
  res.json({ ok: true, id: info.lastInsertRowid });
});

historyRoutes.delete('/player-notes/:id', (req, res) => {
  historyDb
    .prepare(`DELETE FROM player_notes WHERE save_name = ? AND id = ?`)
    .run(currentSaveName(), Number(req.params.id));
  res.json({ ok: true });
});
