/**
 * How current Pennant's roster evidence is.
 *
 * Three sources each describe the game at some moment, and all are compared on
 * one basis: the last in-game day whose games have been simulated.
 *
 *   OOTP save        `settings/last_date_simulated.dat`, read directly.
 *   CSV export       `leagues.current_date` names the day about to be played,
 *                    so the export reflects the day before it. Checked on a
 *                    real save: current_date 2026-5-16, last played game
 *                    2026-5-15, last_date_simulated 15 May.
 *   Transaction log  how far the database has been written (see
 *                    `LogCoverage`), not merely its newest transaction row.
 *
 * Wall-clock file times are never used to judge freshness. They are shown as
 * diagnostics only.
 *
 * Moves made on the current, not-yet-simulated day are dated that day in the
 * log and are in an export taken afterwards. The comparisons below allow for
 * that: a log dated the CSV's own current date is not "ahead" of the CSV.
 */

export type RosterEvidenceLevel = 'current' | 'partial' | 'stale' | 'unavailable';

/**
 * An in-game date as the server serves it. A string, never a date type: OOTP writes dates unpadded (`2026-5-9`), and
 * although the fields that pass through `parseGameDate` are padded, a client compares or orders game dates only as the
 * server does (D-056). The contract (`contract/openapi.json`) names it `GameDate`, with no format.
 */
export type GameDate = string;

export type SourceState =
  | 'current'
  | 'behind'
  /** Nothing to compare it with. */
  | 'unverified'
  | 'unavailable';

export type LogUnavailableReason =
  | 'save_not_found'
  | 'database_missing'
  | 'unreadable';

export interface FreshnessInputs {
  /** Last simulated in-game date, ISO, from the save. */
  saveSimulatedThrough: string | null;
  /** `leagues.current_date` of the imported export, ISO; null when nothing is imported. */
  csvCurrentDate: string | null;
  log:
    | { available: false; reason: LogUnavailableReason }
    | { available: true; lastTransactionDate: string | null; coveredThrough: string | null };
}

export interface SourceFreshness {
  state: SourceState;
  /** Simulated-through date on the common basis, ISO. */
  through: GameDate | null;
  lagDays: number;
}

export interface FreshnessAssessment {
  level: RosterEvidenceLevel;
  save: { simulatedThrough: GameDate | null };
  csv: SourceFreshness & { currentDate: GameDate | null };
  log: SourceFreshness & { unavailableReason: LogUnavailableReason | null };
  /** One line, e.g. "Partial — transaction log 1 day behind". */
  headline: string;
  reasons: string[];
  /** What the user should do about it, when there is something to do. */
  action: string | null;
}

const DAY_MS = 86_400_000;

/** Accepts OOTP's un-padded `2026-5-16` as well as `2026-05-16`. */
export function parseGameDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const check = new Date(t);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const toMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}

export function addDays(iso: string, days: number): string {
  return new Date(toMs(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export const STALE_SNAPSHOT_ACTION =
  'Your Pennant roster snapshot is behind the current OOTP save. Export fresh database data before relying on roster recommendations.';

export function assessFreshness(input: FreshnessInputs): FreshnessAssessment {
  const save = input.saveSimulatedThrough;
  const csvCurrent = input.csvCurrentDate;
  // The export shows the day about to be played, so it reflects the day before
  const csvThrough = csvCurrent ? addDays(csvCurrent, -1) : null;
  const logKnown = input.log.available;
  const logLastTransaction = input.log.available ? input.log.lastTransactionDate : null;
  const logCovered = input.log.available ? input.log.coveredThrough : null;

  // --- CSV -----------------------------------------------------------------
  let csvLag = 0;
  let csvCompared = false;
  if (csvThrough && save) {
    csvLag = Math.max(csvLag, daysBetween(csvThrough, save));
    csvCompared = true;
  }
  if (csvCurrent && logLastTransaction) {
    // Transactions dated after the export's own current day cannot be in it
    csvLag = Math.max(csvLag, daysBetween(csvCurrent, logLastTransaction));
    csvCompared = true;
  }
  let csvState: SourceState;
  if (!csvCurrent) csvState = 'unavailable';
  else if (!csvCompared) csvState = 'unverified';
  else csvState = csvLag > 0 ? 'behind' : 'current';

  // --- Transaction log -----------------------------------------------------
  const reference = [save, csvThrough].filter((d): d is string => !!d).sort().pop() ?? null;
  let logLag = 0;
  let logState: SourceState;
  if (!input.log.available) logState = 'unavailable';
  else if (!logCovered) logState = 'unverified';
  else if (!reference) logState = 'unverified';
  else {
    logLag = Math.max(0, daysBetween(logCovered, reference));
    logState = logLag > 0 ? 'behind' : 'current';
  }

  const result = (
    level: RosterEvidenceLevel,
    headline: string,
    reasons: string[],
    action: string | null
  ): FreshnessAssessment => ({
    level,
    save: { simulatedThrough: save },
    csv: { state: csvState, through: csvThrough, currentDate: csvCurrent, lagDays: csvLag },
    log: {
      state: logState,
      through: logCovered,
      lagDays: logLag,
      unavailableReason: input.log.available ? null : input.log.reason,
    },
    headline,
    reasons,
    action,
  });

  if (csvState === 'unavailable') {
    return result('unavailable', 'Unavailable — no league data has been imported', [
      'No OOTP export has been imported yet.',
    ], 'Export your OOTP database and import it to begin.');
  }

  if (csvState === 'behind') {
    const reasons = [`League data is ${plural(csvLag, 'day')} behind the OOTP save.`];
    if (logState === 'unavailable') reasons.push('The transaction log is also unavailable.');
    return result('stale', `Stale — league snapshot ${plural(csvLag, 'day')} behind`, reasons, STALE_SNAPSHOT_ACTION);
  }

  const reasons: string[] = [];
  if (logKnown && logState === 'behind') {
    reasons.push(`The transaction log is ${plural(logLag, 'day')} behind, so recent moves may be missing from the history.`);
    return result('partial', `Partial — transaction log ${plural(logLag, 'day')} behind`, reasons, null);
  }
  if (logState === 'unavailable') {
    const why =
      input.log.available === false && input.log.reason === 'save_not_found'
        ? 'The OOTP save folder could not be found.'
        : input.log.available === false && input.log.reason === 'database_missing'
          ? 'The save has no live transaction database.'
          : 'The live transaction database could not be read.';
    reasons.push(`${why} Current league state is available, but reasoning that depends on transaction history is limited.`);
    return result('partial', 'Partial — transaction log unavailable', reasons, null);
  }
  if (csvState === 'unverified' || logState === 'unverified') {
    reasons.push('There is no OOTP save date to compare the imported data with.');
    return result('partial', 'Partial — could not be verified against the OOTP save', reasons, null);
  }
  return result('current', 'Current', [], null);
}
