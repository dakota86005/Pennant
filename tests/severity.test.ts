import { describe, expect, it } from 'vitest';
import {
  DESK_SEVERITIES, SEVERITY_POLICY, allClear, contractSeverity, farmSeverity, fortyManSeverity, itemsToDecide,
  medicalSeverity, mlbSeverity, rankOf, readDepartment,
} from '../server/presentation/severity.js';

/**
 * Severity normalization (BEHAVIOR_CASES.md "Pennant for Mac", `severity.test.ts`; V2 plan section 4.4): each
 * department's severity on the desk's common scale, never raised, the philosophy-free severity kept, each mapping
 * stamped as policy (D-041), and a department that could not be read never mistaken for all clear.
 */

describe('a department\'s severity reaches the common scale without being raised', () => {
  it('reads Major League Ops\' critical, elevated and watch as critical, attention and noted', () => {
    expect(mlbSeverity({ severity: 'critical' }).severity).toBe('critical');
    expect(mlbSeverity({ severity: 'elevated' }).severity).toBe('attention');
    expect(mlbSeverity({ severity: 'watch' }).severity).toBe('noted');
  });

  it('keeps the philosophy-free severity beside a flag the club\'s philosophy shaded', () => {
    const shaded = mlbSeverity({ severity: 'elevated', explanation: { neutralSeverity: 'watch' } });
    expect(shaded).toMatchObject({ severity: 'attention', neutral: 'noted', from: { department: 'majorLeague', severity: 'elevated', neutral: 'watch' } });
    // A flag nobody shaded is its own neutral reading
    expect(mlbSeverity({ severity: 'critical' }).neutral).toBe('critical');
  });

  it('passes the farm\'s scale through unchanged', () => {
    for (const level of DESK_SEVERITIES) expect(farmSeverity({ severity: level })).toMatchObject({ severity: level, neutral: level });
  });

  it('never ranks a mapped severity above the specialist\'s own, for every code each department serves', () => {
    const mlbOrder = { watch: 1, elevated: 2, critical: 3 } as const;
    for (const code of Object.keys(mlbOrder) as Array<keyof typeof mlbOrder>) {
      expect(rankOf(mlbSeverity({ severity: code }).severity)).toBeLessThanOrEqual(mlbOrder[code]);
    }
    for (const level of DESK_SEVERITIES) expect(rankOf(farmSeverity({ severity: level }).severity)).toBeLessThanOrEqual(rankOf(level));
  });

  it('refuses a code it does not know rather than guess where it sits', () => {
    expect(() => mlbSeverity({ severity: 'urgent' as never })).toThrow(/does not know/);
    expect(() => farmSeverity({ severity: 'high' as never })).toThrow(/does not know/);
  });
});

describe('a department with no severity of its own gets one by a stated policy line', () => {
  it('raises a running designation or waiver clock as critical, with its days left', () => {
    expect(fortyManSeverity({ clock: 'designated', daysLeft: 3 })).toMatchObject({ severity: 'critical', dueInDays: 3 });
    expect(fortyManSeverity({ clock: 'waivers', daysLeft: null })).toMatchObject({ severity: 'critical', dueInDays: null });
  });

  it('notes an option note, a contract date and an injury', () => {
    expect(fortyManSeverity({ clock: null, daysLeft: null }).severity).toBe('noted');
    expect(contractSeverity({ dueInDays: 40 })).toMatchObject({ severity: 'noted', dueInDays: 40 });
    expect(medicalSeverity().severity).toBe('noted');
  });

  it('stamps every mapping as policy, with its basis in words', () => {
    const all = [
      mlbSeverity({ severity: 'critical' }), farmSeverity({ severity: 'noted' }), fortyManSeverity({ clock: 'designated', daysLeft: 1 }),
      fortyManSeverity({ clock: null, daysLeft: null }), contractSeverity({ dueInDays: null }), medicalSeverity(),
    ];
    for (const n of all) {
      expect(n.stamp.status).toBe('policy');
      expect(n.stamp.basis.length).toBeGreaterThan(20);
    }
    expect(Object.values(SEVERITY_POLICY).every((s) => s.status === 'policy')).toBe(true);
  });
});

describe('a department that could not be read is unavailable, never all clear', () => {
  it('turns a failed read into unavailable with a sentence, and keeps the raw error out of it', () => {
    const logged: string[] = [];
    const reading = readDepartment(() => { throw new Error('no such table: team_record'); }, 'Major League Ops could not read the roster.', (m) => logged.push(m));
    expect(reading).toEqual({ status: 'unavailable', reason: 'Major League Ops could not read the roster.' });
    expect(logged.join(' ')).toContain('no such table');
  });

  it('counts an unavailable department\'s items as unknown, not zero, and never calls it all clear', () => {
    const unavailable = readDepartment<number>(() => { throw new Error('x'); }, 'The farm could not be read.', () => {});
    expect(itemsToDecide(unavailable)).toBeNull();
    expect(allClear(unavailable)).toBe(false);
    const empty = readDepartment<number>(() => [], 'unused', () => {});
    expect(itemsToDecide(empty)).toBe(0);
    expect(allClear(empty)).toBe(true);
    const some = readDepartment(() => [1, 2], 'unused', () => {});
    expect(itemsToDecide(some)).toBe(2);
    expect(allClear(some)).toBe(false);
  });
});
