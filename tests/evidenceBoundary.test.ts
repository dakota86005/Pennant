import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A static guard on the evidence boundary.
 *
 * Runtime tests prove the current code honors it; this proves the next change
 * does. It reads the server source (comments stripped) and fails when a module
 * that makes subjective development or operations judgments touches a rating
 * source directly instead of going through server/scoutedEvidence.ts, or when
 * a new module starts reading `players_value`.
 */

const SERVER = path.join(process.cwd(), 'server');

const code = (file: string): string =>
  fs
    .readFileSync(path.join(SERVER, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Player Development and Minor League Operations. */
const GUARDED = [
  'org.ts',
  'prospectDecision.ts',
  'prospectAssignments.ts',
  'destinationFit.ts',
  'developmentFit.ts',
  'minorLeagueRoster.ts',
  'minorLeagueMoves.ts',
  'pitcherRosterSimulation.ts',
  'minorLeaguePitchingOperations.ts',
  'minorLeagueRetention.ts',
];

/** Every way of naming a continuous OOTP value/ability field that is not approved evidence. */
const PROHIBITED = [
  /players_value/,
  /\boa_rating\b/,
  /\bpot_rating\b/,
  /\boverall_value\b/,
  /\btalent_value\b/,
  /\boaRating\b/,
  /\bpotRating\b/,
  /\bvaluesByPlayer\b/,
];

/** Raw rating columns: only the evidence adapter (and the fielding reader it wraps) may read them. */
const RATING_COLUMNS = [
  /batting_ratings_/,
  /pitching_ratings_/,
  /fielding_rating/,
  /running_ratings_/,
];

describe('the evidence boundary', () => {
  it.each(GUARDED)('%s never reads a prohibited value field', (file) => {
    const source = code(file);
    for (const pattern of PROHIBITED) {
      expect(source, `${file} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it.each(GUARDED)('%s does not read rating columns directly', (file) => {
    const source = code(file);
    for (const pattern of RATING_COLUMNS) {
      expect(source, `${file} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it.each(GUARDED)('%s does not call gloves() directly', (file) => {
    expect(code(file), file).not.toMatch(/\bgloves\(/);
  });

  it('keeps players_value out of the adapter itself', () => {
    const source = code('scoutedEvidence.ts');
    for (const pattern of PROHIBITED) expect(source, `adapter matches ${pattern}`).not.toMatch(pattern);
    // ...and it imports only the scale detector, not the value readers, from valuation.ts
    expect(source).toMatch(/import \{ ratingScaleMax \} from '\.\/valuation\.js'/);
  });

  it('confines players_value to the modules that predate the boundary', () => {
    // Trade, contract and franchise valuation are outside Player Development and
    // Minor League Operations. Any NEW module reading players_value must be added
    // here deliberately, with the same review this boundary was created for.
    const allowed = new Set(['valuation.ts', 'franchise.ts', 'trade.ts']);
    const readers = fs
      .readdirSync(SERVER)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /players_value/.test(code(f)));
    expect(new Set(readers)).toEqual(allowed);
  });

  it('requires evidence, not bare numbers, at the development entry points', () => {
    // Structural: the inputs that carry ratings are typed as ScoutedAbility
    expect(code('developmentFit.ts')).toMatch(/ability:\s*ScoutedAbility/);
    expect(code('prospectDecision.ts')).toMatch(/ability:\s*ScoutedAbility/);
  });
});
