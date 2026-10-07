/**
 * Scouting's views for the Mac app (SWIFTUI_REBUILD.md section 9, N12 Track B; D-072): the Draft Board and Player
 * Search, each one payload under `/api/v2/views/:org/scouting/<view>`. Ratings are read only through
 * `scoutedEvidence.ts` (D-002, D-017, D-067) and carry the OSA mark where OSA's view fills in for our scouts; the board
 * is the staff's view in a stated order, never an order to draft (D-001). The draft class is shown only once OOTP
 * publishes it; before then one plain sentence says so.
 */
import type { Cell, Claim } from '../../contract/presentation.js';
import type { Integer } from '../../contract/primitives.js';
import type { MlbBlock, MlbViewHead } from '../majorLeague/types.js';
import type { OfficeChoiceGroup, OfficeTable } from '../league/types.js';

// ── Draft Board ─────────────────────────────────────────────────────────────

/** What the board was asked for: a position group and a school by key (`all`: every one), and whether every prospect. */
export interface ScoutingBoardQuery {
  position: string;
  school: string;
  all: boolean;
}

/**
 * A prospect's reasons for the staff's read, read when he is chosen (`GET …/scouting/draftBoard/prospects/:player`): his
 * board row's detail, which the board itself doesn't carry.
 */
export interface ScoutingProspectView {
  orgId: Integer;
  importStamp: string | null;
  reportStamp: string;
  playerId: Integer;
  /** His board row's id. */
  row: string;
  detail: MlbBlock[];
}

export interface ScoutingDraftBoardView extends MlbViewHead {
  /** Whether OOTP has published this year's class (its own switch); the board is empty until it has. */
  published: boolean;
  /** The one sentence when there is no class to show (no draft in this league, or not published yet); null when shown. */
  notShown: Cell | null;
  /** The draft's calendar (class published, combine, draft day) as a short table; null when the league runs no draft. */
  calendar: OfficeTable | null;
  /** How many are eligible, the draft day and its rounds, with who the class is read from in its basis. */
  summary: Claim | null;
  /** Who is not on the board and why, in a line (already drafted, another league's draft, no scouted ceiling). */
  leftOut: Cell | null;
  /** The staff's short lists: the best available on the board, and the best at the organization's thinnest spots. */
  shortLists: MlbBlock[];
  /** Where they play and where they come from, by key, the asked choice selected (sent back as `?position=`, `?school=`). */
  filters: OfficeChoiceGroup[];
  query: ScoutingBoardQuery;
  /** How many the board shows of how many ("The top 300 of 2,076 on the board"); null before there is a board. */
  count: Cell | null;
  /** "Show all 2,076" (`all=1`) while only the top of the board is served; null otherwise. */
  more: ScoutingMore | null;
  /** The board's rows in the staff's order, without their reasons (read when a prospect is chosen). */
  board: OfficeTable;
  empty: Cell | null;
}

// ── Player Search ───────────────────────────────────────────────────────────

/**
 * A search token on offer (a position, a level, a club, an age band, a hand, free agents, batters or pitchers): its id
 * (sent back in `tokens`), its kind (the tokens of one kind replace each other) and its words.
 */
export interface ScoutingSearchToken {
  id: string;
  kind: string;
  text: Cell;
}

/** A kind of token, as the search field offers them (Position, Level, Club, Age, Bats, Throws). */
export interface ScoutingTokenKind {
  id: string;
  title: Cell;
  tokens: ScoutingSearchToken[];
}

/**
 * What a search asks: the words typed and the tokens chosen, sent back exactly as served; the column it is sorted by (a
 * served column's id, null: the most playing time first) and which way, and where its page starts.
 */
export interface ScoutingSearchQuery {
  q: string;
  tokens: string[];
  sort: string | null;
  dir: 'asc' | 'desc';
  offset: Integer;
}

/** What asks for more of a list: its words ("Show the next 300") and the query parameter it sets (`offset=300`, `all=1`). */
export interface ScoutingMore {
  text: Cell;
  /** The query parameter it is sent as. */
  id: string;
  value: string;
}

export interface ScoutingPlayerSearchView extends MlbViewHead {
  query: ScoutingSearchQuery;
  /** Every token on offer, by kind, in the order the field suggests them. */
  kinds: ScoutingTokenKind[];
  /** The tokens in effect, as served (a token sent that the server does not know is left out, and said in `count`). */
  chosen: ScoutingSearchToken[];
  /** Batters or pitchers: the season lines the table shows. */
  group: OfficeChoiceGroup;
  /** How many match and how many are shown ("2,412 batters match; 1 to 300 shown, most playing time first"). */
  count: Cell;
  /**
   * This page of the results, in the served order: sorted on the server over every match (a column's sort is asked for,
   * never applied to the page alone), so the app shows the rows as served, page after page.
   */
  results: OfficeTable;
  /** The next page; null when this is the last. */
  more: ScoutingMore | null;
  empty: Cell | null;
}
