import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import {
  PRODUCTION_NO_EVIDENCE, playerValues, projectProduction,
  type PlayerProduction, type ProductionInput, type ProductionLine, type ProductionModelInForce, type WinsBand,
} from '../server/playerValue.js';
import { PRODUCTION_PRIOR } from '../server/playerValueCalibration.js';
import { adaptPriorToLeague, projectProductionWith } from '../server/playerValueProduction.js';
import { injuryDurationSentinels, leagueSeasons, majorLeagueLines, scheduledGames } from '../server/playerValueHistory.js';
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
  it('a player with no major-league results in the projection window and no ability evidence is unknown: never zero, never a league average', () => {
    for (const input of [
      regular({ batting: [] }),
      regular({ batting: [bat(2019, 600, 4)] }),
      regular({ batting: [bat(2029, 0, 0)] }),
    ]) {
      const p = projectProduction(input);
      expect(p.status).toBe('unknown');
      expect(p.reason).toContain(PRODUCTION_NO_EVIDENCE);
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
      expect(p.reason, what).not.toContain(PRODUCTION_NO_EVIDENCE);
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
      // At the model's own horizon: a third of this season played, 2031 is 1.7 seasons out (B-05)
      expect(s.coverage.horizon).toBeCloseTo(i + 1 - 0.3, 9);
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
    // The same rate on a quarter of the playing time: thinner usage evidence, not a better player
    const less = projected({ ...input, usage: { batting: input.batting.map((l) => ({ ...l, opportunities: Math.round(l.opportunities / 4), war: (l.war ?? 0) / 4 })) } });
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
  it.each(CAST)('a better visible line, all else equal, never lowers expected wins, nor the high edge (%s)', (_, make) => {
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
        // The low edge may move down: a better player is expected to play more, and uncertainty about
        // that playing time widens his band both ways (phase 3b, playing time conditional on quality)
        expect(b.high, `${season} → ${s.season}`).toBeGreaterThanOrEqual(s.wins.high - EPS);
      });
    }
  });

  it('a better player is expected to keep more of his playing time than a worse one of the same age and usage', () => {
    for (const [label, better, worse] of [
      ['hitters', regular({ age: 29 }), regular({ age: 29, batting: regular().batting.map((l) => ({ ...l, war: (l.war ?? 0) * 0.1 })) })],
      ['starters', starter(), starter({ pitching: starter().pitching.map((l) => ({ ...l, war: (l.war ?? 0) * 0.1 })) })],
    ] as const) {
      const b = projected(better);
      const w = projected(worse);
      // Same age, same observed playing time: only the quality differs
      b.seasons.forEach((s, i) => {
        if (i === 0) return;
        expect(s.sides[0].usage.central, `${label}, ${s.season}`).toBeGreaterThanOrEqual(w.seasons[i].sides[0].usage.central - EPS);
      });
      // ...and three seasons on, while he is still above replacement, strictly more of it
      expect(b.seasons[3].sides[0].usage.central, label).toBeGreaterThan(w.seasons[3].sides[0].usage.central);
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

  it('known days out are a fact: they come off expected playing time (the central moves down), and the band keeps the high edge of an earlier return (owner, 2026-09-23)', () => {
    const base = projected(star());
    const hurt = projected(star({
      injury: { injured: true, daysLeft: 400, careerEnding: false, seasonDaysLeft: 130, seasonDays: 186, offseasonDays: 179 },
    }));
    // This season: the rest of it is lost, so the central falls to what he has banked; the next: 91 of 186 days
    expect(hurt.seasons[0].wins.central).toBeLessThan(base.seasons[0].wins.central - 0.5);
    expect(hurt.seasons[0].remaining!.central).toBeCloseTo(0, 6);
    expect(hurt.seasons[1].wins.central).toBeLessThan(base.seasons[1].wins.central);
    expect(hurt.seasons[1].sides[0].usage.central).toBeLessThan(base.seasons[1].sides[0].usage.central);
    for (const i of [0, 1]) {
      expect(hurt.seasons[i].wins.high, `${hurt.seasons[i].season}`).toBeCloseTo(base.seasons[i].wins.high, 9);
      expect(hurt.seasons[i].wins.low, `${hurt.seasons[i].season}`).toBeLessThanOrEqual(base.seasons[i].wins.low + EPS);
      expect(hurt.seasons[i].notes.join(' ')).toMatch(/injur/i);
    }
    // Days that end before a season starts touch nothing in it
    base.seasons.slice(2).forEach((s, i) => expect(hurt.seasons[i + 2].wins).toEqual(s.wins));
    // With no injury stated, nothing moves
    const healthy = projected(star({ injury: { injured: false, daysLeft: 0, careerEnding: false, seasonDaysLeft: 130, seasonDays: 186 } }));
    expect(healthy.seasons).toEqual(base.seasons);
  });

  it('a career-ending injury puts producing nothing at all inside every season\'s band, and every later central is nothing', () => {
    const base = projected(regular());
    const ended = projected(regular({ injury: { injured: true, daysLeft: null, careerEnding: true, seasonDaysLeft: null, seasonDays: null } }));
    ended.seasons.forEach((s, i) => {
      const nothing = i === 0 ? s.toDate ?? 0 : 0;
      expect(s.wins.low).toBeLessThanOrEqual(nothing + EPS);
      expect(s.wins.central).toBeCloseTo(nothing, 9);
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
    // The rest of the season under way is not measured; later seasons carry the fit's figure at their own horizon
    expect(p.seasons[0].coverage.observed).toBeNull();
    p.seasons.slice(1).forEach((s, i) => expect(s.coverage.observed).toEqual({ outer: 0.8, inner: 0.5, cases: 500, horizon: i + 2 - 0.3 }));
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
    // His school line is not a major-league record: no results-based band, and no season built from it
    expect(draftee.status).toBe('unknown');
    expect(draftee.basis.sides).toEqual([]);
    expect(draftee.seasons).toEqual([]);
    const starterSeasons = values.get(IDS.starter)!.production;
    expect(starterSeasons.status).toBe('projected');
    expect(starterSeasons.basis.sides.flatMap((s) => s.seasons.map((x) => x.season))).toEqual([2030]);
  });
});

describe('expected production (hardening, 2026-09-23): the central, playing time and the calendar', () => {
  const fullSchedule = { games: 162, bySeason: { 2027: 162, 2028: 162, 2029: 162 } };
  const ceilingOf = (kind: 'hitter' | 'starter' | 'reliever'): number => {
    const c = (PRODUCTION_PRIOR.kinds[kind] as { ceiling?: number | null }).ceiling;
    expect(typeof c === 'number' && Number.isFinite(c) && c > 0, `${kind} ceiling`).toBe(true);
    return c as number;
  };

  it.each([['a star', () => star({ schedule: fullSchedule })], ['a starter', () => starter({ schedule: fullSchedule })]] as const)(
    'no season\'s playing-time high edge exceeds the most the save shows a player playing in a season of that length (%s)',
    (_, make) => {
      const input = make();
      const p = projected(input);
      const kind = p.basis.sides[0].kind;
      const perGame = ceilingOf(kind);
      p.seasons.forEach((s, i) => {
        const share = i === 0 ? 1 - (input.seasonPlayed ?? 0) : 1;
        const most = perGame * 162 * share;
        const side = s.sides[0];
        expect(side.usage.high, `${s.season}`).toBeLessThanOrEqual(most + EPS);
        // ...and the wins high edge is at most that ceiling at the high edge of his rate
        if (side.rateBand.high > 0) expect(s.remaining?.high ?? s.wins.high, `${s.season}`).toBeLessThanOrEqual((most * side.rateBand.high) / 600 + EPS);
      });
    },
  );

  it('playing time is relative to the schedule: in a 60-game league no playing-time band exceeds what 60 games allow', () => {
    const sixty = { games: 60, bySeason: { 2027: 60, 2028: 60, 2029: 60 } };
    const p = projected(regular({ schedule: sixty, batting: [bat(2027, 230, 1.2), bat(2028, 240, 1.0), bat(2029, 225, 1.3), bat(2030, 70, 0.4)] }));
    const most = ceilingOf('hitter') * 60;
    p.seasons.slice(1).forEach((s) => expect(s.sides[0].usage.high, `${s.season}`).toBeLessThanOrEqual(most + EPS));
    // ...and a regular there is still a regular: well over half of what 60 games allow
    expect(p.seasons[1].sides[0].usage.central).toBeGreaterThan(0.5 * most);
  });

  it('a past short season (60 of 162 games) is read at its own schedule, never as a part-timer\'s season', () => {
    const lines = [bat(2027, 610, 3.1), bat(2028, 230, 1.1), bat(2029, 600, 3.4), bat(2030, 190, 1.0)];
    const known = projected(regular({ batting: lines, schedule: { games: 162, bySeason: { 2027: 162, 2028: 60, 2029: 162 } } }));
    const full = projected(regular({ schedule: fullSchedule }));
    // Reading 2028 at its own 60 games, he played every day: next season's playing time is a regular's
    expect(known.seasons[1].sides[0].usage.central).toBeGreaterThan(0.97 * full.seasons[1].sides[0].usage.central);
  });

  it('seasons before the league existed are unknown, not zero: a first-season regular\'s next-season band holds a regular\'s playing time', () => {
    const first = projected(regular({
      seasonPlayed: 0.25, age: 27, batting: [bat(2030, 168, 2.2)],
      schedule: { games: 162, bySeason: {}, firstSeason: 2030 },
    }));
    const next = first.seasons[1].sides[0].usage;
    expect(next.high).toBeGreaterThanOrEqual(600);
    // The same line in a league that did exist the seasons before (he did not play): today's answer stands
    const absent = projected(regular({ seasonPlayed: 0.25, age: 27, batting: [bat(2030, 168, 2.2)], schedule: { games: 162, bySeason: {}, firstSeason: 2000 } }));
    expect(absent.seasons[1].sides[0].usage.central).toBeLessThan(next.central);
  });

  it('the rest of this season is in-season: a player at his pace keeps it where this season\'s games show playing time holds, and close to it where they measure a small loss', () => {
    const relief = reliever({ schedule: fullSchedule, pitching: [arm(2027, 270, 0.9, 66, 0), arm(2028, 270, 0.9, 66, 0), arm(2029, 270, 0.9, 66, 0), arm(2030, 81, 0.27, 20, 0)] });
    const pace = 270 * 0.7;
    const holds = projected({ ...relief, inSeason: { continuation: { hitter: 1, starter: 1, reliever: 1 }, measuredShare: 0.15, games: 24, note: 'test' } });
    // No playing time lost in this season's games so far: the rest of it is his pace, never next season's attrition
    expect(holds.seasons[0].sides[0].usage.central).toBeGreaterThan(0.97 * pace);
    expect(holds.seasons[0].sides[0].usage.central).toBeLessThanOrEqual(pace + EPS);
    const loses = projected({ ...relief, inSeason: { continuation: { hitter: 0.97, starter: 0.97, reliever: 0.97 }, measuredShare: 0.15, games: 24, note: 'test' } });
    // Losing 3% of playing time per 15% of a season: about 87% of pace holds over the 70% left
    expect(loses.seasons[0].sides[0].usage.central).toBeGreaterThan(0.8 * pace);
    // Not measured: keeping his pace stays inside the band, and the season says so
    const unmeasured = projected(relief);
    expect(unmeasured.seasons[0].sides[0].usage.high).toBeGreaterThanOrEqual(0.95 * pace);
    expect(unmeasured.seasons[0].coverage.observed).toBeNull();
    expect(unmeasured.seasons[0].coverage.note).toMatch(/not measured/i);
  });

  it('a season lost to injury is never read as evidence of less playing time: the central reads his healthy playing time, the band reaches the lost season\'s reading (owner, 2026-09-23)', () => {
    const lines = [arm(2027, 800, 4.0, 32, 32), arm(2028, 790, 3.6, 32, 32), arm(2030, 10, 0.1, 1, 1)];
    const healthyLines = [arm(2027, 800, 4.0, 32, 32), arm(2028, 790, 3.6, 32, 32), arm(2029, 780, 3.8, 32, 32), arm(2030, 240, 1.1, 10, 10)];
    const injury = { injured: true, daysLeft: 20, careerEnding: false, seasonDaysLeft: 130, seasonDays: 186, offseasonDays: 179, injuredThisSeason: true };
    const lost = projected(starter({ pitching: lines, injury, schedule: fullSchedule }));
    const healthy = projected(starter({ pitching: healthyLines, injury, schedule: fullSchedule }));
    const read = projected(starter({ pitching: lines, injury: { ...injury, injured: false, daysLeft: 0, injuredThisSeason: false }, schedule: fullSchedule }));
    // Next season: close to the healthy reading, well above the reading that takes the lost season as evidence
    const next = (p: PlayerProduction) => p.seasons[1].sides[0].usage.central;
    expect(next(lost)).toBeGreaterThan(0.85 * next(healthy));
    expect(next(lost)).toBeGreaterThan(next(read));
    // ...while the band still reaches the reading with the lost season
    expect(lost.seasons[1].wins.low).toBeLessThanOrEqual(read.seasons[1].wins.low + EPS);
    expect(lost.seasons[1].notes.join(' ')).toMatch(/lost to injury/i);
  });

  it('days out that end before Opening Day cost nothing; after the last game they fall in the next season (the calendar\'s edges)', () => {
    const spring = projected(star({ seasonPlayed: 0, injury: { injured: true, daysLeft: 2, careerEnding: false, seasonDaysLeft: 186, seasonDays: 186, daysToOpening: 20, offseasonDays: 179 } }));
    const base0 = projected(star({ seasonPlayed: 0 }));
    expect(spring.seasons[0].wins).toEqual(base0.seasons[0].wins);
    expect(spring.seasons[0].notes.join(' ')).toMatch(/injur/i);
    const done = projected(star({ seasonPlayed: 1, injury: { injured: true, daysLeft: 300, careerEnding: false, seasonDaysLeft: 0, seasonDays: 186, daysToOpening: 0, offseasonDays: 150 } }));
    const base1 = projected(star({ seasonPlayed: 1 }));
    // 150 days of off-season, then 150 of next season's 186
    expect(done.seasons[1].wins.central).toBeLessThan(base1.seasons[1].wins.central);
    expect(done.seasons[1].notes.join(' ')).toMatch(/injur/i);
  });

  it('a stated injury is always named in the basis, even where it moved no number', () => {
    const p = projected(thin({ injury: { injured: true, daysLeft: null, careerEnding: true, seasonDaysLeft: null, seasonDays: null } }));
    for (const s of p.seasons) expect(s.notes.join(' '), `${s.season}`).toMatch(/career-ending/i);
    const unknown = projected(star({ injury: { injured: true, daysLeft: null, careerEnding: false, seasonDaysLeft: 130, seasonDays: 186, durationNote: 'injury_left 1000 is held by 54 injured players' } }));
    expect(unknown.seasons[0].notes.join(' ')).toMatch(/not established/);
    expect(unknown.seasons[0].notes.join(' ')).toContain('injury_left 1000');
    // An unestablished duration moves no central
    const base = projected(star());
    expect(unknown.seasons[0].wins.central).toBeCloseTo(base.seasons[0].wins.central, 9);
  });

  it('a listed pitcher\'s batting is not a hitter\'s line: it is never projected as a side', () => {
    const p = projected(starter({ batting: [bat(2027, 70, -0.6), bat(2028, 65, -0.5), bat(2029, 55, -0.4)], listed: { position: 1, role: 11 } }));
    expect(p.basis.sides.map((s) => s.side)).toEqual(['pitching']);
    expect(p.basis.notProjected.map((s) => s.side)).toEqual(['batting']);
    expect(p.basis.notProjected[0].reason).toMatch(/listed pitcher/i);
    // A listed two-way player (a field position with a pitching role) keeps both sides
    const twoWay = projected(starter({ batting: regular().batting, listed: { position: 10, role: 11 } }));
    expect(twoWay.basis.sides.map((s) => s.side).sort()).toEqual(['batting', 'pitching']);
  });

  it('the same-time ratings never undo the results regression: a player whose ratings imply exactly his results gets (almost) the results-only rate', () => {
    const input = regular();
    const results = projected(input);
    const observed = results.basis.sides[0].observedRate!;
    const k = PRODUCTION_PRIOR.kinds.hitter;
    const blended = projectProductionWith({ ...input, abilityPrior: { batting: { rate600: observed, variance600: (k.noise600 * 600) / k.stabilization, path600: [0, 0, 0, 0, 0, 0, 0], pathVariance600: [0, 0, 0, 0, 0, 0, 0] } } }, PRODUCTION_PRIOR, results.basis.model);
    expect(blended.basis.source).toBe('results_and_ratings');
    expect(Math.abs(blended.basis.sides[0].regressedRate - results.basis.sides[0].regressedRate)).toBeLessThan(0.05);
  });

  it('observed coverage belongs to the estimator served: a projection that leans on ratings, and the rest of a season under way, are not measured', () => {
    const observed = [1, 2, 3, 4, 5, 6, 7].map((horizon) => ({ horizon, cases: 500, outer: 0.81, inner: 0.52 }));
    const using: ProductionModelInForce = {
      model: PRODUCTION_PRIOR,
      provenance: { source: 'save_fit', label: 'test fit', stamp: { status: 'calibrated', basis: 'test', run: 'test' }, fitId: 'test', priorWeight: 0, observed },
    };
    const k = PRODUCTION_PRIOR.kinds.hitter;
    const blended = projectProductionWith({ ...regular(), abilityPrior: { batting: { rate600: 2.5, variance600: (k.noise600 * 600) / k.stabilization, path600: [0, 0, 0, 0, 0, 0, 0], pathVariance600: [0, 0, 0, 0, 0, 0, 0] } } }, using.model, using.provenance);
    expect(blended.basis.source).toBe('results_and_ratings');
    for (const s of blended.seasons) {
      expect(s.coverage.observed, `${s.season}`).toBeNull();
      expect(s.coverage.note, `${s.season}`).toMatch(/not measured/i);
    }
    expect(blended.seasons[2].coverage.note).toMatch(/results-only/i);
    // Results alone: the season under way is not measured; later seasons carry the fit's figure at their own horizon
    const results = projectProduction(regular(), using);
    expect(results.seasons[0].coverage.observed).toBeNull();
    expect(results.seasons[1].coverage.observed).not.toBeNull();
    expect(results.seasons[1].coverage.note).toMatch(/1\.7|interpolated/);
  });

  it('a proneness playing-time effect applies only at the horizons it was measured at (1 to 3)', () => {
    const prone: ProductionModelInForce = {
      model: { ...PRODUCTION_PRIOR, proneness: { cuts: [59, 86], usage: { hitter: [1, 1, 0.8], pitcher: [1, 1, 1] }, aging: { hitter: [[0, 0], [0, 0], [0, 0]], pitcher: [[0, 0], [0, 0], [0, 0]] }, ageSplit: 30, findings: [] } },
      provenance: { source: 'save_fit', label: 'test fit', stamp: { status: 'calibrated', basis: 'test', run: 'test' }, fitId: 'test', priorWeight: 0 },
    };
    const none: ProductionModelInForce = { ...prone, model: { ...PRODUCTION_PRIOR, proneness: null } };
    const a = projectProduction({ ...regular(), proneness: 120 }, prone);
    const b = projectProduction({ ...regular(), proneness: 120 }, none);
    expect(a.seasons[1].wins.central).toBeLessThan(b.seasons[1].wins.central);
    expect(a.seasons[5].wins.central).toBeCloseTo(b.seasons[5].wins.central, 9);
  });
});

describe('expected production through the reader (hardening, 2026-09-23): the export as it varies', () => {
  const BATTER = 9101;
  const PITCHER = 9102;
  const LINE = `INSERT INTO players_career_batting_stats (player_id, year, team_id, league_id, level_id, split_id, pa, war) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`;

  afterAll(() => {
    db.prepare(`DELETE FROM players_career_batting_stats WHERE player_id IN (${BATTER}, ${PITCHER})`).run();
    db.prepare(`DELETE FROM players_career_pitching_stats WHERE player_id IN (${BATTER}, ${PITCHER})`).run();
    db.prepare(`DELETE FROM team_history_record WHERE year BETWEEN 2011 AND 2019`).run();
    db.prepare(`DELETE FROM leagues WHERE league_id = 300`).run();
  });

  it('a season is measured against its neighbours\' schedules, never today\'s: a league that lengthened its schedule keeps its history, and a short season is still short', () => {
    const line = db.prepare(LINE);
    for (let y = 2011; y <= 2019; y += 1) {
      line.run(BATTER, y, IDS.mlbTeam, IDS.league, 1, 400, 2);
      for (const team of [IDS.mlbTeam, IDS.otherMlbTeam]) {
        db.prepare(`INSERT INTO team_history_record (team_id, year, g, w, l, pct, pos, gb) VALUES (?, ?, ?, 50, 50, .5, 1, 0)`).run(team, y, y === 2015 ? 40 : 100);
      }
    }
    const seasons = leagueSeasons(IDS.league, 2019, 162).filter((s) => s.season >= 2011 && s.season <= 2019);
    for (const s of seasons.filter((x) => x.season !== 2015)) expect(s.scheduleShare, `${s.season}`).toBeGreaterThan(0.9);
    expect(seasons.find((s) => s.season === 2015)!.scheduleShare).toBeLessThan(0.5);
    expect(seasons.find((s) => s.season === 2012)!.games).toBe(100);
  });

  it('one missing column fails one side only: the hitters are still read when the pitching table lacks a column', () => {
    db.prepare(LINE).run(BATTER, 2029, IDS.mlbTeam, IDS.league, 1, 600, 3);
    db.prepare(`INSERT INTO players_career_pitching_stats (player_id, year, team_id, league_id, level_id, split_id, bf, g, gs, war) VALUES (?, 2029, ?, ?, 1, 1, 700, 30, 30, 3)`).run(PITCHER, IDS.mlbTeam, IDS.league);
    db.exec(`ALTER TABLE players_career_pitching_stats RENAME COLUMN bf TO bf_hidden`);
    try {
      const lines = majorLeagueLines([BATTER, PITCHER], 2027, 2030, null);
      expect(lines.unavailable).toBeNull();
      expect(lines.sides.pitching).toMatch(/bf/);
      expect(lines.sides.batting).toBeNull();
      expect(lines.byPlayer.get(BATTER)?.batting.length).toBeGreaterThan(0);
    } finally {
      db.exec(`ALTER TABLE players_career_pitching_stats RENAME COLUMN bf_hidden TO bf`);
    }
  });

  it('an independent top-level league whose level is not 1 has its majors at its own level', () => {
    db.prepare(`INSERT INTO leagues (league_id, name, abbr, parent_league_id, league_level, season_year) VALUES (300, 'Independent', 'IND', 0, 2, 2030)`).run();
    db.prepare(LINE).run(BATTER, 2030, IDS.mlbTeam, 300, 2, 300, 1.5);
    const lines = majorLeagueLines([BATTER], 2030, 2030, null);
    expect(lines.byPlayer.get(BATTER)?.batting.find((l) => l.season === 2030)?.opportunities).toBe(300);
    const own = majorLeagueLines([BATTER], 2030, 2030, 300);
    expect(own.byPlayer.get(BATTER)?.batting[0]?.opportunities).toBe(300);
  });

  it('the schedule itself states the season\'s length where the rules row does not', () => {
    const insert = db.prepare(`INSERT INTO games (game_id, home_team, away_team, date, played, league_id) VALUES (?, ?, ?, ?, ?, ?)`);
    for (let g = 0; g < 8; g += 1) insert.run(990_000 + g, IDS.mlbTeam, IDS.otherMlbTeam, `2030-4-${g + 1}`, g < 3 ? 1 : 0, IDS.league);
    try {
      const s = scheduledGames(IDS.league, 2);
      expect(s).not.toBeNull();
      expect(s!.perClub).toBe(8);
      expect(s!.played).toBe(3);
    } finally {
      db.prepare(`DELETE FROM games WHERE game_id >= 990000 AND game_id < 990008`).run();
    }
  });

  it('a days-out figure the export holds for many injured players at one value, contradicted by their own state, is not read as days', () => {
    const had = new Set((db.prepare(`PRAGMA table_info(players)`).all() as Array<{ name: string }>).map((c) => c.name));
    const added = ['injury_is_injured', 'injury_left', 'injury_dtd_injury'].filter((c) => !had.has(c));
    for (const c of added) db.exec(`ALTER TABLE players ADD COLUMN ${c} INTEGER`);
    const insert = db.prepare(`INSERT INTO players (player_id, first_name, last_name, age, position, role, retired, injury_is_injured, injury_left, injury_dtd_injury) VALUES (?, 'In', 'Jured', 28, 6, 0, 0, 1, ?, ?)`);
    try {
      for (let i = 0; i < 12; i += 1) insert.run(95_000 + i, 1000, i < 4 ? 1 : 0);
      // A long, real injury held by one player is days
      insert.run(95_100, 400, 0);
      const sentinels = injuryDurationSentinels(10, 366);
      expect([...sentinels.keys()]).toEqual([1000]);
      expect(sentinels.get(1000)).toMatch(/12 injured players, 4 of them day-to-day/);
    } finally {
      db.prepare(`DELETE FROM players WHERE player_id >= 95000 AND player_id < 95200`).run();
      for (const c of added) db.exec(`ALTER TABLE players DROP COLUMN ${c}`);
    }
  });
});

describe('expected production (hardening, 2026-09-23): the fallback prior in another WAR environment', () => {
  it('under the prior, a thin record in a league with a different WAR scale is regressed toward that league\'s own mean', () => {
    const league = { kinds: { hitter: { mean600: 0.8, spread600: PRODUCTION_PRIOR.kinds.hitter.rateScale600 * 0.4, opportunities: 50_000, ceiling: null } } };
    const adapted = adaptPriorToLeague(PRODUCTION_PRIOR, league, { hitter: PRODUCTION_PRIOR.kinds.hitter.rateScale600 });
    const using: ProductionModelInForce = { model: adapted.model, provenance: { source: 'fallback_prior', label: adapted.note ?? '', stamp: { status: 'provisional', basis: 'test', run: null }, fitId: null, priorWeight: 1 } };
    const low = (war: number) => thin({ batting: [bat(2029, 70, war * 0.4), bat(2030, 45, 0.04)] });
    const p = projectProduction(low(0.4), using);
    const unadapted = projectProduction(low(0.4));
    expect(Math.abs(p.basis.sides[0].regressedRate - 0.8)).toBeLessThan(Math.abs(unadapted.basis.sides[0].regressedRate - 0.8));
    expect(Math.abs(p.basis.sides[0].regressedRate - 0.8)).toBeLessThan(0.6);
    expect(adapted.note).toMatch(/league's own mean/);
    // ...and its noise shrinks with its WAR scale: the band is narrower in a league whose wins are fewer
    expect(adapted.model.kinds.hitter.noise600).toBeLessThan(PRODUCTION_PRIOR.kinds.hitter.noise600);
  });
});
