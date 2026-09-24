/**
 * Player Value, the club's value of a win (phase 5b, PLAYER_VALUE.md Part 4.5; D-052 "two prices of a win").
 *
 * Pure. The league's market price of a win is what a win costs to buy; this is the other price: what one more win is
 * worth to THIS club now, from its competitive position. A club fact from the standings, never a preference: read on the deadline read's odds
 * model (`posture.ts`, the entry point hands the model's readings over), the same for every organization that reads
 * it. It is in playoff odds, never dollars: the export has one season of playoff revenue, so the link from odds
 * to money cannot be fitted (Q-6). It is context beside the value, never part of it: it enters neither the neutral
 * surplus nor our view.
 *
 * Unknown stays unknown (D-018): before a game is played, without standings, or where the club's place in the race is not
 * established, it is unknown with the reason, never the deadline read's default of a level race. With no games left a win
 * can no longer be added; where the place is beyond reach a win moves nothing.
 */

import type { CalibrationStamp } from './calibration.js';
import { WIN_CURVE_CALIBRATION, WIN_VALUE_POLICY } from './playerValueCalibration.js';

/** The odds model's readings for the club, as the entry point hands them over. */
export interface WinValueInput {
  teamId: number;
  club: string | null;
  /** Null where the odds model cannot be read, with the reason. */
  reading: {
    w: number;
    l: number;
    gamesPlayed: number;
    gamesLeft: number;
    rs: number;
    ra: number;
    talent: number;
    rival: number;
    /** Games to close to the place (negative: a cushion). */
    gap: number;
    gapRead: 'race' | 'no_race' | 'no_rival';
    /** Where the club stands, in words (the standings' own summary). */
    summary: string | null;
    route: 'division' | 'wildcard' | 'out' | null;
    /** How many wild cards the league gives out; null where not read. */
    wildCards: number | null;
    /** The chance now as the deadline read shows it (within 1%–99% while games are left). */
    shown: number;
    /** The model's chance with k more wins over the rest of the season (k from −fewer to +more), unbounded. */
    curve: Array<{ wins: number; odds: number }>;
  } | null;
  reason: string | null;
}

export interface ClubWinValue {
  teamId: number;
  club: string | null;
  /** `known`; `decided` (the place is beyond reach either way, or nobody is outside it: a win moves nothing); `no_games_left`; `unknown`. */
  status: 'known' | 'decided' | 'no_games_left' | 'unknown';
  reason: string | null;
  unit: 'playoff odds';
  /** The chance of the postseason now, as the deadline read shows it; null where unknown. */
  odds: number | null;
  /** How much one more win adds to that chance (a share, 0.032 = 3.2 points); null where unknown or not applicable. */
  perWin: number | null;
  /** The chance with k more (or fewer) wins over the rest of the season. */
  curve: Array<{ wins: number; odds: number }>;
  gamesLeft: number | null;
  gamesPlayed: number | null;
  /** One plain sentence. */
  text: string;
  basis: string[];
  stamp: CalibrationStamp;
}

const pct = (v: number): string => {
  const x = v * 100;
  if (x > 0 && x < 0.1) return '<0.1%';
  if (x < 100 && x > 99.9) return '>99.9%';
  return `${x >= 10 || Number.isInteger(Math.round(x * 10) / 10) ? Math.round(x) : x.toFixed(1)}%`;
};
const points = (v: number): string => {
  const x = v * 100;
  return x > 0 && x < 0.05 ? 'under 0.1' : x.toFixed(1);
};
const games = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(1)} game${n === 1 ? '' : 's'}`;

const CONTEXT = 'Context beside the value, never part of it: it enters neither the contract value nor the value of keeping him, and it is the same for every organization that reads it: a fact of the standings, never a preference.';
const NO_DOLLARS = 'In playoff odds, never converted to dollars: the export cannot yet link a club\'s odds to its revenue (Q-6).';

/** The club's value of a win now, and its curve over the rest of the season, from the odds model's readings. */
export function winValueOf(input: WinValueInput): ClubWinValue {
  const { teamId, club, reading: r } = input;
  // "the Arizona Diamondbacks'", "the Boston Red Sox's", "this club's"
  const whose = club ? `the ${club}${club.endsWith('s') ? "'" : "'s"}` : "this club's";
  const Whose = `${whose.charAt(0).toUpperCase()}${whose.slice(1)}`;
  const base = { teamId, club, unit: 'playoff odds' as const, stamp: WIN_CURVE_CALIBRATION };
  const unknown = (reason: string, status: ClubWinValue['status'] = 'unknown'): ClubWinValue => ({
    ...base, status, reason, odds: null, perWin: null, curve: [], gamesLeft: r?.gamesLeft ?? null, gamesPlayed: r?.gamesPlayed ?? null,
    text: `${Whose} value of a win now is not known: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`,
    basis: [CONTEXT, NO_DOLLARS],
  });
  if (!r) return unknown(input.reason ?? 'The odds model cannot be read for this club.');
  if (r.gapRead === 'no_race') {
    return unknown("Where the club stands in the race is not established (it is not in its conference's standings), so its odds are not read.");
  }

  const basis = [
    `The deadline read's odds model: ${r.w}-${r.l} with ${r.rs} runs scored and ${r.ra} allowed, a pace of ${(r.talent * 162).toFixed(0)} wins by the runs (Pythagorean)${r.summary ? `; ${r.summary.replace(/\.$/, '')}` : ''}.`,
    `The club holding the place (or the one chasing it) is read as a .${Math.round(r.rival * 1000)} club, and the difference between the two over the ${games(r.gamesLeft)} left is read as normal.`,
    'One more win is a loss turned into a win: the gap to the place closes by a game, or a cushion grows by one. The curve reads fewer and more wins over the rest of the season on the same model.',
    ...(r.route === 'division' && (r.wildCards ?? 0) > 0 ? ['A division leader is read against its own division only: the wild card, a second way in, is not in the model, so its odds read low.'] : []),
    "The value per win is read on the model itself, before the deadline read's 1%–99% display bounds.",
    CONTEXT,
    NO_DOLLARS,
  ];

  if (r.gamesLeft === 0) {
    return { ...unknown('The regular season has no games left: a win can no longer be added.', 'no_games_left'), odds: r.shown, basis };
  }
  const decided = (reason: string): ClubWinValue => ({
    ...base, status: 'decided', reason, odds: r.shown, perWin: 0, curve: r.curve, gamesLeft: r.gamesLeft, gamesPlayed: r.gamesPlayed,
    text: `A win right now does not move ${whose} playoff odds: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`,
    basis,
  });
  if (r.gapRead === 'no_rival') return decided('Nobody is outside its place in the standings, so a win cannot change whether it holds it.');
  if (r.gap < -r.gamesLeft) return decided(`It is ${games(-r.gap)} clear with ${games(r.gamesLeft)} to play: its place is beyond reach (by the model's arithmetic, both clubs with its games left).`);
  if (r.gap > r.gamesLeft) return decided(`It is ${games(r.gap)} behind the place with ${games(r.gamesLeft)} to play: the place is out of reach (by the model's arithmetic, both clubs with its games left).`);

  const now = r.curve.find((c) => c.wins === 0);
  const one = r.curve.find((c) => c.wins === 1);
  if (!now || !one) return unknown('The odds model gave no curve for this club.');
  const perWin = one.odds - now.odds;
  return {
    ...base, status: 'known', reason: null, odds: r.shown, perWin, curve: r.curve, gamesLeft: r.gamesLeft, gamesPlayed: r.gamesPlayed,
    text: `One more win moves ${whose} playoff odds by about ${points(perWin)} points (from ${pct(now.odds)} to ${pct(one.odds)} on the model), with ${games(r.gamesLeft)} left.`,
    basis,
  };
}

/** The wins the curve reads, from `fewer` fewer to `more` more (policy). */
export function curveWins(): number[] {
  const { fewer, more } = WIN_VALUE_POLICY.curve;
  return Array.from({ length: fewer + more + 1 }, (_, i) => i - fewer);
}
