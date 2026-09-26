/**
 * Structured events from OOTP's live transaction database.
 *
 * `team_transactions` is the source: it carries a numeric team id, and it holds
 * every row `league_transactions` does (checked on a real save: 0 of 2,613
 * league rows were missing from it). The league table is read only as extra
 * evidence of how far the database has been written.
 *
 * The log stores each move as an HTML sentence, once per club that saw it.
 * `Optioned X to Triple A Reno` is written for the parent club, and
 * `Received X from Major League Arizona` for the affiliate. Those are kept as
 * two events, because they are two log rows with different wording. Rows that
 * say the same thing from several clubs' points of view (a release is logged
 * for the club and for its organization) are coalesced into one event that
 * lists every source row.
 *
 * Only wording that has been observed is given a meaning. Everything else is
 * kept as an `unsupported` event with its original text: it is explicit,
 * dated, and attributable to a player, and this module simply does not claim
 * to know what it means.
 */

import type Database from 'better-sqlite3';
import type { LiveDatabaseFiles } from './ootpSave.js';
import { withLiveSnapshot, type SnapshotMeta, type SnapshotOptions } from './liveLogSnapshot.js';
import type { Provenance, UnknownReason } from './provenance.js';
import type { GameDate } from './dataFreshness.js';
import type { Integer } from './contract/primitives.js';

export type TransactionKind =
  | 'optioned'
  | 'recalled'
  | 'purchased_contract'
  | 'designated_for_assignment'
  | 'il_placed'
  | 'il_activated'
  | 'restricted_list_placed'
  | 'restricted_list_activated'
  | 'released'
  | 'rule5_return'
  /** "Sent X to <affiliate> for injury rehab" — written for the parent club. */
  | 'rehab_assigned'
  /** "Received X from <parent> for injury rehab" — written for the affiliate. */
  | 'rehab_received'
  | 'rehab_returned'
  /** Promoted / Demoted / Assigned / Sent / Received between clubs, no rights meaning attached. */
  | 'minor_league_assignment'
  | 'unsupported';

export interface TeamRef {
  id: number;
  name: string;
  /** The level as OOTP words it in the log: "Triple A", "Major League", ... */
  levelLabel: string | null;
}

export interface TransactionSource {
  table: 'team_transactions';
  logId: number;
  teamId: number | null;
  /** OOTP's own `transaction_type` code, kept verbatim. Its meaning is not asserted. */
  rawType: number | null;
}

export interface TransactionEvent {
  /** Stable within one log: `team_transactions:<first log id>`. */
  id: string;
  provenance: Extract<Provenance, 'explicit_log'>;
  kind: TransactionKind;
  /** False when the wording is not understood. The event is still real. */
  supported: boolean;
  unsupportedReason?: UnknownReason;
  /** ISO date, or null if the stored date is unparseable. */
  date: string | null;
  rawDate: string;
  season: number | null;
  playerId: number | null;
  playerName: string | null;
  position: string | null;
  /** The club it moved from, where the wording names one. */
  from: TeamRef | null;
  /** The club it moved to, where the wording names one. */
  to: TeamRef | null;
  /** Kind-specific facts (waiver status, IL length, verb, ...). */
  details: Record<string, string | number | boolean | null>;
  /** The sentence with markup removed. */
  text: string;
  /** The sentence exactly as stored. */
  rawText: string;
  sources: TransactionSource[];
}

const PLAYER_LINK = /<a href="\.\.\/players\/player_(\d+)\.html">([^<]*)<\/a>/g;
const TEAM_LINK = /<a href="\.\.\/teams\/team_(\d+)\.html">([^<]*)<\/a>/g;
const ANY_TAG = /<[^>]*>/g;

const POS = '(?<pos>[A-Z0-9]{1,3})';
const LEVEL = '[A-Za-z][A-Za-z\\- ]*?';

export function isoFromStored(raw: string | null | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec((raw ?? '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function isoFromUs(raw: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

interface Rule {
  kind: TransactionKind;
  re: RegExp;
  /** Which of the sentence's club links are the source and destination, in order. */
  clubs?: Array<'from' | 'to'>;
  details?: (g: Record<string, string | undefined>) => Record<string, string | number | boolean | null>;
}

const RULES: Rule[] = [
  { kind: 'optioned', re: new RegExp(`^Optioned ${POS} {P} to (?<toLevel>${LEVEL}) {T}\\.$`), clubs: ['to'] },
  { kind: 'recalled', re: new RegExp(`^Recalled ${POS} {P} from (?<fromLevel>${LEVEL}) {T}\\.$`), clubs: ['from'] },
  {
    kind: 'purchased_contract',
    re: new RegExp(`^Purchased the contract of ${POS} {P} from (?<fromLevel>${LEVEL}) {T}\\.$`),
    clubs: ['from'],
  },
  {
    kind: 'designated_for_assignment',
    re: new RegExp(
      `^${POS} {P} was designated for assignment and placed on (?<waiver>irrevocable waivers|waivers)(?: \\((?<note>[^)]*)\\))?\\.$`
    ),
    details: (g) => ({
      waiverStatus: g.waiver === 'irrevocable waivers' ? 'irrevocable_waivers' : 'waivers',
      qualifier: g.note ?? null,
    }),
  },
  {
    kind: 'il_placed',
    re: new RegExp(
      `^Placed ${POS} {P} on the (?:(?<league>.+?) )?(?<days>\\d+)-day injured list(?:, retroactive to (?<retro>\\d{2}/\\d{2}/\\d{4}))?\\.$`
    ),
    details: (g) => ({
      days: g.days ? Number(g.days) : null,
      league: g.league ?? null,
      retroactiveTo: g.retro ? isoFromUs(g.retro) : null,
    }),
  },
  { kind: 'il_activated', re: new RegExp(`^Activated ${POS} {P} from the injured list\\.$`) },
  { kind: 'restricted_list_placed', re: new RegExp(`^Placed ${POS} {P} on the restricted list\\.$`) },
  { kind: 'restricted_list_activated', re: new RegExp(`^Activated ${POS} {P} from the restricted list\\.$`) },
  { kind: 'released', re: new RegExp(`^Released ${POS} {P}\\.$`) },
  {
    kind: 'rule5_return',
    re: new RegExp(
      `^Released former Rule 5 draft pick ${POS} {P}, returned to original Organization (?<org>.+?)\\.$`
    ),
    details: (g) => ({ perspective: 'released_back', organization: g.org ?? null }),
  },
  {
    kind: 'rule5_return',
    re: new RegExp(`^Received former Rule 5 draft pick ${POS} {P} from the (?<org>.+?)\\.$`),
    details: (g) => ({ perspective: 'received_back', organization: g.org ?? null }),
  },
  {
    kind: 'rehab_assigned',
    re: new RegExp(`^Sent ${POS} {P} to (?<toLevel>${LEVEL}) {T} for injury rehab\\.$`),
    clubs: ['to'],
  },
  {
    kind: 'rehab_received',
    re: new RegExp(`^Received ${POS} {P} from (?<fromLevel>${LEVEL}) {T} for injury rehab\\.$`),
    clubs: ['from'],
  },
  { kind: 'rehab_returned', re: new RegExp(`^${POS} {P} returns from his rehab assignment\\.$`) },
  {
    kind: 'minor_league_assignment',
    re: new RegExp(
      `^(?<verb>Promoted|Demoted|Assigned|Sent|Received) ${POS} {P}(?: from (?<fromLevel>${LEVEL}) {T})?(?: to (?<toLevel>${LEVEL}) {T})?\\.$`
    ),
    details: (g) => ({ verb: g.verb ?? null }),
  },
];

export interface ParseContext {
  logId: number;
  teamId: number | null;
  rawType: number | null;
  rawDate: string;
  season: number | null;
}

/** Turns one stored sentence into an event. Never throws and never drops a row. */
export function parseTransaction(rawText: string, ctx: ParseContext): TransactionEvent {
  const players: Array<{ id: number; name: string }> = [];
  const teamRefs: Array<{ id: number; name: string }> = [];
  // Links become tokens so the sentence can be matched without caring what a
  // player or club is called; the names and ids are kept aside in order
  const tokenized = rawText
    .replace(PLAYER_LINK, (_m, id: string, name: string) => {
      players.push({ id: Number(id), name });
      return '{P}';
    })
    .replace(TEAM_LINK, (_m, id: string, name: string) => {
      teamRefs.push({ id: Number(id), name });
      return '{T}';
    })
    .replace(ANY_TAG, '')
    .replace(/\s+/g, ' ')
    .trim();
  let playerAt = 0;
  let teamAt = 0;
  const text = tokenized
    .replace(/{P}/g, () => players[playerAt++]?.name ?? '')
    .replace(/{T}/g, () => teamRefs[teamAt++]?.name ?? '');

  const base = {
    id: `team_transactions:${ctx.logId}`,
    provenance: 'explicit_log' as const,
    date: isoFromStored(ctx.rawDate),
    rawDate: ctx.rawDate,
    season: ctx.season,
    playerId: players[0]?.id ?? null,
    playerName: players[0]?.name ?? null,
    rawText,
    text,
    sources: [{ table: 'team_transactions' as const, logId: ctx.logId, teamId: ctx.teamId, rawType: ctx.rawType }],
  };

  for (const rule of RULES) {
    const match = rule.re.exec(tokenized);
    if (!match) continue;
    const groups = match.groups ?? {};
    const levels = { from: groups.fromLevel?.trim() ?? null, to: groups.toLevel?.trim() ?? null };
    let from: TeamRef | null = null;
    let to: TeamRef | null = null;
    if (rule.kind === 'minor_league_assignment') {
      const ordered = [levels.from !== null ? 'from' : null, levels.to !== null ? 'to' : null].filter(
        (x): x is 'from' | 'to' => x !== null
      );
      if (ordered.length === 0) continue;
      ordered.forEach((role, i) => {
        const club = teamRefs[i];
        if (!club) return;
        const ref = { ...club, levelLabel: levels[role] };
        if (role === 'from') from = ref;
        else to = ref;
      });
    } else {
      (rule.clubs ?? []).forEach((role, i) => {
        const club = teamRefs[i];
        if (!club) return;
        const ref = { ...club, levelLabel: levels[role] };
        if (role === 'from') from = ref;
        else to = ref;
      });
    }
    return {
      ...base,
      kind: rule.kind,
      supported: true,
      position: groups.pos ?? null,
      from,
      to,
      details: rule.details ? rule.details(groups) : {},
    };
  }

  return {
    ...base,
    kind: 'unsupported',
    supported: false,
    unsupportedReason: 'transaction_type_not_understood',
    position: null,
    from: null,
    to: null,
    details: {},
  };
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
const cp1252 = new TextDecoder('windows-1252');

/**
 * Text comes out of the database as bytes. OOTP writes some rows in a legacy
 * single-byte encoding (Vázquez stored as 0xE1), which is not valid UTF-8; a
 * driver that decodes as UTF-8 either throws on the row or substitutes garbage.
 */
export function decodeLogText(bytes: Uint8Array | null | undefined): string {
  if (!bytes) return '';
  try {
    return utf8.decode(bytes);
  } catch {
    return cp1252.decode(bytes);
  }
}

/** Same-move rows written for several clubs collapse into one event. */
function coalesce(events: TransactionEvent[]): TransactionEvent[] {
  const byKey = new Map<string, TransactionEvent>();
  for (const event of events) {
    // Unsupported rows are never merged: without a meaning there is nothing to
    // say two of them describe the same move
    const key = event.supported
      ? JSON.stringify([
          event.date, event.kind, event.playerId, event.from?.id ?? null, event.to?.id ?? null, event.details,
        ])
      : `unsupported:${event.id}`;
    const existing = byKey.get(key);
    if (existing) existing.sources.push(...event.sources);
    else byKey.set(key, { ...event, sources: [...event.sources] });
  }
  return [...byKey.values()];
}

export interface LogCoverage {
  firstTransactionDate: GameDate | null;
  /** The newest date on any transaction row. */
  lastTransactionDate: GameDate | null;
  /** The newest date on any day-stamped table in the database. */
  activityThrough: GameDate | null;
  /**
   * How far the database has demonstrably been written. Days with no
   * transactions (off-season, an off-day) leave `lastTransactionDate` behind
   * without the log being behind, so this takes the newest of everything.
   */
  coveredThrough: GameDate | null;
  season: Integer | null;
}

export interface TransactionLog {
  events: TransactionEvent[];
  byPlayer: Map<number, TransactionEvent[]>;
  coverage: LogCoverage;
  counts: {
    rows: number;
    events: number;
    unsupported: number;
    byKind: Partial<Record<TransactionKind, number>>;
  };
  /** A few unparsed sentences, so unknown wording is visible instead of silently ignored. */
  unsupportedSamples: string[];
  snapshot: SnapshotMeta;
}

/** Each of these is stamped with an in-game date whenever the game writes to it. */
const DATED_TABLES: Array<[table: string, column: string]> = [
  ['team_transactions', 'transaction_date'],
  ['league_transactions', 'transaction_date'],
  ['player_history', 'history_date'],
  ['league_news', 'news_date'],
  ['league_injuries', 'injury_date'],
  ['team_news', 'news_date'],
  ['team_injuries', 'injury_date'],
];

const stampOf = (raw: unknown): string | null => {
  const iso = typeof raw === 'string' ? isoFromStored(raw) : null;
  return iso;
};

const maxIso = (values: Array<string | null>): string | null =>
  values.reduce<string | null>((a, b) => (b && (!a || b > a) ? b : a), null);

function readCoverage(db: InstanceType<typeof Database>, season: number | null): LogCoverage {
  const tables = new Set(
    (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map(
      (t) => t.name
    )
  );
  const maxOf = (table: string, column: string): string | null => {
    if (!tables.has(table)) return null;
    try {
      const row = db.prepare(`SELECT MAX("${column}") AS d FROM "${table}"`).get() as { d: unknown };
      return stampOf(row?.d);
    } catch {
      return null;
    }
  };
  const first = tables.has('team_transactions')
    ? stampOf((db.prepare(`SELECT MIN(transaction_date) AS d FROM team_transactions`).get() as { d: unknown })?.d)
    : null;
  const lastTransactionDate = maxIso([
    maxOf('team_transactions', 'transaction_date'),
    maxOf('league_transactions', 'transaction_date'),
  ]);
  const activityThrough = maxIso(DATED_TABLES.map(([t, c]) => maxOf(t, c)));
  return {
    firstTransactionDate: first,
    lastTransactionDate,
    activityThrough,
    coveredThrough: maxIso([lastTransactionDate, activityThrough]),
    season,
  };
}

/**
 * Reads and parses the live log through a safe snapshot.
 * Throws {@link LiveLogError} if no consistent snapshot can be taken.
 *
 * Only the current and previous season are parsed: a save accumulates every
 * season it has ever played, and rights questions never reach further back.
 */
export function readTransactionLog(files: LiveDatabaseFiles, opts: SnapshotOptions = {}): TransactionLog {
  return withLiveSnapshot(
    files,
    ({ db, meta }) => {
      const seasonRow = db.prepare(`SELECT MAX(season) AS s FROM team_transactions`).get() as { s: number | null };
      const season = typeof seasonRow?.s === 'number' ? seasonRow.s : null;
      const rows = db
        .prepare(
          `SELECT transaction_id AS id, team_id AS teamId, transaction_date AS date,
                  transaction_type AS type, season, CAST(transaction_text AS BLOB) AS text
           FROM team_transactions
           WHERE ? IS NULL OR season IS NULL OR season >= ?
           ORDER BY transaction_id`
        )
        .all(season, season === null ? null : season - 1) as Array<{
        id: number; teamId: number | null; date: string | null; type: number | null;
        season: number | null; text: Uint8Array | null;
      }>;

      const parsed = rows.map((row) =>
        parseTransaction(decodeLogText(row.text), {
          logId: row.id,
          teamId: row.teamId,
          rawType: row.type,
          rawDate: row.date ?? '',
          season: row.season,
        })
      );
      const events = coalesce(parsed);
      events.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.sources[0].logId - b.sources[0].logId);

      const byPlayer = new Map<number, TransactionEvent[]>();
      const byKind: Partial<Record<TransactionKind, number>> = {};
      const unsupportedSamples: string[] = [];
      for (const event of events) {
        byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;
        if (!event.supported && unsupportedSamples.length < 5) unsupportedSamples.push(event.text);
        if (event.playerId === null) continue;
        const list = byPlayer.get(event.playerId);
        if (list) list.push(event);
        else byPlayer.set(event.playerId, [event]);
      }

      return {
        events,
        byPlayer,
        coverage: readCoverage(db, season),
        counts: {
          rows: rows.length,
          events: events.length,
          unsupported: byKind.unsupported ?? 0,
          byKind,
        },
        unsupportedSamples,
        snapshot: meta,
      };
    },
    { requiredTables: ['team_transactions'], ...opts }
  );
}
