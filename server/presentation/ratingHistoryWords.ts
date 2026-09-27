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
import type { HistoryNote, HistoryOffer } from '../historyIdentity.js';
import { basis, claim } from './claim.js';

/** A history the save could be asked about: the question, with why it is asked in its basis. */
export interface RatingHistoryOffer {
  /** What the answer names (`offerId`). */
  id: string;
  /** "This save has no rating history yet. Is it "New Game", the save that used to be in ...?" */
  question: Claim;
  /** The name that save last had; null when not recorded. */
  saveName: string | null;
  /** Where it was, in words (the home folder shortened to ~). */
  place: string;
  /** Its latest rating snapshot's game date, as filed (unpadded); null when unknown. */
  lastDate: GameDate | null;
  /** How many imports its history holds. */
  imports: Integer;
}

/** This save's rating history: what isn't used or started fresh, and any question to ask the GM. */
export interface RatingHistoryView {
  /** Some of this save's rating history isn't used, or it started fresh, in a sentence with its basis; null when all is its own. */
  note: Claim | null;
  /** Earlier saves this one could be (their folders have gone), most recently seen first; empty when there is nothing to ask. */
  offers: RatingHistoryOffer[];
}

/** The GM's answer: carry that save's history over (`adopt`, naming the offer), or start this save's own (`fresh`). */
export interface RatingHistoryChoice {
  offerId: string;
  choice: 'adopt' | 'fresh';
}

const SOURCE = { department: 'frontOffice' as const, specialist: 'Rating history', asOf: null, gameDate: null };

/** A folder in words: the home folder shortened to ~. */
export function placeWords(folder: string | null): string {
  if (!folder) return 'a folder Pennant no longer knows';
  const home = os.homedir();
  const parent = path.dirname(folder);
  return parent.startsWith(home) ? `~${parent.slice(home.length)}` : parent;
}

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

/** One offer as the question the app asks. */
export function offerWords(offer: HistoryOffer): RatingHistoryOffer {
  const name = offer.saveName ? `"${offer.saveName}"` : 'the save';
  const place = placeWords(offer.folderPath);
  const parsed = parseGameDate(offer.lastDate);
  const last = parsed ? gameDateWords(parsed) : null;
  const players = offer.continuity.verdict === 'same'
    ? `Its players match this save's (${offer.continuity.matched} of ${offer.continuity.compared} compared).`
    : 'Too few of its players are in this save to compare them.';
  return {
    id: offer.id,
    question: claim({
      text: `This save has no rating history yet. Is it ${name}, the save that used to be in ${place}?`,
      tone: 'neutral',
      hint: 'Only you can say: Pennant never joins two saves\' histories by itself',
      basis: basis({
        because: [
          { label: 'Its folder', value: `${offer.folderPath ?? 'Not recorded'} is no longer there.` },
          { label: 'Its history', value: `${offer.dates} import${offer.dates === 1 ? '' : 's'}${last ? `, the latest on ${last}` : ''}.` },
          { label: 'Its players', value: players },
        ],
        source: SOURCE,
        unknown: ['Whether this is the same save moved or renamed in OOTP, or another save: the export doesn\'t say.'],
        wouldChange: ['Answer yes to carry that history over to this save, or start fresh to keep them apart.'],
        lean: null,
        certainty: 'fact',
      }),
    }),
    saveName: offer.saveName,
    place,
    lastDate: offer.lastDate && parseGameDate(offer.lastDate) ? offer.lastDate : null,
    imports: offer.dates,
  };
}

/** The view. */
export function ratingHistoryView(note: HistoryNote, offers: HistoryOffer[]): RatingHistoryView {
  return { note: ratingHistoryNoteClaim(note), offers: offers.map(offerWords) };
}
