import { afterAll, describe, expect, it } from 'vitest';
import { currentSaveName, historyDb, SNAPSHOT_RUNNING_COLUMNS, SNAPSHOT_SPLIT_COLUMNS, takeSnapshot } from '../server/history.js';
import { loadScoutedObservations } from '../server/scoutedEvidence.js';

/**
 * Cycle 4 of the per-save calibration (D-053): a rating snapshot keeps a hitter's tools against each hand and his baserunning and
 * stealing ratings, because a per-save check of the platoon read and of the running model needs them as they stood before a season and
 * nothing else keeps them. The columns are added to an existing table without touching its rows, and a snapshot taken before they
 * existed reads them as unknown, never as zero.
 */

const SAVE = 'unknown';
const OLD = 930_001;
const NEW = 930_002;

afterAll(() => {
  historyDb.prepare(`DELETE FROM rating_snapshots WHERE save_name = ? AND player_id IN (?, ?)`).run(SAVE, OLD, NEW);
});

describe('rating snapshots keep the split and running tools (additive)', () => {
  it('adds the columns, nullable, to the existing table', () => {
    const columns = historyDb.prepare(`PRAGMA table_info(rating_snapshots)`).all() as Array<{ name: string; notnull: number }>;
    for (const c of [...SNAPSHOT_SPLIT_COLUMNS, ...SNAPSHOT_RUNNING_COLUMNS]) {
      const found = columns.find((x) => x.name === c);
      expect(found, c).toBeDefined();
      expect(found?.notnull, c).toBe(0);
    }
  });

  it('an older snapshot, without them, reads them as unknown and keeps what it did store', () => {
    historyDb.prepare(
      `INSERT OR REPLACE INTO rating_snapshots (save_name, game_date, player_id, position, age, con, gap, pow, eye, avk, spd)
       VALUES (?, '2030-3-1', ?, 7, 25, 55, 50, 60, 45, 40, 65)`
    ).run(SAVE, OLD);
    const o = loadScoutedObservations([OLD]).get(OLD)?.[0];
    expect(o?.hitter?.tools).toEqual({ contact: 55, gap: 50, power: 60, eye: 45, avoidK: 40 });
    expect(o?.hitter?.vsLeft).toEqual({ contact: null, gap: null, power: null, eye: null, avoidK: null });
    expect(o?.hitter?.running.speed).toBe(65);
    expect(o?.hitter?.running.baserunning).toBeNull();
    expect(o?.hitter?.running.stealing).toBeNull();
    expect(o?.hitter?.runningAbility).toBeNull();
  });

  it('a snapshot with them reads them back through the adapter', () => {
    historyDb.prepare(
      `INSERT OR REPLACE INTO rating_snapshots (save_name, game_date, player_id, position, age, con, gap, pow, eye, avk, spd,
         lcon, lgap, lpow, leye, lavk, rcon, rgap, rpow, reye, ravk, brn, stl)
       VALUES (?, '2030-3-1', ?, 7, 25, 55, 50, 60, 45, 40, 65, 45, 50, 50, 45, 40, 60, 50, 65, 45, 40, 55, 70)`
    ).run(SAVE, NEW);
    const o = loadScoutedObservations([NEW]).get(NEW)?.[0];
    expect(o?.hitter?.vsLeft).toEqual({ contact: 45, gap: 50, power: 50, eye: 45, avoidK: 40 });
    expect(o?.hitter?.vsRight).toEqual({ contact: 60, gap: 50, power: 65, eye: 45, avoidK: 40 });
    expect(o?.hitter?.running).toMatchObject({ speed: 65, baserunning: 55, stealing: 70 });
  });

  it('a pitcher carries no hitter profile', () => {
    historyDb.prepare(`UPDATE rating_snapshots SET position = 1 WHERE save_name = ? AND player_id = ?`).run(SAVE, NEW);
    expect(loadScoutedObservations([NEW]).get(NEW)?.[0].hitter).toBeNull();
  });

  it('a snapshot of an export without split or running columns stores them as unknown', () => {
    const before = historyDb.prepare(`SELECT game_date AS d, COUNT(*) AS n FROM rating_snapshots WHERE save_name = ? GROUP BY game_date`).all(currentSaveName()) as Array<{ d: string; n: number }>;
    const taken = takeSnapshot();
    expect(taken).not.toBeNull();
    const existed = before.some((b) => b.d === taken?.gameDate);
    const row = historyDb.prepare(
      `SELECT ${[...SNAPSHOT_SPLIT_COLUMNS, ...SNAPSHOT_RUNNING_COLUMNS].join(', ')} FROM rating_snapshots WHERE save_name = ? AND game_date = ? LIMIT 1`
    ).get(currentSaveName(), taken?.gameDate) as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    for (const value of Object.values(row ?? {})) expect(value).toBeNull();
    if (!existed) historyDb.prepare(`DELETE FROM rating_snapshots WHERE save_name = ? AND game_date = ?`).run(currentSaveName(), taken?.gameDate);
  });
});
