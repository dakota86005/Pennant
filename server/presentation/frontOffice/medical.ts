/**
 * Medical on the desk: the organization's injured, as the injury report lists them (`orgInjuries`, read through
 * `health.ts`'s one rule for who is hurt). An injury is noted (`severity.ts`); when a player's return forces a roster
 * move, that return is Major League Ops' item, so it is not raised a second time here (one problem appears once, under
 * its owner). He is still counted among the injured.
 */
import type { orgInjuries } from '../../dashboard.js';
import { basis, cell, claim, servedValue, target } from '../claim.js';
import { medicalSeverity } from '../severity.js';
import { item, plural, sourceOf, type DepartmentContext, type DepartmentMaterial } from './desk.js';

type Injury = ReturnType<typeof orgInjuries>[number];

/** What the Front Office reads from Medical: the injured, and whose return Major League Ops already has on its desk. */
export interface MedicalInput {
  injuries: readonly Injury[];
  /** Players whose return from the injured list is a Major League Ops item. */
  returnsOnMajorLeagueDesk: ReadonlySet<number>;
}

const SPECIALIST = 'The injury report';

const STATUS_WORDS: Record<string, string> = {
  'IL-60': 'is on the 60-day injured list',
  IL: 'is on the injured list',
  'Day-to-day': 'is day-to-day',
  Injured: 'is injured',
};

const daysWords = (days: number | null): string =>
  days === null ? 'Return date not in the export' : days <= 0 ? 'Due back now' : `About ${plural(days, 'day')} left`;

/** Medical's items, key figures and unknowns. */
export function medicalMaterial(ctx: DepartmentContext, input: MedicalInput): DepartmentMaterial {
  const raised = input.injuries.filter((p) => !input.returnsOnMajorLeagueDesk.has(Number(p.player_id)));
  const items = raised.map((p) => {
    const playerId = Number(p.player_id);
    const days = p.daysLeft ?? null;
    const headline = claim({
      text: `${p.name} ${STATUS_WORDS[p.status] ?? 'is injured'}`,
      tone: 'neutral',
      links: [target({ kind: 'player', playerId })],
      basis: basis({
        because: [
          { label: 'Status', value: String(p.status) },
          { label: 'Days left', value: days === null ? 'Not in the export' : String(days) },
          { label: 'Level', value: String(p.levelName) },
        ],
        source: sourceOf(ctx, SPECIALIST),
        unknown: days === null ? ['The export doesn\'t say when he is due back.'] : [],
        wouldChange: [],
        lean: null,
        certainty: 'fact',
      }),
    });
    return item(ctx, {
      key: `medical:injury:${playerId}`,
      severity: medicalSeverity(),
      shading: [],
      headline,
      detail: cell(`${p.positionName}, ${p.levelName} · ${daysWords(days)}`),
    });
  });

  const all = input.injuries.length;
  const majors = input.injuries.filter((p) => p.levelName === 'MLB').length;
  const dayToDay = input.injuries.filter((p) => p.status === 'Day-to-day').length;
  const moved = all - raised.length;
  const fact = (because: Array<{ label: string; value: string }>) =>
    basis({ because, source: sourceOf(ctx, SPECIALIST), unknown: [], wouldChange: [], lean: null, certainty: 'fact' });
  const figures = [
    claim({
      text: 'Injured',
      tone: 'neutral',
      value: servedValue(all, 'count', String(all)),
      hint: moved > 0 ? `${moved} whose return is on Major League Ops' desk` : undefined,
      basis: fact([
        { label: 'Injured in the organization', value: String(all) },
        ...(moved > 0 ? [{ label: 'Their return is a Major League Ops item', value: String(moved) }] : []),
      ]),
    }),
    claim({
      text: 'With the major league club',
      tone: 'neutral',
      value: servedValue(majors, 'count', String(majors)),
      basis: fact([{ label: 'Injured major leaguers', value: String(majors) }]),
    }),
    claim({
      text: 'Day-to-day',
      tone: 'neutral',
      value: servedValue(dayToDay, 'count', String(dayToDay)),
      basis: fact([{ label: 'Playing through it or day-to-day', value: String(dayToDay) }]),
    }),
  ];
  const noDate = input.injuries.filter((p) => p.daysLeft === null).length;
  const unknowns = noDate > 0 ? [`The export has no return date for ${plural(noDate, 'injured player')}.`] : [];
  return { specialist: SPECIALIST, items, figures, unknowns };
}
