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
import type { GameDate } from '../../dataFreshness.js';
import type { ClubProfile, RosterMap, TeamSeason } from './morningTypes.js';
import type { WireTop } from './leagueTypes.js';

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
  /**
   * The view that opens the item in full (N8: a Major League Ops need opens its decision, `kind: 'decision'` with the
   * need's id as `key`); null when the item opens nothing beyond its basis and trail.
   */
  open: Target | null;
  /** How many of the department's own items this row stands for: 1, or more when the grouping rule put several in one row. */
  count: Integer;
  /**
   * What the GM has done with it (N7, D-058): open, reviewed, deferred until a game date, or handled in OOTP. It records
   * his attention only: it never changes the item's severity, its place in its department's order or its counts (case 15).
   */
  attention: DeskAttention;
}

/** What the GM did with an item on the desk. `open` is every item he has not marked. */
export type DeskStatus = 'open' | 'reviewed' | 'deferred' | 'handled';

/** An item's status on the desk, in words (N7, D-058). */
export interface DeskAttention {
  status: DeskStatus;
  /** "Open", "Reviewed", "Deferred until May 20", "Handled in OOTP", with when it was set in its help tag. */
  line: Cell;
  /** The game date a deferral runs to, as sent; null unless deferred. */
  until: GameDate | null;
  /** Whether a deferral's date has come (the item is back on the lead list); false otherwise. */
  deferralEnded: boolean;
  /** The GM's own note on the item, as he wrote it; null when he wrote none. */
  note: string | null;
  /** Marked handled in OOTP while the latest export still shows it: said, never read as resolved; null otherwise. */
  stillShown: Cell | null;
  /** When the status was set (ISO 8601); null for an item never marked. */
  since: string | null;
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

/** What changed since the last export in one department (N7): an item new, resolved, or at another urgency. */
export interface ReportChange {
  kind: 'new' | 'resolved' | 'moved';
  /** The kind in a word ("New", "Resolved", "Moved"), drawn beside the line: the kind is never a symbol alone. */
  word: string;
  line: Claim;
}

/** One entry behind a "since the last export" chip: an item that is new, resolved or moved, or a game played. */
export interface ChangeItem {
  /** The item's key (a game's is `game:<id>`). */
  key: string;
  /** The department that raised it; null for a game. */
  department: DeptId | null;
  line: Claim;
  /** Where it opens: the item's department report, or the schedule for a game; null when nowhere. */
  open: Target | null;
}

/** One chip of "since the last export": how many, its words, and what it opens (the design's `ChipRow`). */
export interface ChangeChip {
  kind: 'new' | 'resolved' | 'moved' | 'results';
  count: Integer;
  /** "3 new", "2 resolved", "1 moved", "4–2 since May 1". */
  text: string;
  /** What the chip counts, in one line. */
  hint: string;
  items: ChangeItem[];
}

/**
 * What changed since the last export of this save (N7, D-058): the departments' items that are new, resolved or at
 * another urgency, and the games played between the two exports. It says what changed, never which transaction did it
 * (D-020, case 16).
 */
export interface SinceLastExport {
  new: ChangeChip;
  resolved: ChangeChip;
  moved: ChangeChip;
  results: ChangeChip;
  /** "Since the export of May 1, 2040", with when that import was read in its help tag. */
  since: Cell;
  /** The earlier import compared with (its finish time), and the league's day it reflected. */
  previousImport: string;
  previousGameDate: GameDate | null;
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
  /** The build it comes from: moves whenever the server builds the Front Office again (a new import, a settings change, a calibration). */
  reportStamp: string;
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
  /**
   * What changed in this department since the last export of this save (N7); null when there is no earlier export to
   * compare with (`changesNote` says so), never an empty list read as "nothing changed".
   */
  changes: ReportChange[] | null;
  /** Why there is nothing to compare with, or that nothing changed; null when `changes` has lines. */
  changesNote: Cell | null;
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
  /** The first things it is watching (at most three): the desk already shows what it has to decide. */
  top: FoItem[];
  /** How many items it has to decide and to watch; null when it could not be read or has no report yet. */
  toDecide: Integer | null;
  watching: Integer | null;
  /** Opens the department's report; null when it has none yet. */
  open: Target | null;
  memo: StaffMemo | null;
}

/** A department's items to decide beyond the desk's stated share, and where they are. */
export interface DeskMore {
  department: DeptId;
  /** "And 3 more in Farm & Development". */
  line: Cell;
  count: Integer;
  /** Its report. */
  open: Target;
}

/** The desk: the items to decide from every department (a stated share of each), in a stated order. */
export interface Desk {
  title: Cell;
  /** How the desk is ordered and what it shows, in words, with the full rule in its help tag. */
  order: Cell;
  items: FoItem[];
  /** Each department with more to decide than the desk shows, and how many more. */
  more: DeskMore[];
  /** "Nothing to decide from the departments reporting" when every department was read and none raised anything; null otherwise. */
  empty: Cell | null;
  /** Which departments could not be read, so the desk may be missing items; null when every one was. */
  incomplete: Cell | null;
  /**
   * The items the GM set aside (N7): reviewed, handled in OOTP, or deferred to a day still ahead. They leave the lead
   * list and stay one click away, with a served count ("2 reviewed · 1 handled in OOTP"); null when none is.
   */
  setAside: DeskSetAside | null;
  /**
   * How many items to decide are open: the ones the desk shows and each department's "more", never the ones set aside
   * (N7, Stage B: the Mac app's dock badge counts nothing itself). A floor when `incomplete` names a department that
   * couldn't be read.
   */
  openCount: Integer;
  /**
   * The days an item can be deferred to, each a game date after the league's day with its words ("A week · May 13,
   * 2040"), soonest first (N7, Stage B: the Mac app's Defer menu, which never works out a date itself); empty when the
   * league's day isn't known, so nothing can be deferred from a menu.
   */
  deferChoices: DeferChoice[];
}

/** One day the GM can defer an item to (`DeskUpdate.until`), in words. */
export interface DeferChoice {
  /** The game date, written as OOTP writes dates (unpadded), after the league's day. */
  until: GameDate;
  /** "A week · May 13, 2040", with what it does in its help tag. */
  text: Cell;
}

/** The desk's set-aside items and their count, in words. */
export interface DeskSetAside {
  /** "2 reviewed · 1 handled in OOTP". */
  line: Cell;
  reviewed: Integer;
  deferred: Integer;
  handled: Integer;
  items: FoItem[];
}

/** The desk on its own (`GET /api/v2/desk/:org`): the same desk the Morning Report shows, with every status. */
export interface DeskView {
  orgId: Integer;
  importStamp: string | null;
  reportStamp: string;
  /** Moves whenever a status or a note changes, so a client knows its copy is current. */
  deskStamp: string;
  desk: Desk;
}

/**
 * A change to one item's status (`PUT /api/v2/desk/:org`). `status` is required; `until` (a game date after the league's
 * day) only with `deferred`; `note` left out keeps the note as it is, and an empty note clears it.
 */
export interface DeskUpdate {
  key: string;
  status: DeskStatus;
  /**
   * The day a deferral runs to, after the league's day. Left out (or the day recorded) on a deferred item, the change is
   * to the note only and keeps the recorded day, even one the league has passed.
   */
  until?: GameDate | null;
  note?: string;
  /**
   * An undo (every served `DeskChange.undo` carries it): the record is put back exactly as it was, its day, note and when
   * it was set, with no check of the day against the league's.
   */
  restore?: boolean;
}

/** The answer to a status change: the item as it is now, the request that undoes it, and the desk. */
export interface DeskChange {
  key: string;
  /** "Marked reviewed", "Deferred until May 20", "Back on your desk", in words. */
  done: Cell;
  attention: DeskAttention;
  /** The status (and note) it replaced. */
  previous: DeskAttention;
  /** The request that puts it back in one step (the Mac app's Undo). */
  undo: DeskUpdate;
  /**
   * The desk with the change on it; null while the club's Front Office is being built again (a new copy of the live log,
   * a refit): the change is recorded all the same, checked against what this export's desk last served, and the
   * `desk-changed` event that follows says to read the desk again. A change never builds the Front Office itself.
   */
  view: DeskView | null;
}

/** The Morning Report's desk and department cards (`GET /api/v2/front-office/:org`). */
export interface FrontOfficeSummary {
  orgId: Integer;
  /** The club's name, or null when the export does not have it. */
  club: string | null;
  /** The import it was built from; the Mac app's stores key on the same stamp. */
  importStamp: string | null;
  /** The build it comes from (`DepartmentReport.reportStamp`); `/api/status` and the `front-office-updated` event serve the current one. */
  reportStamp: string;
  asOf: Cell;
  desk: Desk;
  departments: DepartmentCard[];
  /**
   * The masthead's box score (N6): the record, the division place, the run differential, the last five, the next game and
   * the trade deadline, objective facts only (D-060). Null only where the Morning Report's parts were not built.
   */
  teamSeason: TeamSeason | null;
  /** One or two sentences built only from facts on the page (D-060); null when there is too little to say. */
  lede: Claim | null;
  /** "How we win and lose": each dimension's stated place among the league's clubs (D-057). */
  clubProfile: ClubProfile | null;
  /** The roster map: each position's holder, his value, his place, who is behind him, control, needs; the staff beside it. */
  rosterMap: RosterMap | null;
  /**
   * Since the last export of this save (N7): new, resolved and moved items, and the results; null when there is no
   * earlier export to compare with (`changesNote` says so in a sentence), never an empty list read as "nothing changed".
   */
  changes: SinceLastExport | null;
  /** Why there is nothing to compare with yet; null when `changes` is served. */
  changesNote: Cell | null;
  /** Around the league: the top wire entries since the last export, followed clubs first (N7, D-059); null when not built. */
  wire: WireTop | null;
  /** Moves whenever a desk status, a note or a follow changes (the summary's attention, not its build). */
  deskStamp: string;
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
  reportStamp: string;
  title: Cell;
  headline: Claim;
  sections: TrailSection[];
}
