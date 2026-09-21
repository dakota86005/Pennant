/**
 * The staff report: a response packet read the way a GM's staff would brief it.
 *
 *   headline        what the situation is, in one line
 *   situation       the facts that make it a decision, each stated with its source
 *   role picture    the players who hold the role today beside the player under
 *                   discussion, on the one lens Player Development supplies
 *                   (`roleStanding.ts`), with season results shown for context
 *   the read        what that picture says: does he improve the group?
 *   pathways        named ways to act on it, each a chain of the transactions
 *                   Player Rights owns plus the clearing they need
 *
 * This composes; it decides nothing a specialist owns. The comparison is
 * Player Development's (`evaluateRoleStanding`), transaction status is Player
 * Rights', consequences come from the packet that Minor League Operations and
 * the roster view already fed. Pathways are options with their consequences and
 * an honest statement of how certain each is: they are ordered by how ready the
 * path is, never by a score, and the GM decides.
 */

import type { MlbNeed } from './mlbNeeds.js';
import type { LensEvidence } from './roleReview.js';
import type { Plan } from './mlbPlans.js';
import { estimateOf as workingEstimate, type ReplacementComparison } from './roleReview.js';
import type { PerformanceLine } from './mlbEvidence.js';
import { activeMembers, sameRole, type ClubView, type RoleRef, type RosterMember } from './mlbRoster.js';
import { lineupPictureFor } from './mlbReview.js';
import { actBar, type ActBar, type ShadeReason } from './staffPreference.js';
import type {
  ClearingOption, ClearingPacket, ConstraintClearing, ResponseCandidate, ResponsePorts, TransactionPath,
} from './mlbResponses.js';
import {
  evaluateRoleStanding, ordinal, resultsContext, STANDING_CALIBRATION,
  type ResultsMeasure, type RoleStanding, type StandingPlayer, type StandingVerdict,
} from './roleStanding.js';

export interface RoleRow {
  playerId: number;
  name: string;
  age: number | null;
  relation: 'incumbent' | 'subject';
  /** Where the subject would come from, or the incumbent's standing (Active, Day-to-day ...). */
  status: string;
  /** The visible tools against MLB peers (a composite percentile); null when not computable. */
  composite: number | null;
  /** What he has done, league-relative and recency weighted, as a percentile; null when there is no qualifying sample. */
  resultsPct: number | null;
  /** The working estimate blending the two by how far the results can be trusted; the number comparisons use. */
  estimate: number | null;
  /** Share of the estimate that comes from results, 0 to 1. */
  weightOnResults: number;
  /** Effective sample behind the results and how far it is trusted as his level. */
  sample: number;
  sampleUnit: 'PA' | 'BF';
  reliability: number;
  weakestCore: number | null;
  evidenceStatus: 'complete' | 'partial' | 'unknown';
  performance: PerformanceLine | null;
  standing: RoleStanding | null;
  /** How he is used (innings per start, leverage, saves and holds). */
  usage: string[];
  /** The holder the review is about. */
  underReview?: boolean;
  /** For a replacement candidate: how he compares with the player under review. */
  comparison?: Pick<ReplacementComparison, 'verdict' | 'delta' | 'toolsDelta' | 'resultsDelta' | 'certainty'> | null;
  /** Fill direction: the candidate group he is in, so the picture never implies an unblocked player is blocked. */
  group: string | null;
  /** For a platoon partner: his expected wOBA against the hand the regular struggles with, and whether the margin is enough (D-035). */
  complement?: { weakSide: 'L' | 'R'; expected: number | null; advantage: number | null; fits: boolean } | null;
}

export interface RolePicture {
  role: string;
  standard: { label: string; count: number; healthy: number } | null;
  rows: RoleRow[];
  basis: string;
  calibration: typeof STANDING_CALIBRATION;
}

export interface PathwayMove {
  playerId: number;
  name: string;
  role: string | null;
  transaction: string;
  class: string;
  rights: string;
  note: string;
}

export interface Pathway {
  id: string;
  title: string;
  why: string[];
  steps: string[];
  moves: PathwayMove[];
  /** Further moves of the same kind not listed, counted. */
  moreMoves: number;
  consequences: string[];
  certainty: TransactionPath['status'];
  certaintyNote: string;
}

/**
 * What the staff would do, and why, stated as a stance with the reasoning and what would change it. It is advice
 * from an explicit rubric (see `recommendationFor`), never a decision and never a hidden score.
 */
export interface Recommendation {
  stance: 'act' | 'explore' | 'monitor' | 'hold';
  headline: string;
  because: string[];
  /** For `explore`: what has to be settled before the case is clean. */
  toSettle: string[];
  /** What would change this recommendation. */
  wouldChange: string[];
  confidence: 'high' | 'moderate' | 'low';
  basis: string;
  /** How the organization's philosophy and the season leaned on this recommendation, each a named reason (D-036). Empty when nothing leaned. */
  shading?: ShadeReason[];
  /** What a club with no stated philosophy would be told, when that differs: so the effect of the philosophy is never hidden. */
  neutralStance?: 'act' | 'explore' | 'monitor' | 'hold' | null;
}

export interface StaffReport {
  recommendation?: Recommendation | null;
  headline: string;
  situation: string[];
  read: { verdict: StandingVerdict | null; text: string; caveats: string[] };
  rolePicture: RolePicture | null;
  pathways: Pathway[];
  /** How pathways are ordered, so it is never mistaken for a ranking of players. */
  orderingNote: string;
}

const TRANSACTION_WORDS: Record<ClearingOption['transaction'], string> = {
  option: 'Option to the minors', designate_for_assignment: 'Designate for assignment', place_on_sixty_day_il: 'Move to the 60-day list',
};

const CLASS_WORDS: Record<string, string> = {
  routine: 'routine and reversible', higher_cost: 'costs something lasting', disruptive: 'disruptive: puts him at risk', unresolved: 'not established',
};

const isPitcher = (role: RoleRef | null) => role?.kind === 'starting_pitcher' || role?.kind === 'relief_pitcher';
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const lineText = (p: PerformanceLine | null) => (p ? `${p.lines.map((l) => `${l.label} ${l.value}`).join(', ')} in ${p.sample} ${p.sampleUnit}` : null);

function rowFor(
  m: RosterMember, relation: RoleRow['relation'], ports: ResponsePorts, standing: RoleStanding | null, group: string | null = null,
  evidence?: Map<number, LensEvidence>
): RoleRow {
  const fit = ports.roleFit(m.playerId);
  const e = evidence?.get(m.playerId) ?? (m.role ? ports.holderEvidence([m.playerId], m.role).get(m.playerId) : undefined);
  const est = e ? workingEstimate(e, isPitcher(m.role)) : null;
  return {
    playerId: m.playerId, name: m.name, age: m.age, relation,
    status: relation === 'incumbent' ? (m.availability.label ?? 'Active') : (m.availability.label ?? 'Injured list'),
    composite: e ? e.ratingsPct : fit.compositePercentile, resultsPct: est?.resultsPct ?? null,
    estimate: est ? est.value : fit.compositePercentile, weightOnResults: est?.weightOnResults ?? 0,
    sample: e?.sample ?? 0, sampleUnit: e?.sampleUnit ?? 'BF', reliability: e?.reliability ?? 0,
    weakestCore: fit.weakestCorePercentile, evidenceStatus: e?.ratingsEvidence ?? fit.evidenceStatus,
    performance: ports.performance(m.playerId, 1, isPitcher(m.role)), standing, group, usage: e?.usage ?? [],
  };
}

/** ERA for a pitcher (lower is better), OPS for a hitter, from the objective season line; null when it is not there. */
function measureOf(p: PerformanceLine | null): ResultsMeasure | null {
  if (!p) return null;
  const get = (label: string) => {
    const v = Number(p.lines.find((l) => l.label === label)?.value);
    return Number.isFinite(v) ? v : null;
  };
  if (p.kind === 'pitching') {
    const era = get('ERA');
    return era === null ? null : { name: 'ERA', value: era, sample: p.sample, unit: 'IP', lowerIsBetter: true };
  }
  const obp = get('OBP');
  const slg = get('SLG');
  return obp === null || slg === null ? null : { name: 'OPS', value: obp + slg, sample: p.sample, unit: 'PA', lowerIsBetter: false };
}

/** A comparison uses the working estimate (tools and results, weighted by sample); the lenses stay visible beside it. */
const standingPlayer = (r: { playerId: number; name: string; estimate: number | null; evidenceStatus: StandingPlayer['evidenceStatus'] }): StandingPlayer => ({
  playerId: r.playerId, name: r.name, composite: r.estimate, evidenceStatus: r.evidenceStatus,
});

/** Incumbents of a role first by visible composite, then unassessed, then the subjects: a display order, stated as one. */
const displayOrder = (rows: RoleRow[]): RoleRow[] =>
  [...rows].sort((a, b) => (a.relation === b.relation ? 0 : a.relation === 'subject' ? 1 : -1)
    || (b.estimate ?? -1) - (a.estimate ?? -1) || a.name.localeCompare(b.name));

const BASIS = "Two lenses, always shown: the organization-visible tool ratings against MLB peers of the same kind (Player Development's composite percentile) and what the player has done (league-relative, recency-weighted results as a percentile among peers). The working estimate blends them, giving results more weight the more sample stands behind them; a player with no results is read on tools alone. It is a way to compare two players, not a value, a projection or a decision.";

function activeOptions(clearing: ClearingPacket | null, constraint: 'active_roster' | 'forty_man'): ClearingOption[] {
  return clearing?.constraints.find((c) => c.constraint === constraint)?.classes.flatMap((c) => c.options) ?? [];
}

const moveOf = (o: ClearingOption, note: string): PathwayMove => ({
  playerId: o.playerId, name: o.name, role: o.role?.label ?? null, transaction: TRANSACTION_WORDS[o.transaction],
  class: CLASS_WORDS[o.class] ?? o.class, rights: o.rights.label, note,
});

const farmLine = (o: ClearingOption): string | null => {
  const f = o.farm;
  if (!f) return null;
  const same = f.overall.before === f.overall.after;
  const status = `${f.affiliate.label} (${f.affiliate.levelName}) ${same ? `stays ${f.overall.after}` : `goes from ${f.overall.before} to ${f.overall.after}`}${f.changes.some((c) => c.before !== c.after) ? `; ${f.changes.filter((c) => c.before !== c.after).map((c) => `${c.label} ${c.before} to ${c.after}`).join(', ')}` : ''}.`;
  /* Minor League Operations' own sentence, when it has one: the job taken up, or the chain and where it stops. */
  return f.arrival ? `${status} ${f.arrival.summary}` : f.farm ? `${status} ${f.farm.summary}` : status;
};

const roleEffectLine = (o: ClearingOption): string | null =>
  o.roleEffect ? `${o.roleEffect.role} coverage: ${o.roleEffect.availableAfter} available against a floor of ${o.roleEffect.floor}${o.roleEffect.belowFloor ? ' (below it)' : ''}.` : null;

// ── an injured player returns ───────────────────────────────────────────────

function returnReport(need: MlbNeed, view: ClubView, ports: ResponsePorts, clearing: ClearingPacket | null): StaffReport | null {
  const returning = need.returning;
  const subject = returning ? view.members.find((m) => m.playerId === returning.playerId) : undefined;
  if (!returning || !subject) return null;
  const role = subject.role;
  const list = clearing?.activation?.facts.list ? `${clearing.activation.facts.list} injured list` : 'injured list';
  const days = returning.daysLeft;
  const active = view.counts.active;
  const limit = view.limits.active;

  const incumbents = role ? activeMembers(view).filter((m) => sameRole(m.role, role)) : [];
  const evidence = role ? ports.holderEvidence([...incumbents.map((m) => m.playerId), subject.playerId], role) : undefined;
  const incumbentRows = incumbents.map((m) => rowFor(m, 'incumbent', ports, null, null, evidence));
  const subjectRow = rowFor(subject, 'subject', ports, null, null, evidence);
  const standing: RoleStanding | null = role
    ? evaluateRoleStanding(standingPlayer(subjectRow), incumbentRows.map(standingPlayer))
    : null;
  subjectRow.standing = standing;

  const floor = role ? ports.floors.floors[role.kind] : undefined;
  const healthy = incumbents.filter((m) => m.availability.status === 'available').length;
  const situation = [
    `${subject.name} (${subject.age ?? '?'}, ${role?.label ?? 'role unknown'}) is due back from the ${list}${days === null ? '' : days <= 0 ? ' now' : ` in about ${plural(days, 'day')}`}.`,
    `The active roster is ${active ?? '?'} of ${limit ?? '?'}${active !== null && limit !== null && active >= limit ? ', so a player has to leave for him to be activated' : ''}.` +
      (returning.onFortyMan === false ? ` He is off the 40-man while on the 60-day list, so a 40-man spot is a second requirement (40-man: ${view.counts.fortyMan ?? '?'} of ${view.limits.fortyMan ?? '?'}).` : ''),
    ...(role && floor ? [`${plural(healthy, `healthy ${role.label}`)} are on the active roster against a floor of ${floor.count}; with him back, ${healthy + 1}.`] : []),
    clearing?.activation
      ? `Whether OOTP lets him be activated is ${clearing.activation.status === 'indeterminate' ? 'not established' : clearing.activation.status}: ${clearing.activation.label}. Every path below is only as certain as that.`
      : 'Player Rights returned no activation evaluation.',
  ];

  let verdictText: string;
  if (!standing) verdictText = `${subject.name} has no established role, so Pennant cannot place him against the current group.`;
  else if (standing.verdict === 'strengthens' && standing.displaces) {
    verdictText = `${subject.name} would improve the ${role?.label} group. On the working estimate he is ${standing.rank === 1 ? 'the best' : `number ${standing.rank}`} of ${standing.assessed + 1} (${ordinal(subjectRow.estimate ?? 0)} percentile of MLB peers), ${Math.round(standing.gapToWeakest ?? 0)} points clear of ${standing.displaces.name} (${ordinal(standing.displaces.composite)}), the weakest current ${role?.label}. ${standing.displaces.name} is the natural one to make room for him.`;
  } else if (standing.verdict === 'comparable') {
    verdictText = `${subject.name} is comparable to the back of the ${role?.label} group, not a clear upgrade: ${ordinal(subjectRow.estimate ?? 0)} percentile against ${standing.weakest?.name}'s ${ordinal(standing.weakest?.composite ?? 0)}. The reason to bring him back is depth and fit, not ability.`;
  } else if (standing.verdict === 'behind') {
    verdictText = `${subject.name} would not improve the ${role?.label} group: he is ${Math.round(-(standing.gapToWeakest ?? 0))} points below ${standing.weakest?.name}, the weakest current ${role?.label} (${ordinal(subjectRow.estimate ?? 0)} percentile against ${ordinal(standing.weakest?.composite ?? 0)}). Any case for activating him is depth, health or the return itself.`;
  } else verdictText = `Player Development cannot place ${subject.name} against the current ${role?.label} group. ${standing.reasons[0]}`;

  // ── pathways ──
  const activeOpts = activeOptions(clearing, 'active_roster');
  const fortyOpts = activeOptions(clearing, 'forty_man');
  const activeConstraint: ConstraintClearing | undefined = clearing?.constraints.find((c) => c.constraint === 'active_roster');
  const fortyConstraint: ConstraintClearing | undefined = clearing?.constraints.find((c) => c.constraint === 'forty_man');
  const needsActive = activeConstraint?.state === 'clearing_needed';
  const needsForty = fortyConstraint?.state === 'clearing_needed';
  const certainty = clearing?.chainStatus ?? 'indeterminate';
  const certaintyNote = clearing?.activation ? `The activation is ${clearing.activation.label.toLowerCase()}.` : 'The activation could not be evaluated.';
  const activateStep = `Activate ${subject.name} from the ${list} (${clearing?.activation?.label ?? 'not evaluated'}).`;
  const fortyStep = needsForty
    ? `Clear a 40-man spot first: ${fortyOpts.some((o) => o.class === 'routine') ? 'the 60-day list is available' : `${plural(fortyOpts.filter((o) => o.transaction === 'designate_for_assignment').length, 'designation')} ${fortyOpts.filter((o) => o.transaction === 'designate_for_assignment').length === 1 ? 'is' : 'are'} the way to do it`} (see the 40-man options).`
    : null;
  const pathways: Pathway[] = [];

  const displaced = standing?.verdict === 'strengthens' ? standing.displaces : null;
  if (displaced && role) {
    const opt = activeOpts.find((o) => o.playerId === displaced.playerId);
    const gain = true;
    const results = resultsContext(measureOf(subjectRow.performance), { name: displaced.name, measure: measureOf(incumbentRows.find((r) => r.playerId === displaced.playerId)?.performance ?? null) }, incumbentRows.map((r) => ({ name: r.name, measure: measureOf(r.performance) })));
    pathways.push({
      id: 'displace',
      title: `Put ${subject.name} in the ${role.label} group in place of ${displaced.name}`,
      why: [
        gain ? `${subject.name} is clearly ahead of ${displaced.name} on the working estimate (${ordinal(subjectRow.estimate ?? 0)} against ${ordinal(displaced.composite)} percentile).` : '',
        ...(lineText(subjectRow.performance) ? [`${subject.name} this season: ${lineText(subjectRow.performance)}.`] : []),
        ...(lineText(incumbentRows.find((r) => r.playerId === displaced.playerId)?.performance ?? null) ? [`${displaced.name} this season: ${lineText(incumbentRows.find((r) => r.playerId === displaced.playerId)?.performance ?? null)}.`] : []),
        ...results,
      ].filter(Boolean),
      steps: [
        ...(fortyStep ? [fortyStep] : []),
        needsActive
          ? opt ? `Clear the active spot by moving ${displaced.name}: ${TRANSACTION_WORDS[opt.transaction].toLowerCase()} (${CLASS_WORDS[opt.class]}).` : `Clear an active spot; ${displaced.name} cannot be evaluated as a move.`
          : 'An active spot is open; nobody has to be moved.',
        activateStep,
      ],
      moves: opt ? [moveOf(opt, opt.transaction === 'option' ? 'Stays on the 40-man and can be recalled.' : 'Leaves the 40-man; another club may claim him.')] : [],
      moreMoves: 0,
      consequences: opt ? [roleEffectLine(opt), farmLine(opt), ...opt.costs.slice(0, 2)].filter((x): x is string => !!x) : [],
      certainty, certaintyNote,
    });
  }

  // Keep the group as it is and clear the spot where coverage is not touched.
  if (needsActive && role) {
    const surplus = activeOpts.filter((o) => o.role && o.role.kind !== role.kind && o.roleEffect && !o.roleEffect.belowFloor && o.class !== 'unresolved' && o.class !== 'disruptive');
    const unchecked = activeOpts.filter((o) => o.role && o.role.kind !== role.kind && !o.roleEffect && (o.class === 'routine' || o.class === 'higher_cost'));
    const shown = [...surplus, ...unchecked].slice(0, 6);
    const total = surplus.length + unchecked.length;
    if (total > 0) {
      pathways.push({
        id: 'elsewhere',
        title: `Keep the ${role.label} group as it is and clear the spot elsewhere`,
        why: [
          surplus.length > 0
            ? `${plural(surplus.length, 'player')} in other roles can be moved without taking that role below its coverage floor.`
            : 'No other role has a coverage floor to check, so the effect of moving these players is not assessed.',
          ...(standing && standing.verdict !== 'strengthens' ? [`He does not clearly improve the ${role.label} group, so displacing a current ${role.label} is not where the gain is.`] : []),
        ],
        steps: [
          ...(fortyStep ? [fortyStep] : []),
          'Clear the active spot with one of the moves below, each an option that keeps the player on the 40-man.',
          activateStep,
        ],
        moves: shown.map((o) => moveOf(o, roleEffectLine(o) ?? 'No coverage standard for this role: the effect on the roster is not assessed.')),
        moreMoves: Math.max(0, total - shown.length),
        consequences: [
          `Coverage for ${[...new Set(surplus.map((o) => o.role?.label))].filter(Boolean).join(', ') || 'these roles'} stays at or above its floor.`,
          'Each move is an option: it uses an option year if one is not already charged this season (see the options below).',
        ],
        certainty, certaintyNote,
      });
    }
  }

  const resultNotes = role ? resultsContext(
    measureOf(subjectRow.performance),
    standing?.displaces ? { name: standing.displaces.name, measure: measureOf(incumbentRows.find((r) => r.playerId === standing.displaces?.playerId)?.performance ?? null) } : null,
    incumbentRows.map((r) => ({ name: r.name, measure: measureOf(r.performance) }))
  ) : [];
  const spotNote = needsActive ? 'a spot has to be cleared' : 'a spot is open';
  const headline = `${subject.name}'s return: ${standing?.verdict === 'strengthens' ? `he would improve the ${role?.label} group` : standing?.verdict === 'comparable' ? `no clear upgrade over your ${role?.label} depth` : standing?.verdict === 'behind' ? `he would not improve the ${role?.label} group` : `the ${role?.label ?? 'roster'} effect cannot be judged`}, and ${spotNote}`;
  return {
    headline, situation,
    read: { verdict: standing?.verdict ?? null, text: verdictText, caveats: [...(standing?.caveats ?? []), ...resultNotes] },
    rolePicture: role ? {
      role: role.label,
      standard: floor ? { label: floor.label, count: floor.count, healthy } : null,
      rows: displayOrder([...incumbentRows, subjectRow]), basis: BASIS, calibration: STANDING_CALIBRATION,
    } : null,
    pathways,
    orderingNote: 'Pathways are options, not a ranking of players. They are listed by what the roster picture supports, and the decision is yours.',
  };
}

// ── a role needs filling ────────────────────────────────────────────────────

const GROUP_READINESS: Record<string, number> = { open: 0, open_requires_clearing: 1, context_dependent: 2, role_concern: 3 };
const VERDICT_ORDER: Record<StandingVerdict, number> = { strengthens: 0, comparable: 1, cannot_judge: 2, behind: 3 };
const PATH_WORDS: Record<ResponseCandidate['pathKind'], string> = { role_change: 'Change role', recall: 'Recall', add_to_forty_man: 'Add to the 40-man and promote' };

function fillReport(need: MlbNeed, view: ClubView, ports: ResponsePorts, candidates: ResponseCandidate[]): StaffReport | null {
  const role = need.role;
  if (!role) return null;
  // A player the GM assumed out is not one of the current holders.
  const assumedOut = new Set(need.causes.filter((c) => c.assumed).map((c) => c.playerId));
  const incumbents = activeMembers(view).filter((m) => sameRole(m.role, role) && !assumedOut.has(m.playerId));
  const viable = candidates.filter((c) => c.pathKind !== 'role_change' && c.group in GROUP_READINESS);
  const evidence = ports.holderEvidence([...incumbents.map((m) => m.playerId), ...viable.map((c) => c.playerId)], role);
  const incumbentRows = incumbents.map((m) => rowFor(m, 'incumbent', ports, null, null, evidence));
  const floor = ports.floors.floors[role.kind];
  const healthy = incumbents.filter((m) => m.availability.status === 'available').length;
  // Injured players due back inside the horizon are the other way this closes; the report says so.
  const returners = need.horizon.kind === 'temporary'
    ? need.causes.filter((c) => !c.assumed && c.daysLeft !== null && c.daysLeft > 0 && c.daysLeft === need.horizon.days)
    : [];

  const rows: RoleRow[] = viable.map((c) => {
    const fit = c.roleFit?.evidence;
    const e = evidence.get(c.playerId);
    const est = e ? workingEstimate(e, isPitcher(role)) : null;
    const row: RoleRow = {
      playerId: c.playerId, name: c.name, age: c.age, relation: 'subject',
      status: `${c.pathKind === 'recall' ? 'Recall' : 'Add to 40-man'}, level ${c.level ?? '?'}`,
      composite: e?.ratingsPct ?? fit?.compositePercentile ?? null, resultsPct: est?.resultsPct ?? null,
      estimate: est ? est.value : fit?.compositePercentile ?? null, weightOnResults: est?.weightOnResults ?? 0,
      sample: e?.sample ?? 0, sampleUnit: e?.sampleUnit ?? 'BF', reliability: e?.reliability ?? 0, weakestCore: fit?.weakestCorePercentile ?? null,
      evidenceStatus: e?.ratingsEvidence ?? fit?.evidenceStatus ?? 'unknown', performance: c.performance, standing: null, group: c.group, usage: e?.usage ?? [],
    };
    row.standing = evaluateRoleStanding(standingPlayer(row), incumbentRows.map(standingPlayer));
    return row;
  });

  const situation = [
    need.summary,
    ...need.causes.map((c) => `${c.name}: ${c.assumed ? 'assumed unavailable (your scenario)' : `${c.status}${c.daysLeft ? `, ${plural(c.daysLeft, 'day')} left` : ''}`}.`),
    `Expected duration: ${need.horizon.kind === 'unknown' ? 'not known, so it is not assumed' : `${need.horizon.kind.replace('_', '-')}, about ${plural(need.horizon.days ?? 0, 'day')}`}.`,
    ...returners.map((c) => `${c.name} is due back from the injured list in about ${plural(c.daysLeft ?? 0, 'day')}. That closes the shortfall on its own if he is activated (whether he can be is not established), so what is being asked of the candidates below is a bridge, not a permanent answer.`),
  ];

  const byVerdict = (v: StandingVerdict) => rows.filter((r) => r.standing?.verdict === v).sort((a, b) => (b.estimate ?? 0) - (a.estimate ?? 0)).map((r) => r.name);
  const up = byVerdict('strengthens');
  const flat = byVerdict('comparable');
  const down = byVerdict('behind');
  const unknown = byVerdict('cannot_judge');
  const weakestInc = rows[0]?.standing?.weakest;
  const below = floor && healthy < floor.count;
  let text: string;
  if (viable.length === 0) {
    text = `No internal player clears Player Development and Player Rights for this ${role.label} spot yet; the candidates who do not are listed below with why.${returners.length ? ` ${returners[0].name}'s expected return in about ${plural(returners[0].daysLeft ?? 0, 'day')} would close the gap on its own.` : ''}`;
  } else {
    // The role is short, so each candidate fills an open slot rather than displacing anyone; the comparison says what kind of ${role} he would be.
    const parts = [
      up.length ? `${up.join(', ')} ${up.length === 1 ? 'is' : 'are'} clearly better than the weakest current ${role.label}${weakestInc ? ` (${weakestInc.name}, ${ordinal(weakestInc.composite)} percentile)` : ''}` : '',
      flat.length ? `${flat.join(', ')} ${flat.length === 1 ? 'is' : 'are'} in line with the back of the group` : '',
      down.length ? `${down.join(', ')} would be the weakest ${role.label}${down.length === 1 ? '' : 's'} on the club by visible ratings` : '',
      unknown.length ? `${unknown.join(', ')} cannot be placed (no visible rating)` : '',
    ].filter(Boolean);
    text = `${below ? `The ${role.label} spot is open, so each candidate fills it rather than replacing someone. ` : ''}Of the ${plural(viable.length, 'internal candidate')} not blocked by Player Development or Player Rights: ${parts.join('; ')}. Whether a candidate can be used now also depends on the path below.${returners.length ? ` ${returners[0].name}'s expected return in about ${plural(returners[0].daysLeft ?? 0, 'day')} would close the gap on its own.` : ''}`;
  }

  const pathways: Pathway[] = [...viable]
    .sort((a, b) => GROUP_READINESS[a.group] - GROUP_READINESS[b.group]
      || VERDICT_ORDER[rows.find((r) => r.playerId === a.playerId)?.standing?.verdict ?? 'cannot_judge'] - VERDICT_ORDER[rows.find((r) => r.playerId === b.playerId)?.standing?.verdict ?? 'cannot_judge']
      || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map((c) => {
      const st = rows.find((r) => r.playerId === c.playerId)?.standing ?? null;
      return {
        id: `candidate:${c.playerId}`,
        title: `${PATH_WORDS[c.pathKind]}: ${c.name}${c.level ? ` (level ${c.level})` : ''}`,
        why: [
          ...(st ? st.reasons.slice(0, 2) : []),
          c.development.status === 'defensible' || c.development.status === 'context_dependent'
            ? `Player Development: ${c.development.status === 'context_dependent' && c.development.duration ? c.development.duration.explanation : 'defensible for this assignment'}.`
            : 'Player Development has not been asked, or has nothing to add.',
          ...(lineText(c.performance) ? [`This season (level ${c.performance?.level}): ${lineText(c.performance)}.`] : []),
        ],
        steps: c.path.chain.length ? c.path.chain.map((l) => `${l.label}${l.detail ? ` — ${l.detail}` : ''}`) : c.path.steps.map((s) => s.label),
        moves: [], moreMoves: 0,
        consequences: [
          ...(c.consequences.farm
            ? [
                `${c.consequences.farm.affiliate.label} (${c.consequences.farm.affiliate.levelName}): ${c.consequences.farm.overall.before === c.consequences.farm.overall.after ? `stays ${c.consequences.farm.overall.after}` : `${c.consequences.farm.overall.before} to ${c.consequences.farm.overall.after}`}.${c.consequences.farm.farm ? ` ${c.consequences.farm.farm.summary}` : ''}`,
                ...(c.consequences.farm.farm?.unresolvedIssues.map((u) => `Left open below: ${u}`) ?? []),
              ]
            : []),
          ...(c.requiresClearing.fortyMan || c.requiresClearing.active ? [`Needs ${[c.requiresClearing.fortyMan ? 'a 40-man spot' : '', c.requiresClearing.active ? 'an active-roster spot' : ''].filter(Boolean).join(' and ')} cleared first (see the clearing options).`] : []),
        ],
        certainty: c.path.status,
        certaintyNote: c.path.status === 'open' ? 'Player Rights raises no objection to any step.' : c.path.status === 'open_with_requirements' ? 'Rights allows each step; a roster spot has to be cleared first.' : c.path.status === 'indeterminate' ? 'At least one step cannot be established from the evidence available.' : 'A step is not allowed.',
      };
    });

  return {
    headline: need.title,
    situation,
    read: { verdict: up.length ? 'strengthens' : flat.length ? 'comparable' : down.length ? 'behind' : viable.length ? 'cannot_judge' : null, text, caveats: [...new Set(rows.flatMap((r) => r.standing?.caveats ?? []))] },
    rolePicture: {
      role: role.label, standard: floor ? { label: floor.label, count: floor.count, healthy } : null,
      rows: displayOrder([...incumbentRows, ...rows]), basis: BASIS, calibration: STANDING_CALIBRATION,
    },
    pathways,
    orderingNote: 'Pathways are ordered by how ready the path is (nothing to clear first, then a spot to clear, then duration-dependent), then by where the player stands against the current group. That is an order of readiness, not a ranking of players, and the decision is yours.',
  };
}

// ── a role holder under review ──────────────────────────────────────────────

const VERDICT_WORD: Record<ReplacementComparison['verdict'], string> = {
  clear_upgrade: 'a clear upgrade', upgrade_uncertain: 'an upgrade on paper, not firm', marginal: 'a marginal upgrade',
  sidegrade: 'a sidegrade', downgrade: 'a downgrade', cannot_judge: 'cannot be compared',
};
const COMPARISON_ORDER: Record<ReplacementComparison['verdict'], number> = {
  clear_upgrade: 0, upgrade_uncertain: 1, marginal: 2, sidegrade: 3, cannot_judge: 4, downgrade: 5,
};

const RECOMMENDATION_BASIS = 'The staff recommendation follows a stated rubric: ACT when the case against the holder is strong, a replacement is a clear and firm upgrade, his path is open and defensible, and a plan exists that puts nobody at risk; EXPLORE when a real upgrade exists but something must be settled first, or the only way is disruptive; MONITOR when the case is moderate or the gain marginal; HOLD when nothing internal improves on him. It is advice, not a decision.';

/** The recommendation for a flagged holder, as the staff would give it to this club: the rubric applied with the organization's bar (D-036), beside what a club without one would hear. */
function recommendationFor(
  need: MlbNeed, subject: RosterMember, lead: ResponseCandidate | null, held: ResponseCandidate[], plans: Plan[], ports: ResponsePorts
): Recommendation | null {
  const org = ports.organization ?? null;
  const shaded = coreRecommendation(need, subject, lead, held, plans, org ? actBar(org) : null);
  if (!shaded) return null;
  if (!org) return shaded;
  const neutral = coreRecommendation(need, subject, lead, held, plans, null);
  const shading = [...(shaded.shading ?? []), ...(lead?.preference?.reasons ?? [])];
  const differs = neutral !== null && neutral.stance !== shaded.stance;
  return { ...shaded, shading, neutralStance: differs && neutral ? neutral.stance : null };
}

function coreRecommendation(
  need: MlbNeed, subject: RosterMember, lead: ResponseCandidate | null, held: ResponseCandidate[], plans: Plan[], bar: ActBar | null
): Recommendation | null {
  const review = need.review;
  if (!review) return null;
  const strong = review.strength === 'strong';
  const moderateAllowed = review.strength === 'moderate' && !!bar?.allowModerate;
  const strongEnough = strong || moderateAllowed;
  const older = !!bar && bar.olderLimit !== null && !!lead && lead.age !== null && subject.age !== null && lead.age - subject.age >= bar.olderLimit;
  const shading: ShadeReason[] = [];
  if (moderateAllowed && bar?.why.allowModerate) shading.push(bar.why.allowModerate);
  if (bar?.patient && review.strength === 'moderate' && bar.why.patient) shading.push(bar.why.patient);
  if (older && bar?.why.older) shading.push(bar.why.older);
  const reliable = review.evidence.reliability >= 0.6;
  const cmp = lead?.comparison ?? null;
  const clear = cmp?.verdict === 'clear_upgrade';
  const ready = !!lead && (lead.group === 'open' || lead.group === 'open_requires_clearing') && (lead.path.status === 'open' || lead.path.status === 'open_with_requirements');
  const cleanPlan = plans.find((p) => p.id !== 'designate' && (p.certainty === 'open' || p.certainty === 'open_with_requirements'));
  const wouldChange = [
    'A change in his tools or a sustained change in his results.',
    ...(review.evidence.reliability < 0.6 ? ['More major-league sample: the results lens is still being built.'] : []),
  ];
  const basis = RECOMMENDATION_BASIS;
  const delta = (c: ResponseCandidate | null) => (c?.comparison?.delta ?? null) === null ? '' : ` (${(c!.comparison!.delta as number) >= 0 ? '+' : ''}${Math.round(c!.comparison!.delta as number)})`;

  if (lead && clear && strongEnough && ready && cleanPlan && !older) {
    return {
      shading,
      stance: 'act',
      headline: `Recommend the change: ${cleanPlan.title}.`,
      because: [
        `Both lenses agree on ${subject.name}: he is at the back of the group (${review.estimate.value === null ? '?' : Math.round(review.estimate.value)}th percentile working estimate).${moderateAllowed ? ' It is a moderate case, but the club cannot afford to wait.' : ''}`,
        `${lead.name} is a clear upgrade${delta(lead)} on an adequate read, and Player Development and Player Rights raise no objection.`,
        `The plan puts nobody at risk: ${cleanPlan.summary}`,
        ...(cmp?.candidateEstimate != null && review.groupMedian !== null && cmp.candidateEstimate < review.groupMedian
          ? [`Be clear about what it buys: ${lead.name} would still be at the ${ordinal(cmp.candidateEstimate)} percentile, below the group median (${ordinal(review.groupMedian)}). It fixes the weakest spot; it does not make it a strong one.`]
          : []),
      ],
      toSettle: [], wouldChange,
      confidence: reliable && cmp?.certainty === 'adequate' ? 'high' : 'moderate', basis,
    };
  }
  if (lead && cmp && ['clear_upgrade', 'upgrade_uncertain'].includes(cmp.verdict) && (strong || (review.strength === 'moderate' && !bar?.patient))) {
    const settle: string[] = [];
    if (older) settle.push(`${lead.name} is ${(lead.age as number) - (subject.age as number)} years older than ${subject.name}; a club that is building or discounts aging may prefer the younger player's development.`);
    if (!ready) {
      if (lead.development.status === 'context_dependent' && lead.development.duration) settle.push(lead.development.duration.explanation);
      else if (lead.group === 'evaluation_incomplete') settle.push('Player Development cannot yet establish that the assignment is defensible for him.');
      if (lead.path.status === 'indeterminate') settle.push(...lead.path.unknowns.slice(0, 2));
      if (settle.length === 0) settle.push('The path is not yet open.');
    }
    if (cmp.verdict === 'upgrade_uncertain') settle.push(`The read on ${lead.name} rests on ${cmp.certainty === 'thin' ? 'incomplete tools' : 'one lens'}, so the gain is not firm.`);
    if (ready && !cleanPlan) settle.push(`The only way to make room is disruptive (${plans.map((p) => p.title).join('; ') || 'none available'}).`);
    return {
      shading,
      stance: 'explore',
      headline: `Worth pursuing, with something to settle first: ${lead.name} would be ${VERDICT_WORD[cmp.verdict]}${delta(lead)} over ${subject.name}.`,
      because: [
        `${subject.name} is a ${review.strength} case (${review.kind === 'ratings_and_results_weak' ? 'tools and results agree' : 'weak estimate'}).`,
        `${lead.name} is the most ready internal option.`,
      ],
      toSettle: settle, wouldChange: [...wouldChange, 'Settling the item above would move this to a recommendation.'],
      confidence: strong ? 'moderate' : 'low', basis,
    };
  }
  // No internal replacement is ready, but a regular can move to the weak spot and the spot he leaves be covered from within.
  const shiftPlan = plans.find((p) => p.id === 'shift');
  if (shiftPlan && (strong || (review.strength === 'moderate' && !bar?.patient))) {
    return {
      shading,
      stance: 'explore',
      headline: `Worth pursuing, without adding anyone: ${shiftPlan.title}.`,
      because: [
        `${subject.name} is a ${review.strength} case (${review.kind === 'ratings_and_results_weak' ? 'tools and results agree' : 'weak estimate'}).`,
        shiftPlan.summary,
      ],
      toSettle: [`A regular changes position. Check what the visible grade and experience at the new position say${shiftPlan.steps[0]?.note ? ` (${shiftPlan.steps[0].note})` : ''}; a position change carries a comfort cost the estimate cannot see.`],
      wouldChange: [...wouldChange, 'A better internal replacement becoming available, or the regular\'s defense at the new position proving weaker than the grade suggests.'],
      confidence: 'moderate', basis,
    };
  }
  const topHeld = held.find((h) => ['clear_upgrade', 'upgrade_uncertain'].includes((h.comparison as ReplacementComparison).verdict));
  if (topHeld && !clear && (strong || review.strength === 'moderate')) {
    const top = topHeld;
    return {
      shading,
      stance: 'explore',
      headline: `${lead ? `The best option that is ready (${lead.name}) is not a clear upgrade, but` : 'Nothing is ready today, but'} ${top.name} would be ${VERDICT_WORD[(top.comparison as ReplacementComparison).verdict]}${delta(top)} over ${subject.name} if what is holding him up is resolved.`,
      because: [`${subject.name} is a ${review.strength} case.`, ...top.why.slice(0, 2)],
      toSettle: top.why.slice(0, 3), wouldChange: [...wouldChange, `${top.name}'s situation changing.`],
      confidence: 'low', basis,
    };
  }
  if (cmp && cmp.verdict === 'marginal' || review.strength === 'moderate' || !reliable) {
    return {
      shading,
      stance: 'monitor',
      headline: `Keep watching ${subject.name}: ${review.strength === 'moderate' ? (bar?.patient ? 'the case is real but neither the window nor the season presses' : 'the case is real but not strong') : !reliable ? 'the sample behind his results is still small' : 'the best internal option is only a marginal upgrade'}.`,
      because: review.reasons.slice(0, 2), toSettle: [], wouldChange, confidence: 'low', basis,
    };
  }
  return {
    shading,
    stance: 'hold',
    headline: `Nothing internal improves on ${subject.name} today: holding is the only option this tool can put on the table.`,
    because: [...review.reasons.slice(0, 1), 'No internal candidate is a clear upgrade that Player Development and Player Rights allow.'],
    toSettle: [], wouldChange: [...wouldChange, 'An internal player developing or returning, which is where this looks first.'],
    confidence: strong ? 'moderate' : 'low', basis,
  };
}

function replaceReport(
  need: MlbNeed, view: ClubView, ports: ResponsePorts, candidates: ResponseCandidate[], plans: Plan[], lead: ResponseCandidate | null
): StaffReport | null {
  const review = need.review;
  const role = need.role;
  const subject = need.subject ? view.members.find((m) => m.playerId === need.subject?.playerId) : undefined;
  if (!review || !role || !subject) return null;

  // For a fielder the picture is who actually plays the position (regular and backups by usage), not who is listed there.
  const fielder = role.kind === 'position_player' || role.kind === 'catcher';
  const picture = fielder ? lineupPictureFor(view, ports) : null;
  const spot = picture ? (role.position === 10 ? picture.dh : picture.spots.find((x) => x.position === role.position)) : undefined;
  const usageIds = spot ? [spot.regular, ...spot.backups].flatMap((p) => (p ? [p.playerId] : [])) : [];
  const incumbents = spot
    ? activeMembers(view).filter((m) => usageIds.includes(m.playerId) || m.playerId === subject.playerId)
    : activeMembers(view).filter((m) => sameRole(m.role, role));
  const viable = candidates.filter((c) => c.group in GROUP_READINESS && (c.pathKind !== 'role_change' || fielder));
  // Every candidate is compared, so the picture also shows who would help but is held up.
  const compared = candidates.filter((c) => c.comparison && (c.pathKind !== 'role_change' || fielder));
  const evidence = ports.holderEvidence([...incumbents.map((m) => m.playerId), ...compared.map((c) => c.playerId)], role);
  const incumbentRows = incumbents.map((m) => ({ ...rowFor(m, 'incumbent', ports, null, null, evidence), underReview: m.playerId === subject.playerId }));
  const candidateRows: RoleRow[] = compared.map((c) => {
    const e = evidence.get(c.playerId);
    const est = e ? workingEstimate(e, isPitcher(role)) : null;
    return {
      playerId: c.playerId, name: c.name, age: c.age, relation: 'subject' as const,
      status: c.pathKind === 'role_change' ? 'On the bench' : `${c.pathKind === 'recall' ? 'Recall' : 'Add to 40-man'}, level ${c.level ?? '?'}`,
      composite: e?.ratingsPct ?? null, resultsPct: est?.resultsPct ?? null, estimate: est ? est.value : null,
      weightOnResults: est?.weightOnResults ?? 0, sample: e?.sample ?? 0, sampleUnit: e?.sampleUnit ?? 'BF', reliability: e?.reliability ?? 0,
      weakestCore: c.roleFit?.evidence.weakestCorePercentile ?? null, evidenceStatus: e?.ratingsEvidence ?? 'unknown',
      performance: c.performance, standing: null, group: c.group, usage: e?.usage ?? [],
      comparison: c.comparison ? { verdict: c.comparison.verdict, delta: c.comparison.delta, toolsDelta: c.comparison.toolsDelta, resultsDelta: c.comparison.resultsDelta, certainty: c.comparison.certainty } : null,
    };
  });

  const floor = ports.floors.floors[role.kind];
  const healthy = incumbents.filter((m) => m.availability.status === 'available').length;
  const ord = (n: number | null) => (n === null ? '?' : ordinal(n));
  const est = review.estimate;

  const situation = [
    `${subject.name} (${subject.age ?? '?'}, ${role.label}) is ${review.isWeakest ? `the weakest of ${review.groupSize} ${review.group}s` : `number ${review.rank} of ${review.groupSize} ${review.group}s`} by working estimate (${ord(est.value)} percentile of MLB ${review.group}s).`,
    ...review.reasons,
    ...review.usage,
  ];

  const ranked = viable
    .filter((c) => c.comparison)
    .sort((a, b) => COMPARISON_ORDER[(a.comparison as ReplacementComparison).verdict] - COMPARISON_ORDER[(b.comparison as ReplacementComparison).verdict]
      || ((b.comparison as ReplacementComparison).delta ?? -99) - ((a.comparison as ReplacementComparison).delta ?? -99) || a.name.localeCompare(b.name));
  const upgrades = ranked.filter((c) => ['clear_upgrade', 'upgrade_uncertain', 'marginal'].includes((c.comparison as ReplacementComparison).verdict));
  const listed = (cs: ResponseCandidate[]) => cs.map((c) => `${c.name} (${(c.comparison as ReplacementComparison).delta !== null ? `${(c.comparison as ReplacementComparison).delta! >= 0 ? '+' : ''}${Math.round((c.comparison as ReplacementComparison).delta as number)}` : '?'})`).join(', ');
  const clear = ranked.filter((c) => (c.comparison as ReplacementComparison).verdict === 'clear_upgrade');
  const soft = ranked.filter((c) => (c.comparison as ReplacementComparison).verdict === 'upgrade_uncertain');
  const marginal = ranked.filter((c) => (c.comparison as ReplacementComparison).verdict === 'marginal');

  const agreement = review.kind === 'ratings_and_results_weak'
    ? `Both lenses agree: his tools (${ord(est.ratingsPct)}) and his results (${ord(est.resultsPct)}) are at the back of the group, and results carry ${Math.round(est.weightOnResults * 100)}% of the estimate.`
    : review.kind === 'weak_estimate'
      ? `His working estimate is at the back of the group (${ord(est.value)}).`
      : KIND_READ[review.kind];
  // Upgrades that are held up: the scout's "he is the guy, but..." line.
  const HELD: Record<string, string> = {
    indeterminate: 'the transaction cannot be established from the evidence available',
    evaluation_incomplete: 'Player Development cannot yet establish that the assignment is defensible for him',
    blocked_by_rights: 'the rules do not allow the move',
    blocked_by_development: 'Player Development does not support the assignment',
    unavailable: 'he is unavailable',
  };
  const held = compared.filter((c) => c.group in HELD && ['clear_upgrade', 'upgrade_uncertain', 'marginal'].includes((c.comparison as ReplacementComparison).verdict))
    .sort((a, b) => COMPARISON_ORDER[(a.comparison as ReplacementComparison).verdict] - COMPARISON_ORDER[(b.comparison as ReplacementComparison).verdict] || ((b.comparison as ReplacementComparison).delta ?? -99) - ((a.comparison as ReplacementComparison).delta ?? -99));
  const heldText = held.length
    ? ` Held up: ${held.slice(0, 4).map((c) => `${c.name} would be ${VERDICT_WORD[(c.comparison as ReplacementComparison).verdict]} (${(c.comparison as ReplacementComparison).delta! >= 0 ? '+' : ''}${Math.round((c.comparison as ReplacementComparison).delta as number)}) but ${HELD[c.group]}`).join('; ')}.`
    : '';
  const options = viable.length === 0
    ? `No internal candidate is ready to take his spot today.${heldText}`
    : upgrades.length === 0
      ? 'No internal candidate clearly improves on him: the players who clear Player Development and Player Rights are sidegrades or downgrades.'
      : [
        clear.length ? `${listed(clear)} ${clear.length === 1 ? 'is' : 'are'} a clear upgrade` : '',
        soft.length ? `${listed(soft)} ${soft.length === 1 ? 'is' : 'are'} an upgrade on paper, but ${soft.length === 1 ? 'his' : 'their'} read is not firm` : '',
        marginal.length ? `${listed(marginal)} ${marginal.length === 1 ? 'is' : 'are'} only a marginal upgrade` : '',
      ].filter(Boolean).join('; ') + ` (points of working estimate over him).${heldText}`;

  return {
    recommendation: recommendationFor(need, subject, lead, held, plans, ports),
    headline: need.title,
    situation,
    read: {
      verdict: clear.length ? 'strengthens' : upgrades.length ? 'comparable' : viable.length ? 'behind' : 'cannot_judge',
      text: `${agreement} ${options}${plans.length ? ` The simplest way to make room is set out in the plans below.` : ''}`,
      caveats: [...review.explanations, ...review.wouldChange],
    },
    rolePicture: {
      role: role.label, standard: floor ? { label: floor.label, count: floor.count, healthy } : null,
      rows: displayOrder([...incumbentRows, ...candidateRows]), basis: BASIS, calibration: STANDING_CALIBRATION,
    },
    pathways: [],
    orderingNote: 'Plans are options, not a ranking of players. They are ordered by how ready each path is, then by what it costs, and the decision is yours.',
  };
}

const KIND_READ: Record<string, string> = {
  tools_weak_results_fine: 'His tools are at the back of the group but his results are holding up: a watch item, since results ahead of tools tend to regress.',
  results_weak_tools_fine: 'His results are at the back of the group but his tools are not: a watch item, since he may be underperforming what the tools suggest.',
  too_early: 'There is not yet enough sample behind his results to read them.',
  no_concern: 'The evidence raises no concern about him.',
  cannot_judge: 'There is no evidence on either lens to judge him on.',
  ratings_and_results_weak: '', weak_estimate: '',
};

// ── a platoon partner for a regular ─────────────────────────────────────────

const COMPLEMENT_BASIS = 'The staff recommendation follows a stated rubric: a platoon partner is recommended (ACT) when the regular has a platoon problem his ratings and record support, a partner already on the bench is clearly better against the weak hand, and nothing has to be transacted; worth pursuing (EXPLORE) when the partner needs a roster move or something is unsettled, or the club is not pressed; MONITOR when nobody clearly complements him. It is advice, not a decision.';

function complementReport(
  need: MlbNeed, view: ClubView, ports: ResponsePorts, candidates: ResponseCandidate[], plans: Plan[], lead: ResponseCandidate | null
): StaffReport | null {
  const role = need.role;
  const regular = need.platoon;
  const subject = need.subject ? view.members.find((m) => m.playerId === need.subject?.playerId) : undefined;
  if (!role || !regular || !subject || regular.weakSide === null) return null;
  const weak = regular.weakSide === 'L' ? 'left' : 'right';
  const compared = candidates.filter((c) => c.complement);
  const evidence = ports.holderEvidence([subject.playerId, ...compared.map((c) => c.playerId)], role);
  const rows: RoleRow[] = [
    { ...rowFor(subject, 'incumbent', ports, null, null, evidence), underReview: true,
      complement: { weakSide: regular.weakSide, expected: regular.weakSide === 'L' ? regular.vsLeft.expected : regular.vsRight.expected, advantage: null, fits: false } },
    ...compared.map((c): RoleRow => {
      const e = evidence.get(c.playerId);
      const est = e ? workingEstimate(e, false) : null;
      const cr = c.complement!;
      return {
        playerId: c.playerId, name: c.name, age: c.age, relation: 'subject',
        status: c.pathKind === 'role_change' ? 'On the bench' : `${c.pathKind === 'recall' ? 'Recall' : 'Add to 40-man'}, level ${c.level ?? '?'}`,
        composite: e?.ratingsPct ?? null, resultsPct: est?.resultsPct ?? null, estimate: est ? est.value : null, weightOnResults: est?.weightOnResults ?? 0,
        sample: e?.sample ?? 0, sampleUnit: e?.sampleUnit ?? 'PA', reliability: e?.reliability ?? 0, weakestCore: c.roleFit?.evidence.weakestCorePercentile ?? null,
        evidenceStatus: e?.ratingsEvidence ?? 'unknown', performance: c.performance, standing: null, group: c.group, usage: e?.usage ?? [], comparison: null,
        complement: { weakSide: cr.weakSide, expected: cr.weakSide === 'L' ? cr.candidate.vsLeft : cr.candidate.vsRight, advantage: cr.fit.advantage, fits: cr.fit.fits },
      };
    }),
  ];
  const fmt = (n: number | null) => (n === null ? '?' : n.toFixed(3).replace(/^0/, ''));
  const fitting = compared.filter((c) => c.complement!.fit.fits).sort((a, b) => (b.complement!.fit.advantage ?? 0) - (a.complement!.fit.advantage ?? 0));
  const listed = (cs: ResponseCandidate[]) => cs.map((c) => `${c.name} (+${Math.round((c.complement!.fit.advantage ?? 0) * 1000)} points against ${weak}-handers)`).join(', ');
  const ready = fitting.filter((c) => c.group in GROUP_READINESS);
  const held = fitting.filter((c) => !(c.group in GROUP_READINESS));
  const readText = fitting.length === 0
    ? `Nobody internal is clearly better than ${subject.name} against ${weak}-handers (a partner needs at least ${fmt(0.025)} wOBA better there): ${compared.length ? 'the players considered are not enough of an improvement or lack a read against that hand' : 'no internal player was found who can play the position'}.`
    : `${listed(ready.length ? ready : fitting)} ${(ready.length ? ready : fitting).length === 1 ? 'would' : 'would'} clearly complement him against ${weak}-handers.${held.length && ready.length ? ` Held up: ${listed(held)}.` : ''}`;
  const org = ports.organization ?? null;
  const bar = org ? actBar(org) : null;
  const benchLead = !!lead && lead.pathKind === 'role_change';
  const plan = plans[0];
  const strongBasis = regular.basis === 'ratings_and_splits' || regular.basis === 'ratings';
  const shading: ShadeReason[] = [];
  let recommendation: Recommendation;
  if (lead && benchLead && plan?.certainty === 'open' && strongBasis && !bar?.patient) {
    recommendation = {
      stance: 'act', headline: `Recommend the platoon: ${plan.title}.`,
      because: [`${subject.name}'s platoon problem rests on his visible ratings${regular.basis === 'ratings_and_splits' ? ' and his record' : ''}.`, plan.summary, 'It needs no transaction: a partner already on the bench, and Player Rights has nothing to refuse.'],
      toSettle: [], wouldChange: ['The regular\'s ratings against that hand changing, or the partner losing playing time to injury.'], confidence: 'moderate', basis: COMPLEMENT_BASIS, shading,
    };
  } else if (lead && plan) {
    if (bar?.patient && bar.why.patient) shading.push({ ...bar.why.patient, text: 'Neither the window nor the season presses, so a platoon is worth pursuing rather than recommending outright.' });
    recommendation = {
      stance: 'explore', headline: `Worth pursuing: ${plan.title}.`,
      because: [`${subject.name} has a platoon problem (${regular.basis.replace(/_/g, ' ')}).`, plan.summary],
      toSettle: [
        ...(!benchLead ? [`${lead.name} has to be brought in first: ${plan.certaintyNote}`] : []),
        ...(benchLead && !strongBasis ? ['The read rests on his record alone, which says little beyond the league norm: his visible platoon ratings are not fully available.'] : []),
        ...lead.path.unknowns.slice(0, 2),
      ],
      wouldChange: ['Settling the item above would move this to a recommendation.'], confidence: 'low', basis: COMPLEMENT_BASIS, shading,
    };
  } else {
    recommendation = {
      stance: fitting.length ? 'explore' : 'monitor',
      headline: fitting.length ? `A partner would help, but nobody is ready: ${held[0]?.name ?? fitting[0].name} clearly complements ${subject.name} against ${weak}-handers if what holds him up is resolved.` : `Keep watching ${subject.name}'s platoon split: nobody internal clearly complements him against ${weak}-handers.`,
      because: regular.reasons.slice(0, 2), toSettle: fitting.length ? (held[0] ?? fitting[0]).why.slice(0, 2) : [],
      wouldChange: ['A better-suited hitter becoming available, or the regular\'s split changing.'], confidence: 'low', basis: COMPLEMENT_BASIS, shading,
    };
  }
  return {
    recommendation, headline: need.title,
    situation: [`${subject.name} (${subject.age ?? '?'}, ${role.label}) projects ${fmt(regular.weakSide === 'L' ? regular.vsLeft.expected : regular.vsRight.expected)} wOBA against ${weak}-handers and ${fmt(regular.weakSide === 'L' ? regular.vsRight.expected : regular.vsLeft.expected)} against ${weak === 'left' ? 'right' : 'left'}-handers.`, ...regular.reasons],
    read: { verdict: fitting.length ? 'strengthens' : 'comparable', text: readText, caveats: regular.verdict === 'problem' ? ['A platoon partner plays only against the hand he struggles with; the regular keeps the rest.'] : [] },
    rolePicture: { role: role.label, standard: null, rows: displayOrder(rows), basis: BASIS, calibration: STANDING_CALIBRATION },
    pathways: [],
    orderingNote: 'Plans are options, not a ranking of players. The read is expected wOBA against the hand the regular struggles with, shown for each candidate; the decision is yours.',
  };
}

export interface ReportExtras { plans?: Plan[]; lead?: ResponseCandidate | null }

export function buildStaffReport(
  need: MlbNeed, view: ClubView, ports: ResponsePorts, direction: 'fill' | 'clear' | 'role_needed' | 'replace' | 'complement',
  clearing: ClearingPacket | null, candidates: ResponseCandidate[], extras: ReportExtras = {}
): StaffReport | null {
  if (direction === 'complement') return complementReport(need, view, ports, candidates, extras.plans ?? [], extras.lead ?? null);
  if (direction === 'clear') return returnReport(need, view, ports, clearing);
  if (direction === 'fill') return fillReport(need, view, ports, candidates);
  if (direction === 'replace') return replaceReport(need, view, ports, candidates, extras.plans ?? [], extras.lead ?? null);
  return null;
}
