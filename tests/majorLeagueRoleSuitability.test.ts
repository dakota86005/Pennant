import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { majorLeagueRoleSuitability } from '../server/majorLeagueRoleSuitability.js';
import type { MajorLeagueNeed, MajorLeagueNeedRole } from '../server/majorLeagueOperations.js';
import type { InternalResponder } from '../server/majorLeagueResponders.js';
import { IDS } from './fixture.js';

const ADDED = 940_000;
const shortstop: MajorLeagueNeedRole = { kind: 'position', position: 6, label: 'shortstop', provenance: 'observed' };
const starter: MajorLeagueNeedRole = { kind: 'starting_pitcher', position: 1, label: 'starting pitcher', provenance: 'observed' };

function need(role: MajorLeagueNeedRole): MajorLeagueNeed {
  return {
    id: `role-profile:${role.kind}`, organizationId: IDS.mlbTeam, mlbTeamId: IDS.mlbTeam,
    category: 'role_coverage', role, causalPlayer: null, cause: null, detectedAt: null,
    status: 'open', lifecycle: 'continuing', horizon: { kind: 'unknown' }, evidence: [], unknowns: [],
  };
}

function responder(playerId: number, role: MajorLeagueNeedRole, source: InternalResponder['source'] = 'active_mlb'): InternalResponder {
  return {
    playerId, name: `Role ${playerId}`, source,
    assignment: { teamId: source === 'active_mlb' ? IDS.mlbTeam : IDS.aaaTeam, level: source === 'active_mlb' ? 1 : 2 },
    roleFit: { fit: 'direct', role, evidence: [{ kind: role.kind === 'position' ? 'listed_position' : 'pitching_role', message: 'Established synthetic fit.' }] },
    availability: { status: 'available', evidence: [] }, development: null,
    transactionContext: { fortyMan: true, majorLeagueContract: true, note: 'Baseball discussion only; transaction feasibility is deferred.' },
  };
}

afterEach(() => {
  for (const table of ['players_fielding', 'players_batting', 'players_pitching', 'players']) {
    db.prepare(`DELETE FROM ${table} WHERE player_id >= ?`).run(ADDED);
  }
  db.prepare('UPDATE players_value SET overall_value = 1200, talent_value = 1300 WHERE player_id = ?').run(IDS.starter);
});

describe('MLB role-suitability evidence', () => {
  it('uses visible current batting components without collapsing them into a master quality score', () => {
    const profile = majorLeagueRoleSuitability(need(shortstop), responder(IDS.starter, shortstop));
    expect(profile.positionPlayer?.offense.currentRatings.map((rating) => rating.label)).toEqual(['Contact', 'Gap power', 'Power', 'Eye', 'Avoid strikeouts']);
    expect(profile.positionPlayer?.offense.currentRatingMean).toBe(50);
    expect(profile).not.toHaveProperty('score');
  });

  it('retains visible target-position defense, experience, components, and versatility separately', () => {
    const profile = majorLeagueRoleSuitability(need(shortstop), responder(IDS.starter, shortstop));
    expect(profile.positionPlayer?.defense).toMatchObject({ targetPosition: 6, targetRating: 50, primaryAtTarget: true });
    expect(profile.positionPlayer?.defense.visiblePlayablePositions).toBeGreaterThan(1);
  });

  it('retains objective current-level batting performance as performance rather than scouting', () => {
    const profile = majorLeagueRoleSuitability(need(shortstop), responder(IDS.starter, shortstop));
    expect(profile.positionPlayer?.offense.performance).toMatchObject({ level: 1, pa: 200 });
    expect(profile.provenance.objective).toBe('imported_save_statistics_and_roster_facts');
  });

  it('retains handedness and speed where exported', () => {
    const profile = majorLeagueRoleSuitability(need(shortstop), responder(IDS.starter, shortstop));
    expect(profile.handedness).toEqual({ bats: 'R', throws: 'R' });
    expect(profile.positionPlayer?.offense.speed).toBe(50);
  });

  it('uses visible pitcher components, role, stamina, repertoire, and workload separately', () => {
    const profile = majorLeagueRoleSuitability(need(starter), responder(IDS.extended, starter));
    expect(profile.pitcher).toMatchObject({ role: 'starter', currentRatingMean: expect.any(Number), stamina: 60 });
    expect(profile.pitcher?.currentRatings.map((rating) => rating.label)).toEqual(['Stuff', 'Movement', 'Control']);
    expect(profile.positionPlayer).toBeNull();
  });

  it('marks missing style evidence insufficient instead of fabricating a comparison', () => {
    db.prepare(`INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws, uniform_number, team_id, organization_id, retired, hidden, draft_eligible, college)
      VALUES (?, 'No', 'Ratings', 25, 6, 0, 1, 1, 0, ?, ?, 0, 0, 0, 0)`).run(ADDED, IDS.mlbTeam, IDS.mlbTeam);
    const profile = majorLeagueRoleSuitability(need(shortstop), responder(ADDED, shortstop));
    expect(profile.comparisonEvidence).toBe('insufficient');
    expect(profile.unknowns.map((unknown) => unknown.code)).toEqual(expect.arrayContaining(['visible_batting_ratings_unavailable', 'visible_target_fielding_rating_unavailable']));
  });

  it('preserves the earlier responder gate as baseline adequacy rather than inventing MLB thresholds', () => {
    const profile = majorLeagueRoleSuitability(need(shortstop), responder(IDS.starter, shortstop));
    expect(profile.adequacy).toMatchObject({ status: 'established_by_responder_gate', fit: 'direct' });
  });

  it('never changes when prohibited continuous players_value figures change', () => {
    const before = majorLeagueRoleSuitability(need(shortstop), responder(IDS.starter, shortstop));
    db.prepare('UPDATE players_value SET overall_value = 999999, talent_value = 999999 WHERE player_id = ?').run(IDS.starter);
    const after = majorLeagueRoleSuitability(need(shortstop), responder(IDS.starter, shortstop));
    expect(after).toEqual(before);
    expect(after.scoutingValuePolicy).toBe('prohibited_pending_provenance');
  });
});
