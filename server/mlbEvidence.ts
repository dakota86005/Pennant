/**
 * The database-facing adapters MLB Operations hands to its response builder.
 *
 * Each one asks the specialist that owns the answer:
 *
 *   role fit at the MLB level  -> Player Development (`evaluateDestinationFit`) and
 *                                 the scouted-evidence adapter (what is visible)
 *   cross-role support         -> Player Development's pitcher role assessment;
 *                                 visible fielding grades through the adapter
 *   farm consequence           -> Minor League Operations' roster-health evaluator,
 *                                 run as a read-only scenario
 *   rights                     -> `rightsFor` (Player State + chronology + league rules)
 *   development authorization  -> `mlbDiscussionAssessments`
 *
 * Nothing here reads a rating column, `players_value`, an option counter, a
 * 40-man flag, or the transaction log. Objective season statistics are read
 * directly: they are facts, not judgments.
 */

import { db, tableColumns, tableExists } from './db.js';
import { evaluateDestinationFit, evaluatePitcherDevelopmentalRole, type DestinationFitClassification } from './destinationFit.js';
import { computeMinorLeagueRosterHealth, PLAYABLE_RATING, type AffiliateRosterHealth } from './minorLeagueRoster.js';
import { loadScoutedAbilities, scoutedGloves, summarizeEvidence } from './scoutedEvidence.js';
import type { RoleRef } from './mlbRoster.js';

export interface RoleFitEvidence {
  /** Player Development's destination-fit classification at the MLB club; null when it cannot be computed. */
  classification: DestinationFitClassification | null;
  compositePercentile: number | null;
  weakestCorePercentile: number | null;
  /** Role tools with no organization-visible rating or comparison population. */
  unassessed: string[];
  comparisonPopulation: number | null;
  /** Whether the visible tool ratings are complete for this player. */
  evidenceStatus: 'complete' | 'partial' | 'unknown';
  notes: string[];
}

export function roleFitEvidence(playerId: number, mlbTeamId: number): RoleFitEvidence {
  const ability = loadScoutedAbilities([playerId]).for(playerId);
  const summary = summarizeEvidence(ability);
  const fit = evaluateDestinationFit(playerId, mlbTeamId);
  if (!fit) {
    return {
      classification: null, compositePercentile: null, weakestCorePercentile: null, unassessed: [],
      comparisonPopulation: null, evidenceStatus: summary.status,
      notes: ['Player Development could not compute a destination fit at the MLB level.'],
    };
  }
  return {
    classification: fit.classification,
    compositePercentile: fit.compositePercentile,
    weakestCorePercentile: fit.weakestCorePercentile,
    unassessed: fit.unassessedComponents.map((c) => c.label),
    comparisonPopulation: fit.populationMinimum,
    evidenceStatus: summary.status,
    notes: fit.notes,
  };
}

export interface CrossRoleSupport {
  /**
   * Whether visible evidence supports using the player in a different role. `no` covers
   * "nothing visible suggests it" and is not listed; `unknown` is a real gap (e.g. stamina
   * withheld) and is shown as one.
   */
  supported: 'yes' | 'no' | 'unknown';
  evidence: string[];
}

/** Whether an active player of another role could take `role`, on visible evidence only. */
export function crossRoleSupport(playerId: number, role: RoleRef): CrossRoleSupport {
  if (role.kind === 'starting_pitcher') {
    const assessment = evaluatePitcherDevelopmentalRole(playerId);
    if (!assessment) return { supported: 'unknown', evidence: ['No pitcher role assessment is available.'] };
    if (assessment.structureEvidence === 'unknown') {
      return { supported: 'unknown', evidence: ['Stamina is not visible, so Player Development cannot say whether he can start.'] };
    }
    return assessment.developmentalRole === 'starter'
      ? { supported: 'yes', evidence: assessment.reasons }
      : { supported: 'no', evidence: assessment.reasons };
  }
  if (role.kind === 'relief_pitcher') {
    // Any pitcher can be used in relief; Player Development assesses starting, not this. The cost is
    // the rotation depth it removes, which the consequence stage reports.
    return { supported: 'yes', evidence: ['Any pitcher can be used in relief; Player Development does not assess it.'] };
  }
  const profile = scoutedGloves(playerId);
  const rating = profile?.positions.find((p) => p.position === role.position);
  if (!rating || rating.current <= 0) {
    // Nothing visible suggests he can play there: not a candidate, and not an unknown worth the GM's attention.
    return { supported: 'no', evidence: [`No visible fielding grade at ${role.label}.`] };
  }
  return rating.current >= PLAYABLE_RATING
    ? { supported: 'yes', evidence: [`Visible current grade ${rating.current} at ${role.label}, experience ${rating.experience}.`] }
    : { supported: 'no', evidence: [`Visible current grade ${rating.current} at ${role.label} is below the playable line of ${PLAYABLE_RATING}.`] };
}

export interface PerformanceLine {
  kind: 'batting' | 'pitching';
  year: number;
  level: number;
  /** PA for hitters, IP for pitchers. */
  sample: number;
  sampleUnit: 'PA' | 'IP';
  lines: Array<{ label: string; value: string }>;
}

const fixed = (n: number | null, digits: number, strip = false): string => {
  if (n === null || !Number.isFinite(n)) return '—';
  const text = n.toFixed(digits);
  return strip ? text.replace(/^0(?=\.)/, '') : text;
};

/** The player's most recent season line at the level he is at — objective, context-free. */
export function performanceLine(playerId: number, level: number | null, isPitcher: boolean): PerformanceLine | null {
  if (level === null) return null;
  if (isPitcher) {
    const need = ['player_id', 'year', 'level_id', 'split_id', 'outs', 'er', 'k', 'bb', 'gs', 'g'];
    if (!tableExists('players_career_pitching_stats') || !need.every((c) => tableColumns('players_career_pitching_stats').includes(c))) return null;
    const row = db.prepare(`
      SELECT year, SUM(outs) AS outs, SUM(er) AS er, SUM(k) AS k, SUM(bb) AS bb, SUM(gs) AS gs, SUM(g) AS g
      FROM players_career_pitching_stats
      WHERE player_id = ? AND split_id = 1 AND level_id = ?
        AND year = (SELECT MAX(year) FROM players_career_pitching_stats WHERE player_id = ? AND split_id = 1 AND level_id = ?)
      GROUP BY year
    `).get(playerId, level, playerId, level) as Record<string, number> | undefined;
    if (!row || !(row.outs > 0)) return null;
    const ip = row.outs / 3;
    return {
      kind: 'pitching', year: row.year, level, sample: Math.round(ip * 10) / 10, sampleUnit: 'IP',
      lines: [
        { label: 'ERA', value: fixed((row.er / ip) * 9, 2) },
        { label: 'K', value: String(row.k) }, { label: 'BB', value: String(row.bb) },
        { label: 'G/GS', value: `${row.g}/${row.gs}` },
      ],
    };
  }
  const need = ['player_id', 'year', 'level_id', 'split_id', 'pa', 'ab', 'h', 'd', 't', 'hr', 'bb', 'hp', 'sf'];
  if (!tableExists('players_career_batting_stats') || !need.every((c) => tableColumns('players_career_batting_stats').includes(c))) return null;
  const row = db.prepare(`
    SELECT year, SUM(pa) AS pa, SUM(ab) AS ab, SUM(h) AS h, SUM(d) AS d, SUM(t) AS t, SUM(hr) AS hr,
           SUM(bb) AS bb, SUM(hp) AS hp, SUM(sf) AS sf
    FROM players_career_batting_stats
    WHERE player_id = ? AND split_id = 1 AND level_id = ?
      AND year = (SELECT MAX(year) FROM players_career_batting_stats WHERE player_id = ? AND split_id = 1 AND level_id = ?)
    GROUP BY year
  `).get(playerId, level, playerId, level) as Record<string, number> | undefined;
  if (!row || !(row.pa > 0)) return null;
  const tb = row.h + row.d + 2 * row.t + 3 * row.hr;
  const obpDen = row.ab + row.bb + row.hp + row.sf;
  return {
    kind: 'batting', year: row.year, level, sample: row.pa, sampleUnit: 'PA',
    lines: [
      { label: 'AVG', value: fixed(row.ab > 0 ? row.h / row.ab : null, 3, true) },
      { label: 'OBP', value: fixed(obpDen > 0 ? (row.h + row.bb + row.hp) / obpDen : null, 3, true) },
      { label: 'SLG', value: fixed(row.ab > 0 ? tb / row.ab : null, 3, true) },
      { label: 'HR', value: String(row.hr) },
    ],
  };
}

export interface FarmChange {
  label: string;
  before: string;
  after: string;
}

export interface FarmConsequence {
  direction: 'leaves' | 'joins';
  affiliate: { teamId: number; label: string; level: number; levelName: string };
  overall: { before: string; after: string };
  /** Only what changed, plus the role-specific line the move touches. */
  changes: FarmChange[];
  issuesAfter: string[];
}

const healthLine = (h: AffiliateRosterHealth, role: RoleRef | null): FarmChange[] => {
  const lines: FarmChange[] = [];
  const push = (label: string, value: string) => lines.push({ label, before: value, after: value });
  if (!role) return lines;
  if (role.kind === 'starting_pitcher') push('Rotation', h.pitching.rotationStatus);
  else if (role.kind === 'relief_pitcher') push('Bullpen', h.pitching.bullpenStatus);
  else {
    push('Position players', h.positionPlayers.bodyCountStatus);
    const code = ({ 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF' } as Record<number, string>)[role.position];
    const coverage = code ? h.positionPlayers.coverage.find((c) => c.position === code) : undefined;
    if (coverage) push(`${code} coverage`, coverage.status);
  }
  return lines;
};

/**
 * What one affiliate looks like if a player leaves it (a recall) or joins it (an
 * option), by Minor League Operations' own roster-health standards, read-only.
 * Reports the change; it does not choose or solve a replacement.
 */
export function farmConsequence(
  orgId: number, playerId: number, role: RoleRef | null, direction: 'leaves' | 'joins', affiliateTeamId: number | null
): FarmConsequence | null {
  if (affiliateTeamId === null) return null;
  const only = [affiliateTeamId];
  const before = computeMinorLeagueRosterHealth(orgId, { onlyTeamIds: only })[0];
  if (!before) return null;
  const after = computeMinorLeagueRosterHealth(orgId, {
    onlyTeamIds: only,
    ...(direction === 'leaves' ? { removePlayerIds: [playerId] } : { addPlayers: [{ playerId, teamId: affiliateTeamId }] }),
  })[0];
  if (!after) return null;
  const changes: FarmChange[] = [];
  const beforeLines = healthLine(before, role);
  const afterLines = healthLine(after, role);
  beforeLines.forEach((b, i) => changes.push({ label: b.label, before: b.before, after: afterLines[i]?.after ?? b.after }));
  const bodies = (h: AffiliateRosterHealth) => `${h.roster.total} players (${h.roster.pitchers} P)`;
  changes.push({ label: 'Active roster', before: bodies(before), after: bodies(after) });
  return {
    direction,
    affiliate: { teamId: before.teamId, label: before.label, level: before.level, levelName: before.levelName },
    overall: { before: before.overall, after: after.overall },
    changes,
    issuesAfter: after.issues,
  };
}

/** The organization's highest minor-league affiliate (Triple-A where it exists), where an optioned player goes. */
export function topAffiliateTeamId(orgId: number): number | null {
  const row = db.prepare(`
    WITH RECURSIVE org AS (
      SELECT team_id, level FROM teams WHERE team_id = ?
      UNION ALL
      SELECT t.team_id, t.level FROM teams t JOIN org o ON t.parent_team_id = o.team_id
    )
    SELECT team_id FROM org WHERE team_id != ? ORDER BY level ASC, team_id ASC LIMIT 1
  `).get(orgId, orgId) as { team_id: number } | undefined;
  return row?.team_id ?? null;
}
