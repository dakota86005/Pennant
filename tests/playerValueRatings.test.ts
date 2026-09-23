import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import {
  PRODUCTION_NO_EVIDENCE, fitRatingsModel, playerValues, projectProduction, ratingsEvidence,
  type ArrivalModel, type Observation, type PlayerProduction, type ProductionLine, type RatingsEvidence, type RatingsFitInput,
  type RatingsModelInForce, type RatingsProductionInput, type WinsBand,
} from '../server/playerValue.js';
import { PRODUCTION_PRIOR, RATINGS_PRIOR } from '../server/playerValueCalibration.js';
import { minorLeagueUsage } from '../server/playerValueHistory.js';
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
    expect(r.id).toBe('1:2025:ratings-3b.1');
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
});
