import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { api } from '../server/api.js';
import { computeNextGame } from '../server/dashboard.js';
import { getDataStatus } from '../server/dataStatus.js';
import { db } from '../server/db.js';
import { computeGamePlan } from '../server/gameplan.js';
import { readMorning } from '../server/morningReport.js';
import { teamSeasonWords } from '../server/presentation/frontOffice/morning.js';
import { projectedStarters } from '../server/probableStarters.js';
import { computeSchedule } from '../server/schedule.js';
import { buildSave, exec, type BuiltSave } from './syntheticSave';

/*
 * One reading of who is projected to start (D-069; BEHAVIOR_CASES.md "MLB Operations", `probableStarters.test.ts`):
 * the Morning Report's Tonight, the dashboard, the schedule's row, the game's plan and the next game name the same two
 * men, also when the opponent plays a game before ours.
 */

let base = '';
let close = (): void => {};
let save: BuiltSave;

beforeAll(async () => {
  const app = express();
  app.use('/api', api);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => {
    server.closeAllConnections();
    server.close();
  };
});

afterAll(() => close());

beforeEach(() => {
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
});

const slot = (teamId: number, n: number) =>
  (db.prepare(`SELECT starter_${n} AS id FROM projected_starting_pitchers WHERE team_id = ?`).get(teamId) as { id: number }).id;

/** Every reading's two men for one game: ours, then theirs (the plan names theirs only). */
async function readings(gameId: number) {
  const material = readMorning(save.org, getDataStatus(), null);
  const tonight = teamSeasonWords({ orgId: save.org, club: 'Club', importStamp: null, reportStamp: 'r1', gameDate: '2040-5-5' }, material).tonight!;
  expect(tonight.gameId).toBe(gameId);
  const next = computeNextGame(save.org)!;
  expect(next.gameId).toBe(gameId);
  const schedule = computeSchedule(save.org);
  if (!schedule.ok || !('headToHead' in schedule.body)) throw new Error('no schedule');
  const row = schedule.body.series.flatMap((s) => s.games).find((g) => g.game_id === gameId)!;
  const plan = computeGamePlan(save.org, gameId);
  if (!plan.ok) throw new Error(plan.error);
  const dashboard = await (await fetch(`${base}/api/dashboard/${save.org}`)).json() as { upcoming: Array<{ ourStarter: { player_id: number } | null; theirStarter: { player_id: number } | null }> };
  return {
    tonight: [tonight.ours?.playerId ?? null, tonight.theirs?.playerId ?? null],
    nextGame: [next.ourStarter?.player_id ?? null, next.theirStarter?.player_id ?? null],
    schedule: [row.ourStarter?.player_id ?? null, row.theirStarter?.player_id ?? null],
    plan: [null, plan.body.starter?.player_id ?? null],
    dashboard: [dashboard.upcoming[0].ourStarter?.player_id ?? null, dashboard.upcoming[0].theirStarter?.player_id ?? null],
  };
}

describe('every reading names the same probable starters (D-069)', () => {
  it('reads the opponent at our game\'s place in his own turn when he plays a game before ours', async () => {
    const next = computeNextGame(save.org)!;
    const opp = next.oppId;
    const other = (db.prepare('SELECT team_id FROM teams WHERE team_id NOT IN (?, ?) LIMIT 1').get(save.org, opp) as { team_id: number }).team_id;
    const date = (db.prepare('SELECT date FROM games WHERE game_id = ?').get(next.gameId) as { date: string }).date;
    expect(slot(opp, 0)).not.toBe(slot(opp, 1));
    // The opponent plays the first game of a doubleheader against another club, earlier the same day; we don't
    exec(`INSERT INTO games (game_id, league_id, home_team, away_team, date, played, time, game_type, runs0, runs1, innings)
      VALUES (99001, ${save.leagueId}, ${opp}, ${other}, '${date}', 0, 100, 0, 0, 0, 0)`);
    const ours = slot(save.org, 0);
    const theirs = slot(opp, 1);
    expect(projectedStarters([save.org, opp]).starterOf(opp, next.gameId)).toBe(theirs);
    const r = await readings(next.gameId);
    expect(r.tonight).toEqual([ours, theirs]);
    expect(r.nextGame).toEqual([ours, theirs]);
    expect(r.schedule).toEqual([ours, theirs]);
    expect(r.dashboard).toEqual([ours, theirs]);
    expect(r.plan[1]).toBe(theirs);
  });

  it('names nobody after an unplayed game of another type, because whether OOTP\'s turn counts it is not known', async () => {
    const next = computeNextGame(save.org)!;
    const date = (db.prepare('SELECT date FROM games WHERE game_id = ?').get(next.gameId) as { date: string }).date;
    // An exhibition (game type 1) of ours earlier the same day, against our own opponent
    exec(`INSERT INTO games (game_id, league_id, home_team, away_team, date, played, time, game_type, runs0, runs1, innings)
      VALUES (99002, ${save.leagueId}, ${save.org}, ${next.oppId}, '${date}', 0, 100, 1, 0, 0, 0)`);
    const reader = projectedStarters([save.org, next.oppId]);
    expect(reader.starterOf(save.org, next.gameId)).toBeNull();
    expect(reader.starterOf(next.oppId, next.gameId)).toBeNull();
    const r = await readings(next.gameId);
    for (const reading of Object.values(r)) expect(reading).toEqual([null, null]);
  });
});
