import { useEffect, useState } from 'react';
import { apiGet, apiPut, type ClubWinValue, type FreshnessCue, type SeasonCostData } from '../api';
import { FreshnessCueLine } from '../FreshnessCue';
import { ClubWinValueLine } from '../ValueSection';
import { COST_BAND_WORDS, costBandText, costMoney } from '../costBand';
import { PlayerLink, Tip } from '../playerModal';
import { Sparkline } from '../Chart';
import { Th } from '../Th';

interface Commitment {
  year: number; total: number; players: number; headroom: number | null; budgetUsed?: 'expected' | 'flat';
  /** Club, vesting and mutual option seasons: not guaranteed, counted apart from the total. */
  options?: { total: number; players: number; unstated: number };
  /**
   * Phase 4a: what the controlled seasons no contract covers could cost (pre-arbitration and arbitration), with the sum
   * of their centrals beside it. Since the owner's decision (2026-09-24) the range combines players as independent (what
   * is not noise at its edges); the edge-to-edge sum is `edges`. Never in the total or the headroom.
   */
  projected?: {
    low: number | null; high: number | null; central?: { low: number; high: number } | null;
    edges?: { low: number; high: number } | null;
    combination?: { combined: number; atEdges: number; text: string } | null;
    players: number; unpriced: number; mayLeave: number; provisional: number;
  };
  /** Covered seasons whose salary the export does not state. */
  unstated?: number;
}
interface OptionYear {
  season: number; kind: 'club' | 'player' | 'vesting' | 'mutual' | 'opt_out'; salary: number | null; committed: boolean;
  /** The declined branch as the timeline serves it: what he falls to and its cost (phase 4a review). */
  declined?: { kind: string; status: string; cost: SeasonCost | null } | null;
}
/** A season's cost as Player Value's timeline serves it (phase 4a): a band with its central and basis, or why it is unknown. */
type SeasonCost = SeasonCostData;
interface PayrollPlayer {
  player_id: number;
  name: string;
  age: number | null;
  positionName: string;
  salaryNow: number | null;
  byYear: Array<number | null>;
  unstatedYears?: number[];
  optionYears?: OptionYear[];
  /** Phase 4a: each season's projected cost where no contract covers it; null elsewhere. Never committed money. */
  projected?: Array<SeasonCost | null>;
  yearsAfterThis: number;
  endYear: number;
  expiring: boolean;
  options: string[];
  deadMoney: boolean;
}
/** A figure with where it came from; `value` is null only when it is unknown (D-018). */
interface Sourced<T> { value: T | null; source: string | null; note?: string }
/** Club Finances and the league market, from /api/club-finances (D-052 phase 2). */
interface ClubFinancesData {
  club: {
    budget: Sourced<number>;
    payroll: { now: Sourced<number>; nextSeason: Sourced<number> };
    revenue: Sourced<number>;
    expenses: Sourced<number>;
    cashForTrades: Sourced<number>;
  };
  league: {
    priceOfWin: {
      label: string;
      unit: 'dollars_per_win' | 'wins';
      price: Sourced<{ central: number; low: number; high: number }>;
      floor: Sourced<{ low: number; high: number }>;
      bases: Array<{ id: string; description: string; perWin: Sourced<number> }>;
      population: { market: number };
      rules: { central: string; band: string; floor?: string; market?: string };
      narrowsWhen: string;
      /** Phase 4b: the opening reading, or the measured one in force; and which is in force and why (owner Q-4). */
      stage?: 'opening' | 'measured';
      adoption?: PriceAdoptionData | null;
    };
    /** Phase 4a: the cost ladder measured on this import (the renewal spread and the arbitration ladder). */
    costs?: CostLadderData;
    /** Phase 4b: what the save's imports observed: arbitration salaries scored against the ladder, reserve-clause renewals. */
    observed?: ObservedCostsData;
  };
  /** Phase 4b: the price of a win across the save's imports. */
  priceHistory?: PriceHistoryEntry[];
  /** Phase 5b: this club's value of a win now, in playoff odds: context beside the league's price, never in any figure. */
  winValue?: ClubWinValue;
}
/** Which price of a win is in force and why (phase 4b), as Club Finances serves it. */
interface PriceAdoptionData {
  inForce: 'opening' | 'measured';
  reason: string;
  opening: { central: number; low: number; high: number; comparable: { low: number; high: number } | null } | null;
  measured: {
    status: string; signings: number; observed: number; text: string; price: Sourced<{ central: number; low: number; high: number }>;
    /** Phase 4b review: the measured bases, each with its unit (projected at signing, or realized in the first season). */
    bases?: Array<{ id: string; unit: 'projected' | 'realized'; description: string; status: string; signings: number; central: number | null; low: number | null; high: number | null; text: string }>;
    /** Owner decision 1 (2026-09-24): the check per win projected at signing, beside the price per win produced, never in it. */
    check?: { status: string; unit: 'projected'; central: number; low: number; high: number; ratio: number | null; text: string } | null;
  };
  rule: string;
}
/** One import's reading of the price of a win (phase 4b): opening, measured, which was in force. */
export interface PriceHistoryEntry {
  gameDate: string;
  season: number | null;
  inForce: 'opening' | 'measured';
  opening: { central: number; low: number; high: number } | null;
  measured: {
    status: string; signings: number; central: number | null; low: number | null; high: number | null; text?: string;
    /** Owner decision 1: the check per win projected at signing, and its ratio to the price per win produced. */
    check?: { central: number; ratio: number | null } | null;
  } | null;
  reason?: string | null;
  note: string | null;
}
interface ObservedCostsData {
  awards: { status: string; text: string; readingsText?: string };
  reserveClause: { status: string; text: string };
  /** Phase 4b review: imports not compared across a change of timeline (the save went back, or a date played again), in words. */
  timeline?: { text: string | null; superseded: string[] };
  /** Owner decision 4 (2026-09-24): which imports keep their full contract snapshot, in words. */
  retention?: { kept: number; pruned: number; olderMethod: number; text: string };
}
interface CostLadderData {
  preArbitration: { status: string; cases: number; atMinimum: number; band: Sourced<{ low: number; high: number; central?: number | null }>; text: string };
  arbitration: {
    status: string; platform: string; reason: string | null;
    classes: Array<{ arbitrationClass: number; status: string; cases: number; excluded: { atMinimum: number }; ratioShare: number | null; text: string }>;
    unread?: { openStanding: number; text: string };
  };
  rules: { renewal: string; arbitration: string; prior: string; reserveClause: string; band?: string };
}
interface PayrollData {
  seasonYear: number;
  /** How current the export is (A-20, Player Value phase 6c): the game date and a warning where it is behind or unchecked. */
  freshness?: FreshnessCue;
  years: number[];
  /** Money owed to players who left: `not_established` where the export does not populate retained salary (A-14). */
  deadMoney: {
    status?: 'known' | 'not_established';
    total: number | null;
    players: Array<{ player_id: number; name: string; salary: number | null }>;
    candidates?: number;
    note?: string | null;
  };
  commitments: Commitment[];
  /** What you told the app to expect next season, or null to assume flat. */
  nextSeasonBudget: number | null;
  /** Only the men who actually leave — money that genuinely comes off. */
  comingOff: OffTheBooks;
  /**
   * Deals that end without the player going anywhere: arbitration cases and
   * pre-arbitration renewals. Their salaries are about to rise, not vanish,
   * which is the opposite of relief.
   */
  stillControlled?: OffTheBooks;
  /**
   * Deals ending where the save cannot establish whether he leaves or stays:
   * his service crosses a line only if he stays up, or a rule is not exported.
   */
  controlIndeterminate?: OffTheBooks;
  players: PayrollPlayer[];
}

interface OffTheBooks {
  count: number;
  money: number;
  players: Array<{
    player_id: number; name: string; age: number | null; salary: number | null;
    status?: string | null; arbYear?: number | null; arbYearHigh?: number | null; superTwo?: boolean;
    between?: string[]; reason?: string | null;
    /** Next season's projected cost (phase 4a). */
    nextCost?: SeasonCost | null;
  }>;
}


const money = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return '';
  // Zero is a figure, and prints as one: the dash is never both zero and unknown (D-25)
  if (v === 0) return '$0';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(v / 1000)}K`;
};

/** A figure, or "unknown" when the export does not state it; never $0 for a missing value. */
const figure = (s: Sourced<number> | undefined): string => (s?.value === null || s?.value === undefined ? 'unknown' : money(s.value) || '$0');
const sourceOf = (s: Sourced<unknown> | undefined): string | undefined =>
  s ? [s.source, s.note].filter(Boolean).join(' — ') || undefined : undefined;

/**
 * A projected cost band (phase 4a, review): "$4.6M–$25.3M", "$780K–$790K" where its edges round alike (a band never
 * reads as a point), "unknown" where it is not established. Never $0 for a missing value.
 */
export const costBand = (low: number | null | undefined, high: number | null | undefined): string => {
  if (low === null || low === undefined || high === null || high === undefined) return 'unknown';
  return costBandText(low, high);
};

/**
 * A range the way the page says it (phase 6e, AGENTS.md "Writing for the GM"): "$4.6M to $25.3M", at the same precision
 * as `costBand` (a range never reads as a point), or one figure where the ends meet.
 */
export const rangeWords = (low: number, high: number): string => costBandText(low, high).replace('–', ' to ');

/** The status of a season in plain words, for the hovers. */
const STATUS_WORDS: Record<string, string> = {
  pre_arbitration: 'pre-arbitration', arbitration: 'arbitration', free_agent: 'free agency', reserve_clause: 'reserve clause',
  indeterminate: 'not settled', under_contract: 'under contract',
};
const statusWords = (s: string): string => STATUS_WORDS[s] ?? s.replace(/_/g, ' ');

/** Where a projected cost comes from, in plain words (the hover says so; the page never prints "provisional"). */
const sourceWords = (source: string | null): string =>
  !source || source === 'measured' ? '' : ' It rests partly on a starting estimate, not yet measured on this save (provisional).';

/**
 * A season cost's hover: what it is (projected, not committed), its most likely figure (or each status's where it lies
 * between statuses, none chosen), what the range is and its basis as the timeline served it.
 */
const costTitle = (c: SeasonCost): string => {
  const likely = c.central !== null ? ` Most likely ${costMoney(c.central)}.` : c.centrals && c.centrals.length > 0
    ? ` No single most likely figure: it lies between statuses (${c.centrals.map((k) => `${statusWords(k.status)}${k.arbitrationClass ? `, arbitration class ${k.arbitrationClass}` : ''} ${costMoney(k.central)}`).join('; ')}).`
    : '';
  const range = c.low !== null && c.high !== null ? ` Could be ${rangeWords(c.low, c.high)}: ${COST_BAND_WORDS}.` : '';
  const kept = c.ifHeld ? ' "If kept": he may leave instead, or the choice is his; this is what he costs if the club keeps him.' : '';
  return `Projected, not committed.${likely}${range}${kept} ${c.text}${sourceWords(c.source)}`;
};

/** A season's cost as a compact cell: the most likely figure (or the range of them) over the range, "if kept"; its basis on hover. */
function CostWords({ c, lead = '' }: { c: SeasonCost; lead?: string }) {
  if (c.low === null || c.high === null) return <span className="muted"><Tip label={`${lead}not known`} tip={costTitle(c)} /></span>;
  const kept = c.ifHeld ? ' if kept' : '';
  const main = c.central !== null ? costMoney(c.central) : c.low === c.high ? costMoney(c.low) : rangeWords(c.low, c.high);
  return (
    <>
      <span className="contracts-figure"><Tip label={`${lead}${main}${kept}`} tip={costTitle(c)} /></span>
      {c.low !== c.high && c.central !== null && <span className="contracts-sub">{rangeWords(c.low, c.high)}</span>}
    </>
  );
}

/** An option's hover text: not guaranteed, and its declined branch with its cost (an option is shown on both branches). */
const optionTitle = (o: OptionYear): string => {
  const d = o.declined;
  const declined = !d ? '' : d.cost === null
    ? ` Declined: the buyout (not in the export) and then ${statusWords(d.status)}${d.status === 'free_agent' ? ': no cost to this club' : ''}.`
    : ` Declined: the buyout (not in the export) and then ${statusWords(d.status)}. ${costTitle(d.cost)}`;
  return `A ${o.kind === 'opt_out' ? 'season he may opt out before' : `${o.kind} option`}: not guaranteed, and not in the committed total.${declined}`;
};

/** How Payroll labels the club's projected range (owner decision 2, 2026-09-24): what it is, said in the hover. */
export const COMBINED_LABEL = 'players combined as independent; not a calibrated interval';

/**
 * What the projected figures beside each committed season are (owner decision 2, 2026-09-24), in the hover since phase 6e:
 * the sum of the players' most likely costs, and a range around it with each player's distance combined as independent,
 * what is not chance at its ends; every player at the same end is in the details. Not a forecast, never committed.
 */
export const PROJECTED_TIP =
  'What the seasons the club still controls could cost where no contract covers them yet: pre-arbitration renewals and ' +
  'arbitration years. "Most likely" adds up each player\'s most likely cost; where a season could go more than one way ' +
  '(which status, which arbitration year, whether he stays) it is a range, from the lowest way to the highest. "Could be" ' +
  `is a range of reasonable readings for the club, not a forecast: ${COMBINED_LABEL}. Each player's distance from his most ` +
  'likely cost is combined as independent across players, so not every player lands at his high or low end at once; what ' +
  'isn\'t chance (a status still open, a range of arbitration years, a player who may leave) stays at its ends, added, and a ' +
  `player who may leave adds nothing to the low end. Each player's own range is ${COST_BAND_WORDS}, never narrowed; every ` +
  'player at the same end (edge against edge) is in the details below. Not committed, and never in the total or the room.';

/** A club's projected season, in its hover: what it is, how it was combined and what it leaves out. */
const projectedTip = (p: NonNullable<Commitment['projected']>): string =>
  PROJECTED_TIP +
  (p.combination ? ` ${p.combination.text}` : '') +
  (p.mayLeave > 0 ? ` ${p.mayLeave} may reach free agency instead ("if kept"): they add nothing to the low end.` : '') +
  (p.provisional > 0 ? ` ${p.provisional} rest partly on a starting estimate, not yet measured on this save (provisional).` : '') +
  (p.unpriced > 0 ? ` ${p.unpriced} not priced: their cost is not established, never counted as $0.` : '');

/** Dollars per win to the hundredth of a million, so a floor of $4.22M to $4.33M is not printed as "$4.2M". */
const perWin = (v: number): string => `$${(v / 1_000_000).toFixed(2)}M`;

/** "$6.57M to $9.78M", or one figure where the two ends print alike. */
export const perWinRange = (low: number, high: number): string =>
  (perWin(low) === perWin(high) ? perWin(low) : `${perWin(low)} to ${perWin(high)}`);

/** One import's measured reading, in a few words: the price and its range, or why there is none. */
const measuredWords = (m: PriceHistoryEntry['measured']): string => {
  if (!m) return 'not recorded';
  if (m.status === 'measured' && m.central !== null && m.low !== null && m.high !== null) {
    const check = m.check ? `; check per win projected at signing ${perWin(m.check.central)}${m.check.ratio !== null ? ` (${m.check.ratio.toFixed(2)} times)` : ''}` : '';
    return `${perWin(m.central)} per win produced (${perWin(m.low)}–${perWin(m.high)}), ${m.signings} signings${check}`;
  }
  if (m.status === 'no_off_season') return 'no off-season observed yet';
  if (m.status === 'not_measured') return `not measured (${m.signings} signings priced)`;
  return 'unknown';
};

/** The price of a win's hover: what it is, the server's own label, and the floor as the range it is. */
function priceTip(price: ClubFinancesData['league']['priceOfWin']): string {
  const floor = price.floor.value;
  const label = price.label.charAt(0).toUpperCase() + price.label.slice(1);
  return (
    `${label}. What clubs in this league pay above the minimum salary for each win a player adds, read from ` +
    `${price.population.market} market contracts: most likely, with the range it could be.` +
    (floor ? ` Across every major leaguer, including those paid below the market by rule, a win costs less: ${perWinRange(floor.low, floor.high)}, ` +
      `a floor under the price. ${price.floor.note ?? ''}` : '') +
    (price.price.note ? ` ${price.price.note}` : '') +
    ' "How it\'s measured" below lists every basis.'
  );
}

/**
 * The league price of a win (D-25, S-03), in plain words since phase 6e: "A win costs about $7.25M here · could be $6.57M to
 * $9.78M", the server's own label and the floor as the range it is on hover (shown even when the price itself is unknown),
 * and the basis as a list any keyboard can open, rather than a hover-only paragraph.
 */
export function PriceOfWinLine({ price, history, timeline, retention }: { price: ClubFinancesData['league']['priceOfWin']; history?: PriceHistoryEntry[]; timeline?: string | null; retention?: string | null }) {
  const p = price.price.value;
  const a = price.adoption ?? null;
  return (
    <div className="muted hint-line price-of-win">
      {p
        ? <><Tip label={<>A win costs about <strong>{perWin(p.central)}</strong> here</>} tip={priceTip(price)} focusable /> · could be {perWinRange(p.low, p.high)}</>
        : <><Tip label="What a win costs here isn't known" tip={priceTip(price)} focusable />{price.price.note ? `: ${price.price.note}` : ''}</>}
      <details className="price-basis">
        <summary>How it&rsquo;s measured</summary>
        <ul>
          <li>Salary above the league minimum ÷ WAR, over {price.population.market} market contracts.</li>
          {price.rules.market && <li>{price.rules.market}</li>}
          <li>{price.rules.central}</li>
          <li>{price.rules.band}</li>
          {price.rules.floor && <li>{price.rules.floor}</li>}
          {price.stage === 'measured' && <li>The opening reading, not in force (kept for comparison):</li>}
          {price.bases.map((b) => (
            <li key={b.id}>
              {b.id}: {b.description}: {b.perWin.value === null ? `unknown (${b.perWin.note ?? 'not stated'})` : perWin(b.perWin.value)}
            </li>
          ))}
          <li>{price.narrowsWhen}</li>
          {a && <li>{a.reason}</li>}
          {a?.opening?.comparable && (
            <li>Opening band with its sampling (each basis resampled): {perWin(a.opening.comparable.low)}–{perWin(a.opening.comparable.high)}.</li>
          )}
          {a && <li>Measured: {a.measured.price.value ? a.measured.text : (a.measured.price.note ?? a.measured.text)}</li>}
          {a?.measured.check && (
            <li>
              Check on the projection, per win projected at signing (never the price): {perWin(a.measured.check.central)} ({perWin(a.measured.check.low)}–{perWin(a.measured.check.high)})
              {a.measured.check.ratio !== null ? `, ${a.measured.check.ratio.toFixed(2)} times the price per win produced` : ', beside no price per win produced yet'}.
            </li>
          )}
          {a?.measured.bases?.filter((b) => b.status === 'measured').map((b) => (
            <li key={`m-${b.id}`}>
              Measured basis ({b.unit === 'realized' ? 'per win produced: the price' : 'per win projected at signing: the check'}): {b.description}: {perWin(b.central as number)}
              {b.low !== null && b.high !== null ? ` (${perWin(b.low)}–${perWin(b.high)} resampled)` : ''}, {b.signings} signings.
            </li>
          ))}
          {a && <li>{a.rule}</li>}
          {retention && <li>{retention}</li>}
        </ul>
      </details>
      {timeline && <div className="muted">{timeline}</div>}
      {history && history.length > 0 && (
        <details className="price-basis">
          <summary>Price history ({history.length} import{history.length === 1 ? '' : 's'})</summary>
          <ul>
            {history.map((h) => (
              <li key={h.gameDate}>
                {h.gameDate}: opening {h.opening ? `${perWin(h.opening.central)} (${perWin(h.opening.low)}–${perWin(h.opening.high)})` : 'unknown'};
                measured {measuredWords(h.measured)}; in force: {h.inForce}.{h.note ? ` ${h.note}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const TIP_COMMITTED =
  'Guaranteed salary already on the books for that season, summed from every contract — ' +
  'including money still owed to players who were traded or released. It is NOT a payroll ' +
  'projection: arbitration raises and yet-to-be-signed players are not in it, which is why ' +
  'future seasons look so light. What pre-arbitration renewals and arbitration seasons could cost is ' +
  'shown beside it, most likely with the range it could be, never added to it.';
const TIP_HEADROOM =
  'Budget minus committed salary. OOTP never publishes a future budget — the owner does not set ' +
  'one until the offseason — so seasons after this one assume today\'s budget holds flat unless ' +
  'you enter what you expect. Either way, treat the later years as a shape, not a forecast.';

/** How a controlled season's cost was read, in plain words (the hover says it; the page never prints the status code). */
const HOW_READ: Record<string, string> = {
  measured: 'measured on this save',
  provisional: 'a starting estimate until this save has enough renewals of its own (provisional)',
  thin: "too few of this save's contracts for a line of its own: a starting estimate, widened by what this save paid (the provisional prior)",
  prior: 'a starting estimate (the provisional prior)',
  unknown: 'not known',
  no_arbitration: 'this league has no salary arbitration',
};
const howRead = (status: string): string => HOW_READ[status] ?? status.replace(/_/g, ' ');

/** "1st", "2nd", "3rd", "4th". */
const ordinal = (n: number): string => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/**
 * What a controlled season costs (phase 4a), in plain words since phase 6e: a renewal's range and how many renewals it
 * rests on, and how many contracts each arbitration year is read from. Whether each is measured on this save or rests on
 * the provisional prior, and the rules, are on hover and in "How they're priced".
 */
export function CostLadderLine({ costs, observed }: { costs: CostLadderData; observed?: ObservedCostsData }) {
  const r = costs.preArbitration;
  const renewal = r.band.value;
  const arb = costs.arbitration;
  // The provisional prior's line only where something on this save rests on it (review R2-11)
  const usesPrior = r.status === 'provisional' || arb.classes.some((c) => c.status === 'thin' || c.status === 'prior');
  const renewalTip = `A pre-arbitration renewal: ${howRead(r.status)}. ${r.text}`;
  const arbTip = `An arbitration year: ${howRead(arb.status)}.${arb.reason ? ` ${arb.reason}` : ''} ` +
    arb.classes.map((c) => `Year ${c.arbitrationClass}: ${howRead(c.status)}. ${c.text}`).join(' ');
  const arbCases = arb.classes.reduce((n, c) => n + c.cases, 0);
  return (
    <div className="muted hint-line price-of-win">
      What a season the club controls costs:{' '}
      <Tip label="a renewal" tip={renewalTip} focusable />{' '}
      {renewal ? <>costs <strong>{rangeWords(renewal.low, renewal.high)}</strong> ({r.cases} renewals this season)</> : <>isn&rsquo;t known yet</>}
      {' · '}
      <Tip label="an arbitration year" tip={arbTip} focusable />{' '}
      {arb.status === 'no_arbitration'
        ? <>doesn&rsquo;t exist in this league</>
        : arb.classes.length > 0
          ? <>is read from {arbCases} contracts ({arb.classes.map((c) => `${c.cases} in the ${ordinal(c.arbitrationClass)} year`).join(', ')})</>
          : <>isn&rsquo;t known yet</>}
      .
      <details className="price-basis">
        <summary>How they&rsquo;re priced</summary>
        <ul>
          {costs.rules.band && <li>{costs.rules.band}</li>}
          <li>{costs.rules.renewal}</li>
          <li>{r.text}</li>
          <li>{costs.rules.arbitration}</li>
          {arb.reason && <li>{arb.reason}</li>}
          {arb.classes.map((c) => <li key={c.arbitrationClass}>{c.text}</li>)}
          {arb.unread?.text && <li>{arb.unread.text}</li>}
          {usesPrior && <li>{costs.rules.prior}</li>}
          <li>{costs.rules.reserveClause}</li>
          {observed && <li>Observed arbitration salaries: {observed.awards.text}{observed.awards.readingsText ? ` ${observed.awards.readingsText}` : ''}</li>}
          {observed && observed.reserveClause.status === 'measured' && <li>{observed.reserveClause.text}</li>}
        </ul>
      </details>
    </div>
  );
}

/** Where a player stands next season, in words: "arbitration, year 2", "pre-arbitration". */
function standingWords(p: OffTheBooks['players'][number]): string {
  if (p.status === 'arbitration') {
    if (p.superTwo && p.arbYear == null) return 'arbitration (Super Two)';
    if (p.arbYear != null && p.arbYearHigh != null) return `arbitration, year ${p.arbYear} ${p.arbYearHigh - p.arbYear === 1 ? 'or' : 'to'} ${p.arbYearHigh}`;
    return p.arbYear != null ? `arbitration, year ${p.arbYear}` : 'arbitration';
  }
  return p.status === 'reserve clause' ? 'reserve clause' : 'pre-arbitration';
}

/** What a season still open could be, in words: "arbitration or free agency". */
const BETWEEN_WORDS: Record<string, string> = { leaving: 'free agency', signed: 'under contract', indeterminate: 'not known' };
const betweenWords = (between: string[]): string => between.map((b) => BETWEEN_WORDS[b] ?? b).join(' or ');

/**
 * The Payroll page's body: pure, renders what it is given (Player Value phase 6e; `tests/payrollPage.test.ts` renders it
 * straight from the routes). Every figure is the server's, as served; the words follow AGENTS.md "Writing for the GM".
 */
export function PayrollView({ data, finance, onSaveBudget }: {
  data: PayrollData;
  finance: ClubFinancesData | null;
  /** Saves the budget the GM expects next season (null: assume today's holds flat). */
  onSaveBudget: (amount: number | null) => void;
}) {
  const [budgetDraft, setBudgetDraft] = useState(data.nextSeasonBudget ? String(data.nextSeasonBudget / 1_000_000) : '');

  /** Entered in millions, which is how a budget is actually talked about. */
  const saveNextBudget = () => {
    const millions = Number(budgetDraft);
    onSaveBudget(budgetDraft.trim() === '' || !Number.isFinite(millions) || millions <= 0 ? null : millions * 1_000_000);
  };

  const f = finance?.club ?? null;
  const budget = f?.budget.value ?? null;
  const payrollNow = f?.payroll.now.value ?? null;
  const price = finance?.league.priceOfWin ?? null;
  // Leave headroom past the largest value so the budget marker never lands on
  // the track's edge, where a zero-width dashed border is invisible
  const peak = Math.max(...data.commitments.map((c) => c.total), budget ?? 0, 1) * 1.08;

  return (
    <div>
      {data.freshness && (
        <div className="payroll-asof">
          <FreshnessCueLine freshness={data.freshness} />
        </div>
      )}
      {f && (
        <div className="finance-grid">
          <div className="finance-card" title={sourceOf(f.budget)}>
            <span className="muted">Budget</span>
            <strong>{figure(f.budget)}</strong>
          </div>
          <div className="finance-card" title={sourceOf(f.payroll.now)}>
            <span className="muted">Payroll now</span>
            <strong>{figure(f.payroll.now)}</strong>
            {budget !== null && payrollNow !== null && (
              <span className={budget - payrollNow >= 0 ? 'good-text' : 'bad-text'}>
                {budget - payrollNow >= 0 ? '+' : ''}{money(budget - payrollNow)} room
              </span>
            )}
          </div>
          <div className="finance-card" title={sourceOf(f.payroll.nextSeason)}>
            <span className="muted">Payroll next season</span>
            <strong>{figure(f.payroll.nextSeason)}</strong>
            <span className="muted">OOTP estimate</span>
          </div>
          <div className="finance-card" title={[sourceOf(f.revenue), sourceOf(f.expenses)].filter(Boolean).join('\n')}>
            <span className="muted">Revenue / expenses</span>
            <strong>{figure(f.revenue)}</strong>
            <span className="muted">less {figure(f.expenses)}</span>
          </div>
          <div className="finance-card" title={sourceOf(f.cashForTrades)}>
            <span className="muted">Cash for trades</span>
            <strong>{figure(f.cashForTrades)}</strong>
          </div>
        </div>
      )}
      {price && <PriceOfWinLine price={price} history={finance?.priceHistory} timeline={finance?.league.observed?.timeline?.text ?? null} retention={finance?.league.observed?.retention?.text ?? null} />}
      {finance?.winValue && <ClubWinValueLine value={finance.winValue} />}
      {finance?.league.costs && <CostLadderLine costs={finance.league.costs} observed={finance.league.observed} />}

      <section>
        <h2><Tip label="Committed salary by season" tip={TIP_COMMITTED} /></h2>
        <div className="commit-chart">
          {data.commitments.map((c) => {
            const p = c.projected;
            const shown = p && p.players > 0 && p.low !== null && p.high !== null;
            return (
              <div key={c.year} className="commit-row">
                <span className="commit-year">{c.year}</span>
                <div className="commit-track">
                  <div className="commit-bar" style={{ width: `${(c.total / peak) * 100}%` }} />
                  {budget !== null && (
                    <div className="commit-budget" style={{ left: `${(budget / peak) * 100}%` }} title={`Budget ${money(budget)}`} />
                  )}
                </div>
                <span className="commit-value">{money(c.total)}</span>
                <span className="muted commit-players">
                  {c.players} player{c.players === 1 ? '' : 's'}
                  {c.options && c.options.players > 0 && (
                    <> · +{money(c.options.total)} in {c.options.players} club option{c.options.players === 1 ? '' : 's'}, not counted</>
                  )}
                  {(c.unstated ?? 0) > 0 && <> · {c.unstated} salar{c.unstated === 1 ? 'y' : 'ies'} not in the export</>}
                </span>
                <span className="muted commit-projected">
                  {shown && (
                    <>
                      <Tip
                        label={p.central
                          ? `+ most likely ${p.central.low === p.central.high ? costMoney(p.central.low) : rangeWords(p.central.low, p.central.high)}`
                          : '+ controlled seasons'}
                        tip={projectedTip(p)}
                      />
                      {' · '}could be {rangeWords(p.low as number, p.high as number)}
                      {' '}({p.players} player{p.players === 1 ? '' : 's'}{p.mayLeave > 0 ? `, ${p.mayLeave} if kept` : ''})
                    </>
                  )}
                  {p && p.unpriced > 0 && <>{shown ? ' · ' : ''}{p.unpriced} not priced yet</>}
                </span>
                <span className={`commit-room ${(c.headroom ?? 0) >= 0 ? 'good-text' : 'bad-text'}`}>
                  {c.headroom === null ? '' : `${money(c.headroom)} free`}
                  {c.budgetUsed === 'expected' && <span className="muted"> *</span>}
                </span>
              </div>
            );
          })}
        </div>
        <div className="next-budget">
          <label htmlFor="next-budget">Budget you expect next season</label>
          <span className="next-budget-unit">$</span>
          <input
            id="next-budget"
            type="number"
            min="0"
            step="1"
            placeholder={budget !== null ? String(Math.round(budget / 1_000_000)) : ''}
            value={budgetDraft}
            onChange={(e) => setBudgetDraft(e.target.value)}
            onBlur={saveNextBudget}
            onKeyDown={(e) => e.key === 'Enter' && saveNextBudget()}
          />
          <span className="next-budget-unit">M</span>
          <span className="muted">
            {data.nextSeasonBudget
              ? 'Seasons after this one are measured against it, marked *.'
              : 'Leave it empty to assume this year’s budget holds flat.'}
          </span>
        </div>
        <p className="muted hint-line">
          The dashed line is today&rsquo;s budget. <Tip label="Headroom" tip={TIP_HEADROOM} /> in later
          seasons looks wide because only guaranteed deals are counted: arbitration raises and replacements
          will fill much of it. Beside each season is <Tip label="what the players you still control could cost" tip={PROJECTED_TIP} />:
          most likely, and the range it could be. It&rsquo;s never added to the total or the room.
        </p>
        {data.commitments.some((c) => c.projected?.edges) && (
          <details className="price-basis">
            <summary>If every player landed at the same end of his range</summary>
            <ul>
              {data.commitments.filter((c) => c.projected?.edges).map((c) => (
                <li key={c.year}>
                  {c.year}: {rangeWords(c.projected!.edges!.low, c.projected!.edges!.high)} with every player at the same end (edge against edge),
                  against {c.projected!.low !== null && c.projected!.high !== null ? rangeWords(c.projected!.low, c.projected!.high) : 'unknown'} as shown,
                  with players combined as independent ({c.projected!.combination?.combined ?? 0} combined, {c.projected!.combination?.atEdges ?? 0} kept at their ends).
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <div className="two-col">
        <section>
          <h2>
            Leaving after {data.seasonYear}{' '}
            <span className="muted subtle-count">
              — {data.comingOff.count} players, {money(data.comingOff.money)}
            </span>
          </h2>
          <p className="muted hint-line">
            Reaching free agency. This is the money that genuinely comes off the books.
          </p>
          <table className="mini">
            <tbody>
              {data.comingOff.players.map((p) => (
                <tr key={p.player_id}>
                  <td className="name"><PlayerLink id={p.player_id}>{p.name}</PlayerLink></td>
                  <td className="num">{p.age}</td>
                  <td className="num">{money(p.salary)}</td>
                </tr>
              ))}
              {data.comingOff.players.length === 0 && (
                <tr><td className="muted">Nobody reaching free agency.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {/* The distinction a reader asked for: a deal ending is not the same as
            a player leaving, and only one of the two frees any money */}
        {data.stillControlled && data.stillControlled.count > 0 && (
          <section>
            <h2>
              Deals ending, players staying{' '}
              <span className="muted subtle-count">
                — {data.stillControlled.count} players, {money(data.stillControlled.money)}
              </span>
            </h2>
            <p className="muted hint-line">
              Arbitration and pre-arbitration. You keep them, and these salaries are more likely to
              rise than to disappear — so do not count this against next year&rsquo;s payroll. The arrow is
              what next season could cost him: most likely, with the range it could be under it; hover for why.
            </p>
            <table className="mini">
              <tbody>
                {data.stillControlled.players.map((p) => (
                  <tr key={p.player_id}>
                    <td className="name"><PlayerLink id={p.player_id}>{p.name}</PlayerLink></td>
                    <td className="num">{p.age}</td>
                    <td className="muted">{standingWords(p)}</td>
                    <td className="num">{money(p.salary)}</td>
                    <td className="num muted">{p.nextCost ? <em><CostWords c={p.nextCost} lead="→ " /></em> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Neither list: said, not guessed (D-018) */}
        {data.controlIndeterminate && data.controlIndeterminate.count > 0 && (
          <section>
            <h2>
              Deals ending, outcome not known yet{' '}
              <span className="muted subtle-count">
                — {data.controlIndeterminate.count} players, {money(data.controlIndeterminate.money)}
              </span>
            </h2>
            <p className="muted hint-line">
              The save can&rsquo;t yet say whether these players leave or stay: their service crosses a line only
              if they stay up, or a league rule isn&rsquo;t in the export. Each says what it lies between; hover for why.
            </p>
            <table className="mini">
              <tbody>
                {data.controlIndeterminate.players.map((p) => (
                  <tr key={p.player_id}>
                    <td className="name"><PlayerLink id={p.player_id}>{p.name}</PlayerLink></td>
                    <td className="num">{p.age}</td>
                    <td className="muted">
                      <Tip label={p.between && p.between.length > 0 ? betweenWords(p.between) : 'not known'} tip={p.reason ?? 'Not established from the export.'} />
                    </td>
                    <td className="num">{money(p.salary)}</td>
                    <td className="num muted">{p.nextCost ? <em><CostWords c={p.nextCost} lead="→ " /></em> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {data.deadMoney.status !== 'not_established' && data.deadMoney.players.length === 0 && data.deadMoney.note && (
          <section>
            <h2>
              Dead money{' '}
              <span className="muted subtle-count">— none in the export</span>
            </h2>
            <p className="muted hint-line">
              No contract of a player now elsewhere is on this club&rsquo;s books. <Tip label="Retained salary isn't in the export" tip={data.deadMoney.note} />.
            </p>
          </section>
        )}

        {data.deadMoney.status === 'not_established' && (
          <section>
            <h2>
              Dead money{' '}
              <span className="muted subtle-count">— not known</span>
            </h2>
            <p className="muted hint-line">
              <Tip label="Retained salary isn't in the export" tip={data.deadMoney.note ?? 'Retained salary is not exported.'} />, so whether the club still pays players it moved can&rsquo;t be told.
            </p>
          </section>
        )}

        {data.deadMoney.players.length > 0 && (
          <section>
            <h2>
              Dead money{' '}
              <span className="muted subtle-count">— still owed to players who left</span>
            </h2>
            <table className="mini">
              <tbody>
                {data.deadMoney.players.map((p) => (
                  <tr key={p.player_id}>
                    <td className="name"><PlayerLink id={p.player_id}>{p.name}</PlayerLink></td>
                    <td className="num">{money(p.salary)}</td>
                  </tr>
                ))}
                <tr>
                  <td><strong>Total</strong></td>
                  <td className="num"><strong>{money(data.deadMoney.total)}</strong></td>
                </tr>
              </tbody>
            </table>
          </section>
        )}
      </div>

      <section>
        <h2>Every contract</h2>
        {/* Projected figures widen the season columns: the table scrolls in its own box, never the page */}
        <div className="payroll-table-scroll">
        <table>
          <thead>
            <tr>
              <Th>Player</Th>
              <Th>Pos</Th>
              <Th>Age</Th>
              {data.years.map((y) => (
                <Th
                  key={y}
                  className="num"
                  tip={
                    y === data.seasonYear
                      ? `Guaranteed salary owed in ${y}, the current season.`
                      : `Guaranteed salary already committed for ${y}. Blank means the contract has ended by then — it does not mean the player is gone, only that he is no longer under contract. An italic figure is what a season the club still controls could cost (a pre-arbitration renewal or an arbitration year): most likely, with the range it could be under it, projected and not committed. "If kept" means he may leave instead.`
                  }
                >
                  {String(y)}
                </Th>
              ))}
              <Th>Through</Th>
              <Th>Shape</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {data.players.map((p) => (
              <tr key={p.player_id} className={p.deadMoney ? 'row-dead' : ''}>
                <td className="name">
                  <PlayerLink id={p.player_id}>{p.name}</PlayerLink>
                  {p.deadMoney && <span className="role-tag">DEAD</span>}
                </td>
                <td>{p.positionName}</td>
                <td className="num">{p.age}</td>
                {p.byYear.map((v, i) => {
                  const year = data.years[i];
                  const option = p.optionYears?.find((o) => o.season === year && !o.committed);
                  if (option) {
                    const declined = option.declined?.cost ?? null;
                    return (
                      <td key={year} className="num muted">
                        <em><Tip label={option.salary === null ? 'option' : `option ${money(option.salary)}`} tip={optionTitle(option)} /></em>
                        {declined && declined.low !== null && declined.high !== null && (
                          <div className="muted">
                            or {declined.central !== null ? costMoney(declined.central) : rangeWords(declined.low, declined.high)}{declined.ifHeld ? ' if kept' : ''} if declined
                          </div>
                        )}
                      </td>
                    );
                  }
                  if (p.unstatedYears?.includes(year)) {
                    return <td key={year} className="num muted" title="The contract covers this season but the export does not state its salary: unknown, never $0">?</td>;
                  }
                  // Phase 4a: a controlled season no contract covers, projected (never committed)
                  const projected = p.projected?.[i] ?? null;
                  if (projected) {
                    return (
                      <td key={year} className="num muted">
                        <em><CostWords c={projected} /></em>
                      </td>
                    );
                  }
                  return <td key={year} className="num">{v ? money(v) : ''}</td>;
                })}
                <td className="num">{p.endYear}</td>
                <td>
                  {/* Backloaded vs frontloaded deals are obvious as a shape and
                      invisible as six columns of numbers */}
                  <Sparkline points={p.byYear.filter((v) => v !== null && v > 0)} />
                </td>
                <td className="reasons">{p.options.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}

export function Payroll({ orgId }: { orgId: number }) {
  const [data, setData] = useState<PayrollData | null>(null);
  const [finance, setFinance] = useState<ClubFinancesData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveNextBudget = async (amount: number | null) => {
    try {
      await apiPut(`/api/next-season-budget/${orgId}`, { amount });
      setData(await apiGet<PayrollData>(`/api/payroll/${orgId}`));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    setData(null);
    setError(null);
    apiGet<PayrollData>(`/api/payroll/${orgId}`)
      .then(setData)
      .catch((e) => setError(e.message));
    // The header and the price of a win are Club Finances'; the page stands without them
    setFinance(null);
    apiGet<ClubFinancesData>(`/api/club-finances/${orgId}`).then(setFinance).catch(() => setFinance(null));
  }, [orgId]);

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <p className="muted">Adding up the books…</p>;
  return <PayrollView key={orgId} data={data} finance={finance} onSaveBudget={saveNextBudget} />;
}
