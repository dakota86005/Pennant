import { describe, expect, it } from 'vitest';
import {
  evaluateRoleStanding, MEANINGFUL_GAP, resultsContext, STANDING_CALIBRATION, type ResultsMeasure, type StandingPlayer,
} from '../server/roleStanding';

/*
 * Where a player stands against the current holders of a role, on Player
 * Development's visible-ratings lens only. Unknown stays unknown; results are
 * context and never change the verdict.
 */

const p = (id: number, composite: number | null, evidenceStatus: StandingPlayer['evidenceStatus'] = 'complete'): StandingPlayer => ({ playerId: id, name: `P${id}`, composite, evidenceStatus });
const group = [p(1, 60), p(2, 55), p(3, 50), p(4, 45), p(5, 40)];

describe('the standing verdict', () => {
  it('strengthens when he is clearly ahead of the weakest, and names who he would displace', () => {
    const s = evaluateRoleStanding(p(9, 52), group);
    expect(s.verdict).toBe('strengthens');
    expect(s.displaces).toMatchObject({ playerId: 5, composite: 40 });
    expect(s.gapToWeakest).toBe(12);
    expect(s.rank).toBe(3);
    expect(s.aheadOf).toEqual(['P5']);
  });

  it('is comparable inside the gap, in either direction, and displaces no one', () => {
    for (const c of [40 + MEANINGFUL_GAP - 1, 40, 40 - MEANINGFUL_GAP + 1]) {
      const s = evaluateRoleStanding(p(9, c), group);
      expect(s.verdict).toBe('comparable');
      expect(s.displaces).toBeNull();
    }
  });

  it('is behind when clearly below the weakest', () => {
    const s = evaluateRoleStanding(p(9, 40 - MEANINGFUL_GAP), group);
    expect(s.verdict).toBe('behind');
    expect(s.rank).toBe(6);
  });

  it('exactly the gap counts as clearly ahead', () => {
    expect(evaluateRoleStanding(p(9, 40 + MEANINGFUL_GAP), group).verdict).toBe('strengthens');
  });
});

describe('unknown stays unknown', () => {
  it('a subject with no visible rating cannot be placed', () => {
    const s = evaluateRoleStanding(p(9, null), group);
    expect(s.verdict).toBe('cannot_judge');
    expect(s.displaces).toBeNull();
  });

  it('with no assessed incumbent there is nothing to compare with', () => {
    expect(evaluateRoleStanding(p(9, 70), [p(1, null)]).verdict).toBe('cannot_judge');
    expect(evaluateRoleStanding(p(9, 70), []).verdict).toBe('cannot_judge');
  });

  it('an unassessed incumbent is named, never ranked and never assumed weak', () => {
    const s = evaluateRoleStanding(p(9, 52), [...group, p(6, null)]);
    expect(s.unassessed).toEqual(['P6']);
    expect(s.assessed).toBe(5);
    expect(s.weakest?.composite).toBe(40);
    expect(s.caveats.join(' ')).toMatch(/P6 has no visible rating.*weakest current player may be him/);
  });

  it('incomplete evidence on the subject is stated', () => {
    expect(evaluateRoleStanding(p(9, 52, 'partial'), group).caveats.join(' ')).toMatch(/incomplete/);
  });

  it('never compares him with himself', () => {
    const s = evaluateRoleStanding(p(3, 50), group);
    expect(s.assessed).toBe(4);
  });

  it('carries the provisional calibration stamp', () => {
    expect(evaluateRoleStanding(p(9, 52), group).calibration).toBe(STANDING_CALIBRATION);
    expect(STANDING_CALIBRATION.status).toBe('provisional');
  });
});

describe('season results are context, never the verdict', () => {
  const era = (value: number, sample: number): ResultsMeasure => ({ name: 'ERA', value, sample, unit: 'IP', lowerIsBetter: true });
  const inc = (values: Array<[string, number, number]>) => values.map(([name, v, ip]) => ({ name, measure: era(v, ip) }));

  it('says when his own line is too thin to weigh', () => {
    const notes = resultsContext(era(1.35, 6.7), null, []);
    expect(notes[0]).toMatch(/6.7 IP: too few to weigh/);
  });

  it('agrees when the displaced player has the worst results of an adequate group', () => {
    const group3 = inc([['A', 2.8, 40], ['B', 3.5, 40], ['C', 4.4, 40], ['D', 5.6, 40]]);
    const notes = resultsContext(era(3, 60), { name: 'D', measure: era(5.6, 40) }, group3);
    expect(notes.join(' ')).toMatch(/Results agree with the ratings: D's ERA 5.60/);
  });

  it('disagrees when the displaced player is producing', () => {
    const notes = resultsContext(era(3, 60), { name: 'A', measure: era(2.1, 40) }, inc([['A', 2.1, 40], ['B', 3.5, 40], ['C', 4.4, 40], ['D', 5.6, 40]]));
    expect(notes.join(' ')).toMatch(/Results disagree with the ratings/);
  });

  it('says nothing about results when too few current players have a sample', () => {
    expect(resultsContext(era(3, 60), { name: 'D', measure: era(5.6, 40) }, inc([['D', 5.6, 40], ['E', 3, 5]]))).toEqual([]);
  });
});
