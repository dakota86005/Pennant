/**
 * The roster review's yardsticks in force for a save (D-053, cycle 1): the role standards, the aging curve and the glove weights
 * the save has measured and checked (`save_calibration_fits`), else the built-in starting values, with a plain account of which
 * is which. MLB Operations reads them here; the fitting and the reads behind it live in `mlbCalibrationRefit.ts` (the refit worker's).
 *
 * A fit is served only when adopted (it passed its checks), never through a season the league has not completed, and a standards
 * measurement never from an export later than the one now imported (a reverted save). What is visible is one short line; the
 * detail (what each group is, where it comes from, how it held up on seasons or clubs it had not seen) is the hover's, in plain words.
 */

import { adoptedCalibration, latestCalibrationAttempt, type CalibrationCheck, type StoredCalibration } from './saveCalibrationStore.js';
import { onCalibrationRecorded } from './saveCalibration.js';
import { completedThrough, leagueGameDate } from './saveIdentity.js';
import { standardsFrom, type RoleStandardsSet } from './roleStandards.js';
import type { ReviewCalibration } from './roleReview.js';
import { RESULTS_PRIOR, type ResultsParams } from './resultsMetrics.js';
import { paramsOf, REQUIRED_PARTS, RESULTS_METHOD, type ResultsModel } from './mlbResultsFit.js';
import {
  AGING_METHOD, DEFENSE_METHOD, MLB_CALIBRATION_SUBSYSTEM, STANDARDS_METHOD,
  type AgingModel, type DefenseModel, type StandardsModel,
} from './mlbCalibrationFit.js';

export type YardstickKey = 'standards' | 'aging' | 'defense' | 'results';

export interface YardstickGroup {
  key: YardstickKey;
  /** What the group sets, in a GM's words. */
  what: string;
  source: 'save' | 'starting';
  /** One plain sentence: where the numbers come from and, for the save's own, how they held up. For the hover. */
  text: string;
  /** The run record's facts, for the API: the basis, the window, the checks, the share still the starting values, the verdict. */
  method: string;
  basis: { throughSeason: number | null; gameDate: string | null } | null;
  window: { seasons: number[]; sample: number; unit: string } | null;
  heldOut: CalibrationCheck[];
  priorWeight: number | null;
  gate: { passed: boolean; reason: string } | null;
  /** The game date of the export the fit in force was made on. */
  refittedOn: string | null;
  /** Why the starting values serve, when they do (null for the save's own). */
  reason: StartingReason | null;
  /** The last attempt, when it was not adopted: its reason (the fit in force stays). */
  lastAttempt: { basis: string; reason: string } | null;
}

export interface RosterReviewCalibration {
  leagueId: number | null;
  standards: RoleStandardsSet;
  review: ReviewCalibration;
  /** The results lens's season weights and stabilization in force: the save's own where adopted, else the starting values. */
  results: ResultsParams;
  groups: YardstickGroup[];
  /** The one visible line. */
  line: string;
  /** The hover: one plain sentence per group, then what the line means. */
  tip: string;
}

const WHAT: Record<YardstickKey, string> = {
  standards: 'The line for each job',
  aging: 'How players age',
  defense: 'How much the glove counts at each position',
  results: 'How much recent seasons count',
};

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '?' : `${Math.round(x * 100)}`);

/** Why a group serves the starting values: each reason is one the line may give, and only when it is the true one. */
export type StartingReason =
  | 'not_measured' | 'no_league' | 'games' | 'games_unknown' | 'clubs' | 'seasons' | 'no_zone_rating' | 'no_later_season' | 'check_failed'
  | 'kept' | 'returned';

/** Each reason in a GM's words (the record's reasons are for the API). */
export const REASON_TEXT: Record<StartingReason, string> = {
  not_measured: 'this league has not been measured yet',
  no_league: 'this club has no major league in the export',
  games: 'it is too early in the season to tell who the regulars are',
  games_unknown: 'the export does not say how many games the clubs have played',
  clubs: 'too few clubs have a settled lineup to measure',
  seasons: 'not enough seasons in this league yet',
  no_zone_rating: "this league's past seasons have no fielding runs to measure the glove on",
  no_later_season: 'there is no later season to check them on yet',
  check_failed: "the league's own ones did not hold up when checked",
  kept: "they were checked on this league's seasons and held up",
  returned: "they did better than this league's own when checked again",
};

/**
 * Whether an adopted fit serves the save's own values. A fitted tuning value (the aging curve, the season weights) is adopted with its
 * verdict, and the verdict may be that the starting values held up (D-053 amendment, 2026-09-25); a measurement serves when adopted.
 */
export function servesOwn(key: YardstickKey, stored: StoredCalibration | null): boolean {
  if (!stored?.adopted) return false;
  if (key === 'aging') {
    const m = stored.model as AgingModel;
    return m.serve?.hitter === 'save' || m.serve?.pitcher === 'save';
  }
  if (key === 'results') {
    const m = stored.model as ResultsModel;
    return REQUIRED_PARTS.some((p) => m.parts?.[p]?.source === 'save');
  }
  return true;
}

/** Why an adopted verdict serves the starting values: they held up, or they did better when checked again. */
function keptReason(key: YardstickKey, stored: StoredCalibration): StartingReason {
  if (key === 'aging') {
    const m = stored.model as AgingModel;
    return m.decisions?.hitter?.previous === 'save' || m.decisions?.pitcher?.previous === 'save' ? 'returned' : 'kept';
  }
  if (key === 'results') return REQUIRED_PARTS.some((p) => (stored.model as ResultsModel).parts?.[p]?.reason === 'returned') ? 'returned' : 'kept';
  return 'kept';
}

/** Why the last attempt was not adopted (or that there was none), from its record's first failure. */
export function reasonOf(stored: StoredCalibration | null): StartingReason {
  if (!stored) return 'not_measured';
  const first = stored.record.gate.failures[0] ?? '';
  if (first === 'clubs') return 'clubs';
  if (first === 'games') return 'games';
  if (first === 'games_unknown') return 'games_unknown';
  if (first === 'sample' || first.startsWith('seasons:')) return 'seasons';
  if (first === 'no_zone_rating_pairs') return 'no_zone_rating';
  if (first.startsWith('no_later_season')) return 'no_later_season';
  return 'check_failed';
}

/** Why a fit is not in use, in a GM's words. */
export function plainReason(stored: StoredCalibration | null): string {
  return REASON_TEXT[reasonOf(stored)];
}

function describeStandards(s: StoredCalibration<StandardsModel>): string {
  const split = s.record.heldOut.filter((c) => c.kind === 'club_split' && c.part.startsWith('estimate:') && c.part.endsWith(':floor'));
  const hist = s.record.heldOut.filter((c) => c.kind === 'history' && c.part.endsWith(':floor') && c.passed !== null);
  const avg = (cs: CalibrationCheck[]) => (cs.length ? cs.reduce((a, c) => a + (c.observed ?? 0) * c.n, 0) / cs.reduce((a, c) => a + c.n, 0) : null);
  const seasons = s.record.window.seasons;
  return `Measured from every club's regulars and pitchers as of ${s.gameDate ?? 'this export'} (${s.record.window.sample} players). `
    + `Lines drawn from half the clubs left about ${pct(avg(split))} in 100 of the other half's players under them, where 10 is the aim; `
    + `drawn the same way from each of this league's past seasons${seasons.length ? ` (${seasons[0]}–${seasons[seasons.length - 1]})` : ''}, `
    + `they left about ${pct(avg(hist))} in 100 of the next season's regulars under them. Each part of a player's case (his tools, his results) has its own line.`;
}

function describeAging(s: StoredCalibration<AgingModel>): string {
  const seasons = s.record.window.seasons;
  const bands = s.record.heldOut.filter((c) => c.kind === 'age_band' && c.passed !== null && !c.part.startsWith('unshrunk:'));
  const kept = (['hitter', 'pitcher'] as const).filter((k) => s.model.serve?.[k] !== 'save');
  return `From ${s.record.window.sample} pairs of back-to-back seasons in this league${seasons.length ? ` (${seasons[0]}–${seasons[seasons.length - 1]})` : ''}. `
    + `Checked one season at a time on seasons it had not seen: close to what actually happened in each of ${bands.length} age group${bands.length === 1 ? '' : 's'} with enough players, and clearly better than the starting curve`
    + `${kept.length ? `. For ${kept.map((k) => `${k}s`).join(' and ')} the starting curve held up and still serves` : ''}.`;
}

function describeResults(s: StoredCalibration<ResultsModel>): string {
  const seasons = s.record.window.seasons;
  const label: Record<string, string> = { hitter: 'hitters', starter: 'starting pitchers', reliever: 'relievers' };
  const own = REQUIRED_PARTS.filter((p) => s.model.parts[p]?.source === 'save').map((p) => label[p]);
  const kept = REQUIRED_PARTS.filter((p) => s.model.parts[p]?.source !== 'save').map((p) => label[p]);
  return `How much a player's last three seasons count, and how much playing time it takes before his results count as much as his tools. `
    + `From ${s.record.window.sample.toLocaleString('en-US')} player-seasons in this league${seasons.length ? ` (${seasons[0]}–${seasons[seasons.length - 1]})` : ''}, `
    + `checked one season at a time on seasons they had not seen: this league's own were clearly better for ${own.join(' and ')}`
    + `${kept.length ? `; for ${kept.join(' and ')} the starting values held up and still serve` : ''}.`;
}

function describeDefense(s: StoredCalibration<DefenseModel>): string {
  return `From how steady each position's fielding runs were from one season to the next in this league (${s.record.window.seasons.join(', ')}), checked on the season after.`;
}

const cache = new Map<string, RosterReviewCalibration>();
onCalibrationRecorded(() => cache.clear());

/** Forget the cached yardsticks: an import changed the export, or a refit recorded new ones. */
export function clearRosterReviewCalibrationCache(): void {
  cache.clear();
}

/** The yardsticks in force for a league (the configured organization's major league); the starting values for none. */
export function rosterReviewCalibration(leagueId: number | null): RosterReviewCalibration {
  const key = String(leagueId);
  const hit = cache.get(key);
  if (hit) return hit;
  const result = compute(leagueId);
  cache.set(key, result);
  return result;
}

function compute(leagueId: number | null): RosterReviewCalibration {
  if (leagueId === null) return assemble(null, null, null, null, null, [null, null, null, null]);
  let through: number | null = null;
  let today: string | null = null;
  try {
    through = completedThrough(leagueId).season;
    today = leagueGameDate(leagueId);
  } catch {
    // An export without the league's season: nothing can be served but the starting values
  }
  const read = <M>(component: YardstickKey, method: string) => {
    try {
      // Never through a season the league has not completed, nor a measurement from a later export than today's (a reverted save):
      // the latest usable one is found in the store itself. An unknown date today admits no dated measurement.
      const bound = { throughMax: through ?? -1, gameDateMax: today ?? 'not established' };
      const adopted = adoptedCalibration<M>(leagueId, MLB_CALIBRATION_SUBSYSTEM, component, method, bound);
      const latest = latestCalibrationAttempt<M>(leagueId, MLB_CALIBRATION_SUBSYSTEM, component, method, bound);
      return { adopted, latest };
    } catch {
      return { adopted: null, latest: null };
    }
  };
  const standards = read<StandardsModel>('standards', STANDARDS_METHOD);
  const aging = read<AgingModel>('aging', AGING_METHOD);
  const defense = read<DefenseModel>('defense', DEFENSE_METHOD);
  const results = read<ResultsModel>('results', RESULTS_METHOD);
  return assemble(leagueId, standards.adopted, aging.adopted, defense.adopted, results.adopted, [standards.latest, aging.latest, defense.latest, results.latest]);
}

function group(key: YardstickKey, adopted: StoredCalibration | null, latest: StoredCalibration | null, describe: (s: never) => string, noLeague = false): YardstickGroup {
  // A verdict that the starting values held up is adopted too: it serves them, and says they were checked on this league
  const own = servesOwn(key, adopted);
  const shown = own ? adopted : null;
  // The verdict in force gives the reason (a later attempt that could not decide is the API's `lastAttempt`, never the reason)
  const reason: StartingReason | null = own ? null : noLeague ? 'no_league' : adopted ? keptReason(key, adopted) : reasonOf(latest);
  const current = adopted ?? latest;
  const failedLater = latest && !latest.adopted && (!adopted || latest.basis !== adopted.basis) ? { basis: latest.basis, reason: latest.reason } : null;
  return {
    key, what: WHAT[key], source: own ? 'save' : 'starting',
    text: own ? `${WHAT[key]}: ${describe(shown as never)}` : `${WHAT[key]}: the starting values, because ${REASON_TEXT[reason as StartingReason]}.`,
    reason,
    method: current?.method ?? '',
    basis: adopted ? adopted.record.basis : null,
    window: adopted ? { seasons: adopted.record.window.seasons, sample: adopted.record.window.sample, unit: adopted.record.window.unit } : null,
    heldOut: current?.record.heldOut ?? [],
    priorWeight: adopted ? adopted.record.priorWeight.overall : null,
    gate: current ? { passed: current.record.gate.passed, reason: current.record.gate.reason } : null,
    refittedOn: adopted?.gameDate ?? null,
    lastAttempt: failedLater,
  };
}

function assemble(
  leagueId: number | null, standards: StoredCalibration<StandardsModel> | null, aging: StoredCalibration<AgingModel> | null, defense: StoredCalibration<DefenseModel> | null,
  results: StoredCalibration<ResultsModel> | null, latest: Array<StoredCalibration | null>,
): RosterReviewCalibration {
  const noLeague = leagueId === null;
  const groups = [
    group('standards', standards, latest[0], describeStandards, noLeague),
    group('aging', aging, latest[1], describeAging, noLeague),
    group('defense', defense, latest[2], describeDefense, noLeague),
    group('results', results, latest[3], describeResults, noLeague),
  ];
  const own = groups.filter((g) => g.source === 'save');
  const through = aging?.throughSeason ?? results?.throughSeason ?? defense?.throughSeason ?? (standards ? standards.record.basis.throughSeason : null);
  let line: string;
  if (own.length === groups.length) line = `Yardsticks set from this league's own seasons${through !== null ? ` (through ${through})` : ''}`;
  else if (own.length > 0) line = "Some yardsticks are this league's own; others are starting values";
  else if (groups.every((g) => g.reason === 'not_measured')) line = `Using starting yardsticks for now: ${REASON_TEXT.not_measured}`;
  else {
    // The line gives the reason of the first yardstick in the order a GM meets them (the line for each job, then aging, then the
    // glove): always a true reason, never a guessed one; the hover gives each yardstick's own.
    const first = groups.find((g) => g.reason !== null) as YardstickGroup;
    line = `Using starting yardsticks: ${REASON_TEXT[first.reason as StartingReason]}`;
  }
  const tip = [
    'The roster review judges each player against yardsticks: what a regular at his job typically looks like, how players his age tend to change, how much the glove counts at his position, and how much his recent seasons count against his tools.',
    ...groups.map((g) => g.text),
    'Starting values are the ones Pennant ships with. They are replaced by this league\'s own only after those have been checked against players and seasons they were not drawn from, and, for how players age and how much recent seasons count, only where this league\'s own did clearly better than the starting values there.',
  ].join('\n\n');
  return {
    leagueId,
    standards: standardsFrom(standards?.model.served),
    review: { aging: servesOwn('aging', aging) ? (aging as StoredCalibration<AgingModel>).model.table : null, defenseWeights: defense?.model.weights ?? null },
    results: servesOwn('results', results) ? paramsOf((results as StoredCalibration<ResultsModel>).model, (results as StoredCalibration<ResultsModel>).basis) : RESULTS_PRIOR,
    groups, line, tip,
  };
}
