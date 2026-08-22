import {
  db,
  tableColumns,
  tableExists,
} from './db.js';

import {
  gloves,
  POSITION_CODES,
} from './gloves.js';

import {
  computeMinorLeagueRosterHealth,
  type AffiliateRosterHealth,
  type RosterHealthStatus,
} from './minorLeagueRoster.js';

import {
  canUseAsRegularAssignment,
  evaluateDevelopmentProtection,
  evaluatePositionAssignments,
  type DevelopmentProtection,
  type PositionAssignmentFit,
} from './developmentFit.js';

import {
  resolvePhilosophy,
} from './philosophy.js';

import {
  philosophyForOrg,
} from './settings.js';

const POSITIONS = [
  'C',
  '1B',
  '2B',
  '3B',
  'SS',
  'LF',
  'CF',
  'RF',
] as const;

type PositionCode = typeof POSITIONS[number];

export type MinorLeagueMoveKind =
  | 'same_level_reassignment'
  | 'normal_promotion'
  | 'skip_level_promotion'
  | 'demotion';

export interface MinorLeagueOperationsPhilosophy {
  prospectPreservation: number;
  promotionAggressiveness: number;
  rosterDepth: number;
  versatility: number;
  positionalScarcity: number;
  upsidePreference: number;
  ageCurveSensitivity: number;
}

const PLAYABLE_RATING = 35;
const MAX_MOVES = 3;

interface Hitter {
  playerId: number;
  name: string;
  age: number;
  teamId: number;
  listedPosition: PositionCode | null;

  current: number | null;
  potential: number | null;

  coverage: Set<PositionCode>;
  assignments: PositionAssignmentFit[];
  protection: DevelopmentProtection;
}

interface PositionAssessment {
  bodyStatus: RosterHealthStatus;
  fieldablePositions: number;
  coverage: Record<PositionCode, number>;
  structuralStatus: 'critical' | 'thin' | 'healthy';
}

export interface MinorLeagueReassignment {
  playerId: number;
  playerName: string;
  age: number;

  kind: MinorLeagueMoveKind;

  fromTeamId: number;
  fromTeam: string;
  toTeamId: number;
  toTeam: string;

  protection: DevelopmentProtection;

  development: {
    authorizedBy:
      | 'development_protection'
      | 'prospect_assignment_engine';

    recommendation: string | null;

    destinationFit: {
      classification:
        | 'poor'
        | 'borderline'
        | 'viable'
        | 'strong';

      compositePercentile: number;
      weakestCorePercentile: number;
    } | null;

    reasons: string[];
  };

  philosophy: {
    adjustment: number;
    reasons: string[];
  };

  assignment: {
    position: string;
    fit: number;
    use: string;
  };

  /** All positions this player can credibly cover on the roster. */
  coverage: string[];

  reasons: string[];
}

export interface MinorLeaguePlanAlternative {
  rank: number;
  score: number;

  moves: Array<{
    playerId: number;
    playerName: string;
    fromTeam: string;

    kind: MinorLeagueMoveKind;
    developmentRecommendation: string | null;
    philosophyAdjustment: number;

    protectionTier: string;
    protectionScore: number;

    assignment: string;
    assignmentFit: number;
    coverage: string[];

    assignmentNeed: number;
    coverageBenefit: number;
    concentrationPenalty: number;
  }>;
}

export interface MinorLeagueRebalancePlan {
  teamId: number;
  team: string;
  level: number;
  levelName: string;

  before: {
    overall: string;
    positionPlayers: number;
  };

  after: {
    overall: string;
    positionPlayers: number;
  };

  moves: MinorLeagueReassignment[];

  /** Lower is better. Used for comparison, not as a baseball grade. */
  selectionScore: number;

  /** Other minimum-move solutions considered by the optimizer. */
  alternatives: MinorLeaguePlanAlternative[];

  summary: string[];
}

export interface MinorLeagueRejectedMove {
  playerId: number;
  playerName: string;

  kind: MinorLeagueMoveKind;

  fromTeamId: number;
  fromTeam: string;

  toTeamId: number;
  toTeam: string;

  phase:
    | 'development'
    | 'operations';

  reasons: string[];
}

export interface MinorLeagueRebalanceResult {
  orgId: number;

  /** Philosophy values actually used by this operations pass. */
  philosophy: MinorLeagueOperationsPhilosophy;

  plans: MinorLeagueRebalancePlan[];

  deferred: Array<{
    teamId: number;
    team: string;
    reason: string;
  }>;

  /**
   * Prospect moves considered because they point at a roster-need destination
   * but were unavailable to the operations optimizer.
   */
  rejected: MinorLeagueRejectedMove[];

  safeguards: string[];
}

function nullableRating(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hitterBodyStatus(count: number): RosterHealthStatus {
  if (count < 10) return 'critical';
  if (count < 12) return 'thin';
  if (count >= 17) return 'surplus';
  return 'healthy';
}

function coverageStatus(count: number): RosterHealthStatus {
  if (count <= 0) return 'critical';
  if (count === 1) return 'thin';
  if (count >= 4) return 'surplus';
  return 'healthy';
}

function maximumFieldablePositions(hitters: Hitter[]): number {
  const assigned = new Map<PositionCode, number>();

  function assign(
    hitterIndex: number,
    seen: Set<PositionCode>
  ): boolean {
    for (const position of hitters[hitterIndex].coverage) {
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

  return Math.min(matched, POSITIONS.length);
}

function assessPositionRoster(
  hitters: Hitter[]
): PositionAssessment {
  const coverage = Object.fromEntries(
    POSITIONS.map((position) => [position, 0])
  ) as Record<PositionCode, number>;

  for (const hitter of hitters) {
    for (const position of hitter.coverage) {
      coverage[position]++;
    }
  }

  const bodyStatus = hitterBodyStatus(hitters.length);
  const fieldablePositions =
    maximumFieldablePositions(hitters);

  const priorityPositions: PositionCode[] = [
    'C',
    'SS',
    'CF',
  ];

  const criticalPriority = priorityPositions.some(
    (position) =>
      coverageStatus(coverage[position]) === 'critical'
  );

  const thinPriority = priorityPositions.some(
    (position) =>
      coverageStatus(coverage[position]) === 'thin'
  );

  let structuralStatus:
    | 'critical'
    | 'thin'
    | 'healthy';

  if (
    fieldablePositions < 8 ||
    bodyStatus === 'critical' ||
    criticalPriority
  ) {
    structuralStatus = 'critical';
  } else if (
    bodyStatus === 'thin' ||
    thinPriority
  ) {
    structuralStatus = 'thin';
  } else {
    structuralStatus = 'healthy';
  }

  return {
    bodyStatus,
    fieldablePositions,
    coverage,
    structuralStatus,
  };
}

function pitchingRisk(
  team: AffiliateRosterHealth
): 'critical' | 'thin' | 'healthy' {
  const states = [
    team.pitching.bodyCountStatus,
    team.pitching.rotationStatus,
    team.pitching.bullpenStatus,
  ];

  if (states.includes('critical')) return 'critical';
  if (states.includes('thin')) return 'thin';

  return 'healthy';
}

function combinedStatus(
  position: PositionAssessment,
  team: AffiliateRosterHealth
): 'critical' | 'thin' | 'healthy' {
  const pitching = pitchingRisk(team);

  if (
    position.structuralStatus === 'critical' ||
    pitching === 'critical'
  ) {
    return 'critical';
  }

  if (
    position.structuralStatus === 'thin' ||
    pitching === 'thin'
  ) {
    return 'thin';
  }

  return 'healthy';
}

function severity(
  status: 'critical' | 'thin' | 'healthy'
): number {
  if (status === 'critical') return 2;
  if (status === 'thin') return 1;
  return 0;
}

function valueColumns(): {
  join: string;
  current: string;
  potential: string;
} {
  if (!tableExists('players_value')) {
    return {
      join: '',
      current: 'NULL',
      potential: 'NULL',
    };
  }

  const columns = tableColumns('players_value');

  const current = columns.includes('oa')
    ? 'v.oa'
    : columns.includes('oa_rating')
      ? 'v.oa_rating'
      : 'NULL';

  const potential = columns.includes('pot')
    ? 'v.pot'
    : columns.includes('pot_rating')
      ? 'v.pot_rating'
      : 'NULL';

  return {
    join:
      'LEFT JOIN players_value v ON v.player_id = p.player_id',
    current,
    potential,
  };
}

function hittersForTeam(teamId: number): Hitter[] {
  const values = valueColumns();

  const rows = db.prepare(`
    SELECT
      p.player_id,
      p.first_name,
      p.last_name,
      p.age,
      p.team_id,
      p.position,
      ${values.current} AS current_rating,
      ${values.potential} AS potential_rating
    FROM players p
    JOIN team_roster tr
      ON tr.team_id = p.team_id
     AND tr.player_id = p.player_id
     AND tr.list_id = 1
    ${values.join}
    WHERE p.team_id = ?
      AND p.retired = 0
      AND p.position != 1
  `).all(teamId) as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const playerId = Number(row.player_id);
    const listedRaw =
      POSITION_CODES[Number(row.position) - 1];

    const listedPosition =
      POSITIONS.includes(listedRaw as PositionCode)
        ? listedRaw as PositionCode
        : null;

    const profile = gloves(playerId);

    const coverage = new Set<PositionCode>();

    if (profile) {
      for (const position of profile.positions) {
        const code = position.code as PositionCode;

        if (!POSITIONS.includes(code)) continue;

        if (
          position.current >= PLAYABLE_RATING ||
          position.isPrimary
        ) {
          coverage.add(code);
        }
      }
    }

    if (listedPosition) {
      coverage.add(listedPosition);
    }

    let assignments =
      evaluatePositionAssignments(profile);

    /*
     * Listed position is observable even if OOTP does not expose a numeric
     * grade. Preserve it as the player's preferred developmental assignment.
     */
    if (
      listedPosition &&
      !assignments.some(
        (assignment) =>
          assignment.code === listedPosition
      )
    ) {
      assignments = [
        {
          position: Number(row.position),
          code: listedPosition,
          currentRating: 0,
          experience: 0,
          isPrimary: true,
          fit: 100,
          use: 'preferred',
          reasons: ['Listed primary position.'],
        },
        ...assignments,
      ];
    }

    const current =
      nullableRating(row.current_rating);

    const potential =
      nullableRating(row.potential_rating);

    const protection =
      evaluateDevelopmentProtection({
        age: Number(row.age),
        current,
        potential,
      });

    return {
      playerId,
      name: `${row.first_name} ${row.last_name}`,
      age: Number(row.age),
      teamId: Number(row.team_id),
      listedPosition,
      current,
      potential,
      coverage,
      assignments,
      protection,
    };
  });
}

function teamMap(
  health: AffiliateRosterHealth[]
): Map<number, Hitter[]> {
  return new Map(
    health.map((team) => [
      team.teamId,
      hittersForTeam(team.teamId),
    ])
  );
}

function cloneTeamMap(
  source: Map<number, Hitter[]>
): Map<number, Hitter[]> {
  return new Map(
    [...source.entries()].map(
      ([teamId, players]) => [
        teamId,
        [...players],
      ]
    )
  );
}

function assignmentNeed(
  position: PositionCode,
  destination: Hitter[]
): number {
  const count = destination.filter(
    (player) =>
      player.coverage.has(position)
  ).length;

  /*
   * Need falls sharply once a position has genuine rest coverage.
   *
   * Zero = cannot cover the position.
   * One  = one injury/day off creates a problem.
   * Two  = structurally healthy; additional players are useful only as part
   *        of broader roster flexibility.
   *
   * This prevents the optimizer from treating a third catcher as nearly as
   * valuable as fixing an actual one-player shortstop or center-field group.
   */
  if (count === 0) return 100;
  if (count === 1) return 90;
  if (count === 2) return 30;
  if (count === 3) return 10;

  return 0;
}

function rosterCoverageBenefit(
  player: Hitter,
  destination: Hitter[]
): number {
  /*
   * Reward players who improve more than one useful area.
   *
   * For routine body-count balancing, a utility player who legitimately covers
   * SS/2B/3B is more useful than adding a third specialist catcher when
   * catching is already healthy.
   */
  let benefit = 0;

  for (const position of player.coverage) {
    benefit += assignmentNeed(
      position,
      destination
    );
  }

  return benefit;
}

function concentrationPenalty(
  assignment: PositionAssignmentFit,
  destination: Hitter[]
): number {
  const position =
    assignment.code as PositionCode;

  const count = destination.filter(
    (player) =>
      player.coverage.has(position)
  ).length;

  /*
   * Catchers are particularly poor generic roster-fillers once the club
   * already has two. For other positions, discourage piling into already
   * well-covered groups without making versatility itself a negative.
   */
  if (position === 'C') {
    if (count >= 4) return 80;
    if (count === 3) return 55;
    if (count === 2) return 35;
  }

  if (count >= 5) return 35;
  if (count === 4) return 20;
  if (count === 3) return 10;

  return 0;
}

function bestAssignment(
  player: Hitter,
  destination: Hitter[]
): PositionAssignmentFit | null {
  const allowed = player.assignments.filter(
    (assignment) =>
      canUseAsRegularAssignment(
        player.protection,
        assignment
      )
  );

  if (!allowed.length) return null;

  const coverageBenefit =
    rosterCoverageBenefit(
      player,
      destination
    );

  const ranked = allowed
    .map((assignment) => {
      const need = assignmentNeed(
        assignment.code as PositionCode,
        destination
      );

      const penalty =
        concentrationPenalty(
          assignment,
          destination
        );

      return {
        assignment,
        need,
        score:
          assignment.fit * 0.45 +
          need * 0.30 +
          Math.min(100, coverageBenefit) * 0.25 -
          penalty,
      };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.assignment ?? null;
}

function developmentMoveAllowed(
  player: Hitter,
  assignment: PositionAssignmentFit,
  destination: Hitter[]
): {
  allowed: boolean;
  reason?: string;
} {
  /*
   * Core prospects are never used to solve an ordinary roster imbalance.
   * A later development-specific tool may recommend moving them for their own
   * development, but that is a different decision.
   */
  if (player.protection.tier === 'core_prospect') {
    return {
      allowed: false,
      reason:
        'Core prospect protected from roster-filler reassignment.',
    };
  }

  const destinationCount =
    destination.filter((candidate) =>
      candidate.coverage.has(
        assignment.code as PositionCode
      )
    ).length;

  /*
   * Protected prospects may be reassigned at the same level when the new club
   * gives them a legitimate role. Do not move one into an already crowded
   * position merely because the destination needs another warm body.
   */
  if (
    player.protection.tier ===
      'protected_prospect' &&
    destinationCount >= 3
  ) {
    return {
      allowed: false,
      reason:
        `Protected prospect would enter a crowded ${assignment.code} group.`,
    };
  }

  return { allowed: true };
}

function teamLabel(
  team: AffiliateRosterHealth
): string {
  return team.label;
}

function operationsPhilosophyForOrg(
  orgId: number
): MinorLeagueOperationsPhilosophy {
  const philosophy =
    resolvePhilosophy(
      philosophyForOrg(orgId)
    );

  return {
    prospectPreservation:
      philosophy.dimensions
        .prospectPreservation.value,

    promotionAggressiveness:
      philosophy.dimensions
        .promotionAggressiveness.value,

    rosterDepth:
      philosophy.dimensions
        .rosterDepth.value,

    versatility:
      philosophy.dimensions
        .versatility.value,

    positionalScarcity:
      philosophy.dimensions
        .positionalScarcity.value,

    upsidePreference:
      philosophy.dimensions
        .upsidePreference.value,

    ageCurveSensitivity:
      philosophy.dimensions
        .ageCurveSensitivity.value,
  };
}

function centeredPreference(
  value: number
): number {
  return Math.max(
    -1,
    Math.min(
      1,
      (value - 50) / 50
    )
  );
}

function scarceCoverageNeedValue(
  player: Hitter,
  destination: Hitter[]
): number {
  let value = 0;

  for (
    const position of
    ['C', 'SS', 'CF'] as PositionCode[]
  ) {
    if (
      !player.coverage.has(position)
    ) {
      continue;
    }

    const count =
      destination.filter(
        (candidate) =>
          candidate.coverage.has(position)
      ).length;

    if (count === 0) {
      value += 2;
    } else if (count === 1) {
      value += 1;
    }
  }

  return value;
}

interface ProspectAssignmentLike {
  kind:
    | 'normal_promotion'
    | 'skip_level_promotion'
    | 'demotion'
    | 'mlb_discussion';

  eligible: boolean;
  recommendation: string;

  target: {
    level: number;
    levelName: string;

    teams: Array<{
      teamId: number;
      label: string;
    }>;

    isMajorLeague: boolean;
  };

  reasons: string[];
  blockers: string[];

  destinationFit?: {
    teams: Array<{
      fit: {
        destinationTeamId: number;
        destinationTeam: string;

        kind: string;

        compositePercentile: number;
        weakestCorePercentile: number;

        classification:
          | 'poor'
          | 'borderline'
          | 'viable'
          | 'strong';
      };

      gate: {
        passes: boolean;
      } | null;
    }>;

    eligibleTeamIds: number[];
  } | null;
}

interface ProspectLike {
  player_id: number;
  team_id: number;

  name: string;
  age: number;

  assignments?: {
    evaluations: ProspectAssignmentLike[];
    eligible: ProspectAssignmentLike[];
  };
}

interface ProspectDataLike {
  batters: unknown[];
  pitchers: unknown[];
}

interface DevelopmentAuthorization {
  authorizedBy:
    | 'development_protection'
    | 'prospect_assignment_engine';

  recommendation: string | null;

  destinationFit: {
    classification:
      | 'poor'
      | 'borderline'
      | 'viable'
      | 'strong';

    compositePercentile: number;
    weakestCorePercentile: number;
  } | null;

  reasons: string[];
}

interface SearchCandidate {
  kind: MinorLeagueMoveKind;

  player: Hitter;
  source: AffiliateRosterHealth;
  destination: AffiliateRosterHealth;

  development: DevelopmentAuthorization;
}

interface SearchMove extends SearchCandidate {
  assignment: PositionAssignmentFit;

  /**
   * Marginal value at the moment this player is added.
   * The second move sees the roster after move one.
   */
  coverageBenefit: number;
  concentrationPenalty: number;
  assignmentNeed: number;

  /** Position-player depth remaining at the source after this move. */
  sourceDepthMarginAfter: number;

  /** Useful C/SS/CF shortage coverage supplied to the destination. */
  scarceCoverageValue: number;
}

interface RankedSearchPlan {
  moves: SearchMove[];
  score: number;
}

interface PlanSearchResult {
  plans: RankedSearchPlan[];
  rejected: MinorLeagueRejectedMove[];
}

function sameLevelProtectionCost(
  protection: DevelopmentProtection,
  philosophy: MinorLeagueOperationsPhilosophy
): number {
  const base =
    protection.tier ===
      'organizational_depth'
      ? 0
      : protection.tier ===
          'normal'
        ? 10
        : protection.tier ===
            'development_priority'
          ? 30
          : protection.tier ===
              'protected_prospect'
            ? 60
            : 1000;

  /*
   * At neutral philosophy this changes nothing.
   *
   * High prospect preservation makes ordinary developmental assets more
   * expensive to move for convenience. Organizational depth remains free to
   * redistribute because there is little developmental asset to protect.
   */
  const factor =
    1 +
    centeredPreference(
      philosophy.prospectPreservation
    ) * 0.5;

  return base * factor;
}

function destinationStretchCost(
  development: DevelopmentAuthorization
): number {
  const fit =
    development.destinationFit;

  if (!fit) {
    return 10;
  }

  switch (fit.classification) {
    case 'strong':
      return -10;

    case 'viable':
      return 0;

    case 'borderline':
      return 15;

    case 'poor':
      return 30;
  }
}

function baseDevelopmentCost(
  candidate: SearchCandidate,
  philosophy: MinorLeagueOperationsPhilosophy
): number {
  if (
    candidate.kind ===
    'same_level_reassignment'
  ) {
    return sameLevelProtectionCost(
      candidate.player.protection,
      philosophy
    );
  }

  if (
    candidate.kind ===
    'normal_promotion'
  ) {
    const evidenceCost =
      candidate.development
        .recommendation === 'strong'
        ? -10
        : 10;

    return (
      evidenceCost +
      destinationStretchCost(
        candidate.development
      )
    );
  }

  if (
    candidate.kind ===
    'skip_level_promotion'
  ) {
    return 25;
  }

  return 35;
}

interface PhilosophyInfluence {
  adjustment: number;
  reasons: string[];
}

function philosophyInfluence(
  move: SearchMove,
  philosophy: MinorLeagueOperationsPhilosophy
): PhilosophyInfluence {
  let adjustment = 0;
  const reasons: string[] = [];

  const add = (
    amount: number,
    reason: string
  ) => {
    if (
      !Number.isFinite(amount) ||
      Math.abs(amount) < 0.25
    ) {
      return;
    }

    adjustment += amount;

    reasons.push(
      `${reason} (${amount >= 0 ? '+' : ''}${amount.toFixed(1)}).`
    );
  };

  /*
   * Promotion aggressiveness only ranks promotions that Player Development has
   * ALREADY declared legal. It never changes eligibility here.
   */
  if (
    move.kind ===
      'normal_promotion'
  ) {
    add(
      -centeredPreference(
        philosophy.promotionAggressiveness
      ) * 8,
      'Promotion aggressiveness'
    );
  }

  if (
    move.kind ===
      'skip_level_promotion'
  ) {
    add(
      -centeredPreference(
        philosophy.promotionAggressiveness
      ) * 4,
      'Promotion aggressiveness'
    );

    add(
      centeredPreference(
        philosophy.prospectPreservation
      ) * 10,
      'Prospect preservation makes a level skip more consequential'
    );
  }

  /*
   * A preservation-oriented organization is more reluctant to demote a player
   * who still carries meaningful developmental value, even when demotion is a
   * legally defensible option.
   */
  if (
    move.kind === 'demotion'
  ) {
    const protectionWeight =
      move.player.protection.tier ===
        'core_prospect'
        ? 1
        : move.player.protection.tier ===
            'protected_prospect'
          ? 0.8
          : move.player.protection.tier ===
              'development_priority'
            ? 0.5
            : move.player.protection.tier ===
                'normal'
              ? 0.25
              : 0;

    add(
      centeredPreference(
        philosophy.prospectPreservation
      ) *
        15 *
        protectionWeight,
      'Prospect preservation'
    );
  }

  /*
   * Source depth.
   *
   * Merely remaining technically healthy is not identical to retaining the
   * depth an organization values. The penalty only becomes meaningful when a
   * move leaves fewer than three position players above our 12-player healthy
   * body-count floor.
   */
  const depthPressure =
    Math.max(
      0,
      3 - move.sourceDepthMarginAfter
    );

  add(
    centeredPreference(
      philosophy.rosterDepth
    ) *
      4 *
      depthPressure,
    'Source-club depth preference'
  );

  /*
   * Versatility is already useful in the neutral operations score. Philosophy
   * changes how strongly the organization values that versatility.
   */
  const versatilityCount =
    Math.min(
      move.player.coverage.size,
      5
    );

  add(
    -centeredPreference(
      philosophy.versatility
    ) *
      4 *
      versatilityCount,
    'Organizational preference for versatility'
  );

  add(
    -centeredPreference(
      philosophy.positionalScarcity
    ) *
      5 *
      move.scarceCoverageValue,
    'Scarce-position coverage preference'
  );

  /*
   * Upside preference should not manufacture promotions. It mainly protects
   * unfinished players from being used as generic balancing pieces or being
   * sent backward.
   */
  if (
    move.kind ===
      'same_level_reassignment' ||
    move.kind ===
      'demotion'
  ) {
    const current =
      move.player.current;

    const potential =
      move.player.potential;

    if (
      current !== null &&
      potential !== null
    ) {
      const gap =
        Math.max(
          0,
          potential - current
        );

      const upsideFactor =
        Math.min(
          1,
          gap / 20
        );

      add(
        centeredPreference(
          philosophy.upsidePreference
        ) *
          12 *
          upsideFactor,
        'Preference for preserving upside'
      );
    }
  }

  /*
   * A high age-curve-sensitivity organization is more willing to use older
   * organizational players as movable depth. This does not make them release
   * candidates; it only affects redistribution among already-legal moves.
   */
  if (
    move.kind ===
      'same_level_reassignment' ||
    move.kind ===
      'demotion'
  ) {
    const ageFactor =
      Math.max(
        0,
        Math.min(
          1,
          (move.player.age - 24) / 8
        )
      );

    add(
      -centeredPreference(
        philosophy.ageCurveSensitivity
      ) *
        10 *
        ageFactor,
      'Age-curve sensitivity'
    );
  }

  return {
    adjustment:
      Math.round(
        adjustment * 10
      ) / 10,

    reasons,
  };
}

function developmentCost(
  move: SearchMove,
  philosophy: MinorLeagueOperationsPhilosophy
): number {
  return (
    baseDevelopmentCost(
      move,
      philosophy
    ) +
    philosophyInfluence(
      move,
      philosophy
    ).adjustment
  );
}

function planScore(
  moves: SearchMove[],
  philosophy: MinorLeagueOperationsPhilosophy
): number {
  return moves.reduce(
    (sum, move) => {
      const versatility =
        Math.min(
          move.player.coverage.size,
          5
        );

      return (
        sum +

        developmentCost(
          move,
          philosophy
        ) +

        (100 - move.assignment.fit) *
          0.5 +

        move.concentrationPenalty *
          3 -

        move.assignmentNeed *
          1.25 -

        Math.min(
          move.coverageBenefit,
          250
        ) *
          0.8 -

        /*
         * Neutral baseball-operations value for versatility. The philosophy
         * layer above adjusts this upward/downward around the neutral case.
         */
        versatility * 10
      );
    },
    0
  );
}

function candidateSortCost(
  candidate: SearchCandidate,
  philosophy: MinorLeagueOperationsPhilosophy
): number {
  return baseDevelopmentCost(
    candidate,
    philosophy
  );
}
function assignmentKind(
  kind: ProspectAssignmentLike['kind']
): MinorLeagueMoveKind | null {
  if (
    kind === 'normal_promotion' ||
    kind === 'skip_level_promotion' ||
    kind === 'demotion'
  ) {
    return kind;
  }

  return null;
}

function prospectBatters(
  data: ProspectDataLike
): ProspectLike[] {
  return data.batters as ProspectLike[];
}

function buildCandidatePool(
  destination: AffiliateRosterHealth,
  peers: AffiliateRosterHealth[],
  originalRosters: Map<number, Hitter[]>,
  prospectData: ProspectDataLike,
  philosophy: MinorLeagueOperationsPhilosophy
): {
  candidates: SearchCandidate[];
  rejected: MinorLeagueRejectedMove[];
} {
  const candidates: SearchCandidate[] = [];
  const rejected: MinorLeagueRejectedMove[] = [];

  const healthByTeam =
    new Map(
      peers.map(
        (team) => [
          team.teamId,
          team,
        ]
      )
    );

  /*
   * 1. Same-level reassignments.
   *
   * These are authorized by developmental protection/position-fit rules rather
   * than by the Prospect Assignment Engine.
   */
  for (const source of peers) {
    if (
      source.teamId ===
        destination.teamId ||
      source.level !==
        destination.level ||
      source.overall !== 'healthy'
    ) {
      continue;
    }

    for (
      const player of
      originalRosters.get(
        source.teamId
      ) ?? []
    ) {
      candidates.push({
        kind:
          'same_level_reassignment',

        player,
        source,
        destination,

        development: {
          authorizedBy:
            'development_protection',

          recommendation: null,

          destinationFit: null,

          reasons: [
            'Same-level reassignment preserves the player’s developmental level.',
          ],
        },
      });
    }
  }

  /*
   * 2. Developmentally authorized movement.
   *
   * Minor League Operations does NOT decide whether someone deserves a
   * promotion, skip or demotion. It only consumes the assignment evaluations
   * produced by Player Development.
   */
  for (
    const prospect of
    prospectBatters(prospectData)
  ) {
    if (
      !prospect.assignments ||
      !Number.isFinite(
        prospect.team_id
      )
    ) {
      continue;
    }

    const source =
      healthByTeam.get(
        prospect.team_id
      );

    if (!source) continue;

    const player =
      (
        originalRosters.get(
          source.teamId
        ) ?? []
      ).find(
        (candidate) =>
          candidate.playerId ===
          prospect.player_id
      );

    if (!player) continue;

    for (
      const evaluation of
      prospect.assignments.evaluations
    ) {
      const kind =
        assignmentKind(
          evaluation.kind
        );

      if (!kind) continue;

      if (
        evaluation.target.isMajorLeague
      ) {
        continue;
      }

      /*
       * Only evaluate this assignment in the context of a club that the
       * Player Development layer identified as a possible target.
       */
      const targetsDestination =
        evaluation.target.teams.some(
          (team) =>
            team.teamId ===
            destination.teamId
        );

      if (!targetsDestination) {
        continue;
      }

      if (!evaluation.eligible) {
        rejected.push({
          playerId:
            prospect.player_id,

          playerName:
            prospect.name,

          kind,

          fromTeamId:
            source.teamId,

          fromTeam:
            source.label,

          toTeamId:
            destination.teamId,

          toTeam:
            destination.label,

          phase: 'development',

          reasons:
            evaluation.blockers.length
              ? evaluation.blockers
              : [
                  'Player Development did not authorize this assignment.',
                ],
        });

        continue;
      }

      /*
       * A roster-balancing prospect move may not export a shortage from an
       * affiliate that is already structurally thin.
       */
      const sourceRoster =
        originalRosters.get(
          source.teamId
        ) ?? [];

      const sourceStatus =
        combinedStatus(
          assessPositionRoster(
            sourceRoster
          ),
          source
        );

      if (
        sourceStatus !== 'healthy'
      ) {
        rejected.push({
          playerId:
            prospect.player_id,

          playerName:
            prospect.name,

          kind,

          fromTeamId:
            source.teamId,

          fromTeam:
            source.label,

          toTeamId:
            destination.teamId,

          toTeam:
            destination.label,

          phase: 'operations',

          reasons: [
            `${source.label} is already ${sourceStatus.toUpperCase()}; moving the player would transfer a roster problem rather than solve one.`,
          ],
        });

        continue;
      }

      const destinationFit =
        evaluation.destinationFit?.teams.find(
          (item) =>
            item.fit.destinationTeamId ===
            destination.teamId
        )?.fit ?? null;

      candidates.push({
        kind,

        player,
        source,
        destination,

        development: {
          authorizedBy:
            'prospect_assignment_engine',

          recommendation:
            evaluation.recommendation,

          destinationFit:
            destinationFit
              ? {
                  classification:
                    destinationFit.classification,

                  compositePercentile:
                    destinationFit.compositePercentile,

                  weakestCorePercentile:
                    destinationFit.weakestCorePercentile,
                }
              : null,

          reasons:
            evaluation.reasons,
        },
      });
    }
  }

  candidates.sort(
    (a, b) =>
      candidateSortCost(
        a,
        philosophy
      ) -
      candidateSortCost(
        b,
        philosophy
      )
  );

  return {
    candidates,
    rejected,
  };
}

function findPlans(
  destination: AffiliateRosterHealth,
  peers: AffiliateRosterHealth[],
  originalRosters: Map<number, Hitter[]>,
  prospectData: ProspectDataLike,
  philosophy: MinorLeagueOperationsPhilosophy
): PlanSearchResult {
  const destinationOriginal =
    originalRosters.get(
      destination.teamId
    ) ?? [];

  const baselineStatus =
    combinedStatus(
      assessPositionRoster(
        destinationOriginal
      ),
      destination
    );

  if (
    baselineStatus === 'healthy'
  ) {
    return {
      plans: [],
      rejected: [],
    };
  }

  const pool =
    buildCandidatePool(
      destination,
      peers,
      originalRosters,
      prospectData,
      philosophy
    );

  let bestLength: number | null =
    null;

  let completed:
    RankedSearchPlan[] = [];

  function search(
    rosters: Map<number, Hitter[]>,
    moves: SearchMove[],
    startIndex: number
  ): void {
    const currentDestination =
      rosters.get(
        destination.teamId
      ) ?? [];

    const destinationStatus =
      combinedStatus(
        assessPositionRoster(
          currentDestination
        ),
        destination
      );

    if (
      destinationStatus === 'healthy'
    ) {
      const score =
        planScore(
          moves,
          philosophy
        );

      if (
        bestLength === null ||
        moves.length < bestLength
      ) {
        bestLength =
          moves.length;

        completed = [];
      }

      if (
        moves.length === bestLength
      ) {
        completed.push({
          moves: [...moves],
          score,
        });
      }

      return;
    }

    if (
      moves.length >= MAX_MOVES
    ) {
      return;
    }

    if (
      bestLength !== null &&
      moves.length >= bestLength
    ) {
      return;
    }

    for (
      let index = startIndex;
      index < pool.candidates.length;
      index++
    ) {
      const candidate =
        pool.candidates[index];

      const {
        player,
        source,
      } = candidate;

      if (
        moves.some(
          (move) =>
            move.player.playerId ===
            player.playerId
        )
      ) {
        continue;
      }

      const sourceRoster =
        rosters.get(
          source.teamId
        ) ?? [];

      if (
        !sourceRoster.some(
          (rosterPlayer) =>
            rosterPlayer.playerId ===
            player.playerId
        )
      ) {
        continue;
      }

      const destinationRoster =
        rosters.get(
          destination.teamId
        ) ?? [];

      const assignment =
        bestAssignment(
          player,
          destinationRoster
        );

      if (!assignment) {
        continue;
      }

      if (
        candidate.kind ===
        'same_level_reassignment'
      ) {
        const developmentCheck =
          developmentMoveAllowed(
            player,
            assignment,
            destinationRoster
          );

        if (
          !developmentCheck.allowed
        ) {
          continue;
        }
      } else {
        /*
         * Level movement was authorized by Player Development, but the actual
         * regular defensive role still has to respect the player's protection
         * tier.
         *
         * This prevents a promoted future CF from becoming a regular 1B merely
         * because the destination needs a body.
         */
        if (
          !canUseAsRegularAssignment(
            player.protection,
            assignment
          )
        ) {
          continue;
        }
      }

      const coverageBenefit =
        rosterCoverageBenefit(
          player,
          destinationRoster
        );

      const moveConcentrationPenalty =
        concentrationPenalty(
          assignment,
          destinationRoster
        );

      const positionNeed =
        assignmentNeed(
          assignment.code as PositionCode,
          destinationRoster
        );

      const sourceBefore =
        combinedStatus(
          assessPositionRoster(
            sourceRoster
          ),
          source
        );

      /*
       * We require healthy -> healthy for every move in a balancing plan.
       * A sequence cannot quietly strip multiple players from the same source.
       */
      if (
        sourceBefore !== 'healthy'
      ) {
        continue;
      }

      const sourceAfterRoster =
        sourceRoster.filter(
          (rosterPlayer) =>
            rosterPlayer.playerId !==
            player.playerId
        );

      const sourceAfter =
        combinedStatus(
          assessPositionRoster(
            sourceAfterRoster
          ),
          source
        );

      if (
        sourceAfter !== 'healthy'
      ) {
        continue;
      }

      const sourceDepthMarginAfter =
        sourceAfterRoster.length - 12;

      const scarceCoverageValue =
        scarceCoverageNeedValue(
          player,
          destinationRoster
        );

      const next =
        cloneTeamMap(rosters);

      next.set(
        source.teamId,
        sourceAfterRoster
      );

      next.set(
        destination.teamId,
        [
          ...destinationRoster,
          player,
        ]
      );

      search(
        next,
        [
          ...moves,
          {
            ...candidate,

            assignment,

            coverageBenefit,
            concentrationPenalty:
              moveConcentrationPenalty,
            assignmentNeed:
              positionNeed,

            sourceDepthMarginAfter,
            scarceCoverageValue,
          },
        ],
        index + 1
      );
    }
  }

  search(
    cloneTeamMap(
      originalRosters
    ),
    [],
    0
  );

  return {
    plans:
      completed
        .sort(
          (a, b) =>
            a.score - b.score
        )
        .slice(0, 10),

    rejected:
      pool.rejected,
  };
}

function moveReasons(
  move: SearchMove
): string[] {
  if (
    move.kind ===
    'same_level_reassignment'
  ) {
    return [
      `Same-level reassignment preserves ${move.source.levelName} developmental level.`,
      `Regular ${move.assignment.code} assignment is developmentally ${move.assignment.use.replace('_', ' ')}.`,
      'The source affiliate remains structurally healthy.',
    ];
  }

  const label =
    move.kind ===
      'normal_promotion'
      ? 'Normal promotion'
      : move.kind ===
          'skip_level_promotion'
        ? 'Skip-level promotion'
        : 'Demotion';

  return [
    `${label} was independently authorized by the Prospect Assignment Engine.`,
    ...move.development.reasons,
    `Regular ${move.assignment.code} assignment is developmentally ${move.assignment.use.replace('_', ' ')}.`,
    'The source affiliate remains structurally healthy after the move.',
  ];
}

export function computeMinorLeagueRebalance(
  orgId: number,
  prospectData: ProspectDataLike = {
    batters: [],
    pitchers: [],
  }
): MinorLeagueRebalanceResult {
  const philosophy =
    operationsPhilosophyForOrg(
      orgId
    );

  const health =
    computeMinorLeagueRosterHealth(
      orgId
    );

  const rosters =
    teamMap(health);

  const plans:
    MinorLeagueRebalancePlan[] = [];

  const deferred:
    MinorLeagueRebalanceResult[
      'deferred'
    ] = [];

  const rejected:
    MinorLeagueRejectedMove[] = [];

  for (
    const destination of health
  ) {
    if (
      destination.overall ===
      'healthy'
    ) {
      continue;
    }

    /*
     * Still deferred in this V1:
     *
     * ACL and DSL share OOTP's broad Rookie level but have materially different
     * assignment environments. We should model eligibility/geography before
     * allowing Operations to choose among them.
     */
    if (
      destination.level >= 6
    ) {
      deferred.push({
        teamId:
          destination.teamId,

        team:
          destination.label,

        reason:
          'Rookie-level destination balancing is deferred until ACL/DSL assignment rules are modeled explicitly.',
      });

      continue;
    }

    const searchResult =
      findPlans(
        destination,
        health,
        rosters,
        prospectData,
        philosophy
      );

    rejected.push(
      ...searchResult.rejected
    );

    const rankedPlan =
      searchResult.plans[0];

    if (!rankedPlan) {
      continue;
    }

    const plan =
      rankedPlan.moves;

    const destinationBefore =
      rosters.get(
        destination.teamId
      ) ?? [];

    const simulated =
      cloneTeamMap(rosters);

    for (
      const move of plan
    ) {
      const sourceRoster =
        simulated.get(
          move.source.teamId
        ) ?? [];

      simulated.set(
        move.source.teamId,

        sourceRoster.filter(
          (candidate) =>
            candidate.playerId !==
            move.player.playerId
        )
      );

      simulated.set(
        destination.teamId,
        [
          ...(
            simulated.get(
              destination.teamId
            ) ?? []
          ),
          move.player,
        ]
      );
    }

    const destinationAfter =
      simulated.get(
        destination.teamId
      ) ?? [];

    const afterStatus =
      combinedStatus(
        assessPositionRoster(
          destinationAfter
        ),
        destination
      );

    plans.push({
      teamId:
        destination.teamId,

      team:
        destination.label,

      level:
        destination.level,

      levelName:
        destination.levelName,

      before: {
        overall:
          destination.overall,

        positionPlayers:
          destinationBefore.length,
      },

      after: {
        overall:
          afterStatus,

        positionPlayers:
          destinationAfter.length,
      },

      moves:
        plan.map(
          (move) => ({
            playerId:
              move.player.playerId,

            playerName:
              move.player.name,

            age:
              move.player.age,

            kind:
              move.kind,

            fromTeamId:
              move.source.teamId,

            fromTeam:
              teamLabel(
                move.source
              ),

            toTeamId:
              move.destination.teamId,

            toTeam:
              teamLabel(
                move.destination
              ),

            protection:
              move.player.protection,

            development:
              move.development,

            philosophy:
              philosophyInfluence(
                move,
                philosophy
              ),

            assignment: {
              position:
                move.assignment.code,

              fit:
                move.assignment.fit,

              use:
                move.assignment.use,
            },

            coverage: [
              ...move.player.coverage,
            ],

            reasons:
              moveReasons(move),
          })
        ),

      selectionScore:
        rankedPlan.score,

      alternatives:
        searchResult.plans
          .slice(1)
          .map(
            (
              alternative,
              index
            ) => ({
              rank:
                index + 2,

              score:
                alternative.score,

              moves:
                alternative.moves.map(
                  (move) => ({
                    playerId:
                      move.player.playerId,

                    playerName:
                      move.player.name,

                    fromTeam:
                      move.source.label,

                    kind:
                      move.kind,

                    developmentRecommendation:
                      move.development
                        .recommendation,

                    philosophyAdjustment:
                      philosophyInfluence(
                        move,
                        philosophy
                      ).adjustment,

                    protectionTier:
                      move.player
                        .protection
                        .tier,

                    protectionScore:
                      move.player
                        .protection
                        .score,

                    assignment:
                      move.assignment.code,

                    assignmentFit:
                      move.assignment.fit,

                    coverage: [
                      ...move.player
                        .coverage,
                    ],

                    assignmentNeed:
                      move.assignmentNeed,

                    coverageBenefit:
                      move.coverageBenefit,

                    concentrationPenalty:
                      move
                        .concentrationPenalty,
                  })
                ),
            })
          ),

      summary: [
        `${destination.label} improves from ${destination.overall.toUpperCase()} to ${afterStatus.toUpperCase()}.`,
        `Position-player count improves from ${destinationBefore.length} to ${destinationAfter.length}.`,
        'Every level-changing move was independently authorized by Player Development.',
        'No source affiliate is allowed to become structurally unhealthy.',
      ],
    });
  }

  return {
    orgId,
    philosophy,
    plans,
    deferred,
    rejected,

    safeguards: [
      'Minor League Operations cannot invent a promotion, skip-level promotion, or demotion; those moves must already be authorized by the Prospect Assignment Engine.',
      'Roster need may choose among developmentally legal destinations, but cannot create developmental justification.',
      'Core prospects cannot be used for routine same-level roster balancing.',
      'Level-changing prospects still require a developmentally appropriate regular defensive assignment.',
      'A source affiliate must remain structurally healthy after every proposed move.',
      'Rookie-level destination balancing remains deferred until ACL/DSL assignment rules are modeled explicitly.',
      'This version unifies position-player moves; pitcher roster simulation is intentionally handled in the next pass.',
      'Recommendations are read-only and never modify the OOTP save.',
    ],
  };
}
