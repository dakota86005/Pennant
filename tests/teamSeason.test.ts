import { beforeEach, describe, expect, it } from 'vitest';
import { getDataStatus } from '../server/dataStatus.js';
import { divisionPlace, readTeamSeason, type TeamSeasonFacts } from '../server/frontOffice/teamSeason.js';
import { readMorning } from '../server/morningReport.js';
import type { BuildContext } from '../server/presentation/frontOffice/desk.js';
import { gamesWords, lastFiveWords, morningWords, teamSeasonWords } from '../server/presentation/frontOffice/morning.js';
import { buildSave, dropColumn, dropTable, exec, type BuiltSave } from './syntheticSave';

/**
 * The masthead's box score (BEHAVIOR_CASES.md "Pennant for Mac", `teamSeason.test.ts`; D-057, D-060): objective facts
 * only, each as the export gives it, and a figure the export lacks is one sentence, never a zero or a guess. Built from
 * the synthetic save's season (`teamSeason: true`) and reshaped per case.
 */

const buildOf = (orgId: number): BuildContext => ({ orgId, club: 'Club 1 N', importStamp: null, reportStamp: 'r1', gameDate: '2040-5-5' });
const masthead = (save: BuiltSave) => {
  const material = readMorning(save.org, getDataStatus(), null);
  return { material, words: teamSeasonWords(buildOf(save.org), material) };
};
const missingPart = (words: ReturnType<typeof teamSeasonWords>, part: string) => words.missing.find((m) => m.part === part)?.line.display ?? null;

describe('the masthead reads the season as the export gives it', () => {
  let save: BuiltSave;
  beforeEach(() => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 6, seed: 11, teamSeason: true });
  });

  it('states the record from the standings, and the league is its own size, never assumed to be thirty', () => {
    const { material, words } = masthead(save);
    const row = material.facts.clubs.find((c) => c.teamId === save.org)!.record!;
    expect(words.record?.value?.display).toBe(`${row.w}–${row.l}`);
    expect(words.record?.basis.certainty).toBe('fact');
    expect(material.facts.clubs).toHaveLength(6);
    expect(words.place?.claim.place?.of).toBe(3);
    expect(words.missing).toEqual([]);
  });

  it('reads the division place from the standings\' order, games back beside it; a tie only on equal winning percentages', () => {
    // Two division rivals with the same winning percentage, a game and a half behind the leader (club 1)
    exec(`UPDATE team_record SET w = 20, l = 10, pct = 0.667, pos = 1, gb = 0 WHERE team_id = 1`);
    exec(`UPDATE team_record SET w = 18, l = 13, pct = 0.581, pos = 2, gb = 1.5 WHERE team_id = 2`);
    exec(`UPDATE team_record SET w = 18, l = 13, pct = 0.581, pos = 3, gb = 1.5 WHERE team_id = 3`);
    let place = divisionPlace(readTeamSeason(3))!;
    expect(place).toMatchObject({ rank: 2, of: 3, tiedWith: 1, gamesBack: 1.5, gamesAhead: null, source: 'exported', order: 'standings' });
    const words = teamSeasonWords(buildOf(3), { ...readMorning(3, getDataStatus(), null), division: place });
    expect(words.place?.claim.text).toBe('Tied for 2nd in the East · 1½ back');
    expect(words.place?.claim.basis.because.find((b) => b.label === 'Level with')?.value).toMatch(/same winning percentage/);
    // The leader alone: how far ahead of the next club
    place = divisionPlace(readTeamSeason(1))!;
    expect(place).toMatchObject({ rank: 1, tiedWith: 0, gamesBack: 0, gamesAhead: 1.5 });
  });

  it('never calls level games back a tie: the standings\' order places the better percentage first (the real save\'s NL West)', () => {
    // 26–17 (.605) and 27–18 (.600): the same wins less losses, so both 0 games back, but OOTP places the first 1st
    exec(`UPDATE team_record SET w = 26, l = 17, pct = 0.605, pos = 1, gb = 0 WHERE team_id = 1`);
    exec(`UPDATE team_record SET w = 27, l = 18, pct = 0.6, pos = 2, gb = 0 WHERE team_id = 2`);
    exec(`UPDATE team_record SET w = 20, l = 25, pct = 0.444, pos = 3, gb = 7 WHERE team_id = 3`);
    const first = divisionPlace(readTeamSeason(1))!;
    expect(first).toMatchObject({ rank: 1, tiedWith: 0, gamesBack: 0, gamesAhead: 0 });
    const words = teamSeasonWords(buildOf(1), { ...readMorning(1, getDataStatus(), null), division: first });
    expect(words.place?.claim.text).toBe('1st in the East');
    // The basis names the level games back and why the order is the standings' own (N6 polish)
    const level = words.place!.claim.basis.because.find((b) => b.label === 'Level on games back');
    expect(level?.value).toMatch(/\(\.600\): level with us \(\.605\) on games back; the place is the standings' own order$/);
    expect(divisionPlace(readTeamSeason(2))).toMatchObject({ rank: 2, tiedWith: 0, gamesBack: 0 });
    // The runner-up's basis names it too, from its side
    const second = teamSeasonWords(buildOf(2), { ...readMorning(2, getDataStatus(), null), division: divisionPlace(readTeamSeason(2))! });
    expect(second.place?.claim.basis.because.find((b) => b.label === 'Level on games back')?.value).toMatch(/\(\.605\): level with us \(\.600\)/);
    const parts = morningWords(buildOf(1), { ...readMorning(1, getDataStatus(), null), division: first });
    expect(parts.lede?.text).toMatch(/^First in the East\./);
  });

  it('counts the place from the records where the standings give no order, and says so', () => {
    exec(`UPDATE team_record SET pos = NULL`);
    exec(`UPDATE team_record SET w = 20, l = 10, pct = 0.667 WHERE team_id = 1`);
    exec(`UPDATE team_record SET w = 22, l = 12, pct = 0.647 WHERE team_id = 2`);
    exec(`UPDATE team_record SET w = 10, l = 20, pct = 0.333 WHERE team_id = 3`);
    const place = divisionPlace(readTeamSeason(2))!;
    expect(place).toMatchObject({ rank: 2, tiedWith: 0, order: 'records' });
    const words = teamSeasonWords(buildOf(2), { ...readMorning(2, getDataStatus(), null), division: place });
    expect(words.place?.claim.basis.unknown.join(' ')).toMatch(/counted from the records: winning percentage, then wins less losses/);
  });

  it('counts games back from the wins and losses where the standings give none, and says so', () => {
    exec(`UPDATE team_record SET gb = NULL`);
    const place = divisionPlace(readTeamSeason(save.org))!;
    expect(place.source).toBe('records');
    const { words } = masthead(save);
    expect(words.place?.claim.basis.unknown.join(' ')).toMatch(/counted from the wins and losses/);
  });

  it('writes games back as the standings do', () => {
    expect([0.5, 1, 2.5, 12].map(gamesWords)).toEqual(['½', '1', '2½', '12']);
  });

  it('takes runs scored and allowed from the club\'s own season totals, with the running differential from the games', () => {
    const { material, words } = masthead(save);
    const me = material.facts.clubs.find((c) => c.teamId === save.org)!;
    expect(words.runs?.scored).toBe(me.totals.batting!.r);
    expect(words.runs?.allowed).toBe(me.totals.pitching!.r);
    expect(words.runs?.claim.value?.n).toBe(words.runs!.scored - words.runs!.allowed);
    expect(words.runs!.trend.length).toBe(20);
    // The trend ends where the season's games leave the differential
    expect(words.runs!.trend.at(-1)).toBe(words.runs!.diff);
  });

  it('reads the club\'s one row at the major league this season, never a placeholder row or another level\'s', () => {
    exec(`INSERT INTO team_batting_stats (team_id, year, league_id, level_id, split_id, g, r) VALUES (${save.org}, 0, 0, 0, 0, 0, 0)`);
    exec(`INSERT INTO team_batting_stats (team_id, year, league_id, level_id, split_id, g, r) VALUES (${save.org}, 2040, 101, 2, 0, 30, 999)`);
    const me = readTeamSeason(save.org).clubs.find((c) => c.teamId === save.org)!;
    expect(me.totals.batting?.r).not.toBe(999);
    expect(me.duplicated).toEqual([]);
  });

  it('leaves a figure the export lacks out, with one sentence, never a zero', () => {
    dropTable('team_pitching_stats');
    dropTable('games');
    const { words } = masthead(save);
    expect(words.runs).toBeNull();
    expect(missingPart(words, 'runs')).toMatch(/no runs scored and allowed/);
    expect(words.lastFive).toBeNull();
    expect(missingPart(words, 'lastFive')).toMatch(/schedule/);
    expect(words.tonight).toBeNull();
    expect(missingPart(words, 'tonight')).toMatch(/schedule/);
    expect(JSON.stringify(words)).not.toMatch(/"display":"0"|"display":"—"/);
  });

  it('shows the last five and the streak from the games played', () => {
    const { words } = masthead(save);
    expect(words.lastFive?.results).toHaveLength(5);
    expect(words.lastFive!.results.every((r) => r === 'W' || r === 'L')).toBe(true);
    expect(words.streak?.display).toMatch(/^(Won|Lost) \d+$/);
    expect(words.lastFive!.line.display).toContain(words.streak!.display);
  });

  it('counts the ties in the last five\'s line, where there are any (N6 B1 review)', () => {
    expect(lastFiveWords(null, ['W', 'T', 'L', 'W', 'W'])).toBe('Last five 3–1–1');
    expect(lastFiveWords('Won 2', ['W', 'T', 'L', 'W', 'W'])).toBe('Won 2 · last five 3–1–1');
    expect(lastFiveWords('Lost 1', ['W', 'W', 'L', 'W', 'L'])).toBe('Lost 1 · last five 3–2');
    expect(lastFiveWords(null, ['T', 'W', 'L'])).toBe('Last three 1–1–1');
  });
});

describe('the next game, only as the export schedules it', () => {
  let save: BuiltSave;
  beforeEach(() => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
  });

  it('names the opponent, where, when and the probable starters as OOTP projects them', () => {
    const { material, words } = masthead(save);
    const t = words.tonight!;
    expect(t.gameId).toBe(material.facts.next!.gameId);
    expect(t.when.display).toMatch(/^Tonight · 7:05 PM$/);
    expect(t.matchup.display).toMatch(/^(vs|at) Club \d N$/);
    expect(t.ours?.playerId).toBe(material.facts.projected.find((p) => p.teamId === save.org)!.starters[0]);
    expect(t.ours?.line.display).toMatch(/ERA|innings/);
    expect(t.opponent.record?.display).toMatch(/^\d+–\d+$/);
    // N9: Tonight opens the schedule on this game, its plan beneath
    expect(t.open).toEqual({ kind: 'view', department: 'majorLeague', view: 'scheduleGamePlans', key: String(t.gameId) });
  });

  it('says the starters are not known when the export projects none, and names no one', () => {
    dropTable('projected_starting_pitchers');
    const { words } = masthead(save);
    expect(words.tonight?.ours).toBeNull();
    expect(words.tonight?.theirs).toBeNull();
    expect(words.tonight?.starters.display).toBe('Starters not known');
    expect(words.tonight?.claim.basis.unknown.length).toBeGreaterThan(0);
  });

  it('never takes a game left unplayed before the league\'s day (a postponement) as the next one, and gives the local start time', () => {
    const { material } = masthead(save);
    const next = material.facts.next!;
    // An unplayed game of ours dated the day before the league's day, earlier in the schedule than the real next one
    exec(`INSERT INTO games (game_id, league_id, home_team, away_team, date, played, time, game_type, runs0, runs1, innings)
      VALUES (99999, ${save.leagueId}, ${save.org}, ${next.home === save.org ? next.away : next.home}, '2040-5-4', 0, 1305, 0, 0, 0, 0)`);
    const { words } = masthead(save);
    expect(words.tonight?.gameId).toBe(next.gameId);
    expect(words.tonight?.when.hint).toMatch(/7:05 PM local start, as the export gives it/);
  });

  it('shows no next game when the export schedules none, and says why', () => {
    exec(`DELETE FROM games WHERE played = 0`);
    const { words } = masthead(save);
    expect(words.tonight).toBeNull();
    expect(missingPart(words, 'tonight')).toMatch(/schedules no more games for the club from the league's day on/);
  });
});

describe('the trade deadline, only from the league\'s own row', () => {
  let save: BuiltSave;
  beforeEach(() => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
  });

  it('counts the days from the league\'s day to the deadline the league gives', () => {
    exec(`UPDATE leagues SET trade_deadline_date = '2040-5-23' WHERE league_id = ${save.leagueId}`);
    const { words } = masthead(save);
    expect(words.deadline).toMatchObject({ gameDate: '2040-5-23', daysLeft: 17, passed: false });
    expect(words.deadline?.count.display).toBe('17 days');
    expect(words.deadline?.claim.basis.certainty).toBe('fact');
  });

  it('says a deadline that has passed has passed', () => {
    exec(`UPDATE leagues SET trade_deadline_date = '2040-4-30' WHERE league_id = ${save.leagueId}`);
    const { words } = masthead(save);
    expect(words.deadline).toMatchObject({ passed: true, daysLeft: -6 });
    expect(words.deadline?.count.display).toBe('Passed');
  });

  it('never assumes a major-league date: a blank deadline or none in the export is not shown, with why', () => {
    exec(`UPDATE leagues SET trade_deadline_date = NULL WHERE league_id = ${save.leagueId}`);
    let words = masthead(save).words;
    expect(words.deadline).toBeNull();
    expect(missingPart(words, 'deadline')).toBe('The league\'s row gives no trade deadline.');
    dropColumn('leagues', 'trade_deadline_date');
    words = masthead(save).words;
    expect(words.deadline).toBeNull();
    expect(missingPart(words, 'deadline')).toBe('The export doesn\'t carry the league\'s trade deadline.');
    expect(JSON.stringify(words)).not.toMatch(/July 31|Jul 31|August 3/);
  });
});

describe('the masthead is objective facts only (D-060)', () => {
  it('stamps every masthead claim as a fact from the export', () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 6, seed: 11, teamSeason: true });
    const material = readMorning(save.org, getDataStatus(), null);
    const parts = morningWords(buildOf(save.org), material);
    const ts = parts.teamSeason!;
    for (const c of [ts.record, ts.place?.claim, ts.runs?.claim, ts.tonight?.claim, ts.deadline?.claim]) {
      expect(c?.basis.certainty).toBe('fact');
    }
  });

  it('reads nothing from a club it cannot find in its league: every part says why', () => {
    const facts: TeamSeasonFacts = { ...readTeamSeason(1), orgId: 999 };
    expect(divisionPlace(facts)).toBeNull();
  });
});
