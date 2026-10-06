/**
 * Scouting's views for the Mac app (SWIFTUI_REBUILD.md section 9, N12 Track B; D-072): the Draft Board and Player
 * Search, each one payload under `/api/v2/views/:org/scouting/<view>`. Ratings are read only through
 * `scoutedEvidence.ts` (D-002, D-017, D-067) and carry the OSA mark where OSA's view fills in for our scouts; the board
 * is the staff's view in a stated order, never an order to draft (D-001). The draft class is shown only once OOTP
 * publishes it; before then one plain sentence says so.
 */
import type { Cell, Claim } from '../../contract/presentation.js';
import type { MlbBlock, MlbViewHead } from '../majorLeague/types.js';
import type { OfficeChoiceGroup, OfficeTable } from '../league/types.js';

// ── Draft Board ─────────────────────────────────────────────────────────────

/** One filter's choice: its words and the board rows it keeps, in the board's order (the app shows those). */
export interface ScoutingFilterChoice {
  text: Cell;
  rows: string[];
}

/** A filter of the board (where they play, where they come from): its choices, the first keeping every row. */
export interface ScoutingFilter {
  id: string;
  title: Cell;
  choices: ScoutingFilterChoice[];
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
  filters: ScoutingFilter[];
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

/** What a search asks: the words typed and the tokens chosen, sent back exactly as served. */
export interface ScoutingSearchQuery {
  q: string;
  tokens: string[];
}

export interface ScoutingPlayerSearchView extends MlbViewHead {
  query: ScoutingSearchQuery;
  /** Every token on offer, by kind, in the order the field suggests them. */
  kinds: ScoutingTokenKind[];
  /** The tokens in effect, as served (a token sent that the server does not know is left out, and said in `count`). */
  chosen: ScoutingSearchToken[];
  /** Batters or pitchers: the season lines the table shows. */
  group: OfficeChoiceGroup;
  /** How many match and how many are shown ("312 match, the 300 with the most playing time shown"). */
  count: Cell;
  results: OfficeTable;
  empty: Cell | null;
}
