/**
 * Around the League (D-059, N7 Stage A): the league wire, a club report for any club, Following and search, as the Mac
 * app draws them (SWIFTUI_REBUILD.md sections 3.4 item 7, 3.5 League Office, 3.6 "Search" and "Following").
 *
 * Every visible line is a served `Claim` or `Cell`. A wire entry from OOTP's transaction log says what the log says; one
 * from a snapshot difference says the state changed and names no transaction (D-020). The wire's order is stated and
 * has no hidden score (case 18). Another club's players are read through our organization's scouting (D-017, case 19).
 */
import type { Cell, Claim, Target } from '../../contract/presentation.js';
import type { Integer } from '../../contract/primitives.js';
import type { GameDate } from '../../dataFreshness.js';
import type { ClubProfile, RosterMap, TeamSeason } from './morningTypes.js';

/** What a wire entry is about. */
export type WireKind = 'move' | 'trade' | 'injury' | 'streak' | 'award' | 'standings';

/**
 * Where a wire entry was read: OOTP's live transaction log, the export's trades, injuries, streaks or awards, the
 * standings Pennant kept at each import, or a difference between two of Pennant's roster snapshots (where the log could
 * not be read).
 */
export type WireSource = 'log' | 'trades' | 'injuries' | 'streaks' | 'awards' | 'standings' | 'snapshots';

/** A club named by a wire entry. */
export interface WireClub {
  teamId: Integer;
  name: string;
  abbreviation: string | null;
  /** The GM follows it. */
  followed: boolean;
}

/** A player named by a wire entry. */
export interface WirePlayer {
  playerId: Integer;
  name: string;
  followed: boolean;
}

/** One thing that happened around the league. */
export interface WireEntry {
  /** Stable for the same event across builds: its source and the source's own id. */
  id: string;
  /** The day it happened, as OOTP wrote it; null when the source gives no day. */
  date: GameDate | null;
  /** "May 3", or "Day not known". */
  when: Cell;
  kind: WireKind;
  clubs: WireClub[];
  players: WirePlayer[];
  /** The line, in the source's own words where it has them, with its basis. */
  headline: Claim;
  source: WireSource;
  /** Whether it names a club or a player the GM follows. */
  followed: boolean;
}

/** The wire's stated order and what it holds, in words. */
export interface WireOrder {
  /** "Followed first, then newest" or "Newest first", with the whole rule in its help tag. */
  line: Cell;
  /** Whether followed clubs and players come first in this answer. */
  followedFirst: boolean;
}

/** The Morning Report's column: the top entries since the last export, followed clubs first (the design's `WireRow`). */
export interface WireTop {
  title: Cell;
  order: WireOrder;
  entries: WireEntry[];
  /** "12 more since May 1" when there are more, opening the wire; null otherwise. */
  more: Cell | null;
  /** The sources the export or the save could not give, each in a sentence (never an empty league). */
  gaps: Cell[];
  /** "Nothing around the league since May 1" when nothing was read; null otherwise. */
  empty: Cell | null;
  /** The whole wire (League Office). */
  open: Target;
}

/** The whole wire (`GET /api/v2/wire/:org`), filtered as asked. */
export interface Wire {
  orgId: Integer;
  importStamp: string | null;
  title: Cell;
  /** What the entries are since: "Since the export of May 1, 2040", "Since May 1, 2040", or "This season". */
  since: Cell;
  /** The day asked for (or the last export's), as OOTP writes a date; null for the whole season. */
  sinceDate: GameDate | null;
  order: WireOrder;
  entries: WireEntry[];
  /** How many entries matched before the list was cut to its length. */
  total: Integer;
  /** "Showing the newest 200 of 340" when cut; null otherwise. */
  more: Cell | null;
  gaps: Cell[];
  empty: Cell | null;
  /** The kinds and clubs the filters can offer, in words. */
  kinds: WireKindChoice[];
}

/** A kind the wire can be filtered to, with its name and how many entries it has in this answer's window. */
export interface WireKindChoice {
  kind: WireKind;
  name: string;
  count: Integer;
}

/** One line of a club's injured list in its report. */
export interface ClubInjury {
  playerId: Integer;
  line: Claim;
}

/**
 * Another club's report (`GET /api/v2/club/:teamId`): the same masthead, "How they win and lose" and roster map as ours
 * (the same modules, D-059), under our organization's scouting, with their recent moves, their injuries, their record
 * against us and their next series with us. Nothing ranks the club or reads it as a buyer or a seller (D-060).
 */
export interface ClubReport {
  teamId: Integer;
  club: string;
  abbreviation: string | null;
  importStamp: string | null;
  /** The build it comes from; moves with every rebuild. */
  reportStamp: string;
  asOf: Cell;
  /** The GM follows the club. */
  followed: boolean;
  /** This is the club the app follows (its own report is the Morning Report). */
  ours: boolean;
  teamSeason: TeamSeason | null;
  lede: Claim | null;
  clubProfile: ClubProfile | null;
  rosterMap: RosterMap | null;
  /** Whose eyes the ratings are and how much of the club our scouts see, with what they can't see as its basis. */
  scouting: Claim;
  /** Their record against us this season; null for our own club. */
  headToHead: Claim | null;
  /** Their next series with us; null for our own club, or when none is scheduled (`nextSeriesNote` says so). */
  nextSeries: Claim | null;
  nextSeriesNote: Cell | null;
  /** Their recent moves: the wire filtered to the club, newest first. */
  moves: WireEntry[];
  movesNote: Cell | null;
  injuries: ClubInjury[];
  injuriesNote: Cell | null;
  /** Open the wire filtered to the club. */
  openWire: Target;
}

/** A club or player to follow, as Following shows it. */
export interface FollowedItem {
  kind: 'club' | 'player';
  id: Integer;
  /** The club's or the player's name, as the league has it now (as recorded when the league no longer has it). */
  name: string;
  /** "Padres · SD", or the player's club and position; "Not in this league now" when gone. */
  line: Cell;
  /** The GM's own note, as he wrote it; null when none. */
  note: string | null;
  /** "Copied from your watchlist", or when he began following, in words. */
  since: Cell;
  open: Target;
}

/** A club Pennant suggests following, with why; never followed until the GM says so. */
export interface FollowSuggestion {
  kind: 'club';
  id: Integer;
  name: string;
  why: Cell;
}

/** Following (`GET /api/v2/following`): what the GM follows in this save, and the clubs suggested. */
export interface Following {
  title: Cell;
  clubs: FollowedItem[];
  players: FollowedItem[];
  /** "Nothing followed yet" when nothing is; null otherwise. */
  empty: Cell | null;
  suggestions: FollowSuggestion[];
  /** What happened to the watchlist: copied, with its notes, and what was left because it is another save's. */
  watchlist: Cell | null;
  /** Moves whenever a follow or a note changes. */
  followStamp: string;
}

/** A follow to add, or a note to change (`PUT /api/v2/following`); `note` left out keeps it, an empty note clears it. */
export interface FollowUpdate {
  kind: 'club' | 'player';
  id: Integer;
  note?: string;
  /**
   * Set on an unfollow's undo: the follow is put back as it was (its note, how it began and when), not begun again. The
   * server remembers the follows it just removed; one it no longer remembers (after a relaunch) is followed again.
   */
  restore?: boolean;
}

/** How to undo a follow or an unfollow in one step: follow again (`PUT`, with the note it had) or unfollow (`DELETE`). */
export interface FollowUndo {
  action: 'follow' | 'unfollow';
  request: FollowUpdate;
}

/** The answer to a follow or an unfollow: what was done, the request that undoes it, and Following. */
export interface FollowChange {
  /** "Following the Padres", "No longer following Mookie Betts". */
  done: Cell;
  following: boolean;
  undo: FollowUndo;
  view: Following;
}

/** What a search result is. */
export type SearchKind = 'player' | 'club' | 'view';

/** One search result (`CommandPalette`): its group, its line, and where it opens. */
export interface SearchResult {
  kind: SearchKind;
  /** The result's id within its kind: a player or team id, or a view's `department/view`. */
  id: string;
  title: string;
  /** "SS · Padres · Triple-A", "NL West", "Major League Ops". */
  line: string;
  followed: boolean;
  open: Target;
}

/** A group of results under its name ("Players", "Clubs", "Views"). */
export interface SearchGroup {
  kind: SearchKind;
  title: Cell;
  results: SearchResult[];
  /** How many matched before the group was cut; more than shown when cut. */
  total: Integer;
}

/** The answer to a search (`GET /api/v2/search?q=`). */
export interface SearchAnswer {
  query: string;
  groups: SearchGroup[];
  /** The stated order: "Followed first, then the closest match", with the rule in its help tag. */
  order: Cell;
  /** "No players, clubs or views match" when nothing does, or what to type when the query is empty; null otherwise. */
  empty: Cell | null;
  /** The import the index was built from. */
  importStamp: string | null;
}
