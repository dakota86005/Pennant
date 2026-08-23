import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { analyzeOrganizationalConsequences } from '../server/majorLeagueOrganizationalConsequences.js';
import type { MajorLeagueNeed, MajorLeagueNeedRole } from '../server/majorLeagueOperations.js';
import type { InternalResponder } from '../server/majorLeagueResponders.js';
import { planTransactionSolution } from '../server/majorLeagueTransactionPlan.js';
import { IDS, SEASON } from './fixture.js';

const ID_START = 960_000;
const AA_TEAM = 960_100;
const catcherRole: MajorLeagueNeedRole = { kind: 'position', position: 2, label: 'catcher', provenance: 'observed' };
const starterRole: MajorLeagueNeedRole = { kind: 'starting_pitcher', position: 1, label: 'starting pitcher', provenance: 'observed' };
const reliefRole: MajorLeagueNeedRole = { kind: 'relief_pitcher', position: 1, label: 'relief pitcher', provenance: 'observed' };

function need(role: MajorLeagueNeedRole = catcherRole): MajorLeagueNeed {
  return {
    id: `phase-4:${role.kind}:${role.position}`,
    organizationId: IDS.mlbTeam,
    mlbTeamId: IDS.mlbTeam,
    category: 'role_coverage',
    role,
    causalPlayer: { playerId: 999, name: 'Unavailable Player' },
    cause: { kind: 'injury', provenance: 'corroborated' },
    detectedAt: '2030-06-01T00:00:00.000Z',
    status: 'open',
    lifecycle: 'continuing',
    horizon: { kind: 'temporary', expectedDays: 12, evidence: ['Synthetic injury duration.'] },
    evidence: [],
    unknowns: [],
  };
}

function responder(playerId: number, source: InternalResponder['source'], role: MajorLeagueNeedRole): InternalResponder {
  return {
    playerId,
    name: `Player ${playerId}`,
    source,
    assignment: { teamId: source === 'active_mlb' ? IDS.mlbTeam : IDS.aaaTeam, level: source === 'active_mlb' ? 1 : 2 },
    roleFit: { fit: 'direct', role, evidence: [{ kind: 'listed_position', message: 'Synthetic direct fit.' }] },
    availability: { status: 'available', evidence: ['Synthetic availability.'] },
    development: source === 'minor_league_call_up'
      ? { status: 'not_applicable', gate: null, message: 'Synthetic AAA depth.' }
      : null,
    transactionContext: { fortyMan: null, majorLeagueContract: null, note: 'Baseball discussion only; transaction feasibility is deferred.' },
  };
}

function addTeam(): void {
  db.prepare(
    `INSERT INTO teams (team_id, name, nickname, abbr, level, league_id, sub_league_id,
                        division_id, parent_team_id, allstar_team, human_team)
     VALUES (?, 'Double', 'A', 'DAA', 3, ?, 0, 0, ?, 0, 0)`
  ).run(AA_TEAM, IDS.league, IDS.mlbTeam);
}

function addPlayer(
  id: number,
  options: { teamId?: number; position?: number; role?: number; unavailable?: boolean; stats?: 'strong' | 'weak' } = {}
): void {
  const teamId = options.teamId ?? IDS.aaaTeam;
  const position = options.position ?? 2;
  const role = options.role ?? 0;
  db.prepare(
    `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws,
                          uniform_number, team_id, organization_id, retired, hidden, draft_eligible, college)
     VALUES (?, 'Phase', ?, 25, ?, ?, 1, 1, 0, ?, ?, 0, 0, 0, 0)`
  ).run(id, String(id), position, role, teamId, IDS.mlbTeam);
  db.prepare(
    `INSERT INTO players_roster_status
       (player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary, mlb_service_years, mlb_service_days, mlb_service_days_this_year)
     VALUES (?, 0, ?, 0, 0, 0, 0, 0)`
  ).run(id, options.unavailable ? 1 : 0);
  if (options.unavailable) {
    db.prepare('UPDATE players SET injury_is_injured = 1 WHERE player_id = ?').run(id);
  }
  db.prepare('INSERT INTO team_roster (team_id, player_id, list_id) VALUES (?, ?, 2)').run(teamId, id);
  if (position !== 1) {
    const column = `fielding_rating_pos${position}`;
    db.prepare(`INSERT INTO players_fielding (player_id, position, ${column}) VALUES (?, ?, 60)`).run(id, position);
  } else {
    db.prepare(
      `INSERT INTO players_pitching
       (player_id, pitching_ratings_overall_stuff, pitching_ratings_overall_movement, pitching_ratings_overall_control,
        pitching_ratings_talent_stuff, pitching_ratings_talent_movement, pitching_ratings_talent_control,
        pitching_ratings_misc_stamina)
       VALUES (?, 65, 65, 65, 65, 65, 65, 60)`
    ).run(id);
  }
  if (options.stats) {
    const strong = options.stats === 'strong';
    db.prepare('INSERT INTO players_value VALUES (?, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?)').run(id, strong ? 70 : 30, strong ? 70 : 30, strong ? 70 : 30, strong ? 70 : 30);
    db.prepare(
      `INSERT INTO players_batting VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, 60, 60, 60, 60, 60, 50, 65, 65, 65, 65, 65);
    db.prepare(
      `INSERT INTO players_career_batting_stats
       (player_id, year, team_id, league_id, level_id, split_id, pa, ab, h, d, t, hr, bb, ibb, hp, sf, k, sb, cs, r, rbi, war)
       VALUES (?, ?, ?, ?, 3, 1, 250, 210, ?, 10, 0, ?, 25, 0, 0, 0, 35, 0, 0, 50, 50, 1)`
    ).run(id, SEASON, teamId, IDS.league, strong ? 105 : 30, strong ? 25 : 1);
  }
}

function consequence(playerId: number, role = catcherRole) {
  const selectedNeed = need(role);
  const selectedResponder = responder(playerId, 'minor_league_call_up', role);
  return analyzeOrganizationalConsequences(
    selectedNeed,
    selectedResponder,
    planTransactionSolution(selectedNeed, selectedResponder)
  );
}

afterEach(() => {
  for (const table of ['players_career_batting_stats', 'players_batting', 'players_pitching', 'players_fielding', 'team_roster', 'players_roster_status', 'players_value', 'players']) {
    db.prepare(`DELETE FROM ${table} WHERE player_id >= ?`).run(ID_START);
  }
  db.prepare('DELETE FROM teams WHERE team_id = ?').run(AA_TEAM);
  db.prepare('UPDATE players_roster_status SET is_on_secondary = 1 WHERE player_id = ?').run(IDS.minorDeal);
  const columns = (db.prepare('PRAGMA table_info(leagues)').all() as Array<{ name: string }>).map((column) => column.name);
  if (columns.includes('rules_secondary_roster_limit')) db.exec('ALTER TABLE leagues DROP COLUMN rules_secondary_roster_limit');
  if (columns.includes('rules_active_roster_limit')) db.exec('ALTER TABLE leagues DROP COLUMN rules_active_roster_limit');
});

describe('MLB organizational consequence analysis', () => {
  it('keeps a source affiliate adequate when two other available catchers remain', () => {
    addPlayer(ID_START);
    addPlayer(ID_START + 1);
    addPlayer(ID_START + 2);
    const result = consequence(ID_START);
    expect(result.sourceAffiliateConsequence).toMatchObject({
      coverage: { before: 'healthy', after: 'healthy', remainsAdequate: true },
      operationalProblem: 'none',
      downstreamResponse: { status: 'not_required' },
    });
  });

  it('separates an AAA catcher removal from the resulting newly deficient coverage problem', () => {
    addPlayer(ID_START);
    addPlayer(ID_START + 1);
    const result = consequence(ID_START);
    expect(result.factualChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'minor_league_player_removed' }),
    ]));
    expect(result.sourceAffiliateConsequence).toMatchObject({
      coverage: { before: 'healthy', after: 'thin', remainsAdequate: false },
      operationalProblem: 'created',
      downstreamResponse: { owner: 'minor_league_operations', status: 'no_currently_defensible_response' },
    });
  });

  it('uses the existing pitching roster-health rotation status after an AAA starter is removed', () => {
    for (let offset = 0; offset < 5; offset += 1) addPlayer(ID_START + offset, { position: 1, role: 11 });
    const result = consequence(ID_START, starterRole);
    expect(result.sourceAffiliateConsequence).toMatchObject({
      coverage: { before: 'healthy', after: 'thin', remainsAdequate: false },
      operationalProblem: 'created',
    });
  });

  it('does not count an unavailable catcher as source-affiliate coverage', () => {
    addPlayer(ID_START);
    addPlayer(ID_START + 1);
    addPlayer(ID_START + 2, { unavailable: true });
    const result = consequence(ID_START);
    expect(result.sourceAffiliateConsequence?.coverage).toMatchObject({ after: 'thin', remainsAdequate: false });
  });

  it('keeps a missing source role explicit rather than treating it as no consequence', () => {
    addPlayer(ID_START);
    db.prepare('UPDATE players SET position = NULL WHERE player_id = ?').run(ID_START);
    const result = consequence(ID_START);
    expect(result.sourceAffiliateConsequence).toBeNull();
    expect(result.unknowns).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'source_role_unknown', playerId: ID_START }),
    ]));
  });

  it('exposes the shared Minor League Operations cascade result for a developmentally authorized response', () => {
    addTeam();
    addPlayer(ID_START);
    addPlayer(ID_START + 1);
    addPlayer(ID_START + 2, { teamId: AA_TEAM, stats: 'strong' });
    addPlayer(ID_START + 3, { teamId: AA_TEAM, position: 3, stats: 'weak' });
    const result = consequence(ID_START);
    expect(result.sourceAffiliateConsequence?.downstreamResponse).toMatchObject({
      status: 'discussion_candidates_available',
      candidates: [expect.objectContaining({ playerId: ID_START + 2, assignmentKind: 'normal_promotion' })],
      cascade: { status: 'partial' },
    });
    expect(result.ordering).toBe('single_solution_no_ranking');
    expect(result.scoring).toBe('none');
  });

  it('does not manufacture a lower-level promotion when Player Development has no eligible assignment', () => {
    addTeam();
    addPlayer(ID_START);
    addPlayer(ID_START + 1);
    addPlayer(ID_START + 2, { teamId: AA_TEAM, stats: 'weak' });
    const result = consequence(ID_START);
    expect(result.sourceAffiliateConsequence?.downstreamResponse).toMatchObject({
      status: 'no_currently_defensible_response',
      candidates: [],
    });
  });

  it('reports the immediate active-MLB role consequence without a farm simulation', () => {
    const selectedNeed = need(reliefRole);
    const selectedResponder = responder(IDS.extended, 'active_mlb', reliefRole);
    const result = analyzeOrganizationalConsequences(
      selectedNeed,
      selectedResponder,
      planTransactionSolution(selectedNeed, selectedResponder)
    );
    expect(result.mlbRoleConsequence).toMatchObject({ status: 'role_altered', priorRole: 'starting pitcher' });
    expect(result.sourceAffiliateConsequence).toBeNull();
  });

  it('carries transaction unknowns, need context, development context, and the no-value policy forward', () => {
    addPlayer(ID_START);
    addPlayer(ID_START + 1);
    const result = consequence(ID_START);
    expect(result.need).toEqual({ id: need().id, cause: need().cause, horizon: need().horizon });
    expect(result.transactionSolution.unknowns).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'recall_legality_indeterminate' }),
    ]));
    expect(result.unknowns).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'recall_legality_indeterminate' }),
    ]));
    expect(result.developmentContext).toMatchObject({ status: 'not_applicable' });
    expect(result.scoutingValuePolicy).toBe('prohibited_pending_provenance');
  });

  it('carries corresponding active- and 40-man decisions forward without selecting either player', () => {
    db.prepare('UPDATE players_roster_status SET is_on_secondary = 0 WHERE player_id = ?').run(IDS.minorDeal);
    const active = Number((db.prepare(
      `SELECT COUNT(*) AS count FROM players_roster_status rs
       JOIN players p ON p.player_id = rs.player_id
       WHERE p.organization_id = ? AND rs.is_active = 1`
    ).get(IDS.mlbTeam) as { count: number }).count);
    const forty = Number((db.prepare(
      `SELECT COUNT(*) AS count FROM players_roster_status rs
       JOIN players p ON p.player_id = rs.player_id
       WHERE p.organization_id = ? AND (rs.is_active = 1 OR rs.is_on_secondary = 1)`
    ).get(IDS.mlbTeam) as { count: number }).count);
    db.exec('ALTER TABLE leagues ADD COLUMN rules_active_roster_limit INTEGER');
    db.exec('ALTER TABLE leagues ADD COLUMN rules_secondary_roster_limit INTEGER');
    db.prepare('UPDATE leagues SET rules_active_roster_limit = ?, rules_secondary_roster_limit = ? WHERE league_id = ?')
      .run(active, forty, IDS.league);
    const thirdBase: MajorLeagueNeedRole = { kind: 'position', position: 4, label: 'third base', provenance: 'observed' };
    const selectedNeed = need(thirdBase);
    const selectedResponder = responder(IDS.minorDeal, 'minor_league_call_up', thirdBase);
    const result = analyzeOrganizationalConsequences(
      selectedNeed,
      selectedResponder,
      planTransactionSolution(selectedNeed, selectedResponder)
    );
    expect(result.unresolvedMlbDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'active_roster_space', selectedPlayerId: null }),
      expect.objectContaining({ kind: 'forty_man_space', selectedPlayerId: null }),
    ]));
  });
});
