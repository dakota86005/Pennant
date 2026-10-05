/**
 * The GM's notes on a player, in words (N11). His own note lives on his follow (the watchlist's note, copied into
 * Following by N7) and is served exactly as he typed it; the staff's notes are the ones a chat filed on him
 * (`player_notes`), served as filed with who wrote them and the game date. Neither is Pennant's words, so neither is a
 * shown `text`: they are the raw `note` and `body` the window puts in an editor and a quote.
 */
import { gameDateWords } from '../../dataStatus.js';
import { parseGameDate } from '../../dataFreshness.js';
import { cell } from '../claim.js';
import type { PlayerNotesView, PlayerStaffNote } from './types.js';

export interface NotesInput {
  playerId: number;
  following: boolean;
  note: string | null;
  staff: ReadonlyArray<{ id: number; source: string | null; body: string; game_date: string | null }>;
}

export function notesView(input: NotesInput): PlayerNotesView {
  const staff: PlayerStaffNote[] = input.staff.map((n) => {
    const day = parseGameDate(n.game_date ?? null);
    return {
      id: n.id,
      who: cell(n.source?.trim() || 'You'),
      when: day ? cell(gameDateWords(day)) : null,
      body: n.body,
    };
  });
  return {
    playerId: input.playerId,
    following: input.following,
    note: input.note === null || input.note === '' ? null : input.note,
    explain: input.following
      ? cell('Saved as you type, with your follow', { hint: 'Your note stays while you follow him' })
      : cell('Saved as you type. Writing a note follows him', { hint: 'Your note is kept with his follow, as the watchlist kept it' }),
    staff,
    staffEmpty: staff.length ? null : cell('Nothing filed by the staff yet'),
  };
}
