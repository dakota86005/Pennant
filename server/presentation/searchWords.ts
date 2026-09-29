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

const GROUP_TITLES: Record<SearchKind, string> = { player: 'Players', club: 'Clubs', view: 'Views' };

const levelWord = (level: number | null | undefined): string | null => (level === 1 ? 'Majors' : level ? LEVEL_WORDS[level] ?? null : null);

function resultOf(e: SearchEntry, followed: boolean): SearchResult {
  switch (e.kind) {
    case 'player':
      return {
        kind: 'player', id: e.id, title: e.name,
        line: [e.position, e.clubName ?? 'Free agent', levelWord(e.level)].filter(Boolean).join(' · '),
        followed, open: target({ kind: 'player', playerId: e.playerId! }),
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
    const all = matched.filter((e) => e.kind === kind)
      .map((e) => ({ e, followed: isFollowed(e) }))
      .sort((a, b) =>
        Number(b.followed) - Number(a.followed)
        || Number(b.e.folded.startsWith(q.folded)) - Number(a.e.folded.startsWith(q.folded))
        || Number(ctx.ourOrgId !== null && b.e.orgId === ctx.ourOrgId) - Number(ctx.ourOrgId !== null && a.e.orgId === ctx.ourOrgId)
        || a.e.name.localeCompare(b.e.name, 'en', { sensitivity: 'base' })
        || a.e.id.localeCompare(b.e.id));
    return { kind, title: cell(GROUP_TITLES[kind]), results: all.slice(0, SEARCH_LIMITS[kind]).map((x) => resultOf(x.e, x.followed)), total: all.length };
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
