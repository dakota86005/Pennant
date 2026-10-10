/**
 * How AI text is marked wherever the Mac app shows it (D-001; N12 Track C's Trade Desk, shared at N13, D-074).
 *
 * Three claims, one shape each, used by the Trade Desk's AI desk, the Staff room, Storylines and the GM Briefing alike,
 * so the marking is never written twice:
 * - **AI is off**: one calm line that the surface works without it, the reason in its basis (Pennant's own record: no
 *   key is set for the provider).
 * - **The note**: what the AI is and is not, a stated line (policy): it explains Pennant's figures and decides nothing.
 * - **Written by AI**: beside each answer, story or briefing: who wrote it and from what, that it can be wrong, and that the
 *   decision is the GM's (its certainty is unknown: no one can say how right an AI's words are).
 *
 * Pure: the words only. Whether AI is on is the AI modules' answer, handed in (this folder reaches no AI module).
 */
import type { BasisLine, BasisSource, Certainty, Tone } from '../contract/presentation.js';
import { basis, claim } from './claim.js';

const lines = (pairs: ReadonlyArray<readonly [string, string]>): BasisLine[] =>
  pairs.map(([label, value]) => ({ label, value }));

/**
 * How a line about AI itself is called (N13 review L6): whether AI is on, a key's state and where it comes from, what a key
 * check or an answer did. None is a fact from the export; each is Pennant's own record of its settings and of what it
 * saw happen, so `recorded` ("From Pennant's own record"). Shared by the Trade Desk and the N13 surfaces.
 */
export const AI_STATE_CERTAINTY: Certainty = 'recorded';

/** What an AI can and cannot be trusted with, said once (the "not known" of every AI-written claim). */
export const AI_CAN_BE_WRONG = 'An AI can be wrong about what it reads; the figures in Pennant\'s reports are Pennant\'s own.';

export interface AiOffWords {
  source: BasisSource;
  /** "AI is off. Everything on the desk works without it." */
  text: string;
  hint?: string;
  /** Why it is off, in a sentence (no key for the provider this surface uses). */
  reason: string;
  /** What still works without it, in a sentence. */
  stillWorks: string;
}

/** AI is off: said calmly, with the rest of the app working (D-001). Pennant's own record: no key is set for the provider. */
export function aiOffClaim(w: AiOffWords) {
  return claim({
    text: w.text,
    tone: 'neutral',
    ...(w.hint ? { hint: w.hint } : {}),
    links: [],
    basis: basis({
      because: lines([['Why', w.reason], ['What still works', w.stillWorks]]),
      source: w.source, unknown: [], wouldChange: ['An AI key in Settings.'], lean: null, certainty: AI_STATE_CERTAINTY,
    }),
  });
}

export interface AiNoteWords {
  source: BasisSource;
  /** "The AI explains the figures above. It decides nothing." */
  text: string;
  /** What it is given, in a sentence. */
  given: string;
  /** What it is not, in a sentence (Pennant's answer is elsewhere; the decision is the GM's). */
  isNot: string;
  /** The policy stamp: how the line is called. */
  stamp: string;
}

/** What the AI is and is not: a stated line (policy), shown once on a surface. */
export function aiNoteClaim(w: AiNoteWords) {
  return claim({
    text: w.text,
    tone: 'neutral',
    links: [],
    basis: basis({
      because: lines([['What it is given', w.given], ['What it is not', w.isNot]]),
      source: w.source, unknown: [], wouldChange: [], lean: null, certainty: 'policy', stamp: w.stamp,
    }),
  });
}

export interface AiWrittenWords {
  source: BasisSource;
  /** "Sam Ryan's read, written by AI from the figures above." */
  text: string;
  /** What it was given, in a sentence. */
  given: string;
  /** What it is, in a sentence: an explanation in a staff member's voice, which decides nothing. */
  what: string;
  /** What would change it, as sentences. */
  wouldChange: string[];
  /** Why it may be wrong (the default: `AI_CAN_BE_WRONG`). */
  canBeWrong?: string;
  tone?: Tone;
}

/** Written by AI: beside every answer, story and briefing. Its certainty is unknown; it decides nothing (D-001). */
export function aiWrittenClaim(w: AiWrittenWords) {
  return claim({
    text: w.text,
    tone: w.tone ?? 'neutral',
    links: [],
    basis: basis({
      because: lines([['What it was given', w.given], ['What it is', w.what]]),
      source: w.source, unknown: [w.canBeWrong ?? AI_CAN_BE_WRONG],
      wouldChange: w.wouldChange, lean: null, certainty: 'unknown',
    }),
  });
}
