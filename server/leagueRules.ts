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
 *   financial rules the regime's economy (Club Finances, D-052 phase 2), read
 *                   from the same regime row; a value whose meaning is not
 *                   established is shown as exported, never interpreted.
 */

import { db, tableColumns, tableExists } from './db.js';
import { fromExport, uninterpreted, unknownBecause, type Sourced, type Uninterpreted } from './provenance.js';

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

/**
 * The financial regime (Club Finances, PLAYER_VALUE.md Part 2.4), read from the same regime row as
 * the contract rules: a minor league exports zeros here too (R-2), and its clubs live under the
 * parent league's economy. A value whose meaning the export does not establish (R-2, R-11: the
 * luxury-tax figure, the luxury-sharing cap, the revenue-sharing figure, the eight-step salary
 * scale, `arbitration_offering`, `rules_fa_compensation`) is shown as exported and never
 * interpreted.
 */
export interface FinancialRules {
  regimeLeagueId: Sourced<number>;
  /** `leagues.rules_financials` — the same reading as `ContractRules.financials`. */
  financials: Sourced<boolean>;
  /** `leagues.rules_salary_cap`; R-2 reads 0 as no cap. */
  salaryCap: Sourced<number>;
  /** `leagues.rules_luxury_tax` — a rate or a threshold; which is not established. */
  luxuryTax: Uninterpreted<number>;
  /** `leagues.rules_luxury_sharing` — luxury-tax money is shared. */
  luxurySharing: Sourced<boolean>;
  /** `leagues.rules_luxury_sharing_cap` — meaning not established (140 on the imported save). */
  luxurySharingCap: Uninterpreted<number>;
  /** `leagues.rules_revenue_sharing` — revenue sharing is on. */
  revenueSharing: Sourced<boolean>;
  /** `leagues.rules_revenue_sharing_tax` — meaning not established (48 on the imported save). */
  revenueSharingTax: Uninterpreted<number>;
  /** `leagues.rules_minimum_salary` — the same reading as `ContractRules.minimumSalary`. */
  minimumSalary: Sourced<number>;
  /** `leagues.financial_coefficient` — the same reading as `ContractRules.financialCoefficient`. */
  financialCoefficient: Sourced<number>;
  /**
   * A reserve clause binds every player: `rules_fa_minimum_years` is 0, the export's way of saying
   * the league has no free agency (R-2). Unknown when the rule is.
   */
  reserveClause: Sourced<boolean>;
  /** `leagues.arbitration_offering` — a flag, a phase or an off-season state; not established. */
  arbitrationOffering: Uninterpreted<number>;
  /** `leagues.rules_owner_decides_budget` */
  ownerDecidesBudget: Sourced<boolean>;
  /** `leagues.rules_cash_maximum` — the most cash a trade may carry. */
  cashMaximum: Sourced<number>;
  /** `leagues.rules_average_national_media_contract` */
  averageNationalMediaContract: Sourced<number>;
  /** `leagues.rules_national_media_contract_fixed` */
  nationalMediaContractFixed: Sourced<boolean>;
  /** `leagues.rules_fa_compensation` — not established. */
  freeAgentCompensation: Uninterpreted<number>;
  /** `leagues.rules_player_salary0..7` — an eight-step salary scale; what each step is tied to is not established. */
  playerSalaryScale: Array<Uninterpreted<number>>;
}

export interface LeagueRules {
  leagueId: Sourced<number>;
  /** `leagues.rules_schedule_games_per_team` — the league's own schedule length. */
  gamesPerTeam: Sourced<number>;
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
  /** The financial regime, resolved through `parent_league_id` like the contract rules. */
  finance: FinancialRules;
}

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const ROSTER_COLUMNS = [
  'league_id', 'rules_minor_league_options', 'rules_rule_5', 'rules_dfa_period_length',
  'rules_waiver_period_length', 'rules_active_roster_limit', 'rules_expanded_roster_limit',
  'rosters_expanded', 'rules_secondary_roster_limit', 'rules_schedule_games_per_team',
] as const;

const SALARY_SCALE_COLUMNS = [
  'rules_player_salary0', 'rules_player_salary1', 'rules_player_salary2', 'rules_player_salary3',
  'rules_player_salary4', 'rules_player_salary5', 'rules_player_salary6', 'rules_player_salary7',
] as const;

const FINANCE_COLUMNS = [
  'rules_salary_cap', 'rules_luxury_tax', 'rules_luxury_sharing', 'rules_luxury_sharing_cap',
  'rules_revenue_sharing', 'rules_revenue_sharing_tax', 'arbitration_offering', 'rules_owner_decides_budget',
  'rules_cash_maximum', 'rules_average_national_media_contract', 'rules_national_media_contract_fixed',
  'rules_fa_compensation', ...SALARY_SCALE_COLUMNS,
] as const;

const CONTRACT_COLUMNS = [
  'parent_league_id', 'rules_financials', 'rules_fa_minimum_years', 'rules_salary_arbitration_minimum_years',
  'rules_minor_league_fa_minimum_years', 'rules_minimum_salary', 'rules_min_service_days', 'financial_coefficient',
  'season_year',
] as const;

const COLUMNS = [...ROSTER_COLUMNS, ...CONTRACT_COLUMNS, ...FINANCE_COLUMNS] as const;
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

const MEANING_NOT_ESTABLISHED = 'Shown as exported: what this value means is not established (PLAYER_VALUE_RESEARCH.md R-2, R-11).';

function unknownFinance(reason: UnknownKind, note: string): FinancialRules {
  const u = <T>(column: string): Sourced<T> => unknownBecause<T>(reason, `leagues.${column}`, note);
  const raw = (column: string): Uninterpreted<number> => uninterpreted(u<number>(column), MEANING_NOT_ESTABLISHED);
  return {
    regimeLeagueId: u('parent_league_id'), financials: u('rules_financials'), salaryCap: u('rules_salary_cap'),
    luxuryTax: raw('rules_luxury_tax'), luxurySharing: u('rules_luxury_sharing'), luxurySharingCap: raw('rules_luxury_sharing_cap'),
    revenueSharing: u('rules_revenue_sharing'), revenueSharingTax: raw('rules_revenue_sharing_tax'),
    minimumSalary: u('rules_minimum_salary'), financialCoefficient: u('financial_coefficient'),
    reserveClause: u('rules_fa_minimum_years'), arbitrationOffering: raw('arbitration_offering'),
    ownerDecidesBudget: u('rules_owner_decides_budget'), cashMaximum: u('rules_cash_maximum'),
    averageNationalMediaContract: u('rules_average_national_media_contract'),
    nationalMediaContractFixed: u('rules_national_media_contract_fixed'),
    freeAgentCompensation: raw('rules_fa_compensation'),
    playerSalaryScale: SALARY_SCALE_COLUMNS.map(raw),
  };
}

function unavailable(reason: UnknownKind, note: string): LeagueRules {
  const u = <T>(column: string): Sourced<T> => unknownBecause<T>(reason, `leagues.${column}`, note);
  return {
    leagueId: u('league_id'), gamesPerTeam: u('rules_schedule_games_per_team'),
    minorLeagueOptions: u('rules_minor_league_options'), ruleFiveDraft: u('rules_rule_5'),
    dfaPeriodDays: u('rules_dfa_period_length'), waiverPeriodDays: u('rules_waiver_period_length'),
    activeRosterLimit: u('rules_active_roster_limit'), expandedRosterLimit: u('rules_expanded_roster_limit'),
    rostersExpanded: u('rosters_expanded'), fortyManLimit: u('rules_secondary_roster_limit'),
    contract: unknownContract(reason, note),
    finance: unknownFinance(reason, note),
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

function regimeRulesFrom(
  row: LeagueRuleRow, present: Set<string>, lookup: LeagueRowLookup
): { contract: ContractRules; finance: FinancialRules } {
  const regime = regimeRow(row, present, lookup);
  if ('unknown' in regime) {
    return {
      contract: unknownContract('not_exported_by_ootp', regime.unknown),
      finance: unknownFinance('not_exported_by_ootp', regime.unknown),
    };
  }
  const regimeId = numberOrNull(regime.row.league_id);
  const note = regime.viaParent
    ? `Read from league ${regimeId}, the parent league whose contract rules a minor leaguer lives under; a minor league's own row exports zeros (R-2).`
    : undefined;
  const read = reader(regime.row, present, note);
  const raw = (column: Column): Uninterpreted<number> => uninterpreted(read(column, asIs), MEANING_NOT_ESTABLISHED);
  const regimeLeagueId: Sourced<number> = regimeId === null
    ? unknownBecause('not_exported_by_ootp', 'leagues.league_id', 'The regime league has no league_id.')
    : note ? { ...fromExport(regimeId, 'leagues.parent_league_id'), note } : fromExport(regimeId, 'leagues.league_id');
  const financials = read('rules_financials', flag);
  const freeAgencyYears = read('rules_fa_minimum_years', nonNegative);
  const minimumSalary = read('rules_minimum_salary', nonNegative);
  const financialCoefficient = read('financial_coefficient', positive);
  const salaryCap = read('rules_salary_cap', nonNegative);
  if (salaryCap.value === 0) salaryCap.note = [salaryCap.note, 'A cap of 0 is read as no salary cap (R-2).'].filter(Boolean).join(' ');
  return {
    contract: {
      regimeLeagueId,
      financials,
      freeAgencyYears,
      arbitrationYears: read('rules_salary_arbitration_minimum_years', nonNegative),
      minorLeagueFreeAgencyYears: read('rules_minor_league_fa_minimum_years', nonNegative),
      minimumSalary,
      serviceDaysPerYear: read('rules_min_service_days', positive, 'rules_min_service_days is not a positive number of days, so a service year has no length.'),
      financialCoefficient,
      season: read('season_year', positive),
    },
    finance: {
      regimeLeagueId,
      financials,
      salaryCap,
      luxuryTax: raw('rules_luxury_tax'),
      luxurySharing: read('rules_luxury_sharing', flag),
      luxurySharingCap: raw('rules_luxury_sharing_cap'),
      revenueSharing: read('rules_revenue_sharing', flag),
      revenueSharingTax: raw('rules_revenue_sharing_tax'),
      minimumSalary,
      financialCoefficient,
      reserveClause: freeAgencyYears.value === null
        ? { ...freeAgencyYears, value: null }
        : { ...freeAgencyYears, value: freeAgencyYears.value === 0 },
      arbitrationOffering: raw('arbitration_offering'),
      ownerDecidesBudget: read('rules_owner_decides_budget', flag),
      cashMaximum: read('rules_cash_maximum', nonNegative),
      averageNationalMediaContract: read('rules_average_national_media_contract', nonNegative),
      nationalMediaContractFixed: read('rules_national_media_contract_fixed', flag),
      freeAgentCompensation: raw('rules_fa_compensation'),
      playerSalaryScale: SALARY_SCALE_COLUMNS.map(raw),
    },
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
  const regime = regimeRulesFrom(row, present, lookup);
  return {
    leagueId: read('league_id', asIs),
    gamesPerTeam: read('rules_schedule_games_per_team', positive),
    minorLeagueOptions: read('rules_minor_league_options', flag),
    ruleFiveDraft: read('rules_rule_5', flag),
    dfaPeriodDays: read('rules_dfa_period_length', asIs),
    waiverPeriodDays: read('rules_waiver_period_length', asIs),
    activeRosterLimit: read('rules_active_roster_limit', asIs),
    expandedRosterLimit: read('rules_expanded_roster_limit', asIs),
    rostersExpanded: read('rosters_expanded', flag),
    fortyManLimit: read('rules_secondary_roster_limit', asIs),
    contract: regime.contract,
    finance: regime.finance,
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
