/**
 * Player Value phase 6b: a trade read on Player Value (PLAYER_VALUE.md Part 8, consumer 3; owner Q-8).
 *
 * Pure. It is handed each player's neutral valuation exactly as every read serves it (5a's surplus) and, where the caller
 * has one, "our view" of him (5b's lens, computed by the caller at read time); it returns both sides' decompositions side by
 * side, each side's total, and the difference between the sides (what comes in less what goes out) as a band with its parts.
 * It never recomputes, narrows or re-reads a player's figures, never names philosophy (our view arrives computed) and never
 * reads the club's value of a win; it opens no table and says no verdict (D-052: describes, never authorizes).
 *
 *   the trade view   a trade moves each player's remaining salary with him, so the sides are read on contract value (the
 *                    contract surplus: what his contract is worth to whoever holds it, Part 5). The value of keeping him is
 *                    shown per player, never summed: its guaranteed money cancels only for the club that already owes it.
 *   combining        the owner's Payroll rule, extended (`TRADE_COMBINATION_POLICY`): around the sum of the players' most
 *                    likely readings, each player's own distance from his on each side is combined as independent across
 *                    players (root sum of squares); an open season (an option's ways, a status left open, whether he stays)
 *                    keeps his most likely a range and stays at its edges, added. A player going out enters the difference
 *                    reversed. The every-player-at-his-edge sum is kept beside it, and one player's side is his own band.
 *   unknown          a player whose value is not known is listed with his reason and left out of the sums, which name him;
 *                    a side with nothing valued has no total and the difference is not a number, never a zero (D-018).
 *   wins             a deal with a player valued in wins only (a league without finances) is read in wins throughout.
 */

import type { CalibrationStamp } from './calibration.js';
import { TRADE_COMBINATION_POLICY, TRADE_COMBINATION_POLICY_CALIBRATION } from './playerValueCalibration.js';
import type { ControlSeason, ControlStatus, ControlTimeline } from './playerValueControl.js';
import type { LensFigure, OurView } from './playerValueLens.js';
import type { PlayerProduction, WinsBand } from './playerValueProduction.js';
import type { PlayerSurplus, SurplusSeason, SurplusTotal } from './playerValueSurplus.js';

export type TradeUnit = 'dollars' | 'wins';
export type TradeSideName = 'sent' | 'received';

/** A figure as a trade shows it: its range, and its most likely reading (a central, or the range of centrals where a season is open). */
export interface TradeFigure {
  low: number;
  central: number | null;
  high: number;
  centralRange: { low: number; high: number } | null;
}

/** One player handed to the trade reading: his neutral valuation as served (null: no such active player) and, optionally, our view of him. */
export interface TradeEntryInput {
  playerId: number;
  surplus: PlayerSurplus | null;
  ourView?: OurView | null;
}

/** Our view of one player in a trade: the lens's figures and its named leans, as the lens served them. */
export interface TradeOurs {
  leaning: boolean;
  contract: TradeFigure | null;
  keeping: TradeFigure | null;
  leans: Array<{ short: string; text: string; by: { low: number; high: number } | null }>;
  notes: Array<{ short: string; text: string }>;
}

export interface TradePlayerValue {
  playerId: number;
  status: PlayerSurplus['status'] | 'not_found';
  /** In the side's sum and the difference. */
  counted: boolean;
  /** Contract value in the deal's unit (in wins: his wins over a replacement's), as served; null where not known. */
  contract: TradeFigure | null;
  /** The value of keeping him, as served (dollars only); shown, never summed. */
  keeping: TradeFigure | null;
  seasons: { from: number; to: number } | null;
  /** Seasons counted only if he is held (he may leave, or the player decides). */
  ifHeld: number[];
  /** What the most likely reading depends on where it is a range ("the 2031 option"). */
  dependsOn: string | null;
  /** One short sentence where he is not counted. */
  notCounted: string | null;
  /** The full reason, for a hover. */
  reason: string | null;
  ours: TradeOurs | null;
}

export interface TradeExcluded {
  playerId: number;
  side: TradeSideName;
  reason: string;
}

export interface TradeSideTotal {
  /** 'none': no player on the side could be valued (or the side is empty). */
  status: 'known' | 'none';
  counted: number;
  excluded: TradeExcluded[];
  /** Players combined as independent, what is not noise at its edges. */
  figure: TradeFigure | null;
  /** Every player at his low edge, summed, to every player at his high edge. */
  edges: { low: number; high: number } | null;
  text: string;
}

/** One player's part of the difference: his own figure, reversed for a player going out. */
export interface TradePart {
  playerId: number;
  side: TradeSideName;
  sign: 1 | -1;
  part: TradeFigure;
}

export interface TradeDifference {
  status: 'known' | 'unknown';
  reason: string | null;
  /** What comes in less what goes out. */
  figure: TradeFigure | null;
  edges: { low: number; high: number } | null;
  components: TradePart[];
  excluded: TradeExcluded[];
  text: string;
}

export interface TradeSide {
  players: TradePlayerValue[];
  total: TradeSideTotal;
}

export interface TradeValue {
  unit: TradeUnit | null;
  unitReason: string | null;
  sent: TradeSide;
  received: TradeSide;
  difference: TradeDifference;
  /** The same combination over our view of each counted player; null where a counted player has no view. */
  ourView: { leaning: boolean; sent: TradeSideTotal; received: TradeSideTotal; difference: TradeDifference } | null;
  basis: string[];
  stamp: CalibrationStamp;
}

// ── words ────────────────────────────────────────────────────────────────────

const money = (v: number): string => {
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  return `${sign}$${Math.round(a / 1_000)}K`;
};
const wins = (v: number): string => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} wins`;
const amountIn = (unit: TradeUnit) => (unit === 'dollars' ? money : wins);
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const years = (ys: number[]): string => {
  if (ys.length === 0) return '';
  const s = [...ys].sort((a, b) => a - b);
  return s.every((y, i) => i === 0 || y === s[i - 1] + 1) ? (s.length === 1 ? `${s[0]}` : `${s[0]}–${s[s.length - 1]}`) : s.join(', ');
};
const isAre = (ys: number[]) => (ys.length === 1 ? "isn't" : "aren't");

// ── combining ────────────────────────────────────────────────────────────────

const reversed = (f: TradeFigure): TradeFigure => ({
  low: -f.high,
  central: f.central === null ? null : -f.central,
  high: -f.low,
  centralRange: f.centralRange ? { low: -f.centralRange.high, high: -f.centralRange.low } : null,
});

/** The most likely reading's two edges: the central twice, or the range of centrals (else the band itself: nothing chosen). */
const likely = (f: TradeFigure): { low: number; high: number } =>
  (f.central !== null ? { low: f.central, high: f.central } : f.centralRange ?? { low: f.low, high: f.high });

/**
 * Players combined as independent (`TRADE_COMBINATION_POLICY`): around the sum of their most likely readings, each one's own
 * distance on each side in root sum of squares; an open season's range of readings added at its edges. A player with sign −1
 * enters reversed. It lies inside the every-player-at-his-edge sum and holds the most likely; one player is his own band.
 */
export function combineTradeFigures(entries: Array<{ figure: TradeFigure; sign: 1 | -1 }>): { figure: TradeFigure; edges: { low: number; high: number } } {
  const signed = entries.map((e) => (e.sign > 0 ? e.figure : reversed(e.figure)));
  if (signed.length === 1) return { figure: { ...signed[0] }, edges: { low: signed[0].low, high: signed[0].high } };
  let likelyLow = 0;
  let likelyHigh = 0;
  let lowSquares = 0;
  let highSquares = 0;
  let edgeLow = 0;
  let edgeHigh = 0;
  let single = true;
  for (const f of signed) {
    const m = likely(f);
    likelyLow += m.low;
    likelyHigh += m.high;
    lowSquares += Math.max(0, m.low - f.low) ** 2;
    highSquares += Math.max(0, f.high - m.high) ** 2;
    edgeLow += f.low;
    edgeHigh += f.high;
    if (f.central === null) single = false;
  }
  const figure: TradeFigure = {
    low: Math.max(edgeLow, likelyLow - Math.sqrt(lowSquares)),
    central: single ? likelyLow : null,
    high: Math.min(edgeHigh, likelyHigh + Math.sqrt(highSquares)),
    centralRange: single ? null : { low: likelyLow, high: likelyHigh },
  };
  return { figure, edges: { low: edgeLow, high: edgeHigh } };
}

// ── one player ───────────────────────────────────────────────────────────────

const figureOfTotal = (t: SurplusTotal): TradeFigure | null =>
  (t.status === 'known' && t.low !== null && t.high !== null ? { low: t.low, central: t.central, high: t.high, centralRange: t.centralRange } : null);

const figureOfLens = (f: LensFigure | null): TradeFigure | null =>
  (f ? { low: f.low, central: f.central, high: f.high, centralRange: f.centralRange } : null);

/** The short reason a total is not valued: which seasons lack his pay or his production (the card's words). */
function notValuedLine(s: PlayerSurplus, total: SurplusTotal): string {
  if (s.status === 'unknown') return "Not valued yet: his production isn't established.";
  if (total.missing.length === 0) return 'Not valued yet.';
  const seasons = s.seasons.filter((x) => total.missing.includes(x.season));
  const noWins = seasons.filter((x) => x.wins === null).map((x) => x.season);
  const noPay = seasons.filter((x) => x.wins !== null && x.cost === null).map((x) => x.season);
  const lastWins = s.seasons.filter((x) => x.wins !== null).map((x) => x.season).pop();
  const parts: string[] = [];
  if (noPay.length > 0) parts.push(`his pay for ${years(noPay)} isn't known`);
  if (noWins.length > 0) {
    parts.push(lastWins !== undefined && noWins.every((y) => y > lastWins)
      ? `his production is only projected through ${lastWins}`
      : `his production for ${years(noWins)} isn't established`);
  }
  const other = total.missing.filter((y) => !noWins.includes(y) && !noPay.includes(y));
  if (other.length > 0) parts.push(`${years(other)} ${isAre(other)} established`);
  return `Not valued yet: ${parts.join(', and ')}.`;
}

/** What a most likely reading that is a range depends on: an option, a status, or whether he stays. */
function dependsOnOf(seasons: SurplusSeason[]): string {
  const open = seasons.filter((s) => s.contract.status === 'known' && s.contract.band !== null && s.contract.band.central === null);
  if (open.length === 0) return 'how an open season goes';
  const inWords = (ys: number[]) => (ys.length <= 2 ? ys.join(' and ') : `${ys.slice(0, -1).join(', ')} and ${ys[ys.length - 1]}`);
  const options = open.filter((s) => /option|opt_out/.test(s.status)).map((s) => s.season);
  const statuses = open.filter((s) => !options.includes(s.season) && s.status === 'indeterminate').map((s) => s.season);
  const stays = open.filter((s) => !options.includes(s.season) && !statuses.includes(s.season)).map((s) => s.season);
  return [
    options.length > 0 ? `the ${inWords(options)} option${options.length > 1 ? 's' : ''}` : null,
    statuses.length > 0 ? `his status in ${inWords(statuses)}` : null,
    stays.length > 0 ? `whether he stays in ${inWords(stays)}` : null,
  ].filter(Boolean).join(' and ');
}

function oursOf(view: OurView | null | undefined, unit: TradeUnit): TradeOurs | null {
  if (!view) return null;
  const total = unit === 'dollars' ? view.contract : view.wins;
  return {
    leaning: view.leaning,
    contract: total.status === 'known' ? figureOfLens(total.ours) : null,
    keeping: unit === 'dollars' && view.retention.status === 'known' ? figureOfLens(view.retention.ours) : null,
    leans: view.leans.map((l) => ({ short: l.short, text: l.text, by: unit === 'dollars' ? l.by.contract : l.by.wins })),
    notes: view.notes.map((n) => ({ short: n.short, text: n.text })),
  };
}

function playerOf(e: TradeEntryInput, unit: TradeUnit | null): TradePlayerValue {
  const s = e.surplus;
  const none = (status: TradePlayerValue['status'], notCounted: string, reason: string): TradePlayerValue => ({
    playerId: e.playerId, status, counted: false, contract: null, keeping: null, seasons: null, ifHeld: [], dependsOn: null,
    notCounted, reason, ours: null,
  });
  if (!s) return none('not_found', "Not valued: he isn't an active player in the export.", 'The export has no active player with this id.');
  if (s.status === 'not_held') return none('not_held', 'Not valued: no club holds him.', s.reason ?? 'No club holds him, so there is no contract to value.');
  if (unit === null) return none(s.status, "Not valued yet: his production isn't established.", s.reason ?? 'Not established.');
  const total = unit === 'dollars' ? s.contract : s.wins;
  const figure = figureOfTotal(total);
  const keeping = unit === 'dollars' ? figureOfTotal(s.retention) : null;
  const heldSeasons = total.ifHeld ? s.seasons.filter((x) => x.contract.ifHeld || x.ifHeld).map((x) => x.season) : [];
  return {
    playerId: e.playerId,
    status: s.status,
    counted: figure !== null,
    contract: figure,
    keeping,
    seasons: total.from !== null && total.to !== null ? { from: total.from, to: total.to } : null,
    ifHeld: heldSeasons,
    dependsOn: figure && figure.central === null ? (unit === 'dollars' ? dependsOnOf(s.seasons) : 'how an open season goes') : null,
    notCounted: figure ? null : (unit === 'wins' && s.status === 'valued' && s.wins.status !== 'known' ? notValuedLine(s, s.wins) : notValuedLine(s, total)),
    reason: figure ? null : (total.reason ?? s.reason ?? 'Not established.'),
    ours: figure ? oursOf(e.ourView, unit) : null,
  };
}

// ── sides and the difference ─────────────────────────────────────────────────

const LABEL = TRADE_COMBINATION_POLICY.label;

function leavesOut(excluded: TradeExcluded[]): string {
  return excluded.length === 0 ? '' : ` Leaves out ${plural(excluded.length, 'player')} whose value isn't known, each named with his reason; never counted as zero.`;
}

function sideTotal(side: TradeSideName, players: TradePlayerValue[], unit: TradeUnit | null, pick: (p: TradePlayerValue) => TradeFigure | null): TradeSideTotal {
  const excluded = players.filter((p) => !p.counted).map((p) => ({ playerId: p.playerId, side, reason: p.notCounted ?? 'Not valued yet.' }));
  const counted = players.map(pick).filter((f): f is TradeFigure => f !== null);
  if (counted.length === 0 || unit === null) {
    return {
      status: 'none', counted: 0, excluded, figure: null, edges: null,
      text: players.length === 0 ? 'No players on this side.' : `No player on this side could be valued, so it has no total.${leavesOut(excluded)}`,
    };
  }
  const { figure, edges } = combineTradeFigures(counted.map((f) => ({ figure: f, sign: 1 as const })));
  const fmt = amountIn(unit);
  return {
    status: 'known', counted: counted.length, excluded, figure, edges,
    text: `${LABEL}: around the sum of each player's most likely reading, each player's own distance from it on each side is combined as ` +
      `independent across ${plural(counted.length, 'player')} (root sum of squares); an option, an open status or whether he stays stays at its edges. ` +
      `Every player at his edge, summed: ${fmt(edges.low)} to ${fmt(edges.high)}.${leavesOut(excluded)}`,
  };
}

function differenceOf(sent: TradePlayerValue[], received: TradePlayerValue[], unit: TradeUnit | null, pick: (p: TradePlayerValue) => TradeFigure | null): TradeDifference {
  const excluded: TradeExcluded[] = [
    ...sent.filter((p) => !p.counted).map((p) => ({ playerId: p.playerId, side: 'sent' as const, reason: p.notCounted ?? 'Not valued yet.' })),
    ...received.filter((p) => !p.counted).map((p) => ({ playerId: p.playerId, side: 'received' as const, reason: p.notCounted ?? 'Not valued yet.' })),
  ];
  const unknown = (reason: string): TradeDifference => ({ status: 'unknown', reason, figure: null, edges: null, components: [], excluded, text: reason });
  if (sent.length === 0 || received.length === 0) return unknown('Add players to each side: a difference needs something going out and something coming in.');
  const parts: TradePart[] = [];
  for (const [side, players, sign] of [['sent', sent, -1], ['received', received, 1]] as const) {
    for (const p of players) {
      const f = pick(p);
      if (f) parts.push({ playerId: p.playerId, side, sign, part: sign > 0 ? { ...f } : reversed(f) });
    }
  }
  if (unit === null || !parts.some((p) => p.side === 'sent')) {
    return unknown(`Nothing going out could be valued, so the difference is not a number (never a zero).${leavesOut(excluded)}`);
  }
  if (!parts.some((p) => p.side === 'received')) {
    return unknown(`Nothing coming in could be valued, so the difference is not a number (never a zero).${leavesOut(excluded)}`);
  }
  const { figure, edges } = combineTradeFigures(parts.map((p) => ({ figure: p.part, sign: 1 as const })));
  const fmt = amountIn(unit);
  return {
    status: 'known', reason: null, figure, edges, components: parts, excluded,
    text: `What comes in less what goes out, in ${unit === 'dollars' ? 'contract value' : 'wins over a replacement'}, each player's part named (a player ` +
      `going out enters reversed). ${LABEL}: around the sum of the most likely readings, each player's own distance combined as independent across ` +
      `${plural(parts.length, 'player')} (root sum of squares); an open season stays at its edges. Every player at his edge: ${fmt(edges.low)} to ` +
      `${fmt(edges.high)}. The price of a win is shared by every player on both sides and is read as independent too, so the range is a reading, ` +
      `not a coverage claim.${leavesOut(excluded)}`,
  };
}

/**
 * Both sides of a deal on Player Value, and the difference between them (owner Q-8): what comes in less what goes out, a band
 * with its parts, never a point, a single score or a verdict. Neutral throughout; our view, where handed in, beside it.
 */
export function tradeValueOf(input: { sent: TradeEntryInput[]; received: TradeEntryInput[] }): TradeValue {
  const all = [...input.sent, ...input.received].map((e) => e.surplus).filter((s): s is PlayerSurplus => s !== null);
  const winsOnly = all.filter((s) => s.status === 'wins_only');
  const unit: TradeUnit | null = winsOnly.length > 0 ? 'wins' : all.some((s) => s.status === 'valued') ? 'dollars' : null;
  const unitReason = unit === 'wins'
    ? `Dollars aren't known for ${plural(winsOnly.length, 'player')} in this deal (${winsOnly[0].reason ?? 'no price of a win'}), so the whole deal is read in wins over a replacement.`
    : unit === null ? 'No player in this deal could be valued.' : null;
  const sentPlayers = input.sent.map((e) => playerOf(e, unit));
  const receivedPlayers = input.received.map((e) => playerOf(e, unit));
  const neutral = (p: TradePlayerValue) => (p.counted ? p.contract : null);

  const countedAll = [...sentPlayers, ...receivedPlayers].filter((p) => p.counted);
  const oursComplete = countedAll.length > 0 && countedAll.every((p) => p.ours !== null && p.ours.contract !== null);
  const ours = (p: TradePlayerValue) => (p.counted ? p.ours?.contract ?? null : null);
  const ourView = oursComplete
    ? {
      leaning: countedAll.some((p) => p.ours!.leaning),
      sent: sideTotal('sent', sentPlayers, unit, ours),
      received: sideTotal('received', receivedPlayers, unit, ours),
      difference: differenceOf(sentPlayers, receivedPlayers, unit, ours),
    }
    : null;

  return {
    unit,
    unitReason,
    sent: { players: sentPlayers, total: sideTotal('sent', sentPlayers, unit, neutral) },
    received: { players: receivedPlayers, total: sideTotal('received', receivedPlayers, unit, neutral) },
    difference: differenceOf(sentPlayers, receivedPlayers, unit, neutral),
    ourView,
    basis: [
      "A trade moves each player's remaining salary with him, so the sides are read on contract value (what his contract is worth to " +
        'whoever holds it: his wins at the price of a win on the market, less what he costs, discounted), never on the value of keeping ' +
        'him, whose guaranteed money cancels only for the club that already owes it; that value is shown per player, never summed.',
      "Each player's figures are Player Value's as every read serves them (the player card, Payroll, the league-wide read): never " +
        'recomputed, narrowed or re-read here.',
      `${LABEL}: the owner's Payroll rule extended to a deal's sides and the difference between them; the every-player-at-his-edge ` +
        "sum is kept beside each figure and no player's own band is narrowed.",
      "A player whose value is not known is listed with his reason and left out of the sums, which name him; he is never counted as zero.",
      "The difference describes the deal; it does not see either club's roster, needs or finances, and it decides nothing.",
      'Our view, where shown, is the viewing club\'s lens applied to each player at read time; it never changes the ' +
        'neutral figures, which are the same whoever looks.',
    ],
    stamp: TRADE_COMBINATION_POLICY_CALIBRATION,
  };
}

// ── a trade row's control and production ─────────────────────────────────────

export interface TradeControlSeason {
  season: number;
  label: string;
  cost: { low: number; central: number | null; high: number } | null;
  /** Counted only if held: an option, an opt-out, or a season he may reach free agency in. */
  ifHeld: boolean;
  costText: string;
}

export interface TradeControlSummary {
  /** One line: "Signed 2030 · arbitration 2031–2032 · 2033 arbitration or free agency · free agent from 2034". */
  text: string;
  /** Seasons of control from this one (before free agency), where established. */
  controlled: number | null;
  /** Control runs past the last season shown. */
  pastHorizon: boolean;
  /** Each controlled season with what it costs, as Player Value priced it. */
  path: TradeControlSeason[];
}

const STATUS_WORD: Record<ControlStatus, string> = {
  under_contract: 'signed',
  club_option: 'club option',
  player_option: 'player option',
  vesting_option: 'vesting option',
  mutual_option: 'mutual option',
  opt_out: 'opt-out',
  pre_arbitration: 'pre-arb',
  arbitration: 'arbitration',
  free_agent: 'free agency',
  reserve_clause: 'reserve clause',
  indeterminate: 'not established',
};

const seasonWord = (s: ControlSeason): string =>
  (s.status === 'indeterminate' ? (s.between.length > 0 ? s.between.map((b) => STATUS_WORD[b]).join(' or ') : 'not established') : STATUS_WORD[s.status]);

const costTextOf = (s: ControlSeason, cost: TradeControlSeason['cost']): string => {
  if (!cost) {
    const why = s.cost?.note ?? s.reasons[0] ?? null;
    return `not known${why ? ` (${why.replace(/\.$/, '')})` : ''}`;
  }
  if (cost.low === cost.high) return money(cost.low);
  if (cost.central === null) return `${money(cost.low)} to ${money(cost.high)}, depending on his status`;
  return `most likely ${money(cost.central)} · could be ${money(cost.low)} to ${money(cost.high)}`;
};

/** A player's control as a trade row shows it: each run of seasons in plain words, and each controlled season's cost. */
export function controlSummaryOf(control: ControlTimeline): TradeControlSummary {
  if (control.standing === 'unsigned') return { text: 'No club holds him', controlled: null, pastHorizon: false, path: [] };
  if (control.standing === 'unknown' || control.seasons.length === 0) {
    return { text: 'Control not established', controlled: null, pastHorizon: false, path: [] };
  }
  const runs: Array<{ word: string; from: number; to: number; open: boolean }> = [];
  const path: TradeControlSeason[] = [];
  let freeFrom: number | null = null;
  for (const s of control.seasons) {
    if (s.status === 'free_agent') {
      freeFrom = s.season;
      break;
    }
    const word = seasonWord(s);
    const open = s.status === 'indeterminate';
    const last = runs[runs.length - 1];
    if (last && last.word === word && last.to === s.season - 1 && last.open === open) last.to = s.season;
    else runs.push({ word, from: s.season, to: s.season, open });
    const band = s.cost?.value ?? null;
    const cost = band ? { low: band.low, central: band.central === undefined ? (band.low === band.high ? band.low : null) : band.central, high: band.high } : null;
    const ifHeld = /option|opt_out/.test(s.status) || (s.status === 'indeterminate' && s.between.includes('free_agent'));
    path.push({ season: s.season, label: word, cost, ifHeld, costText: costTextOf(s, cost) });
  }
  const parts = runs.map((r) => {
    const ys = r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`;
    return r.open ? `${ys} ${r.word}` : `${r.word} ${ys}`;
  });
  if (freeFrom !== null) parts.push(`free agent from ${freeFrom}`);
  else if (control.continuesPastHorizon) parts.push(`control past ${control.seasons[control.seasons.length - 1].season}`);
  const text = parts.join(' · ');
  return {
    text: text.charAt(0).toUpperCase() + text.slice(1),
    controlled: path.length,
    pastHorizon: control.continuesPastHorizon,
    path,
  };
}

export interface TradeProduction {
  status: 'projected' | 'unknown';
  reason: string | null;
  /** This season: the rest of it where it is under way, else the whole season (the 80% band). */
  now: { season: number; part: 'rest_of_season' | 'season'; wins: WinsBand } | null;
  /** Next season, where established; else its reason. */
  next: { season: number; wins: WinsBand } | null;
  nextReason: string | null;
}

/** His expected wins for the rest of this season and next, as production served them, or the reason there are none. */
export function productionHeadlineOf(p: PlayerProduction): TradeProduction {
  if (p.status !== 'projected' || p.seasons.length === 0) {
    return { status: 'unknown', reason: p.reason ?? 'His production is not established.', now: null, next: null, nextReason: null };
  }
  const first = p.seasons[0];
  const now = first.remaining
    ? { season: first.season, part: 'rest_of_season' as const, wins: first.remaining }
    : { season: first.season, part: 'season' as const, wins: first.wins };
  const nextSeason = p.seasons.find((s) => s.season === first.season + 1) ?? null;
  const unestablished = p.notEstablished.find((s) => s.season === first.season + 1) ?? null;
  return {
    status: 'projected',
    reason: null,
    now,
    next: nextSeason ? { season: nextSeason.season, wins: nextSeason.wins } : null,
    nextReason: nextSeason ? null : (unestablished?.reason ?? null),
  };
}
