import { describe, expect, it } from 'vitest';
import {
  combineTradeFigures, controlSummaryOf, ourViewOf, productionHeadlineOf, projectProduction, surplusOf, tradeValueOf,
  type ControlSeason, type ControlStatus, type ControlTimeline, type LensPhilosophy, type PlayerSurplus, type ProductionInput,
  type ProductionLine, type SurplusInput, type SurplusMarket, type SurplusTotal, type TradeEntryInput, type TradeFigure,
} from '../server/playerValue.js';
import { TRADE_COMBINATION_POLICY, TRADE_COMBINATION_POLICY_CALIBRATION } from '../server/playerValueCalibration.js';
import { DEFAULT_PHILOSOPHY_POLICIES, DEFAULT_PHILOSOPHY_VALUES, PHILOSOPHY_DIMENSIONS, type PhilosophyPolicies } from '../server/philosophy.js';
import { derivedFrom, fromExport, unknownBecause } from '../server/provenance.js';
import { THIS_SEASON, YEAR, contractRow, factsOf, stateOf, timelineOf } from './playerValueFixtures';

/*
 * Player Value phase 6b: a trade read on Player Value (PLAYER_VALUE.md Part 8, consumer 3; owner Q-8; BEHAVIOR_CASES.md
 * "Player Value", phase 6b). Both sides' decompositions side by side; each side's total and the difference between the
 * sides as a band with its components, players combined as independent (the owner's Payroll rule, extended here and
 * said), what is not noise kept at its edges. Built from synthetic evidence through the pure surplus (`surplusOf`), the
 * pure lens (`ourViewOf`) and the pure trade reading (`tradeValueOf`). No case names a player or says who is worth more,
 * and none says accept, reject, win or lose.
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
const controlled = (): ControlTimeline => timeline([
  season(2030, 'under_contract', { cost: fromExport({ low: MIN, high: MIN }, 'players_contract.salary0') }),
  season(2031, 'pre_arbitration', { cost: band(MIN, 785_000, 790_000) }),
  season(2032, 'pre_arbitration', { cost: band(MIN, 785_000, 790_000) }),
  season(2033, 'arbitration', { arbitrationYear: { low: 1, high: 1 }, cost: band(2_000_000, 4_500_000, 9_000_000) }),
  season(2034, 'free_agent'),
]);

/** Real neutral valuations, each with its own id. */
const valued = (id: number, control: ControlTimeline, over: Partial<SurplusInput> = {}): PlayerSurplus =>
  ({ ...surplusOf(input(control, over)), playerId: id });
const cheap = (id: number) => valued(id, controlled());
const guaranteed = (id: number) => valued(id, deal(2028, [8e6, 8e6, 30e6, 30e6, 30e6]));
const option = (id: number) => valued(id, deal(2029, [10e6, 10e6, 10e6, 10e6], { teamOption: 1 }));
const old = (id: number) => valued(id, deal(2029, [20e6, 20e6, 20e6, 20e6]), { production: projectProduction(regular({ age: 34 })) });
const unknownSeason = (id: number) => valued(id, timeline([
  season(2030, 'under_contract', { cost: fromExport({ low: MIN, high: MIN }, 'players_contract.salary0') }),
  season(2031, 'pre_arbitration', { cost: band(MIN, 785_000, 790_000) }),
  season(2032, 'indeterminate', { between: ['pre_arbitration', 'arbitration'], cost: null }),
  season(2033, 'free_agent'),
]));
const noProduction = (id: number) => valued(id, controlled(), {
  production: { ...projectProduction(regular()), status: 'unknown', reason: 'His production is not established.', seasons: [] } as never,
});
const winsOnly = (id: number) => valued(id, controlled(), { market: market({ price: unknownBecause('not_exported_by_ootp', null, 'The league runs no financials.') }) });

const entry = (s: PlayerSurplus | null, over: Partial<TradeEntryInput> = {}): TradeEntryInput => ({ playerId: s?.playerId ?? 999, surplus: s, ...over });
const figureOf = (t: SurplusTotal): TradeFigure => ({ low: t.low as number, central: t.central, high: t.high as number, centralRange: t.centralRange });
/** The most likely reading's edges: the central, or the range of centrals where a season is open. */
const mostLikely = (f: TradeFigure) => (f.central !== null ? { low: f.central, high: f.central } : (f.centralRange as { low: number; high: number }));

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
function randomPhilosophies(n: number, seed = 11): LensPhilosophy[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({
    dimensions: { ...DEFAULT_PHILOSOPHY_VALUES, ...Object.fromEntries(PHILOSOPHY_DIMENSIONS.map((d) => [d.id, Math.round(r() * 100)])) },
    policies: {
      ...DEFAULT_PHILOSOPHY_POLICIES,
      agingContracts: pick(r, POLICY_VALUES.agingContracts), arbitrationExtensions: pick(r, POLICY_VALUES.arbitrationExtensions),
      rentalAcquisitions: pick(r, POLICY_VALUES.rentalAcquisitions), salaryDumps: pick(r, POLICY_VALUES.salaryDumps),
    },
  }));
}

/** Words that would make a reading a verdict. "wins" alone is the unit, so only the verdict phrases are banned. */
const VERDICT = /\b(?:win|wins|won|lose|loses|lost|winning|losing)\s+(?:the|this)\s+(?:trade|deal)\b|\baccept\w*|\breject\w*|\bshould\b|\brecommend\w*|\bfair\b|\bunfair\b|\bsteal\b|\bfleec\w*|\brip-?off\b|\boverpa(?:y|id)\s+for\b/i;

describe('a trade read on Player Value', () => {
  it('each player carries the contract value and the value of keeping him as every read serves them, never narrowed', () => {
    const a = guaranteed(1);
    const b = cheap(2);
    const t = tradeValueOf({ sent: [entry(a)], received: [entry(b)] });
    expect(t.unit).toBe('dollars');
    expect(t.sent.players[0].contract).toEqual(figureOf(a.contract));
    expect(t.sent.players[0].keeping).toEqual(figureOf(a.retention));
    expect(t.received.players[0].contract).toEqual(figureOf(b.contract));
    expect(t.received.players[0].keeping).toEqual(figureOf(b.retention));
    expect(t.sent.players[0].counted).toBe(true);
    // One player on a side: the side is his own band exactly
    expect(t.sent.total.figure).toEqual(figureOf(a.contract));
    expect(t.received.total.figure).toEqual(figureOf(b.contract));
  });

  it('the difference between two sides is a band with its components, never a point or a verdict: what comes in less what goes out', () => {
    const sent = [guaranteed(1), option(2)];
    const received = [cheap(3), old(4)];
    const t = tradeValueOf({ sent: sent.map((s) => entry(s)), received: received.map((s) => entry(s)) });
    const d = t.difference;
    expect(d.status).toBe('known');
    const f = d.figure as TradeFigure;
    // Never a point: a band, and it contains its most likely reading
    expect(f.high).toBeGreaterThan(f.low);
    const ml = mostLikely(f);
    expect(f.low).toBeLessThanOrEqual(ml.low + 1e-6);
    expect(f.high).toBeGreaterThanOrEqual(ml.high - 1e-6);
    // What comes in less what goes out, each player's signed part named
    expect(d.components.map((c) => [c.playerId, c.sign])).toEqual([[1, -1], [2, -1], [3, 1], [4, 1]]);
    // Each part is the player's own figure, signed: a player going out subtracts his highest from the lowest
    for (const c of d.components) {
      const own = figureOf((c.side === 'sent' ? sent : received).find((s) => s.playerId === c.playerId)!.contract);
      expect(c.part.low).toBeCloseTo(c.sign > 0 ? own.low : -own.high, 0);
      expect(c.part.high).toBeCloseTo(c.sign > 0 ? own.high : -own.low, 0);
    }
    expect(ml.low).toBeCloseTo(d.components.reduce((s, c) => s + mostLikely(c.part).low, 0), 0);
    expect(ml.high).toBeCloseTo(d.components.reduce((s, c) => s + mostLikely(c.part).high, 0), 0);
    // The option's open season keeps the most likely a range, never a chosen point
    expect(f.central).toBeNull();
    expect(f.centralRange).not.toBeNull();
    // No verdict anywhere in what it says
    expect(JSON.stringify(t)).not.toMatch(VERDICT);
  });

  it('players are combined as independent, and it says so: inside the every-player-at-his-edge sum, around the sum of most likely readings, never narrower than any one player\'s own distance', () => {
    const r = rng(3);
    const makers = [cheap, guaranteed, option, old];
    for (let trial = 0; trial < 40; trial += 1) {
      const n = 1 + Math.floor(r() * 4);
      const m = 1 + Math.floor(r() * 4);
      const sent = Array.from({ length: n }, (_, i) => pick(r, makers)(100 + i));
      const received = Array.from({ length: m }, (_, i) => pick(r, makers)(200 + i));
      const t = tradeValueOf({ sent: sent.map((s) => entry(s)), received: received.map((s) => entry(s)) });
      for (const [side, players] of [[t.sent, sent], [t.received, received]] as const) {
        const f = side.total.figure as TradeFigure;
        const edges = side.total.edges as { low: number; high: number };
        expect(edges.low).toBeCloseTo(players.reduce((s, p) => s + (p.contract.low as number), 0), 0);
        expect(edges.high).toBeCloseTo(players.reduce((s, p) => s + (p.contract.high as number), 0), 0);
        expect(f.low).toBeGreaterThanOrEqual(edges.low - 1e-6);
        expect(f.high).toBeLessThanOrEqual(edges.high + 1e-6);
        const ml = mostLikely(f);
        expect(f.low).toBeLessThanOrEqual(ml.low + 1e-6);
        expect(f.high).toBeGreaterThanOrEqual(ml.high - 1e-6);
        // No player's own distance from his most likely is narrowed by combining
        for (const p of players) {
          const own = mostLikely(figureOf(p.contract));
          expect(ml.low - f.low).toBeGreaterThanOrEqual(own.low - (p.contract.low as number) - 1e-6);
          expect(f.high - ml.high).toBeGreaterThanOrEqual((p.contract.high as number) - own.high - 1e-6);
        }
      }
      const d = t.difference.figure as TradeFigure;
      const de = t.difference.edges as { low: number; high: number };
      expect(de.low).toBeCloseTo(received.reduce((s, p) => s + (p.contract.low as number), 0) - sent.reduce((s, p) => s + (p.contract.high as number), 0), 0);
      expect(d.low).toBeGreaterThanOrEqual(de.low - 1e-6);
      expect(d.high).toBeLessThanOrEqual(de.high + 1e-6);
      const ml = mostLikely(d);
      expect(d.low).toBeLessThanOrEqual(ml.low + 1e-6);
      expect(d.high).toBeGreaterThanOrEqual(ml.high - 1e-6);
    }
    const t = tradeValueOf({ sent: [entry(cheap(1)), entry(old(2))], received: [entry(guaranteed(3))] });
    expect(t.sent.total.text).toMatch(/players combined as independent; not a calibrated interval/);
    expect(t.difference.text).toMatch(/players combined as independent; not a calibrated interval/);
    expect(t.stamp).toEqual(TRADE_COMBINATION_POLICY_CALIBRATION);
    expect(TRADE_COMBINATION_POLICY.label).toBe('players combined as independent; not a calibrated interval');
  });

  it('what is not noise stays at its edges, added: an open season keeps the side\'s most likely a range', () => {
    const one = option(1);
    const two = option(2);
    const combined = combineTradeFigures([{ figure: figureOf(one.contract), sign: 1 }, { figure: figureOf(two.contract), sign: 1 }]);
    const r1 = one.contract.centralRange as { low: number; high: number };
    const r2 = two.contract.centralRange as { low: number; high: number };
    expect(combined.figure.central).toBeNull();
    expect(combined.figure.centralRange?.low).toBeCloseTo(r1.low + r2.low, 0);
    expect(combined.figure.centralRange?.high).toBeCloseTo(r1.high + r2.high, 0);
    // A subtracted player's open season flips: his highest reading lowers the difference's lowest
    const diff = combineTradeFigures([{ figure: figureOf(one.contract), sign: -1 }]);
    expect(diff.figure.centralRange?.low).toBeCloseTo(-r1.high, 0);
    expect(diff.figure.low).toBeCloseTo(-(one.contract.high as number), 0);
    expect(diff.figure.high).toBeCloseTo(-(one.contract.low as number), 0);
  });

  it('adding an unknown-value player never changes the known sum, and says so: he is listed with his reason and named', () => {
    const base = tradeValueOf({ sent: [entry(guaranteed(1))], received: [entry(cheap(2)), entry(old(3))] });
    for (const unknown of [unknownSeason(9), noProduction(9)]) {
      const withHim = tradeValueOf({ sent: [entry(guaranteed(1))], received: [entry(cheap(2)), entry(old(3)), entry(unknown)] });
      expect(withHim.received.total.figure).toEqual(base.received.total.figure);
      expect(withHim.difference.figure).toEqual(base.difference.figure);
      const him = withHim.received.players.find((p) => p.playerId === 9)!;
      expect(him.counted).toBe(false);
      expect(him.contract).toBeNull();
      expect(him.notCounted).toMatch(/^Not valued yet/);
      expect(him.reason).toBeTruthy();
      expect(withHim.received.total.excluded.map((x) => x.playerId)).toEqual([9]);
      expect(withHim.difference.excluded.map((x) => x.playerId)).toEqual([9]);
      expect(withHim.received.total.text).toMatch(/leaves out 1 player/i);
      expect(withHim.difference.text).toMatch(/leaves out 1 player/i);
    }
    // A player the export does not have is named too, never a zero
    const missing = tradeValueOf({ sent: [entry(guaranteed(1))], received: [entry(cheap(2)), entry(null, { playerId: 77 })] });
    expect(missing.received.players.find((p) => p.playerId === 77)?.counted).toBe(false);
    expect(missing.difference.figure).toEqual(tradeValueOf({ sent: [entry(guaranteed(1))], received: [entry(cheap(2))] }).difference.figure);
  });

  it('a side with no player valued has no total, and the difference is not a number, never a zero', () => {
    const t = tradeValueOf({ sent: [entry(noProduction(1))], received: [entry(cheap(2))] });
    expect(t.sent.total.status).toBe('none');
    expect(t.sent.total.figure).toBeNull();
    expect(t.difference.status).toBe('unknown');
    expect(t.difference.figure).toBeNull();
    expect(t.difference.reason).toMatch(/going out/i);
    const empty = tradeValueOf({ sent: [], received: [entry(cheap(2))] });
    expect(empty.difference.status).toBe('unknown');
    expect(empty.difference.figure).toBeNull();
  });

  it('a league without finances reads the whole deal in wins', () => {
    const a = winsOnly(1);
    const b = cheap(2);
    const t = tradeValueOf({ sent: [entry(a)], received: [entry(b)] });
    expect(t.unit).toBe('wins');
    expect(t.unitReason).toBeTruthy();
    expect(t.sent.players[0].contract).toEqual(figureOf(a.wins));
    expect(t.received.players[0].contract).toEqual(figureOf(b.wins));
    expect(t.sent.players[0].keeping).toBeNull();
  });

  it('the neutral figures are identical under every philosophy: our view leans only beside them, each lean named with its amount', () => {
    const sent = [guaranteed(1), old(2)];
    const received = [cheap(3), option(4)];
    const neutral = tradeValueOf({ sent: sent.map((s) => entry(s)), received: received.map((s) => entry(s)) });
    const strip = (t: ReturnType<typeof tradeValueOf>) => ({ ...t, ourView: null, sent: { ...t.sent, players: t.sent.players.map((p) => ({ ...p, ours: null })) }, received: { ...t.received, players: t.received.players.map((p) => ({ ...p, ours: null })) } });
    let leaned = 0;
    for (const philosophy of randomPhilosophies(60)) {
      const t = tradeValueOf({
        sent: sent.map((s) => entry(s, { ourView: ourViewOf({ neutral: s, philosophy, ours: true }) })),
        received: received.map((s) => entry(s, { ourView: ourViewOf({ neutral: s, philosophy, ours: false }) })),
      });
      expect(strip(t)).toEqual(strip(neutral));
      expect(t.ourView).not.toBeNull();
      if (t.ourView!.leaning) {
        leaned += 1;
        const leaning = [...t.sent.players, ...t.received.players].filter((p) => p.ours?.leaning);
        expect(leaning.length).toBeGreaterThan(0);
        for (const p of leaning) expect(p.ours!.leans.length).toBeGreaterThan(0);
        const d = t.ourView!.difference.figure as TradeFigure;
        const ml = mostLikely(d);
        expect(d.low).toBeLessThanOrEqual(ml.low + 1e-6);
        expect(d.high).toBeGreaterThanOrEqual(ml.high - 1e-6);
      }
    }
    expect(leaned).toBeGreaterThan(10);
  });

  it('with a philosophy in the neutral band our view is the neutral view exactly', () => {
    const philosophy: LensPhilosophy = { dimensions: { ...DEFAULT_PHILOSOPHY_VALUES }, policies: { ...DEFAULT_PHILOSOPHY_POLICIES } };
    const s = [guaranteed(1)];
    const r = [cheap(2)];
    const t = tradeValueOf({
      sent: s.map((x) => entry(x, { ourView: ourViewOf({ neutral: x, philosophy, ours: true }) })),
      received: r.map((x) => entry(x, { ourView: ourViewOf({ neutral: x, philosophy, ours: false }) })),
    });
    expect(t.ourView?.leaning).toBe(false);
    expect(t.ourView?.difference.figure).toEqual(t.difference.figure);
  });
});

describe('a player\'s control and production, as a trade row shows them', () => {
  it('names each run of control in plain words, with the cost of each season, and an unknown cost as not known, never $0', () => {
    const c = controlSummaryOf(timeline([
      season(2030, 'under_contract', { cost: fromExport({ low: 5_000_000, high: 5_000_000 }, 'players_contract.salary0') }),
      season(2031, 'arbitration', { arbitrationYear: { low: 1, high: 1 }, cost: band(6_000_000, 8_000_000, 14_000_000) }),
      season(2032, 'arbitration', { arbitrationYear: { low: 2, high: 2 }, cost: band(8_000_000, 11_000_000, 19_000_000) }),
      season(2033, 'indeterminate', { between: ['arbitration', 'free_agent'], cost: null }),
      season(2034, 'free_agent'),
    ]));
    expect(c.text).toMatch(/signed 2030/i);
    expect(c.text).toMatch(/arbitration 2031–2032/);
    expect(c.text).toMatch(/2033 arbitration or free agency/);
    expect(c.text).toMatch(/free agent from 2034/);
    expect(c.path.map((p) => p.season)).toEqual([2030, 2031, 2032, 2033]);
    expect(c.path[1].cost).toEqual({ low: 6_000_000, central: 8_000_000, high: 14_000_000 });
    expect(c.path[3].cost).toBeNull();
    expect(c.path[3].costText).toMatch(/not known/);
    expect(JSON.stringify(c)).not.toMatch(/\$0\b/);
  });

  it('a player no club holds, or whose control is not established, says so and invents nothing', () => {
    expect(controlSummaryOf(timeline([], { standing: 'unsigned', thisSeason: null })).text).toMatch(/no club holds him/i);
    expect(controlSummaryOf(timeline([], { standing: 'unknown', thisSeason: null })).text).toMatch(/not established/i);
    const past = controlSummaryOf(timeline([season(2030, 'under_contract'), season(2031, 'under_contract')], { continuesPastHorizon: true }));
    expect(past.text).toMatch(/past 2031/);
  });

  it('gives his expected wins for the rest of this season and next, or the reason there are none', () => {
    const p = productionHeadlineOf(projectProduction(regular()));
    expect(p.status).toBe('projected');
    expect(p.now?.season).toBe(SEASON);
    expect(p.now!.wins.low).toBeLessThanOrEqual(p.now!.wins.central);
    expect(p.next?.season).toBe(SEASON + 1);
    const none = productionHeadlineOf({ ...projectProduction(regular()), status: 'unknown', reason: 'His production is not established.', seasons: [] } as never);
    expect(none.status).toBe('unknown');
    expect(none.now).toBeNull();
    expect(none.reason).toMatch(/not established/);
  });
});
