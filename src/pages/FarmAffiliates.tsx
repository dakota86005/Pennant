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


type PeerPace =
  | 'insufficient'
  | 'behind'
  | 'typical'
  | 'ahead';


interface CoveragePlayer {
  playerId: number;
  name: string;
  listedPosition: string;
  rating: number | null;
  primary: boolean;
}


interface PositionCoverage {
  position: string;
  playable: number;
  strong: number;
  emergency: number;
  status: HealthStatus;
  players: CoveragePlayer[];
}


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
    bodyCountStatus: HealthStatus;
    fieldablePositions: number;
    canFieldDefense: boolean;
    coverage: PositionCoverage[];
  };

  pitching: {
    bodyCountStatus: HealthStatus;
    rotationStatus: HealthStatus;
    bullpenStatus: HealthStatus;

    starters: number;
    relievers: number;
    closers: number;

    starterStamina: number;
    longArmStamina: number;
    staminaKnown: number;
  };

  fatigue: {
    averagePoints: number;
    maxPoints: number;
    nonzeroPlayers: number;
    playedToday: number;
  };

  overall: HealthStatus;
  issues: string[];
}


interface HealthResponse {
  orgId: number;
  affiliates: AffiliateHealth[];
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

  current: number | null;
  potential: number | null;

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

    internalSameLevelNeed: string[];
    legalDevelopmentMoves: string[];
  };

  evidence: {
    developmentalRunway: {
      status:
        | 'not_applicable'
        | 'open'
        | 'limited';

      reasons: string[];
    };

    peerDevelopment: {
      pace: PeerPace;
      percentile: number | null;
      cohortSize: number;
      reasons: string[];
    };
  };

  recommendation:
    RetentionRecommendation;

  summary: string[];
}


interface RetentionResponse {
  players: RetentionPlayer[];
}


interface OperationsMove {
  playerId: number;
  playerName: string;
  age: number;

  fromTeamId?: number;
  fromTeam: string;

  toTeamId?: number;
  toTeam: string;

  kind?: string;

  assignment?: {
    position?: string;
    fit?: number;
  };

  destinationRole?: string;

  reasons?: string[];

  development?: {
    reasons?: string[];
  };
}


interface OperationsPlan {
  teamId?: number;
  team: string;

  level?: number;
  levelName?: string;

  moves: OperationsMove[];

  summary?: string[];
}


interface OperationsResponse {
  plans: OperationsPlan[];

  pitching?: {
    plans?: OperationsPlan[];
  };
}


interface AffiliateData {
  health: HealthResponse;
  retention: RetentionResponse;
  operations: OperationsResponse;
}


interface DisplayMove {
  domain:
    | 'position'
    | 'pitching';

  move: OperationsMove;
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
  player: RetentionPlayer
): string {
  const peer =
    player.evidence
      .peerDevelopment;

  if (
    peer.pace ===
    'insufficient'
  ) {
    return 'Limited history';
  }

  const pct =
    peer.percentile == null
      ? ''
      : ` · ${ordinal(peer.percentile)}`;

  if (
    peer.pace === 'ahead'
  ) {
    return `Ahead${pct}`;
  }

  if (
    peer.pace === 'behind'
  ) {
    return `Behind${pct}`;
  }

  return `Typical${pct}`;
}


function retentionLabel(
  value: RetentionRecommendation
): string {
  switch (value) {
    case 'release_candidate':
      return 'Release candidate';

    case 'expendable_depth':
      return 'Expendable depth';

    case 'protected':
      return 'Protected';

    default:
      return 'Retain';
  }
}


function moveLabel(
  move: OperationsMove
): string {
  switch (move.kind) {
    case 'normal_promotion':
      return 'Promotion';

    case 'skip_level_promotion':
      return 'Skip-level promotion';

    case 'demotion':
      return 'Demotion';

    case 'same_level_reassignment':
      return 'Reassignment';

    default:
      return 'Recommended move';
  }
}


function retentionClass(
  value: RetentionRecommendation
): string {
  if (
    value ===
    'release_candidate'
  ) {
    return 'affiliate-roster-release';
  }

  if (
    value ===
    'expendable_depth'
  ) {
    return 'affiliate-roster-depth';
  }

  if (
    value ===
    'protected'
  ) {
    return 'affiliate-roster-protected';
  }

  return '';
}


function CoverageCard({
  coverage,
}: {
  coverage:
    PositionCoverage;
}) {
  return (
    <article
      className={`affiliate-coverage-card affiliate-health-${coverage.status}`}
    >
      <div className="affiliate-coverage-head">
        <strong>
          {coverage.position}
        </strong>

        <span
          className={`farm-status farm-status-${coverage.status}`}
        >
          {healthLabel(
            coverage.status
          )}
        </span>
      </div>

      <div className="affiliate-coverage-count">
        {coverage.playable}
        {' playable'}

        {coverage.strong > 0
          ? ` · ${coverage.strong} strong`
          : ''}
      </div>

      <div className="affiliate-coverage-players">
        {coverage.players.length ===
        0 ? (
          <span className="affiliate-coverage-none">
            No established option
          </span>
        ) : (
          coverage.players
            .slice(0, 3)
            .map(
              (player) => (
                <div
                  key={
                    player.playerId
                  }
                >
                  <PlayerLink
                    id={
                      player.playerId
                    }
                  >
                    {player.name}
                  </PlayerLink>

                  <span>
                    {player.primary
                      ? 'primary'
                      : player.listedPosition}

                    {player.rating == null
                      ? ''
                      : ` · ${player.rating}`}
                  </span>
                </div>
              )
            )
        )}
      </div>
    </article>
  );
}


function RosterTable({
  title,
  players,
}: {
  title: string;
  players: RetentionPlayer[];
}) {
  return (
    <div className="affiliate-roster-group">
      <h3>
        {title}
        <span>
          {players.length}
        </span>
      </h3>

      {players.length ===
      0 ? (
        <div className="farm-empty">
          No active players in this group.
        </div>
      ) : (
        <div className="affiliate-roster-table-wrap">
          <table className="affiliate-roster-table">
            <thead>
              <tr>
                <th>
                  Player
                </th>

                <th>
                  Age
                </th>

                <th>
                  Role
                </th>

                <th>
                  Scouted ability
                </th>

                <th>
                  Development
                </th>

                <th>
                  Org status
                </th>
              </tr>
            </thead>

            <tbody>
              {players.map(
                (player) => (
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
                    </td>

                    <td className="num">
                      {player.age}
                    </td>

                    <td>
                      {player.kind ===
                      'pitcher'
                        ? (
                            player.role
                              .developmentalPitcherRole ===
                            'starter'
                              ? 'Dev SP'
                              : 'Dev RP'
                          )
                        : player.role
                            .listedPosition}
                    </td>

                    <td>
                      {formatRatingPair(
                        player.current,
                        player.potential
                      )}
                    </td>

                    <td
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
                    </td>

                    <td>
                      <span
                        className={`affiliate-roster-status ${retentionClass(
                          player.recommendation
                        )}`}
                      >
                        {retentionLabel(
                          player.recommendation
                        )}
                      </span>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


export function FarmAffiliates({
  orgId,
  orgLabel,
}: {
  orgId: number;
  orgLabel: string;
}) {
  const [
    data,
    setData,
  ] =
    useState<AffiliateData | null>(
      null
    );

  const [
    selectedTeamId,
    setSelectedTeamId,
  ] =
    useState<number | null>(
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
      setSelectedTeamId(null);
      setError(null);

      Promise.all([
        apiGet<HealthResponse>(
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
            health,
            retention,
            operations,
          ]) => {
            if (
              cancelled
            ) {
              return;
            }

            setData({
              health,
              retention,
              operations,
            });

            const firstFlagged =
              health.affiliates.find(
                (affiliate) =>
                  affiliate.overall !==
                  'healthy'
              );

            setSelectedTeamId(
              firstFlagged
                ?.teamId ??
                health.affiliates[0]
                  ?.teamId ??
                null
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


  const allMoves =
    useMemo<
      DisplayMove[]
    >(
      () => {
        if (
          !data
        ) {
          return [];
        }

        const position =
          data.operations.plans
            .flatMap(
              (plan) =>
                plan.moves.map(
                  (move) => ({
                    domain:
                      'position' as const,

                    move,
                  })
                )
            );

        const pitching =
          data.operations
            .pitching
            ?.plans
            ?.flatMap(
              (plan) =>
                plan.moves.map(
                  (move) => ({
                    domain:
                      'pitching' as const,

                    move,
                  })
                )
            ) ?? [];

        return [
          ...position,
          ...pitching,
        ];
      },
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
        Opening affiliate reports…
      </p>
    );
  }


  const affiliate =
    data.health.affiliates.find(
      (item) =>
        item.teamId ===
        selectedTeamId
    ) ??
    data.health.affiliates[0];


  if (!affiliate) {
    return (
      <div className="farm-empty">
        No minor-league affiliates were found for this organization.
      </div>
    );
  }


  /*
   * Retention works from the full assigned organization, but its `active`
   * flag is derived from team_roster list 2. Filtering here therefore gives
   * us the same available roster used by the health engine rather than the
   * full list-1 assignment roster.
   */
  const activePlayers =
    data.retention.players
      .filter(
        (player) =>
          player.teamId ===
            affiliate.teamId &&
          player.transaction.active
      );


  const hitters =
    activePlayers
      .filter(
        (player) =>
          player.kind ===
          'hitter'
      )
      .sort(
        (a, b) =>
          a.role.listedPosition
            .localeCompare(
              b.role.listedPosition
            ) ||
          b.potential! -
            a.potential!
      );


  const pitchers =
    activePlayers
      .filter(
        (player) =>
          player.kind ===
          'pitcher'
      )
      .sort(
        (a, b) => {
          const aStarter =
            a.role
              .developmentalPitcherRole ===
            'starter'
              ? 0
              : 1;

          const bStarter =
            b.role
              .developmentalPitcherRole ===
            'starter'
              ? 0
              : 1;

          return (
            aStarter -
              bStarter ||
            (b.potential ??
              0) -
              (a.potential ??
                0)
          );
        }
      );


  const moves =
    allMoves.filter(
      ({ move }) =>
        (
          move.fromTeamId != null &&
          move.fromTeamId ===
            affiliate.teamId
        ) ||
        (
          move.toTeamId != null &&
          move.toTeamId ===
            affiliate.teamId
        ) ||
        move.fromTeam ===
          affiliate.label ||
        move.toTeam ===
          affiliate.label
    );


  return (
    <div className="affiliate-page">
      <header className="farm-page-head">
        <div>
          <div className="farm-kicker">
            Farm System
          </div>

          <h1>
            Affiliates
          </h1>

          <p>
            Active-roster structure for {orgLabel}. Select a club to see
            why it is healthy or constrained, who can actually play today,
            and which organizational moves affect it.
          </p>
        </div>
      </header>


      <nav className="affiliate-selector">
        {data.health.affiliates.map(
          (item) => (
            <button
              key={
                item.teamId
              }
              className={
                item.teamId ===
                affiliate.teamId
                  ? 'active'
                  : ''
              }
              onClick={
                () =>
                  setSelectedTeamId(
                    item.teamId
                  )
              }
            >
              <span>
                {item.levelName}
              </span>

              <strong>
                {item.label}
              </strong>

              <small
                className={`farm-text-${item.overall}`}
              >
                {healthLabel(
                  item.overall
                )}
              </small>
            </button>
          )
        )}
      </nav>


      <section className="affiliate-hero">
        <div>
          <div className="farm-kicker">
            {affiliate.levelName}
          </div>

          <h2>
            {affiliate.label}
          </h2>
        </div>

        <span
          className={`farm-status farm-status-${affiliate.overall}`}
        >
          {healthLabel(
            affiliate.overall
          )}
        </span>
      </section>


      <div className="affiliate-metric-grid">
        <div>
          <span>
            Active roster
          </span>

          <strong>
            {affiliate.roster.total}
          </strong>
        </div>

        <div>
          <span>
            Position players
          </span>

          <strong
            className={`farm-text-${affiliate.positionPlayers.bodyCountStatus}`}
          >
            {affiliate.roster.positionPlayers}
          </strong>
        </div>

        <div>
          <span>
            Pitchers
          </span>

          <strong
            className={`farm-text-${affiliate.pitching.bodyCountStatus}`}
          >
            {affiliate.roster.pitchers}
          </strong>
        </div>

        <div>
          <span>
            Defense
          </span>

          <strong>
            {affiliate.positionPlayers.fieldablePositions}
            /8
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
            {' SP'}
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
            {' RP'}
          </strong>
        </div>
      </div>


      <section className="affiliate-analysis-grid">
        <article className="affiliate-analysis-card">
          <div className="farm-kicker">
            Diagnosis
          </div>

          <h3>
            Why this club is flagged
          </h3>

          {affiliate.issues.length ===
          0 ? (
            <p className="muted">
              No structural roster issue identified.
            </p>
          ) : (
            <ul className="farm-reason-list">
              {affiliate.issues.map(
                (
                  issue,
                  index
                ) => (
                  <li
                    key={
                      index
                    }
                  >
                    {issue}
                  </li>
                )
              )}
            </ul>
          )}
        </article>


        <article className="affiliate-analysis-card">
          <div className="farm-kicker">
            Pitching
          </div>

          <h3>
            Staff structure
          </h3>

          <div className="affiliate-pitch-grid">
            <div>
              <span>
                Rotation
              </span>

              <strong>
                {affiliate.pitching.starters}
                {' starters'}
              </strong>

              <small
                className={`farm-text-${affiliate.pitching.rotationStatus}`}
              >
                {healthLabel(
                  affiliate.pitching.rotationStatus
                )}
              </small>
            </div>

            <div>
              <span>
                Bullpen
              </span>

              <strong>
                {affiliate.pitching.relievers}
                {' relief roles'}
              </strong>

              <small
                className={`farm-text-${affiliate.pitching.bullpenStatus}`}
              >
                {healthLabel(
                  affiliate.pitching.bullpenStatus
                )}
              </small>
            </div>

            <div>
              <span>
                Closers
              </span>

              <strong>
                {affiliate.pitching.closers}
              </strong>
            </div>

            <div>
              <span>
                Day-to-day
              </span>

              <strong>
                {affiliate.roster.dayToDay}
              </strong>
            </div>
          </div>
        </article>
      </section>


      <section>
        <div className="farm-section-head">
          <div>
            <div className="farm-kicker">
              Defense
            </div>

            <h2>
              Position coverage
            </h2>
          </div>

          <p>
            Only revealed scouting grades count as established secondary
            coverage; a player’s listed position is always observable.
          </p>
        </div>

        <div className="affiliate-coverage-grid">
          {affiliate.positionPlayers.coverage.map(
            (coverage) => (
              <CoverageCard
                key={
                  coverage.position
                }
                coverage={
                  coverage
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
              Moves affecting this affiliate
            </h2>
          </div>
        </div>

        {moves.length ===
        0 ? (
          <div className="farm-empty">
            No current Operations recommendation moves a player into or out
            of this affiliate.
          </div>
        ) : (
          <div className="affiliate-move-list">
            {moves.map(
              (
                item,
                index
              ) => {
                const inbound =
                  item.move.toTeamId ===
                    affiliate.teamId ||
                  item.move.toTeam ===
                    affiliate.label;

                return (
                  <article
                    key={`${item.domain}-${item.move.playerId}-${index}`}
                  >
                    <div>
                      <div className="farm-decision-eyebrow">
                        {item.domain ===
                        'pitching'
                          ? 'Pitching operations'
                          : 'Minor league operations'}
                      </div>

                      <PlayerLink
                        id={
                          item.move.playerId
                        }
                      >
                        {item.move.playerName}
                      </PlayerLink>
                    </div>

                    <span
                      className={
                        inbound
                          ? 'affiliate-move-in'
                          : 'affiliate-move-out'
                      }
                    >
                      {inbound
                        ? 'ARRIVING'
                        : 'LEAVING'}
                    </span>

                    <div className="affiliate-move-route">
                      {item.move.fromTeam}
                      {' → '}
                      {item.move.toTeam}
                    </div>

                    <strong>
                      {moveLabel(
                        item.move
                      )}
                    </strong>
                  </article>
                );
              }
            )}
          </div>
        )}
      </section>


      <section>
        <div className="farm-section-head">
          <div>
            <div className="farm-kicker">
              Active roster
            </div>

            <h2>
              Available players
            </h2>
          </div>

          <p>
            This is team_roster list 2: players actually available to this
            affiliate, not the broader assigned roster.
          </p>
        </div>

        <div className="affiliate-roster-groups">
          <RosterTable
            title="Position Players"
            players={
              hitters
            }
          />

          <RosterTable
            title="Pitchers"
            players={
              pitchers
            }
          />
        </div>
      </section>
    </div>
  );
}
