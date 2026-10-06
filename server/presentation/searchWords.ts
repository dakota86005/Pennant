/**
 * Search in words (N7 Stage A): the entries that match a query, grouped (players, clubs, views) and ordered by a stated
 * rule with no hidden score: what the GM follows first, then names that start with what was typed, then (players) our
 * organization's, then by name. Following changes only the order (case 20).
 *
 * Pure: `search.ts` hands in the index and the query.
 */
import type { SearchEntry, SearchQuery } from '../search.js';
import { cell, target } from './claim.js';
import { LEVEL_WORDS } from './frontOffice/morning.js';
import type { SearchAnswer, SearchGroup, SearchKind, SearchResult } from './frontOffice/leagueTypes.js';

/** How many results each group shows (stated lines). */
export const SEARCH_LIMITS: Readonly<Record<SearchKind, number>> = { player: 20, club: 10, view: 10 };

export const SEARCH_ORDER_RULE = 'Followed first, then names starting with what you typed, then ours';

/** Names in English order, case and accents set aside (one collator: `localeCompare` with options builds one per call). */
const BY_NAME = new Intl.Collator('en', { sensitivity: 'base' });

const GROUP_TITLES: Record<SearchKind, string> = { player: 'Players', club: 'Clubs', view: 'Views' };

const levelWord = (level: number | null | undefined): string | null => (level === 1 ? 'Majors' : level ? LEVEL_WORDS[level] ?? null : null);

function resultOf(e: SearchEntry, followed: boolean): SearchResult {
  switch (e.kind) {
    case 'player':
      return {
        kind: 'player', id: e.id, title: e.name,
        line: [e.position, e.clubName ?? 'Free agent', levelWord(e.level)].filter(Boolean).join(' · '),
        // His organization's club with him, so the Mac app can open the nearest view (its window) until player windows
        followed, open: target({ kind: 'player', playerId: e.playerId!, ...(e.orgId ? { teamId: e.orgId } : {}) }),
      };
    case 'club':
      return {
        kind: 'club', id: e.id, title: e.name, line: [e.abbr, e.division].filter(Boolean).join(' · ') || 'Club',
        followed, open: target({ kind: 'club', teamId: e.teamId! }),
      };
    default:
      return {
        kind: 'view', id: e.id, title: e.name, line: e.departmentName ?? '', followed: false,
        open: target({ kind: 'view', department: e.department!, view: e.view! }),
      };
  }
}

/** The last player result: every player matched, in Scouting's Player Search, opened on the words typed. */
function playerSearchResult(query: string, total: number): SearchResult {
  return {
    kind: 'view',
    id: 'scouting.playerSearch',
    title: total === 1 ? 'Open in Player Search' : `All ${total} in Player Search`,
    line: 'Scouting',
    followed: false,
    open: target({ kind: 'view', department: 'scouting', view: 'playerSearch', key: query.trim().slice(0, 200) }),
  };
}

export interface SearchContext {
  followedClubs: ReadonlySet<number>;
  followedPlayers: ReadonlySet<number>;
  ourOrgId: number | null;
  importStamp: string | null;
}

/** The answer to a query, from the entries that matched it. */
export function searchWords(query: string, q: SearchQuery, matched: readonly SearchEntry[], ctx: SearchContext): SearchAnswer {
  const isFollowed = (e: SearchEntry) => (e.kind === 'club' && ctx.followedClubs.has(e.teamId!)) || (e.kind === 'player' && ctx.followedPlayers.has(e.playerId!));
  const groups: SearchGroup[] = (['player', 'club', 'view'] as const).map((kind) => {
    // The stated order's keys, worked out once per entry (a one-letter query can match thousands of players)
    const all = matched.filter((e) => e.kind === kind)
      .map((e) => ({
        e, followed: isFollowed(e), starts: e.folded.startsWith(q.folded), ours: ctx.ourOrgId !== null && e.orgId === ctx.ourOrgId,
      }))
      .sort((a, b) =>
        Number(b.followed) - Number(a.followed)
        || Number(b.starts) - Number(a.starts)
        || Number(b.ours) - Number(a.ours)
        || BY_NAME.compare(a.e.name, b.e.name)
        || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0));
    const results = all.slice(0, SEARCH_LIMITS[kind]).map((x) => resultOf(x.e, x.followed));
    // N12 Track B: the players matched lead on to Player Search, which reads the same matches with its tokens and lines
    if (kind === 'player' && all.length > 0) results.push(playerSearchResult(query, all.length));
    return { kind, title: cell(GROUP_TITLES[kind]), results, total: all.length };
  }).filter((g) => g.total > 0);
  return {
    query,
    groups,
    order: cell('Followed first', { hint: SEARCH_ORDER_RULE }),
    empty: q.words.length === 0
      ? cell('Type a player, a club or a view')
      : groups.length === 0 ? cell('No players, clubs or views match') : null,
    importStamp: ctx.importStamp,
  };
}
