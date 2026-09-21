import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Minor League Operations boundary, enforced statically.
 *
 * The audit found the farm v1 modules adding a philosophy adjustment to a development quantity,
 * carrying a second Player Development verdict built from raw statistics, and writing the same roster
 * thresholds by hand in three files (docs/MINOR_LEAGUE_OPERATIONS.md §1.6). The same guard MLB
 * Operations has (D-024's `tests/mlbOperationsBoundary.test.ts`), for this subsystem.
 */

const SERVER = path.join(process.cwd(), 'server');
const code = (file: string): string => fs.readFileSync(path.join(SERVER, file), 'utf8');

/** Every module this phase added or owns. */
const FARM = [
  'farmCalibration.ts',
  'farmResults.ts',
  'farmUsage.ts',
  'playingTime.ts',
  'currentAssignment.ts',
  'farmAffiliate.ts',
  'farmAssignments.ts',
  'farmOrganization.ts',
  'farmCascade.ts',
  'farmRetention.ts',
  'farmOperations.ts',
  'farmConsequence.ts',
  'farmRoutes.ts',
];

/** The pure ones: reasoning modules that take evidence as arguments and open nothing. */
const PURE = [
  'playingTime.ts',
  'currentAssignment.ts',
  'farmAffiliate.ts',
  'farmAssignments.ts',
  'farmOrganization.ts',
  'farmCascade.ts',
  'farmRetention.ts',
];

const PROHIBITED_VALUE_FIELDS = [
  /players_value/,
  /\boa_rating\b/,
  /\bpot_rating\b/,
  /overall_value/,
  /talent_value/,
  /offensive_value/,
  /pitching_value/,
];

const RATING_COLUMNS = [
  /batting_ratings_/,
  /pitching_ratings_/,
  /fielding_rating_pos/,
  /running_ratings_/,
  /avg_rating_/,
];

describe('Minor League Operations boundary', () => {
  it.each(FARM)('%s reads no prohibited value field', (file) => {
    for (const pattern of PROHIBITED_VALUE_FIELDS) {
      expect(code(file), `${file} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it.each(FARM)('%s reads no rating column directly: ability comes through the adapter (D-017)', (file) => {
    for (const pattern of RATING_COLUMNS) {
      expect(code(file), `${file} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it.each(FARM)('%s does not call gloves() itself', (file) => {
    expect(code(file), file).not.toMatch(/\bgloves\(/);
  });

  it.each(PURE)('%s opens no table: evidence arrives as arguments', (file) => {
    expect(code(file), file).not.toMatch(/from '\.\/db\.js'/);
    expect(code(file), file).not.toMatch(/\.prepare\(/);
  });

  it.each(FARM)('%s writes nothing', (file) => {
    expect(code(file), file).not.toMatch(/\.run\(|INSERT |UPDATE |DELETE |writeFile/);
  });

  it('Player Development is asked, never recreated: no farm module holds a development threshold', () => {
    for (const file of FARM) {
      const source = code(file);
      /* The one Player Development question this phase added lives in currentAssignment.ts. */
      if (file === 'currentAssignment.ts') continue;
      expect(source, file).not.toMatch(/promotionThreshold\s*[:=]/);
      expect(source, file).not.toMatch(/DEVELOPMENTAL_PROMOTION_BASE\s*=/);
      expect(source, file).not.toMatch(/readinessRelief|STAKES_WEIGHT|PRODUCTION_SAMPLE_MINIMUM/);
    }
  });

  it('philosophy reaches only the two places allowed to read it, and never a pure judgment', () => {
    /*
     * The farm v1 retention model added a philosophy adjustment to a development score which then
     * gated a release threshold. Philosophy may be an INPUT to `farmRetention` (where it is a stated
     * lean, after the outlook is fixed) and may be resolved in the service; nothing else may name a
     * dimension.
     */
    const allowed = new Set(['farmRetention.ts', 'farmOperations.ts', 'farmConsequence.ts']);
    for (const file of FARM) {
      if (allowed.has(file)) continue;
      expect(code(file), file).not.toMatch(/from '\.\/(philosophy|settings)\.js'/);
      expect(code(file), file).not.toMatch(
        /prospectPreservation|promotionAggressiveness|competitiveWindow|upsidePreference|ageCurveSensitivity|positionalScarcity|dimensions\./
      );
    }
  });

  it('the developmental outlook is computed before philosophy is read, and never from it', () => {
    const source = code('farmRetention.ts');
    /* The outlook function must not mention a philosophy dimension at all. */
    const outlook = source.slice(source.indexOf('function outlookOf'), source.indexOf('/* ── operational pressure'));
    expect(outlook).not.toMatch(/philosophy|prospectPreservation|rosterDepth/);
  });

  it('roster state comes from Player State, never from a raw roster column (D-020)', () => {
    for (const file of FARM) {
      expect(code(file), file).not.toMatch(/is_on_secondary|is_on_dl|must_be_active|days_on_dfa_left|is_major\b/);
    }
  });

  it('rehab is decided by the one module that owns it (D-026)', () => {
    for (const file of FARM) {
      if (file === 'farmOperations.ts' || file === 'farmConsequence.ts') continue;
      expect(code(file), file).not.toMatch(/rehab_assigned|rehab_returned|transactionLog/);
    }
  });

  it('every farm threshold is declared once, in farmCalibration.ts', () => {
    const owned = /\b(BODY_COUNT|ROTATION_SPOTS|RELIEF_CORPS|CRITICAL_POSITIONS|PLAYABLE_GRADE|STRONG_GRADE|POSITION_CAPACITY|REGULAR_PLAY_SHARE|PART_TIME_SHARE|ROTATION_SHARE|RELIEF_EVEN_SHARE_PART_TIME|DEPARTED_SHARE_NOTED|STARTER_CAPACITY|RELIEF_CAPACITY|MINIMUM_CLUB_GAMES|MINIMUM_SAMPLE|MATURE_SAMPLE|LEAGUE_POPULATION_MINIMUM|YOUNG_FOR_LEVEL|OLD_FOR_LEVEL|AGE_LEVEL_DEVELOPMENT_LIMIT|UPPER_MINORS_DEPTH_FLOOR|UPPER_MINORS_LEVELS|PRIORITY_CONGESTION_AT|CASCADE_MAX_STEPS|RUNWAY_CLOSING_AGE|RUNWAY_SERVICE_LIMIT|PROTECTED_TIERS)\b/;
    const files = fs.readdirSync(SERVER).filter((f) => f.endsWith('.ts') && f !== 'farmCalibration.ts');
    for (const file of files) {
      const source = code(file);
      if (!owned.test(source)) continue;
      for (const name of source.match(new RegExp(`export const ${owned.source.slice(2, -2)}`, 'g')) ?? []) {
        expect.fail(`${file} redefines ${name}, which farmCalibration.ts owns`);
      }
    }
  });

  it('is not imported by Player Development, Player Rights, Player State or the evidence adapter', () => {
    const upstream = [
      'scoutedEvidence.ts',
      'prospectDecision.ts',
      'prospectAssignments.ts',
      'destinationFit.ts',
      'developmentFit.ts',
      'assignmentPreference.ts',
      'playerRights.ts',
      'playerState.ts',
    ];
    for (const file of upstream) {
      expect(code(file), file).not.toMatch(
        /from '\.\/(farmOperations|farmConsequence|farmRoutes|farmAssignments|farmAffiliate|farmCascade|farmOrganization|farmRetention|playingTime)\.js'/
      );
    }
  });

  it('MLB Operations asks for the farm consequence and does not rebuild the cascade', () => {
    /*
     * The contract direction (D-045): MLB Operations DISPLAYS the farm consequence, Minor League
     * Operations OWNS the calculation. Only the adapter may reach for it, and no MLB module may
     * contain a chain planner of its own.
     */
    const mlb = ['mlbRoster.ts', 'mlbNeeds.ts', 'mlbResponses.ts', 'mlbReport.ts', 'mlbReview.ts', 'mlbPlans.ts', 'mlbOperations.ts'];
    for (const file of mlb) {
      expect(code(file), file).not.toMatch(/from '\.\/farm(Operations|Consequence|Routes|Cascade|Assignments|Affiliate|Organization|Retention)\.js'/);
      expect(code(file), file).not.toMatch(/planCascade|candidatesFor|CascadeStep/);
    }
    expect(code('mlbEvidence.ts')).toMatch(/farmConsequenceFor/);
  });

  it('no farm module recreates a Player Rights conclusion', () => {
    for (const file of FARM) {
      expect(code(file), file).not.toMatch(/evaluatePlayerRights|OPTION_YEARS|CONSENT_SERVICE_YEARS|rules_dfa_period/);
    }
  });

  it('every conclusion type keeps an indeterminate state', () => {
    expect(code('currentAssignment.ts')).toMatch(/'indeterminate'/);
    expect(code('farmAssignments.ts')).toMatch(/'indeterminate'/);
    expect(code('farmRetention.ts')).toMatch(/'indeterminate'/);
    expect(code('farmCascade.ts')).toMatch(/'indeterminate'/);
  });

  it('nothing in the farm executes or proposes a transaction', () => {
    for (const file of FARM) {
      expect(code(file), file).not.toMatch(/executeTransaction|applyMove|commitMove/);
    }
    expect(code('farmCascade.ts')).toMatch(/Nothing in the chain is a transaction/);
    expect(code('farmRetention.ts')).toMatch(/executes nothing/);
  });
});
