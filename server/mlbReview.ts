/**
 * The roster review: the club's role groups read the way a scouting department
 * reads them, unprompted.
 *
 * This composes; it decides nothing an evaluation module owns. The lenses, the
 * working estimate and the finding come from `roleReview.ts`; the evidence comes
 * through a port (`holderEvidence`), which is the only way to the specialists.
 * A finding becomes a `role_holder_review` need only when it is a real case (both
 * lenses agree, strong or moderate): a flag for the GM's attention. A "watch"
 * (tools ahead of results, too early, one lens only) is shown in the review but is
 * not a need, so the list of issues is never noise. Nothing here is a transaction
 * trigger.
 */

import type { MlbNeed } from './mlbNeeds.js';
import { buildLineupPicture, POSITION_LABELS, type HitterUsageInput, type LineupPicture } from './lineupPicture.js';
import { activeMembers, roleOf, type ClubView, type RoleKind, type RoleRef, type RosterMember } from './mlbRoster.js';
import { evaluatePlatoon, type PlatoonInput, type PlatoonRead } from './platoon.js';
import { ordinal } from './roleStanding.js';
import { estimateOf, reviewGroup, type HolderReview, type LensEvidence, type ReviewSubject } from './roleReview.js';
import { flagShading, readContext, type ContextRead, type OrganizationContext } from './staffPreference.js';
import { deploymentFindings, roleOf as bullpenRoleOf, type DeploymentFinding } from './bullpenRoles.js';
import { reviewBench, type BenchReview } from './benchReview.js';

export interface ReviewPorts {
  holderEvidence(playerIds: number[], role: RoleRef): Map<number, LensEvidence>;
  /** Hitters' usage this season (innings by position, starts, plate appearances, handedness); absent means no lineup review. */
  hitterUsage?(playerIds: number[]): Map<number, Pick<HitterUsageInput, 'bats' | 'fielding' | 'gs' | 'pa'>>;
  /** Observed splits and the league's own platoon effect. */
  platoon?(playerIds: number[]): Map<number, PlatoonInput>;
  /** Team games played this season, the denominator behind usage shares. */
  teamGames?(): number;
  /** The positions where each player's visible grade supports playing, for the bench's coverage. */
  covers?(playerIds: number[]): Map<number, number[]>;
  /** The organization's philosophy and the season's standing: shades how urgently a flag is raised, never whether it is (D-036). */
  organization?: OrganizationContext | null;
}

export interface RoleGroupReview {
  kind: RoleKind;
  role: string;
  /** The members reviewed, most concerning first: a display order, stated as one. */
  holders: Array<HolderReview & { role: RoleRef | null; position?: number; platoon?: PlatoonRead | null }>;
  /** For the lineup: who plays where, from usage. */
  lineup?: LineupPicture;
  /** Members with no established role or no exported availability, counted, not reviewed. */
  notReviewed: number;
  /** For the bullpen: where a clearly better arm is used in lower leverage than a worse one. A usage decision for the manager, not a roster move. */
  deployment?: DeploymentFinding[];
  /** For the bench: who is on it for what, and which positions nobody on it can cover. */
  bench?: BenchReview;
}

const REVIEWED: RoleKind[] = ['starting_pitcher', 'relief_pitcher'];
const STRENGTH_ORDER = { strong: 0, moderate: 1, watch: 2, none: 3 } as const;

const subjectOf = (m: RosterMember, e: LensEvidence): ReviewSubject => ({ playerId: m.playerId, name: m.name, age: m.age, ...e });

/** The role group reviews for a club, from its active players. */
export function reviewClub(view: ClubView, ports: ReviewPorts): RoleGroupReview[] {
  const out: RoleGroupReview[] = [];
  for (const kind of REVIEWED) {
    const members = activeMembers(view).filter((m) => m.role?.kind === kind && m.availability.status === 'available');
    const role = members[0]?.role;
    if (!role || members.length === 0) continue;
    const evidence = ports.holderEvidence(members.map((m) => m.playerId), role);
    const reviewed = members.filter((m) => evidence.has(m.playerId));
    const reviews = reviewGroup(reviewed.map((m) => subjectOf(m, evidence.get(m.playerId) as LensEvidence)), { pitcher: true, role: role.label });
    // A reliever's role is what his usage shows: it says how much a weak line costs, and whether the arms are where the estimates say they belong.
    const roles = new Map(reviews.map((r) => {
      const b = evidence.get(r.playerId)?.bullpen;
      return [r.playerId, kind === 'relief_pitcher' && b ? bullpenRoleOf({ playerId: r.playerId, name: r.name, g: b.g, ip: b.ip, sv: b.sv, hld: b.hld, leverage: b.leverage }) : null] as const;
    }));
    out.push({
      kind, role: role.label, notReviewed: members.length - reviewed.length,
      holders: reviews
        .map((r) => ({ ...r, role: members.find((m) => m.playerId === r.playerId)?.role ?? null, stakes: roles.get(r.playerId)?.stakes ?? null, tier: roles.get(r.playerId)?.tier ?? null }))
        .sort((a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength] || (a.estimate.value ?? 101) - (b.estimate.value ?? 101) || a.name.localeCompare(b.name)),
      ...(kind === 'relief_pitcher' ? { deployment: deploymentFindings(reviews.map((r) => ({ playerId: r.playerId, name: r.name, tier: roles.get(r.playerId)?.tier ?? 'unknown', estimate: r.estimate.value }))) } : {}),
    });
  }
  const lineup = reviewLineup(view, ports);
  if (lineup) {
    out.push(lineup);
    const bench = benchGroup(view, ports, lineup.lineup as LineupPicture);
    if (bench) out.push(bench);
  }
  return out;
}

/** The bench: the hitters who are nobody's regular, what each is for, and whether the positions that need a cover have one. */
function benchGroup(view: ClubView, ports: ReviewPorts, picture: LineupPicture): RoleGroupReview | null {
  if (!ports.covers) return null;
  const members = activeMembers(view).filter((m) => picture.bench.some((b) => b.playerId === m.playerId) && m.availability.status === 'available');
  const covers = ports.covers(members.map((m) => m.playerId));
  const players = members.map((m) => {
    const b = picture.bench.find((x) => x.playerId === m.playerId);
    const listed = m.role?.position ?? null;
    const role = roleOf(listed ?? 10, 0);
    const e = role ? ports.holderEvidence([m.playerId], role).get(m.playerId) : undefined;
    return { playerId: m.playerId, name: m.name, bats: b?.bats ?? null, pa: b?.pa ?? 0, covers: covers.get(m.playerId) ?? [], batValue: e ? estimateOf(e, false).batValue ?? null : null, listed };
  });
  return { kind: 'position_player', role: 'bench', holders: [], notReviewed: 0, bench: reviewBench(players) };
}

const COVER_ROLE_POSITION: Record<string, number> = { catcher: 2, middle_infield: 4, center_field: 8 };

/** A bench position nobody can cover, as a need: the position to find a backup for. */
function benchNeeds(groups: RoleGroupReview[]): MlbNeed[] {
  const bench = groups.find((g) => g.bench)?.bench;
  if (!bench) return [];
  return bench.gaps.flatMap((g): MlbNeed[] => {
    const role = roleOf(COVER_ROLE_POSITION[g.key] ?? g.positions[0], 0);
    if (!role) return [];
    return [{
      id: `mlb:bench_coverage:${g.key}`, kind: 'bench_coverage', origin: 'observed', role,
      title: `No bench player can cover ${g.positions.map((p) => POSITION_LABELS[p]).join(' or ')}`,
      summary: g.text,
      severity: 'watch', urgency: { label: 'Review', days: null },
      horizon: { kind: 'unknown', days: null, basis: 'A coverage gap has no end date; it lasts until a backup is on the bench.' },
      causes: [], facts: [{ label: 'Bench', value: bench.rows.length ? bench.rows.map((r) => `${r.name} (${r.role})`).join(', ') : 'Empty' }],
      unknowns: ['This is a coverage question, not a performance one: it says nobody on the bench is visibly able to play the position, and it is a flag for your attention.'],
      returning: null,
    }];
  });
}

/** A regular's platoon problem as a need: the hand he struggles against and what a partner would have to be. */
function platoonNeeds(groups: RoleGroupReview[], view: ClubView): MlbNeed[] {
  const needs: MlbNeed[] = [];
  for (const g of groups) {
    for (const h of g.holders) {
      const platoon = h.platoon;
      if (!platoon || platoon.verdict !== 'problem' || platoon.weakSide === null) continue;
      const m = view.members.find((x) => x.playerId === h.playerId);
      if (!m || !h.role) continue;
      const side = platoon.weakSide === 'L' ? 'left' : 'right';
      needs.push({
        id: `mlb:platoon_complement:${m.playerId}`, kind: 'platoon_complement', origin: 'observed', role: h.role,
        title: `${m.name} (${h.role.label}): weak against ${side}-handers; a platoon partner could help`,
        summary: `${m.name} projects ${Math.round((platoon.weakBy ?? 0) * 1000)} points of wOBA below his overall level against ${side}-handers, ${Math.round((platoon.excessOverLeague ?? 0) * 1000)} more than the league's own platoon effect explains. ${platoon.reasons.join(' ')}`,
        severity: 'watch', urgency: { label: 'Review', days: null },
        horizon: { kind: 'unknown', days: null, basis: 'A platoon weakness lasts as long as he is the regular; it has no end date.' },
        causes: [{ playerId: m.playerId, name: m.name, role: h.role.label, status: m.availability.label ?? 'Active', daysLeft: null, assumed: false }],
        facts: [
          { label: 'Against left-handers', value: platoon.vsLeft.expected === null ? 'Unknown' : `${platoon.vsLeft.expected.toFixed(3).replace(/^0/, '')} expected wOBA (${platoon.vsLeft.pa} PA)` },
          { label: 'Against right-handers', value: platoon.vsRight.expected === null ? 'Unknown' : `${platoon.vsRight.expected.toFixed(3).replace(/^0/, '')} expected wOBA (${platoon.vsRight.pa} PA)` },
          { label: 'Basis', value: platoon.basis.replace(/_/g, ' ') },
        ],
        unknowns: ['This is a flag for your attention, not a recommendation to bench him: a platoon partner would play only against the hand he struggles with.'],
        returning: null, subject: { playerId: m.playerId, name: m.name }, platoon,
      });
    }
  }
  return needs;
}

/**
 * The lineup: who actually plays each position (from usage), each regular judged on his bat and his glove at the
 * position, and the platoon read on each. A position nobody has settled is named, not filled.
 */
export function lineupPictureFor(view: ClubView, ports: Pick<ReviewPorts, 'hitterUsage' | 'teamGames'>): LineupPicture | null {
  if (!ports.hitterUsage) return null;
  const hitters = activeMembers(view).filter((m) => m.role && (m.role.kind === 'position_player' || m.role.kind === 'catcher') && m.availability.status === 'available');
  if (hitters.length === 0) return null;
  const usage = ports.hitterUsage(hitters.map((m) => m.playerId));
  return buildLineupPicture(
    hitters.map((m) => ({ playerId: m.playerId, name: m.name, listed: m.role?.position ?? null, bats: null, fielding: [], gs: 0, pa: 0, ...(usage.get(m.playerId) ?? {}) })),
    ports.teamGames?.() ?? 0
  );
}

export function reviewLineup(view: ClubView, ports: ReviewPorts): RoleGroupReview | null {
  const picture = lineupPictureFor(view, ports);
  if (!picture) return null;
  const hitters = activeMembers(view).filter((m) => m.role && (m.role.kind === 'position_player' || m.role.kind === 'catcher') && m.availability.status === 'available');
  const regulars = [...picture.spots, picture.dh].filter((s) => s.regular);
  const subjects: Array<{ subject: ReviewSubject; role: RoleRef; position: number; member: RosterMember }> = [];
  for (const spot of regulars) {
    const member = hitters.find((m) => m.playerId === spot.regular?.playerId);
    const role = roleOf(spot.position, 0);
    if (!member || !role) continue;
    const e = ports.holderEvidence([member.playerId], role).get(member.playerId);
    if (e) subjects.push({ subject: subjectOf(member, e), role, position: spot.position, member });
  }
  if (subjects.length === 0) return { kind: 'position_player', role: 'lineup regular', holders: [], notReviewed: regulars.length, lineup: picture };
  const platoons = ports.platoon ? ports.platoon(subjects.map((x) => x.member.playerId)) : new Map<number, PlatoonInput>();
  const reviews = reviewGroup(subjects.map((x) => x.subject), { pitcher: false, role: 'lineup regular' });
  return {
    kind: 'position_player', role: 'lineup regular', notReviewed: regulars.length - subjects.length, lineup: picture,
    holders: reviews.map((r) => {
      const x = subjects.find((y) => y.subject.playerId === r.playerId) as (typeof subjects)[number];
      const input = platoons.get(r.playerId);
      return { ...r, role: x.role, position: x.position, platoon: input ? evaluatePlatoon(input) : null };
    }).sort((a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength] || (a.estimate.value ?? 101) - (b.estimate.value ?? 101) || a.name.localeCompare(b.name)),
  };
}

const KIND_TITLE: Record<HolderReview['kind'], string> = {
  ratings_and_results_weak: 'tools and results both point to a weak spot',
  weak_estimate: 'the weakest read in the group',
  tools_weak_results_fine: 'tools lag his results',
  results_weak_tools_fine: 'results lag his tools',
  too_early: 'too early to read',
  no_concern: 'no concern',
  cannot_judge: 'cannot be judged',
};

/** The need a strong or moderate finding raises. */
export function needFromReview(m: RosterMember, r: HolderReview, groupRole: string, roleOverride?: RoleRef | null, context: ContextRead | null = null): MlbNeed {
  const shade = flagShading(context, { strength: r.strength, subjectAge: m.age, stakes: r.stakes ?? null });
  const weakest = r.isWeakest ? `the weakest ${groupRole} on the club` : `${r.belowMedian !== null && r.belowMedian > 0 ? `${Math.round(r.belowMedian)} points below the ${groupRole} median` : `number ${r.rank} of ${r.groupSize}`}`;
  return {
    id: `mlb:role_holder_review:${m.playerId}`,
    kind: 'role_holder_review',
    origin: 'observed',
    role: roleOverride ?? m.role,
    title: `${m.name}${roleOverride && roleOverride.kind !== 'starting_pitcher' && roleOverride.kind !== 'relief_pitcher' ? ` (${roleOverride.label})` : ''}: ${weakest}; ${KIND_TITLE[r.kind]}`,
    summary: `${m.name} (${m.age ?? '?'}, ${groupRole}) rates ${r.strength === 'strong' ? 'as a strong case' : 'as a case'} for a look: ${r.reasons.join(' ')}`,
    severity: shade.level,
    shading: shade.reasons,
    urgency: { label: 'Review', days: null },
    horizon: { kind: 'unknown', days: null, basis: 'How long a replacement would be needed is not known, so it is not assumed: a stopgap and a lasting change are different assignments.' },
    causes: [{ playerId: m.playerId, name: m.name, role: m.role?.label ?? null, status: m.availability.label ?? 'Active', daysLeft: null, assumed: false }],
    facts: [
      { label: 'Working estimate', value: r.estimate.value === null ? 'Unknown' : `${ordinal(r.estimate.value)} percentile of MLB ${groupRole}s` },
      ...(r.estimate.ratingsPct !== null ? [{ label: 'Tools', value: `${ordinal(r.estimate.ratingsPct)} percentile` }] : []),
      ...(r.estimate.resultsPct !== null ? [{ label: 'Results', value: `${ordinal(r.estimate.resultsPct)} percentile (${Math.round(r.evidence.sample)} ${r.evidence.sampleUnit}, trusted ${Math.round(r.evidence.reliability * 100)}%)` }] : []),
      ...r.usage.map((u) => ({ label: 'Usage', value: u })),
    ],
    unknowns: [
      'This is a flag for your attention, not a recommendation to move him: it says where the evidence points and how sure it is.',
      ...r.explanations,
    ],
    returning: null,
    subject: { playerId: m.playerId, name: m.name },
    review: r,
  };
}

/** Needs from a club review: only real cases (strong or moderate), most concerning first. */
export function reviewNeeds(view: ClubView, groups: RoleGroupReview[], context: ContextRead | null = null): MlbNeed[] {
  const needs: MlbNeed[] = [];
  for (const g of groups) {
    for (const h of g.holders) {
      if (h.strength !== 'strong' && h.strength !== 'moderate') continue;
      const m = view.members.find((x) => x.playerId === h.playerId);
      if (m) needs.push(needFromReview(m, h, g.role, h.role, context));
    }
  }
  needs.sort((a, b) => (a.severity === b.severity ? a.title.localeCompare(b.title) : a.severity === 'elevated' ? -1 : 1));
  return [...needs, ...platoonNeeds(groups, view), ...benchNeeds(groups)];
}

/** One holder's need, for resolving a need id to the current review. Null when the finding no longer stands. */
export function reviewNeedFor(view: ClubView, playerId: number, ports: ReviewPorts, kind: MlbNeed['kind'] = 'role_holder_review'): MlbNeed | null {
  return reviewNeeds(view, reviewClub(view, ports), readContext(ports.organization ?? null)).find((n) => n.kind === kind && n.subject?.playerId === playerId) ?? null;
}

/** A review-raised need by its id (a holder, a platoon partner or a bench cover); null when the finding no longer stands. */
export function reviewNeedById(view: ClubView, needId: string, ports: ReviewPorts): MlbNeed | null {
  return reviewNeeds(view, reviewClub(view, ports), readContext(ports.organization ?? null)).find((n) => n.id === needId) ?? null;
}
