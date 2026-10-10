/**
 * A served timestamp (an export's or an import's time, ISO 8601) in words, the one way the server writes one for the
 * Mac app, so every time it shows reads the same: the date and time in US English, in this Mac's time zone (the server
 * runs on the GM's own Mac). The ISO string is served beside it for sorting. Game dates are not timestamps: they go
 * through `parseGameDate` and `gameDateWords`.
 */
const FORMAT = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export function timestampWords(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : FORMAT.format(at);
}

const CLOCK = new Intl.DateTimeFormat('en-US', { timeStyle: 'short' });
const DAY = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

/** The time of day alone ("3:04 PM"), for a message in a conversation (N13); null when not a time. */
export function clockWords(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : CLOCK.format(at);
}

/** The day alone ("Oct 10, 2026"), for a conversation's day dividers (N13); null when not a time. */
export function dayWords(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : DAY.format(at);
}
