/**
 * What every department's adapter shares (V2 plan section 4.4, SWIFTUI_REBUILD.md sections 3.4 and 3.5): an item built
 * from a department's own severity, its report in the one anatomy, its card, and the desk that merges every
 * department's items in a stated order.
 *
 * Pure: the adapters hand in what their specialists answered; nothing here reads the database or decides anything
 * (D-001). An item's severity comes from `severity.ts` and is never raised; a department that could not be read is
 * `unavailable` and never all clear; a department with no report yet says so.
 */
import type { Cell, Claim, DeptId } from '../../contract/presentation.js';
import type { GameDate } from '../../dataFreshness.js';
import type { CatalogDepartment } from '../catalog.js';
import { basis, cell, claim, target } from '../claim.js';
import { gameDateDisplay } from '../dataStatusWords.js';
import { DESK_SEVERITIES, rankOf, type DepartmentReading, type DeskSeverity, type NormalizedSeverity } from '../severity.js';
import type { DepartmentCard, DepartmentReport, Desk, FoItem, FrontOfficeSummary, ReportSection } from './types.js';
import type { MorningParts } from './morningTypes.js';

/** What every claim of one build shares: the club, the import it reads and the game date it reflects. */
export interface BuildContext {
  orgId: number;
  club: string | null;
  /** The import's finish time (ISO), or null when the server has none on record. */
  importStamp: string | null;
  /** The build's stamp (moves with every rebuild), served in every payload. */
  reportStamp: string;
  /** The last game day the imported export reflects, as OOTP wrote it. */
  gameDate: GameDate | null;
}

/** One department as the report needs it: the catalog's entry (name, head, "prepared by") and its staff in words. */
export interface DepartmentContext {
  build: BuildContext;
  department: CatalogDepartment;
  /** "the major league staff", for "Raised by …" when the save names no head. */
  office: string;
}

/** What an adapter hands back for a department it could read. */
export interface DepartmentMaterial {
  /** The specialist it read, in words ("Major League Ops' roster review"). */
  specialist: string;
  /** Its items, in the department's own order. */
  items: FoItem[];
  figures: Claim[];
  /** What the department cannot see, as sentences. */
  unknowns: string[];
}

/** A department with no deterministic material yet: what its card and report say instead. */
export interface NotYet {
  status: 'notYet';
  /** One sentence ("Scouting has no report yet."). */
  line: string;
  hint: string;
}

export type DepartmentAnswer = DepartmentReading<DepartmentMaterial> | NotYet;

// ── words ────────────────────────────────────────────────────────────────────

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** A count at the start of a sentence: "Two", or "12" beyond ten. */
export const countWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);

export const plural = (n: number, word: string, many = `${word}s`): string => `${n} ${n === 1 ? word : many}`;

/** The desk's severity in words. */
export const SEVERITY_WORDS: Record<DeskSeverity, string> = { critical: 'Urgent', attention: 'Needs attention', noted: 'Noted' };
const SEVERITY_TONE = { critical: 'bad', attention: 'caution', noted: 'neutral' } as const;

/** "Through May 16, 2040", or why the game date is not known. */
export function asOfCell(build: BuildContext): Cell {
  const day = gameDateDisplay(build.gameDate);
  return day
    ? cell(`Through ${day}`, { hint: 'The last game day in the imported export' })
    : cell('Game date not known', { tone: 'unknown', hint: 'The imported export does not say which day it reflects' });
}

/** The source every claim of a department names. */
export function sourceOf(ctx: DepartmentContext, specialist: string) {
  return { department: ctx.department.id, specialist, asOf: ctx.build.importStamp, gameDate: ctx.build.gameDate };
}

/** "Raised by Jeff Banister, bench coach", or "Raised by the major league staff" when the save names nobody there. */
export function raisedBy(ctx: DepartmentContext): Cell {
  const head = ctx.department.head;
  return head
    ? cell(`Raised by ${head.name}, ${head.role.toLowerCase()}`, { hint: 'From the club\'s staff in the save' })
    : cell(`Raised by ${ctx.office}`);
}

// ── an item ──────────────────────────────────────────────────────────────────

export interface ItemInput {
  key: string;
  severity: NormalizedSeverity;
  /** How the department's own flag was shaded (its philosophy, its season), as sentences; [] when nothing shaded it. */
  shading: readonly string[];
  headline: Claim;
  detail?: Cell | null;
  evidence?: string | null;
  /** How many of the department's own items the row stands for (the grouping rule); 1 by default. */
  count?: number;
}

/**
 * The item's place on the desk as a claim. The desk goes by the department's plain reading: the severity it states with
 * no philosophy and no season to weigh (D-060: the season's odds never decide what reaches the desk or its order). When
 * the club's philosophy or season shaded the department's own flag, that reading is shown beside it as the lean, never
 * deciding anything. The basis names the policy line that placed it (D-041).
 */
function urgencyClaim(ctx: DepartmentContext, s: NormalizedSeverity, shading: readonly string[]) {
  const said = s.from.severity === null ? 'No urgency of its own' : SEVERITY_WORDS[s.severity];
  const because = [
    { label: `${ctx.department.name} said`, value: said },
    { label: 'With no philosophy and no season', value: SEVERITY_WORDS[s.neutral] },
    { label: 'On the desk', value: SEVERITY_WORDS[s.neutral] },
  ];
  if (s.dueInDays !== null) because.push({ label: 'Days left', value: String(s.dueInDays) });
  const shaded = s.neutral !== s.severity || shading.length > 0;
  const b = basis({
    because,
    source: sourceOf(ctx, 'The desk'),
    unknown: [],
    wouldChange: [],
    lean: shaded
      ? {
        neutral: `With no philosophy and no season to weigh: ${SEVERITY_WORDS[s.neutral].toLowerCase()}`,
        why: shading.length ? [...new Set(shading)] : [`The club's philosophy and season read it as ${SEVERITY_WORDS[s.severity].toLowerCase()}.`],
      }
      : null,
    certainty: 'policy',
    stamp: `${s.stamp.basis} ${DESK_PLACEMENT}`,
  });
  return claim({
    text: SEVERITY_WORDS[s.neutral],
    tone: SEVERITY_TONE[s.neutral],
    hint: s.neutral !== s.severity ? `Your club's situation would read it as ${SEVERITY_WORDS[s.severity].toLowerCase()}` : undefined,
    basis: b,
  });
}

/** The line that places an item on the desk (D-041 policy, D-060). */
export const DESK_PLACEMENT = 'The desk places each item by its department\'s plain reading, with no philosophy and no season to weigh; a shaded reading is shown beside it and decides nothing.';

/** One item on the desk, at its department's own severity (never raised: `severity.ts` holds that). */
export function item(ctx: DepartmentContext, input: ItemInput): FoItem {
  const s = input.severity;
  if (!DESK_SEVERITIES.includes(s.severity) || !DESK_SEVERITIES.includes(s.neutral)) throw new Error(`Unknown severity for ${input.key}`);
  return {
    key: input.key,
    department: ctx.department.id,
    raisedBy: raisedBy(ctx),
    severity: s.severity,
    neutralSeverity: s.neutral,
    urgency: urgencyClaim(ctx, s, input.shading),
    headline: input.headline,
    detail: input.detail ?? null,
    due: s.dueInDays === null
      ? null
      : cell(s.dueInDays <= 0 ? 'Due today' : `${plural(s.dueInDays, 'day')} left`, { tone: s.neutral === 'critical' ? 'bad' : 'neutral' }),
    dueInDays: s.dueInDays,
    evidence: input.evidence ?? null,
    count: input.count ?? 1,
  };
}

// ── ordering ─────────────────────────────────────────────────────────────────

/** The departments in the sidebar's order: the desk's last tie-break. */
const DEPARTMENT_ORDER: readonly DeptId[] = ['frontOffice', 'majorLeague', 'farm', 'scouting', 'trades', 'finance', 'medical', 'league', 'philosophy'];

/**
 * The desk's stated order: the plain severity each department gave (urgent, then needs attention, then noted: with no
 * philosophy and no season to weigh, D-060), then the
 * nearest deadline (an item with no clock after those with one), then the department (the sidebar's order), then the
 * department's own order. Stable, and nothing else: no hidden score.
 */
export function deskOrder(items: readonly FoItem[]): FoItem[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) =>
      rankOf(b.it.neutralSeverity) - rankOf(a.it.neutralSeverity)
      || (a.it.dueInDays ?? Number.POSITIVE_INFINITY) - (b.it.dueInDays ?? Number.POSITIVE_INFINITY)
      || DEPARTMENT_ORDER.indexOf(a.it.department) - DEPARTMENT_ORDER.indexOf(b.it.department)
      || a.i - b.i)
    .map(({ it }) => it);
}


/** To decide: urgent and needs-attention items by the plain reading. Watching: noted ones (SWIFTUI_REBUILD.md section 3.5). */
export const toDecide = (items: readonly FoItem[]) => items.filter((it) => it.neutralSeverity !== 'noted');
export const watching = (items: readonly FoItem[]) => items.filter((it) => it.neutralSeverity === 'noted');

// ── a report ─────────────────────────────────────────────────────────────────

function section(title: string, items: FoItem[], emptyLine: string | null): ReportSection {
  return { title: cell(title), items, empty: items.length === 0 && emptyLine ? cell(emptyLine) : null };
}

/** The one-sentence summary of a department that was read: its counts, in words. */
function countsSentence(decide: number, watch: number): string {
  if (decide > 0 && watch > 0) return `${countWord(decide)} to decide; ${countWord(watch).toLowerCase()} to watch.`;
  if (decide > 0) return `${countWord(decide)} to decide.`;
  if (watch > 0) return `Nothing to decide; ${countWord(watch).toLowerCase()} to watch.`;
  return 'Nothing to decide or watch.';
}

const UNKNOWNS_TITLE = 'What we can\'t see';

/** A department's report in the one anatomy, from what its adapter answered (or why it could not). */
export function report(ctx: DepartmentContext, answer: DepartmentAnswer): DepartmentReport {
  const d = ctx.department;
  const base = {
    department: d.id,
    name: d.name,
    importStamp: ctx.build.importStamp,
    reportStamp: ctx.build.reportStamp,
    preparedBy: d.preparedBy,
    head: d.head,
    asOf: asOfCell(ctx.build),
    changes: null,
    memo: null,
  };
  if (answer.status === 'notYet') {
    return {
      ...base,
      status: 'notYet',
      summary: claim({
        text: answer.line,
        tone: 'neutral',
        hint: answer.hint,
        basis: basis({
          because: [], source: sourceOf(ctx, d.name), unknown: [answer.line], wouldChange: [], lean: null, certainty: 'unknown',
        }),
      }),
      figures: [],
      toDecide: section('To decide', [], null),
      watching: section('Watching', [], null),
      unknowns: { title: cell(UNKNOWNS_TITLE), lines: [cell(answer.line)] },
    };
  }
  if (answer.status === 'unavailable') {
    return {
      ...base,
      status: 'unavailable',
      summary: claim({
        text: answer.reason,
        tone: 'unknown',
        hint: 'What it would have raised is not known, so this is not an all clear',
        basis: basis({
          because: [], source: sourceOf(ctx, d.name), unknown: [answer.reason], wouldChange: ['Importing the export again, or the server log, says more.'], lean: null, certainty: 'unknown',
        }),
      }),
      figures: [],
      toDecide: section('To decide', [], null),
      watching: section('Watching', [], null),
      unknowns: { title: cell(UNKNOWNS_TITLE), lines: [cell(answer.reason, { tone: 'unknown' })] },
    };
  }
  const material = answer.items[0];
  const decide = deskOrder(toDecide(material.items));
  const watch = deskOrder(watching(material.items));
  const unknowns = [...new Set(material.unknowns)];
  return {
    ...base,
    status: 'ready',
    summary: claim({
      text: countsSentence(decide.length, watch.length),
      tone: decide.some((it) => it.neutralSeverity === 'critical') ? 'bad' : decide.length > 0 ? 'caution' : 'neutral',
      basis: basis({
        because: [
          { label: 'To decide', value: String(decide.length) },
          { label: 'To watch', value: String(watch.length) },
        ],
        source: sourceOf(ctx, material.specialist),
        unknown: unknowns,
        wouldChange: ['A new export.'],
        lean: null,
        certainty: 'fact',
      }),
    }),
    figures: material.figures,
    toDecide: section('To decide', decide, 'Nothing to decide'),
    watching: section('Watching', watch, 'Nothing to watch'),
    unknowns: {
      title: cell(UNKNOWNS_TITLE),
      lines: unknowns.length ? unknowns.map((u) => cell(u, { tone: 'unknown' })) : [cell('Nothing missing that we know of')],
    },
  };
}

/** A department's card on the Morning Report: the report in brief. */
export function card(r: DepartmentReport): DepartmentCard {
  const ready = r.status === 'ready';
  return {
    department: r.department,
    name: r.name,
    status: r.status,
    preparedBy: r.preparedBy,
    summary: r.summary,
    figures: r.figures.slice(0, 3),
    top: r.watching.items.slice(0, 3),
    toDecide: ready ? r.toDecide.items.length : null,
    watching: ready ? r.watching.items.length : null,
    open: r.status === 'notYet' ? null : target({ kind: 'view', department: r.department, view: 'report' }),
    memo: r.memo,
  };
}

/** How many items to decide the desk shows from one department (a stated policy line, D-041); the rest are in its report. */
export const DESK_SHARE = 5;

export const DESK_ORDER_HINT = 'Urgent first, then the nearest deadline; five from each department';

/**
 * The desk: each department's items to decide, the first `DESK_SHARE` in its own desk order, merged in the stated order,
 * and a line for each department with more. When a department could not be read the desk says it may be missing items;
 * with nothing to decide it says which departments that covers, never an all clear for the ones with no report yet.
 */
export function desk(reports: readonly DepartmentReport[]): Desk {
  const shown: FoItem[] = [];
  const more: Desk['more'] = [];
  for (const r of reports) {
    const decide = r.toDecide.items;
    shown.push(...decide.slice(0, DESK_SHARE));
    if (decide.length > DESK_SHARE) {
      const extra = decide.length - DESK_SHARE;
      more.push({
        department: r.department,
        line: cell(`And ${extra} more in ${r.name}`),
        count: extra,
        open: target({ kind: 'view', department: r.department, view: 'report' }),
      });
    }
  }
  const items = deskOrder(shown);
  const missing = reports.filter((r) => r.status === 'unavailable').map((r) => r.name);
  const notYet = reports.filter((r) => r.status === 'notYet').map((r) => r.name);
  const reporting = reports.length - notYet.length - missing.length;
  return {
    title: cell('Your desk'),
    order: cell('Most urgent first', { hint: DESK_ORDER_HINT }),
    items,
    more,
    empty: items.length === 0 && missing.length === 0
      ? notYet.length
        ? cell(`Nothing to decide from the ${countWord(reporting).toLowerCase()} departments reporting`, { hint: `${listWords(notYet)} have no report yet` })
        : cell('Nothing to decide')
      : null,
    incomplete: missing.length
      ? cell(`${listWords(missing)} couldn't be read, so the desk may be missing items`, { tone: 'unknown' })
      : null,
  };
}

/** "Medical", "Finance and Medical", "Farm, Finance and Medical". */
export function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The Morning Report's desk and cards, and its own parts when they were built (N6). `reports` is every department's but
 * the Front Office's own.
 */
export function summary(build: BuildContext, reports: readonly DepartmentReport[], morning: MorningParts | null = null): FrontOfficeSummary {
  return {
    orgId: build.orgId,
    club: build.club,
    importStamp: build.importStamp,
    reportStamp: build.reportStamp,
    asOf: asOfCell(build),
    desk: desk(reports),
    departments: reports.map(card),
    teamSeason: morning?.teamSeason ?? null,
    lede: morning?.lede ?? null,
    clubProfile: morning?.clubProfile ?? null,
    rosterMap: morning?.rosterMap ?? null,
  };
}

/**
 * The Front Office's own report: the whole desk (every department's items to decide, and everything being watched,
 * each still under the department that raised it), with a count per department as its key figures.
 */
export function frontOfficeReport(ctx: DepartmentContext, reports: readonly DepartmentReport[]): DepartmentReport {
  const all = reports.flatMap((r) => [...r.toDecide.items, ...r.watching.items]);
  const readable = reports.filter((r) => r.status === 'ready');
  const missing = reports.filter((r) => r.status === 'unavailable');
  const figures = [
    claim({
      text: `${readable.length} of ${reports.length} departments reporting`,
      tone: missing.length ? 'caution' : 'neutral',
      value: { n: readable.length, unit: 'count', display: `${readable.length} of ${reports.length}`, ...(reports.length > 0 ? { whole: reports.length } : {}) },
      hint: missing.length ? `${listWords(missing.map((r) => r.name))} couldn't be read` : undefined,
      basis: basis({
        because: reports.map((r) => ({ label: r.name, value: r.status === 'ready' ? 'Reported' : r.status === 'unavailable' ? 'Could not be read' : 'No report yet' })),
        source: sourceOf(ctx, 'The desk'),
        unknown: missing.map((r) => `${r.name} couldn't be read, so what it would raise is not known.`),
        wouldChange: [],
        lean: null,
        certainty: 'fact',
      }),
    }),
  ];
  const answer: DepartmentAnswer = {
    status: 'available',
    items: [{
      specialist: 'The desk',
      items: all,
      figures,
      unknowns: missing.map((r) => `${r.name} couldn't be read, so the desk may be missing items.`),
    }],
  };
  return report(ctx, answer);
}

// ── the whole Front Office ───────────────────────────────────────────────────

/** The departments with a card on the Morning Report, in the sidebar's order (the Front Office is the report itself). */
export const REPORTING: readonly DeptId[] = DEPARTMENT_ORDER.filter((d) => d !== 'frontOffice');

/** What a department with no deterministic material yet says (SWIFTUI_REBUILD.md section 9: its milestone brings it). */
export const NOT_YET: Readonly<Partial<Record<DeptId, NotYet>>> = {
  scouting: { status: 'notYet', line: 'No scouting report yet.', hint: 'The draft board and player search come in a later version' },
  trades: { status: 'notYet', line: 'No trade report yet.', hint: 'The trade desk comes in a later version' },
  league: { status: 'notYet', line: 'No league report yet.', hint: 'The wire, standings and club reports come in a later version' },
  philosophy: { status: 'notYet', line: 'No staff report yet.', hint: 'The philosophy and coaching staff views come in a later version' },
};

/** Every department's report and the summary, from what each department answered. */
export function assemble(
  build: BuildContext,
  departments: readonly CatalogDepartment[],
  offices: (id: DeptId) => string,
  answers: Readonly<Partial<Record<DeptId, DepartmentAnswer>>>,
  morning: MorningParts | null = null,
): { summary: FrontOfficeSummary; reports: Map<DeptId, DepartmentReport> } {
  const ctxOf = (id: DeptId): DepartmentContext => {
    const department = departments.find((d) => d.id === id);
    if (!department) throw new Error(`The catalog has no department ${id}`);
    return { build, department, office: offices(id) };
  };
  const reports = new Map<DeptId, DepartmentReport>();
  for (const id of REPORTING) {
    const answer = answers[id] ?? NOT_YET[id];
    if (!answer) throw new Error(`No answer and no "not yet" line for ${id}`);
    reports.set(id, report(ctxOf(id), answer));
  }
  const listed = [...reports.values()];
  reports.set('frontOffice', frontOfficeReport(ctxOf('frontOffice'), listed));
  return { summary: summary(build, listed, morning), reports };
}
