import { db } from './db.js';
import { loadScoutedAbilities } from './scoutedEvidence.js';
import {
  judgmentOf,
  type ConstraintState,
  type MissingEvidence,
} from './developmentJudgment.js';

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
  | 'strong'
  /** Some role tools could not be compared, so no grade is given. */
  | 'indeterminate';

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

  /**
   * Whether stamina was available to judge starter structure. When it is not,
   * the developmental role simply follows the current assignment: it is not a
   * finding that the pitcher cannot start.
   */
  structureEvidence: 'known' | 'unknown';

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
   * Role tools that could not be compared, and why. A tool with no
   * organization-visible rating, or with no comparison population, is left out
   * rather than scored as a zero — but it is reported here, and an unassessed
   * core tool keeps a skip-level move from being authorized.
   */
  unassessedComponents: Array<{
    label: string;
    core: boolean;
    reason: 'no_visible_rating' | 'no_comparison_population';
  }>;

  /**
   * Weighted mean of component percentiles. null while any role tool is
   * unassessed: a partial composite is not the composite, and no value is
   * substituted for the missing tools.
   */
  compositePercentile: number | null;

  /**
   * Lowest percentile among the ASSESSED skills designated as essential for
   * the role (null if none was assessed). Prevents one elite tool from hiding
   * a serious developmental weakness. An unassessed core tool may be weaker
   * still — see `unassessedComponents`.
   */
  weakestCorePercentile: number | null;

  classification: DestinationFitClassification;

  populationMinimum: number;

  notes: string[];
}

export interface DestinationFitGate {
  levelsSkipped: number;

  requiredCompositePercentile: number;
  requiredWeakestCorePercentile: number;

  /**
   * `unknown` while a role tool could not be assessed and nothing already
   * assessed rules the move out. Never a pass by default, never a rejection.
   */
  state: ConstraintState;

  /** Why the move is ruled out (only for `not_satisfied`). */
  reasons: string[];

  /** What could not be assessed (only for `unknown`). */
  unknownReasons: string[];
}

export interface AssignmentDestinationFit {
  teams: Array<{
    fit: DestinationFit;
    gate: DestinationFitGate | null;
  }>;

  /** Affiliates whose destination comparison establishes the move is defensible. */
  eligibleTeamIds: number[];

  /** Affiliates the comparison cannot yet judge. Not approved, not rejected. */
  indeterminateTeamIds: number[];
}

export type ProspectAssignmentEvaluationWithDestinationFit =
  ProspectAssignmentEvaluation & {
    destinationFit: AssignmentDestinationFit | null;
  };

export interface ProspectAssignmentPlanWithDestinationFit {
  evaluations: ProspectAssignmentEvaluationWithDestinationFit[];
  eligible: ProspectAssignmentEvaluationWithDestinationFit[];
  indeterminate: ProspectAssignmentEvaluationWithDestinationFit[];
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
  /*
   * Number(null) is 0, so without this guard an absent value read as a real
   * zero. Absent stays absent.
   */
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

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

  const structureKnown =
    typeof stamina === 'number';

  const reasons: string[] = [];

  if (currentRole === 'starter') {
    reasons.push(
      'Player is currently assigned a starting-pitcher role.'
    );
  } else if (starterStructure) {
    reasons.push(
      'Current relief assignment does not prevent starter development: stamina and repertoire meet the structural starter criteria.'
    );
  } else if (!structureKnown) {
    reasons.push(
      'Organization-visible stamina is unavailable, so starter structure cannot be assessed; destination fit follows the current relief assignment. That is not a finding that he cannot start.'
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
      structureEvidence:
        structureKnown
          ? 'known'
          : 'unknown',
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
  /*
   * Who the player is and what he is used as are objective facts. Every rating
   * comes from the scouted-evidence adapter, so an absent grade stays absent
   * (null) instead of being read as a zero, and stamina and pitch grades are
   * on the 20-80 scale the role thresholds below assume.
   */
  const row = db.prepare(`
    SELECT p.player_id, p.position, p.role
    FROM players p
    WHERE p.player_id = ?
    LIMIT 1
  `).get(playerId) as
    | Record<string, unknown>
    | undefined;

  if (!row) return null;

  const ability =
    loadScoutedAbilities([playerId])
      .for(playerId);

  const tools = ability.currentTools;

  return {
    playerId: Number(row.player_id),
    position: Number(row.position),
    role: Number(row.role),

    contact: tools.contact ?? null,
    gap: tools.gap ?? null,
    power: tools.power ?? null,
    eye: tools.eye ?? null,
    avoidK: tools.avoidK ?? null,

    stuff: tools.stuff ?? null,
    movement: tools.movement ?? null,
    control: tools.control ?? null,
    stamina: ability.stamina,

    pitches: [...ability.pitches],
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
  /*
   * Membership — active, in this league, hitter or the right pitching role —
   * is objective. The ratings compared are the scouted-evidence adapter's.
   */
  const ids = (
    kind === 'hitter'
      ? db.prepare(`
          SELECT p.player_id
          FROM players p
          JOIN teams t
            ON t.team_id = p.team_id
          JOIN team_roster tr
            ON tr.team_id = p.team_id
           AND tr.player_id = p.player_id
           AND tr.list_id = 2
          WHERE t.league_id = ?
            AND p.retired = 0
            AND p.position != 1
        `).all(leagueId)
      : db.prepare(`
          SELECT p.player_id
          FROM players p
          JOIN teams t
            ON t.team_id = p.team_id
          JOIN team_roster tr
            ON tr.team_id = p.team_id
           AND tr.player_id = p.player_id
           AND tr.list_id = 2
          WHERE t.league_id = ?
            AND p.retired = 0
            AND p.position = 1
            ${
              kind === 'starter'
                ? 'AND p.role = 11'
                : 'AND p.role IN (12, 13)'
            }
        `).all(leagueId)
  ).map(
    (row) =>
      Number(
        (row as { player_id: number })
          .player_id
      )
  );

  const abilities =
    loadScoutedAbilities(ids);

  return ids.map((id) => {
    const ability =
      abilities.for(id);

    const tools =
      ability.currentTools;

    return kind === 'hitter'
      ? {
          contact: tools.contact ?? null,
          gap: tools.gap ?? null,
          power: tools.power ?? null,
          eye: tools.eye ?? null,
          avoid_k: tools.avoidK ?? null,
        }
      : {
          stuff: tools.stuff ?? null,
          movement: tools.movement ?? null,
          control: tools.control ?? null,
          stamina: ability.stamina,
        };
  });
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

/**
 * Destination fit at a club's level.
 *
 * `asPitchingRole` asks the question for a role the pitcher does not hold today
 * ("how would this starter's tools rate as a reliever?"). The default is the
 * role his assignment and structure imply. It is ignored for a hitter.
 */
export function evaluateDestinationFit(
  playerId: number,
  destinationTeamId: number,
  asPitchingRole?: 'starter' | 'reliever'
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
    asPitchingRole && ratings.position === 1
      ? asPitchingRole
      : role.kind;

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

  const unassessedComponents: DestinationFit['unassessedComponents'] =
    [];

  for (const definition of definitions) {
    const rating =
      ratings[definition.key];

    if (
      typeof rating !== 'number' ||
      !Number.isFinite(rating)
    ) {
      unassessedComponents.push({
        label: definition.label,
        core: definition.core,
        reason: 'no_visible_rating',
      });

      continue;
    }

    const values =
      populationValues(
        population,
        definition.key
      );

    if (!values.length) {
      unassessedComponents.push({
        label: definition.label,
        core: definition.core,
        reason: 'no_comparison_population',
      });

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

  const complete =
    unassessedComponents.length === 0 &&
    components.length > 0;

  const composite =
    complete && totalWeight > 0
      ? components.reduce(
          (sum, component) =>
            sum +
            component.percentile *
              component.weight,
          0
        ) / totalWeight
      : null;

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
      : null;

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
    'Percentiles are calculated from active players in the actual destination league in the current save, using organization-visible ratings only.'
  );

  if (unassessedComponents.length) {
    notes.push(
      `Not evaluated: ${unassessedComponents
        .map(
          (item) =>
            `${item.label} (${
              item.reason ===
              'no_visible_rating'
                ? 'no organization-visible rating'
                : 'no comparison population'
            })`
        )
        .join(', ')}.`
    );
  }

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

    unassessedComponents,

    compositePercentile:
      composite === null
        ? null
        : round1(composite),

    weakestCorePercentile:
      weakestCore === null
        ? null
        : round1(weakestCore),

    classification:
      composite === null ||
      weakestCore === null
        ? 'indeterminate'
        : classification(
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
  const unknownReasons: string[] = [];

  /*
   * Ruled out: evidence that is known and falls short. A shortfall in what WAS
   * assessed stands however the unassessed tools turn out (the overall weakest
   * core tool can only be weaker than the weakest assessed one).
   */
  if (
    fit.components.length > 0 &&
    fit.populationMinimum < 25
  ) {
    reasons.push(
      `Destination comparison sample is only ${fit.populationMinimum}; at least 25 comparable active players are required.`
    );
  }

  if (
    fit.compositePercentile !== null &&
    fit.compositePercentile <
    requiredCompositePercentile
  ) {
    reasons.push(
      `Destination composite percentile ${fit.compositePercentile} is below the required ${requiredCompositePercentile}.`
    );
  }

  if (
    fit.weakestCorePercentile !== null &&
    fit.weakestCorePercentile <
    requiredWeakestCorePercentile
  ) {
    reasons.push(
      `Weakest core-skill percentile ${fit.weakestCorePercentile} is below the required ${requiredWeakestCorePercentile}.`
    );
  }

  /*
   * Not ruled out, not ruled in: tools with no organization-visible rating (or
   * no comparison population) cannot be compared, so the destination question
   * is unknown rather than failed.
   */
  if (fit.unassessedComponents.length) {
    unknownReasons.push(
      `Not evaluated for lack of organization-visible evidence: ${fit.unassessedComponents
        .map((item) => `${item.label}${item.core ? ' (core)' : ''}`)
        .join(', ')}.`
    );
  }

  return {
    levelsSkipped,

    requiredCompositePercentile,
    requiredWeakestCorePercentile,

    state:
      reasons.length > 0
        ? 'not_satisfied'
        : unknownReasons.length > 0
          ? 'unknown'
          : 'satisfied',

    reasons,
    unknownReasons,
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
      const teamIds =
        evaluation.target.teams.map(
          (team) =>
            team.teamId
        );

      evaluations.push({
        ...evaluation,

        destinationFit: {
          teams: teamFits,

          eligibleTeamIds:
            evaluation.judgment ===
            'defensible'
              ? teamIds
              : [],

          indeterminateTeamIds:
            evaluation.judgment ===
            'indeterminate'
              ? teamIds
              : [],
        },
      });

      continue;
    }

    /*
     * If current-level evidence already ruled the skip out, destination fit is
     * still reported for transparency, but it cannot resurrect the move.
     */
    if (evaluation.judgment === 'indefensible') {
      evaluations.push({
        ...evaluation,

        destinationFit: {
          teams: teamFits,
          eligibleTeamIds: [],
          indeterminateTeamIds: [],
        },
      });

      continue;
    }

    const satisfied =
      teamFits.filter(
        (team) =>
          team.gate?.state === 'satisfied'
      );

    const unknown =
      teamFits.filter(
        (team) =>
          team.gate?.state === 'unknown'
      );

    const eligibleTeamIds =
      satisfied.map(
        (team) =>
          team.fit.destinationTeamId
      );

    const indeterminateTeamIds =
      unknown.map(
        (team) =>
          team.fit.destinationTeamId
      );

    /*
     * Every affiliate is ruled out by known evidence: the move is indefensible
     * whatever Player Development's own (possibly indeterminate) evidence says.
     */
    if (!satisfied.length && !unknown.length) {
      const fitBlockers =
        teamFits.flatMap(
          ({ fit, gate }) =>
            (gate?.reasons ?? []).map(
              (reason) =>
                `${fit.destinationTeam}: ${reason}`
            )
        );

      const blockers = [
        ...evaluation.blockers,

        ...(fitBlockers.length
          ? fitBlockers
          : [
              'No destination affiliate had sufficient rating-population data to support this skip-level assignment.',
            ]),
      ];

      evaluations.push({
        ...evaluation,

        judgment: 'indefensible',
        eligible: false,
        recommendation:
          'not_recommended',
        missingEvidence: [],
        blockers,

        constraints: [
          ...evaluation.constraints,
          {
            id: 'destination_fit',
            label: 'Destination fit',
            state: 'not_satisfied',
            requiresSubjectiveEvidence: true,
            detail: fitBlockers.join(' ') ||
              'No destination affiliate had sufficient rating-population data.',
          },
        ],

        destinationFit: {
          teams: teamFits,
          eligibleTeamIds: [],
          indeterminateTeamIds: [],
        },
      });

      continue;
    }

    const missingDestinationEvidence: MissingEvidence[] =
      unknown.flatMap(
        ({ fit, gate }) =>
          (gate?.unknownReasons ?? []).map(
            (detail) => ({
              dimension:
                'destination_comparison' as const,
              detail:
                `${fit.destinationTeam}: ${detail}`,
            })
          )
      );

    /*
     * The destination comparison establishes the move for at least one
     * affiliate: keep those. Affiliates it cannot judge are reported but are not
     * approved targets.
     */
    if (
      evaluation.judgment === 'defensible' &&
      satisfied.length
    ) {
      evaluations.push({
        ...evaluation,

        target: {
          ...evaluation.target,

          /*
           * Player Development determines which actual affiliates are
           * developmentally defensible. Minor League Operations may choose
           * among these teams later.
           */
          teams:
            evaluation.target.teams.filter(
              (team) =>
                eligibleTeamIds.includes(
                  team.teamId
                )
            ),
        },

        constraints: [
          ...evaluation.constraints,
          {
            id: 'destination_fit',
            label: 'Destination fit',
            state: 'satisfied',
            requiresSubjectiveEvidence: true,
            detail:
              'Current ratings also fall within the required empirical destination-level range.',
          },
        ],

        reasons: [
          ...evaluation.reasons,
          'Current ratings also fall within the required empirical destination-level range.',
        ],

        destinationFit: {
          teams: teamFits,
          eligibleTeamIds,
          indeterminateTeamIds,
        },
      });

      continue;
    }

    /*
     * Otherwise the move is neither defensible nor indefensible on the
     * evidence: either current-level evidence is indeterminate, or the only
     * remaining affiliates' destination comparisons are.
     */
    const constraints = [
      ...evaluation.constraints,
      {
        id: 'destination_fit' as const,
        label: 'Destination fit',
        state:
          (unknown.length
            ? 'unknown'
            : 'satisfied') as ConstraintState,
        requiresSubjectiveEvidence: true,
        detail:
          unknown.length
            ? 'Destination fit cannot be established for every remaining affiliate: some role tools have no organization-visible rating.'
            : 'Current ratings fall within the required empirical destination-level range.',
      },
    ];

    const judgment =
      judgmentOf(
        constraints.map(
          (constraint) => constraint.state
        )
      );

    evaluations.push({
      ...evaluation,

      judgment,
      eligible: judgment === 'defensible',
      recommendation:
        judgment === 'indeterminate'
          ? 'indeterminate'
          : evaluation.recommendation,

      constraints,

      missingEvidence: [
        ...evaluation.missingEvidence,
        ...missingDestinationEvidence,
      ],

      destinationFit: {
        teams: teamFits,
        eligibleTeamIds,
        indeterminateTeamIds,
      },
    });
  }

  return {
    evaluations,

    eligible:
      evaluations.filter(
        (evaluation) =>
          evaluation.judgment ===
          'defensible'
      ),

    indeterminate:
      evaluations.filter(
        (evaluation) =>
          evaluation.judgment ===
          'indeterminate'
      ),
  };
}
