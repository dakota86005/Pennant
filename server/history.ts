import Database from 'better-sqlite3';
import { Router } from 'express';
import path from 'node:path';
import { db as leagueDb, tableExists } from './db.js';
import { DATA_DIR, loadConfig } from './config.js';

/**
 * Persistent store that SURVIVES reimports (league.db is rebuilt on every
 * import). Holds rating snapshots for development tracking and the watchlist.
 */
export const historyDb = new Database(path.join(DATA_DIR, 'history.db'));
historyDb.pragma('journal_mode = WAL');
historyDb.exec(`
  CREATE TABLE IF NOT EXISTS rating_snapshots (
    save_name TEXT NOT NULL,
    game_date TEXT NOT NULL,
    player_id INTEGER NOT NULL,
    name TEXT,
    team_id INTEGER,
    org_id INTEGER,
    level INTEGER,
    position INTEGER,
    age INTEGER,
    con REAL, gap REAL, pow REAL, eye REAL, avk REAL, spd REAL,
    conP REAL, gapP REAL, powP REAL, eyeP REAL, avkP REAL,
    stu REAL, mov REAL, ctl REAL,
    stuP REAL, movP REAL, ctlP REAL,
    cur REAL, pot REAL,
    PRIMARY KEY (save_name, game_date, player_id)
  );
  CREATE INDEX IF NOT EXISTS idx_snap_player ON rating_snapshots (save_name, player_id, game_date);
  CREATE TABLE IF NOT EXISTS watchlist (
    save_name TEXT NOT NULL,
    player_id INTEGER NOT NULL,
    name TEXT,
    note TEXT DEFAULT '',
    added_at TEXT,
    updated_at TEXT,
    PRIMARY KEY (save_name, player_id)
  );
  /*
   * Notes kept on a player, one row each rather than one field overwritten.
   *
   * The watchlist already had a note, but it holds a single string tied to
   * watching the man — no good for the thing this is actually for, which is
   * keeping what a member of staff told you. A pitch-count plan for a starter
   * coming off the injured list is worth nothing in a chat thread you will
   * have scrolled past by the time he is throwing again; it belongs on his
   * page, with who said it and the date of the game when they did.
   *
   * Lives in history.db so it survives re-importing the save, which wipes and
   * rebuilds the league database entirely.
   */
  CREATE TABLE IF NOT EXISTS player_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    save_name TEXT NOT NULL,
    player_id INTEGER NOT NULL,
    player_name TEXT,
    source TEXT,
    body TEXT NOT NULL,
    game_date TEXT,
    created_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_notes_player ON player_notes (save_name, player_id);
`);

export function currentSaveName(): string {
  return loadConfig().saveName ?? 'unknown';
}

function leagueGameDate(): string | null {
  try {
    const row = leagueDb
      .prepare(
        `SELECT "current_date" AS d FROM leagues WHERE league_id IN
         (SELECT DISTINCT league_id FROM teams WHERE level = 1) LIMIT 1`
      )
      .get() as { d: string } | undefined;
    return row?.d ?? null;
  } catch {
    return null;
  }
}

/** Capture a ratings snapshot of every rostered player. Idempotent per game date. */
export function takeSnapshot(): { gameDate: string; players: number } | null {
  if (!tableExists('players') || !tableExists('players_batting')) return null;
  const gameDate = leagueGameDate();
  if (!gameDate) return null;
  const saveName = currentSaveName();

  const rows = leagueDb
    .prepare(
      `SELECT p.player_id, p.first_name || ' ' || p.last_name AS name, p.team_id,
              p.organization_id AS org_id, t.level, p.position, p.age,
              b.batting_ratings_overall_contact AS con, b.batting_ratings_overall_gap AS gap,
              b.batting_ratings_overall_power AS pow, b.batting_ratings_overall_eye AS eye,
              b.batting_ratings_overall_strikeouts AS avk, b.running_ratings_speed AS spd,
              b.batting_ratings_talent_contact AS conP, b.batting_ratings_talent_gap AS gapP,
              b.batting_ratings_talent_power AS powP, b.batting_ratings_talent_eye AS eyeP,
              b.batting_ratings_talent_strikeouts AS avkP,
              pi.pitching_ratings_overall_stuff AS stu, pi.pitching_ratings_overall_movement AS mov,
              pi.pitching_ratings_overall_control AS ctl,
              pi.pitching_ratings_talent_stuff AS stuP, pi.pitching_ratings_talent_movement AS movP,
              pi.pitching_ratings_talent_control AS ctlP
       FROM players p
       JOIN teams t ON t.team_id = p.team_id
       LEFT JOIN players_batting b ON b.player_id = p.player_id
       LEFT JOIN players_pitching pi ON pi.player_id = p.player_id
       WHERE p.retired = 0 AND p.team_id > 0`
    )
    .all() as Array<Record<string, number | string | null>>;

  const insert = historyDb.prepare(
    `INSERT OR REPLACE INTO rating_snapshots
     (save_name, game_date, player_id, name, team_id, org_id, level, position, age,
      con, gap, pow, eye, avk, spd, conP, gapP, powP, eyeP, avkP,
      stu, mov, ctl, stuP, movP, ctlP, cur, pot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const avg = (vals: Array<number | string | null>): number | null => {
    const nums = vals.filter((v): v is number => typeof v === 'number');
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  };
  const insertAll = historyDb.transaction(() => {
    for (const r of rows) {
      const isPitcher = r.position === 1;
      const cur = isPitcher ? avg([r.stu, r.mov, r.ctl]) : avg([r.con, r.gap, r.pow, r.eye, r.avk]);
      const pot = isPitcher
        ? avg([r.stuP, r.movP, r.ctlP])
        : avg([r.conP, r.gapP, r.powP, r.eyeP, r.avkP]);
      insert.run(
        saveName, gameDate, r.player_id, r.name, r.team_id, r.org_id, r.level, r.position, r.age,
        r.con, r.gap, r.pow, r.eye, r.avk, r.spd, r.conP, r.gapP, r.powP, r.eyeP, r.avkP,
        r.stu, r.mov, r.ctl, r.stuP, r.movP, r.ctlP, cur, pot
      );
    }
  });
  insertAll();
  console.log(`[history] snapshot ${gameDate}: ${rows.length} players`);
  return { gameDate, players: rows.length };
}

function gameDateEpoch(value: string): number {
  const match =
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(
      value
    );

  if (!match) return Number.NaN;

  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
}

function compareGameDates(
  a: string,
  b: string
): number {
  const aTime =
    gameDateEpoch(a);

  const bTime =
    gameDateEpoch(b);

  if (
    Number.isFinite(aTime) &&
    Number.isFinite(bTime)
  ) {
    return aTime - bTime;
  }

  return a.localeCompare(b);
}

export function snapshotDates(): string[] {
  return (
    historyDb
      .prepare(
        `SELECT DISTINCT game_date
         FROM rating_snapshots
         WHERE save_name = ?`
      )
      .all(
        currentSaveName()
      ) as Array<{
        game_date: string;
      }>
  )
    .map(
      (row) =>
        row.game_date
    )
    .sort(
      compareGameDates
    );
}


export type DevelopmentTrendStatus =
  | 'insufficient'
  | 'improving'
  | 'flat'
  | 'declining'
  | 'mixed';

export interface PlayerDevelopmentTrend {
  status:
    DevelopmentTrendStatus;

  snapshotCount: number;

  firstDate:
    string | null;

  latestDate:
    string | null;

  observationDays:
    number | null;

  /*
   * These are changes in the history database's scouting composites:
   *
   * hitters:
   * contact / gap / power / eye / avoid-K
   *
   * pitchers:
   * stuff / movement / control
   *
   * They are deliberately NOT the player's displayed OVR grade.
   */
  currentDelta:
    number | null;

  potentialDelta:
    number | null;

  reasons:
    string[];
}

interface DevelopmentTrendRow {
  player_id: number;
  game_date: string;

  cur:
    number | null;

  pot:
    number | null;
}

const MIN_TREND_SNAPSHOTS = 3;
const MIN_TREND_DAYS = 75;

function numericDelta(
  latest: number | null,
  first: number | null
): number | null {
  if (
    typeof latest !== 'number' ||
    !Number.isFinite(latest) ||
    typeof first !== 'number' ||
    !Number.isFinite(first)
  ) {
    return null;
  }

  return (
    Math.round(
      (latest - first) * 10
    ) / 10
  );
}

/**
 * Persistent observed scouting development, keyed by player.
 *
 * The Development page already stores one rating snapshot on each import.
 * This exposes the same history to baseball-decision engines without making
 * those engines independently reinterpret history.db.
 *
 * Classification is intentionally conservative. A couple of closely spaced
 * imports do not constitute evidence that development has stopped.
 */
function developmentTrendByPlayerForScope(
  orgId: number | null
):
  Map<number, PlayerDevelopmentTrend> {
  const rows =
    (
      orgId === null
        ? historyDb
            .prepare(
              `SELECT
                 player_id,
                 game_date,
                 cur,
                 pot
               FROM rating_snapshots
               WHERE save_name = ?`
            )
            .all(
              currentSaveName()
            )
        : historyDb
            .prepare(
              `SELECT
                 player_id,
                 game_date,
                 cur,
                 pot
               FROM rating_snapshots
               WHERE save_name = ?
                 AND org_id = ?`
            )
            .all(
              currentSaveName(),
              orgId
            )
    ) as DevelopmentTrendRow[];

  const byPlayer =
    new Map<
      number,
      DevelopmentTrendRow[]
    >();

  for (const row of rows) {
    const existing =
      byPlayer.get(
        row.player_id
      );

    if (existing) {
      existing.push(row);
    } else {
      byPlayer.set(
        row.player_id,
        [row]
      );
    }
  }

  const out =
    new Map<
      number,
      PlayerDevelopmentTrend
    >();

  for (
    const [
      playerId,
      snapshots,
    ] of byPlayer
  ) {
    snapshots.sort(
      (a, b) =>
        compareGameDates(
          a.game_date,
          b.game_date
        )
    );

    const first =
      snapshots[0];

    const latest =
      snapshots[
        snapshots.length - 1
      ];

    const firstTime =
      gameDateEpoch(
        first.game_date
      );

    const latestTime =
      gameDateEpoch(
        latest.game_date
      );

    const observationDays =
      Number.isFinite(
        firstTime
      ) &&
      Number.isFinite(
        latestTime
      )
        ? Math.round(
            (
              latestTime -
              firstTime
            ) /
              86_400_000
          )
        : null;

    const currentDelta =
      numericDelta(
        latest.cur,
        first.cur
      );

    const potentialDelta =
      numericDelta(
        latest.pot,
        first.pot
      );

    let status:
      DevelopmentTrendStatus;

    const reasons:
      string[] = [];

    if (
      snapshots.length <
        MIN_TREND_SNAPSHOTS ||
      observationDays === null ||
      observationDays <
        MIN_TREND_DAYS ||
      currentDelta === null
    ) {
      status =
        'insufficient';

      reasons.push(
        `Only ${snapshots.length} usable snapshot${snapshots.length === 1 ? '' : 's'} across ${
          observationDays === null
            ? 'an unknown observation window'
            : `${observationDays} in-game days`
        }; trend classification requires at least ${MIN_TREND_SNAPSHOTS} snapshots across ${MIN_TREND_DAYS} days.`
      );
    } else if (
      currentDelta >= 2
    ) {
      status =
        'improving';

      reasons.push(
        `Current-skill scouting composite improved by ${currentDelta.toFixed(1)} across ${snapshots.length} snapshots and ${observationDays} in-game days.`
      );
    } else if (
      currentDelta <= -2
    ) {
      status =
        'declining';

      reasons.push(
        `Current-skill scouting composite declined by ${Math.abs(currentDelta).toFixed(1)} across ${snapshots.length} snapshots and ${observationDays} in-game days.`
      );
    } else if (
      Math.abs(
        currentDelta
      ) <= 1
    ) {
      status =
        'flat';

      reasons.push(
        `Current-skill scouting composite changed only ${currentDelta >= 0 ? '+' : ''}${currentDelta.toFixed(1)} across ${snapshots.length} snapshots and ${observationDays} in-game days.`
      );
    } else {
      status =
        'mixed';

      reasons.push(
        `Current-skill scouting composite changed ${currentDelta >= 0 ? '+' : ''}${currentDelta.toFixed(1)} across ${snapshots.length} snapshots and ${observationDays} in-game days; movement is not strong enough for a directional classification.`
      );
    }

    if (
      potentialDelta !== null &&
      Math.abs(
        potentialDelta
      ) >= 1
    ) {
      reasons.push(
        `Scouted projected ceiling changed ${potentialDelta >= 0 ? '+' : ''}${potentialDelta.toFixed(1)} over the same observation window.`
      );
    }

    out.set(
      playerId,
      {
        status,

        snapshotCount:
          snapshots.length,

        firstDate:
          first.game_date,

        latestDate:
          latest.game_date,

        observationDays,

        currentDelta,

        potentialDelta,

        reasons,
      }
    );
  }

  return out;
}


/** Save-wide history for consumers that intentionally follow a player across organizations. */
export function developmentTrendByPlayer():
  Map<number, PlayerDevelopmentTrend> {
  return developmentTrendByPlayerForScope(
    null
  );
}


/** History observed while each player belonged to one organization. */
export function developmentTrendByPlayerForOrg(
  orgId: number
): Map<number, PlayerDevelopmentTrend> {
  return developmentTrendByPlayerForScope(
    orgId
  );
}



/**
 * How the organization's observed development of a player compares with
 * similarly situated minor leaguers.
 *
 * This is deliberately scouting-relative evidence, not omniscient player
 * truth. The ratings are the observations persisted by the Development
 * history system on each import.
 */
export type PeerDevelopmentPace =
  | 'insufficient'
  | 'behind'
  | 'typical'
  | 'ahead';

export interface PeerDevelopmentTrend {
  pace: PeerDevelopmentPace;

  percentile: number | null;

  /*
   * Current-skill composite change normalized to 100 in-game days.
   * Normalizing matters once players have different observation windows.
   */
  ratePer100Days: number | null;

  cohortMedianRate: number | null;

  peerAdjustedRate: number | null;

  cohortSize: number;

  cohort: {
    kind: 'hitter' | 'pitcher';
    ageBand: string;
    startingLevel: number | null;
    levelMatched: boolean;
  } | null;

  reasons: string[];
}

interface PeerSnapshotRow {
  player_id: number;
  game_date: string;
  age: number | null;
  level: number | null;
  position: number | null;
  cur: number | null;
}

interface PeerObservation {
  playerId: number;

  kind:
    | 'hitter'
    | 'pitcher';

  ageBand: string;

  startingLevel:
    number | null;

  snapshotCount: number;

  observationDays: number;

  currentDelta: number;

  ratePer100Days: number;
}

function developmentAgeBand(
  age: number
): string {
  if (age <= 19) return '<=19';
  if (age <= 22) return '20-22';
  if (age <= 25) return '23-25';
  if (age <= 29) return '26-29';
  return '30+';
}

function medianNumber(
  values: number[]
): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b
    );

  const mid =
    Math.floor(
      sorted.length / 2
    );

  if (
    sorted.length % 2 === 1
  ) {
    return sorted[mid];
  }

  return (
    sorted[mid - 1] +
    sorted[mid]
  ) / 2;
}

/**
 * Mid-rank percentile.
 *
 * Rating changes are discrete — especially pitcher composites, where one
 * tool moving five points changes the three-rating average by about 1.67.
 * Mid-rank avoids pretending all tied observations have different ranks.
 */
function percentileNumber(
  values: number[],
  value: number
): number | null {
  if (values.length === 0) {
    return null;
  }

  let below = 0;
  let equal = 0;

  for (const candidate of values) {
    if (candidate < value) {
      below += 1;
    } else if (
      candidate === value
    ) {
      equal += 1;
    }
  }

  return (
    (
      below +
      equal * 0.5
    ) /
    values.length
  ) * 100;
}

function peerKey(
  kind: 'hitter' | 'pitcher',
  ageBand: string,
  level?: number | null
): string {
  return level == null
    ? `${kind}|${ageBand}`
    : `${kind}|${ageBand}|${level}`;
}

/**
 * Peer-adjusted scouting development.
 *
 * Primary cohort:
 *   player type + age band + STARTING level
 *
 * Starting level is used because the change being measured began there. A
 * player who earned a promotion should not have his whole development window
 * judged against players who began at the more advanced destination.
 *
 * When that cohort is too small, type + age band is used as the fallback.
 */
function peerDevelopmentTrendByPlayerForScope(
  orgId: number | null
):
  Map<number, PeerDevelopmentTrend> {
  const rows =
    (
      orgId === null
        ? historyDb
            .prepare(
              `SELECT
                 player_id,
                 game_date,
                 age,
                 level,
                 position,
                 cur
               FROM rating_snapshots
               WHERE save_name = ?`
            )
            .all(
              currentSaveName()
            )
        : historyDb
            .prepare(
              `SELECT
                 player_id,
                 game_date,
                 age,
                 level,
                 position,
                 cur
               FROM rating_snapshots
               WHERE save_name = ?
                 AND org_id = ?`
            )
            .all(
              currentSaveName(),
              orgId
            )
    ) as PeerSnapshotRow[];

  const byPlayer =
    new Map<
      number,
      PeerSnapshotRow[]
    >();

  for (const row of rows) {
    const group =
      byPlayer.get(
        row.player_id
      );

    if (group) {
      group.push(row);
    } else {
      byPlayer.set(
        row.player_id,
        [row]
      );
    }
  }

  const observations:
    PeerObservation[] = [];

  for (
    const [
      playerId,
      snapshots,
    ] of byPlayer
  ) {
    snapshots.sort(
      (a, b) =>
        compareGameDates(
          a.game_date,
          b.game_date
        )
    );

    if (
      snapshots.length <
      MIN_TREND_SNAPSHOTS
    ) {
      continue;
    }

    const first =
      snapshots[0];

    const latest =
      snapshots[
        snapshots.length - 1
      ];

    if (
      typeof first.cur !==
        'number' ||
      typeof latest.cur !==
        'number' ||
      typeof first.age !==
        'number' ||
      typeof first.position !==
        'number'
    ) {
      continue;
    }

    const firstTime =
      gameDateEpoch(
        first.game_date
      );

    const latestTime =
      gameDateEpoch(
        latest.game_date
      );

    if (
      !Number.isFinite(
        firstTime
      ) ||
      !Number.isFinite(
        latestTime
      )
    ) {
      continue;
    }

    const observationDays =
      Math.round(
        (
          latestTime -
          firstTime
        ) /
        86_400_000
      );

    if (
      observationDays <
      MIN_TREND_DAYS
    ) {
      continue;
    }

    /*
     * Only players who began this observation window in the minor leagues
     * belong in the minor-league development baseline.
     */
    if (
      typeof first.level !==
        'number' ||
      first.level <= 1
    ) {
      continue;
    }

    const currentDelta =
      latest.cur -
      first.cur;

    const ratePer100Days =
      currentDelta *
      100 /
      observationDays;

    observations.push({
      playerId,

      kind:
        first.position === 1
          ? 'pitcher'
          : 'hitter',

      ageBand:
        developmentAgeBand(
          first.age
        ),

      startingLevel:
        first.level,

      snapshotCount:
        snapshots.length,

      observationDays,

      currentDelta,

      ratePer100Days,
    });
  }

  const detailed =
    new Map<
      string,
      number[]
    >();

  const broad =
    new Map<
      string,
      number[]
    >();

  for (
    const observation of
    observations
  ) {
    const detailedKey =
      peerKey(
        observation.kind,
        observation.ageBand,
        observation.startingLevel
      );

    const broadKey =
      peerKey(
        observation.kind,
        observation.ageBand
      );

    const detailedValues =
      detailed.get(
        detailedKey
      ) ?? [];

    detailedValues.push(
      observation.ratePer100Days
    );

    detailed.set(
      detailedKey,
      detailedValues
    );

    const broadValues =
      broad.get(
        broadKey
      ) ?? [];

    broadValues.push(
      observation.ratePer100Days
    );

    broad.set(
      broadKey,
      broadValues
    );
  }

  const out =
    new Map<
      number,
      PeerDevelopmentTrend
    >();

  for (
    const observation of
    observations
  ) {
    const detailedKey =
      peerKey(
        observation.kind,
        observation.ageBand,
        observation.startingLevel
      );

    const broadKey =
      peerKey(
        observation.kind,
        observation.ageBand
      );

    const detailedValues =
      detailed.get(
        detailedKey
      ) ?? [];

    const levelMatched =
      detailedValues.length >= 50;

    const cohortValues =
      levelMatched
        ? detailedValues
        : (
            broad.get(
              broadKey
            ) ?? []
          );

    const median =
      medianNumber(
        cohortValues
      );

    const percentile =
      percentileNumber(
        cohortValues,
        observation.ratePer100Days
      );

    if (
      median === null ||
      percentile === null ||
      cohortValues.length < 20
    ) {
      out.set(
        observation.playerId,
        {
          pace:
            'insufficient',

          percentile:
            null,

          ratePer100Days:
            null,

          cohortMedianRate:
            null,

          peerAdjustedRate:
            null,

          cohortSize:
            cohortValues.length,

          cohort: {
            kind:
              observation.kind,

            ageBand:
              observation.ageBand,

            startingLevel:
              observation
                .startingLevel,

            levelMatched,
          },

          reasons: [
            'Peer evidence is still insufficient: not enough comparable scouting-history observations are available for a stable baseline.',
          ],
        }
      );

      continue;
    }

    const peerAdjustedRate =
      observation.ratePer100Days -
      median;

    const pace:
      PeerDevelopmentPace =
        percentile <= 20
          ? 'behind'
          : percentile >= 80
            ? 'ahead'
            : 'typical';

    const paceLabel =
      pace === 'ahead'
        ? 'ahead of'
        : pace === 'behind'
          ? 'behind'
          : 'within the typical range for';

    out.set(
      observation.playerId,
      {
        pace,

        percentile:
          Math.round(
            percentile
          ),

        ratePer100Days:
          Math.round(
            observation
              .ratePer100Days *
            10
          ) / 10,

        cohortMedianRate:
          Math.round(
            median * 10
          ) / 10,

        peerAdjustedRate:
          Math.round(
            peerAdjustedRate *
            10
          ) / 10,

        cohortSize:
          cohortValues.length,

        cohort: {
          kind:
            observation.kind,

          ageBand:
            observation.ageBand,

          startingLevel:
            observation
              .startingLevel,

          levelMatched,
        },

        reasons: [
          `Observed current-skill change ranks at the ${Math.round(percentile)}th percentile among ${cohortValues.length} comparable ${observation.kind}s.`,
          `Development pace is ${paceLabel} the comparison cohort.`,
          levelMatched
            ? `Comparison cohort matches player type, age band, and starting level ${observation.startingLevel}.`
            : 'Starting-level cohort was too small, so comparison falls back to player type and age band.',
        ],
      }
    );
  }

  return out;
}


/** Save-wide peer history for callers that intentionally compare across organizations. */
export function peerDevelopmentTrendByPlayer():
  Map<number, PeerDevelopmentTrend> {
  return peerDevelopmentTrendByPlayerForScope(
    null
  );
}


/** Peer history built only from observations recorded for one organization. */
export function peerDevelopmentTrendByPlayerForOrg(
  orgId: number
): Map<number, PeerDevelopmentTrend> {
  return peerDevelopmentTrendByPlayerForScope(
    orgId
  );
}


// ── Development tracking ────────────────────────────────────────────────

export const historyRoutes = Router();


/**
 * Full scouting-history series for an organization.
 *
 * This is observational data only: the ratings captured at each import.
 * It deliberately does not reinterpret those snapshots as true talent.
 * Player Development and Retention already consume the derived trend models;
 * this route exists so the UI can show the underlying history honestly.
 */
historyRoutes.get('/development-history/:orgId', (req, res) => {
  const orgId =
    Number(req.params.orgId);

  if (!Number.isFinite(orgId)) {
    return res.status(400).json({
      error:
        'Invalid organization id',
    });
  }

  const saveName =
    currentSaveName();

  const rows =
    historyDb
      .prepare(
        `SELECT
           game_date,
           player_id,
           name,
           team_id,
           org_id,
           level,
           position,
           age,
           cur,
           pot,
           con,
           gap,
           pow,
           eye,
           avk,
           spd,
           stu,
           mov,
           ctl
         FROM rating_snapshots
         WHERE save_name = ?
           AND org_id = ?`
      )
      .all(
        saveName,
        orgId
      ) as Array<{
        game_date: string;
        player_id: number;
        name: string;
        team_id: number;
        org_id: number;
        level: number;
        position: number;
        age: number;
        cur: number | null;
        pot: number | null;
        con: number | null;
        gap: number | null;
        pow: number | null;
        eye: number | null;
        avk: number | null;
        spd: number | null;
        stu: number | null;
        mov: number | null;
        ctl: number | null;
      }>;

  rows.sort(
    (a, b) =>
      a.player_id -
        b.player_id ||
      compareGameDates(
        a.game_date,
        b.game_date
      )
  );

  const dates =
    [
      ...new Set(
        rows.map(
          (row) =>
            row.game_date
        )
      ),
    ].sort(
      compareGameDates
    );

  let observationDays:
    number | null =
      null;

  if (dates.length >= 2) {
    const first =
      gameDateEpoch(
        dates[0]
      );

    const latest =
      gameDateEpoch(
        dates[
          dates.length - 1
        ]
      );

    if (
      Number.isFinite(first) &&
      Number.isFinite(latest)
    ) {
      observationDays =
        Math.round(
          (
            latest -
            first
          ) /
          86_400_000
        );
    }
  }

  res.json({
    snapshots:
      dates.length,

    dates,

    observationDays,

    rows,
  });
});


historyRoutes.get('/development/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  const saveName = currentSaveName();
  const dates = snapshotDates();
  if (dates.length < 2) {
    return res.json({ snapshots: dates.length, dates, changes: null });
  }
  const from = String(req.query.from ?? dates[dates.length - 2]);
  const to = String(req.query.to ?? dates[dates.length - 1]);

  const rows = historyDb
    .prepare(
      `SELECT a.player_id, b.name, b.age, b.position, b.level, b.team_id,
              a.cur AS cur_from, b.cur AS cur_to, a.pot AS pot_from, b.pot AS pot_to,
              a.con AS con_a, b.con AS con_b, a.gap AS gap_a, b.gap AS gap_b,
              a.pow AS pow_a, b.pow AS pow_b, a.eye AS eye_a, b.eye AS eye_b,
              a.avk AS avk_a, b.avk AS avk_b, a.spd AS spd_a, b.spd AS spd_b,
              a.stu AS stu_a, b.stu AS stu_b, a.mov AS mov_a, b.mov AS mov_b,
              a.ctl AS ctl_a, b.ctl AS ctl_b
       FROM rating_snapshots a
       JOIN rating_snapshots b
         ON b.save_name = a.save_name AND b.player_id = a.player_id AND b.game_date = ?
       WHERE a.save_name = ? AND a.game_date = ? AND b.org_id = ?`
    )
    .all(to, saveName, from, orgId) as Array<Record<string, number | string | null>>;

  const changes = rows
    .map((r) => {
      const details: Array<{ rating: string; from: number; to: number }> = [];
      const pairs: Array<[string, string, string]> = [
        ['Contact', 'con_a', 'con_b'], ['Gap', 'gap_a', 'gap_b'], ['Power', 'pow_a', 'pow_b'],
        ['Eye', 'eye_a', 'eye_b'], ['Avoid K', 'avk_a', 'avk_b'], ['Speed', 'spd_a', 'spd_b'],
        ['Stuff', 'stu_a', 'stu_b'], ['Movement', 'mov_a', 'mov_b'], ['Control', 'ctl_a', 'ctl_b'],
      ];
      for (const [label, ka, kb] of pairs) {
        const a = r[ka] as number | null;
        const b = r[kb] as number | null;
        if (a !== null && b !== null && a !== b) details.push({ rating: label, from: a, to: b });
      }
      const curDelta = (r.cur_to as number ?? 0) - (r.cur_from as number ?? 0);
      const potDelta = (r.pot_to as number ?? 0) - (r.pot_from as number ?? 0);
      return {
        player_id: r.player_id,
        name: r.name,
        age: r.age,
        position: r.position,
        level: r.level,
        cur: r.cur_to,
        pot: r.pot_to,
        curDelta: Number(curDelta.toFixed(1)),
        potDelta: Number(potDelta.toFixed(1)),
        details,
      };
    })
    .filter((c) => c.details.length > 0)
    .sort((a, b) => Math.abs(b.curDelta) + Math.abs(b.potDelta) - (Math.abs(a.curDelta) + Math.abs(a.potDelta)));

  res.json({ snapshots: dates.length, dates, from, to, changes });
});

// ── Watchlist ───────────────────────────────────────────────────────────

historyRoutes.get('/watchlist', (_req, res) => {
  const rows = historyDb
    .prepare(`SELECT * FROM watchlist WHERE save_name = ? ORDER BY updated_at DESC`)
    .all(currentSaveName()) as Array<{ player_id: number; name: string; note: string; added_at: string }>;
  // Enrich with live info from the current league DB
  const enriched = rows.map((w) => {
    const p = tableExists('players')
      ? (leagueDb
          .prepare(
            `SELECT p.age, p.position, p.free_agent, t.name AS team_name, t.nickname, t.level
             FROM players p LEFT JOIN teams t ON t.team_id = p.team_id WHERE p.player_id = ?`
          )
          .get(w.player_id) as Record<string, unknown> | undefined)
      : undefined;
    return {
      ...w,
      age: p?.age ?? null,
      position: p?.position ?? null,
      team: p?.team_name ? `${p.team_name} ${p.nickname}` : p?.free_agent === 1 ? 'Free Agent' : null,
      level: p?.level ?? null,
    };
  });
  res.json(enriched);
});

historyRoutes.post('/watchlist', (req, res) => {
  const { player_id, name, note } = req.body as { player_id: number; name?: string; note?: string };
  if (!player_id) return res.status(400).json({ error: 'player_id required' });
  const now = new Date().toISOString();
  historyDb
    .prepare(
      `INSERT INTO watchlist (save_name, player_id, name, note, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (save_name, player_id)
       DO UPDATE SET note = COALESCE(excluded.note, note), name = COALESCE(excluded.name, name), updated_at = excluded.updated_at`
    )
    .run(currentSaveName(), player_id, name ?? null, note ?? '', now, now);
  res.json({ ok: true });
});

historyRoutes.delete('/watchlist/:playerId', (req, res) => {
  historyDb
    .prepare(`DELETE FROM watchlist WHERE save_name = ? AND player_id = ?`)
    .run(currentSaveName(), Number(req.params.playerId));
  res.json({ ok: true });
});

historyRoutes.get('/watchlist/:playerId', (req, res) => {
  const row = historyDb
    .prepare(`SELECT note FROM watchlist WHERE save_name = ? AND player_id = ?`)
    .get(currentSaveName(), Number(req.params.playerId)) as { note: string } | undefined;
  res.json({ watched: !!row, note: row?.note ?? '' });
});

// ── Notes on a player ───────────────────────────────────────────────────

historyRoutes.get('/player-notes/:playerId', (req, res) => {
  const rows = historyDb
    .prepare(
      `SELECT id, player_id, player_name, source, body, game_date, created_at
       FROM player_notes WHERE save_name = ? AND player_id = ?
       ORDER BY id DESC`
    )
    .all(currentSaveName(), Number(req.params.playerId));
  res.json({ notes: rows });
});

historyRoutes.post('/player-notes', (req, res) => {
  const { player_id, player_name, source, body } = req.body as {
    player_id?: number;
    player_name?: string;
    source?: string;
    body?: string;
  };
  if (!Number.isFinite(Number(player_id)) || !body || !body.trim()) {
    return res.status(400).json({ error: 'A player and some text are required' });
  }
  const info = historyDb
    .prepare(
      `INSERT INTO player_notes (save_name, player_id, player_name, source, body, game_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      currentSaveName(),
      Number(player_id),
      player_name ?? null,
      source ?? 'You',
      body.trim(),
      // The in-game date, not today's: a plan made in May is judged against the
      // season, and the wall clock means nothing to a save being simmed
      leagueGameDate(),
      new Date().toISOString()
    );
  res.json({ ok: true, id: info.lastInsertRowid });
});

historyRoutes.delete('/player-notes/:id', (req, res) => {
  historyDb
    .prepare(`DELETE FROM player_notes WHERE save_name = ? AND id = ?`)
    .run(currentSaveName(), Number(req.params.id));
  res.json({ ok: true });
});
