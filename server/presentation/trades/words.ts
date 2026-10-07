/**
 * The Trade Desk's words (N12 Track C, D-073): what the React Trade Center wrote on the client (`src/pages/TradeCenter.tsx`,
 * `src/TradeAnalysis.tsx`, `src/tradeDifferenceGeometry.ts`), moved to the server so the Mac app writes none of it
 * (D-056). The React page keeps its own copy until the cutover (D-066's precedent). Nothing here computes a figure about
 * a player or a deal: every number is Player Value's as the analyser serves it. The method words stay in the bases.
 */
import type { TradeFigure, TradeUnit } from '../../playerValue.js';
import { CANT_TELL_APART } from '../player/compare.js';
import { money, signedTenths } from '../player/words.js';

export const TRADES = 'trades' as const;
export const PLAYER_VALUE = 'Player Value';
export const THE_INBOX = 'The OOTP inbox';

export type Fmt = (v: number) => string;

/** Money or wins, as the analyser prints them: "$12.3M", "−$4.0M", "1.2 wins". */
export const amountFor = (unit: TradeUnit | null): Fmt =>
  (unit === 'wins' ? (v) => `${signedTenths(v)} wins` : (v) => (v < 0 ? `−${money(-v)}` : money(v)));

/** A difference always carries its sign: "+$12.3M", "−$4.0M". */
export const signed = (fmt: Fmt): Fmt => (v) => (v > 0 ? `+${fmt(v)}` : fmt(v));

/** The most likely reading: a figure, or a stretch where it depends on an open season. */
export const likelyText = (f: TradeFigure, fmt: Fmt): string =>
  (f.central !== null ? fmt(f.central) : f.centralRange ? `${fmt(f.centralRange.low)} to ${fmt(f.centralRange.high)}` : `${fmt(f.low)} to ${fmt(f.high)}`);

/** Whether a difference's range holds zero: then it can't be told apart from an even deal, whatever its most likely. */
export const holdsEven = (f: { low: number; high: number }): boolean => f.low <= 0 && f.high >= 0;

/**
 * A difference whose range holds zero, said first in Compare's words (D-070; review M3): "Can't tell apart from an even
 * deal: could be −5.9 to +2.2 wins (most likely −1.3 wins)". `lead` is lower-cased after a label ("Our view (Club): …").
 */
export function evenDealText(f: TradeFigure, fmt: Fmt, lead = true): string {
  const said = `${CANT_TELL_APART} from an even deal: could be ${spanText(f, fmt)} (most likely ${likelyText(f, fmt)}` +
    `${f.central === null ? ' depending on how an open season goes' : ''})`;
  return lead ? said : said.charAt(0).toLowerCase() + said.slice(1);
}

/** "$A to $B", or one figure where the ends meet. */
export const spanText = (f: { low: number; high: number }, fmt: Fmt): string => (f.low === f.high ? fmt(f.low) : `${fmt(f.low)} to ${fmt(f.high)}`);

/** "SS · 27 · ARI": what a row says about who he is, the empty parts left out. */
export const metaLine = (parts: ReadonlyArray<string | number | null | undefined>): string =>
  parts.filter((x) => x !== null && x !== undefined && String(x).trim() !== '' && x !== '?').map(String).join(' · ');

/** A club's name read as its players' side: "Diamondbacks send" (a club named for a place keeps its whole name). */
export const sideTitle = (club: string, verb: 'send' | 'receive'): string => `${club} ${verb}`;

/** "1 match", "3 matches". */
export const matchesText = (n: number): string => `${n} ${n === 1 ? 'match' : 'matches'}`;

/** "1.2 wins" for a fit's expected wins. */
export const fitWins = (v: number): string => `${signedTenths(v)} wins`;

// ── the hovers, in the GM's words (`src/TradeAnalysis.tsx`, `src/pages/TradeCenter.tsx`) ───────────────────────

export const TIP_DIFFERENCE =
  "What you'd receive less what you'd send, each player at his contract value: his projected wins priced at what a win " +
  "costs on this league's market, minus the salary still to be paid, later seasons counting a little less. A trade moves " +
  "a player's salary with him, so this is the view a deal is read on. It isn't a verdict: it doesn't see either club's " +
  "roster, needs or money, and the decision is yours. The range is wide because each player's is; the players are added " +
  "as if each one's ups and downs were separate from the others', so they aren't all at their best or worst at once.";
export const TIP_BAR =
  'Zero is an even deal. The shaded stretch is the range the difference could be; the marker is the most likely figure ' +
  '(a darker stretch where it depends on an option or on whether a player stays). Right of zero, more value comes in than ' +
  'goes out; left of zero, the reverse. It measures contract value only: not fit, need, or what the other club wants.';
export const TIP_OUR_VIEW_DEAL =
  "The same figures read through your club's philosophy: it can weigh near seasons against far ones, read the ranges more " +
  'cautiously, and weigh salary, club control and guaranteed money more or less. It never changes the figures above, and ' +
  'each lean is named on its player.';
export const TIP_EXPECTED =
  'Projected wins above replacement for the rest of this season (or the whole of it before it starts), most likely.';
export const TIP_SALARY = "Salary this season as the export states it. A salary the export doesn't state isn't counted as zero.";
export const TIP_TOGETHER =
  "The players on this side added up at their contract value: the most likely figures summed, and a range that treats " +
  "each player's ups and downs as separate from the others', so they aren't all at their best or worst at once. A player " +
  'whose value isn\'t known is left out and named, never counted as zero.';
export const TIP_OFFER =
  "The same reading the builder gives: what you'd receive less what you'd send, each player at his contract value. The " +
  "sides are worked out from who each player plays for now, since the message doesn't store them. It isn't a verdict.";
export const TIP_FITS =
  "Expected wins this season (the part still to be played, most likely), from each player's projection. A match is a player " +
  "who isn't his club's starter at a position yet is expected to add more wins than the other club's best there. Players " +
  "whose production isn't established are left out. A lead to look into, not a verdict: the ranges behind these figures are wide.";
export const TIP_KEEPING_ROW =
  "Keeping him compared with replacing him with a minimum-salary player: only costs you'd avoid by moving on count. In a " +
  'trade his salary goes with him, so the deal is read on contract value; this is shown for context.';

/** The model writes markdown; only its heading and bold markers ever show up, and are taken out (`renderAnswer`). */
export function answerLines(text: string): Array<{ heading: boolean; text: string }> {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => {
      const heading = /^#{1,6}\s+/.test(line);
      return { heading, text: line.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '').trim() };
    })
    .filter((l) => l.text.length > 0);
}

/** The scale of the difference's chart (`src/tradeDifferenceGeometry.ts`): symmetric about zero, a little air past the furthest figure. */
export function scaleOf(f: TradeFigure): { low: number; high: number; likelyLow: number; likelyHigh: number } {
  const likely = f.central !== null ? { low: f.central, high: f.central } : f.centralRange ?? { low: f.low, high: f.high };
  const reach = Math.max(0, ...[f.low, f.high, likely.low, likely.high].filter((v) => Number.isFinite(v)).map((v) => Math.abs(v)));
  const half = reach > 0 ? reach * 1.12 : 1;
  return { low: -half, high: half, likelyLow: likely.low, likelyHigh: likely.high };
}
