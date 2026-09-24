import { db, tableColumns, tableExists } from './db.js';
import { playerValues, productionHeadlineOf, type PlayerValuation, type ValuationOptions } from './playerValue.js';

/**
 * A club's thinnest positions, read on Player Value (phase 6c; PLAYER_VALUE.md Part 8): at each fielding position, the best
 * player the major-league club carries there by his expected wins for the rest of this season (the whole of it before it
 * starts), most likely, as production serves it. The positions whose best player is expected to add the fewest wins are its
 * thinnest; a position with nobody valued (nobody listed there, or no one whose production is established) is named apart and
 * never read as zero (D-018). Every figure is shown: nothing is ranked by a hidden score, and no `players_value` figure is read
 * (it replaced `valuation.ts`'s `rosterHoles`, which ranked by OOTP's overall value). One reading for Free Agents, the draft
 * board and the Trade Center's fits. A lead for the GM, not a verdict: roster fit is his judgment.
 */

export const POSITION_NAMES: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};
export const FIELD_SPOTS = [2, 3, 4, 5, 6, 7, 8, 9];

/** How many of the thinnest positions a page names. */
const THINNEST = 3;

export interface PositionDepth {
  position: number;
  positionName: string;
  /** Known expected wins, most first (the shown figure); players whose production is unknown are counted apart. */
  players: Array<{ player_id: number; name: string; wins: number }>;
  unknown: number;
}

/** The part of this season still to be played (or the whole of it), most likely. */
export const winsNow = (v: PlayerValuation | undefined): number | null => {
  const p = v ? productionHeadlineOf(v.production) : null;
  return p?.now ? p.now.wins.central : null;
};

/** One major-league club's position players by position, each with his expected wins this season as Player Value serves them. */
export function clubDepth(
  teamId: number,
  values: Map<number, PlayerValuation>,
  facts: Iterable<{ player_id: number; name: string; position: number; teamId: number }>,
): PositionDepth[] {
  const mine = [...facts].filter((f) => f.teamId === teamId);
  return FIELD_SPOTS.map((pos) => {
    const here = mine.filter((f) => f.position === pos);
    const known = here
      .map((f) => ({ player_id: f.player_id, name: f.name, wins: winsNow(values.get(f.player_id)) }))
      .filter((p): p is { player_id: number; name: string; wins: number } => p.wins !== null)
      .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
    return { position: pos, positionName: POSITION_NAMES[pos], players: known, unknown: here.length - known.length };
  });
}

/** The three positions whose best player is expected to add the fewest wins; a position with nobody valued is named apart. */
export function weakestOf(depth: PositionDepth[]) {
  const known = depth.filter((d) => d.players.length > 0);
  return {
    weakest: [...known]
      .sort((a, b) => a.players[0].wins - b.players[0].wins || a.position - b.position)
      .slice(0, THINNEST)
      .map((d) => ({ position: d.position, positionName: d.positionName, best: d.players[0] })),
    notEstablished: depth.filter((d) => d.players.length === 0).map((d) => d.positionName),
  };
}

export interface PositionNeed {
  position: number;
  positionName: string;
  /** His club's best player there by expected wins this season (most likely); null where nobody there is valued. */
  best: { player_id: number; name: string; wins: number } | null;
  /** Players listed there whose production is not established: counted, never read as zero. */
  unknown: number;
}

export interface PositionNeeds {
  /** Every fielding position, thinnest first by its best player's expected wins; a position with nobody valued last. */
  positions: PositionNeed[];
  /** The thinnest positions' names (up to three), from the known ones only. */
  thinnest: string[];
  /** Positions with nobody valued: named apart, never ranked as the thinnest. */
  notEstablished: string[];
  /** What the reading rests on, in words. */
  basis: string;
}

export const POSITION_NEEDS_BASIS =
  "Each position's best player by his expected wins for the rest of this season (the whole of it before it starts), most " +
  "likely, from Player Value's production; the club's major-league position players by their listed position. A position " +
  "whose players' production isn't established, or with nobody listed there, is named apart and never counted as zero.";

/** The club's position players at its major-league level, by listed position. */
function clubPositionPlayers(teamId: number): Array<{ player_id: number; name: string; position: number; teamId: number }> {
  if (!tableExists('players')) return [];
  const columns = new Set(tableColumns('players'));
  if (!['player_id', 'team_id', 'position'].every((c) => columns.has(c))) return [];
  const retired = columns.has('retired') ? ' AND COALESCE(retired, 0) = 0' : '';
  const names = columns.has('first_name') && columns.has('last_name') ? "first_name || ' ' || last_name" : "'Player ' || player_id";
  return (db.prepare(`SELECT player_id, ${names} AS name, position FROM players WHERE team_id = ? AND position != 1${retired}`)
    .all(teamId) as Array<{ player_id: number; name: string; position: number }>)
    .map((r) => ({ ...r, teamId }));
}

/** A club's thinnest positions, each with its best player's expected wins shown; the options are Player Value's (freshness). */
export function positionNeeds(teamId: number, options: ValuationOptions = {}): PositionNeeds {
  const facts = clubPositionPlayers(teamId);
  const values = playerValues(facts.map((f) => f.player_id), options);
  const depth = clubDepth(teamId, values, facts);
  const known = depth.filter((d) => d.players.length > 0)
    .sort((a, b) => a.players[0].wins - b.players[0].wins || a.position - b.position);
  const none = depth.filter((d) => d.players.length === 0);
  const positions: PositionNeed[] = [...known, ...none].map((d) => ({
    position: d.position, positionName: d.positionName, best: d.players[0] ?? null, unknown: d.unknown,
  }));
  return {
    positions,
    thinnest: known.slice(0, THINNEST).map((d) => d.positionName),
    notEstablished: none.map((d) => d.positionName),
    basis: POSITION_NEEDS_BASIS,
  };
}
