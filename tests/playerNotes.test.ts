import { beforeAll, describe, expect, it } from 'vitest';
import { resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { followNow } from '../server/aroundTheLeague.js';
import { follows } from '../server/frontOfficeMemory.js';
import { addStaffNote } from '../server/history.js';
import {
  playerNotesNow, removeStaffNoteNow, restoreStaffNoteNow, setPlayerNoteNow, undoFirstNoteNow,
} from '../server/playerViewService.js';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * The GM's notes on a player (N11; BEHAVIOR_CASES.md "Player card"): his note is his own words, kept exactly as he typed
 * them on his follow (the watchlist's note, D-058); a note on a player he doesn't follow follows him and its undo stops
 * following him; an empty note clears it. The staff's notes are listed with who and when, and a removal is undone.
 */

let save: BuiltSave;

beforeAll(() => {
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 40, playedShare: 0.5, clubs: 4, seed: 7 });
  resetFrontOfficeCache();
}, 120_000);

const followed = (id: number) => follows().find((f) => f.kind === 'player' && f.id === id) ?? null;

describe('the GM\'s note is his own words, stored as he typed them (D-058)', () => {
  it('keeps spaces and lines exactly, follows him, and its undo stops following him', async () => {
    const id = save.hitters[2];
    expect(followed(id)).toBeNull();
    const typed = '  Hits left-handers hard.\n\n\tWatch his back on day games.   ';
    const change = await setPlayerNoteNow(String(id), { note: typed });
    expect(change.notes).toMatchObject({ note: typed, following: true });
    expect(followed(id)?.note).toBe(typed);
    expect(change.undoUnfollows).toBe(true);
    expect(change.done.display).toMatch(/following/);
    const undone = await undoFirstNoteNow(String(id));
    expect(undone.notes).toMatchObject({ note: null, following: false });
    expect(followed(id)).toBeNull();
  });

  it('changes the note of a player he follows and puts the earlier one back on undo; an empty note clears it', async () => {
    const id = save.hitters[3];
    await setPlayerNoteNow(String(id), { note: 'First read.' });
    const second = await setPlayerNoteNow(String(id), { note: 'Second read.' });
    expect(second.undo).toEqual({ note: 'First read.' });
    expect(second.undoUnfollows).toBe(false);
    const back = await setPlayerNoteNow(String(id), second.undo);
    expect(back.notes.note).toBe('First read.');
    const cleared = await setPlayerNoteNow(String(id), { note: '   ' });
    expect(cleared.notes).toMatchObject({ note: null, following: true });
    await undoFirstNoteNow(String(id));
  });

  it('undoes a note\'s follow only while the note is what follows him (review L1)', async () => {
    // His note followed him; then he followed him on purpose: the note's undo clears the note and keeps him followed
    const id = save.hitters[5];
    await setPlayerNoteNow(String(id), { note: 'Watch the walk rate.' });
    expect(followed(id)?.source).toBe('note');
    await followNow({ kind: 'player', id });
    expect(followed(id)?.source).toBe('gm');
    const undone = await undoFirstNoteNow(String(id));
    expect(followed(id)).toMatchObject({ note: null, source: 'gm' });
    expect(undone.notes).toMatchObject({ note: null, following: true });
    // Followed before his first note: the note never owned the follow
    const other = save.hitters[6];
    await followNow({ kind: 'player', id: other });
    const first = await setPlayerNoteNow(String(other), { note: 'Plus arm.' });
    expect(first.undoUnfollows).toBe(false);
    expect(followed(other)?.source).toBe('gm');
    await undoFirstNoteNow(String(other));
    expect(followed(other)).toMatchObject({ note: null, source: 'gm' });
    // A note's follow whose note is only edited stays the note's: its undo still unfollows
    const third = save.hitters[7];
    await setPlayerNoteNow(String(third), { note: 'One.' });
    await setPlayerNoteNow(String(third), { note: 'Two.' });
    expect(followed(third)?.source).toBe('note');
    await undoFirstNoteNow(String(third));
    expect(followed(third)).toBeNull();
  });

  it('follows nobody when an empty note is written on a player he doesn\'t follow', async () => {
    const id = save.hitters[4];
    const change = await setPlayerNoteNow(String(id), { note: '' });
    expect(change.notes.following).toBe(false);
    expect(followed(id)).toBeNull();
  });

  it('refuses a note that isn\'t text, and a player the save doesn\'t have, in a sentence', async () => {
    await expect(setPlayerNoteNow(String(save.regular), { note: 7 })).rejects.toMatchObject({ status: 400 });
    await expect(setPlayerNoteNow('99999999', { note: 'Nobody' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('the staff\'s notes are listed as filed, and a removal can be undone', () => {
  it('lists who wrote it and the game date, and puts a removed note back as it was', async () => {
    const id = save.regular;
    addStaffNote({ playerId: id, playerName: 'P', source: 'Head trainer', body: 'Two weeks of light work, then a rehab start.', gameDate: '2040-5-3' });
    const notes = await playerNotesNow(String(id));
    expect(notes.staff[0]).toMatchObject({ who: { display: 'Head trainer' }, when: { display: 'May 3, 2040' }, body: 'Two weeks of light work, then a rehab start.' });
    const removed = await removeStaffNoteNow(String(id), String(notes.staff[0].id));
    expect(removed.notes.staff).toEqual([]);
    expect(removed.notes.staffEmpty?.display).toBe('Nothing filed by the staff yet');
    expect(removed.undo).toEqual({ source: 'Head trainer', body: 'Two weeks of light work, then a rehab start.', gameDate: '2040-5-3' });
    const restored = await restoreStaffNoteNow(String(id), removed.undo);
    expect(restored.notes.staff[0]).toMatchObject({ who: { display: 'Head trainer' }, when: { display: 'May 3, 2040' }, body: 'Two weeks of light work, then a rehab start.' });
    await expect(removeStaffNoteNow(String(id), '99999999')).rejects.toMatchObject({ status: 404 });
  });
});
