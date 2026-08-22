import { db } from './db.js';

import type {
  ProspectAssignmentEvaluation,
  ProspectAssignmentPlan,
} from './prospectAssignments.js';

export type DestinationPlayerKind =
  | 'hitter'
  | 'starter'
  | 'reliever';

export type DestinationFitClassification =
  | 'poor'
  | 'borderline'
  | 'viable'
  | 'strong';

export interface DestinationFitComponent {
  key: string;
  label: string;

  playerRating: number;

  /**
   * Percentile among active players of the relevant type in the actual
   * destination league. Higher is better.
   */
  percentile: number;

  population: number;

  /**
   * OOTP's exported league-average rating field, normalized from the
   * approximately 10x internal export scale for context only.
   *
   * This is NOT used as the primary percentile calculation.
   */
  exportedLeagueAverage: number | null;

  weight: number;
  core: boolean;
}

export interface PitcherRoleAssessment {
  currentRole: 'starter' | 'reliever';
  developmentalRole: 'starter' | 'reliever';

  stamina: number | null;

  establishedPitches: number;
  thirdBestPitch: number | null;

  reasons: string[];
}

export interface DestinationFit {
  playerId: number;

  destinationTeamId: number;
  destinationTeam: string;

  leagueId: number;
  leagueName: string;
  leagueLevel: number;

  kind: DestinationPlayerKind;

  /**
   * Pitcher role used for destination comparison. This can differ from the
   * player's current roster role when his stamina and repertoire still support
   * starter development.
   */
  roleAssessment: PitcherRoleAssessment | null;

  components: DestinationFitComponent[];

  /**
   * Weighted mean of component percentiles.
   */
  compositePercentile: number;

  /**
   * Lowest percentile among skills designated as essential for the role.
   * Prevents one elite tool from hiding a serious developmental weakness.
   */
  weakestCorePercentile: number;

  classification: DestinationFitClassification;

  populationMinimum: number;

  notes: string[];
}

export interface DestinationFitGate {
  levelsSkipped: number;

  requiredCompositePercentile: number;
  requiredWeakestCorePercentile: number;

  passes: boolean;

  reasons: string[];
}

export interface AssignmentDestinationFit {
  teams: Array<{
    fit: DestinationFit;
    gate: DestinationFitGate | null;
  }>;

  eligibleTeamIds: number[];
}

export type ProspectAssignmentEvaluationWithDestinationFit =
  ProspectAssignmentEvaluation & {
    destinationFit: AssignmentDestinationFit | null;
  };

export interface ProspectAssignmentPlanWithDestinationFit {
  evaluations: ProspectAssignmentEvaluationWithDestinationFit[];
  eligible: ProspectAssignmentEvaluationWithDestinationFit[];
}

interface PlayerRatings {
  playerId: number;
  position: number;
  role: number;

  contact: number | null;
  gap: number | null;
  power: number | null;
  eye: number | null;
  avoidK: number | null;

  stuff: number | null;
  movement: number | null;
  control: number | null;
  stamina: number | null;

  pitches: number[];
}

interface LeagueInfo {
  teamId: number;
  team: string;

  leagueId: number;
  leagueName: string;
  leagueLevel: number;

  avgContact: number | null;
  avgGap: number | null;
  avgPower: number | null;
  avgEye: number | null;
  avgAvoidK: number | null;

  avgStuff: number | null;
  avgMovement: number | null;
  avgControl: number | null;
}

interface ComponentDefinition {
  key: keyof PlayerRatings;
  label: string;
  weight: number;
  core: boolean;
  leagueAverage:
    | keyof LeagueInfo
    | null;
}

const HITTER_COMPONENTS: ComponentDefinition[] = [
  {
    key: 'contact',
    label: 'Contact',
    weight: 0.28,
    core: true,
    leagueAverage: 'avgContact',
  },
  {
    key: 'gap',
    label: 'Gap Power',
    weight: 0.10,
    core: false,
    leagueAverage: 'avgGap',
  },
  {
    key: 'power',
    label: 'Power',
    weight: 0.22,
    core: false,
    leagueAverage: 'avgPower',
  },
  {
    key: 'eye',
    label: 'Eye',
    weight: 0.20,
    core: true,
    leagueAverage: 'avgEye',
  },
  {
    key: 'avoidK',
    label: 'Avoid K',
    weight: 0.20,
    core: true,
    leagueAverage: 'avgAvoidK',
  },
];

const STARTER_COMPONENTS: ComponentDefinition[] = [
  {
    key: 'stuff',
    label: 'Stuff',
    weight: 0.28,
    core: true,
    leagueAverage: 'avgStuff',
  },
  {
    key: 'movement',
    label: 'Movement',
    weight: 0.24,
    core: true,
    leagueAverage: 'avgMovement',
  },
  {
    key: 'control',
    label: 'Control',
    weight: 0.28,
    core: true,
    leagueAverage: 'avgControl',
  },
  {
    key: 'stamina',
    label: 'Stamina',
    weight: 0.20,
    core: true,
    leagueAverage: null,
  },
];

const RELIEVER_COMPONENTS: ComponentDefinition[] = [
  {
    key: 'stuff',
    label: 'Stuff',
    weight: 0.38,
    core: true,
    leagueAverage: 'avgStuff',
  },
  {
    key: 'movement',
    label: 'Movement',
    weight: 0.31,
    core: true,
    leagueAverage: 'avgMovement',
  },
  {
    key: 'control',
    label: 'Control',
    weight: 0.31,
    core: true,
    leagueAverage: 'avgControl',
  },
];

function numberOrNull(
  value: unknown
): number | null {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentile(
  values: number[],
  rating: number
): number {
  if (!values.length) return 0;

  let below = 0;
  let equal = 0;

  for (const value of values) {
    if (value < rating) {
      below++;
    } else if (value === rating) {
      equal++;
    }
  }

  /*
   * Midrank empirical percentile.
   *
   * A player tied with a large rating bucket receives the midpoint of that
   * bucket rather than being treated as either entirely above or below it.
   */
  return round1(
    ((below + equal * 0.5) / values.length) *
      100
  );
}

function playerKind(
  ratings: PlayerRatings
): {
  kind: DestinationPlayerKind;
  roleAssessment: PitcherRoleAssessment | null;
} {
  if (ratings.position !== 1) {
    return {
      kind: 'hitter',
      roleAssessment: null,
    };
  }

  const currentRole:
    | 'starter'
    | 'reliever' =
      ratings.role === 11
        ? 'starter'
        : 'reliever';

  const established =
    ratings.pitches
      .filter((rating) => rating >= 35)
      .sort((a, b) => b - a);

  const thirdBestPitch =
    established.length >= 3
      ? established[2]
      : null;

  const stamina =
    ratings.stamina;

  const starterStructure =
    typeof stamina === 'number' &&
    stamina >= 40 &&
    established.length >= 3;

  const developmentalRole:
    | 'starter'
    | 'reliever' =
      currentRole === 'starter' ||
      starterStructure
        ? 'starter'
        : 'reliever';

  const reasons: string[] = [];

  if (currentRole === 'starter') {
    reasons.push(
      'Player is currently assigned a starting-pitcher role.'
    );
  } else if (starterStructure) {
    reasons.push(
      'Current relief assignment does not prevent starter development: stamina and repertoire meet the structural starter criteria.'
    );
  } else {
    reasons.push(
      'Current stamina/repertoire does not support a regular starting role, so destination fit is evaluated in relief.'
    );
  }

  if (typeof stamina === 'number') {
    reasons.push(
      `Stamina: ${stamina}.`
    );
  }

  reasons.push(
    `${established.length} current pitches are rated at least 35.`
  );

  if (thirdBestPitch !== null) {
    reasons.push(
      `Third-best established pitch: ${thirdBestPitch}.`
    );
  }

  return {
    kind: developmentalRole,
    roleAssessment: {
      currentRole,
      developmentalRole,
      stamina,
      establishedPitches:
        established.length,
      thirdBestPitch,
      reasons,
    },
  };
}

/**
 * Developmental pitching role for organizational planning.
 *
 * This deliberately differs from the player's current OOTP roster role.
 * Current role describes how he is being used today; developmental role
 * describes whether his stamina/repertoire still support starting.
 */
export function evaluatePitcherDevelopmentalRole(
  playerId: number
): PitcherRoleAssessment | null {
  const ratings =
    playerRatings(playerId);

  if (
    !ratings ||
    ratings.position !== 1
  ) {
    return null;
  }

  return (
    playerKind(ratings)
      .roleAssessment
  );
}

function definitionsFor(
  kind: DestinationPlayerKind
): ComponentDefinition[] {
  if (kind === 'hitter') {
    return HITTER_COMPONENTS;
  }

  if (kind === 'starter') {
    return STARTER_COMPONENTS;
  }

  return RELIEVER_COMPONENTS;
}

function playerRatings(
  playerId: number
): PlayerRatings | null {
  const row = db.prepare(`
    SELECT
      p.player_id,
      p.position,
      p.role,

      b.batting_ratings_overall_contact AS contact,
      b.batting_ratings_overall_gap AS gap,
      b.batting_ratings_overall_power AS power,
      b.batting_ratings_overall_eye AS eye,
      b.batting_ratings_overall_strikeouts AS avoid_k,

      pp.pitching_ratings_overall_stuff AS stuff,
      pp.pitching_ratings_overall_movement AS movement,
      pp.pitching_ratings_overall_control AS control,
      pp.pitching_ratings_misc_stamina AS stamina,

      pp.pitching_ratings_pitches_fastball AS pitch_fastball,
      pp.pitching_ratings_pitches_slider AS pitch_slider,
      pp.pitching_ratings_pitches_curveball AS pitch_curveball,
      pp.pitching_ratings_pitches_screwball AS pitch_screwball,
      pp.pitching_ratings_pitches_forkball AS pitch_forkball,
      pp.pitching_ratings_pitches_changeup AS pitch_changeup,
      pp.pitching_ratings_pitches_sinker AS pitch_sinker,
      pp.pitching_ratings_pitches_splitter AS pitch_splitter,
      pp.pitching_ratings_pitches_knuckleball AS pitch_knuckleball,
      pp.pitching_ratings_pitches_cutter AS pitch_cutter,
      pp.pitching_ratings_pitches_circlechange AS pitch_circlechange,
      pp.pitching_ratings_pitches_knucklecurve AS pitch_knucklecurve

    FROM players p

    LEFT JOIN players_batting b
      ON b.player_id = p.player_id

    LEFT JOIN players_pitching pp
      ON pp.player_id = p.player_id

    WHERE p.player_id = ?
    LIMIT 1
  `).get(playerId) as
    | Record<string, unknown>
    | undefined;

  if (!row) return null;

  return {
    playerId: Number(row.player_id),
    position: Number(row.position),
    role: Number(row.role),

    contact: numberOrNull(row.contact),
    gap: numberOrNull(row.gap),
    power: numberOrNull(row.power),
    eye: numberOrNull(row.eye),
    avoidK: numberOrNull(row.avoid_k),

    stuff: numberOrNull(row.stuff),
    movement: numberOrNull(row.movement),
    control: numberOrNull(row.control),
    stamina: numberOrNull(row.stamina),

    pitches: [
      row.pitch_fastball,
      row.pitch_slider,
      row.pitch_curveball,
      row.pitch_screwball,
      row.pitch_forkball,
      row.pitch_changeup,
      row.pitch_sinker,
      row.pitch_splitter,
      row.pitch_knuckleball,
      row.pitch_cutter,
      row.pitch_circlechange,
      row.pitch_knucklecurve,
    ]
      .map(numberOrNull)
      .filter(
        (rating): rating is number =>
          rating !== null &&
          rating > 0
      ),
  };
}

function destinationLeague(
  teamId: number
): LeagueInfo | null {
  const row = db.prepare(`
    SELECT
      t.team_id,
      t.name,
      t.nickname,

      l.league_id,
      l.name AS league_name,
      l.league_level,

      l.avg_rating_contact,
      l.avg_rating_gap,
      l.avg_rating_power,
      l.avg_rating_eye,
      l.avg_rating_strikeouts,

      l.avg_rating_stuff,
      l.avg_rating_movement,
      l.avg_rating_control

    FROM teams t
    JOIN leagues l
      ON l.league_id = t.league_id

    WHERE t.team_id = ?
    LIMIT 1
  `).get(teamId) as
    | Record<string, unknown>
    | undefined;

  if (!row) return null;

  const name = String(row.name ?? '');
  const nickname = String(row.nickname ?? '');

  return {
    teamId: Number(row.team_id),

    team:
      name === nickname || !nickname
        ? name
        : `${name} ${nickname}`,

    leagueId: Number(row.league_id),
    leagueName: String(row.league_name),
    leagueLevel: Number(row.league_level),

    avgContact:
      numberOrNull(row.avg_rating_contact),
    avgGap:
      numberOrNull(row.avg_rating_gap),
    avgPower:
      numberOrNull(row.avg_rating_power),
    avgEye:
      numberOrNull(row.avg_rating_eye),
    avgAvoidK:
      numberOrNull(row.avg_rating_strikeouts),

    avgStuff:
      numberOrNull(row.avg_rating_stuff),
    avgMovement:
      numberOrNull(row.avg_rating_movement),
    avgControl:
      numberOrNull(row.avg_rating_control),
  };
}

function populationRows(
  leagueId: number,
  kind: DestinationPlayerKind
): Array<Record<string, unknown>> {
  if (kind === 'hitter') {
    return db.prepare(`
      SELECT
        b.batting_ratings_overall_contact AS contact,
        b.batting_ratings_overall_gap AS gap,
        b.batting_ratings_overall_power AS power,
        b.batting_ratings_overall_eye AS eye,
        b.batting_ratings_overall_strikeouts AS avoid_k

      FROM players p

      JOIN teams t
        ON t.team_id = p.team_id

      JOIN team_roster tr
        ON tr.team_id = p.team_id
       AND tr.player_id = p.player_id
       AND tr.list_id = 2

      JOIN players_batting b
        ON b.player_id = p.player_id

      WHERE t.league_id = ?
        AND p.retired = 0
        AND p.position != 1
    `).all(leagueId) as Array<
      Record<string, unknown>
    >;
  }

  const roleClause =
    kind === 'starter'
      ? 'AND p.role = 11'
      : 'AND p.role IN (12, 13)';

  return db.prepare(`
    SELECT
      pp.pitching_ratings_overall_stuff AS stuff,
      pp.pitching_ratings_overall_movement AS movement,
      pp.pitching_ratings_overall_control AS control,
      pp.pitching_ratings_misc_stamina AS stamina

    FROM players p

    JOIN teams t
      ON t.team_id = p.team_id

    JOIN team_roster tr
      ON tr.team_id = p.team_id
     AND tr.player_id = p.player_id
     AND tr.list_id = 2

    JOIN players_pitching pp
      ON pp.player_id = p.player_id

    WHERE t.league_id = ?
      AND p.retired = 0
      AND p.position = 1
      ${roleClause}
  `).all(leagueId) as Array<
    Record<string, unknown>
  >;
}

function populationValues(
  rows: Array<Record<string, unknown>>,
  key: keyof PlayerRatings
): number[] {
  const column =
    key === 'avoidK'
      ? 'avoid_k'
      : key;

  return rows
    .map((row) =>
      numberOrNull(row[column])
    )
    .filter(
      (value): value is number =>
        value !== null &&
        value > 0
    );
}

function exportedLeagueAverage(
  league: LeagueInfo,
  definition: ComponentDefinition
): number | null {
  if (!definition.leagueAverage) {
    return null;
  }

  const raw =
    league[definition.leagueAverage];

  if (
    typeof raw !== 'number' ||
    !Number.isFinite(raw)
  ) {
    return null;
  }

  /*
   * OOTP exports these league averages on an approximately 10x scale relative
   * to the visible rating values. Keep this contextual only; empirical
   * percentiles remain authoritative.
   */
  return round1(raw / 10);
}

function classification(
  composite: number,
  weakestCore: number
): DestinationFitClassification {
  if (
    composite >= 60 &&
    weakestCore >= 25
  ) {
    return 'strong';
  }

  if (
    composite >= 40 &&
    weakestCore >= 15
  ) {
    return 'viable';
  }

  if (
    composite >= 25 &&
    weakestCore >= 5
  ) {
    return 'borderline';
  }

  return 'poor';
}

export function evaluateDestinationFit(
  playerId: number,
  destinationTeamId: number
): DestinationFit | null {
  const ratings =
    playerRatings(playerId);

  const league =
    destinationLeague(destinationTeamId);

  if (!ratings || !league) {
    return null;
  }

  const role =
    playerKind(ratings);

  const kind =
    role.kind;

  const roleAssessment =
    role.roleAssessment;

  const definitions =
    definitionsFor(kind);

  const population =
    populationRows(
      league.leagueId,
      kind
    );

  const components: DestinationFitComponent[] =
    [];

  for (const definition of definitions) {
    const rating =
      ratings[definition.key];

    if (
      typeof rating !== 'number' ||
      !Number.isFinite(rating)
    ) {
      continue;
    }

    const values =
      populationValues(
        population,
        definition.key
      );

    if (!values.length) {
      continue;
    }

    components.push({
      key: String(definition.key),
      label: definition.label,
      playerRating: rating,

      percentile:
        percentile(values, rating),

      population:
        values.length,

      exportedLeagueAverage:
        exportedLeagueAverage(
          league,
          definition
        ),

      weight: definition.weight,
      core: definition.core,
    });
  }

  const totalWeight =
    components.reduce(
      (sum, component) =>
        sum + component.weight,
      0
    );

  const composite =
    totalWeight > 0
      ? components.reduce(
          (sum, component) =>
            sum +
            component.percentile *
              component.weight,
          0
        ) / totalWeight
      : 0;

  const core =
    components.filter(
      (component) => component.core
    );

  const weakestCore =
    core.length
      ? Math.min(
          ...core.map(
            (component) =>
              component.percentile
          )
        )
      : 0;

  const populationMinimum =
    components.length
      ? Math.min(
          ...components.map(
            (component) =>
              component.population
          )
        )
      : 0;

  const notes: string[] = [];

  if (kind === 'starter') {
    notes.push(
      'Starter destination fit uses Stuff, Movement, Control, and Stamina.'
    );
  } else if (kind === 'reliever') {
    notes.push(
      'Reliever destination fit uses Stuff, Movement, and Control.'
    );
  } else {
    notes.push(
      'Hitter destination fit uses Contact, Gap Power, Power, Eye, and Avoid K.'
    );
  }

  notes.push(
    'Percentiles are calculated from active players in the actual destination league in the current save.'
  );

  notes.push(
    'Defensive-position suitability is evaluated separately by the development-assignment model.'
  );

  return {
    playerId,

    destinationTeamId:
      league.teamId,

    destinationTeam:
      league.team,

    leagueId:
      league.leagueId,

    leagueName:
      league.leagueName,

    leagueLevel:
      league.leagueLevel,

    kind,

    roleAssessment,

    components,

    compositePercentile:
      round1(composite),

    weakestCorePercentile:
      round1(weakestCore),

    classification:
      classification(
        composite,
        weakestCore
      ),

    populationMinimum,

    notes,
  };
}

export function skipLevelDestinationGate(
  fit: DestinationFit,
  levelsSkipped: number
): DestinationFitGate {
  /*
   * These are percentile policy thresholds, not OOTP rating cutoffs.
   *
   * Skip one existing level:
   *   Player should already resemble at least the lower portion of the
   *   destination population, without a catastrophic core weakness.
   *
   * Skip two:
   *   Player should look much closer to a normal destination-level player.
   *
   * Three+:
   *   Exceptional only.
   */
  let requiredCompositePercentile: number;
  let requiredWeakestCorePercentile: number;

  if (levelsSkipped <= 1) {
    requiredCompositePercentile = 30;
    requiredWeakestCorePercentile = 10;
  } else if (levelsSkipped === 2) {
    requiredCompositePercentile = 45;
    requiredWeakestCorePercentile = 20;
  } else {
    requiredCompositePercentile = 60;
    requiredWeakestCorePercentile = 30;
  }

  const reasons: string[] = [];

  if (
    fit.populationMinimum < 25
  ) {
    reasons.push(
      `Destination comparison sample is only ${fit.populationMinimum}; at least 25 comparable active players are required.`
    );
  }

  if (
    fit.compositePercentile <
    requiredCompositePercentile
  ) {
    reasons.push(
      `Destination composite percentile ${fit.compositePercentile} is below the required ${requiredCompositePercentile}.`
    );
  }

  if (
    fit.weakestCorePercentile <
    requiredWeakestCorePercentile
  ) {
    reasons.push(
      `Weakest core-skill percentile ${fit.weakestCorePercentile} is below the required ${requiredWeakestCorePercentile}.`
    );
  }

  return {
    levelsSkipped,

    requiredCompositePercentile,
    requiredWeakestCorePercentile,

    passes: reasons.length === 0,

    reasons,
  };
}

/**
 * Refines the pure prospect-assignment plan with empirical destination-level
 * ability.
 *
 * Normal promotions remain governed by the ordinary Prospect Decision Engine.
 *
 * Skip-level promotions require BOTH:
 *   1. exceptional current-level developmental evidence, and
 *   2. credible current ability against the actual destination population.
 */
export function applyDestinationFitToAssignments(
  playerId: number,
  plan: ProspectAssignmentPlan
): ProspectAssignmentPlanWithDestinationFit {
  const evaluations:
    ProspectAssignmentEvaluationWithDestinationFit[] =
    [];

  for (const evaluation of plan.evaluations) {
    /*
     * Direct minor-league skips to MLB belong to the future MLB Opportunity
     * Engine and should not appear as rejected minor-league assignments.
     */
    if (
      evaluation.kind ===
        'skip_level_promotion' &&
      evaluation.target.isMajorLeague
    ) {
      continue;
    }

    const teamFits =
      evaluation.target.teams
        .map((team) => {
          const fit =
            evaluateDestinationFit(
              playerId,
              team.teamId
            );

          if (!fit) {
            return null;
          }

          return {
            fit,

            gate:
              evaluation.kind ===
              'skip_level_promotion'
                ? skipLevelDestinationGate(
                    fit,
                    evaluation.levelsSkipped
                  )
                : null,
          };
        })
        .filter(
          (
            item
          ): item is {
            fit: DestinationFit;
            gate: DestinationFitGate | null;
          } => item !== null
        );

    if (
      evaluation.kind !==
      'skip_level_promotion'
    ) {
      evaluations.push({
        ...evaluation,

        destinationFit: {
          teams: teamFits,
          eligibleTeamIds:
            evaluation.eligible
              ? evaluation.target.teams.map(
                  (team) =>
                    team.teamId
                )
              : [],
        },
      });

      continue;
    }

    /*
     * If the current-level evidence already rejected the skip, destination fit
     * is still reported for transparency, but it cannot resurrect the move.
     */
    if (!evaluation.eligible) {
      evaluations.push({
        ...evaluation,

        destinationFit: {
          teams: teamFits,
          eligibleTeamIds: [],
        },
      });

      continue;
    }

    const passing =
      teamFits.filter(
        (team) =>
          team.gate?.passes === true
      );

    const eligibleTeamIds =
      passing.map(
        (team) =>
          team.fit.destinationTeamId
      );

    if (!passing.length) {
      const fitBlockers =
        teamFits.flatMap(
          ({ fit, gate }) =>
            (gate?.reasons ?? []).map(
              (reason) =>
                `${fit.destinationTeam}: ${reason}`
            )
        );

      evaluations.push({
        ...evaluation,

        eligible: false,
        recommendation:
          'not_recommended',

        blockers: [
          ...evaluation.blockers,

          ...(fitBlockers.length
            ? fitBlockers
            : [
                'No destination affiliate had sufficient rating-population data to support this skip-level assignment.',
              ]),
        ],

        destinationFit: {
          teams: teamFits,
          eligibleTeamIds: [],
        },
      });

      continue;
    }

    const filteredTarget = {
      ...evaluation.target,

      /*
       * Player Development determines which actual affiliates are
       * developmentally defensible. Minor League Operations may choose among
       * these teams later.
       */
      teams:
        evaluation.target.teams.filter(
          (team) =>
            eligibleTeamIds.includes(
              team.teamId
            )
        ),
    };

    evaluations.push({
      ...evaluation,

      target:
        filteredTarget,

      reasons: [
        ...evaluation.reasons,
        'Current ratings also fall within the required empirical destination-level range.',
      ],

      destinationFit: {
        teams: teamFits,
        eligibleTeamIds,
      },
    });
  }

  return {
    evaluations,

    eligible:
      evaluations.filter(
        (evaluation) =>
          evaluation.eligible
      ),
  };
}
