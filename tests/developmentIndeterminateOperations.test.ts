import { beforeAll, describe, expect, it } from 'vitest';
import { db, tableColumns } from '../server/db.js';
import { computeMinorLeagueRebalance } from '../server/minorLeagueMoves.js';
import { computeMinorLeaguePitchingOperations } from '../server/minorLeaguePitchingOperations.js';
import { evaluateProspectDecision, type ProspectNextAssignment } from '../server/prospectDecision.js';
import { evaluateProspectAssignments } from '../server/prospectAssignments.js';
import { syntheticScoutedAbility } from '../server/scoutedEvidence.js';
import { IDS } from './fixture.js';
import request from './request.js';

/**
 * How an indeterminate Player Development assessment travels into Minor League
 * Operations.
 *
 * The organization has a healthy same-level affiliate to draw from, a thin
 * destination that needs bodies, and a lower affiliate whose prospects Player
 * Development has judged. Some players have no organization-visible ratings.
 * Operations must surface them with the roster need and the missing evidence —
 * and must not plan them (approved), reject them, or rank them.
 */

const ORG = IDS.mlbTeam;
const DEST = 700; // level 2, thin: needs hitters and pitchers
const SOURCE = 701; // level 2, healthy
const LOWER = 702; // level 3, where the prospects are

// Players on the healthy source with no organization-visible ratings at all
const UNKNOWN_HITTER = 71_001;
const UNKNOWN_PITCHER = 72_001;

// Prospects on the lower affiliate
const PROSPECT_UNKNOWN = 73_001; // ratings unknown: Player Development is indeterminate
const PROSPECT_INDEFENSIBLE = 73_002; // ratings known, production poor: rejected
const PROSPECT_PITCHER_UNKNOWN = 73_003;

let nextId = 71_100;

function player(
  id: number,
  team: number,
  position: number,
  role: number,
  age = 23,
  ratings: 'known' | 'none' = 'known'
): number {
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
    // Playable at every defensive position, so the roster's coverage never decides anything here
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
}

beforeAll(() => {
  // The farm-operations queries read columns the shared fixture does not carry
  const ensure = (table: string, columns: string[]) => {
    const have = tableColumns(table);
    for (const c of columns) if (!have.includes(c)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${c} INTEGER DEFAULT 0`);
  };
  ensure('players', ['fatigue_points', 'fatigue_played_today']);

  affiliate(DEST, 2, 'Destination');
  affiliate(SOURCE, 2, 'Source');
  affiliate(LOWER, 3, 'Lower');

  // The destination is thin everywhere
  for (let i = 0; i < 3; i++) player(nextId++, DEST, 4 + i, 0);

  // The source is healthy: 14 hitters and 13 pitchers (6 starters, 7 relievers)
  for (let i = 0; i < 12; i++) player(nextId++, SOURCE, 2 + (i % 8), 0);
  player(UNKNOWN_HITTER, SOURCE, 5, 0, 23, 'none');
  player(nextId++, SOURCE, 6, 0);
  for (let i = 0; i < 6; i++) player(nextId++, SOURCE, 1, 11);
  for (let i = 0; i < 6; i++) player(nextId++, SOURCE, 1, 12);
  player(UNKNOWN_PITCHER, SOURCE, 1, 12, 23, 'none');

  // The prospects, with a season at the lower level
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

const higher: ProspectNextAssignment = {
  level: 2,
  levelName: 'AAA',
  teams: [{ teamId: DEST, label: 'Destination Ops' }],
  isMajorLeague: false,
};

function prospect(
  id: number,
  kind: 'batter' | 'pitcher',
  performanceDiff: number,
  ability: ReturnType<typeof syntheticScoutedAbility>
) {
  const decision = evaluateProspectDecision({
    kind,
    primaryPerformanceDiff: performanceDiff,
    secondaryPerformanceDiff: 0,
    pa: 250,
    ip: 60,
    ageDiff: 0,
    ability,
    nextAssignment: higher,
    demotionAssignment: null,
    canDemote: false,
  });

  return {
    player_id: id,
    team_id: LOWER,
    name: `P${id}`,
    age: 21,
    assignments: evaluateProspectAssignments({
      decision,
      higherAssignments: [higher],
      lowerAssignments: [],
    }),
  };
}

const unknownAbility = syntheticScoutedAbility({ current: null, potential: null });
const knownAbility = syntheticScoutedAbility({ current: 50, potential: 50 });

const prospectData = () => ({
  batters: [
    prospect(PROSPECT_UNKNOWN, 'batter', 0.1, unknownAbility),
    prospect(PROSPECT_INDEFENSIBLE, 'batter', -0.02, knownAbility),
  ],
  pitchers: [prospect(PROSPECT_PITCHER_UNKNOWN, 'pitcher', 2, unknownAbility)],
});

describe('the Player Development inputs', () => {
  it('judges the three prospects differently', () => {
    const d = prospectData();
    const judgment = (p: (typeof d.batters)[number]) => p.assignments.evaluations[0].judgment;
    expect(judgment(d.batters[0])).toBe('indeterminate');
    expect(judgment(d.batters[1])).toBe('indefensible');
    expect(judgment(d.pitchers[0])).toBe('indeterminate');
  });
});

describe('position-player operations', () => {
  const result = () => computeMinorLeagueRebalance(ORG, prospectData());

  it('lists an approved promotion as indeterminate when the defensive role it needs depends on unknown protection', () => {
    // Player Development approves on known decision evidence, but this player's own
    // ratings (which his regular-assignment fit depends on) are not visible
    const approved = prospect(PROSPECT_UNKNOWN, 'batter', 0.1, knownAbility);
    expect(approved.assignments.evaluations[0].judgment).toBe('defensible');
    const r = computeMinorLeagueRebalance(ORG, { batters: [approved], pitchers: [] });
    const entry = r.indeterminate.find((m) => m.playerId === PROSPECT_UNKNOWN && m.toTeamId === DEST)!;
    expect(entry).toBeDefined();
    expect(entry.reasons.join(' ')).toMatch(/Player Development authorized this assignment/);
    expect(r.rejected.map((m) => m.playerId)).not.toContain(PROSPECT_UNKNOWN);
  });

  it('lists an indeterminate promotion with the roster need and the missing evidence', () => {
    const entry = result().indeterminate.find((m) => m.playerId === PROSPECT_UNKNOWN && m.toTeamId === DEST)!;
    expect(entry).toBeDefined();
    expect(entry.developmentJudgment).toBe('indeterminate');
    expect(entry.kind).toBe('normal_promotion');
    expect(entry.toTeamId).toBe(DEST);
    expect(entry.fromTeamId).toBe(LOWER);
    expect(entry.missingEvidence.map((m) => m.dimension)).toEqual(['current_ability', 'potential_ability']);
    // The destination's need is stated on its own terms
    expect(entry.rosterNeed.join(' ')).toMatch(/Destination Ops is (CRITICAL|THIN)/);
    expect(entry.rosterNeed.length).toBeGreaterThan(1);
  });

  it('does not present an indeterminate player as approved, or as rejected', () => {
    const r = result();
    const approved = r.plans.flatMap((p) => p.moves.map((m) => m.playerId));
    expect(approved).not.toContain(PROSPECT_UNKNOWN);
    expect(approved).not.toContain(UNKNOWN_HITTER);
    expect(r.rejected.map((m) => m.playerId)).not.toContain(PROSPECT_UNKNOWN);
    expect(r.rejected.map((m) => m.playerId)).not.toContain(UNKNOWN_HITTER);
    expect(
      r.plans.flatMap((p) => p.alternatives.flatMap((a) => a.moves.map((m) => m.playerId)))
    ).not.toContain(UNKNOWN_HITTER);
  });

  it('still rejects a prospect Player Development has ruled out on known evidence', () => {
    const r = result();
    const rejected = r.rejected.find((m) => m.playerId === PROSPECT_INDEFENSIBLE)!;
    expect(rejected.phase).toBe('development');
    expect(r.indeterminate.map((m) => m.playerId)).not.toContain(PROSPECT_INDEFENSIBLE);
  });

  it('lists a same-level candidate whose protection is unknown, without ranking it', () => {
    const entry = result().indeterminate.find((m) => m.playerId === UNKNOWN_HITTER && m.toTeamId === DEST)!;
    expect(entry).toBeDefined();
    expect(entry.kind).toBe('same_level_reassignment');
    expect(entry.fromTeamId).toBe(SOURCE);
    expect(entry.reasons.join(' ')).toMatch(/Developmental protection cannot be determined/);
    expect(entry.missingEvidence.length).toBeGreaterThan(0);
  });

  it('is not a protection: it keeps known players available to the plans', () => {
    // Indeterminate players are set aside individually; they do not freeze the roster around them
    const r = result();
    const moved = r.plans.flatMap((p) => p.moves.map((m) => m.playerId));
    expect(r.indeterminate.some((m) => m.kind === 'same_level_reassignment')).toBe(true);
    if (moved.length) {
      expect(moved.every((id) => id !== UNKNOWN_HITTER)).toBe(true);
    }
  });

  it('carries no numeric protection for an indeterminate player anywhere in a plan', () => {
    const json = JSON.stringify(result().plans);
    expect(json).not.toContain(String(UNKNOWN_HITTER));
  });

  it('states the rule in its safeguards', () => {
    expect(result().safeguards.join(' ')).toMatch(/indeterminate/);
  });
});

describe('pitching operations', () => {
  const result = () => computeMinorLeaguePitchingOperations(ORG, prospectData());

  it('lists an approved promotion as indeterminate when the pitcher\'s own protection is unknown', () => {
    const approved = prospect(PROSPECT_PITCHER_UNKNOWN, 'pitcher', 2, knownAbility);
    expect(approved.assignments.evaluations[0].judgment).toBe('defensible');
    const r = computeMinorLeaguePitchingOperations(ORG, { batters: [], pitchers: [approved] });
    const entry = r.indeterminate.find((m) => m.playerId === PROSPECT_PITCHER_UNKNOWN && m.toTeamId === DEST)!;
    expect(entry).toBeDefined();
    expect(entry.reasons.join(' ')).toMatch(/Player Development authorized this assignment/);
  });

  it('lists an indeterminate pitcher promotion with the roster need and missing evidence', () => {
    const entry = result().indeterminate.find((m) => m.playerId === PROSPECT_PITCHER_UNKNOWN && m.toTeamId === DEST)!;
    expect(entry).toBeDefined();
    expect(entry.developmentJudgment).toBe('indeterminate');
    expect(entry.toTeamId).toBe(DEST);
    expect(entry.missingEvidence.length).toBeGreaterThan(0);
    expect(entry.rosterNeed.length).toBeGreaterThan(0);
  });

  it('does not reject an indeterminate pitcher, or approve one', () => {
    const r = result();
    expect(r.rejected.map((m) => m.playerId)).not.toContain(PROSPECT_PITCHER_UNKNOWN);
    expect(r.rejected.map((m) => m.playerId)).not.toContain(UNKNOWN_PITCHER);
    const approved = r.plans.flatMap((p) => p.moves.map((m) => m.playerId));
    expect(approved).not.toContain(PROSPECT_PITCHER_UNKNOWN);
    expect(approved).not.toContain(UNKNOWN_PITCHER);
  });

  it('lists a same-level pitcher whose protection is unknown', () => {
    const entry = result().indeterminate.find((m) => m.playerId === UNKNOWN_PITCHER && m.toTeamId === DEST)!;
    expect(entry).toBeDefined();
    expect(entry.kind).toBe('same_level_reassignment');
    expect(entry.reasons.join(' ')).toMatch(/Developmental protection cannot be determined/);
  });

  it('states the rule in its safeguards', () => {
    expect(result().safeguards.join(' ')).toMatch(/indeterminate/);
  });
});

/**
 * The same, end to end and across organizations: the prospects and operations
 * endpoints are read under conservative, neutral and aggressive philosophies.
 * Player Development's judgments must not move, and Operations must plan only
 * what Player Development called defensible.
 */
describe('across organizational philosophies (end to end)', () => {
  const setAggressiveness = async (value: number) => {
    await request('/api/settings'); // starts the test server, which sets the port
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
    const defensible = new Set<string>();
    for (const p of [...prospects.batters, ...prospects.pitchers] as Array<Record<string, any>>) {
      judgments[String(p.player_id)] = p.assignments.evaluations.map(
        (e: Record<string, any>) => `${e.kind}:${e.target.levelName}:${e.judgment}:${e.eligible}`
      );
      for (const e of p.assignments.evaluations as Array<Record<string, any>>) {
        if (e.judgment === 'defensible') defensible.add(`${p.player_id}:${e.kind}`);
      }
    }
    const moves = await request(`/api/minor-league-moves/${ORG}`);
    const planned = new Set<string>();
    for (const plan of [...moves.plans, ...(moves.pitching?.plans ?? [])] as Array<Record<string, any>>) {
      for (const move of plan.moves as Array<Record<string, any>>) {
        planned.add(`${move.playerId}:${move.kind}`);
      }
    }
    return { judgments, defensible, planned };
  };

  it('gives Player Development the same judgments under every philosophy', async () => {
    await setAggressiveness(0);
    const conservative = await snapshot();
    await setAggressiveness(50);
    const neutral = await snapshot();
    await setAggressiveness(100);
    const aggressive = await snapshot();
    expect(Object.keys(neutral.judgments).length).toBeGreaterThan(0);
    expect(conservative.judgments).toEqual(neutral.judgments);
    expect(aggressive.judgments).toEqual(neutral.judgments);
  });

  it('plans a level-changing move only when Player Development called it defensible', async () => {
    for (const value of [0, 50, 100]) {
      await setAggressiveness(value);
      const { defensible, planned } = await snapshot();
      for (const move of planned) {
        if (move.endsWith(':same_level_reassignment')) continue;
        expect(defensible.has(move), `${move} planned at aggressiveness ${value}`).toBe(true);
      }
    }
  });

  it('never plans an indefensible or indeterminate assignment, whatever the philosophy', async () => {
    for (const value of [0, 50, 100]) {
      await setAggressiveness(value);
      const { planned, judgments } = await snapshot();
      for (const id of [PROSPECT_UNKNOWN, PROSPECT_INDEFENSIBLE]) {
        const evaluations = judgments[String(id)] ?? [];
        expect(evaluations.length, `prospect ${id} was evaluated`).toBeGreaterThan(0);
        for (const entry of evaluations) {
          const [kind, , judgment] = entry.split(':');
          if (judgment !== 'defensible') {
            expect(planned.has(`${id}:${kind}`), `${entry} @ ${value}`).toBe(false);
          }
        }
      }
    }
  });

  it('exposes the organization\'s preference beside, not inside, the judgment', async () => {
    await setAggressiveness(100);
    const prospects = await request(`/api/prospects/${ORG}`);
    const withPreference = (prospects.batters as Array<Record<string, any>>).find((p) => p.assignments.preference);
    expect(withPreference).toBeDefined();
    const summary = withPreference!.assignments.preference;
    expect(summary).toMatchObject({ promotionAggressiveness: 100, stance: 'advancement' });
    expect(summary).toHaveProperty('preferred');
    expect(summary.options.every((o: Record<string, any>) => ['preferred', 'acceptable', 'disfavored'].includes(o.preference)))
      .toBe(true);
    // Nothing indefensible or indeterminate is ever a preferred option
    for (const e of withPreference!.assignments.evaluations as Array<Record<string, any>>) {
      if (e.judgment !== 'defensible') expect(e.preference).toBeNull();
    }
  });
});
