import { beforeAll, describe, expect, it } from 'vitest';
import { db, tableColumns, tableExists } from '../server/db.js';
import {
  clubGameLogs,
  exportThrough,
  injuryAbsences,
  lastGamesElsewhere,
  projectedRotation,
  whereabouts,
} from '../server/farmUsage.js';
import { moundStarters, positionStarters, recentUsageFor } from '../server/farmRecentUsage.js';

/**
 * The game-log adapter, against real SQL.
 *
 * The pure window logic is tested on synthetic logs; this is where the export's own shape can go
 * wrong. Two traps were found on the real import and are pinned here: OOTP writes dates unpadded, so
 * `2030-5-9` sorts AFTER `2030-5-10` as text and a window cut by string order is the wrong fifteen
 * games; and doubleheaders exist, so a date is not an order.
 *
 * Each test file gets its own fixture database (`tests/setup.ts`), so the tables added here touch no
 * other suite. Club ids are far above the shared fixture's.
 */

const CLUB = 9001;
const OTHER = 9002;
const SHORTSTOP = 90010;
const MOVER = 90011;
const STARTER = 90012;
const HURT = 90013;

/** Unpadded, the way OOTP writes them. */
const ootpDate = (month: number, day: number): string => `2030-${month}-${day}`;

beforeAll(() => {
  if (!tableExists('players_game_batting')) {
    db.exec(`CREATE TABLE players_game_batting (player_id INTEGER, team_id INTEGER, game_id INTEGER, position INTEGER, gs INTEGER, pa INTEGER)`);
  }
  if (!tableColumns('players_game_pitching_stats').includes('team_id')) {
    db.exec(`ALTER TABLE players_game_pitching_stats ADD COLUMN team_id INTEGER`);
  }
  if (!tableExists('players_injury_history')) {
    db.exec(`CREATE TABLE players_injury_history (player_id INTEGER, date TEXT, length INTEGER, day_to_day INTEGER)`);
  }

  const game = db.prepare(`INSERT INTO games (game_id, home_team, away_team, date, played, league_id, time) VALUES (?, ?, ?, ?, ?, 100, ?)`);
  const bat = db.prepare(`INSERT INTO players_game_batting (player_id, team_id, game_id, position, gs, pa) VALUES (?, ?, ?, ?, ?, ?)`);
  const pitch = db.prepare(`INSERT INTO players_game_pitching_stats (player_id, team_id, game_id, pi, outs, gs) VALUES (?, ?, ?, 90, ?, ?)`);

  /*
   * Twenty games for CLUB from 5-1: days 1 to 18, with a doubleheader on day 9 and one more on day
   * 10. Inserted out of order, and with game ids that do NOT follow the calendar, so nothing but a
   * parsed date can order them.
   */
  const days = [10, 9, 9, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 10];
  const times = [1900, 1300, 1900, 1900, 1900, 1900, 1900, 1900, 1900, 1900, 1900, 1900, 1900, 1900, 1900, 1900, 1900, 1900, 1900, 1300];
  days.forEach((day, i) => {
    const id = 95000 - i * 7; /* descending ids on an ascending calendar */
    game.run(id, i % 2 === 0 ? CLUB : OTHER, i % 2 === 0 ? OTHER : CLUB, ootpDate(5, day), 1, times[i]);
    /* The shortstop starts at short (position 6) in every game except day 10's. */
    if (day !== 10) bat.run(SHORTSTOP, CLUB, id, 6, 1, 4);
    /* The mover plays for OTHER through day 8, then for CLUB from day 11 as a pinch hitter. */
    if (day <= 8) bat.run(MOVER, OTHER, id, 8, 1, 4);
    if (day >= 11) bat.run(MOVER, CLUB, id, 0, 0, 1);
    /* The starter takes the mound for CLUB on days 1, 6, 11 and 16. */
    if ([1, 6, 11, 16].includes(day)) pitch.run(STARTER, CLUB, id, 18, 1);
  });
  /* A scheduled game that has not been played is not part of any window. */
  game.run(99999, CLUB, OTHER, ootpDate(5, 19), 0, 1900);

  const injury = db.prepare(`INSERT INTO players_injury_history (player_id, date, length, day_to_day) VALUES (?, ?, ?, ?)`);
  injury.run(HURT, ootpDate(5, 3), 10, 0); /* a real absence */
  injury.run(HURT, ootpDate(5, 15), 4, 1); /* day-to-day: played through, says nothing about availability */
  injury.run(HURT, '2029-5-3', 20, 0); /* another season */
});

describe('a club\'s game log', () => {
  it('orders games by the parsed date, then first pitch, then id — never by the text of the date', () => {
    const log = clubGameLogs([CLUB]).get(CLUB)!;
    expect(log.available).toBe(true);
    expect(log.games).toHaveLength(20);
    const dates = log.games.map((g) => g.date);
    expect(dates).toEqual([...dates].sort());
    expect(dates[0]).toBe('2030-05-01');
    expect(dates[dates.length - 1]).toBe('2030-05-18');
    /* Text order would have put 2030-5-9 last, after 2030-5-18. */
    expect(dates.indexOf('2030-05-09')).toBeLessThan(dates.indexOf('2030-05-10'));
  });

  it('keeps both games of a doubleheader, the afternoon game first', () => {
    const log = clubGameLogs([CLUB]).get(CLUB)!;
    const ninth = log.games.filter((g) => g.date === '2030-05-09');
    const tenth = log.games.filter((g) => g.date === '2030-05-10');
    expect(ninth).toHaveLength(2);
    expect(tenth).toHaveLength(2);
    /* days[19] is the 13:00 game of the tenth and carries a LOWER position in insert order than its 19:00 twin. */
    expect(tenth[0].gameId).toBe(95000 - 19 * 7);
    expect(tenth[1].gameId).toBe(95000);
  });

  it('leaves out a scheduled game that has not been played', () => {
    expect(clubGameLogs([CLUB]).get(CLUB)!.games.some((g) => g.gameId === 99999)).toBe(false);
  });

  it('attributes a line to the club he played for that day, so a move splits a man\'s season between two logs', () => {
    const logs = clubGameLogs([CLUB, OTHER]);
    expect(logs.get(OTHER)!.lines.get(MOVER)).toHaveLength(8);
    expect(logs.get(CLUB)!.lines.get(MOVER)!.every((l) => !l.started && l.position === null)).toBe(true);
  });

  it('reads one starter at a position per game, and a man on the mound the same way', () => {
    const log = clubGameLogs([CLUB]).get(CLUB)!;
    const short = positionStarters(log, 'SS');
    expect(short.filter((id) => id === SHORTSTOP)).toHaveLength(13);
    expect(short.filter((id) => id === null)).toHaveLength(2); /* the tenth's doubleheader */
    expect(moundStarters(log).filter((id) => id === STARTER)).toHaveLength(3);
  });

  it('is unavailable for a club the export has no games for, which is not the same as nobody playing', () => {
    const log = clubGameLogs([9999]).get(9999)!;
    expect(log.available).toBe(false);
    expect(recentUsageFor({ log, playerId: 1, arrival: null, chronologyAvailable: true, lastGameElsewhere: null, absences: [] })).toBeNull();
  });
});

describe('the dated facts beside the log', () => {
  it('bounds an arrival by the last day a man played for somebody else', () => {
    const last = lastGamesElsewhere([{ playerId: MOVER, teamId: CLUB }, { playerId: SHORTSTOP, teamId: CLUB }]);
    expect(last.get(MOVER)).toBe('2030-05-08');
    expect(last.has(SHORTSTOP)).toBe(false);
  });

  it('reads that bound into a recent arrival when the transaction log is unavailable', () => {
    const log = clubGameLogs([CLUB]).get(CLUB)!;
    const recent = recentUsageFor({ log, playerId: MOVER, arrival: null, chronologyAvailable: false, lastGameElsewhere: '2030-05-08', absences: [] })!;
    expect(recent.tenure).toMatchObject({ status: 'recent_arrival', basis: 'game_log', arrivedOn: '2030-05-09' });
    expect(recent.benchAppearances).toBe(8);
    expect(recent.lineupStartGames).toEqual([]);
  });

  it('counts a non-day-to-day injury of this season as an absence, and nothing else', () => {
    const absences = injuryAbsences([HURT], 2030).get(HURT);
    expect(absences).toEqual([{ from: '2030-05-03', to: '2030-05-13' }]);
  });

  it('reads the last day the export reflects as the day before its leagues\' current date', () => {
    const through = exportThrough();
    if (through !== null) expect(through).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reads OOTP\'s next five starters as current state, and null when the export does not say', () => {
    db.prepare(`INSERT INTO projected_starting_pitchers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(CLUB, 1, 2, 3, 4, 5, 1, 2, 3);
    expect([...(projectedRotation(CLUB) ?? [])].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(projectedRotation(9999)).toBeNull();
  });

  it('says where a man is now from the export, never from his usage', () => {
    expect(whereabouts([-5]).size).toBe(0);
  });
});
