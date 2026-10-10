/**
 * Storylines and the GM Briefing in words (N13, D-074): what was written, when and from which export, the state of a
 * new one (never written, writing, written, failed), and the marking beside it. The React pages' words, moved.
 */
import { AI_STATE_CERTAINTY } from '../aiMarking.js';
import { basis, cell, claim } from '../claim.js';
import { parseGameDate } from '../../dataFreshness.js';
import { gameDateDisplay } from '../dataStatusWords.js';
import { timestampWords } from '../../timeWords.js';
import { linked, sectionsOf, type LinkIndex } from './markdown.js';
import { aiSurface, aiWritten, sourceOf, type AiContext, type AiOnOff, type AiSurfaceId } from './surface.js';
import type { AiWritingState, AiWritingStatus, BriefingView, StorylinesView } from './types.js';

/** A background job's state as `jobs.ts` keeps it. */
export interface JobReading { state: 'idle' | 'running' | 'done' | 'error'; error: string | null; finishedAt: string | null }

/** What was last written, as its file keeps it; null when nothing was. */
export interface Written { generatedAt: string | null; gameDate: string | null; notice: { message: string } | null }

type Kind = Exclude<AiSurfaceId, 'staffRoom'>;

const WORDS: Record<Kind, { thing: string; write: string; again: string; writing: string; from: string }> = {
  storylines: {
    thing: 'Storylines',
    write: 'Write storylines',
    again: 'Write fresh storylines',
    writing: 'The beat writer is going through the standings, box scores, prospect reports and the payroll. It runs on its own, so you can go elsewhere: the stories will be here when you come back.',
    from: 'The standings, recent results, the club\'s leaders, the farm, contracts, finances and the league\'s rules.',
  },
  briefing: {
    thing: 'The briefing',
    write: 'Write a briefing',
    again: 'Write a new briefing',
    writing: 'Writing in the background. Go elsewhere if you like: it will be here when you come back.',
    from: 'The standings, injuries, the farm, contracts, the trading block, finances, key dates and how current the data is.',
  },
};

function status(ctx: AiContext, kind: Kind, job: JobReading, written: Written | null, ai: AiOnOff, stamp: string): AiWritingStatus {
  const w = WORDS[kind];
  const running = job.state === 'running';
  const state: AiWritingState = running ? 'writing' : job.state === 'error' ? 'failed' : written ? 'written' : 'never';
  const when = timestampWords(written?.generatedAt);
  const exportDay = gameDateDisplay(written?.gameDate);
  const text = state === 'writing' ? 'Writing now.'
    : state === 'failed' ? `${w.thing === 'Storylines' ? 'Storylines' : 'The briefing'} couldn't be written this time.`
      : state === 'written' ? `Written ${when ?? 'earlier'}${exportDay ? `, from the export of ${exportDay}` : ''}.`
        : `${w.thing === 'Storylines' ? 'No storylines' : 'No briefing'} written yet.`;
  const because = [
    ...(state === 'writing' ? [{ label: 'Now', value: w.writing }] : []),
    ...(state === 'failed' ? [{ label: 'What happened', value: job.error?.trim() || 'The AI provider didn\'t answer.' }] : []),
    ...(written ? [{ label: 'Written', value: when ?? 'Not known' }, { label: 'From the export of', value: exportDay ?? 'Not known' }] : []),
    { label: 'What it reads', value: w.from },
  ];
  const nowDay = gameDateDisplay(ctx.gameDate);
  // Compared as dates (OOTP writes them unpadded, so as strings "2040-5-9" sorts after "2040-5-10"; review L5): an export
  // of the same day is the one imported now, and one dated after it is only different, never earlier
  const writtenOn = parseGameDate(written?.gameDate);
  const nowOn = parseGameDate(ctx.gameDate);
  const older = written && exportDay && nowDay && writtenOn && nowOn && writtenOn !== nowOn
    ? claim({
      text: `Written from ${writtenOn < nowOn ? 'an earlier' : 'a different'} export (${exportDay}); the export now is ${nowDay}.`,
      tone: 'caution', links: [],
      basis: basis({
        because: [{ label: 'Written from', value: exportDay }, { label: 'Imported now', value: nowDay }],
        source: sourceOf(ctx, 'Data status'), unknown: [], wouldChange: [`${w.again}.`], lean: null, certainty: AI_STATE_CERTAINTY,
      }),
    })
    : null;
  return {
    state,
    status: claim({
      text, tone: state === 'failed' ? 'caution' : 'neutral', links: [],
      basis: basis({
        because, source: sourceOf(ctx, 'The front office'),
        unknown: written && !exportDay ? ['Which export it was written from was not recorded.'] : [],
        wouldChange: [], lean: null, certainty: AI_STATE_CERTAINTY,
      }),
    }),
    older,
    write: cell(running ? 'Writing…' : written ? w.again : w.write),
    canWrite: ai.available && !running,
    notice: written?.notice?.message ? cell(written.notice.message) : null,
    written: written ? aiWritten(ctx, kind, `Written by AI from Pennant's figures. It decides nothing.`, [`${w.again}, after a newer export.`]) : null,
    ai: aiSurface(ctx, kind, ai),
    writingStamp: stamp,
  };
}

/** Storylines as written, or why there are none. */
export function storylinesView(
  ctx: AiContext, job: JobReading, written: (Written & { storylines: Array<{ category: string; headline: string; body: string }> }) | null,
  index: LinkIndex | null, ai: AiOnOff, stamp: string,
): StorylinesView {
  return {
    title: cell(`${ctx.club} Storylines`),
    lede: cell('Stories about your organization, written by AI from your save\'s figures.'),
    ...status(ctx, 'storylines', job, written, ai, stamp),
    stories: (written?.storylines ?? [])
      .filter((s) => s.headline?.trim() && s.body?.trim())
      .map((s) => ({ category: (typeof s.category === 'string' && s.category.trim()) || 'The Club', headline: s.headline.trim(), body: linked(s.body, index) })),
  };
}

/** The briefing as written, in its sections, or why there is none. */
export function briefingView(
  ctx: AiContext, job: JobReading, written: (Written & { markdown: string | null }) | null,
  index: LinkIndex | null, ai: AiOnOff, stamp: string,
): BriefingView {
  const kept = written?.markdown ? written : null;
  return {
    title: cell('GM Briefing'),
    lede: cell('A written digest of the standings, injuries, the farm and the decisions ahead, built from the organization\'s own reports.'),
    ...status(ctx, 'briefing', job, kept, ai, stamp),
    sections: kept ? sectionsOf(kept.markdown!).map((s) => ({ heading: s.heading, body: linked(s.body, index) })) : [],
  };
}
