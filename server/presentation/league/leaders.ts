/**
 * League Office's Leaders (N12 Track B, D-072): the league's top ten in each batting and pitching category, worded from
 * `computeLeaderboards` (the React page's `/api/leaderboards/:orgId`), in the route's own order. Pure: it words what the
 * reader (`leagueLeadersViews.ts`) hands it and reads nothing (D-056). No grade appears here: the leaders are season
 * lines, objective facts from the export.
 *
 * The season is named only when the league's own row carries it (D-018): the route falls back to the calendar year to
 * read its lines, and a year the export never stated is not shown as the league's.
 */
import type { Cell } from '../../contract/presentation.js';
import type { Leader, Leaderboards } from '../../rosterops.js';
import { cell } from '../claim.js';
import { factClaim, head, hintIf, player, type ClubhouseContext } from '../clubhouse/common.js';
import { tableRow } from '../majorLeague/common.js';
import { BATTING_STATS, PITCHING_STATS } from '../statCatalog.js';
import { column } from './common.js';
import { choosable } from './office.js';
import type { LeagueLeaderGroup, LeagueLeadersView, OfficeRow, OfficeSection } from './types.js';

const LEADERS = 'The league leaders';

/** Who qualifies for a rate leader, as the route works it out (`leaderQualifier`). */
export interface LeaderQualifier {
  games: number;
  /** Whether the club's games played came from the export (otherwise the route counts 20). */
  gamesFromExport: boolean;
  minPA: number;
  minOuts: number;
}

export interface LeadersInput {
  /** The route's answer, or the sentence it was refused with. */
  leaders: Leaderboards | string;
  /** The season as the league's own row states it; null when it states none. */
  season: number | null;
  /** The league's own name; null when the export names none. */
  leagueName: string | null;
  /** Who qualifies for a rate; null when the leaders weren't read. */
  qualifier: LeaderQualifier | null;
}

interface Category {
  key: string;
  title: string;
  /** The season line's key in the stat catalog (its column's help). */
  stat: string;
  /** A rate: qualified players only. */
  rate: boolean;
  lowestFirst: boolean;
}

const BATTING: Category[] = [
  { key: 'AVG', title: 'Batting average', stat: 'avg', rate: true, lowestFirst: false },
  { key: 'OPS', title: 'On-base plus slugging', stat: 'ops', rate: true, lowestFirst: false },
  { key: 'HR', title: 'Home runs', stat: 'hr', rate: false, lowestFirst: false },
  { key: 'RBI', title: 'Runs batted in', stat: 'rbi', rate: false, lowestFirst: false },
  { key: 'SB', title: 'Stolen bases', stat: 'sb', rate: false, lowestFirst: false },
  { key: 'WAR', title: 'Wins above replacement', stat: 'war', rate: false, lowestFirst: false },
];

const PITCHING: Category[] = [
  { key: 'ERA', title: 'Earned run average', stat: 'era', rate: true, lowestFirst: true },
  { key: 'WHIP', title: 'Walks and hits per inning', stat: 'whip', rate: true, lowestFirst: true },
  { key: 'K', title: 'Strikeouts', stat: 'k', rate: false, lowestFirst: false },
  { key: 'W', title: 'Wins', stat: 'w', rate: false, lowestFirst: false },
  { key: 'SV', title: 'Saves', stat: 'sv', rate: false, lowestFirst: false },
  { key: 'WAR', title: 'Wins above replacement', stat: 'war', rate: false, lowestFirst: false },
];

const innings = (outs: number): number => Math.round(outs / 3);

/** The route's figure as it serves it ('.312', '2.45', 41), and its number for the sort; not known when it has none. */
function valueOf(value: Leader['value'] | null | undefined): { cell: Cell; sort: number | null } {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (value === null || value === undefined || !Number.isFinite(n)) {
    return { cell: cell('Not known', { tone: 'unknown', hint: 'Not in his line this season' }), sort: null };
  }
  return { cell: cell(String(value)), sort: n };
}

function section(group: 'batting' | 'pitching', c: Category, leaders: Leader[], q: LeaderQualifier, orgId: number): OfficeSection {
  const def = (group === 'batting' ? BATTING_STATS : PITCHING_STATS).find((d) => d.key === c.stat);
  const rows: OfficeRow[] = leaders.map((l, i) => {
    const name = String(l.name ?? '').trim() || 'Unnamed player';
    const club = String(l.team ?? '').trim();
    const value = valueOf(l.value);
    const playerId = Number(l.player_id);
    const cells: Record<string, Cell> = {
      rank: cell(String(i + 1)),
      player: cell(name),
      club: club
        ? cell(club, l.isOrg ? { hint: 'Your club' } : {})
        : cell('Not known', { tone: 'unknown', hint: l.isOrg ? 'Your club; its abbreviation isn\'t in the export' : 'His club\'s abbreviation isn\'t in the export' }),
      value: value.cell,
    };
    const base = tableRow(`${group}.${c.key}.${playerId}`, cells, { rank: i + 1, player: name, club: club || null, value: value.sort }, {
      player: player(playerId, name, l.isOrg ? orgId : null),
    });
    return l.isOrg ? { ...base, ours: true } : base;
  });
  const summary = c.rate
    ? cell(group === 'batting'
      ? `${c.lowestFirst ? 'Lowest first · ' : ''}Qualified hitters only: ${q.minPA}+ plate appearances`
      : `${c.lowestFirst ? 'Lowest first · ' : ''}Qualified pitchers only: ${innings(q.minOuts)}+ innings`)
    : null;
  return {
    id: `${group}.${c.key}`,
    title: cell(c.title, { hint: c.key }),
    summary,
    table: choosable({
      columns: [
        column('rank', 'Rank', true),
        column('player', 'Player'),
        column('club', 'Club'),
        column('value', c.key, true, hintIf(def?.desc) ? { hint: hintIf(def?.desc) } : {}),
      ],
      rows,
      empty: cell(c.rate ? 'Nobody qualifies yet.' : 'No lines this season yet.'),
    }),
    note: null,
  };
}

function leadersHead(v: ClubhouseContext, input: Pick<LeadersInput, 'season' | 'leagueName'> | null) {
  const season = input?.season ?? null;
  const league = (input?.leagueName ?? '').trim();
  const whose = [season !== null ? String(season) : null, league || null].filter(Boolean).join(' ');
  return head(v, 'Leaders', {
    text: whose ? `${whose} leaders: the top ten in each category, your players marked` : 'The league\'s leaders: the top ten in each category, your players marked',
    full: 'The top ten in each batting and pitching category at the league\'s major league level this season, in order: highest first, and lowest first for earned run average and walks and hits per inning. The rate leaders count qualified players only; the counting leaders count everyone. Your organization\'s players are marked, and their club is named as yours.',
    specialist: LEADERS,
  });
}

/** The leaders' payload when they couldn't be read: the head and the sentence. */
export function leadersUnreadView(v: ClubhouseContext, why: string): LeagueLeadersView {
  return { ...leadersHead(v, null), season: null, qualifier: null, groups: [], empty: cell(why.endsWith('.') ? why : `${why}.`) };
}

/** The route's refusals, in the GM's words. */
function refusalWords(error: string): string {
  if (/no data imported/i.test(error)) return 'No league is imported yet.';
  if (/unknown org/i.test(error)) return 'This club isn\'t in the export.';
  return `The leaders couldn't be read: ${error}.`;
}

export function leadersView(v: ClubhouseContext, input: LeadersInput): LeagueLeadersView {
  const orgId = v.ctx.build.orgId;
  if (typeof input.leaders === 'string' || input.qualifier === null) return { ...leadersUnreadView(v, refusalWords(typeof input.leaders === 'string' ? input.leaders : 'not read')), ...leadersHead(v, input) };
  const board = input.leaders;
  const q = input.qualifier;
  const groups: LeagueLeaderGroup[] = [
    { id: 'batting', title: cell('Batting'), sections: BATTING.map((c) => section('batting', c, board.batting[c.key as keyof Leaderboards['batting']] ?? [], q, orgId)) },
    { id: 'pitching', title: cell('Pitching'), sections: PITCHING.map((c) => section('pitching', c, board.pitching[c.key as keyof Leaderboards['pitching']] ?? [], q, orgId)) },
  ];
  const qualifier = factClaim(v, `Rate leaders need ${q.minPA}+ plate appearances or ${innings(q.minOuts)}+ innings`, {
    specialist: LEADERS,
    because: [
      { label: 'Hitters', value: `3.1 plate appearances for each game your club has played: ${q.games} games make ${q.minPA}.` },
      { label: 'Pitchers', value: `One inning for each game your club has played: ${q.games} games make ${innings(q.minOuts)}.` },
      { label: 'Which leaders', value: 'Batting average, on-base plus slugging, earned run average and walks and hits per inning count qualified players only; home runs, runs batted in, stolen bases, strikeouts, wins, saves and wins above replacement count everyone.' },
    ],
    unknown: q.gamesFromExport ? [] : ['Your club\'s games played aren\'t in the export, so the page counts 20.'],
    how: 'policy',
    stamp: 'The league\'s qualifying rule: stated, not fitted',
  });
  const any = groups.some((g) => g.sections.some((s) => s.table.rows.length > 0));
  return {
    ...leadersHead(v, input),
    season: input.season !== null ? cell(String(input.season), { hint: 'The season the league\'s own data is in' }) : null,
    qualifier,
    groups,
    empty: any ? null : cell('No lines in this league this season yet.'),
  };
}
