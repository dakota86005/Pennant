import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { IDS } from './fixture.js';
import request from './request.js';

const ADDED_PLAYER_START = 965_000;

function createOpenCapacityNeed(): string {
  const current = Number((db.prepare(
    `SELECT COUNT(*) AS n FROM players_roster_status rs
     JOIN players p ON p.player_id = rs.player_id
     WHERE p.organization_id = ? AND rs.is_active = 1`
  ).get(IDS.mlbTeam) as { n: number }).n);
  const player = db.prepare(
    `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws,
                          uniform_number, team_id, organization_id, retired, hidden, draft_eligible, college)
     VALUES (?, 'Route', 'Fixture', 25, 7, 0, 1, 1, 0, ?, ?, 0, 0, 0, 0)`
  );
  const status = db.prepare(
    `INSERT INTO players_roster_status
     (player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary, mlb_service_years, mlb_service_days, mlb_service_days_this_year)
     VALUES (?, 1, 0, 0, 1, 0, 0, 0)`
  );
  for (let offset = 0; offset < 25 - current; offset += 1) {
    const id = ADDED_PLAYER_START + offset;
    player.run(id, IDS.mlbTeam, IDS.mlbTeam);
    status.run(id);
  }
  db.exec('ALTER TABLE leagues ADD COLUMN rules_active_roster_limit INTEGER');
  db.prepare('UPDATE leagues SET rules_active_roster_limit = 26 WHERE league_id = ?').run(IDS.league);
  return `mlb:${IDS.mlbTeam}:active-roster-capacity`;
}

beforeEach(() => {
  db.exec('DROP TABLE IF EXISTS major_league_route_values');
});

afterEach(() => {
  db.prepare('DELETE FROM players_roster_status WHERE player_id >= ?').run(ADDED_PLAYER_START);
  db.prepare('DELETE FROM players WHERE player_id >= ?').run(ADDED_PLAYER_START);
  db.exec('ALTER TABLE leagues DROP COLUMN rules_active_roster_limit');
});

describe('Major League Operations read-only API', () => {
  it('returns stable, scoped current needs with a compact internal-solution summary', async () => {
    const needId = createOpenCapacityNeed();
    const result = await request(`/api/mlb-operations/${IDS.mlbTeam}/needs`);
    expect(result.organization).toMatchObject({ orgId: IDS.mlbTeam });
    expect(result.needs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: needId,
        status: 'open',
        responderSummary: expect.objectContaining({ hasDefensibleInternalSolution: expect.any(Boolean) }),
      }),
    ]));
    const other = await request(`/api/mlb-operations/${IDS.otherMlbTeam}/needs`);
    expect(other.needs.every((need: { organizationId: number }) => need.organizationId === IDS.otherMlbTeam)).toBe(true);
  });

  it('resolves a current need by stable id and returns only the existing synthesis packet', async () => {
    const needId = createOpenCapacityNeed();
    const before = db.prepare('SELECT COUNT(*) AS n FROM players_roster_status').get() as { n: number };
    const result = await request(`/api/mlb-operations/${IDS.mlbTeam}/needs/${encodeURIComponent(needId)}/solutions`);
    const after = db.prepare('SELECT COUNT(*) AS n FROM players_roster_status').get() as { n: number };
    expect(result).toMatchObject({
      need: { id: needId, organizationId: IDS.mlbTeam },
      semantics: { finalDecision: 'gm', scoring: 'no_master_score_structured_non_dominance' },
      scoutingValuePolicy: 'prohibited_pending_provenance',
    });
    expect(after.n).toBe(before.n);
  });

  it('safely rejects an invalid or resolved need and never leaks prohibited value fields', async () => {
    const needId = createOpenCapacityNeed();
    db.prepare('UPDATE players_value SET overall_value = 9876, talent_value = 8765').run();
    const packet = await request(`/api/mlb-operations/${IDS.mlbTeam}/needs/${encodeURIComponent(needId)}/solutions`);
    expect(JSON.stringify(packet)).not.toContain('overall_value');
    expect(JSON.stringify(packet)).not.toContain('talent_value');
    await expect(request(`/api/mlb-operations/${IDS.mlbTeam}/needs/not-open/solutions`)).rejects.toThrow('404');
    await expect(request(`/api/mlb-operations/invalid/needs`)).rejects.toThrow('400');
  });
});
