/**
 * What follows when one player leaves an affiliate, followed through until it stops.
 *
 * The MLB branch's `minorLeagueCascadePlanner` was deferred rather than adopted because it was a
 * second Minor League Operations solver living inside MLB work: it did its own role-fit test, its
 * own philosophy ranking, and it dropped indeterminate candidates silently (MLB_OPERATIONS.md §2.1
 * item 12). This is the responsibility landing where it belongs, built on the specialists.
 *
 * A cascade is a chain, not a search. Each step is one move that somebody could actually make, and
 * each step is independently defensible or the chain stops there. The chain is as certain as its
 * least certain step: one indeterminate link makes everything downstream of it indeterminate.
 *
 * It STOPS, and saying where it stopped is the answer:
 *
 *   absorbed                       the affiliate can cover the vacancy from what it already has
 *   no_defensible_move             nothing below is a defensible replacement
 *   indeterminate                  the next step needs evidence the organization does not have
 *   relocates_the_same_shortage    the replacement's own club would be left with the same hole
 *   reached_lowest_level           there is nothing below to draw from
 *   step_limit                     followed as far as is useful; beyond this it is speculation
 *
 * "The call-up is feasible but leaves an unresolved Double-A rotation vacancy" is a complete,
 * useful answer and the module is built to give it rather than to manufacture a last step.
 *
 * Pure. Player Development answers defensibility, Philosophy states a preference among defensible
 * options, and this module does the bookkeeping.
 */

import { CASCADE_MAX_STEPS } from './farmCalibration.js';
import type { AssignmentPreference } from './prospectAssignments.js';
import type { DevelopmentalJudgment, MissingEvidence } from './developmentJudgment.js';
import { jobLabel, type FarmJob } from './playingTime.js';

export type CascadeStop =
  | 'absorbed'
  | 'no_defensible_move'
  | 'indeterminate'
  | 'relocates_the_same_shortage'
  | 'reached_lowest_level'
  | 'step_limit';

/** A hole one move leaves behind. */
export interface Vacancy {
  teamId: number;
  team: string;
  level: number;
  levelName: string;
  job: FarmJob;
  /** How many hold the job after the departure, and how many the club needs. */
  after: number;
  floor: number;
  /** Whether the club is still able to do the job without filling it. */
  absorbed: boolean;
  detail: string;
}

/** One link: a player, where he is, where he would go, and what it costs. */
export interface CascadeStep {
  index: number;

  vacancy: Vacancy;

  /** Null when no candidate was found at all for this vacancy. */
  candidate: {
    playerId: number;
    name: string;
    age: number;
    fromTeamId: number;
    fromTeam: string;
    fromLevel: number;
    fromLevelName: string;
  } | null;

  /** Player Development, for this exact move. Never recreated here. */
  development: {
    judgment: DevelopmentalJudgment | 'not_evaluated';
    blockers: string[];
    missingEvidence: MissingEvidence[];
  };

  /** Philosophy, only among defensible options (D-019). */
  preference: AssignmentPreference | null;
  /** Which dimension spoke, when one did. */
  preferenceBasis: string | null;

  /**
   * The other defensible replacements for this vacancy, so the GM sees the branch rather than one
   * man presented as the only way. The chain follows the first in readiness order; these are as
   * defensible as he is, each with philosophy's preference, and choosing among them is the GM's.
   */
  alternatives: Array<{ playerId: number; name: string; age: number; fromTeam: string; preference: AssignmentPreference | null }>;

  /** What the move does to the destination and to the source, from Minor League Operations. */
  consequence: {
    destination: string;
    source: string;
    /** Whether he would get the work at the destination. */
    destinationOpportunity: string;
    /** Whether the move opens a further vacancy that needs a decision. */
    opensFurtherVacancy: boolean;
  };

  /** What is not established about this step. */
  uncertainty: string[];

  /** Whether this step is a move a GM could make as things stand. */
  usable: boolean;
}

export interface Cascade {
  /** What started it. */
  origin: {
    playerId: number;
    name: string;
    fromTeamId: number;
    fromTeam: string;
    job: FarmJob;
    reason: string;
  };

  steps: CascadeStep[];

  stop: CascadeStop;
  stopDetail: string;

  /**
   * Every hole the chain leaves open. Empty means the chain resolved; a non-empty list is the useful
   * answer, not a failure.
   */
  unresolved: Array<{ teamId: number; team: string; job: string; detail: string }>;

  /** The chain is only as certain as its least certain step. */
  certainty: 'established' | 'indeterminate';

  /** What remains the GM's. */
  gmDecision: string[];
}

/* ── ports: what the caller supplies ─────────────────────────────────────────────────────────── */

export interface CascadeCandidate {
  playerId: number;
  name: string;
  age: number;
  fromTeamId: number;
  fromTeam: string;
  fromLevel: number;
  fromLevelName: string;
  /** Player Development's verdict on moving THIS player to THIS vacancy. */
  judgment: DevelopmentalJudgment | 'not_evaluated';
  blockers: string[];
  missingEvidence: MissingEvidence[];
  preference: AssignmentPreference | null;
  preferenceBasis: string | null;
  /** Whether the vacancy's job would actually be his at the destination. */
  destinationOpportunity: { open: boolean; detail: string };
  /** What his own club looks like after he leaves. */
  sourceAfter: Vacancy;
}

/** What the pool rule needs to know about a man on an affiliate. */
export interface PoolMember {
  playerId: number;
  kind: 'hitter' | 'pitcher';
  /** The one job he is competing for: a position code, 'the rotation' or 'the bullpen'. */
  primaryJob: string | null;
  /** Positions he has a revealed grade at. */
  coverage: readonly string[];
  level: number;
  rehab: boolean;
  injured?: boolean;
}

/**
 * Who could fill a vacancy, from the level below only: the objective membership rule, with no
 * judgment in it. A rotation hole is filled by a man taking starts, a relief hole by a relief arm, a
 * position by anyone who can play it — for a REPLACEMENT cover counts, which is the difference
 * between a claim (one job) and a replacement (anyone who can do it). Nothing here says whether the
 * move is defensible; that is Player Development's, per candidate.
 */
export function poolFor<T extends PoolMember>(vacancy: Vacancy, members: readonly T[], belowLevel: number): T[] {
  return members.filter((p) => {
    if (p.level !== belowLevel || p.rehab || p.injured === true) return false;
    if (vacancy.job.kind === 'rotation') return p.kind === 'pitcher' && p.primaryJob === 'the rotation';
    if (vacancy.job.kind === 'relief') return p.kind === 'pitcher' && p.primaryJob === 'the bullpen';
    return p.kind === 'hitter' && (p.coverage.includes(vacancy.job.position) || p.primaryJob === vacancy.job.position);
  });
}

export interface CascadePorts {
  /**
   * Candidates who could fill this vacancy, in the order the caller wants them considered — by how
   * ready the move is, never by a score of players (the MLB module's rule, D-030).
   */
  candidatesFor(vacancy: Vacancy): CascadeCandidate[];

  /** Whether the organization has any level below this one to draw from. */
  hasLevelBelow(level: number): boolean;
}

/* ── the chain ───────────────────────────────────────────────────────────────────────────────── */

export interface CascadeRequest {
  playerId: number;
  name: string;
  fromTeamId: number;
  fromTeam: string;
  job: FarmJob;
  reason: string;
  /** The hole his departure leaves. */
  vacancy: Vacancy;
}

export function planCascade(request: CascadeRequest, ports: CascadePorts): Cascade {
  const steps: CascadeStep[] = [];
  const unresolved: Cascade['unresolved'] = [];
  let certainty: Cascade['certainty'] = 'established';
  let stop: CascadeStop = 'step_limit';
  let stopDetail = '';

  let vacancy = request.vacancy;

  for (let index = 1; index <= CASCADE_MAX_STEPS; index++) {
    /*
     * A club that can still do the job does not need the chain continued. This is the most common
     * and most useful terminus: it says the move is free.
     */
    if (vacancy.absorbed) {
      stop = 'absorbed';
      stopDetail = `${vacancy.team} can cover ${jobLabel(vacancy.job)} from what it already has: ${vacancy.detail}`;
      break;
    }

    if (!ports.hasLevelBelow(vacancy.level)) {
      stop = 'reached_lowest_level';
      stopDetail = `${vacancy.team} is at the bottom of the organization's ladder; there is no level below to draw a replacement from.`;
      unresolved.push({ teamId: vacancy.teamId, team: vacancy.team, job: jobLabel(vacancy.job), detail: vacancy.detail });
      break;
    }

    const candidates = ports.candidatesFor(vacancy);

    /*
     * An indeterminate candidate is not a rejection and not a pass (D-018). If the best thing
     * available cannot be judged, the chain is indeterminate from here down and says so — it does
     * not fall through to a worse but judgeable candidate, because that would present a move the
     * organization has no reason to prefer as though the evidence favoured it.
     */
    const defensible = candidates.find((c) => c.judgment === 'defensible');
    const indeterminate = candidates.find((c) => c.judgment === 'indeterminate');
    const rejected = candidates.filter((c) => c.judgment === 'indefensible');
    const unevaluated = candidates.filter((c) => c.judgment === 'not_evaluated');

    if (!defensible && !indeterminate) {
      /*
       * Nobody defensible and nobody indeterminate. Two different things can be true here, and the
       * first version said the same sentence for both: Player Development may have JUDGED every
       * candidate and ruled each out, or it may not have evaluated some of them at all — a man with
       * no qualifying sample at his level has not been rejected (D-018). On the real import every
       * Double-A vacancy read "15 candidates were considered and Player Development found none of them
       * defensible" when in fact it had evaluated none of the fifteen. An unevaluated pool leaves the
       * chain indeterminate, and says why, rather than closed.
       */
      const closed = unevaluated.length === 0;
      steps.push({
        index,
        vacancy,
        candidate: null,
        development: {
          judgment: 'not_evaluated',
          blockers: rejected.flatMap((c) => c.blockers).slice(0, 4),
          missingEvidence: [],
        },
        preference: null,
        preferenceBasis: null,
        alternatives: [],
        consequence: {
          destination: `${vacancy.team} stays ${vacancy.after} of ${vacancy.floor} at ${jobLabel(vacancy.job)}.`,
          source: 'No player moves.',
          destinationOpportunity: 'Not applicable: no move.',
          opensFurtherVacancy: false,
        },
        uncertainty: closed
          ? []
          : [
              `Player Development has not evaluated a promotion for ${unevaluated.length} of the ${candidates.length} candidates: none of them has a qualifying sample at his own level yet, so the move can be neither approved nor ruled out.`,
            ],
        usable: false,
      });
      if (closed) {
        stop = 'no_defensible_move';
        stopDetail =
          candidates.length === 0
            ? `Nobody below ${vacancy.levelName} is a candidate for ${jobLabel(vacancy.job)}.`
            : `${candidates.length} ${candidates.length === 1 ? 'candidate was' : 'candidates were'} considered for ${jobLabel(vacancy.job)} and Player Development found none of them defensible.`;
      } else {
        certainty = 'indeterminate';
        stop = 'indeterminate';
        stopDetail =
          `${candidates.length} ${candidates.length === 1 ? 'candidate was' : 'candidates were'} considered for ${jobLabel(vacancy.job)} at ${vacancy.team}: ` +
          (rejected.length > 0 ? `Player Development ruled out ${rejected.length}, and ` : 'Player Development ') +
          `has not evaluated ${unevaluated.length === candidates.length ? 'any of them' : `${unevaluated.length} of them`}, because ${unevaluated.length === 1 ? 'he has' : 'they have'} no qualifying sample at ${unevaluated.length === 1 ? 'his' : 'their'} own level yet. The chain cannot be judged from here.`;
      }
      unresolved.push({ teamId: vacancy.teamId, team: vacancy.team, job: jobLabel(vacancy.job), detail: vacancy.detail });
      break;
    }

    if (!defensible && indeterminate) {
      certainty = 'indeterminate';
      steps.push({
        index,
        vacancy,
        candidate: {
          playerId: indeterminate.playerId,
          name: indeterminate.name,
          age: indeterminate.age,
          fromTeamId: indeterminate.fromTeamId,
          fromTeam: indeterminate.fromTeam,
          fromLevel: indeterminate.fromLevel,
          fromLevelName: indeterminate.fromLevelName,
        },
        development: {
          judgment: 'indeterminate',
          blockers: [],
          missingEvidence: indeterminate.missingEvidence,
        },
        preference: null,
        preferenceBasis: null,
        alternatives: [],
        consequence: {
          destination: `${indeterminate.name} would fill ${jobLabel(vacancy.job)} at ${vacancy.team}, if the move were defensible.`,
          source: indeterminate.sourceAfter.detail,
          destinationOpportunity: indeterminate.destinationOpportunity.detail,
          opensFurtherVacancy: !indeterminate.sourceAfter.absorbed,
        },
        uncertainty: [
          'Player Development cannot say whether this move is defensible, so everything downstream of it is unresolved.',
          ...indeterminate.missingEvidence.map((m) => m.detail),
        ],
        usable: false,
      });
      stop = 'indeterminate';
      stopDetail = `The best available replacement for ${jobLabel(vacancy.job)} at ${vacancy.team} is ${indeterminate.name}, and Player Development cannot judge the move on the evidence available.`;
      unresolved.push({ teamId: vacancy.teamId, team: vacancy.team, job: jobLabel(vacancy.job), detail: vacancy.detail });
      break;
    }

    const chosen = defensible as CascadeCandidate;

    /*
     * A chain that hands the same hole down a level has not solved anything, and saying so is worth
     * more than one more step. The test is the job, not the club: a rotation short at Triple-A
     * filled by leaving Double-A's rotation short is the same shortage in a different city.
     */
    const sameShortage =
      !chosen.sourceAfter.absorbed &&
      chosen.sourceAfter.job.kind === vacancy.job.kind &&
      (chosen.sourceAfter.job.kind !== 'position' ||
        vacancy.job.kind !== 'position' ||
        chosen.sourceAfter.job.position === vacancy.job.position);

    steps.push({
      index,
      vacancy,
      candidate: {
        playerId: chosen.playerId,
        name: chosen.name,
        age: chosen.age,
        fromTeamId: chosen.fromTeamId,
        fromTeam: chosen.fromTeam,
        fromLevel: chosen.fromLevel,
        fromLevelName: chosen.fromLevelName,
      },
      development: { judgment: 'defensible', blockers: [], missingEvidence: [] },
      preference: chosen.preference,
      preferenceBasis: chosen.preferenceBasis,
      alternatives: candidates
        .filter((c) => c.judgment === 'defensible' && c.playerId !== chosen.playerId)
        .map((c) => ({ playerId: c.playerId, name: c.name, age: c.age, fromTeam: c.fromTeam, preference: c.preference })),
      consequence: {
        destination: `${chosen.name} fills ${jobLabel(vacancy.job)} at ${vacancy.team}.`,
        source: chosen.sourceAfter.detail,
        destinationOpportunity: chosen.destinationOpportunity.detail,
        opensFurtherVacancy: !chosen.sourceAfter.absorbed,
      },
      uncertainty: chosen.destinationOpportunity.open
        ? []
        : ['The job he would fill is already contested at the destination, so the reps are not assured.'],
      usable: true,
    });

    if (chosen.sourceAfter.absorbed) {
      stop = 'absorbed';
      stopDetail = `${chosen.sourceAfter.team} can cover his departure: ${chosen.sourceAfter.detail}`;
      break;
    }

    if (sameShortage) {
      stop = 'relocates_the_same_shortage';
      stopDetail = `Filling ${jobLabel(vacancy.job)} at ${vacancy.team} with ${chosen.name} leaves ${chosen.sourceAfter.team} with the same shortage: ${chosen.sourceAfter.detail}`;
      unresolved.push({
        teamId: chosen.sourceAfter.teamId,
        team: chosen.sourceAfter.team,
        job: jobLabel(chosen.sourceAfter.job),
        detail: chosen.sourceAfter.detail,
      });
      break;
    }

    vacancy = chosen.sourceAfter;

    if (index === CASCADE_MAX_STEPS) {
      stop = 'step_limit';
      stopDetail = `Followed ${CASCADE_MAX_STEPS} steps. Beyond that the chain is speculation about decisions nobody has made.`;
      unresolved.push({ teamId: vacancy.teamId, team: vacancy.team, job: jobLabel(vacancy.job), detail: vacancy.detail });
    }
  }

  const gmDecision = [
    'Whether to make the first move at all. Nothing in the chain is a transaction.',
  ];
  if (unresolved.length > 0) {
    gmDecision.push(
      `Whether the organization can live with ${unresolved.length === 1 ? 'the hole' : 'the holes'} the chain leaves open.`
    );
  }
  if (steps.some((s) => s.preference !== null || s.alternatives.length > 0)) {
    gmDecision.push('Which of the defensible replacements to use; philosophy states a preference, not a decision.');
  }

  return {
    origin: {
      playerId: request.playerId,
      name: request.name,
      fromTeamId: request.fromTeamId,
      fromTeam: request.fromTeam,
      job: request.job,
      reason: request.reason,
    },
    steps,
    stop,
    stopDetail,
    unresolved,
    certainty,
    gmDecision,
  };
}

/** One sentence for a list or for MLB Operations to display. */
export function summarizeCascade(cascade: Cascade): string {
  const usable = cascade.steps.filter((s) => s.usable).length;
  if (cascade.stop === 'absorbed' && usable === 0) {
    return `${cascade.origin.fromTeam} absorbs the loss; no further move is needed.`;
  }
  if (cascade.unresolved.length === 0) {
    return `${usable} ${usable === 1 ? 'move' : 'moves'} resolve it, ending when ${cascade.stopDetail.charAt(0).toLowerCase()}${cascade.stopDetail.slice(1)}`;
  }
  const first = cascade.unresolved[0];
  if (usable === 0) {
    /* "0 moves are defensible" is arithmetic, not a sentence a GM reads. */
    return cascade.stop === 'indeterminate'
      ? `No move follows that Player Development can judge, and ${first.team} is left short at ${first.job}.`
      : `No defensible move follows, and ${first.team} is left short at ${first.job}.`;
  }
  return `${usable} ${usable === 1 ? 'move is' : 'moves are'} defensible, and ${first.team} is left short at ${first.job}.`;
}
