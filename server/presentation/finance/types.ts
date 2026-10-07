/**
 * Finance's views for the Mac app (N12, D-071): each one payload under `/api/v2/views/:org/finance/<view>`, built from
 * what Payroll, Contracts, Free Agents (through Player Value, Player Rights and Club Finances) and the farm's next men
 * already answered. Every visible string is a `Cell`, or a `Claim` where the line has a basis worth opening; the long
 * explanations the React pages put in hovers are in those bases. Nothing here is a verdict, a rank or a single score.
 */
import type { Cell, Claim } from '../../contract/presentation.js';
import type { Integer } from '../../contract/primitives.js';
import type { MlbPlayer } from '../majorLeague/types.js';
import type { OfficeFact, OfficeFilterGroup, OfficeTable, OfficeViewHead } from '../officeTable.js';

/** Contracts: the club's finance figures, the price of a win, the groups, and every contract as a table. */
export interface FinanceContractsView extends OfficeViewHead {
  /** "Contracts after 2040". */
  heading: Cell;
  /** Budget, payroll and room now and next season, cash for trades; empty when Club Finances couldn't be read. */
  cards: Claim[];
  /** "A win costs about $7.25M on this league's market"; null when no price is in force. */
  price: Claim | null;
  /** The groups (free agents after this season, options, arbitration, ...) and all players or pitchers. */
  filters: OfficeFilterGroup[];
  table: OfficeTable;
}

/** One of Free Agents' three lists: who it lists, its filters and its table. */
export interface FinanceFreeAgentList {
  /** `available`, `upcoming` or `mightReach`. */
  id: string;
  title: Cell;
  count: Integer;
  /** Who it lists and how the table reads, in its basis. */
  explain: Claim;
  /** A line above the table (why the might-reach players are there); null when none. */
  note: Cell | null;
  /** The served order in words, while the GM hasn't sorted a column; null with no rows. */
  order: Cell | null;
  filters: OfficeFilterGroup[];
  table: OfficeTable;
}

/**
 * One free agent's detail, served when the GM chooses his row (the lists carry none of it, so they stay small): his
 * facts and the claims beneath the table, each with its basis.
 */
export interface FinanceFreeAgentDetail {
  playerId: Integer;
  facts: OfficeFact[];
  claims: Claim[];
}

/** Free Agents: the club's figures, the price of a win, its thinnest positions, and the three lists. */
export interface FinanceFreeAgentsView extends OfficeViewHead {
  cards: Claim[];
  price: Claim | null;
  /** "Your thinnest positions: …", with how it is read in its basis; null when nothing is thin or unknown. */
  needs: Claim | null;
  lists: FinanceFreeAgentList[];
  /** The list the view opens on (as the React page chose it). */
  opensOn: string;
}

/** What the controlled seasons no contract covers could cost, beside a season's committed money (never in it). */
export interface FinanceProjected {
  low: number;
  high: number;
  /** The sum of the most likely costs; a range where a season could go more than one way; null when none. */
  likelyLow: number | null;
  likelyHigh: number | null;
}

/** One season of committed money (Payroll's), with what it is read against and what could come on top. */
export interface FinancePayrollSeason {
  season: Integer;
  /** Guaranteed salary, in dollars. */
  committed: number;
  projected: FinanceProjected | null;
  /** The budget this season is read against (today's, or the one the GM expects for later seasons); null when unknown. */
  budget: number | null;
  /** "2041: $85.2M committed", with everything about the season in its basis. */
  claim: Claim;
  committedCell: Cell;
  /** "26 players · +$9.0M in 1 club option, not counted". */
  playersCell: Cell;
  /** "Most likely +$12.5M · could be $9.1M to $16.8M (8 players)"; null when nothing is projected. */
  projectedCell: Cell | null;
  /** "$14.2M free", or "Room not known". */
  roomCell: Cell;
}

/** A budget line: its amount and its words. */
export interface FinanceBudgetLine {
  amount: number | null;
  label: Cell;
}

/** The budget the GM expects next season, as the view offers to set it (in millions, as the React page took it). */
export interface FinanceBudgetEntry {
  /** The amount entered, in dollars; null when none (today's budget then holds flat). */
  amount: number | null;
  /** Today's budget in millions, the field's placeholder; null when the export has none. */
  placeholder: number | null;
  label: Cell;
  help: Cell;
}

/** A titled table of Payroll's (leaving, staying, not known yet), with what it means. */
export interface FinancePayrollSection {
  id: string;
  title: Cell;
  explain: Claim;
  table: OfficeTable;
}

/** Payroll & Budget. */
export interface FinancePayrollView extends OfficeViewHead {
  cards: Claim[];
  price: Claim | null;
  priceHistory: Claim | null;
  /** What a season the club controls costs (a renewal, an arbitration year); null when the league couldn't be read. */
  costs: Claim | null;
  seasons: FinancePayrollSeason[];
  /** Today's budget, the chart's rule. */
  budget: FinanceBudgetLine;
  /** The budget the GM expects next season, a second rule for the later seasons; null when none is entered. */
  expectedBudget: FinanceBudgetLine | null;
  /** The chart in one sentence, for VoiceOver's chart description. */
  chartSummary: Cell;
  nextSeasonBudget: FinanceBudgetEntry;
  /** Every player at the same end of his range, season by season; null when nothing is projected. */
  edges: Claim | null;
  sections: FinancePayrollSection[];
  deadMoney: Claim;
  /** Every contract, season by season. */
  contracts: OfficeTable;
}

/** What the GM sends to set the budget he expects next season: an amount in dollars, zero to clear it. */
export interface FinanceBudgetUpdate {
  amount: number;
}

/** What setting the budget the GM expects next season answers: the amount kept, what it did, and how to put it back. */
export interface FinanceBudgetChange {
  /** The amount kept, in dollars; null when cleared (today's budget then holds flat). */
  nextSeasonBudget: number | null;
  /** What it did, in a sentence ("Next season's budget set to $210M; was $200M"). */
  done: Cell;
  /** The request that puts back what was there before (⌘Z): the amount before, or zero when there was none. */
  undo: FinanceBudgetUpdate;
}

/** A player in a Horizon Board cell: who, and how the club controls him that season (the full reason in `why`). */
export interface FinanceHorizonEntry {
  player: MlbPlayer;
  status: Cell;
  why: Claim;
}

/** One position in one season: who the club controls there and how; its sentence when nobody. */
export interface FinanceHorizonCell {
  season: Integer;
  entries: FinanceHorizonEntry[];
  empty: Cell | null;
  /** Players listed there whose control that season couldn't be read. */
  unread: Integer;
  /** "Not known for N more" beside the entries, when some are unread; null when none are, or the cell has no entries (then `empty` says it). */
  unreadNote: Cell | null;
}

/** The farm's next man at a position: never placed in a season. */
export interface FinanceHorizonProspect {
  player: MlbPlayer;
  level: Cell;
  /** Player Development's readiness against its bar, in words. */
  readiness: Cell;
  /** OSA's view filling in for our scouts on the grades his readiness rests on (D-067); absent otherwise. */
  ratingsFill?: Cell;
}

/** One row of the board: a position, its seasons, and its pipeline. */
export interface FinanceHorizonRow {
  id: string;
  position: Cell;
  cells: FinanceHorizonCell[];
  pipeline: FinanceHorizonProspect[];
  /** "Nobody at this position in the farm"; null when the row has no pipeline (pitchers) or has men in it. */
  pipelineEmpty: Cell | null;
}

/** Committed money in one season, against the budget it is read against. */
export interface FinanceHorizonMoney {
  season: Integer;
  committed: number;
  budget: number | null;
  claim: Claim;
}

/** The Horizon Board. */
export interface FinanceHorizonView extends OfficeViewHead {
  seasons: Integer[];
  seasonTitles: Cell[];
  rows: FinanceHorizonRow[];
  pipelineTitle: Cell;
  payroll: FinanceHorizonMoney[];
  budget: FinanceBudgetLine | null;
  /** Why the payroll strip is missing, when it is. */
  payrollNote: Cell | null;
  chartSummary: Cell;
  unknowns: Cell[];
}

