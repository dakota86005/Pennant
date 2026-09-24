import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clearProductionCaches, leagueFinances, leaguePlayerValues, payrollValuations, playerSurplus, playerValue, surplusMarketFrom, surplusOf,
  type PlayerValuation,
} from '../server/playerValue.js';
import { buildSave, insert, type BuiltSave, type SaveSpec } from './syntheticSave';
import request from './request';

/*
 * Player Value's metamorphic invariants (BEHAVIOR_CASES.md "Player Value", phase 0 rows, built in phase 5a for
 * the surplus): one valuation whichever read asks; an unrelated player changes nobody else's value, and a market
 * contract changes another's only through the league price of a win; value and the protection tier never read
 * each other. Built on a synthetic save (`tests/syntheticSave.ts`); no case names a player or a figure.
 */

const SLOW = 120_000;
const spec: SaveSpec = { season: 2040, historySeasons: 6, gamesPerTeam: 162, playedShare: 0.4, clubs: 8, minors: true, seed: 7 };

/** Every held player's surplus, as the league-wide read serves it. */
const surpluses = (values: Map<number, PlayerValuation>) => new Map([...values].map(([id, v]) => [id, JSON.stringify(v.surplus)]));

/** A player with no line anywhere, added to the export as it stands (a new id, above the save's). */
function addPlayer(save: BuiltSave, id: number, over: { team: number; org: number; major: boolean; salary: number; serviceDays: number }): number {
  insert('players', {
    player_id: id, first_name: 'Added', last_name: `${id}`, age: 31, position: 3, role: 0, bats: 1, throws: 1, uniform_number: 1,
    team_id: over.team, organization_id: over.org, retired: 0, hidden: 0, draft_eligible: 0, college: 0,
    league_id: over.team === 0 ? 0 : over.team >= 100 ? save.aaaLeagueId : save.leagueId, date_of_birth: '2009-5-5',
  });
  if (over.team !== 0) {
    insert('players_roster_status', {
      player_id: id, is_active: over.major ? 1 : 0, is_on_dl: 0, is_on_dl60: 0, is_on_secondary: over.major ? 1 : 0,
      mlb_service_years: Math.floor(over.serviceDays / 172), mlb_service_days: over.serviceDays, mlb_service_days_this_year: 0,
      options_used: 0, options_used_this_year: 0, years_protected_from_rule_5: 0, pro_service_years: 8, pro_service_days: 0,
    });
    insert('players_contract', {
      player_id: id, team_id: over.team, contract_team_id: over.team, season_year: spec.season, years: 1, current_year: 0,
      is_major: over.major ? 1 : 0, retained: 0, no_trade: 0, last_year_team_option: 0, last_year_player_option: 0, last_year_vesting_option: 0,
      salary0: over.salary,
    });
    insert('team_roster', { team_id: over.team, player_id: id, list_id: over.major ? 1 : 2 });
  }
  clearProductionCaches();
  return id;
}

describe('one valuation, whichever read asks', () => {
  it('the card\'s route, the one-player read, Payroll\'s players and the league-wide read give the same surplus', async () => {
    const save = buildSave(spec);
    const league = leaguePlayerValues();
    const payroll = payrollValuations(save.org);
    let valued = 0;
    for (const id of [save.regular, save.reliever, ...save.hitters.slice(1, 6), ...save.pitchers.slice(0, 4), ...save.prospects.slice(0, 2)]) {
      const wide = league.get(id)?.surplus;
      expect(wide, `player ${id}`).toBeDefined();
      if (wide?.status === 'valued') valued += 1;
      expect(playerSurplus(id)).toEqual(wide);
      expect(playerValue(id)?.surplus).toEqual(wide);
      if (payroll.has(id)) expect(payroll.get(id)?.surplus).toEqual(wide);
      expect(await request(`/api/player-value/${id}/surplus`)).toEqual(JSON.parse(JSON.stringify(wide)));
    }
    expect(valued).toBeGreaterThan(5);
  }, SLOW);
});

describe('an unrelated player changes nobody else\'s value', () => {
  it('adding a player no club holds, or a minor leaguer on a minor-league deal, changes no other player\'s surplus', () => {
    const save = buildSave(spec);
    const before = surpluses(leaguePlayerValues());
    const price = leagueFinances(save.leagueId).priceOfWin.price.value;
    const unsigned = addPlayer(save, 90_001, { team: 0, org: 0, major: false, salary: 0, serviceDays: 0 });
    const farmhand = addPlayer(save, 90_002, { team: save.farmClubs[0], org: save.farmClubs[0] - 100, major: false, salary: 0, serviceDays: 0 });
    const after = surpluses(leaguePlayerValues());
    expect(leagueFinances(save.leagueId).priceOfWin.price.value).toEqual(price);
    for (const [id, s] of before) expect(after.get(id), `player ${id}`).toBe(s);
    expect(after.has(unsigned) || after.has(farmhand)).toBe(true);
  }, SLOW);

  it('a market contract added changes another\'s surplus only through the league price of a win, and then by the price alone', () => {
    const save = buildSave(spec);
    const beforeValues = leaguePlayerValues();
    const beforePrice = leagueFinances(save.leagueId).priceOfWin.price.value;
    addPlayer(save, 90_003, { team: save.clubs[1], org: save.clubs[1], major: true, salary: 60_000_000, serviceDays: 9 * 172 });
    const afterValues = leaguePlayerValues();
    const afterFinances = leagueFinances(save.leagueId);
    expect(afterFinances.priceOfWin.price.value, 'the added market contract moved the price').not.toEqual(beforePrice);
    const afterMarket = surplusMarketFrom(afterFinances);
    let compared = 0;
    for (const [id, before] of beforeValues) {
      const after = afterValues.get(id)!;
      // Production is the player's own; nothing about him changed
      expect(JSON.stringify(after.production), `player ${id}`).toBe(JSON.stringify(before.production));
      if (!before.surplus || before.control.standing !== 'held') continue;
      // His surplus is the pure surplus of his own answers at the new price: nothing else entered
      expect(after.surplus, `player ${id}`).toEqual(surplusOf({
        production: after.production, control: after.control, majorLeagueDeal: after.contract.kind.value === null ? null : after.contract.kind.value === 'major_league',
        market: afterMarket, fortyMan: after.surplus!.fortyMan.onFortyMan,
      }));
      // Where his cost did not move with the price (every season the save's own line or a contract), only the price moved his surplus
      if (JSON.stringify(after.control) === JSON.stringify(before.control)) {
        expect(JSON.stringify(surplusOf({
          production: before.production, control: before.control, majorLeagueDeal: after.contract.kind.value === null ? null : after.contract.kind.value === 'major_league',
          market: afterMarket, fortyMan: before.surplus.fortyMan.onFortyMan,
        }))).toBe(JSON.stringify(after.surplus));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(20);
  }, SLOW);
});

describe('value and the protection tier never read each other', () => {
  const SERVER = path.join(process.cwd(), 'server');
  const code = (file: string) => fs.readFileSync(path.join(SERVER, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const valueModules = fs.readdirSync(SERVER).filter((f) => /^playerValue[A-Za-z]*\.ts$/.test(f));

  it('no value module reads the tier or defensibility', () => {
    expect(valueModules).toContain('playerValueSurplus.ts');
    for (const file of valueModules) {
      expect(code(file), file).not.toMatch(/from '\.\/(developmentFit|developmentalContext|prospectDecision|destinationFit|mlbAssignmentContext)\.js'/);
      expect(code(file), file).not.toMatch(/\bprotectionTier\b|\bevaluateDevelopmentProtection\b/);
    }
  });

  it('the tier reads no value: neither the evaluator nor its reader reaches Player Value or names a surplus', () => {
    for (const file of ['developmentFit.ts', 'developmentalContext.ts']) {
      expect(code(file), file).not.toMatch(/from '\.\/playerValue[A-Za-z]*\.js'/);
      expect(code(file), file).not.toMatch(/\bsurplus\b|\bretention margin\b|priceOfWin/i);
    }
  });
});
