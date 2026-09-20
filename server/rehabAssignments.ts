/**
 * Who on an affiliate's roster is not an ordinary member of it.
 *
 * A player on an injury-rehab assignment is a parent-club player sent down to
 * play his way back. The export lists him exactly like an optioned player:
 * Triple-A, on the 40-man, not active, no distinguishing flag (D-020). Counted
 * as an ordinary affiliate player he props up that club's rotation or bullpen
 * on paper, is offered as its depth, and is judged for retention, when he is
 * going back to the major-league club.
 *
 * This is shared state handling, read through the assignment context (state
 * read against explicit chronology), so every Minor League Operations reader
 * treats him the same way. It draws no rights conclusion.
 *
 *   rehab      an explicit, current log establishes a rehab assignment: he is
 *              excluded from ordinary affiliate roster health and depth.
 *   ambiguous  a 40-man player below MLB that nothing explains (usually the log
 *              is unavailable): he may be on rehab or optioned. Unknown stays
 *              unknown: he is neither excluded nor assumed ordinary, and the
 *              caller is told so.
 */

import { assignmentContextsFor } from './playerContext.js';

export interface AffiliateAssignmentScreen {
  rehab: Set<number>;
  /** player id -> why his assignment cannot be told apart from a rehab assignment. */
  ambiguous: Map<number, string>;
}

export function screenAffiliatePlayers(playerIds: number[]): AffiliateAssignmentScreen {
  const rehab = new Set<number>();
  const ambiguous = new Map<number, string>();
  if (playerIds.length === 0) return { rehab, ambiguous };
  for (const [id, context] of assignmentContextsFor(playerIds)) {
    if (context.kind === 'rehab_assignment') rehab.add(id);
    else if (context.kind === 'unattributed') {
      ambiguous.set(id, context.note ?? 'No explicit transaction establishes why he is below the major-league club.');
    }
  }
  return { rehab, ambiguous };
}
