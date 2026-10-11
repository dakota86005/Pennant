/**
 * Pennant at a glance (N14, Stage A, D-075): what the Mac app shows outside its windows (the desktop widget and the
 * menu bar extra): the record, the next game, and how many items wait on the desk with the first few. Every part is the
 * Morning Report's own, as served (`FrontOfficeSummary`): this module only picks the parts and words the desk's count,
 * so the app writes no sentence and counts nothing (D-056). Objective facts only (D-060): no odds, posture or window.
 *
 * Pure: `glanceService.ts` hands in the summary and the departments' names.
 */
import type { Integer } from '../../contract/primitives.js';
import type { Cell, Claim, DeptId, Target } from '../../contract/presentation.js';
import { cell, target } from '../claim.js';
import type { FrontOfficeSummary } from './types.js';

/** How many desk items a glance lists: the widget's medium size and the menu bar extra show three (a stated line). */
export const GLANCE_DESK_ITEMS = 3;

/** The next game, as the masthead's Tonight card says it. */
export interface GlanceGame {
  /** "Tonight · 7:05 PM", "May 18 · 7:05 PM". */
  when: Cell;
  /** "vs Colorado Rockies". */
  matchup: Cell;
  /** The game with its basis (the date, the time, the starters' source). */
  claim: Claim;
  /** Where the game opens (the schedule and game plans). */
  open: Target;
}

/** One item on the desk, as the desk lists it. */
export interface GlanceItem {
  key: string;
  /** What it is, in one line, with the department's evidence as its basis. */
  headline: Claim;
  /** The department that raised it ("Major League Ops"). */
  department: Cell;
  /** The view that opens it in full; null when it opens nothing beyond its basis. */
  open: Target | null;
}

/** The desk at a glance. */
export interface GlanceDesk {
  /** The open items to decide, as the Dock's badge counts them (`Desk.openCount`); a floor when the desk is incomplete. */
  count: Integer;
  /** "3 to decide", "Nothing to decide", "At least 3 to decide", with the desk's order rule in its help tag. */
  line: Cell;
  /** The desk's first items in its own order, at most `GLANCE_DESK_ITEMS`. */
  top: GlanceItem[];
}

/** Pennant at a glance (`GET /api/v2/glance/:org`). */
export interface Glance {
  orgId: Integer;
  importStamp: string | null;
  reportStamp: string;
  /** Moves whenever a desk status changes, as the summary's does. */
  deskStamp: string;
  /** The club's name; null when the export does not have it. */
  club: Cell | null;
  /** How current it is (the Morning Report's own line). */
  asOf: Cell;
  /** "Won 26, lost 17", its `value.display` the figure ("26–17"); null when the standings lack it (`missing` says why). */
  record: Claim | null;
  /** The next game; null when none is scheduled or known (`missing` says why). */
  nextGame: GlanceGame | null;
  /** Why the record or the next game is not shown, one sentence each, as the masthead says it. */
  missing: Cell[];
  desk: GlanceDesk;
  /** The Morning Report, where the whole of it opens. */
  open: Target;
}

/** The desk's count in words: a floor when a department could not be read. */
function deskLine(count: number, incomplete: boolean, order: Cell): Cell {
  const hint = order.hint ?? order.display;
  if (count === 0) return cell(incomplete ? 'Nothing to decide from the departments read' : 'Nothing to decide', { hint });
  return cell(`${incomplete ? 'At least ' : ''}${count} to decide`, { hint });
}

/** The glance from the club's summary; `departmentName` gives a department's served name. */
export function glanceWords(summary: FrontOfficeSummary, departmentName: (id: DeptId) => string): Glance {
  const season = summary.teamSeason;
  const tonight = season?.tonight ?? null;
  const missing = (season?.missing ?? []).filter((m) => m.part === 'record' || m.part === 'tonight').map((m) => m.line);
  const desk = summary.desk;
  return {
    orgId: summary.orgId,
    importStamp: summary.importStamp,
    reportStamp: summary.reportStamp,
    deskStamp: summary.deskStamp,
    club: season?.kicker.club ?? (summary.club ? cell(summary.club) : null),
    asOf: summary.asOf,
    record: season?.record ?? null,
    nextGame: tonight ? { when: tonight.when, matchup: tonight.matchup, claim: tonight.claim, open: tonight.open } : null,
    missing,
    desk: {
      count: desk.openCount,
      line: deskLine(desk.openCount, desk.incomplete !== null, desk.order),
      top: desk.items.slice(0, GLANCE_DESK_ITEMS).map((item) => ({
        key: item.key,
        headline: item.headline,
        department: cell(departmentName(item.department)),
        open: item.open,
      })),
    },
    open: target({ kind: 'view', department: 'frontOffice', view: 'morningReport' }),
  };
}
