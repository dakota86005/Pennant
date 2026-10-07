import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { api } from '../server/api.js';
import { db } from '../server/db.js';
import { clubRecord, computeStandings } from '../server/league.js';
import { computeTrends } from '../server/trends.js';
import { computeRosterCrunch } from '../server/rosterops.js';
import { computePitchingStaff } from '../server/pitching.js';
import { computePlayerDossier } from '../server/player.js';
import { computeSchedule } from '../server/schedule.js';
import { computeDepthChart } from '../server/org.js';
import { computeRoster } from '../server/roster.js';
import { computeLineup, lineupAskOf, type LineupAsk } from '../server/lineup.js';
import { computeGamePlan } from '../server/gameplan.js';
import { computeNextGame } from '../server/dashboard.js';
import { projectedStarters } from '../server/probableStarters.js';
import type { Computed } from '../server/computed.js';
import { buildSave, exec, type BuiltSave } from './syntheticSave';

/**
 * The route extractions (SWIFTUI_REBUILD.md milestone N4, V2 plan R7): `/standings`, `/trends`, `/roster-crunch` and
 * `/pitching` compute in callable modules, so the Mac app's presentation layer uses them without HTTP. Each old route
 * answers exactly what its module computes, status and body, for every club, an unknown id and an export without the
 * tables. (The extraction itself was proved byte-identical against the routes before it, on the fixture league and
 * synthetic saves, when it was made.)
 */

const ROUTES: Array<[string, (id: number) => Computed<unknown>]> = [
  ['standings', computeStandings],
  ['trends', computeTrends],
  ['roster-crunch', computeRosterCrunch],
  ['pitching', computePitchingStaff],
  // N9: the clubhouse tools' routes, extracted for the Mac app's Major League Ops views
  ['schedule', computeSchedule],
  ['depth-chart', computeDepthChart],
  ['roster', computeRoster],
];

/** The lineup's asks the old route reads from its query (N9): each one answers what `computeLineup` builds for it. */
const LINEUP_ASKS: Array<[string, LineupAsk]> = [
  ['', lineupAskOf({})],
  ['?vs=l', lineupAskOf({ vs: 'l' })],
  ['?vs=r&style=trad&sort=production', lineupAskOf({ vs: 'r', style: 'trad', sort: 'production' })],
  ['?vs=l&dh=off', lineupAskOf({ vs: 'l', dh: 'off' })],
  ['?dh=on&sort=production', lineupAskOf({ dh: 'on', sort: 'production' })],
];

let base = '';
let close = (): void => {};
let save: BuiltSave;

beforeAll(async () => {
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, minors: true, teamSeason: true });
  // The standings group by division; the synthetic save writes none, so give each club's one
  db.exec('CREATE TABLE IF NOT EXISTS divisions (league_id INTEGER, sub_league_id INTEGER, division_id INTEGER, name TEXT)');
  db.exec('DELETE FROM divisions');
  for (const t of db.prepare('SELECT DISTINCT league_id, sub_league_id, division_id FROM teams').all() as Array<Record<string, number>>) {
    db.prepare('INSERT INTO divisions (league_id, sub_league_id, division_id, name) VALUES (?, ?, ?, ?)').run(t.league_id, t.sub_league_id, t.division_id, `Division ${t.division_id}`);
  }
  const app = express();
  app.use('/api', api);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => {
    server.closeAllConnections();
    server.close();
  };
}, 120_000);

afterAll(() => {
  db.exec('DROP TABLE IF EXISTS divisions');
  close();
});

async function same(route: string, compute: (id: number) => Computed<unknown>, id: number): Promise<void> {
  const res = await fetch(`${base}/api/${route}/${id}`);
  const computed = compute(id);
  if (computed.ok) {
    expect(res.status, `${route}/${id}`).toBe(200);
    expect(await res.text(), `${route}/${id}`).toBe(JSON.stringify(computed.body));
  } else {
    expect(res.status, `${route}/${id}`).toBe(computed.status);
    expect(await res.json(), `${route}/${id}`).toEqual({ error: computed.error });
  }
}

describe('each old route answers what its module computes', () => {
  it.each(ROUTES)('%s, for every club, the farm clubs and an unknown id', async (route, compute) => {
    const ids = [...save.clubs, ...save.farmClubs, 999_999];
    expect(ids.length).toBeGreaterThan(4);
    for (const id of ids) await same(route, compute, id);
    // Something real was computed for the human's club
    expect(compute(save.org).ok).toBe(true);
  });

  it.each(ROUTES)('%s, on an export without its tables', async (route, compute) => {
    const tables = ['team_record', 'games', 'players_roster_status', 'players'];
    for (const t of tables) db.exec(`ALTER TABLE ${t} RENAME TO zz_${t}`);
    try {
      const computed = compute(save.org);
      expect(computed.ok).toBe(false);
      await same(route, compute, save.org);
    } finally {
      for (const t of tables) db.exec(`ALTER TABLE zz_${t} RENAME TO ${t}`);
    }
  });
});

/**
 * N11: the player card's dossier (`/api/player/:id`) computes in `computePlayerDossier`, which the player window reads too.
 * (Proved byte-identical against the route before it on the owner's export and the USBL save, 126 requests, when made.)
 */
describe('the player card\'s dossier answers what its module computes (N11)', () => {
  it('for hitters, pitchers, prospects, an unknown id and an id that isn\'t a number', async () => {
    const ids = [save.regular, save.reliever, ...save.hitters.slice(0, 3), ...save.pitchers.slice(0, 2), ...save.prospects.slice(0, 2), 999_999_999];
    for (const id of ids) await same('player', (n) => computePlayerDossier(n), id);
    expect(computePlayerDossier(save.regular).ok).toBe(true);
    const res = await fetch(`${base}/api/player/nobody`);
    expect(res.status).toBe(404);
  });

  it('on an export with no players table', async () => {
    db.exec('ALTER TABLE players RENAME TO zz_players');
    try {
      expect(computePlayerDossier(save.regular)).toEqual({ ok: false, status: 400, error: 'No data imported yet' });
      await same('player', (n) => computePlayerDossier(n), save.regular);
    } finally {
      db.exec('ALTER TABLE zz_players RENAME TO players');
    }
  });
});

describe('the clubhouse tools\' routes answer what their modules compute (N9)', () => {
  it.each(LINEUP_ASKS)('lineup%s, for every club, the farm clubs and an unknown id', async (query, ask) => {
    for (const id of [...save.clubs, ...save.farmClubs, 999_999]) {
      const res = await fetch(`${base}/api/lineup/${id}${query}`);
      const computed = computeLineup(id, ask);
      if (computed.ok) {
        expect(res.status, `lineup/${id}${query}`).toBe(200);
        expect(await res.text(), `lineup/${id}${query}`).toBe(JSON.stringify(computed.body));
      } else {
        expect(res.status, `lineup/${id}${query}`).toBe(computed.status);
        expect(await res.json()).toEqual({ error: computed.error });
      }
    }
    expect(computeLineup(save.org, ask).ok).toBe(true);
  });

  it('next-game, for every club and an unknown id', async () => {
    for (const id of [...save.clubs, 999_999]) {
      const res = await fetch(`${base}/api/next-game/${id}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(JSON.stringify(computeNextGame(id)));
    }
    expect(computeNextGame(save.org)).not.toBeNull();
  });

  it('game-plan, for a played game, an unplayed one and an unknown game', async () => {
    const games = db.prepare('SELECT game_id, played FROM games WHERE home_team = ? OR away_team = ? ORDER BY game_id').all(save.org, save.org) as Array<{ game_id: number; played: number }>;
    const played = games.find((g) => g.played === 1)!;
    const unplayed = games.find((g) => g.played === 0)!;
    for (const gameId of [played.game_id, unplayed.game_id, 999_999]) {
      const res = await fetch(`${base}/api/game-plan/${save.org}/${gameId}`);
      const computed = computeGamePlan(save.org, gameId);
      if (computed.ok) {
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(JSON.stringify(computed.body));
      } else {
        expect(res.status).toBe(computed.status);
        expect(await res.json()).toEqual({ error: computed.error });
      }
    }
    expect(computeGamePlan(save.org, 999_999)).toEqual({ ok: false, status: 404, error: 'No such game' });
  });
});

describe('who is projected to start a game still to play (N9)', () => {
  it('reads a club\'s projection at the game\'s place among its own games still to play, across series, and names nobody past it', () => {
    const columns = (db.prepare('PRAGMA table_info(projected_starting_pitchers)').all() as Array<{ name: string }>).map((c) => c.name).filter((c) => /^starter_\d+$/.test(c));
    expect(columns.length).toBeGreaterThan(0);
    const row = db.prepare('SELECT * FROM projected_starting_pitchers WHERE team_id = ?').get(save.org) as Record<string, number>;
    const upcoming = (db.prepare(`SELECT game_id FROM games WHERE played = 0 AND (home_team = ? OR away_team = ?)`).all(save.org, save.org) as Array<{ game_id: number }>)
      .map((g) => g.game_id);
    expect(upcoming.length).toBeGreaterThan(columns.length);
    const ordered = (db.prepare(`SELECT game_id, date, time FROM games WHERE played = 0 AND (home_team = ? OR away_team = ?)`).all(save.org, save.org) as Array<{ game_id: number; date: string; time: number }>)
      .sort((a, b) => {
        const k = (d: string) => d.split('-').map(Number).reduce((acc, n) => acc * 100 + n, 0);
        return k(a.date) - k(b.date) || a.time - b.time || a.game_id - b.game_id;
      });
    const reader = projectedStarters([save.org]);
    ordered.forEach((g, place) => {
      const expected = place < columns.length ? (row[`starter_${place}`] || null) : null;
      expect(reader.starterOf(save.org, g.game_id), `game ${place + 1} still to play`).toBe(expected);
    });
    // The schedule names the same men, series after series (it used to start every series at the projection's first slot)
    const schedule = computeSchedule(save.org);
    if (!schedule.ok || !('headToHead' in schedule.body)) throw new Error('no schedule');
    const shown = schedule.body.series.flatMap((s) => s.games).filter((g) => !g.played);
    expect(shown.length).toBe(ordered.length);
    for (const g of shown) expect(g.ourStarter?.player_id ?? null).toBe(reader.starterOf(save.org, g.game_id));
    expect(shown.filter((g) => g.ourStarter === null).length).toBe(Math.max(0, ordered.length - columns.length));
    // A played game has no projected starter
    const played = db.prepare('SELECT game_id FROM games WHERE played = 1 AND (home_team = ? OR away_team = ?) LIMIT 1').get(save.org, save.org) as { game_id: number };
    expect(reader.starterOf(save.org, played.game_id)).toBeNull();
  });
});

describe('a club\'s record as the export states it', () => {
  it('reads the standings table\'s wins and losses, and is null for a club the table does not have', () => {
    const record = clubRecord(save.org);
    const row = db.prepare('SELECT w, l FROM team_record WHERE team_id = ?').get(save.org) as { w: number; l: number };
    expect(record).toMatchObject({ w: row.w, l: row.l });
    expect(clubRecord(999_999)).toBeNull();
  });
});

describe('a played game the export names no starter for (D-069, D-018)', () => {
  it('has no starter in its plan, never the projected rotation\'s man, with or without the named-starter columns', async () => {
    const played = db.prepare('SELECT game_id, home_team, away_team FROM games WHERE played = 1 AND (home_team = ? OR away_team = ?) ORDER BY game_id LIMIT 1')
      .get(save.org, save.org) as { game_id: number; home_team: number; away_team: number };
    const oppId = played.home_team === save.org ? played.away_team : played.home_team;
    // The opponent has a projection: the route used to read it for a played game
    expect(db.prepare('SELECT starter_0 FROM projected_starting_pitchers WHERE team_id = ?').get(oppId)).toBeTruthy();
    const starterOf = async () => ((await (await fetch(`${base}/api/game-plan/${save.org}/${played.game_id}`)).json()) as { starter: unknown; game: { played: boolean } });
    // This synthetic export's games.csv has no named-starter columns at all
    let plan = await starterOf();
    expect(plan.game.played).toBe(true);
    expect(plan.starter).toBeNull();
    // An export with the columns, empty for this game
    exec('ALTER TABLE games ADD COLUMN starter0 INTEGER');
    exec('ALTER TABLE games ADD COLUMN starter1 INTEGER');
    plan = await starterOf();
    expect(plan.starter).toBeNull();
    // And one that names him: the named man, confirmed
    const theirs = (db.prepare('SELECT player_id FROM players WHERE team_id = ? AND position = 1 LIMIT 1').get(oppId) as { player_id: number }).player_id;
    exec(`UPDATE games SET ${played.home_team === save.org ? 'starter0' : 'starter1'} = ${theirs} WHERE game_id = ${played.game_id}`);
    plan = await starterOf();
    expect(plan.starter).toMatchObject({ player_id: theirs, confirmed: true });
  });
});
