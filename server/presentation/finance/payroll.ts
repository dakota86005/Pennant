/**
 * Finance's Payroll & Budget for the Mac app (N12, D-071): committed money by season against the club's budget, what
 * the seasons the club still controls could cost beside it (never in it), who comes off the books and who stays, and
 * every contract, as `computePayroll` reads them through Player Value and Club Finances (D-052), worded as the React
 * page (`src/pages/Payroll.tsx`) words them. The budget rule is the club's own figure as exported; seasons after this one
 * read against the budget the GM expects when he has entered one, else today's held flat, and an unknown budget is
 * "not known". The club's value of a win in playoff odds is not served here (D-060: odds live only on Standings). Pure.
 */
import type { computePayroll } from '../../payroll.js';
import type { clubFinances, LeagueFinances } from '../../playerValue.js';
import type { BasisLine, Cell, Claim } from '../../contract/presentation.js';
import { basis, cell, claim, servedValue, unknownValue } from '../claim.js';
import {
  column, counted, fact, hintIf, officeFacts, officeHead, officeLede, officePlayer, officeRow, officeSource, paneTable,
  type OfficeContext, type OfficeFact, type OfficeRow, type OfficeTable,
} from '../officeTable.js';
import { ordinal } from '../player/words.js';
import type { FinanceBudgetChange, FinancePayrollSeason, FinancePayrollSection, FinancePayrollView } from './types.js';
import {
  COMBINED_LABEL, COST_BAND_WORDS, costCell, costExplanation, money, perWin, perWinRange, rangeWords, statusWords, type CostInput,
} from './words.js';

type Payroll = ReturnType<typeof computePayroll>;
type Commitment = Payroll['commitments'][number];
type PayrollPlayer = Payroll['players'][number];
type Brief = Payroll['comingOff'];

/** One import's reading of the price of a win, as Club Finances' history serves it (`priceHistory`). */
export interface PriceHistoryEntry {
  gameDate: string;
  inForce: string;
  opening: { central: number; low: number; high: number } | null;
  measured: { status: string; signings: number; central: number | null; low: number | null; high: number | null; check: { central: number; ratio: number | null } | null } | null;
  note: string | null;
}

const SPECIALIST = 'Payroll';
const FINANCES = 'Club Finances';

export const TIP_COMMITTED =
  'Guaranteed salary already on the books for that season, summed from every contract, including money still owed to ' +
  'players who were traded or released. It is not a payroll projection: arbitration raises and yet-to-be-signed players ' +
  'are not in it, which is why future seasons look so light. What pre-arbitration renewals and arbitration seasons could ' +
  'cost is shown beside it, most likely with the range it could be, never added to it.';
export const TIP_HEADROOM =
  "Budget minus committed salary. OOTP never publishes a future budget (the owner does not set one until the offseason), " +
  "so seasons after this one assume today's budget holds flat unless you enter what you expect. Either way, treat the " +
  'later years as a shape, not a forecast.';
export const PROJECTED_TIP =
  'What the seasons the club still controls could cost where no contract covers them yet: pre-arbitration renewals and ' +
  'arbitration years. "Most likely" adds up each player\'s most likely cost; where a season could go more than one way ' +
  '(which status, which arbitration year, whether he stays) it is a range, from the lowest way to the highest. "Could be" ' +
  `is a range of reasonable readings for the club, not a forecast: ${COMBINED_LABEL}. Each player's distance from his most ` +
  'likely cost is combined as independent across players, so not every player lands at his high or low end at once; what ' +
  'isn\'t chance (a status still open, a range of arbitration years, a player who may leave) stays at its ends, added, and a ' +
  `player who may leave adds nothing to the low end. Each player's own range is ${COST_BAND_WORDS}, never narrowed. ` +
  'Not committed, and never in the total or the room.';

/** How a controlled season's cost was read, in plain words (the breakdown says it; the page never prints the status code). */
const HOW_READ: Record<string, string> = {
  measured: 'measured on this save',
  provisional: 'a starting estimate until this save has enough renewals of its own (provisional)',
  thin: "too few of this save's contracts for a line of its own: a starting estimate, widened by what this save paid (the provisional prior)",
  prior: 'a starting estimate (the provisional prior)',
  unknown: 'not known',
  no_arbitration: 'this league has no salary arbitration',
};
const howRead = (status: string): string => HOW_READ[status] ?? status.replace(/_/g, ' ');

/** A club's projected season, in its breakdown: what it is, how it was combined and what it leaves out. */
function projectedLines(p: Commitment['projected']): BasisLine[] {
  const out: BasisLine[] = [{ label: 'What it is', value: PROJECTED_TIP }];
  if (p.combination) out.push({ label: 'How it is combined', value: p.combination.text });
  if (p.edges) out.push({ label: 'Every player at the same end', value: rangeWords(p.edges.low, p.edges.high) });
  if (p.mayLeave > 0) out.push({ label: 'If kept', value: `${p.mayLeave} may reach free agency instead ("if kept"): they add nothing to the low end.` });
  if (p.provisional > 0) out.push({ label: 'Starting estimates', value: `${p.provisional} rest partly on a starting estimate, not yet measured on this save (provisional).` });
  if (p.unpriced > 0) out.push({ label: 'Not priced', value: `${p.unpriced} not priced: their cost is not established, never counted as $0.` });
  return out;
}

/** The season's most likely projected figure, as the page words it: one figure, or the range of most likely figures. */
function likelyWords(p: Commitment['projected']): string | null {
  const c = p.central as { low: number; high: number } | null;
  if (!c) return null;
  return c.low === c.high ? money(c.low) : rangeWords(c.low, c.high);
}

function seasonOf(ctx: OfficeContext, c: Commitment, thisSeason: number, budget: number | null, expected: number | null): FinancePayrollSeason {
  const against = c.year > thisSeason ? (expected ?? budget) : budget;
  const p = c.projected;
  const shown = p.players > 0 && p.low !== null && p.high !== null;
  const likely = shown ? likelyWords(p) : null;
  const central = p.central as { low: number; high: number } | null;
  const playersLine = [
    counted(c.players, 'player'),
    ...(c.options.players > 0 ? [`+${money(c.options.total)} in ${counted(c.options.players, 'club option')}, not counted`] : []),
    ...(c.unstated > 0 ? [`${counted(c.unstated, 'salary', 'salaries')} not in the export`] : []),
  ].join(' · ');
  const projectedText = shown
    ? `${likely ? `Most likely +${likely}` : '+ controlled seasons'} · could be ${rangeWords(p.low!, p.high!)} (${counted(p.players, 'player')}${p.mayLeave > 0 ? `, ${p.mayLeave} if kept` : ''})`
    : null;
  const roomText = c.headroom === null ? 'Room not known' : `${money(c.headroom)} free${c.budgetUsed === 'expected' ? ' against the budget you expect' : ''}`;
  const because: BasisLine[] = [
    { label: 'Committed', value: money(c.total) },
    { label: 'What committed means', value: TIP_COMMITTED },
    { label: 'Players', value: playersLine },
    { label: 'Measured against', value: against === null ? 'No budget in the export' : `${money(against)}${c.year > thisSeason ? (c.budgetUsed === 'expected' ? ', the budget you expect next season' : ", today's budget held flat") : ", this season's budget"}` },
    { label: 'Room', value: roomText },
    { label: 'What room means', value: TIP_HEADROOM },
    ...(shown ? projectedLines(p) : []),
    ...(p.unpriced > 0 && !shown ? [{ label: 'Not priced', value: `${p.unpriced} not priced yet.` }] : []),
  ];
  return {
    season: c.year,
    committed: c.total,
    projected: shown ? { low: p.low!, high: p.high!, likelyLow: central?.low ?? null, likelyHigh: central?.high ?? null } : null,
    budget: against,
    claim: claim({
      text: `${c.year}: ${money(c.total)} committed`,
      tone: 'neutral',
      value: servedValue(c.total, 'dollars', money(c.total)),
      basis: basis({
        because,
        source: officeSource(ctx, SPECIALIST),
        unknown: [
          ...(c.unstated > 0 ? [`${counted(c.unstated, 'salary', 'salaries')} the contract covers but the export doesn't state.`] : []),
          ...(against === null ? ["The club's budget isn't in the export."] : []),
          ...(p.unpriced > 0 ? [`${p.unpriced} controlled seasons not priced.`] : []),
        ],
        wouldChange: c.year > thisSeason ? ['Entering the budget you expect next season.'] : [],
        lean: null,
        certainty: 'fact',
      }),
    }),
    committedCell: cell(money(c.total)),
    playersCell: cell(playersLine),
    projectedCell: projectedText ? cell(projectedText, { hint: 'Projected, never in the total or the room' }) : p.unpriced > 0 ? cell(`${p.unpriced} not priced yet`, { tone: 'unknown' }) : null,
    roomCell: c.headroom === null
      ? cell('Room not known', { tone: 'unknown', hint: "The club's budget isn't in the export" })
      : cell(`${money(c.headroom)} free`, { tone: c.headroom < 0 ? 'bad' : 'good', hint: c.budgetUsed === 'expected' ? 'Against the budget you expect next season' : c.year > thisSeason ? "Against today's budget, held flat" : undefined }),
  };
}

/** One money figure from Club Finances, with its source; "Not in the export" where the export doesn't state it. */
function financeFigure(ctx: OfficeContext, text: string, s: { value: number | null; source?: string | null; note?: string | null } | undefined, extra: { hint?: string; tone?: 'good' | 'bad' } = {}) {
  const v = s?.value ?? null;
  const source = [s?.source, s?.note].filter(Boolean).join(' — ');
  return claim({
    text,
    tone: v === null ? 'unknown' : extra.tone ?? 'neutral',
    hint: extra.hint,
    value: v === null ? unknownValue('dollars', 'Not in the export') : servedValue(v, 'dollars', money(v)),
    basis: officeFacts(ctx, FINANCES, [{ label: text, value: v === null ? 'Not in the export' : money(v) }, ...(source ? [{ label: 'Source', value: source }] : [])],
      v === null ? [`${text} isn't in the export.`] : []),
  });
}

/** The React page's finance cards: budget, payroll now with the room, next season's payroll, revenue and expenses, cash. */
function cardsOf(ctx: OfficeContext, club: ReturnType<typeof clubFinances> | null) {
  if (!club) return [];
  const budget = club.budget.value;
  const now = club.payroll.now.value;
  const room = budget !== null && now !== null ? budget - now : null;
  return [
    financeFigure(ctx, 'Budget', club.budget),
    financeFigure(ctx, 'Payroll now', club.payroll.now, room === null ? {} : { hint: `${room >= 0 ? '+' : ''}${money(room)} room`, tone: room < 0 ? 'bad' : 'good' }),
    financeFigure(ctx, 'Payroll next season', club.payroll.nextSeason, { hint: 'OOTP estimate' }),
    financeFigure(ctx, 'Revenue', club.revenue, club.expenses.value !== null ? { hint: `Less ${money(club.expenses.value)} in expenses` } : {}),
    financeFigure(ctx, 'Expenses', club.expenses),
    financeFigure(ctx, 'Cash for trades', club.cashForTrades),
  ];
}

/** The price of a win: "A win costs about $7.25M here · could be …", every basis in "How it's measured". */
function priceOf(ctx: OfficeContext, league: LeagueFinances, history: readonly PriceHistoryEntry[]): { price: Claim; history: Claim | null } {
  const price = league.priceOfWin;
  const p = price.price.value;
  const a = price.adoption ?? null;
  const floor = price.floor.value;
  const label = price.label.charAt(0).toUpperCase() + price.label.slice(1);
  const lines: BasisLine[] = [
    { label: 'What it is', value: `${label}. What clubs in this league pay above the minimum salary for each win a player adds, read from ${price.population.market} market contracts: most likely, with the range it could be.` },
    ...(floor ? [{ label: 'A floor under it', value: `Across every major leaguer, including those paid below the market by rule, a win costs less: ${perWinRange(floor.low, floor.high)}. ${price.floor.note ?? ''}`.trim() }] : []),
    { label: 'How it is measured', value: `Salary above the league minimum ÷ WAR, over ${price.population.market} market contracts.` },
    ...(price.rules.market ? [{ label: 'The market', value: price.rules.market }] : []),
    { label: 'Most likely', value: price.rules.central },
    { label: 'The range', value: price.rules.band },
    ...(price.rules.floor ? [{ label: 'The floor', value: price.rules.floor }] : []),
    ...price.bases.map((b) => ({
      label: price.stage === 'measured' ? `Opening reading, not in force: ${b.id}` : b.id,
      value: `${b.description}: ${b.perWin.value === null ? `unknown (${b.perWin.note ?? 'not stated'})` : perWin(b.perWin.value)}`,
    })),
    { label: 'When it narrows', value: price.narrowsWhen },
  ];
  if (a) {
    lines.push({ label: 'Which price is in force', value: a.reason });
    if (a.opening?.comparable) lines.push({ label: 'Opening reading with its sampling', value: `${perWin(a.opening.comparable.low)}–${perWin(a.opening.comparable.high)}` });
    lines.push({ label: 'Measured', value: a.measured.price.value ? a.measured.text : (a.measured.price.note ?? a.measured.text) });
    if (a.measured.check) {
      lines.push({
        label: 'Check on the projection (never the price)',
        value: `Per win projected at signing: ${perWin(a.measured.check.central)} (${perWin(a.measured.check.low)}–${perWin(a.measured.check.high)})${a.measured.check.ratio !== null ? `, ${a.measured.check.ratio.toFixed(2)} times the price per win produced` : ', beside no price per win produced yet'}.`,
      });
    }
    for (const b of a.measured.bases?.filter((x) => x.status === 'measured') ?? []) {
      lines.push({
        label: b.unit === 'realized' ? 'Measured, per win produced (the price)' : 'Measured, per win projected at signing (the check)',
        value: `${b.description}: ${perWin(b.central as number)}${b.low !== null && b.high !== null ? ` (${perWin(b.low)}–${perWin(b.high)} resampled)` : ''}, ${b.signings} signings.`,
      });
    }
    lines.push({ label: 'The rule', value: a.rule });
  }
  if (league.observed.retention.text) lines.push({ label: 'Imports kept', value: league.observed.retention.text });
  if (league.observed.timeline.text) lines.push({ label: "The save's timeline", value: league.observed.timeline.text });
  const priceClaim = claim({
    text: p ? `A win costs about ${perWin(p.central)} here · could be ${perWinRange(p.low, p.high)}` : "What a win costs here isn't known",
    tone: p ? 'neutral' : 'unknown',
    basis: basis({
      because: lines,
      source: officeSource(ctx, FINANCES),
      unknown: p ? [] : [price.price.note ?? 'The league\'s market could not be read.'],
      wouldChange: ['A new import: the market is read again each time.'],
      lean: null,
      certainty: p ? 'calibrated' : 'unknown',
      ...(p ? { stamp: price.stage === 'measured' ? "Measured from this save's own signings across imports" : "Read from this league's market contracts at this import" } : {}),
    }),
  });
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
  const historyClaim = history.length > 0
    ? claim({
        text: `Price history (${counted(history.length, 'import')})`,
        tone: 'neutral',
        basis: basis({
          because: history.map((h) => ({
            label: h.gameDate,
            value: `Opening ${h.opening ? `${perWin(h.opening.central)} (${perWin(h.opening.low)}–${perWin(h.opening.high)})` : 'unknown'}; measured ${measuredWords(h.measured)}; in force: ${h.inForce}.${h.note ? ` ${h.note}` : ''}`,
          })),
          source: officeSource(ctx, FINANCES),
          unknown: [],
          wouldChange: [],
          lean: null,
          certainty: 'recorded',
        }),
      })
    : null;
  return { price: priceClaim, history: historyClaim };
}

/** How an arbitration year is read, in the costs line: from how many of the save's contracts, or that it can't be yet. */
export function arbitrationYearWords(status: string, classes: ReadonlyArray<{ cases: number; arbitrationClass: number }>, cases: number): string {
  if (status === 'no_arbitration') return "an arbitration year doesn't exist in this league";
  if (classes.length === 0) return "an arbitration year isn't known yet";
  // None of the save's own contracts to read yet: said as that, never "read from 0 contracts"
  if (cases === 0) return 'no arbitration contracts on this save to read an arbitration year from yet';
  const read = classes.filter((c) => c.cases > 0).map((c) => `${c.cases} in the ${ordinal(c.arbitrationClass)} year`).join(', ');
  return `an arbitration year is read from ${counted(cases, 'contract')} (${read})`;
}

/** What a season the club controls costs: a renewal's range and how many arbitration contracts each year is read from. */
function costsOf(ctx: OfficeContext, league: LeagueFinances) {
  const costs = league.costs;
  const r = costs.preArbitration;
  const renewal = r.band.value;
  const arb = costs.arbitration;
  const usesPrior = r.status === 'provisional' || arb.classes.some((c) => c.status === 'thin' || c.status === 'prior');
  const arbCases = arb.classes.reduce((n, c) => n + c.cases, 0);
  const renewalWords = renewal ? `a renewal costs ${rangeWords(renewal.low, renewal.high)} (${r.cases} renewals this season)` : "a renewal isn't known yet";
  const arbWords = arbitrationYearWords(arb.status, arb.classes, arbCases);
  const observed = league.observed as unknown as { awards?: { text: string; readingsText?: string | null }; reserveClause?: { status: string; text: string } };
  const because: BasisLine[] = [
    { label: 'A renewal', value: `A pre-arbitration renewal: ${howRead(r.status)}. ${r.text}` },
    { label: 'An arbitration year', value: `${howRead(arb.status)}.${arb.reason ? ` ${arb.reason}` : ''}` },
    ...arb.classes.map((c) => ({ label: `Year ${c.arbitrationClass}`, value: `${howRead(c.status)}. ${c.text}` })),
    ...(costs.rules.band ? [{ label: 'The range', value: costs.rules.band }] : []),
    { label: 'Renewals', value: costs.rules.renewal },
    { label: 'Arbitration', value: costs.rules.arbitration },
    ...(arb.unread?.text ? [{ label: 'Not read', value: arb.unread.text }] : []),
    ...(usesPrior ? [{ label: 'Starting estimate', value: costs.rules.prior }] : []),
    { label: 'Reserve clause', value: costs.rules.reserveClause },
    ...(observed.awards ? [{ label: 'Observed arbitration salaries', value: `${observed.awards.text}${observed.awards.readingsText ? ` ${observed.awards.readingsText}` : ''}` }] : []),
    ...(observed.reserveClause?.status === 'measured' ? [{ label: 'Observed reserve-clause renewals', value: observed.reserveClause.text }] : []),
  ];
  const measured = r.status === 'measured' && (arb.status === 'measured' || arb.status === 'no_arbitration');
  return claim({
    text: `What a season the club controls costs: ${renewalWords} · ${arbWords}`,
    tone: renewal ? 'neutral' : 'unknown',
    basis: basis({
      because,
      source: officeSource(ctx, FINANCES),
      unknown: renewal ? [] : ['What a renewal costs on this save is not known yet.'],
      wouldChange: ['More of this save\'s own renewals and arbitration contracts, read at each import.'],
      lean: null,
      certainty: measured ? 'calibrated' : 'provisional',
      stamp: measured ? "Measured on this save's own contracts at this import" : 'Partly a starting estimate until this save has enough contracts of its own',
    }),
  });
}

/** A short line whose explanation is a click away (a projected cost's method, an option's declined branch). */
function explained(ctx: OfficeContext, text: string, label: string, value: string) {
  return claim({ text, tone: 'neutral', basis: basis({ because: [{ label, value }], source: officeSource(ctx, SPECIALIST), unknown: [], wouldChange: [], lean: null, certainty: 'fact' }) });
}

/** Where a player stands next season, in words: "arbitration, year 2", "pre-arbitration". */
function standingWords(p: Brief['players'][number]): string {
  if (p.status === 'arbitration') {
    if (p.superTwo && p.arbYear == null) return 'Arbitration (Super Two)';
    if (p.arbYear != null && p.arbYearHigh != null) return `Arbitration, year ${p.arbYear} ${p.arbYearHigh - p.arbYear === 1 ? 'or' : 'to'} ${p.arbYearHigh}`;
    return p.arbYear != null ? `Arbitration, year ${p.arbYear}` : 'Arbitration';
  }
  return p.status === 'reserve clause' ? 'Reserve clause' : 'Pre-arbitration';
}

const BETWEEN_WORDS: Record<string, string> = { leaving: 'free agency', signed: 'under contract', indeterminate: 'not known' };
const betweenWords = (between: readonly string[]): string => between.map((b) => BETWEEN_WORDS[b] ?? b).join(' or ');

/** A list of players coming off the books (or staying, or not known yet), with its count and money. */
function briefTable(ctx: OfficeContext, id: string, b: Brief, kind: 'leaving' | 'staying' | 'open', empty: string): OfficeTable {
  const columns = [
    column('player', 'Player'),
    column('age', 'Age', true),
    ...(kind === 'staying' ? [column('standing', 'Next season')] : kind === 'open' ? [column('between', 'Could be')] : []),
    column('salary', 'Salary', true),
    ...(kind === 'staying' ? [column('nextCost', 'Next season could cost', true)] : []),
  ];
  const rows = b.players.map((p): OfficeRow => {
    const cells: Record<string, Cell> = {
      player: cell(p.name),
      age: p.age === null ? cell('Not known', { tone: 'unknown' }) : cell(String(p.age)),
      salary: p.salary === null ? cell('Not known', { tone: 'unknown', hint: "His salary isn't in the export" }) : cell(money(p.salary)),
    };
    const sort: Record<string, number | string | null> = { player: p.name, age: p.age, salary: p.salary };
    const claims: Array<ReturnType<typeof claim>> = [];
    if (kind === 'staying') {
      cells.standing = cell(standingWords(p));
      sort.standing = standingWords(p);
      const next = costCell(p.nextCost as CostInput | null, 'Not established');
      cells.nextCost = next.cell;
      sort.nextCost = next.sort;
      if (p.nextCost) claims.push(explained(ctx, `Next season could cost ${next.cell.display}`, 'His cost', costExplanation(p.nextCost as CostInput)));
    }
    if (kind === 'open') {
      const words = p.between.length > 0 ? betweenWords(p.between) : 'Not known';
      cells.between = cell(words, { hint: hintIf(p.reason) ?? 'Not established from the export' });
      sort.between = words;
      claims.push(explained(ctx, `Could be ${words}`, 'Why', p.reason ?? 'Not established from the export.'));
    }
    return officeRow(`${id}-${p.player_id}`, cells, sort, { player: officePlayer(p.player_id, p.name, ctx.orgId), claims });
  });
  return { columns, rows, empty: cell(empty) };
}

function sectionOf(ctx: OfficeContext, id: string, title: string, explain: string, table: OfficeTable, unknown: string[] = []): FinancePayrollSection {
  return {
    id,
    title: cell(title),
    explain: claim({ text: title, tone: 'neutral', basis: officeFacts(ctx, SPECIALIST, [{ label: 'What it is', value: explain }], unknown) }),
    table,
  };
}

/** Every contract: his salary in each season, an option or a projected season in its own words, through when, and notes. */
function contractsTable(ctx: OfficeContext, payroll: Payroll): OfficeTable {
  const years = payroll.years;
  const thisSeason = payroll.seasonYear;
  const yearColumns = years.map((y) => column(`y${y}`, String(y), true, { hint: y === thisSeason ? `Guaranteed salary owed in ${y}, the current season` : `Guaranteed salary committed for ${y}` }));
  const rows = payroll.players.map((p: PayrollPlayer) => {
    const cells: Record<string, Cell> = {};
    const sort: Record<string, number | string | null> = {};
    const claims: Array<ReturnType<typeof claim>> = [];
    years.forEach((y, i) => {
      const key = `y${y}`;
      const option = p.optionYears.find((o) => o.season === y && !o.committed);
      const projected = p.projected[i] as CostInput | null;
      const v = p.byYear[i];
      if (option) {
        const declined = option.declined;
        const declinedWords = declined?.cost
          ? `${declined.cost.central !== null ? money(declined.cost.central) : declined.cost.low !== null && declined.cost.high !== null ? rangeWords(declined.cost.low, declined.cost.high) : 'not known'}${declined.cost.ifHeld ? ' if kept' : ''} if declined`
          : declined ? `then ${statusWords(declined.status)} if declined` : null;
        cells[key] = cell(option.salary !== null ? `Option ${money(option.salary)}` : 'Option', { hint: hintIf(declinedWords ? `Not guaranteed, not in the total; ${declinedWords}` : 'Not guaranteed, and not in the committed total') ?? 'Not guaranteed, and not in the committed total' });
        sort[key] = option.salary;
        claims.push(explained(ctx, `${y}: ${cells[key].display}`, 'The option', `A ${option.kind === 'opt_out' ? 'season he may opt out before' : `${option.kind} option`}: not guaranteed, and not in the committed total.${declined ? ` Declined: the buyout (not in the export) and then ${statusWords(declined.status)}${declined.cost ? `. ${costExplanation(declined.cost as CostInput)}` : declined.status === 'free_agent' ? ': no cost to this club.' : '.'}` : ''}`));
      } else if (p.unstatedYears.includes(y)) {
        cells[key] = cell('Not stated', { tone: 'unknown', hint: 'Covered, but the export does not state the salary' });
        sort[key] = null;
      } else if (projected) {
        const c = costCell(projected, 'Not established');
        cells[key] = cell(`${c.cell.display} projected`, { ...(c.cell.tone ? { tone: c.cell.tone } : {}), hint: c.cell.hint ?? 'Projected, not committed' });
        sort[key] = c.sort;
        claims.push(explained(ctx, `${y}: ${cells[key].display}`, 'His cost', costExplanation(projected)));
      } else if (v !== null && v !== undefined && v > 0) {
        cells[key] = cell(money(v));
        sort[key] = v;
      } else {
        cells[key] = cell('—', { hint: 'No contract season: it does not mean he is gone' });
        sort[key] = null;
      }
    });
    const position = p.positionName && p.positionName !== '?' ? p.positionName : null;
    cells.player = cell(p.deadMoney ? `${p.name} (owed, gone)` : p.name, p.deadMoney ? { hint: 'Still owed by this club after he left' } : {});
    cells.position = position ? cell(position) : cell('Not given', { tone: 'unknown' });
    cells.age = p.age === null ? cell('Not known', { tone: 'unknown' }) : cell(String(p.age));
    cells.through = cell(String(p.endYear));
    cells.notes = p.options.length > 0 ? cell(p.options.join(', ')) : cell('—');
    Object.assign(sort, { player: p.name, position, age: p.age, through: p.endYear, notes: p.options.length > 0 ? p.options.join(', ') : null });
    return officeRow(`payroll-${p.player_id}`, cells, sort, { player: officePlayer(p.player_id, p.name, p.deadMoney ? null : ctx.orgId), claims });
  });
  return paneTable({
    columns: [column('player', 'Player'), column('position', 'Pos'), column('age', 'Age', true), ...yearColumns, column('through', 'Through', true), column('notes', 'Notes', false, { sortable: false })],
    rows,
    empty: cell('No contracts on the books.'),
  });
}

export interface PayrollInput {
  payroll: Payroll;
  club: ReturnType<typeof clubFinances> | null;
  league: LeagueFinances | null;
  history: readonly PriceHistoryEntry[];
}

export function payrollView(ctx: OfficeContext, input: PayrollInput): FinancePayrollView {
  const { payroll } = input;
  const y = payroll.seasonYear;
  const budget = payroll.finances.budget.value;
  const expected = payroll.nextSeasonBudget;
  const seasons = payroll.commitments.map((c) => seasonOf(ctx, c, y, budget, expected));
  const price = input.league ? priceOf(ctx, input.league, input.history) : null;

  const leaving = sectionOf(ctx, 'leaving', `Leaving after ${y} · ${counted(payroll.comingOff.count, 'player')}, ${money(payroll.comingOff.money)}`,
    'Reaching free agency. This is the money that genuinely comes off the books.',
    briefTable(ctx, 'leaving', payroll.comingOff, 'leaving', 'Nobody reaching free agency.'));
  const sections: FinancePayrollSection[] = [leaving];
  if (payroll.stillControlled.count > 0) {
    sections.push(sectionOf(ctx, 'staying', `Deals ending, players staying · ${counted(payroll.stillControlled.count, 'player')}, ${money(payroll.stillControlled.money)}`,
      "Arbitration and pre-arbitration. You keep them, and these salaries are more likely to rise than to disappear, so they don't come off next year's payroll. Next season's figure is what he could cost: most likely, with the range it could be.",
      briefTable(ctx, 'staying', payroll.stillControlled, 'staying', 'Nobody.')));
  }
  if (payroll.controlIndeterminate.count > 0) {
    sections.push(sectionOf(ctx, 'open', `Deals ending, outcome not known yet · ${counted(payroll.controlIndeterminate.count, 'player')}`,
      "The save can't yet say whether these players leave or stay: their service crosses a line only if they stay up, or a league rule isn't in the export. Each says what it lies between.",
      briefTable(ctx, 'open', payroll.controlIndeterminate, 'open', 'Nobody.'), ['Whether these players leave or stay.']));
  }
  const dm = payroll.deadMoney;
  let deadMoney: Claim;
  if (dm.status === 'not_established') {
    deadMoney = claim({ text: 'Dead money: not known', tone: 'unknown', basis: officeFacts(ctx, SPECIALIST, [{ label: 'Why', value: dm.note ?? 'Retained salary is not exported.' }], ["Retained salary isn't in the export, so whether the club still pays players it moved can't be told."]) });
  } else if (dm.players.length === 0) {
    deadMoney = claim({ text: 'Dead money: none in the export', tone: 'neutral', basis: officeFacts(ctx, SPECIALIST, [{ label: 'What it is', value: 'No contract of a player now elsewhere is on this club\'s books.' }, ...(dm.note ? [{ label: 'Retained salary', value: dm.note }] : [])]) });
  } else {
    // Only the stated salaries are summed: one the export leaves blank is said, never counted as zero (D-018)
    const stated = dm.players.filter((p) => p.salary !== null);
    const unstated = dm.players.length - stated.length;
    const sum = stated.reduce((total, p) => total + p.salary!, 0);
    const notStated = unstated > 0 ? `, plus ${unstated} not stated` : '';
    const lines = dm.players.map((p) => ({ label: p.name, value: p.salary === null ? 'Not stated' : money(p.salary) }));
    const unknown = unstated > 0 ? [`What ${counted(unstated, 'player')} who left ${unstated === 1 ? 'is' : 'are'} still owed isn't in the export.`] : [];
    deadMoney = stated.length === 0
      ? claim({
          text: `Dead money: owed to ${counted(unstated, 'player')} who left, amounts not stated`,
          tone: 'unknown',
          basis: officeFacts(ctx, SPECIALIST, lines, unknown),
        })
      : claim({
          text: `Dead money: ${money(sum)} still owed to players who left${notStated}`,
          tone: 'neutral',
          value: servedValue(sum, 'dollars', unstated > 0 ? `${money(sum)} + ${unstated} not stated` : money(sum)),
          basis: officeFacts(ctx, SPECIALIST, lines, unknown),
        });
  }

  const edges = payroll.commitments.filter((c) => c.projected.edges);
  const edgesClaim = edges.length > 0
    ? claim({
        text: 'If every player landed at the same end of his range',
        tone: 'neutral',
        basis: basis({
          because: edges.map((c) => ({
            label: String(c.year),
            value: `${rangeWords(c.projected.edges!.low, c.projected.edges!.high)} with every player at the same end (edge against edge), against ${c.projected.low !== null && c.projected.high !== null ? rangeWords(c.projected.low, c.projected.high) : 'unknown'} as shown, with players combined as independent (${c.projected.combination?.combined ?? 0} combined, ${c.projected.combination?.atEdges ?? 0} kept at their ends).`,
          })),
          source: officeSource(ctx, SPECIALIST),
          unknown: [],
          wouldChange: [],
          lean: null,
          certainty: 'policy',
          stamp: "The owner's rule for the club's range: players combined as independent",
        }),
      })
    : null;

  const chartSeasons = seasons.map((s) => `${s.season} ${money(s.committed)}`).join(', ');
  const lede = officeLede(ctx, SPECIALIST, 'Committed salary by season, against the budget', [
    { label: 'Committed', value: TIP_COMMITTED },
    { label: 'Room', value: TIP_HEADROOM },
    { label: 'Beside each season', value: PROJECTED_TIP },
    { label: 'The budget line', value: budget === null ? "The club's budget isn't in the export." : `Today's budget, ${money(budget)}, as the export states it${expected !== null ? `; seasons after this one read against the ${money(expected)} you expect` : ''}.` },
  ], budget === null ? ["The club's budget isn't in the export."] : []);

  return {
    ...officeHead(ctx, 'Payroll & Budget', lede, SPECIALIST),
    cards: cardsOf(ctx, input.club),
    price: price?.price ?? null,
    priceHistory: price?.history ?? null,
    costs: input.league ? costsOf(ctx, input.league) : null,
    seasons,
    budget: budget === null
      ? { amount: null, label: cell('Budget not known', { tone: 'unknown', hint: "The club's budget isn't in the export" }) }
      : { amount: budget, label: cell(`Budget ${money(budget)}`) },
    expectedBudget: expected === null ? null : { amount: expected, label: cell(`Expected ${money(expected)}`, { hint: 'The budget you expect next season' }) },
    chartSummary: cell(`Committed salary by season: ${chartSeasons}${budget !== null ? `; budget ${money(budget)}` : '; budget not known'}.`),
    nextSeasonBudget: {
      amount: expected,
      placeholder: budget === null ? null : Math.round(budget / 1e6),
      label: cell('Budget you expect next season'),
      help: expected !== null
        ? cell('Seasons after this one are measured against it.')
        : budget === null
          ? cell("The export has no budget this year, so the seasons ahead are measured against the one you enter here.")
          : cell("Leave it empty to assume this year's budget holds flat."),
    },
    edges: edgesClaim,
    sections,
    deadMoney,
    contracts: contractsTable(ctx, payroll),
  };
}

/** A budget the GM entered, in millions without losing a dollar: "$200M", "$123.4567M". */
export const budgetWords = (amount: number): string => `$${(amount / 1_000_000).toFixed(6).replace(/\.?0+$/, '')}M`;

/**
 * What setting the budget the GM expects next season did, from the amount before to the amount kept (null: none), and
 * the request that puts it back.
 */
export function budgetChange(amount: number | null, before: number | null): FinanceBudgetChange {
  const was = before === null ? "was today's budget held flat" : `was ${budgetWords(before)}`;
  const done = amount === null
    ? before === null ? "Next season's budget left empty: today's holds flat" : `Next season's budget cleared, so today's holds flat; ${was}`
    : amount === before ? `Next season's budget kept at ${budgetWords(amount)}` : `Next season's budget set to ${budgetWords(amount)}; ${was}`;
  return {
    nextSeasonBudget: amount,
    done: cell(done, { hint: 'A Pennant setting: nothing is written to OOTP' }),
    undo: { amount: before ?? 0 },
  };
}
