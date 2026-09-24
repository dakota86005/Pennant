import { leagueRulesFromRow, type ContractRules, type LeagueRuleRow } from '../server/leagueRules';
import type { PlayerState } from '../server/playerState';
import { evaluateContractControl, superTwoCutoffs, type SuperTwoCutoff } from '../server/playerRights';
import type { SourceState } from '../server/dataFreshness';
import {
  CONTRACT_COLUMNS, EXTENSION_COLUMNS, contractFactsOf, type ContractFacts, type ContractRow, type ContractTables,
} from '../server/playerValueContract';
import { composeControlTimeline, type ControlTimeline } from '../server/playerValueControl';
import { CONTROL_HORIZON_SEASONS } from '../server/playerValueCalibration';
import { derivedFrom, fromExport, unknownBecause, type Sourced } from '../server/provenance';

/*
 * Synthetic contracts, service times and league rows for the Player Value cases. Built through the
 * pure functions that own each answer (contractFactsOf, evaluateContractControl,
 * composeControlTimeline), never a real save. The numbers are shaped like the imported league
 * (R-2, R-3, R-6) only so a reader recognises them; each case states its own.
 */

export const THIS_SEASON = 2030;
/** The service-year length the synthetic major league exports. */
export const YEAR = 172;
export const MLB = 203;

const known = <T>(value: T, source = 'test'): Sourced<T> => fromExport(value, source);
const blank = <T>(): Sourced<T> => unknownBecause<T>('not_exported_by_ootp', 'test', 'blank');

/** A major league's row, as the export writes it (a root: parent 0). */
export function majorLeagueRow(over: Partial<Record<string, number | null>> = {}): LeagueRuleRow {
  return {
    league_id: MLB, parent_league_id: 0, season_year: THIS_SEASON, rules_financials: 1,
    rules_fa_minimum_years: 6, rules_salary_arbitration_minimum_years: 3, rules_minor_league_fa_minimum_years: 6,
    rules_minimum_salary: 780_000, rules_min_service_days: YEAR, financial_coefficient: 1, ...over,
  };
}

/** A minor league as the export writes it: every contract rule 0, and a parent. */
export function minorLeagueRow(id = 204, parent: number | null = MLB): LeagueRuleRow {
  return {
    league_id: id, parent_league_id: parent, season_year: THIS_SEASON, rules_financials: 0,
    rules_fa_minimum_years: 0, rules_salary_arbitration_minimum_years: 0, rules_minor_league_fa_minimum_years: 0,
    rules_minimum_salary: 0, rules_min_service_days: YEAR, financial_coefficient: 1,
  };
}

/**
 * The contract regime of `leagueId`, read from `rows` as the reader would; a row with a column set
 * to `undefined` is exported without it (the column is absent from the table).
 */
export function regimeOf(leagueId: number, rows: LeagueRuleRow[]): ContractRules {
  const present = new Set<string>();
  for (const row of rows) for (const [k, v] of Object.entries(row)) if (v !== undefined) present.add(k);
  const byId = new Map(rows.map((r) => [r.league_id as number, r]));
  return leagueRulesFromRow(byId.get(leagueId) ?? null, present, (id) => byId.get(id) ?? null).contract;
}

/** The synthetic major league's regime, with any rule overridden (null: blank; undefined: column absent). */
export function mlbRules(over: Partial<Record<string, number | null | undefined>> = {}): ContractRules {
  const row: Record<string, unknown> = { ...majorLeagueRow() };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete row[k];
    else row[k] = v;
  }
  return regimeOf(MLB, [row as LeagueRuleRow]);
}

export interface ServiceSpec {
  /** mlb_service_days, this season's included; null when not exported. */
  days?: number | null;
  /** mlb_service_years; null when not exported. Defaults to floor(days / YEAR). */
  years?: number | null;
  /** mlb_service_days_this_year; null when not exported. */
  thisYear?: number | null;
  teamId?: number;
  /** `teams.level` of his club (1 is the majors). */
  level?: number;
  /** On the major-league injured list (`is_on_dl`), and on its 60-day list (`is_on_dl60`). */
  onIl?: boolean;
  onIl60?: boolean;
  /** `injury_dl_left`: days left on his injured-list stint; null when not exported. */
  ilDaysLeft?: number | null;
}

export function stateOf(spec: ServiceSpec = {}): PlayerState {
  const pick = <T>(v: T | null | undefined, fallback: T): Sourced<T> =>
    v === null ? blank<T>() : known(v === undefined ? fallback : v);
  const days = spec.days === undefined ? 2 * YEAR : spec.days;
  const years = spec.years === undefined ? (days === null ? null : Math.floor(days / YEAR)) : spec.years;
  return {
    playerId: 1, name: 'Test Player', age: 27,
    organizationId: known(1), teamId: known(spec.teamId ?? 1), level: known(spec.level ?? 1),
    position: known(6), role: known(0),
    activeRoster: known(!(spec.onIl || spec.onIl60) && (spec.level ?? 1) === 1), fortyMan: known(!spec.onIl60),
    injuredList: { onIl: known(!!(spec.onIl || spec.onIl60)), onIl60: known(!!spec.onIl60) },
    injury: {
      injured: known(!!(spec.onIl || spec.onIl60)), dayToDay: known(false), daysLeft: known(0),
      ilDaysLeft: pick(spec.ilDaysLeft, 0), careerEnding: known(false),
    },
    dfa: {
      designated: known(false), daysLeft: known(0), onWaivers: known(false), waiverDaysLeft: known(0),
      irrevocableWaivers: known(false),
    },
    serviceTime: {
      mlbYears: pick(years, 0), mlbDays: pick(days, 0), mlbDaysThisSeason: pick(spec.thisYear, 40),
      professionalYears: known(6), professionalDays: known(0),
    },
    options: { used: known(0), usedThisYear: known(0), yearsProtectedFromRule5: known(4) },
    contract: { majorLeague: known(true) },
    wasTraded: known(false),
    health: derivedFrom(null, 'test'),
    standing: derivedFrom('active' as PlayerState['standing']['value'], 'test'),
  } as PlayerState;
}

export interface ContractSpec {
  firstSeason?: number;
  years?: number;
  /** One salary for every season, or one per season. */
  salary?: number | number[];
  isMajor?: 0 | 1;
  teamOption?: 0 | 1;
  playerOption?: 0 | 1;
  vestingOption?: 0 | 1;
  buyout?: number;
  noTrade?: 0 | 1;
  retained?: 0 | 1;
  teamId?: number;
  /** `contract_team_id` when it differs from the club (0: the blank row's). */
  contractTeam?: number;
  /** `current_year`: contract years completed. */
  currentYear?: number;
  /** `opt_out`: exported as a count. */
  optOut?: number;
}

export function contractRow(spec: ContractSpec = {}): ContractRow {
  const years = spec.years ?? 1;
  // Only `undefined` takes the default: a blank row writes 0 years
  const row: ContractRow = {
    player_id: 1, team_id: spec.teamId ?? 1, contract_team_id: spec.contractTeam ?? spec.teamId ?? 1, is_major: spec.isMajor ?? 1,
    season_year: spec.firstSeason ?? THIS_SEASON, years, current_year: spec.currentYear ?? 0,
    no_trade: spec.noTrade ?? 0, last_year_team_option: spec.teamOption ?? 0,
    last_year_player_option: spec.playerOption ?? 0, last_year_vesting_option: spec.vestingOption ?? 0,
    last_year_option_buyout: spec.buyout ?? 0, retained: spec.retained ?? 0, opt_out: spec.optOut ?? 0,
    minimum_pa: 0, minimum_pa_bonus: 0, minimum_ip: 0, minimum_ip_bonus: 0, mvp_bonus: 0, cyyoung_bonus: 0, allstar_bonus: 0,
  };
  for (let i = 0; i < 15; i += 1) {
    const salary = Array.isArray(spec.salary) ? spec.salary[i] ?? 0 : spec.salary ?? 5_000_000;
    row[`salary${i}`] = i < years ? salary : 0;
  }
  return row;
}

/**
 * The export's tables. `populated` lists the clause columns with a non-zero value somewhere in the
 * export; by default the ones the imported save populates (options, opt-outs, incentives), and not
 * no-trade, buyout or retained salary (R-6).
 */
export function tablesOf(populated: string[] = [
  'last_year_team_option', 'last_year_player_option', 'opt_out', 'minimum_pa', 'minimum_pa_bonus', 'mvp_bonus', 'cyyoung_bonus',
]): ContractTables {
  return { contract: new Set(CONTRACT_COLUMNS), extension: new Set(EXTENSION_COLUMNS), populated: new Set(populated) };
}

export function factsOf(row: ContractRow | null, opts: { extension?: ContractRow | null; tables?: ContractTables; teamId?: number } = {}): ContractFacts {
  return contractFactsOf(1, known(opts.teamId ?? 1), row, opts.extension ?? null, opts.tables ?? tablesOf());
}

export interface TimelineSpec {
  state?: PlayerState;
  rules?: ContractRules;
  contract?: ContractFacts;
  /** The season's service clock; null when not exported. Defaults to 40 days run. */
  clock?: number | null;
  currentState?: SourceState;
  /**
   * The league's service class, for the Super Two cutoff: every held player's service now and this
   * season's days (null: not exported), and whether he is on a major-league roster. The player
   * himself is not added; include him when he belongs to it.
   */
  superTwoClass?: ClassMemberSpec[];
  /**
   * The season's schedule as the export's calendar gives it (`seasonServiceCalendars`): the days from
   * the first scheduled game to the last, and the days left to the last. Defaults to a major-league
   * schedule of 187 days (longer than the service year), with the days left following the clock;
   * null when the export does not carry the schedule.
   */
  calendar?: { scheduleDays: number; daysLeft: number } | null;
}

export interface ClassMemberSpec {
  days: number | null;
  thisYear: number | null;
  onRoster?: boolean | null;
}

/** A class of `count` held players, service evenly spread from `from` days in steps of `step`. */
export function classOf(count: number, from: number, step: number, thisYear = 100): ClassMemberSpec[] {
  return Array.from({ length: count }, (_, i) => ({ days: from + i * step, thisYear, onRoster: true }));
}

/** A major-league schedule of 187 days, with the days left following the clock (the season over at the service year). */
export const MLB_SCHEDULE_DAYS = 187;
export function calendarFor(clock: number | null, spec?: { scheduleDays: number; daysLeft: number } | null): Sourced<{ scheduleDays: number; daysLeft: number }> {
  if (spec === null) return blank();
  if (spec) return derivedFrom(spec, 'test');
  const daysLeft = clock === null ? MLB_SCHEDULE_DAYS - 40 : clock >= YEAR ? 0 : MLB_SCHEDULE_DAYS - clock;
  return derivedFrom({ scheduleDays: MLB_SCHEDULE_DAYS, daysLeft }, 'test');
}

/** The Super Two cutoff for the synthetic major league's class, as Player Rights computes it. */
export function superTwoFor(
  members: ClassMemberSpec[], rules: ContractRules, clock: number | null, calendar?: { scheduleDays: number; daysLeft: number } | null
): SuperTwoCutoff | undefined {
  const classMembers = members.map((m, i) => ({
    playerId: 10_000 + i, leagueId: MLB, mlbDays: m.days, mlbDaysThisSeason: m.thisYear, onMajorLeagueRoster: m.onRoster ?? true,
  }));
  return superTwoCutoffs(
    classMembers, () => rules, () => (clock === null ? blank<number>() : derivedFrom(clock, 'test')), () => calendarFor(clock, calendar)
  ).get(MLB);
}

/** The whole path: Player Rights' eligibility, composed with the contract into a timeline. */
export function timelineOf(spec: TimelineSpec = {}): ControlTimeline {
  const state = spec.state ?? stateOf();
  const contract = spec.contract ?? factsOf(contractRow());
  const clock = spec.clock === undefined ? 40 : spec.clock;
  const rules = spec.rules ?? mlbRules();
  const superTwo = spec.superTwoClass ? superTwoFor(spec.superTwoClass, rules, clock, spec.calendar) : undefined;
  const eligibility = contract.standing === 'unsigned' ? null : evaluateContractControl({
    state,
    rules,
    serviceClock: clock === null ? blank<number>() : derivedFrom(clock, 'test'),
    serviceCalendar: calendarFor(clock, spec.calendar),
    currentState: spec.currentState ?? 'current',
    seasons: CONTROL_HORIZON_SEASONS,
    superTwo: superTwo ?? null,
  });
  return composeControlTimeline({
    playerId: state.playerId, holder: state.organizationId, contract, eligibility, horizon: CONTROL_HORIZON_SEASONS,
    majorLeagueClub: state.level.value === null ? null : state.level.value === 1,
  });
}

/** The timeline's entry for a season. */
export function seasonOf(timeline: ControlTimeline, season: number) {
  const s = timeline.seasons.find((x) => x.season === season);
  if (!s) throw new Error(`no entry for ${season}: ${JSON.stringify(timeline.seasons.map((x) => x.season))}`);
  return s;
}
