/**
 * The league wire's reader (D-059, N7 Stage A; V2 plan section 4.5): what happened around the league, gathered from the
 * sources that record it, as plain facts for `presentation/frontOffice/wire.ts` to word.
 *
 * - **Moves** from OOTP's live transaction log, read only as `liveLogSnapshot.ts`'s private copy (D-021), through the
 *   copy the server already holds (`peekTransactionLog`): never read on a request's path. An entry keeps the log's own
 *   sentence (D-020, case 17); only a move that involves a major-league club's own log rows is on the wire (the
 *   affiliate's side of the same move is its own row, with its own wording).
 * - **Without the log**, the difference between Pennant's two latest roster snapshots (`rosterStateHistory.ts`) is
 *   stated as a change ("now on the injured list"), never as a transaction.
 * - **Trades** from `trade_history` (its own summary), **league news** from `messages` (their own subjects, those that
 *   name a major-league club), **injuries** from `players_injury_history` (players now on a major-league club),
 *   **streaks** from `players_streak` and **awards** from `players_awards`, each only where its code's meaning is
 *   established (the hitting and on-base streaks, as the dashboard pinned them; the awards the player card names), and
 *   **standings** from the standings Pennant kept at each import.
 * - **Schema-tolerant**: a table the export lacks is a named gap, never an empty league (D-018).
 *
 * Nothing here orders by importance: the wire's order is stated in its words (case 18). Nothing here reads a rating.
 */
import { db, tableColumns, tableExists } from './db.js';
import { currentSaveLocation, peekTransactionLog } from './dataStatus.js';
import { parseGameDate } from './dataFreshness.js';
import { previousStandings, standingsOf, type StandingsRow } from './frontOfficeMemory.js';
import type { SaveLocation } from './ootpSave.js';
import { AWARD_NAMES } from './player.js';
import { latestRosterStateSnapshot, rosterStateEventsForSnapshot, type StructuredRosterEvent } from './rosterStateHistory.js';
import { onLookAtTheServedSave } from './saveDiscovery.js';
import type { TransactionLog } from './transactionLog.js';

export type WireKind = 'move' | 'trade' | 'injury' | 'streak' | 'award' | 'standings' | 'news';
export type WireSource = 'log' | 'trades' | 'news' | 'injuries' | 'streaks' | 'awards' | 'standings' | 'snapshots';

/** A club as the wire names it. */
export interface WireClubRef {
  teamId: number;
  name: string;
  abbr: string | null;
}

/** One thing that happened, as its source recorded it (words come later). */
export interface WireFact {
  id: string;
  source: WireSource;
  kind: WireKind;
  /** The day, as the source wrote it; null when it gives none. */
  date: string | null;
  /** The same day as ISO, for ordering (`parseGameDate`); null when not a date. */
  day: string | null;
  /** The major-league clubs it names. */
  clubs: WireClubRef[];
  players: Array<{ playerId: number; name: string }>;
  /** The source's own sentence (the log, a trade's summary, a message's subject); null for the facts worded here. */
  ownWords: string | null;
  /** What the words are built from, for the kinds worded here. */
  detail: WireDetail;
}

export type WireDetail =
  | { kind: 'log'; logKind: string; supported: boolean; logIds: number[] }
  | { kind: 'trade' }
  | { kind: 'news'; messageId: number }
  | { kind: 'injury'; dayToDay: boolean | null; length: number | null }
  | { kind: 'streak'; streak: 'hitting' | 'onBase'; games: number; started: string | null; line: number }
  | { kind: 'award'; award: string; league: string | null }
  | { kind: 'standings'; division: string | null; now: StandingsPlace; before: StandingsPlace; why: 'leader' | 'ourDivision' }
  | { kind: 'snapshot'; change: SnapshotChange };

export interface StandingsPlace {
  pos: number | null;
  of: number | null;
  gb: number | null;
  w: number | null;
  l: number | null;
}

/** A roster-state difference, as two snapshots show it (D-020: a state that changed, never a transaction). */
export type SnapshotChange =
  | { what: 'organization'; from: WireClubRef | null; to: WireClubRef | null }
  | { what: 'injuredList'; on: boolean }
  | { what: 'fortyMan'; on: boolean }
  | { what: 'activeRoster'; on: boolean; club: WireClubRef | null };

/** A source the wire could not read, and why (a named gap, never an empty league). */
export interface WireGap {
  source: WireSource;
  why: 'not_in_export' | 'unreadable' | 'log_unavailable' | 'log_reading' | 'no_earlier_standings' | 'no_snapshots';
  /** The log's own reason, where it gave one. */
  detail: string | null;
}

export interface WireFacts {
  facts: WireFact[];
  gaps: WireGap[];
  /** Whether moves came from the log (true) or from roster snapshots (false). */
  fromLog: boolean;
  /** The league's day, and the last export's day (for "since the last export"). */
  gameDate: string | null;
  previousGameDate: string | null;
}

/**
 * The streak lengths the wire shows (policy lines, D-041): a hitting streak of 15 games or more, and an on-base streak
 * of 25 or more, among players now on a major-league club. The dashboard shows the club's own from five games; the
 * league's are many more, so the wire keeps the ones a GM would hear about.
 */
export const WIRE_STREAK_POLICY = {
  hitting: 15,
  onBase: 25,
  stamp: 'The wire shows hitting streaks of 15 games or more and on-base streaks of 25 or more, for players on a major-league club (a policy line, not fitted).',
} as const;

/** The streak types whose meaning was pinned (`dashboard.ts`): 0 a hitting streak, 9 an on-base streak. */
const STREAK_HITTING = 0;
const STREAK_ON_BASE = 9;

// ── the served save's log, found off the request's path ─────────────────────

let located: SaveLocation | null = null;
onLookAtTheServedSave(() => {
  try {
    located = currentSaveLocation();
  } catch {
    located = null;
  }
});

// ── helpers ────────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const has = (table: string): Set<string> => (tableExists(table) ? new Set(tableColumns(table)) : new Set<string>());

interface LeagueClubs {
  /** Every club, by team id: its name, abbreviation, level and the major-league club it belongs to. */
  byId: Map<number, { ref: WireClubRef; level: number | null; parent: number | null }>;
  /** The major-league club a club belongs to (itself when it is one); null when not known. */
  majorOf: (teamId: number | null | undefined) => WireClubRef | null;
}

function leagueClubs(): LeagueClubs {
  const byId = new Map<number, { ref: WireClubRef; level: number | null; parent: number | null }>();
  const cols = has('teams');
  if (cols.has('team_id')) {
    const label = cols.has('nickname') && cols.has('name')
      ? `CASE WHEN nickname IS NULL OR nickname = '' OR name = nickname THEN name ELSE name || ' ' || nickname END`
      : cols.has('name') ? 'name' : `'Club ' || team_id`;
    for (const r of db.prepare(`SELECT team_id, ${label} AS label, ${cols.has('abbr') ? 'abbr' : 'NULL'} AS abbr, ${cols.has('level') ? 'level' : 'NULL'} AS level,
        ${cols.has('parent_team_id') ? 'parent_team_id' : 'NULL'} AS parent FROM teams`).all() as Array<Record<string, unknown>>) {
      const id = num(r.team_id);
      if (id === null) continue;
      byId.set(id, { ref: { teamId: id, name: text(r.label) ?? `Club ${id}`, abbr: text(r.abbr) }, level: num(r.level), parent: num(r.parent) });
    }
  }
  const majorOf = (teamId: number | null | undefined): WireClubRef | null => {
    if (teamId === null || teamId === undefined) return null;
    const club = byId.get(teamId);
    if (!club) return null;
    if (club.level === 1) return club.ref;
    const parent = club.parent !== null && club.parent > 0 ? byId.get(club.parent) : undefined;
    return parent?.level === 1 ? parent.ref : null;
  };
  return { byId, majorOf };
}

const uniqueClubs = (clubs: Array<WireClubRef | null>): WireClubRef[] => {
  const seen = new Map<number, WireClubRef>();
  for (const c of clubs) if (c && !seen.has(c.teamId)) seen.set(c.teamId, c);
  return [...seen.values()];
};

/** Players' names and their major-league clubs now, for the ids the sources name. */
function playersNamed(ids: Iterable<number>): Map<number, { name: string; teamId: number | null }> {
  const wanted = [...new Set([...ids].filter((id) => id > 0))];
  const out = new Map<number, { name: string; teamId: number | null }>();
  const cols = has('players');
  if (!wanted.length || !cols.has('player_id')) return out;
  const name = cols.has('first_name') && cols.has('last_name') ? `TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))` : `'Player ' || player_id`;
  for (let at = 0; at < wanted.length; at += 500) {
    const chunk = wanted.slice(at, at + 500);
    for (const r of db.prepare(`SELECT player_id, ${name} AS name, ${cols.has('team_id') ? 'team_id' : 'NULL'} AS team_id FROM players WHERE player_id IN (${chunk.join(',')})`)
      .all() as Array<Record<string, unknown>>) {
      out.set(Number(r.player_id), { name: text(r.name) ?? `Player ${r.player_id}`, teamId: num(r.team_id) });
    }
  }
  return out;
}

// ── each source ────────────────────────────────────────────────────────────

function logFacts(log: TransactionLog, clubs: LeagueClubs): WireFact[] {
  const out: WireFact[] = [];
  for (const e of log.events) {
    // A move on the wire involves a major-league club's own log rows; the affiliate's side is its own row
    const own = e.sources.map((s) => (s.teamId === null ? null : clubs.byId.get(s.teamId))).filter((c) => c?.level === 1).map((c) => c!.ref);
    if (!own.length) continue;
    const named = uniqueClubs([...own, clubs.majorOf(e.from?.id), clubs.majorOf(e.to?.id)]);
    out.push({
      id: `log:${e.id}`,
      source: 'log',
      kind: 'move',
      date: e.date,
      day: parseGameDate(e.date),
      clubs: named,
      players: e.playerId !== null ? [{ playerId: e.playerId, name: e.playerName ?? `Player ${e.playerId}` }] : [],
      ownWords: e.text,
      detail: { kind: 'log', logKind: e.kind, supported: e.supported, logIds: e.sources.map((s) => s.logId) },
    });
  }
  return out;
}

function snapshotFacts(clubs: LeagueClubs): { facts: WireFact[]; gap: WireGap | null } {
  const latest = latestRosterStateSnapshot();
  if (!latest) return { facts: [], gap: { source: 'snapshots', why: 'no_snapshots', detail: null } };
  const events = rosterStateEventsForSnapshot(latest.id);
  const now = new Map(latest.players.map((p) => [p.playerId, p]));
  const out: WireFact[] = [];
  const push = (e: StructuredRosterEvent, change: SnapshotChange, named: Array<WireClubRef | null>) => {
    const clubsNamed = uniqueClubs(named);
    if (!clubsNamed.length) return;
    out.push({
      id: `snapshots:${latest.id}:${e.transition.playerId}:${change.what}`,
      source: 'snapshots',
      kind: 'move',
      date: latest.gameDate,
      day: parseGameDate(latest.gameDate),
      clubs: clubsNamed,
      players: [{ playerId: e.transition.playerId, name: e.transition.playerName }],
      ownWords: null,
      detail: { kind: 'snapshot', change },
    });
  };
  for (const e of events) {
    if (e.transition.kind !== 'changed') continue;
    const p = now.get(e.transition.playerId);
    const club = clubs.majorOf(p?.teamId ?? null) ?? clubs.majorOf(p?.organizationId ?? null);
    for (const c of e.transition.changes) {
      if (c.field === 'organizationId') {
        const from = clubs.majorOf(typeof c.before === 'number' ? c.before : null);
        const to = clubs.majorOf(typeof c.after === 'number' ? c.after : null);
        push(e, { what: 'organization', from, to }, [from, to]);
      } else if (c.field === 'onIl' && typeof c.after === 'boolean' && p?.teamLevel === 1) {
        push(e, { what: 'injuredList', on: c.after }, [club]);
      } else if (c.field === 'fortyMan' && typeof c.after === 'boolean') {
        push(e, { what: 'fortyMan', on: c.after }, [club]);
      } else if (c.field === 'activeMlb' && typeof c.after === 'boolean') {
        push(e, { what: 'activeRoster', on: c.after, club }, [club]);
      }
    }
  }
  return { facts: out, gap: null };
}

function tradeFacts(clubs: LeagueClubs): WireFact[] {
  const cols = has('trade_history');
  if (!cols.has('date') || !cols.has('summary')) return [];
  const playerCols = [...cols].filter((c) => /^player_id_[01]_\d+$/.test(c));
  const rows = db.prepare(`SELECT rowid AS rid, * FROM trade_history`).all() as Array<Record<string, unknown>>;
  const names = playersNamed(rows.flatMap((r) => playerCols.map((c) => num(r[c])).filter((v): v is number => v !== null)));
  return rows.flatMap((r) => {
    const summary = text(r.summary);
    if (!summary) return [];
    const players = playerCols.map((c) => num(r[c])).filter((v): v is number => v !== null && v > 0)
      .map((id) => ({ playerId: id, name: names.get(id)?.name ?? `Player ${id}` }));
    return [{
      id: `trades:${num(r.message_id) ?? `row${r.rid}`}`,
      source: 'trades' as const,
      kind: 'trade' as const,
      date: text(r.date),
      day: parseGameDate(r.date),
      clubs: uniqueClubs([clubs.majorOf(num(r.team_id_0)), clubs.majorOf(num(r.team_id_1))]),
      players,
      ownWords: summary,
      detail: { kind: 'trade' as const },
    }];
  });
}

function newsFacts(clubs: LeagueClubs): WireFact[] {
  const cols = has('messages');
  if (!cols.has('subject') || !cols.has('date')) return [];
  const teamCols = [0, 1, 2, 3, 4].map((i) => `team_id_${i}`).filter((c) => cols.has(c));
  const playerCols = Array.from({ length: 10 }, (_, i) => `player_id_${i}`).filter((c) => cols.has(c));
  const rows = db.prepare(`SELECT rowid AS rid, * FROM messages${cols.has('deleted') ? ' WHERE COALESCE(deleted, 0) = 0' : ''}`).all() as Array<Record<string, unknown>>;
  const names = playersNamed(rows.flatMap((r) => playerCols.map((c) => num(r[c])).filter((v): v is number => v !== null)));
  return rows.flatMap((r) => {
    const subject = text(r.subject);
    // League news on the wire names a major-league club; the rest (a minor league's own news, the office's memos) is not the league's
    const named = uniqueClubs(teamCols.map((c) => num(r[c])).map((id) => (id !== null && clubs.byId.get(id)?.level === 1 ? clubs.byId.get(id)!.ref : null)));
    if (!subject || !named.length) return [];
    const players = playerCols.map((c) => num(r[c])).filter((v): v is number => v !== null && v > 0)
      .map((id) => ({ playerId: id, name: names.get(id)?.name ?? `Player ${id}` }));
    const messageId = num(r.message_id) ?? Number(r.rid);
    return [{
      id: `news:${messageId}`,
      source: 'news' as const,
      kind: 'news' as const,
      date: text(r.date),
      day: parseGameDate(r.date),
      clubs: named,
      players,
      ownWords: subject,
      detail: { kind: 'news' as const, messageId },
    }];
  });
}

function injuryFacts(clubs: LeagueClubs, season: number | null): WireFact[] {
  const cols = has('players_injury_history');
  if (!cols.has('player_id') || !cols.has('date')) return [];
  const rows = db.prepare(`SELECT rowid AS rid, player_id, date${cols.has('length') ? ', length' : ''}${cols.has('day_to_day') ? ', day_to_day' : ''} FROM players_injury_history`)
    .all() as Array<Record<string, unknown>>;
  const names = playersNamed(rows.map((r) => Number(r.player_id)));
  return rows.flatMap((r) => {
    const day = parseGameDate(r.date);
    if (season !== null && day !== null && Number(day.slice(0, 4)) !== season) return [];
    const player = names.get(Number(r.player_id));
    // Injuries to regulars: players now on a major-league club
    const club = player && player.teamId !== null && clubs.byId.get(player.teamId)?.level === 1 ? clubs.byId.get(player.teamId)!.ref : null;
    if (!player || !club) return [];
    const dtd = num(r.day_to_day);
    return [{
      id: `injuries:${r.player_id}:${text(r.date) ?? r.rid}`,
      source: 'injuries' as const,
      kind: 'injury' as const,
      date: text(r.date),
      day,
      clubs: [club],
      players: [{ playerId: Number(r.player_id), name: player.name }],
      ownWords: null,
      detail: { kind: 'injury' as const, dayToDay: dtd === null ? null : dtd === 1, length: num(r.length) },
    }];
  });
}

function streakFacts(clubs: LeagueClubs, gameDate: string | null): WireFact[] {
  const cols = has('players_streak');
  if (!['player_id', 'streak_id', 'value', 'has_ended'].every((c) => cols.has(c))) return [];
  const rows = db.prepare(`SELECT player_id, streak_id, value${cols.has('started') ? ', started' : ''} FROM players_streak
    WHERE has_ended = 0 AND ((streak_id = ${STREAK_HITTING} AND value >= ${WIRE_STREAK_POLICY.hitting}) OR (streak_id = ${STREAK_ON_BASE} AND value >= ${WIRE_STREAK_POLICY.onBase}))`)
    .all() as Array<Record<string, unknown>>;
  const names = playersNamed(rows.map((r) => Number(r.player_id)));
  return rows.flatMap((r) => {
    const player = names.get(Number(r.player_id));
    const club = player && player.teamId !== null && clubs.byId.get(player.teamId)?.level === 1 ? clubs.byId.get(player.teamId)!.ref : null;
    if (!player || !club) return [];
    const streak = Number(r.streak_id) === STREAK_HITTING ? 'hitting' as const : 'onBase' as const;
    return [{
      id: `streaks:${r.player_id}:${streak}:${text(r.started) ?? ''}`,
      source: 'streaks' as const,
      kind: 'streak' as const,
      // A streak still running stands as of the league's day
      date: gameDate,
      day: parseGameDate(gameDate),
      clubs: [club],
      players: [{ playerId: Number(r.player_id), name: player.name }],
      ownWords: null,
      detail: { kind: 'streak' as const, streak, games: Number(r.value), started: text(r.started), line: streak === 'hitting' ? WIRE_STREAK_POLICY.hitting : WIRE_STREAK_POLICY.onBase },
    }];
  });
}

function awardFacts(clubs: LeagueClubs, season: number | null): WireFact[] {
  const cols = has('players_awards');
  if (!['player_id', 'award_id', 'year'].every((c) => cols.has(c))) return [];
  const known = Object.keys(AWARD_NAMES).map(Number);
  const where = [`award_id IN (${known.join(',')})`, ...(season !== null ? [`year = ${season}`] : [])];
  const rows = db.prepare(`SELECT rowid AS rid, * FROM players_awards WHERE ${where.join(' AND ')}`).all() as Array<Record<string, unknown>>;
  const names = playersNamed(rows.map((r) => Number(r.player_id)));
  const subs = new Map<string, string>();
  const subCols = has('sub_leagues');
  if (subCols.has('league_id') && subCols.has('sub_league_id') && subCols.has('abbr')) {
    for (const s of db.prepare(`SELECT league_id, sub_league_id, abbr FROM sub_leagues`).all() as Array<Record<string, unknown>>) {
      const abbr = text(s.abbr);
      if (abbr) subs.set(`${s.league_id}:${s.sub_league_id}`, abbr);
    }
  }
  return rows.flatMap((r) => {
    const player = names.get(Number(r.player_id));
    const club = clubs.majorOf(num(r.team_id)) ?? clubs.majorOf(player?.teamId ?? null);
    if (!player || !club) return [];
    const year = num(r.year);
    const month = num(r.month);
    const dayOf = num(r.day);
    const date = year !== null && month !== null && month > 0 && dayOf !== null && dayOf > 0 ? `${year}-${month}-${dayOf}` : null;
    return [{
      id: `awards:${r.player_id}:${r.award_id}:${year ?? ''}-${month ?? ''}-${dayOf ?? ''}`,
      source: 'awards' as const,
      kind: 'award' as const,
      date,
      day: parseGameDate(date),
      clubs: [club],
      players: [{ playerId: Number(r.player_id), name: player.name }],
      ownWords: null,
      detail: { kind: 'award' as const, award: AWARD_NAMES[Number(r.award_id)], league: subs.get(`${r.league_id}:${r.sub_league_id}`) ?? null },
    }];
  });
}

/**
 * Standings movement between the last two imports Pennant kept (a stated rule): a club that now leads its division alone
 * and did not before, and every club in our division whose place changed. Only clubs in both snapshots.
 */
function standingsFacts(importStamp: string | null, ourTeamId: number | null): { facts: WireFact[]; gap: WireGap | null } {
  if (!importStamp) return { facts: [], gap: null };
  const now = standingsOf(importStamp);
  const before = previousStandings(importStamp);
  if (!now || !before) return { facts: [], gap: { source: 'standings', why: 'no_earlier_standings', detail: null } };
  const was = new Map(before.rows.map((r) => [r.teamId, r]));
  const ours = now.rows.find((r) => r.teamId === ourTeamId) ?? null;
  const sameDivision = (a: StandingsRow, b: StandingsRow | null) => b !== null && a.subLeagueId === b.subLeagueId && a.divisionId === b.divisionId && a.leagueId === b.leagueId;
  const leaders = (rows: StandingsRow[], r: StandingsRow) => rows.filter((x) => sameDivision(x, r) && x.pos === 1).length;
  const place = (r: StandingsRow): StandingsPlace => ({ pos: r.pos, of: r.divisionClubs, gb: r.gb, w: r.w, l: r.l });
  const out: WireFact[] = [];
  for (const r of now.rows) {
    const b = was.get(r.teamId);
    if (!b || r.pos === null || b.pos === null) continue;
    const newLeader = r.pos === 1 && leaders(now.rows, r) === 1 && (b.pos !== 1 || leaders(before.rows, b) > 1);
    const inOurs = sameDivision(r, ours) && r.pos !== b.pos;
    if (!newLeader && !inOurs) continue;
    out.push({
      id: `standings:${importStamp}:${r.teamId}`,
      source: 'standings',
      kind: 'standings',
      date: now.gameDate,
      day: parseGameDate(now.gameDate),
      clubs: [{ teamId: r.teamId, name: r.name, abbr: r.abbr }],
      players: [],
      ownWords: null,
      detail: { kind: 'standings', division: r.division, now: place(r), before: place(b), why: newLeader ? 'leader' : 'ourDivision' },
    });
  }
  return { facts: out, gap: null };
}

// ── the whole wire, cached per import ───────────────────────────────────────

let cached: { key: string; log: TransactionLog | null; facts: WireFacts } | null = null;
let builds = 0;

/** How many times the wire was gathered (for the tests' "served from the cache"). */
export const wireBuilds = (): number => builds;

let lastGatherMs: number | null = null;
/** How long the last gathering took, in milliseconds (the log's and the measurements'); null before the first. */
export const wireGatherMs = (): number | null => lastGatherMs;

/** Forgets the gathered wire (an import, a test). */
export function forgetWire(): void {
  cached = null;
}

/** The league's major-league season and day, from the served club's league (null when not known). */
function seasonOf(): { season: number | null; gameDate: string | null } {
  const cols = has('leagues');
  if (!cols.has('league_id') || !has('teams').has('level')) return { season: null, gameDate: null };
  const row = db.prepare(`SELECT ${cols.has('season_year') ? 'season_year' : 'NULL'} AS season, ${cols.has('current_date') ? '"current_date"' : 'NULL'} AS d
    FROM leagues WHERE league_id IN (SELECT DISTINCT league_id FROM teams WHERE level = 1) ORDER BY league_id LIMIT 1`).get() as Record<string, unknown> | undefined;
  return { season: num(row?.season), gameDate: text(row?.d) };
}

/**
 * Everything on the wire this season, gathered once per import (and per copy of the log the server holds), newest
 * first by day. `importStamp` is the import served; `ourTeamId` the club the app follows (its division's standings).
 */
export function wireFacts(importStamp: string | null, ourTeamId: number | null): WireFacts {
  const peek = located ? peekTransactionLog(located) : peekTransactionLog();
  const log = peek?.log ?? null;
  const key = `${importStamp ?? 'none'}|${ourTeamId ?? '-'}|${peek === null ? 'reading' : log ? 'log' : 'no-log'}|${previousStandings(importStamp)?.importStamp ?? '-'}`;
  if (cached && cached.key === key && cached.log === log) return cached.facts;
  builds += 1;
  const started = performance.now();
  const clubs = leagueClubs();
  const { season, gameDate } = seasonOf();
  const gaps: WireGap[] = [];
  const facts: WireFact[] = [];
  let fromLog = false;
  if (log) {
    fromLog = true;
    facts.push(...logFacts(log, clubs));
  } else {
    gaps.push(peek === null
      ? { source: 'log', why: 'log_reading', detail: null }
      : { source: 'log', why: 'log_unavailable', detail: peek.status.error?.message ?? peek.status.unavailableReason ?? null });
    const snap = snapshotFacts(clubs);
    facts.push(...snap.facts);
    if (snap.gap) gaps.push(snap.gap);
  }
  const table = (source: WireSource, name: string, read: () => WireFact[]) => {
    if (!tableExists(name)) {
      gaps.push({ source, why: 'not_in_export', detail: name });
      return;
    }
    try {
      facts.push(...read());
    } catch (err) {
      console.error(`[wire] ${name} could not be read:`, err);
      // A table that is there but could not be read is not a table the export lacks (D-018)
      gaps.push({ source, why: 'unreadable', detail: name });
    }
  };
  table('trades', 'trade_history', () => tradeFacts(clubs));
  table('news', 'messages', () => newsFacts(clubs));
  table('injuries', 'players_injury_history', () => injuryFacts(clubs, season));
  table('streaks', 'players_streak', () => streakFacts(clubs, gameDate));
  table('awards', 'players_awards', () => awardFacts(clubs, season));
  const standings = standingsFacts(importStamp, ourTeamId);
  facts.push(...standings.facts);
  if (standings.gap) gaps.push(standings.gap);
  const result: WireFacts = {
    facts,
    gaps,
    fromLog,
    gameDate,
    previousGameDate: previousStandings(importStamp)?.gameDate ?? null,
  };
  cached = { key, log, facts: result };
  lastGatherMs = Math.round((performance.now() - started) * 10) / 10;
  return result;
}
