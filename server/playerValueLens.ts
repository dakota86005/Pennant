/**
 * Player Value, the philosophy lens (phase 5b, PLAYER_VALUE.md Part 6; D-052, the D-036 pattern).
 *
 * Pure, and run at read time. It takes a neutral valuation (phase 5a's contract surplus and retention margin, season by
 * season with their components) and the organization's philosophy as handed to it, and returns "our view" beside the
 * neutral one. It never changes a neutral figure, band, price, replacement level, control status or cost, never turns an
 * unknown into a number, and never leans unseen: every lean is named (the dimension, its value, what it did and by how
 * much), and our view always states the neutral figure it started from. A philosophy change recomputes nothing: the lens
 * reads the valuation as handed to it and reaches no production, cost, fit, table or rating.
 *
 * What it may do (Part 6), each a policy weight stamped in `LENS_POLICY`:
 *
 *   competitiveWindow    re-weight the seasons: our discount instead of the neutral 5% (this season's part weighs 1)
 *   riskTolerance        read each season's band from its centre toward its low edge (never above the centre)
 *   teamControl          weigh the seasons the club controls at its option more or less
 *   costEfficiency       weigh his cost against his production, in both views
 *   payrollFlexibility   weigh guaranteed salary in later seasons, in the contract view only: in the retention margin that
 *                        money is owed whatever the club does and cancels, and no philosophy brings sunk money back
 *   the four policies    word emphasis only (aging contracts, arbitration extensions, rentals, salary dumps): no number moves
 *
 * It never reads the club's value of a win (a club fact, not identity), the protection tier or defensibility, and it says
 * no verdict: our view is a reading, not a decision.
 */

import type { CalibrationStamp } from './calibration.js';
import {
  DEFAULT_PHILOSOPHY_POLICIES, PHILOSOPHY_DIMENSIONS, PHILOSOPHY_POLICY_OPTIONS,
  type EffectivePhilosophy, type PhilosophyDimensionId, type PhilosophyPolicies,
} from './philosophy.js';
import { LENS_POLICY, LENS_POLICY_CALIBRATION } from './playerValueCalibration.js';
import type { PlayerSurplus, SurplusFigure, SurplusSeason, SurplusTotal, SurplusView } from './playerValueSurplus.js';

/** The organization's philosophy as the lens reads it: each dimension's effective value and the policies. */
export interface LensPhilosophy {
  dimensions: Partial<Record<PhilosophyDimensionId, number>>;
  policies: PhilosophyPolicies;
}

export interface LensInput {
  neutral: PlayerSurplus;
  philosophy: LensPhilosophy;
  /** Whether the organization whose view this is holds him; null where not established. */
  ours: boolean | null;
}

/** A total restated: its band, and its central or (where a season has none) the range of its centrals. */
export interface LensFigure {
  low: number;
  central: number | null;
  high: number;
  centralRange: { low: number; high: number } | null;
}

/** How far one lean moved our central reading (a point where there is one). */
export interface LensDelta {
  low: number;
  high: number;
}

export interface OurTotal {
  status: 'known' | 'unknown';
  reason: string | null;
  from: number | null;
  to: number | null;
  /** The neutral figure our view started from, as served. */
  neutral: LensFigure | null;
  /** Our view; null exactly where the neutral one is unknown. */
  ours: LensFigure | null;
  /** Where the neutral sum is unknown but a leading run of seasons is known: that run, neutral and ours. */
  established: { from: number; to: number; neutral: LensFigure; ours: LensFigure } | null;
}

export type LensDimension = 'competitiveWindow' | 'riskTolerance' | 'payrollFlexibility' | 'costEfficiency' | 'teamControl';
export type LensPolicy = keyof PhilosophyPolicies;

/** One named lean (a dimension that moved our view) or note (a policy that only words emphasis). */
export interface LensLean {
  kind: 'dimension' | 'policy';
  id: LensDimension | LensPolicy;
  label: string;
  value: number | string;
  /** A few plain words for the card. */
  short: string;
  /** What it did, with its numbers. */
  text: string;
  seasons: number[];
  /** How far it moved our central reading in each view, in order after the leans before it; null where it did not touch that view. */
  by: { contract: LensDelta | null; retention: LensDelta | null; wins: LensDelta | null };
}

/** Every dimension and policy the lens reads, and whether it leaned, with why not where it did not. */
export interface LensRead {
  kind: 'dimension' | 'policy';
  id: LensDimension | LensPolicy;
  label: string;
  value: number | string;
  leaning: boolean;
  text: string;
}

export interface LensSeason {
  season: number;
  part: SurplusSeason['part'];
  neutralWeight: number;
  /** Our weight: our discount, times the team-control weight where the club controls the season. */
  weight: number;
  /** How far toward its low edge the season is read (0: its centre). */
  readAt: number;
  /** The weight on his cost in each view (1: as neutral). */
  costWeight: { contract: number; retention: number };
}

export interface OurView {
  playerId: number;
  status: PlayerSurplus['status'];
  unit: PlayerSurplus['unit'];
  /** Some dimension leaned on a figure. */
  leaning: boolean;
  contract: OurTotal;
  retention: OurTotal;
  wins: OurTotal;
  leans: LensLean[];
  notes: LensLean[];
  read: LensRead[];
  seasons: LensSeason[];
  discount: { neutral: number; ours: number; text: string };
  basis: string[];
  stamp: CalibrationStamp;
}

type ViewKey = 'contract' | 'retention' | 'wins';
const VIEW_KEYS: readonly ViewKey[] = ['contract', 'retention', 'wins'];
/** The order the leans are applied in, and so the order their amounts are stated in. */
const STEP_ORDER: readonly LensDimension[] = ['costEfficiency', 'payrollFlexibility', 'riskTolerance', 'competitiveWindow', 'teamControl'];
const POLICIES_READ: readonly LensPolicy[] = ['agingContracts', 'arbitrationExtensions', 'rentalAcquisitions', 'salaryDumps'];

/** The effective philosophy as the lens reads it. */
export function lensPhilosophyFrom(p: EffectivePhilosophy): LensPhilosophy {
  const dimensions: Partial<Record<PhilosophyDimensionId, number>> = {};
  for (const d of PHILOSOPHY_DIMENSIONS) dimensions[d.id] = p.dimensions[d.id]?.value;
  return { dimensions, policies: { ...p.policies } };
}

// ── words ────────────────────────────────────────────────────────────────────

function money(v: number): string {
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a < 500) return '$0';
  return a >= 1_000_000 ? `${sign}$${(a / 1_000_000).toFixed(1)}M` : `${sign}$${Math.round(a / 1_000)}K`;
}
const signedMoney = (v: number): string => (v > 0 ? `+${money(v)}` : money(v));
const signedWins = (v: number): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} wins`;
const pct = (v: number): string => {
  const x = v * 100;
  return `${Number.isInteger(Math.round(x * 10) / 10) ? Math.round(x) : x.toFixed(1)}%`;
};
const seasonsText = (ys: number[]): string => {
  if (ys.length === 0) return '';
  const sorted = [...ys].sort((a, b) => a - b);
  const contiguous = sorted.every((y, i) => i === 0 || y === sorted[i - 1] + 1);
  if (sorted.length === 1) return String(sorted[0]);
  return contiguous ? `${sorted[0]}–${sorted[sorted.length - 1]}` : sorted.join(', ');
};
const labelOf = (id: PhilosophyDimensionId): string => PHILOSOPHY_DIMENSIONS.find((d) => d.id === id)?.label ?? id;
const POLICY_LABELS: Record<LensPolicy, string> = {
  agingContracts: 'Aging contracts', arbitrationExtensions: 'Arbitration extensions', rentalAcquisitions: 'Rental acquisitions', salaryDumps: 'Salary dumps',
};
function policyValueLabel<K extends LensPolicy>(id: K, value: PhilosophyPolicies[K]): string {
  const options = PHILOSOPHY_POLICY_OPTIONS[id] as ReadonlyArray<{ value: string; label: string }>;
  return options.find((o) => o.value === value)?.label ?? String(value);
}

// ── how far a dimension leans ────────────────────────────────────────────────

/** 0 inside the neutral band; up to +1 at 100 and −1 at 0, growing linearly from the band's edge. */
function leanOf(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return 0;
  const { low, high } = LENS_POLICY.band;
  if (v > high) return Math.min(1, (v - high) / (100 - high));
  if (v < low) return -Math.min(1, (low - v) / low);
  return 0;
}

interface Config {
  rate: number;
  controlFactor: number;
  costFactor: number;
  payrollFactor: number;
  alpha: number;
}

function partsOf(p: LensPhilosophy, neutralRate: number): Record<LensDimension, Partial<Config>> {
  const w = leanOf(p.dimensions.competitiveWindow);
  const rate = w > 0
    ? neutralRate + w * (LENS_POLICY.window.winNowRate - neutralRate)
    : w < 0 ? neutralRate + -w * (LENS_POLICY.window.futureRate - neutralRate) : neutralRate;
  const r = leanOf(p.dimensions.riskTolerance);
  return {
    competitiveWindow: { rate },
    riskTolerance: { alpha: r < 0 ? -r * LENS_POLICY.risk.lowEdgeShare : 0 },
    teamControl: { controlFactor: 1 + leanOf(p.dimensions.teamControl) * LENS_POLICY.teamControl.weight },
    costEfficiency: { costFactor: 1 + leanOf(p.dimensions.costEfficiency) * LENS_POLICY.costEfficiency.weight },
    payrollFlexibility: { payrollFactor: 1 + leanOf(p.dimensions.payrollFlexibility) * LENS_POLICY.payrollFlexibility.weight },
  };
}

// ── the seasons as the lens reads them ───────────────────────────────────────

interface ViewReading {
  low: number;
  high: number;
  cLow: number;
  cHigh: number;
  point: boolean;
  /** The cost this view subtracts (null for wins). */
  cost: { low: number; high: number; central: number | null } | null;
}

interface SeasonReading {
  season: number;
  k: number;
  part: SurplusSeason['part'];
  neutralWeight: number;
  controlled: boolean;
  guaranteedLater: boolean;
  views: Record<ViewKey, ViewReading | null>;
}

/** A season's view as a band with its central (or the range of its readings' centrals, as the neutral sum reads it). */
function readingOf(v: SurplusView, cost: ViewReading['cost']): ViewReading | null {
  if (v.status !== 'known' || !v.band) return null;
  const b = v.band;
  if (b.central !== null) return { low: b.low, high: b.high, cLow: b.central, cHigh: b.central, point: true, cost };
  const cLow = v.centrals.length > 0 ? Math.min(...v.centrals.map((c) => c.low)) : b.low;
  const cHigh = v.centrals.length > 0 ? Math.max(...v.centrals.map((c) => c.high)) : b.high;
  return { low: b.low, high: b.high, cLow, cHigh, point: false, cost };
}

const costOf = (f: SurplusFigure | null): ViewReading['cost'] => (f ? { low: f.low, high: f.high, central: f.central } : null);

function seasonsOf(n: PlayerSurplus): SeasonReading[] {
  const rate = n.discount.rate;
  const controlled = LENS_POLICY.teamControl.controlled as readonly string[];
  return n.seasons.map((s) => {
    const k = s.part === 'rest_of_season' ? 0 : rate > 0 ? Math.round(Math.log(1 / s.weight) / Math.log(1 + rate)) : 1;
    // The contract view subtracts the held cost, or across ways the season can go, the hull of their costs
    const branchCosts = s.branches.map((b) => b.cost).filter((c): c is SurplusFigure => c !== null);
    const contractCost = s.branches.length > 1 && branchCosts.length > 0
      ? { low: Math.min(...branchCosts.map((c) => c.low)), high: Math.max(...branchCosts.map((c) => c.high)), central: null }
      : costOf(s.cost);
    const wins: ViewReading | null = s.wins
      ? { low: s.wins.low, high: s.wins.high, cLow: s.wins.central, cHigh: s.wins.central, point: true, cost: null }
      : null;
    return {
      season: s.season, k, part: s.part, neutralWeight: s.weight,
      controlled: controlled.includes(s.status)
        || (s.status === 'indeterminate' && (s.between ?? []).length > 0 && (s.between ?? []).every((b) => controlled.includes(b))),
      guaranteedLater: k >= 1 && s.owedEitherWay !== null,
      views: {
        contract: readingOf(s.contract, contractCost),
        retention: readingOf(s.retention, costOf(s.onlyIfKept)),
        wins,
      },
    };
  });
}

/** One season of one view under a configuration: its band, its central reading, and its weight. */
function readSeason(s: SeasonReading, key: ViewKey, c: Config, neutralRate: number) {
  const v = s.views[key] as ViewReading;
  let { low, high, cLow, cHigh } = v;
  let costWeight = 1;
  if (v.cost) {
    costWeight = c.costFactor * (key === 'contract' && s.guaranteedLater ? c.payrollFactor : 1);
    const d = costWeight - 1;
    if (d !== 0) {
      if (v.point && v.cost.central !== null) {
        // Exact: the band's edges and its central each subtract the matching cost
        low = v.low - d * v.cost.high;
        high = v.high - d * v.cost.low;
        cLow = v.cLow - d * v.cost.central;
        cHigh = cLow;
      } else {
        // No single cost reading: the adjustment is a range, taken edge against edge (only ever wider)
        const a = d * v.cost.low;
        const b = d * v.cost.high;
        low = v.low - Math.max(a, b);
        high = v.high - Math.min(a, b);
        cLow = v.cLow - Math.max(a, b);
        cHigh = v.cHigh - Math.min(a, b);
      }
    }
  }
  if (c.alpha > 0) {
    cLow -= c.alpha * Math.max(0, cLow - low);
    cHigh -= c.alpha * Math.max(0, cHigh - low);
  }
  const discount = s.part === 'rest_of_season' ? 1 : c.rate === neutralRate ? s.neutralWeight : 1 / (1 + c.rate) ** s.k;
  const weight = discount * (s.controlled ? c.controlFactor : 1);
  return { low, high, cLow, cHigh, point: v.point, weight, costWeight };
}

/** A sum over seasons (all known in the view) under a configuration. */
function sumOf(seasons: SeasonReading[], key: ViewKey, c: Config, neutralRate: number): LensFigure {
  let low = 0;
  let high = 0;
  let cLow = 0;
  let cHigh = 0;
  let point = true;
  for (const s of seasons) {
    const r = readSeason(s, key, c, neutralRate);
    low += r.low * r.weight;
    high += r.high * r.weight;
    cLow += r.cLow * r.weight;
    cHigh += r.cHigh * r.weight;
    point = point && r.point;
  }
  return { low, high, central: point ? cLow : null, centralRange: point ? null : { low: cLow, high: cHigh } };
}

const centralOf = (f: LensFigure): LensDelta =>
  (f.central !== null ? { low: f.central, high: f.central } : f.centralRange ?? { low: f.low, high: f.high });

const figureOf = (t: SurplusTotal): LensFigure | null =>
  (t.status === 'known' && t.low !== null && t.high !== null ? { low: t.low, central: t.central, high: t.high, centralRange: t.centralRange } : null);

/** The seasons a view's figure covers: all of them when the neutral sum is known, else the leading known run. */
function coverOf(n: PlayerSurplus, key: ViewKey, seasons: SeasonReading[]): SeasonReading[] | null {
  const t = n[key];
  if (t.status === 'known') return seasons.every((s) => s.views[key] !== null) ? seasons : null;
  if (!t.established) return null;
  const run = seasons.filter((s) => s.season >= (t.established as { from: number }).from && s.season <= (t.established as { to: number }).to);
  return run.length > 0 && run.every((s) => s.views[key] !== null) ? run : null;
}

// ── our view ─────────────────────────────────────────────────────────────────

/**
 * "Our view" of a player's value (Part 6): the neutral valuation read through the organization's philosophy, beside it.
 * The neutral valuation handed in is never changed; a philosophy that leans on nothing gives the neutral figures exactly.
 */
export function ourViewOf(input: LensInput): OurView {
  const { neutral: n, philosophy: p } = input;
  const rate = n.discount.rate;
  const seasons = seasonsOf(n);
  const parts = partsOf(p, rate);
  const neutralConfig: Config = { rate, controlFactor: 1, costFactor: 1, payrollFactor: 1, alpha: 0 };
  const covers = Object.fromEntries(VIEW_KEYS.map((k) => [k, coverOf(n, k, seasons)])) as Record<ViewKey, SeasonReading[] | null>;
  const known = seasons.filter((s) => VIEW_KEYS.some((k) => s.views[k] !== null && covers[k]?.includes(s)));
  const hasRange = (s: SeasonReading) => VIEW_KEYS.some((k) => {
    const v = s.views[k];
    return v !== null && covers[k]?.includes(s) && (v.cLow > v.low || v.cHigh > v.low);
  });
  const hasCost = (s: SeasonReading, onlyGuaranteed: boolean) => (['contract', 'retention'] as const).some((k) => {
    const v = s.views[k];
    if (!v || !v.cost || !covers[k]?.includes(s) || !(v.cost.high > 0)) return false;
    return !onlyGuaranteed || (k === 'contract' && s.guaranteedLater);
  });

  // Which dimensions can lean here, the seasons each touches, and why not where it cannot
  const dims: Record<LensDimension, { value: number | undefined; lean: number; seasons: number[]; why: string | null }> = {} as never;
  const touch = (id: LensDimension, value: number | undefined, pick: (s: SeasonReading) => boolean, none: string): void => {
    const lean = leanOf(value);
    const label = labelOf(id);
    const touched = known.filter(pick).map((s) => s.season);
    let why: string | null = null;
    if (value === undefined) why = `${label} is not set, so it leans on nothing.`;
    else if (lean === 0) why = `${label} ${value}: inside the neutral band (${LENS_POLICY.band.low} to ${LENS_POLICY.band.high}), so it leans on nothing.`;
    else if (id === 'riskTolerance' && lean > 0) why = `${label} ${value}: our view reads each range at its centre, as the neutral view does; the lens never reads above the centre.`;
    else if (touched.length === 0) why = `${label} ${value}: ${none}, so it leans on nothing.`;
    dims[id] = { value, lean, seasons: touched, why };
  };
  touch('competitiveWindow', p.dimensions.competitiveWindow, (s) => s.k >= 1, 'no later season is counted');
  touch('riskTolerance', p.dimensions.riskTolerance, hasRange, 'no season has a range to read');
  touch('teamControl', p.dimensions.teamControl, (s) => s.controlled, 'no season the club controls at its option is counted');
  touch('costEfficiency', p.dimensions.costEfficiency, (s) => hasCost(s, false), 'no counted season has a cost to weigh');
  touch('payrollFlexibility', p.dimensions.payrollFlexibility, (s) => hasCost(s, true), 'no guaranteed salary after this season is counted');

  // The leans, applied in order; each one's amount is its step
  const figures = (c: Config): Record<ViewKey, LensFigure | null> =>
    Object.fromEntries(VIEW_KEYS.map((k) => [k, covers[k] ? sumOf(covers[k] as SeasonReading[], k, c, rate) : null])) as Record<ViewKey, LensFigure | null>;
  let config: Config = { ...neutralConfig };
  const base = figures(config);
  let before = base;
  const leans: LensLean[] = [];
  for (const id of STEP_ORDER) {
    const d = dims[id];
    if (d.why !== null) continue;
    const next: Config = { ...config, ...parts[id] };
    const after = figures(next);
    const by = Object.fromEntries(VIEW_KEYS.map((k) => {
      const a = after[k];
      const b = before[k];
      if (!a || !b) return [k, null];
      const x = centralOf(a);
      const y = centralOf(b);
      return [k, { low: x.low - y.low, high: x.high - y.high }];
    })) as LensLean['by'];
    const moved = VIEW_KEYS.some((k) => {
      const a = after[k];
      const b = before[k];
      return a !== null && b !== null && JSON.stringify(a) !== JSON.stringify(b);
    });
    if (!moved) {
      d.why = `${labelOf(id)} ${d.value}: it made no difference to the figures.`;
      continue;
    }
    // Payroll flexibility never touches the retention margin: the money it weighs is owed either way there
    if (id === 'payrollFlexibility') by.retention = null;
    if (id === 'payrollFlexibility' || id === 'costEfficiency') by.wins = null;
    leans.push(leanWords(id, d.value as number, d.lean, next, rate, d.seasons, by, n.unit, seasons));
    config = next;
    before = after;
  }

  const leaning = leans.length > 0;
  const totals = Object.fromEntries(VIEW_KEYS.map((k) => {
    const t = n[k];
    const neutralFigure = figureOf(t);
    // A view no lean moved is the neutral figure exactly, not a recomputation of it
    const ours = leaning && JSON.stringify(before[k]) !== JSON.stringify(base[k]) ? before[k] : null;
    if (t.status === 'known') {
      return [k, { status: 'known', reason: null, from: t.from, to: t.to, neutral: neutralFigure, ours: ours ?? neutralFigure, established: null }];
    }
    const e = t.established;
    const established = e ? {
      from: e.from, to: e.to,
      neutral: { low: e.low, central: e.central, high: e.high, centralRange: e.centralRange },
      ours: ours ?? { low: e.low, central: e.central, high: e.high, centralRange: e.centralRange },
    } : null;
    return [k, { status: 'unknown', reason: t.reason, from: t.from, to: t.to, neutral: null, ours: null, established }];
  })) as Record<ViewKey, OurTotal>;

  const notes = notesOf(input, seasons);
  const read: LensRead[] = [
    ...(['competitiveWindow', 'riskTolerance', 'payrollFlexibility', 'costEfficiency', 'teamControl'] as const).map((id) => {
      const lean = leans.find((l) => l.id === id);
      return {
        kind: 'dimension' as const, id, label: labelOf(id), value: dims[id].value ?? 'not set',
        leaning: !!lean, text: lean ? lean.text : (dims[id].why as string),
      };
    }),
    ...POLICIES_READ.map((id) => {
      const note = notes.find((x) => x.id === id);
      const value = p.policies[id];
      const label = POLICY_LABELS[id];
      const isDefault = value === DEFAULT_PHILOSOPHY_POLICIES[id];
      return {
        kind: 'policy' as const, id, label, value, leaning: !!note,
        text: note ? note.text : isDefault
          ? `${label}: ${policyValueLabel(id, value)}, the default: no note.`
          : `${label}: ${policyValueLabel(id, value)}: nothing in his seasons it points at, so no note.`,
      };
    }),
  ];

  const oursRate = config.rate;
  return {
    playerId: n.playerId,
    status: n.status,
    unit: n.unit,
    leaning,
    contract: totals.contract,
    retention: totals.retention,
    wins: totals.wins,
    leans,
    notes,
    read,
    seasons: seasons.map((s) => {
      const hasView = VIEW_KEYS.find((k) => s.views[k] !== null);
      const r = hasView ? readSeason(s, hasView, config, rate) : null;
      return {
        season: s.season, part: s.part, neutralWeight: s.neutralWeight,
        weight: r ? r.weight : s.neutralWeight,
        readAt: hasRange(s) ? config.alpha : 0,
        costWeight: {
          contract: config.costFactor * (s.guaranteedLater ? config.payrollFactor : 1),
          retention: config.costFactor,
        },
      };
    }),
    discount: {
      neutral: rate,
      ours: oursRate,
      text: oursRate === rate
        ? `Our view discounts as the neutral view does, ${pct(rate)} a season.`
        : `Our view discounts at ${pct(oursRate)} a season instead of the neutral ${pct(rate)}; this season's remaining part weighs 1 in both.`,
    },
    basis: [
      "Our view is the neutral value read through this organization's philosophy at read time. The neutral figures are unchanged beside it, and every difference is a named lean with its amount.",
      `A dimension between ${LENS_POLICY.band.low} and ${LENS_POLICY.band.high} leans on nothing; beyond that, its lean grows to its limit at 0 or 100 (policy, stamped).`,
      'The leans are applied in this order, and each amount is its step after the ones before it: cost efficiency, payroll flexibility, risk tolerance, competitive window, team control.',
      'Money owed whatever the club does stays out of the value of keeping him under every philosophy: no lean brings it back.',
      "Our view never turns an unknown into a number, and never reads the club's value of a win, developmental stakes or a development judgment.",
      'The policies only add words: no figure moves.',
    ],
    stamp: LENS_POLICY_CALIBRATION,
  };
}

function leanWords(
  id: LensDimension, value: number, lean: number, c: Config, neutralRate: number, touched: number[],
  by: LensLean['by'], unit: PlayerSurplus['unit'], seasons: SeasonReading[],
): LensLean {
  const label = labelOf(id);
  const amounts = [
    by.contract && unit === 'dollars' ? `contract value ${deltaText(by.contract, signedMoney)}` : null,
    by.retention && unit === 'dollars' ? `value of keeping him ${deltaText(by.retention, signedMoney)}` : null,
    by.wins && unit === 'wins' ? `wins ${deltaText(by.wins, signedWins)}` : null,
  ].filter((x): x is string => x !== null);
  const moved = amounts.length > 0 ? ` In our view: ${amounts.join('; ')}.` : '';
  const high = lean > 0;
  let what: string;
  let short: string;
  switch (id) {
    case 'competitiveWindow': {
      const last = seasons.filter((s) => touched.includes(s.season)).pop();
      const w = last ? 1 / (1 + c.rate) ** last.k : null;
      what = `${label} ${value} (${high ? 'leaning toward winning now' : 'leaning toward the future'}): later seasons are discounted at ${pct(c.rate)} a season instead of the neutral ${pct(neutralRate)}${last && w !== null ? `, so ${last.season} counts ${w.toFixed(2)} against ${last.neutralWeight.toFixed(2)}` : ''}; this season's remaining part counts in full either way.`;
      short = high ? 'win-now: later seasons count less' : 'building: later seasons count more';
      break;
    }
    case 'riskTolerance':
      what = `${label} ${value} (preferring floor and certainty): each season's range is read ${pct(c.alpha)} of the way from its centre toward its low end, never below it.`;
      short = 'cautious: reads toward the low end of each range';
      break;
    case 'teamControl':
      what = `${label} ${value} (${high ? 'a control premium' : 'production matters most'}): the seasons the club controls at its option (${seasonsText(touched)}) count ${pct(Math.abs(c.controlFactor - 1))} ${high ? 'more' : 'less'}.`;
      short = high ? 'control premium: club-controlled years count more' : 'production first: club-controlled years count less';
      break;
    case 'costEfficiency':
      what = `${label} ${value} (${high ? 'maximizing surplus' : 'paying for talent'}): his cost counts ${pct(Math.abs(c.costFactor - 1))} ${high ? 'more' : 'less'} against his production (${seasonsText(touched)}).`;
      short = high ? 'cost-conscious: his salary counts more' : 'pays for talent: his salary counts less';
      break;
    case 'payrollFlexibility':
      what = `${label} ${value} (${high ? 'protecting future flexibility' : 'comfortable with commitments'}): guaranteed salary after this season (${seasonsText(touched)}) counts ${pct(Math.abs(c.payrollFactor - 1))} ${high ? 'more' : 'less'} in the contract value. The value of keeping him is untouched: that money is owed either way.`;
      short = high ? 'flexibility: future guaranteed salary counts more' : 'comfortable with commitments: future guaranteed salary counts less';
      break;
  }
  return { kind: 'dimension', id, label, value, short, text: `${what}${moved}`, seasons: touched, by };
}

const deltaText = (d: LensDelta, fmt: (v: number) => string): string => (d.low === d.high ? fmt(d.low) : `${fmt(d.low)} to ${fmt(d.high)}`);

// ── the policies: words only ─────────────────────────────────────────────────

function notesOf(input: LensInput, seasons: SeasonReading[]): LensLean[] {
  const { neutral: n, philosophy: p } = input;
  const none = { contract: null, retention: null, wins: null };
  const out: LensLean[] = [];
  const note = (id: LensPolicy, short: string, text: string, ys: number[]) => {
    const value = p.policies[id];
    out.push({ kind: 'policy', id, label: POLICY_LABELS[id], value, short, text: `${POLICY_LABELS[id]} (${policyValueLabel(id, value)}): ${text} Words only: no figure moves.`, seasons: ys, by: none });
  };

  const aging = p.policies.agingContracts;
  if (aging !== DEFAULT_PHILOSOPHY_POLICIES.agingContracts) {
    const old = n.seasons.filter((s) => s.age !== null && s.age >= LENS_POLICY.aging.age);
    if (old.length > 0) {
      const ages = old.map((s) => s.age as number);
      const stance = aging === 'avoid' ? 'the organization avoids aging contracts' : aging === 'discourage' ? 'the organization discourages aging contracts' : 'the organization is willing to carry aging contracts';
      note('agingContracts', `aging contract: ${seasonsText(old.map((s) => s.season))} at ${LENS_POLICY.aging.age}+`,
        `${seasonsText(old.map((s) => s.season))} ${old.length === 1 ? 'is a season' : 'are seasons'} at age ${Math.min(...ages) === Math.max(...ages) ? Math.min(...ages) : `${Math.min(...ages)}–${Math.max(...ages)}`}, ${LENS_POLICY.aging.age} or older; ${stance}.`,
        old.map((s) => s.season));
    }
  }

  const arb = p.policies.arbitrationExtensions;
  if (arb !== DEFAULT_PHILOSOPHY_POLICIES.arbitrationExtensions) {
    const ys = n.seasons.filter((s) => s.status === 'arbitration' || (s.status === 'indeterminate' && (s.between ?? []).includes('arbitration'))).map((s) => s.season);
    if (ys.length > 0) {
      note('arbitrationExtensions', `arbitration years: ${seasonsText(ys)}`,
        `his arbitration seasons (or seasons that may be) are ${seasonsText(ys)}; the organization's stance is to ${arb === 'prefer' ? 'prefer extensions that cover arbitration years' : 'avoid extensions over arbitration years'}.`,
        ys);
    }
  }

  const rental = p.policies.rentalAcquisitions;
  if (rental !== DEFAULT_PHILOSOPHY_POLICIES.rentalAcquisitions && input.ours === false && n.status !== 'not_held') {
    const only = n.seasons.length === 1 && n.seasons[0].part === 'rest_of_season' ? n.seasons[0].season : null;
    if (only !== null && !n.seasons[0].ifHeld) {
      note('rentalAcquisitions', `a rental: control ends with ${only}`,
        `another club holds him and his control ends with ${only}, so for this organization he would be a rental.`, [only]);
    }
  }

  const dumps = p.policies.salaryDumps;
  if (dumps !== DEFAULT_PHILOSOPHY_POLICIES.salaryDumps && n.contract.status === 'known') {
    const c = n.contract.central ?? n.contract.centralRange?.high ?? null;
    const owed = seasons.filter((s) => s.guaranteedLater).map((s) => s.season);
    if (c !== null && c < 0 && owed.length > 0) {
      note('salaryDumps', `salary still owed: ${seasonsText(owed)}`,
        `his contract value is below zero (most likely ${money(c)}) with guaranteed salary still owed in ${seasonsText(owed)}; the organization is ${dumps === 'willing' ? 'willing' : 'unwilling'} to move salary.`,
        owed);
    }
  }
  return out;
}
