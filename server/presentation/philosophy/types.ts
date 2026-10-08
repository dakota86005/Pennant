/**
 * Philosophy & Staff on the Mac (SWIFTUI_REBUILD.md section 9, N12 Track C; D-073): the Organizational Philosophy editor
 * (the club's identity summary, the comparable clubs, each preference and policy, and what a change did) and Coaching
 * Staff (the save's staff as exported).
 *
 * The authority chain (D-003, D-019, D-045): the philosophy only orders the choices the specialists already find
 * defensible, afterwards. Nothing here says a setting allows, forbids or changes whether a move is sound, and the identity
 * is read from the settings alone, never the club's record, odds or a posture (D-060). The server owns every word,
 * label and threshold of the identity; the app sends what the GM set and draws what is served.
 */
import type { Cell, Claim } from '../../contract/presentation.js';
import type { Integer } from '../../contract/primitives.js';
import type { MlbTable } from '../majorLeague/types.js';

/** What every Philosophy & Staff payload carries: its build, its title and who prepared it. */
export interface PhilosophyViewHead {
  orgId: Integer;
  importStamp: string | null;
  reportStamp: string;
  title: Cell;
  byline: Cell;
}

/** One preference: where it is set (0–100), what that reads as, and its two ends. */
export interface PhilosophyDimensionView {
  id: string;
  label: Cell;
  description: Cell;
  value: Integer;
  /** Where the value reads on the scale ("Leans — Maximize current wins", "Balanced"). */
  position: Cell;
  /** What the slider tells VoiceOver: what the preference means and where it reads now, one sentence each. */
  spoken: Cell;
  low: Cell;
  high: Cell;
  balanced: Cell;
}

/** A group of preferences ("Financial Strategy"), with its one line. */
export interface PhilosophyGroupView {
  id: string;
  title: Cell;
  description: Cell;
  dimensions: PhilosophyDimensionView[];
}

/** One choice a policy offers. */
export interface PhilosophyPolicyOption {
  value: string;
  label: Cell;
}

/** A policy: an explicit choice rather than a number. */
export interface PhilosophyPolicyView {
  id: string;
  label: Cell;
  description: Cell;
  selected: string;
  options: PhilosophyPolicyOption[];
}

/** A club from baseball history whose tendencies resemble these settings: an illustration, never a rating. */
export interface PhilosophyComparable {
  id: string;
  name: Cell;
  /** "Close", "Some overlap". */
  match: Cell;
  description: Cell;
  /** "Shared tendencies: cost efficiency · roster depth"; null when none is shared strongly. */
  shared: Cell | null;
}

/** The organization's identity, read from the settings alone. */
export interface PhilosophyIdentity {
  headline: Cell;
  tags: Cell[];
  /** "This organization …", with how it was read in its basis. */
  summary: Claim;
  nuance: Cell;
}

/** The Organizational Philosophy editor. */
export interface PhilosophyView extends PhilosophyViewHead {
  /** What the settings are for and what they never do, in one line; the authority chain in its basis. */
  lede: Claim;
  identity: PhilosophyIdentity;
  /** Who sets the philosophy ("Set by you"), and what comes later. */
  source: { title: Cell; mode: Cell; text: Cell };
  comparables: { title: Cell; lede: Cell; clubs: PhilosophyComparable[]; note: Claim };
  groups: PhilosophyGroupView[];
  policies: { title: Cell; description: Cell; items: PhilosophyPolicyView[] };
  /** The footer: what neutral means, and the reset with its confirmation's words. */
  neutral: { title: Cell; text: Cell; reset: Cell; confirm: Cell; confirmDetail: Cell };
}

/** A preference or a policy, as the app sends a change. */
export interface PhilosophySetting {
  id: string;
  /** A preference's 0–100 as a whole number, or a policy's choice. */
  value: Integer | string;
}

/** A change the GM made: the preferences and policies it sets (an undo sends back what it was). */
export interface PhilosophyUpdate {
  dimensions?: PhilosophySetting[];
  policies?: PhilosophySetting[];
}

/** What a change did: the editor as it now stands, the change in words, and the request that undoes it. */
export interface PhilosophyChange {
  view: PhilosophyView;
  /** "Competitive window set to 70: Leans — Maximize current wins." */
  said: Cell;
  /** The Edit menu's name for the undo ("Change Competitive Window"). */
  undoName: Cell;
  undo: PhilosophyUpdate;
}

// ── Coaching Staff ──────────────────────────────────────────────────────────

/** A titled table of the staff (the major-league staff, who is ready for a job up here, the farm's staff). */
export interface StaffSection {
  /** Structural: where the app keeps the table's columns, never shown. */
  id: string;
  title: Cell;
  /** One line about the section; null when there is nothing to say. */
  summary: Cell | null;
  table: MlbTable;
  /** A note under the table with its detail in the basis; null when there is none. */
  note: Claim | null;
}

/** The club's coaching staff as the save has it. */
export interface CoachingStaffView extends PhilosophyViewHead {
  lede: Claim;
  sections: StaffSection[];
  /** What the detail pane says before a coach is chosen. */
  select: Cell;
  /** Why there is no staff to show (none imported, or none for this club); null when there is. */
  empty: Cell | null;
}
