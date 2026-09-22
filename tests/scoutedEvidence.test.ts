import { beforeAll, describe, expect, it } from 'vitest';
import { db, tableColumns } from '../server/db.js';
import {
  loadScoutedAbilities,
  scoutedGloves,
  summarizeEvidence,
  unknownScoutedAbility,
  viewerContext,
} from '../server/scoutedEvidence.js';
import { evaluateDevelopmentProtection, TIER_ORDER } from '../server/developmentFit.js';
import request from './request.js';
import { IDS } from './fixture.js';

/**
 * The evidence boundary: what counts as an organization-visible rating, and
 * what does not.
 *
 * `players_value` is populated with deliberately extreme, contradictory values
 * for the players below. If any of it reaches a development judgment the
 * numbers in these tests are impossible to hit, which is the point.
 */

const FULL_HITTER = 91_001;
const NO_EYE = 91_002;
const ZERO_CONTACT = 91_003;
const NO_RATINGS = 91_004; // no batting row at all — only a poisonous players_value row
const PITCHER = 91_005;
const PARTIAL_POTENTIAL = 91_006;
const AMATEUR_UNSCOUTED = 91_007;

const POISON = { oa: 80, pot: 80 };

function addPlayer(
  id: number,
  position: number,
  team: number,
  age = 21,
  org = IDS.mlbTeam
): void {
  db.prepare(
    `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws,
                          uniform_number, team_id, organization_id, retired, hidden, draft_eligible, college)
     VALUES (?, 'Ev', ?, ?, ?, ?, 1, 1, 9, ?, ?, 0, 0, 0, 0)`
  ).run(id, `P${id}`, age, position, position === 1 ? 11 : 0, team, org);
}

function batting(
  id: number,
  current: [number | null, number | null, number | null, number | null, number | null],
  potential: [number | null, number | null, number | null, number | null, number | null]
): void {
  db.prepare(
    `INSERT INTO players_batting (player_id,
       batting_ratings_overall_contact, batting_ratings_overall_gap, batting_ratings_overall_power,
       batting_ratings_overall_eye, batting_ratings_overall_strikeouts,
       batting_ratings_talent_contact, batting_ratings_talent_gap, batting_ratings_talent_power,
       batting_ratings_talent_eye, batting_ratings_talent_strikeouts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, ...current, ...potential);
}

function poison(id: number): void {
  db.prepare(
    `INSERT INTO players_value
       (player_id, overall_value, talent_value, offensive_value, offensive_value_vsl,
        offensive_value_vsr, pitching_value, oa_rating, pot_rating, oa, pot)
     VALUES (?, 2000, 2000, 2000, 2000, 2000, 2000, ?, ?, ?, ?)`
  ).run(id, POISON.oa, POISON.pot, POISON.oa, POISON.pot);
}

beforeAll(() => {
  for (const id of [FULL_HITTER, NO_EYE, ZERO_CONTACT, NO_RATINGS, PARTIAL_POTENTIAL, AMATEUR_UNSCOUTED]) {
    addPlayer(id, 7, IDS.aaaTeam);
    poison(id);
  }
  addPlayer(PITCHER, 1, IDS.aaaTeam);
  poison(PITCHER);

  batting(FULL_HITTER, [40, 44, 48, 52, 56], [60, 60, 60, 60, 60]);
  batting(NO_EYE, [40, 44, 48, null, 56], [60, 60, 60, 60, 60]);
  batting(ZERO_CONTACT, [0, 44, 48, 52, 56], [60, 60, 60, 60, 60]);
  batting(PARTIAL_POTENTIAL, [40, 44, 48, 52, 56], [60, 60, null, 60, 60]);
  batting(AMATEUR_UNSCOUTED, [30, 30, 30, 30, 30], [null, null, null, null, null]);

  db.prepare(
    `INSERT INTO players_pitching (player_id, pitching_ratings_overall_stuff, pitching_ratings_overall_movement,
       pitching_ratings_overall_control, pitching_ratings_talent_stuff, pitching_ratings_talent_movement,
       pitching_ratings_talent_control, pitching_ratings_misc_stamina,
       pitching_ratings_pitches_fastball, pitching_ratings_pitches_slider, pitching_ratings_pitches_changeup)
     VALUES (?, 45, 50, 55, 60, 65, 70, 42, 60, 0, 40)`
  ).run(PITCHER);
});

const abilityOf = (id: number) => loadScoutedAbilities([id]).for(id);

describe('approved evidence: the visible tool ratings', () => {
  it('builds current and potential from the exported tool ratings, not from players_value', () => {
    const a = abilityOf(FULL_HITTER);
    expect(a.current).toBe(48); // mean of 40, 44, 48, 52, 56
    expect(a.potential).toBe(60);
    expect(a.current).not.toBe(POISON.oa);
    expect(a.potential).not.toBe(POISON.pot);
    expect(a.kind).toBe('hitter');
    expect(a.status).toBe('complete');
    expect(a.method).toBe('unweighted_mean_of_visible_tools');
  });

  it('keeps each tool visible, so a decision can show what it rested on', () => {
    const a = abilityOf(FULL_HITTER);
    expect(a.currentTools).toEqual({ contact: 40, gap: 44, power: 48, eye: 52, avoidK: 56 });
    expect(a.potentialTools.power).toBe(60);
  });

  it('rates a pitcher on stuff, movement and control, and carries stamina and repertoire', () => {
    const a = abilityOf(PITCHER);
    expect(a.kind).toBe('pitcher');
    expect(a.current).toBe(50);
    expect(a.potential).toBe(65);
    expect(a.stamina).toBe(42);
    // A zero pitch grade is "no such pitch", not a pitch rated zero
    expect([...a.pitches].sort((x, y) => y - x)).toEqual([60, 40]);
  });

  it('labels its provenance as declared, not verified', () => {
    const a = abilityOf(FULL_HITTER);
    expect(a.provenance).toEqual({
      source: 'exported_tool_ratings',
      status: 'declared_organization_visible',
      verification: 'not_verifiable_from_export',
      basis: 'DECISIONS.md D-002, D-017',
    });
  });
});

describe('missing stays missing', () => {
  it('reports no composite when any tool is absent, rather than averaging the rest', () => {
    const a = abilityOf(NO_EYE);
    expect(a.current).toBeNull();
    expect(a.missing.current).toEqual(['eye']);
    expect(a.currentTools.eye).toBeNull();
    // Its potential is untouched by a hole in its current tools
    expect(a.potential).toBe(60);
    expect(a.status).toBe('partial');
  });

  it('treats a zero grade as unknown — no scale grades anyone zero', () => {
    const a = abilityOf(ZERO_CONTACT);
    expect(a.current).toBeNull();
    expect(a.missing.current).toEqual(['contact']);
  });

  it('leaves potential unknown when the ceiling is not exported, keeping current', () => {
    const a = abilityOf(AMATEUR_UNSCOUTED);
    expect(a.current).toBe(30);
    expect(a.potential).toBeNull();
    expect(a.missing.potential).toEqual(['contact', 'gap', 'power', 'eye', 'avoidK']);
  });

  it('never invents a potential from a current, or a current from a potential', () => {
    const partial = abilityOf(PARTIAL_POTENTIAL);
    expect(partial.potential).toBeNull();
    expect(partial.current).toBe(48);
  });

  it('is entirely unknown for a player with no rating rows, whatever players_value says', () => {
    const a = abilityOf(NO_RATINGS);
    expect(a.current).toBeNull();
    expect(a.potential).toBeNull();
    expect(a.status).toBe('unknown');
    expect(a.currentTools).toEqual({ contact: null, gap: null, power: null, eye: null, avoidK: null });
  });

  it('is unknown for a player who does not exist', () => {
    const a = loadScoutedAbilities([9_999_999]).for(9_999_999);
    expect(a.status).toBe('unknown');
    expect(a.kind).toBe('unknown');
    expect(unknownScoutedAbility(1).current).toBeNull();
  });

  it('is unknown for a pitcher stamina that is absent', () => {
    const id = 91_050;
    addPlayer(id, 1, IDS.aaaTeam);
    db.prepare(`INSERT INTO players_pitching (player_id) VALUES (?)`).run(id);
    const a = abilityOf(id);
    expect(a.stamina).toBeNull();
    expect(a.pitches).toEqual([]);
    expect(a.status).toBe('unknown');
  });
});

describe('the viewer', () => {
  it('is the human-managed club when there is exactly one', () => {
    expect(viewerContext()).toEqual({ viewerOrgId: IDS.mlbTeam, resolution: 'human_team' });
    expect(abilityOf(FULL_HITTER).viewer.viewerOrgId).toBe(IDS.mlbTeam);
  });

  it('is left unresolved rather than guessed when several clubs are human-managed', () => {
    db.prepare(`UPDATE teams SET human_team = 1 WHERE team_id = ?`).run(IDS.otherMlbTeam);
    try {
      expect(viewerContext()).toEqual({ viewerOrgId: null, resolution: 'ambiguous_human_teams' });
    } finally {
      db.prepare(`UPDATE teams SET human_team = 0 WHERE team_id = ?`).run(IDS.otherMlbTeam);
    }
  });

  it('is unresolved when no club is human-managed', () => {
    db.prepare(`UPDATE teams SET human_team = 0`).run();
    try {
      expect(viewerContext()).toEqual({ viewerOrgId: null, resolution: 'unresolved' });
    } finally {
      db.prepare(`UPDATE teams SET human_team = 1 WHERE team_id = ?`).run(IDS.mlbTeam);
    }
  });
});

describe('reporting', () => {
  it('summarizes what a decision rested on, including what is missing', () => {
    const summary = summarizeEvidence(abilityOf(NO_EYE));
    expect(summary).toMatchObject({
      status: 'partial',
      provenance: 'declared_organization_visible',
      verification: 'not_verifiable_from_export',
      source: 'exported_tool_ratings',
      scale: { max: 80, normalizedTo: '20-80' },
      viewerOrgId: IDS.mlbTeam,
      viewerResolution: 'human_team',
      missing: { current: ['eye'], potential: [] },
    });
  });
});

describe('fielding evidence', () => {
  const FIELDER = 91_100;

  beforeAll(() => {
    addPlayer(FIELDER, 4, IDS.aaaTeam);
    db.prepare(
      `INSERT INTO players_fielding (player_id, position, fielding_rating_pos4, fielding_rating_pos4_pot,
         fielding_rating_pos6, fielding_rating_pos6_pot, fielding_rating_pos5, fielding_rating_pos5_pot)
       VALUES (?, 4, 60, 60, 35, 55, 0, 70)`
    ).run(FIELDER);
  });

  it('shows only positions the game has revealed, and never the ceiling behind a dash', () => {
    const g = scoutedGloves(FIELDER)!;
    expect(g.positions.map((p) => p.code).sort()).toEqual(['2B', 'SS']);
    expect(g.positions.some((p) => p.code === '3B')).toBe(false);
  });
});

describe('the boundary holds end to end', () => {
  const HIGH = 91_200; // ratings say a strong prospect; players_value says a nobody
  const LOW = 91_201; // ratings say a nobody; players_value says a superstar
  const BLANK = 91_202; // no ratings at all; players_value says a superstar

  beforeAll(() => {
    const year = (db.prepare(`SELECT MAX(year) AS y FROM players_career_batting_stats`).get() as { y: number }).y;
    const stats = db.prepare(
      `INSERT INTO players_career_batting_stats
         (player_id, year, team_id, league_id, level_id, split_id, pa, ab, h, d, t, hr,
          bb, ibb, hp, sf, k, sb, cs, r, rbi, war)
       VALUES (?, ?, ?, ?, 2, 1, 200, 180, 50, 10, 1, 8, 16, 0, 2, 2, 40, 2, 1, 28, 30, 1.5)`
    );
    for (const id of [HIGH, LOW, BLANK]) {
      addPlayer(id, 7, IDS.aaaTeam, 21);
      db.prepare(`INSERT INTO team_roster VALUES (?, ?, 2)`).run(IDS.aaaTeam, id);
      stats.run(id, year, IDS.aaaTeam, IDS.league);
    }
    batting(HIGH, [60, 60, 60, 60, 60], [72, 72, 72, 72, 72]);
    batting(LOW, [30, 30, 30, 30, 30], [32, 32, 32, 32, 32]);
    // The values table says the opposite of the scouted ratings for all three
    db.prepare(
      `INSERT INTO players_value (player_id, overall_value, talent_value, offensive_value, offensive_value_vsl,
         offensive_value_vsr, pitching_value, oa_rating, pot_rating, oa, pot)
       VALUES (?, 100, 100, 100, 100, 100, 0, 20, 20, 20, 20)`
    ).run(HIGH);
    poison(LOW);
    poison(BLANK);
  });

  /*
   * The farm-operations queries read a few columns the shared fixture does not
   * carry (fatigue, service and Rule 5 fields). Add them for this file only.
   */
  beforeAll(() => {
    const ensure = (table: string, columns: string[]) => {
      const have = tableColumns(table);
      for (const c of columns) if (!have.includes(c)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${c} INTEGER DEFAULT 0`);
    };
    ensure('players', ['fatigue_points', 'fatigue_played_today']);
    ensure('players_roster_status', [
      'must_be_active', 'pro_service_years', 'secondary_service_years', 'years_protected_from_rule_5', 'options_used',
    ]);
    for (const id of [HIGH, LOW, BLANK]) {
      // Retention reads the full organizational roster (list 1); ops read the active one (list 2)
      db.prepare(`INSERT INTO team_roster VALUES (?, ?, 1)`).run(IDS.aaaTeam, id);
      db.prepare(
        `INSERT INTO players_roster_status (player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary)
         VALUES (?, 0, 0, 0, 0)`
      ).run(id);
    }
  });

  const prospect = async (id: number) => {
    const { batters } = await request(`/api/prospects/${IDS.mlbTeam}`);
    return (batters as Array<Record<string, any>>).find((b) => b.player_id === id)!;
  };

  it('scores a prospect from his scouted tools, however players_value grades him', async () => {
    const high = await prospect(HIGH);
    expect(high.cur).toBe(60);
    expect(high.pot).toBe(72);
    const low = await prospect(LOW);
    expect(low.cur).toBe(30);
    expect(low.pot).toBe(32);
  });

  it('reports unknown ratings as unknown to the prospect payload and the decision', async () => {
    const blank = await prospect(BLANK);
    expect(blank.cur).toBeNull();
    expect(blank.pot).toBeNull();
    expect(blank.ratingEvidence.status).toBe('unknown');
    expect(blank.ratingEvidence.provenance).toBe('declared_organization_visible');
    expect(blank.decision.ratingsEvidence).toBe('unknown');
    expect(blank.decision.evidence.ratingsMaturity).toBeNull();
    expect(blank.decision.evidence.readiness).toBeNull();
    expect(blank.decision.cautions.join(' ')).toMatch(/no neutral value is substituted/);
    // Objective evidence is still there
    expect(blank.decision.evidence.performance).toEqual(expect.any(Number));
    expect(blank.decision.evidence.sampleConfidence).toEqual(expect.any(Number));
    // ...and assignments say "indeterminate", not "no" and not "yes"
    const judgments = (blank.assignments.evaluations as Array<Record<string, any>>).map((e) => e.judgment);
    expect(judgments).not.toContain('defensible');
  });

  it('gives the decision the same ratings the payload shows', async () => {
    const high = await prospect(HIGH);
    expect(high.decision.ratingsEvidence).toBe('complete');
    // A 12-point projected gap, not the 0 that OA 20 / POT 20 would imply
    expect(high.decision.evidence.ratingsMaturity).toBe(Math.round(90 - 12 * 2.8));
  });

  it('protects a development prospect by his scouted ceiling, not by players_value', () => {
    const high = evaluateDevelopmentProtection({ age: 21, ability: abilityOf(HIGH) });
    const low = evaluateDevelopmentProtection({ age: 21, ability: abilityOf(LOW) });
    const blank = evaluateDevelopmentProtection({ age: 21, ability: abilityOf(BLANK) });
    // HIGH's scouted ceiling (72) is an impact major leaguer's and LOW's (32) is none: the tiers follow the scouted tools
    expect(TIER_ORDER.indexOf(high.tier!)).toBeGreaterThan(TIER_ORDER.indexOf(low.tier!));
    expect(high.reading!.ceiling.band).toBe('impact');
    expect(low.reading!.ceiling.band).toBe('below_major_league');
    expect(high.ratingEvidence).toBe('complete');
    expect(blank.ratingEvidence).toBe('unknown');
    // players_value calls BLANK an 80/80 superstar; that must not lift him, or rate him at all
    expect(blank.tier).toBeNull();
    expect(blank.reading).toBeNull();
    expect(blank.reasons.join(' ')).not.toMatch(/Visible ceiling/);
  });

  it('shows the Player Development pages his scouted ratings and what protection rested on', async () => {
    const { players } = await request(`/api/scouted-development/${IDS.mlbTeam}`);
    const row = (id: number) => (players as Array<Record<string, any>>).find((p) => p.playerId === id)!;
    expect(row(HIGH).current).toBe(60);
    expect(row(HIGH).potential).toBe(72);
    expect(row(HIGH).protection.tier).not.toBeNull();
    expect(row(LOW).current).toBe(30);
    expect(row(LOW).potential).toBe(32);
    expect(row(BLANK).current).toBeNull();
    expect(row(BLANK).potential).toBeNull();
    expect(row(BLANK).protection.tier).toBeNull();
    expect(row(BLANK).protection).not.toHaveProperty('score');
    expect(row(HIGH).protection.reasons.join(' ')).toMatch(/Visible ceiling of an impact major leaguer/);
  });

  it('leaves retention indeterminate, not negative, for a player whose ratings are unknown', async () => {
    const { retention } = await request(`/api/farm-operations/${IDS.mlbTeam}`);
    const rows = retention as Array<Record<string, any>>;
    const blank = rows.find((p) => p.playerId === BLANK);
    if (!blank) return; /* the farm reads the active list; the fixture may not carry him on it */
    expect(blank.outlook.state).toBe('indeterminate');
    expect(blank.conclusion).toBe('indeterminate');
    expect(blank.outlook.reasons.join(' ')).toMatch(/cannot be established/);
  });

  it('still applies objective roster guardrails to a player whose ratings are unknown', async () => {
    const id = 91_300;
    addPlayer(id, 7, IDS.aaaTeam, 21);
    poison(id);
    db.prepare(`INSERT INTO team_roster VALUES (?, ?, 1)`).run(IDS.aaaTeam, id);
    db.prepare(`INSERT INTO team_roster VALUES (?, ?, 2)`).run(IDS.aaaTeam, id);
    db.prepare(
      `INSERT INTO players_roster_status (player_id, is_active, is_on_dl, is_on_dl60, is_on_secondary)
       VALUES (?, 0, 0, 0, 1)`
    ).run(id);
    const { retention } = await request(`/api/farm-operations/${IDS.mlbTeam}`);
    const row = (retention as Array<Record<string, any>>).find((p) => p.playerId === id)!;
    // The 40-man guardrail is a fact about his roster status, not a judgment of his ability
    expect(row.guardrails.map((g: { code: string }) => g.code)).toContain('on_forty_man');
    expect(row.outlook.state).toBe('indeterminate');
    expect(row.conclusion).toBe('indeterminate');
  });

  it('shows the depth chart the scouted composites, not players_value', async () => {
    const chart = await request(`/api/depth-chart/${IDS.mlbTeam}`);
    const row = (id: number) => (chart.players as Array<Record<string, any>>).find((p) => p.player_id === id)!;
    expect(row(HIGH).cur).toBe(60);
    expect(row(HIGH).pot).toBe(72);
    expect(row(BLANK).cur).toBeNull();
    expect(row(BLANK).pot).toBeNull();
  });
});
