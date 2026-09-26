/**
 * `GET /api/v2/catalog` (SWIFTUI_REBUILD.md section 4.2): what every view of the Mac app draws on. The glossary and the
 * stat catalog (the same data the React app reads), each club's palette as hex tokens in both modes with its logo and
 * record, the departments with the head of each from the save's staff, and the sentence for a value that is missing.
 *
 * Everything here is either served data (a name, a colour, a record, as the export has it) or a sentence about it.
 * A seat the save does not fill says so: never a made-up name (D-018).
 */
import type { Cell, DeptId } from '../contract/presentation.js';
import type { Integer } from '../contract/primitives.js';
import { clubRecord } from '../league.js';
import { logoReference } from '../logos.js';
import { seatHolder, type StaffSeat } from '../staff.js';
import { cell } from './claim.js';
import { REACT_ONLY_TERMS, glossaryTable } from './glossary.js';
import { clubPalette, type ClubPalette, type TeamColors } from './palette.js';
import {
  BATTING_STATS, CONTACT_STATS, FIELDING_STATS, PITCHING_STATS, type StatDef, type StatFormat,
} from './statCatalog.js';

/** A term and what it means (a column label and its explanation). */
export interface GlossaryEntry {
  /** The term as a column shows it ("OPS+", "GB"). */
  display: string;
  /** What it means, in sentences: the help the app shows for the column. */
  text: string;
}

export type StatCatalogGroup = 'batting' | 'pitching' | 'fielding' | 'contact';
export type StatSection = StatDef['section'];

/** One statistic the app can show. */
export interface StatEntry {
  /** The key of the stat in a served stat block. */
  key: string;
  group: StatCatalogGroup;
  /** Its column label. */
  display: string;
  /** What it means. */
  text: string;
  /** How a value is written: `int`, `avg3` (.312), `dec1`, `dec2`, `pct` (a share), `plus` (100 is league average). */
  format: StatFormat;
  section: StatSection;
  /** Lower is better (an ERA, a strikeout rate for a hitter). */
  lowerIsBetter: boolean;
}

/** A club's palette in both modes. */
export interface ClubPalettes {
  light: ClubPalette;
  dark: ClubPalette;
}

/** A major-league club: its palette, where its logo is, and its record as the export has it. */
export interface CatalogClub {
  teamId: Integer;
  name: string;
  /** The save's human runs the club; null when the export does not say. */
  isHuman: boolean | null;
  palette: ClubPalettes;
  /** Where to fetch the logo (`/api/logo/:teamId?v=…`), or null when the save holds none. */
  logo: string | null;
  /** Wins and losses ("45–38"), or the sentence for a record the export does not have. */
  record: Cell;
}

/** Who heads a department, as the save's staff has it. */
export interface DepartmentHead {
  name: string;
  /** The seat, as the save's staff page names it ("Bench Coach", "Team Doctor"). */
  role: string;
  coachId: Integer;
}

/** One view of a department, as the sidebar lists it. */
export interface CatalogView {
  /** The view's id inside its department (`fortyManOptions`), the Mac app's route. */
  id: string;
  name: string;
}

export interface CatalogDepartment {
  id: DeptId;
  name: string;
  /** Its views in the sidebar's order (SWIFTUI_REBUILD.md section 3.5). */
  views: CatalogView[];
  /** The person in the department's seat; null when the save names nobody there or the department has no one seat. */
  head: DepartmentHead | null;
  /** The masthead line ("Prepared by Jeff Banister, bench coach"), or what the save does not say. */
  preparedBy: Cell;
}

/** Sentences the app shows wherever a served value is missing and no line of its own says why. */
export interface CatalogPhrases {
  missingValue: Cell;
}

export interface Catalog {
  glossary: GlossaryEntry[];
  stats: StatEntry[];
  clubs: CatalogClub[];
  departments: CatalogDepartment[];
  phrases: CatalogPhrases;
}

/**
 * The departments in the sidebar's order, and the seat of the club's staff table each head sits in (null: the table has
 * no one seat for the department). The seats and their names are the save's own, as the staff page shows them
 * (`STAFF_ROLE_LABELS`); a provisional owner call, SWIFTUI_REBUILD.md section 3.5.
 */
const DEPARTMENTS: ReadonlyArray<{ id: DeptId; name: string; seat: StaffSeat | null; office: string; views: ReadonlyArray<[string, string]> }> = [
  { id: 'frontOffice', name: 'Front Office', seat: 'general_manager', office: 'the front office', views: [
    ['morningReport', 'Morning Report'], ['storylines', 'Storylines'], ['briefing', 'GM Briefing'],
  ] },
  { id: 'majorLeague', name: 'Major League Ops', seat: 'bench_coach', office: 'the major league staff', views: [
    ['report', 'Report'], ['positionPlayers', 'Position Players'], ['pitchingStaff', 'Pitching Staff'],
    ['benchCoverage', 'Bench & Backups'], ['decision', 'Decision'], ['lineup', 'Lineup'],
    ['pitchingAvailability', 'Pitching Availability'], ['scheduleGamePlans', 'Schedule & Game Plans'],
    ['depthChart', 'Depth Chart'], ['fortyManOptions', '40-Man & Options'], ['rosters', 'Rosters'], ['seasonTrends', 'Season Trends'],
  ] },
  { id: 'farm', name: 'Farm & Development', seat: null, office: 'the minor league staff', views: [
    ['report', 'Report'], ['organization', 'Organization'], ['affiliates', 'Affiliates'], ['assignments', 'Assignments'],
    ['prospects', 'Prospects'], ['developmentTracking', 'Development Tracking'], ['decision', 'Decision'],
  ] },
  { id: 'scouting', name: 'Scouting', seat: 'head_scout', office: 'the scouting staff', views: [
    ['draftBoard', 'Draft Board'], ['playerSearch', 'Player Search'],
  ] },
  { id: 'trades', name: 'Trades', seat: null, office: 'the front office', views: [['tradeDesk', 'Trade Desk']] },
  { id: 'finance', name: 'Finance', seat: null, office: 'the front office', views: [
    ['report', 'Report'], ['payrollBudget', 'Payroll & Budget'], ['contracts', 'Contracts'], ['freeAgents', 'Free Agents'],
    ['horizonBoard', 'Horizon Board'],
  ] },
  { id: 'medical', name: 'Medical', seat: 'doctor', office: 'the medical staff', views: [['report', 'Report'], ['injuryReport', 'Injury Report']] },
  { id: 'league', name: 'League Office', seat: null, office: 'the front office', views: [
    ['wire', 'Wire'], ['clubReports', 'Club Reports'], ['usVsThem', 'Us vs Them'], ['standings', 'Standings'],
    ['leaders', 'Leaders'], ['orgComparison', 'Org Comparison'], ['franchiseHistory', 'Franchise History'],
  ] },
  { id: 'philosophy', name: 'Philosophy & Staff', seat: null, office: 'the front office', views: [
    ['organizationalPhilosophy', 'Organizational Philosophy'], ['coachingStaff', 'Coaching Staff'],
  ] },
];

/** The glossary as served: every term but those only the React app's pages use. */
export function servedGlossary(): GlossaryEntry[] {
  const hidden = new Set(REACT_ONLY_TERMS);
  return Object.entries(glossaryTable())
    .filter(([term]) => !hidden.has(term))
    .sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    .map(([display, text]) => ({ display, text }));
}

/** The stat catalog as served, each stat once per group it is offered in. */
export function servedStats(): StatEntry[] {
  const groups: Array<[StatCatalogGroup, StatDef[]]> = [
    ['batting', BATTING_STATS], ['pitching', PITCHING_STATS], ['fielding', FIELDING_STATS], ['contact', CONTACT_STATS],
  ];
  return groups.flatMap(([group, defs]) =>
    defs.map((d) => ({ key: d.key, group, display: d.label, text: d.desc, format: d.format, section: d.section, lowerIsBetter: d.lowerIsBetter === true })),
  );
}

/** A club's record as a cell: "45–38" with the division place in the help tag when the export states it. */
function recordCell(teamId: number): Cell {
  const record = clubRecord(teamId);
  if (!record) return cell('No record in the export yet', { tone: 'unknown', hint: 'The export\'s standings do not list this club' });
  const place = record.pos === null ? null : record.pos === 1 ? 'first in the division' : `${ordinal(record.pos)} in the division`;
  const back = record.gb !== null && record.gb > 0 ? `, ${record.gb} ${record.gb === 1 ? 'game' : 'games'} back` : '';
  const hint = `${record.w} ${record.w === 1 ? 'win' : 'wins'}, ${record.l} ${record.l === 1 ? 'loss' : 'losses'}${place ? `, ${place}${back}` : ''}`;
  return cell(`${record.w}–${record.l}`, { hint });
}

const ordinal = (n: number): string => {
  const rem100 = n % 100;
  const suffix = rem100 >= 11 && rem100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

/** The clubs the catalog describes: the major-league clubs (`catalogClubs()` in `org.ts`). */
export interface ClubSource {
  team_id: number;
  label: string;
  isHuman: boolean | null;
  colors: TeamColors;
}

export function servedClub(club: ClubSource): CatalogClub {
  return {
    teamId: club.team_id,
    name: club.label,
    isHuman: club.isHuman,
    palette: { light: clubPalette(club.colors, 'light'), dark: clubPalette(club.colors, 'dark') },
    logo: logoReference(club.team_id),
    record: recordCell(club.team_id),
  };
}

/** Each department with its head, for the organization the app is about (null: no club is known yet). */
export function servedDepartments(orgId: number | null): CatalogDepartment[] {
  return DEPARTMENTS.map((d) => {
    const base = { id: d.id, name: d.name, views: d.views.map(([id, name]) => ({ id, name })) };
    if (!d.seat) return { ...base, head: null, preparedBy: cell(`Prepared by ${d.office}`) };
    const reading = orgId === null ? null : seatHolder(orgId, d.seat);
    if (reading?.status === 'filled') {
      return {
        ...base,
        head: { name: reading.name, role: reading.role, coachId: reading.coachId },
        preparedBy: cell(`Prepared by ${reading.name}, ${reading.role.toLowerCase()}`, { hint: 'From the club\'s staff in the save' }),
      };
    }
    const role = (reading?.role ?? d.seat).toLowerCase();
    const hint = reading?.status === 'empty'
      ? `The save's staff has no ${role} for this club`
      : 'The export does not include the club\'s staff';
    return { ...base, head: null, preparedBy: cell(`Prepared by ${d.office}`, { tone: 'unknown', hint }) };
  });
}

export function buildCatalog(clubs: ClubSource[], orgId: number | null): Catalog {
  return {
    glossary: servedGlossary(),
    stats: servedStats(),
    clubs: clubs.map(servedClub),
    departments: servedDepartments(orgId),
    phrases: {
      missingValue: cell('Not known yet', { tone: 'unknown', hint: 'The export does not include this yet' }),
    },
  };
}
