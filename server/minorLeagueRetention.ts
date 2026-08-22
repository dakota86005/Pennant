import {
  db,
  tableExists,
} from './db.js';

import {
  contractsByPlayer,
  valuesByPlayer,
} from './valuation.js';

import {
  gloves,
  POSITION_CODES,
} from './gloves.js';

import {
  evaluateDevelopmentProtection,
  type DevelopmentProtection,
} from './developmentFit.js';

import {
  evaluatePitcherDevelopmentalRole,
} from './destinationFit.js';

import {
  computeMinorLeagueRosterHealth,
  type AffiliateRosterHealth,
} from './minorLeagueRoster.js';

import {
  resolvePhilosophy,
} from './philosophy.js';

import {
  philosophyForOrg,
} from './settings.js';

import {
  developmentTrendByPlayer,
  peerDevelopmentTrendByPlayer,
  type PlayerDevelopmentTrend,
  type PeerDevelopmentTrend,
} from './history.js';


type RetentionRecommendation =
  | 'protected'
  | 'retain'
  | 'expendable_depth'
  | 'release_candidate';

type PlayerKind =
  | 'hitter'
  | 'pitcher';

type DevelopmentalRunwayStatus =
  | 'not_applicable'
  | 'open'
  | 'limited';

interface DevelopmentalRunway {
  status: DevelopmentalRunwayStatus;
  reasons: string[];
}

interface ProspectAssignmentLike {
  kind:
    | 'normal_promotion'
    | 'skip_level_promotion'
    | 'demotion'
    | 'mlb_discussion';

  eligible: boolean;

  target: {
    level: number;
    levelName: string;
    isMajorLeague: boolean;
  };
}

interface ProspectLike {
  player_id: number;

  assignments?: {
    eligible:
      ProspectAssignmentLike[];
  };
}

interface ProspectDataLike {
  batters: unknown[];
  pitchers: unknown[];
}

interface RetentionPhilosophy {
  prospectPreservation: number;
  upsidePreference: number;
  rosterDepth: number;
  pitchingDepth: number;
  versatility: number;
  positionalScarcity: number;
  ageCurveSensitivity: number;
  riskTolerance: number;
}

interface OrgPlayerRow {
  player_id: number;

  first_name: string;
  last_name: string;

  age: number;
  position: number;
  role: number;

  team_id: number;
  team_name: string;
  team_nickname: string;

  level: number;

  is_active: number | null;
  is_on_secondary: number | null;
  is_on_dl: number | null;
  is_on_dl60: number | null;
  must_be_active: number | null;

  mlb_service_years: number | null;
  secondary_service_years: number | null;
  pro_service_years: number | null;
  years_protected_from_rule_5: number | null;
}

export interface MinorLeagueRetentionPlayer {
  playerId: number;
  name: string;

  age: number;

  kind: PlayerKind;

  teamId: number;
  team: string;

  level: number;
  levelName: string;

  current: number | null;
  potential: number | null;

  protection:
    DevelopmentProtection;

  transaction: {
    active: boolean;
    onSecondary: boolean;
    onInjuredList: boolean;
    onDl60: boolean;
    mustBeActive: boolean;

    majorContract: boolean;
    salaryNow: number;
    yearsAfterThis: number;

    mlbServiceYears: number;
    secondaryServiceYears: number;
    proServiceYears: number;

    yearsProtectedFromRule5:
      number | null;
  };

  role: {
    listedPosition: string;

    playablePositions: string[];

    developmentalPitcherRole:
      | 'starter'
      | 'reliever'
      | null;

    internalSameLevelNeed:
      string[];

    legalDevelopmentMoves:
      string[];
  };

  evidence: {
    development: {
      score: number;
      reasons: string[];
    };

    developmentalRunway: DevelopmentalRunway;

    developmentHistory: PlayerDevelopmentTrend;

    peerDevelopment: PeerDevelopmentTrend;

    utility: {
      score: number;
      reasons: string[];
    };

    rosterPressure: {
      score: number;
      reasons: string[];
    };

    philosophy: {
      retentionAdjustment: number;
      pressureAdjustment: number;
      reasons: string[];
    };
  };

  recommendation:
    RetentionRecommendation;

  guardrails: string[];

  summary: string[];
}

export interface MinorLeagueRetentionResult {
  orgId: number;

  philosophy:
    RetentionPhilosophy;

  counts: Record<
    RetentionRecommendation,
    number
  >;

  players:
    MinorLeagueRetentionPlayer[];

  safeguards: string[];
}


const LEVEL_NAMES:
  Record<number, string> = {
    1: 'MLB',
    2: 'AAA',
    3: 'AA',
    4: 'A',
    5: 'SA',
    6: 'R',
  };

const PLAYABLE_RATING = 35;

const SCARCE_POSITIONS =
  new Set([
    'C',
    'SS',
    'CF',
  ]);


function clamp(
  value: number,
  low = 0,
  high = 100
): number {
  return Math.max(
    low,
    Math.min(
      high,
      value
    )
  );
}

function round1(
  value: number
): number {
  return (
    Math.round(value * 10) /
    10
  );
}

function centered(
  value: number
): number {
  return (
    clamp(value, 0, 100) -
    50
  ) / 50;
}

function teamLabel(
  row: Pick<
    OrgPlayerRow,
    'team_name' |
    'team_nickname'
  >
): string {
  return (
    row.team_name ===
    row.team_nickname
      ? row.team_name
      : `${row.team_name} ${row.team_nickname}`
  );
}

function orgPlayers(
  orgId: number
): OrgPlayerRow[] {
  if (
    !tableExists('players') ||
    !tableExists('teams') ||
    !tableExists('team_roster')
  ) {
    return [];
  }

  const hasRosterStatus =
    tableExists(
      'players_roster_status'
    );

  return db.prepare(`
    WITH RECURSIVE org AS (
      SELECT
        team_id,
        name,
        nickname,
        level

      FROM teams

      WHERE team_id = ?

      UNION ALL

      SELECT
        t.team_id,
        t.name,
        t.nickname,
        t.level

      FROM teams t

      JOIN org o
        ON t.parent_team_id =
           o.team_id
    )

    SELECT
      p.player_id,
      p.first_name,
      p.last_name,

      p.age,
      p.position,
      p.role,

      p.team_id,

      o.name AS team_name,
      o.nickname AS team_nickname,
      o.level,

      /*
       * For minor leaguers, players_roster_status.is_active is not the
       * affiliate's available-roster flag. OOTP's team_roster list 2 is the
       * active/available affiliate roster; list 1 also contains IL players.
       */
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM team_roster active_tr
          WHERE active_tr.team_id = tr.team_id
            AND active_tr.player_id = tr.player_id
            AND active_tr.list_id = 2
        )
        THEN 1
        ELSE 0
      END AS is_active,

      ${
        hasRosterStatus
          ? `
            rs.is_on_secondary,
            rs.is_on_dl,
            rs.is_on_dl60,
            rs.must_be_active,
            rs.mlb_service_years,
            rs.secondary_service_years,
            rs.pro_service_years,
            rs.years_protected_from_rule_5
          `
          : `
            NULL AS is_on_secondary,
            NULL AS is_on_dl,
            NULL AS is_on_dl60,
            NULL AS must_be_active,
            NULL AS mlb_service_years,
            NULL AS secondary_service_years,
            NULL AS pro_service_years,
            NULL AS years_protected_from_rule_5
          `
      }

    FROM team_roster tr

    JOIN players p
      ON p.player_id =
         tr.player_id

    JOIN org o
      ON o.team_id =
         tr.team_id

    ${
      hasRosterStatus
        ? `
          LEFT JOIN players_roster_status rs
            ON rs.player_id =
               p.player_id
        `
        : ''
    }

    WHERE tr.list_id = 1
      AND o.level > 1
      AND p.retired = 0

    ORDER BY
      o.level,
      p.age,
      p.player_id
  `).all(
    orgId
  ) as OrgPlayerRow[];
}

function philosophyForRetention(
  orgId: number
): RetentionPhilosophy {
  const philosophy =
    resolvePhilosophy(
      philosophyForOrg(
        orgId
      )
    );

  return {
    prospectPreservation:
      philosophy.dimensions
        .prospectPreservation
        .value,

    upsidePreference:
      philosophy.dimensions
        .upsidePreference
        .value,

    rosterDepth:
      philosophy.dimensions
        .rosterDepth
        .value,

    pitchingDepth:
      philosophy.dimensions
        .pitchingDepth
        .value,

    versatility:
      philosophy.dimensions
        .versatility
        .value,

    positionalScarcity:
      philosophy.dimensions
        .positionalScarcity
        .value,

    ageCurveSensitivity:
      philosophy.dimensions
        .ageCurveSensitivity
        .value,

    riskTolerance:
      philosophy.dimensions
        .riskTolerance
        .value,
  };
}

function prospectMap(
  data: ProspectDataLike
): Map<number, ProspectLike> {
  const all = [
    ...(data.batters as
      ProspectLike[]),
    ...(data.pitchers as
      ProspectLike[]),
  ];

  return new Map(
    all.map((player) => [
      player.player_id,
      player,
    ])
  );
}

function legalDevelopmentMoves(
  prospect:
    ProspectLike | undefined
): string[] {
  if (!prospect?.assignments) {
    return [];
  }

  return prospect.assignments
    .eligible
    .filter(
      (assignment) =>
        !assignment.target
          .isMajorLeague
    )
    .map(
      (assignment) =>
        `${assignment.kind} → ${assignment.target.levelName}`
    );
}

function playablePositions(
  playerId: number,
  listedPositionNumber: number
): string[] {
  const out =
    new Set<string>();

  const listed =
    POSITION_CODES[
      listedPositionNumber - 1
    ];

  if (
    listed &&
    listed !== 'P'
  ) {
    out.add(listed);
  }

  const profile =
    gloves(playerId);

  if (profile) {
    for (
      const position of
      profile.positions
    ) {
      if (
        position.current >=
          PLAYABLE_RATING ||
        position.isPrimary
      ) {
        out.add(
          position.code
        );
      }
    }
  }

  return [...out];
}

function affiliateMap(
  health:
    AffiliateRosterHealth[]
): Map<
  number,
  AffiliateRosterHealth
> {
  return new Map(
    health.map((team) => [
      team.teamId,
      team,
    ])
  );
}

function sameLevelHitterNeed(
  player:
    OrgPlayerRow,
  positions: string[],
  health:
    AffiliateRosterHealth[]
): string[] {
  if (
    player.level >= 6
  ) {
    return [];
  }

  const needs:
    string[] = [];

  for (const team of health) {
    if (
      team.teamId ===
        player.team_id ||
      team.level !==
        player.level
    ) {
      continue;
    }

    if (
      team.positionPlayers
        .bodyCountStatus ===
        'critical' ||
      team.positionPlayers
        .bodyCountStatus ===
        'thin'
    ) {
      needs.push(
        `${team.label}: position-player body count`
      );
    }

    for (
      const position of
      positions
    ) {
      const coverage =
        team.positionPlayers
          .coverage.find(
            (item) =>
              item.position ===
              position
          );

      if (
        coverage &&
        (
          coverage.status ===
            'critical' ||
          coverage.status ===
            'thin'
        )
      ) {
        needs.push(
          `${team.label}: ${position}`
        );
      }
    }
  }

  return [
    ...new Set(needs),
  ];
}

function sameLevelPitcherNeed(
  player:
    OrgPlayerRow,
  developmentalRole:
    'starter' | 'reliever',
  health:
    AffiliateRosterHealth[]
): string[] {
  if (
    player.level >= 6
  ) {
    return [];
  }

  const needs:
    string[] = [];

  for (const team of health) {
    if (
      team.teamId ===
        player.team_id ||
      team.level !==
        player.level
    ) {
      continue;
    }

    if (
      team.pitching
        .bodyCountStatus ===
        'critical' ||
      team.pitching
        .bodyCountStatus ===
        'thin'
    ) {
      needs.push(
        `${team.label}: pitcher body count`
      );
    }

    if (
      developmentalRole ===
        'starter' &&
      (
        team.pitching
          .rotationStatus ===
          'critical' ||
        team.pitching
          .rotationStatus ===
          'thin'
      )
    ) {
      needs.push(
        `${team.label}: rotation`
      );
    }

    if (
      developmentalRole ===
        'reliever' &&
      (
        team.pitching
          .bullpenStatus ===
          'critical' ||
        team.pitching
          .bullpenStatus ===
          'thin'
      )
    ) {
      needs.push(
        `${team.label}: bullpen`
      );
    }
  }

  return [
    ...new Set(needs),
  ];
}

function hitterUtility(
  positions: string[],
  internalNeed: string[],
  team:
    AffiliateRosterHealth | undefined,
  philosophy:
    RetentionPhilosophy
): {
  score: number;
  reasons: string[];
} {
  let score = 10;

  const reasons:
    string[] = [];

  const versatility =
    Math.min(
      positions.length,
      5
    );

  if (
    versatility >= 2
  ) {
    const value =
      versatility * 7;

    score += value;

    reasons.push(
      `Playable at ${versatility} positions.`
    );
  }

  const scarce =
    positions.filter(
      (position) =>
        SCARCE_POSITIONS.has(
          position
        )
    );

  if (
    scarce.length > 0
  ) {
    score +=
      scarce.length * 12;

    reasons.push(
      `Provides scarce-position coverage: ${scarce.join(', ')}.`
    );
  }

  if (
    internalNeed.length > 0
  ) {
    score += 25;

    reasons.push(
      `Identified same-level organizational need: ${internalNeed.slice(0, 3).join('; ')}.`
    );
  }

  if (team) {
    const protectsThinPosition =
      positions.some(
        (position) => {
          const coverage =
            team.positionPlayers
              .coverage.find(
                (item) =>
                  item.position ===
                  position
              );

          return (
            coverage?.status ===
              'critical' ||
            coverage?.status ===
              'thin'
          );
        }
      );

    if (
      protectsThinPosition
    ) {
      score += 20;

      reasons.push(
        'Currently covers a thin or critical position at his affiliate.'
      );
    }
  }

  const versatilityAdjustment =
    centered(
      philosophy.versatility
    ) *
    versatility *
    4;

  score +=
    versatilityAdjustment;

  if (
    Math.abs(
      versatilityAdjustment
    ) >= 1
  ) {
    reasons.push(
      `Organizational versatility preference ${versatilityAdjustment >= 0 ? 'increases' : 'reduces'} retention value.`
    );
  }

  const scarcityAdjustment =
    centered(
      philosophy
        .positionalScarcity
    ) *
    scarce.length *
    5;

  score +=
    scarcityAdjustment;

  return {
    score:
      round1(
        clamp(score)
      ),

    reasons,
  };
}

function pitcherUtility(
  developmentalRole:
    'starter' | 'reliever',
  internalNeed: string[],
  team:
    AffiliateRosterHealth | undefined,
  philosophy:
    RetentionPhilosophy
): {
  score: number;
  reasons: string[];
} {
  let score = 20;

  const reasons:
    string[] = [];

  if (
    developmentalRole ===
      'starter'
  ) {
    score += 25;

    reasons.push(
      'Stamina/repertoire still support starter development.'
    );
  }

  if (
    internalNeed.length > 0
  ) {
    score += 25;

    reasons.push(
      `Identified same-level pitching need: ${internalNeed.slice(0, 3).join('; ')}.`
    );
  }

  if (team) {
    const neededHere =
      developmentalRole ===
        'starter'
        ? (
            team.pitching
              .rotationStatus ===
              'critical' ||
            team.pitching
              .rotationStatus ===
              'thin'
          )
        : (
            team.pitching
              .bullpenStatus ===
              'critical' ||
            team.pitching
              .bullpenStatus ===
              'thin'
          );

    if (neededHere) {
      score += 25;

      reasons.push(
        `Current affiliate has a ${developmentalRole === 'starter' ? 'rotation' : 'bullpen'} need.`
      );
    }
  }

  const pitchingDepthAdjustment =
    centered(
      philosophy.pitchingDepth
    ) *
    (
      developmentalRole ===
        'starter'
        ? 12
        : 8
    );

  score +=
    pitchingDepthAdjustment;

  if (
    Math.abs(
      pitchingDepthAdjustment
    ) >= 1
  ) {
    reasons.push(
      `Pitching-depth philosophy ${pitchingDepthAdjustment >= 0 ? 'increases' : 'reduces'} retention value.`
    );
  }

  return {
    score:
      round1(
        clamp(score)
      ),

    reasons,
  };
}

function rosterPressure(
  player:
    OrgPlayerRow,
  kind: PlayerKind,
  positions: string[],
  developmentalRole:
    'starter' |
    'reliever' |
    null,
  internalNeed: string[],
  team:
    AffiliateRosterHealth | undefined,
  philosophy:
    RetentionPhilosophy
): {
  score: number;
  reasons: string[];
  philosophyAdjustment: number;
} {
  let score = 0;

  const reasons:
    string[] = [];

  /*
   * Injured players are still organizational players, but they are not
   * occupying an active-roster body slot in the farm-health model.
   */
  const active =
    player.is_active === 1;

  if (
    active &&
    team
  ) {
    if (
      kind === 'hitter'
    ) {
      if (
        team.positionPlayers
          .bodyCountStatus ===
          'surplus'
      ) {
        score += 25;

        reasons.push(
          'Current affiliate has surplus position-player bodies.'
        );
      }

      const coverages =
        positions
          .map(
            (position) =>
              team.positionPlayers
                .coverage.find(
                  (item) =>
                    item.position ===
                    position
                )
          )
          .filter(Boolean);

      if (
        coverages.length > 0 &&
        coverages.every(
          (coverage) =>
            coverage?.status ===
              'surplus'
        )
      ) {
        score += 30;

        reasons.push(
          'Every playable position is already covered at surplus depth on the current affiliate.'
        );
      } else if (
        coverages.some(
          (coverage) =>
            coverage?.status ===
              'surplus'
        )
      ) {
        score += 15;

        reasons.push(
          'At least one of the player’s roles is currently redundant.'
        );
      }
    } else {
      if (
        team.pitching
          .bodyCountStatus ===
          'surplus'
      ) {
        score += 20;

        reasons.push(
          'Current affiliate has surplus pitcher bodies.'
        );
      }

      const roleStatus =
        developmentalRole ===
          'starter'
          ? team.pitching
              .rotationStatus
          : team.pitching
              .bullpenStatus;

      if (
        roleStatus ===
        'surplus'
      ) {
        score += 30;

        reasons.push(
          `${developmentalRole === 'starter' ? 'Rotation' : 'Bullpen'} depth is already surplus at the current affiliate.`
        );
      }
    }
  }

  if (
    internalNeed.length === 0
  ) {
    score += 15;

    reasons.push(
      'No same-level affiliate need was identified for this role.'
    );
  }

  /*
   * Low roster-depth philosophy means the organization is more comfortable
   * moving on from redundant depth. High roster depth does the opposite.
   */
  const depthAdjustment =
    -centered(
      philosophy.rosterDepth
    ) * 15;

  score +=
    depthAdjustment;

  if (
    Math.abs(
      depthAdjustment
    ) >= 1
  ) {
    reasons.push(
      `Roster-depth philosophy ${depthAdjustment >= 0 ? 'increases' : 'reduces'} pressure by ${Math.abs(round1(depthAdjustment))}.`
    );
  }

  return {
    score:
      round1(
        clamp(score)
      ),

    reasons,

    philosophyAdjustment:
      round1(
        depthAdjustment
      ),
  };
}

function retentionPhilosophyAdjustment(
  player:
    OrgPlayerRow,
  protection:
    DevelopmentProtection,
  current: number | null,
  potential: number | null,
  philosophy:
    RetentionPhilosophy
): {
  adjustment: number;
  reasons: string[];
} {
  let adjustment = 0;

  const reasons:
    string[] = [];

  const preservationWeight =
    protection.tier ===
      'core_prospect'
      ? 1
      : protection.tier ===
          'protected_prospect'
        ? 0.8
        : protection.tier ===
            'development_priority'
          ? 0.55
          : protection.tier ===
              'normal'
            ? 0.25
            : 0;

  const preservation =
    centered(
      philosophy
        .prospectPreservation
    ) *
    20 *
    preservationWeight;

  adjustment += preservation;

  if (
    Math.abs(
      preservation
    ) >= 1
  ) {
    reasons.push(
      `Prospect-preservation philosophy ${preservation >= 0 ? 'raises' : 'lowers'} retention value by ${Math.abs(round1(preservation))}.`
    );
  }

  if (
    current !== null &&
    potential !== null
  ) {
    const upside =
      Math.min(
        1,
        Math.max(
          0,
          potential - current
        ) / 20
      );

    const upsideAdjustment =
      centered(
        philosophy
          .upsidePreference
      ) *
      12 *
      upside;

    adjustment +=
      upsideAdjustment;

    if (
      Math.abs(
        upsideAdjustment
      ) >= 1
    ) {
      reasons.push(
        `Upside preference ${upsideAdjustment >= 0 ? 'raises' : 'lowers'} retention value by ${Math.abs(round1(upsideAdjustment))}.`
      );
    }
  }

  const ageFactor =
    Math.max(
      0,
      Math.min(
        1,
        (
          player.age -
          24
        ) / 8
      )
    );

  const ageAdjustment =
    -centered(
      philosophy
        .ageCurveSensitivity
    ) *
    12 *
    ageFactor;

  adjustment +=
    ageAdjustment;

  if (
    Math.abs(
      ageAdjustment
    ) >= 1
  ) {
    reasons.push(
      `Age-curve philosophy ${ageAdjustment >= 0 ? 'raises' : 'lowers'} retention value by ${Math.abs(round1(ageAdjustment))}.`
    );
  }

  return {
    adjustment:
      round1(
        adjustment
      ),

    reasons,
  };
}

function developmentalRunway(
  level: number,
  age: number,
  proServiceYears: number,
  current: number | null,
  potential: number | null,
  protection: DevelopmentProtection
): DevelopmentalRunway {
  if (level < 6) {
    return {
      status: 'not_applicable',
      reasons: [],
    };
  }

  /*
   * Development-priority and stronger prospects keep their runway regardless
   * of age/service. Their development-protection evidence is stronger than a
   * generic Rookie-level age/service heuristic.
   */
  if (
    protection.tier === 'core_prospect' ||
    protection.tier === 'protected_prospect' ||
    protection.tier === 'development_priority'
  ) {
    return {
      status: 'open',
      reasons: [
        `${protection.tier} status preserves developmental runway.`,
      ],
    };
  }

  if (
    current === null ||
    potential === null
  ) {
    return {
      status: 'open',
      reasons: [
        'Current/potential evidence is incomplete, so developmental runway is not treated as exhausted.',
      ],
    };
  }

  const gap =
    Math.max(
      potential - current,
      0
    );

  /*
   * Primary pathway:
   * several seasons of professional development, older for Rookie ball,
   * and little projection still separating current ability from ceiling.
   */
  const multiSeasonLimited =
    proServiceYears >= 3 &&
    age >= 21 &&
    gap <= 5;

  /*
   * Conservative age override:
   * an older player with at least two professional seasons and essentially
   * no projection remaining should still enter front-office retention consideration even
   * if he has not reached three full service years.
   *
   * This deliberately does NOT catch an older first-year college draftee.
   */
  const ageLimited =
    age >= 24 &&
    proServiceYears >= 2 &&
    gap <= 5;

  if (
    multiSeasonLimited ||
    ageLimited
  ) {
    const reasons = [
      `Age ${age} at Rookie level.`,
      `${proServiceYears} professional seasons of service.`,
      `Only ${gap} point${gap === 1 ? '' : 's'} separate current ability from projected ceiling.`,
    ];

    if (
      protection.tier ===
      'organizational_depth'
    ) {
      reasons.push(
        'Development-protection model classifies the player as organizational depth.'
      );
    }

    return {
      status: 'limited',
      reasons,
    };
  }

  const reasons: string[] = [];

  if (proServiceYears < 3) {
    reasons.push(
      `Only ${proServiceYears} professional season${proServiceYears === 1 ? '' : 's'} of service; additional developmental time is warranted.`
    );
  }

  if (age < 21) {
    reasons.push(
      `Age ${age} still provides substantial Rookie-level developmental runway.`
    );
  }

  if (gap > 5) {
    reasons.push(
      `${gap} points of current-to-potential projection remain.`
    );
  }

  return {
    status: 'open',
    reasons,
  };
}


function recommendationFor(
  age: number,
  level: number,
  runway: DevelopmentalRunway,
  protection:
    DevelopmentProtection,
  transaction: {
    onSecondary: boolean;
    onInjuredList: boolean;
    mustBeActive: boolean;
    majorContract: boolean;
  },
  legalMoves: string[],
  internalNeed: string[],
  developmentScore: number,
  utilityScore: number,
  pressureScore: number,
  peerDevelopment:
    PeerDevelopmentTrend
): {
  recommendation:
    RetentionRecommendation;

  guardrails:
    string[];
} {
  const guardrails:
    string[] = [];

  /*
   * Hard guardrails are evaluated before any release-oriented evidence.
   *
   * A player who belongs in a different decision process should never become
   * a release candidate merely because the minor-league retention model finds
   * little immediate organizational utility.
   */
  if (
    level >= 6 &&
    runway.status !== 'limited'
  ) {
    guardrails.push(
      'Rookie-level developmental runway remains open; release-candidate classification is suppressed.'
    );
  }

  if (
    transaction
      .onSecondary
  ) {
    guardrails.push(
      'Secondary/40-man roster player: requires MLB roster and transaction analysis before any release decision.'
    );
  }

  if (
    transaction
      .majorContract
  ) {
    guardrails.push(
      'Major-league contract requires MLB roster/contract analysis before any release decision.'
    );
  }

  if (
    transaction
      .mustBeActive
  ) {
    guardrails.push(
      'Roster status requires the player to remain active.'
    );
  }

  if (
    transaction
      .onInjuredList
  ) {
    guardrails.push(
      'Currently on the injured list; release-candidate classification is suppressed in V1.'
    );
  }

  if (
    protection.tier ===
      'core_prospect'
  ) {
    guardrails.push(
      'Core prospect is protected from routine minor-league release consideration.'
    );
  }

  if (
    protection.tier ===
      'protected_prospect'
  ) {
    guardrails.push(
      'Protected prospect is excluded from routine minor-league release consideration in V1.'
    );
  }

  if (
    guardrails.length > 0
  ) {
    return {
      recommendation:
        'protected',

      guardrails,
    };
  }


  /*
   * Development has first claim on a player.
   *
   * A development-priority player or somebody for whom the organization has
   * already identified a useful legal assignment is not expendable simply
   * because another roster is crowded.
   */
  if (
    protection.tier ===
      'development_priority'
  ) {
    return {
      recommendation:
        'retain',

      guardrails,
    };
  }

  if (
    legalMoves.length > 0 ||
    internalNeed.length > 0
  ) {
    return {
      recommendation:
        'retain',

      guardrails,
    };
  }


  /*
   * Preserve the population we previously validated as REVIEW.
   *
   * V1's stronger labels operate ONLY inside this gate. Players outside it
   * remain routine retains rather than being exposed to a completely new
   * release model.
   */
  const retentionQuestion =
    level >= 6
      ? (
          runway.status ===
            'limited' &&
          developmentScore < 42 &&
          utilityScore <= 45 &&
          pressureScore >= 50
        )
      : (
          developmentScore < 42 &&
          utilityScore < 45 &&
          pressureScore >= 50
        );

  if (
    !retentionQuestion
  ) {
    return {
      recommendation:
        'retain',

      guardrails,
    };
  }


  /*
   * Positive developmental evidence can rescue a borderline player.
   *
   * Youth itself is not enough. The player must still carry meaningful
   * developmental value, or be young and developing materially faster than
   * comparable minor leaguers according to the organization's persisted
   * scouting observations.
   */
  const youngDevelopmentalKeep =
    age <= 22 &&
    developmentScore >= 35;

  const youngAheadOfPeers =
    age <= 24 &&
    developmentScore >= 30 &&
    peerDevelopment.pace ===
      'ahead';

  if (
    youngDevelopmentalKeep ||
    youngAheadOfPeers
  ) {
    return {
      recommendation:
        'retain',

      guardrails,
    };
  }


  /*
   * Release pathway A:
   * an older Rookie-level player whose ordinary developmental runway is
   * exhausted, whose organizational utility is low, and whose affiliate is
   * under substantial roster pressure.
   *
   * Ahead-of-peer scouting development blocks this pathway.
   */
  const rookieDeadEnd =
    level >= 6 &&
    runway.status === 'limited' &&
    age >= 24 &&
    developmentScore < 25 &&
    utilityScore < 30 &&
    pressureScore >= 70 &&
    peerDevelopment.pace !==
      'ahead';

  if (
    rookieDeadEnd
  ) {
    return {
      recommendation:
        'release_candidate',

      guardrails,
    };
  }


  /*
   * Release pathway B:
   * older non-Rookie organizational depth with weak developmental value,
   * little identified utility, meaningful roster pressure, AND observed
   * development behind comparable players.
   *
   * Level 5 is included for organizations that actually use a short-season
   * affiliate rather than hard-coding this model to Arizona's current tree.
   */
  const upperMinorsDeadEnd =
    level > 1 &&
    level < 6 &&
    age >= 26 &&
    developmentScore < 30 &&
    utilityScore < 30 &&
    pressureScore >= 60 &&
    peerDevelopment.pace ===
      'behind';

  if (
    upperMinorsDeadEnd
  ) {
    return {
      recommendation:
        'release_candidate',

      guardrails,
    };
  }


  /*
   * No compelling organizational reason to protect the roster spot, but the
   * evidence does not converge strongly enough for Front Office to affirmatively
   * recommend release.
   */
  return {
    recommendation:
      'expendable_depth',

    guardrails,
  };
}


export function computeMinorLeagueRetention(
  orgId: number,
  prospectData: ProspectDataLike = {
    batters: [],
    pitchers: [],
  }
): MinorLeagueRetentionResult {
  const philosophy =
    philosophyForRetention(
      orgId
    );

  const contracts =
    contractsByPlayer();

  const values =
    valuesByPlayer();

  const prospects =
    prospectMap(
      prospectData
    );

  const developmentHistory =
    developmentTrendByPlayer();

  const peerDevelopment =
    peerDevelopmentTrendByPlayer();

  const health =
    computeMinorLeagueRosterHealth(
      orgId
    );

  const healthByTeam =
    affiliateMap(
      health
    );

  const players =
    orgPlayers(
      orgId
    ).map(
      (
        player
      ): MinorLeagueRetentionPlayer => {
        const value =
          values.get(
            player.player_id
          );

        const current =
          value?.oaRating ??
          null;

        const potential =
          value?.potRating ??
          null;

        const protection =
          evaluateDevelopmentProtection({
            age:
              player.age,

            current,

            potential,
          });

        const history =
          developmentHistory.get(
            player.player_id
          ) ?? {
            status:
              'insufficient' as const,

            snapshotCount:
              0,

            firstDate:
              null,

            latestDate:
              null,

            observationDays:
              null,

            currentDelta:
              null,

            potentialDelta:
              null,

            reasons: [
              'No persistent scouting-history snapshots are available for this player.',
            ],
          };

        const peerHistory =
          peerDevelopment.get(
            player.player_id
          ) ?? {
            pace:
              'insufficient' as const,

            percentile:
              null,

            ratePer100Days:
              null,

            cohortMedianRate:
              null,

            peerAdjustedRate:
              null,

            cohortSize:
              0,

            cohort:
              null,

            reasons: [
              'No peer-adjusted scouting-development baseline is available for this player.',
            ],
          };

        const kind:
          PlayerKind =
            player.position === 1
              ? 'pitcher'
              : 'hitter';

        const positions =
          kind === 'hitter'
            ? playablePositions(
                player.player_id,
                player.position
              )
            : [];

        const pitcherRole =
          kind === 'pitcher'
            ? (
                evaluatePitcherDevelopmentalRole(
                  player.player_id
                )?.developmentalRole ??
                (
                  player.role === 11
                    ? 'starter'
                    : 'reliever'
                )
              )
            : null;

        const internalNeed =
          kind === 'hitter'
            ? sameLevelHitterNeed(
                player,
                positions,
                health
              )
            : sameLevelPitcherNeed(
                player,
                pitcherRole ??
                  'reliever',
                health
              );

        const legalMoves =
          legalDevelopmentMoves(
            prospects.get(
              player.player_id
            )
          );

        const team =
          healthByTeam.get(
            player.team_id
          );

        const utility =
          kind === 'hitter'
            ? hitterUtility(
                positions,
                internalNeed,
                team,
                philosophy
              )
            : pitcherUtility(
                pitcherRole ??
                  'reliever',
                internalNeed,
                team,
                philosophy
              );

        const pressure =
          rosterPressure(
            player,
            kind,
            positions,
            pitcherRole,
            internalNeed,
            team,
            philosophy
          );

        const phi =
          retentionPhilosophyAdjustment(
            player,
            protection,
            current,
            potential,
            philosophy
          );

        const developmentScore =
          round1(
            clamp(
              protection.score +
              phi.adjustment
            )
          );

        const contract =
          contracts.get(
            player.player_id
          );

        const transaction = {
          active:
            player.is_active ===
            1,

          onSecondary:
            player
              .is_on_secondary ===
            1,

          onInjuredList:
            player.is_on_dl ===
              1 ||
            player.is_on_dl60 ===
              1,

          onDl60:
            player.is_on_dl60 ===
            1,

          mustBeActive:
            player
              .must_be_active ===
            1,

          majorContract:
            contract?.isMajor ??
            false,

          salaryNow:
            contract?.salaryNow ??
            0,

          yearsAfterThis:
            contract?.yearsAfterThis ??
            0,

          mlbServiceYears:
            Number(
              player
                .mlb_service_years ??
              0
            ),

          secondaryServiceYears:
            Number(
              player
                .secondary_service_years ??
              0
            ),

          proServiceYears:
            Number(
              player
                .pro_service_years ??
              0
            ),

          yearsProtectedFromRule5:
            player
              .years_protected_from_rule_5 ==
            null
              ? null
              : Number(
                  player
                    .years_protected_from_rule_5
                ),
        };

        const runway =
          developmentalRunway(
            player.level,
            player.age,
            transaction.proServiceYears,
            current,
            potential,
            protection
          );

        const decision =
          recommendationFor(
            player.age,
            player.level,
            runway,
            protection,
            {
              onSecondary:
                transaction.onSecondary,

              onInjuredList:
                transaction
                  .onInjuredList,

              mustBeActive:
                transaction
                  .mustBeActive,

              majorContract:
                transaction
                  .majorContract,
            },
            legalMoves,
            internalNeed,
            developmentScore,
            utility.score,
            pressure.score,
            peerHistory
          );

        const summary:
          string[] = [];

        if (
          decision
            .recommendation ===
          'release_candidate'
        ) {
          summary.push(
            player.level >= 6
              ? 'Limited Rookie-level runway, low developmental value, low identified organizational utility, and substantial roster pressure support release consideration.'
              : 'Older organizational depth combines low retention value, limited identified utility, meaningful roster pressure, and behind-peer scouting development.'
          );
        } else if (
          decision
            .recommendation ===
          'expendable_depth'
        ) {
          summary.push(
            'No strong organizational retention case is identified, but the evidence does not justify an affirmative release recommendation.'
          );
        } else if (
          decision
            .recommendation ===
          'protected'
        ) {
          summary.push(
            'Transaction or developmental guardrails remove this player from routine minor-league release consideration.'
          );
        } else {
          summary.push(
            'Current developmental or organizational evidence supports retaining the player.'
          );
        }

        return {
          playerId:
            player.player_id,

          name:
            `${player.first_name} ${player.last_name}`,

          age:
            player.age,

          kind,

          teamId:
            player.team_id,

          team:
            teamLabel(
              player
            ),

          level:
            player.level,

          levelName:
            LEVEL_NAMES[
              player.level
            ] ??
            `L${player.level}`,

          current,
          potential,

          protection,

          transaction,

          role: {
            listedPosition:
              POSITION_CODES[
                player.position -
                1
              ] ?? '?',

            playablePositions:
              positions,

            developmentalPitcherRole:
              pitcherRole,

            internalSameLevelNeed:
              internalNeed,

            legalDevelopmentMoves:
              legalMoves,
          },

          evidence: {
            development: {
              score:
                developmentScore,

              reasons: [
                ...protection.reasons,
                ...phi.reasons,
              ],
            },

            developmentalRunway:
              runway,

            developmentHistory:
              history,

            peerDevelopment:
              peerHistory,

            utility,

            rosterPressure: {
              score:
                pressure.score,

              reasons:
                pressure.reasons,
            },

            philosophy: {
              retentionAdjustment:
                phi.adjustment,

              pressureAdjustment:
                pressure
                  .philosophyAdjustment,

              reasons:
                phi.reasons,
            },
          },

          recommendation:
            decision.recommendation,

          guardrails:
            decision.guardrails,

          summary,
        };
      }
    );

  /*
   * Put actionable roster decisions first.
   *
   * Release candidates deserve the GM's attention first, followed by
   * expendable depth. Routine keeps and hard-protected players come afterward.
   */
  const order:
    Record<
      RetentionRecommendation,
      number
    > = {
      release_candidate: 0,
      expendable_depth: 1,
      retain: 2,
      protected: 3,
    };

  players.sort(
    (a, b) =>
      order[
        a.recommendation
      ] -
        order[
          b.recommendation
        ] ||
      b.evidence
          .rosterPressure
          .score -
        a.evidence
          .rosterPressure
          .score ||
      a.evidence
          .development
          .score -
        b.evidence
          .development
          .score
  );

  const counts = {
    protected:
      players.filter(
        (player) =>
          player.recommendation ===
          'protected'
      ).length,

    retain:
      players.filter(
        (player) =>
          player.recommendation ===
          'retain'
      ).length,

    expendable_depth:
      players.filter(
        (player) =>
          player.recommendation ===
          'expendable_depth'
      ).length,

    release_candidate:
      players.filter(
        (player) =>
          player.recommendation ===
          'release_candidate'
      ).length,
  };

  return {
    orgId,
    philosophy,
    counts,
    players,

    safeguards: [
      'Release candidates are advisory front-office flags, never automatic transactions.',
      'Core and protected prospects are excluded from routine minor-league release-candidate classification.',
      'Secondary/40-man roster players require MLB transaction analysis rather than simple minor-league release classification.',
      'Players on major-league contracts require separate MLB transaction analysis.',
      'Players currently on the injured list are excluded from release-candidate classification in V1.',
      'Developmentally justified promotions and demotions count as evidence of an internal organizational role.',
      'Same-level affiliate needs count as organizational utility before surplus is considered.',
      'Roster pressure and retention value remain separate evidence dimensions.',
      'Historical scouting development is surfaced as evidence but does not yet alter retention scoring.',
      'Player-rating evidence uses persisted scouting observations; the retention engine does not consult hidden omniscient ratings.',
      'Historical trend classification requires at least three snapshots spanning at least 75 in-game days.',
      'Peer development is compared against similar minor leaguers and uses percentile rank to account for broad scouting/rating movement.',
      'Rule 5 protection years are displayed as context but do not yet affect scoring.',
      'Recommendations are read-only and never modify the OOTP save.',
    ],
  };
}
