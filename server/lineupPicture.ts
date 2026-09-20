/**
 * Who actually plays where: the lineup as usage shows it.
 *
 * The roster says what a player is LISTED as. Usage says what he does: the
 * shortstop is the man who has played the innings at shortstop, the designated
 * hitter is whoever bats without playing the field, and a listed second baseman
 * who has started twice at third is a bench player who fills in. Reviewing "the
 * weakest lineup spot" and "who would replace him" both need the real regular,
 * not the label.
 *
 * Pure and objective: it reads innings, starts and plate appearances the game
 * recorded, and decides only who counts as the regular. The threshold for
 * "regular" is a provisional calibration parameter, declared here; a position
 * with no clear regular is said to be unsettled rather than given one.
 */

export const LINEUP_CALIBRATION = {
  status: 'provisional' as const,
  note: 'The share of a position\'s innings that makes a player its regular is a provisional calibration parameter (lineupPicture.ts).',
};

/** PROVISIONAL CALIBRATION. Share of the team's innings at a position (or of its games, for DH) that makes a player the regular there. */
export const REGULAR_SHARE = 0.4;

export const POSITION_LABELS: Record<number, string> = {
  2: 'catcher', 3: 'first base', 4: 'second base', 5: 'third base', 6: 'shortstop', 7: 'left field', 8: 'center field', 9: 'right field', 10: 'designated hitter',
};
export const LINEUP_POSITIONS = [2, 3, 4, 5, 6, 7, 8, 9] as const;

export interface HitterUsageInput {
  playerId: number;
  name: string;
  bats: 'R' | 'L' | 'S' | null;
  /** The position he is listed at. */
  listed: number | null;
  /** This season's fielding by position: games started, innings. */
  fielding: Array<{ position: number; gs: number; ip: number }>;
  /** This season's batting: games started and plate appearances (across all positions, DH included). */
  gs: number;
  pa: number;
}

export interface LineupPlayer {
  playerId: number;
  name: string;
  bats: 'R' | 'L' | 'S' | null;
  /** Innings at the position (games started for DH). */
  amount: number;
  /** His share of the team's innings at the position (of games, for DH). */
  share: number;
  pa: number;
}

export interface LineupSpot {
  position: number;
  label: string;
  regular: LineupPlayer | null;
  /** Others who have played the position this season, most first. */
  backups: LineupPlayer[];
  /** False when nobody has played enough of it to be its regular. */
  settled: boolean;
}

export interface LineupPicture {
  spots: LineupSpot[];
  dh: LineupSpot;
  /** Hitters who are nobody's regular: the bench. */
  bench: Array<{ playerId: number; name: string; bats: 'R' | 'L' | 'S' | null; pa: number; gs: number; listed: number | null }>;
  /** Team games played, the denominator behind every share. */
  games: number;
  basis: string;
  calibration: typeof LINEUP_CALIBRATION;
}

export function buildLineupPicture(hitters: HitterUsageInput[], teamGames: number): LineupPicture {
  const games = Math.max(0, teamGames);
  const regularIds = new Set<number>();
  const player = (h: HitterUsageInput, amount: number, share: number): LineupPlayer => ({
    playerId: h.playerId, name: h.name, bats: h.bats, amount, share, pa: h.pa,
  });

  const spots: LineupSpot[] = LINEUP_POSITIONS.map((position) => {
    const at = hitters
      .map((h) => ({ h, ip: h.fielding.filter((f) => f.position === position).reduce((n, f) => n + f.ip, 0) }))
      .filter((x) => x.ip > 0)
      .sort((a, b) => b.ip - a.ip || a.h.name.localeCompare(b.h.name));
    const denominator = games * 9;
    const top = at[0];
    const share = (ip: number) => (denominator > 0 ? ip / denominator : 0);
    const settled = !!top && share(top.ip) >= REGULAR_SHARE;
    if (settled) regularIds.add(top.h.playerId);
    return {
      position, label: POSITION_LABELS[position], settled,
      regular: settled ? player(top.h, top.ip, share(top.ip)) : null,
      backups: at.slice(settled ? 1 : 0).map((x) => player(x.h, x.ip, share(x.ip))),
    };
  });

  // The designated hitter bats without fielding: his games started that no fielding start explains.
  const dhGames = hitters
    .map((h) => ({ h, dh: Math.max(0, h.gs - h.fielding.reduce((n, f) => n + f.gs, 0)) }))
    .filter((x) => x.dh > 0)
    .sort((a, b) => b.dh - a.dh || a.h.name.localeCompare(b.h.name));
  const dhTop = dhGames[0];
  const dhSettled = !!dhTop && games > 0 && dhTop.dh / games >= REGULAR_SHARE && !regularIds.has(dhTop.h.playerId);
  if (dhSettled) regularIds.add(dhTop.h.playerId);
  const dh: LineupSpot = {
    position: 10, label: POSITION_LABELS[10], settled: dhSettled,
    regular: dhSettled ? player(dhTop.h, dhTop.dh, dhTop.dh / games) : null,
    backups: dhGames.slice(dhSettled ? 1 : 0).map((x) => player(x.h, x.dh, games > 0 ? x.dh / games : 0)),
  };

  const bench = hitters
    .filter((h) => !regularIds.has(h.playerId))
    .sort((a, b) => b.pa - a.pa || a.name.localeCompare(b.name))
    .map((h) => ({ playerId: h.playerId, name: h.name, bats: h.bats, pa: h.pa, gs: h.gs, listed: h.listed }));

  return {
    spots, dh, bench, games,
    basis: `From this season's innings at each position and games started (${games} team games): a regular has played at least ${Math.round(REGULAR_SHARE * 100)}% of the innings there. A position nobody has that share of is unsettled.`,
    calibration: LINEUP_CALIBRATION,
  };
}
