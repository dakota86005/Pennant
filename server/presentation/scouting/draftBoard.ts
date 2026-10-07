/**
 * Scouting's Draft Board (N12 Track B, D-072): this year's amateur class in the scouting staff's order, worded from what
 * the reader (`scoutingViews.ts`) hands it. The class and the league's calendar are the React page's own
 * (`draftLeague`, `draftPool` in `rosterops.ts`); the grades are our scouts' composites as `scoutedEvidence.ts` reads
 * them (D-017, D-067): a prospect whose ceiling the scouts haven't graded in full is left off the board and counted,
 * never averaged from the tools they have seen (D-018). Every row whose grades are OSA's view filling in carries the mark.
 *
 * The board is the staff's view in a stated order (ceiling, then now), never an order to draft anyone (D-001); the read
 * beside a name is the staff's stated line (`advise`), with its reasons in the row's detail. Pure: it reads nothing.
 */
import type { Cell } from '../../contract/presentation.js';
import type { DraftLeague } from '../../rosterops.js';
import { cell } from '../claim.js';
import { ageCell, dayOrder, dayWords, factClaim, head, plural, player, type ClubhouseContext } from '../clubhouse/common.js';
import { fillHint, fillMark, withFill, type RatingFill } from '../clubhouse/fill.js';
import { column } from '../league/common.js';
import { keysServed } from '../league/office.js';
import type { OfficeChoiceGroup, OfficeRow, OfficeTable } from '../league/types.js';
import { block, line, tableRow } from '../majorLeague/common.js';
import type { MlbBlock, MlbLine } from '../majorLeague/types.js';
import type { ScoutingDraftBoardView, ScoutingProspectView } from './types.js';

const BOARD = 'The scouting staff\'s draft board';
const STAFF_STAMP = 'The scouting staff\'s lines: stated, not fitted';

/** A prospect on the board, in the board's order: the export's facts, our scouts' composites and the staff's read. */
export interface BoardProspect {
  playerId: number;
  name: string;
  age: number | null;
  positionName: string;
  bats: string;
  throws: string;
  school: 'High school' | 'College';
  /** Our scouts' composites, 20-80 equivalent; `ceiling` is always known on the board, `current` may not be. */
  current: number | null;
  ceiling: number;
  /** The tools not graded now, by name, when `current` is not known. */
  notGradedNow: string[];
  /** The staff's read (`advise`): its label and reasons; null below the staff's line (a ceiling under 45). */
  read: { label: string; reasons: string[] } | null;
  fill: RatingFill;
}

export interface DraftBoardInput {
  /** The draft's league and calendar (`draftLeague`), or the sentence the board couldn't be read with. */
  league: DraftLeague | string;
  poolRule: 'flag' | 'class' | null;
  /** The board, in the staff's order (empty until the class is published). */
  prospects: BoardProspect[];
  /** Members of the class left off: no full scouted ceiling. */
  unrated: number;
  excluded: { alreadyPicked: number; otherDraft: number };
  /** Every fielding position, thinnest first by its best player's expected wins (Player Value's `positionNeeds`). */
  needs: Array<{ positionName: string; best: { name: string; wins: number } | null }>;
  needsBasis: string;
  /** How grades are shown in this save: the scale's top and whether they are rounded to fives (the depth chart's rule). */
  rating: { scaleMax: number; roundToFive: boolean };
}

/** The position filter's choices: each sent back by its key (`?position=IF`), the first keeping every prospect. */
const GROUPS: Array<{ key: string; text: string; positions: string[] | null }> = [
  { key: 'all', text: 'All positions', positions: null },
  { key: 'C', text: 'Catchers', positions: ['C'] },
  { key: 'IF', text: 'Infielders', positions: ['1B', '2B', '3B', 'SS'] },
  { key: 'OF', text: 'Outfielders', positions: ['LF', 'CF', 'RF'] },
  { key: 'P', text: 'Pitchers', positions: ['P'] },
];

/** The school filter's choices, by key (`?school=HS`). */
const SCHOOLS: Array<{ key: string; text: string; school: BoardProspect['school'] | null }> = [
  { key: 'all', text: 'High school and college', school: null },
  { key: 'HS', text: 'High school', school: 'High school' },
  { key: 'college', text: 'College', school: 'College' },
];

/** How many prospects the board serves at first, in its order: the rest are a filter or "Show all" away. */
export const BOARD_PAGE = 300;

/** What the board is asked for: a position group and a school by key, and whether every prospect is wanted. */
export interface DraftBoardAsk {
  position: string;
  school: string;
  all: boolean;
}

export const DEFAULT_BOARD: DraftBoardAsk = { position: 'all', school: 'all', all: false };

/** A board ask from a request's query, its unknown keys read as every prospect (the choice is served back as read). */
export function draftBoardAskFrom(query: Record<string, unknown>): DraftBoardAsk {
  const text = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '');
  const position = GROUPS.some((g) => g.key === text(query.position)) ? text(query.position) : 'all';
  const school = SCHOOLS.some((g) => g.key === text(query.school)) ? text(query.school) : 'all';
  return { position, school, all: text(query.all) === '1' || text(query.all) === 'true' };
}

/** A board ask's key. */
export const draftBoardKey = (ask: DraftBoardAsk): string => `${ask.position}|${ask.school}|${ask.all ? 'all' : 'top'}`;

/** A grade as the save shows grades (rounded to fives only on the 20-80 scale, as the depth chart rounds them). */
function grade(n: number | null, rating: DraftBoardInput['rating']): string | null {
  if (n === null || !Number.isFinite(n)) return null;
  return String(rating.roundToFive && rating.scaleMax === 80 ? Math.round(n / 5) * 5 : Math.round(n));
}

/** A date OOTP writes, with its year, in words ("May 1, 2040"). */
function longDay(date: string | null): string | null {
  if (!date) return null;
  const year = /^(\d{4})-/.exec(date)?.[1];
  return `${dayWords(date, true)}${year ? `, ${year}` : ''}`;
}

/** Whole days from one date OOTP writes to another; null when either isn't a date. */
function daysBetween(from: string | null, to: string | null): number | null {
  const a = dayOrder(from);
  const b = dayOrder(to);
  if (a === null || b === null) return null;
  const at = (n: number) => Date.UTC(Math.floor(n / 10000), Math.floor((n % 10000) / 100) - 1, n % 100);
  return Math.round((at(b) - at(a)) / 86_400_000);
}

/** The draft's calendar: the stops the export dates, in order. */
function calendarOf(league: DraftLeague): OfficeTable {
  const stops: Array<[string, string, string | null]> = [
    ['pool', 'Class published', league.poolDate],
    ['combine', 'Combine', league.combineDate],
    ['draft', 'Draft day', league.draftDate],
  ];
  const rows: OfficeRow[] = stops.filter(([, , d]) => d !== null).map(([id, label, d], i) => tableRow(`calendar.${id}`,
    { event: cell(label), date: cell(longDay(d)!) }, { event: i, date: dayOrder(d) }));
  return {
    columns: [column('event', 'Event'), column('date', 'Date', true)],
    rows,
    empty: cell('The export dates none of the draft\'s calendar.'),
  };
}

function boardHead(v: ClubhouseContext) {
  return head(v, 'Draft Board', {
    text: 'This year\'s class in the scouting staff\'s order: ceiling first, then now',
    full: `Every draft-eligible player our scouts have graded all the way to a ceiling, in the scouting staff's order: the highest ceiling first, then the best now. It is the staff's view of the class, never an order to draft anyone, and every grade on an amateur rests on the few looks the staff has had. The class shows only once OOTP publishes it. ${READ_LINES}`,
    specialist: BOARD,
  });
}

// The columns of words sort by their words (no sort key on each row would only repeat them, N12 Track B review, M2)
const BOARD_COLUMNS = [
  column('board', 'Board', true, { hint: 'The scouting staff\'s order: ceiling, then now' }),
  column('player', 'Player', false, { byWords: true }),
  column('age', 'Age', true),
  column('position', 'Pos', false, { byWords: true }),
  column('bt', 'B/T', false, { hint: 'Bats / throws', byWords: true }),
  column('school', 'From', false, { byWords: true }),
  column('current', 'Now', true, { hint: 'Our scouts\' grade now, on the 20–80 scale' }),
  column('ceiling', 'Ceiling', true, { hint: 'Our scouts\' grade at his ceiling, on the 20–80 scale' }),
  column('upside', 'Upside', true, { hint: 'Ceiling minus now: the projection still to happen' }),
  column('read', 'Read', false, { hint: 'The kind of prospect the scouting staff reads him as', byWords: true }),
];

/** The view when there is no board to show: no draft, or not published yet (one sentence and the calendar). */
function notShownView(v: ClubhouseContext, sentence: string, calendar: OfficeTable | null, published: boolean): ScoutingDraftBoardView {
  return {
    ...boardHead(v),
    published,
    notShown: cell(sentence),
    calendar,
    summary: null,
    leftOut: null,
    shortLists: [],
    filters: [],
    query: { ...DEFAULT_BOARD },
    count: null,
    more: null,
    board: { columns: BOARD_COLUMNS, rows: [], empty: cell(sentence) },
    empty: null,
  };
}

/** The board's payload when it couldn't be read: the head and the sentence. */
export function draftBoardUnreadView(v: ClubhouseContext, why: string): ScoutingDraftBoardView {
  const sentence = why.endsWith('.') ? why : `${why}.`;
  return { ...notShownView(v, sentence, null, false), notShown: null, empty: cell(sentence) };
}

/** The staff's lines for the read (`advise`), stated once in the view's lede, never on every row. */
const READ_LINES = 'The read beside a name is the kind of prospect the staff reads him as, on stated lines: a ceiling of 55 or more with 15 or more still to come is a high ceiling with a long wait; within 8 of his ceiling and 45 or more now is close to ready; a ceiling of 52 or more is an everyday regular\'s; any other ceiling of 45 or more is a depth piece. A prospect whose grade now isn\'t known is read on his ceiling alone, and the read says so. Under 45, the staff gives no read. Select a player for his reasons.';

function prospectRow(p: BoardProspect, rank: number, rating: DraftBoardInput['rating']): OfficeRow {
  const now = grade(p.current, rating);
  const ceiling = grade(p.ceiling, rating)!;
  const upside = p.current !== null ? p.ceiling - p.current : null;
  const cells: Record<string, Cell> = {
    board: cell(String(rank)),
    player: cell(p.name),
    age: ageCell(p.age),
    position: cell(p.positionName),
    bt: cell(`${p.bats}/${p.throws}`),
    school: cell(p.school),
    current: now === null ? cell('Not graded', { tone: 'unknown', hint: 'Our scouts haven\'t graded every tool he has now' }) : cell(now),
    ceiling: cell(ceiling),
    upside: upside === null ? cell('Not known', { tone: 'unknown', hint: 'Not known until every tool he has now is graded' }) : cell(`+${upside}`),
    read: p.read ? cell(p.read.label) : cell('No read', { hint: 'The staff reads a ceiling of 45 or more' }),
  };
  const sort: Record<string, number | string | null> = {
    board: rank, player: p.name, age: p.age, position: p.positionName, bt: `${p.bats}/${p.throws}`, school: p.school,
    current: p.current, ceiling: p.ceiling, upside, read: p.read?.label ?? null,
  };
  // The row's own cells say the rest; only what they can't say goes beneath it
  // His own reasons as plain lines: the lines they are drawn on are stated once, in the view's lede
  const lines: MlbLine[] = [
    ...(p.read?.reasons.length ? [line(p.read.reasons.map((r, i) => (i === 0 ? r.charAt(0).toUpperCase() + r.slice(1) : r)).join('; '))] : []),
    ...(p.notGradedNow.length ? [line(`Not graded now: ${p.notGradedNow.join(', ')}`, { quiet: true, tone: 'unknown' })] : []),
  ];
  const detail = withFill(p.fill, cells, ['current', 'ceiling', 'upside'], lines.length
    ? [block(p.read ? `Staff's read: ${p.read.label}` : 'His grades', lines)]
    : []);
  // The columns of words are served without their keys: they sort by their words (`byWords`)
  return keysServed(tableRow(`prospect-${p.playerId}`, cells, sort, { player: player(p.playerId, p.name, null), detail, ratingsFill: fillMark(p.fill) }), BOARD_COLUMNS);
}

/** A short list's line: board place, name, position, grades and read; the OSA mark as its chip when it applies. */
function shortLine(p: BoardProspect, rank: number, rating: DraftBoardInput['rating'], withRead: boolean): MlbLine {
  const now = grade(p.current, rating) ?? 'not graded';
  const text = `${rank}. ${p.name}, ${p.positionName} · ${now} → ${grade(p.ceiling, rating)}${withRead && p.read ? ` · ${p.read.label}` : ''}`;
  const mark = fillMark(p.fill);
  const hinted = fillHint(cell(text), p.fill);
  return line(text, { players: [player(p.playerId, p.name, null)], ...(mark ? { chips: [mark] } : {}), ...(hinted.hint ? { hint: hinted.hint } : {}) });
}

function shortLists(v: ClubhouseContext, input: DraftBoardInput): MlbBlock[] {
  const ranked = input.prospects.map((p, i) => ({ p, rank: i + 1 }));
  const best = ranked.slice(0, 5);
  const bestClaim = factClaim(v, 'The top five on the board, in the staff\'s order', {
    specialist: BOARD,
    because: [
      { label: 'The order', value: 'The highest scouted ceiling first, then the best now: the scouting staff\'s view of the class, never an order to draft anyone.' },
      { label: 'The staff', value: 'Best available is the stronger idea of the two lists. Every grade on an amateur rests on the few looks the staff has had, so treat the order as rough.' },
    ],
    unknown: [],
    how: 'policy',
    stamp: STAFF_STAMP,
  });
  const valued = input.needs.filter((n) => n.best !== null).slice(0, 3);
  const thin = new Set(valued.map((n) => n.positionName));
  const chosen = new Set(best.map((b) => b.p.playerId));
  const fits = ranked.filter((r) => thin.has(r.p.positionName) && !chosen.has(r.p.playerId)).slice(0, 3);
  const thinClaim = factClaim(v, valued.length ? `Your thinnest spots today: ${valued.map((n) => n.positionName).join(', ')}` : 'Your thinnest spots can\'t be read yet', {
    specialist: BOARD,
    because: [
      ...valued.map((n) => ({ label: n.positionName, value: `${n.best!.name}, about ${n.best!.wins.toFixed(1)} wins expected this season, is the club's best there.` })),
      { label: 'How it is read', value: input.needsBasis },
      { label: 'The staff', value: 'Drafting for a hole is the weaker idea and is offered second on purpose: a pick taken today is years from the majors, and the spot you are thin at now is rarely the one you will be short of when he arrives.' },
    ],
    unknown: valued.length ? [] : ['Nobody at the major league club has a season valued yet, so no spot is the thinnest.'],
    how: 'policy',
    stamp: STAFF_STAMP,
  });
  return [
    block('Best available', best.length ? best.map(({ p, rank }) => shortLine(p, rank, input.rating, true)) : [line('Nobody is on the board yet.', { quiet: true })], { claims: [bestClaim] }),
    block(valued.length ? `Best at your thinnest spots (${valued.map((n) => n.positionName).join(', ')})` : 'Best at your thinnest spots',
      fits.length
        ? fits.map(({ p, rank }) => shortLine(p, rank, input.rating, false))
        : [line(valued.length ? `Nobody else on the board plays ${valued.map((n) => n.positionName).join(', ')}.` : 'Not known until your thinnest spots can be read.', { quiet: true })],
      { claims: [thinClaim] }),
  ];
}

function summaryOf(v: ClubhouseContext, league: DraftLeague, input: DraftBoardInput) {
  const total = input.prospects.length + input.unrated;
  const days = daysBetween(league.gameDate, league.draftDate);
  const draft = league.draftDate ? dayWords(league.draftDate, true) : null;
  const rounds = league.rounds > 0 ? `, ${plural(league.rounds, 'round')}` : '';
  const when = draft === null
    ? ''
    : days === null ? ` Draft day is ${draft}${rounds}.`
      : days > 0 ? ` Draft day is ${draft}, ${plural(days, 'day')} out${rounds}.`
        : days === 0 ? ` Draft day is today${rounds}.` : ` Draft day was ${draft}.`;
  const classRule = input.poolRule === 'class';
  return factClaim(v, `${plural(total, 'draft-eligible player')}.${when}`, {
    specialist: BOARD,
    because: [
      classRule
        ? { label: 'The class', value: 'Your league runs its own school competitions, so the class is read from school year: high-school seniors and college upperclassmen, not yet drafted.' }
        : { label: 'The class', value: 'The players OOTP marks eligible for this league\'s draft and not yet drafted.' },
      { label: 'On the board', value: `${plural(input.prospects.length, 'player')} our scouts have graded all the way to a ceiling, in the scouting staff's order: ceiling first, then now.` },
      ...(league.gameDate ? [{ label: 'Today', value: longDay(league.gameDate)! }] : []),
    ],
    unknown: draft === null ? ['The export doesn\'t date this year\'s draft.'] : [],
    ...(classRule ? { how: 'policy' as const, stamp: 'How the class is read in this league: stated, not fitted' } : {}),
  });
}

function leftOutOf(input: DraftBoardInput): Cell | null {
  const parts: string[] = [];
  if (input.excluded.alreadyPicked > 0) parts.push(`${input.excluded.alreadyPicked} already drafted`);
  if (input.excluded.otherDraft > 0) parts.push(`${input.excluded.otherDraft} in another league's draft`);
  if (input.unrated > 0) parts.push(`${input.unrated} with no full scouted ceiling`);
  return parts.length ? cell(`Not on the board: ${parts.join(', ')}.`, { hint: 'A ceiling counts only when our scouts have graded every tool' }) : null;
}

/** The board's filters, served by key with the asked choice selected (each sent back as `?position=` and `?school=`). */
function filtersOf(ask: DraftBoardAsk): OfficeChoiceGroup[] {
  return [
    { id: 'position', title: cell('Position'), choices: GROUPS.map((g) => ({ text: cell(g.text), selected: g.key === ask.position, value: g.key })) },
    { id: 'school', title: cell('From'), choices: SCHOOLS.map((g) => ({ text: cell(g.text), selected: g.key === ask.school, value: g.key })) },
  ];
}

export function draftBoardView(v: ClubhouseContext, input: DraftBoardInput): ScoutingDraftBoardView {
  const league = input.league;
  if (typeof league === 'string') return draftBoardUnreadView(v, league);
  if (!league.hasDraft) return notShownView(v, 'This league doesn\'t hold an amateur draft.', null, false);
  const calendar = calendarOf(league);
  if (!league.poolVisible) {
    const pool = longDay(league.poolDate);
    const ahead = pool !== null && league.gameDate !== null && (dayOrder(league.poolDate) ?? 0) > (dayOrder(league.gameDate) ?? 0);
    const sentence = pool === null
      ? 'The class isn\'t out yet: OOTP hasn\'t published it.'
      : ahead ? `The class isn't out yet: OOTP publishes it on ${dayWords(league.poolDate, true)}.`
        : `This year's draft is behind you: the next class comes out around ${dayWords(league.poolDate, true)}.`;
    return notShownView(v, sentence, calendar, false);
  }
  const rows = input.prospects.map((p, i) => prospectRow(p, i + 1, input.rating));
  // An empty class is said as empty, never as "nobody graded" (N12 Track B review, M8)
  const none = input.prospects.length + input.unrated === 0
    ? 'Nobody is in this year\'s class.'
    : 'Nobody in the class has a full scouted ceiling yet.';
  return {
    ...boardHead(v),
    published: true,
    notShown: null,
    calendar,
    summary: summaryOf(v, league, input),
    leftOut: leftOutOf(input),
    shortLists: shortLists(v, input),
    filters: filtersOf(DEFAULT_BOARD),
    query: { ...DEFAULT_BOARD },
    count: null,
    more: null,
    board: { columns: BOARD_COLUMNS, rows, empty: cell(none) },
    empty: null,
  };
}

/**
 * The board as served for an ask (N12 Track B review, M2): from the whole board built after the import (`draftBoardView`),
 * the prospects the filters keep, in the board's order, the first `BOARD_PAGE` of them unless every one is asked for
 * (a filter or "Show all"); each row without its reasons, which are read when he is chosen (`draftProspectOf`). Pure:
 * it slices what it is handed.
 */
export function draftBoardServed(full: ScoutingDraftBoardView, ask: DraftBoardAsk): ScoutingDraftBoardView {
  const filters = filtersOf(ask);
  if (!full.published || full.board.rows.length === 0) return { ...full, filters: full.published ? filters : [], query: { ...ask } };
  const group = GROUPS.find((g) => g.key === ask.position)!;
  const school = SCHOOLS.find((g) => g.key === ask.school)!;
  const kept = full.board.rows.filter((r) =>
    (group.positions === null || group.positions.includes(r.cells.position?.display ?? '')) && (school.school === null || r.cells.school?.display === school.school));
  const narrowed = group.positions !== null || school.school !== null;
  const everyone = narrowed || ask.all;
  const shown = everyone ? kept : kept.slice(0, BOARD_PAGE);
  const total = full.board.rows.length;
  const count = narrowed
    ? cell(`${plural(kept.length, 'prospect')} of ${total.toLocaleString('en-US')} on the board`)
    : shown.length < kept.length
      ? cell(`The top ${shown.length} of ${total.toLocaleString('en-US')} on the board, in the staff's order`)
      : cell(`${plural(total, 'prospect')} on the board, in the staff's order`);
  const more = !everyone && shown.length < kept.length
    ? { text: cell(`Show all ${kept.length.toLocaleString('en-US')}`), id: 'all', value: '1' }
    : null;
  return {
    ...full,
    filters,
    query: { ...ask },
    count,
    more,
    board: {
      ...full.board,
      rows: shown.map((r) => ({ ...r, detail: [] })),
      empty: narrowed ? cell('Nobody on the board fits those choices.') : full.board.empty,
    },
  };
}

/** A prospect's reasons for his read, from the whole board, as his row's detail; null when he isn't on the board. */
export function draftProspectOf(full: ScoutingDraftBoardView, playerId: number): ScoutingProspectView | null {
  const row = full.board.rows.find((r) => r.player?.playerId === playerId);
  if (!row) return null;
  return { orgId: full.orgId, importStamp: full.importStamp, reportStamp: full.reportStamp, playerId, row: row.id, detail: row.detail };
}
