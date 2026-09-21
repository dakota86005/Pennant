import { describe, expect, it } from 'vitest';
import { evaluateCurrentAssignment } from '../server/currentAssignment.js';
import { reviewAssignment } from '../server/farmAssignments.js';
import { evaluateProspectDecision } from '../server/prospectDecision.js';
import { readOpportunity } from '../server/playingTime.js';
import { ability, alternative, currentInput, production, tierOf } from './farmGolden.js';

/**
 * The farm archetypes, each through the composed review rather than one specialist.
 *
 * What these protect: strong statistics are evidence, not authorization to promote; poor statistics
 * are evidence, not authorization to demote; age never buys a promotion discount; a lack of
 * projection never masquerades as readiness; and a man with nothing to read is not a man with
 * something wrong.
 */

const review = (
  overrides: Partial<Parameters<typeof reviewAssignment>[0]> & { current: ReturnType<typeof evaluateCurrentAssignment> }
) =>
  reviewAssignment({
    playerId: 1,
    name: 'Archetype',
    age: 22,
    kind: 'hitter',
    teamId: 10,
    team: 'A Club',
    level: 3,
    levelName: 'AA',
    leagueName: 'A League',
    protection: tierOf('development_priority'),
    production: production(),
    opportunity: readOpportunity(1, []),
    alternatives: [],
    blockedBy: [],
    ...overrides,
  });

describe('a young player performing poorly over a tiny sample', () => {
  const current = evaluateCurrentAssignment(currentInput({ leaguePercentile: 4, reliability: 0.1, ageRelativeToLevel: 2.5, tier: 'development_priority' }));

  it('has a line too thin to read, which is indeterminate — not a demotion case', () => {
    expect(current.verdict).toBe('indeterminate');
    const r = review({ current, alternatives: [alternative({ direction: 'demotion', kind: 'demotion', level: 4, levelName: 'A' })] });
    expect(r.conclusion).not.toBe('demotion_direction_defensible');
    expect(r.conclusion).toBe('indeterminate');
  });

  it('is on schedule, not in the wrong place, once the sample supports a claim: struggling young for a level is not evidence against it', () => {
    const settled = evaluateCurrentAssignment(currentInput({ leaguePercentile: 4, reliability: 0.5, ageRelativeToLevel: 2.5, tier: 'development_priority' }));
    expect(settled.verdict).toBe('appropriate');
    expect(review({ current: settled }).conclusion).toBe('current_assignment_defensible');
  });
});

describe('older organizational depth dominating a lower level', () => {
  const current = evaluateCurrentAssignment(currentInput({ leaguePercentile: 97, reliability: 0.6, ageRelativeToLevel: -4.5, tier: 'organizational_depth' }));

  it('raises an organizational question, never a promotion case, however defensible the move up would be', () => {
    const r = review({
      current,
      protection: tierOf('organizational_depth'),
      alternatives: [alternative({ judgment: 'defensible', preference: 'preferred' })],
    });
    expect(current.question).toBe('organizational');
    expect(r.conclusion).toBe('organizational_question');
    expect(r.attention).toBe('worth_a_look');
    expect(r.reasons.join(' ')).toMatch(/not a developmental case for him/);
  });
});

describe('a high-upside prospect with incomplete current evidence', () => {
  it('reads what his results say and leaves his stakes unknown, claiming nothing about a blockage', () => {
    const current = evaluateCurrentAssignment(currentInput({ leaguePercentile: 60, reliability: 0.4, tier: null, missingEvidence: [{ dimension: 'current_ability', detail: 'no visible current grade' }] }));
    expect(current.verdict).toBe('appropriate');
    expect(current.parts.find((p) => p.label === 'Developmental stakes')?.value).toBe('indeterminate');
    const r = review({ current, protection: tierOf(null), opportunity: { verdict: 'not_playing', job: { kind: 'position', position: 'SS' }, ahead: [], reasons: ['0 of 900 innings at SS.'], unknowns: [] } });
    expect(r.conclusion).toBe('current_assignment_defensible');
    expect(r.reasons.join(' ')).toMatch(/cannot be said/);
  });
});

describe('a mature, low-upside player with strong production', () => {
  const current = evaluateCurrentAssignment(currentInput({ leaguePercentile: 92, reliability: 0.6, ageRelativeToLevel: 0, tier: 'normal' }));

  it('is beyond the level developmentally, but the move up is only a case when Player Development calls it defensible', () => {
    expect(current.verdict).toBe('no_longer_developmental');
    const blocked = review({
      current,
      protection: tierOf('normal'),
      alternatives: [alternative({ judgment: 'indefensible', preference: null, blockers: ['His visible tools do not compare with the destination league.'] })],
    });
    expect(blocked.conclusion).toBe('current_assignment_defensible');
    expect(blocked.reasons.join(' ')).toMatch(/No promotion-direction assignment is defensible yet/);
    expect(blocked.wouldResolve.join(' ')).toMatch(/destination league/);
  });

  it('and is a promotion case when it is, with less urgency than a priority prospect would carry', () => {
    const open = review({ current, protection: tierOf('normal'), alternatives: [alternative()] });
    expect(open.conclusion).toBe('promotion_direction_defensible');
    expect(open.attention).toBe('worth_a_look');
  });
});

describe('a player old for his level', () => {
  it('who is holding his own is still being developed while the window is merely closing', () => {
    const closing = evaluateCurrentAssignment(currentInput({ leaguePercentile: 50, ageRelativeToLevel: -2 }));
    expect(closing.window).toBe('closing');
    expect(closing.verdict).toBe('appropriate');
  });

  it('is an organizational question, not a prospect, once the window has closed', () => {
    const closed = evaluateCurrentAssignment(currentInput({ leaguePercentile: 50, ageRelativeToLevel: -3.5 }));
    expect(closed.verdict).toBe('no_longer_developmental');
    expect(closed.question).toBe('organizational');
  });
});

describe('strong tools and poor results, weak tools and strong results', () => {
  const decision = (performanceDiff: number, cur: number, pot: number) =>
    evaluateProspectDecision({
      kind: 'batter',
      primaryPerformanceDiff: performanceDiff,
      pa: 300,
      ageDiff: 0,
      ability: ability(cur, pot),
      nextAssignment: { level: 2, levelName: 'AAA', teams: [{ teamId: 2, label: 'Up' }], isMajorLeague: false },
      demotionAssignment: { level: 4, levelName: 'A', teams: [{ teamId: 4, label: 'Down' }], isMajorLeague: false },
      canDemote: true,
    });

  it('does not promote on tools: a toolsy player hitting well below the league is not a promotion case', () => {
    const d = decision(-0.15, 55, 70);
    expect(['consider_promotion', 'strong_promotion_case', 'mlb_ready_discussion']).not.toContain(d.recommendation);
  });

  it('does not let results alone finish the argument: a ceiling-limited bat hitting well is at most a case to check against the destination', () => {
    const d = decision(0.12, 40, 42);
    /* The recommendation may be promotion-direction; it never carries the word "strong", and readiness is shown with its parts. */
    expect(d.recommendation).not.toBe('strong_promotion_case');
    expect(d.evidence.readiness).not.toBeNull();
    expect(d.evidence.ratingsMaturity).toBe(90 - 2 * 2.8 > 90 ? 90 : Math.round(90 - 2 * 2.8));
  });

  it('never gives an older player a lower bar than a younger one on the same line', () => {
    const young = evaluateProspectDecision({ ...decisionInput(0.1), ageDiff: 3 });
    const old = evaluateProspectDecision({ ...decisionInput(0.1), ageDiff: -3 });
    expect(old.development.promotionThreshold).toBeGreaterThanOrEqual(young.development.promotionThreshold - 5);
    expect(old.development.ageThresholdAdjustment).toBeGreaterThanOrEqual(0);
  });

  function decisionInput(performanceDiff: number) {
    return {
      kind: 'batter' as const,
      primaryPerformanceDiff: performanceDiff,
      pa: 300,
      ageDiff: 0,
      ability: ability(50, 55),
      nextAssignment: { level: 2, levelName: 'AAA', teams: [{ teamId: 2, label: 'Up' }], isMajorLeague: false },
      demotionAssignment: null,
      canDemote: false,
    };
  }
});

describe('missing evidence of each kind', () => {
  it('missing current ratings: his results are still read, his stakes are not invented', () => {
    const current = evaluateCurrentAssignment(currentInput({ leaguePercentile: 90, reliability: 0.6, tier: null }));
    expect(current.verdict).toBe('no_longer_developmental');
    expect(current.unknowns.join(' ')).toMatch(/Developmental stakes are indeterminate/);
  });

  it('missing production: nothing is read, and nothing is missing that scouting could supply', () => {
    const current = evaluateCurrentAssignment(currentInput({ leaguePercentile: null, reliability: 0, unassessable: 'No statistics at this level this season.' }));
    expect(current.verdict).toBe('not_assessable');
    expect(current.missingEvidence).toEqual([]);
    expect(review({ current }).attention).toBe('routine');
  });

  it('unknown destination fit: the alternative is neither open nor ruled out, and the current assignment stands', () => {
    const current = evaluateCurrentAssignment(currentInput({ leaguePercentile: 55 }));
    const r = review({ current, alternatives: [alternative({ judgment: 'indeterminate', preference: null, missingEvidence: [{ dimension: 'potential_ability', detail: 'no visible potential grade' }] })] });
    expect(r.conclusion).toBe('current_assignment_defensible');
    expect(r.reasons.join(' ')).toMatch(/neither open nor ruled out/);
    expect(r.missing).toContain('no visible potential grade');
  });
});
