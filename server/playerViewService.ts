/**
 * The player window's service (N11): the dossier, kept per import; the comparison; the GM's notes.
 *
 * - **Kept per import, on the Front Office's key** and the save's rating-snapshot writes (as the farm's views are,
 *   D-066): the club, the import, the settings and configuration files, the live log, the calibration revision, and the
 *   rating history the chart reads. A dossier never outlives any of them.
 * - **Our club's players are warm:** after each kept build of the club's Front Office (`onFrontOfficeKept`), every player
 *   the organization holds is read in one job in the Front Office's worker (their shared reads once, off the request
 *   path), so opening one of ours is a cached read.
 * - **Any other player is read on his first open** (about a tenth of a second on a full league, on the server's thread:
 *   less than a worker would take to start) and kept with the build.
 * - **Compare** reads each player's kept dossier and lines them up (`presentation/player/compare.ts`): nothing recomputed.
 * - **Notes** write through the stores the React card writes (the follow's note, `player_notes`), answering with the
 *   request that undoes the change.
 */
import { databaseGeneration, db, leagueUpgradeUnderWay, tableExists } from './db.js';
import { LeagueRefusal, followingView } from './aroundTheLeague.js';
import { follow, follows, snapshotsAllowed, unfollow } from './frontOfficeMemory.js';
import { NO_DATA, frontOfficeInputsKey, frontOfficeStampOf, onFrontOfficeKept, resolveOrg, runDepartmentJob } from './frontOfficeService.js';
import { addStaffNote, removeStaffNote, snapshotWriteCount, staffNotesOf } from './history.js';
import { buildPlayerDossiers, type PlayerDossiersResult } from './playerDossierBuild.js';
import { importedAt } from './playerStateRoutes.js';
import { adoptAuthored, cell } from './presentation/claim.js';
import { compareView } from './presentation/player/compare.js';
import { notesView } from './presentation/player/notes.js';
import type {
  PlayerCompareView, PlayerDossierView, PlayerNoteChange, PlayerNotesView, StaffNoteChange, StaffNoteRestore,
} from './presentation/player/types.js';
import { publish } from './serverEvents.js';
import { currentOrganization } from './viewingOrganization.js';

interface Kept {
  key: string;
  stamp: string;
  orgId: number;
  importStamp: string | null;
  views: Map<number, PlayerDossierView>;
  /** The ids the export has no such player for. */
  missing: Set<number>;
}

const MAX_BUILDS = 2;
/** At most this many players read on their first open are kept per build (our club's are kept whatever their number). */
const MAX_OPENED = 400;
const kept = new Map<string, Kept>();
const warming = new Map<string, Promise<void>>();
const building = new Map<string, Promise<PlayerDossierView | null>>();
const stats = { warmBuilds: 0, warmMs: 0, opened: 0, hits: 0 };

export function playerViewStats(): Readonly<typeof stats & { cached: number; players: number }> {
  return { ...stats, cached: kept.size, players: [...kept.values()].reduce((n, k) => n + k.views.size, 0) };
}

export function resetPlayerViews(): void {
  kept.clear();
  warming.clear();
  building.clear();
  Object.assign(stats, { warmBuilds: 0, warmMs: 0, opened: 0, hits: 0 });
}

export const NO_SUCH_PLAYER = 'Pennant doesn\'t know that player in this save.';
export const COMPARE_HOW_MANY = 'Compare two to four players: give their ids as ?players=1,2.';

const playerKey = (orgId: number): string => `${frontOfficeInputsKey(orgId)}|h${snapshotWriteCount()}`;

/** The kept entry for the club's current inputs (made empty when there is none yet). */
function entryFor(orgId: number): Kept {
  const key = playerKey(orgId);
  let entry = kept.get(key);
  if (!entry) {
    entry = { key, stamp: frontOfficeStampOf(key), orgId, importStamp: importedAt.value, views: new Map(), missing: new Set() };
    kept.set(key, entry);
    while (kept.size > MAX_BUILDS) kept.delete(kept.keys().next().value!);
  }
  return entry;
}

function keep(entry: Kept, result: PlayerDossiersResult, generation: number): void {
  if (databaseGeneration() !== generation || kept.get(entry.key) !== entry || playerKey(entry.orgId) !== entry.key) return;
  for (const view of result.views) entry.views.set(view.playerId, adoptAuthored(view));
  for (const id of result.missing) entry.missing.add(id);
}

/** Every player the organization holds, by the export (the club's own and its affiliates'). */
function organizationPlayers(orgId: number): number[] {
  if (!tableExists('players')) return [];
  return (db.prepare(`SELECT player_id FROM players WHERE organization_id = ? AND COALESCE(retired, 0) = 0`).all(orgId) as Array<{ player_id: number }>)
    .map((r) => Number(r.player_id)).filter((n) => Number.isInteger(n) && n > 0);
}

/** Reads our club's players ahead, in one job in the Front Office's worker. Never throws. */
export async function warmPlayerDossiers(org: number | 'automatic' = 'automatic'): Promise<void> {
  try {
    const orgId = org === 'automatic' ? currentOrganization()?.id ?? null : org;
    if (orgId === null || !tableExists('players')) return;
    const upgrade = leagueUpgradeUnderWay();
    if (upgrade) await upgrade;
    const entry = entryFor(orgId);
    const running = warming.get(entry.key);
    if (running) return running;
    const ids = organizationPlayers(orgId).filter((id) => !entry.views.has(id));
    if (ids.length === 0) return;
    const generation = databaseGeneration();
    const request = { orgId, importStamp: entry.importStamp, reportStamp: entry.stamp, playerIds: ids };
    const started = performance.now();
    const job = runDepartmentJob<PlayerDossiersResult>({ kind: 'playerDossiers', request }, () => buildPlayerDossiers(request))
      .then((result) => {
        keep(entry, result, generation);
        stats.warmBuilds += 1;
        stats.warmMs = Math.round(performance.now() - started);
        console.log(`[players] read ${result.views.length} of the club's players ahead in ${stats.warmMs} ms (${result.ms} ms building)`);
      })
      .catch((err: unknown) => console.error('[players] the club\'s players could not be read ahead; each is read when opened:', err))
      .finally(() => { if (warming.get(entry.key) === job) warming.delete(entry.key); });
    warming.set(entry.key, job);
    return job;
  } catch (err) {
    console.error('[players] warm-up failed; each player is read when opened:', err);
  }
}

const idOf = (param: string): number => {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) throw new LeagueRefusal(NO_SUCH_PLAYER, 404);
  return id;
};

/** One player's dossier for the club (`automatic`, or a team id): kept, being read ahead, or read now and kept. */
export async function playerDossierNow(param: string, org: string = 'automatic'): Promise<PlayerDossierView> {
  if (!tableExists('players')) throw new LeagueRefusal(NO_DATA, 404);
  const id = idOf(param);
  const orgId = resolveOrg(org);
  const upgrade = leagueUpgradeUnderWay();
  if (upgrade) await upgrade;
  const entry = entryFor(orgId);
  const hit = entry.views.get(id);
  if (hit) {
    stats.hits += 1;
    return hit;
  }
  if (entry.missing.has(id)) throw new LeagueRefusal(NO_SUCH_PLAYER, 404);
  // One of ours being read ahead: wait for that read rather than reading him twice
  const running = warming.get(entry.key);
  if (running) {
    await running;
    const warmed = entry.views.get(id);
    if (warmed) return warmed;
  }
  const buildKey = `${entry.key}#${id}`;
  let pending = building.get(buildKey);
  if (!pending) {
    const generation = databaseGeneration();
    pending = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => {
        const result = buildPlayerDossiers({ orgId, importStamp: entry.importStamp, reportStamp: entry.stamp, playerIds: [id] });
        stats.opened += 1;
        keep(entry, result, generation);
        const opened = [...entry.views.keys()].filter((p) => !organizationPlayerSet(entry).has(p));
        if (opened.length > MAX_OPENED) entry.views.delete(opened[0]);
        return result.views[0] ?? null;
      })
      .finally(() => building.delete(buildKey));
    building.set(buildKey, pending);
  }
  const view = await pending;
  if (!view) throw new LeagueRefusal(NO_SUCH_PLAYER, 404);
  return view;
}

const orgSets = new WeakMap<Kept, Set<number>>();
function organizationPlayerSet(entry: Kept): Set<number> {
  let set = orgSets.get(entry);
  if (!set) {
    set = new Set(organizationPlayers(entry.orgId));
    orgSets.set(entry, set);
  }
  return set;
}

/** Two to four players side by side (`?players=1,2,3`), each from his kept dossier. */
export async function playerCompareNow(query: Record<string, unknown>): Promise<PlayerCompareView> {
  const ids = [...new Set(String(query.players ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length < 2 || ids.length > 4) throw new LeagueRefusal(COMPARE_HOW_MANY, 400);
  const org = typeof query.org === 'string' && query.org ? query.org : 'automatic';
  const views: PlayerDossierView[] = [];
  for (const id of ids) views.push(await playerDossierNow(String(id), org));
  return compareView(views, views[0].orgId, views[0].importStamp);
}

// ── notes ──────────────────────────────────────────────────────────────────

/** The longest note kept: the GM's own words, a page of them. */
export const MAX_PLAYER_NOTE = 10_000;
const NOT_IMPORTED = 'The save you chose isn\'t imported yet, so its notes can\'t be changed.';

function playerName(id: number): string | null {
  if (!tableExists('players')) return null;
  const row = db.prepare(`SELECT first_name, last_name FROM players WHERE player_id = ?`).get(id) as { first_name?: unknown; last_name?: unknown } | undefined;
  if (!row) return null;
  return [row.first_name, row.last_name].filter((x) => typeof x === 'string' && x.length > 0).join(' ') || null;
}

function notesOf(id: number): PlayerNotesView {
  const f = follows().find((x) => x.kind === 'player' && x.id === id) ?? null;
  return notesView({ playerId: id, following: f !== null, note: f?.note ?? null, staff: staffNotesOf(id) });
}

/** The GM's note and the staff's on a player. */
export async function playerNotesNow(param: string): Promise<PlayerNotesView> {
  const id = idOf(param);
  if (playerName(id) === null) throw new LeagueRefusal(NO_SUCH_PLAYER, 404);
  // The watchlist's notes are copied into Following the first time it is read (N7): read it so his note is there
  if (snapshotsAllowed()) await followingView();
  return notesOf(id);
}

async function followingChanged(): Promise<void> {
  const view = await followingView();
  publish({ type: 'following-changed', followStamp: view.followStamp });
}

/**
 * Sets the GM's note exactly as typed (an empty one clears it). A note on a player he doesn't follow follows him, as
 * the watchlist did; its undo puts the earlier note back, or stops following him when the note was what followed him.
 */
export async function setPlayerNoteNow(param: string, body: unknown): Promise<PlayerNoteChange> {
  const id = idOf(param);
  const b = (body ?? {}) as { note?: unknown };
  if (typeof b.note !== 'string') throw new LeagueRefusal('Send the note as text.', 400);
  if (b.note.length > MAX_PLAYER_NOTE) throw new LeagueRefusal('Keep the note under 10,000 characters.', 400);
  if (!snapshotsAllowed()) throw new LeagueRefusal(NOT_IMPORTED, 400);
  const name = playerName(id);
  if (name === null) throw new LeagueRefusal(NO_SUCH_PLAYER, 404);
  await followingView();
  const before = follows().find((x) => x.kind === 'player' && x.id === id) ?? null;
  const note = b.note.trim() === '' ? '' : b.note;
  // Clearing the note of a player he doesn't follow changes nothing and follows nobody
  if (!before && note === '') return { done: cell('Nothing to save'), notes: notesOf(id), undo: { note: '' }, undoUnfollows: false };
  await follow('player', id, name, note);
  await followingChanged();
  return {
    done: cell(before ? (note === '' ? `Note cleared for ${name}` : `Note saved for ${name}`) : `Note saved, and following ${name}`),
    notes: notesOf(id),
    undo: { note: before?.note ?? '' },
    undoUnfollows: before === null,
  };
}

/** Stops following a player whose note followed him (the undo of a first note): his note goes with the follow. */
export async function undoFirstNoteNow(param: string): Promise<PlayerNoteChange> {
  const id = idOf(param);
  if (!snapshotsAllowed()) throw new LeagueRefusal(NOT_IMPORTED, 400);
  const gone = await unfollow('player', id);
  if (gone) await followingChanged();
  return { done: cell(gone ? 'Note removed, and no longer following him' : 'Nothing to undo'), notes: notesOf(id), undo: { note: gone?.note ?? '' }, undoUnfollows: false };
}

/** Removes a staff note on him; the answer carries the note as filed, to put it back. */
export async function removeStaffNoteNow(param: string, noteParam: string): Promise<StaffNoteChange> {
  const id = idOf(param);
  const noteId = Number(noteParam);
  if (!Number.isInteger(noteId) || noteId <= 0) throw new LeagueRefusal('Pennant doesn\'t know that note.', 404);
  const before = staffNotesOf(id).find((n) => n.id === noteId);
  if (!before) throw new LeagueRefusal('Pennant doesn\'t know that note.', 404);
  const removed = removeStaffNote(noteId);
  return {
    done: cell('Staff note removed'),
    notes: notesOf(id),
    undo: removed ? { source: removed.source, body: removed.body, gameDate: removed.game_date } : null,
  };
}

/** Puts a removed staff note back as it was filed (the undo of a removal). */
export async function restoreStaffNoteNow(param: string, body: unknown): Promise<StaffNoteChange> {
  const id = idOf(param);
  const b = (body ?? {}) as Partial<StaffNoteRestore>;
  if (typeof b.body !== 'string' || b.body.trim() === '') throw new LeagueRefusal('Send the note as it was filed.', 400);
  const name = playerName(id);
  if (name === null) throw new LeagueRefusal(NO_SUCH_PLAYER, 404);
  addStaffNote({ playerId: id, playerName: name, source: typeof b.source === 'string' ? b.source : null, body: b.body, gameDate: typeof b.gameDate === 'string' ? b.gameDate : null });
  return { done: cell('Staff note put back'), notes: notesOf(id), undo: null };
}

// After each kept build of the club's Front Office: our club's players, read ahead in the worker
onFrontOfficeKept((built) => {
  if (currentOrganization()?.id === built.orgId) void warmPlayerDossiers(built.orgId);
});
