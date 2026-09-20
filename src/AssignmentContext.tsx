import type { AssignmentContext } from './api';
import { formatGameDay } from './dataStatusModel';

/** Kinds worth a mark on every roster row: they change how the current assignment reads. */
const ROW_KINDS = new Set(['rehab_assignment', 'optioned', 'restricted_list']);

const tip = (a: AssignmentContext): string =>
  [
    a.label,
    a.sinceLabel && a.since ? `${a.sinceLabel}: ${formatGameDay(a.since)}` : null,
    `Source: ${a.source}`,
    a.ordinaryOption === false && a.kind === 'rehab_assignment'
      ? 'Not an option or a demotion.'
      : null,
    a.note,
  ]
    .filter(Boolean)
    .join('\n');

/** A small mark for a roster row. Shows nothing unless the context matters there. */
export function AssignmentChip({ assignment }: { assignment: AssignmentContext | null | undefined }) {
  if (!assignment || !ROW_KINDS.has(assignment.kind)) return null;
  return (
    <span className={`assignment-chip kind-${assignment.kind}`} title={tip(assignment)}>
      {assignment.kind === 'rehab_assignment' ? 'Rehab' : assignment.label}
    </span>
  );
}

/**
 * The fuller statement for a player card:
 *
 *   Assignment context
 *   Rehab assignment
 *   Sent on rehab: May 12
 *   Source: OOTP transaction log
 */
export function AssignmentBlock({ assignment }: { assignment: AssignmentContext | null | undefined }) {
  if (!assignment) return null;
  const unestablished = assignment.kind === 'unattributed';
  return (
    <div className={`assignment-block ${unestablished ? 'unestablished' : ''}`}>
      <div className="assignment-block-title">Assignment context</div>
      <div className="assignment-block-label">{assignment.label}</div>
      {assignment.sinceLabel && assignment.since && (
        <div>
          {assignment.sinceLabel}: {formatGameDay(assignment.since)}
        </div>
      )}
      {assignment.kind === 'rehab_assignment' && (
        <div className="muted">Not an option or a demotion.</div>
      )}
      {assignment.note && <div className="muted">{assignment.note}</div>}
      <div className="muted">Source: {assignment.source}</div>
    </div>
  );
}
