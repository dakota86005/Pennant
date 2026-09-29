/**
 * Following in words (D-058, N7 Stage A): the clubs and players the GM follows in this save, the division rivals
 * Pennant suggests (with why, never followed by themselves), and what became of his watchlist (copied, with its notes;
 * the watchlist itself is left in place for the Electron app).
 *
 * Following changes no figure, place or severity anywhere (case 20): it orders the wire and the search, and nothing else.
 * Pure: the service hands in what is followed and what the league says about each; nothing here reads a table.
 */
import { cell, target } from '../claim.js';
import { plural } from './desk.js';
import type { FollowedItem, FollowSuggestion, Following } from './leagueTypes.js';

/** A follow as remembered, with its time in words. */
export interface FollowInput {
  kind: 'club' | 'player';
  id: number;
  /** The name recorded when it was followed. */
  name: string | null;
  note: string | null;
  source: 'gm' | 'watchlist';
  createdText: string | null;
}

/** A club as the league has it now. */
export interface ClubNow {
  teamId: number;
  name: string;
  abbr: string | null;
  division: string | null;
}

/** A player as the league has him now: his club and level, and where he plays. */
export interface PlayerNow {
  playerId: number;
  name: string;
  position: string | null;
  club: string | null;
  level: string | null;
}

export interface WatchlistNote {
  /** Rows copied from the watchlist into Following in this save, ever. */
  copied: number;
  /** Rows left on the watchlist because the player isn't this league's under that name. */
  notInLeague: number;
}

function clubItem(f: FollowInput, now: ClubNow | undefined): FollowedItem {
  return {
    kind: 'club',
    id: f.id,
    name: now?.name ?? f.name ?? `Club ${f.id}`,
    line: now
      ? cell([now.abbr, now.division].filter(Boolean).join(' · ') || now.name)
      : cell('Not in this league now', { tone: 'unknown', hint: 'The club isn\'t in the latest export' }),
    note: f.note,
    since: sinceWords(f),
    open: target({ kind: 'club', teamId: f.id }),
  };
}

function playerItem(f: FollowInput, now: PlayerNow | undefined): FollowedItem {
  return {
    kind: 'player',
    id: f.id,
    name: now?.name ?? f.name ?? `Player ${f.id}`,
    line: now
      ? cell([now.position, now.club ?? 'No club', now.level].filter(Boolean).join(' · '))
      : cell('Not in this league now', { tone: 'unknown', hint: 'He isn\'t in the latest export' }),
    note: f.note,
    since: sinceWords(f),
    open: target({ kind: 'player', playerId: f.id }),
  };
}

function sinceWords(f: FollowInput) {
  if (f.source === 'watchlist') return cell('Copied from your watchlist', { hint: 'Your watchlist is kept as it was, for the older app' });
  return cell(f.createdText ? `Following since ${f.createdText}` : 'Following');
}

/** Following, as the app shows it. `suggested` are the division rivals not followed yet. */
export function followingWords(
  follows: readonly FollowInput[],
  clubs: ReadonlyMap<number, ClubNow>,
  players: ReadonlyMap<number, PlayerNow>,
  suggested: readonly ClubNow[],
  watchlist: WatchlistNote,
  stamp: string,
): Following {
  const clubItems = follows.filter((f) => f.kind === 'club').map((f) => clubItem(f, clubs.get(f.id)));
  const playerItems = follows.filter((f) => f.kind === 'player').map((f) => playerItem(f, players.get(f.id)));
  const suggestions: FollowSuggestion[] = suggested.map((c) => ({
    kind: 'club', id: c.teamId, name: c.name, why: cell(c.division ? `In your division, the ${c.division}` : 'In your division'),
  }));
  const watch = watchlist.copied || watchlist.notInLeague
    ? cell(
      watchlist.copied ? `${plural(watchlist.copied, 'player')} from your watchlist, with your notes` : 'Nobody from your watchlist is in this league',
      watchlist.notInLeague ? { hint: `${plural(watchlist.notInLeague, 'watchlist player')} not in this league, so not followed` } : {},
    )
    : null;
  return {
    title: cell('Following'),
    clubs: clubItems,
    players: playerItems,
    empty: clubItems.length || playerItems.length ? null : cell('Nothing followed yet', { hint: 'Follow a club or a player to see them first on the wire' }),
    suggestions,
    watchlist: watch,
    followStamp: stamp,
  };
}
