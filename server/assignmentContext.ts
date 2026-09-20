/**
 * Why a player is where he is: current state read together with explicit
 * transaction history.
 *
 * The CSV says WHERE a player is (team, level, 40-man, active). It does not say
 * HOW he got there, and the difference matters: a player on a rehab assignment
 * appears in the export as Triple-A, on the 40-man, with no distinguishing
 * flag — exactly what an ordinary optioned player looks like. Treating him as
 * one produces wrong option and roster advice. This module uses explicit log
 * evidence to tell them apart, and says so plainly when it cannot.
 *
 * Nothing here evaluates rights. `ordinaryOption` is a statement about what the
 * evidence shows the assignment IS, not about what may be done next.
 */

import type { PlayerState } from './playerState.js';
import type { TeamRef, TransactionEvent, TransactionKind } from './transactionLog.js';
import type { Provenance, UnknownReason } from './provenance.js';

export type AssignmentKind =
  | 'rehab_assignment'
  | 'optioned'
  | 'recalled'
  | 'purchased_contract'
  | 'designated_for_assignment'
  | 'waivers'
  | 'injured_list'
  | 'restricted_list'
  /** A 40-man player below MLB whose assignment no explicit evidence explains. */
  | 'unattributed';

export interface RehabAssignment {
  status: 'active';
  sentOn: string | null;
  /** The parent club that sent him, where the log names it. */
  parent: TeamRef | null;
  /** The affiliate he is rehabbing with. */
  club: TeamRef | null;
}

export interface AssignmentContext {
  kind: AssignmentKind;
  label: string;
  /** What `since` is the date of, e.g. "Sent on rehab". */
  sinceLabel: string | null;
  since: string | null;
  /**
   * True only when explicit evidence shows an ordinary option. False for
   * anything else that has been positively identified (rehab, DFA, injured
   * list, ...). Null when the cause is not established.
   */
  ordinaryOption: boolean | null;
  provenance: Provenance;
  /** Display sources, e.g. "OOTP transaction log". */
  source: string;
  /** Whether the current export is consistent with the log evidence; null if it cannot say. */
  exportAgrees: boolean | null;
  rehab: RehabAssignment | null;
  /** Kind-specific facts drawn from the evidence. */
  details: Record<string, string | number | boolean | null>;
  reason?: UnknownReason;
  note?: string;
  evidence: TransactionEvent[];
}

export interface LogAvailability {
  /** False when no transaction log could be read. */
  available: boolean;
  /** True when the log is older than the save it belongs to. */
  behind: boolean;
}

const SOURCE_LOG = 'OOTP transaction log';
const SOURCE_EXPORT = 'OOTP CSV export';

/** Later events that end a rehab assignment. Injured-list moves do not: the player is still hurt. */
const REHAB_ENDING = new Set<TransactionKind>([
  'rehab_returned',
  'recalled',
  'purchased_contract',
  'optioned',
  'designated_for_assignment',
  'released',
  'rule5_return',
  'restricted_list_placed',
  'minor_league_assignment',
]);

interface RehabEpisode {
  start: TransactionEvent;
  assigned: TransactionEvent | null;
  received: TransactionEvent | null;
  ended: TransactionEvent | null;
}

/**
 * The most recent rehab episode in a player's history (oldest-first events).
 * The log writes it twice — "Sent" for the parent and "Received" for the
 * affiliate — which is one episode. It ends at the first later event that
 * places the player somewhere else.
 */
export function latestRehabEpisode(events: TransactionEvent[]): RehabEpisode | null {
  let current: RehabEpisode | null = null;
  let last: RehabEpisode | null = null;
  for (const event of events) {
    if (event.kind === 'rehab_assigned' || event.kind === 'rehab_received') {
      const isAssigned = event.kind === 'rehab_assigned';
      const mirror = isAssigned ? current?.assigned : current?.received;
      if (current && !current.ended && event.date === current.start.date && !mirror) {
        if (isAssigned) current.assigned = event;
        else current.received = event;
        continue;
      }
      current = {
        start: event,
        assigned: isAssigned ? event : null,
        received: isAssigned ? null : event,
        ended: null,
      };
      last = current;
      continue;
    }
    if (current && !current.ended && REHAB_ENDING.has(event.kind)) current.ended = event;
  }
  return last;
}

function rehabClub(episode: RehabEpisode): TeamRef | null {
  if (episode.assigned?.to) return episode.assigned.to;
  const id = episode.received?.sources[0]?.teamId ?? null;
  return id === null ? null : { id, name: '', levelLabel: null };
}

function rehabParent(episode: RehabEpisode): TeamRef | null {
  if (episode.received?.from) return episode.received.from;
  const id = episode.assigned?.sources[0]?.teamId ?? null;
  return id === null ? null : { id, name: '', levelLabel: null };
}

const lastOfKinds = (events: TransactionEvent[], kinds: TransactionKind[]): TransactionEvent | null => {
  for (let i = events.length - 1; i >= 0; i -= 1) if (kinds.includes(events[i].kind)) return events[i];
  return null;
};

/** Events that establish or change where a player stands, for "what is the latest?". */
const STANDING_KINDS: TransactionKind[] = [
  'optioned', 'recalled', 'purchased_contract', 'il_placed', 'il_activated',
  'restricted_list_placed', 'restricted_list_activated', 'designated_for_assignment',
  'released', 'rule5_return', 'rehab_returned',
];

function base(
  kind: AssignmentKind,
  label: string,
  fields: Partial<AssignmentContext> & Pick<AssignmentContext, 'ordinaryOption' | 'provenance' | 'source'>
): AssignmentContext {
  return {
    kind, label, sinceLabel: null, since: null, exportAgrees: null,
    rehab: null, details: {}, evidence: [], ...fields,
  };
}

/**
 * The assignment context for one player, or null when there is nothing that
 * changes how his current assignment should be read.
 *
 * @param events his explicit transaction history, oldest first; null when no
 *   transaction log is available at all.
 */
export function assignmentContextFor(
  state: PlayerState,
  events: TransactionEvent[] | null,
  log: LogAvailability
): AssignmentContext | null {
  const history = events ?? [];
  const teamId = state.teamId.value;
  const level = state.level.value;

  // 1. Facts the export states directly outrank any reading of history.
  if (state.dfa.designated.value === true) {
    const dfa = lastOfKinds(history, ['designated_for_assignment']);
    return base('designated_for_assignment', 'Designated for assignment', {
      ordinaryOption: false,
      provenance: 'explicit_export',
      source: dfa ? `${SOURCE_EXPORT}; ${SOURCE_LOG}` : SOURCE_EXPORT,
      since: dfa?.date ?? null,
      sinceLabel: dfa ? 'Designated' : null,
      details: {
        daysLeft: state.dfa.daysLeft.value,
        waiverStatus: dfa ? (dfa.details.waiverStatus ?? null) : null,
      },
      evidence: dfa ? [dfa] : [],
    });
  }
  if (state.dfa.onWaivers.value === true) {
    return base('waivers', 'On waivers', {
      ordinaryOption: false,
      provenance: 'explicit_export',
      source: SOURCE_EXPORT,
      details: { daysLeft: state.dfa.waiverDaysLeft.value ?? state.dfa.daysLeft.value },
    });
  }

  let mismatch: string | null = null;

  if (events) {
    // 2. Rehab: an open episode in the log that the export's current team agrees with
    const episode = latestRehabEpisode(history);
    if (episode && !episode.ended) {
      const club = rehabClub(episode);
      const agrees =
        club === null || teamId === null ? null : teamId === club.id && (level === null || level > 1);
      if (agrees !== false) {
        return base('rehab_assignment', 'Rehab assignment', {
          ordinaryOption: false,
          provenance: 'explicit_log',
          source: SOURCE_LOG,
          sinceLabel: 'Sent on rehab',
          since: episode.start.date,
          exportAgrees: agrees,
          rehab: { status: 'active', sentOn: episode.start.date, parent: rehabParent(episode), club },
          evidence: [episode.assigned, episode.received].filter((e): e is TransactionEvent => !!e),
        });
      }
      mismatch = `The log shows a rehab assignment from ${episode.start.date ?? 'an unknown date'} that the current export no longer matches.`;
    }

    // 3. The latest explicit event that places the player, checked against the export
    const latest = lastOfKinds(history, STANDING_KINDS);
    if (latest) {
      switch (latest.kind) {
        case 'optioned': {
          const agrees = latest.to && teamId !== null ? latest.to.id === teamId : null;
          if (agrees !== false) {
            return base('optioned', 'Optioned', {
              ordinaryOption: true,
              provenance: 'explicit_log',
              source: SOURCE_LOG,
              sinceLabel: 'Optioned',
              since: latest.date,
              exportAgrees: agrees,
              details: { club: latest.to?.name ?? null },
              evidence: [latest],
            });
          }
          mismatch ??= `The latest option (${latest.date ?? 'unknown date'}) no longer matches the current assignment.`;
          break;
        }
        case 'recalled':
        case 'purchased_contract': {
          const agrees = level === null ? null : level === 1;
          if (agrees !== false) {
            const recalled = latest.kind === 'recalled';
            return base(latest.kind, recalled ? 'Recalled' : 'Contract purchased', {
              ordinaryOption: false,
              provenance: 'explicit_log',
              source: SOURCE_LOG,
              sinceLabel: recalled ? 'Recalled' : 'Contract purchased',
              since: latest.date,
              exportAgrees: agrees,
              details: { from: latest.from?.name ?? null },
              evidence: [latest],
            });
          }
          break;
        }
        case 'il_placed': {
          if (state.injuredList.onIl.value === true || state.injuredList.onIl60.value === true) {
            return base('injured_list', 'Injured list', {
              ordinaryOption: false,
              provenance: 'explicit_export',
              source: `${SOURCE_EXPORT}; ${SOURCE_LOG}`,
              sinceLabel: 'Placed on injured list',
              since: latest.date,
              exportAgrees: true,
              details: {
                days: latest.details.days ?? null,
                retroactiveTo: latest.details.retroactiveTo ?? null,
                sixtyDay: state.injuredList.onIl60.value === true,
              },
              evidence: [latest],
            });
          }
          break;
        }
        case 'restricted_list_placed':
          return base('restricted_list', 'Restricted list', {
            ordinaryOption: false,
            provenance: 'explicit_log',
            source: SOURCE_LOG,
            sinceLabel: 'Placed on restricted list',
            since: latest.date,
            evidence: [latest],
          });
        default:
          break;
      }
    }
  }

  // 4. Injured list as the export states it, with no log evidence needed
  if (state.injuredList.onIl.value === true || state.injuredList.onIl60.value === true) {
    return base('injured_list', 'Injured list', {
      ordinaryOption: false,
      provenance: 'explicit_export',
      source: SOURCE_EXPORT,
      details: { sixtyDay: state.injuredList.onIl60.value === true },
    });
  }

  // 5. The case that cannot be read from the export alone: on the 40-man,
  //    below MLB, not on the active roster. It might be an option, a rehab
  //    assignment, or something else — the export does not say.
  if (level !== null && level > 1 && state.fortyMan.value === true && state.activeRoster.value === false) {
    const reason: UnknownReason = !log.available
      ? 'source_unavailable'
      : log.behind
        ? 'source_stale'
        : 'no_explicit_event';
    const why =
      reason === 'source_unavailable'
        ? 'The transaction log is unavailable, so this cannot be told apart from an option or a rehab assignment.'
        : reason === 'source_stale'
          ? 'The transaction log is behind the save, so the move that placed him here may not be in it.'
          : 'No explicit transaction in the log explains this assignment.';
    return base('unattributed', 'Assignment cause not established', {
      ordinaryOption: null,
      provenance: 'unknown',
      source: SOURCE_EXPORT,
      reason,
      note: mismatch ? `${mismatch} ${why}` : why,
    });
  }

  return null;
}
