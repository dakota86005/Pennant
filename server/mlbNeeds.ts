/**
 * Operational needs: current problems with the active MLB roster.
 *
 * A need is derived from THIS export's Player State — never from differences
 * between Pennant's own imports (a snapshot difference proves state changed,
 * not why: D-020), and never persisted. A need that is no longer true simply is
 * not returned. Causes are stated facts about named players ("on the 60-day IL,
 * 93 days left"); when no player explains a shortfall the need says so instead
 * of inventing a cause.
 *
 * The standards below are Pennant's own roster-construction assumptions, named
 * here so they are visible, tunable, and shown to the GM with each need. They
 * are not league rules and not a judgment about any player.
 *
 * Not built here: performance-driven needs (a sample-qualified, context-aware
 * review flag; deliberately deferred) and positional/bench coverage beyond the
 * catcher.
 */

import { withUnavailable, activeMembers, type ClubView, type RoleKind, type RoleRef, type RosterMember } from './mlbRoster.js';

/** Healthy active players Pennant expects in each role. An assumption, not a rule. */
export const ROLE_STANDARDS: Partial<Record<RoleKind, { count: number; label: string }>> = {
  starting_pitcher: { count: 5, label: 'five healthy starting pitchers' },
  relief_pitcher: { count: 7, label: 'seven healthy relief pitchers' },
  catcher: { count: 2, label: 'two healthy catchers' },
};

/** An injured player due back within this many days creates a return decision when the roster is full. */
export const IL_RETURN_WINDOW_DAYS = 15;
/** Horizon boundaries, in days left on an injury: a 10-day IL stint, then two months. */
export const TEMPORARY_DAYS = 15;
export const EXTENDED_DAYS = 60;

export type NeedKind = 'role_below_standard' | 'open_active_spot' | 'il_return_crunch';
export type NeedOrigin = 'observed' | 'hypothetical';
export type Severity = 'critical' | 'elevated' | 'watch';

export interface NeedHorizon {
  kind: 'temporary' | 'extended' | 'long_term' | 'unknown';
  days: number | null;
  /** Where the number comes from, so it is never mistaken for a forecast. */
  basis: string;
}

export interface NeedCause {
  playerId: number;
  name: string;
  role: string | null;
  /** How he is unavailable, as Player State states it. */
  status: string;
  daysLeft: number | null;
  assumed: boolean;
}

export interface NeedFact {
  label: string;
  value: string;
}

export interface MlbNeed {
  id: string;
  kind: NeedKind;
  origin: NeedOrigin;
  /** The role to fill (or, for a return crunch, the returning player's role); null when none is established. */
  role: RoleRef | null;
  title: string;
  summary: string;
  severity: Severity;
  urgency: { label: string; days: number | null };
  horizon: NeedHorizon;
  causes: NeedCause[];
  facts: NeedFact[];
  /** What Pennant could not establish, in plain words. */
  unknowns: string[];
  /** For a return crunch: the player coming back. */
  returning: { playerId: number; name: string; daysLeft: number | null; onFortyMan: boolean | null } | null;
}

const horizonOf = (days: number | null, basis: string): NeedHorizon => {
  if (days === null) return { kind: 'unknown', days: null, basis: 'No exported return date.' };
  if (days <= TEMPORARY_DAYS) return { kind: 'temporary', days, basis };
  if (days <= EXTENDED_DAYS) return { kind: 'extended', days, basis };
  return { kind: 'long_term', days, basis };
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const causeOf = (m: RosterMember): NeedCause => ({
  playerId: m.playerId,
  name: m.name,
  role: m.role?.label ?? null,
  status: m.availability.label ?? 'unavailable',
  daysLeft: m.availability.daysLeft,
  assumed: m.availability.assumed === true,
});

/**
 * Players of a role who are out and belong to the MLB club (on its injured list, or assumed out
 * by a what-if): the stated causes. A minor leaguer on a minor-league injured list is not one.
 */
function unavailableRoleHolders(view: ClubView, kind: RoleKind): RosterMember[] {
  return view.members.filter((m) =>
    m.role?.kind === kind && m.availability.status === 'unavailable' &&
    ((m.level === 1 && m.onInjuredList === true) || m.availability.assumed === true)
  );
}

function roleNeeds(view: ClubView, origin: NeedOrigin): MlbNeed[] {
  const needs: MlbNeed[] = [];
  const active = activeMembers(view);
  for (const [kind, standard] of Object.entries(ROLE_STANDARDS) as Array<[RoleKind, { count: number; label: string }]>) {
    const inRole = active.filter((m) => m.role?.kind === kind);
    const available = inRole.filter((m) => m.availability.status === 'available').length;
    const unknownAvailability = inRole.filter((m) => m.availability.status === 'unknown').length;
    if (available >= standard.count) continue;
    // Below the standard for certain only if even counting every unknown as healthy he is short.
    const certain = available + unknownAvailability < standard.count;
    const deficit = standard.count - available;
    const causes = unavailableRoleHolders(view, kind);
    // The earliest expected return is when the slot could next be filled from within.
    const returns = causes.map((c) => c.availability.daysLeft).filter((d): d is number => d !== null && d > 0);
    const earliest = returns.length ? Math.min(...returns) : null;
    const role = inRole[0]?.role ?? causes[0]?.role ?? null;
    const label = role?.label ?? kind.replace('_', ' ');
    const unknowns: string[] = [];
    if (unknownAvailability > 0) unknowns.push(`${plural(unknownAvailability, 'active player')} in this role ${unknownAvailability === 1 ? 'has' : 'have'} no exported availability, so the shortfall may be smaller.`);
    if (causes.length === 0) unknowns.push('No injured or unavailable player in this role explains the shortfall; Pennant cannot say how the roster came to be this way.');
    if (origin === 'observed' && causes.some((c) => c.availability.daysLeft === null)) unknowns.push('At least one injured player has no exported return estimate.');
    needs.push({
      id: `mlb:role_below_standard:${kind}`,
      kind: 'role_below_standard',
      origin,
      role,
      title: `${label.charAt(0).toUpperCase()}${label.slice(1)} depth is below standard`,
      summary: `${available} healthy ${label}${available === 1 ? '' : 's'} on the active roster against a standard of ${standard.count}.`,
      severity: !certain ? 'watch' : deficit >= 2 || available === 0 ? 'critical' : 'elevated',
      urgency: { label: 'Now', days: 0 },
      horizon: horizonOf(earliest, earliest === null
        ? 'No unavailable player in this role has an exported return estimate.'
        : `Earliest return among the unavailable players in this role: ${causes.filter((c) => c.availability.daysLeft === earliest).map((c) => c.name).join(', ')} (${earliest} days, exported injury days left).`),
      causes: causes.map(causeOf),
      facts: [
        { label: 'Standard', value: `Pennant expects ${standard.label} (an assumption, not a league rule)` },
        { label: 'Active in role', value: `${inRole.length} (${available} available)` },
        ...(view.counts.active !== null && view.limits.active !== null
          ? [{ label: 'Active roster', value: `${view.counts.active} of ${view.limits.active}` }] : []),
      ],
      unknowns,
      returning: null,
    });
  }
  return needs;
}

function openSpotNeed(view: ClubView, origin: NeedOrigin): MlbNeed | null {
  const { active } = view.counts;
  const { active: limit } = view.limits;
  if (active === null || limit === null || active >= limit) return null;
  const open = limit - active;
  return {
    id: 'mlb:open_active_spot',
    kind: 'open_active_spot',
    origin,
    role: null,
    title: `${plural(open, 'open active-roster spot')}`,
    summary: `The active roster has ${active} of ${limit} players. Which role to add is a roster-composition choice Pennant does not make.`,
    severity: 'elevated',
    urgency: { label: 'Now', days: 0 },
    horizon: { kind: 'unknown', days: null, basis: 'A vacant spot has no exported end date.' },
    causes: [],
    facts: [{ label: 'Active roster', value: `${active} of ${limit}` }],
    unknowns: ['No role is established for the open spot; choose one to explore responses.'],
    returning: null,
  };
}

function returnCrunchNeeds(view: ClubView, origin: NeedOrigin): MlbNeed[] {
  const { active } = view.counts;
  const { active: limit } = view.limits;
  // A return is a decision only when there is no spot for the returning player.
  if (active === null || limit === null || active < limit) return [];
  return view.members
    .filter((m) =>
      m.level === 1 && m.onInjuredList === true && m.availability.assumed !== true &&
      m.availability.daysLeft !== null && m.availability.daysLeft <= IL_RETURN_WINDOW_DAYS)
    .map((m) => {
      const days = m.availability.daysLeft as number;
      return {
        id: `mlb:il_return_crunch:${m.playerId}`,
        kind: 'il_return_crunch' as const,
        origin,
        role: m.role,
        title: `${m.name} is due back${days <= 0 ? ' now' : ` in about ${plural(days, 'day')}`}; the active roster is full`,
        summary: `${m.name} (${m.role?.label ?? 'role unknown'}, ${m.availability.label ?? 'injured list'}) returns to a ${active} of ${limit} active roster. Someone must be moved for him to be activated.`,
        severity: 'watch' as const,
        urgency: { label: days <= 0 ? 'Now' : `In about ${plural(days, 'day')}`, days },
        horizon: horizonOf(days, 'Exported injury days left for the returning player.'),
        causes: [causeOf(m)],
        facts: [
          { label: 'Active roster', value: `${active} of ${limit}` },
          { label: '40-man', value: m.onFortyMan === true ? 'On the 40-man' : m.onFortyMan === false ? 'Not on the 40-man (60-day IL)' : 'Unknown' },
        ],
        unknowns: ['The activation rules for the injured list have not been established (D-023), so whether he can be activated is not stated here.'],
        returning: { playerId: m.playerId, name: m.name, daysLeft: m.availability.daysLeft, onFortyMan: m.onFortyMan },
      };
    });
}

/** Needs the club has right now, from current Player State. */
export function detectNeeds(view: ClubView, origin: NeedOrigin = 'observed'): MlbNeed[] {
  const role = roleNeeds(view, origin);
  const spot = role.length ? null : openSpotNeed(view, origin);
  return [...role, ...(spot ? [spot] : []), ...returnCrunchNeeds(view, origin)];
}

/**
 * The GM's question "what if this active player were unavailable?" as a need.
 * Returns null when he is not on the active roster. The need is stated as an
 * assumption: it says nothing about why he would be out or for how long.
 */
export function whatIfNeed(view: ClubView, playerId: number): MlbNeed | null {
  const target = view.members.find((m) => m.playerId === playerId);
  const after = withUnavailable(view, playerId);
  if (!target || !after) return null;
  const role = target.role;
  const base = detectNeeds(after, 'hypothetical')
    .filter((n) => n.kind !== 'il_return_crunch')
    // a real role shortfall already present, unrelated to this player, is not this scenario's need
    .filter((n) => n.kind !== 'role_below_standard' || n.role?.kind === role?.kind);
  const shortfall = base.find((n) => n.kind === 'role_below_standard');
  const cause: NeedCause = { ...causeOf(after.members.find((m) => m.playerId === playerId) as RosterMember) };
  const needsAssumption = 'This is a scenario you asked about, not a current problem: nothing says he will be unavailable.';
  if (shortfall) {
    return {
      ...shortfall,
      id: `mlb:what_if:${playerId}`,
      title: `If ${target.name} is out: ${shortfall.title.toLowerCase()}`,
      causes: [cause, ...shortfall.causes.filter((c) => c.playerId !== playerId)],
      unknowns: [needsAssumption, ...shortfall.unknowns.filter((u) => !u.startsWith('No injured or unavailable'))],
    };
  }
  const active = after.counts.active;
  const limit = after.limits.active;
  return {
    id: `mlb:what_if:${playerId}`,
    kind: 'open_active_spot',
    origin: 'hypothetical',
    role,
    title: `If ${target.name} is out: an open ${role?.label ?? 'active-roster'} spot`,
    summary: `Without ${target.name}${active !== null && limit !== null ? ` the active roster would be ${active} of ${limit}` : ''}. The remaining ${role?.label ?? 'players'} depth stays at or above Pennant's standard, so this is a spot to fill, not a role shortfall.`,
    severity: 'watch',
    urgency: { label: 'Scenario', days: null },
    horizon: { kind: 'unknown', days: null, basis: 'Assumed; no injury or duration is stated.' },
    causes: [cause],
    facts: active !== null && limit !== null ? [{ label: 'Active roster', value: `${active} of ${limit}` }] : [],
    unknowns: [needsAssumption],
    returning: null,
  };
}
