/**
 * Player Development: the objective developmental context of a player, and the one way the
 * protection tier is computed from the save (docs/DEVELOPMENTAL_STAKES.md, D-050).
 *
 * `developmentFit.ts` is pure and judges; this reads. What it reads is objective save fact and
 * nothing else: which club a player is on, that club's level and league, and how old the ROSTERED
 * players of each league are. No rating is read here (D-017) and no result.
 *
 * ONE PEER FRAME, FOR ONE PURPOSE
 *
 *   The rostered players of a player's own league at his own level, for their average age.
 *
 *   rostered   a `team_roster` row. OOTP parks a signing nobody has assigned yet on the parent
 *              club's `team_id` with no roster entry, and counting them put the major-league
 *              level's average age 1.77 years out (D-039, F-0-farm). With no `team_roster` table
 *              there is no way to tell, so the profile is unavailable rather than contaminated.
 *   league     not the level. The Dominican Rookie League's rostered average is 2.4 years under the
 *              complex leagues', which share its level code (F-1-farm).
 *   enough     `LEAGUE_POPULATION_MINIMUM` rostered players. Below it the level's pool is used and
 *              SAID to be; with neither the profile is `unavailable`, the schedule is not read, and
 *              nothing is discounted: missing context may never lower a man's stakes.
 *
 * Talent is never read against this population. The tier's anchor is absolute, so no neighbor's
 * rating, and no league's strength, can move it.
 *
 * ONE WAY TO COMPUTE THE TIER
 *
 *   Every production caller obtains a tier through a reader opened here, so one man has one tier
 *   whichever module asks. `tests/developmentalStakesBoundary.test.ts` fails if a module assembles
 *   the evaluator's inputs itself.
 *
 * A reader is opened per request and holds what it read for the life of that request only: tests
 * write to the database directly, and a profile served across requests would be a stale export's.
 */

import { db, tableColumns, tableExists } from './db.js';
import { LEVEL_NAMES } from './valuation.js';
import { LEAGUE_POPULATION_MINIMUM } from './farmCalibration.js';
import {
  evaluateDevelopmentProtection,
  knownAge,
  type DevelopmentProtection,
  type DevelopmentalContext,
} from './developmentFit.js';
import type { ScoutedAbility } from './scoutedEvidence.js';

interface AgeProfile {
  players: number;
  averageAge: number | null;
}

interface Club {
  level: number;
  leagueId: number;
  leagueName: string | null;
}

export interface DevelopmentalContextReader {
  /** The context of a man at this level in this league. An unknown age leaves `ageRelativeToLevel` null. */
  forLevel(age: number | null | undefined, level: number, leagueId: number, leagueName?: string | null): DevelopmentalContext;

  /** The context of a man on this club; null when the club is not one the export describes. */
  forClub(age: number | null | undefined, teamId: number): DevelopmentalContext | null;

  /**
   * Player Development's tier for a man on this club, from the evidence the adapter supplied. The age
   * is passed as the export has it: a null age is an unknown age, and the tier is then indeterminate.
   */
  protect(input: { age: number | null | undefined; teamId: number; ability: ScoutedAbility; manuallyProtected?: boolean }): DevelopmentProtection;

  /** The age profile a league's context rests on, for a report. */
  profile(level: number, leagueId: number): DevelopmentalContext['ageProfile'];
}

const key = (level: number, leagueId: number): string => `${level}:${leagueId}`;

function readAgeProfiles(): { byLeague: Map<string, AgeProfile>; byLevel: Map<number, AgeProfile> } {
  const byLeague = new Map<string, AgeProfile>();
  const byLevel = new Map<number, AgeProfile>();
  if (!tableExists('players') || !tableExists('teams') || !tableExists('team_roster')) return { byLeague, byLevel };

  const teamColumns = new Set(tableColumns('teams'));
  if (!teamColumns.has('level') || !teamColumns.has('league_id')) return { byLeague, byLevel };
  const clubsOnly = teamColumns.has('allstar_team') ? ' AND t.allstar_team = 0' : '';
  const active = tableColumns('players').includes('retired') ? ' AND p.retired = 0' : '';

  const rows = db
    .prepare(
      `SELECT t.level AS level, t.league_id AS league_id, COUNT(*) AS players, SUM(p.age) AS age_sum
       FROM players p
       JOIN teams t ON t.team_id = p.team_id
       WHERE t.level >= 1 AND p.age IS NOT NULL${active}${clubsOnly}
         AND EXISTS (SELECT 1 FROM team_roster r WHERE r.player_id = p.player_id)
       GROUP BY t.level, t.league_id`
    )
    .all() as Array<{ level: number; league_id: number; players: number; age_sum: number }>;

  const levelTotals = new Map<number, { players: number; ageSum: number }>();
  for (const row of rows) {
    const level = Number(row.level);
    const players = Number(row.players);
    const ageSum = Number(row.age_sum);
    byLeague.set(key(level, Number(row.league_id)), { players, averageAge: players > 0 ? ageSum / players : null });
    const total = levelTotals.get(level) ?? { players: 0, ageSum: 0 };
    levelTotals.set(level, { players: total.players + players, ageSum: total.ageSum + ageSum });
  }
  for (const [level, total] of levelTotals) {
    byLevel.set(level, { players: total.players, averageAge: total.players > 0 ? total.ageSum / total.players : null });
  }
  return { byLeague, byLevel };
}

function readClubs(): Map<number, Club> {
  const out = new Map<number, Club>();
  if (!tableExists('teams')) return out;
  const columns = new Set(tableColumns('teams'));
  if (!columns.has('level') || !columns.has('league_id')) return out;
  const named = tableExists('leagues') && tableColumns('leagues').includes('name');
  const rows = db
    .prepare(
      named
        ? `SELECT t.team_id, t.level, t.league_id, l.name AS league_name FROM teams t LEFT JOIN leagues l ON l.league_id = t.league_id`
        : `SELECT t.team_id, t.level, t.league_id, NULL AS league_name FROM teams t`
    )
    .all() as Array<{ team_id: number; level: number; league_id: number; league_name: string | null }>;
  for (const row of rows) {
    out.set(Number(row.team_id), {
      level: Number(row.level),
      leagueId: Number(row.league_id),
      leagueName: row.league_name ? String(row.league_name) : null,
    });
  }
  return out;
}

/** Open a reader for one request. Two small queries; nothing is kept past the request. */
export function openDevelopmentalContext(): DevelopmentalContextReader {
  let profiles: ReturnType<typeof readAgeProfiles> | null = null;
  let clubs: Map<number, Club> | null = null;

  const profileOf = (level: number, leagueId: number): DevelopmentalContext['ageProfile'] => {
    profiles ??= readAgeProfiles();
    const league = profiles.byLeague.get(key(level, leagueId));
    if (league && league.averageAge !== null && league.players >= LEAGUE_POPULATION_MINIMUM) {
      return { scope: 'league', players: league.players, averageAge: league.averageAge };
    }
    const pool = profiles.byLevel.get(level);
    if (pool && pool.averageAge !== null && pool.players >= LEAGUE_POPULATION_MINIMUM) {
      return { scope: 'level', players: pool.players, averageAge: pool.averageAge };
    }
    return { scope: 'unavailable', players: league?.players ?? pool?.players ?? 0, averageAge: null };
  };

  const forLevel = (age: number | null | undefined, level: number, leagueId: number, leagueName: string | null = null): DevelopmentalContext => {
    const ageProfile = profileOf(level, leagueId);
    const known = knownAge(age);
    return {
      level,
      levelName: LEVEL_NAMES[level] ?? `L${level}`,
      leagueName,
      ageRelativeToLevel: ageProfile.averageAge !== null && known !== null ? ageProfile.averageAge - known : null,
      ageProfile,
    };
  };

  const forClub = (age: number | null | undefined, teamId: number): DevelopmentalContext | null => {
    clubs ??= readClubs();
    const club = clubs.get(teamId);
    if (!club || !Number.isFinite(club.level) || club.level < 1) return null;
    return forLevel(age, club.level, club.leagueId, club.leagueName);
  };

  return {
    forLevel,
    forClub,
    profile: profileOf,
    protect: ({ age, teamId, ability, manuallyProtected }) =>
      evaluateDevelopmentProtection({ age: knownAge(age), ability, context: forClub(age, teamId), manuallyProtected }),
  };
}
