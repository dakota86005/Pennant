/**
 * Org Comparison (N12 Track B, D-072): every major league club of the league side by side, worded from
 * `computeOrgComparison` (the React page's `/api/org-comparison`). Pure: it words what it is handed and reads nothing
 * (D-056). Every figure is Player Value's as each player is served (D-052): a most likely reading with the range it could
 * be, never one number for a range, never a verdict, a rank or a combined score; or a fact of the export (the record,
 * payroll, budget), "Not known" where the export lacks it, never $0 (D-018). The clubs come in the route's order (by
 * name); the Mac sorts only when the GM clicks a header, by the served keys: the most likely figure, or the middle of its
 * range of most likely readings when there is no single one, unknown last.
 *
 * The words are the React page's (`src/pages/OrgComparison.tsx`, `src/valueWords.ts`), through N11's server copy of
 * them (`../player/words.ts`).
 */
import type { Cell, Certainty, ServedValue, Tone } from '../../contract/presentation.js';
import type { OrgComparison, OrgSum } from '../../franchise.js';
import { cell, servedValue, unknownValue } from '../claim.js';
import { factClaim, head, hintIf, player, plural, type ClubhouseContext } from '../clubhouse/common.js';
import { block, line } from '../majorLeague/common.js';
import type { MlbBlock } from '../majorLeague/types.js';
import { money, rangeText, signedMoney, signedTenths, winsText } from '../player/words.js';
import { clubRow, column, officeClub } from './common.js';
import type { LeagueOrgComparisonView, OfficeRow } from './types.js';

const VALUE = 'Player Value';
const FINANCES = 'Club finances';

export interface OrgComparisonInput {
  /** The route's answer, or the sentence it was refused with (worded by the reader: never an internal message). */
  comparison: OrgComparison | string;
  /** How Player Value's figures are called on this save: its own fit, or the starting numbers (D-041, D-053). */
  valueCalled: { how: Certainty; stamp: string };
  /** How the farm's figure is called: the ratings model's own fit or its starting numbers (a minor leaguer's arrival). */
  farmCalled: { how: Certainty; stamp: string };
}

type Club = OrgComparison['clubs'][number];
type Money = Club['payroll'];

// ── the hovers, in the GM's words (the React page's) ─────────────────────────

const TIP_ROSTER_WINS = (season: number) =>
  `What the players on the club's major-league roster (active or on the injured list) are expected to add over the rest of ${season}, ` +
  'in wins above replacement (WAR), added up. The first figure is the most likely; the range under it is what it could be. ' +
  "Players are combined as if their seasons didn't depend on each other, so the range is a reasonable reading, not a promise. " +
  "It's who is there now, not who might arrive; a player whose production can't be projected is left out and named.";
const TIP_FARM_WINS = (next: number) =>
  `What the organization's minor leaguers are expected to add in the majors in ${next}, in WAR, added up: each one's chance of ` +
  "reaching the majors times what he'd do there. It says how much help is close, not how good the system is in the long run: a " +
  'teenager years away adds little here however high his ceiling.';
const TIP_CONTRACT =
  "What the major-league roster's contracts are worth beyond what they pay, added up: the same figure as Contract value on each " +
  "player's card, over the seasons he is signed or controlled, seasons further out counting a little less, summed the way " +
  'Payroll adds players. Cheap, productive players push it up; big contracts for fading players pull it down. A player whose ' +
  "value isn't known yet is left out and named.";
const TIP_PAYROLL =
  "This season's payroll, with the budget beside it, as OOTP's club finances state them. A figure the export doesn't carry says " +
  "so; it's never read as $0.";
const TIP_TOP =
  'The minor leaguer expected to add the most in the majors next season, with his expected wins: the nearest help, not ' +
  'necessarily the best prospect.';
const OPEN_READING =
  'No single most likely figure: it depends on seasons that could go more than one way (an option, a status still open, or ' +
  'whether a player stays), so the most likely is the range of those readings.';
const SORTING =
  'A column sorts by its most likely figure, or by the middle of its range of most likely readings when there is no single ' +
  'one; a club whose figure isn\'t known sorts last either way. Nothing is ranked: the clubs start in name order.';

// ── a sum in words ───────────────────────────────────────────────────────────

/** A range of wins with the unit said once: "3.0 to 8.9 wins", or "6.1 wins" where the ends meet. */
const winsRange = (low: number, high: number): string => `${rangeText(low, high, signedTenths)} wins`;
/** A sum's figures in words: wins with the unit said once, or signed money. */
const rangeOf = (sum: OrgSum) => (low: number, high: number): string =>
  (sum.unit === 'wins' ? winsRange(low, high) : rangeText(low, high, signedMoney));

/** A sum's most likely reading in words: one figure, or the range of its readings (never a midpoint made up between them). */
function readingOf(sum: OrgSum): { text: string; couldBe: string; sort: number | null; single: boolean } | null {
  const f = sum.status === 'known' ? sum.figure : null;
  if (!f) return null;
  const range = rangeOf(sum);
  const couldBe = range(f.low, f.high);
  if (f.central !== null) return { text: range(f.central, f.central), couldBe, sort: f.central, single: true };
  const r = f.centralRange ?? { low: f.low, high: f.high };
  return { text: range(r.low, r.high), couldBe, sort: (r.low + r.high) / 2, single: false };
}

/** The served value of a sum: the most likely figure inside the range it could be, or no single figure (n null). */
function valueOfSum(sum: OrgSum, none: string): ServedValue {
  const f = sum.status === 'known' ? sum.figure : null;
  const reading = readingOf(sum);
  const unit = sum.unit === 'wins' ? 'wins' : 'dollars';
  if (!f || !reading) return unknownValue(unit, none);
  if (f.central !== null) return servedValue(f.central, unit, reading.text, { low: f.low, high: f.high });
  // A range never shown as one number: no most likely value, the range of readings in words
  return { n: null, unit, low: f.low, high: f.high, display: reading.text };
}

const notCounted = (sum: OrgSum): string | null => (sum.excluded.length ? `${sum.excluded.length} not counted` : null);

/** A sum's cell: most likely, with the range it could be and who it leaves out in the help tag; unknown with its reason. */
function sumCell(sum: OrgSum, none: string, noneHint: string): { cell: Cell; sort: number | null } {
  const reading = readingOf(sum);
  if (!reading) return { cell: cell(none, { tone: 'unknown', hint: hintIf(noneHint) ?? 'Not known' }), sort: null };
  const tail = [`Could be ${reading.couldBe}`, notCounted(sum)].filter(Boolean).join(' · ');
  const hint = hintIf(tail) ?? hintIf(`Could be ${reading.couldBe}`);
  return { cell: cell(reading.text, hint ? { hint } : {}), sort: reading.sort };
}

/** A sum's detail: its reading with how it adds up in the basis, and the players left out, named (up to twelve). */
function sumBlock(v: ClubhouseContext, called: OrgComparisonInput['valueCalled'], title: string, sum: OrgSum, none: string): MlbBlock {
  const reading = readingOf(sum);
  const text = reading
    ? `${reading.single ? 'Most likely' : 'Most likely between'} ${reading.text} · could be ${reading.couldBe}`
    : none;
  const read = factClaim(v, text, {
    specialist: VALUE,
    how: called.how,
    stamp: called.stamp,
    tone: reading ? 'neutral' : 'unknown',
    value: valueOfSum(sum, none),
    because: [
      { label: 'How it adds up', value: sum.text },
      ...(reading && !reading.single ? [{ label: 'No single figure', value: OPEN_READING }] : []),
      { label: 'Counted', value: plural(sum.counted, 'player') },
    ],
    unknown: sum.excluded.length
      ? [`${plural(sum.excluded.length, 'player')} left out because their figure isn't known, never counted as zero.`]
      : [],
  });
  const shown = sum.excluded.slice(0, 12).map((x) => line(`${x.name}: ${x.reason}`, { quiet: true, tone: 'unknown' }));
  const more = sum.excluded.length > 12 ? [line(`And ${sum.excluded.length - 12} more.`, { quiet: true })] : [];
  const left = sum.excluded.length
    ? [line(`${sum.excluded.length} not counted: left out because their figure isn't known, never counted as zero`), ...shown, ...more]
    : [];
  return block(title, left, { claims: [read], collapsed: false });
}

function moneyCell(m: Money, what: string): { cell: Cell; sort: number | null } {
  if (m.value === null || !Number.isFinite(m.value)) {
    return { cell: cell('Not known', { tone: 'unknown', hint: hintIf(m.note) ?? `The export doesn't state the club's ${what}` }), sort: null };
  }
  return { cell: cell(money(m.value)), sort: m.value };
}

const pctOf = (r: { w: number; l: number } | null): number | null => (r && r.w + r.l > 0 ? r.w / (r.w + r.l) : null);

function clubRowOf(v: ClubhouseContext, input: OrgComparisonInput, data: OrgComparison, c: Club): OfficeRow {
  const club = officeClub(c.team_id, c.team, c.abbr, c.isViewer);
  const roster = sumCell(c.roster.wins, 'Not projected', 'No player on the roster has a projection');
  const farm = sumCell(c.farm.wins, 'Not projected', 'No player on the farm has a projection');
  const contract = sumCell(c.roster.contract, 'Not valued', 'No player on the roster could be valued');
  const payroll = moneyCell(c.payroll, 'payroll');
  const budget = moneyCell(c.budget, 'budget');
  const t = c.farm.top;
  const topWhere = t ? [t.positionName, t.age !== null ? `${t.age}` : null, t.team].filter(Boolean).join(', ') : '';
  const cells: Record<string, Cell> = {
    club: c.isViewer ? cell(c.team, { hint: 'Your club' }) : cell(c.team),
    record: c.record ? cell(`${c.record.w}–${c.record.l}`) : cell('Not known', { tone: 'unknown', hint: 'The export has no record for the club this season' }),
    rosterWins: roster.cell,
    farmWins: farm.cell,
    contract: contract.cell,
    payroll: payroll.cell,
    budget: budget.cell,
    top: t
      ? cell(t.name, { hint: hintIf(`${winsText(t.wins.central)} in ${data.nextSeason} · ${topWhere}`) ?? hintIf(`${winsText(t.wins.central)} in ${data.nextSeason}`) })
      : cell('None projected', { tone: 'unknown', hint: 'No player on the farm has a projection' }),
    players: cell(`${c.roster.players} · ${c.farm.players}`, { hint: 'On the major league roster · in the farm system' }),
  };
  const sort: Record<string, number | string | null> = {
    club: c.team,
    record: pctOf(c.record),
    rosterWins: roster.sort,
    farmWins: farm.sort,
    contract: contract.sort,
    payroll: payroll.sort,
    budget: budget.sort,
    top: t ? t.wins.central : null,
    players: c.roster.players,
  };
  const money = block('Payroll and budget', [
    line(c.payroll.value === null ? `Payroll not known${c.payroll.note ? `: ${c.payroll.note}` : ''}` : `Payroll ${cells.payroll.display}`, c.payroll.value === null ? { tone: 'unknown' } : {}),
    line(c.budget.value === null ? `Budget not known${c.budget.note ? `: ${c.budget.note}` : ''}` : `Budget ${cells.budget.display}`, c.budget.value === null ? { tone: 'unknown' } : {}),
  ]);
  const topBlock = t
    ? block('The farm\'s nearest help', [
      line(`${t.name}: ${winsText(t.wins.central)} expected in ${data.nextSeason}, could be ${winsRange(t.wins.low, t.wins.high)}`, { players: [player(t.player_id, t.name, c.team_id)] }),
      ...(topWhere ? [line(topWhere, { quiet: true })] : []),
    ])
    : null;
  const detail = [
    sumBlock(v, input.valueCalled, `Roster, rest of ${data.season}`, c.roster.wins, 'Not projected'),
    sumBlock(v, input.farmCalled, `Farm, ${data.nextSeason}`, c.farm.wins, 'Not projected'),
    ...(topBlock ? [topBlock] : []),
    sumBlock(v, input.valueCalled, 'Contract value', c.roster.contract, 'Not valued'),
    money,
  ];
  return clubRow(`club-${c.team_id}`, club, cells, sort, {
    detail,
    ...(t ? { players: [player(t.player_id, t.name, c.team_id)] } : {}),
  });
}

/** Our four tiles: each a reading with the range it could be, and the league's middle club beside it (never a rank). */
function figuresOf(v: ClubhouseContext, input: OrgComparisonInput, data: OrgComparison) {
  const me = data.clubs.find((c) => c.isViewer);
  if (!me) return [];
  const middleText = (m: { low: number; high: number } | null, range: (low: number, high: number) => string): string | null =>
    (m === null ? null : `League middle: ${range(m.low, m.high)}`);
  const sumFigure = (title: string, sum: OrgSum, none: string, middle: string | null, tip: string, called = input.valueCalled) => {
    const reading = readingOf(sum);
    return factClaim(v, title, {
      specialist: VALUE,
      how: called.how,
      stamp: called.stamp,
      tone: reading ? 'neutral' : 'unknown',
      value: valueOfSum(sum, none),
      ...(hintIf(middle) ? { hint: hintIf(middle) } : {}),
      because: [
        { label: 'Most likely', value: reading ? reading.text : none },
        ...(reading ? [{ label: 'Could be', value: reading.couldBe }] : []),
        ...(middle ? [{ label: 'League middle', value: `${middle.replace(/^League middle: /, '')}: the middle club's most likely figure, for scale; never a rank.` }] : []),
        { label: 'What it is', value: tip },
        ...(reading && !reading.single ? [{ label: 'No single figure', value: OPEN_READING }] : []),
        { label: 'How it adds up', value: sum.text },
      ],
      unknown: sum.excluded.length
        ? [`${plural(sum.excluded.length, 'player')} left out because their figure isn't known, never counted as zero.`]
        : [],
    });
  };
  const contractUnit = me.roster.contract.unit;
  const payrollMiddle = data.league.payroll === null ? null : `League middle: ${money(data.league.payroll)}`;
  return [
    sumFigure(`Roster, rest of ${data.season}`, me.roster.wins, 'Not projected', middleText(data.league.rosterWins, winsRange), TIP_ROSTER_WINS(data.season)),
    sumFigure(`Farm, ${data.nextSeason}`, me.farm.wins, 'Not projected', middleText(data.league.farmWins, winsRange), TIP_FARM_WINS(data.nextSeason), input.farmCalled),
    sumFigure('Contract value', me.roster.contract, 'Not valued',
      contractUnit === 'dollars' ? middleText(data.league.contract, (a, b) => rangeText(a, b, signedMoney)) : null,
      contractUnit === 'wins' ? `${TIP_CONTRACT} This league's dollars aren't known here, so it is in wins.` : TIP_CONTRACT),
    factClaim(v, 'Payroll', {
      specialist: FINANCES,
      tone: me.payroll.value === null ? 'unknown' : 'neutral',
      value: me.payroll.value === null ? unknownValue('dollars', 'Not known') : servedValue(me.payroll.value, 'dollars', money(me.payroll.value)),
      ...(hintIf(payrollMiddle) ? { hint: hintIf(payrollMiddle) } : {}),
      because: [
        { label: 'Payroll', value: me.payroll.value === null ? 'Not in the export.' : money(me.payroll.value) },
        { label: 'Budget', value: me.budget.value === null ? 'Not in the export.' : money(me.budget.value) },
        ...(payrollMiddle ? [{ label: 'League middle', value: `${money(data.league.payroll!)}: the middle club's payroll, for scale; never a rank.` }] : []),
        { label: 'Where it comes from', value: [me.payroll.source, me.payroll.note].filter((x): x is string => typeof x === 'string' && x.trim().length > 0).join('. ') || TIP_PAYROLL },
      ],
      unknown: [
        ...(me.payroll.value === null ? [`The club's payroll: ${me.payroll.note ?? 'the export doesn\'t state it'}.`.replace(/\.\.$/, '.')] : []),
        ...(me.budget.value === null ? [`The club's budget: ${me.budget.note ?? 'the export doesn\'t state it'}.`.replace(/\.\.$/, '.')] : []),
      ],
    }),
  ];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "May 16, 2026" from the export's date (ISO or OOTP's unpadded); the text as given when it is not one. */
function dateWords(date: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : date;
}

/** How current the export is: null when it is current and Player Rights left nothing out; otherwise the cue's line. */
function freshnessOf(v: ClubhouseContext, data: OrgComparison) {
  const f = data.freshness;
  if (f.state === 'current' && f.limitations.length === 0) return null;
  const asOf = f.asOf ? `As of ${dateWords(f.asOf)}` : null;
  const text = [asOf, f.line].filter(Boolean).join(' · ') || 'Date not known';
  const tone: Tone = f.state === 'behind' || f.state === 'unavailable' ? 'bad' : f.state === 'unverified' ? 'caution' : 'neutral';
  return factClaim(v, text, {
    specialist: 'Data status',
    tone,
    because: [{ label: 'How current', value: f.detail }],
    unknown: [...new Set(f.limitations.map((l) => l.trim()).filter(Boolean))],
  });
}

const LEDE = {
  text: 'Where each club stands: its roster, its farm, its contracts and its spending',
  full: 'Where each club stands: what its roster is expected to add the rest of the way, how much help its farm is about to send up, what its contracts are worth and what it spends. Most likely figures, with the range they could be beside them; select a club for how each adds up and who is left out. Nothing is ranked.',
  specialist: VALUE,
};

function noteOf(v: ClubhouseContext, season: number | null, next: number | null) {
  return factClaim(v, 'How to read the comparison', {
    specialist: VALUE,
    how: 'policy',
    stamp: 'How the staff reads it: stated, not fitted',
    because: [
      ...(season !== null ? [{ label: `Roster, rest of ${season}`, value: TIP_ROSTER_WINS(season) }] : []),
      ...(next !== null ? [{ label: `Farm, ${next}`, value: TIP_FARM_WINS(next) }] : []),
      { label: 'Contract value', value: TIP_CONTRACT },
      { label: 'Payroll and budget', value: TIP_PAYROLL },
      { label: 'Top farm contributor', value: TIP_TOP },
      { label: 'A range for the most likely', value: OPEN_READING },
      { label: 'Sorting', value: SORTING },
      { label: 'Club', value: 'Every major-league club in your league; yours is marked. Open a club, or its top farm contributor, from its row.' },
      { label: 'Record', value: 'Wins and losses this season, as the export states them.' },
      { label: 'Players', value: 'On the major-league roster · in the farm system.' },
    ],
  });
}

const columnsOf = (season: number | null, next: number | null) => [
  column('club', 'Club', false, { hint: 'Every major league club in your league; yours is marked' }),
  column('record', 'Record', true, { hint: 'Wins and losses this season, as the export states them' }),
  column('rosterWins', season !== null ? `Roster, rest of ${season}` : 'Roster, rest of season', true, { hint: 'Wins the roster is expected to add; sorts by the most likely' }),
  column('farmWins', next !== null ? `Farm, ${next}` : 'Farm, next season', true, { hint: 'Wins the farm is expected to add in the majors next season' }),
  column('contract', 'Contract value', true, { hint: 'What the roster\'s contracts are worth beyond what they pay' }),
  column('payroll', 'Payroll', true, { hint: 'This season\'s payroll, as the club\'s finances state it' }),
  column('budget', 'Budget', true, { hint: 'The club\'s budget, as its finances state it', hidden: true }),
  column('top', 'Top farm contributor', false, { hint: 'The minor leaguer expected to add the most next season' }),
  column('players', 'Players', true, { hint: 'On the major league roster · in the farm system' }),
];

export function orgComparisonView(v: ClubhouseContext, input: OrgComparisonInput): LeagueOrgComparisonView {
  const base = head(v, 'Org Comparison', LEDE);
  const data = input.comparison;
  if (typeof data === 'string') {
    return {
      ...base, freshness: null, figures: [],
      clubs: { columns: columnsOf(null, null), rows: [], empty: cell('No clubs to compare.') },
      note: noteOf(v, null, null),
      empty: cell(/[.!?]$/.test(data.trim()) ? data.trim() : `${data.trim()}.`),
    };
  }
  const none = 'No clubs to compare: the export has no major-league clubs in your league.';
  return {
    ...base,
    freshness: freshnessOf(v, data),
    figures: figuresOf(v, input, data),
    clubs: { columns: columnsOf(data.season, data.nextSeason), rows: data.clubs.map((c) => clubRowOf(v, input, data, c)), empty: cell(none) },
    note: noteOf(v, data.season, data.nextSeason),
    empty: data.clubs.length === 0 ? cell(none) : null,
  };
}

/** The view when it couldn't be read: its head, nothing in it, and why. */
export function orgComparisonUnreadView(v: ClubhouseContext, why: string): LeagueOrgComparisonView {
  return {
    ...head(v, 'Org Comparison', LEDE),
    freshness: null,
    figures: [],
    clubs: { columns: columnsOf(null, null), rows: [], empty: cell('No clubs to compare.') },
    note: noteOf(v, null, null),
    empty: cell(why.endsWith('.') ? why : `${why}.`),
  };
}
