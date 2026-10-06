/**
 * Finance's words (N12, D-071): what the React pages wrote on the client (`src/pages/Payroll.tsx`, `Contracts.tsx`,
 * `FreeAgents.tsx`, `src/costBand.ts`, `src/valueWords.ts`), moved to the server so the Mac app writes none of it
 * (D-056). The React pages keep their own copy until the cutover (D-066's precedent); these say the same things, in the
 * GM's words, the method words kept in the bases and breakdowns (AGENTS.md "Writing for the GM"). Nothing here computes
 * a figure: every number is Player Value's, Player Rights', Club Finances' or the export's, as handed in.
 */
import type { BasisLine, Cell, Claim } from '../../contract/presentation.js';
import { basis, cell, claim, servedValue, unknownValue } from '../claim.js';
import { hintIf, officeFacts, type OfficeContext } from '../officeTable.js';
import { costRangeText, money, rangeText, signedMoney, signedTenths } from '../player/words.js';

export { costRangeText, money, rangeText, signedMoney, signedTenths };

/** A season at the market in plain money ("$23.1M"), never signed like a surplus; one below zero reads "−$1.2M". */
export const marketMoney = (v: number): string => (v < 0 ? `−${money(-v)}` : money(v));

/** "$4.6M to $25.3M": a range the way the pages say it, never reading as a point. */
export const rangeWords = (low: number, high: number): string => costRangeText(low, high).replace('–', ' to ');

/** What every cost band is (`src/costBand.ts`), for the hovers and breakdowns. */
export const COST_BAND_WORDS =
  'a range of reasonable readings, edge against edge (every component at its low edge, every component at its high edge): not an interval with a stated chance, and not an expectation';

/** How Payroll labels the club's projected range (owner decision 2, 2026-09-24), said in the breakdown. */
export const COMBINED_LABEL = 'players combined as independent; not a calibrated interval';

/** A season's status in plain words, for the hovers. */
const STATUS_WORDS: Record<string, string> = {
  pre_arbitration: 'pre-arbitration', arbitration: 'arbitration', free_agent: 'free agency', reserve_clause: 'reserve clause',
  indeterminate: 'not settled', under_contract: 'under contract',
};
export const statusWords = (s: string): string => STATUS_WORDS[s] ?? s.replace(/_/g, ' ');

/** A season's projected cost as Player Value's timeline serves it (`contracts.ts`'s `SeasonCost`). */
export interface CostInput {
  low: number | null;
  high: number | null;
  central: number | null;
  centrals?: Array<{ status: string; central: number; arbitrationClass?: number }> | null;
  text: string;
  source: string | null;
  ifHeld: boolean;
}

/** Where a projected cost comes from, said in the breakdown (the page never prints "provisional"). */
const sourceWords = (source: string | null): string =>
  !source || source === 'measured' ? '' : ' It rests partly on a starting estimate, not yet measured on this save (provisional).';

/** A season cost's explanation: projected, not committed, its most likely figure (or each status's), its range and basis. */
export function costExplanation(c: CostInput): string {
  const likely = c.central !== null ? ` Most likely ${money(c.central)}.` : c.centrals && c.centrals.length > 0
    ? ` No single most likely figure: it lies between statuses (${c.centrals.map((k) => `${statusWords(k.status)}${k.arbitrationClass ? `, arbitration class ${k.arbitrationClass}` : ''} ${money(k.central)}`).join('; ')}).`
    : '';
  const range = c.low !== null && c.high !== null ? ` Could be ${rangeWords(c.low, c.high)}: ${COST_BAND_WORDS}.` : '';
  const kept = c.ifHeld ? ' "If kept": he may leave instead, or the choice is his; this is what he costs if the club keeps him.' : '';
  return `Projected, not committed.${likely}${range}${kept} ${c.text}${sourceWords(c.source)}`.trim();
}

/** A cell with its sort key. */
export interface Sorted {
  cell: Cell;
  sort: number | string | null;
}

/** A season's cost as a compact cell (most likely, "if kept", the range in the help tag); unknown with its reason. */
export function costCell(c: CostInput | null | undefined, none: string): Sorted {
  if (!c) return { cell: cell('None', { hint: hintIf(none) }), sort: null };
  if (c.low === null || c.high === null) return { cell: cell('Not known', { tone: 'unknown', hint: hintIf(c.text) ?? 'Not established' }), sort: null };
  const held = c.ifHeld ? ' if kept' : '';
  // Sorted on the most likely figure, else the low edge: never a midpoint nobody stated (D-018)
  const order = c.central ?? c.low;
  if (c.low === c.high) return { cell: cell(`${money(c.low)}${held}`), sort: order };
  const main = c.central !== null ? money(c.central) : costRangeText(c.low, c.high);
  return { cell: cell(`${main}${held}`, { hint: `Could be ${rangeWords(c.low, c.high)}` }), sort: order };
}

/** A wins figure (most likely, the range in the help tag); unknown with its reason. */
export function winsCell(w: { low: number; central: number; high: number } | null, reason: string | null, none = 'Not known'): Sorted {
  if (!w) return { cell: cell(none, { tone: 'unknown', hint: hintIf(reason) ?? 'Not established' }), sort: null };
  return { cell: cell(signedTenths(w.central), { hint: `Could be ${rangeText(w.low, w.high, signedTenths)} wins` }), sort: w.central };
}

/** "2026–2030", or one season. */
export const seasonsText = (from: number | null, to: number | null): string =>
  (from === null ? '' : from === to || to === null ? `${from}` : `${from}–${to}`);

/** A value total as served (`SurplusTotal`): known or not, its central and range. */
export interface TotalInput {
  status: string;
  from: number | null;
  to: number | null;
  low: number | null;
  central: number | null;
  high: number | null;
  centralRange: { low: number; high: number } | null;
  reason: string | null;
}

/** A total as a compact cell: the figure (or the range of most likely figures), the range in the help tag, its explanation. */
export function totalCell(total: TotalInput | null | undefined, unit: 'dollars' | 'wins', fallback: string | null): Sorted & { explain: string } {
  const fmt = unit === 'dollars' ? signedMoney : (v: number) => `${signedTenths(v)} wins`;
  if (!total || total.status !== 'known' || total.low === null || total.high === null) {
    const why = total?.reason ?? fallback ?? 'Not established.';
    return { cell: cell('Not valued', { tone: 'unknown', hint: hintIf(why) }), sort: null, explain: why };
  }
  const couldBe = rangeText(total.low, total.high, fmt);
  const seasons = seasonsText(total.from, total.to);
  const over = seasons ? `Over ${seasons}, seasons further out counting a little less: ` : '';
  if (total.central !== null) {
    return {
      cell: cell(fmt(total.central), { hint: hintIf(`Could be ${couldBe}`) }),
      sort: total.central,
      explain: `${over}most likely ${fmt(total.central)}, could be ${couldBe}.`,
    };
  }
  const r = total.centralRange ?? { low: total.low, high: total.high };
  const figure = rangeText(r.low, r.high, fmt);
  return {
    cell: cell(figure, { hint: hintIf(`Could be ${couldBe}`) }),
    // No single most likely figure: sorted on the low edge of the most likely ones, never their midpoint (D-018)
    sort: r.low,
    explain: `${over}no single most likely figure: ${figure} depending on a season that could go more than one way (his window says which); could be ${couldBe}.`,
  };
}

/** When his control ends, as served (`ControlEnd`). */
export interface ControlEndInput {
  low: number | null;
  high: number | null;
  pastHorizon: boolean;
  optOutBefore: number | null;
  laterUnknown?: boolean;
  heldThrough?: number | null;
  reason: string | null;
}

/** The last season the club controls him, short ("2028", "2026 or 2027", "past 2032", "not known"), with its sort key. */
export function controlEndCell(end: ControlEndInput): Sorted {
  const hint = hintIf(end.reason);
  if (end.high === null && end.laterUnknown && end.low !== null) return { cell: cell(`${end.low} or later`, { hint }), sort: end.low + 0.25 };
  if (end.high === null && end.heldThrough != null) return { cell: cell(`${end.heldThrough} or later`, { hint }), sort: end.heldThrough + 0.25 };
  if (end.high === null) return { cell: cell('Not known', { tone: 'unknown', hint: hint ?? 'Not established from the export' }), sort: null };
  const sort = end.high + (end.pastHorizon ? 0.5 : 0);
  if (end.pastHorizon) return { cell: cell(`Past ${end.high}`, { hint }), sort };
  if (end.low === null || end.low === end.high) return { cell: cell(`${end.high}`, { hint }), sort };
  if (end.high - end.low === 1) return { cell: cell(`${end.low} or ${end.high}`, { hint }), sort };
  return { cell: cell(`${end.low}–${end.high}`, { hint }), sort };
}

/** The club's finance figures as Contracts and Free Agents serve them (`financeCards`). */
export interface CardsInput {
  budget: number | null;
  payroll: number | null;
  payrollNextSeason: number | null;
  cash: number | null;
  sources?: Partial<Record<'budget' | 'payroll' | 'payrollNextSeason' | 'cash', string | null>>;
}

const SPECIALIST_FINANCES = 'Club Finances';

/** One money figure with its source, or "Not in the export" (never $0 for a missing value, D-018). */
function moneyFigure(ctx: OfficeContext, text: string, value: number | null, source: string | null | undefined, extra: { hint?: string; tone?: 'good' | 'bad' } = {}) {
  return claim({
    text,
    tone: value === null ? 'unknown' : extra.tone ?? 'neutral',
    hint: extra.hint,
    value: value === null ? unknownValue('dollars', 'Not in the export') : servedValue(value, 'dollars', signedMoney(value)),
    basis: officeFacts(ctx, SPECIALIST_FINANCES, [{ label: text, value: value === null ? 'Not in the export' : signedMoney(value) }, ...(source ? [{ label: 'Source', value: source }] : [])],
      value === null ? [`${text} isn't in the export.`] : []),
  });
}

/** Budget, payroll now and room, next season's payroll and room, cash for trades: the React pages' finance cards. */
export function financeCards(ctx: OfficeContext, f: CardsInput | null) {
  if (!f) return [];
  const room = (budget: number | null, payroll: number | null) => (budget !== null && payroll !== null ? budget - payroll : null);
  const roomNow = room(f.budget, f.payroll);
  const roomNext = room(f.budget, f.payrollNextSeason);
  const roomClaim = (text: string, v: number | null, of: string) => claim({
    text,
    tone: v === null ? 'unknown' : v < 0 ? 'bad' : 'good',
    value: v === null ? unknownValue('dollars', 'Not known') : servedValue(v, 'dollars', signedMoney(v)),
    basis: officeFacts(ctx, SPECIALIST_FINANCES, [{ label: 'How it is read', value: `The budget less ${of}, both as the export states them.` }],
      v === null ? ['The budget or the payroll isn\'t in the export.'] : []),
  });
  return [
    moneyFigure(ctx, 'Budget', f.budget, f.sources?.budget),
    moneyFigure(ctx, 'Payroll now', f.payroll, f.sources?.payroll),
    roomClaim('Room now', roomNow, 'the payroll now'),
    moneyFigure(ctx, 'Payroll next season', f.payrollNextSeason, f.sources?.payrollNextSeason, { hint: "OOTP's estimate" }),
    roomClaim('Room next season', roomNext, "OOTP's estimate of next season's payroll"),
    moneyFigure(ctx, 'Cash for trades', f.cash, f.sources?.cash),
  ];
}

/**
 * The price of a win as a page's context line ("A win costs about $X here"), its reading and stage in the basis: the
 * league's own market read at this import, or measured from the save's signings across imports (phase 4b).
 */
export function perWinLine(ctx: OfficeContext, text: string, explanation: string, stage: string, extra: BasisLine[] = []) {
  return claim({
    text,
    tone: 'neutral',
    basis: basis({
      because: [{ label: 'How it is read', value: explanation }, ...extra],
      source: { department: ctx.department, specialist: 'Club Finances', asOf: ctx.importStamp, gameDate: ctx.gameDate },
      unknown: [],
      wouldChange: ['A new import: the market is read again each time.'],
      lean: null,
      certainty: 'calibrated',
      stamp: stage === 'measured' ? "Measured from this save's own signings across imports" : "Read from this league's market contracts at this import",
    }),
  });
}

/** A price of a win to the hundredth of a million: "$7.25M". */
export const perWin = (v: number): string => `$${(v / 1_000_000).toFixed(2)}M`;

/** "$6.57M to $9.78M", or one figure where the two ends print alike. */
export const perWinRange = (low: number, high: number): string => (perWin(low) === perWin(high) ? perWin(low) : `${perWin(low)} to ${perWin(high)}`);
