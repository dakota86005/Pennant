import { describe, expect, it } from 'vitest';
import { getDataStatus } from '../server/dataStatus.js';
import { db, tableColumns } from '../server/db.js';
import { holderAt, positionReadings, staffOrder, valueScaleOf, type PositionPlayer, type StaffInput, type StartsLog } from '../server/frontOffice/rosterMap.js';
import { clubGames, readTeamSeason } from '../server/frontOffice/teamSeason.js';
import { farmNextByPosition } from '../server/mlbEvidence.js';
import { readMorning, type ControlReading } from '../server/morningReport.js';
import type { BuildContext } from '../server/presentation/frontOffice/desk.js';
import { barOf, controlTerm, rosterMapWords, separationWords } from '../server/presentation/frontOffice/morning.js';
import { buildSave, exec, type BuiltSave } from './syntheticSave';

/**
 * The roster map (BEHAVIOR_CASES.md "Pennant for Mac", `rosterMap.test.ts`; D-057 and the D-052 amendment of 2026-09-25):
 * one rule picks every club's holder, a place is a count on Player Value's figure with its overlap, a club not valued is
 * never placed, and the farm's next man, control and needs are the specialists' answers as served. Built from synthetic
 * players through the pure places, and from the synthetic save through the reader.
 */

const clubs = [1, 2, 3, 4, 5].map((teamId) => ({ teamId, name: `Club ${teamId}` }));
const player = (playerId: number, teamId: number, position: number, likely: number | null, spread = 1, half = spread / 2): PositionPlayer => ({
  playerId, name: `P ${playerId}`, teamId, position,
  wins: likely === null ? null : { low: likely - spread, likely, high: likely + spread, inner: { low: likely - half, high: likely + half } },
  part: likely === null ? null : 'rest_of_season', why: likely === null ? 'His production is not established.' : null,
});
const SS = 6;
const build: BuildContext = { orgId: 1, club: 'Club 1', importStamp: null, reportStamp: 'r', gameDate: '2040-5-5' };

describe('one rule picks every club\'s holder, and the place counts that figure', () => {
  it('takes each club\'s player listed there with the most expected wins, and places ours among the valued holders', () => {
    const players = [
      player(10, 1, SS, 2.0), player(11, 1, SS, 3.0), // ours: 11 holds it, 10 behind him
      player(20, 2, SS, 4.0), player(30, 3, SS, 1.0), player(40, 4, SS, 2.5), player(50, 5, SS, 0.5),
    ];
    const [r] = positionReadings(1, clubs, players, [SS]);
    expect(r.holder?.playerId).toBe(11);
    expect(r.behind.map((b) => b.playerId)).toEqual([10]);
    expect(r.place).toEqual({ rank: 2, of: 5, tiedWith: 0 });
  });

  it('tells holders apart on the range each lands in half the time: clearly ahead, not separable, clearly behind', () => {
    // The drawn ranges (80%) all overlap ours; the half-time ranges (50%) meet only clubs 2 and 5's
    const players = [
      player(11, 1, SS, 3.0, 2.5, 0.5), player(20, 2, SS, 3.4, 2.5, 0.5), player(30, 3, SS, 1.0, 2.5, 0.5),
      player(40, 4, SS, 5.0, 2.5, 0.2), player(50, 5, SS, 2.6, 2.5, 0.2),
    ];
    const [r] = positionReadings(1, clubs, players, [SS]);
    expect(r.overlap).toBe(2);
    expect(r.overlapping.sort()).toEqual(['Club 2', 'Club 5']);
    expect(r.clearlyAhead).toEqual(['Club 3']);
    expect(r.clearlyBehind).toEqual(['Club 4']);
    const node = rosterMapWords(build, mapMaterial(r)).positions[0];
    expect(node.overlapText.display).toBe('Clearly ahead of 1 · not separable from 2 · clearly behind 1');
    expect(node).toMatchObject({ overlap: 2, clearlyAhead: 1, clearlyBehind: 1 });
    expect(node.place?.overlap).toBe(2);
    expect(node.claim.basis.because.find((b) => b.label === 'How clubs are told apart')?.value).toMatch(/half the time/);
  });

  it('says a universal overlap once, never as a count of every club', () => {
    expect(separationWords(0, 29, 0)).toBe('Not separable from the other 29');
    expect(separationWords(29, 0, 0)).toBe('Clearly ahead of the other 29');
    expect(separationWords(0, 0, 4)).toBe('Clearly behind the other 4');
    expect(separationWords(3, 0, 2)).toBe('Clearly ahead of 3 · clearly behind 2');
    const [r] = positionReadings(1, clubs, [1, 2, 3, 4, 5].map((t) => player(t * 10, t, SS, 2 + t * 0.1, 3, 1)), [SS]);
    expect(rosterMapWords(build, mapMaterial(r)).positions[0].overlapText.display).toBe('Not separable from the other 4');
  });

  it('shows the league\'s middle only where at least five clubs are placed', () => {
    const five = positionReadings(1, clubs, [1, 2, 3, 4, 5].map((t) => player(t * 10, t, SS, t)), [SS])[0];
    const four = positionReadings(1, clubs, [1, 2, 3, 4].map((t) => player(t * 10, t, SS, t)), [SS])[0];
    const middleOf = (r: typeof five) => rosterMapWords(build, mapMaterial(r)).positions[0].claim.basis.because.find((b) => b.label === 'League middle');
    expect(middleOf(five)?.value).toBe('3.0 wins');
    expect(middleOf(four)).toBeUndefined();
  });

  it('leaves a club with nobody valued there out of "of N", never last, and names it', () => {
    const players = [player(11, 1, SS, 1.0), player(20, 2, SS, 4.0), player(30, 3, SS, null), player(40, 4, SS, 2.0)];
    const [r] = positionReadings(1, clubs, players, [SS]);
    expect(r.place).toEqual({ rank: 3, of: 3, tiedWith: 0 });
    expect(r.leftOut.map((l) => l.club)).toEqual(['Club 3', 'Club 5']);
    expect(r.leftOut[1].why).toBe('Nobody is listed there.');
    // Ours not valued: not placed, never last
    const [mine] = positionReadings(1, clubs, [player(11, 1, SS, null), player(20, 2, SS, 4.0)], [SS]);
    expect(mine.place).toBeNull();
    expect(mine.holder?.playerId).toBe(11);
    const node = rosterMapWords(build, mapMaterial(mine)).positions[0];
    expect(node.placeText).toBe('Not placed');
    expect(node.value).toBeNull();
    expect(node.claim.basis.certainty).toBe('unknown');
  });

  it('shares a place between holders level at a tenth of a win, and says so', () => {
    const [r] = positionReadings(1, clubs, [player(11, 1, SS, 2.04), player(20, 2, SS, 2.01), player(30, 3, SS, 3.0)], [SS]);
    expect(r.place).toEqual({ rank: 2, of: 3, tiedWith: 1 });
    expect(r.tiedWith).toEqual(['Club 2']);
  });

  it('gives the same places whatever else is true of the clubs: only the holders\' figures move them', () => {
    const players = [player(11, 1, SS, 2.0), player(20, 2, SS, 4.0), player(30, 3, SS, 1.0)];
    const again = positionReadings(1, [...clubs].reverse(), [...players].reverse(), [SS]);
    expect(again[0].place).toEqual(positionReadings(1, clubs, players, [SS])[0].place);
  });
});

describe('the holder is the regular the export shows (the supervisor\'s call (c), N6 review)', () => {
  /** The club's game log with who started where: `position` and `gs`, as a real export writes them. */
  const withStarts = (save: BuiltSave) => {
    for (const c of ['position', 'gs']) if (!tableColumns('players_game_batting').includes(c)) exec(`ALTER TABLE players_game_batting ADD COLUMN ${c} INTEGER`);
    const facts = readTeamSeason(save.org);
    const games = clubGames(facts, save.org).map((g) => g.gameId);
    const start = (playerId: number, position: number, gameIds: number[], split = 0) => {
      const insert = db.prepare(`INSERT INTO players_game_batting (player_id, year, team_id, game_id, league_id, level_id, split_id, position, gs)
        VALUES (?, 2040, ?, ?, ?, 1, ?, ?, 1)`);
      for (const g of gameIds) insert.run(playerId, save.org, g, save.leagueId, split, position);
      exec('SELECT 1');
    };
    const hitters = db.prepare(`SELECT player_id, position FROM players WHERE team_id = ? AND position BETWEEN 2 AND 9 ORDER BY player_id`).all(save.org) as Array<{ player_id: number; position: number }>;
    return { games, start, hitters };
  };

  it('holds the node with the most starts there this season among the men who started there in the last 15 games', () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
    const { games, start, hitters } = withStarts(save);
    expect(games.length).toBeGreaterThan(20);
    const [regular, hurt, reserve] = hitters.filter((h) => h.position !== SS).map((h) => h.player_id);
    // The man with most starts at short (the first games) hasn't started there in the last 15: hurt or moved, he doesn't hold it
    start(hurt, SS, games.slice(0, games.length - 15));
    start(regular, SS, games.slice(-12));
    start(reserve, SS, games.slice(-15, -12));
    // The same game repeated in another split counts once
    start(regular, SS, games.slice(-1), 1);
    const words = rosterMapWords(build, readMorning(save.org, getDataStatus(), null));
    const node = words.positions.find((p) => p.pos === 'SS')!;
    expect(node.holder?.playerId).toBe(regular);
    expect(node.holderRule).toBe('starts');
    const chosen = node.claim.basis.because.find((b) => b.label === 'How the holder is chosen')!.value;
    expect(chosen).toMatch(/the most starts at shortstop this season \(12\) among the men who started there in its last 15 games \(12 of them\)/);
    // The men who started there follow him by starts, then the men listed there
    expect(node.claim.basis.because.find((b) => b.label === 'Behind him')!.value.indexOf(`P ${hurt}`)).toBeLessThan(
      node.claim.basis.because.find((b) => b.label === 'Behind him')!.value.indexOf(`P ${reserve}`));
    // Where the log shows nobody starting there lately, the listed man holds it, and the node says so
    const listed = words.positions.find((p) => p.pos === 'C')!;
    expect(listed.holderRule).toBe('listed');
    expect(listed.claim.basis.because.find((b) => b.label === 'How the holder is chosen')!.value).toMatch(/^Listed at catcher.*Nobody now on the club started there in its last 15 games/);
  });

  it('applies the one rule to every club, the designated hitter included', () => {
    const players = [player(1, 1, 3, 2.0), player(2, 1, 3, 1.0), player(3, 2, 10, 0.5), player(4, 2, 7, 3.0)];
    const log: StartsLog = {
      window: 15,
      byClub: new Map([
        [1, { games: 15, at: new Map([[10, [{ playerId: 2, season: 30, recent: 4 }]]]) }],
        [2, { games: 15, at: new Map([[10, [{ playerId: 3, season: 10, recent: 0 }, { playerId: 4, season: 5, recent: 5 }]]]) }],
      ]),
      why: null,
    };
    // Club 1: its first baseman who has started at DH holds it; club 2: its listed DH has stopped starting there
    expect(holderAt(players, log, 1, 10)).toMatchObject({ holder: { playerId: 2 }, basis: { rule: 'starts', season: 30, recent: 4 } });
    expect(holderAt(players, log, 2, 10)).toMatchObject({ holder: { playerId: 4 }, basis: { rule: 'starts', season: 5, recent: 5 } });
    // No log at all: the listed man, and why
    expect(holderAt(players, { window: 15, byClub: new Map(), why: 'The export\'s game log doesn\'t say who started where.' }, 2, 10))
      .toMatchObject({ holder: { playerId: 3 }, basis: { rule: 'listed', why: 'The export\'s game log doesn\'t say who started where.' } });
    // A man no longer on the club never holds it, however many starts he had
    expect(holderAt(players.filter((p) => p.playerId !== 4), log, 2, 10)).toMatchObject({ holder: { playerId: 3 }, basis: { rule: 'listed' } });
  });

  it('puts a need Major League Ops raised about a man on the node he holds, wherever it raised it', () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
    const { games, start, hitters } = withStarts(save);
    const utility = hitters.find((h) => h.position !== SS)!;
    start(utility.player_id, SS, games.slice(-15));
    // A flag on his work at his listed position: he holds short, so it sits on short's node
    const need = {
      id: 'n1', kind: 'role_holder_review', title: 'x', causes: [], returning: null,
      role: { kind: 'position_player', label: 'x', position: utility.position }, subject: { playerId: utility.player_id, name: `P ${utility.player_id}` },
    };
    const words = rosterMapWords(build, readMorning(save.org, getDataStatus(), [need] as never));
    expect(words.positions.filter((p) => p.need).map((p) => p.pos)).toEqual(['SS']);
  });
});

describe('the map serves expected wins, never dollars (the supervisor\'s call (a))', () => {
  it('carries no surplus, market, salary or dollar figure from the valuation', () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
    const words = rosterMapWords(build, readMorning(save.org, getDataStatus(), null));
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); }
    };
    walk(words);
    expect([...keys].filter((k) => /surplus|market|salary|dollar|money|price|cost|margin/i.test(k))).toEqual([]);
    expect(JSON.stringify(words)).not.toMatch(/\$\d|surplus|contract value/i);
    expect(words.valueScale?.unit).toBe('wins');
  });
});

describe('one scale for every range on the map', () => {
  it('holds every range shown and zero, in whole wins', () => {
    expect(valueScaleOf([{ low: 0.4, likely: 1, high: 2.2 }, null, { low: -0.3, likely: 0.2, high: 0.6 }])).toEqual({ low: -1, high: 3 });
    expect(valueScaleOf([{ low: 1, likely: 2, high: 3 }])).toEqual({ low: 0, high: 3 });
    expect(valueScaleOf([null])).toBeNull();
  });
});

describe('control, as Player Value reads Player Rights\' answer, served structured', () => {
  const reading = (over: Partial<ControlReading> & { end?: Partial<ControlReading['end']> }): ControlReading => ({
    thisSeason: 2040, now: 'under_contract', next: 'under_contract', standing: 'held',
    ...over,
    end: { low: null, high: null, pastHorizon: false, optOutBefore: null, laterUnknown: false, reason: null, heldThrough: null, ...over.end },
  });

  it('reads a known end as a season, the last one as a clock, and arbitration next as a clock', () => {
    expect(controlTerm(reading({ end: { low: 2043, high: 2043 } }))).toMatchObject({ kind: 'through', through: 2043, seasonsLeft: 4, text: 'Through 2043' });
    expect(controlTerm(reading({ end: { low: 2040, high: 2040 } }))).toMatchObject({ kind: 'clock', clock: 'freeAgentAfterSeason', seasonsLeft: 1 });
    expect(controlTerm(reading({ end: { low: 2044, high: 2044 }, now: 'pre_arbitration', next: 'arbitration' }))).toMatchObject({ kind: 'clock', clock: 'arbitration', through: 2044 });
  });

  it('keeps a range a range, and "at least" where control runs past what is laid out', () => {
    expect(controlTerm(reading({ end: { low: 2041, high: 2042 } }))).toMatchObject({ kind: 'through', through: 2041, latest: 2042, text: 'Through 2041 or 2042' });
    expect(controlTerm(reading({ end: { low: 2046, high: 2046, pastHorizon: true } }))).toMatchObject({ through: 2046, atLeast: true });
    // How long he is surely held is Player Value's reading (`controlEndOf`), the one the card and the cone show
    expect(controlTerm(reading({ end: { reason: 'Between pre-arbitration and arbitration.', heldThrough: 2046 } }))).toMatchObject({ kind: 'through', through: 2046, atLeast: true, text: 'Through 2046 at least' });
  });

  it('says not known where Player Rights cannot lay it out, never a season by assumption', () => {
    expect(controlTerm(reading({ end: { reason: 'No service time in the export.' } }))).toMatchObject({ kind: 'unknown', through: null, seasonsLeft: null });
    expect(controlTerm(null).kind).toBe('unknown');
  });
});

describe('the farm\'s next man is Player Development\'s answer as served', () => {
  it('names the man at the highest level listed there, and one it has not assessed is not assessed, never "not ready"', () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, minors: true, teamSeason: true });
    const farm = farmNextByPosition(save.org);
    const listed = [...farm.values()].flat();
    expect(listed.length).toBeGreaterThan(0);
    for (const [, men] of farm) expect(new Set(men.map((m) => m.level)).size).toBe(1);
    const m = readMorning(save.org, getDataStatus(), null);
    const words = rosterMapWords(build, m);
    const withFarm = words.positions.filter((p) => p.farmNext);
    expect(withFarm.length).toBeGreaterThan(0);
    for (const p of withFarm) {
      const man = listed.find((x) => x.playerId === p.farmNext!.playerId)!;
      expect(p.farmNext!.state).toBe(man.assessment === null ? 'notAssessed' : man.assessment.judgment === 'defensible' ? 'ready' : man.assessment.judgment === 'indefensible' ? 'notYet' : 'cantTell');
    }
    for (const p of words.positions.filter((x) => x.farmNext?.state === 'notAssessed')) expect(p.farmNext!.readiness.display).toBe('Not assessed');
    // The rule is stated on every node, and a readiness is served against its bar where Player Development gave both
    for (const p of words.positions) {
      expect(p.claim.basis.because.find((b) => b.label === 'How the farm\'s next man is chosen')?.value).toMatch(/readiest/);
      const man = p.farmNext && listed.find((x) => x.playerId === p.farmNext!.playerId);
      const a = man ? man.assessment : null;
      const bar = p.farmNext?.bar ?? null;
      expect(bar && { readiness: bar.readiness, required: bar.required }).toEqual(a && a.readiness !== null && a.required !== null ? { readiness: Math.round(a.readiness), required: Math.round(a.required) } : null);
      // On the scale readiness is read on, with a line that labels both numbers: the app joins and scales nothing
      if (bar) {
        expect(bar.scale).toEqual({ low: 0, high: 100 });
        expect(bar.line.display).toBe(`Readiness ${bar.readiness} · his bar ${bar.required}`);
      }
    }
  });
});

describe('the farm\'s readiness against its bar', () => {
  it('never reads a readiness that clears its bar as ready: another bar Player Development set may not be met, and it says which', () => {
    const [r] = positionReadings(1, clubs, [player(11, 1, SS, 2.0), player(20, 2, SS, 1.0)], [SS]);
    const m = mapMaterial(r);
    const blocker = 'Current-level evidence confidence 30 is below the minimum of 45.';
    m.map.positions[0] = {
      ...m.map.positions[0],
      farmNext: { playerId: 99, name: 'Adrian Castle', level: 2, assessment: { judgment: 'indefensible', readiness: 98, required: 76, scale: { low: 0, high: 100 }, reasons: [], blockers: [blocker], missing: [] } },
    } as never;
    const node = rosterMapWords(build, m).positions[0];
    expect(node.farmNext).toMatchObject({ state: 'notYet', bar: { readiness: 98, required: 76 } });
    expect(node.farmNext!.readiness.hint).toBe('Player Development: not yet; readiness 98 clears its bar, another isn\'t met');
    expect(node.claim.basis.because.find((b) => b.label === 'The farm\'s next man')!.value).toContain(blocker);
    // A ready man's hover keeps his readiness and its bar whole, never cut mid-figure
    m.map.positions[0] = { ...m.map.positions[0], farmNext: { playerId: 99, name: 'Adrian Castle', level: 2, assessment: { judgment: 'defensible', readiness: 96, required: 81, scale: { low: 0, high: 100 }, reasons: [], blockers: [], missing: [] } } } as never;
    expect(rosterMapWords(build, m).positions[0].farmNext!.readiness.hint).toBe('Player Development: a look is defensible now (readiness 96, bar 81)');
  });
});

describe('the map on the synthetic save', () => {
  it('marks a need only where Major League Ops raised one: at the position, on the pitcher it names, else on the staff', () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
    const need = (position: number, kind: string, subject?: number) => ({
      id: `n${position}${subject ?? ''}`, kind: subject ? 'role_holder_review' : 'bench_coverage', title: 'x',
      role: { kind, label: kind === 'position_player' ? 'shortstop' : 'relief pitcher', position }, causes: [], returning: null,
      ...(subject ? { subject: { playerId: subject, name: `P ${subject}` } } : {}),
    });
    const first = rosterMapWords(build, readMorning(save.org, getDataStatus(), null));
    const starter = first.rotation[1].playerId;
    const m = readMorning(save.org, getDataStatus(), [need(6, 'position_player'), need(1, 'relief_pitcher'), need(1, 'starting_pitcher', starter)] as never);
    const words = rosterMapWords(build, m);
    expect(words.positions.filter((p) => p.need).map((p) => p.pos)).toEqual(['SS']);
    expect(words.rotation.filter((p) => p.need).map((p) => p.playerId)).toEqual([starter]);
    expect(words.bullpen.some((p) => p.need)).toBe(false);
    expect(words.bullpenNeeds.map((c) => c.display)).toEqual(['No backup on the bench for relief pitcher']);
    expect(words.rotationNeeds).toEqual([]);
  });

  it('draws every range on its one served scale, places inside "of N", and a basis on every node', () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 6, seed: 11, teamSeason: true });
    const words = rosterMapWords(build, readMorning(save.org, getDataStatus(), null));
    const scale = words.valueScale!;
    const ranges = [...words.positions.map((p) => p.value), ...words.rotation.map((p) => p.value), ...words.bullpen.map((p) => p.value)].filter(Boolean);
    expect(ranges.length).toBeGreaterThan(5);
    for (const r of ranges) expect(r!.low >= scale.low && r!.high <= scale.high && r!.low <= r!.likely && r!.likely <= r!.high).toBe(true);
    for (const p of words.positions) {
      if (p.place) expect(p.place.of).toBeLessThanOrEqual(6);
      expect(p.claim.basis.because.length).toBeGreaterThan(3);
    }
    expect(words.positions.map((p) => p.pos)).toEqual(['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']);
    // The club's player listed at designated hitter holds it
    expect(words.positions.at(-1)?.holder?.playerId).toBe(save.hitters[8]);
  });

  it('keeps the designated hitter off the map where no club lists one there, and says so', () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
    exec(`UPDATE players SET position = 3 WHERE position = 10`);
    const words = rosterMapWords(build, readMorning(save.org, getDataStatus(), null));
    expect(words.positions.map((p) => p.pos)).not.toContain('DH');
    expect(words.notes.map((n) => n.display)).toContain('No club starts or lists a player at designated hitter, so the DH isn\'t on the map.');
  });

  it('leaves the designated hitter off where the league plays without one, and says so', () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
    exec(`UPDATE sub_leagues SET designated_hitter = 0`);
    const words = rosterMapWords(build, readMorning(save.org, getDataStatus(), null));
    expect(words.positions.map((p) => p.pos)).not.toContain('DH');
    expect(words.notes.map((n) => n.display)).toContain('The league plays without a designated hitter.');
  });

  it('orders the rotation as OOTP projects it and the bullpen closer first, then by the work each has had', () => {
    const p = (playerId: number, kind: StaffInput['kind'], projected: number | null, outs: number | null): StaffInput => ({ playerId, name: `P ${playerId}`, kind, projected, outs, wins: null, why: 'x' });
    const order = staffOrder([p(1, 'reliever', null, 30), p(2, 'starter', 1, 90), p(3, 'closer', null, 20), p(4, 'starter', 0, 80), p(5, 'reliever', null, 45), p(6, 'reliever', 2, 10)]);
    expect(order.rotation.map((x) => x.playerId)).toEqual([4, 2, 6]);
    expect(order.bullpen.map((x) => x.playerId)).toEqual([3, 5, 1]);
  });
});

/** A roster map's material holding one position reading. */
function mapMaterial(r: ReturnType<typeof positionReadings>[number]) {
  return {
    facts: {} as never, division: null, profile: { why: 'x' }, starters: [], ms: {},
    map: {
      positions: [{ ...r, farmNext: null, farmMore: 0, control: null, standing: null, needs: [] }],
      noDh: null, rotation: [], bullpen: [], rotationNeeds: [], bullpenNeeds: [], scale: { low: -2, high: 6 }, holderWindow: 15, logWhy: null,
      part: 'rest_of_season' as const, season: 2040, clubs: clubs.length,
    },
  };
}

describe('the farm\'s next man against his bar (N6 B1 review)', () => {
  it('serves the scale and a labelled line, so a man past his bar is past the line, never a full bar', () => {
    const scale = { low: 0, high: 100 };
    const past = barOf({ assessment: { readiness: 88.4, required: 76, judgment: 'defensible', scale } } as never)!;
    expect(past).toMatchObject({ readiness: 88, required: 76, scale: { low: 0, high: 100 } });
    expect(past.readiness).toBeLessThan(past.scale.high);
    expect(past.line.display).toBe('Readiness 88 · his bar 76');
    expect(barOf({ assessment: { readiness: null, required: 76, judgment: 'indeterminate', scale } } as never)).toBeNull();
    expect(barOf({ assessment: null } as never)).toBeNull();
  });
});
