import fs from 'node:fs';
import path from 'node:path';
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
import { expressAssignmentPreference } from '../server/assignmentPreference.js';
import { syntheticScoutedAbility } from '../server/scoutedEvidence.js';

/**
 * The authority boundary between Player Development and Organizational
 * Philosophy.
 *
 * Player Development decides which assignments are developmentally defensible,
 * from evidence and baseball-development rules alone. Philosophy then says which
 * of the DEFENSIBLE ones the organization prefers. It cannot change whether an
 * assignment is defensible, in either direction, and cannot resolve missing
 * evidence.
 */

const PHILOSOPHIES = [0, 15, 25, 35, 50, 65, 75, 85, 100];

const at = (level: number, name: string, isMajorLeague = false): ProspectNextAssignment => ({
  level, levelName: name, teams: [{ teamId: level * 10, label: `${name} Club` }], isMajorLeague,
});
const A = at(4, 'A');
const AA = at(3, 'AA');
const AAA = at(2, 'AAA');
const MLB = at(1, 'MLB', true);
const R = at(6, 'R');

const ability = (current: number | null, potential: number | null) =>
  syntheticScoutedAbility({ current, potential });

/** Player Development's plan for the evidence: no philosophy is, or can be, supplied. */
function developmentPlan(
  overrides: Partial<ProspectDecisionInput> = {},
  higher: ProspectNextAssignment[] = [A, AA, AAA, MLB]
) {
  const decision = evaluateProspectDecision({
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

  return evaluateProspectAssignments({ decision, higherAssignments: higher, lowerAssignments: [R] });
}

const evaluationOf = (
  plan: { evaluations: ProspectAssignmentEvaluation[] },
  kind: ProspectAssignmentEvaluation['kind'],
  index = 0
) => plan.evaluations.filter((e) => e.kind === kind)[index];

/** Everything about an evaluation except the organization's preference. */
const authorization = (e: ProspectAssignmentEvaluation) => {
  const { preference: _ignored, ...rest } = e;
  return rest;
};

/** The evidence cases the invariants are checked over: clear no, borderline, clear yes, unknown. */
const CASES: Array<[string, Partial<ProspectDecisionInput>]> = [
  ['clearly not ready', { primaryPerformanceDiff: -0.02 }],
  ['borderline', { primaryPerformanceDiff: 0.06 }],
  ['ready', { primaryPerformanceDiff: 0.1 }],
  ['dominant', { primaryPerformanceDiff: 0.2 }],
  ['dominant but immature', { primaryPerformanceDiff: 0.2, ability: ability(30, 70) }],
  ['struggling', { primaryPerformanceDiff: -0.2, pa: 200 }],
  ['ready, ratings unknown', { ability: ability(null, null) }],
  ['dominant, ratings unknown', { primaryPerformanceDiff: 0.2, ability: ability(null, null) }],
  ['thin sample', { pa: 60, primaryPerformanceDiff: 0.2 }],
  ['young for the level', { ageDiff: 3, primaryPerformanceDiff: 0.1 }],
];

describe('developmental defensibility is invariant across philosophies', () => {
  it.each(CASES)('%s: every philosophy sees the same authorization', (_name, overrides) => {
    const plan = developmentPlan(overrides);
    const baseline = plan.evaluations.map(authorization);

    for (const aggressiveness of PHILOSOPHIES) {
      const expressed = expressAssignmentPreference(plan, aggressiveness);
      // Judgment, eligibility, constraints, blockers, reasons and requirements are untouched
      expect(expressed.evaluations.map(authorization), `aggressiveness ${aggressiveness}`).toEqual(baseline);
      expect(expressed.eligible.map((e) => e.kind), `aggressiveness ${aggressiveness}`)
        .toEqual(plan.eligible.map((e) => e.kind));
      expect(expressed.indeterminate.map((e) => e.kind), `aggressiveness ${aggressiveness}`)
        .toEqual(plan.indeterminate.map((e) => e.kind));
    }
  });

  it('gives Player Development no way to be handed a philosophy', () => {
    const plan = developmentPlan();
    const withExtra = developmentPlan({ promotionAggressiveness: 100 } as Partial<ProspectDecisionInput>);
    expect(withExtra.evaluations.map(authorization)).toEqual(plan.evaluations.map(authorization));
  });
});

describe('philosophy cannot authorize an indefensible assignment', () => {
  it('leaves a player who is clearly not ready indefensible under every philosophy', () => {
    const plan = developmentPlan({ primaryPerformanceDiff: -0.02 });
    for (const aggressiveness of PHILOSOPHIES) {
      const expressed = expressAssignmentPreference(plan, aggressiveness);
      for (const kind of ['normal_promotion', 'skip_level_promotion'] as const) {
        const e = evaluationOf(expressed, kind);
        expect(e.judgment, `${kind} @ ${aggressiveness}`).toBe('indefensible');
        expect(e.eligible).toBe(false);
        expect(e.preference, 'an indefensible assignment cannot be preferred').toBeNull();
      }
      expect(expressed.eligible.filter((e) => e.direction === 'promotion')).toEqual([]);
    }
  });

  it('refuses the borderline promotion the old aggressive threshold used to allow', () => {
    // Readiness 71 was defensible for an aggressive organization (threshold 66) and not for a
    // neutral one (76). Defensibility is a property of the evidence, so it is not, for anyone.
    const plan = developmentPlan({ primaryPerformanceDiff: 0.06 });
    expect(evaluationOf(plan, 'normal_promotion').evidence.readiness).toBe(71);
    for (const aggressiveness of PHILOSOPHIES) {
      const e = evaluationOf(expressAssignmentPreference(plan, aggressiveness), 'normal_promotion');
      expect(e.judgment).toBe('indefensible');
      expect(e.blockers.join(' ')).toMatch(/developmental promotion threshold of 76/);
    }
  });

  it('cannot lower the sample requirement, or the maturity requirement for a skip', () => {
    for (const aggressiveness of PHILOSOPHIES) {
      const thin = expressAssignmentPreference(developmentPlan({ pa: 60, primaryPerformanceDiff: 0.2 }), aggressiveness);
      expect(evaluationOf(thin, 'normal_promotion').judgment).toBe('indefensible');
      const immature = expressAssignmentPreference(
        developmentPlan({ primaryPerformanceDiff: 0.2, ability: ability(30, 70) }),
        aggressiveness
      );
      expect(evaluationOf(immature, 'skip_level_promotion').judgment).toBe('indefensible');
    }
  });
});

describe('philosophy cannot make a defensible assignment indefensible', () => {
  it('leaves a ready player defensible even for the most patient organization', () => {
    const plan = developmentPlan({ primaryPerformanceDiff: 0.1 });
    expect(evaluationOf(plan, 'normal_promotion').judgment).toBe('defensible');
    const patient = expressAssignmentPreference(plan, 0);
    const normal = evaluationOf(patient, 'normal_promotion');
    expect(normal.judgment).toBe('defensible');
    expect(normal.eligible).toBe(true);
    expect(normal.blockers).toEqual([]);
    expect(patient.eligible.map((e) => e.kind)).toContain('normal_promotion');
  });

  it('keeps every defensible assignment defensible however far down the preference it sits', () => {
    const plan = developmentPlan({ primaryPerformanceDiff: 0.2 }, [AA, AAA]);
    const patient = expressAssignmentPreference(plan, 0);
    const skip = evaluationOf(patient, 'skip_level_promotion');
    expect(skip.preference).toBe('disfavored');
    expect(skip.judgment).toBe('defensible');
    expect(skip.eligible).toBe(true);
    expect(patient.eligible.map((e) => e.kind)).toContain('skip_level_promotion');
  });
});

describe('philosophy cannot resolve an indeterminate assignment', () => {
  it('leaves it indeterminate, unranked and unpreferred under every philosophy', () => {
    const plan = developmentPlan({ ability: ability(null, null), primaryPerformanceDiff: 0.152 });
    for (const aggressiveness of PHILOSOPHIES) {
      const expressed = expressAssignmentPreference(plan, aggressiveness);
      const normal = evaluationOf(expressed, 'normal_promotion');
      expect(normal.judgment, `aggressiveness ${aggressiveness}`).toBe('indeterminate');
      expect(normal.eligible).toBe(false);
      expect(normal.preference).toBeNull();
      expect(expressed.eligible.filter((e) => e.direction === 'promotion')).toEqual([]);
      expect(expressed.preference.preferred).toBeNull();
      expect(expressed.preference.notes.join(' ')).toMatch(/cannot resolve missing evidence/);
    }
  });

  it('does not treat "stay" as the answer to missing evidence', () => {
    const expressed = expressAssignmentPreference(
      developmentPlan({ ability: ability(null, null), primaryPerformanceDiff: 0.152 }),
      0
    );
    // A patient organization does not get to read an unknown as "keep him where he is"
    expect(expressed.preference.preferred).toBeNull();
    expect(expressed.preference.options).toEqual([]);
  });

  it('ranks the defensible assignments and leaves the indeterminate one out', () => {
    // Even the least mature possible ratings clear an ordinary promotion for this production,
    // but a skip-level move needs ratings that are not known
    const plan = developmentPlan({ ability: ability(null, null), primaryPerformanceDiff: 0.2 });
    expect(evaluationOf(plan, 'normal_promotion').judgment).toBe('defensible');
    expect(evaluationOf(plan, 'skip_level_promotion').judgment).toBe('indeterminate');

    for (const aggressiveness of PHILOSOPHIES) {
      const expressed = expressAssignmentPreference(plan, aggressiveness);
      expect(evaluationOf(expressed, 'skip_level_promotion').preference).toBeNull();
      expect(evaluationOf(expressed, 'skip_level_promotion').judgment).toBe('indeterminate');
      expect(expressed.preference.options.map((o) => o.kind)).toEqual(['stay', 'normal_promotion']);
    }
  });
});

describe('philosophy chooses among defensible alternatives', () => {
  // This organization's ladder above the player is AA then AAA: a normal promotion and one skip
  const dominant = () => developmentPlan({ primaryPerformanceDiff: 0.2 }, [AA, AAA]);

  it('starts from more than one defensible choice', () => {
    const plan = dominant();
    expect(plan.eligible.map((e) => e.kind)).toEqual(['normal_promotion', 'skip_level_promotion']);
  });

  it('prefers patience, the ordinary promotion, or the skip by aggressiveness', () => {
    const preferred = (a: number) => expressAssignmentPreference(dominant(), a).preference.preferred;
    expect(preferred(0)).toBe('stay');
    expect(preferred(50)).toBe('normal_promotion');
    expect(preferred(100)).toBe('skip_level_promotion');
  });

  it('prefers one level (AA) when patient and the further one (AAA) when aggressive', () => {
    // Two defensible promotion targets; staying is not what the organizations differ over here
    const conservative = expressAssignmentPreference(dominant(), 35);
    const aggressive = expressAssignmentPreference(dominant(), 100);
    expect(evaluationOf(conservative, 'normal_promotion').target.levelName).toBe('AA');
    expect(evaluationOf(aggressive, 'skip_level_promotion').target.levelName).toBe('AAA');
    expect(evaluationOf(conservative, 'normal_promotion').preference).toBe('preferred');
    expect(evaluationOf(conservative, 'skip_level_promotion').preference).toBe('acceptable');
    expect(evaluationOf(aggressive, 'skip_level_promotion').preference).toBe('preferred');
    expect(evaluationOf(aggressive, 'normal_promotion').preference).toBe('acceptable');
    // Both are defensible for both organizations
    for (const expressed of [conservative, aggressive]) {
      expect(expressed.eligible.map((e) => e.kind)).toEqual(['normal_promotion', 'skip_level_promotion']);
    }
  });

  it('prefers more challenging assignments as aggressiveness rises, never fewer', () => {
    const rank = (kind: string | null) =>
      kind === 'stay' ? 0 : kind === 'normal_promotion' ? 1 : kind === 'skip_level_promotion' ? 2 : -1;
    let previous = -1;
    for (let a = 0; a <= 100; a += 5) {
      const current = rank(expressAssignmentPreference(dominant(), a).preference.preferred);
      expect(current, `aggressiveness ${a}`).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('marks exactly one option preferred, its neighbours acceptable, and the rest disfavored', () => {
    const { options } = expressAssignmentPreference(developmentPlan({ primaryPerformanceDiff: 0.2 }, [A, AA, AAA]), 0)
      .preference;
    expect(options.map((o) => o.kind)).toEqual(['stay', 'normal_promotion', 'skip_level_promotion', 'skip_level_promotion']);
    expect(options.map((o) => o.preference)).toEqual(['preferred', 'acceptable', 'disfavored', 'disfavored']);
  });

  it('has no choice to express when nothing is defensible', () => {
    const summary = expressAssignmentPreference(developmentPlan({ primaryPerformanceDiff: -0.02 }), 100).preference;
    expect(summary.preferred).toBeNull();
    expect(summary.options).toEqual([]);
    expect(summary.notes.join(' ')).toMatch(/no choice for philosophy/);
  });

  it('describes the organization\'s stance for the interface', () => {
    const stance = (a: number) => expressAssignmentPreference(dominant(), a).preference.stance;
    expect([stance(0), stance(50), stance(100)]).toEqual(['patience', 'balanced', 'advancement']);
  });
});

describe('skip-level developmental floors are philosophy-independent', () => {
  it('has one requirement for everyone: ten above the developmental threshold, never below 84', () => {
    const plan = developmentPlan({ primaryPerformanceDiff: 0.1 });
    const requirements = evaluationOf(plan, 'skip_level_promotion').requirements;
    expect(requirements.readiness).toBe(86);
    for (const aggressiveness of PHILOSOPHIES) {
      const e = evaluationOf(expressAssignmentPreference(plan, aggressiveness), 'skip_level_promotion');
      expect(e.requirements).toEqual(requirements);
      // Readiness 79 is short of 86 for every organization
      expect(e.judgment).toBe('indefensible');
    }
  });

  it('holds the 84 floor when age lowers the ordinary threshold', () => {
    const older = evaluationOf(developmentPlan({ ageDiff: -5 }), 'skip_level_promotion');
    expect(older.requirements.readiness).toBe(84);
  });

  it('lets philosophy prefer or disfavor a skip only once it is defensible', () => {
    const notYet = expressAssignmentPreference(developmentPlan({ primaryPerformanceDiff: 0.1 }), 100);
    expect(evaluationOf(notYet, 'skip_level_promotion').preference).toBeNull();
    const defensible = expressAssignmentPreference(developmentPlan({ primaryPerformanceDiff: 0.2 }, [AA, AAA]), 100);
    expect(evaluationOf(defensible, 'skip_level_promotion').preference).toBe('preferred');
  });
});

describe('demotion stays with Player Development', () => {
  it('is defensible or not on the evidence, under every philosophy', () => {
    const struggling = developmentPlan({ primaryPerformanceDiff: -0.2, pa: 200 });
    const fine = developmentPlan();
    for (const aggressiveness of PHILOSOPHIES) {
      const demotion = evaluationOf(expressAssignmentPreference(struggling, aggressiveness), 'demotion');
      expect(demotion.judgment).toBe('defensible');
      expect(demotion.eligible).toBe(true);
      expect(evaluationOf(expressAssignmentPreference(fine, aggressiveness), 'demotion').judgment).toBe('indefensible');
    }
  });

  it('is not ranked: no philosophy dimension expresses demotion patience yet', () => {
    const expressed = expressAssignmentPreference(developmentPlan({ primaryPerformanceDiff: -0.2, pa: 200 }), 0);
    expect(evaluationOf(expressed, 'demotion').preference).toBeNull();
    expect(expressed.preference.options).toEqual([]);
  });
});

describe('complete-evidence behavior outside the boundary is unchanged', () => {
  it('reproduces the neutral organization\'s authorization exactly', () => {
    const plan = developmentPlan();
    const normal = evaluationOf(plan, 'normal_promotion');
    expect(normal.judgment).toBe('defensible');
    expect(normal.recommendation).toBe('consider');
    expect(normal.requirements).toEqual({ readiness: 76, performance: null, ratingsMaturity: null, sampleConfidence: 45 });
    expect(evaluationOf(plan, 'skip_level_promotion').requirements).toEqual({
      readiness: 86, performance: 85, ratingsMaturity: 55, sampleConfidence: 70,
    });
    const strong = evaluationOf(developmentPlan({ primaryPerformanceDiff: 0.16 }), 'normal_promotion');
    expect(strong.recommendation).toBe('strong');
  });

  it('never routes MLB through the minor-league skip rules', () => {
    const plan = developmentPlan({ primaryPerformanceDiff: 0.2 }, [A, AA, MLB]);
    const toMlb = evaluationOf(plan, 'skip_level_promotion', 1);
    expect(toMlb.target.isMajorLeague).toBe(true);
    expect(toMlb.judgment).toBe('indefensible');
  });
});

describe('the boundary is structural', () => {
  const SERVER = path.join(process.cwd(), 'server');
  const code = (file: string): string =>
    fs
      .readFileSync(path.join(SERVER, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it.each([
    'prospectDecision.ts',
    'prospectAssignments.ts',
    'destinationFit.ts',
    'developmentFit.ts',
    'developmentJudgment.ts',
    'mlbAssignmentContext.ts',
    'roleReview.ts',
    'roleStanding.ts',
    'platoon.ts',
    'lineupPicture.ts',
    'resultsMetrics.ts',
    'rosterScenario.ts',
    'toolsModel.ts',
    'calibration.ts',
    'bullpenRoles.ts',
    'benchReview.ts',
    'lineupShifts.ts',
  ])('%s cannot see Organizational Philosophy', (file) => {
    const source = code(file);
    expect(source, file).not.toMatch(/philosoph/i);
    expect(source, file).not.toMatch(/aggressiv/i);
    expect(source, file).not.toMatch(/from '\.\/settings\.js'/);
  });

  it('the staff preference module leans on advice only: it imports no evaluator, sets no verdict, right or judgment, and reads philosophy as types', () => {
    const source = code('staffPreference.ts');
    // it may not pull in an evaluator whose answer it could then change
    expect(source).not.toMatch(/from '\.\/(roleReview|platoon|resultsMetrics|playerRights|org|destinationFit|mlb[A-Za-z]*)\.js'/);
    expect(source).toMatch(/import type \{ PhilosophyDimensionId \} from '\.\/philosophy\.js'/);
    // it never assigns a verdict, a right, an eligibility or a judgment
    expect(source).not.toMatch(/\b(verdict|judgment|eligible|blockers|constraints|estimate)\s*[:=]\s*['{\[0-9]/);
    expect(source).not.toMatch(/\.run\(|\.prepare\(|INSERT|UPDATE /);
  });

  it('keeps the preference module downstream of authorization and unable to change a judgment', () => {
    const source = code('assignmentPreference.ts');
    expect(source).toMatch(/judgment === 'defensible'/);
    // It never assigns to a judgment, eligibility flag, constraint or blocker
    expect(source).not.toMatch(/judgment\s*[:=]\s*'/);
    expect(source).not.toMatch(/eligible\s*:\s*(true|false)/);
    expect(source).not.toMatch(/blockers\s*:/);
    expect(source).not.toMatch(/constraints\s*:/);
  });
});
