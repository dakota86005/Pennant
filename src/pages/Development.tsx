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
  formatRating,
} from '../ratingScale';


export type PeerPace =
  | 'ahead'
  | 'typical'
  | 'behind'
  | 'insufficient';


type TrendStatus =
  | 'improving'
  | 'declining'
  | 'flat'
  | 'mixed'
  | 'insufficient';


export type DevelopmentView =
  | 'ahead'
  | 'behind'
  | 'changes'
  | 'all';


export interface DevelopmentViewItem {
  playerId:
    number;

  peerPace:
    PeerPace;

  compositeChange:
    number | null;
}


interface HistoryRow {
  game_date:
    string;

  player_id:
    number;

  name:
    string;

  team_id:
    number;

  org_id:
    number;

  level:
    number;

  position:
    number;

  age:
    number;

  cur:
    number | null;

  pot:
    number | null;

  con:
    number | null;

  gap:
    number | null;

  pow:
    number | null;

  eye:
    number | null;

  avk:
    number | null;

  spd:
    number | null;

  stu:
    number | null;

  mov:
    number | null;

  ctl:
    number | null;
}


interface HistoryResponse {
  snapshots:
    number;

  dates:
    string[];

  observationDays:
    number | null;

  rows:
    HistoryRow[];
}


/** One minor leaguer as `/api/scouted-development` serves him. */
interface RetentionPlayer {
  playerId:
    number;

  name:
    string;

  age:
    number;

  kind:
    | 'hitter'
    | 'pitcher';

  teamId:
    number;

  team:
    string;

  level:
    number;

  levelName:
    string;

  current:
    number | null;

  potential:
    number | null;

  role: {
    listedPosition:
      string;

    developmentalPitcherRole:
      | 'starter'
      | 'reliever'
      | null;
  };

  evidence: {
    developmentHistory: {
      status:
        TrendStatus;

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
        PeerPace;

      percentile:
        number | null;

      cohortSize:
        number;

      reasons:
        string[];

      cohort?: {
        kind:
          'hitter'
          | 'pitcher';

        ageBand:
          string;

        startingLevel:
          number;

        levelMatched:
          boolean;
      };
    };
  };
}


interface RetentionResponse {
  players:
    RetentionPlayer[];
}


interface RatingMovement {
  rating:
    string;

  from:
    number;

  to:
    number;

  delta:
    number;
}


interface ScoutedPlayer {
  player:
    RetentionPlayer;

  snapshots:
    HistoryRow[];

  first:
    HistoryRow | null;

  latest:
    HistoryRow | null;

  ratingMovement:
    RatingMovement[];

  compositeChange:
    number | null;
}


const LEVEL_NAMES:
  Record<number, string> = {
    1: 'MLB',
    2: 'AAA',
    3: 'AA',
    4: 'A',
    5: 'A',
    6: 'R',
  };


function rounded(
  value:
    number | null
): string {
  if (
    value == null ||
    !Number.isFinite(value)
  ) {
    return '—';
  }

  const one =
    Math.round(
      value * 10
    ) / 10;

  return Number.isInteger(one)
    ? String(one)
    : one.toFixed(1);
}


function signed(
  value:
    number | null
): string {
  if (
    value == null ||
    !Number.isFinite(value)
  ) {
    return '—';
  }

  const text =
    rounded(
      Math.abs(value)
    );

  if (value > 0) {
    return `+${text}`;
  }

  if (value < 0) {
    return `−${text}`;
  }

  return '0';
}


export function biggestDevelopmentChangeIds(
  items:
    readonly DevelopmentViewItem[],
  limit = 25
): number[] {
  return items
    .filter(
      (item) =>
        item.compositeChange != null &&
        Number.isFinite(
          item.compositeChange
        ) &&
        Math.abs(
          item.compositeChange
        ) > 0
    )
    .sort(
      (a, b) =>
        Math.abs(
          b.compositeChange ??
            0
        ) -
        Math.abs(
          a.compositeChange ??
            0
        )
    )
    .slice(
      0,
      Math.max(
        0,
        limit
      )
    )
    .map(
      (item) =>
        item.playerId
    );
}


export function initialDevelopmentView(
  items:
    readonly DevelopmentViewItem[]
): DevelopmentView {
  if (
    items.some(
      (item) =>
        item.peerPace ===
        'ahead'
    )
  ) {
    return 'ahead';
  }

  if (
    biggestDevelopmentChangeIds(
      items
    ).length > 0
  ) {
    return 'changes';
  }

  return 'all';
}


function ordinal(
  value:
    number
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


export function peerDevelopmentLabel(
  pace:
    PeerPace,
  percentileValue:
    number | null
): string {
  if (
    pace ===
      'insufficient' ||
    percentileValue == null
  ) {
    return 'Peer history building';
  }

  const percentile =
    ordinal(
      Math.round(
        percentileValue
      )
    );

  switch (
    pace
  ) {
    case 'ahead':
      return `Ahead · ${percentile}`;

    case 'behind':
      return `Behind · ${percentile}`;

    default:
      return `Typical · ${percentile}`;
  }
}


function peerLabel(
  player:
    RetentionPlayer
): string {
  const peer =
    player.evidence
      .peerDevelopment;

  return peerDevelopmentLabel(
    peer.pace,
    peer.percentile
  );
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


function movementFor(
  snapshots:
    HistoryRow[]
): RatingMovement[] {
  if (
    snapshots.length <
    2
  ) {
    return [];
  }

  const first =
    snapshots[0];

  const latest =
    snapshots[
      snapshots.length - 1
    ];

  const ratings:
    Array<[
      string,
      keyof HistoryRow
    ]> =
    first.position === 1
      ? [
          [
            'Stuff',
            'stu',
          ],
          [
            'Movement',
            'mov',
          ],
          [
            'Control',
            'ctl',
          ],
        ]
      : [
          [
            'Contact',
            'con',
          ],
          [
            'Gap',
            'gap',
          ],
          [
            'Power',
            'pow',
          ],
          [
            'Eye',
            'eye',
          ],
          [
            'Avoid K',
            'avk',
          ],
          [
            'Speed',
            'spd',
          ],
        ];

  const movements:
    RatingMovement[] = [];

  for (
    const [
      rating,
      key,
    ] of ratings
  ) {
    const from =
      first[key];

    const to =
      latest[key];

    if (
      typeof from !==
        'number' ||
      typeof to !==
        'number' ||
      from === to
    ) {
      continue;
    }

    movements.push({
      rating,
      from,
      to,
      delta:
        to - from,
    });
  }

  movements.sort(
    (a, b) =>
      Math.abs(
        b.delta
      ) -
      Math.abs(
        a.delta
      )
  );

  return movements;
}

function paceClass(
  pace:
    PeerPace
): string {
  switch (pace) {
    case 'ahead':
      return 'scouted-pace-ahead';

    case 'behind':
      return 'scouted-pace-behind';

    case 'typical':
      return 'scouted-pace-typical';

    default:
      return 'scouted-pace-insufficient';
  }
}


export function scoutedDevelopmentSummary(
  trendStatus:
    TrendStatus,
  currentDelta:
    number | null,
  peerPace:
    PeerPace
): string {
  if (
    trendStatus ===
    'insufficient'
  ) {
    return (
      'The organization does not yet have enough scouting history for a stable development trend.'
    );
  }

  if (
    peerPace ===
    'ahead'
  ) {
    return `Our observed current-skill composite has changed ${signed(
      currentDelta
    )} and is progressing faster than comparable players.`;
  }

  if (
    peerPace ===
    'behind'
  ) {
    return `Our observed current-skill composite has changed ${signed(
      currentDelta
    )} and is progressing more slowly than comparable players.`;
  }

  if (
    peerPace ===
    'insufficient'
  ) {
    return `Our observed current-skill composite has changed ${signed(
      currentDelta
    )}, but peer evidence is still insufficient and the comparison history is building.`;
  }

  return `Our observed current-skill composite has changed ${signed(
    currentDelta
  )} over the available scouting window and remains near the typical peer-development range.`;
}


export function Development({
  orgId,
}: {
  orgId:
    number;
}) {
  const [
    history,
    setHistory,
  ] =
    useState<HistoryResponse | null>(
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
    view,
    setView,
  ] =
    useState<DevelopmentView | null>(
      null
    );

  const [
    selectedPlayerId,
    setSelectedPlayerId,
  ] =
    useState<number | null>(
      null
    );

  const [
    level,
    setLevel,
  ] =
    useState<number | 'all'>(
      'all'
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

      setHistory(null);
      setRetention(null);
      setError(null);
      setView(null);
      setSelectedPlayerId(null);
      setLevel('all');

      Promise.all([
        apiGet<HistoryResponse>(
          `/api/development-history/${orgId}`
        ),

        apiGet<RetentionResponse>(
          `/api/scouted-development/${orgId}`
        ),
      ])
        .then(
          ([
            historyData,
            retentionData,
          ]) => {
            if (cancelled) {
              return;
            }

            setHistory(
              historyData
            );

            setRetention(
              retentionData
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
      ScoutedPlayer[]
    >(
      () => {
        if (
          !history ||
          !retention
        ) {
          return [];
        }

        const byPlayer =
          new Map<
            number,
            HistoryRow[]
          >();

        for (
          const row of
          history.rows
        ) {
          const current =
            byPlayer.get(
              row.player_id
            );

          if (current) {
            current.push(
              row
            );
          } else {
            byPlayer.set(
              row.player_id,
              [row]
            );
          }
        }

        return retention.players
          .map(
            (
              player
            ): ScoutedPlayer => {
              const snapshots =
                byPlayer.get(
                  player.playerId
                ) ?? [];

              return {
                player,

                snapshots,

                first:
                  snapshots[0] ??
                  null,

                latest:
                  snapshots[
                    snapshots.length -
                      1
                  ] ??
                  null,

                ratingMovement:
                  movementFor(
                    snapshots
                  ),

                compositeChange:
                  player.evidence
                    .developmentHistory
                    .currentDelta,
              };
            }
          )
          .filter(
            (item) =>
              item.snapshots
                .length > 0
          );
      },
      [
        history,
        retention,
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
    !history ||
    !retention
  ) {
    return (
      <p className="muted">
        Reading scouting history…
      </p>
    );
  }


  if (
    history.snapshots <
    2
  ) {
    return (
      <div className="hint">
        <h3>
          Scouting history is ready
        </h3>

        <p>
          {history.snapshots ===
          0
            ? 'No ratings snapshot has been captured for this organization yet.'
            : 'One ratings snapshot has been captured.'}
          {' '}
          Import another later point in the save to begin comparing how the
          organization’s scouting view changes.
        </p>
      </div>
    );
  }


  const ahead =
    players.filter(
      (item) =>
        item.player
          .evidence
          .peerDevelopment
          .pace ===
        'ahead'
    );

  const behind =
    players.filter(
      (item) =>
        item.player
          .evidence
          .peerDevelopment
          .pace ===
        'behind'
    );

  /*
   * "Biggest changes" is a scouting watchlist, not another broad filter.
   * Keep it to the 25 largest absolute observed composite movements.
   */
  const viewItems:
    DevelopmentViewItem[] =
      players.map(
        (item) => ({
          playerId:
            item.player
              .playerId,

          peerPace:
            item.player
              .evidence
              .peerDevelopment
              .pace,

          compositeChange:
            item.compositeChange,
        })
      );

  const biggestChangeIds =
    new Set(
      biggestDevelopmentChangeIds(
        viewItems
      )
    );

  const activeView =
    view ??
    initialDevelopmentView(
      viewItems
    );


  const filtered =
    players
      .filter(
        (item) => {
          if (
            level !==
              'all' &&
            item.player
              .level !==
              level
          ) {
            return false;
          }

          switch (activeView) {
            case 'ahead':
              return (
                item.player
                  .evidence
                  .peerDevelopment
                  .pace ===
                'ahead'
              );

            case 'behind':
              return (
                item.player
                  .evidence
                  .peerDevelopment
                  .pace ===
                'behind'
              );

            case 'changes':
              return (
                biggestChangeIds.has(
                  item.player
                    .playerId
                )
              );

            default:
              return true;
          }
        }
      )
      .sort(
        (a, b) => {
          if (
            activeView ===
            'changes'
          ) {
            return (
              Math.abs(
                b.compositeChange ??
                  0
              ) -
              Math.abs(
                a.compositeChange ??
                  0
              )
            );
          }

          const aPct =
            a.player
              .evidence
              .peerDevelopment
              .percentile ??
            50;

          const bPct =
            b.player
              .evidence
              .peerDevelopment
              .percentile ??
            50;

          return activeView ===
            'behind'
            ? aPct - bPct
            : bPct - aPct;
        }
      );


  const selected =
    filtered.find(
      (item) =>
        item.player
          .playerId ===
        selectedPlayerId
    ) ??
    filtered[0] ??
    null;


  const levels =
    [
      ...new Set(
        players.map(
          (item) =>
            item.player
              .level
        )
      ),
    ].sort(
      (a, b) =>
        a - b
    );


  return (
    <div className="scouted-page">
      <header className="farm-page-head">
        <div>
          <div className="farm-kicker">
            Farm System
          </div>

          <h1>
            Scouted Development
          </h1>

          <p>
            A history of what this organization has observed. Ratings movement
            here reflects our scouting information over time, not hidden OOTP
            true talent.
          </p>
        </div>
      </header>


      <div className="scouted-metrics">
        <div>
          <span>
            Scouting snapshots
          </span>

          <strong>
            {history.snapshots}
          </strong>

          <small>
            {history.dates[0]}
            {' → '}
            {
              history.dates[
                history.dates
                  .length - 1
              ]
            }
          </small>
        </div>

        <div>
          <span>
            Observation window
          </span>

          <strong>
            {history.observationDays ??
              '—'}
          </strong>

          <small>
            in-game days of persistent scouting history
          </small>
        </div>

        <div>
          <span>
            Ahead of peers
          </span>

          <strong>
            {ahead.length}
          </strong>

          <small>
            observed development at or above the 80th percentile
          </small>
        </div>

        <div>
          <span>
            Behind peers
          </span>

          <strong>
            {behind.length}
          </strong>

          <small>
            observed development at or below the 20th percentile
          </small>
        </div>
      </div>


      <details className="scouted-guide">
        <summary>
          How to read this page
        </summary>

        <p>
          The current-skill composite is built from the scouting grades captured
          at each export. Peer pace compares the change in that observed composite
          with similar minor leaguers by player type, age band, and when possible,
          starting level. A scouting change may reflect real development, a revised
          evaluation, or both. Trend labels require at least three snapshots across
          75 in-game days, and peer pace also requires at least 20 comparable
          observations; until then, peer history is explicitly shown as building.
        </p>
      </details>


      <section>
        <div className="farm-section-head">
          <div>
            <div className="farm-kicker">
              Scouting history
            </div>

            <h2>
              Development watch
            </h2>
          </div>

          <p>
            Open a player to see how our observed ratings changed across the
            available snapshots.
          </p>
        </div>


        <div className="scouted-toolbar">
          <div className="scouted-tabs">
            <button
              className={
                activeView ===
                'ahead'
                  ? 'active'
                  : ''
              }
              onClick={
                () => {
                  setView(
                    'ahead'
                  );

                  setSelectedPlayerId(
                    null
                  );
                }
              }
            >
              Ahead
              <span>
                {ahead.length}
              </span>
            </button>

            <button
              className={
                activeView ===
                'behind'
                  ? 'active'
                  : ''
              }
              onClick={
                () => {
                  setView(
                    'behind'
                  );

                  setSelectedPlayerId(
                    null
                  );
                }
              }
            >
              Behind
              <span>
                {behind.length}
              </span>
            </button>

            <button
              className={
                activeView ===
                'changes'
                  ? 'active'
                  : ''
              }
              onClick={
                () => {
                  setView(
                    'changes'
                  );

                  setSelectedPlayerId(
                    null
                  );
                }
              }
            >
              Biggest changes
              <span>
                {biggestChangeIds.size}
              </span>
            </button>

            <button
              className={
                activeView ===
                'all'
                  ? 'active'
                  : ''
              }
              onClick={
                () => {
                  setView(
                    'all'
                  );

                  setSelectedPlayerId(
                    null
                  );
                }
              }
            >
              All
              <span>
                {players.length}
              </span>
            </button>
          </div>


          <div className="scouted-tabs scouted-level-tabs">
            <button
              className={
                level ===
                'all'
                  ? 'active'
                  : ''
              }
              onClick={
                () => {
                  setLevel(
                    'all'
                  );

                  setSelectedPlayerId(
                    null
                  );
                }
              }
            >
              All levels
            </button>

            {levels.map(
              (
                currentLevel
              ) => (
                <button
                  key={
                    currentLevel
                  }
                  className={
                    level ===
                    currentLevel
                      ? 'active'
                      : ''
                  }
                  onClick={
                    () => {
                      setLevel(
                        currentLevel
                      );

                      setSelectedPlayerId(
                        null
                      );
                    }
                  }
                >
                  {LEVEL_NAMES[
                    currentLevel
                  ] ??
                    `L${currentLevel}`}
                </button>
              )
            )}
          </div>
        </div>


        {filtered.length ===
        0 ? (
          <div className="farm-empty">
            No players match this scouting-history view.
          </div>
        ) : (
          <div className="scouted-workspace">
            <aside className="scouted-list">
              <div className="scouted-list-head">
                <strong>
                  {activeView ===
                  'ahead'
                    ? 'Ahead of peers'
                    : activeView ===
                        'behind'
                      ? 'Behind peers'
                      : activeView ===
                          'changes'
                        ? 'Largest changes'
                        : 'Tracked players'}
                </strong>

                <span>
                  {filtered.length}
                </span>
              </div>

              <div className="scouted-list-items">
                {filtered.map(
                  (item) => {
                    const peer =
                      item.player
                        .evidence
                        .peerDevelopment;

                    return (
                      <button
                        type="button"
                        key={
                          item.player
                            .playerId
                        }
                        className={
                          selected
                            ?.player
                            .playerId ===
                          item.player
                            .playerId
                            ? 'scouted-list-item active'
                            : 'scouted-list-item'
                        }
                        onClick={
                          () =>
                            setSelectedPlayerId(
                              item.player
                                .playerId
                            )
                        }
                      >
                        <div className="scouted-list-name">
                          {item.player
                            .name}
                        </div>

                        <div className="scouted-list-meta">
                          {item.player
                            .age}
                          {' · '}
                          {item.player
                            .levelName}
                          {' · '}
                          {item.player
                            .team}
                        </div>

                        <div className="scouted-list-bottom">
                          <span
                            className={
                              paceClass(
                                peer.pace
                              )
                            }
                          >
                            {peerLabel(
                              item.player
                            )}
                          </span>

                          <span>
                            observed{' '}
                            {signed(
                              item.compositeChange
                            )}
                          </span>
                        </div>
                      </button>
                    );
                  }
                )}
              </div>
            </aside>


            {selected && (
              <article className="scouted-detail">
                <header className="scouted-detail-head">
                  <div>
                    <div className="farm-decision-eyebrow">
                      Scouting history
                    </div>

                    <h3>
                      <PlayerLink
                        id={
                          selected
                            .player
                            .playerId
                        }
                      >
                        {selected
                          .player
                          .name}
                      </PlayerLink>
                    </h3>

                    <p>
                      {selected
                        .player
                        .age}
                      {' · '}
                      {roleLabel(
                        selected.player
                      )}
                      {' · '}
                      {selected
                        .player
                        .levelName}
                      {' · '}
                      {selected
                        .player
                        .team}
                    </p>
                  </div>

                  <span
                    className={`scouted-pace-badge ${paceClass(
                      selected
                        .player
                        .evidence
                        .peerDevelopment
                        .pace
                    )}`}
                  >
                    {peerLabel(
                      selected.player
                    )}
                  </span>
                </header>


                <div className="scouted-summary-grid">
                  <div>
                    <span>
                      First observed composite
                    </span>

                    <strong>
                      {formatRating(
                        selected.first
                          ?.cur ??
                          null
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Latest observed composite
                    </span>

                    <strong>
                      {formatRating(
                        selected.latest
                          ?.cur ??
                          null
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Observed change
                    </span>

                    <strong
                      className={
                        (
                          selected.compositeChange ??
                          0
                        ) > 0
                          ? 'good-text'
                          : (
                                selected.compositeChange ??
                                0
                              ) <
                              0
                            ? 'bad-text'
                            : ''
                      }
                    >
                      {signed(
                        selected.compositeChange
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Projected ceiling change
                    </span>

                    <strong>
                      {signed(
                        selected
                          .player
                          .evidence
                          .developmentHistory
                          .potentialDelta
                      )}
                    </strong>
                  </div>
                </div>


                <div className="scouted-read">
                  <strong>
                    What our scouting history says
                  </strong>

                  <p>
                    {scoutedDevelopmentSummary(
                      selected.player
                        .evidence
                        .developmentHistory
                        .status,
                      selected
                        .compositeChange,
                      selected.player
                        .evidence
                        .peerDevelopment
                        .pace
                    )}
                  </p>
                </div>


                <div className="scouted-subhead">
                  Snapshot history
                </div>

                <div className="scouted-timeline">
                  {selected.snapshots.map(
                    (
                      snapshot,
                      index
                    ) => (
                      <div
                        key={
                          snapshot.game_date
                        }
                        className="scouted-snapshot"
                      >
                        <div className="scouted-snapshot-date">
                          {snapshot.game_date}
                        </div>

                        <div className="scouted-snapshot-level">
                          {LEVEL_NAMES[
                            snapshot.level
                          ] ??
                            `L${snapshot.level}`}
                        </div>

                        <div>
                          <span>
                            Current
                          </span>

                          <strong>
                            {formatRating(
                              snapshot.cur
                            )}
                          </strong>
                        </div>

                        <div>
                          <span>
                            Ceiling
                          </span>

                          <strong>
                            {formatRating(
                              snapshot.pot
                            )}
                          </strong>
                        </div>

                        {index <
                          selected
                            .snapshots
                            .length -
                            1 && (
                          <span className="scouted-timeline-arrow">
                            →
                          </span>
                        )}
                      </div>
                    )
                  )}
                </div>


                <div className="scouted-detail-columns">
                  <div>
                    <div className="scouted-subhead">
                      Rating movement
                    </div>

                    {selected
                      .ratingMovement
                      .length ===
                    0 ? (
                      <p className="muted">
                        No individual revealed scouting grade changed across
                        this observation window.
                      </p>
                    ) : (
                      <div className="scouted-rating-list">
                        {selected
                          .ratingMovement
                          .map(
                            (
                              movement
                            ) => (
                              <div
                                key={
                                  movement.rating
                                }
                              >
                                <strong>
                                  {movement.rating}
                                </strong>

                                <span>
                                  {movement.from}
                                  {' → '}
                                  {movement.to}
                                </span>

                                <span
                                  className={
                                    movement.delta >
                                    0
                                      ? 'good-text'
                                      : 'bad-text'
                                  }
                                >
                                  {signed(
                                    movement.delta
                                  )}
                                </span>
                              </div>
                            )
                          )}
                      </div>
                    )}
                  </div>


                  <div>
                    <div className="scouted-subhead">
                      Peer comparison
                    </div>

                    <ul className="farm-reason-list">
                      {selected
                        .player
                        .evidence
                        .peerDevelopment
                        .reasons
                        .map(
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
                </div>


                <div className="scouted-fog-note">
                  <strong>
                    Scouting context
                  </strong>

                  <span>
                    These snapshots preserve what the organization could observe
                    at the time. Movement can represent player development,
                    scouting revision, or both; Front Office does not substitute
                    hidden true-talent ratings.
                  </span>
                </div>
              </article>
            )}
          </div>
        )}
      </section>


      <section>
        <div className="farm-section-head">
          <div>
            <div className="farm-kicker">
              Organization
            </div>

            <h2>
              Tracked development
            </h2>
          </div>

          <p>
            The broader scouting-history index. Player Development remains the
            place for assignment decisions.
          </p>
        </div>

        <div className="scouted-table-wrap">
          <table className="scouted-table">
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
                  Current composite
                </th>

                <th>
                  Observed change
                </th>

                <th>
                  Peer pace
                </th>

                <th>
                  History
                </th>
              </tr>
            </thead>

            <tbody>
              {players
                .slice()
                .sort(
                  (a, b) =>
                    (
                      b.player
                        .evidence
                        .peerDevelopment
                        .percentile ??
                      50
                    ) -
                    (
                      a.player
                        .evidence
                        .peerDevelopment
                        .percentile ??
                      50
                    )
                )
                .map(
                  (item) => (
                    <tr
                      key={
                        item.player
                          .playerId
                      }
                      onClick={
                        () => {
                          setView(
                            'all'
                          );

                          setLevel(
                            'all'
                          );

                          setSelectedPlayerId(
                            item.player
                              .playerId
                          );
                        }
                      }
                    >
                      <td>
                        <PlayerLink
                          id={
                            item.player
                              .playerId
                          }
                        >
                          {item.player
                            .name}
                        </PlayerLink>
                      </td>

                      <td>
                        {item.player
                          .age}
                      </td>

                      <td>
                        <span className="level-tag">
                          {item.player
                            .levelName}
                        </span>
                        {' '}
                        {item.player
                          .team}
                      </td>

                      <td>
                        {roleLabel(
                          item.player
                        )}
                      </td>

                      <td>
                        {formatRating(
                          item.latest
                            ?.cur ??
                            null
                        )}
                      </td>

                      <td
                        className={
                          (
                            item.compositeChange ??
                            0
                          ) > 0
                            ? 'good-text'
                            : (
                                  item.compositeChange ??
                                  0
                                ) <
                                0
                              ? 'bad-text'
                              : ''
                        }
                      >
                        {signed(
                          item.compositeChange
                        )}
                      </td>

                      <td
                        className={
                          paceClass(
                            item.player
                              .evidence
                              .peerDevelopment
                              .pace
                          )
                        }
                      >
                        {peerLabel(
                          item.player
                        )}
                      </td>

                      <td>
                        {item.snapshots
                          .length}
                        {' snapshots'}
                      </td>
                    </tr>
                  )
                )}
            </tbody>
          </table>
        </div>
      </section>


      <footer className="farm-model-note">
        <strong>
          Scouted Development:
        </strong>
        {' '}
        persistent scouting observations describe how our information changed.
        Peer pace compares that observed change with comparable minor leaguers.
        Neither is hidden true talent.
      </footer>
    </div>
  );
}
