import { describe, expect, it } from 'vitest';
import { buildLineupPicture, LINEUP_POSITIONS, REGULAR_SHARE, type HitterUsageInput } from '../server/lineupPicture';

/*
 * The lineup as usage shows it: regulars by innings, a DH by starts nothing else explains, a bench of the rest.
 */

const hitter = (id: number, name: string, fielding: Array<[number, number, number]>, gs: number, pa: number, bats: HitterUsageInput['bats'] = 'R'): HitterUsageInput => ({
  playerId: id, name, bats, listed: fielding[0]?.[0] ?? null, gs, pa, fielding: fielding.map(([position, g, ip]) => ({ position, gs: g, ip })),
});
const GAMES = 40; // 360 team innings a position

const club = [
  hitter(1, 'Catcher', [[2, 35, 314]], 35, 147),
  hitter(2, 'First', [[3, 40, 347]], 40, 167, 'L'),
  hitter(3, 'Second', [[4, 39, 340]], 39, 177),
  hitter(4, 'Third', [[5, 40, 361]], 40, 157),
  hitter(5, 'Short', [[6, 40, 366]], 40, 196, 'S'),
  hitter(6, 'Left', [[7, 36, 325]], 36, 158),
  hitter(7, 'Center', [[8, 38, 344]], 38, 192, 'L'),
  hitter(8, 'Right', [[9, 40, 360]], 40, 185, 'L'),
  hitter(9, 'Designated', [[3, 3, 27]], 30, 127),           // 27 starts nobody's field explains
  hitter(10, 'BackupC', [[2, 5, 46]], 5, 20),
  hitter(11, 'Utility', [[4, 3, 27], [6, 2, 17], [7, 2, 10]], 8, 30),
];

describe('regulars by innings', () => {
  const p = buildLineupPicture(club, GAMES);

  it('names the regular at each position from the innings played there', () => {
    expect(p.spots.map((s) => [s.position, s.regular?.name])).toEqual([
      [2, 'Catcher'], [3, 'First'], [4, 'Second'], [5, 'Third'], [6, 'Short'], [7, 'Left'], [8, 'Center'], [9, 'Right'],
    ]);
    expect(p.spots.every((s) => s.settled)).toBe(true);
    expect(p.spots[4].regular?.share).toBeCloseTo(366 / 360 > 1 ? 366 / 360 : 366 / 360);
  });

  it('lists who else has played the position, most first', () => {
    expect(p.spots[0].backups.map((b) => b.name)).toEqual(['BackupC']);
    expect(p.spots[2].backups.map((b) => b.name)).toEqual(['Utility']);
    expect(p.spots[1].backups.map((b) => b.name)).toEqual(['Designated']);
  });

  it('the designated hitter is whoever starts without a fielding start to explain it', () => {
    expect(p.dh.regular?.name).toBe('Designated');
    expect(p.dh.regular?.amount).toBe(27);
    expect(p.dh.settled).toBe(true);
  });

  it('the bench is everyone who is nobody\'s regular, by plate appearances', () => {
    expect(p.bench.map((b) => b.name)).toEqual(['Utility', 'BackupC']);
  });

  it('states its basis and calibration', () => {
    expect(p.basis).toMatch(/at least 40% of the innings/);
    expect(p.calibration.status).toBe('provisional');
    expect(REGULAR_SHARE).toBe(0.4);
  });
});

describe('unsettled positions', () => {
  it('a position nobody has enough innings at has no regular, and its players are listed as backups', () => {
    const split = [hitter(1, 'A', [[4, 15, 130]], 15, 60), hitter(2, 'B', [[4, 14, 120]], 14, 55)];
    const p = buildLineupPicture(split, GAMES);
    const second = p.spots.find((s) => s.position === 4)!;
    expect(second.settled).toBe(false);
    expect(second.regular).toBeNull();
    expect(second.backups.map((b) => b.name)).toEqual(['A', 'B']);
    expect(p.bench).toHaveLength(2);
  });

  it('no games played means nothing is settled, not a division by zero', () => {
    const p = buildLineupPicture(club, 0);
    expect(p.spots.every((s) => !s.settled)).toBe(true);
    expect(p.dh.regular).toBeNull();
  });

  it('covers every fielding position', () => {
    expect(buildLineupPicture([], GAMES).spots).toHaveLength(LINEUP_POSITIONS.length);
  });
});
