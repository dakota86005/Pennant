import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { assembleInternalResponders } from '../server/majorLeagueResponders.js';
import type { MajorLeagueNeed, MajorLeagueNeedRole } from '../server/majorLeagueOperations.js';
import { IDS, SEASON } from './fixture';

const ID_START = 980_000;
const AA_TEAM = 970_000;

const positionRole = (position = 6): MajorLeagueNeedRole => ({ kind: 'position', position, label: 'shortstop', provenance: 'observed' });
const starterRole: MajorLeagueNeedRole = { kind: 'starting_pitcher', position: 1, label: 'starting pitcher', provenance: 'observed' };
const reliefRole: MajorLeagueNeedRole = { kind: 'relief_pitcher', position: 1, label: 'relief pitcher', provenance: 'observed' };

function need(role: MajorLeagueNeedRole): MajorLeagueNeed {
  return {
    id: `test:${role.kind}:${role.position}`, organizationId: IDS.mlbTeam, mlbTeamId: IDS.mlbTeam,
    category: 'role_coverage', role, causalPlayer: { playerId: 999, name: 'Unavailable Player' },
    cause: { kind: 'availability_loss_unknown', provenance: 'unknown' }, detectedAt: '2030-06-01T00:00:00.000Z',
    status: 'open', lifecycle: 'continuing', horizon: { kind: 'unknown' }, evidence: [], unknowns: [],
  };
}

function addPlayer(
  id: number,
  options: { level?: number; position?: number; role?: number; active?: number; secondary?: number; il?: number; fielding?: boolean; strongStats?: boolean } = {}
): void {
  const level = options.level ?? 2;
  const teamId = level === 2 ? IDS.aaaTeam : level === 3 ? AA_TEAM : IDS.mlbTeam;
  const position = options.position ?? 6;
  db.prepare(
    `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws,
                          uniform_number, team_id, organization_id, retired, hidden, draft_eligible, college)
     VALUES (?, 'Responder', ?, 27, ?, ?, 1, 1, 0, ?, ?, 0, 0, 0, 0)`
  ).run(id, String(id), position, options.role ?? 0, teamId, IDS.mlbTeam);
  db.prepare(
    `INSERT INTO players_roster_status
     (player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary, mlb_service_years, mlb_service_days, mlb_service_days_this_year)
     VALUES (?, ?, ?, 0, ?, 0, 0, 0)`
  ).run(id, options.active ?? 0, options.il ?? 0, options.secondary ?? 0);
  if (options.fielding !== false && position !== 1) {
    db.prepare('INSERT INTO players_fielding (player_id, position, fielding_rating_pos6) VALUES (?, ?, 55)').run(id, position);
  }
  if (options.strongStats !== undefined) {
    const good = options.strongStats;
    db.prepare(
      `INSERT INTO players_batting VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, good ? 70 : 30, good ? 70 : 30, good ? 70 : 30, good ? 70 : 30, good ? 70 : 30, 50, 70, 70, 70, 70, 70);
    db.prepare(
      `INSERT INTO players_career_batting_stats
       (player_id, year, team_id, league_id, level_id, split_id, pa, ab, h, d, t, hr, bb, ibb, hp, sf, k, sb, cs, r, rbi, war)
       VALUES (?, ?, ?, ?, 2, 1, 220, 190, ?, 10, 0, ?, 20, 0, 0, 0, 35, 0, 0, 40, 45, ?)`
    ).run(id, SEASON, IDS.aaaTeam, IDS.league, good ? 90 : 25, good ? 20 : 1, good ? 4 : -1);
  }
}

afterEach(() => {
  for (const table of ['players_career_batting_stats', 'players_batting', 'players_fielding', 'players_roster_status', 'players']) {
    db.prepare(`DELETE FROM ${table} WHERE player_id >= ?`).run(ID_START);
  }
  db.prepare('DELETE FROM teams WHERE team_id = ?').run(AA_TEAM);
  db.prepare('DELETE FROM players_value WHERE player_id >= ?').run(ID_START);
  db.prepare('UPDATE players SET position = 6, role = 0 WHERE player_id = ?').run(IDS.starter);
});

describe('internal MLB responder assembly', () => {
  it('returns exact-position and exported secondary-position active responders without ranking them', () => {
    const direct = assembleInternalResponders(need(positionRole()));
    expect(direct.activeRosterResponders).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: IDS.starter, roleFit: expect.objectContaining({ fit: 'direct' }) }),
    ]));
    db.prepare('UPDATE players SET position = 7 WHERE player_id = ?').run(IDS.starter);
    const secondary = assembleInternalResponders(need(positionRole()));
    expect(secondary.activeRosterResponders).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: IDS.starter, roleFit: expect.objectContaining({ fit: 'secondary' }) }),
    ]));
    expect(secondary.ordering).toBe('player_id_ascending_non_preferential');
  });

  it('does not include active players whose role fit is not established, and separates starters from relievers', () => {
    addPlayer(ID_START, { level: 1, position: 7, active: 1, fielding: false });
    addPlayer(ID_START + 1, { level: 1, position: 1, role: 12, active: 1, fielding: false });
    addPlayer(ID_START + 2, { level: 1, position: 1, role: 0, active: 1, fielding: false });
    const positionResponders = assembleInternalResponders(need(positionRole()));
    expect(positionResponders.activeRosterResponders.some((player) => player.playerId === ID_START)).toBe(false);
    const starters = assembleInternalResponders(need(starterRole));
    expect(starters.activeRosterResponders).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: IDS.extended }),
    ]));
    expect(starters.activeRosterResponders.some((player) => player.playerId === ID_START + 1)).toBe(false);
    const relievers = assembleInternalResponders(need(reliefRole)).activeRosterResponders;
    expect(relievers).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: ID_START + 1 }),
    ]));
    expect(relievers.some((player) => player.playerId === ID_START + 2)).toBe(false);
  });

  it('uses the Player Development AAA→MLB gate for evaluated prospects without allowing the need to override it', () => {
    addPlayer(ID_START, { strongStats: true, secondary: 0 });
    addPlayer(ID_START + 1, { strongStats: false, secondary: 1 });
    const assembly = assembleInternalResponders(need(positionRole()));
    expect(assembly.minorLeagueCallUpResponders).toEqual(expect.arrayContaining([
      expect.objectContaining({
        playerId: ID_START,
        development: expect.objectContaining({ status: 'approved' }),
        transactionContext: expect.objectContaining({ fortyMan: false }),
      }),
    ]));
    expect(assembly.minorLeagueCallUpResponders.some((player) => player.playerId === ID_START + 1)).toBe(false);
    expect(assembly.minorLeagueExclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: ID_START + 1, reason: 'developmentally_prohibited' }),
    ]));
  });

  it('keeps available AAA depth without a prospect assessment in discussion, but excludes unavailable or lower-level players', () => {
    addPlayer(ID_START, { secondary: 0 });
    addPlayer(ID_START + 1, { il: 1 });
    db.prepare(
      `INSERT INTO teams (team_id, name, nickname, abbr, level, league_id, sub_league_id,
                          division_id, parent_team_id, allstar_team, human_team)
       VALUES (?, 'Double', 'A', 'DAA', 3, ?, 0, 0, ?, 0, 0)`
    ).run(AA_TEAM, IDS.league, IDS.mlbTeam);
    addPlayer(ID_START + 2, { level: 3, secondary: 0 });
    const assembly = assembleInternalResponders(need(positionRole()));
    expect(assembly.minorLeagueCallUpResponders).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: ID_START, development: expect.objectContaining({ status: 'not_applicable' }), transactionContext: expect.objectContaining({ fortyMan: false }) }),
    ]));
    expect(assembly.minorLeagueExclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: ID_START + 1, reason: 'unavailable' }),
      expect.objectContaining({ playerId: ID_START + 2, reason: 'lower_level_not_evaluated_for_mlb' }),
    ]));
  });

  it('carries the need horizon unchanged and does not consult prohibited continuous values', () => {
    addPlayer(ID_START, { secondary: 1 });
    db.prepare('INSERT INTO players_value VALUES (?, 9999, 9999, 0, 0, 0, 0, 20, 20, 20, 20)').run(ID_START);
    const temporaryNeed = { ...need(positionRole()), horizon: { kind: 'temporary' as const, expectedDays: 14, evidence: [] } };
    const assembly = assembleInternalResponders(temporaryNeed);
    expect(assembly.need.horizon).toEqual(temporaryNeed.horizon);
    expect(assembly.minorLeagueCallUpResponders.some((player) => player.playerId === ID_START)).toBe(true);
    expect(assembly.scoutingValuePolicy).toBe('prohibited_pending_provenance');
  });
});
