import { Router } from 'express';
import { freshnessCue, getDataStatus, type DataStatus } from './dataStatus.js';
import { db, tableColumns, tableExists } from './db.js';
import { leagueRulesForLeague } from './leagueRules.js';
import {
  clubFinances, groupWinsOf, playerValues, productionHeadlineOf, TRADE_COMBINATION_POLICY, tradeValueOf,
  type PlayerValuation,
} from './playerValue.js';
import type { Sourced } from './provenance.js';
import { currentGameDate, ON_ROSTER } from './valuation.js';

/**
 * The club's whole history, which the export has carried all along.
 *
 * team_history_record holds a row per season back to the franchise's first —
 * 144 of them for the Yankees, starting in 1882 — and team_history says who the
 * best hitter and pitcher were and how the year ended. None of it was read.
 */

export const franchiseRoutes = Router();

interface SeasonRow {
  year: number;
  g: number; w: number; l: number; pct: number; pos: number; gb: number;
  name: string | null;
  made_playoffs: number | null;
  won_playoffs: number | null;
  best_hitter_id: number | null;
  best_pitcher_id: number | null;
  payroll: number | null;
  attendance: number | null;
}

franchiseRoutes.get('/franchise/:teamId', (req, res) => {
  const teamId = Number(req.params.teamId);
  if (!tableExists('team_history_record')) {
    return res.status(400).json({ error: 'This export has no franchise history' });
  }

  const hasHistory = tableExists('team_history');
  const hasFinancials = tableExists('team_history_financials');

  const rows = db
    .prepare(
      `SELECT r.year, r.g, r.w, r.l, r.pct, r.pos, r.gb
              ${hasHistory ? `, h.name, h.made_playoffs, h.won_playoffs, h.best_hitter_id, h.best_pitcher_id` : ''}
              ${hasFinancials ? `, f.player_expenses AS payroll, f.attendance` : ''}
       FROM team_history_record r
       ${hasHistory ? 'LEFT JOIN team_history h ON h.team_id = r.team_id AND h.year = r.year' : ''}
       ${hasFinancials ? 'LEFT JOIN team_history_financials f ON f.team_id = r.team_id AND f.year = r.year' : ''}
       WHERE r.team_id = ? AND r.g > 0
       ORDER BY r.year DESC`
    )
    .all(teamId) as SeasonRow[];

  if (rows.length === 0) return res.json({ seasons: [], summary: null });

  // One lookup for every player named as a season's best, rather than one per row
  const ids = [
    ...new Set(
      rows.flatMap((r) => [r.best_hitter_id, r.best_pitcher_id]).filter((v): v is number => !!v)
    ),
  ];
  const names = new Map<number, string>();
  if (ids.length > 0) {
    const holes = ids.map(() => '?').join(',');
    for (const p of db
      .prepare(`SELECT player_id, first_name || ' ' || last_name AS name FROM players WHERE player_id IN (${holes})`)
      .all(...ids) as Array<{ player_id: number; name: string }>) {
      names.set(p.player_id, p.name);
    }
  }

  const seasons = rows.map((r) => ({
    year: r.year,
    w: r.w,
    l: r.l,
    pct: r.pct,
    finish: r.pos,
    gb: r.gb,
    name: r.name ?? null,
    madePlayoffs: r.made_playoffs === 1,
    wonTitle: r.won_playoffs === 1,
    bestHitter: r.best_hitter_id ? { player_id: r.best_hitter_id, name: names.get(r.best_hitter_id) ?? null } : null,
    bestPitcher: r.best_pitcher_id ? { player_id: r.best_pitcher_id, name: names.get(r.best_pitcher_id) ?? null } : null,
    payroll: r.payroll ?? null,
    attendance: r.attendance ?? null,
  }));

  const wins = seasons.reduce((sum, s) => sum + s.w, 0);
  const losses = seasons.reduce((sum, s) => sum + s.l, 0);
  const best = [...seasons].sort((a, b) => b.pct - a.pct)[0];
  const worst = [...seasons].sort((a, b) => a.pct - b.pct)[0];

  res.json({
    seasons,
    summary: {
      seasons: seasons.length,
      firstYear: seasons[seasons.length - 1].year,
      lastYear: seasons[0].year,
      wins,
      losses,
      pct: wins + losses > 0 ? wins / (wins + losses) : 0,
      titles: seasons.filter((s) => s.wonTitle).length,
      playoffs: seasons.filter((s) => s.madePlayoffs).length,
      bestSeason: best ? { year: best.year, w: best.w, l: best.l } : null,
      worstSeason: worst ? { year: worst.year, w: worst.w, l: worst.l } : null,
    },
  });
});

/**
 * Every organization side by side (Player Value phase 6d, PLAYER_VALUE.md Part 8, consumer 5).
 *
 * The rest of the app answers questions about one club. This answers the ones that need the others in frame: how strong is
 * the major-league roster for the rest of the season, how much is the farm about to add, what are the roster's contracts
 * worth beyond what they pay, and what does the club spend. It used to add up OOTP's own overall and talent values
 * (`players_value`) and rank the clubs by them: a hidden score the organization cannot see (D-017), ranked. Now every figure
 * is Player Value's, as each player is served, or an objective fact of the export, and nothing is ranked; the page orders
 * clubs only by a column it shows.
 *
 *   the roster      the club's rostered players (active or on the injured list, as Contracts lists them): their expected
 *                   wins for the rest of this season (the whole season before it starts), and their contract value
 *   the farm        the organization's players on its affiliates: their expected wins next season, and the one expected to
 *                   add the most, with his figure
 *   money           OOTP's payroll and budget as Club Finances reads them; a figure the export lacks is unknown, never $0
 *   combining       each sum is its players' served figures combined as independent, the way Payroll combines players
 *                   (`TRADE_COMBINATION_POLICY`, the owner's Payroll rule): around the sum of the most likely readings, each
 *                   player's own distance combined across players, an open season kept at its edges; the every-player-at-
 *                   his-edge sum is kept beside it
 *   unknown         a player whose figure is not known is named with his reason and left out; the sum says so (D-018)
 */

const POSITION_NAMES: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};

const LABEL = TRADE_COMBINATION_POLICY.label;

export interface OrgFigure {
  low: number;
  central: number | null;
  high: number;
  centralRange: { low: number; high: number } | null;
}

export interface OrgLeftOut {
  player_id: number;
  name: string;
  /** One short sentence, for the page. */
  reason: string;
}

/** A club's sum of one figure over a group of its players. */
export interface OrgSum {
  unit: 'wins' | 'dollars';
  /** 'none': no player in the group has the figure (or the group is empty); never a zero. */
  status: 'known' | 'none';
  figure: OrgFigure | null;
  /** Every player at his low edge, summed, to every player at his high edge. */
  edges: { low: number; high: number } | null;
  counted: number;
  /** The players summed, so any reader can check the sum against each one's served figure. */
  playerIds: number[];
  excluded: OrgLeftOut[];
  text: string;
}

type Group = Array<{ player_id: number; name: string }>;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const winsText = (v: number): string => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;

function leavesOut(excluded: OrgLeftOut[]): string {
  return excluded.length === 0 ? '' : ` Leaves out ${plural(excluded.length, 'player')} whose figure isn't known, each named with his reason; never counted as zero.`;
}

/** Wins over a group: each player's served band, or his reason; combined as independent by Player Value (`groupWinsOf`). */
function winsSum(group: Group, read: (id: number) => { band: { low: number; central: number; high: number } | null; reason: string }, what: string): OrgSum {
  const names = new Map(group.map((p) => [p.player_id, p.name]));
  const sum = groupWinsOf(group.map((p) => {
    const r = read(p.player_id);
    return { playerId: p.player_id, wins: r.band, reason: r.reason };
  }));
  const excluded = sum.excluded.map((x) => ({ player_id: x.playerId, name: names.get(x.playerId) ?? `Player ${x.playerId}`, reason: x.reason }));
  if (sum.status !== 'known' || !sum.figure || !sum.edges) {
    return {
      unit: 'wins', status: 'none', figure: null, edges: null, counted: 0, playerIds: [], excluded,
      text: group.length === 0 ? `No players ${what}.` : `No player ${what} has a projection, so there is no total.${leavesOut(excluded)}`,
    };
  }
  return {
    unit: 'wins', status: 'known', figure: sum.figure, edges: sum.edges, counted: sum.counted.length, playerIds: sum.counted, excluded,
    text: `Expected wins above replacement ${what}, summed over ${plural(sum.counted.length, 'player')}; ${LABEL}: around the sum of ` +
      `each player's most likely wins, each player's own distance from his combined across players. Every player at his edge: ` +
      `${winsText(sum.edges.low)} to ${winsText(sum.edges.high)} wins.${leavesOut(excluded)}`,
  };
}

/** Contract value over a group: the Trade Center's reading of a side (`tradeValueOf`), each player's figure as served. */
function contractSum(group: Group, valuations: Map<number, PlayerValuation>): OrgSum {
  const read = tradeValueOf({ sent: [], received: group.map((p) => ({ playerId: p.player_id, surplus: valuations.get(p.player_id)?.surplus ?? null })) });
  const side = read.received;
  const names = new Map(group.map((p) => [p.player_id, p.name]));
  const excluded = side.players.filter((p) => !p.counted)
    .map((p) => ({ player_id: p.playerId, name: names.get(p.playerId) ?? `Player ${p.playerId}`, reason: p.notCounted ?? 'Not valued yet.' }));
  const unit = read.unit ?? 'dollars';
  if (side.total.status !== 'known' || !side.total.figure || !side.total.edges) {
    return {
      unit, status: 'none', figure: null, edges: null, counted: 0, playerIds: [], excluded,
      text: group.length === 0 ? 'No players on the roster.' : `No player on the roster could be valued, so there is no total.${leavesOut(excluded)}`,
    };
  }
  return {
    unit, status: 'known', figure: side.total.figure, edges: side.total.edges, counted: side.total.counted,
    playerIds: side.players.filter((p) => p.counted).map((p) => p.playerId), excluded,
    text: `Contract value${unit === 'wins' ? ' (in wins: this league\'s dollars aren\'t known)' : ''} of the roster: ${side.total.text}`,
  };
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** A figure's most likely reading: its central twice, or the range of its readings; never a midpoint made up between them. */
const likelyOf = (f: OrgFigure | null): { low: number; high: number } | null =>
  (f === null ? null : f.central !== null ? { low: f.central, high: f.central } : f.centralRange);

/** The league's middle club on a figure: the median of the clubs' most likely readings, each edge of a range on its own. */
const middleOf = (figures: Array<OrgFigure | null>): { low: number; high: number } | null => {
  const likely = figures.map(likelyOf).filter((x): x is { low: number; high: number } => x !== null);
  const low = median(likely.map((x) => x.low));
  const high = median(likely.map((x) => x.high));
  return low === null || high === null ? null : { low, high };
};

const moneyOf = (s: Sourced<number>) => ({ value: s.value, source: s.source, note: s.note ?? null });

/**
 * The page. `status` is how current the export is (D-022): handed to Player Value as `currentState`, as Contracts does, so a
 * stale export leaves what rests on service time not established, and said on the page with the game date (A-20).
 */
export function computeOrgComparison(orgId: number, status: DataStatus = getDataStatus()) {
  const org = db.prepare(`SELECT league_id FROM teams WHERE team_id = ?`).get(orgId) as { league_id: number } | undefined;
  if (!org) throw new Error('Unknown org');
  // The season is the league's own, as exported; never the wall-clock year (D-022)
  const rules = leagueRulesForLeague(org.league_id).contract;
  const season = rules.season.value;
  if (season === null) throw new Error(`The league's current season is not in the export: ${rules.season.note ?? 'no source states it'}`);
  const cue = freshnessCue(status);

  const teamColumns = new Set(tableColumns('teams'));
  const clubs = db
    .prepare(
      `SELECT team_id, CASE WHEN name = nickname OR nickname IS NULL THEN name ELSE name || ' ' || nickname END AS label,
              ${teamColumns.has('abbr') ? 'abbr' : 'NULL AS abbr'}
       FROM teams WHERE level = 1 ${teamColumns.has('allstar_team') ? 'AND allstar_team = 0' : ''} AND league_id = ?
       ORDER BY label`
    )
    .all(org.league_id) as Array<{ team_id: number; label: string; abbr: string | null }>;
  const clubIds = clubs.map((c) => c.team_id);
  const holes = clubIds.map(() => '?').join(',');

  // The major-league roster: the club's players on its active roster or injured list, as Contracts lists them
  const roster = clubIds.length === 0 ? [] : db
    .prepare(
      `SELECT p.player_id, p.team_id AS club, p.first_name || ' ' || p.last_name AS name
       FROM players p LEFT JOIN players_roster_status rs ON rs.player_id = p.player_id
       WHERE p.team_id IN (${holes}) AND p.retired = 0 AND ${ON_ROSTER}`
    )
    .all(...clubIds) as Array<{ player_id: number; club: number; name: string }>;
  // The farm: the organization's players on its affiliates
  const farm = clubIds.length === 0 || !tableColumns('players').includes('organization_id') ? [] : db
    .prepare(
      `SELECT p.player_id, p.organization_id AS club, p.first_name || ' ' || p.last_name AS name, p.age, p.position,
              t.level, ${teamColumns.has('abbr') ? 't.abbr' : 'NULL'} AS team
       FROM players p JOIN teams t ON t.team_id = p.team_id
       WHERE p.organization_id IN (${holes}) AND t.level > 1 AND p.retired = 0`
    )
    .all(...clubIds) as Array<{ player_id: number; club: number; name: string; age: number | null; position: number | null; level: number; team: string | null }>;

  // Contract facts, control, production and value, from the one Player Value entry point, as current as the export is
  const valuations = playerValues([...roster, ...farm].map((p) => p.player_id), { currentState: cue.state });
  const limitations = new Set<string>();
  for (const v of valuations.values()) if (v.control.eligibility?.limitation) limitations.add(v.control.eligibility.limitation);
  const notActive = "Not valued: he isn't an active player in the export.";

  /** His expected wins for the rest of this season (the whole of it before it starts), as production serves them. */
  const winsNow = (id: number) => {
    const v = valuations.get(id);
    if (!v) return { band: null, reason: notActive };
    const h = productionHeadlineOf(v.production);
    if (h.now && h.now.season === season) return { band: h.now.wins, reason: '' };
    return { band: null, reason: h.reason ?? `His production in ${season} isn't projected.` };
  };
  /** His expected wins next season, as production serves them, or why they are not established. */
  const winsNext = (id: number) => {
    const v = valuations.get(id);
    if (!v) return { band: null, reason: notActive };
    const h = productionHeadlineOf(v.production);
    if (h.next && h.next.season === season + 1) return { band: h.next.wins, reason: '' };
    return { band: null, reason: h.nextReason ?? h.reason ?? `His production in ${season + 1} isn't projected.` };
  };

  const records = new Map<number, { w: number; l: number }>();
  if (tableExists('team_record')) {
    for (const r of db.prepare(`SELECT team_id, w, l FROM team_record`).all() as Array<{ team_id: number; w: number; l: number }>) {
      records.set(r.team_id, { w: r.w, l: r.l });
    }
  }

  const list = clubs.map((c) => {
    const mine = roster.filter((p) => p.club === c.team_id);
    const system = farm.filter((p) => p.club === c.team_id);
    const farmWins = winsSum(system, winsNext, `on the farm in ${season + 1}`);
    let top: { player_id: number; name: string; age: number | null; positionName: string; team: string | null; wins: { low: number; central: number; high: number } } | null = null;
    for (const p of system) {
      const w = winsNext(p.player_id).band;
      if (w && (top === null || w.central > top.wins.central)) {
        top = { player_id: p.player_id, name: p.name, age: p.age, positionName: POSITION_NAMES[p.position ?? 0] ?? '?', team: p.team, wins: { low: w.low, central: w.central, high: w.high } };
      }
    }
    const finances = clubFinances(c.team_id);
    return {
      team_id: c.team_id,
      team: c.label,
      abbr: c.abbr,
      isViewer: c.team_id === orgId,
      record: records.get(c.team_id) ?? null,
      roster: {
        players: mine.length,
        wins: winsSum(mine, winsNow, `on the major-league roster for the rest of ${season}`),
        contract: contractSum(mine, valuations),
      },
      farm: { players: system.length, wins: farmWins, top },
      payroll: moneyOf(finances.payroll.now),
      budget: moneyOf(finances.budget),
    };
  });

  const known = (xs: Array<number | null>) => xs.filter((x): x is number => x !== null);
  return {
    season,
    nextSeason: season + 1,
    gameDate: currentGameDate(org.league_id),
    freshness: { ...cue, limitations: [...limitations] },
    viewer: orgId,
    /** The middle club on each figure (never a rank): context for reading one club's number. */
    league: {
      rosterWins: middleOf(list.map((c) => c.roster.wins.figure)),
      farmWins: middleOf(list.map((c) => c.farm.wins.figure)),
      contract: middleOf(list.filter((c) => c.roster.contract.unit === 'dollars').map((c) => c.roster.contract.figure)),
      payroll: median(known(list.map((c) => c.payroll.value))),
    },
    clubs: list,
  };
}

franchiseRoutes.get('/org-comparison/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!tableExists('players') || !tableExists('teams')) return res.status(400).json({ error: 'No data imported yet' });
  try {
    res.json(computeOrgComparison(orgId));
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});
