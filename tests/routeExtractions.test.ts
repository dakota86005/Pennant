import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { api } from '../server/api.js';
import { db } from '../server/db.js';
import { clubRecord, computeStandings } from '../server/league.js';
import { computeTrends } from '../server/trends.js';
import { computeRosterCrunch } from '../server/rosterops.js';
import { computePitchingStaff } from '../server/pitching.js';
import type { Computed } from '../server/computed.js';
import { buildSave, type BuiltSave } from './syntheticSave';

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
];

let base = '';
let close = (): void => {};
let save: BuiltSave;

beforeAll(async () => {
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, minors: true });
  // The standings group by division; the synthetic save writes none, so give each club's one
  db.exec('CREATE TABLE IF NOT EXISTS divisions (league_id INTEGER, sub_league_id INTEGER, division_id INTEGER, name TEXT)');
  db.exec('DELETE FROM divisions');
  for (const t of db.prepare('SELECT DISTINCT league_id, sub_league_id, division_id FROM teams').all() as Array<Record<string, number>>) {
    db.prepare('INSERT INTO divisions VALUES (?, ?, ?, ?)').run(t.league_id, t.sub_league_id, t.division_id, `Division ${t.division_id}`);
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

describe('a club\'s record as the export states it', () => {
  it('reads the standings table\'s wins and losses, and is null for a club the table does not have', () => {
    const record = clubRecord(save.org);
    const row = db.prepare('SELECT w, l FROM team_record WHERE team_id = ?').get(save.org) as { w: number; l: number };
    expect(record).toMatchObject({ w: row.w, l: row.l });
    expect(clubRecord(999_999)).toBeNull();
  });
});
