/**
 * Another club's report, read (D-059, N7 Stage A; V2 plan section 3.4a): the same Morning Report reader run for that club
 * (`morningReport.ts`: its season's facts, "How they win and lose", its roster map), its injured list, its record against
 * us and its next series with us, and how much of it our scouts see.
 *
 * - **The same modules, the same fog of war** (case 19): every club's players are valued by Player Value through
 *   `scoutedEvidence.ts`, our organization's scouting (D-017); nothing reads OOTP's true ratings or `players_value`. What
 *   our scouts can't see about the club's players is counted here (`loadScoutedAbilities`) and said.
 * - **Objective facts only** for the head-to-head and the next series: the export's games (D-060: no odds, no posture).
 *
 * Run in the Front Office's worker (`frontOfficeBuild.buildClubReport`), off the server's event loop.
 */
import { db, tableColumns, tableExists } from './db.js';
import { orgInjuries } from './dashboard.js';
import { parseGameDate } from './dataFreshness.js';
import type { DataStatus } from './dataStatus.js';
import { readMorning, type MorningMaterial } from './morningReport.js';
import { loadScoutedAbilities, ratingSource, viewerContext, type EvidenceStatus, type RatingSource } from './scoutedEvidence.js';

/** How much of a club's major-league players our scouts see, by the evidence each carries. */
export interface ScoutingCoverage {
  players: number;
  complete: number;
  partial: number;
  unknown: number;
  /** Whose eyes the export's ratings are, in words (D-061). */
  source: RatingSource;
  /** The club the ratings are scouted by (the human's), or null when the save does not say. */
  viewerOrgId: number | null;
}

export interface SeriesGame {
  gameId: number;
  date: string;
  home: boolean;
}

export interface ClubMaterial {
  teamId: number;
  ourTeamId: number | null;
  morning: MorningMaterial;
  injuries: ReturnType<typeof orgInjuries>;
  /** Their games against us this season, from their side; null when the export has no schedule or they are us. */
  headToHead: { w: number; l: number; t: number; games: number } | null;
  /** Their next series with us: consecutive games in one park from the league's day on; null when none is scheduled. */
  nextSeries: SeriesGame[] | null;
  /** Why there is no series or no head-to-head, when the export can't say. */
  scheduleWhy: string | null;
  scouting: ScoutingCoverage;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Their next series with us: the first unplayed game between the two from the league's day on, and the ones after it in the same park. */
function nextSeriesWith(teamId: number, ourTeamId: number, currentDate: string | null): SeriesGame[] | null {
  const cols = tableExists('games') ? new Set(tableColumns('games')) : new Set<string>();
  if (!['game_id', 'home_team', 'away_team', 'date', 'played'].every((c) => cols.has(c))) return null;
  const today = parseGameDate(currentDate);
  const regular = cols.has('game_type') ? 'AND game_type = 0' : '';
  const rows = (db.prepare(`SELECT game_id, date, home_team, away_team FROM games WHERE played = 0 ${regular}
      AND ((home_team = ? AND away_team = ?) OR (home_team = ? AND away_team = ?))`).all(teamId, ourTeamId, ourTeamId, teamId) as Array<Record<string, unknown>>)
    .map((r) => ({ gameId: Number(r.game_id), date: String(r.date), day: parseGameDate(r.date), homeTeam: num(r.home_team) }))
    .filter((g) => g.day !== null && (today === null || g.day >= today))
    .sort((a, b) => a.day!.localeCompare(b.day!) || a.gameId - b.gameId);
  if (!rows.length) return [];
  const first = rows[0];
  const series = [first];
  for (const g of rows.slice(1)) {
    const last = series[series.length - 1];
    const gap = (Date.parse(`${g.day}T00:00:00Z`) - Date.parse(`${last.day}T00:00:00Z`)) / 86_400_000;
    if (g.homeTeam !== first.homeTeam || gap > 1) break;
    series.push(g);
  }
  return series.map((g) => ({ gameId: g.gameId, date: g.date, home: g.homeTeam === teamId }));
}

/** Reads another club's report. `ourTeamId` is the club the app follows (null when none is known). */
export function readClubReport(teamId: number, ourTeamId: number | null, status: DataStatus): ClubMaterial {
  const morning = readMorning(teamId, status, null);
  const facts = morning.facts;
  let headToHead: ClubMaterial['headToHead'] = null;
  let nextSeries: ClubMaterial['nextSeries'] = null;
  let scheduleWhy: string | null = null;
  if (ourTeamId !== null && ourTeamId !== teamId) {
    if (facts.gamesWhy) scheduleWhy = facts.gamesWhy;
    else {
      const played = facts.games.filter((g) => (g.home === teamId && g.away === ourTeamId) || (g.away === teamId && g.home === ourTeamId));
      const mine = played.map((g) => (g.home === teamId ? { s: g.homeRuns, a: g.awayRuns } : { s: g.awayRuns, a: g.homeRuns }));
      headToHead = { w: mine.filter((g) => g.s > g.a).length, l: mine.filter((g) => g.s < g.a).length, t: mine.filter((g) => g.s === g.a).length, games: mine.length };
      nextSeries = nextSeriesWith(teamId, ourTeamId, facts.currentDate);
    }
  }
  const injuries = tableExists('players_roster_status') ? orgInjuries(teamId).filter((i) => i.levelName === 'MLB') : [];
  // The club's major-league players, as our scouts see them (D-017): complete, partly seen, or not seen
  const ids = tableExists('players') && new Set(tableColumns('players')).has('team_id')
    ? (db.prepare(`SELECT player_id FROM players WHERE team_id = ?${new Set(tableColumns('players')).has('retired') ? ' AND COALESCE(retired, 0) = 0' : ''}`).all(teamId) as Array<{ player_id: number }>).map((r) => r.player_id)
    : [];
  const abilities = loadScoutedAbilities(ids);
  const count = (s: EvidenceStatus) => ids.filter((id) => abilities.for(id).status === s).length;
  return {
    teamId,
    ourTeamId,
    morning,
    injuries,
    headToHead,
    nextSeries,
    scheduleWhy,
    scouting: {
      players: ids.length, complete: count('complete'), partial: count('partial'), unknown: count('unknown'),
      source: ratingSource(), viewerOrgId: viewerContext().viewerOrgId,
    },
  };
}
