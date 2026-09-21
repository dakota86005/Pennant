import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A static guard on MLB Operations' place in the architecture (docs/MLB_OPERATIONS.md).
 *
 * MLB Operations is a consumer of Player State, Player Rights, Player Development,
 * Minor League Operations, Organizational Philosophy and the scouted-evidence adapter.
 * It must not recreate their logic or reach around them to raw OOTP tables. This reads
 * the source (comments stripped) so the next change cannot quietly do so.
 */

const SERVER = path.join(process.cwd(), 'server');

const code = (file: string): string =>
  fs
    .readFileSync(path.join(SERVER, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const MLB = ['mlbRoster.ts', 'mlbNeeds.ts', 'mlbResponses.ts', 'mlbReport.ts', 'mlbReview.ts', 'mlbPlans.ts', 'rosterScenario.ts', 'mlbEvidence.ts', 'mlbOperations.ts'];
/** The pure core: no database access at all. */
const PURE = ['mlbRoster.ts', 'mlbNeeds.ts', 'mlbResponses.ts', 'mlbReport.ts', 'mlbReview.ts', 'mlbPlans.ts', 'rosterScenario.ts'];

const RATINGS = [/players_value/, /\boa_rating\b/, /\bpot_rating\b/, /\boverall_value\b/, /\btalent_value\b/,
  /\bvaluesByPlayer\b/, /batting_ratings_/, /pitching_ratings_/, /fielding_rating/, /running_ratings_/, /\bgloves\(/];

/** Roster and rights facts that only Player State / Player Rights may read from the export. */
const ROSTER_COLUMNS = [/players_roster_status/, /is_on_secondary/, /options_used/, /days_on_dfa_left/, /years_protected_from_rule_5/,
  /irrevocable_waivers/, /designated_for_assignment/, /is_on_dl/, /days_on_waivers/];

/** Chronology and snapshots enter only through Rights / assignment context. */
const HISTORY = [/rosterStateHistory/, /transactionHistory/, /transactionLog/, /liveLogSnapshot/, /rosterTransactionState/];

describe('MLB Operations boundary', () => {
  it.each(MLB)('%s reads no ability rating source and no players_value', (file) => {
    for (const pattern of RATINGS) expect(code(file), `${file} matches ${pattern}`).not.toMatch(pattern);
  });

  it.each(MLB)('%s reads no roster-status, option, 40-man, or DFA column itself', (file) => {
    for (const pattern of ROSTER_COLUMNS) expect(code(file), `${file} matches ${pattern}`).not.toMatch(pattern);
  });

  it.each(MLB)('%s never builds a need or a response from snapshot history or the raw transaction log', (file) => {
    for (const pattern of HISTORY) expect(code(file), `${file} matches ${pattern}`).not.toMatch(pattern);
  });

  it.each(PURE)('%s (the pure core) opens no table', (file) => {
    expect(code(file), file).not.toMatch(/from '\.\/db\.js'/);
    expect(code(file), file).not.toMatch(/\.prepare\(/);
  });

  it.each(MLB)('%s does not run the development or philosophy engines itself', (file) => {
    const source = code(file);
    expect(source, file).not.toMatch(/evaluateProspectAssignments|evaluateProspectDecision|evaluateDevelopmentProtection|expressAssignmentPreference|computeProspects\(/);
    if (file !== 'mlbOperations.ts') expect(source, file).not.toMatch(/from '\.\/(philosophy|settings)\.js'/);
  });

  it('never re-derives rights: no option-year, service-year, or waiver constants outside Player Rights', () => {
    for (const file of MLB) {
      const source = code(file);
      expect(source, file).not.toMatch(/OPTION_YEARS|CONSENT_SERVICE_YEARS|rules_dfa_period|rules_waiver_period/);
      expect(source, file).not.toMatch(/optionYearsOf|evaluatePlayerRights/);
    }
  });

  it('is not imported by Player Development, Player Rights, Player State, or the evidence adapter', () => {
    const upstream = ['org.ts', 'prospectDecision.ts', 'prospectAssignments.ts', 'destinationFit.ts', 'developmentFit.ts',
      'developmentJudgment.ts', 'assignmentPreference.ts', 'playerRights.ts', 'playerState.ts', 'assignmentContext.ts',
      'scoutedEvidence.ts', 'minorLeagueRoster.ts',
      'mlbAssignmentContext.ts', 'rehabAssignments.ts', 'roleStanding.ts', 'roleReview.ts', 'platoon.ts', 'lineupPicture.ts', 'resultsMetrics.ts', 'resultsEvidence.ts',
      'toolsModel.ts', 'calibration.ts', 'staffPreference.ts', 'bullpenRoles.ts', 'benchReview.ts', 'lineupShifts.ts'];
    for (const file of upstream) expect(code(file), file).not.toMatch(/from '\.\/(mlbRoster|mlbNeeds|mlbResponses|mlbEvidence|mlbOperations)\.js'/);
  });

  it('never selects or ranks by philosophy: the groups are ordered by path, level and name only', () => {
    const source = code('mlbResponses.ts');
    // the philosophy STAGE only annotates; the groups are sorted by PATH_ORDER, level and name
    expect(source).toMatch(/PATH_ORDER\[a\.pathKind\] - PATH_ORDER\[b\.pathKind\]/);
    expect(source).not.toMatch(/sort\([^)]*stance/);
  });

  it('philosophy leans on advice only after validity (D-036): readiness and the verdict come first, and nothing here reads a philosophy value', () => {
    const source = code('mlbResponses.ts');
    // in the lead choice, the preference score comes only after readiness, the verdict and the equivalence band
    const from = source.indexOf('const lead = comparable');
    const lead = source.slice(from, source.indexOf('const active = activeMembers(view)', from));
    const at = (token: string) => lead.indexOf(token);
    expect(at('READY[a.group] - READY[b.group]')).toBeGreaterThan(-1);
    expect(at('UPGRADE_ORDER[(a.comparison')).toBeGreaterThan(at('READY[a.group] - READY[b.group]'));
    expect(at('band(b) - band(a)')).toBeGreaterThan(at('UPGRADE_ORDER[(a.comparison'));
    expect(at('preference?.score')).toBeGreaterThan(at('band(b) - band(a)'));
    expect(at('comparison?.delta')).toBeGreaterThan(at('preference?.score'));
    // plans are ordered by certainty first
    expect(source).toMatch(/CERTAINTY_RANK\[a\.p\.certainty\][^\n]*\n\s*\|\| \(lean\.by/);
    // no MLB module reads a philosophy dimension by name: the values arrive through the context
    for (const file of MLB) {
      if (file === 'mlbOperations.ts') continue;
      expect(code(file), file).not.toMatch(/competitiveWindow|riskTolerance|ageCurveSensitivity|upsidePreference|defenseEmphasis|dimensions\./);
    }
  });

  it('holds no developmental threshold: relief, experience, stakes and readiness bars live in Player Development only', () => {
    for (const file of MLB) {
      expect(code(file), file).not.toMatch(/readinessRelief|establishedExperience|STAKES_WEIGHT|LOW_STAKES_WEIGHT|PRODUCTION_SAMPLE_MINIMUM|promotionThreshold|MEANINGFUL_GAP|RESULTS_SAMPLE_MINIMUM|PITCHER_RESULTS_MIX|CONCERN\b|DEFENSE_WEIGHT|REGULAR_SHARE|PLATOON_SHRINK_K|MIN_SPLIT_PA|PROBLEM_EXCESS|COMPLEMENT_MARGIN|SEASON_WEIGHTS|STABILIZATION|POPULATION_MINIMUM|RATING_PRIOR_WEIGHT|RUNNING_WEIGHT|TOOLS_INFORMATION|AGING_CURVE|HITTER_TOOL_SLOPES|RUNNING_SLOPES|SHIFT_MIN_GAIN|DEPLOYMENT_GAP|LONG_INNINGS|MIN_APPEARANCES|REQUIRED_COVER|TIE_BAND|AGE_GAP_YEARS|UPSIDE_GAP|SKILL_GAP|DEVELOPING_AGE|PARK_WOBA_SHARE|STEAL_RUNS|DEFAULT_LEFT_SHARE/);
    }
  });

  it('never invents a default duration: an unknown horizon is judged across contexts, not mapped to one', () => {
    const source = code('mlbResponses.ts');
    expect(source).not.toMatch(/default_duration_unknown/);
    expect(source).toMatch(/resolveAcrossDurations/);
  });

  it('composes prerequisite transactions from the components Player Rights owns and defines no combined right', () => {
    for (const file of MLB) expect(code(file), file).not.toMatch(/addAndPromote|promoteAndAdd|addAndActivate/);
    const source = code('mlbResponses.ts');
    expect(source).toMatch(/actions\.addToFortyMan/);
    expect(source).toMatch(/composed\.promoteToActive/);
    expect(source).toMatch(/actions\.placeOnSixtyDayIl/);
    // it does not itself declare a transaction eligible: statuses come from Player Rights
    expect(source).not.toMatch(/status: 'eligible' as const,\s*\n?\s*label: 'Can be/);
  });

  it('the evaluation calibration is declared once, in its own module, and repeated nowhere else', () => {
    const owners: Record<string, RegExp> = {
      'roleReview.ts': /\b(PITCHER_RESULTS_MIX|DEFENSE_WEIGHT|CONCERN)\b/,
      'platoon.ts': /\b(PLATOON_SHRINK_K|MIN_SPLIT_PA|PROBLEM_EXCESS|COMPLEMENT_MARGIN)\b/,
      'lineupPicture.ts': /\bREGULAR_SHARE\b/,
      'resultsMetrics.ts': /\b(SEASON_WEIGHTS|STABILIZATION|POPULATION_MINIMUM)\b/,
      'roleStanding.ts': /\b(MEANINGFUL_GAP|RESULTS_SAMPLE_MINIMUM)\b/,
      'toolsModel.ts': /\b(HITTER_TOOL_SLOPES|RUNNING_SLOPES)\b/,
      'staffPreference.ts': /\b(TIE_BAND|AGE_GAP_YEARS|UPSIDE_GAP|SKILL_GAP|DEVELOPING_AGE)\b/,
      'lineupShifts.ts': /\bSHIFT_MIN_GAIN\b/,
      'bullpenRoles.ts': /\b(DEPLOYMENT_GAP|LONG_INNINGS|MIN_APPEARANCES)\b/,
      'benchReview.ts': /\bREQUIRED_COVER\b/,
    };
    const files = fs.readdirSync(SERVER).filter((f) => f.endsWith('.ts'));
    for (const [owner, pattern] of Object.entries(owners)) {
      const users = files.filter((f) => f !== owner && pattern.test(fs.readFileSync(path.join(SERVER, f), 'utf8')));
      // other evaluation modules may IMPORT a constant (roleReview uses MEANINGFUL_GAP); none may define one
      for (const f of users) {
        const src = fs.readFileSync(path.join(SERVER, f), 'utf8');
        expect(src, `${f} redefines a constant owned by ${owner}`).not.toMatch(new RegExp(`export const ${pattern.source.replace(/^\\b\(|\)\\b$/g, '').split('|')[0]}\\b`));
      }
    }
  });

  it('the pure evaluation modules open no table and read no rating column: numbers arrive as arguments', () => {
    for (const file of ['toolsModel.ts', 'calibration.ts', 'staffPreference.ts', 'bullpenRoles.ts', 'benchReview.ts', 'lineupShifts.ts', 'platoon.ts', 'resultsMetrics.ts', 'roleReview.ts', 'lineupPicture.ts']) {
      expect(code(file), file).not.toMatch(/from '\.\/db\.js'/);
      expect(code(file), file).not.toMatch(/\.prepare\(/);
    }
  });

  it('the review is read-only and flag-only: nothing in it executes or authorizes a transaction', () => {
    for (const file of ['mlbReview.ts', 'mlbPlans.ts', 'rosterScenario.ts', 'roleReview.ts', 'staffPreference.ts', 'bullpenRoles.ts', 'benchReview.ts', 'lineupShifts.ts']) {
      expect(code(file), file).not.toMatch(/\.run\(|INSERT|UPDATE |DELETE |writeFile/);
    }
  });
});
