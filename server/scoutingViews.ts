/**
 * Scouting's Draft Board and Player Search (N12 Track B, D-072): the readers. Each reads what the React page's route
 * reads, through the route's extracted pieces, and hands plain data to the pure adapters in `presentation/scouting/`.
 *
 * - **Draft Board:** the class and the calendar are the route's own (`draftLeague`, `draftPool`, `draftClassMembers`,
 *   `draftExcluded`); the grades are read only through `scoutedEvidence.ts` (D-017, D-067): our scouts' 20-80
 *   composites, null unless every tool is graded, so a prospect with no full ceiling is left off and counted, never
 *   averaged from the tools seen (the React route still averages them; D-018). The staff's read is the route's `advise`.
 * - **Player Search:** the route's `computePlayers` for the rows shown (filtered in SQL, season lines worked out for the
 *   page only), its names matched with the ⌘K palette's own index and matcher (`search.ts`), never a second one.
 */
import { db, tableExists } from './db.js';
import { computePlayers } from './league.js';
import { positionNeeds } from './positionNeeds.js';
import type { OfficeContext } from './presentation/league/common.js';
import { draftBoardUnreadView, draftBoardView, type BoardProspect } from './presentation/scouting/draftBoard.js';
import {
  SEARCH_CAP, SEARCH_TOKENS, clubToken, playerSearchUnreadView, playerSearchView, searchSortOf, type SearchGroup, type TokenDef,
} from './presentation/scouting/playerSearch.js';
import type { ScoutingDraftBoardView, ScoutingPlayerSearchView } from './presentation/scouting/types.js';
import { adviseScouted, draftClassMembers, draftExcluded, draftLeague, draftPool } from './rosterops.js';
import { loadScoutedAbilities, ratingFillOf, type ToolKey } from './scoutedEvidence.js';
import { matches, queryOf, searchIndex } from './search.js';
import { loadSettings } from './settings.js';
import { ratingScaleMax } from './valuation.js';

/**
 * What a player search asks: the words typed, the token ids chosen (in a stable order), the column the GM sorted by (a
 * served column's id; null: the most playing time first) and its direction, and where the page starts (a multiple of
 * the page, `SEARCH_CAP`). The sort orders every match, not the page shown (the React page's whole-league sort).
 */
export interface PlayerSearchAsk {
  q: string;
  tokens: string[];
  sort: string | null;
  dir: 'asc' | 'desc';
  offset: number;
}

export const DEFAULT_SEARCH: PlayerSearchAsk = { q: '', tokens: [], sort: null, dir: 'desc', offset: 0 };

/** The furthest a page may start: past every player any save has (the route counts the rest). */
const MAX_OFFSET = 100_000;

/**
 * A search ask from a request's query (`q`, `tokens` comma-separated). Tokens of one kind (the part before the colon:
 * `position:SS`, `group:pitching`) replace each other: the latest sent of each kind is kept, then they are put in a
 * stable order, so one ask has one key.
 */
export function playerSearchAskFrom(query: Record<string, unknown>): PlayerSearchAsk {
  const text = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '');
  const q = text(query.q).trim().slice(0, 200);
  const latest = new Map<string, string>();
  for (const t of text(query.tokens).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 40)) {
    const kind = t.includes(':') ? t.slice(0, t.indexOf(':')) : t;
    latest.delete(kind);
    latest.set(kind, t);
  }
  const tokens = [...new Set(latest.values())].sort();
  const sortText = text(query.sort).trim();
  const sort = /^[A-Za-z][\w.]{0,40}$/.test(sortText) ? sortText : null;
  const dir = text(query.dir) === 'asc' ? 'asc' : 'desc';
  const asked = Number(text(query.offset));
  const offset = Number.isFinite(asked) && asked > 0 ? Math.min(MAX_OFFSET, Math.floor(asked / SEARCH_CAP) * SEARCH_CAP) : 0;
  return { q, tokens, sort, dir: sort === null ? 'desc' : dir, offset };
}

/** A search ask's key: its words (folded), its tokens, its sort and its page. */
export const playerSearchKey = (ask: PlayerSearchAsk): string =>
  `${ask.q.toLowerCase()}|${ask.tokens.join(',')}|${ask.sort ?? ''}:${ask.dir}|${ask.offset}`;

// ── Draft Board ─────────────────────────────────────────────────────────────

const POSITION_NAMES: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};
const HANDS: Record<number, string> = { 1: 'R', 2: 'L', 3: 'S' };
const TOOL_WORDS: Record<ToolKey, string> = {
  contact: 'contact', gap: 'gap power', power: 'power', eye: 'eye', avoidK: 'avoiding strikeouts',
  stuff: 'stuff', movement: 'movement', control: 'control',
};

export function draftBoardViewOf(v: OfficeContext, orgId: number): ScoutingDraftBoardView {
  const rating = { scaleMax: ratingScaleMax(), roundToFive: loadSettings().roundRatingsToFive === true };
  const empty = { poolRule: null, prospects: [], unrated: 0, excluded: { alreadyPicked: 0, otherDraft: 0 }, needs: [], needsBasis: '', rating };
  if (!tableExists('players')) return draftBoardView(v, { ...empty, league: 'No league is imported yet' });
  const league = draftLeague(orgId);
  if (!league) return draftBoardView(v, { ...empty, league: 'This club isn\'t in the export' });
  // Nothing is read from the players table until OOTP itself publishes the class (the route's rule)
  if (!league.hasDraft || !league.poolVisible) return draftBoardView(v, { ...empty, league });

  const pool = draftPool(league);
  const members = draftClassMembers(league, pool);
  const abilities = loadScoutedAbilities(members.map((m) => m.player_id));
  const needs = positionNeeds(orgId);
  const thin = new Set(needs.thinnest);
  const graded = members
    .map((m) => ({ m, a: abilities.for(m.player_id) }))
    .filter(({ a }) => a.potential !== null)
    // The staff's order, as the route's: the highest ceiling first, then the best now (one graded now before one not)
    .sort((x, y) => y.a.potential! - x.a.potential! || (y.a.current ?? -1) - (x.a.current ?? -1) || x.m.player_id - y.m.player_id);
  const prospects: BoardProspect[] = graded.map(({ m, a }) => {
    const positionName = POSITION_NAMES[m.position as number] ?? '?';
    const school = m.college === 1 ? 'College' : 'High school';
    const age = typeof m.age === 'number' && Number.isFinite(m.age) && m.age > 0 ? m.age : null;
    // Nothing unknown read as zero: a grade now not known gives a ceiling-only read that says so (D-018)
    const read = adviseScouted({
      // An age the export doesn't carry reads as neither young nor old for the class (never a stand-in age)
      age: age ?? Number.NaN,
      positionName,
      school: school === 'College' ? 'College' : 'HS',
      isPitcher: m.position === 1,
      cur: a.current,
      pot: a.potential,
      upside: a.current !== null && a.potential !== null ? a.potential - a.current : null,
    }, thin);
    return {
      playerId: m.player_id,
      name: (m.name ?? '').trim() || 'Unnamed player',
      age,
      positionName,
      bats: HANDS[m.bats as number] ?? '?',
      throws: HANDS[m.throws as number] ?? '?',
      school,
      current: a.current,
      ceiling: a.potential!,
      notGradedNow: a.current === null ? a.missing.current.map((k) => TOOL_WORDS[k]) : [],
      read,
      fill: ratingFillOf(m.player_id),
    };
  });
  return draftBoardView(v, {
    league,
    poolRule: pool.poolRule,
    prospects,
    unrated: members.length - prospects.length,
    excluded: draftExcluded(league, pool),
    needs: needs.positions.map((n) => ({ positionName: n.positionName, best: n.best ? { name: n.best.name, wins: n.best.wins } : null })),
    needsBasis: needs.basis,
    rating,
  });
}

export function draftBoardUnread(v: OfficeContext, why: string): ScoutingDraftBoardView {
  return draftBoardUnreadView(v, why);
}

// ── Player Search ───────────────────────────────────────────────────────────

/** The club's league's major league clubs, by name (the Club tokens). */
function leagueClubs(orgId: number): TokenDef[] {
  if (!tableExists('teams')) return [];
  const rows = db.prepare(`SELECT t.team_id, CASE WHEN t.nickname IS NULL OR t.nickname = '' OR t.name = t.nickname THEN t.name ELSE t.name || ' ' || t.nickname END AS label
    FROM teams t WHERE t.level = 1 AND COALESCE(t.allstar_team, 0) = 0
      AND t.league_id = (SELECT league_id FROM teams WHERE team_id = ?) ORDER BY label`).all(orgId) as Array<{ team_id: number; label: string }>;
  return rows.map((r) => clubToken(r.team_id, String(r.label ?? '').trim() || `Club ${r.team_id}`));
}

/** The players whose name every word of `q` begins a word of, from the palette's index (case and accents set aside). */
function nameMatches(q: string, importStamp: string | null): number[] | null {
  const query = queryOf(q);
  if (q.trim().length < 2 || query.words.length === 0) return null;
  const out: number[] = [];
  for (const e of searchIndex(importStamp).entries) {
    if (e.kind === 'player' && e.playerId !== undefined && matches(e, query.words)) out.push(e.playerId);
  }
  return out;
}

export function playerSearchViewOf(v: OfficeContext, orgId: number, ask: PlayerSearchAsk): ScoutingPlayerSearchView {
  const group: SearchGroup = ask.tokens.includes('group:pitching') ? 'pitching' : 'batting';
  const clubs = leagueClubs(orgId);
  // The field groups them by kind (`TOKEN_KINDS`), clubs by name
  const offered = [...SEARCH_TOKENS, ...clubs].filter((t) => t.group === null || t.group === group);
  const known = new Map([...SEARCH_TOKENS, ...clubs].map((t) => [t.id, t]));
  const setAside: string[] = [];
  let chosen: TokenDef[] = [];
  for (const id of ask.tokens) {
    if (id.startsWith('group:') && (id === 'group:batting' || id === 'group:pitching')) continue;
    const t = known.get(id);
    if (!t || (t.group !== null && t.group !== group)) setAside.push(id);
    else chosen.push(t);
  }
  // Free agents have no club or level; a club is narrower than our organization
  const has = (kind: string, id?: string) => chosen.some((t) => t.kind === kind && (id === undefined || t.id === id));
  const drop = (keep: (t: TokenDef) => boolean) => {
    for (const t of chosen.filter((x) => !keep(x))) setAside.push(t.id);
    chosen = chosen.filter(keep);
  };
  if (has('scope', 'scope:fa')) drop((t) => t.kind !== 'club' && t.kind !== 'level');
  if (has('club')) drop((t) => t.id !== 'scope:org');

  // The column sorted by, as the route sorts (every match, then the page cut): a served column's id to the route's own
  const routeSort = ask.sort === null ? null : searchSortOf(ask.sort, group);
  const query: Record<string, unknown> = {
    group, level: 'all', limit: String(SEARCH_CAP), offset: String(ask.offset), viewer: String(orgId),
    ...(routeSort ? { sort: routeSort, dir: ask.dir } : {}),
  };
  for (const t of chosen) for (const [k, value] of Object.entries(t.query)) query[k] = value === 'ours' ? String(orgId) : value;
  const ids = nameMatches(ask.q, v.ctx.build.importStamp);
  const computed = ids !== null && ids.length === 0
    ? null
    : computePlayers(query, ids === null ? undefined : { playerIds: ids });
  const page = computed === null
    ? { total: 0, offset: ask.offset, limit: SEARCH_CAP, sort: null, dir: 'desc' as const, players: [] }
    : computed.ok ? computed.body : computed.error;
  return playerSearchView(v, {
    q: ask.q,
    asked: ask.tokens,
    sort: routeSort ? { column: ask.sort!, dir: ask.dir } : null,
    offset: ask.offset,
    group,
    offered,
    chosen,
    setAside,
    shortWords: ask.q.trim().length > 0 && ids === null,
    page,
  });
}

export function playerSearchUnread(v: OfficeContext, ask: PlayerSearchAsk, why: string): ScoutingPlayerSearchView {
  return playerSearchUnreadView(v, ask, ask.tokens.includes('group:pitching') ? 'pitching' : 'batting', why);
}
