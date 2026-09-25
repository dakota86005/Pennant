/**
 * Major League Operations: the service and API that hand a GM the roster
 * problems in front of them, the realistic responses, and what each would do.
 *
 * It is a consumer. The specialists it asks are named in `mlbEvidence.ts` and
 * `mlbResponses.ts`; this file wires the real ones to the pure builders and
 * exposes read-only routes. It executes nothing and writes nothing. See
 * docs/MLB_OPERATIONS.md.
 */

import { Router } from 'express';
import { db, tableExists } from './db.js';
import { getDataStatus } from './dataStatus.js';
import {
  coverReads, crossRoleSupport, farmConsequence, hitterUsage, holderEvidence, performanceLine, platoonInputs, playableCovers, roleFitEvidence, teamGamesPlayed, topAffiliateTeamId,
} from './mlbEvidence.js';
import { reviewClub, reviewNeedById, reviewNeeds, type ReviewPorts, type RoleGroupReview } from './mlbReview.js';
import { DEFAULT_COVERAGE_FLOORS, detectNeeds, whatIfNeed, type CoverageFloors, type MlbNeed } from './mlbNeeds.js';
import { CONTEXT_PROFILES, type MlbAssignmentContext } from './mlbAssignmentContext.js';
import { buildResponsePacket, type ResponsePacket, type ResponsePorts } from './mlbResponses.js';
import { activeMembers, loadClubView, type ClubView, type RoleRef } from './mlbRoster.js';
import { mlbAssignmentAssessments } from './org.js';
import { openFarmSession, type FarmSession } from './mlbEvidence.js';
import { resolvePhilosophy } from './philosophy.js';
import { deadlineRead } from './posture.js';
import { readContext, type ContextRead, type OrganizationContext } from './staffPreference.js';
import { rightsFor } from './playerContext.js';
import { philosophyForOrg } from './settings.js';
import type { ResultsParams } from './resultsMetrics.js';
import type { BullpenLines } from './bullpenRoles.js';
import { rosterReviewCalibration, type RosterReviewCalibration, type YardstickGroup } from './mlbCalibration.js';
import { majorLeagueId } from './resultsEvidence.js';

export const mlbOperationsRoutes = Router();

/** The organization's philosophy and where its season stands: the two things that lean on advice (D-036). Read, never assumed. */
export function organizationContext(orgId: number): OrganizationContext {
  const philosophy = resolvePhilosophy(philosophyForOrg(orgId));
  let posture: OrganizationContext['posture'] = null;
  try {
    const read = deadlineRead(orgId);
    if (read) posture = { posture: read.posture, odds: read.odds, gamesLeft: read.gamesLeft, deadlinePassed: read.deadlinePassed, headline: read.headline };
  } catch { posture = null; }
  return {
    dimensions: Object.fromEntries(Object.entries(philosophy.dimensions).map(([k, v]) => [k, v.value])) as OrganizationContext['dimensions'],
    posture,
  };
}

/** The review's yardsticks for a club: its major league's fit in force (D-053), else the built-in starting values. */
export function yardsticksFor(orgId: number): RosterReviewCalibration {
  let league: number | null = null;
  try { league = majorLeagueId(orgId); } catch { league = null; }
  return rosterReviewCalibration(league);
}

function realPorts(orgId: number, floors: CoverageFloors = DEFAULT_COVERAGE_FLOORS): ResponsePorts {
  const philosophy = resolvePhilosophy(philosophyForOrg(orgId));
  const status = getDataStatus();
  let farm: FarmSession | null = null;
  // One set of yardsticks per request: every holder read (review, responses, plans, scenarios, report) and every platoon read uses
  // the same results params in force (D-053, cycle 2)
  const yardsticks = yardsticksFor(orgId);
  return {
    floors,
    reviewCalibration: yardsticks.review,
    rights: (ids) => rightsFor(ids, status),
    development: (ids, context) => mlbAssignmentAssessments(orgId, context, ids),
    crossRole: crossRoleSupport,
    roleFit: (id) => roleFitEvidence(id, orgId),
    holderEvidence: (ids, role, opts) => holderEvidence(orgId, ids, role, opts ?? {}, yardsticks.results, yardsticks.bullpen),
    hitterUsage: (ids) => hitterUsage(orgId, ids),
    teamGames: () => teamGamesPlayed(orgId),
    platoon: (ids) => platoonInputs(orgId, ids, yardsticks.results, yardsticks.platoon),
    performance: performanceLine,
    // A failure inside Minor League Operations' evaluator leaves the farm consequence unknown; it never fails the packet.
    // One farm session per request: the organization is read once however many candidates are asked about.
    farm: (id, role, direction, affiliate) => {
      try { return farmConsequence(orgId, id, role, direction, affiliate, (farm ??= openFarmSession(orgId))); } catch { return null; }
    },
    optionAffiliateTeamId: () => topAffiliateTeamId(orgId),
    philosophy: {
      promotionAggressiveness: philosophy.dimensions.promotionAggressiveness.value,
      versatility: philosophy.dimensions.versatility.value,
    },
    organization: organizationContext(orgId),
  };
}

/** The scouting review's evidence, through the same specialists: lenses, usage, splits. */
export function reviewPorts(orgId: number, override?: { results?: ResultsParams; bullpen?: BullpenLines }): ReviewPorts {
  const yardsticks = yardsticksFor(orgId);
  // The refit may measure the standards under the results params and the bullpen lines about to be recorded (what is checked is what
  // is served)
  const results = override?.results ?? yardsticks.results;
  const bullpen = override?.bullpen ?? yardsticks.bullpen;
  return {
    calibration: { standards: yardsticks.standards, review: yardsticks.review },
    bullpen,
    holderEvidence: (ids, role) => holderEvidence(orgId, ids, role, {}, results, bullpen),
    hitterUsage: (ids) => hitterUsage(orgId, ids),
    platoon: (ids) => platoonInputs(orgId, ids, results, yardsticks.platoon),
    teamGames: () => teamGamesPlayed(orgId),
    covers: (ids) => playableCovers(ids),
    coverReads: (ids) => coverReads(orgId, ids),
    asStarter: (ids) => new Map(ids.map((id) => {
      const support = crossRoleSupport(id, ROLE_CHOICES.starting_pitcher);
      const toolsPct = support.supported === 'yes' ? roleFitEvidence(id, orgId, ROLE_CHOICES.starting_pitcher).compositePercentile : null;
      return [id, { supported: support.supported, toolsPct }] as const;
    })),
    organization: organizationContext(orgId),
  };
}

function organizationLabel(orgId: number): string | null {
  if (!tableExists('teams')) return null;
  const row = db.prepare('SELECT name, nickname FROM teams WHERE team_id = ? AND level = 1').get(orgId) as
    | { name: string | null; nickname: string | null } | undefined;
  if (!row) return null;
  return row.name === row.nickname || !row.nickname ? row.name : `${row.name} ${row.nickname}`;
}

export interface MlbOverview {
  organization: { orgId: number; label: string } | null;
  freshness: { level: string; headline: string; action: string | null; log: string };
  roster: {
    active: { count: number | null; limit: number | null };
    fortyMan: { count: number | null; limit: number | null };
    injuredList: number;
  };
  /** Minimum role-coverage floors in force. Floors, not ideal roster targets. */
  coverage: { basis: 'minimum_floor'; source: string; floors: Array<{ role: string; count: number; label: string }> };
  needs: MlbNeed[];
  /** The organization's window and the season, and how they lean on the advice below. Null when nothing is known. */
  context: ContextRead | null;
  /**
   * The scouting review of the pitching groups, most concerning first. A finding is a flag for
   * attention, never a transaction trigger; only strong or moderate cases are also `needs`.
   */
  review: RoleGroupReview[];
  /** Active players a GM can ask "what if he is out?" about. */
  activePlayers: Array<{ playerId: number; name: string; role: string | null; available: boolean }>;
  unknowns: string[];
  /**
   * Where the review's yardsticks come from (D-053): one plain line for the page, the detail for its hover, and per group the fit in
   * force with its record (the same object `GET /api/mlb/calibration/:orgId` serves).
   */
  yardsticks: { line: string; tip: string; groups: YardstickGroup[]; longMan: string };
}

export function mlbOverview(orgId: number, view: ClubView = loadClubView(orgId)): MlbOverview {
  const label = organizationLabel(orgId);
  const ports = reviewPorts(orgId);
  const context = label === null ? null : readContext(ports.organization ?? null);
  const review = label === null ? [] : reviewClub(view, ports);
  const status = getDataStatus();
  const unknowns: string[] = [];
  if (status.freshness.csv.state === 'behind') {
    unknowns.push(`The imported export is behind the save (${status.freshness.headline}), so these needs may already have been resolved in the game. Export the database again.`);
  } else if (status.freshness.csv.state === 'unavailable') {
    unknowns.push('No OOTP export is imported, so nothing here reflects a roster.');
  }
  if (view.counts.active === null) unknowns.push('Some players have no exported active-roster flag, so roster counts and needs are incomplete.');
  if (view.limits.active === null) unknowns.push("The league's active-roster limit is not exported.");
  const unknownRole = activeMembers(view).filter((m) => m.role === null).length;
  if (unknownRole) unknowns.push(`${unknownRole} active player(s) have no established role and are not counted toward any standard.`);
  return {
    organization: label === null ? null : { orgId, label },
    freshness: {
      level: status.freshness.level, headline: status.freshness.headline, action: status.freshness.action,
      log: status.freshness.log.state,
    },
    roster: {
      active: { count: view.counts.active, limit: view.limits.active },
      fortyMan: { count: view.counts.fortyMan, limit: view.limits.fortyMan },
      injuredList: view.members.filter((m) => m.level === 1 && m.onInjuredList === true).length,
    },
    coverage: {
      basis: DEFAULT_COVERAGE_FLOORS.basis,
      source: DEFAULT_COVERAGE_FLOORS.source,
      floors: Object.entries(DEFAULT_COVERAGE_FLOORS.floors).map(([role, f]) => ({ role, count: f!.count, label: f!.label })),
    },
    needs: label === null ? [] : [...detectNeeds(view), ...reviewNeeds(view, review, context)],
    context,
    review,
    activePlayers: activeMembers(view)
      .map((m) => ({ playerId: m.playerId, name: m.name, role: m.role?.label ?? null, available: m.availability.status === 'available' }))
      .sort((a, b) => (a.role ?? '').localeCompare(b.role ?? '') || a.name.localeCompare(b.name)),
    unknowns,
    yardsticks: yardsticksOf(orgId),
  };
}

/** Resolve a need by id from the current state (observed needs) or a what-if id. */
export function resolveNeed(
  view: ClubView, needId: string, assumedDays: number | null = null, floors: CoverageFloors = DEFAULT_COVERAGE_FLOORS,
  ports?: ReviewPorts
): MlbNeed | null {
  const whatIf = /^mlb:what_if:(\d+)$/.exec(needId);
  if (whatIf) return whatIfNeed(view, Number(whatIf[1]), floors, assumedDays);
  if (/^mlb:(role_holder_review|platoon_complement|bench_coverage):/.test(needId)) return ports ? reviewNeedById(view, needId, ports) : null;
  return detectNeeds(view, 'observed', floors).find((n) => n.id === needId) ?? null;
}

const ROLE_CHOICES: Record<string, RoleRef> = {
  starting_pitcher: { kind: 'starting_pitcher', label: 'starting pitcher', position: 1 },
  relief_pitcher: { kind: 'relief_pitcher', label: 'relief pitcher', position: 1 },
  catcher: { kind: 'catcher', label: 'catcher', position: 2 },
};

export interface ResponseOptions {
  /** For a need that names no role. */
  role?: string;
  /** The kind of MLB assignment to have Player Development judge, instead of the one the need's horizon implies. */
  context?: string;
  /** For a what-if: how many days the GM assumes the player is out. */
  days?: number | null;
  floors?: CoverageFloors;
}

export function mlbResponses(orgId: number, needId: string, options: ResponseOptions = {}, view: ClubView = loadClubView(orgId)): ResponsePacket | null {
  const floors = options.floors ?? DEFAULT_COVERAGE_FLOORS;
  const ports = realPorts(orgId, floors);
  const need = resolveNeed(view, needId, options.days ?? null, floors, reviewPorts(orgId));
  if (!need) return null;
  const chosen = need.role === null && options.role ? ROLE_CHOICES[options.role] : undefined;
  const effective: MlbNeed = chosen ? { ...need, role: chosen } : need;
  const context = options.context && options.context in CONTEXT_PROFILES ? (options.context as MlbAssignmentContext) : undefined;
  return buildResponsePacket(effective, view, ports, context);
}

function orgId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

mlbOperationsRoutes.get('/mlb-operations/:orgId', (req, res) => {
  const id = orgId(req.params.orgId);
  if (id === null) return res.status(400).json({ error: 'A valid organization is required.' });
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  return res.json(mlbOverview(id));
});

/**
 * Where the roster review's yardsticks come from for a club (D-053): per group (the line for each job, how players age, how much the
 * glove counts) the fit in force with its window, its checks on clubs and seasons it did not see, when it was refitted, how much is
 * still the starting values and the verdict; the last attempt's reason when it was not adopted. Also attached to the overview.
 */
function calibrationRoute(req: { params: { orgId: string } }, res: import('express').Response) {
  const id = orgId(req.params.orgId);
  if (id === null) return res.status(400).json({ error: 'A valid organization is required.' });
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  const y = yardsticksFor(id);
  return res.json({ leagueId: y.leagueId, line: y.line, tip: y.tip, groups: y.groups });
}
mlbOperationsRoutes.get('/mlb-operations/:orgId/calibration', calibrationRoute);
mlbOperationsRoutes.get('/mlb/calibration/:orgId', calibrationRoute);

/** The responses to one need. `needId` is an observed need's id or `mlb:what_if:<playerId>`. */
mlbOperationsRoutes.get('/mlb-operations/:orgId/responses', (req, res) => {
  const id = orgId(req.params.orgId);
  if (id === null) return res.status(400).json({ error: 'A valid organization is required.' });
  const needId = typeof req.query.need === 'string' ? req.query.need : '';
  const role = typeof req.query.role === 'string' ? req.query.role : undefined;
  const context = typeof req.query.context === 'string' ? req.query.context : undefined;
  const days = typeof req.query.days === 'string' && Number.isFinite(Number(req.query.days)) ? Math.floor(Number(req.query.days)) : null;
  const packet = mlbResponses(id, needId, { role, context, days });
  if (!packet) {
    return res.status(404).json({
      error: 'This need is not open in the current export. It may have been resolved, or the export may have changed.',
    });
  }
  return res.json(packet);
});


/** The yardsticks' account for a club, for the page and the API. */
export function yardsticksOf(orgId: number): MlbOverview['yardsticks'] {
  const y = yardsticksFor(orgId);
  return { line: y.line, tip: y.tip, groups: y.groups, longMan: y.longMan };
}
