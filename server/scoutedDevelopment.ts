/**
 * Every minor leaguer in the organization with what the organization's own scouting has observed
 * of him over time: the Player Development pages' roster.
 *
 * "Player Development" and "Scouted Development" list every man on an affiliate — not only those
 * with a qualifying line, which is what `/api/prospects` carries — with his organization-visible
 * current and potential grades, Player Development's protection tier, how the persisted scouting
 * history says he has moved, and how that compares with similarly situated minor leaguers. Both
 * pages used to read this off the old retention payload, which no longer exists (the retention
 * decision is Minor League Operations', `farmRetention.ts`); the history evidence was always
 * `history.ts`'s and is served from here directly.
 *
 * Nothing here is a judgment about where he should be or whether he should stay: ratings come only
 * through the adapter (D-017), roster facts only through Player State (D-020), and an absent grade
 * stays absent.
 */

import { Router } from 'express';
import { db, tableExists } from './db.js';
import { evaluatePitcherDevelopmentalRole } from './destinationFit.js';
import { evaluateDevelopmentProtection } from './developmentFit.js';
import { POSITION_CODES } from './gloves.js';
import {
  developmentTrendByPlayerForOrg,
  peerDevelopmentTrendByPlayerForOrg,
  type PeerDevelopmentTrend,
  type PlayerDevelopmentTrend,
} from './history.js';
import { playerStates } from './playerState.js';
import { loadScoutedAbilities } from './scoutedEvidence.js';
import { LEVEL_NAMES } from './valuation.js';

export const scoutedDevelopmentRoutes = Router();

export interface ScoutedDevelopmentPlayer {
  playerId: number;
  name: string;
  age: number;
  kind: 'hitter' | 'pitcher';
  teamId: number;
  team: string;
  level: number;
  levelName: string;
  /** Organization-visible composite grades; null when the ratings behind them are not visible. */
  current: number | null;
  potential: number | null;
  protection: { tier: string | null; score: number | null };
  /** Roster facts, from Player State as exported. */
  transaction: { active: boolean; onInjuredList: boolean | null };
  role: { listedPosition: string; developmentalPitcherRole: 'starter' | 'reliever' | null };
  evidence: {
    developmentHistory: Pick<PlayerDevelopmentTrend, 'status' | 'snapshotCount' | 'observationDays' | 'currentDelta' | 'potentialDelta' | 'reasons'>;
    peerDevelopment: Pick<PeerDevelopmentTrend, 'pace' | 'percentile' | 'cohortSize' | 'reasons' | 'cohort'>;
  };
}

export interface ScoutedDevelopmentResponse {
  orgId: number;
  players: ScoutedDevelopmentPlayer[];
}

interface Row {
  player_id: number;
  first_name: string;
  last_name: string;
  age: number;
  position: number;
  team_id: number;
  team: string;
  level: number;
  active: number;
}

const NO_HISTORY: ScoutedDevelopmentPlayer['evidence']['developmentHistory'] = {
  status: 'insufficient',
  snapshotCount: 0,
  observationDays: null,
  currentDelta: null,
  potentialDelta: null,
  reasons: ['No persistent scouting-history snapshots are available for this player.'],
};

const NO_PEERS: ScoutedDevelopmentPlayer['evidence']['peerDevelopment'] = {
  pace: 'insufficient',
  percentile: null,
  cohortSize: 0,
  cohort: null,
  reasons: ['Peer evidence is insufficient because no peer-adjusted scouting-development baseline is available for this player.'],
};

/** Every player on a minor-league affiliate's roster (the full organizational list, active or not). */
function organizationMinorLeaguers(orgId: number): Row[] {
  if (!tableExists('teams') || !tableExists('players') || !tableExists('team_roster')) return [];
  return db
    .prepare(
      `WITH RECURSIVE org AS (
         SELECT team_id, name, nickname, level FROM teams WHERE team_id = ?
         UNION ALL
         SELECT t.team_id, t.name, t.nickname, t.level FROM teams t JOIN org o ON t.parent_team_id = o.team_id
       )
       SELECT p.player_id, p.first_name, p.last_name, p.age, p.position, p.team_id,
              CASE WHEN o.name = o.nickname THEN o.name ELSE o.name || ' ' || o.nickname END AS team,
              o.level,
              EXISTS (SELECT 1 FROM team_roster a WHERE a.team_id = o.team_id AND a.player_id = p.player_id AND a.list_id = 2) AS active
       FROM org o
       JOIN players p ON p.team_id = o.team_id AND p.retired = 0
       WHERE o.level > 1
         AND EXISTS (SELECT 1 FROM team_roster r WHERE r.team_id = o.team_id AND r.player_id = p.player_id)
       ORDER BY o.level, p.last_name, p.first_name`
    )
    .all(orgId) as Row[];
}

export function computeScoutedDevelopment(orgId: number): ScoutedDevelopmentResponse {
  const rows = organizationMinorLeaguers(orgId);
  const ids = rows.map((r) => r.player_id);
  const abilities = loadScoutedAbilities(ids);
  const states = playerStates(ids);
  const history = developmentTrendByPlayerForOrg(orgId);
  const peers = peerDevelopmentTrendByPlayerForOrg(orgId);

  return {
    orgId,
    players: rows.map((r) => {
      const ability = abilities.for(r.player_id);
      const protection = evaluateDevelopmentProtection({ age: Number(r.age), ability });
      const kind: 'hitter' | 'pitcher' = Number(r.position) === 1 ? 'pitcher' : 'hitter';
      const state = states.get(r.player_id);
      const trend = history.get(r.player_id);
      const peer = peers.get(r.player_id);
      return {
        playerId: r.player_id,
        name: `${r.first_name} ${r.last_name}`,
        age: Number(r.age),
        kind,
        teamId: r.team_id,
        team: r.team,
        level: r.level,
        levelName: LEVEL_NAMES[r.level] ?? `L${r.level}`,
        current: ability.current,
        potential: ability.potential,
        protection: { tier: protection.tier, score: protection.score },
        transaction: {
          active: Number(r.active) === 1,
          onInjuredList: state ? state.injuredList.onIl.value === true || state.injuredList.onIl60.value === true : null,
        },
        role: {
          listedPosition: POSITION_CODES[Number(r.position) - 1] ?? '—',
          developmentalPitcherRole: kind === 'pitcher' ? (evaluatePitcherDevelopmentalRole(r.player_id)?.developmentalRole ?? null) : null,
        },
        evidence: {
          developmentHistory: trend
            ? {
                status: trend.status,
                snapshotCount: trend.snapshotCount,
                observationDays: trend.observationDays,
                currentDelta: trend.currentDelta,
                potentialDelta: trend.potentialDelta,
                reasons: trend.reasons,
              }
            : NO_HISTORY,
          peerDevelopment: peer
            ? { pace: peer.pace, percentile: peer.percentile, cohortSize: peer.cohortSize, cohort: peer.cohort, reasons: peer.reasons }
            : NO_PEERS,
        },
      };
    }),
  };
}

scoutedDevelopmentRoutes.get('/scouted-development/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid organization id' });
  if (!tableExists('players')) return res.status(400).json({ error: 'No data imported yet' });
  res.json(computeScoutedDevelopment(orgId));
});
