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
    promotionAggressiveness: 50,
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

  it('blocks and explains when readiness is short of the organizational threshold', () => {
    const [normal] = of(plan({ primaryPerformanceDiff: 0 }), 'normal_promotion');
    expect(normal.eligible).toBe(false);
    expect(normal.recommendation).toBe('not_recommended');
    expect(normal.blockers.join(' ')).toMatch(/below the organizational promotion threshold/);
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

  it('keeps a hard readiness floor of 84 for even the most aggressive organization', () => {
    const [skip] = of(plan({ promotionAggressiveness: 100 }), 'skip_level_promotion');
    expect(skip.requirements.readiness).toBe(84);
    expect(skip.eligible).toBe(false);
  });

  it('lets a conservative organization raise the skip bar above the floor', () => {
    const [skip] = of(plan({ promotionAggressiveness: 0 }), 'skip_level_promotion');
    expect(skip.requirements.readiness).toBe(96);
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

describe('philosophy versus hard developmental constraints (current behavior)', () => {
  /*
   * Ordinary promotion eligibility is currently gated on a philosophy-derived
   * threshold, so promotion aggressiveness can move a player across the line.
   * That is the boundary issue the philosophy-correction milestone addresses
   * (docs/ROADMAP.md); it is pinned here so the change is deliberate and visible,
   * not endorsed. The rules that must NOT move are asserted below it.
   */
  it('lets aggressiveness change ordinary promotion eligibility today', () => {
    const borderline: Partial<ProspectDecisionInput> = { primaryPerformanceDiff: 0.06 };
    expect(of(plan({ ...borderline, promotionAggressiveness: 0 }), 'normal_promotion')[0].eligible)
      .toBe(false);
    expect(of(plan({ ...borderline, promotionAggressiveness: 100 }), 'normal_promotion')[0].eligible)
      .toBe(true);
  });

  it('cannot lower the sample requirement for any assignment', () => {
    const [normal, skip] = of(plan({ pa: 60, primaryPerformanceDiff: 0.2, promotionAggressiveness: 100 }), 'normal_promotion')
      .concat(of(plan({ pa: 60, primaryPerformanceDiff: 0.2, promotionAggressiveness: 100 }), 'skip_level_promotion'));
    expect(normal.eligible).toBe(false);
    expect(skip.eligible).toBe(false);
  });

  it('cannot make a skip-level move defensible without the skip-level evidence', () => {
    for (const aggression of [0, 50, 100]) {
      const [skip] = of(plan({ promotionAggressiveness: aggression }), 'skip_level_promotion');
      expect(skip.eligible, `aggressiveness ${aggression}`).toBe(false);
    }
  });

  it('cannot create or remove a demotion case', () => {
    for (const aggression of [0, 50, 100]) {
      expect(of(plan({ primaryPerformanceDiff: -0.2, pa: 200, promotionAggressiveness: aggression }), 'demotion')[0].eligible)
        .toBe(true);
      expect(of(plan({ promotionAggressiveness: aggression }), 'demotion')[0].eligible).toBe(false);
    }
  });
});

describe('missing rating evidence (current behavior)', () => {
  it('lets a neutral maturity of 50 stand in, which lowers readiness against a fully mature player', () => {
    const known = of(plan(), 'normal_promotion')[0];
    const unknown = of(plan({ ability: ability(null, null) }), 'normal_promotion')[0];
    expect(unknown.evidence.ratingsMaturity).toBe(50);
    expect(unknown.evidence.readiness).toBeLessThan(known.evidence.readiness);
    expect(unknown.eligible).toBe(false);
  });

  it('still allows ordinary promotion when production alone is convincing', () => {
    const [normal] = of(plan({ ability: ability(null, null), primaryPerformanceDiff: 0.16 }), 'normal_promotion');
    expect(normal.eligible).toBe(true);
  });

  it('withholds skip-level promotion, because unknown maturity cannot meet the maturity floor', () => {
    const [skip] = of(plan({ ability: ability(null, null), primaryPerformanceDiff: 0.2 }), 'skip_level_promotion');
    expect(skip.eligible).toBe(false);
    expect(skip.blockers.join(' ')).toMatch(/Ratings maturity 50/);
  });
});
