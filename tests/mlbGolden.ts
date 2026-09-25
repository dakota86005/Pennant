import { reviewNeedFor } from '../server/mlbReview';
import { buildResponsePacket, type ResponsePacket, type ResponseCandidate } from '../server/mlbResponses';
import type { LensEvidence } from '../server/roleReview';
import type { OrganizationContext } from '../server/staffPreference';
import { fakePorts, healthy26, mkState, viewOf, type PortOptions, type Spec } from './mlbFixtures';

/*
 * Shared scenario for the behavioral cases: a club whose fifth starter (id 104) is far below what a rotation takes, with Triple-A
 * arms who are clear upgrades on paper. Tests vary the context around it (the organization, the rights evidence, who is hurt) and
 * assert relationships, never the ranking of a named player.
 */

export const ev = (ratingsPct: number | null, skillsPct: number | null, runsPct: number | null, reliability = 0.75): LensEvidence => ({
  ratingsPct, ratingsEvidence: 'complete', skillsPct, runsPct, sample: 900, sampleUnit: 'BF', toolsWeight: 1, reliability, currentSample: 180, usage: [],
});

export const LENS: Record<number, LensEvidence> = {
  100: ev(60, 68, 60), 101: ev(55, 73, 77), 102: ev(50, 58, 36), 103: ev(47, 60, 40), 104: ev(20, 14, 15),
  105: ev(60, 70, 66), 106: ev(55, 60, 55), 107: ev(52, 55, 50), 108: ev(50, 55, 52), 109: ev(48, 50, 50), 110: ev(45, 48, 44), 111: ev(40, 42, 42), 112: ev(12, 8, 10),
  500: ev(64, 70, 68, 0.6), // a clear upgrade with a real record, a veteran
  501: ev(64, 70, 68, 0.6), // the same on paper, young
  502: ev(58, 45, 45, 0.6), // an upgrade on paper with tools ahead of his results
};

export const ARMS: Spec[] = [
  { id: 500, name: 'Reno Veteran', position: 1, role: 11, level: 2, forty: true, active: false, age: 36 },
  { id: 501, name: 'Reno Prospect', position: 1, role: 11, level: 2, forty: true, active: false, age: 23 },
  { id: 502, name: 'Reno Upside', position: 1, role: 11, level: 2, forty: true, active: false, age: 24 },
];

export interface Scenario {
  organization?: OrganizationContext | null;
  ports?: Partial<PortOptions>;
  /** Change a Spec of the healthy club (an injury, a service-time change). */
  mutate?: (s: Spec) => Spec;
  arms?: Spec[];
  /** Leave 25 of 26 active (a recall needs no clearing move). */
  room?: boolean;
  leagueOver?: Record<string, number | null>;
}

export function replacePacket(sc: Scenario = {}): ResponsePacket {
  const arms = sc.arms ?? ARMS;
  const specs = [...healthy26().filter((s) => !(sc.room && s.id === 125)).map(sc.mutate ?? ((s) => s)), ...arms];
  const view = viewOf(specs, sc.leagueOver);
  const base = fakePorts({
    states: specs.map(mkState), leagueOver: sc.leagueOver, assignments: Object.fromEntries(arms.map((a) => [a.id, 'optioned' as const])),
    development: Object.fromEntries(arms.map((a) => [a.id, {}])),
    roleFit: (id) => ({ compositePercentile: LENS[id]?.ratingsPct ?? null, weakestCorePercentile: 40 }), holderEvidence: (id) => LENS[id], ...sc.ports,
  });
  const ports = { ...base, organization: sc.organization ?? null };
  const need = reviewNeedFor(view, 104, ports)!;
  return buildResponsePacket(need, view, ports);
}

export const candidatesOf = (p: ResponsePacket): ResponseCandidate[] => p.groups.flatMap((g) => g.candidates);
export const candidate = (p: ResponsePacket, id: number): ResponseCandidate => candidatesOf(p).find((c) => c.playerId === id) as ResponseCandidate;

export const posture = (odds: number) => ({ posture: 'hold' as const, odds, gamesLeft: 100, deadlinePassed: false, headline: `${Math.round(odds * 100)}% to reach the postseason.` });
export const club = (dimensions: OrganizationContext['dimensions'], odds: number | null): OrganizationContext => ({ dimensions, posture: odds === null ? null : posture(odds) });

/** Organizations that lean every way the layer knows how to lean. */
export const CLUBS: Record<string, OrganizationContext | null> = {
  none: null,
  contending: club({ competitiveWindow: 90, riskTolerance: 30, ageCurveSensitivity: 20, upsidePreference: 20, defenseEmphasis: 50, rosterDepth: 30, pitchingDepth: 30 }, 0.85),
  building: club({ competitiveWindow: 10, riskTolerance: 80, ageCurveSensitivity: 85, upsidePreference: 85, defenseEmphasis: 50, rosterDepth: 80, pitchingDepth: 80 }, 0.1),
  conflicted: club({ competitiveWindow: 90, riskTolerance: 10, ageCurveSensitivity: 10, upsidePreference: 10, defenseEmphasis: 50, rosterDepth: 10, pitchingDepth: 10 }, 0.1),
  balanced: club({ competitiveWindow: 50, riskTolerance: 50, ageCurveSensitivity: 50, upsidePreference: 50, defenseEmphasis: 50, rosterDepth: 50, pitchingDepth: 50 }, null),
};
