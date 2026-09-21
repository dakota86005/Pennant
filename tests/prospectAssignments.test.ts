import { describe, expect, it } from 'vitest';
import {
  evaluateProspectDecision,
  type ProspectDecisionInput,
  type ProspectNextAssignment,
} from '../server/prospectDecision.js';
import {
  evaluateProspectAssignments,
  type ProspectAssignmentEvaluation,
} from '../server/prospectAssignments.js';
import { syntheticScoutedAbility } from '../server/scoutedEvidence.js';

const ability = (current: number | null, potential: number | null) =>
  syntheticScoutedAbility({ current, potential });

/**
 * Which assignments Player Development calls defensible.
 *
 * The plan is built the way production builds it — a decision, then the
 * organization's actual higher and lower affiliates — from explicit synthetic
 * evidence. Minor League Operations may only choose among what comes out as
 * eligible, so these are the constraints it inherits.
 */

const at = (level: number, name: string, isMajorLeague = false): ProspectNextAssignment => ({
  level, levelName: name, teams: [{ teamId: level * 10, label: `${name} Club` }], isMajorLeague,
});
const A = at(4, 'A');
const AA = at(3, 'AA');
const AAA = at(2, 'AAA');
const MLB = at(1, 'MLB', true);
const R = at(6, 'R');

function decide(overrides: Partial<ProspectDecisionInput> = {}, higher = [A, AA, AAA, MLB]) {
  return evaluateProspectDecision({
    kind: 'batter',
    primaryPerformanceDiff: 0.1,
    pa: 250,
    ageDiff: 0,
    ability: ability(50, 50),
    nextAssignment: higher[0] ?? null,
    demotionAssignment: R,
    canDemote: true,
    ...overrides,
  });
}

const plan = (overrides: Partial<ProspectDecisionInput> = {}, higher = [A, AA, AAA, MLB], lower = [R]) =>
  evaluateProspectAssignments({
    decision: decide(overrides, higher),
    higherAssignments: higher,
    lowerAssignments: lower,
  });

const of = (p: ReturnType<typeof plan>, kind: ProspectAssignmentEvaluation['kind']) =>
  p.evaluations.filter((e) => e.kind === kind);

describe('ordinary promotion authorization', () => {
  it('authorizes the nearest higher level when readiness and sample clear the threshold', () => {
    const [normal] = of(plan(), 'normal_promotion');
    expect(normal.target.levelName).toBe('A');
    expect(normal.eligible).toBe(true);
    expect(normal.recommendation).toBe('consider');
    expect(normal.blockers).toEqual([]);
    expect(normal.levelsSkipped).toBe(0);
  });

  it('marks it strong eight points above the threshold with a sample of at least 60', () => {
    const [normal] = of(plan({ primaryPerformanceDiff: 0.16 }), 'normal_promotion');
    expect(normal.recommendation).toBe('strong');
  });

  it('blocks and explains when readiness is short of the developmental threshold', () => {
    const [normal] = of(plan({ primaryPerformanceDiff: 0 }), 'normal_promotion');
    expect(normal.eligible).toBe(false);
    expect(normal.recommendation).toBe('not_recommended');
    expect(normal.blockers.join(' ')).toMatch(/below the developmental promotion threshold/);
  });

  it('blocks on an immature sample even when readiness is high', () => {
    const [normal] = of(plan({ pa: 60, primaryPerformanceDiff: 0.2 }), 'normal_promotion');
    expect(normal.eligible).toBe(false);
    expect(normal.blockers.join(' ')).toMatch(/evidence confidence/i);
  });

  it('is a discussion, not a promotion, when the nearest higher level is the majors', () => {
    const p = plan({}, [MLB]);
    expect(of(p, 'normal_promotion')).toHaveLength(0);
    const [discussion] = of(p, 'mlb_discussion');
    expect(discussion.eligible).toBe(true);
    expect(discussion.recommendation).toBe('mlb_discussion');
  });

  it('offers nothing to promote to at the top of the organization', () => {
    const p = plan({}, []);
    expect(p.evaluations.filter((e) => e.direction === 'promotion')).toHaveLength(0);
  });
});

describe('skip-level authorization', () => {
  const elite: Partial<ProspectDecisionInput> = { primaryPerformanceDiff: 0.2 };

  it('is denied on merely good production even though ordinary promotion is authorized', () => {
    const p = plan();
    expect(of(p, 'normal_promotion')[0].eligible).toBe(true);
    const [skip] = of(p, 'skip_level_promotion');
    expect(skip.target.levelName).toBe('AA');
    expect(skip.levelsSkipped).toBe(1);
    expect(skip.eligible).toBe(false);
    expect(skip.blockers.join(' ')).toMatch(/skip-level requirement/);
  });

  it('is authorized for dominant, mature, well-sampled evidence', () => {
    const [skip] = of(plan(elite), 'skip_level_promotion');
    expect(skip.eligible).toBe(true);
    expect(skip.recommendation).toBe('exceptional');
    expect(skip.requirements).toEqual({
      readiness: 86, performance: 85, ratingsMaturity: 55, sampleConfidence: 70,
    });
  });

  it('gets harder for every additional level skipped', () => {
    const p = plan(elite);
    const [one, two] = of(p, 'skip_level_promotion');
    expect(two.levelsSkipped).toBe(2);
    expect(two.requirements.readiness!).toBeGreaterThan(one.requirements.readiness!);
    expect(two.requirements.performance!).toBeGreaterThan(one.requirements.performance!);
    expect(two.requirements.ratingsMaturity!).toBeGreaterThan(one.requirements.ratingsMaturity!);
    expect(two.requirements.sampleConfidence!).toBeGreaterThan(one.requirements.sampleConfidence!);
  });

  it('is denied when projected development remains, however good the production', () => {
    const [skip] = of(plan({ ...elite, ability: ability(30, 70) }), 'skip_level_promotion');
    expect(skip.eligible).toBe(false);
    expect(skip.blockers.join(' ')).toMatch(/too much projected development remains/);
  });

  it('is denied on a sample below 70', () => {
    const [skip] = of(plan({ ...elite, pa: 150 }), 'skip_level_promotion');
    expect(skip.eligible).toBe(false);
    expect(skip.blockers.join(' ')).toMatch(/below the skip-level requirement of 70/);
  });

  it('sits ten points above the developmental promotion threshold, with a hard floor of 84', () => {
    // Age never lowers the ordinary threshold (D-044), so an older player's skip requirement is
    // the ordinary bar plus ten, which is already above the 84 floor
    const older = of(plan({ ageDiff: -5 }), 'skip_level_promotion')[0];
    expect(older.requirements.readiness).toBe(86);
    // A player young for the level has a higher ordinary threshold, and the skip follows it
    const younger = of(plan({ ageDiff: 5 }), 'skip_level_promotion')[0];
    expect(younger.requirements.readiness).toBe(91);
    // The floor still binds: nothing can put the skip requirement below 84
    for (const ageDiff of [-10, -5, 0, 5, 10]) {
      expect(of(plan({ ageDiff }), 'skip_level_promotion')[0].requirements.readiness)
        .toBeGreaterThanOrEqual(84);
    }
  });

  it('is never evaluated straight to the majors by this engine', () => {
    const p = plan(elite, [A, AA, MLB]);
    const skips = of(p, 'skip_level_promotion');
    const toMlb = skips.find((s) => s.target.isMajorLeague)!;
    expect(toMlb.eligible).toBe(false);
    expect(toMlb.blockers.join(' ')).toMatch(/directly to MLB is not evaluated/);
  });
});

describe('demotion', () => {
  const struggling: Partial<ProspectDecisionInput> = { primaryPerformanceDiff: -0.2, pa: 200 };

  it('is authorized only when the decision engine independently finds a demotion case', () => {
    const [demotion] = of(plan(struggling), 'demotion');
    expect(demotion.direction).toBe('demotion');
    expect(demotion.eligible).toBe(true);
    expect(demotion.recommendation).toBe('consider');
    expect(demotion.reasons.join(' ')).toMatch(/did not create the demotion case/);
  });

  it('is offered, and refused, for a player who is performing', () => {
    const [demotion] = of(plan(), 'demotion');
    expect(demotion.eligible).toBe(false);
    expect(demotion.blockers.join(' ')).toMatch(/does not independently support a demotion/);
  });

  it('is one level at a time', () => {
    const p = plan(struggling, [A, AA, AAA, MLB], [R, at(7, 'DSL')]);
    const demotions = of(p, 'demotion');
    expect(demotions).toHaveLength(1);
    expect(demotions[0].target.levelName).toBe('R');
  });

  it('is absent when there is no lower level', () => {
    expect(of(plan(struggling, [A, AA, AAA, MLB], []), 'demotion')).toHaveLength(0);
  });

  it('is not a way to promote: an eligible demotion coexists with no eligible promotion', () => {
    const p = plan(struggling);
    expect(p.eligible.map((e) => e.direction)).toEqual(['demotion']);
  });
});

describe('the eligible set', () => {
  it('contains exactly the evaluations that are eligible, and nothing Operations could invent', () => {
    const p = plan({ primaryPerformanceDiff: 0.2 });
    expect(p.eligible.every((e) => e.eligible)).toBe(true);
    expect(p.eligible.length).toBe(p.evaluations.filter((e) => e.eligible).length);
    expect(p.evaluations.length).toBeGreaterThan(p.eligible.length);
  });
});

describe('missing rating evidence', () => {
  const unknownRatings = { ability: ability(null, null) };

  it('makes an otherwise promotion-ready player indeterminate — neither defensible nor indefensible', () => {
    const p = plan(unknownRatings);
    const [normal] = of(p, 'normal_promotion');
    expect(normal.judgment).toBe('indeterminate');
    expect(normal.eligible).toBe(false);
    expect(normal.recommendation).toBe('indeterminate');
    // Not a rejection: nothing blocks him, and the evidence gap is named instead
    expect(normal.blockers).toEqual([]);
    expect(normal.missingEvidence.map((m) => m.dimension)).toEqual(['current_ability', 'potential_ability']);
    expect(p.indeterminate).toContain(normal);
    expect(p.eligible).not.toContain(normal);
  });

  it('shows the objective constraints alongside the unknown one', () => {
    const [normal] = of(plan(unknownRatings), 'normal_promotion');
    const byId = Object.fromEntries(normal.constraints.map((c) => [c.id, c]));
    expect(byId.sample_confidence.state).toBe('satisfied');
    expect(byId.readiness.state).toBe('unknown');
    expect(byId.readiness.requiresSubjectiveEvidence).toBe(true);
    expect(normal.evidence.performance).toBeGreaterThan(0);
    expect(normal.evidence.readiness).toBeNull();
    expect(normal.evidence.ratingsMaturity).toBeNull();
  });

  it('still rejects on an objective shortfall even when ratings are unknown', () => {
    const [normal] = of(plan({ ...unknownRatings, pa: 60, primaryPerformanceDiff: 0.2 }), 'normal_promotion');
    expect(normal.judgment).toBe('indefensible');
    expect(normal.blockers.join(' ')).toMatch(/evidence confidence/i);
    expect(normal.missingEvidence).toEqual([]);
  });

  it('still rejects when no possible rating could reach the threshold', () => {
    const [normal] = of(plan({ ...unknownRatings, primaryPerformanceDiff: 0 }), 'normal_promotion');
    expect(normal.judgment).toBe('indefensible');
    expect(normal.blockers.join(' ')).toMatch(/below the developmental promotion threshold/);
  });

  it('leaves skip-level promotion indeterminate, with the maturity requirement unknown', () => {
    const [skip] = of(plan({ ...unknownRatings, primaryPerformanceDiff: 0.2 }), 'skip_level_promotion');
    expect(skip.judgment).toBe('indeterminate');
    const maturity = skip.constraints.find((c) => c.id === 'ratings_maturity')!;
    expect(maturity.state).toBe('unknown');
    expect(skip.blockers).toEqual([]);
    expect(skip.eligible).toBe(false);
  });

  it('does not touch demotion, which rests on objective evidence', () => {
    const struggling = plan({ ...unknownRatings, primaryPerformanceDiff: -0.2, pa: 200 });
    const [demotion] = of(struggling, 'demotion');
    expect(demotion.judgment).toBe('defensible');
    expect(demotion.eligible).toBe(true);
    const [fine] = of(plan(unknownRatings), 'demotion');
    expect(fine.judgment).toBe('indefensible');
  });

  it('lets known adequate evidence still authorize, and known shortfall still reject', () => {
    expect(of(plan(), 'normal_promotion')[0].judgment).toBe('defensible');
    expect(of(plan({ primaryPerformanceDiff: 0 }), 'normal_promotion')[0].judgment).toBe('indefensible');
    expect(of(plan({ primaryPerformanceDiff: 0.2 }), 'skip_level_promotion')[0].judgment).toBe('defensible');
    expect(of(plan({ primaryPerformanceDiff: 0.2, ability: ability(30, 70) }), 'skip_level_promotion')[0].judgment)
      .toBe('indefensible');
  });
});
