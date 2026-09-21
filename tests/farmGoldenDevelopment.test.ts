import { describe, expect, it } from 'vitest';
import { evaluateCurrentAssignment } from '../server/currentAssignment.js';
import { evaluateProspectDecision } from '../server/prospectDecision.js';
import { syntheticScoutedAbility } from '../server/scoutedEvidence.js';
import { currentInput } from './farmGolden.js';

/**
 * What the level is doing for a player, and what age has to do with it.
 *
 * Each case is a baseball invariant. None of them names a real player or pins a ranking: a failure
 * means either the model has a defect or the invariant was wrong, and either is worth knowing.
 */

describe('the level a player is at', () => {
  it('is still developing a man who is holding his own', () => {
    const read = evaluateCurrentAssignment(currentInput({ leaguePercentile: 50 }));
    expect(read.verdict).toBe('appropriate');
    expect(read.standing).toBe('holding');
    expect(read.question).toBe('none');
  });

  it('has nothing left to teach a man who is clearly better than the league', () => {
    const read = evaluateCurrentAssignment(currentInput({ leaguePercentile: 95 }));
    expect(read.verdict).toBe('no_longer_developmental');
    expect(read.standing).toBe('mastered');
  });

  it('is ahead of a man clearly worse than the league who is not young for it', () => {
    const read = evaluateCurrentAssignment(currentInput({ leaguePercentile: 5, ageRelativeToLevel: 0 }));
    expect(read.verdict).toBe('too_advanced');
  });

  it('is on schedule for a player young for it who is struggling', () => {
    // A nineteen-year-old at Double-A having a hard time is developing, not misassigned
    const read = evaluateCurrentAssignment(currentInput({ leaguePercentile: 5, ageRelativeToLevel: 4 }));
    expect(read.verdict).toBe('appropriate');
    expect(read.reasons.join(' ')).toMatch(/young for it/);
  });

  it('raises an ORGANIZATIONAL question, not a developmental one, for a man past its age window', () => {
    // The 29-year-old hitting 1.304 at Double-A: beyond the level, and not a prospect
    const read = evaluateCurrentAssignment(currentInput({ leaguePercentile: 99, ageRelativeToLevel: -4.3 }));
    expect(read.verdict).toBe('no_longer_developmental');
    expect(read.window).toBe('closed');
    expect(read.question).toBe('organizational');
    expect(read.reasons.join(' ')).toMatch(/organizational question/);
  });

  it('says a man past the window who is merely holding his own is no longer a development case', () => {
    const read = evaluateCurrentAssignment(currentInput({ leaguePercentile: 50, ageRelativeToLevel: -4 }));
    expect(read.verdict).toBe('no_longer_developmental');
    expect(read.question).toBe('organizational');
  });

  it('keeps a claim off a thin sample however extreme the rate is', () => {
    const read = evaluateCurrentAssignment(currentInput({ leaguePercentile: 99, reliability: 0.2 }));
    expect(read.standing).toBe('holding');
    expect(read.verdict).toBe('appropriate');
    expect(read.reasons.join(' ')).toMatch(/well above the league/);
    expect(read.unknowns.join(' ')).toMatch(/More of the season/);
  });

  it('reads nothing at all when there is no line, and calls it not assessable rather than missing evidence', () => {
    const read = evaluateCurrentAssignment(
      currentInput({ leaguePercentile: null, reliability: 0, unassessable: 'His club has played 4 games.' })
    );
    expect(read.verdict).toBe('not_assessable');
    expect(read.missingEvidence).toEqual([]);
    expect(read.unknowns.join(' ')).toMatch(/4 games/);
  });

  it('is indeterminate, not negative, when the sample is unreadably thin but a line exists', () => {
    const read = evaluateCurrentAssignment(currentInput({ leaguePercentile: 40, reliability: 0.05 }));
    expect(read.verdict).toBe('indeterminate');
    expect(read.standing).toBe('indeterminate');
  });

  it('never turns an indeterminate protection tier into low developmental stakes', () => {
    const read = evaluateCurrentAssignment(currentInput({ tier: null }));
    expect(read.parts.find((p) => p.label === 'Developmental stakes')?.value).toBe('indeterminate');
    expect(read.unknowns.join(' ')).toMatch(/indeterminate/);
  });

  it('says a man the level is beyond has nowhere to go when the organization has no lower club', () => {
    const read = evaluateCurrentAssignment(currentInput({ leaguePercentile: 5, canDemote: false }));
    expect(read.verdict).toBe('too_advanced');
    expect(read.question).toBe('organizational');
    expect(read.reasons.join(' ')).toMatch(/no less demanding affiliate/);
  });

  it('shows every part with its basis, so no reading has to be taken from prose', () => {
    const read = evaluateCurrentAssignment(currentInput({ leaguePercentile: 90, ageRelativeToLevel: 2 }));
    expect(read.parts.map((p) => p.label)).toEqual(['Level standing', 'Developmental window', 'Developmental stakes']);
    for (const part of read.parts) expect(part.basis.length).toBeGreaterThan(0);
  });
});

describe('age relative to the level', () => {
  const at = (ageDiff: number) =>
    evaluateProspectDecision({
      kind: 'batter',
      primaryPerformanceDiff: 0.1,
      pa: 400,
      ageDiff,
      ability: syntheticScoutedAbility({ current: 45, potential: 50 }),
      nextAssignment: { level: 2, levelName: 'AAA', teams: [{ teamId: 2, label: 'Up' }], isMajorLeague: false },
      demotionAssignment: null,
      canDemote: false,
    });

  it('never lowers the developmental promotion bar for a player who is old for his level', () => {
    const neutral = at(0).development.promotionThreshold;
    for (const ageDiff of [-1, -3, -6, -10]) expect(at(ageDiff).development.promotionThreshold).toBe(neutral);
  });

  it('raises it for a player young for his level, who has time', () => {
    expect(at(3).development.promotionThreshold).toBeGreaterThan(at(0).development.promotionThreshold);
  });

  it('does not change what he has shown', () => {
    expect(at(4).evidence.performance).toBe(at(-4).evidence.performance);
    expect(at(4).evidence.readiness).toBe(at(-4).evidence.readiness);
  });
});
