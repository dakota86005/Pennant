import { describe, expect, it } from 'vitest';
import {
  jobRead,
  positionConflict,
  readOpportunity,
  reliefConflict,
  rotationConflict,
  shortOfWork,
  shortOfWorkVerdict,
  verdictOf,
  type FarmJob,
  type UsageFacts,
  type WorkLevel,
} from '../server/playingTime.js';
import { reviewAssignment } from '../server/farmAssignments.js';
import { buildAffiliateView, resetFarmFindingIds, type AffiliateRosterHealth } from '../server/farmAffiliate.js';
import { evaluateCurrentAssignment } from '../server/currentAssignment.js';
import { RECENT_MINIMUM_GAMES } from '../server/farmCalibration.js';
import { clubLog, currentInput, dayOf, jobWindowOf, production, recentOf, span, startsAt, tierOf, usage } from './farmGolden.js';

/**
 * Sharing a job, and being short of it, are two different facts — and the club and the man must
 * read them from ONE line.
 *
 * The position conflict once counted a part-time man and a designated hitter as "squeezed" while the
 * rotation and the bullpen did not, so an affiliate raised a critical "not getting developmental
 * work" for a prospect whose own review, on the same evidence, said sharing the job is ordinary
 * (docs/MINOR_LEAGUE_OPERATIONS.md §9). Each case here pairs the club's reading with the man's.
 */

const LEVELS: WorkLevel[] = ['regular', 'part_time', 'occasional', 'not_used', 'bat_only', 'unknown'];

const at = (position: string, name: string, innings: number, tier: Parameters<typeof tierOf>[0] = 'development_priority', id = name.length * 11 + innings): UsageFacts =>
  usage({ playerId: id, name, inningsByPosition: { [position]: innings }, games: Math.min(100, Math.ceil(innings / 9)), tier });

/** The man's own review, from the club's read of his job (contested or not, as the service reads it). */
function reviewOf(job: FarmJob, claimants: UsageFacts[], me: UsageFacts, opts: { clubInnings?: number; window?: ReturnType<typeof jobWindowOf>; clubGames?: number } = {}) {
  const read = jobRead(job, { claimants, clubInningsAtPosition: opts.clubInnings ?? 900, clubGames: opts.clubGames ?? 100, window: opts.window }, 10)!;
  const opportunity = readOpportunity(me.playerId, [read]);
  const review = reviewAssignment({
    playerId: me.playerId, name: me.name, age: me.age, kind: job.kind === 'position' ? 'hitter' : 'pitcher', teamId: 10, team: 'A Club', level: 3, levelName: 'AA', leagueName: 'A League',
    protection: tierOf(me.tier), production: production(),
    current: evaluateCurrentAssignment(currentInput({ tier: me.tier })),
    opportunity, alternatives: [], blockedBy: [],
  });
  return { read, opportunity, review };
}

/** The affiliate's developmental findings for one club's conflicts. */
const affiliateFindings = (conflicts: NonNullable<ReturnType<typeof positionConflict>>[]) => {
  resetFarmFindingIds();
  const coverage = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'].map((position) => ({
    position, playable: 2, strong: 0,
    players: [0, 1].map((i) => ({ playerId: 1000 + i, name: `Cover ${i}`, listedPosition: position, rating: 50, primary: i === 0 })),
  }));
  const health: AffiliateRosterHealth = {
    teamId: 10, label: 'A Club', level: 3, levelName: 'AA',
    roster: { total: 26, positionPlayers: 13, pitchers: 13, dayToDay: 0 },
    positionPlayers: { fieldablePositions: 8, canFieldDefense: true, coverage },
    pitching: { starters: 5, relievers: 8 },
    rosterTreatment: { rehab: [], ambiguous: [], injured: [] },
  } as AffiliateRosterHealth;
  return buildAffiliateView({ health, leagueId: 300, leagueName: 'A League', games: 100, conflicts, listedOnly: {}, rotationClaimants: 5, roleConversions: [], assignments: [] }).developmental.findings;
};

describe('one line between sharing a job and being short of it', () => {
  it('is drawn once, and the review\'s verdict for every level of work agrees with it', () => {
    for (const level of LEVELS) expect(shortOfWorkVerdict(verdictOf(level))).toBe(shortOfWork(level));
    expect(LEVELS.filter(shortOfWork)).toEqual(['occasional', 'not_used']);
  });

  it('is the same line for a position, a rotation and a bullpen: a man sharing any of them is not squeezed', () => {
    const position = positionConflict(10, 'SS', [at('SS', 'Regular', 500), at('SS', 'Sharing', 250), at('SS', 'Third', 150)], 900)!;
    expect(position.squeezed.map((s) => s.name)).toEqual([]);

    const arm = (name: string, starts: number, id: number) => usage({ playerId: id, name, starts, inningsPitched: starts * 5, games: starts, clubGames: 100 });
    const rotation = rotationConflict(10, [arm('A', 20, 1), arm('B', 20, 2), arm('C', 20, 3), arm('D', 20, 4), arm('E', 12, 5), arm('Spot', 8, 6)], 100)!;
    expect(rotation.claimants.find((s) => s.name === 'Spot')!.level).toBe('part_time');
    expect(rotation.squeezed.map((s) => s.name)).toEqual([]);

    const reliever = (name: string, ip: number, id: number) => usage({ playerId: id, name, reliefAppearances: Math.round(ip / 1.2), inningsPitched: ip, games: Math.round(ip / 1.2), clubGames: 100 });
    const pen = reliefConflict(10, [1, 2, 3, 4, 5, 6, 7, 8].map((i) => reliever(`R${i}`, 40, i)).concat([reliever('Short', 4, 9), reliever('Sharing', 18, 10)]), 100)!;
    expect(pen.claimants.find((s) => s.name === 'Sharing')!.level).toBe('part_time');
    expect(pen.squeezed.map((s) => s.name)).toEqual(['Short']);
  });
});

describe('golden: sharing and being short of a job, the club and the man together', () => {
  /* 1. An ordinary, healthy job share. */
  it('1. two prospects splitting a position: no club finding, and each review says sharing is ordinary', () => {
    const a = at('SS', 'Prospect A', 480);
    const b = at('SS', 'Prospect B', 400);
    expect(positionConflict(10, 'SS', [a, b], 900)).toBeNull();
    const { review } = reviewOf({ kind: 'position', position: 'SS' }, [a, b], b);
    expect(review.opportunity.verdict).toBe('regular_work');
    expect(review.conclusion).toBe('current_assignment_defensible');
    expect(review.attention).toBe('routine');
  });

  /* 2. A high-stakes man genuinely squeezed. */
  it('2. a protected prospect with a handful of innings behind a regular is squeezed: critical at the club, needs attention for him', () => {
    const me = at('SS', 'Protected', 20, 'protected_prospect');
    const c = positionConflict(10, 'SS', [at('SS', 'Regular', 800, 'normal'), me, at('SS', 'Third', 60, 'normal')], 900)!;
    expect(c.squeezed.map((s) => s.name)).toEqual(['Protected']);
    expect(c.severity).toBe('blocking');
    expect(affiliateFindings([c])[0]).toMatchObject({ severity: 'critical' });
    expect(affiliateFindings([c])[0].headline).toMatch(/Protected \(22\) is not getting developmental work at SS/);
    const { review } = reviewOf({ kind: 'position', position: 'SS' }, c.claimants.map((s) => [me, at('SS', 'Regular', 800, 'normal'), at('SS', 'Third', 60, 'normal')].find((u) => u.playerId === s.playerId)!), me);
    expect(review.conclusion).toBe('opportunity_conflict');
    expect(review.attention).toBe('needs_attention');
  });

  /* 3. Part-time work that is developmentally adequate. */
  it('3. a development-priority man with a third of the job is sharing it: no shortage at the club, ordinary in his review', () => {
    const me = at('RF', 'Part-timer', 300);
    const claimants = [at('RF', 'Regular', 540, 'normal'), me];
    expect(positionConflict(10, 'RF', claimants, 900)).toBeNull();
    const { read, review } = reviewOf({ kind: 'position', position: 'RF' }, claimants, me);
    expect(read.claimants.find((s) => s.playerId === me.playerId)!.level).toBe('part_time');
    expect(read.squeezed).toEqual([]);
    expect(review.opportunity.verdict).toBe('shared_work');
    expect(review.reasons.join(' ')).toMatch(/sharing the job, which is ordinary/);
    expect(review.attention).toBe('routine');
  });

  /* 4. Part-time usage that is genuinely inadequate. */
  it('4. the same man at a tenth of the job is short of it: squeezed at the club, an opportunity conflict for him', () => {
    const me = at('RF', 'Squeezed', 90);
    const claimants = [at('RF', 'Regular', 700, 'normal'), me, at('RF', 'Third', 110, 'normal')];
    const c = positionConflict(10, 'RF', claimants, 900)!;
    expect(c.squeezed.map((s) => s.name)).toEqual(['Squeezed']);
    expect(c.severity).toBe('blocking');
    const { review } = reviewOf({ kind: 'position', position: 'RF' }, claimants, me);
    expect(review.opportunity.verdict).toBe('insufficient_work');
    expect(review.conclusion).toBe('opportunity_conflict');
    expect(review.attention).toBe('needs_attention');
  });

  /* 5. Unclear recent usage. */
  it('5. a recent read too thin to establish his role leaves both the club and the man unsure, never squeezed', () => {
    const log = clubLog(40);
    startsAt(log, 9, 'SS', span(0, 40));
    const since = RECENT_MINIMUM_GAMES - 1;
    const me = usage({ playerId: 1, name: 'Unclear', clubGames: 40, games: 0, inningsByPosition: { SS: 0 }, recent: recentOf(log, 1, { arrivedOn: dayOf(log, 40 - since) }) });
    const him = usage({ playerId: 9, name: 'Holder', clubGames: 40, games: 40, inningsByPosition: { SS: 360 }, tier: 'normal', recent: recentOf(log, 9) });
    const third = usage({ playerId: 3, name: 'Third', clubGames: 40, games: 4, inningsByPosition: { SS: 0 }, tier: 'organizational_depth', recent: recentOf(log, 3) });
    const c = positionConflict(10, 'SS', [me, him, third], 360, [], jobWindowOf(log, 'SS'))!;
    expect(c.claimants.find((s) => s.playerId === 1)!.level).toBe('unknown');
    expect(c.squeezed).toEqual([]);
    const { review } = reviewOf({ kind: 'position', position: 'SS' }, [me, him, third], me, { clubInnings: 360, window: jobWindowOf(log, 'SS'), clubGames: 40 });
    expect(review.opportunity.verdict).toBe('indeterminate');
    expect(review.conclusion).not.toBe('opportunity_conflict');
  });

  /* 6. A recent arrival with a thin window. */
  it('6. a man four games into the club is neither short of the job nor sharing it: his review says he is new, not blocked', () => {
    const log = clubLog(40);
    startsAt(log, 9, 'SS', span(0, 36));
    startsAt(log, 1, 'SS', span(36, 40));
    const me = usage({ playerId: 1, name: 'Arrived', clubGames: 40, games: 4, inningsByPosition: { SS: 36 }, recent: recentOf(log, 1, { arrivedOn: dayOf(log, 36) }) });
    const him = usage({ playerId: 9, name: 'Holder', clubGames: 40, games: 36, inningsByPosition: { SS: 324 }, tier: 'normal', recent: recentOf(log, 9) });
    const { read, review } = reviewOf({ kind: 'position', position: 'SS' }, [me, him], me, { clubInnings: 360, window: jobWindowOf(log, 'SS'), clubGames: 40 });
    expect(read.squeezed).toEqual([]);
    expect(review.opportunity.verdict).toBe('indeterminate');
    expect(review.reasons[0]).toMatch(/joined the club/);
    expect(review.attention).not.toBe('needs_attention');
  });

  /* 7. A legitimate positional rotation. */
  it('7. three men rotating through two outfield spots and the DH each hold a part of the job: nobody is short of it', () => {
    const a = at('CF', 'Rotates A', 330);
    const b = at('CF', 'Rotates B', 300);
    const c3 = at('CF', 'Rotates C', 270);
    const c = positionConflict(10, 'CF', [a, b, c3], 900)!;
    expect(c.claimants.map((s) => s.level)).toEqual(['part_time', 'part_time', 'part_time']);
    expect(c.squeezed).toEqual([]);
    expect(c.severity).toBe('noted');
    expect(affiliateFindings([c])[0].severity).toBe('noted');
    expect(affiliateFindings([c])[0].headline).toMatch(/3 men have a claim on CF, which supports 2/);
    expect(reviewOf({ kind: 'position', position: 'CF' }, [a, b, c3], c3).review.attention).toBe('routine');
  });

  /* 8. A DH / field split. */
  it('8. a prospect batting every day and rarely fielding is a question for HIM (worth a look), not a shortage the club reports', () => {
    const me = usage({ playerId: 501, name: 'The DH', inningsByPosition: { '1B': 9 }, games: 85, clubGames: 100, tier: 'development_priority' });
    const regular = at('1B', 'Regular', 780, 'normal');
    expect(positionConflict(10, '1B', [regular, me], 900)).toBeNull();
    const { read, review } = reviewOf({ kind: 'position', position: '1B' }, [regular, me], me);
    expect(read.claimants.find((s) => s.playerId === 501)!.level).toBe('bat_only');
    expect(read.squeezed).toEqual([]);
    expect(review.conclusion).toBe('opportunity_conflict');
    expect(review.attention).toBe('worth_a_look');
    expect(review.reasons.join(' ')).toMatch(/his bat is getting its work and his glove is not/);
  });

  /* 9. A catcher workload split. */
  it('9. two catchers splitting the job are what a catching job supports; a third who is not catching is the one short', () => {
    const a = at('C', 'Catcher A', 500);
    const b = at('C', 'Catcher B', 380);
    expect(positionConflict(10, 'C', [a, b], 900)).toBeNull();
    expect(reviewOf({ kind: 'position', position: 'C' }, [a, b], b).review.attention).toBe('routine');
    const third = at('C', 'Catcher C', 20);
    const c = positionConflict(10, 'C', [a, b, third], 900)!;
    expect(c.squeezed.map((s) => s.name)).toEqual(['Catcher C']);
    expect(reviewOf({ kind: 'position', position: 'C' }, [a, b, third], third).review.conclusion).toBe('opportunity_conflict');
  });

  /* 10. Pitchers sharing a role. */
  it('10. a spot starter shares the rotation and is not squeezed; a starter getting no starts is', () => {
    const arm = (name: string, starts: number, id: number, tier: Parameters<typeof tierOf>[0] = 'development_priority') =>
      usage({ playerId: id, name, starts, inningsPitched: starts * 5, games: starts, clubGames: 100, tier });
    const rotation = rotationConflict(10, [arm('A', 20, 1, 'normal'), arm('B', 20, 2, 'normal'), arm('C', 20, 3, 'normal'), arm('D', 20, 4, 'normal'), arm('E', 12, 5, 'normal'), arm('Spot', 8, 6)], 100)!;
    expect(rotation.claimants.find((s) => s.name === 'Spot')!.level).toBe('part_time');
    expect(rotation.squeezed).toEqual([]);
    expect(readOpportunity(6, [rotation]).verdict).toBe('shared_work');

    const idle = rotationConflict(10, [arm('A', 20, 1, 'normal'), arm('B', 20, 2, 'normal'), arm('C', 20, 3, 'normal'), arm('D', 20, 4, 'normal'), arm('E', 18, 5, 'normal'), arm('Idle', 2, 6)], 100)!;
    expect(idle.squeezed.map((s) => s.name)).toEqual(['Idle']);
    expect(readOpportunity(6, [idle]).verdict).toBe('insufficient_work');
  });
});
