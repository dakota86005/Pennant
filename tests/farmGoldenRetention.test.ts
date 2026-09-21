import { describe, expect, it } from 'vitest';
import { reviewRetention, type RetentionInput } from '../server/farmRetention.js';
import { evaluateCurrentAssignment } from '../server/currentAssignment.js';
import { currentInput, tierOf } from './farmGolden.js';

/**
 * Retention: three questions, three owners, never one score.
 *
 * The farm v1 model added a philosophy adjustment to a development score and compared the sum with a
 * release threshold, so the same player was expendable at one club and retained at another inside a
 * quantity labelled "development". These cases pin the boundary.
 */

const input = (overrides: Partial<RetentionInput> = {}): RetentionInput => ({
  playerId: 1,
  name: 'A Minor Leaguer',
  age: 27,
  teamId: 10,
  team: 'A Club',
  level: 3,
  levelName: 'AA',
  protection: tierOf('organizational_depth'),
  current: evaluateCurrentAssignment(currentInput({ leaguePercentile: 50, ageRelativeToLevel: -4, tier: 'organizational_depth' })),
  assignmentConclusion: 'organizational_question',
  proServiceYears: 6,
  state: { onFortyMan: false, majorLeagueContract: false, mustBeActive: false, onInjuredList: false },
  waiting: [{ playerId: 2, name: 'A Prospect', age: 21, what: 'developmental work at 1B' }],
  clubCrowded: true,
  philosophy: { prospectPreservation: 50, rosterDepth: 50 },
  facts: [],
  ...overrides,
});

describe('the developmental outlook', () => {
  it('is Player Development\'s alone: philosophy cannot reach it', () => {
    const patient = reviewRetention(input({ philosophy: { prospectPreservation: 100, rosterDepth: 100 } }));
    const willing = reviewRetention(input({ philosophy: { prospectPreservation: 0, rosterDepth: 0 } }));
    expect(patient.outlook).toEqual(willing.outlook);
    expect(patient.pressure).toEqual(willing.pressure);
  });

  it('keeps a protected prospect out of the question entirely, and names Player Development as the owner', () => {
    const r = reviewRetention(input({ protection: tierOf('protected_prospect') }));
    expect(r.conclusion).toBe('retain');
    expect(r.outlook.state).toBe('developing');
    expect(r.guardrails.map((g) => g.code)).toContain('protected_prospect');
  });

  it('keeps a young player with an open runway as a retain whatever the roster wants', () => {
    const r = reviewRetention(input({ age: 20, proServiceYears: 1, clubCrowded: true }));
    expect(r.outlook.runway).toBe('open');
    expect(r.conclusion).toBe('retain');
  });

  it('is indeterminate, not negative, when the protection tier cannot be established', () => {
    const r = reviewRetention(input({ protection: tierOf(null) }));
    expect(r.outlook.state).toBe('indeterminate');
    expect(r.conclusion).toBe('indeterminate');
    expect(r.missing.length).toBeGreaterThan(0);
  });
});

describe('operational pressure', () => {
  it('is what makes a closed runway a question rather than a fact', () => {
    const noPressure = reviewRetention(input({ waiting: [], clubCrowded: false }));
    expect(noPressure.conclusion).toBe('retain');
    expect(noPressure.reasons.join(' ')).toMatch(/Nothing is waiting on his roster spot/);
    expect(reviewRetention(input()).conclusion).toBe('review');
  });

  it('names who is waiting, so the question is about two players rather than one', () => {
    const r = reviewRetention(input());
    expect(r.pressure.waiting.map((w) => w.name)).toEqual(['A Prospect']);
    expect(r.reasons.join(' ')).toMatch(/A Prospect \(21\) is waiting/);
  });
});

describe('the organizational stance', () => {
  it('is a lean that is always shown, and always says what a club with no philosophy would hear', () => {
    const patient = reviewRetention(input({ philosophy: { prospectPreservation: 90, rosterDepth: 50 } }));
    expect(patient.stance.lean).toBe('patient');
    expect(patient.stance.reasons[0].dimension).toBe('prospectPreservation');
    expect(patient.stance.neutralWouldSay).toBe('review');
  });

  it('can never turn a retain into a question', () => {
    for (const prospectPreservation of [0, 25, 50, 75, 100]) {
      const r = reviewRetention(input({ waiting: [], clubCrowded: false, philosophy: { prospectPreservation, rosterDepth: 20 } }));
      expect(r.conclusion).toBe('retain');
    }
  });

  it('changes no fact about the player at any setting', () => {
    const facts = [0, 50, 100].map((prospectPreservation) => {
      const r = reviewRetention(input({ philosophy: { prospectPreservation, rosterDepth: 50 } }));
      return { outlook: r.outlook, pressure: r.pressure, guardrails: r.guardrails, conclusion: r.conclusion };
    });
    expect(facts[1]).toEqual(facts[0]);
    expect(facts[2]).toEqual(facts[0]);
  });
});

describe('what is not the farm system\'s decision', () => {
  it('hands a 40-man player to Player Rights and MLB Operations', () => {
    const r = reviewRetention(input({ state: { onFortyMan: true, majorLeagueContract: false, mustBeActive: false, onInjuredList: false } }));
    expect(r.conclusion).toBe('not_a_farm_decision');
    expect(r.guardrails[0].owner).toMatch(/Player Rights/);
    expect(r.reasons[0]).toMatch(/not the farm system's decision/);
  });

  it('hands a major-league contract to MLB Operations', () => {
    const r = reviewRetention(input({ state: { onFortyMan: false, majorLeagueContract: true, mustBeActive: false, onInjuredList: false } }));
    expect(r.conclusion).toBe('not_a_farm_decision');
    expect(r.guardrails.map((g) => g.code)).toContain('major_league_contract');
  });

  it('does not decide anything about a player on an injured list', () => {
    const r = reviewRetention(input({ state: { onFortyMan: false, majorLeagueContract: false, mustBeActive: false, onInjuredList: true } }));
    expect(r.conclusion).toBe('not_a_farm_decision');
  });

  it('still reports the farm own reading beside the guardrail rather than suppressing it', () => {
    const r = reviewRetention(input({ state: { onFortyMan: true, majorLeagueContract: false, mustBeActive: false, onInjuredList: false } }));
    expect(r.outlook.state).toBe('exhausted');
    expect(r.pressure.state).not.toBe('none');
  });

  it('never presents a review as a release, and always leaves the decision with the GM', () => {
    const r = reviewRetention(input());
    expect(r.conclusion).toBe('review');
    expect(r.gmDecision[0]).toMatch(/Pennant raises questions and executes nothing/);
  });
});

describe('a player with nothing to read yet', () => {
  const noLine = () =>
    evaluateCurrentAssignment(currentInput({ leaguePercentile: null, reliability: 0, unassessable: 'No statistics at this level this season.', tier: 'normal' }));

  it('is a development case on his open runway alone: an ordinary runway is a fact about his age, not about this season\'s line', () => {
    const r = reviewRetention(input({ age: 19, level: 6, levelName: 'R', protection: tierOf('normal'), current: noLine(), assignmentConclusion: 'not_assessable', proServiceYears: 1, waiting: [], clubCrowded: false }));
    expect(r.outlook.state).toBe('developing');
    expect(r.outlook.runway).toBe('open');
    expect(r.conclusion).toBe('retain');
    expect(r.outlook.reasons.join(' ')).toMatch(/none is needed for that/);
  });

  it('is indeterminate, not negative, when his runway is closing or closed and there is no line to say what the level has left for him', () => {
    const r = reviewRetention(input({ age: 26, level: 4, levelName: 'A', protection: tierOf('normal'), current: noLine(), assignmentConclusion: 'not_assessable', proServiceYears: 3, waiting: [], clubCrowded: false }));
    expect(r.outlook.state).toBe('indeterminate');
    expect(r.outlook.runway).toBe('closed');
    expect(r.conclusion).toBe('indeterminate');
    expect(r.outlook.reasons.join(' ')).toMatch(/cannot be said/);
  });

  it('gives the same answer at every philosophy either way', () => {
    for (const age of [19, 26]) {
      const at = (prospectPreservation: number) =>
        reviewRetention(input({ age, level: 4, levelName: 'A', protection: tierOf('normal'), current: noLine(), assignmentConclusion: 'not_assessable', proServiceYears: 2, waiting: [], clubCrowded: false, philosophy: { prospectPreservation, rosterDepth: 50 } }));
      expect(at(0).outlook).toEqual(at(100).outlook);
      expect(at(0).conclusion).toBe(at(100).conclusion);
    }
  });
});
