/**
 * Player Value, concern 5 (phase 5a): the neutral contract surplus and the retention margin (PLAYER_VALUE.md Part 5).
 *
 * Pure. It joins Player Value's own answers, as the entry point hands them over: expected production (concern 3),
 * the control timeline with its cost path (concern 2) and the league's market (concern 4: the price of a win in force
 * and the minimum salary). It reads nothing, decides nothing and ranks nothing: two views, each a band with its
 * components, season by season, and neither is a verdict (D-052).
 *
 *   contract surplus   for each controlled season: his production value, the minimum a replacement at 0 WAR costs
 *                      plus his wins × the price of a win, less what he costs; discounted (one policy rate) and summed.
 *                      What the contract is worth to whoever holds it.
 *   retention margin   (his wins − the replacement's wins) × the price, less the costs that exist only if he is kept,
 *                      plus the minimum a replacement would cost. Money owed whatever the club does (a major-league
 *                      contract's covered salary) appears in both futures and cancels; money already paid appears in
 *                      neither. A 40-man spot is stated, never priced.
 *
 * One level of replacement on both sides: his wins are the export's WAR (wins above its replacement level), the
 * replacement's wins are 0 there by construction, and the price is salary above the minimum per win above that same
 * level. Bands combine edge against edge (Part 3): his low wins at the low price less the high cost, and so on; a
 * central comes from the components' centrals. Unknown stays unknown (D-018): a season with no wins or no cost has no
 * surplus, and a sum over it names what it cannot include, never reading it as zero. Nothing here reads a rating,
 * `players_value`, philosophy, the protection tier or defensibility.
 */

import type { CalibrationStamp } from './calibration.js';
import { SURPLUS_POLICY, SURPLUS_POLICY_CALIBRATION } from './playerValueCalibration.js';
import type { ControlSeason, ControlStatus, ControlTimeline, CostBand } from './playerValueControl.js';
import type { PriceBand } from './playerValueFinances.js';
import type { PlayerProduction, WinsBand } from './playerValueProduction.js';
import { UNKNOWN_REASON_TEXT, type Sourced } from './provenance.js';

/** Three numbers: a band and its central, or null where no single central is chosen (then `centrals` names each). */
export interface SurplusFigure {
  low: number;
  central: number | null;
  high: number;
}

/** One reading's central where the season has no single one: a branch, a status, or a range where a part is not exported. */
export interface NamedCentral {
  reading: string;
  low: number;
  high: number;
}

/** One view of one season (contract surplus or retention margin), before and after discounting. */
export interface SurplusView {
  status: 'known' | 'unknown';
  reason: string | null;
  /** The season's band, undiscounted. */
  band: SurplusFigure | null;
  /** The band × the season's discount weight. */
  discounted: SurplusFigure | null;
  /** Each reading's central (undiscounted) where the band has no single central. */
  centrals: NamedCentral[];
  /** The player decides, or he may leave: the held reading is what it is if he is held. */
  ifHeld: boolean;
  /** How it was read, in words. */
  text: string;
}

/** A way the season can go: he plays for the club at a cost, or he is gone (and the club pays what it owes). */
export interface SurplusBranch {
  label: string;
  held: boolean;
  wins: WinsBand | null;
  cost: SurplusFigure | null;
  surplus: SurplusFigure | null;
  reason: string | null;
}

export interface SurplusSeason {
  season: number;
  age: number | null;
  /** This season counts only its part still to be played. */
  part: 'rest_of_season' | 'season';
  /** The share of the season counted; null where the share of this season played is not established. */
  share: number | null;
  /** The discount weight, 1/(1 + rate)^s. */
  weight: number;
  status: ControlStatus;
  /** Where Player Rights leaves the season between statuses, each it may be (else empty). */
  between: ControlStatus[];
  /** His control that season, in words. */
  control: string;
  /** The player decides, or he may leave: the held reading is "if held". */
  ifHeld: boolean;
  /** The wins counted (the rest of this season for this one), the 80% band. */
  wins: WinsBand | null;
  /** This season only: the WAR he has banked, sunk for the forward view (shown, never counted). */
  banked: number | null;
  /** The price of a win in force, the same every season (held flat); null without dollars. */
  price: SurplusFigure | null;
  /** What he costs in the held reading, the counted part. */
  cost: SurplusFigure | null;
  costText: string;
  /** This season only: the salary for the part already played, sunk (shown, never counted). */
  paid: number | null;
  /** What a replacement at 0 WAR costs for the counted part: the league minimum × the share. */
  replacement: number | null;
  /** Retention: money in both futures, which cancels (a major-league contract's covered salary). */
  owedEitherWay: SurplusFigure | null;
  /** Retention: the costs that exist only if he is kept. */
  onlyIfKept: SurplusFigure | null;
  branches: SurplusBranch[];
  contract: SurplusView;
  retention: SurplusView;
}

/** A sum over the seasons, discounted; a number only where every season in it is known. */
export interface SurplusTotal {
  status: 'known' | 'unknown';
  from: number | null;
  to: number | null;
  low: number | null;
  central: number | null;
  high: number | null;
  /** Where a season has no single central: the sums of its readings' lowest and highest centrals. */
  centralRange: { low: number; high: number } | null;
  /** The seasons the sum cannot include. */
  missing: number[];
  reason: string | null;
  /** The leading run of known seasons, summed and labelled with the seasons it covers, where a later one is unknown. */
  established: { from: number; to: number; low: number; central: number | null; high: number; centralRange: { low: number; high: number } | null } | null;
  /** Some season in it is counted only if he is held. */
  ifHeld: boolean;
}

/** The league's market as the entry point reads it for this player's contract regime. */
export interface SurplusMarket {
  /** The price of a win in force (opening or measured per win produced); unknown without financials. */
  price: Sourced<PriceBand>;
  stage: 'opening' | 'measured';
  label: string;
  minimumSalary: Sourced<number>;
  /** The export's replacement level this season (a winning percentage), for the words; null where not measured. */
  replacementLevel: number | null;
  /** The replacement measured from freely available talent (phase 4b): shown, never applied. */
  measuredReplacement: string | null;
}

export interface SurplusInput {
  production: PlayerProduction;
  control: ControlTimeline;
  /** His contract is a major-league deal (its covered seasons are owed whatever the club does); null where not established. */
  majorLeagueDeal: boolean | null;
  /** Null where his league's contract regime is unknown. */
  market: SurplusMarket | null;
  /** Whether the export places him on the 40-man (Player State); null where not exported. */
  fortyMan: boolean | null;
}

export interface PlayerSurplus {
  playerId: number;
  /** Valued in dollars; in wins only (dollars unknown); unknown (production or control); or no club holds him. */
  status: 'valued' | 'wins_only' | 'unknown' | 'not_held';
  reason: string | null;
  unit: 'dollars' | 'wins';
  price: { stage: 'opening' | 'measured'; label: string; band: PriceBand; text: string } | null;
  minimum: number | null;
  discount: { rate: number; text: string };
  replacement: { text: string; measured: string | null };
  fortyMan: { onFortyMan: boolean | null; text: string };
  seasons: SurplusSeason[];
  contract: SurplusTotal;
  retention: SurplusTotal;
  /** His wins over the seasons counted (the replacement's are 0), discounted like the dollars: the value in wins. */
  wins: SurplusTotal;
  /** What is not counted, and why. */
  excluded: string[];
  /** The rules the views are read by, in words. */
  basis: string[];
  stamp: CalibrationStamp;
}

// ── arithmetic ───────────────────────────────────────────────────────────────

/** Every corner of a product of two bands (wins can be negative). */
function times(a: { low: number; high: number }, b: { low: number; high: number }): { low: number; high: number } {
  const corners = [a.low * b.low, a.low * b.high, a.high * b.low, a.high * b.high];
  return { low: Math.min(...corners), high: Math.max(...corners) };
}

/** a − b, edge against opposite edge; a central only where both have one. */
function minus(a: SurplusFigure, b: SurplusFigure): SurplusFigure {
  return { low: a.low - b.high, central: a.central !== null && b.central !== null ? a.central - b.central : null, high: a.high - b.low };
}

function plus(a: SurplusFigure, b: SurplusFigure): SurplusFigure {
  return { low: a.low + b.low, central: a.central !== null && b.central !== null ? a.central + b.central : null, high: a.high + b.high };
}

const scale = (a: SurplusFigure, k: number): SurplusFigure =>
  ({ low: a.low * k, central: a.central === null ? null : a.central * k, high: a.high * k });

const point = (v: number): SurplusFigure => ({ low: v, central: v, high: v });

/** Money in words: "$7.25M", "$780K", "−$3.10M". */
function money(v: number): string {
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a === 0) return '$0';
  return a >= 1_000_000 ? `${sign}$${(a / 1_000_000).toFixed(2)}M` : `${sign}$${Math.round(a / 1_000)}K`;
}

const wins = (v: number): string => (Math.abs(v) < 0.05 && v !== 0 ? (v < 0 ? '>−0.1' : '<0.1') : v.toFixed(1));

const reasonOf = <T>(s: Sourced<T>): string =>
  (s.note && s.note.trim().length > 0 ? s.note : s.reason ? `${UNKNOWN_REASON_TEXT[s.reason]}.` : 'Not established.');

/** A cost band as three numbers: a contract's point is its own central; a band between statuses has none. */
function costFigure(c: CostBand): SurplusFigure {
  if (c.central === undefined) return { low: c.low, central: c.low === c.high ? c.low : null, high: c.high };
  return { low: c.low, central: c.central, high: c.high };
}

const STATUS_WORDS: Record<ControlStatus, string> = {
  under_contract: 'under contract', club_option: 'a club option', player_option: 'a player option', vesting_option: 'a vesting option',
  mutual_option: 'a mutual option', opt_out: 'an opt-out', pre_arbitration: 'pre-arbitration', arbitration: 'arbitration',
  free_agent: 'free agency', reserve_clause: 'the reserve clause', indeterminate: 'not established',
};

const OPTION_STATUSES: ControlStatus[] = ['club_option', 'player_option', 'vesting_option', 'mutual_option', 'opt_out'];
/** The club decides whether he is kept: exercising costs the salary less the buyout it would pay to decline. */
const CLUB_DECIDES: ControlStatus[] = ['club_option', 'vesting_option', 'mutual_option'];

// ── one season ───────────────────────────────────────────────────────────────

interface SeasonContext {
  thisSeason: number;
  played: number | null;
  dollars: boolean;
  dollarsReason: string | null;
  price: PriceBand | null;
  minimum: number | null;
  production: PlayerProduction;
  majorLeagueDeal: boolean | null;
}

function unknownView(reason: string, ifHeld = false): SurplusView {
  return { status: 'unknown', reason, band: null, discounted: null, centrals: [], ifHeld, text: reason };
}

/** The wins counted for a season (the rest of this one), or why there are none. */
function countedWins(s: ControlSeason, ctx: SeasonContext): { wins: WinsBand | null; banked: number | null; age: number | null; reason: string | null } {
  const p = ctx.production;
  if (p.status !== 'projected') return { wins: null, banked: null, age: null, reason: p.reason ?? 'His production is not established.' };
  const x = p.seasons.find((z) => z.season === s.season);
  if (!x) {
    const u = p.notEstablished.find((z) => z.season === s.season);
    return {
      wins: null, banked: null, age: u?.age ?? null,
      reason: u ? `${s.season} is not established (${u.reason.replace(/\.$/, '')}).` : `${s.season} is outside the projection's horizon.`,
    };
  }
  if (s.season !== ctx.thisSeason) return { wins: x.wins, banked: null, age: x.age, reason: null };
  if (x.remaining) return { wins: x.remaining, banked: x.toDate, age: x.age, reason: null };
  if (x.toDate === null || x.toDate === 0) return { wins: x.wins, banked: x.toDate, age: x.age, reason: null };
  return { wins: null, banked: x.toDate, age: x.age, reason: `The rest of ${s.season} is not stated apart from what he has banked.` };
}

function seasonOf(s: ControlSeason, ctx: SeasonContext): SurplusSeason {
  const k = s.season - ctx.thisSeason;
  const weight = 1 / (1 + SURPLUS_POLICY.discountRate) ** k;
  const now = k === 0;
  const share = now ? (ctx.played === null ? null : Math.min(1, Math.max(0, 1 - ctx.played))) : 1;
  const { wins: W, banked, age, reason: winsReason } = countedWins(s, ctx);
  const P: SurplusFigure | null = ctx.price ? { low: ctx.price.low, central: ctx.price.central, high: ctx.price.high } : null;
  const M = ctx.minimum !== null && share !== null ? ctx.minimum * share : null;

  // What he costs in the held reading, for the counted part
  const shareReason = `The share of ${s.season} still to be played is not established, so the part of his salary still to pay is not either.`;
  const costOf = (c: Sourced<CostBand> | null | undefined): { figure: SurplusFigure | null; reason: string | null } => {
    if (!c) return { figure: null, reason: 'His cost is not established.' };
    if (c.value === null) return { figure: null, reason: reasonOf(c) };
    if (share === null) return { figure: null, reason: shareReason };
    return { figure: scale(costFigure(c.value), share), reason: null };
  };
  const held = costOf(s.cost);
  const C = held.figure;
  const salaryPoint = s.cost?.value && s.cost.value.low === s.cost.value.high ? s.cost.value.low : null;
  const paid = now && salaryPoint !== null && ctx.played !== null ? salaryPoint * Math.min(1, Math.max(0, ctx.played)) : null;

  // Guaranteed: a major-league contract's covered salary, owed whatever the club does (or the salary if he stays, where he decides)
  const covered = s.from === 'contract' || s.from === 'extension';
  const guaranteed = covered && (s.status === 'under_contract' || s.status === 'player_option' || s.status === 'opt_out')
    && (s.from === 'extension' || ctx.majorLeagueDeal === true);
  const playerDecides = s.status === 'player_option' || s.status === 'opt_out';
  const mayLeave = s.status === 'indeterminate' && s.between.includes('free_agent');
  const declinedMayLeave = !!s.declined && (s.declined.status === 'free_agent' || s.declined.between.includes('free_agent'));
  const ifHeld = playerDecides || mayLeave || (s.costBasis?.ifHeld ?? false);

  // Production value: the minimum a replacement at 0 WAR costs, plus his wins × the price
  const value: SurplusFigure | null = W && P && M !== null
    ? plus(point(M), { ...times(W, P), central: W.central * (P.central as number) })
    : null;

  // The branches: held at his cost, and for an option or a season he may leave, the other way it can go
  const heldLabel = OPTION_STATUSES.includes(s.status)
    ? (playerDecides ? (s.status === 'opt_out' ? 'he stays under the deal' : 'he exercises the option') : 'the option exercised')
    : mayLeave ? `held (${s.between.filter((b) => b !== 'free_agent').map((b) => STATUS_WORDS[b]).join(' or ')})` : STATUS_WORDS[s.status];
  const branch = (label: string, heldHere: boolean, cost: SurplusFigure | null, reason: string | null): SurplusBranch => ({
    label, held: heldHere, wins: heldHere ? W : null, cost,
    surplus: !ctx.dollars || cost === null ? null : heldHere ? (value ? minus(value, cost) : null) : minus(point(0), cost),
    reason: cost === null ? reason : heldHere && !value ? (winsReason ?? ctx.dollarsReason) : null,
  });
  const branches: SurplusBranch[] = [branch(heldLabel, true, C, held.reason)];

  // The buyout: as exported, or (not populated) read from nothing to the option's salary
  const buyoutOf = (): { figure: SurplusFigure | null; text: string } => {
    const b = s.declined?.buyout;
    if (b && b.value !== null) return { figure: point(b.value), text: `the buyout, ${money(b.value)}` };
    if (C === null) return { figure: null, text: 'a buyout the export does not populate' };
    return { figure: { low: 0, central: null, high: C.high }, text: `a buyout the export does not populate, read from nothing to the option's salary (${money(C.high)})` };
  };
  if (s.declined) {
    const d = s.declined;
    const buyout = buyoutOf();
    const verb = s.status === 'opt_out' ? 'he opts out' : playerDecides ? 'he declines the option' : 'the option declined';
    if (d.status === 'free_agent') {
      branches.push(branch(`${verb}, then free agency (${buyout.text})`, false, buyout.figure, 'The buyout is not established.'));
    } else {
      const dc = costOf(d.cost);
      const both = dc.figure && buyout.figure ? plus(dc.figure, buyout.figure) : null;
      branches.push(branch(`${verb}, then ${STATUS_WORDS[d.status]} (${buyout.text})`, true, both, dc.reason ?? 'The buyout is not established.'));
      if (d.between.includes('free_agent')) branches.push(branch(`${verb}, then free agency (${buyout.text})`, false, buyout.figure, 'The buyout is not established.'));
    }
  } else if (mayLeave) {
    branches.push(branch('he leaves (free agency): nothing to this club', false, point(0), null));
  }

  // Each status's central where a band between statuses has none (Player Value's cost basis names them)
  const statusCentrals = (label: string, base: SurplusFigure | null): NamedCentral[] => {
    if (!base || base.central === null) return [];
    return (s.costBasis?.centrals ?? []).map((c) => {
      const v = (base.central as number) - c.central * (share ?? 1);
      return { reading: `${label}, ${STATUS_WORDS[c.status]}${c.arbitrationClass ? ` class ${c.arbitrationClass}` : ''}`, low: v, high: v };
    });
  };

  // ── the contract surplus: the hull of the branches ──
  const winsText = W ? `${wins(W.central)} wins (${wins(W.low)} to ${wins(W.high)})` : 'wins not established';
  let contract: SurplusView;
  if (!ctx.dollars) contract = unknownView(ctx.dollarsReason as string, ifHeld);
  else if (!W) contract = unknownView(winsReason as string, ifHeld);
  else {
    const missing = branches.find((b) => b.surplus === null);
    if (missing) contract = unknownView(missing.reason ?? 'A part of this season is not established.', ifHeld);
    else {
      const bands = branches.map((b) => b.surplus as SurplusFigure);
      const band: SurplusFigure = {
        low: Math.min(...bands.map((b) => b.low)),
        central: bands.length === 1 ? bands[0].central : null,
        high: Math.max(...bands.map((b) => b.high)),
      };
      const centrals: NamedCentral[] = band.central !== null ? [] : bands.length === 1
        ? statusCentrals(branches[0].label, value)
        : branches.flatMap((b) => {
          const x = b.surplus as SurplusFigure;
          if (x.central !== null) return [{ reading: b.label, low: x.central, high: x.central }];
          const named = b.held ? statusCentrals(b.label, value) : [];
          if (named.length > 0) return named;
          // A part not exported (the buyout): its central is the range of its readings
          const c = b.held && value && b.cost ? { low: (value.central as number) - b.cost.high, high: (value.central as number) - b.cost.low } : { low: x.low, high: x.high };
          return [{ reading: b.label, low: c.low, high: c.high }];
        });
      contract = {
        status: 'known', reason: null, band, discounted: scale(band, weight), centrals, ifHeld,
        text: `${now ? `The rest of ${s.season}: ` : ''}production value (the minimum a replacement costs, ${money(M as number)}, plus ${winsText} × the price) less his cost (${C ? figureText(C) : 'not established'})${branches.length > 1 ? `, across ${branches.length} ways the season can go (${branches.map((b) => b.label).join('; ')}), no central chosen between them` : ''}; weight ${weight.toFixed(3)}.`,
      };
    }
  }

  // ── the retention margin: the branch where he is kept ──
  let owedEitherWay: SurplusFigure | null = null;
  let onlyIfKept: SurplusFigure | null = null;
  let retentionText = '';
  let retentionReason: string | null = null;
  if (guaranteed) {
    owedEitherWay = C;
    onlyIfKept = point(0);
    retentionText = `His salary for ${now ? `the rest of ${s.season}` : s.season}${C ? '' : ' (not stated in the export)'} is owed whatever the club does, so it is in both futures and cancels: however large, it moves neither future${playerDecides ? '; the player decides whether he stays, so this is if held' : ''}.`;
  } else if (CLUB_DECIDES.includes(s.status)) {
    const buyout = buyoutOf();
    if (C && buyout.figure) {
      onlyIfKept = s.status === 'vesting_option' ? { low: 0, central: null, high: minus(C, buyout.figure).high } : minus(C, buyout.figure);
      if (onlyIfKept.low < 0) onlyIfKept = { ...onlyIfKept, low: 0 };
      retentionText = `Exercising the option costs its salary (${figureText(C)}) less ${buyout.text}, which the club would pay to decline${s.status === 'vesting_option' ? '; if it vests, the salary is owed whatever the club does' : ''}.`;
    } else retentionReason = C ? 'The buyout is not established.' : held.reason;
  } else if (s.status === 'under_contract') {
    retentionReason = covered && ctx.majorLeagueDeal !== true
      ? `Whether his salary for ${s.season} is owed whatever the club does is not established (${ctx.majorLeagueDeal === false ? 'a minor-league deal' : 'his deal\'s kind is not exported'}).`
      : held.reason ?? 'What he is owed is not established.';
    if (!covered) retentionReason = held.reason ?? 'His contract for this season is not exported.';
  } else if (C) {
    onlyIfKept = C;
    retentionText = `His ${STATUS_WORDS[s.status]} salary (${figureText(C)}) exists only if he is kept${s.status === 'arbitration' || s.status === 'pre_arbitration' || mayLeave ? ' (the club may decline to tender him)' : ''}.`;
  } else retentionReason = held.reason;

  let retention: SurplusView;
  if (!ctx.dollars) retention = unknownView(ctx.dollarsReason as string, ifHeld);
  else if (!W || !value) retention = unknownView(winsReason ?? 'His production value is not established.', ifHeld);
  else if (!onlyIfKept) retention = unknownView(retentionReason ?? 'The costs that exist only if he is kept are not established.', ifHeld);
  else {
    const band = minus(value, onlyIfKept);
    let centrals: NamedCentral[] = [];
    if (band.central === null) {
      const named = onlyIfKept.central === null && onlyIfKept === C ? statusCentrals(heldLabel, value) : [];
      centrals = named.length > 0 ? named : [{ reading: `${heldLabel} (a part not exported read across its range)`, low: (value.central as number) - onlyIfKept.high, high: (value.central as number) - onlyIfKept.low }];
    }
    retention = {
      status: 'known', reason: null, band, discounted: scale(band, weight), centrals, ifHeld,
      text: `${now ? `The rest of ${s.season}: ` : ''}(${winsText} − the replacement's 0) × the price, plus the minimum a replacement would cost (${money(M as number)}), less what exists only if he is kept (${figureText(onlyIfKept)}). ${retentionText} Weight ${weight.toFixed(3)}.`,
    };
  }

  return {
    season: s.season, age, part: now ? 'rest_of_season' : 'season', share, weight, status: s.status, between: [...s.between],
    control: s.basis, ifHeld, wins: W, banked, price: P, cost: C,
    costText: s.cost?.value ? (s.costBasis?.text ?? s.cost.note ?? s.basis) : (C === null ? held.reason ?? 'Not established.' : s.basis),
    paid, replacement: M, owedEitherWay, onlyIfKept, branches, contract, retention,
  };
}

function figureText(f: SurplusFigure): string {
  if (f.low === f.high) return money(f.low);
  return `${money(f.low)} to ${money(f.high)}${f.central !== null ? `, central ${money(f.central)}` : ''}`;
}

// ── the sums ─────────────────────────────────────────────────────────────────

type Summed = { low: number; high: number; central: number | null; centralLow: number; centralHigh: number };

function totalOf(seasons: SurplusSeason[], pick: (s: SurplusSeason) => SurplusView | null, whole: string | null): SurplusTotal {
  const from = seasons.length > 0 ? seasons[0].season : null;
  const to = seasons.length > 0 ? seasons[seasons.length - 1].season : null;
  const ifHeld = seasons.some((s) => s.ifHeld);
  const empty = (reason: string, missing: number[] = []): SurplusTotal => ({
    status: 'unknown', from, to, low: null, central: null, high: null, centralRange: null, missing, reason, established: null, ifHeld,
  });
  if (whole !== null) return empty(whole);
  if (seasons.length === 0) return empty('No controlled season is left to count.');
  const add = (acc: Summed, v: SurplusView, weight: number): Summed => {
    const d = v.discounted as SurplusFigure;
    // A season with no single central adds its readings' lowest and highest centrals (discounted), else its edges
    const cLow = d.central ?? (v.centrals.length > 0 ? Math.min(...v.centrals.map((c) => c.low)) * weight : d.low);
    const cHigh = d.central ?? (v.centrals.length > 0 ? Math.max(...v.centrals.map((c) => c.high)) * weight : d.high);
    return {
      low: acc.low + d.low, high: acc.high + d.high,
      central: acc.central !== null && d.central !== null ? acc.central + d.central : null,
      centralLow: acc.centralLow + cLow, centralHigh: acc.centralHigh + cHigh,
    };
  };
  const zero: Summed = { low: 0, high: 0, central: 0, centralLow: 0, centralHigh: 0 };
  const known = seasons.map((s) => ({ s, v: pick(s) }));
  const missing = known.filter((x) => !x.v || x.v.status !== 'known').map((x) => x.s.season);
  const range = (t: Summed) => (t.central === null ? { low: t.centralLow, high: t.centralHigh } : null);
  if (missing.length > 0) {
    const reasons = known.filter((x) => !x.v || x.v.status !== 'known').map((x) => `${x.s.season}: ${(x.v?.reason ?? 'not established').replace(/\.$/, '')}`);
    const lead: typeof known = [];
    for (const x of known) {
      if (!x.v || x.v.status !== 'known') break;
      lead.push(x);
    }
    const out = empty(`No sum over ${from}–${to}: ${reasons.join('; ')}.`, missing);
    if (lead.length > 0) {
      const t = lead.reduce((acc, x) => add(acc, x.v as SurplusView, x.s.weight), zero);
      out.established = { from: lead[0].s.season, to: lead[lead.length - 1].s.season, low: t.low, central: t.central, high: t.high, centralRange: range(t) };
    }
    return out;
  }
  const t = known.reduce((acc, x) => add(acc, x.v as SurplusView, x.s.weight), zero);
  return { status: 'known', from, to, low: t.low, central: t.central, high: t.high, centralRange: range(t), missing: [], reason: null, established: null, ifHeld };
}

/** His wins as a view, so the same sum reads them (the replacement's are 0). */
function winsView(s: SurplusSeason, reason: string | null): SurplusView {
  if (!s.wins) return unknownView(reason ?? 'His wins are not established.', s.ifHeld);
  const band: SurplusFigure = { low: s.wins.low, central: s.wins.central, high: s.wins.high };
  return { status: 'known', reason: null, band, discounted: scale(band, s.weight), centrals: [], ifHeld: s.ifHeld, text: '' };
}

// ── the player ───────────────────────────────────────────────────────────────

/**
 * A player's neutral contract surplus and retention margin, season by season over his controlled seasons within the
 * horizon (Q-3), with every component: the wins band, the price in force, the cost band and its basis, the discount
 * weight and the seasons included. Pure: the same answers in give the same answer out, whichever consumer asks.
 */
export function surplusOf(input: SurplusInput): PlayerSurplus {
  const { production, control, market } = input;
  const rate = SURPLUS_POLICY.discountRate;
  const thisSeason = control.thisSeason;
  const price = market?.price.value ?? null;
  const minimum = market?.minimumSalary.value ?? null;
  const dollarsReason = market === null
    ? "His league's contract regime is unknown, so neither the price of a win nor the minimum salary can be read: value is in wins, and dollars are unknown."
    : price === null
      ? `No price of a win: ${reasonOf(market.price).replace(/\.$/, '')}. Value is in wins, and dollars are unknown.`
      : minimum === null
        ? `The league minimum salary is not established (${reasonOf(market.minimumSalary).replace(/\.$/, '')}), so neither a replacement's cost nor the price's zero can be read: value is in wins, and dollars are unknown.`
        : null;
  const dollars = dollarsReason === null;
  const played = production.basis?.origin?.seasonPlayed ?? null;

  const discount = {
    rate,
    text: `One stated rate, ${(rate * 100).toFixed(0)}% a season (owner, 2026-09-24; policy, a time preference): a season s seasons from now weighs 1/${(1 + rate).toFixed(2)}^s, and this season's remaining part weighs 1.`,
  };
  const level = market?.replacementLevel ?? null;
  const replacement = {
    text: `One level of replacement on both sides: his wins are the export's WAR, wins above its own replacement level${level !== null ? ` (a .${Math.round(level * 1000).toString().padStart(3, '0')} club this season)` : ''}; the replacement's wins are 0 there, by construction of WAR; and the price of a win is salary above the league minimum per win above that same level, so a replacement at 0 WAR costs the minimum${minimum !== null ? ` (${money(minimum)})` : ''}.`,
    measured: market?.measuredReplacement ?? null,
  };
  const fortyMan = {
    onFortyMan: input.fortyMan,
    text: input.fortyMan === true
      ? "Keeping him holds a 40-man spot (the export places him on the 40-man); what that spot allows is Player Rights' (his roster rights), stated here and not priced."
      : input.fortyMan === false
        ? 'The export does not place him on the 40-man: keeping him holds no 40-man spot now; not priced.'
        : 'Whether he holds a 40-man spot is not exported; not priced.',
  };
  const priceOut = market && price ? {
    stage: market.stage, label: market.label, band: price,
    text: `The price of a win in force: ${market.label}, ${money(price.central)} a win (band ${money(price.low)} to ${money(price.high)}), held flat in every season (owner, 2026-09-24: no salary inflation is assumed unless the save's own measured price history shows drift). It is salary above the league minimum per win above the export's replacement level.`,
  } : null;
  const basis = [
    'Contract surplus: for each controlled season, his production value (the minimum a replacement at 0 WAR costs, plus his wins × the price of a win) less what he costs, discounted and summed: what the contract is worth to whoever holds it.',
    "Retention margin: (his wins − the replacement's wins, 0 in the export's WAR) × the price of a win, plus the minimum a replacement would cost, less the costs that exist only if he is kept. Money owed whatever the club does (a major-league contract's covered salary) is in both futures and cancels; money already paid is in neither.",
    'Bands combine edge against edge (his low wins at the low price less the high cost, and so on): a range of reasonable readings, not a calibrated interval; a central comes from the components\' centrals, and where a season can go more than one way no central is chosen between them.',
    discount.text,
    ...(priceOut ? [priceOut.text] : []),
    'Neither view is a verdict; they describe what his contract and his roster place are worth on this league\'s market, beside each other.',
  ];

  const base = {
    playerId: control.playerId, price: priceOut, minimum, discount, replacement, fortyMan, basis, stamp: SURPLUS_POLICY_CALIBRATION,
  };
  const unit: PlayerSurplus['unit'] = dollars ? 'dollars' : 'wins';

  if (control.standing === 'unsigned' || thisSeason === null || control.standing === 'unknown') {
    const reason = control.standing === 'unsigned'
      ? 'No club holds him, so there is no contract or control to value; his expected production is shown apart.'
      : `His control is not established, so no season can be valued: ${control.notes[control.notes.length - 1] ?? 'the current season is not known.'}`;
    const t = totalOf([], () => null, reason);
    return {
      ...base, status: control.standing === 'unsigned' ? 'not_held' : 'unknown', reason, unit, seasons: [],
      contract: t, retention: t, wins: t, excluded: [],
    };
  }

  const ctx: SeasonContext = {
    thisSeason, played, dollars, dollarsReason, price: dollars ? price : null, minimum: dollars ? minimum : minimum,
    production, majorLeagueDeal: input.majorLeagueDeal,
  };
  const seasons = control.seasons.filter((s) => s.status !== 'free_agent').map((s) => seasonOf(s, ctx));

  const excluded: string[] = [];
  const first = seasons[0];
  if (first && first.part === 'rest_of_season' && (first.banked !== null || first.paid !== null)) {
    excluded.push(`What he has banked in ${first.season}${first.banked !== null ? ` (${wins(first.banked)} wins)` : ''} and the salary for the part of it already played${first.paid !== null ? ` (${money(first.paid)})` : ''} are sunk for the forward view: shown, never counted. The rest of ${first.season} counts ${first.share !== null ? `${Math.round(first.share * 100)}%` : 'an unestablished share'} of his salary and of a replacement's minimum, the share of the league's games still to be played.`);
  }
  if (control.controlEnds !== null) excluded.push(`He is a free agent from ${control.controlEnds}: control ends, and nothing after it is counted.`);
  if (control.continuesPastHorizon) {
    const last = control.seasons[control.seasons.length - 1]?.season;
    excluded.push(`Control continues past ${last}, the end of the horizon (seven seasons, this one included; Q-3): later seasons are not counted.`);
  }

  const productionReason = production.status !== 'projected' ? (production.reason ?? 'His production is not established.') : null;
  const whole = productionReason ?? null;
  const moneyWhole = productionReason ?? dollarsReason;
  const status: PlayerSurplus['status'] = productionReason ? 'unknown' : dollars ? 'valued' : 'wins_only';
  return {
    ...base,
    status,
    reason: productionReason ?? dollarsReason,
    unit,
    seasons,
    contract: totalOf(seasons, (s) => s.contract, moneyWhole),
    retention: totalOf(seasons, (s) => s.retention, moneyWhole),
    wins: totalOf(seasons, (s) => winsView(s, null), whole),
    excluded,
  };
}
