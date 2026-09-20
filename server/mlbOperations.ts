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
  crossRoleSupport, farmConsequence, performanceLine, roleFitEvidence, topAffiliateTeamId,
} from './mlbEvidence.js';
import { detectNeeds, ROLE_STANDARDS, whatIfNeed, type MlbNeed } from './mlbNeeds.js';
import { buildResponsePacket, type ResponsePacket, type ResponsePorts } from './mlbResponses.js';
import { activeMembers, loadClubView, type ClubView, type RoleRef } from './mlbRoster.js';
import { mlbDiscussionAssessments, type MlbDiscussionAssessment } from './org.js';
import { resolvePhilosophy } from './philosophy.js';
import { rightsFor } from './playerContext.js';
import { philosophyForOrg } from './settings.js';

export const mlbOperationsRoutes = Router();

function realPorts(orgId: number): ResponsePorts {
  const philosophy = resolvePhilosophy(philosophyForOrg(orgId));
  let assessments: Map<number, MlbDiscussionAssessment> | null = null;
  const status = getDataStatus();
  return {
    rights: (ids) => rightsFor(ids, status),
    development: (id) => (assessments ??= mlbDiscussionAssessments(orgId)).get(id) ?? null,
    crossRole: crossRoleSupport,
    roleFit: (id) => roleFitEvidence(id, orgId),
    performance: performanceLine,
    // A failure inside Minor League Operations' evaluator leaves the farm consequence unknown; it never fails the packet.
    farm: (id, role, direction, affiliate) => {
      try { return farmConsequence(orgId, id, role, direction, affiliate); } catch { return null; }
    },
    optionAffiliateTeamId: () => topAffiliateTeamId(orgId),
    philosophy: {
      promotionAggressiveness: philosophy.dimensions.promotionAggressiveness.value,
      versatility: philosophy.dimensions.versatility.value,
    },
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
  standards: Array<{ role: string; count: number; label: string }>;
  needs: MlbNeed[];
  /** Active players a GM can ask "what if he is out?" about. */
  activePlayers: Array<{ playerId: number; name: string; role: string | null; available: boolean }>;
  unknowns: string[];
}

export function mlbOverview(orgId: number, view: ClubView = loadClubView(orgId)): MlbOverview {
  const label = organizationLabel(orgId);
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
    standards: Object.entries(ROLE_STANDARDS).map(([role, s]) => ({ role, count: s!.count, label: s!.label })),
    needs: label === null ? [] : detectNeeds(view),
    activePlayers: activeMembers(view)
      .map((m) => ({ playerId: m.playerId, name: m.name, role: m.role?.label ?? null, available: m.availability.status === 'available' }))
      .sort((a, b) => (a.role ?? '').localeCompare(b.role ?? '') || a.name.localeCompare(b.name)),
    unknowns,
  };
}

/** Resolve a need by id from the current state (observed needs) or a what-if id. */
export function resolveNeed(view: ClubView, needId: string): MlbNeed | null {
  const whatIf = /^mlb:what_if:(\d+)$/.exec(needId);
  if (whatIf) return whatIfNeed(view, Number(whatIf[1]));
  return detectNeeds(view).find((n) => n.id === needId) ?? null;
}

const ROLE_CHOICES: Record<string, RoleRef> = {
  starting_pitcher: { kind: 'starting_pitcher', label: 'starting pitcher', position: 1 },
  relief_pitcher: { kind: 'relief_pitcher', label: 'relief pitcher', position: 1 },
  catcher: { kind: 'catcher', label: 'catcher', position: 2 },
};

export function mlbResponses(orgId: number, needId: string, roleOverride?: string, view: ClubView = loadClubView(orgId)): ResponsePacket | null {
  const need = resolveNeed(view, needId);
  if (!need) return null;
  const chosen = need.role === null && roleOverride ? ROLE_CHOICES[roleOverride] : undefined;
  const effective: MlbNeed = chosen ? { ...need, role: chosen } : need;
  return buildResponsePacket(effective, view, realPorts(orgId));
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

/** The responses to one need. `needId` is an observed need's id or `mlb:what_if:<playerId>`. */
mlbOperationsRoutes.get('/mlb-operations/:orgId/responses', (req, res) => {
  const id = orgId(req.params.orgId);
  if (id === null) return res.status(400).json({ error: 'A valid organization is required.' });
  const needId = typeof req.query.need === 'string' ? req.query.need : '';
  const role = typeof req.query.role === 'string' ? req.query.role : undefined;
  const packet = mlbResponses(id, needId, role);
  if (!packet) {
    return res.status(404).json({
      error: 'This need is not open in the current export. It may have been resolved, or the export may have changed.',
    });
  }
  return res.json(packet);
});

