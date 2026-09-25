import { describe, expect, it } from 'vitest';
import { expectedAnnualChange, reviewGroup, type LensEvidence, type ReviewSubject } from '../server/roleReview';
import { standardsFrom, STARTING_STANDARDS, type ServedStandards } from '../server/roleStandards';

/** A first baseman whose working estimate is under the floor, with tools and results both lowish. */
const subject = (over: Partial<LensEvidence> = {}): ReviewSubject => ({
  playerId: 1, name: 'First Base', age: 29, position: 3, ratingsPct: 40, ratingsEvidence: 'complete', skillsPct: 50, runsPct: null,
  sample: 1200, sampleUnit: 'PA', toolsWeight: 1, reliability: 0.7, currentSample: 150, ...over,
});
const review = (s: ReviewSubject, set = standardsFrom(), aging: import('../server/roleReview').AgingTable | null = null) =>
  reviewGroup([s], { pitcher: false, role: 'lineup regular', standard: (h) => set.hitter(h.position), calibration: { aging } })[0];

describe('the roster review consumes the yardsticks in force', () => {
  it('with no measurement, each lens is read against the built-in line', () => {
    const r = review(subject());
    // first base: built-in bat 86, gap -20: both lenses under 66
    expect(r.standard!.lensFloors).toEqual({ tools: 66, results: 66 });
    expect(r.kind).toBe('ratings_and_results_weak');
  });

  it('each lens has its own line once measured: results that are ordinary for regular first basemen no longer count as weak', () => {
    const served: ServedStandards = {
      ...STARTING_STANDARDS, source: 'save',
      lenses: { tools: null, results: { typical: { pos3: 84 }, gap: { hitter: -36 } } },
    };
    const r = review(subject(), standardsFrom(served));
    expect(r.standard!.lensFloors.results).toBe(48);
    expect(r.standard!.lensFloors.tools).toBe(66);
    expect(r.kind).toBe('tools_weak_results_fine');
    expect(r.strength).toBe('watch');
  });

  it('a measured standard moves the floor the finding is judged against, and says the league\'s own number', () => {
    const served: ServedStandards = { ...STARTING_STANDARDS, source: 'save', roles: { ...STARTING_STANDARDS.roles, pos3: { typical: 60, bat: 70 } } };
    const r = review(subject(), standardsFrom(served));
    expect(r.standard!.typical).toBe(60);
    expect(r.standard!.source).toBe('save');
    expect(r.reasons.join(' ')).toMatch(/For regular first basemen in this league the typical working estimate is about 60/);
  });

  it('the fitted aging curve sets the stated decline, and a league with no decline says so', () => {
    const old = subject({ });
    const table = { firstAge: 20, hitter: new Array(23).fill(-0.012), pitcher: new Array(23).fill(0.3) };
    const withFit = review({ ...old, age: 35 }, standardsFrom(), table);
    expect(withFit.explanations.join(' ')).toMatch(/lost about 12 points of wOBA a year/);
    const flat = { firstAge: 20, hitter: new Array(23).fill(0), pitcher: new Array(23).fill(0) };
    const noDecline = review({ ...old, age: 35 }, standardsFrom(), flat);
    expect(noDecline.explanations.join(' ')).toMatch(/no measurable decline/);
    expect(noDecline.explanations.join(' ')).not.toMatch(/lost about 0/);
    expect(expectedAnnualChange(35, false)).toBe(-0.0095);
  });
});

describe('the starting values are never presented as this league\'s own', () => {
  const old = subject({ age: 36 });
  it('with the starting standards and curve, no text says "this league"', () => {
    const r = review(old);
    const text = [...r.reasons, ...r.explanations].join(' ');
    expect(text).not.toMatch(/this league|the league's typical/i);
    expect(text).toMatch(/Pennant's starting yardstick/);
    expect(text).toMatch(/hitters his age usually lose about 10 points of wOBA a year/);
  });

  it('"this league\'s" appears only where the save\'s own fit is in force', () => {
    const served: ServedStandards = { ...STARTING_STANDARDS, source: 'save' };
    const table = { firstAge: 20, hitter: new Array(23).fill(-0.009), pitcher: new Array(23).fill(0.2) };
    const own = review(old, standardsFrom(served), table);
    expect(own.reasons.join(' ')).toMatch(/For regular first basemen in this league the typical working estimate/);
    expect(own.explanations.join(' ')).toMatch(/in this league's history hitters his age have lost about 9 points/);
    // the save's standards with the starting curve: the curve is not called the league's
    const mixed = review(old, standardsFrom(served), null);
    expect(mixed.explanations.join(' ')).not.toMatch(/this league/);
  });
});
