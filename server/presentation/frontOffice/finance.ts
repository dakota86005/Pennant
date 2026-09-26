/**
 * Finance on the desk: the contracts heading to a decision after this season (Contracts' own groups: leaving, an option,
 * arbitration) and the payroll against the budget (Payroll). A contract date is noted, never a recommendation
 * (`severity.ts`): what to do about him is the GM's call, and Player Value describes, never authorizes (D-052).
 *
 * The count is the Contracts workspace's: every player it groups as leaving, holding an option or heading to
 * arbitration. A salary or a budget the export does not state is said to be missing, never $0 (D-018).
 */
import type { computeContracts } from '../../contracts.js';
import type { computePayroll } from '../../payroll.js';
import { basis, cell, claim, servedValue, target, unknownValue } from '../claim.js';
import { contractSeverity } from '../severity.js';
import { item, plural, sourceOf, type DepartmentContext, type DepartmentMaterial } from './desk.js';

type Contracts = ReturnType<typeof computeContracts>;
type Payroll = ReturnType<typeof computePayroll>;

/** What the Front Office reads from Finance: the contracts, and the payroll or why it could not be read. */
export interface FinanceInput {
  contracts: Pick<Contracts, 'seasonYear' | 'players'>;
  payroll: { ok: true; body: Pick<Payroll, 'seasonYear' | 'commitments'> } | { ok: false; reason: string };
}

const SPECIALIST = 'Contracts';
/** The groups that come to a decision after this season, in the order Contracts lists them. */
const DECISIONS = new Set(['leaving', 'option', 'arbitration']);

/** Dollars as a GM reads them: "$12.5M", "$750K". */
export function dollars(n: number): string {
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}K`;
  return `${sign}$${Math.round(a)}`;
}

function headlineText(p: Contracts['players'][number], season: number): string {
  if (p.group === 'leaving') return `${p.name}'s contract ends after ${season}`;
  if (p.group === 'arbitration') return `${p.name} is headed to arbitration`;
  return `${p.name}: ${p.after?.phrase ?? `an option for ${season + 1}`}`;
}

/** Finance's items, key figures and unknowns. */
export function financeMaterial(ctx: DepartmentContext, input: FinanceInput): DepartmentMaterial {
  const season = input.contracts.seasonYear;
  const deciding = input.contracts.players.filter((p) => DECISIONS.has(p.group));
  const items = deciding.map((p) => {
    const because = [
      { label: 'This season', value: p.salaryNow !== null ? dollars(p.salaryNow) : (p.salaryNote ?? 'Not in the export') },
      { label: 'After this season', value: p.after?.phrase ?? 'Not settled' },
    ];
    if (p.signedThrough !== null) because.push({ label: 'Signed through', value: String(p.signedThrough) });
    if (p.service) because.push({ label: 'Service', value: p.service });
    const headline = claim({
      text: headlineText(p, season),
      tone: 'neutral',
      links: [target({ kind: 'player', playerId: p.player_id })],
      basis: basis({
        because,
        source: sourceOf(ctx, SPECIALIST),
        unknown: [...new Set([...p.clauseNotes, ...(p.salaryNow === null && p.salaryNote ? [p.salaryNote] : [])])],
        wouldChange: [],
        lean: null,
        certainty: 'fact',
      }),
    });
    return item(ctx, {
      key: `finance:contract:${p.player_id}:${p.group}`,
      severity: contractSeverity({ dueInDays: null }),
      shading: [],
      headline,
      detail: cell(`${p.positionName}, age ${p.age}${p.salaryNow !== null ? `, ${dollars(p.salaryNow)} this season` : ''}`),
    });
  });

  const unknowns: string[] = [];
  const fact = (because: Array<{ label: string; value: string }>, unknown: string[], specialist: string) =>
    basis({ because, source: sourceOf(ctx, specialist), unknown, wouldChange: [], lean: null, certainty: 'fact' });
  const figures = [];
  const payroll = input.payroll;
  if (payroll.ok) {
    const now = payroll.body.commitments.find((c) => c.year === payroll.body.seasonYear) ?? null;
    const unstated = now?.unstated ?? 0;
    const missing = unstated > 0 ? [`${plural(unstated, 'salary', 'salaries')} this season ${unstated === 1 ? 'is' : 'are'} not in the export, so the total leaves ${unstated === 1 ? 'it' : 'them'} out.`] : [];
    figures.push(claim({
      text: 'Payroll this season',
      tone: 'neutral',
      value: now ? servedValue(now.total, 'dollars', dollars(now.total)) : unknownValue('dollars', 'Not in the export'),
      basis: fact([{ label: 'Committed this season', value: now ? dollars(now.total) : 'Not in the export' }], now ? missing : ['This season\'s payroll is not in the export.'], 'Payroll'),
    }));
    const room = now?.headroom ?? null;
    figures.push(claim({
      text: room !== null && room < 0 ? 'Over the budget' : 'Room under the budget',
      tone: room === null ? 'unknown' : room < 0 ? 'bad' : 'neutral',
      value: room === null ? unknownValue('dollars', 'Budget not in the export') : servedValue(Math.abs(room), 'dollars', dollars(Math.abs(room))),
      basis: fact(
        [{ label: 'Budget less committed payroll', value: room === null ? 'Not known' : dollars(room) }],
        room === null ? ['The club\'s budget is not in the export.'] : missing,
        'Payroll',
      ),
    }));
  } else {
    unknowns.push(payroll.reason);
  }
  const leaving = deciding.filter((p) => p.group === 'leaving').length;
  figures.push(claim({
    text: `Contracts ending after ${season}`,
    tone: 'neutral',
    value: servedValue(leaving, 'count', String(leaving)),
    basis: fact(
      [
        { label: 'Ending', value: String(leaving) },
        { label: 'Options to decide', value: String(deciding.filter((p) => p.group === 'option').length) },
        { label: 'Headed to arbitration', value: String(deciding.filter((p) => p.group === 'arbitration').length) },
      ],
      [],
      SPECIALIST,
    ),
  }));
  const unsettled = input.contracts.players.filter((p) => p.group === 'not_settled').length;
  if (unsettled > 0) unknowns.push(`What happens after this season isn't settled from the export for ${plural(unsettled, 'player')}.`);
  return { specialist: SPECIALIST, items, figures, unknowns };
}
