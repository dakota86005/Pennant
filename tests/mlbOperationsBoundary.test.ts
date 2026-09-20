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

const MLB = ['mlbRoster.ts', 'mlbNeeds.ts', 'mlbResponses.ts', 'mlbEvidence.ts', 'mlbOperations.ts'];
/** The pure core: no database access at all. */
const PURE = ['mlbRoster.ts', 'mlbNeeds.ts', 'mlbResponses.ts'];

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
      'scoutedEvidence.ts', 'minorLeagueRoster.ts', 'minorLeagueMoves.ts', 'minorLeaguePitchingOperations.ts', 'minorLeagueRetention.ts'];
    for (const file of upstream) expect(code(file), file).not.toMatch(/from '\.\/mlb[A-Z]/);
  });

  it('never selects or ranks by philosophy: responses order by path, level and name only', () => {
    const source = code('mlbResponses.ts');
    // philosophy only annotates the stage; sorting uses PATH_ORDER, level and name
    expect(source).toMatch(/PATH_ORDER\[a\.pathKind\] - PATH_ORDER\[b\.pathKind\]/);
    expect(source).not.toMatch(/sort\([^)]*stance/);
  });
});
