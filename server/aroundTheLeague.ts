/**
 * Around the League, served (D-059, N7 Stage A): the wire, another club's report, Following and search, each put
 * together from its reader and its words, with what the GM follows. Following orders the wire and the search and
 * changes nothing else (case 20).
 *
 * - The wire is gathered once per import on the server's own thread (`leagueWire.ts`) from what the server already
 *   holds (the live log's last copy), and filtered and ordered per request (cheap: no table is read then).
 * - A club report is built in the Front Office's worker on its first open and kept per import (`clubReportBuilt`); what
 *   the GM follows and the club's recent moves are put on it when served.
 * - Search reads an index built once per import (`search.ts`).
 */
import { db, tableColumns, tableExists } from './db.js';
import { parseGameDate } from './dataFreshness.js';
import { clubOwed } from './clubOwed.js';
import { clubReportBuilt, FrontOfficeRefusal, resolveOrg } from './frontOfficeService.js';
import {
  copyWatchlist, follow, followedSets, follows, memoryKey, memoryRevision, previousReportSnapshot, restoreFollow, snapshotsAllowed, unfollow, watchlistCopies,
  type FollowKind, type FollowRecord,
} from './frontOfficeMemory.js';
import { wireFacts, type WireKind } from './leagueWire.js';
import { importedAt } from './playerStateRoutes.js';
import { cell } from './presentation/claim.js';
import { followingWords, type ClubNow, type PlayerNow } from './presentation/frontOffice/following.js';
import type { ClubReport, FollowChange, FollowUpdate, Following, SearchAnswer, Wire, WireTop } from './presentation/frontOffice/leagueTypes.js';
import { LEVEL_WORDS } from './presentation/frontOffice/morning.js';
import { KIND_ORDER, wireEntries, wireOrder, wireTopWords, wireWords, type WireQuery } from './presentation/frontOffice/wire.js';
import { searchWords } from './presentation/searchWords.js';
import { POSITION_NAMES } from './positionNeeds.js';
import { matches, queryOf, searchIndex } from './search.js';
import { publish } from './serverEvents.js';
import { timestampWords } from './timeWords.js';
import { currentOrganization } from './viewingOrganization.js';

/** The club the app follows, unless the club question is still open (then none). */
export function ourClub(): number | null {
  return clubOwed() ? null : currentOrganization()?.id ?? null;
}

/** The last export's day for the club, as its snapshot recorded it; null when there is none. */
function lastExportDay(orgId: number | null): string | null {
  if (orgId === null || !snapshotsAllowed()) return null;
  return previousReportSnapshot(orgId, importedAt.value)?.gameDate ?? null;
}

// ── the wire ───────────────────────────────────────────────────────────────

/** The Morning Report's column: the top entries since the last export (or the newest), followed clubs first. */
export function wireTopFor(orgId: number, importStamp: string | null, sinceRaw: string | null): WireTop | null {
  try {
    const facts = wireFacts(importStamp, orgId);
    return wireTopWords(facts, followedSets(), parseGameDate(sinceRaw), sinceRaw, { importStamp, gameDate: facts.gameDate, playerOrgs });
  } catch (err) {
    console.error('[wire] the Morning Report\'s column could not be put together:', err);
    return null;
  }
}

/** A refusal of a wire, club or following request, in a sentence. */
export class LeagueRefusal extends Error {
  constructor(message: string, readonly status: 400 | 404) {
    super(message);
    this.name = 'LeagueRefusal';
  }
}

const WIRE_KINDS = new Set<string>(KIND_ORDER);
const WIRE_LIMIT = 200;

/** The wire for a request (`GET /api/v2/wire/:org?since&club&kind&followed`). */
export function wireView(orgParam: string, query: Record<string, unknown>): Wire {
  const orgId = resolveOrg(orgParam);
  const one = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null);
  const sinceParam = one(query.since);
  const clubParam = one(query.club);
  const kindParam = one(query.kind);
  const followedParam = one(query.followed);
  if (kindParam !== null && !WIRE_KINDS.has(kindParam)) throw new LeagueRefusal('Choose moves, trades, injuries, streaks, awards or standings.', 400);
  const club = clubParam === null ? null : Number(clubParam);
  if (club !== null && (!Number.isInteger(club) || club <= 0)) throw new LeagueRefusal('Pennant doesn\'t know that club in this save.', 400);
  let sinceFrom: WireQuery['sinceFrom'] = 'lastExport';
  let sinceRaw: string | null = null;
  if (sinceParam === 'season') sinceFrom = 'season';
  else if (sinceParam !== null) {
    if (parseGameDate(sinceParam) === null) throw new LeagueRefusal('Give the day as a date, like 2040-5-1.', 400);
    sinceFrom = 'asked';
    sinceRaw = sinceParam;
  } else {
    sinceRaw = lastExportDay(orgId);
    if (sinceRaw === null) sinceFrom = 'season';
  }
  const importStamp = importedAt.value;
  const facts = wireFacts(importStamp, orgId);
  return wireWords(orgId, facts, followedSets(), {
    sinceDay: sinceFrom === 'season' ? null : parseGameDate(sinceRaw),
    sinceRaw: sinceFrom === 'season' ? null : sinceRaw,
    sinceFrom,
    club,
    kind: kindParam as WireKind | null,
    followedOnly: followedParam === 'only',
    followedFirst: followedParam !== null && followedParam !== '0' && followedParam !== 'false',
    limit: WIRE_LIMIT,
  }, { importStamp, gameDate: facts.gameDate, playerOrgs });
}

// ── a club report ───────────────────────────────────────────────────────────

/** How many of a club's wire entries its report shows. */
const CLUB_MOVES = 10;

/** Another club's report (`GET /api/v2/club/:teamId`), with what the GM follows and its recent moves on it. */
export async function clubReportNow(teamParam: string): Promise<ClubReport> {
  const teamId = resolveOrg(teamParam === 'automatic' ? 'automatic' : teamParam);
  const ours = ourClub();
  const built = await clubReportBuilt(teamId, ours);
  const followed = followedSets();
  const importStamp = importedAt.value;
  let moves: ClubReport['moves'] = [];
  let movesNote = null;
  try {
    const facts = wireFacts(importStamp, ours);
    const theirs = wireOrder(facts.facts.filter((f) => f.clubs.some((c) => c.teamId === teamId)), followed, false);
    moves = wireEntries(theirs.slice(0, CLUB_MOVES), followed, { importStamp, gameDate: facts.gameDate, playerOrgs });
    movesNote = moves.length ? null : cell('Nothing on the wire about them this season');
  } catch (err) {
    console.error('[wire] the club\'s moves could not be put together:', err);
    movesNote = cell('Their moves couldn\'t be read this time', { tone: 'unknown' });
  }
  return { ...built.report, followed: followed.clubs.has(teamId), moves, movesNote };
}

// ── following ──────────────────────────────────────────────────────────────

function clubsNow(): Map<number, ClubNow & { league: number | null; sub: number | null; div: number | null }> {
  const out = new Map<number, ClubNow & { league: number | null; sub: number | null; div: number | null }>();
  const cols = tableExists('teams') ? new Set(tableColumns('teams')) : new Set<string>();
  if (!cols.has('team_id') || !cols.has('name')) return out;
  const label = cols.has('nickname') ? `CASE WHEN t.nickname IS NULL OR t.nickname = '' OR t.name = t.nickname THEN t.name ELSE t.name || ' ' || t.nickname END` : 't.name';
  const subCols = tableExists('sub_leagues') ? new Set(tableColumns('sub_leagues')) : new Set<string>();
  const divCols = tableExists('divisions') ? new Set(tableColumns('divisions')) : new Set<string>();
  const divisions = cols.has('division_id') && divCols.has('name') && divCols.has('division_id') && subCols.has('sub_league_id');
  const rows = db.prepare(`SELECT t.team_id, ${label} AS label, ${cols.has('abbr') ? 't.abbr' : 'NULL'} AS abbr,
      ${cols.has('league_id') ? 't.league_id' : 'NULL'} AS league, ${cols.has('sub_league_id') ? 't.sub_league_id' : 'NULL'} AS sub, ${cols.has('division_id') ? 't.division_id' : 'NULL'} AS div
      ${divisions ? `, ${subCols.has('abbr') ? 's.abbr' : 'NULL'} AS sub_abbr, d.name AS div_name` : ', NULL AS sub_abbr, NULL AS div_name'}
    FROM teams t
    ${divisions ? `LEFT JOIN sub_leagues s ON s.league_id = t.league_id AND s.sub_league_id = t.sub_league_id
      LEFT JOIN divisions d ON d.league_id = t.league_id AND d.sub_league_id = t.sub_league_id AND d.division_id = t.division_id` : ''}
    WHERE ${cols.has('level') ? 't.level = 1' : '1 = 1'}${cols.has('allstar_team') ? ' AND COALESCE(t.allstar_team, 0) = 0' : ''}`).all() as Array<Record<string, unknown>>;
  for (const r of rows) {
    const div = typeof r.div_name === 'string' ? r.div_name.replace(/\s+Division$/i, '') : null;
    out.set(Number(r.team_id), {
      teamId: Number(r.team_id), name: String(r.label), abbr: typeof r.abbr === 'string' ? r.abbr : null,
      division: div ? [typeof r.sub_abbr === 'string' ? r.sub_abbr : null, div].filter(Boolean).join(' ') : null,
      league: typeof r.league === 'number' ? r.league : null, sub: typeof r.sub === 'number' ? r.sub : null, div: typeof r.div === 'number' ? r.div : null,
    });
  }
  return out;
}

function playersNow(ids: readonly number[]): Map<number, PlayerNow> {
  const out = new Map<number, PlayerNow>();
  const cols = tableExists('players') ? new Set(tableColumns('players')) : new Set<string>();
  if (!ids.length || !cols.has('player_id') || !cols.has('first_name')) return out;
  const teamCols = tableExists('teams') ? new Set(tableColumns('teams')) : new Set<string>();
  const rows = db.prepare(`SELECT p.player_id, p.first_name || ' ' || p.last_name AS name, ${cols.has('position') ? 'p.position' : 'NULL'} AS position,
      ${cols.has('organization_id') ? 'p.organization_id' : 'NULL'} AS org, t.team_id AS team, ${teamCols.has('parent_team_id') ? 't.parent_team_id' : 'NULL'} AS parent,
      t.name AS club, t.nickname AS nickname, t.level AS level
    FROM players p LEFT JOIN teams t ON t.team_id = p.team_id WHERE p.player_id IN (${ids.map(Number).join(',')})`).all() as Array<Record<string, unknown>>;
  for (const r of rows) {
    const club = typeof r.club === 'string' ? (typeof r.nickname === 'string' && r.nickname && r.nickname !== r.club ? `${r.club} ${r.nickname}` : r.club) : null;
    const level = typeof r.level === 'number' ? r.level : null;
    out.set(Number(r.player_id), {
      playerId: Number(r.player_id), name: String(r.name).trim(), position: typeof r.position === 'number' ? POSITION_NAMES[r.position] ?? null : null,
      club, level: level === 1 ? 'Majors' : level !== null ? LEVEL_WORDS[level] ?? null : null,
      // His organization: as the export names it, else his club's (a major-league club is its own, a farm club its parent's)
      orgId: typeof r.org === 'number' && r.org > 0 ? r.org
        : level === 1 && typeof r.team === 'number' ? r.team
          : typeof r.parent === 'number' && r.parent > 0 ? r.parent : null,
    });
  }
  return out;
}

/** Each player's organization's club, when the export says (a wire chip's `open` target). */
const playerOrgs = (ids: readonly number[]): Map<number, number | null> => new Map([...playersNow(ids)].map(([id, p]) => [id, p.orgId ?? null]));

/** A short stamp of what is followed (moves with every follow, unfollow or note). */
function followStamp(): string {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(follows().map((f) => [f.kind, f.id, f.note, f.updatedAt]))) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `f${h.toString(36)}`;
}

let watchlistLooked: string | null = null;

/** Following (`GET /api/v2/following`): the watchlist is copied in first, once per save (never moved). */
export async function followingView(): Promise<Following> {
  const key = memoryKey();
  // The watchlist is copied only into the save whose league is served (L1: never before a new save's import lands)
  if (watchlistLooked !== key && snapshotsAllowed()) {
    watchlistLooked = key;
    try {
      const copy = await copyWatchlist();
      if (copy.copied) publish({ type: 'following-changed', followStamp: followStamp() });
    } catch (err) {
      console.error('[following] the watchlist could not be copied:', err);
    }
  }
  const list = follows();
  const clubs = clubsNow();
  const players = playersNow(list.filter((f) => f.kind === 'player').map((f) => f.id));
  const ours = ourClub();
  const me = ours === null ? undefined : clubs.get(ours);
  const followedClubs = new Set(list.filter((f) => f.kind === 'club').map((f) => f.id));
  // Division rivals are suggested, with why; never followed by themselves
  const rivals = me && me.div !== null
    ? [...clubs.values()].filter((c) => c.teamId !== me.teamId && c.league === me.league && c.sub === me.sub && c.div === me.div && !followedClubs.has(c.teamId))
      .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  return followingWords(
    list.map((f) => ({ kind: f.kind, id: f.id, name: f.name, note: f.note, source: f.source, createdText: timestampWords(f.createdAt) })),
    clubs, players, rivals, watchlistCopies(key), followStamp(),
  );
}

const MAX_NOTE = 1000;

/** Why a follow can't be changed while a newly chosen save's import hasn't landed (as the desk refuses, L1). */
const NOT_IMPORTED = 'The save you chose isn\'t imported yet, so its follows can\'t be changed.';

/** The follows just removed, by save, kind and id, so an unfollow's undo puts one back as it was (L8). A few at most. */
const MAX_REMOVED = 32;
const removed = new Map<string, FollowRecord>();
const removedKey = (kind: FollowKind, id: number) => `${memoryKey()}|${kind}|${id}`;

/** Follows a club or a player, or changes a follow's note (`PUT /api/v2/following`); `restore` undoes an unfollow. */
export async function followNow(body: unknown): Promise<FollowChange> {
  const b = (body ?? {}) as Partial<FollowUpdate>;
  if (b.kind !== 'club' && b.kind !== 'player') throw new LeagueRefusal('Say whether it is a club or a player to follow.', 400);
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) throw new LeagueRefusal('Say which club or player to follow.', 400);
  if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > MAX_NOTE)) throw new LeagueRefusal('Keep the note under 1,000 characters.', 400);
  if (!snapshotsAllowed()) throw new LeagueRefusal(NOT_IMPORTED, 400);
  const name = b.kind === 'club' ? clubsNow().get(id)?.name ?? null : playersNow([id]).get(id)?.name ?? null;
  if (name === null) throw new LeagueRefusal(b.kind === 'club' ? 'Pennant doesn\'t know that club in this save.' : 'Pennant doesn\'t know that player in this save.', 404);
  // An unfollow undone: the follow comes back as it was, its note, how it began and when (never begun again)
  const was = b.restore === true ? removed.get(removedKey(b.kind, id)) : undefined;
  if (was && !follows().some((f) => f.kind === was.kind && f.id === id)) {
    removed.delete(removedKey(b.kind, id));
    await restoreFollow({ ...was, note: b.note === undefined ? was.note : b.note.trim() || null });
    const view = await followingView();
    publish({ type: 'following-changed', followStamp: view.followStamp });
    return {
      done: cell(`Following ${b.kind === 'club' ? `the ${name}` : name} again`),
      following: true,
      undo: { action: 'unfollow', request: { kind: b.kind, id } },
      view,
    };
  }
  // A plain follow is on purpose: a follow his note began becomes his own (its note's undo no longer unfollows)
  const { previous } = await follow(b.kind, id, name, b.note === undefined ? undefined : b.note.trim(), b.note === undefined ? 'gm' : undefined);
  const view = await followingView();
  publish({ type: 'following-changed', followStamp: view.followStamp });
  return {
    done: cell(previous ? `Note saved for ${name}` : `Following ${b.kind === 'club' ? `the ${name}` : name}`),
    following: true,
    undo: previous
      ? { action: 'follow', request: { kind: b.kind, id, note: previous.note ?? '' } }
      : { action: 'unfollow', request: { kind: b.kind, id } },
    view,
  };
}

/** Stops following a club or a player (`DELETE /api/v2/following?kind&id`). */
export async function unfollowNow(query: Record<string, unknown>): Promise<FollowChange> {
  const kind = query.kind === 'club' || query.kind === 'player' ? query.kind as FollowKind : null;
  const id = Number(query.id);
  if (!kind) throw new LeagueRefusal('Say whether it is a club or a player to stop following.', 400);
  if (!Number.isInteger(id) || id <= 0) throw new LeagueRefusal('Say which club or player to stop following.', 400);
  if (!snapshotsAllowed()) throw new LeagueRefusal(NOT_IMPORTED, 400);
  const gone = await unfollow(kind, id);
  if (!gone) throw new LeagueRefusal('You weren\'t following that one.', 404);
  removed.delete(removedKey(kind, id));
  removed.set(removedKey(kind, id), gone);
  while (removed.size > MAX_REMOVED) removed.delete(removed.keys().next().value!);
  const view = await followingView();
  publish({ type: 'following-changed', followStamp: view.followStamp });
  const name = gone.name ?? (kind === 'club' ? 'that club' : 'that player');
  return {
    done: cell(`No longer following ${kind === 'club' && gone.name ? `the ${name}` : name}`),
    following: false,
    undo: { action: 'follow', request: { kind, id, note: gone.note ?? '', restore: true } },
    view,
  };
}

// ── search ─────────────────────────────────────────────────────────────────

/** The answer to a search (`GET /api/v2/search?q=`), from the index built once per import. */
export function searchNow(query: unknown): SearchAnswer {
  const text = typeof query === 'string' ? query.slice(0, 200) : '';
  const q = queryOf(text);
  const importStamp = importedAt.value;
  const followed = followedSets();
  const matched = q.words.length ? searchIndex(importStamp).entries.filter((e) => matches(e, q.words)) : [];
  return searchWords(text, q, matched, { followedClubs: followed.clubs, followedPlayers: followed.players, ourOrgId: ourClub(), importStamp });
}

/** For the tests and the log: the revision the served views were built on. */
export const aroundTheLeagueRevision = (): number => memoryRevision();

export { FrontOfficeRefusal };
