import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Player Value boundary (D-052, docs/PLAYER_VALUE.md Part 10), static, in the family of
 * evidenceBoundary.test.ts, developmentalStakesBoundary.test.ts and farmOperationsBoundary.test.ts.
 *
 * Runtime tests prove today's code honours it; this proves the next change does. It reads the
 * server source with comments stripped, so prose about a column is not mistaken for reading it.
 *
 * Phase 1 builds contract facts and control. The allow-lists below grow phase by phase: the
 * imports a value module may make (scoutedEvidence.ts joins in phase 3, the history snapshot writer
 * in phase 2) and the consumers migrated to the entry point. The `players_value` allow-list in
 * evidenceBoundary.test.ts shrinks as each consumer moves (Part 8).
 */

const SERVER = path.join(process.cwd(), 'server');

const code = (file: string): string =>
  fs
    .readFileSync(path.join(SERVER, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const importsOf = (file: string): string[] => [...code(file).matchAll(/from '(\.\/[^']+)'/g)].map((m) => m[1]);

/** Every Player Value module, found by name so a new one is covered the day it is added. */
const VALUE_MODULES = fs.readdirSync(SERVER).filter((f) => /^playerValue[A-Za-z]*\.ts$/.test(f)).sort();

/** What a value module may import in phase 1. */
const ALLOWED_IMPORTS = new Set([
  './db.js', './dataFreshness.js', './leagueRules.js', './playerRights.js', './playerState.js', './provenance.js',
  './calibration.js', './playerValue.js', './playerValueCalibration.js', './playerValueContract.js', './playerValueControl.js',
]);

/** Consumers migrated to the entry point, phase by phase (Part 8). Phase 1: control. */
const MIGRATED_CONSUMERS = ['contracts.ts', 'payroll.ts', 'trade.ts', 'player.ts', 'freeagents.ts'];

describe('the Player Value boundary', () => {
  it('finds the value modules', () => {
    expect(VALUE_MODULES).toEqual(['playerValue.ts', 'playerValueCalibration.ts', 'playerValueContract.ts', 'playerValueControl.ts']);
  });

  it.each(VALUE_MODULES)('%s imports only what phase 1 allows', (file) => {
    const outside = importsOf(file).filter((i) => !ALLOWED_IMPORTS.has(i));
    expect(outside, `${file} imports ${outside.join(', ')}`).toEqual([]);
  });

  it.each(VALUE_MODULES)('%s reads ratings only through the adapter: no rating column or ratings table (1)', (file) => {
    expect(code(file), file).not.toMatch(/_ratings_|fielding_rating|players_batting|players_pitching|players_fielding/);
  });

  it.each(VALUE_MODULES)('%s names no players_value field (2)', (file) => {
    expect(code(file), file).not.toMatch(
      /players_value|overall_value|talent_value|\boa\b|\bpot\b|oa_rating|pot_rating|valuesByPlayer|mlbPercentiler/
    );
  });

  it('consumers reach value only through the entry point, and compute no cost of their own (3)', () => {
    const internals = /from '\.\/(playerValueContract|playerValueControl|playerValueCalibration)\.js'/;
    for (const file of fs.readdirSync(SERVER).filter((f) => f.endsWith('.ts') && !VALUE_MODULES.includes(f))) {
      const source = code(file);
      expect(source, `${file} reaches past the entry point`).not.toMatch(internals);
      // Eligibility is asked of Player Rights by the value reader only; nobody else composes a timeline
      if (file !== 'playerRights.ts') expect(source, file).not.toMatch(/evaluateContractControl|composeControlTimeline/);
    }
    for (const file of MIGRATED_CONSUMERS) {
      const source = code(file);
      expect(source, `${file} is migrated and must read the entry point`).toMatch(/from '\.\/playerValue\.js'/);
      expect(source, file).not.toMatch(/CostBand|COST_PENDING|priceOfWin|price of a win/i);
      // No service-time arithmetic of its own: that was controlAfterThisSeason's, and Player Rights' now
      expect(source, file).not.toMatch(/service_days\s*\/|serviceDays\s*\/|SERVICE_DAYS_PER_YEAR|serviceRemainingThisSeason/);
    }
  });

  it.each(VALUE_MODULES)('%s puts no philosophy in the neutral path (4)', (file) => {
    expect(importsOf(file).join(' '), file).not.toMatch(/philosophy|settings|staffPreference|assignmentPreference/);
  });

  it.each(VALUE_MODULES)('%s reads no protection tier and no defensibility (5)', (file) => {
    expect(importsOf(file).join(' '), file).not.toMatch(
      /developmentFit|developmentalContext|prospectDecision|prospectAssignments|destinationFit|mlbAssignmentContext|currentAssignment/
    );
  });

  it.each(VALUE_MODULES)('%s rebuilds no right: no option, DFA, waiver or service-threshold reading (6)', (file) => {
    const source = code(file);
    expect(source, file).not.toMatch(
      /options_used|designated_for_assignment|days_on_dfa|is_on_waivers|waiver|rules_fa_minimum_years|rules_salary_arbitration|rules_min_service_days|mlb_service_days|mlb_service_years|has_received_arbitration/
    );
    // It reads eligibility as Player Rights states it, never the thresholds or the service behind it
    expect(source, file).not.toMatch(/\.(freeAgencyYears|arbitrationYears|serviceDaysPerYear|serviceTime)\b/);
  });

  it('only the reader asks Player Rights for eligibility', () => {
    const askers = VALUE_MODULES.filter((f) => /evaluateContractControl\(/.test(code(f)));
    expect(askers).toEqual(['playerValue.ts']);
  });

  it.each(VALUE_MODULES)('%s writes nothing (7)', (file) => {
    const source = code(file);
    expect(source, file).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE)\b\s+(INTO|TABLE|FROM|INDEX)?/);
    expect(source, file).not.toMatch(/\.exec\(|\.run\(|history\.js|historyDb|writeFileSync/);
  });

  it('every constant is declared once, stamped, in the calibration module (8)', () => {
    const numeric = /^\s*(export\s+)?const\s+[A-Z][A-Z0-9_]*\s*(:\s*number\s*)?=\s*-?\d/m;
    for (const file of VALUE_MODULES.filter((f) => f !== 'playerValueCalibration.ts')) {
      expect(code(file), `${file} declares a number of its own`).not.toMatch(numeric);
    }
    const calibration = code('playerValueCalibration.ts');
    const numbers = [...calibration.matchAll(/export const ([A-Z][A-Z0-9_]*)\s*=\s*-?\d/g)].map((m) => m[1]);
    const stamps = [...calibration.matchAll(/export const ([A-Z][A-Z0-9_]*): CalibrationStamp = (calibrated|provisional|policy)\(/g)];
    expect(numbers).toEqual(['CONTROL_HORIZON_SEASONS']);
    expect(stamps.map((m) => [m[1], m[2]])).toEqual([['CONTROL_HORIZON_CALIBRATION', 'policy']]);
    // Declared once: nobody else defines the horizon
    for (const file of fs.readdirSync(SERVER).filter((f) => f.endsWith('.ts') && f !== 'playerValueCalibration.ts')) {
      expect(code(file), file).not.toMatch(/const CONTROL_HORIZON_SEASONS\b/);
    }
  });

  it('reads every contract and rule column through a column check (9)', () => {
    for (const file of [...VALUE_MODULES, 'leagueRules.ts']) {
      expect(code(file), `${file} selects columns it has not checked`).not.toMatch(/SELECT\s+\*/i);
    }
    // The reader selects only the columns the export has, for the contract tables and the leagues table
    expect(code('playerValue.ts')).toMatch(/wanted\.filter\(\(c\) => present\.has\(c\)\)/);
    expect(code('leagueRules.ts')).toMatch(/COLUMNS\.filter\(\(c\) => present\.has\(c\)\)/);
  });
});

describe('one LeagueRules (Part 9, phase 1)', () => {
  const RULE_COLUMNS = /rules_fa_minimum_years|rules_salary_arbitration_minimum_years|rules_min_service_days|rules_minimum_salary|financial_coefficient|rules_financials|rules_minor_league_fa_minimum_years/;

  it('only leagueRules.ts reads the contract rules from the export', () => {
    // A read is a query naming the column; a column named in a message or a source label is not one
    const queries = (source: string): string[] => (source.match(/`[^`]*`/g) ?? []).filter((t) => /\bSELECT\b/i.test(t));
    const readers = fs.readdirSync(SERVER)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => queries(code(f)).some((q) => RULE_COLUMNS.test(q)) || (f !== 'leagueRules.ts' && /\[[^\]]*'rules_fa_minimum_years'/.test(code(f))));
    expect(readers).toEqual([]);
    // leagueRules.ts reads them from its declared column list, filtered by what the export has
    expect(code('leagueRules.ts')).toMatch(/'rules_fa_minimum_years', 'rules_salary_arbitration_minimum_years'/);
  });

  it('no module declares a LeagueRules of its own, or assumes six, three or 172', () => {
    /*
     * One declaration is allowed: MLB's contract regime in playerRights.ts, which a league's rules as
     * READ are compared against to decide whether Super Two applies (owner, 2026-09-22). It is never
     * used in place of a league's own rule.
     */
    const REGIME = /export const MLB_CONTRACT_REGIME = \{ freeAgencyYears: 6, arbitrationYears: 3, serviceDaysPerYear: 172 \} as const;/;
    expect(code('playerRights.ts')).toMatch(REGIME);
    for (const file of fs.readdirSync(SERVER).filter((f) => f.endsWith('.ts'))) {
      const source = code(file).replace(REGIME, '');
      if (file !== 'leagueRules.ts') expect(source, file).not.toMatch(/interface LeagueRules\b|function leagueRules\(/);
      expect(source, file).not.toMatch(/\b172\b|SERVICE_DAYS_PER_YEAR|faMinYears|arbMinYears|MLB_CONTRACT_REGIME\s*=/);
    }
    // ...and only the Super Two regime check reads it
    const uses = fs.readdirSync(SERVER).filter((f) => f.endsWith('.ts') && /MLB_CONTRACT_REGIME\./.test(code(f)));
    expect(uses).toEqual(['playerRights.ts']);
  });
});
