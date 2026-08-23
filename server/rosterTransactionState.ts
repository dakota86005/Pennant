/**
 * Shared, read-only roster and transaction-state rules.
 *
 * This is the single place that normalizes OOTP roster-status fields for MLB,
 * minor-league, and 40-man consumers. It evaluates only current-state rules;
 * it does not choose players, recommend moves, or mutate a save.
 */

import { db, tableColumns, tableExists } from './db.js';
import { healthOf, standingOf, type Health, type Standing } from './health.js';
import { isOnFortyMan } from './valuation.js';

export type RosterRuleResult = 'eligible' | 'ineligible' | 'indeterminate';

export type RosterRequirementKind =
  | 'active_roster_move'
  | 'forty_man_addition'
  | 'forty_man_roster_move'
  | 'waiver_clearance';

export interface RosterRequirement {
  kind: RosterRequirementKind;
  status: 'required' | 'not_required' | 'indeterminate';
  reason: string;
}

export interface RosterRuleEvaluation {
  action: 'recall' | 'option' | 'forty_man_addition';
  result: RosterRuleResult;
  reasons: string[];
  requirements: RosterRequirement[];
}

/**
 * What the exported number of used option years can establish. A count below
 * three is intentionally not treated as permission to option a player: the
 * export does not provide every condition needed for that conclusion.
 */
export function optionYearState(optionsUsed: number | null): 'out_of_options' | 'last_known_option_year' | 'indeterminate' {
  if (optionsUsed === null) return 'indeterminate';
  if (optionsUsed >= 3) return 'out_of_options';
  if (optionsUsed === 2) return 'last_known_option_year';
  return 'indeterminate';
}

export interface RosterStateUnknown {
  code: string;
  message: string;
}

export interface PlayerRosterState {
  playerId: number;
  name: string;
  age: number | null;
  organizationId: number | null;
  teamId: number | null;
  teamLevel: number | null;
  position: number | null;
  role: number | null;
  activeMlb: boolean | null;
  fortyMan: boolean | null;
  health: Health | null;
  injury: {
    /** Objective current injury fields from the player export, separate from IL flags. */
    injured: boolean | null;
    dayToDay: boolean | null;
    daysLeft: number | null;
  };
  standing: Standing | null;
  majorLeagueContract: boolean | null;
  serviceTime: {
    mlbYears: number | null;
    mlbDays: number | null;
    mlbDaysThisSeason: number | null;
    professionalYears: number | null;
    professionalDays: number | null;
  };
  transaction: {
    onIl: boolean | null;
    onIl60: boolean | null;
    designatedForAssignment: boolean | null;
    onWaivers: boolean | null;
    daysOnWaiversLeft: number | null;
    daysOnDfaLeft: number | null;
    optionsUsed: number | null;
    optionsUsedThisYear: number | null;
    yearsProtectedFromRule5: number | null;
    wasTraded: boolean | null;
  };
  unknowns: RosterStateUnknown[];
}

export interface RosterCapacity {
  active: { count: number | null; limit: number | null; openSlots: number | null };
  fortyMan: { count: number | null; limit: number | null; openSlots: number | null };
  unknowns: RosterStateUnknown[];
}

export interface OrganizationRosterTransactionState {
  organizationId: number;
  leagueId: number | null;
  players: PlayerRosterState[];
  capacity: RosterCapacity;
  unknowns: RosterStateUnknown[];
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const selectColumn = (columns: Set<string>, alias: string, column: string): string =>
  columns.has(column) ? `${alias}."${column}" AS "${column}"` : `NULL AS "${column}"`;

const basePlayerColumns = [
  'player_id', 'first_name', 'last_name', 'age', 'organization_id', 'team_id', 'position', 'role', 'retired',
  'injury_is_injured', 'injury_dtd_injury', 'injury_left',
];
const statusColumnsWanted = [
  'is_active', 'is_on_secondary', 'is_on_dl', 'is_on_dl60',
  'designated_for_assignment', 'days_on_dfa_left', 'is_on_waivers', 'days_on_waivers_left',
  'options_used', 'options_used_this_year', 'years_protected_from_rule_5',
  'mlb_service_years', 'mlb_service_days', 'mlb_service_days_this_year',
  'pro_service_years', 'pro_service_days', 'was_traded',
];

function stateFromRow(
  row: Record<string, unknown>,
  playerColumns: Set<string>,
  statusColumns: Set<string>,
  contractByPlayer: Map<number, boolean> | null
): PlayerRosterState {
  const unknowns: RosterStateUnknown[] = [];
  const hasStatus = numberOrNull(row.roster_status_player_id) !== null;
  const rosterFields = ['is_active', 'is_on_secondary', 'is_on_dl', 'is_on_dl60'];
  const rosterKnown = hasStatus && rosterFields.every((field) => statusColumns.has(field));
  const healthFields = ['injury_is_injured', 'injury_dtd_injury', 'injury_left'];
  const healthKnown = rosterKnown && healthFields.every((field) => playerColumns.has(field));
  const standingKnown = healthKnown && ['designated_for_assignment', 'days_on_dfa_left', 'is_on_waivers']
    .every((field) => statusColumns.has(field));
  if (!hasStatus) unknowns.push({ code: 'missing_roster_status_row', message: 'No roster-status row is exported for this player.' });
  const missingRoster = rosterFields.filter((field) => !statusColumns.has(field));
  if (missingRoster.length) unknowns.push({ code: 'missing_roster_status_columns', message: `Missing roster-status columns: ${missingRoster.join(', ')}.` });
  const optionalTransactionFields = ['options_used', 'options_used_this_year', 'years_protected_from_rule_5', 'days_on_waivers_left', 'was_traded'];
  const missingTransaction = optionalTransactionFields.filter((field) => !statusColumns.has(field));
  if (missingTransaction.length) unknowns.push({ code: 'missing_transaction_status_columns', message: `Missing transaction-status columns: ${missingTransaction.join(', ')}.` });
  const serviceFields = ['mlb_service_years', 'mlb_service_days', 'mlb_service_days_this_year', 'pro_service_years', 'pro_service_days'];
  const missingService = serviceFields.filter((field) => !statusColumns.has(field));
  if (missingService.length) unknowns.push({ code: 'missing_service_time_columns', message: `Missing service-time columns: ${missingService.join(', ')}.` });
  if (contractByPlayer === null) unknowns.push({ code: 'missing_major_contract_source', message: 'Major-league contract status is not available from the import.' });
  const activeMlb = rosterKnown ? row.is_active === 1 : null;
  const fortyMan = rosterKnown
    ? isOnFortyMan(row as Parameters<typeof isOnFortyMan>[0], numberOrNull(row.team_level))
    : null;
  const id = numberOrNull(row.player_id) ?? 0;
  return {
    playerId: id,
    name: [row.first_name, row.last_name].filter((part): part is string => typeof part === 'string' && part.length > 0).join(' '),
    age: numberOrNull(row.age),
    organizationId: numberOrNull(row.organization_id),
    teamId: numberOrNull(row.team_id),
    teamLevel: numberOrNull(row.team_level),
    position: numberOrNull(row.position),
    role: numberOrNull(row.role),
    activeMlb,
    fortyMan,
    health: healthKnown ? healthOf(row) : null,
    injury: {
      injured: playerColumns.has('injury_is_injured') ? row.injury_is_injured === 1 : null,
      dayToDay: playerColumns.has('injury_dtd_injury') ? row.injury_dtd_injury === 1 : null,
      daysLeft: playerColumns.has('injury_left') ? numberOrNull(row.injury_left) : null,
    },
    standing: standingKnown ? standingOf(row) : null,
    majorLeagueContract: contractByPlayer === null ? null : (contractByPlayer.get(id) ?? false),
    serviceTime: {
      mlbYears: hasStatus ? numberOrNull(row.mlb_service_years) : null,
      mlbDays: hasStatus ? numberOrNull(row.mlb_service_days) : null,
      mlbDaysThisSeason: hasStatus ? numberOrNull(row.mlb_service_days_this_year) : null,
      professionalYears: hasStatus ? numberOrNull(row.pro_service_years) : null,
      professionalDays: hasStatus ? numberOrNull(row.pro_service_days) : null,
    },
    transaction: {
      onIl: hasStatus && statusColumns.has('is_on_dl') ? row.is_on_dl === 1 : null,
      onIl60: hasStatus && statusColumns.has('is_on_dl60') ? row.is_on_dl60 === 1 : null,
      designatedForAssignment: hasStatus && statusColumns.has('designated_for_assignment') ? row.designated_for_assignment === 1 : null,
      onWaivers: hasStatus && statusColumns.has('is_on_waivers') ? row.is_on_waivers === 1 : null,
      daysOnWaiversLeft: hasStatus ? numberOrNull(row.days_on_waivers_left) : null,
      daysOnDfaLeft: hasStatus ? numberOrNull(row.days_on_dfa_left) : null,
      optionsUsed: hasStatus ? numberOrNull(row.options_used) : null,
      optionsUsedThisYear: hasStatus ? numberOrNull(row.options_used_this_year) : null,
      yearsProtectedFromRule5: hasStatus ? numberOrNull(row.years_protected_from_rule_5) : null,
      wasTraded: hasStatus && statusColumns.has('was_traded') ? row.was_traded === 1 : null,
    },
    unknowns,
  };
}

function majorLeagueContracts(): Map<number, boolean> | null {
  if (!tableExists('players_contract')) return null;
  const cols = new Set(tableColumns('players_contract'));
  if (!cols.has('player_id') || !cols.has('is_major')) return null;
  return new Map((db.prepare('SELECT player_id, is_major FROM players_contract').all() as Array<{ player_id: number; is_major: number | null }>)
    .map((row) => [row.player_id, row.is_major === 1]));
}

function rowsFor(
  where?: string,
  value?: number,
  tolerateMissingRosterStatus = false
): { rows: Array<Record<string, unknown>>; unknowns: RosterStateUnknown[] } {
  const unknowns: RosterStateUnknown[] = [];
  if (!tableExists('players')) return { rows: [], unknowns: [{ code: 'missing_players_table', message: 'No players table is imported.' }] };
  if (!tableExists('players_roster_status') && !tolerateMissingRosterStatus) {
    return { rows: [], unknowns: [{ code: 'missing_roster_status_table', message: 'No roster-status table is imported.' }] };
  }
  const playerColumns = new Set(tableColumns('players'));
  const statusColumns = tableExists('players_roster_status') ? new Set(tableColumns('players_roster_status')) : new Set<string>();
  if (!tableExists('players_roster_status')) {
    unknowns.push({ code: 'missing_roster_status_table', message: 'No roster-status table is imported.' });
  }
  const requiredPlayerColumns = ['player_id', 'retired', ...(where ? [where] : [])];
  if (!requiredPlayerColumns.every((column) => playerColumns.has(column))) {
    return { rows: [], unknowns: [{ code: 'missing_player_column', message: `The players table cannot resolve ${where ?? 'the roster state'}.` }] };
  }
  const canJoinStatus = statusColumns.has('player_id');
  const teamColumns = new Set(tableColumns('teams'));
  const canJoinTeams = tableExists('teams') && teamColumns.has('team_id') && teamColumns.has('level');
  if (!canJoinStatus) unknowns.push({ code: 'missing_roster_status_player_id', message: 'Roster-status rows cannot be matched to players.' });
  if (!canJoinTeams) unknowns.push({ code: 'missing_team_level', message: 'Current team level is unavailable.' });
  const rows = db.prepare(
    `SELECT ${canJoinStatus ? 'rs.player_id' : 'NULL'} AS roster_status_player_id,
            ${basePlayerColumns.map((column) => selectColumn(playerColumns, 'p', column)).join(', ')},
            ${statusColumnsWanted.map((column) => canJoinStatus ? selectColumn(statusColumns, 'rs', column) : `NULL AS "${column}"`).join(', ')},
            ${canJoinTeams ? 't.level' : 'NULL'} AS team_level
     FROM players p
     ${canJoinStatus ? 'LEFT JOIN players_roster_status rs ON rs.player_id = p.player_id' : ''}
     ${canJoinTeams ? 'LEFT JOIN teams t ON t.team_id = p.team_id' : ''}
     WHERE p.retired = 0${where ? ` AND p."${where}" = ?` : ''}`
  ).all(...(where ? [value] : [])) as Array<Record<string, unknown>>;
  return { rows, unknowns };
}

/** Read one normalized player state without exposing raw OOTP flags to callers. */
export function playerRosterState(playerId: number): PlayerRosterState | null {
  const { rows } = rowsFor('player_id', playerId);
  if (rows.length === 0) return null;
  const playerColumns = new Set(tableColumns('players'));
  const statusColumns = new Set(tableColumns('players_roster_status'));
  const contracts = majorLeagueContracts();
  return stateFromRow(rows[0], playerColumns, statusColumns, contracts);
}

/**
 * Read normalized roster state for every non-retired player. This is a shared
 * snapshot source, not an organization-specific MLB operation: it deliberately
 * keeps players when optional roster-status tables are absent so their unknown
 * state is preserved rather than silently dropping them from history.
 */
export function allRosterTransactionStates(): { players: PlayerRosterState[]; unknowns: RosterStateUnknown[] } {
  const { rows, unknowns } = rowsFor(undefined, undefined, true);
  const playerColumns = new Set(tableColumns('players'));
  const statusColumns = tableExists('players_roster_status') ? new Set(tableColumns('players_roster_status')) : new Set<string>();
  const contracts = majorLeagueContracts();
  return {
    players: rows.map((row) => stateFromRow(row, playerColumns, statusColumns, contracts)),
    unknowns,
  };
}

/** Read every player in an organization plus its imported roster capacities. */
export function organizationRosterTransactionState(orgId: number): OrganizationRosterTransactionState {
  const { rows, unknowns } = rowsFor('organization_id', orgId);
  const playerColumns = new Set(tableColumns('players'));
  const statusColumns = new Set(tableColumns('players_roster_status'));
  const contracts = majorLeagueContracts();
  const players = rows.map((row) => stateFromRow(row, playerColumns, statusColumns, contracts));
  const teamColumns = new Set(tableColumns('teams'));
  const canReadMlbTeam = tableExists('teams') && ['team_id', 'level', 'league_id'].every((column) => teamColumns.has(column));
  const team = canReadMlbTeam
    ? db.prepare('SELECT league_id FROM teams WHERE team_id = ? AND level = 1').get(orgId) as { league_id: number | null } | undefined
    : undefined;
  const capacityUnknowns: RosterStateUnknown[] = [];
  let activeLimit: number | null = null;
  let fortyLimit: number | null = null;
  if (!canReadMlbTeam) {
    capacityUnknowns.push({ code: 'missing_team_columns', message: 'Team level or league affiliation is unavailable.' });
  } else if (!team) {
    capacityUnknowns.push({ code: 'organization_not_mlb', message: 'The requested organization is not an imported MLB club.' });
  } else if (!tableExists('leagues')) {
    capacityUnknowns.push({ code: 'missing_leagues_table', message: 'No league rules table is imported.' });
  } else {
    const leagueColumns = new Set(tableColumns('leagues'));
    const activeKnown = leagueColumns.has('rules_active_roster_limit');
    const fortyKnown = leagueColumns.has('rules_secondary_roster_limit');
    const missing = [
      ...(activeKnown ? [] : ['rules_active_roster_limit']),
      ...(fortyKnown ? [] : ['rules_secondary_roster_limit']),
    ];
    if (missing.length) capacityUnknowns.push({ code: 'missing_roster_limit_columns', message: `League roster limits are unavailable: ${missing.join(', ')}.` });
    if (activeKnown || fortyKnown) {
      const rules = db.prepare(
        `SELECT ${activeKnown ? 'rules_active_roster_limit' : 'NULL AS rules_active_roster_limit'},
                ${fortyKnown ? 'rules_secondary_roster_limit' : 'NULL AS rules_secondary_roster_limit'}
         FROM leagues WHERE league_id = ?`
      ).get(team.league_id) as { rules_active_roster_limit: number | null; rules_secondary_roster_limit: number | null } | undefined;
      activeLimit = numberOrNull(rules?.rules_active_roster_limit);
      fortyLimit = numberOrNull(rules?.rules_secondary_roster_limit);
    }
  }
  const activeCount = statusColumns.has('is_active') ? players.filter((player) => player.activeMlb === true).length : null;
  const fortyCount = ['is_active', 'is_on_secondary', 'is_on_dl', 'is_on_dl60'].every((field) => statusColumns.has(field))
    ? players.filter((player) => player.fortyMan === true).length
    : null;
  const slots = (limit: number | null, count: number | null): number | null =>
    limit === null || count === null ? null : Math.max(0, limit - count);
  return {
    organizationId: orgId,
    leagueId: team?.league_id ?? null,
    players,
    capacity: {
      active: { count: activeCount, limit: activeLimit, openSlots: slots(activeLimit, activeCount) },
      fortyMan: { count: fortyCount, limit: fortyLimit, openSlots: slots(fortyLimit, fortyCount) },
      unknowns: capacityUnknowns,
    },
    unknowns,
  };
}

function capacityRequirement(kind: 'active_roster_move' | 'forty_man_roster_move', capacity: { count: number | null; limit: number | null; openSlots: number | null }): RosterRequirement {
  if (capacity.count === null || capacity.limit === null || capacity.openSlots === null) {
    return { kind, status: 'indeterminate', reason: 'The imported league roster limit or current count is unavailable.' };
  }
  return capacity.openSlots > 0
    ? { kind, status: 'not_required', reason: `There are ${capacity.openSlots} open roster slot${capacity.openSlots === 1 ? '' : 's'}.` }
    : { kind, status: 'required', reason: 'The roster is at its imported limit.' };
}

function outsideOrganization(state: PlayerRosterState | null, orgId: number): RosterRuleEvaluation | null {
  if (!state) return { action: 'recall', result: 'ineligible', reasons: ['The player is not present in the imported save.'], requirements: [] };
  if (state.organizationId !== orgId) return { action: 'recall', result: 'ineligible', reasons: ['The player is not in this organization.'], requirements: [] };
  return null;
}

/** Deterministically evaluate the limited roster actions needed by the call-up vertical slice. */
export function evaluateRosterAction(
  orgId: number,
  playerId: number,
  action: RosterRuleEvaluation['action']
): RosterRuleEvaluation {
  const state = playerRosterState(playerId);
  const outside = outsideOrganization(state, orgId);
  if (outside) return { ...outside, action };
  const player = state!;
  const organization = organizationRosterTransactionState(orgId);
  const blocked = player.transaction.designatedForAssignment === true || player.transaction.onWaivers === true;
  if (action === 'forty_man_addition') {
    if (player.fortyMan === true) return { action, result: 'ineligible', reasons: ['The player is already on the 40-man roster.'], requirements: [] };
    if (player.fortyMan === null) return { action, result: 'indeterminate', reasons: ['The player’s 40-man status is unavailable.'], requirements: [] };
    if (blocked) return { action, result: 'ineligible', reasons: ['The player is currently on DFA or waivers.'], requirements: [] };
    const clearance = capacityRequirement('forty_man_roster_move', organization.capacity.fortyMan);
    return { action, result: clearance.status === 'indeterminate' ? 'indeterminate' : 'eligible', reasons: ['The player is not on the 40-man roster.'], requirements: [clearance] };
  }
  if (action === 'option') {
    if (player.activeMlb === false) return { action, result: 'ineligible', reasons: ['The player is not on the active MLB roster.'], requirements: [] };
    if (player.activeMlb === null) return { action, result: 'indeterminate', reasons: ['Active MLB roster status is unavailable.'], requirements: [] };
    if (blocked || player.transaction.onIl === true || player.transaction.onIl60 === true) {
      return { action, result: 'ineligible', reasons: ['The player’s current DFA, waiver, or injured-list status prevents a standard option evaluation.'], requirements: [] };
    }
    if (player.transaction.optionsUsed === null) {
      return { action, result: 'indeterminate', reasons: ['No options-used value is exported.'], requirements: [] };
    }
    if (optionYearState(player.transaction.optionsUsed) === 'out_of_options') {
      return {
        action,
        result: 'ineligible',
        reasons: ['The existing roster convention treats three used option years as out of options.'],
        requirements: [{ kind: 'waiver_clearance', status: 'required', reason: 'A standard option is unavailable; any demotion requires separate waiver handling.' }],
      };
    }
    return { action, result: 'indeterminate', reasons: [`${player.transaction.optionsUsed} option year${player.transaction.optionsUsed === 1 ? '' : 's'} used is not enough to prove current option eligibility.`], requirements: [] };
  }
  if (player.activeMlb === true) return { action, result: 'ineligible', reasons: ['The player is already on the active MLB roster.'], requirements: [] };
  if (player.activeMlb === null || player.teamLevel === null) return { action, result: 'indeterminate', reasons: ['Current active-roster or assignment information is unavailable.'], requirements: [] };
  if (player.teamLevel === 1 || player.transaction.onIl === true || player.transaction.onIl60 === true || blocked) {
    return { action, result: 'ineligible', reasons: ['The player’s current MLB, injured-list, DFA, or waiver state prevents a standard recall.'], requirements: [] };
  }
  const requirements: RosterRequirement[] = [capacityRequirement('active_roster_move', organization.capacity.active)];
  if (player.fortyMan === false) {
    requirements.push({ kind: 'forty_man_addition', status: 'required', reason: 'The player is not currently on the 40-man roster.' });
    requirements.push(capacityRequirement('forty_man_roster_move', organization.capacity.fortyMan));
  } else if (player.fortyMan === null) {
    return { action, result: 'indeterminate', reasons: ['The player’s 40-man status is unavailable.'], requirements };
  }
  return {
    action,
    result: requirements.some((requirement) => requirement.status === 'indeterminate') ? 'indeterminate' : 'eligible',
    reasons: ['The player is in this organization, assigned below MLB, and has no known immediate status block.'],
    requirements,
  };
}
