import { describe, expect, it } from 'vitest';
import { compareHeldOut, decide, DETECTOR_POLICY, swapped, type HeldOutCase } from '../server/calibrationDetector';

/*
 * The detector (D-053 amendment, owner 2026-09-25): the save's own values replace the fallback only when CLEARLY better on held-out
 * seasons: significant (clustered by player), consistent across seasons, and worth it; unshrunk and as served; with hysteresis.
 */

/** A deterministic generator, so each case is repeatable. */
function gen(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Paired cases: `origins` seasons, `players` per season, the candidate's loss `gain` lower on average (a share of the rival's), with
 * per-case noise. `perOrigin` overrides the gain season by season.
 */
function cases(opts: { origins?: number; players?: number; gain?: number; noise?: number; perOrigin?: number[]; seed?: number; reuse?: boolean }): HeldOutCase[] {
  const r = gen(opts.seed ?? 1);
  const out: HeldOutCase[] = [];
  const origins = opts.origins ?? 8;
  const players = opts.players ?? 300;
  for (let o = 0; o < origins; o += 1) {
    const g = opts.perOrigin?.[o] ?? opts.gain ?? 0;
    for (let i = 0; i < players; i += 1) {
      const rival = 1 + (r() - 0.5) * 0.4;
      const noise = (r() - 0.5) * (opts.noise ?? 0.1);
      out.push({ cluster: opts.reuse ? i : o * 10000 + i, origin: 2016 + o, weight: 400 + Math.floor(r() * 300), rival, candidate: rival * (1 - g) + noise });
    }
  }
  return out;
}

describe('clearly better: every part of the rule is required', () => {
  it('a consistent, significant, worthwhile gain is clearly better', () => {
    const c = compareHeldOut(cases({ gain: 0.03 }));
    expect(c.clearlyBetter).toBe(true);
    expect(c.failures).toEqual([]);
    expect(c.originsWon).toBe(8);
    expect(c.relativeGain as number).toBeGreaterThan(0.02);
    expect(c.z as number).toBeLessThan(-DETECTOR_POLICY.zClear);
  });

  it('no gain is not clearly better (significance)', () => {
    const c = compareHeldOut(cases({ gain: 0, noise: 0.2 }));
    expect(c.clearlyBetter).toBe(false);
    expect(c.failures).toContain('significance');
  });

  it('one season\'s luck cannot carry it: a large gain in one season and none in the others fails consistency', () => {
    const c = compareHeldOut(cases({ perOrigin: [0.3, -0.002, -0.002, -0.002, -0.002, -0.002, -0.002, -0.002], noise: 0.02 }));
    expect(c.relativeGain as number).toBeGreaterThan(DETECTOR_POLICY.minRelativeGain);
    expect(c.clearlyBetter).toBe(false);
    expect(c.failures).toContain('consistency');
  });

  it('a huge sample cannot adopt a trivially small gain (the practical minimum)', () => {
    const c = compareHeldOut(cases({ gain: 0.002, players: 5000, noise: 0.01 }));
    expect(c.z as number).toBeLessThan(-10);
    expect(c.originsWon).toBe(8);
    expect(c.clearlyBetter).toBe(false);
    expect(c.failures).toEqual(['size']);
  });

  it('too few held-out seasons cannot judge at all', () => {
    const c = compareHeldOut(cases({ gain: 0.05, origins: DETECTOR_POLICY.minOrigins - 1 }));
    expect(c.failures).toEqual(['origins']);
    const d = decide({ unshrunk: cases({ gain: 0.05, origins: 3 }), served: cases({ gain: 0.05, origins: 3 }), previous: 'starting' });
    expect(d).toMatchObject({ decided: false, serve: 'starting' });
  });

  it('a season with too few players is not scored', () => {
    const c = compareHeldOut(cases({ gain: 0.03, players: DETECTOR_POLICY.minCasesPerOrigin - 1 }));
    expect(c.originsScored).toBe(0);
  });

  it('standard errors are clustered by player: the same players in every season are not independent evidence', () => {
    const independent = compareHeldOut(cases({ gain: 0.01, noise: 0.3, seed: 5 }));
    // the same losses, but each player carries a persistent share of the noise across seasons
    const r = gen(9);
    const bias = Array.from({ length: 300 }, () => (r() - 0.5) * 0.3);
    const persistent = cases({ gain: 0.01, noise: 0.01, seed: 5, reuse: true }).map((c, i) => ({ ...c, candidate: c.candidate + bias[i % 300] }));
    const c = compareHeldOut(persistent);
    expect(c.se as number).toBeGreaterThan(independent.se as number);
  });
});

describe('deciding what serves: unshrunk and as served, with hysteresis', () => {
  it('from the starting values, the save\'s own are adopted only when clearly better both unshrunk and as served', () => {
    expect(decide({ unshrunk: cases({ gain: 0.03 }), served: cases({ gain: 0.03 }), previous: 'starting' })).toMatchObject({ decided: true, serve: 'save', rule: 'adopt_if_clearly_better' });
    expect(decide({ unshrunk: cases({ gain: 0.03 }), served: cases({ gain: 0.004 }), previous: 'starting' }).serve).toBe('starting');
    expect(decide({ unshrunk: cases({ gain: 0.004 }), served: cases({ gain: 0.03 }), previous: 'starting' }).serve).toBe('starting');
  });

  it('once the save\'s own serve, noise does not send them back: only a clearly better starting set does', () => {
    const noise = decide({ unshrunk: cases({ gain: 0 }), served: cases({ gain: -0.003, noise: 0.2 }), previous: 'save' });
    expect(noise).toMatchObject({ decided: true, serve: 'save', rule: 'return_if_fallback_clearly_better' });
    expect(noise.reverse?.clearlyBetter).toBe(false);
    const worse = decide({ unshrunk: cases({ gain: -0.04 }), served: cases({ gain: -0.04 }), previous: 'save' });
    expect(worse.serve).toBe('starting');
    expect(worse.reverse?.clearlyBetter).toBe(true);
  });

  it('the same noise that would not adopt the save\'s values does not return them either (no flip-flop)', () => {
    const c = cases({ gain: 0.004, noise: 0.2 });
    expect(decide({ unshrunk: c, served: c, previous: 'starting' }).serve).toBe('starting');
    expect(decide({ unshrunk: c, served: c, previous: 'save' }).serve).toBe('save');
  });

  it('swapping the roles swaps the verdict\'s direction', () => {
    const c = cases({ gain: 0.03 });
    expect(compareHeldOut(swapped(c)).clearlyBetter).toBe(false);
    expect(compareHeldOut(swapped(c)).z as number).toBeGreaterThan(DETECTOR_POLICY.zClear);
  });
});
