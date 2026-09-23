/**
 * The league rules OOTP exports, as current state. The one `LeagueRules` (D-052).
 *
 * A rights evaluator must not hard-code MLB: the export says whether options
 * exist in this league, how long DFA and waiver periods run, how large the
 * rosters may be, and how long a player must serve before arbitration and free
 * agency. Each is read as exported (`explicit_export`); a missing table,
 * column, or blank is an unknown with its reason, never a default. In
 * particular a missing free-agency rule is never six years, a missing
 * arbitration rule never three, and a missing service-year length never 172
 * days (PLAYER_VALUE_RESEARCH.md R-10).
 *
 * Two groups of rules resolve differently:
 *
 *   roster rules    read from the league's own row: a minor league's roster
 *                   limits are its own.
 *   contract rules  the regime a player's contract rights live under: free
 *                   agency, arbitration, the minimum salary, the service-year
 *                   length, the money scale. Every minor league exports zeros
 *                   for these (R-2), which are not the rules its players live
 *                   under, so they are read from the league at the top of its
 *                   `parent_league_id` chain. A league whose parent cannot be
 *                   established has an unknown regime, never its own zeros.
 */

import { db, tableColumns, tableExists } from './db.js';
import { fromExport, unknownBecause, type Sourced } from './provenance.js';

/** The contract-control regime: the rules a player's contract rights are decided by. */
export interface ContractRules {
  /** The league whose row these rules were read from: this league, or the top of its parent chain. */
  regimeLeagueId: Sourced<number>;
  /** `leagues.rules_financials` — the league runs finances. */
  financials: Sourced<boolean>;
  /** `leagues.rules_fa_minimum_years`. 0 is the export's way of saying the league has no free agency (reserve clause). */
  freeAgencyYears: Sourced<number>;
  /** `leagues.rules_salary_arbitration_minimum_years`. 0 means the league has no arbitration. */
  arbitrationYears: Sourced<number>;
  /** `leagues.rules_minor_league_fa_minimum_years`. How OOTP counts it (which service) is not established. */
  minorLeagueFreeAgencyYears: Sourced<number>;
  /** `leagues.rules_minimum_salary` */
  minimumSalary: Sourced<number>;
  /** `leagues.rules_min_service_days` — days of major-league service that make one service year. */
  serviceDaysPerYear: Sourced<number>;
  /** `leagues.financial_coefficient` — OOTP's money scale; historical leagues run far below 1.0. */
  financialCoefficient: Sourced<number>;
  /** `leagues.season_year` of the regime league: the season the contract rules are being applied in. */
  season: Sourced<number>;
}

export interface LeagueRules {
  leagueId: Sourced<number>;
  /** `leagues.rules_minor_league_options` — option years exist in this league. */
  minorLeagueOptions: Sourced<boolean>;
  /** `leagues.rules_rule_5` */
  ruleFiveDraft: Sourced<boolean>;
  /** `leagues.rules_dfa_period_length`, in calendar days. */
  dfaPeriodDays: Sourced<number>;
  /** `leagues.rules_waiver_period_length`, in calendar days. */
  waiverPeriodDays: Sourced<number>;
  /** `leagues.rules_active_roster_limit` */
  activeRosterLimit: Sourced<number>;
  /** `leagues.rules_expanded_roster_limit` */
  expandedRosterLimit: Sourced<number>;
  /** `leagues.rosters_expanded` — the expanded active limit is in force. */
  rostersExpanded: Sourced<boolean>;
  /** `leagues.rules_secondary_roster_limit` — the 40-man limit. */
  fortyManLimit: Sourced<number>;
  /** The contract-control regime, resolved through `parent_league_id`. */
  contract: ContractRules;
}

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const ROSTER_COLUMNS = [
  'league_id', 'rules_minor_league_options', 'rules_rule_5', 'rules_dfa_period_length',
  'rules_waiver_period_length', 'rules_active_roster_limit', 'rules_expanded_roster_limit',
  'rosters_expanded', 'rules_secondary_roster_limit',
] as const;

const CONTRACT_COLUMNS = [
  'parent_league_id', 'rules_financials', 'rules_fa_minimum_years', 'rules_salary_arbitration_minimum_years',
  'rules_minor_league_fa_minimum_years', 'rules_minimum_salary', 'rules_min_service_days', 'financial_coefficient',
  'season_year',
] as const;

const COLUMNS = [...ROSTER_COLUMNS, ...CONTRACT_COLUMNS] as const;
type Column = (typeof COLUMNS)[number];

/** The raw values `leagueRulesFromRow` reads; a test can supply them without a database. */
export type LeagueRuleRow = Partial<Record<Column, unknown>>;

/** Finds another league's row, for resolving a parent chain; null when the export has none. */
export type LeagueRowLookup = (leagueId: number) => LeagueRuleRow | null;

const noLookup: LeagueRowLookup = () => null;

type UnknownKind = 'source_unavailable' | 'not_exported_by_ootp';

function unknownContract(reason: UnknownKind, note: string): ContractRules {
  const u = <T>(column: string): Sourced<T> => unknownBecause<T>(reason, `leagues.${column}`, note);
  return {
    regimeLeagueId: u('parent_league_id'),
    financials: u('rules_financials'),
    freeAgencyYears: u('rules_fa_minimum_years'),
    arbitrationYears: u('rules_salary_arbitration_minimum_years'),
    minorLeagueFreeAgencyYears: u('rules_minor_league_fa_minimum_years'),
    minimumSalary: u('rules_minimum_salary'),
    serviceDaysPerYear: u('rules_min_service_days'),
    financialCoefficient: u('financial_coefficient'),
    season: u('season_year'),
  };
}

function unavailable(reason: UnknownKind, note: string): LeagueRules {
  const u = <T>(column: string): Sourced<T> => unknownBecause<T>(reason, `leagues.${column}`, note);
  return {
    leagueId: u('league_id'), minorLeagueOptions: u('rules_minor_league_options'), ruleFiveDraft: u('rules_rule_5'),
    dfaPeriodDays: u('rules_dfa_period_length'), waiverPeriodDays: u('rules_waiver_period_length'),
    activeRosterLimit: u('rules_active_roster_limit'), expandedRosterLimit: u('rules_expanded_roster_limit'),
    rostersExpanded: u('rosters_expanded'), fortyManLimit: u('rules_secondary_roster_limit'),
    contract: unknownContract(reason, note),
  };
}

/** Reads one column of one row, keeping a missing column and a blank value apart. */
function reader(row: LeagueRuleRow, present: Set<string>, note?: string) {
  return <T>(column: Column, convert: (n: number) => T | null, invalid?: string): Sourced<T> => {
    const source = `leagues.${column}`;
    if (!present.has(column)) return unknownBecause<T>('not_exported_by_ootp', source, `leagues has no ${column} column.`);
    const n = numberOrNull(row[column]);
    if (n === null) return unknownBecause<T>('not_exported_by_ootp', source, `${column} is blank in the export.`);
    const value = convert(n);
    if (value === null) return unknownBecause<T>('not_exported_by_ootp', source, invalid ?? `${column} = ${n} is not a usable value.`);
    return note ? { ...fromExport(value, source), note } : fromExport(value, source);
  };
}

const asIs = (n: number): number => n;
const flag = (n: number): boolean => n === 1;
const nonNegative = (n: number): number | null => (n >= 0 ? n : null);
const positive = (n: number): number | null => (n > 0 ? n : null);

/** The deepest a parent chain is followed; a real export has two levels. Guards a cycle. */
const MAX_PARENT_DEPTH = 8;

/**
 * The row whose contract rules govern `row`'s league: its own when it has no
 * parent (0 or itself), otherwise the top of its parent chain. Null with a
 * reason when the chain cannot be followed.
 */
function regimeRow(
  row: LeagueRuleRow, present: Set<string>, lookup: LeagueRowLookup
): { row: LeagueRuleRow; viaParent: boolean } | { unknown: string } {
  if (!present.has('parent_league_id')) {
    return { unknown: 'leagues has no parent_league_id column, so whether this league\'s contract rules are its own or a parent league\'s cannot be established (a minor league exports zeros for them).' };
  }
  let at = row;
  const seen = new Set<number>();
  for (let depth = 0; depth <= MAX_PARENT_DEPTH; depth += 1) {
    const id = numberOrNull(at.league_id);
    const parent = numberOrNull(at.parent_league_id);
    if (parent === null) return { unknown: `parent_league_id is blank for league ${id ?? '?'}, so its contract regime cannot be established.` };
    if (parent === 0 || parent === id) return { row: at, viaParent: at !== row };
    if (id !== null) seen.add(id);
    if (seen.has(parent)) return { unknown: `The parent_league_id chain loops at league ${parent}.` };
    const next = lookup(parent);
    if (next === null) return { unknown: `League ${id ?? '?'} names parent league ${parent}, which has no leagues row.` };
    at = next;
  }
  return { unknown: 'The parent_league_id chain is deeper than any export has.' };
}

function contractRulesFrom(row: LeagueRuleRow, present: Set<string>, lookup: LeagueRowLookup): ContractRules {
  const regime = regimeRow(row, present, lookup);
  if ('unknown' in regime) return unknownContract('not_exported_by_ootp', regime.unknown);
  const regimeId = numberOrNull(regime.row.league_id);
  const note = regime.viaParent
    ? `Read from league ${regimeId}, the parent league whose contract rules a minor leaguer lives under; a minor league's own row exports zeros (R-2).`
    : undefined;
  const read = reader(regime.row, present, note);
  return {
    regimeLeagueId: regimeId === null
      ? unknownBecause('not_exported_by_ootp', 'leagues.league_id', 'The regime league has no league_id.')
      : note ? { ...fromExport(regimeId, 'leagues.parent_league_id'), note } : fromExport(regimeId, 'leagues.league_id'),
    financials: read('rules_financials', flag),
    freeAgencyYears: read('rules_fa_minimum_years', nonNegative),
    arbitrationYears: read('rules_salary_arbitration_minimum_years', nonNegative),
    minorLeagueFreeAgencyYears: read('rules_minor_league_fa_minimum_years', nonNegative),
    minimumSalary: read('rules_minimum_salary', nonNegative),
    serviceDaysPerYear: read('rules_min_service_days', positive, 'rules_min_service_days is not a positive number of days, so a service year has no length.'),
    financialCoefficient: read('financial_coefficient', positive),
    season: read('season_year', positive),
  };
}

/**
 * @param present the columns the `leagues` table actually has, or null when the
 *   table is missing; `row` is null when the club's league has no row.
 * @param lookup finds a parent league's row, for the contract regime.
 */
export function leagueRulesFromRow(
  row: LeagueRuleRow | null, present: Set<string> | null, lookup: LeagueRowLookup = noLookup
): LeagueRules {
  if (present === null) return unavailable('source_unavailable', 'leagues is not in the export.');
  if (row === null) return unavailable('not_exported_by_ootp', 'No leagues row for this club.');
  const read = reader(row, present);
  return {
    leagueId: read('league_id', asIs),
    minorLeagueOptions: read('rules_minor_league_options', flag),
    ruleFiveDraft: read('rules_rule_5', flag),
    dfaPeriodDays: read('rules_dfa_period_length', asIs),
    waiverPeriodDays: read('rules_waiver_period_length', asIs),
    activeRosterLimit: read('rules_active_roster_limit', asIs),
    expandedRosterLimit: read('rules_expanded_roster_limit', asIs),
    rostersExpanded: read('rosters_expanded', flag),
    fortyManLimit: read('rules_secondary_roster_limit', asIs),
    contract: contractRulesFrom(row, present, lookup),
  };
}

// ── readers ─────────────────────────────────────────────────────────────────

interface LeagueTable {
  present: Set<string> | null;
  rows: Map<number, LeagueRuleRow>;
}

/** Every league row, once: an export has a handful, and a parent chain needs them all. */
function readLeagues(): LeagueTable {
  if (!tableExists('leagues')) return { present: null, rows: new Map() };
  const present = new Set(tableColumns('leagues'));
  if (!present.has('league_id')) return { present, rows: new Map() };
  const selected = COLUMNS.filter((c) => present.has(c)).map((c) => `"${c}"`);
  const rows = db.prepare(`SELECT ${selected.join(', ')} FROM leagues`).all() as LeagueRuleRow[];
  const byId = new Map<number, LeagueRuleRow>();
  for (const row of rows) {
    const id = numberOrNull(row.league_id);
    if (id !== null) byId.set(id, row);
  }
  return { present, rows: byId };
}

function rulesIn(table: LeagueTable, leagueId: number): LeagueRules {
  if (table.present === null) return leagueRulesFromRow(null, null);
  const lookup: LeagueRowLookup = (id) => table.rows.get(id) ?? null;
  return leagueRulesFromRow(table.rows.get(leagueId) ?? null, table.present, lookup);
}

/** The rules of one league, its contract regime resolved through its parent chain. */
export function leagueRulesForLeague(leagueId: number): LeagueRules {
  return rulesIn(readLeagues(), leagueId);
}

/** The rules of every league in the export, keyed by league id; read once for a league-wide pass. */
export function allLeagueRules(): Map<number, LeagueRules> {
  const table = readLeagues();
  const out = new Map<number, LeagueRules>();
  for (const id of table.rows.keys()) out.set(id, rulesIn(table, id));
  return out;
}

/**
 * The rules of the league an organization's major-league club plays in. The
 * organization id is its major-league club's team id.
 */
export function leagueRulesForOrganization(orgId: number): LeagueRules {
  if (!tableExists('leagues') || !tableExists('teams')) return leagueRulesFromRow(null, null);
  const teamColumns = new Set(tableColumns('teams'));
  if (!teamColumns.has('team_id') || !teamColumns.has('league_id')) {
    return leagueRulesFromRow(null, new Set());
  }
  const table = readLeagues();
  if (table.present === null || !table.present.has('league_id')) return leagueRulesFromRow(null, table.present);
  const team = db.prepare(`SELECT league_id FROM teams WHERE team_id = ?`).get(orgId) as { league_id: unknown } | undefined;
  const leagueId = numberOrNull(team?.league_id);
  if (leagueId === null) return leagueRulesFromRow(null, table.present);
  return rulesIn(table, leagueId);
}
