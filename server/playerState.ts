/**
 * Current State: what OOTP's export says is objectively true about a player now.
 *
 * This is one of three separate concerns (see D-020):
 *
 *   Current State        this module — read from the CSV export, field by field
 *   Transaction history  `transactionLog.ts` — what explicitly happened
 *   Rights / eligibility what may legally be done now — not implemented here
 *
 * Every field states where it came from. A field the export carries is read
 * as `explicit_export` and is never re-derived from history or from
 * differences between snapshots. A field it does not carry is `unknown` with
 * the reason, and is never filled in with a plausible guess.
 *
 * In particular, 40-man membership is `players_roster_status.is_on_secondary`
 * as exported. It is not "active, or on the secondary roster, or on the MLB
 * injured list": on a real save that inference reported 35 players against the
 * export's 30, counting five 60-day-IL players OOTP itself does not list on
 * the 40-man. Whether such a player *should* count is a rights question; the
 * state layer reports what the export says.
 */

import { db, tableColumns, tableExists } from './db.js';
import { healthOf, standingOf, type Health, type Standing } from './health.js';
import {
  derivedFrom, fromExport, unknownBecause,
  type Sourced,
} from './provenance.js';

export interface PlayerState {
  playerId: number;
  name: string;
  age: number | null;

  /** `players.organization_id` */
  organizationId: Sourced<number>;
  /** `players.team_id` — the club the player is currently assigned to. */
  teamId: Sourced<number>;
  /** `teams.level` of that club: 1 is MLB, 2 Triple-A, and so on. */
  level: Sourced<number>;

  /** `players.position` — OOTP's listed position (1 pitcher, 2 catcher ... 9 right field, 10 DH). */
  position: Sourced<number>;
  /** `players.role` — OOTP's pitcher assignment (11 starter, 12 reliever, 13 closer); 0 for hitters. */
  role: Sourced<number>;

  /** `players_roster_status.is_active` — on the MLB active roster. */
  activeRoster: Sourced<boolean>;
  /** `players_roster_status.is_on_secondary` — on the 40-man (secondary) roster. */
  fortyMan: Sourced<boolean>;

  injuredList: {
    onIl: Sourced<boolean>;
    onIl60: Sourced<boolean>;
  };
  injury: {
    injured: Sourced<boolean>;
    dayToDay: Sourced<boolean>;
    daysLeft: Sourced<number>;
    /** `players.injury_dl_left`, days left on the injured list, as exported. */
    ilDaysLeft: Sourced<number>;
    /** `players.injury_career_ending`, as exported. */
    careerEnding: Sourced<boolean>;
  };

  dfa: {
    designated: Sourced<boolean>;
    /** `days_on_dfa_left`, as exported. */
    daysLeft: Sourced<number>;
    onWaivers: Sourced<boolean>;
    waiverDaysLeft: Sourced<number>;
    irrevocableWaivers: Sourced<boolean>;
  };

  serviceTime: {
    mlbYears: Sourced<number>;
    mlbDays: Sourced<number>;
    mlbDaysThisSeason: Sourced<number>;
    professionalYears: Sourced<number>;
    professionalDays: Sourced<number>;
  };

  /** Option counters and flags exactly as exported; none is read as "optionable". */
  options: {
    used: Sourced<number>;
    usedThisYear: Sourced<number>;
    yearsProtectedFromRule5: Sourced<number>;
  };

  contract: {
    /** `players_contract.is_major` — a major-league contract. False is a minor-league contract. */
    majorLeague: Sourced<boolean>;
  };

  wasTraded: Sourced<boolean>;

  /** Derived from the explicit fields above for display; never a source of them. */
  health: Sourced<Health | null>;
  standing: Sourced<Standing>;
}

const STATUS = 'players_roster_status';

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

interface Schema {
  players: Set<string>;
  status: Set<string> | null;
  teams: Set<string> | null;
  contract: Set<string> | null;
}

function readSchema(): Schema {
  return {
    players: new Set(tableColumns('players')),
    status: tableExists(STATUS) ? new Set(tableColumns(STATUS)) : null,
    teams: tableExists('teams') ? new Set(tableColumns('teams')) : null,
    contract: tableExists('players_contract') ? new Set(tableColumns('players_contract')) : null,
  };
}

/** A column the query can select, or NULL in its place. */
const pick = (columns: Set<string> | null, alias: string, column: string): string =>
  columns?.has(column) ? `${alias}."${column}" AS "${alias}_${column}"` : `NULL AS "${alias}_${column}"`;

const STATUS_COLUMNS = [
  'player_id', 'is_active', 'is_on_secondary', 'is_on_dl', 'is_on_dl60',
  'designated_for_assignment', 'days_on_dfa_left', 'is_on_waivers', 'days_on_waivers_left',
  'irrevocable_waivers', 'options_used', 'options_used_this_year', 'years_protected_from_rule_5',
  'mlb_service_years', 'mlb_service_days', 'mlb_service_days_this_year',
  'pro_service_years', 'pro_service_days', 'was_traded',
];
const PLAYER_COLUMNS = [
  'player_id', 'first_name', 'last_name', 'age', 'organization_id', 'team_id', 'retired', 'position', 'role',
  'injury_is_injured', 'injury_dtd_injury', 'injury_left', 'injury_dl_left', 'injury_career_ending',
];

type Row = Record<string, unknown>;

/**
 * Reads one exported column into a sourced value. The three ways a value can
 * be absent are kept apart: the table is missing, the column is missing, or
 * OOTP exported it blank.
 */
function exported<T>(
  present: { table: boolean; column: boolean },
  table: string,
  column: string,
  raw: unknown,
  convert: (n: number) => T,
  rowMissing = false
): Sourced<T> {
  const source = `${table}.${column}`;
  if (!present.table) return unknownBecause('source_unavailable', source, `${table} is not in the export.`);
  if (!present.column) return unknownBecause('not_exported_by_ootp', source, `${table} has no ${column} column.`);
  if (rowMissing) return unknownBecause('not_exported_by_ootp', source, `${table} has no row for this player.`);
  const n = numberOrNull(raw);
  if (n === null) return unknownBecause('not_exported_by_ootp', source, `${column} is blank in the export.`);
  return fromExport(convert(n), source);
}

const flag = (n: number): boolean => n === 1;
const asIs = (n: number): number => n;

function stateFromRow(row: Row, schema: Schema, majorContract: Map<number, boolean> | null): PlayerState {
  const statusTable = schema.status !== null;
  const hasStatusRow = numberOrNull(row.rs_player_id) !== null;
  const status = <T>(column: string, convert: (n: number) => T): Sourced<T> =>
    exported(
      { table: statusTable, column: !!schema.status?.has(column) },
      STATUS, column, row[`rs_${column}`], convert, statusTable && !hasStatusRow
    );
  const player = <T>(column: string, convert: (n: number) => T): Sourced<T> =>
    exported({ table: true, column: schema.players.has(column) }, 'players', column, row[`p_${column}`], convert);

  const teamLevel = schema.teams?.has('level')
    ? exported({ table: true, column: true }, 'teams', 'level', row.t_level, asIs)
    : unknownBecause<number>(schema.teams ? 'not_exported_by_ootp' : 'source_unavailable', 'teams.level');

  const id = numberOrNull(row.p_player_id) ?? 0;
  const active = status('is_active', flag);
  const il = status('is_on_dl', flag);
  const il60 = status('is_on_dl60', flag);
  const injured = player('injury_is_injured', flag);
  const dayToDay = player('injury_dtd_injury', flag);
  const daysLeft = player('injury_left', asIs);
  const designated = status('designated_for_assignment', flag);
  const daysOnDfa = status('days_on_dfa_left', asIs);
  const onWaivers = status('is_on_waivers', flag);

  // health/standing are conveniences computed from the explicit fields, and are
  // only offered when every field they read was actually exported
  const healthInputs = [active, il, il60];
  const healthKnown = healthInputs.every((f) => f.value !== null);
  const standingKnown = healthKnown && [designated, onWaivers, daysOnDfa].every((f) => f.value !== null);
  const flags = {
    is_active: active.value === null ? null : active.value ? 1 : 0,
    is_on_dl: il.value === null ? null : il.value ? 1 : 0,
    is_on_dl60: il60.value === null ? null : il60.value ? 1 : 0,
    injury_is_injured: injured.value === null ? null : injured.value ? 1 : 0,
    injury_dtd_injury: dayToDay.value === null ? null : dayToDay.value ? 1 : 0,
    injury_left: daysLeft.value,
    designated_for_assignment: designated.value === null ? null : designated.value ? 1 : 0,
    days_on_dfa_left: daysOnDfa.value,
    is_on_waivers: onWaivers.value === null ? null : onWaivers.value ? 1 : 0,
  };
  const unknownDerived = <T>(): Sourced<T> =>
    unknownBecause('not_exported_by_ootp', null, 'A field this is derived from was not exported.');

  const major: Sourced<boolean> =
    majorContract === null
      ? unknownBecause('source_unavailable', 'players_contract.is_major', 'players_contract is not in the export.')
      : majorContract.has(id)
        ? fromExport(majorContract.get(id)!, 'players_contract.is_major')
        : unknownBecause('not_exported_by_ootp', 'players_contract.is_major', 'No contract row for this player.');

  return {
    playerId: id,
    name: [row.p_first_name, row.p_last_name].filter((s): s is string => typeof s === 'string' && s.length > 0).join(' '),
    age: numberOrNull(row.p_age),
    organizationId: player('organization_id', asIs),
    teamId: player('team_id', asIs),
    level: teamLevel,
    position: player('position', asIs),
    role: player('role', asIs),
    activeRoster: active,
    fortyMan: status('is_on_secondary', flag),
    injuredList: { onIl: il, onIl60: il60 },
    injury: { injured, dayToDay, daysLeft, ilDaysLeft: player('injury_dl_left', asIs), careerEnding: player('injury_career_ending', flag) },
    dfa: {
      designated,
      daysLeft: daysOnDfa,
      onWaivers,
      waiverDaysLeft: status('days_on_waivers_left', asIs),
      irrevocableWaivers: status('irrevocable_waivers', flag),
    },
    serviceTime: {
      mlbYears: status('mlb_service_years', asIs),
      mlbDays: status('mlb_service_days', asIs),
      mlbDaysThisSeason: status('mlb_service_days_this_year', asIs),
      professionalYears: status('pro_service_years', asIs),
      professionalDays: status('pro_service_days', asIs),
    },
    options: {
      used: status('options_used', asIs),
      usedThisYear: status('options_used_this_year', asIs),
      yearsProtectedFromRule5: status('years_protected_from_rule_5', asIs),
    },
    contract: { majorLeague: major },
    wasTraded: status('was_traded', flag),
    health: healthKnown
      ? derivedFrom(healthOf(flags), 'players_roster_status + players injury fields')
      : unknownDerived(),
    standing: standingKnown
      ? derivedFrom(standingOf(flags), 'players_roster_status + players injury fields')
      : unknownDerived(),
  };
}

function majorLeagueContracts(schema: Schema): Map<number, boolean> | null {
  if (!schema.contract?.has('player_id') || !schema.contract.has('is_major')) return null;
  return new Map(
    (db.prepare('SELECT player_id, is_major FROM players_contract').all() as Array<{ player_id: number; is_major: number | null }>)
      .map((r) => [r.player_id, r.is_major === 1])
  );
}

function query(where: string, params: unknown[]): PlayerState[] {
  if (!tableExists('players')) return [];
  const schema = readSchema();
  if (!schema.players.has('player_id')) return [];
  const canJoinStatus = !!schema.status?.has('player_id');
  const canJoinTeams = !!schema.teams?.has('team_id') && schema.players.has('team_id');
  const select = [
    ...PLAYER_COLUMNS.map((c) => pick(schema.players, 'p', c)),
    ...STATUS_COLUMNS.map((c) => (canJoinStatus ? pick(schema.status, 'rs', c) : `NULL AS "rs_${c}"`)),
    canJoinTeams && schema.teams?.has('level') ? 't.level AS t_level' : 'NULL AS t_level',
  ].join(', ');
  const rows = db
    .prepare(
      `SELECT ${select}
       FROM players p
       ${canJoinStatus ? 'LEFT JOIN players_roster_status rs ON rs.player_id = p.player_id' : ''}
       ${canJoinTeams ? 'LEFT JOIN teams t ON t.team_id = p.team_id' : ''}
       WHERE ${schema.players.has('retired') ? 'p.retired = 0 AND ' : ''}${where}`
    )
    .all(...params) as Row[];
  const contracts = majorLeagueContracts(schema);
  return rows.map((row) => stateFromRow(row, schema, contracts));
}

export function playerState(playerId: number): PlayerState | null {
  return query('p.player_id = ?', [playerId])[0] ?? null;
}

/** States for a set of players, keyed by id. Chunked to stay under SQLite's variable limit. */
export function playerStates(playerIds: number[]): Map<number, PlayerState> {
  const out = new Map<number, PlayerState>();
  for (let at = 0; at < playerIds.length; at += 500) {
    const chunk = playerIds.slice(at, at + 500);
    for (const state of query(`p.player_id IN (${chunk.map(() => '?').join(',')})`, chunk)) {
      out.set(state.playerId, state);
    }
  }
  return out;
}

/** Every player in an organization, across all its affiliates. */
export function organizationPlayerStates(orgId: number): PlayerState[] {
  return query('p.organization_id = ?', [orgId]);
}

/** Every non-retired player; the source for roster-state snapshots. */
export function allPlayerStates(): PlayerState[] {
  return query('1 = 1', []);
}

/**
 * How far the season's service clock has run, per major league: the most
 * major-league service days anyone on one of its major-league clubs has banked
 * this season (`players_roster_status.mlb_service_days_this_year`). A man who has
 * been up since Opening Day has banked the season's whole clock, so this is the
 * season's own progress: 0 before Opening Day, the service-year length once the
 * season is over. Derived, and unknown (with why) where the export cannot state it.
 */
export function seasonServiceClocks(): (leagueId: number) => Sourced<number> {
  const source = 'MAX(players_roster_status.mlb_service_days_this_year) on major-league clubs';
  const unavailable = (reason: 'source_unavailable' | 'not_exported_by_ootp', note: string) => {
    const u = unknownBecause<number>(reason, source, note);
    return () => u;
  };
  if (!tableExists('players') || !tableExists(STATUS) || !tableExists('teams')) {
    return unavailable('source_unavailable', 'The roster-status, players or teams table is not in the export.');
  }
  const schema = readSchema();
  if (!schema.status?.has('mlb_service_days_this_year') || !schema.status.has('player_id')) {
    return unavailable('not_exported_by_ootp', 'players_roster_status has no mlb_service_days_this_year column.');
  }
  if (!schema.teams?.has('level') || !schema.teams.has('league_id') || !schema.teams.has('team_id') || !schema.players.has('team_id')) {
    return unavailable('not_exported_by_ootp', 'teams has no level or league_id column, so the major-league clubs cannot be found.');
  }
  const rows = db
    .prepare(
      `SELECT t.league_id AS league_id, MAX(rs.mlb_service_days_this_year) AS banked
       FROM players_roster_status rs
       JOIN players p ON p.player_id = rs.player_id
       JOIN teams t ON t.team_id = p.team_id
       WHERE t.level = 1${schema.players.has('retired') ? ' AND p.retired = 0' : ''}
       GROUP BY t.league_id`
    )
    .all() as Array<{ league_id: unknown; banked: unknown }>;
  const byLeague = new Map<number, Sourced<number>>();
  for (const r of rows) {
    const id = numberOrNull(r.league_id);
    const banked = numberOrNull(r.banked);
    if (id === null) continue;
    byLeague.set(id, banked === null
      ? unknownBecause<number>('not_exported_by_ootp', source, 'mlb_service_days_this_year is blank for every major leaguer.')
      : derivedFrom(banked, source));
  }
  return (leagueId: number) =>
    byLeague.get(leagueId) ?? unknownBecause<number>('not_exported_by_ootp', source, `League ${leagueId} has no major-league club with a roster-status row.`);
}

/** One held player's place in the league's service class (for the Super Two cutoff). */
export interface ServiceClassMember {
  playerId: number;
  /** The league of the club he is on (`teams.league_id`); its contract regime decides his class. */
  leagueId: number | null;
  /** `mlb_service_days`, this season's included; null when not exported. */
  mlbDays: number | null;
  /** `mlb_service_days_this_year`; null when not exported. */
  mlbDaysThisSeason: number | null;
  /** On a major-league club's active roster or injured list, so still banking service; null when unknown. */
  onMajorLeagueRoster: boolean | null;
}

/**
 * Every player a club holds, with the service facts a Super Two class is ranked on, read once.
 * Objective facts as exported; a value the export does not carry is null, never 0.
 */
export function serviceClassMembers(): ServiceClassMember[] {
  if (!tableExists('players') || !tableExists('teams')) return [];
  const schema = readSchema();
  if (!schema.players.has('player_id') || !schema.players.has('team_id') || !schema.teams?.has('team_id')) return [];
  const joined = !!schema.status?.has('player_id');
  const status = (column: string) => (joined && schema.status?.has(column) ? `rs."${column}"` : 'NULL');
  const level = schema.teams.has('level') ? 't.level' : 'NULL';
  const league = schema.teams.has('league_id') ? 't.league_id' : 'NULL';
  const rows = db
    .prepare(
      `SELECT p.player_id AS id, ${league} AS league_id, ${status('mlb_service_days')} AS days,
              ${status('mlb_service_days_this_year')} AS this_year, ${level} AS level,
              ${status('is_active')} AS active, ${status('is_on_dl')} AS il, ${status('is_on_dl60')} AS il60
       FROM players p
       JOIN teams t ON t.team_id = p.team_id
       ${joined ? 'LEFT JOIN players_roster_status rs ON rs.player_id = p.player_id' : ''}
       WHERE p.team_id > 0${schema.players.has('retired') ? ' AND p.retired = 0' : ''}`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const lvl = numberOrNull(r.level);
    const flags = [r.active, r.il, r.il60].map(numberOrNull);
    const onRoster = lvl === null ? null
      : lvl !== 1 ? false
        : flags.some((f) => f === 1) ? true
          : flags.some((f) => f === null) ? null : false;
    return {
      playerId: numberOrNull(r.id) ?? 0,
      leagueId: numberOrNull(r.league_id),
      mlbDays: numberOrNull(r.days),
      mlbDaysThisSeason: numberOrNull(r.this_year),
      onMajorLeagueRoster: onRoster,
    };
  });
}
