import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  apiGet,
} from '../api';

import {
  PlayerLink,
} from '../playerModal';

import {
  formatRatingPair,
} from '../ratingScale';


type DevelopmentFilter =
  | 'attention'
  | 'eligible'
  | 'watch'
  | 'behind'
  | 'all';


type PeerPace =
  | 'insufficient'
  | 'behind'
  | 'typical'
  | 'ahead';


type ProspectRecommendation =
  | 'hold'
  | 'watch'
  | 'consider_promotion'
  | 'strong_promotion_case'
  | 'consider_demotion'
  | 'mlb_ready_discussion';


type AssignmentKind =
  | 'normal_promotion'
  | 'skip_level_promotion'
  | 'demotion'
  | 'mlb_discussion';


interface ProspectDecision {
  evidence: {
    performance: number;
    ageLevelUrgency: number;
    ratingsMaturity: number;
    sampleConfidence: number;
    readiness: number;
  };

  organization: {
    promotionAggressiveness: number;
    basePromotionThreshold: number;
    philosophyThresholdAdjustment: number;
    ageThresholdAdjustment: number;
    promotionThreshold: number;
  };

  recommendation:
    ProspectRecommendation;

  confidence:
    | 'limited'
    | 'moderate'
    | 'high';

  nextAssignment: {
    level: number;
    levelName: string;

    teams: Array<{
      teamId: number;
      label: string;
    }>;

    isMajorLeague: boolean;
  } | null;

  demotionAssignment: {
    level: number;
    levelName: string;

    teams: Array<{
      teamId: number;
      label: string;
    }>;

    isMajorLeague: boolean;
  } | null;

  positives: string[];
  cautions: string[];
}


interface DestinationFitTeam {
  fit: {
    destinationTeamId: number;
    destinationTeam: string;

    classification:
      | 'poor'
      | 'borderline'
      | 'viable'
      | 'strong';

    compositePercentile: number;
    weakestCorePercentile: number;
  };

  gate: {
    passes: boolean;
  } | null;
}


interface ProspectAssignment {
  kind:
    AssignmentKind;

  eligible: boolean;

  recommendation:
    string;

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
    teams:
      DestinationFitTeam[];

    eligibleTeamIds:
      number[];
  } | null;
}


interface Prospect {
  player_id: number;
  team_id: number;

  name: string;
  age: number;

  team: string;

  level: number;
  levelName: string;

  cur:
    number | null;

  pot:
    number | null;

  ageDiff:
    number | null;

  role?:
    number;

  pa?:
    number;

  opsVal?:
    number;

  hr?:
    number;

  sb?:
    number;

  ip?:
    number;

  era?:
    number;

  kpct?:
    number;

  war?:
    number;

  decision:
    ProspectDecision;

  assignments: {
    evaluations:
      ProspectAssignment[];

    eligible:
      ProspectAssignment[];
  };
}


interface ProspectsResponse {
  batters:
    Prospect[];

  pitchers:
    Prospect[];

  baselines:
    unknown;
}


interface RetentionPlayer {
  playerId: number;

  name: string;
  age: number;

  kind:
    | 'hitter'
    | 'pitcher';

  teamId: number;
  team: string;

  level: number;
  levelName: string;

  current:
    number | null;

  potential:
    number | null;

  protection: {
    tier: string;
    score: number;
  };

  transaction: {
    active: boolean;
    onSecondary: boolean;
    onInjuredList: boolean;
    onDl60: boolean;
    mustBeActive: boolean;
    majorContract: boolean;
    proServiceYears: number;
  };

  role: {
    listedPosition: string;

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
    peerDevelopment: {
      pace:
        PeerPace;

      percentile:
        number | null;

      cohortSize:
        number;

      reasons:
        string[];
    };

    developmentHistory: {
      snapshotCount: number;

      observationDays:
        number | null;

      currentDelta:
        number | null;

      potentialDelta:
        number | null;

      reasons:
        string[];
    };
  };

  recommendation:
    | 'protected'
    | 'retain'
    | 'expendable_depth'
    | 'release_candidate';
}


interface RetentionResponse {
  players:
    RetentionPlayer[];
}


interface OperationsMove {
  playerId: number;
  playerName: string;

  fromTeamId?: number;
  fromTeam: string;

  toTeamId?: number;
  toTeam: string;

  kind?: string;

  assignment?: {
    position?: string;
    fit?: number;
    use?: string;
  };

  destinationRole?: string;

  reasons?: string[];

  development?: {
    recommendation?:
      string | null;

    reasons?:
      string[];
  };
}


interface OperationsPlan {
  moves:
    OperationsMove[];
}


interface OperationsResponse {
  plans:
    OperationsPlan[];

  pitching?: {
    plans?:
      OperationsPlan[];
  };
}


interface DevelopmentPlayer {
  playerId: number;
  name: string;
  age: number;

  kind:
    | 'hitter'
    | 'pitcher';

  teamId: number;
  team: string;

  level: number;
  levelName: string;

  current:
    number | null;

  potential:
    number | null;

  active: boolean;
  injured: boolean;

  listedRole:
    string;

  peerPace:
    PeerPace;

  peerPercentile:
    number | null;

  historySnapshots:
    number;

  historyDays:
    number | null;

  currentDelta:
    number | null;

  potentialDelta:
    number | null;

  protectionTier:
    string;

  prospect:
    Prospect | null;

  operation:
    OperationsMove | null;
}


function ordinal(
  value: number
): string {
  const mod100 =
    value % 100;

  if (
    mod100 >= 11 &&
    mod100 <= 13
  ) {
    return `${value}th`;
  }

  switch (value % 10) {
    case 1:
      return `${value}st`;

    case 2:
      return `${value}nd`;

    case 3:
      return `${value}rd`;

    default:
      return `${value}th`;
  }
}


function peerLabel(
  player: DevelopmentPlayer
): string {
  if (
    player.peerPace ===
    'insufficient'
  ) {
    return 'Limited history';
  }

  const percentile =
    player.peerPercentile == null
      ? ''
      : ` · ${ordinal(
          player.peerPercentile
        )}`;

  switch (
    player.peerPace
  ) {
    case 'ahead':
      return `Ahead${percentile}`;

    case 'behind':
      return `Behind${percentile}`;

    default:
      return `Typical${percentile}`;
  }
}


function recommendationLabel(
  recommendation:
    ProspectRecommendation
): string {
  switch (
    recommendation
  ) {
    case 'strong_promotion_case':
      return 'Strong promotion case';

    case 'consider_promotion':
      return 'Consider promotion';

    case 'mlb_ready_discussion':
      return 'Review for MLB opportunity';

    case 'consider_demotion':
      return 'Consider lower-level assignment';

    case 'watch':
      return 'Hold & monitor';

    default:
      return 'Current level appropriate';
  }
}


function recommendationExplanation(
  recommendation:
    ProspectRecommendation
): string {
  switch (
    recommendation
  ) {
    case 'strong_promotion_case':
      return 'Current-level evidence strongly supports a higher-level challenge.';

    case 'consider_promotion':
      return 'The player has done enough to discuss a normal promotion, but the case is not overwhelming.';

    case 'mlb_ready_discussion':
      return 'Minor-league development evidence supports an MLB discussion; roster opportunity and transaction consequences still need separate review.';

    case 'consider_demotion':
      return 'Current-level performance and sample size support discussing a lower-level assignment.';

    case 'watch':
      return 'Keep the current assignment and continue collecting evidence.';

    default:
      return 'The current level remains a developmentally appropriate assignment.';
  }
}


function recommendationClass(
  recommendation:
    ProspectRecommendation
): string {
  switch (
    recommendation
  ) {
    case 'strong_promotion_case':
      return 'development-status-ready';

    case 'consider_promotion':
      return 'development-status-consider';

    case 'mlb_ready_discussion':
      return 'development-status-mlb';

    case 'consider_demotion':
      return 'development-status-review';

    case 'watch':
      return 'development-status-watch';

    default:
      return 'development-status-hold';
  }
}


function assignmentKindLabel(
  kind:
    AssignmentKind
): string {
  switch (kind) {
    case 'normal_promotion':
      return 'Normal promotion';

    case 'skip_level_promotion':
      return 'Skip-level challenge';

    case 'demotion':
      return 'Lower-level assignment';

    case 'mlb_discussion':
      return 'MLB discussion';
  }
}


function fitLabel(
  fit:
    DestinationFitTeam['fit']
): string {
  switch (
    fit.classification
  ) {
    case 'strong':
      return 'Strong fit';

    case 'viable':
      return 'Viable fit';

    case 'borderline':
      return 'Borderline';

    default:
      return 'Poor fit';
  }
}


function roleLabel(
  player:
    RetentionPlayer
): string {
  if (
    player.kind ===
    'pitcher'
  ) {
    return (
      player.role
        .developmentalPitcherRole ===
      'starter'
        ? 'Developmental SP'
        : 'Developmental RP'
    );
  }

  return (
    player.role
      .listedPosition ||
    'Position player'
  );
}


function uniqueStrings(
  values:
    string[]
): string[] {
  return [
    ...new Set(
      values.filter(Boolean)
    ),
  ];
}


function queueAssignmentLabel(
  player:
    DevelopmentPlayer
): string {
  const prospect =
    player.prospect;

  if (!prospect) {
    return player.levelName;
  }

  const assignment =
    prospect.assignments
      .eligible[0];

  if (!assignment) {
    return `${player.levelName} · stay`;
  }

  return `${player.levelName} → ${assignment.target.levelName}`;
}


function seasonLine(
  player:
    Prospect
): string {
  if (
    player.ip != null
  ) {
    const parts = [
      `${player.ip.toFixed(
        1
      )} IP`,

      player.era != null
        ? `${player.era.toFixed(
            2
          )} ERA`
        : null,

      player.kpct != null
        ? `${player.kpct.toFixed(
            1
          )}% K`
        : null,
    ].filter(Boolean);

    return parts.join(
      ' · '
    );
  }

  const parts = [
    player.pa != null
      ? `${player.pa} PA`
      : null,

    player.opsVal != null
      ? `${player.opsVal.toFixed(
          3
        )} OPS`
      : null,

    player.hr != null
      ? `${player.hr} HR`
      : null,
  ].filter(Boolean);

  return parts.join(
    ' · '
  );
}


function AttentionCard({
  player,
}: {
  player:
    DevelopmentPlayer;
}) {
  const prospect =
    player.prospect;

  if (!prospect) {
    return null;
  }

  const decision =
    prospect.decision;

  const assignments =
    prospect.assignments
      .eligible;


  return (
    <article className="development-case-card">
      <div className="development-case-head">
        <div>
          <div className="farm-decision-eyebrow">
            Player Development
          </div>

          <h3>
            <PlayerLink
              id={
                player.playerId
              }
            >
              {player.name}
            </PlayerLink>
          </h3>

          <div className="farm-player-meta">
            {player.age}
            {' · '}
            {player.listedRole}
            {' · '}
            {player.levelName}
            {' · '}
            {player.team}

            {player.injured
              ? ' · Injured'
              : ''}
          </div>
        </div>

        <div className="development-recommendation-block">
          <span
            className={`development-status ${recommendationClass(
              decision.recommendation
            )}`}
          >
            {recommendationLabel(
              decision.recommendation
            )}
          </span>

          <small>
            {recommendationExplanation(
              decision.recommendation
            )}
          </small>
        </div>
      </div>


      <div className="development-case-facts">
        <div>
          <span>
            Scouted current → potential
          </span>

          <strong>
            {formatRatingPair(
              player.current,
              player.potential
            )}
          </strong>
        </div>

        <div>
          <span>
            Season evidence
          </span>

          <strong>
            {seasonLine(
              prospect
            )}
          </strong>
        </div>

        <div>
          <span>
            Development pace vs peers
          </span>

          <strong
            className={
              player.peerPace ===
              'ahead'
                ? 'farm-text-healthy'
                : player.peerPace ===
                  'behind'
                  ? 'farm-text-thin'
                  : ''
            }
          >
            {peerLabel(
              player
            )}
          </strong>
        </div>


      </div>


      <div className="development-verdict">
        <strong>
          Why this is flagged
        </strong>

        <p>
          {decision.positives[0] ??
            decision.cautions[0] ??
            'Current assignment remains developmentally defensible.'}
        </p>
      </div>


      {assignments.length >
      0 && (
        <div className="development-assignment-list">
          <div className="development-subhead">
            Eligible next assignments
          </div>

          {assignments.map(
            (
              assignment,
              index
            ) => (
              <article
                key={`${assignment.kind}-${assignment.target.level}-${index}`}
                className="development-assignment"
              >
                <div>
                  <span>
                    {assignmentKindLabel(
                      assignment.kind
                    )}
                  </span>

                  <strong>
                    {assignment.target.levelName}
                  </strong>
                </div>

                <div className="development-destination-list">
                  {assignment
                    .destinationFit
                    ?.teams
                    ?.filter(
                      (
                        team
                      ) =>
                        assignment
                          .destinationFit
                          ?.eligibleTeamIds
                          .includes(
                            team.fit
                              .destinationTeamId
                          )
                    )
                    .map(
                      (
                        team
                      ) => (
                        <span
                          key={
                            team.fit
                              .destinationTeamId
                          }
                          className={`development-fit development-fit-${team.fit.classification}`}
                        >
                          {team.fit
                            .destinationTeam}
                          {' · '}
                          {fitLabel(
                            team.fit
                          )}
                        </span>
                      )
                    )}

                  {(
                    !assignment
                      .destinationFit ||
                    assignment
                      .destinationFit
                      .eligibleTeamIds
                      .length ===
                      0
                  ) &&
                    assignment.target
                      .teams.map(
                        (
                          team
                        ) => (
                          <span
                            key={
                              team.teamId
                            }
                            className="development-fit"
                          >
                            {team.label}
                          </span>
                        )
                      )}
                </div>
              </article>
            )
          )}
        </div>
      )}


      <div
        className={
          player.operation
            ? 'development-operations development-operations-active'
            : 'development-operations'
        }
      >
        <div className="development-subhead">
          Operations decision
        </div>

        {player.operation ? (
          <>
            <strong>
              Move recommended
            </strong>

            <p>
              {player.operation
                .fromTeam}
              {' → '}
              {player.operation
                .toTeam}
            </p>
          </>
        ) : decision
            .recommendation ===
          'mlb_ready_discussion' ? (
          <>
            <strong>
              MLB opportunity analysis required
            </strong>

            <p>
              Player Development has raised the player for discussion,
              but roster need, 40-man status, options, and service-time
              consequences belong to the MLB opportunity layer.
            </p>
          </>
        ) : (
          <>
            <strong>
              No move recommended now
            </strong>

            <p>
              The assignment is developmentally defensible, but current roster
              structure does not create a reason to make the move.
            </p>
          </>
        )}
      </div>


      <details className="farm-work-evidence development-evidence">
        <summary>
          Full development evidence
        </summary>

        <p className="development-score-note">
          These are internal 0–100 evidence scores, not OOTP player ratings.
        </p>

        <div className="farm-work-score-strip">
          <div>
            <span>
              Readiness score
            </span>

            <strong>
              {decision.evidence
                .readiness}
            </strong>
          </div>

          <div>
            <span>
              Level performance
            </span>

            <strong>
              {decision.evidence
                .performance}
            </strong>
          </div>

          <div>
            <span>
              Projection maturity
            </span>

            <strong>
              {decision.evidence
                .ratingsMaturity}
            </strong>
          </div>

          <div>
            <span>
              Sample strength
            </span>

            <strong>
              {decision.evidence
                .sampleConfidence}
            </strong>
          </div>
        </div>

        {decision.positives.length >
          0 && (
          <div className="farm-work-evidence-section">
            <h4>
              Supporting evidence
            </h4>

            <ul className="farm-reason-list">
              {decision.positives.map(
                (
                  reason,
                  index
                ) => (
                  <li
                    key={
                      index
                    }
                  >
                    {reason}
                  </li>
                )
              )}
            </ul>
          </div>
        )}

        {decision.cautions.length >
          0 && (
          <div className="farm-work-evidence-section">
            <h4>
              Cautions
            </h4>

            <ul className="farm-reason-list">
              {decision.cautions.map(
                (
                  reason,
                  index
                ) => (
                  <li
                    key={
                      index
                    }
                  >
                    {reason}
                  </li>
                )
              )}
            </ul>
          </div>
        )}

        <div className="farm-work-evidence-section">
          <h4>
            Assignment evaluation
          </h4>

          <div className="development-evaluation-list">
            {prospect.assignments
              .evaluations
              .map(
                (
                  assignment,
                  index
                ) => (
                  <div
                    key={`${assignment.kind}-${assignment.target.level}-${index}`}
                    className={
                      assignment.eligible
                        ? 'development-evaluation eligible'
                        : 'development-evaluation blocked'
                    }
                  >
                    <div>
                      <strong>
                        {assignmentKindLabel(
                          assignment.kind
                        )}
                      </strong>

                      <span>
                        {' → '}
                        {assignment.target
                          .levelName}
                      </span>
                    </div>

                    <span>
                      {assignment.eligible
                        ? 'Eligible'
                        : 'Not supported'}
                    </span>

                    {assignment.blockers
                      .slice(0, 3)
                      .map(
                        (
                          blocker,
                          blockerIndex
                        ) => (
                          <p
                            key={
                              blockerIndex
                            }
                          >
                            {blocker}
                          </p>
                        )
                      )}
                  </div>
                )
              )}
          </div>
        </div>
      </details>
    </article>
  );
}


export function Prospects({
  orgId,
}: {
  orgId:
    number;
}) {
  const [
    prospects,
    setProspects,
  ] =
    useState<ProspectsResponse | null>(
      null
    );

  const [
    retention,
    setRetention,
  ] =
    useState<RetentionResponse | null>(
      null
    );

  const [
    operations,
    setOperations,
  ] =
    useState<OperationsResponse | null>(
      null
    );

  const [
    filter,
    setFilter,
  ] =
    useState<DevelopmentFilter>(
      'attention'
    );

  const [
    levelFilter,
    setLevelFilter,
  ] =
    useState<number | 'all'>(
      'all'
    );

  const [
    selectedAttentionPlayerId,
    setSelectedAttentionPlayerId,
  ] =
    useState<number | null>(
      null
    );

  const developmentDetailRef =
    useRef<HTMLDivElement | null>(
      null
    );

  /*
   * Whenever the user opens another development case, return the
   * email-style reading pane to the top. This hook must remain above
   * all conditional returns so React sees the same hook order on
   * every render.
   */
  useEffect(
    () => {
      developmentDetailRef
        .current
        ?.scrollTo({
          top: 0,
          behavior: 'auto',
        });
    },
    [
      selectedAttentionPlayerId,
    ]
  );

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null
    );


  useEffect(
    () => {
      let cancelled =
        false;

      setProspects(null);
      setRetention(null);
      setOperations(null);
      setError(null);

      Promise.all([
        apiGet<ProspectsResponse>(
          `/api/prospects/${orgId}`
        ),

        apiGet<RetentionResponse>(
          `/api/minor-league-retention/${orgId}`
        ),

        apiGet<OperationsResponse>(
          `/api/minor-league-moves/${orgId}`
        ),
      ])
        .then(
          ([
            prospectData,
            retentionData,
            operationsData,
          ]) => {
            if (
              cancelled
            ) {
              return;
            }

            setProspects(
              prospectData
            );

            setRetention(
              retentionData
            );

            setOperations(
              operationsData
            );
          }
        )
        .catch(
          (
            err: Error
          ) => {
            if (
              !cancelled
            ) {
              setError(
                err.message
              );
            }
          }
        );

      return () => {
        cancelled =
          true;
      };
    },
    [orgId]
  );


  const players =
    useMemo<
      DevelopmentPlayer[]
    >(
      () => {
        if (
          !prospects ||
          !retention ||
          !operations
        ) {
          return [];
        }

        const prospectMap =
          new Map<
            number,
            Prospect
          >();

        for (
          const prospect of [
            ...prospects.batters,
            ...prospects.pitchers,
          ]
        ) {
          prospectMap.set(
            prospect.player_id,
            prospect
          );
        }


        const operationMap =
          new Map<
            number,
            OperationsMove
          >();

        for (
          const plan of
          operations.plans
        ) {
          for (
            const move of
            plan.moves
          ) {
            operationMap.set(
              move.playerId,
              move
            );
          }
        }

        for (
          const plan of
          operations.pitching
            ?.plans ?? []
        ) {
          for (
            const move of
            plan.moves
          ) {
            operationMap.set(
              move.playerId,
              move
            );
          }
        }


        return retention.players
          .map(
            (
              player
            ): DevelopmentPlayer => ({
              playerId:
                player.playerId,

              name:
                player.name,

              age:
                player.age,

              kind:
                player.kind,

              teamId:
                player.teamId,

              team:
                player.team,

              level:
                player.level,

              levelName:
                player.levelName,

              current:
                player.current,

              potential:
                player.potential,

              active:
                player.transaction
                  .active,

              injured:
                player.transaction
                  .onInjuredList,

              listedRole:
                roleLabel(
                  player
                ),

              peerPace:
                player.evidence
                  .peerDevelopment
                  .pace,

              peerPercentile:
                player.evidence
                  .peerDevelopment
                  .percentile,

              historySnapshots:
                player.evidence
                  .developmentHistory
                  .snapshotCount,

              historyDays:
                player.evidence
                  .developmentHistory
                  .observationDays,

              currentDelta:
                player.evidence
                  .developmentHistory
                  .currentDelta,

              potentialDelta:
                player.evidence
                  .developmentHistory
                  .potentialDelta,

              protectionTier:
                player.protection
                  .tier,

              prospect:
                prospectMap.get(
                  player.playerId
                ) ?? null,

              operation:
                operationMap.get(
                  player.playerId
                ) ?? null,
            })
          );
      },
      [
        prospects,
        retention,
        operations,
      ]
    );


  if (error) {
    return (
      <div className="banner error">
        {error}
      </div>
    );
  }


  if (
    !prospects ||
    !retention ||
    !operations
  ) {
    return (
      <p className="muted">
        Reviewing player development…
      </p>
    );
  }


  const attention =
    players.filter(
      (player) => {
        const recommendation =
          player.prospect
            ?.decision
            .recommendation;

        return (
          recommendation ===
            'strong_promotion_case' ||
          recommendation ===
            'consider_promotion' ||
          recommendation ===
            'consider_demotion' ||
          recommendation ===
            'mlb_ready_discussion'
        );
      }
    );


  const selectedAttention =
    attention.find(
      (player) =>
        player.playerId ===
        selectedAttentionPlayerId
    ) ??
    attention[0] ??
    null;


  const eligible =
    players.filter(
      (player) =>
        (
          player.prospect
            ?.assignments
            .eligible
            .length ?? 0
        ) > 0
    );


  const watch =
    players.filter(
      (player) =>
        player.prospect
          ?.decision
          .recommendation ===
        'watch'
    );


  const behind =
    players.filter(
      (player) =>
        player.peerPace ===
        'behind'
    );


  const levels =
    [
      ...new Set(
        players.map(
          (player) =>
            player.level
        )
      ),
    ].sort(
      (a, b) =>
        a - b
    );


  const filtered =
    players
      .filter(
        (player) => {
          if (
            levelFilter !==
              'all' &&
            player.level !==
              levelFilter
          ) {
            return false;
          }

          switch (filter) {
            case 'attention':
              return attention.some(
                (candidate) =>
                  candidate.playerId ===
                  player.playerId
              );

            case 'eligible':
              return (
                player.prospect
                  ?.assignments
                  .eligible
                  .length ?? 0
              ) > 0;

            case 'watch':
              return (
                player.prospect
                  ?.decision
                  .recommendation ===
                'watch'
              );

            case 'behind':
              return (
                player.peerPace ===
                'behind'
              );

            default:
              return true;
          }
        }
      )
      .sort(
        (a, b) => {
          const operation =
            Number(
              Boolean(
                b.operation
              )
            ) -
            Number(
              Boolean(
                a.operation
              )
            );

          if (operation !== 0) {
            return operation;
          }

          const aReadiness =
            a.prospect
              ?.decision
              .evidence
              .readiness ??
            -1;

          const bReadiness =
            b.prospect
              ?.decision
              .evidence
              .readiness ??
            -1;

          return (
            bReadiness -
              aReadiness ||
            a.age -
              b.age
          );
        }
      );


  return (
    <div className="development-page">
      <header className="farm-page-head">
        <div>
          <div className="farm-kicker">
            Farm System
          </div>

          <h1>
            Player Development
          </h1>

          <p>
            Player Development asks what level a player has earned. Operations
            separately asks whether the organization should actually move him now.
            Scouting history shows how our observed view of the player is changing
            over time.
          </p>
        </div>
      </header>


      <div className="development-metrics">
        <div>
          <span>
            Decisions needing attention
          </span>

          <strong>
            {attention.length}
          </strong>

          <small>
            Promotion, demotion, or MLB discussions.
          </small>
        </div>

        <div>
          <span>
            Eligible assignment options
          </span>

          <strong>
            {eligible.length}
          </strong>

          <small>
            Players with at least one higher- or lower-level assignment supported by current evidence.
          </small>
        </div>

        <div>
          <span>
            Operations recommendations
          </span>

          <strong>
            {
              players.filter(
                (player) =>
                  player.operation
              ).length
            }
          </strong>

          <small>
            Developmentally defensible moves the organization actually needs.
          </small>
        </div>

        <div>
          <span>
            Behind peer development
          </span>

          <strong>
            {behind.length}
          </strong>

          <small>
            Scouting progression trails comparable minor leaguers.
          </small>
        </div>
      </div>


      <details className="development-guide-details">
        <summary>
          How to read this page
        </summary>

        <div className="development-guide">
          <div>
            <strong>
              Development recommendation
            </strong>

            <span>
              What assignment the player’s current evidence supports.
            </span>
          </div>

          <div>
            <strong>
              Eligible assignment
            </strong>

            <span>
              A level or destination that clears the development model’s evidence gates.
              It is not automatically a recommended transaction.
            </span>
          </div>

          <div>
            <strong>
              Operations
            </strong>

            <span>
              Whether moving the player now actually solves an organizational roster need.
            </span>
          </div>

          <div>
            <strong>
              Development pace vs peers
            </strong>

            <span>
              Change in our scouted current ability compared with similar players over
              the available history. It is not hidden true talent.
            </span>
          </div>
        </div>
      </details>


      {attention.length >
        0 && (
        <section>
          <div className="farm-section-head">
            <div>
              <div className="farm-kicker">
                Development meetings
              </div>

              <h2>
                Needs attention
              </h2>
            </div>

            <p>
              These are Player Development discussions, not automatic
              transactions.
            </p>
          </div>

          <div className="development-inbox">
            <aside className="development-inbox-list">
              <div className="development-inbox-list-head">
                <strong>
                  Development queue
                </strong>

                <span>
                  {attention.length}{' '}
                  {attention.length === 1
                    ? 'case'
                    : 'cases'}
                </span>
              </div>

              <div className="development-inbox-items">
                {attention.map(
                  (player) => {
                    const recommendation =
                      player.prospect
                        ?.decision
                        .recommendation;

                    const selected =
                      selectedAttention
                        ?.playerId ===
                      player.playerId;

                    return (
                      <button
                        key={
                          player.playerId
                        }
                        type="button"
                        className={
                          selected
                            ? 'development-inbox-item active'
                            : 'development-inbox-item'
                        }
                        onClick={
                          () =>
                            setSelectedAttentionPlayerId(
                              player.playerId
                            )
                        }
                      >
                        <div className="development-inbox-item-head">
                          <strong>
                            {player.name}
                          </strong>

                          {player.operation && (
                            <span className="development-inbox-operation">
                              OPS
                            </span>
                          )}
                        </div>

                        <div className="development-inbox-meta">
                          {player.age}
                          {' · '}
                          {player.listedRole}
                          {' · '}
                          {player.team}
                        </div>

                        {recommendation && (
                          <div
                            className={`development-inbox-recommendation ${recommendationClass(
                              recommendation
                            )}`}
                          >
                            {recommendationLabel(
                              recommendation
                            )}
                          </div>
                        )}

                        <div className="development-inbox-assignment">
                          {queueAssignmentLabel(
                            player
                          )}

                          <span>
                            {peerLabel(
                              player
                            )}
                          </span>
                        </div>
                      </button>
                    );
                  }
                )}
              </div>
            </aside>


            <div
              ref={developmentDetailRef}
              className="development-inbox-detail"
            >
              {selectedAttention ? (
                <AttentionCard
                  key={
                    selectedAttention.playerId
                  }
                  player={
                    selectedAttention
                  }
                />
              ) : (
                <div className="farm-empty">
                  No development cases require attention.
                </div>
              )}
            </div>
          </div>
        </section>
      )}


      <section>
        <div className="farm-section-head">
          <div>
            <div className="farm-kicker">
              Organization
            </div>

            <h2>
              Development board
            </h2>
          </div>

          <p>
            Players without enough current-level performance evidence remain
            visible rather than disappearing from the farm system.
          </p>
        </div>


        <div className="development-toolbar">
          <div className="development-filter-tabs">
            <button
              className={
                filter ===
                'attention'
                  ? 'active'
                  : ''
              }
              onClick={
                () =>
                  setFilter(
                    'attention'
                  )
              }
            >
              Attention
              <span>
                {attention.length}
              </span>
            </button>

            <button
              className={
                filter ===
                'eligible'
                  ? 'active'
                  : ''
              }
              onClick={
                () =>
                  setFilter(
                    'eligible'
                  )
              }
            >
              Eligible
              <span>
                {eligible.length}
              </span>
            </button>

            <button
              className={
                filter ===
                'watch'
                  ? 'active'
                  : ''
              }
              onClick={
                () =>
                  setFilter(
                    'watch'
                  )
              }
            >
              Watch
              <span>
                {watch.length}
              </span>
            </button>

            <button
              className={
                filter ===
                'behind'
                  ? 'active'
                  : ''
              }
              onClick={
                () =>
                  setFilter(
                    'behind'
                  )
              }
            >
              Behind peers
              <span>
                {behind.length}
              </span>
            </button>

            <button
              className={
                filter ===
                'all'
                  ? 'active'
                  : ''
              }
              onClick={
                () =>
                  setFilter(
                    'all'
                  )
              }
            >
              All
              <span>
                {players.length}
              </span>
            </button>
          </div>


          <div className="development-level-tabs">
            <button
              className={
                levelFilter ===
                'all'
                  ? 'active'
                  : ''
              }
              onClick={
                () =>
                  setLevelFilter(
                    'all'
                  )
              }
            >
              All levels
            </button>

            {levels.map(
              (level) => {
                const label =
                  players.find(
                    (player) =>
                      player.level ===
                      level
                  )?.levelName ??
                  `L${level}`;

                return (
                  <button
                    key={
                      level
                    }
                    className={
                      levelFilter ===
                      level
                        ? 'active'
                        : ''
                    }
                    onClick={
                      () =>
                        setLevelFilter(
                          level
                        )
                    }
                  >
                    {label}
                  </button>
                );
              }
            )}
          </div>
        </div>


        <div className="development-table-wrap">
          <table className="development-table">
            <thead>
              <tr>
                <th>
                  Player
                </th>

                <th>
                  Age
                </th>

                <th>
                  Club
                </th>

                <th>
                  Role
                </th>

                <th>
                  Scouted current → potential
                </th>

                <th>
                  Development pace vs peers
                </th>

                <th>
                  Development recommendation
                </th>

                <th>
                  Operations
                </th>
              </tr>
            </thead>

            <tbody>
              {filtered.map(
                (player) => {
                  const recommendation =
                    player.prospect
                      ?.decision
                      .recommendation;

                  return (
                    <tr
                      key={
                        player.playerId
                      }
                    >
                      <td>
                        <PlayerLink
                          id={
                            player.playerId
                          }
                        >
                          {player.name}
                        </PlayerLink>

                        {player.injured && (
                          <span className="development-inline-flag">
                            IL
                          </span>
                        )}
                      </td>

                      <td className="num">
                        {player.age}
                      </td>

                      <td>
                        <span className="level-tag">
                          {player.levelName}
                        </span>
                        {' '}
                        {player.team}
                      </td>

                      <td>
                        {player.listedRole}
                      </td>

                      <td>
                        {formatRatingPair(
                          player.current,
                          player.potential
                        )}
                      </td>

                      <td
                        className={
                          player.peerPace ===
                          'ahead'
                            ? 'farm-text-healthy'
                            : player.peerPace ===
                              'behind'
                              ? 'farm-text-thin'
                              : ''
                        }
                      >
                        {peerLabel(
                          player
                        )}
                      </td>

                      <td>
                        {recommendation ? (
                          <span
                            className={`development-table-status ${recommendationClass(
                              recommendation
                            )}`}
                            title={recommendationExplanation(
                              recommendation
                            )}
                          >
                            {recommendationLabel(
                              recommendation
                            )}
                          </span>
                        ) : (
                          <span className="muted">
                            Building sample
                          </span>
                        )}
                      </td>

                      <td>
                        {player.operation ? (
                          <span className="development-operation-tag">
                            Recommended
                          </span>
                        ) : (
                          <span className="muted">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                }
              )}
            </tbody>
          </table>
        </div>

        {filtered.length ===
          0 && (
          <div className="farm-empty">
            No players match this development view.
          </div>
        )}
      </section>


      <footer className="farm-model-note">
        <strong>
          Development model:
        </strong>
        {' '}
        performance establishes readiness; age changes urgency; organizational
        philosophy changes the promotion threshold; scouting history describes
        what the organization has observed; Operations decides whether a legal
        move is actually useful now.
      </footer>
    </div>
  );
}
