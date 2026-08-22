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


type HealthStatus =
  | 'critical'
  | 'thin'
  | 'healthy'
  | 'surplus';


interface AffiliateHealth {
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
    bodyCountStatus:
      HealthStatus;

    fieldablePositions:
      number;

    canFieldDefense:
      boolean;

    coverage: Array<{
      position: string;
      playable: number;
      strong: number;
      emergency: number;
      status:
        HealthStatus;
    }>;
  };

  pitching: {
    bodyCountStatus:
      HealthStatus;

    rotationStatus:
      HealthStatus;

    bullpenStatus:
      HealthStatus;

    starters: number;
    relievers: number;
    closers: number;
  };

  overall:
    HealthStatus;

  issues:
    string[];
}


interface RosterHealthResponse {
  orgId: number;

  affiliates:
    AffiliateHealth[];
}


type RetentionRecommendation =
  | 'protected'
  | 'retain'
  | 'expendable_depth'
  | 'release_candidate';


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

    proServiceYears:
      number;
  };

  role: {
    listedPosition:
      string;

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

      reasons:
        string[];
    };

    developmentHistory: {
      status:
        string;

      snapshotCount:
        number;

      observationDays:
        number | null;

      currentDelta:
        number | null;

      potentialDelta:
        number | null;

      reasons:
        string[];
    };

    peerDevelopment: {
      pace:
        | 'insufficient'
        | 'behind'
        | 'typical'
        | 'ahead';

      percentile:
        number | null;

      peerAdjustedRate:
        number | null;

      cohortSize:
        number;

      reasons:
        string[];
    };

    utility: {
      score: number;
      reasons: string[];
    };

    rosterPressure: {
      score: number;
      reasons: string[];
    };
  };

  recommendation:
    RetentionRecommendation;

  guardrails:
    string[];

  summary:
    string[];
}


interface RetentionResponse {
  orgId: number;

  counts: Record<
    RetentionRecommendation,
    number
  >;

  players:
    RetentionPlayer[];

  safeguards:
    string[];
}


interface OperationsMove {
  playerId: number;
  playerName: string;

  age:
    number;

  fromTeamId?:
    number;

  fromTeam:
    string;

  toTeamId?:
    number;

  toTeam:
    string;

  kind?:
    string;

  assignment?: {
    position?: string;
    fit?: number;
    use?: string;
  };

  currentRole?:
    string;

  destinationRole?:
    string;

  development?: {
    recommendation?:
      string | null;

    destinationFit?: {
      classification?: string;
    } | null;

    reasons?:
      string[];
  };

  reasons?:
    string[];
}


interface OperationsPlan {
  teamId?: number;
  team: string;

  level?:
    number;

  levelName?:
    string;

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

  summary?:
    string[];
}


interface PitchingOperations {
  plans?:
    OperationsPlan[];

  safeguards?:
    string[];
}


interface OperationsResponse {
  orgId: number;

  plans:
    OperationsPlan[];

  deferred?: Array<{
    teamId: number;
    team: string;
    reason: string;
  }>;

  safeguards?:
    string[];

  pitching?:
    PitchingOperations;
}


interface FarmData {
  rosters:
    RosterHealthResponse;

  retention:
    RetentionResponse;

  operations:
    OperationsResponse;
}


interface DisplayMove {
  domain:
    'position'
    | 'pitching';

  plan:
    OperationsPlan;

  move:
    OperationsMove;
}


function healthLabel(
  status: HealthStatus
): string {
  switch (status) {
    case 'critical':
      return 'Critical';

    case 'thin':
      return 'Needs attention';

    case 'surplus':
      return 'Surplus';

    default:
      return 'Healthy';
  }
}


function moveKindLabel(
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
      return 'Recommended move';
  }
}


function playerRole(
  player: RetentionPlayer
): string {
  if (
    player.kind === 'pitcher'
  ) {
    if (
      player.role
        .developmentalPitcherRole ===
      'starter'
    ) {
      return 'SP';
    }

    return 'RP';
  }

  return (
    player.role.listedPosition ||
    'Position player'
  );
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
    return (
      'Scouting history still limited'
    );
  }

  const pct =
    peer.percentile == null
      ? ''
      : ` · ${peer.percentile}th percentile`;

  switch (peer.pace) {
    case 'ahead':
      return (
        `Developing ahead of peers${pct}`
      );

    case 'behind':
      return (
        `Developing behind peers${pct}`
      );

    default:
      return (
        `Development pace typical${pct}`
      );
  }
}


function moveEvidence(
  item: DisplayMove
): string[] {
  const {
    move,
    plan,
  } = item;

  const reasons = [
    ...(move.development
      ?.reasons ?? []),

    ...(move.reasons ?? []),

    ...(plan.summary ?? []),
  ];

  return [
    ...new Set(
      reasons.filter(Boolean)
    ),
  ].slice(0, 4);
}


function AffiliateCard({
  affiliate,
}: {
  affiliate:
    AffiliateHealth;
}) {
  return (
    <article
      className={`farm-affiliate farm-health-${affiliate.overall}`}
    >
      <div className="farm-affiliate-head">
        <div>
          <div className="farm-affiliate-level">
            {affiliate.levelName}
          </div>

          <h3>
            {affiliate.label}
          </h3>
        </div>

        <span
          className={`farm-status farm-status-${affiliate.overall}`}
        >
          {healthLabel(
            affiliate.overall
          )}
        </span>
      </div>

      <div className="farm-roster-line">
        <strong>
          {affiliate.roster.total}
        </strong>
        {' '}active

        <span>
          {affiliate.roster.positionPlayers}
          {' '}position players
        </span>

        <span>
          {affiliate.roster.pitchers}
          {' '}pitchers
        </span>
      </div>

      <div className="farm-health-grid">
        <div>
          <span>
            Position group
          </span>

          <strong
            className={`farm-text-${affiliate.positionPlayers.bodyCountStatus}`}
          >
            {healthLabel(
              affiliate
                .positionPlayers
                .bodyCountStatus
            )}
          </strong>
        </div>

        <div>
          <span>
            Rotation
          </span>

          <strong
            className={`farm-text-${affiliate.pitching.rotationStatus}`}
          >
            {affiliate.pitching.starters}
            {' SP · '}
            {healthLabel(
              affiliate.pitching
                .rotationStatus
            )}
          </strong>
        </div>

        <div>
          <span>
            Bullpen
          </span>

          <strong
            className={`farm-text-${affiliate.pitching.bullpenStatus}`}
          >
            {affiliate.pitching.relievers}
            {' RP · '}
            {healthLabel(
              affiliate.pitching
                .bullpenStatus
            )}
          </strong>
        </div>
      </div>

      {affiliate.issues.length > 0 ? (
        <ul className="farm-issue-list">
          {affiliate.issues
            .slice(0, 3)
            .map(
              (
                issue,
                index
              ) => (
                <li
                  key={index}
                >
                  {issue}
                </li>
              )
            )}
        </ul>
      ) : (
        <p className="farm-all-clear">
          No structural roster issue identified.
        </p>
      )}
    </article>
  );
}


function MoveCard({
  item,
}: {
  item: DisplayMove;
}) {
  const {
    move,
    plan,
    domain,
  } = item;

  const evidence =
    moveEvidence(item);

  return (
    <article className="farm-decision-card farm-move-card">
      <div className="farm-decision-top">
        <div>
          <div className="farm-decision-eyebrow">
            {domain ===
            'pitching'
              ? 'Pitching operations'
              : 'Minor league operations'}
          </div>

          <h3>
            <PlayerLink
              id={move.playerId}
            >
              {move.playerName}
            </PlayerLink>
          </h3>

          <div className="farm-player-meta">
            Age {move.age}
          </div>
        </div>

        <span className="farm-action-badge farm-action-move">
          {moveKindLabel(
            move
          )}
        </span>
      </div>

      <div className="farm-route">
        <span>
          {move.fromTeam}
        </span>

        <strong>
          →
        </strong>

        <span>
          {move.toTeam}
        </span>
      </div>

      {move.assignment
        ?.position && (
        <p className="farm-assignment">
          Projected role:{' '}
          <strong>
            {move.assignment.position}
          </strong>

          {typeof move.assignment
            .fit === 'number'
            ? ` · ${Math.round(
                move.assignment.fit
              )}% assignment fit`
            : ''}
        </p>
      )}

      {move.destinationRole && (
        <p className="farm-assignment">
          Developmental pitching role:{' '}
          <strong>
            {move.destinationRole}
          </strong>
        </p>
      )}

      {evidence.length > 0 && (
        <ul className="farm-reason-list">
          {evidence.map(
            (
              reason,
              index
            ) => (
              <li key={index}>
                {reason}
              </li>
            )
          )}
        </ul>
      )}

      {plan.before?.overall &&
        plan.after?.overall && (
        <div className="farm-plan-impact">
          Destination:{' '}
          <strong>
            {healthLabel(
              plan.before
                .overall as
                HealthStatus
            )}
          </strong>

          {' → '}

          <strong>
            {healthLabel(
              plan.after
                .overall as
                HealthStatus
            )}
          </strong>
        </div>
      )}
    </article>
  );
}


function RetentionCard({
  player,
  compact = false,
}: {
  player:
    RetentionPlayer;

  compact?:
    boolean;
}) {
  const release =
    player.recommendation ===
    'release_candidate';

  return (
    <article
      className={
        release
          ? 'farm-decision-card farm-release-card'
          : 'farm-decision-card farm-depth-card'
      }
    >
      <div className="farm-decision-top">
        <div>
          <div className="farm-decision-eyebrow">
            Retention
          </div>

          <h3>
            <PlayerLink
              id={player.playerId}
            >
              {player.name}
            </PlayerLink>
          </h3>

          <div className="farm-player-meta">
            {player.age}
            {' · '}
            {playerRole(player)}
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

      {!compact && (
        <>
          <div className="farm-player-evaluation">
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
                Development
              </span>

              <strong
                className={
                  player.evidence
                    .peerDevelopment
                    .pace ===
                  'ahead'
                    ? 'farm-text-healthy'
                    : player.evidence
                        .peerDevelopment
                        .pace ===
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

          {player.summary.length >
            0 && (
            <p className="farm-summary-copy">
              {player.summary[0]}
            </p>
          )}

          <details className="farm-evidence">
            <summary>
              View evidence
            </summary>

            <div className="farm-evidence-grid">
              <div>
                <span>
                  Development value
                </span>

                <strong>
                  {player.evidence
                    .development
                    .score.toFixed(
                      1
                    )}
                </strong>
              </div>

              <div>
                <span>
                  Organizational utility
                </span>

                <strong>
                  {player.evidence
                    .utility
                    .score.toFixed(
                      1
                    )}
                </strong>
              </div>

              <div>
                <span>
                  Roster pressure
                </span>

                <strong>
                  {player.evidence
                    .rosterPressure
                    .score.toFixed(
                      1
                    )}
                </strong>
              </div>

              <div>
                <span>
                  Peer development
                </span>

                <strong>
                  {player.evidence
                    .peerDevelopment
                    .percentile ??
                    '—'}
                  {player.evidence
                    .peerDevelopment
                    .percentile == null
                    ? ''
                    : 'th pct'}
                </strong>
              </div>
            </div>

            <ul className="farm-reason-list">
              {[
                ...player.evidence
                  .development
                  .reasons,

                ...player.evidence
                  .utility
                  .reasons,

                ...player.evidence
                  .rosterPressure
                  .reasons,

                ...player.evidence
                  .peerDevelopment
                  .reasons,
              ]
                .slice(0, 8)
                .map(
                  (
                    reason,
                    index
                  ) => (
                    <li
                      key={index}
                    >
                      {reason}
                    </li>
                  )
                )}
            </ul>
          </details>
        </>
      )}
    </article>
  );
}


export function FarmSystem({
  orgId,
  orgLabel,
}: {
  orgId:
    number;

  orgLabel:
    string;
}) {
  const [
    data,
    setData,
  ] =
    useState<FarmData | null>(
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

      setData(null);
      setError(null);

      Promise.all([
        apiGet<RosterHealthResponse>(
          `/api/minor-league-rosters/${orgId}`
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
            rosters,
            retention,
            operations,
          ]) => {
            if (
              cancelled
            ) {
              return;
            }

            setData({
              rosters,
              retention,
              operations,
            });
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


  const positionMoves =
    useMemo<
      DisplayMove[]
    >(
      () =>
        data?.operations.plans
          .flatMap(
            (plan) =>
              plan.moves.map(
                (move) => ({
                  domain:
                    'position' as const,

                  plan,
                  move,
                })
              )
          ) ?? [],
      [data]
    );


  const pitchingMoves =
    useMemo<
      DisplayMove[]
    >(
      () =>
        data?.operations
          .pitching
          ?.plans
          ?.flatMap(
            (plan) =>
              plan.moves.map(
                (move) => ({
                  domain:
                    'pitching' as const,

                  plan,
                  move,
                })
              )
          ) ?? [],
      [data]
    );


  if (error) {
    return (
      <div className="banner error">
        {error}
      </div>
    );
  }


  if (!data) {
    return (
      <p className="muted">
        Reviewing the farm system…
      </p>
    );
  }


  const {
    affiliates,
  } =
    data.rosters;


  const {
    counts,
    players,
  } =
    data.retention;


  const releaseCandidates =
    players.filter(
      (player) =>
        player.recommendation ===
        'release_candidate'
    );


  const expendable =
    players.filter(
      (player) =>
        player.recommendation ===
        'expendable_depth'
    );


  const flaggedAffiliates =
    affiliates.filter(
      (affiliate) =>
        affiliate.overall !==
        'healthy'
    ).length;


  const moves = [
    ...positionMoves,
    ...pitchingMoves,
  ];


  return (
    <div className="farm-page">
      <header className="farm-page-head">
        <div>
          <div className="farm-kicker">
            Farm System
          </div>

          <h1>
            {orgLabel}
            {' '}
            Player Development
          </h1>

          <p>
            Run the organization from the problems that need decisions:
            affiliate health, developmentally defensible assignments,
            and players whose roster spot deserves review.
          </p>
        </div>
      </header>


      <div className="farm-scouting-note">
        <strong>
          Scouting fog of war:
        </strong>
        {' '}
        player-quality and development judgments use the organization's
        saved scouting observations. Objective roster, contract, injury,
        service-time, and statistical facts remain factual.
      </div>


      <section>
        <div className="farm-section-head">
          <div>
            <div className="farm-kicker">
              Organization
            </div>

            <h2>
              What needs your attention
            </h2>
          </div>
        </div>

        <div className="farm-metric-grid">
          <div className="farm-metric farm-metric-danger">
            <span>
              Release candidates
            </span>

            <strong>
              {counts.release_candidate}
            </strong>

            <small>
              Front Office is affirmatively raising these for a GM decision.
            </small>
          </div>

          <div className="farm-metric farm-metric-action">
            <span>
              Recommended assignments
            </span>

            <strong>
              {moves.length}
            </strong>

            <small>
              Moves that survive both development and operations checks.
            </small>
          </div>

          <div className="farm-metric">
            <span>
              Expendable depth
            </span>

            <strong>
              {counts.expendable_depth}
            </strong>

            <small>
              No strong retention case, but not an affirmative release call.
            </small>
          </div>

          <div className="farm-metric">
            <span>
              Affiliates flagged
            </span>

            <strong>
              {flaggedAffiliates}
            </strong>

            <small>
              Thin, critical, or surplus roster structures.
            </small>
          </div>
        </div>
      </section>


      <section>
        <div className="farm-section-head">
          <div>
            <div className="farm-kicker">
              Affiliates
            </div>

            <h2>
              Organization health
            </h2>
          </div>

          <p>
            Active roster structure, not raw organizational assignment counts.
          </p>
        </div>

        <div className="farm-affiliate-grid">
          {affiliates.map(
            (affiliate) => (
              <AffiliateCard
                key={
                  affiliate.teamId
                }
                affiliate={
                  affiliate
                }
              />
            )
          )}
        </div>
      </section>


      <section>
        <div className="farm-section-head">
          <div>
            <div className="farm-kicker">
              Operations
            </div>

            <h2>
              Recommended moves
            </h2>
          </div>

          <p>
            Player Development decides what is defensible; Operations only recommends a move when it solves a real roster problem.
          </p>
        </div>

        {moves.length ===
        0 ? (
          <div className="farm-empty">
            No organizational reassignment is necessary right now.
            A legal developmental move does not become a transaction
            unless the farm system has a reason to make it.
          </div>
        ) : (
          <div className="farm-decision-grid">
            {moves.map(
              (
                item,
                index
              ) => (
                <MoveCard
                  key={`${item.domain}-${item.move.playerId}-${item.move.toTeam}-${index}`}
                  item={item}
                />
              )
            )}
          </div>
        )}
      </section>


      <section>
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
            Advisory flags only. Front Office never makes the transaction for you.
          </p>
        </div>

        {releaseCandidates.length ===
        0 ? (
          <div className="farm-empty">
            No player currently meets the conservative release-candidate standard.
          </div>
        ) : (
          <div className="farm-decision-grid">
            {releaseCandidates.map(
              (player) => (
                <RetentionCard
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


      <section>
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
            Players without a strong current retention case, but for whom the evidence stops short of recommending release.
          </p>
        </div>

        {expendable.length ===
        0 ? (
          <div className="farm-empty">
            No expendable-depth players identified.
          </div>
        ) : (
          <>
            <div className="farm-depth-list">
              {expendable
                .slice(0, 8)
                .map(
                  (player) => (
                    <RetentionCard
                      key={
                        player.playerId
                      }
                      player={
                        player
                      }
                      compact
                    />
                  )
                )}
            </div>

            {expendable.length >
              8 && (
              <p className="muted farm-more">
                +{' '}
                {expendable.length -
                  8}
                {' '}
                additional expendable-depth players.
                The dedicated Decisions view will expose the complete queue.
              </p>
            )}
          </>
        )}
      </section>


      <footer className="farm-model-note">
        <strong>
          V1 decision model:
        </strong>
        {' '}
        protected players remain protected; defensible development and
        organizational needs take precedence; release candidates require
        multiple independent signals to agree.
      </footer>
    </div>
  );
}
