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
  status: 'policy' as const,
  note: 'The share of a position\'s innings that makes a player its regular is a policy threshold (lineupPicture.ts): a decision about what to call a regular, not a fact about baseball.',
};

/** POLICY. Share of the team's innings at a position (or of its games, for DH) that makes a player the regular there. */
export const REGULAR_SHARE = 0.4;
/** POLICY. Share of a position's innings a backup must have played to be named the regular's PARTNER (a platoon or a real timeshare), not just a fill-in. */
export const PARTNER_SHARE = 0.25;

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
  /** A backup who has played a real share of the position (a platoon or timeshare); null when nobody has. He is not the regular: his share is under the regular's threshold. */
  partner: LineupPlayer | null;
  /** False when nobody has played enough of it to be its regular. */
  settled: boolean;
}

export interface LineupPicture {
  spots: LineupSpot[];
  dh: LineupSpot;
  /** Hitters who are nobody's regular: the bench. */
  bench: Array<{ playerId: number; name: string; bats: 'R' | 'L' | 'S' | null; pa: number; gs: number; listed: number | null; /** The position he shares with a regular, when he has played a real share of it. */ partnerAt?: number }>;
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

  // Innings by position, per player. A man plays one position at a time, so he is ONE spot's regular: the pairs are taken largest
  // share first, and a man already a regular elsewhere is not a second time (a utility man at 42% of second base and 40% of
  // shortstop is second base's, and shortstop is unsettled, with him named among those who have played it).
  const denominator = games * 9;
  const share = (ip: number) => (denominator > 0 ? ip / denominator : 0);
  const inningsAt = (h: HitterUsageInput, position: number) => h.fielding.filter((f) => f.position === position).reduce((n, f) => n + f.ip, 0);
  const pairs = LINEUP_POSITIONS
    .flatMap((position) => hitters.map((h) => ({ position, h, ip: inningsAt(h, position) })))
    .filter((x) => x.ip > 0)
    .sort((a, b) => b.ip - a.ip || a.h.name.localeCompare(b.h.name) || a.position - b.position);
  const regularAt = new Map<number, (typeof pairs)[number]>();
  for (const pair of pairs) {
    if (share(pair.ip) < REGULAR_SHARE) break;
    if (regularAt.has(pair.position) || regularIds.has(pair.h.playerId)) continue;
    regularAt.set(pair.position, pair);
    regularIds.add(pair.h.playerId);
  }
  const partnerAt = new Map<number, number>();

  const spots: LineupSpot[] = LINEUP_POSITIONS.map((position) => {
    const top = regularAt.get(position);
    const others = pairs.filter((x) => x.position === position && x !== top);
    const partner = others[0] && share(others[0].ip) >= PARTNER_SHARE && !regularIds.has(others[0].h.playerId) ? player(others[0].h, others[0].ip, share(others[0].ip)) : null;
    if (partner) partnerAt.set(partner.playerId, position);
    return {
      position, label: POSITION_LABELS[position], settled: !!top,
      regular: top ? player(top.h, top.ip, share(top.ip)) : null,
      backups: others.map((x) => player(x.h, x.ip, share(x.ip))),
      partner,
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
    partner: null,
  };

  const bench = hitters
    .filter((h) => !regularIds.has(h.playerId))
    .sort((a, b) => b.pa - a.pa || a.name.localeCompare(b.name))
    .map((h) => ({ playerId: h.playerId, name: h.name, bats: h.bats, pa: h.pa, gs: h.gs, listed: h.listed, ...(partnerAt.has(h.playerId) ? { partnerAt: partnerAt.get(h.playerId) } : {}) }));

  return {
    spots, dh, bench, games,
    basis: `From this season's innings at each position and games started (${games} team games): a regular has played at least ${Math.round(REGULAR_SHARE * 100)}% of the innings there. A position nobody has that share of is unsettled.`,
    calibration: LINEUP_CALIBRATION,
  };
}
