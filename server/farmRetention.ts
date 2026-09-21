/**
 * Does a minor leaguer still have an organizational case? Three separate questions, never one score.
 *
 * The farm v1 model computed a developmental protection score, ADDED a philosophy adjustment to it,
 * and compared the sum with thresholds that decided whether a player was a release candidate. So a
 * club that valued prospects and a club that did not reached different verdicts about the same
 * player on the same evidence, inside a quantity labelled "development" — a live D-019 violation in
 * a judgment that is partly developmental (docs/MINOR_LEAGUE_OPERATIONS.md V-1). It also returned
 * `retain` for anyone with any legal move available, which on the real import meant 104 retains,
 * 141 suppressed by guardrails, and one flag in a 246-player organization.
 *
 * Here the three questions are answered separately and stay separate:
 *
 *   developmental outlook   Player Development: is there still a development case for him?
 *                           Philosophy is not an input and cannot reach it.
 *   operational pressure    Minor League Operations: is he occupying something somebody else needs?
 *   organizational stance   Philosophy: among conclusions that are already defensible, which does
 *                           this club prefer? It may lean on the ORDER and the WORDING and never on
 *                           the outlook (the D-036 rule, applied here).
 *
 * A release is never a transaction and never automatic (D-004). Contract economics do not exist in
 * this codebase, so nothing here pretends to price a player: what is known about his contract is
 * reported as fact and is a guardrail, not a term.
 *
 * Pure: every specialist answer is passed in.
 */

import {
  PROTECTED_TIERS,
  RUNWAY_CLOSING_AGE,
  RUNWAY_SERVICE_LIMIT,
} from './farmCalibration.js';
import type { DevelopmentProtection, DevelopmentProtectionTier } from './developmentFit.js';
import type { CurrentAssignmentRead } from './currentAssignment.js';
import type { AssignmentConclusion } from './farmAssignments.js';

export type RetentionConclusion =
  /** He has a development case, or the organization needs him. No question is raised. */
  | 'retain'
  /**
   * A roster question the GM should look at: no development case left and somebody else needs the
   * spot. Never an instruction and never a release.
   */
  | 'review'
  /**
   * A decision belonging to another process entirely — the 40-man, a major-league contract, an
   * injury. The farm does not decide it and says which process does.
   */
  | 'not_a_farm_decision'
  /** Required evidence is missing and the answer depends on it. */
  | 'indeterminate';

/** Why the farm is not the place to decide. Each names the process that is. */
export interface RetentionGuardrail {
  code:
    | 'on_forty_man'
    | 'major_league_contract'
    | 'roster_status_requires_active'
    | 'on_injured_list'
    | 'protected_prospect'
    | 'developmental_runway_open';
  detail: string;
  /** Which process owns it. */
  owner: string;
}

/** Player Development's answer, with no philosophy in it. */
export interface DevelopmentalOutlook {
  /** Is there still a development case for him at all? */
  state: 'developing' | 'plateaued' | 'exhausted' | 'indeterminate';
  /** Whether his runway at this level and this age is still open. */
  runway: 'open' | 'closing' | 'closed' | 'unknown';
  reasons: string[];
  missing: string[];
}

/** Minor League Operations' answer. */
export interface OperationalPressure {
  state: 'none' | 'some' | 'acute';
  reasons: string[];
  /** Who is waiting on what he occupies, when anyone is. */
  waiting: Array<{ playerId: number; name: string; age: number; what: string }>;
}

/** Philosophy's answer: a lean, never a verdict. */
export interface OrganizationalStance {
  lean: 'patient' | 'neutral' | 'willing';
  /** Which dimension spoke and what it did. Every lean is shown (D-036). */
  reasons: Array<{ dimension: string; value: number; effect: string }>;
  /** What a club with no stated philosophy would have been told. */
  neutralWouldSay: RetentionConclusion;
}

export interface RetentionReview {
  playerId: number;
  name: string;
  age: number;
  teamId: number;
  team: string;
  level: number;
  levelName: string;

  conclusion: RetentionConclusion;
  guardrails: RetentionGuardrail[];

  outlook: DevelopmentalOutlook;
  pressure: OperationalPressure;
  stance: OrganizationalStance;

  /** Contract and roster facts, as facts. Never valued, never scored. */
  facts: Array<{ label: string; value: string }>;

  reasons: string[];
  missing: string[];
  gmDecision: string[];
}

export interface RetentionInput {
  playerId: number;
  name: string;
  age: number;
  teamId: number;
  team: string;
  level: number;
  levelName: string;

  protection: DevelopmentProtection;
  current: CurrentAssignmentRead;
  assignmentConclusion: AssignmentConclusion;

  /** Professional seasons of service, from the export. */
  proServiceYears: number | null;

  /** Roster facts from Player State, read as exported (D-020). Never re-derived here. */
  state: {
    onFortyMan: boolean | null;
    majorLeagueContract: boolean | null;
    mustBeActive: boolean | null;
    onInjuredList: boolean | null;
  };

  /** Minor League Operations: who is waiting on what he occupies. */
  waiting: Array<{ playerId: number; name: string; age: number; what: string }>;

  /** Whether the club he is on is carrying more men than the job supports. */
  clubCrowded: boolean;

  /** Philosophy dimensions, read only after the outlook is fixed. */
  philosophy: { prospectPreservation: number; rosterDepth: number };

  facts: Array<{ label: string; value: string }>;
}

/* ── the developmental outlook: Player Development only ──────────────────────────────────────── */

const isProtected = (tier: DevelopmentProtectionTier | null): boolean =>
  tier !== null && (PROTECTED_TIERS as readonly string[]).includes(tier);

function runwayOf(level: number, age: number, proServiceYears: number | null): DevelopmentalOutlook['runway'] {
  const closingAge =
    level >= 6 ? RUNWAY_CLOSING_AGE.complex : level >= 4 ? RUNWAY_CLOSING_AGE.lowerMinors : RUNWAY_CLOSING_AGE.upperMinors;

  if (proServiceYears !== null && proServiceYears >= RUNWAY_SERVICE_LIMIT && level >= 4) return 'closed';
  if (age >= closingAge + 2) return 'closed';
  if (age >= closingAge) return 'closing';
  return 'open';
}

function outlookOf(input: RetentionInput): DevelopmentalOutlook {
  const runway = runwayOf(input.level, input.age, input.proServiceYears);
  const reasons: string[] = [];
  const missing: string[] = [...input.current.unknowns];

  if (input.protection.tier === null) {
    return {
      state: 'indeterminate',
      runway,
      reasons: ['Developmental protection is indeterminate, so whether there is still a development case cannot be established.'],
      missing: [...missing, ...input.protection.missingEvidence.map((m) => m.detail)],
    };
  }

  if (isProtected(input.protection.tier)) {
    reasons.push(`Player Development places him in the ${input.protection.tier.replace(/_/g, ' ')} tier.`);
    return { state: 'developing', runway, reasons, missing };
  }

  /*
   * A player the level is still developing has a development case whatever his tier, and so does a
   * player whose runway is simply open: an ordinary developmental runway is a fact about his age and
   * his level, not about this season's line. Reading the line first made 124 players with an open
   * runway "indeterminate" because the season had not yet produced forty plate appearances, which
   * is not a retention question about any of them. A closed runway with nothing to read IS
   * indeterminate: whether the level has anything left for him cannot be said.
   */
  if (runway === 'open') {
    reasons.push(`At ${input.age} he still has an ordinary developmental runway at ${input.levelName}.`);
    if (input.current.verdict === 'not_assessable') {
      reasons.push('There is no production to read at his level yet, and none is needed for that.');
    }
    return { state: 'developing', runway, reasons, missing };
  }

  if (input.current.verdict === 'not_assessable') {
    return {
      state: 'indeterminate',
      runway,
      reasons: [
        `At ${input.age} his runway at ${input.levelName} is ${runway}, and there is no production to read at his level yet, so whether the level has anything left for him cannot be said.`,
      ],
      missing,
    };
  }

  if (input.current.verdict === 'appropriate') {
    reasons.push(`The level is still developing him, though at ${input.age} his runway at ${input.levelName} is ${runway}.`);
    return { state: 'plateaued', runway, reasons, missing };
  }

  if (input.current.verdict === 'no_longer_developmental' || input.current.verdict === 'too_advanced') {
    reasons.push(
      input.current.verdict === 'no_longer_developmental'
        ? `The level has nothing left to teach him and at ${input.age} his runway is ${runway}.`
        : `The level is ahead of what he has shown and at ${input.age} his runway is ${runway}.`
    );
    reasons.push(`Player Development places him in the ${input.protection.tier.replace(/_/g, ' ')} tier.`);
    return {
      state: input.protection.tier === 'organizational_depth' ? 'exhausted' : 'plateaued',
      runway,
      reasons,
      missing,
    };
  }

  return { state: 'indeterminate', runway, reasons: input.current.reasons, missing };
}

/* ── operational pressure: Minor League Operations only ──────────────────────────────────────── */

function pressureOf(input: RetentionInput): OperationalPressure {
  const reasons: string[] = [];
  if (input.waiting.length > 0) {
    reasons.push(
      `${input.waiting.map((w) => `${w.name} (${w.age})`).join(', ')} ${input.waiting.length === 1 ? 'is' : 'are'} waiting on ${input.waiting.map((w) => w.what).join(', ')}.`
    );
  }
  if (input.clubCrowded) {
    reasons.push('His club is carrying more men at the job than it can give developmental work to.');
  }
  if (reasons.length === 0) {
    reasons.push('Nothing the organization is trying to do is waiting on his roster spot.');
    return { state: 'none', reasons, waiting: [] };
  }
  return {
    state: input.waiting.length > 0 && input.clubCrowded ? 'acute' : 'some',
    reasons,
    waiting: input.waiting,
  };
}

/* ── the conclusion, and only then philosophy ────────────────────────────────────────────────── */

function guardrailsOf(input: RetentionInput): RetentionGuardrail[] {
  const out: RetentionGuardrail[] = [];
  if (input.state.onFortyMan === true) {
    out.push({
      code: 'on_forty_man',
      detail: 'He is on the 40-man roster as exported, so removing him is a major-league roster action with its own rights and consequences.',
      owner: 'Player Rights and MLB Operations',
    });
  }
  if (input.state.majorLeagueContract === true) {
    out.push({
      code: 'major_league_contract',
      detail: 'He is on a major-league contract, so the money and the roster consequences belong to the major-league club.',
      owner: 'MLB Operations',
    });
  }
  if (input.state.mustBeActive === true) {
    out.push({
      code: 'roster_status_requires_active',
      detail: 'His roster status requires him to remain active.',
      owner: 'Player State',
    });
  }
  if (input.state.onInjuredList === true) {
    out.push({
      code: 'on_injured_list',
      detail: 'He is on an injured list; what he is when healthy is not established while he is on it.',
      owner: 'Player State',
    });
  }
  if (isProtected(input.protection.tier)) {
    out.push({
      code: 'protected_prospect',
      detail: `Player Development places him in the ${String(input.protection.tier).replace(/_/g, ' ')} tier, which is not routine roster material.`,
      owner: 'Player Development',
    });
  }
  return out;
}

export function reviewRetention(input: RetentionInput): RetentionReview {
  const outlook = outlookOf(input);
  const pressure = pressureOf(input);
  const guardrails = guardrailsOf(input);
  const reasons: string[] = [];

  /*
   * A decision that belongs to another process is named as such before anything else is said about
   * it. Nothing about the farm's own reading is suppressed — it is all still reported — but the
   * conclusion says whose decision it is.
   */
  let neutral: RetentionConclusion;
  if (outlook.state === 'indeterminate') {
    neutral = 'indeterminate';
    reasons.push(...outlook.reasons);
  } else if (outlook.state === 'developing') {
    neutral = 'retain';
    reasons.push(...outlook.reasons);
  } else if (pressure.state === 'none') {
    neutral = 'retain';
    reasons.push(...outlook.reasons);
    reasons.push('Nothing is waiting on his roster spot, so there is no question to raise.');
  } else {
    neutral = 'review';
    reasons.push(...outlook.reasons);
    reasons.push(...pressure.reasons);
  }

  /*
   * Philosophy, and only now. It may lean on a `review` — a patient organization is told to watch
   * where a willing one is told to look — and it can never turn a `retain` into a `review` or reach
   * the outlook, because the outlook is Player Development's (D-019) and a release question is not
   * something a preference may manufacture.
   */
  const stanceReasons: OrganizationalStance['reasons'] = [];
  let lean: OrganizationalStance['lean'] = 'neutral';
  if (input.philosophy.prospectPreservation >= 65) {
    lean = 'patient';
    stanceReasons.push({
      dimension: 'prospectPreservation',
      value: input.philosophy.prospectPreservation,
      effect: 'The organization prefers to give a fading player more time, so the question is raised more quietly.',
    });
  } else if (input.philosophy.prospectPreservation <= 35 && input.philosophy.rosterDepth <= 50) {
    lean = 'willing';
    stanceReasons.push({
      dimension: 'prospectPreservation',
      value: input.philosophy.prospectPreservation,
      effect: 'The organization is readier to move on, so the question is raised more prominently.',
    });
  }

  const conclusion: RetentionConclusion = guardrails.length > 0 && neutral === 'review' ? 'not_a_farm_decision' : neutral;

  if (conclusion === 'not_a_farm_decision') {
    reasons.unshift(
      `This is not the farm system's decision: ${guardrails.map((g) => g.owner).join(' and ')} own it. ${guardrails[0].detail}`
    );
  }

  const gmDecision = ['Whether to do anything at all. Pennant raises questions and executes nothing.'];
  if (conclusion === 'review') {
    gmDecision.push('Whether the roster spot is worth more to the organization than he is.');
  }
  if (conclusion === 'not_a_farm_decision') {
    gmDecision.push(`Whether to take it up in ${guardrails[0].owner}.`);
  }

  return {
    playerId: input.playerId,
    name: input.name,
    age: input.age,
    teamId: input.teamId,
    team: input.team,
    level: input.level,
    levelName: input.levelName,
    conclusion,
    guardrails,
    outlook,
    pressure,
    stance: { lean, reasons: stanceReasons, neutralWouldSay: neutral },
    facts: input.facts,
    reasons,
    missing: [...new Set([...outlook.missing])],
    gmDecision,
  };
}
