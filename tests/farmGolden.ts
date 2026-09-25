/**
 * Shared synthetic evidence for the farm behavioral corpus.
 *
 * Nothing here comes from a real save, and nothing here names a real player. Each builder makes the
 * smallest piece of evidence a pure farm function needs, so a case can state one baseball invariant
 * and vary one thing.
 */

import { syntheticScoutedAbility } from '../server/scoutedEvidence.js';
import { evaluateDevelopmentProtection, type DevelopmentProtection } from '../server/developmentFit.js';
import { startingLines } from '../server/developmentFit.js';
const STARTING = startingLines('not_measured');
import type { CurrentAssignmentInput } from '../server/currentAssignment.js';
import type { JobWindow, UsageFacts } from '../server/playingTime.js';
import type { Absence, ClubGameLog, GameLine } from '../server/farmUsage.js';
import { moundStarters, positionStarters, recentUsageFor, type RecentUsage } from '../server/farmRecentUsage.js';
import type { FarmProduction } from '../server/farmResults.js';
import type { AlternativeAssignment } from '../server/farmAssignments.js';
import type { Vacancy } from '../server/farmCascade.js';

/** The adapter's own synthetic ability, so the tests exercise the real branded type. */
export const ability = (current: number | null, potential: number | null) =>
  syntheticScoutedAbility({ current, potential });

/** Player Development's protection, from the real evaluator so the tiers are the real ones. */
export const protectionOf = (age: number, current: number | null, potential: number | null): DevelopmentProtection =>
  evaluateDevelopmentProtection({ lines: STARTING,  age, ability: ability(current, potential) });

/** A tier by name, for a case that is about the tier rather than about the ratings behind it. */
export const tierOf = (tier: DevelopmentProtection['tier']): DevelopmentProtection => ({
  tier,
  manuallyProtected: false,
  ratingEvidence: tier === null ? 'unknown' : 'complete',
  missingEvidence: tier === null ? [{ dimension: 'current_ability', detail: 'no visible current grade' }] : [],
  reasons: [],
  reading: null,
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

/* ── a synthetic game log ────────────────────────────────────────────────────────────────────── */

const isoDay = (first: string, offset: number): string =>
  new Date(Date.parse(`${first}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

/** A club that has played `games` games, one a day from `firstDay`. Game `i` is day `i`. */
export const clubLog = (games: number, teamId = 10, firstDay = '2030-04-01'): ClubGameLog => ({
  teamId,
  available: true,
  games: Array.from({ length: games }, (_, i) => ({ gameId: 1000 + i, date: isoDay(firstDay, i) })),
  lines: new Map(),
});

/** The date of game `i` of a log built by `clubLog`. */
export const dayOf = (log: ClubGameLog, game: number): string => log.games[game].date;

const lineIn = (log: ClubGameLog, playerId: number, game: number): GameLine => {
  const mine = log.lines.get(playerId) ?? [];
  if (!log.lines.has(playerId)) log.lines.set(playerId, mine);
  let line = mine.find((l) => l.game === game);
  if (!line) {
    line = { game, started: false, position: null, plateAppearances: 0, pitched: false, pitchingStart: false, outs: 0 };
    mine.push(line);
    mine.sort((a, b) => a.game - b.game);
  }
  return line;
};

/** He started in the field at `position` in each of these games (indexes into the SEASON, not the window). */
export function startsAt(log: ClubGameLog, playerId: number, position: string, games: readonly number[]): void {
  for (const game of games) Object.assign(lineIn(log, playerId, game), { started: true, position, plateAppearances: 4 });
}

/** He came off the bench in each of these games. */
export function offTheBench(log: ClubGameLog, playerId: number, games: readonly number[]): void {
  for (const game of games) Object.assign(lineIn(log, playerId, game), { started: false, position: null, plateAppearances: 1 });
}

/** He started on the mound in each of these games. */
export function startsOnMound(log: ClubGameLog, playerId: number, games: readonly number[], outs = 18): void {
  for (const game of games) Object.assign(lineIn(log, playerId, game), { pitched: true, pitchingStart: true, outs });
}

/** He relieved in each of these games. */
export function relieves(log: ClubGameLog, playerId: number, games: readonly number[], outs = 3): void {
  for (const game of games) Object.assign(lineIn(log, playerId, game), { pitched: true, pitchingStart: false, outs });
}

/** `from` up to but not including `to`. */
export const span = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

/** Every `step`-th game from `from`: a rotation turn. */
export const everyFifth = (from: number, to: number, step = 5): number[] => span(from, to).filter((g) => (g - from) % step === 0);

/** One man's recent usage from a log. With no options he has been on the club all year and the log could be read. */
export const recentOf = (
  log: ClubGameLog,
  playerId: number,
  opts: { arrivedOn?: string; from?: string | null; chronology?: boolean; lastGameElsewhere?: string | null; absences?: Absence[] } = {}
): RecentUsage =>
  recentUsageFor({
    log,
    playerId,
    arrival: opts.arrivedOn ? { date: opts.arrivedOn, from: opts.from ?? null } : null,
    chronologyAvailable: opts.chronology ?? true,
    lastGameElsewhere: opts.lastGameElsewhere ?? null,
    absences: opts.absences ?? [],
  }) as RecentUsage;

/** What the log says about one job: a position code, or `rotation`. */
export const jobWindowOf = (log: ClubGameLog, job: string, departed: JobWindow['departed'] = []): JobWindow => ({
  starters: job === 'rotation' ? moundStarters(log) : positionStarters(log, job),
  departed,
});
