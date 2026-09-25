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
import { PLAYABLE_RATING } from './minorLeagueRoster.js';
import { affiliateOperationalUnder, openFarmSession, type FarmSession } from './farmOperations.js';
import { farmArrivalFor, farmConsequenceFor, type FarmArrival, type FarmConsequenceV2 } from './farmConsequence.js';
/*
 * The one door between the modules. MLB Operations opens a farm session for a request and hands it to
 * `farmConsequence`; it never imports a farm module itself (D-045, enforced by the boundary tests).
 */
export { openFarmSession, type FarmSession } from './farmOperations.js';
import {
  loadScoutedAbilities, loadScoutedHitterProfiles, scoutedFieldingPopulation, scoutedGloves, scoutedHitterPopulation, summarizeEvidence,
  type ScoutedHitterProfile,
} from './scoutedEvidence.js';
import {
  battingHistory, currentSeason, fieldingUsage, handedness, leaguePlatoon, loadDefenseResults, loadHitterResults, loadPitcherResults, majorLeagueId, platoonSplits,
} from './resultsEvidence.js';
import { blendStabilization, percentileAmong, type ResultsParams } from './resultsMetrics.js';
import { describeBat, expectedRunningRaw, expectedWobaRaw, ratingPlatoon, toolContributions } from './toolsModel.js';
import { roleOf as bullpenRoleOf, type BullpenLines } from './bullpenRoles.js';
import { coverQuality, type CoverRead } from './benchReview.js';
import { seasonEnvironments } from './resultsEvidence.js';
import type { HitterUsageInput } from './lineupPicture.js';
import type { PlatoonInput, PlatoonParams } from './platoon.js';
import type { LensEvidence } from './roleReview.js';
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

export function roleFitEvidence(playerId: number, mlbTeamId: number, asRole?: RoleRef): RoleFitEvidence {
  const ability = loadScoutedAbilities([playerId]).for(playerId);
  const summary = summarizeEvidence(ability);
  const pitching = asRole?.kind === 'starting_pitcher' ? 'starter' : asRole?.kind === 'relief_pitcher' ? 'reliever' : undefined;
  const fit = evaluateDestinationFit(playerId, mlbTeamId, pitching);
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
  /**
   * Minor League Operations' own operational reading of the club before and after: can it field a
   * team and cover a schedule? The same findings-derived status the farm workspace shows, so the two
   * modules describe one farm. (The first version read a role-code status here and called a club
   * thin while the workspace, counting the men taking the starts, called it able.)
   */
  overall: { before: string; after: string };
  /** Only what the move touches: the job's count before and after, and the active roster. */
  changes: FarmChange[];
  /** The shortages the club would carry afterwards, in the workspace's words. */
  issuesAfter: string[];
  /**
   * How Minor League Operations treats players it cannot count as ordinary members
   * (a rehab assignee is excluded; one nothing explains is counted but named). A
   * plain-words note where that bears on the player being moved.
   */
  rosterNotes: string[];

  /**
   * What Minor League Operations says follows, when a player LEAVES an affiliate: the job he
   * vacates, whether the club can absorb it, who could fill it, the chain of moves that follows and
   * where it stops, and any hole it leaves open.
   *
   * Minor League Operations OWNS this calculation; MLB Operations displays it and never reconstructs
   * it (the reason the old branch's `minorLeagueCascadePlanner` was deferred rather than adopted,
   * MLB_OPERATIONS.md §2.1 item 12). An unresolved farm consequence is information and never makes a
   * major-league transaction illegal: what is possible is Player Rights', and nothing here touches
   * it. Null for the `joins` direction, where nothing is vacated.
   */
  farm: FarmConsequenceV2 | null;

  /**
   * What follows when a player JOINS an affiliate (an option): the job he takes up there, who already
   * holds it and whose developmental work he would push aside. Null for the `leaves` direction.
   */
  arrival: FarmArrival | null;
}

/** A pitcher's job or a hitter's position, as the farm names it. */
const jobNameOf = (role: RoleRef | null): string | null => {
  if (!role) return null;
  if (role.kind === 'starting_pitcher') return 'the rotation';
  if (role.kind === 'relief_pitcher') return 'the bullpen';
  return ({ 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF' } as Record<number, string>)[role.position] ?? null;
};

/** The count the move touches, in the operational reading's own terms. */
function jobLine(op: NonNullable<ReturnType<typeof affiliateOperationalUnder>>, job: string | null): { label: string; value: string } | null {
  if (!job) return null;
  if (job === 'the rotation') return { label: 'Rotation', value: `${op.rotationClaimants} of ${op.pitching.rotationSpots} taking starts` };
  if (job === 'the bullpen') return { label: 'Bullpen', value: `${op.pitching.relievers} relief arms` };
  const c = op.coverage.find((x) => x.position === job);
  return c ? { label: `${job} cover`, value: `${c.graded} graded${c.listedOnly > 0 ? `, ${c.listedOnly} by label only` : ''}` } : null;
}

/**
 * What one affiliate looks like if a player leaves it (a recall) or joins it (an
 * option), by Minor League Operations' own standards, read-only. Reports the change
 * and carries the farm's own answer; it does not choose or solve a replacement.
 *
 * A session, when the caller has one, is the organization read once for the whole request
 * (`openFarmSession`); without one the farm is read for this call alone.
 */
export function farmConsequence(
  orgId: number, playerId: number, role: RoleRef | null, direction: 'leaves' | 'joins', affiliateTeamId: number | null,
  session: FarmSession = openFarmSession(orgId)
): FarmConsequence | null {
  if (affiliateTeamId === null) return null;
  const before = affiliateOperationalUnder(session, affiliateTeamId);
  if (!before) return null;
  const scenario = direction === 'leaves' ? { removePlayerIds: [playerId] } : { addPlayers: [{ playerId, teamId: affiliateTeamId }] };
  const after = affiliateOperationalUnder(session, affiliateTeamId, scenario);
  if (!after) return null;
  const health = session.health().find((h) => h.teamId === affiliateTeamId);
  if (!health) return null;

  const job = jobNameOf(role);
  const changes: FarmChange[] = [];
  const line = jobLine(before, job);
  const lineAfter = jobLine(after, job);
  if (line && lineAfter) changes.push({ label: line.label, before: line.value, after: lineAfter.value });
  const bodies = (h: { roster: { total: number; pitchers: number } }) => `${h.roster.total} players (${h.roster.pitchers} P)`;
  changes.push({ label: 'Active roster', before: bodies(before), after: bodies(after) });

  const rosterNotes: string[] = [];
  const isRehab = health.rosterTreatment.rehab.some((p) => p.playerId === playerId);
  const ambiguous = health.rosterTreatment.ambiguous.find((p) => p.playerId === playerId);
  if (direction === 'leaves' && isRehab) {
    rosterNotes.push('He is on a rehab assignment, so this club does not count him in its roster health; his return changes nothing here.');
  } else if (direction === 'leaves' && ambiguous) {
    rosterNotes.push('Nothing establishes whether he is on a rehab assignment or was optioned. He is counted here; if he is on rehab this overstates what his leaving costs.');
  }
  const others = health.rosterTreatment.ambiguous.filter((p) => p.playerId !== playerId);
  if (others.length) {
    rosterNotes.push(`${others.length} other player(s) on this club (${others.slice(0, 3).map((p) => p.name).join(', ')}${others.length > 3 ? ', …' : ''}) may be on rehab; they are counted, so its depth may be overstated.`);
  }
  if (health.rosterTreatment.injured.length) {
    rosterNotes.push(`${health.rosterTreatment.injured.length} injured player(s) on this club (${health.rosterTreatment.injured.slice(0, 3).map((p) => p.name).join(', ')}${health.rosterTreatment.injured.length > 3 ? ', …' : ''}) are not counted as cover.`);
  }

  const meta = session.assembled().metas.find((m) => m.teamId === affiliateTeamId);
  return {
    direction,
    affiliate: {
      teamId: affiliateTeamId,
      label: meta?.label ?? health.label,
      level: meta?.level ?? health.level,
      levelName: meta?.levelName ?? health.levelName,
    },
    overall: { before: before.status, after: after.status },
    changes,
    issuesAfter: after.findings.map((f) => f.headline),
    rosterNotes,
    /* Asked of Minor League Operations, which owns both answers (D-045). */
    farm: direction === 'leaves' ? farmConsequenceFor(orgId, playerId, session) : null,
    arrival: direction === 'joins' ? farmArrivalFor(orgId, playerId, affiliateTeamId, session) : null,
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

/**
 * Both lenses for a set of pitchers: the visible tools against MLB peers (Player
 * Development's destination fit) and what they have done (league-relative,
 * recency-weighted results with the sample behind them). A pitcher with no rows
 * has no results lens, which is different from a bad one.
 */
export function holderEvidence(orgId: number, playerIds: number[], role: RoleRef, opts: { ignoreResults?: boolean }, params: ResultsParams, bullpen: BullpenLines): Map<number, LensEvidence> {
  const out = new Map<number, LensEvidence>();
  if (playerIds.length === 0) return out;
  const pitcher = role.kind === 'starting_pitcher' || role.kind === 'relief_pitcher';
  const league = majorLeagueId(orgId);
  if (!pitcher) return hitterEvidence(orgId, playerIds, role, league, opts, params);
  // A pitcher asked about in a role he does not fill has no results in it; only his tools speak (ignoreResults).
  const results = pitcher && league !== null && !opts.ignoreResults
    ? loadPitcherResults(playerIds, league, role.kind === 'starting_pitcher' ? 'starter' : 'reliever', params)
    : new Map<number, ReturnType<typeof loadPitcherResults> extends Map<number, infer V> ? V : never>();
  for (const id of playerIds) {
    const fit = roleFitEvidence(id, orgId, role);
    const r = results.get(id);
    out.set(id, {
      ratingsPct: fit.compositePercentile, ratingsEvidence: fit.evidenceStatus,
      skillsPct: r?.skillsPercentile ?? null, runsPct: r?.runsPercentile ?? null,
      sample: r?.sample ?? 0, sampleUnit: pitcher ? 'BF' : 'PA', reliability: r?.reliability ?? 0,
      currentSample: r?.current ? r.current.bf : null,
      usage: usageNotes(r, role, bullpen),
      ...(role.kind === 'relief_pitcher' && r?.current ? { bullpen: { g: r.current.g, ip: r.current.outs / 3, sv: r.current.sv, hld: r.current.hld, leverage: r.leverage } } : {}),
    });
  }
  return out;
}

function usageNotes(r: ReturnType<typeof loadPitcherResults> extends Map<number, infer V> ? V | undefined : never, role: RoleRef, bullpen: BullpenLines): string[] {
  if (!r) return [];
  const notes: string[] = [];
  if (role.kind === 'starting_pitcher' && r.inningsPerStart !== null) notes.push(`Averages ${r.inningsPerStart.toFixed(1)} innings per start.`);
  if (role.kind === 'relief_pitcher' && r.current) {
    notes.push(bullpenRoleOf({ playerId: r.playerId, name: '', g: r.current.g, ip: r.current.outs / 3, sv: r.current.sv, hld: r.current.hld, leverage: r.leverage }, bullpen).text);
  }
  return notes;
}

/** The league's hitters' expected bat and running values from their visible tools, ranked against to place one hitter. Rebuilt whenever the cached population is. */
const toolsPopulations = new WeakMap<ScoutedHitterProfile[], { bat: number[]; running: number[] }>();

function toolsPopulation(league: number): { bat: number[]; running: number[] } {
  const profiles = scoutedHitterPopulation(league);
  const hit = toolsPopulations.get(profiles);
  if (hit) return hit;
  const bat: number[] = [];
  const running: number[] = [];
  for (const p of profiles) {
    const b = expectedWobaRaw(p.tools);
    if (b !== null) bat.push(b);
    const r = expectedRunningRaw(p.running);
    if (r !== null) running.push(r);
  }
  const out = { bat, running };
  toolsPopulations.set(profiles, out);
  return out;
}

/**
 * Both lenses for hitters at a position, plus his glove there and his running. The bat lens is what his visible tools say (the
 * calibrated tools model: expected wOBA above the league, ranked among MLB hitters) against what he has done (park-adjusted wOBA,
 * recency weighted); the glove is his REVEALED grade at the position against MLB players listed there and his zone-rating results
 * there; running is his running ratings and his baserunning runs. A grade the game does not show is not read, and a position with no
 * grade leaves that part unknown, not bad.
 */
function hitterEvidence(orgId: number, playerIds: number[], role: RoleRef, league: number | null, opts: { ignoreResults?: boolean }, params: ResultsParams): Map<number, LensEvidence> {
  const out = new Map<number, LensEvidence>();
  const results = league !== null && !opts.ignoreResults ? loadHitterResults(playerIds, league, params) : new Map<number, ReturnType<typeof loadHitterResults> extends Map<number, infer V> ? V : never>();
  const year = league === null ? null : currentSeason(league);
  const usage = league !== null && year !== null ? fieldingUsage(playerIds, league, year) : new Map();
  const fielderPosition = role.position >= 2 && role.position <= 9;
  const peers = league !== null && fielderPosition ? scoutedFieldingPopulation(league, role.position) : [];
  const defense = league !== null && fielderPosition && !opts.ignoreResults ? loadDefenseResults(playerIds, league, role.position, params) : new Map();
  const profiles = loadScoutedHitterProfiles(playerIds);
  const pop = league !== null ? toolsPopulation(league) : { bat: [], running: [] };
  const meanBat = pop.bat.length ? pop.bat.reduce((n, v) => n + v, 0) / pop.bat.length : 0;
  for (const id of playerIds) {
    const fit = roleFitEvidence(id, orgId, role);
    const r = results.get(id);
    const profile = profiles.get(id);
    const batRaw = profile ? expectedWobaRaw(profile.tools) : null;
    const toolsPct = batRaw !== null && pop.bat.length ? percentileAmong(pop.bat, batRaw, true) : null;
    const runRaw = profile ? expectedRunningRaw(profile.running) : null;
    const grade = fielderPosition
      ? scoutedGloves(id)?.positions.find((p) => p.position === role.position && p.current > 0)?.current ?? null
      : null;
    const here = ((usage.get(id) ?? []) as Array<{ year: number; position: number; gs: number; ip: number; errors: number }>).filter((u) => u.position === role.position);
    const now = here.find((u) => u.year === year);
    const d = defense.get(id) as { percentile: number | null; per1300: number | null; innings: number } | undefined;
    const notes: string[] = [];
    if (now && now.gs > 0) notes.push(`Started ${now.gs} games at ${role.label} this season${now.ip > 0 ? ` (${Math.round(now.ip)} innings, ${now.errors} errors)` : ''}.`);
    if (batRaw !== null) notes.push(`His visible tools imply ${(batRaw - meanBat >= 0 ? '+' : '-')}${Math.abs(Math.round((batRaw - meanBat) * 1000))} points of wOBA against the league average.`);
    out.set(id, {
      position: role.position,
      defense: {
        pct: grade !== null && peers.length ? percentileAmong(peers, grade, true) : null, grade, visible: grade !== null,
        resultsPct: d?.percentile ?? null, resultsPer1300: d?.per1300 ?? null, resultsInnings: d?.innings ?? 0,
        stabilization: params.stabilization.defense,
      },
      running: {
        ability: profile?.runningAbility ?? null,
        toolsPct: runRaw !== null && pop.running.length ? percentileAmong(pop.running, runRaw, true) : null,
        resultsPct: r?.baserunning.percentile ?? null, perSixHundred: r?.baserunning.perSixHundred ?? null, sample: r?.baserunning.sample ?? 0,
        stabilization: params.stabilization.baserunning,
      },
      toolsBasis: toolsPct !== null ? 'model' : 'composite',
      toolsExpected: batRaw !== null ? batRaw - meanBat : null,
      toolsProfile: profile ? (() => { const c = toolContributions(profile.tools); const d = describeBat(c); return c && d ? { contributions: c, ...d } : null; })() : null,
      ratingsPct: toolsPct ?? fit.compositePercentile, ratingsEvidence: fit.evidenceStatus,
      skillsPct: r?.percentile ?? null, runsPct: null,
      sample: r?.sample ?? 0, sampleUnit: 'PA', reliability: r?.reliability ?? 0, currentSample: r?.current ? r.current.pa : null,
      usage: notes,
    });
  }
  return out;
}

/** Usage the lineup picture reads: this season's fielding by position, games started, plate appearances, handedness. */
export function hitterUsage(orgId: number, playerIds: number[]): Map<number, Pick<HitterUsageInput, 'bats' | 'fielding' | 'gs' | 'pa'>> {
  const out = new Map<number, Pick<HitterUsageInput, 'bats' | 'fielding' | 'gs' | 'pa'>>();
  const league = majorLeagueId(orgId);
  const year = league === null ? null : currentSeason(league);
  if (league === null || year === null) return out;
  const hands = handedness(playerIds);
  const fielding = fieldingUsage(playerIds, league, year);
  const batting = battingHistory(playerIds, league, year);
  for (const id of playerIds) {
    const now = batting.get(id)?.find((l) => l.year === year);
    out.set(id, {
      bats: hands.get(id)?.bats ?? null,
      fielding: ((fielding.get(id) ?? []) as Array<{ year: number; position: number; gs: number; ip: number }>).filter((f) => f.year === year).map((f) => ({ position: f.position, gs: f.gs, ip: f.ip })),
      gs: now?.gs ?? 0, pa: now?.pa ?? 0,
    });
  }
  return out;
}

/** Team games played this season (the most games any regular has played). */
export function teamGamesPlayed(orgId: number): number {
  const league = majorLeagueId(orgId);
  const year = league === null ? null : currentSeason(league);
  if (league === null || year === null || !tableExists('team_record')) return 0;
  const row = db.prepare(`SELECT g, w, l FROM team_record WHERE team_id = ?`).get(orgId) as { g: number | null; w: number | null; l: number | null } | undefined;
  return row ? (row.g ?? (row.w ?? 0) + (row.l ?? 0)) : 0;
}

/**
 * The norm a hitter's platoon ratings are measured against: the mean rating-implied platoon effect (vs right minus vs left, in wOBA
 * points) among the league's hitters of each handedness. Rebuilt whenever the cached population is.
 */
const platoonNorms = new WeakMap<ScoutedHitterProfile[], { L: number | null; R: number | null; S: number | null }>();

function platoonNormFor(league: number): { L: number | null; R: number | null; S: number | null } {
  const profiles = scoutedHitterPopulation(league);
  const hit = platoonNorms.get(profiles);
  if (hit) return hit;
  const hands = handedness(profiles.map((p) => p.playerId));
  const sums: Record<'L' | 'R' | 'S', number[]> = { L: [], R: [], S: [] };
  for (const p of profiles) {
    const hand = hands.get(p.playerId)?.bats;
    const e = ratingPlatoon(p.vsLeft, p.vsRight).effect;
    if (hand && e !== null) sums[hand].push(e);
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((n, v) => n + v, 0) / xs.length : null);
  const out = { L: avg(sums.L), R: avg(sums.R), S: avg(sums.S) };
  platoonNorms.set(profiles, out);
  return out;
}

/** Observed splits, the league's own platoon effect, and (D-035) each hitter's visible platoon ratings, for each hitter. */
export function platoonInputs(orgId: number, playerIds: number[], params: ResultsParams, platoon: PlatoonParams): Map<number, PlatoonInput> {
  const out = new Map<number, PlatoonInput>();
  const league = majorLeagueId(orgId);
  if (league === null) return out;
  const year = currentSeason(league);
  const hands = handedness(playerIds);
  const splits = platoonSplits(playerIds, league);
  const lp = leaguePlatoon(league);
  const profiles = loadScoutedHitterProfiles(playerIds);
  const pop = toolsPopulation(league);
  const meanBat = pop.bat.length ? pop.bat.reduce((n, v) => n + v, 0) / pop.bat.length : 0;
  const norms = platoonNormFor(league);
  const leagueWoba = year === null ? null : seasonEnvironments(league, year).get(year)?.woba ?? null;
  for (const id of playerIds) {
    const bats = hands.get(id)?.bats ?? null;
    const s = splits.get(id);
    const profile = profiles.get(id);
    const rp = profile ? ratingPlatoon(profile.vsLeft, profile.vsRight) : null;
    out.set(id, {
      bats, vsLeft: s?.vsLeft ?? [], vsRight: s?.vsRight ?? [],
      leagueEffect: bats ? lp.effect[bats] : null, leagueLeftShare: bats ? lp.leftShare[bats] : null, leagueWoba,
      ratings: rp && bats ? { vsLeft: rp.vsLeft === null ? null : rp.vsLeft - meanBat, vsRight: rp.vsRight === null ? null : rp.vsRight - meanBat, norm: norms[bats] } : null,
      recordStabilization: blendStabilization('hitter', params),
      platoon,
    });
  }
  return out;
}

/**
 * How well each player plays each position he can (2-9): the visible current grade and where it ranks among the MLB players LISTED at
 * that position. "Can stand there" is a grade above the playable line; "is a backup there" is not being in the bottom tenth of the
 * peers who actually play it. From the scouted evidence only.
 */
export function coverReads(orgId: number, playerIds: number[]): Map<number, CoverRead[]> {
  const league = majorLeagueId(orgId);
  const out = new Map<number, CoverRead[]>();
  for (const id of playerIds) {
    const reads = (scoutedGloves(id)?.positions ?? [])
      .filter((p) => p.position >= 2 && p.position <= 9 && p.current >= PLAYABLE_RATING)
      .map((p): CoverRead => {
        const peers = league !== null ? scoutedFieldingPopulation(league, p.position) : [];
        const pct = peers.length ? percentileAmong(peers, p.current, true) : null;
        return { position: p.position, grade: p.current, pct, quality: coverQuality(pct) };
      });
    out.set(id, reads);
  }
  return out;
}

/** The positions (2-9) where each player's visible grade supports playing there: the bench's coverage, from the scouted evidence only. */
export function playableCovers(playerIds: number[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const id of playerIds) {
    const positions = scoutedGloves(id)?.positions.filter((p) => p.position >= 2 && p.position <= 9 && p.current >= PLAYABLE_RATING).map((p) => p.position) ?? [];
    out.set(id, positions.sort((a, b) => a - b));
  }
  return out;
}
