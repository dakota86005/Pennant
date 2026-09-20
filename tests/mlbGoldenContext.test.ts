import { describe, expect, it } from 'vitest';
import { candidate, candidatesOf, CLUBS, replacePacket } from './mlbGolden';

/*
 * GOLDEN CASES: philosophy and competitive context. It shades preference and urgency among options that are already valid, and it
 * shows every lean. It creates no evidence, changes no right, changes no development finding, hides no uncertainty, and the stance a
 * club with no philosophy would hear stays recoverable.
 */

const NAMES = Object.keys(CLUBS);
const packets = Object.fromEntries(NAMES.map((n) => [n, replacePacket({ organization: CLUBS[n], room: true })]));

/** Everything about a candidate that is a fact or a specialist's finding: never a function of the organization. */
const facts = (p: ReturnType<typeof replacePacket>) => candidatesOf(p)
  .map((c) => ({ id: c.playerId, group: c.group, availability: c.availability, development: c.development, path: c.path, roleFit: c.roleFit, comparison: c.comparison, requires: c.requiresClearing, consequences: c.consequences, performance: c.performance }))
  .sort((a, b) => a.id - b.id);

describe('GOLDEN context: philosophy cannot make an invalid player valid, or a valid one invalid', () => {
  it('every candidate\'s group, availability, development finding, rights path, comparison and consequences are identical for every organization', () => {
    const neutral = facts(packets.none);
    expect(neutral.length).toBeGreaterThan(3);
    for (const name of NAMES) expect(facts(packets[name]), name).toEqual(neutral);
  });

  it('no organization adds or removes a candidate', () => {
    const ids = (n: string) => candidatesOf(packets[n]).map((c) => c.playerId).sort();
    for (const name of NAMES) expect(ids(name)).toEqual(ids('none'));
  });

  it('an option Player Rights or Player Development blocks stays blocked, whatever the club wants', () => {
    // the young prospect is the one a rebuilding club would love; make him developmentally indefensible and see that nothing moves him
    const blocked = (org: string) => replacePacket({ organization: CLUBS[org], room: true, ports: { development: { 500: {}, 501: { judgment: 'indefensible', eligible: false, blockers: ['not ready'] }, 502: {} } } });
    for (const name of NAMES) {
      const c = candidate(blocked(name), 501);
      expect(c.group, name).toBe('blocked_by_development');
      expect(blocked(name).plans?.some((p) => p.steps.some((s) => /Reno Prospect/.test(s.text))) ?? false, name).toBe(false);
    }
  });
});

describe('GOLDEN context: urgency cannot turn uncertain evidence into certainty', () => {
  const uncertain = (org: string) => replacePacket({ organization: CLUBS[org], room: true, ports: { evidence: { currentState: 'current', chronology: 'unavailable' } } });

  it('with the rights evidence missing, no club is ever told to act, however hard the window and the season press', () => {
    for (const name of NAMES) {
      const p = uncertain(name);
      expect(p.report?.recommendation?.stance, name).not.toBe('act');
      expect(p.plans?.every((x) => x.certainty === 'indeterminate'), name).toBe(true);
    }
  });

  it('a contender does not see an indeterminate candidate as an open one', () => {
    expect(candidate(uncertain('contending'), 500).group).not.toBe('open');
    expect(candidate(uncertain('contending'), 500).path.status).toBe('indeterminate');
  });
});

describe('GOLDEN context: shading changes order and urgency, never the assessment', () => {
  it('the working estimate, the finding and its strength are identical for every organization', () => {
    for (const name of NAMES) {
      const need = packets[name].need;
      const neutral = packets.none.need;
      expect(need.review?.estimate, name).toEqual(neutral.review?.estimate);
      expect(need.review?.kind, name).toBe(neutral.review?.kind);
      expect(need.review?.strength, name).toBe(neutral.review?.strength);
      expect(need.review?.reasons, name).toEqual(neutral.review?.reasons);
    }
  });

  it('the neutral recommendation stays recoverable: what a club with no philosophy would hear is stated and is what it would actually be told', () => {
    const neutral = packets.none.report!.recommendation!;
    for (const name of NAMES) {
      const r = packets[name].report!.recommendation!;
      // the recommendation states the neutral stance whenever the club's context changed it, and is silent when it did not: either way it is recoverable
      expect(r.neutralStance ?? r.stance, name).toBe(neutral.stance);
      if (r.neutralStance) expect(r.neutralStance, name).not.toBe(r.stance);
    }
  });

  it('every lean names its dimension, its value and its effect', () => {
    for (const name of NAMES) {
      const leans = [
        ...(packets[name].need.shading ?? []),
        ...(packets[name].report?.recommendation?.shading ?? []),
        ...candidatesOf(packets[name]).flatMap((c) => c.preference?.reasons ?? []),
      ];
      for (const l of leans) {
        expect(l.dimension.length).toBeGreaterThan(0);
        expect(l.text.length).toBeGreaterThan(10);
        expect(['raises', 'lowers', 'favors', 'against', 'notes']).toContain(l.effect);
      }
    }
  });

  it('a club with no philosophy is not leaned on at all', () => {
    expect(packets.none.need.shading ?? []).toEqual([]);
    expect(candidatesOf(packets.none).every((c) => (c.preference?.reasons ?? []).length === 0)).toBe(true);
    expect(packets.none.report?.recommendation?.shading ?? []).toEqual([]);
  });
});

describe('GOLDEN context: preference only orders options that are equally good', () => {
  it('the option a plan leads with is never one a clearly better ready option was passed over for, whatever the club prefers', () => {
    // 500 (veteran) and 501 (prospect) are equally good on paper; 502 (tools ahead of results) is a clearly smaller gain. A club that loves upside or youth
    // may choose between the first two, and must never lead with the third.
    let checked = 0;
    for (const name of NAMES) {
      const p = packets[name];
      const ready = candidatesOf(p).filter((c) => c.group === 'open' && [500, 501, 502].includes(c.playerId));
      const best = Math.max(...ready.map((c) => c.comparison?.delta ?? -Infinity));
      const first = p.plans?.[0];
      if (!first) continue;
      const lead = ready.find((c) => first.steps.some((s) => s.text.includes(c.name)));
      if (!lead) continue;
      expect(lead.comparison!.delta as number, `${name} led with ${lead.name}`).toBeGreaterThanOrEqual(best - 6);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(2); // the case is exercised, not skipped
  });
});
