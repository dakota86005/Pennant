/**
 * When a player joined the club he is on now, from explicit chronology.
 *
 * Shared state handling, like `rehabAssignments.ts`: current state (the club the export says he is
 * on) is read against OOTP's transaction log, and the answer is a dated fact or nothing. It draws no
 * rights conclusion and no baseball one. Minor League Operations uses it to tell a man who has just
 * arrived from a man who is not being played — on the real import 63 of one organization's 230 minor
 * leaguers had joined their club in-season, and a promoted prospect's four games at his new club
 * read as "cannot get the work".
 *
 * The source hierarchy is D-020's. The export decides WHERE he is; the log only dates how he got
 * there. So an event counts only if it names the club the export has him on, and only if nothing
 * later in the log sends him somewhere else: when the two disagree about his club the log is not
 * used to date anything. The log can also run ahead of the export (a save simulated a day past the
 * last CSV export), so events after `through` are ignored.
 *
 * Absent is not "has always been here". With the log available, no dated arrival means he has been
 * on the club since before the log's first day. With it unavailable, nothing is known, and
 * `chronologyAvailable` says which.
 */

import { currentTransactionLog } from './dataStatus.js';
import { playerStates } from './playerState.js';

export interface ClubArrival {
  /** ISO date of the move that put him on his current club. */
  date: string;
  /** The club he came from, where the log's wording names one. */
  from: { teamId: number; name: string } | null;
  /** The sentence as the log has it, markup removed. */
  text: string;
}

export interface ClubArrivals {
  /** False when the log could not be read: a missing entry then means "not known", not "no move". */
  chronologyAvailable: boolean;
  /** The first day the log covers. A man with no entry has been on his club since before it. */
  coveredFrom: string | null;
  arrivals: Map<number, ClubArrival>;
}

/**
 * The dated arrival of each player at his current club, for those the log dates.
 *
 * `through` is the last day the export reflects (ISO); null applies no upper bound.
 */
export function arrivalsAtCurrentClub(playerIds: readonly number[], through: string | null): ClubArrivals {
  const arrivals = new Map<number, ClubArrival>();
  const { log } = currentTransactionLog();
  if (!log) return { chronologyAvailable: false, coveredFrom: null, arrivals };

  for (const [id, state] of playerStates([...playerIds])) {
    const club = state.teamId.value;
    if (club === null) continue;
    const moves = (log.byPlayer.get(id) ?? []).filter(
      (e) => e.to !== null && e.date !== null && (through === null || e.date <= through)
    );
    if (moves.length === 0) continue;
    /* The log is oldest first; a stable sort keeps same-day rows in the order they were written. */
    const latest = [...moves].sort((a, b) => (a.date as string).localeCompare(b.date as string))[moves.length - 1];
    if (latest.to?.id !== club) continue;
    /*
     * One move is written several times ("Promoted X to Reno", "Promoted X from Amarillo to Reno").
     * The origin is taken from whichever same-day row names it.
     */
    const named = moves.find((e) => e.date === latest.date && e.to?.id === club && e.from !== null);
    arrivals.set(id, {
      date: latest.date as string,
      from: named?.from ? { teamId: named.from.id, name: named.from.name } : null,
      text: (named ?? latest).text,
    });
  }

  return { chronologyAvailable: true, coveredFrom: log.coverage.firstTransactionDate, arrivals };
}
