/**
 * The GM's attention on the Front Office, in words (N7 Stage A, D-058): each item's desk status, the desk with the items
 * he set aside, and "since the last export".
 *
 * Pure, like every adapter here: the service hands in the departments' reports as built, the statuses remembered and the
 * last export's snapshot; nothing here reads a table or decides anything (D-001).
 *
 * - **A status records attention and changes nothing else** (case 15): an item keeps its severity, its place in its
 *   department's order and its department's counts whatever its status. Reviewed, handled and deferred items leave the
 *   desk's lead list and stay one click away; a deferral ends on its game date; an item marked handled that the latest
 *   export still raises says so (Pennant writes nothing to OOTP, D-004, and the export is what says whether anything
 *   changed).
 * - **"Since the last export" says what changed, never which transaction did it** (D-020, case 16). An item is new when
 *   its department was read at both exports and the earlier one did not raise it; resolved when its department was read
 *   now and no longer raises it; moved when the same item is at another urgency. A department not read at either export
 *   changes nothing either way (its silence is not evidence, D-018). With no earlier export there is nothing to compare,
 *   said in a sentence, never an empty list.
 */
import type { Cell, DeptId } from '../../contract/presentation.js';
import type { GameDate } from '../../dataFreshness.js';
import { basis, cell, claim, target } from '../claim.js';
import { gameDateDisplay } from '../dataStatusWords.js';
import type { DeskSeverity } from '../severity.js';
import { SEVERITY_WORDS, card, desk as deskOf, openAttention } from './desk.js';

export { openAttention };
import type {
  ChangeChip, ChangeItem, DeferChoice, DepartmentCard, DepartmentReport, Desk, DeskAttention, DeskSetAside, DeskStatus, FoItem, ReportChange, SinceLastExport,
} from './types.js';

// ── an item's status ────────────────────────────────────────────────────────

/** A status as the service remembered it, with its time already in words. */
export interface AttentionRecord {
  status: DeskStatus;
  until: GameDate | null;
  note: string | null;
  /** When it was set (ISO 8601), and the same in words ("Today at 9:14 AM"). */
  since: string;
  sinceText: string | null;
  /** The import in force when it was set. */
  setImport: string | null;
}

/** Whether a game date is on or before another (both as OOTP writes them, compared only once parsed). */
function onOrBefore(a: string | null, b: string | null, parse: (d: string | null) => string | null): boolean {
  const x = parse(a);
  const y = parse(b);
  return x !== null && y !== null && x <= y;
}

/** The ISO form of a game date (`2040-5-9` → `2040-05-09`), or null; the one comparison dates get here. */
const isoDay = (d: string | null): string | null => {
  const m = d === null ? null : /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(d.trim());
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
};

/**
 * An item's status in words. `today` is the league's day (a deferral ends once it is reached); `importStamp` the import
 * served now (a status set under an earlier import whose item this one still raises is "still shown").
 */
export function attentionOf(record: AttentionRecord | null | undefined, today: GameDate | null, importStamp: string | null): DeskAttention {
  if (!record) return openAttention();
  const when = record.sinceText ? `Marked ${record.sinceText}` : undefined;
  const base = { note: record.note, since: record.since, until: null as GameDate | null, deferralEnded: false, stillShown: null as Cell | null };
  switch (record.status) {
    case 'reviewed':
      return { ...base, status: 'reviewed', line: cell('Reviewed', { hint: when }) };
    case 'handled': {
      const earlier = record.setImport !== null && importStamp !== null && record.setImport !== importStamp;
      return {
        ...base,
        status: 'handled',
        line: cell('Handled in OOTP', { hint: when ?? 'Marked by you; Pennant writes nothing to OOTP' }),
        stillShown: earlier
          ? cell('The latest export still shows it', { tone: 'caution', hint: 'Marked handled before this export, which still raises it' })
          : null,
      };
    }
    case 'deferred': {
      const day = gameDateDisplay(record.until) ?? record.until ?? 'a day not known';
      const ended = record.until !== null && onOrBefore(record.until, today, isoDay);
      return {
        ...base,
        status: 'deferred',
        until: record.until,
        deferralEnded: ended,
        line: ended ? cell(`Deferral ended ${day}`, { tone: 'caution', hint: 'Back on your desk: the league has reached the day you chose' }) : cell(`Deferred until ${day}`, { hint: when }),
      };
    }
    default:
      return { ...base, status: 'open', line: cell('Open', { hint: record.note ? 'Open, with your note' : undefined }) };
  }
}

/** Whether an item with this status sits on the desk's lead list: open, or a deferral whose day has come. */
export const onLeadList = (a: DeskAttention): boolean => a.status === 'open' || (a.status === 'deferred' && a.deferralEnded);

// ── the desk with statuses ──────────────────────────────────────────────────

const withAttention = (items: readonly FoItem[], attend: (key: string) => DeskAttention): FoItem[] =>
  items.map((it) => ({ ...it, attention: attend(it.key) }));

/** Each department's report with every item's status. Nothing else in it changes (case 15). */
export function attendReports(reports: readonly DepartmentReport[], attend: (key: string) => DeskAttention): DepartmentReport[] {
  return reports.map((r) => ({
    ...r,
    toDecide: { ...r.toDecide, items: withAttention(r.toDecide.items, attend) },
    watching: { ...r.watching, items: withAttention(r.watching.items, attend) },
  }));
}

/** "2 reviewed · 1 deferred · 1 handled in OOTP". */
function setAsideLine(reviewed: number, deferred: number, handled: number): string {
  return [
    reviewed ? `${reviewed} reviewed` : null,
    deferred ? `${deferred} deferred` : null,
    handled ? `${handled} handled in OOTP` : null,
  ].filter(Boolean).join(' · ');
}

/** The spans the Defer menu offers, each a stated policy line in calendar days after the league's day (N7, Stage B). */
export const DEFER_SPANS: ReadonlyArray<{ days: number; words: string }> = [
  { days: 1, words: 'Tomorrow' },
  { days: 7, words: 'A week' },
  { days: 14, words: 'Two weeks' },
  { days: 30, words: 'A month' },
];

/**
 * The days an item can be deferred to from the league's day, each written as OOTP writes a date (unpadded) with its
 * words; none when the league's day isn't known (a date is never guessed, D-018).
 */
export function deferChoices(today: GameDate | null): DeferChoice[] {
  const iso = isoDay(today);
  const start = iso === null ? NaN : Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(start)) return [];
  return DEFER_SPANS.map(({ days, words }) => {
    const at = new Date(start + days * 86_400_000);
    const until = `${at.getUTCFullYear()}-${at.getUTCMonth() + 1}-${at.getUTCDate()}`;
    const day = gameDateDisplay(until) ?? until;
    return { until, text: cell(`${words} · ${day}`, { hint: `Back on your desk when the league reaches ${day}` }) };
  });
}

/**
 * The desk as the GM left it: the lead list holds what is open (and deferrals whose day has come), in the desk's stated
 * order and share, from each department's items to decide; what he set aside is counted and listed beside it. The
 * departments' own reports, counts and order are unchanged. `today` is the league's day, for the days a deferral can
 * run to.
 */
export function attendDesk(reports: readonly DepartmentReport[], today: GameDate | null = null): Desk {
  const lead = reports.map((r) => ({ ...r, toDecide: { ...r.toDecide, items: r.toDecide.items.filter((it) => onLeadList(it.attention)) } }));
  const aside = reports.flatMap((r) => r.toDecide.items.filter((it) => !onLeadList(it.attention)));
  const d = { ...deskOf(lead), deferChoices: deferChoices(today) };
  if (!aside.length) return { ...d, setAside: null };
  const count = (s: DeskStatus) => aside.filter((it) => it.attention.status === s).length;
  const setAside: DeskSetAside = {
    line: cell(setAsideLine(count('reviewed'), count('deferred'), count('handled')), { hint: 'Set aside from your desk; still in each department\'s report' }),
    reviewed: count('reviewed'),
    deferred: count('deferred'),
    handled: count('handled'),
    items: aside,
  };
  return {
    ...d,
    setAside,
    empty: d.items.length === 0 && d.incomplete === null ? cell('Nothing open', { hint: 'Everything to decide is set aside' }) : d.empty,
  };
}

/** The departments' cards from the reports with statuses (their counts are the departments', never the desk's). */
export const attendCards = (reports: readonly DepartmentReport[]): DepartmentCard[] => reports.map(card);

// ── since the last export ───────────────────────────────────────────────────

/** An item as the last export's snapshot recorded it. */
export interface RememberedItem {
  department: DeptId;
  severity: DeskSeverity;
  headline: string;
}

/** The last export of this save, as remembered. */
export interface PreviousExport {
  importStamp: string;
  gameDate: GameDate | null;
  /** When it was imported, in words. */
  importedText: string | null;
  departments: Partial<Record<DeptId, 'ready' | 'unavailable' | 'notYet'>>;
  items: ReadonlyMap<string, RememberedItem>;
}

/** A game the club played between the two exports. */
export interface GamePlayed {
  gameId: number;
  date: string;
  scored: number;
  allowed: number;
  home: boolean;
  opponent: string;
}

/** The club's games between the two exports, and how they were told apart from the earlier ones. */
export interface ResultsSince {
  games: GamePlayed[];
  /** `count`: the club's games beyond the number it had played at the last export; `date`: from the last export's day. */
  how: 'count' | 'date';
}

/**
 * Why the games between the two exports aren't known: the export has no game-by-game schedule, the last export's
 * snapshot doesn't say which day it reflected (and its standings don't say how many games had been played), or the
 * club's season couldn't be read this time.
 */
export interface ResultsUnknown {
  games: null;
  why: 'noSchedule' | 'noPreviousDay' | 'noSeason';
}

const RESULTS_WHY: Record<ResultsUnknown['why'], string> = {
  noSchedule: 'The export has no game-by-game schedule',
  noPreviousDay: 'The last export doesn\'t say which day it reflected',
  noSeason: 'The club\'s season couldn\'t be read this time',
};

export interface ChangesInput {
  /** The reports now (every department but the Front Office), with statuses. */
  reports: readonly DepartmentReport[];
  previous: PreviousExport;
  results: ResultsSince | ResultsUnknown;
  /** The import now and the league's day it reflects. */
  importStamp: string | null;
  gameDate: GameDate | null;
}

const COMPARED = 'What two exports served';
const WHY_NOT = 'Two exports show that it changed, not which move or event changed it.';

function changeSource(department: DeptId, input: ChangesInput) {
  return { department, specialist: 'Since the last export', asOf: input.importStamp, gameDate: input.gameDate };
}

function sinceWords(previous: PreviousExport): string {
  const day = gameDateDisplay(previous.gameDate);
  return day ? `the export of ${day}` : 'the last export';
}

function newLine(it: FoItem, name: string, input: ChangesInput) {
  return claim({
    text: it.headline.text,
    tone: it.headline.tone,
    hint: `New since ${sinceWords(input.previous)}`,
    basis: basis({
      because: [
        { label: 'Raised by', value: name },
        { label: 'The last export', value: 'Did not raise it' },
        { label: 'This export', value: SEVERITY_WORDS[it.neutralSeverity] },
      ],
      source: changeSource(it.department, input),
      unknown: [WHY_NOT],
      wouldChange: [],
      lean: null,
      certainty: 'fact',
    }),
    links: [target({ kind: 'view', department: it.department, view: 'report' })],
  });
}

function resolvedLine(key: string, was: RememberedItem, name: string, input: ChangesInput) {
  return claim({
    text: was.headline,
    tone: 'neutral',
    hint: `Raised at ${sinceWords(input.previous)}, not now`,
    basis: basis({
      because: [
        { label: 'Raised by', value: name },
        { label: 'The last export', value: SEVERITY_WORDS[was.severity] },
        { label: 'This export', value: 'Does not raise it' },
      ],
      source: changeSource(was.department, input),
      unknown: [WHY_NOT],
      wouldChange: [],
      lean: null,
      certainty: 'fact',
    }),
    links: [target({ kind: 'view', department: was.department, view: 'report' })],
  });
}

function movedLine(it: FoItem, was: RememberedItem, name: string, input: ChangesInput) {
  const now = SEVERITY_WORDS[it.neutralSeverity];
  const then = SEVERITY_WORDS[was.severity];
  return claim({
    text: it.headline.text,
    tone: it.headline.tone,
    hint: `Now ${now.toLowerCase()}; was ${then.toLowerCase()}`,
    basis: basis({
      because: [
        { label: 'Raised by', value: name },
        { label: 'The last export', value: then },
        { label: 'This export', value: now },
      ],
      source: changeSource(it.department, input),
      unknown: [WHY_NOT],
      wouldChange: [],
      lean: null,
      certainty: 'fact',
    }),
    links: [target({ kind: 'view', department: it.department, view: 'report' })],
  });
}

function gameLine(g: GamePlayed, input: ChangesInput, how: ResultsSince['how']) {
  const letter = g.scored > g.allowed ? 'W' : g.scored < g.allowed ? 'L' : 'T';
  const day = gameDateDisplay(g.date) ?? g.date;
  const score = `${Math.max(g.scored, g.allowed)}–${Math.min(g.scored, g.allowed)}`;
  return claim({
    text: `${letter} ${score} ${g.home ? 'vs' : 'at'} ${g.opponent}`,
    tone: letter === 'W' ? 'good' : letter === 'L' ? 'bad' : 'neutral',
    hint: day,
    basis: basis({
      because: [
        { label: 'Day', value: day },
        { label: 'Score', value: `${g.scored}–${g.allowed}` },
        { label: 'Where', value: g.home ? 'At home' : `At ${g.opponent}` },
        { label: 'Since the last export', value: how === 'count' ? 'Played after the games the last export counted' : 'Played on or after the last export\'s day' },
      ],
      source: { department: 'majorLeague', specialist: 'The schedule', asOf: input.importStamp, gameDate: input.gameDate },
      unknown: [],
      wouldChange: [],
      lean: null,
      certainty: 'fact',
    }),
    links: [target({ kind: 'view', department: 'majorLeague', view: 'scheduleGamePlans' })],
  });
}

function chip(kind: ChangeChip['kind'], items: ChangeItem[], text: string, hint: string): ChangeChip {
  return { kind, count: items.length, text, hint, items };
}

/**
 * What changed since the last export: the four chips, and each department's own changes (null where its department
 * was not read at one of the two exports, with why).
 */
export function sinceLastExport(input: ChangesInput): {
  summary: SinceLastExport;
  byDepartment: Map<DeptId, { changes: ReportChange[] | null; note: Cell | null }>;
  /** How many of the new items are to decide (the desk's, not the ones being watched). */
  newToDecide: number;
} {
  const { previous } = input;
  const names = new Map(input.reports.map((r) => [r.department, r.name]));
  const readBoth = (d: DeptId) => previous.departments[d] === 'ready' && input.reports.find((r) => r.department === d)?.status === 'ready';
  const current = new Map<string, FoItem>();
  for (const r of input.reports) for (const it of [...r.toDecide.items, ...r.watching.items]) current.set(it.key, it);

  const fresh: ChangeItem[] = [];
  const moved: ChangeItem[] = [];
  const resolved: ChangeItem[] = [];
  const byDept = new Map<DeptId, ReportChange[]>();
  const add = (d: DeptId, change: ReportChange) => byDept.set(d, [...(byDept.get(d) ?? []), change]);
  for (const [key, it] of current) {
    if (!readBoth(it.department)) continue;
    const name = names.get(it.department) ?? it.department;
    const was = previous.items.get(key);
    if (!was) {
      const line = newLine(it, name, input);
      fresh.push({ key, department: it.department, line, open: target({ kind: 'view', department: it.department, view: 'report' }) });
      add(it.department, { kind: 'new', line });
    } else if (was.severity !== it.neutralSeverity) {
      const line = movedLine(it, was, name, input);
      moved.push({ key, department: it.department, line, open: target({ kind: 'view', department: it.department, view: 'report' }) });
      add(it.department, { kind: 'moved', line });
    }
  }
  for (const [key, was] of previous.items) {
    if (current.has(key) || !readBoth(was.department)) continue;
    const line = resolvedLine(key, was, names.get(was.department) ?? was.department, input);
    resolved.push({ key, department: was.department, line, open: target({ kind: 'view', department: was.department, view: 'report' }) });
    add(was.department, { kind: 'resolved', line });
  }

  const since = gameDateDisplay(previous.gameDate);
  const results = input.results.games === null ? null : input.results as ResultsSince;
  const games = results?.games ?? [];
  const w = games.filter((g) => g.scored > g.allowed).length;
  const l = games.filter((g) => g.scored < g.allowed).length;
  const t = games.length - w - l;
  const record = t ? `${w}–${l}–${t}` : `${w}–${l}`;
  const resultItems: ChangeItem[] = games.map((g) => ({
    key: `game:${g.gameId}`, department: null, line: gameLine(g, input, results!.how), open: target({ kind: 'view', department: 'majorLeague', view: 'scheduleGamePlans' }),
  }));

  const byDepartment = new Map<DeptId, { changes: ReportChange[] | null; note: Cell | null }>();
  for (const r of input.reports) {
    if (r.status === 'notYet') {
      byDepartment.set(r.department, { changes: null, note: null });
      continue;
    }
    if (!readBoth(r.department)) {
      byDepartment.set(r.department, {
        changes: null,
        note: cell(`${r.name} wasn't read at one of the two exports, so what changed isn't known`, { tone: 'unknown' }),
      });
      continue;
    }
    const list = byDept.get(r.department) ?? [];
    byDepartment.set(r.department, { changes: list, note: list.length ? null : cell(`Nothing changed since ${sinceWords(previous)}`) });
  }

  const newToDecide = fresh.filter((c) => current.get(c.key)?.neutralSeverity !== 'noted').length;
  return {
    newToDecide,
    summary: {
      new: chip('new', fresh, fresh.length ? `${fresh.length} new` : 'Nothing new', 'Raised since the last export'),
      resolved: chip('resolved', resolved, resolved.length ? `${resolved.length} resolved` : 'None resolved', 'Raised at the last export, not now'),
      moved: chip('moved', moved, moved.length ? `${moved.length} moved` : 'None moved', 'The same item, at another urgency'),
      results: chip(
        'results',
        resultItems,
        results === null ? 'Results not known' : games.length ? `${record} since ${since ?? 'the last export'}` : `No games since ${since ?? 'the last export'}`,
        results === null ? RESULTS_WHY[(input.results as ResultsUnknown).why] : 'The club\'s games between the two exports',
      ),
      since: cell(`Since ${sinceWords(previous)}`, { hint: previous.importedText ? `That export was read ${previous.importedText}` : undefined }),
      previousImport: previous.importStamp,
      previousGameDate: previous.gameDate,
    },
    byDepartment,
  };
}

/** Why there is nothing to compare with yet: the first export of the save Pennant has read (for this club). */
export const FIRST_EXPORT = 'This is the first export of this save Pennant has read, so there\'s nothing to compare yet.';
/** Why nothing is compared while the league served is not certainly the save's own. */
export const NOT_FILED = 'The league shown isn\'t yet the chosen save\'s own export, so nothing is compared.';

/** The line for "nothing to compare", as a cell. */
export const nothingToCompare = (why: string): Cell => cell(why, { tone: 'unknown', hint: 'The next export is compared with this one' });

/** "3 new on your desk", the notification's words after an import. */
export function newOnDesk(newToDecide: number): string {
  return newToDecide ? `${newToDecide} new on your desk` : 'Nothing new on your desk';
}
