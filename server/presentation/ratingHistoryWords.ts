/**
 * This save's rating history in words (`GET /api/v2/rating-history`, D-064): whether some of it isn't used or it started
 * fresh, and the question the app asks when the save could be one that moved or was renamed in OOTP. Pennant never
 * decides that itself: the GM answers with one click (`POST /api/v2/rating-history/choice`), and only a yes carries the
 * earlier history over. Every sentence is authored here; `historyIdentity.ts` decides what is offered.
 */
import os from 'node:os';
import path from 'node:path';
import type { Claim } from '../contract/presentation.js';
import type { Integer } from '../contract/primitives.js';
import { parseGameDate, type GameDate } from '../dataFreshness.js';
import { gameDateWords } from '../dataStatus.js';
import type { HistoryCarryOver, HistoryNote, HistoryOffer } from '../historyIdentity.js';
import { basis, claim } from './claim.js';

/** How a history's players compare with this save's: the same, unclear, or too few to tell. */
export type RatingHistoryPlayers = 'same' | 'unclear' | 'too_few';

/**
 * A question about this save's rating history, answered with one click: carry that history over (`adopt`) or keep them
 * apart (`fresh`). `moved`: an earlier save whose folder has gone could be this one; `players_changed` / `went_back`:
 * this folder's own history was set aside, and the GM may continue it.
 */
export interface RatingHistoryOffer {
  /** What the answer names (`offerId`). */
  id: string;
  kind: 'moved' | 'players_changed' | 'went_back';
  /** The question, with why it is asked in its basis. */
  question: Claim;
  /** The name that history's save last had; null when not recorded. */
  saveName: string | null;
  /** Where it was, in words (the home folder shortened to ~). */
  place: string;
  /** Its latest rating snapshot's game date, and the latest one carrying it over would copy (as filed, unpadded). */
  lastDate: GameDate | null;
  carriesThrough: GameDate | null;
  /** How many imports its history holds. */
  imports: Integer;
  players: RatingHistoryPlayers;
}

/** Another history the GM may carry over by choice (the list behind "Carry over another save's history..."). */
export interface RatingHistoryCandidate {
  /** What the answer names (`offerId`, with `adopt`). */
  id: string;
  /** The history in one line, with what carrying it over does in its basis. */
  label: Claim;
  saveName: string | null;
  place: string;
  /** Whether its folder is there now, has gone, or can't be told. */
  folder: 'present' | 'gone' | 'unknown';
  lastDate: GameDate | null;
  carriesThrough: GameDate | null;
  imports: Integer;
  players: RatingHistoryPlayers;
}

/** A carry-over in force: what was carried over, and the id "Undo carry-over" sends (`choice: undo`). */
export interface RatingHistoryCarryOver {
  id: string;
  text: Claim;
}

/** This save's rating history: what isn't used or started fresh, the questions, the other histories, and carry-overs. */
export interface RatingHistoryView {
  /** Some of this save's rating history isn't used, or it started fresh, in a sentence with its basis; null when all is its own. */
  note: Claim | null;
  /** Questions to ask the GM now; empty when there is nothing to ask. */
  offers: RatingHistoryOffer[];
  /** Every other history the GM may carry over by choice (only another league's is hidden), most recently seen first. */
  candidates: RatingHistoryCandidate[];
  /** The carry-overs in force, most recent first, each undoable. */
  carriedOver: RatingHistoryCarryOver[];
  /** While a carry-over is in force, what carrying over another would do, in a sentence; null otherwise. */
  warning: Claim | null;
}

/** The GM's answer: carry a history over (`adopt`), keep them apart (`fresh`, a question only), or undo a carry-over (`undo`). */
export interface RatingHistoryChoice {
  offerId: string;
  choice: 'adopt' | 'fresh' | 'undo';
}

const SOURCE = { department: 'frontOffice' as const, specialist: 'Rating history', asOf: null, gameDate: null };

/** A folder in words: the home folder shortened to ~. */
export function placeWords(folder: string | null): string {
  if (!folder) return 'a folder Pennant no longer knows';
  const home = os.homedir();
  const parent = path.dirname(folder);
  return parent.startsWith(home) ? `~${parent.slice(home.length)}` : parent;
}

const dateWords = (date: string | null): string | null => {
  const parsed = parseGameDate(date);
  return parsed ? gameDateWords(parsed) : null;
};

const servedDate = (date: string | null): GameDate | null => (date && parseGameDate(date) ? date : null);

/** The note as a claim; null when there is nothing to say. */
export function ratingHistoryNoteClaim(note: HistoryNote): Claim | null {
  if (!note.note) return null;
  return claim({
    text: note.note,
    tone: 'caution',
    hint: 'Each save keeps its own rating history, so two saves are never compared',
    basis: basis({
      because: note.because.map((line) => ({ label: 'Rating history', value: line })),
      source: SOURCE,
      unknown: [],
      wouldChange: [],
      lean: null,
      certainty: 'fact',
    }),
  });
}

const PLAYERS_WORDS: Record<RatingHistoryPlayers, string> = {
  same: 'Its players match this save\'s',
  unclear: 'Only some of its players match this save\'s',
  too_few: 'Too few of its players are in this save to compare them',
};

/** What an offer or a listed history is, as basis lines. */
function evidence(o: HistoryOffer): Array<{ label: string; value: string }> {
  const last = dateWords(o.lastDate);
  const through = dateWords(o.carriesThrough);
  const folder = o.folderState === 'gone' ? 'is no longer there' : o.folderState === 'present' ? 'is still there' : 'can\'t be looked inside just now';
  return [
    { label: 'Its folder', value: `${o.folderPath ?? 'A folder not recorded'} ${folder}.` },
    { label: 'Its history', value: `${o.dates} import${o.dates === 1 ? '' : 's'}${last ? `, the latest on ${last}` : ''}.` },
    { label: 'Its players', value: `${PLAYERS_WORDS[o.players]} (${o.continuity.matched} of ${o.continuity.compared} compared).` },
    { label: 'Carrying it over', value: `Copies its imports${through ? ` up to ${through}` : ''} into this save's history. Its own history is left as it is, and it can be undone.` },
  ];
}

/** One question as the app asks it. */
export function offerWords(o: HistoryOffer): RatingHistoryOffer {
  const name = o.saveName ? `"${o.saveName}"` : 'the save';
  const place = placeWords(o.folderPath);
  const through = dateWords(o.carriesThrough);
  const kind = o.kind === 'listed' ? 'moved' : o.kind;
  const text = kind === 'moved'
    ? `This save has no rating history yet. Is it ${name}, the save that used to be in ${place}?`
    : kind === 'went_back'
      ? `This save went back to an earlier date than its rating history. Continue that history${through ? ` up to ${through}` : ''}, or keep the new start?`
      : 'This save\'s players no longer match its rating history. Continue that history, or keep the new start?';
  return {
    id: o.id,
    kind,
    question: claim({
      text,
      tone: 'neutral',
      hint: 'Only you can say: Pennant never joins two histories by itself',
      basis: basis({
        because: evidence(o),
        source: SOURCE,
        unknown: ['Whether it is the same save: the export doesn\'t say.'],
        wouldChange: ['Carry it over to continue it here, or keep them apart.'],
        lean: null,
        certainty: 'fact',
      }),
    }),
    saveName: o.saveName,
    place,
    lastDate: servedDate(o.lastDate),
    carriesThrough: servedDate(o.carriesThrough),
    imports: o.dates,
    players: o.players,
  };
}

/** One listed history as the picker shows it. */
export function candidateWords(o: HistoryOffer): RatingHistoryCandidate {
  const name = o.saveName ? `"${o.saveName}"` : 'A save';
  const place = placeWords(o.folderPath);
  const last = dateWords(o.lastDate);
  return {
    id: o.id,
    label: claim({
      text: `${name} in ${place}: ${o.dates} import${o.dates === 1 ? '' : 's'}${last ? `, the latest on ${last}` : ''}`,
      tone: 'neutral',
      hint: 'Carrying it over copies its history into this save\'s; you can undo it',
      basis: basis({ because: evidence(o), source: SOURCE, unknown: [], wouldChange: [], lean: null, certainty: 'fact' }),
    }),
    saveName: o.saveName,
    place,
    folder: o.folderState,
    lastDate: servedDate(o.lastDate),
    carriesThrough: servedDate(o.carriesThrough),
    imports: o.dates,
    players: o.players,
  };
}

/** One carry-over in force, as the line beside "Undo carry-over". */
export function carryOverWords(c: HistoryCarryOver): RatingHistoryCarryOver {
  const name = c.fromName ? `"${c.fromName}"` : 'another save';
  const through = dateWords(c.throughDate);
  return {
    id: c.id,
    text: claim({
      text: `Rating history carried over from ${name}${through ? ` through ${through}` : ''}.`,
      tone: 'neutral',
      hint: 'Undoing it removes exactly what was copied; the other save keeps its own',
      basis: basis({
        because: [
          { label: 'From', value: c.fromPath ?? 'A folder not recorded' },
          { label: 'Copied', value: `${c.rows} player rating${c.rows === 1 ? '' : 's'}.` },
        ],
        source: SOURCE,
        unknown: [],
        wouldChange: [],
        lean: null,
        certainty: 'fact',
      }),
    }),
  };
}

/** While a carry-over is in force: carrying over another stacks, and adds only what this save doesn't have yet. */
export function stackingWarning(carries: HistoryCarryOver[]): Claim | null {
  if (carries.length === 0) return null;
  const names = carries.map((c) => (c.fromName ? `"${c.fromName}"` : 'another save'));
  const from = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return claim({
    text: `This save already has rating history carried over from ${from}. Carrying over another adds only the imports it doesn't have yet.`,
    tone: 'caution',
    hint: 'Two carried-over histories can disagree; undoing one leaves the other',
    basis: basis({
      because: carries.map((c) => ({ label: 'Carried over', value: `From ${c.fromName ? `"${c.fromName}"` : 'another save'}${c.fromPath ? ` (${c.fromPath})` : ''}, ${c.rows} player rating${c.rows === 1 ? '' : 's'}.` })),
      source: SOURCE,
      unknown: [],
      wouldChange: ['Undo a carry-over first to carry over only the other.'],
      lean: null,
      certainty: 'fact',
    }),
  });
}

/** The view. */
export function ratingHistoryView(note: HistoryNote, offers: HistoryOffer[], candidates: HistoryOffer[], carries: HistoryCarryOver[]): RatingHistoryView {
  return {
    note: ratingHistoryNoteClaim(note),
    offers: offers.map(offerWords),
    candidates: candidates.map(candidateWords),
    carriedOver: carries.map(carryOverWords),
    warning: stackingWarning(carries),
  };
}
