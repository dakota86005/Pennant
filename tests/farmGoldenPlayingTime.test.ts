import { describe, expect, it } from 'vitest';
import {
  blockersOf,
  positionConflict,
  readOpportunity,
  reliefConflict,
  rotationConflict,
} from '../server/playingTime.js';
import { reviewAssignment } from '../server/farmAssignments.js';
import { usage, tierOf, production, currentInput, alternative } from './farmGolden.js';
import { evaluateCurrentAssignment } from '../server/currentAssignment.js';

/**
 * Playing time: who is getting the work, who is not, and when that matters.
 *
 * The farm v1 model had no vocabulary for any of this, so every case here is new behaviour rather
 * than a regression guard. Each states one baseball invariant.
 */

/* A hitter whose games follow his innings: five innings is one game, not ninety (that would make him a designated hitter). */
const hitter = (name: string, innings: number, tier: Parameters<typeof tierOf>[0] = 'development_priority') =>
  usage({ playerId: name.length * 7 + innings, name, inningsByPosition: { SS: innings }, games: Math.min(100, Math.ceil(innings / 9)), tier });

describe('two men and one position', () => {
  it('is a conflict when three claim a job that supports two', () => {
    const c = positionConflict(
      10,
      'SS',
      [hitter('Regular', 700), hitter('Sharing', 200), hitter('Benched', 5)],
      900
    );
    expect(c).not.toBeNull();
    expect(c!.claimants).toHaveLength(3);
    expect(c!.capacity).toBe(2);
  });

  it('is not a conflict when two men share a job that supports two and both are playing', () => {
    expect(positionConflict(10, 'SS', [hitter('One', 500), hitter('Two', 400)], 900)).toBeNull();
  });

  it('names who is being squeezed and who is ahead of him', () => {
    const c = positionConflict(10, 'SS', [hitter('Ahead', 800), hitter('Behind', 10), hitter('Third', 50)], 900)!;
    expect(c.squeezed.map((s) => s.name)).toContain('Behind');
    expect(c.claimants[0].name).toBe('Ahead');
    const read = readOpportunity(c.claimants.find((s) => s.name === 'Behind')!.playerId, [c]);
    expect(read.ahead.map((a) => a.name)).toContain('Ahead');
  });

  it('is not a conflict at all for one man who simply is not playing: that is a fact about him', () => {
    expect(positionConflict(10, 'SS', [hitter('Alone', 0)], 900)).toBeNull();
  });

  it('costs nobody development when the men who are squeezed are organizational depth', () => {
    const c = positionConflict(
      10,
      'SS',
      [
        hitter('Regular', 800, 'organizational_depth'),
        hitter('Depth', 20, 'organizational_depth'),
        hitter('More depth', 10, 'organizational_depth'),
      ],
      900
    )!;
    expect(c.squeezed).toEqual([]);
    expect(c.severity).not.toBe('blocking');
  });

  it('leaves unknown stakes unknown rather than reading them as low', () => {
    const c = positionConflict(10, 'SS', [hitter('Known', 800), hitter('Unknown', 5, null), hitter('Third', 50)], 900)!;
    expect(c.unknowns.join(' ')).toMatch(/indeterminate/);
    expect(c.squeezed.map((s) => s.name)).not.toContain('Unknown');
  });

  it('reads no share at all from a club that has barely played', () => {
    const early = [hitter('One', 0), hitter('Two', 0), hitter('Three', 0)].map((u) => ({ ...u, clubGames: 6 }));
    expect(positionConflict(10, 'SS', early, 0)).toBeNull();
  });

  it('never counts a rehab assignee as competing for a job', () => {
    const c = positionConflict(
      10,
      'SS',
      [hitter('Regular', 800), hitter('Squeezed', 5), { ...hitter('Rehabbing', 300), rehab: true }],
      900
    )!;
    expect(c.claimants.map((s) => s.name)).not.toContain('Rehabbing');
  });
});

describe('a rotation and a bullpen', () => {
  const arm = (name: string, starts: number, tier: Parameters<typeof tierOf>[0] = 'development_priority') =>
    usage({ playerId: name.length * 11 + starts, name, starts, inningsPitched: starts * 5, tier });

  it('is a conflict when six men are taking the starts a five-man rotation has', () => {
    const c = rotationConflict(
      10,
      [arm('A', 9), arm('B', 9), arm('C', 8), arm('D', 8), arm('E', 8), arm('F', 1)],
      45
    );
    expect(c).not.toBeNull();
    expect(c!.capacity).toBe(5);
    expect(c!.squeezed.map((s) => s.name)).toContain('F');
  });

  it('is not a conflict when five men take the starts a five-man rotation has', () => {
    expect(rotationConflict(10, [arm('A', 9), arm('B', 9), arm('C', 9), arm('D', 9), arm('E', 9)], 45)).toBeNull();
  });

  it('flags a prospect who needs starter innings and is getting none', () => {
    const c = rotationConflict(
      10,
      [arm('A', 9), arm('B', 9), arm('C', 9), arm('D', 9), arm('E', 9), arm('Sixth starter', 0)],
      45
    )!;
    expect(c.squeezed.map((s) => s.name)).toEqual(['Sixth starter']);
    expect(c.severity).toBe('blocking');
  });

  it('is a conflict when a bullpen carries more arms than it has innings for', () => {
    const arms = Array.from({ length: 14 }, (_, i) => arm(`R${i}`, 0));
    const c = reliefConflict(10, arms.map((a) => ({ ...a, inningsPitched: 20 })), 45);
    expect(c).not.toBeNull();
    expect(c!.claimants).toHaveLength(14);
  });

  it('reads no bullpen congestion off a season that has not been played', () => {
    const arms = Array.from({ length: 22 }, (_, i) => ({ ...arm(`R${i}`, 0), clubGames: 8 }));
    expect(reliefConflict(10, arms, 8)).toBeNull();
  });
});

describe('a player who cannot get the work', () => {
  const review = (opportunityInnings: number, tier: Parameters<typeof tierOf>[0], unassessable: boolean) => {
    const me = hitter('Him', opportunityInnings, tier);
    const conflict = positionConflict(10, 'SS', [hitter('Ahead', 800), me, hitter('Third', 60)], 900)!;
    return reviewAssignment({
      playerId: me.playerId,
      name: 'Him',
      age: 22,
      kind: 'hitter',
      teamId: 10,
      team: 'A Club',
      level: 2,
      levelName: 'AAA',
      leagueName: 'A League',
      protection: tierOf(tier),
      production: production(
        unassessable
          ? { percentile: null, unassessable: 'sample_below_minimum', sample: { opportunities: 12, clubGames: 100, reliability: 0, mature: false } }
          : {}
      ),
      current: evaluateCurrentAssignment(
        currentInput(
          unassessable
            ? { leaguePercentile: null, reliability: 0, unassessable: '12 is below the minimum sample.', tier }
            : { tier }
        )
      ),
      opportunity: readOpportunity(me.playerId, [conflict]),
      alternatives: [],
      blockedBy: [{ playerId: 99, name: 'Ahead', age: 25, where: 'A Club', why: 'and the level is still developing him' }],
    });
  };

  it('is the finding, even when his thin sample is the consequence of it', () => {
    // Twelve plate appearances because another man has the position is not "nothing to say about him"
    const r = review(5, 'development_priority', true);
    expect(r.conclusion).toBe('organizational_blockage');
    expect(r.attention).toBe('needs_attention');
    expect(r.reasons.join(' ')).toMatch(/occupies the developmental path/);
  });

  it('is not a finding about a man with no development to cost', () => {
    const r = review(5, 'organizational_depth', false);
    expect(r.conclusion).toBe('current_assignment_defensible');
    expect(r.attention).toBe('routine');
  });

  it('says nothing either way when his developmental stakes are indeterminate', () => {
    const r = review(5, null, false);
    expect(r.conclusion).toBe('current_assignment_defensible');
    expect(r.reasons.join(' ')).toMatch(/cannot be said/);
  });

  it('is an opportunity conflict rather than a blockage when nobody is named as ahead of him', () => {
    const me = hitter('Him', 5);
    const conflict = positionConflict(10, 'SS', [hitter('A', 400), hitter('B', 400), me], 900)!;
    const r = reviewAssignment({
      playerId: me.playerId,
      name: 'Him',
      age: 21,
      kind: 'hitter',
      teamId: 10,
      team: 'A Club',
      level: 3,
      levelName: 'AA',
      leagueName: 'A League',
      protection: tierOf('development_priority'),
      production: production(),
      current: evaluateCurrentAssignment(currentInput({ tier: 'development_priority' })),
      opportunity: readOpportunity(me.playerId, [conflict]),
      alternatives: [alternative({ judgment: 'indefensible', preference: null, blockers: ['Readiness is below the threshold.'] })],
      blockedBy: [],
    });
    expect(r.conclusion).toBe('opportunity_conflict');
    expect(r.wouldResolve.join(' ')).toMatch(/where SS is open|change in how this club uses him/);
  });
});

/* A hitter at a named position, games following his innings there. */
const at = (position: string, name: string, innings: number, tier: Parameters<typeof tierOf>[0] = 'development_priority') =>
  usage({ playerId: position.length * 101 + name.length * 7 + innings, name, inningsByPosition: { [position]: innings }, games: Math.min(100, Math.ceil(innings / 9)), tier });

describe('who is actually ahead of him', () => {
  /*
   * One man, one job: only the men whose primary job is a position are its claimants. But the innings
   * at that position are also being taken by men filed under other jobs — a corner outfielder covering
   * centre, a two-way pitcher who is in fact the regular first baseman — and leaving them out named a
   * part-time claimant as the man "occupying the path" when the reps were going elsewhere.
   */
  const cover = (name: string, innings: number) =>
    usage({ playerId: name.length * 13 + innings, name, inningsByPosition: { LF: 300, CF: innings }, games: 90, tier: 'normal' });

  it('names a cover holder among the men ahead of a prospect, without counting him against the job', () => {
    const c = positionConflict(10, 'CF', [at('CF', 'Part-timer', 80), at('CF', 'Prospect', 19)], 378, [cover('Corner man', 88)])!;
    expect(c.claimants).toHaveLength(2);
    expect(c.alsoPlaying.map((s) => s.name)).toEqual(['Corner man']);
    const read = readOpportunity(c.claimants.find((s) => s.name === 'Prospect')!.playerId, [c]);
    expect(read.ahead.map((a) => `${a.name}:${a.claimant}`)).toEqual(['Corner man:false', 'Part-timer:true']);
    expect(read.reasons.join(' ')).toMatch(/Corner man \(covering it from another position\)/);
  });

  it('reads a cover holder at the position by his innings there, never as a designated hitter', () => {
    const c = positionConflict(10, 'CF', [at('CF', 'Part-timer', 80), at('CF', 'Prospect', 19)], 378, [cover('Corner man', 20)])!;
    expect(c.alsoPlaying[0].level).toBe('occasional');
  });

  it('calls only a REGULAR a blocker: a part-time man ahead of a prospect is not occupying his path', () => {
    const c = positionConflict(10, 'CF', [at('CF', 'Part-timer', 80), at('CF', 'Prospect', 19)], 378, [cover('Corner man', 88)])!;
    const read = readOpportunity(c.claimants.find((s) => s.name === 'Prospect')!.playerId, [c]);
    expect(blockersOf(read)).toEqual([]);
    const held = positionConflict(10, 'SS', [hitter('Regular', 520), hitter('Prospect', 19)], 900)!;
    const readHeld = readOpportunity(held.claimants.find((s) => s.name === 'Prospect')!.playerId, [held]);
    expect(blockersOf(readHeld).map((b) => b.name)).toEqual(['Regular']);
  });

  it('counts a two-way pitcher who holds first base as the man ahead of the first-base prospect', () => {
    const twoWay = usage({ playerId: 777, name: 'Two-way', inningsByPosition: { '1B': 198 }, games: 40, tier: 'development_priority', starts: 5, inningsPitched: 25 });
    const c = positionConflict(10, '1B', [at('1B', 'Part-timer', 117), at('1B', 'Prospect', 16)], 331, [twoWay])!;
    const read = readOpportunity(c.claimants.find((s) => s.name === 'Prospect')!.playerId, [c]);
    expect(blockersOf(read).map((b) => b.name)).toEqual(['Two-way']);
  });

  it('says when much of the job was played by men no longer on the club, so a vacated job is not read as a crowded one', () => {
    /* 378 club innings at CF, of which the rostered men account for 107: the regular has been promoted. */
    const c = positionConflict(10, 'CF', [at('CF', 'Part-timer', 81), at('CF', 'Prospect', 19)], 378, [cover('Corner man', 7)])!;
    expect(c.unknowns.join(' ')).toMatch(/271 of the club's 378 innings at CF were played by men no longer on its roster/);
  });

  it('keeps the same capacity and the same squeezed list however many cover holders there are', () => {
    const base = positionConflict(10, 'SS', [hitter('Regular', 700), hitter('Prospect', 10), hitter('Third', 60)], 900)!;
    const withCover = positionConflict(10, 'SS', [hitter('Regular', 700), hitter('Prospect', 10), hitter('Third', 60)], 900, [cover('Utility', 60), cover('Other', 30)])!;
    expect(withCover.capacity).toBe(base.capacity);
    expect(withCover.claimants.map((s) => s.playerId)).toEqual(base.claimants.map((s) => s.playerId));
    expect(withCover.squeezed.map((s) => s.playerId)).toEqual(base.squeezed.map((s) => s.playerId));
  });
});

describe('a designated hitter', () => {
  const dh = (name: string, tier: Parameters<typeof tierOf>[0] = 'development_priority') =>
    usage({ playerId: 501, name, inningsByPosition: { '1B': 9 }, games: 85, clubGames: 100, tier });

  it('is read as playing but not fielding, which is neither regular work nor not playing', () => {
    const c = positionConflict(10, '1B', [at('1B', 'Regular', 780), dh('The DH')], 900)!;
    const me = c.claimants.find((s) => s.name === 'The DH')!;
    expect(me.level).toBe('bat_only');
    expect(me.basis).toMatch(/in the lineup for 85 of its 100 games: he is batting, not fielding/);
    expect(readOpportunity(me.playerId, [c]).verdict).toBe('bat_only');
  });

  it('is a quieter conflict for a prospect whose development includes the glove: worth a look, not pressing', () => {
    const me = dh('The DH');
    const c = positionConflict(10, '1B', [at('1B', 'Regular', 780), me], 900)!;
    const r = reviewAssignment({
      playerId: me.playerId, name: 'The DH', age: 21, kind: 'hitter', teamId: 10, team: 'A Club', level: 3, levelName: 'AA', leagueName: 'A League',
      protection: tierOf('development_priority'), production: production(),
      current: evaluateCurrentAssignment(currentInput({ tier: 'development_priority' })),
      opportunity: readOpportunity(me.playerId, [c]), alternatives: [], blockedBy: [],
    });
    expect(r.conclusion).toBe('opportunity_conflict');
    expect(r.attention).toBe('worth_a_look');
    expect(r.reasons.join(' ')).toMatch(/designated hitter/);
    expect(r.wouldResolve.join(' ')).toMatch(/Innings in the field at 1B/);
  });

  it('is no finding at all for a depth player: his bat is what the club wants', () => {
    const me = dh('Depth DH', 'organizational_depth');
    expect(positionConflict(10, '1B', [at('1B', 'Regular', 780), me], 900)).toBeNull();
  });
});

describe('an injured player', () => {
  it('competes for nothing while he is out, and is not the man squeezed', () => {
    const hurt = { ...hitter('Injured prospect', 0), injured: true };
    expect(positionConflict(10, 'SS', [hitter('Regular', 800), hurt], 900)).toBeNull();
    const c = positionConflict(10, 'SS', [hitter('Regular', 800), hitter('Healthy prospect', 5), hurt], 900)!;
    expect(c.claimants.map((s) => s.name)).not.toContain('Injured prospect');
  });

  it('has his review say so, rather than calling him blocked or not playing', () => {
    const me = hitter('Injured prospect', 0);
    const r = reviewAssignment({
      playerId: me.playerId, name: 'Injured prospect', age: 21, kind: 'hitter', teamId: 10, team: 'A Club', level: 3, levelName: 'AA', leagueName: 'A League',
      protection: tierOf('development_priority'),
      production: production({ percentile: null, unassessable: 'no_line_at_this_level', sample: { opportunities: 0, clubGames: 100, reliability: 0, mature: false } }),
      current: evaluateCurrentAssignment(currentInput({ leaguePercentile: null, reliability: 0, unassessable: 'No statistics at this level this season.', tier: 'development_priority' })),
      opportunity: readOpportunity(me.playerId, []), alternatives: [], blockedBy: [], injured: { daysLeft: 45 },
    });
    expect(r.conclusion).toBe('not_assessable');
    expect(r.attention).toBe('routine');
    expect(r.reasons[0]).toMatch(/injured \(45 days\)/);
    expect(r.wouldResolve.join(' ')).toMatch(/His return/);
  });
});

describe('two catchers', () => {
  it('who both need development time are a conflict when one of them is not catching', () => {
    const c = positionConflict(10, 'C', [at('C', 'Catcher A', 700), at('C', 'Catcher B', 40)], 900)!;
    expect(c.squeezed.map((s) => s.name)).toEqual(['Catcher B']);
    expect(c.severity).toBe('blocking');
  });

  it('who split the job are not: two is what a catching job supports', () => {
    expect(positionConflict(10, 'C', [at('C', 'Catcher A', 500), at('C', 'Catcher B', 400)], 900)).toBeNull();
  });
});
