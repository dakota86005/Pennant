import { db, tableExists } from './db.js';
import { leagueRulesForLeague } from './leagueRules.js';

/**
 * SQL fragment restricting a `players p` query to men genuinely on the club.
 *
 * `players.team_id` is not the roster: OOTP parks newly signed international
 * free agents on the parent club until they are assigned to an affiliate, so a
 * bare `team_id = ?` sweeps 16-year-olds from the complex league in alongside
 * the major-league staff. Roster status is the real signal — active, or on the
 * injured list (Cole and Schmidt are inactive but very much on the roster).
 *
 * Requires the query to join `players_roster_status rs ON rs.player_id = p.player_id`.
 */
export const ON_ROSTER = '(rs.is_active = 1 OR rs.is_on_dl = 1 OR rs.is_on_dl60 = 1)';

/**
 * Whether this club's half of the league bats a designated hitter.
 *
 * The flag lives on the sub-league, not the league, which is historically
 * exactly right: the AL adopted the DH in 1973 and the NL did not until 2022,
 * so the two halves of the same league disagreed for half a century. A
 * pre-1973 replay has it off everywhere, and a lineup card that hands one of
 * the nine spots to a DH is simply illegal there.
 */
export function usesDH(teamId: number): boolean {
  if (!tableExists('sub_leagues')) return true;
  const row = db
    .prepare(
      `SELECT sl.designated_hitter AS dh
       FROM teams t
       JOIN sub_leagues sl
         ON sl.league_id = t.league_id AND sl.sub_league_id = t.sub_league_id
       WHERE t.team_id = ?`
    )
    .get(teamId) as { dh: number | null } | undefined;
  // An export without the table behaves as it always did rather than dropping
  // a bat from every lineup in the app
  return row?.dh == null ? true : row.dh === 1;
}

/**
 * A plain-language note about the league's rules, for the AI prompts.
 *
 * Without this the model assumes the modern game. In a reserve-clause league it
 * would urge a GM to extend a player "before he reaches the open market" that
 * will not exist for another sixty years, and in a pre-1973 replay it would
 * happily park a slugger at DH.
 */
/**
 * The dates that govern the season, and how far off each one is.
 *
 * Asked whether to wait a fortnight before selling, the assistant said it had
 * nothing that pinned down the trade deadline and would not guess at a date —
 * honest, and useless, since the save carries every one of these. A calendar
 * is small enough to hand to every voice in the building rather than hide
 * behind a tool one of them might think to call.
 *
 * Dates in the past are kept and marked as passed. Whether the deadline has
 * gone is exactly as useful as when it falls.
 */
export interface CalendarEntry {
  what: string;
  date: string;
  daysAway: number | null;
  passed: boolean;
}

const DATE_COLUMNS: Array<[string, string]> = [
  ['start_date', 'Opening day'],
  ['allstar_date', 'All-Star game'],
  ['draft_date', 'Amateur draft'],
  ['trade_deadline_date', 'Trade deadline'],
  ['roster_expand_date', 'Rosters expand'],
  ['rule_5_draft_date', 'Rule 5 draft'],
  ['international_fa_date', 'International free agency opens'],
];

/** OOTP writes '2026-8-3' as readily as '2026-08-03'. */
function asDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value.trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function seasonCalendar(leagueId: number): CalendarEntry[] {
  if (!tableExists('leagues')) return [];
  const have = new Set(
    (db.prepare(`PRAGMA table_info(leagues)`).all() as Array<{ name: string }>).map((c) => c.name)
  );
  const wanted = DATE_COLUMNS.filter(([col]) => have.has(col));
  if (wanted.length === 0) return [];

  const row = db
    .prepare(`SELECT ${wanted.map(([c]) => `"${c}"`).join(', ')} FROM leagues WHERE league_id = ?`)
    .get(leagueId) as Record<string, unknown> | undefined;
  if (!row) return [];

  const today = asDate(currentGameDate(leagueId));
  const out: CalendarEntry[] = [];
  for (const [col, what] of wanted) {
    const raw = row[col];
    const when = asDate(raw);
    if (!when || typeof raw !== 'string') continue;
    const daysAway = today
      ? Math.round((when.getTime() - today.getTime()) / 86_400_000)
      : null;
    out.push({ what, date: raw, daysAway, passed: daysAway !== null && daysAway < 0 });
  }
  return out.sort((a, b) => (a.daysAway ?? 0) - (b.daysAway ?? 0));
}

/** The calendar as a line of prose, for a system prompt. */
export function calendarBriefing(leagueId: number): string {
  const entries = seasonCalendar(leagueId);
  if (entries.length === 0) return '';
  const today = currentGameDate(leagueId);
  const said = entries.map((e) => {
    if (e.daysAway === null) return `${e.what} ${e.date}`;
    if (e.passed) return `${e.what} ${e.date} (${Math.abs(e.daysAway)} days ago)`;
    if (e.daysAway === 0) return `${e.what} ${e.date} (today)`;
    return `${e.what} ${e.date} (in ${e.daysAway} days)`;
  });
  return (
    `KEY DATES — today is ${today ?? 'unknown'}. ${said.join('; ')}. ` +
    'These come from the save, so use them rather than assuming the real-world calendar, ' +
    'and never tell the reader you do not know when something falls.'
  );
}

/**
 * The club and its affiliates, named, for a system prompt.
 *
 * A reader asked his assistant about a man at Norfolk and was told he was not
 * in the organisation — the assistant had it down as an Astros affiliate. The
 * export was right: Norfolk's parent is Baltimore, plainly, in the column the
 * teams tool returns. The assistant had simply answered from what it knew of
 * real baseball rather than looking, and a smaller model does that more
 * readily than a large one.
 *
 * The app made it easy. It named the club the reader runs and stopped there,
 * so "is this player in my organisation" could only be answered by fetching
 * three hundred clubs and reading the parent column of each — and a model that
 * would rather not is a model that guesses. Eight lines of prose removes the
 * question. Affiliations move between seasons in any save that runs long
 * enough, so this is worth stating even when a model would have got it right.
 */
export function orgBriefing(orgId: number): string {
  if (!tableExists('teams')) return '';
  const clubs = db
    .prepare(
      `SELECT team_id, name, nickname, level FROM teams
       WHERE team_id = ? OR parent_team_id = ?
       ORDER BY level, team_id`
    )
    .all(orgId, orgId) as Array<{ team_id: number; name: string; nickname: string; level: number }>;
  if (clubs.length === 0) return '';

  const said = clubs.map((c) => {
    const label = c.name === c.nickname ? c.name : `${c.name} ${c.nickname}`;
    return `${label} (${LEVEL_NAMES[c.level] ?? `L${c.level}`}, team_id ${c.team_id})`;
  });
  return (
    `YOUR ORGANISATION, top to bottom: ${said.join('; ')}. ` +
    'Those clubs and no others. A player anywhere else belongs to somebody else, whatever you ' +
    'may know of the real clubs of the same names — affiliations in a save are not the ' +
    'real-world ones and they move between seasons.'
  );
}

export function rulesBriefing(leagueId: number, teamId?: number): string {
  // The one LeagueRules (D-052): the contract regime is resolved through the
  // parent league, and a rule the export does not state is said to be unknown,
  // never assumed to be the modern game's six years or three
  const r = leagueRulesForLeague(leagueId).contract;
  const fa = r.freeAgencyYears.value;
  const arb = r.arbitrationYears.value;
  const minimum = r.minimumSalary.value;
  const coefficient = r.financialCoefficient.value;
  const parts: string[] = [];
  // Whether the pitcher hits changes lineup construction, bench roles and what
  // a "bat-only" player is worth, so the model must not assume the modern game
  if (teamId !== undefined && !usesDH(teamId)) {
    parts.push(
      'This league has NO DESIGNATED HITTER — the pitcher bats, ninth. Only eight position ' +
        'players are in the order, there is no place for a bat-only slugger who cannot field, ' +
        'and double switches and pinch-hitting for the pitcher are live tactical questions. ' +
        'Never suggest using someone "at DH".'
    );
  }
  if (fa === 0) {
    parts.push(
      'This league has NO FREE AGENCY — the reserve clause binds players to the club indefinitely. ' +
        'Contracts run a year at a time and simply renew. A player cannot leave for another team, so ' +
        'never advise extending someone "before he reaches the market", and never treat an ending ' +
        'contract as a risk of losing him. The real pressures are salary demands, holdouts, sales and ' +
        'trades between clubs.'
    );
  } else if (fa === null) {
    parts.push(
      'The league\'s free-agency rule is not in the export, so it is unknown when a player can leave. ' +
        'Do not assume the modern six years; say it is not known.'
    );
  } else {
    parts.push(`Free agency requires ${fa} years of major-league service.`);
  }
  if (arb === null) {
    if (fa !== 0) parts.push('The league\'s arbitration rule is not in the export; do not assume one.');
  } else if (arb > 0) {
    parts.push(`Salary arbitration begins at ${arb} years of service.`);
  } else if (fa !== 0) {
    parts.push('This league has no salary arbitration.');
  }
  if (minimum !== null && minimum > 0) {
    parts.push(`The league minimum salary is ${Math.round(minimum).toLocaleString()}.`);
  }
  if (coefficient !== null && coefficient !== 1) {
    parts.push(
      `Money in this league runs at a coefficient of ${coefficient} versus a modern league — ` +
        'judge every salary against this league\'s own scale, not modern figures.'
    );
  }
  return parts.join(' ');
}

export function seasonYear(leagueId: number): number {
  const row = db.prepare(`SELECT season_year FROM leagues WHERE league_id = ?`).get(leagueId) as
    | { season_year: number }
    | undefined;
  return row?.season_year ?? new Date().getFullYear();
}

/**
 * OOTP's level codes, in one place.
 *
 * Was declared privately in two files and about to be a third. A constant
 * describing how the save encodes something is exactly the kind that drifts
 * quietly once there are copies of it.
 */
export const LEVEL_NAMES: Record<number, string> = {
  1: 'MLB', 2: 'AAA', 3: 'AA', 4: 'A', 5: 'A', 6: 'R',
};

/**
 * The scale OOTP is set to display ratings on.
 *
 * The setting is the user's, not the league's, and the export carries whatever
 * they chose — 20-80, 1-20, 1-10, 2-8 or 1-5 — with no column saying which. A
 * reader running the 1-to-5 scale found his best contact hitter drawn as a
 * sliver, because the bars divided by eighty regardless: a 5 came out at six
 * per cent of the width instead of full.
 *
 * So it is read off the data. The top of the scale is the largest rating
 * anywhere in the file, which needs no setting to be right and is correct for
 * a custom scale nobody has thought of.
 */
let scaleCache: number | null = null;

export function ratingScaleMax(): number {
  if (scaleCache !== null) return scaleCache;
  const columns: Array<[string, string]> = [
    ['players_batting', 'batting_ratings_overall_contact'],
    ['players_batting', 'batting_ratings_overall_power'],
    ['players_pitching', 'pitching_ratings_overall_stuff'],
    ['players_fielding', 'fielding_ratings_infield_range'],
  ];
  let observed = 0;
  for (const [table, column] of columns) {
    if (!tableExists(table)) continue;
    try {
      const row = db.prepare(`SELECT MAX("${column}") AS m FROM "${table}"`).get() as { m: number | null };
      observed = Math.max(observed, Number(row?.m ?? 0));
    } catch {
      // A save without that column simply contributes nothing
    }
  }
  // Snap to the scale OOTP actually offers; nobody tops out at exactly the
  // maximum on a small scale, so the bands are generous at the bottom
  const known = [5, 8, 10, 20, 80];
  scaleCache = known.find((max) => observed <= max) ?? 80;
  return scaleCache;
}

/** Called after an import, since a new save may use a different scale. */
export function clearScaleCache(): void {
  scaleCache = null;
}

export function currentGameDate(leagueId: number): string | null {
  const row = db.prepare(`SELECT "current_date" AS d FROM leagues WHERE league_id = ?`).get(leagueId) as
    | { d: string }
    | undefined;
  return row?.d ?? null;
}

export interface TeamFinances {
  budget: number;
  payroll: number;
  payrollNextSeason: number;
  cash: number;
  market: number;
  fanInterest: number;
}

export function teamFinances(teamId: number): TeamFinances | null {
  if (!tableExists('team_financials')) return null;
  const r = db
    .prepare(
      `SELECT budget, player_payroll, player_payroll_next_season, cash,
              cash_trades_available, market, fan_interest
       FROM team_financials WHERE team_id = ?`
    )
    .get(teamId) as Record<string, number> | undefined;
  if (!r) return null;
  return {
    budget: r.budget ?? 0,
    payroll: r.player_payroll ?? 0,
    payrollNextSeason: r.player_payroll_next_season ?? 0,
    // OOTP exports `cash` as zero for every team; the money a club can
    // actually spend is cash_trades_available. Reporting the dead field made
    // the GM briefing and storylines announce "zero cash on hand" to clubs
    // sitting on millions.
    cash: r.cash_trades_available ?? r.cash ?? 0,
    market: r.market ?? 0,
    fanInterest: r.fan_interest ?? 0,
  };
}
