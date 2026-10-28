/**
 * No developer or code text on screen (B-01, B-11), through the functions every presenter says it with: a stamp in the
 * GM's words (`stampWords`), a level by its name (`levelWord`), and Payroll's contract cells. The whole served surface is
 * walked by `tests/servedText.test.ts` (every contract fixture) and the contract test (every live `/v2` payload).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { MEASURED_ELSEWHERE, VALUE_POLICY_SAYS, calibrated, policy, provisional } from '../server/calibration.js';
import { getDataStatus } from '../server/dataStatus.js';
import { STAKES_CALIBRATION } from '../server/developmentFit.js';
import { LEVEL_WORDS, UNNAMED_LEVEL, levelWord } from '../server/levelWords.js';
import { computePayroll } from '../server/payroll.js';
import {
  COST_COMBINATION_POLICY_CALIBRATION, PRODUCTION_PRIOR_CALIBRATION, RATINGS_PRIOR_CALIBRATION, SURPLUS_POLICY_CALIBRATION,
  TRADE_COMBINATION_POLICY_CALIBRATION,
} from '../server/playerValueCalibration.js';
import { STAMP_WORDS, cell, stampWords } from '../server/presentation/claim.js';
import { payrollView } from '../server/presentation/finance/payroll.js';
import type { OfficeContext } from '../server/presentation/officeTable.js';
import { SEVERITY_POLICY } from '../server/presentation/severity.js';
import { CODE_TEXT, PROVENANCE, bannedIn, bannedInPayload } from './bannedJargon';
import { buildSave, type BuiltSave } from './syntheticSave';

describe('a stamp in the GM\'s words (B-01)', () => {
  it('never says the developer\'s record of a stamp: the fallback priors, the value policy, the combination rules', () => {
    for (const stamp of [PRODUCTION_PRIOR_CALIBRATION, RATINGS_PRIOR_CALIBRATION, SURPLUS_POLICY_CALIBRATION, COST_COMBINATION_POLICY_CALIBRATION,
      TRADE_COMBINATION_POLICY_CALIBRATION, ...Object.values(SEVERITY_POLICY), ...STAKES_CALIBRATION.map((c) => c.stamp)]) {
      const said = stampWords(stamp);
      expect(bannedIn(said, [PROVENANCE, CODE_TEXT]), said).toEqual([]);
      expect(said).not.toBe(stamp.basis);
      expect(said.length).toBeLessThan(120);
    }
    // The prior's record names the developer's save, its file and its command; what is said names none of them
    expect(bannedIn(PRODUCTION_PRIOR_CALIBRATION.basis, [PROVENANCE])).not.toEqual([]);
    expect(stampWords(PRODUCTION_PRIOR_CALIBRATION)).toMatch(/starting values/);
  });

  it('says whether a number is measured on this save, a starting value or a stated line (show the basis, D-053)', () => {
    expect(stampWords({ status: 'calibrated', run: 'value_production_fits 12, fitted at game date 2040-5-6 (production-3h.2)' })).toBe(STAMP_WORDS.measuredHere);
    expect(stampWords(calibrated('scripts/calibrate.ts on the 2026-05-16 Arizona save'))).toBe(MEASURED_ELSEWHERE);
    expect(stampWords(provisional('Fitted by `npm run calibrate` on the Arizona historical save (league 203)'))).toBe(STAMP_WORDS.starting);
    expect(stampWords(policy('Owner decision (2026-09-24), Q-3'))).toBe(STAMP_WORDS.stated);
    expect(stampWords(policy('Owner decision (2026-09-24), Q-3', 'A season further out counts 5% less'))).toBe('A season further out counts 5% less');
    // The pages that state a value policy without reading the value modules say the stamp's own line
    expect(stampWords(SURPLUS_POLICY_CALIBRATION)).toBe(VALUE_POLICY_SAYS.surplus);
    expect(stampWords(COST_COMBINATION_POLICY_CALIBRATION)).toBe(VALUE_POLICY_SAYS.clubRange);
  });

  it('serves the farm\'s stakes lines by what they are, never their constant\'s name or a quantile code', () => {
    for (const c of STAKES_CALIBRATION) expect(bannedIn(`${c.what} ${typeof c.value === 'string' ? c.value : ''}`, [PROVENANCE, CODE_TEXT]), c.name).toEqual([]);
  });
});

describe('a level by its name (B-11)', () => {
  it('names every level the table knows, and never shows an id', () => {
    expect(levelWord(1)).toBe('Majors');
    expect(levelWord(2)).toBe('Triple-A');
    expect(levelWord(6)).toBe('Rookie ball');
    expect(levelWord(9)).toBe(UNNAMED_LEVEL);
    expect(levelWord(null)).toBe('level not known');
    for (const n of [1, ...Object.keys(LEVEL_WORDS).map(Number), 7, 8, 11, null]) expect(bannedIn(`Season line (44 PA, ${levelWord(n)})`, [CODE_TEXT])).toEqual([]);
  });
});

describe('Payroll\'s contract cells (B-11, OFF-14)', () => {
  let save: BuiltSave;
  beforeAll(() => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true, minors: true });
  }, 120_000);

  const ctx = (): OfficeContext => ({
    orgId: save.org, importStamp: null, reportStamp: 'r1', gameDate: '2040-7-1', preparedBy: cell('Prepared by the front office'),
    department: 'finance', freshness: { state: 'current', asOf: '2040-07-01', line: null, detail: 'Current.' },
  });

  it('says a projected season whose cost is not known as "Not known", never "Not known projected"', () => {
    const payroll = computePayroll(save.org, getDataStatus());
    // A projected season the export can't price: a projected cost with no range
    const at = payroll.players.flatMap((p, pi) => p.projected.map((c, i) => ({ pi, i, c }))).find((x) => x.c !== null && !payroll.players[x.pi].optionYears.some((o) => o.season === payroll.years[x.i] && !o.committed));
    expect(at, 'a projected season to make unknown').toBeTruthy();
    const players = payroll.players.map((p, pi) => (pi !== at!.pi ? p : {
      ...p, projected: p.projected.map((c, i) => (i !== at!.i || c === null ? c : { ...c, low: null, high: null, central: null })),
    }));
    const view = payrollView(ctx(), { payroll: { ...payroll, players } as typeof payroll, club: null, league: null, history: [] });
    const shown = view.contracts.rows.flatMap((r) => Object.values(r.cells).map((c) => c.display));
    expect(shown.filter((d) => /Not known projected/.test(d))).toEqual([]);
    expect(shown).toContain('Not known');
    expect(bannedInPayload(view.contracts)).toEqual([]);
  });

  it('never serves a finance column as where a figure comes from', () => {
    const payroll = computePayroll(save.org, getDataStatus());
    const view = payrollView(ctx(), { payroll, club: null, league: null, history: [] });
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/team_financials|team_history_financials|rules_\w+/);
  });
});
