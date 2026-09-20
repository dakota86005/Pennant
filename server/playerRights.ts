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
import type { LeagueRules } from './leagueRules.js';
import type { PlayerState } from './playerState.js';
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
  | 'observed_and_documented';

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
  | 'rule_not_established';

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
  };
}
