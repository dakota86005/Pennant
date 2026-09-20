/**
 * Puts the three concerns side by side for a player without merging them:
 * current state from the export, chronology from the live log, and the
 * assignment context that reads one against the other.
 */

import { assignmentContextFor, type AssignmentContext } from './assignmentContext.js';
import { currentTransactionLog, getDataStatus, logAvailability, type DataStatus } from './dataStatus.js';
import { playerState, playerStates, type PlayerState } from './playerState.js';
import type { TransactionEvent } from './transactionLog.js';

export interface PlayerPicture {
  state: PlayerState;
  assignment: AssignmentContext | null;
  /** The player's explicit log history, newest first. Empty when the log is unavailable. */
  chronology: TransactionEvent[];
  /** Why chronology is empty or partial, in plain terms. */
  chronologyNote: string | null;
  freshness: DataStatus['freshness'];
}

/** Assignment contexts for a batch of players, keyed by id. Players with nothing notable are omitted. */
export function assignmentContextsFor(playerIds: number[], status: DataStatus = getDataStatus()): Map<number, AssignmentContext> {
  const out = new Map<number, AssignmentContext>();
  if (playerIds.length === 0) return out;
  const { log } = currentTransactionLog();
  const availability = logAvailability(status);
  for (const [id, state] of playerStates(playerIds)) {
    const events = log ? (log.byPlayer.get(id) ?? []) : null;
    const context = assignmentContextFor(state, events, availability);
    if (context) out.set(id, context);
  }
  return out;
}

export function playerPicture(playerId: number, chronologyLimit = 25): PlayerPicture | null {
  const state = playerState(playerId);
  if (!state) return null;
  const status = getDataStatus();
  const { log } = currentTransactionLog();
  const events = log ? (log.byPlayer.get(playerId) ?? []) : null;
  const chronologyNote = !log
    ? 'The OOTP transaction log is unavailable, so no transaction history is shown.'
    : status.freshness.log.state === 'behind'
      ? `The transaction log is ${status.freshness.log.lagDays} day(s) behind the save; recent moves may be missing.`
      : null;
  return {
    state,
    assignment: assignmentContextFor(state, events, logAvailability(status)),
    chronology: events ? [...events].reverse().slice(0, chronologyLimit) : [],
    chronologyNote,
    freshness: status.freshness,
  };
}
