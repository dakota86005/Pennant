import {
  useEffect,
  useMemo,
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


type DecisionFilter =
  | 'all'
  | 'assignments'
  | 'release'
  | 'depth';


type PeerPace =
  | 'insufficient'
  | 'behind'
  | 'typical'
  | 'ahead';


interface RetentionPlayer {
  playerId: number;
  name: string;
  age: number;

  kind:
    | 'hitter'
    | 'pitcher';

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
    reasons?: string[];
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
    development: {
      score: number;
      reasons: string[];
    };

    developmentalRunway: {
      status:
        | 'not_applicable'
        | 'open'
        | 'limited';

      reasons: string[];
    };

    developmentHistory: {
      status: string;
      snapshotCount: number;
      observationDays:
        number | null;

      currentDelta:
        number | null;

      potentialDelta:
        number | null;

      reasons: string[];
    };

    peerDevelopment: {
      pace: PeerPace;

      percentile:
        number | null;

      ratePer100Days:
        number | null;

      cohortMedianRate:
        number | null;

      peerAdjustedRate:
        number | null;

      cohortSize: number;

      cohort: {
        kind:
          | 'hitter'
          | 'pitcher';

        ageBand: string;

        startingLevel:
          number | null;

        levelMatched:
          boolean;
      } | null;

      reasons: string[];
    };

    utility: {
      score: number;
      reasons: string[];
    };

    rosterPressure: {
      score: number;
      reasons: string[];
    };

    philosophy?: {
      retentionAdjustment: number;
      pressureAdjustment: number;
      reasons: string[];
    };
  };

  recommendation:
    | 'protected'
    | 'retain'
    | 'expendable_depth'
    | 'release_candidate';

  guardrails: string[];
  summary: string[];
}


interface RetentionResponse {
  counts: {
    protected: number;
    retain: number;
    expendable_depth: number;
    release_candidate: number;
  };

  players:
    RetentionPlayer[];

  safeguards:
    string[];
}


interface OperationsMove {
  playerId: number;
  playerName: string;
  age: number;

  fromTeam: string;
  toTeam: string;

  kind?: string;

  assignment?: {
    position?: string;
    fit?: number;
    use?: string;
  };

  currentRole?: string;

  destinationRole?: string;

  development?: {
    recommendation?: string | null;

    destinationFit?: {
      classification?: string;
    } | null;

    reasons?: string[];
  };

  reasons?: string[];
}


interface OperationsPlan {
  team?: string;

  level?: number;

  levelName?: string;

  before?: {
    overall?: string;
    positionPlayers?: number;
  };

  after?: {
    overall?: string;
    positionPlayers?: number;
  };

  moves:
    OperationsMove[];

  summary?: string[];
}


interface OperationsResponse {
  plans:
    OperationsPlan[];

  safeguards?: string[];

  pitching?: {
    plans?:
      OperationsPlan[];

    safeguards?:
      string[];
  };
}


interface AssignmentDecision {
  id: string;

  domain:
    | 'position'
    | 'pitching';

  plan:
    OperationsPlan;

  move:
    OperationsMove;
}


function roleLabel(
  player: RetentionPlayer
): string {
  if (
    player.kind === 'pitcher'
  ) {
    return player.role
      .developmentalPitcherRole ===
      'starter'
      ? 'SP'
      : 'RP';
  }

  return (
    player.role.listedPosition ||
    'Position player'
  );
}


function assignmentLabel(
  move: OperationsMove
): string {
  switch (move.kind) {
    case 'normal_promotion':
      return 'Normal promotion';

    case 'skip_level_promotion':
      return 'Skip-level promotion';

    case 'demotion':
      return 'Developmental demotion';

    case 'same_level_reassignment':
      return 'Reassignment';

    default:
      return 'Recommended assignment';
  }
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

  switch (
    value % 10
  ) {
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


function developmentValueLabel(
  score: number
): string {
  if (score < 20) {
    return 'Very low';
  }

  if (score < 30) {
    return 'Low';
  }

  if (score < 42) {
    return 'Limited';
  }

  if (score < 60) {
    return 'Meaningful';
  }

  return 'High';
}


function utilityLabel(
  score: number
): string {
  if (score < 20) {
    return 'Very low';
  }

  if (score < 35) {
    return 'Low';
  }

  if (score < 50) {
    return 'Useful';
  }

  if (score < 70) {
    return 'Strong';
  }

  return 'High';
}


function pressureLabel(
  score: number
): string {
  if (score >= 75) {
    return 'High';
  }

  if (score >= 50) {
    return 'Meaningful';
  }

  if (score >= 30) {
    return 'Moderate';
  }

  return 'Low';
}


function peerLabel(
  player: RetentionPlayer
): string {
  const peer =
    player.evidence
      .peerDevelopment;

  if (
    peer.pace ===
    'insufficient'
  ) {
    return 'Limited scouting history';
  }

  const percentile =
    peer.percentile == null
      ? ''
      : ` · ${ordinal(peer.percentile)} percentile`;

  if (
    peer.pace === 'ahead'
  ) {
    return (
      `Ahead of peers${percentile}`
    );
  }

  if (
    peer.pace === 'behind'
  ) {
    return (
      `Behind peers${percentile}`
    );
  }

  return (
    `Typical pace${percentile}`
  );
}


function uniqueReasons(
  values:
    Array<string | undefined>
): string[] {
  return [
    ...new Set(
      values.filter(
        (
          value
        ): value is string =>
          Boolean(value)
      )
    ),
  ];
}


function AssignmentCard({
  decision,
}: {
  decision:
    AssignmentDecision;
}) {
  const {
    move,
    plan,
    domain,
  } =
    decision;

  const reasons =
    uniqueReasons([
      ...(move.development
        ?.reasons ?? []),

      ...(move.reasons ?? []),

      ...(plan.summary ?? []),
    ]);


  return (
    <article className="farm-work-card farm-work-assignment">
      <div className="farm-work-card-head">
        <div>
          <div className="farm-decision-eyebrow">
            {domain ===
            'pitching'
              ? 'Pitching operations'
              : 'Minor league operations'}
          </div>

          <h3>
            <PlayerLink
              id={
                move.playerId
              }
            >
              {move.playerName}
            </PlayerLink>
          </h3>

          <div className="farm-player-meta">
            Age {move.age}
          </div>
        </div>

        <span className="farm-action-badge farm-action-move">
          {assignmentLabel(
            move
          )}
        </span>
      </div>


      <div className="farm-work-route">
        <div>
          <span>
            From
          </span>

          <strong>
            {move.fromTeam}
          </strong>
        </div>

        <b>
          →
        </b>

        <div>
          <span>
            To
          </span>

          <strong>
            {move.toTeam}
          </strong>
        </div>
      </div>


      <div className="farm-work-verdict">
        <strong>
          Why this reaches your desk
        </strong>

        <p>
          Player Development permits the assignment and Minor League Operations
          identifies an organizational reason to make it now.
        </p>
      </div>


      <div className="farm-work-facts">
        {move.assignment
          ?.position && (
          <div>
            <span>
              Assignment
            </span>

            <strong>
              {move.assignment.position}
            </strong>
          </div>
        )}

        {typeof move.assignment
          ?.fit ===
          'number' && (
          <div>
            <span>
              Destination fit
            </span>

            <strong>
              {Math.round(
                move.assignment.fit
              )}
              %
            </strong>
          </div>
        )}

        {move.destinationRole && (
          <div>
            <span>
              Developmental role
            </span>

            <strong>
              {move.destinationRole}
            </strong>
          </div>
        )}

        {plan.before
          ?.overall &&
          plan.after
            ?.overall && (
          <div>
            <span>
              Destination health
            </span>

            <strong>
              {plan.before.overall}
              {' → '}
              {plan.after.overall}
            </strong>
          </div>
        )}
      </div>


      <details className="farm-work-evidence">
        <summary>
          Full reasoning
        </summary>

        {reasons.length >
        0 ? (
          <ul className="farm-reason-list">
            {reasons.map(
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
        ) : (
          <p className="muted">
            No additional explanation returned.
          </p>
        )}
      </details>
    </article>
  );
}


function RetentionDecisionCard({
  player,
}: {
  player:
    RetentionPlayer;
}) {
  const release =
    player.recommendation ===
    'release_candidate';

  const peer =
    player.evidence
      .peerDevelopment;

  return (
    <article
      className={
        release
          ? 'farm-work-card farm-work-release'
          : 'farm-work-card farm-work-depth'
      }
    >
      <div className="farm-work-card-head">
        <div>
          <div className="farm-decision-eyebrow">
            Retention
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
            {roleLabel(
              player
            )}
            {' · '}
            {player.levelName}
            {' · '}
            {player.team}
          </div>
        </div>

        <span
          className={
            release
              ? 'farm-action-badge farm-action-release'
              : 'farm-action-badge farm-action-depth'
          }
        >
          {release
            ? 'Release candidate'
            : 'Expendable depth'}
        </span>
      </div>


      <div className="farm-work-verdict">
        <strong>
          {release
            ? 'Front Office recommendation'
            : 'Roster status'}
        </strong>

        <p>
          {player.summary[0] ??
            (
              release
                ? 'Evidence supports bringing a release decision to the GM.'
                : 'No strong current retention case is identified.'
            )}
        </p>
      </div>


      <div className="farm-work-facts">
        <div>
          <span>
            Scouted ability
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
            Development pace
          </span>

          <strong
            className={
              peer.pace ===
              'ahead'
                ? 'farm-text-healthy'
                : peer.pace ===
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

        <div>
          <span>
            Development value
          </span>

          <strong>
            {developmentValueLabel(
              player.evidence
                .development
                .score
            )}
          </strong>
        </div>

        <div>
          <span>
            Organizational utility
          </span>

          <strong>
            {utilityLabel(
              player.evidence
                .utility
                .score
            )}
          </strong>
        </div>

        <div>
          <span>
            Roster pressure
          </span>

          <strong>
            {pressureLabel(
              player.evidence
                .rosterPressure
                .score
            )}
          </strong>
        </div>

        <div>
          <span>
            Pro service
          </span>

          <strong>
            {player.transaction
              .proServiceYears}
            {' yr'}
            {player.transaction
              .proServiceYears ===
            1
              ? ''
              : 's'}
          </strong>
        </div>
      </div>


      <details className="farm-work-evidence">
        <summary>
          Full evidence
        </summary>

        <div className="farm-work-score-strip">
          <div>
            <span>
              Development
            </span>

            <strong>
              {player.evidence.development.score.toFixed(1)}
            </strong>
          </div>

          <div>
            <span>
              Utility
            </span>

            <strong>
              {player.evidence.utility.score.toFixed(1)}
            </strong>
          </div>

          <div>
            <span>
              Roster pressure
            </span>

            <strong>
              {player.evidence.rosterPressure.score.toFixed(1)}
            </strong>
          </div>

          <div>
            <span>
              Peer percentile
            </span>

            <strong>
              {peer.percentile == null
                ? '—'
                : ordinal(peer.percentile)}
            </strong>
          </div>
        </div>

        {player.evidence.development.reasons.length > 0 && (
        <div className="farm-work-evidence-section">
          <h4>
            Development
          </h4>

          <ul className="farm-reason-list">
            {player.evidence
              .development
              .reasons.map(
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
            Scouted development history
          </h4>

          <p>
            {peerLabel(
              player
            )}

            {peer.cohort
              ? (
                ` among ${peer.cohortSize} comparable ${peer.cohort.kind}s`
              )
              : ''}
            .
          </p>

          {player.evidence
            .developmentHistory
            .observationDays !=
            null && (
            <p>
              Observation window:{' '}
              <strong>
                {player.evidence
                  .developmentHistory
                  .observationDays}
                {' in-game days'}
              </strong>
              {' · '}
              {player.evidence
                .developmentHistory
                .snapshotCount}
              {' snapshots'}
            </p>
          )}

          <ul className="farm-reason-list">
            {[
              ...player.evidence
                .developmentHistory
                .reasons,

              ...peer.reasons,
            ].map(
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


        {player.evidence.utility.reasons.length > 0 && (
          <div className="farm-work-evidence-section">
            <h4>
              Organizational utility
            </h4>

            <ul className="farm-reason-list">
              {player.evidence
                .utility
                .reasons.map(
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


        {player.evidence.rosterPressure.reasons.length > 0 && (
          <div className="farm-work-evidence-section">
            <h4>
              Roster pressure
            </h4>

            <ul className="farm-reason-list">
              {player.evidence
                .rosterPressure
                .reasons.map(
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


        {player.guardrails.length >
          0 && (
          <div className="farm-work-evidence-section">
            <h4>
              Guardrails
            </h4>

            <ul className="farm-reason-list">
              {player.guardrails.map(
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
      </details>
    </article>
  );
}


export function FarmDecisions({
  orgId,
  orgLabel,
}: {
  orgId:
    number;

  orgLabel:
    string;
}) {
  const [
    filter,
    setFilter,
  ] =
    useState<DecisionFilter>(
      'all'
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

      setRetention(null);
      setOperations(null);
      setError(null);

      Promise.all([
        apiGet<RetentionResponse>(
          `/api/minor-league-retention/${orgId}`
        ),

        apiGet<OperationsResponse>(
          `/api/minor-league-moves/${orgId}`
        ),
      ])
        .then(
          ([
            retentionResult,
            operationsResult,
          ]) => {
            if (
              cancelled
            ) {
              return;
            }

            setRetention(
              retentionResult
            );

            setOperations(
              operationsResult
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


  const assignments =
    useMemo<
      AssignmentDecision[]
    >(
      () => {
        if (
          !operations
        ) {
          return [];
        }

        const position =
          operations.plans
            .flatMap(
              (
                plan,
                planIndex
              ) =>
                plan.moves.map(
                  (
                    move,
                    moveIndex
                  ) => ({
                    id:
                      `position-${planIndex}-${moveIndex}-${move.playerId}`,

                    domain:
                      'position' as const,

                    plan,
                    move,
                  })
                )
            );

        const pitching =
          operations.pitching
            ?.plans
            ?.flatMap(
              (
                plan,
                planIndex
              ) =>
                plan.moves.map(
                  (
                    move,
                    moveIndex
                  ) => ({
                    id:
                      `pitching-${planIndex}-${moveIndex}-${move.playerId}`,

                    domain:
                      'pitching' as const,

                    plan,
                    move,
                  })
                )
            ) ?? [];

        return [
          ...position,
          ...pitching,
        ];
      },
      [operations]
    );


  const release =
    useMemo(
      () =>
        retention
          ?.players
          .filter(
            (player) =>
              player.recommendation ===
              'release_candidate'
          ) ?? [],
      [retention]
    );


  const depth =
    useMemo(
      () =>
        retention
          ?.players
          .filter(
            (player) =>
              player.recommendation ===
              'expendable_depth'
          ) ?? [],
      [retention]
    );


  if (error) {
    return (
      <div className="banner error">
        {error}
      </div>
    );
  }


  if (
    !retention ||
    !operations
  ) {
    return (
      <p className="muted">
        Building the decision queue…
      </p>
    );
  }


  const total =
    assignments.length +
    release.length +
    depth.length;


  return (
    <div className="farm-decisions-page">
      <header className="farm-page-head">
        <div>
          <div className="farm-kicker">
            Farm System
          </div>

          <h1>
            Decisions
          </h1>

          <p>
            The working queue for {orgLabel}: assignments that solve an
            organizational problem, players worth discussing for release,
            and depth pieces available for roster churn.
          </p>
        </div>
      </header>


      <div className="farm-decision-tabs">
        <button
          className={
            filter === 'all'
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
            {total}
          </span>
        </button>

        <button
          className={
            filter ===
            'assignments'
              ? 'active'
              : ''
          }
          onClick={
            () =>
              setFilter(
                'assignments'
              )
          }
        >
          Assignments
          <span>
            {assignments.length}
          </span>
        </button>

        <button
          className={
            filter ===
            'release'
              ? 'active'
              : ''
          }
          onClick={
            () =>
              setFilter(
                'release'
              )
          }
        >
          Release candidates
          <span>
            {release.length}
          </span>
        </button>

        <button
          className={
            filter ===
            'depth'
              ? 'active'
              : ''
          }
          onClick={
            () =>
              setFilter(
                'depth'
              )
          }
        >
          Expendable depth
          <span>
            {depth.length}
          </span>
        </button>
      </div>


      <div className="farm-decisions-intro">
        Front Office ranks attention, not authority. These are recommendations
        for the GM; no OOTP transaction is made automatically.
      </div>


      {(filter ===
        'all' ||
        filter ===
          'assignments') && (
        <section className="farm-work-section">
          <div className="farm-section-head">
            <div>
              <div className="farm-kicker">
                Operations
              </div>

              <h2>
                Recommended assignments
              </h2>
            </div>

            <p>
              A developmentally legal move is shown here only when Operations
              also finds a real organizational reason to make it.
            </p>
          </div>

          {assignments.length ===
          0 ? (
            <div className="farm-empty">
              No assignment currently survives both the Player Development and
              Minor League Operations checks.
            </div>
          ) : (
            <div className="farm-work-list">
              {assignments.map(
                (
                  decision
                ) => (
                  <AssignmentCard
                    key={
                      decision.id
                    }
                    decision={
                      decision
                    }
                  />
                )
              )}
            </div>
          )}
        </section>
      )}


      {(filter ===
        'all' ||
        filter ===
          'release') && (
        <section className="farm-work-section">
          <div className="farm-section-head">
            <div>
              <div className="farm-kicker">
                Retention
              </div>

              <h2>
                Release candidates
              </h2>
            </div>

            <p>
              Stronger than expendable depth: several independent pieces of
              evidence agree that a release discussion is warranted.
            </p>
          </div>

          {release.length ===
          0 ? (
            <div className="farm-empty">
              No player meets the conservative release-candidate standard.
            </div>
          ) : (
            <div className="farm-work-list">
              {release.map(
                (
                  player
                ) => (
                  <RetentionDecisionCard
                    key={
                      player.playerId
                    }
                    player={
                      player
                    }
                  />
                )
              )}
            </div>
          )}
        </section>
      )}


      {(filter ===
        'all' ||
        filter ===
          'depth') && (
        <section className="farm-work-section">
          <div className="farm-section-head">
            <div>
              <div className="farm-kicker">
                Roster churn
              </div>

              <h2>
                Expendable depth
              </h2>
            </div>

            <p>
              Players without a compelling present retention case where the
              evidence still stops short of affirmatively recommending release.
            </p>
          </div>

          {depth.length ===
          0 ? (
            <div className="farm-empty">
              No expendable-depth players identified.
            </div>
          ) : (
            <div className="farm-work-list">
              {depth.map(
                (
                  player
                ) => (
                  <RetentionDecisionCard
                    key={
                      player.playerId
                    }
                    player={
                      player
                    }
                  />
                )
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
