/**
 * Player Value, concern 1: what the contract says, season by season (PLAYER_VALUE.md Part 2.1).
 *
 * Pure: it is handed the exported rows and which columns exist, and opens no table. Every field
 * is `Sourced`. Three readings are deliberate:
 *
 *   - A salary of 0 in a contract season is unknown, never a cost of zero. On a minor-league
 *     contract it is what the export writes almost everywhere, and whether it means unpaid, not
 *     exported or off the major-league payroll is unresolved (R-6, owner Q-5).
 *   - A clause column that is 0 on EVERY contract in the export (no-trade, buyout, retained salary
 *     on the imported historical start) is not populated, and a 0 in it is unknown, not "none".
 *     Where the export does populate a column, its 0 reads as none.
 *   - The club carrying the money is `contract_team_id` as exported, not verified against payroll.
 *
 * Nothing here reads a rating, `players_value`, philosophy or a right.
 */

import { fromExport, unknownBecause, type Sourced } from './provenance.js';

export type OptionKind = 'club' | 'player' | 'vesting';

export interface ContractSeason {
  season: number;
  /** Guaranteed salary that season; unknown for a 0 or a blank (never $0). */
  salary: Sourced<number>;
  /** The option this season is, when the contract makes it one. */
  option: OptionKind | null;
  from: 'contract' | 'extension';
}

export interface ContractTerm {
  /** `season_year` — the term's first season. */
  firstSeason: Sourced<number>;
  /** `years` — how many seasons it runs. */
  years: Sourced<number>;
  seasons: ContractSeason[];
  /** The option flags on the term's last season, as exported. */
  options: { club: Sourced<boolean>; player: Sourced<boolean>; vesting: Sourced<boolean> };
  /** `last_year_option_buyout` — the buyout if an option is declined. */
  buyout: Sourced<number>;
}

export type ContractStanding =
  /** On a contract with exported terms. */
  | 'signed'
  /** With no club: `players.team_id` is 0. */
  | 'unsigned'
  /** On a club, with a contract row that carries no term (`years` 0 or no first season). */
  | 'no_terms'
  /** On a club with no contract row at all. */
  | 'no_contract_row'
  /** The contract table or the player's club is not in the export. */
  | 'unavailable';

export interface ContractFacts {
  playerId: number;
  standing: ContractStanding;
  /** `is_major` — a major-league or a minor-league contract. */
  kind: Sourced<'major_league' | 'minor_league'>;
  /** `contract_team_id` — the club carrying the money. Not verified against payroll. */
  payingClub: Sourced<number>;
  /** `current_year` — contract years already completed. */
  completedYears: Sourced<number>;
  term: ContractTerm | null;
  /** A signed extension that follows the term (`players_contract_extension`). */
  extension: ContractTerm | null;
  noTrade: Sourced<boolean>;
  /** `retained` — salary kept by a club that moved him. */
  retained: Sourced<boolean>;
  /** `opt_out` — exported as a count, not a flag; which season it follows is not established (R-6). */
  optOut: Sourced<number>;
  /** Incentives as stated. */
  incentives: {
    minimumPa: Sourced<number>;
    minimumPaBonus: Sourced<number>;
    minimumIp: Sourced<number>;
    minimumIpBonus: Sourced<number>;
    mvpBonus: Sourced<number>;
    cyYoungBonus: Sourced<number>;
    allStarBonus: Sourced<number>;
  };
  notes: string[];
}

/** Columns read from `players_contract`; the reader selects only those the export has. */
export const CONTRACT_COLUMNS = [
  'player_id', 'team_id', 'contract_team_id', 'is_major', 'season_year', 'years', 'current_year',
  'no_trade', 'last_year_team_option', 'last_year_player_option', 'last_year_vesting_option',
  'last_year_option_buyout', 'retained', 'opt_out',
  'minimum_pa', 'minimum_pa_bonus', 'minimum_ip', 'minimum_ip_bonus', 'mvp_bonus', 'cyyoung_bonus', 'allstar_bonus',
  ...Array.from({ length: 15 }, (_, i) => `salary${i}`),
] as const;

/** Columns read from `players_contract_extension`. */
export const EXTENSION_COLUMNS = [
  'player_id', 'season_year', 'years',
  'last_year_team_option', 'last_year_player_option', 'last_year_vesting_option', 'last_year_option_buyout',
  ...Array.from({ length: 15 }, (_, i) => `salary${i}`),
] as const;

/** Clause columns judged by whether the export populates them at all (see the module note). */
export const CLAUSE_COLUMNS = [
  'no_trade', 'last_year_team_option', 'last_year_player_option', 'last_year_vesting_option',
  'last_year_option_buyout', 'retained', 'opt_out',
  'minimum_pa', 'minimum_pa_bonus', 'minimum_ip', 'minimum_ip_bonus', 'mvp_bonus', 'cyyoung_bonus', 'allstar_bonus',
] as const;

export type ContractRow = Record<string, unknown>;

export interface ContractTables {
  /** Columns `players_contract` has, or null when the table is missing. */
  contract: Set<string> | null;
  /** Columns `players_contract_extension` has, or null when the table is missing. */
  extension: Set<string> | null;
  /** Clause columns with a non-zero value somewhere in the export. */
  populated: Set<string>;
}

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const UNPOPULATED =
  'Zero on every contract in this export: the column is not populated, and that is not the same as none (R-6).';

function columnReader(table: string, row: ContractRow, present: Set<string>, populated: Set<string>) {
  const read = <T>(column: string, convert: (n: number) => T): Sourced<T> => {
    const source = `${table}.${column}`;
    if (!present.has(column)) return unknownBecause<T>('not_exported_by_ootp', source, `${table} has no ${column} column.`);
    const n = numberOrNull(row[column]);
    if (n === null) return unknownBecause<T>('not_exported_by_ootp', source, `${column} is blank in the export.`);
    if (n === 0 && (CLAUSE_COLUMNS as readonly string[]).includes(column) && !populated.has(column)) {
      return unknownBecause<T>('not_exported_by_ootp', source, UNPOPULATED);
    }
    return fromExport(convert(n), source);
  };
  return read;
}

const asIs = (n: number): number => n;
const flag = (n: number): boolean => n === 1;

function salaryOf(table: string, row: ContractRow, present: Set<string>, index: number, minorLeague: boolean): Sourced<number> {
  const column = `salary${index}`;
  const source = `${table}.${column}`;
  // A term longer than the export's salary slots (salary0..salary14) has no column for the later seasons
  if (!present.has(column)) {
    return unknownBecause('not_exported_by_ootp', source, `${table} has no ${column} column.`);
  }
  const n = numberOrNull(row[column]);
  if (n === null) return unknownBecause('not_exported_by_ootp', source, `${column} is blank in the export.`);
  if (n <= 0) {
    return unknownBecause('not_exported_by_ootp', source, minorLeague
      ? 'A minor-league contract with a salary of 0: whether that is unpaid, not exported or off the major-league payroll is unresolved, so the cost is unknown, never $0 (R-6, Q-5).'
      : 'A salary of 0 in a season the contract covers is not a cost of zero; the export does not state it.');
  }
  return fromExport(n, source);
}

function termOf(
  table: string, row: ContractRow, present: Set<string>, populated: Set<string>, from: 'contract' | 'extension',
  minorLeague: boolean
): ContractTerm | null {
  const read = columnReader(table, row, present, populated);
  const firstSeason = read('season_year', asIs);
  const years = read('years', asIs);
  const first = firstSeason.value;
  const count = years.value;
  if (first === null || first <= 0 || count === null || count < 1) return null;
  const options = {
    club: read('last_year_team_option', flag),
    player: read('last_year_player_option', flag),
    vesting: read('last_year_vesting_option', flag),
  };
  const lastOption: OptionKind | null = options.club.value ? 'club'
    : options.player.value ? 'player'
      : options.vesting.value ? 'vesting' : null;
  const seasons: ContractSeason[] = [];
  for (let i = 0; i < count; i += 1) {
    seasons.push({
      season: first + i,
      salary: salaryOf(table, row, present, i, minorLeague),
      option: i === count - 1 ? lastOption : null,
      from,
    });
  }
  return { firstSeason, years, seasons, options, buyout: read('last_year_option_buyout', asIs) };
}

/**
 * The contract facts for one player.
 *
 * @param teamId the player's club (`players.team_id`); 0 means he has none.
 * @param row his `players_contract` row, or null when he has none.
 * @param extension his `players_contract_extension` row with terms, or null.
 */
export function contractFactsOf(
  playerId: number, teamId: Sourced<number>, row: ContractRow | null, extension: ContractRow | null, tables: ContractTables
): ContractFacts {
  const notes: string[] = [];
  const blank = <T>(reason: 'source_unavailable' | 'not_exported_by_ootp', note: string): Sourced<T> =>
    unknownBecause<T>(reason, 'players_contract', note);
  const empty = (standing: ContractStanding, reason: 'source_unavailable' | 'not_exported_by_ootp', note: string): ContractFacts => ({
    playerId, standing,
    kind: blank(reason, note), payingClub: blank(reason, note), completedYears: blank(reason, note),
    term: null, extension: null,
    noTrade: blank(reason, note), retained: blank(reason, note), optOut: blank(reason, note),
    incentives: {
      minimumPa: blank(reason, note), minimumPaBonus: blank(reason, note), minimumIp: blank(reason, note),
      minimumIpBonus: blank(reason, note), mvpBonus: blank(reason, note), cyYoungBonus: blank(reason, note),
      allStarBonus: blank(reason, note),
    },
    notes: [note],
  });

  if (tables.contract === null) return empty('unavailable', 'source_unavailable', 'players_contract is not in the export.');
  if (row === null) {
    return teamId.value === 0
      ? empty('unsigned', 'not_exported_by_ootp', 'No club holds him and the export has no contract row for him.')
      : empty(teamId.value === null ? 'unavailable' : 'no_contract_row', 'not_exported_by_ootp', 'The export has no contract row for him.');
  }

  const present = tables.contract;
  const read = columnReader('players_contract', row, present, tables.populated);
  const major = read('is_major', flag);
  const kind: Sourced<'major_league' | 'minor_league'> = major.value === null
    ? { ...major, value: null }
    : { ...major, value: major.value ? 'major_league' : 'minor_league' };
  const minorLeague = major.value === false;
  const term = termOf('players_contract', row, present, tables.populated, 'contract', minorLeague);
  const ext = extension && tables.extension
    ? termOf('players_contract_extension', extension, tables.extension, tables.populated, 'extension', minorLeague)
    : null;
  const payingClub = read('contract_team_id', asIs);
  if (payingClub.value !== null && payingClub.value !== 0) {
    payingClub.note = 'The club of record for the money, as exported; not verified against payroll.';
  }
  const optOut = read('opt_out', asIs);
  if (optOut.value !== null && optOut.value > 0) {
    optOut.note = 'Exported as a count, not a flag; which season it follows is not established (R-6).';
  }

  let standing: ContractStanding;
  if (teamId.value === 0) standing = 'unsigned';
  else if (teamId.value === null) standing = 'unavailable';
  else if (term === null) standing = 'no_terms';
  else standing = 'signed';

  if (standing === 'no_terms') {
    notes.push(minorLeague
      ? 'A minor-league contract whose term the export does not carry (years or first season is 0).'
      : 'A contract row whose term the export does not carry (years or first season is 0).');
  }
  if (standing === 'unsigned' && term !== null) {
    notes.push('The export shows contract terms but no club; he is read as unsigned.');
  }

  return {
    playerId, standing, kind, payingClub,
    completedYears: read('current_year', asIs),
    term, extension: ext,
    noTrade: read('no_trade', flag),
    retained: read('retained', flag),
    optOut,
    incentives: {
      minimumPa: read('minimum_pa', asIs),
      minimumPaBonus: read('minimum_pa_bonus', asIs),
      minimumIp: read('minimum_ip', asIs),
      minimumIpBonus: read('minimum_ip_bonus', asIs),
      mvpBonus: read('mvp_bonus', asIs),
      cyYoungBonus: read('cyyoung_bonus', asIs),
      allStarBonus: read('allstar_bonus', asIs),
    },
    notes,
  };
}

/** The contract season (term first, then extension) that covers a season, if any. */
export function contractSeasonFor(facts: ContractFacts, season: number): ContractSeason | null {
  for (const term of [facts.term, facts.extension]) {
    const hit = term?.seasons.find((s) => s.season === season);
    if (hit) return hit;
  }
  return null;
}
