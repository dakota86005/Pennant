/**
 * Philosophy & Staff on the Mac (N12 Track C; SWIFTUI_REBUILD.md section 9; D-073): the Organizational Philosophy editor,
 * written through here with the server's own checks, and Coaching Staff.
 *
 * - **The editor** reads the club's settings (`philosophyForOrg`) and words them, the identity included, on every request:
 *   it is the settings file and a few lines of arithmetic, well inside the budget. A change is checked whole before
 *   anything is written: an unknown setting, a preference off the 0–100 scale or not a whole number, or a policy choice
 *   not offered is refused in words (400), never clamped or dropped silently. Each change answers with what it did, in
 *   words, and the request that undoes it. Writing the settings moves the Front Office's inputs, so every kept build that
 *   read the philosophy is built again (the lens, the farm's preferences).
 * - **Coaching Staff** is the export's staff (`computeStaff`, the route `/api/staff/:orgId` reads), kept on the Front
 *   Office's inputs.
 */
import { db, tableExists } from './db.js';
import { FrontOfficeRefusal, NO_DATA, frontOfficeInputsKey, frontOfficeStampOf, resolveOrg } from './frontOfficeService.js';
import { PHILOSOPHY_DIMENSIONS, PHILOSOPHY_POLICY_OPTIONS, DEFAULT_PHILOSOPHY_PROFILE, normalizePhilosophyProfile, type PhilosophyProfile } from './philosophy.js';
import { getDataStatus } from './dataStatus.js';
import { importedAt } from './playerStateRoutes.js';
import { servedDepartments } from './presentation/catalog.js';
import { cell } from './presentation/claim.js';
import { changeOf, changeWords, philosophyView, undoOf, wholeOf, type PhilosophyContext, type PolicyOptions } from './presentation/philosophy/editor.js';
import { coachingStaffView } from './presentation/philosophy/staff.js';
import type { CoachingStaffView, PhilosophyChange, PhilosophyUpdate, PhilosophyView } from './presentation/philosophy/types.js';
import { computeStaff } from './rosterops.js';
import { philosophyForOrg, savePhilosophyForOrg } from './settings.js';

/** A change the editor refuses, in words (a 400). */
export class PhilosophyRefusal extends Error {
  constructor(message: string, readonly status: 400) {
    super(message);
    this.name = 'PhilosophyRefusal';
  }
}

export const NOT_A_CHANGE = 'Send the settings to change: preferences and policies, each with its id and value.';
export const UNKNOWN_SETTING = 'Pennant doesn\'t know that setting.';
export const OFF_THE_SCALE = 'A preference is a whole number from 0 to 100.';
export const NOT_OFFERED = 'That choice isn\'t one the policy offers.';

const OPTIONS = PHILOSOPHY_POLICY_OPTIONS as unknown as PolicyOptions;
const DIMENSION_IDS = new Set<string>(PHILOSOPHY_DIMENSIONS.map((d) => d.id));

/** The club's name as a sentence names it: its nickname ("Diamondbacks"), else its name. */
function clubWord(orgId: number): string {
  if (!tableExists('teams')) return 'The club';
  const row = db.prepare('SELECT name, nickname FROM teams WHERE team_id = ?').get(orgId) as { name?: unknown; nickname?: unknown } | undefined;
  const nick = typeof row?.nickname === 'string' ? row.nickname.trim() : '';
  const name = typeof row?.name === 'string' ? row.name.trim() : '';
  return nick || name || 'The club';
}

function contextFor(orgId: number): PhilosophyContext {
  const status = getDataStatus({ importedAt: importedAt.value });
  const dept = servedDepartments(orgId).find((d) => d.id === 'philosophy');
  return {
    orgId,
    importStamp: importedAt.value,
    reportStamp: frontOfficeStampOf(frontOfficeInputsKey(orgId)),
    gameDate: status.csv.simulatedThrough ?? status.csv.currentDate,
    preparedBy: dept?.preparedBy ?? cell('Prepared by the front office'),
    club: clubWord(orgId),
  };
}

/** The editor for a club (a team id, or `automatic`). */
export function philosophyNow(org: string): PhilosophyView {
  const orgId = resolveOrg(org);
  return philosophyView(contextFor(orgId), philosophyForOrg(orgId), OPTIONS);
}

/** A change, checked whole: every setting known, every preference a whole number 0–100, every policy choice offered. */
export function checkedUpdate(body: unknown): { dimensions: Array<{ id: string; value: number }>; policies: Array<{ id: string; value: string }> } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PhilosophyRefusal(NOT_A_CHANGE, 400);
  const b = body as Record<string, unknown>;
  const list = (v: unknown): Array<Record<string, unknown>> => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => !x || typeof x !== 'object')) throw new PhilosophyRefusal(NOT_A_CHANGE, 400);
    return v as Array<Record<string, unknown>>;
  };
  const dimensions = list(b.dimensions).map((d) => {
    if (typeof d.id !== 'string' || !DIMENSION_IDS.has(d.id)) throw new PhilosophyRefusal(UNKNOWN_SETTING, 400);
    if (typeof d.value !== 'number' || !Number.isInteger(d.value) || d.value < 0 || d.value > 100) throw new PhilosophyRefusal(OFF_THE_SCALE, 400);
    return { id: d.id, value: d.value };
  });
  const policies = list(b.policies).map((p) => {
    if (typeof p.id !== 'string' || !OPTIONS[p.id]) throw new PhilosophyRefusal(UNKNOWN_SETTING, 400);
    if (typeof p.value !== 'string' || !OPTIONS[p.id].some((o) => o.value === p.value)) throw new PhilosophyRefusal(NOT_OFFERED, 400);
    return { id: p.id, value: p.value };
  });
  if (dimensions.length + policies.length === 0) throw new PhilosophyRefusal(NOT_A_CHANGE, 400);
  return { dimensions, policies };
}

/** Sets the preferences and policies a change names; answers with what it did and the request that undoes it. */
export function setPhilosophyNow(org: string, body: unknown): PhilosophyChange {
  const orgId = resolveOrg(org);
  const update = checkedUpdate(body);
  const before = philosophyForOrg(orgId);
  const next: PhilosophyProfile = normalizePhilosophyProfile({
    ...before,
    manual: { ...before.manual, ...Object.fromEntries(update.dimensions.map((d) => [d.id, d.value])) },
    policies: { ...before.policies, ...Object.fromEntries(update.policies.map((p) => [p.id, p.value])) },
  });
  const after = savePhilosophyForOrg(orgId, next);
  const words = changeWords(update as PhilosophyUpdate, before, after, OPTIONS);
  return changeOf(philosophyView(contextFor(orgId), after, OPTIONS), words.said, words.undoName, undoOf(update as PhilosophyUpdate, before));
}

/** Puts every setting back to neutral; the undo puts each back as it was. */
export function resetPhilosophyNow(org: string): PhilosophyChange {
  const orgId = resolveOrg(org);
  const before = philosophyForOrg(orgId);
  const after = savePhilosophyForOrg(orgId, null);
  const unchanged = JSON.stringify(before) === JSON.stringify(normalizePhilosophyProfile(DEFAULT_PHILOSOPHY_PROFILE));
  return changeOf(
    philosophyView(contextFor(orgId), after, OPTIONS),
    unchanged ? 'Every setting was already neutral.' : 'Every setting is back to neutral.',
    'Reset to Neutral',
    wholeOf(before),
  );
}

const staffKept = new Map<string, CoachingStaffView>();

/** The club's coaching staff, kept on the Front Office's inputs. */
export function coachingStaffNow(org: string): CoachingStaffView {
  const orgId = resolveOrg(org);
  if (!tableExists('players')) throw new FrontOfficeRefusal(NO_DATA, 404);
  const key = frontOfficeInputsKey(orgId);
  const hit = staffKept.get(key);
  if (hit) return hit;
  const view = coachingStaffView(contextFor(orgId), computeStaff(orgId));
  staffKept.set(key, view);
  while (staffKept.size > 4) staffKept.delete(staffKept.keys().next().value!);
  return view;
}

/** For the tests: nothing kept. */
export function resetPhilosophyViews(): void {
  staffKept.clear();
}
