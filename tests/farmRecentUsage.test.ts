import { describe, expect, it } from 'vitest';
import { RECENT_MINIMUM_GAMES, RECENT_WINDOW_GAMES } from '../server/farmCalibration.js';
import {
  describeTenure,
  lastAppearances,
  moundStarters,
  pitcherJob,
  positionStarters,
  recentPrimaryPosition,
  recentUsageFor,
  windowStart,
} from '../server/farmRecentUsage.js';
import type { ClubGameLog } from '../server/farmUsage.js';
import { clubLog, dayOf, offTheBench, recentOf, relieves, span, startsAt, startsOnMound } from './farmGolden.js';

/**
 * The recent read, on its own: what the window is, when a man joined, which games can be counted for
 * him, and how much the answer can carry. Nothing here knows about a job or a conflict.
 */

describe('the window is the club\'s last games, not its last days', () => {
  it('covers at most the declared number of games, counted from the most recent', () => {
    const log = clubLog(40);
    expect(windowStart(log)).toBe(40 - RECENT_WINDOW_GAMES);
    expect(recentOf(log, 1).windowGames).toBe(RECENT_WINDOW_GAMES);
  });

  it('is the whole season for a club that has played fewer games than the window', () => {
    const log = clubLog(9);
    expect(windowStart(log)).toBe(0);
    expect(recentOf(log, 1).windowGames).toBe(9);
  });

  it('is unavailable — null, not thin — when the export carries no game log', () => {
    const none: ClubGameLog = { teamId: 10, available: false, games: [], lines: new Map() };
    expect(recentUsageFor({ log: none, playerId: 1, arrival: null, chronologyAvailable: true, lastGameElsewhere: null, absences: [] })).toBeNull();
  });

  it('counts only what happened inside it: a start before the window is the season\'s, not the recent read\'s', () => {
    const log = clubLog(40);
    startsAt(log, 1, 'SS', span(0, 40));
    expect(recentOf(log, 1).startGames.SS).toHaveLength(RECENT_WINDOW_GAMES);
  });
});

describe('when he joined: the source hierarchy', () => {
  it('reads OOTP\'s dated move first, and names where he came from', () => {
    const log = clubLog(40);
    const r = recentOf(log, 1, { arrivedOn: dayOf(log, 36), from: 'Lower Club' });
    expect(r.tenure).toMatchObject({ status: 'recent_arrival', basis: 'transaction_log', from: 'Lower Club', clubGamesSince: 4 });
    expect(r.observable).toEqual([11, 12, 13, 14]);
  });

  it('falls back to the game log\'s bound when the transaction log is unavailable', () => {
    const log = clubLog(40);
    /* He last played for another club on the day of game 35, so he cannot have been here before game 36. */
    const r = recentOf(log, 1, { chronology: false, lastGameElsewhere: dayOf(log, 35) });
    expect(r.tenure).toMatchObject({ status: 'recent_arrival', basis: 'game_log', arrivedOn: dayOf(log, 36), clubGamesSince: 4 });
  });

  it('takes the LATER of the two when both speak: each is only a lower bound on his first possible game here', () => {
    const log = clubLog(40);
    /* The move is dated the day of game 34, but he still played for his old club on the day of game 35. */
    const r = recentOf(log, 1, { arrivedOn: dayOf(log, 34), lastGameElsewhere: dayOf(log, 35) });
    expect(r.tenure.basis).toBe('game_log');
    expect(r.tenure.clubGamesSince).toBe(4);
  });

  it('is established when the log is readable and shows no move: he has been here since before it began', () => {
    expect(recentOf(clubLog(40), 1, { chronology: true }).tenure.status).toBe('established');
  });

  it('is established on a move dated before the window opened', () => {
    const log = clubLog(40);
    const r = recentOf(log, 1, { arrivedOn: dayOf(log, 5) });
    expect(r.tenure.status).toBe('established');
    expect(r.observable).toHaveLength(RECENT_WINDOW_GAMES);
  });

  it('without the log, a man who played for the club before the window opened was demonstrably here', () => {
    const log = clubLog(40);
    startsAt(log, 1, 'SS', [3]);
    expect(recentOf(log, 1, { chronology: false }).tenure.status).toBe('established');
  });

  it('without the log, a man never seen before the window is UNKNOWN — he may have arrived yesterday', () => {
    const r = recentOf(clubLog(40), 1, { chronology: false });
    expect(r.tenure.status).toBe('unknown');
    /* Fifteen games in which he did not play say nothing about his role if he may not have been here. */
    expect(r.evidence).toBe('thin');
    expect(describeTenure(r.tenure)).toMatch(/cannot be told/);
  });
});

describe('sample awareness: how much the recent read can carry', () => {
  it('is sufficient from the declared minimum of observable games', () => {
    const log = clubLog(40);
    expect(recentOf(log, 1, { arrivedOn: dayOf(log, 40 - RECENT_MINIMUM_GAMES) }).evidence).toBe('sufficient');
  });

  it('is thin one game below it', () => {
    const log = clubLog(40);
    expect(recentOf(log, 1, { arrivedOn: dayOf(log, 40 - RECENT_MINIMUM_GAMES + 1) }).evidence).toBe('thin');
  });

  it('is none for a man who joined after the club\'s last game', () => {
    const log = clubLog(40);
    const r = recentOf(log, 1, { arrivedOn: '2031-01-01' });
    expect(r.evidence).toBe('none');
    expect(r.observable).toEqual([]);
    expect(describeTenure(r.tenure)).toMatch(/after its last game/);
  });

  it('does not count a game he missed to a recorded injury, and says how many he missed', () => {
    const log = clubLog(40);
    const r = recentOf(log, 1, { absences: [{ from: dayOf(log, 25), to: dayOf(log, 36) }] });
    expect(r.gamesMissedInjured).toBe(11);
    expect(r.observable).toEqual([11, 12, 13, 14]);
    expect(r.evidence).toBe('thin');
  });

  it('removing observable games never raises the evidence it reports', () => {
    const log = clubLog(40);
    const rank = { none: 0, thin: 1, sufficient: 2 } as const;
    let previous = 3;
    /* He joins one game later each time, down to joining after the club's last game. */
    for (let joined = 25; joined <= 40; joined++) {
      const evidence = recentOf(log, 1, { arrivedOn: log.games[joined]?.date ?? '2031-01-01' }).evidence;
      expect(rank[evidence]).toBeLessThanOrEqual(previous);
      previous = rank[evidence];
    }
    expect(previous).toBe(rank.none);
  });
});

describe('what he did in the games that can be counted', () => {
  it('separates fielding starts, DH starts, bench appearances and the lineup', () => {
    const log = clubLog(40);
    startsAt(log, 1, 'SS', span(25, 31));
    startsAt(log, 1, 'DH', span(31, 35));
    offTheBench(log, 1, [35, 36]);
    const r = recentOf(log, 1);
    expect(r.startGames.SS).toHaveLength(6);
    expect(r.dhStarts).toBe(4);
    expect(r.benchAppearances).toBe(2);
    expect(r.lineupStartGames).toHaveLength(10);
    expect(r.games).toBe(12);
  });

  it('a line from before he arrived is an earlier stint here: history, not the present', () => {
    const log = clubLog(40);
    startsAt(log, 1, 'SS', span(25, 30)); /* here, left, came back */
    startsAt(log, 1, 'SS', span(37, 40));
    const r = recentOf(log, 1, { arrivedOn: dayOf(log, 37) });
    expect(r.startGames.SS).toHaveLength(3);
    expect(r.lastAppearance).toBe(14);
  });

  it('separates a pitcher\'s starts from his relief work', () => {
    const log = clubLog(40);
    startsOnMound(log, 1, [26, 31]);
    relieves(log, 1, [34, 36, 38], 6);
    const r = recentOf(log, 1);
    expect(r.pitchingStartGames).toEqual([1, 6]);
    expect(r.reliefGames.map((g) => g.outs)).toEqual([6, 6, 6]);
  });

  it('names the position he has started at most lately, and nothing for a man who has only batted', () => {
    const log = clubLog(40);
    startsAt(log, 1, 'LF', span(25, 29));
    startsAt(log, 1, 'CF', span(29, 40));
    startsAt(log, 2, 'DH', span(25, 40));
    expect(recentPrimaryPosition(recentOf(log, 1))).toBe('CF');
    expect(recentPrimaryPosition(recentOf(log, 2))).toBeNull();
  });
});

describe('the job-level reads of the log', () => {
  it('names the one starter at a position in each window game, whoever he is', () => {
    const log = clubLog(40);
    startsAt(log, 1, 'SS', span(25, 34));
    startsAt(log, 2, 'SS', span(34, 40));
    const starters = positionStarters(log, 'SS');
    expect(starters).toHaveLength(RECENT_WINDOW_GAMES);
    expect(starters.slice(0, 9).every((id) => id === 1)).toBe(true);
    expect(starters.slice(9).every((id) => id === 2)).toBe(true);
  });

  it('names the man on the mound the same way, and leaves a game nobody is recorded for as null', () => {
    const log = clubLog(40);
    startsOnMound(log, 7, [25, 30, 35]);
    const starters = moundStarters(log);
    expect(starters[0]).toBe(7);
    expect(starters[1]).toBeNull();
  });

  it('knows the last game every man appeared in, on the roster or not', () => {
    const log = clubLog(40);
    startsAt(log, 1, 'SS', [26, 29]);
    offTheBench(log, 1, [33]);
    expect(lastAppearances(log).get(1)).toBe(8);
  });
});

describe('which job a pitcher is competing for', () => {
  const log = clubLog(40);
  startsOnMound(log, 1, [2, 7, 12]); /* three April starts, none since */
  relieves(log, 1, [27, 30, 33, 36, 39]);

  it('is the rotation for OOTP\'s assigned or projected starter, whatever his usage', () => {
    expect(pitcherJob({ assignedStarter: true, projectedStarter: null, seasonStarts: 0, recent: null })).toBe('the rotation');
    expect(pitcherJob({ assignedStarter: false, projectedStarter: true, seasonStarts: 0, recent: recentOf(log, 1) })).toBe('the rotation');
  });

  it('is the bullpen for a man who started in April and has only relieved lately', () => {
    expect(pitcherJob({ assignedStarter: false, projectedStarter: false, seasonStarts: 3, recent: recentOf(log, 1) })).toBe('the bullpen');
  });

  it('reads the season only when the window cannot be read', () => {
    expect(pitcherJob({ assignedStarter: false, projectedStarter: null, seasonStarts: 3, recent: null })).toBe('the rotation');
    /* Four games at a new club re-assign nobody: the thin window defers to the season. */
    const newcomer = recentOf(log, 1, { arrivedOn: dayOf(log, 36) });
    expect(pitcherJob({ assignedStarter: false, projectedStarter: null, seasonStarts: 3, recent: newcomer })).toBe('the rotation');
  });
});
