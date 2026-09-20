import {
  db,
} from './db.js';

import {
  loadScoutedAbilities,
} from './scoutedEvidence.js';

import {
  computeMinorLeagueRosterHealth,
  type AffiliateRosterHealth,
} from './minorLeagueRoster.js';

import {
  evaluateDevelopmentProtection,
  hasKnownTier,
  requireKnownProtection,
  type DevelopmentProtection,
} from './developmentFit.js';

import type {
  IndeterminateMoveCandidate,
  MissingEvidence,
} from './developmentJudgment.js';

import {
  evaluatePitcherRoster,
  pitcherRosterForTeam,
  type PitcherAssignmentRole,
  type PitcherRosterPiece,
  type PitcherRosterState,
} from './pitcherRosterSimulation.js';

import {
  resolvePhilosophy,
} from './philosophy.js';

import {
  philosophyForOrg,
} from './settings.js';


type MinorLeagueMoveKind =
  | 'same_level_reassignment'
  | 'normal_promotion'
  | 'skip_level_promotion'
  | 'demotion';

interface PitchingOperationsPhilosophy {
  prospectPreservation: number;
  promotionAggressiveness: number;
  pitchingDepth: number;
  rosterDepth: number;
  upsidePreference: number;
  ageCurveSensitivity: number;
}

interface OperationsPitcher
  extends PitcherRosterPiece {
  current: number | null;
  potential: number | null;
  protection: DevelopmentProtection;
}

interface ProspectAssignmentLike {
  kind:
    | 'normal_promotion'
    | 'skip_level_promotion'
    | 'demotion'
    | 'mlb_discussion';

  judgment:
    | 'defensible'
    | 'indefensible'
    | 'indeterminate';

  eligible: boolean;
  recommendation: string;

  missingEvidence: MissingEvidence[];

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

        compositePercentile: number | null;
        weakestCorePercentile: number | null;

        classification:
          | 'poor'
          | 'borderline'
          | 'viable'
          | 'strong'
          | 'indeterminate';
      };
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
      | 'strong'
      | 'indeterminate';

    compositePercentile: number | null;
    weakestCorePercentile: number | null;
  } | null;

  reasons: string[];
}

interface PitcherCandidate {
  kind: MinorLeagueMoveKind;

  player: OperationsPitcher;

  source: AffiliateRosterHealth;
  destination: AffiliateRosterHealth;

  destinationRole:
    PitcherAssignmentRole;

  development:
    DevelopmentAuthorization;
}

interface PitcherSearchMove
  extends PitcherCandidate {
  sourceBefore: PitcherRosterState;
  sourceAfter: PitcherRosterState;

  destinationBefore:
    PitcherRosterState;

  destinationAfter:
    PitcherRosterState;

  rosterBenefit: number;
}

interface RankedPitcherPlan {
  moves: PitcherSearchMove[];
  score: number;
}

interface PhilosophyInfluence {
  adjustment: number;
  reasons: string[];
}

export interface MinorLeaguePitcherMove {
  playerId: number;
  playerName: string;
  age: number;

  kind: MinorLeagueMoveKind;

  fromTeamId: number;
  fromTeam: string;

  toTeamId: number;
  toTeam: string;

  currentRole:
    PitcherAssignmentRole;

  developmentalRole:
    'starter' | 'reliever';

  destinationRole:
    PitcherAssignmentRole;

  protection:
    DevelopmentProtection;

  development: {
    authorizedBy:
      | 'development_protection'
      | 'prospect_assignment_engine';

    recommendation:
      string | null;

    destinationFit:
      DevelopmentAuthorization[
        'destinationFit'
      ];
  };

  philosophy: {
    adjustment: number;
    reasons: string[];
  };

  reasons: string[];
}

export interface MinorLeaguePitchingPlan {
  teamId: number;
  team: string;

  level: number;
  levelName: string;

  before: PitcherRosterState;
  after: PitcherRosterState;

  moves: MinorLeaguePitcherMove[];

  selectionScore: number;

  alternatives: Array<{
    rank: number;
    score: number;

    moves: Array<{
      playerId: number;
      playerName: string;

      kind: MinorLeagueMoveKind;

      destinationRole:
        PitcherAssignmentRole;

      philosophyAdjustment:
        number;
    }>;
  }>;

  summary: string[];
}

export interface MinorLeaguePitchingOperationsResult {
  philosophy:
    PitchingOperationsPhilosophy;

  affiliates: Array<{
    teamId: number;
    team: string;
    level: number;
    levelName: string;

    pitching:
      PitcherRosterState;
  }>;

  plans:
    MinorLeaguePitchingPlan[];

  rejected: Array<{
    playerId: number;
    playerName: string;

    kind:
      MinorLeagueMoveKind;

    fromTeam: string;
    toTeam: string;

    phase:
      | 'development'
      | 'operations';

    reasons: string[];
  }>;

  /**
   * Pitching candidates Player Development cannot judge for lack of
   * organization-visible rating evidence. Not approved, not rejected, and not
   * ranked with the plans; the roster need is stated with each.
   */
  indeterminate: IndeterminateMoveCandidate[];

  deferred: Array<{
    teamId: number;
    team: string;
    reason: string;
  }>;

  safeguards: string[];
}


function pitchersForTeam(
  teamId: number
): OperationsPitcher[] {
  const roster =
    pitcherRosterForTeam(
      teamId
    );

  /*
   * The roster is an objective fact. What the pitchers' ratings say comes only
   * from the scouted-evidence adapter.
   */
  const abilities =
    loadScoutedAbilities(
      roster.map(
        (pitcher) =>
          pitcher.playerId
      )
    );

  return roster.map((pitcher) => {
    const ability =
      abilities.for(
        pitcher.playerId
      );

    return {
      ...pitcher,

      current:
        ability.current,

      potential:
        ability.potential,

      protection:
        evaluateDevelopmentProtection({
          age: pitcher.age,

          ability,
        }),
    };
  });
}

function pitcherMap(
  health: AffiliateRosterHealth[]
): Map<
  number,
  OperationsPitcher[]
> {
  return new Map(
    health.map((team) => [
      team.teamId,
      pitchersForTeam(
        team.teamId
      ),
    ])
  );
}

function clonePitcherMap(
  source: Map<
    number,
    OperationsPitcher[]
  >
): Map<
  number,
  OperationsPitcher[]
> {
  return new Map(
    [...source.entries()].map(
      ([teamId, pitchers]) => [
        teamId,
        pitchers.map(
          (pitcher) => ({
            ...pitcher,
          })
        ),
      ]
    )
  );
}

function philosophyForOperations(
  orgId: number
): PitchingOperationsPhilosophy {
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

    promotionAggressiveness:
      philosophy.dimensions
        .promotionAggressiveness
        .value,

    pitchingDepth:
      philosophy.dimensions
        .pitchingDepth
        .value,

    rosterDepth:
      philosophy.dimensions
        .rosterDepth
        .value,

    upsidePreference:
      philosophy.dimensions
        .upsidePreference
        .value,

    ageCurveSensitivity:
      philosophy.dimensions
        .ageCurveSensitivity
        .value,
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

function structuralSeverity(
  state: PitcherRosterState
): number {
  if (
    state.structuralStatus ===
    'critical'
  ) {
    return 2;
  }

  if (
    state.structuralStatus ===
    'thin'
  ) {
    return 1;
  }

  return 0;
}

function statusNeed(
  status: string,
  critical: number,
  thin: number
): number {
  if (
    status === 'critical'
  ) {
    return critical;
  }

  if (
    status === 'thin'
  ) {
    return thin;
  }

  return 0;
}

function pitchingNeedScore(
  state: PitcherRosterState
): number {
  return (
    statusNeed(
      state.bodyCountStatus,
      100,
      45
    ) +

    statusNeed(
      state.rotationStatus,
      125,
      65
    ) +

    statusNeed(
      state.bullpenStatus,
      110,
      55
    )
  );
}

function sameLevelProtectionCost(
  unknownProtection:
    DevelopmentProtection,
  philosophy:
    PitchingOperationsPhilosophy
): number {
  // Indeterminate pitchers are set aside before ranking; reaching here with one throws
  const protection =
    requireKnownProtection(
      unknownProtection
    );

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

  return (
    base *
    (
      1 +
      centeredPreference(
        philosophy
          .prospectPreservation
      ) *
        0.5
    )
  );
}

function destinationStretchCost(
  development:
    DevelopmentAuthorization
): number {
  const fit =
    development
      .destinationFit;

  if (!fit) {
    return 10;
  }

  if (
    fit.classification ===
    'strong'
  ) {
    return -10;
  }

  if (
    fit.classification ===
    'viable'
  ) {
    return 0;
  }

  if (
    fit.classification ===
    'borderline'
  ) {
    return 15;
  }

  if (
    fit.classification ===
    'indeterminate'
  ) {
    /*
     * The destination comparison could not be made for lack of visible
     * ratings. This term only ranks moves Player Development has already
     * approved; it is omitted rather than given a value, so the missing
     * comparison neither helps nor hurts the move.
     */
    return 0;
  }

  return 30;
}

function developmentCost(
  candidate:
    PitcherCandidate,
  philosophy:
    PitchingOperationsPhilosophy
): number {
  if (
    candidate.kind ===
    'same_level_reassignment'
  ) {
    return (
      sameLevelProtectionCost(
        candidate.player
          .protection,
        philosophy
      )
    );
  }

  if (
    candidate.kind ===
    'normal_promotion'
  ) {
    const evidenceCost =
      candidate.development
        .recommendation ===
        'strong'
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

function sourcePitchingPressure(
  state: PitcherRosterState
): {
  body: number;
  rotation: number;
  bullpen: number;
} {
  /*
   * Healthy floors:
   * 12 pitchers,
   * 5 starters,
   * 7 relief pitchers.
   *
   * Philosophy only changes the value of extra margin above those hard floors.
   */
  return {
    body:
      Math.max(
        0,
        2 - (
          state.total - 12
        )
      ),

    rotation:
      Math.max(
        0,
        1 - (
          state.starters - 5
        )
      ),

    bullpen:
      Math.max(
        0,
        2 - (
          state.relievers - 7
        )
      ),
  };
}

function philosophyInfluence(
  move: PitcherSearchMove,
  philosophy:
    PitchingOperationsPhilosophy
): PhilosophyInfluence {
  let adjustment = 0;

  const reasons: string[] =
    [];

  const add = (
    amount: number,
    reason: string
  ) => {
    if (
      !Number.isFinite(
        amount
      ) ||
      Math.abs(amount) < 0.25
    ) {
      return;
    }

    adjustment += amount;

    reasons.push(
      `${reason} (${amount >= 0 ? '+' : ''}${amount.toFixed(1)}).`
    );
  };

  if (
    move.kind ===
      'normal_promotion'
  ) {
    add(
      -centeredPreference(
        philosophy
          .promotionAggressiveness
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
        philosophy
          .promotionAggressiveness
      ) * 4,

      'Promotion aggressiveness'
    );

    add(
      centeredPreference(
        philosophy
          .prospectPreservation
      ) * 10,

      'Prospect preservation makes a level skip more consequential'
    );
  }

  if (
    move.kind ===
      'demotion'
  ) {
    const knownTier =
      requireKnownProtection(
        move.player.protection
      ).tier;

    const weight =
      knownTier ===
        'core_prospect'
        ? 1
        : knownTier ===
            'protected_prospect'
          ? 0.8
          : knownTier ===
              'development_priority'
            ? 0.5
            : knownTier ===
                'normal'
              ? 0.25
              : 0;

    add(
      centeredPreference(
        philosophy
          .prospectPreservation
      ) *
        15 *
        weight,

      'Prospect preservation'
    );
  }

  const pressure =
    sourcePitchingPressure(
      move.sourceAfter
    );

  add(
    centeredPreference(
      philosophy.pitchingDepth
    ) *
      (
        pressure.rotation * 6 +
        pressure.bullpen * 5
      ),

    'Pitching-depth preference'
  );

  add(
    centeredPreference(
      philosophy.rosterDepth
    ) *
      pressure.body *
      4,

    'General roster-depth preference'
  );

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
      const upside =
        Math.min(
          1,
          Math.max(
            0,
            potential - current
          ) / 20
        );

      add(
        centeredPreference(
          philosophy
            .upsidePreference
        ) *
          12 *
          upside,

        'Preference for preserving upside'
      );
    }

    const ageFactor =
      Math.max(
        0,
        Math.min(
          1,
          (
            move.player.age -
            24
          ) / 8
        )
      );

    add(
      -centeredPreference(
        philosophy
          .ageCurveSensitivity
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

function planScore(
  moves: PitcherSearchMove[],
  philosophy:
    PitchingOperationsPhilosophy
): number {
  return moves.reduce(
    (sum, move) =>
      sum +
      developmentCost(
        move,
        philosophy
      ) +
      philosophyInfluence(
        move,
        philosophy
      ).adjustment -
      move.rosterBenefit *
        1.25,

    0
  );
}

function assignmentKind(
  kind:
    ProspectAssignmentLike[
      'kind'
    ]
): MinorLeagueMoveKind | null {
  if (
    kind ===
      'normal_promotion' ||
    kind ===
      'skip_level_promotion' ||
    kind ===
      'demotion'
  ) {
    return kind;
  }

  return null;
}

function prospectPitchers(
  data: ProspectDataLike
): ProspectLike[] {
  return (
    data.pitchers as
      ProspectLike[]
  );
}

function developmentalDestinationRole(
  player: OperationsPitcher
): PitcherAssignmentRole {
  /*
   * "Closer" is an in-game usage designation, not a separate developmental
   * track. A non-starter development assignment therefore enters the bullpen.
   */
  return (
    player.developmentalRole ===
      'starter'
      ? 'starter'
      : 'reliever'
  );
}

function buildCandidates(
  destination:
    AffiliateRosterHealth,
  peers:
    AffiliateRosterHealth[],
  rosters: Map<
    number,
    OperationsPitcher[]
  >,
  prospectData:
    ProspectDataLike,
  philosophy:
    PitchingOperationsPhilosophy
): {
  candidates:
    PitcherCandidate[];

  rejected:
    MinorLeaguePitchingOperationsResult[
      'rejected'
    ];

  indeterminate:
    IndeterminateMoveCandidate[];
} {
  const candidates:
    PitcherCandidate[] = [];

  const rejected:
    MinorLeaguePitchingOperationsResult[
      'rejected'
    ] = [];

  const indeterminate:
    IndeterminateMoveCandidate[] = [];

  const indeterminateMove = (
    player: {
      playerId: number;
      name: string;
    },
    kind: string,
    source: AffiliateRosterHealth,
    missingEvidence: MissingEvidence[],
    reasons: string[]
  ): IndeterminateMoveCandidate => ({
    playerId: player.playerId,
    playerName: player.name,
    kind,
    fromTeamId: source.teamId,
    fromTeam: source.label,
    toTeamId: destination.teamId,
    toTeam: destination.label,
    phase: 'development',
    developmentJudgment: 'indeterminate',
    missingEvidence,

    /* The destination's need is objective and stated regardless of the development question. */
    rosterNeed: [
      `${destination.label} is ${destination.overall.toUpperCase()}.`,
      ...destination.issues,
    ],

    reasons,
  });

  const healthByTeam =
    new Map(
      peers.map((team) => [
        team.teamId,
        team,
      ])
    );

  /*
   * Same-level redistribution considers every active pitcher,
   * not merely pitchers with enough innings to appear in the Prospect screen.
   */
  for (const source of peers) {
    if (
      source.teamId ===
        destination.teamId ||
      source.level !==
        destination.level
    ) {
      continue;
    }

    const sourceRoster =
      rosters.get(
        source.teamId
      ) ?? [];

    const sourceState =
      evaluatePitcherRoster(
        sourceRoster
      );

    if (
      sourceState
        .structuralStatus !==
      'healthy'
    ) {
      continue;
    }

    for (
      const player of
      sourceRoster
    ) {
      /*
       * Whether a same-level move respects the pitcher's developmental
       * protection cannot be answered without his ratings. He is listed as
       * indeterminate with the roster need — neither cleared nor refused — and
       * kept out of the ranked plans.
       */
      if (!hasKnownTier(player.protection)) {
        indeterminate.push(
          indeterminateMove(
            player,
            'same_level_reassignment',
            source,
            player.protection.missingEvidence,
            [
              'Developmental protection cannot be determined without organization-visible current and potential ratings, so Player Development cannot say whether this same-level move is defensible.',
            ]
          )
        );

        continue;
      }

      /*
       * Core prospects are never generic roster-balancing pieces.
       */
      if (
        player.protection.tier ===
        'core_prospect'
      ) {
        continue;
      }

      candidates.push({
        kind:
          'same_level_reassignment',

        player,
        source,
        destination,

        destinationRole:
          developmentalDestinationRole(
            player
          ),

        development: {
          authorizedBy:
            'development_protection',

          recommendation: null,

          destinationFit: null,

          reasons: [
            'Same-level reassignment preserves the pitcher’s developmental level.',
            `Developmental role remains ${player.developmentalRole}.`,
          ],
        },
      });
    }
  }

  /*
   * Level-changing movement may enter this pool only through the
   * Prospect Assignment Engine.
   */
  for (
    const prospect of
    prospectPitchers(
      prospectData
    )
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

    if (!source) {
      continue;
    }

    const player =
      (
        rosters.get(
          source.teamId
        ) ?? []
      ).find(
        (candidate) =>
          candidate.playerId ===
          prospect.player_id
      );

    if (!player) {
      continue;
    }

    for (
      const evaluation of
      prospect.assignments
        .evaluations
    ) {
      const kind =
        assignmentKind(
          evaluation.kind
        );

      if (!kind) {
        continue;
      }

      if (
        evaluation.target
          .isMajorLeague
      ) {
        continue;
      }

      if (
        !evaluation.target.teams
          .some(
            (team) =>
              team.teamId ===
              destination.teamId
          )
      ) {
        continue;
      }

      /*
       * Player Development's judgment has three outcomes. Only `indefensible`
       * is a rejection; `indeterminate` is surfaced with the roster need and
       * the missing evidence, and is never treated as approved.
       */
      if (
        evaluation.judgment ===
        'indeterminate'
      ) {
        indeterminate.push(
          indeterminateMove(
            player,
            kind,
            source,
            evaluation.missingEvidence,
            [
              'Player Development cannot yet say whether this assignment is defensible; the required organization-visible evidence is missing.',
              ...evaluation.reasons,
            ]
          )
        );

        continue;
      }

      if (
        evaluation.judgment ===
        'indefensible'
      ) {
        rejected.push({
          playerId:
            prospect.player_id,

          playerName:
            prospect.name,

          kind,

          fromTeam:
            source.label,

          toTeam:
            destination.label,

          phase:
            'development',

          reasons:
            evaluation.blockers
              .length > 0
              ? evaluation.blockers
              : [
                  'Player Development did not authorize this assignment.',
                ],
        });

        continue;
      }

      /*
       * Defensible level movement still depends on the pitcher's protection
       * for the role he would fill; with that indeterminate the assignment is
       * not established as a whole.
       */
      if (!hasKnownTier(player.protection)) {
        indeterminate.push(
          indeterminateMove(
            player,
            kind,
            source,
            player.protection.missingEvidence,
            [
              'Player Development authorized this assignment, but the pitcher\'s developmental protection cannot be determined without organization-visible ratings.',
              ...evaluation.reasons,
            ]
          )
        );

        continue;
      }

      const sourceState =
        evaluatePitcherRoster(
          rosters.get(
            source.teamId
          ) ?? []
        );

      if (
        sourceState
          .structuralStatus !==
        'healthy'
      ) {
        rejected.push({
          playerId:
            prospect.player_id,

          playerName:
            prospect.name,

          kind,

          fromTeam:
            source.label,

          toTeam:
            destination.label,

          phase:
            'operations',

          reasons: [
            `${source.label} already has a ${sourceState.structuralStatus.toUpperCase()} pitching structure.`,
          ],
        });

        continue;
      }

      const fit =
        evaluation
          .destinationFit
          ?.teams.find(
            (item) =>
              item.fit
                .destinationTeamId ===
              destination.teamId
          )?.fit ?? null;

      candidates.push({
        kind,

        player,
        source,
        destination,

        destinationRole:
          developmentalDestinationRole(
            player
          ),

        development: {
          authorizedBy:
            'prospect_assignment_engine',

          recommendation:
            evaluation
              .recommendation,

          destinationFit:
            fit
              ? {
                  classification:
                    fit.classification,

                  compositePercentile:
                    fit.compositePercentile,

                  weakestCorePercentile:
                    fit.weakestCorePercentile,
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
      developmentCost(
        a,
        philosophy
      ) -
      developmentCost(
        b,
        philosophy
      )
  );

  return {
    candidates,
    rejected,
    indeterminate,
  };
}

function findPlans(
  destination:
    AffiliateRosterHealth,
  peers:
    AffiliateRosterHealth[],
  originalRosters: Map<
    number,
    OperationsPitcher[]
  >,
  prospectData:
    ProspectDataLike,
  philosophy:
    PitchingOperationsPhilosophy
): {
  plans: RankedPitcherPlan[];
  rejected:
    MinorLeaguePitchingOperationsResult[
      'rejected'
    ];
  indeterminate:
    IndeterminateMoveCandidate[];
} {
  const baseline =
    evaluatePitcherRoster(
      originalRosters.get(
        destination.teamId
      ) ?? []
    );

  if (
    baseline.structuralStatus ===
    'healthy'
  ) {
    return {
      plans: [],
      rejected: [],
      indeterminate: [],
    };
  }

  const pool =
    buildCandidates(
      destination,
      peers,
      originalRosters,
      prospectData,
      philosophy
    );

  let bestLength:
    number | null = null;

  let completed:
    RankedPitcherPlan[] = [];

  function search(
    rosters: Map<
      number,
      OperationsPitcher[]
    >,
    moves:
      PitcherSearchMove[],
    startIndex: number
  ): void {
    const destinationRoster =
      rosters.get(
        destination.teamId
      ) ?? [];

    const destinationState =
      evaluatePitcherRoster(
        destinationRoster
      );

    if (
      destinationState
        .structuralStatus ===
      'healthy'
    ) {
      const score =
        planScore(
          moves,
          philosophy
        );

      if (
        bestLength === null ||
        moves.length <
          bestLength
      ) {
        bestLength =
          moves.length;

        completed = [];
      }

      if (
        moves.length ===
        bestLength
      ) {
        completed.push({
          moves: [...moves],
          score,
        });
      }

      return;
    }

    if (
      moves.length >= 3
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
      index <
      pool.candidates.length;
      index++
    ) {
      const candidate =
        pool.candidates[index];

      if (
        moves.some(
          (move) =>
            move.player
              .playerId ===
            candidate.player
              .playerId
        )
      ) {
        continue;
      }

      const sourceRoster =
        rosters.get(
          candidate.source
            .teamId
        ) ?? [];

      const currentPlayer =
        sourceRoster.find(
          (pitcher) =>
            pitcher.playerId ===
            candidate.player
              .playerId
        );

      if (!currentPlayer) {
        continue;
      }

      const sourceBefore =
        evaluatePitcherRoster(
          sourceRoster
        );

      if (
        sourceBefore
          .structuralStatus !==
        'healthy'
      ) {
        continue;
      }

      const sourceAfterRoster =
        sourceRoster.filter(
          (pitcher) =>
            pitcher.playerId !==
            currentPlayer.playerId
        );

      const sourceAfter =
        evaluatePitcherRoster(
          sourceAfterRoster
        );

      /*
       * A solution may not export a rotation/bullpen shortage to another club.
       */
      if (
        sourceAfter
          .structuralStatus !==
        'healthy'
      ) {
        continue;
      }

      const destinationBefore =
        evaluatePitcherRoster(
          destinationRoster
        );

      const movedPlayer:
        OperationsPitcher = {
          ...currentPlayer,

          assignedRole:
            candidate
              .destinationRole,
        };

      const destinationAfterRoster = [
        ...destinationRoster,
        movedPlayer,
      ];

      const destinationAfter =
        evaluatePitcherRoster(
          destinationAfterRoster
        );

      /*
       * Every step must at least avoid making the destination structurally
       * worse. Multi-move solutions may require one move that improves body
       * count without immediately resolving rotation/bullpen health.
       */
      if (
        structuralSeverity(
          destinationAfter
        ) >
        structuralSeverity(
          destinationBefore
        )
      ) {
        continue;
      }

      const rosterBenefit =
        pitchingNeedScore(
          destinationBefore
        ) -
        pitchingNeedScore(
          destinationAfter
        );

      if (
        rosterBenefit <= 0
      ) {
        /*
         * Do not move a pitcher simply because movement is legal.
         * He must actually improve the roster problem being solved.
         */
        continue;
      }

      const next =
        clonePitcherMap(
          rosters
        );

      next.set(
        candidate.source
          .teamId,
        sourceAfterRoster
      );

      next.set(
        destination.teamId,
        destinationAfterRoster
      );

      search(
        next,
        [
          ...moves,

          {
            ...candidate,

            player:
              currentPlayer,

            sourceBefore,
            sourceAfter,

            destinationBefore,
            destinationAfter,

            rosterBenefit,
          },
        ],

        index + 1
      );
    }
  }

  search(
    clonePitcherMap(
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

    indeterminate:
      pool.indeterminate,
  };
}

function moveReasons(
  move: PitcherSearchMove
): string[] {
  const roleSentence =
    move.player.currentRole ===
      move.destinationRole
      ? `Pitching role remains ${move.destinationRole}.`
      : `Current ${move.player.currentRole} usage changes to a developmental ${move.destinationRole} role.`;

  if (
    move.kind ===
    'same_level_reassignment'
  ) {
    return [
      'Same-level reassignment preserves developmental level.',
      roleSentence,
      'The move improves the destination pitching structure.',
      'The source pitching staff remains structurally healthy.',
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
    roleSentence,
    'The move improves the destination pitching structure.',
    'The source pitching staff remains structurally healthy.',
  ];
}

export function computeMinorLeaguePitchingOperations(
  orgId: number,
  prospectData: ProspectDataLike = {
    batters: [],
    pitchers: [],
  }
): MinorLeaguePitchingOperationsResult {
  const philosophy =
    philosophyForOperations(
      orgId
    );

  const health =
    computeMinorLeagueRosterHealth(
      orgId
    );

  const rosters =
    pitcherMap(
      health
    );

  const plans:
    MinorLeaguePitchingPlan[] =
      [];

  const rejected:
    MinorLeaguePitchingOperationsResult[
      'rejected'
    ] = [];

  const indeterminate:
    IndeterminateMoveCandidate[] = [];

  const deferred:
    MinorLeaguePitchingOperationsResult[
      'deferred'
    ] = [];

  for (
    const destination of
    health
  ) {
    const baseline =
      evaluatePitcherRoster(
        rosters.get(
          destination.teamId
        ) ?? []
      );

    if (
      baseline
        .structuralStatus ===
      'healthy'
    ) {
      continue;
    }

    if (
      destination.level >= 6
    ) {
      deferred.push({
        teamId:
          destination.teamId,

        team:
          destination.label,

        reason:
          'Rookie-level pitching movement is deferred until ACL/DSL assignment rules are modeled explicitly.',
      });

      continue;
    }

    const result =
      findPlans(
        destination,
        health,
        rosters,
        prospectData,
        philosophy
      );

    rejected.push(
      ...result.rejected
    );

    indeterminate.push(
      ...result.indeterminate
    );

    const best =
      result.plans[0];

    if (!best) {
      continue;
    }

    const simulated =
      clonePitcherMap(
        rosters
      );

    for (
      const move of
      best.moves
    ) {
      const sourceRoster =
        simulated.get(
          move.source.teamId
        ) ?? [];

      const player =
        sourceRoster.find(
          (candidate) =>
            candidate.playerId ===
            move.player.playerId
        );

      if (!player) {
        continue;
      }

      simulated.set(
        move.source.teamId,

        sourceRoster.filter(
          (candidate) =>
            candidate.playerId !==
            player.playerId
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

          {
            ...player,

            assignedRole:
              move.destinationRole,
          },
        ]
      );
    }

    const before =
      evaluatePitcherRoster(
        rosters.get(
          destination.teamId
        ) ?? []
      );

    const after =
      evaluatePitcherRoster(
        simulated.get(
          destination.teamId
        ) ?? []
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

      before,
      after,

      moves:
        best.moves.map(
          (move) => {
            const influence =
              philosophyInfluence(
                move,
                philosophy
              );

            return {
              playerId:
                move.player
                  .playerId,

              playerName:
                move.player.name,

              age:
                move.player.age,

              kind:
                move.kind,

              fromTeamId:
                move.source.teamId,

              fromTeam:
                move.source.label,

              toTeamId:
                move.destination.teamId,

              toTeam:
                move.destination.label,

              currentRole:
                move.player
                  .currentRole,

              developmentalRole:
                move.player
                  .developmentalRole,

              destinationRole:
                move.destinationRole,

              protection:
                move.player
                  .protection,

              development: {
                authorizedBy:
                  move.development
                    .authorizedBy,

                recommendation:
                  move.development
                    .recommendation,

                destinationFit:
                  move.development
                    .destinationFit,
              },

              philosophy:
                influence,

              reasons:
                moveReasons(
                  move
                ),
            };
          }
        ),

      selectionScore:
        best.score,

      alternatives:
        result.plans
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
                      move.player
                        .playerId,

                    playerName:
                      move.player.name,

                    kind:
                      move.kind,

                    destinationRole:
                      move.destinationRole,

                    philosophyAdjustment:
                      philosophyInfluence(
                        move,
                        philosophy
                      ).adjustment,
                  })
                ),
            })
          ),

      summary: [
        `${destination.label} pitching improves from ${before.structuralStatus.toUpperCase()} to ${after.structuralStatus.toUpperCase()}.`,
        `Rotation: ${before.starters} starters → ${after.starters}.`,
        `Bullpen: ${before.relievers} relief arms → ${after.relievers}.`,
        'Every level-changing move was independently authorized by Player Development.',
        'No source pitching staff is allowed to become structurally unhealthy.',
      ],
    });
  }

  return {
    philosophy,

    affiliates:
      health.map(
        (team) => ({
          teamId:
            team.teamId,

          team:
            team.label,

          level:
            team.level,

          levelName:
            team.levelName,

          pitching:
            evaluatePitcherRoster(
              rosters.get(
                team.teamId
              ) ?? []
            ),
        })
      ),

    plans,
    rejected,
    indeterminate,
    deferred,

    safeguards: [
      'Pitching need cannot manufacture a promotion, demotion, or level skip.',
      'Every level-changing pitcher move must already be authorized by Player Development.',
      'Same-level balancing considers every active pitcher, including pitchers without a qualifying Prospect-screen sample.',
      'Core prospects cannot be used as ordinary same-level roster fillers.',
      'Developmental pitcher role, not current OOTP usage alone, determines the proposed destination role.',
      'A source rotation/bullpen must remain structurally healthy after every proposed move.',
      'A pitcher must improve the destination pitching problem; legal movement alone is not enough.',
      'Rookie-level movement remains deferred until ACL/DSL assignment rules are modeled explicitly.',
      'A pitcher move Player Development cannot judge for lack of organization-visible ratings is listed as indeterminate: it is not approved, not rejected, and not ranked with the plans.',
      'Recommendations are read-only and never modify the OOTP save.',
    ],
  };
}
