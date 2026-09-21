import { db, tableColumns, tableExists } from './db.js';
import { INJURED_DAYS_NOT_COUNTED, PLAYABLE_GRADE, STRONG_GRADE } from './farmCalibration.js';
import { POSITION_CODES } from './gloves.js';
import { screenAffiliatePlayers } from './rehabAssignments.js';
import { scoutedGloves } from './scoutedEvidence.js';

/*
 * What an affiliate's active list is, counted: bodies, who can stand where, who is assigned to start
 * and to relieve, and who is not an ordinary member. It decides nothing. Whether the club is SHORT is
 * Minor League Operations' operational reading (`farmAffiliate.operationalReading`), which derives a
 * status from its findings; the role-code statuses and prose lines this module used to carry beside
 * the counts were a second, disagreeing description of the same club and are gone.
 */

export interface RosterCoveragePlayer {
  playerId: number;
  name: string;
  listedPosition: string;
  rating: number | null;
  primary: boolean;
}

export interface PositionCoverage {
  position: string;
  /** Men who can play it: a visible grade at or above the playable line, or listed there. */
  playable: number;
  /** Men with a visible grade at or above the strong line. */
  strong: number;
  players: RosterCoveragePlayer[];
}

export interface AffiliateRosterHealth {
  teamId: number;
  label: string;
  level: number;
  levelName: string;

  roster: {
    total: number;
    positionPlayers: number;
    pitchers: number;
    dayToDay: number;
  };

  positionPlayers: {
    fieldablePositions: number;
    canFieldDefense: boolean;
    coverage: PositionCoverage[];
  };

  pitching: {
    /** OOTP role 11. */
    starters: number;
    /** OOTP roles 12 and 13. */
    relievers: number;
  };

  /**
   * Players on this affiliate's list who are not counted as ordinary members.
   * `rehab`: an explicit log shows a parent-club player on a rehab assignment;
   * he is excluded from every count above. `ambiguous`: a 40-man player nothing
   * explains, who may be on rehab or optioned: he IS counted (nothing establishes
   * otherwise) and is named here so the health above can be read as uncertain.
   * `injured`: a player with a real injury (not day-to-day) cannot cover a
   * position or take a start today, so he is excluded from the counts above and
   * named here with the days the export gives him.
   */
  rosterTreatment: {
    rehab: Array<{ playerId: number; name: string }>;
    ambiguous: Array<{ playerId: number; name: string; reason: string }>;
    injured: Array<{ playerId: number; name: string; listedPosition: string; daysLeft: number | null }>;
  };
}

const LEVEL_NAMES: Record<number, string> = {
  1: 'MLB',
  2: 'AAA',
  3: 'AA',
  4: 'A',
  5: 'SA',
  6: 'R',
};

const DEFENSIVE_POSITIONS = [
  'C',
  '1B',
  '2B',
  '3B',
  'SS',
  'LF',
  'CF',
  'RF',
] as const;

type DefensivePosition = typeof DEFENSIVE_POSITIONS[number];

/**
 * Visible fielding grade at or above which a position counts as playable. The number is declared
 * once, in `farmCalibration.ts`; this name is kept for MLB Operations' adapter, which reads it here.
 */
export const PLAYABLE_RATING: number = PLAYABLE_GRADE;
const STRONG_RATING: number = STRONG_GRADE;

/*
 * OOTP pitcher role codes, confirmed against the imported roster:
 * 11 = starter, 12 = reliever, 13 = closer. The role is what the organization has him assigned as;
 * the farm's rotation finding counts the men actually taking the starts.
 */
const ROLE_STARTER = 11;
const ROLE_RELIEVER = 12;
const ROLE_CLOSER = 13;

interface ActivePlayer {
  player_id: number;
  first_name: string;
  last_name: string;
  position: number;
  role: number;
  injury_is_injured: number;
  injury_dtd_injury: number;
  injury_left: number | null;
}

interface Affiliate {
  team_id: number;
  name: string;
  nickname: string;
  level: number;
}

interface HitterEligibility {
  player: ActivePlayer;
  name: string;
  listedPosition: string;
  playable: Set<DefensivePosition>;
  ratings: Map<DefensivePosition, number>;
  primary: DefensivePosition | null;
}

function affiliateLabel(team: Affiliate): string {
  return team.name === team.nickname
    ? team.name
    : `${team.name} ${team.nickname}`;
}

/**
 * Read the real affiliate tree rather than assuming one club at each level.
 * This matters for organizations with multiple A or rookie clubs.
 */
function affiliates(orgId: number): Affiliate[] {
  if (!tableExists('teams')) return [];

  return db.prepare(`
    WITH RECURSIVE org AS (
      SELECT team_id, name, nickname, level
      FROM teams
      WHERE team_id = ?

      UNION ALL

      SELECT t.team_id, t.name, t.nickname, t.level
      FROM teams t
      JOIN org o ON t.parent_team_id = o.team_id
    )
    SELECT DISTINCT team_id, name, nickname, level
    FROM org
    WHERE team_id != ?
    ORDER BY level, team_id
  `).all(orgId, orgId) as Affiliate[];
}

/**
 * A read-only "what would this affiliate look like" scenario. It can only take
 * known players off an affiliate's active roster and add known players to it;
 * it never changes an imported roster, and it says nothing about whether the
 * moves are allowed (Player Rights) or defensible (Player Development).
 */
export interface RosterHealthScenario {
  /** Players who leave whichever affiliate's active roster they are on. */
  removePlayerIds?: readonly number[];
  /** Players who join an affiliate's active roster (e.g. an optioned MLB player). */
  addPlayers?: readonly { playerId: number; teamId: number }[];
  /** Compute only these affiliates (a cost limit, not a filter on evidence). */
  onlyTeamIds?: readonly number[];
}

/** The player columns the health evaluator reads; a column an export lacks is read as 0, not a failure. */
function playerColumns(): string {
  const present = new Set(tableColumns('players'));
  const col = (name: string) => (present.has(name) ? `COALESCE(p.${name}, 0)` : '0');
  return `
      p.player_id,
      p.first_name,
      p.last_name,
      p.position,
      p.role,
      ${col('injury_is_injured')} AS injury_is_injured,
      ${col('injury_dtd_injury')} AS injury_dtd_injury,
      ${present.has('injury_left') ? 'p.injury_left' : 'NULL'} AS injury_left`;
}

type PlayerRow = ActivePlayer;

/**
 * Injured for longer than the operational reading's week. OOTP sets the day-to-day bit on most
 * minor-league injuries whatever their length (two days and a thousand alike on the real import), so
 * the days are what decide it; an injured man whose days are not exported is treated as out.
 */
export const isInjured = (row: { injury_is_injured: number | null; injury_left: number | null }): boolean =>
  Number(row.injury_is_injured ?? 0) !== 0 && (row.injury_left === null || Number(row.injury_left) > INJURED_DAYS_NOT_COUNTED);

type Treatment = AffiliateRosterHealth['rosterTreatment'];

function activePlayers(
  teamId: number,
  scenario: RosterHealthScenario = {}
): { players: ActivePlayer[]; treatment: Treatment } {
  if (!tableExists('players') || !tableExists('team_roster')) return { players: [], treatment: { rehab: [], ambiguous: [], injured: [] } };

  const removed = new Set(scenario.removePlayerIds ?? []);
  const listed = (db.prepare(`
    SELECT ${playerColumns()}
    FROM players p
    JOIN team_roster tr
      ON tr.team_id = ?
     AND tr.player_id = p.player_id
     AND tr.list_id = 2
    WHERE p.team_id = ?
      AND p.retired = 0
  `).all(teamId, teamId) as PlayerRow[]).filter((row) => !removed.has(row.player_id));

  // A rehab assignee is a parent-club player, not an ordinary member of this club (rehabAssignments.ts).
  const screen = screenAffiliatePlayers(listed.map((row) => row.player_id));
  const nameOf = (row: PlayerRow) => `${row.first_name} ${row.last_name}`;
  const treatment: Treatment = {
    rehab: listed.filter((row) => screen.rehab.has(row.player_id)).map((row) => ({ playerId: row.player_id, name: nameOf(row) })),
    ambiguous: listed.filter((row) => screen.ambiguous.has(row.player_id))
      .map((row) => ({ playerId: row.player_id, name: nameOf(row), reason: screen.ambiguous.get(row.player_id) as string })),
    injured: [],
  };
  /*
   * An injury of more than a week takes a man off the field for the schedule the reading is about.
   * He is excluded: an active list that counts an injured shortstop as its shortstop cover is
   * describing a club that cannot take the field. A two-day injury is counted and shows as day-to-day.
   */
  const injuredRows = listed.filter((row) => !screen.rehab.has(row.player_id) && isInjured(row));
  treatment.injured = injuredRows.map((row) => ({
    playerId: row.player_id,
    name: nameOf(row),
    listedPosition: POSITION_CODES[row.position - 1] ?? '—',
    daysLeft: row.injury_left === null || row.injury_left === undefined ? null : Number(row.injury_left),
  }));
  const injured = new Set(injuredRows.map((row) => row.player_id));
  const rows = listed.filter((row) => !screen.rehab.has(row.player_id) && !injured.has(row.player_id));

  const joining = (scenario.addPlayers ?? [])
    .filter((add) => add.teamId === teamId && !rows.some((row) => row.player_id === add.playerId))
    .map((add) => add.playerId);
  for (const id of joining) {
    const row = db.prepare(`SELECT ${playerColumns()} FROM players p WHERE p.player_id = ? AND p.retired = 0`).get(id) as
      | PlayerRow
      | undefined;
    if (row) rows.push(row);
  }

  return { players: rows, treatment };
}

function hitterEligibility(player: ActivePlayer): HitterEligibility {
  const profile = scoutedGloves(player.player_id);

  const listed =
    POSITION_CODES[player.position - 1] ?? '—';

  const playable = new Set<DefensivePosition>();
  const ratings = new Map<DefensivePosition, number>();

  if (profile) {
    for (const position of profile.positions) {
      const code = position.code as DefensivePosition;

      if (!DEFENSIVE_POSITIONS.includes(code)) continue;

      ratings.set(code, position.current);

      if (position.current >= PLAYABLE_RATING) {
        playable.add(code);
      }
    }
  }

  /*
   * His listed position is observable roster information even if the precise
   * defensive grade is hidden or below our generic playable threshold.
   *
   * We therefore allow a listed position to satisfy basic coverage without
   * inventing a rating for it.
   */
  let primary: DefensivePosition | null = null;

  if (
    DEFENSIVE_POSITIONS.includes(
      listed as DefensivePosition
    )
  ) {
    primary = listed as DefensivePosition;
    playable.add(primary);
  }

  return {
    player,
    name: `${player.first_name} ${player.last_name}`,
    listedPosition: listed,
    playable,
    ratings,
    primary,
  };
}

/**
 * Maximum bipartite matching between players and the eight fielding positions.
 *
 * This prevents one utility infielder from being counted as though he could
 * simultaneously cover 2B, 3B and SS.
 */
function maximumFieldablePositions(
  hitters: HitterEligibility[]
): number {
  const assigned = new Map<DefensivePosition, number>();

  function assign(
    hitterIndex: number,
    seen: Set<DefensivePosition>
  ): boolean {
    for (const position of hitters[hitterIndex].playable) {
      if (seen.has(position)) continue;
      seen.add(position);

      const existing = assigned.get(position);

      if (
        existing === undefined ||
        assign(existing, seen)
      ) {
        assigned.set(position, hitterIndex);
        return true;
      }
    }

    return false;
  }

  let matched = 0;

  for (let i = 0; i < hitters.length; i++) {
    if (assign(i, new Set())) matched++;
  }

  return Math.min(matched, DEFENSIVE_POSITIONS.length);
}

function positionCoverage(
  position: DefensivePosition,
  hitters: HitterEligibility[]
): PositionCoverage {
  const candidates = hitters
    .filter((hitter) => hitter.playable.has(position))
    .map((hitter) => {
      const rating = hitter.ratings.get(position) ?? null;

      return {
        playerId: hitter.player.player_id,
        name: hitter.name,
        listedPosition: hitter.listedPosition,
        rating,
        primary: hitter.primary === position,
      };
    })
    .sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      return (b.rating ?? 0) - (a.rating ?? 0);
    });

  const strong = candidates.filter(
    (candidate) =>
      candidate.rating !== null &&
      candidate.rating >= STRONG_RATING
  ).length;

  return {
    position,
    playable: candidates.length,
    strong,
    players: candidates,
  };
}

function computeAffiliate(
  team: Affiliate,
  scenario: RosterHealthScenario
): AffiliateRosterHealth {
  const { players: roster, treatment } = activePlayers(team.team_id, scenario);

  const hittersRaw = roster.filter(
    (player) => player.position !== 1
  );

  const pitchers = roster.filter(
    (player) => player.position === 1
  );

  const hitters = hittersRaw.map(hitterEligibility);

  const coverage = DEFENSIVE_POSITIONS.map((position) =>
    positionCoverage(position, hitters)
  );

  const fieldablePositions =
    maximumFieldablePositions(hitters);

  const canFieldDefense =
    fieldablePositions === DEFENSIVE_POSITIONS.length;

  const starters = pitchers.filter(
    (pitcher) => Number(pitcher.role) === ROLE_STARTER
  ).length;

  const relievers = pitchers.filter(
    (pitcher) =>
      Number(pitcher.role) === ROLE_RELIEVER ||
      Number(pitcher.role) === ROLE_CLOSER
  ).length;

  const dayToDay = roster.filter(
    (player) =>
      Number(player.injury_is_injured) !== 0 ||
      Number(player.injury_dtd_injury) !== 0
  ).length;

  return {
    teamId: team.team_id,
    label: affiliateLabel(team),
    level: team.level,
    levelName:
      LEVEL_NAMES[team.level] ?? `L${team.level}`,

    roster: {
      total: roster.length,
      positionPlayers: hitters.length,
      pitchers: pitchers.length,
      dayToDay,
    },

    positionPlayers: {
      fieldablePositions,
      canFieldDefense,
      coverage,
    },

    pitching: {
      starters,
      relievers,
    },

    rosterTreatment: treatment,
  };
}

export function computeMinorLeagueRosterHealth(
  orgId: number,
  scenario: RosterHealthScenario = {}
): AffiliateRosterHealth[] {
  const only = scenario.onlyTeamIds ? new Set(scenario.onlyTeamIds) : null;
  return affiliates(orgId)
    .filter((team) => !only || only.has(team.team_id))
    .map((team) => computeAffiliate(team, scenario));
}
