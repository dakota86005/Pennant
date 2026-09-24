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
  'mlbAssignmentContext.ts',
  'roleReview.ts',
  'roleStanding.ts',
  'platoon.ts',
  'lineupPicture.ts',
  'resultsMetrics.ts',
  'resultsEvidence.ts',
  'rosterScenario.ts',
  'toolsModel.ts',
  'calibration.ts',
  'staffPreference.ts',
  'bullpenRoles.ts',
  'benchReview.ts',
  'lineupShifts.ts',
  'rehabAssignments.ts',
  'minorLeagueRoster.ts',
  'scoutedDevelopment.ts',
  'farmOperations.ts',
  'farmConsequence.ts',
  'farmResults.ts',
  'farmUsage.ts',
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

  it('the adapter reads exactly the extra rating families D-035 approved, and no others', () => {
    const source = code('scoutedEvidence.ts');
    // approved by the owner: a hitter's rating splits against left- and right-handed pitching, and his running ratings
    expect(source).toMatch(/batting_ratings_vsl_/);
    expect(source).toMatch(/batting_ratings_vsr_/);
    expect(source).toMatch(/running_ratings_speed/);
    expect(source).toMatch(/running_ratings_baserunning/);
    expect(source).toMatch(/running_ratings_stealing/);
    // not approved: pitchers' splits, hit-by-pitch and BABIP ratings, ground/fly and holding-runners ratings
    expect(source).not.toMatch(/pitching_ratings_vs[lr]_/);
    expect(source).not.toMatch(/_hp\b|_babip\b|ground_fly|misc_hold|batting_ratings_misc_bunt/);
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

  it('confines the players_value readers to the consumers not yet migrated onto Player Value, and the list only shrinks', () => {
    // valuation.ts's readers (valuesByPlayer, mlbPercentiler) hand players_value to their callers under other names.
    // Player Value phase 6 (PLAYER_VALUE.md Part 8) removes one consumer per change: 6a removed the player card
    // (player.ts) and Contracts (contracts.ts). A module missing from this set is fine; a module added to it is not.
    const allowed = new Set(['valuation.ts', 'api.ts', 'freeagents.ts', 'lineup.ts', 'trade.ts', 'tradingblock.ts']);
    const readers = fs
      .readdirSync(SERVER)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /\bvaluesByPlayer\b|\bmlbPercentiler\b/.test(code(f)));
    for (const file of readers) expect(allowed.has(file), `${file} reads players_value through valuation.ts`).toBe(true);
    expect(readers).not.toContain('player.ts');
    expect(readers).not.toContain('contracts.ts');
  });

  it('requires evidence, not bare numbers, at the development entry points', () => {
    // Structural: the inputs that carry ratings are typed as ScoutedAbility
    expect(code('developmentFit.ts')).toMatch(/ability:\s*ScoutedAbility/);
    expect(code('prospectDecision.ts')).toMatch(/ability:\s*ScoutedAbility/);
  });
});
