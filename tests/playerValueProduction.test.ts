import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import {
  PRODUCTION_PENDING_RATINGS, playerValues, projectProduction,
  type PlayerProduction, type ProductionInput, type ProductionLine, type ProductionModelInForce, type WinsBand,
} from '../server/playerValue.js';
import { PRODUCTION_PRIOR } from '../server/playerValueCalibration.js';
import { readInjuryProneness } from '../server/injuryProneness.js';
import { IDS } from './fixture';

/*
 * Player Value phase 3a: expected production in wins, for players with a major-league record (D-052,
 * PLAYER_VALUE.md Part 2.3, BEHAVIOR_CASES.md "Player Value"). Each `it` is a baseball invariant built
 * from synthetic evidence through `projectProduction`, the pure function that owns the answer; the
 * club and minor-league cases run through the reader against the fixture league. No case names a
 * player or says who is worth more, and none depends on a calibrated number: a recalibration that
 * moves every constant must leave every case here passing.
 */

const SEASON = 2030;

const bat = (season: number, pa: number, war: number): ProductionLine => ({ season, opportunities: pa, war });
const arm = (season: number, bf: number, war: number, games: number, starts: number): ProductionLine =>
  ({ season, opportunities: bf, war, games, starts });

/** A regular: three full seasons at about three wins, and a third of this one. */
const regular = (over: Partial<ProductionInput> = {}): ProductionInput => ({
  playerId: 1, season: SEASON, seasonPlayed: 0.3, age: 27,
  batting: [bat(2027, 610, 3.1), bat(2028, 640, 2.8), bat(2029, 600, 3.4), bat(2030, 190, 1.0)],
  pitching: [],
  ...over,
});

const starter = (over: Partial<ProductionInput> = {}): ProductionInput => ({
  playerId: 2, season: SEASON, seasonPlayed: 0.3, age: 30,
  batting: [],
  pitching: [arm(2027, 780, 3.5, 32, 32), arm(2028, 720, 2.9, 30, 30), arm(2029, 800, 4.0, 33, 33), arm(2030, 240, 1.1, 10, 10)],
  ...over,
});

const reliever = (over: Partial<ProductionInput> = {}): ProductionInput => ({
  playerId: 3, season: SEASON, seasonPlayed: 0.3, age: 33,
  batting: [],
  pitching: [arm(2027, 270, 0.9, 66, 0), arm(2028, 250, 0.4, 61, 0), arm(2029, 280, 1.2, 70, 0), arm(2030, 80, 0.2, 20, 0)],
  ...over,
});

/** A star: seven wins a season, so every low edge is well above producing nothing. */
const star = (over: Partial<ProductionInput> = {}): ProductionInput => regular({
  playerId: 6, batting: [bat(2027, 680, 7.2), bat(2028, 690, 7.6), bat(2029, 700, 7.0), bat(2030, 210, 2.3)], ...over,
});

/** A veteran past any peak. */
const veteran = (over: Partial<ProductionInput> = {}): ProductionInput => regular({ playerId: 4, age: 37, ...over });

/** A September call-up and a few weeks of this season: thin results. */
const thin = (over: Partial<ProductionInput> = {}): ProductionInput => ({
  playerId: 5, season: SEASON, seasonPlayed: 0.3, age: 24,
  batting: [bat(2029, 70, 0.4), bat(2030, 45, 0.1)],
  pitching: [],
  ...over,
});

const CAST: Array<[string, () => ProductionInput]> = [
  ['a regular', () => regular()], ['a starter', () => starter()], ['a reliever', () => reliever()],
  ['a veteran', () => veteran()], ['a thin record', () => thin()],
];

const width = (b: WinsBand): number => b.high - b.low;
const EPS = 1e-9;

function projected(input: ProductionInput): PlayerProduction {
  const p = projectProduction(input);
  expect(p.status, p.reason ?? '').toBe('projected');
  return p;
}

/** Results changed, the usage the playing time is read from held as it was: "the same expected playing time". */
function sameUsage(input: ProductionInput, results: Partial<Pick<ProductionInput, 'batting' | 'pitching'>>): ProductionInput {
  return { ...input, ...results, usage: { batting: input.batting, pitching: input.pitching } };
}

function expectNoNarrower(thinner: PlayerProduction, fuller: PlayerProduction, label: string): void {
  expect(thinner.seasons.length, label).toBe(fuller.seasons.length);
  fuller.seasons.forEach((s, i) => {
    expect(width(thinner.seasons[i].wins), `${label}, ${s.season}`).toBeGreaterThanOrEqual(width(s.wins) - EPS);
  });
}

describe('expected production (phase 3a): unknown stays unknown', () => {
  it('a player with no major-league results in the projection window is unknown, pending the ratings-based projection: never zero, never a league average', () => {
    for (const input of [
      regular({ batting: [] }),
      regular({ batting: [bat(2019, 600, 4)] }),
      regular({ batting: [bat(2029, 0, 0)] }),
    ]) {
      const p = projectProduction(input);
      expect(p.status).toBe('unknown');
      expect(p.reason).toContain(PRODUCTION_PENDING_RATINGS);
      expect(p.seasons).toEqual([]);
    }
  });

  it('a missing age, WAR, season or share of the season played leaves production unknown with the reason, never a midpoint', () => {
    const cases: Array<[string, ProductionInput]> = [
      ['age', regular({ age: null })],
      ['season', regular({ season: null })],
      ['share of the season', regular({ seasonPlayed: null })],
      ['WAR', regular({ batting: [bat(2027, 610, 3.1), { season: 2028, opportunities: 640, war: null }, bat(2029, 600, 3.4)] })],
    ];
    for (const [what, input] of cases) {
      const p = projectProduction(input);
      expect(p.status, what).toBe('unknown');
      expect(p.reason, what).toBeTruthy();
      expect(p.reason, what).not.toContain(PRODUCTION_PENDING_RATINGS);
      expect(p.seasons, what).toEqual([]);
    }
  });
});

describe('expected production (phase 3a): the band only widens', () => {
  it.each(CAST)('spans this season through the seven-season horizon, in the export\'s WAR units (%s)', (_, make) => {
    const p = projected(make());
    expect(p.seasons.map((s) => s.season)).toEqual([2030, 2031, 2032, 2033, 2034, 2035, 2036]);
    expect(p.unit).toMatch(/WAR/);
    for (const s of p.seasons) {
      expect(s.wins.low).toBeLessThanOrEqual(s.wins.central);
      expect(s.wins.central).toBeLessThanOrEqual(s.wins.high);
    }
  });

  it.each(CAST)('his rate band is at least as wide in every season further out as in the one before (%s)', (_, make) => {
    const p = projected(make());
    for (let i = 1; i < p.seasons.length; i += 1) {
      for (const [j, side] of p.seasons[i].sides.entries()) {
        const before = p.seasons[i - 1].sides[j];
        expect(width(side.rateBand), `${p.seasons[i].season}`).toBeGreaterThanOrEqual(width(before.rateBand) - EPS);
        expect(width(side.rateInner), `${p.seasons[i].season}`).toBeGreaterThanOrEqual(width(before.rateInner) - EPS);
        expect(side.rateBand.low).toBeLessThanOrEqual(side.rate + EPS);
        expect(side.rateBand.high).toBeGreaterThanOrEqual(side.rate - EPS);
      }
    }
  });

  it('a player whose expected playing time declines may have a narrower wins band, but never a narrower rate band', () => {
    const p = projected(veteran({ age: 38 }));
    const usage = p.seasons.map((s) => s.sides[0].usage.central);
    // His expected playing time fades after the first full season...
    expect(usage[usage.length - 1]).toBeLessThan(usage[1]);
    // ...and the wins band follows it down somewhere, while the rate band never narrows
    const narrowed = p.seasons.slice(2).some((s, i) => width(s.wins) < width(p.seasons[i + 1].wins) - EPS);
    expect(narrowed).toBe(true);
    expect(width(p.seasons[p.seasons.length - 1].wins)).toBeLessThan(width(p.seasons[1].wins));
    for (let i = 1; i < p.seasons.length; i += 1) {
      expect(width(p.seasons[i].sides[0].rateBand)).toBeGreaterThanOrEqual(width(p.seasons[i - 1].sides[0].rateBand) - EPS);
    }
  });

  it('each season carries its coverage target and what the fit in force observed on held-out seasons, side by side', () => {
    const p = projected(regular());
    p.seasons.forEach((s, i) => {
      expect(s.coverage.horizon).toBe(i + 1);
      expect(s.coverage.target).toEqual({ outer: 0.8, inner: 0.5 });
      // The fallback prior was not measured on held-out seasons of this save: observed is unknown, never the target
      expect(s.coverage.observed).toBeNull();
      expect(s.coverage.note).toMatch(/not measured/i);
    });
  });

  it.each(CAST)('removing a season of results never narrows the band on the same expected playing time (%s)', (_, make) => {
    const input = make();
    const full = projected(input);
    const side = input.batting.length > 0 ? 'batting' : 'pitching';
    for (const drop of input[side].map((l) => l.season)) {
      const fewer = input[side].filter((l) => l.season !== drop);
      if (!fewer.some((l) => l.opportunities > 0)) continue;
      const thinner = projected(sameUsage(input, { [side]: fewer }));
      expectNoNarrower(thinner, full, `without ${drop}`);
      // ...and what is known about his rate is never more certain
      expect(thinner.basis.sides[0].rateUncertainty).toBeGreaterThanOrEqual(full.basis.sides[0].rateUncertainty - EPS);
    }
  });

  it.each(CAST)('reducing a season\'s plate appearances or batters faced never narrows the band on the same expected playing time (%s)', (_, make) => {
    const input = make();
    const full = projected(input);
    const side = input.batting.length > 0 ? 'batting' : 'pitching';
    for (const season of input[side].map((l) => l.season)) {
      for (const share of [0.5, 0.1]) {
        // The same rate on fewer opportunities: less evidence of the same kind
        const fewer = input[side].map((l) => (l.season === season
          ? { ...l, opportunities: Math.round(l.opportunities * share), war: (l.war ?? 0) * share }
          : l));
        const thinner = projected(sameUsage(input, { [side]: fewer }));
        expectNoNarrower(thinner, full, `${season} at ${share}`);
        expect(thinner.basis.sides[0].rateUncertainty).toBeGreaterThanOrEqual(full.basis.sides[0].rateUncertainty - EPS);
      }
    }
  });

  it('thinner usage evidence never narrows the playing-time band relative to its central', () => {
    const input = regular();
    const full = projected(input);
    const less = projected({ ...input, usage: { batting: input.batting.map((l) => ({ ...l, opportunities: Math.round(l.opportunities / 4) })) } });
    full.seasons.forEach((s, i) => {
      const a = s.sides[0].usage;
      const b = less.seasons[i].sides[0].usage;
      if (a.central <= 0 || b.central <= 0) return;
      expect((b.high - b.low) / b.central, `${s.season}`).toBeGreaterThanOrEqual((a.high - a.low) / a.central - EPS);
    });
  });

  it('a player outside the organization is valued on exactly the same terms: the projection has no club input at all', () => {
    // The reader case below proves it end to end; here, the input type carries no club, so no club can move it
    const input = regular() as unknown as Record<string, unknown>;
    expect(Object.keys(input).some((k) => /team|org|club|holder/i.test(k))).toBe(false);
  });
});

describe('expected production (phase 3a): what the evidence says', () => {
  it.each(CAST)('a better visible line, all else equal, never lowers expected wins, nor either edge (%s)', (_, make) => {
    const input = make();
    const base = projected(input);
    const side = input.batting.length > 0 ? 'batting' : 'pitching';
    for (const season of input[side].map((l) => l.season)) {
      const better = projected({
        ...input,
        [side]: input[side].map((l) => (l.season === season ? { ...l, war: (l.war ?? 0) + 1 } : l)),
      });
      base.seasons.forEach((s, i) => {
        const b = better.seasons[i].wins;
        expect(b.central, `${season} → ${s.season}`).toBeGreaterThanOrEqual(s.wins.central - EPS);
        expect(b.low, `${season} → ${s.season}`).toBeGreaterThanOrEqual(s.wins.low - EPS);
        expect(b.high, `${season} → ${s.season}`).toBeGreaterThanOrEqual(s.wins.high - EPS);
      });
    }
  });

  it('the current partial season counts in proportion to its playing time, and what he has banked is a fact beside the band', () => {
    const hot = (pa: number) => regular({ batting: [...regular().batting.filter((l) => l.season !== SEASON), bat(SEASON, pa, (pa / 600) * 8)] });
    const few = projected(hot(40));
    const many = projected(hot(200));
    expect(many.basis.sides[0].regressedRate).toBeGreaterThan(few.basis.sides[0].regressedRate);
    for (const p of [few, many]) {
      const now = p.seasons[0];
      expect(now.toDate).toBeCloseTo((now.season === SEASON ? p.basis.sides[0].seasons.find((s) => s.season === SEASON)?.war : null) ?? NaN, 9);
      expect(now.remaining).not.toBeNull();
      expect(now.wins.central).toBeCloseTo(now.toDate! + now.remaining!.central, 9);
      expect(width(now.wins)).toBeCloseTo(width(now.remaining!), 9);
    }
    // Later seasons carry no to-date figure: nothing has been banked in them
    expect(many.seasons.slice(1).every((s) => s.toDate === null && s.remaining === null)).toBe(true);
  });

  it('a two-way player\'s band is the sum of both sides, edge with edge', () => {
    const hitter = regular();
    const pitcher = starter();
    const both = projected({ ...hitter, pitching: pitcher.pitching });
    const b = projected(hitter);
    const p = projected({ ...pitcher, age: hitter.age });
    both.seasons.forEach((s, i) => {
      expect(s.sides.map((x) => x.side).sort()).toEqual(['batting', 'pitching']);
      expect(s.wins.central).toBeCloseTo(b.seasons[i].wins.central + p.seasons[i].wins.central, 9);
      expect(s.wins.low).toBeCloseTo(b.seasons[i].wins.low + p.seasons[i].wins.low, 9);
      expect(s.wins.high).toBeCloseTo(b.seasons[i].wins.high + p.seasons[i].wins.high, 9);
    });
  });

  it('a stated injury only widens: it lowers a low edge and never moves the central or the high edge', () => {
    const base = projected(star());
    const hurt = projected(star({
      injury: { injured: true, daysLeft: 200, careerEnding: false, seasonDaysLeft: 130, seasonDays: 186 },
    }));
    base.seasons.forEach((s, i) => {
      expect(hurt.seasons[i].wins.central).toBeCloseTo(s.wins.central, 9);
      expect(hurt.seasons[i].wins.high).toBeCloseTo(s.wins.high, 9);
      expect(hurt.seasons[i].wins.low).toBeLessThanOrEqual(s.wins.low + EPS);
    });
    // Out past the end of this season: this season and the next both widen
    expect(hurt.seasons[0].wins.low).toBeLessThan(base.seasons[0].wins.low);
    expect(hurt.seasons[1].wins.low).toBeLessThan(base.seasons[1].wins.low);
    expect(hurt.seasons[0].notes.join(' ')).toMatch(/injur/i);
    // With no injury stated, nothing moves
    const healthy = projected(star({ injury: { injured: false, daysLeft: 0, careerEnding: false, seasonDaysLeft: 130, seasonDays: 186 } }));
    expect(healthy.seasons).toEqual(base.seasons);
  });

  it('a career-ending injury puts producing nothing at all inside every season\'s band', () => {
    const base = projected(regular());
    const ended = projected(regular({ injury: { injured: true, daysLeft: null, careerEnding: true, seasonDaysLeft: null, seasonDays: null } }));
    ended.seasons.forEach((s, i) => {
      const nothing = i === 0 ? s.toDate ?? 0 : 0;
      expect(s.wins.low).toBeLessThanOrEqual(nothing + EPS);
      expect(s.wins.central).toBeCloseTo(base.seasons[i].wins.central, 9);
      expect(s.wins.high).toBeCloseTo(base.seasons[i].wins.high, 9);
    });
  });

  it('the basis names the seasons, the opportunities, the regression and the age adjustment', () => {
    const p = projected(regular());
    const side = p.basis.sides[0];
    expect(side.side).toBe('batting');
    expect(side.kind).toBe('hitter');
    expect(side.seasons.map((s) => s.season)).toEqual([2027, 2028, 2029, 2030]);
    expect(side.opportunities).toBe(610 + 640 + 600 + 190);
    expect(side.regressionShare).toBeGreaterThan(0);
    expect(side.regressionShare).toBeLessThan(1);
    for (const s of p.seasons) expect(typeof s.sides[0].aging).toBe('number');
  });

  it('the fallback prior is labelled as such and stamped provisional, never presented as the save\'s own calibration (D-053)', () => {
    const p = projected(regular());
    expect(p.basis.model.source).toBe('fallback_prior');
    expect(p.basis.calibration.status).toBe('provisional');
    expect(p.basis.calibration.basis).toMatch(/fallback prior/i);
    expect(p.basis.model.label).toMatch(/fallback prior/);
  });
});

describe('expected production (phase 3a): two bands and injury proneness', () => {
  it.each(CAST)('the 50% band sits inside the 80% band, for wins and for the rate, and both rate bands widen with the horizon (%s)', (_, make) => {
    const p = projected(make());
    p.seasons.forEach((s, i) => {
      expect(s.inner.low, `${s.season}`).toBeGreaterThanOrEqual(s.wins.low - EPS);
      expect(s.inner.high, `${s.season}`).toBeLessThanOrEqual(s.wins.high + EPS);
      expect(s.inner.low).toBeLessThanOrEqual(s.inner.central + EPS);
      expect(s.inner.central).toBeLessThanOrEqual(s.inner.high + EPS);
      for (const side of s.sides) {
        expect(side.rateInner.low).toBeGreaterThanOrEqual(side.rateBand.low - EPS);
        expect(side.rateInner.high).toBeLessThanOrEqual(side.rateBand.high + EPS);
      }
      if (i > 0) {
        expect(width(s.sides[0].rateBand), `${s.season}`).toBeGreaterThanOrEqual(width(p.seasons[i - 1].sides[0].rateBand) - EPS);
        expect(width(s.sides[0].rateInner), `${s.season}`).toBeGreaterThanOrEqual(width(p.seasons[i - 1].sides[0].rateInner) - EPS);
      }
    });
  });

  /** A model whose fit found proneness effects on playing time and aging (the numbers are only a shape). */
  const withProneness = (): ProductionModelInForce => ({
    model: {
      ...PRODUCTION_PRIOR,
      proneness: {
        cuts: [59, 86],
        usage: { hitter: [1.02, 1, 0.9], pitcher: [1, 1.04, 0.95] },
        aging: { hitter: [[0, 0], [0, -0.1], [0.05, -0.3]], pitcher: [[0, 0], [0, 0], [0, -0.2]] },
        ageSplit: 30,
        findings: [],
      },
    },
    provenance: { source: 'save_fit', label: 'test fit', stamp: { status: 'calibrated', basis: 'test', run: 'test' }, fitId: 'test', priorWeight: 0 },
  });
  const without = (): ProductionModelInForce => ({ ...withProneness(), model: { ...PRODUCTION_PRIOR, proneness: null } });

  it.each(CAST)('injury proneness never narrows a band, and an unknown proneness is at least as wide as any known one (%s)', (_, make) => {
    const base = projectProduction(make(), without());
    const unknownProne = projectProduction({ ...make(), proneness: null }, withProneness());
    for (const value of [40, 70, 120]) {
      const known = projectProduction({ ...make(), proneness: value }, withProneness());
      known.seasons.forEach((s, i) => {
        expect(width(s.wins), `${value}, ${s.season}`).toBeGreaterThanOrEqual(width(base.seasons[i].wins) - EPS);
        expect(width(s.inner), `${value}, ${s.season}`).toBeGreaterThanOrEqual(width(base.seasons[i].inner) - EPS);
        expect(width(unknownProne.seasons[i].wins), `unknown vs ${value}, ${s.season}`).toBeGreaterThanOrEqual(width(s.wins) - EPS);
      });
    }
    // The fit found effects, so not knowing which band he is in is strictly wider than knowing none were found
    unknownProne.seasons.forEach((s, i) => expect(width(s.wins)).toBeGreaterThan(width(base.seasons[i].wins)));
  });

  it('a missing proneness value is unknown, never normal: the central is not moved and the basis says so', () => {
    const p = projectProduction({ ...regular(), proneness: null }, withProneness());
    const base = projectProduction(regular(), without());
    expect(p.basis.proneness.value).toBeNull();
    expect(p.basis.proneness.band).toBeNull();
    expect(p.basis.proneness.note).toMatch(/unknown/i);
    p.seasons.forEach((s, i) => expect(s.wins.central).toBeCloseTo(base.seasons[i].wins.central, 9));
    // Absent is unknown too
    expect(projectProduction({ ...regular(), proneness: undefined }, withProneness()).basis.proneness.value).toBeNull();
  });

  it('the save\'s own fit shows the coverage it observed beside the target, even on target', () => {
    const observed = [1, 2, 3, 4, 5, 6, 7].map((horizon) => ({ horizon, cases: 500, outer: 0.8, inner: 0.5, bias: 0 }));
    const using = withProneness();
    const p = projectProduction(regular(), { ...using, provenance: { ...using.provenance, observed } });
    p.seasons.forEach((s, i) => expect(s.coverage.observed).toEqual({ outer: 0.8, inner: 0.5, cases: 500, horizon: i + 1 }));
  });

  it('the save\'s own fit is stamped with its run record, the prior never is', () => {
    const p = projectProduction(regular(), withProneness());
    expect(p.basis.model.source).toBe('save_fit');
    expect(p.basis.calibration.status).toBe('calibrated');
    expect(p.basis.calibration.run).toBeTruthy();
  });
});

describe('expected production through the reader (fixture league)', () => {
  const HERE = 9001;
  const THERE = 9002;

  beforeAll(() => {
    // The fixture has no schedule length or standings; give the league a third of a season played
    db.exec(`ALTER TABLE leagues ADD COLUMN rules_schedule_games_per_team INTEGER`);
    db.prepare(`UPDATE leagues SET rules_schedule_games_per_team = 162 WHERE league_id = ?`).run(IDS.league);
    for (const team of [IDS.mlbTeam, IDS.otherMlbTeam]) {
      db.prepare(`INSERT INTO team_record (team_id, g, w, l, t, pos, pct, gb, streak, magic_number) VALUES (?, 54, 27, 27, 0, 1, .5, 0, 0, 0)`).run(team);
    }
    const player = db.prepare(
      `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws, uniform_number,
                            team_id, organization_id, retired, hidden, draft_eligible, college)
       VALUES (?, 'Same', 'Line', 28, 6, 0, 1, 1, 7, ?, ?, 0, 0, 0, 0)`
    );
    player.run(HERE, IDS.mlbTeam, IDS.mlbTeam);
    player.run(THERE, IDS.otherMlbTeam, IDS.otherMlbTeam);
    const line = db.prepare(
      `INSERT INTO players_career_batting_stats (player_id, year, team_id, league_id, level_id, split_id, pa, war)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?)`
    );
    for (const [id, team] of [[HERE, IDS.mlbTeam], [THERE, IDS.otherMlbTeam]]) {
      line.run(id, 2028, team, IDS.league, 620, 2.6);
      line.run(id, 2029, team, IDS.league, 600, 3.0);
      line.run(id, 2030, team, IDS.league, 200, 1.1);
    }
  });

  afterAll(() => {
    db.prepare(`DELETE FROM players WHERE player_id IN (${HERE}, ${THERE})`).run();
    db.prepare(`DELETE FROM players_career_batting_stats WHERE player_id IN (${HERE}, ${THERE})`).run();
  });

  it('the same evidence on another club is valued on exactly the same terms', () => {
    const values = playerValues([HERE, THERE]);
    const here = values.get(HERE)!.production;
    const there = values.get(THERE)!.production;
    expect(here.status).toBe('projected');
    expect({ ...there, playerId: HERE }).toEqual(here);
  });

  it('injury proneness is read only as exported: a missing column, a blank or a 0 is unknown, never normal', () => {
    // The fixture exports no proneness column at all
    const none = readInjuryProneness([IDS.starter]).get(IDS.starter)!;
    expect(none.overall.value).toBeNull();
    expect(none.overall.note).toMatch(/no prone_overall column/);
    db.exec(`ALTER TABLE players ADD COLUMN prone_overall REAL`);
    try {
      db.prepare(`UPDATE players SET prone_overall = ? WHERE player_id = ?`).run(70, HERE);
      db.prepare(`UPDATE players SET prone_overall = ? WHERE player_id = ?`).run(0, THERE);
      const read = readInjuryProneness([HERE, THERE, IDS.starter]);
      expect(read.get(HERE)!.overall.value).toBe(70);
      expect(read.get(HERE)!.basis).toBe('owner_attested');
      expect(read.get(THERE)!.overall.value).toBeNull();
      expect(read.get(IDS.starter)!.overall.value).toBeNull();
      const values = playerValues([HERE, THERE]);
      expect(values.get(HERE)!.production.basis.proneness.value).toBe(70);
      expect(values.get(THERE)!.production.basis.proneness.value).toBeNull();
    } finally {
      db.exec(`ALTER TABLE players DROP COLUMN prone_overall`);
    }
  });

  it('minor-league and amateur WAR never stand in for a major-league record (Q-9)', () => {
    // The draftee has only a school line; the starter has a major-league line and an older Triple-A one
    const values = playerValues([IDS.draftee, IDS.starter]);
    const draftee = values.get(IDS.draftee)!.production;
    expect(draftee.status).toBe('unknown');
    expect(draftee.reason).toContain(PRODUCTION_PENDING_RATINGS);
    const starterSeasons = values.get(IDS.starter)!.production;
    expect(starterSeasons.status).toBe('projected');
    expect(starterSeasons.basis.sides.flatMap((s) => s.seasons.map((x) => x.season))).toEqual([2030]);
  });
});
