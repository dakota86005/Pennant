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
 * any module starts reading `players_value`: since Player Value phase 6e no server, client, script or desktop module may,
 * and there is no allow-list.
 */

const SERVER = path.join(process.cwd(), 'server');

const code = (file: string): string =>
  fs
    .readFileSync(path.join(SERVER, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Comments stripped, as `code` does, for a source anywhere in the repository. */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every TypeScript source under a directory, recursively. */
const sourceFiles = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? sourceFiles(path.join(dir, e.name)) : /\.(ts|tsx|mts)$/.test(e.name) ? [path.join(dir, e.name)] : [])
    : [];

/** The readers that handed players_value on under other names (deleted in phase 6e). */
const INDIRECT = /\bvaluesByPlayer\b|\bmlbPercentiler\b/;

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
  // Phase 6d (PLAYER_VALUE.md Part 8): the lineup reads its bats and gloves through the adapter
  'lineup.ts',
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

  it('no server module reads players_value, and the list can never grow (phase 6e: the allow-list is empty)', () => {
    // Player Value phase 6 (PLAYER_VALUE.md Part 8) moved every consumer off OOTP's hidden value figures, one per change;
    // phase 6e deleted the last readers (valuation.ts's valuesByPlayer and mlbPercentiler). There is no allow-list any
    // more: a module that starts reading players_value is a failure here, never an addition to a list (D-017).
    const readers = fs
      .readdirSync(SERVER)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /players_value/.test(code(f)));
    expect(readers).toEqual([]);
  });

  it.each(['trade.ts', 'tradingblock.ts'])('%s, migrated to Player Value (phase 6b), reads no value field, percentile or OOTP rating', (file) => {
    const source = code(file);
    for (const pattern of [...PROHIBITED, /\bmlbPercentiler\b/, /\bVALUE_PERCENTILE_NOTE\b/, /\boverallPct\b/, /\btalentPct\b/, /\bvaluePct\b/]) {
      expect(source, `${file} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it('no module reads players_value through another under a different name: valuation.ts holds no value reader (phase 6e)', () => {
    // valuation.ts's valuesByPlayer and mlbPercentiler handed players_value to their callers under other names. Player
    // Value phase 6 moved their callers one per change (6a the card and Contracts, 6b the Trade Center, 6c Free Agents, 6d
    // the Roster and the lineup); phase 6e deleted them with contractsByPlayer. Nothing may name them again.
    const readers = fs
      .readdirSync(SERVER)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => INDIRECT.test(code(f)));
    expect(readers).toEqual([]);
    expect(code('valuation.ts')).not.toMatch(/\bPercentiler\b|\bPlayerValue\b|\bContractInfo\b|\bcontractsByPlayer\b/);
  });

  it.each(['src', 'scripts', 'electron'])('no module under %s/ names a players_value figure or a percentile of one (phase 6e)', (dir) => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(process.cwd(), dir))) {
      const source = strip(fs.readFileSync(file, 'utf8'));
      for (const pattern of [...PROHIBITED, INDIRECT, /\boverallPct\b|\btalentPct\b|\bvaluePct\b|\bVALUE_PERCENTILE_NOTE\b/]) {
        if (pattern.test(source)) offenders.push(`${path.relative(process.cwd(), file)} matches ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each(['api.ts', 'lineup.ts', 'franchise.ts'])('%s, taken off players_value (phase 6d), reads no value field, percentile or OOTP rating', (file) => {
    const source = code(file);
    for (const pattern of [...PROHIBITED, /\bmlbPercentiler\b/, /\bVALUE_PERCENTILE_NOTE\b/, /\boverallPct\b/, /\btalentPct\b/, /\boffensive_value/, /\bpitching_value\b/]) {
      expect(source, `${file} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it.each(['freeagents.ts', 'rosterops.ts', 'positionNeeds.ts', 'ai.ts', 'chat.ts'])('%s, migrated to Player Value (phase 6c), reads no value field, percentile or OOTP rating', (file) => {
    const source = code(file);
    for (const pattern of [...PROHIBITED, /\bmlbPercentiler\b/, /\bVALUE_PERCENTILE_NOTE\b/, /\boverallPct\b/, /\btalentPct\b/, /\bvaluePct\b/]) {
      expect(source, `${file} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it('the club\'s thinnest positions are read on Player Value, not on players_value (phase 6c): valuation.ts no longer ranks them', () => {
    expect(code('valuation.ts')).not.toMatch(/\brosterHoles\b/);
    expect(code('valuation.ts')).not.toMatch(/\bVALUE_PERCENTILE_NOTE\b/);
  });

  it('requires evidence, not bare numbers, at the development entry points', () => {
    // Structural: the inputs that carry ratings are typed as ScoutedAbility
    expect(code('developmentFit.ts')).toMatch(/ability:\s*ScoutedAbility/);
    expect(code('prospectDecision.ts')).toMatch(/ability:\s*ScoutedAbility/);
  });
});
