import { beforeAll, describe, expect, it, vi } from 'vitest';
import { gradeOwners } from './ratingFillMarks';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * The OSA mark wherever a grade is shown (D-067, N11, review M4): when a player's grades are OSA's view filling in for our
 * scouts, every served row, card and detail that shows his grades, or rests on them, carries the mark (`ratingsFill`) for
 * the app to draw beside them. A general check: here every player reads as filled, and each department's payloads are
 * walked for anything that names a player and shows a grade without the mark.
 */
const SENTENCE = 'OSA\'s view: our scouts haven\'t rated him.';

vi.mock('../server/scoutedEvidence.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../server/scoutedEvidence.js')>();
  return { ...original, ratingFillOf: () => ({ mark: 'OSA', hint: 'OSA\'s view: our scouts haven\'t rated him.' }) };
});

let save: BuiltSave;

beforeAll(() => {
  save = buildSave({ season: 2040, historySeasons: 2, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, minors: true, teamSeason: true, lineups: true });
}, 120_000);

describe('the OSA mark is carried wherever a grade is shown (review M4)', () => {
  it('on every farm row that shows a grade', async () => {
    const { buildFarmViews } = await import('../server/farmViewsBuild.js');
    const { views } = buildFarmViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
    const owners = gradeOwners(views, 'farm');
    // The synthetic save's board rows (its meeting cards and Development details are checked in farmViews.test.ts)
    expect(owners.length).toBeGreaterThan(0);
    expect(owners.filter((o) => !o.marked).map((o) => o.path)).toEqual([]);
  });

  it('on every Major League Ops row and decision candidate that shows a grade', async () => {
    const { majorLeagueDecision, majorLeagueView, resetFrontOfficeCache } = await import('../server/frontOfficeService.js');
    resetFrontOfficeCache();
    const owners: Array<{ path: string; marked: boolean }> = [];
    for (const id of ['overview', 'positionPlayers', 'pitchingStaff', 'benchBackups'] as const) {
      owners.push(...gradeOwners(await majorLeagueView(save.org, id), id));
    }
    const overview = await majorLeagueView(save.org, 'overview');
    const needs = overview.inbox.flatMap((g) => g.needs.map((n) => n.open.key!)).slice(0, 4);
    expect(needs.length).toBeGreaterThan(0);
    for (const need of needs) owners.push(...gradeOwners(await majorLeagueDecision(save.org, { need }), `decision:${need}`));
    expect(owners.some((o) => o.path.startsWith('decision:') && o.path.includes('candidates'))).toBe(true);
    expect(owners.filter((o) => !o.marked).map((o) => o.path)).toEqual([]);
  });

  it('on every clubhouse tool\'s row and depth-chart entry that shows a grade (N9)', async () => {
    const { buildClubhouseViews } = await import('../server/clubhouseViewsBuild.js');
    const built = buildClubhouseViews({ orgId: save.org, importStamp: null, reportStamp: 'r1' });
    const { failed, ms: _ms, ...views } = built;
    expect(failed).toEqual([]);
    const owners = gradeOwners(views, 'clubhouse');
    // Each tool that shows a grade has something checked: the lineup, the staff, the depth (both modes) and the rosters
    for (const part of ['lineups', 'pitching', 'depth.clubs', 'depth.byPosition', 'rosters']) {
      expect(owners.some((o) => o.path.startsWith(`clubhouse.${part}`)), part).toBe(true);
    }
    expect(owners.filter((o) => !o.marked).map((o) => o.path)).toEqual([]);
    for (const entry of built.depth.clubs.flatMap((c) => c.positions.flatMap((p) => p.players))) {
      expect(entry.ratingsFill).toMatchObject({ display: 'OSA', hint: SENTENCE });
    }
  });

  it('on the player window and Compare', async () => {
    const { buildPlayerDossiers } = await import('../server/playerDossierBuild.js');
    const { compareView } = await import('../server/presentation/player/compare.js');
    const { views } = buildPlayerDossiers({ orgId: save.org, importStamp: null, reportStamp: 'r1', playerIds: save.hitters.slice(0, 2) });
    for (const v of views) {
      expect(v.header.ratingsFill).toMatchObject({ display: 'OSA', hint: SENTENCE });
      for (const r of v.ratings.groups.flatMap((g) => g.rows)) expect(r.cells.grade.hint).toBe(SENTENCE);
    }
    const c = compareView(views, save.org, null);
    for (const p of c.players) expect(p.ratingsFill).toMatchObject({ display: 'OSA' });
  });
});
