/**
 * The catalog of every stat the app can display, and the user's column choices.
 *
 * Keys match the computed stat blocks the server returns, so adding a column
 * to the catalog is all it takes to make a new stat selectable. The catalog
 * itself is the server's (`server/presentation/statCatalog.ts`), which the Mac
 * app is served too, so the two clients cannot describe a stat two ways.
 */

import { BATTING_STATS, CONTACT_STATS, FIELDING_STATS, PITCHING_STATS, type StatDef, type StatGroup } from '../server/presentation/statCatalog';

export { BATTING_STATS, CONTACT_STATS, FIELDING_STATS, PITCHING_STATS };
export type { StatDef, StatFormat, StatGroup } from '../server/presentation/statCatalog';

export const DEFAULT_BATTING = ['pa', 'avg', 'obp', 'slg', 'ops', 'opsPlus', 'wrcPlus', 'hr', 'rbi', 'sb', 'war'];
export const DEFAULT_PITCHING = ['g', 'gs', 'w', 'l', 'sv', 'ip', 'era', 'eraPlus', 'fip', 'whip', 'k9', 'war'];

const STORAGE_KEY = (group: StatGroup) => `ootp-fo:columns:${group}`;

export function loadColumns(group: StatGroup): string[] {
  const fallback = group === 'batting' ? DEFAULT_BATTING : DEFAULT_PITCHING;
  try {
    const raw = localStorage.getItem(STORAGE_KEY(group));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as string[];
    const valid = new Set(statsFor(group).map((s) => s.key));
    // Drop keys from older versions so a renamed stat can't wedge the table
    const cleaned = parsed.filter((k) => valid.has(k));
    return cleaned.length ? cleaned : fallback;
  } catch {
    return fallback;
  }
}

export function saveColumns(group: StatGroup, keys: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY(group), JSON.stringify(keys));
  } catch {
    // storage unavailable (private mode) — selection just won't persist
  }
}

/** Fielding is offered in both groups — everyone on the field has a glove. */
export const statsFor = (group: StatGroup): StatDef[] =>
  group === 'batting'
    ? [...BATTING_STATS, ...CONTACT_STATS, ...FIELDING_STATS]
    : [...PITCHING_STATS, ...FIELDING_STATS];

const CONTACT_KEYS = new Set(CONTACT_STATS.map((c) => c.key));
/** Contact lives in its own block on the payload, like fielding. */
export const isContactStat = (key: string): boolean => CONTACT_KEYS.has(key);

const FIELDING_KEYS = new Set(FIELDING_STATS.map((f) => f.key));
/** Fielding lives in its own block on the payload, not with the hitting line. */
export const isFieldingStat = (key: string): boolean => FIELDING_KEYS.has(key);

export const findStat = (group: StatGroup, key: string): StatDef | undefined =>
  statsFor(group).find((s) => s.key === key);

/** Formats a value for display. `raw` is the whole stat block, for context-aware cases. */
export function formatStat(
  def: StatDef,
  value: number | null | undefined,
  raw?: Record<string, number | null>
): string {
  // A pitcher with a 0.00 ERA has a mathematically infinite ERA+
  if (def.key === 'eraPlus' && value === null && raw && raw.era === 0 && (raw.ip ?? 0) > 0) return '∞';
  if (value === null || value === undefined) return '';
  switch (def.format) {
    case 'avg3':
      return value.toFixed(3).replace(/^0\./, '.').replace(/^-0\./, '-.');
    case 'dec1':
      return value.toFixed(1);
    case 'dec2':
      return value.toFixed(2);
    case 'pct':
      return `${value.toFixed(1)}%`;
    case 'plus':
    case 'int':
    default:
      return String(Math.round(value));
  }
}

/**
 * Subtle colour for plus stats so 100 reads as the midpoint at a glance.
 *
 * Mixed from the theme's own good and bad rather than built here. It used to
 * return a fixed hsl() at 62-70% lightness, which is right on a dark table and
 * close to unreadable on a white one — a pale neon green on near-white, as a
 * reader in light mode reported. The theme already flips those two colours for
 * light mode and the contrast check already covers them, so borrowing them
 * means this cannot drift away from either again.
 *
 * The mix runs toward the body text, so a number barely off average reads
 * almost as ordinary text and only a genuine outlier takes the full colour.
 * That is the same effect the lightness ramp was reaching for, expressed in a
 * way that survives a change of background.
 */
export function plusColor(def: StatDef, value: number | null | undefined): string | undefined {
  if (def.format !== 'plus' || value === null || value === undefined) return undefined;
  const delta = Math.max(-60, Math.min(60, value - 100));
  const strength = Math.abs(delta) / 60;
  if (strength < 0.12) return undefined;
  const end = delta >= 0 ? 'var(--good)' : 'var(--bad)';
  const share = Math.round(45 + strength * 55);
  return `color-mix(in srgb, ${end} ${share}%, var(--text))`;
}
