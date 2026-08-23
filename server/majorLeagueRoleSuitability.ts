/**
 * Organization-visible MLB role-suitability evidence for an already-legitimate
 * responder. This describes the kind of baseball solution on offer; it does
 * not reopen Player Development eligibility or create a universal MLB grade.
 */

import { db, tableColumns, tableExists } from './db.js';
import { gloves } from './gloves.js';
import type { MajorLeagueNeed } from './majorLeagueOperations.js';
import type { InternalResponder } from './majorLeagueResponders.js';

export interface VisibleRoleRating {
  key: string;
  label: string;
  value: number;
  provenance: 'exported_visible_current_rating';
}

export interface MajorLeagueRoleSuitabilityProfile {
  playerId: number;
  role: MajorLeagueNeed['role'];
  adequacy: {
    status: 'established_by_responder_gate' | 'indeterminate';
    fit: InternalResponder['roleFit']['fit'];
    evidence: InternalResponder['roleFit']['evidence'];
  };
  handedness: { bats: 'R' | 'L' | 'S' | 'unknown'; throws: 'R' | 'L' | 'unknown' };
  positionPlayer: {
    offense: {
      currentRatings: VisibleRoleRating[];
      currentRatingMean: number | null;
      speed: number | null;
      performance: {
        year: number;
        level: number;
        pa: number;
        average: number | null;
        onBasePercentage: number | null;
        sluggingPercentage: number | null;
        ops: number | null;
        war: number | null;
      } | null;
    };
    defense: {
      targetPosition: number | null;
      targetRating: number | null;
      targetExperience: number | null;
      primaryAtTarget: boolean;
      visiblePlayablePositions: number;
      visiblePositions: Array<{ position: number; code: string; current: number; experience: number; primary: boolean }>;
      components: Record<string, number>;
    };
  } | null;
  pitcher: {
    role: 'starter' | 'reliever';
    currentRatings: VisibleRoleRating[];
    currentRatingMean: number | null;
    stamina: number | null;
    repertoire: Array<{ pitch: string; rating: number }>;
    performance: {
      year: number;
      level: number;
      innings: number;
      era: number | null;
      strikeoutRate: number | null;
      walkRate: number | null;
      games: number;
      starts: number;
      war: number | null;
    } | null;
    workload: { fatiguePoints: number | null; playedToday: boolean | null };
  } | null;
  comparisonEvidence: 'sufficient' | 'limited' | 'insufficient';
  unknowns: Array<{ code: string; message: string }>;
  provenance: {
    subjective: 'organization_visible_current_scouting_ratings_only';
    objective: 'imported_save_statistics_and_roster_facts';
  };
  scoutingValuePolicy: 'prohibited_pending_provenance';
}

const HAND = { 1: 'R', 2: 'L', 3: 'S' } as const;

function record(table: string, playerId: number): Record<string, unknown> | null {
  if (!tableExists(table) || !tableColumns(table).includes('player_id')) return null;
  return (db.prepare(`SELECT * FROM ${table} WHERE player_id = ? LIMIT 1`).get(playerId) as Record<string, unknown> | undefined) ?? null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function rating(row: Record<string, unknown> | null, key: string, label: string): VisibleRoleRating | null {
  const value = numberOrNull(row?.[key]);
  return value !== null && value > 0
    ? { key, label, value, provenance: 'exported_visible_current_rating' }
    : null;
}

function mean(ratings: VisibleRoleRating[]): number | null {
  return ratings.length ? Math.round((ratings.reduce((total, item) => total + item.value, 0) / ratings.length) * 10) / 10 : null;
}

function battingPerformance(playerId: number, level: number | null): MajorLeagueRoleSuitabilityProfile['positionPlayer'] extends infer T
  ? T extends { offense: { performance: infer P } } ? P : never : never {
  const required = ['player_id', 'year', 'level_id', 'split_id', 'pa', 'ab', 'h', 'd', 't', 'hr', 'bb', 'hp', 'sf', 'war'];
  if (!tableExists('players_career_batting_stats') || !required.every((column) => tableColumns('players_career_batting_stats').includes(column))) return null;
  const row = db.prepare(`
    SELECT year, level_id, SUM(pa) AS pa, SUM(ab) AS ab, SUM(h) AS h, SUM(d) AS d,
           SUM(t) AS triples, SUM(hr) AS hr, SUM(bb) AS bb, SUM(hp) AS hp,
           SUM(sf) AS sf, SUM(war) AS war
    FROM players_career_batting_stats
    WHERE player_id = ? AND split_id = 1
      AND year = (SELECT MAX(year) FROM players_career_batting_stats WHERE player_id = ? AND split_id = 1)
      ${level === null ? '' : 'AND level_id = ?'}
    GROUP BY year, level_id
    ORDER BY pa DESC, level_id ASC LIMIT 1
  `).get(playerId, playerId, ...(level === null ? [] : [level])) as Record<string, unknown> | undefined;
  if (!row || numberOrNull(row.pa) === null) return null;
  const pa = Number(row.pa);
  const ab = Number(row.ab ?? 0);
  const hits = Number(row.h ?? 0);
  const doubles = Number(row.d ?? 0);
  const triples = Number(row.triples ?? 0);
  const homeRuns = Number(row.hr ?? 0);
  const walks = Number(row.bb ?? 0);
  const hitByPitch = Number(row.hp ?? 0);
  const sacrificeFlies = Number(row.sf ?? 0);
  const obpDenominator = ab + walks + hitByPitch + sacrificeFlies;
  const totalBases = hits - doubles - triples - homeRuns + doubles * 2 + triples * 3 + homeRuns * 4;
  const average = ab > 0 ? hits / ab : null;
  const onBasePercentage = obpDenominator > 0 ? (hits + walks + hitByPitch) / obpDenominator : null;
  const sluggingPercentage = ab > 0 ? totalBases / ab : null;
  return {
    year: Number(row.year), level: Number(row.level_id), pa,
    average, onBasePercentage, sluggingPercentage,
    ops: onBasePercentage !== null && sluggingPercentage !== null ? onBasePercentage + sluggingPercentage : null,
    war: numberOrNull(row.war),
  };
}

function pitchingPerformance(playerId: number, level: number | null): MajorLeagueRoleSuitabilityProfile['pitcher'] extends infer T
  ? T extends { performance: infer P } ? P : never : never {
  const required = ['player_id', 'year', 'level_id', 'split_id', 'outs', 'er', 'bb', 'k', 'bf', 'g', 'gs', 'war'];
  if (!tableExists('players_career_pitching_stats') || !required.every((column) => tableColumns('players_career_pitching_stats').includes(column))) return null;
  const row = db.prepare(`
    SELECT year, level_id, SUM(outs) AS outs, SUM(er) AS er, SUM(bb) AS bb,
           SUM(k) AS strikeouts, SUM(bf) AS batters_faced, SUM(g) AS games,
           SUM(gs) AS starts, SUM(war) AS war
    FROM players_career_pitching_stats
    WHERE player_id = ? AND split_id = 1
      AND year = (SELECT MAX(year) FROM players_career_pitching_stats WHERE player_id = ? AND split_id = 1)
      ${level === null ? '' : 'AND level_id = ?'}
    GROUP BY year, level_id
    ORDER BY outs DESC, level_id ASC LIMIT 1
  `).get(playerId, playerId, ...(level === null ? [] : [level])) as Record<string, unknown> | undefined;
  if (!row || numberOrNull(row.outs) === null) return null;
  const outs = Number(row.outs);
  const innings = Math.round((outs / 3) * 10) / 10;
  const battersFaced = Number(row.batters_faced ?? 0);
  return {
    year: Number(row.year), level: Number(row.level_id), innings,
    era: outs > 0 ? Number(row.er ?? 0) * 27 / outs : null,
    strikeoutRate: battersFaced > 0 ? Number(row.strikeouts ?? 0) / battersFaced : null,
    walkRate: battersFaced > 0 ? Number(row.bb ?? 0) / battersFaced : null,
    games: Number(row.games ?? 0), starts: Number(row.starts ?? 0), war: numberOrNull(row.war),
  };
}

/** Build a structured role profile from only visible scouting and objective save facts. */
export function majorLeagueRoleSuitability(
  need: MajorLeagueNeed,
  responder: InternalResponder
): MajorLeagueRoleSuitabilityProfile {
  const player = record('players', responder.playerId);
  const batting = record('players_batting', responder.playerId);
  const pitching = record('players_pitching', responder.playerId);
  const unknowns: MajorLeagueRoleSuitabilityProfile['unknowns'] = [];
  const batsCode = numberOrNull(player?.bats);
  const throwsCode = numberOrNull(player?.throws);
  const handedness = {
    bats: batsCode !== null && batsCode in HAND ? HAND[batsCode as keyof typeof HAND] : 'unknown' as const,
    throws: throwsCode === 1 ? 'R' as const : throwsCode === 2 ? 'L' as const : 'unknown' as const,
  };
  const isPitcher = need.role?.kind === 'starting_pitcher' || need.role?.kind === 'relief_pitcher';
  if (!player) unknowns.push({ code: 'player_evidence_unavailable', message: 'The imported player row is unavailable for role profiling.' });

  if (isPitcher) {
    const currentRatings = [
      rating(pitching, 'pitching_ratings_overall_stuff', 'Stuff'),
      rating(pitching, 'pitching_ratings_overall_movement', 'Movement'),
      rating(pitching, 'pitching_ratings_overall_control', 'Control'),
    ].filter((item): item is VisibleRoleRating => item !== null);
    const stamina = numberOrNull(pitching?.pitching_ratings_misc_stamina);
    const repertoire = Object.entries(pitching ?? {})
      .filter(([key, value]) => key.startsWith('pitching_ratings_pitches_') && (numberOrNull(value) ?? 0) > 0)
      .map(([key, value]) => ({ pitch: key.replace('pitching_ratings_pitches_', '').replaceAll('_', ' '), rating: Number(value) }))
      .sort((left, right) => right.rating - left.rating || left.pitch.localeCompare(right.pitch));
    if (!currentRatings.length) unknowns.push({ code: 'visible_pitching_ratings_unavailable', message: 'No visible current stuff, movement, or control ratings are exported.' });
    if (stamina === null) unknowns.push({ code: 'visible_stamina_unavailable', message: 'No visible stamina rating is exported.' });
    const fatiguePoints = numberOrNull(player?.fatigue_points);
    const playedTodayValue = numberOrNull(player?.fatigue_played_today);
    return {
      playerId: responder.playerId, role: need.role,
      adequacy: { status: responder.roleFit.evidence.length ? 'established_by_responder_gate' : 'indeterminate', fit: responder.roleFit.fit, evidence: responder.roleFit.evidence },
      handedness, positionPlayer: null,
      pitcher: {
        role: need.role?.kind === 'starting_pitcher' ? 'starter' : 'reliever', currentRatings,
        currentRatingMean: mean(currentRatings), stamina, repertoire,
        performance: pitchingPerformance(responder.playerId, responder.assignment.level),
        workload: { fatiguePoints, playedToday: playedTodayValue === null ? null : playedTodayValue !== 0 },
      },
      comparisonEvidence: currentRatings.length === 3 ? 'sufficient' : currentRatings.length ? 'limited' : 'insufficient',
      unknowns,
      provenance: { subjective: 'organization_visible_current_scouting_ratings_only', objective: 'imported_save_statistics_and_roster_facts' },
      scoutingValuePolicy: 'prohibited_pending_provenance',
    };
  }

  const profile = gloves(responder.playerId);
  const targetPosition = need.role?.kind === 'position' ? need.role.position : null;
  const target = targetPosition === null ? undefined : profile?.positions.find((position) => position.position === targetPosition);
  const currentRatings = [
    rating(batting, 'batting_ratings_overall_contact', 'Contact'),
    rating(batting, 'batting_ratings_overall_gap', 'Gap power'),
    rating(batting, 'batting_ratings_overall_power', 'Power'),
    rating(batting, 'batting_ratings_overall_eye', 'Eye'),
    rating(batting, 'batting_ratings_overall_strikeouts', 'Avoid strikeouts'),
  ].filter((item): item is VisibleRoleRating => item !== null);
  const speed = numberOrNull(batting?.running_ratings_speed);
  if (!currentRatings.length) unknowns.push({ code: 'visible_batting_ratings_unavailable', message: 'No visible current batting component ratings are exported.' });
  if (!target) unknowns.push({ code: 'visible_target_fielding_rating_unavailable', message: 'The target position is established by listed-position evidence, but no visible current position rating is exported.' });
  return {
    playerId: responder.playerId, role: need.role,
    adequacy: { status: responder.roleFit.evidence.length ? 'established_by_responder_gate' : 'indeterminate', fit: responder.roleFit.fit, evidence: responder.roleFit.evidence },
    handedness,
    positionPlayer: {
      offense: {
        currentRatings, currentRatingMean: mean(currentRatings), speed,
        performance: battingPerformance(responder.playerId, responder.assignment.level),
      },
      defense: {
        targetPosition, targetRating: target?.current ?? null, targetExperience: target?.experience ?? null,
        primaryAtTarget: targetPosition !== null && responder.roleFit.fit === 'direct',
        visiblePlayablePositions: profile?.positions.length ?? 0,
        visiblePositions: (profile?.positions ?? []).map((position) => ({
          position: position.position, code: position.code, current: position.current,
          experience: position.experience, primary: position.isPrimary,
        })),
        components: { ...(profile?.components ?? {}) },
      },
    },
    pitcher: null,
    comparisonEvidence: currentRatings.length && (target || responder.roleFit.fit === 'direct')
      ? currentRatings.length === 5 ? 'sufficient' : 'limited'
      : 'insufficient',
    unknowns,
    provenance: { subjective: 'organization_visible_current_scouting_ratings_only', objective: 'imported_save_statistics_and_roster_facts' },
    scoutingValuePolicy: 'prohibited_pending_provenance',
  };
}
