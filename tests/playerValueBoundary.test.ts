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
 * Phase 1 built contract facts and control; phase 2 Club Finances, the opening price of a win and
 * the per-import market snapshot; phase 3a expected production from major-league results, fitted
 * per save (D-053). Two modules write, and only to history.db: the market snapshot and the fit
 * store. The allow-lists below grow phase by phase: the imports a value module may make
 * (scoutedEvidence.ts joins in phase 3b, not 3a) and the consumers migrated to the entry point. The
 * `players_value` allow-list in evidenceBoundary.test.ts shrinks as each consumer moves (Part 8).
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

/** What a value module may import in phase 3a: no scoutedEvidence yet (phase 3b), and proneness only through its reader. */
const ALLOWED_IMPORTS = new Set([
  './db.js', './dataFreshness.js', './leagueRules.js', './playerRights.js', './playerState.js', './provenance.js',
  './calibration.js', './playerValue.js', './playerValueCalibration.js', './playerValueContract.js', './playerValueControl.js',
  './playerValueFinances.js', './playerValueHistory.js', './playerValueProduction.js', './playerValueProductionFit.js',
  './playerValueFitStore.js', './injuryProneness.js', './playerValueCone.js',
]);

/** The writers, and the one extra import they alone may make: the history store (Part 7, D-009, D-053). */
const SNAPSHOT_WRITER = 'playerValueSnapshot.ts';
const FIT_STORE = 'playerValueFitStore.ts';
const WRITERS = [FIT_STORE, SNAPSHOT_WRITER];
const WRITER_IMPORTS = new Set(['./history.js']);

/** The production modules (phase 3a). */
const PRODUCTION_MODULES = ['playerValueProduction.ts', 'playerValueProductionFit.ts', 'playerValueHistory.ts', 'playerValueFitStore.ts'];

/** Consumers migrated to the entry point, phase by phase (Part 8). Phase 1: control. Phase 2: club finances. */
const MIGRATED_CONSUMERS = ['contracts.ts', 'payroll.ts', 'trade.ts', 'player.ts', 'freeagents.ts', 'clubFinanceRoutes.ts', 'playerValueRoutes.ts'];

/** Who may call the snapshot writer: the import, and the one route that serves the history. */
const SNAPSHOT_CALLERS = ['api.ts', 'clubFinanceRoutes.ts'];

describe('the Player Value boundary', () => {
  it('finds the value modules', () => {
    expect(VALUE_MODULES).toEqual([
      'playerValue.ts', 'playerValueCalibration.ts', 'playerValueCone.ts', 'playerValueContract.ts', 'playerValueControl.ts',
      'playerValueFinances.ts', 'playerValueFitStore.ts', 'playerValueHistory.ts', 'playerValueProduction.ts',
      'playerValueProductionFit.ts', 'playerValueRoutes.ts', 'playerValueSnapshot.ts',
    ]);
  });

  it.each(VALUE_MODULES)('%s imports only what phase 3a allows', (file) => {
    const outside = importsOf(file).filter((i) => !ALLOWED_IMPORTS.has(i) && !(WRITERS.includes(file) && WRITER_IMPORTS.has(i))
      && !(file === 'playerValueRoutes.ts' && i === './playerValue.js'));
    expect(outside, `${file} imports ${outside.join(', ')}`).toEqual([]);
  });

  it('Club Finances reads no ratings, no players_value and no scouting at all: it needs none', () => {
    for (const file of ['playerValueFinances.ts', 'playerValueSnapshot.ts']) {
      const source = code(file);
      expect(source, file).not.toMatch(/scoutedEvidence|_ratings_|players_value|overall_value|talent_value|valuesByPlayer|mlbPercentiler/);
    }
    // ...and neither does the reader's finance half, nor the route
    expect(code('clubFinanceRoutes.ts')).not.toMatch(/scoutedEvidence|players_value|valuation\.js/);
  });

  it.each(PRODUCTION_MODULES)('%s (production, phase 3a) reads no rating at all: no scoutedEvidence, no rating column, no players_value', (file) => {
    const source = code(file);
    expect(source, file).not.toMatch(/scoutedEvidence|ScoutedAbility|_ratings_|fielding_rating|players_batting\b|players_pitching\b|players_value|overall_value|talent_value/);
    expect(importsOf(file).join(' '), file).not.toMatch(/scoutedEvidence|philosophy|settings|staffPreference|assignmentPreference|developmentFit|developmentalContext|prospectDecision|prospectAssignments|destinationFit/);
  });

  it('injury proneness is read only through its one declared reader (D-053)', () => {
    const readers = fs.readdirSync(SERVER).filter((f) => f.endsWith('.ts') && /prone_(overall|leg|back|arm)/.test(code(f)));
    expect(readers).toEqual(['injuryProneness.ts']);
    // ...schema-tolerant: its columns are selected only where the export has them
    expect(code('injuryProneness.ts')).toMatch(/PRONENESS_COLUMNS\.filter\(\(c\) => present\.has\(c\)\)/);
  });

  it('production\'s fitted numbers come from the save\'s stored fit; the only fitted artefact in code is the provisional prior (D-053)', () => {
    const calibration = code('playerValueCalibration.ts');
    // One ProductionModel in code, stamped provisional
    expect([...calibration.matchAll(/export const ([A-Z_]+): ProductionModel =/g)].map((m) => m[1])).toEqual(['PRODUCTION_PRIOR']);
    expect(calibration).toMatch(/PRODUCTION_PRIOR_CALIBRATION: CalibrationStamp = provisional\(/);
    // The projection and the fit are handed a model; neither reaches for the prior itself
    for (const file of ['playerValueProduction.ts', 'playerValueProductionFit.ts']) expect(code(file), file).not.toMatch(/PRODUCTION_PRIOR\b/);
    // The reader serves the adopted fit from the store, and the prior only when there is none
    const reader = code('playerValue.ts');
    expect(reader).toMatch(/adoptedProductionFit\(leagueId, PRODUCTION_METHOD\)/);
    expect(reader).toMatch(/return \{ model: PRODUCTION_PRIOR, provenance: priorProvenance\(leagueId\) \}/);
    // No other module fits, stores or reads a fit
    for (const file of fs.readdirSync(SERVER).filter((f) => f.endsWith('.ts') && f !== 'playerValue.ts' && f !== FIT_STORE)) {
      expect(code(file), file).not.toMatch(/value_production_fits|recordProductionFit|adoptedProductionFit/);
    }
  });

  it('the refit runs after an import, once, in the background, and can never fail it (D-053)', () => {
    const api = code('api.ts');
    expect(api.match(/refitProductionIfNeeded\(/g) ?? []).toHaveLength(1);
    expect(api).toMatch(/setImmediate\(\(\) => \{\s*try \{\s*for \(const \w+ of refitProductionIfNeeded\(\)\)/);
    // After the import has finished, only when it succeeded
    expect(api).toMatch(/\} finally \{[\s\S]*?importState\.importing = false;[\s\S]*?\}\s*if \(imported\) refitAfterImport\(\);/);
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
    const internals = /from '\.\/(playerValueContract|playerValueControl|playerValueCalibration|playerValueFinances)\.js'/;
    for (const file of fs.readdirSync(SERVER).filter((f) => f.endsWith('.ts') && !VALUE_MODULES.includes(f))) {
      const source = code(file);
      expect(source, `${file} reaches past the entry point`).not.toMatch(internals);
      // Eligibility is asked of Player Rights by the value reader only; nobody else composes a timeline
      if (file !== 'playerRights.ts') expect(source, file).not.toMatch(/evaluateContractControl|composeControlTimeline/);
      // The snapshot writer is reached by the import and the history route only
      if (!SNAPSHOT_CALLERS.includes(file)) expect(source, `${file} reaches the snapshot writer`).not.toMatch(/playerValueSnapshot\.js/);
      // Nobody else prices a win or reads the market's history from history.db
      expect(source, file).not.toMatch(/value_market_snapshots|openingPriceOfWin\(|replacementLevelOf\(/);
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

  it.each(VALUE_MODULES.filter((f) => !WRITERS.includes(f)))('%s writes nothing, and touches no history (7)', (file) => {
    const source = code(file);
    expect(source, file).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE)\b\s+(INTO|TABLE|FROM|INDEX)?/);
    expect(source, file).not.toMatch(/\.exec\(|\.run\(|history\.js|historyDb|writeFileSync/);
  });

  it('only the two writers touch history.db, and neither writes league.db (7)', () => {
    const touching = VALUE_MODULES.filter((f) => /history\.js|historyDb/.test(code(f)));
    expect(touching).toEqual(WRITERS);
    for (const writer of WRITERS) {
      const source = code(writer);
      // Every statement that writes is prepared or executed on historyDb, never on the league's db
      const statements = [...source.matchAll(/(\w+)\.(prepare|exec)\(\s*`([^`]*)`/g)];
      expect(statements.length).toBeGreaterThan(0);
      for (const [, receiver, , sql] of statements) {
        if (/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE)\b/i.test(sql)) expect(receiver, sql.slice(0, 60)).toBe('historyDb');
      }
      expect(source, writer).not.toMatch(/\bdb\.exec\(|writeFileSync|DROP\s+TABLE|ALTER\s+TABLE|DELETE\s+FROM/i);
    }
    // The fit store: additive, keyed by save, league, last completed season and method, idempotent unless forced
    const store = code(FIT_STORE);
    expect(store).toMatch(/CREATE TABLE IF NOT EXISTS value_production_fits/);
    expect(store).toMatch(/PRIMARY KEY \(save_name, league_id, through_season, method\)/);
    expect(store).toMatch(/meta\.force \? 'INSERT OR REPLACE' : 'INSERT OR IGNORE'/);
    const source = code(SNAPSHOT_WRITER);
    // Additive: the table is created only if it is not there, as every history.db table is
    expect(source).toMatch(/CREATE TABLE IF NOT EXISTS value_market_snapshots/);
    // Idempotent per key: the key is the primary key and a second write of it is ignored
    expect(source).toMatch(/PRIMARY KEY \(save_name, league_id, game_date\)/);
    expect(source).toMatch(/INSERT OR IGNORE INTO value_market_snapshots/);
  });

  it('the import records the market once, and a failed snapshot cannot fail the import (7)', () => {
    const api = code('api.ts');
    const calls = api.match(/captureMarketSnapshot\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(api).toMatch(/try \{\s*(const \w+ = )?captureMarketSnapshot\(/);
    // No timer anywhere near it: data changes only on import (D-009)
    for (const file of [...VALUE_MODULES, 'clubFinanceRoutes.ts']) expect(code(file), file).not.toMatch(/setInterval|setTimeout/);
  });

  it('the market is priced from Player Rights\' free-agency answer, never from service time (6)', () => {
    const finances = code('playerValueFinances.ts');
    expect(finances).toMatch(/freeAgency\.status/);
    expect(finances).not.toMatch(/serviceDays|\.service\b|endOfSeason|mlbDays|thresholdDays|lineDays/);
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
    expect(stamps.map((m) => [m[1], m[2]])).toEqual([
      ['CONTROL_HORIZON_CALIBRATION', 'policy'],
      ['MARKET_CONTRACT_CALIBRATION', 'policy'],
      ['OPENING_PRICE_CALIBRATION', 'provisional'],
      ['OPENING_PRICE_CENTRAL_CALIBRATION', 'policy'],
      ['REPLACEMENT_LEVEL_CALIBRATION', 'provisional'],
      ['FINANCE_ROW_CALIBRATION', 'policy'],
      ['PLACEHOLDER_ROW_CALIBRATION', 'policy'],
      ['PRODUCTION_POLICY_CALIBRATION', 'policy'],
      ['PRODUCTION_PRIOR_CALIBRATION', 'provisional'],
    ]);
    // Nothing in code is stamped calibrated for production: a save's fit is stamped by its own run record (D-053)
    expect(calibration).not.toMatch(/\bcalibrated\(/);
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
    // ...and for the financial tables and the WAR tables (R-10: WAR is unguarded elsewhere)
    expect(code('playerValue.ts')).toMatch(/FINANCE_COLUMNS\.filter\(\(c\) => present\.has\(c\)\)/);
    expect(code('playerValue.ts')).toMatch(/WAR_COLUMNS\.filter\(\(c\) => !present\.has\(c\)\)/);
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
