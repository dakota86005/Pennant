/**
 * The Organizational Philosophy editor, worded (N12 Track C, D-073): the club's settings as `philosophy.ts` holds them,
 * the identity read from them (`identity.ts`), and what a change did. Pure: it words what it is handed and reads nothing.
 * The authority chain is said in the lede: the settings order the choices the specialists already find defensible,
 * afterwards, and never make a move allowed or not (D-003, D-019, D-045).
 */
import type { BasisLine, Cell } from '../../contract/presentation.js';
import type { PhilosophyProfile } from '../../philosophy.js';
import { basis, cell, claim } from '../claim.js';
import { gameDateDisplay } from '../dataStatusWords.js';
import { DIMENSION_WORDS, GROUPS, IDENTITY_LINES, POLICY_WORDS, comparablesOf, identityOf, positionWords } from './identity.js';
import type { PhilosophyChange, PhilosophyUpdate, PhilosophyView, PhilosophyViewHead } from './types.js';

export const PHILOSOPHY = 'philosophy' as const;

/** What a Philosophy & Staff payload is built for. */
export interface PhilosophyContext {
  orgId: number;
  importStamp: string | null;
  reportStamp: string;
  gameDate: string | null;
  preparedBy: Cell;
  /** The club's name ("Diamondbacks"). */
  club: string;
}

export const source = (ctx: PhilosophyContext, specialist: string) =>
  ({ department: PHILOSOPHY, specialist, asOf: ctx.importStamp, gameDate: ctx.gameDate });

export function headOf(ctx: PhilosophyContext, title: string): PhilosophyViewHead {
  const day = gameDateDisplay(ctx.gameDate);
  return {
    orgId: ctx.orgId,
    importStamp: ctx.importStamp,
    reportStamp: ctx.reportStamp,
    title: cell(title),
    byline: cell(`${ctx.preparedBy.display} · ${day ? `Through ${day}` : 'Game date not known'}`, ctx.preparedBy.hint ? { hint: ctx.preparedBy.hint } : {}),
  };
}

/** The policies' choices, as `PHILOSOPHY_POLICY_OPTIONS` offers them. */
export type PolicyOptions = Record<string, ReadonlyArray<{ value: string; label: string }>>;

const settingsBasis = (ctx: PhilosophyContext, because: BasisLine[]) => basis({
  because, source: source(ctx, 'Organizational Philosophy'), unknown: [], wouldChange: ['A change to these settings.'], lean: null,
  certainty: 'policy', stamp: 'The club\'s philosophy settings',
});

export function philosophyView(ctx: PhilosophyContext, profile: PhilosophyProfile, options: PolicyOptions): PhilosophyView {
  const values = profile.manual as Record<string, number>;
  const identity = identityOf(values);
  const comparables = comparablesOf(values);
  return {
    ...headOf(ctx, 'Organizational Philosophy'),
    lede: claim({
      text: 'How this organization weighs competing priorities. They order the choices your staff already finds sound; they never make a move allowed or rule one out.',
      tone: 'neutral',
      links: [],
      basis: basis({
        because: [
          { label: 'What they do', value: 'Once Player Development, Player Rights and the operations staff have said which choices are sound, these settings put those choices in the club\'s order of preference, and read Player Value\'s figures through the club\'s eyes beside the neutral ones.' },
          { label: 'What they never do', value: 'Decide whether an assignment is developmentally sound, what a player\'s rights allow, or what a player is worth: those answers come first and stay the same whatever is set here.' },
        ],
        source: source(ctx, 'Organizational Philosophy'), unknown: [], wouldChange: [], lean: null,
        certainty: 'policy', stamp: 'How Pennant uses the philosophy: stated, not fitted',
      }),
    }),
    identity: {
      headline: cell(identity.headline),
      tags: identity.tags.map((t) => cell(t)),
      summary: claim({
        text: identity.summary,
        tone: 'neutral',
        links: [],
        basis: basis({
          because: [
            { label: 'Read from', value: identity.from.length ? identity.from.join(', ') : 'Every setting is near neutral.' },
            { label: 'How it is read', value: `A setting at least ${IDENTITY_LINES.expressed} from 50 is expressed; a combined identity needs each of its settings well past neutral. Only these settings are read: never the club's record, its odds or where it stands.` },
          ],
          source: source(ctx, 'Organizational Philosophy'), unknown: [], wouldChange: ['A change to these settings.'], lean: null,
          certainty: 'policy', stamp: 'How the identity is read: stated, not fitted',
        }),
      }),
      nuance: cell(identity.nuance),
    },
    source: {
      title: cell('Who sets it'),
      mode: cell('Set by you'),
      text: cell('You set the club\'s philosophy directly. Letting the staff you hire shape it comes in a later version.'),
    },
    comparables: {
      title: cell('Comparable Baseball Operations'),
      lede: cell('Clubs from baseball history whose roster-building tendencies sit nearest the philosophy you have set.'),
      clubs: comparables.map((c) => ({
        id: c.id,
        name: cell(c.name),
        match: cell(c.match),
        description: cell(c.description),
        shared: c.shared.length ? cell(`Shared tendencies: ${c.shared.join(' · ')}`) : null,
      })),
      note: claim({
        text: 'Illustrations of a style, not claims that these clubs held such settings.',
        tone: 'neutral',
        links: [],
        basis: settingsBasis(ctx, [
          { label: 'How they are compared', value: 'Closest first, by how far your settings sit from each club\'s on the tendencies it is known for; the words say how near ("Very close", "Close", "Some overlap", "Loose overlap"), and a shared tendency is one you and the club lean the same way on, strongly.' },
          { label: 'Which era', value: 'The comparisons favor the free-agency era, where contract, control, payroll and farm strategies compare meaningfully.' },
        ]),
      }),
    },
    groups: GROUPS.map((g) => ({
      id: g.id,
      title: cell(g.title),
      description: cell(g.description),
      dimensions: g.ids.filter((id) => DIMENSION_WORDS[id]).map((id) => {
        const w = DIMENSION_WORDS[id];
        const value = values[id] ?? 50;
        return {
          id,
          label: cell(w.label),
          description: cell(w.description),
          value,
          position: cell(positionWords(id, value)),
          spoken: cell(`${w.description}${/[.!?]$/.test(w.description) ? '' : '.'} Now: ${positionWords(id, value)}.`),
          low: cell(w.low),
          high: cell(w.high),
          balanced: cell('Balanced'),
        };
      }),
    })),
    policies: {
      title: cell('Organizational Policies'),
      description: cell('Some choices are better stated as explicit policies than as numbers.'),
      items: Object.entries(options).filter(([id]) => POLICY_WORDS[id]).map(([id, opts]) => ({
        id,
        label: cell(POLICY_WORDS[id].label),
        description: cell(POLICY_WORDS[id].description),
        selected: (profile.policies as unknown as Record<string, string>)[id] ?? opts[0]?.value ?? '',
        options: opts.map((o) => ({ value: o.value, label: cell(o.label) })),
      })),
    },
    neutral: {
      title: cell('Neutral isn\'t necessarily right.'),
      text: cell('A setting of 50 means the club has no strong preference on that tradeoff. Move a setting because it reflects how you want this organization to operate.'),
      reset: cell('Reset to Neutral'),
      confirm: cell(`Reset ${ctx.club}'s philosophy to neutral?`),
      confirmDetail: cell('Every setting goes back to 50 and every policy to its default. You can undo it.'),
    },
  };
}

/** What a change to one setting reads as: "Competitive window set to 70: Leans — Maximize current wins." */
export function changeWords(
  update: PhilosophyUpdate,
  before: PhilosophyProfile,
  after: PhilosophyProfile,
  options: PolicyOptions,
): { said: string; undoName: string } {
  const dims = (update.dimensions ?? []).filter((d) => (before.manual as Record<string, number>)[d.id] !== (after.manual as Record<string, number>)[d.id]);
  const pols = (update.policies ?? []).filter((p) => (before.policies as unknown as Record<string, string>)[p.id] !== (after.policies as unknown as Record<string, string>)[p.id]);
  const all = dims.length + pols.length;
  if (all === 0) return { said: 'Nothing changed: those are the settings already in place.', undoName: 'Change Philosophy' };
  if (all > 1) return { said: `${all} settings changed.`, undoName: 'Change Philosophy' };
  if (dims.length === 1) {
    const id = dims[0].id;
    const value = (after.manual as Record<string, number>)[id];
    const label = DIMENSION_WORDS[id]?.label ?? id;
    return { said: `${label} set to ${value}: ${positionWords(id, value)}.`, undoName: `Change ${titled(label)}` };
  }
  const id = pols[0].id;
  const chosen = (after.policies as unknown as Record<string, string>)[id];
  const label = POLICY_WORDS[id]?.label ?? id;
  const optionLabel = options[id]?.find((o) => o.value === chosen)?.label ?? chosen;
  return { said: `${label}: ${optionLabel}.`, undoName: `Change ${titled(label)}` };
}

/** "Competitive Window" for the Edit menu's title case. */
const titled = (label: string): string =>
  label.split(' ').map((w, i) => (i === 0 || w.length > 3 ? `${w.charAt(0).toUpperCase()}${w.slice(1)}` : w)).join(' ');

/** The request that puts every setting a change touched back as it was. */
export function undoOf(update: PhilosophyUpdate, before: PhilosophyProfile): PhilosophyUpdate {
  return {
    dimensions: (update.dimensions ?? []).map((d) => ({ id: d.id, value: (before.manual as Record<string, number>)[d.id] })),
    policies: (update.policies ?? []).map((p) => ({ id: p.id, value: (before.policies as unknown as Record<string, string>)[p.id] })),
  };
}

/** The whole profile as a change (a reset's undo puts every setting back). */
export function wholeOf(profile: PhilosophyProfile): PhilosophyUpdate {
  return {
    dimensions: Object.entries(profile.manual).map(([id, value]) => ({ id, value })),
    policies: Object.entries(profile.policies as unknown as Record<string, string>).map(([id, value]) => ({ id, value })),
  };
}

export function changeOf(view: PhilosophyView, said: string, undoName: string, undo: PhilosophyUpdate): PhilosophyChange {
  return { view, said: cell(said), undoName: cell(undoName), undo };
}

