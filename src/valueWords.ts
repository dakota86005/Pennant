import type { ControlEnd, FreshnessCue, SurplusTotal } from './api';
import { costMoney } from './costBand';
import { formatWins } from './productionConeGeometry';

/**
 * Plain words for Player Value's figures where a page shows them compactly (Player Value phase 6a: the card's header
 * and the Contracts page). The same words the card's Value section uses ("Most likely", "could be"), at the pages'
 * precision (`costBand.ts`). Nothing is computed here: every figure is Player Value's, as served.
 */

/** Signed money at the pages' precision: "$28.0M", "−$9.0M", "$780K". */
export const signedMoney = (v: number): string => (v < 0 ? `−${costMoney(-v)}` : costMoney(v));

/** "3.1 wins", "<0.1 wins". */
export const winsText = (v: number): string => `${formatWins(v)} wins`;

/** "$A to $B", or one figure where the edges meet. */
export const rangeText = (low: number, high: number, fmt: (v: number) => string): string =>
  (low === high ? fmt(low) : `${fmt(low)} to ${fmt(high)}`);

/** "2026–2030", or one season. */
export const seasonsText = (from: number | null, to: number | null): string =>
  (from === null ? '' : from === to || to === null ? `${from}` : `${from}–${to}`);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "May 16, 2026" from an ISO date (or OOTP's unpadded one); the text as given when it is not a date. */
export function gameDateWords(date: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : date;
}

/** A total as a compact page shows it: the figure, the range it could be, and whether it is known at all. */
export interface TotalWords {
  known: boolean;
  /** "$28.0M", or "$20.0M to $26.0M" where no single most likely figure is chosen; "not valued" where unknown. */
  figure: string;
  /** Whether `figure` is the most likely one (a single figure), so the page can lead it with "Most likely". */
  mostLikely: boolean;
  /** "−$9.0M to $100M" where known. */
  couldBe: string | null;
  /** The seasons it covers: "2026–2030". */
  seasons: string;
  /** The reason it is not valued, for the hover. */
  reason: string | null;
  /** A value for ordering: the most likely figure, or the middle of the range of most likely figures; null where unknown. */
  order: number | null;
}

export function totalWords(total: SurplusTotal | null | undefined, unit: 'dollars' | 'wins', fallbackReason: string | null = null): TotalWords {
  const fmt = unit === 'dollars' ? signedMoney : winsText;
  if (!total || total.status !== 'known' || total.low === null || total.high === null) {
    return {
      known: false, figure: 'not valued', mostLikely: false, couldBe: null,
      seasons: total ? seasonsText(total.from, total.to) : '',
      reason: total?.reason ?? fallbackReason ?? 'Not established.', order: null,
    };
  }
  const couldBe = rangeText(total.low, total.high, fmt);
  if (total.central !== null) {
    return { known: true, figure: fmt(total.central), mostLikely: true, couldBe, seasons: seasonsText(total.from, total.to), reason: null, order: total.central };
  }
  const r = total.centralRange ?? { low: total.low, high: total.high };
  return {
    known: true, figure: rangeText(r.low, r.high, fmt), mostLikely: false, couldBe, seasons: seasonsText(total.from, total.to),
    reason: null, order: (r.low + r.high) / 2,
  };
}

/** When his control ends, in a phrase: "Free agent after 2028", "Free agent after 2026 or 2027", "Controlled past 2032". */
export function controlEndWords(end: ControlEnd): { text: string; short: string; known: boolean } {
  if (end.high === null && end.laterUnknown && end.low !== null) return { text: `Free agent after ${end.low} at the earliest`, short: `${end.low} or later`, known: true };
  if (end.high === null) return { text: 'End of control not known', short: 'not known', known: false };
  if (end.pastHorizon) {
    const out = end.optOutBefore !== null ? `, unless he opts out before ${end.optOutBefore}` : '';
    return { text: `Controlled past ${end.high}${out}`, short: `past ${end.high}`, known: true };
  }
  if (end.low === null || end.low === end.high) return { text: `Free agent after ${end.high}`, short: `${end.high}`, known: true };
  if (end.high - end.low === 1) return { text: `Free agent after ${end.low} or ${end.high}`, short: `${end.low} or ${end.high}`, known: true };
  return { text: `Free agent after ${end.low} at the earliest, ${end.high} at the latest`, short: `${end.low}–${end.high}`, known: true };
}

/** The freshness cue's visible words: "As of May 16, 2026", then the warning where there is one. */
export function freshnessWords(cue: FreshnessCue): { asOf: string | null; warning: string | null; tone: 'ok' | 'warn' | 'bad'; tip: string } {
  const tip = [cue.detail, ...cue.limitations].filter(Boolean).join(' ');
  return {
    asOf: cue.asOf ? `As of ${gameDateWords(cue.asOf)}` : null,
    warning: cue.line,
    tone: cue.state === 'behind' || cue.state === 'unavailable' ? 'bad' : cue.state === 'unverified' ? 'warn' : 'ok',
    tip,
  };
}
