import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectedWobaRaw, toolContributions, TOOLS_PRIOR, type ToolsParams, type ToolValues } from '../server/toolsModel';

/**
 * The tools model's slopes arrive as the params in force (cycle 4 of the per-save calibration): no function reads a default, one reader
 * serves them (`toolsCalibration.ts`), and MLB Operations and the Lineup page read the same one, so one league has one set.
 */

const SERVER = path.join(process.cwd(), 'server');
const code = (file: string): string => fs.readFileSync(path.join(SERVER, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the tools params in force', () => {
  it('the slopes in force are the ones used: a different set changes the expectation and the contributions', () => {
    const t: ToolValues = { contact: 70, gap: 50, power: 40, eye: 50, avoidK: 50 };
    const contactHeavy: ToolsParams = { ...TOOLS_PRIOR, slopes: { ...TOOLS_PRIOR.slopes, contact: TOOLS_PRIOR.slopes.contact * 2 }, source: 'save' };
    expect(expectedWobaRaw(t, contactHeavy)).not.toBe(expectedWobaRaw(t, TOOLS_PRIOR));
    expect(toolContributions(t, contactHeavy)?.[0].points).toBeCloseTo(2 * (toolContributions(t, TOOLS_PRIOR)?.[0].points ?? 0), 1);
  });

  it('no production module outside the model, its reader and its fit names the starting slopes', () => {
    const allowed = new Set(['toolsModel.ts', 'toolsCalibration.ts', 'mlbToolsFit.ts']);
    const users = fs.readdirSync(SERVER).filter((f) => f.endsWith('.ts') && !allowed.has(f) && /\b(TOOLS_PRIOR|HITTER_TOOL_SLOPES|RUNNING_SLOPES)\b/.test(code(f)));
    expect(users).toEqual([]);
  });

  it('MLB Operations and the Lineup page read the same reader', () => {
    expect(code('mlbCalibration.ts')).toMatch(/tools:\s*toolsParamsFor\(leagueId\)/);
    expect(code('lineup.ts')).toMatch(/toolsParamsFor\(/);
    // every evidence builder is handed the params: none calls the model without them
    for (const file of ['mlbEvidence.ts', 'lineup.ts']) {
      expect(code(file), file).not.toMatch(/expectedWobaRaw\([^,()]*\)|expectedRunningRaw\([^,()]*\)|ratingPlatoon\([^,()]*,[^,()]*\)|toolContributions\([^,()]*\)/);
    }
  });

  it('the forward cases are neutral: no subsystem\'s answers, no rating column, and no Player Value fit read by MLB Operations', () => {
    const forward = code('ratingsForward.ts');
    expect(forward).not.toMatch(/from '\.\/(playerValue[A-Za-z]*|mlb[A-Za-z]*|farm[A-Za-z]*|philosophy|settings|developmentFit|developmentalContext)\.js'/);
    expect(forward).not.toMatch(/batting_ratings_|pitching_ratings_|players_value/);
    for (const file of ['mlbToolsFit.ts', 'toolsCalibration.ts']) expect(code(file), file).not.toMatch(/from '\.\/playerValue[A-Za-z]*\.js'/);
  });
});

describe('the API serves the tools params in force', () => {
  it('the roster review\'s calibration route gives the slopes, their source and the tools weight beside the yardsticks', async () => {
    const { default: request } = await import('./request');
    const { IDS } = await import('./fixture');
    const body = await request(`/api/mlb-operations/${IDS.mlbTeam}/calibration`);
    expect(body.inForce.tools).toMatchObject({ source: 'starting', slopes: TOOLS_PRIOR.slopes });
    expect(body.inForce.toolsWeight).toEqual({ hitter: 1, starter: 1, reliever: 1 });
    expect(body.groups.map((g: { key: string }) => g.key)).toContain('tools');
  });
});
