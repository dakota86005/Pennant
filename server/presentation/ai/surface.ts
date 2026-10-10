/**
 * The words every AI surface shares (N13, D-074): its source line, whether AI is on, and the marking beside AI-written
 * text, through the one marking the Trade Desk uses (`aiMarking.ts`).
 */
import type { BasisSource } from '../../contract/presentation.js';
import { aiNoteClaim, aiOffClaim, aiWrittenClaim } from '../aiMarking.js';
import type { AiSurfaceState } from './types.js';

/** What a surface's words are built from: the import read and the export's game date. */
export interface AiContext {
  importStamp: string | null;
  gameDate: string | null;
  /** The club's name as the GM says it ("Arizona Diamondbacks"). */
  club: string;
}

export const sourceOf = (ctx: AiContext, specialist: string): BasisSource =>
  ({ department: 'frontOffice', specialist, asOf: ctx.importStamp, gameDate: ctx.gameDate });

/** Whether a surface's AI is on: handed in by the AI module that asks the model (this folder reaches none). */
export interface AiOnOff {
  available: boolean;
  /** Why it is off, in a sentence; null when on. */
  offReason: string | null;
}

export type AiSurfaceId = 'staffRoom' | 'storylines' | 'briefing';

const OFF: Record<AiSurfaceId, { text: string; hint: string; stillWorks: string }> = {
  staffRoom: {
    text: 'AI is off. Everything else in Pennant works without it.',
    hint: 'Add a key in Settings to ask your staff questions',
    stillWorks: 'Every report, view, figure and finding is worked out by Pennant itself. The staff room only puts questions about them to an AI.',
  },
  storylines: {
    text: 'AI is off. Everything else in Pennant works without it.',
    hint: 'Add a key in Settings to have storylines written',
    stillWorks: 'Every report, view, figure and finding is worked out by Pennant itself. Storylines are only written about them by an AI.',
  },
  briefing: {
    text: 'AI is off. Everything else in Pennant works without it.',
    hint: 'Add a key in Settings to have a briefing written',
    stillWorks: 'The Morning Report, the desk and every department\'s report are worked out by Pennant itself. The briefing is only written from them by an AI.',
  },
};

const GIVEN: Record<AiSurfaceId, string> = {
  staffRoom: 'Your question, the conversation so far, and Pennant\'s own reports and figures, which it looks up as it answers.',
  storylines: 'The club\'s standings, recent results, leaders, the farm as Minor League Operations describes it, contracts, finances and the league\'s rules, from Pennant\'s own reports.',
  briefing: 'The standings, injuries, the farm as Minor League Operations describes it, contracts, the trading block, finances, key dates and how current the data is, from Pennant\'s own reports.',
};

/** Whether AI is on for a surface, said once: off with its reason, and what the AI is and is not. */
export function aiSurface(ctx: AiContext, surface: AiSurfaceId, state: AiOnOff): AiSurfaceState {
  const off = OFF[surface];
  return {
    available: state.available,
    off: state.available ? null : aiOffClaim({
      source: sourceOf(ctx, 'Settings'), text: off.text, hint: off.hint,
      reason: state.offReason ?? 'No AI key is set.', stillWorks: off.stillWorks,
    }),
    note: aiNoteClaim({
      source: sourceOf(ctx, 'The front office'),
      text: 'Written by AI from Pennant\'s figures. It decides nothing.',
      given: GIVEN[surface],
      isNot: 'Pennant\'s answer: its reports are. It explains them in words and makes no decision: the decision is yours.',
      stamp: 'How AI is used: stated, not fitted',
    }),
  };
}

/** Beside AI-written text: who wrote it, from what, and that it decides nothing. */
export function aiWritten(ctx: AiContext, surface: AiSurfaceId, text: string, wouldChange: string[]) {
  return aiWrittenClaim({
    source: sourceOf(ctx, 'The front office'),
    text,
    given: GIVEN[surface],
    what: surface === 'staffRoom'
      ? 'An explanation of Pennant\'s figures in a staff member\'s voice. It decides nothing, and the decision is yours.'
      : 'Writing about Pennant\'s figures, for reading. It decides nothing, and the decision is yours.',
    wouldChange,
  });
}
