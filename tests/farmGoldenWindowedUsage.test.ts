import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  blockersOf,
  ownWork,
  positionConflict,
  readOpportunity,
  reliefConflict,
  rotationConflict,
  type PlayingTimeConflict,
} from '../server/playingTime.js';
import { pitcherJob } from '../server/farmRecentUsage.js';
import { roleChangeOf } from '../server/farmOperations.js';
import { evaluateCurrentAssignment } from '../server/currentAssignment.js';
import { reviewAssignment } from '../server/farmAssignments.js';
import { poolFor } from '../server/farmCascade.js';
import {
  clubLog,
  currentInput,
  dayOf,
  everyFifth,
  jobWindowOf,
  production,
  recentOf,
  relieves,
  span,
  startsAt,
  startsOnMound,
  tierOf,
  usage,
  vacancy,
} from './farmGolden.js';

/**
 * Golden cases for windowed usage: season-to-date totals can describe a competition that no longer
 * exists (docs/MINOR_LEAGUE_OPERATIONS.md Part 8).
 *
 * The defect these pin was measured on a real import. A wave of promotions four games before the
 * export made every promoted prospect read as "cannot get the work" at his new club, and all seven of
 * the farm's pressing blocked-prospect findings were that artifact. Each case states one invariant,
 * in a forty-game season whose window is games 25 to 39. Nothing here names a real player.
 */

const SEASON_GAMES = 40;
const INNINGS = 360; /* a club's innings at one position over forty games */
const must = (c: PlayingTimeConflict | null): PlayingTimeConflict => {
  expect(c).not.toBeNull();
  return c as PlayingTimeConflict;
};

describe('1. a former regular promoted away no longer blocks', () => {
  /* A held shortstop through game 33 and was promoted; B, who had not played there, has started every game since. */
  const log = clubLog(SEASON_GAMES);
  startsAt(log, 100, 'SS', span(0, 34));
  startsAt(log, 2, 'SS', span(34, 40));
  const b = usage({ playerId: 2, name: 'B Prospect', clubGames: SEASON_GAMES, games: 8, inningsByPosition: { SS: 40 }, recent: recentOf(log, 2) });
  const c = usage({ playerId: 3, name: 'C Depth', clubGames: SEASON_GAMES, games: 6, inningsByPosition: { SS: 6 }, tier: 'organizational_depth', recent: recentOf(log, 3) });
  const departed = [{ playerId: 100, name: 'A Regular', seasonWork: 300, nowAt: 'Higher Club', lastSeen: 8 }];
  const conflict = must(positionConflict(10, 'SS', [b, c], INNINGS, [], jobWindowOf(log, 'SS', departed)));

  it('the season alone still reads B as short of work — that is the stale reading', () => {
    const stale = must(positionConflict(10, 'SS', [{ ...b, recent: null }, { ...c, recent: null }], INNINGS));
    expect(stale.squeezed.map((s) => s.name)).toContain('B Prospect');
    expect(stale.timing).toBe('season_only');
  });

  it('A is history: named with what he held, and competing for nothing', () => {
    expect(conflict.gone).toHaveLength(1);
    expect(conflict.gone[0]).toMatchObject({ name: 'A Regular', why: 'departed', nowAt: 'Higher Club', material: true, windowStarts: 9 });
    expect(conflict.gone[0].seasonShare).toBeCloseTo(300 / 360);
    expect(conflict.claimants.map((s) => s.playerId)).not.toContain(100);
  });

  it('B is read from the game after A\'s last start there, and is the regular', () => {
    expect(conflict.window?.since?.name).toBe('A Regular');
    const me = conflict.claimants.find((s) => s.playerId === 2)!;
    expect(me).toMatchObject({ level: 'regular', levelFrom: 'recent', disagrees: true });
    expect(me.recent).toMatchObject({ work: 6, games: 6, evidence: 'sufficient' });
    expect(me.season.level).not.toBe('regular');
  });

  it('nobody is squeezed now, and the conflict is reported as recently resolved rather than erased', () => {
    expect(conflict.squeezed).toEqual([]);
    expect(conflict.squeezedOverSeason.map((s) => s.name)).toContain('B Prospect');
    expect(conflict.timing).toBe('recently_resolved');
    expect(conflict.severity).toBe('noted');
  });

  it('A is not ahead of B and blocks nobody', () => {
    const read = readOpportunity(2, [conflict]);
    expect(read.ahead.map((a) => a.playerId)).not.toContain(100);
    expect(blockersOf(read)).toEqual([]);
    expect(read.verdict).toBe('regular_work');
  });
});

describe('2. a former starter promoted away no longer occupies a rotation spot', () => {
  const log = clubLog(SEASON_GAMES);
  const five = [1, 2, 3, 4, 5];
  five.forEach((id, slot) => startsOnMound(log, id, everyFifth(slot, 40)));
  /* A made every fifth start through game 35, then left; his spot was the fifth man's before that. */
  const departed = [{ playerId: 100, name: 'A Starter', seasonWork: 12, nowAt: 'Higher Club', lastSeen: 10 }];
  const members = five.map((id) =>
    usage({ playerId: id, name: `Starter ${id}`, clubGames: SEASON_GAMES, games: 8, starts: 8, inningsPitched: 44, tier: 'normal', recent: recentOf(log, id) })
  );

  it('his twelve starts crowd nothing: five men on the club for five spots is no conflict', () => {
    expect(rotationConflict(10, members, SEASON_GAMES, jobWindowOf(log, 'rotation', departed))).toBeNull();
  });

  it('a sixth man not starting is read against the men on the club, never against the man who left', () => {
    const sixth = usage({ playerId: 6, name: 'Sixth Prospect', clubGames: SEASON_GAMES, games: 4, starts: 0, reliefAppearances: 4, inningsPitched: 6, recent: recentOf(log, 6) });
    const conflict = must(rotationConflict(10, [...members, sixth], SEASON_GAMES, jobWindowOf(log, 'rotation', departed)));
    expect(conflict.claimants.map((s) => s.playerId)).not.toContain(100);
    expect(readOpportunity(6, [conflict]).ahead.map((a) => a.playerId)).not.toContain(100);
    expect(conflict.gone.find((g) => g.playerId === 100)?.why).toBe('departed');
  });
});

describe('3. a newly promoted player with a tiny destination sample is not labeled bench depth', () => {
  const log = clubLog(SEASON_GAMES);
  startsAt(log, 9, 'CF', span(0, 40).filter((g) => g < 36));
  startsAt(log, 1, 'CF', [36, 37, 39]);
  const incumbent = usage({ playerId: 9, name: 'Incumbent', clubGames: SEASON_GAMES, games: 36, inningsByPosition: { CF: 320 }, tier: 'normal', recent: recentOf(log, 9) });
  const newcomer = usage({
    playerId: 1,
    name: 'New Prospect',
    clubGames: SEASON_GAMES,
    games: 4,
    inningsByPosition: { CF: 27 },
    recent: recentOf(log, 1, { arrivedOn: dayOf(log, 36), from: 'Lower Club' }),
  });
  const conflict = must(positionConflict(10, 'CF', [incumbent, newcomer], INNINGS, [], jobWindowOf(log, 'CF')));
  const me = conflict.claimants.find((s) => s.playerId === 1)!;

  it('the season reads 27 of 360 innings as an occasional player', () => {
    expect(me.season.level).toBe('occasional');
  });

  it('his current level is unknown — not occasional, not unused, and not the regular', () => {
    expect(me.level).toBe('unknown');
    expect(me.tenure).toMatchObject({ status: 'recent_arrival', clubGamesSince: 4 });
    expect(me.recent).toMatchObject({ work: 3, games: 4, evidence: 'thin' });
    expect(me.basis).toMatch(/Started 3 of the 4 games since he joined the club/);
  });

  it('he is not squeezed, the incumbent is not his blocker, and his opportunity is indeterminate', () => {
    expect(conflict.squeezed).toEqual([]);
    const read = readOpportunity(1, [conflict]);
    expect(read.verdict).toBe('indeterminate');
    expect(blockersOf(read)).toEqual([]);
  });

  it('his review opens with when he arrived, and does not call him blocked', () => {
    const review = reviewAssignment({
      playerId: 1, name: 'New Prospect', age: 21, kind: 'hitter', teamId: 10, team: 'A Club', level: 2, levelName: 'AAA', leagueName: 'A League',
      protection: tierOf('development_priority'),
      production: production({ unassessable: 'sample_below_minimum', percentile: null }),
      current: evaluateCurrentAssignment(currentInput({ unassessable: 'Twelve plate appearances at this level.', leaguePercentile: null })),
      opportunity: readOpportunity(1, [conflict]),
      alternatives: [],
      blockedBy: [],
    });
    expect(review.conclusion).toBe('not_assessable');
    expect(review.attention).toBe('routine');
    expect(review.reasons[0]).toMatch(/He joined the club 4 games ago/);
    expect(review.reasons.join(' ')).not.toMatch(/occupies the developmental path/);
  });
});

describe('4. a recent arrival with insufficient evidence remains uncertain', () => {
  const build = (gamesSince: number) => {
    const log = clubLog(SEASON_GAMES);
    const joined = SEASON_GAMES - gamesSince;
    startsAt(log, 9, 'SS', span(0, 40).filter((g) => g % 5 !== 0));
    const newcomer = usage({ playerId: 1, name: 'New Prospect', clubGames: SEASON_GAMES, games: 0, inningsByPosition: {}, recent: recentOf(log, 1, { arrivedOn: dayOf(log, joined) }) });
    const incumbent = usage({ playerId: 9, name: 'Incumbent', clubGames: SEASON_GAMES, games: 32, inningsByPosition: { SS: 288 }, tier: 'normal', recent: recentOf(log, 9) });
    return must(positionConflict(10, 'SS', [incumbent, newcomer], INNINGS, [], jobWindowOf(log, 'SS')));
  };

  it('five games in, not playing at all, he is still not read as unused: the conflict is uncertain', () => {
    const conflict = build(5);
    expect(conflict.claimants.find((s) => s.playerId === 1)!.level).toBe('unknown');
    expect(conflict.timing).toBe('uncertain');
    expect(conflict.squeezed).toEqual([]);
    expect(conflict.unknowns.join(' ')).toMatch(/New Prospect: He joined the club 5 games ago.*too few to establish his role/);
  });

  it('six games in, the same usage is read, and he is not getting the work', () => {
    const conflict = build(6);
    expect(conflict.claimants.find((s) => s.playerId === 1)!.level).toBe('not_used');
    expect(conflict.squeezed.map((s) => s.name)).toEqual(['New Prospect']);
    expect(conflict.timing).toBe('current');
  });
});

describe('5. an injured former regular is historical usage, not available current cover', () => {
  const log = clubLog(SEASON_GAMES);
  startsAt(log, 4, 'SS', span(0, 35));
  startsAt(log, 5, 'SS', span(35, 40));
  const hurt = usage({ playerId: 4, name: 'Hurt Regular', clubGames: SEASON_GAMES, games: 35, inningsByPosition: { SS: 310 }, injured: true, recent: recentOf(log, 4) });
  const next = usage({ playerId: 5, name: 'Next Man', clubGames: SEASON_GAMES, games: 8, inningsByPosition: { SS: 45 }, recent: recentOf(log, 5) });
  const depth = usage({ playerId: 6, name: 'Depth', clubGames: SEASON_GAMES, games: 3, inningsByPosition: { SS: 5 }, tier: 'organizational_depth', recent: recentOf(log, 6) });
  const conflict = must(positionConflict(10, 'SS', [hurt, next, depth], INNINGS, [], jobWindowOf(log, 'SS')));

  it('he competes for nothing while he is out', () => {
    expect(conflict.claimants.map((s) => s.name)).not.toContain('Hurt Regular');
  });

  it('his usage stays visible, as history', () => {
    expect(conflict.gone[0]).toMatchObject({ name: 'Hurt Regular', why: 'injured', material: true, windowStarts: 10 });
    expect(conflict.gone[0].seasonShare).toBeCloseTo(310 / 360);
  });

  it('the job is read from his last start on, and five games of it are too few to name a new regular', () => {
    expect(conflict.window?.since?.why).toBe('injured');
    expect(conflict.claimants.find((s) => s.playerId === 5)).toMatchObject({ level: 'unknown' });
    expect(conflict.unknowns.join(' ')).toMatch(/Next Man: the job changed hands/);
  });
});

describe('6. a major-league rehab assignee remains non-ordinary farm depth (D-026)', () => {
  const log = clubLog(SEASON_GAMES);
  startsAt(log, 1, '1B', span(0, 32));
  startsAt(log, 50, '1B', span(32, 40));
  const prospect = usage({ playerId: 1, name: 'First Baseman', clubGames: SEASON_GAMES, games: 32, inningsByPosition: { '1B': 288 }, recent: recentOf(log, 1) });
  const rehabber = usage({ playerId: 50, name: 'Rehab Veteran', clubGames: SEASON_GAMES, games: 8, inningsByPosition: { '1B': 72 }, tier: 'normal', rehab: true, recent: recentOf(log, 50) });
  const other = usage({ playerId: 2, name: 'Other', clubGames: SEASON_GAMES, games: 2, inningsByPosition: { '1B': 0 }, tier: 'organizational_depth', recent: recentOf(log, 2) });
  const built = ownWork(1, { kind: 'position', position: '1B' }, { claimants: [prospect, rehabber, other], clubInningsAtPosition: INNINGS, clubGames: SEASON_GAMES, window: jobWindowOf(log, '1B') });

  it('his eight starts are set aside: the prospect is read over the seven games that were open to him', () => {
    expect(built?.recent).toMatchObject({ work: 7, games: 7, evidence: 'sufficient' });
    expect(built?.level).toBe('regular');
  });

  it('he is never a claimant, never ahead of anybody, and never material to the job', () => {
    const conflict = positionConflict(10, '1B', [prospect, rehabber, other], INNINGS, [], jobWindowOf(log, '1B'));
    const all = conflict ? [...conflict.claimants, ...conflict.alsoPlaying] : [];
    expect(all.map((s) => s.playerId)).not.toContain(50);
    const gone = ownWorkGone(prospect, rehabber, other, log);
    expect(gone.find((g) => g.playerId === 50)).toMatchObject({ why: 'rehab', material: false });
  });

  function ownWorkGone(...args: [typeof prospect, typeof rehabber, typeof other, typeof log]) {
    /* Force a conflict (a third claimant) so the `gone` list can be inspected. */
    const extra = usage({ playerId: 3, name: 'Third', clubGames: SEASON_GAMES, games: 1, inningsByPosition: { '1B': 0 }, tier: 'organizational_depth', recent: recentOf(args[3], 3) });
    return must(positionConflict(10, '1B', [args[0], args[1], args[2], extra], INNINGS, [], jobWindowOf(args[3], '1B'))).gone;
  }
});

describe('7 and 8. the season leader who stopped playing, and the man who took over', () => {
  /* X held centre through game 24; Z has started there nearly every day since; Y, the prospect, plays it twice a fortnight. */
  const log = clubLog(SEASON_GAMES);
  startsAt(log, 1, 'CF', [...span(0, 25), 30]);
  startsAt(log, 3, 'CF', span(25, 40).filter((g) => ![30, 33, 37].includes(g)));
  startsAt(log, 2, 'CF', [33, 37]);
  const x = usage({ playerId: 1, name: 'X Season Leader', clubGames: SEASON_GAMES, games: 30, inningsByPosition: { CF: 234 }, tier: 'normal', recent: recentOf(log, 1) });
  const y = usage({ playerId: 2, name: 'Y Prospect', clubGames: SEASON_GAMES, games: 6, inningsByPosition: { CF: 18 }, recent: recentOf(log, 2) });
  const z = usage({ playerId: 3, name: 'Z Newly Regular', clubGames: SEASON_GAMES, games: 14, inningsByPosition: { CF: 45 }, tier: 'normal', recent: recentOf(log, 3) });
  const conflict = must(positionConflict(10, 'CF', [x, y, z], INNINGS, [], jobWindowOf(log, 'CF')));
  const by = (id: number) => conflict.claimants.find((s) => s.playerId === id)!;

  it('7. sixty-five percent of the season\'s innings does not make a man today\'s regular', () => {
    expect(by(1).season).toMatchObject({ level: 'regular' });
    expect(by(1).season.share).toBeCloseTo(0.65);
    expect(by(1)).toMatchObject({ level: 'occasional', levelFrom: 'recent', disagrees: true });
    expect(by(1).recent).toMatchObject({ work: 1, games: 15 });
  });

  it('7. and he does not block the prospect: the man holding the job now does', () => {
    const read = readOpportunity(2, [conflict]);
    expect(blockersOf(read).map((b) => b.name)).toEqual(['Z Newly Regular']);
  });

  it('8. an eighth of the season\'s innings does not hide the man who has started twelve of the last fifteen', () => {
    expect(by(3).season.level).toBe('occasional');
    expect(by(3)).toMatchObject({ level: 'regular', levelFrom: 'recent', disagrees: true });
    expect(by(3).recent).toMatchObject({ work: 12, games: 15, evidence: 'sufficient' });
  });

  it('both reads are said when they disagree, and neither is silently chosen', () => {
    const read = readOpportunity(1, [conflict]);
    expect(read.reasons[0]).toMatch(/Started 1 of the club's last 15 games at CF/);
    expect(read.reasons.join(' ')).toMatch(/Over the season: 234 of the club's 360 innings at CF/);
  });
});

describe('9. a recent move from relief to starting is visible', () => {
  const log = clubLog(SEASON_GAMES);
  relieves(log, 1, [1, 4, 8, 11, 15, 18, 21, 24, 28]);
  startsOnMound(log, 1, [34, 39]);
  const recent = recentOf(log, 1);

  it('he is a rotation claimant on what he is doing now, and a regular one', () => {
    expect(pitcherJob({ assignedStarter: false, projectedStarter: null, seasonStarts: 2, recent })).toBe('the rotation');
    const me = usage({ playerId: 1, name: 'Converted Arm', clubGames: SEASON_GAMES, games: 11, starts: 2, reliefAppearances: 9, inningsPitched: 30, recent });
    const four = [2, 3, 4, 5].map((id, slot) => {
      const l = everyFifth(slot + 1, 40);
      startsOnMound(log, id, l);
      return usage({ playerId: id, name: `Starter ${id}`, clubGames: SEASON_GAMES, games: 8, starts: 8, inningsPitched: 44, tier: 'normal', recent: recentOf(log, id) });
    });
    const sixth = usage({ playerId: 6, name: 'Sixth', clubGames: SEASON_GAMES, games: 8, starts: 4, inningsPitched: 20, tier: 'normal', recent: recentOf(log, 6) });
    const conflict = must(rotationConflict(10, [me, ...four, sixth], SEASON_GAMES, jobWindowOf(log, 'rotation')));
    const mine = conflict.claimants.find((s) => s.playerId === 1)!;
    /* Two starts in forty games is an occasional starter over the season; two of his last three turns is a rotation member. */
    expect(mine.season.level).toBe('occasional');
    expect(mine).toMatchObject({ level: 'regular', levelFrom: 'recent', disagrees: true });
    expect(conflict.squeezed.map((s) => s.name)).not.toContain('Converted Arm');
  });

  it('the change is stated as a fact from the game log', () => {
    expect(roleChangeOf({ starts: 2, reliefAppearances: 9 }, recent, false)).toMatchObject({ to: 'starting' });
  });
});

describe('10. a recent move from starting to relief is visible', () => {
  const log = clubLog(SEASON_GAMES);
  startsOnMound(log, 1, [2, 7, 12, 17]);
  relieves(log, 1, [27, 30, 33, 36, 39]);
  const recent = recentOf(log, 1);

  it('he is competing for the bullpen now, so his April starts make him nobody\'s blocked starter', () => {
    expect(pitcherJob({ assignedStarter: false, projectedStarter: false, seasonStarts: 4, recent })).toBe('the bullpen');
  });

  it('the change is stated as a fact, and only when enough of the window can be counted', () => {
    expect(roleChangeOf({ starts: 4, reliefAppearances: 5 }, recent, false)).toMatchObject({ to: 'relief' });
    expect(roleChangeOf({ starts: 4, reliefAppearances: 5 }, recentOf(log, 1, { arrivedOn: dayOf(log, 37) }), false)).toBeNull();
    expect(roleChangeOf({ starts: 4, reliefAppearances: 5 }, null, false)).toBeNull();
  });

  it('OOTP\'s own starting assignment outranks it: a man it still has starting is not called converted', () => {
    expect(roleChangeOf({ starts: 4, reliefAppearances: 5 }, recent, true)).toBeNull();
  });
});

describe('11. an affiliate transfer resets the CURRENT competition without erasing the record', () => {
  /* He was the old club's third baseman for thirty-five games and joined the new club five games ago. */
  const oldClub = clubLog(SEASON_GAMES, 20);
  const newClub = clubLog(SEASON_GAMES, 10);
  startsAt(oldClub, 1, '3B', span(0, 35));
  startsAt(newClub, 1, '3B', span(35, 40));

  it('his new club reads five games, never the old club\'s thirty-five', () => {
    const recent = recentOf(newClub, 1, { arrivedOn: dayOf(newClub, 35) });
    expect(recent.startGames['3B']).toHaveLength(5);
    expect(recent.evidence).toBe('thin');
  });

  it('his old club still shows what he did there, as a man who has left', () => {
    const stay = usage({ playerId: 2, name: 'Stayed', clubGames: SEASON_GAMES, games: 5, inningsByPosition: { '3B': 40 }, recent: recentOf(oldClub, 2) });
    const also = usage({ playerId: 3, name: 'Also', clubGames: SEASON_GAMES, games: 2, inningsByPosition: { '3B': 5 }, tier: 'organizational_depth', recent: recentOf(oldClub, 3) });
    const conflict = must(positionConflict(20, '3B', [stay, also], INNINGS, [], jobWindowOf(oldClub, '3B', [{ playerId: 1, name: 'Transferred', seasonWork: 315, nowAt: 'New Club', lastSeen: 9 }])));
    expect(conflict.gone[0]).toMatchObject({ name: 'Transferred', why: 'departed', nowAt: 'New Club', windowStarts: 10 });
  });
});

describe('12. an unrelated move elsewhere does not change the reading of this job', () => {
  const log = clubLog(SEASON_GAMES);
  startsAt(log, 1, 'SS', span(25, 37));
  startsAt(log, 2, 'SS', span(37, 40));
  const a = usage({ playerId: 1, name: 'A', clubGames: SEASON_GAMES, games: 30, inningsByPosition: { SS: 270 }, tier: 'normal', recent: recentOf(log, 1) });
  const b = usage({ playerId: 2, name: 'B', clubGames: SEASON_GAMES, games: 5, inningsByPosition: { SS: 27 }, recent: recentOf(log, 2) });
  const c = usage({ playerId: 3, name: 'C', clubGames: SEASON_GAMES, games: 2, inningsByPosition: { SS: 3 }, tier: 'organizational_depth', recent: recentOf(log, 3) });

  it('a man who left the club from another position is not part of this job\'s window', () => {
    const before = positionConflict(10, 'SS', [a, b, c], INNINGS, [], jobWindowOf(log, 'SS'));
    /* A catcher was promoted away: he is in the club's departures and never started at shortstop. */
    startsAt(log, 99, 'C', span(25, 33));
    const after = positionConflict(10, 'SS', [a, b, c], INNINGS, [], jobWindowOf(log, 'SS', []));
    expect(after).toEqual(before);
  });
});

describe('13. Organizational Philosophy cannot alter usage evidence', () => {
  const SERVER = path.join(process.cwd(), 'server');
  it.each(['farmRecentUsage.ts', 'farmUsage.ts', 'playingTime.ts', 'clubArrival.ts'])('%s names no philosophy dimension and imports no philosophy', (file) => {
    const source = fs.readFileSync(path.join(SERVER, file), 'utf8');
    expect(source).not.toMatch(/from '\.\/(philosophy|settings)\.js'/);
    expect(source).not.toMatch(/prospectPreservation|promotionAggressiveness|competitiveWindow|upsidePreference|rosterDepth|dimensions\./);
  });

  it('the usage functions take no philosophy at all: there is nothing for it to move', () => {
    expect(positionConflict.length).toBeLessThanOrEqual(6);
    expect(rotationConflict.length).toBeLessThanOrEqual(4);
    expect(reliefConflict.length).toBe(3);
  });
});

describe('14. Player Development validity is unchanged by temporal usage alone', () => {
  it('whether the level is developing him takes no usage input, so no window can move it', () => {
    const verdict = evaluateCurrentAssignment(currentInput({ leaguePercentile: 90, reliability: 0.7 }));
    expect(Object.keys(currentInput())).not.toEqual(expect.arrayContaining(['recent', 'tenure', 'usage']));
    expect(verdict.verdict).toBe('no_longer_developmental');
  });

  it('the same player reviewed with and without a recent read gets the same Player Development answers', () => {
    const log = clubLog(SEASON_GAMES);
    startsAt(log, 1, 'SS', span(25, 40));
    const me = usage({ playerId: 1, name: 'Shortstop', clubGames: SEASON_GAMES, games: 38, inningsByPosition: { SS: 330 } });
    const other = usage({ playerId: 2, name: 'Other', clubGames: SEASON_GAMES, games: 4, inningsByPosition: { SS: 20 }, tier: 'organizational_depth' });
    const third = usage({ playerId: 3, name: 'Third', clubGames: SEASON_GAMES, games: 2, inningsByPosition: { SS: 10 }, tier: 'organizational_depth' });
    const review = (withWindow: boolean) => {
      const cast = [me, other, third].map((u) => ({ ...u, recent: withWindow ? recentOf(log, u.playerId) : null }));
      const conflict = must(positionConflict(10, 'SS', cast, INNINGS, [], withWindow ? jobWindowOf(log, 'SS') : null));
      return reviewAssignment({
        playerId: 1, name: 'Shortstop', age: 21, kind: 'hitter', teamId: 10, team: 'A Club', level: 3, levelName: 'AA', leagueName: 'A League',
        protection: tierOf('development_priority'), production: production(), current: evaluateCurrentAssignment(currentInput()),
        opportunity: readOpportunity(1, [conflict]), alternatives: [], blockedBy: [],
      });
    };
    const [seasonOnly, windowed] = [review(false), review(true)];
    expect(windowed.current).toEqual(seasonOnly.current);
    expect(windowed.alternatives).toEqual(seasonOnly.alternatives);
    expect(windowed.protection).toEqual(seasonOnly.protection);
    expect(windowed.conclusion).toBe(seasonOnly.conclusion);
  });

  it('no Player Development module reads the recent window', () => {
    for (const file of ['currentAssignment.ts', 'prospectDecision.ts', 'prospectAssignments.ts', 'destinationFit.ts', 'developmentFit.ts', 'assignmentPreference.ts']) {
      expect(fs.readFileSync(path.join(process.cwd(), 'server', file), 'utf8'), file).not.toMatch(/farmRecentUsage|clubArrival|RecentUsage/);
    }
  });
});

describe('15. a cascade uses current opportunity, not a departed man\'s or a converted man\'s stale usage', () => {
  const log = clubLog(SEASON_GAMES);
  startsOnMound(log, 7, [3, 8, 13]);
  relieves(log, 7, [26, 29, 32, 35, 38]);
  const converted = pitcherJob({ assignedStarter: false, projectedStarter: false, seasonStarts: 3, recent: recentOf(log, 7) });

  it('a man with April starts who has relieved since is not rotation cover when a starter leaves', () => {
    expect(converted).toBe('the bullpen');
    const pool = poolFor(
      vacancy({ job: { kind: 'rotation' }, level: 2 }),
      [
        { playerId: 7, kind: 'pitcher' as const, primaryJob: converted, coverage: [], level: 3, rehab: false, injured: false },
        { playerId: 8, kind: 'pitcher' as const, primaryJob: 'the rotation', coverage: [], level: 3, rehab: false, injured: false },
      ],
      3
    );
    expect(pool.map((p) => p.playerId)).toEqual([8]);
  });

  it('on the season alone the same man WOULD have been offered as a starter: the stale reading this replaces', () => {
    expect(pitcherJob({ assignedStarter: false, projectedStarter: null, seasonStarts: 3, recent: null })).toBe('the rotation');
  });
});
