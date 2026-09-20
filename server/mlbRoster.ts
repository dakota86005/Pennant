/**
 * The organization as MLB Operations sees it: Player State, read into a view
 * with roles, availability and roster counts.
 *
 * This is a lens on `playerState.ts`, not a second roster model. Nothing here
 * opens a table, reads the transaction log, or decides what may be done to a
 * player (that is `playerRights.ts`). Availability comes from the Standing
 * `playerState.ts` already derives; a field the export did not carry stays
 * unknown here and is never filled in.
 */

import { leagueRulesForOrganization, type LeagueRules } from './leagueRules.js';
import { normalizedPitchingRole } from './pitchingRole.js';
import { activeLimit, rosterCounts, type RosterCounts } from './playerRights.js';
import { organizationPlayerStates, type PlayerState } from './playerState.js';

export type RoleKind = 'starting_pitcher' | 'relief_pitcher' | 'catcher' | 'position_player';

export interface RoleRef {
  kind: RoleKind;
  label: string;
  /** OOTP listed position: 1 pitcher, 2 catcher ... 9 right field, 10 DH. */
  position: number;
}

const POSITION_LABELS: Record<number, string> = {
  2: 'catcher', 3: 'first baseman', 4: 'second baseman', 5: 'third baseman', 6: 'shortstop',
  7: 'left fielder', 8: 'center fielder', 9: 'right fielder', 10: 'designated hitter',
};

/** A role from exported position and pitcher role, or null when the export does not establish one. */
export function roleOf(position: number | null, role: number | null): RoleRef | null {
  if (position === null) return null;
  if (position === 1) {
    const pitching = normalizedPitchingRole(position, role);
    if (pitching === 'starting_pitcher') return { kind: 'starting_pitcher', label: 'starting pitcher', position };
    if (pitching === 'relief_pitcher') return { kind: 'relief_pitcher', label: 'relief pitcher', position };
    return null;
  }
  if (position === 2) return { kind: 'catcher', label: 'catcher', position };
  const label = POSITION_LABELS[position];
  return label ? { kind: 'position_player', label, position } : null;
}

export type AvailabilityStatus = 'available' | 'unavailable' | 'unknown';

export interface Availability {
  status: AvailabilityStatus;
  /** Standing as Player State words it: Active, Reserve, Day-to-day, IL, IL-60, DFA, Waivers, Injured. */
  label: string | null;
  /** Days left on the injury or DFA clock, as exported. */
  daysLeft: number | null;
  /** Set when this availability is a GM's stated assumption, not an export fact. */
  assumed?: boolean;
}

export interface RosterMember {
  playerId: number;
  name: string;
  age: number | null;
  level: number | null;
  teamId: number | null;
  role: RoleRef | null;
  onActive: boolean | null;
  onFortyMan: boolean | null;
  onInjuredList: boolean | null;
  availability: Availability;
  state: PlayerState;
}

export interface ClubView {
  orgId: number;
  members: RosterMember[];
  limits: { active: number | null; fortyMan: number | null };
  counts: RosterCounts;
}

function memberOf(state: PlayerState): RosterMember {
  const standing = state.standing.value;
  const il = state.injuredList.onIl.value;
  const il60 = state.injuredList.onIl60.value;
  return {
    playerId: state.playerId,
    name: state.name,
    age: state.age,
    level: state.level.value,
    teamId: state.teamId.value,
    role: roleOf(state.position.value, state.role.value),
    onActive: state.activeRoster.value,
    onFortyMan: state.fortyMan.value,
    onInjuredList: il === null || il60 === null ? null : il || il60,
    availability: standing
      ? { status: standing.available ? 'available' : 'unavailable', label: standing.label, daysLeft: standing.daysLeft }
      : { status: 'unknown', label: null, daysLeft: null },
    state,
  };
}

/** Build a view from states and league rules. Pure: tests supply both. */
export function buildClubView(orgId: number, states: PlayerState[], league: LeagueRules): ClubView {
  return {
    orgId,
    members: states.map(memberOf),
    limits: { active: activeLimit(league), fortyMan: league.fortyManLimit.value },
    counts: rosterCounts(states),
  };
}

export function loadClubView(orgId: number): ClubView {
  return buildClubView(orgId, organizationPlayerStates(orgId), leagueRulesForOrganization(orgId));
}

/** Same role: the same kind, and for a fielder the same listed position. */
export function sameRole(a: RoleRef | null, b: RoleRef): boolean {
  if (!a || a.kind !== b.kind) return false;
  return b.kind === 'position_player' ? a.position === b.position : true;
}

/** The org's players on the MLB active roster. */
export const activeMembers = (view: ClubView): RosterMember[] => view.members.filter((m) => m.onActive === true);

/**
 * The same club if `playerId` were unavailable from now on. The player leaves the
 * active roster count; nothing else changes. It is a stated assumption, marked
 * `assumed`, and does not say why he would be out or for how long.
 */
export function withUnavailable(view: ClubView, playerId: number): ClubView | null {
  const target = view.members.find((m) => m.playerId === playerId);
  if (!target || target.onActive !== true) return null;
  return {
    ...view,
    counts: { ...view.counts, active: view.counts.active === null ? null : view.counts.active - 1 },
    members: view.members.map((m) => m.playerId !== playerId ? m : {
      ...m,
      onActive: false,
      availability: { status: 'unavailable', label: 'Assumed unavailable', daysLeft: null, assumed: true },
    }),
  };
}
