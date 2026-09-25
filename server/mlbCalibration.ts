/**
 * The roster review's yardsticks in force for a save (D-053, cycle 1): the role standards, the aging curve and the glove weights
 * the save has measured and checked (`save_calibration_fits`), else the built-in starting values, with a plain account of which
 * is which. MLB Operations reads them here; the fitting and the reads behind it live in `mlbCalibrationRefit.ts` (the refit worker's).
 *
 * A fit is served only when adopted (it passed its checks), never through a season the league has not completed, and a standards
 * measurement never from an export later than the one now imported (a reverted save). What is visible is one short line; the
 * detail (what each group is, where it comes from, how it held up on seasons or clubs it had not seen) is the hover's, in plain words.
 */

import { hitterToolsWeightFor, toolsParamsFor } from './toolsCalibration.js';
import { TOOLS_METHOD, type ToolsModel } from './mlbToolsFit.js';
import type { ToolsParams } from './toolsModel.js';
import { adoptedCalibration, latestCalibrationAttempt, type CalibrationCheck, type StoredCalibration } from './saveCalibrationStore.js';
import { onCalibrationRecorded } from './saveCalibration.js';
import { completedThrough, leagueGameDate } from './saveIdentity.js';
import { standardsFrom, type RoleStandardsSet } from './roleStandards.js';
import type { ReviewCalibration } from './roleReview.js';
import { RESULTS_PRIOR, type ResultsParams } from './resultsMetrics.js';
import { PLATOON_PRIOR, type PlatoonParams } from './platoon.js';
import { BULLPEN_PRIOR, LONG_LINE_PRIOR, type BullpenLines } from './bullpenRoles.js';
import { PLATOON_METHOD, type PlatoonModel } from './mlbPlatoonFit.js';
import { LONG_LINE_POLICY, type BullpenRecord } from './mlbBullpenLines.js';
import { parseGameDate } from './dataFreshness.js';
import { paramsOf, REQUIRED_PARTS, RESULTS_METHOD, RESULTS_PARTS, servesSaveOwn, type ResultsModel } from './mlbResultsFit.js';
import {
  AGING_METHOD, DEFENSE_METHOD, MLB_CALIBRATION_SUBSYSTEM, STANDARDS_METHOD, STANDARDS_METHOD_BEFORE_LINES,
  type AgingModel, type DefenseModel, type StandardsModel,
} from './mlbCalibrationFit.js';

export type YardstickKey = 'standards' | 'aging' | 'defense' | 'results' | 'platoon' | 'bullpen' | 'tools';

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
  /** How much a hitter's own split and his ratings count in a platoon read: the save's own where clearly better, else the starting values. */
  platoon: PlatoonParams;
  /** The tools model's slopes in force (cycle 4): the league's own where clearly better on its forward seasons, else the starting values. */
  tools: ToolsParams;
  /** The bullpen's lines: the leverage cut-offs on the league's own scale and the long-man line the reliever standards in force were measured under. */
  bullpen: BullpenLines;
  /** How the long-man line in force came about (the standards in force's record), for the refit that decides the next one. */
  bullpenRecord: BullpenRecord | null;
  groups: YardstickGroup[];
  /** The one visible line. */
  line: string;
  /** The Pitching Staff page's hover on how long a reliever throws: what a long man is in this league, in plain words. */
  longMan: string;
  /** The hover: one plain sentence per group, then what the line means. */
  tip: string;
}

const WHAT: Record<YardstickKey, string> = {
  standards: 'The line for each job',
  aging: 'How players age',
  defense: 'How much the glove counts at each position',
  results: 'How much recent seasons count',
  tools: 'What a hitter\'s tools say, and how much they hold his results back',
  platoon: "How much a hitter's own split counts",
  bullpen: 'Who counts as a long man',
};

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '?' : `${Math.round(x * 100)}`);

/** Why a group serves the starting values: each reason is one the line may give, and only when it is the true one. */
export type StartingReason =
  | 'not_measured' | 'no_league' | 'games' | 'games_unknown' | 'clubs' | 'seasons' | 'no_zone_rating' | 'no_later_season' | 'check_failed'
  | 'kept' | 'confirming' | 'returned' | 'no_splits' | 'relievers' | 'rarely_long' | 'next_import' | 'no_forward_ratings';

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
  confirming: "this league's own did better at the last check and must do so once more before they are used",
  returned: "they did better than this league's own when checked again",
  no_splits: "this league's export has no batting records against left- and right-handed pitchers",
  relievers: 'too few relievers have pitched enough to measure',
  rarely_long: `this league's relievers rarely work multiple innings, so the line stays at ${LONG_LINE_PRIOR} innings`,
  next_import: 'the long-man line is first measured at the next import',
  no_forward_ratings: 'this league has no ratings saved before a season to check them against yet',
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
    return servesSaveOwn(stored.model as ResultsModel);
  }
  if (key === 'platoon') return (stored.model as PlatoonModel | null)?.source === 'save';
  if (key === 'bullpen') return (stored.model as StandardsModel | null)?.bullpen?.lines.source === 'save';
  if (key === 'tools') return (stored.model as ToolsModel | null)?.bat?.source === 'save' || (stored.model as ToolsModel | null)?.blend?.source === 'save';
  return true;
}

/** Why an adopted verdict serves the starting values: they held up, or they did better when checked again. */
function keptReason(key: YardstickKey, stored: StoredCalibration): StartingReason {
  if (key === 'aging') {
    const m = stored.model as AgingModel;
    if (m.decisions?.hitter?.previous === 'save' || m.decisions?.pitcher?.previous === 'save') return 'returned';
    return (m.decisions?.hitter?.streak ?? 0) > 0 || (m.decisions?.pitcher?.streak ?? 0) > 0 ? 'confirming' : 'kept';
  }
  if (key === 'results') {
    const parts = REQUIRED_PARTS.map((p) => (stored.model as ResultsModel).parts?.[p]?.reason);
    return parts.includes('returned') ? 'returned' : parts.includes('confirming') ? 'confirming' : 'kept';
  }
  if (key === 'platoon') {
    const r = (stored.model as PlatoonModel | null)?.reason;
    return r === 'returned' || r === 'confirming' ? r : 'kept';
  }
  if (key === 'tools') {
    const m = stored.model as ToolsModel | null;
    const reasons = [m?.bat?.reason, m?.blend?.reason];
    return reasons.includes('returned') ? 'returned' : reasons.includes('confirming') ? 'confirming' : reasons.includes('forward') ? 'no_forward_ratings' : 'kept';
  }
  if (key === 'bullpen') {
    // The standards in force were measured under the starting line: because the line did not hold up, or too few relievers to measure it
    const b = (stored.model as StandardsModel | null)?.bullpen;
    if (!b) return 'next_import'; // a standards-1 row, measured before the line was
    if (b.basis === 'rarely_long') return 'rarely_long';
    return b.attempt.reason === 'relievers' ? 'relievers' : 'check_failed';
  }
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
  if (first.startsWith('no_splits')) return 'no_splits';
  if (first.startsWith('no_later_season')) return 'no_later_season';
  if (first.startsWith('forward:')) return 'no_forward_ratings';
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
  const label: Record<string, string> = { hitter: 'hitters', starter: 'starting pitchers', reliever: 'relievers', baserunning: 'baserunning', defense: 'fielding' };
  const judged = RESULTS_PARTS.filter((p) => REQUIRED_PARTS.includes(p as never) || s.model.parts[p]?.source === 'save');
  const own = judged.filter((p) => s.model.parts[p]?.source === 'save').map((p) => label[p]);
  const kept = judged.filter((p) => s.model.parts[p]?.source !== 'save').map((p) => label[p]);
  return `How much a player's last three seasons count, and how much playing time it takes before his results are trusted as his level. `
    + `From ${s.record.window.sample.toLocaleString('en-US')} player-seasons in this league${seasons.length ? ` (${seasons[0]}–${seasons[seasons.length - 1]})` : ''}, `
    + `checked one season at a time on seasons they had not seen: this league's own were clearly better for ${own.join(' and ')}`
    + `${kept.length ? `; for ${kept.join(' and ')} the starting values held up and still serve` : ''}.`;
}

function describePlatoon(s: StoredCalibration<PlatoonModel>): string {
  const seasons = s.record.window.seasons;
  return `From ${s.record.window.sample.toLocaleString('en-US')} hitter-seasons in this league${seasons.length ? ` (${seasons[0]}–${seasons[seasons.length - 1]})` : ''}. `
    + 'Checked one season at a time on seasons it had not seen, it predicted the next season\'s splits against left- and right-handers clearly better than the starting value. '
    + 'It applies where his platoon ratings are not visible.';
}

/** An export's game date in plain words ("May 16, 2026"); the raw date where it cannot be read. */
function plainDate(raw: string | null): string {
  const d = raw === null ? null : parseGameDate(raw);
  if (!d || raw === null) return raw ?? 'this export';
  const [y, m, day] = d.split('-').map(Number);
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${day}, ${y}`;
}

function describeBullpen(b: BullpenRecord): string {
  const share = Math.round((1 - LONG_LINE_POLICY.quantile) * 100);
  const season = b.seasonSplit === 'passed'
    ? ', and so did a line drawn from the first half of the season'
    : `; the season could not be split in halves to check it (${b.seasonSplitWhy ?? 'not measured'})`;
  const carried = b.basis === 'carried'
    ? ` The latest measurement (${plainDate(b.attempt.gameDate)}) ${b.attempt.reason === 'relievers' ? 'had too few relievers to measure' : 'did not hold up'}, so this line stays.`
    : '';
  return `A reliever who averages ${(b.lines.long).toFixed(1)} or more innings an appearance, about the longest-working ${share} in 100 of this league's relievers (${b.relievers} relievers, as of ${plainDate(b.measuredOn)}). `
    + `Lines drawn from half the clubs picked out about the same share of the rest${season}.${carried} `
    + leverageSentence(b.lines);
}

/** How much a reliever's innings matter is read on the league's own scale: said once, plainly. */
function leverageSentence(lines: BullpenLines): string {
  return lines.rescaled && lines.leagueLeverage !== null
    ? `How much his innings matter is read on this league's own scale: the export puts an average plate appearance at ${lines.leagueLeverage.toFixed(2)}, so the lines for closers and high- and low-leverage arms were scaled to it.`
    : "How much his innings matter (closers, high- and low-leverage arms) is read on Pennant's fixed lines, on a scale where 1.0 is an average plate appearance in this league.";
}

function describeTools(s: StoredCalibration<ToolsModel>): string {
  const own = [s.model.bat.source === 'save' ? 'what each tool is worth' : null, s.model.blend.source === 'save' ? 'how much the tools hold a hitter\'s results back' : null].filter(Boolean);
  return `Checked on ${s.model.forwardSeasons} seasons that came after ratings were saved: this league's own ${own.join(' and ')} forecast those seasons clearly better than the starting values.`;
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
  if (leagueId === null) return assemble(null, null, null, null, null, null, [null, null, null, null, null, null], null);
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
  // A standards-1 row (measured before the bullpen lines were) serves, read as measured under the starting lines, until a standards-2 exists
  const current = read<StandardsModel>('standards', STANDARDS_METHOD);
  const before = current.adopted ? { adopted: null, latest: null } : read<StandardsModel>('standards', STANDARDS_METHOD_BEFORE_LINES);
  const standards = { adopted: current.adopted ?? before.adopted, latest: current.latest ?? before.latest };
  const platoon = read<PlatoonModel>('platoon', PLATOON_METHOD);
  const aging = read<AgingModel>('aging', AGING_METHOD);
  const defense = read<DefenseModel>('defense', DEFENSE_METHOD);
  const results = read<ResultsModel>('results', RESULTS_METHOD);
  const tools = read<ToolsModel>('tools', TOOLS_METHOD);
  return assemble(leagueId, standards.adopted, aging.adopted, defense.adopted, results.adopted, platoon.adopted, [standards.latest, aging.latest, defense.latest, results.latest, platoon.latest, tools.latest], tools.adopted);
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

/**
 * The long-man line's group: it is in force with the standards (the lines they were measured under), so it is read from the standards in
 * force; its reason is the line's own (too few relievers, did not hold up) or, before any standards-2 row, the standards' latest attempt.
 */
function bullpenGroup(standards: StoredCalibration<StandardsModel> | null, latest: StoredCalibration | null, noLeague: boolean): YardstickGroup {
  const record = standards?.model?.bullpen ?? null;
  const own = servesOwn('bullpen', standards);
  const reason: StartingReason | null = own ? null : noLeague ? 'no_league'
    : standards?.model?.bullpen ? keptReason('bullpen', standards)
      // no line measured yet: the latest attempt's reason where it failed, else it comes with the next import (or nothing is measured)
      : latest && !latest.adopted ? reasonOf(latest) : standards ? 'next_import' : 'not_measured';
  const lineChecks = (standards ?? latest)?.record.heldOut.filter((c) => c.part === 'long_line') ?? [];
  const failedLater = latest && !latest.adopted && (!standards || latest.basis !== standards.basis) ? { basis: latest.basis, reason: latest.reason } : null;
  return {
    key: 'bullpen', what: WHAT.bullpen, source: own ? 'save' : 'starting',
    text: own
      ? `${WHAT.bullpen}: ${describeBullpen(record as BullpenRecord)}`
      : reason === 'rarely_long'
        ? `${WHAT.bullpen}: a reliever who averages ${LONG_LINE_PRIOR} or more innings an appearance, because ${REASON_TEXT.rarely_long}. ${leverageSentence(record?.lines ?? BULLPEN_PRIOR)}`
        : `${WHAT.bullpen}: the starting value (a reliever who averages ${LONG_LINE_PRIOR} or more innings an appearance), because ${REASON_TEXT[reason as StartingReason]}. ${leverageSentence(record?.lines ?? BULLPEN_PRIOR)}`,
    reason,
    method: standards?.method ?? latest?.method ?? '',
    basis: standards ? standards.record.basis : null,
    window: own && record ? { seasons: [], sample: record.relievers, unit: 'relievers' } : null,
    heldOut: lineChecks,
    priorWeight: standards ? standards.record.priorWeight.byPart.long_line ?? null : null,
    gate: standards ? { passed: own, reason: own ? 'The long-man line in force held up when checked.' : `The long-man line is not the league's own: ${REASON_TEXT[reason as StartingReason]}.` } : null,
    refittedOn: own ? record?.measuredOn ?? null : null,
    lastAttempt: failedLater,
  };
}

function assemble(
  leagueId: number | null, standards: StoredCalibration<StandardsModel> | null, aging: StoredCalibration<AgingModel> | null, defense: StoredCalibration<DefenseModel> | null,
  results: StoredCalibration<ResultsModel> | null, platoon: StoredCalibration<PlatoonModel> | null, latest: Array<StoredCalibration | null>,
  tools: StoredCalibration<ToolsModel> | null,
): RosterReviewCalibration {
  const noLeague = leagueId === null;
  const groups = [
    group('standards', standards, latest[0], describeStandards, noLeague),
    group('aging', aging, latest[1], describeAging, noLeague),
    group('defense', defense, latest[2], describeDefense, noLeague),
    group('results', results, latest[3], describeResults, noLeague),
    group('platoon', platoon, latest[4], describePlatoon, noLeague),
    group('tools', tools, latest[5], describeTools, noLeague),
    bullpenGroup(standards, latest[0], noLeague),
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
    'The roster review judges each player against yardsticks: what a regular at his job typically looks like, how players his age tend to change, how much the glove counts at his position, how much his recent seasons count, what a hitter\'s tools say and how much they hold his results back, how much a hitter\'s own record against left- and right-handers counts, and how long a reliever has to work to count as a long man.',
    ...groups.map((g) => g.text),
    'Starting values are the ones Pennant ships with. They are replaced by this league\'s own only after those have been checked against players and seasons they were not drawn from, and, for how players age, how much recent seasons count, what a hitter\'s tools say and how much a hitter\'s own split counts, only where this league\'s own did clearly better than the starting values there. What the tools say can only be checked on seasons that came after the ratings were saved, which takes several seasons of imports.',
  ].join('\n\n');
  return {
    leagueId,
    standards: standardsFrom(standards?.model.served),
    review: { aging: servesOwn('aging', aging) ? (aging as StoredCalibration<AgingModel>).model.table : null, defenseWeights: defense?.model.weights ?? null },
    results: withToolsWeight(servesOwn('results', results) ? paramsOf((results as StoredCalibration<ResultsModel>).model, (results as StoredCalibration<ResultsModel>).basis) : RESULTS_PRIOR, leagueId),
    platoon: servesOwn('platoon', platoon)
      ? { ...PLATOON_PRIOR, shrinkAroundLeague: (platoon as StoredCalibration<PlatoonModel>).model.served, source: 'save' }
      : PLATOON_PRIOR,
    // The bullpen lines are the ones the standards in force were measured under (a standards-1 row, or none: the starting lines)
    bullpen: standards?.model?.bullpen?.lines ?? BULLPEN_PRIOR,
    bullpenRecord: standards?.model?.bullpen ?? null,
    tools: toolsParamsFor(leagueId),
    groups, line, tip, longMan: longManTip(groups.find((g) => g.key === 'bullpen') as YardstickGroup, standards?.model?.bullpen?.lines ?? BULLPEN_PRIOR),
  };
}

/** The results params with the hitters' tools weight in force (the tools fit's, where it serves; else the starting 1). */
function withToolsWeight(params: ResultsParams, leagueId: number | null): ResultsParams {
  const hitter = hitterToolsWeightFor(leagueId);
  return hitter === params.toolsWeight.hitter ? params : { ...params, toolsWeight: { ...params.toolsWeight, hitter } };
}

/** What a long man is in this league, for the hover where the page names how long a reliever throws. */
function longManTip(group: YardstickGroup, lines: BullpenLines): string {
  const share = Math.round((1 - LONG_LINE_POLICY.quantile) * 100);
  if (group.reason === 'rarely_long') return `A long man is a reliever outside the high-leverage spots who averages ${LONG_LINE_PRIOR} or more innings an appearance: ${REASON_TEXT.rarely_long}.`;
  return group.source === 'save'
    ? `A long man is a reliever outside the high-leverage spots who averages ${lines.long.toFixed(1)} or more innings an appearance: about the longest-working ${share} in 100 of this league's relievers. Leagues differ in how long their relievers work, so the line is this league's own.`
    : `A long man is a reliever outside the high-leverage spots who averages ${LONG_LINE_PRIOR} or more innings an appearance: Pennant's starting line, because ${REASON_TEXT[group.reason as StartingReason]}. It is replaced by this league's own once its relievers can be measured.`;
}
