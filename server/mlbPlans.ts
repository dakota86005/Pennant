/**
 * Room-making plans: how to replace a flagged role holder, and what follows.
 *
 * "Replace Soroka" is never one move. He goes somewhere (down, to the bullpen, off
 * the roster), the replacement comes in, and the group that gained or lost a body
 * may have to lose one. Each plan here is a chain of moves evaluated as a
 * scenario (`rosterScenario.ts`): the rotation and the bullpen before and after,
 * the roster counts, the natural follow-up move, and the Player Rights status of
 * every step, so the plan is only as certain as its least certain link.
 *
 * This composes; it decides nothing. Legality is Player Rights', who is good is
 * the evaluators', whether a starter suits relief is Player Development's cross-
 * role evidence, the affiliate effect is Minor League Operations'. Plans are
 * options laid side by side with their costs, ordered by how ready the path is,
 * never by a score, and the GM decides.
 */

import type { CoverageFloors } from './mlbNeeds.js';
import type { CrossRoleSupport } from './mlbEvidence.js';
import { activeMembers, roleOf, type ClubView, type RoleRef, type RosterMember } from './mlbRoster.js';
import { shiftOptions } from './lineupShifts.js';
import { applyMoves, evaluateScenario, type EstimateOf, type Move, type ScenarioConsequences } from './rosterScenario.js';
import { estimateOf as workingEstimate, type LensEvidence } from './roleReview.js';
import type { ClearingOption, ResponseCandidate, TransactionPath } from './mlbResponses.js';
import type { PlatoonRead } from './platoon.js';
import type { RightsStatus } from './playerRights.js';
import { ordinal } from './roleStanding.js';
import { POSITION_LABELS, type LineupPicture } from './lineupPicture.js';

export interface PlanStep {
  seq: number;
  text: string;
  /** Player Rights' status for a transaction; `not_a_transaction` for a role change or an observation. */
  status: RightsStatus | 'not_a_transaction';
  note: string | null;
}

export interface GroupEffect {
  label: string;
  healthyBefore: number;
  healthyAfter: number;
  floor: number | null;
  /** Mean working estimate before and after, as percentile points; null when unknown. */
  meanBefore: number | null;
  meanAfter: number | null;
  change: number | null;
  weakestBefore: { name: string; estimate: number } | null;
  weakestAfter: { name: string; estimate: number } | null;
  /** Members in the group whose estimate is unknown, and so are not in the mean. */
  unknown: number;
}

export interface FollowUp {
  /** What has to happen next, in words. */
  text: string;
  /** The move proposed: the weakest arm of the group that gained a body, among those Rights allows to be optioned. */
  chosen: { playerId: number; name: string; estimate: number | null; class: string } | null;
  alternatives: Array<{ playerId: number; name: string; estimate: number | null }>;
}

export interface Plan {
  id: 'send_down' | 'move_to_bullpen' | 'designate' | 'open_spot' | 'lineup_change' | 'shift' | 'platoon';
  title: string;
  summary: string;
  steps: PlanStep[];
  groups: GroupEffect[];
  counts: { active: string; fortyMan: string };
  followUp: FollowUp | null;
  costs: string[];
  problems: string[];
  certainty: TransactionPath['status'];
  certaintyNote: string;
  /** The scenario the effects were computed from, so a caller can see exactly what was assumed. */
  moves: Move[];
}

export interface PlanDeps {
  view: ClubView;
  floors: CoverageFloors;
  subject: RosterMember;
  /** The replacement whose arrival the effects assume; null when nobody internal qualifies (plans then show the room only). */
  lead: ResponseCandidate | null;
  /** Working estimate of a player in a role, from the evaluators. */
  estimate: EstimateOf;
  /** Player Rights' picture for a player, or undefined when it could not be evaluated. */
  rights(playerId: number): { option: RightsStatus; designate: RightsStatus } | undefined;
  /** Player Rights and Minor League Operations' view of moving an active player out: the option or designation, with class and costs. */
  clearing(playerId: number): ClearingOption | undefined;
  crossRole(playerId: number, role: RoleRef): CrossRoleSupport;
  /** Who plays where (from usage): the regulars and the bench, so a shift can be proposed. Absent means no shifts. */
  lineup?: LineupPicture | null;
}

const worst = (a: PlanStep['status'], b: PlanStep['status']): PlanStep['status'] => {
  const order: PlanStep['status'][] = ['ineligible', 'indeterminate', 'eligible', 'not_a_transaction'];
  return order.indexOf(a) <= order.indexOf(b) ? a : b;
};

function effectsOf(c: ScenarioConsequences): GroupEffect[] {
  return c.groups.map((g) => ({
    label: g.label, healthyBefore: g.before.healthy, healthyAfter: g.after.healthy, floor: g.after.floor ?? g.before.floor,
    meanBefore: g.before.mean, meanAfter: g.after.mean, change: g.meanChange,
    weakestBefore: g.before.weakest && g.before.weakest.estimate !== null ? { name: g.before.weakest.name, estimate: g.before.weakest.estimate } : null,
    weakestAfter: g.after.weakest && g.after.weakest.estimate !== null ? { name: g.after.weakest.name, estimate: g.after.weakest.estimate } : null,
    unknown: g.after.unknown,
  }));
}

const countText = (c: { before: number | null; after: number | null; limit: number | null }) =>
  c.before === c.after ? `${c.after ?? '?'} of ${c.limit ?? '?'} (no change)` : `${c.before ?? '?'} to ${c.after ?? '?'} of ${c.limit ?? '?'}`;

/** How a path's certainty is stated: only as sure as its least sure link. */
function certaintyOf(steps: PlanStep[], candidatePath: TransactionPath | null): { status: TransactionPath['status']; note: string } {
  let s: PlanStep['status'] = 'not_a_transaction';
  for (const st of steps) s = worst(s, st.status);
  if (candidatePath) {
    if (candidatePath.status === 'blocked') return { status: 'blocked', note: 'A step for the replacement is not allowed.' };
    if (candidatePath.status === 'indeterminate') s = worst(s, 'indeterminate');
  }
  if (s === 'ineligible') return { status: 'blocked', note: 'A step in this plan is not allowed.' };
  if (s === 'indeterminate') return { status: 'indeterminate', note: 'At least one step cannot be established from the evidence available, so the plan is only as certain as that step.' };
  return { status: 'open_with_requirements', note: 'Player Rights allows each step; the moves have to be made in order.' };
}

/** The follow-up move for a group that gained a body: the weakest working estimate among those Rights lets the club option. */
function followUpFor(after: ClubView, gained: RoleRef, deps: PlanDeps, exclude: Set<number>): FollowUp {
  const pool = activeMembers(after).filter((m) => m.role?.kind === gained.kind && !exclude.has(m.playerId) && m.availability.status === 'available');
  const options = pool
    .map((m) => ({ m, clearing: deps.clearing(m.playerId), estimate: deps.estimate(m.playerId, gained) }))
    .filter((x) => x.clearing?.transaction === 'option' && x.clearing.rights.status === 'eligible')
    .sort((a, b) => (a.estimate ?? 101) - (b.estimate ?? 101) || a.m.name.localeCompare(b.m.name));
  if (options.length === 0) {
    return { text: `The active roster would be over its limit and no ${gained.label} can be optioned cleanly: another move is needed and Player Rights does not offer a routine one.`, chosen: null, alternatives: [] };
  }
  const [first, ...rest] = options;
  return {
    text: `One ${gained.label} has to leave the active roster; the weakest by working estimate among those who can be optioned is ${first.m.name}${first.estimate === null ? ' (no estimate)' : ` (${ordinal(first.estimate)})`}.`,
    chosen: { playerId: first.m.playerId, name: first.m.name, estimate: first.estimate, class: first.clearing?.class ?? 'routine' },
    alternatives: rest.slice(0, 3).map((x) => ({ playerId: x.m.playerId, name: x.m.name, estimate: x.estimate })),
  };
}

/**
 * The plans for replacing `subject` in his role. Each is evaluated with the lead
 * replacement in place. With no lead there is no plan: moving him would only open a hole.
 */
export function buildReplacementPlans(deps: PlanDeps): Plan[] {
  const { view, subject, lead, floors } = deps;
  const role = subject.role;
  if (!role) return [];
  // A shift needs nobody new: a regular moves to the weak spot and the spot he leaves is covered from within.
  const shifts = shiftPlans(deps);
  // With nobody internal to bring in, moving a pitcher only opens a hole: there is no plan to propose.
  if (!lead) return shifts;
  const leadId = lead?.playerId ?? null;

  // A bench player already on the roster takes the spot: a lineup decision, no transaction.
  if (lead.pathKind === 'role_change') {
    const sEst = deps.estimate(subject.playerId, role);
    const lEst = deps.estimate(lead.playerId, role);
    const place = POSITION_LABELS[role.position] ?? role.label;
    return [{
      id: 'lineup_change', title: `Start ${lead.name} at ${place} and move ${subject.name} to the bench`,
      summary: 'No roster move: a lineup decision. Nobody is optioned or designated, and the club keeps both players.',
      steps: [
        { seq: 1, text: `Start ${lead.name} at ${place}.`, status: 'not_a_transaction', note: lead.discovery.evidence[0] ?? null },
        { seq: 2, text: `${subject.name} moves to the bench.`, status: 'not_a_transaction', note: null },
      ],
      groups: [{
        label: place, healthyBefore: 1, healthyAfter: 1, floor: null, meanBefore: sEst, meanAfter: lEst,
        change: sEst !== null && lEst !== null ? lEst - sEst : null,
        weakestBefore: sEst !== null ? { name: subject.name, estimate: sEst } : null, weakestAfter: lEst !== null ? { name: lead.name, estimate: lEst } : null, unknown: 0,
      }],
      counts: { active: countText({ before: view.counts.active, after: view.counts.active, limit: view.limits.active }), fortyMan: countText({ before: view.counts.fortyMan, after: view.counts.fortyMan, limit: view.limits.fortyMan }) },
      followUp: null, costs: [`${subject.name}'s bat and glove move to the bench: it stays available as depth.`],
      problems: [], certainty: 'open', certaintyNote: 'No transaction is involved, so Player Rights has nothing to refuse.', moves: [],
    }, ...shifts];
  }
  const rights = deps.rights(subject.playerId);
  const clearing = deps.clearing(subject.playerId);
  const plans: Plan[] = [];
  const add = (move: Move | null): Move[] => (move ? [move] : []);
  const arrive: Move[] = add(leadId !== null ? { kind: 'add_active', playerId: leadId, role } : null);
  const leadStep = (seq: number): PlanStep[] => lead ? [{
    seq, text: `Bring in ${lead.name}: ${lead.path.chain.length ? lead.path.chain.filter((l) => l.kind === 'transaction').map((l) => l.label).join(' then ') : lead.path.steps.map((s) => s.label).join(' then ')}.`,
    status: lead.path.status === 'blocked' ? 'ineligible' : lead.path.status === 'indeterminate' || lead.group === 'evaluation_incomplete' ? 'indeterminate' : 'eligible',
    note: lead.group === 'evaluation_incomplete'
      ? 'Player Development cannot yet establish that this assignment is defensible for him, so the plan holds only if that is settled.'
      : lead.path.unknowns.length ? lead.path.unknowns[0] : null,
  }] : [];

  // ── send him down ──
  if (rights?.option === 'eligible' && clearing?.transaction === 'option') {
    const moves: Move[] = [{ kind: 'option', playerId: subject.playerId }, ...arrive];
    const c = evaluateScenario(view, moves, floors, deps.estimate);
    const steps: PlanStep[] = [
      { seq: 1, text: `Option ${subject.name} to the minors (${clearing.rights.label}).`, status: 'eligible', note: clearing.class === 'higher_cost' ? 'This uses his final option year.' : null },
      ...leadStep(2),
    ];
    const cert = certaintyOf(steps, lead?.path ?? null);
    plans.push({
      id: 'send_down', title: `Send ${subject.name} down${lead ? ` and bring in ${lead.name}` : ''}`,
      summary: 'The simplest swap: he keeps his 40-man spot and can be recalled.',
      steps, groups: effectsOf(c), counts: { active: countText(c.counts.active), fortyMan: countText(c.counts.fortyMan) },
      followUp: null, costs: [...clearing.costs, ...(clearing.farm ? [`${clearing.farm.affiliate.label} (${clearing.farm.affiliate.levelName}) ${clearing.farm.overall.before === clearing.farm.overall.after ? `stays ${clearing.farm.overall.after}` : `goes from ${clearing.farm.overall.before} to ${clearing.farm.overall.after}`}.`] : [])],
      problems: c.problems, certainty: cert.status, certaintyNote: cert.note, moves,
    });
  }

  // ── move a starter to the bullpen ──
  if (role.kind === 'starting_pitcher') {
    const pen: RoleRef = { kind: 'relief_pitcher', label: 'relief pitcher', position: 1 };
    const support = deps.crossRole(subject.playerId, pen);
    if (support.supported !== 'no') {
      const baseMoves: Move[] = [{ kind: 'role_change', playerId: subject.playerId, role: pen }, ...arrive];
      const scenario0 = evaluateScenario(view, baseMoves, floors, deps.estimate);
      const overLimit = scenario0.counts.active.over;
      const moved = new Set<number>([subject.playerId, ...(leadId !== null ? [leadId] : [])]);
      const after = applyMoves(view, baseMoves).view;
      const followUp = overLimit ? followUpFor(after, pen, deps, moved) : null;
      const moves: Move[] = followUp?.chosen ? [...baseMoves, { kind: 'option', playerId: followUp.chosen.playerId }] : baseMoves;
      const c = evaluateScenario(view, moves, floors, deps.estimate);
      const steps: PlanStep[] = [
        { seq: 1, text: `Move ${subject.name} to the bullpen.`, status: support.supported === 'yes' ? 'not_a_transaction' : 'indeterminate', note: support.supported === 'yes' ? support.evidence[0] ?? null : 'Whether he suits relief is not established from the visible evidence.' },
        ...leadStep(2),
        ...(followUp ? [{
          seq: 3, text: followUp.chosen ? `Option ${followUp.chosen.name} to make the active spot.` : 'Clear an active spot.',
          status: (followUp.chosen ? 'eligible' : 'indeterminate') as PlanStep['status'], note: followUp.text,
        }] : []),
      ];
      const cert = certaintyOf(steps, lead?.path ?? null);
      plans.push({
        id: 'move_to_bullpen', title: `Move ${subject.name} to the bullpen${lead ? ` and bring in ${lead.name}` : ''}`,
        summary: 'Keeps him in the organization\'s plans at the major-league level, and follows what that does to the bullpen.',
        steps, groups: effectsOf(c), counts: { active: countText(c.counts.active), fortyMan: countText(c.counts.fortyMan) },
        followUp,
        costs: followUp?.chosen ? [`${followUp.chosen.name} goes down instead; that is an option (${followUp.chosen.class === 'higher_cost' ? 'uses a final option year' : 'routine and reversible'}).`] : [],
        problems: c.problems, certainty: cert.status, certaintyNote: cert.note, moves,
      });
    }
  }

  // ── designate him, when he cannot simply be optioned ──
  if (rights && rights.option !== 'eligible' && rights.designate === 'eligible' && clearing?.transaction === 'designate_for_assignment') {
    const moves: Move[] = [{ kind: 'designate', playerId: subject.playerId }, ...arrive];
    const c = evaluateScenario(view, moves, floors, deps.estimate);
    const steps: PlanStep[] = [
      { seq: 1, text: `Designate ${subject.name} for assignment (${clearing.rights.label}).`, status: 'eligible', note: 'He cannot simply be optioned.' },
      ...leadStep(2),
    ];
    const cert = certaintyOf(steps, lead?.path ?? null);
    plans.push({
      id: 'designate', title: `Designate ${subject.name}${lead ? ` and bring in ${lead.name}` : ''}`,
      summary: 'Removes him from the 40-man and the roster, with real risk of losing him.',
      steps, groups: effectsOf(c), counts: { active: countText(c.counts.active), fortyMan: countText(c.counts.fortyMan) },
      followUp: null, costs: clearing.costs, problems: c.problems, certainty: cert.status, certaintyNote: cert.note, moves,
    });
  }

  // ── a spot is already open ──
  const active = view.counts.active;
  const limit = view.limits.active;
  if (lead && active !== null && limit !== null && active < limit) {
    const moves: Move[] = [{ kind: 'add_active', playerId: lead.playerId, role }];
    const c = evaluateScenario(view, moves, floors, deps.estimate);
    const steps: PlanStep[] = [...leadStep(1)];
    const cert = certaintyOf(steps, lead.path);
    plans.push({
      id: 'open_spot', title: `Add ${lead.name} and keep ${subject.name}`,
      summary: 'The active roster has room, so nobody has to leave; the group gains depth rather than replacing him.',
      steps, groups: effectsOf(c), counts: { active: countText(c.counts.active), fortyMan: countText(c.counts.fortyMan) },
      followUp: null, costs: [], problems: c.problems, certainty: cert.status, certaintyNote: cert.note, moves,
    });
  }
  return [...plans, ...shifts];
}

/**
 * Fixing the weak spot by moving a regular there and covering the spot he leaves from within. The chains and their gain are
 * `lineupShifts.ts`'; this states each as a plan with both ends shown. No transaction is involved, so Player Rights has nothing
 * to refuse; what the move costs is visible as the estimate at each position (bat plus glove there).
 */
function shiftPlans(deps: PlanDeps): Plan[] {
  const { view, subject, lineup } = deps;
  const role = subject.role;
  if (!lineup || !role || (role.kind !== 'position_player' && role.kind !== 'catcher') || role.position < 2 || role.position > 9) return [];
  const label = (pos: number) => POSITION_LABELS[pos] ?? `position ${pos}`;
  const at = (pos: number) => roleOf(pos, 0) as RoleRef;
  const options = shiftOptions({
    target: { position: role.position, playerId: subject.playerId, name: subject.name },
    regulars: lineup.spots.filter((s) => s.regular && s.position !== role.position).map((s) => ({ position: s.position, playerId: s.regular!.playerId, name: s.regular!.name })),
    bench: lineup.bench.map((b) => ({ playerId: b.playerId, name: b.name })),
    supported: (id, pos) => deps.crossRole(id, at(pos)).supported === 'yes',
    estimate: (id, pos) => deps.estimate(id, at(pos)),
  });
  return options.map((o): Plan => {
    const evidence = deps.crossRole(o.mover.playerId, at(o.mover.to)).evidence[0] ?? null;
    const coverEvidence = deps.crossRole(o.cover.playerId, at(o.mover.from)).evidence[0] ?? null;
    const swap = o.cover.source === 'swap';
    const group = (pos: number, beforeName: string, before: number, after: number, afterName: string): GroupEffect => ({
      label: label(pos), healthyBefore: 1, healthyAfter: 1, floor: null, meanBefore: before, meanAfter: after, change: after - before,
      weakestBefore: { name: beforeName, estimate: before }, weakestAfter: { name: afterName, estimate: after }, unknown: 0,
    });
    return {
      id: 'shift',
      title: `Move ${o.mover.name} to ${label(o.mover.to)} and ${swap ? `${o.cover.name} to ${label(o.mover.from)}` : `start ${o.cover.name} at ${label(o.mover.from)}`}`,
      summary: `Fixes ${label(o.mover.to)} without adding anyone: ${o.mover.name} moves there and ${o.cover.name} covers ${label(o.mover.from)}. The two spots together change by ${o.gain >= 0 ? '+' : ''}${Math.round(o.gain)} points of working estimate.`,
      steps: [
        { seq: 1, text: `Play ${o.mover.name} at ${label(o.mover.to)}.`, status: 'not_a_transaction', note: evidence },
        { seq: 2, text: swap ? `Play ${o.cover.name} at ${label(o.mover.from)}.` : `Start ${o.cover.name} at ${label(o.mover.from)}.`, status: 'not_a_transaction', note: coverEvidence },
        ...(swap ? [] : [{ seq: 3, text: `${subject.name} moves to the bench.`, status: 'not_a_transaction' as const, note: null }]),
      ],
      groups: [
        group(o.mover.to, subject.name, o.target.before, o.target.after, o.mover.name),
        group(o.mover.from, o.mover.name, o.vacated.before, o.vacated.after, o.cover.name),
      ],
      counts: { active: countText({ before: view.counts.active, after: view.counts.active, limit: view.limits.active }), fortyMan: countText({ before: view.counts.fortyMan, after: view.counts.fortyMan, limit: view.limits.fortyMan }) },
      followUp: null,
      costs: [`${label(o.mover.from)} goes from ${Math.round(o.vacated.before)} to ${Math.round(o.vacated.after)} (${o.mover.name} leaves it); the gain is at ${label(o.mover.to)}.`],
      problems: [], certainty: 'open', certaintyNote: 'No transaction is involved, so Player Rights has nothing to refuse. The change is a lineup decision.', moves: [],
    };
  });
}

/** A working-estimate function backed by the evidence port, cached so each (player, role) is asked once. */
export function estimatorFrom(
  evidence: (playerIds: number[], role: RoleRef, opts?: { ignoreResults?: boolean }) => Map<number, LensEvidence>,
  currentRole: (playerId: number) => RoleRef | null = () => null
): { estimate: EstimateOf; prefetch(ids: number[], role: RoleRef): void } {
  const cache = new Map<string, number | null>();
  const key = (id: number, role: RoleRef) => `${id}:${role.kind}:${role.position}`;
  const fill = (ids: number[], role: RoleRef) => {
    const missing = ids.filter((id) => !cache.has(key(id, role)));
    if (missing.length === 0) return;
    const pitcher = role.kind === 'starting_pitcher' || role.kind === 'relief_pitcher';
    // A player asked about in a role he does not fill has no results in it: only his tools speak.
    const away = missing.filter((id) => { const c = currentRole(id); return c !== null && c.kind !== role.kind; });
    const home = missing.filter((id) => !away.includes(id));
    const got = new Map<number, LensEvidence>();
    if (home.length) for (const [id, e] of evidence(home, role)) got.set(id, e);
    if (away.length) for (const [id, e] of evidence(away, role, { ignoreResults: true })) got.set(id, e);
    for (const id of missing) {
      const e = got.get(id);
      cache.set(key(id, role), e ? workingEstimate(e, pitcher).value : null);
    }
  };
  return {
    estimate: (id, role) => { fill([id], role); return cache.get(key(id, role)) ?? null; },
    prefetch: fill,
  };
}


/**
 * The platoon: a partner plays against the hand the regular struggles with and the regular keeps the job against the other. A partner already
 * on the bench is a lineup decision (no transaction); one from the minors needs the moves Player Rights and the clearing options already state.
 */
export function buildComplementPlans(deps: { view: ClubView; subject: RosterMember; regular: PlatoonRead; lead: ResponseCandidate | null; role: RoleRef }): Plan[] {
  const { view, subject, regular, lead, role } = deps;
  if (!lead || !lead.complement || regular.weakSide === null) return [];
  const weak = regular.weakSide === 'L' ? 'left' : 'right';
  const strong = regular.weakSide === 'L' ? 'right' : 'left';
  const place = POSITION_LABELS[role.position] ?? role.label;
  const fmt = (n: number | null) => (n === null ? '?' : n.toFixed(3).replace(/^0/, ''));
  const cand = regular.weakSide === 'L' ? lead.complement.candidate.vsLeft : lead.complement.candidate.vsRight;
  const reg = regular.weakSide === 'L' ? regular.vsLeft.expected : regular.vsRight.expected;
  const adv = lead.complement.fit.advantage;
  const bench = lead.pathKind === 'role_change';
  const gloveCost = lead.complement.glove.candidate !== null && lead.complement.glove.regular !== null && lead.complement.glove.candidate < lead.complement.glove.regular
    ? [`His glove at ${place} is behind ${subject.name}'s (${Math.round(lead.complement.glove.candidate)}th against ${Math.round(lead.complement.glove.regular)}th percentile), so some of the bat's gain is given back in the field.`] : [];
  const transaction = lead.path.chain.length ? lead.path.chain.filter((l) => l.kind === 'transaction').map((l) => l.label).join(' then ') : lead.path.steps.map((st) => st.label).join(' then ');
  const steps: PlanStep[] = bench
    ? [
      { seq: 1, text: `Start ${lead.name} at ${place} against ${weak}-handers.`, status: 'not_a_transaction', note: lead.discovery.evidence[0] ?? null },
      { seq: 2, text: `${subject.name} keeps ${place} against ${strong}-handers.`, status: 'not_a_transaction', note: null },
    ]
    : [
      { seq: 1, text: `Bring in ${lead.name}: ${transaction}.`, status: lead.path.status === 'blocked' ? 'ineligible' : lead.path.status === 'indeterminate' || lead.group === 'evaluation_incomplete' ? 'indeterminate' : 'eligible', note: lead.path.unknowns[0] ?? null },
      { seq: 2, text: `Start ${lead.name} at ${place} against ${weak}-handers.`, status: 'not_a_transaction', note: null },
      { seq: 3, text: `${subject.name} keeps ${place} against ${strong}-handers.`, status: 'not_a_transaction', note: null },
    ];
  return [{
    id: 'platoon',
    title: `Platoon ${lead.name} with ${subject.name} at ${place}: ${lead.name} starts against ${weak}-handers`,
    summary: `Against ${weak}-handers ${lead.name} projects ${fmt(cand)} wOBA to ${subject.name}'s ${fmt(reg)} (${adv === null ? '?' : `${adv >= 0 ? '+' : '-'}${Math.round(Math.abs(adv) * 1000)}`} points); ${subject.name} plays against ${strong}-handers, where nothing is wrong.`,
    steps, groups: [],
    counts: { active: countText({ before: view.counts.active, after: view.counts.active, limit: view.limits.active }), fortyMan: countText({ before: view.counts.fortyMan, after: view.counts.fortyMan, limit: view.limits.fortyMan }) },
    followUp: null,
    costs: [...gloveCost, ...(bench ? [`${subject.name} sits against ${weak}-handers, so he plays less; that is the point of a platoon, and it is a cost to him.`] : [`A roster spot is needed for ${lead.name}${lead.requiresClearing.active ? ': the active roster is full, so a player must clear it (see the clearing options)' : ''}.`])],
    problems: [], certainty: bench ? 'open' : lead.path.status,
    certaintyNote: bench ? 'No transaction is involved, so Player Rights has nothing to refuse.' : 'The plan is as certain as the moves that bring him in.', moves: [],
  }];
}
