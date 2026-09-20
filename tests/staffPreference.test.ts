import { describe, expect, it } from 'vitest';
import {
  actBar, AGE_GAP_YEARS, DEVELOPING_AGE, DIMENSIONS_NOT_USED, DIMENSIONS_USED, flagShading, planLean, preferenceFor, readContext, STAFF_PREFERENCE_CALIBRATION,
  type CandidateFacts, type OrganizationContext,
} from '../server/staffPreference';

const posture = (odds: number, deadlinePassed = false) => ({
  posture: (odds >= 0.75 ? 'buy' : odds >= 0.55 ? 'lean-buy' : odds >= 0.25 ? 'hold' : odds >= 0.1 ? 'lean-sell' : 'sell') as 'buy',
  odds, gamesLeft: 100, deadlinePassed, headline: `${Math.round(odds * 100)}% to reach the postseason.`,
});
const ctx = (dimensions: OrganizationContext['dimensions'], odds: number | null): OrganizationContext => ({ dimensions, posture: odds === null ? null : posture(odds) });
const cand = (over: Partial<CandidateFacts> = {}): CandidateFacts => ({ age: 28, certainty: 'adequate', toolsPct: 50, resultsPct: 50, ...over });

describe('reading the club: the window and the season, kept apart', () => {
  it('a win-now philosophy on a club in the race presses', () => {
    const r = readContext(ctx({ competitiveWindow: 80 }, 0.8))!;
    expect(r.window.label).toBe('contending');
    expect(r.season.read).toBe('in_it');
    expect(r.urgency).toBe('high');
    expect(r.conflict).toBeNull();
  });

  it('a club that is building and out of it has room to be patient', () => {
    const r = readContext(ctx({ competitiveWindow: 20 }, 0.05))!;
    expect(r.window.label).toBe('building');
    expect(r.season.read).toBe('out_of_it');
    expect(r.urgency).toBe('low');
  });

  it('says so when the philosophy and the season disagree, and does not resolve it', () => {
    const winNowOut = readContext(ctx({ competitiveWindow: 85 }, 0.05))!;
    expect(winNowOut.conflict).toMatch(/win-now but the club is 5%/);
    expect(winNowOut.urgency).toBe('normal');
    const buildingIn = readContext(ctx({ competitiveWindow: 15 }, 0.8))!;
    expect(buildingIn.conflict).toMatch(/building for the future but the club is 80%/);
  });

  it('with no season read the window alone leans', () => {
    expect(readContext(ctx({ competitiveWindow: 80 }, null))!.urgency).toBe('high');
    expect(readContext(ctx({ competitiveWindow: 10 }, null))!.urgency).toBe('low');
    expect(readContext(ctx({ competitiveWindow: 50 }, null))!.urgency).toBe('normal');
  });

  it('no context means no shading', () => {
    expect(readContext(null)).toBeNull();
    expect(actBar(null)).toEqual({ allowModerate: false, olderLimit: null, patient: false, reasons: [], why: { allowModerate: null, patient: null, older: null } });
    expect(preferenceFor(null, cand(), { age: 30 })).toEqual({ score: 0, reasons: [] });
    expect(planLean(null).by).toBe('default');
  });

  it('names what it uses and what it does not, so nothing leans silently', () => {
    const r = readContext(ctx({ competitiveWindow: 50 }, 0.5))!;
    expect(r.used).toEqual(DIMENSIONS_USED);
    expect(r.notUsed).toEqual(DIMENSIONS_NOT_USED);
    expect(r.notUsed).toContain('teamControl');
    expect(STAFF_PREFERENCE_CALIBRATION.status).toBe('policy');
  });
});

describe('the urgency of a flag', () => {
  const contender = readContext(ctx({ competitiveWindow: 80 }, 0.8));
  const patient = readContext(ctx({ competitiveWindow: 15 }, 0.05));

  it('a contender treats a moderate case as elevated, and says why', () => {
    const s = flagShading(contender, { strength: 'moderate', subjectAge: 31 });
    expect(s.level).toBe('elevated');
    expect(s.reasons[0].dimension).toBe('competitiveWindow');
    expect(flagShading(null, { strength: 'moderate', subjectAge: 31 }).level).toBe('watch');
  });

  it('a patient club sees a young player\'s strong case as a development question, but never loses the flag', () => {
    const young = flagShading(patient, { strength: 'strong', subjectAge: DEVELOPING_AGE });
    expect(young.level).toBe('watch');
    expect(young.reasons[0].text).toMatch(/development question/);
    // an older player is not given that latitude
    expect(flagShading(patient, { strength: 'strong', subjectAge: 33 }).level).toBe('elevated');
  });

  it('high-leverage use raises a moderate concern; low-leverage use is noted on a strong one', () => {
    expect(flagShading(null, { strength: 'moderate', subjectAge: 30, stakes: 'high' }).level).toBe('elevated');
    const low = flagShading(null, { strength: 'strong', subjectAge: 30, stakes: 'low' });
    expect(low.level).toBe('elevated');
    expect(low.reasons.some((r) => r.effect === 'notes')).toBe(true);
  });
});

describe('the bar for "act"', () => {
  it('urgent: a clear upgrade over a moderate concern is enough', () => {
    const bar = actBar(ctx({ competitiveWindow: 80 }, 0.8));
    expect(bar.allowModerate).toBe(true);
    expect(bar.patient).toBe(false);
  });

  it('patient: only a strong case is pursued', () => {
    const bar = actBar(ctx({ competitiveWindow: 20 }, 0.05));
    expect(bar.patient).toBe(true);
    expect(bar.allowModerate).toBe(false);
  });

  it('a club that is building, or discounts age, holds back an older replacement', () => {
    expect(actBar(ctx({ competitiveWindow: 20 }, 0.5)).olderLimit).toBe(AGE_GAP_YEARS);
    expect(actBar(ctx({ competitiveWindow: 50, ageCurveSensitivity: 85 }, 0.5)).olderLimit).toBe(AGE_GAP_YEARS);
    expect(actBar(ctx({ competitiveWindow: 50, ageCurveSensitivity: 50 }, 0.5)).olderLimit).toBeNull();
  });
});

describe('choosing among equivalent replacements', () => {
  it('a club that discounts aging favors the younger, with the reason stated', () => {
    const p = preferenceFor(ctx({ ageCurveSensitivity: 85 }, 0.5), cand({ age: 25 }), { age: 34 });
    expect(p.score).toBe(1);
    expect(p.reasons[0]).toMatchObject({ dimension: 'ageCurveSensitivity', effect: 'favors' });
    const old = preferenceFor(ctx({ ageCurveSensitivity: 85 }, 0.5), cand({ age: 37 }), { age: 30 });
    expect(old.score).toBe(-1);
  });

  it('a contender that trusts veterans holds no age against him', () => {
    const p = preferenceFor(ctx({ competitiveWindow: 85, ageCurveSensitivity: 15 }, 0.8), cand({ age: 37 }), { age: 30 });
    expect(p.score).toBe(0);
    expect(p.reasons[0].effect).toBe('notes');
  });

  it('risk, upside and glove-versus-bat each lean only when they clearly apply', () => {
    expect(preferenceFor(ctx({ riskTolerance: 15 }, 0.5), cand({ certainty: 'limited' }), { age: 28 }).score).toBe(-1);
    expect(preferenceFor(ctx({ riskTolerance: 15 }, 0.5), cand({ certainty: 'adequate' }), { age: 28 }).score).toBe(1);
    expect(preferenceFor(ctx({ upsidePreference: 85 }, 0.5), cand({ toolsPct: 75, resultsPct: 40 }), { age: 28 }).score).toBe(1);
    expect(preferenceFor(ctx({ upsidePreference: 15 }, 0.5), cand({ toolsPct: 75, resultsPct: 40 }), { age: 28 }).score).toBe(-1);
    expect(preferenceFor(ctx({ defenseEmphasis: 85 }, 0.5), cand({ batValue: 40, glovePct: 80 }), { age: 28, batValue: 45, glovePct: 50 }).score).toBe(1);
    expect(preferenceFor(ctx({ defenseEmphasis: 15 }, 0.5), cand({ batValue: 70, glovePct: 40 }), { age: 28, batValue: 45, glovePct: 50 }).score).toBe(1);
    // neutral philosophy: nothing leans
    expect(preferenceFor(ctx({ riskTolerance: 50, upsidePreference: 50, defenseEmphasis: 50, ageCurveSensitivity: 50, competitiveWindow: 50 }, 0.5), cand({ age: 22, certainty: 'thin', toolsPct: 90, resultsPct: 30 }), { age: 35 }).score).toBe(0);
  });
});

describe('how plans are shown', () => {
  it('a contender sees the plan with the biggest gain first; a builder or a depth club sees the one that keeps everyone', () => {
    expect(planLean(ctx({ competitiveWindow: 85 }, 0.8)).by).toBe('gain');
    expect(planLean(ctx({ competitiveWindow: 15 }, 0.5)).by).toBe('keeps_everyone');
    expect(planLean(ctx({ competitiveWindow: 50, rosterDepth: 80 }, 0.5)).by).toBe('keeps_everyone');
    expect(planLean(ctx({ competitiveWindow: 50 }, 0.5)).by).toBe('default');
  });
});
