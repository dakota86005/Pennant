/**
 * Player Development: how high are the developmental stakes if the organization mishandles this
 * player? (docs/DEVELOPMENTAL_STAKES.md, D-050.)
 *
 * The tier is a statement about unrealized development the organization's own scouting can see, and
 * how much of the time to realize it is left. It is a reason to look harder when a man is not
 * playing, to be slower to use him as temporary major-league cover, and not to treat him as a body.
 * It is NOT whether to promote, demote, start, call up, trade or release him, and it is not a rank,
 * a trade value or a read of how he is hitting: a core prospect can be ready for promotion and an
 * organizational-depth player can be the best man on his club. Organizational depth says his
 * development is no longer what is at stake, not that he is not useful.
 *
 *   CEILING                  the ABSOLUTE anchor. What his organization-visible potential would be
 *                            among major leaguers of his kind: impact, regular, fringe, or below.
 *   DEVELOPMENT REMAINING    the CONTEXT. How much of the development that would realize that ceiling
 *                            is still ahead of him: from his age, shortened when he is behind his
 *                            level's schedule or when what the scouts project has already happened.
 *
 * The tier is the ceiling, lowered one step for each step by which that development has run out.
 *
 * Three rules are architecture, and tests pin them:
 *
 *   * Context may only LOWER what the ceiling allows. Nothing here can raise a ceiling: a weak
 *     cohort cannot manufacture a prospect, a strong one cannot erase one, and youth is not talent.
 *   * Nothing but his own visible ratings, his age and his league's AGE profile is read. No result,
 *     no usage, no roster need, no philosophy (D-019) — so a hot month cannot raise a tier and a cold
 *     one cannot lower it — and no other player's rating.
 *   * Unknown stays unknown (D-018). A missing rating or age leaves the tier null; a missing age
 *     profile leaves the schedule unread and discounts nothing, because missing context may never
 *     lower a man's stakes.
 *
 * There is no score. The model is a lookup on two named readings, both of which are returned.
 *
 * Pure: it opens no table. `developmentalContext.ts` reads the objective context.
 */

import type { EvidenceStatus, ScoutedAbility } from './scoutedEvidence.js';
import { missingAbilityEvidence, type MissingEvidence } from './developmentJudgment.js';
import { policy, provisional, type CalibrationStamp } from './calibration.js';
import { AGE_LEVEL_DEVELOPMENT_LIMIT, OLD_FOR_LEVEL, YOUNG_FOR_LEVEL } from './farmCalibration.js';

export type DevelopmentProtectionTier =
  | 'core_prospect'
  | 'protected_prospect'
  | 'development_priority'
  | 'normal'
  | 'organizational_depth';

/** Least at stake first. The order every consumer means by "or better". */
export const TIER_ORDER: readonly DevelopmentProtectionTier[] = [
  'organizational_depth',
  'normal',
  'development_priority',
  'protected_prospect',
  'core_prospect',
];

/* ── calibration: every number in the stakes model, declared once ────────────────────────────── */

export const CEILING_LINES_CALIBRATION: CalibrationStamp = provisional(
  'Where a visible potential composite stops projecting as a major leaguer of each kind. The composite ' +
    '(the unweighted mean of the visible tools) of the weakest tenth, the median and the best tenth of ' +
    'the active major leaguers of one import: hitters 45 / 50 / 56, pitchers 45 / 48 / 53. Kind-aware ' +
    'because the composite is: with the hitters\' lines no pitcher in that league was a core prospect. A ' +
    'model parameter that ought to be re-estimated across saves; `npm run stakes:report` re-measures it.'
);

export const CEILING_QUANTILES_CALIBRATION: CalibrationStamp = policy(
  'What "a major leaguer", "a regular" and "an impact player" are taken to mean: clearing the weakest ' +
    'tenth, the median and the best tenth of major leaguers of his kind. A decision about where a ' +
    'ceiling starts to be worth protecting, not a fact about baseball.'
);

/** The potential composite (20-80) at which each ceiling begins, by kind. */
export const CEILING_LINES = {
  hitter: { fringe: 45, regular: 50, impact: 56 },
  pitcher: { fringe: 45, regular: 48, impact: 53 },
} as const;

export const DEVELOPMENT_AGE_CALIBRATION: CalibrationStamp = provisional(
  'The age through which most, some and little of a player\'s development is still ahead of him. The ' +
    'bands of the youth curve the absolute composite used (72 or more through 22, 45 to 60 at 23-24, ' +
    '18 to 30 at 25-26, 5 from 27), so the historical judgment about youth is kept and only its use ' +
    'changed. Not fitted: a development path needs the same players\' ratings a season apart (300 snapshot ' +
    'pairs, as Player Value\'s path does), and the Arizona save holds one snapshot. Its cross-section agrees ' +
    'with the bands\' end: the scouted gap closes between 24 and 26.'
);

/** Through this age, inclusive. From `little` + 1 on, none of it is ahead of him. */
export const DEVELOPMENT_AGE = { most: 22, some: 24, little: 26 } as const;

export const PROJECTION_CALIBRATION: CalibrationStamp = provisional(
  'Points of potential over current under which what the scouts project has, in effect, happened. ' +
    'With tools graded in steps of five, a gap under three composite points is at most two tool grades in five for a hitter ' +
    'and at most one in three for a pitcher. How much projection counts as none is a policy line; not fitted.'
);

export const PROJECTION_REALIZED_UNDER = 3;

/** Every stakes constant with its stamp, for a response that reports what it used. */
export const STAKES_CALIBRATION: ReadonlyArray<{ name: string; value: unknown; stamp: CalibrationStamp }> = [
  { name: 'CEILING_LINES', value: CEILING_LINES, stamp: CEILING_LINES_CALIBRATION },
  { name: 'CEILING_LINES (the quantiles they stand for)', value: 'p10 / p50 / p90 of major leaguers of his kind', stamp: CEILING_QUANTILES_CALIBRATION },
  { name: 'DEVELOPMENT_AGE', value: DEVELOPMENT_AGE, stamp: DEVELOPMENT_AGE_CALIBRATION },
  { name: 'PROJECTION_REALIZED_UNDER', value: PROJECTION_REALIZED_UNDER, stamp: PROJECTION_CALIBRATION },
];

/* ── the two readings ────────────────────────────────────────────────────────────────────────── */

/** What his visible potential would be among major leaguers of his kind. The absolute anchor. */
export type CeilingBand = 'impact' | 'regular' | 'fringe' | 'below_major_league';

/** How much of the development that would realize his ceiling is still ahead of him. */
export type DevelopmentRemaining = 'most' | 'some' | 'little' | 'none';

/** Where his age puts him against the rostered players of his own league. */
export type LevelSchedule =
  /** Notably younger than his level. Reported; it raises nothing. */
  | 'young_for_level'
  | 'on_schedule'
  /** Notably older than his level (`OLD_FOR_LEVEL`). */
  | 'behind'
  /** Far enough past it that the level is no longer primarily developmental (`AGE_LEVEL_DEVELOPMENT_LIMIT`). */
  | 'far_behind'
  /** No level context was supplied, or his level's age profile could not be read. Nothing is discounted. */
  | 'not_established';

/**
 * The objective developmental context of one player: where he is, and how old the rostered players
 * of that league are. Facts from the save, never a rating and never another player's ability.
 * `developmentalContext.ts` builds it; tests may build one by hand.
 */
export interface DevelopmentalContext {
  level: number;
  levelName: string;
  leagueName: string | null;

  /**
   * The rostered average age of his league at his level, minus his: positive is younger than his
   * level. null when that age profile could not be established.
   */
  ageRelativeToLevel: number | null;

  /** What the average was taken over, so a thin league is never read as a precise one. */
  ageProfile: {
    scope: 'league' | 'level' | 'unavailable';
    players: number;
    averageAge: number | null;
  };
}

/** The parts the tier was composed from. Inspectable: no number here means anything on its own. */
export interface StakesReading {
  ceiling: {
    band: CeilingBand;
    kind: 'hitter' | 'pitcher';
    potential: number;
    /** The line his potential cleared, and the next one it did not; null past either end. */
    cleared: number | null;
    next: number | null;
  };

  remaining: {
    state: DevelopmentRemaining;
    /** What his age alone says. */
    byAge: DevelopmentRemaining;
    schedule: LevelSchedule;
    /** The most his level's schedule allows, when it says anything. */
    scheduleLimit: DevelopmentRemaining | null;
    projection: { gap: number; realized: boolean };
    /** Which readings decided `state`: age always reads; the others only when they shortened it. */
    boundBy: Array<'age' | 'schedule' | 'projection'>;
  };

  /**
   * What the absolute-scale composite this model replaced would have said, and why it differs, so a
   * re-tiering can be explained. It decides nothing.
   */
  supersededComposite: { tier: DevelopmentProtectionTier; differs: string | null };
}

/**
 * An age the export states, or null. `Number(null)` is 0, and 0 read as "most of his development ahead
 * of him" would give a firm tier to a man whose age is not known, so anything that is not a finite
 * positive number is unknown. Every caller passes the age as the export has it and lets this decide.
 */
export function knownAge(age: number | null | undefined): number | null {
  return typeof age === 'number' && Number.isFinite(age) && age > 0 ? age : null;
}

export interface DevelopmentProtectionInput {
  /** His age as the export has it; null or anything that is not an age leaves the tier indeterminate. */
  age: number | null | undefined;

  /**
   * The organization-visible ability evidence, from the scouted-evidence
   * adapter. A bare rating cannot be passed here, so protection cannot be
   * computed from a source the evidence boundary has not approved.
   */
  ability: ScoutedAbility;

  /**
   * Where he is and how old his league is. null or absent when the caller cannot say: his level's
   * schedule is then not read and nothing is discounted for it.
   */
  context?: DevelopmentalContext | null;

  /**
   * Reserved for the future manual "protect this player" control.
   * The optimizer must never override this.
   */
  manuallyProtected?: boolean;
}

export interface DevelopmentProtection {
  /**
   * null (indeterminate) when the organization-visible ratings, or his age, are not known. No neutral
   * value is substituted: an unknown rating is unknown, not average.
   */
  tier: DevelopmentProtectionTier | null;

  manuallyProtected: boolean;

  /** Whether the ratings behind the tier were fully known. */
  ratingEvidence: EvidenceStatus;

  /** What is missing when `tier` is null. */
  missingEvidence: MissingEvidence[];

  /** Why, in the order a person would say it: the ceiling, then what is left of his development. */
  reasons: string[];

  /** The readings the tier was composed from. null when the tier is, or when it was set by hand. */
  reading: StakesReading | null;
}

/** A protection whose tier was established from complete evidence. */
export type KnownProtection = DevelopmentProtection & {
  tier: DevelopmentProtectionTier;
};

export function hasKnownTier(
  protection: DevelopmentProtection
): protection is KnownProtection {
  return protection.tier !== null;
}

/**
 * For code that has already set indeterminate players aside. Reaching it with
 * an unknown tier is a bug, and it throws rather than pick a tier.
 */
export function requireKnownProtection(
  protection: DevelopmentProtection
): KnownProtection {
  if (!hasKnownTier(protection)) {
    throw new Error(
      'Indeterminate development protection reached a ranking that requires a known tier.'
    );
  }

  return protection;
}

/* ── the ceiling: the absolute anchor ────────────────────────────────────────────────────────── */

const CEILING_RANK: Record<CeilingBand, number> = { below_major_league: 0, fringe: 1, regular: 2, impact: 3 };
const REMAINING_STEPS: Record<DevelopmentRemaining, number> = { most: 0, some: 1, little: 2, none: 3 };
const REMAINING_ORDER: readonly DevelopmentRemaining[] = ['most', 'some', 'little', 'none'];

/** The one with less development left. */
const lessRemaining = (a: DevelopmentRemaining, b: DevelopmentRemaining): DevelopmentRemaining =>
  REMAINING_STEPS[a] >= REMAINING_STEPS[b] ? a : b;

const oneStepLess = (state: DevelopmentRemaining): DevelopmentRemaining =>
  REMAINING_ORDER[Math.min(REMAINING_ORDER.length - 1, REMAINING_STEPS[state] + 1)];

/**
 * What a visible potential composite would be among major leaguers of his kind.
 *
 * Read from his own rating against fixed lines, never against the players around him, so no other
 * player's rating — a weak league, a strong one, a man promoted past him — can move it.
 */
export function ceilingOf(kind: ScoutedAbility['kind'], potential: number): StakesReading['ceiling'] {
  const lineKind: 'hitter' | 'pitcher' = kind === 'pitcher' ? 'pitcher' : 'hitter';
  const lines = CEILING_LINES[lineKind];
  if (potential >= lines.impact) return { band: 'impact', kind: lineKind, potential, cleared: lines.impact, next: null };
  if (potential >= lines.regular) return { band: 'regular', kind: lineKind, potential, cleared: lines.regular, next: lines.impact };
  if (potential >= lines.fringe) return { band: 'fringe', kind: lineKind, potential, cleared: lines.fringe, next: lines.regular };
  return { band: 'below_major_league', kind: lineKind, potential, cleared: null, next: lines.fringe };
}

/* ── development remaining: the context ──────────────────────────────────────────────────────── */

/**
 * What his age alone says. Youth is not talent: it never adds to anybody, it says how much of a
 * visible ceiling is still in play.
 */
export function developmentRemainingByAge(age: number): DevelopmentRemaining {
  if (age <= DEVELOPMENT_AGE.most) return 'most';
  if (age <= DEVELOPMENT_AGE.some) return 'some';
  if (age <= DEVELOPMENT_AGE.little) return 'little';
  return 'none';
}

/** Where his age puts him against his own league. The lines are D-044's, read and not redeclared. */
export function levelScheduleOf(context: DevelopmentalContext | null | undefined): LevelSchedule {
  const relative = context?.ageRelativeToLevel;
  if (relative === null || relative === undefined || !Number.isFinite(relative)) return 'not_established';
  if (-relative >= AGE_LEVEL_DEVELOPMENT_LIMIT) return 'far_behind';
  if (-relative >= OLD_FOR_LEVEL) return 'behind';
  if (relative >= YOUNG_FOR_LEVEL) return 'young_for_level';
  return 'on_schedule';
}

/**
 * The most his level's schedule allows. It may shorten what his age says and never lengthen it:
 * being young for a level raises nothing, because an upper level's rostered average is inflated by
 * veterans and because a level is an assignment the GM controls — a tier that rose on promotion
 * would be grading the GM's own move.
 */
const scheduleLimitOf = (schedule: LevelSchedule): DevelopmentRemaining | null =>
  schedule === 'far_behind' ? 'little' : schedule === 'behind' ? 'some' : null;

function remainingOf(age: number, gap: number, context: DevelopmentalContext | null | undefined): StakesReading['remaining'] {
  const byAge = developmentRemainingByAge(age);
  const schedule = levelScheduleOf(context);
  const scheduleLimit = scheduleLimitOf(schedule);
  const boundBy: StakesReading['remaining']['boundBy'] = ['age'];

  let state = byAge;
  if (scheduleLimit !== null && REMAINING_STEPS[scheduleLimit] > REMAINING_STEPS[byAge]) {
    state = lessRemaining(byAge, scheduleLimit);
    boundBy.push('schedule');
  }

  const realized = gap < PROJECTION_REALIZED_UNDER;
  if (realized && state !== 'none') {
    state = oneStepLess(state);
    boundBy.push('projection');
  }

  return { state, byAge, schedule, scheduleLimit, projection: { gap, realized }, boundBy };
}

/** The ceiling, lowered one tier for each step by which the development that would realize it has run out. */
export function tierFor(ceiling: CeilingBand, remaining: DevelopmentRemaining): DevelopmentProtectionTier {
  const index = CEILING_RANK[ceiling] + 1 - REMAINING_STEPS[remaining];
  return TIER_ORDER[Math.max(0, Math.min(TIER_ORDER.length - 1, index))];
}

/* ── the explanation ─────────────────────────────────────────────────────────────────────────── */

const LINE_WORDS = { fringe: 'the weakest tenth', regular: 'the median', impact: 'the best tenth' } as const;

function ceilingReason(ceiling: StakesReading['ceiling']): string {
  const lines = CEILING_LINES[ceiling.kind];
  const peers = `major-league ${ceiling.kind}s`;
  switch (ceiling.band) {
    case 'impact':
      return `Visible ceiling of an impact major leaguer: a potential of ${ceiling.potential} is among ${LINE_WORDS.impact} of ${peers} (${lines.impact}).`;
    case 'regular':
      return `Visible ceiling of a major-league regular: a potential of ${ceiling.potential} is at ${LINE_WORDS.regular} of ${peers} (${lines.regular}) or above it.`;
    case 'fringe':
      return `Visible ceiling of a fringe major leaguer: a potential of ${ceiling.potential} clears ${LINE_WORDS.fringe} of ${peers} (${lines.fringe}) and not ${LINE_WORDS.regular} (${lines.regular}).`;
    case 'below_major_league':
      return `No major-league projection is visible: a potential of ${ceiling.potential} is under ${LINE_WORDS.fringe} of ${peers} (${lines.fringe}).`;
  }
}

function ageReason(age: number, byAge: DevelopmentRemaining): string {
  switch (byAge) {
    case 'most':
      return `At ${age} most of his development is still ahead of him.`;
    case 'some':
      return `At ${age} some of his development is still ahead of him.`;
    case 'little':
      return `At ${age} little of his development is still ahead of him.`;
    case 'none':
      return `At ${age} his developmental years are behind him.`;
  }
}

function scheduleReason(remaining: StakesReading['remaining'], context: DevelopmentalContext | null | undefined): string | null {
  const where = context?.leagueName ?? (context ? `${context.levelName}` : 'his level');
  const years = context?.ageRelativeToLevel == null ? null : Math.abs(context.ageRelativeToLevel).toFixed(1);
  const pool = context?.ageProfile.scope === 'level' ? ` (its own league is too thin to describe itself, so every ${context.levelName} league is used)` : '';
  switch (remaining.schedule) {
    /*
     * Said only when it is what shortened the reading. A twenty-eight-year-old is "old for Triple-A"
     * too, and his age has already said everything that says.
     */
    case 'far_behind':
      return remaining.boundBy.includes('schedule')
        ? `He is ${years} years older than the rostered average of ${where}${pool}: far enough behind his level's schedule that little developmental time is left at this pace.`
        : null;
    case 'behind':
      return remaining.boundBy.includes('schedule')
        ? `He is ${years} years older than the rostered average of ${where}${pool}, which is behind his level's schedule.`
        : null;
    case 'young_for_level':
      return `Young for his level: ${years} years under the rostered average of ${where}${pool}. Context only; a level is an assignment and raises nothing.`;
    case 'on_schedule':
      return null;
    case 'not_established':
      return context
        ? `The age profile of ${where} could not be established, so whether he is behind his level's schedule was not read and nothing was discounted for it.`
        : 'No level context was supplied, so whether he is behind his level\'s schedule was not read and nothing was discounted for it.';
  }
}

/**
 * How the two readings made the tier, said plainly, so a tier under the ceiling's own is never a
 * mystery: the ceiling alone would have set one tier, and the development that has run out lowered it.
 */
function compositionReason(tier: DevelopmentProtectionTier, band: CeilingBand, remaining: DevelopmentRemaining): string {
  const ceilingAlone = tierFor(band, 'most');
  const steps = TIER_ORDER.indexOf(ceilingAlone) - TIER_ORDER.indexOf(tier);
  if (steps <= 0) {
    return `Developmental stakes: ${TIER_WORDS[tier]}, which is what that ceiling sets with most of his development still ahead of him.`;
  }
  const floor = tier === TIER_ORDER[0] && REMAINING_STEPS[remaining] > steps ? ' (the lowest tier; it goes no further)' : '';
  return `Developmental stakes: ${TIER_WORDS[tier]}. That ceiling alone would set ${TIER_WORDS[ceilingAlone]}; it is lowered ${['', 'one step', 'two steps', 'three steps'][steps] ?? `${steps} steps`} for the development that has run out${floor}.`;
}

/** The tier as a reader sees it. `normal` reads "ordinary", here and in the UI. */
export const tierWord = (tier: DevelopmentProtectionTier): string => TIER_WORDS[tier];

const TIER_WORDS: Record<DevelopmentProtectionTier, string> = {
  core_prospect: 'core prospect',
  protected_prospect: 'protected prospect',
  development_priority: 'development priority',
  /* The identifier is `normal`; the word a reader sees, here and in the UI, is "ordinary". */
  normal: 'ordinary',
  organizational_depth: 'organizational depth',
};

/* ── the model this replaced, kept only so a re-tiering can be explained ─────────────────────── */

const clamp = (value: number, min = 0, max = 100): number =>
  Math.max(min, Math.min(max, value));

/**
 * The absolute-scale composite the stakes model replaced (D-050), unchanged.
 *
 *   score = 0.60 potential + 0.20 upside + 0.10 youth + 0.10 current, cut at 78 / 57 / 42 / 25
 *
 * It was written against OOTP's printed Overall and Potential; D-017 rightly replaced that input with
 * the adapter's much narrower composite and the cut-offs were never re-anchored, so on a real import
 * no player in thirty organizations was a core prospect, and it read age as ten points added to
 * anybody. It DECIDES NOTHING: it is here so the report can measure a re-tiering on any import and so
 * a reading can say why it differs. `tests/developmentalStakesBoundary.test.ts` fails if anything else
 * calls it.
 */
export function supersededCompositeTier(age: number, current: number, potential: number): DevelopmentProtectionTier {
  const scale = (rating: number): number => clamp(((rating - 20) / 60) * 100);
  const youth =
    age <= 18 ? 100 : age === 19 ? 95 : age === 20 ? 90 : age === 21 ? 82 : age === 22 ? 72
      : age === 23 ? 60 : age === 24 ? 45 : age === 25 ? 30 : age === 26 ? 18 : 5;
  const upside = clamp((Math.max(0, potential - current) / 30) * 100);
  const score = Math.round(clamp(scale(potential) * 0.6 + upside * 0.2 + youth * 0.1 + scale(current) * 0.1));
  if (score >= 78) return 'core_prospect';
  if (score >= 57) return 'protected_prospect';
  if (score >= 42) return 'development_priority';
  if (score >= 25) return 'normal';
  return 'organizational_depth';
}

function differenceFromSuperseded(
  tier: DevelopmentProtectionTier,
  superseded: DevelopmentProtectionTier,
  ceiling: StakesReading['ceiling'],
  remaining: StakesReading['remaining'],
  age: number
): string | null {
  const now = TIER_ORDER.indexOf(tier);
  const before = TIER_ORDER.indexOf(superseded);
  if (now === before) return null;
  if (now > before) {
    return `Reads higher than the absolute composite did (${TIER_WORDS[superseded]}): its cut-offs were set for a wider rating scale than the visible-tool composite and could not be reached on it.`;
  }
  const causes: string[] = [];
  if (ceiling.band === 'below_major_league' && age <= DEVELOPMENT_AGE.some) {
    causes.push('youth and a wide gap added points there whatever the ceiling, and no major-league ceiling is visible');
  }
  if (remaining.boundBy.includes('schedule')) causes.push('it did not read his level, and he is behind its schedule');
  if (remaining.boundBy.includes('projection')) causes.push('his visible projection is nearly all realized');
  if (remaining.byAge !== 'most' && causes.length === 0) causes.push('age was a tenth of a score there, and here it says how much of his ceiling is still in play');
  if (causes.length === 0) causes.push('the ceiling is read against what a major leaguer is rather than added into a score');
  return `Reads lower than the absolute composite did (${TIER_WORDS[superseded]}): ${causes.join('; ')}.`;
}

/**
 * Developmental protection is intentionally independent of roster pressure.
 *
 * A player cannot become "less of a prospect" merely because an affiliate has
 * too many outfielders or not enough first basemen.
 */
export function evaluateDevelopmentProtection(
  input: DevelopmentProtectionInput
): DevelopmentProtection {
  const ratingEvidence = input.ability.status;
  const current = input.ability.current;
  const potentialRating = input.ability.potential;

  if (input.manuallyProtected) {
    return {
      tier: 'core_prospect',
      manuallyProtected: true,
      ratingEvidence,
      missingEvidence: [],
      reasons: [
        'Manually protected by the front office.',
      ],
      reading: null,
    };
  }

  const age = knownAge(input.age);

  /*
   * Reasons that rest only on evidence that IS known are reported whether or
   * not the rest is: a known ceiling or a known age is still worth showing.
   */
  const reasons: string[] = [];
  const ceiling = potentialRating !== null ? ceilingOf(input.ability.kind, potentialRating) : null;
  if (ceiling) reasons.push(ceilingReason(ceiling));
  if (age !== null) reasons.push(ageReason(age, developmentRemainingByAge(age)));

  /*
   * The tier needs the ceiling, how much of it is realized, and his age. If any is unknown it cannot
   * be established, and no neutral value is put in its place: the protection is indeterminate, with
   * the missing evidence reported.
   */
  if (current === null || potentialRating === null || ceiling === null || age === null) {
    reasons.push(
      current === null || potentialRating === null
        ? 'Developmental stakes are indeterminate: the organization-visible current and/or potential ratings they depend on are unavailable, and no neutral value is substituted.'
        : 'Developmental stakes are indeterminate: his age is not known, and how much of his development is left cannot be read without it.'
    );

    return {
      tier: null,
      manuallyProtected: false,
      ratingEvidence,
      missingEvidence: missingAbilityEvidence(input.ability),
      reasons,
      reading: null,
    };
  }

  const gap = Math.max(0, potentialRating - current);
  const remaining = remainingOf(age, gap, input.context);
  const tier = tierFor(ceiling.band, remaining.state);

  const schedule = scheduleReason(remaining, input.context);
  if (schedule) reasons.push(schedule);
  if (remaining.projection.realized) {
    reasons.push(
      `His visible projection is nearly all realized (current ${current} against a potential of ${potentialRating}), so what the scouts see ahead of him has largely happened.`
    );
  }
  reasons.push(compositionReason(tier, ceiling.band, remaining.state));

  const superseded = supersededCompositeTier(age, current, potentialRating);

  return {
    tier,
    manuallyProtected: false,
    ratingEvidence,
    missingEvidence: [],
    reasons,
    reading: {
      ceiling,
      remaining,
      supersededComposite: {
        tier: superseded,
        differs: differenceFromSuperseded(tier, superseded, ceiling, remaining, age),
      },
    },
  };
}
