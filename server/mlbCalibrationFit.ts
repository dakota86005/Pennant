/**
 * MLB Operations' per-save calibration: the METHOD and the POLICY behind the roster review's numbers (D-053, cycle 1;
 * docs/CALIBRATION.md section 12). Pure: no table, no rating; every number arrives as an argument.
 *
 * Three groups of numbers, each fitted (or measured) on the save's own data and served only once it passes its checks:
 *
 *   standards  each role's typical working estimate and typical bat, the pooled gaps under which a holder is unusually weak for
 *              the role, and each LENS's own typical and gap (owner decision 2026-09-24). A description of the league's holders
 *              NOW, measured from the current export at each import (owner decision 2026-09-24) across every club, shrunk toward
 *              the built-in values by the holders behind each role. Checked two ways: standards measured on half the clubs must
 *              put about a tenth of the other half's holders under the line; and the same method run on the league's own past
 *              seasons (the results lens, the one lens the history holds) must put about a tenth of the NEXT season's holders
 *              under a line set on this one. Relievers are checked against history as one pool, because past usage roles cannot
 *              be rebuilt: the export carries no leverage before the current season (owner decision 2026-09-24).
 *   aging      the expected annual change by age, hitters (wOBA) and pitchers (FIP), fitted on consecutive seasons of the league's
 *              own history, smoothed, shrunk toward the built-in curve by the pairs at each age and never improving with age.
 *              Checked by a rolling-origin backtest: the curve fitted through season t is scored on the pair (t, t+1).
 *   defense    each position's glove weight, from the repeatable spread of fielding RESULTS against the bat's (no rating on either
 *              side), fitted on consecutive seasons that carry zone rating and checked on the next season. Inactive on a save
 *              whose history carries no zone rating (the fallback prior serves, and says why).
 *
 * The quantiles (FLOOR_QUANTILE, DEEP_QUANTILE), GLOVE_MATTERS and `concernAge` stay policy in their own modules. Nothing fitted
 * here is written into code: the built-in values are the provisional fallback prior (`ROSTER_REVIEW_PRIOR`), never presented as
 * the save's own.
 */

import { policy, provisional, type CalibrationStamp } from './calibration.js';
import type { CalibrationCheck, CalibrationRecord } from './saveCalibrationStore.js';
import type { CalibrationRun } from './saveCalibration.js';
import { decide, describeComparison, DETECTOR_POLICY, ruleText, type DetectorDecision, type DetectorPolicy, type HeldOutCase, type ServedSource } from './calibrationDetector.js';
import { AGING_CURVE, DEFENSE_WEIGHT, expectedAnnualChange, type AgingTable } from './roleReview.js';
import { DEEP_QUANTILE, FLOOR_QUANTILE, groupOfRole, STARTING_STANDARDS, type ServedLens, type ServedStandards, type StandardGroup } from './roleStandards.js';

export const MLB_CALIBRATION_SUBSYSTEM = 'mlb_operations';
export const STANDARDS_METHOD = 'standards-1';
export const AGING_METHOD = 'aging-2';
export const DEFENSE_METHOD = 'defense-1';

export const ROSTER_REVIEW_FIT_STAMP: CalibrationStamp = policy(
  'What the roster review\'s per-save fits are asked to achieve and when they may be trusted: sample minimums, the hold-out rules, the shrinkage strengths and the adoption tolerances. Chosen, stated and changed by decision, never fitted (D-041, D-053).'
);

/** POLICY. Every minimum, hold-out rule, shrinkage strength and tolerance of the three fits. */
export const ROSTER_REVIEW_FIT_POLICY = {
  standards: {
    /** Clubs with a reviewed lineup needed to measure the league's holders at all. */
    minClubs: 20,
    /** Games per club this season (the median club) before usage names regulars: below it the starting values serve. */
    minGamesPerClub: 15,
    /** A role joins its group's pooled gap only with this many holders (the harness's rule). */
    minRoleHolders: 10,
    /** Holders at which a role's measured typical carries half the weight against the starting value. */
    shrinkHolders: 10,
    /** Pooled holders at which a group's measured gap carries half the weight. */
    shrinkPooled: 30,
    /** The club-split check: halvings (a fixed seed, so a refit is repeatable) and the tolerance around each quantile. */
    splits: 400,
    seed: 20260924,
    tolerance: { floor: 0.05, deep: 0.04 },
    /** The history check: at most this many origins (t -> t+1), each with at least this many held-out holders per group. */
    history: { maxOrigins: 8, minHolders: 100, minShare: 0.9 },
  },
  aging: {
    /** Plate appearances (hitters) or batters faced (pitchers) in both seasons of a pair. */
    minSample: 300,
    /** The most recent completed seasons in the window; a season under this share of its schedule is skipped. */
    windowSeasons: 20,
    minShare: 0.9,
    fitAges: { from: 22, to: 40 },
    tableAges: { from: 20, to: 42 },
    /** Pairs at an age at which the fitted value carries half the weight against the built-in curve. */
    priorStrength: 150,
    /** Fewest pairs in the window for a fit at all. */
    minPairs: 1000,
    /** The rolling-origin backtest: at most this many origins, from the window's start + this many seasons. */
    maxOrigins: 8,
    originStart: 5,
    bands: [[22, 25], [26, 29], [30, 33], [34, 37], [38, 42]] as ReadonlyArray<readonly [number, number]>,
    /** A band is scored with at least this many held-out pairs. */
    minBandPairs: 50,
    /** A band fails when its bias is beyond BOTH this tolerance and this many standard errors (clustered by player). */
    tolerance: { hitter: 0.003, pitcher: 0.08 },
    zFail: 3,
  },
  defense: {
    minInnings: 300,
    minPa: 300,
    /** Fielders at a position in a season pair for its repeatable spread to be read. */
    minFielders: 20,
    /** Pairs at which the fitted weight carries half the weight against the built-in one. */
    priorStrength: 60,
    /** The fitted weight's next-season rank correlation may trail the built-in weight's by at most this much. */
    tolerance: 0.02,
  },
} as const;

export const ROSTER_REVIEW_PRIOR_STAMP: CalibrationStamp = provisional(
  'The built-in roster-review numbers are the fallback prior: the role standards measured on the Arizona import (2026-05-16, about 43 games, scripts/calibrate.ts standards), the aging curve fitted by the delta method on that league\'s 2000-2025 history (section 5), and the glove weights from one partial season of zone ratings averaged with first-pass figures (section 7). Never presented as a save\'s own calibration.'
);

export const PRIOR_SOURCE = {
  standards: 'Built-in role standards: the production review\'s medians on the Arizona import, 2026-05-16 (provisional).',
  aging: 'Built-in aging curve: the delta method on the Arizona import\'s 2000-2025 history (provisional).',
  defense: 'Built-in glove weights: one partial season of zone ratings averaged with first-pass figures (provisional).',
} as const;

// ── shared arithmetic ────────────────────────────────────────────────────────

/** The harness's quantile: the value at floor(p * n) of the sorted values. */
export function quantileOf(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
}
const median = (xs: number[]) => quantileOf(xs, 0.5);
const shrink = (measured: number, prior: number, n: number, strength: number) => {
  const w = n / (n + strength);
  return { value: w * measured + (1 - w) * prior, weight: w };
};

/** A small deterministic generator (a fixed seed makes a refit repeatable). */
function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ── standards ────────────────────────────────────────────────────────────────

/** One holder of a role in the current export's review: his working estimate and his lenses, all percentiles. */
export interface StandardHolder {
  role: string;
  estimate: number;
  bat: number | null;
  tools: number | null;
  results: number | null;
}

export interface StandardsSample {
  /** Each club's reviewed holders, and the games it has played this season. */
  clubs: Array<{ clubId: number; gamesPlayed: number | null; holders: StandardHolder[] }>;
}

/** The league's past seasons on the results lens: each season's holders by role (the results percentile only). */
export interface ResultsLensSeason {
  season: number;
  holders: Array<{ role: string; value: number }>;
}

export interface StandardsModel {
  served: ServedStandards;
  /** Per role: holders measured and the weight the measurement carries against the starting value. */
  roles: Record<string, { n: number; weight: number; typical: number; bat: number | null; tools: number | null; results: number | null }>;
}

type Scale = 'estimate' | 'tools' | 'results';
const valueOn = (h: StandardHolder, scale: Scale): number | null => (scale === 'estimate' ? h.estimate : scale === 'tools' ? h.tools : h.results);

/** Per role, the medians on a scale; per group, the pooled FLOOR and DEEP deviation from each role's median. */
function measureScale(holders: StandardHolder[], scale: Scale, minRole: number) {
  const byRole = new Map<string, number[]>();
  for (const h of holders) {
    const v = valueOn(h, scale);
    if (v !== null) byRole.set(h.role, [...(byRole.get(h.role) ?? []), v]);
  }
  const typical = new Map<string, number>();
  for (const [role, xs] of byRole) typical.set(role, median(xs) as number);
  const dev = new Map<StandardGroup, number[]>();
  for (const [role, xs] of byRole) {
    if (xs.length < minRole) continue;
    const m = typical.get(role) as number;
    const g = groupOfRole(role);
    dev.set(g, [...(dev.get(g) ?? []), ...xs.map((x) => x - m)]);
  }
  const gaps = new Map<StandardGroup, { floor: number; deep: number; n: number }>();
  for (const [g, d] of dev) gaps.set(g, { floor: quantileOf(d, FLOOR_QUANTILE) as number, deep: quantileOf(d, DEEP_QUANTILE) as number, n: d.length });
  return { byRole, typical, gaps };
}

/** Shares of holders under each role's floor and deep floor on a scale, by group. */
function coverageOn(lines: Map<string, { floor: number; deep: number }>, holders: Array<{ role: string; value: number | null }>) {
  const out = new Map<StandardGroup, { n: number; floor: number; deep: number }>();
  for (const h of holders) {
    const line = lines.get(h.role);
    if (!line || h.value === null) continue;
    const g = groupOfRole(h.role);
    const c = out.get(g) ?? { n: 0, floor: 0, deep: 0 };
    c.n += 1;
    if (h.value < line.floor) c.floor += 1;
    if (h.value < line.deep) c.deep += 1;
    out.set(g, c);
  }
  return out;
}

/** The starting value a role's line on a scale is shrunk toward: its typical estimate, or on a lens its typical bat (a hitter) or typical. */
function startOn(role: string, scale: Scale, prior: ServedStandards): number | null {
  const p = prior.roles[role];
  if (!p) return null;
  return scale === 'estimate' ? p.typical : role.startsWith('pos') ? p.bat ?? p.typical : p.typical;
}

/** A role's typical on a scale as SERVED: its median shrunk toward the starting value by the holders behind it. */
function shrunkTypical(m: ReturnType<typeof measureScale>, role: string, scale: Scale, prior: ServedStandards, policyIn: StandardsPolicy): { value: number; weight: number } {
  const measured = m.typical.get(role) as number;
  const start = startOn(role, scale, prior);
  return start === null ? { value: measured, weight: 1 } : shrink(measured, start, m.byRole.get(role)?.length ?? 0, policyIn.shrinkHolders);
}

/** A group's gaps as SERVED: the pooled deviations shrunk toward the starting gaps by the pooled holders. */
function shrunkGap(m: ReturnType<typeof measureScale>, g: StandardGroup, prior: ServedStandards, policyIn: StandardsPolicy): { floor: number; deep: number; weight: number } | null {
  const v = m.gaps.get(g);
  if (!v) return null;
  const f = shrink(v.floor, prior.gaps[g].floor, v.n, policyIn.shrinkPooled);
  return { floor: f.value, deep: shrink(v.deep, prior.gaps[g].deep, v.n, policyIn.shrinkPooled).value, weight: f.weight };
}

/** The lines a measurement would serve on a scale, shrunk exactly as served, so what is checked is what is served. */
function servedLines(m: ReturnType<typeof measureScale>, scale: Scale, prior: ServedStandards, policyIn: StandardsPolicy): Map<string, { floor: number; deep: number }> {
  const out = new Map<string, { floor: number; deep: number }>();
  for (const role of m.byRole.keys()) {
    const gap = shrunkGap(m, groupOfRole(role), prior, policyIn);
    if (!gap) continue;
    const t = shrunkTypical(m, role, scale, prior, policyIn).value;
    out.set(role, { floor: t + gap.floor, deep: t + gap.deep });
  }
  return out;
}

type StandardsPolicy = typeof ROSTER_REVIEW_FIT_POLICY.standards;

/**
 * The club-split check on one scale: the lines measured on half the clubs, shrunk as they would be served with that half's own
 * holders, and the shares of the other half's holders under them. The deep line is checked on the estimate scale only (a lens has
 * no deep line).
 */
export function clubSplitCheck(sample: StandardsSample, scale: Scale, policyIn: StandardsPolicy = ROSTER_REVIEW_FIT_POLICY.standards, prior: ServedStandards = STARTING_STANDARDS): CalibrationCheck[] {
  const rnd = generator(policyIn.seed);
  const clubs = sample.clubs;
  const pooled = new Map<StandardGroup, { n: number; floor: number; deep: number }>();
  for (let i = 0; i < policyIn.splits; i += 1) {
    const order = clubs.map((c) => ({ c, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => x.c);
    const half = Math.floor(order.length / 2);
    const train = measureScale(order.slice(0, half).flatMap((c) => c.holders), scale, policyIn.minRoleHolders);
    const held = order.slice(half).flatMap((c) => c.holders.map((h) => ({ role: h.role, value: valueOn(h, scale) })));
    for (const [g, c] of coverageOn(servedLines(train, scale, prior, policyIn), held)) {
      const p = pooled.get(g) ?? { n: 0, floor: 0, deep: 0 };
      p.n += c.n; p.floor += c.floor; p.deep += c.deep;
      pooled.set(g, p);
    }
  }
  const checks: CalibrationCheck[] = [];
  for (const [g, c] of pooled) {
    const perSplit = c.n / policyIn.splits;
    const floor = c.floor / c.n;
    const deep = c.deep / c.n;
    checks.push({ kind: 'club_split', part: `${scale}:${g}:floor`, n: Math.round(perSplit), expected: FLOOR_QUANTILE, observed: floor, passed: Math.abs(floor - FLOOR_QUANTILE) <= policyIn.tolerance.floor });
    if (scale === 'estimate') checks.push({ kind: 'club_split', part: `${scale}:${g}:deep`, n: Math.round(perSplit), expected: DEEP_QUANTILE, observed: deep, passed: Math.abs(deep - DEEP_QUANTILE) <= policyIn.tolerance.deep });
  }
  return checks;
}

/**
 * The history check (results lens): the method run on each past season, its lines shrunk as the results lens's are served, scored on
 * the next season's holders. Origins are the last `maxOrigins` seasons with a following season in the list; relievers are one pool
 * (their past roles cannot be rebuilt). Past holders are ranked within their own season, so wherever the league's holders are
 * steady this check is close to guaranteed: in practice it asks that the league has enough past seasons, and that they are steady.
 */
export function historyCheck(seasons: ResultsLensSeason[], policyIn: StandardsPolicy = ROSTER_REVIEW_FIT_POLICY.standards, prior: ServedStandards = STARTING_STANDARDS): { checks: CalibrationCheck[]; origins: number[] } {
  const by = new Map(seasons.map((s) => [s.season, s]));
  const origins = seasons.map((s) => s.season).filter((y) => by.has(y + 1)).sort((a, b) => a - b).slice(-policyIn.history.maxOrigins);
  const pooled = new Map<StandardGroup, { n: number; floor: number; deep: number }>();
  const asHolders = (s: ResultsLensSeason): StandardHolder[] => s.holders.map((h) => ({ role: h.role, estimate: h.value, bat: null, tools: null, results: h.value }));
  for (const t of origins) {
    const train = measureScale(asHolders(by.get(t) as ResultsLensSeason), 'results', policyIn.minRoleHolders);
    const held = (by.get(t + 1) as ResultsLensSeason).holders.map((h) => ({ role: h.role, value: h.value }));
    for (const [g, c] of coverageOn(servedLines(train, 'results', prior, policyIn), held)) {
      const p = pooled.get(g) ?? { n: 0, floor: 0, deep: 0 };
      p.n += c.n; p.floor += c.floor; p.deep += c.deep;
      pooled.set(g, p);
    }
  }
  const checks: CalibrationCheck[] = [];
  for (const [g, c] of pooled) {
    const enough = c.n >= policyIn.history.minHolders;
    const floor = c.floor / c.n;
    const deep = c.deep / c.n;
    checks.push({ kind: 'history', part: `results:${g}:floor`, n: c.n, expected: FLOOR_QUANTILE, observed: floor, passed: enough ? Math.abs(floor - FLOOR_QUANTILE) <= policyIn.tolerance.floor : null, note: enough ? undefined : 'Too few held-out holders to score.' });
    checks.push({ kind: 'history', part: `results:${g}:deep`, n: c.n, expected: DEEP_QUANTILE, observed: deep, passed: enough ? Math.abs(deep - DEEP_QUANTILE) <= policyIn.tolerance.deep : null });
  }
  return { checks, origins };
}

export interface FitBasis {
  leagueId: number;
  throughSeason: number | null;
  gameDate: string | null;
}

/**
 * The gate's verdict. A failure names its kind first (`seasons:`, `no_later_season:`, `clubs`, `games`, ...) so the page can give
 * the true reason in plain words; a failed check is named by its part.
 */
const gateOf = (checks: CalibrationCheck[], extra: string[] = []): CalibrationRecord['gate'] => {
  const failures = [...extra, ...checks.filter((c) => c.passed === false).map((c) => `${c.kind} ${c.part}: ${c.observed === null ? '—' : c.observed.toFixed(3)} against ${c.expected === null ? '—' : c.expected.toFixed(3)}`)];
  return failures.length === 0
    ? { passed: true, reason: 'Every check passed.', failures }
    : { passed: false, reason: `Not adopted: ${failures[0]}${failures.length > 1 ? ` (and ${failures.length - 1} more)` : ''}. The values in force stay.`, failures };
};

/**
 * Measure the role standards from the current export's review of every club (`sample`), check them (club split on each scale, the
 * league's history on the results lens, each on the lines as they would be served) and shrink them toward the starting values by
 * the holders behind each role.
 */
export function measureStandards(
  sample: StandardsSample, history: ResultsLensSeason[], basis: FitBasis, prior: ServedStandards = STARTING_STANDARDS,
  policyIn: StandardsPolicy = ROSTER_REVIEW_FIT_POLICY.standards, historySkipped: Array<{ season: number; reason: string }> = [],
): CalibrationRun<StandardsModel | null> {
  const clubs = sample.clubs.filter((c) => c.holders.length > 0);
  const known = clubs.map((c) => c.gamesPlayed).filter((g): g is number => g !== null);
  const games = median(known);
  const holders = clubs.flatMap((c) => c.holders);
  const window = { seasons: history.map((s) => s.season), skipped: historySkipped, sample: holders.length, unit: 'holders' };
  const record = (model: StandardsModel | null, heldOut: CalibrationCheck[], gate: CalibrationRecord['gate'], priorWeight: CalibrationRecord['priorWeight'], notes: string[]): CalibrationRun<StandardsModel | null> => ({
    model,
    record: { leagueId: basis.leagueId, subsystem: MLB_CALIBRATION_SUBSYSTEM, component: 'standards', method: STANDARDS_METHOD, basis: { throughSeason: null, gameDate: basis.gameDate }, window, heldOut, priorWeight, gate, priorSource: PRIOR_SOURCE.standards, notes },
  });
  const notes = ['Relievers are checked against the league\'s history as one pool: the export carries no leverage for past seasons, so their usage roles cannot be rebuilt.'];
  const none = (failure: string, reason: string) => record(null, [], { passed: false, reason, failures: [failure] }, { overall: 1, byPart: {} }, notes);
  if (clubs.length < policyIn.minClubs) return none('clubs', `Not measured: ${clubs.length} clubs have a reviewed lineup, fewer than ${policyIn.minClubs}.`);
  if (games === null) return none('games_unknown', "Not measured: the export does not say how many games the clubs have played this season.");
  if (games < policyIn.minGamesPerClub) return none('games', `Not measured: clubs have played ${games} games this season, fewer than ${policyIn.minGamesPerClub}, too few for usage to name the regulars.`);

  const est = measureScale(holders, 'estimate', policyIn.minRoleHolders);
  const bat = measureScale(holders.map((h) => ({ ...h, estimate: h.bat ?? NaN })).filter((h) => Number.isFinite(h.estimate)), 'estimate', policyIn.minRoleHolders);
  const lens = { tools: measureScale(holders, 'tools', policyIn.minRoleHolders), results: measureScale(holders, 'results', policyIn.minRoleHolders) };

  const roles: StandardsModel['roles'] = {};
  const servedRoles: ServedStandards['roles'] = {};
  const priorShare = { roles: { w: 0, n: 0 }, tools: { w: 0, n: 0 }, results: { w: 0, n: 0 } };
  for (const [role, xs] of est.byRole) {
    const t = shrunkTypical(est, role, 'estimate', prior, policyIn);
    const p = prior.roles[role];
    const b = bat.typical.get(role);
    const bShrunk = b === undefined ? p?.bat : p?.bat !== undefined ? shrink(b, p.bat, bat.byRole.get(role)?.length ?? 0, policyIn.shrinkHolders).value : b;
    servedRoles[role] = { typical: t.value, ...(bShrunk !== undefined ? { bat: bShrunk } : {}) };
    roles[role] = { n: xs.length, weight: t.weight, typical: est.typical.get(role) as number, bat: b ?? null, tools: lens.tools.typical.get(role) ?? null, results: lens.results.typical.get(role) ?? null };
    priorShare.roles.w += (1 - t.weight) * xs.length;
    priorShare.roles.n += xs.length;
  }
  for (const [role, p] of Object.entries(prior.roles)) if (!servedRoles[role]) servedRoles[role] = p;
  const gaps = { ...prior.gaps };
  const byPart: Record<string, number> = {};
  for (const g of ['hitter', 'starter', 'reliever'] as StandardGroup[]) {
    const s = shrunkGap(est, g, prior, policyIn);
    if (!s) { byPart[`gap:${g}`] = 1; continue; }
    gaps[g] = { floor: s.floor, deep: s.deep };
    byPart[`gap:${g}`] = 1 - s.weight;
  }
  const lensOf = (m: ReturnType<typeof measureScale>, scale: 'tools' | 'results'): ServedLens => {
    const typical: Record<string, number> = {};
    for (const [role, xs] of m.byRole) {
      const t = shrunkTypical(m, role, scale, prior, policyIn);
      typical[role] = t.value;
      priorShare[scale].w += (1 - t.weight) * xs.length;
      priorShare[scale].n += xs.length;
    }
    const gap: ServedLens['gap'] = {};
    for (const g of m.gaps.keys()) {
      const s = shrunkGap(m, g, prior, policyIn) as { floor: number; weight: number };
      gap[g] = s.floor;
      byPart[`${scale}:gap:${g}`] = 1 - s.weight;
    }
    return { typical, gap };
  };
  const served: ServedStandards = { source: 'save', roles: servedRoles, gaps, lenses: { tools: lensOf(lens.tools, 'tools'), results: lensOf(lens.results, 'results') } };

  const hist = historyCheck(history, policyIn, prior);
  const heldOut = [...clubSplitCheck(sample, 'estimate', policyIn, prior), ...clubSplitCheck(sample, 'tools', policyIn, prior), ...clubSplitCheck(sample, 'results', policyIn, prior), ...hist.checks];
  const extra = hist.checks.every((c) => c.passed === null) ? ["seasons: the league's own past seasons could not be checked (too few seasons with results)"] : [];
  for (const k of ['roles', 'tools', 'results'] as const) byPart[k === 'roles' ? 'roles' : `${k}:roles`] = priorShare[k].n > 0 ? priorShare[k].w / priorShare[k].n : 1;
  // Overall: the typicals, the gaps and each lens's lines alike (each group's share averaged within its kind)
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1);
  const overall = avg([
    byPart.roles,
    avg(['hitter', 'starter', 'reliever'].map((g) => byPart[`gap:${g}`])),
    avg([byPart['tools:roles'], ...Object.entries(byPart).filter(([k]) => k.startsWith('tools:gap')).map(([, v]) => v)]),
    avg([byPart['results:roles'], ...Object.entries(byPart).filter(([k]) => k.startsWith('results:gap')).map(([, v]) => v)]),
  ]);
  if (hist.origins.length) notes.push(`The history check used ${hist.origins.length} season${hist.origins.length === 1 ? '' : 's'} (${hist.origins[0]}–${hist.origins[hist.origins.length - 1]}), each scored on the next. It ranks past holders within their own season, so it mostly asks that the league has enough steady past seasons.`);
  if (historySkipped.length) notes.push(`Past seasons left out of the history check: ${historySkipped.map((s) => `${s.season} (${s.reason})`).join('; ')}.`);
  return record({ served, roles }, heldOut, gateOf(heldOut, extra), { overall, byPart }, notes);
}

// ── aging ────────────────────────────────────────────────────────────────────

/** One player's change from one season to the next (league-relative), with the pair's weight. */
export interface AgingPair {
  playerId: number;
  /** The first season of the pair. */
  season: number;
  age: number;
  change: number;
  weight: number;
}

export interface AgingInput {
  hitter: AgingPair[];
  pitcher: AgingPair[];
  /** The completed full seasons available, and those skipped with why (short schedules). */
  seasons: number[];
  skipped: Array<{ season: number; reason: string }>;
}

export interface AgingModel {
  /**
   * The curve served: for each kind the save's own where it was clearly better than the starting curve on held-out seasons (D-053
   * amendment, 2026-09-25), else an empty row (the starting curve serves: `expectedAnnualChange` falls back to it).
   */
  table: AgingTable;
  /** The save's fitted curve (as it would serve), whether or not it serves. */
  fitted: AgingTable;
  /** What serves for each kind, and the detector's verdict behind it. */
  serve: { hitter: ServedSource; pitcher: ServedSource };
  decisions: { hitter: DetectorDecision | null; pitcher: DetectorDecision | null };
  /** Per age and kind: the pairs behind it and the weight the fit carries against the built-in curve. */
  cells: { hitter: Array<{ age: number; n: number; weight: number }>; pitcher: Array<{ age: number; n: number; weight: number }> };
}

/** Solve a small linear system (Gaussian elimination); null when singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = c + 1; r < n; r += 1) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k += 1) m[r][k] -= f * m[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k += 1) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x;
}

/** Pool adjacent violators: the closest non-increasing sequence (equal weights). */
function nonIncreasing(y: number[]): number[] {
  const blocks: Array<{ v: number; n: number }> = [];
  for (const v of y) {
    blocks.push({ v, n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].v < blocks[blocks.length - 1].v) {
      const b = blocks.pop() as { v: number; n: number };
      const a = blocks.pop() as { v: number; n: number };
      blocks.push({ v: (a.v * a.n + b.v * b.n) / (a.n + b.n), n: a.n + b.n });
    }
  }
  return blocks.flatMap((b) => new Array<number>(b.n).fill(b.v));
}

/**
 * One kind's curve: the weighted mean change at each age, smoothed by a weighted quadratic in age, shrunk toward the built-in curve by
 * the pairs at each age, and made monotone (a hitter's change never improves with age; a pitcher's never falls).
 */
export function fitAgingKind(pairs: AgingPair[], pitcher: boolean, policyIn = ROSTER_REVIEW_FIT_POLICY.aging, options: { shrink?: boolean } = {}): { values: number[]; cells: Array<{ age: number; n: number; weight: number }> } {
  const { fitAges, tableAges, priorStrength } = policyIn;
  const shrinkToPrior = options.shrink !== false;
  const cells = new Map<number, { s: number; w: number; n: number }>();
  for (const p of pairs) {
    if (p.age < fitAges.from || p.age > fitAges.to) continue;
    const c = cells.get(p.age) ?? { s: 0, w: 0, n: 0 };
    c.s += p.change * p.weight; c.w += p.weight; c.n += 1;
    cells.set(p.age, c);
  }
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const B = [0, 0, 0];
  for (const [age, c] of cells) {
    if (c.w <= 0) continue;
    const x = [1, age - 30, (age - 30) ** 2];
    for (let i = 0; i < 3; i += 1) {
      B[i] += c.w * x[i] * (c.s / c.w);
      for (let j = 0; j < 3; j += 1) A[i][j] += c.w * x[i] * x[j];
    }
  }
  const beta = cells.size >= 3 ? solve(A, B) : null;
  // Fitted over the fit ages only (the monotone projection never pools an age the data does not reach); beyond them the end values hold
  const fitted: number[] = [];
  for (let a = fitAges.from; a <= fitAges.to; a += 1) fitted.push(a);
  const out = fitted.map((age) => {
    const prior = expectedAnnualChange(age, pitcher);
    if (!beta) return { age, value: prior, n: 0, weight: 0 };
    const x = age - 30;
    const raw = beta[0] + beta[1] * x + beta[2] * x * x;
    const n = cells.get(age)?.n ?? 0;
    // Unshrunk (the backtest's out-of-sample curve): the league's own quadratic at every fitted age
    const w = shrinkToPrior ? n / (n + priorStrength) : 1;
    return { age, value: w * raw + (1 - w) * prior, n, weight: w };
  });
  const oriented = out.map((o) => (pitcher ? -o.value : o.value));
  const mono = nonIncreasing(oriented).map((v) => (pitcher ? -v : v));
  const values: number[] = [];
  const cellsOut: Array<{ age: number; n: number; weight: number }> = [];
  for (let a = tableAges.from; a <= tableAges.to; a += 1) {
    const i = Math.min(Math.max(a, fitAges.from), fitAges.to) - fitAges.from;
    values.push(mono[i]);
    cellsOut.push(a >= fitAges.from && a <= fitAges.to ? { age: a, n: out[i].n, weight: out[i].weight } : { age: a, n: 0, weight: out[i].weight });
  }
  return { values, cells: cellsOut };
}

/** The built-in curve as a table (the fallback prior, and what a held-out check compares with). */
export function priorAgingTable(policyIn = ROSTER_REVIEW_FIT_POLICY.aging): AgingTable {
  const ages: number[] = [];
  for (let a = policyIn.tableAges.from; a <= policyIn.tableAges.to; a += 1) ages.push(a);
  return { firstAge: policyIn.tableAges.from, hitter: ages.map((a) => expectedAnnualChange(a, false)), pitcher: ages.map((a) => expectedAnnualChange(a, true)) };
}

const tableAt = (t: AgingTable, age: number, pitcher: boolean) => expectedAnnualChange(age, pitcher, t);

/** Held-out bias of a curve on pairs, per age band, with its standard error clustered by player. */
function bandChecks(held: Array<AgingPair & { predicted: number; prior: number }>, pitcher: boolean, policyIn = ROSTER_REVIEW_FIT_POLICY.aging, prefix = ''): CalibrationCheck[] {
  const kind = `${prefix}${pitcher ? 'pitcher' : 'hitter'}`;
  const tol = pitcher ? policyIn.tolerance.pitcher : policyIn.tolerance.hitter;
  const checks: CalibrationCheck[] = [];
  const biasOf = (hs: typeof held, pick: (p: (typeof held)[number]) => number) => {
    const W = hs.reduce((s, p) => s + p.weight, 0);
    const bias = hs.reduce((s, p) => s + (p.change - pick(p)) * p.weight, 0) / W;
    const cl = new Map<number, number>();
    for (const p of hs) cl.set(p.playerId, (cl.get(p.playerId) ?? 0) + p.weight * (p.change - pick(p) - bias));
    return { bias, se: Math.sqrt([...cl.values()].reduce((s, v) => s + v * v, 0)) / W };
  };
  for (const [lo, hi] of policyIn.bands) {
    const hs = held.filter((p) => p.age >= lo && p.age <= hi);
    if (hs.length === 0) continue;
    const f = biasOf(hs, (p) => p.predicted);
    const pr = biasOf(hs, (p) => p.prior);
    const scored = hs.length >= policyIn.minBandPairs;
    const fails = Math.abs(f.bias) > tol && Math.abs(f.bias) > policyIn.zFail * f.se;
    checks.push({ kind: 'age_band', part: `${kind}:${lo}-${hi}`, n: hs.length, expected: 0, observed: f.bias, se: f.se, prior: pr.bias, passed: scored ? !fails : null, note: scored ? undefined : 'Too few held-out pairs to score.' });
  }
  const W = held.reduce((s, p) => s + p.weight, 0);
  if (W > 0) {
    const mse = (pick: (p: (typeof held)[number]) => number) => held.reduce((s, p) => s + (p.change - pick(p)) ** 2 * p.weight, 0) / W;
    const fitted = mse((p) => p.predicted);
    const none = mse(() => 0);
    checks.push({ kind: 'error', part: `${kind}:against_no_aging`, n: held.length, expected: none, observed: fitted, prior: mse((p) => p.prior), passed: fitted <= none });
  }
  return checks;
}

/**
 * Fit the aging curve through the last completed season and check it by a rolling-origin backtest: each origin t (from the window's
 * start + `originStart`, at most `maxOrigins`, the last being the season before the last) is fitted on the pairs it could have seen
 * and scored on the pair (t, t+1).
 */
export function fitAging(input: AgingInput, basis: FitBasis, policyIn = ROSTER_REVIEW_FIT_POLICY.aging, previous: AgingModel | null = null, detector: DetectorPolicy = DETECTOR_POLICY): CalibrationRun<AgingModel | null> {
  const through = basis.throughSeason as number;
  // The window is the last `windowSeasons` completed seasons (t - windowSeasons + 1 ... t): a pair's first season from its start, its second by t
  const firstOf = (t: number) => t - policyIn.windowSeasons + 1;
  const inWindow = (p: AgingPair, t: number) => p.season + 1 <= t && p.season >= firstOf(t);
  const served = { hitter: input.hitter.filter((p) => inWindow(p, through)), pitcher: input.pitcher.filter((p) => inWindow(p, through)) };
  const windowSeasons = input.seasons.filter((s) => s <= through && s >= firstOf(through));
  const sampleN = served.hitter.length + served.pitcher.length;
  const base = { leagueId: basis.leagueId, subsystem: MLB_CALIBRATION_SUBSYSTEM, component: 'aging', method: AGING_METHOD, basis: { throughSeason: through, gameDate: basis.gameDate }, priorSource: PRIOR_SOURCE.aging };
  const window = { seasons: windowSeasons, skipped: input.skipped.filter((s) => s.season <= through && s.season >= firstOf(through)), sample: sampleN, unit: 'season pairs' };
  if (served.hitter.length < policyIn.minPairs || served.pitcher.length < policyIn.minPairs) {
    return {
      model: null,
      record: { ...base, window, heldOut: [], priorWeight: { overall: 1, byPart: {} }, notes: [],
        gate: { passed: false, reason: `Not fitted: ${served.hitter.length} hitter and ${served.pitcher.length} pitcher season pairs, fewer than ${policyIn.minPairs} each.`, failures: ['sample'] } },
    };
  }
  const h = fitAgingKind(served.hitter, false, policyIn);
  const p = fitAgingKind(served.pitcher, true, policyIn);
  const table: AgingTable = { firstAge: policyIn.tableAges.from, hitter: h.values, pitcher: p.values };
  // Rolling origins. Each origin's curve is scored twice: as served (shrunk toward the starting curve) and unshrunk. The starting curve
  // was fitted on one league's history (the Arizona import, 2000-2025); on that league the shrunk curve has already seen the held-out
  // seasons through it, so its check is not out-of-sample there. The unshrunk curve's check is, and both must pass.
  const candidates = windowSeasons.filter((t) => t >= firstOf(through) + policyIn.originStart && t <= through - 1);
  const origins = candidates.slice(-policyIn.maxOrigins);
  const prior = priorAgingTable(policyIn);
  type Held = AgingPair & { predicted: number; prior: number };
  const held = { hitter: [] as Held[], pitcher: [] as Held[] };
  const heldRaw = { hitter: [] as Held[], pitcher: [] as Held[] };
  for (const t of origins) {
    for (const kind of ['hitter', 'pitcher'] as const) {
      const pitcher = kind === 'pitcher';
      const train = input[kind].filter((x) => inWindow(x, t));
      const asTable = (values: number[]): AgingTable => ({ firstAge: policyIn.tableAges.from, hitter: pitcher ? [] : values, pitcher: pitcher ? values : [] });
      const shrunk = asTable(fitAgingKind(train, pitcher, policyIn).values);
      const raw = asTable(fitAgingKind(train, pitcher, policyIn, { shrink: false }).values);
      for (const x of input[kind].filter((q) => q.season === t)) {
        const pr = tableAt(prior, x.age, pitcher);
        held[kind].push({ ...x, predicted: tableAt(shrunk, x.age, pitcher), prior: pr });
        heldRaw[kind].push({ ...x, predicted: tableAt(raw, x.age, pitcher), prior: pr });
      }
    }
  }
  const heldOut = [
    ...bandChecks(held.hitter, false, policyIn), ...bandChecks(held.pitcher, true, policyIn),
    ...bandChecks(heldRaw.hitter, false, policyIn, 'unshrunk:'), ...bandChecks(heldRaw.pitcher, true, policyIn, 'unshrunk:'),
  ];
  const extra: string[] = [];
  if (origins.length === 0) extra.push('seasons: no season could be held out to check the curve');
  else if (!heldOut.some((c) => c.kind === 'age_band' && c.passed !== null)) extra.push('seasons: no age group had enough held-out players to check the curve');
  // Clearly better than the starting curve? Paired on the same held-out pairs, nested (each origin's curve fitted before it), unshrunk
  // and as served, with hysteresis per kind (D-053 amendment, 2026-09-25). A tuning value replaces its fallback only when clearly better.
  const paired = (hs: Held[]): HeldOutCase[] => hs.map((x) => ({ cluster: x.playerId, origin: x.season, weight: x.weight, candidate: (x.change - x.predicted) ** 2, rival: (x.change - x.prior) ** 2 }));
  const decisions = {
    hitter: decide({ unshrunk: paired(heldRaw.hitter), served: paired(held.hitter), previous: previous?.serve.hitter ?? 'starting', streak: previous?.decisions.hitter?.streak ?? 0 }, detector),
    pitcher: decide({ unshrunk: paired(heldRaw.pitcher), served: paired(held.pitcher), previous: previous?.serve.pitcher ?? 'starting', streak: previous?.decisions.pitcher?.streak ?? 0 }, detector),
  };
  for (const kind of ['hitter', 'pitcher'] as const) {
    const d = decisions[kind];
    for (const [label, c] of [['unshrunk', d.unshrunk], ['served', d.served]] as const) {
      heldOut.push({
        kind: 'detector', part: `${kind}:${label}`, n: c.cases, expected: c.rivalLoss, observed: c.candidateLoss, se: c.se, prior: c.rivalLoss,
        passed: c.failures.includes('origins') ? null : c.clearlyBetter,
        note: `against the starting curve: ${describeComparison(c)}${c.failures.length ? ` (not clearly better: ${c.failures.join(', ')})` : ''}`,
      });
    }
    if (!d.decided) extra.push(`seasons: ${kind}s: ${d.reason}`);
  }
  const serve = { hitter: decisions.hitter.serve, pitcher: decisions.pitcher.serve };
  const priorShare = (cells: Array<{ n: number; weight: number }>) => {
    const n = cells.reduce((s, c) => s + c.n, 0);
    return n > 0 ? cells.reduce((s, c) => s + c.n * (1 - c.weight), 0) / n : 1;
  };
  const byPart = { hitter: serve.hitter === 'save' ? priorShare(h.cells) : 1, pitcher: serve.pitcher === 'save' ? priorShare(p.cells) : 1 };
  const gate = gateOf(heldOut.filter((c) => c.kind !== 'detector'), extra);
  const verdict = gate.passed
    ? {
      ...gate,
      reason: serve.hitter === 'starting' && serve.pitcher === 'starting'
        ? (decisions.hitter.streak > 0 || decisions.pitcher.streak > 0
          ? 'Checked on held-out seasons: this league\'s own curve was clearly better at this refit; the starting curve serves until the next refit confirms it.'
          : 'Checked on held-out seasons: the starting curve held up (this league\'s own was not clearly better), so it serves.')
        : `Checked on held-out seasons: this league's own curve serves for ${[serve.hitter === 'save' ? 'hitters' : null, serve.pitcher === 'save' ? 'pitchers' : null].filter(Boolean).join(' and ')}.`,
    }
    : gate;
  return {
    model: {
      table: { firstAge: table.firstAge, hitter: serve.hitter === 'save' ? table.hitter : [], pitcher: serve.pitcher === 'save' ? table.pitcher : [] },
      fitted: table, serve, decisions, cells: { hitter: h.cells, pitcher: p.cells },
    },
    record: { ...base, window, heldOut, gate: verdict, priorWeight: { overall: (byPart.hitter + byPart.pitcher) / 2, byPart },
      notes: [
        `Checked on ${origins.length} season${origins.length === 1 ? '' : 's'}${origins.length ? ` (${origins[0]}–${origins[origins.length - 1]})` : ''}, each fitted only on the seasons before it.`,
        'The starting curve was fitted on the Arizona import\'s 2000–2025 history. On that league the check of the curve as served (shrunk toward the starting curve) is not out-of-sample, so the curve fitted without the starting curve is checked too, and both must pass.',
        `A curve replaces the starting one only when clearly better on the held-out pairs (${ruleText(detector)}); once serving, it gives way only when the starting curve is clearly better in turn. Hitters: ${decisions.hitter.reason} Pitchers: ${decisions.pitcher.reason}`,
        'The rule\'s error rates were measured by simulation for the results lens only (docs/CALIBRATION.md section 13.3); the aging curve\'s own are not simulated.',
      ] },
  };
}

// ── defense ──────────────────────────────────────────────────────────────────

/** One regular's season at his main position: his batting runs per 600 PA and his fielding runs per 1300 innings (results only). */
export interface DefenseLine {
  playerId: number;
  position: number;
  pa: number;
  batRuns600: number;
  innings: number;
  fieldRuns1300: number;
}

/** A season whose fielding rows carry zone-rating runs, with its players' lines. */
export interface DefenseSeason {
  season: number;
  lines: DefenseLine[];
}

export interface DefenseModel {
  weights: Record<number, number>;
  /** Per position: season pairs read, the measured weight before shrinkage, and the weight it carries. */
  positions: Record<number, { pairs: number; measured: number | null; weight: number }>;
}

const covariance = (a: number[], b: number[]): number => {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  return a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / n;
};

/** Spearman's rank correlation (ties averaged). */
export function rankCorrelation(a: number[], b: number[]): number | null {
  if (a.length < 3) return null;
  const ranks = (xs: number[]) => {
    const order = xs.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && order[j + 1].v === order[i].v) j += 1;
      for (let k = i; k <= j; k += 1) r[order[k].i] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = ranks(a);
  const rb = ranks(b);
  const va = covariance(ra, ra);
  const vb = covariance(rb, rb);
  return va > 0 && vb > 0 ? covariance(ra, rb) / Math.sqrt(va * vb) : null;
}

const POSITIONS = [2, 3, 4, 5, 6, 7, 8, 9];

/** The weights fitted on the season pairs given: repeatable fielding spread against the repeatable bat spread, shrunk toward the prior. */
export function fitDefenseWeights(seasons: DefenseSeason[], prior: Record<number, number> = DEFENSE_WEIGHT, policyIn = ROSTER_REVIEW_FIT_POLICY.defense): DefenseModel {
  const sorted = [...seasons].sort((a, b) => a.season - b.season);
  const positions: DefenseModel['positions'] = {};
  const weights: Record<number, number> = { ...prior };
  for (const pos of POSITIONS) {
    const fa: number[] = []; const fb: number[] = []; const ba: number[] = []; const bb: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].season !== sorted[i - 1].season + 1) continue;
      const next = new Map(sorted[i].lines.filter((l) => l.position === pos).map((l) => [l.playerId, l]));
      for (const a of sorted[i - 1].lines.filter((l) => l.position === pos)) {
        const b = next.get(a.playerId);
        if (!b) continue;
        if (a.innings >= policyIn.minInnings && b.innings >= policyIn.minInnings) { fa.push(a.fieldRuns1300); fb.push(b.fieldRuns1300); }
        if (a.pa >= policyIn.minPa && b.pa >= policyIn.minPa) { ba.push(a.batRuns600); bb.push(b.batRuns600); }
      }
    }
    const p = prior[pos] ?? 0;
    if (fa.length < policyIn.minFielders || ba.length < policyIn.minFielders) {
      positions[pos] = { pairs: fa.length, measured: null, weight: 0 };
      continue;
    }
    const sdDef = Math.sqrt(Math.max(0, covariance(fa, fb)));
    const sdBat = Math.sqrt(Math.max(0, covariance(ba, bb)));
    const measured = sdDef + sdBat > 0 ? sdDef / (sdDef + sdBat) : null;
    if (measured === null) { positions[pos] = { pairs: fa.length, measured: null, weight: 0 }; continue; }
    const s = shrink(measured, p, fa.length, policyIn.priorStrength);
    weights[pos] = s.value;
    positions[pos] = { pairs: fa.length, measured, weight: s.weight };
  }
  weights[10] = 0; // a designated hitter has no glove, by definition
  return { weights, positions };
}

/**
 * The check on the next season: among a position's regulars in season s, the blend (1 - w) x bat percentile + w x glove percentile
 * (both from RESULTS) is ranked against what they produced the season after (batting runs plus fielding runs). The fitted weight must
 * rank them at least as well as the built-in weight, within the tolerance.
 */
function defenseCheck(season: DefenseSeason, next: DefenseSeason, fitted: Record<number, number>, prior: Record<number, number>, policyIn = ROSTER_REVIEW_FIT_POLICY.defense): CalibrationCheck[] {
  const out: CalibrationCheck[] = [];
  const after = new Map(next.lines.map((l) => [`${l.playerId}:${l.position}`, l]));
  for (const pos of POSITIONS) {
    const rows = season.lines.filter((l) => l.position === pos && l.pa >= policyIn.minPa && l.innings >= policyIn.minInnings && after.has(`${l.playerId}:${pos}`));
    if (rows.length < policyIn.minFielders) continue;
    const pct = (xs: number[]) => xs.map((x) => xs.filter((y) => y < x).length / xs.length * 100);
    const batPct = pct(rows.map((r) => r.batRuns600));
    const glovePct = pct(rows.map((r) => r.fieldRuns1300));
    const outcome = rows.map((r) => { const a = after.get(`${r.playerId}:${pos}`) as DefenseLine; return a.batRuns600 + a.fieldRuns1300; });
    const score = (w: number) => rankCorrelation(rows.map((_, i) => (1 - w) * batPct[i] + w * glovePct[i]), outcome);
    const f = score(fitted[pos] ?? 0);
    const p = score(prior[pos] ?? 0);
    out.push({ kind: 'position', part: `defense:${pos}:${season.season}->${next.season}`, n: rows.length, expected: p, observed: f, prior: p, passed: f === null || p === null ? null : f >= p - policyIn.tolerance });
  }
  return out;
}

/** Fit and check the glove weights on the seasons whose fielding rows carry zone rating. */
export function fitDefense(seasons: DefenseSeason[], basis: FitBasis, prior: Record<number, number> = DEFENSE_WEIGHT, policyIn = ROSTER_REVIEW_FIT_POLICY.defense): CalibrationRun<DefenseModel | null> {
  const sorted = [...seasons].filter((s) => basis.throughSeason === null || s.season <= basis.throughSeason).sort((a, b) => a.season - b.season);
  const base = { leagueId: basis.leagueId, subsystem: MLB_CALIBRATION_SUBSYSTEM, component: 'defense', method: DEFENSE_METHOD, basis: { throughSeason: basis.throughSeason, gameDate: basis.gameDate }, priorSource: PRIOR_SOURCE.defense };
  const window = { seasons: sorted.map((s) => s.season), skipped: [], sample: sorted.reduce((n, s) => n + s.lines.length, 0), unit: 'player-seasons with fielding runs' };
  const consecutive = sorted.filter((s, i) => i > 0 && s.season === sorted[i - 1].season + 1).length;
  if (consecutive === 0) {
    return {
      model: null,
      record: { ...base, window, heldOut: [], priorWeight: { overall: 1, byPart: {} },
        gate: { passed: false, reason: "Not fitted: the league's history has no two seasons in a row with fielding runs (zone rating) to measure the glove on.", failures: ['no_zone_rating_pairs'] },
        notes: ['Past seasons of this league carry no zone rating, and its WAR carries no fielding runs, so the glove weights stay the starting values.'] },
    };
  }
  const model = fitDefenseWeights(sorted, prior, policyIn);
  // held out: each season with a next one, fitted on the pairs before it
  const heldOut: CalibrationCheck[] = [];
  for (let i = 1; i < sorted.length - 1; i += 1) {
    if (sorted[i].season !== sorted[i - 1].season + 1 || sorted[i + 1].season !== sorted[i].season + 1) continue;
    const trained = fitDefenseWeights(sorted.slice(0, i + 1), prior, policyIn);
    heldOut.push(...defenseCheck(sorted[i], sorted[i + 1], trained.weights, prior, policyIn));
  }
  const extra = heldOut.every((c) => c.passed === null) ? ['no_later_season: no later season to check the glove weights on yet'] : [];
  const byPart: Record<string, number> = {};
  for (const [pos, v] of Object.entries(model.positions)) byPart[`position:${pos}`] = 1 - v.weight;
  const parts = Object.values(byPart);
  return {
    model,
    record: { ...base, window, heldOut, gate: gateOf(heldOut, extra), priorWeight: { overall: parts.length ? parts.reduce((s, x) => s + x, 0) / parts.length : 1, byPart }, notes: [] },
  };
}

/** The fallback prior of every group, stamped provisional (ROSTER_REVIEW_PRIOR_STAMP): what serves until a save's fit passes. */
export const ROSTER_REVIEW_PRIOR = {
  standards: STARTING_STANDARDS,
  aging: priorAgingTable(),
  agingRows: AGING_CURVE,
  defense: DEFENSE_WEIGHT,
} as const;
