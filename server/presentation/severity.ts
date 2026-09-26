/**
 * Severity normalization (V2 plan section 4.4; BEHAVIOR_CASES.md "Pennant for Mac", `severity.test.ts`).
 *
 * The GM's desk gathers items from every department and orders them by stated severity. Each department states it in
 * its own words; this maps them onto one scale, `critical`, `attention`, `noted`, and nothing more:
 *
 * | Source | Mapping |
 * |---|---|
 * | Major League Ops | critical → critical, elevated → attention, watch → noted; the philosophy-free severity kept beside it |
 * | Farm & Development | unchanged |
 * | 40-man (Player Rights) | a running designation or waiver clock → critical, with its days left; an option note → noted |
 * | Contracts | a decision date → noted, with its days left; never a recommendation |
 * | Medical | noted (a return crunch stays Major League Ops' item) |
 *
 * - **An adapter never raises its specialist's severity.** Each department's own scale has an order, and the mapping
 *   never puts a code above its place in it; a code this build does not know throws rather than being guessed.
 * - A department with no severity of its own (40-man, contracts, medical) gets one from a stated line, stamped policy
 *   (D-041): chosen, shown and changed by decision, never fitted.
 * - **"Unavailable" is never "all clear."** A department whose read failed is `unavailable` with a sentence; its count of
 *   items is unknown (null), never zero, and it is never all clear (this fixes the silent `catch {}` the V2 plan found in
 *   `server/dashboard.ts`).
 *
 * Presentation says where an answer sits on the desk; it re-decides nothing (D-001).
 */
import { policy, type CalibrationStamp } from '../calibration.js';
import type { DeptId } from '../contract/presentation.js';
import type { Severity as MlbSeverity } from '../mlbNeeds.js';

/** The desk's common scale, most urgent first. */
export type DeskSeverity = 'critical' | 'attention' | 'noted';
export const DESK_SEVERITIES: readonly DeskSeverity[] = ['critical', 'attention', 'noted'];

/** Where a severity sits on the common scale: 3 critical, 2 attention, 1 noted. */
export const rankOf = (severity: DeskSeverity): number => ({ critical: 3, attention: 2, noted: 1 })[severity];

/** The farm's own scale (`farmOperations.ts`, `farmAffiliate.ts`): already the desk's. */
type FarmSeverity = 'critical' | 'attention' | 'noted';

export interface NormalizedSeverity {
  /** The department's severity on the common scale. */
  severity: DeskSeverity;
  /** The philosophy-free severity on the common scale: what a club with no philosophy and no season would be told. */
  neutral: DeskSeverity;
  /** What the department itself said (null where it states none). */
  from: { department: DeptId; severity: string | null; neutral: string | null };
  /** Days left on a running clock or to a decision date, when there is one. */
  dueInDays: number | null;
  /** The line that placed it (D-041). */
  stamp: CalibrationStamp;
}

/** The lines, one per source (D-041: policy, stated and changed by decision). */
export const SEVERITY_POLICY = {
  majorLeague: policy(
    'Major League Ops states critical, elevated or watch; they read critical, attention and noted on the desk, in the same order and never higher. A flag the philosophy shaded keeps its philosophy-free severity beside it.',
  ),
  farm: policy('Farm & Development states critical, attention or noted, the desk\'s own scale, and passes unchanged.'),
  fortyManClock: policy(
    'A running designation or waiver clock ends in a forced outcome on a known day, so it is critical with its days left.',
  ),
  fortyManNote: policy('An option note (last option year, out of options) is noted: it matters at the next move, and forces none.'),
  contracts: policy('A contract decision date is noted with its days left; the desk never recommends what to do on it.'),
  medical: policy('An injury is noted; when it forces a roster move, that return is Major League Ops\' item, not a second one here.'),
} as const;

class UnknownSeverity extends Error {
  constructor(department: string, code: unknown) {
    super(`Severity normalization does not know ${department}'s code "${String(code)}"; add it to presentation/severity.ts`);
    this.name = 'UnknownSeverity';
  }
}

const MLB_ORDER: Record<MlbSeverity, number> = { watch: 1, elevated: 2, critical: 3 };
const MLB_MAP: Record<MlbSeverity, DeskSeverity> = { critical: 'critical', elevated: 'attention', watch: 'noted' };

/** Holds the rule that a mapping never raises: the mapped rank is at most the code's rank on its own scale. */
function neverRaised(mapped: DeskSeverity, ownRank: number, department: string, code: string): DeskSeverity {
  if (rankOf(mapped) > ownRank) throw new Error(`${department}'s ${code} would be raised to ${mapped}`);
  return mapped;
}

function mlbCode(code: unknown): MlbSeverity {
  if (typeof code === 'string' && code in MLB_MAP) return code as MlbSeverity;
  throw new UnknownSeverity('Major League Ops', code);
}

/** A Major League Ops need (`mlbNeeds.ts`), with its philosophy-free severity when the club's context shaded it. */
export function mlbSeverity(need: { severity: MlbSeverity; explanation?: { neutralSeverity: MlbSeverity } | null }): NormalizedSeverity {
  const own = mlbCode(need.severity);
  const neutral = need.explanation ? mlbCode(need.explanation.neutralSeverity) : own;
  return {
    severity: neverRaised(MLB_MAP[own], MLB_ORDER[own], 'Major League Ops', own),
    neutral: neverRaised(MLB_MAP[neutral], MLB_ORDER[neutral], 'Major League Ops', neutral),
    from: { department: 'majorLeague', severity: own, neutral },
    dueInDays: null,
    stamp: SEVERITY_POLICY.majorLeague,
  };
}

/** A Farm & Development attention item or finding (`farmOperations.ts`, `farmAffiliate.ts`). */
export function farmSeverity(item: { severity: FarmSeverity }): NormalizedSeverity {
  const code = item.severity;
  if (!DESK_SEVERITIES.includes(code)) throw new UnknownSeverity('Farm & Development', code);
  const mapped = neverRaised(code, rankOf(code), 'Farm & Development', code);
  return { severity: mapped, neutral: mapped, from: { department: 'farm', severity: code, neutral: code }, dueInDays: null, stamp: SEVERITY_POLICY.farm };
}

/**
 * A 40-man issue from Player Rights (as the roster crunch serves it): a running clock (`designated` for assignment, or
 * on `waivers`) with its days left, or an option note (`clock` null).
 */
export function fortyManSeverity(issue: { clock: 'designated' | 'waivers' | null; daysLeft: number | null }): NormalizedSeverity {
  const running = issue.clock !== null;
  const severity: DeskSeverity = running ? 'critical' : 'noted';
  return {
    severity,
    neutral: severity,
    from: { department: 'majorLeague', severity: null, neutral: null },
    dueInDays: running ? issue.daysLeft : null,
    stamp: running ? SEVERITY_POLICY.fortyManClock : SEVERITY_POLICY.fortyManNote,
  };
}

/** A contract decision date (Finance). */
export function contractSeverity(date: { dueInDays: number | null }): NormalizedSeverity {
  return { severity: 'noted', neutral: 'noted', from: { department: 'finance', severity: null, neutral: null }, dueInDays: date.dueInDays, stamp: SEVERITY_POLICY.contracts };
}

/** An injury (Medical). */
export function medicalSeverity(): NormalizedSeverity {
  return { severity: 'noted', neutral: 'noted', from: { department: 'medical', severity: null, neutral: null }, dueInDays: null, stamp: SEVERITY_POLICY.medical };
}

/** What a department had to say, or why it could not say it. */
export type DepartmentReading<T> = { status: 'available'; items: T[] } | { status: 'unavailable'; reason: string };

/**
 * Reads a department's items. A read that throws is `unavailable` with the sentence given (the raw error goes to the
 * log, never to the GM), never an empty list.
 */
export function readDepartment<T>(
  read: () => T[],
  reason: string,
  log: (message: string) => void = (m) => console.error(m),
): DepartmentReading<T> {
  try {
    return { status: 'available', items: read() };
  } catch (err) {
    log(`[presentation] ${reason} ${err instanceof Error ? err.message : String(err)}`);
    return { status: 'unavailable', reason };
  }
}

/** How many items a department has for the desk; null when it could not be read (unknown, never zero). */
export function itemsToDecide<T>(reading: DepartmentReading<T>): number | null {
  return reading.status === 'available' ? reading.items.length : null;
}

/** All clear only when the department was read and had nothing; unavailable is never all clear. */
export function allClear<T>(reading: DepartmentReading<T>): boolean {
  return reading.status === 'available' && reading.items.length === 0;
}
