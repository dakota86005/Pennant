import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { historyDb } from '../server/history.js';
import { majorLeagueReactiveNeeds } from '../server/majorLeagueOperations.js';
import { assembleInternalResponders } from '../server/majorLeagueResponders.js';
import { captureRosterStateSnapshot } from '../server/rosterStateHistory.js';
import { IDS } from './fixture';

const SAVE_NAME = 'unknown';
const ADDED_PLAYER_START = 990_000;

let originalRoster: Array<Record<string, number>> = [];
let originalPlayers: Array<Record<string, number>> = [];

function dropActiveRosterLimit(): void {
  const columns = db.pragma('table_info(leagues)') as Array<{ name: string }>;
  if (columns.some((column) => column.name === 'rules_active_roster_limit')) {
    db.exec('ALTER TABLE leagues DROP COLUMN rules_active_roster_limit');
  }
}

function clearRosterHistory(): void {
  historyDb.prepare(
    `DELETE FROM roster_state_transitions WHERE snapshot_id IN
       (SELECT id FROM roster_state_snapshots WHERE save_name = ?)`
  ).run(SAVE_NAME);
  historyDb.prepare(
    `DELETE FROM roster_state_snapshot_players WHERE snapshot_id IN
       (SELECT id FROM roster_state_snapshots WHERE save_name = ?)`
  ).run(SAVE_NAME);
  historyDb.prepare('DELETE FROM roster_state_snapshots WHERE save_name = ?').run(SAVE_NAME);
}

function captureLoss(playerId: number, change: () => void): void {
  expect(captureRosterStateSnapshot().status).toBe('created');
  change();
  db.prepare('UPDATE leagues SET "current_date" = ? WHERE league_id = ?').run('2030-06-02', IDS.league);
  expect(captureRosterStateSnapshot().status).toBe('created');
}

function removeOtherActiveAt(position: number, except: number): void {
  db.prepare(
    `UPDATE players_roster_status SET is_active = 0
     WHERE player_id IN (
       SELECT player_id FROM players WHERE organization_id = ? AND position = ? AND player_id <> ?
     )`
  ).run(IDS.mlbTeam, position, except);
}

beforeEach(() => {
  dropActiveRosterLimit();
  clearRosterHistory();
  db.exec('DROP TABLE IF EXISTS trade_history');
  db.exec('DROP TABLE IF EXISTS players_injury_history');
  db.exec('DROP TABLE IF EXISTS players_value');
  db.exec('DROP TABLE IF EXISTS roster_need_test_limits');
  db.prepare('UPDATE leagues SET "current_date" = ? WHERE league_id = ?').run('2030-06-01', IDS.league);
  originalRoster = db.prepare(
    `SELECT player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary,
            designated_for_assignment, is_on_waivers
     FROM players_roster_status`
  ).all() as Array<Record<string, number>>;
  originalPlayers = db.prepare(
    `SELECT player_id, team_id, organization_id, position, role,
            injury_is_injured, injury_dtd_injury, injury_left FROM players`
  ).all() as Array<Record<string, number>>;
});

afterEach(() => {
  dropActiveRosterLimit();
  for (const row of originalRoster) {
    db.prepare(
      `UPDATE players_roster_status
       SET is_active = ?, is_on_dl = ?, is_on_dl60 = ?, is_on_secondary = ?,
           designated_for_assignment = ?, is_on_waivers = ?
       WHERE player_id = ?`
    ).run(
      row.is_active, row.is_on_dl, row.is_on_dl60, row.is_on_secondary,
      row.designated_for_assignment, row.is_on_waivers, row.player_id
    );
  }
  for (const row of originalPlayers) {
    db.prepare(
      `UPDATE players SET team_id = ?, organization_id = ?, position = ?, role = ?,
                          injury_is_injured = ?, injury_dtd_injury = ?, injury_left = ?
       WHERE player_id = ?`
    ).run(
      row.team_id, row.organization_id, row.position, row.role,
      row.injury_is_injured, row.injury_dtd_injury, row.injury_left, row.player_id
    );
  }
  db.prepare('DELETE FROM players_roster_status WHERE player_id >= ?').run(ADDED_PLAYER_START);
  db.prepare('DELETE FROM players WHERE player_id >= ?').run(ADDED_PLAYER_START);
  db.exec('DROP TABLE IF EXISTS trade_history');
  db.exec('DROP TABLE IF EXISTS players_injury_history');
  db.exec('DROP TABLE IF EXISTS players_value');
  db.prepare('UPDATE leagues SET "current_date" = ? WHERE league_id = ?').run('2030-06-01', IDS.league);
  clearRosterHistory();
});

describe('causal MLB need detection', () => {
  it('reports a factual 25/26 active-roster opening and not a full roster', () => {
    const currentActive = Number((db.prepare(
      `SELECT COUNT(*) AS n FROM players_roster_status rs
       JOIN players p ON p.player_id = rs.player_id
       WHERE p.organization_id = ? AND rs.is_active = 1`
    ).get(IDS.mlbTeam) as { n: number }).n);
    const player = db.prepare(
      `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws,
                            uniform_number, team_id, organization_id, retired, hidden, draft_eligible, college)
       VALUES (?, 'Need', 'Fixture', 25, 7, 0, 1, 1, 0, ?, ?, 0, 0, 0, 0)`
    );
    const status = db.prepare(
      `INSERT INTO players_roster_status
       (player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary, mlb_service_years, mlb_service_days, mlb_service_days_this_year)
       VALUES (?, 1, 0, 0, 1, 0, 0, 0)`
    );
    for (let offset = 0; offset < 25 - currentActive; offset += 1) {
      const id = ADDED_PLAYER_START + offset;
      player.run(id, IDS.mlbTeam, IDS.mlbTeam);
      status.run(id);
    }
    db.exec('ALTER TABLE leagues ADD COLUMN rules_active_roster_limit INTEGER');
    db.prepare('UPDATE leagues SET rules_active_roster_limit = 26 WHERE league_id = ?').run(IDS.league);
    expect(majorLeagueReactiveNeeds(IDS.mlbTeam).needs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'active_roster_capacity',
        evidence: expect.arrayContaining([expect.objectContaining({ details: { activeRosterCount: 25, activeRosterLimit: 26 } })]),
      }),
    ]));
    db.prepare('UPDATE leagues SET rules_active_roster_limit = 25 WHERE league_id = ?').run(IDS.league);
    expect(majorLeagueReactiveNeeds(IDS.mlbTeam).needs.some((need) => need.category === 'active_roster_capacity')).toBe(false);
  });

  it('creates a temporary, corroborated starting-pitcher coverage need after an IL loss', () => {
    db.prepare('UPDATE players SET position = 1, role = 11 WHERE player_id = ?').run(IDS.starter);
    removeOtherActiveAt(1, IDS.starter);
    db.exec('CREATE TABLE players_injury_history (player_id INTEGER, date TEXT, length INTEGER, setbacks INTEGER, day_to_day INTEGER, effect INTEGER, body_part TEXT)');
    db.prepare('INSERT INTO players_injury_history VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(IDS.starter, '2030-06-02', 18, 0, 0, 3, 'elbow');
    captureLoss(IDS.starter, () => {
      db.prepare('UPDATE players_roster_status SET is_active = 0, is_on_dl = 1 WHERE player_id = ?').run(IDS.starter);
    });
    expect(majorLeagueReactiveNeeds(IDS.mlbTeam).needs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'role_coverage', role: expect.objectContaining({ kind: 'starting_pitcher' }),
        cause: { kind: 'injury', provenance: 'corroborated' },
        horizon: expect.objectContaining({ kind: 'temporary', expectedDays: 18 }),
      }),
    ]));
  });

  it('keeps a causal relief-coverage need beside the roster opening and assembles MLB/AAA responders', () => {
    db.prepare(
      `UPDATE players SET position = 1, role = 12, injury_is_injured = 0,
                          injury_dtd_injury = 0, injury_left = 0
       WHERE player_id = ?`
    ).run(IDS.starter);
    db.prepare('UPDATE players SET position = 1, role = 13 WHERE player_id = ?').run(IDS.extended);

    const aaaDepthId = ADDED_PLAYER_START;
    db.prepare(
      `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws,
                            uniform_number, team_id, organization_id, retired, hidden, draft_eligible, college)
       VALUES (?, 'Veteran', 'Relief Depth', 31, 1, 13, 1, 1, 0, ?, ?, 0, 0, 0, 0)`
    ).run(aaaDepthId, IDS.aaaTeam, IDS.mlbTeam);
    db.prepare(
      `INSERT INTO players_roster_status
       (player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary,
        mlb_service_years, mlb_service_days, mlb_service_days_this_year)
       VALUES (?, 0, 0, 0, 0, 0, 0, 0)`
    ).run(aaaDepthId);

    const baselineActive = Number((db.prepare(
      `SELECT COUNT(*) AS n FROM players_roster_status rs
       JOIN players p ON p.player_id = rs.player_id
       WHERE p.organization_id = ? AND rs.is_active = 1`
    ).get(IDS.mlbTeam) as { n: number }).n);
    db.exec('ALTER TABLE leagues ADD COLUMN rules_active_roster_limit INTEGER');
    db.prepare('UPDATE leagues SET rules_active_roster_limit = ? WHERE league_id = ?').run(baselineActive, IDS.league);

    captureLoss(IDS.starter, () => {
      db.prepare('UPDATE players_roster_status SET is_active = 0, is_on_dl = 1 WHERE player_id = ?').run(IDS.starter);
      db.prepare(
        `UPDATE players SET injury_is_injured = 1, injury_dtd_injury = 0, injury_left = 26
         WHERE player_id = ?`
      ).run(IDS.starter);
    });

    const report = majorLeagueReactiveNeeds(IDS.mlbTeam);
    const reliefNeed = report.needs.find((need) => need.causalPlayer?.playerId === IDS.starter)!;
    expect(report.needs.map((need) => need.category)).toEqual(expect.arrayContaining([
      'active_roster_capacity',
      'role_coverage',
    ]));
    expect(reliefNeed).toMatchObject({
      role: { kind: 'relief_pitcher' },
      cause: { kind: 'injury', provenance: 'corroborated' },
      horizon: { kind: 'temporary', expectedDays: 26 },
      evidence: expect.arrayContaining([
        expect.objectContaining({
          kind: 'current_role_coverage',
          details: expect.objectContaining({ priorCoverageCount: 2, currentCoverageCount: 1 }),
        }),
      ]),
    });

    db.exec(`CREATE TABLE players_value (
      player_id INTEGER, overall_value REAL, talent_value REAL, offensive_value REAL,
      offensive_value_vsl REAL, offensive_value_vsr REAL, pitching_value REAL,
      oa_rating REAL, pot_rating REAL, oa REAL, pot REAL
    )`);
    const responders = assembleInternalResponders(reliefNeed);
    expect(responders.activeRosterResponders).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: IDS.extended }),
    ]));
    expect(responders.minorLeagueCallUpResponders).toEqual(expect.arrayContaining([
      expect.objectContaining({
        playerId: aaaDepthId,
        development: expect.objectContaining({ status: 'not_applicable' }),
        transactionContext: expect.objectContaining({ fortyMan: false }),
      }),
    ]));

  });

  it('does not create a need from injury history without an observed availability loss', () => {
    db.exec('CREATE TABLE players_injury_history (player_id INTEGER, date TEXT, length INTEGER)');
    db.prepare('INSERT INTO players_injury_history VALUES (?, ?, ?)').run(IDS.starter, '2030-06-02', 10);
    expect(captureRosterStateSnapshot().status).toBe('created');
    db.prepare('UPDATE leagues SET "current_date" = ? WHERE league_id = ?').run('2030-06-02', IDS.league);
    expect(captureRosterStateSnapshot().status).toBe('created');
    expect(majorLeagueReactiveNeeds(IDS.mlbTeam).needs.some((need) => need.cause?.kind === 'injury')).toBe(false);
  });

  it('keeps a matching trade vacancy structural until current role coverage is restored', () => {
    const position = Number((db.prepare('SELECT position AS value FROM players WHERE player_id = ?').get(IDS.starter) as { value: number }).value);
    removeOtherActiveAt(position, IDS.starter);
    db.exec('CREATE TABLE trade_history (date TEXT, summary TEXT, message_id INTEGER, team_id_0 INTEGER, team_id_1 INTEGER, player_id_0_0 INTEGER)');
    db.prepare('INSERT INTO trade_history VALUES (?, ?, ?, ?, ?, ?)')
      .run('2030-06-02', 'Test departure', 31, IDS.mlbTeam, IDS.otherMlbTeam, IDS.starter);
    captureLoss(IDS.starter, () => {
      db.prepare('UPDATE players SET organization_id = ?, team_id = ? WHERE player_id = ?')
        .run(IDS.otherMlbTeam, IDS.otherMlbTeam, IDS.starter);
      db.prepare('UPDATE players_roster_status SET is_active = 0 WHERE player_id = ?').run(IDS.starter);
    });
    const open = majorLeagueReactiveNeeds(IDS.mlbTeam);
    const need = open.needs.find((item) => item.causalPlayer?.playerId === IDS.starter)!;
    expect(need).toMatchObject({
      role: { kind: 'position', position },
      cause: { kind: 'trade', provenance: 'corroborated' }, horizon: { kind: 'structural' },
    });

    db.prepare('UPDATE players SET position = ?, team_id = ? WHERE player_id = ?').run(position, IDS.mlbTeam, IDS.optioned);
    db.prepare('UPDATE players_roster_status SET is_active = 1 WHERE player_id = ?').run(IDS.optioned);
    const resolved = majorLeagueReactiveNeeds(IDS.mlbTeam);
    expect(resolved.needs.some((item) => item.id === need.id)).toBe(false);
    expect(resolved.resolvedNeedIds).toContain(need.id);
  });

  it('preserves an unknown cause and unknown injury duration without inventing transaction labels', () => {
    const position = Number((db.prepare('SELECT position AS value FROM players WHERE player_id = ?').get(IDS.starter) as { value: number }).value);
    removeOtherActiveAt(position, IDS.starter);
    captureLoss(IDS.starter, () => {
      db.prepare('UPDATE players_roster_status SET is_active = 0 WHERE player_id = ?').run(IDS.starter);
    });
    expect(majorLeagueReactiveNeeds(IDS.mlbTeam).needs).toEqual(expect.arrayContaining([
      expect.objectContaining({ cause: { kind: 'availability_loss_unknown', provenance: 'unknown' }, horizon: { kind: 'unknown' } }),
    ]));

    clearRosterHistory();
    db.prepare('UPDATE players_roster_status SET is_active = 1, is_on_dl = 0 WHERE player_id = ?').run(IDS.starter);
    db.exec('CREATE TABLE players_injury_history (player_id INTEGER, date TEXT)');
    db.prepare('INSERT INTO players_injury_history VALUES (?, ?)').run(IDS.starter, '2030-06-02');
    captureLoss(IDS.starter, () => {
      db.prepare('UPDATE players_roster_status SET is_active = 0, is_on_dl = 1 WHERE player_id = ?').run(IDS.starter);
    });
    expect(majorLeagueReactiveNeeds(IDS.mlbTeam).needs).toEqual(expect.arrayContaining([
      expect.objectContaining({ cause: { kind: 'injury', provenance: 'corroborated' }, horizon: { kind: 'unknown' } }),
    ]));
  });

  it('keeps one continuing need across unchanged later imports, then resolves it on return', () => {
    const position = Number((db.prepare('SELECT position AS value FROM players WHERE player_id = ?').get(IDS.starter) as { value: number }).value);
    removeOtherActiveAt(position, IDS.starter);
    captureLoss(IDS.starter, () => db.prepare('UPDATE players_roster_status SET is_active = 0 WHERE player_id = ?').run(IDS.starter));
    const first = majorLeagueReactiveNeeds(IDS.mlbTeam).needs.find((need) => need.causalPlayer?.playerId === IDS.starter)!;
    db.prepare('UPDATE leagues SET "current_date" = ? WHERE league_id = ?').run('2030-06-03', IDS.league);
    expect(captureRosterStateSnapshot().status).toBe('created');
    const continuing = majorLeagueReactiveNeeds(IDS.mlbTeam).needs.find((need) => need.causalPlayer?.playerId === IDS.starter)!;
    expect(continuing).toMatchObject({ id: first.id, lifecycle: 'continuing' });

    db.prepare('UPDATE players_roster_status SET is_active = 1 WHERE player_id = ?').run(IDS.starter);
    db.prepare('UPDATE leagues SET "current_date" = ? WHERE league_id = ?').run('2030-06-04', IDS.league);
    expect(captureRosterStateSnapshot().status).toBe('created');
    const resolved = majorLeagueReactiveNeeds(IDS.mlbTeam);
    expect(resolved.needs.some((need) => need.id === first.id)).toBe(false);
    expect(resolved.resolvedNeedIds).toContain(first.id);
  });

  it('keeps simultaneous observed losses as distinct role needs', () => {
    const starterPosition = Number((db.prepare('SELECT position AS value FROM players WHERE player_id = ?').get(IDS.starter) as { value: number }).value);
    removeOtherActiveAt(starterPosition, IDS.starter);
    db.prepare('UPDATE players SET position = 1, role = 11 WHERE player_id = ?').run(IDS.extended);
    removeOtherActiveAt(1, IDS.extended);
    captureLoss(IDS.starter, () => {
      db.prepare('UPDATE players_roster_status SET is_active = 0 WHERE player_id IN (?, ?)').run(IDS.starter, IDS.extended);
    });
    const losses = majorLeagueReactiveNeeds(IDS.mlbTeam).needs.filter((need) =>
      need.category === 'role_coverage' && [IDS.starter, IDS.extended].includes(need.causalPlayer?.playerId ?? 0)
    );
    expect(losses).toHaveLength(2);
    expect(new Set(losses.map((need) => need.id)).size).toBe(2);
    expect(losses.map((need) => need.role?.kind)).toEqual(expect.arrayContaining(['position', 'starting_pitcher']));
  });

  it('does not consult continuous players_value fields', () => {
    db.exec('CREATE TABLE players_value (player_id INTEGER, overall_value REAL, talent_value REAL)');
    db.prepare('INSERT INTO players_value VALUES (?, ?, ?)').run(IDS.starter, 9999, 9999);
    expect(() => majorLeagueReactiveNeeds(IDS.mlbTeam)).not.toThrow();
    expect(majorLeagueReactiveNeeds(IDS.mlbTeam).scoutingValuePolicy).toBe('prohibited_pending_provenance');
  });
});
