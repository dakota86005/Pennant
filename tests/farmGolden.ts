/**
 * Shared synthetic evidence for the farm behavioral corpus.
 *
 * Nothing here comes from a real save, and nothing here names a real player. Each builder makes the
 * smallest piece of evidence a pure farm function needs, so a case can state one baseball invariant
 * and vary one thing.
 */

import { syntheticScoutedAbility } from '../server/scoutedEvidence.js';
import { evaluateDevelopmentProtection, type DevelopmentProtection } from '../server/developmentFit.js';
import type { CurrentAssignmentInput } from '../server/currentAssignment.js';
import type { UsageFacts } from '../server/playingTime.js';
import type { FarmProduction } from '../server/farmResults.js';
import type { AlternativeAssignment } from '../server/farmAssignments.js';
import type { Vacancy } from '../server/farmCascade.js';

/** The adapter's own synthetic ability, so the tests exercise the real branded type. */
export const ability = (current: number | null, potential: number | null) =>
  syntheticScoutedAbility({ current, potential });

/** Player Development's protection, from the real evaluator so the tiers are the real ones. */
export const protectionOf = (age: number, current: number | null, potential: number | null): DevelopmentProtection =>
  evaluateDevelopmentProtection({ age, ability: ability(current, potential) });

/** A tier by name, for a case that is about the tier rather than about the ratings behind it. */
export const tierOf = (tier: DevelopmentProtection['tier']): DevelopmentProtection => ({
  score: tier === null ? null : 50,
  tier,
  manuallyProtected: false,
  ratingEvidence: tier === null ? 'unknown' : 'complete',
  missingEvidence: tier === null ? [{ dimension: 'current_ability', detail: 'no visible current grade' }] : [],
  reasons: [],
});

export const currentInput = (overrides: Partial<CurrentAssignmentInput> = {}): CurrentAssignmentInput => ({
  leaguePercentile: 50,
  reliability: 0.5,
  unassessable: null,
  ageRelativeToLevel: 0,
  tier: 'normal',
  missingEvidence: [],
  canDemote: true,
  ...overrides,
});

export const usage = (overrides: Partial<UsageFacts> = {}): UsageFacts => ({
  playerId: 1,
  name: 'A Player',
  age: 22,
  clubGames: 100,
  games: 90,
  inningsByPosition: {},
  starts: 0,
  reliefAppearances: 0,
  inningsPitched: 0,
  tier: 'development_priority',
  rehab: false,
  ...overrides,
});

export const production = (overrides: Partial<FarmProduction> = {}): FarmProduction => ({
  playerId: 1,
  kind: 'hitter',
  teamId: 10,
  level: 3,
  leagueId: 300,
  leagueName: 'A League',
  aboveLeague: 0,
  percentile: 50,
  rates: { woba: 0.32, ops: 0.75, era: null, peripherals: null, strikeoutRate: 0.2, walkRate: 0.08 },
  leagueContext: { woba: 0.32, era: 4.2 },
  sample: { opportunities: 300, clubGames: 100, reliability: 0.55, mature: true },
  unassessable: null,
  ...overrides,
});

export const alternative = (overrides: Partial<AlternativeAssignment> = {}): AlternativeAssignment => ({
  kind: 'normal_promotion',
  direction: 'promotion',
  level: 2,
  levelName: 'AAA',
  teams: [{ teamId: 20, label: 'Higher Club' }],
  judgment: 'defensible',
  preference: 'acceptable',
  blockers: [],
  missingEvidence: [],
  destinationOpportunity: { teamId: 20, job: 'SS', open: true, detail: 'Higher Club has room at SS.' },
  ...overrides,
});

export const vacancy = (overrides: Partial<Vacancy> = {}): Vacancy => ({
  teamId: 10,
  team: 'A Club',
  level: 3,
  levelName: 'AA',
  job: { kind: 'rotation' },
  after: 4,
  floor: 5,
  absorbed: false,
  detail: '4 of the 5 it needs at a rotation spot remain.',
  ...overrides,
});
