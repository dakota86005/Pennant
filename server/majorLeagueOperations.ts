/**
 * Read-only context for a future Major League Operations workflow.
 *
 * Major League Operations consumes the shared roster/transaction-state engine;
 * it does not reinterpret OOTP status fields or transaction rules itself.
 */

import { serviceRemainingThisSeason } from './contracts.js';
import { db, tableColumns, tableExists } from './db.js';
import {
  organizationRosterTransactionState,
  type PlayerRosterState,
  type RosterStateUnknown,
} from './rosterTransactionState.js';
import type { Health, Standing } from './health.js';

export type MajorLeagueOperationsGapCode = string;

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
  roster: { active: boolean | null; fortyMan: boolean | null; health: Health | null; standing: Standing | null };
  serviceTime: { years: number | null; days: number | null; daysThisSeason: number | null };
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
  organization: { orgId: number; label: string; leagueId: number | null } | null;
  known: {
    activeRosterCount: number | null;
    fortyManCount: number | null;
    players: MajorLeagueRosterPlayerFacts[];
    serviceTimeRemainingThisSeason: number | null;
  };
  transactionUnknowns: MajorLeagueOperationsGap[];
  scoutingValuePolicy: 'prohibited_pending_provenance';
}

const toFacts = (player: PlayerRosterState): MajorLeagueRosterPlayerFacts => ({
  playerId: player.playerId,
  name: player.name,
  age: player.age,
  teamId: player.teamId,
  teamLevel: player.teamLevel,
  position: player.position,
  role: player.role,
  roster: { active: player.activeMlb, fortyMan: player.fortyMan, health: player.health, standing: player.standing },
  serviceTime: {
    years: player.serviceTime.mlbYears,
    days: player.serviceTime.mlbDays,
    daysThisSeason: player.serviceTime.mlbDaysThisSeason,
  },
  transactionStatus: {
    designatedForAssignment: player.transaction.designatedForAssignment,
    daysOnDfaLeft: player.transaction.daysOnDfaLeft,
    onWaivers: player.transaction.onWaivers,
    daysOnWaiversLeft: player.transaction.daysOnWaiversLeft,
    optionsUsed: player.transaction.optionsUsed,
    yearsProtectedFromRule5: player.transaction.yearsProtectedFromRule5,
    professionalServiceYears: player.serviceTime.professionalYears,
  },
});

const toGap = (unknown: RosterStateUnknown): MajorLeagueOperationsGap => unknown;

/**
 * Context adapter retained for the Phase 1A boundary. New MLB features should
 * take action answers from rosterTransactionState rather than recreate rules.
 */
export function majorLeagueRosterContext(orgId: number): MajorLeagueRosterContext {
  const noContext = (gaps: MajorLeagueOperationsGap[]): MajorLeagueRosterContext => ({
    organization: null,
    known: { activeRosterCount: null, fortyManCount: null, players: [], serviceTimeRemainingThisSeason: null },
    transactionUnknowns: gaps,
    scoutingValuePolicy: 'prohibited_pending_provenance',
  });
  const teamColumns = new Set(tableColumns('teams'));
  if (!tableExists('teams') || !['team_id', 'level', 'name', 'nickname', 'league_id'].every((column) => teamColumns.has(column))) {
    return noContext([{ code: 'organization_not_found', message: 'The imported team data cannot resolve an MLB organization.' }]);
  }
  const team = db.prepare('SELECT name, nickname, league_id FROM teams WHERE team_id = ? AND level = 1').get(orgId) as
    | { name: string | null; nickname: string | null; league_id: number | null }
    | undefined;
  if (!team) return noContext([{ code: 'organization_not_found', message: 'The requested organization is not an imported MLB club.' }]);
  const label = team.name === team.nickname || !team.nickname ? (team.name ?? `Organization ${orgId}`) : `${team.name ?? ''} ${team.nickname}`.trim();
  const shared = organizationRosterTransactionState(orgId);
  const stateUnknowns = [...shared.unknowns, ...shared.capacity.unknowns].map(toGap);
  const playerUnknowns = shared.players.flatMap((player) => player.unknowns.map((unknown) => ({ ...toGap(unknown), playerId: player.playerId })));
  const hasServiceProgress = tableExists('players_roster_status') && tableColumns('players_roster_status').includes('mlb_service_days_this_year');
  return {
    organization: { orgId, label, leagueId: team.league_id },
    known: {
      activeRosterCount: shared.capacity.active.count,
      fortyManCount: shared.capacity.fortyMan.count,
      players: shared.players.map(toFacts),
      serviceTimeRemainingThisSeason: hasServiceProgress ? serviceRemainingThisSeason() : null,
    },
    transactionUnknowns: [
      ...stateUnknowns,
      ...playerUnknowns,
      ...(shared.capacity.active.limit === null
        ? [{ code: 'active_roster_limit_not_modeled', message: 'The active-roster count is known when exported, but its league limit is unavailable.' }]
        : []),
      ...(shared.capacity.fortyMan.limit === null
        ? [{ code: 'secondary_roster_limit_not_modeled', message: 'The secondary/40-man count is known when exported, but its league limit is unavailable.' }]
        : []),
      { code: 'transaction_rules_not_modeled', message: 'Recall, option, waiver, DFA, injured-list, and Rule 5 transaction sequences are evaluated only by the shared action engine; this context does not simulate them.' },
      { code: 'option_eligibility_not_derivable', message: 'Options used is context only; it does not establish present option eligibility or a waiver requirement.' },
      { code: 'rule5_eligibility_not_derivable', message: 'Rule 5 protection years and professional service are context only; they do not establish a complete Rule 5 consequence.' },
    ],
    scoutingValuePolicy: 'prohibited_pending_provenance',
  };
}
