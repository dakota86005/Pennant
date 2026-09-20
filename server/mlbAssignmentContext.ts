/**
 * Player Development: is a specific KIND of major-league assignment
 * developmentally defensible for this player?
 *
 * The existing AAA-to-MLB assessment (`prospectAssignments.ts`, kind
 * `mlb_discussion`) answers one question: is he ready for the major leagues as
 * a durable role? That is the wrong question for an injury fill-in. Sending a
 * 31-year-old Triple-A arm up for one start and promoting a top prospect into
 * the rotation are different developmental acts, and a single readiness bar
 * called the first "not defensible" for the same reason it rejects the second.
 *
 * This capability keeps the authority with Player Development and makes the
 * contemplated ASSIGNMENT CONTEXT part of the question. It is not a bypass and
 * not a "prospect versus veteran" switch:
 *
 *   durable_role      the existing gate, unchanged.
 *   temporary_depth   narrowly bounded coverage of a role for a stretch.
 *   bench_role        a hitter used sparingly.
 *   short_bullpen     a reliever in a short assignment.
 *   spot_start        a single start.
 *
 * For a temporary context the readiness the durable role demands is RELIEVED by
 * an amount that depends on the exposure of the context and is shrunk by the
 * developmental STAKES: the player's protection tier from visible current and
 * potential ratings and age (`developmentFit.ts`). A core prospect gets no relief
 * in any context; an organizational-depth player gets all of it. Stakes are
 * continuous, so nobody is waived for being a veteran: he simply has less at
 * stake, and the evidence still has to establish the assignment.
 *
 * Two routes can establish a temporary assignment, and both are evidence:
 *
 *   production   current-level performance and ability give a readiness that
 *                clears the (relieved) bar, with enough sample.
 *   established  substantial upper-level (Triple-A and MLB) experience, and
 *                stakes low enough that development is not what is at issue.
 *
 * Unknown stays unknown (D-018): missing visible ratings, missing career data,
 * or no production evidence and no established route leave the assessment
 * `indeterminate`, never defensible. Organizational Philosophy never enters
 * (D-019).
 *
 * TWO KINDS OF THING LIVE IN THIS FILE, AND THEY ARE NOT EQUALLY FIRM
 *
 *   Durable architecture rules (change only by a decision, D-025/D-027):
 *     - Player Development owns the judgment; nothing else in the application
 *       holds a developmental threshold.
 *     - A core prospect gets no relief in any context.
 *     - Experience alone never establishes a high-stakes player; it may establish
 *       a low-stakes one only together with a sample large enough for the context.
 *     - Unknown evidence stays unknown. Unknown DURATION stays unknown too:
 *       `resolveAcrossDurations` asks about each context that could apply and says
 *       whether the answer depends on how long the player would be needed.
 *
 *   Provisional calibration parameters (numbers, not baseball truths):
 *     - `readinessRelief` and `establishedExperience` per context in
 *       `CONTEXT_PROFILES`, `STAKES_WEIGHT`, `LOW_STAKES_WEIGHT` and
 *       `PRODUCTION_SAMPLE_MINIMUM`. They were chosen as a first pass, reviewed
 *       against real-save outputs (docs/MLB_OPERATIONS.md section 23) and not
 *       fitted to anything. They are declared once, here, and nowhere else in the
 *       application; every assessment says they are provisional.
 */

import type { DevelopmentProtectionTier } from './developmentFit.js';
import { evaluateDevelopmentProtection } from './developmentFit.js';
import {
  atLeast, judgmentOf, missingAbilityEvidence,
  type ConstraintState, type DevelopmentalJudgment, type MissingEvidence, type ValueRange,
} from './developmentJudgment.js';
import type { ScoutedAbility } from './scoutedEvidence.js';

export type MlbAssignmentContext =
  | 'durable_role'
  | 'temporary_depth'
  | 'bench_role'
  | 'short_bullpen'
  | 'spot_start';

/** Every numeric figure below this line and in `STAKES_WEIGHT` / `LOW_STAKES_WEIGHT` / `PRODUCTION_SAMPLE_MINIMUM` is a calibration parameter. */
export const CALIBRATION_STATUS = {
  status: 'provisional' as const,
  note: 'The relief and experience figures are provisional calibration parameters, not established baseball facts; they live in mlbAssignmentContext.ts and are meant to be tuned against outcomes.',
};

export interface ContextProfile {
  label: string;
  temporary: boolean;
  kinds: Array<'hitter' | 'pitcher'>;
  /** PROVISIONAL CALIBRATION. Readiness points a temporary context takes off the durable bar, before stakes shrink it. */
  readinessRelief: number;
  /**
   * PROVISIONAL CALIBRATION. Upper-level (Triple-A + MLB) career volume that counts as established: plate appearances /
   * innings, roughly a full Triple-A season for a context that asks a player to carry a role
   * and about half of one for a short assignment.
   */
  establishedExperience: { hitter: number; pitcher: number };
}

export const CONTEXT_PROFILES: Record<MlbAssignmentContext, ContextProfile> = {
  durable_role: { label: 'Durable major-league role', temporary: false, kinds: ['hitter', 'pitcher'], readinessRelief: 0, establishedExperience: { hitter: 0, pitcher: 0 } },
  temporary_depth: { label: 'Temporary major-league depth', temporary: true, kinds: ['hitter', 'pitcher'], readinessRelief: 14, establishedExperience: { hitter: 400, pitcher: 150 } },
  bench_role: { label: 'Bench role', temporary: true, kinds: ['hitter'], readinessRelief: 16, establishedExperience: { hitter: 250, pitcher: 0 } },
  short_bullpen: { label: 'Short bullpen assignment', temporary: true, kinds: ['pitcher'], readinessRelief: 16, establishedExperience: { hitter: 0, pitcher: 60 } },
  spot_start: { label: 'Spot start', temporary: true, kinds: ['pitcher'], readinessRelief: 12, establishedExperience: { hitter: 0, pitcher: 150 } },
};

/**
 * How much of a context's relief a protection tier gives up: 0 keeps all of it, 1 keeps none.
 * The ORDER is an architecture rule (more protected, less relief; a core prospect none). The
 * intermediate weights are provisional calibration.
 */
export const STAKES_WEIGHT: Record<DevelopmentProtectionTier, number> = {
  core_prospect: 1,
  protected_prospect: 0.75,
  development_priority: 0.5,
  normal: 0.25,
  organizational_depth: 0,
};

/** PROVISIONAL CALIBRATION. Stakes at or below this weight are low enough for established experience to carry a temporary assignment (with a large enough sample). */
export const LOW_STAKES_WEIGHT = 0.25;
/** PROVISIONAL CALIBRATION. Current-level evidence confidence the durable assessment requires; a temporary assessment asks no less of production evidence. */
export const PRODUCTION_SAMPLE_MINIMUM = 45;

export interface UpperLevelExperience {
  /** Career plate appearances at Triple-A and in the majors. */
  plateAppearances: number;
  /** Career innings pitched at Triple-A and in the majors. */
  inningsPitched: number;
}

/** What the durable assessment already computed for a player with enough current-level production. */
export interface CurrentLevelReadiness {
  readiness: number | null;
  readinessRange: ValueRange;
  sampleConfidence: number;
  /** The durable promotion threshold for this player (76, moved by age and level). */
  promotionThreshold: number;
}

export interface ContextInput {
  context: MlbAssignmentContext;
  kind: 'hitter' | 'pitcher';
  age: number | null;
  ability: ScoutedAbility;
  /** Objective career volume; null when the export carries no career statistics. */
  experience: UpperLevelExperience | null;
  currentLevel: CurrentLevelReadiness | null;
}

export interface ContextConstraint {
  id: 'context_scope' | 'stakes' | 'readiness_for_context';
  label: string;
  state: ConstraintState;
  requiresSubjectiveEvidence: boolean;
  detail: string;
}

export interface ContextAssessment {
  context: MlbAssignmentContext;
  contextLabel: string;
  judgment: DevelopmentalJudgment;
  eligible: boolean;
  reasons: string[];
  blockers: string[];
  missingEvidence: MissingEvidence[];
  constraints: ContextConstraint[];
  stakes: { tier: DevelopmentProtectionTier | null; score: number | null; weight: number | null };
  /** The bar this context sets, and the durable bar it was taken from. */
  readiness: { required: number | null; durable: number | null; relief: number | null; current: number | null };
  routes: { production: ConstraintState; established: ConstraintState };
  experience: UpperLevelExperience | null;
  calibration: typeof CALIBRATION_STATUS;
}

const rounded = (n: number) => Math.round(n * 10) / 10;

/**
 * Judge a TEMPORARY context. `durable_role` is not evaluated here: it is the
 * existing assessment, and asking for it through this function is an error.
 */
export function evaluateMlbAssignmentContext(input: ContextInput): ContextAssessment {
  const profile = CONTEXT_PROFILES[input.context];
  if (!profile.temporary) {
    throw new Error('durable_role is assessed by the existing AAA-to-MLB evaluation, not by the contextual pathway.');
  }
  const constraints: ContextConstraint[] = [];
  const reasons: string[] = [];

  const applies = profile.kinds.includes(input.kind);
  constraints.push({
    id: 'context_scope', label: 'Context fits the player', requiresSubjectiveEvidence: false,
    state: applies ? 'satisfied' : 'not_satisfied',
    detail: applies ? `${profile.label} applies to a ${input.kind}.` : `${profile.label} is not an assignment for a ${input.kind}.`,
  });

  // Stakes need age as well as visible ratings; an unknown age leaves them unknown rather than assumed.
  const protection = input.age === null
    ? { tier: null, score: null }
    : evaluateDevelopmentProtection({ age: input.age, ability: input.ability });
  const known = protection.tier !== null && protection.score !== null;
  const weight = known ? STAKES_WEIGHT[protection.tier as DevelopmentProtectionTier] : null;
  constraints.push({
    id: 'stakes', label: 'Developmental stakes established', requiresSubjectiveEvidence: true,
    state: known ? 'satisfied' : 'unknown',
    detail: known
      ? `Development protection tier ${protection.tier} (score ${protection.score}); ${weight === 0 ? 'little is at stake developmentally' : `${Math.round((weight as number) * 100)}% of the temporary relief is given up`}.`
      : 'Developmental stakes cannot be established: they depend on organization-visible current and potential ratings and age.',
  });

  const durable = input.currentLevel?.promotionThreshold ?? null;
  const relief = weight === null ? null : rounded(profile.readinessRelief * (1 - weight));
  const required = durable === null || relief === null ? null : rounded(durable - relief);

  // Route A: current-level production and ability, against the relieved bar.
  const cl = input.currentLevel;
  let production: ConstraintState = 'unknown';
  if (cl && cl.sampleConfidence >= PRODUCTION_SAMPLE_MINIMUM && required !== null) {
    production = atLeast(cl.readinessRange, required);
  }

  // Route B: established upper-level experience with little at stake.
  const need = input.kind === 'hitter' ? profile.establishedExperience.hitter : profile.establishedExperience.pitcher;
  const volume = input.experience === null ? null : input.kind === 'hitter' ? input.experience.plateAppearances : input.experience.inningsPitched;
  const unit = input.kind === 'hitter' ? 'PA' : 'IP';
  let established: ConstraintState = 'unknown';
  if (volume !== null && weight !== null) {
    established = volume >= need && weight <= LOW_STAKES_WEIGHT ? 'satisfied' : 'not_satisfied';
  }

  const state: ConstraintState =
    production === 'satisfied' || established === 'satisfied' ? 'satisfied'
      : production === 'not_satisfied' && established === 'not_satisfied' ? 'not_satisfied'
        : 'unknown';

  const bits: string[] = [];
  if (cl && cl.sampleConfidence >= PRODUCTION_SAMPLE_MINIMUM && required !== null) {
    bits.push(production === 'satisfied'
      ? `Current-level readiness ${cl.readiness ?? cl.readinessRange.min} clears this context's bar of ${required} (the durable bar is ${durable}).`
      : production === 'not_satisfied'
        ? `Current-level readiness ${cl.readiness ?? `at most ${cl.readinessRange.max}`} is below this context's bar of ${required} (the durable bar is ${durable}).`
        : `Current-level readiness cannot be established against this context's bar of ${required}: it depends on ratings that are unavailable.`);
  } else {
    bits.push('There is not enough current-level production for a readiness judgment.');
  }
  if (volume === null) bits.push('No career statistics are exported, so upper-level experience is unknown.');
  else if (weight === null) bits.push(`He has ${Math.round(volume)} ${unit} at Triple-A and in the majors, but his stakes are unknown.`);
  else if (established === 'satisfied') bits.push(`Established: ${Math.round(volume)} ${unit} at Triple-A and in the majors (${need} needed) with little at stake developmentally.`);
  else if (volume < need) bits.push(`Limited upper-level experience: ${Math.round(volume)} ${unit} against ${need} for this context.`);
  else bits.push(`He has ${Math.round(volume)} ${unit} of upper-level experience, but too much is at stake developmentally for experience alone to establish a ${profile.label.toLowerCase()}.`);

  constraints.push({
    id: 'readiness_for_context', label: `Ready for a ${profile.label.toLowerCase()}`,
    requiresSubjectiveEvidence: production !== 'satisfied' && established !== 'satisfied',
    state, detail: bits.join(' '),
  });

  const judgment = judgmentOf(constraints.map((c) => c.state));
  const blockers = constraints.filter((c) => c.state === 'not_satisfied').map((c) => c.detail);
  if (judgment === 'defensible') reasons.push(...constraints.filter((c) => c.id !== 'context_scope').map((c) => c.detail));
  const ratingsUnknown = constraints.some((c) => c.state === 'unknown' && c.requiresSubjectiveEvidence);
  return {
    context: input.context,
    contextLabel: profile.label,
    judgment,
    eligible: judgment === 'defensible',
    reasons,
    blockers,
    missingEvidence: judgment === 'indeterminate' && ratingsUnknown ? missingAbilityEvidence(input.ability) : [],
    constraints,
    stakes: { tier: protection.tier, score: protection.score, weight },
    readiness: { required, durable, relief, current: cl?.readiness ?? null },
    routes: { production, established },
    experience: input.experience,
    calibration: CALIBRATION_STATUS,
  };
}

// ── unknown duration ────────────────────────────────────────────────────────

/**
 * The answer across durations. It is the D-018 three-state judgment plus one
 * more, `context_dependent`, for a player who is defensible for one kind of
 * assignment and not (or not demonstrably) for another, so the answer turns on
 * how long he would be needed.
 */
export type DurationJudgment = DevelopmentalJudgment | 'context_dependent';

/** Player Development's verdict for ONE context. `assessed` is false when it has not assessed him for it. */
export interface ContextVerdict {
  context: MlbAssignmentContext;
  label: string;
  judgment: DevelopmentalJudgment;
  assessed: boolean;
  reasons: string[];
  blockers: string[];
  missing: string[];
}

export interface DurationAssessment {
  judgment: DurationJudgment;
  /** True only when at least one context is defensible and another is not: the answer changes with the duration. */
  durationMatters: boolean;
  verdicts: ContextVerdict[];
  defensibleIn: MlbAssignmentContext[];
  indefensibleIn: MlbAssignmentContext[];
  undeterminedIn: MlbAssignmentContext[];
  /** The judgment in words, naming the contexts. */
  explanation: string;
  /** What would settle it: the GM's statement of how long he would be needed. Null when duration would not settle it. */
  resolvedBy: string | null;
}

const PHRASE: Record<MlbAssignmentContext, string> = {
  durable_role: 'a durable MLB assignment',
  temporary_depth: 'temporary depth',
  bench_role: 'a bench role',
  short_bullpen: 'a short bullpen assignment',
  spot_start: 'a spot start',
};

const listOf = (contexts: MlbAssignmentContext[]) => {
  const p = contexts.map((c) => PHRASE[c]);
  return p.length <= 1 ? p.join('') : `${p.slice(0, -1).join(', ')} or ${p[p.length - 1]}`;
};

/**
 * Combine Player Development's verdicts for every context that could apply when
 * how long a player would be needed is UNKNOWN. Nothing here supplies a duration.
 *
 *   every context defensible     defensible: duration does not matter
 *   every context indefensible   indefensible: duration does not matter
 *   some defensible, some not    context_dependent: duration decides
 *   none defensible, some unknown indeterminate: not established (D-018); a
 *                                 statement of duration would not settle it
 *
 * "Some not" includes a context that cannot be established, because a player is
 * not shown to be defensible for the longer assignment just because the shorter
 * one is. Such a player is never presented as open until a duration is chosen.
 */
export function resolveAcrossDurations(verdicts: ContextVerdict[]): DurationAssessment {
  const defensibleIn = verdicts.filter((v) => v.judgment === 'defensible').map((v) => v.context);
  const indefensibleIn = verdicts.filter((v) => v.judgment === 'indefensible').map((v) => v.context);
  const undeterminedIn = verdicts.filter((v) => v.judgment === 'indeterminate').map((v) => v.context);
  const base = { verdicts, defensibleIn, indefensibleIn, undeterminedIn };

  if (verdicts.length > 0 && defensibleIn.length === verdicts.length) {
    return {
      ...base, judgment: 'defensible', durationMatters: false, resolvedBy: null,
      explanation: `Defensible as ${listOf(defensibleIn)}: the answer does not depend on how long he would be needed.`,
    };
  }
  if (verdicts.length > 0 && indefensibleIn.length === verdicts.length) {
    return {
      ...base, judgment: 'indefensible', durationMatters: false, resolvedBy: null,
      explanation: `Not defensible as ${listOf(indefensibleIn)}: the answer does not depend on how long he would be needed.`,
    };
  }
  if (defensibleIn.length > 0) {
    const against = [
      ...(indefensibleIn.length ? [`not defensible as ${listOf(indefensibleIn)}`] : []),
      ...(undeterminedIn.length ? [`not established as ${listOf(undeterminedIn)}`] : []),
    ].join(' and ');
    return {
      ...base, judgment: 'context_dependent', durationMatters: true,
      explanation: `Defensible as ${listOf(defensibleIn)}, but ${against}. Expected absence duration is not known.`,
      resolvedBy: 'Choose the assignment that matches how long he would be needed, or wait until the return date is known.',
    };
  }
  return {
    ...base, judgment: 'indeterminate', durationMatters: false, resolvedBy: null,
    explanation: `Player Development cannot establish ${listOf(undeterminedIn.length ? undeterminedIn : verdicts.map((v) => v.context))}${indefensibleIn.length ? `, and he is not defensible as ${listOf(indefensibleIn)}` : ''}. This is missing evidence, not a question of duration.`,
  };
}
