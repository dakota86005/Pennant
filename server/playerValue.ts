/**
 * Player Value: the one public entry point (D-052, docs/PLAYER_VALUE.md).
 *
 * Phase 1 serves concerns 1 and 2: what each contract says, season by season, and the control
 * and cost path composed from it and from Player Rights' arbitration and free-agency eligibility.
 * Every consumer (Contracts, Payroll, the Trade Center, the player card, Free Agents) reads a
 * player's contract and control from here and computes no status, cost band or eligibility of its
 * own (`tests/playerValueBoundary.test.ts`).
 *
 * This module is the reader: it opens the contract tables (each column checked before it is read,
 * D-007), reads service and placement through Player State, the rules through the one
 * `LeagueRules` (a player's contract regime resolved through his league's parent), and asks Player
 * Rights for eligibility. It reads no rating, no `players_value`, no philosophy, no protection
 * tier and no defensibility, and writes nothing.
 *
 * Computed per request for the players asked about, or league-wide for every active player
 * (`leaguePlayerValues`). Phase 1 timed the league-wide pass on the imported save before choosing
 * how to cache it (PLAYER_VALUE.md Part 7).
 */

import { db, tableColumns, tableExists } from './db.js';
import type { SourceState } from './dataFreshness.js';
import { allLeagueRules, leagueRulesFromRow, type ContractRules } from './leagueRules.js';
import { evaluateContractControl, superTwoCutoffs } from './playerRights.js';
import { allPlayerStates, playerStates, seasonServiceClocks, serviceClassMembers, type PlayerState } from './playerState.js';
import { unknownBecause } from './provenance.js';
import { CONTROL_HORIZON_SEASONS } from './playerValueCalibration.js';
import {
  CLAUSE_COLUMNS, CONTRACT_COLUMNS, EXTENSION_COLUMNS, contractFactsOf,
  type ContractFacts, type ContractRow, type ContractTables,
} from './playerValueContract.js';
import { composeControlTimeline, type ControlTimeline } from './playerValueControl.js';

export type { ContractFacts, ContractSeason, ContractTerm } from './playerValueContract.js';
export type { ControlSeason, ControlStatus, ControlTimeline, CostBand } from './playerValueControl.js';

/** A player's value, as far as phase 1 builds it: concerns 1 and 2. */
export interface PlayerValuation {
  playerId: number;
  contract: ContractFacts;
  control: ControlTimeline;
}

export interface ValuationOptions {
  /**
   * How current the export is against the save (D-022). A stale export makes eligibility
   * indeterminate (D-023). Callers without a freshness reading leave it `unverified`, and the
   * answers say so.
   */
  currentState?: SourceState;
}

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function contractTables(): ContractTables {
  const contract = tableExists('players_contract') ? new Set(tableColumns('players_contract')) : null;
  const extension = tableExists('players_contract_extension') ? new Set(tableColumns('players_contract_extension')) : null;
  const populated = new Set<string>();
  const clauses = contract ? CLAUSE_COLUMNS.filter((c) => contract.has(c)) : [];
  if (clauses.length > 0) {
    const row = db
      .prepare(`SELECT ${clauses.map((c) => `MAX(CASE WHEN "${c}" <> 0 THEN 1 ELSE 0 END) AS "${c}"`).join(', ')} FROM players_contract`)
      .get() as Record<string, unknown>;
    for (const c of clauses) if (row[c] === 1) populated.add(c);
  }
  return { contract, extension, populated };
}

/** Rows keyed by player, for the ids asked about (or every row when `ids` is null). */
function rowsByPlayer(
  table: string, present: Set<string> | null, wanted: readonly string[], ids: number[] | null, where = ''
): Map<number, ContractRow> {
  const out = new Map<number, ContractRow>();
  if (!present?.has('player_id')) return out;
  const columns = wanted.filter((c) => present.has(c)).map((c) => `"${c}"`).join(', ');
  const read = (clause: string, params: unknown[]) => {
    for (const row of db.prepare(`SELECT ${columns} FROM "${table}" WHERE ${clause}`).all(...params) as ContractRow[]) {
      const id = numberOrNull(row.player_id);
      if (id !== null) out.set(id, row);
    }
  };
  const extra = where ? ` AND ${where}` : '';
  if (ids === null) {
    read(`1 = 1${extra}`, []);
  } else {
    for (let at = 0; at < ids.length; at += 500) {
      const chunk = ids.slice(at, at + 500);
      read(`player_id IN (${chunk.map(() => '?').join(',')})${extra}`, chunk);
    }
  }
  return out;
}

/** Which league each club plays in. */
function teamLeagues(): Map<number, number> {
  const out = new Map<number, number>();
  if (!tableExists('teams')) return out;
  const columns = new Set(tableColumns('teams'));
  if (!columns.has('team_id') || !columns.has('league_id')) return out;
  for (const r of db.prepare(`SELECT team_id, league_id FROM teams`).all() as Array<{ team_id: unknown; league_id: unknown }>) {
    const team = numberOrNull(r.team_id);
    const league = numberOrNull(r.league_id);
    if (team !== null && league !== null) out.set(team, league);
  }
  return out;
}

function valuate(states: PlayerState[], ids: number[] | null, options: ValuationOptions): Map<number, PlayerValuation> {
  const out = new Map<number, PlayerValuation>();
  if (states.length === 0) return out;
  const currentState = options.currentState ?? 'unverified';
  const tables = contractTables();
  const contracts = rowsByPlayer('players_contract', tables.contract, CONTRACT_COLUMNS, ids);
  const extensions = rowsByPlayer('players_contract_extension', tables.extension, EXTENSION_COLUMNS, ids,
    tables.extension?.has('years') ? '"years" > 0' : '');
  const rules = allLeagueRules();
  const leagues = teamLeagues();
  const clocks = seasonServiceClocks();
  // A player whose club or league the export does not name has no regime to read
  const noRules = leagueRulesFromRow(null, new Set()).contract;
  // The Super Two cutoff, once per contract regime for the whole pass: it ranks the league's class
  const superTwo = superTwoCutoffs(serviceClassMembers(), (id) => rules.get(id)?.contract ?? null, clocks);

  for (const state of states) {
    const teamId = state.teamId.value;
    const leagueId = teamId !== null ? leagues.get(teamId) ?? null : null;
    const regime: ContractRules = leagueId !== null
      ? rules.get(leagueId)?.contract ?? noRules
      : noRules;
    const regimeId = regime.regimeLeagueId.value;
    const contract = contractFactsOf(
      state.playerId, state.teamId, contracts.get(state.playerId) ?? null, extensions.get(state.playerId) ?? null, tables
    );
    const eligibility = contract.standing === 'unsigned' ? null : evaluateContractControl({
      state,
      rules: regime,
      serviceClock: regimeId !== null
        ? clocks(regimeId)
        : unknownBecause('not_exported_by_ootp', null, 'His league\'s contract regime is unknown, so its season clock is too.'),
      currentState,
      seasons: CONTROL_HORIZON_SEASONS,
      superTwo: regimeId !== null ? superTwo.get(regimeId) ?? null : null,
    });
    const control = composeControlTimeline({
      playerId: state.playerId,
      holder: state.organizationId,
      contract,
      eligibility,
      horizon: CONTROL_HORIZON_SEASONS,
    });
    out.set(state.playerId, { playerId: state.playerId, contract, control });
  }
  return out;
}

/** Contract facts and control for the players asked about, keyed by id; retired players are not valued. */
export function playerValues(playerIds: number[], options: ValuationOptions = {}): Map<number, PlayerValuation> {
  const unique = [...new Set(playerIds)];
  if (unique.length === 0) return new Map();
  return valuate([...playerStates(unique).values()], unique, options);
}

/** One player's contract facts and control, or null when the export has no such active player. */
export function playerValue(playerId: number, options: ValuationOptions = {}): PlayerValuation | null {
  return playerValues([playerId], options).get(playerId) ?? null;
}

/** Every active player in the league, once (PLAYER_VALUE.md Part 7). */
export function leaguePlayerValues(options: ValuationOptions = {}): Map<number, PlayerValuation> {
  return valuate(allPlayerStates(), null, options);
}
