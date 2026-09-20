import { db, tableColumns, tableExists } from './db.js';
import { POSITION_CODES } from './gloves.js';
import { screenAffiliatePlayers } from './rehabAssignments.js';
import { loadScoutedAbilities, scoutedGloves } from './scoutedEvidence.js';

export type RosterHealthStatus =
  | 'critical'
  | 'thin'
  | 'healthy'
  | 'surplus';

export interface RosterCoveragePlayer {
  playerId: number;
  name: string;
  listedPosition: string;
  rating: number | null;
  primary: boolean;
}

export interface PositionCoverage {
  position: string;
  playable: number;
  strong: number;
  emergency: number;
  status: RosterHealthStatus;
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
    bodyCountStatus: RosterHealthStatus;
    fieldablePositions: number;
    canFieldDefense: boolean;
    coverage: PositionCoverage[];
  };

  pitching: {
    bodyCountStatus: RosterHealthStatus;
    rotationStatus: RosterHealthStatus;
    bullpenStatus: RosterHealthStatus;

    /** OOTP role 11. */
    starters: number;

    /** OOTP roles 12 and 13. */
    relievers: number;
    closers: number;

    /** Supplemental stamina information, not roster-role classification. */
    starterStamina: number;
    longArmStamina: number;
    staminaKnown: number;
  };

  fatigue: {
    /*
     * Raw OOTP values only for now.
     * We have not yet established what thresholds mean clinically in-game.
     */
    averagePoints: number;
    maxPoints: number;
    nonzeroPlayers: number;
    playedToday: number;
  };

  overall: RosterHealthStatus;
  issues: string[];

  /**
   * Players on this affiliate's list who are not counted as ordinary members.
   * `rehab`: an explicit log shows a parent-club player on a rehab assignment;
   * he is excluded from every count above. `ambiguous`: a 40-man player nothing
   * explains, who may be on rehab or optioned: he IS counted (nothing establishes
   * otherwise) and is named here so the health above can be read as uncertain.
   */
  rosterTreatment: {
    rehab: Array<{ playerId: number; name: string }>;
    ambiguous: Array<{ playerId: number; name: string; reason: string }>;
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

/** Visible fielding grade at or above which a position counts as playable (shared with MLB Operations). */
export const PLAYABLE_RATING = 35;
const STRONG_RATING = 50;

/*
 * OOTP pitcher role codes, confirmed against the imported roster:
 * 11 = starter, 12 = reliever, 13 = closer.
 *
 * Stamina remains useful context, but role is the authoritative statement of
 * how the organization is currently using the pitcher.
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
  fatigue_points: number;
  fatigue_played_today: number;
  stamina: number | null;
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
      ${col('fatigue_points')} AS fatigue_points,
      ${col('fatigue_played_today')} AS fatigue_played_today`;
}

type PlayerRow = Omit<ActivePlayer, 'stamina'>;

type Treatment = AffiliateRosterHealth['rosterTreatment'];

function activePlayers(
  teamId: number,
  scenario: RosterHealthScenario = {}
): { players: ActivePlayer[]; treatment: Treatment } {
  if (!tableExists('players') || !tableExists('team_roster')) return { players: [], treatment: { rehab: [], ambiguous: [] } };

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
  };
  const rows = listed.filter((row) => !screen.rehab.has(row.player_id));

  const joining = (scenario.addPlayers ?? [])
    .filter((add) => add.teamId === teamId && !rows.some((row) => row.player_id === add.playerId))
    .map((add) => add.playerId);
  for (const id of joining) {
    const row = db.prepare(`SELECT ${playerColumns()} FROM players p WHERE p.player_id = ? AND p.retired = 0`).get(id) as
      | PlayerRow
      | undefined;
    if (row) rows.push(row);
  }

  /*
   * Who is active, and their health and workload, are objective facts read
   * above. Stamina is a visible-rating judgment, so it comes only from the
   * scouted-evidence adapter (on the 20-80 scale, unknown when not exported).
   */
  const abilities = loadScoutedAbilities(rows.map((row) => row.player_id));

  return {
    players: rows.map((row) => ({
      ...row,
      stamina: abilities.for(row.player_id).stamina,
    })),
    treatment,
  };
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

function bodyCountStatus(
  count: number,
  thinBelow: number,
  surplusAt: number
): RosterHealthStatus {
  if (count < thinBelow - 2) return 'critical';
  if (count < thinBelow) return 'thin';
  if (count >= surplusAt) return 'surplus';
  return 'healthy';
}

function rotationStatus(starters: number): RosterHealthStatus {
  if (starters < 4) return 'critical';
  if (starters === 4) return 'thin';
  if (starters >= 7) return 'surplus';
  return 'healthy';
}

function bullpenStatus(relievers: number): RosterHealthStatus {
  if (relievers < 5) return 'critical';
  if (relievers < 7) return 'thin';
  if (relievers >= 12) return 'surplus';
  return 'healthy';
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

  /*
   * Players with a revealed rating below PLAYABLE_RATING but who are not the
   * listed player are emergency-only. They do not make a position healthy.
   */
  const emergency = hitters.filter((hitter) => {
    const rating = hitter.ratings.get(position);
    return (
      rating !== undefined &&
      rating > 0 &&
      rating < PLAYABLE_RATING &&
      hitter.primary !== position
    );
  }).length;

  let status: RosterHealthStatus;

  if (candidates.length === 0) {
    status = 'critical';
  } else if (candidates.length === 1) {
    status = 'thin';
  } else if (candidates.length >= 4) {
    status = 'surplus';
  } else {
    status = 'healthy';
  }

  return {
    position,
    playable: candidates.length,
    strong,
    emergency,
    status,
    players: candidates,
  };
}

function overallStatus(
  positionBody: RosterHealthStatus,
  pitchingBody: RosterHealthStatus,
  rotation: RosterHealthStatus,
  bullpen: RosterHealthStatus,
  canFieldDefense: boolean,
  coverage: PositionCoverage[]
): RosterHealthStatus {
  const byPosition = new Map(
    coverage.map((position) => [position.position, position])
  );

  const criticalDefensivePosition = ['C', 'SS', 'CF'].some(
    (position) =>
      byPosition.get(position)?.status === 'critical'
  );

  const thinDefensivePosition = ['C', 'SS', 'CF'].some(
    (position) =>
      byPosition.get(position)?.status === 'thin'
  );

  if (
    !canFieldDefense ||
    positionBody === 'critical' ||
    pitchingBody === 'critical' ||
    rotation === 'critical' ||
    bullpen === 'critical' ||
    criticalDefensivePosition
  ) {
    return 'critical';
  }

  if (
    positionBody === 'thin' ||
    pitchingBody === 'thin' ||
    rotation === 'thin' ||
    bullpen === 'thin' ||
    thinDefensivePosition
  ) {
    return 'thin';
  }

  return 'healthy';
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

  /*
   * Twelve position players gives an eight-man defensive alignment plus four
   * additional bodies. Fewer than that begins creating recurring rest risk.
   *
   * These are V1 structural thresholds, deliberately isolated here so we can
   * tune them after seeing real organizations.
   */
  const hitterBodyStatus =
    bodyCountStatus(hitters.length, 12, 17);

  /*
   * We intentionally keep the pitching model conservative in V1.
   * Total arms are trustworthy. Stamina is also exported, but OOTP role usage
   * deserves validation before we pretend every stamina threshold is a true
   * rotation assignment.
   */
  const pitcherBodyStatus =
    bodyCountStatus(pitchers.length, 12, 18);

  const staminaKnown = pitchers.filter(
    (pitcher) => pitcher.stamina !== null
  );

  const starters = pitchers.filter(
    (pitcher) => Number(pitcher.role) === ROLE_STARTER
  ).length;

  const closers = pitchers.filter(
    (pitcher) => Number(pitcher.role) === ROLE_CLOSER
  ).length;

  const relievers = pitchers.filter(
    (pitcher) =>
      Number(pitcher.role) === ROLE_RELIEVER ||
      Number(pitcher.role) === ROLE_CLOSER
  ).length;

  const starterStamina = staminaKnown.filter(
    (pitcher) => Number(pitcher.stamina) >= 45
  ).length;

  const longArmStamina = staminaKnown.filter(
    (pitcher) => Number(pitcher.stamina) >= 35
  ).length;

  const rotationHealth = rotationStatus(starters);
  const bullpenHealth = bullpenStatus(relievers);

  const fatigueValues = roster.map(
    (player) => Number(player.fatigue_points ?? 0)
  );

  const averagePoints =
    fatigueValues.length > 0
      ? Math.round(
          (fatigueValues.reduce((a, b) => a + b, 0) /
            fatigueValues.length) *
            10
        ) / 10
      : 0;

  const maxPoints =
    fatigueValues.length > 0
      ? Math.max(...fatigueValues)
      : 0;

  const issues: string[] = [];

  if (!canFieldDefense) {
    issues.push(
      `Only ${fieldablePositions} of 8 defensive positions can be filled simultaneously by players with established coverage.`
    );
  }

  if (hitterBodyStatus === 'critical') {
    issues.push(
      `Only ${hitters.length} active position players; routine rest and injury coverage are at serious risk.`
    );
  } else if (hitterBodyStatus === 'thin') {
    issues.push(
      `Only ${hitters.length} active position players; the club has limited rest margin.`
    );
  }

  if (pitcherBodyStatus === 'critical') {
    issues.push(
      `Only ${pitchers.length} active pitchers; workload coverage is critically thin.`
    );
  } else if (pitcherBodyStatus === 'thin') {
    issues.push(
      `Only ${pitchers.length} active pitchers; pitching workload depth is thin.`
    );
  }

  for (const position of coverage) {
    if (position.status === 'critical') {
      issues.push(
        `No established playable coverage at ${position.position}.`
      );
    } else if (
      position.status === 'thin' &&
      ['C', 'SS', 'CF'].includes(position.position)
    ) {
      issues.push(
        `Only one established playable option at ${position.position}; regular rest or an injury would create a coverage problem.`
      );
    }
  }

  if (rotationHealth === 'critical') {
    issues.push(
      `Only ${starters} pitchers are assigned starting roles; the rotation cannot sustain a normal schedule.`
    );
  } else if (rotationHealth === 'thin') {
    issues.push(
      `Only ${starters} pitchers are assigned starting roles; rotation rest margin is thin.`
    );
  }

  if (bullpenHealth === 'critical') {
    issues.push(
      `Only ${relievers} pitchers are assigned relief roles; bullpen workload coverage is critically thin.`
    );
  } else if (bullpenHealth === 'thin') {
    issues.push(
      `Only ${relievers} pitchers are assigned relief roles; bullpen workload depth is thin.`
    );
  }

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
      bodyCountStatus: hitterBodyStatus,
      fieldablePositions,
      canFieldDefense,
      coverage,
    },

    pitching: {
      bodyCountStatus: pitcherBodyStatus,
      rotationStatus: rotationHealth,
      bullpenStatus: bullpenHealth,
      starters,
      relievers,
      closers,
      starterStamina,
      longArmStamina,
      staminaKnown: staminaKnown.length,
    },

    fatigue: {
      averagePoints,
      maxPoints,
      nonzeroPlayers: fatigueValues.filter(
        (value) => value !== 0
      ).length,
      playedToday: roster.filter(
        (player) =>
          Number(player.fatigue_played_today) !== 0
      ).length,
    },

    overall: overallStatus(
      hitterBodyStatus,
      pitcherBodyStatus,
      rotationHealth,
      bullpenHealth,
      canFieldDefense,
      coverage
    ),

    issues,
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
