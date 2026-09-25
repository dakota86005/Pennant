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
