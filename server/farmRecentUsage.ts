/**
 * What a player has been doing for his club LATELY, and how much of "lately" could be observed.
 *
 * Season-to-date totals can describe a competition that no longer exists. On the real import a wave
 * of promotions four games before the export made every promoted prospect read as "cannot get the
 * work" at his new club — nineteen innings of a club's 378 — and named the regular there as the man
 * blocking him; all seven of the farm's pressing blocked-prospect findings were that artifact
 * (docs/MINOR_LEAGUE_OPERATIONS.md §8.2).
 *
 * Three things are kept apart here, because they are different kinds of fact:
 *
 *   season usage     what has happened this year. Context. `farmUsage.clubUsage`, unchanged.
 *   recent usage     what happened over the club's last few games. Evidence of the present role.
 *   current state    who is on the club now and available. NEVER inferred from usage: the roster,
 *                    Player State and the rehab screen decide it, and a man with 136 innings who is
 *                    no longer on the roster competes for nothing.
 *
 * The window is a number of CLUB GAMES, not days, and it is sample-aware: a man is only measured over
 * the games he could have played in — since he arrived, and outside a recorded injury spell. Few such
 * games is THIN evidence and his role is then not established, never "bench depth". This is a usage
 * read, not a performance one: nothing here knows how well anybody played.
 *
 * Pure: a game log and dated facts in, counts out. It opens no table and reads no rating.
 */

import { RECENT_MINIMUM_GAMES, RECENT_WINDOW_GAMES } from './farmCalibration.js';
import type { Absence, ClubGameLog, GameLine } from './farmUsage.js';

/** How long he has been on the club, as far as the evidence says. */
export type TenureStatus =
  /** On the club for the whole window. */
  | 'established'
  /** Joined it inside the window: his destination totals are small because he is new, not because he is unused. */
  | 'recent_arrival'
  /** Nothing dates his arrival and nothing shows him here before the window. Unknown stays unknown. */
  | 'unknown';

export interface Tenure {
  status: TenureStatus;
  /** ISO date he joined, when a source establishes one. */
  arrivedOn: string | null;
  /**
   * `transaction_log` is OOTP's dated move (D-020's chronology). `game_log` is a bound: he last played
   * for another club the day before, so he cannot have been here earlier.
   */
  basis: 'transaction_log' | 'game_log' | null;
  /** The club he came from, when the log names it. */
  from: string | null;
  /** Club games played since he arrived; null when his arrival is not established. */
  clubGamesSince: number | null;
}

/** How much the recent read can carry. A structured state, never a confidence number. */
export type RecentEvidence =
  /** Enough observable games to read a share as a role. */
  | 'sufficient'
  /** Some, but fewer than the minimum: the facts are shown and the role is not established. */
  | 'thin'
  /** None: he has not been observable for a single game in the window. */
  | 'none';

export interface RecentUsage {
  /** Club games the window covers: at most `RECENT_WINDOW_GAMES`. */
  windowGames: number;
  /** Window games he could have played in, as window-relative indexes (0 is the oldest). */
  observable: number[];
  /** Window games he missed to a recorded, non-day-to-day injury. */
  gamesMissedInjured: number;
  tenure: Tenure;
  evidence: RecentEvidence;

  /**
   * The last window game he appeared in for the club, in any role and whether or not it could be
   * counted for him; null when he did not appear. How long a man was actually here is what says
   * whether he HELD a job before he left it.
   */
  lastAppearance: number | null;

  /** Games he appeared in. */
  games: number;
  plateAppearances: number;
  /** Games he was in the starting lineup, at any spot, as window-relative indexes. */
  lineupStartGames: number[];
  /** Games he started in the field at each position, as window-relative indexes. Hitters. */
  startGames: Record<string, number[]>;
  /** Games he started as the designated hitter. */
  dhStarts: number;
  /** Games he came off the bench. */
  benchAppearances: number;

  /** Games he started on the mound, as window-relative indexes. Pitchers. */
  pitchingStartGames: number[];
  /** Relief appearances, as window-relative indexes, with the outs of each. */
  reliefGames: Array<{ game: number; outs: number }>;
}

export interface RecentUsageInput {
  log: ClubGameLog;
  playerId: number;
  /** OOTP's dated move to this club, when the log has one. */
  arrival: { date: string; from: string | null } | null;
  /** Whether the transaction log could be read at all. */
  chronologyAvailable: boolean;
  /** The last day he appeared for a DIFFERENT club this season, from the game log. */
  lastGameElsewhere: string | null;
  absences: readonly Absence[];
}

/** The index in `log.games` where the recent window begins. */
export const windowStart = (log: ClubGameLog): number => Math.max(0, log.games.length - RECENT_WINDOW_GAMES);

const shiftDay = (iso: string, days: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const nextDay = (iso: string): string => shiftDay(iso, 1);
const previousDay = (iso: string): string => shiftDay(iso, -1);

/**
 * When he joined, from the best source that says.
 *
 * The transaction log strictly dominates on the real import: it dated all 63 of one organization's
 * in-season arrivals, the game log 24 of them, and none the log missed — the other 39 came from
 * somewhere that played no games (an injured list, a complex club before its season). So the log is
 * read first and the game log is the bound that still works without it. Where both speak the LATER
 * date wins, because each is a lower bound on the first game he could have played here.
 */
function tenureOf(input: RecentUsageInput, lines: readonly GameLine[]): Tenure {
  const { log } = input;
  const bound = input.lastGameElsewhere ? nextDay(input.lastGameElsewhere) : null;
  const dated = input.arrival?.date ?? null;

  let arrivedOn: string | null = null;
  let basis: Tenure['basis'] = null;
  if (dated !== null && (bound === null || dated >= bound)) {
    arrivedOn = dated;
    basis = 'transaction_log';
  } else if (bound !== null) {
    arrivedOn = bound;
    basis = 'game_log';
  }

  const start = windowStart(log);
  const windowOpens = log.games[start]?.date ?? null;

  if (arrivedOn !== null) {
    const clubGamesSince = log.games.filter((g) => g.date >= (arrivedOn as string)).length;
    return {
      status: windowOpens !== null && arrivedOn > windowOpens ? 'recent_arrival' : 'established',
      arrivedOn,
      basis,
      from: basis === 'transaction_log' ? (input.arrival?.from ?? null) : null,
      clubGamesSince,
    };
  }

  /*
   * Nothing dates an arrival. With the log readable that is itself an answer: it records every move
   * and shows none to this club, so he has been here since before it began. Without it, a man who
   * played for the club before the window opened was demonstrably here; anyone else may have arrived
   * yesterday from a club that has not played, and that is not known.
   */
  const hereBeforeWindow = lines.some((l) => l.game < start);
  return {
    status: input.chronologyAvailable || hereBeforeWindow ? 'established' : 'unknown',
    arrivedOn: null,
    basis: null,
    from: null,
    clubGamesSince: null,
  };
}

/**
 * One man's recent usage for one club. null when the export has no game log or the club has not
 * played: the recent read is then UNAVAILABLE, which is not the same as thin, and the season read
 * stands alone exactly as it did before this module existed.
 */
export function recentUsageFor(input: RecentUsageInput): RecentUsage | null {
  const { log } = input;
  if (!log.available || log.games.length === 0) return null;

  const start = windowStart(log);
  const windowGames = log.games.length - start;
  const lines = log.lines.get(input.playerId) ?? [];
  const tenure = tenureOf(input, lines);

  const observable: number[] = [];
  let gamesMissedInjured = 0;
  for (let i = start; i < log.games.length; i++) {
    const date = log.games[i].date;
    if (tenure.arrivedOn !== null && date < tenure.arrivedOn) continue;
    if (input.absences.some((a) => date >= a.from && date < a.to)) {
      gamesMissedInjured++;
      continue;
    }
    observable.push(i - start);
  }

  const counted = new Set(observable);
  const out: RecentUsage = {
    windowGames,
    observable,
    gamesMissedInjured,
    tenure,
    evidence: 'none',
    lastAppearance: lines.reduce<number | null>((last, l) => (l.game >= start ? Math.max(last ?? -1, l.game - start) : last), null),
    games: 0,
    plateAppearances: 0,
    lineupStartGames: [],
    startGames: {},
    dhStarts: 0,
    benchAppearances: 0,
    pitchingStartGames: [],
    reliefGames: [],
  };

  for (const line of lines) {
    const at = line.game - start;
    /* A line from before he arrived belongs to an earlier stint here; it is history, not the present. */
    if (at < 0 || !counted.has(at)) continue;
    out.games++;
    out.plateAppearances += line.plateAppearances;
    if (line.pitched) {
      if (line.pitchingStart) out.pitchingStartGames.push(at);
      else out.reliefGames.push({ game: at, outs: line.outs });
    }
    if (line.started) {
      out.lineupStartGames.push(at);
      if (line.position === 'DH') out.dhStarts++;
      else if (line.position !== null && line.position !== 'P') (out.startGames[line.position] ??= []).push(at);
    } else if (!line.pitched) {
      out.benchAppearances++;
    }
  }

  /*
   * Unknown tenure caps the evidence at thin however many games the window holds: if he may have
   * arrived yesterday, fifteen games in which he did not play say nothing about his role.
   */
  out.evidence =
    observable.length === 0
      ? 'none'
      : observable.length < RECENT_MINIMUM_GAMES || tenure.status === 'unknown'
        ? 'thin'
        : 'sufficient';
  return out;
}

/** Who started at one fielding position in each game of the window, oldest first; null when the log names nobody. */
export function positionStarters(log: ClubGameLog, position: string): Array<number | null> {
  const start = windowStart(log);
  const out: Array<number | null> = new Array(Math.max(0, log.games.length - start)).fill(null);
  for (const [playerId, lines] of log.lines) {
    for (const line of lines) {
      if (line.game < start || !line.started || line.position !== position) continue;
      out[line.game - start] = playerId;
    }
  }
  return out;
}

/** Who started on the mound in each game of the window, oldest first. */
export function moundStarters(log: ClubGameLog): Array<number | null> {
  const start = windowStart(log);
  const out: Array<number | null> = new Array(Math.max(0, log.games.length - start)).fill(null);
  for (const [playerId, lines] of log.lines) {
    for (const line of lines) {
      if (line.game < start || !line.pitchingStart) continue;
      out[line.game - start] = playerId;
    }
  }
  return out;
}

/** The last window game each man appeared in for the club, window-relative: everyone in the log, on the roster or not. */
export function lastAppearances(log: ClubGameLog): Map<number, number> {
  const start = windowStart(log);
  const out = new Map<number, number>();
  for (const [playerId, lines] of log.lines) {
    for (const line of lines) if (line.game >= start) out.set(playerId, Math.max(out.get(playerId) ?? -1, line.game - start));
  }
  return out;
}

/** The position a hitter has started at most over the games counted, or null when he has started nowhere. */
export function recentPrimaryPosition(recent: RecentUsage): string | null {
  const played = Object.entries(recent.startGames)
    .map(([position, games]) => [position, games.length] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return played[0]?.[0] ?? null;
}

/**
 * Whether a pitcher is competing for the rotation or the bullpen.
 *
 * Current state first: OOTP's starting assignment, or a place in its next five. Then what he is doing
 * NOW — a start inside the window, when enough of it can be counted — and only when the window cannot
 * be read, the season. Reading the season first made anybody with an April start a rotation claimant
 * for the rest of the year, which both reported a converted reliever as a starter who was not getting
 * starts and counted him as rotation COVER when a real starter left, so a vacancy read as absorbed by
 * a man who had not started in a month.
 */
export function pitcherJob(input: {
  assignedStarter: boolean;
  projectedStarter: boolean | null;
  seasonStarts: number;
  recent: RecentUsage | null;
}): 'the rotation' | 'the bullpen' {
  if (input.assignedStarter || input.projectedStarter === true) return 'the rotation';
  const takingStarts =
    input.recent && input.recent.evidence === 'sufficient' ? input.recent.pitchingStartGames.length > 0 : input.seasonStarts > 0;
  return takingStarts ? 'the rotation' : 'the bullpen';
}

/** "4 games ago", for a sentence. */
export const gamesAgo = (n: number): string => `${n} ${n === 1 ? 'game' : 'games'} ago`;

/** How he came to be on the club, in words, for the evidence beside a reading. */
export function describeTenure(tenure: Tenure): string | null {
  if (tenure.status === 'unknown') {
    return 'The transaction log is unavailable and the game log does not show him with the club before the window, so whether he joined it recently cannot be told.';
  }
  if (tenure.status !== 'recent_arrival' || tenure.arrivedOn === null) return null;
  const since = tenure.clubGamesSince ?? 0;
  const source =
    tenure.basis === 'transaction_log'
      ? `OOTP's transaction log dates the move ${tenure.arrivedOn}${tenure.from ? `, from ${tenure.from}` : ''}`
      : `the game log has him playing for another club on ${previousDay(tenure.arrivedOn)}, so he cannot have joined before ${tenure.arrivedOn}`;
  return `He joined the club ${since === 0 ? 'after its last game' : gamesAgo(since)}: ${source}.`;
}
