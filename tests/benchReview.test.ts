import { describe, expect, it } from 'vitest';
import { benchRole, BENCH_CALIBRATION, reviewBench, type BenchPlayer } from '../server/benchReview';

const p = (over: Partial<BenchPlayer> = {}): BenchPlayer => ({ playerId: 1, name: 'Bench', bats: 'R', pa: 30, covers: [], batValue: 45, listed: 4, ...over });

describe('what each bench player is for', () => {
  it('a catcher is the backup catcher, an infielder the utility man, an outfielder the outfielder', () => {
    expect(benchRole({ covers: [2], listed: 2 })).toBe('backup catcher');
    expect(benchRole({ covers: [4, 5, 6], listed: 4 })).toBe('utility infielder');
    expect(benchRole({ covers: [7, 8], listed: 8 })).toBe('outfielder');
    expect(benchRole({ covers: [3], listed: 3 })).toBe('corner bat');
    expect(benchRole({ covers: [], listed: 9 })).toBe('role not established');
  });
});

describe('is the club covered when a regular sits?', () => {
  it('names a required position nobody on the bench can play, and says what that means', () => {
    const r = reviewBench([p({ playerId: 1, covers: [2], listed: 2 }), p({ playerId: 2, covers: [7, 9], listed: 9 })]);
    expect(r.gaps.map((g) => g.key)).toEqual(['middle_infield', 'center_field']);
    expect(r.findings[0]).toMatch(/second base or shortstop|shortstop/);
    expect(r.gaps[1].text).toMatch(/center field/);
  });

  it('no gap when every required position has a cover', () => {
    const r = reviewBench([p({ playerId: 1, covers: [2] }), p({ playerId: 2, covers: [4, 6] }), p({ playerId: 3, covers: [7, 8] })]);
    expect(r.gaps).toEqual([]);
    expect(r.rows.map((x) => x.role).sort()).toEqual(['backup catcher', 'outfielder', 'utility infielder']);
  });

  it('notes a bench with no bat from one side, and an empty bench', () => {
    const allRight = reviewBench([p({ playerId: 1, covers: [2], bats: 'R' }), p({ playerId: 2, covers: [4], bats: 'R' }), p({ playerId: 3, covers: [8], bats: 'R' })]);
    expect(allRight.findings.join(' ')).toMatch(/left-handed bat to send up/);
    expect(allRight.hands).toEqual({ L: 0, R: 3, S: 0 });
    expect(reviewBench([]).findings.join(' ')).toMatch(/no bench/);
    // a switch-hitter satisfies both sides
    const mixed = reviewBench([p({ playerId: 1, covers: [2, 4, 8], bats: 'S' })]);
    expect(mixed.findings.join(' ')).not.toMatch(/to send up/);
    expect(BENCH_CALIBRATION.status).toBe('provisional');
  });

  it('shows the bench most-used first', () => {
    const r = reviewBench([p({ playerId: 1, name: 'A', pa: 10 }), p({ playerId: 2, name: 'B', pa: 90 })]);
    expect(r.rows.map((x) => x.name)).toEqual(['B', 'A']);
  });
});
