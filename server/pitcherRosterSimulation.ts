import { screenAffiliatePlayers } from './rehabAssignments.js';
import {
  db,
  tableExists,
} from './db.js';

import {
  evaluatePitcherDevelopmentalRole,
  type PitcherRoleAssessment,
} from './destinationFit.js';

import {
  loadScoutedAbilities,
} from './scoutedEvidence.js';

import type {
  RosterHealthStatus,
} from './minorLeagueRoster.js';

export type PitcherAssignmentRole =
  | 'starter'
  | 'reliever'
  | 'closer';

export interface PitcherRosterPiece {
  playerId: number;
  name: string;
  age: number;

  /**
   * How OOTP is currently using the pitcher.
   */
  currentRole: PitcherAssignmentRole;

  /**
   * Role to use in this hypothetical roster state.
   *
   * On the current roster this equals currentRole.
   * A developmentally authorized move may change it.
   */
  assignedRole: PitcherAssignmentRole;

  developmentalRole:
    | 'starter'
    | 'reliever';

  stamina: number | null;

  roleAssessment:
    PitcherRoleAssessment | null;
}

export interface PitcherRosterState {
  total: number;

  starters: number;

  /**
   * Includes closers, matching the existing roster-health engine.
   */
  relievers: number;

  closers: number;

  bodyCountStatus:
    RosterHealthStatus;

  rotationStatus:
    RosterHealthStatus;

  bullpenStatus:
    RosterHealthStatus;

  starterStamina: number;
  longArmStamina: number;
  staminaKnown: number;

  /**
   * Simplified structural result used by move simulation.
   * Surplus is healthy operationally unless another area is thin.
   */
  structuralStatus:
    | 'critical'
    | 'thin'
    | 'healthy';
}

export interface PitcherTransferSimulation {
  player: PitcherRosterPiece;

  destinationRole:
    PitcherAssignmentRole;

  source: {
    teamId: number;
    before: PitcherRosterState;
    after: PitcherRosterState;
  };

  destination: {
    teamId: number;
    before: PitcherRosterState;
    after: PitcherRosterState;
  };
}

function roleFromOotp(
  role: number
): PitcherAssignmentRole {
  if (role === 11) {
    return 'starter';
  }

  if (role === 13) {
    return 'closer';
  }

  return 'reliever';
}

function pitcherBodyStatus(
  count: number
): RosterHealthStatus {
  /*
   * Same thresholds as minorLeagueRoster.ts:
   * bodyCountStatus(count, 12, 18).
   */
  if (count < 10) {
    return 'critical';
  }

  if (count < 12) {
    return 'thin';
  }

  if (count >= 18) {
    return 'surplus';
  }

  return 'healthy';
}

function rotationStatus(
  starters: number
): RosterHealthStatus {
  if (starters < 4) {
    return 'critical';
  }

  if (starters === 4) {
    return 'thin';
  }

  if (starters >= 7) {
    return 'surplus';
  }

  return 'healthy';
}

function bullpenStatus(
  relievers: number
): RosterHealthStatus {
  if (relievers < 5) {
    return 'critical';
  }

  if (relievers < 7) {
    return 'thin';
  }

  if (relievers >= 12) {
    return 'surplus';
  }

  return 'healthy';
}

function structuralStatus(
  body: RosterHealthStatus,
  rotation: RosterHealthStatus,
  bullpen: RosterHealthStatus
): 'critical' | 'thin' | 'healthy' {
  if (
    body === 'critical' ||
    rotation === 'critical' ||
    bullpen === 'critical'
  ) {
    return 'critical';
  }

  if (
    body === 'thin' ||
    rotation === 'thin' ||
    bullpen === 'thin'
  ) {
    return 'thin';
  }

  return 'healthy';
}

/**
 * Pure count-level evaluator.
 *
 * Useful both for the actual roster and synthetic validation.
 */
export function evaluatePitcherCounts(
  starters: number,
  relievers: number
): Pick<
  PitcherRosterState,
  | 'total'
  | 'bodyCountStatus'
  | 'rotationStatus'
  | 'bullpenStatus'
  | 'structuralStatus'
> {
  const total =
    starters + relievers;

  const body =
    pitcherBodyStatus(total);

  const rotation =
    rotationStatus(starters);

  const bullpen =
    bullpenStatus(relievers);

  return {
    total,

    bodyCountStatus:
      body,

    rotationStatus:
      rotation,

    bullpenStatus:
      bullpen,

    structuralStatus:
      structuralStatus(
        body,
        rotation,
        bullpen
      ),
  };
}

export function pitcherRosterForTeam(
  teamId: number
): PitcherRosterPiece[] {
  if (
    !tableExists('players') ||
    !tableExists('team_roster')
  ) {
    return [];
  }

  const listed = db.prepare(`
    SELECT
      p.player_id,
      p.first_name,
      p.last_name,
      p.age,
      p.role

    FROM players p

    JOIN team_roster tr
      ON tr.team_id = ?
     AND tr.player_id = p.player_id
     AND tr.list_id = 2

    WHERE p.team_id = ?
      AND p.retired = 0
      AND p.position = 1

    ORDER BY p.player_id
  `).all(
    teamId,
    teamId
  ) as Array<
    Record<string, unknown>
  >;

  // A pitcher on a rehab assignment is not an ordinary member of this club's staff (rehabAssignments.ts).
  const rehab = screenAffiliatePlayers(listed.map((row) => Number(row.player_id))).rehab;
  const rows = listed.filter((row) => !rehab.has(Number(row.player_id)));

  /*
   * The pitcher list is an objective roster fact. Stamina is a visible-rating
   * judgment and comes only from the scouted-evidence adapter.
   */
  const abilities =
    loadScoutedAbilities(
      rows.map(
        (row) =>
          Number(row.player_id)
      )
    );

  return rows.map((row) => {
    const playerId =
      Number(row.player_id);

    const currentRole =
      roleFromOotp(
        Number(row.role)
      );

    const roleAssessment =
      evaluatePitcherDevelopmentalRole(
        playerId
      );

    return {
      playerId,

      name:
        `${String(row.first_name)} ${String(row.last_name)}`,

      age:
        Number(row.age),

      currentRole,

      assignedRole:
        currentRole,

      developmentalRole:
        roleAssessment
          ?.developmentalRole ??
        (
          currentRole === 'starter'
            ? 'starter'
            : 'reliever'
        ),

      stamina:
        abilities.for(
          playerId
        ).stamina,

      roleAssessment,
    };
  });
}

export function evaluatePitcherRoster(
  pitchers: PitcherRosterPiece[]
): PitcherRosterState {
  const starters =
    pitchers.filter(
      (pitcher) =>
        pitcher.assignedRole ===
        'starter'
    ).length;

  const closers =
    pitchers.filter(
      (pitcher) =>
        pitcher.assignedRole ===
        'closer'
    ).length;

  /*
   * Exactly like minorLeagueRoster.ts:
   * closers are part of the relief corps.
   */
  const relievers =
    pitchers.filter(
      (pitcher) =>
        pitcher.assignedRole ===
          'reliever' ||
        pitcher.assignedRole ===
          'closer'
    ).length;

  const staminaKnown =
    pitchers.filter(
      (pitcher) =>
        pitcher.stamina !== null
    );

  const starterStamina =
    staminaKnown.filter(
      (pitcher) =>
        Number(pitcher.stamina) >= 45
    ).length;

  const longArmStamina =
    staminaKnown.filter(
      (pitcher) =>
        Number(pitcher.stamina) >= 35
    ).length;

  const counts =
    evaluatePitcherCounts(
      starters,
      relievers
    );

  return {
    ...counts,

    starters,
    relievers,
    closers,

    starterStamina,
    longArmStamina,
    staminaKnown:
      staminaKnown.length,
  };
}

function withAssignedRole(
  pitcher: PitcherRosterPiece,
  assignedRole: PitcherAssignmentRole
): PitcherRosterPiece {
  return {
    ...pitcher,
    assignedRole,
  };
}

/**
 * Pure/read-only hypothetical transfer.
 *
 * Nothing here changes the OOTP database.
 */
export function simulatePitcherTransfer(
  sourceTeamId: number,
  destinationTeamId: number,
  playerId: number,
  destinationRole: PitcherAssignmentRole
): PitcherTransferSimulation | null {
  const source =
    pitcherRosterForTeam(
      sourceTeamId
    );

  const destination =
    pitcherRosterForTeam(
      destinationTeamId
    );

  const player =
    source.find(
      (candidate) =>
        candidate.playerId === playerId
    );

  if (!player) {
    return null;
  }

  const sourceAfter =
    source.filter(
      (candidate) =>
        candidate.playerId !==
        playerId
    );

  const destinationAfter = [
    ...destination,

    withAssignedRole(
      player,
      destinationRole
    ),
  ];

  return {
    player,

    destinationRole,

    source: {
      teamId:
        sourceTeamId,

      before:
        evaluatePitcherRoster(
          source
        ),

      after:
        evaluatePitcherRoster(
          sourceAfter
        ),
    },

    destination: {
      teamId:
        destinationTeamId,

      before:
        evaluatePitcherRoster(
          destination
        ),

      after:
        evaluatePitcherRoster(
          destinationAfter
        ),
    },
  };
}
