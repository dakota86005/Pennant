/**
 * Roster scenarios: apply moves to a club view and follow what happens next.
 *
 * A GM never makes one move. Replacing a starter moves him somewhere; where he
 * goes changes another group; that group may fall below its floor or fill a
 * spot that has to be cleared. This module is the arithmetic of that chain: it
 * takes a `ClubView` and a list of moves, returns the club as it would stand,
 * and reports the consequences per role group, the roster counts, and the
 * knock-on problems the moves create.
 *
 * It is pure and decides nothing. It does not know whether a move is legal
 * (Player Rights owns that) and it does not judge who is good (the evaluation
 * modules own that): callers hand in the legality they got from Rights and the
 * estimates they got from the evaluators. What it does own is the bookkeeping
 * (who is on the active roster, in which role, how many) and the honest report
 * of what that bookkeeping implies.
 *
 * The moves are exactly the ones the rest of the system evaluates: bring a
 * player onto the active roster, option him, designate him, move him to the
 * 60-day list, change his role. Nothing else is invented.
 */

import type { CoverageFloors } from './mlbNeeds.js';
import { activeMembers, sameRole, type ClubView, type RoleKind, type RoleRef, type RosterMember } from './mlbRoster.js';
import type { RosterCounts } from './playerRights.js';

export type Move =
  /** Bring a player onto the active roster, optionally in a stated role. */
  | { kind: 'add_active'; playerId: number; role?: RoleRef }
  /** Send an active player to the minors: he stays on the 40-man. */
  | { kind: 'option'; playerId: number }
  /** Designate for assignment: off the active roster and the 40-man. */
  | { kind: 'designate'; playerId: number }
  /** Move to the 60-day list: off the active roster and the 40-man, listed. */
  | { kind: 'sixty_day'; playerId: number }
  /** Change the role an active player fills; he stays on the roster. */
  | { kind: 'role_change'; playerId: number; role: RoleRef };

export interface AppliedMove {
  move: Move;
  /** False when the move could not be applied (unknown player, not where the move needs him). */
  applied: boolean;
  note: string | null;
}

export interface ScenarioResult {
  view: ClubView;
  applied: AppliedMove[];
}

const recount = (members: RosterMember[]): RosterCounts => {
  const count = (pick: (m: RosterMember) => boolean | null): number | null => {
    let n = 0;
    for (const m of members) {
      const v = pick(m);
      if (v === null) return null;
      if (v) n += 1;
    }
    return n;
  };
  return { active: count((m) => m.onActive), fortyMan: count((m) => m.onFortyMan) };
};

/** The club as it would stand after the moves, in order. The input view is never changed. */
export function applyMoves(view: ClubView, moves: Move[]): ScenarioResult {
  let members = view.members.map((m) => ({ ...m }));
  const applied: AppliedMove[] = [];
  for (const move of moves) {
    const i = members.findIndex((m) => m.playerId === move.playerId);
    if (i < 0) { applied.push({ move, applied: false, note: 'He is not in the organization view.' }); continue; }
    const m = members[i];
    switch (move.kind) {
      case 'add_active':
        if (m.onActive === true) { applied.push({ move, applied: false, note: `${m.name} is already on the active roster.` }); break; }
        members[i] = {
          ...m, onActive: true, onFortyMan: true, level: 1, role: move.role ?? m.role,
          availability: { status: 'available', label: 'Active', daysLeft: null },
        };
        applied.push({ move, applied: true, note: null });
        break;
      case 'option':
        if (m.onActive !== true) { applied.push({ move, applied: false, note: `${m.name} is not on the active roster.` }); break; }
        members[i] = { ...m, onActive: false, level: 2, availability: { status: 'available', label: 'Optioned', daysLeft: null } };
        applied.push({ move, applied: true, note: null });
        break;
      case 'designate':
        members[i] = { ...m, onActive: false, onFortyMan: false, availability: { status: 'unavailable', label: 'DFA', daysLeft: null } };
        applied.push({ move, applied: true, note: null });
        break;
      case 'sixty_day':
        members[i] = { ...m, onActive: false, onFortyMan: false, onInjuredList: true, availability: { status: 'unavailable', label: 'IL-60', daysLeft: null } };
        applied.push({ move, applied: true, note: null });
        break;
      case 'role_change':
        if (m.onActive !== true) { applied.push({ move, applied: false, note: `${m.name} is not on the active roster.` }); break; }
        members[i] = { ...m, role: move.role };
        applied.push({ move, applied: true, note: null });
        break;
    }
  }
  members = members.map((m) => m);
  return { view: { ...view, members, counts: recount(members) }, applied };
}

// ── what the club looks like, group by group ───────────────────────────────

export interface GroupMember {
  playerId: number;
  name: string;
  /** Working estimate for the role he fills in this scenario (percentile of MLB peers); null when unknown. */
  estimate: number | null;
}

export interface GroupSnapshot {
  kind: RoleKind;
  label: string;
  /** Active players filling the role who are available. */
  healthy: number;
  floor: number | null;
  members: GroupMember[];
  /** Mean of the known estimates; null when none is known. */
  mean: number | null;
  weakest: GroupMember | null;
  unknown: number;
}

/** Working estimates for players in a role: supplied by the evaluators through the caller. */
export type EstimateOf = (playerId: number, role: RoleRef) => number | null;

export function groupSnapshot(view: ClubView, role: RoleRef, floors: CoverageFloors, estimateOf: EstimateOf): GroupSnapshot {
  const holders = activeMembers(view).filter((m) => sameRole(m.role, role));
  const members: GroupMember[] = holders.map((m) => ({ playerId: m.playerId, name: m.name, estimate: estimateOf(m.playerId, role) }));
  const known = members.filter((m): m is GroupMember & { estimate: number } => m.estimate !== null);
  return {
    kind: role.kind, label: role.label,
    healthy: holders.filter((m) => m.availability.status === 'available').length,
    floor: floors.floors[role.kind]?.count ?? null,
    members: members.sort((a, b) => (a.estimate ?? 101) - (b.estimate ?? 101) || a.name.localeCompare(b.name)),
    mean: known.length ? known.reduce((n, m) => n + m.estimate, 0) / known.length : null,
    weakest: known.length ? known.reduce((a, b) => (b.estimate < a.estimate ? b : a)) : null,
    unknown: members.length - known.length,
  };
}

// ── consequences ────────────────────────────────────────────────────────────

export interface GroupChange {
  kind: RoleKind;
  label: string;
  before: GroupSnapshot;
  after: GroupSnapshot;
  /** After minus before, in points of mean working estimate; null when either is unknown. */
  meanChange: number | null;
  belowFloorAfter: boolean;
  /** Active players above the floor after the moves: the room a follow-up clearing move can take from. Null when there is no floor. */
  surplusAfter: number | null;
}

export interface CountsChange {
  active: { before: number | null; after: number | null; limit: number | null; over: boolean };
  fortyMan: { before: number | null; after: number | null; limit: number | null; over: boolean };
}

export interface ScenarioConsequences {
  applied: AppliedMove[];
  counts: CountsChange;
  groups: GroupChange[];
  /** Problems the moves leave behind, in words: over a roster limit, a group below its floor, a move that could not be applied. */
  problems: string[];
}

/** The role groups a scenario touches: every role a moved player leaves or joins. */
function touchedRoles(before: ClubView, moves: Move[], after: ClubView): RoleRef[] {
  const roles: RoleRef[] = [];
  const add = (r: RoleRef | null) => { if (r && !roles.some((x) => sameRole(x, r) && x.kind === r.kind)) roles.push(r); };
  for (const mv of moves) {
    add(before.members.find((m) => m.playerId === mv.playerId)?.role ?? null);
    add(after.members.find((m) => m.playerId === mv.playerId)?.role ?? null);
  }
  return roles;
}

export function evaluateScenario(before: ClubView, moves: Move[], floors: CoverageFloors, estimateOf: EstimateOf): ScenarioConsequences {
  const { view: after, applied } = applyMoves(before, moves);
  const groups: GroupChange[] = touchedRoles(before, moves, after).map((role) => {
    const b = groupSnapshot(before, role, floors, estimateOf);
    const a = groupSnapshot(after, role, floors, estimateOf);
    return {
      kind: role.kind, label: role.label, before: b, after: a,
      meanChange: b.mean !== null && a.mean !== null ? a.mean - b.mean : null,
      belowFloorAfter: a.floor !== null && a.healthy < a.floor,
      surplusAfter: a.floor === null ? null : a.healthy - a.floor,
    };
  });
  const over = (n: number | null, limit: number | null) => n !== null && limit !== null && n > limit;
  const counts: CountsChange = {
    active: { before: before.counts.active, after: after.counts.active, limit: before.limits.active, over: over(after.counts.active, before.limits.active) },
    fortyMan: { before: before.counts.fortyMan, after: after.counts.fortyMan, limit: before.limits.fortyMan, over: over(after.counts.fortyMan, before.limits.fortyMan) },
  };
  const problems: string[] = [];
  for (const a of applied) if (!a.applied && a.note) problems.push(a.note);
  if (counts.active.over) problems.push(`The active roster would be ${counts.active.after} of ${counts.active.limit}: a player must also leave it.`);
  if (counts.fortyMan.over) problems.push(`The 40-man would be ${counts.fortyMan.after} of ${counts.fortyMan.limit}: a spot must also be cleared.`);
  for (const g of groups) {
    if (g.belowFloorAfter) problems.push(`${g.label} coverage would be ${g.after.healthy} against a floor of ${g.after.floor}.`);
  }
  return { applied, counts, groups, problems };
}
