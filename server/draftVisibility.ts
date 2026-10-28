/**
 * Which players OOTP hasn't revealed to the GM yet (B-66, deep hunt SRVSTATS-11; the owner's decision of 2026-10-28:
 * draft prospects OOTP hasn't revealed can't be searched or opened).
 *
 * The export carries every player the save holds, including some the game shows on no screen: a player OOTP marks
 * `hidden`, and the amateurs of a draft class before the league publishes its pool (`show_draft_pool`, the switch the
 * draft board already waits on: "listing them here invented a scouting report out of thin air"). Quick Open and the
 * player window used to list and open them with our scouts' grades. A player is unrevealed when he is hidden, or when he
 * is in a draft class (flagged eligible and not yet taken) and no league whose draft he could be in has published its
 * pool. Schema-tolerant: a column the export lacks leaves that part of the rule out (nothing is assumed hidden).
 */
import { db, tableColumns, tableExists } from './db.js';

/** The leagues that run an amateur draft and have published its pool now. */
function publishedDraftLeagues(): number[] {
  if (!tableExists('leagues')) return [];
  const columns = new Set(tableColumns('leagues'));
  if (!columns.has('league_id') || !columns.has('show_draft_pool')) return [];
  const runsDraft = columns.has('rules_amateur_draft') ? ' AND rules_amateur_draft = 1' : '';
  return (db.prepare(`SELECT league_id FROM leagues WHERE show_draft_pool = 1${runsDraft}`).all() as Array<{ league_id: number }>)
    .map((r) => Number(r.league_id));
}

/**
 * A SQL condition over `players` (aliased `alias`) that holds for every player OOTP has revealed: never hidden, and not
 * in an unpublished draft class. `'1'` when the export can't say (no such columns).
 */
export function revealedPlayerSql(alias = 'p'): string {
  if (!tableExists('players')) return '1';
  const columns = new Set(tableColumns('players'));
  const parts: string[] = [];
  if (columns.has('hidden')) parts.push(`COALESCE(${alias}.hidden, 0) != 1`);
  if (columns.has('draft_eligible')) {
    const published = publishedDraftLeagues();
    const picked = columns.has('picked_in_draft') ? `COALESCE(${alias}.picked_in_draft, 0) = 1` : '0';
    // His draft is published: the league he is flagged for, or (flagged for none) any league's published pool
    const inPublished = published.length === 0
      ? '0'
      : columns.has('draft_league_id')
        ? `(COALESCE(${alias}.draft_league_id, 0) IN (${published.join(', ')}) OR COALESCE(${alias}.draft_league_id, 0) = 0)`
        : '1';
    parts.push(`(COALESCE(${alias}.draft_eligible, 0) != 1 OR ${picked} OR ${inPublished})`);
  }
  return parts.length ? `(${parts.join(' AND ')})` : '1';
}

/** Whether OOTP has revealed this player (an unknown player is not "unrevealed": the caller says he isn't found). */
export function isRevealed(playerId: number): boolean {
  if (!tableExists('players')) return true;
  const row = db.prepare(`SELECT ${revealedPlayerSql('p')} AS shown FROM players p WHERE p.player_id = ?`).get(playerId) as { shown: number } | undefined;
  return !row || Number(row.shown) === 1;
}
