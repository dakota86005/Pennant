/**
 * Franchise History (N12 Track B, D-072): the club's every season as the export's record books hold it, worded from
 * `computeFranchise` (the React page's `/api/franchise`), and the GM's own seasons from `computeTenure`
 * (`/api/tenure`). Pure: it words what it is handed and reads nothing (D-056). Every figure is a fact of the export;
 * nothing is ranked or judged here: the best and worst season are the route's (by winning percentage, a tie to the
 * latest), and how a season ended is what the export says.
 *
 * It holds every season, however long the history (a league from 1930 has 85 and more): the chart oldest first, the
 * table latest first, with no paging (the native table scrolls). A column no season fills (finish, best players,
 * payroll, attendance) is served hidden, never dropped, so the GM can still show it and read that it is empty.
 */
import type { Cell, ServedValue, Tone } from '../../contract/presentation.js';
import type { FranchiseHistory, FranchiseSeason } from '../../franchise.js';
import type { Tenure, TenureSeason } from '../../gameplan.js';
import { cell, servedValue, unknownValue } from '../claim.js';
import { factClaim, head, hintIf, player, plural, type ClubhouseContext } from '../clubhouse/common.js';
import { GLOSSARY_EXTRA } from '../glossary.js';
import { tableRow } from '../majorLeague/common.js';
import type { MlbPlayer } from '../majorLeague/types.js';
import { money } from '../player/words.js';
import { column, officeClub, ordinal, pctText } from './common.js';
import type { LeagueFranchiseView, LeagueSeasonChart, LeagueSeasonPoint, LeagueTenure, OfficeRow, OfficeSection } from './types.js';

const RECORD = 'The franchise\'s record books';
const TENURE = 'Your record as manager';

export interface FranchiseInput {
  orgId: number;
  /** The club's name as the export labels it; null when it names none. */
  clubName: string | null;
  /** The route's answer, or its refusal in words ("This export has no franchise history"). */
  history: FranchiseHistory | string;
  /** Whether the export carries how seasons ended (and their best players), and their payroll and attendance. */
  carry: { results: boolean; finances: boolean };
  /** The GM's own seasons (`computeTenure`), or null when it couldn't be read. */
  tenure: Tenure | null;
  /** The seasons the export's history has a line for (how they ended, their best players); the rest are not known. */
  resultYears: readonly number[];
}

/** What the export carries, as this view reads it: whether a season's ending is recorded, and how many aren't. */
interface Reading {
  results: boolean;
  finances: boolean;
  known: (year: number) => boolean;
  /** Seasons whose ending the history has no line for (when it has a line for some). */
  unrecorded: number;
}

function readingOf(input: Pick<FranchiseInput, 'carry' | 'resultYears'>, seasons: readonly FranchiseSeason[]): Reading {
  const years = new Set(input.resultYears);
  const results = input.carry.results && seasons.some((s) => years.has(s.year));
  return {
    results,
    finances: input.carry.finances,
    known: (year) => results && years.has(year),
    unrecorded: results ? seasons.filter((s) => !years.has(s.year)).length : 0,
  };
}

/** The sentence for the seasons whose ending isn't recorded, or none. */
const unrecordedSentence = (r: Reading): string[] =>
  (r.unrecorded > 0
    ? [`How ${plural(r.unrecorded, 'season')} ended: the export's history has no line for ${r.unrecorded === 1 ? 'it, so it isn\'t' : 'them, so they aren\'t'} marked or counted.`]
    : []);

/** A glossary entry short enough for a help tag: the whole, or its first sentence. */
function gloss(term: string): string | undefined {
  const text = GLOSSARY_EXTRA[term];
  if (!text) return undefined;
  return hintIf(text) ?? hintIf(/^[^.]*\./.exec(text)?.[0]);
}

const thousands = (n: number): string => Math.round(n).toLocaleString('en-US');
const recordText = (w: number, l: number): string => `${thousands(w)}–${thousands(l)}`;
const gbText = (gb: number): string => (Number.isInteger(gb) ? String(gb) : gb.toFixed(1));

/** How a season ended, as the chart's mark: `title`, `playoffs` or `none`. */
const resultOf = (s: FranchiseSeason): 'title' | 'playoffs' | 'none' => (s.wonTitle ? 'title' : s.madePlayoffs ? 'playoffs' : 'none');

/** A season's best players the export names (a player it no longer carries is left out). */
function bestOf(s: FranchiseSeason): Array<{ id: number; name: string; role: string }> {
  return [
    s.bestHitter?.name ? { id: s.bestHitter.player_id, name: s.bestHitter.name, role: 'hitter' } : null,
    s.bestPitcher?.name ? { id: s.bestPitcher.player_id, name: s.bestPitcher.name, role: 'pitcher' } : null,
  ].filter((x): x is { id: number; name: string; role: string } => x !== null);
}

/** The games-behind cell: the number, or a dash for a club that finished on top (a fact, said in its help tag). */
function gbCell(gb: number | null, finish: number | null): { cell: Cell; sort: number | null } {
  if (gb === null || !Number.isFinite(gb)) return { cell: cell('Not known', { tone: 'unknown', hint: 'The export doesn\'t carry it' }), sort: null };
  if (gb <= 0) return { cell: cell('—', { hint: finish === 1 ? 'Finished first: no games behind' : 'No games behind the leader' }), sort: 0 };
  return { cell: cell(gbText(gb)), sort: gb };
}

/** The place a club finished, or not known (the export leaves it 0 for some seasons). */
function finishCell(finish: number | null): { cell: Cell; sort: number | null } {
  if (!finish || finish <= 0) return { cell: cell('Not known', { tone: 'unknown', hint: 'The export doesn\'t carry where it finished' }), sort: null };
  return { cell: cell(ordinal(finish)), sort: finish };
}

function resultCell(s: FranchiseSeason, known: boolean): { cell: Cell; sort: number | null } {
  if (!known) return { cell: cell('Not known', { tone: 'unknown', hint: 'The export doesn\'t say how its seasons ended' }), sort: null };
  if (s.wonTitle) return { cell: cell('Won it all', { tone: 'good' }), sort: 2 };
  if (s.madePlayoffs) return { cell: cell('Playoffs', { hint: 'Made the playoffs' }), sort: 1 };
  return { cell: cell('No playoffs'), sort: 0 };
}

/** Payroll or attendance: the figure, or not known (the export's 0 is a season it didn't record, as the React page reads it). */
function moneyOrCount(v: number | null, show: (n: number) => string, what: string): { cell: Cell; sort: number | null } {
  if (v === null || !Number.isFinite(v) || v === 0) return { cell: cell('Not known', { tone: 'unknown', hint: `The export carries no ${what} for that season` }), sort: null };
  return { cell: cell(show(v)), sort: v };
}

function seasonsSection(v: ClubhouseContext, seasons: FranchiseSeason[], carry: Reading): OfficeSection {
  const shows = {
    finish: seasons.some((s) => s.finish > 0),
    best: seasons.some((s) => bestOf(s).length > 0),
    payroll: seasons.some((s) => !!s.payroll),
    attendance: seasons.some((s) => !!s.attendance),
  };
  const columns = [
    column('year', 'Year', true),
    column('team', 'Team', false, { hint: 'The club\'s name that season' }),
    column('w', 'W', true, { hint: gloss('W') }),
    column('l', 'L', true, { hint: gloss('L') }),
    column('pct', 'Win %', true, { hint: gloss('PCT') }),
    column('finish', 'Finish', true, { hint: 'Where the club finished in the standings', hidden: !shows.finish }),
    column('gb', 'GB', true, { hint: gloss('GB') }),
    column('result', 'Result', false, { hint: 'How the season ended, as the export records it' }),
    column('best', 'Best players', false, { hint: 'The season\'s best hitter and pitcher, as the export names them', hidden: !shows.best }),
    column('payroll', 'Payroll', true, { hint: 'What the club spent on players that season', hidden: !shows.payroll }),
    // Served hidden even when filled: the table keeps to about ten columns, and attendance is shown from the header menu
    column('attendance', 'Attendance', true, { hint: 'The season\'s home attendance', hidden: true }),
  ];
  const rows: OfficeRow[] = seasons.map((s) => {
    const best = bestOf(s);
    const finish = finishCell(s.finish);
    const gb = gbCell(s.gb, s.finish);
    const result = resultCell(s, carry.known(s.year));
    const payroll = moneyOrCount(s.payroll, money, 'payroll');
    const attendance = moneyOrCount(s.attendance, thousands, 'attendance');
    const pct = pctText(s.pct);
    const cells: Record<string, Cell> = {
      year: cell(String(s.year)),
      team: s.name?.trim() ? cell(s.name.trim()) : cell('Not known', { tone: 'unknown', hint: 'The export doesn\'t name the club that season' }),
      w: cell(String(s.w)),
      l: cell(String(s.l)),
      pct: pct === null ? cell('Not known', { tone: 'unknown' }) : cell(pct),
      finish: finish.cell,
      gb: gb.cell,
      result: result.cell,
      best: best.length
        ? cell(best.map((b) => b.name).join(' · '), { hint: hintIf(best.map((b) => `${b.name}, best ${b.role}`).join('; ')) })
        : cell('Not named', { tone: 'unknown', hint: 'The export names no best player that season' }),
      payroll: payroll.cell,
      attendance: attendance.cell,
    };
    const sort: Record<string, number | string | null> = {
      year: s.year,
      team: s.name?.trim() || null,
      w: s.w,
      l: s.l,
      pct: Number.isFinite(s.pct) ? s.pct : null,
      finish: finish.sort,
      gb: gb.sort,
      result: result.sort,
      best: best[0]?.name ?? null,
      payroll: payroll.sort,
      attendance: attendance.sort,
    };
    const players: MlbPlayer[] = best.filter((b) => b.id > 0).map((b) => player(b.id, b.name, null));
    return tableRow(`season-${s.year}`, cells, sort, { players });
  });
  return {
    id: 'seasons',
    title: cell('Season by season'),
    summary: cell(`${plural(seasons.length, 'season')}, the latest first`),
    table: { columns, rows, empty: cell('This export carries no completed seasons for the club.') },
    note: factClaim(v, 'What the columns mean', {
      specialist: RECORD,
      because: [
        { label: 'Seasons', value: 'Every completed season the export carries for the club, back to its first: a season with no game played is left out.' },
        { label: 'Result', value: carry.results ? '"Won it all" is a season the club won the playoffs; "Playoffs" one it reached them.' : 'The export doesn\'t carry how seasons ended, so no season is marked as a title or a playoff season.' },
        { label: 'Hidden columns', value: 'A column no season fills in this export (finish, best players, payroll) starts hidden; attendance always does. Show any of them from the table\'s columns.' },
        { label: 'Not known', value: 'A season the export leaves blank (or at zero) for finish, payroll or attendance says not known, never a zero.' },
      ],
      unknown: [
        ...(carry.results ? unrecordedSentence(carry) : ['How each season ended and who were its best players: the export carries no season history beyond the record.']),
        ...(carry.finances ? [] : ['Each season\'s payroll and attendance: the export carries no past finances.']),
      ],
    }),
  };
}

function chartOf(v: ClubhouseContext, h: FranchiseHistory, carry: Reading): LeagueSeasonChart | null {
  const s = h.summary;
  if (!s || h.seasons.length === 0) return null;
  // Oldest first, so the eye reads the franchise forwards in time
  const points: LeagueSeasonPoint[] = [...h.seasons].reverse().map((x) => {
    const result = carry.known(x.year) ? resultOf(x) : 'none';
    const ended = result === 'title' ? ', won it all' : result === 'playoffs' ? ', made the playoffs' : '';
    return { year: x.year, wins: x.w, losses: x.l, result, display: `${x.year}: ${x.w}-${x.l}${ended}` };
  });
  const span = s.firstYear === s.lastYear ? `${s.firstYear}` : `${s.firstYear} to ${s.lastYear}`;
  const parts = [`Wins in each of ${plural(s.seasons, 'season')}, ${span}, oldest first`];
  if (s.bestSeason) parts.push(`best record ${s.bestSeason.w}-${s.bestSeason.l} in ${s.bestSeason.year}`);
  if (s.worstSeason) parts.push(`worst ${s.worstSeason.w}-${s.worstSeason.l} in ${s.worstSeason.year}`);
  const summary = `${parts.join('; ')}${carry.results ? `; ${plural(s.titles, 'title')} and ${plural(s.playoffs, 'playoff season')}` : ''}.`;
  return {
    title: cell('Wins by season'),
    caption: factClaim(v, carry.results ? 'Titles and playoff seasons are marked; point at a bar for its season' : 'Point at a bar for its season', {
      specialist: RECORD,
      because: [
        { label: 'Each bar', value: 'One season\'s wins, oldest on the left.' },
        ...(carry.results
          ? [
            { label: 'Title', value: 'A season the club won the playoffs, as the export records it.' },
            { label: 'Playoffs', value: 'A season the club reached the playoffs without winning them.' },
          ]
          : []),
      ],
      unknown: carry.results ? unrecordedSentence(carry) : ['How each season ended: the export carries no season history beyond the record, so no bar is marked.'],
    }),
    axis: cell('Wins'),
    points,
    summary,
    legend: [
      { result: 'title', text: cell('Won it all', { hint: 'A season the club won the playoffs' }) },
      { result: 'playoffs', text: cell('Made the playoffs', { hint: 'Reached the playoffs without winning them' }) },
      { result: 'none', text: carry.results ? cell('Other seasons') : cell('Every season', { hint: 'The export doesn\'t say how its seasons ended' }) },
    ],
  };
}

function figuresOf(v: ClubhouseContext, h: FranchiseHistory, carry: Reading) {
  const s = h.summary;
  if (!s) return [];
  const pct = pctText(s.pct);
  const span = s.firstYear === s.lastYear ? `${s.firstYear}` : `${s.firstYear}–${s.lastYear}`;
  const fact = (text: string, value: ServedValue, because: Array<{ label: string; value: string }>, tone?: Tone, unknown: string[] = []) =>
    factClaim(v, text, { specialist: RECORD, value, because, ...(tone ? { tone } : {}), unknown });
  const seasonValue = (x: { year: number; w: number; l: number }) =>
    servedValue(x.w + x.l > 0 ? x.w / (x.w + x.l) : 0, 'rate', `${x.year}: ${x.w}–${x.l}`);
  const results = carry.results ? unrecordedSentence(carry) : ['How each season ended: the export carries no season history beyond the record.'];
  return [
    fact(`Seasons, ${span}`, servedValue(s.seasons, 'count', String(s.seasons)), [
      { label: 'Seasons', value: `${plural(s.seasons, 'completed season')} in the export, ${span}.` },
    ]),
    fact('All-time record', servedValue(s.pct, 'rate', `${recordText(s.wins, s.losses)}${pct ? ` · ${pct}` : ''}`), [
      { label: 'Wins', value: thousands(s.wins) },
      { label: 'Losses', value: thousands(s.losses) },
      { label: 'Winning percentage', value: pct ?? 'Not known' },
    ]),
    fact(carry.results ? `Titles, with ${plural(s.playoffs, 'playoff trip')}` : 'Titles', carry.results
      ? servedValue(s.titles, 'count', String(s.titles))
      : unknownValue('count', 'Not known'), [
      { label: 'Titles', value: carry.results ? `${s.titles}: seasons the club won the playoffs.` : 'Not in the export.' },
      { label: 'Playoff trips', value: carry.results ? `${s.playoffs}: seasons the club reached the playoffs.` : 'Not in the export.' },
    ], carry.results ? undefined : 'unknown', results),
    ...(s.bestSeason ? [fact('Best season', seasonValue(s.bestSeason), [
      { label: 'Read as', value: 'The season with the best winning percentage; a tie goes to the latest.' },
    ], 'good')] : []),
    ...(s.worstSeason ? [fact('Worst season', seasonValue(s.worstSeason), [
      { label: 'Read as', value: 'The season with the worst winning percentage; a tie goes to the latest.' },
    ], 'bad')] : []),
  ];
}

function tenureResult(t: TenureSeason): { cell: Cell; sort: number } {
  const ended = t.wonPlayoffs ? 'Won it all' : t.madePlayoffs ? 'Made the playoffs' : null;
  const words = [ended, t.fired ? 'Fired' : null].filter(Boolean).join(' · ');
  const tone: Tone | undefined = t.fired ? 'bad' : t.wonPlayoffs ? 'good' : undefined;
  return {
    cell: cell(words || 'No playoffs', tone ? { tone } : {}),
    sort: (t.wonPlayoffs ? 2 : t.madePlayoffs ? 1 : 0) - (t.fired ? 0.5 : 0),
  };
}

function tenureOf(v: ClubhouseContext, tenure: Tenure | null): LeagueTenure | null {
  if (!tenure || tenure.seasons.length === 0 || !tenure.totals) return null;
  const t = tenure.totals;
  const pct = pctText(t.pct);
  const fact = (text: string, value: ServedValue, because: Array<{ label: string; value: string }>) =>
    factClaim(v, text, { specialist: TENURE, value, because });
  const rows: OfficeRow[] = tenure.seasons.map((s) => {
    const finish = finishCell(s.finish);
    const gb = gbCell(s.gb, s.finish);
    const result = tenureResult(s);
    const sp = pctText(s.pct);
    const cells: Record<string, Cell> = {
      year: cell(String(s.year)),
      club: s.club === 'Unknown' ? cell('Not known', { tone: 'unknown', hint: 'The export no longer carries that club' }) : cell(s.club),
      record: cell(`${s.w}-${s.l}`),
      pct: sp === null ? cell('Not known', { tone: 'unknown' }) : cell(sp),
      finish: finish.cell,
      gb: gb.cell,
      result: result.cell,
    };
    const sort: Record<string, number | string | null> = {
      year: s.year, club: s.club === 'Unknown' ? null : s.club, record: s.w, pct: sp === null ? null : s.pct,
      finish: finish.sort, gb: gb.sort, result: result.sort,
    };
    return tableRow(`tenure-${s.year}-${s.club}`, cells, sort);
  });
  return {
    title: cell('Your Tenure'),
    lede: cell('The rest of this page is about the club; this is about you: one line per season you have run a club'),
    figures: [
      fact('Seasons', servedValue(t.seasons, 'count', String(t.seasons)), [{ label: 'Seasons', value: `${plural(t.seasons, 'season')} as the club's manager in the export.` }]),
      t.pct === null
        ? factClaim(v, 'Record', { specialist: TENURE, value: unknownValue('rate', `${t.w}-${t.l}`), because: [{ label: 'Record', value: `${t.w}-${t.l}` }], unknown: ['A winning percentage: no game is recorded.'] })
        : fact('Record', servedValue(t.pct, 'rate', `${t.w}-${t.l}${pct ? ` · ${pct}` : ''}`), [{ label: 'Wins', value: String(t.w) }, { label: 'Losses', value: String(t.l) }]),
      fact('Playoffs', servedValue(t.playoffs, 'count', String(t.playoffs)), [{ label: 'Playoffs', value: 'Seasons your club reached the playoffs.' }]),
      fact('Titles', servedValue(t.titles, 'count', String(t.titles)), [{ label: 'Titles', value: 'Seasons your club won the playoffs.' }]),
    ],
    seasons: {
      id: 'tenure',
      title: cell('Your seasons'),
      summary: null,
      table: {
        columns: [
          column('year', 'Year', true),
          column('club', 'Club', false, { hint: 'The club you ran that season' }),
          column('record', 'W-L', true, { hint: 'Wins and losses' }),
          column('pct', 'Win %', true, { hint: gloss('PCT') }),
          column('finish', 'Finish', true, { hint: 'Where the club finished in the standings' }),
          column('gb', 'GB', true, { hint: gloss('GB') }),
          column('result', 'Result', false, { hint: 'How the season ended, and whether you were fired' }),
        ],
        rows,
        empty: cell('No season as manager is in the export yet.'),
      },
      note: null,
    },
  };
}

export function franchiseView(v: ClubhouseContext, input: FranchiseInput): LeagueFranchiseView {
  const base = head(v, 'Franchise History', {
    text: 'Every season the club has played, as the export\'s record books hold it',
    full: 'The club\'s record in every completed season the export carries, back to its first: wins by season on the chart (oldest first), and each season\'s record, finish, how it ended, its best players and its finances in the table (latest first). Above it, your own seasons as manager when the export keeps them.',
    specialist: RECORD,
  });
  const club = officeClub(input.orgId, input.clubName, null, true);
  const tenure = tenureOf(v, input.tenure);
  const h = input.history;
  if (typeof h === 'string') {
    return {
      ...base, club, figures: [], chart: null, seasons: seasonsSection(v, [], readingOf(input, [])), tenure,
      empty: cell(`No franchise history: ${h.charAt(0).toLowerCase()}${h.slice(1)}.`),
    };
  }
  const none = !h.summary || h.seasons.length === 0;
  const reading = readingOf(input, h.seasons);
  return {
    ...base,
    club,
    figures: figuresOf(v, h, reading),
    chart: chartOf(v, h, reading),
    seasons: seasonsSection(v, h.seasons, reading),
    tenure,
    empty: none ? cell('No franchise history: this export carries no completed seasons for the club.') : null,
  };
}

/** The view when it couldn't be read: its head, nothing in it, and why. */
export function franchiseUnreadView(v: ClubhouseContext, orgId: number, clubName: string | null, why: string): LeagueFranchiseView {
  const base = head(v, 'Franchise History', {
    text: 'Every season the club has played, as the export\'s record books hold it',
    full: 'The club\'s record in every completed season the export carries, back to its first.',
    specialist: RECORD,
  });
  return {
    ...base,
    club: officeClub(orgId, clubName, null, true),
    figures: [],
    chart: null,
    seasons: seasonsSection(v, [], readingOf({ carry: { results: true, finances: true }, resultYears: [] }, [])),
    tenure: null,
    empty: cell(why.endsWith('.') ? why : `${why}.`),
  };
}
