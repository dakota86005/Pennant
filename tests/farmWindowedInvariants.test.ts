import { describe, expect, it } from 'vitest';
import { RECENT_MINIMUM_GAMES, RECENT_ROTATION_SHARE, RECENT_WINDOW_GAMES, REGULAR_SHARE } from '../server/farmCalibration.js';
import {
  blockersOf,
  jobRead,
  ownWork,
  positionConflict,
  readOpportunity,
  reliefConflict,
  rotationConflict,
  type PlayingTimeConflict,
  type WorkLevel,
} from '../server/playingTime.js';
import { recentPrimaryPosition } from '../server/farmRecentUsage.js';
import { reviewRetention } from '../server/farmRetention.js';
import { evaluateCurrentAssignment } from '../server/currentAssignment.js';
import { farmConsequence } from '../server/mlbEvidence.js';
import { farmConsequenceFor, currentOpportunityOf } from '../server/farmConsequence.js';
import { openFarmSession } from '../server/farmOperations.js';
import { IDS } from './fixture.js';
import request from './request.js';
import { clubLog, currentInput, dayOf, everyFifth, jobWindowOf, recentOf, relieves, span, startsAt, startsOnMound, tierOf, usage } from './farmGolden.js';

/**
 * Invariants of windowed usage: relations that must hold whatever the numbers are.
 *
 * Metamorphic rather than example-based — each varies one input and states what may and may not move.
 * None is here for coverage: every one is a way the season-only model was, or a careless window would
 * be, wrong (docs/MINOR_LEAGUE_OPERATIONS.md Part 8).
 */

const GAMES = 40;
const INNINGS = 360;
const RANK: Record<WorkLevel, number> = { unknown: -1, not_used: 0, occasional: 1, bat_only: 1, part_time: 2, regular: 3 };
const must = (c: PlayingTimeConflict | null): PlayingTimeConflict => {
  expect(c).not.toBeNull();
  return c as PlayingTimeConflict;
};

describe('a departed man is never a current blocker', () => {
  /* A prospect who has not played, a regular ahead of him, and a man who held most of the job and left. */
  const scenario = (departedInnings: number, departedWindowStarts: number) => {
    const log = clubLog(GAMES);
    startsAt(log, 100, 'SS', span(25, 25 + departedWindowStarts));
    startsAt(log, 9, 'SS', span(25 + departedWindowStarts, 40));
    const prospect = usage({ playerId: 1, name: 'Prospect', clubGames: GAMES, games: 2, inningsByPosition: { SS: 4 }, recent: recentOf(log, 1) });
    const holder = usage({ playerId: 9, name: 'Holder', clubGames: GAMES, games: 20, inningsByPosition: { SS: INNINGS - departedInnings - 4 }, tier: 'normal', recent: recentOf(log, 9) });
    const departed = [{ playerId: 100, name: 'Departed', seasonWork: departedInnings, nowAt: 'Higher Club', lastSeen: departedWindowStarts - 1 }];
    return must(positionConflict(10, 'SS', [prospect, holder], INNINGS, [], jobWindowOf(log, 'SS', departed)));
  };

  it.each([0, 3, 6, 9])('with %i of the window\'s starts, he is history and never ahead of anybody', (windowStarts) => {
    const conflict = scenario(250, windowStarts);
    const read = readOpportunity(1, [conflict]);
    expect(read.ahead.map((a) => a.playerId)).not.toContain(100);
    expect(blockersOf(read).map((b) => b.playerId)).not.toContain(100);
    expect([...conflict.claimants, ...conflict.alsoPlaying].map((s) => s.playerId)).not.toContain(100);
  });

  it('raising what he did before he left cannot restore him as a blocker', () => {
    for (const innings of [50, 150, 250, 340]) {
      const read = readOpportunity(1, [scenario(innings, 6)]);
      expect(blockersOf(read).map((b) => b.playerId)).not.toContain(100);
    }
  });

  it('and the more of the season he held, the more of it is named as history — never silently dropped', () => {
    const shares = [50, 150, 250].map((innings) => scenario(innings, 6).gone.find((g) => g.playerId === 100)!.seasonShare!);
    expect(shares[0]).toBeLessThan(shares[1]);
    expect(shares[1]).toBeLessThan(shares[2]);
  });
});

describe('more recent work at the job never reduces the evidence that he holds it', () => {
  const levelWith = (myStarts: number): { level: WorkLevel; share: number | null } => {
    const log = clubLog(GAMES);
    startsAt(log, 1, 'SS', span(25, 25 + myStarts));
    startsAt(log, 9, 'SS', span(25 + myStarts, 40));
    const me = usage({ playerId: 1, name: 'Me', clubGames: GAMES, games: 20, inningsByPosition: { SS: 100 }, recent: recentOf(log, 1) });
    const him = usage({ playerId: 9, name: 'Him', clubGames: GAMES, games: 20, inningsByPosition: { SS: 260 }, tier: 'normal', recent: recentOf(log, 9) });
    const work = ownWork(1, { kind: 'position', position: 'SS' }, { claimants: [me, him], clubInningsAtPosition: INNINGS, clubGames: GAMES, window: jobWindowOf(log, 'SS') })!;
    return { level: work.level, share: work.share };
  };

  it('his level and his share are monotonic in his starts, all else equal', () => {
    let previous = { rank: -2, share: -1 };
    for (let starts = 0; starts <= RECENT_WINDOW_GAMES; starts++) {
      const now = levelWith(starts);
      expect(RANK[now.level]).toBeGreaterThanOrEqual(previous.rank);
      expect(now.share ?? 0).toBeGreaterThanOrEqual(previous.share);
      previous = { rank: RANK[now.level], share: now.share ?? 0 };
    }
  });

  it('the regular line in starts is the season\'s regular line in innings: no second threshold', () => {
    const needed = Math.ceil(REGULAR_SHARE * RECENT_WINDOW_GAMES);
    expect(levelWith(needed).level).toBe('regular');
    expect(levelWith(needed - 1).level).not.toBe('regular');
  });
});

describe('less recent evidence means more uncertainty, never more confidence', () => {
  /* The same man, doing the same thing every game, observable for fewer and fewer of them. */
  const readAfter = (gamesSince: number, plays: boolean) => {
    const log = clubLog(GAMES);
    if (plays) startsAt(log, 1, 'SS', span(0, 40));
    startsAt(log, 9, 'SS', plays ? [] : span(0, 40));
    const me = usage({ playerId: 1, name: 'Me', clubGames: GAMES, games: plays ? gamesSince : 0, inningsByPosition: { SS: plays ? 9 * gamesSince : 0 }, recent: recentOf(log, 1, { arrivedOn: dayOf(log, GAMES - gamesSince) }) });
    const him = usage({ playerId: 9, name: 'Him', clubGames: GAMES, games: 30, inningsByPosition: { SS: 300 }, tier: 'normal', recent: recentOf(log, 9) });
    return must(positionConflict(10, 'SS', [me, him, usage({ playerId: 3, name: 'Third', tier: 'organizational_depth', clubGames: GAMES, recent: recentOf(log, 3) })], INNINGS, [], jobWindowOf(log, 'SS')));
  };

  it('below the minimum his role is unknown whether he has played every game or none', () => {
    for (let since = 1; since < RECENT_MINIMUM_GAMES; since++) {
      for (const plays of [true, false]) {
        const me = readAfter(since, plays).claimants.find((s) => s.playerId === 1)!;
        expect(me.level).toBe('unknown');
        expect(me.recent?.evidence).toBe('thin');
      }
    }
  });

  it('a thin read never makes him squeezed and never makes him a blocker', () => {
    for (let since = 1; since < RECENT_MINIMUM_GAMES; since++) {
      const idle = readAfter(since, false);
      expect(idle.squeezed.map((s) => s.playerId)).not.toContain(1);
      const busy = readAfter(since, true);
      expect(blockersOf(readOpportunity(9, [busy])).map((b) => b.playerId)).not.toContain(1);
    }
  });

  it('from the minimum on, the same usage is read for what it is', () => {
    expect(readAfter(RECENT_MINIMUM_GAMES, true).claimants.find((s) => s.playerId === 1)!.level).toBe('regular');
    expect(readAfter(RECENT_MINIMUM_GAMES, false).claimants.find((s) => s.playerId === 1)!.level).toBe('not_used');
  });
});

describe('a disagreement is material, or it is not a disagreement', () => {
  const read = (seasonInnings: number, windowStarts: number) => {
    const log = clubLog(GAMES);
    startsAt(log, 1, 'SS', span(25, 25 + windowStarts));
    startsAt(log, 9, 'SS', span(25 + windowStarts, 40));
    const me = usage({ playerId: 1, name: 'Me', clubGames: GAMES, games: 20, inningsByPosition: { SS: seasonInnings }, recent: recentOf(log, 1) });
    const him = usage({ playerId: 9, name: 'Him', clubGames: GAMES, games: 20, inningsByPosition: { SS: INNINGS - seasonInnings }, tier: 'normal', recent: recentOf(log, 9) });
    return ownWork(1, { kind: 'position', position: 'SS' }, { claimants: [me, him], clubInningsAtPosition: INNINGS, clubGames: GAMES, window: jobWindowOf(log, 'SS') })!;
  };

  it('one step apart is the noise of a fortnight, and raises no flag', () => {
    /* A farm club moves men through positions: a season's regular at 42% is a fortnight's part-timer at 33%. */
    const work = read(150, 5);
    expect([work.season.level, work.level]).toEqual(['regular', 'part_time']);
    expect(work.disagrees).toBe(false);
  });

  it('two steps apart is a lost job or a won one, and is said', () => {
    expect(read(150, 1)).toMatchObject({ level: 'occasional', disagrees: true });
    expect(read(20, 9)).toMatchObject({ level: 'regular', disagrees: true });
  });
});

describe('a man nobody is competing with is still read', () => {
  it('a lone claimant starting twice a fortnight is not "getting regular work because no job is contested"', () => {
    const log = clubLog(GAMES);
    startsAt(log, 1, 'LF', [27, 35]);
    startsAt(log, 7, 'LF', span(25, 40).filter((g) => ![27, 35].includes(g)));
    const prospect = usage({ playerId: 1, name: 'Lone Prospect', clubGames: GAMES, games: 6, inningsByPosition: { LF: 40 }, recent: recentOf(log, 1) });
    /* The man actually playing left field is listed, and competing, somewhere else. */
    const cover = usage({ playerId: 7, name: 'Cover From Right', clubGames: GAMES, games: 36, inningsByPosition: { LF: 300, RF: 20 }, tier: 'normal', recent: recentOf(log, 7) });
    const context = { claimants: [prospect], alsoPlaying: [cover], clubInningsAtPosition: INNINGS, clubGames: GAMES, window: jobWindowOf(log, 'LF') };

    /* There is no conflict: one claimant is not a competition. */
    expect(positionConflict(10, 'LF', context.claimants, INNINGS, context.alsoPlaying, context.window)).toBeNull();
    expect(readOpportunity(1, []).verdict).toBe('regular_work');

    /* His own job read says what is true of him, and names who has the work. */
    const own = readOpportunity(1, [jobRead({ kind: 'position', position: 'LF' }, context)!]);
    expect(own.verdict).toBe('insufficient_work');
    expect(own.ahead.map((a) => [a.name, a.claimant])).toEqual([['Cover From Right', false]]);
    expect(blockersOf(own).map((b) => b.name)).toEqual(['Cover From Right']);
  });
});

describe('without a game log, nothing changes', () => {
  it('every read is the season\'s, exactly, and says so', () => {
    const a = usage({ playerId: 1, name: 'A', clubGames: 100, inningsByPosition: { SS: 700 }, tier: 'normal' });
    const b = usage({ playerId: 2, name: 'B', clubGames: 100, inningsByPosition: { SS: 60 } });
    const c = usage({ playerId: 3, name: 'C', clubGames: 100, inningsByPosition: { SS: 40 }, tier: 'organizational_depth' });
    const conflict = must(positionConflict(10, 'SS', [a, b, c], 800));
    expect(conflict.timing).toBe('season_only');
    expect(conflict.window).toBeNull();
    expect(conflict.gone).toEqual([]);
    for (const s of conflict.claimants) {
      expect(s.levelFrom).toBe('season');
      expect(s.recent).toBeNull();
      expect(s.level).toBe(s.season.level);
      expect(s.share).toBe(s.season.share);
    }
    expect(conflict.squeezed).toEqual(conflict.squeezedOverSeason);
  });
});

describe('hitters: the usage patterns a farm club actually shows', () => {
  it('an everyday shortstop is the regular, and his window agrees with his season', () => {
    const log = clubLog(GAMES);
    startsAt(log, 1, 'SS', span(0, 40).filter((g) => g % 7 !== 0));
    const me = usage({ playerId: 1, name: 'Everyday', clubGames: GAMES, games: 34, inningsByPosition: { SS: 300 }, recent: recentOf(log, 1) });
    const work = ownWork(1, { kind: 'position', position: 'SS' }, { claimants: [me], clubInningsAtPosition: INNINGS, clubGames: GAMES, window: jobWindowOf(log, 'SS') })!;
    expect(work).toMatchObject({ level: 'regular', disagrees: false });
  });

  it('a utility man rotating through three positions claims ONE job; the others are cover', () => {
    const log = clubLog(GAMES);
    startsAt(log, 1, '2B', [25, 28, 31, 34, 37, 39]);
    startsAt(log, 1, 'SS', [26, 29, 32, 35]);
    startsAt(log, 1, '3B', [27, 30, 33, 36]);
    expect(recentPrimaryPosition(recentOf(log, 1))).toBe('2B');
  });

  it('two catchers splitting the reps are both regulars, and neither is squeezed', () => {
    const log = clubLog(GAMES);
    startsAt(log, 1, 'C', span(25, 40).filter((g) => g % 2 === 1));
    startsAt(log, 2, 'C', span(25, 40).filter((g) => g % 2 === 0));
    const one = usage({ playerId: 1, name: 'Catcher One', clubGames: GAMES, games: 20, inningsByPosition: { C: 190 }, recent: recentOf(log, 1) });
    const two = usage({ playerId: 2, name: 'Catcher Two', clubGames: GAMES, games: 20, inningsByPosition: { C: 170 }, recent: recentOf(log, 2) });
    const third = usage({ playerId: 3, name: 'Third Catcher', clubGames: GAMES, games: 0, inningsByPosition: {}, tier: 'organizational_depth', recent: recentOf(log, 3) });
    const conflict = must(positionConflict(10, 'C', [one, two, third], INNINGS, [], jobWindowOf(log, 'C')));
    expect(conflict.claimants.filter((s) => s.level === 'regular')).toHaveLength(2);
    expect(conflict.squeezed).toEqual([]);
  });

  it('a man batting most days and fielding rarely is batting, not fielding — read from his lineup starts', () => {
    const log = clubLog(GAMES);
    startsAt(log, 1, '1B', [26, 33]);
    startsAt(log, 1, 'DH', span(25, 40).filter((g) => ![26, 33, 38].includes(g)));
    startsAt(log, 9, '1B', span(25, 40).filter((g) => ![26, 33].includes(g)));
    const dh = usage({ playerId: 1, name: 'Designated', clubGames: GAMES, games: 36, inningsByPosition: { '1B': 30 }, recent: recentOf(log, 1) });
    const first = usage({ playerId: 9, name: 'First Baseman', clubGames: GAMES, games: 34, inningsByPosition: { '1B': 330 }, tier: 'normal', recent: recentOf(log, 9) });
    const work = ownWork(1, { kind: 'position', position: '1B' }, { claimants: [dh, first], clubInningsAtPosition: INNINGS, clubGames: GAMES, window: jobWindowOf(log, '1B') })!;
    expect(work.level).toBe('bat_only');
    expect(work.basis).toMatch(/was in the lineup for 14 of them: he is batting, not fielding/);
  });

  it('an outfielder moved from left to centre is competing for centre, whatever his season innings say', () => {
    const log = clubLog(GAMES);
    startsAt(log, 1, 'LF', span(0, 28));
    startsAt(log, 1, 'CF', span(28, 40));
    expect(recentPrimaryPosition(recentOf(log, 1))).toBe('CF');
  });

  it('a man who returned from an injury four games ago is thin, not unused', () => {
    const log = clubLog(GAMES);
    startsAt(log, 1, 'SS', [...span(0, 24), 37, 39]);
    startsAt(log, 9, 'SS', span(24, 40).filter((g) => ![37, 39].includes(g)));
    const back = usage({ playerId: 1, name: 'Back', clubGames: GAMES, games: 26, inningsByPosition: { SS: 220 }, recent: recentOf(log, 1, { absences: [{ from: dayOf(log, 24), to: dayOf(log, 36) }] }) });
    const cover = usage({ playerId: 9, name: 'Cover', clubGames: GAMES, games: 14, inningsByPosition: { SS: 130 }, tier: 'normal', recent: recentOf(log, 9) });
    const third = usage({ playerId: 3, name: 'Third', clubGames: GAMES, tier: 'organizational_depth', recent: recentOf(log, 3) });
    const conflict = must(positionConflict(10, 'SS', [back, cover, third], INNINGS, [], jobWindowOf(log, 'SS')));
    const me = conflict.claimants.find((s) => s.playerId === 1)!;
    expect(me).toMatchObject({ level: 'unknown' });
    expect(me.recent).toMatchObject({ work: 2, games: 4, evidence: 'thin' });
    expect(conflict.squeezed).toEqual([]);
    expect(conflict.unknowns.join(' ')).toMatch(/Back: he missed 11 games of the window to an injury/);
  });
});

describe('pitchers: turns, not totals', () => {
  const rotation = (mine: number[], opts: { projected?: boolean | null; arrivedAt?: number } = {}) => {
    const log = clubLog(GAMES);
    const others = [2, 3, 4, 5, 6].map((id, slot) => {
      startsOnMound(log, id, everyFifth(slot, 40).filter((g) => !mine.includes(g)));
      return usage({ playerId: id, name: `Starter ${id}`, clubGames: GAMES, games: 8, starts: 8, inningsPitched: 44, tier: 'normal', recent: recentOf(log, id), projectedStarter: opts.projected === undefined ? null : id <= 5 });
    });
    startsOnMound(log, 1, mine);
    const me = usage({
      playerId: 1, name: 'Me', clubGames: GAMES, games: mine.length, starts: mine.length, inningsPitched: 5 * mine.length,
      recent: recentOf(log, 1, opts.arrivedAt === undefined ? {} : { arrivedOn: dayOf(log, opts.arrivedAt) }),
      projectedStarter: opts.projected ?? null,
    });
    const conflict = must(rotationConflict(10, [me, ...others], GAMES, jobWindowOf(log, 'rotation')));
    return { conflict, me: conflict.claimants.find((s) => s.playerId === 1)! };
  };

  it('two of his last three turns is a rotation member; one is a spot start; none is not starting', () => {
    expect(rotation([27, 32, 37]).me.level).toBe('regular');
    expect(rotation([32, 37]).me.level).toBe('regular');
    expect(rotation([37]).me.level).toBe('part_time');
    expect(rotation([]).me.level).toBe('not_used');
  });

  it('the recent rotation lines sit where three turns can reach them', () => {
    expect(2 / 3).toBeGreaterThanOrEqual(RECENT_ROTATION_SHARE.regular);
    expect(1 / 3).toBeGreaterThanOrEqual(RECENT_ROTATION_SHARE.partTime);
    expect(1 / 3).toBeLessThan(RECENT_ROTATION_SHARE.regular);
  });

  it('a starter who arrived four games ago and is in OOTP\'s next five holds a spot: current state, not usage', () => {
    const { me, conflict } = rotation([39], { projected: true, arrivedAt: 36 });
    expect(me).toMatchObject({ level: 'regular', levelFrom: 'current_state' });
    expect(me.recent?.evidence).toBe('thin');
    expect(me.basis).toMatch(/OOTP has him among the club's next five starters/);
    expect(conflict.squeezed.map((s) => s.playerId)).not.toContain(1);
  });

  it('without that exported fact the same four games establish nothing', () => {
    expect(rotation([39], { projected: null, arrivedAt: 36 }).me.level).toBe('unknown');
  });

  it('a man OOTP has starting next who has relieved all year is a role change under way, not a blocked starter', () => {
    const { me, conflict } = rotation([], { projected: true });
    expect(me).toMatchObject({ level: 'unknown', levelFrom: 'current_state' });
    expect(conflict.squeezed.map((s) => s.playerId)).not.toContain(1);
    expect(conflict.squeezedOverSeason.map((s) => s.playerId)).toContain(1);
    expect(conflict.timing).toBe('uncertain');
    expect(conflict.unknowns.join(' ')).toMatch(/A change of role appears to be under way/);
    expect(blockersOf(readOpportunity(1, [conflict]))).toEqual([]);
  });

  it('six men for five spots: the one not getting starts lately is the one named, not the one with the fewest season starts', () => {
    const { conflict, me } = rotation([2, 7, 12, 17, 22]); /* five starts through game 22, none since */
    expect(me.season.level).not.toBe('not_used');
    expect(me).toMatchObject({ level: 'not_used', levelFrom: 'recent', disagrees: true });
    expect(conflict.squeezed.map((s) => s.playerId)).toEqual([1]);
    expect(conflict.timing).toBe('emerging');
  });
});

describe('relief: an arm is measured over the games he could have pitched in', () => {
  const corps = (newcomerAppearances: number[]) => {
    const log = clubLog(GAMES);
    const arms = span(2, 12).map((id) => {
      relieves(log, id, span(25, 40).filter((g) => (g + id) % 3 === 0), 4);
      return usage({ playerId: id, name: `Arm ${id}`, clubGames: GAMES, games: 14, reliefAppearances: 14, inningsPitched: 18, tier: 'normal', recent: recentOf(log, id) });
    });
    relieves(log, 1, newcomerAppearances, 4);
    const me = usage({ playerId: 1, name: 'New Arm', clubGames: GAMES, games: newcomerAppearances.length, reliefAppearances: newcomerAppearances.length, inningsPitched: 1.3 * newcomerAppearances.length, recent: recentOf(log, 1, { arrivedOn: dayOf(log, 36) }) });
    return must(reliefConflict(10, [me, ...arms], GAMES));
  };

  it('an arm four games into a new club is not "occasional" on a season share of almost nothing', () => {
    const conflict = corps([37, 39]);
    const me = conflict.claimants.find((s) => s.playerId === 1)!;
    expect(me.season.level).toBe('occasional');
    expect(me.level).toBe('unknown');
    expect(conflict.squeezed.map((s) => s.playerId)).not.toContain(1);
  });
});

describe('relief: the window confirms or clears, and never raises a shortage alone', () => {
  /* Eleven arms. Ten pitch steadily; the eleventh is varied between the season and the last fifteen games. */
  const arm = (seasonInnings: number, recentAppearances: number[]) => {
    const log = clubLog(GAMES);
    const others = span(2, 12).map((id) => {
      relieves(log, id, span(25, 40).filter((g) => (g + id) % 3 === 0), 4);
      return usage({ playerId: id, name: `Arm ${id}`, clubGames: GAMES, games: 14, reliefAppearances: 14, inningsPitched: 18, tier: 'normal', recent: recentOf(log, id) });
    });
    relieves(log, 1, recentAppearances, 4);
    const me = usage({ playerId: 1, name: 'The Arm', clubGames: GAMES, games: 12, reliefAppearances: 12, inningsPitched: seasonInnings, recent: recentOf(log, 1) });
    const conflict = must(reliefConflict(10, [me, ...others], GAMES));
    return { conflict, me: conflict.claimants.find((s) => s.playerId === 1)! };
  };

  it('a busy season and one quiet fortnight is not a shortage: relief work is too lumpy for that', () => {
    const { me, conflict } = arm(18, [38]);
    expect(me.recent?.level).toBe('occasional');
    expect(me).toMatchObject({ level: 'regular', levelFrom: 'season', disagrees: true });
    expect(conflict.squeezed.map((s) => s.playerId)).not.toContain(1);
  });

  it('a quiet season and a busy fortnight is cleared: the shortage the season shows does not exist now', () => {
    const { me, conflict } = arm(3, [26, 29, 32, 35, 38]);
    expect(me.season.level).toBe('occasional');
    expect(me).toMatchObject({ level: 'regular', levelFrom: 'recent' });
    expect(conflict.squeezed.map((s) => s.playerId)).not.toContain(1);
    expect(conflict.squeezedOverSeason.map((s) => s.playerId)).toContain(1);
  });

  it('short over the season AND short lately is a shortage: both reads say so', () => {
    const { me, conflict } = arm(3, [38]);
    expect(me.level).toBe('occasional');
    expect(conflict.squeezed.map((s) => s.playerId)).toContain(1);
    expect(conflict.timing).toBe('current');
  });
});

describe('retention does not misuse low recent usage', () => {
  const base = {
    playerId: 1, name: 'Depth Arm', age: 27, teamId: 10, team: 'A Club', level: 3, levelName: 'AA',
    protection: tierOf('organizational_depth'),
    current: evaluateCurrentAssignment(currentInput({ ageRelativeToLevel: -4, tier: 'organizational_depth' })),
    assignmentConclusion: 'organizational_question' as const,
    proServiceYears: 6,
    state: { onFortyMan: false, majorLeagueContract: false, mustBeActive: null, onInjuredList: false },
    clubCrowded: false,
    philosophy: { prospectPreservation: 50, rosterDepth: 50 },
    facts: [],
  };

  it('takes no usage input at all: not playing lately cannot, by itself, raise a release question', () => {
    const review = reviewRetention({ ...base, waiting: [] });
    expect(Object.keys(base)).not.toEqual(expect.arrayContaining(['recent', 'usage', 'opportunity']));
    expect(review.conclusion).not.toBe('review');
  });

  it('pressure comes only from a man with stakes who is CURRENTLY short of the work he holds', () => {
    const wanted = reviewRetention({ ...base, waiting: [{ playerId: 2, name: 'Prospect', age: 21, what: 'developmental work at the rotation' }] });
    expect(wanted.conclusion).toBe('review');
    /* …and a newly arrived prospect is never in `waiting`: his level is unknown, so he is not squeezed. */
  });
});

describe('MLB Operations receives the farm\'s own answer', () => {
  it('carries the current-opportunity read through the adapter untouched', async () => {
    const farm = (await request(`/api/farm-operations/${IDS.mlbTeam}`)) as { assignments: Array<{ playerId: number }> };
    const him = farm.assignments[0];
    if (!him) return; /* a fixture with no minor leaguers has nothing to answer */
    const session = openFarmSession(IDS.mlbTeam);
    const direct = farmConsequenceFor(IDS.mlbTeam, him.playerId, session);
    expect(direct).toHaveProperty('currentOpportunity');
    const affiliate = direct.sourceAffiliate;
    if (!affiliate) return;
    const viaMlb = farmConsequence(IDS.mlbTeam, him.playerId, null, 'leaves', affiliate.teamId, session)!;
    expect(viaMlb.farm).toEqual(direct);
  });

  it('describes a season-only read as season-only, so MLB never mistakes it for a current one', () => {
    const a = usage({ playerId: 1, name: 'A', clubGames: 100, inningsByPosition: { SS: 700 } });
    const work = ownWork(1, { kind: 'position', position: 'SS' }, { claimants: [a], clubInningsAtPosition: 800, clubGames: 100 })!;
    expect(currentOpportunityOf(work, null)).toMatchObject({ evidence: 'season_only', basis: 'season', recentArrival: false });
  });

  it('describes a man four games into a club as a recent arrival whose role is not established', () => {
    const log = clubLog(GAMES);
    startsAt(log, 1, 'CF', [36, 37, 39]);
    const me = usage({ playerId: 1, name: 'New', clubGames: GAMES, games: 4, inningsByPosition: { CF: 27 }, recent: recentOf(log, 1, { arrivedOn: dayOf(log, 36), from: 'Lower Club' }) });
    const work = ownWork(1, { kind: 'position', position: 'CF' }, { claimants: [me], clubInningsAtPosition: INNINGS, clubGames: GAMES, window: jobWindowOf(log, 'CF') })!;
    const opportunity = currentOpportunityOf(work, null)!;
    expect(opportunity).toMatchObject({ level: 'unknown', evidence: 'thin', recentArrival: true });
    expect(opportunity.detail).toMatch(/He joined the club 4 games ago.*from Lower Club.*Started 3 of the 4 games since he joined the club at CF/);
  });
});
