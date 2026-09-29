import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HistoryCarryOver, HistoryOffer } from '../server/historyIdentity.js';
import { carryOverWords, offerWords, placeWords, ratingHistoryStatus, ratingHistoryView } from '../server/presentation/ratingHistoryWords.js';
import { BANNED_JARGON, bannedIn, FOLDER_PATHS, shownStrings } from './bannedJargon';

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

describe('this save\'s rating history in a sentence, always served (Settings ▸ History)', () => {
  it('counts the imports it holds and names the latest, ordering unpadded dates as dates', () => {
    const status = ratingHistoryStatus({ note: null, because: [] }, ['2040-5-9', '2040-5-10', '2040-4-1']);
    expect(status.text).toBe('This save has rating history from 3 imports, the latest on May 10, 2040.');
    expect(status.basis.because).toEqual([{ label: 'Imports kept', value: '3' }]);
  });

  it('says there is none yet, never a zero dressed as history', () => {
    expect(ratingHistoryStatus({ note: null, because: [] }, []).text).toBe('This save has no rating history yet.');
  });

  it('is the note when some of it isn\'t used or it started fresh', () => {
    const note = { note: 'This save\'s rating history starts fresh: its players don\'t match the history kept for its folder.', because: ['Why.'] };
    expect(ratingHistoryStatus(note, ['2040-5-9'])).toMatchObject({ text: note.note, tone: 'caution' });
  });
});

describe('where a save was, as the GM knows the place (N6 Stage B2 review, M1)', () => {
  const home = os.homedir();
  const direct = path.join(home, 'Library/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games/Old League.lg');
  const appStore = path.join(home, 'Library/Containers/com.ootpdevelopments.ootp26macqlm/Data/Application Support/Out of the Park Developments/OOTP Baseball 26/saved_games/Old League.lg');

  it('names the place OOTP keeps the save, never its folder, in the question, the list and the carry-over', () => {
    expect(placeWords(direct)).toBe('OOTP 27, direct download');
    expect(placeWords(appStore)).toBe('OOTP 26, Mac App Store version');
    expect(placeWords('/Volumes/Backup/Old League.lg')).toBe('a folder you chose');
    const view = ratingHistoryView({ note: null, because: [] }, [offer({ folderPath: direct })], [offer({ folderPath: direct, kind: 'listed' })], [{
      id: 'save-a:carry:1', source: 'save-b', fromName: 'Old League', fromPath: direct, throughDate: '2040-4-1', rows: 104, carriedAt: '2040-07-01T12:00:00.000Z',
    }]);
    expect(view.offers[0].question.text).toBe('This save has no rating history yet. Is it "Old League", the save that used to be in OOTP 27, direct download?');
    expect(view.offers[0].place).toBe('OOTP 27, direct download');
    expect(view.candidates[0].label.text).toBe('"Old League" in OOTP 27, direct download: 2 imports, the latest on May 6, 2040');
    const visible = [...shownStrings(view).map((s) => s.text), view.offers[0].place, view.candidates[0].place, view.carriedOver[0].undoQuestion];
    for (const text of visible) {
      expect(bannedIn(text, [FOLDER_PATHS]), text).toEqual([]);
      expect(bannedIn(text, [BANNED_JARGON]), text).toEqual([]);
    }
    // The folder itself is in the basis, where the GM can look it up
    expect(JSON.stringify(view.offers[0].question.basis)).toContain(direct);
  });
});

describe('the status line and the question never contradict each other (N6 Stage B2 review, M2)', () => {
  it('asks about a save that moved in words that fit how much history this save has', () => {
    for (const dates of [[], ['2040-5-9']]) {
      const view = ratingHistoryView({ note: null, because: [] }, [offer({})], [], [], dates);
      const status = view.status.text;
      const question = view.offers[0].question.text;
      const saysNone = (text: string) => /has no rating history yet/.test(text);
      const saysSome = (text: string) => /has rating history from \d+ import/.test(text);
      expect(saysSome(status) && saysNone(question), `${status} / ${question}`).toBe(false);
      expect(saysNone(status) && !saysNone(question), `${status} / ${question}`).toBe(false);
    }
    const afterFirst = ratingHistoryView({ note: null, because: [] }, [offer({})], [], [], ['2040-5-9']);
    expect(afterFirst.status.text).toBe('This save has rating history from 1 import, the latest on May 9, 2040.');
    expect(afterFirst.offers[0].question.text).toMatch(/^This save's rating history has only just started\. Is it "Old League", /);
  });
});
