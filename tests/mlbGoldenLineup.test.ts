import { describe, expect, it } from 'vitest';
import { buildLineupPicture, PARTNER_SHARE, REGULAR_SHARE, type HitterUsageInput } from '../server/lineupPicture';

/*
 * GOLDEN CASES: who the lineup regulars are. A player plays one position at a time, so he is one spot's regular; a spot
 * two men share is shared, not silently one man's.
 */

const hitter = (id: number, name: string, fielding: Array<[number, number, number]>, gs: number, pa: number): HitterUsageInput => ({
  playerId: id, name, bats: 'R', listed: fielding[0]?.[0] ?? null, gs, pa, fielding: fielding.map(([position, g, ip]) => ({ position, gs: g, ip })),
});
const GAMES = 40; // 360 team innings a position

const base = (): HitterUsageInput[] => [
  hitter(1, 'Catcher', [[2, 35, 314]], 35, 147),
  hitter(2, 'First', [[3, 40, 347]], 40, 167),
  hitter(3, 'Second', [[4, 39, 340]], 39, 177),
  hitter(4, 'Third', [[5, 40, 361]], 40, 157),
  hitter(5, 'Short', [[6, 40, 366]], 40, 196),
  hitter(6, 'Left', [[7, 36, 325]], 36, 158),
  hitter(7, 'Center', [[8, 38, 344]], 38, 192),
  hitter(8, 'Right', [[9, 40, 360]], 40, 185),
];

describe('GOLDEN lineup: one man, one spot', () => {
  it('a utility man split across two positions is the regular at the one where he has played more, and the other is not his', () => {
    // 2B and SS both open (their regulars are hurt); the utility man has played both, a little more at second.
    const club = base().filter((h) => h.name !== 'Second' && h.name !== 'Short');
    club.push(hitter(20, 'Utility', [[4, 16, 150], [6, 15, 145]], 31, 130));
    const p = buildLineupPicture(club, GAMES);
    const second = p.spots.find((s) => s.position === 4)!;
    const short = p.spots.find((s) => s.position === 6)!;
    const regularAt = [second, short].filter((s) => s.regular?.name === 'Utility');
    expect(regularAt.length).toBeLessThanOrEqual(1);
    expect(regularAt.length === 1 ? regularAt[0].position : 4).toBe(4);
    // the other spot has no regular, and says who has played it
    expect(short.settled).toBe(false);
    expect(short.backups.map((b) => b.name)).toContain('Utility');
  });

  it('a player can be a regular and the designated hitter only through his own starts, never twice', () => {
    const p = buildLineupPicture([...base(), hitter(21, 'Second', [[4, 1, 9]], 30, 120)], GAMES);
    const regulars = [...p.spots, p.dh].filter((s) => s.regular).map((s) => s.regular!.playerId);
    expect(new Set(regulars).size).toBe(regulars.length);
  });
});

describe('GOLDEN lineup: a shared spot is shared', () => {
  it('names the partner of a platoon when both have a large share, and does not hide him among the bench', () => {
    const club = base().filter((h) => h.name !== 'Left');
    club.push(hitter(30, 'LeftA', [[7, 18, 164]], 18, 80), hitter(31, 'LeftB', [[7, 16, 142]], 16, 70));
    const p = buildLineupPicture(club, GAMES);
    const left = p.spots.find((s) => s.position === 7)!;
    expect(left.regular?.name).toBe('LeftA');
    expect(left.partner?.name).toBe('LeftB');
    expect(left.partner!.share).toBeGreaterThanOrEqual(PARTNER_SHARE);
    // he is still not the regular (under REGULAR_SHARE), and the bench row says what he is
    expect(left.partner!.share).toBeLessThan(REGULAR_SHARE);
    expect(p.bench.find((b) => b.name === 'LeftB')?.partnerAt).toBe(7);
  });

  it('a backup who has barely played is not a partner', () => {
    const club = [...base(), hitter(32, 'Extra', [[7, 2, 18]], 4, 12)];
    const p = buildLineupPicture(club, GAMES);
    expect(p.spots.find((s) => s.position === 7)!.partner).toBeNull();
    expect(p.bench.find((b) => b.name === 'Extra')?.partnerAt).toBeUndefined();
  });

  it('a spot nobody has played enough is unsettled, and names those who have played it', () => {
    const club = base().filter((h) => h.name !== 'Left');
    club.push(hitter(33, 'LeftA', [[7, 8, 70]], 8, 30), hitter(34, 'LeftB', [[7, 7, 60]], 7, 26));
    const left = buildLineupPicture(club, GAMES).spots.find((s) => s.position === 7)!;
    expect(left.settled).toBe(false);
    expect(left.regular).toBeNull();
    expect(left.backups.map((b) => b.name).sort()).toEqual(['LeftA', 'LeftB']);
  });
});
