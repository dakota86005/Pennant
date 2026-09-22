/**
 * One minor leaguer's assignment, reviewed.
 *
 * The question is not "has he earned a promotion". It is: is where he is, in the role he is in,
 * getting the work he is getting, defensible — and if not, what else is? The farm v1 model could
 * only answer the first question, through one readiness score, so the only thing it could say about
 * a player standing still was to recommend moving him.
 *
 * Three specialists are composed and none is recreated:
 *
 *   Player Development  is this level still developing him (`currentAssignment`), and which other
 *                       assignments are defensible (`prospectAssignments` + `destinationFit`)
 *   Minor League Ops    can he get the work here, and who is ahead of him (`playingTime`)
 *   Philosophy          which of the defensible alternatives this club prefers
 *                       (`assignmentPreference`), after defensibility and never before
 *
 * Most players should need no attention. A conclusion of `current_assignment_defensible` on a man
 * getting regular work is the normal case and the module says so rather than inventing a question.
 *
 * Pure: every specialist answer is passed in. `farmOperations.ts` does the reading.
 */

import type { AssignmentPreference, ProspectAssignmentEvaluation } from './prospectAssignments.js';
import type { CurrentAssignmentRead } from './currentAssignment.js';
import type { DevelopmentProtection } from './developmentFit.js';
import type { MissingEvidence } from './developmentJudgment.js';
import type { FarmProduction } from './farmResults.js';
import { describeTenure } from './farmRecentUsage.js';
import { hasDevelopmentalStakes, jobLabel, shortOfWorkVerdict, type OpportunityRead } from './playingTime.js';

/**
 * What the review concludes. Descriptive, never an instruction, and deliberately not a
 * promote/hold/demote trichotomy: several of these are simultaneously true of a real player, so the
 * conclusion names the one that needs the GM's attention most and the rest are in the body.
 */
export type AssignmentConclusion =
  /** Where he is, doing what he is doing, is defensible. The normal case. */
  | 'current_assignment_defensible'
  /** The level no longer develops him and at least one promotion-direction assignment is defensible. */
  | 'promotion_direction_defensible'
  /** The level is ahead of him and a less demanding assignment is defensible. */
  | 'demotion_direction_defensible'
  /** The level is right but he cannot get the work his development needs here. */
  | 'opportunity_conflict'
  /** Another player in the organization is occupying the developmental path he needs. */
  | 'organizational_blockage'
  /**
   * The level has no developmental value left for him and the question is what the organization
   * wants, not what develops him. A 29-year-old dominating Double-A is this, not a prospect.
   */
  | 'organizational_question'
  /** Required evidence is missing and the answer depends on it. */
  | 'indeterminate'
  /** There is nothing to read yet: a season that has not been played is not missing evidence. */
  | 'not_assessable';

export type AttentionLevel = 'needs_attention' | 'worth_a_look' | 'routine';

export interface AlternativeAssignment {
  kind: ProspectAssignmentEvaluation['kind'];
  direction: 'promotion' | 'demotion';
  level: number;
  levelName: string;
  teams: Array<{ teamId: number; label: string }>;
  judgment: ProspectAssignmentEvaluation['judgment'];
  /** Only ever set for a defensible assignment (D-019). */
  preference: AssignmentPreference | null;
  blockers: string[];
  missingEvidence: MissingEvidence[];
  /**
   * What the destination would give him, from Minor League Operations: whether the job is open
   * there. Null when the destination has not been read.
   */
  destinationOpportunity: {
    teamId: number;
    job: string;
    open: boolean;
    detail: string;
  } | null;
}

export interface AssignmentReview {
  playerId: number;
  name: string;
  age: number;
  kind: 'hitter' | 'pitcher';

  teamId: number;
  team: string;
  level: number;
  levelName: string;
  leagueName: string;

  /** Player Development's protection tier, or null when indeterminate. */
  protection: DevelopmentProtection;

  /** What his results say, league-relative and park-adjusted. */
  production: FarmProduction;

  /** Player Development: is this level still developing him? */
  current: CurrentAssignmentRead;

  /** Minor League Operations: is he getting the work? */
  opportunity: OpportunityRead;

  /** His recent role differs from his season's (the game log). null for most players and every hitter. */
  roleChange: { to: 'relief' | 'starting'; detail: string } | null;

  /** Player Development: what else is defensible, with philosophy's preference among those. */
  alternatives: AlternativeAssignment[];

  conclusion: AssignmentConclusion;
  attention: AttentionLevel;

  /** Why this conclusion, as ordered statements. */
  reasons: string[];

  /** Which specialist decided what, so no judgment is anonymous. */
  ownership: Array<{ question: string; owner: string; answer: string }>;

  /** Evidence that is absent. */
  missing: string[];

  /** What would settle what is open. */
  wouldResolve: string[];

  /** What remains the GM's. Always populated: nothing here is a transaction. */
  gmDecision: string[];
}

export interface AssignmentReviewInput {
  playerId: number;
  name: string;
  age: number;
  kind: 'hitter' | 'pitcher';
  teamId: number;
  team: string;
  level: number;
  levelName: string;
  leagueName: string;
  protection: DevelopmentProtection;
  production: FarmProduction;
  current: CurrentAssignmentRead;
  opportunity: OpportunityRead;
  alternatives: AlternativeAssignment[];
  /**
   * Players occupying the path this player needs: the men who are REGULAR at his job and ahead of
   * him (`blockersOf`), never merely anyone with more innings. Empty when nobody holds the job.
   */
  blockedBy: Array<{ playerId: number; name: string; age: number; where: string; why: string }>;
  /** He is injured, so nothing about his playing time is read while he is (days left when exported). */
  injured?: { daysLeft: number | null } | null;
  /** His recent role differs from his season's, from the game log: a fact beside his job, never a verdict. */
  roleChange?: { to: 'relief' | 'starting'; detail: string } | null;
}

/**
 * Men ahead of him, as a sentence rather than a chain of "and"s, with the club named once when they
 * all share it.
 */
function nameList(blockers: readonly { name: string; age: number; where: string }[]): string {
  const clubs = new Set(blockers.map((b) => b.where));
  const names = blockers.map((b) => `${b.name} (${b.age}${clubs.size > 1 ? `, ${b.where}` : ''})`);
  const joined =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return clubs.size === 1 ? `${joined} at ${[...clubs][0]}` : joined;
}

const hasDefensible = (alts: readonly AlternativeAssignment[], direction: 'promotion' | 'demotion'): boolean =>
  alts.some((a) => a.direction === direction && a.judgment === 'defensible');

const anyIndeterminate = (alts: readonly AlternativeAssignment[]): boolean =>
  alts.some((a) => a.judgment === 'indeterminate');

export function reviewAssignment(input: AssignmentReviewInput): AssignmentReview {
  const reasons: string[] = [];
  const missing: string[] = [];
  const wouldResolve: string[] = [];

  const ownership: AssignmentReview['ownership'] = [
    {
      question: 'Is this level still developing him?',
      owner: 'Player Development',
      answer: input.current.verdict.replace(/_/g, ' '),
    },
    {
      question: 'Can he get the work his development needs here?',
      owner: 'Minor League Operations',
      answer: input.opportunity.verdict.replace(/_/g, ' '),
    },
    {
      question: 'Which other assignments are defensible?',
      owner: 'Player Development',
      answer:
        input.alternatives.length === 0
          ? 'no alternative was evaluated'
          : input.alternatives
              .map((a) => `${a.kind.replace(/_/g, ' ')} to ${a.levelName}: ${a.judgment}`)
              .join('; '),
    },
    {
      question: 'Which of the defensible alternatives does this club prefer?',
      owner: 'Organizational Philosophy',
      answer:
        input.alternatives.filter((a) => a.preference !== null).length === 0
          ? 'no preference is expressed: preference applies only to a defensible assignment'
          : input.alternatives
              .filter((a) => a.preference !== null)
              .map((a) => `${a.levelName}: ${a.preference}`)
              .join('; '),
    },
  ];

  missing.push(...input.current.unknowns);
  missing.push(...input.opportunity.unknowns);
  for (const a of input.alternatives) {
    for (const m of a.missingEvidence) missing.push(m.detail);
  }

  /* ── the conclusion ────────────────────────────────────────────────────────────────────────── */

  let conclusion: AssignmentConclusion;

  /*
   * Not getting the work matters when there is development to cost.
   *
   * Every affiliate carries men who do not play much, and that is what a backup catcher is. Without
   * the stakes test a thirty-three-year-old organizational-depth catcher at Triple-A read as
   * "another player holds the developmental path he needs", which is not a sentence about him. The
   * stakes come from Player Development's protection tier and are indeterminate rather than low when
   * the ratings behind them are missing (D-018), in which case nothing is claimed either way.
   */
  const stakes = input.protection.tier;
  const developmentalStakes = hasDevelopmentalStakes(stakes);
  /* The same line the club's conflict draws (`shortOfWork`): sharing a job is not being short of it. */
  const notPlaying = developmentalStakes && shortOfWorkVerdict(input.opportunity.verdict);
  /*
   * In the lineup most days but not in the field at his job: his bat is developing and his glove is
   * not. For a player whose development includes the position that is a real cost, and a quieter one
   * than not playing — it is raised as worth a look, and only when nothing about the level outranks it.
   */
  const batOnly = developmentalStakes && input.opportunity.verdict === 'bat_only';

  /*
   * A thin sample caused by not playing is not "nothing to say about him" — it IS the finding, and
   * the two facts are the same fact. Reading the level first puts a development-priority prospect
   * with twelve plate appearances, because another man has his position, in `not_assessable` /
   * `routine`: the most attention-worthy case in an organization reported as nothing to see. Usage
   * needs no production evidence, so the opportunity read is available exactly when the production
   * read is not, and it is asked first.
   *
   * The order is right and the example it was first drawn from was not: Druw Jones had twelve plate
   * appearances at Triple-A because he had been promoted four games earlier, not because anybody held
   * centre field (docs/MINOR_LEAGUE_OPERATIONS.md §8.2). A thin sample has two causes, and the
   * playing-time read now tells them apart — a man too new to the club to be read is `indeterminate`
   * here and falls through to the level question, where "no season to read" is the true answer.
   */
  if (input.injured) {
    /*
     * An injured man's zero innings are a fact about his health. He is excluded from every conflict,
     * and his review says why nothing about his work is read rather than calling him blocked or
     * not playing.
     */
    conclusion = input.current.verdict === 'not_assessable' ? 'not_assessable' : input.current.verdict === 'indeterminate' ? 'indeterminate' : 'current_assignment_defensible';
    reasons.push(
      `He is injured${input.injured.daysLeft !== null ? ` (${input.injured.daysLeft} days)` : ''}, so nothing about his playing time is read while he is out.`
    );
    reasons.push(...input.current.reasons);
    wouldResolve.push('His return: his assignment is read again when he is playing.');
  } else if (input.current.verdict === 'not_assessable' && !notPlaying) {
    conclusion = 'not_assessable';
    reasons.push(...input.current.reasons);
    wouldResolve.push('More of the season: there is no line to read yet.');
  } else if (input.blockedBy.length > 0 && notPlaying) {
    /*
     * Blockage outranks the level question. A player at the right level who cannot play because
     * somebody else holds his job has a problem the level cannot fix, and it is the organization's
     * problem, not his.
     */
    conclusion = 'organizational_blockage';
    reasons.push(`${nameList(input.blockedBy)} ${input.blockedBy.length === 1 ? 'occupies' : 'occupy'} the developmental path he needs.`);
    reasons.push(...input.opportunity.reasons);
    wouldResolve.push('Moving one of them, or moving him to a club where the job is open.');
  } else if (input.current.verdict === 'indeterminate' && !notPlaying) {
    conclusion = 'indeterminate';
    reasons.push(...input.current.reasons);
    wouldResolve.push('Evidence that settles the reading: more of the season, or the missing grades.');
  } else if (notPlaying) {
    /*
     * Not playing outranks the level question.
     *
     * This test used to sit last, after a branch that returned "the current assignment is defensible,
     * and an alternative cannot be judged". So a prospect at the right level who was not playing, and
     * whose promotion happened to be indeterminate, was reported as routine: on the real import that
     * silently swallowed three Triple-A outfielders and a shortstop who were getting no reps.
     */
    conclusion = 'opportunity_conflict';
    reasons.push(...input.opportunity.reasons);
    if (input.current.verdict === 'not_assessable' || input.current.verdict === 'indeterminate') {
      reasons.push(
        'There is not enough of a line to say what the level is doing for him, and the reason is the same one: he is not getting the work.'
      );
    } else {
      reasons.push(...input.current.reasons);
    }
    wouldResolve.push(
      input.opportunity.job !== null
        ? `A club where ${jobLabel(input.opportunity.job)} is open, or a change in how this club uses him.`
        : 'A role he can actually play.'
    );
  } else if (anyIndeterminate(input.alternatives) && input.current.verdict === 'appropriate') {
    conclusion = 'current_assignment_defensible';
    reasons.push(...input.current.reasons);
    reasons.push('An alternative assignment cannot be judged on the evidence available, so it is neither open nor ruled out.');
  } else if (input.current.verdict === 'too_advanced') {
    if (hasDefensible(input.alternatives, 'demotion')) {
      conclusion = 'demotion_direction_defensible';
      reasons.push(...input.current.reasons);
      reasons.push('A less demanding assignment is developmentally defensible.');
    } else {
      conclusion = 'organizational_question';
      reasons.push(...input.current.reasons);
      reasons.push(
        'No less demanding assignment is defensible or available, so what to do about it is an organizational question.'
      );
    }
  } else if (input.current.verdict === 'no_longer_developmental') {
    if (input.current.question === 'organizational') {
      conclusion = 'organizational_question';
      reasons.push(...input.current.reasons);
      if (hasDefensible(input.alternatives, 'promotion')) {
        reasons.push(
          'A more demanding assignment is defensible — nothing about it would harm him — but it is not a developmental case for him.'
        );
      }
    } else if (hasDefensible(input.alternatives, 'promotion')) {
      conclusion = 'promotion_direction_defensible';
      reasons.push(...input.current.reasons);
      reasons.push('At least one promotion-direction assignment is developmentally defensible.');
    } else {
      conclusion = 'current_assignment_defensible';
      reasons.push(...input.current.reasons);
      reasons.push(
        'No promotion-direction assignment is defensible yet, so staying is the defensible assignment even though the level is no longer the one developing him.'
      );
      wouldResolve.push(
        input.alternatives.length > 0
          ? `What is holding the next level back: ${input.alternatives.flatMap((a) => a.blockers).slice(0, 2).join(' ')}`
          : 'A higher affiliate in the organization.'
      );
    }
  } else if (batOnly && input.opportunity.job !== null) {
    conclusion = 'opportunity_conflict';
    reasons.push(...input.current.reasons);
    reasons.push(...input.opportunity.reasons);
    reasons.push(
      `He is in the lineup most days as the designated hitter and not in the field at ${jobLabel(input.opportunity.job)}: his bat is getting its work and his glove is not.`
    );
    wouldResolve.push(`Innings in the field at ${jobLabel(input.opportunity.job)}, which is the affiliate's own decision, or a club where the position is open.`);
  } else {
    conclusion = 'current_assignment_defensible';
    reasons.push(...input.current.reasons);
    if (input.opportunity.verdict === 'shared_work') {
      reasons.push('He is sharing the job, which is ordinary at this level.');
    } else if (shortOfWorkVerdict(input.opportunity.verdict)) {
      reasons.push(
        stakes === null
          ? 'He is not getting much work. Whether that costs development cannot be said: his developmental stakes are indeterminate.'
          : 'He is not getting much work, which is what the role he is in at this level is.'
      );
    }
  }

  /*
   * When he got here, and what he has done since. For a man who joined the club inside the window it
   * is the fact that frames everything else — his destination totals are small because he is new — so
   * it is said first. It changes no conclusion: whether the level suits him is Player Development's
   * and rests on his line, which a recent arrival does not yet have here.
   */
  const work = input.opportunity.work;
  const arrived = work?.tenure?.status === 'recent_arrival' ? describeTenure(work.tenure) : null;
  if (arrived && work?.recent) reasons.unshift(`${arrived} ${work.recent.basis}`);
  if (input.roleChange) reasons.push(input.roleChange.detail);

  /* ── how much attention it deserves ────────────────────────────────────────────────────────── */

  const highStakes = developmentalStakes;

  const attention: AttentionLevel =
    conclusion === 'organizational_blockage' || conclusion === 'opportunity_conflict'
      ? highStakes && input.opportunity.verdict !== 'bat_only'
        ? 'needs_attention'
        : 'worth_a_look'
      : conclusion === 'demotion_direction_defensible'
        ? 'needs_attention'
        : conclusion === 'promotion_direction_defensible'
          ? highStakes
            ? 'needs_attention'
            : 'worth_a_look'
          : conclusion === 'organizational_question'
            ? 'worth_a_look'
            : conclusion === 'indeterminate'
              ? highStakes
                ? 'worth_a_look'
                : 'routine'
              : 'routine';

  const gmDecision = [
    'Whether to move him at all. Nothing here is a transaction and Pennant executes nothing.',
  ];
  if (conclusion === 'organizational_question') {
    gmDecision.push('What the organization wants from him, which is not a developmental question.');
  }
  if (conclusion === 'organizational_blockage' || conclusion === 'opportunity_conflict') {
    gmDecision.push('Which of the players competing for the job should get the reps.');
  }
  if (input.alternatives.some((a) => a.judgment === 'defensible')) {
    gmDecision.push('Which of the defensible assignments to use; philosophy states a preference, not a decision.');
  }

  return {
    playerId: input.playerId,
    name: input.name,
    age: input.age,
    kind: input.kind,
    teamId: input.teamId,
    team: input.team,
    level: input.level,
    levelName: input.levelName,
    leagueName: input.leagueName,
    protection: input.protection,
    production: input.production,
    current: input.current,
    opportunity: input.opportunity,
    roleChange: input.roleChange ?? null,
    alternatives: input.alternatives,
    conclusion,
    attention,
    reasons,
    ownership,
    missing: [...new Set(missing)],
    wouldResolve: [...new Set(wouldResolve)],
    gmDecision,
  };
}

/** One line a GM can read in a list. */
export function summarizeReview(review: AssignmentReview): string {
  switch (review.conclusion) {
    case 'current_assignment_defensible':
      return `${review.levelName} is a defensible assignment.`;
    case 'promotion_direction_defensible':
      return `Beyond ${review.levelName}; a more demanding assignment is defensible.`;
    case 'demotion_direction_defensible':
      return `${review.levelName} is ahead of what he has shown; a less demanding assignment is defensible.`;
    case 'opportunity_conflict':
      return review.opportunity.verdict === 'bat_only'
        ? `The level fits and he is batting most days, but he is not fielding${review.opportunity.job ? ` at ${jobLabel(review.opportunity.job)}` : ''}.`
        : `The level fits, but he is not getting the work${review.opportunity.job ? ` at ${jobLabel(review.opportunity.job)}` : ''}.`;
    case 'organizational_blockage':
      return 'Another player in the organization holds the developmental path he needs.';
    case 'organizational_question':
      return `${review.levelName} has no developmental value left for him; where he plays is an organizational question.`;
    case 'indeterminate':
      return 'His assignment cannot be judged on the evidence available.';
    case 'not_assessable':
      return 'There is no production to read yet.';
  }
}
