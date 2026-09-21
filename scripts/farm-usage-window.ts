/**
 * What the recent-usage window rests on, measured on a real import. Read-only.
 *
 * The farm's window constants (`RECENT_WINDOW_GAMES`, `RECENT_MINIMUM_GAMES`, `RECENT_ROTATION_SHARE`,
 * and the rule that a relief window may confirm or clear a shortage but never raise one) are stamped
 * PROVISIONAL in `server/farmCalibration.ts`. This is the measurement behind them, so the basis can be
 * re-run on another save rather than taken on trust. It answers one question four ways:
 *
 *   after each club game from the twentieth on, how well does a trailing window of that club's games
 *   predict who does the work in the NEXT ones?
 *
 * Roster-aware throughout: a man whose next logged appearance is for another club is dropped at that
 * point, standing in for the authoritative current roster the production model has exactly. Without
 * that the season-to-date read looks worse than it is, and the window's share of the credit is
 * overstated.
 *
 *   OOTP_FO_DATA_DIR=<dir containing league.db> npm run farm:usage-window
 *
 * It writes nothing and changes no behaviour: a person reads the output and decides
 * (docs/MINOR_LEAGUE_OPERATIONS.md §8.3).
 */

import { db, tableExists } from '../server/db.js';
import { parseGameDate } from '../server/dataFreshness.js';
import { RECENT_MINIMUM_GAMES, RECENT_WINDOW_GAMES } from '../server/farmCalibration.js';

for (const table of ['games', 'players_game_batting', 'players_game_pitching_stats', 'teams']) {
  if (!tableExists(table)) throw new Error(`This import has no ${table} table, so there is no game log to measure.`);
}

/** Full-season minor-league levels: a complex league's season is too short to backtest against. */
const LEVELS = [2, 3, 4];
const FIRST_DECISION = 20;
const WINDOWS: Array<number | 'season'> = [5, 10, 12, 15, 20, 'season'];

const games = db.prepare(`SELECT game_id, date, time, home_team, away_team FROM games WHERE played = 1`).all() as Array<{
  game_id: number;
  date: unknown;
  time: number | null;
  home_team: number;
  away_team: number;
}>;
const order = new Map<number, number>();
for (const g of games) {
  const date = parseGameDate(g.date);
  if (date) order.set(g.game_id, Number(date.replace(/-/g, '')) * 100000 + Number(g.time ?? 0));
}
const clubs = new Set(
  (db.prepare(`SELECT team_id FROM teams WHERE level IN (${LEVELS.join(',')})`).all() as Array<{ team_id: number }>).map((t) => t.team_id)
);
const schedule = new Map<number, number[]>();
for (const g of games) {
  if (!order.has(g.game_id)) continue;
  for (const club of [g.home_team, g.away_team]) if (clubs.has(club)) schedule.set(club, [...(schedule.get(club) ?? []), g.game_id]);
}
for (const ids of schedule.values()) ids.sort((a, b) => order.get(a)! - order.get(b)! || a - b);

const batting = db.prepare(`SELECT player_id, team_id, game_id, position, gs FROM players_game_batting`).all() as Array<{
  player_id: number;
  team_id: number;
  game_id: number;
  position: number;
  gs: number;
}>;
const pitching = db.prepare(`SELECT player_id, team_id, game_id, gs, outs FROM players_game_pitching_stats`).all() as Array<{
  player_id: number;
  team_id: number;
  game_id: number;
  gs: number;
  outs: number;
}>;

const appearances = new Map<number, Array<{ key: number; team: number }>>();
for (const r of [...batting, ...pitching]) {
  const key = order.get(r.game_id);
  if (key !== undefined) appearances.set(r.player_id, [...(appearances.get(r.player_id) ?? []), { key, team: r.team_id }]);
}
for (const list of appearances.values()) list.sort((a, b) => a.key - b.key);
const departed = (player: number, club: number, after: number): boolean => {
  const next = appearances.get(player)?.find((a) => a.key > after);
  return next !== undefined && next.team !== club;
};

const starterAt = new Map<string, number>();
for (const r of batting) if (r.gs === 1 && r.position >= 2 && r.position <= 9) starterAt.set(`${r.team_id}:${r.game_id}:${r.position}`, r.player_id);
const onMound = new Map<string, number>();
for (const r of pitching) if (r.gs === 1) onMound.set(`${r.team_id}:${r.game_id}`, r.player_id);

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`.padStart(6);
const scored = (tp: number, fp: number, fn: number): string => `precision ${pct(tp / Math.max(1, tp + fp))} · recall ${pct(tp / Math.max(1, tp + fn))}`;
const past = (ids: number[], t: number, w: number | 'season'): number[] => ids.slice(w === 'season' ? 0 : Math.max(0, t - w), t);

console.log(`${schedule.size} full-season minor-league clubs · decision points from club game ${FIRST_DECISION} · declared window ${RECENT_WINDOW_GAMES}, minimum ${RECENT_MINIMUM_GAMES}\n`);

console.log('A POSITION — a 40% share of the window\'s starts there → starts at least 2 of the next 5 there');
for (const w of WINDOWS) {
  let tp = 0, fp = 0, fn = 0;
  for (const [club, ids] of schedule) {
    for (let t = FIRST_DECISION; t + 5 <= ids.length; t++) {
      const now = order.get(ids[t - 1])!;
      const before = past(ids, t, w);
      for (let p = 2; p <= 9; p++) {
        const held = new Map<number, number>();
        for (const g of before) {
          const who = starterAt.get(`${club}:${g}:${p}`);
          if (who !== undefined && !departed(who, club, now)) held.set(who, (held.get(who) ?? 0) + 1);
        }
        const next = new Map<number, number>();
        for (const g of ids.slice(t, t + 5)) {
          const who = starterAt.get(`${club}:${g}:${p}`);
          if (who !== undefined) next.set(who, (next.get(who) ?? 0) + 1);
        }
        const flagged = new Set([...held].filter(([, n]) => n / before.length >= 0.4).map(([id]) => id));
        const truth = new Set([...next].filter(([, n]) => n >= 2).map(([id]) => id));
        for (const id of flagged) (truth.has(id) ? tp++ : fp++);
        for (const id of truth) if (!flagged.has(id)) fn++;
      }
    }
  }
  console.log(`  last ${String(w).padStart(6)} · ${scored(tp, fp, fn)}`);
}

console.log('\nTHE ROTATION — at least k starts in the window → one of the next 5 starters');
for (const w of [10, 15, 20, 'season'] as const) {
  for (const k of [1, 2, 3]) {
    let tp = 0, fp = 0, fn = 0;
    for (const [club, ids] of schedule) {
      for (let t = FIRST_DECISION; t + 5 <= ids.length; t++) {
        const now = order.get(ids[t - 1])!;
        const took = new Map<number, number>();
        for (const g of past(ids, t, w)) {
          const who = onMound.get(`${club}:${g}`);
          if (who !== undefined && !departed(who, club, now)) took.set(who, (took.get(who) ?? 0) + 1);
        }
        const next = new Set<number>();
        for (const g of ids.slice(t, t + 5)) {
          const who = onMound.get(`${club}:${g}`);
          if (who !== undefined) next.add(who);
        }
        const flagged = new Set([...took].filter(([, n]) => n >= k).map(([id]) => id));
        for (const id of flagged) (next.has(id) ? tp++ : fp++);
        for (const id of next) if (!flagged.has(id)) fn++;
      }
    }
    console.log(`  last ${String(w).padStart(6)} · k=${k} · ${scored(tp, fp, fn)}`);
  }
}

console.log('\nA NEW ARRIVAL — after k club games at a new club, "started 40% of them at one spot" → starts at least 2 of the next 5 there');
const byPlayer = new Map<number, Array<{ key: number; team: number; game: number; position: number; gs: number }>>();
for (const r of batting) {
  const key = order.get(r.game_id);
  if (key !== undefined) byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), { key, team: r.team_id, game: r.game_id, position: r.position, gs: r.gs }]);
}
for (const list of byPlayer.values()) list.sort((a, b) => a.key - b.key);
for (const k of [2, 3, 4, 5, 6, 8, 10]) {
  let n = 0, tp = 0, fp = 0, fn = 0;
  for (const apps of byPlayer.values()) {
    for (let i = 1; i < apps.length; i++) {
      if (apps[i].team === apps[i - 1].team || !clubs.has(apps[i].team)) continue;
      const club = apps[i].team;
      const ids = schedule.get(club)!;
      const index = new Map(ids.map((g, j) => [g, j]));
      const start = ids.findIndex((g) => order.get(g)! > apps[i - 1].key);
      if (start < 0 || start + k + 5 > ids.length) continue;
      const horizon = order.get(ids[start + k + 4])!;
      if (apps.some((a) => a.key > apps[i].key && a.key <= horizon && a.team !== club)) continue;
      const here = apps.filter((a) => a.team === club && index.has(a.game) && a.gs === 1 && a.position >= 2 && a.position <= 9);
      const tally = new Map<number, number>();
      for (const a of here) {
        const j = index.get(a.game)!;
        if (j >= start && j < start + k) tally.set(a.position, (tally.get(a.position) ?? 0) + 1);
      }
      const main = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
      const next = main ? here.filter((a) => a.position === main[0] && index.get(a.game)! >= start + k && index.get(a.game)! < start + k + 5).length : 0;
      const flagged = main !== undefined && main[1] / k >= 0.4;
      n++;
      if (flagged && next >= 2) tp++;
      else if (flagged) fp++;
      else if (next >= 2) fn++;
    }
  }
  console.log(`  k=${String(k).padStart(2)} · ${String(n).padStart(4)} arrivals · ${scored(tp, fp, fn)}`);
}

console.log('\nSTABILITY — a man\'s share in games -30..-16 against his share in the last 15 (clubs with 40 or more games)');
const correlation = (xs: number[], ys: number[]): number => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
};
const positionThen: number[] = [], positionNext: number[] = [], reliefThen: number[] = [], reliefNext: number[] = [];
let fine = 0, fineThenShort = 0;
for (const [club, ids] of schedule) {
  if (ids.length < 40) continue;
  const early = new Set(ids.slice(ids.length - 30, ids.length - 15));
  const late = new Set(ids.slice(ids.length - 15));
  const opened = order.get(ids[ids.length - 30])!;
  const outs = new Map<number, [number, number]>();
  const established = new Set<number>();
  for (const r of pitching) {
    if (r.team_id !== club) continue;
    if ((order.get(r.game_id) ?? Infinity) < opened) established.add(r.player_id);
    if (r.gs === 1) continue;
    const mine = outs.get(r.player_id) ?? [0, 0];
    if (early.has(r.game_id)) mine[0] += r.outs;
    else if (late.has(r.game_id)) mine[1] += r.outs;
    outs.set(r.player_id, mine);
  }
  const corps = [...outs].filter(([id, o]) => established.has(id) && o[0] > 0);
  const then = corps.reduce((s, [, o]) => s + o[0], 0);
  const next = corps.reduce((s, [, o]) => s + o[1], 0);
  if (corps.length >= 6 && then > 0 && next > 0) {
    const even = 1 / corps.length;
    for (const [, o] of corps) {
      reliefThen.push(o[0] / then);
      reliefNext.push(o[1] / next);
      if (o[0] / then >= even * 0.5) {
        fine++;
        if (o[1] / next < even * 0.5) fineThenShort++;
      }
    }
  }
  for (let p = 2; p <= 9; p++) {
    const starts = new Map<number, [number, number]>();
    for (const r of batting) {
      if (r.team_id !== club || r.position !== p || r.gs !== 1) continue;
      const mine = starts.get(r.player_id) ?? [0, 0];
      if (early.has(r.game_id)) mine[0]++;
      else if (late.has(r.game_id)) mine[1]++;
      starts.set(r.player_id, mine);
    }
    for (const [, s] of starts) {
      if (s[0] + s[1] === 0) continue;
      positionThen.push(s[0] / 15);
      positionNext.push(s[1] / 15);
    }
  }
}
console.log(`  a position's starts share   r = ${correlation(positionThen, positionNext).toFixed(2)}   (n = ${positionThen.length})`);
console.log(`  a reliever's innings share  r = ${correlation(reliefThen, reliefNext).toFixed(2)}   (n = ${reliefThen.length})`);
console.log(`  relievers NOT short of an even share in one window who read as short in the next: ${fineThenShort} of ${fine} (${pct(fineThenShort / Math.max(1, fine)).trim()})`);
console.log('    — the rate at which one relief window alone manufactures a shortage, and why it may only confirm or clear one.');
