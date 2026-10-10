/**
 * League Office's Us vs Them (N12 Track B, D-072): our club beside one other major league club of the league, as facts.
 * The season (the standings' own figures), at the plate and on the mound (the clubs' season totals), each figure with
 * its place among the league's clubs that have it (D-057: ties stated, a club without the figure not counted), and how
 * the two have done against each other (the schedule's own head-to-head). There is no React page; the plan names it.
 *
 * D-060: no odds, no posture, no season-window word, and no verdict on who is better or a combined score: each line is
 * two figures and their places, nothing summed. Pure: it words what the reader (`leagueStandingsViews.ts`) hands it,
 * places included (worked out there), and reads nothing (D-056).
 */
import type { Cell } from '../../contract/presentation.js';
import { cell, servedValue } from '../claim.js';
import { dayWords, factClaim, head, hintIf, plural, type ClubhouseContext } from '../clubhouse/common.js';
import { block, line, tableRow } from '../majorLeague/common.js';
import type { MlbRow } from '../majorLeague/types.js';
import { column, officeClub, ordinal, pctText, signed } from './common.js';
import { choosable } from './office.js';
import type { StatedPlace } from './standings.js';
import { gamesText } from './standings.js';
import type { LeagueUsVsThemView, OfficeChoiceGroup, OfficeClub, OfficeSection } from './types.js';

const SPECIALIST = 'Us vs Them';
const NOT_AN_OPPONENT_WORDS = 'That club isn\'t one Us vs Them can set beside yours.';

/** One club's figure for a line: its value and place, or why it isn't known. */
export interface MeasureFigure {
  value: number | null;
  why: string | null;
  place: StatedPlace | null;
}

/** How a figure is written: a rate to three places (".265"), two places ("4.52"), a count, or a signed count ("+32"). */
export type MeasureFormat = 'rate3' | 'dec2' | 'count' | 'signed';

/** One line of a section: what it measures, how it is written, and both clubs' figures. */
export interface Measure {
  id: string;
  section: 'season' | 'batting' | 'pitching';
  label: string;
  hint: string;
  format: MeasureFormat;
  /** Which way is better, for the place (said in the basis, never as a verdict). */
  better: 'higher' | 'lower';
  us: MeasureFigure;
  them: MeasureFigure;
}

/** A club's line in the standings, as the reader read it, with its place in its division. */
export interface SideFacts {
  teamId: number;
  name: string;
  abbr: string | null;
  ours: boolean;
  w: number | null;
  l: number | null;
  gb: number | null;
  streak: string | null;
  division: string | null;
  divisionPlace: StatedPlace | null;
}

/** One series between the two clubs, from our schedule. */
export interface MeetingSeries {
  startDate: string;
  endDate: string;
  /** At our park. */
  atHome: boolean;
  games: number;
  played: number;
  wins: number;
  losses: number;
}

export interface UsVsThemInput {
  us: SideFacts;
  them: SideFacts | null;
  /** Why there is no other club to set beside ours; null when there is. */
  themWhy: string | null;
  /** The clubs ours can be set beside, in the order offered (our division first, then the standings' order). */
  opponents: Array<{ teamId: number; name: string; division: string | null }>;
  /** How many clubs a place is among, at most (the league's major league clubs). */
  clubs: number;
  measures: Measure[];
  /** Their meetings this season (regular season, played), or null before they have met. */
  headToHead: { w: number; l: number; rf: number; ra: number } | null;
  /** Every series between them this season, in order; null when the schedule couldn't be read (with why). */
  series: MeetingSeries[] | null;
  scheduleWhy: string | null;
  /** How the club set beside ours was chosen when the GM didn't choose: `next` (the next opponent), `closest`, `first`; null when chosen. */
  chosenBy: 'next' | 'closest' | 'first' | null;
}

// ── a figure ────────────────────────────────────────────────────────────────

const DIGITS: Readonly<Record<MeasureFormat, number>> = { rate3: 3, dec2: 2, count: 0, signed: 0 };

function valueText(format: MeasureFormat, n: number): string {
  switch (format) {
    case 'rate3': return pctText(n)!;
    case 'dec2': return n.toFixed(2);
    case 'signed': return signed(Math.round(n));
    default: return String(Math.round(n));
  }
}

const placeText = (p: StatedPlace): string => `${p.tiedWith > 0 ? 'T-' : ''}${ordinal(p.rank)} of ${p.of}`;

function figureCell(m: Measure, f: MeasureFigure): Cell {
  if (f.value === null || !Number.isFinite(f.value)) {
    const why = (f.why ?? 'Not in the export for this club').replace(/\.$/, '');
    return cell('Not known', { tone: 'unknown', hint: hintIf(why) ?? 'Not in the export for this club' });
  }
  const text = valueText(m.format, f.value);
  if (!f.place) return cell(text, { hint: 'Not placed: too few clubs have this figure' });
  return cell(`${text} · ${placeText(f.place)}`, f.place.tiedWith > 0 ? { hint: `Level with ${plural(f.place.tiedWith, 'other club')}` } : {});
}

const figureSort = (f: MeasureFigure): number | null => (f.value === null || !Number.isFinite(f.value) ? null : Number(f.value.toFixed(DIGITS.rate3)));

// ── the sections ────────────────────────────────────────────────────────────

const SECTIONS: ReadonlyArray<{ id: Measure['section']; title: string }> = [
  { id: 'season', title: 'The season' },
  { id: 'batting', title: 'At the plate' },
  { id: 'pitching', title: 'On the mound' },
];

function recordCell(s: SideFacts): Cell {
  return s.w === null || s.l === null ? cell('Not known', { tone: 'unknown', hint: 'The club\'s record isn\'t in the export' }) : cell(`${s.w}–${s.l}`);
}

function divisionCell(s: SideFacts): Cell {
  const p = s.divisionPlace;
  if (!p || s.w === null || s.l === null) return cell('Not known', { tone: 'unknown', hint: 'The club\'s place isn\'t in the export' });
  if (s.w + s.l === 0) return cell('No games yet', { hint: 'No games played yet this season' });
  const back = s.gb === null ? '' : s.gb > 0 ? ` · ${gamesText(s.gb)} back` : '';
  return cell(`${p.tiedWith > 0 ? 'T-' : ''}${ordinal(p.rank)} of ${p.of}${back}`, { hint: hintIf(s.division ? `In the ${s.division}` : null) });
}

function streakCell(s: SideFacts): Cell {
  return s.streak && /^[WL]\d+$/.test(s.streak) ? cell(s.streak) : cell('–', { hint: 'No current streak in the export' });
}

const streakSort = (s: string | null): number | null => {
  const m = /^([WL])(\d+)$/.exec(s ?? '');
  return m ? (m[1] === 'W' ? 1 : -1) * Number(m[2]) : null;
};

/** The season's own lines that aren't a single figure: the record, the division and the streak. */
function seasonRows(us: SideFacts, them: SideFacts): { record: MlbRow; division: MlbRow; streak: MlbRow } {
  const pct = (s: SideFacts) => (s.w !== null && s.l !== null && s.w + s.l > 0 ? s.w / (s.w + s.l) : null);
  return {
    record: tableRow('season-record', { measure: cell('Record', { hint: 'Wins and losses this season' }), us: recordCell(us), them: recordCell(them) },
      { measure: 'Record', us: pct(us), them: pct(them) }),
    division: tableRow('season-division', { measure: cell('In the division', { hint: 'Place in its own division, and games back' }), us: divisionCell(us), them: divisionCell(them) },
      { measure: 'In the division', us: us.gb, them: them.gb }),
    streak: tableRow('season-streak', { measure: cell('Streak', { hint: 'W3 is three straight wins, L2 two straight losses' }), us: streakCell(us), them: streakCell(them) },
      { measure: 'Streak', us: streakSort(us.streak), them: streakSort(them.streak) }),
  };
}

function sectionOf(id: Measure['section'], title: string, us: OfficeClub, them: OfficeClub, rows: MlbRow[], clubs: number): OfficeSection {
  return {
    id: `usVsThem-${id}`,
    title: cell(title),
    summary: cell(`Each figure with its place among the league's ${plural(clubs, 'club')}`),
    table: choosable({
      columns: [
        column('measure', 'Line'),
        // Each row is a different figure in its own unit, so neither club's column sorts (N12 Track B review, M6)
        column('us', us.name, true, { hint: 'Your club', sortable: false }),
        column('them', them.name, true, { sortable: false }),
      ],
      rows,
      empty: cell('No figures for these clubs in the export.'),
    }),
    note: null,
  };
}

// ── the meetings ────────────────────────────────────────────────────────────

function seriesWords(s: MeetingSeries): string {
  const days = s.startDate === s.endDate ? dayWords(s.startDate) : `${dayWords(s.startDate)} to ${dayWords(s.endDate)}`;
  const where = s.atHome ? 'at home' : 'away';
  const result = s.played === s.games
    ? `${s.wins}–${s.losses}`
    : s.played > 0 ? `${s.wins}–${s.losses} so far, ${s.games - s.played} to play` : `${plural(s.games, 'game')} to play`;
  return `${days} · ${where} · ${result}`;
}

function meetingsBlock(input: UsVsThemInput, them: OfficeClub) {
  if (input.series === null) return block(`Meetings with the ${them.name}`, [line(input.scheduleWhy ?? 'The schedule couldn\'t be read.', { quiet: true })]);
  if (!input.series.length) return block(`Meetings with the ${them.name}`, [line('The schedule has no games between the two clubs this season.', { quiet: true })]);
  const next = input.series.find((s) => s.played < s.games) ?? null;
  const lines = input.series.map((s) => line(seriesWords(s), s === next ? { chips: [cell('Next')] } : { quiet: s.played < s.games }));
  lines.push(next
    ? line(`Next: ${seriesWords(next)}`, { quiet: true })
    : line('No more games between them this season.', { quiet: true }));
  return block(`Meetings with the ${them.name}`, lines);
}

// ── the view ────────────────────────────────────────────────────────────────

const CHOSEN_WORDS: Readonly<Record<NonNullable<UsVsThemInput['chosenBy']>, string>> = {
  next: 'Opened on your next opponent',
  closest: 'Opened on the closest club in your division',
  first: 'Opened on the first club in the standings',
};

function base(v: ClubhouseContext, them: string | null) {
  return head(v, 'Us vs Them', {
    text: them ? `Your club beside the ${them}: the season, at the plate and on the mound` : 'Your club beside another of the league\'s clubs',
    full: 'Two clubs side by side, as facts: the standings\' figures, the season\'s batting and pitching totals, each with its place among the league\'s clubs, and how the two have done against each other this season. There is no forecast and no single score: each line is the two figures and their places.',
    specialist: SPECIALIST,
  });
}

function note(v: ClubhouseContext) {
  return factClaim(v, 'How Us vs Them is read', {
    specialist: SPECIALIST,
    because: [
      { label: 'Places', value: 'Each figure\'s place among the league\'s major league clubs that have it, best first: lower is better for runs allowed, earned run average, walks and hits allowed, home runs allowed and strikeouts at the plate. Clubs level at the figure as shown share the place (marked T-); a club without the figure isn\'t counted.' },
      { label: 'The season', value: 'The record, the division, runs and the streak are the standings\' own figures; runs a game divide them by games played.' },
      { label: 'At the plate and on the mound', value: 'The clubs\' season totals at the major league. Rates are worked from the counts where the export gives them (on-base from hits, walks, hit by pitch and sacrifice flies; slugging from total bases), and read as exported otherwise. Counts are season totals, so a club that has played more games has had more chances.' },
      { label: 'Against each other', value: 'Regular-season games between the two clubs this season, from the schedule.' },
    ],
  });
}

function opponentGroup(input: UsVsThemInput, chosen: number | null): OfficeChoiceGroup {
  return {
    id: 'team',
    title: cell('Set beside'),
    choices: input.opponents.map((o) => ({
      text: cell(o.name, { hint: hintIf(o.division ? `In the ${o.division}` : null) }),
      selected: o.teamId === chosen,
      value: String(o.teamId),
    })),
  };
}

export function usVsThemView(v: ClubhouseContext, input: UsVsThemInput): LeagueUsVsThemView {
  const us = officeClub(input.us.teamId, input.us.name, input.us.abbr, true);
  if (!input.them) {
    return {
      ...base(v, null),
      query: { team: 0 },
      us,
      them: null,
      opponents: opponentGroup(input, null),
      headToHead: null,
      meetings: null,
      sections: [],
      note: note(v),
      empty: cell(input.themWhy ?? NOT_AN_OPPONENT_WORDS),
    };
  }
  const them = officeClub(input.them.teamId, input.them.name, input.them.abbr, false);
  const own = seasonRows(input.us, input.them);
  const rowsOf = (section: Measure['section']) => input.measures.filter((m) => m.section === section).map((m) => tableRow(`${section}-${m.id}`, {
    measure: cell(m.label, { hint: m.hint }),
    us: figureCell(m, m.us),
    them: figureCell(m, m.them),
  }, { measure: m.label, us: figureSort(m.us), them: figureSort(m.them) }));
  const sections = SECTIONS.map(({ id, title }) => {
    const rows = id === 'season'
      ? [own.record, ...rowsOf('season').slice(0, 1), own.division, ...rowsOf('season').slice(1), own.streak]
      : rowsOf(id);
    return sectionOf(id, title, us, them, rows, input.clubs);
  });
  const h = input.headToHead;
  const headToHead = h && h.w + h.l > 0
    // The record in the words themselves: the line is drawn as words, its value only beside it (review, M6)
    ? factClaim(v, `Against the ${them.name} this season: ${h.w}–${h.l}, runs ${h.rf}–${h.ra}`, {
      specialist: SPECIALIST,
      value: servedValue(h.w, 'wins', `${h.w}–${h.l} · runs ${h.rf}–${h.ra}`),
      because: [
        { label: 'Won', value: String(h.w) },
        { label: 'Lost', value: String(h.l) },
        { label: 'Runs', value: `${h.rf} scored, ${h.ra} allowed (${signed(h.rf - h.ra)})` },
        { label: 'Games', value: 'Regular-season games between the two clubs this season, from the schedule.' },
      ],
    })
    : null;
  const lede = base(v, them.name);
  return {
    ...lede,
    query: { team: them.teamId },
    us,
    them,
    opponents: opponentGroup(input, them.teamId),
    headToHead,
    meetings: meetingsBlock(input, them),
    sections,
    note: note(v),
    empty: null,
    ...(input.chosenBy ? { opened: cell(CHOSEN_WORDS[input.chosenBy]) } : {}),
  };
}

/** Us vs Them when it couldn't be read: the sentence why, nothing else. */
export function usVsThemUnreadView(v: ClubhouseContext, us: { teamId: number; name: string | null }, team: number | null, why: string): LeagueUsVsThemView {
  const text = /[.!?]$/.test(why.trim()) ? why.trim() : `${why.trim()}.`;
  return {
    ...base(v, null),
    query: { team: team ?? 0 },
    us: officeClub(us.teamId, us.name, null, true),
    them: null,
    opponents: { id: 'team', title: cell('Set beside'), choices: [] },
    headToHead: null,
    meetings: null,
    sections: [],
    note: note(v),
    empty: cell(text),
  };
}
