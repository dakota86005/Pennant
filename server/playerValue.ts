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
 */

import { db, tableColumns, tableExists } from './db.js';
import type { SourceState } from './dataFreshness.js';
import { allLeagueRules, leagueRulesFromRow, type ContractRules, type FinancialRules, type LeagueRules } from './leagueRules.js';
import { evaluateContractControl, superTwoCutoffs } from './playerRights.js';
import { allPlayerStates, playerStates, seasonServiceClocks, serviceClassMembers, type PlayerState } from './playerState.js';
import { CONTROL_HORIZON_SEASONS, PRODUCTION_PENDING_RATINGS } from './playerValueCalibration.js';
import {
  CLAUSE_COLUMNS, CONTRACT_COLUMNS, EXTENSION_COLUMNS, contractFactsOf,
  type ContractFacts, type ContractRow, type ContractTables,
} from './playerValueContract.js';
import { composeControlTimeline, type ControlTimeline } from './playerValueControl.js';
import { productionCone, type ProductionCone } from './playerValueCone.js';
import {
  FINANCE_COLUMNS, clubFinancesOf, openingPriceOfWin, replacementLevelOf,
  type ClubFinances, type FinanceTable, type MarketCandidate, type PriceOfWin, type ReplacementLevel,
  type SeasonRecord, type SeasonWar,
} from './playerValueFinances.js';
import { derivedFrom, unknownBecause, type Sourced } from './provenance.js';
import type { CalibrationStamp } from './calibration.js';
import { readInjuryProneness } from './injuryProneness.js';
import {
  PRODUCTION_METHOD, PRODUCTION_POLICY, PRODUCTION_PRIOR, PRODUCTION_PRIOR_CALIBRATION,
} from './playerValueCalibration.js';
import {
  adoptedProductionFit, latestProductionFitAttempt, productionFitAttempted, recordProductionFit, type StoredFit,
} from './playerValueFitStore.js';
import {
  ageFacts, leagueClubs, leagueGameDate, leagueRecord, leagueSeasons, majorLeagueLines, seasonCalendar, seasonPlayedOf,
} from './playerValueHistory.js';
import {
  PRODUCTION_UNIT, projectProductionWith,
  type ModelProvenance, type PlayerProduction, type ProductionInput, type ProductionModel,
} from './playerValueProduction.js';
import { NOT_YET_CALIBRATED, ageOn, fitProductionModel, type FitHistory, type FitPlayer, type FitRecord, type FitRun } from './playerValueProductionFit.js';

export type { ContractFacts, ContractSeason, ContractTerm } from './playerValueContract.js';
export type { ControlSeason, ControlStatus, ControlTimeline, CostBand } from './playerValueControl.js';
export type {
  ClubFinanceInput, ClubFinances, FinanceSeason, FinanceTable, MarketCandidate, MarketStanding, OpeningPriceInput,
  PriceBand, PriceBasis, PriceOfWin, PricePopulation, ReplacementLevel, ReplacementLevelInput, SeasonRecord, SeasonWar,
} from './playerValueFinances.js';
export { clubFinancesOf, marketStandingOf, openingPriceOfWin, replacementLevelOf } from './playerValueFinances.js';
export type {
  BandTails, HorizonModel, InjuryFacts, KindModel, ModelProvenance, PlayerProduction, ProductionBasis, ProductionInput,
  ProductionKind, ProductionLine, ProductionModel, ProductionSeason, ProductionSide, SideBasis, SideSeason, WinsBand,
} from './playerValueProduction.js';
export type { CoverageRow, FitHistory, FitPlayer, FitRecord, FitRun, FitSeason } from './playerValueProductionFit.js';
export type { ConeBand, ConeControl, ConeControlStatus, ConeCoverage, ConeSeason, ProductionCone } from './playerValueCone.js';
export { productionCone } from './playerValueCone.js';
export { PRODUCTION_UNIT } from './playerValueProduction.js';
export { fitProductionModel } from './playerValueProductionFit.js';
export { PRODUCTION_PENDING_RATINGS };

/** A player's value, as far as phase 3a builds it: concerns 1, 2 and 3 (production from major-league results). */
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
  if (options.production !== false) {
    const productions = productionsOf(states, ids, rules, leagues);
    for (const v of out.values()) v.production = productions.get(v.playerId);
  }
  return out as Map<number, PlayerValuation>;
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
  return clubFinancesOf({
    teamId,
    season: rulesOfClub(teamId, rules).contract.season.value,
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
  const values = valuate(rostered, rostered.map((st) => st.playerId), { ...options, production: false });
  const candidates: MarketCandidate[] = [...values.values()].map((v) => ({ playerId: v.playerId, contract: v.contract, control: v.control }));

  const s = season.value;
  const seasons = s === null ? [] : [s - 2, s - 1, s];
  const war = s === null ? { bySeason: new Map<number, SeasonWar>(), unavailable: null } : leagueWar(marketId, seasons);
  const records = new Map<number, SeasonRecord | null>(seasons.map((y) => [y, leagueRecord(marketId, clubs, y, y === s)]));

  const gamesPerTeam = league.gamesPerTeam;
  const now = s === null ? null : records.get(s) ?? null;
  const seasonPlayed = seasonPlayedOf(now, gamesPerTeam);

  return {
    leagueId: marketId,
    season,
    regime: league.finance,
    gamesPerTeam,
    seasonPlayed,
    priceOfWin: openingPriceOfWin({
      leagueId: marketId,
      season: s,
      financials: league.finance.financials,
      minimumSalary: league.finance.minimumSalary,
      candidates,
      war: war.bySeason,
      seasonFraction: seasonPlayed,
      warUnavailable: war.unavailable,
    }),
    replacementLevel: seasons.map((y) => replacementLevelOf({
      season: y, toDate: y === s, war: war.bySeason.get(y) ?? null, record: records.get(y) ?? null,
    })),
    leaguePayroll: leaguePayrollOf(clubs, rules),
  };
}

// ── Expected production (concern 3, phase 3a; D-053) ───────────────────────────

/** The model in force for a league, with where it came from: the save's adopted fit, or the fallback prior. */
export interface ProductionModelInForce {
  model: ProductionModel;
  provenance: ModelProvenance;
}

function savedStamp(fit: StoredFit): CalibrationStamp {
  const r = fit.record;
  const cov = r.coverage.adopted.filter((x) => x.cases > 0).map((x) =>
    `h${x.horizon} ${x.outer === null ? '—' : Math.round(x.outer * 100)}/${x.inner === null ? '—' : Math.round(x.inner * 100)}%`).join(', ');
  return {
    status: 'calibrated',
    basis: `Fitted on this save's own history (D-053): seasons ${r.window.seasons[0] ?? '—'}–${r.window.seasons[r.window.seasons.length - 1] ?? '—'}, ` +
      `held out ${r.window.holdout[0] ?? '—'}–${r.window.holdout[r.window.holdout.length - 1] ?? '—'}; held-out coverage (80/50) ${cov || 'not evaluable'}; ` +
      `prior weight ${fit.priorWeight === null ? '—' : fit.priorWeight.toFixed(2)}.`,
    run: `value_production_fits ${r.id}, fitted at game date ${fit.gameDate ?? 'unknown'} (${fit.method})`,
  };
}

/** The fallback prior's provenance, with why the save has no fit of its own yet. */
function priorProvenance(leagueId: number): ModelProvenance {
  const last = latestProductionFitAttempt(leagueId, PRODUCTION_METHOD);
  const why = last === null
    ? 'no fit has been made on this save yet'
    : `the last fit (through ${last.throughSeason}, ${last.record.window.seasons.length} seasons) was not adopted: ${last.reason}`;
  const seasons = last?.record.window.seasons.length ?? 0;
  return {
    source: 'fallback_prior',
    label: `${NOT_YET_CALIBRATED} (${seasons} seasons): the provisional fallback prior; ${why}`,
    stamp: PRODUCTION_PRIOR_CALIBRATION,
    fitId: null,
    priorWeight: 1,
    window: { seasons, first: null, last: null, refitAfter: null, calibrated: false },
  };
}

/** The production model in force for a league: the save's adopted fit where there is one, else the fallback prior. */
export function productionModelFor(leagueId: number): ProductionModelInForce {
  const fit = adoptedProductionFit(leagueId, PRODUCTION_METHOD);
  if (fit) {
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
          // The fit's own verdict, as its label states it: an adopted fit that is still mostly the prior is not calibrated
          calibrated: !fit.record.label.startsWith(NOT_YET_CALIBRATED),
        },
      },
    };
  }
  return { model: PRODUCTION_PRIOR, provenance: priorProvenance(leagueId) };
}

const FALLBACK: ProductionModelInForce = {
  model: PRODUCTION_PRIOR,
  provenance: {
    source: 'fallback_prior', label: 'the provisional fallback prior', stamp: PRODUCTION_PRIOR_CALIBRATION, fitId: null, priorWeight: 1,
  },
};

/**
 * One player's production from evidence handed in: the pure projection behind the entry point. With
 * no model given it uses the fallback prior, so a caller outside a save (a test, a what-if) gets the
 * same arithmetic without reading any store.
 */
export function projectProduction(input: ProductionInput, using: ProductionModelInForce = FALLBACK): PlayerProduction {
  return projectProductionWith(input, using.model, using.provenance);
}

interface LeagueContext {
  season: number | null;
  seasonPlayed: number | null;
  calendar: { daysLeft: number | null; seasonDays: number | null };
  using: ProductionModelInForce;
}

function leagueContext(leagueId: number, rules: Map<number, LeagueRules>): LeagueContext {
  const league = rules.get(leagueId);
  const season = league?.contract.season.value ?? null;
  if (!league || season === null) return { season: null, seasonPlayed: null, calendar: { daysLeft: null, seasonDays: null }, using: productionModelFor(leagueId) };
  const clubs = leagueClubs(leagueId);
  const now = leagueRecord(leagueId, clubs, season, true);
  const played = seasonPlayedOf(now, league.gamesPerTeam).value;
  return {
    season,
    seasonPlayed: played === null ? null : Math.min(1, played),
    calendar: seasonCalendar(leagueId, now, league.gamesPerTeam.value),
    using: productionModelFor(leagueId),
  };
}

/** Production for the players valued: their major-league lines, age, stated injuries and proneness, the league's model. */
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
    ? { byPlayer: new Map(), unavailable: "The league's season is not established in the export." }
    : majorLeagueLines(ids, Math.min(...seasons) - 3, through, null);
  const ages = ageFacts(ids);
  const prone = readInjuryProneness(ids);
  for (const state of states) {
    const mine = lines.byPlayer.get(state.playerId);
    // His league: his club's market league; for a player no club holds, the league of his last major-league line
    const club = state.teamId.value;
    const clubLeague = club !== null && club > 0 ? leagues.get(club) ?? null : null;
    const leagueId = clubLeague !== null ? marketLeagueOf(clubLeague, rules) : mine?.lastLeague != null ? marketLeagueOf(mine.lastLeague, rules) : null;
    const ctx = leagueId !== null ? contextOf(leagueId) : null;
    const a = ages.get(state.playerId);
    const age = ctx?.season != null && a?.birth ? ageOn(a.birth, ctx.season) : a?.age ?? state.age;
    const input: ProductionInput = {
      playerId: state.playerId,
      season: ctx?.season ?? null,
      seasonPlayed: ctx?.seasonPlayed ?? null,
      age: age ?? null,
      batting: mine?.batting ?? [],
      pitching: mine?.pitching ?? [],
      injury: {
        injured: state.injury.injured.value,
        daysLeft: [state.injury.daysLeft.value, state.injury.ilDaysLeft?.value ?? null].reduce<number | null>((m, d) => (d === null ? m : m === null ? d : Math.max(m, d)), null),
        careerEnding: state.injury.careerEnding?.value ?? null,
        seasonDaysLeft: ctx?.calendar.daysLeft ?? null,
        seasonDays: ctx?.calendar.seasonDays ?? null,
      },
      proneness: prone.get(state.playerId)?.overall.value ?? null,
    };
    const using = ctx?.using ?? FALLBACK;
    let production: PlayerProduction;
    if (lines.unavailable !== null) production = { ...projectProductionWith({ ...input, season: null }, using.model, using.provenance), reason: lines.unavailable };
    else if (leagueId === null) production = { ...projectProductionWith({ ...input, season: null }, using.model, using.provenance), reason: `No club holds him and he has no major-league line to place his league: ${PRODUCTION_PENDING_RATINGS}.` };
    else production = projectProductionWith(input, using.model, using.provenance);
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

/** The last completed season in a league: this season once every game is played, else the one before. */
function completedThrough(leagueId: number, rules: Map<number, LeagueRules>): { season: number | null; current: boolean } {
  const league = rules.get(leagueId);
  const season = league?.contract.season.value ?? null;
  if (!league || season === null) return { season: null, current: false };
  const played = seasonPlayedOf(leagueRecord(leagueId, leagueClubs(leagueId), season, true), league.gamesPerTeam).value;
  return played !== null && played >= 1 ? { season, current: true } : { season: season - 1, current: false };
}

/** The history a fit reads: the league's major-league lines over the window, with each player's birth date and proneness. */
export function productionHistory(leagueId: number, through: number, current: boolean, rules: Map<number, LeagueRules> = allLeagueRules()): FitHistory {
  const gamesPerTeam = rules.get(leagueId)?.gamesPerTeam.value ?? null;
  const seasons = leagueSeasons(leagueId, through, gamesPerTeam).map((s) => (current && s.season === through ? { ...s, scheduleShare: 1 } : s));
  const from = through - PRODUCTION_POLICY.window.maxSeasons - 3;
  const lines = majorLeagueLines(null, from, through, leagueId);
  const ids = [...lines.byPlayer.keys()];
  const ages = ageFacts(ids);
  const prone = readInjuryProneness(ids);
  const players: FitPlayer[] = ids.map((id) => ({
    playerId: id,
    birth: ages.get(id)?.birth ?? null,
    proneness: prone.get(id)?.overall.value ?? null,
    batting: lines.byPlayer.get(id)!.batting,
    pitching: lines.byPlayer.get(id)!.pitching,
  }));
  return { leagueId, throughSeason: through, seasons, players };
}

/**
 * After an import: refit the production model for each league whose export holds a completed season
 * newer than any fit made for it, record the fit per save (adopted only through the gate), and fit
 * nothing when there is none. Called from `runImport` after the import has finished, and never able
 * to fail it. `force` refits even a season already fitted (the developer's harness command).
 */
export function refitProductionIfNeeded(options: { fit?: (history: FitHistory) => FitRun; force?: boolean; leagues?: number[] } = {}): RefitOutcome[] {
  const rules = allLeagueRules();
  const out: RefitOutcome[] = [];
  const candidates = options.leagues ?? marketLeagues();
  for (const leagueId of candidates) {
    const { season: through, current } = completedThrough(leagueId, rules);
    if (through === null) {
      out.push({ leagueId, throughSeason: null, refit: false, adopted: null, reason: "The league's season is not established in the export.", ms: null });
      continue;
    }
    const seasons = leagueSeasons(leagueId, through, rules.get(leagueId)?.gamesPerTeam.value ?? null);
    if (seasons.length === 0) continue; // no major-league results in this league at all: nothing to fit
    if (!options.force && productionFitAttempted(leagueId, through, PRODUCTION_METHOD)) {
      out.push({ leagueId, throughSeason: through, refit: false, adopted: null, reason: `Already fitted through ${through} (${PRODUCTION_METHOD}).`, ms: null });
      continue;
    }
    const start = performance.now();
    const history = productionHistory(leagueId, through, current, rules);
    const run = (options.fit ?? ((h: FitHistory) => fitProductionModel(h, { prior: PRODUCTION_PRIOR })))(history);
    const ms = performance.now() - start;
    recordProductionFit(run, { gameDate: leagueGameDate(leagueId), fitMs: ms, force: options.force });
    out.push({ leagueId, throughSeason: through, refit: true, adopted: run.record.gate.passed, reason: run.record.gate.reason, ms });
  }
  return out;
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
  unit: string;
}

export function productionCalibration(leagueId: number): ProductionCalibration {
  const { provenance } = productionModelFor(leagueId);
  const fit = adoptedProductionFit(leagueId, PRODUCTION_METHOD);
  const last = latestProductionFitAttempt(leagueId, PRODUCTION_METHOD);
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
    unit: PRODUCTION_UNIT,
  };
}
