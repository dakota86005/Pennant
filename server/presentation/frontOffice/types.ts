/**
 * The Front Office contract (V2 plan section 4.4; SWIFTUI_REBUILD.md sections 3.4, 3.5 and 4.2): the GM's desk, each
 * department's card and each department's report, and the evidence trail an item opens on demand.
 *
 * Everything here is what a department already said, gathered and put in the GM's words: an item carries its
 * department's own severity (normalized onto the desk's scale by `severity.ts`, never raised) with the philosophy-free
 * severity beside it, a headline `Claim` with its basis, and who raised it. Nothing is ranked by a hidden score: the
 * desk's order is stated (`FrontOfficeSummary.desk.order`).
 */
import type { Cell, Claim, DeptId, Target } from '../../contract/presentation.js';
import type { Integer } from '../../contract/primitives.js';
import type { DepartmentHead } from '../catalog.js';
import type { DeskSeverity } from '../severity.js';

export type { DeskSeverity } from '../severity.js';

/** One thing a department raised for the GM. */
export interface FoItem {
  /**
   * The item's key within an import: its department, its kind and its subject (`majorLeague:need:mlb:il_return_crunch:412`).
   * The same problem keeps the same key from one build to the next of the same import.
   */
  key: string;
  department: DeptId;
  /** Who raised it: the department's head as the save names him ("Raised by Jeff Banister, bench coach"), or its staff. */
  raisedBy: Cell;
  /** The department's own severity on the desk's scale, with its philosophy and season weighed (never above what it said). */
  severity: DeskSeverity;
  /**
   * What the department states with no philosophy and no season to weigh: the plain reading, and what the desk goes by
   * (whether it is to decide or to watch, and its order; D-060). The same as `severity` when nothing shaded it.
   */
  neutralSeverity: DeskSeverity;
  /** The plain severity in words ("Urgent", "Needs attention", "Noted"), with the line that placed it and any lean in its basis. */
  urgency: Claim;
  /** What it is, in one line, with the department's evidence as its basis. */
  headline: Claim;
  /** A second line when there is one (who is out, where he plays); null when the headline says it all. */
  detail: Cell | null;
  /** The days left on a running clock ("3 days left"), or null when nothing is counting down. */
  due: Cell | null;
  /** The same, as a number for ordering; null when there is no clock or its days are not exported. */
  dueInDays: Integer | null;
  /** The key of the evidence trail `GET /api/v2/claims/:key` serves for it; null when it has none beyond its basis. */
  evidence: string | null;
}

/** A department's report is ready, could not be read this time, or has nothing to report yet. */
export type ReportStatus = 'ready' | 'unavailable' | 'notYet';

/** "To decide" or "Watching": a titled list of items, and what it says when it is empty. */
export interface ReportSection {
  title: Cell;
  items: FoItem[];
  /** The line shown when there are no items ("Nothing to decide"); null when there are items or nothing could be read. */
  empty: Cell | null;
}

/** "What we can't see": the department's unknowns, as short sentences. */
export interface ReportUnknowns {
  title: Cell;
  lines: Cell[];
}

/** What changed since the last export (N7 fills it). */
export interface ReportChange {
  kind: 'new' | 'resolved' | 'moved';
  line: Claim;
}

/** A staff member's memo (the later AI pass fills it; never part of a decision, D-001). */
export interface StaffMemo {
  by: Cell;
  lines: Cell[];
}

/** A department's report, one anatomy for all (SWIFTUI_REBUILD.md section 3.5). */
export interface DepartmentReport {
  department: DeptId;
  name: string;
  status: ReportStatus;
  /** The import the report was built from (the last import's finish time), or null when the server has none on record. */
  importStamp: string | null;
  /** "Prepared by Jeff Banister, bench coach", or its staff when the save names nobody. */
  preparedBy: Cell;
  head: DepartmentHead | null;
  /** "Through May 16, 2040": the game date the evidence reflects, or why it is not known. */
  asOf: Cell;
  /** One sentence assembled from its items. */
  summary: Claim;
  /** Key figures (three to five). */
  figures: Claim[];
  toDecide: ReportSection;
  watching: ReportSection;
  /** What changed since the last export; null until Pennant keeps each import's reports (N7), never an empty list. */
  changes: ReportChange[] | null;
  unknowns: ReportUnknowns;
  /** The staff memo; null until the AI pass writes one. */
  memo: StaffMemo | null;
}

/** A department's compact card on the Morning Report. */
export interface DepartmentCard {
  department: DeptId;
  name: string;
  status: ReportStatus;
  preparedBy: Cell;
  summary: Claim;
  /** Two or three key figures. */
  figures: Claim[];
  /** The first items it would put in front of the GM (at most three), most urgent first. */
  top: FoItem[];
  /** How many items it has to decide and to watch; null when it could not be read or has no report yet. */
  toDecide: Integer | null;
  watching: Integer | null;
  /** Opens the department's report. */
  open: Target;
  memo: StaffMemo | null;
}

/** The desk: every item to decide, from every department, in a stated order. */
export interface Desk {
  title: Cell;
  /** How the desk is ordered, in words, with the full rule in its help tag. */
  order: Cell;
  items: FoItem[];
  /** "Nothing to decide" when every department was read and none raised anything; null otherwise. */
  empty: Cell | null;
  /** Which departments could not be read, so the desk may be missing items; null when every one was. */
  incomplete: Cell | null;
}

/** The Morning Report's desk and department cards (`GET /api/v2/front-office/:org`). */
export interface FrontOfficeSummary {
  orgId: Integer;
  /** The club's name, or null when the export does not have it. */
  club: string | null;
  /** The import it was built from; the Mac app's stores key on the same stamp. */
  importStamp: string | null;
  asOf: Cell;
  desk: Desk;
  departments: DepartmentCard[];
}

/** One titled part of an evidence trail. */
export interface TrailSection {
  title: Cell;
  claims: Claim[];
  /** What the section says when it has no claims; null when it has some. */
  empty: Cell | null;
}

/**
 * The evidence trail behind an item, fetched on demand (`GET /api/v2/claims/:key`): too slow to put in a summary (an MLB
 * need's staff recommendation takes seconds on a real save), so the inspector asks for it when the GM opens the item.
 */
export interface ClaimTrail {
  key: string;
  importStamp: string | null;
  title: Cell;
  headline: Claim;
  sections: TrailSection[];
}
