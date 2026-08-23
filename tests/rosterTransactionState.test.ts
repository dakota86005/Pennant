import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import {
  evaluateRosterAction,
  organizationRosterTransactionState,
  playerRosterState,
} from '../server/rosterTransactionState.js';
import { playerRosterEventHistory } from '../server/transactionHistory.js';
import { IDS } from './fixture';

let activeCount = 0;
let fortyCount = 0;

beforeAll(() => {
  // The base fixture deliberately predates several optional OOTP columns. Add
  // the established fields here so this suite can test both known and unknown
  // states without making every older-schema test pretend they always exist.
  db.exec(`
    ALTER TABLE leagues ADD COLUMN rules_active_roster_limit INTEGER;
    ALTER TABLE leagues ADD COLUMN rules_secondary_roster_limit INTEGER;
    ALTER TABLE players_roster_status ADD COLUMN options_used INTEGER;
    ALTER TABLE players_roster_status ADD COLUMN options_used_this_year INTEGER;
    ALTER TABLE players_roster_status ADD COLUMN pro_service_years REAL;
    ALTER TABLE players_roster_status ADD COLUMN pro_service_days REAL;
    ALTER TABLE players_roster_status ADD COLUMN years_protected_from_rule_5 INTEGER;
    ALTER TABLE players_roster_status ADD COLUMN days_on_waivers_left INTEGER;
    ALTER TABLE players_roster_status ADD COLUMN was_traded INTEGER;
  `);
  db.prepare('UPDATE players_roster_status SET is_on_secondary = 0 WHERE player_id = ?').run(IDS.minorDeal);
  activeCount = Number((db.prepare(
    'SELECT COUNT(*) AS n FROM players_roster_status rs JOIN players p ON p.player_id = rs.player_id WHERE p.organization_id = ? AND rs.is_active = 1'
  ).get(IDS.mlbTeam) as { n: number }).n);
  fortyCount = Number((db.prepare(
    `SELECT COUNT(*) AS n FROM players_roster_status rs JOIN players p ON p.player_id = rs.player_id
     WHERE p.organization_id = ? AND (rs.is_active = 1 OR rs.is_on_secondary = 1 OR rs.is_on_dl = 1 OR rs.is_on_dl60 = 1)`
  ).get(IDS.mlbTeam) as { n: number }).n);
  db.prepare('UPDATE leagues SET rules_active_roster_limit = ?, rules_secondary_roster_limit = ? WHERE league_id = ?')
    .run(activeCount + 1, fortyCount + 1, IDS.league);
  db.prepare('UPDATE players_roster_status SET options_used = 2, options_used_this_year = 1, pro_service_years = 3.5, pro_service_days = 600, years_protected_from_rule_5 = 1');
});

afterAll(() => {
  db.prepare('UPDATE players_roster_status SET is_on_secondary = 1 WHERE player_id = ?').run(IDS.minorDeal);
  for (const column of ['was_traded', 'days_on_waivers_left', 'years_protected_from_rule_5', 'pro_service_days', 'pro_service_years', 'options_used_this_year', 'options_used']) {
    db.exec(`ALTER TABLE players_roster_status DROP COLUMN "${column}"`);
  }
  db.exec('ALTER TABLE leagues DROP COLUMN rules_secondary_roster_limit');
  db.exec('ALTER TABLE leagues DROP COLUMN rules_active_roster_limit');
});

describe('shared roster and transaction state', () => {
  it('normalizes active, 40-man, minor-league, IL, DFA, and waiver states', () => {
    db.prepare('UPDATE players_roster_status SET is_on_dl = 0, is_on_dl60 = 1 WHERE player_id = ?').run(IDS.injured);
    db.prepare('UPDATE players_roster_status SET designated_for_assignment = 1 WHERE player_id = ?').run(IDS.starter);
    db.prepare('UPDATE players_roster_status SET is_on_waivers = 1, days_on_waivers_left = 3 WHERE player_id = ?').run(IDS.extended);
    try {
      const active = playerRosterState(IDS.starter);
      const fortyManMinor = playerRosterState(IDS.optioned);
      const nonFortyManMinor = playerRosterState(IDS.minorDeal);
      const il60 = playerRosterState(IDS.injured);
      const waiver = playerRosterState(IDS.extended);

      expect(active).toMatchObject({ activeMlb: true, fortyMan: true, transaction: { designatedForAssignment: true } });
      expect(fortyManMinor).toMatchObject({ activeMlb: false, fortyMan: true, teamLevel: 2 });
      expect(nonFortyManMinor).toMatchObject({ activeMlb: false, fortyMan: false, teamLevel: 2 });
      expect(il60).toMatchObject({ transaction: { onIl60: true }, health: { status: 'IL-60', playable: false } });
      expect(waiver).toMatchObject({ transaction: { onWaivers: true, daysOnWaiversLeft: 3 }, standing: { label: 'Waivers' } });
    } finally {
      db.prepare('UPDATE players_roster_status SET is_on_dl = 1, is_on_dl60 = 0 WHERE player_id = ?').run(IDS.injured);
      db.prepare('UPDATE players_roster_status SET designated_for_assignment = 0 WHERE player_id = ?').run(IDS.starter);
      db.prepare('UPDATE players_roster_status SET is_on_waivers = 0, days_on_waivers_left = NULL WHERE player_id = ?').run(IDS.extended);
    }
  });

  it('distinguishes an available recall from one requiring corresponding roster moves', () => {
    const open = evaluateRosterAction(IDS.mlbTeam, IDS.minorDeal, 'recall');
    expect(open.result).toBe('eligible');
    expect(open.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'forty_man_addition', status: 'required' }),
      expect.objectContaining({ kind: 'forty_man_roster_move', status: 'not_required' }),
      expect.objectContaining({ kind: 'active_roster_move', status: 'not_required' }),
    ]));

    db.prepare('UPDATE leagues SET rules_active_roster_limit = ?, rules_secondary_roster_limit = ? WHERE league_id = ?')
      .run(activeCount, fortyCount, IDS.league);
    try {
      const full = evaluateRosterAction(IDS.mlbTeam, IDS.minorDeal, 'recall');
      expect(full.result).toBe('eligible');
      expect(full.requirements).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'active_roster_move', status: 'required' }),
        expect.objectContaining({ kind: 'forty_man_roster_move', status: 'required' }),
      ]));
    } finally {
      db.prepare('UPDATE leagues SET rules_active_roster_limit = ?, rules_secondary_roster_limit = ? WHERE league_id = ?')
        .run(activeCount + 1, fortyCount + 1, IDS.league);
    }
  });

  it('returns an indeterminate option result until a definite out-of-options state is exported', () => {
    expect(evaluateRosterAction(IDS.mlbTeam, IDS.starter, 'option')).toMatchObject({ result: 'indeterminate' });
    db.prepare('UPDATE players_roster_status SET options_used = 3 WHERE player_id = ?').run(IDS.starter);
    try {
      const out = evaluateRosterAction(IDS.mlbTeam, IDS.starter, 'option');
      expect(out).toMatchObject({ result: 'ineligible' });
      expect(out.requirements).toEqual([expect.objectContaining({ kind: 'waiver_clearance', status: 'required' })]);
    } finally {
      db.prepare('UPDATE players_roster_status SET options_used = 2 WHERE player_id = ?').run(IDS.starter);
    }
  });

  it('rejects actions for a player outside the organization and reports schema-limited capacity as unknown', () => {
    expect(evaluateRosterAction(IDS.mlbTeam, IDS.tradedAway, 'recall')).toMatchObject({ result: 'ineligible' });
    const context = organizationRosterTransactionState(IDS.mlbTeam);
    expect(context.capacity).toMatchObject({ active: { count: activeCount, limit: activeCount + 1, openSlots: 1 } });
    expect(playerRosterState(IDS.optioned)?.transaction.daysOnWaiversLeft).toBeNull();
  });

  it('labels missing optional transaction columns instead of inventing their values', () => {
    db.exec('ALTER TABLE players_roster_status DROP COLUMN days_on_waivers_left');
    try {
      const state = playerRosterState(IDS.optioned);
      expect(state?.transaction.daysOnWaiversLeft).toBeNull();
      expect(state?.unknowns).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'missing_transaction_status_columns' }),
      ]));
    } finally {
      db.exec('ALTER TABLE players_roster_status ADD COLUMN days_on_waivers_left INTEGER');
    }
  });

  it('reads only explicit trade and injury event records, not inferred roster changes', () => {
    db.exec(`CREATE TABLE trade_history (date TEXT, summary TEXT, message_id INTEGER, team_id_0 INTEGER, team_id_1 INTEGER, player_id_0_0 INTEGER)`);
    db.prepare('INSERT INTO trade_history VALUES (?, ?, ?, ?, ?, ?)').run('2030-06-01', 'Test trade', 12, IDS.mlbTeam, IDS.otherMlbTeam, IDS.starter);
    db.exec(`CREATE TABLE players_injury_history (player_id INTEGER, date TEXT, length INTEGER, setbacks INTEGER, day_to_day INTEGER, effect INTEGER, body_part TEXT)`);
    db.prepare('INSERT INTO players_injury_history VALUES (?, ?, ?, ?, ?, ?, ?)').run(IDS.starter, '2030-05-01', 10, 0, 0, 1, 'elbow');
    try {
      expect(playerRosterEventHistory(IDS.starter)).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'trade', source: 'trade_history', date: '2030-06-01' }),
        expect.objectContaining({ kind: 'injury', source: 'players_injury_history', date: '2030-05-01' }),
      ]));
    } finally {
      db.exec('DROP TABLE trade_history');
      db.exec('DROP TABLE players_injury_history');
    }
  });
});
