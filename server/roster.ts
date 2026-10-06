/**
 * A club's roster as the Roster page reads it (`GET /api/roster/:teamId`), moved out of `api.ts` so the Mac app's Rosters
 * view (SWIFTUI_REBUILD.md N9) reads exactly what the route serves. Ratings are read as the evidence reads them (our
 * scouts' full reports when the export carries them, D-067), the one scouting figure through `loadScoutedAbilities`.
 */
import { db, locateColumn, tableColumns, tableExists } from './db.js';
import { assignmentContextsFor } from './playerContext.js';
import { computeBatting, computePitching, leagueBaseline } from './stats.js';
import { loadScoutedAbilities, ratingFillOf, ratingFrom, type RatingTable } from './scoutedEvidence.js';
import { contactProfiles } from './battedball.js';
import { standingOf, type StandingFields } from './health.js';
import { answer, refuse, type Computed } from './computed.js';

/** Rating fields we surface, with candidate locations per OOTP schema version. */
const RATING_SPECS: Array<{ key: string; candidates: Array<[string, string]> }> = [
  { key: 'contact', candidates: [['players_batting', 'batting_ratings_overall_contact']] },
  { key: 'gap', candidates: [['players_batting', 'batting_ratings_overall_gap']] },
  { key: 'power', candidates: [['players_batting', 'batting_ratings_overall_power']] },
  { key: 'eye', candidates: [['players_batting', 'batting_ratings_overall_eye']] },
  { key: 'avoidK', candidates: [['players_batting', 'batting_ratings_overall_strikeouts']] },
  { key: 'contactPot', candidates: [['players_batting', 'batting_ratings_talent_contact']] },
  { key: 'powerPot', candidates: [['players_batting', 'batting_ratings_talent_power']] },
  { key: 'eyePot', candidates: [['players_batting', 'batting_ratings_talent_eye']] },
  { key: 'stuff', candidates: [['players_pitching', 'pitching_ratings_overall_stuff']] },
  { key: 'movement', candidates: [['players_pitching', 'pitching_ratings_overall_movement']] },
  { key: 'control', candidates: [['players_pitching', 'pitching_ratings_overall_control']] },
  { key: 'stuffPot', candidates: [['players_pitching', 'pitching_ratings_talent_stuff']] },
  { key: 'movementPot', candidates: [['players_pitching', 'pitching_ratings_talent_movement']] },
  { key: 'controlPot', candidates: [['players_pitching', 'pitching_ratings_talent_control']] },
  {
    key: 'speed',
    candidates: [
      ['players_batting', 'running_ratings_speed'],
      ['players', 'running_ratings_speed'],
    ],
  },
];

const POSITION_NAMES: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};
// Verified against a real OOTP 27 export (Judge 1/1 R/R, Soto 2/2 L/L, Raleigh bats 3 S)
const BATS: Record<number, string> = { 1: 'R', 2: 'L', 3: 'S' };
const THROWS: Record<number, string> = { 1: 'R', 2: 'L' };

/** A club's roster (`GET /api/roster/:teamId`): each man's ratings, scouted figure, season lines, standing and assignment. */
export type ClubRoster = ReturnType<typeof rosterOf>;

/** A club's roster, or why it cannot be read (the route's own answer; SWIFTUI_REBUILD.md N9). */
export function computeRoster(teamId: number): Computed<ClubRoster> {
  if (!tableExists('players')) return refuse(400, 'No player data imported yet');
  return answer(rosterOf(teamId));
}

/** A roster row as the export's `players` table gives it (a column the export lacks is null). */
interface RosterRow {
  player_id: number;
  first_name: string | null;
  last_name: string | null;
  age: number | null;
  position: number | null;
  role: number | null;
  bats: number | null;
  throws: number | null;
  uniform_number: number | null;
}

function rosterOf(teamId: number) {
  const cols = tableColumns('players');
  const pick = (...names: string[]) => names.find((n) => cols.includes(n));
  const select = [
    `"${pick('player_id') ?? cols[0]}" AS player_id`,
    pick('first_name') ? `"first_name"` : `NULL AS first_name`,
    pick('last_name') ? `"last_name"` : `NULL AS last_name`,
    pick('age') ? `"age"` : `NULL AS age`,
    pick('position') ? `"position"` : `NULL AS position`,
    pick('role') ? `"role"` : `NULL AS role`,
    pick('bats') ? `"bats"` : `NULL AS bats`,
    pick('throws') ? `"throws"` : `NULL AS throws`,
    pick('uniform_number') ? `"uniform_number"` : `NULL AS uniform_number`,
  ].join(', ');

  /**
   * Who is actually on this club's roster.
   *
   * `players.team_id` is not a roster. OOTP parks players on a club without
   * giving them a spot — newly signed international free agents sit on the
   * parent club until they are assigned, and unsigned veterans keep pointing at
   * their last team — so a bare team_id swept 132 men across the league onto
   * major-league roster pages who were not on those rosters.
   *
   * team_roster with list_id = 1 is OOTP's own answer and works at every level:
   * for a major-league club it is the active roster plus the injured list, and
   * for an affiliate it is that affiliate's full roster. The roster-status flags
   * cannot be used here — is_active means "on the MLB active roster", so it
   * would empty every minor-league page.
   */
  const useRosterList = tableExists('team_roster');
  const players = db
    .prepare(
      useRosterList
        ? `SELECT ${select} FROM players
           WHERE player_id IN (SELECT player_id FROM team_roster WHERE team_id = ? AND list_id = 1)`
        : // An export without the table behaves as it always did
          `SELECT ${select} FROM players WHERE team_id = ?`
    )
    .all(teamId) as Array<RosterRow & Record<string, unknown>>;

  // Attach ratings from wherever they live in this export's schema
  const ratingSources = new Map<string, [string, string]>();
  for (const spec of RATING_SPECS) {
    const loc = locateColumn(spec.candidates);
    if (loc) ratingSources.set(spec.key, loc);
  }
  const byTable = new Map<string, Array<{ key: string; column: string }>>();
  for (const [key, [table, column]] of ratingSources) {
    if (!byTable.has(table)) byTable.set(table, []);
    byTable.get(table)!.push({ key, column });
  }
  /**
   * Only this roster's men. The stat blocks below were being computed for every
   * player in the league — some twelve thousand rows and as many calls into the
   * stat engine — to display forty of them.
   */
  const rosterIds = players.map((p) => p.player_id as number);
  const idFilter = rosterIds.length > 0 ? `AND player_id IN (${rosterIds.map(() => '?').join(',')})` : '';

  const ratingsByPlayer = new Map<number, Record<string, unknown>>();
  for (const [table, specs] of byTable) {
    if (!tableColumns(table).includes('player_id')) continue;
    // A ratings table is read as the evidence reads it: our scouts' full reports when the export carries them (D-067);
    // a grade their file lacks is unknown, never the main table's
    const family = ({ players_batting: 'batting', players_pitching: 'pitching', players_fielding: 'fielding' } as Record<string, RatingTable>)[table];
    const source = family ? ratingFrom(family) : null;
    const from = source?.from ?? `"${table}"`;
    const sel = specs.map((s) => (source && !source.columns.has(s.column) ? `NULL AS "${s.key}"` : `"${s.column}" AS "${s.key}"`)).join(', ');
    // Every ratings table was being read whole — every player in the save,
    // several times over — to fill in one roster
    const rows = db
      .prepare(`SELECT player_id, ${sel} FROM ${from} WHERE player_id IN (${rosterIds.map(() => '?').join(',')})`)
      .all(...rosterIds) as Array<Record<string, unknown> & { player_id: number }>;
    for (const row of rows) {
      const { player_id, ...rest } = row;
      // Mutated in place rather than rebuilt: the spread was copying the whole
      // accumulated object once per row
      const existing = ratingsByPlayer.get(player_id);
      if (existing) Object.assign(existing, rest);
      else ratingsByPlayer.set(player_id, rest);
    }
  }

  // Current-season stats. Rate and league-relative stats (OPS+, wRC+, ERA+)
  // are computed server-side so every page shares one source of truth.
  const teamRow = db.prepare(`SELECT league_id, level FROM teams WHERE team_id = ?`).get(teamId) as
    | { league_id: number; level: number }
    | undefined;
  const statYear = tableExists('players_career_batting_stats')
    ? (db.prepare(`SELECT MAX(year) AS y FROM players_career_batting_stats`).get() as { y: number }).y
    : null;
  // League-relative stats are only meaningful against a baseline from the same
  // league and level, so minor-league clubs are compared to their own league.
  const baseline =
    teamRow && statYear !== null
      ? leagueBaseline(teamRow.league_id, statYear, teamRow.level)
      : null;

  const battingByPlayer = new Map<number, Record<string, number | null>>();
  if (tableExists('players_career_batting_stats') && statYear !== null && baseline && teamRow) {
    const rows = db
      .prepare(
        `SELECT player_id, SUM(pa) AS pa, SUM(ab) AS ab, SUM(h) AS h, SUM(d) AS d, SUM(t) AS t3,
                SUM(hr) AS hr, SUM(bb) AS bb, SUM(ibb) AS ibb, SUM(hp) AS hp, SUM(sf) AS sf,
                SUM(k) AS k, SUM(sb) AS sb, SUM(cs) AS cs, SUM(r) AS r, SUM(rbi) AS rbi,
                SUM(war) AS war
         FROM players_career_batting_stats
         -- A drafted amateur's school season lives here under no league at
         -- all, and summing it in credits him with what he did to schoolboys
         --
         -- And only what he did AT THIS LEVEL. A shuttling player has a line at
         -- each, and adding them together produces a season nobody had: a
         -- reader was shown a man recommended as a trade target on .313/.372/
         -- .552 and a 155 wRC+ when almost all of it was Triple-A. Worse, the
         -- rate stats below are scaled against this club's own league, so a
         -- Triple-A line was being measured against major-league pitching and
         -- coming out extraordinary.
         WHERE year = ? AND split_id = 1 AND league_id != 0 AND level_id = ?
               ${idFilter} GROUP BY player_id`
      )
      .all(statYear, teamRow.level, ...rosterIds) as Array<Record<string, number>>;
    for (const row of rows) {
      battingByPlayer.set(row.player_id, computeBatting(row, baseline, teamId));
    }
  }

  /*
   * The one scouting figure on a roster row (Player Value phase 6d, PLAYER_VALUE.md Part 8): the organization's scouted
   * tools averaged now and at their ceiling, 20-80, through the evidence boundary (D-017), the card header's "Scouted"
   * figure. OOTP's Overall and Potential (players_value) are not the organization's view and are not read. A tool that
   * has not been graded leaves the average unknown, never a stand-in (D-018).
   */
  const abilities = loadScoutedAbilities(rosterIds);

  /*
   * Where each man stands: designated, on waivers, on the injured list, or
   * simply active. OOTP's roster list keeps designated players on it, so
   * without this a man on the DFA clock reads as a regular — which is exactly
   * how the manager came to call one the starting third baseman.
   */
  const standingByPlayer = new Map<number, ReturnType<typeof standingOf>>();
  if (tableExists('players_roster_status') && rosterIds.length > 0) {
    // Named one at a time against the export's own schema: OOTP's roster-status
    // table has varied, and a column this app expects but a save does not have
    // would take the whole roster page down rather than losing one badge
    const statusCols = tableColumns('players_roster_status');
    const want = [
      'is_active', 'is_on_dl', 'is_on_dl60',
      'designated_for_assignment', 'days_on_dfa_left', 'is_on_waivers',
    ].filter((c) => statusCols.includes(c));
    const rows = db
      .prepare(
        `SELECT rs.player_id${want.map((c) => `, rs."${c}"`).join('')},
                p.injury_is_injured, p.injury_dtd_injury, p.injury_left
         FROM players_roster_status rs JOIN players p ON p.player_id = rs.player_id
         WHERE rs.player_id IN (${rosterIds.map(() => '?').join(',')})`
      )
      .all(...rosterIds) as Array<StandingFields & { player_id: number }>;
    for (const r of rows) standingByPlayer.set(r.player_id, standingOf(r));
  }

  // Contact quality for the whole roster in one pass — the batted-ball table is
  // large, so it is queried once per page rather than once per player
  const contactByPlayer = contactProfiles(players.map((p) => p.player_id as number));

  // Season fielding for the roster's optional defensive columns. Summed across
  // positions: a utility man's total workload is the useful number in a roster
  // row, and his split by position is on his card.
  const fieldingByPlayer = new Map<number, Record<string, number | null>>();
  if (tableExists('players_career_fielding_stats') && statYear !== null) {
    const rows = db
      .prepare(
        `SELECT player_id, SUM(g) AS fg, SUM(gs) AS fgs, SUM(ip) AS finn,
                SUM(po) AS po, SUM(a) AS a, SUM(e) AS e, SUM(dp) AS dp
         FROM players_career_fielding_stats
         -- No split filter: OOTP writes the CURRENT season's fielding with
         -- split_id 0 and past seasons with 1, so filtering on 1 silently
         -- dropped this year entirely. Each year carries exactly one split id,
         -- so leaving it out cannot double count. Batting and pitching are
         -- different — they really do split 1/2/3 — and keep their filter.
         --
         -- This club's level, for the same reason the batting above is: a man
         -- who has shuttled fields at each, and adding them together describes
         -- nobody. On this roster it was showing 587 innings and six errors
         -- for a shortstop who has played 28 innings in the majors and made
         -- none of them.
         WHERE year = ? AND level_id = ? ${idFilter} GROUP BY player_id`
      )
      .all(statYear, teamRow?.level ?? 1, ...rosterIds) as Array<Record<string, number>>;
    for (const r of rows) {
      const chances = (r.po ?? 0) + (r.a ?? 0) + (r.e ?? 0);
      const innings = r.finn ?? 0;
      fieldingByPlayer.set(r.player_id, {
        fg: r.fg ?? 0,
        fgs: r.fgs ?? 0,
        finn: innings,
        po: r.po ?? 0,
        a: r.a ?? 0,
        e: r.e ?? 0,
        dp: r.dp ?? 0,
        fpct: chances > 0 ? Math.round(((r.po + r.a) / chances) * 1000) / 1000 : null,
        // Chances handled per nine innings — the standard way to express range
        rf9: innings > 0 ? Math.round((((r.po + r.a) / innings) * 9) * 100) / 100 : null,
      });
    }
  }

  const pitchingByPlayer = new Map<number, Record<string, number | null>>();
  if (tableExists('players_career_pitching_stats') && statYear !== null && baseline && teamRow) {
    const rows = db
      .prepare(
        `SELECT player_id, SUM(outs) AS outs, SUM(er) AS er, SUM(ra) AS ra, SUM(ha) AS ha,
                SUM(bb) AS bb, SUM(k) AS k, SUM(hra) AS hra, SUM(bf) AS bf, SUM(g) AS g,
                SUM(gs) AS gs, SUM(w) AS w, SUM(l) AS l, SUM(s) AS sv, SUM(hld) AS hld,
                SUM(war) AS war
         FROM players_career_pitching_stats
         -- This club's level only, for the same reason as the batting above
         WHERE year = ? AND split_id = 1 AND league_id != 0 AND level_id = ?
               ${idFilter} GROUP BY player_id`
      )
      .all(statYear, teamRow.level, ...rosterIds) as Array<Record<string, number>>;
    for (const row of rows) {
      pitchingByPlayer.set(row.player_id, computePitching(row, baseline, teamId));
    }
  }

  // Scale bar rendering to the highest rating in this export
  let ratingMax = 0;
  for (const r of ratingsByPlayer.values()) {
    for (const v of Object.values(r)) {
      if (typeof v === 'number' && v > ratingMax) ratingMax = v;
    }
  }

  // Why each player is where he is, read from explicit log evidence against the
  // export. Only players for whom that changes the reading are included
  const assignmentByPlayer = assignmentContextsFor(rosterIds);

  const roster = players.map((p) => {
    const id = p.player_id as number;
    const pos = p.position as number | null;
    return {
      ...p,
      positionName: pos !== null && POSITION_NAMES[pos] ? POSITION_NAMES[pos] : String(pos ?? '?'),
      batsName: BATS[p.bats as number] ?? String(p.bats ?? '?'),
      throwsName: THROWS[p.throws as number] ?? String(p.throws ?? '?'),
      ratings: ratingsByPlayer.get(id) ?? {},
      // OSA's view filling in for our scouts (D-067): a quiet mark and its sentence for the grades; null otherwise
      ratingsFill: ratingFillOf(id),
      fielding: fieldingByPlayer.get(id) ?? null,
      scouted: (() => {
        const a = abilities.for(id);
        return {
          now: a.current,
          ceiling: a.potential,
          status: a.status,
          missing: { now: [...a.missing.current], ceiling: [...a.missing.potential] },
        };
      })(),
      batting: battingByPlayer.get(id) ?? null,
      pitching: pitchingByPlayer.get(id) ?? null,
      contact: contactByPlayer.get(id) ?? null,
      standing: standingByPlayer.get(id) ?? null,
      assignment: assignmentByPlayer.get(id) ?? null,
    };
  });

  return { players: roster, ratingMax, ratingKeys: [...ratingSources.keys()] };
}
