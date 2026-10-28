import { describe, expect, it } from 'vitest';
import { coverageFloorsFor, DEFAULT_COVERAGE_FLOORS, detectNeeds } from '../server/mlbNeeds';
import { viewOf, type Spec } from './mlbFixtures';

/*
 * Staffing floors come from the league's own active-roster limit (B-89, deep hunt SRVMLB-08; the owner's decision of 2026-10-28: a
 * rule from the limit now, indeterminate when the limit is unknown, per-save measurement later). Fixed at 5 SP / 7 RP / 2 C, a
 * 21-man league (the 1930s save, fictional leagues) was permanently told its pitching staff was critically short.
 */

/** A full 21-man roster of the 1930s shape: 4 starters, 6 relievers, 2 catchers, 9 other hitters. */
function roster21(relievers = 6): Spec[] {
  const out: Spec[] = [];
  let id = 100;
  for (let i = 0; i < 4; i += 1) out.push({ id: id++, name: `SP${i + 1}`, position: 1, role: 11 });
  for (let i = 0; i < relievers; i += 1) out.push({ id: id++, name: `RP${i + 1}`, position: 1, role: 12 });
  for (let i = 0; i < 2; i += 1) out.push({ id: id++, name: `C${i + 1}`, position: 2 });
  while (out.length < 21) out.push({ id: id++, name: `H${out.length}`, position: 3 + (out.length % 7) });
  return out;
}

const counts = (f: ReturnType<typeof coverageFloorsFor>) => Object.fromEntries(Object.entries(f.floors).map(([k, v]) => [k, v!.count]));

describe('coverage floors scale to the league\'s active-roster limit', () => {
  it('a 26-man league keeps five starters, seven relievers and two catchers', () => {
    expect(coverageFloorsFor(26)).toEqual(DEFAULT_COVERAGE_FLOORS);
  });

  it('a 21-man league is held to four starters, six relievers and two catchers, and the basis says so', () => {
    const f = coverageFloorsFor(21);
    expect(counts(f)).toEqual({ starting_pitcher: 4, relief_pitcher: 6, catcher: 2 });
    expect(f.source).toMatch(/scaled to this league's limit of 21/);
    expect(f.floors.starting_pitcher!.label).toBe('four healthy starting pitchers');
  });

  it('a full 21-man roster of that shape raises no staffing need', () => {
    const view = viewOf(roster21(), { rules_active_roster_limit: 21 });
    expect(view.limits.active).toBe(21);
    expect(detectNeeds(view)).toEqual([]);
  });

  it('a limit the export doesn\'t give sets no floor: no shortfall against an unknown standard, said so', () => {
    const f = coverageFloorsFor(null);
    expect(f.basis).toBe('indeterminate');
    expect(f.floors).toEqual({});
    expect(f.source).toMatch(/limit isn't in the export/);
    const view = viewOf(roster21(3), { rules_active_roster_limit: null });
    expect(view.limits.active).toBeNull();
    expect(detectNeeds(view).filter((n) => n.kind === 'role_below_standard')).toEqual([]);
  });
});
