import { beforeAll, describe, expect, it } from 'vitest';
import { db, tableColumns } from '../server/db.js';
import { computeFarmSystem } from '../server/farmOperations.js';
import { farmConsequenceFor } from '../server/farmConsequence.js';
import { IDS } from './fixture.js';
import request from './request.js';

/**
 * How an indeterminate Player Development assessment travels into Minor League Operations.
 *
 * The organization has a healthy Triple-A source, a thin Triple-A destination and a Double-A club
 * whose prospects Player Development has judged: one on complete evidence and ruled out, two with no
 * organization-visible ratings at all. The farm must surface the unknown ones as unknown — never
 * planned, never rejected, never ranked — and Player Development's judgments must not move with the
 * organization's philosophy. (The successor to the same cases against the superseded solvers.)
 */

const ORG = IDS.mlbTeam;
const DEST = 700; // level 2, thin
const SOURCE = 701; // level 2, full
const LOWER = 702; // level 3, where the prospects are

const UNKNOWN_HITTER = 71_001; // on the source, no ratings
const PROSPECT_UNKNOWN = 73_001; // ratings unknown: indeterminate
const PROSPECT_INDEFENSIBLE = 73_002; // ratings known, production poor: indefensible
const PROSPECT_PITCHER_UNKNOWN = 73_003;

let nextId = 71_100;

function player(id: number, team: number, position: number, role: number, age = 23, ratings: 'known' | 'none' = 'known'): number {
  db.prepare(
    `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws,
                          uniform_number, team_id, organization_id, retired, hidden, draft_eligible, college)
     VALUES (?, 'Op', ?, ?, ?, ?, 1, 1, 9, ?, ?, 0, 0, 0, 0)`
  ).run(id, `P${id}`, age, position, role, team, ORG);
  db.prepare(`INSERT INTO team_roster VALUES (?, ?, 2)`).run(team, id);
  db.prepare(`INSERT INTO team_roster VALUES (?, ?, 1)`).run(team, id);
  if (position === 1) {
    if (ratings === 'known') {
      db.prepare(
        `INSERT INTO players_pitching (player_id, pitching_ratings_overall_stuff, pitching_ratings_overall_movement,
           pitching_ratings_overall_control, pitching_ratings_talent_stuff, pitching_ratings_talent_movement,
           pitching_ratings_talent_control, pitching_ratings_misc_stamina,
           pitching_ratings_pitches_fastball, pitching_ratings_pitches_slider, pitching_ratings_pitches_changeup)
         VALUES (?, 45, 45, 45, 55, 55, 55, 50, 55, 50, 45)`
      ).run(id);
    }
  } else {
    if (ratings === 'known') {
      db.prepare(
        `INSERT INTO players_batting (player_id, batting_ratings_overall_contact, batting_ratings_overall_gap,
           batting_ratings_overall_power, batting_ratings_overall_eye, batting_ratings_overall_strikeouts,
           batting_ratings_talent_contact, batting_ratings_talent_gap, batting_ratings_talent_power,
           batting_ratings_talent_eye, batting_ratings_talent_strikeouts)
         VALUES (?, 45, 45, 45, 45, 45, 50, 50, 50, 50, 50)`
      ).run(id);
    }
    const cols = Array.from({ length: 8 }, (_, i) => `fielding_rating_pos${i + 2}`);
    db.prepare(
      `INSERT INTO players_fielding (player_id, position, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '50').join(', ')})`
    ).run(id, position);
  }
  return id;
}

function affiliate(teamId: number, level: number, name: string): void {
  db.prepare(
    `INSERT INTO teams (team_id, name, nickname, abbr, level, league_id, parent_team_id, allstar_team)
     VALUES (?, ?, 'Ops', 'OPS', ?, ?, ?, 0)`
  ).run(teamId, name, level, IDS.league, ORG);
  db.prepare(`INSERT INTO team_record (team_id, g, w, l, t, pos, pct, gb, streak, magic_number) VALUES (?, 40, 20, 20, 0, 1, 0.5, 0, 0, 0)`).run(teamId);
}

beforeAll(() => {
  const ensure = (table: string, columns: string[]) => {
    const have = tableColumns(table);
    for (const c of columns) if (!have.includes(c)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${c} INTEGER DEFAULT 0`);
  };
  ensure('players', ['fatigue_points', 'fatigue_played_today']);

  affiliate(DEST, 2, 'Destination');
  affiliate(SOURCE, 2, 'Source');
  affiliate(LOWER, 3, 'Lower');

  for (let i = 0; i < 3; i++) player(nextId++, DEST, 4 + i, 0);
  for (let i = 0; i < 12; i++) player(nextId++, SOURCE, 2 + (i % 8), 0);
  player(UNKNOWN_HITTER, SOURCE, 5, 0, 23, 'none');
  player(nextId++, SOURCE, 6, 0);
  for (let i = 0; i < 6; i++) player(nextId++, SOURCE, 1, 11);
  for (let i = 0; i < 6; i++) player(nextId++, SOURCE, 1, 12);

  const year = (db.prepare(`SELECT MAX(year) AS y FROM players_career_batting_stats`).get() as { y: number }).y;
  const stats = db.prepare(
    `INSERT INTO players_career_batting_stats
       (player_id, year, team_id, league_id, level_id, split_id, pa, ab, h, d, t, hr,
        bb, ibb, hp, sf, k, sb, cs, r, rbi, war)
     VALUES (?, ?, ?, ?, 3, 1, 250, 220, 66, 12, 1, 12, 20, 0, 2, 2, 40, 2, 1, 40, 45, 2.5)`
  );
  player(PROSPECT_UNKNOWN, LOWER, 7, 0, 21, 'none');
  player(PROSPECT_INDEFENSIBLE, LOWER, 8, 0, 21, 'known');
  player(PROSPECT_PITCHER_UNKNOWN, LOWER, 1, 11, 21, 'none');
  stats.run(PROSPECT_UNKNOWN, year, LOWER, IDS.league);
  stats.run(PROSPECT_INDEFENSIBLE, year, LOWER, IDS.league);
});

describe('what the farm says about a man Player Development cannot judge', () => {
  it('reviews him as indeterminate and shows the alternative as neither open nor ruled out', () => {
    const farm = computeFarmSystem(ORG);
    const unknown = farm.assignments.find((a) => a.playerId === PROSPECT_UNKNOWN)!;
    expect(unknown).toBeDefined();
    expect(unknown.protection.tier).toBeNull();
    for (const alt of unknown.alternatives) {
      expect(alt.judgment).not.toBe('defensible');
      expect(alt.preference).toBeNull();
    }
    expect(['indeterminate', 'current_assignment_defensible', 'not_assessable']).toContain(unknown.conclusion);
    expect(unknown.conclusion).not.toBe('promotion_direction_defensible');
  });

  it('carries no numeric protection for him anywhere in the organization\'s view', () => {
    const farm = computeFarmSystem(ORG);
    const unknown = farm.assignments.find((a) => a.playerId === PROSPECT_UNKNOWN)!;
    expect(unknown.protection.score).toBeNull();
    const retention = farm.retention.find((r) => r.playerId === PROSPECT_UNKNOWN)!;
    expect(retention.outlook.state).toBe('indeterminate');
    expect(retention.conclusion).toBe('indeterminate');
  });

  it('leaves a cascade indeterminate rather than following a man it cannot judge, and never presents the ruled-out man as usable', () => {
    /* A hitter leaving the destination opens a vacancy the Double-A prospects could fill. */
    const farm = computeFarmSystem(ORG);
    const leaving = farm.assignments.find((a) => a.teamId === DEST && a.kind === 'hitter')!;
    const c = farmConsequenceFor(ORG, leaving.playerId);
    expect(c.cascade).not.toBeNull();
    for (const step of c.cascade!.steps) {
      if (step.usable) expect(step.development.judgment).toBe('defensible');
      if (step.candidate?.playerId === PROSPECT_INDEFENSIBLE) expect(step.usable).toBe(false);
      if (step.candidate?.playerId === PROSPECT_UNKNOWN) {
        expect(step.development.judgment).toBe('indeterminate');
        expect(step.usable).toBe(false);
        expect(step.preference).toBeNull();
      }
    }
    if (c.cascade!.steps.some((s) => s.development.judgment === 'indeterminate' || s.development.judgment === 'not_evaluated')) {
      expect(c.cascade!.certainty).toBe('indeterminate');
    }
    for (const issue of c.unresolvedIssues) expect(issue).not.toMatch(/illegal|not allowed/i);
  });
});

describe('across organizational philosophies (end to end)', () => {
  const setAggressiveness = async (value: number) => {
    await request('/api/settings');
    const res = await fetch(`http://127.0.0.1:${process.env.OOTP_FO_PORT}/api/settings/philosophy/${ORG}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manual: { promotionAggressiveness: value } }),
    });
    expect(res.ok).toBe(true);
  };

  const snapshot = async () => {
    const prospects = await request(`/api/prospects/${ORG}`);
    const judgments: Record<string, string[]> = {};
    for (const p of [...prospects.batters, ...prospects.pitchers] as Array<Record<string, any>>) {
      judgments[String(p.player_id)] = p.assignments.evaluations.map(
        (e: Record<string, any>) => `${e.kind}:${e.target.levelName}:${e.judgment}:${e.eligible}`
      );
    }
    const farm = (await request(`/api/farm-operations/${ORG}`)) as {
      assignments: Array<{ playerId: number; conclusion: string; current: { verdict: string }; alternatives: Array<{ judgment: string; preference: string | null }> }>;
    };
    const verdicts = Object.fromEntries(farm.assignments.map((a) => [a.playerId, `${a.current.verdict}:${a.alternatives.map((x) => x.judgment).join(',')}`]));
    const preferences = Object.fromEntries(farm.assignments.map((a) => [a.playerId, a.alternatives.map((x) => x.preference).join(',')]));
    return { judgments, verdicts, preferences };
  };

  it('gives Player Development the same judgments under every philosophy, in both payloads', async () => {
    await setAggressiveness(0);
    const conservative = await snapshot();
    await setAggressiveness(50);
    const neutral = await snapshot();
    await setAggressiveness(100);
    const aggressive = await snapshot();
    expect(Object.keys(neutral.judgments).length).toBeGreaterThan(0);
    expect(conservative.judgments).toEqual(neutral.judgments);
    expect(aggressive.judgments).toEqual(neutral.judgments);
    expect(conservative.verdicts).toEqual(neutral.verdicts);
    expect(aggressive.verdicts).toEqual(neutral.verdicts);
  });

  it('never attaches a preference to an indefensible or indeterminate assignment, whatever the philosophy', async () => {
    for (const value of [0, 50, 100]) {
      await setAggressiveness(value);
      const farm = (await request(`/api/farm-operations/${ORG}`)) as { assignments: Array<{ alternatives: Array<{ judgment: string; preference: string | null }> }> };
      for (const a of farm.assignments) for (const alt of a.alternatives) if (alt.judgment !== 'defensible') expect(alt.preference).toBeNull();
    }
  });

  it('exposes the organization\'s preference beside, not inside, the judgment', async () => {
    await setAggressiveness(100);
    const prospects = await request(`/api/prospects/${ORG}`);
    const withPreference = (prospects.batters as Array<Record<string, any>>).find((p) => p.assignments.preference);
    expect(withPreference).toBeDefined();
    const summary = withPreference!.assignments.preference;
    expect(summary).toMatchObject({ promotionAggressiveness: 100, stance: 'advancement' });
    for (const e of withPreference!.assignments.evaluations as Array<Record<string, any>>) {
      if (e.judgment !== 'defensible') expect(e.preference).toBeNull();
    }
  });
});
