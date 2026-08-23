/**
 * Read-only facts for a future Major League Operations workflow.
 *
 * This module deliberately stops before need detection, candidate evaluation,
 * or transaction simulation. It describes what the imported save establishes
 * and separately names what that snapshot cannot establish. That keeps a
 * future call-up surface from treating a roster count or options-used field as
 * proof that a transaction is legal.
 */

import { serviceRemainingThisSeason } from './contracts.js';
import { db, tableColumns, tableExists } from './db.js';
import { healthOf, standingOf, type Health, type Standing } from './health.js';
import { isOnFortyMan } from './valuation.js';

export type MajorLeagueOperationsGapCode =
  | 'organization_not_found'
  | 'missing_players_table'
  | 'missing_roster_status_table'
  | 'missing_roster_status_column'
  | 'missing_roster_status_row'
  | 'missing_player_health_column'
  | 'active_roster_limit_not_modeled'
  | 'secondary_roster_limit_not_modeled'
  | 'transaction_rules_not_modeled'
  | 'option_eligibility_not_derivable'
  | 'rule5_eligibility_not_derivable';

export interface MajorLeagueOperationsGap {
  code: MajorLeagueOperationsGapCode;
  message: string;
  playerId?: number;
}

export interface MajorLeagueRosterPlayerFacts {
  playerId: number;
  name: string;
  age: number | null;
  teamId: number | null;
  teamLevel: number | null;
  position: number | null;
  role: number | null;
  roster: {
    /** Null means the export did not provide enough status columns to know. */
    active: boolean | null;
    /** Secondary roster plus active/MLB-IL status, using the shared interpretation. */
    fortyMan: boolean | null;
    health: Health | null;
    standing: Standing | null;
  };
  serviceTime: {
    years: number | null;
    days: number | null;
    daysThisSeason: number | null;
  };
  /** Raw status facts, not a conclusion that a move is legal. */
  transactionStatus: {
    designatedForAssignment: boolean | null;
    daysOnDfaLeft: number | null;
    onWaivers: boolean | null;
    daysOnWaiversLeft: number | null;
    optionsUsed: number | null;
    yearsProtectedFromRule5: number | null;
    professionalServiceYears: number | null;
  };
}

export interface MajorLeagueRosterContext {
  organization: {
    orgId: number;
    label: string;
    leagueId: number | null;
  } | null;
  /** Facts directly represented by the imported snapshot. */
  known: {
    activeRosterCount: number | null;
    fortyManCount: number | null;
    players: MajorLeagueRosterPlayerFacts[];
    /** Uses the existing service-time calculation when its source column exists. */
    serviceTimeRemainingThisSeason: number | null;
  };
  /**
   * Transaction consequences intentionally remain separate from known facts.
   * These are limitations of the current model/export, not negative findings.
   */
  transactionUnknowns: MajorLeagueOperationsGap[];
  /** The new subsystem must not use continuous players_value fields as scouting evidence. */
  scoutingValuePolicy: 'prohibited_pending_provenance';
}

const POSITION_NAMES: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function selectColumn(columns: Set<string>, tableAlias: string, column: string): string {
  return columns.has(column) ? `${tableAlias}."${column}" AS "${column}"` : `NULL AS "${column}"`;
}

/**
 * Reads imported MLB roster context for one MLB organization. It makes no
 * recommendation and does not infer transaction legality from partial data.
 */
export function majorLeagueRosterContext(orgId: number): MajorLeagueRosterContext {
  const empty = (gaps: MajorLeagueOperationsGap[]): MajorLeagueRosterContext => ({
    organization: null,
    known: {
      activeRosterCount: null,
      fortyManCount: null,
      players: [],
      serviceTimeRemainingThisSeason: null,
    },
    transactionUnknowns: gaps,
    scoutingValuePolicy: 'prohibited_pending_provenance',
  });

  if (!tableExists('teams')) {
    return empty([{ code: 'organization_not_found', message: 'No team data is imported.' }]);
  }
  const team = db.prepare(
    `SELECT team_id, name, nickname, league_id, level FROM teams WHERE team_id = ? AND level = 1`
  ).get(orgId) as { team_id: number; name: string | null; nickname: string | null; league_id: number | null } | undefined;
  if (!team) {
    return empty([{ code: 'organization_not_found', message: 'The requested organization is not an imported MLB club.' }]);
  }

  const label = team.name === team.nickname || !team.nickname
    ? (team.name ?? `Organization ${orgId}`)
    : `${team.name ?? ''} ${team.nickname}`.trim();
  if (!tableExists('players')) {
    return {
      ...empty([{ code: 'missing_players_table', message: 'The export has no player table.' }]),
      organization: { orgId, label, leagueId: team.league_id },
    };
  }
  if (!tableExists('players_roster_status')) {
    return {
      ...empty([{ code: 'missing_roster_status_table', message: 'The export has no roster-status table.' }]),
      organization: { orgId, label, leagueId: team.league_id },
    };
  }

  const playerColumns = new Set(tableColumns('players'));
  const statusColumns = new Set(tableColumns('players_roster_status'));
  const requiredPlayerColumns = ['player_id', 'organization_id', 'retired'];
  const missingPlayer = requiredPlayerColumns.filter((column) => !playerColumns.has(column));
  if (missingPlayer.length) {
    return {
      ...empty([{ code: 'missing_players_table', message: `The player table lacks ${missingPlayer.join(', ')}.` }]),
      organization: { orgId, label, leagueId: team.league_id },
    };
  }
  if (!statusColumns.has('player_id')) {
    return {
      ...empty([{ code: 'missing_roster_status_column', message: 'The roster-status table lacks player_id.' }]),
      organization: { orgId, label, leagueId: team.league_id },
    };
  }

  const statusFields = [
    'is_active', 'is_on_secondary', 'is_on_dl', 'is_on_dl60',
    'designated_for_assignment', 'days_on_dfa_left', 'is_on_waivers', 'days_on_waivers_left',
    'options_used', 'years_protected_from_rule_5', 'pro_service_years',
    'mlb_service_years', 'mlb_service_days', 'mlb_service_days_this_year',
  ];
  const playerFields = ['player_id', 'first_name', 'last_name', 'age', 'team_id', 'position', 'role',
    'injury_is_injured', 'injury_dtd_injury', 'injury_left'];
  const rows = db.prepare(
    `SELECT rs.player_id AS roster_status_player_id,
            ${playerFields.map((column) => selectColumn(playerColumns, 'p', column)).join(', ')},
            ${statusFields.map((column) => selectColumn(statusColumns, 'rs', column)).join(', ')},
            t.level AS team_level
     FROM players p
     LEFT JOIN players_roster_status rs ON rs.player_id = p.player_id
     LEFT JOIN teams t ON t.team_id = p.team_id
     WHERE p.organization_id = ? AND p.retired = 0`
  ).all(orgId) as Array<Record<string, unknown>>;

  const gaps: MajorLeagueOperationsGap[] = [];
  const rosterFields = ['is_active', 'is_on_secondary', 'is_on_dl', 'is_on_dl60'];
  const missingRosterFields = rosterFields.filter((column) => !statusColumns.has(column));
  if (missingRosterFields.length) {
    gaps.push({
      code: 'missing_roster_status_column',
      message: `Roster membership is incomplete because players_roster_status lacks ${missingRosterFields.join(', ')}.`,
    });
  }
  const healthFields = ['injury_is_injured', 'injury_dtd_injury', 'injury_left'];
  const missingHealthFields = healthFields.filter((column) => !playerColumns.has(column));
  if (missingHealthFields.length) {
    gaps.push({
      code: 'missing_player_health_column',
      message: `Health status is incomplete because players lacks ${missingHealthFields.join(', ')}.`,
    });
  }

  const rosterKnown = missingRosterFields.length === 0;
  const healthKnown = rosterKnown && missingHealthFields.length === 0;
  const standingKnown = healthKnown && ['designated_for_assignment', 'days_on_dfa_left', 'is_on_waivers']
    .every((column) => statusColumns.has(column));
  const players = rows.map((row): MajorLeagueRosterPlayerFacts => {
    const hasStatus = numberOrNull(row.roster_status_player_id) !== null;
    const active = rosterKnown && hasStatus ? row.is_active === 1 : null;
    const fortyMan = rosterKnown && hasStatus
      ? isOnFortyMan(row as Parameters<typeof isOnFortyMan>[0], numberOrNull(row.team_level))
      : null;
    if (!hasStatus) {
      gaps.push({
        code: 'missing_roster_status_row',
        message: 'This player has no roster-status row, so roster and transaction status are unknown.',
        playerId: numberOrNull(row.player_id) ?? undefined,
      });
    }
    const health = healthKnown && hasStatus ? healthOf(row) : null;
    return {
      playerId: numberOrNull(row.player_id) ?? 0,
      name: [row.first_name, row.last_name].filter((part): part is string => typeof part === 'string' && part.length > 0).join(' '),
      age: numberOrNull(row.age),
      teamId: numberOrNull(row.team_id),
      teamLevel: numberOrNull(row.team_level),
      position: numberOrNull(row.position),
      role: numberOrNull(row.role),
      roster: {
        active,
        fortyMan,
        health,
        standing: standingKnown && hasStatus ? standingOf(row) : null,
      },
      serviceTime: {
        years: hasStatus ? numberOrNull(row.mlb_service_years) : null,
        days: hasStatus ? numberOrNull(row.mlb_service_days) : null,
        daysThisSeason: hasStatus ? numberOrNull(row.mlb_service_days_this_year) : null,
      },
      transactionStatus: {
        designatedForAssignment: hasStatus && statusColumns.has('designated_for_assignment') ? row.designated_for_assignment === 1 : null,
        daysOnDfaLeft: hasStatus ? numberOrNull(row.days_on_dfa_left) : null,
        onWaivers: hasStatus && statusColumns.has('is_on_waivers') ? row.is_on_waivers === 1 : null,
        daysOnWaiversLeft: hasStatus ? numberOrNull(row.days_on_waivers_left) : null,
        optionsUsed: hasStatus ? numberOrNull(row.options_used) : null,
        yearsProtectedFromRule5: hasStatus ? numberOrNull(row.years_protected_from_rule_5) : null,
        professionalServiceYears: hasStatus ? numberOrNull(row.pro_service_years) : null,
      },
    };
  });

  gaps.push(
    { code: 'active_roster_limit_not_modeled', message: 'The active-roster count is known when exported, but its league limit is not modeled here.' },
    { code: 'secondary_roster_limit_not_modeled', message: 'The secondary/40-man count is known when exported, but its league limit is not modeled here.' },
    { code: 'transaction_rules_not_modeled', message: 'Recall, option, waiver, DFA, injured-list, and Rule 5 transaction sequences are not evaluated by this read-only context.' },
    { code: 'option_eligibility_not_derivable', message: 'Options used is context only; it does not establish present option eligibility or a waiver requirement.' },
    { code: 'rule5_eligibility_not_derivable', message: 'Rule 5 protection years and professional service are context only; they do not establish a complete Rule 5 consequence.' },
  );

  return {
    organization: { orgId, label, leagueId: team.league_id },
    known: {
      // A player without a status row has unknown individual transaction
      // context, but cannot inflate these exported status counts.
      activeRosterCount: rosterKnown ? players.filter((player) => player.roster.active === true).length : null,
      fortyManCount: rosterKnown ? players.filter((player) => player.roster.fortyMan === true).length : null,
      players,
      serviceTimeRemainingThisSeason: statusColumns.has('mlb_service_days_this_year')
        ? serviceRemainingThisSeason()
        : null,
    },
    transactionUnknowns: gaps,
    scoutingValuePolicy: 'prohibited_pending_provenance',
  };
}

export { POSITION_NAMES };
