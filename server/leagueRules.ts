/**
 * The league rules OOTP exports, as current state.
 *
 * A rights evaluator must not hard-code MLB: the export says whether options
 * exist in this league, how long DFA and waiver periods run, and how large the
 * rosters may be. Each is read as exported (`explicit_export`); a missing table,
 * column, or blank is an unknown with its reason, never a default.
 */

import { db, tableColumns, tableExists } from './db.js';
import { fromExport, unknownBecause, type Sourced } from './provenance.js';

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
}

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The raw values `leagueRulesFromRow` reads; a test can supply them without a database. */
export type LeagueRuleRow = Partial<Record<
  | 'league_id' | 'rules_minor_league_options' | 'rules_rule_5' | 'rules_dfa_period_length'
  | 'rules_waiver_period_length' | 'rules_active_roster_limit' | 'rules_expanded_roster_limit'
  | 'rosters_expanded' | 'rules_secondary_roster_limit', unknown>>;

const COLUMNS = [
  'league_id', 'rules_minor_league_options', 'rules_rule_5', 'rules_dfa_period_length',
  'rules_waiver_period_length', 'rules_active_roster_limit', 'rules_expanded_roster_limit',
  'rosters_expanded', 'rules_secondary_roster_limit',
] as const;

function unavailable(reason: 'source_unavailable' | 'not_exported_by_ootp', note: string): LeagueRules {
  const u = <T>(column: string): Sourced<T> => unknownBecause<T>(reason, `leagues.${column}`, note);
  return {
    leagueId: u('league_id'), minorLeagueOptions: u('rules_minor_league_options'), ruleFiveDraft: u('rules_rule_5'),
    dfaPeriodDays: u('rules_dfa_period_length'), waiverPeriodDays: u('rules_waiver_period_length'),
    activeRosterLimit: u('rules_active_roster_limit'), expandedRosterLimit: u('rules_expanded_roster_limit'),
    rostersExpanded: u('rosters_expanded'), fortyManLimit: u('rules_secondary_roster_limit'),
  };
}

/**
 * @param present the columns the `leagues` table actually has, or null when the
 *   table is missing; `row` is null when the club's league has no row.
 */
export function leagueRulesFromRow(row: LeagueRuleRow | null, present: Set<string> | null): LeagueRules {
  if (present === null) return unavailable('source_unavailable', 'leagues is not in the export.');
  if (row === null) return unavailable('not_exported_by_ootp', 'No leagues row for this club.');
  const read = <T>(column: (typeof COLUMNS)[number], convert: (n: number) => T): Sourced<T> => {
    const source = `leagues.${column}`;
    if (!present.has(column)) return unknownBecause<T>('not_exported_by_ootp', source, `leagues has no ${column} column.`);
    const n = numberOrNull(row[column]);
    return n === null
      ? unknownBecause<T>('not_exported_by_ootp', source, `${column} is blank in the export.`)
      : fromExport(convert(n), source);
  };
  const asIs = (n: number): number => n;
  const flag = (n: number): boolean => n === 1;
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
  };
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
  const present = new Set(tableColumns('leagues'));
  if (!present.has('league_id')) return leagueRulesFromRow(null, present);
  const selected = COLUMNS.filter((c) => c !== 'league_id' && present.has(c)).map((c) => `l."${c}"`);
  const row = db
    .prepare(
      `SELECT l.league_id AS league_id${selected.length ? ', ' + selected.join(', ') : ''}
       FROM teams t JOIN leagues l ON l.league_id = t.league_id
       WHERE t.team_id = ?`
    )
    .get(orgId) as LeagueRuleRow | undefined;
  return leagueRulesFromRow(row ?? null, present);
}
