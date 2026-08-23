/**
 * Explicit event records available in imported OOTP CSVs.
 *
 * This reader intentionally returns only sources whose event semantics are
 * represented by their own tables. `messages` is not treated as a general
 * transaction log because its message-type codes are not a stable causal feed.
 */

import { db, tableColumns, tableExists } from './db.js';

export interface PlayerRosterEvent {
  kind: 'trade' | 'injury';
  date: string | null;
  source: 'trade_history' | 'players_injury_history';
  details: Record<string, number | string | null>;
}

/**
 * Reads explicit trade participation and injury-history events for one player.
 * It does not infer options, recalls, releases, or roster moves from a changed
 * current-state row.
 */
export function playerRosterEventHistory(playerId: number): PlayerRosterEvent[] {
  const events: PlayerRosterEvent[] = [];
  if (tableExists('trade_history')) {
    const columns = tableColumns('trade_history');
    const playerColumns = columns.filter((column) => /^player_id_[01]_\d+$/.test(column));
    if (columns.includes('date') && playerColumns.length) {
      const predicate = playerColumns.map((column) => `"${column}" = ?`).join(' OR ');
      const rows = db.prepare(
        `SELECT date, summary, message_id, team_id_0, team_id_1 FROM trade_history WHERE ${predicate}`
      ).all(...playerColumns.map(() => playerId)) as Array<{
        date: string | null; summary: string | null; message_id: number | null; team_id_0: number | null; team_id_1: number | null;
      }>;
      for (const row of rows) events.push({
        kind: 'trade', date: row.date, source: 'trade_history',
        details: { summary: row.summary, messageId: row.message_id, teamId0: row.team_id_0, teamId1: row.team_id_1 },
      });
    }
  }
  if (tableExists('players_injury_history')) {
    const columns = new Set(tableColumns('players_injury_history'));
    if (columns.has('player_id') && columns.has('date')) {
      const wanted = ['length', 'setbacks', 'day_to_day', 'effect', 'body_part']
        .filter((column) => columns.has(column));
      const rows = db.prepare(
        `SELECT date${wanted.map((column) => `, "${column}"`).join('')} FROM players_injury_history WHERE player_id = ?`
      ).all(playerId) as Array<Record<string, number | string | null>>;
      for (const row of rows) {
        const { date, ...details } = row;
        events.push({ kind: 'injury', date: typeof date === 'string' ? date : null, source: 'players_injury_history', details });
      }
    }
  }
  return events.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}
