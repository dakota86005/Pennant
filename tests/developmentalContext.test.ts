import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { openDevelopmentalContext } from '../server/developmentalContext.js';
import { LEAGUE_POPULATION_MINIMUM } from '../server/farmCalibration.js';
import { syntheticScoutedAbility } from '../server/scoutedEvidence.js';

/**
 * The one peer frame the stakes model reads, against real SQL (docs/DEVELOPMENTAL_STAKES.md §4.3).
 *
 *   the rostered players of a player's own league at his own level, for their average age
 *
 * The failures it is built against were each measured on a real import in an earlier phase: signings
 * nobody has assigned contaminating a population (D-039, F-0-farm), one level code treated as one peer
 * group across leagues years apart in age (F-1-farm), and a tiny league read as a precise one.
 */

const LEVEL = 6;
const YOUNG_LEAGUE = 920; // a Dominican-style league: teenagers
const OLD_LEAGUE = 921; // a complex-style league at the SAME level code: two years older
const THIN_LEAGUE = 922; // six rostered players
const LONELY_LEVEL = 8; // a level with one thin league and nothing to pool with
const LONELY_LEAGUE = 923;
const YOUNG_CLUB = 9200;
const OLD_CLUB = 9201;
const THIN_CLUB = 9202;
const LONELY_CLUB = 9203;

const playerIds: number[] = [];

function club(teamId: number, level: number, leagueId: number, name: string): void {
  db.prepare(
    `INSERT INTO teams (team_id, name, nickname, abbr, level, league_id, sub_league_id, division_id, parent_team_id, allstar_team)
     VALUES (?, ?, 'Club', 'CLB', ?, ?, 0, 0, 0, 0)`
  ).run(teamId, name, level, leagueId);
}

function man(playerId: number, teamId: number, age: number, rostered = true): void {
  db.prepare(
    `INSERT INTO players (player_id, first_name, last_name, age, position, role, bats, throws, uniform_number, team_id, organization_id, retired, hidden, draft_eligible, college)
     VALUES (?, 'Peer', ?, ?, 7, 0, 1, 1, 0, ?, 0, 0, 0, 0, 0)`
  ).run(playerId, `P${playerId}`, age, teamId);
  if (rostered) db.prepare(`INSERT INTO team_roster (team_id, player_id, list_id) VALUES (?, ?, 1)`).run(teamId, playerId);
  playerIds.push(playerId);
}

beforeAll(() => {
  club(YOUNG_CLUB, LEVEL, YOUNG_LEAGUE, 'Young');
  club(OLD_CLUB, LEVEL, OLD_LEAGUE, 'Old');
  club(THIN_CLUB, LEVEL, THIN_LEAGUE, 'Thin');
  club(LONELY_CLUB, LONELY_LEVEL, LONELY_LEAGUE, 'Lonely');
  for (let i = 0; i < 40; i++) man(92000 + i, YOUNG_CLUB, 18);
  for (let i = 0; i < 40; i++) man(92100 + i, OLD_CLUB, 21);
  for (let i = 0; i < 6; i++) man(92200 + i, THIN_CLUB, 30);
  for (let i = 0; i < 6; i++) man(92300 + i, LONELY_CLUB, 17);
});

afterAll(() => {
  for (const id of playerIds) {
    db.prepare('DELETE FROM players WHERE player_id = ?').run(id);
    db.prepare('DELETE FROM team_roster WHERE player_id = ?').run(id);
  }
  for (const teamId of [YOUNG_CLUB, OLD_CLUB, THIN_CLUB, LONELY_CLUB]) db.prepare('DELETE FROM teams WHERE team_id = ?').run(teamId);
});

const fringe = syntheticScoutedAbility({ current: 30, potential: 47 });

describe('a league is the peer group, not a level', () => {
  it('reads the same 20-year-old against his own league: behind one league\'s schedule and not the other\'s', () => {
    const stakes = openDevelopmentalContext();
    const inYoung = stakes.forClub(20, YOUNG_CLUB)!;
    const inOld = stakes.forClub(20, OLD_CLUB)!;
    expect(inYoung.ageProfile).toMatchObject({ scope: 'league', players: 40, averageAge: 18 });
    expect(inOld.ageProfile).toMatchObject({ scope: 'league', players: 40, averageAge: 21 });
    expect(inYoung.ageRelativeToLevel).toBe(-2);
    expect(inOld.ageRelativeToLevel).toBe(1);
    expect(stakes.protect({ age: 20, teamId: YOUNG_CLUB, ability: fringe }).reading!.remaining.schedule).toBe('behind');
    expect(stakes.protect({ age: 20, teamId: OLD_CLUB, ability: fringe }).reading!.remaining.schedule).toBe('on_schedule');
  });
});

describe('a peer has to be on a roster', () => {
  it('does not let signings nobody has assigned move a league\'s age profile', () => {
    const before = openDevelopmentalContext().profile(LEVEL, OLD_LEAGUE);
    /* Thirty sixteen-year-olds parked on the club's team_id with no roster entry, as OOTP leaves them. */
    const parked = Array.from({ length: 30 }, (_, i) => 92400 + i);
    for (const id of parked) man(id, OLD_CLUB, 16, false);
    try {
      expect(openDevelopmentalContext().profile(LEVEL, OLD_LEAGUE)).toEqual(before);
    } finally {
      for (const id of parked) db.prepare('DELETE FROM players WHERE player_id = ?').run(id);
    }
  });

  it('does not count a retired man', () => {
    const before = openDevelopmentalContext().profile(LEVEL, YOUNG_LEAGUE);
    man(92500, YOUNG_CLUB, 45);
    db.prepare('UPDATE players SET retired = 1 WHERE player_id = 92500').run();
    expect(openDevelopmentalContext().profile(LEVEL, YOUNG_LEAGUE)).toEqual(before);
  });
});

describe('a population too thin to describe itself', () => {
  it('uses the level\'s pool, and says it did', () => {
    expect(6).toBeLessThan(LEAGUE_POPULATION_MINIMUM);
    const context = openDevelopmentalContext().forClub(24, THIN_CLUB)!;
    expect(context.ageProfile.scope).toBe('level');
    /* The pool is every rostered man at the level, the thin league's six thirty-year-olds included. */
    expect(context.ageProfile.players).toBe(86);
    expect(context.ageProfile.averageAge).not.toBe(30);
    const p = openDevelopmentalContext().protect({ age: 24, teamId: THIN_CLUB, ability: fringe });
    expect(p.reasons.join(' ')).toMatch(/too thin to describe itself/);
  });

  it('is not established when there is no pool either: nothing is discounted, and it is said', () => {
    const stakes = openDevelopmentalContext();
    const context = stakes.forClub(23, LONELY_CLUB)!;
    expect(context.ageProfile).toMatchObject({ scope: 'unavailable', averageAge: null });
    expect(context.ageRelativeToLevel).toBeNull();
    /* Six seventeen-year-olds would have called a 23-year-old far behind; six men are not a schedule. */
    const p = stakes.protect({ age: 23, teamId: LONELY_CLUB, ability: fringe });
    expect(p.reading!.remaining).toMatchObject({ schedule: 'not_established', byAge: 'some', state: 'some' });
    expect(p.reasons.join(' ')).toMatch(/could not be established/);
  });

  it('gives no context at all for a club the export does not describe', () => {
    const stakes = openDevelopmentalContext();
    expect(stakes.forClub(20, 987654)).toBeNull();
    const p = stakes.protect({ age: 20, teamId: 987654, ability: fringe });
    expect(p.tier).toBe('development_priority');
    expect(p.reasons.join(' ')).toMatch(/No level context was supplied/);
  });
});

describe('an unrelated player changes nothing about this one', () => {
  it('leaves his ceiling alone whatever the men around him are rated, because ratings are never read here', () => {
    const before = openDevelopmentalContext().protect({ age: 19, teamId: OLD_CLUB, ability: fringe });
    /* A reader opened after the league changed: one more rostered man, a year older than the rest. */
    man(92600, OLD_CLUB, 22);
    const after = openDevelopmentalContext().protect({ age: 19, teamId: OLD_CLUB, ability: fringe });
    expect(after.reading!.ceiling).toEqual(before.reading!.ceiling);
    expect(after.tier).toBe(before.tier);
  });

  it('reads the export once per reader and never across them', () => {
    const held = openDevelopmentalContext();
    const first = held.profile(LEVEL, YOUNG_LEAGUE);
    man(92700, YOUNG_CLUB, 40);
    /* The open reader is one request's view... */
    expect(held.profile(LEVEL, YOUNG_LEAGUE)).toEqual(first);
    /* ...and the next request sees the export as it now is: nothing is cached past a request. */
    expect(openDevelopmentalContext().profile(LEVEL, YOUNG_LEAGUE).players).toBe(first.players + 1);
  });
});

describe('an age the export does not state', () => {
  /*
   * `Number(null)` is 0, and every farm caller once passed `Number(row.age)`. An age of 0 read as
   * "most of his development ahead of him", so a man with no age would have had a firm tier made from
   * missing evidence. The reader now takes the age as the export has it and leaves the tier unknown.
   */
  it.each([null, undefined, 0, -1, Number.NaN])('leaves the tier indeterminate for an age of %s, and discounts nothing', (age) => {
    const p = openDevelopmentalContext().protect({ age: age as number | null | undefined, teamId: OLD_CLUB, ability: fringe });
    expect(p.tier).toBeNull();
    expect(p.reading).toBeNull();
    expect(p.reasons.join(' ')).toMatch(/his age is not known/);
    /* The ceiling, which IS known, is still said. */
    expect(p.reasons.join(' ')).toMatch(/Visible ceiling of a fringe major leaguer/);
    expect(openDevelopmentalContext().forClub(age as number | null | undefined, OLD_CLUB)!.ageRelativeToLevel).toBeNull();
  });

  it('is unknown even where a null age would have arrived as a zero', () => {
    /* The SQL row's age is null; `Number(null)` is 0; the tier must not become the tier of a newborn. */
    man(92800, OLD_CLUB, null as unknown as number);
    const raw = db.prepare('SELECT age FROM players WHERE player_id = 92800').get() as { age: number | null };
    expect(raw.age).toBeNull();
    expect(openDevelopmentalContext().protect({ age: raw.age, teamId: OLD_CLUB, ability: fringe }).tier).toBeNull();
    expect(openDevelopmentalContext().protect({ age: Number(raw.age), teamId: OLD_CLUB, ability: fringe }).tier).toBeNull();
  });
});
