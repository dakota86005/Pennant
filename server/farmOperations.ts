/**
 * Minor League Operations: the service that reads the save and composes the specialists.
 *
 * The sibling of `mlbOperations.ts`, and deliberately built the same way: the reasoning lives in
 * pure modules (`farmAffiliate`, `farmAssignments`, `farmOrganization`, `farmCascade`,
 * `farmRetention`, `playingTime`, `currentAssignment`) and this file does the reading and the wiring:
 * the organization assembled once per request (`FarmSession`), the whole view (`computeFarmSystem`),
 * and the operational reading under a scenario. The MLB ↔ farm contract — what follows one player's
 * departure or arrival — is `farmConsequence.ts`; the routes are `farmRoutes.ts`.
 * Nothing here holds a development threshold, a rights rule or a philosophy weight.
 *
 * Ownership, enforced by `tests/farmOperationsBoundary.test.ts`:
 *   ratings              only through `scoutedEvidence` (D-017)
 *   defensibility        only from Player Development (`prospectAssignments`, `destinationFit`,
 *                        `currentAssignment`, `developmentFit`)
 *   preference           only from `assignmentPreference` and the philosophy dimensions, after
 *                        defensibility (D-019)
 *   roster state         only through `playerState` (D-020)
 *   rehab                only through `rehabAssignments` (D-026)
 */

import { db, tableColumns, tableExists } from './db.js';
import { LEVEL_NAMES } from './valuation.js';
import { loadScoutedAbilities, scoutedGloves } from './scoutedEvidence.js';
import {
  computeMinorLeagueRosterHealth,
  isInjured,
  type AffiliateRosterHealth,
  type RosterHealthScenario,
} from './minorLeagueRoster.js';
import { STAKES_CALIBRATION, type DevelopmentProtection } from './developmentFit.js';
import { openDevelopmentalContext, type DevelopmentalContextReader } from './developmentalContext.js';
import { evaluatePitcherDevelopmentalRole } from './destinationFit.js';
import { computeProspects } from './org.js';
import { playerStates } from './playerState.js';
import { screenAffiliatePlayers } from './rehabAssignments.js';
import { resolvePhilosophy } from './philosophy.js';
import { philosophyForOrg } from './settings.js';
import {
  farmProduction,
  type FarmProduction,
  type FarmProductionRequest,
} from './farmResults.js';
import {
  clubGameLogs,
  clubUsage,
  exportThrough,
  injuryAbsences,
  lastGamesElsewhere,
  noUsage,
  projectedRotation,
  whereabouts,
  type ClubGameLog,
  type ClubUsage,
} from './farmUsage.js';
import { lastAppearances, moundStarters, pitcherJob, positionStarters, recentPrimaryPosition, recentUsageFor, type RecentUsage } from './farmRecentUsage.js';
import { arrivalsAtCurrentClub } from './clubArrival.js';
import {
  blockersOf,
  jobRead,
  positionConflict,
  readOpportunity,
  reliefConflict,
  rotationConflict,
  type FarmJob,
  type JobWindow,
  type OpportunityRead,
  type PlayingTimeConflict,
  type UsageFacts,
} from './playingTime.js';
import { evaluateCurrentAssignment, type CurrentAssignmentRead } from './currentAssignment.js';
import {
  buildAffiliateView,
  operationalReading,
  resetFarmFindingIds,
  type AffiliateOperational,
  type AffiliateView,
  type FarmFinding,
} from './farmAffiliate.js';
import {
  reviewAssignment,
  summarizeReview,
  type AlternativeAssignment,
  type AssignmentReview,
} from './farmAssignments.js';
import { buildOrganizationView, type OrganizationView, type OrgPlayerFact } from './farmOrganization.js';
import { reviewRetention, type RetentionReview } from './farmRetention.js';
import * as calibration from './farmCalibration.js';
import { ROTATION_SPOTS } from './farmCalibration.js';


/* ── reading the organization ────────────────────────────────────────────────────────────────── */

export interface AffiliateMeta {
  teamId: number;
  label: string;
  level: number;
  levelName: string;
  leagueId: number;
  leagueName: string;
}

function affiliateMeta(orgId: number): AffiliateMeta[] {
  if (!tableExists('teams')) return [];
  const rows = db
    .prepare(
      `WITH RECURSIVE org AS (
         SELECT team_id, name, nickname, level, league_id FROM teams WHERE team_id = ?
         UNION ALL
         SELECT t.team_id, t.name, t.nickname, t.level, t.league_id
         FROM teams t JOIN org o ON t.parent_team_id = o.team_id
       )
       SELECT DISTINCT o.team_id, o.name, o.nickname, o.level, o.league_id,
              COALESCE(l.name, '') AS league_name
       FROM org o LEFT JOIN leagues l ON l.league_id = o.league_id
       WHERE o.team_id != ?
       ORDER BY o.level, o.team_id`
    )
    .all(orgId, orgId) as Array<{
    team_id: number;
    name: string;
    nickname: string;
    level: number;
    league_id: number;
    league_name: string;
  }>;
  return rows.map((r) => ({
    teamId: r.team_id,
    label: r.name === r.nickname ? r.name : `${r.name} ${r.nickname}`,
    level: r.level,
    levelName: LEVEL_NAMES[r.level] ?? `L${r.level}`,
    leagueId: r.league_id,
    leagueName: r.league_name || `League ${r.league_id}`,
  }));
}

export interface FarmPlayerRow {
  player_id: number;
  first_name: string;
  last_name: string;
  age: number;
  position: number;
  role: number;
  team_id: number;
  injury_is_injured: number | null;
  injury_left: number | null;
}

/** The injury columns, read as exported and absent as NULL (D-007): an injury is a fact, never inferred. */
function injuryColumns(): string {
  const present = new Set(tableColumns('players'));
  const col = (name: string) => (present.has(name) ? `p.${name}` : 'NULL');
  return `${col('injury_is_injured')} AS injury_is_injured, ${col('injury_left')} AS injury_left`;
}

function affiliatePlayers(teamId: number): FarmPlayerRow[] {
  if (!tableExists('players') || !tableExists('team_roster')) return [];
  return db
    .prepare(
      `SELECT p.player_id, p.first_name, p.last_name, p.age, p.position, p.role, p.team_id, ${injuryColumns()}
       FROM players p
       JOIN team_roster tr ON tr.team_id = ? AND tr.player_id = p.player_id AND tr.list_id = 2
       WHERE p.team_id = ? AND p.retired = 0
       ORDER BY p.last_name, p.first_name`
    )
    .all(teamId, teamId) as FarmPlayerRow[];
}

/** One player wherever he is in the organization, for an arrival the farm is asked about. */
export function anyPlayer(playerId: number): FarmPlayerRow | undefined {
  if (!tableExists('players')) return undefined;
  return db
    .prepare(
      `SELECT p.player_id, p.first_name, p.last_name, p.age, p.position, p.role, p.team_id, ${injuryColumns()}
       FROM players p WHERE p.player_id = ? AND p.retired = 0`
    )
    .get(playerId) as FarmPlayerRow | undefined;
}

function currentYear(): number {
  for (const table of ['players_career_batting_stats', 'players_career_pitching_stats']) {
    if (!tableExists(table)) continue;
    const row = db.prepare(`SELECT MAX(year) AS y FROM "${table}"`).get() as { y: number | null };
    if (row?.y) return Number(row.y);
  }
  return new Date().getFullYear();
}

export const POSITION_CODES = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const;
export const FIELDING_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const;

/* ── one player, fully assembled ─────────────────────────────────────────────────────────────── */

export interface AssembledPlayer {
  row: FarmPlayerRow;
  name: string;
  kind: 'hitter' | 'pitcher';
  meta: AffiliateMeta;
  listedPosition: string | null;
  /** Positions with a revealed grade. Empty is a real answer. */
  coverage: string[];
  protection: DevelopmentProtection;
  /** Whether his structure would support starting. A tools reading, not what the club is doing. */
  developmentalStarter: boolean | null;
  /**
   * The ONE job he is competing for: the position his usage shows he plays, else his listed
   * position; for a pitcher, the rotation when the club is using him there, else the bullpen. His
   * other positions are cover, not further claims — see `positionConflict`.
   */
  primaryJob: string | null;
  /** He holds a relief role but his structure would support starting: a role-conversion question. */
  roleConversion: boolean;
  production: FarmProduction;
  usage: UsageFacts;
  rehab: boolean;
  ambiguous: string | null;
  /** Injured for longer than the operational week (the same rule as the roster reading), with the days exported. */
  injured: { daysLeft: number | null } | null;
  /**
   * His recent role differs from his season's: he started earlier in the year and has only relieved
   * lately, or the other way round. A fact from the game log, shown beside his job; never a verdict.
   */
  roleChange: { to: 'relief' | 'starting'; detail: string } | null;
}

/** OOTP role 11 is a starting assignment; 12 and 13 are relief. */
export const OOTP_STARTER_ROLE = 11;

/**
 * The position a hitter's usage says he plays, or his listed position when usage says nothing.
 *
 * Usage first is D-033's rule: the regular at a position is the man who has played the innings
 * there. A player with no innings anywhere yet is not "positionless" — his listed position is what
 * the organization has him down as, and that is an objective roster fact.
 */
function primaryPositionOf(
  inningsByPosition: Record<string, number>,
  listed: string | null,
  coverage: readonly string[],
  recent: RecentUsage | null = null
): string | null {
  /*
   * What he has been playing lately is the job he is competing for NOW. A man moved from left field to
   * centre three weeks ago has more season innings in left, and reading him there would report him as
   * "not used" at a position the club has stopped playing him at. Only when enough of the window can
   * be counted: four games at a new club do not re-assign anybody.
   */
  if (recent && recent.evidence === 'sufficient') {
    const lately = recentPrimaryPosition(recent);
    if (lately) return lately;
  }
  const played = Object.entries(inningsByPosition)
    .filter(([, innings]) => innings > 0)
    .sort((a, b) => b[1] - a[1]);
  if (played.length > 0) return played[0][0];
  if (listed && (FIELDING_POSITIONS as readonly string[]).includes(listed)) return listed;
  return coverage[0] ?? null;
}

export interface ProspectRow {
  player_id: number;
  decision?: { recommendation?: string | null } | null;
  assignments?: {
    evaluations?: Array<{
      kind: string;
      direction: 'promotion' | 'demotion';
      target: { level: number; levelName: string; teams: Array<{ teamId: number; label: string }>; isMajorLeague: boolean };
      judgment: 'defensible' | 'indefensible' | 'indeterminate';
      preference: 'preferred' | 'acceptable' | 'disfavored' | null;
      blockers?: string[];
      missingEvidence?: Array<{ dimension: string; detail: string }>;
    }>;
  } | null;
}

export interface FarmSystemView {
  orgId: number;

  /** What the organization looks like as a whole. */
  organization: OrganizationView;

  affiliates: AffiliateView[];

  /** Every minor leaguer's assignment, reviewed. Most are routine and say so. */
  assignments: AssignmentReview[];

  retention: RetentionReview[];

  /** The one list that answers "what needs my attention". */
  attention: Array<{
    kind: 'assignment' | 'affiliate' | 'organization' | 'retention';
    severity: 'critical' | 'attention' | 'noted';
    headline: string;
    detail: string;
    /** How to open it. */
    target: { kind: 'player'; playerId: number } | { kind: 'affiliate'; teamId: number } | { kind: 'organization' };
  }>;

  /** Every threshold this response used, with its stamp. */
  calibration: Array<{ name: string; value: string; status: string; basis: string }>;

  unknowns: string[];
}

function buildUsageFacts(
  player: Omit<AssembledPlayer, 'production' | 'usage' | 'primaryJob' | 'roleConversion' | 'roleChange'>,
  clubGames: number,
  raw: ReturnType<typeof noUsage>,
  recent: RecentUsage | null,
  projectedStarter: boolean | null
): UsageFacts {
  return {
    playerId: player.row.player_id,
    name: player.name,
    age: player.row.age,
    clubGames,
    games: raw.games,
    inningsByPosition: raw.inningsByPosition,
    starts: raw.starts,
    reliefAppearances: raw.reliefAppearances,
    inningsPitched: raw.inningsPitched,
    tier: player.protection.tier,
    rehab: player.rehab,
    injured: player.injured !== null,
    recent,
    projectedStarter,
  };
}

/**
 * His recent role against his season's, as a fact from the game log. Only with enough of the window
 * counted, and only when the two genuinely differ: a starter who relieved once is not a conversion.
 */
export function roleChangeOf(
  raw: Pick<ReturnType<typeof noUsage>, 'starts' | 'reliefAppearances'>,
  recent: RecentUsage | null,
  assignedStarter: boolean
): AssembledPlayer['roleChange'] {
  if (!recent || recent.evidence !== 'sufficient') return null;
  const recentStarts = recent.pitchingStartGames.length;
  const recentRelief = recent.reliefGames.length;
  const over = `the club's last ${recent.observable.length} games`;
  if (raw.starts > 0 && recentStarts === 0 && recentRelief > 0 && !assignedStarter) {
    return {
      to: 'relief',
      detail: `He started ${raw.starts} ${raw.starts === 1 ? 'game' : 'games'} for the club earlier this season and none of ${over}, in which he has relieved ${recentRelief} ${recentRelief === 1 ? 'time' : 'times'}.`,
    };
  }
  if (recentStarts > 0 && raw.starts === recentStarts && raw.reliefAppearances > recentRelief) {
    return {
      to: 'starting',
      detail: `He has started ${recentStarts} of ${over}, after ${raw.reliefAppearances - recentRelief} relief ${raw.reliefAppearances - recentRelief === 1 ? 'appearance' : 'appearances'} and no start before them.`,
    };
  }
  return null;
}

/**
 * Assemble every minor leaguer of the organization with the evidence each specialist needs.
 *
 * Every player on an affiliate's active list is assembled, including one with no line to read. The
 * farm v1 model silently dropped anyone below its sample gate, which on the real Arizona import
 * meant 172 of 247 minor leaguers — and every one of the 125 players on the three complex affiliates
 * — were invisible to the whole subsystem rather than reported as not assessable
 * (docs/MINOR_LEAGUE_OPERATIONS.md C-13).
 */
export interface Assembled {
  players: AssembledPlayer[];
  metas: AffiliateMeta[];
  year: number;
  /** Each club's game log for the season, read once. The recent read is cut from it. */
  logs: Map<number, ClubGameLog>;
}

function assemble(orgId: number, stakes: DevelopmentalContextReader): Assembled {
  const metas = affiliateMeta(orgId);
  const year = currentYear();
  const players: AssembledPlayer[] = [];

  const rowsByTeam = new Map<number, FarmPlayerRow[]>();
  for (const meta of metas) rowsByTeam.set(meta.teamId, affiliatePlayers(meta.teamId));

  const allIds = [...rowsByTeam.values()].flat().map((r) => r.player_id);
  const abilities = loadScoutedAbilities(allIds);
  const screen = screenAffiliatePlayers(allIds);

  const productionRequests: FarmProductionRequest[] = [];
  const pending: Array<Omit<AssembledPlayer, 'production' | 'usage' | 'primaryJob' | 'roleConversion' | 'roleChange'>> = [];

  for (const meta of metas) {
    for (const row of rowsByTeam.get(meta.teamId) ?? []) {
      const kind: 'hitter' | 'pitcher' = Number(row.position) === 1 ? 'pitcher' : 'hitter';
      const listed = POSITION_CODES[Number(row.position) - 1] ?? null;
      const profile = kind === 'hitter' ? scoutedGloves(row.player_id) : null;
      const coverage = profile
        ? profile.positions
            .filter((p) => (FIELDING_POSITIONS as readonly string[]).includes(p.code) && p.current > 0)
            .map((p) => p.code)
        : [];

      const protection = stakes.protect({ age: row.age, teamId: meta.teamId, ability: abilities.for(row.player_id) });
      const roleAssessment = kind === 'pitcher' ? evaluatePitcherDevelopmentalRole(row.player_id) : null;

      pending.push({
        row,
        name: `${row.first_name} ${row.last_name}`,
        kind,
        meta,
        listedPosition: listed,
        coverage,
        protection,
        developmentalStarter:
          kind === 'pitcher' ? (roleAssessment ? roleAssessment.developmentalRole === 'starter' : null) : null,
        rehab: screen.rehab.has(row.player_id),
        ambiguous: screen.ambiguous.get(row.player_id) ?? null,
        injured: isInjured(row) ? { daysLeft: row.injury_left === null ? null : Number(row.injury_left) } : null,
      });

      productionRequests.push({
        playerId: row.player_id,
        kind,
        teamId: meta.teamId,
        level: meta.level,
        leagueId: meta.leagueId,
        leagueName: meta.leagueName,
      });
    }
  }

  const production = farmProduction(productionRequests, year);
  const usageByTeam = new Map(metas.map((m) => [m.teamId, clubUsage(m.teamId, year)]));

  /*
   * The temporal evidence, read once for the organization. Current state decides who is here; these
   * decide what "lately" means for each of them: the club's games, when he joined it (OOTP's dated
   * move first, the game log's bound where the log is unavailable), and the injury spells that kept
   * him off the field. None of it touches a rating and none of it is cached past this request.
   */
  const logs = clubGameLogs(metas.map((m) => m.teamId));
  const chronology = arrivalsAtCurrentClub(allIds, exportThrough());
  const elsewhere = lastGamesElsewhere(pending.map((p) => ({ playerId: p.row.player_id, teamId: p.meta.teamId })));
  const absences = injuryAbsences(allIds, year);
  const rotations = new Map(metas.map((m) => [m.teamId, projectedRotation(m.teamId)]));

  for (const p of pending) {
    const club = usageByTeam.get(p.meta.teamId);
    const raw = club?.players.get(p.row.player_id) ?? noUsage(p.row.player_id);
    const prod = production.get(p.row.player_id);
    if (!prod) continue;

    const log = logs.get(p.meta.teamId);
    const dated = chronology.arrivals.get(p.row.player_id);
    const recent = log
      ? recentUsageFor({
          log,
          playerId: p.row.player_id,
          arrival: dated ? { date: dated.date, from: dated.from?.name ?? null } : null,
          chronologyAvailable: chronology.chronologyAvailable,
          lastGameElsewhere: elsewhere.get(p.row.player_id) ?? null,
          absences: absences.get(p.row.player_id) ?? [],
        })
      : null;
    const projected = p.kind === 'pitcher' ? (rotations.get(p.meta.teamId)?.has(p.row.player_id) ?? (rotations.get(p.meta.teamId) ? false : null)) : null;

    const assignedStarter = Number(p.row.role) === OOTP_STARTER_ROLE;
    const primaryJob =
      p.kind === 'pitcher'
        ? pitcherJob({ assignedStarter, projectedStarter: projected, seasonStarts: raw.starts, recent })
        : primaryPositionOf(raw.inningsByPosition, p.listedPosition, p.coverage, recent);
    const usedAsStarter = primaryJob === 'the rotation';

    players.push({
      ...p,
      primaryJob,
      /*
       * His structure would support starting and the club is not using him there. That is a
       * developmental question for Player Development, not a shortage, and it is reported as one
       * rather than making him a claimant for a rotation spot nobody is giving him.
       */
      roleConversion: p.kind === 'pitcher' && p.developmentalStarter === true && !assignedStarter && !usedAsStarter && projected !== true,
      roleChange: p.kind === 'pitcher' ? roleChangeOf(raw, recent, assignedStarter || projected === true) : null,
      production: prod,
      usage: buildUsageFacts(p, club?.games ?? 0, raw, recent, projected),
    });
  }

  return { players, metas, year, logs };
}

/** The level's rostered average age minus his, from the prospect payload's own baselines. */
/* ── conflicts per affiliate ─────────────────────────────────────────────────────────────────── */

/**
 * What the game log says about one job: who started there in each game of the window, and which men
 * with work there this season are no longer on the club. null when the export has no game log, which
 * leaves every read the season's.
 *
 * A departed man is identified by CURRENT STATE — he is not on the roster — never by his usage. His
 * innings are history and are named as history; he competes for nothing.
 */
function jobWindowFor(
  job: FarmJob,
  log: ClubGameLog | undefined,
  club: ClubUsage,
  onClub: ReadonlySet<number>
): JobWindow | null {
  if (!log || !log.available || log.games.length === 0) return null;
  if (job.kind === 'relief') return null;
  const starters = job.kind === 'position' ? positionStarters(log, job.position) : moundStarters(log);
  const work = (raw: ClubUsage['players'] extends Map<number, infer R> ? R : never): number =>
    job.kind === 'position' ? (raw.inningsByPosition[job.position] ?? 0) : raw.starts;
  const leftIds = new Set<number>();
  for (const [id, raw] of club.players) if (!onClub.has(id) && work(raw) > 0) leftIds.add(id);
  for (const id of starters) if (id !== null && !onClub.has(id)) leftIds.add(id);
  const now = whereabouts([...leftIds]);
  const seen = lastAppearances(log);
  return {
    starters,
    departed: [...leftIds].map((id) => ({
      playerId: id,
      name: now.get(id)?.name ?? `Player ${id}`,
      seasonWork: club.players.has(id) ? work(club.players.get(id)!) : 0,
      nowAt: now.get(id)?.team ?? null,
      /* Still on this club in the export, but off its active list: an injured list, usually. Not a departure. */
      withClub: now.get(id)?.teamId === club.teamId,
      lastSeen: seen.get(id) ?? null,
    })),
  };
}

/** The men with a claim on one job at a club, and the men getting work there from another job. */
export function castOf(job: FarmJob, mine: readonly AssembledPlayer[]): { claimants: UsageFacts[]; alsoPlaying: UsageFacts[] } {
  if (job.kind === 'rotation') return { claimants: mine.filter((p) => p.kind === 'pitcher' && p.primaryJob === 'the rotation').map((p) => p.usage), alsoPlaying: [] };
  if (job.kind === 'relief') return { claimants: mine.filter((p) => p.kind === 'pitcher' && p.primaryJob === 'the bullpen').map((p) => p.usage), alsoPlaying: [] };
  const position = job.position;
  /* One man, one job: only the players whose primary job is this position compete for it. */
  const claimants = mine.filter((p) => p.kind === 'hitter' && p.primaryJob === position).map((p) => p.usage);
  /*
   * ...but anyone getting work there is a fact about who is ahead of them: the corner outfielder
   * covering centre, the two-way pitcher who is in fact the regular first baseman. They count against
   * nobody's capacity and they are named. Season innings or a recent start: a man who began covering
   * the position last week has no season share of it yet.
   */
  const alsoPlaying = mine
    .filter(
      (p) =>
        p.primaryJob !== position &&
        ((p.usage.inningsByPosition[position] ?? 0) > 0 || (p.usage.recent?.startGames[position]?.length ?? 0) > 0)
    )
    .map((p) => p.usage);
  return { claimants, alsoPlaying };
}

function conflictsFor(
  meta: AffiliateMeta,
  players: readonly AssembledPlayer[],
  year: number,
  windowOf: (job: FarmJob) => JobWindow | null
): PlayingTimeConflict[] {
  const club = clubUsage(meta.teamId, year);
  const mine = players.filter((p) => p.meta.teamId === meta.teamId);
  const out: PlayingTimeConflict[] = [];

  for (const position of FIELDING_POSITIONS) {
    const job: FarmJob = { kind: 'position', position };
    const { claimants, alsoPlaying } = castOf(job, mine);
    const conflict = positionConflict(
      meta.teamId,
      position,
      claimants,
      club.inningsByPosition[position] ?? 0,
      alsoPlaying,
      windowOf(job)
    );
    if (conflict) out.push(conflict);
  }

  const rotation = rotationConflict(meta.teamId, castOf({ kind: 'rotation' }, mine).claimants, club.games, windowOf({ kind: 'rotation' }));
  if (rotation) out.push(rotation);

  const relief = reliefConflict(meta.teamId, castOf({ kind: 'relief' }, mine).claimants, club.games);
  if (relief) out.push(relief);

  return out;
}

/** The job a man is competing for, as the playing-time model names it. */
export function farmJobOf(player: AssembledPlayer): FarmJob | null {
  if (player.kind === 'pitcher') return player.primaryJob === 'the rotation' ? { kind: 'rotation' } : { kind: 'relief' };
  return player.primaryJob ? { kind: 'position', position: player.primaryJob } : null;
}

/**
 * A man's opportunity when nobody is competing with him for his job.
 *
 * A conflict needs competition, so most of the organization is in none. That is right for the
 * affiliate's list of conflicts and was wrong for the man himself: "no job is contested for him" read
 * a prospect starting twice a fortnight as getting regular work, because the men actually playing his
 * position are listed at another one. His own work is a question about him either way, so a position
 * player's verdict comes from the read of his job, contested or not. A pitcher's is left as it was: an
 * uncrowded bullpen giving an arm few innings is a usage choice, not congestion, and a rotation with a
 * man short of starts is already a conflict.
 */
function ownOpportunityOf(player: AssembledPlayer, session: FarmSession, fallback: OpportunityRead): OpportunityRead {
  const job = farmJobOf(player);
  if (!job) return fallback;
  const { players, year } = session.assembled();
  const club = clubUsage(player.meta.teamId, year);
  const { claimants, alsoPlaying } = castOf(job, players.filter((p) => p.meta.teamId === player.meta.teamId));
  const read = jobRead(
    job,
    {
      claimants,
      alsoPlaying,
      clubInningsAtPosition: job.kind === 'position' ? (club.inningsByPosition[job.position] ?? 0) : undefined,
      clubGames: club.games,
      window: session.jobWindow(player.meta.teamId, job),
    },
    player.meta.teamId
  );
  if (!read) return fallback;
  const own = readOpportunity(player.row.player_id, [read]);
  return job.kind === 'position' ? own : { ...fallback, work: own.work };
}

/* ── the session: one organization, read once ───────────────────────────────────────────────── */

interface ProspectPayload {
  batters: ProspectRow[];
  pitchers: ProspectRow[];
}

/**
 * The organization as read for one request.
 *
 * Every farm answer starts from the same three reads — the assembled players, Player Development's
 * prospect payload and the affiliates' roster health — and each costs about a second. MLB Operations
 * asks the farm consequence once per candidate, so a need with ten Triple-A candidates re-read the
 * organization ten times and spent eleven seconds in the farm (MINOR_LEAGUE_OPERATIONS.md §7.3). A
 * session memoizes the reads for the life of ONE request and no longer: it is opened per request, so
 * nothing is ever served from a previous export or a previous philosophy setting. Correctness and
 * freshness are not traded for the cache.
 */
export interface FarmSession {
  readonly orgId: number;
  assembled(): Assembled;
  prospects(): ProspectPayload;
  health(): AffiliateRosterHealth[];
  /** Roster health of one affiliate under a read-only scenario, memoized on the scenario. */
  healthScenario(teamId: number, scenario: RosterHealthScenario): AffiliateRosterHealth | undefined;
  /** Playing-time conflicts of one affiliate as it stands. */
  conflicts(teamId: number): PlayingTimeConflict[];
  /** What the game log says about one job at one club, read once: null without a game log. */
  jobWindow(teamId: number, job: FarmJob): JobWindow | null;
  /** Player Development's reader for developmental stakes, so an arrival is tiered as the organization was. */
  stakes(): DevelopmentalContextReader;
}

export function openFarmSession(orgId: number): FarmSession {
  let assembledMemo: ReturnType<typeof assemble> | null = null;
  let stakesMemo: DevelopmentalContextReader | null = null;
  let prospectsMemo: ProspectPayload | null = null;
  let healthMemo: AffiliateRosterHealth[] | null = null;
  const scenarioMemo = new Map<string, AffiliateRosterHealth | undefined>();
  const conflictMemo = new Map<number, PlayingTimeConflict[]>();
  const windowMemo = new Map<string, JobWindow | null>();

  const session: FarmSession = {
    orgId,
    stakes: () => (stakesMemo ??= openDevelopmentalContext()),
    assembled: () => (assembledMemo ??= assemble(orgId, session.stakes())),
    prospects: () => (prospectsMemo ??= computeProspects(orgId) as unknown as ProspectPayload),
    health: () => (healthMemo ??= computeMinorLeagueRosterHealth(orgId)),
    healthScenario: (teamId, scenario) => {
      const key = `${teamId}:${JSON.stringify([...(scenario.removePlayerIds ?? [])].sort())}:${JSON.stringify(
        [...(scenario.addPlayers ?? [])].map((a) => `${a.playerId}@${a.teamId}`).sort()
      )}`;
      if (!scenarioMemo.has(key)) {
        scenarioMemo.set(teamId === -1 ? key : key, computeMinorLeagueRosterHealth(orgId, { ...scenario, onlyTeamIds: [teamId] })[0]);
      }
      return scenarioMemo.get(key);
    },
    conflicts: (teamId) => {
      const hit = conflictMemo.get(teamId);
      if (hit) return hit;
      const { players, metas, year } = session.assembled();
      const meta = metas.find((m) => m.teamId === teamId);
      const out = meta ? conflictsFor(meta, players, year, (job) => session.jobWindow(teamId, job)) : [];
      conflictMemo.set(teamId, out);
      return out;
    },
    jobWindow: (teamId, job) => {
      const key = `${teamId}:${job.kind === 'position' ? job.position : job.kind}`;
      if (!windowMemo.has(key)) {
        const { players, year, logs } = session.assembled();
        const onClub = new Set(players.filter((p) => p.meta.teamId === teamId).map((p) => p.row.player_id));
        windowMemo.set(key, jobWindowFor(job, logs.get(teamId), clubUsage(teamId, year), onClub));
      }
      return windowMemo.get(key) ?? null;
    },
  };
  return session;
}

/* ── the whole view ──────────────────────────────────────────────────────────────────────────── */

export function computeFarmSystem(orgId: number, session: FarmSession = openFarmSession(orgId)): FarmSystemView {
  resetFarmFindingIds();
  let seq = 0;
  const nextFindingId = (prefix: string): string => `${prefix}-x${++seq}`;

  const { players, metas, year } = session.assembled();
  const health = session.health();
  const healthByTeam = new Map(health.map((h) => [h.teamId, h]));
  const prospects = session.prospects();
  const prospectById = new Map<number, ProspectRow>(
    [...prospects.batters, ...prospects.pitchers].map((r) => [r.player_id, r])
  );
  const philosophy = resolvePhilosophy(philosophyForOrg(orgId));
  const states = playerStates(players.map((p) => p.row.player_id));

  const levels = [...new Set(metas.map((m) => m.level))].sort((a, b) => a - b);
  const lowestLevel = Math.max(...levels, 0);

  /* Per-affiliate playing-time conflicts, which every later reading needs. */
  const conflictsByTeam = new Map<number, PlayingTimeConflict[]>();
  for (const meta of metas) conflictsByTeam.set(meta.teamId, session.conflicts(meta.teamId));

  /* ── each player's assignment ──────────────────────────────────────────────────────────────── */

  const currentReads = new Map<number, CurrentAssignmentRead>();
  const reviews: AssignmentReview[] = [];

  for (const p of players) {
    const current = evaluateCurrentAssignment({
      leaguePercentile: p.production.percentile,
      reliability: p.production.sample.reliability,
      unassessable: p.production.unassessableDetail,
      /* His age against his league's rostered average: the one reading the stakes rest on, from the same reader. */
      ageRelativeToLevel: session.stakes().forLevel(p.row.age, p.meta.level, p.meta.leagueId, p.meta.leagueName).ageRelativeToLevel,
      tier: p.protection.tier,
      missingEvidence: p.protection.missingEvidence,
      canDemote: p.meta.level < lowestLevel,
    });
    currentReads.set(p.row.player_id, current);
  }

  for (const p of players) {
    const current = currentReads.get(p.row.player_id)!;
    const conflicts = conflictsByTeam.get(p.meta.teamId) ?? [];
    const read = readOpportunity(p.row.player_id, conflicts);
    /* In no conflict he still has a job and a tenure; rehab and injured men are read for neither. */
    const opportunity: OpportunityRead = read.work === null && !p.rehab && p.injured === null ? ownOpportunityOf(p, session, read) : read;

    const prospect = prospectById.get(p.row.player_id);
    const alternatives: AlternativeAssignment[] = (prospect?.assignments?.evaluations ?? [])
      .filter((e) => !e.target.isMajorLeague)
      .map((e) => {
        const destinationTeam = e.target.teams[0];
        const destinationConflicts = destinationTeam ? (conflictsByTeam.get(destinationTeam.teamId) ?? []) : [];
        const job = p.primaryJob;
        const contested = destinationConflicts.find((c) =>
          c.job.kind === 'position' ? c.job.position === job : job === (c.job.kind === 'rotation' ? 'the rotation' : 'the bullpen')
        );
        return {
          kind: e.kind as AlternativeAssignment['kind'],
          direction: e.direction,
          level: e.target.level,
          levelName: e.target.levelName,
          teams: e.target.teams,
          judgment: e.judgment,
          preference: e.judgment === 'defensible' ? e.preference : null,
          blockers: e.blockers ?? [],
          missingEvidence: (e.missingEvidence ?? []) as AlternativeAssignment['missingEvidence'],
          destinationOpportunity:
            destinationTeam && job
              ? {
                  teamId: destinationTeam.teamId,
                  job,
                  open: !contested || contested.claimants.length < contested.capacity,
                  detail: contested
                    ? `${destinationTeam.label} already has ${contested.claimants.length} men with a claim on ${job}, which supports ${contested.capacity}.`
                    : `${destinationTeam.label} has room at ${job}.`,
                }
              : null,
        };
      });

    /*
     * Who, elsewhere in the organization, is standing where he needs to be. A blocker is a player at
     * the SAME job one level up whose own assignment is defensible there and who has the reps: the
     * organization has two men for one developmental path.
     */
    const blockedBy: Array<{ playerId: number; name: string; age: number; where: string; why: string }> = [];
    if (opportunity.verdict === 'not_playing' || opportunity.verdict === 'insufficient_work') {
      /*
       * A blocker HOLDS the job: he is regular there. A part-time man ahead of a prospect, or a man who
       * has since been promoted and whose innings still stand in the denominator, is not occupying
       * anyone's path; the prospect's problem is then an opportunity conflict and is reported as one.
       */
      for (const ahead of blockersOf(opportunity)) {
        const other = players.find((x) => x.row.player_id === ahead.playerId);
        if (!other) continue;
        const verdict = currentReads.get(other.row.player_id)?.verdict;
        blockedBy.push({
          playerId: other.row.player_id,
          name: other.name,
          age: Number(other.row.age),
          where: other.meta.label,
          why:
            verdict === 'no_longer_developmental'
              ? 'and the level has nothing left to teach him either, so the organization is holding two men on one developmental path'
              : verdict === 'appropriate'
                ? 'and the level is still developing him'
                : verdict === 'too_advanced'
                  ? 'though the level is ahead of what he has shown'
                  : !ahead.claimant
                    ? 'from another position, which is where the club lists him'
                    : 'and what the level is doing for him cannot be read yet',
        });
      }
    }

    reviews.push(
      reviewAssignment({
        playerId: p.row.player_id,
        name: p.name,
        age: Number(p.row.age),
        kind: p.kind,
        teamId: p.meta.teamId,
        team: p.meta.label,
        level: p.meta.level,
        levelName: p.meta.levelName,
        leagueName: p.meta.leagueName,
        protection: p.protection,
        production: p.production,
        current,
        opportunity,
        alternatives,
        blockedBy,
        injured: p.injured,
        roleChange: p.roleChange,
      })
    );
  }

  const reviewById = new Map(reviews.map((r) => [r.playerId, r]));

  /* ── affiliates ────────────────────────────────────────────────────────────────────────────── */

  const affiliates: AffiliateView[] = [];
  for (const meta of metas) {
    const h = healthByTeam.get(meta.teamId);
    if (!h) continue;
    const mine = players.filter((p) => p.meta.teamId === meta.teamId);
    affiliates.push(
      buildAffiliateView({
        health: h,
        leagueId: meta.leagueId,
        leagueName: meta.leagueName,
        games: clubUsage(meta.teamId, year).games,
        conflicts: conflictsByTeam.get(meta.teamId) ?? [],
        listedOnly: listedOnlyOf(mine),
        rotationClaimants: rotationClaimantsOf(mine),
        roleConversions: mine
          .filter((p) => p.roleConversion)
          .map((p) => ({
            playerId: p.row.player_id,
            name: p.name,
            age: Number(p.row.age),
            tier: p.protection.tier,
            basis: `The club has him in relief; Player Development reads his stamina and repertoire as supporting a starting role. ${p.usage.starts} starts in ${p.usage.games} appearances.`,
          })),
        assignments: mine.map((p) => {
          const r = reviewById.get(p.row.player_id)!;
          return {
            playerId: p.row.player_id,
            name: p.name,
            age: Number(p.row.age),
            verdict: r.current.verdict,
            question: r.current.question,
            summary: summarizeReview(r),
            unassessableReason: p.production.unassessableDetail,
          };
        }),
      })
    );
  }

  /* ── organization ──────────────────────────────────────────────────────────────────────────── */

  const orgFacts: OrgPlayerFact[] = players.map((p) => {
    const r = reviewById.get(p.row.player_id)!;
    return {
      playerId: p.row.player_id,
      name: p.name,
      age: Number(p.row.age),
      teamId: p.meta.teamId,
      team: p.meta.label,
      level: p.meta.level,
      levelName: p.meta.levelName,
      kind: p.kind,
      primaryJob: p.primaryJob,
      coverage: p.coverage,
      developmentalStarter: p.developmentalStarter,
      tier: p.protection.tier,
      conclusion: r.conclusion,
      clubGames: p.usage.clubGames,
      rehab: p.rehab,
    };
  });

  const organization = buildOrganizationView({
    players: orgFacts,
    affiliates: metas.map((m) => ({ teamId: m.teamId, team: m.label, level: m.level, levelName: m.levelName })),
    majorLeagueThinAt: majorLeagueThinPositions(orgId),
    rotationSpots: ROTATION_SPOTS,
    nextFindingId,
  });

  /* ── retention ─────────────────────────────────────────────────────────────────────────────── */

  const retention: RetentionReview[] = players.map((p) => {
    const state = states.get(p.row.player_id);
    const conflicts = conflictsByTeam.get(p.meta.teamId) ?? [];
    const mine = conflicts.find((c) => c.claimants.some((s) => s.playerId === p.row.player_id));
    /*
     * Somebody is waiting on him only if he is the one HOLDING the work. A man who is himself short
     * of it occupies nothing: reporting the other squeezed men as "waiting on him" made a
     * twenty-two-year-old with nineteen innings a retention question because another blocked prospect
     * also wanted the position.
     */
    const meInConflict = mine?.claimants.find((s) => s.playerId === p.row.player_id);
    const holdsTheWork = meInConflict?.level === 'regular';
    const waiting =
      mine && holdsTheWork
        ? mine.squeezed
            .filter((s) => s.playerId !== p.row.player_id)
            .map((s) => ({
              playerId: s.playerId,
              name: s.name,
              age: s.age,
              what: `developmental work at ${mine.job.kind === 'position' ? mine.job.position : mine.job.kind === 'rotation' ? 'the rotation' : 'the bullpen'}`,
            }))
        : [];
    return reviewRetention({
      playerId: p.row.player_id,
      name: p.name,
      age: Number(p.row.age),
      teamId: p.meta.teamId,
      team: p.meta.label,
      level: p.meta.level,
      levelName: p.meta.levelName,
      protection: p.protection,
      current: currentReads.get(p.row.player_id)!,
      assignmentConclusion: reviewById.get(p.row.player_id)!.conclusion,
      proServiceYears: state?.serviceTime.professionalYears.value ?? null,
      state: {
        onFortyMan: state?.fortyMan.value ?? null,
        majorLeagueContract: state?.contract.majorLeague.value ?? null,
        mustBeActive: null,
        onInjuredList: state
          ? state.injuredList.onIl.value === true || state.injuredList.onIl60.value === true
          : null,
      },
      waiting,
      clubCrowded: mine ? mine.claimants.length > mine.capacity : false,
      philosophy: {
        prospectPreservation: philosophy.dimensions.prospectPreservation.value,
        rosterDepth: philosophy.dimensions.rosterDepth.value,
      },
      facts: [
        { label: 'Level', value: p.meta.levelName },
        { label: 'Age', value: String(p.row.age) },
        {
          label: 'Professional seasons',
          value:
            state?.serviceTime.professionalYears.value != null
              ? String(state.serviceTime.professionalYears.value)
              : 'not established',
        },
        {
          label: 'On the 40-man',
          value:
            state?.fortyMan.value === true ? 'yes' : state?.fortyMan.value === false ? 'no' : 'not established',
        },
      ],
    });
  });

  /* ── the attention list ────────────────────────────────────────────────────────────────────── */

  const attention: FarmSystemView['attention'] = [];

  for (const r of reviews) {
    if (r.attention === 'routine') continue;
    /*
     * A man past his level's developmental window is the depth every affiliate is partly built from,
     * and there are a dozen of him in a real organization. Fourteen rows each saying the same thing
     * is not an inbox, so they are counted once and the count points at the Organization view.
     */
    if (r.conclusion === 'organizational_question') continue;
    attention.push({
      kind: 'assignment',
      severity: r.attention === 'needs_attention' ? 'attention' : 'noted',
      headline: `${r.name} (${r.age}, ${r.levelName}): ${summarizeReview(r)}`,
      detail: r.reasons[0] ?? '',
      target: { kind: 'player', playerId: r.playerId },
    });
  }

  const organizationalQuestions = reviews.filter((r) => r.conclusion === 'organizational_question');
  if (organizationalQuestions.length > 0) {
    attention.push({
      kind: 'organization',
      severity: 'noted',
      headline: `${organizationalQuestions.length} players are past their level's developmental window.`,
      detail:
        'The level has no developmental value left for them, so where each plays is a question about what the organization needs and who else needs the reps, not about his development.',
      target: { kind: 'organization' },
    });
  }

  /*
   * A club's problems, not its players'.
   *
   * The attention list carries each player's own assignment review and each club's OPERATIONAL
   * findings. A developmental finding about named players — a positional conflict, a group that has
   * outgrown the level — is the same problem the players' own reviews already raise, and putting both
   * on the list said everything twice: the first version ran to 137 items, half of them a second
   * copy of the other half. The developmental findings stay on the affiliate view, where the GM has
   * drilled in deliberately.
   */
  for (const a of affiliates) {
    for (const f of a.operational.findings) {
      if (f.severity === 'noted') continue;
      attention.push({
        kind: 'affiliate',
        severity: f.severity,
        headline: `${a.label}: ${f.headline}`,
        detail: f.evidence[0] ? `${f.evidence[0].label}: ${f.evidence[0].value}` : '',
        target: { kind: 'affiliate', teamId: a.teamId },
      });
    }
  }

  for (const f of organization.findings) {
    if (f.severity === 'noted') continue;
    attention.push({
      kind: 'organization',
      severity: f.severity,
      headline: f.headline,
      detail: f.evidence[0] ? `${f.evidence[0].label}: ${f.evidence[0].value}` : '',
      target: { kind: 'organization' },
    });
  }

  for (const r of retention) {
    if (r.conclusion !== 'review') continue;
    attention.push({
      kind: 'retention',
      severity: 'noted',
      headline: `${r.name} (${r.age}, ${r.levelName}): no development case left and the spot is wanted.`,
      detail: r.reasons[0] ?? '',
      target: { kind: 'player', playerId: r.playerId },
    });
  }

  const order = { critical: 0, attention: 1, noted: 2 };
  attention.sort((a, b) => order[a.severity] - order[b.severity] || a.headline.localeCompare(b.headline));

  /*
   * An unknown loses its subject when it leaves the club it is about: four affiliates each saying "7
   * of this club's players have no readable production" collapses to one line about nobody. The club
   * is named as it is hoisted.
   */
  const unknowns = [
    ...new Set(affiliates.flatMap((a) => a.unknowns.map((u) => `${a.label}: ${u.replace(/^This club/, 'It').replace(/this club's/g, 'its')}`))),
  ];

  return {
    orgId,
    organization,
    affiliates,
    assignments: reviews.sort((a, b) => a.name.localeCompare(b.name)),
    retention: retention.sort((a, b) => a.name.localeCompare(b.name)),
    attention,
    calibration: farmCalibrationReport(),
    unknowns,
  };
}

/* ── supporting reads ────────────────────────────────────────────────────────────────────────── */

/**
 * Positions the major-league club has thin coverage at.
 *
 * Read from the club's own roster, as a count of who can play each position. It is deliberately not
 * MLB Operations' review: this module must not depend on the sibling subsystem's internals, and the
 * question here is only "is there depth behind it in the farm" (the contract runs the other way,
 * `farmConsequenceFor`).
 */
function majorLeagueThinPositions(orgId: number): string[] {
  if (!tableExists('players') || !tableExists('team_roster')) return [];
  const rows = db
    .prepare(
      `SELECT p.player_id, p.position FROM players p
       JOIN team_roster tr ON tr.team_id = ? AND tr.player_id = p.player_id AND tr.list_id = 1
       WHERE p.team_id = ? AND p.retired = 0 AND p.position != 1`
    )
    .all(orgId, orgId) as Array<{ player_id: number; position: number }>;
  const counts = new Map<string, number>();
  for (const r of rows) {
    const profile = scoutedGloves(r.player_id);
    const codes = profile
      ? profile.positions.filter((x) => x.current > 0 && (FIELDING_POSITIONS as readonly string[]).includes(x.code)).map((x) => x.code)
      : [];
    const listed = POSITION_CODES[Number(r.position) - 1];
    for (const code of new Set([...codes, ...(listed && (FIELDING_POSITIONS as readonly string[]).includes(listed) ? [listed] : [])])) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return FIELDING_POSITIONS.filter((position) => (counts.get(position) ?? 0) <= 1);
}

/** Positions covered on a club only by a roster label, with no revealed grade. */
function listedOnlyOf(mine: readonly AssembledPlayer[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const position of FIELDING_POSITIONS) {
    out[position] = mine.filter((p) => !p.rehab && p.injured === null && p.listedPosition === position && !p.coverage.includes(position)).length;
  }
  return out;
}

/** Pitchers a club is getting its starts from: assigned to start or having started, present and healthy. */
const rotationClaimantsOf = (mine: readonly AssembledPlayer[]): number =>
  mine.filter((p) => !p.rehab && p.injured === null && p.primaryJob === 'the rotation').length;

/**
 * One club's operational reading under a read-only scenario: as it stands, without a player, or with
 * one added. The same findings-derived status the Affiliates view shows, so MLB Operations and the
 * farm workspace describe one farm.
 */
export function affiliateOperationalUnder(
  session: FarmSession,
  teamId: number,
  scenario: { removePlayerIds?: readonly number[]; addPlayers?: readonly { playerId: number; teamId: number }[] } = {}
): (AffiliateOperational & { rotationClaimants: number }) | null {
  const { players } = session.assembled();
  const health = session.healthScenario(teamId, scenario);
  if (!health) return null;
  const removed = new Set(scenario.removePlayerIds ?? []);
  const mine = players.filter((p) => p.meta.teamId === teamId && !removed.has(p.row.player_id));
  const listedOnly = listedOnlyOf(mine);
  let rotationClaimants = rotationClaimantsOf(mine);
  for (const add of scenario.addPlayers ?? []) {
    if (add.teamId !== teamId || mine.some((p) => p.row.player_id === add.playerId)) continue;
    const row = anyPlayer(add.playerId);
    if (!row) continue;
    if (Number(row.position) === 1) {
      if (Number(row.role) === OOTP_STARTER_ROLE) rotationClaimants += 1;
    } else {
      const listed = POSITION_CODES[Number(row.position) - 1] ?? null;
      const graded = scoutedGloves(row.player_id)?.positions.some((x) => x.code === listed && x.current > 0) ?? false;
      if (listed && (FIELDING_POSITIONS as readonly string[]).includes(listed) && !graded) listedOnly[listed] = (listedOnly[listed] ?? 0) + 1;
    }
  }
  resetFarmFindingIds();
  return { ...operationalReading({ health, listedOnly, rotationClaimants }), rotationClaimants };
}

/** Every constant this response could have used, with its stamp: the reader sees what is decided and what is provisional. */
function farmCalibrationReport(): FarmSystemView['calibration'] {
  const stamp = (name: string, value: unknown, status: 'policy' | 'provisional', basis: string) => ({
    name,
    value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    status,
    basis,
  });
  return [
    stamp('BODY_COUNT', calibration.BODY_COUNT, 'policy', 'Bodies a club needs to rest a lineup and cover a schedule.'),
    stamp('ROTATION_SPOTS', calibration.ROTATION_SPOTS, 'policy', 'A five-man rotation, the shape OOTP runs at every full-season level.'),
    stamp('RELIEF_CORPS', calibration.RELIEF_CORPS, 'policy', 'Relief coverage over a normal week, and the point past which arms outnumber innings.'),
    stamp('CRITICAL_POSITIONS', calibration.CRITICAL_POSITIONS, 'policy', 'Positions whose loss cannot be covered by moving somebody else.'),
    stamp('INJURED_DAYS_NOT_COUNTED', calibration.INJURED_DAYS_NOT_COUNTED, 'policy', 'Days of injury past which a man is not counted as cover.'),
    stamp('PLAYABLE_GRADE / STRONG_GRADE', `${calibration.PLAYABLE_GRADE} / ${calibration.STRONG_GRADE}`, 'policy', 'Where a visible fielding grade is usable, and where it is a real cover.'),
    stamp('POSITION_CAPACITY', calibration.POSITION_CAPACITY, 'policy', 'How many men a position supports before one is not getting developmental reps.'),
    stamp('REGULAR_SHARE / PART_TIME_SHARE', `${calibration.REGULAR_SHARE} / ${calibration.PART_TIME_SHARE}`, 'policy', 'Share of a job that makes a man its regular, and below which he is occasional.'),
    stamp('REGULAR_PLAY_SHARE', calibration.REGULAR_PLAY_SHARE, 'policy', 'Share of the club\'s games a man must appear in to be read as playing regularly.'),
    stamp('ROTATION_SHARE', calibration.ROTATION_SHARE, 'policy', 'A starter\'s share of a five-man rotation\'s starts: in it, spot-starting, or not used.'),
    stamp('MINIMUM_CLUB_GAMES', calibration.MINIMUM_CLUB_GAMES, 'policy', 'Games a club must have played before a share or a shape is read.'),
    stamp('DEPARTED_SHARE_NOTED', calibration.DEPARTED_SHARE_NOTED, 'policy', 'Share of a job played by men no longer on the club past which the shares are said to lag. Used only when the export has no game log.'),
    stamp('RECENT_WINDOW_GAMES', calibration.RECENT_WINDOW_GAMES, 'provisional', 'Club games the recent read looks back over: three turns of a five-man rotation. Backtested on the export\'s own game log; one partial season of one save.'),
    stamp('RECENT_MINIMUM_GAMES', calibration.RECENT_MINIMUM_GAMES, 'provisional', 'Games a man must have been observable for before his recent share is read as a role. Below it his role is not established.'),
    stamp('RECENT_ROTATION_SHARE', calibration.RECENT_ROTATION_SHARE, 'provisional', 'A starter\'s share of his turns over the recent window: two of three is in the rotation, one is spot-starting.'),
    stamp('MINIMUM_SAMPLE', calibration.MINIMUM_SAMPLE, 'provisional', 'Plate appearances / innings below which a line is not read at all.'),
    stamp('MATURE_SAMPLE', calibration.MATURE_SAMPLE, 'provisional', 'Sample at which the current-level line is treated as mature.'),
    stamp('LEAGUE_POPULATION_MINIMUM', calibration.LEAGUE_POPULATION_MINIMUM, 'provisional', 'Qualified players a league needs before a percentile in it means anything.'),
    stamp('YOUNG_FOR_LEVEL / OLD_FOR_LEVEL', `${calibration.YOUNG_FOR_LEVEL} / ${calibration.OLD_FOR_LEVEL}`, 'policy', 'Years from the level\'s rostered average age at which a man is young or old for it.'),
    stamp('AGE_LEVEL_DEVELOPMENT_LIMIT', calibration.AGE_LEVEL_DEVELOPMENT_LIMIT, 'policy', 'Years past the level average at which the assignment stops being a development question.'),
    stamp('UPPER_MINORS_DEPTH_FLOOR', calibration.UPPER_MINORS_DEPTH_FLOOR, 'policy', 'Upper-minors players at a position below which the organization is thin there.'),
    stamp('PRIORITY_CONGESTION_AT', calibration.PRIORITY_CONGESTION_AT, 'policy', 'Priority prospects on one path at one level past which the organization competes with itself.'),
    stamp('CASCADE_MAX_STEPS', calibration.CASCADE_MAX_STEPS, 'policy', 'Steps a chain is followed before it is speculation.'),
    stamp('RUNWAY_CLOSING_AGE', calibration.RUNWAY_CLOSING_AGE, 'policy', 'Age at which an ordinary developmental runway at a level is treated as closing.'),
    stamp('RUNWAY_SERVICE_LIMIT', calibration.RUNWAY_SERVICE_LIMIT, 'policy', 'Professional seasons past which a player at a low level has had his developmental look.'),
    /* Player Development's stakes constants: declared once in developmentFit.ts, reported here because they decide who can be squeezed. */
    ...STAKES_CALIBRATION.map((c) => stamp(c.name, c.value, c.stamp.status === 'policy' ? 'policy' : 'provisional', c.stamp.basis)),
  ];
}

/* ── the farm for the AI staff ───────────────────────────────────────────────────────────────── */

export interface FarmBriefing {
  scope: { players: number; affiliates: number; assessed: number; notAssessable: number };
  /** What needs a decision, most pressing first, as the workspace lists it. */
  attention: Array<{ kind: string; severity: string; headline: string; detail: string }>;
  /** Player Development's promotion-direction recommendations: one affiliate level, never a call-up. */
  promotionDirection: Array<{ name: string; age: number; level: string; team: string; recommendation: string }>;
  affiliates: Array<{ label: string; level: string; operational: string; games: number }>;
}

/**
 * The farm for the AI briefing and the storylines: the authoritative engine's own conclusions, with
 * their structure, so the model is not handed a superseded label and asked to correct the
 * architecture in prose.
 */
export function farmBriefing(
  orgId: number,
  prospects: { batters: unknown[]; pitchers: unknown[] },
  limit = 8
): FarmBriefing {
  const view = computeFarmSystem(orgId);
  const PROMOTION_DIRECTION = new Set(['consider_promotion', 'strong_promotion_case', 'mlb_ready_discussion']);
  type Row = { name?: string; age?: number; levelName?: string; team?: string; decision?: { recommendation?: string | null } | null };
  const promotionDirection = [...(prospects.batters as Row[]), ...(prospects.pitchers as Row[])]
    .filter((p) => PROMOTION_DIRECTION.has(String(p.decision?.recommendation ?? '')))
    .map((p) => ({
      name: String(p.name ?? ''),
      age: Number(p.age ?? 0),
      level: String(p.levelName ?? ''),
      team: String(p.team ?? ''),
      recommendation: String(p.decision?.recommendation),
    }));
  return {
    scope: {
      players: view.organization.scope.players,
      affiliates: view.affiliates.length,
      assessed: view.organization.scope.assessed,
      notAssessable: view.organization.scope.notAssessable,
    },
    attention: view.attention.slice(0, limit).map((a) => ({ kind: a.kind, severity: a.severity, headline: a.headline, detail: a.detail })),
    promotionDirection,
    affiliates: view.affiliates.map((a) => ({ label: a.label, level: a.levelName, operational: a.operational.status, games: a.games })),
  };
}
