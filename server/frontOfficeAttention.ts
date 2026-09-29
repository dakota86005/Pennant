/**
 * The Front Office with the GM's attention on it (N7 Stage A, D-058): the build the Front Office service keeps
 * (`frontOfficeService.ts`, the departments' answers, unchanged) with each item's desk status, the desk's set-aside
 * items, "since the last export" and the wire's column put on it when it is served.
 *
 * - **A status records attention and changes nothing else** (case 15): the build is never touched; the served summary
 *   is a new object over it, and the departments' severities, counts and order are theirs.
 * - **Remembered after each build is kept**, off the request's turn: what the club's Front Office served at this import
 *   (its items, severities and key figures) and every club's standings (`frontOfficeMemory.ts`), the statuses whose
 *   items this import no longer raises resolved, and a `changes-ready` event with the notification's words, once per
 *   import.
 * - **Cheap to serve:** the composed answer is kept per build and per remembered state; a status or a follow moves the
 *   state, so the next read composes again (a few milliseconds: no table of the league is read).
 */
import type { DeptId } from './contract/presentation.js';
import { clubOwed } from './clubOwed.js';
import { parseGameDate } from './dataFreshness.js';
import {
  FrontOfficeRefusal, frontOfficeBuilt, keptFrontOffice, onFrontOfficeKept, resolveOrg, warmClubReports, type FrontOfficeBuilt,
} from './frontOfficeService.js';
import * as memory from './frontOfficeMemory.js';
import { ourClub, wireTopFor } from './aroundTheLeague.js';
import { importedAt } from './playerStateRoutes.js';
import { cell } from './presentation/claim.js';
import { gameDateDisplay } from './presentation/dataStatusWords.js';
import {
  FIRST_EXPORT, NOT_FILED, attendCards, attendDesk, attendReports, attentionOf, newOnDesk, nothingToCompare, sinceLastExport,
  type AttentionRecord, type PreviousExport, type ResultsSince,
} from './presentation/frontOffice/attention.js';
import { REPORTING } from './presentation/frontOffice/desk.js';
import type { DepartmentReport, DeskChange, DeskStatus, DeskUpdate, DeskView, FrontOfficeSummary, ReportChange } from './presentation/frontOffice/types.js';
import { publish } from './serverEvents.js';
import { timestampWords } from './timeWords.js';
import { searchIndex } from './search.js';
import { copyWatchlist } from './frontOfficeMemory.js';
import { wireFacts, wireGatherMs } from './leagueWire.js';
import { currentOrganization } from './viewingOrganization.js';

// ── composing ──────────────────────────────────────────────────────────────

interface Composed {
  summary: FrontOfficeSummary;
  reports: Map<DeptId, DepartmentReport>;
  deskStamp: string;
  /** How many of this import's new items are to decide; null with nothing to compare. */
  newToDecide: number | null;
}

const MAX_COMPOSED = 8;
const composed = new Map<string, Composed>();
let composeCount = 0;

/** How many times an answer was composed (the tests' "served from the cache"). */
export const attentionComposes = (): number => composeCount;

const hash = (text: string): string => {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};

function records(orgId: number): Map<string, AttentionRecord> {
  return new Map([...memory.deskRecords(orgId)].map(([key, r]) => [key, {
    status: r.status, until: r.until, note: r.note, since: r.updatedAt, sinceText: timestampWords(r.updatedAt), setImport: r.setImport,
  }]));
}

/** The club's games between the last export and this one (by count where the last export's standings say how many). */
function resultsSince(built: FrontOfficeBuilt, previous: memory.ReportSnapshot): ResultsSince | null {
  const games = built.season?.games ?? null;
  if (!games) return null;
  const before = memory.previousStandings(built.importStamp)?.rows.find((r) => r.teamId === built.orgId);
  if (before && before.w !== null && before.l !== null) {
    const played = before.w + before.l + (before.t ?? 0);
    if (played <= games.length) return { games: games.slice(played), how: 'count' };
  }
  const from = parseGameDate(previous.gameDate);
  if (!from) return null;
  return { games: games.filter((g) => (parseGameDate(g.date) ?? '') >= from), how: 'date' };
}

function compose(built: FrontOfficeBuilt): Composed {
  const recs = records(built.orgId);
  const deskStamp = `d${hash(JSON.stringify([...recs].map(([k, r]) => [k, r.status, r.until, r.note, r.since])))}`;
  const key = `${built.key}|${memory.memoryRevision()}|${deskStamp}`;
  const hit = composed.get(key);
  if (hit) return hit;
  composeCount += 1;
  const today = built.season?.gameDate ?? null;
  const attend = (k: string) => attentionOf(recs.get(k), today, built.importStamp);
  const listed = REPORTING.map((d) => built.reports.get(d)).filter((r): r is DepartmentReport => !!r);
  const reports = attendReports(listed, attend);

  let changes: FrontOfficeSummary['changes'] = null;
  let changesNote: FrontOfficeSummary['changesNote'] = null;
  let byDepartment: Map<DeptId, { changes: ReportChange[] | null; note: ReturnType<typeof cell> | null }> | null = null;
  let newToDecide: number | null = null;
  let sinceRaw: string | null = null;
  if (!memory.snapshotsAllowed()) changesNote = nothingToCompare(NOT_FILED);
  else {
    const previous = memory.previousReportSnapshot(built.orgId, built.importStamp);
    if (!previous) changesNote = nothingToCompare(FIRST_EXPORT);
    else {
      sinceRaw = previous.gameDate;
      const remembered: PreviousExport = {
        importStamp: previous.importStamp, gameDate: previous.gameDate, importedText: timestampWords(previous.importStamp),
        departments: previous.departments, items: previous.items,
      };
      const since = sinceLastExport({
        reports, previous: remembered, results: resultsSince(built, previous), importStamp: built.importStamp, gameDate: built.season?.gameDate ?? null,
      });
      changes = since.summary;
      byDepartment = since.byDepartment;
      newToDecide = since.newToDecide;
    }
  }
  const withChanges = reports.map((r) => ({
    ...r,
    changes: byDepartment?.get(r.department)?.changes ?? null,
    changesNote: byDepartment ? byDepartment.get(r.department)?.note ?? null : r.status === 'notYet' ? null : changesNote,
  }));
  const out = new Map<DeptId, DepartmentReport>(withChanges.map((r) => [r.department, r]));
  const fo = built.reports.get('frontOffice');
  if (fo) {
    const [attended] = attendReports([fo], attend);
    const all = byDepartment ? [...byDepartment.values()].flatMap((d) => d.changes ?? []) : null;
    out.set('frontOffice', {
      ...attended,
      changes: all,
      changesNote: all === null ? changesNote : all.length ? null : cell('Nothing changed since the last export'),
    });
  }
  const summary: FrontOfficeSummary = {
    ...built.summary,
    desk: attendDesk(withChanges),
    departments: attendCards(withChanges),
    changes,
    changesNote,
    wire: wireTopFor(built.orgId, built.importStamp, sinceRaw),
    deskStamp,
  };
  const result = { summary, reports: out, deskStamp, newToDecide };
  composed.set(key, result);
  while (composed.size > MAX_COMPOSED) composed.delete(composed.keys().next().value!);
  return result;
}

/** The Morning Report with the GM's attention on it (`GET /api/v2/front-office/:org`). */
export async function frontOfficeSummaryNow(orgId: number): Promise<FrontOfficeSummary> {
  return compose(await frontOfficeBuilt(orgId)).summary;
}

/** One department's report with every item's status and what changed in it (`GET /api/v2/departments/:org/:dept`). */
export async function departmentReportNow(orgId: number, dept: string): Promise<DepartmentReport> {
  const known = new Set<string>(['frontOffice', ...REPORTING]);
  if (!known.has(dept)) throw new FrontOfficeRefusal('Pennant doesn\'t know that department.', 404);
  const report = compose(await frontOfficeBuilt(orgId)).reports.get(dept as DeptId);
  if (!report) throw new FrontOfficeRefusal('Pennant doesn\'t know that department.', 404);
  return report;
}

function viewOf(built: FrontOfficeBuilt, c: Composed): DeskView {
  return { orgId: built.orgId, importStamp: built.importStamp, reportStamp: built.stamp, deskStamp: c.deskStamp, desk: c.summary.desk };
}

/** The desk on its own (`GET /api/v2/desk/:org`). */
export async function deskViewNow(orgId: number): Promise<DeskView> {
  const built = await frontOfficeBuilt(orgId);
  return viewOf(built, compose(built));
}

// ── changing a status ──────────────────────────────────────────────────────

/** Why a status change was refused, in a sentence. */
export class DeskRefusal extends Error {
  constructor(message: string, readonly status: 400 | 404) {
    super(message);
    this.name = 'DeskRefusal';
  }
}

const STATUSES = new Set<DeskStatus>(['open', 'reviewed', 'deferred', 'handled']);
const MAX_NOTE = 1000;

function doneWords(status: DeskStatus, until: string | null, previous: DeskStatus): string {
  switch (status) {
    case 'reviewed': return 'Marked reviewed';
    case 'handled': return 'Marked handled in OOTP';
    case 'deferred': return `Deferred until ${gameDateDisplay(until) ?? until ?? 'the day you chose'}`;
    default: return previous !== 'open' ? 'Back on your desk' : 'Note saved';
  }
}

/**
 * Sets an item's status (`PUT /api/v2/desk/:org`): the item must be in this export's reports; a deferral needs a game
 * date after the league's day. Answers with the status it replaced and the request that puts it back (one-step undo).
 * Records the GM's attention only: nothing is written to OOTP (D-004), and nothing the department said changes.
 */
export async function setDeskStatus(orgId: number, body: unknown): Promise<DeskChange> {
  const b = (body ?? {}) as Partial<DeskUpdate>;
  if (typeof b.key !== 'string' || b.key.trim() === '') throw new DeskRefusal('Say which item to mark.', 400);
  if (typeof b.status !== 'string' || !STATUSES.has(b.status as DeskStatus)) throw new DeskRefusal('Choose open, reviewed, deferred or handled in OOTP.', 400);
  if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > MAX_NOTE)) throw new DeskRefusal('Keep the note under 1,000 characters.', 400);
  if (!memory.snapshotsAllowed()) throw new DeskRefusal('The save you chose isn\'t imported yet, so its desk can\'t be marked.', 400);
  const built = await frontOfficeBuilt(orgId);
  const keys = new Set([...built.reports.values()].flatMap((r) => [...r.toDecide.items, ...r.watching.items].map((it) => it.key)));
  if (!keys.has(b.key)) throw new DeskRefusal('That item isn\'t in this export\'s reports. It may have been resolved.', 404);
  const status = b.status as DeskStatus;
  let until: string | null = null;
  if (status === 'deferred') {
    const day = typeof b.until === 'string' ? parseGameDate(b.until) : null;
    if (!day) throw new DeskRefusal('Choose the day to defer it to.', 400);
    const today = parseGameDate(built.season?.gameDate ?? null);
    if (today && day <= today) throw new DeskRefusal(`Choose a day after the league's day, ${gameDateDisplay(built.season?.gameDate ?? null) ?? today}.`, 400);
    until = b.until as string;
  }
  const before = records(orgId).get(b.key) ?? null;
  const { previous } = await memory.setDeskRecord(orgId, b.key, { status, until, note: b.note === undefined ? undefined : b.note.trim() }, built.importStamp);
  const c = compose(built);
  const today = built.season?.gameDate ?? null;
  const now = attentionOf(records(orgId).get(b.key), today, built.importStamp);
  const was = attentionOf(before, today, built.importStamp);
  publish({ type: 'desk-changed', orgId, deskStamp: c.deskStamp, key: b.key });
  return {
    key: b.key,
    done: cell(doneWords(status, until, previous?.status ?? 'open')),
    attention: now,
    previous: was,
    undo: { key: b.key, status: previous?.status ?? 'open', until: previous?.until ?? null, note: previous?.note ?? '' },
    view: viewOf(built, c),
  };
}

// ── remembering each import ────────────────────────────────────────────────

const FIRST_TEXT = 'Pennant will compare the next export with this one.';
let recorded = new Set<string>();

/**
 * Records what the club's Front Office served for this import, once its build is kept (the club the app follows, and
 * only for the import still served): the report and standings snapshots, the statuses this import resolves, and, the
 * first time for an import, `changes-ready` with the notification's words.
 */
export async function rememberBuild(built: FrontOfficeBuilt): Promise<boolean> {
  if (clubOwed()) return false;
  const org = currentOrganization()?.id ?? null;
  if (org !== built.orgId || !built.importStamp || built.importStamp !== importedAt.value) return false;
  if (keptFrontOffice(org)?.key !== built.key) return false;
  const listed = REPORTING.map((d) => built.reports.get(d)).filter((r): r is DepartmentReport => !!r);
  const items = listed.flatMap((r) => [...r.toDecide.items, ...r.watching.items]
    .map((it) => ({ key: it.key, department: it.department, severity: it.neutralSeverity, headline: it.headline.text, count: it.count })));
  const first = memory.reportSnapshotOf(org, built.importStamp) === null;
  const filed = await memory.recordReportSnapshot({
    orgId: org,
    importStamp: built.importStamp,
    gameDate: built.season?.gameDate ?? null,
    departments: Object.fromEntries(listed.map((r) => [r.department, r.status])),
    items,
    figures: listed.flatMap((r) => r.figures.map((f) => ({ department: r.department, text: f.text, display: f.value?.display ?? null, n: f.value?.n ?? null }))),
  });
  if (!filed) return false;
  if (built.season?.standings.length) await memory.recordStandingsSnapshot(built.importStamp, built.season.gameDate, built.season.standings);
  const resolved = await memory.resolveDeskRecords(org, new Set(items.map((i) => i.key)), new Set(listed.filter((r) => r.status === 'ready').map((r) => r.department)), built.importStamp);
  const c = compose(built);
  if (resolved) publish({ type: 'desk-changed', orgId: org, deskStamp: c.deskStamp, key: null });
  const once = `${org}|${built.importStamp}`;
  if (first && !recorded.has(once)) {
    recorded.add(once);
    publish({
      type: 'changes-ready', orgId: org, importStamp: built.importStamp, reportStamp: built.stamp, title: 'New export read',
      text: c.newToDecide === null ? FIRST_TEXT : newOnDesk(c.newToDecide), newToDecide: c.newToDecide,
    });
  }
  return true;
}

onFrontOfficeKept((built) => {
  rememberBuild(built)
    .then((filed) => { if (filed) void warmAfter(built.orgId, built.importStamp); })
    .catch((err) => console.error('[front office] what this import served could not be remembered:', err));
});

let warmed: string | null = null;

/**
 * Once per import (and at start), after the club's build is remembered: the watchlist is copied into Following, the
 * wire and the search index are gathered, and our division's club reports are built ahead, one at a time, off every
 * request's path.
 */
async function warmAfter(org: number, importStamp: string | null): Promise<void> {
  const once = `${org}|${importStamp}`;
  if (warmed === once) return;
  warmed = once;
  try {
    await copyWatchlist();
  } catch (err) {
    console.error('[following] the watchlist could not be copied:', err);
  }
  try {
    const wire = wireFacts(importStamp, org);
    const index = searchIndex(importStamp);
    console.log(`[wire] ${wire.facts.length} entries, gathered in ${wireGatherMs() ?? '?'} ms; search indexed ${index.entries.length} in ${index.ms} ms`);
  } catch (err) {
    console.error('[wire] the wire or the search index could not be gathered ahead:', err);
  }
  await warmClubReports(divisionRivals(org), org);
}

/** After an import (the last post-import hook): the club's build is waited on and remembered, and the rest warmed. */
export async function afterImport(): Promise<void> {
  const org = ourClub();
  if (org === null) return;
  try {
    const built = await frontOfficeBuilt(org);
    if (await rememberBuild(built)) await warmAfter(org, built.importStamp);
  } catch (err) {
    console.error('[front office] the import could not be remembered:', err);
  }
}

/** Our division's other clubs (their reports are built ahead after an import). */
function divisionRivals(org: number): number[] {
  const rows = memory.standingsOf(importedAt.value ?? '')?.rows ?? [];
  const me = rows.find((r) => r.teamId === org);
  return me ? rows.filter((r) => r.teamId !== org && r.leagueId === me.leagueId && r.subLeagueId === me.subLeagueId && r.divisionId === me.divisionId).map((r) => r.teamId) : [];
}

/** For the tests: forget what was composed and announced. */
export function resetAttention(): void {
  composed.clear();
  recorded = new Set();
  warmed = null;
  composeCount = 0;
}

export { resolveOrg };
