import { describe, expect, it } from 'vitest';
import { DEFAULT_COVERAGE_FLOORS, detectNeeds, IL_RETURN_WINDOW_DAYS, whatIfNeed, type CoverageFloors } from '../server/mlbNeeds';
import { withUnavailable } from '../server/mlbRoster';
import { healthy26, viewOf, type Spec } from './mlbFixtures';

/** SP1 (id 100) out on an injured list; a replacement keeps the roster at 26. */
function rotationShort(daysLeft = 93, il60 = true): Spec[] {
  const roster = healthy26().filter((s) => s.id !== 100);
  return [
    ...roster,
    { id: 900, name: 'Local Depth', position: 3 }, // fills the 26th spot with a hitter
    { id: 100, name: 'Burnes', position: 1, role: 11, il60, il: !il60, daysLeft },
  ];
}

describe('need detection is derived from current state', () => {
  it('finds nothing wrong on a healthy, full roster', () => {
    expect(detectNeeds(viewOf(healthy26()))).toEqual([]);
  });

  it('names a rotation shortfall, its stated cause, and a long-term horizon from exported days', () => {
    const needs = detectNeeds(viewOf(rotationShort(93)));
    expect(needs).toHaveLength(1);
    const need = needs[0];
    expect(need).toMatchObject({ kind: 'role_below_standard', origin: 'observed', severity: 'elevated' });
    expect(need.role?.kind).toBe('starting_pitcher');
    expect(need.causes).toEqual([expect.objectContaining({ name: 'Burnes', status: 'IL-60', daysLeft: 93, assumed: false })]);
    expect(need.horizon).toMatchObject({ kind: 'long_term', days: 93 });
    expect(need.facts.some((f) => f.label === 'Coverage floor' && /not a league rule/.test(f.value))).toBe(true);
  });

  it('separates a three-day problem from a season-ending one', () => {
    expect(detectNeeds(viewOf(rotationShort(3, false)))[0].horizon.kind).toBe('temporary');
    expect(detectNeeds(viewOf(rotationShort(40)))[0].horizon.kind).toBe('extended');
    expect(detectNeeds(viewOf(rotationShort(200)))[0].horizon.kind).toBe('long_term');
  });

  it('is critical when the role is empty or two short, and never manufactures a cause', () => {
    const noCause = healthy26().filter((s) => !(s.role === 11 && s.id > 101)); // 2 SP left, nobody hurt
    const need = detectNeeds(viewOf([...noCause, ...Array.from({ length: 3 }, (_, i) => ({ id: 800 + i, position: 3 }))]))
      .find((n) => n.role?.kind === 'starting_pitcher');
    expect(need?.severity).toBe('critical');
    expect(need?.causes).toEqual([]);
    expect(need?.unknowns.join(' ')).toMatch(/cannot say how the roster came to be this way/);
    expect(need?.horizon.kind).toBe('unknown');
  });

  it('does not raise a need on unknown availability that could still meet the standard, and says so', () => {
    const specs = healthy26();
    specs[0] = { ...specs[0], unknownAvailability: true };
    const need = detectNeeds(viewOf(specs)).find((n) => n.role?.kind === 'starting_pitcher');
    // 4 known-available + 1 unknown = could still be five: a watch item that states the doubt
    expect(need?.severity).toBe('watch');
    expect(need?.unknowns.join(' ')).toMatch(/no exported availability/);
  });

  it('reports an open active spot only when no role shortfall already accounts for it', () => {
    const open = healthy26().slice(0, 25);
    const spot = detectNeeds(viewOf(open));
    expect(spot).toHaveLength(1);
    expect(spot[0]).toMatchObject({ kind: 'open_active_spot', role: null });
    // remove a starter and the role need subsumes the spot
    const short = healthy26().filter((s) => s.id !== 100);
    const both = detectNeeds(viewOf(short));
    expect(both.map((n) => n.kind)).toEqual(['role_below_standard']);
  });

  it('cannot count a spot when the league limit is not exported', () => {
    const view = viewOf(healthy26().slice(0, 25), { rules_active_roster_limit: null, rules_expanded_roster_limit: null });
    expect(view.limits.active).toBeNull();
    expect(detectNeeds(view)).toEqual([]);
  });
});

describe('return from the injured list', () => {
  const returning = (days: number, extra: Partial<Spec> = {}): Spec[] => [
    ...healthy26(),
    { id: 700, name: 'Mena', position: 1, role: 11, il: true, active: false, forty: true, daysLeft: days, ...extra },
  ];

  it('is a decision only when the roster is full and he is due back inside the window', () => {
    const need = detectNeeds(viewOf(returning(8))).find((n) => n.kind === 'il_return_crunch');
    expect(need).toMatchObject({ severity: 'watch', urgency: { days: 8 }, returning: { name: 'Mena', onFortyMan: true } });
    expect(need?.unknowns.join(' ')).toMatch(/activation rules/);
    expect(detectNeeds(viewOf(returning(IL_RETURN_WINDOW_DAYS + 1))).some((n) => n.kind === 'il_return_crunch')).toBe(false);
    // a spot is open: he simply takes it
    const withSpot = returning(8).filter((s) => s.id !== 100);
    expect(detectNeeds(viewOf(withSpot)).some((n) => n.kind === 'il_return_crunch')).toBe(false);
  });

  it('says a 60-day IL player is not on the 40-man', () => {
    const need = detectNeeds(viewOf(returning(8, { il: false, il60: true, forty: false }))).find((n) => n.kind === 'il_return_crunch');
    expect(need?.facts.find((f) => f.label === '40-man')?.value).toMatch(/Not on the 40-man/);
  });
});

describe('what-if', () => {
  it('turns an active starter being out into a stated, hypothetical rotation shortfall', () => {
    const view = viewOf(healthy26());
    const need = whatIfNeed(view, 100)!;
    expect(need).toMatchObject({ id: 'mlb:what_if:100', kind: 'role_below_standard', origin: 'hypothetical' });
    expect(need.causes[0]).toMatchObject({ playerId: 100, assumed: true });
    expect(need.unknowns[0]).toMatch(/scenario you asked about/);
    // the real view is untouched
    expect(view.counts.active).toBe(26);
    expect(view.members.find((m) => m.playerId === 100)?.onActive).toBe(true);
  });

  it('is a spot to fill, not a shortfall, when depth stays above the standard', () => {
    const need = whatIfNeed(viewOf(healthy26()), 105)!; // one of eight relievers
    expect(need.kind).toBe('open_active_spot');
    expect(need.role?.kind).toBe('relief_pitcher');
    expect(need.summary).toMatch(/25 of 26/);
  });

  it('is not defined for a player who is not on the active roster', () => {
    expect(whatIfNeed(viewOf(rotationShort()), 100)).toBeNull();
    expect(withUnavailable(viewOf(healthy26()), 99999)).toBeNull();
  });
});

describe('coverage floors are minimums, and they are data', () => {
  it('states the first-pass numbers as floors, not ideal roster targets', () => {
    expect(DEFAULT_COVERAGE_FLOORS.basis).toBe('minimum_floor');
    expect(DEFAULT_COVERAGE_FLOORS.source).toMatch(/not a league rule or an ideal roster/);
    expect(Object.fromEntries(Object.entries(DEFAULT_COVERAGE_FLOORS.floors).map(([k, v]) => [k, v!.count])))
      .toEqual({ starting_pitcher: 5, relief_pitcher: 7, catcher: 2 });
  });

  it('a club above the floors has no coverage need, however lean it is by other measures', () => {
    // exactly at the floors: 5 SP, 7 RP, 2 C
    const lean = healthy26().filter((s) => s.id !== 112); // seven relievers
    const need = detectNeeds(viewOf([...lean, { id: 901, position: 3 }]));
    expect(need).toEqual([]);
  });

  it('a six-man rotation is a different floor, not a change to the detector', () => {
    const six: CoverageFloors = { ...DEFAULT_COVERAGE_FLOORS, floors: { ...DEFAULT_COVERAGE_FLOORS.floors, starting_pitcher: { count: 6, label: 'six healthy starting pitchers' } } };
    const view = viewOf(healthy26());
    expect(detectNeeds(view)).toEqual([]);
    const needs = detectNeeds(view, 'observed', six);
    expect(needs).toHaveLength(1);
    expect(needs[0].summary).toMatch(/5 healthy starting pitchers.*minimum floor of 6/);
    expect(needs[0].facts.find((f) => f.label === 'Coverage floor')?.value).toMatch(/six healthy starting pitchers/);
    // and the what-if respects the floors it is handed
    expect(whatIfNeed(view, 100, six)?.kind).toBe('role_below_standard');
  });

  it('a what-if can state how long the player would be out, labelled as an assumption', () => {
    const view = viewOf(healthy26());
    const short = whatIfNeed(view, 100, DEFAULT_COVERAGE_FLOORS, 6)!;
    expect(short.horizon).toMatchObject({ kind: 'temporary', days: 6 });
    expect(short.horizon.basis).toMatch(/Assumed by you/);
    expect(whatIfNeed(view, 100, DEFAULT_COVERAGE_FLOORS, 120)!.horizon.kind).toBe('long_term');
    expect(whatIfNeed(view, 105, DEFAULT_COVERAGE_FLOORS, 30)!.horizon.kind).toBe('extended');
    expect(whatIfNeed(view, 100)!.horizon.kind).not.toBe('long_term');
  });
});
