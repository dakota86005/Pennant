import { describe, expect, it } from 'vitest';
import { describeBat, expectedRunningRaw, expectedWobaRaw, HITTER_TOOL_SLOPES, PROFILE_MIN_POINTS, RUNNING_SLOPES, toolContributions, type ToolValues } from '../server/toolsModel';

/*
 * The tools model on unusual players. The model is a straight sum, so it can be inspected completely: these cases check that the sum
 * behaves at the corners, that no tool dominates, that nothing is double counted, and that a missing tool is never averaged around.
 * (The harness, scripts/calibrate.ts section 3c, checks the same corners against results: no class is off by more than about two standard
 * errors, and adding interaction terms improves R2 by 0.005, so the straight line is kept.)
 */

const tools = (contact: number, gap: number, power: number, eye: number, avoidK: number): ToolValues => ({ contact, gap, power, eye, avoidK });

const PROFILES: Record<string, ToolValues> = {
  'elite contact, no power': tools(80, 55, 30, 55, 75),
  'huge power, poor contact': tools(30, 60, 80, 45, 25),
  'discipline, poor contact': tools(35, 45, 45, 80, 45),
  'high contact, low walk': tools(70, 50, 45, 30, 70),
  'three true outcomes': tools(35, 55, 75, 75, 20),
  'speed-first bat': tools(45, 40, 25, 40, 50),
  'defense-first bat': tools(35, 35, 30, 35, 40),
  'bat-first DH': tools(65, 60, 75, 65, 50),
  'balanced star': tools(70, 65, 70, 70, 65),
  'very poor': tools(25, 25, 25, 25, 25),
};

const raw = (t: ToolValues) => expectedWobaRaw(t) as number;

describe('the tools model at the corners', () => {
  it('is monotone: improving any tool never lowers the expectation, and only strikeout avoidance is inert', () => {
    for (const tool of Object.keys(HITTER_TOOL_SLOPES) as Array<keyof typeof HITTER_TOOL_SLOPES>) {
      let last = -Infinity;
      for (const v of [20, 35, 50, 65, 80]) {
        const t = { ...tools(50, 50, 50, 50, 50), [tool]: v } as ToolValues;
        const r = raw(t);
        expect(r).toBeGreaterThanOrEqual(last);
        if (tool === 'avoidK') expect(r).toBe(raw(tools(50, 50, 50, 50, 50)));
        last = r;
      }
    }
  });

  it('nothing is double counted: strikeout avoidance adds nothing once contact, power and eye are known', () => {
    expect(HITTER_TOOL_SLOPES.avoidK).toBe(0);
    expect(raw(tools(60, 55, 55, 50, 20))).toBe(raw(tools(60, 55, 55, 50, 80)));
  });

  it('no single tool dominates: the widest swing of any one tool is well under half of all five together', () => {
    const swings = (Object.keys(HITTER_TOOL_SLOPES) as Array<keyof typeof HITTER_TOOL_SLOPES>).map((k) => HITTER_TOOL_SLOPES[k] * 60);
    const total = swings.reduce((n, v) => n + v, 0);
    expect(Math.max(...swings) / total).toBeLessThan(0.5);
  });

  it('keeps unlike players unlike: contact-first and power-first bats with the same total are told apart by what they lean on', () => {
    const contactFirst = describeBat(toolContributions(PROFILES['elite contact, no power']))!;
    const powerFirst = describeBat(toolContributions(PROFILES['huge power, poor contact']))!;
    expect(contactFirst.leans[0]).toBe('contact');
    expect(contactFirst.lacks).toContain('power');
    expect(powerFirst.leans[0]).toBe('power');
    expect(powerFirst.lacks).toContain('contact');
    expect(contactFirst.text).not.toBe(powerFirst.text);
  });

  it('a three-true-outcomes bat is built on power and discipline and short on contact', () => {
    const b = describeBat(toolContributions(PROFILES['three true outcomes']))!;
    expect(b.leans).toEqual(expect.arrayContaining(['power', 'plate discipline']));
    expect(b.lacks).toEqual(['contact']);
  });

  it('orders the archetypes sensibly: a star above a specialist above a weak bat, extremes bounded by the all-80 and all-20 hitters', () => {
    const star = raw(PROFILES['balanced star']);
    const dh = raw(PROFILES['bat-first DH']);
    const defense = raw(PROFILES['defense-first bat']);
    const poor = raw(PROFILES['very poor']);
    expect(star).toBeGreaterThan(dh);
    expect(dh).toBeGreaterThan(raw(PROFILES['elite contact, no power']));
    expect(raw(PROFILES['elite contact, no power'])).toBeGreaterThan(raw(PROFILES['high contact, low walk']));
    expect(defense).toBeGreaterThan(poor);
    for (const t of Object.values(PROFILES)) {
      expect(raw(t)).toBeLessThanOrEqual(raw(tools(80, 80, 80, 80, 80)));
      expect(raw(t)).toBeGreaterThanOrEqual(raw(tools(20, 20, 20, 20, 20)));
    }
  });

  it('a hitter whose only asset is speed does not look like a hitter: the bat tools decide the bat, and speed is a separate dimension', () => {
    expect(describeBat(toolContributions(PROFILES['speed-first bat']))!.lacks).toContain('power');
    expect(raw(PROFILES['speed-first bat'])).toBeLessThan(raw(tools(50, 50, 50, 50, 50)));
  });

  it('the contributions add up to the whole: the expectation is their sum', () => {
    for (const t of Object.values(PROFILES)) {
      const sum = (toolContributions(t) as NonNullable<ReturnType<typeof toolContributions>>).reduce((n, c) => n + c.points, 0);
      expect(sum).toBeCloseTo((raw(t) - raw(tools(50, 50, 50, 50, 50))) * 1000, 0);
    }
  });

  it('an ordinary bat is not given a description it does not deserve', () => {
    expect(describeBat(toolContributions(tools(52, 48, 51, 50, 50)))!.text).toBe('No tool stands out either way.');
    expect(PROFILE_MIN_POINTS).toBeGreaterThan(0);
  });
});

describe('missing evidence is never averaged around', () => {
  it('any tool that is not visible makes the expectation, the contributions and the profile unknown', () => {
    for (const missing of ['contact', 'gap', 'power', 'eye', 'avoidK'] as const) {
      const t = { ...tools(60, 55, 60, 55, 50), [missing]: null } as ToolValues;
      expect(expectedWobaRaw(t)).toBeNull();
      expect(toolContributions(t)).toBeNull();
      expect(describeBat(toolContributions(t))).toBeNull();
    }
  });

  it('the same holds for running: a hitter with a hidden baserunning rating has no running expectation', () => {
    expect(expectedRunningRaw({ speed: 70, baserunning: 60, stealing: null })).toBeNull();
    expect(expectedRunningRaw({ speed: 70, baserunning: 60, stealing: 50 })).not.toBeNull();
  });
});

describe('running is a smaller thing than the bat, and its parts are visible', () => {
  it('the widest swing in expected baserunning runs per 600 PA is a few runs, against the bat\'s tens', () => {
    const fast = expectedRunningRaw({ speed: 80, baserunning: 80, stealing: 80 }) as number;
    const slow = expectedRunningRaw({ speed: 20, baserunning: 20, stealing: 20 }) as number;
    expect(fast - slow).toBeLessThan(10);
    const bat = (raw(tools(80, 80, 80, 80, 80)) - raw(tools(20, 20, 20, 20, 20))) * 1000; // wOBA points; about 1 point ~ 1.4 runs per 600 PA
    expect(bat * 1.4).toBeGreaterThan((fast - slow) * 5);
    expect(RUNNING_SLOPES.speed).toBeGreaterThan(RUNNING_SLOPES.baserunning);
  });
});
