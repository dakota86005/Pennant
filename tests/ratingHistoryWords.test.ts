import { describe, expect, it } from 'vitest';
import type { HistoryCarryOver, HistoryOffer } from '../server/historyIdentity.js';
import { carryOverWords, offerWords } from '../server/presentation/ratingHistoryWords.js';
import { BANNED_JARGON, bannedIn } from './bannedJargon';

/**
 * The rating-history questions' served buttons and the undo's question (N6 Stage B2, D-064): the Mac app draws the
 * question with the two answers the server names, and asks once before an undo, in the server's words.
 */
const offer = (over: Partial<HistoryOffer>): HistoryOffer => ({
  id: 'save-a:save-b', kind: 'moved', source: 'save-b', saveName: 'Old League', folderPath: '/Users/gm/saves/Old League.lg',
  folderState: 'gone', lastDate: '2040-5-6', dates: 2, carriesThrough: '2040-4-1', players: 'same',
  continuity: { compared: 104, matched: 104 } as HistoryOffer['continuity'], ...over,
});

describe('the rating-history question\'s two answers, as the server names them', () => {
  it('asks a save that moved to carry its history over or keep them apart', () => {
    expect(offerWords(offer({}))).toMatchObject({ adoptText: 'Carry It Over', freshText: 'Keep Them Apart' });
  });

  it('asks a save whose own history was set aside to continue it or keep the new start, matching the question', () => {
    for (const kind of ['players_changed', 'went_back'] as const) {
      const words = offerWords(offer({ kind }));
      expect(words).toMatchObject({ adoptText: 'Continue That History', freshText: 'Keep the New Start' });
      expect(words.question.text).toMatch(/Continue that history.*or keep the new start\?$/);
    }
  });
});

describe('what "Undo carry-over" asks first', () => {
  const carry = (over: Partial<HistoryCarryOver>): HistoryCarryOver => ({
    id: 'save-a:carry:1', source: 'save-b', fromName: 'Old League', fromPath: '/Users/gm/saves/Old League.lg', throughDate: '2040-4-1',
    rows: 104, carriedAt: '2040-07-01T12:00:00.000Z', ...over,
  });

  it('says what is removed and that the other save keeps its own', () => {
    const words = carryOverWords(carry({}));
    expect(words.undoQuestion).toBe('Undo the carry-over from "Old League"? The 104 player ratings it copied are removed from this save\'s history; "Old League" keeps its own.');
    expect(bannedIn([words.undoQuestion], BANNED_JARGON)).toEqual([]);
  });

  it('counts one rating as one, and names no save it doesn\'t know', () => {
    expect(carryOverWords(carry({ fromName: null, rows: 1 })).undoQuestion)
      .toBe('Undo the carry-over from another save? The 1 player rating it copied is removed from this save\'s history; that save keeps its own.');
  });
});
