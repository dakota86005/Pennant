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
 *
 * Phase 3a adds concern 3, expected production from major-league results (`production` on every
 * valuation; `playerValueProduction.ts`). Calibration belongs to the save (D-053): the model in force
 * is the save's own adopted fit from the fit store, else the provisional fallback prior, and
 * `refitProductionIfNeeded` refits it after an import that brings a newer completed season. This module
 * reads the history for it (`playerValueHistory.ts`) and injury proneness only through its reader.
 *
 * Phase 3b adds ability: ratings arrive only through `scoutedEvidence.ts` (D-017), read here and handed
 * to the pure ratings projection (`playerValueRatings.ts`) as evidence; the ratings model (mapping,
 * arrivals, development) is fitted per save (`playerValueRatingsFit.ts`, `refitRatingsIfNeeded`) and
 * stored beside the results fit. Nothing here reads a rating column, `players_value` or minor-league WAR.
 */

import { Worker } from 'node:worker_threads';
import { db, tableColumns, tableExists } from './db.js';
import { parseGameDate, type SourceState } from './dataFreshness.js';
import { allLeagueRules, leagueRulesFromRow, type ContractRules, type FinancialRules, type LeagueRules } from './leagueRules.js';
import { arbitrationRegimeOf, evaluateContractControl, superTwoCutoffs } from './playerRights.js';
import {
  allPlayerStates, organizationPlayerStates, playerStates, seasonServiceCalendars, seasonServiceClocks, serviceClassMembers,
  type PlayerState,
} from './playerState.js';
import { CONTROL_HORIZON_SEASONS, OPENING_PRICE_MINIMUMS, PRODUCTION_NO_EVIDENCE, SIGNINGS_POLICY } from './playerValueCalibration.js';
import {
  contractBreaks, contractImports, contractPair, contractSnapshotAt, contractStoreVersion, storedPairAnyMethod, type ContractSnapshotInput,
} from './playerValueContractStore.js';
import {
  adoptPrice, awardReadings, contractTimeline, freeAcquisitions, measurePriceOfWin, measureReplacement, observeChanges, priceReserveSeasons, reserveRenewals, scoreAwards,
  type AwardReading, type AwardScore, type ContractSnapshot, type ContractSnapshotRow, type MeasuredPrice, type PairContext, type ReplacementReading,
  type ReserveRenewalSpread, type Timeline, type WinterPair,
} from './playerValueSignings.js';
import {
  CLAUSE_COLUMNS, CONTRACT_COLUMNS, EXTENSION_COLUMNS, contractFactsOf,
  type ContractFacts, type ContractRow, type ContractTables,
} from './playerValueContract.js';
import { composeControlTimeline, type ControlTimeline } from './playerValueControl.js';
import { measureCostLadder, priceControlTimeline, type CostLadder } from './playerValueCost.js';
import { productionCone, type ProductionCone } from './playerValueCone.js';
import {
  FINANCE_COLUMNS, clubFinancesOf, openingPriceOfWin, replacementLevelOf, scheduleShareOf,
  type ClubFinances, type FinanceTable, type MarketCandidate, type PriceOfWin, type ReplacementLevel,
  type SeasonRecord, type SeasonWar,
} from './playerValueFinances.js';
import { derivedFrom, unknownBecause, type Sourced } from './provenance.js';
import type { CalibrationStamp } from './calibration.js';
import { readInjuryProneness } from './injuryProneness.js';
import {
  PRODUCTION_METHOD, PRODUCTION_POLICY, PRODUCTION_PRIOR, PRODUCTION_PRIOR_CALIBRATION, PRODUCTION_PRIOR_SOURCE, RATINGS_METHOD,
  RATINGS_PRIOR, RATINGS_PRIOR_CALIBRATION,
} from './playerValueCalibration.js';
import {
  adoptedProductionFit, clearFitStoreCaches, latestProductionFitAttempt, productionFitAttempted, recordProductionFit, saveIdentity, type StoredFit,
} from './playerValueFitStore.js';
import {
  affiliatedLevels, ageFacts, firstLeagueSeason, hasSeasonLines, injuredThisSeason, injuryDurationSentinels, inSeasonContinuation,
  leagueClubs, leagueGameDate, leagueParentsNamed, leagueRateFacts, leagueRecord, leagueSeasons, listedFacts, majorLeagueLines, minorLeagueUsage,
  platoonExposure, scheduledGames, seasonCalendar, seasonPlayedOf, seasonSchedules, seasonShareOn, seasonSpans, type LevelSeason, type SeasonCalendar,
} from './playerValueHistory.js';
import {
  PRODUCTION_UNIT, adaptPriorToLeague, planSides, projectProductionWith, windowOf,
  type InSeasonFacts, type LeagueRateFacts, type ModelProvenance, type PlayerProduction, type ProductionKind, type ProductionModel,
  type ProductionSide, type ScheduleFacts,
} from './playerValueProduction.js';
import { NOT_YET_CALIBRATED, ageOn, fitProductionModel, fitSeasonsNote, type FitHistory, type FitPlayer, type FitRecord, type FitRun } from './playerValueProductionFit.js';
import {
  projectWithRatings, ratingsEvidence,
  type RatingsEvidence, type RatingsModel, type RatingsModelInForce, type RatingsProductionInput,
} from './playerValueRatings.js';
import {
  fitRatingsModel, snapshotPairCount,
  type ArrivalPlayer, type ForwardSeason, type MappingCase, type Observation, type RatingsFitInput, type RatingsFitRecord, type RatingsFitRun,
} from './playerValueRatingsFit.js';
import {
  loadScoutedAbilities, loadScoutedGlovesAtPosition, loadScoutedHitterProfiles, loadScoutedObservations,
} from './scoutedEvidence.js';

export type { ContractFacts, ContractSeason, ContractTerm } from './playerValueContract.js';
export { contractSeasonFor } from './playerValueContract.js';
/** Service as years.days for the pages: Player Rights' arithmetic, so no consumer divides by the year itself. */
export { serviceReading } from './playerRights.js';
export type { ControlSeason, ControlStatus, ControlTimeline, CostBand, CostBasis } from './playerValueControl.js';
export type { ArbitrationLadder, CombinedCost, CostLadder, CostReading, LadderClass, ProjectedCost, RenewalSpread } from './playerValueCost.js';
/** Owner decision 2 (2026-09-24): how Payroll combines its players' projected seasons (players as independent). */
export { combineProjectedCosts } from './playerValueCost.js';
export type {
  AwardReading, AwardScore, ContractSnapshot, ContractSnapshotRow, MeasuredBasis, MeasuredCheck, MeasuredPrice, ObservedChange, ObservedKind,
  ReplacementReading, ReserveRenewalSpread, Timeline, WinterPair,
} from './playerValueSignings.js';
export type {
  ClubFinanceInput, ClubFinances, FinanceSeason, FinanceTable, MarketCandidate, MarketStanding, OpeningPriceInput, OpeningSampling,
  PriceAdoption, PriceBand, PriceBasis, PriceOfWin, PricePopulation, ReplacementLevel, ReplacementLevelInput, SeasonRecord, SeasonWar,
} from './playerValueFinances.js';
export { clubFinancesOf, marketStandingOf, openingPriceOfWin, replacementLevelOf } from './playerValueFinances.js';
export type {
  BandTails, HorizonModel, InjuryFacts, KindModel, ModelProvenance, PlayerProduction, ProductionBasis, ProductionInput,
  ProductionKind, ProductionLine, ProductionModel, ProductionSeason, ProductionSide, SideBasis, SideSeason, WinsBand,
} from './playerValueProduction.js';
export type { CoverageRow, FitHistory, FitPlayer, FitRecord, FitRun, FitSeason } from './playerValueProductionFit.js';
export type { AbilityBasis, AbilityPrior, ArrivalBasis, BlendBasis } from './playerValueProduction.js';
export type {
  ArrivalCell, ArrivalModel, DevelopmentModel, RatingsEvidence, RatingsModel, RatingsModelInForce, RatingsProductionInput,
} from './playerValueRatings.js';
export type { Observation, RatingsFitInput, RatingsFitRecord, RatingsFitRun } from './playerValueRatingsFit.js';
export type { ConeBand, ConeControl, ConeControlStatus, ConeCoverage, ConeSeason, ConeUnestablished, ProductionCone } from './playerValueCone.js';
export { productionCone } from './playerValueCone.js';
export { PRODUCTION_UNIT } from './playerValueProduction.js';
export { fitProductionModel } from './playerValueProductionFit.js';
export { ratingsEvidence } from './playerValueRatings.js';
export { arrivalAdoption, fitRatingsModel } from './playerValueRatingsFit.js';
export type { ArrivalAdoption, ArrivalHorizonAdoption } from './playerValueRatingsFit.js';
export { productionTotal } from './playerValueProduction.js';
export type { ProductionTotal, UnestablishedSeason } from './playerValueProduction.js';
export { PRODUCTION_NO_EVIDENCE };

/** A player's value, as far as phase 3 builds it: concerns 1, 2 and 3 (production from major-league results and scouted ratings). */
export interface PlayerValuation {
  playerId: number;
  contract: ContractFacts;
  control: ControlTimeline;
  /** Expected production in wins per season, with its basis; `unknown` with the reason where it cannot be stated. */
  production: PlayerProduction;
}

export interface ValuationOptions {
  /**
   * How current the export is against the save (D-022). A stale export makes eligibility
   * indeterminate (D-023). Callers without a freshness reading leave it `unverified`, and the
   * answers say so.
   */
  currentState?: SourceState;
  /** Compute production (default true). The market's own valuation of its population leaves it out. */
  production?: boolean;
  /**
   * Price the controlled seasons with the league's cost ladder (phase 4a). By default only where production is
   * computed (review R1-13): a reading without production could price renewals but not an arbitration season, a
   * second, different cost for the same seasons that no consumer shows, so it prices none and each season keeps
   * "not priced in this reading". The market's own valuation, from which the ladder is measured, leaves it out.
   */
  costs?: boolean;
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

type Valued = Omit<PlayerValuation, 'production'> & { production?: PlayerProduction };

function valuate(states: PlayerState[], ids: number[] | null, options: ValuationOptions): Map<number, PlayerValuation> {
  const out = new Map<number, Valued>();
  if (states.length === 0) return new Map();
  const currentState = options.currentState ?? 'unverified';
  const tables = contractTables();
  const contracts = rowsByPlayer('players_contract', tables.contract, CONTRACT_COLUMNS, ids);
  const extensions = rowsByPlayer('players_contract_extension', tables.extension, EXTENSION_COLUMNS, ids,
    tables.extension?.has('years') ? '"years" > 0' : '');
  const rules = allLeagueRules();
  const leagues = teamLeagues();
  const clocks = seasonServiceClocks();
  const calendars = seasonServiceCalendars();
  // A player whose club or league the export does not name has no regime to read
  const noRules = leagueRulesFromRow(null, new Set()).contract;
  // The Super Two cutoff, once per contract regime for the whole pass: it ranks the league's class
  const superTwo = superTwoCutoffs(serviceClassMembers(), (id) => rules.get(id)?.contract ?? null, clocks, calendars);

  const regimeOfPlayer = new Map<number, number | null>();
  for (const state of states) {
    const teamId = state.teamId.value;
    const leagueId = teamId !== null ? leagues.get(teamId) ?? null : null;
    const regime: ContractRules = leagueId !== null
      ? rules.get(leagueId)?.contract ?? noRules
      : noRules;
    const regimeId = regime.regimeLeagueId.value;
    regimeOfPlayer.set(state.playerId, regimeId);
    const contract = contractFactsOf(
      state.playerId, state.teamId, contracts.get(state.playerId) ?? null, extensions.get(state.playerId) ?? null, tables
    );
    const eligibility = contract.standing === 'unsigned' ? null : evaluateContractControl({
      state,
      rules: regime,
      serviceClock: regimeId !== null
        ? clocks(regimeId)
        : unknownBecause('not_exported_by_ootp', null, 'His league\'s contract regime is unknown, so its season clock is too.'),
      serviceCalendar: regimeId !== null
        ? calendars(regimeId)
        : unknownBecause('not_exported_by_ootp', null, 'His league\'s contract regime is unknown, so its schedule is too.'),
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
      majorLeagueClub: state.level.value === null ? null : state.level.value === 1,
    });
    out.set(state.playerId, { playerId: state.playerId, contract, control });
  }
  if (options.production !== false) {
    const productions = productionsOf(states, ids, rules, leagues);
    for (const v of out.values()) v.production = productions.get(v.playerId);
  }
  // Phase 4a: the controlled seasons no contract covers, priced from the league's cost ladder
  if (options.costs ?? options.production !== false) {
    for (const v of out.values()) {
      const regimeId = regimeOfPlayer.get(v.playerId) ?? null;
      if (v.control.standing !== 'held' || v.control.seasons.length === 0) continue;
      const ctx = regimeId !== null ? costContextOf(regimeId, currentState) : null;
      v.control = priceControlTimeline({
        control: v.control,
        production: v.production ?? null,
        ladder: ctx?.ladder ?? null,
        pastWins: (season) => ctx?.pastWins(v.playerId, season) ?? null,
      });
      // Phase 4b: a reserve-clause season, from the renewals observed across imports
      v.control = priceReserveSeasons(v.control, ctx?.reserve ?? null);
    }
  }
  return out as Map<number, PlayerValuation>;
}

// ── the cost ladder in force (phase 4a) ──────────────────────────────────────

interface CostContext {
  ladder: CostLadder;
  /** Reserve-clause renewals observed across imports (phase 4b). */
  reserve: ReserveRenewalSpread;
  /** A player's WAR in a past season of the market league, on its schedule's footing (0 with no line), or null. */
  pastWins: (playerId: number, season: number) => number | null;
}

/** Measured once per import and market league (cleared with the production caches): the ladder is this import's. */
const costContexts = new Map<string, CostContext>();

function costContextOf(regimeLeagueId: number, currentState: SourceState): CostContext {
  // The recorded contracts' version too: an import's contract snapshot (phase 4b) changes the measured price and the observed renewals
  const key = `${regimeLeagueId}:${currentState}:${contractStoreVersion()}`;
  let c = costContexts.get(key);
  if (!c) {
    const market = leagueMarket(regimeLeagueId, { currentState });
    c = {
      ladder: market.finances.costs,
      reserve: market.finances.observed.reserveClause,
      pastWins: (playerId, season) => {
        const war = market.war.get(season);
        const share = market.shares.get(season)?.value ?? null;
        if (!war || share === null || !(share >= OPENING_PRICE_MINIMUMS.seasonShare)) return null;
        return (war.byPlayer.get(playerId) ?? 0) / share;
      },
    };
    costContexts.set(key, c);
  }
  return c;
}

/**
 * The player card's production cone: his expected production joined with his control timeline, season by
 * season, from this season to the end of control within the production horizon (`playerValueCone.ts`).
 * Null when the export has no such active player.
 */
export function playerProductionCone(playerId: number, options: ValuationOptions = {}): ProductionCone | null {
  const value = playerValue(playerId, options);
  return value ? productionCone(value.production, value.control) : null;
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

/**
 * Payroll's players (A-14): every player the organization holds, and every player the export names this
 * club as carrying the contract of (`players_contract.contract_team_id`) though he is now elsewhere, with
 * their contract facts and control. Production is computed (phase 4a): an arbitration season is priced on
 * its platform seasons' production, the same answer every consumer gets. The club of record is not verified
 * against payroll: whether it still pays is the contract's `retained`, read by the consumer as stated.
 */
export function payrollValuations(orgId: number, options: ValuationOptions = {}): Map<number, PlayerValuation> {
  const ids = new Set(organizationPlayerStates(orgId).map((st) => st.playerId));
  const columns = tableExists('players_contract') ? new Set(tableColumns('players_contract')) : new Set<string>();
  if (columns.has('player_id') && columns.has('contract_team_id')) {
    for (const r of db.prepare(`SELECT player_id FROM players_contract WHERE contract_team_id = ?`).all(orgId) as Array<{ player_id: unknown }>) {
      const id = numberOrNull(r.player_id);
      if (id !== null) ids.add(id);
    }
  }
  const unique = [...ids];
  if (unique.length === 0) return new Map();
  return valuate([...playerStates(unique).values()], unique, options);
}

/** Every active player in the league, once (PLAYER_VALUE.md Part 7). */
export function leaguePlayerValues(options: ValuationOptions = {}): Map<number, PlayerValuation> {
  return valuate(allPlayerStates(), null, options);
}

// ── Club Finances (concern 4, phase 2) ───────────────────────────────────────

/** The league's financial reality: its regime, the opening price of a win and the replacement level. */
export interface LeagueFinances {
  /** The league the market is read in: the regime league of the one asked about. */
  leagueId: number;
  season: Sourced<number>;
  regime: FinancialRules;
  gamesPerTeam: Sourced<number>;
  /** The share of this season played: team games played over clubs × games per team. */
  seasonPlayed: Sourced<number>;
  priceOfWin: PriceOfWin;
  /** Measured per season: two seasons back, last season and this season to date. */
  replacementLevel: ReplacementLevel[];
  /** OOTP's `team_financials.player_payroll`, summed over the league's clubs. */
  leaguePayroll: Sourced<number>;
  /** The cost ladder (phase 4a): the renewal spread and the arbitration ladder, measured on this import. */
  costs: CostLadder;
  /** What the save's imports observed across winters (phase 4b): signings, the measured price, awards, renewals, replacement. */
  observed: ObservedMarket;
}

/** The market observed across the save's imports (phase 4b, PLAYER_VALUE.md 4.2 to 4.4). */
export interface ObservedMarket {
  /** The imports this save has recorded for the league, oldest first. */
  imports: Array<{ gameDate: string; season: number | null; rows: number }>;
  /** The save's timeline (review R3-05): imports superseded when the save went back, and why pairs are not formed across a change. */
  timeline: { text: string | null; superseded: string[] };
  /**
   * Owner decision 4 (2026-09-24): which imports keep their full contract snapshot, how many were pruned, and how many pairs
   * are read as stored under an earlier method because a snapshot of theirs was pruned.
   */
  retention: { kept: number; pruned: number; olderMethod: number; text: string };
  /** Each pair of consecutive imports of the timeline and what changed between them. */
  pairs: WinterPair[];
  measured: MeasuredPrice;
  /** Observed arbitration salaries scored against the ladder, and read as class lines once enough are seen. */
  awards: AwardScore & { readings: AwardReading[]; readingsText: string };
  reserveClause: ReserveRenewalSpread;
  replacement: ReplacementReading;
}

/** The club's league's rules, or an unknown set when the export does not place the club. */
function rulesOfClub(teamId: number, rules: Map<number, LeagueRules>): LeagueRules {
  const leagueId = teamLeagues().get(teamId) ?? null;
  return (leagueId !== null ? rules.get(leagueId) : undefined) ?? leagueRulesFromRow(null, new Set());
}

/** A club's rows, and the table's columns, from one of the financial tables (only the columns it has). */
function financeRows(table: string, teamId: number): { present: Set<string> | null; rows: Array<Record<string, unknown>> } {
  if (!tableExists(table)) return { present: null, rows: [] };
  const present = new Set(tableColumns(table));
  if (!present.has('team_id')) return { present, rows: [] };
  const columns = FINANCE_COLUMNS.filter((c) => present.has(c)).map((c) => `"${c}"`).join(', ');
  return { present, rows: db.prepare(`SELECT ${columns} FROM "${table}" WHERE team_id = ?`).all(teamId) as Array<Record<string, unknown>> };
}

const single = (t: { present: Set<string> | null; rows: Array<Record<string, unknown>> }): FinanceTable =>
  ({ present: t.present, row: t.rows[0] ?? null });

function clubFinancesWith(teamId: number, rules: Map<number, LeagueRules>): ClubFinances {
  const league = rulesOfClub(teamId, rules);
  return clubFinancesOf({
    teamId,
    season: league.contract.season.value,
    financials: league.finance.financials,
    current: single(financeRows('team_financials', teamId)),
    last: single(financeRows('team_last_financials', teamId)),
    history: financeRows('team_history_financials', teamId),
  });
}

/** One club's finances, each figure with its source (Part 2.4). The organization id is its major-league club's. */
export function clubFinances(teamId: number): ClubFinances {
  return clubFinancesWith(teamId, allLeagueRules());
}

const WAR_TABLES = ['players_career_batting_stats', 'players_career_pitching_stats'] as const;
const WAR_COLUMNS = ['player_id', 'year', 'team_id', 'league_id', 'split_id', 'war'] as const;

/**
 * The league's WAR for the seasons asked about, from the export's own tables (R-4): batting plus
 * pitching, the overall split (the only one that carries WAR), the league's own rows, summed over
 * clubs. Both tables must carry every column, or the WAR is not read at all: one side of the ledger
 * is not the league's WAR.
 */
function leagueWar(leagueId: number, seasons: number[]): { bySeason: Map<number, SeasonWar>; unavailable: string | null } {
  const bySeason = new Map<number, SeasonWar>();
  for (const table of WAR_TABLES) {
    if (!tableExists(table)) return { bySeason, unavailable: `${table} is not in the export, so the league's WAR cannot be read.` };
    const present = new Set(tableColumns(table));
    const lacking = WAR_COLUMNS.filter((c) => !present.has(c));
    if (lacking.length > 0) return { bySeason, unavailable: `${table} has no ${lacking.join(', ')} column, so the league's WAR cannot be read.` };
  }
  const years = seasons.map(() => '?').join(', ');
  const part = (table: string) =>
    `SELECT player_id, year, team_id, war FROM ${table} WHERE league_id = ? AND split_id = 1 AND year IN (${years})`;
  const rows = db.prepare(
    `SELECT player_id, year, team_id, SUM(war) AS war FROM (${part(WAR_TABLES[0])} UNION ALL ${part(WAR_TABLES[1])})
     GROUP BY player_id, year, team_id`
  ).all(leagueId, ...seasons, leagueId, ...seasons) as Array<{ player_id: unknown; year: unknown; team_id: unknown; war: unknown }>;
  for (const r of rows) {
    const player = numberOrNull(r.player_id);
    const year = numberOrNull(r.year);
    const war = numberOrNull(r.war);
    const team = numberOrNull(r.team_id);
    if (player === null || year === null || war === null) continue;
    let s = bySeason.get(year);
    if (!s) {
      s = { season: year, byPlayer: new Map(), total: 0, clubs: new Set(), source: 'players_career_batting_stats.war + players_career_pitching_stats.war (split 1)' };
      bySeason.set(year, s);
    }
    s.byPlayer.set(player, (s.byPlayer.get(player) ?? 0) + war);
    s.total += war;
    if (team !== null && team > 0) s.clubs.add(team);
  }
  return { bySeason, unavailable: null };
}

/** OOTP's payroll figure summed over the league's clubs; unknown unless every club has one. */
function leaguePayrollOf(clubs: Set<number>, rules: Map<number, LeagueRules>): Sourced<number> {
  const source = 'team_financials.player_payroll';
  if (!tableExists('team_financials')) return unknownBecause('source_unavailable', source, 'team_financials is not in the export.');
  if (clubs.size === 0) return unknownBecause('not_exported_by_ootp', source, 'The league has no clubs in the export.');
  let total = 0;
  const lacking: number[] = [];
  for (const club of clubs) {
    const payroll = clubFinancesWith(club, rules).payroll.now.value;
    if (payroll === null) lacking.push(club);
    else total += payroll;
  }
  if (lacking.length > 0) {
    return unknownBecause('not_exported_by_ootp', source, `${lacking.length} of ${clubs.size} clubs have no payroll figure (club ${lacking.join(', ')}), so the league's total is not stated.`);
  }
  return derivedFrom(total, source, `OOTP's payroll figure summed over the league's ${clubs.size} clubs.`);
}

/** The league a market is read in: the regime league of `leagueId` (a minor league's parent). */
function marketLeagueOf(leagueId: number, rules: Map<number, LeagueRules>): number {
  return rules.get(leagueId)?.finance.regimeLeagueId.value ?? leagueId;
}

/** The leagues that run their own economy (each is its own regime league): the ones a snapshot records. */
export function marketLeagues(): number[] {
  const rules = allLeagueRules();
  return [...rules.keys()].filter((id) => marketLeagueOf(id, rules) === id).sort((a, b) => a - b);
}

/** The market league of a club, or null when the export does not place it. */
export function marketLeagueOfClub(teamId: number): number | null {
  const leagueId = teamLeagues().get(teamId) ?? null;
  return leagueId === null ? null : marketLeagueOf(leagueId, allLeagueRules());
}

/**
 * The league's financial reality (Part 2.4): the regime as exported, the opening price of a win
 * (Part 4.1) and the replacement level (Part 4.3). Asked about a minor league, it answers for the
 * parent league whose economy its clubs live in. Computed per request (Part 7, phase 2 timing).
 */
export function leagueFinances(leagueId: number, options: ValuationOptions = {}): LeagueFinances {
  return leagueMarket(leagueId, options).finances;
}

/** The league's finances with the WAR and schedule shares they were read on (the cost ladder prices from them). */
function leagueMarket(leagueId: number, options: ValuationOptions = {}): {
  finances: LeagueFinances; war: Map<number, SeasonWar>; shares: Map<number, Sourced<number>>;
} {
  const rules = allLeagueRules();
  const marketId = marketLeagueOf(leagueId, rules);
  const league = rules.get(marketId) ?? leagueRulesFromRow(null, tableExists('leagues') ? new Set() : null);
  const season = league.contract.season;
  const clubs = leagueClubs(marketId);

  // The population: major leaguers on the league's active or injured lists (R-5)
  const playerColumns = new Set(tableColumns('players'));
  const onClub = clubs.size === 0 || !playerColumns.has('team_id') ? [] : (db.prepare(
    `SELECT player_id FROM players WHERE team_id IN (${[...clubs].map(() => '?').join(',')})${
      playerColumns.has('retired') ? ' AND COALESCE(retired, 0) = 0' : ''}`
  ).all(...clubs) as Array<{ player_id: unknown }>).map((r) => numberOrNull(r.player_id)).filter((id): id is number => id !== null);
  const rostered = [...playerStates(onClub).values()].filter((st) =>
    st.activeRoster.value === true || st.injuredList.onIl.value === true || st.injuredList.onIl60.value === true);
  const values = valuate(rostered, rostered.map((st) => st.playerId), { ...options, production: false, costs: false });
  const candidates: MarketCandidate[] = [...values.values()].map((v) => ({ playerId: v.playerId, contract: v.contract, control: v.control }));

  const s = season.value;
  const seasons = s === null ? [] : [s - 2, s - 1, s];
  const war = s === null ? { bySeason: new Map<number, SeasonWar>(), unavailable: null } : leagueWar(marketId, seasons);
  const records = new Map<number, SeasonRecord | null>(seasons.map((y) => [y, leagueRecord(marketId, clubs, y, y === s)]));

  const gamesPerTeam = league.gamesPerTeam;
  const now = s === null ? null : records.get(s) ?? null;
  const standing = seasonPlayedOf(now, gamesPerTeam);
  // Standings with games played beside a season the league has no lines for, in a league whose lines are read, are last
  // season's (the season number moved on first, D-08): the share played is not known, never a whole season played
  // with nothing in it (review R3-01, as production reads it)
  const facts = s === null ? null : leagueFacts(marketId, s);
  const stale = s !== null && standing.value !== null && standing.value > 0 && facts !== null && facts.firstSeason !== null && facts.firstSeason < s && !hasSeasonLines(marketId, s);
  const seasonPlayed: Sourced<number> = stale
    ? unknownBecause('not_exported_by_ootp', standing.source,
      `The standings show games played beside ${s}, for which the league has no line: they are last season's (the season number moved on before ${s} began, D-08), so the share of ${s} played is not established, never a whole season played with nothing in it.`)
    : standing;
  // The share of this season's schedule each past season covered: its games per club over this season's games per team (B-13)
  const seasonShares = new Map(seasons.filter((y) => y !== s).map((y) => [y, scheduleShareOf(records.get(y) ?? null, gamesPerTeam)]));

  const opening = openingPriceOfWin({
    leagueId: marketId,
    season: s,
    financials: league.finance.financials,
    minimumSalary: league.finance.minimumSalary,
    candidates,
    war: war.bySeason,
    seasonFraction: seasonPlayed,
    seasonShares,
    warUnavailable: war.unavailable,
  });
  // Phase 4b: what the save's imports observed, and which price of a win is in force (owner Q-4)
  const regime = arbitrationRegimeOf(league.contract);
  const { market: observed, platformOf } = observedMarketOf(marketId, clubs, gamesPerTeam, s, league.finance, regime);
  const priceOfWin = adoptPrice(opening, observed.measured);
  const finances: LeagueFinances = {
    leagueId: marketId,
    season,
    regime: league.finance,
    gamesPerTeam,
    seasonPlayed,
    priceOfWin,
    replacementLevel: seasons.map((y) => replacementLevelOf({
      season: y, toDate: y === s, war: war.bySeason.get(y) ?? null, record: records.get(y) ?? null,
    })),
    leaguePayroll: leaguePayrollOf(clubs, rules),
    // Phase 4a: the cost of controlled seasons, measured on the same population, WAR and price
    costs: measureCostLadder({
      leagueId: marketId,
      season: s,
      financials: league.finance.financials,
      minimumSalary: league.finance.minimumSalary,
      regime,
      price: priceOfWin.price,
      candidates,
      war: war.bySeason,
      seasonShares,
    }),
    observed,
  };
  withObservedAwards(finances, platformOf);
  return { finances, war: war.bySeason, shares: seasonShares };
}

// ── the market observed across imports (phase 4b) ────────────────────────────

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A player's name as the export writes it, for a flag that names him (owner decision 3); null where the export has none. */
function playerNameOf(playerId: number): string | null {
  if (!tableExists('players')) return null;
  const columns = new Set(tableColumns('players'));
  if (!['player_id', 'first_name', 'last_name'].every((c) => columns.has(c))) return null;
  const r = db.prepare('SELECT first_name, last_name FROM players WHERE player_id = ?').get(playerId) as { first_name: unknown; last_name: unknown } | undefined;
  const name = r ? [r.first_name, r.last_name].filter((x) => typeof x === 'string' && x.length > 0).join(' ') : '';
  return name.length > 0 ? name : null;
}

/** Read once per save identity, league and store version: an import's record, a stored pair or a break changes the version. */
const observedCache = new Map<string, { market: ObservedMarket; platformOf: (playerId: number, first: number) => number | null }>();

/**
 * What the export's lines say about a pair of imports beyond the two snapshots (review R3-04): whether an
 * organization held a player during a season, read as a line (any league, the overall split) with one of its clubs.
 * Null where the lines cannot be read; a season's lines are read once.
 */
export function pairContext(): PairContext {
  const readable = WAR_TABLES.every((t) => {
    if (!tableExists(t)) return false;
    const c = new Set(tableColumns(t));
    return ['player_id', 'year', 'team_id', 'split_id'].every((x) => c.has(x));
  });
  const orgOfTeam = new Map<number, number>();
  if (tableExists('teams')) {
    const c = new Set(tableColumns('teams'));
    if (c.has('team_id')) {
      const parent = c.has('parent_team_id') ? 'parent_team_id' : 'NULL';
      for (const r of db.prepare(`SELECT team_id, ${parent} AS parent FROM teams`).all() as Array<{ team_id: unknown; parent: unknown }>) {
        const team = numberOrNull(r.team_id);
        const up = numberOrNull(r.parent);
        if (team !== null) orgOfTeam.set(team, up !== null && up > 0 ? up : team);
      }
    }
  }
  const bySeason = new Map<number, Map<number, Set<number>>>();
  const linesOf = (season: number) => {
    let m = bySeason.get(season);
    if (!m) {
      m = new Map();
      const part = (table: string) => `SELECT player_id, team_id FROM ${table} WHERE year = ? AND split_id = 1`;
      const rows = db.prepare(`SELECT DISTINCT player_id, team_id FROM (${part(WAR_TABLES[0])} UNION ALL ${part(WAR_TABLES[1])})`)
        .all(season, season) as Array<{ player_id: unknown; team_id: unknown }>;
      for (const r of rows) {
        const id = numberOrNull(r.player_id);
        const team = numberOrNull(r.team_id);
        if (id === null || team === null || team <= 0) continue;
        const set = m.get(id) ?? new Set<number>();
        set.add(orgOfTeam.get(team) ?? team);
        m.set(id, set);
      }
      bySeason.set(season, m);
    }
    return m;
  };
  return { heldDuring: (playerId, orgId, season) => (readable ? linesOf(season).get(playerId)?.has(orgId) ?? false : null) };
}

/** Two recorded imports compared now (at capture, or when a stored pair's method changed): the pure reading with the export's lines. */
export function observedPairNow(earlier: ContractSnapshot, later: ContractSnapshot, context: PairContext = pairContext()): WinterPair {
  return observeChanges(earlier, later, context);
}

/**
 * The market the save's own imports observed (4.2 to 4.4), read from the pairs of its timeline (review R3-03, R3-05):
 * each pair stored when its later import was recorded, read again from its two snapshots only where the method changed;
 * the measured price's bases (with the realized reading once a signing's first season is completed in the export),
 * observed arbitration salaries scored, reserve-clause renewals, and replacement from freely available talent. The
 * export's WAR is read for what happened after (a signing's first season, a freely acquired player's season with the
 * club that took him, an arbitration salary's platform).
 */
function observedMarketOf(
  marketId: number, clubs: Set<number>, gamesPerTeam: Sourced<number>, season: number | null, finance: FinancialRules,
  regime: ReturnType<typeof arbitrationRegimeOf>,
) {
  const key = `${saveIdentity(marketId)}|${marketId}|${contractStoreVersion()}`;
  const hit = observedCache.get(key);
  if (hit) return hit;
  const imports = contractImports(marketId);
  const timeline: Timeline = contractTimeline(imports.map((i) => ({ gameDate: i.gameDate, seq: i.seq })), contractBreaks(marketId), leagueGameDate(marketId));
  let context: PairContext | null = null;
  let last: { date: string; snapshot: ContractSnapshot | null } | null = null;
  const snapshotAt = (date: string) => (last?.date === date ? last.snapshot : contractSnapshotAt(marketId, date));
  const pairs: WinterPair[] = [];
  let olderMethod = 0;
  for (const t of timeline.pairs) {
    const stored = contractPair(marketId, t.earlier, t.later, SIGNINGS_POLICY.method);
    if (stored) {
      pairs.push(stored);
      continue;
    }
    // Not stored under this method (recorded under an earlier one): read again from its two snapshots, one pair at a time
    const e = snapshotAt(t.earlier);
    const l = contractSnapshotAt(marketId, t.later);
    last = { date: t.later, snapshot: l };
    if (e && l) {
      pairs.push(observeChanges(e, l, context ??= pairContext()));
      continue;
    }
    // A snapshot of it was pruned (owner decision 4): the pair as stored is the durable record, under its own method
    const kept = storedPairAnyMethod(marketId, t.earlier, t.later);
    if (kept) {
      pairs.push(kept);
      olderMethod += 1;
    }
  }
  const prunedImports = imports.filter((i) => i.pruned).length;
  const retention = {
    kept: imports.length - prunedImports, pruned: prunedImports, olderMethod,
    text: `Full contract snapshots are kept for the imports that bracket a winter and the most recent import (owner, 2026-09-24): ${imports.length - prunedImports} of ${plural(imports.length, 'import')} kept, ` +
      `${prunedImports} pruned; every pair of imports observed is kept as stored.${olderMethod > 0 ? ` ${plural(olderMethod, 'pair')} ${olderMethod === 1 ? 'is' : 'are'} read as stored under an earlier method (${SIGNINGS_POLICY.method} is current): a snapshot of ${olderMethod === 1 ? 'it' : 'each'} was pruned, so it cannot be read again.` : ''}`,
  };
  const acquisitions = freeAcquisitions(pairs);
  const replacement = measureReplacement(acquisitions, acquiredProduction(marketId, acquisitions));
  const dollars = finance.financials.value === false
    ? 'The league runs no financials (rules_financials = 0): value is in wins, and no price of a win is measured in dollars.'
    : finance.financials.value === null ? 'Whether the league runs financials is not established: no price of a win is measured in dollars.' : null;
  // A signing's first season, once completed in the export: his WAR that season on its schedule's footing (review R4-01)
  const firstSeasons = [...new Set(pairs.flatMap((p) => p.changes.filter((c) => c.kind === 'free_agent_signing' && c.uses.includes('price') && c.firstSeason !== null)
    .map((c) => c.firstSeason as number)))].filter((y) => season !== null && y < season);
  const realizedWar = firstSeasons.length > 0 ? leagueWar(marketId, firstSeasons) : { bySeason: new Map<number, SeasonWar>(), unavailable: null };
  const realizedShare = new Map(firstSeasons.map((y) => [y, scheduleShareOf(leagueRecord(marketId, clubs, y, false), gamesPerTeam).value]));
  const realized = (playerId: number, y: number): number | null => {
    const w = realizedWar.bySeason.get(y);
    const share = realizedShare.get(y) ?? null;
    if (!w || share === null || !(share >= OPENING_PRICE_MINIMUMS.seasonShare)) return null;
    return (w.byPlayer.get(playerId) ?? 0) / share;
  };
  const byDate = [...imports].sort((a, b) => a.gameDate.localeCompare(b.gameDate));
  const measured = measurePriceOfWin({
    pairs, imports: imports.length, importDates: byDate.map((x) => x.gameDate), replacement, dollars, realized,
  });
  // An arbitration salary's platform: the mean WAR of the two seasons before its first, each on its schedule's footing
  const firsts = [...new Set(pairs.flatMap((p) => p.changes.filter((c) => c.kind === 'arbitration_salary' && c.firstSeason !== null).map((c) => c.firstSeason as number)))];
  const years = [...new Set(firsts.flatMap((f) => [f - 1, f - 2]))];
  const platformWar = years.length > 0 ? leagueWar(marketId, years).bySeason : new Map<number, SeasonWar>();
  const shares = new Map(years.map((y) => [y, scheduleShareOf(leagueRecord(marketId, clubs, y, y === season), gamesPerTeam).value]));
  const platformOf = (playerId: number, first: number): number | null => {
    let sum = 0;
    for (const y of [first - 1, first - 2]) {
      const w = platformWar.get(y);
      const share = shares.get(y) ?? null;
      if (!w || share === null || !(share >= OPENING_PRICE_MINIMUMS.seasonShare)) return null;
      sum += (w.byPlayer.get(playerId) ?? 0) / share;
    }
    return sum / 2;
  };
  const out = {
    market: {
      imports: byDate.map((x) => ({ gameDate: x.gameDate, season: x.season, rows: x.rows })),
      timeline: { text: timeline.text, superseded: timeline.superseded },
      retention,
      pairs,
      measured,
      awards: { ...scoreAwards(pairs, regime, playerNameOf), readings: [], readingsText: '' },
      reserveClause: reserveRenewals(pairs, finance.minimumSalary.value, regime),
      replacement,
    },
    platformOf,
  };
  observedCache.set(key, out);
  return out;
}

/**
 * Observed arbitration salaries as a reading of their class, beside the import's own cross-section (4.4): once a class
 * holds the ladder's minimum of them, pooled over the winters observed, their line is added to the class's readings and
 * the season's band covers both. The cross-section stays: it is this winter's salaries in this import's dollars.
 */
function withObservedAwards(f: LeagueFinances, platformOf: (playerId: number, first: number) => number | null): void {
  const central = f.priceOfWin.price.value?.central ?? null;
  const classes = f.costs.arbitration.regime.classes ?? null;
  const read = central !== null
    ? awardReadings(f.observed.pairs, platformOf, central, classes)
    : { readings: [], leftOut: 0, capped: 0, text: 'The price of a win is unknown, so no observed award is read as a class line (its rung is a share of the price).' };
  const unknownClasses = read.readings.filter((r) => r.reading !== null && f.costs.arbitration.classes.find((x) => x.arbitrationClass === r.arbitrationClass)?.status === 'unknown');
  const readingsText = [read.text, unknownClasses.length > 0
    ? `Class ${unknownClasses.map((r) => r.arbitrationClass).join(', ')} is not established on this import, and observed awards do not price it yet: they join a class the ladder reads (open, review R4-08).`
    : ''].filter(Boolean).join(' ');
  f.observed = { ...f.observed, awards: { ...f.observed.awards, readings: read.readings, readingsText } };
  for (const r of read.readings) {
    if (r.reading === null) continue;
    const c = f.costs.arbitration.classes.find((x) => x.arbitrationClass === r.arbitrationClass);
    if (!c || c.status === 'unknown') continue;
    c.readings = [...c.readings, r.reading];
    c.text = `${c.text} ${r.text}`;
  }
}

/**
 * A freely acquired player's major-league WAR and opportunities (plate appearances and batters faced) for the club that
 * took him, in the season he joined it (review R4-06: a pickup who became a regular does not keep adding seasons), from
 * the export's own lines (every column checked).
 */
function acquiredProduction(marketId: number, acquisitions: ReturnType<typeof freeAcquisitions>): Map<number, { war: number; opportunities: number }> {
  const out = new Map<number, { war: number; opportunities: number }>();
  if (acquisitions.length === 0) return out;
  const by = new Map(acquisitions.map((a) => [a.playerId, a]));
  const ids = [...by.keys()];
  for (const [table, opp] of [['players_career_batting_stats', 'pa'], ['players_career_pitching_stats', 'bf']] as const) {
    if (!tableExists(table)) continue;
    const present = new Set(tableColumns(table));
    if (WAR_COLUMNS.some((c) => !present.has(c)) || !present.has(opp)) continue;
    for (let at = 0; at < ids.length; at += 500) {
      const chunk = ids.slice(at, at + 500);
      const rows = db.prepare(
        `SELECT player_id, year, team_id, SUM(war) AS war, SUM(${opp}) AS opp FROM ${table}
         WHERE league_id = ? AND split_id = 1 AND player_id IN (${chunk.map(() => '?').join(',')}) GROUP BY player_id, year, team_id`
      ).all(marketId, ...chunk) as Array<{ player_id: unknown; year: unknown; team_id: unknown; war: unknown; opp: unknown }>;
      for (const r of rows) {
        const id = numberOrNull(r.player_id);
        const a = id === null ? undefined : by.get(id);
        const year = numberOrNull(r.year);
        if (!a || year === null || year !== a.firstSeason || numberOrNull(r.team_id) !== a.orgId) continue;
        const e = out.get(a.playerId) ?? { war: 0, opportunities: 0 };
        e.war += numberOrNull(r.war) ?? 0;
        e.opportunities += numberOrNull(r.opp) ?? 0;
        out.set(a.playerId, e);
      }
    }
  }
  return out;
}

const thousandth = (x: number): number => Math.round(x * 1000) / 1000;

/** The players with a line in the league's own statistics (a major-league record), every column checked. */
function playersWithLines(leagueId: number): Set<number> {
  const out = new Set<number>();
  for (const table of WAR_TABLES) {
    if (!tableExists(table)) continue;
    const present = new Set(tableColumns(table));
    if (!present.has('player_id') || !present.has('league_id')) continue;
    for (const r of db.prepare(`SELECT DISTINCT player_id FROM ${table} WHERE league_id = ?`).all(leagueId) as Array<{ player_id: unknown }>) {
      const id = numberOrNull(r.player_id);
      if (id !== null) out.add(id);
    }
  }
  return out;
}

/**
 * Whether the league's season had begun at this import (review R3-01): before Opening Day by the schedule, or before
 * the league's start date, or no game of it has a line while earlier seasons do (the season number moved on beside
 * last season's standings, D-08). A season not begun records a share played of 0, so a deal for it is a clean market
 * observation, never "a season already under way".
 */
function seasonStateOf(leagueId: number, season: number | null, played: number | null): { notBegun: boolean; words: string } {
  if (season === null) return { notBegun: false, words: 'The season is not established.' };
  const clubs = leagueClubs(leagueId);
  const league = allLeagueRules().get(leagueId);
  const calendar = seasonCalendar(leagueId, leagueRecord(leagueId, clubs, season, true), gamesThisSeason(leagueId, league, clubs));
  if (calendar.daysToOpening !== null && calendar.daysToOpening > 0) {
    return { notBegun: true, words: `Before Opening Day of ${season} by the schedule (${Math.round(calendar.daysToOpening)} days to go): the season has not begun.` };
  }
  if (tableExists('leagues')) {
    const present = new Set(tableColumns('leagues'));
    if (present.has('start_date') && present.has('current_date')) {
      const row = db.prepare(`SELECT start_date AS s, "current_date" AS d FROM leagues WHERE league_id = ?`).get(leagueId) as { s: unknown; d: unknown } | undefined;
      const start = parseGameDate(row?.s ?? null);
      const today = parseGameDate(row?.d ?? null);
      if (start !== null && today !== null && today < start) return { notBegun: true, words: `Before the league's start date (${start}): ${season} has not begun.` };
    }
  }
  const facts = leagueFacts(leagueId, season);
  if (facts.firstSeason !== null && facts.firstSeason < season && !hasSeasonLines(leagueId, season)) {
    return { notBegun: true, words: `No game of ${season} has a line in the export, while earlier seasons do: ${season} has not begun (standings beside it are last season's, D-08).` };
  }
  return {
    notBegun: false,
    words: played === null
      ? `The share of ${season} played is not established: read as begun, so a deal starting in it is left out of the price.`
      : `${Math.round(played * 100)}% of ${season} played.`,
  };
}

/**
 * How much of the league's season had been played at this import: its season, the games in its standings and the
 * plate appearances and batters faced in its lines. A date imported again is compared on it (review R3-05): the same
 * play with other contracts is a move made on the same day; other play is a reloaded save played again.
 */
export function seasonPlayDigest(leagueId: number): string | null {
  const season = allLeagueRules().get(leagueId)?.contract.season.value ?? null;
  if (season === null) return null;
  const record = leagueRecord(leagueId, leagueClubs(leagueId), season, true);
  const sum = (table: string, column: string): number | null => {
    if (!tableExists(table)) return null;
    const c = new Set(tableColumns(table));
    if (!['league_id', 'year', 'split_id', column].every((x) => c.has(x))) return null;
    const r = db.prepare(`SELECT SUM(${column}) AS n FROM ${table} WHERE league_id = ? AND year = ? AND split_id = 1`).get(leagueId, season) as { n: unknown };
    return numberOrNull(r.n) ?? 0;
  };
  return JSON.stringify({ season, games: record?.games ?? null, pa: sum('players_career_batting_stats', 'pa'), bf: sum('players_career_pitching_stats', 'bf') });
}

/**
 * This import's contracts for each market league asked about (phase 4b), as the contract snapshot records them: every
 * player its clubs hold, and every unsigned player whose production is established, each with his term, club,
 * placement, Player Rights' standing for this season and the two after it (`SIGNINGS_POLICY.rightsSeasons`), his
 * expected production (with the chance he plays, for one side) and the cost of the season the coming winter sets (this
 * season before Opening Day, else the next; review R3-08). A minor-league deal (or a row with no term) carries only
 * its terms. The share played is 0 for a season not begun (review R3-01). One league-wide valuation serves every league
 * asked about; a league that fails is reported and the others are still recorded (review R3-13).
 */
export function contractSnapshotsNow(
  leagueIds: number[], gameDates: Map<number, { iso: string; exported: string | null }>, options: ValuationOptions = {},
): { snapshots: ContractSnapshotInput[]; errors: string[] } {
  if (leagueIds.length === 0) return { snapshots: [], errors: [] };
  const rules = allLeagueRules();
  const states = allPlayerStates();
  const stateOf = new Map(states.map((st) => [st.playerId, st]));
  const values = valuate(states, null, options);
  const leagues = teamLeagues();
  const out: ContractSnapshotInput[] = [];
  const errors: string[] = [];
  for (const leagueId of leagueIds) {
    const date = gameDates.get(leagueId);
    if (!date) continue;
    try {
      const finances = leagueFinances(leagueId, options);
      const season = finances.season.value;
      const state = seasonStateOf(leagueId, season, finances.seasonPlayed.value);
      // The season the coming winter sets: this one before Opening Day, else the next (review R3-08)
      const winterSeason = season === null ? null : state.notBegun ? season : season + 1;
      const lines = playersWithLines(leagueId);
      const rows: ContractSnapshotRow[] = [];
      let full = 0;
      for (const v of values.values()) {
        const st = stateOf.get(v.playerId);
        if (!st) continue;
        const teamId = st.teamId.value !== null && st.teamId.value > 0 ? st.teamId.value : null;
        const club = teamId === null ? null : leagues.get(teamId) ?? null;
        const held = club !== null && marketLeagueOf(club, rules) === leagueId;
        const projected = v.production.status === 'projected';
        if (!held && !(teamId === null && projected)) continue;
        const term = v.contract.term;
        const kind = term ? v.contract.kind.value : null;
        const placement: ContractSnapshotRow['placement'] = st.activeRoster.value === true ? 'active'
          : st.injuredList.onIl.value === true || st.injuredList.onIl60.value === true ? 'injured' : 'other';
        const isFull = kind === 'major_league' || placement !== 'other' || teamId === null;
        const next = winterSeason === null ? null : v.control.seasons.find((x) => x.season === winterSeason) ?? null;
        const org = st.organizationId.value !== null && st.organizationId.value > 0 ? st.organizationId.value : null;
        if (isFull) full += 1;
        rows.push({
          playerId: v.playerId, teamId, orgId: teamId === null ? null : org, kind,
          firstSeason: term?.firstSeason.value ?? null, years: term?.years.value ?? null,
          salaries: term ? term.seasons.map((x) => x.salary.value) : [],
          extension: v.contract.extension ? { firstSeason: v.contract.extension.firstSeason.value, years: v.contract.extension.years.value } : null,
          placement, majorRecord: lines.has(v.playerId),
          rights: isFull && v.control.eligibility
            ? v.control.eligibility.seasons.slice(0, SIGNINGS_POLICY.rightsSeasons).map((e) => ({
              season: e.season, standing: e.standing, between: e.between, trip: e.arbitration.trip, tripIfEligible: e.arbitration.tripIfEligible,
            }))
            : null,
          serviceNow: isFull ? v.control.eligibility?.service.now ?? null : null,
          production: isFull ? {
            status: v.production.status, label: v.production.basis.model.label,
            // Wins to the thousandth and opportunities whole: what the measurement reads, at the snapshot's size; the
            // chance he plays for one side (review R4-03: his expected wins if he plays are the central over it)
            seasons: v.production.seasons.map((x) => ({
              season: x.season, central: thousandth(x.wins.central), low: thousandth(x.wins.low), high: thousandth(x.wins.high),
              opportunities: Math.round(x.sides.reduce((sum, side) => sum + side.usage.central, 0)),
              chance: x.sides.length === 1 && typeof x.sides[0].chance === 'number' ? thousandth(x.sides[0].chance) : null,
            })),
          } : null,
          nextCost: isFull && next?.cost?.value
            ? { season: next.season, low: next.cost.value.low, high: next.cost.value.high, method: next.costBasis?.method ?? null, source: next.costBasis?.source ?? null }
            : null,
        });
      }
      const regime = arbitrationRegimeOf((rules.get(leagueId) ?? leagueRulesFromRow(null, new Set())).contract);
      out.push({
        leagueId, gameDate: date.iso, gameDateExported: date.exported, season,
        seasonPlayed: state.notBegun ? 0 : finances.seasonPlayed.value,
        minimum: finances.regime.minimumSalary.value, financials: finances.regime.financials.value,
        arbitration: { status: regime.status, classes: regime.classes, mlb: regime.mlb },
        rows,
        population: `${rows.length} players: every player the league's clubs hold (${full} with Player Rights' standing, expected production and the cost of ${winterSeason ?? 'the coming season'}; ` +
          `the rest on minor-league deals or rows with no term, their terms only), and every unsigned player whose production is established.`,
        playDigest: seasonPlayDigest(leagueId),
        seasonState: state.words,
      });
    } catch (err) {
      errors.push(`League ${leagueId}: ${(err as Error).message ?? String(err)}`);
    }
  }
  return { snapshots: out, errors };
}

// ── Expected production (concern 3, phases 3a and 3b; D-053; hardened 2026-09-23) ─────────────

/** The model in force for a league, with where it came from: the save's adopted fit, or the fallback prior. */
export interface ProductionModelInForce {
  model: ProductionModel;
  provenance: ModelProvenance;
}

/**
 * What the reader measures about a league once per import (cached until `clearProductionCaches`): its
 * schedules, its first season, its own rates (for the fallback prior), this season's in-season continuation
 * and the injury durations it does not read as days.
 */
interface LeagueFacts {
  schedules: Map<number, number>;
  firstSeason: number | null;
  rates: ReturnType<typeof leagueRateFacts> | null;
}
const factsCache = new Map<number, LeagueFacts>();
let sentinelCache: Map<number, string> | null = null;

/** Forget what was measured about the export: called after an import, and by a test that rebuilds a league. */
export function clearProductionCaches(): void {
  factsCache.clear();
  costContexts.clear();
  observedCache.clear();
  sentinelCache = null;
  clearFitStoreCaches();
}

function leagueFacts(leagueId: number, season: number | null): LeagueFacts {
  let f = factsCache.get(leagueId);
  if (!f) {
    const through = season ?? 0;
    // Completed seasons only: this season's schedule is the rules' (a partial season's games are not its length)
    const schedules = seasonSchedules(leagueId, through - 1);
    f = {
      schedules,
      firstSeason: firstLeagueSeason(leagueId),
      rates: season === null ? null : leagueRateFacts(leagueId, season - 3, season - 1, schedules, PRODUCTION_POLICY.starterShare, PRODUCTION_POLICY.priorAdaptation.minimumOpportunities),
    };
    factsCache.set(leagueId, f);
  }
  return f;
}

function durationSentinels(): Map<number, string> {
  if (!sentinelCache) sentinelCache = injuryDurationSentinels(PRODUCTION_POLICY.injury.sentinelHolders, PRODUCTION_POLICY.injury.sentinelMinimumDays);
  return sentinelCache;
}

/**
 * Stamp of an adopted fit: calibrated only when the fit calls itself calibrated on this save; one that is still
 * mostly the fallback prior is provisional, with its run record kept (D-09).
 */
function savedStamp(fit: StoredFit): CalibrationStamp {
  const r = fit.record;
  const cov = r.coverage.adopted.filter((x) => x.cases > 0).map((x) =>
    `h${x.horizon} ${x.outer === null ? '—' : Math.round(x.outer * 100)}/${x.inner === null ? '—' : Math.round(x.inner * 100)}%`).join(', ');
  const calibrated = !r.label.startsWith(NOT_YET_CALIBRATED);
  return {
    status: calibrated ? 'calibrated' : 'provisional',
    basis: `${calibrated ? 'Fitted on this save\'s own history' : 'Adopted on this save, but mostly the fallback prior'} (D-053): seasons ${r.window.seasons[0] ?? '—'}–${r.window.seasons[r.window.seasons.length - 1] ?? '—'}, ` +
      `held out ${r.window.holdout[0] ?? '—'}–${r.window.holdout[r.window.holdout.length - 1] ?? '—'}; held-out coverage (80/50) ${cov || 'not evaluable'}; ` +
      `prior weight ${fit.priorWeight === null ? '—' : fit.priorWeight.toFixed(2)}.`,
    run: `value_production_fits ${r.id}, fitted at game date ${fit.gameDate ?? 'unknown'} (${fit.method})`,
  };
}

/** The spread of player-season rates in the prior's own source, per kind: what the league's own spread is scaled against. */
function priorSpread(model: ProductionModel): Partial<Record<ProductionKind, number>> {
  const out: Partial<Record<ProductionKind, number>> = {};
  for (const k of ['hitter', 'starter', 'reliever'] as ProductionKind[]) {
    const s = model.kinds[k].observedSpread600;
    if (typeof s === 'number' && s > 0) out[k] = s;
  }
  return out;
}

/** The fallback prior's provenance, with why the save has no fit of its own yet. */
function priorInForce(leagueId: number, season: number | null): ProductionModelInForce {
  const last = latestProductionFitAttempt(leagueId, PRODUCTION_METHOD);
  const seasonsNote = last === null ? '0 seasons' : fitSeasonsNote(last.record.window);
  const why = last === null
    ? 'no fit has been made on this save yet'
    : `the last fit (through ${last.throughSeason}, ${seasonsNote}) was not adopted: ${last.reason}`;
  const seasons = last?.record.window.seasons.length ?? 0;
  // Fitted to the league's own WAR scale and ceiling: a plain measurement of the export (D-12)
  const facts = leagueFacts(leagueId, season);
  const league: LeagueRateFacts = { kinds: {} };
  if (facts.rates) {
    for (const [k, v] of Object.entries(facts.rates.kinds)) {
      league.kinds[k as ProductionKind] = { ...v, mean600: v.opportunities >= PRODUCTION_POLICY.priorAdaptation.minimumLeagueOpportunities ? v.mean600 : null };
    }
  }
  const adapted = adaptPriorToLeague(PRODUCTION_PRIOR, league, priorSpread(PRODUCTION_PRIOR));
  return {
    model: adapted.model,
    provenance: {
      source: 'fallback_prior',
      label: `${NOT_YET_CALIBRATED} (${seasonsNote}): the provisional fallback prior${adapted.note ? `, ${adapted.note}` : ''}; ${why}`,
      stamp: PRODUCTION_PRIOR_CALIBRATION,
      fitId: null,
      priorWeight: 1,
      window: { seasons, first: null, last: null, refitAfter: null, calibrated: false, note: seasonsNote },
    },
  };
}

/** Which horizons are the save's own (the prior's weight under a half) and which still mostly the prior (B-10). */
function horizonsOf(record: FitRecord): { calibrated: number[]; prior: number[] } {
  const by = record.priorWeight.byHorizon;
  if (!by) return { calibrated: [1, 2, 3, 4, 5, 6, 7], prior: [] };
  const out = { calibrated: [] as number[], prior: [] as number[] };
  for (let h = 1; h <= CONTROL_HORIZON_SEASONS; h += 1) {
    const w = Math.max(...Object.values(by).map((row) => row[h - 1] ?? 1));
    (w >= 0.5 ? out.prior : out.calibrated).push(h);
  }
  return out;
}

/**
 * The production model in force for a league: the save's adopted fit where there is one (never through a
 * season the league has not completed), else the fallback prior fitted to the league's own scale.
 */
export function productionModelFor(leagueId: number, rules: Map<number, LeagueRules> = allLeagueRules()): ProductionModelInForce {
  const done = completedThrough(leagueId, rules);
  const fit = adoptedProductionFit(leagueId, PRODUCTION_METHOD, done.season);
  const season = rules.get(leagueId)?.contract.season.value ?? null;
  if (fit && fit.model.kinds?.hitter?.horizons?.[0]?.survivor) {
    return {
      model: fit.model,
      provenance: {
        source: 'save_fit', label: fit.record.label, stamp: savedStamp(fit), fitId: fit.record.id, priorWeight: fit.priorWeight ?? 0,
        observed: fit.record.coverage.adopted.map((r) => ({ horizon: r.horizon, cases: r.cases, outer: r.outer, inner: r.inner })),
        window: {
          seasons: fit.record.window.seasons.length,
          first: fit.record.window.seasons[0] ?? null,
          last: fit.record.window.seasons[fit.record.window.seasons.length - 1] ?? null,
          refitAfter: fit.throughSeason,
          calibrated: !fit.record.label.startsWith(NOT_YET_CALIBRATED),
          horizons: horizonsOf(fit.record),
        },
      },
    };
  }
  return priorInForce(leagueId, season);
}

const FALLBACK: ProductionModelInForce = {
  model: PRODUCTION_PRIOR,
  provenance: {
    source: 'fallback_prior', label: 'the provisional fallback prior', stamp: PRODUCTION_PRIOR_CALIBRATION, fitId: null, priorWeight: 1,
  },
};

type StoredRatingsFit = StoredFit<RatingsModel, RatingsFitRecord>;

/** How far the arrival model is adopted (hardening F6): ", adopted through 3 seasons out (4–6 not established)". */
function arrivalAdoptionWords(r: RatingsFitRecord): string {
  const a = r.arrival.adoption;
  if (!a || a.through === null) return '';
  const later = a.horizons.filter((x) => !x.adopted).map((x) => x.horizon);
  const out = (h: number) => `${h} season${h === 1 ? '' : 's'} out`;
  return `, adopted horizon by horizon through ${out(a.through)}` +
    (later.length > 0 ? ` (${later.length === 1 ? out(later[0]) : `${later[0]}–${later[later.length - 1]} seasons out`} not established: a held-out check at or before each did not pass the gate)` : '');
}

function savedRatingsStamp(fit: StoredRatingsFit): CalibrationStamp {
  const r = fit.record;
  const cov = r.mapping.coverage.served;
  return {
    status: 'calibrated',
    basis: `Fitted on this save (D-053): ratings → rate on ${cov.cases} major leaguers, held-out coverage (80/50) ` +
      `${cov.outer === null ? '—' : Math.round(cov.outer * 100)}/${cov.inner === null ? '—' : Math.round(cov.inner * 100)}% (same-time); ` +
      `arrivals ${r.arrival.measured ? `from seasons ${r.arrival.window[0] ?? '—'}–${r.arrival.window[r.arrival.window.length - 1] ?? '—'}${arrivalAdoptionWords(r)}` : 'not measured'}; ` +
      `development ${r.development.source === 'save_fit' ? `from ${r.development.pairs} rating-snapshot pairs` : `not yet calibrated (${r.development.pairs} of ${r.development.minimumPairs} pairs)`}.`,
    run: `value_production_fits ${r.id}, fitted at game date ${fit.gameDate ?? 'unknown'} (${fit.method})`,
  };
}

/** The ratings model in force for a league: the save's adopted ratings fit, else the provisional prior (which measures no arrivals). */
export function ratingsModelFor(leagueId: number, rules: Map<number, LeagueRules> = allLeagueRules()): RatingsModelInForce {
  const fit = adoptedProductionFit<RatingsModel, RatingsFitRecord>(leagueId, RATINGS_METHOD, completedThrough(leagueId, rules).season);
  if (fit) {
    return {
      model: fit.model,
      provenance: { source: 'save_fit', label: fit.record.label, stamp: savedRatingsStamp(fit), fitId: fit.record.id, priorWeight: fit.priorWeight ?? 0, observed: null },
    };
  }
  const last = latestProductionFitAttempt<RatingsModel, RatingsFitRecord>(leagueId, RATINGS_METHOD);
  return {
    model: RATINGS_PRIOR,
    provenance: {
      source: 'fallback_prior',
      label: `not yet calibrated on this save: the provisional ratings prior, which measures no arrivals; ${last === null ? 'no ratings fit has been made on this save yet' : `the last ratings fit was not adopted: ${last.reason}`}`,
      stamp: RATINGS_PRIOR_CALIBRATION, fitId: null, priorWeight: 1, observed: null,
    },
  };
}

const RATINGS_FALLBACK: RatingsModelInForce = {
  model: RATINGS_PRIOR,
  provenance: { source: 'fallback_prior', label: 'the provisional ratings prior', stamp: RATINGS_PRIOR_CALIBRATION, fitId: null, priorWeight: 1, observed: null },
};

/**
 * One player's production from evidence handed in: the pure projection behind the entry point. With
 * no models given it uses the fallback priors, so a caller outside a save (a test, a what-if) gets the
 * same arithmetic without reading any store. Ability evidence is built with `ratingsEvidence` from the
 * adapter's answers (`scoutedEvidence.ts`); without it the ability component is unknown.
 */
export function projectProduction(
  input: RatingsProductionInput, using: ProductionModelInForce = FALLBACK, ratingsUsing: RatingsModelInForce = RATINGS_FALLBACK,
): PlayerProduction {
  return projectWithRatings(input, using, ratingsUsing);
}

interface LeagueContext {
  season: number | null;
  seasonPlayed: number | null;
  calendar: SeasonCalendar;
  schedule: ScheduleFacts;
  inSeason: InSeasonFacts | null;
  using: ProductionModelInForce;
  ratings: RatingsModelInForce;
}

/** This season's schedule length: the rules' figure, else the schedule itself (`games`, D-15). */
function gamesThisSeason(leagueId: number, league: LeagueRules | undefined, clubs: Set<number>): number | null {
  const rule = league?.gamesPerTeam.value ?? null;
  if (rule !== null && rule > 0) return rule;
  return scheduledGames(leagueId, clubs.size)?.perClub ?? null;
}

function leagueContext(leagueId: number, rules: Map<number, LeagueRules>): LeagueContext {
  const league = rules.get(leagueId);
  const season = league?.contract.season.value ?? null;
  const none: SeasonCalendar = { daysLeft: null, seasonDays: null, daysToOpening: null, offseasonDays: null };
  if (!league || season === null) {
    return { season: null, seasonPlayed: null, calendar: none, schedule: { games: null }, inSeason: null, using: productionModelFor(leagueId, rules), ratings: ratingsModelFor(leagueId, rules) };
  }
  const clubs = leagueClubs(leagueId);
  const now = leagueRecord(leagueId, clubs, season, true);
  const games = gamesThisSeason(leagueId, league, clubs);
  const standing = seasonPlayedOf(now, games === null ? league.gamesPerTeam : derivedFrom(games, 'games', 'The schedule\'s regular-season games per club.')).value;
  const facts = leagueFacts(leagueId, season);
  // Standings with games played beside a season the league has no lines for, in a league whose lines are read, are
  // not this season's (a season number bumped over last season's standings, D-08): its share played is not known,
  // never a whole season played with nothing in it
  const stale = standing !== null && standing > 0 && facts.firstSeason !== null && facts.firstSeason < season && !hasSeasonLines(leagueId, season);
  const played = stale ? null : standing;
  const bySeason: Record<number, number | null> = {};
  for (const [y, g] of facts.schedules) bySeason[y] = g;
  return {
    season,
    seasonPlayed: played === null ? null : Math.min(1, played),
    calendar: seasonCalendar(leagueId, now, games),
    schedule: { games, bySeason, firstSeason: facts.firstSeason },
    inSeason: inSeasonContinuation(leagueId, clubs.size, games, PRODUCTION_POLICY.inSeason.minimumGames, PRODUCTION_POLICY.starterShare),
    using: productionModelFor(leagueId, rules),
    ratings: ratingsModelFor(leagueId, rules),
  };
}

/**
 * Every player's ability evidence, through the adapter only (D-017): his `ScoutedAbility`, a hitter's
 * splits and running (D-035) and his glove at his listed position (D-033), with his listed position and
 * batting hand (objective facts).
 */
function evidenceOf(ids: number[]): Map<number, RatingsEvidence> {
  const abilities = loadScoutedAbilities(ids);
  const facts = listedFacts(ids);
  const hitters = ids.filter((id) => abilities.for(id).kind === 'hitter');
  const profiles = loadScoutedHitterProfiles(hitters);
  const gloves = loadScoutedGlovesAtPosition(hitters);
  const out = new Map<number, RatingsEvidence>();
  for (const id of ids) {
    const f = facts.get(id);
    out.set(id, ratingsEvidence(abilities.for(id), {
      profile: profiles.get(id) ?? null, glove: gloves.get(id) ?? null, position: f?.position ?? null, bats: f?.bats ?? null,
    }));
  }
  return out;
}

/** The minor levels below every market league: where a player not in the majors can be. */
function allAffiliatedLevels(rules: Map<number, LeagueRules>): number[] {
  const markets = [...rules.keys()].filter((id) => marketLeagueOf(id, rules) === id);
  return [...new Set(markets.flatMap((m) => affiliatedLevels(m)))].sort((a, b) => a - b);
}

/** Production for the players valued: their major-league lines, age, stated injuries and proneness, their ability evidence and level, the league's models. */
function productionsOf(states: PlayerState[], ids: number[] | null, rules: Map<number, LeagueRules>, leagues: Map<number, number>): Map<number, PlayerProduction> {
  const out = new Map<number, PlayerProduction>();
  const contexts = new Map<number, LeagueContext>();
  const contextOf = (leagueId: number) => {
    let c = contexts.get(leagueId);
    if (!c) { c = leagueContext(leagueId, rules); contexts.set(leagueId, c); }
    return c;
  };
  const seasons = [...rules.values()].map((r) => r.contract.season.value).filter((y): y is number => y !== null);
  const through = seasons.length > 0 ? Math.max(...seasons) : null;
  const lines = through === null
    ? { byPlayer: new Map(), unavailable: "The league's season is not established in the export.", sides: { batting: null, pitching: null } }
    : majorLeagueLines(ids, Math.min(...seasons) - 3, through, null);
  const ages = ageFacts(ids);
  const prone = readInjuryProneness(ids);
  const stateIds = states.map((s) => s.playerId);
  const evidence = evidenceOf(stateIds);
  const listed = listedFacts(stateIds);
  const hurtThisSeason = injuredThisSeason(stateIds);
  const sentinels = durationSentinels();
  const levels = allAffiliatedLevels(rules);
  const minors = through === null ? new Map<number, LevelSeason[]>() : minorLeagueUsage(stateIds, levels, Math.min(...seasons) - 3, through);
  const unavailable: Partial<Record<ProductionSide, string>> = {};
  if (lines.sides.batting) unavailable.batting = lines.sides.batting;
  if (lines.sides.pitching) unavailable.pitching = lines.sides.pitching;
  for (const state of states) {
    const mine = lines.byPlayer.get(state.playerId);
    // His league: his club's market league; for a player no club holds, the league of his last major-league line
    const club = state.teamId.value;
    const clubLeague = club !== null && club > 0 ? leagues.get(club) ?? null : null;
    const leagueId = clubLeague !== null ? marketLeagueOf(clubLeague, rules) : mine?.lastLeague != null ? marketLeagueOf(mine.lastLeague, rules) : null;
    const ctx = leagueId !== null ? contextOf(leagueId) : null;
    const a = ages.get(state.playerId);
    const age = ctx?.season != null && a?.birth ? ageOn(a.birth, ctx.season) : a?.age ?? state.age;
    const window = (minors.get(state.playerId) ?? []).filter((m) => ctx?.season != null && m.season >= ctx.season - 2 && m.season <= ctx.season);
    const level = state.level.value;
    const games = window.reduce((s, m) => s + m.games, 0);
    // Days out: the larger of the injury's and the injured list's; a value the export holds for many players it contradicts is not days (A-10)
    const stated = [state.injury.daysLeft.value, state.injury.ilDaysLeft?.value ?? null].reduce<number | null>((m, d) => (d === null ? m : m === null ? d : Math.max(m, d)), null);
    const sentinel = stated !== null ? sentinels.get(stated) ?? null : null;
    const f = listed.get(state.playerId);
    const input: RatingsProductionInput = {
      playerId: state.playerId,
      season: ctx?.season ?? null,
      seasonPlayed: ctx?.seasonPlayed ?? null,
      age: age ?? null,
      batting: mine?.batting ?? [],
      pitching: mine?.pitching ?? [],
      injury: {
        injured: state.injury.injured.value,
        daysLeft: sentinel ? null : stated,
        careerEnding: state.injury.careerEnding?.value ?? null,
        seasonDaysLeft: ctx?.calendar.daysLeft ?? null,
        seasonDays: ctx?.calendar.seasonDays ?? null,
        daysToOpening: ctx?.calendar.daysToOpening ?? null,
        offseasonDays: ctx?.calendar.offseasonDays ?? null,
        injuredThisSeason: hurtThisSeason.has(state.playerId),
        durationNote: sentinel,
      },
      proneness: prone.get(state.playerId)?.overall.value ?? null,
      schedule: ctx?.schedule ?? null,
      inSeason: ctx?.inSeason ?? null,
      listed: f ? { position: f.position, role: f.role } : null,
      unavailable: Object.keys(unavailable).length > 0 ? unavailable : null,
      ratings: evidence.get(state.playerId) ?? null,
      level,
      proUsage: games > 0 ? { games, starts: window.reduce((s, m) => s + m.starts, 0) } : null,
    };
    const using = ctx?.using ?? FALLBACK;
    const ratingsUsing = ctx?.ratings ?? RATINGS_FALLBACK;
    let production: PlayerProduction;
    if (lines.unavailable !== null) production = { ...projectProductionWith({ ...input, season: null }, using.model, using.provenance), reason: lines.unavailable };
    else if (leagueId === null) production = { ...projectProductionWith({ ...input, season: null }, using.model, using.provenance), reason: 'No club holds him and he has no major-league line to place his league: his season and his major-league playing time are not established.' };
    else production = projectWithRatings(input, using, ratingsUsing);
    if (production.status === 'projected' && !a?.birth && age !== null) {
      production.seasons.forEach((s) => s.notes.push('No date of birth exported: his age is players.age as exported today.'));
    }
    out.set(state.playerId, production);
  }
  return out;
}

// ── the save's own fit: refitted after an import brings a newer completed season (D-053) ──

export interface RefitOutcome {
  leagueId: number;
  /** The last completed season in the export; null when it cannot be established. */
  throughSeason: number | null;
  refit: boolean;
  adopted: boolean | null;
  reason: string;
  /** Time the fit took, milliseconds. */
  ms: number | null;
}

/**
 * The last completed season in a league: this season once every game is played AND the league has its
 * major-league lines (a season number bumped over last season's standings is not complete, D-08), else the
 * one before.
 */
function completedThrough(leagueId: number, rules: Map<number, LeagueRules>): { season: number | null; current: boolean } {
  const league = rules.get(leagueId);
  const season = league?.contract.season.value ?? null;
  if (!league || season === null) return { season: null, current: false };
  const clubs = leagueClubs(leagueId);
  const games = gamesThisSeason(leagueId, league, clubs);
  const played = seasonPlayedOf(leagueRecord(leagueId, clubs, season, true), games === null ? league.gamesPerTeam : derivedFrom(games, 'games', 'The schedule.')).value;
  const schedule = scheduledGames(leagueId, clubs.size);
  const allPlayed = played !== null && played >= 1 && (schedule === null || schedule.unplayed === 0);
  return allPlayed && hasSeasonLines(leagueId, season) ? { season, current: true } : { season: season - 1, current: false };
}

/** The history a fit reads: the league's major-league lines over the window, with each player's birth date, proneness and listed position. */
export function productionHistory(leagueId: number, through: number, current: boolean, rules: Map<number, LeagueRules> = allLeagueRules()): FitHistory {
  const seasons = leagueSeasons(leagueId, through).map((s) => (current && s.season === through ? { ...s, scheduleShare: 1 } : s));
  const from = through - PRODUCTION_POLICY.window.maxSeasons - 3;
  const lines = majorLeagueLines(null, from, through, leagueId);
  const ids = [...lines.byPlayer.keys()];
  const ages = ageFacts(ids);
  const prone = readInjuryProneness(ids);
  const listed = listedFacts(ids);
  void rules;
  const players: FitPlayer[] = ids.map((id) => ({
    playerId: id,
    birth: ages.get(id)?.birth ?? null,
    proneness: prone.get(id)?.overall.value ?? null,
    batting: lines.byPlayer.get(id)!.batting,
    pitching: lines.byPlayer.get(id)!.pitching,
    position: listed.get(id)?.position ?? null,
    role: listed.get(id)?.role ?? null,
  }));
  return { leagueId, throughSeason: through, seasons, players };
}

/** A fit computed but not yet recorded: the worker hands these back and the main thread records them. */
export interface PendingFit<R> {
  leagueId: number;
  throughSeason: number | null;
  run: R | null;
  gameDate: string | null;
  ms: number | null;
  force: boolean;
  outcome: RefitOutcome;
}

export interface PendingRefits {
  production: Array<PendingFit<FitRun>>;
  ratings: Array<PendingFit<RatingsFitRun>>;
}

/**
 * The production fits an import calls for, computed and NOT recorded (the worker's half): for each league
 * whose export holds a completed season newer than any fit made for it. Reads only.
 */
export function computeProductionRefits(options: { fit?: (history: FitHistory) => FitRun; force?: boolean; leagues?: number[] } = {}): Array<PendingFit<FitRun>> {
  const rules = allLeagueRules();
  const out: Array<PendingFit<FitRun>> = [];
  const candidates = options.leagues ?? marketLeagues();
  for (const leagueId of candidates) {
    const { season: through, current } = completedThrough(leagueId, rules);
    const skip = (outcome: RefitOutcome) => out.push({ leagueId, throughSeason: through, run: null, gameDate: null, ms: null, force: false, outcome });
    if (through === null) {
      skip({ leagueId, throughSeason: null, refit: false, adopted: null, reason: "The league's season is not established in the export.", ms: null });
      continue;
    }
    const seasons = leagueSeasons(leagueId, through);
    if (seasons.length === 0) continue; // no major-league results in this league at all: nothing to fit
    if (!options.force && productionFitAttempted(leagueId, through, PRODUCTION_METHOD)) {
      skip({ leagueId, throughSeason: through, refit: false, adopted: null, reason: `Already fitted through ${through} (${PRODUCTION_METHOD}).`, ms: null });
      continue;
    }
    const start = performance.now();
    let run: FitRun;
    try {
      const history = productionHistory(leagueId, through, current, rules);
      run = (options.fit ?? ((h: FitHistory) => fitProductionModel(h, { prior: PRODUCTION_PRIOR, priorSource: PRODUCTION_PRIOR_SOURCE })))(history);
    } catch (err) {
      // One league's failure never skips the others; the fit in force stays and the outcome says why
      skip({ leagueId, throughSeason: through, refit: false, adopted: null, reason: refitFailure(err), ms: null });
      continue;
    }
    const ms = performance.now() - start;
    out.push({
      leagueId, throughSeason: through, run, gameDate: leagueGameDate(leagueId), ms, force: options.force === true,
      outcome: { leagueId, throughSeason: through, refit: true, adopted: run.record.gate.passed, reason: run.record.gate.reason, ms },
    });
  }
  return out;
}

/** A refit that threw, in words: the league's fit in force stays, and the others still run. */
function refitFailure(err: unknown): string {
  return `The refit failed (${err instanceof Error ? err.message : String(err)}); the fit in force stays, and no other league or model was skipped.`;
}

/** Record fits computed elsewhere (the main thread's half): each at its key, idempotent, never replacing an adopted fit with a failing one. */
export function recordRefits(pending: PendingRefits): RefitOutcome[] {
  const out: RefitOutcome[] = [];
  for (const p of [...pending.production, ...pending.ratings] as Array<PendingFit<{ model: unknown; record: FitRecord | RatingsFitRecord }>>) {
    if (p.run) {
      let written: number;
      try {
        written = recordProductionFit(p.run as { model: unknown; record: FitRecord }, { gameDate: p.gameDate, fitMs: p.ms, force: p.force });
      } catch (err) {
        out.push({ ...p.outcome, adopted: null, reason: `${refitFailure(err)} Not recorded: the fit in force at this key stays.` });
        continue;
      }
      if (written === 0 && p.force && !p.outcome.adopted) {
        out.push({ ...p.outcome, reason: `${p.outcome.reason} Not recorded: the fit in force at this key stays (a failing refit never replaces an adopted one).` });
        continue;
      }
    }
    out.push(p.outcome);
  }
  if (pending.production.some((p) => p.run) || pending.ratings.some((p) => p.run)) clearProductionCaches();
  return out;
}

/**
 * After an import: refit the production model for each league whose export holds a completed season
 * newer than any fit made for it, record the fit per save (adopted only through the gate), and fit
 * nothing when there is none. In-process (the harness and tests); the server runs the same work in a
 * worker thread (`refitOffThread`). `force` refits even a season already fitted (the developer's harness).
 */
export function refitProductionIfNeeded(options: { fit?: (history: FitHistory) => FitRun; force?: boolean; leagues?: number[] } = {}): RefitOutcome[] {
  return recordRefits({ production: computeProductionRefits(options), ratings: [] });
}

/**
 * The refit, off the server's event loop (A-17): `compute` computes the fits elsewhere (a worker thread), and
 * they are recorded here only if no import started while they were read (`stale`), since a fit read across
 * an import would be of neither export. Never throws into its caller's turn; resolves with the outcomes.
 */
export async function refitOffThread(options: { compute: () => Promise<PendingRefits>; stale: () => boolean }): Promise<RefitOutcome[]> {
  await Promise.resolve();
  const pending = await options.compute();
  if (options.stale()) return [];
  return recordRefits(pending);
}

/** The worker thread's entry file: the bundled desktop build ships it beside the bundle; the source runs it through tsx. */
function refitWorkerUrl(): URL {
  const here = new URL(import.meta.url);
  return here.pathname.endsWith('.cjs') ? new URL('./value-refit-worker.cjs', here) : new URL('./playerValueRefitWorker.ts', here);
}

/** Compute the refits in a worker thread (better-sqlite3 opens its own connections there); rejects if the worker fails. */
export function refitInWorker(): Promise<PendingRefits> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(refitWorkerUrl());
    } catch (err) {
      reject(err);
      return;
    }
    worker.once('message', (m: { ok: boolean; pending?: PendingRefits; error?: string }) => {
      if (m.ok && m.pending) resolve(m.pending);
      else reject(new Error(m.error ?? 'the refit worker failed'));
      void worker.terminate();
    });
    worker.once('error', reject);
    worker.once('exit', (code) => { if (code !== 0) reject(new Error(`the refit worker exited with ${code}`)); });
  });
}

/** Both refits, computed and not recorded: the production fits first, then the ratings fits on the production model they leave in force. */
export function computeRefits(): PendingRefits {
  const production = computeProductionRefits();
  const rules = allLeagueRules();
  const adopted = new Map<number, ProductionModel>();
  for (const p of production) if (p.run && p.run.record.gate.passed) adopted.set(p.leagueId, p.run.model);
  const ratings = computeRatingsRefits({ production: (leagueId) => adopted.get(leagueId) ?? productionModelFor(leagueId, rules).model });
  return { production, ratings };
}

/**
 * The evidence the ratings fit reads for a league (phase 3b): its major leaguers' ability evidence beside
 * their rates in the projection window, how often each batting hand faces left-handers, the minor levels
 * and every player's usage there by season (no minor-league WAR, Q-9), the cross-section of scouted gaps,
 * and the save's persisted rating snapshots. Ratings only through the adapter.
 */
export function ratingsHistory(leagueId: number, through: number, current: boolean, rules: Map<number, LeagueRules> = allLeagueRules(), productionModel?: ProductionModel): RatingsFitInput {
  const league = rules.get(leagueId);
  const season = league?.contract.season.value ?? through;
  const clubs = leagueClubs(leagueId);
  const games = gamesThisSeason(leagueId, league, clubs);
  const played = league ? seasonPlayedOf(leagueRecord(leagueId, clubs, season, true), games === null ? league.gamesPerTeam : derivedFrom(games, 'games', 'The schedule.')).value : null;
  // An unknown share of the season is not zero (A-24): the window cannot be placed, so the mapping reads no case
  const f = played === null ? null : Math.min(Math.max(played, 0), 1);
  const production = productionModel ?? productionModelFor(leagueId, rules).model;
  const fitSeasons = leagueSeasons(leagueId, through).map((s) => (current && s.season === through ? { ...s, scheduleShare: 1 } : s));

  // The active players, their evidence and ages: the mapping's major leaguers and the cross-section
  const activeStates = allPlayerStates();
  const active = activeStates.map((s) => s.playerId);
  const evidence = evidenceOf(active);
  const ages = ageFacts(active);
  const ageNow = (id: number): number | null => {
    const a = ages.get(id);
    return a?.birth ? ageOn(a.birth, season) : a?.age ?? null;
  };
  const window = majorLeagueLines(active, season - 3, season, leagueId);
  const listedActive = listedFacts(active);
  const mapping: MappingCase[] = [];
  for (const [id, lines] of f === null ? [] : window.byPlayer) {
    const ev = evidence.get(id);
    const age = ageNow(id);
    if (!ev || ev.group === null || age === null || f === null) continue;
    const l = listedActive.get(id);
    const plan = planSides({ playerId: id, season, seasonPlayed: f, age, batting: lines.batting, pitching: lines.pitching, listed: l ? { position: l.position, role: l.role } : null });
    if (!plan.ok) continue;
    const primary = plan.sides[0];
    if ((primary.side === 'batting') !== (ev.group === 'hitter')) continue;
    const { slots } = windowOf(plan.results[primary.side], season, f);
    mapping.push({
      playerId: id, kind: primary.kind, evidence: ev,
      opportunities: slots.reduce((s, x) => s + x.opportunities, 0), war: slots.reduce((s, x) => s + x.war, 0),
    });
  }

  // Arrival: every player's major-league and minor-league usage over the window, on his side. The minor-league
  // lines are the league's own (where the export names parents), and reaching any top-level league is arriving
  // (hardening F4, D-07): another league's farm is never counted as players who never arrived
  const levels = affiliatedLevels(leagueId);
  // Another market league's farm, or an independent league, is left out; a league the export no longer lists
  // (a defunct affiliate) is not known to be another's and is kept
  const otherLeagues = leagueParentsNamed() ? [...rules.keys()].filter((id) => marketLeagueOf(id, rules) !== leagueId) : null;
  const from = through - PRODUCTION_POLICY.window.maxSeasons - 3;
  const minor = minorLeagueUsage(null, levels, from, through, otherLeagues);
  const majors = majorLeagueLines([...minor.keys()], from, through, null);
  const facts = listedFacts([...minor.keys()]);
  const births = ageFacts([...minor.keys()]);
  const arrival: ArrivalPlayer[] = [...minor.entries()].map(([id, rows]) => {
    const side: ProductionSide = facts.get(id)?.position === 1 ? 'pitching' : 'batting';
    const mlb = majors.byPlayer.get(id);
    const lines = side === 'batting' ? mlb?.batting ?? [] : mlb?.pitching ?? [];
    return {
      playerId: id, birth: births.get(id)?.birth ?? null, side,
      majors: new Map(lines.map((l) => [l.season, l.opportunities])),
      minors: rows.map((r) => ({ season: r.season, level: r.level, opportunities: side === 'batting' ? r.pa : r.bf })),
    };
  });

  // The save's own rating snapshots, read back through the adapter, and the major-league seasons after them; each at
  // its point of the season where the save's schedule for that season is exported, else not established (hardening F5)
  const spans = seasonSpans(leagueId);
  const observations = observationsOf(listedFacts(null)).map((o) => ({ ...o, seasonPlayed: seasonShareOn(spans.get(o.season), o.gameDate) }));
  const observed = [...new Set(observations.map((o) => o.playerId))];
  const after = majorLeagueLines(observed, from, season, leagueId);
  const forward: ForwardSeason[] = [];
  for (const [id, lines] of after.byPlayer) {
    for (const [side, list] of [['batting', lines.batting], ['pitching', lines.pitching]] as const) {
      for (const l of list) {
        if (l.war === null) continue;
        forward.push({ playerId: id, season: l.season, side, opportunities: l.opportunities, war: l.war, games: l.games ?? 0, starts: l.starts ?? 0 });
      }
    }
  }

  // The arrival cells' players now (hardening F4, C-02): the league's own affiliates' players, their club's level,
  // whether they have a major-league line in the window, and their professional pitching (a pitcher's kind)
  const clubLeague = teamLeagues();
  const levelOf = new Map<number, number>();
  for (const st of activeStates) {
    const club = st.teamId.value;
    const lg = club !== null && club > 0 ? clubLeague.get(club) ?? null : null;
    const level = st.level.value;
    if (lg !== null && level !== null && level > 1 && marketLeagueOf(lg, rules) === leagueId) levelOf.set(st.playerId, level);
  }
  const recent = minorLeagueUsage([...levelOf.keys()], levels, season - 2, season);
  const proUsage = (id: number) => {
    const rows = recent.get(id) ?? [];
    const games = rows.reduce((t, r) => t + r.games, 0);
    return games > 0 ? { games, starts: rows.reduce((t, r) => t + r.starts, 0) } : null;
  };

  return {
    leagueId, throughSeason: through, seasons: fitSeasons, production, mapping,
    exposure: platoonExposure(leagueId, season - 3, season),
    levels, arrival,
    crossSection: active.map((id) => ({
      evidence: evidence.get(id)!, age: ageNow(id), level: levelOf.get(id) ?? null,
      majors: (window.byPlayer.get(id)?.batting.length ?? 0) + (window.byPlayer.get(id)?.pitching.length ?? 0) > 0,
      proUsage: levelOf.has(id) ? proUsage(id) : null,
    })).filter((x) => x.evidence),
    now: f === null ? null : { season, seasonPlayed: f },
    observations,
    forward,
  };
}

/**
 * Every persisted rating snapshot of the save, as the adapter reads it back, with the season each falls in.
 * A snapshot whose age disagrees with the player's own date of birth is another person under a reused id (a
 * regenerated league under the same save name, D-01), and is not read as his history.
 */
function observationsOf(facts: Map<number, { position: number | null }>): Observation[] {
  const out: Observation[] = [];
  const all = loadScoutedObservations(null);
  const births = ageFacts([...all.keys()]);
  for (const list of all.values()) {
    for (const o of list) {
      const birth = births.get(o.playerId)?.birth ?? null;
      const season = Number(o.gameDate.slice(0, 4));
      if (birth && typeof o.age === 'number' && Number.isFinite(o.age)) {
        const expected = season - birth.year;
        if (Math.abs(o.age - expected) > 1) continue;
      }
      out.push({
        playerId: o.playerId, gameDate: o.gameDate, season, level: o.level, age: o.age,
        group: o.ability.kind === 'hitter' ? 'hitter' : o.ability.kind === 'pitcher' ? 'pitcher' : null,
        current: o.ability.current, potential: o.ability.potential,
        tools: { ...o.ability.currentTools }, position: facts.get(o.playerId)?.position ?? null,
      });
    }
  }
  return out;
}

/**
 * The ratings fits an import calls for, computed and not recorded: for each league whose export holds a
 * completed season it has not been fitted through, or whose rating snapshots have just become enough for its
 * own development path (then forced: a passing fit replaces the row, a failing one never does, A-02).
 */
export function computeRatingsRefits(options: { fit?: (input: RatingsFitInput) => RatingsFitRun; force?: boolean; leagues?: number[]; production?: (leagueId: number) => ProductionModel } = {}): Array<PendingFit<RatingsFitRun>> {
  const rules = allLeagueRules();
  const out: Array<PendingFit<RatingsFitRun>> = [];
  for (const leagueId of options.leagues ?? marketLeagues()) {
    const { season: through, current } = completedThrough(leagueId, rules);
    if (through === null) continue;
    if (leagueSeasons(leagueId, through).length === 0) continue;
    const last = latestProductionFitAttempt<RatingsModel, RatingsFitRecord>(leagueId, RATINGS_METHOD);
    const attempted = productionFitAttempted(leagueId, through, RATINGS_METHOD);
    const pairsNow = attempted && last?.throughSeason === through && last.record.development.pairs < last.record.development.minimumPairs ? countedPairs() : 0;
    const longitudinalArrived = attempted && last !== null && last.record.development.pairs < last.record.development.minimumPairs
      && pairsNow >= last.record.development.minimumPairs;
    if (!options.force && attempted && !longitudinalArrived) {
      out.push({ leagueId, throughSeason: through, run: null, gameDate: null, ms: null, force: false, outcome: { leagueId, throughSeason: through, refit: false, adopted: null, reason: `Already fitted through ${through} (${RATINGS_METHOD}).`, ms: null } });
      continue;
    }
    const start = performance.now();
    let run: RatingsFitRun;
    try {
      const input = ratingsHistory(leagueId, through, current, rules, options.production?.(leagueId));
      run = (options.fit ?? ((i: RatingsFitInput) => fitRatingsModel(i, { prior: RATINGS_PRIOR })))(input);
    } catch (err) {
      out.push({ leagueId, throughSeason: through, run: null, gameDate: null, ms: null, force: false, outcome: { leagueId, throughSeason: through, refit: false, adopted: null, reason: refitFailure(err), ms: null } });
      continue;
    }
    const ms = performance.now() - start;
    out.push({
      leagueId, throughSeason: through, run, gameDate: leagueGameDate(leagueId), ms, force: options.force === true || longitudinalArrived,
      outcome: { leagueId, throughSeason: through, refit: true, adopted: run.record.gate.passed, reason: run.record.gate.reason, ms },
    });
  }
  return out;
}

/**
 * After an import: refit the ratings model (phase 3b), in-process (the harness and tests). Recorded in the
 * same store under RATINGS_METHOD; adopted only through the gate. Called after the results refit, since it
 * reads the results model in force.
 */
export function refitRatingsIfNeeded(options: { fit?: (input: RatingsFitInput) => RatingsFitRun; force?: boolean; leagues?: number[] } = {}): RefitOutcome[] {
  return recordRefits({ production: [], ratings: computeRatingsRefits(options) });
}

/** How many rating-snapshot pairs about a season apart the save holds now (the development path's evidence). */
function countedPairs(): number {
  return snapshotPairCount(observationsOf(new Map()));
}

/** What the API shows about calibration: the fit in force, and the latest attempt if it was not adopted. */
export interface ProductionCalibration {
  leagueId: number;
  inForce: {
    source: ModelProvenance['source'];
    label: string;
    stamp: CalibrationStamp;
    priorWeight: number;
    fit: null | {
      id: string; throughSeason: number; gameDate: string | null; fittedAt: string;
      window: FitRecord['window']; coverage: FitRecord['coverage']; gate: FitRecord['gate'];
      aging: FitRecord['aging']; proneness: string[]; priorWeight: FitRecord['priorWeight']; fitMs: number | null;
    };
  };
  latestAttempt: null | { throughSeason: number; adopted: boolean; reason: string; gameDate: string | null };
  coverageTargets: { outer: number; inner: number };
  /**
   * Per horizon, the target beside what the fit in force observed on held-out seasons as served, for
   * the 80% and 50% bands, pooled and by usage tier. Observed is null when not measured (the prior).
   */
  observed: Array<{
    horizon: number; cases: number;
    outer: { target: number; observed: number | null }; inner: { target: number; observed: number | null };
    byUsage: Record<string, { cases: number; outer: number | null; inner: number | null }>;
  }>;
  /** Phase 3b: the ratings model in force (mapping, arrivals, development) and its run record. */
  ratings: {
    source: ModelProvenance['source'];
    label: string;
    stamp: CalibrationStamp;
    record: RatingsFitRecord | null;
    latestAttempt: null | { throughSeason: number; adopted: boolean; reason: string; gameDate: string | null };
  };
  unit: string;
}

export function productionCalibration(leagueId: number): ProductionCalibration {
  const rules = allLeagueRules();
  const { provenance } = productionModelFor(leagueId, rules);
  const done = completedThrough(leagueId, rules).season;
  const fit = adoptedProductionFit(leagueId, PRODUCTION_METHOD, done);
  const last = latestProductionFitAttempt(leagueId, PRODUCTION_METHOD);
  const ratings = ratingsModelFor(leagueId, rules);
  const ratingsFit = adoptedProductionFit<RatingsModel, RatingsFitRecord>(leagueId, RATINGS_METHOD, done);
  const ratingsLast = latestProductionFitAttempt<RatingsModel, RatingsFitRecord>(leagueId, RATINGS_METHOD);
  return {
    leagueId,
    inForce: {
      source: provenance.source, label: provenance.label, stamp: provenance.stamp, priorWeight: provenance.priorWeight,
      fit: fit && {
        id: fit.record.id, throughSeason: fit.throughSeason, gameDate: fit.gameDate, fittedAt: fit.fittedAt,
        window: fit.record.window, coverage: fit.record.coverage, gate: fit.record.gate, aging: fit.record.aging,
        proneness: fit.record.proneness, priorWeight: fit.record.priorWeight, fitMs: fit.fitMs,
      },
    },
    latestAttempt: last && { throughSeason: last.throughSeason, adopted: last.adopted, reason: last.reason, gameDate: last.gameDate },
    coverageTargets: { outer: PRODUCTION_POLICY.coverage.outer, inner: PRODUCTION_POLICY.coverage.inner },
    observed: Array.from({ length: CONTROL_HORIZON_SEASONS }, (_, i) => {
      const row = fit?.record.coverage.adopted.find((r) => r.horizon === i + 1) ?? null;
      const byUsage = Object.fromEntries(Object.entries(fit?.record.coverage.byUsage ?? {}).map(([tier, rows]) => {
        const r = rows.find((x) => x.horizon === i + 1);
        return [tier, { cases: r?.cases ?? 0, outer: r?.outer ?? null, inner: r?.inner ?? null }];
      }));
      return {
        horizon: i + 1, cases: row?.cases ?? 0,
        outer: { target: PRODUCTION_POLICY.coverage.outer, observed: row?.outer ?? null },
        inner: { target: PRODUCTION_POLICY.coverage.inner, observed: row?.inner ?? null },
        byUsage,
      };
    }),
    ratings: {
      source: ratings.provenance.source, label: ratings.provenance.label, stamp: ratings.provenance.stamp,
      record: ratingsFit?.record ?? null,
      latestAttempt: ratingsLast && { throughSeason: ratingsLast.throughSeason, adopted: ratingsLast.adopted, reason: ratingsLast.reason, gameDate: ratingsLast.gameDate },
    },
    unit: PRODUCTION_UNIT,
  };
}
