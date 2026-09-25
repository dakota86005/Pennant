import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Per-save calibration's neutral modules (D-053, cycle 1): MLB Operations keeps its fits per save WITHOUT reaching into Player
 * Value. The save's identity and the league's seasons live in `saveIdentity.ts`, the store in `saveCalibrationStore.ts` and
 * the refit registry in `saveCalibration.ts`; none of them, and no MLB Operations module, imports a playerValue* file.
 */

const SERVER = path.join(process.cwd(), 'server');
const code = (file: string): string =>
  fs.readFileSync(path.join(SERVER, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const imports = (file: string): string[] => [...code(file).matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

const NEUTRAL = ['saveIdentity.ts', 'saveCalibrationStore.ts', 'saveCalibration.ts'];
const MLB = ['mlbRoster.ts', 'mlbNeeds.ts', 'mlbResponses.ts', 'mlbReport.ts', 'mlbReview.ts', 'mlbPlans.ts', 'rosterScenario.ts', 'mlbEvidence.ts',
  'mlbOperations.ts', 'mlbExplain.ts', 'mlbCalibration.ts', 'mlbCalibrationFit.ts', 'mlbCalibrationRefit.ts', 'roleReview.ts', 'roleStandards.ts'];

describe('per-save calibration boundary', () => {
  it.each([...NEUTRAL, ...MLB])('%s imports no Player Value file', (file) => {
    for (const spec of imports(file)) expect(spec, `${file} imports ${spec}`).not.toMatch(/playerValue/);
  });

  it.each(NEUTRAL)('%s holds no subsystem method: it names no MLB Operations or Player Value constant', (file) => {
    expect(code(file)).not.toMatch(/AGING_CURVE|DEFENSE_WEIGHT|FLOOR_GAP|PRODUCTION_POLICY|RATINGS_POLICY/);
  });

  it('the store is additive and idempotent: created if absent, inserted or ignored, replaced only when forced', () => {
    const s = code('saveCalibrationStore.ts');
    expect(s).toMatch(/CREATE TABLE IF NOT EXISTS save_calibration_fits/);
    expect(s).toMatch(/meta\.force \? 'INSERT OR REPLACE' : 'INSERT OR IGNORE'/);
    expect(s).not.toMatch(/DROP TABLE|ALTER TABLE|DELETE FROM/);
    expect(s).not.toMatch(/from '\.\/db\.js'/);
  });

  it('the pure method module opens no table and reads no rating', () => {
    const s = code('mlbCalibrationFit.ts');
    expect(s).not.toMatch(/from '\.\/db\.js'|\.prepare\(|players_value|fielding_rating|batting_ratings|pitching_ratings/);
  });

  it('the calibration history reader reads objective statistics only: no rating column and no players_value', () => {
    const s = code('mlbCalibrationRefit.ts');
    expect(s).not.toMatch(/players_value|fielding_rating|batting_ratings|pitching_ratings|running_ratings|players_fielding\b|players_batting\b|players_pitching\b/);
  });
});

describe('the glove weights in force reach every working estimate', () => {
  /** Every call of roleReview's `estimateOf` (by its local name) or `compareReplacement` in a server module, with its argument count. */
  function calls(file: string): Array<{ name: string; args: number; text: string }> {
    const src = code(file);
    const names: Array<{ local: string; min: number }> = [];
    const imp = /import\s*\{([^}]*)\}\s*from\s*'\.\/roleReview\.js'/g;
    for (const m of src.matchAll(imp)) {
      for (const part of m[1].split(',')) {
        const [orig, alias] = part.replace(/\btype\b/, '').trim().split(/\s+as\s+/);
        if (orig === 'estimateOf') names.push({ local: (alias ?? orig).trim(), min: 3 });
        if (orig === 'compareReplacement') names.push({ local: (alias ?? orig).trim(), min: 4 });
      }
    }
    const out: Array<{ name: string; args: number; text: string }> = [];
    for (const { local, min } of names) {
      for (const m of src.matchAll(new RegExp(`\\b${local}\\(`, 'g'))) {
        let depth = 1; let i = (m.index as number) + m[0].length; let commas = 0; const start = i;
        for (; i < src.length && depth > 0; i += 1) {
          const c = src[i];
          if ('([{'.includes(c)) depth += 1;
          else if (')]}'.includes(c)) depth -= 1;
          else if (c === ',' && depth === 1) commas += 1;
        }
        const text = src.slice(start, i - 1);
        if (/^\s*[a-z]+\s*:/.test(text)) continue; // a declaration, not a call
        out.push({ name: `${local}/${min}`, args: text.trim() === '' ? 0 : commas + 1, text });
      }
    }
    return out;
  }

  it.each(['mlbReview.ts', 'mlbResponses.ts', 'mlbReport.ts', 'mlbPlans.ts', 'rosterScenario.ts', 'mlbOperations.ts', 'mlbExplain.ts', 'benchReview.ts'])('%s passes the glove weights to every working estimate and comparison', (file) => {
    for (const c of calls(file)) {
      const min = Number(c.name.split('/')[1]);
      expect(c.args, `${file}: ${c.name.split('/')[0]}(${c.text.slice(0, 80)})`).toBeGreaterThanOrEqual(min);
    }
  });
});
