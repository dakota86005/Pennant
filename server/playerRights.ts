/**
 * Player Rights: given what is true and what explicitly happened, which roster
 * transactions are available, unavailable, or not yet establishable?
 *
 * This is the third of three concerns kept apart (D-020):
 *
 *   Current State        `playerState.ts`   what is true now
 *   Transaction history  `transactionLog.ts` what explicitly happened
 *   Rights               this module        what may be done, given both
 *
 * The evaluator is pure. It reads a `PlayerState`, an `AssignmentContext`, the
 * exported `LeagueRules`, roster counts, and how current each source is. It
 * never opens a table or a log, and never re-derives a fact the state layer
 * already exports.
 *
 * Every action is evaluated independently and answers `eligible`, `ineligible`
 * or `indeterminate`. Indeterminate is not permission and not a refusal: it
 * means the rule or the evidence needed to decide is missing, and it says
 * which. Each reason names its basis — a value the export states, behavior
 * observed in a controlled copied-save experiment, or an OOTP-documented rule
 * — so a GM can see how much weight a conclusion carries. The rules and the
 * experiments behind them are recorded in docs/RIGHTS_RESEARCH.md.
 */

import type { AssignmentContext } from './assignmentContext.js';
import type { SourceState } from './dataFreshness.js';
import type { ContractRules, LeagueRules } from './leagueRules.js';
import type { PlayerState, ServiceClassMember } from './playerState.js';
import { policy, type CalibrationStamp } from './calibration.js';
import { UNKNOWN_REASON_TEXT, type Sourced } from './provenance.js';

export type RightsAction =
  | 'option'
  | 'recall'
  | 'addToFortyMan'
  | 'designateForAssignment'
  | 'outrightAssignment'
  | 'activateFromInjuredList'
  | 'placeOnSixtyDayIl';

export const RIGHTS_ACTIONS: RightsAction[] = [
  'option', 'recall', 'addToFortyMan', 'designateForAssignment', 'outrightAssignment', 'activateFromInjuredList',
  'placeOnSixtyDayIl',
];

export type RightsStatus = 'eligible' | 'ineligible' | 'indeterminate';

/** How a reason is known. Weakest to strongest is not implied by order. */
export type RuleBasis =
  /** A value the current export states. */
  | 'export_state'
  /** Behavior seen in a controlled copied-save experiment. */
  | 'observed'
  /** Stated by OOTP's own wiki/manual and consistent with what was observed. */
  | 'documented'
  | 'observed_and_documented'
  /** Stated by the owner as how OOTP behaves (not a guess from MLB rules): D-018, D-023. */
  | 'owner_attested';

export interface RightsReason {
  code: string;
  message: string;
  basis: RuleBasis;
  /** The state field(s) or rule the reason rests on. */
  source: string;
}

export interface RightsRequirement {
  kind: 'active_roster_spot' | 'forty_man_spot' | 'waivers_cleared';
  /** `unmet` does not make the action ineligible: it says what must happen first. */
  status: 'met' | 'unmet' | 'unknown';
  message: string;
}

export type MissingEvidenceCode =
  | 'current_state_stale'
  | 'current_state_unavailable'
  | 'chronology_behind'
  | 'chronology_unavailable'
  | 'assignment_cause_unknown'
  | 'field_not_exported'
  | 'rule_not_established'
  /** A projected service band has a threshold inside it: which side he ends on is not yet decided. */
  | 'projection_straddles_threshold';

export interface MissingEvidence {
  code: MissingEvidenceCode;
  message: string;
}

export interface ActionRights {
  action: RightsAction;
  status: RightsStatus;
  /** One short GM-facing line. */
  label: string;
  reasons: RightsReason[];
  requirements: RightsRequirement[];
  missing: MissingEvidence[];
  /** Numbers the reasons rest on (days left, remaining option years, limits). */
  facts: Record<string, string | number | boolean | null>;
  /** What this conclusion cannot promise, where that matters. */
  limitation: string | null;
}

export interface OptionYears {
  used: number | null;
  remaining: number | null;
  usedThisSeason: number | null;
  standing: 'available' | 'exhausted' | 'exhausted_charged_this_season' | 'indeterminate';
}

export interface RuleFiveStanding {
  status: 'protected_by_forty_man' | 'not_applicable' | 'indeterminate';
  message: string;
  facts: Record<string, number | null>;
  missing: MissingEvidence[];
}

export interface RightsEvidence {
  /** The CSV export against the save. `behind` means stale. */
  currentState: SourceState;
  /** The live transaction log against the save. */
  chronology: SourceState;
}

export interface RosterCounts {
  /** Players on the active roster; null when any player's flag was not exported. */
  active: number | null;
  /** Players on the 40-man; null when any player's flag was not exported. */
  fortyMan: number | null;
}

export interface RightsContext {
  state: PlayerState;
  assignment: AssignmentContext | null;
  league: LeagueRules;
  counts: RosterCounts;
  evidence: RightsEvidence;
  /**
   * How far the season's service clock has run in the player's contract-regime
   * league (`seasonServiceClocks` in `playerState.ts`). Optional: without it the
   * projection's high edge is the most service the player could still bank.
   */
  serviceClock?: Sourced<number>;
  /** The Super Two cutoff for the player's contract regime (`superTwoCutoffs`); without it the window is indeterminate. */
  superTwo?: SuperTwoCutoff | null;
}

export interface PlayerRights {
  playerId: number;
  evidence: RightsEvidence;
  optionYears: OptionYears;
  ruleFive: RuleFiveStanding;
  actions: Record<RightsAction, ActionRights>;
  /**
   * Component actions evaluated for a player who is not yet where the action
   * needs him to be, assuming the first component is done. They are components,
   * not a combined transaction: a caller composes them (add to the 40-man, then
   * place on the active roster) and each keeps its own status and requirement.
   */
  composed: {
    /** Place a player who is not on the 40-man on the active roster, once he has been added to it. Null when the player is already on the 40-man (use `recall`) or at the major-league club. */
    promoteToActive: ActionRights | null;
  };
  /** Arbitration and free-agency eligibility for this season and the next (Q-1, D-052). */
  contractControl: ContractControlEligibility;
}

/** Three option years exist in OOTP (wiki); no fourth is documented or observed. */
export const OPTION_YEARS = 3;
/** Five years of MLB service lets a player refuse a minor-league assignment (wiki; observed 5, 5, 6, 13 refused, 4, 3, 0 accepted). */
export const CONSENT_SERVICE_YEARS = 5;

// ── counts ──────────────────────────────────────────────────────────────────

/** Roster counts for an organization from the exported flags, or null where any flag is unknown. */
export function rosterCounts(states: PlayerState[]): RosterCounts {
  const count = (pick: (s: PlayerState) => Sourced<boolean>): number | null => {
    let n = 0;
    for (const s of states) {
      const v = pick(s).value;
      if (v === null) return null;
      if (v) n += 1;
    }
    return n;
  };
  return { active: count((s) => s.activeRoster), fortyMan: count((s) => s.fortyMan) };
}

// ── builders ────────────────────────────────────────────────────────────────

const reason = (code: string, message: string, basis: RuleBasis, source: string): RightsReason => ({
  code, message, basis, source,
});

const result = (
  action: RightsAction,
  status: RightsStatus,
  label: string,
  parts: Partial<Pick<ActionRights, 'reasons' | 'requirements' | 'missing' | 'facts' | 'limitation'>> = {}
): ActionRights => ({
  action, status, label,
  reasons: parts.reasons ?? [],
  requirements: parts.requirements ?? [],
  missing: parts.missing ?? [],
  facts: parts.facts ?? {},
  limitation: parts.limitation ?? null,
});

interface Need {
  label: string;
  field: Sourced<unknown>;
}

const need = (label: string, field: Sourced<unknown>): Need => ({ label, field });

/** Every needed field that is unknown, with why. */
function unknownFields(needs: Need[]): MissingEvidence[] {
  return needs
    .filter((n) => n.field.value === null)
    .map((n) => ({
      code: 'field_not_exported' as const,
      message: `${n.label} is not available: ${n.field.reason ? UNKNOWN_REASON_TEXT[n.field.reason] : 'no source states it'}.`,
    }));
}

/** Indeterminate because a field this action needs is unknown; null when every one is known. */
function requireFields(action: RightsAction, label: string, needs: Need[]): ActionRights | null {
  const missing = unknownFields(needs);
  return missing.length === 0 ? null : result(action, 'indeterminate', label, { missing });
}

const isFresh = (s: SourceState): boolean => s === 'current' || s === 'unverified';

/** Stale or unavailable current state makes every conclusion unsafe; chronology is judged per action. */
function currentStateGate(action: RightsAction, ctx: RightsContext): ActionRights | null {
  const s = ctx.evidence.currentState;
  if (s === 'behind') {
    return result(action, 'indeterminate', 'Rights unknown: roster data is behind the save', {
      missing: [{
        code: 'current_state_stale',
        message: 'The imported export is older than the save, so what this player can do now cannot be stated. Export the database again.',
      }],
    });
  }
  if (s === 'unavailable') {
    return result(action, 'indeterminate', 'Rights unknown: no roster data', {
      missing: [{ code: 'current_state_unavailable', message: 'No OOTP export is imported.' }],
    });
  }
  return null;
}

const level = (c: RightsContext): number | null => c.state.level.value;
const onIl = (c: RightsContext): boolean | null => {
  const a = c.state.injuredList.onIl.value;
  const b = c.state.injuredList.onIl60.value;
  return a === null || b === null ? null : a || b;
};

/** The active-roster limit in force, or null when the league's rules are unknown. */
export function activeLimit(league: LeagueRules): number | null {
  const expanded = league.rostersExpanded.value;
  if (expanded === null) return null;
  return expanded ? league.expandedRosterLimit.value : league.activeRosterLimit.value;
}

function spotRequirement(
  kind: 'active_roster_spot' | 'forty_man_spot',
  count: number | null,
  limit: number | null,
  noun: string
): RightsRequirement {
  if (count === null || limit === null) {
    return { kind, status: 'unknown', message: `The ${noun} count or limit is not available.` };
  }
  return count < limit
    ? { kind, status: 'met', message: `${noun}: ${count} of ${limit}; a spot is open.` }
    : { kind, status: 'unmet', message: `${noun} is full (${count} of ${limit}); a spot must be opened first.` };
}

// ── option years (a state-derived fact, independent of where he is now) ─────

export function optionYearsOf(ctx: RightsContext): OptionYears {
  const used = ctx.state.options.used.value;
  const thisSeason = ctx.state.options.usedThisYear.value;
  const enabled = ctx.league.minorLeagueOptions.value;
  const remaining = used === null ? null : Math.max(0, OPTION_YEARS - used);
  let standing: OptionYears['standing'] = 'indeterminate';
  if (enabled === true && used !== null) {
    if (used < OPTION_YEARS) standing = 'available';
    else if (thisSeason === null) standing = 'indeterminate';
    else standing = thisSeason === 0 ? 'exhausted' : 'exhausted_charged_this_season';
  }
  return { used, remaining, usedThisSeason: thisSeason, standing };
}

// ── actions ─────────────────────────────────────────────────────────────────

function evaluateOption(ctx: RightsContext): ActionRights {
  const a: RightsAction = 'option';
  const s = ctx.state;
  const gate = currentStateGate(a, ctx) ?? requireFields(a, 'Option status unknown', [
    need('Club level', s.level), need('Active-roster flag', s.activeRoster),
  ]);
  if (gate) return gate;

  if (level(ctx) !== 1) {
    const rehab = ctx.assignment?.kind === 'rehab_assignment';
    return result(a, 'ineligible', rehab ? 'On rehab assignment' : 'Already in the minors', {
      reasons: [reason(
        'not_on_major_league_club',
        rehab
          ? 'He is on an injury-rehab assignment, which is not an optional assignment; he is not on the major-league club to be optioned.'
          : 'An option moves a player from the major-league club to the minors; he is not on the major-league club.',
        'export_state', 'teams.level'
      )],
    });
  }
  // The injured list is checked first: it is why he is off the active roster, and it is the reason OOTP gives
  if (onIl(ctx) === true) {
    return result(a, 'ineligible', 'On the injured list', {
      reasons: [reason(
        'on_injured_list',
        'A player on the injured list cannot be optioned (OOTP: "isn\'t eligible to be demoted yet").',
        'observed', 'players_roster_status.is_on_dl'
      )],
    });
  }
  if (s.activeRoster.value === false) {
    return result(a, 'ineligible', 'Not on the active roster', {
      reasons: [reason('not_on_active_roster', 'He is with the major-league club but not on its active roster.', 'export_state', 'players_roster_status.is_active')],
    });
  }
  const injured = requireFields(a, 'Option status unknown', [
    need('Injured-list flag', s.injuredList.onIl), need('60-day injured-list flag', s.injuredList.onIl60),
  ]);
  if (injured) return injured;
  const fields = requireFields(a, 'Option status unknown', [
    need('League option rule', ctx.league.minorLeagueOptions), need('Years of MLB service', s.serviceTime.mlbYears),
    need('Option years used', s.options.used), need('Options used this year', s.options.usedThisYear),
  ]);
  if (fields) return fields;

  if (ctx.league.minorLeagueOptions.value === false) {
    return result(a, 'indeterminate', 'Option status unknown', {
      reasons: [reason('options_disabled', 'This league has option years switched off; what a demotion costs here has not been observed.', 'export_state', 'leagues.rules_minor_league_options')],
      missing: [{ code: 'rule_not_established', message: 'Demotion without option years has not been observed.' }],
    });
  }

  const years = s.serviceTime.mlbYears.value!;
  const used = s.options.used.value!;
  const thisSeason = s.options.usedThisYear.value!;
  const facts = { mlbServiceYears: years, optionYearsUsed: used, optionYearsRemaining: Math.max(0, OPTION_YEARS - used), optionedThisSeason: thisSeason };
  const blocks: RightsReason[] = [];
  if (years >= CONSENT_SERVICE_YEARS) {
    blocks.push(reason(
      'may_refuse_assignment',
      `With ${years} years of major-league service he can refuse a minor-league assignment (OOTP: "player refuses to be demoted").`,
      'observed_and_documented', 'players_roster_status.mlb_service_years'
    ));
  }
  const exhausted = used >= OPTION_YEARS;
  if (exhausted && thisSeason === 0) {
    blocks.push(reason(
      'out_of_options',
      'All three option years are used; he must clear irrevocable waivers before he can be demoted (OOTP: "out of option years and must clear waivers").',
      'observed_and_documented', 'players_roster_status.options_used'
    ));
  }
  if (blocks.length > 0) return result(a, 'ineligible', years >= CONSENT_SERVICE_YEARS ? 'Cannot be optioned — may refuse' : 'Cannot be optioned — out of options', { reasons: blocks, facts });
  if (exhausted) {
    return result(a, 'indeterminate', 'Option status unknown', {
      reasons: [reason(
        'option_year_already_charged',
        'All three option years are used and one was charged this season. Whether he can be sent down again without waivers has not been observed.',
        'export_state', 'players_roster_status.options_used_this_year'
      )],
      missing: [{ code: 'rule_not_established', message: 'Re-optioning within the season that used the last option year has not been observed.' }],
      facts,
    });
  }
  return result(a, 'eligible', `Option eligible — ${facts.optionYearsRemaining} year${facts.optionYearsRemaining === 1 ? '' : 's'} left`, {
    reasons: [reason(
      'option_years_remaining',
      `${used} of ${OPTION_YEARS} option years used and ${years} years of service: OOTP allowed an option in every observed case like this.`,
      'observed_and_documented', 'players_roster_status.options_used'
    )],
    facts,
    limitation: 'An option year is charged at the next day rollover once he has spent a day off the active roster; a same-day round trip costs none.',
  });
}

function evaluateRecall(ctx: RightsContext): ActionRights {
  const a: RightsAction = 'recall';
  const s = ctx.state;
  const gate = currentStateGate(a, ctx) ?? requireFields(a, 'Recall status unknown', [
    need('Club level', s.level), need('40-man flag', s.fortyMan), need('Designated-for-assignment flag', s.dfa.designated),
  ]);
  if (gate) return gate;

  if (level(ctx) === 1) {
    return result(a, 'ineligible', 'Already with the major-league club', {
      reasons: [reason('already_with_major_league_club', 'He is already on the major-league club; use activation from the injured list or the active-roster move that applies.', 'export_state', 'teams.level')],
    });
  }
  if (s.dfa.designated.value === true) {
    return result(a, 'ineligible', 'Designated for assignment', {
      reasons: [reason('designated_for_assignment', 'He is in DFA limbo and must be assigned, traded, released or restored first.', 'export_state', 'players_roster_status.designated_for_assignment')],
    });
  }
  if (s.fortyMan.value === false) {
    return result(a, 'ineligible', 'Not on the 40-man', {
      reasons: [reason('not_on_forty_man', 'A player who is not on the 40-man cannot be recalled; his contract must first be added to it.', 'export_state', 'players_roster_status.is_on_secondary')],
    });
  }
  const il = requireFields(a, 'Recall status unknown', [
    need('Injured-list flag', s.injuredList.onIl), need('60-day injured-list flag', s.injuredList.onIl60),
  ]);
  if (il) return il;
  if (onIl(ctx)) {
    return result(a, 'indeterminate', 'Recall status unknown — injured', {
      reasons: [reason('injured_list_recall', 'He is on an injured list below the major-league club; recalling an injured player has not been observed.', 'export_state', 'players_roster_status.is_on_dl')],
      missing: [{ code: 'rule_not_established', message: 'Recalling a player from a minor-league injured list has not been observed.' }],
    });
  }

  // Why he is below MLB decides whether this is an ordinary recall. A rehab
  // assignment looks identical to an option in the export; only the log tells.
  const assignment = ctx.assignment;
  const chronologyFresh = isFresh(ctx.evidence.chronology);
  if (assignment?.kind === 'rehab_assignment') {
    return result(a, 'indeterminate', 'On rehab assignment', {
      reasons: [reason('rehab_assignment', 'He is on an injury-rehab assignment. Returning from one is not an ordinary recall and its rules have not been observed.', 'observed', 'assignmentContext.rehab')],
      missing: [{ code: 'rule_not_established', message: 'Returning a player from a rehab assignment has not been observed.' }],
    });
  }
  if (assignment?.kind !== 'optioned' || !chronologyFresh) {
    const missing: MissingEvidence[] = [];
    if (ctx.evidence.chronology === 'unavailable') {
      missing.push({ code: 'chronology_unavailable', message: 'The transaction log is unavailable, so an option cannot be told apart from a rehab assignment.' });
    } else if (ctx.evidence.chronology === 'behind') {
      missing.push({ code: 'chronology_behind', message: 'The transaction log is behind the save; a move that placed him here may not be in it.' });
    }
    if (assignment?.kind !== 'optioned') {
      missing.push({ code: 'assignment_cause_unknown', message: assignment?.note ?? 'No explicit transaction establishes why he is below the major-league club.' });
    }
    return result(a, 'indeterminate', 'Recall status unknown — assignment cause not established', { missing });
  }

  const requirement = spotRequirement('active_roster_spot', ctx.counts.active, activeLimit(ctx.league), 'The active roster');
  const facts = { activeRosterCount: ctx.counts.active, activeRosterLimit: activeLimit(ctx.league), optionedOn: assignment.since };
  if (requirement.status === 'unknown') {
    return result(a, 'indeterminate', 'Recall status unknown — roster size unknown', {
      requirements: [requirement],
      missing: [{ code: 'field_not_exported', message: requirement.message }],
      facts,
    });
  }
  return result(a, 'eligible', requirement.status === 'unmet' ? 'Recall eligible — active roster full' : 'Recall eligible', {
    reasons: [reason(
      'optioned_and_recallable',
      'He is on the 40-man, optioned, and not on an injured list, in DFA, or on rehab. OOTP enforced no minimum time in the minors: same-day and next-day recalls were accepted.',
      'observed', 'assignmentContext.optioned'
    )],
    requirements: [requirement],
    facts,
    limitation: 'MLB\'s 10/15-day minimum stay was not enforced in any observed case; a league setting could differ.',
  });
}

function evaluateAddToFortyMan(ctx: RightsContext): ActionRights {
  const a: RightsAction = 'addToFortyMan';
  const s = ctx.state;
  const gate = currentStateGate(a, ctx) ?? requireFields(a, 'Roster status unknown', [
    need('40-man flag', s.fortyMan), need('60-day injured-list flag', s.injuredList.onIl60), need('Designated-for-assignment flag', s.dfa.designated),
  ]);
  if (gate) return gate;

  if (s.fortyMan.value === true) {
    return result(a, 'ineligible', 'Already on the 40-man', {
      reasons: [reason('already_on_forty_man', 'He is already on the 40-man roster.', 'export_state', 'players_roster_status.is_on_secondary')],
    });
  }
  if (s.injuredList.onIl60.value === true) {
    return result(a, 'indeterminate', '60-day IL — return not established', {
      reasons: [reason('sixty_day_il', 'He is on the 60-day injured list, which removes a player from the 40-man. What OOTP requires to bring him back has not been observed.', 'export_state', 'players_roster_status.is_on_dl60')],
      missing: [{ code: 'rule_not_established', message: 'Activation from the 60-day injured list onto a full 40-man has not been observed.' }],
    });
  }
  const requirement = spotRequirement('forty_man_spot', ctx.counts.fortyMan, ctx.league.fortyManLimit.value, 'The 40-man roster');
  const facts = { fortyManCount: ctx.counts.fortyMan, fortyManLimit: ctx.league.fortyManLimit.value };
  if (requirement.status === 'unknown') {
    return result(a, 'indeterminate', 'Roster status unknown — 40-man size unknown', {
      requirements: [requirement], missing: [{ code: 'field_not_exported', message: requirement.message }], facts,
    });
  }
  const restored = s.dfa.designated.value === true;
  return result(a, 'eligible', requirement.status === 'unmet' ? 'Can be added — 40-man full' : 'Can be added to the 40-man', {
    reasons: [reason(
      restored ? 'restore_from_dfa' : 'off_forty_man',
      restored
        ? 'He is designated for assignment; OOTP restored a DFA player to the 40-man and the active roster at the end of the period.'
        : 'He is not on the 40-man; a spot is the only requirement OOTP was seen to enforce.',
      restored ? 'observed_and_documented' : 'documented', 'players_roster_status.is_on_secondary'
    )],
    requirements: [requirement],
    facts,
  });
}

function evaluateDesignate(ctx: RightsContext): ActionRights {
  const a: RightsAction = 'designateForAssignment';
  const s = ctx.state;
  const gate = currentStateGate(a, ctx) ?? requireFields(a, 'DFA status unknown', [
    need('40-man flag', s.fortyMan), need('Designated-for-assignment flag', s.dfa.designated),
  ]);
  if (gate) return gate;

  if (s.dfa.designated.value === true) {
    return result(a, 'ineligible', `Already designated — ${s.dfa.daysLeft.value ?? '?'} days left`, {
      reasons: [reason('already_designated', 'He is already designated for assignment.', 'export_state', 'players_roster_status.designated_for_assignment')],
      facts: { dfaDaysLeft: s.dfa.daysLeft.value },
    });
  }
  if (s.fortyMan.value === false) {
    return result(a, 'ineligible', 'Not on the 40-man', {
      reasons: [reason('not_on_forty_man', 'Designating removes a player from the 40-man; he is not on it.', 'export_state', 'players_roster_status.is_on_secondary')],
    });
  }
  const il = requireFields(a, 'DFA status unknown', [need('Injured-list flag', s.injuredList.onIl), need('60-day injured-list flag', s.injuredList.onIl60)]);
  if (il) return il;
  if (onIl(ctx) || ctx.assignment?.kind === 'rehab_assignment') {
    return result(a, 'indeterminate', 'DFA status unknown', {
      reasons: [reason('injured_or_rehab', 'He is on an injured list or a rehab assignment; designating such a player has not been observed.', 'export_state', 'players_roster_status.is_on_dl')],
      missing: [{ code: 'rule_not_established', message: 'Designating an injured or rehabbing player has not been observed.' }],
    });
  }
  const years = s.serviceTime.mlbYears.value;
  return result(a, 'eligible', 'Can be designated', {
    reasons: [reason(
      'on_forty_man',
      'He is on the 40-man. Designating removes him from the 40-man and the active roster immediately; he counts against no roster limit while designated.',
      'observed_and_documented', 'players_roster_status.is_on_secondary'
    )],
    facts: {
      dfaPeriodDays: ctx.league.dfaPeriodDays.value,
      waiverPeriodDays: ctx.league.waiverPeriodDays.value,
      mayRefuseOutright: years === null ? null : years >= CONSENT_SERVICE_YEARS,
    },
    limitation: 'Whether the waivers will be irrevocable is not predicted; read the flag once he is designated.',
  });
}

function evaluateOutright(ctx: RightsContext): ActionRights {
  const a: RightsAction = 'outrightAssignment';
  const s = ctx.state;
  const gate = currentStateGate(a, ctx) ?? requireFields(a, 'Assignment status unknown', [need('Designated-for-assignment flag', s.dfa.designated)]);
  if (gate) return gate;

  if (s.dfa.designated.value !== true) {
    return result(a, 'ineligible', 'Not designated', {
      reasons: [reason('not_designated', 'Only a player designated for assignment can be assigned to the minors this way.', 'export_state', 'players_roster_status.designated_for_assignment')],
    });
  }
  const fields = requireFields(a, 'Assignment status unknown', [
    need('Years of MLB service', s.serviceTime.mlbYears), need('Waiver flag', s.dfa.onWaivers), need('Waiver days left', s.dfa.waiverDaysLeft),
  ]);
  if (fields) return fields;

  const years = s.serviceTime.mlbYears.value!;
  const waiverDaysLeft = s.dfa.waiverDaysLeft.value!;
  const facts = { dfaDaysLeft: s.dfa.daysLeft.value, waiverDaysLeft, mlbServiceYears: years };
  if (years >= CONSENT_SERVICE_YEARS) {
    return result(a, 'ineligible', 'May refuse assignment', {
      reasons: [reason(
        'may_refuse_assignment',
        `With ${years} years of service he can refuse assignment to the minors; he must then be released, traded or restored.`,
        'observed_and_documented', 'players_roster_status.mlb_service_years'
      )],
      facts,
    });
  }
  if (s.dfa.onWaivers.value === true && waiverDaysLeft > 0) {
    return result(a, 'ineligible', `On waivers — ${waiverDaysLeft} day${waiverDaysLeft === 1 ? '' : 's'} left`, {
      reasons: [reason('waivers_not_cleared', 'He can be sent to the minors only after clearing waivers.', 'documented', 'players_roster_status.days_on_waivers_left')],
      requirements: [{ kind: 'waivers_cleared', status: 'unmet', message: `Waivers clear in ${waiverDaysLeft} day${waiverDaysLeft === 1 ? '' : 's'}; the DFA period ends in ${s.dfa.daysLeft.value ?? '?'}.` }],
      facts,
    });
  }
  return result(a, 'eligible', `Can be assigned — DFA ends in ${s.dfa.daysLeft.value ?? '?'} days`, {
    reasons: [reason(
      'waivers_cleared',
      'The claim window has passed. In both observed cases a player under 5 years of service was outrighted and left the 40-man.',
      'observed_and_documented', 'players_roster_status.days_on_waivers_left'
    )],
    requirements: [{ kind: 'waivers_cleared', status: 'met', message: 'The waiver window has ended.' }],
    facts,
    limitation: 'OOTP stops the sim when the DFA period ends until he is assigned or released.',
  });
}

/**
 * Place a player who is NOT on the 40-man onto the active roster, assuming his
 * contract has first been added to the 40-man (`addToFortyMan`). The 40-man spot
 * belongs to that first component; this one owns the active-roster spot and the
 * conditions on the player himself.
 *
 * Established by the export, not by an experiment: in the imported saves every
 * club's active roster is a subset of its 40-man (30 of 30 clubs, no exceptions),
 * so placing a player on the active roster necessarily follows adding him to the
 * 40-man. The active limit is likewise never exceeded (26 on every club).
 * Nothing about a rehab or an option is at issue for a player off the 40-man,
 * so this needs no chronology.
 */
function evaluatePromoteToActive(ctx: RightsContext): ActionRights | null {
  const a: RightsAction = 'recall';
  const s = ctx.state;
  if (s.fortyMan.value !== false || level(ctx) === 1) return null;
  const label = 'Place on the active roster (after the 40-man addition)';
  const gate = currentStateGate(a, ctx) ?? requireFields(a, label, [
    need('Club level', s.level), need('Designated-for-assignment flag', s.dfa.designated),
    need('Injured-list flag', s.injuredList.onIl), need('60-day injured-list flag', s.injuredList.onIl60),
  ]);
  if (gate) return { ...gate, action: a, label };
  if (s.dfa.designated.value === true) {
    return result(a, 'ineligible', 'Designated for assignment', {
      reasons: [reason('designated_for_assignment', 'He is in DFA limbo and must be assigned, traded, released or restored first.', 'export_state', 'players_roster_status.designated_for_assignment')],
    });
  }
  if (onIl(ctx)) {
    return result(a, 'indeterminate', 'On an injured list — placement not established', {
      reasons: [reason('injured_list_promotion', 'He is on an injured list below the major-league club; promoting an injured player has not been observed.', 'export_state', 'players_roster_status.is_on_dl')],
      missing: [{ code: 'rule_not_established', message: 'Promoting a player from a minor-league injured list has not been observed.' }],
    });
  }
  const requirement = spotRequirement('active_roster_spot', ctx.counts.active, activeLimit(ctx.league), 'The active roster');
  const facts = { activeRosterCount: ctx.counts.active, activeRosterLimit: activeLimit(ctx.league) };
  if (requirement.status === 'unknown') {
    return result(a, 'indeterminate', 'Placement unknown — roster size unknown', {
      requirements: [requirement], missing: [{ code: 'field_not_exported', message: requirement.message }], facts,
    });
  }
  return result(a, 'eligible', requirement.status === 'unmet' ? 'Can be placed — active roster full' : 'Can be placed on the active roster', {
    reasons: [reason(
      'active_roster_follows_forty_man',
      'An active player is always on the 40-man (30 of 30 clubs in the export), so once his contract is added he can occupy an active spot if one is open.',
      'export_state', 'players_roster_status.is_active'
    )],
    requirements: [requirement],
    facts,
    limitation: 'Assumes the 40-man addition (its own action) has been made first.',
  });
}

/**
 * Activation from an injured list is NOT established, and this returns
 * `indeterminate` on purpose. What is established is stated precisely so a
 * caller can say what it knows: which list, days left, whether he has healed,
 * whether the active roster (and, from the 60-day list, the 40-man) has a spot.
 * What is not: whether an injured player can be activated early, and what OOTP
 * does when there is no spot. OOTP's documentation is silent on both, and the
 * controlled experiment that would settle them has not been run (RIGHTS_RESEARCH
 * section 4.9 states it).
 */
function evaluateActivateFromIl(ctx: RightsContext): ActionRights {
  const a: RightsAction = 'activateFromInjuredList';
  const s = ctx.state;
  const gate = currentStateGate(a, ctx) ?? requireFields(a, 'IL status unknown', [
    need('Injured-list flag', s.injuredList.onIl), need('60-day injured-list flag', s.injuredList.onIl60),
  ]);
  if (gate) return gate;

  if (!onIl(ctx)) {
    return result(a, 'ineligible', 'Not on the injured list', {
      reasons: [reason('not_on_injured_list', 'He is not on an injured list.', 'export_state', 'players_roster_status.is_on_dl')],
    });
  }
  const sixty = s.injuredList.onIl60.value === true;
  const daysLeft = s.injury.daysLeft.value;
  const healed = daysLeft === null ? null : daysLeft <= 0;
  const requirements: RightsRequirement[] = [
    spotRequirement('active_roster_spot', ctx.counts.active, activeLimit(ctx.league), 'The active roster'),
  ];
  if (sixty) requirements.push(spotRequirement('forty_man_spot', ctx.counts.fortyMan, ctx.league.fortyManLimit.value, 'The 40-man roster'));

  const missing: MissingEvidence[] = [];
  if (healed === false) {
    missing.push({ code: 'rule_not_established', message: `He has ${daysLeft} injury day(s) left. Whether OOTP lets a manager activate an injured player early has not been observed.` });
  }
  if (requirements.some((r) => r.status === 'unmet')) {
    missing.push({ code: 'rule_not_established', message: sixty && requirements.find((r) => r.kind === 'forty_man_spot')?.status === 'unmet'
      ? 'A roster is full. Whether OOTP refuses the activation or forces a corresponding move has not been observed.'
      : 'The active roster is full. Whether OOTP refuses the activation or forces a corresponding move has not been observed.' });
  }
  if (missing.length === 0) {
    missing.push({ code: 'rule_not_established', message: 'Activation from an injured list has not been observed, even with a healed player and a spot open.' });
  }
  return result(a, 'indeterminate', sixty ? '60-day IL — activation not established' : 'IL activation not established', {
    reasons: [reason(
      sixty ? 'sixty_day_il' : 'ten_day_il',
      sixty
        ? 'He is on the 60-day list and off the 40-man, so returning him needs a 40-man spot as well as an active spot.'
        : 'He is on the injured list and still on the 40-man.',
      'export_state', sixty ? 'players_roster_status.is_on_dl60' : 'players_roster_status.is_on_dl'
    )],
    requirements,
    missing,
    facts: {
      list: sixty ? '60-day' : '10-day',
      injuryDaysLeft: daysLeft,
      healed,
      activeRosterCount: ctx.counts.active,
      activeRosterLimit: activeLimit(ctx.league),
      fortyManCount: ctx.counts.fortyMan,
      fortyManLimit: ctx.league.fortyManLimit.value,
      // What must be true of the rosters, and which spot would have to be cleared first. These follow from the
      // export invariants (an active player is always on the 40-man; the active limit is never exceeded), not from
      // an observed activation: how OOTP enforces them (refusal or a forced move) is the unknown.
      needsActiveSpot: true,
      needsFortyManSpot: sixty,
      activeClearingNeeded: requirements.find((r) => r.kind === 'active_roster_spot')?.status === 'unmet' ? true
        : requirements.find((r) => r.kind === 'active_roster_spot')?.status === 'met' ? false : null,
      fortyManClearingNeeded: !sixty ? false
        : requirements.find((r) => r.kind === 'forty_man_spot')?.status === 'unmet' ? true
          : requirements.find((r) => r.kind === 'forty_man_spot')?.status === 'met' ? false : null,
    },
    limitation: 'Seen only for AI clubs: no club has an active player with an injury flag, and healed players stay on the list until activated (5 in the imported save). That is not evidence of the rule for a human manager.',
  });
}

/**
 * Move an injured player to the 60-day list, which takes him off the 40-man and
 * so opens a 40-man spot. What is established: the effect (68 of 68 exported
 * 60-day players are off the 40-man; the wiki says so) and that OOTP REFUSES the
 * move for a short injury (a 7-day injury was refused, RIGHTS_RESEARCH 4.8). What
 * is not: how long an injury must be. One refusal is not a rule (section 4.4),
 * so an injured player is `indeterminate` here, never eligible, with the one
 * observation carried as a fact.
 */
export const OBSERVED_SIXTY_DAY_REFUSAL_DAYS = 7;

function evaluatePlaceOnSixtyDayIl(ctx: RightsContext): ActionRights {
  const a: RightsAction = 'placeOnSixtyDayIl';
  const s = ctx.state;
  const gate = currentStateGate(a, ctx) ?? requireFields(a, '60-day list status unknown', [
    need('40-man flag', s.fortyMan), need('Injured-list flag', s.injuredList.onIl), need('60-day injured-list flag', s.injuredList.onIl60),
    need('Injury days left', s.injury.daysLeft),
  ]);
  if (gate) return gate;

  if (s.injuredList.onIl60.value === true) {
    return result(a, 'ineligible', 'Already on the 60-day list', {
      reasons: [reason('already_sixty_day', 'He is already on the 60-day injured list.', 'export_state', 'players_roster_status.is_on_dl60')],
    });
  }
  if (s.fortyMan.value === false) {
    return result(a, 'ineligible', 'Not on the 40-man', {
      reasons: [reason('not_on_forty_man', 'The 60-day list opens a 40-man spot by taking a player off it; he is not on the 40-man, so there is nothing to clear.', 'export_state', 'players_roster_status.is_on_secondary')],
    });
  }
  const daysLeft = s.injury.daysLeft.value as number;
  const facts = { injuryDaysLeft: daysLeft, observedRefusalAtDays: OBSERVED_SIXTY_DAY_REFUSAL_DAYS, opensFortyManSpot: true, opensActiveSpot: s.activeRoster.value === true };
  if (daysLeft <= 0) {
    return result(a, 'ineligible', 'Not injured', {
      reasons: [reason(
        'no_injury_to_list',
        `He has no injury days left. OOTP refused a 60-day placement for a ${OBSERVED_SIXTY_DAY_REFUSAL_DAYS}-day injury, so a healthy player is not a candidate.`,
        'observed', 'players_roster_status.injury_left'
      )],
      facts,
      limitation: 'Inferred from one observed refusal (a 7-day injury); not measured for a healthy player directly.',
    });
  }
  return result(a, 'indeterminate', 'Placement on the 60-day list not established', {
    reasons: [
      reason('sixty_day_leaves_forty_man', 'The 60-day list removes a player from the 40-man, opening a spot.', 'observed_and_documented', 'players_roster_status.is_on_dl60'),
      ...(daysLeft <= OBSERVED_SIXTY_DAY_REFUSAL_DAYS
        ? [reason('at_or_below_observed_refusal', `OOTP refused this move once, for a ${OBSERVED_SIXTY_DAY_REFUSAL_DAYS}-day injury; he has ${daysLeft}.`, 'observed', 'docs/RIGHTS_RESEARCH.md 4.8')]
        : []),
    ],
    missing: [{ code: 'rule_not_established', message: `How long an injury must be for OOTP to allow the 60-day list has not been measured (only a ${OBSERVED_SIXTY_DAY_REFUSAL_DAYS}-day injury was tried, and refused). He has ${daysLeft} day(s) left.` }],
    facts,
    limitation: 'Activating him later needs a 40-man spot again (see activateFromInjuredList).',
  });
}

function ruleFive(ctx: RightsContext): RuleFiveStanding {
  const s = ctx.state;
  const facts = { yearsProtectedFromRule5: s.options.yearsProtectedFromRule5.value, proServiceYears: s.serviceTime.professionalYears.value };
  if (ctx.league.ruleFiveDraft.value === false) {
    return { status: 'not_applicable', message: 'This league has no Rule 5 draft.', facts, missing: [] };
  }
  if (s.fortyMan.value === true) {
    return { status: 'protected_by_forty_man', message: 'On the 40-man, so not exposed to the Rule 5 draft.', facts, missing: [] };
  }
  return {
    status: 'indeterminate',
    message: 'Rule 5 exposure cannot be stated: OOTP exports only a protection window (0, 4 or 5), not a countdown, and the draft rule is not verified.',
    facts,
    missing: [{ code: 'rule_not_established', message: 'The exported Rule 5 protection value is a window length, not years remaining.' }],
  };
}

const UNVERIFIED_NOTE = 'The export\'s freshness could not be checked against the save.';

// ── contract control: arbitration and free-agency eligibility (Q-1, D-052) ───

/**
 * Where a player stands on the contract-control ladder for one season: renewed
 * by the club (pre-arbitration), arbitration-eligible, free to leave, bound by a
 * reserve clause, or not establishable. These are rights driven by service time,
 * so they live here (D-023, owner Q-1); Player Value attaches a cost to each and
 * never re-derives them.
 */
export type ControlStanding = 'pre_arbitration' | 'arbitration' | 'free_agency' | 'reserve_clause' | 'indeterminate';

/** A span of major-league service, in days. */
export interface ServiceBand {
  low: number;
  high: number;
}

export interface EligibilityAnswer {
  status: RightsStatus;
  reasons: RightsReason[];
  missing: MissingEvidence[];
}

/**
 * A threshold that falls inside a season's projected service: he is past it on
 * one edge and short of it on the other. The season on each side is stated.
 */
export interface ThresholdCrossing {
  line: 'free_agency' | 'arbitration' | 'super_two_window';
  /** Days of major-league service the line sits at. */
  lineDays: number;
  /** The first season he is past it if he stays on the active list for the rest of this season. */
  ifStaysUp: number;
  /** The first season he is past it if he is optioned or hurt for the rest of this season. */
  ifOptioned: number;
  message: string;
}

export interface SeasonControlEligibility {
  season: number;
  /** Major-league service entering the season (at the winter before it), in days; null when unknown. */
  serviceDays: ServiceBand | null;
  freeAgency: EligibilityAnswer;
  arbitration: EligibilityAnswer & {
    /** Which arbitration year this would be by service class (3.x years is the first), on each edge, when he is eligible. */
    trip: { low: number; high: number } | null;
    /** Eligible as a Super Two on at least one edge: from the year before the arbitration line. */
    superTwo: boolean;
  };
  standing: ControlStanding;
  /** For an indeterminate standing, the standings it lies between, in ladder order; empty when nothing bounds it. */
  between: ControlStanding[];
  crossings: ThresholdCrossing[];
}

export interface ContractControlEligibility {
  /** Free agency exists in the regime, or a reserve clause binds every player. */
  regime: Sourced<'free_agency' | 'reserve_clause'>;
  /** The season the regime league is in. */
  thisSeason: Sourced<number>;
  serviceDaysPerYear: Sourced<number>;
  service: {
    /** Banked now, this season's days included (R-3). */
    now: ServiceBand | null;
    /** At the end of this season: low if optioned or hurt from now on, high if he stays on the active list. */
    endOfSeason: ServiceBand | null;
    /** How each edge was drawn, in words. */
    basis: string[];
  };
  /** This season (decided at the last winter) and each later one asked for. */
  seasons: SeasonControlEligibility[];
  /** What blocks every season's answer, when something does. */
  missing: MissingEvidence[];
  limitation: string | null;
}

export interface ContractControlInput {
  state: PlayerState;
  /** The contract regime (`LeagueRules.contract`), already resolved through the parent league. */
  rules: ContractRules;
  serviceClock?: Sourced<number>;
  /** The CSV export against the save (D-022, D-023). */
  currentState: SourceState;
  /** How many seasons to evaluate, from this season on (at least 1). */
  seasons: number;
  /** The Super Two cutoff for this regime's class at the end of this season (`superTwoCutoffs`). */
  superTwo?: SuperTwoCutoff | null;
}

// ── Super Two (owner ruling, 2026-09-22) ─────────────────────────────────────

/**
 * How OOTP applies Super Two: under MLB rules, as the owner stated on 2026-09-22. That is a stated
 * basis for a right (D-018, D-023), not a guess from MLB rules. The rule, as the collective
 * bargaining agreement writes it (Art. VI(E)(1)(b)): a player with at least two but fewer than
 * three years of service is arbitration-eligible if he banked at least 86 days in the season just
 * ending and ranks in the top 22% (rounded to the nearest whole number) by total service of the
 * class of players with two to three years AND those 86 days. The cutoff falls where the class
 * falls, so it is computed from the export's own class each winter, never taken from history
 * (the real world's has run about 2.115 to 2.140 years).
 */
export const SUPER_TWO_ATTESTATION = 'OOTP applies Super Two under MLB rules (owner, 2026-09-22)';
/** The share of the class that qualifies. */
export const SUPER_TWO_SHARE = 0.22;
/** Days of service a player must have banked in the season just ending. */
export const SUPER_TWO_PRIOR_SEASON_DAYS = 86;
/**
 * MLB's contract regime. The export carries no column naming a rule set or Super Two, so Super Two
 * applies where a league's regime, as READ from the export, matches this one; every other regime
 * keeps the window indeterminate. It is compared against, never assumed for a league.
 */
export const MLB_CONTRACT_REGIME = { freeAgencyYears: 6, arbitrationYears: 3, serviceDaysPerYear: 172 } as const;

/**
 * Policy, not calibrated or provisional: these are not model parameters to be fitted (one import
 * could not fit them) but the game's rule as the owner attested it. They change by the owner's
 * decision, never by tuning.
 */
export const SUPER_TWO_CALIBRATION: CalibrationStamp = policy(
  `${SUPER_TWO_ATTESTATION}: the top 22% of the two-to-three-year class, each with at least 86 days in the ` +
    'season just ending (CBA Art. VI(E)(1)(b)), in leagues whose read contract regime matches MLB\'s.'
);

export interface SuperTwoCutoff {
  /** Whether Super Two applies to this regime: it matches MLB's, it does not, or the rules are unknown. */
  applies: 'yes' | 'not_mlb_regime' | 'unknown';
  /** The season just ending: the cutoff decides arbitration for the season after it. */
  season: number | null;
  /** Service (days) at or above which a class member qualifies, as a range across the projection. */
  cutoff: ServiceBand | null;
  /** How many players are in the class, as a range across the projection. */
  classSize: ServiceBand | null;
  /** How many of them qualify (22% of the class, rounded). */
  qualifiers: ServiceBand | null;
  basis: string[];
  missing: MissingEvidence[];
}

/**
 * The Super Two cutoff at the end of this season, one per contract regime, computed once from the
 * whole class (every player a club holds whose league's regime it is). Pure.
 *
 * Every member's service and his days this season are projections to season end, so the cutoff is
 * a range of reasonable readings: with the men on a major-league roster now banking the rest of the
 * season, and with every member banking it. A reading in which nobody banks another day is not one:
 * the season is played and its roster spots are filled, so its service is banked by somebody (and
 * in May it would leave nobody with the 86 days, and no class at all). A member whose service or
 * days this season the export does not state leaves the cutoff unknown: he could rank anywhere.
 * The player's OWN range still runs from no more days (optioned or hurt) to all of them.
 */
export function superTwoCutoffs(
  members: ServiceClassMember[],
  regimeOf: (leagueId: number) => ContractRules | null,
  clockOf: (regimeLeagueId: number) => Sourced<number>
): Map<number, SuperTwoCutoff> {
  const groups = new Map<number, { rules: ContractRules; members: ServiceClassMember[] }>();
  for (const m of members) {
    if (m.leagueId === null) continue;
    const rules = regimeOf(m.leagueId);
    const id = rules?.regimeLeagueId.value ?? null;
    if (rules === null || id === null) continue;
    const g = groups.get(id) ?? { rules, members: [] };
    g.members.push(m);
    groups.set(id, g);
  }
  const out = new Map<number, SuperTwoCutoff>();
  for (const [regimeId, { rules, members: group }] of groups) {
    const fa = rules.freeAgencyYears.value;
    const arb = rules.arbitrationYears.value;
    const perYear = rules.serviceDaysPerYear.value;
    const season = rules.season.value;
    const base = { season, cutoff: null, classSize: null, qualifiers: null };
    if (fa === null || arb === null || perYear === null) {
      out.set(regimeId, {
        ...base, applies: 'unknown', basis: [],
        missing: [{ code: 'rule_not_established', message: 'The league\'s free-agency, arbitration or service-year rule is not exported, so whether its regime is MLB\'s (and Super Two applies) cannot be stated.' }],
      });
      continue;
    }
    if (fa !== MLB_CONTRACT_REGIME.freeAgencyYears || arb !== MLB_CONTRACT_REGIME.arbitrationYears || perYear !== MLB_CONTRACT_REGIME.serviceDaysPerYear) {
      out.set(regimeId, {
        ...base, applies: 'not_mlb_regime', basis: [],
        missing: [{ code: 'rule_not_established', message: `This league's contract regime (free agency ${fa} years, arbitration ${arb}, a ${perYear}-day service year) is not MLB's, so whether OOTP applies Super Two here is not established.` }],
      });
      continue;
    }
    const regimeBasis = `The league's contract regime as exported (free agency ${fa} years, arbitration ${arb}, a ${perYear}-day service year) is MLB's, and ${SUPER_TWO_ATTESTATION}.`;
    const unstated = group.filter((m) => m.mlbDays === null || m.mlbDaysThisSeason === null).length;
    if (unstated > 0) {
      out.set(regimeId, {
        ...base, applies: 'yes', basis: [regimeBasis],
        missing: [{ code: 'field_not_exported', message: `${unstated} held player(s) have service or days this season that are not exported, so the Super Two class cannot be ranked.` }],
      });
      continue;
    }
    const clock = clockOf(regimeId).value;
    const windowLine = (arb - 1) * perYear;
    const arbLine = arb * perYear;
    type Point = { service: number; days: number };
    const scenario = (bank: (m: ServiceClassMember) => boolean): Point[] => group.map((m) => {
      const t = m.mlbDaysThisSeason as number;
      const rest = Math.max(0, clock !== null ? Math.min(perYear - clock, perYear - t) : perYear - t);
      const add = bank(m) ? rest : 0;
      return { service: (m.mlbDays as number) + add, days: t + add };
    });
    const cut = (points: Point[]) => {
      const cls = points
        .filter((p) => p.service >= windowLine && p.service < arbLine && p.days >= SUPER_TWO_PRIOR_SEASON_DAYS)
        .map((p) => p.service)
        .sort((a, b) => b - a);
      const qualifiers = Math.round(SUPER_TWO_SHARE * cls.length);
      // With nobody qualifying, the cutoff is the arbitration line itself: no one below it is eligible
      return { size: cls.length, qualifiers, cutoff: qualifiers > 0 ? cls[qualifiers - 1] : arbLine };
    };
    const results = [
      cut(scenario((m) => m.onMajorLeagueRoster === true)),
      cut(scenario(() => true)),
    ];
    const band = (pick: (r: (typeof results)[number]) => number): ServiceBand =>
      ({ low: Math.min(...results.map(pick)), high: Math.max(...results.map(pick)) });
    out.set(regimeId, {
      applies: 'yes', season,
      cutoff: band((r) => r.cutoff), classSize: band((r) => r.size), qualifiers: band((r) => r.qualifiers),
      basis: [
        regimeBasis,
        `The class is every held player with ${arb - 1} to ${arb} years of service and at least ${SUPER_TWO_PRIOR_SEASON_DAYS} days in ${season ?? 'this season'}; the top ${Math.round(SUPER_TWO_SHARE * 100)}% by service qualify.`,
        clock !== null
          ? `Projected to season end (${Math.max(0, perYear - clock)} of ${perYear} days left): from the men on a major-league roster now banking the rest of the season to every member banking it.`
          : 'The season clock is not exported, so each member may bank up to a full year less his days so far.',
      ],
      missing: [],
    });
  }
  return out;
}

/** What Super Two can say for one season's arbitration question. */
type SuperTwoContext =
  | { kind: 'resolved'; cutoff: ServiceBand; classSize: ServiceBand; qualifiers: ServiceBand; priorDays: { low: number | null; high: number | null }; priorSeason: number }
  | { kind: 'unresolved'; missing: MissingEvidence };


/**
 * The service projection past this season (provisional, PLAYER_VALUE.md Part 11).
 * This season's remaining days are a band: none (optioned or hurt from now on) up
 * to all of them (he stays on the active list). Each LATER season is projected as
 * one full service year on both edges, the convention a club's control is read
 * by; a season spent in the minors only lengthens control, and is not assumed.
 */
export const SERVICE_PROJECTION_BASIS =
  'Each season after this one is projected as a full service year; time in the minors would lengthen control, not shorten it.';

const SERVICE_SOURCE = 'players_roster_status.mlb_service_days';
const FA_SOURCE = 'leagues.rules_fa_minimum_years';
const ARB_SOURCE = 'leagues.rules_salary_arbitration_minimum_years';

/** The ladder a service total climbs, lowest first; the window is the year before the arbitration line. */
const LADDER = ['pre_arbitration', 'super_two_window', 'arbitration', 'free_agency'] as const;
type Rung = (typeof LADDER)[number];

const answer = (status: RightsStatus, reasons: RightsReason[] = [], missing: MissingEvidence[] = []): EligibilityAnswer => ({
  status, reasons, missing,
});

/** "5 years 87 days" in the league's own service-year length. */
function spoken(days: number, perYear: number): string {
  const years = Math.floor(days / perYear);
  const rest = Math.round(days - years * perYear);
  return `${years} year${years === 1 ? '' : 's'} ${rest} day${rest === 1 ? '' : 's'}`;
}

function rungOf(
  days: number, priorDays: number | null, perYear: number, fa: number | null, arb: number | null, st: SuperTwoContext
): Rung | null {
  if (fa !== null && fa > 0 && days >= fa * perYear) return 'free_agency';
  if (arb === null) return null;
  if (arb === 0) return 'pre_arbitration';
  if (days >= arb * perYear) return 'arbitration';
  if (days >= (arb - 1) * perYear) {
    // The year before the arbitration line: Super Two decides it where the cutoff is known
    if (st.kind !== 'resolved') return 'super_two_window';
    if (days < st.cutoff.low) return 'pre_arbitration';
    if (priorDays !== null && priorDays < SUPER_TWO_PRIOR_SEASON_DAYS) return 'pre_arbitration';
    if (days >= st.cutoff.high && priorDays !== null) return 'arbitration';
    return 'super_two_window';
  }
  return 'pre_arbitration';
}

/** Every standing a service total anywhere from the low rung to the high rung could have, in ladder order. */
function standingsBetween(low: Rung, high: Rung): ControlStanding[] {
  const out: ControlStanding[] = [];
  for (const rung of LADDER.slice(LADDER.indexOf(low), LADDER.indexOf(high) + 1)) {
    const add: ControlStanding[] = rung === 'super_two_window' ? ['pre_arbitration', 'arbitration'] : [rung];
    for (const s of add) if (!out.includes(s)) out.push(s);
  }
  return out;
}

function seasonEligibility(
  season: number, band: ServiceBand | null, perYear: number | null, rules: ContractRules,
  blocking: MissingEvidence[], crossingFor: (lineDays: number, line: ThresholdCrossing['line']) => ThresholdCrossing | null,
  st: SuperTwoContext
): SeasonControlEligibility {
  const fa = rules.freeAgencyYears.value;
  const arb = rules.arbitrationYears.value;
  const unknownSeason = (missing: MissingEvidence[]): SeasonControlEligibility => ({
    season, serviceDays: band, freeAgency: answer('indeterminate', [], missing),
    arbitration: { ...answer('indeterminate', [], missing), trip: null, superTwo: false },
    standing: 'indeterminate', between: [], crossings: [],
  });
  if (blocking.length > 0) return unknownSeason(blocking);

  // A reserve clause binds every player whatever his service (rules_fa_minimum_years = 0)
  if (fa === 0) {
    const reserve = reason('no_free_agency', 'This league has no free agency (its free-agency rule is 0): a reserve clause binds every player to his club.', 'export_state', FA_SOURCE);
    const noArb = arb === 0;
    return {
      season, serviceDays: band, freeAgency: answer('ineligible', [reserve]),
      arbitration: {
        ...answer(
          noArb ? 'ineligible' : 'indeterminate',
          noArb ? [reason('no_arbitration', 'This league has no salary arbitration (its arbitration rule is 0).', 'export_state', ARB_SOURCE)] : [],
          noArb ? [] : [{ code: 'rule_not_established', message: 'Whether arbitration applies under a reserve clause is not established.' }]
        ),
        trip: null,
        superTwo: false,
      },
      standing: 'reserve_clause', between: [], crossings: [],
    };
  }
  if (band === null || perYear === null) {
    return unknownSeason([{ code: 'field_not_exported', message: 'Major-league service time is not available.' }]);
  }

  const priorLow = st.kind === 'resolved' ? st.priorDays.low : null;
  const priorHigh = st.kind === 'resolved' ? st.priorDays.high : null;
  const low = rungOf(band.low, priorLow, perYear, fa, arb, st);
  const high = rungOf(band.high, priorHigh, perYear, fa, arb, st);
  const faLine = fa !== null ? fa * perYear : null;
  const arbLine = arb !== null && arb > 0 ? arb * perYear : null;
  const windowLine = arb !== null && arb > 0 ? (arb - 1) * perYear : null;
  const serviceText = band.low === band.high
    ? spoken(band.low, perYear)
    : `${spoken(band.low, perYear)} to ${spoken(band.high, perYear)}`;

  const crossings: ThresholdCrossing[] = [];
  const lines: Array<[number | null, ThresholdCrossing['line']]> = [
    [faLine, 'free_agency'], [arbLine, 'arbitration'], [windowLine, 'super_two_window'],
  ];
  for (const [lineDays, line] of lines) {
    if (lineDays === null || !(band.low < lineDays && lineDays <= band.high)) continue;
    // Where the Super Two cutoff is computed, the start of the window is no line of its own
    if (line === 'super_two_window' && st.kind === 'resolved') continue;
    const c = crossingFor(lineDays, line);
    if (c) crossings.push(c);
  }

  // ── free agency ──
  let freeAgency: EligibilityAnswer;
  if (faLine === null) {
    freeAgency = answer('indeterminate', [], [{ code: 'rule_not_established', message: `The league's free-agency rule is not available: ${rules.freeAgencyYears.note ?? 'no source states it'}` }]);
  } else if (band.low >= faLine) {
    freeAgency = answer('eligible', [reason('past_free_agency_line', `${serviceText} of service by then, past the free-agency line of ${fa} years.`, 'export_state', `${SERVICE_SOURCE} + ${FA_SOURCE}`)]);
  } else if (band.high < faLine) {
    freeAgency = answer('ineligible', [reason('short_of_free_agency_line', `${serviceText} of service by then, short of the free-agency line of ${fa} years.`, 'export_state', `${SERVICE_SOURCE} + ${FA_SOURCE}`)]);
  } else {
    freeAgency = answer('indeterminate', [], [{
      code: 'projection_straddles_threshold',
      message: `${serviceText} of service by then: the free-agency line of ${fa} years falls inside the projection.`,
    }]);
  }

  // ── arbitration (moot once he is certainly free to leave) ──
  let arbitration: SeasonControlEligibility['arbitration'];
  const none = { trip: null, superTwo: false };
  if (freeAgency.status === 'eligible') {
    arbitration = { ...answer('ineligible', [reason('free_agent_instead', 'He is past the free-agency line, so arbitration does not arise.', 'export_state', FA_SOURCE)]), ...none };
  } else if (arb === null) {
    arbitration = { ...answer('indeterminate', [], [{ code: 'rule_not_established', message: `The league's arbitration rule is not available: ${rules.arbitrationYears.note ?? 'no source states it'}` }]), ...none };
  } else if (arb === 0 || arbLine === null || windowLine === null) {
    arbitration = { ...answer('ineligible', [reason('no_arbitration', 'This league has no salary arbitration (its arbitration rule is 0).', 'export_state', ARB_SOURCE)]), ...none };
  } else {
    const trip = (d: number) => Math.floor(d / perYear) - arb + 1;
    const topOfArbitration = faLine !== null ? Math.min(band.high, faLine - 1) : band.high;
    const atOrPast = (r: Rung | null) => r === 'arbitration' || r === 'free_agency';
    const inWindow = band.low < arbLine && band.high >= windowLine;
    const cutText = st.kind === 'resolved'
      ? (st.cutoff.low === st.cutoff.high ? spoken(st.cutoff.low, perYear) : `${spoken(st.cutoff.low, perYear)} to ${spoken(st.cutoff.high, perYear)}`)
      : '';
    const range = (b: ServiceBand) => (b.low === b.high ? `${b.low}` : `${b.low} to ${b.high}`);
    const classText = st.kind === 'resolved'
      ? `the top ${Math.round(SUPER_TWO_SHARE * 100)}% (${range(st.qualifiers)}) by service of the ${range(st.classSize)} players with ${arb - 1} to ${arb} years and at least ${SUPER_TWO_PRIOR_SEASON_DAYS} days in ${st.priorSeason}`
      : '';
    const priorText = st.kind === 'resolved' && st.priorDays.low !== null
      ? (st.priorDays.low === st.priorDays.high ? `${st.priorDays.low}` : `${st.priorDays.low} to ${st.priorDays.high}`)
      : null;
    const superSource = `${SERVICE_SOURCE} + players_roster_status.mlb_service_days_this_year + the league's class`;

    if (atOrPast(low) && atOrPast(high)) {
      const reasons: RightsReason[] = [];
      if (band.low >= arbLine) {
        reasons.push(reason('past_arbitration_line', `${serviceText} of service by then, past the arbitration line of ${arb} years.`, 'export_state', `${SERVICE_SOURCE} + ${ARB_SOURCE}`));
      } else {
        reasons.push(reason(
          'super_two',
          `${serviceText} of service by then is at or above the Super Two cutoff (${cutText}: ${classText}), with ${priorText} days in ${st.kind === 'resolved' ? st.priorSeason : 'the season just ending'}. ${SUPER_TWO_ATTESTATION}.`,
          'owner_attested', superSource
        ));
      }
      arbitration = {
        ...answer('eligible', reasons),
        trip: band.high >= arbLine ? { low: trip(Math.max(band.low, arbLine)), high: trip(topOfArbitration) } : null,
        superTwo: band.low < arbLine,
      };
    } else if (low === 'pre_arbitration' && high === 'pre_arbitration') {
      const reasons: RightsReason[] = [];
      if (band.high < windowLine) {
        reasons.push(reason('short_of_arbitration_line', `${serviceText} of service by then, more than a year short of the arbitration line of ${arb} years.`, 'export_state', `${SERVICE_SOURCE} + ${ARB_SOURCE}`));
      } else if (st.kind === 'resolved' && band.high < st.cutoff.low) {
        reasons.push(reason('below_super_two_cutoff', `${serviceText} of service by then is below the Super Two cutoff (${cutText}: ${classText}). ${SUPER_TWO_ATTESTATION}.`, 'owner_attested', superSource));
      } else {
        reasons.push(reason('short_of_super_two_days', `${priorText ?? 'Fewer than ' + SUPER_TWO_PRIOR_SEASON_DAYS} days in ${st.kind === 'resolved' ? st.priorSeason : 'the season just ending'}: Super Two needs at least ${SUPER_TWO_PRIOR_SEASON_DAYS} days of service in the season before the arbitration winter, whatever his rank. ${SUPER_TWO_ATTESTATION}.`, 'owner_attested', superSource));
      }
      arbitration = { ...answer('ineligible', reasons), ...none };
    } else {
      const missing: MissingEvidence[] = [];
      if (inWindow) {
        if (st.kind === 'unresolved') missing.push(st.missing);
        else {
          const parts = [`In the Super Two window: his service by then projects ${serviceText}; the Super Two cutoff projects ${cutText} (${classText}).`];
          if (priorText === null) parts.push(`His days this season are not exported, so the ${SUPER_TWO_PRIOR_SEASON_DAYS}-day condition is unknown.`);
          else if ((st.priorDays.low as number) < SUPER_TWO_PRIOR_SEASON_DAYS && (st.priorDays.high as number) >= SUPER_TWO_PRIOR_SEASON_DAYS) {
            parts.push(`His days in ${st.priorSeason} project ${priorText}, and Super Two needs ${SUPER_TWO_PRIOR_SEASON_DAYS}.`);
          }
          missing.push({ code: 'projection_straddles_threshold', message: parts.join(' ') });
        }
      }
      if (band.low < arbLine && arbLine <= band.high) {
        missing.push({ code: 'projection_straddles_threshold', message: `The arbitration line of ${arb} years falls inside the projection (${serviceText}).` });
      }
      arbitration = { ...answer('indeterminate', [], missing), ...none };
    }
  }

  // ── standing: one rung on both edges, or indeterminate between them ──
  let standing: ControlStanding;
  let between: ControlStanding[] = [];
  if (low === null || high === null || faLine === null) {
    standing = 'indeterminate';
    const top: Rung = faLine === null || high === null ? 'free_agency' : high;
    between = low === null ? [] : standingsBetween(low, top);
  } else if (low === high && low !== 'super_two_window') {
    standing = low;
  } else {
    standing = 'indeterminate';
    between = standingsBetween(low, high);
  }
  return { season, serviceDays: band, freeAgency, arbitration, standing, between, crossings };
}

/**
 * Arbitration and free-agency eligibility, season by season, from service time
 * (read through Player State) and the league's contract regime. Pure.
 *
 * Service is projected as a band (see `SERVICE_PROJECTION_BASIS`); a threshold
 * inside it makes that season `indeterminate` and names the season on each
 * side. A missing service time, rule or service-year length is `indeterminate`,
 * never zero years, never six or three, never 172 days. The year before the
 * arbitration line is decided by Super Two where OOTP applies it (owner, see
 * `SUPER_TWO_ATTESTATION`) and the cutoff is computed; otherwise it is
 * `indeterminate`. `has_received_arbitration` is not read: it is 0 for every
 * player on the imported save and carries no information (R-3).
 */
export function evaluateContractControl(input: ContractControlInput): ContractControlEligibility {
  const { state, rules } = input;
  const perYear = rules.serviceDaysPerYear.value;
  const thisSeason = rules.season.value;
  const fa = rules.freeAgencyYears.value;
  const regime: ContractControlEligibility['regime'] = fa === null
    ? { ...rules.freeAgencyYears, value: null }
    : { ...rules.freeAgencyYears, value: fa === 0 ? 'reserve_clause' : 'free_agency' };

  const blocking: MissingEvidence[] = [];
  let limitation: string | null = null;
  if (input.currentState === 'behind') {
    blocking.push({ code: 'current_state_stale', message: 'The imported export is older than the save, so service time cannot be stated. Export the database again.' });
  } else if (input.currentState === 'unavailable') {
    blocking.push({ code: 'current_state_unavailable', message: 'No OOTP export is imported.' });
  } else if (input.currentState === 'unverified') {
    limitation = UNVERIFIED_NOTE;
  }
  if (perYear === null) {
    blocking.push({ code: 'rule_not_established', message: `The league's service-year length (rules_min_service_days) is not available, so service cannot be read in years: ${rules.serviceDaysPerYear.note ?? 'no source states it'}` });
  }

  // ── service now and at the end of this season ──
  const basis: string[] = [];
  const days = state.serviceTime.mlbDays.value;
  const years = state.serviceTime.mlbYears.value;
  const thisYear = state.serviceTime.mlbDaysThisSeason.value;
  let now: ServiceBand | null = null;
  if (days !== null) {
    now = { low: days, high: days };
    basis.push('Service now is mlb_service_days as exported, this season\'s days included.');
  } else if (years !== null && perYear !== null) {
    now = { low: years * perYear, high: years * perYear + perYear - 1 };
    basis.push('Only whole service years are exported (mlb_service_years); the days within the year are unknown, so service now is a band across that year.');
  } else {
    const why = state.serviceTime.mlbDays.reason ? UNKNOWN_REASON_TEXT[state.serviceTime.mlbDays.reason] : 'no source states it';
    blocking.push({ code: 'field_not_exported', message: `Major-league service time is not available: ${why}. It is never read as zero.` });
  }

  let endOfSeason: ServiceBand | null = null;
  let remaining: number | null = null;
  if (now !== null && perYear !== null) {
    const clock = input.serviceClock?.value ?? null;
    if (clock !== null) {
      remaining = Math.max(0, perYear - clock);
      if (thisYear !== null) remaining = Math.min(remaining, Math.max(0, perYear - thisYear));
      basis.push(`The season's service clock has run ${clock} of ${perYear} days; the high edge adds the ${remaining} left, the low edge none (optioned or hurt).`);
    } else {
      remaining = thisYear !== null ? Math.max(0, perYear - thisYear) : perYear;
      basis.push(`The season's service clock is not available, so the high edge adds the most he could still bank this season (${remaining} days); the low edge adds none.`);
    }
    endOfSeason = { low: now.low, high: now.high + remaining };
    basis.push(SERVICE_PROJECTION_BASIS);
  }

  const crossingFor = (lineDays: number, line: ThresholdCrossing['line']): ThresholdCrossing | null => {
    // Only a projection from exact days names the seasons on either side; a band from whole years does not
    if (days === null || endOfSeason === null || perYear === null || thisSeason === null || remaining === null) return null;
    const first = (edge: number) => thisSeason + 1 + Math.max(0, Math.ceil((lineDays - edge) / perYear));
    const ifStaysUp = first(endOfSeason.high);
    const ifOptioned = first(endOfSeason.low);
    const label = line === 'free_agency' ? 'free-agency line' : line === 'arbitration' ? 'arbitration line' : 'start of the year before arbitration';
    const short = Math.max(0, Math.ceil(lineDays - endOfSeason.low));
    return {
      line, lineDays, ifStaysUp, ifOptioned,
      message: `Past the ${label} (${spoken(lineDays, perYear)}) by ${ifStaysUp} if he stays on the active list for the rest of ${thisSeason}; not until ${ifOptioned} if he is optioned or hurt. He needs ${short} more day${short === 1 ? '' : 's'} and ${remaining} remain this season.`,
    };
  };

  /*
   * Super Two is decided for one winter at a time, from that winter's class. The export holds the
   * class ending THIS season, so it answers next season (k = 1). Last winter's class needed last
   * season's days, which the export does not carry; a later winter's class is not formed yet.
   */
  const superTwoContext = (k: number): SuperTwoContext => {
    const s = thisSeason as number;
    if (k === 0) {
      return { kind: 'unresolved', missing: { code: 'field_not_exported', message: `Last winter's Super Two class needs each player's days in ${s - 1}, which the export does not carry (only this season's), so the year before the arbitration line stays indeterminate for ${s}.` } };
    }
    if (k > 1) {
      return { kind: 'unresolved', missing: { code: 'rule_not_established', message: `The Super Two cutoff for the winter after ${s + k - 1} depends on that season's class, which the export does not hold yet.` } };
    }
    const st = input.superTwo;
    if (!st) {
      return { kind: 'unresolved', missing: { code: 'rule_not_established', message: 'The league\'s Super Two cutoff was not computed for this answer, so the year before the arbitration line is indeterminate.' } };
    }
    if (st.cutoff === null || st.classSize === null || st.qualifiers === null) {
      return { kind: 'unresolved', missing: st.missing[0] ?? { code: 'rule_not_established', message: 'The Super Two cutoff could not be computed.' } };
    }
    // His days in the season just ending: banked now, up to the rest of the season if he stays up
    const prior = thisYear === null || remaining === null
      ? { low: null, high: null }
      : { low: thisYear, high: thisYear + remaining };
    return { kind: 'resolved', cutoff: st.cutoff, classSize: st.classSize, qualifiers: st.qualifiers, priorDays: prior, priorSeason: s };
  };

  const seasons: SeasonControlEligibility[] = [];
  if (thisSeason === null) {
    blocking.push({ code: 'rule_not_established', message: `The league's current season is not available: ${rules.season.note ?? 'no source states it'}` });
  } else {
    for (let k = 0; k < Math.max(1, input.seasons); k += 1) {
      let band: ServiceBand | null = null;
      if (now !== null && perYear !== null) {
        if (k === 0) {
          // Decided at the last winter: service then was service now less this season's days (R-3)
          band = thisYear !== null
            ? { low: Math.max(0, now.low - thisYear), high: Math.max(0, now.high - thisYear) }
            : { low: Math.max(0, now.low - perYear), high: now.high };
        } else if (endOfSeason !== null) {
          band = { low: endOfSeason.low + (k - 1) * perYear, high: endOfSeason.high + (k - 1) * perYear };
        }
      }
      seasons.push(seasonEligibility(
        thisSeason + k, band, perYear, rules, blocking, k === 0 ? () => null : crossingFor, superTwoContext(k)
      ));
    }
  }

  return {
    regime,
    thisSeason: rules.season,
    serviceDaysPerYear: rules.serviceDaysPerYear,
    service: { now, endOfSeason, basis },
    seasons,
    missing: blocking,
    limitation,
  };
}


/** Evaluates every action for one player. Pure: no table or log is read. */

export function evaluatePlayerRights(ctx: RightsContext): PlayerRights {
  const evaluators: Record<RightsAction, (c: RightsContext) => ActionRights> = {
    option: evaluateOption,
    recall: evaluateRecall,
    addToFortyMan: evaluateAddToFortyMan,
    designateForAssignment: evaluateDesignate,
    outrightAssignment: evaluateOutright,
    activateFromInjuredList: evaluateActivateFromIl,
    placeOnSixtyDayIl: evaluatePlaceOnSixtyDayIl,
  };
  const actions = {} as Record<RightsAction, ActionRights>;
  for (const action of RIGHTS_ACTIONS) {
    const evaluated = evaluators[action](ctx);
    // A conclusion drawn from an export nothing could date says so
    actions[action] =
      ctx.evidence.currentState === 'unverified' && evaluated.status !== 'indeterminate' && !evaluated.limitation
        ? { ...evaluated, limitation: UNVERIFIED_NOTE }
        : evaluated;
  }
  return {
    playerId: ctx.state.playerId,
    evidence: ctx.evidence,
    optionYears: optionYearsOf(ctx),
    ruleFive: ruleFive(ctx),
    actions,
    composed: { promoteToActive: evaluatePromoteToActive(ctx) },
    // This season (decided at the last winter) and what happens after it
    contractControl: evaluateContractControl({
      state: ctx.state, rules: ctx.league.contract, serviceClock: ctx.serviceClock,
      currentState: ctx.evidence.currentState, seasons: 2, superTwo: ctx.superTwo ?? null,
    }),
  };
}
