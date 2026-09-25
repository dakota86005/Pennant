import { describe, expect, it } from 'vitest';
import { coverQuality, COVER_PCT, reviewBench, type BenchPlayer, type CoverRead } from '../server/benchReview';

/*
 * GOLDEN CASES: the bench is a collection of functions, never one score. "Can stand there" is not "is a backup there".
 */

const read = (position: number, pct: number | null, grade: number | null = 45): CoverRead => ({ position, grade, pct, quality: coverQuality(pct) });
const p = (over: Partial<BenchPlayer> & { reads?: CoverRead[] }): BenchPlayer => {
  const reads = over.reads ?? [];
  const { reads: _drop, ...rest } = over;
  return { playerId: 1, name: 'Bench', bats: 'R', pa: 30, covers: reads.map((r) => r.position), coverReads: reads, batValue: 40, runningPct: 40, listed: 4, ...rest };
};

describe('GOLDEN bench: standing at a position is not covering it', () => {
  it('a middle infielder who can merely stand in center field is an emergency cover, and the bench is reported thin there', () => {
    const r = reviewBench([
      p({ playerId: 1, name: 'Catcher', reads: [read(2, 60)] }),
      p({ playerId: 2, name: 'Infielder', reads: [read(4, 55), read(6, 50), read(8, 8, 38)] }),
    ]);
    const cf = r.functions.find((f) => f.key === 'center_field')!;
    expect(cf.strength).toBe('thin');
    expect(r.gaps.map((g) => [g.key, g.kind])).toEqual([['center_field', 'emergency_only']]);
    expect(r.gaps[0].text).toMatch(/emergency/);
    expect(r.gaps[0].text).toMatch(/Infielder/);
  });

  it('the same bench with a real center-field backup has no gap', () => {
    const r = reviewBench([
      p({ playerId: 1, name: 'Catcher', reads: [read(2, 60)] }),
      p({ playerId: 2, name: 'Infielder', reads: [read(4, 55), read(6, 50), read(8, 8, 38)] }),
      p({ playerId: 3, name: 'Outfielder', reads: [read(7, 70), read(8, 40, 55), read(9, 65)] }),
    ]);
    expect(r.gaps).toEqual([]);
    expect(r.functions.find((f) => f.key === 'center_field')).toMatchObject({ strength: 'covered' });
  });

  it('an emergency catcher and a legitimate backup catcher are not the same thing', () => {
    const emergency = reviewBench([p({ playerId: 1, name: 'Utility', reads: [read(2, 4, 36), read(4, 55), read(6, 55), read(8, 50)] })]);
    const legit = reviewBench([p({ playerId: 1, name: 'BackupC', reads: [read(2, 45, 55)], listed: 2 })]);
    expect(emergency.functions.find((f) => f.key === 'catcher')!.strength).toBe('thin');
    expect(legit.functions.find((f) => f.key === 'catcher')!.strength).toBe('covered');
    expect(emergency.gaps.find((g) => g.key === 'catcher')?.kind).toBe('emergency_only');
    expect(legit.gaps.find((g) => g.key === 'catcher')).toBeUndefined();
  });

  it('a cover whose quality is not established is covered on the playable line only, and says so', () => {
    const r = reviewBench([p({ playerId: 1, name: 'A', covers: [2, 4, 8] })]); // no ranked reads
    const cf = r.functions.find((f) => f.key === 'center_field')!;
    expect(cf.strength).toBe('unknown');
    expect(cf.text).toMatch(/not established/);
    expect(r.gaps).toEqual([]);
  });

  it('the thresholds are the declared ones: a percentile at the credible line is credible, just under it an emergency', () => {
    expect(coverQuality(COVER_PCT.credible)).toBe('credible');
    expect(coverQuality(COVER_PCT.credible - 0.1)).toBe('emergency');
    expect(coverQuality(COVER_PCT.regular)).toBe('regular_quality');
    expect(coverQuality(null)).toBe('unknown');
  });
});

describe('GOLDEN bench: functions, not a score', () => {
  const bench = reviewBench([
    p({ playerId: 1, name: 'BackupC', reads: [read(2, 50)], listed: 2, batValue: 30, runningPct: 20 }),
    p({ playerId: 2, name: 'Utility', reads: [read(4, 60), read(5, 55), read(6, 40), read(7, 30)], batValue: 45, runningPct: 50 }),
    p({ playerId: 3, name: 'Fourth', reads: [read(7, 40), read(8, 30)], batValue: 35, runningPct: 60 }),
  ]);

  it('has no single bench score', () => {
    expect(Object.keys(bench)).not.toEqual(expect.arrayContaining(['score']));
    expect(JSON.stringify(bench)).not.toMatch(/"score"|"benchScore"|"grade":\s*"[A-F]"/);
  });

  it('a bench that covers every required position can still be missing functions, and says which', () => {
    expect(bench.gaps).toEqual([]);
    const byKey = Object.fromEntries(bench.functions.map((f) => [f.key, f]));
    expect(byKey.pinch_hit.strength).toBe('none'); // nobody is a bat worth sending up
    expect(byKey.runner.strength).toBe('none');
    expect(byKey.defensive.strength).toBe('none');
    expect(byKey.pinch_hit.text).toMatch(/Nobody on the bench/);
  });

  it('flexibility has a place without becoming a score: three credible positions, or it is not claimed', () => {
    const flexible = bench.rows.find((r) => r.name === 'Utility')!;
    expect(flexible.tags).toContain('flexible'); // 4, 5, 6 and 7 are all credible-or-better
    expect(bench.rows.find((r) => r.name === 'Fourth')!.tags).not.toContain('flexible');
    expect(bench.functions.find((f) => f.key === 'flexibility')!.by.map((b) => b.name)).toEqual(['Utility']);
  });

  it('a bat, a glove and a runner are each named where they exist', () => {
    const r = reviewBench([
      p({ playerId: 1, name: 'Bat', reads: [read(3, 40)], batValue: 75, runningPct: 20 }),
      p({ playerId: 2, name: 'Glove', reads: [read(6, 90), read(4, 80)], batValue: 20, runningPct: 30 }),
      p({ playerId: 3, name: 'Legs', reads: [read(8, 30)], batValue: 25, runningPct: 90 }),
    ]);
    const tags = Object.fromEntries(r.rows.map((x) => [x.name, x.tags]));
    expect(tags.Bat).toContain('pinch_hitter');
    expect(tags.Glove).toContain('defensive_replacement');
    expect(tags.Legs).toContain('pinch_runner');
  });

  it('a man who already shares a regular\'s spot is named as a platoon partner, not just bench depth', () => {
    const r = reviewBench([p({ playerId: 1, name: 'Partner', reads: [read(7, 50)], partnerAt: 7 })]);
    expect(r.rows[0].tags).toContain('platoon_partner');
  });

  it('an empty bench and a one-handed bench are stated', () => {
    expect(reviewBench([]).findings.join(' ')).toMatch(/no bench/);
    const allRight = reviewBench([p({ playerId: 1, bats: 'R', reads: [read(2, 50)] }), p({ playerId: 2, bats: 'R', reads: [read(4, 50)] })]);
    expect(allRight.findings.join(' ')).toMatch(/left-handed bat to send up/);
  });
});

describe('GOLDEN bench: a function that names two positions says which one is thin', () => {
  it('a second baseman who cannot credibly play shortstop covers "second base or shortstop" at second base, and the function says shortstop is not covered', () => {
    const r = reviewBench([
      p({ playerId: 1, name: 'Catcher', reads: [read(2, 60)] }),
      p({ playerId: 2, name: 'SecondBase', reads: [read(4, 60), read(6, 1, 40)] }),
      p({ playerId: 3, name: 'Outfielder', reads: [read(8, 40)] }),
    ]);
    const mi = r.functions.find((f) => f.key === 'middle_infield')!;
    expect(mi.strength).toBe('covered'); // the policy is either position
    expect(mi.text).toMatch(/Shortstop itself has only an emergency cover/);
    expect(r.gaps).toEqual([]);
  });

  it('with a credible cover at both, nothing is said to be thin', () => {
    const r = reviewBench([
      p({ playerId: 1, name: 'Catcher', reads: [read(2, 60)] }),
      p({ playerId: 2, name: 'Utility', reads: [read(4, 60), read(6, 45)] }),
      p({ playerId: 3, name: 'Outfielder', reads: [read(8, 40)] }),
    ]);
    expect(r.functions.find((f) => f.key === 'middle_infield')!.text).not.toMatch(/itself has/);
  });
});

describe('GOLDEN bench: what is an attention item and what is a finding', () => {
  it('a position nobody can play is a coverage need; a position covered only by an emergency cover is a finding on the bench, not a need', async () => {
    const { reviewClub, reviewNeeds } = await import('../server/mlbReview');
    const { healthy26, viewOf } = await import('./mlbFixtures');
    const view = viewOf(healthy26());
    const hitters = healthy26().filter((s) => s.position !== 1);
    const regular = new Set<number>();
    for (const pos of [2, 3, 4, 5, 6, 7, 8, 9]) { const f = hitters.find((h) => h.position === pos && !regular.has(h.id)); if (f) regular.add(f.id); }
    const usage = (id: number) => { const s = hitters.find((h) => h.id === id)!; const r = regular.has(id); return { bats: 'R' as const, gs: r ? 38 : 4, pa: r ? 160 : 20, fielding: [{ position: s.position, gs: r ? 38 : 4, ip: r ? 330 : 36 }] }; };
    const base = {
      holderEvidence: (ids: number[]) => new Map(ids.map((id) => [id, { ratingsPct: 60, ratingsEvidence: 'complete' as const, skillsPct: 60, runsPct: null, sample: 500, sampleUnit: 'PA' as const, toolsWeight: 1, reliability: 0.7, currentSample: 150, usage: [] }] as const)),
      hitterUsage: (ids: number[]) => new Map(ids.map((id) => [id, usage(id)] as const)), teamGames: () => 40,
    };
    // the bench can play catcher and middle infield well, and center field only as an emergency
    const covers = (ids: number[]) => new Map(ids.map((id) => [id, [2, 4, 6, 8]] as const));
    const reads = (ids: number[]) => new Map(ids.map((id) => [id, [read(2, 60), read(4, 60), read(6, 50), read(8, 3, 38)]] as const));
    const groups = reviewClub(view, { ...base, covers, coverReads: reads });
    const bench = groups.find((g) => g.bench)!.bench!;
    expect(bench.gaps.map((g) => [g.key, g.kind])).toEqual([['center_field', 'emergency_only']]);
    expect(reviewNeeds(view, groups).filter((n) => n.kind === 'bench_coverage')).toEqual([]);
    // and when nobody can play it at all, it is an attention item
    const none = reviewClub(view, { ...base, covers: (ids: number[]) => new Map(ids.map((id) => [id, [2, 4, 6]] as const)), coverReads: (ids: number[]) => new Map(ids.map((id) => [id, [read(2, 60), read(4, 60), read(6, 50)]] as const)) });
    expect(reviewNeeds(view, none).filter((n) => n.kind === 'bench_coverage').map((n) => n.id)).toEqual(['mlb:bench_coverage:center_field']);
  });
});
