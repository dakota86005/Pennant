import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_STATUS, CONTEXT_PROFILES, evaluateMlbAssignmentContext, STAKES_WEIGHT,
  type ContextInput, type CurrentLevelReadiness,
} from '../server/mlbAssignmentContext';
import { syntheticScoutedAbility } from '../server/scoutedEvidence';

/*
 * Player Development's contextual MLB assignment assessment, on explicit inputs.
 * The tests pin what makes it a Player Development capability and not a bypass:
 * stakes and evidence drive it, a core prospect gets no relief, unknown stays
 * unknown, and philosophy is not an input.
 */

const veteran = { age: 31, ability: syntheticScoutedAbility({ current: 30, potential: 30, kind: 'pitcher' }) }; // organizational depth
const prospect = { age: 21, ability: syntheticScoutedAbility({ current: 42, potential: 72, kind: 'pitcher' }) }; // core prospect
const unknownRatings = { age: 27, ability: syntheticScoutedAbility({ current: null, potential: null, kind: 'pitcher' }) };

const readiness = (over: Partial<CurrentLevelReadiness> = {}): CurrentLevelReadiness => ({
  readiness: 70, readinessRange: { min: 70, max: 70 }, sampleConfidence: 60, promotionThreshold: 80, ...over,
});
const base = (over: Partial<ContextInput>): ContextInput => ({
  context: 'spot_start', kind: 'pitcher', age: veteran.age, ability: veteran.ability,
  experience: { plateAppearances: 0, inningsPitched: 200 }, currentLevel: null, ...over,
});

describe('a temporary context can be defensible where a durable role is not', () => {
  it('relieves the durable bar by the context, so readiness 70 clears a spot start but not the durable 80', () => {
    const a = evaluateMlbAssignmentContext(base({ currentLevel: readiness({ readiness: 70 }), experience: null }));
    expect(a.readiness).toMatchObject({ durable: 80, required: 68, relief: 12, current: 70 });
    expect(a.routes.production).toBe('satisfied');
    expect(a.judgment).toBe('defensible');
    // the same readiness against the durable bar
    expect(70).toBeLessThan(a.readiness.durable as number);
  });

  it('each context sets its own bar', () => {
    const at = (context: ContextInput['context']) => evaluateMlbAssignmentContext(base({ context, currentLevel: readiness(), experience: null })).readiness.required;
    expect(at('short_bullpen')).toBe(64);
    expect(at('temporary_depth')).toBe(66);
    expect(at('spot_start')).toBe(68);
  });

  it('is not a way around the durable role: durable_role is not evaluated here', () => {
    expect(() => evaluateMlbAssignmentContext(base({ context: 'durable_role' }))).toThrow(/existing AAA-to-MLB evaluation/);
  });

  it('a context that does not fit the player is not defensible', () => {
    const a = evaluateMlbAssignmentContext(base({ context: 'bench_role', kind: 'pitcher' }));
    expect(a.judgment).toBe('indefensible');
    expect(a.blockers.join(' ')).toMatch(/not an assignment for a pitcher/);
  });
});

describe('stakes drive it, not a prospect/veteran switch', () => {
  it('gives a core prospect no relief in any context', () => {
    for (const context of ['temporary_depth', 'short_bullpen', 'spot_start'] as const) {
      const a = evaluateMlbAssignmentContext(base({ context, ...prospect, currentLevel: readiness(), experience: { plateAppearances: 0, inningsPitched: 400 } }));
      expect(a.stakes).toMatchObject({ tier: 'core_prospect', weight: STAKES_WEIGHT.core_prospect });
      expect(a.readiness.relief).toBe(0);
      expect(a.readiness.required).toBe(80);
    }
  });

  it('a prospect who is ready anyway is defensible; one who is not is indefensible however much experience he has', () => {
    const ready = evaluateMlbAssignmentContext(base({ ...prospect, currentLevel: readiness({ readiness: 85, readinessRange: { min: 85, max: 85 } }), experience: null }));
    expect(ready.judgment).toBe('defensible');
    const not = evaluateMlbAssignmentContext(base({ ...prospect, currentLevel: readiness(), experience: { plateAppearances: 0, inningsPitched: 400 } }));
    expect(not.judgment).toBe('indefensible');
    expect(not.routes).toEqual({ production: 'not_satisfied', established: 'not_satisfied' });
  });

  it('relief shrinks continuously with stakes: a development-priority player keeps half', () => {
    const mid = { age: 24, ability: syntheticScoutedAbility({ current: 45, potential: 58, kind: 'pitcher' }) };
    const a = evaluateMlbAssignmentContext(base({ ...mid, currentLevel: readiness(), experience: null }));
    expect(a.stakes.weight).toBeGreaterThan(0);
    expect(a.stakes.weight).toBeLessThan(1);
    expect(a.readiness.relief).toBeLessThan(12);
    expect(a.readiness.relief).toBeGreaterThan(0);
  });
});

describe('the established route', () => {
  it('lets substantial upper-level experience carry a low-stakes player with no current-level sample', () => {
    const a = evaluateMlbAssignmentContext(base({ currentLevel: null, experience: { plateAppearances: 0, inningsPitched: 220 } }));
    expect(a.routes).toMatchObject({ production: 'unknown', established: 'satisfied' });
    expect(a.judgment).toBe('defensible');
    expect(a.reasons.join(' ')).toMatch(/Established: 220 IP/);
  });

  it('limited experience with no production evidence cannot be established, and is not a rejection', () => {
    const a = evaluateMlbAssignmentContext(base({ currentLevel: null, experience: { plateAppearances: 0, inningsPitched: 20 } }));
    expect(a.judgment).toBe('indeterminate');
    expect(a.blockers).toEqual([]);
  });

  it('experience alone never establishes a high-stakes player', () => {
    const a = evaluateMlbAssignmentContext(base({ ...prospect, currentLevel: null, experience: { plateAppearances: 0, inningsPitched: 500 } }));
    expect(a.routes.established).toBe('not_satisfied');
    expect(a.judgment).not.toBe('defensible');
  });

  it('hitters use plate appearances and their own minimums', () => {
    const hitter = { context: 'bench_role' as const, kind: 'hitter' as const, age: 32, ability: syntheticScoutedAbility({ current: 30, potential: 30 }) };
    expect(evaluateMlbAssignmentContext(base({ ...hitter, experience: { plateAppearances: 400, inningsPitched: 0 } })).judgment).toBe('defensible');
    expect(evaluateMlbAssignmentContext(base({ ...hitter, experience: { plateAppearances: 120, inningsPitched: 0 } })).judgment).toBe('indeterminate');
  });
});

describe('unknown stays unknown', () => {
  it('missing visible ratings leave it indeterminate and name what is missing', () => {
    const a = evaluateMlbAssignmentContext(base({ ...unknownRatings, currentLevel: null, experience: { plateAppearances: 0, inningsPitched: 300 } }));
    expect(a.judgment).toBe('indeterminate');
    expect(a.stakes).toMatchObject({ tier: null, weight: null });
    expect(a.missingEvidence.map((m) => m.dimension)).toEqual(expect.arrayContaining(['current_ability', 'potential_ability']));
  });

  it('a known negative still stands when something else is unknown', () => {
    const a = evaluateMlbAssignmentContext(base({ context: 'bench_role', kind: 'pitcher', ...unknownRatings }));
    expect(a.judgment).toBe('indefensible');
  });

  it('missing career statistics are unknown experience, not zero', () => {
    const a = evaluateMlbAssignmentContext(base({ currentLevel: null, experience: null }));
    expect(a.experience).toBeNull();
    expect(a.judgment).toBe('indeterminate');
    expect(a.constraints.find((c) => c.id === 'readiness_for_context')?.detail).toMatch(/No career statistics are exported/);
  });

  it('insufficient current-level sample is not production evidence', () => {
    const a = evaluateMlbAssignmentContext(base({ currentLevel: readiness({ sampleConfidence: 30 }), experience: null }));
    expect(a.routes.production).toBe('unknown');
    expect(a.judgment).toBe('indeterminate');
  });

  it('an unknown age leaves the stakes unknown rather than assumed', () => {
    const a = evaluateMlbAssignmentContext(base({ age: null, currentLevel: readiness(), experience: null }));
    expect(a.stakes.tier).toBeNull();
    expect(a.judgment).toBe('indeterminate');
  });
});

describe('boundaries', () => {
  it('has a profile for every context and takes no philosophy', () => {
    expect(Object.keys(CONTEXT_PROFILES).sort()).toEqual(['bench_role', 'durable_role', 'short_bullpen', 'spot_start', 'temporary_depth']);
    expect(evaluateMlbAssignmentContext.length).toBe(1);
  });

  it('every assessment says its relief and experience figures are provisional calibration', () => {
    const a = evaluateMlbAssignmentContext(base({}));
    expect(a.calibration).toBe(CALIBRATION_STATUS);
    expect(a.calibration.status).toBe('provisional');
    expect(a.calibration.note).toMatch(/not established baseball facts/);
  });

  it('the calibration numbers are declared once, in this module, and are not repeated elsewhere', () => {
    const dir = path.resolve(__dirname, '../server');
    const names = /\b(readinessRelief|establishedExperience|STAKES_WEIGHT|LOW_STAKES_WEIGHT|PRODUCTION_SAMPLE_MINIMUM)\b/;
    const offenders = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && f !== 'mlbAssignmentContext.ts')
      .filter((f) => names.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
