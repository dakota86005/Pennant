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
import { allLeagueRules, leagueRulesFromRow, type ContractRules, type FinancialRules, type LeagueRules } from './leagueRules.js';
import { evaluateContractControl, superTwoCutoffs } from './playerRights.js';
import { allPlayerStates, playerStates, seasonServiceClocks, serviceClassMembers, type PlayerState } from './playerState.js';
import { CONTROL_HORIZON_SEASONS } from './playerValueCalibration.js';
import {
  CLAUSE_COLUMNS, CONTRACT_COLUMNS, EXTENSION_COLUMNS, contractFactsOf,
  type ContractFacts, type ContractRow, type ContractTables,
} from './playerValueContract.js';
import { composeControlTimeline, type ControlTimeline } from './playerValueControl.js';
import {
  FINANCE_COLUMNS, clubFinancesOf, openingPriceOfWin, replacementLevelOf,
  type ClubFinances, type FinanceTable, type MarketCandidate, type PriceOfWin, type ReplacementLevel,
  type SeasonRecord, type SeasonWar,
} from './playerValueFinances.js';
import { derivedFrom, unknownBecause, type Sourced } from './provenance.js';

export type { ContractFacts, ContractSeason, ContractTerm } from './playerValueContract.js';
export type { ControlSeason, ControlStatus, ControlTimeline, CostBand } from './playerValueControl.js';
export type {
  ClubFinanceInput, ClubFinances, FinanceSeason, FinanceTable, MarketCandidate, MarketStanding, OpeningPriceInput,
  PriceBand, PriceBasis, PriceOfWin, PricePopulation, ReplacementLevel, ReplacementLevelInput, SeasonRecord, SeasonWar,
} from './playerValueFinances.js';
export { clubFinancesOf, marketStandingOf, openingPriceOfWin, replacementLevelOf } from './playerValueFinances.js';

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

/** The clubs that play in a league (all-star sides excluded where the export marks them). */
function leagueClubs(leagueId: number): Set<number> {
  const out = new Set<number>();
  if (!tableExists('teams')) return out;
  const columns = new Set(tableColumns('teams'));
  if (!columns.has('team_id') || !columns.has('league_id')) return out;
  const allStar = columns.has('allstar_team') ? ' AND COALESCE(allstar_team, 0) = 0' : '';
  for (const r of db.prepare(`SELECT team_id FROM teams WHERE league_id = ?${allStar}`).all(leagueId) as Array<{ team_id: unknown }>) {
    const id = numberOrNull(r.team_id);
    if (id !== null) out.add(id);
  }
  return out;
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

/**
 * The league's standings for a season: this season from `team_record`, a past one from
 * `team_history_record`. Games are `g` where exported, else wins plus losses (plus ties).
 */
function leagueRecord(leagueId: number, clubs: Set<number>, season: number, current: boolean): SeasonRecord | null {
  const table = current ? 'team_record' : 'team_history_record';
  if (!tableExists(table)) return null;
  const present = new Set(tableColumns(table));
  if (!present.has('team_id') || !present.has('w')) return null;
  if (!current && !present.has('year')) return null;
  const games = present.has('g') ? 'g' : present.has('l') ? `w + l${present.has('t') ? ' + COALESCE(t, 0)' : ''}` : null;
  if (games === null) return null;
  // A past season names its own league where the export says so; otherwise the club's league today
  const byLeague = !current && present.has('league_id');
  const where = current ? '1 = 1' : byLeague ? 'year = ? AND league_id = ?' : 'year = ?';
  const params = current ? [] : byLeague ? [season, leagueId] : [season];
  const rows = db.prepare(`SELECT team_id, w, ${games} AS games FROM ${table} WHERE ${where}`).all(...params) as
    Array<{ team_id: unknown; w: unknown; games: unknown }>;
  const out: SeasonRecord = { season, clubs: new Set(), wins: 0, games: 0, source: table };
  for (const r of rows) {
    const team = numberOrNull(r.team_id);
    const w = numberOrNull(r.w);
    const g = numberOrNull(r.games);
    if (team === null || w === null || g === null) continue;
    if (!byLeague && !clubs.has(team)) continue;
    out.clubs.add(team);
    out.wins += w;
    out.games += g;
  }
  return out.clubs.size > 0 ? out : null;
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
  const values = valuate(rostered, rostered.map((st) => st.playerId), options);
  const candidates: MarketCandidate[] = [...values.values()].map((v) => ({ playerId: v.playerId, contract: v.contract, control: v.control }));

  const s = season.value;
  const seasons = s === null ? [] : [s - 2, s - 1, s];
  const war = s === null ? { bySeason: new Map<number, SeasonWar>(), unavailable: null } : leagueWar(marketId, seasons);
  const records = new Map<number, SeasonRecord | null>(seasons.map((y) => [y, leagueRecord(marketId, clubs, y, y === s)]));

  const gamesPerTeam = league.gamesPerTeam;
  const now = s === null ? null : records.get(s) ?? null;
  let seasonPlayed: Sourced<number>;
  if (now === null) {
    seasonPlayed = unknownBecause('not_exported_by_ootp', 'team_record.g', "This season's standings are not in the export.");
  } else if (gamesPerTeam.value === null) {
    seasonPlayed = unknownBecause('not_exported_by_ootp', 'leagues.rules_schedule_games_per_team', `The schedule length is not established (${gamesPerTeam.note ?? 'not exported'}).`);
  } else {
    const scheduled = now.clubs.size * gamesPerTeam.value;
    seasonPlayed = derivedFrom(now.games / scheduled, 'team_record.g + leagues.rules_schedule_games_per_team',
      `${now.games} of ${scheduled} team-games played (${now.clubs.size} clubs × ${gamesPerTeam.value}).`);
  }

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
