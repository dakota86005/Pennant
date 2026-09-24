/**
 * A synthetic OOTP save, built to order, for the cross-save suite (`playerValueCrossSave.test.ts`).
 *
 * Pennant has to work on saves that look nothing like the developer's: a brand-new fictional league,
 * a 60-game schedule, a reserve clause, no financials, a minor-league-only universe, an export with a
 * table missing. This builder rewrites the per-file fixture league (a temporary directory from
 * `tests/fixture.ts`, never `data/`) in place: every row is deleted, the columns a current export
 * carries are added where the fixture lacks them, and a league is written with the shape a spec asks
 * for. A case can then drop tables and columns to mimic an older or thinner export; the next build
 * restores them. It also clears the Player Value tables in the per-file `history.db`, so no fit or
 * snapshot leaks from one save into the next.
 *
 * The numbers mean nothing in themselves (they are drawn from a seeded generator); a case asserts the
 * mechanisms and invariants, never a figure. Promoted from Reviewer D's hardening probe (2026-09-23).
 */
import { db, tableColumns, tableExists } from '../server/db.js';
import { historyDb } from '../server/history.js';
import { clearScaleCache, clearValuationCaches } from '../server/valuation.js';

export interface SaveSpec {
  leagueId?: number;
  season: number;
  /** Completed seasons before this one with major-league lines (0: a brand-new league). */
  historySeasons: number;
  gamesPerTeam: number;
  /** Share of this season's schedule played (0: Opening Day, 1: every game played). */
  playedShare: number;
  clubs?: number;
  hittersPerClub?: number;
  pitchersPerClub?: number;
  /** Overrides on the major league's leagues row (null: blank). */
  rules?: Record<string, number | string | null>;
  currentDate?: string;
  startDate?: string;
  /** The season's service clock: the most days anyone banked this season. Default scales with the schedule played. */
  clockDays?: number;
  /** Days a full-season regular banked in each past season. */
  bankedPerSeason?: number;
  /** Multiplies every WAR (the league's offensive environment, or its WAR scale). */
  warScale?: number;
  /** Mean true rate (WAR per 600) of a hitter; pitchers get 0.55 of it. */
  meanRate600?: number;
  /** false: every salary 0 (a league that exports none). */
  salaries?: boolean;
  /** false: no team_financials rows. */
  financeRows?: boolean;
  /** Add a Triple-A league under the major league, with farm players. */
  minors?: boolean;
  /** Games per team in past seasons, when the schedule changed (default: gamesPerTeam). */
  pastGamesPerTeam?: number;
  seed?: number;
  /** Proneness: 'blank' leaves the columns 0 (the export's unfilled value); 'set' fills 1-200; 'absent' writes none. */
  proneness?: 'blank' | 'set' | 'absent';
}

export interface BuiltSave {
  spec: SaveSpec;
  leagueId: number;
  aaaLeagueId: number | null;
  clubs: number[];
  farmClubs: number[];
  hitters: number[];
  pitchers: number[];
  prospects: number[];
  /** A regular hitter with a full record. */
  regular: number;
  /** A reliever with a full record. */
  reliever: number;
  /** The club the human manages (its organization id). */
  org: number;
}

function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Columns a current export carries that the hand-built fixture does not. */
const EXTRA_COLUMNS: Record<string, string[]> = {
  leagues: [
    'start_date TEXT', 'rules_schedule_games_per_team INTEGER', 'rules_financials INTEGER',
    'rules_minor_league_fa_minimum_years INTEGER', 'rules_salary_cap REAL', 'rules_luxury_tax REAL',
    'rules_luxury_sharing INTEGER', 'rules_luxury_sharing_cap REAL', 'rules_revenue_sharing INTEGER',
    'rules_revenue_sharing_tax REAL', 'arbitration_offering INTEGER', 'rules_owner_decides_budget INTEGER',
    'rules_cash_maximum REAL', 'rules_average_national_media_contract REAL', 'rules_national_media_contract_fixed INTEGER',
    'rules_fa_compensation INTEGER',
    ...Array.from({ length: 8 }, (_, i) => `rules_player_salary${i} REAL`),
  ],
  players: ['date_of_birth TEXT', 'prone_overall INTEGER', 'prone_leg INTEGER', 'prone_back INTEGER', 'prone_arm INTEGER'],
  team_history_record: ['league_id INTEGER', 't INTEGER'],
  players_contract: [
    'last_year_option_buyout REAL', 'opt_out INTEGER', 'minimum_pa INTEGER', 'minimum_pa_bonus REAL',
    'minimum_ip INTEGER', 'minimum_ip_bonus REAL', 'mvp_bonus REAL', 'cyyoung_bonus REAL', 'allstar_bonus REAL',
  ],
};

const FINANCE_TABLE = 'team_id INTEGER, budget REAL, player_payroll REAL, player_payroll_next_season REAL, cash REAL, market REAL, owner_expectation REAL, total_revenue REAL, total_expenses REAL, budget_balance REAL, cash_trades_available REAL, fan_interest REAL';

/** The schema as the first build found it, so a later build can restore what a case dropped. */
const savedDdl = new Map<string, string>();
const savedColumns = new Map<string, Array<{ name: string; type: string }>>();

function rememberSchema(): void {
  for (const r of db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string; sql: string }>) {
    if (!savedDdl.has(r.name)) savedDdl.set(r.name, r.sql);
  }
}

function restoreDropped(): void {
  for (const [name, sql] of savedDdl) if (!tableExists(name)) db.exec(sql);
  if (savedColumns.size === 0) {
    for (const name of savedDdl.keys()) savedColumns.set(name, db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string; type: string }>);
  }
  for (const [name, cols] of savedColumns) {
    const have = new Set(tableColumns(name));
    for (const c of cols) if (!have.has(c.name)) db.exec(`ALTER TABLE "${name}" ADD COLUMN "${c.name}" ${c.type}`);
  }
}

/** Empty every table and bring the schema up to what a current export carries. */
function resetSchema(): void {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((r) => r.name);
  for (const t of tables) db.exec(`DELETE FROM "${t}"`);
  for (const [table, cols] of Object.entries(EXTRA_COLUMNS)) {
    if (!tableExists(table)) continue;
    const have = new Set(tableColumns(table));
    for (const c of cols) if (!have.has(c.split(' ')[0])) db.exec(`ALTER TABLE "${table}" ADD COLUMN ${c}`);
  }
  if (!tableExists('team_last_financials')) db.exec(`CREATE TABLE team_last_financials (${FINANCE_TABLE})`);
  if (!tableExists('team_history_financials')) db.exec(`CREATE TABLE team_history_financials (${FINANCE_TABLE}, year INTEGER)`);
}

/** Inserts the columns of `row` the table has; a column the export lacks is simply not written. */
export function insert(table: string, row: Record<string, unknown>): void {
  if (!tableExists(table)) return;
  const have = new Set(tableColumns(table));
  const cols = Object.keys(row).filter((c) => have.has(c));
  db.prepare(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c] as never));
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** A leagues row shaped like a current export: its own contract rules, or a minor league's zeros and a parent. */
export function leagueRow(
  id: number, parent: number, level: number, name: string, games: number, ownRules: boolean, season: number, current: string, start: string,
): Record<string, unknown> {
  return {
    league_id: id, name, abbr: name.slice(0, 3), parent_league_id: parent, league_level: level, season_year: season,
    current_date: current, start_date: start, rules_schedule_games_per_team: games,
    rules_fa_minimum_years: ownRules ? 6 : 0, rules_salary_arbitration_minimum_years: ownRules ? 3 : 0,
    rules_minor_league_fa_minimum_years: ownRules ? 6 : 0, rules_minimum_salary: ownRules ? 700_000 : 0,
    rules_min_service_days: 172, rules_financials: ownRules ? 1 : 0, financial_coefficient: 1,
    rules_salary_cap: 0, rules_luxury_tax: 0, rules_luxury_sharing: 0, rules_luxury_sharing_cap: 0,
    rules_revenue_sharing: 0, rules_revenue_sharing_tax: 0, arbitration_offering: 0, rules_owner_decides_budget: 0,
    rules_cash_maximum: 1_000_000, rules_average_national_media_contract: 0, rules_national_media_contract_fixed: 0,
    rules_fa_compensation: 0, rules_amateur_draft: 1, show_draft_pool: 1, draft_date: `${season}-7-10`, rules_amateur_draft_rounds: 20,
    trade_deadline_date: `${season}-7-31`, rules_minor_league_options: 1, rules_rule_5: 1, rules_dfa_period_length: 7,
    rules_waiver_period_length: 3, rules_active_roster_limit: 26, rules_expanded_roster_limit: 28, rosters_expanded: 0,
    rules_secondary_roster_limit: 40,
  };
}

export function buildSave(spec: SaveSpec): BuiltSave {
  rememberSchema();
  restoreDropped();
  resetSchema();
  clearScaleCache();
  clearValuationCaches();

  const rnd = random(spec.seed ?? 1);
  const normal = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const L = spec.leagueId ?? 100;
  const AAA = spec.minors ? L + 1 : null;
  const Y = spec.season;
  const G = spec.gamesPerTeam;
  const pastG = spec.pastGamesPerTeam ?? G;
  const clubsN = spec.clubs ?? 8;
  // Calendar days a season of G games spans, at MLB's pace (186 days for 162 games)
  const seasonDays = Math.round((G * 186) / 162);
  const start = spec.startDate ?? `${Y}-4-1`;
  const playedDays = Math.round(spec.playedShare * seasonDays);
  const d = new Date(Date.UTC(Y, 3, 1 + playedDays));
  const current = spec.currentDate ?? `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  const perYear = typeof spec.rules?.rules_min_service_days === 'number' ? spec.rules.rules_min_service_days : 172;
  const clock = spec.clockDays ?? Math.round(Math.min(perYear, seasonDays) * spec.playedShare);
  const banked = spec.bankedPerSeason ?? Math.min(perYear, seasonDays);
  const warScale = spec.warScale ?? 1;
  const mean = spec.meanRate600 ?? 2.0;

  const major = leagueRow(L, 0, 1, 'Fictional League', G, true, Y, current, start);
  for (const [k, v] of Object.entries(spec.rules ?? {})) major[k] = v;
  insert('leagues', major);
  if (AAA !== null) insert('leagues', leagueRow(AAA, L, 2, 'Fictional Triple-A', Math.round(G * 0.93), false, Y, current, start));
  insert('sub_leagues', { league_id: L, sub_league_id: 0, name: 'Only', designated_hitter: 1 });

  const clubs: number[] = [];
  const farm: number[] = [];
  for (let c = 0; c < clubsN; c += 1) {
    const id = c + 1;
    clubs.push(id);
    insert('teams', { team_id: id, name: `Club ${id}`, nickname: 'N', abbr: `C${id}`, level: 1, league_id: L, sub_league_id: 0, division_id: 0, parent_team_id: 0, allstar_team: 0, human_team: id === 1 ? 1 : 0, human_id: id === 1 ? 1 : 0 });
    if (AAA !== null) {
      const f = 100 + id;
      farm.push(f);
      insert('teams', { team_id: f, name: `Farm ${id}`, nickname: 'F', abbr: `F${id}`, level: 2, league_id: AAA, sub_league_id: 0, division_id: 0, parent_team_id: id, allstar_team: 0, human_team: 0 });
    }
    const gNow = Math.round(spec.playedShare * G);
    const wNow = Math.round(gNow / 2);
    insert('team_record', { team_id: id, g: gNow, w: wNow, l: gNow - wNow, t: 0, pos: 1, pct: 0.5, gb: 0 });
    for (let s = Y - spec.historySeasons; s < Y; s += 1) {
      const w = Math.round(pastG / 2 + (rnd() - 0.5) * 20);
      insert('team_history_record', { team_id: id, year: s, league_id: L, g: pastG, w, l: pastG - w, t: 0, pct: w / pastG, pos: 1, gb: 0 });
    }
    if (spec.financeRows !== false) {
      insert('team_financials', { team_id: id, budget: 150e6, player_payroll: spec.salaries === false ? 0 : 90e6, player_payroll_next_season: 60e6, cash: 0, market: 3, owner_expectation: 2, total_revenue: 160e6, total_expenses: 140e6, budget_balance: 0, cash_trades_available: 5e6, fan_interest: 50 });
    }
  }
  insert('human_managers', { human_manager_id: 1, first_name: 'G', last_name: 'M', team_id: 1, organization_id: 1 });

  const hitters: number[] = [];
  const pitchers: number[] = [];
  const prospects: number[] = [];
  let pid = 1000;
  const firstSeason = Y - spec.historySeasons;

  const addPlayer = (team: number, org: number, pitcher: boolean, role: 'regular' | 'bench' | 'starter' | 'reliever' | 'prospect') => {
    const id = pid;
    pid += 1;
    const age = role === 'prospect' ? 20 + Math.floor(rnd() * 4) : 23 + Math.floor(rnd() * 12);
    const birthYear = Y - age;
    const kindMean = (pitcher ? 0.55 : 1) * mean;
    const true600 = kindMean + 1.6 * normal() + (role === 'bench' || role === 'reliever' ? -0.6 : 0);
    const tool = (x: number) => Math.round(clamp(50 + (10 * (x - kindMean)) / 1.6 + 5 * normal(), 20, 80));
    const cur = tool(true600);
    const lift = role === 'prospect' ? 10 + Math.floor(rnd() * 10) : Math.max(0, 28 - age) * 2;
    const t = () => Math.round(clamp(cur + 6 * normal(), 20, 80));
    const tp = (c: number) => clamp(c + lift, 20, 80);
    const position = pitcher ? 1 : 2 + Math.floor(rnd() * 8);
    const prone = spec.proneness === 'set' ? 1 + Math.floor(rnd() * 200) : 0;
    insert('players', {
      player_id: id, first_name: 'P', last_name: `${id}`, age, position, role: pitcher ? (role === 'starter' ? 11 : 12) : 0,
      bats: 1 + Math.floor(rnd() * 3), throws: 1, uniform_number: id % 99, team_id: team, organization_id: org, retired: 0, hidden: 0,
      draft_eligible: 0, college: 0, league_id: team >= 100 ? AAA : L, date_of_birth: `${birthYear}-5-${1 + Math.floor(rnd() * 27)}`,
      ...(spec.proneness === 'absent' ? {} : { prone_overall: prone, prone_leg: prone, prone_back: prone, prone_arm: prone }),
    });
    if (pitcher) {
      const [a, b, c] = [t(), t(), t()];
      insert('players_pitching', {
        player_id: id,
        pitching_ratings_overall_stuff: a, pitching_ratings_overall_movement: b, pitching_ratings_overall_control: c,
        pitching_ratings_talent_stuff: tp(a), pitching_ratings_talent_movement: tp(b), pitching_ratings_talent_control: tp(c),
        pitching_ratings_misc_stamina: role === 'starter' ? 65 : 35, pitching_ratings_misc_velocity: 10,
        pitching_ratings_pitches_fastball: 60, pitching_ratings_pitches_slider: 55, pitching_ratings_pitches_changeup: 50,
      });
    } else {
      const [a, b, c, e, k] = [t(), t(), t(), t(), t()];
      insert('players_batting', {
        player_id: id, running_ratings_speed: 50,
        batting_ratings_overall_contact: a, batting_ratings_overall_gap: b, batting_ratings_overall_power: c,
        batting_ratings_overall_eye: e, batting_ratings_overall_strikeouts: k,
        batting_ratings_talent_contact: tp(a), batting_ratings_talent_gap: tp(b), batting_ratings_talent_power: tp(c),
        batting_ratings_talent_eye: tp(e), batting_ratings_talent_strikeouts: tp(k),
      });
      insert('players_fielding', { player_id: id, position, [`fielding_rating_pos${position}`]: 35 + Math.floor(rnd() * 40), [`fielding_rating_pos${position}_pot`]: 60 });
    }
    // A career that debuted some seasons ago, capped by the league's own history
    const tenure = role === 'prospect' ? 0 : Math.min(spec.historySeasons, Math.floor(rnd() * 9) + (age > 27 ? 2 : 0));
    let serviceDays = 0;
    for (let s = Y - tenure; s <= Y; s += 1) {
      if (s < firstSeason) continue;
      const share = s === Y ? spec.playedShare : 1;
      const g = s === Y ? G : pastG;
      if (share <= 0) continue;
      const base = role === 'regular' ? 620 : role === 'bench' ? 260 : role === 'starter' ? 780 : 280;
      const opp = Math.max(10, Math.round(base * (g / 162) * share * (0.85 + 0.3 * rnd())));
      const war = warScale * ((true600 * opp) / 600 + Math.sqrt(opp / 600) * 1.2 * normal());
      const level = team >= 100 ? 2 : 1;
      const league = team >= 100 ? AAA : L;
      if (pitcher) {
        const games = role === 'starter' ? Math.round(32 * (g / 162) * share) : Math.round(65 * (g / 162) * share);
        insert('players_career_pitching_stats', { player_id: id, year: s, team_id: team, league_id: league, level_id: level, split_id: 1, bf: opp, outs: Math.round(opp * 0.72), g: games, gs: role === 'starter' ? games : 0, war: Math.round(war * 10) / 10 });
      } else {
        insert('players_career_batting_stats', { player_id: id, year: s, team_id: team, league_id: league, level_id: level, split_id: 1, pa: opp, ab: Math.round(opp * 0.9), war: Math.round(war * 10) / 10 });
        insert('players_career_batting_stats', { player_id: id, year: s, team_id: team, league_id: league, level_id: level, split_id: 2, pa: Math.round(opp * 0.28), ab: 0, war: null });
        insert('players_career_batting_stats', { player_id: id, year: s, team_id: team, league_id: league, level_id: level, split_id: 3, pa: Math.round(opp * 0.72), ab: 0, war: null });
      }
      if (team < 100) serviceDays += s === Y ? clock : banked;
    }
    insert('players_roster_status', {
      player_id: id, is_active: team < 100 ? 1 : 0, is_on_dl: 0, is_on_dl60: 0, is_on_secondary: 1,
      mlb_service_years: Math.floor(serviceDays / perYear), mlb_service_days: serviceDays, mlb_service_days_this_year: team < 100 ? clock : 0,
      options_used: 0, options_used_this_year: 0, years_protected_from_rule_5: 0, pro_service_years: tenure, pro_service_days: 0,
    });
    const years = 1 + Math.floor(rnd() * 4);
    const salary = spec.salaries === false || team >= 100 ? 0 : Math.round((700_000 + Math.max(0, true600) * 3_000_000 * rnd()) / 1000) * 1000;
    insert('players_contract', {
      player_id: id, team_id: team, contract_team_id: team, season_year: Y, years, current_year: 0, is_major: team >= 100 ? 0 : 1,
      retained: 0, no_trade: 0, last_year_team_option: 0, last_year_player_option: 0, last_year_vesting_option: 0,
      ...Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`salary${i}`, i < years ? salary : 0])),
    });
    insert('team_roster', { team_id: team, player_id: id, list_id: team < 100 ? 1 : 2 });
    return id;
  };

  for (const club of clubs) {
    const nh = spec.hittersPerClub ?? 13;
    const np = spec.pitchersPerClub ?? 13;
    for (let i = 0; i < nh; i += 1) hitters.push(addPlayer(club, club, false, i < 9 ? 'regular' : 'bench'));
    for (let i = 0; i < np; i += 1) pitchers.push(addPlayer(club, club, true, i < 5 ? 'starter' : 'reliever'));
  }
  for (const f of farm) {
    for (let i = 0; i < 6; i += 1) prospects.push(addPlayer(f, f - 100, i % 2 === 1, 'prospect'));
  }
  clearPlayerValueHistory();
  return {
    spec, leagueId: L, aaaLeagueId: AAA, clubs, farmClubs: farm, hitters, pitchers, prospects,
    regular: hitters[0], reliever: pitchers[6], org: 1,
  };
}

/** Clears Player Value's history.db tables (fits and market snapshots): a new save starts with none. */
export function clearPlayerValueHistory(): void {
  for (const table of ['value_production_fits', 'value_market_snapshots']) {
    const exists = historyDb.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
    if (exists) historyDb.exec(`DELETE FROM "${table}"`);
  }
}

export function dropTable(name: string): void {
  db.exec(`DROP TABLE IF EXISTS "${name}"`);
  clearValuationCaches();
}

export function dropColumn(table: string, column: string): void {
  if (tableColumns(table).includes(column)) db.exec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
  clearValuationCaches();
}

/** Runs SQL against the synthetic save (a case's reshaping), and clears the caches that read it. */
export function exec(sql: string): void {
  db.exec(sql);
  clearValuationCaches();
}
