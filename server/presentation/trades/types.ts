/**
 * Trades on the Mac (SWIFTUI_REBUILD.md section 9, N12 Track C; D-073): the Trade Desk, one payload for the desk (the
 * offers in the inbox, the staff's trade talk, the league's fits, whether the AI desk is on) and one for a deal being
 * built (both sides, each player's contract value and the difference between the sides, drawn as a range around zero).
 *
 * Every figure is Player Value's as the analyser (`server/trade.ts`) reads it; these types only carry it in words (D-052:
 * a band with its basis, never a verdict or a single score; D-001: the staff's view, never "accept" or "decline"). The
 * club's value of a win (playoff odds) is not here: it belongs with the standings (D-060). The AI's answer is the AI's
 * own words about the analyser's figures, marked as such; it decides nothing and the desk works fully without it.
 */
import type { Cell, Claim } from '../../contract/presentation.js';
import type { Integer } from '../../contract/primitives.js';
import type { MlbPlayer, MlbTable } from '../majorLeague/types.js';

/** What every Trade Desk payload carries: its build and the one line saying who prepared it and when. */
export interface TradesViewHead {
  orgId: Integer;
  importStamp: string | null;
  reportStamp: string;
  title: Cell;
  /** "Prepared by Mike Hazen, general manager · Through May 5, 2040". */
  byline: Cell;
}

/** A deal as the desk asks for it: who the club would send and who it would receive, by player id. */
export interface TradeDeal {
  sent: Integer[];
  received: Integer[];
}

/** A player as a card names him: who (openable, draggable onto the builder) and his position, age and club in a line. */
export interface TradeDeskPlayer {
  player: MlbPlayer;
  line: Cell;
}

/** An offer sitting in the OOTP inbox, with the analyser's reading of it, and the deal that loads it into the builder. */
export interface TradeOffer {
  id: string;
  date: Cell;
  from: Cell;
  subject: Cell;
  theySend: TradeDeskPlayer[];
  weSend: TradeDeskPlayer[];
  /** What comes in less what goes out, most likely and what it could be; the method in its basis. Never a verdict. */
  reading: Claim;
  deal: TradeDeal;
  /** "Review This Offer". */
  review: Cell;
}

/** A target the staff raised in the inbox: the player, his contract value at a glance, his control and pay. */
export interface TradeTalkTarget {
  id: string;
  date: Cell;
  subject: Cell;
  club: Cell;
  player: TradeDeskPlayer;
  value: Claim;
  control: Cell;
  /** The player alone on the side the club would receive: what he costs is the GM's to fill in. */
  deal: TradeDeal;
  review: Cell;
}

/** One of a fit's lines: a position where one club is thin, and the other club's players who would add more there. */
export interface TradeFitLine {
  text: Cell;
  players: Array<{ player: TradeDeskPlayer; wins: Cell }>;
}

/** A club with matches either way: what they need that we have, and what we need that they have. */
export interface TradeFitClub {
  teamId: Integer;
  club: Cell;
  /** "2 matches". */
  matches: Cell;
  theyNeed: TradeFitLine[];
  theyOffer: TradeFitLine[];
}

/** The league's fits for the club: its weakest spots by expected wins, then each club with a match. */
export interface TradeFitsView {
  /** "Your weakest spots by expected wins: SS (…), C (…)", the method in its basis. */
  weakest: Claim | null;
  clubs: TradeFitClub[];
  /** Why there is nothing to list (no club with a match, or not a major-league club); null when clubs are listed. */
  empty: Cell | null;
}

/** Whether the AI desk is on, who answers, and what the button and the reply field say. */
export interface TradeDeskAI {
  available: boolean;
  /** Who answers: "Sam Ryan · assistant general manager". */
  voice: Cell;
  /** "Ask Sam Ryan". */
  ask: Cell;
  /** "Ask Sam a follow-up". */
  followUp: Cell;
  /** With AI off: one plain line saying so, and that everything else works; the details in its basis. Null when on. */
  off: Claim | null;
  /** What the AI's answers are and are not (it explains the analysis; it decides nothing). */
  note: Claim;
}

/** The Trade Desk: the builder's words, the offers, the trade talk, the league's fits and the AI desk's state. */
export interface TradeDeskView extends TradesViewHead {
  /** How to read the desk, in one line; the full explanation in its basis. */
  lede: Claim;
  /** The builder's sides: "Diamondbacks send", "Diamondbacks receive". */
  sides: { sent: Cell; received: Cell };
  /** What the builder says with nobody on it. */
  emptyDeal: Cell;
  offers: TradeOffer[];
  /** How the offers are read (the sides are worked out from who each player plays for now). */
  offersNote: Claim;
  talk: TradeTalkTarget[];
  talkNote: Claim;
  fits: TradeFitsView;
  ai: TradeDeskAI;
  /** How current the export is, when there is something to say; null when it is current. */
  freshness: Claim | null;
}

// ── a deal, weighed ─────────────────────────────────────────────────────────

/** One player in a deal: who, his contract value (most likely, its range), his control, production and our view. */
export interface TradeDealRow {
  player: MlbPlayer;
  /** "SS · 27 · ARI". */
  line: Cell;
  /** "Listed" when his own club has put him on the trading block; null otherwise. */
  listed: Cell | null;
  /** His contract value, most likely ("$4.2M"), with its range as the value and the method in its basis; or "Not valued". */
  value: Claim;
  /** "could be $1.0M to $9.4M", or why he isn't valued, with its reason in the hint. */
  range: Cell;
  control: Claim;
  production: Claim;
  /** The value of keeping him, shown for context; null when not known. */
  keeping: Claim | null;
  /** "2027–2028 if kept"; null when every season is certain. */
  ifKept: Cell | null;
  /** Our view of him through the club's philosophy, each lean named; null when the philosophy doesn't lean on him. */
  ours: Claim | null;
}

/** One side of a deal: its title, its players, and what they add up to. */
export interface TradeDealSide {
  /** `sent` or `received`. */
  id: string;
  title: Cell;
  rows: TradeDealRow[];
  /** "Together $8.1M · could be …", or that no one on the side could be valued yet; null with no players. */
  total: Claim | null;
  /** "Leaves out X (not valued yet)."; null when nobody is left out. */
  leavesOut: Cell | null;
  /** "No players yet."; null when there are players. */
  empty: Cell | null;
}

/**
 * The difference drawn as a range around zero (`src/tradeDifferenceGeometry.ts`): the range, the most likely reading (a
 * point, or a stretch where it depends on an open season) and the scale, symmetric about zero so a distance left reads
 * as one right. Values in the deal's unit (dollars or wins).
 */
export interface TradeRangeChart {
  unit: string;
  low: number;
  high: number;
  likelyLow: number;
  likelyHigh: number;
  /** The scale's ends, symmetric about zero, with a little air past the furthest figure. */
  scaleLow: number;
  scaleHigh: number;
  /** "even", at zero. */
  zero: Cell;
  /** "← More going out" and "More coming in →", under the ends. */
  left: Cell;
  right: Cell;
  /** The chart in one sentence, for VoiceOver and the chart's description. */
  summary: Cell;
  /** Each end and the most likely in words, for the chart's description: lowest, most likely, highest. */
  marks: Cell[];
}

/** The difference between the sides: what comes in less what goes out, with its parts. */
export interface TradeDifferenceView {
  title: Cell;
  /** "Most likely +$3.2M · could be −$4.0M to +$11.5M", the method in its basis; or "Not a number yet: …". */
  headline: Claim;
  chart: TradeRangeChart | null;
  /** "Leaves out X (his contract terms aren't in the export)."; null when nobody is. */
  leavesOut: Cell | null;
  /** "Shown in wins: dollars aren't known for everyone in this deal."; null in dollars. */
  inWins: Claim | null;
  /** What makes up the difference: each player's part, going out reversed. */
  parts: MlbTable | null;
  /** How the parts add up, in a few plain lines (the full method in the headline's basis). */
  partsNotes: Cell[];
}

/** A deal weighed: both sides, the difference, our view, the salary moving. */
export interface TradeAnalysisView extends TradesViewHead {
  deal: TradeDeal;
  sides: TradeDealSide[];
  /** What the builder says while the deal can't be weighed (a side is empty); null once it is. */
  status: Cell | null;
  difference: TradeDifferenceView | null;
  /** The same figures through the club's philosophy, or that it doesn't lean on these players; null with a side empty. */
  ourView: Claim | null;
  /** Salary this season going out and coming in; null with a side empty. */
  salary: Claim | null;
  freshness: Claim | null;
}

// ── the AI desk (optional; D-001) ────────────────────────────────────────────

/** One turn of the conversation about the deal on the builder, as the app holds it. */
export interface TradeTurn {
  /** `user` or `assistant`. */
  role: string;
  content: string;
}

/** What the app asks the AI desk: the deal, the conversation so far, and the GM's question (none for the first read). */
export interface TradeAsk {
  sent: Integer[];
  received: Integer[];
  thread: TradeTurn[];
  message?: string;
}

/** One paragraph of the AI's answer: a heading or a line of text, as written. */
export interface TradeAnswerLine {
  heading: boolean;
  text: string;
}

/** The AI desk's answer: its own words about the analyser's figures, who said it, and a notice if another model answered. */
export interface TradeAnswer {
  voice: Cell;
  /** The answer as written, markdown markers taken out, in paragraphs. */
  lines: TradeAnswerLine[];
  /** The raw answer, for the conversation the app sends back with the next question. */
  content: string;
  /** "Answered by … because … couldn't be used"; null when the chosen model answered. */
  notice: Cell | null;
  /** That this is the AI's explanation of the analysis above, never a decision, with what it was given. */
  about: Claim;
}
