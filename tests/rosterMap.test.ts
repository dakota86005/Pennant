import { describe, expect, it } from 'vitest';
import { getDataStatus } from '../server/dataStatus.js';
import { positionReadings, staffOrder, valueScaleOf, type PositionPlayer, type StaffInput } from '../server/frontOffice/rosterMap.js';
import { farmNextByPosition } from '../server/mlbEvidence.js';
import { readMorning, type ControlReading } from '../server/morningReport.js';
import type { BuildContext } from '../server/presentation/frontOffice/desk.js';
import { controlTerm, rosterMapWords } from '../server/presentation/frontOffice/morning.js';
import { buildSave, exec } from './syntheticSave';

/**
 * The roster map (BEHAVIOR_CASES.md "Pennant for Mac", `rosterMap.test.ts`; D-057 and the D-052 amendment of 2026-09-25):
 * one rule picks every club's holder, a place is a count on Player Value's figure with its overlap, a club not valued is
 * never placed, and the farm's next man, control and needs are the specialists' answers as served. Built from synthetic
 * players through the pure places, and from the synthetic save through the reader.
 */

const clubs = [1, 2, 3, 4, 5].map((teamId) => ({ teamId, name: `Club ${teamId}` }));
const player = (playerId: number, teamId: number, position: number, likely: number | null, spread = 1): PositionPlayer => ({
  playerId, name: `P ${playerId}`, teamId, position,
  wins: likely === null ? null : { low: likely - spread, likely, high: likely + spread },
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

  it('states how many other clubs\' ranges overlap his, and two that overlap are not said to differ', () => {
    const players = [player(11, 1, SS, 3.0, 0.5), player(20, 2, SS, 3.4, 0.5), player(30, 3, SS, 1.0, 0.5), player(40, 4, SS, 5.0, 0.2), player(50, 5, SS, 2.6, 0.2)];
    const [r] = positionReadings(1, clubs, players, [SS]);
    expect(r.overlap).toBe(2);
    expect(r.overlapping.sort()).toEqual(['Club 2', 'Club 5']);
    const node = rosterMapWords(build, mapMaterial(r)).positions[0];
    expect(node.overlapText.display).toBe('Ranges overlap 2 other clubs\'');
    expect(node.place?.overlap).toBe(2);
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

describe('one scale for every range on the map', () => {
  it('holds every range shown and zero, in whole wins', () => {
    expect(valueScaleOf([{ low: 0.4, likely: 1, high: 2.2 }, null, { low: -0.3, likely: 0.2, high: 0.6 }])).toEqual({ low: -1, high: 3 });
    expect(valueScaleOf([{ low: 1, likely: 2, high: 3 }])).toEqual({ low: 0, high: 3 });
    expect(valueScaleOf([null])).toBeNull();
  });
});

describe('control, as Player Value reads Player Rights\' answer, served structured', () => {
  const reading = (over: Partial<ControlReading> & { end?: Partial<ControlReading['end']> }): ControlReading => ({
    thisSeason: 2040, now: 'under_contract', next: 'under_contract', standing: 'held', heldThrough: null,
    ...over,
    end: { low: null, high: null, pastHorizon: false, optOutBefore: null, laterUnknown: false, reason: null, ...over.end },
  });

  it('reads a known end as a season, the last one as a clock, and arbitration next as a clock', () => {
    expect(controlTerm(reading({ end: { low: 2043, high: 2043 } }))).toMatchObject({ kind: 'through', through: 2043, seasonsLeft: 4, text: 'Through 2043' });
    expect(controlTerm(reading({ end: { low: 2040, high: 2040 } }))).toMatchObject({ kind: 'clock', clock: 'freeAgentAfterSeason', seasonsLeft: 1 });
    expect(controlTerm(reading({ end: { low: 2044, high: 2044 }, now: 'pre_arbitration', next: 'arbitration' }))).toMatchObject({ kind: 'clock', clock: 'arbitration', through: 2044 });
  });

  it('keeps a range a range, and "at least" where control runs past what is laid out', () => {
    expect(controlTerm(reading({ end: { low: 2041, high: 2042 } }))).toMatchObject({ kind: 'through', through: 2041, latest: 2042, text: 'Through 2041 or 2042' });
    expect(controlTerm(reading({ end: { low: 2046, high: 2046, pastHorizon: true } }))).toMatchObject({ through: 2046, atLeast: true });
    expect(controlTerm(reading({ heldThrough: 2046, end: { reason: 'Between pre-arbitration and arbitration.' } }))).toMatchObject({ kind: 'through', through: 2046, atLeast: true, text: 'Through 2046 at least' });
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
  });
});

describe('the map on the synthetic save', () => {
  it('marks a need only where Major League Ops raised one', () => {
    const save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true });
    const need = (position: number, kind: string) => ({ id: `n${position}`, kind: 'bench_coverage', title: `No backup at ${position}`, role: { kind, label: 'x', position } });
    const m = readMorning(save.org, getDataStatus(), [need(6, 'position_player'), need(1, 'relief_pitcher')] as never);
    const words = rosterMapWords(build, m);
    expect(words.positions.filter((p) => p.need).map((p) => p.pos)).toEqual(['SS']);
    expect(words.bullpen.every((p) => p.need)).toBe(true);
    expect(words.rotation.some((p) => p.need)).toBe(false);
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
      noDh: null, rotation: [], bullpen: [], scale: { low: -2, high: 6 }, part: 'rest_of_season' as const, season: 2040, clubs: clubs.length,
    },
  };
}
