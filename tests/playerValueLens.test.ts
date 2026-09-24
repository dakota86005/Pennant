import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ourViewOf, projectProduction, surplusOf,
  type ControlSeason, type ControlStatus, type ControlTimeline, type LensFigure, type LensPhilosophy, type OurTotal, type OurView,
  type PlayerSurplus, type ProductionInput, type ProductionLine, type SurplusInput, type SurplusMarket, type SurplusTotal,
} from '../server/playerValue.js';
import { LENS_POLICY, LENS_POLICY_CALIBRATION } from '../server/playerValueCalibration.js';
import { DEFAULT_PHILOSOPHY_POLICIES, DEFAULT_PHILOSOPHY_VALUES, PHILOSOPHY_DIMENSIONS, type PhilosophyPolicies } from '../server/philosophy.js';
import { derivedFrom, fromExport, unknownBecause } from '../server/provenance.js';
import { THIS_SEASON, YEAR, contractRow, factsOf, stateOf, timelineOf } from './playerValueFixtures';

/*
 * Player Value phase 5b: the philosophy lens (PLAYER_VALUE.md Part 6, BEHAVIOR_CASES.md "Player Value", phase 5b).
 * The lens runs at read time on a neutral valuation and returns "our view" beside it. Each case is built from
 * synthetic evidence through the pure surplus (`surplusOf`) and the pure lens (`ourViewOf`). No case names a player
 * or says who is worth more, and none says keep, release or trade.
 */

const SEASON = THIS_SEASON;
const bat = (season: number, pa: number, war: number): ProductionLine => ({ season, opportunities: pa, war });
const regular = (over: Partial<ProductionInput> = {}): ProductionInput => ({
  playerId: 1, season: SEASON, seasonPlayed: 0.3, age: 27,
  batting: [bat(2027, 610, 3.1), bat(2028, 640, 2.8), bat(2029, 600, 3.4), bat(2030, 190, 1.0)],
  pitching: [],
  ...over,
});
const PRICE = { central: 7_000_000, low: 6_000_000, high: 10_000_000 };
const MIN = 780_000;
const market = (over: Partial<SurplusMarket> = {}): SurplusMarket => ({
  price: derivedFrom(PRICE, 'test'), stage: 'opening', label: 'the opening price (the imported market)',
  minimumSalary: fromExport(MIN, 'leagues.rules_minimum_salary'), replacementLevel: 0.293,
  measuredReplacement: 'Replacement from freely available talent: not measured yet.', ...over,
});
const VETERAN = stateOf({ days: 8 * YEAR });
const deal = (first: number, salaries: number[], over: Parameters<typeof contractRow>[0] = {}): ControlTimeline =>
  timelineOf({ state: VETERAN, contract: factsOf(contractRow({ firstSeason: first, years: salaries.length, salary: salaries, ...over })) });
const input = (control: ControlTimeline, over: Partial<SurplusInput> = {}): SurplusInput => ({
  production: projectProduction(regular()), control, majorLeagueDeal: true, market: market(), fortyMan: true, ...over,
});
const season = (y: number, status: ControlStatus, over: Partial<ControlSeason> = {}): ControlSeason => ({
  season: y, status, arbitrationYear: null, superTwo: false, between: [], cost: null, declined: null,
  from: status === 'under_contract' ? 'contract' : 'player_rights', basis: `${status} in ${y}.`, reasons: [], crossings: [], ...over,
});
const band = (low: number, central: number | null, high: number) => derivedFrom({ low, high, central }, 'test');
const timeline = (seasons: ControlSeason[], over: Partial<ControlTimeline> = {}): ControlTimeline => ({
  playerId: 1, holder: fromExport(1, 'players.organization_id'), standing: 'held', thisSeason: SEASON, seasons,
  controlEnds: seasons.find((s) => s.status === 'free_agent')?.season ?? null, continuesPastHorizon: false, extensionSigned: false,
  eligibility: null, notes: [], ...over,
});
/** This season at the minimum, two renewals, an arbitration season, then free agency. */
const controlled = (): ControlTimeline => timeline([
  season(2030, 'under_contract', { cost: fromExport({ low: MIN, high: MIN }, 'players_contract.salary0') }),
  season(2031, 'pre_arbitration', { cost: band(MIN, 785_000, 790_000) }),
  season(2032, 'pre_arbitration', { cost: band(MIN, 785_000, 790_000) }),
  season(2033, 'arbitration', { arbitrationYear: { low: 1, high: 1 }, cost: band(2_000_000, 4_500_000, 9_000_000) }),
  season(2034, 'free_agent'),
]);

/** The neutral valuations every property is checked on: controlled, guaranteed, an option, an old deal, unknowns, wins only, unsigned. */
function neutrals(): Array<[string, PlayerSurplus]> {
  const guaranteed = surplusOf(input(deal(2028, [8e6, 8e6, 30e6, 30e6, 30e6])));
  const option = surplusOf(input(deal(2029, [10e6, 10e6, 10e6, 10e6], { teamOption: 1 })));
  const old = surplusOf(input(deal(2029, [20e6, 20e6, 20e6, 20e6]), { production: projectProduction(regular({ age: 34 })) }));
  const unknownSeason = surplusOf(input(timeline([
    season(2030, 'under_contract', { cost: fromExport({ low: MIN, high: MIN }, 'players_contract.salary0') }),
    season(2031, 'pre_arbitration', { cost: band(MIN, 785_000, 790_000) }),
    season(2032, 'indeterminate', { between: ['pre_arbitration', 'arbitration'], cost: null }),
    season(2033, 'free_agent'),
  ])));
  const winsOnly = surplusOf(input(controlled(), { market: market({ price: unknownBecause('not_exported_by_ootp', null, 'The league runs no financials.') }) }));
  const unsigned = surplusOf(input(timeline([], { standing: 'unsigned', thisSeason: null })));
  const noProduction = surplusOf(input(controlled(), { production: { ...projectProduction(regular()), status: 'unknown', reason: 'His production is not established.', seasons: [] } as never }));
  return [
    ['controlled', surplusOf(input(controlled()))], ['guaranteed', guaranteed], ['option', option], ['old', old],
    ['unknown season', unknownSeason], ['wins only', winsOnly], ['unsigned', unsigned], ['no production', noProduction],
  ];
}

/** A deterministic stream of philosophies: every dimension anywhere from 0 to 100, every policy any of its values. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const POLICY_VALUES: { [K in keyof PhilosophyPolicies]: Array<PhilosophyPolicies[K]> } = {
  agingContracts: ['avoid', 'discourage', 'neutral', 'willing'],
  arbitrationExtensions: ['avoid', 'selective', 'prefer'],
  rentalAcquisitions: ['never', 'contending', 'normal', 'aggressive'],
  salaryDumps: ['avoid', 'neutral', 'willing'],
};
const pick = <T>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)];
function philosophy(values: Partial<Record<string, number>> = {}, policies: Partial<PhilosophyPolicies> = {}): LensPhilosophy {
  return { dimensions: { ...DEFAULT_PHILOSOPHY_VALUES, ...values }, policies: { ...DEFAULT_PHILOSOPHY_POLICIES, ...policies } };
}
function randomPhilosophies(n: number, seed = 7, range: [number, number] = [0, 100]): LensPhilosophy[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => philosophy(
    Object.fromEntries(PHILOSOPHY_DIMENSIONS.map((d) => [d.id, Math.round(range[0] + r() * (range[1] - range[0]))])),
    {
      agingContracts: pick(r, POLICY_VALUES.agingContracts), arbitrationExtensions: pick(r, POLICY_VALUES.arbitrationExtensions),
      rentalAcquisitions: pick(r, POLICY_VALUES.rentalAcquisitions), salaryDumps: pick(r, POLICY_VALUES.salaryDumps),
    },
  ));
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

const LENS_DIMENSIONS = ['competitiveWindow', 'riskTolerance', 'payrollFlexibility', 'costEfficiency', 'teamControl'];
const LENS_POLICIES = ['agingContracts', 'arbitrationExtensions', 'rentalAcquisitions', 'salaryDumps'];
const VIEWS = ['contract', 'retention', 'wins'] as const;

/** A neutral total as the lens restates it. */
const figureOf = (t: SurplusTotal): LensFigure | null =>
  (t.status === 'known' && t.low !== null && t.high !== null ? { low: t.low, central: t.central, high: t.high, centralRange: t.centralRange } : null);
/** The central reading as a range (a point where there is one). */
const centralOf = (f: LensFigure): { low: number; high: number } =>
  (f.central !== null ? { low: f.central, high: f.central } : f.centralRange ?? { low: f.low, high: f.high });
const same = (a: LensFigure | null, b: LensFigure | null) => JSON.stringify(a) === JSON.stringify(b);

const view = (n: PlayerSurplus, p: LensPhilosophy, ours: boolean | null = true): OurView => ourViewOf({ neutral: n, philosophy: p, ours });

describe('the lens never changes the neutral value', () => {
  it('every neutral figure, band, price, cost, control status, weight and unknown is identical under every philosophy, and the valuation handed to it is never altered', () => {
    for (const [name, n] of neutrals()) {
      const before = JSON.stringify(n);
      deepFreeze(n);
      for (const p of randomPhilosophies(150, name.length)) {
        const v = view(n, p);
        expect(JSON.stringify(n), name).toBe(before);
        for (const k of VIEWS) {
          const t = n[k];
          expect(v[k].neutral, `${name} ${k}`).toEqual(figureOf(t));
          expect(v[k].status, `${name} ${k}`).toBe(t.status);
          expect([v[k].from, v[k].to]).toEqual([t.from, t.to]);
        }
      }
    }
  });

  it('our view always states the neutral figure it started from, and serves it beside the neutral valuation, never in place of it', () => {
    const n = surplusOf(input(controlled()));
    const v = view(n, philosophy({ competitiveWindow: 90, riskTolerance: 10 }));
    expect(v.contract.neutral).toEqual(figureOf(n.contract));
    expect(v.retention.neutral).toEqual(figureOf(n.retention));
    expect(v.contract.ours).not.toEqual(v.contract.neutral);
    expect(v.discount.neutral).toBe(n.discount.rate);
    expect(v).not.toHaveProperty('seasons.0.contract');
    expect(v.stamp).toBe(LENS_POLICY_CALIBRATION);
  });
});

describe('a philosophy that leans on nothing', () => {
  it('every dimension in the neutral band and the default policies: our view is the neutral view exactly, with no lean and no note', () => {
    for (const [name, n] of neutrals()) {
      for (const p of [philosophy(), ...randomPhilosophies(40, 3, [LENS_POLICY.band.low, LENS_POLICY.band.high]).map((q) => ({ ...q, policies: { ...DEFAULT_PHILOSOPHY_POLICIES } }))]) {
        const v = view(n, p);
        expect(v.leans, name).toEqual([]);
        expect(v.notes, name).toEqual([]);
        expect(v.leaning, name).toBe(false);
        for (const k of VIEWS) expect(v[k].ours, `${name} ${k}`).toEqual(v[k].neutral);
        expect(v.discount.ours).toBe(v.discount.neutral);
      }
    }
  });
});

describe('every difference between our view and neutral names the dimension that made it', () => {
  it('under any philosophy, a difference has leans, each naming a dimension the lens reads, its value, what it did and by how much, and the steps add up to the difference', () => {
    for (const [name, n] of neutrals()) {
      for (const p of randomPhilosophies(120, 11 + name.length)) {
        const v = view(n, p);
        for (const k of VIEWS) {
          const t = v[k];
          if (!t.ours || !t.neutral) continue;
          const differs = !same(t.ours, t.neutral);
          if (differs) expect(v.leans.length, `${name} ${k}`).toBeGreaterThan(0);
          const steps = v.leans.map((l) => l.by[k]).filter((d): d is { low: number; high: number } => d !== null);
          const sum = steps.reduce((a, d) => ({ low: a.low + d.low, high: a.high + d.high }), { low: 0, high: 0 });
          const o = centralOf(t.ours);
          const z = centralOf(t.neutral);
          expect(o.low - z.low, `${name} ${k}`).toBeCloseTo(sum.low, 0);
          expect(o.high - z.high, `${name} ${k}`).toBeCloseTo(sum.high, 0);
        }
        for (const l of v.leans) {
          expect(l.kind).toBe('dimension');
          expect(LENS_DIMENSIONS).toContain(l.id);
          expect(l.value).toBe(p.dimensions[l.id as keyof typeof p.dimensions]);
          expect(l.text).toContain(String(l.value));
          expect(l.short.length).toBeGreaterThan(0);
          expect(l.seasons.length).toBeGreaterThan(0);
        }
        for (const note of v.notes) {
          expect(note.kind).toBe('policy');
          expect(LENS_POLICIES).toContain(note.id);
          expect(note.by).toEqual({ contract: null, retention: null, wins: null });
        }
      }
    }
  });

  it('one dimension at a time: our view differs only where that dimension leans, and names it; a dimension the lens does not read moves nothing', () => {
    const n = surplusOf(input(controlled()));
    for (const d of PHILOSOPHY_DIMENSIONS.map((x) => x.id)) {
      for (const value of [0, 100]) {
        const v = view(n, philosophy({ [d]: value }));
        const differs = VIEWS.some((k) => !same(v[k].ours, v[k].neutral));
        if (!LENS_DIMENSIONS.includes(d)) {
          expect(differs, d).toBe(false);
          expect(v.leans, d).toEqual([]);
          continue;
        }
        if (differs) expect(v.leans.map((l) => l.id), `${d} ${value}`).toEqual([d]);
        else expect(v.leans, `${d} ${value}`).toEqual([]);
      }
    }
  });

  it('a dimension the lens reads but that does not lean says why', () => {
    const n = surplusOf(input(deal(2028, [8e6, 8e6, 30e6, 30e6, 30e6])));
    const v = view(n, philosophy({ teamControl: 95, riskTolerance: 90 }));
    const read = Object.fromEntries(v.read.map((r) => [r.id, r]));
    for (const id of [...LENS_DIMENSIONS, ...LENS_POLICIES]) expect(read[id], id).toBeDefined();
    expect(read.teamControl.leaning).toBe(false);
    expect(read.teamControl.text).toMatch(/no season/i);
    expect(read.riskTolerance.leaning).toBe(false);
    expect(read.riskTolerance.text).toMatch(/centre|center/i);
    expect(read.competitiveWindow.leaning).toBe(false);
    expect(read.competitiveWindow.text).toMatch(/neutral/i);
  });
});

describe('what each lean may do', () => {
  const n = surplusOf(input(controlled()));

  it('the competitive window re-weights the seasons against the neutral 5%: a win-now club counts later seasons less, a club building for the future more; this season\'s part always weighs 1', () => {
    const now = view(n, philosophy({ competitiveWindow: 100 }));
    const future = view(n, philosophy({ competitiveWindow: 0 }));
    expect(now.discount.ours).toBeGreaterThan(now.discount.neutral);
    expect(future.discount.ours).toBeLessThan(future.discount.neutral);
    for (const s of now.seasons) {
      if (s.part === 'rest_of_season') expect(s.weight).toBe(1);
      else expect(s.weight).toBeLessThan(s.neutralWeight);
    }
    for (const s of future.seasons) if (s.part !== 'rest_of_season') expect(s.weight).toBeGreaterThan(s.neutralWeight);
    const lean = now.leans.find((l) => l.id === 'competitiveWindow')!;
    expect(lean.text).toMatch(/5%/);
    expect(now.contract.ours!.central!).toBeLessThan(now.contract.neutral!.central!);
    expect(future.contract.ours!.central!).toBeGreaterThan(future.contract.neutral!.central!);
  });

  it('risk tolerance reads each season from its centre toward its low edge, never below the low edge and never above the centre; a club accepting variance reads the centre', () => {
    const averse = view(n, philosophy({ riskTolerance: 0 }));
    const bold = view(n, philosophy({ riskTolerance: 100 }));
    expect(averse.contract.ours!.central!).toBeLessThan(averse.contract.neutral!.central!);
    expect(averse.contract.ours!.central!).toBeGreaterThanOrEqual(averse.contract.neutral!.low);
    expect(averse.contract.ours!.low).toBe(averse.contract.neutral!.low);
    expect(averse.contract.ours!.high).toBe(averse.contract.neutral!.high);
    for (const s of averse.seasons) expect(s.readAt).toBeLessThanOrEqual(LENS_POLICY.risk.lowEdgeShare);
    expect(bold.contract.ours).toEqual(bold.contract.neutral);
    expect(bold.leans).toEqual([]);
  });

  it('team control weighs only the seasons the club controls at its option (pre-arbitration, arbitration, the reserve clause, a club option)', () => {
    const v = view(n, philosophy({ teamControl: 100 }));
    const lean = v.leans.find((l) => l.id === 'teamControl')!;
    expect(lean.seasons).toEqual([2031, 2032, 2033]);
    const signed = v.seasons.find((s) => s.season === 2030)!;
    expect(signed.weight).toBe(signed.neutralWeight);
    for (const y of [2031, 2032, 2033]) {
      const s = v.seasons.find((x) => x.season === y)!;
      expect(s.weight).toBeCloseTo(s.neutralWeight * (1 + LENS_POLICY.teamControl.weight), 10);
    }
    const guaranteed = view(surplusOf(input(deal(2028, [8e6, 8e6, 30e6, 30e6, 30e6]))), philosophy({ teamControl: 100 }));
    expect(guaranteed.leans).toEqual([]);
  });

  it('cost efficiency weighs his cost against his production, in both views; payroll flexibility weighs guaranteed salary in later seasons, in the contract view only', () => {
    const g = surplusOf(input(deal(2028, [8e6, 8e6, 30e6, 30e6, 30e6])));
    const thrifty = view(g, philosophy({ costEfficiency: 100 }));
    expect(thrifty.contract.ours!.central!).toBeLessThan(thrifty.contract.neutral!.central!);
    const flexible = view(g, philosophy({ payrollFlexibility: 100 }));
    expect(flexible.contract.ours!.central!).toBeLessThan(flexible.contract.neutral!.central!);
    expect(flexible.retention.ours).toEqual(flexible.retention.neutral);
    expect(flexible.leans.find((l) => l.id === 'payrollFlexibility')!.by.retention).toBeNull();
    // A controlled player's costs exist only if he is kept: cost efficiency leans on his retention view too
    const young = view(n, philosophy({ costEfficiency: 100 }));
    expect(young.retention.ours!.central!).toBeLessThan(young.retention.neutral!.central!);
  });

  it('sunk salary never favours keeping a player in our view either: raising a guarantee changes our retention view no more than the neutral one', () => {
    const modest = surplusOf(input(deal(2028, [8e6, 8e6, 8e6, 8e6, 8e6])));
    const rich = surplusOf(input(deal(2028, [8e6, 8e6, 30e6, 30e6, 30e6])));
    for (const p of randomPhilosophies(120, 5)) {
      expect(view(rich, p).retention.ours).toEqual(view(modest, p).retention.ours);
      const a = view(rich, p).contract.ours!;
      const b = view(modest, p).contract.ours!;
      expect(a.central!).toBeLessThan(b.central!);
    }
  });
});

describe('the lens cannot turn an unknown into a number', () => {
  it('a season or a sum that is unknown in the neutral view is unknown in ours, with the same reason', () => {
    for (const [name, n] of neutrals()) {
      for (const p of randomPhilosophies(60, 23)) {
        const v = view(n, p);
        for (const k of VIEWS) {
          const t: OurTotal = v[k];
          if (n[k].status === 'unknown') {
            expect(t.ours, `${name} ${k}`).toBeNull();
            expect(t.reason, `${name} ${k}`).toBe(n[k].reason);
            if (n[k].established) {
              expect(t.established!.neutral.low).toBe(n[k].established!.low);
              expect([t.established!.from, t.established!.to]).toEqual([n[k].established!.from, n[k].established!.to]);
            } else expect(t.established).toBeNull();
          }
        }
        for (const x of Object.values(v.seasons)) expect(Number.isFinite(x.weight)).toBe(true);
      }
    }
  });
});

describe('the policies only word emphasis', () => {
  const old = surplusOf(input(deal(2029, [20e6, 20e6, 20e6, 20e6]), { production: projectProduction(regular({ age: 34 })) }));

  it('a note names the policy and the seasons or facts it points at, and no number moves', () => {
    const plain = view(old, philosophy());
    const aging = view(old, philosophy({}, { agingContracts: 'discourage' }));
    expect(aging.notes.map((x) => x.id)).toEqual(['agingContracts']);
    expect(aging.notes[0].seasons.length).toBeGreaterThan(0);
    expect(aging.notes[0].text).toMatch(new RegExp(String(LENS_POLICY.aging.age)));
    for (const k of VIEWS) expect(aging[k].ours).toEqual(plain[k].ours);
    expect(aging.leans).toEqual([]);

    const arb = view(surplusOf(input(controlled())), philosophy({}, { arbitrationExtensions: 'prefer' }));
    expect(arb.notes.map((x) => x.id)).toEqual(['arbitrationExtensions']);
    expect(arb.notes[0].seasons).toEqual([2033]);
  });

  it('a rental is read only for a player another club holds whose control ends with this season', () => {
    const rental = surplusOf(input(deal(2027, [9e6, 9e6, 9e6, 9e6])));
    expect(rental.seasons.map((s) => s.season)).toEqual([2030]);
    expect(view(rental, philosophy({}, { rentalAcquisitions: 'never' }), false).notes.map((x) => x.id)).toEqual(['rentalAcquisitions']);
    expect(view(rental, philosophy({}, { rentalAcquisitions: 'never' }), true).notes).toEqual([]);
  });

  it('a salary-dump note reads a contract whose value is below zero with guaranteed salary still to come', () => {
    const heavy = surplusOf(input(deal(2028, [35e6, 35e6, 35e6, 35e6, 35e6])));
    const v = view(heavy, philosophy({}, { salaryDumps: 'willing' }));
    expect(v.notes.map((x) => x.id)).toEqual(['salaryDumps']);
    expect(view(surplusOf(input(controlled())), philosophy({}, { salaryDumps: 'willing' })).notes).toEqual([]);
  });

  it('no lean or note says what to do', () => {
    for (const [, n] of neutrals()) {
      for (const p of randomPhilosophies(40, 31)) {
        const v = view(n, p, false);
        const words = [...v.leans, ...v.notes].flatMap((l) => [l.text, l.short]).concat(v.read.map((r) => r.text), v.basis).join(' ');
        expect(words).not.toMatch(/\b(should|recommend\w*|release him|keep him|trade him|extend him|sign him|buy|sell)\b/i);
      }
    }
  });
});

describe('changing philosophy recomputes nothing', () => {
  it('the lens reads the neutral valuation as handed to it: it reaches no production, cost, fit, table, rating, tier, defensibility or club value of a win', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'server', 'playerValueLens.ts'), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports.filter((i) => !['./calibration.js', './philosophy.js', './playerValueCalibration.js', './playerValueSurplus.js'].includes(i))).toEqual([]);
    expect(source).not.toMatch(/\bdb\.|prepare\(|projectProduction|priceControlTimeline|surplusOf\(|scoutedEvidence|players_value|developmentFit|developmentalContext|prospectDecision|winValue|posture|playoff/);
    // Nothing that edits a philosophy reaches Player Value
    const settings = fs.readFileSync(path.join(process.cwd(), 'server', 'settings.ts'), 'utf8');
    expect(settings).not.toMatch(/playerValue/);
  });
});
