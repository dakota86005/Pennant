/**
 * Farm & Development's views, read and worded (N10; SWIFTUI_REBUILD.md section 4.2): Minor League Operations'
 * organization (`computeFarmSystem`), Player Development's prospect calls (`computeProspects`) and scouted development
 * (`computeScoutedDevelopment`), and this save's rating history (`developmentHistoryFor`, keyed by the save, D-064), each
 * through its public module, handed to the pure adapters in `presentation/farm/`. The service (`farmViewService.ts`)
 * runs it in the Front Office's worker thread, so no request waits behind it.
 *
 * One `FarmSession` serves the whole build (D-047: the organization read once, for this build and never longer), and the
 * decisions worked out ahead (the players the desk raises, and every assignment in question) share it. Any other player's decision is read on the click.
 */
import { catalogClubs, computeProspects } from './org.js';
import type { DeptId } from './contract/presentation.js';
import { getDataStatus } from './dataStatus.js';
import { farmConsequenceFor, type FarmConsequenceV2 } from './farmConsequence.js';
import { computeFarmSystem, openFarmSession, type FarmSession, type FarmSystemView } from './farmOperations.js';
import { developmentHistoryFor } from './history.js';
import { servedDepartments } from './presentation/catalog.js';
import { cell } from './presentation/claim.js';
import { farmDecision, farmViews, type FarmContext, type FarmViews } from './presentation/farm/index.js';
import type { HistoryRowInput, ProspectInput } from './presentation/farm/input.js';
import type { FarmDecisionView } from './presentation/farm/types.js';
import { computeScoutedDevelopment } from './scoutedDevelopment.js';
import { loadSettings } from './settings.js';
import { LEVEL_NAMES, ratingScaleMax } from './valuation.js';

/** What one build of the farm's views is asked for. */
export interface FarmViewsRequest {
  orgId: number;
  importStamp: string | null;
  reportStamp: string;
}

/** What a build hands back (plain data, so a worker can post it). */
export interface FarmViewsResult {
  views: FarmViews;
  /** Minor League Operations' answer, kept so a decision read on the click words from the same reading. */
  system: FarmSystemView;
  /** How long each part took, in milliseconds. */
  ms: Record<string, number>;
}

/** One decision asked on the click: the player, and the reading of the build it belongs to. */
export interface FarmDecisionRequest extends FarmViewsRequest {
  playerId: number;
  system: FarmSystemView;
}

const FARM: DeptId = 'farm';

/**
 * The players a decision is worked out for ahead: every player the farm's attention list raises (the desk's), then every
 * assignment in question (the ones the Assignments view opens on). They share the build's session, so each costs a few
 * milliseconds; a routine assignment's decision is read on the click.
 */
export function decidedAhead(system: FarmSystemView): number[] {
  const raised = system.attention.flatMap((a) => (a.target.kind === 'player' ? [a.target.playerId] : []));
  const inQuestion = system.assignments.filter((a) => a.attention !== 'routine').map((a) => a.playerId);
  return [...new Set([...raised, ...inQuestion])].filter((id) => system.assignments.some((a) => a.playerId === id));
}

function contextFor(request: FarmViewsRequest): FarmContext {
  const status = getDataStatus({ importedAt: request.importStamp });
  const farm = servedDepartments(request.orgId).find((d) => d.id === FARM);
  return {
    orgId: request.orgId,
    importStamp: request.importStamp,
    reportStamp: request.reportStamp,
    gameDate: status.csv.simulatedThrough ?? status.csv.currentDate,
    preparedBy: farm?.preparedBy ?? cell('Prepared by the minor league staff'),
    department: FARM,
  };
}

/** A departure's consequence, or why it could not be read this time (the raw error to the log). */
function consequenceOf(orgId: number, playerId: number, session: FarmSession): FarmConsequenceV2 | { problem: string } {
  try {
    return farmConsequenceFor(orgId, playerId, session);
  } catch (err) {
    console.error(`[farm] the consequence for player ${playerId} could not be read:`, err);
    return { problem: 'What follows if he moves couldn\'t be read this time.' };
  }
}

export function buildFarmViews(request: FarmViewsRequest): FarmViewsResult {
  const ms: Record<string, number> = {};
  const timed = <T>(name: string, run: () => T): T => {
    const started = performance.now();
    try {
      return run();
    } finally {
      ms[name] = Math.round((performance.now() - started) * 10) / 10;
    }
  };
  const ctx = contextFor(request);
  const session = openFarmSession(request.orgId);
  const system = timed('farmSystem', () => computeFarmSystem(request.orgId, session));
  const prospectsRaw = timed('prospects', () => computeProspects(request.orgId));
  const prospects = [...prospectsRaw.batters, ...prospectsRaw.pitchers] as ProspectInput[];
  const scouted = timed('scoutedDevelopment', () => computeScoutedDevelopment(request.orgId));
  const historyRaw = timed('history', () => developmentHistoryFor(request.orgId));
  const history = {
    snapshots: historyRaw.snapshots,
    dates: historyRaw.dates,
    observationDays: historyRaw.observationDays,
    rows: historyRaw.rows.map((r): HistoryRowInput => ({ ...r, levelName: LEVEL_NAMES[r.level] ?? `Level ${r.level}` })),
    ratingModeSwitches: historyRaw.ratingModeSwitches.map((s) => ({ text: s.text })),
    history: historyRaw.history,
  };
  const consequences = new Map<number, FarmConsequenceV2 | { problem: string }>();
  timed('decisionsAhead', () => {
    for (const playerId of decidedAhead(system)) consequences.set(playerId, consequenceOf(request.orgId, playerId, session));
  });
  const club = catalogClubs().find((c) => c.team_id === request.orgId) ?? null;
  const views = timed('words', () => farmViews({
    ctx,
    system,
    majorLeague: club ? { teamId: club.team_id, name: club.label, league: null, activePlayers: null } : null,
    prospects,
    scouted,
    history,
    rating: { scaleMax: ratingScaleMax(), roundToFive: loadSettings().roundRatingsToFive === true },
    consequences,
  }));
  return { views, system, ms };
}

/** One player's Decision read on the click (in the worker): his consequence, worded from the build's reading. */
export function buildFarmDecision(request: FarmDecisionRequest): FarmDecisionView | null {
  if (!request.system.assignments.some((a) => a.playerId === request.playerId)) return null;
  const session = openFarmSession(request.orgId);
  const consequence = consequenceOf(request.orgId, request.playerId, session);
  return farmDecision(contextFor(request), request.system, request.playerId, consequence);
}
