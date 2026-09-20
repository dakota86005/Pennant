import type { DataStatus, RosterEvidenceLevel } from './api';

/** `2026-05-15` → "May 15, 2026". Read as UTC so the day never shifts with the viewer's zone. */
export function formatGameDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export interface StatusRow {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'bad' | 'muted';
}

/** The four lines the panel shows, as data so they can be tested without a DOM. */
export function statusRows(s: DataStatus): StatusRow[] {
  const f = s.freshness;

  const league: StatusRow =
    f.csv.state === 'current'
      ? { label: 'League data', value: 'Current', tone: 'good' }
      : f.csv.state === 'behind'
        ? { label: 'League data', value: `Behind by ${plural(f.csv.lagDays, 'day')}`, tone: 'bad' }
        : f.csv.state === 'unavailable'
          ? { label: 'League data', value: 'Not imported', tone: 'bad' }
          : { label: 'League data', value: 'Not verified against the save', tone: 'warn' };

  const log = s.transactionLog;
  const transactions: StatusRow = !log.readable
    ? {
        label: 'Transactions',
        value: s.save.found ? 'Unavailable' : 'Unavailable — save not found',
        tone: 'warn',
      }
    : f.log.state === 'behind'
      ? {
          label: 'Transactions',
          value: `Through ${formatGameDay(f.log.through)} (${plural(f.log.lagDays, 'day')} behind)`,
          tone: 'warn',
        }
      : { label: 'Transactions', value: `Through ${formatGameDay(f.log.through)}`, tone: 'good' };

  const save: StatusRow = {
    label: 'OOTP save',
    value: s.save.simulatedThrough
      ? `Through ${formatGameDay(s.save.simulatedThrough)}`
      : s.save.found ? 'Date unreadable' : 'Not found',
    tone: s.save.simulatedThrough ? 'muted' : 'warn',
  };

  const evidenceTone: StatusRow['tone'] =
    f.level === 'current' ? 'good' : f.level === 'partial' ? 'warn' : 'bad';
  const evidence: StatusRow = { label: 'Roster evidence', value: f.headline, tone: evidenceTone };

  return [league, transactions, save, evidence];
}

export const LEVEL_LABEL: Record<RosterEvidenceLevel, string> = {
  current: 'Current',
  partial: 'Partial',
  stale: 'Stale',
  unavailable: 'Unavailable',
};

