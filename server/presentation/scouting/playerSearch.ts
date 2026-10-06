/**
 * Scouting's Player Search (N12 Track B, D-072): every player still in the game, found by name and narrowed by tokens,
 * worded from `computePlayers` (the React page's `/api/players`) for the rows shown. Pure: it words what the reader
 * (`scoutingViews.ts`) hands it and reads nothing (D-056). No grade appears here, as none does on the React page: the
 * lines are this season's, objective facts from the export.
 *
 * The tokens are this module's words and the route's parameters each sets (`SEARCH_TOKENS`), so the reader and the
 * words cannot drift apart. Tokens of one kind replace each other (`playerSearchAskFrom` keeps the latest).
 */
import type { Cell } from '../../contract/presentation.js';
import type { PlayersPage } from '../../league.js';
import { cell } from '../claim.js';
import { ageCell, head, hintIf, plural, player, statCell, statSort, type ClubhouseContext } from '../clubhouse/common.js';
import { column } from '../league/common.js';
import { keysServed } from '../league/office.js';
import type { OfficeRow } from '../league/types.js';
import { block, line, tableRow } from '../majorLeague/common.js';
import { BATTING_STATS, PITCHING_STATS, type StatDef } from '../statCatalog.js';
import type { ScoutingPlayerSearchView, ScoutingSearchToken, ScoutingTokenKind } from './types.js';

const SEARCH = 'The scouting staff\'s player search';

/** How many matches a page of the search shows (the route's own page); the next page is a click away. */
export const SEARCH_CAP = 300;

/** The React page's default season lines (`src/stats.ts`); the rest are served hidden. */
const DEFAULT_BATTING = ['pa', 'avg', 'obp', 'slg', 'ops', 'opsPlus', 'wrcPlus', 'hr', 'rbi', 'sb', 'war'];
const DEFAULT_PITCHING = ['g', 'gs', 'w', 'l', 'sv', 'ip', 'era', 'eraPlus', 'fip', 'whip', 'k9', 'war'];

export type SearchGroup = 'batting' | 'pitching';

/** A token on offer: its id, its kind, its words, and the route's parameters it sets (`orgId: 'ours'` is our organization). */
export interface TokenDef {
  id: string;
  kind: string;
  text: string;
  /** Batters, pitchers or both. */
  group: SearchGroup | null;
  query: Record<string, string>;
}

/** The kinds the field offers, in order, with their titles. The batters-or-pitchers choice is `group`, not a kind. */
export const TOKEN_KINDS: Array<{ id: string; title: string }> = [
  { id: 'position', title: 'Position' },
  { id: 'level', title: 'Level' },
  { id: 'club', title: 'Club' },
  { id: 'scope', title: 'Scope' },
  { id: 'age', title: 'Age' },
  { id: 'bats', title: 'Bats' },
  { id: 'throws', title: 'Throws' },
  { id: 'pt', title: 'Playing time' },
];

/** Every token but the clubs' (those are the league's, from the reader). */
export const SEARCH_TOKENS: TokenDef[] = [
  ...([
    ['C', 'Catcher (C)', 2], ['1B', 'First base (1B)', 3], ['2B', 'Second base (2B)', 4], ['3B', 'Third base (3B)', 5],
    ['SS', 'Shortstop (SS)', 6], ['LF', 'Left field (LF)', 7], ['CF', 'Center field (CF)', 8], ['RF', 'Right field (RF)', 9],
    ['DH', 'Designated hitter (DH)', 10],
  ] as const).map(([id, text, n]): TokenDef => ({ id: `position:${id}`, kind: 'position', text, group: 'batting', query: { position: String(n) } })),
  ...([['SP', 'Starting pitcher (SP)', 11], ['RP', 'Relief pitcher (RP)', 12], ['CL', 'Closer (CL)', 13]] as const)
    .map(([id, text, n]): TokenDef => ({ id: `position:${id}`, kind: 'position', text, group: 'pitching', query: { role: String(n) } })),
  ...([['1', 'Major leagues (MLB)'], ['2', 'Triple-A (AAA)'], ['3', 'Double-A (AA)'], ['4', 'Single-A (A)'], ['6', 'Rookie ball']] as const)
    .map(([n, text]): TokenDef => ({ id: `level:${n}`, kind: 'level', text, group: null, query: { level: n } })),
  { id: 'scope:org', kind: 'scope', text: 'Our organization', group: null, query: { orgId: 'ours' } },
  { id: 'scope:fa', kind: 'scope', text: 'Free agents', group: null, query: { freeAgents: '1' } },
  { id: 'age:-21', kind: 'age', text: 'Age 21 and under', group: null, query: { maxAge: '21' } },
  { id: 'age:22-25', kind: 'age', text: 'Age 22 to 25', group: null, query: { minAge: '22', maxAge: '25' } },
  { id: 'age:26-29', kind: 'age', text: 'Age 26 to 29', group: null, query: { minAge: '26', maxAge: '29' } },
  { id: 'age:30-33', kind: 'age', text: 'Age 30 to 33', group: null, query: { minAge: '30', maxAge: '33' } },
  { id: 'age:34-', kind: 'age', text: 'Age 34 and over', group: null, query: { minAge: '34' } },
  // A switch hitter answers to both sides (the route's rule); "Switch-hitter" keeps only them
  { id: 'bats:R', kind: 'bats', text: 'Bats right', group: null, query: { bats: '1' } },
  { id: 'bats:L', kind: 'bats', text: 'Bats left', group: null, query: { bats: '2' } },
  { id: 'bats:S', kind: 'bats', text: 'Switch-hitter', group: null, query: { bats: '3' } },
  { id: 'throws:R', kind: 'throws', text: 'Throws right', group: null, query: { throws: '1' } },
  { id: 'throws:L', kind: 'throws', text: 'Throws left', group: null, query: { throws: '2' } },
  ...([50, 200, 400] as const).map((n): TokenDef => ({ id: `pt:pa${n}`, kind: 'pt', text: `${n}+ plate appearances`, group: 'batting', query: { minPt: String(n) } })),
  ...([20, 60, 120] as const).map((n): TokenDef => ({ id: `pt:ip${n}`, kind: 'pt', text: `${n}+ innings`, group: 'pitching', query: { minPt: String(n * 3) } })),
];

/** A club's token. */
export const clubToken = (teamId: number, label: string): TokenDef =>
  ({ id: `club:${teamId}`, kind: 'club', text: label, group: null, query: { orgId: String(teamId) } });

export interface PlayerSearchInput {
  q: string;
  /** The tokens as asked (sent back exactly as served). */
  asked: string[];
  /** The column the matches are sorted by and which way; null: the most playing time first. */
  sort: { column: string; dir: 'asc' | 'desc' } | null;
  /** Where this page starts. */
  offset: number;
  group: SearchGroup;
  /** Every token on offer for this group, clubs included, in the field's order. */
  offered: TokenDef[];
  /** The tokens in effect. */
  chosen: TokenDef[];
  /** Tokens asked that were set aside: not known, or not fitting the others (a club for free agents). */
  setAside: string[];
  /** The words were too short to search by (under two letters). */
  shortWords: boolean;
  /** The route's page for the ask (its first `SEARCH_CAP`), or the sentence it was refused with. */
  page: PlayersPage | string;
}

const statsOf = (group: SearchGroup): StatDef[] => (group === 'pitching' ? PITCHING_STATS : BATTING_STATS);

/** The columns that sort and the route's sort each asks for (`computePlayers`): the rest, hands, don't sort. */
const PLAIN_SORTS: Readonly<Record<string, string>> = { player: 'name', age: 'age', position: 'pos', club: 'team' };

/** The route's sort for a served column's id, or null when the column doesn't sort (or isn't one of this group's). */
export function searchSortOf(column: string, group: SearchGroup): string | null {
  if (PLAIN_SORTS[column]) return PLAIN_SORTS[column];
  const stat = column.startsWith('stat.') ? column.slice(5) : null;
  return stat !== null && statsOf(group).some((d) => d.key === stat) ? stat : null;
}

function searchHead(v: ClubhouseContext) {
  return head(v, 'Player Search', {
    text: 'Every player in the game: search by name, narrow with tokens',
    full: `Players still in the game, found by name (each word you type begins a word of his name; case and accents set aside) and narrowed by the tokens chosen. The list is ordered by playing time this season, most first, ${SEARCH_CAP} at a time; click a column to sort every match by it, not just the ones shown. A player's season line is this season's, at the level he played most; "No line" means he hasn't played this season, and "Not known" a part his line doesn't carry.`,
    specialist: SEARCH,
  });
}

function groupOf(group: SearchGroup) {
  return {
    id: 'group',
    title: cell('Show'),
    choices: (['batting', 'pitching'] as const).map((g) => ({ text: cell(g === 'batting' ? 'Batters' : 'Pitchers'), selected: g === group, value: `group:${g}` })),
  };
}

function kindsOf(offered: TokenDef[]): ScoutingTokenKind[] {
  return TOKEN_KINDS.map((k) => ({
    id: k.id,
    title: cell(k.title),
    tokens: offered.filter((t) => t.kind === k.id).map((t): ScoutingSearchToken => ({ id: t.id, kind: t.kind, text: cell(t.text) })),
  })).filter((k) => k.tokens.length > 0);
}

const tokenOf = (t: TokenDef): ScoutingSearchToken => ({ id: t.id, kind: t.kind, text: cell(t.text) });

function columnsOf(group: SearchGroup) {
  const shown = new Set(group === 'pitching' ? DEFAULT_PITCHING : DEFAULT_BATTING);
  return [
    column('player', 'Player'),
    column('age', 'Age', true),
    column('position', 'Pos'),
    column('bt', 'B/T', false, { hint: 'Bats / throws', sortable: false }),
    column('club', 'Club', false, { hint: 'His level and club' }),
    ...statsOf(group).map((d) => ({ ...column(`stat.${d.key}`, d.label, true, hintIf(d.desc) ? { hint: hintIf(d.desc) } : {}), ...(shown.has(d.key) ? {} : { hidden: true }) })),
  ];
}

type PagePlayer = PlayersPage['players'][number];

function resultRow(v: ClubhouseContext, p: PagePlayer, group: SearchGroup): OfficeRow {
  const orgId = v.ctx.build.orgId;
  const playerId = Number(p.player_id);
  const name = p.name.trim() || 'Unnamed player';
  const ours = p.inYourOrg === true;
  const team = p.team === null || p.team === undefined ? null : String(p.team);
  const freeAgent = team === 'Free Agent';
  const clubText = freeAgent ? 'Free agent' : team === null ? null : [p.levelName, team].filter(Boolean).join(' · ');
  const stats = (p.stats ?? null) as Record<string, number | null> | null;
  const cells: Record<string, Cell> = {
    player: cell(name),
    age: ageCell(typeof p.age === 'number' ? p.age : null),
    position: p.positionName === '?' ? cell('Not known', { tone: 'unknown', hint: 'His position isn\'t in the export' }) : cell(p.positionName),
    bt: cell(`${p.bats}/${p.throws}`),
    club: clubText === null
      ? cell('Not known', { tone: 'unknown', hint: 'His club isn\'t in the export' })
      : cell(clubText, ours ? { hint: 'Your organization' } : {}),
  };
  const sort: Record<string, number | string | null> = {
    player: name, age: typeof p.age === 'number' ? p.age : null, position: p.positionName === '?' ? null : p.positionName,
    bt: `${p.bats}/${p.throws}`, club: clubText,
  };
  for (const d of statsOf(group)) {
    const value = stats?.[d.key] ?? null;
    // Why is said once, in the head: on every season column of every such row it would be most of the payload
    cells[`stat.${d.key}`] = stats === null
      ? cell('No line', { tone: 'unknown' })
      : statCell(d, typeof value === 'number' ? value : null, stats, 'Not known');
    // "Not known" is explained once, in the head, rather than on every such cell of every row
    const shown = cells[`stat.${d.key}`];
    if (shown.display === 'Not known') cells[`stat.${d.key}`] = cell('Not known', { tone: 'unknown' });
    sort[`stat.${d.key}`] = statSort(typeof value === 'number' ? value : null);
  }
  const level = (p.stats as Record<string, unknown> | null)?.statsLevel;
  const lines = [
    // His organization only where it isn't the club already named (an affiliate's player)
    ...(p.organization !== null && p.organization !== undefined && !freeAgent && String(p.organization) !== team
      ? [line(`Organization: ${String(p.organization)}${ours ? ' (yours)' : ''}`, { quiet: true })] : []),
    ...(typeof level === 'string' ? [line(`Line at ${level}, his busiest level`, { quiet: true })] : []),
    ...(p.stints?.length
      ? [line(`Clubs this season: ${p.stints.map((s) => `${s.team} (${s.level}) ${group === 'pitching' ? `${s.ip} innings` : `${s.pa} plate appearances`}`).join(', ')}`, { quiet: true })]
      : []),
  ];
  // Served with no sort keys: the server sorts every match (`searchSortOf`), and the app shows the rows as served
  const row = keysServed(tableRow(`player-${playerId}`, cells, sort, { player: player(playerId, name, ours ? orgId : null), detail: lines.length ? [block('His season', lines)] : [] }), [], true);
  return ours ? { ...row, ours: true } : row;
}

/** The search's payload when it couldn't be read: the head, the ask as given and the sentence. */
export function playerSearchUnreadView(
  v: ClubhouseContext,
  ask: { q: string; tokens: string[]; sort: string | null; dir: 'asc' | 'desc'; offset: number },
  group: SearchGroup,
  why: string,
): ScoutingPlayerSearchView {
  const sentence = why.endsWith('.') ? why : `${why}.`;
  return {
    ...searchHead(v),
    query: { q: ask.q, tokens: [...ask.tokens], sort: ask.sort, dir: ask.dir, offset: ask.offset },
    kinds: [],
    chosen: [],
    group: groupOf(group),
    count: cell(sentence),
    results: { columns: columnsOf(group), rows: [], empty: cell(sentence), serverSorts: true },
    more: null,
    empty: cell(sentence),
  };
}

/** How the matches are ordered, in words ("most playing time first", "by OPS, highest first"). */
function orderWords(sort: PlayerSearchInput['sort'], group: SearchGroup): string {
  if (sort === null) return 'most playing time first';
  const asc = sort.dir === 'asc';
  const named: Record<string, string> = { player: 'name', age: 'age', position: 'position', club: 'club' };
  const title = named[sort.column] ?? columnsOf(group).find((c) => c.id === sort.column)?.title.display ?? sort.column;
  const way = sort.column === 'age' ? (asc ? 'youngest first' : 'oldest first')
    : ['player', 'position', 'club'].includes(sort.column) ? (asc ? 'A to Z' : 'Z to A')
      : asc ? 'lowest first' : 'highest first';
  return `by ${title}, ${way}`;
}

export function playerSearchView(v: ClubhouseContext, input: PlayerSearchInput): ScoutingPlayerSearchView {
  const ask = { q: input.q, tokens: input.asked, sort: input.sort?.column ?? null, dir: input.sort?.dir ?? 'desc' as const, offset: input.offset };
  const who = input.group === 'pitching' ? 'pitchers' : 'batters';
  if (typeof input.page === 'string') {
    const why = /no data imported/i.test(input.page) ? 'No league is imported yet' : `The search couldn't be read: ${input.page}`;
    return { ...playerSearchUnreadView(v, ask, input.group, why), kinds: kindsOf(input.offered), chosen: input.chosen.map(tokenOf) };
  }
  const page = input.page;
  const rows = page.players.map((p) => resultRow(v, p, input.group));
  const total = page.total;
  const notes: string[] = [];
  if (input.shortWords) notes.push('Type two letters or more to search by name');
  if (input.setAside.length) notes.push(`${plural(input.setAside.length, 'token')} set aside: not one this search knows, or not fitting the others`);
  const from = page.offset + 1;
  const to = page.offset + rows.length;
  const counted = total === 0
    ? `No ${who} match`
    : total > rows.length || page.offset > 0
      ? rows.length === 0
        ? `${total.toLocaleString('en-US')} ${who} match; none past ${page.offset.toLocaleString('en-US')}`
        : `${total.toLocaleString('en-US')} ${who} match; ${from.toLocaleString('en-US')} to ${to.toLocaleString('en-US')} shown, ${orderWords(input.sort, input.group)}`
      : `${plural(total, input.group === 'pitching' ? 'pitcher' : 'batter')} ${total === 1 ? 'matches' : 'match'}`;
  const left = total - to;
  const more = rows.length > 0 && left > 0
    ? { text: cell(`Show the next ${Math.min(SEARCH_CAP, left).toLocaleString('en-US')}`, { hint: `${left.toLocaleString('en-US')} more match` }), id: 'offset', value: String(to) }
    : null;
  const countText = [counted, ...notes].join(' · ');
  const searched = input.q.trim().length >= 2;
  const emptyText = searched
    ? `No ${who} match "${input.q.trim()}"${input.chosen.length ? ' with those tokens' : ''}.`
    : `No ${who} match those tokens.`;
  return {
    ...searchHead(v),
    query: { q: ask.q, tokens: [...ask.tokens], sort: ask.sort, dir: ask.dir, offset: ask.offset },
    kinds: kindsOf(input.offered),
    chosen: input.chosen.map(tokenOf),
    group: groupOf(input.group),
    count: cell(countText, hintIf(notes.join('. ')) ? { hint: hintIf(notes.join('. ')) } : {}),
    results: {
      columns: columnsOf(input.group),
      rows,
      empty: cell(emptyText, searched ? { hint: `Batters and pitchers are searched apart: try ${input.group === 'pitching' ? 'Batters' : 'Pitchers'}` } : {}),
      serverSorts: true,
    },
    more,
    empty: null,
  };
}
