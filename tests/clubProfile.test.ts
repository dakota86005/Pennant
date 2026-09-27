import { describe, expect, it } from 'vitest';
import { getDataStatus } from '../server/dataStatus.js';
import { CLUB_PROFILE_POLICY, DIMENSIONS, clubProfileOf, groupOf, placesOf } from '../server/frontOffice/clubProfile.js';
import { readTeamSeason, type ClubFacts, type TeamSeasonFacts } from '../server/frontOffice/teamSeason.js';
import { readMorning } from '../server/morningReport.js';
import { clubProfileWords } from '../server/presentation/frontOffice/morning.js';
import { buildSave, exec } from './syntheticSave';

/**
 * "How we win and lose" (BEHAVIOR_CASES.md "Pennant for Mac", `clubProfile.test.ts`; D-057): each dimension a stated
 * place among the clubs that have the figure, ties stated, a missing figure never placed last, the fifths and "too early"
 * as stamped policy lines, nothing combined into a grade. Built from synthetic facts through the pure profile, and from
 * the synthetic save through the reader.
 */

const NO_TOTALS = { batting: null, pitching: null, starting: null, bullpen: null, fielding: null };

/** A club whose runs scored are `runs` over `games` (the other totals as given). */
function club(teamId: number, runs: number | null, games = 40, extra: Partial<ClubFacts> = {}): ClubFacts {
  return {
    teamId, name: `Club ${teamId}`, abbr: null, subLeagueId: 0, divisionId: 0,
    record: { w: games / 2, l: games / 2, t: 0, g: games, pos: 1, gb: 0, streak: 1 },
    totals: { ...NO_TOTALS, batting: runs === null ? null : { r: runs, g: games } },
    duplicated: [], baserunningRuns: null,
    ...extra,
  };
}

function facts(clubs: ClubFacts[], orgId = 1): TeamSeasonFacts {
  return {
    orgId, leagueId: 1, season: 2040, currentDate: '2040-6-1', scheduledGames: 162, clubs, divisions: [], subLeagues: [],
    games: [], gamesWhy: 'The export has no game-by-game schedule.', next: null, nextWhy: null, projected: [], projectedWhy: null,
    deadline: null, deadlineWhy: null, log: { batting: null, starting: null, relief: null, why: 'none' },
  };
}

const scoring = (f: TeamSeasonFacts) => clubProfileOf(f).dimensions.find((d) => d.id === 'scoring')!;

describe('a place counts only the clubs that have the figure', () => {
  it('leaves a club missing the statistic out of "of N", never last, and names it', () => {
    const d = scoring(facts([club(1, 150), club(2, 200), club(3, null), club(4, 100)]));
    expect(d.place).toEqual({ rank: 2, of: 3, tiedWith: 0 });
    expect(d.leftOut).toEqual([{ club: 'Club 3', why: 'The export has no runs scored for the club.' }]);
    // The club missing it is ours: not placed, and not a weakness
    const mine = scoring(facts([club(1, null), club(2, 200), club(3, 150)]));
    expect(mine.place).toBeNull();
    expect(mine.group).toBe('notPlaced');
  });

  it('does not place a club whose row the export gives twice', () => {
    const d = scoring(facts([club(1, 150), club(2, 200, 40, { duplicated: ['batting'] }), club(3, 100)]));
    expect(d.place?.of).toBe(2);
    expect(d.leftOut[0].why).toMatch(/more than one season row/);
  });

  it('shares the best place between clubs level at the figure as shown, and names them', () => {
    // 4.625 and 4.6275 both show as 4.63
    const d = scoring(facts([club(1, 185, 40), club(2, 185.1, 40), club(3, 200, 40), club(4, 100, 40)]));
    expect(d.place).toEqual({ rank: 2, of: 4, tiedWith: 1 });
    expect(d.tiedWith).toEqual(['Club 2']);
  });

  it('never gives a better figure a worse place, whichever way is better', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const better of ['higher', 'lower'] as const) {
      for (let trial = 0; trial < 50; trial += 1) {
        const values = new Map(Array.from({ length: 12 }, (_, i) => [i + 1, rnd() < 0.1 ? null : Math.round(rnd() * 1000) / 100] as const));
        const places = placesOf(values, better, 2);
        for (const [a, pa] of places) {
          for (const [b, pb] of places) {
            const va = values.get(a)!;
            const vb = values.get(b)!;
            if ((better === 'higher' ? va > vb : va < vb) && Number(va.toFixed(2)) !== Number(vb.toFixed(2))) expect(pa.rank).toBeLessThan(pb.rank);
          }
        }
        expect([...places.values()].every((p) => p.of === [...values.values()].filter((v) => v !== null).length)).toBe(true);
      }
    }
  });

  it('reads fewer runs allowed and fewer earned runs as better', () => {
    expect(DIMENSIONS.filter((d) => d.better === 'lower').map((d) => d.id)).toEqual(['preventing', 'rotation', 'bullpen']);
  });
});

describe('the policy lines: fifths and "too early", stamped as policy', () => {
  const place = (rank: number, of: number) => ({ rank, of, tiedWith: 0 });

  it('a hair either side of the top and bottom fifths of thirty', () => {
    expect(groupOf(place(6, 30))).toBe('strength');
    expect(groupOf(place(7, 30))).toBe('rest');
    expect(groupOf(place(24, 30))).toBe('rest');
    expect(groupOf(place(25, 30))).toBe('weakness');
  });

  it('counts the fifths in the league\'s own size, and a league too small for a fifth has neither', () => {
    expect([1, 2, 3, 4].map((r) => groupOf(place(r, 4)))).toEqual(['rest', 'rest', 'rest', 'rest']);
    expect([1, 2, 5].map((r) => groupOf(place(r, 5)))).toEqual(['strength', 'rest', 'weakness']);
    expect(groupOf(place(2, 12))).toBe('strength');
    expect(groupOf(place(3, 12))).toBe('rest');
  });

  it('reads "too early" below 20 games and neither a strength nor a weakness, a hair either side of the line', () => {
    const at = (games: number) => clubProfileOf(facts(Array.from({ length: 10 }, (_, i) => club(i + 1, (10 - i) * games, games))));
    expect(at(19).tooEarly).toBe(true);
    expect(at(19).dimensions.every((d) => d.group === 'tooEarly')).toBe(true);
    expect(at(20).tooEarly).toBe(false);
    expect(at(20).dimensions.find((d) => d.id === 'scoring')!.group).toBe('strength');
    expect(CLUB_PROFILE_POLICY.minGames).toBe(20);
  });

  it('stamps each placed dimension as policy with the lines, and serves the lines themselves', () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 6, seed: 11, teamSeason: true });
    const m = readMorning(save.org, getDataStatus(), null);
    const words = clubProfileWords({ orgId: save.org, club: null, importStamp: null, reportStamp: 'r', gameDate: '2040-5-5' }, m);
    expect(words.dimensions).toHaveLength(8);
    for (const d of words.dimensions.filter((x) => x.place)) {
      expect(d.claim.basis.certainty).toBe('policy');
      expect(d.claim.basis.stamp).toBe(CLUB_PROFILE_POLICY.stamp);
    }
    expect(words.lines.strength.display).toBe('Top fifth of the league');
    expect(words.note.hint).toBe('Places among the league\'s 6 clubs');
  });
});

describe('the recent place', () => {
  it('reads the last 15 games of every club, and a club whose last 15 the game log does not hold is not placed there', () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 6, seed: 11, teamSeason: true });
    let reading = clubProfileOf(readTeamSeason(save.org));
    const onBase = () => reading.dimensions.find((d) => d.id === 'onBase')!;
    expect(onBase().recent.place?.of).toBe(6);
    // One of club 3's last games is missing from the batting log
    const last = (readTeamSeason(save.org).games.filter((g) => g.home === 3 || g.away === 3).at(-1))!;
    exec(`DELETE FROM players_game_batting WHERE team_id = 3 AND game_id = ${last.gameId}`);
    reading = clubProfileOf(readTeamSeason(save.org));
    expect(onBase().recent.place?.of).toBe(5);
    // Runs come from the schedule itself, so every club keeps its recent place there
    expect(reading.dimensions.find((d) => d.id === 'scoring')!.recent.place?.of).toBe(6);
    // Our own missing game: not placed, with why
    const ours = (readTeamSeason(save.org).games.filter((g) => g.home === save.org || g.away === save.org).at(-1))!;
    exec(`DELETE FROM players_game_batting WHERE team_id = ${save.org} AND game_id = ${ours.gameId}`);
    reading = clubProfileOf(readTeamSeason(save.org));
    expect(onBase().recent.place).toBeNull();
    expect(onBase().recent.why).toMatch(/game log doesn't hold all of the club's last 15 games/);
  });

  it('says too few before 15 games', () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.2, clubs: 4, seed: 11, teamSeason: true });
    const reading = clubProfileOf(readTeamSeason(save.org));
    expect(reading.games).toBeLessThan(15);
    expect(reading.dimensions.every((d) => d.recent.place === null && /Fewer than 15/.test(d.recent.why ?? ''))).toBe(true);
    const words = clubProfileWords({ orgId: save.org, club: null, importStamp: null, reportStamp: 'r', gameDate: null }, readMorning(save.org, getDataStatus(), null));
    expect(words.dimensions.every((d) => d.recent.text === 'Last 15: too few' && d.placeText === 'Too early')).toBe(true);
  });
});

describe('the profile stands alone', () => {
  it('is the same whatever the club\'s record: only the figures move a place', () => {
    const base = [club(1, 150), club(2, 200), club(3, 120), club(4, 100), club(5, 180)];
    const winning = base.map((c) => ({ ...c, record: { ...c.record!, w: c.teamId === 1 ? 35 : 5, l: c.teamId === 1 ? 5 : 35 } }));
    const strip = (f: TeamSeasonFacts) => clubProfileOf(f).dimensions.map((d) => [d.id, d.place, d.group]);
    expect(strip(facts(winning))).toEqual(strip(facts(base)));
  });

  it('combines no dimension into a grade: each carries its own place and nothing sums them', () => {
    const reading = clubProfileOf(facts([club(1, 150), club(2, 200), club(3, 120)]));
    expect(Object.keys(reading).sort()).toEqual(['clubs', 'dimensions', 'games', 'policy', 'tooEarly']);
    for (const d of reading.dimensions) expect(Object.keys(d)).not.toContain('score');
  });
});
