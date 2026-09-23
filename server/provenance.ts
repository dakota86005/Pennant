/**
 * Where a fact about a player came from, and why one is missing.
 *
 * The source hierarchy for roster evidence (D-020) is:
 *
 *   1. `explicit_export`    a field OOTP's CSV export states directly
 *   2. `explicit_log`       an entry in OOTP's live transaction log
 *   3. `observed_snapshot`  a difference Pennant itself saw between two imports
 *   4. `derived`            computed here from one or more of the above
 *   5. `unknown`            nothing establishes it
 *
 * A snapshot difference is evidence that state changed. It is never proof of a
 * particular transaction, so it never carries `explicit_log`.
 */

export type Provenance =
  | 'explicit_export'
  | 'explicit_log'
  | 'observed_snapshot'
  | 'derived'
  | 'unknown';

/**
 * Why a value is unknown, where the reason is known. "Unknown" alone hides
 * whether to export again, wait for a rule to be written, or accept that OOTP
 * never says.
 */
export type UnknownReason =
  /** The table, file, or log that would answer it is not there. */
  | 'source_unavailable'
  /** The source exists but is behind the save. */
  | 'source_stale'
  /** The source has it, but this application has not implemented the rule. */
  | 'rule_not_implemented'
  /** The export does not carry the field, or carries it blank. */
  | 'not_exported_by_ootp'
  /** A transaction whose wording this application does not parse. */
  | 'transaction_type_not_understood'
  /** The semantics are unverified because no example has been observed. */
  | 'no_observed_example'
  /** A current log holds no explicit event that would establish it. */
  | 'no_explicit_event';

export const UNKNOWN_REASON_TEXT: Record<UnknownReason, string> = {
  source_unavailable: 'the source that would answer this is unavailable',
  source_stale: 'the source is behind the current OOTP save',
  rule_not_implemented: 'the rule for this is not implemented yet',
  not_exported_by_ootp: 'OOTP does not export this field',
  transaction_type_not_understood: 'this transaction type is not understood yet',
  no_observed_example: 'no example of this has been observed yet',
  no_explicit_event: 'the transaction log records no explicit event for it',
};

/** A value together with where it came from. `value` is null only when unknown. */
export interface Sourced<T> {
  value: T | null;
  provenance: Provenance;
  /** Table.column, log table, or other locator; null when nothing supplied it. */
  source: string | null;
  reason?: UnknownReason;
  note?: string;
}

export const fromExport = <T>(value: T, source: string): Sourced<T> => ({
  value,
  provenance: 'explicit_export',
  source,
});

export const fromLog = <T>(value: T, source: string): Sourced<T> => ({
  value,
  provenance: 'explicit_log',
  source,
});

export const derivedFrom = <T>(value: T, source: string, note?: string): Sourced<T> => ({
  value,
  provenance: 'derived',
  source,
  ...(note ? { note } : {}),
});

/**
 * A value shown exactly as exported whose meaning the export does not establish (the market scale,
 * the owner-expectation code, the luxury-tax figure). It is displayed, never interpreted: no code
 * compares it with a threshold or turns it into a label (D-018).
 */
export type Uninterpreted<T> = Sourced<T> & { meaning: 'unknown' };

export const uninterpreted = <T>(value: Sourced<T>, why: string): Uninterpreted<T> => ({
  ...value,
  meaning: 'unknown',
  note: value.note ? `${value.note} ${why}` : why,
});

export const unknownBecause = <T = never>(
  reason: UnknownReason,
  source: string | null = null,
  note?: string
): Sourced<T> => ({
  value: null,
  provenance: 'unknown',
  source,
  reason,
  ...(note ? { note } : {}),
});
