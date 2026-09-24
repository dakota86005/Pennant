/**
 * Player Value, concern 4: Club Finances, the save's financial reality (PLAYER_VALUE.md Part 2.4).
 *
 * Pure: it is handed rows, rules, Player Rights' answers and the export's WAR, and opens no table.
 * `playerValue.ts` reads them. Three answers live here:
 *
 *   the club's finances      budget, payroll, revenue and expenses, market, fans, cash for trades,
 *                            owner expectation and media contracts, each with its source. Each
 *                            figure comes from the row that names its season (FINANCE_ROW_CALIBRATION),
 *                            and a row whose every money field is zero is a placeholder, read as
 *                            unknown, never $0. A value whose meaning is not established (the market
 *                            scale, the owner-expectation code) is shown as exported and never
 *                            interpreted.
 *   the opening price of a win   salary above the league minimum over WAR, over the contracts that
 *                            are market prices (Part 4.1): a central value, a band that is the
 *                            spread of R-5's bases, and the all-players floor, every assumption
 *                            named. Which contracts are market prices is Player Rights' free-agency
 *                            answer for this season, never a service-time comparison here. A league
 *                            without financials, or without salaries, is valued in wins and its
 *                            dollars are unknown with the reason.
 *   the replacement level    the one the export's own WAR implies, (league wins − league WAR) ÷
 *                            league games, per season (Part 4.3), stamped provisional.
 *
 * Nothing here reads a rating, `players_value`, philosophy, the protection tier or defensibility,
 * and nothing in one import narrows the price: it has no input from earlier imports at all.
 */

import type { CalibrationStamp } from './calibration.js';
import type { FinancialRules } from './leagueRules.js';
import type { ContractFacts } from './playerValueContract.js';
import type { ControlTimeline } from './playerValueControl.js';
import {
  FINANCE_ROW_CALIBRATION, MARKET_CONTRACT_CALIBRATION, OPENING_PRICE_CALIBRATION, OPENING_PRICE_CENTRAL_CALIBRATION,
  OPENING_PRICE_LABEL, OPENING_PRICE_MINIMUMS, OPENING_PRICE_MINIMUMS_CALIBRATION, PLACEHOLDER_ROW_CALIBRATION,
  PRICE_NARROWS_WHEN, REPLACEMENT_LEVEL_CALIBRATION,
} from './playerValueCalibration.js';
import { derivedFrom, fromExport, uninterpreted, unknownBecause, type Sourced, type Uninterpreted } from './provenance.js';

// ── the market: which contracts are market prices ────────────────────────────

/**
 * Where a contract stands against the market, from Player Rights' free-agency answer for this
 * season (service at the last winter, when this season's salary was set):
 *
 *   market               free-agency eligible: the salary was set on the open market
 *   held_below_market    pre-arbitration, arbitration or a reserve clause: held below it by rule
 *   indeterminate        Player Rights cannot say; neither market nor below it
 *   no_rights_answer     no eligibility was asked for (an unsigned player)
 */
export type MarketStanding = 'market' | 'held_below_market' | 'indeterminate' | 'no_rights_answer';

export function marketStandingOf(control: ControlTimeline): MarketStanding {
  const thisSeason = control.eligibility?.seasons[0];
  if (!control.eligibility || !thisSeason) return 'no_rights_answer';
  const status = thisSeason.freeAgency.status;
  return status === 'eligible' ? 'market' : status === 'ineligible' ? 'held_below_market' : 'indeterminate';
}

// ── WAR and standings, as the reader hands them over ─────────────────────────

/** One season of the league's WAR from the export's own tables (R-4). */
export interface SeasonWar {
  season: number;
  /** Each player's WAR that season, batting plus pitching, overall split, summed over clubs. */
  byPlayer: Map<number, number>;
  /** The league's total. */
  total: number;
  /** The clubs whose players have WAR rows that season. */
  clubs: Set<number>;
  source: string;
}

/** One season of the league's standings. */
export interface SeasonRecord {
  season: number;
  clubs: Set<number>;
  wins: number;
  games: number;
  source: string;
}

/**
 * The share of this season's schedule a past season covered, for the price of a win (B-13): its games
 * per club (over the clubs its standings hold) against this season's games per team. Measured against
 * this season's schedule on purpose: the price sets this season's salaries against a season's WAR, so
 * a season is put on this season's footing. Unknown with the reason when either side is not exported.
 */
export function scheduleShareOf(record: SeasonRecord | null, gamesPerTeam: Sourced<number>): Sourced<number> {
  if (record === null || record.clubs.size === 0) return unknownBecause('not_exported_by_ootp', 'team_history_record.g', 'The export has no standings for that season.');
  if (gamesPerTeam.value === null) {
    return unknownBecause('not_exported_by_ootp', 'leagues.rules_schedule_games_per_team', `The schedule length is not established (${gamesPerTeam.note ?? 'not exported'}).`);
  }
  const perClub = record.games / record.clubs.size;
  return derivedFrom(perClub / gamesPerTeam.value, `${record.source}.g + leagues.rules_schedule_games_per_team`,
    `${round(perClub, 1)} games per club in ${record.season} against this season's ${gamesPerTeam.value}.`);
}

// ── replacement level (Part 4.3) ─────────────────────────────────────────────

export interface ReplacementLevelInput {
  season: number;
  /** This season, part-played. */
  toDate: boolean;
  war: SeasonWar | null;
  record: SeasonRecord | null;
}

export interface ReplacementLevel {
  season: number;
  toDate: boolean;
  /** The winning percentage of a replacement team, as the export's WAR assumes it. */
  level: Sourced<number>;
  leagueWins: number | null;
  leagueWar: number | null;
  games: number | null;
  stamp: CalibrationStamp;
}

export function replacementLevelOf(input: ReplacementLevelInput): ReplacementLevel {
  const { season, toDate, war, record } = input;
  const out = (level: Sourced<number>): ReplacementLevel => ({
    season, toDate, level, leagueWins: record?.wins ?? null, leagueWar: war?.total ?? null, games: record?.games ?? null,
    stamp: REPLACEMENT_LEVEL_CALIBRATION,
  });
  if (war === null || war.clubs.size === 0) {
    return out(unknownBecause('not_exported_by_ootp', 'players_career_batting_stats.war', `The export has no WAR for the league in ${season}.`));
  }
  if (record === null || record.clubs.size === 0) {
    return out(unknownBecause('not_exported_by_ootp', record?.source ?? 'team_record', `The export has no standings for the league in ${season}.`));
  }
  const noRecord = [...war.clubs].filter((c) => !record.clubs.has(c)).sort((a, b) => a - b);
  const noWar = [...record.clubs].filter((c) => !war.clubs.has(c)).sort((a, b) => a - b);
  if (noRecord.length > 0 || noWar.length > 0) {
    const parts: string[] = [];
    if (noRecord.length > 0) parts.push(`the ${season} standings lack ${noRecord.length} club${noRecord.length === 1 ? '' : 's'} whose players have WAR (club ${noRecord.join(', ')})`);
    if (noWar.length > 0) parts.push(`${noWar.length} club${noWar.length === 1 ? '' : 's'} in the standings ha${noWar.length === 1 ? 's' : 've'} no WAR rows (club ${noWar.join(', ')})`);
    return out(unknownBecause('not_exported_by_ootp', record.source,
      `Not measured: ${parts.join(', and ')}. A level from the clubs that remain would not be the league's.`));
  }
  if (!(record.games > 0)) {
    return out(unknownBecause('not_exported_by_ootp', record.source, `No games are recorded for ${season}.`));
  }
  const level = (record.wins - war.total) / record.games;
  return out(derivedFrom(level, `${record.source} (wins, games) + ${war.source}`,
    `(league wins ${round(record.wins)} − league WAR ${round(war.total, 1)}) ÷ ${round(record.games)} games${toDate ? ', this season to date' : ''}: the winning percentage of a team of replacement players, as the export's WAR assumes it.`));
}

// ── the opening price of a win (Part 4.1) ────────────────────────────────────

/** A major leaguer on the league's active or injured list: the population the bases draw from (R-5). */
export interface MarketCandidate {
  playerId: number;
  contract: ContractFacts;
  /** The control timeline, carrying Player Rights' eligibility. */
  control: ControlTimeline;
}

export interface OpeningPriceInput {
  leagueId: number;
  /** The league's season; null when not established. */
  season: number | null;
  financials: Sourced<boolean>;
  minimumSalary: Sourced<number>;
  candidates: MarketCandidate[];
  /** The league's WAR by season (prior two seasons and this one); a season absent is not in the export. */
  war: Map<number, SeasonWar>;
  /** The share of this season played, for the pace basis. */
  seasonFraction: Sourced<number>;
  /**
   * The share of this season's schedule each past season covered (its games per club over this
   * season's games per team): a season's WAR prices a full season's salary only in proportion to it.
   * A season absent here has an unknown share and is not assumed full.
   */
  seasonShares: Map<number, Sourced<number>>;
  /** Why the export's WAR cannot be read at all, when it cannot (a table or column missing). */
  warUnavailable?: string | null;
}

export type PriceBasisId = 'A' | 'A2' | 'B' | 'B2' | 'B3' | 'C' | 'C2' | 'C3';

export interface PriceBasis {
  id: PriceBasisId;
  /** A floor (every major leaguer, pay held below the market included) or a market reading. */
  role: 'floor' | 'market';
  description: string;
  /** Players in the basis. */
  players: number;
  /** Players left out because a figure the basis needs is unknown. */
  excluded: number;
  /** Salary above the league minimum, summed. */
  salaryAboveMinimum: number | null;
  /** WAR, summed (the league's total for A2; a pace for the pace bases). */
  wins: number | null;
  /** Dollars per win; unknown with the reason. */
  perWin: Sourced<number>;
}

export interface PriceBand {
  central: number;
  low: number;
  high: number;
}

export interface PricePopulation {
  /** Major leaguers on the league's active or injured lists. */
  majorLeaguers: number;
  /** Of them, a major-league contract with this season's salary exported. */
  withSalary: number;
  /** A minor-league contract, or a salary the export does not state (never $0, Q-5). */
  unknownSalary: number;
  market: number;
  heldBelowMarket: number;
  indeterminate: number;
  noRightsAnswer: number;
  /** Market contracts whose first season is this one. */
  marketStartingThisSeason: number;
}

export interface PriceOfWin {
  leagueId: number;
  season: number | null;
  label: string;
  stage: 'opening';
  /** Dollars per win, or wins only when dollars are unknown. */
  unit: 'dollars_per_win' | 'wins';
  price: Sourced<PriceBand>;
  floor: Sourced<{ low: number; high: number }>;
  bases: PriceBasis[];
  /** Bases R-5 lists that are not used, and why. */
  notUsed: string[];
  population: PricePopulation;
  assumptions: string[];
  rules: { market: string; band: string; central: string; floor: string; minimums: string };
  narrowsWhen: string;
  stamps: { market: CalibrationStamp; bases: CalibrationStamp; central: CalibrationStamp; minimums: CalibrationStamp };
}

const round = (n: number, digits = 0): string => n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const millions = (n: number): string => `$${(n / 1_000_000).toFixed(2)}M`;

interface Row {
  playerId: number;
  standing: MarketStanding;
  salary: number | null;
  averageAnnual: number | null;
  startsThisSeason: boolean;
}

function rowOf(c: MarketCandidate, season: number | null): Row {
  const standing = marketStandingOf(c.control);
  const term = c.contract.term;
  const major = c.contract.kind.value === 'major_league';
  const salary = major && season !== null ? term?.seasons.find((s) => s.season === season)?.salary.value ?? null : null;
  let averageAnnual: number | null = null;
  if (major && term && term.seasons.length > 0 && term.seasons.every((s) => s.salary.value !== null)) {
    averageAnnual = term.seasons.reduce((sum, s) => sum + (s.salary.value as number), 0) / term.seasons.length;
  }
  return { playerId: c.playerId, standing, salary, averageAnnual, startsThisSeason: season !== null && term?.firstSeason.value === season };
}

/** Salary above the minimum over wins, for one population. */
function basisOf(
  id: PriceBasisId, role: PriceBasis['role'], description: string, rows: Row[], minimum: number,
  money: (r: Row) => number | null, wins: ((r: Row) => number) | { unknown: string }, leagueWins?: number
): PriceBasis {
  const kept = rows.filter((r) => money(r) !== null);
  const excluded = rows.length - kept.length;
  const base = { id, role, description, players: kept.length, excluded };
  if ('unknown' in (wins as object)) {
    return { ...base, salaryAboveMinimum: null, wins: null, perWin: unknownBecause('not_exported_by_ootp', null, (wins as { unknown: string }).unknown) };
  }
  if (kept.length === 0) {
    return { ...base, salaryAboveMinimum: null, wins: null, perWin: unknownBecause('not_exported_by_ootp', null, 'No player in this population has the salary this basis needs.') };
  }
  if (kept.length < OPENING_PRICE_MINIMUMS.contracts) {
    return {
      ...base, salaryAboveMinimum: null, wins: null,
      perWin: unknownBecause('not_exported_by_ootp', null,
        `Not computed: ${kept.length} contract${kept.length === 1 ? '' : 's'} with the salary this basis needs, fewer than the policy minimum of ${OPENING_PRICE_MINIMUMS.contracts} (a basis on so few differs from another by who is in it, not by what it measures).`),
    };
  }
  const above = kept.reduce((sum, r) => sum + ((money(r) as number) - minimum), 0);
  const w = leagueWins ?? kept.reduce((sum, r) => sum + (wins as (r: Row) => number)(r), 0);
  if (!(w > 0)) {
    return { ...base, salaryAboveMinimum: above, wins: w, perWin: unknownBecause('not_exported_by_ootp', null, 'This population produced no positive WAR, so it prices no win.') };
  }
  return {
    ...base, salaryAboveMinimum: above, wins: w,
    perWin: derivedFrom(above / w, 'players_contract (this season\'s salary) + players_career_*_stats.war',
      `${millions(above)} above the minimum ÷ ${round(w, 1)} WAR, ${kept.length} players${excluded > 0 ? ` (${excluded} left out: a figure is not exported)` : ''}.`),
  };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export function openingPriceOfWin(input: OpeningPriceInput): PriceOfWin {
  const { season } = input;
  const rows = input.candidates.map((c) => rowOf(c, season));
  const population: PricePopulation = {
    majorLeaguers: rows.length,
    withSalary: rows.filter((r) => r.salary !== null).length,
    unknownSalary: rows.filter((r) => r.salary === null).length,
    market: rows.filter((r) => r.standing === 'market').length,
    heldBelowMarket: rows.filter((r) => r.standing === 'held_below_market').length,
    indeterminate: rows.filter((r) => r.standing === 'indeterminate').length,
    noRightsAnswer: rows.filter((r) => r.standing === 'no_rights_answer').length,
    marketStartingThisSeason: rows.filter((r) => r.standing === 'market' && r.startsThisSeason).length,
  };
  const fraction = input.seasonFraction.value;
  const assumptions = [
    "WAR is the export's own WAR (OOTP's formula), batting plus pitching, the overall split, the league's own rows summed over clubs (R-4).",
    "Salary is this season's contract salary. Signing bonuses, incentives, buyouts and deferrals are not in it (R-6). A minor-league contract's salary is unknown, never $0 (Q-5), and it is left out.",
    'A market contract is one whose holder Player Rights finds free-agency eligible this season, by service at the last winter when the salary was set. ' +
      "The alternative, service including this season's days (R-5's reading), would also count players who crossed the line this season, whose salaries were set before they could reach the market; it is not used.",
    "A replacement player is paid the league minimum and is worth 0 WAR, at the export's own replacement level (see the replacement level for each season).",
    'Prior-season WAR stands in for the production a salary was paid for. A market pays for expected wins and the best players regress, so a first-year basis understates the price of a multi-year deal.',
    'A player with no line in the league in a season produced no WAR in it and counts 0, while his salary stays in; that raises the price for players signed from outside the league.',
    'The contracts are the ones the export holds. On a historical start they are the real world\'s, so the price describes that market and gives way to OOTP\'s simulated signings as they are observed (R-1).',
    fraction !== null
      ? `The pace bases rest on ${round(fraction * 100, 1)}% of a season and are the widest.`
      : 'The pace bases need the share of the season played, which is not established here.',
    `A season's WAR prices a full season's salary in proportion to the schedule it covered: a short season (a strike, a 60-game season) is scaled to this season's schedule, never read as a full one, and a season, or this season's pace, covering less than ${round(OPENING_PRICE_MINIMUMS.seasonShare * 100)}% of the schedule is not used (the policy minimum). A season whose share is not established is not assumed full.`,
    `A basis rests on at least ${OPENING_PRICE_MINIMUMS.contracts} contracts (the policy minimum); a thinner one is not computed.`,
  ];
  const result = (price: Sourced<PriceBand>, floor: Sourced<{ low: number; high: number }>, bases: PriceBasis[], unit: PriceOfWin['unit']): PriceOfWin => ({
    leagueId: input.leagueId,
    season,
    label: OPENING_PRICE_LABEL,
    stage: 'opening',
    unit,
    price,
    floor,
    bases,
    notUsed: [
      "R-5's basis D (free-agency contracts signed three or more seasons ago, against this season's pace) is not used: it prices the decline years of long contracts, wins a club bought years ago, and is a ceiling artefact.",
    ],
    population,
    assumptions,
    rules: {
      market: MARKET_CONTRACT_CALIBRATION.basis,
      band: 'The band runs from the lowest to the highest market basis that could be computed: the spread of defensible bases, not a statistical interval (R-5). One reading is not a band.',
      central: OPENING_PRICE_CENTRAL_CALIBRATION.basis,
      floor: 'The floor divides every major leaguer\'s pay above the minimum by his WAR (A), and by the league\'s WAR (A2). Pre-arbitration and arbitration pay is held below the market by rule, so it understates what a win costs on the open market.',
      minimums: OPENING_PRICE_MINIMUMS_CALIBRATION.basis,
    },
    narrowsWhen: PRICE_NARROWS_WHEN,
    stamps: {
      market: MARKET_CONTRACT_CALIBRATION, bases: OPENING_PRICE_CALIBRATION, central: OPENING_PRICE_CENTRAL_CALIBRATION,
      minimums: OPENING_PRICE_MINIMUMS_CALIBRATION,
    },
  });

  // Dollars exist only where the league runs finances, states its minimum and its season
  const noDollars = (why: string): PriceOfWin => {
    const u = <T>() => unknownBecause<T>('not_exported_by_ootp', input.financials.source, why);
    return result(u(), u(), [], 'wins');
  };
  if (input.financials.value === false) {
    return noDollars('The league runs no financials (rules_financials = 0): value is in wins, and dollars are unknown.');
  }
  if (input.financials.value === null) {
    return noDollars(`Whether the league runs financials is not established (${input.financials.note ?? 'rules_financials is not exported'}): value is in wins, and dollars are unknown.`);
  }
  if (input.minimumSalary.value === null || season === null) {
    return noDollars(season === null
      ? "The league's season is not established, so this season's salaries cannot be read: value is in wins, and dollars are unknown."
      : `The league minimum salary is not established (${input.minimumSalary.note ?? 'not exported'}), so salary above the minimum cannot be stated: value is in wins, and dollars are unknown.`);
  }
  const minimum = input.minimumSalary.value;

  const prior = input.war.get(season - 1) ?? null;
  const twoBack = input.war.get(season - 2) ?? null;
  const now = input.war.get(season) ?? null;
  type Wins = ((r: Row) => number) | { unknown: string };
  const pct = (share: number) => `${round(share * 100)}%`;
  const missing = (y: number): Wins => ({ unknown: input.warUnavailable ?? `The export has no WAR for the league in ${y}.` });
  /**
   * A season's WAR on this season's footing: each player's WAR divided by the share of this season's
   * schedule it covered, both ways (a 60-game season under a 162-game schedule is scaled up; a
   * 162-game season before a league shortened its schedule to 60 is scaled down), and not used below
   * the policy minimum share (B-13). An unknown share is not assumed full.
   */
  const footing = (y: number, w: SeasonWar | null, share: Sourced<number> | undefined, what: string): { wins: Wins; share: number | null } => {
    if (w === null) return { wins: missing(y), share: null };
    const s = share?.value ?? null;
    if (s === null || !(s > 0)) {
      return {
        wins: { unknown: `The share of the schedule ${what} is not established (${share?.note ?? `no standings for ${y}`}), so its WAR cannot be put on a full season's footing, and it is not assumed full.` },
        share: null,
      };
    }
    if (s < OPENING_PRICE_MINIMUMS.seasonShare) {
      return {
        wins: { unknown: `Not used: ${what} is ${pct(s)} of the schedule, under the policy minimum of ${pct(OPENING_PRICE_MINIMUMS.seasonShare)}; a WAR scaled from so little is more noise than price.` },
        share: s,
      };
    }
    return { wins: (r: Row) => (w.byPlayer.get(r.playerId) ?? 0) / s, share: s };
  };
  // Named where the scaling shows at the precision printed (a rain-out or two rounds to 100%)
  const scaledFrom = (share: number | null) => (share !== null && pct(share) !== pct(1) ? `, scaled from ${pct(share)} of this season's schedule` : '');
  const priorSeason = footing(season - 1, prior, input.seasonShares.get(season - 1), `${season - 1} covered`);
  const twoBackSeason = footing(season - 2, twoBack, input.seasonShares.get(season - 2), `${season - 2} covered`);
  const priorWins = priorSeason.wins;
  const twoSeasonWins: Wins = 'unknown' in priorSeason.wins
    ? priorSeason.wins
    : 'unknown' in twoBackSeason.wins
      ? twoBackSeason.wins
      : ((a: (r: Row) => number, b: (r: Row) => number) => (r: Row) => (a(r) + b(r)) / 2)(priorSeason.wins, twoBackSeason.wins);
  const paceWins: Wins = now === null
    ? missing(season)
    : fraction === null || !(fraction > 0)
      ? { unknown: `The share of ${season} played is not established (${input.seasonFraction.note ?? 'not exported'}), so there is no pace.` }
      : footing(season, now, input.seasonFraction, `the share of ${season} played`).wins;
  const priorLabel = `${season - 1} WAR${scaledFrom(priorSeason.share)}`;
  const twoSeasonLabel = `mean of ${season - 2} WAR${scaledFrom(twoBackSeason.share)} and ${season - 1} WAR${scaledFrom(priorSeason.share)}`;
  // The league's whole prior-season WAR, on the same footing, for the second floor
  const leaguePriorWins = prior !== null && priorSeason.share !== null && !('unknown' in priorSeason.wins)
    ? prior.total / priorSeason.share
    : null;

  const salaryNow = (r: Row) => r.salary;
  const market = rows.filter((r) => r.standing === 'market');
  const signed = market.filter((r) => r.startsThisSeason);
  const bases: PriceBasis[] = [
    basisOf('A', 'floor', `Every major leaguer on the league's active or injured lists, ${priorLabel}`, rows, minimum, salaryNow, priorWins),
    leaguePriorWins !== null
      ? basisOf('A2', 'floor', `The same salaries, over the league's whole ${priorLabel}`, rows, minimum, salaryNow, () => 0, leaguePriorWins)
      : basisOf('A2', 'floor', `The same salaries, over the league's whole ${priorLabel}`, rows, minimum, salaryNow, priorWins),
    basisOf('B', 'market', `Free-agency eligible this season, ${priorLabel}`, market, minimum, salaryNow, priorWins),
    basisOf('B2', 'market', `Free-agency eligible this season, ${twoSeasonLabel}`, market, minimum, salaryNow, twoSeasonWins),
    basisOf('B3', 'market', `Free-agency eligible this season, ${season} pace (to date ÷ share of season played)`, market, minimum, salaryNow, paceWins),
    basisOf('C', 'market', `Free-agency eligible, contracts starting ${season}: this season's salary, ${priorLabel}`, signed, minimum, salaryNow, priorWins),
    basisOf('C2', 'market', `Free-agency eligible, contracts starting ${season}: average annual value, ${priorLabel}`, signed, minimum, (r) => r.averageAnnual, priorWins),
    basisOf('C3', 'market', `Free-agency eligible, contracts starting ${season}: this season's salary, ${season} pace`, signed, minimum, salaryNow, paceWins),
  ];

  const floors = bases.filter((b) => b.role === 'floor' && b.perWin.value !== null).map((b) => b.perWin.value as number);
  const floor: Sourced<{ low: number; high: number }> = floors.length > 0
    ? derivedFrom({ low: Math.min(...floors), high: Math.max(...floors) }, 'bases A and A2', 'Every major leaguer\'s pay above the minimum over WAR: a floor, because pay held below the market by rule is in it.')
    : unknownBecause('not_exported_by_ootp', null, `No floor basis could be computed: ${bases.filter((b) => b.role === 'floor').map((b) => b.perWin.note).join(' ')}`);

  const readings = bases.filter((b) => b.role === 'market' && b.perWin.value !== null).map((b) => b.perWin.value as number);
  let price: Sourced<PriceBand>;
  if (population.market === 0) {
    const why = population.indeterminate > 0
      ? `Player Rights cannot establish free-agency eligibility for ${population.indeterminate} of them`
      : 'no player on the league\'s rosters is free-agency eligible (a reserve clause, or nobody has the service)';
    price = unknownBecause('not_exported_by_ootp', null, `No contract is a market price: ${why}. Value is in wins, and dollars are unknown.`);
  } else if (market.every((r) => r.salary === null)) {
    price = unknownBecause('not_exported_by_ootp', null, `None of the ${population.market} market contracts has this season's salary exported (a minor-league deal or a salary of 0 is unknown, never $0): value is in wins, and dollars are unknown.`);
  } else if (readings.length === 0) {
    price = unknownBecause('not_exported_by_ootp', null, `No market basis could be computed: ${[...new Set(bases.filter((b) => b.role === 'market').map((b) => b.perWin.note))].join(' ')}`);
  } else if (Math.min(...readings) === Math.max(...readings)) {
    price = unknownBecause('not_exported_by_ootp', null, `Only one market reading could be computed (${millions(readings[0])} a win), and one reading is not a band. The price stays unknown rather than a point.`);
  } else {
    const band = { central: median(readings), low: Math.min(...readings), high: Math.max(...readings) };
    price = derivedFrom(band, 'market bases B to C3',
      `Median of ${readings.length} market bases, band from the lowest to the highest (${millions(band.low)} to ${millions(band.high)}); ${population.market} market contracts.`);
  }
  const dollarsKnown = price.value !== null || floor.value !== null;
  return result(price, floor, bases, dollarsKnown ? 'dollars_per_win' : 'wins');
}

// ── the club's finances ──────────────────────────────────────────────────────

/** A table as the reader found it: its columns (null when it is not in the export) and this club's row. */
export interface FinanceTable {
  present: Set<string> | null;
  row: Record<string, unknown> | null;
}

export interface ClubFinanceInput {
  teamId: number;
  /** The league's season (the regime's); null when not established. */
  season: number | null;
  /** Whether the club's league runs financials (`rules_financials`, the regime's); money is not in dollars when it does not. */
  financials: Sourced<boolean>;
  /** `team_financials` */
  current: FinanceTable;
  /** `team_last_financials` */
  last: FinanceTable;
  /** `team_history_financials`, this club's rows. */
  history: { present: Set<string> | null; rows: Array<Record<string, unknown>> };
}

export interface FinanceSeason {
  season: number;
  revenue: Sourced<number>;
  expenses: Sourced<number>;
  budget: Sourced<number>;
}

export interface ClubFinances {
  teamId: number;
  season: number | null;
  authority: { rule: string; alternatives: string[]; stamp: CalibrationStamp };
  budget: Sourced<number>;
  payroll: {
    now: Sourced<number>;
    /** OOTP's own estimate of next season's payroll. */
    nextSeason: Sourced<number>;
    offered: Sourced<number>;
  };
  /** This season; which current-row columns are season-to-date is not established (R-7). */
  revenue: Sourced<number>;
  expenses: Sourced<number>;
  market: Uninterpreted<number>;
  fans: { interest: Sourced<number>; loyalty: Sourced<number> };
  /** `cash_trades_available`, never the dead `cash`. */
  cashForTrades: Sourced<number>;
  ownerExpectation: Uninterpreted<number>;
  mode: Uninterpreted<number>;
  media: {
    local: Sourced<number>;
    localExpires: Uninterpreted<number>;
    national: Sourced<number>;
    nationalExpires: Uninterpreted<number>;
  };
  /** Zero in the current row though the rules are on; they may settle at season end (R-7). */
  sharing: { revenueSharing: Uninterpreted<number>; luxurySharing: Uninterpreted<number> };
  /** Last season, from the history row that names it; `team_last_financials` beside it, not used. */
  lastSeason: FinanceSeason & { unnamedView: { revenue: Sourced<number>; expenses: Sourced<number>; used: false; note: string } } | null;
  /** Past seasons with figures; placeholder rows are counted, not listed. */
  revenueTrend: {
    seasons: FinanceSeason[];
    placeholderSeasons: { count: number; first: number | null; last: number | null; note: string };
    stamp: CalibrationStamp;
  };
}

/** Every money column the export's financial rows carry; a row with all of them zero is a placeholder. */
const MONEY_COLUMNS = [
  'gate_revenue', 'gate_share_gained', 'gate_share_lost', 'season_ticket_revenue', 'media_revenue', 'merchandising_revenue',
  'revenue_sharing', 'luxury_sharing', 'playoff_revenue', 'cash', 'cash_owner', 'cash_trades', 'previous_balance',
  'player_expenses', 'staff_expenses', 'stadium_expenses', 'local_media_contract', 'national_media_contract',
  'scouting_budget', 'development_budget', 'draft_budget', 'draft_expenses', 'intl_fa_budget', 'spent_in_intl',
  'budget', 'total_revenue', 'total_expenses', 'financial_balance', 'budget_balance', 'player_payroll',
  'player_payroll_next_season', 'player_payroll_offered', 'cash_trades_available',
] as const;

/** Columns the club answer reads, so the reader can select only those present. */
export const FINANCE_COLUMNS = [
  'team_id', 'year', ...MONEY_COLUMNS, 'market', 'owner_expectation', 'mode', 'fan_interest', 'fan_loyalty',
  'local_media_contract_expires', 'national_media_contract_expires',
] as const;

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const PLACEHOLDER_NOTE = 'Every money field in this row is zero: the export wrote the row without figures, so it is unknown, never $0 (R-1).';

function isPlaceholder(row: Record<string, unknown>, present: Set<string>): boolean {
  const money = MONEY_COLUMNS.filter((c) => present.has(c));
  return money.length > 0 && money.every((c) => numberOrNull(row[c]) === 0);
}

function financeReader(table: string, t: FinanceTable | { present: Set<string> | null; row: Record<string, unknown> | null }) {
  const placeholder = t.present !== null && t.row !== null && isPlaceholder(t.row, t.present);
  return (column: string, note?: string): Sourced<number> => {
    const source = `${table}.${column}`;
    if (t.present === null) return unknownBecause('source_unavailable', source, `${table} is not in the export.`);
    if (t.row === null) return unknownBecause('not_exported_by_ootp', source, `${table} has no row for this club.`);
    if (!t.present.has(column)) return unknownBecause('not_exported_by_ootp', source, `${table} has no ${column} column.`);
    if (placeholder) return unknownBecause('not_exported_by_ootp', source, PLACEHOLDER_NOTE);
    const n = numberOrNull(t.row[column]);
    if (n === null) return unknownBecause('not_exported_by_ootp', source, `${column} is blank in the export.`);
    return note ? { ...fromExport(n, source), note } : fromExport(n, source);
  };
}

const SEASON_TO_DATE = 'Which current-row columns are season-to-date and which are booked for the season is not established column by column (R-7).';

/**
 * Club money in a league that runs no financials is not in dollars (D-052): the export may still
 * carry figures, and they are not read (D-017). Where whether it runs financials is not established,
 * a figure stays as exported and says so.
 */
function moneyUnder(financials: Sourced<boolean>) {
  const off = `The league runs no financials (rules_financials = 0): club money is not in dollars, and the figure the export still carries is not read.`;
  const unsure = `Whether the league runs financials is not established (${financials.note ?? 'rules_financials is not exported'}).`;
  return (figure: Sourced<number>): Sourced<number> => {
    if (financials.value === false) return unknownBecause('not_exported_by_ootp', figure.source, off);
    if (financials.value === null && figure.value !== null) return { ...figure, note: figure.note ? `${figure.note} ${unsure}` : unsure };
    return figure;
  };
}

export function clubFinancesOf(input: ClubFinanceInput): ClubFinances {
  const { season } = input;
  const money = moneyUnder(input.financials);
  const exported = financeReader('team_financials', input.current);
  // Money figures pass through the league's financial regime; scales and codes are read as exported
  const now = (column: string, note?: string) => money(exported(column, note));
  const raw = (column: string, why: string) => uninterpreted(exported(column), why);
  const history = input.history.present === null
    ? []
    : input.history.rows
      .map((row) => ({ row, year: numberOrNull(row.year) }))
      .filter((h): h is { row: Record<string, unknown>; year: number } => h.year !== null)
      .sort((a, b) => a.year - b.year);
  const seasonOf = (h: { row: Record<string, unknown>; year: number }): FinanceSeason => {
    const read = financeReader('team_history_financials', { present: input.history.present, row: h.row });
    return { season: h.year, revenue: money(read('total_revenue')), expenses: money(read('total_expenses')), budget: money(read('budget')) };
  };
  const placeholders = history.filter((h) => isPlaceholder(h.row, input.history.present as Set<string>));
  const withFigures = history.filter((h) => !isPlaceholder(h.row, input.history.present as Set<string>));

  let lastSeason: ClubFinances['lastSeason'] = null;
  if (season !== null) {
    const lastRow = history.find((h) => h.year === season - 1);
    const view = financeReader('team_last_financials', input.last);
    const revenueView = money(view('total_revenue'));
    const expensesView = money(view('total_expenses'));
    const s: FinanceSeason = lastRow
      ? seasonOf(lastRow)
      : (() => {
        const u = unknownBecause<number>('not_exported_by_ootp', 'team_history_financials', `team_history_financials has no ${season - 1} row for this club.`);
        return { season: season - 1, revenue: u, expenses: u, budget: u };
      })();
    const differs = s.revenue.value !== null && revenueView.value !== null && s.revenue.value !== revenueView.value;
    lastSeason = {
      ...s,
      unnamedView: {
        revenue: revenueView, expenses: expensesView, used: false,
        note: differs
          ? `team_last_financials reads revenue ${millions(revenueView.value as number)} against the ${season - 1} history row's ${millions(s.revenue.value as number)}. It names no season, so it is not used; which is authoritative is unresolved (R-7).`
          : 'team_last_financials names no season, so it is not used (R-7).',
      },
    };
  }

  const MEANING = 'Shown as exported: its scale or code meanings are not in the export (R-7).';
  return {
    teamId: input.teamId,
    season,
    authority: {
      rule: FINANCE_ROW_CALIBRATION.basis,
      alternatives: [
        'team_last_financials: a previous-season view that names no season; it disagrees with the history row for the same clubs (R-7).',
        'Blending the rows (an average, or one column from each): rejected, because it would state a figure no row holds.',
      ],
      stamp: FINANCE_ROW_CALIBRATION,
    },
    budget: now('budget'),
    payroll: {
      now: now('player_payroll'),
      nextSeason: now('player_payroll_next_season', "OOTP's own estimate of next season's payroll."),
      offered: now('player_payroll_offered'),
    },
    revenue: now('total_revenue', SEASON_TO_DATE),
    expenses: now('total_expenses', SEASON_TO_DATE),
    market: raw('market', MEANING),
    fans: { interest: exported('fan_interest', "OOTP's own scale, as exported."), loyalty: exported('fan_loyalty', "OOTP's own scale, as exported.") },
    cashForTrades: now('cash_trades_available', 'The cash a club can move in trades; `cash` is exported as zero for every club and is never read (R-7).'),
    ownerExpectation: raw('owner_expectation', "Shown as the exported code: the code meanings are not in the export (R-7)."),
    mode: raw('mode', MEANING),
    media: {
      local: now('local_media_contract'),
      localExpires: raw('local_media_contract_expires', 'Shown as exported: whether it counts seasons left or names a season is not established.'),
      national: now('national_media_contract'),
      nationalExpires: raw('national_media_contract_expires', 'Shown as exported: whether it counts seasons left or names a season is not established.'),
    },
    sharing: {
      revenueSharing: raw('revenue_sharing', 'Zero while the rule is on: it may settle at season end. Not established (R-7).'),
      luxurySharing: raw('luxury_sharing', 'Zero while the rule is on: it may settle at season end. Not established (R-7).'),
    },
    lastSeason,
    revenueTrend: {
      seasons: withFigures.map(seasonOf),
      placeholderSeasons: {
        count: placeholders.length,
        first: placeholders[0]?.year ?? null,
        last: placeholders[placeholders.length - 1]?.year ?? null,
        note: placeholders.length > 0
          ? `${placeholders.length} season${placeholders.length === 1 ? '' : 's'} in team_history_financials carry no figures (every money field zero) and are unknown, never $0. The trend grows from Pennant's own per-import snapshots.`
          : 'Every history row carries figures.',
      },
      stamp: PLACEHOLDER_ROW_CALIBRATION,
    },
  };
}

/** The league's financial regime, as the one `LeagueRules` reads it (resolved through the parent league). */
export type FinancialRegime = FinancialRules;
