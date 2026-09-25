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
import {
  AGING_METHOD, DEFENSE_METHOD, MLB_CALIBRATION_SUBSYSTEM, STANDARDS_METHOD,
  type AgingModel, type DefenseModel, type StandardsModel,
} from './mlbCalibrationFit.js';

export type YardstickKey = 'standards' | 'aging' | 'defense';

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
  /** The last attempt, when it was not adopted: its reason (the fit in force stays). */
  lastAttempt: { basis: string; reason: string } | null;
}

export interface RosterReviewCalibration {
  leagueId: number | null;
  standards: RoleStandardsSet;
  review: ReviewCalibration;
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
};

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '?' : `${Math.round(x * 100)}`);

/** Why a fit is not in use, in a GM's words (the reasons in the record are for the API). */
export function plainReason(stored: StoredCalibration | null): string {
  if (!stored) return 'this league has not been measured yet';
  const failures = stored.record.gate.failures;
  const first = failures[0] ?? '';
  if (first === 'clubs') return 'too few clubs have a settled lineup yet';
  if (first === 'games') return "it is too early in the season to tell who the regulars are";
  if (first === 'sample' || /past seasons could not be checked|no season could be held out/.test(first)) return 'not enough seasons in this league yet';
  if (first === 'no_zone_rating_pairs') return "this league's past seasons have no fielding runs to measure it on yet";
  if (/no later season/.test(first)) return 'there is no later season to check it on yet';
  return "the league's own ones did not hold up when checked";
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
  const bands = s.record.heldOut.filter((c) => c.kind === 'age_band' && c.passed !== null);
  return `From ${s.record.window.sample} pairs of back-to-back seasons in this league${seasons.length ? ` (${seasons[0]}–${seasons[seasons.length - 1]})` : ''}. `
    + `Checked on ${bands.length ? 'seasons it had not seen, one at a time' : 'no held back seasons'}: `
    + `${bands.every((b) => b.passed) ? 'close to what actually happened at every age with enough players' : 'off at some ages'}.`;
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
  if (leagueId === null) return assemble(null, null, null, null, [null, null, null]);
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
      const adopted = adoptedCalibration<M>(leagueId, MLB_CALIBRATION_SUBSYSTEM, component, method, through ?? -1);
      const latest = latestCalibrationAttempt<M>(leagueId, MLB_CALIBRATION_SUBSYSTEM, component, method);
      // A measurement from an export later than the one imported now (a reverted save) is never served
      const usable = adopted && (component !== 'standards' || (adopted.gameDate !== null && today !== null && adopted.gameDate <= today)) ? adopted : null;
      return { adopted: usable, latest };
    } catch {
      return { adopted: null, latest: null };
    }
  };
  const standards = read<StandardsModel>('standards', STANDARDS_METHOD);
  const aging = read<AgingModel>('aging', AGING_METHOD);
  const defense = read<DefenseModel>('defense', DEFENSE_METHOD);
  return assemble(leagueId, standards.adopted, aging.adopted, defense.adopted, [standards.latest, aging.latest, defense.latest]);
}

function group(key: YardstickKey, adopted: StoredCalibration | null, latest: StoredCalibration | null, describe: (s: never) => string): YardstickGroup {
  const shown = adopted ?? null;
  const failedLater = latest && !latest.adopted && (!adopted || latest.basis !== adopted.basis) ? { basis: latest.basis, reason: latest.reason } : null;
  return {
    key, what: WHAT[key], source: shown ? 'save' : 'starting',
    text: shown ? `${WHAT[key]}: ${describe(shown as never)}` : `${WHAT[key]}: the starting values, because ${plainReason(latest)}.`,
    method: (shown ?? latest)?.method ?? '',
    basis: shown ? shown.record.basis : null,
    window: shown ? { seasons: shown.record.window.seasons, sample: shown.record.window.sample, unit: shown.record.window.unit } : null,
    heldOut: shown?.record.heldOut ?? latest?.record.heldOut ?? [],
    priorWeight: shown ? shown.record.priorWeight.overall : null,
    gate: (shown ?? latest) ? { passed: (shown ?? latest)!.record.gate.passed, reason: (shown ?? latest)!.record.gate.reason } : null,
    refittedOn: shown?.gameDate ?? null,
    lastAttempt: failedLater,
  };
}

function assemble(
  leagueId: number | null, standards: StoredCalibration<StandardsModel> | null, aging: StoredCalibration<AgingModel> | null, defense: StoredCalibration<DefenseModel> | null,
  latest: Array<StoredCalibration | null>,
): RosterReviewCalibration {
  const groups = [
    group('standards', standards, latest[0], describeStandards),
    group('aging', aging, latest[1], describeAging),
    group('defense', defense, latest[2], describeDefense),
  ];
  const own = groups.filter((g) => g.source === 'save');
  const through = aging?.throughSeason ?? defense?.throughSeason ?? (standards ? standards.record.basis.throughSeason : null);
  let line: string;
  if (own.length === groups.length) line = `Yardsticks set from this league's own seasons${through !== null ? ` (through ${through})` : ''}`;
  else if (own.length > 0) line = "Some yardsticks set from this league's own seasons; others are starting values";
  else {
    const failed = latest.some((l) => l && !l.adopted && plainReason(l) === "the league's own ones did not hold up when checked");
    line = failed ? "Using starting yardsticks: the league's own ones did not hold up when checked" : 'Using starting yardsticks: not enough seasons in this league yet';
  }
  const tip = [
    'The roster review judges each player against yardsticks: what a regular at his job typically looks like, how players his age tend to change, and how much the glove counts at his position.',
    ...groups.map((g) => g.text),
    'Starting values are the ones Pennant ships with. They are replaced by this league\'s own only after those have been checked against players and seasons they were not drawn from.',
  ].join('\n\n');
  return {
    leagueId,
    standards: standardsFrom(standards?.model.served),
    review: { aging: aging?.model.table ?? null, defenseWeights: defense?.model.weights ?? null },
    groups, line, tip,
  };
}
