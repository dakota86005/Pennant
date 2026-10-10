/**
 * The AI providers and their keys in words (N13, D-074): whether each key is set and where it comes from, never the key
 * (at most its last four characters, as `KeyStatus.hint` already serves), and a key check's outcome without repeating it.
 */
import { AI_STATE_CERTAINTY } from '../aiMarking.js';
import { basis, cell, claim } from '../claim.js';
import { sourceOf, type AiContext } from './surface.js';
import type { AiKeyCheckAnswer, AiKeysView, AiProviderRow } from './types.js';

/** A provider as `providers.ts` lists it, with its key state (`settings.ts`'s `KeyStatus`). */
export interface ProviderReading {
  id: string;
  label: string;
  console: string;
  requiresKey: boolean;
  configured: boolean;
  source: 'keychain' | 'env' | 'stored' | null;
  sourceText: string | null;
  hint: string | null;
}

const SURFACE_WORDS: Record<string, string> = {
  chat: 'the Staff room', storylines: 'Storylines', briefing: 'the GM Briefing', trade: 'the Trade Desk',
};

const listed = (items: string[]): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const WHERE: Record<'keychain' | 'stored' | 'env', string> = {
  keychain: 'In your Mac\'s Keychain. Pennant keeps them in memory while it runs and never writes them to a file.',
  stored: 'In the data folder, encrypted where the system allows.',
  env: 'In the environment Pennant was started with.',
};

function rowOf(ctx: AiContext, p: ProviderReading, usedFor: string[]): AiProviderRow {
  const status = !p.requiresKey ? 'No key needed: it runs on this Mac.'
    : p.configured ? `Key set, ${(p.sourceText ?? 'from Settings').replace(/^From/, 'from').replace(/^Saved/, 'saved')}${p.hint ? ` (ends ${p.hint})` : ''}.`
      : 'No key.';
  return {
    id: p.id,
    name: cell(p.label),
    status: claim({
      text: status, tone: 'neutral', links: [],
      basis: basis({
        because: [
          { label: 'Key', value: !p.requiresKey ? 'Not needed' : p.configured ? 'Set' : 'Not set' },
          ...(p.sourceText ? [{ label: 'From', value: p.sourceText }] : []),
          { label: 'Used for', value: usedFor.length ? listed(usedFor) : 'Nothing yet: no AI feature is set to use it.' },
        ],
        source: sourceOf(ctx, 'Settings'), unknown: [],
        wouldChange: p.requiresKey ? [p.configured ? 'Removing the key in Settings.' : 'Adding a key in Settings.'] : [],
        lean: null, certainty: AI_STATE_CERTAINTY,
      }),
    }),
    configured: p.requiresKey ? p.configured : true,
    needsKey: p.requiresKey,
    source: p.requiresKey && p.configured ? p.source : null,
    sourceText: p.requiresKey && p.configured && p.sourceText ? cell(p.sourceText) : null,
    getOne: p.requiresKey && p.console ? cell(`Get a key at ${p.console}`) : null,
    usedFor: usedFor.length ? cell(`Used for ${listed(usedFor)}`) : null,
    check: p.requiresKey ? cell('Check key') : null,
  };
}

/** Every provider, where keys are kept, and whether any AI surface is on. */
export function aiKeysView(
  ctx: AiContext, providers: ProviderReading[], featureProviders: Record<string, string>, keptIn: 'keychain' | 'stored' | 'env', anyOn: boolean,
): AiKeysView {
  const usedFor = (id: string) => Object.entries(featureProviders).filter(([, p]) => p === id).map(([f]) => SURFACE_WORDS[f] ?? f);
  return {
    title: cell('AI providers'),
    lede: cell('AI is optional. It writes and explains; every figure and finding in Pennant is the same without it.'),
    providers: providers.map((p) => rowOf(ctx, p, usedFor(p.id))),
    where: claim({
      text: keptIn === 'keychain' ? 'Keys are kept in your Mac\'s Keychain.' : keptIn === 'env' ? 'Keys come from the environment.' : 'Keys are kept in the data folder.',
      tone: 'neutral', links: [],
      basis: basis({
        because: [
          { label: 'Where', value: WHERE[keptIn] },
          // A key from the environment wins over one kept elsewhere: said where some do and the rest don't
          ...(keptIn !== 'env' && providers.some((p) => p.requiresKey && p.configured && p.source === 'env')
            ? [{ label: 'From the environment', value: listed(providers.filter((p) => p.requiresKey && p.configured && p.source === 'env').map((p) => p.label)) }]
            : []),
          { label: 'Where a key goes', value: 'Only to its own provider, with the question or the figures being written about. It is never shown in full, logged or sent anywhere else.' },
        ],
        source: sourceOf(ctx, 'Settings'), unknown: [], wouldChange: [], lean: null, certainty: AI_STATE_CERTAINTY,
      }),
    }),
    off: anyOn ? null : claim({
      text: 'AI is off. Everything else in Pennant works without it.',
      tone: 'neutral', hint: 'Add a key to ask your staff, or to have storylines written', links: [],
      basis: basis({
        because: [{ label: 'Why', value: 'No AI feature has a key for the provider it is set to use.' }],
        source: sourceOf(ctx, 'Settings'), unknown: [], wouldChange: ['An AI key in Settings.'], lean: null, certainty: AI_STATE_CERTAINTY,
      }),
    }),
    reenter: claim({
      text: 'Pennant couldn\'t read the key saved for this provider. Enter it again.',
      tone: 'caution', hint: 'The key is kept anew in your Keychain when you save it', links: [],
      basis: basis({
        because: [
          { label: 'What happened', value: 'A key is saved in your Keychain, but this copy of Pennant was not allowed to read it without asking you (it may have been saved by another build).' },
          { label: 'What to do', value: 'Enter the key again and save it: Pennant replaces the old item with one it can read.' },
        ],
        source: sourceOf(ctx, 'Settings'), unknown: [], wouldChange: ['The key entered again.'], lean: null, certainty: AI_STATE_CERTAINTY,
      }),
    }),
  };
}

export type KeyCheckOutcome = AiKeyCheckAnswer['outcome'];

const CHECK_TEXT: Record<KeyCheckOutcome, string> = {
  works: 'The key works.',
  refused: 'The provider turned the key down.',
  unchecked: 'The key couldn\'t be checked just now.',
  misshapen: 'That doesn\'t look like a key for this provider.',
};

/** A key check's outcome in words; the key itself is never in it. */
export function keyCheckAnswer(ctx: AiContext, provider: ProviderReading, outcome: KeyCheckOutcome, why: string): AiKeyCheckAnswer {
  return {
    provider: provider.id,
    outcome,
    result: claim({
      text: CHECK_TEXT[outcome], tone: outcome === 'works' ? 'good' : 'caution', links: [],
      basis: basis({
        because: [{ label: 'Provider', value: provider.label }, { label: 'What the check found', value: why }],
        source: sourceOf(ctx, 'Settings'), unknown: outcome === 'unchecked' ? ['Whether the key works: the provider could not be asked.'] : [],
        wouldChange: outcome === 'works' ? [] : ['Another key, copied whole.'], lean: null,
        // What the provider answered just now is Pennant's own record; one it couldn't ask is not known
        certainty: outcome === 'unchecked' ? 'unknown' : AI_STATE_CERTAINTY,
      }),
    }),
  };
}
