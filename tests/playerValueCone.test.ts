import { describe, expect, it } from 'vitest';
import {
  playerProductionCone, productionCone, projectProduction,
  type ControlSeason, type ControlStatus, type ControlTimeline, type ProductionInput, type ProductionLine, type ProductionModelInForce,
} from '../server/playerValue.js';
import { PRODUCTION_PRIOR, PRODUCTION_PRIOR_CALIBRATION } from '../server/playerValueCalibration.js';
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
    expect(new Set(cone.seasons.map((s) => s.control.label))).toEqual(new Set(['Not established']));
    expect(cone.seasons.every((s) => s.control.after === null)).toBe(true);

    const straddling = productionCone(projectProduction(regular()), timeline([
      season(2030, 'pre_arbitration'), season(2031, 'indeterminate', { between: ['pre_arbitration', 'arbitration'] }),
    ]));
    expect(straddling.seasons[1].control.status).toBe('indeterminate');
    expect(straddling.seasons[1].control.label).toBe('Not established');
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
    expect(measured.seasons[0].coverage.outer).toEqual({ target: 0.8, observed: 0.82 });
    expect(measured.seasons[0].coverage.inner).toEqual({ target: 0.5, observed: 0.49 });
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
