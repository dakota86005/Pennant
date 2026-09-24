import { describe, expect, it } from 'vitest';
import {
  playerProductionCone, productionCone, projectProduction, ratingsEvidence,
  type ArrivalModel, type ControlSeason, type ControlStatus, type ControlTimeline, type ProductionInput, type ProductionLine, type ProductionModelInForce,
  type RatingsEvidence, type RatingsModelInForce,
} from '../server/playerValue.js';
import { PRODUCTION_PRIOR, PRODUCTION_PRIOR_CALIBRATION, RATINGS_PRIOR } from '../server/playerValueCalibration.js';
import { FIELDING_EVIDENCE_PROVENANCE, hitterProfileFromRow, syntheticScoutedAbility } from '../server/scoutedEvidence.js';
import { IDS } from './fixture';

/*
 * The player card's production cone (PLAYER_VALUE.md Part 8, BEHAVIOR_CASES.md "Player Value"): Player
 * Value joins its own two answers, expected production and the control timeline, season by season, so the
 * card draws them without recomputing either. Each case is built from synthetic evidence through the pure
 * join; none names a player or says who is worth more.
 */

const SEASON = 2030;
const bat = (season: number, pa: number, war: number): ProductionLine => ({ season, opportunities: pa, war });

const regular = (over: Partial<ProductionInput> = {}): ProductionInput => ({
  playerId: 1, season: SEASON, seasonPlayed: 0.3, age: 27,
  batting: [bat(2027, 610, 3.1), bat(2028, 640, 2.8), bat(2029, 600, 3.4), bat(2030, 190, 1.0)],
  pitching: [],
  ...over,
});

const season = (y: number, status: ControlStatus, over: Partial<ControlSeason> = {}): ControlSeason => ({
  season: y, status, arbitrationYear: null, superTwo: false, between: [], cost: null, declined: null,
  from: status === 'under_contract' ? 'contract' : 'player_rights', basis: `${status} in ${y}.`, reasons: [], crossings: [],
  ...over,
});

const timeline = (seasons: ControlSeason[], over: Partial<ControlTimeline> = {}): ControlTimeline => {
  const fa = seasons.find((s) => s.status === 'free_agent');
  return {
    playerId: 1, holder: { value: IDS.mlbTeam } as ControlTimeline['holder'], standing: 'held', thisSeason: SEASON, seasons,
    controlEnds: fa?.season ?? null, continuesPastHorizon: false, extensionSigned: false, eligibility: null, notes: [],
    ...over,
  };
};

/** Signed through 2031, arbitration in 2032 and 2033, free agent in 2034. */
const controlled = (): ControlTimeline => timeline([
  season(2030, 'under_contract'), season(2031, 'under_contract'),
  season(2032, 'arbitration', { arbitrationYear: { low: 2, high: 2 } }),
  season(2033, 'arbitration', { arbitrationYear: { low: 3, high: 3 } }),
  season(2034, 'free_agent'),
]);

const fitted: ProductionModelInForce = {
  model: PRODUCTION_PRIOR,
  provenance: {
    source: 'save_fit', label: "calibrated on this save's seasons 2006–2025 (20), held out 2023–2025",
    stamp: { status: 'calibrated', basis: 'test', run: 'test' }, fitId: '100:2025:test', priorWeight: 0.1,
    observed: [{ horizon: 1, cases: 400, outer: 0.82, inner: 0.49 }, { horizon: 2, cases: 300, outer: 0.78, inner: null }],
    window: { seasons: 20, first: 2006, last: 2025, refitAfter: 2025, calibrated: true },
  },
};

describe('the production cone joins production with control, season by season', () => {
  it('runs from this season to the last controlled season, and marks free agency after it', () => {
    const cone = productionCone(projectProduction(regular()), controlled());
    expect(cone.status).toBe('projected');
    expect(cone.seasons.map((s) => s.season)).toEqual([2030, 2031, 2032, 2033]);
    expect(cone.seasons.map((s) => s.control.label)).toEqual(['Signed', 'Signed', 'Arbitration 2', 'Arbitration 3']);
    expect(cone.seasons.map((s) => s.control.short)).toEqual(['Signed', 'Signed', 'Arb 2', 'Arb 3']);
    expect(cone.seasons.map((s) => s.control.after !== null)).toEqual([false, false, false, true]);
    expect(cone.seasons[3].control.after?.label).toBe('Free agent after');
  });

  it('is capped by the production horizon when control continues past it', () => {
    const production = projectProduction(regular());
    const seasons = Array.from({ length: 7 }, (_, i) => season(SEASON + i, 'under_contract'));
    const cone = productionCone(production, timeline(seasons, { continuesPastHorizon: true }));
    expect(cone.seasons).toHaveLength(production.seasons.length);
    expect(cone.control.note).toMatch(/continues past 2036/);
    expect(cone.seasons.every((s) => s.control.after === null)).toBe(true);
  });

  it('says control is not established where the timeline cannot state it, and never invents a status', () => {
    const unknownControl = timeline([], { standing: 'unknown', thisSeason: null, notes: ['The current season is not known.'] });
    const cone = productionCone(projectProduction(regular()), unknownControl);
    expect(cone.seasons.length).toBeGreaterThan(0);
    expect(new Set(cone.seasons.map((s) => s.control.label))).toEqual(new Set(['Control not established']));
    expect(cone.seasons.every((s) => s.control.after === null)).toBe(true);

    const straddling = productionCone(projectProduction(regular()), timeline([
      season(2030, 'pre_arbitration'), season(2031, 'indeterminate', { between: ['pre_arbitration', 'arbitration'] }),
    ]));
    expect(straddling.seasons[1].control.status).toBe('indeterminate');
    expect(straddling.seasons[1].control.label).toBe('Control not established');
    expect(straddling.seasons[1].control.detail).toMatch(/pre-arbitration and arbitration/);
  });

  it('keeps both bands and the central exactly as production states them, the 50% band inside the 80%', () => {
    const production = projectProduction(regular());
    const cone = productionCone(production, controlled());
    cone.seasons.forEach((s, i) => {
      const p = production.seasons[i];
      expect(s.central).toBe(p.wins.central);
      expect(s.outer).toEqual({ low: p.wins.low, high: p.wins.high });
      expect(s.inner).toEqual({ low: p.inner.low, high: p.inner.high });
      expect(s.inner.low).toBeGreaterThanOrEqual(s.outer.low);
      expect(s.inner.high).toBeLessThanOrEqual(s.outer.high);
    });
  });

  it('carries observed coverage beside its target, and leaves it null where the fit did not measure it', () => {
    const measured = productionCone(projectProduction(regular(), fitted), controlled());
    // The season under way is not measured (the rest of a season is never backtested)
    expect(measured.seasons[0].coverage.outer).toEqual({ target: 0.8, observed: null });
    // 2031 is 1.7 seasons out: between the fit's horizons 1 and 2, interpolated, and null where either is
    expect(measured.seasons[1].coverage.outer.observed).toBeCloseTo(0.82 + 0.7 * (0.78 - 0.82), 9);
    expect(measured.seasons[1].coverage.inner.observed).toBeNull();
    // Horizon 3 was not measured at all: null, never the target
    expect(measured.seasons[2].coverage.outer.observed).toBeNull();

    const prior = productionCone(projectProduction(regular()), controlled());
    for (const s of prior.seasons) {
      expect(s.coverage.outer.observed).toBeNull();
      expect(s.coverage.inner.observed).toBeNull();
      expect(s.coverage.note).toMatch(/not measured on this save/i);
    }
  });

  it('states calibration in one line: the save\'s window and refit, or not yet calibrated with its seasons', () => {
    const measured = productionCone(projectProduction(regular(), fitted), controlled());
    expect(measured.calibration.calibrated).toBe(true);
    expect(measured.calibration.status).toBe('Calibrated on this save: 2006–2025, refit after the 2025 season');

    const thin: ProductionModelInForce = {
      model: PRODUCTION_PRIOR,
      provenance: {
        source: 'fallback_prior', label: 'not yet calibrated on this save (3 seasons): the provisional fallback prior',
        stamp: PRODUCTION_PRIOR_CALIBRATION, fitId: null, priorWeight: 1,
        window: { seasons: 3, first: null, last: null, refitAfter: null, calibrated: false },
      },
    };
    const prior = productionCone(projectProduction(regular(), thin), controlled());
    expect(prior.calibration.calibrated).toBe(false);
    expect(prior.calibration.status).toBe('Not yet calibrated on this save (3 seasons)');
  });

  it('names the seasons and plate appearances the projection rests on', () => {
    const cone = productionCone(projectProduction(regular()), controlled());
    expect(cone.basis).toMatch(/2027–2030/);
    expect(cone.basis).toMatch(/PA/);
  });

  it('draws nothing for unknown production: no season, no zero, and the reason stated', () => {
    const production = projectProduction(regular({ batting: [] }));
    const cone = productionCone(production, controlled());
    expect(cone.status).toBe('unknown');
    expect(cone.seasons).toEqual([]);
    // Production's own reason, passed through unchanged (its wording belongs to production, not the cone)
    expect(production.status).toBe('unknown');
    expect(cone.reason).toBeTruthy();
    expect(cone.reason).toContain(production.reason!);
  });

  it('keeps a narrowing cone narrowing: a fading player\'s band follows his playing time down', () => {
    const fading = regular({ age: 38, batting: [bat(2027, 600, 1.4), bat(2028, 480, 0.8), bat(2029, 350, 0.3), bat(2030, 90, 0.0)] });
    const production = projectProduction(fading);
    const seasons = Array.from({ length: 7 }, (_, i) => season(SEASON + i, 'under_contract'));
    const cone = productionCone(production, timeline(seasons, { continuesPastHorizon: true }));
    cone.seasons.forEach((s, i) => {
      expect(s.outer.high - s.outer.low).toBeCloseTo(production.seasons[i].wins.high - production.seasons[i].wins.low, 12);
    });
  });

  it('is served through the entry point for a player the export holds', () => {
    const cone = playerProductionCone(IDS.starter);
    expect(cone).not.toBeNull();
    expect(['projected', 'unknown']).toContain(cone!.status);
    expect(cone!.calibration.status).toMatch(/alibrated on this save/);
    expect(playerProductionCone(999_999)).toBeNull();
  });
});

/* Hardening (F2, 2026-09-23): opt-outs and extensions labelled apart (A-05, D-21); free agency after either season (C-12). */
describe('the production cone, hardening (F2)', () => {
  it('labels an opt-out season and an extension season apart from the current deal, each with its own code', () => {
    const cone = productionCone(projectProduction(regular()), timeline([
      season(2030, 'under_contract'),
      season(2031, 'under_contract', { from: 'extension' }),
      season(2032, 'opt_out' as ControlStatus, { from: 'extension' }),
      season(2033, 'arbitration', { arbitrationYear: { low: 3, high: 3 } }),
      season(2034, 'free_agent'),
    ]));
    const [signed, extension, optOut] = cone.seasons.map((s) => s.control);
    expect(new Set([signed.code, extension.code, optOut.code]).size).toBe(3);
    expect(new Set([signed.short, extension.short, optOut.short]).size).toBe(3);
    expect(extension.label).toMatch(/extension/i);
    expect(optOut.label).toMatch(/opt-out/i);
  });

  it('names the season before as well when the last controlled season may itself be free agency', () => {
    const cone = productionCone(projectProduction(regular()), timeline([
      season(2030, 'under_contract'),
      season(2031, 'arbitration', { arbitrationYear: { low: 2, high: 2 } }),
      season(2032, 'indeterminate', { between: ['arbitration', 'free_agent'] }),
      season(2033, 'free_agent'),
    ]));
    expect(cone.control.note).toMatch(/2031 or 2032/);
  });

  it("carries each season's cost exactly as the timeline serves it, with its basis, and says so where it is unknown (phase 4a)", () => {
    const measured = { low: 4_200_000, high: 9_800_000 };
    const cone = productionCone(projectProduction(regular()), timeline([
      season(2030, 'under_contract', { cost: { value: { low: 5_000_000, high: 5_000_000 }, provenance: 'explicit_export', source: 'players_contract.salary0' } }),
      season(2031, 'arbitration', {
        arbitrationYear: { low: 2, high: 3 },
        cost: { value: measured, provenance: 'derived', source: 'test', note: 'Arbitration 2–3: the save\'s own ladder (measured on 60 contracts).' },
        costBasis: {
          method: 'arbitration_ladder', source: 'measured', classes: [2, 3], cases: 120, platform: { seasons: [2029, 2030], low: 2, high: 4 },
          price: { low: 6_000_000, high: 9_000_000 }, ifHeld: false, text: 'measured on 120 contracts',
        },
      }),
      season(2032, 'arbitration', {
        arbitrationYear: { low: 3, high: 4 },
        cost: { value: null, provenance: 'unknown', source: null, reason: 'not_exported_by_ootp', note: 'Its platform production is not established.' },
      }),
      season(2033, 'free_agent'),
    ]));
    const [now, next, after] = cone.seasons.map((s) => s.control);
    expect(now.cost).toEqual({ low: 5_000_000, high: 5_000_000 });
    expect(next.cost).toEqual(measured);
    expect(next.costDetail).toMatch(/measured on 60 contracts/);
    expect(after.cost).toBeNull();
    expect(after.costDetail).toMatch(/not established/);
    // Never a cost where the timeline states none, and never a zero
    expect(cone.seasons.every((s) => s.control.cost === null || s.control.cost.high > 0)).toBe(true);
  });
});

describe('the cone states what the projection rests on, and is calibrated only where every part is (hardening, 2026-09-23)', () => {
  const SCALE = { max: 80, min: 20, native2080: true, basis: 'detected_from_export_maximum' as const };
  const BAT = (v: number) => ({ contact: v, gap: v, power: v, eye: v, avoidK: v });
  const evidence = (): RatingsEvidence => {
    const ability = syntheticScoutedAbility({ playerId: 7, kind: 'hitter', current: 50, potential: 62, currentTools: BAT(50), potentialTools: BAT(62) });
    const row: Record<string, unknown> = {
      batting_ratings_overall_contact: 50, batting_ratings_overall_gap: 50, batting_ratings_overall_power: 50, batting_ratings_overall_eye: 50,
      batting_ratings_overall_strikeouts: 50, running_ratings_speed: 55, running_ratings_baserunning: 55, running_ratings_stealing: 55,
    };
    return ratingsEvidence(ability, {
      profile: hitterProfileFromRow(7, row, SCALE),
      glove: { playerId: 7, position: 6, current: 55, potential: 60, provenance: FIELDING_EVIDENCE_PROVENANCE }, position: 6, bats: 'R',
    });
  };
  const arrival = (): ArrivalModel => ({
    levels: [3],
    cells: [{
      side: 'batting', level: 3, ageFrom: 15, ageTo: 45, cases: 500,
      horizons: Array.from({ length: 7 }, (_, h) => ({ cases: 500, chance: Math.min(0.9, 0.05 * (h + 1)), mean: 300, nodes: Array.from({ length: 10 }, (_, j) => 30 + 60 * j) })),
    }],
    byPotential: null,
  });
  const savedRatings: RatingsModelInForce = {
    model: { ...RATINGS_PRIOR, arrival: arrival() },
    provenance: {
      source: 'save_fit', label: 'calibrated on this save: ratings → rate on 1147 major leaguers (same-time); development not yet calibrated (provisional prior)',
      stamp: { status: 'calibrated', basis: 'test', run: 'test' }, fitId: 'test', priorWeight: 0,
    },
  };

  it('a projection from ratings never rests on "Major-league results : 0 PA": it names the ratings, the arrival evidence and the development path', () => {
    const production = projectProduction({ playerId: 7, season: SEASON, seasonPlayed: 0.3, age: 20, batting: [], pitching: [], ratings: evidence(), level: 3 }, fitted, savedRatings);
    expect(production.status).toBe('projected');
    const cone = productionCone(production, controlled());
    expect(cone.basis).not.toMatch(/Major-league results/);
    expect(cone.basis).toMatch(/ratings/i);
    expect(cone.basis).toMatch(/level 3/i);
    expect(cone.basis).toMatch(/development/i);
  });

  it('a projection from ratings never says "Calibrated on this save" while any part it rests on is not', () => {
    const production = projectProduction({ playerId: 7, season: SEASON, seasonPlayed: 0.3, age: 20, batting: [], pitching: [], ratings: evidence(), level: 3 }, fitted, savedRatings);
    const cone = productionCone(production, controlled());
    expect(cone.calibration.calibrated).toBe(false);
    expect(cone.calibration.status).not.toMatch(/^Calibrated/);
    expect(cone.calibration.status).toMatch(/not yet calibrated|not measured|same-time/i);
  });

  it('a projection blended with ratings names the ratings\' share in its basis', () => {
    const production = projectProduction({ ...regular(), ratings: evidence(), level: 1 }, fitted, savedRatings);
    expect(production.basis.source).toBe('results_and_ratings');
    const cone = productionCone(production, controlled());
    expect(cone.basis).toMatch(/Major-league results/);
    expect(cone.basis).toMatch(/ratings/i);
    expect(cone.basis).toMatch(/%/);
  });

  it('a fit whose later horizons are still the prior says which horizons are the save\'s own', () => {
    const partly: ProductionModelInForce = {
      model: PRODUCTION_PRIOR,
      provenance: {
        ...fitted.provenance,
        window: { seasons: 9, first: 2016, last: 2025, refitAfter: 2025, calibrated: true, horizons: { calibrated: [1, 2, 3], prior: [4, 5, 6, 7] } },
      } as ProductionModelInForce['provenance'],
    };
    const cone = productionCone(projectProduction(regular(), partly), controlled());
    expect(cone.calibration.status).toMatch(/1–3/);
    expect(cone.calibration.status).toMatch(/4–7/);
  });

  describe('hardening F6: an arrival model adopted horizon by horizon', () => {
    const adoptedThrough = (through: number): RatingsModelInForce => ({
      ...savedRatings,
      model: {
        ...savedRatings.model,
        arrival: {
          ...savedRatings.model.arrival!,
          adopted: {
            through,
            notEstablished: Array.from({ length: 6 - through }, (_, i) => through + 1 + i)
              .map((h) => ({ horizon: h, reason: `${h} seasons out: the save's held-out arrival chance ran 17% low, outside the gate` })),
          },
        },
      },
    });
    const prospectOf = (ratings: RatingsModelInForce) =>
      projectProduction({ playerId: 7, season: SEASON, seasonPlayed: 0.3, age: 20, batting: [], pitching: [], ratings: evidence(), level: 3 }, fitted, ratings);

    it('shows the established seasons and marks each later season of control not established, with its control and the reason', () => {
      const production = prospectOf(adoptedThrough(1));
      expect(production.status).toBe('projected');
      const cone = productionCone(production, controlled());
      expect(cone.seasons.map((s) => s.season)).toEqual([2030, 2031]);
      expect(cone.notEstablished.map((s) => s.season)).toEqual([2032, 2033]);
      expect(cone.notEstablished.map((s) => s.control.label)).toEqual(['Arbitration 2', 'Arbitration 3']);
      expect(cone.notEstablished[1].control.after?.label).toBe('Free agent after');
      expect(cone.notEstablished[0].reason).toMatch(/2 seasons out/);
      expect(cone.notEstablished[0].reason).toMatch(/gate/);
      // Nothing drawn there: no central, no band
      for (const s of cone.notEstablished) {
        expect(s).not.toHaveProperty('central');
        expect(s).not.toHaveProperty('outer');
      }
      expect(cone.control.note).toMatch(/Free agent after 2033/);
    });

    it('says how far the arrival model is calibrated, never plain "calibrated"', () => {
      const cone = productionCone(prospectOf(adoptedThrough(1)), controlled());
      expect(cone.calibration.calibrated).toBe(false);
      expect(cone.calibration.status).toMatch(/through 1 season out/);
      expect(cone.calibration.status).toMatch(/2032–2036 not established/);
      // Served in full, nothing is said to be missing
      const full = productionCone(prospectOf(savedRatings), controlled());
      expect(full.notEstablished).toEqual([]);
      expect(full.calibration.status).not.toMatch(/not established/);
    });

    it('an established player is unaffected: his cone has no season not established', () => {
      const cone = productionCone(projectProduction(regular(), fitted, adoptedThrough(1)), controlled());
      expect(cone.seasons.map((s) => s.season)).toEqual([2030, 2031, 2032, 2033]);
      expect(cone.notEstablished).toEqual([]);
    });
  });
});
