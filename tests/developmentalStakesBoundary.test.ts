import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A static guard on the stakes model's boundaries (docs/DEVELOPMENTAL_STAKES.md, D-050).
 *
 * Runtime tests prove the current code honors them; this proves the next change does. It reads the
 * server source with comments stripped.
 */

const SERVER = path.join(process.cwd(), 'server');

const code = (file: string): string =>
  fs
    .readFileSync(path.join(SERVER, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const serverFiles = (): string[] => fs.readdirSync(SERVER).filter((f) => f.endsWith('.ts'));

describe('one way to compute the tier', () => {
  it('only the context reader calls the evaluator', () => {
    /*
     * Five call sites once assembled `{ age, ability }` themselves. With context an input, two callers
     * could tier one man two ways, so every production caller goes through `developmentalContext.ts`.
     * The major-league context module is HANDED the reader's protection and cannot compute one.
     */
    const allowed = new Set(['developmentFit.ts', 'developmentalContext.ts']);
    const callers = serverFiles().filter((f) => /\bevaluateDevelopmentProtection\s*\(/.test(code(f)));
    expect(callers.filter((f) => !allowed.has(f))).toEqual([]);
    expect(code('mlbAssignmentContext.ts')).not.toMatch(/evaluateDevelopmentProtection|from '\.\/scoutedEvidence\.js'/);
  });

  it('every module that serves a tier obtains it from a reader, with the age as the export has it', () => {
    for (const file of ['farmOperations.ts', 'farmConsequence.ts', 'scoutedDevelopment.ts', 'org.ts']) {
      expect(code(file), file).toMatch(/\.protect\(\{/);
      /* `Number(null)` is 0, and 0 would read as a nineteen-year-old's development ahead of him. */
      expect(code(file), file).not.toMatch(/protect\(\{\s*age:\s*Number\(/);
    }
    expect(code('org.ts')).toMatch(/protection:\s*stakes\.protect\(\{/);
  });

  it('the farm reads "how old is he for his league" from the same reader, so his review and his stakes cannot disagree about it', () => {
    /* `computeProspects` keeps its own league baselines for production; the farm no longer reads an age from them. */
    expect(code('farmOperations.ts')).toMatch(/ageRelativeToLevel:\s*session\.stakes\(\)\.forLevel\(/);
    expect(code('farmOperations.ts')).not.toMatch(/avgAge|leagueBaselines/);
  });

  it('nothing decides anything with the composite the model replaced', () => {
    const callers = serverFiles().filter((f) => /\bsupersededCompositeTier\b/.test(code(f)));
    expect(callers).toEqual(['developmentFit.ts']);
    /* Inside the evaluator it only fills the explanation: the tier is assigned before it is read. */
    const source = code('developmentFit.ts');
    const tierAssigned = source.indexOf('const tier = tierFor(');
    const supersededRead = source.indexOf('const superseded = supersededCompositeTier(');
    expect(tierAssigned).toBeGreaterThan(0);
    expect(supersededRead).toBeGreaterThan(tierAssigned);
  });
});

describe('what the evaluator may read', () => {
  it('is pure: it opens no table', () => {
    expect(code('developmentFit.ts')).not.toMatch(/from '\.\/db\.js'/);
    expect(code('developmentFit.ts')).not.toMatch(/\.prepare\(/);
  });

  it('takes no philosophy (D-019), no result and no usage', () => {
    const source = code('developmentFit.ts');
    expect(source).not.toMatch(/from '\.\/(philosophy|settings|assignmentPreference|staffPreference)\.js'/);
    expect(source).not.toMatch(/from '\.\/(farmResults|resultsMetrics|resultsEvidence|farmUsage|farmRecentUsage|playingTime|prospectDecision|history)\.js'/);
    expect(source).not.toMatch(/from '\.\/(farmOperations|farmConsequence|farmAssignments|farmAffiliate|farmCascade|farmOrganization|farmRetention)\.js'/);
  });

  it('the context reader reads objective facts only: no rating, no value field, no result, no philosophy, and it writes nothing', () => {
    const source = code('developmentalContext.ts');
    expect(source).not.toMatch(/batting_ratings_|pitching_ratings_|fielding_rating|running_ratings_|players_value|\boa\b|\bpot\b/);
    expect(source).not.toMatch(/career_batting|career_pitching|game_batting|game_pitching/);
    expect(source).not.toMatch(/from '\.\/(philosophy|settings|history)\.js'/);
    expect(source).not.toMatch(/\.run\(|INSERT |UPDATE |DELETE |writeFile/);
    /* A peer is on a roster, and a league is the peer group. */
    expect(source).toMatch(/EXISTS \(SELECT 1 FROM team_roster/);
    expect(source).toMatch(/GROUP BY t\.level, t\.league_id/);
  });

  it('declares every stakes constant once, and reads the age-for-level lines rather than redeclaring them', () => {
    const owned = /export const (CEILING_LINES|DEVELOPMENT_AGE|PROJECTION_REALIZED_UNDER)\b/;
    for (const file of serverFiles()) {
      if (file === 'developmentFit.ts') continue;
      expect(code(file), file).not.toMatch(owned);
    }
    expect(code('developmentFit.ts')).toMatch(/import \{ AGE_LEVEL_DEVELOPMENT_LIMIT, OLD_FOR_LEVEL, YOUNG_FOR_LEVEL \} from '\.\/farmCalibration\.js'/);
    expect(code('developmentFit.ts')).not.toMatch(/(OLD_FOR_LEVEL|YOUNG_FOR_LEVEL|AGE_LEVEL_DEVELOPMENT_LIMIT)\s*=/);
  });
});

describe('what the tier may not become', () => {
  it('no score: nothing serves a number standing for a player\'s stakes', () => {
    expect(code('developmentFit.ts')).not.toMatch(/\bscore\s*:\s*number/);
    for (const file of ['scoutedDevelopment.ts', 'mlbAssignmentContext.ts', 'mlbResponses.ts', 'farmOperations.ts', 'farmConsequence.ts']) {
      expect(code(file), file).not.toMatch(/protection\.score|stakes\.score/);
    }
  });

  it('no ranking: nothing orders players by their tier or names a prospect\'s rank', () => {
    for (const file of serverFiles()) {
      const source = code(file);
      expect(source, file).not.toMatch(/prospectRank|prospectRanking|organizationRank|rankInOrganization|topProspects/i);
    }
  });

  it('Player Development\'s authorization still does not read it', () => {
    for (const file of ['prospectDecision.ts', 'prospectAssignments.ts', 'destinationFit.ts', 'assignmentPreference.ts']) {
      expect(code(file), file).not.toMatch(/from '\.\/(developmentFit|developmentalContext)\.js'/);
    }
  });

  it('philosophy modules do not import the stakes model, and the stakes model does not import them', () => {
    for (const file of ['philosophy.ts', 'staffPreference.ts', 'assignmentPreference.ts']) {
      expect(code(file), file).not.toMatch(/from '\.\/(developmentFit|developmentalContext)\.js'/);
    }
    expect(code('developmentalContext.ts')).not.toMatch(/prospectPreservation|promotionAggressiveness|dimensions\./);
  });
});
