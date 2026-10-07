import { Router } from 'express';
import { db, hasColumns, tableExists } from './db.js';
import { contactProfiles } from './battedball.js';
import { padDate } from './rosterops.js';
import { answer, refuse, type Computed } from './computed.js';
import { projectedStarters } from './probableStarters.js';

export const gameplanRoutes = Router();

/**
 * Preparation for one particular game.
 *
 * The schedule already knew who you were playing; it could not tell you
 * anything useful about it. This assembles what a manager would want the night
 * before: who is starting for them, how your hitters have actually fared
 * against that man and against that club, and where the opponent is strong and
 * soft.
 *
 * Head-to-head samples in a single season are tiny, and a .400 average in ten
 * at-bats is noise wearing a suit. Every line here reports its own sample size
 * so it can be discounted honestly rather than quietly averaged into a
 * recommendation.
 */

const HAND: Record<number, string> = { 1: 'R', 2: 'L', 3: 'S' };
const teamLabel = `CASE WHEN t.name = t.nickname THEN t.name ELSE t.name || ' ' || t.nickname END`;

interface GameRow {
  game_id: number;
  date: string;
  home_team: number;
  away_team: number;
  played: number;
  starter0: number | null;
  starter1: number | null;
  game_type: number | null;
}

// The schedule itself is already served by schedule.ts; this module only adds
// the preparation for one game in it.

interface Hitter {
  player_id: number;
  name: string;
  positionName: string;
  bats: string;
}

const POSITION_NAMES: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};

/**
 * The position players on a club's active roster.
 *
 * `team_roster` carries the list a man is on — 1 is the active roster — and
 * where the export does not include it at all, the club's players are the next
 * best answer rather than an error: a plan built from the whole organisation is
 * worth more to a reader than a 500.
 */
function activeHitters(teamId: number) {
  const active = hasColumns('team_roster', 'team_id', 'player_id', 'list_id');
  return db
    .prepare(
      `SELECT p.player_id, p.first_name || ' ' || p.last_name AS name, p.position, p.bats
       FROM players p
       WHERE p.team_id = ? AND p.retired = 0 AND p.position != 1
         ${active ? 'AND p.player_id IN (SELECT player_id FROM team_roster WHERE team_id = p.team_id AND list_id = 1)' : ''}`
    )
    .all(teamId) as Array<{ player_id: number; name: string; position: number; bats: number }>;
}

/**
 * How our hitters have done against one pitcher, and against one club.
 *
 * Career head-to-head comes from OOTP's own batter-versus-pitcher table; the
 * per-club line is assembled from the at-bat rows, which carry the opposing
 * pitcher and therefore his team.
 */
function matchups(teamId: number, oppTeamId: number, pitcherId: number | null) {
  const hitters = activeHitters(teamId);

  const ids = hitters.map((h) => h.player_id);
  const byId = new Map<number, Hitter>(
    hitters.map((h) => [
      h.player_id,
      { player_id: h.player_id, name: h.name, positionName: POSITION_NAMES[h.position] ?? '?', bats: HAND[h.bats] ?? '?' },
    ])
  );

  const vsPitcher =
    pitcherId && ids.length > 0 && hasColumns('players_individual_batting_stats', 'player_id', 'opponent_id', 'ab', 'h', 'hr')
      ? (db
          .prepare(
            `SELECT player_id, SUM(ab) AS ab, SUM(h) AS h, SUM(hr) AS hr
             FROM players_individual_batting_stats
             WHERE opponent_id = ? AND player_id IN (${ids.map(() => '?').join(',')})
             GROUP BY player_id`
          )
          .all(pitcherId, ...ids) as Array<{ player_id: number; ab: number; h: number; hr: number }>)
      : [];

  const vsTeam =
    ids.length > 0 && hasColumns('players_at_bat_batting_stats', 'player_id', 'opponent_player_id', 'result')
      ? (db
          .prepare(
            `SELECT a.player_id,
                    COUNT(*) AS pa,
                    SUM(CASE WHEN a.result IN (6,7,8,9) THEN 1 ELSE 0 END) AS h,
                    SUM(CASE WHEN a.result IN (1,4,5) THEN 1 ELSE 0 END)
                      + SUM(CASE WHEN a.result IN (6,7,8,9) THEN 1 ELSE 0 END) AS ab,
                    SUM(CASE WHEN a.result = 9 THEN 1 ELSE 0 END) AS hr
             FROM players_at_bat_batting_stats a
             JOIN players op ON op.player_id = a.opponent_player_id
             WHERE op.team_id = ? AND a.player_id IN (${ids.map(() => '?').join(',')})
             GROUP BY a.player_id`
          )
          .all(oppTeamId, ...ids) as Array<{ player_id: number; pa: number; h: number; ab: number; hr: number }>)
      : [];

  const avg = (h: number, ab: number): number | null =>
    ab > 0 ? Number((h / ab).toFixed(3)) : null;

  return {
    vsPitcher: vsPitcher
      .filter((r) => r.ab > 0)
      .map((r) => ({ ...byId.get(r.player_id)!, ab: r.ab, h: r.h, hr: r.hr, avg: avg(r.h, r.ab) }))
      .sort((a, b) => b.ab - a.ab),
    vsTeam: vsTeam
      .filter((r) => r.ab > 0)
      .map((r) => ({ ...byId.get(r.player_id)!, ab: r.ab, h: r.h, hr: r.hr, avg: avg(r.h, r.ab) }))
      .sort((a, b) => b.ab - a.ab),
  };
}

/** What the opposing club does well and badly, so the plan has a shape. */
function scoutOpponent(oppTeamId: number) {
  const hitters = activeHitters(oppTeamId);

  const profiles = contactProfiles(hitters.map((h) => h.player_id));
  const dangerous = hitters
    .map((h) => ({
      player_id: h.player_id,
      name: h.name,
      positionName: POSITION_NAMES[h.position] ?? '?',
      bats: HAND[h.bats] ?? '?',
      ...(profiles.get(h.player_id) ?? {}),
    }))
    .filter((h) => (h.battedBalls ?? 0) >= 40)
    .sort((a, b) => (b.barrelPct ?? 0) - (a.barrelPct ?? 0))
    .slice(0, 5);

  return { dangerous };
}

/**
 * Run one optional half of the plan, and carry on without it if it fails.
 *
 * Returns what the reader should be told is absent alongside the fallback, so
 * an empty table is never left to look like a club with no history against
 * this pitcher.
 */
function attempt<T>(work: () => T, fallback: T, what: string): { value: T; missing: string | null } {
  try {
    return { value: work(), missing: null };
  } catch (err) {
    console.error(`[game-plan] ${what} could not be read:`, err);
    return { value: fallback, missing: what };
  }
}

/**
 * Everything worth knowing before one game.
 *
 * The opposing starter is taken from the game itself when the export names
 * one, and otherwise from OOTP's projected rotation — which is the usual case
 * for a game that has not been played.
 */
/** A game's plan (`GET /api/game-plan/:teamId/:gameId`): their starter, the matchups, their dangerous bats, what is missing. */
export type GamePlan = Exclude<ReturnType<typeof planOf>, null>;

/** One game's plan, or why there is none (the route's own answer; SWIFTUI_REBUILD.md N9). */
export function computeGamePlan(teamId: number, gameId: number): Computed<GamePlan> {
  if (!tableExists('games')) return refuse(400, 'No data imported yet');
  const plan = planOf(teamId, gameId);
  return plan ? answer(plan) : refuse(404, 'No such game');
}

gameplanRoutes.get('/game-plan/:teamId/:gameId', (req, res) => {
  const plan = computeGamePlan(Number(req.params.teamId), Number(req.params.gameId));
  if (!plan.ok) return res.status(plan.status).json({ error: plan.error });
  res.json(plan.body);
});

function planOf(teamId: number, gameId: number) {

  /*
   * Ask games.csv only for the columns this export actually has.
   *
   * The named starters are the ones that move: `starter0` and `starter1` are
   * not in every version of the export, and selecting them where they are
   * absent throws "no such column" — which is why pressing Plan on a save
   * without them returned a 500 on every game in the schedule. Their absence
   * is not a problem worth reporting to the reader, because the projected
   * rotation below is the answer for an unplayed game anyway.
   */
  const named = hasColumns('games', 'starter0', 'starter1');
  const g = db
    .prepare(
      `SELECT game_id, date, home_team, away_team, played,
              ${named ? 'starter0, starter1' : 'NULL AS starter0, NULL AS starter1'}
       FROM games WHERE game_id = ?`
    )
    .get(gameId) as GameRow | undefined;
  if (!g) return null;

  const home = g.home_team === teamId;
  const oppId = home ? g.away_team : g.home_team;
  const opp = db.prepare(`SELECT ${teamLabel} AS label FROM teams t WHERE team_id = ?`).get(oppId) as
    | { label: string }
    | undefined;

  // starter0 is the away side, starter1 the home side — the same mapping the
  // schedule page uses for a played game
  const namedStarter = home ? g.starter0 : g.starter1;
  // An unplayed game's starter is the opponent's projection at this game's place among their own games still to play
  // (`probableStarters.ts`, the schedule's own reading); none when the projection does not reach that far
  const pitcherId = namedStarter || (g.played === 1 ? null : projectedStarters([oppId]).starterOf(oppId, g.game_id));

  const pitcher = pitcherId
    ? (db
        .prepare(
          `SELECT p.player_id, p.first_name || ' ' || p.last_name AS name, p.throws, p.age
           FROM players p WHERE p.player_id = ?`
        )
        .get(pitcherId) as { player_id: number; name: string; throws: number; age: number } | undefined)
    : undefined;

  /*
   * The history and the scouting are the extras, and an extra must not be able
   * to take the page down with it. Both read tables that not every export
   * carries, in shapes that differ between versions of the game; before this,
   * one unfamiliar column anywhere in them meant no plan at all — not a
   * thinner plan, no plan, on every game in the schedule.
   */
  const matchupsOrNothing = attempt(
    () => matchups(teamId, oppId, pitcherId ?? null),
    { vsPitcher: [], vsTeam: [] },
    'the head-to-head history'
  );
  const scouting = attempt(() => scoutOpponent(oppId), { dangerous: [] }, "the opponent's contact quality");

  return {
    game: {
      game_id: g.game_id,
      date: padDate(g.date),
      isHome: home,
      played: g.played === 1,
      opponent: { team_id: oppId, label: opp?.label ?? 'Unknown' },
    },
    starter: pitcher
      ? {
          player_id: pitcher.player_id,
          name: pitcher.name,
          throws: HAND[pitcher.throws] ?? '?',
          age: pitcher.age,
          // A projected starter is OOTP's guess and can change; say so
          confirmed: Boolean(namedStarter),
        }
      : null,
    // Which platoon side to build the card against. The lineup builder already
    // ranks hitters by their split, so the page asks it for this hand rather
    // than duplicating the ordering here.
    lineupVs: pitcher ? (HAND[pitcher.throws] === 'L' ? 'l' : 'r') : 'r',
    matchups: matchupsOrNothing.value,
    opponent: scouting.value,
    // Anything the export could not supply, said plainly rather than shown as
    // an empty table the reader has to interpret
    missing: [matchupsOrNothing.missing, scouting.missing].filter(Boolean) as string[],
  };
}

/**
 * Your own record, which is the one story the app never told.
 *
 * Every other page is about the club; this is about the man running it. OOTP
 * keeps a row per season for the human manager — record, where he finished,
 * whether he made the playoffs, whether he was fired — and it grows by one
 * line every year you play.
 */
/** One season of the GM's own record, whichever club he ran. */
export interface TenureSeason {
  year: number;
  club: string;
  g: number;
  w: number;
  l: number;
  pct: number;
  finish: number;
  gb: number | null;
  madePlayoffs: boolean;
  wonPlayoffs: boolean;
  fired: boolean;
  bestHitter: string | null;
  bestPitcher: string | null;
  bestRookie: string | null;
}

/** The GM's seasons and their totals; just `{ seasons: [] }` on an export without the manager's history. */
export interface Tenure {
  seasons: TenureSeason[];
  totals?: { seasons: number; w: number; l: number; playoffs: number; titles: number; pct: number | null };
  teamId?: number;
}

/**
 * The GM's own record (`/api/tenure/:teamId`, extracted for the Mac app's League Office, N12): every season of the human
 * manager's history, whichever club (the id is only handed back), with the season's best players' names read in one
 * batch rather than one read per name.
 */
export function computeTenure(teamId: number): Computed<Tenure> {
  if (!tableExists('human_manager_history_record')) return answer({ seasons: [] });

  const records = db
    .prepare(
      `SELECT year, team_id, g, w, l, pos, pct, gb FROM human_manager_history_record ORDER BY year`
    )
    .all() as Array<{ year: number; team_id: number; g: number; w: number; l: number; pos: number; pct: number; gb: number | null }>;

  const extra = tableExists('human_manager_history')
    ? (db
        .prepare(
          `SELECT year, team_id, made_playoffs, won_playoffs, fired,
                  best_hitter_id, best_pitcher_id, best_rookie_id
           FROM human_manager_history`
        )
        .all() as Array<Record<string, number>>)
    : [];
  const byYear = new Map(extra.map((e) => [`${e.year}:${e.team_id}`, e]));

  // Every name the seasons ask for, read at once (in chunks the database's parameter limit allows); a player read twice
  // keeps his first row, as a lookup of one would
  const wanted = new Set<number>();
  for (const r of records) {
    const e = byYear.get(`${r.year}:${r.team_id}`);
    for (const id of [e?.best_hitter_id, e?.best_pitcher_id, e?.best_rookie_id]) if (id) wanted.add(id);
  }
  const names = new Map<number, string | null>();
  const ids = [...wanted];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const p of db
      .prepare(`SELECT player_id, first_name || ' ' || last_name AS n FROM players WHERE player_id IN (${chunk.map(() => '?').join(',')})`)
      .all(...chunk) as Array<{ player_id: number; n: string | null }>) {
      if (!names.has(p.player_id)) names.set(p.player_id, p.n);
    }
  }
  const nameOf = (id: number | undefined): string | null => (id ? names.get(id) ?? null : null);

  const labels = new Map(
    (db.prepare(`SELECT team_id, ${teamLabel} AS label FROM teams t`).all() as Array<{ team_id: number; label: string }>)
      .map((r) => [r.team_id, r.label])
  );

  const seasons = records.map((r) => {
    const e = byYear.get(`${r.year}:${r.team_id}`);
    return {
      year: r.year,
      club: labels.get(r.team_id) ?? 'Unknown',
      g: r.g, w: r.w, l: r.l,
      pct: r.pct,
      finish: r.pos,
      gb: r.gb,
      madePlayoffs: e?.made_playoffs === 1,
      wonPlayoffs: e?.won_playoffs === 1,
      fired: e?.fired === 1,
      bestHitter: nameOf(e?.best_hitter_id),
      bestPitcher: nameOf(e?.best_pitcher_id),
      bestRookie: nameOf(e?.best_rookie_id),
    };
  });

  const totals = seasons.reduce(
    (a, s) => ({
      seasons: a.seasons + 1,
      w: a.w + s.w,
      l: a.l + s.l,
      playoffs: a.playoffs + (s.madePlayoffs ? 1 : 0),
      titles: a.titles + (s.wonPlayoffs ? 1 : 0),
    }),
    { seasons: 0, w: 0, l: 0, playoffs: 0, titles: 0 }
  );

  return answer({
    seasons,
    totals: { ...totals, pct: totals.w + totals.l > 0 ? totals.w / (totals.w + totals.l) : null },
    // The current club, so a page opened on someone else's team says so
    teamId,
  });
}

gameplanRoutes.get('/tenure/:teamId', (req, res) => {
  const computed = computeTenure(Number(req.params.teamId));
  if (!computed.ok) return res.status(computed.status).json({ error: computed.error });
  res.json(computed.body);
});
