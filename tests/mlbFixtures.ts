import type { AssignmentContext, AssignmentKind } from '../server/assignmentContext';
import { leagueRulesFromRow, type LeagueRules } from '../server/leagueRules';
import { standingOf } from '../server/health';
import { buildClubView, type ClubView } from '../server/mlbRoster';
import type {
  CrossRoleSupport, FarmConsequence, PerformanceLine, RoleFitEvidence,
} from '../server/mlbEvidence';
import type { PhilosophyValues, ResponsePorts } from '../server/mlbResponses';
import { DEFAULT_COVERAGE_FLOORS, type CoverageFloors } from '../server/mlbNeeds';
import type { MlbAssignmentAssessment } from '../server/org';
import type { MlbAssignmentContext } from '../server/mlbAssignmentContext';
import type { LensEvidence } from '../server/roleReview';
import type { RoleRef } from '../server/mlbRoster';
import { evaluatePlayerRights, rosterCounts, type PlayerRights, type RightsEvidence } from '../server/playerRights';
import type { PlayerState } from '../server/playerState';
import { derivedFrom, fromExport, unknownBecause, type Sourced } from '../server/provenance';

/*
 * Synthetic MLB clubs. Nothing here reads a real save. Rights come from the real
 * evaluator so the tests exercise the actual three-valued contract.
 */

const known = <T>(value: T): Sourced<T> => fromExport(value, 'test');
const unknown = <T>(): Sourced<T> => unknownBecause<T>('not_exported_by_ootp', 'test', 'blank');

export interface Spec {
  id: number;
  name?: string;
  position: number;
  role?: number;
  level?: number;
  active?: boolean;
  forty?: boolean;
  il?: boolean;
  il60?: boolean;
  daysLeft?: number;
  designated?: boolean;
  age?: number;
  mlbYears?: number;
  used?: number;
  /** Leave the availability flags unknown (an export that lacked them). */
  unknownAvailability?: boolean;
}

export function mkState(spec: Spec): PlayerState {
  const level = spec.level ?? 1;
  const active = spec.active ?? (level === 1 && !spec.il && !spec.il60);
  const il = spec.il ?? false;
  const il60 = spec.il60 ?? false;
  const designated = spec.designated ?? false;
  const daysLeft = spec.daysLeft ?? 0;
  const standing = spec.unknownAvailability
    ? unknown<ReturnType<typeof standingOf>>()
    : derivedFrom(standingOf({
      is_active: active ? 1 : 0, is_on_dl: il ? 1 : 0, is_on_dl60: il60 ? 1 : 0,
      injury_is_injured: il || il60 ? 1 : 0, injury_dtd_injury: 0, injury_left: daysLeft,
      designated_for_assignment: designated ? 1 : 0, days_on_dfa_left: 0, is_on_waivers: 0,
    }), 'test');
  return {
    playerId: spec.id,
    name: spec.name ?? `Player ${spec.id}`,
    age: spec.age ?? 27,
    organizationId: known(1),
    teamId: known(level === 1 ? 1 : level === 2 ? 2 : 3),
    level: known(level),
    position: known(spec.position),
    role: known(spec.role ?? 0),
    activeRoster: known(active),
    fortyMan: known(spec.forty ?? (active || (il && !il60))),
    injuredList: { onIl: known(il || il60), onIl60: known(il60) },
    injury: { injured: known(il || il60), dayToDay: known(false), daysLeft: known(daysLeft) },
    dfa: {
      designated: known(designated), daysLeft: known(0), onWaivers: known(false), waiverDaysLeft: known(0),
      irrevocableWaivers: known(false),
    },
    serviceTime: {
      mlbYears: known(spec.mlbYears ?? 2), mlbDays: known(0), mlbDaysThisSeason: known(0),
      professionalYears: known(6), professionalDays: known(0),
    },
    options: { used: known(spec.used ?? 0), usedThisYear: known(0), yearsProtectedFromRule5: known(4) },
    contract: { majorLeague: known(true) },
    wasTraded: known(false),
    health: derivedFrom(null, 'test'),
    standing,
  } as PlayerState;
}

export const league = (over: Partial<Record<string, number | null>> = {}): LeagueRules => {
  const row = {
    league_id: 203, rules_minor_league_options: 1, rules_rule_5: 1, rules_dfa_period_length: 7,
    rules_waiver_period_length: 3, rules_active_roster_limit: 26, rules_expanded_roster_limit: 28,
    rosters_expanded: 0, rules_secondary_roster_limit: 40, ...over,
  };
  return leagueRulesFromRow(row, new Set(Object.keys(row)));
};

/** A full, healthy 26-man: 5 SP, 8 RP, 2 C and 11 other hitters. */
export function healthy26(): Spec[] {
  const out: Spec[] = [];
  let id = 100;
  for (let i = 0; i < 5; i += 1) out.push({ id: id++, name: `SP${i + 1}`, position: 1, role: 11 });
  for (let i = 0; i < 8; i += 1) out.push({ id: id++, name: `RP${i + 1}`, position: 1, role: 12 });
  for (let i = 0; i < 2; i += 1) out.push({ id: id++, name: `C${i + 1}`, position: 2 });
  for (let i = 0; i < 11; i += 1) out.push({ id: id++, name: `H${i + 1}`, position: 3 + (i % 7) });
  return out;
}

export function viewOf(specs: Spec[], leagueOver: Partial<Record<string, number | null>> = {}): ClubView {
  const states = specs.map(mkState);
  return buildClubView(1, states, league(leagueOver));
}

export const CURRENT: RightsEvidence = { currentState: 'current', chronology: 'current' };

export function rightsFor(
  states: PlayerState[], evidence: RightsEvidence = CURRENT, assignments: Record<number, AssignmentKind> = {},
  leagueOver: Partial<Record<string, number | null>> = {}
) {
  const counts = rosterCounts(states);
  const out = new Map<number, { assignment: AssignmentContext | null; rights: PlayerRights }>();
  for (const state of states) {
    const kind = assignments[state.playerId];
    const assignment: AssignmentContext | null = kind
      ? {
        kind, label: kind, sinceLabel: null, since: '2030-05-10',
        ordinaryOption: kind === 'optioned', provenance: 'explicit_log', source: 'test', exportAgrees: true,
        rehab: null, details: {}, evidence: [],
      }
      : null;
    out.set(state.playerId, {
      assignment,
      rights: evaluatePlayerRights({ state, assignment, league: league(leagueOver), counts, evidence }),
    });
  }
  return out;
}

export interface PortOptions {
  states: PlayerState[];
  evidence?: RightsEvidence;
  assignments?: Record<number, AssignmentKind>;
  /** Player Development's assessment by player; a context is recorded so tests can see what was asked. */
  development?: Record<number, Partial<MlbAssignmentAssessment>>;
  /** Player Development's assessment by context, then player. A context listed here overrides `development`; a player absent from it is unassessed for that context. */
  developmentByContext?: Partial<Record<MlbAssignmentContext, Record<number, Partial<MlbAssignmentAssessment>>>>;
  contextsAsked?: MlbAssignmentContext[];
  /** League-rule overrides for Rights (must match the view's, e.g. a lowered 40-man limit). */
  leagueOver?: Partial<Record<string, number | null>>;
  floors?: CoverageFloors;
  crossRole?: (playerId: number) => CrossRoleSupport;
  roleFit?: (playerId: number) => Partial<RoleFitEvidence>;
  philosophy?: Partial<PhilosophyValues>;
  performance?: (playerId: number) => PerformanceLine | null;
  /** Lens evidence by player for a role; the default is tools from `roleFit` and no results. */
  holderEvidence?: (playerId: number, role: RoleRef, opts?: { ignoreResults?: boolean }) => Partial<LensEvidence> | undefined;
  farm?: FarmConsequence | null;
}

export function fakePorts(opts: PortOptions): ResponsePorts {
  const rightsMap = rightsFor(opts.states, opts.evidence ?? CURRENT, opts.assignments, opts.leagueOver);
  return {
    rights: (ids) => new Map(ids.flatMap((id) => rightsMap.has(id) ? [[id, rightsMap.get(id)!] as const] : [])),
    floors: opts.floors ?? DEFAULT_COVERAGE_FLOORS,
    development: (ids, context) => {
      opts.contextsAsked?.push(context);
      const out = new Map<number, MlbAssignmentAssessment>();
      for (const id of ids) {
        const perContext = opts.developmentByContext?.[context];
        const d = perContext ? perContext[id] : opts.development?.[id];
        if (!d) continue;
        out.set(id, {
          playerId: id, level: 2, context, basis: context === 'durable_role' ? 'durable_discussion' : 'contextual',
          judgment: 'defensible', eligible: true, reasons: [], blockers: [], missingEvidence: [], contextual: null, ...d,
        } as MlbAssignmentAssessment);
      }
      return out;
    },
    crossRole: opts.crossRole ?? (() => ({ supported: 'yes', evidence: ['test'] })),
    roleFit: (id) => ({
      classification: 'viable', compositePercentile: 50, weakestCorePercentile: 40, unassessed: [],
      comparisonPopulation: 300, evidenceStatus: 'complete', notes: [], ...(opts.roleFit?.(id) ?? {}),
    }),
    performance: (id: number): PerformanceLine | null => opts.performance?.(id) ?? null,
    holderEvidence: (ids, role, o) => new Map(ids.map((id) => {
      const fit = opts.roleFit?.(id);
      const override = opts.holderEvidence?.(id, role, o);
      const base: LensEvidence = {
        ratingsPct: fit && 'compositePercentile' in fit ? (fit.compositePercentile as number | null) : 50, ratingsEvidence: 'complete',
        skillsPct: null, runsPct: null, sample: 0, sampleUnit: 'BF', reliability: 0, currentSample: null,
      };
      return [id, { ...base, ...(override ?? {}) }] as const;
    })),
    farm: (_id, _role, direction, affiliate): FarmConsequence | null => opts.farm !== undefined ? opts.farm : {
      direction, affiliate: { teamId: affiliate ?? 2, label: 'Reno', level: 2, levelName: 'AAA' },
      overall: { before: 'healthy', after: 'healthy' }, changes: [], issuesAfter: [], rosterNotes: [],
    },
    optionAffiliateTeamId: () => 2,
    philosophy: { promotionAggressiveness: 50, versatility: 50, ...opts.philosophy },
  };
}
