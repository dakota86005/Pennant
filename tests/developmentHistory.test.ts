import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import {
  developmentTrendByPlayer,
  developmentTrendByPlayerForOrg,
  historyDb,
  peerDevelopmentTrendByPlayer,
  peerDevelopmentTrendByPlayerForOrg,
} from '../server/history.js';
import { IDS } from './fixture';
import request from './request';

const SAVE_NAME = 'unknown';
const PEER_ID_START = 910_000;
const PEER_COUNT = 19;
const INSUFFICIENT_PEER_ID = 920_000;

const deleteTestSnapshots = (): void => {
  historyDb.prepare(
    `DELETE FROM rating_snapshots
     WHERE save_name = ?
       AND (
         player_id = ? OR
         player_id BETWEEN ? AND ? OR
         player_id = ?
       )`
  ).run(
    SAVE_NAME,
    IDS.optioned,
    PEER_ID_START,
    PEER_ID_START + PEER_COUNT - 1,
    INSUFFICIENT_PEER_ID
  );
};

describe('organization-scoped scouting development history', () => {
  beforeAll(() => {
    deleteTestSnapshots();

    const insert = historyDb.prepare(
      `INSERT INTO rating_snapshots
       (save_name, game_date, player_id, name, team_id, org_id,
        level, position, age, cur, pot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const orgDates = [
      ['2030-4-9', 50],
      ['2030-4-10', 51],
      ['2030-7-10', 52],
    ] as const;

    // The target was observed by another organization before this window.
    // Save-wide callers retain that earlier observation, while the current
    // organization's workspace must begin with the first snapshot below.
    insert.run(
      SAVE_NAME,
      '2030-1-1',
      IDS.optioned,
      'Optioned Prospect',
      IDS.otherMlbTeam,
      IDS.otherMlbTeam,
      4,
      2,
      21,
      10,
      60
    );

    for (const [gameDate, current] of orgDates) {
      insert.run(
        SAVE_NAME,
        gameDate,
        IDS.optioned,
        'Optioned Prospect',
        IDS.aaaTeam,
        IDS.mlbTeam,
        4,
        2,
        21,
        current,
        60
      );
    }

    // Nineteen comparable players plus the target make the minimum stable
    // peer cohort of twenty. All have the same organization-scoped pace.
    for (let offset = 0; offset < PEER_COUNT; offset += 1) {
      const playerId = PEER_ID_START + offset;
      for (const [gameDate, current] of orgDates) {
        insert.run(
          SAVE_NAME,
          gameDate,
          playerId,
          `Peer ${offset}`,
          IDS.aaaTeam,
          IDS.mlbTeam,
          4,
          2,
          21,
          current,
          60
        );
      }
    }

    for (const [gameDate, current] of orgDates) {
      insert.run(
        SAVE_NAME,
        gameDate,
        INSUFFICIENT_PEER_ID,
        'Small Cohort Player',
        IDS.otherMlbTeam,
        IDS.otherMlbTeam,
        4,
        2,
        21,
        current,
        60
      );
    }
  });

  afterAll(() => {
    deleteTestSnapshots();
  });

  it('orders unpadded OOTP dates chronologically and excludes the prior organization', async () => {
    const history = await request(
      `/api/development-history/${IDS.mlbTeam}`
    );

    expect(history.dates).toEqual([
      '2030-4-9',
      '2030-4-10',
      '2030-7-10',
    ]);
    expect(history.observationDays).toBe(92);

    const targetDates = history.rows
      .filter((row: { player_id: number }) => row.player_id === IDS.optioned)
      .map((row: { game_date: string }) => row.game_date);
    expect(targetDates).toEqual(history.dates);
  });

  it('uses the visible organization window for trends and peer inputs', () => {
    const saveWide = developmentTrendByPlayer().get(IDS.optioned);
    const scoped = developmentTrendByPlayerForOrg(IDS.mlbTeam).get(IDS.optioned);
    expect(saveWide).toMatchObject({
      firstDate: '2030-1-1',
      latestDate: '2030-7-10',
      snapshotCount: 4,
      currentDelta: 42,
    });
    expect(scoped).toMatchObject({
      firstDate: '2030-4-9',
      latestDate: '2030-7-10',
      snapshotCount: 3,
      observationDays: 92,
      currentDelta: 2,
    });

    expect(peerDevelopmentTrendByPlayer().get(IDS.optioned)?.pace).toBe('ahead');
    expect(peerDevelopmentTrendByPlayerForOrg(IDS.mlbTeam).get(IDS.optioned)).toMatchObject({
      pace: 'typical',
      cohortSize: 20,
      ratePer100Days: 2.2,
    });
  });

  it('labels a small peer cohort as insufficient without typical language', () => {
    const evidence = peerDevelopmentTrendByPlayerForOrg(
      IDS.otherMlbTeam
    ).get(INSUFFICIENT_PEER_ID);

    expect(evidence?.pace).toBe('insufficient');
    expect(evidence?.reasons.join(' ')).toMatch(/insufficient/i);
    expect(evidence?.reasons.join(' ')).not.toMatch(/typical/i);
  });
});
