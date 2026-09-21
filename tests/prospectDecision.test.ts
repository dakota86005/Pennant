import { describe, expect, it } from 'vitest';
import {
  evaluateProspectDecision,
  type ProspectDecisionInput,
  type ProspectNextAssignment,
} from '../server/prospectDecision.js';
import { syntheticScoutedAbility } from '../server/scoutedEvidence.js';

const ability = (current: number | null, potential: number | null) =>
  syntheticScoutedAbility({ current, potential });

/**
 * Player Development's readiness model, driven by explicit synthetic inputs.
 *
 * These pin the domain mechanics — how production, sample, age and ratings
 * combine, and how far philosophy is allowed to move the threshold. They say
 * nothing about where the ratings come from; that is the evidence adapter's
 * job (see scoutedEvidence.test.ts).
 */

const aa: ProspectNextAssignment = {
  level: 3, levelName: 'AA', teams: [{ teamId: 3, label: 'AA Club' }], isMajorLeague: false,
};
const mlb: ProspectNextAssignment = {
  level: 1, levelName: 'MLB', teams: [{ teamId: 1, label: 'MLB Club' }], isMajorLeague: true,
};
const single: ProspectNextAssignment = {
  level: 5, levelName: 'A', teams: [{ teamId: 5, label: 'A Club' }], isMajorLeague: false,
};

/** A hitter with a level-average age, +.100 OPS over the level and a mature sample. */
function hitter(overrides: Partial<ProspectDecisionInput> = {}): ProspectDecisionInput {
  return {
    kind: 'batter',
    primaryPerformanceDiff: 0.1,
    pa: 250,
    ageDiff: 0,
    ability: ability(50, 50),
    nextAssignment: aa,
    demotionAssignment: single,
    canDemote: true,
    ...overrides,
  };
}

describe('prospect readiness', () => {
  it('weights production three-to-one over ratings maturity', () => {
    const d = evaluateProspectDecision(hitter());
    // +.100 OPS is 75; no remaining projection is the maximum maturity of 90
    expect(d.evidence.performance).toBe(75);
    expect(d.evidence.ratingsMaturity).toBe(90);
    expect(d.evidence.readiness).toBe(Math.round(75 * 0.75 + 90 * 0.25));
  });

  it('scores maturity from the gap between current and potential, not from either alone', () => {
    const lowCeilingNearlyDone = evaluateProspectDecision(hitter({ ability: ability(40, 42) }));
    const highCeilingNearlyDone = evaluateProspectDecision(hitter({ ability: ability(65, 67) }));
    expect(lowCeilingNearlyDone.evidence.ratingsMaturity)
      .toBe(highCeilingNearlyDone.evidence.ratingsMaturity);
  });

  it('treats a large projected gap as immature, bottoming out at 20', () => {
    expect(evaluateProspectDecision(hitter({ ability: ability(25, 75) })).evidence.ratingsMaturity).toBe(20);
    expect(evaluateProspectDecision(hitter({ ability: ability(50, 60) })).evidence.ratingsMaturity).toBe(62);
  });

  it('does not count a potential below current as extra maturity', () => {
    expect(evaluateProspectDecision(hitter({ ability: ability(60, 50) })).evidence.ratingsMaturity).toBe(90);
  });

  it('keeps age out of readiness — it only moves urgency and the threshold', () => {
    const young = evaluateProspectDecision(hitter({ ageDiff: 2 }));
    const old = evaluateProspectDecision(hitter({ ageDiff: -2 }));
    expect(young.evidence.readiness).toBe(old.evidence.readiness);
    expect(young.evidence.ageLevelUrgency).toBeLessThan(old.evidence.ageLevelUrgency);
    expect(young.development.promotionThreshold).toBeGreaterThan(old.development.promotionThreshold);
  });

  it('never lowers the developmental bar for a player who is old for his level', () => {
    // Being old for a level is not evidence about what a player has shown. The earlier model
    // discounted his threshold by up to five points for it, so age argued FOR a developmental
    // promotion; a player past his level's window raises an organizational question instead
    // (currentAssignment.ts). D-044.
    const neutral = evaluateProspectDecision(hitter({ ageDiff: 0 }));
    for (const ageDiff of [-0.5, -2, -5, -10]) {
      const old = evaluateProspectDecision(hitter({ ageDiff }));
      expect(old.development.ageThresholdAdjustment).toBe(0);
      expect(old.development.promotionThreshold).toBe(neutral.development.promotionThreshold);
    }
  });

  it('caps the age effect on the threshold at five points, and only upward', () => {
    const veryYoung = evaluateProspectDecision(hitter({ ageDiff: 10 }));
    const veryOld = evaluateProspectDecision(hitter({ ageDiff: -10 }));
    expect(veryYoung.development.ageThresholdAdjustment).toBe(5);
    expect(veryOld.development.ageThresholdAdjustment).toBe(0);
  });

  it('measures pitchers on ERA and strikeout rate together', () => {
    const d = evaluateProspectDecision({
      kind: 'pitcher',
      primaryPerformanceDiff: 1, // a run better than the level: 75
      secondaryPerformanceDiff: 0.05, // +5 points of K%: 75
      ip: 60,
      ageDiff: 0,
      ability: ability(50, 50),
        nextAssignment: aa,
      demotionAssignment: single,
      canDemote: true,
    });
    expect(d.evidence.performance).toBe(75);
  });
});

describe('sample confidence', () => {
  it('runs from 25 at the evaluation minimum to 100 at a mature sample', () => {
    expect(evaluateProspectDecision(hitter({ pa: 60 })).evidence.sampleConfidence).toBe(25);
    expect(evaluateProspectDecision(hitter({ pa: 250 })).evidence.sampleConfidence).toBe(100);
    expect(evaluateProspectDecision(hitter({ pa: 155 })).evidence.sampleConfidence).toBe(63);
  });

  it('uses innings for pitchers: 15 IP is 25, 60 IP is 100', () => {
    const pitcher = (ip: number) => evaluateProspectDecision({
      kind: 'pitcher', primaryPerformanceDiff: 0, secondaryPerformanceDiff: 0, ip, ageDiff: 0,
      ability: ability(50, 50), nextAssignment: aa,
      demotionAssignment: single, canDemote: true,
    });
    expect(pitcher(15).evidence.sampleConfidence).toBe(25);
    expect(pitcher(60).evidence.sampleConfidence).toBe(100);
  });

  it('labels confidence limited, moderate or high without changing readiness', () => {
    expect(evaluateProspectDecision(hitter({ pa: 70 })).confidence).toBe('limited');
    expect(evaluateProspectDecision(hitter({ pa: 150 })).confidence).toBe('moderate');
    expect(evaluateProspectDecision(hitter({ pa: 250 })).confidence).toBe('high');
    expect(evaluateProspectDecision(hitter({ pa: 70 })).evidence.readiness)
      .toBe(evaluateProspectDecision(hitter({ pa: 250 })).evidence.readiness);
  });
});

describe('recommendations', () => {
  it('considers promotion when readiness clears the neutral threshold of 76', () => {
    const d = evaluateProspectDecision(hitter());
    expect(d.development.promotionThreshold).toBe(76);
    expect(d.evidence.readiness).toBe(79);
    expect(d.recommendation).toBe('consider_promotion');
  });

  it('calls it a strong case eight points above the threshold with a solid sample', () => {
    const d = evaluateProspectDecision(hitter({ primaryPerformanceDiff: 0.16 }));
    expect(d.recommendation).toBe('strong_promotion_case');
  });

  it('makes a promotion to MLB a discussion rather than an ordinary promotion', () => {
    expect(evaluateProspectDecision(hitter({ nextAssignment: mlb })).recommendation)
      .toBe('mlb_ready_discussion');
  });

  it('holds when there is no higher affiliate to send him to', () => {
    const d = evaluateProspectDecision(hitter({ nextAssignment: null }));
    expect(d.recommendation).not.toMatch(/promotion|mlb/);
    expect(d.cautions.join(' ')).toMatch(/No higher affiliate/);
  });

  it('will not act on a thin sample however good the production', () => {
    const d = evaluateProspectDecision(hitter({ pa: 60, primaryPerformanceDiff: 0.2 }));
    expect(d.evidence.sampleConfidence).toBeLessThan(45);
    expect(d.recommendation).toBe('watch');
  });
});

describe('demotion', () => {
  const struggling = (overrides: Partial<ProspectDecisionInput> = {}) =>
    hitter({ primaryPerformanceDiff: -0.2, pa: 200, ageDiff: 0, ...overrides });

  it('needs poor production, a real sample, and a player who is not young for the level', () => {
    expect(evaluateProspectDecision(struggling()).recommendation).toBe('consider_demotion');
    // young for the level: on schedule, not a demotion
    expect(evaluateProspectDecision(struggling({ ageDiff: 1 })).recommendation)
      .not.toBe('consider_demotion');
    // not enough sample
    expect(evaluateProspectDecision(struggling({ pa: 80 })).recommendation)
      .not.toBe('consider_demotion');
    // merely below average
    expect(evaluateProspectDecision(struggling({ primaryPerformanceDiff: -0.06 })).recommendation)
      .not.toBe('consider_demotion');
  });

  it('is impossible at the bottom of the organization', () => {
    expect(evaluateProspectDecision(struggling({ canDemote: false })).recommendation)
      .not.toBe('consider_demotion');
  });

  it('explains when a demotion case has nowhere to go', () => {
    const d = evaluateProspectDecision(struggling({ demotionAssignment: null }));
    expect(d.recommendation).toBe('consider_demotion');
    expect(d.cautions.join(' ')).toMatch(/No lower affiliate/);
  });
});

describe('the decision engine knows nothing of philosophy', () => {
  it('has no philosophy input to take', () => {
    // Structural: an extra property is ignored at runtime and rejected by tsc, so the
    // engine cannot be handed a preference to act on
    const withExtra = { ...hitter(), promotionAggressiveness: 100 } as ProspectDecisionInput;
    expect(evaluateProspectDecision(withExtra)).toEqual(evaluateProspectDecision(hitter()));
  });

  it('uses a developmental promotion threshold of 76, raised only by youth relative to level', () => {
    expect(evaluateProspectDecision(hitter()).development).toEqual({
      promotionThreshold: 76,
      ageThresholdAdjustment: 0,
    });
    expect(evaluateProspectDecision(hitter({ ageDiff: 2 })).development.promotionThreshold).toBe(79);
    expect(evaluateProspectDecision(hitter({ ageDiff: -2 })).development.promotionThreshold).toBe(76);
  });

  it('cannot promote on a thin sample', () => {
    const d = evaluateProspectDecision(hitter({ pa: 60, primaryPerformanceDiff: 0.2 }));
    expect(d.evidence.sampleConfidence).toBeLessThan(45);
    expect(d.recommendation).toBe('watch');
  });

  it('cannot promote weak production', () => {
    const d = evaluateProspectDecision(hitter({ primaryPerformanceDiff: 0 }));
    expect(d.evidence.readiness).toBeLessThan(d.development.promotionThreshold);
    expect(d.recommendation).not.toMatch(/promotion|mlb/);
  });
});

describe('missing rating evidence', () => {
  const unknown = (current: number | null, potential: number | null) =>
    ability(current, potential);

  it('does not turn a missing current rating into a midpoint', () => {
    const d = evaluateProspectDecision(hitter({ ability: unknown(null, 60) }));
    expect(d.evidence.ratingsMaturity).toBeNull();
    expect(d.evidence.readiness).toBeNull();
    expect(d.ratingsEvidence).toBe('partial');
  });

  it('does not turn a missing potential rating into a midpoint', () => {
    const d = evaluateProspectDecision(hitter({ ability: unknown(50, null) }));
    expect(d.evidence.ratingsMaturity).toBeNull();
    expect(d.evidence.readiness).toBeNull();
    expect(d.ratingsEvidence).toBe('partial');
  });

  it('keeps every objective figure while readiness is unknown', () => {
    const known = evaluateProspectDecision(hitter());
    const d = evaluateProspectDecision(hitter({ ability: unknown(null, null) }));
    expect(d.evidence.performance).toBe(known.evidence.performance);
    expect(d.evidence.sampleConfidence).toBe(known.evidence.sampleConfidence);
    expect(d.evidence.ageLevelUrgency).toBe(known.evidence.ageLevelUrgency);
    expect(d.development.promotionThreshold).toBe(known.development.promotionThreshold);
    expect(d.positives.join(' ')).toMatch(/Production is clearly above/);
  });

  it('bounds readiness by the maturity model\'s own range, not by an estimate', () => {
    const d = evaluateProspectDecision(hitter({ ability: unknown(null, null) }));
    // Performance 75: readiness is 0.75 * 75 + 0.25 * (20 to 90)
    expect(d.evidence.readinessRange).toEqual({ min: 61, max: 79 });
    const known = evaluateProspectDecision(hitter());
    expect(known.evidence.readinessRange).toEqual({ min: 79, max: 79 });
  });

  it('is indeterminate for an otherwise promotion-ready player, and says what is missing', () => {
    const d = evaluateProspectDecision(hitter({ ability: unknown(null, null) }));
    expect(d.recommendation).toBe('indeterminate');
    expect(d.possibleRecommendations.length).toBeGreaterThan(1);
    expect(d.missingEvidence.map((m) => m.dimension)).toEqual(['current_ability', 'potential_ability']);
    expect(d.cautions.join(' ')).toMatch(/no neutral value is substituted/);
  });

  it('still reaches a negative conclusion when no possible rating could matter', () => {
    // Even the most mature possible ratings leave readiness below the watch line
    const d = evaluateProspectDecision(hitter({ ability: unknown(null, null), primaryPerformanceDiff: -0.05 }));
    expect(d.evidence.readinessRange.max).toBeLessThan(d.development.promotionThreshold - 8);
    expect(d.recommendation).toBe('hold');
    expect(d.possibleRecommendations).toEqual([]);
  });

  it('still recommends a demotion, which rests on objective evidence only', () => {
    const d = evaluateProspectDecision(
      hitter({ ability: unknown(null, null), primaryPerformanceDiff: -0.2, pa: 200 })
    );
    expect(d.demotionCase).toBe(true);
    expect(d.recommendation).toBe('consider_demotion');
  });

  it('is unchanged for known ratings', () => {
    const d = evaluateProspectDecision(hitter());
    expect(d.ratingsEvidence).toBe('complete');
    expect(d.missingEvidence).toEqual([]);
    expect(d.evidence.readiness).toBe(79);
    expect(d.recommendation).toBe('consider_promotion');
    expect(d.possibleRecommendations).toEqual([]);
  });
});
