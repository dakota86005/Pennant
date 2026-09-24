import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import {
  PRODUCTION_NO_EVIDENCE, arrivalAdoption, fitRatingsModel, playerValues, productionTotal, projectProduction, ratingsEvidence,
  type ArrivalModel, type Observation, type PlayerProduction, type ProductionLine, type RatingsEvidence, type RatingsFitInput,
  type RatingsModelInForce, type RatingsProductionInput, type WinsBand,
} from '../server/playerValue.js';
import { PRODUCTION_PRIOR, RATINGS_METHOD, RATINGS_POLICY, RATINGS_PRIOR } from '../server/playerValueCalibration.js';
import { minorLeagueUsage, seasonShareOn, seasonSpans } from '../server/playerValueHistory.js';
import { FIELDING_EVIDENCE_PROVENANCE, hitterProfileFromRow, syntheticScoutedAbility } from '../server/scoutedEvidence.js';
import { IDS } from './fixture';

/*
 * Player Value phase 3b: expected production from scouted ratings (D-017, D-018, D-052, D-053,
 * PLAYER_VALUE.md Part 2.3, BEHAVIOR_CASES.md "Player Value"). Each `it` is a baseball invariant built
 * from synthetic evidence (the adapter's own `syntheticScoutedAbility`, a hitter profile read from a
 * synthetic row) through `projectProduction`, the pure function that owns the answer, or through the
 * ratings fit on a synthetic save. No case names a player or says who is worth more, and none depends on
 * a fitted number: a refit that moves every constant must leave every case here passing.
 */

const SEASON = 2030;
const EPS = 1e-9;
const width = (b: WinsBand): number => b.high - b.low;

const BAT = (v: number) => ({ contact: v, gap: v, power: v, eye: v, avoidK: v });
const ARM = (v: number) => ({ stuff: v, movement: v, control: v });
const SCALE = { max: 80, min: 20, native2080: true, basis: 'detected_from_export_maximum' as const };

interface HitterSpec { id?: number; cur?: number; pot?: number | null; glove?: number | null; running?: number | null; tools?: Partial<ReturnType<typeof BAT>> }

/** A position player's evidence, as the adapter would give it: tools, running, glove at his listed position (shortstop). */
function hitter(spec: HitterSpec = {}): RatingsEvidence {
  const id = spec.id ?? 7;
  const cur = spec.cur ?? 50;
  const pot = spec.pot === undefined ? 62 : spec.pot;
  const currentTools = { ...BAT(cur), ...(spec.tools ?? {}) };
  const ability = syntheticScoutedAbility({
    playerId: id, kind: 'hitter', current: cur, potential: pot, currentTools, potentialTools: pot === null ? {} : BAT(pot),
  });
  const running = spec.running === undefined ? 55 : spec.running;
  const row: Record<string, unknown> = {
    batting_ratings_overall_contact: currentTools.contact, batting_ratings_overall_gap: currentTools.gap,
    batting_ratings_overall_power: currentTools.power, batting_ratings_overall_eye: currentTools.eye,
    batting_ratings_overall_strikeouts: currentTools.avoidK,
    ...(running === null ? {} : { running_ratings_speed: running, running_ratings_baserunning: running, running_ratings_stealing: running }),
  };
  const glove = spec.glove === undefined ? 55 : spec.glove;
  return ratingsEvidence(ability, {
    profile: hitterProfileFromRow(id, row, SCALE),
    glove: glove === null ? null : { playerId: id, position: 6, current: glove, potential: glove + 5, provenance: FIELDING_EVIDENCE_PROVENANCE },
    position: 6,
    bats: 'R',
  });
}

function pitcher(cur = 50, pot: number | null = 60): RatingsEvidence {
  const ability = syntheticScoutedAbility({
    playerId: 8, kind: 'pitcher', current: cur, potential: pot, currentTools: ARM(cur), potentialTools: pot === null ? {} : ARM(pot), stamina: 60,
  });
  return ratingsEvidence(ability, { position: 1 });
}

/** Arrival measured on a synthetic save: at every level and age, a chance that grows with the horizon (the numbers are only a shape). */
function arrivalModel(): ArrivalModel {
  const horizons = (base: number) => Array.from({ length: 7 }, (_, h) => ({
    cases: 500, chance: Math.min(0.9, base * (h + 1)), mean: 300, nodes: Array.from({ length: 10 }, (_, j) => 30 + 60 * j),
  }));
  const cells = (['batting', 'pitching'] as const).flatMap((side) => [2, 3, 4, 6].map((level) => ({
    side, level, ageFrom: 15, ageTo: 45, cases: 500, horizons: horizons(level === 2 ? 0.12 : 0.05),
  })));
  return { levels: [2, 3, 4, 6], cells, byPotential: null };
}

const MEASURED: RatingsModelInForce = {
  model: { ...RATINGS_PRIOR, arrival: arrivalModel() },
  provenance: { source: 'save_fit', label: 'test ratings fit', stamp: { status: 'calibrated', basis: 'test', run: 'test' }, fitId: 'test', priorWeight: 0 },
};
const PRIOR_ONLY: RatingsModelInForce = {
  model: RATINGS_PRIOR,
  provenance: { source: 'fallback_prior', label: 'the provisional ratings prior', stamp: { status: 'provisional', basis: 'test', run: null }, fitId: null, priorWeight: 1 },
};

/** A prospect: no major-league results, complete ratings, at Double-A, twenty. */
const prospect = (over: Partial<RatingsProductionInput> = {}): RatingsProductionInput => ({
  playerId: 7, season: SEASON, seasonPlayed: 0.3, age: 20, batting: [], pitching: [], ratings: hitter(), level: 3, ...over,
});

const bat = (season: number, pa: number, war: number): ProductionLine => ({ season, opportunities: pa, war });

/** A rookie with a thin major-league record. */
const rookie = (over: Partial<RatingsProductionInput> = {}): RatingsProductionInput => ({
  playerId: 9, season: SEASON, seasonPlayed: 0.3, age: 23, batting: [bat(2029, 90, 0.3), bat(2030, 60, 0.2)], pitching: [], ratings: hitter({ cur: 52, pot: 60 }), level: 1, ...over,
});

function projected(p: PlayerProduction): PlayerProduction {
  expect(p.status, p.reason ?? '').toBe('projected');
  return p;
}

describe('expected production from ratings (phase 3b): unknown stays unknown', () => {
  it('a player with no major-league results and no ability evidence is unknown: never zero, never an average', () => {
    const none = syntheticScoutedAbility({ current: null, potential: null });
    for (const ratings of [undefined, null, ratingsEvidence(none)]) {
      const p = projectProduction(prospect({ ratings }), undefined, MEASURED);
      expect(p.status).toBe('unknown');
      expect(p.reason).toContain(PRODUCTION_NO_EVIDENCE);
      expect(p.seasons).toEqual([]);
      expect(p.basis.ability?.status).toBe('unknown');
    }
  });

  it('expected major-league playing time for a player not in the majors is measured on the save or unknown, never assumed', () => {
    // The provisional prior measures no arrivals: his ability is read, his playing time is not established
    const p = projectProduction(prospect(), undefined, PRIOR_ONLY);
    expect(p.status).toBe('unknown');
    expect(p.reason).toMatch(/playing time is not established/);
    expect(p.basis.ability?.status).toBe('used');
    // ...and no club, so no level: the same
    expect(projectProduction(prospect({ level: null }), undefined, MEASURED).status).toBe('unknown');
  });

  it('removing all ability evidence makes the ability component unknown: a prospect has no band, and a thin record falls back to his results with a rate band at least as wide', () => {
    expect(projected(projectProduction(prospect(), undefined, MEASURED)).basis.ability?.status).toBe('used');
    expect(projectProduction(prospect({ ratings: null }), undefined, MEASURED).status).toBe('unknown');
    const withRatings = projected(projectProduction(rookie(), undefined, MEASURED));
    const without = projected(projectProduction(rookie({ ratings: null }), undefined, MEASURED));
    expect(withRatings.basis.ability?.status).toBe('used');
    expect(without.basis.ability?.status).toBe('unknown');
    expect(without.basis.sides[0].blend ?? null).toBeNull();
    without.seasons.forEach((s, i) => {
      expect(width(s.sides[0].rateBand), `${s.season}`).toBeGreaterThanOrEqual(width(withRatings.seasons[i].sides[0].rateBand) - EPS);
      expect(width(s.sides[0].rateInner), `${s.season}`).toBeGreaterThanOrEqual(width(withRatings.seasons[i].sides[0].rateInner) - EPS);
    });
  });
});

describe('expected production from ratings (phase 3b): a prospect', () => {
  it('a prospect with ratings, a level and an age has a band for every season of the horizon, with its basis', () => {
    const p = projected(projectProduction(prospect(), undefined, MEASURED));
    expect(p.seasons.map((s) => s.season)).toEqual([2030, 2031, 2032, 2033, 2034, 2035, 2036]);
    expect(p.basis.source).toBe('ratings');
    expect(p.basis.ability?.evidence.provenance).toBe('declared_organization_visible');
    expect(p.basis.ability?.caveat).toMatch(/Same-time/);
    expect(p.basis.arrival?.level).toBe(3);
    expect(p.basis.arrival?.seasons).toHaveLength(7);
    expect(p.basis.ability?.development?.source).toBe('fallback_prior');
    expect(p.basis.ability?.development?.label).toMatch(/not yet calibrated on this save/i);
    for (const s of p.seasons) {
      expect(s.wins.low).toBeLessThanOrEqual(s.wins.central + EPS);
      expect(s.wins.central).toBeLessThanOrEqual(s.wins.high + EPS);
      expect(s.inner.low).toBeGreaterThanOrEqual(s.wins.low - EPS);
      expect(s.inner.high).toBeLessThanOrEqual(s.wins.high + EPS);
      expect(s.coverage.observed).toBeNull();
    }
  });

  it('a prospect\'s low edge includes producing nothing: no major-league win in any season', () => {
    for (const make of [() => prospect(), () => prospect({ ratings: pitcher(), level: 2 }), () => prospect({ age: 24, level: 2 })]) {
      const p = projected(projectProduction(make(), undefined, MEASURED));
      for (const s of p.seasons) expect(s.wins.low, `${s.season}`).toBeLessThanOrEqual(0);
    }
  });

  it('his rate band is never narrower in a season further out', () => {
    for (const make of [() => prospect(), () => prospect({ ratings: pitcher() }), () => prospect({ ratings: hitter({ pot: null }) })]) {
      const p = projected(projectProduction(make(), undefined, MEASURED));
      for (let i = 1; i < p.seasons.length; i += 1) {
        expect(width(p.seasons[i].sides[0].rateBand)).toBeGreaterThanOrEqual(width(p.seasons[i - 1].sides[0].rateBand) - EPS);
        expect(width(p.seasons[i].sides[0].rateInner)).toBeGreaterThanOrEqual(width(p.seasons[i - 1].sides[0].rateInner) - EPS);
      }
    }
  });

  it('expected ability moves from current toward potential, and the band widens with the gap between them', () => {
    const p = projected(projectProduction(prospect({ age: 19 }), undefined, MEASURED));
    // Development toward potential raises the rate he is expected to play at
    expect(p.seasons[3].sides[0].rate).toBeGreaterThan(p.seasons[0].sides[0].rate);
    // The same current ability with a higher potential: never a narrower band
    const small = projected(projectProduction(prospect({ age: 19, ratings: hitter({ pot: 54 }) }), undefined, MEASURED));
    const large = projected(projectProduction(prospect({ age: 19, ratings: hitter({ pot: 70 }) }), undefined, MEASURED));
    small.seasons.forEach((s, i) => {
      expect(width(large.seasons[i].sides[0].rateBand), `${s.season}`).toBeGreaterThanOrEqual(width(s.sides[0].rateBand) - EPS);
      expect(width(large.seasons[i].wins), `${s.season}`).toBeGreaterThanOrEqual(width(s.wins) - EPS);
    });
  });

  it('a partial ScoutedAbility never narrows the band: an unknown potential, glove at his position or running is wider or as wide', () => {
    const full = projected(projectProduction(prospect(), undefined, MEASURED));
    for (const [what, ev] of [
      ['potential', hitter({ pot: null })], ['glove', hitter({ glove: null })], ['running', hitter({ running: null })],
      ['glove and running', hitter({ glove: null, running: null })],
    ] as const) {
      // The same level, age and arrival: the same expected playing time
      const partial = projected(projectProduction(prospect({ ratings: ev }), undefined, MEASURED));
      full.seasons.forEach((s, i) => {
        const x = partial.seasons[i];
        expect(x.sides[0].usage.central, `${what}, ${s.season}`).toBeCloseTo(s.sides[0].usage.central, 9);
        expect(width(x.wins), `${what}, ${s.season}`).toBeGreaterThanOrEqual(width(s.wins) - EPS);
        expect(width(x.inner), `${what}, ${s.season}`).toBeGreaterThanOrEqual(width(s.inner) - EPS);
        expect(width(x.sides[0].rateBand), `${what}, ${s.season}`).toBeGreaterThanOrEqual(width(s.sides[0].rateBand) - EPS);
      });
    }
  });

  it('a pitcher whose scouted line lacks one current tool is projected with a band at least as wide as with it, and one lacking two is unknown', () => {
    const complete = projected(projectProduction(prospect({ ratings: pitcher(50, 60), level: 2 }), undefined, MEASURED));
    const lacking = (tools: Record<string, number | null>) => ratingsEvidence(syntheticScoutedAbility({
      playerId: 8, kind: 'pitcher', current: null, potential: 60, currentTools: tools, potentialTools: ARM(60), stamina: 60,
    }), { position: 1 });
    const partial = projected(projectProduction(prospect({ ratings: lacking({ stuff: 50, movement: 50, control: null }), level: 2 }), undefined, MEASURED));
    expect(partial.basis.ability?.status).toBe('used');
    complete.seasons.forEach((s, i) => {
      expect(width(partial.seasons[i].wins), `${s.season}`).toBeGreaterThanOrEqual(width(s.wins) - EPS);
      expect(width(partial.seasons[i].sides[0].rateBand), `${s.season}`).toBeGreaterThanOrEqual(width(s.sides[0].rateBand) - EPS);
    });
    const two = projectProduction(prospect({ ratings: lacking({ stuff: 50, movement: null, control: null }), level: 2 }), undefined, MEASURED);
    expect(two.status).toBe('unknown');
    expect(two.basis.ability?.status).toBe('unknown');
  });

  it('a better scouted line never lowers the central estimate, all else equal', () => {
    for (const [label, make, better] of [
      ['prospect, a current tool', () => prospect(), () => prospect({ ratings: hitter({ tools: { power: 60 } }) })],
      ['prospect, potential', () => prospect(), () => prospect({ ratings: hitter({ pot: 68 }) })],
      ['prospect, glove', () => prospect(), () => prospect({ ratings: hitter({ glove: 70 }) })],
      ['pitching prospect', () => prospect({ ratings: pitcher(50) }), () => prospect({ ratings: pitcher(56) })],
      ['thin record, a current tool', () => rookie(), () => rookie({ ratings: hitter({ cur: 52, pot: 60, tools: { contact: 62 } }) })],
    ] as const) {
      const base = projected(projectProduction(make(), undefined, MEASURED));
      const up = projected(projectProduction(better(), undefined, MEASURED));
      base.seasons.forEach((s, i) => expect(up.seasons[i].wins.central, `${label}, ${s.season}`).toBeGreaterThanOrEqual(s.wins.central - EPS));
    }
  });

  it('nothing in the projection knows the club: the same evidence is valued on exactly the same terms (Q-2)', () => {
    const a = projectProduction(prospect(), undefined, MEASURED);
    const b = projectProduction({ ...prospect(), playerId: 70 }, undefined, MEASURED);
    expect({ ...b, playerId: 7 }).toEqual(a);
  });
});

describe('expected production from ratings (phase 3b): results and ratings blended by reliability', () => {
  it('the weights are shown and sum to one; as his major-league sample grows his results count for more and his ratings for less', () => {
    const samples = [60, 300, 900, 1800, 6000];
    const weights = samples.map((pa) => {
      const p = projected(projectProduction(rookie({ batting: [bat(2028, pa / 3, pa / 600), bat(2029, pa / 3, pa / 600), bat(2030, pa / 3, pa / 600)] }), undefined, MEASURED));
      const b = p.basis.sides[0].blend!;
      expect(b.results + b.ratings).toBeCloseTo(1, 9);
      expect(p.basis.source).toBe('results_and_ratings');
      return b.results;
    });
    for (let i = 1; i < weights.length; i += 1) expect(weights[i]).toBeGreaterThan(weights[i - 1]);
  });

  it('a player with plenty of major-league record is effectively his results alone', () => {
    const lines = [bat(2027, 4000, 12), bat(2028, 4000, 12), bat(2029, 4000, 12), bat(2030, 1300, 4)];
    const blended = projected(projectProduction(rookie({ age: 29, batting: lines, ratings: hitter({ cur: 70, pot: 70 }) }), undefined, MEASURED));
    const results = projected(projectProduction(rookie({ age: 29, batting: lines, ratings: null }), undefined, MEASURED));
    expect(blended.basis.sides[0].blend!.results).toBeGreaterThan(0.9);
    blended.seasons.forEach((s, i) => {
      expect(Math.abs(s.sides[0].rate - results.seasons[i].sides[0].rate), `${s.season}`).toBeLessThan(0.25);
    });
  });
});

describe('the ratings fit on a synthetic save (D-053)', () => {
  /** A small seeded generator, so a synthetic save is the same on every run. */
  function random(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function syntheticSave(observations: Observation[] = []): RatingsFitInput {
    const rnd = random(11);
    const normal = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const mapping: RatingsFitInput['mapping'] = [];
    const crossSection: RatingsFitInput['crossSection'] = [];
    let id = 1000;
    for (const kind of ['hitter', 'hitter', 'starter', 'reliever'] as const) {
      for (let n = 0; n < 200; n += 1) {
        id += 1;
        const level = 40 + Math.floor(rnd() * 30);
        const tool = () => level - 8 + Math.floor(rnd() * 17);
        const tools = { contact: tool(), gap: tool(), power: tool(), eye: tool(), avoidK: tool() };
        const arm = { stuff: tool(), movement: tool(), control: tool() };
        const ev = kind === 'hitter'
          ? hitter({ id, cur: level, pot: level, glove: 40 + Math.floor(rnd() * 30), running: 40 + Math.floor(rnd() * 30), tools })
          : ratingsEvidence(syntheticScoutedAbility({ playerId: id, kind: 'pitcher', current: level, potential: level, currentTools: arm, potentialTools: arm, stamina: kind === 'starter' ? 60 : 40 }), { position: 1 });
        const opp = 250 + Math.floor(rnd() * 1400);
        const quality = kind === 'hitter' ? (tools.contact + tools.power + tools.eye) / 3 : (arm.stuff + arm.movement + arm.control) / 3;
        const true600 = (quality - 50) * 0.12 + (kind === 'hitter' ? 2 : 1);
        const war = (true600 * opp) / 600 + Math.sqrt(opp / 600) * 0.9 * normal();
        mapping.push({ playerId: id, kind, evidence: ev, opportunities: opp, war });
        crossSection.push({ evidence: ev, age: 27 });
      }
    }
    // Minor leaguers: at Double-A at 21 to 24; the better ones reach the majors a season or two on
    const arrival: RatingsFitInput['arrival'] = [];
    for (let n = 0; n < 1500; n += 1) {
      id += 1;
      const start = 2006 + Math.floor(rnd() * 16);
      const majors = new Map<number, number>();
      if (rnd() < 0.2) majors.set(start + 1 + Math.floor(rnd() * 3), 100 + Math.floor(rnd() * 400));
      arrival.push({
        playerId: id, birth: { year: start - 21 - Math.floor(rnd() * 4), month: 3, day: 1 }, side: rnd() < 0.5 ? 'batting' : 'pitching', majors,
        minors: [{ season: start, level: 3, opportunities: 300 }],
      });
    }
    const seasons = Array.from({ length: 20 }, (_, i) => ({ season: 2006 + i, scheduleShare: 1 }));
    return {
      leagueId: 1, throughSeason: 2025, seasons, production: PRODUCTION_PRIOR, mapping, exposure: null, levels: [3],
      arrival, crossSection, observations,
    };
  }

  it('the ratings mapping is fitted per save on major leaguers with ratings and a meaningful rate, recorded with its run record, the same-time caveat and the gate\'s verdict', () => {
    const run = fitRatingsModel(syntheticSave(), { prior: RATINGS_PRIOR });
    const r = run.record;
    expect(r.id).toBe(`1:2025:${RATINGS_METHOD}`);
    expect(r.mapping.cases.hitter).toBeGreaterThanOrEqual(300);
    expect(r.mapping.caveat).toMatch(/Same-time fit/);
    expect(r.mapping.coverage.asFitted.cases).toBeGreaterThan(0);
    expect(typeof r.gate.passed).toBe('boolean');
    expect(r.gate.reason.length).toBeGreaterThan(0);
    // The verdict agrees with the numbers it states
    const off = (o: number | null, t: number) => (o === null ? Infinity : Math.abs(o - t));
    if (r.gate.passed) {
      expect(off(r.mapping.coverage.asFitted.outer, 0.8)).toBeLessThanOrEqual(r.gate.tolerance);
      expect(off(r.mapping.coverage.asFitted.inner, 0.5)).toBeLessThanOrEqual(r.gate.tolerance);
    }
    // A better scouted line never lowers the rate the mapping gives
    for (const t of Object.values(run.model.mapping.hitter.full.tools)) expect(t).toBeGreaterThanOrEqual(0);
    for (const t of Object.values(run.model.mapping.starter.tools)) expect(t).toBeGreaterThanOrEqual(0);
  });

  it('arrival rates are measured from minor-league usage by level and age, and checked on seasons the fit never saw', () => {
    const r = fitRatingsModel(syntheticSave(), { prior: RATINGS_PRIOR });
    expect(r.record.arrival.measured).toBe(true);
    expect(r.model.arrival?.levels).toEqual([3]);
    expect(r.record.arrival.holdout.length).toBeGreaterThan(0);
    expect(r.record.arrival.heldOut.some((x) => x.cases > 0)).toBe(true);
    // A save with no minor-league history measures none, and says so
    const none = fitRatingsModel({ ...syntheticSave(), arrival: [] }, { prior: RATINGS_PRIOR });
    expect(none.model.arrival).toBeNull();
    expect(none.record.arrival.reason).toMatch(/no minor-league usage history/);
  });

  it('the development path is the provisional prior, labelled, until the save holds enough rating-snapshot pairs a season apart; then it is the save\'s own, automatically', () => {
    const before = fitRatingsModel(syntheticSave(), { prior: RATINGS_PRIOR });
    expect(before.model.development.source).toBe('fallback_prior');
    expect(before.model.development.label).toMatch(/Not yet calibrated on this save/);
    expect(before.record.development.pairs).toBe(0);
    // Snapshots a season apart: each player closes 40% of his gap a year
    const obs: Observation[] = [];
    for (let n = 0; n < 400; n += 1) {
      const group = n % 2 === 0 ? 'hitter' : 'pitcher';
      const age = 18 + (n % 7);
      obs.push({ playerId: 5000 + n, gameDate: '2026-04-01', season: 2026, level: 3, age, group, current: 40, potential: 60 });
      obs.push({ playerId: 5000 + n, gameDate: '2027-04-01', season: 2027, level: 3, age: age + 1, group, current: 48, potential: 60 });
    }
    const after = fitRatingsModel(syntheticSave(obs), { prior: RATINGS_PRIOR });
    expect(after.model.development.source).toBe('save_fit');
    expect(after.record.development.pairs).toBe(400);
    const oneYear = after.model.development.hitter[20 - after.model.development.firstAge][0];
    expect(oneYear[1]).toBeCloseTo(0.4, 2);
  });

  it('a partial fit\'s form without the glove or the running is never more certain than the full one', () => {
    const m = fitRatingsModel(syntheticSave(), { prior: RATINGS_PRIOR }).model.mapping.hitter;
    expect(m.noGlove.variance600).toBeGreaterThanOrEqual(m.full.variance600);
    expect(m.noRunning.variance600).toBeGreaterThanOrEqual(m.full.variance600);
    expect(m.bat.variance600).toBeGreaterThanOrEqual(Math.max(m.noGlove.variance600, m.noRunning.variance600));
  });

  describe('hardening F4: arrivals (C-01, B-15)', () => {
    /**
     * Minor leaguers at Triple-A at 21, one origin season each: `upNow` of them reach the majors in the origin
     * season and all of those play the next; of the rest, `later` play the next season. `rate(origin)` can
     * replace that shape per origin season (a league whose arrivals changed).
     */
    function arrivals(n: number, shape: (origin: number) => { upNow: number; later: number }, firstId = 50_000): RatingsFitInput['arrival'] {
      const rnd = random(23);
      const out: RatingsFitInput['arrival'] = [];
      for (let i = 0; i < n; i += 1) {
        const origin = 2006 + (i % 19);
        const { upNow, later } = shape(origin);
        const majors = new Map<number, number>();
        const u = rnd();
        if (u < upNow) { majors.set(origin, 150); majors.set(origin + 1, 400); }
        else if (u < upNow + (1 - upNow) * later) majors.set(origin + 1, 200);
        out.push({ playerId: firstId + i, birth: { year: origin - 21, month: 3, day: 1 }, side: 'batting', majors, minors: [{ season: origin, level: 2, opportunities: 400 }] });
      }
      return out;
    }
    const inForce = (model: ReturnType<typeof fitRatingsModel>['model']): RatingsModelInForce => ({ model, provenance: MEASURED.provenance });
    const aaa = (over: Partial<RatingsProductionInput> = {}) => prospect({ level: 2, age: 21, seasonPlayed: 0, ...over });

    it('C-01: a prospect\'s chance next season counts the players of his level and age who were called up later in their season, not only those passed over for all of it', () => {
      const input = { ...syntheticSave(), levels: [2], arrival: arrivals(4000, () => ({ upNow: 0.6, later: 0.25 })) };
      const run = fitRatingsModel(input, { prior: RATINGS_PRIOR });
      // At the season's start: the rate at which such players played the next season, 0.6 + 0.4 × 0.25
      const start = projected(projectProduction(aaa(), undefined, inForce(run.model)));
      expect(start.seasons[1].sides[0].arrival?.chance).toBeGreaterThan(0.62);
      expect(start.seasons[1].sides[0].arrival?.chance).toBeLessThan(0.78);
      // Part-way through, not yet called up: never below the players passed over all season, and his chance of
      // playing next season is not below the chance of being called up in what is left of this one
      const mid = projected(projectProduction(aaa({ seasonPlayed: 0.5 }), undefined, inForce(run.model)));
      const next = mid.seasons[1].sides[0].arrival!.chance;
      expect(next).toBeGreaterThan(0.3);
      expect(next).toBeGreaterThanOrEqual(mid.seasons[0].sides[0].arrival!.chance);
      // The held-out check is read on the same, unconditioned players
      const h1 = run.record.arrival.heldOut[1];
      expect(h1.cases).toBeGreaterThan(0);
      expect(h1.observed).toBeGreaterThan(0.6);
    });

    it('B-15: the arrival gate fails a fit whose held-out chance keeps missing by a material share of what happened, though the miss is under the absolute tolerance', () => {
      const control = fitRatingsModel({ ...syntheticSave(), levels: [2], arrival: arrivals(6000, () => ({ upNow: 0, later: 0.12 })) }, { prior: RATINGS_PRIOR });
      // The same league, calibrated: the gate passes (its mapping and its arrivals)
      expect(control.record.gate.passed, control.record.gate.reason).toBe(true);
      // Arrivals falling every season, from 20% to 1%: every origin's fit lags the fall the same way (hardening F5: a single
      // step is learned by the origins after it, and one era's miss is read across the origins; a lag that persists is not)
      const drifted = fitRatingsModel({
        ...syntheticSave(), levels: [2],
        arrival: arrivals(6000, (origin) => ({ upNow: 0, later: 0.2 * (1 - (origin - 2006) / 19) })),
      }, { prior: RATINGS_PRIOR });
      const h1 = drifted.record.arrival.heldOut[1];
      expect(h1.predicted! - h1.observed!).toBeLessThan(0.1);
      expect(h1.predicted! / h1.observed!).toBeGreaterThan(1.4);
      expect(drifted.record.gate.passed, drifted.record.gate.reason).toBe(false);
      expect(drifted.record.gate.reason).toMatch(/arrival chance's held-out calibration/i);
    });
  });

  describe('hardening F5: the arrival model judged as it is served (the owner\'s option C, 2026-09-23)', () => {
    const PHI = 0.6180339887498949;
    /** An even spread on [0, 1) (a low-discrepancy draw): each cohort's proportions are exact, so no case rides on sampling luck. */
    const spread = (j: number) => (j * PHI) % 1;
    /** Batting prospects at Triple-A at 21, one origin season each (2006–2024), `perOrigin` of them, who play the next season at `rate(origin)`. */
    function cohorts(perOrigin: number, rate: (origin: number) => number, firstId = 70_000): RatingsFitInput['arrival'] {
      const out: RatingsFitInput['arrival'] = [];
      let id = firstId;
      for (let origin = 2006; origin <= 2024; origin += 1) {
        const p = rate(origin);
        for (let j = 0; j < perOrigin; j += 1) {
          id += 1;
          const majors = new Map<number, number>();
          if (spread(j) < p) majors.set(origin + 1, 200);
          out.push({ playerId: id, birth: { year: origin - 21, month: 3, day: 1 }, side: 'batting', majors, minors: [{ season: origin, level: 2, opportunities: 400 }] });
        }
      }
      return out;
    }
    const inForce = (model: ReturnType<typeof fitRatingsModel>['model']): RatingsModelInForce => ({ model, provenance: MEASURED.provenance });
    const aaa = (over: Partial<RatingsProductionInput> = {}) => prospect({ level: 2, age: 21, seasonPlayed: 0, ...over });

    it('every eligible origin is scored by the method fitted through it, projecting the next season\'s minor leaguers; a horizon only where that fit rests on at least three origin cohorts', () => {
      const run = fitRatingsModel({ ...syntheticSave(), levels: [2], arrival: cohorts(250, () => 0.12) }, { prior: RATINGS_PRIOR });
      const a = run.record.arrival;
      const scored = a.scored ?? [];
      // The window is 2006–2025: origins from its start + 5 (2011) to the season before the last (2024), at most 8, evenly spaced, the first and the last kept
      expect(scored.length).toBe(RATINGS_POLICY.backtest.origins.maxOrigins);
      expect(scored[0].origin).toBe(2011);
      expect(scored[scored.length - 1].origin).toBe(2024);
      for (const x of scored) {
        expect(x.through).toBe(x.origin);
        expect(x.cohort).toBe(x.origin + 1);
        // At horizon h the fit through Y holds the origin cohorts 2006 … Y − h
        for (const h of x.horizons) expect(x.origin - h - 2006 + 1, `${x.origin} h${h}`).toBeGreaterThanOrEqual(RATINGS_POLICY.backtest.origins.minimumOrigins);
        expect(x.horizons.every((h) => x.cohort + h <= 2025)).toBe(true);
      }
      // Horizon 1 pools the next season's cohort of every origin that scores it
      expect(a.heldOut[1].cases).toBe(scored.filter((x) => x.horizons.includes(1)).length * 250);
      expect(a.heldOut[1].origins).toBe(scored.filter((x) => x.horizons.includes(1)).length);
      expect(a.recencyHalfLife).toBe(RATINGS_POLICY.backtest.recencyHalfLife);
      expect(run.record.gate.passed, run.record.gate.reason).toBe(true);
    });

    it('recent seasons count for more: where arrival rates changed some seasons ago, the chance served is nearer the recent seasons\' rate than the whole window\'s', () => {
      const run = fitRatingsModel({ ...syntheticSave(), levels: [2], arrival: cohorts(250, (o) => (o < 2016 ? 0.05 : 0.2)) }, { prior: RATINGS_PRIOR });
      const next = projected(projectProduction(aaa(), undefined, inForce(run.model))).seasons[1].sides[0].arrival!.chance;
      // The whole window's average is about 0.12, the last nine seasons' 0.20
      expect(next).toBeGreaterThan(0.17);
      expect(next).toBeLessThanOrEqual(0.2 + EPS);
    });

    it('one era\'s swing is not a bias: a rate that rose for some seasons and came back is not failed by the swing, while a model that keeps missing in one direction fails', () => {
      // Arrivals tripled for six seasons and came back: the method learns each era in turn, and each origin's miss is its own era's
      const swing = fitRatingsModel({ ...syntheticSave(), levels: [2], arrival: cohorts(1000, (o) => (o >= 2016 && o <= 2021 ? 0.3 : 0.1)) }, { prior: RATINGS_PRIOR });
      const h1 = swing.record.arrival.heldOut[1];
      // Material, and beyond three standard errors clustered by player alone: only clustering by origin as well reads it as the swing it is
      expect(Math.abs(h1.observed! - h1.predicted!) / h1.observed!).toBeGreaterThan(RATINGS_POLICY.gate.arrivalBias.relative);
      expect(swing.record.gate.passed, swing.record.gate.reason).toBe(true);
      // A league whose arrivals fall every season: every origin's fit lags it, the same way, however it is weighted
      const falling = fitRatingsModel({ ...syntheticSave(), levels: [2], arrival: cohorts(300, (o) => 0.2 * (1 - (o - 2006) / 19)) }, { prior: RATINGS_PRIOR });
      const f1 = falling.record.arrival.heldOut[1];
      expect(f1.predicted! - f1.observed!).toBeLessThan(0.1);
      expect(f1.predicted! / f1.observed!).toBeGreaterThan(1.3);
      expect(falling.record.gate.passed, falling.record.gate.reason).toBe(false);
      expect(falling.record.gate.reason).toMatch(/clustered by player and by origin/);
    });

    describe('a rating snapshot is read at its own point of the season (the chance by potential)', () => {
      /** Arrivals at Triple-A at 21 with the C-01 shape, exact: 60% called up in the origin season (all play the next), a quarter of the rest the next season. */
      function c01(perOrigin: number): RatingsFitInput['arrival'] {
        const out: RatingsFitInput['arrival'] = [];
        let id = 90_000;
        for (let origin = 2006; origin <= 2024; origin += 1) {
          for (let j = 0; j < perOrigin; j += 1) {
            id += 1;
            const u = spread(j);
            const majors = new Map<number, number>();
            if (u < 0.6) { majors.set(origin, 150); majors.set(origin + 1, 400); } else if (u < 0.7) majors.set(origin + 1, 200);
            out.push({ playerId: id, birth: { year: origin - 21, month: 3, day: 1 }, side: 'batting', majors, minors: [{ season: origin, level: 2, opportunities: 400 }] });
          }
        }
        return out;
      }
      /**
       * 1,200 hitters snapshotted at Triple-A at 21 in 2020 at `share` of the season, not yet called up. Of a tier's players,
       * `up(potential)` are called up later this season (and play the next); a quarter of the rest play the next season. With
       * half the season to play, the save's own rate for such a player is 3/7 this season (0.3 of the 0.7 not yet called up).
       */
      function linked(share: number | null | undefined, up: (potential: number) => number) {
        const observations: Observation[] = [];
        const players: RatingsFitInput['arrival'] = [];
        for (let j = 0; j < 1200; j += 1) {
          const id = 200_000 + j;
          const potential = 40 + (j % 30);
          const u = spread(j);
          const p = up(potential);
          const majors = new Map<number, number>();
          if (u < p) { majors.set(2020, 150); majors.set(2021, 400); } else if (u < p + (1 - p) * 0.25) majors.set(2021, 200);
          players.push({ playerId: id, birth: { year: 1999, month: 3, day: 1 }, side: 'batting', majors, minors: [] });
          observations.push({ playerId: id, gameDate: '2020-07-01', season: 2020, level: 2, age: 21, group: 'hitter', current: 45, potential, ...(share === undefined ? {} : { seasonPlayed: share }) });
        }
        return fitRatingsModel({ ...syntheticSave(observations), levels: [2], arrival: [...c01(300), ...players] }, { prior: RATINGS_PRIOR });
      }
      const multipliers = (run: ReturnType<typeof fitRatingsModel>) => run.model.arrival?.byPotential?.multipliers.hitter ?? null;

      it('a mid-season snapshot is compared with the chance of a player not yet called up at that point, never the season\'s start', () => {
        const run = linked(0.5, () => 3 / 7);
        expect(run.record.arrivalByPotential.used).toBe(true);
        // Potential tells nothing here, and the expected chance is his condition's: no tier moves
        for (const row of multipliers(run)!) for (const m of row) expect(m).toBe(1);
        // ...and where the top third really does arrive twice as often, that tier is read, the others not
        const better = linked(0.5, (potential) => (potential >= 60 ? 6 / 7 : 3 / 7));
        const m = multipliers(better)!;
        expect(m[2][0]).toBeGreaterThan(1.5);
        expect(m[0][0]).toBe(1);
      });

      it('a snapshot whose point of the season is not established is read across the range, and a tier moves only if it holds across it', () => {
        for (const share of [null, undefined]) {
          const run = linked(share, () => 3 / 7);
          expect(run.record.arrivalByPotential.used).toBe(true);
          for (const row of multipliers(run)!) for (const m of row) expect(m).toBe(1);
        }
      });
    });
  });

  describe('hardening F6: the arrival model adopted horizon by horizon (the owner\'s option (b), 2026-09-23)', () => {
    const PHI = 0.6180339887498949;
    const spread = (j: number) => (j * PHI) % 1;
    /**
     * Batting prospects at Triple-A at 21, one origin season each (2006–2024), `perOrigin` of them: `next` of them play the
     * next season, and `late(origin)` more first play four seasons on (a league whose late arrivals rose class after class).
     */
    function cohorts(perOrigin: number, next: (origin: number) => number, late: (origin: number) => number, firstId = 90_000): RatingsFitInput['arrival'] {
      const out: RatingsFitInput['arrival'] = [];
      let id = firstId;
      for (let origin = 2006; origin <= 2024; origin += 1) {
        for (let j = 0; j < perOrigin; j += 1) {
          id += 1;
          const majors = new Map<number, number>();
          const u = spread(j);
          if (u < next(origin)) majors.set(origin + 1, 200);
          else if (u < next(origin) + late(origin)) majors.set(origin + 4, 200);
          out.push({ playerId: id, birth: { year: origin - 21, month: 3, day: 1 }, side: 'batting', majors, minors: [{ season: origin, level: 2, opportunities: 400 }] });
        }
      }
      return out;
    }
    const inForce = (model: ReturnType<typeof fitRatingsModel>['model']): RatingsModelInForce => ({ model, provenance: MEASURED.provenance });
    const aaa = (over: Partial<RatingsProductionInput> = {}) => prospect({ level: 2, age: 21, seasonPlayed: 0, ...over });
    const rising = () => fitRatingsModel({ ...syntheticSave(), levels: [2], arrival: cohorts(400, () => 0.12, (o) => 0.02 + 0.012 * (o - 2006)) }, { prior: RATINGS_PRIOR });
    /** The handmade measured model, adopted through three seasons out. */
    const partly = (): RatingsModelInForce => ({
      ...MEASURED,
      model: {
        ...MEASURED.model,
        arrival: { ...MEASURED.model.arrival!, adopted: { through: 3, notEstablished: [4, 5, 6].map((horizon) => ({ horizon, reason: `${horizon} seasons out: outside the gate` })) } },
      },
    });

    it('a horizon is served only where it and every horizon before it passed: a pass after a failure is not served, and the gate is not loosened', () => {
      const run = rising();
      const a = run.record.arrival;
      // Four seasons out every origin's fit lags the rising late arrivals: that horizon fails the unchanged gate
      const h4 = a.heldOut[4];
      expect(h4.cases).toBeGreaterThanOrEqual(run.record.gate.minimumCases);
      expect((h4.observed! - h4.predicted!) / h4.observed!).toBeGreaterThan(RATINGS_POLICY.gate.arrivalBias.relative);
      const adoption = a.adoption!;
      expect(adoption.through).toBe(3);
      expect(adoption.horizons.map((x) => x.check).slice(0, 5)).toEqual(['passed', 'passed', 'passed', 'passed', 'failed']);
      // Five and six seasons out pass their own checks, yet follow a failure: not served
      for (const h of [5, 6]) {
        expect(adoption.horizons[h].check, `h${h}`).toBe('passed');
        expect(adoption.horizons[h].adopted, `h${h}`).toBe(false);
        expect(adoption.horizons[h].reason, `h${h}`).toMatch(/4 seasons out/);
      }
      expect(adoption.horizons.slice(0, 4).every((x) => x.adopted && x.reason === null)).toBe(true);
      expect(adoption.horizons[4].reason).toMatch(/low/);
      // Adopted through three seasons out: the gate passed on what it adopts, and says what it did not
      expect(run.record.gate.passed, run.record.gate.reason).toBe(true);
      expect(run.record.gate.reason).toMatch(/through 3 seasons out/);
      // The served model carries nothing past the last adopted horizon
      expect(run.model.arrival?.adopted?.through).toBe(3);
      for (const cell of run.model.arrival!.cells) expect(cell.horizons.slice(4).every((h) => h === null)).toBe(true);
    });

    it('nothing is served unless the next season passes: a failure one season out rejects the arrival model, whatever passes after it', () => {
      // Arrivals one season on falling every season (the F5 case): every origin's fit lags it the same way
      const falling = fitRatingsModel({ ...syntheticSave(), levels: [2], arrival: cohorts(300, (o) => 0.2 * (1 - (o - 2006) / 19), () => 0) }, { prior: RATINGS_PRIOR });
      const adoption = falling.record.arrival.adoption!;
      expect(adoption.horizons[1].check).toBe('failed');
      expect(adoption.horizons.slice(2).some((x) => x.check === 'passed')).toBe(true);
      expect(adoption.through).toBeNull();
      expect(adoption.horizons.every((x) => !x.adopted)).toBe(true);
      expect(falling.record.gate.passed, falling.record.gate.reason).toBe(false);
    });

    it('the adopted horizons are a contiguous run from the rest of this season: a horizon that could not be checked stops it, and so does a failure the season under way', () => {
      const ok = { cases: 1000, predicted: 0.1, observed: 0.1, predictedMean: 10, observedMean: 10, chanceSe: 0.01, meanSe: 0.5, origins: 5 };
      const fail = { ...ok, observed: 0.15 };
      const thin = { ...ok, cases: 50 };
      const at = (rows: Array<typeof ok>) => arrivalAdoption(rows.map((r, horizon) => ({ ...r, horizon })), 200);
      expect(at([ok, ok, ok, ok, ok, ok, ok]).through).toBe(6);
      const unchecked = at([ok, ok, ok, thin, ok, ok, ok]);
      expect(unchecked.through).toBe(2);
      expect(unchecked.horizons[3].check).toBe('not_evaluable');
      expect(unchecked.horizons[3].reason).toMatch(/too few/i);
      expect(unchecked.horizons[4].adopted).toBe(false);
      expect(at([ok, ok, fail, ok, ok, ok, ok]).through).toBe(1);
      expect(at([fail, ok, ok, ok, ok, ok, ok]).through).toBeNull();
      expect(at([ok, thin, ok, ok, ok, ok, ok]).through).toBeNull();
      expect(at([ok, fail, ok, ok, ok, ok, ok]).through).toBeNull();
    });

    it('a season beyond the last adopted horizon is not established on its own, with the gate\'s finding at that horizon; the seasons before keep their bands and nothing is carried forward', () => {
      const run = rising();
      const p = projected(projectProduction(aaa(), undefined, inForce(run.model)));
      expect(p.seasons.map((x) => x.season)).toEqual([SEASON, SEASON + 1, SEASON + 2, SEASON + 3]);
      expect(p.notEstablished.map((x) => x.season)).toEqual([SEASON + 4, SEASON + 5, SEASON + 6]);
      expect(p.notEstablished[0].reason).toMatch(/4 seasons out/);
      expect(p.notEstablished[0].reason).toMatch(/low/);
      expect(p.notEstablished[0].reason).toMatch(/gate/);
      expect(p.notEstablished[1].reason).toMatch(/5 seasons out/);
      expect(p.notEstablished[2].reason).toMatch(/6 seasons out/);
      // No band, no central, no zero: only the season and why
      for (const x of p.notEstablished) expect(Object.keys(x).sort()).toEqual(['age', 'horizon', 'reason', 'season']);
      // The established seasons are exactly those of the same model served in full
      const a = projected(projectProduction(prospect(), undefined, MEASURED));
      const b = projected(projectProduction(prospect(), undefined, partly()));
      expect(b.seasons).toEqual(a.seasons.slice(0, 4));
      expect(b.notEstablished.map((x) => x.season)).toEqual(a.seasons.slice(4).map((x) => x.season));
      expect(b.notEstablished.map((x) => x.age)).toEqual(a.seasons.slice(4).map((x) => x.age));
      expect(b.basis.arrival?.seasons).toEqual(a.basis.arrival?.seasons.slice(0, 4));
      // A projection served in full has no season not established
      expect(a.notEstablished).toEqual([]);
    });

    it('a total over seasons that include one not established is not a number: it names the seasons it cannot include, never reading them as zero', () => {
      const p = projected(projectProduction(prospect(), undefined, partly()));
      const all = productionTotal(p, SEASON, SEASON + 6);
      expect(all.status).toBe('unknown');
      if (all.status === 'unknown') {
        expect(all.missing).toEqual([SEASON + 4, SEASON + 5, SEASON + 6]);
        expect(all.reason).toMatch(/not established/);
      }
      const known = productionTotal(p, SEASON, SEASON + 3);
      expect(known.status).toBe('known');
      if (known.status === 'known') {
        expect(known.central).toBeCloseTo(p.seasons.reduce((t, x) => t + x.wins.central, 0), 9);
        expect(known.low).toBeCloseTo(p.seasons.reduce((t, x) => t + x.wins.low, 0), 9);
        expect(known.high).toBeCloseTo(p.seasons.reduce((t, x) => t + x.wins.high, 0), 9);
      }
      // An unknown projection has no total at all
      expect(productionTotal(projectProduction(prospect({ ratings: null }), undefined, partly()), SEASON, SEASON + 1).status).toBe('unknown');
    });

    it('a label never claims more calibration than was measured: a partly adopted arrival model is calibrated through N seasons out, never plain calibrated', () => {
      const run = rising();
      expect(run.record.label).toMatch(/through 3 seasons out/);
      expect(run.record.label).not.toMatch(/^calibrated on this save:/);
      expect(run.record.label).toMatch(/4–6 seasons out not established/);
    });
  });
});

describe('hardening F5: an unknown says what it rested on', () => {
  it('a player with no major-league results whose production is unknown names its source: his scouted ratings when his ability was projected and his playing time was not, none when nothing could be projected', () => {
    const noArrival = projectProduction(prospect(), undefined, PRIOR_ONLY);
    expect(noArrival.status).toBe('unknown');
    expect(noArrival.basis.ability?.status).toBe('used');
    expect(noArrival.basis.source).toBe('ratings');
    for (const ratings of [null, ratingsEvidence(syntheticScoutedAbility({ current: null, potential: null }))]) {
      const nothing = projectProduction(prospect({ ratings }), undefined, MEASURED);
      expect(nothing.status).toBe('unknown');
      expect(nothing.basis.source).toBe('none');
    }
  });
});

describe('hardening F4: a prospect\'s playing time follows his projected quality (C-02)', () => {
  /** The measured effect of quality (per WAR per 600 above replacement) and a cell whose players now range from replacement to good. */
  function withQuality(): RatingsModelInForce {
    const model = arrivalModel();
    const population: Array<[number, number]> = Array.from({ length: 20 }, (_, j) => {
      const q = j < 10 ? 0 : (j - 9) * 0.4;
      return [0.5 * q, 0.3 * q];
    });
    for (const cell of model.cells) for (const h of cell.horizons) (h as unknown as { population: Array<[number, number]> }).population = population;
    const effect = { hitter: Array(7).fill(0.5), starter: Array(7).fill(0.5), reliever: Array(7).fill(0.5) };
    const perGame = { hitter: Array(7).fill(0.3), starter: Array(7).fill(0.3), reliever: Array(7).fill(0.3) };
    return { ...MEASURED, model: { ...MEASURED.model, arrival: { ...model, quality: { chance: effect, perGame } } as ArrivalModel } };
  }
  const QUALITY = withQuality();
  const cellAt = (i: number) => arrivalModel().cells.find((c) => c.side === 'batting' && c.level === 3)!.horizons[i]!;
  const at = (over: Partial<RatingsProductionInput>) => prospect({ seasonPlayed: 0, schedule: { games: 162 }, ...over });

  it('a better prospect is likelier to arrive and plays more when he does', () => {
    const base = projected(projectProduction(at({ ratings: hitter({ cur: 56, pot: 70 }) }), undefined, QUALITY));
    const better = projected(projectProduction(at({ ratings: hitter({ cur: 66, pot: 70 }) }), undefined, QUALITY));
    let strictly = 0;
    base.seasons.forEach((s, i) => {
      const b = better.seasons[i].sides[0];
      expect(b.arrival!.chance, `${s.season}`).toBeGreaterThanOrEqual(s.sides[0].arrival!.chance - EPS);
      expect(b.usage.central, `${s.season}`).toBeGreaterThanOrEqual(s.sides[0].usage.central - EPS);
      if (b.arrival!.chance > s.sides[0].arrival!.chance + 1e-6 && b.usage.central > s.sides[0].usage.central + 1e-6) strictly += 1;
      expect(better.seasons[i].wins.central, `${s.season}`).toBeGreaterThanOrEqual(s.wins.central - EPS);
    });
    expect(strictly).toBeGreaterThan(0);
  });

  it('a prospect projected below replacement is not expected to take an average arrival\'s playing time, and his low edge still includes nothing', () => {
    const weak = projected(projectProduction(at({ ratings: hitter({ cur: 25, pot: 30 }) }), undefined, QUALITY));
    const plain = projected(projectProduction(at({ ratings: hitter({ cur: 25, pot: 30 }) }), undefined, MEASURED));
    weak.seasons.forEach((s, i) => {
      if (i === 0) return;
      const A = cellAt(i);
      expect(s.sides[0].rate, `${s.season}`).toBeLessThan(0);
      expect(s.sides[0].usage.central, `${s.season}`).toBeLessThan(A.chance * A.mean);
      // The cell's weaker players no longer make his central more negative than his level's average arrival would
      expect(s.wins.central, `${s.season}`).toBeGreaterThan(plain.seasons[i].wins.central);
      expect(s.wins.low, `${s.season}`).toBeLessThanOrEqual(0);
    });
  });

  it('the players of his level and age together keep the chance and playing time the save measured for them', async () => {
    const R = await import('../server/playerValueRatings.js') as unknown as {
      qualityReading: (base: { chance: number; mean: number; nodes: number[] }, population: Array<[number, number]>, z: number, y: number, games: number | null, tiltChance: boolean) => { chance: number; mean: number; nodes: number[] };
    };
    const base = { chance: 0.2, mean: 250, nodes: Array.from({ length: 10 }, (_, j) => 50 + 40 * j) };
    const population: Array<[number, number]> = Array.from({ length: 20 }, (_, j) => [0.1 * j, 0.02 * j]);
    const readings = population.map(([z, y]) => R.qualityReading(base, population, z, y, 162, true));
    const chance = readings.reduce((s, r) => s + r.chance, 0) / readings.length;
    const opportunities = readings.reduce((s, r) => s + r.chance * r.mean, 0) / readings.length;
    expect(chance).toBeCloseTo(base.chance, 6);
    expect(opportunities).toBeCloseTo(base.chance * base.mean, 4);
    // ...and the better of them is likelier to arrive and plays more
    expect(readings[19].chance).toBeGreaterThan(readings[0].chance);
    expect(readings[19].mean).toBeGreaterThan(readings[0].mean);
  });
});

describe('hardening F4: partial ratings widen a thin record\'s band too (A-15)', () => {
  const thin = (ratings: RatingsEvidence): RatingsProductionInput => ({
    playerId: 9, season: SEASON, seasonPlayed: 0.3, age: 33, batting: [bat(2029, 40, 0.1), bat(2030, 20, 0)], pitching: [], ratings, level: 1,
  });

  it('an unknown glove or running grade spans the scale\'s ends: the band contains every complete reading\'s band', () => {
    for (const [what, unknown, readings] of [
      ['glove', hitter({ cur: 50, pot: 50, glove: null }), [20, 41, 80].map((g) => hitter({ cur: 50, pot: 50, glove: g }))],
      ['running', hitter({ cur: 50, pot: 50, running: null }), [20, 47, 80].map((r) => hitter({ cur: 50, pot: 50, running: r }))],
    ] as const) {
      const u = projected(projectProduction(thin(unknown), undefined, PRIOR_ONLY));
      // Reaching the complete readings never makes the rate band narrower further out
      for (let i = 1; i < u.seasons.length; i += 1) {
        expect(width(u.seasons[i].sides[0].rateBand), `${what}, ${u.seasons[i].season}`).toBeGreaterThanOrEqual(width(u.seasons[i - 1].sides[0].rateBand) - EPS);
        expect(width(u.seasons[i].sides[0].rateInner), `${what}, ${u.seasons[i].season}`).toBeGreaterThanOrEqual(width(u.seasons[i - 1].sides[0].rateInner) - EPS);
      }
      for (const ev of readings) {
        const c = projected(projectProduction(thin(ev), undefined, PRIOR_ONLY));
        c.seasons.forEach((s, i) => {
          if (i === 0) return;
          const x = u.seasons[i];
          expect(x.wins.low, `${what}, ${s.season}`).toBeLessThanOrEqual(s.wins.low + 1e-6);
          expect(x.wins.high, `${what}, ${s.season}`).toBeGreaterThanOrEqual(s.wins.high - 1e-6);
          expect(x.sides[0].rateBand.low, `${what}, ${s.season}`).toBeLessThanOrEqual(s.sides[0].rateBand.low + 1e-6);
          expect(x.sides[0].rateBand.high, `${what}, ${s.season}`).toBeGreaterThanOrEqual(s.sides[0].rateBand.high - 1e-6);
        });
      }
    }
  });
});

describe('ratings through the reader (fixture league)', () => {
  const HERE = 9101;
  const THERE = 9102;

  beforeAll(() => {
    db.exec(`ALTER TABLE leagues ADD COLUMN rules_schedule_games_per_team INTEGER`);
    db.prepare(`UPDATE leagues SET rules_schedule_games_per_team = 162 WHERE league_id = ?`).run(IDS.league);
    for (const team of [IDS.mlbTeam, IDS.otherMlbTeam]) {
      db.prepare(`INSERT INTO team_record (team_id, g, w, l, t, pos, pct, gb, streak, magic_number) VALUES (?, 54, 27, 27, 0, 1, .5, 0, 0, 0)`).run(team);
    }
    const player = db.prepare(
      `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws, uniform_number,
                            team_id, organization_id, retired, hidden, draft_eligible, college)
       VALUES (?, 'Same', 'Line', 24, 6, 0, 1, 1, 7, ?, ?, 0, 0, 0, 0)`
    );
    player.run(HERE, IDS.mlbTeam, IDS.mlbTeam);
    player.run(THERE, IDS.otherMlbTeam, IDS.otherMlbTeam);
    const ratings = db.prepare(`INSERT INTO players_batting VALUES (?, 55, 50, 60, 50, 45, 60, 65, 55, 65, 55, 50)`);
    const line = db.prepare(
      `INSERT INTO players_career_batting_stats (player_id, year, team_id, league_id, level_id, split_id, pa, war)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?)`
    );
    for (const [id, team] of [[HERE, IDS.mlbTeam], [THERE, IDS.otherMlbTeam]]) {
      ratings.run(id);
      line.run(id, 2029, team, IDS.league, 80, 0.4);
      line.run(id, 2030, team, IDS.league, 60, 0.3);
    }
  });

  afterAll(() => {
    db.prepare(`DELETE FROM players WHERE player_id IN (${HERE}, ${THERE})`).run();
    db.prepare(`DELETE FROM players_batting WHERE player_id IN (${HERE}, ${THERE})`).run();
    db.prepare(`DELETE FROM players_career_batting_stats WHERE player_id IN (${HERE}, ${THERE})`).run();
    db.prepare(`DELETE FROM team_record`).run();
    db.exec(`ALTER TABLE leagues DROP COLUMN rules_schedule_games_per_team`);
  });

  it('a thin-record player\'s ratings reach his projection through the adapter, and the same evidence on another club is valued on exactly the same terms', () => {
    const values = playerValues([HERE, THERE]);
    const here = values.get(HERE)!.production;
    const there = values.get(THERE)!.production;
    expect(here.status).toBe('projected');
    expect(here.basis.ability?.status).toBe('used');
    expect(here.basis.source).toBe('results_and_ratings');
    expect({ ...there, playerId: HERE }).toEqual(here);
  });

  it('the minor-league reader returns where and how much a player played, never how well: no WAR (Q-9)', () => {
    db.prepare(`INSERT INTO players_career_batting_stats (player_id, year, team_id, league_id, level_id, split_id, pa, war) VALUES (?, 2029, ?, ?, 2, 1, 400, 3.5)`)
      .run(HERE, IDS.aaaTeam, IDS.league);
    try {
      const usage = minorLeagueUsage([HERE], [2], 2025, 2030).get(HERE)!;
      expect(usage).toHaveLength(1);
      expect(usage[0]).toEqual({ season: 2029, level: 2, pa: 400, bf: 0, games: 0, starts: 0 });
      expect(Object.keys(usage[0])).not.toContain('war');
    } finally {
      db.prepare(`DELETE FROM players_career_batting_stats WHERE player_id = ? AND level_id = 2`).run(HERE);
    }
  });

  it('a rating snapshot\'s point of the season is read from the save\'s own schedule for that season, and is not established where the schedule is not exported (hardening F5)', () => {
    const game = db.prepare(`INSERT INTO games (game_id, home_team, away_team, date, played, league_id, game_type) VALUES (?, ?, ?, ?, 1, ?, ?)`);
    try {
      // OOTP writes dates unpadded; an exhibition before Opening Day is not the season
      game.run(990001, IDS.mlbTeam, IDS.otherMlbTeam, '2041-3-1', IDS.league, 4);
      game.run(990002, IDS.mlbTeam, IDS.otherMlbTeam, '2041-4-1', IDS.league, 0);
      game.run(990003, IDS.mlbTeam, IDS.otherMlbTeam, '2041-10-1', IDS.league, 0);
      game.run(990004, IDS.mlbTeam, IDS.otherMlbTeam, '2041-9-28', IDS.league, 0);
      const spans = seasonSpans(IDS.league);
      expect(spans.get(2041)).toEqual({ first: '2041-04-01', last: '2041-10-01' });
      expect(seasonShareOn(spans.get(2041), '2041-07-01')).toBeCloseTo(91 / 183, 6);
      expect(seasonShareOn(spans.get(2041), '2041-02-01')).toBe(0);
      expect(seasonShareOn(spans.get(2041), '2041-12-01')).toBe(1);
      expect(seasonShareOn(spans.get(2042), '2042-07-01')).toBeNull();
    } finally {
      db.prepare(`DELETE FROM games WHERE game_id BETWEEN 990001 AND 990004`).run();
    }
  });
});
