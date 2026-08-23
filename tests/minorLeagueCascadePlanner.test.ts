import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { planMinorLeagueCascade } from '../server/minorLeagueCascadePlanner.js';
import { computeMinorLeagueRosterHealth } from '../server/minorLeagueRoster.js';
import { computeProspects } from '../server/org.js';
import { IDS, SEASON } from './fixture.js';

const START = 950_000;
const AA = 950_100;
const A = 950_101;
const AA_TWO = 950_102;

function addTeam(id: number, level: number, name: string): void {
  db.prepare(`INSERT INTO teams (team_id, name, nickname, abbr, level, league_id, sub_league_id, division_id, parent_team_id, allstar_team, human_team)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 0, 0)`).run(id, name, name, name.slice(0, 3), level, IDS.league, IDS.mlbTeam);
}

function addPlayer(id: number, options: { teamId?: number; position?: number; role?: number; strong?: boolean; unavailable?: boolean } = {}): void {
  const teamId = options.teamId ?? IDS.aaaTeam;
  const position = options.position ?? 2;
  const role = options.role ?? 0;
  db.prepare(`INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws, uniform_number, team_id, organization_id, retired, hidden, draft_eligible, college)
    VALUES (?, 'Cascade', ?, 25, ?, ?, 1, 1, 0, ?, ?, 0, 0, 0, 0)`).run(id, String(id), position, role, teamId, IDS.mlbTeam);
  db.prepare(`INSERT INTO players_roster_status (player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary, mlb_service_years, mlb_service_days, mlb_service_days_this_year)
    VALUES (?, 0, ?, 0, 0, 0, 0, 0)`).run(id, options.unavailable ? 1 : 0);
  if (options.unavailable) db.prepare('UPDATE players SET injury_is_injured = 1 WHERE player_id = ?').run(id);
  db.prepare('INSERT INTO team_roster (team_id, player_id, list_id) VALUES (?, ?, 2)').run(teamId, id);
  if (position === 1) {
    db.prepare(`INSERT INTO players_pitching (player_id, pitching_ratings_overall_stuff, pitching_ratings_overall_movement, pitching_ratings_overall_control,
      pitching_ratings_talent_stuff, pitching_ratings_talent_movement, pitching_ratings_talent_control, pitching_ratings_misc_stamina)
      VALUES (?, 65, 65, 65, 65, 65, 65, 60)`).run(id);
    return;
  }
  db.prepare(`INSERT INTO players_fielding (player_id, position, fielding_rating_pos${position}) VALUES (?, ?, 60)`).run(id, position);
  if (options.strong === undefined) return;
  const strong = options.strong;
  db.prepare('INSERT INTO players_value VALUES (?, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?)').run(id, strong ? 70 : 30, strong ? 70 : 30, strong ? 70 : 30, strong ? 70 : 30);
  db.prepare('INSERT INTO players_batting VALUES (?, 60, 60, 60, 60, 60, 50, 65, 65, 65, 65, 65)').run(id);
  db.prepare(`INSERT INTO players_career_batting_stats (player_id, year, team_id, league_id, level_id, split_id, pa, ab, h, d, t, hr, bb, ibb, hp, sf, k, sb, cs, r, rbi, war)
    VALUES (?, ?, ?, ?, (SELECT level FROM teams WHERE team_id = ?), 1, 250, 210, ?, 10, 0, ?, 25, 0, 0, 0, 35, 0, 0, 50, 50, 1)`)
    .run(id, SEASON, teamId, IDS.league, teamId, strong ? 105 : 30, strong ? 25 : 1);
}

function plan(removePlayerIds: number[], limits?: { maxDepth?: number; maxExploredStates?: number }) {
  return planMinorLeagueCascade({ orgId: IDS.mlbTeam, removePlayerIds, prospectData: computeProspects(IDS.mlbTeam), limits });
}

function setMinorLeagueActiveRosterLimit(limit: number): void {
  const columns = db.prepare('PRAGMA table_info(leagues)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'rules_active_roster_limit')) {
    db.exec('ALTER TABLE leagues ADD COLUMN rules_active_roster_limit INTEGER');
  }
  db.prepare('UPDATE leagues SET rules_active_roster_limit = ? WHERE league_id = ?').run(limit, IDS.league);
}

afterEach(() => {
  for (const table of ['players_career_batting_stats', 'players_batting', 'players_pitching', 'players_fielding', 'team_roster', 'players_roster_status', 'players_value', 'players']) {
    db.prepare(`DELETE FROM ${table} WHERE player_id >= ?`).run(START);
  }
  db.prepare(`DELETE FROM teams WHERE team_id IN (?, ?, ?)`).run(AA, A, AA_TWO);
  const leagueColumns = db.prepare('PRAGMA table_info(leagues)').all() as Array<{ name: string }>;
  if (leagueColumns.some((column) => column.name === 'rules_active_roster_limit')) {
    db.exec('ALTER TABLE leagues DROP COLUMN rules_active_roster_limit');
  }
});

describe('Minor League Operations cascade planner', () => {
  it('targets only scenario-induced coverage problems, not an unchanged baseline flaw', () => {
    addPlayer(START);
    addPlayer(START + 1);
    const result = plan([START]);
    expect(result.initialProblems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `${IDS.aaaTeam}:position:C` }),
    ]));
    expect(result.initialProblems.some((problem) => problem.id === `${IDS.aaaTeam}:bullpen`)).toBe(false);
  });

  it('stabilizes at depth zero when one of six AAA starters leaves', () => {
    for (let offset = 0; offset < 6; offset += 1) addPlayer(START + offset, { position: 1, role: 11 });
    const result = plan([START]);
    expect(result).toMatchObject({ status: 'complete', initialProblems: [] });
    expect(result.plans).toEqual([expect.objectContaining({ status: 'complete', depth: 0, moves: [] })]);
  });

  it('returns a complete one-step AA-to-AAA catcher plan when the source remains healthy', () => {
    addTeam(AA, 3, 'AA');
    addPlayer(START);
    addPlayer(START + 1);
    addPlayer(START + 2, { teamId: AA, strong: true });
    addPlayer(START + 3, { teamId: AA });
    addPlayer(START + 4, { teamId: AA });
    addPlayer(START + 5, { teamId: AA, position: 3, strong: false });
    const result = plan([START]);
    expect(result.plans).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'complete', depth: 1, moves: expect.arrayContaining([
        expect.objectContaining({ playerId: START + 2, from: expect.objectContaining({ teamId: AA }), to: expect.objectContaining({ teamId: IDS.aaaTeam }) }),
      ]) }),
    ]));
  });

  it('propagates an AA shortage to A and returns a complete two-step cascade', () => {
    addTeam(AA, 3, 'AA');
    addTeam(A, 4, 'A');
    addPlayer(START);
    addPlayer(START + 1);
    addPlayer(START + 2, { teamId: AA, strong: true });
    addPlayer(START + 3, { teamId: AA });
    addPlayer(START + 4, { teamId: AA, position: 3, strong: false });
    addPlayer(START + 5, { teamId: A, strong: true });
    addPlayer(START + 6, { teamId: A });
    addPlayer(START + 7, { teamId: A });
    addPlayer(START + 8, { teamId: A, position: 3, strong: false });
    const result = plan([START]);
    expect(result.plans).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'complete', depth: 2, moves: expect.arrayContaining([
        expect.objectContaining({ playerId: START + 2, to: expect.objectContaining({ teamId: IDS.aaaTeam }) }),
        expect.objectContaining({ playerId: START + 5, to: expect.objectContaining({ teamId: AA }) }),
      ]) }),
    ]));
  });

  it('stops with a partial plan when Player Development does not authorize the downstream response', () => {
    addTeam(AA, 3, 'AA');
    addTeam(A, 4, 'A');
    addPlayer(START);
    addPlayer(START + 1);
    addPlayer(START + 2, { teamId: AA, strong: true });
    addPlayer(START + 3, { teamId: AA });
    addPlayer(START + 4, { teamId: A, strong: false });
    addPlayer(START + 5, { teamId: AA, position: 3, strong: false });
    const result = plan([START]);
    expect(result.plans).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'partial', depth: 1, unresolvedProblems: expect.arrayContaining([expect.objectContaining({ teamId: AA })]) }),
    ]));
  });

  it('retains materially distinct branches from two real AA source affiliates', () => {
    addTeam(AA, 3, 'AA');
    addTeam(AA_TWO, 3, 'AATwo');
    addPlayer(START);
    addPlayer(START + 1);
    addPlayer(START + 2, { teamId: AA, strong: true });
    addPlayer(START + 3, { teamId: AA });
    addPlayer(START + 4, { teamId: AA });
    addPlayer(START + 5, { teamId: AA, position: 3, strong: false });
    addPlayer(START + 6, { teamId: AA_TWO, strong: true });
    addPlayer(START + 7, { teamId: AA_TWO });
    addPlayer(START + 8, { teamId: AA_TWO });
    addPlayer(START + 9, { teamId: AA_TWO, position: 3, strong: false });
    const result = plan([START]);
    expect([...new Set(result.plans.flatMap((candidate) => candidate.moves.map((move) => move.from.teamId)))]).toEqual(expect.arrayContaining([AA, AA_TWO]));
  });

  it('excludes unavailable players and never duplicates a moved player across rosters', () => {
    addTeam(AA, 3, 'AA');
    addPlayer(START);
    addPlayer(START + 1);
    addPlayer(START + 2, { teamId: AA, strong: true, unavailable: true });
    const before = db.prepare('SELECT team_id FROM players WHERE player_id = ?').get(START + 2);
    const result = plan([START]);
    expect(result.plans.some((candidate) => candidate.moves.some((move) => move.playerId === START + 2))).toBe(false);
    expect(db.prepare('SELECT team_id FROM players WHERE player_id = ?').get(START + 2)).toEqual(before);
  });

  it('reports explicit truncation rather than a false complete result when the bound is reached', () => {
    addPlayer(START);
    addPlayer(START + 1);
    const result = plan([START], { maxDepth: 0 });
    expect(result).toMatchObject({ status: 'truncated', bounds: { searchTruncated: true } });
  });

  it('shares exported affiliate capacity in normal and hypothetical roster health', () => {
    addTeam(AA, 3, 'AA');
    addPlayer(START);
    addPlayer(START + 1);
    addPlayer(START + 2, { teamId: AA });
    addPlayer(START + 3, { teamId: AA });
    addPlayer(START + 4, { teamId: AA });
    setMinorLeagueActiveRosterLimit(2);

    const normal = computeMinorLeagueRosterHealth(IDS.mlbTeam).find((team) => team.teamId === IDS.aaaTeam)!;
    const hypothetical = computeMinorLeagueRosterHealth(IDS.mlbTeam, {
      assignments: [{ playerId: START + 2, teamId: IDS.aaaTeam }],
    }).find((team) => team.teamId === IDS.aaaTeam)!;

    expect(normal.roster.capacity).toMatchObject({ limit: 2, status: 'within_limit', openSlots: 0, excess: 0 });
    expect(hypothetical.roster.capacity).toMatchObject({ limit: 2, status: 'over_capacity', openSlots: -1, excess: 1 });

    const cascade = planMinorLeagueCascade({
      orgId: IDS.mlbTeam,
      assignments: [{ playerId: START + 2, teamId: IDS.aaaTeam }],
      prospectData: { batters: [], pitchers: [] },
    });
    expect(cascade.initialProblems).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'roster_capacity', teamId: IDS.aaaTeam, current: 1 }),
    ]));
    expect(cascade.plans.some((candidate) => candidate.status === 'complete')).toBe(false);
  });

  it('does not call a plan complete when its only open role is filled by overfilling the destination', () => {
    addTeam(AA, 3, 'AA');
    addPlayer(START); // One AAA catcher is a current thin-coverage problem.
    addPlayer(START + 1, { teamId: AA, strong: true });
    addPlayer(START + 2, { teamId: AA });
    addPlayer(START + 3, { teamId: AA });
    addPlayer(START + 4, { teamId: AA, position: 3, strong: false });
    setMinorLeagueActiveRosterLimit(1);

    const result = planMinorLeagueCascade({
      orgId: IDS.mlbTeam,
      prospectData: computeProspects(IDS.mlbTeam),
      problemScope: 'current',
    });

    expect(result.plans.some((candidate) => candidate.status === 'complete')).toBe(false);
    expect(result.plans).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'partial',
        moves: expect.arrayContaining([expect.objectContaining({ playerId: START + 1, to: expect.objectContaining({ teamId: IDS.aaaTeam }) })]),
        unresolvedProblems: expect.arrayContaining([expect.objectContaining({ kind: 'roster_capacity', teamId: IDS.aaaTeam, current: 1 })]),
      }),
    ]));
  });
});
