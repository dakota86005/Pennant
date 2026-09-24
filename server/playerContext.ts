/**
 * Puts the three concerns side by side for a player without merging them:
 * current state from the export, chronology from the live log, and the
 * assignment context that reads one against the other.
 */

import { assignmentContextFor, type AssignmentContext } from './assignmentContext.js';
import { currentTransactionLog, getDataStatus, logAvailability, type DataStatus } from './dataStatus.js';
import { allLeagueRules, leagueRulesForOrganization, type LeagueRules } from './leagueRules.js';
import {
  evaluatePlayerRights, rosterCounts, superTwoCutoffs,
  type PlayerRights, type RightsEvidence, type RosterCounts, type SuperTwoCutoff,
} from './playerRights.js';
import {
  organizationPlayerStates, playerState, playerStates, seasonServiceCalendars, seasonServiceClocks, serviceClassMembers,
  type PlayerState, type ServiceCalendar,
} from './playerState.js';
import { unknownBecause, type Sourced } from './provenance.js';
import type { TransactionEvent } from './transactionLog.js';

export interface PlayerPicture {
  state: PlayerState;
  assignment: AssignmentContext | null;
  /** The player's explicit log history, newest first. Empty when the log is unavailable. */
  chronology: TransactionEvent[];
  /** Why chronology is empty or partial, in plain terms. */
  chronologyNote: string | null;
  freshness: DataStatus['freshness'];
  /** What he can and cannot be done with, given the state and chronology above. */
  rights: PlayerRights;
}

/** How current each source is, in the terms rights evaluation needs. */
export function rightsEvidence(status: DataStatus): RightsEvidence {
  return { currentState: status.freshness.csv.state, chronology: status.freshness.log.state };
}

interface OrganizationRightsInputs {
  league: LeagueRules;
  counts: RosterCounts;
  /** The season's service clock in the league whose contract rules apply. */
  serviceClock: Sourced<number>;
}

/** The service clock for a league's contract regime, or unknown when the regime is. */
function clockFor(league: LeagueRules, clocks: (leagueId: number) => Sourced<number>): Sourced<number> {
  const regime = league.contract.regimeLeagueId.value;
  return regime === null
    ? unknownBecause('not_exported_by_ootp', null, 'The league\'s contract regime is unknown, so its season clock is too.')
    : clocks(regime);
}

/** The schedule's calendar for a league's contract regime, or unknown when the regime is. */
function calendarFor(league: LeagueRules, calendars: (leagueId: number) => Sourced<ServiceCalendar>): Sourced<ServiceCalendar> {
  const regime = league.contract.regimeLeagueId.value;
  return regime === null
    ? unknownBecause('not_exported_by_ootp', null, 'The league\'s contract regime is unknown, so its schedule is too.')
    : calendars(regime);
}

/** The Super Two cutoff per contract regime, ranked once from the whole class, for one request. */
function superTwoLookup(
  clocks: (leagueId: number) => Sourced<number>, calendars: (leagueId: number) => Sourced<ServiceCalendar>
): (league: LeagueRules) => SuperTwoCutoff | null {
  const rules = allLeagueRules();
  const cutoffs = superTwoCutoffs(serviceClassMembers(), (id) => rules.get(id)?.contract ?? null, clocks, calendars);
  return (league) => {
    const regime = league.contract.regimeLeagueId.value;
    return regime === null ? null : cutoffs.get(regime) ?? null;
  };
}

/** League rules and roster counts for one organization; computed once per batch. */
function organizationInputs(
  orgId: number, cache: Map<number, OrganizationRightsInputs>, clocks: (leagueId: number) => Sourced<number>
): OrganizationRightsInputs {
  let inputs = cache.get(orgId);
  if (!inputs) {
    const league = leagueRulesForOrganization(orgId);
    inputs = { league, counts: rosterCounts(organizationPlayerStates(orgId)), serviceClock: clockFor(league, clocks) };
    cache.set(orgId, inputs);
  }
  return inputs;
}

/**
 * Rights for a batch of players, keyed by id, with the assignment context each
 * was evaluated against. Reads only through the state, chronology and league
 * rule modules.
 */
export function rightsFor(
  playerIds: number[],
  status: DataStatus = getDataStatus()
): Map<number, { assignment: AssignmentContext | null; rights: PlayerRights }> {
  const out = new Map<number, { assignment: AssignmentContext | null; rights: PlayerRights }>();
  if (playerIds.length === 0) return out;
  const { log } = currentTransactionLog();
  const availability = logAvailability(status);
  const evidence = rightsEvidence(status);
  const orgs = new Map<number, OrganizationRightsInputs>();
  const clocks = seasonServiceClocks();
  const calendars = seasonServiceCalendars();
  const superTwoFor = superTwoLookup(clocks, calendars);
  const noLeague = leagueRulesForOrganization(-1);
  const noOrg: OrganizationRightsInputs = { league: noLeague, counts: { active: null, fortyMan: null }, serviceClock: clockFor(noLeague, clocks) };
  for (const [id, state] of playerStates(playerIds)) {
    const events = log ? (log.byPlayer.get(id) ?? []) : null;
    const assignment = assignmentContextFor(state, events, availability);
    const orgId = state.organizationId.value;
    const inputs = orgId === null ? noOrg : organizationInputs(orgId, orgs, clocks);
    out.set(id, {
      assignment,
      rights: evaluatePlayerRights({
        state, assignment, league: inputs.league, counts: inputs.counts, evidence, serviceClock: inputs.serviceClock,
        serviceCalendar: calendarFor(inputs.league, calendars),
        superTwo: superTwoFor(inputs.league),
      }),
    });
  }
  return out;
}

/** Assignment contexts for a batch of players, keyed by id. Players with nothing notable are omitted. */
export function assignmentContextsFor(playerIds: number[], status: DataStatus = getDataStatus()): Map<number, AssignmentContext> {
  const out = new Map<number, AssignmentContext>();
  if (playerIds.length === 0) return out;
  const { log } = currentTransactionLog();
  const availability = logAvailability(status);
  for (const [id, state] of playerStates(playerIds)) {
    const events = log ? (log.byPlayer.get(id) ?? []) : null;
    const context = assignmentContextFor(state, events, availability);
    if (context) out.set(id, context);
  }
  return out;
}

export function playerPicture(playerId: number, chronologyLimit = 25): PlayerPicture | null {
  const state = playerState(playerId);
  if (!state) return null;
  const status = getDataStatus();
  const { log } = currentTransactionLog();
  const events = log ? (log.byPlayer.get(playerId) ?? []) : null;
  const chronologyNote = !log
    ? 'The OOTP transaction log is unavailable, so no transaction history is shown.'
    : status.freshness.log.state === 'behind'
      ? `The transaction log is ${status.freshness.log.lagDays} day(s) behind the save; recent moves may be missing.`
      : null;
  const assignment = assignmentContextFor(state, events, logAvailability(status));
  const orgId = state.organizationId.value;
  const league = leagueRulesForOrganization(orgId ?? -1);
  const counts = orgId === null ? { active: null, fortyMan: null } : rosterCounts(organizationPlayerStates(orgId));
  return {
    state,
    assignment,
    chronology: events ? [...events].reverse().slice(0, chronologyLimit) : [],
    chronologyNote,
    freshness: status.freshness,
    rights: evaluatePlayerRights({
      state, assignment, league, counts, evidence: rightsEvidence(status),
      serviceClock: clockFor(league, seasonServiceClocks()),
      serviceCalendar: calendarFor(league, seasonServiceCalendars()),
      superTwo: superTwoLookup(seasonServiceClocks(), seasonServiceCalendars())(league),
    }),
  };
}
