import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildClubhouseViews } from '../server/clubhouseViewsBuild.js';
import {
  clubhouseGamePlanNow, clubhouseLineupNow, clubhousePitchingNow, clubhouseScheduleNow, clubhouseTrendsNow, clubhouseViewStats, resetClubhouseViews,
} from '../server/clubhouseViewService.js';
import { resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { importedAt } from '../server/playerStateRoutes.js';
import { buildSave, type BuiltSave } from './syntheticSave';

/*
 * One part of the clubhouse tools that can't be read takes down only its own view (N9 review, M5): it is logged, worded
 * as "couldn't be read", and kept with the build for the import, never rebuilt on every request. And a view asked on a
 * click across a change of inputs is handed back but not kept (N9 review).
 */

const broken = vi.hoisted(() => ({ pitching: false }));
vi.mock('../server/pitching.js', async (original) => {
  const real = await original<typeof import('../server/pitching.js')>();
  return {
    ...real,
    computePitchingStaff: (teamId: number) => {
      if (broken.pitching) throw new Error('an unfamiliar column');
      return real.computePitchingStaff(teamId);
    },
  };
});

let save: BuiltSave;

beforeAll(() => {
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true, minors: true, lineups: true });
  resetFrontOfficeCache();
  resetClubhouseViews();
}, 120_000);

afterAll(() => {
  broken.pitching = false;
  resetClubhouseViews();
});

describe('one part that can\'t be read takes down only its own view (N9 review, M5)', () => {
  it('words the failed part, logs it, and builds every other view as usual', () => {
    broken.pitching = true;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const built = buildClubhouseViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
      expect(built.failed).toEqual(['pitching']);
      expect(built.pitching.sections).toEqual([]);
      expect(built.pitching.empty?.display).toBe('The pitching staff couldn\'t be read this time.');
      expect(logged).toHaveBeenCalledWith('[clubhouse] pitching could not be read:', expect.any(Error));
      expect(built.schedule.games.table.rows.length).toBeGreaterThan(50);
      expect(built.trends.charts).toHaveLength(3);
      expect(built.lineups.every((l) => l.view.order.rows.length > 0)).toBe(true);
    } finally {
      logged.mockRestore();
      broken.pitching = false;
    }
  });

  it('keeps the build with the failed part for the import, so the next requests are served from the cache', async () => {
    resetClubhouseViews();
    broken.pitching = true;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const org = String(save.org);
      for (let i = 0; i < 3; i++) {
        const pitching = await clubhousePitchingNow(org);
        expect(pitching.empty?.display).toBe('The pitching staff couldn\'t be read this time.');
        expect((await clubhouseTrendsNow(org)).charts).toHaveLength(3);
      }
      expect(clubhouseViewStats().builds).toBe(1);
      expect(logged).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
      broken.pitching = false;
    }
  });
});

describe('a view asked across a change of inputs is not kept (N9 review)', () => {
  it('hands the view to its request, then asks again once the inputs are back, never serving one read under other inputs', async () => {
    resetClubhouseViews();
    const org = String(save.org);
    await clubhouseLineupNow(org);
    const schedule = await clubhouseScheduleNow(org);
    const late = schedule.filters[1].rows.at(-1)!.replace(/^game-/, '');
    const was = importedAt.value;
    const before = clubhouseViewStats().asks;
    // The ask starts under the build's inputs; the inputs move before it is read
    const asked = clubhouseGamePlanNow(org, late);
    importedAt.value = 'another import';
    try {
      expect((await asked).query.game).toBe(Number(late));
    } finally {
      importedAt.value = was;
    }
    expect(clubhouseViewStats().asks - before).toBe(1);
    // Under the build's inputs again: not kept, so asked again (and kept this time)
    await clubhouseGamePlanNow(org, late);
    await clubhouseGamePlanNow(org, late);
    expect(clubhouseViewStats().asks - before).toBe(2);
  });
});
