/**
 * Major League Ops on the desk: its needs (`mlbOverview`, MLB_OPERATIONS.md) and the 40-man's running clocks and option
 * notes (the roster crunch, from Player State and Player Rights), in the GM's words.
 *
 * It reads what Major League Ops served and decides nothing: each need keeps the severity its department gave it (on
 * the desk's scale, never raised) with the philosophy-free severity beside it, its facts as the evidence, its unknowns
 * as "not known". The headline is written here from the need's structure (its kind, role, the player it names), never
 * re-deriving whether it is a need. The counts are the workspace's: every need the overview lists and every player the
 * crunch lists with an issue, no more and no fewer.
 */
import type { Computed } from '../../computed.js';
import type { Certainty } from '../../contract/presentation.js';
import type { MlbNeed } from '../../mlbNeeds.js';
import type { MlbOverview } from '../../mlbOperations.js';
import type { CrunchIssue, CrunchIssues } from '../../rosterops.js';
import { basis, cell, claim, servedValue, target, unknownValue } from '../claim.js';
import { fortyManSeverity, mlbSeverity } from '../severity.js';
import { item, plural, sourceOf, type DepartmentContext, type DepartmentMaterial } from './desk.js';
import type { FoItem } from './types.js';

/** What the Front Office reads from Major League Ops. */
export interface MajorLeagueInput {
  overview: Pick<MlbOverview, 'needs' | 'roster' | 'unknowns' | 'yardsticks'>;
  fortyMan: Computed<CrunchIssues>;
}

const NEEDS = 'Major League Ops\' roster review';
const TONE = { critical: 'bad', attention: 'caution', noted: 'neutral' } as const;

const article = (word: string): string => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

/** The need in one line, from its structure. */
export function needText(need: MlbNeed, overview: MajorLeagueInput['overview']): { text: string; hint?: string } {
  const role = need.role?.label ?? null;
  const subject = need.subject?.name ?? need.causes[0]?.name ?? null;
  switch (need.kind) {
    case 'role_below_standard':
      return { text: `Short of healthy ${role ? `${role}s` : 'players in a role'}`, hint: 'Fewer healthy on the active roster than the club\'s minimum' };
    case 'open_active_spot': {
      const { count, limit } = overview.roster.active;
      const open = count !== null && limit !== null ? limit - count : null;
      return { text: open !== null && open > 0 ? `${plural(open, 'open spot')} on the active roster` : 'Open spots on the active roster' };
    }
    case 'il_return_crunch': {
      const back = need.returning;
      const days = back?.daysLeft ?? null;
      const when = days === null ? 'soon' : days <= 0 ? 'now' : `in about ${plural(days, 'day')}`;
      return { text: `${back?.name ?? 'A player'} is due back ${when}, and there's no room yet`, hint: 'A spot has to open before he can come off the injured list' };
    }
    case 'role_holder_review':
      return { text: `The staff flagged ${subject ?? 'a player'}'s work${role ? ` as ${article(role)}` : ''}`, hint: 'A flag to look at, not a move' };
    case 'platoon_complement': {
      const side = need.platoon?.weakSide === 'L' ? 'left' : need.platoon?.weakSide === 'R' ? 'right' : null;
      return { text: `${subject ?? 'A regular'} struggles against ${side ? `${side}-handed pitching` : 'one side'}`, hint: 'A partner for those games is one answer' };
    }
    case 'bench_coverage':
      return { text: `No backup on the bench${role ? ` for ${role}` : ''}`, hint: 'Nobody on the bench can visibly play the position' };
    default:
      return { text: 'A roster question from Major League Ops' };
  }
}

/** How a need is called: roster counts and clocks are facts; the minimum floors are policy; the review's lines are the save's fits or the starting values. */
function needCertainty(need: MlbNeed, overview: MajorLeagueInput['overview']): { certainty: Certainty; stamp?: string } {
  switch (need.kind) {
    case 'open_active_spot':
    case 'il_return_crunch':
      return { certainty: 'fact' };
    case 'role_below_standard':
    case 'bench_coverage':
      return { certainty: 'policy', stamp: 'Pennant\'s first-pass minimum for each role: a stated floor, not a league rule or an ideal roster.' };
    default: {
      const fitted = overview.yardsticks.groups.length > 0 && overview.yardsticks.groups.every((g) => g.source === 'save');
      return { certainty: fitted ? 'calibrated' : 'provisional', stamp: overview.yardsticks.line };
    }
  }
}

const clean = (lines: ReadonlyArray<{ label: string; value: string }>) =>
  lines.map((l) => ({ label: l.label.trim(), value: l.value.trim() })).filter((l) => l.label && l.value);
const sentences = (lines: readonly string[]) => [...new Set(lines.map((l) => l.trim()).filter(Boolean))];

function needItem(ctx: DepartmentContext, need: MlbNeed, overview: MajorLeagueInput['overview']): FoItem {
  const severity = mlbSeverity(need);
  const { text, hint } = needText(need, overview);
  const players = [need.returning?.playerId, need.subject?.playerId, ...need.causes.map((c) => c.playerId)]
    .filter((id): id is number => typeof id === 'number' && id > 0);
  const how = needCertainty(need, overview);
  const headline = claim({
    text,
    hint,
    tone: TONE[severity.severity],
    links: [...new Set(players)].map((playerId) => target({ kind: 'player', playerId })),
    basis: basis({
      because: [...clean(need.facts), { label: 'When', value: need.urgency.label }],
      source: sourceOf(ctx, NEEDS),
      unknown: sentences(need.unknowns),
      wouldChange: sentences(need.explanation?.wouldChange ?? []),
      lean: null,
      ...how,
    }),
  });
  const out = need.causes.filter((c) => c.playerId !== need.returning?.playerId && c.playerId !== need.subject?.playerId);
  const shading = (need.shading ?? need.explanation?.context.changed ?? []).map((r) => r.text);
  return item(ctx, {
    key: `majorLeague:need:${need.id}`,
    severity,
    shading,
    headline,
    detail: out.length ? cell(`Out: ${out.map((c) => c.name).join(', ')}`) : null,
    evidence: `${ctx.build.orgId}.majorLeague:need:${need.id}`,
  });
}

const ISSUE_TEXT: Record<CrunchIssue['kind'], (name: string) => string> = {
  designated: (n) => `${n} is designated for assignment`,
  waivers: (n) => `${n} is on waivers`,
  out_of_options: (n) => `${n} is out of options`,
  third_option_year: (n) => `${n} is using a third option year`,
  last_option_year: (n) => `${n} is in his last option year`,
};

function fortyManItem(ctx: DepartmentContext, player: CrunchIssues['players'][number], issue: CrunchIssue): FoItem {
  const clock = issue.kind === 'designated' || issue.kind === 'waivers' ? issue : null;
  const severity = fortyManSeverity({ clock: clock?.kind ?? null, daysLeft: clock?.daysLeft ?? null });
  const because = [
    { label: 'Position', value: player.positionName },
    { label: 'Level', value: player.levelName },
  ];
  if (clock) because.push({ label: 'Days left', value: clock.daysLeft === null ? 'Not in the export' : String(clock.daysLeft) });
  const headline = claim({
    text: ISSUE_TEXT[issue.kind](player.name),
    tone: clock ? 'bad' : 'neutral',
    links: [target({ kind: 'player', playerId: player.playerId })],
    basis: basis({
      because,
      source: sourceOf(ctx, clock ? 'Player State' : 'Player Rights'),
      unknown: clock && clock.daysLeft === null ? ['The export doesn\'t say how many days are left on the clock.'] : [],
      wouldChange: [],
      lean: null,
      certainty: 'fact',
    }),
  });
  return item(ctx, {
    key: `majorLeague:fortyMan:${player.playerId}:${issue.kind}`,
    severity,
    shading: [],
    headline,
    detail: cell(`${player.positionName}, ${player.levelName}`),
  });
}

/** A roster count against its limit as a key figure, or the sentence for a count the export lacks. */
function countFigure(ctx: DepartmentContext, label: string, count: number | null, limit: number | null, specialist: string) {
  const known = count !== null;
  return claim({
    text: label,
    tone: known ? 'neutral' : 'unknown',
    value: known
      ? servedValue(count, 'count', limit !== null ? `${count} of ${limit}` : String(count))
      : unknownValue('count', 'Not in the export'),
    basis: basis({
      because: [
        { label: 'Players', value: known ? String(count) : 'Not in the export' },
        { label: 'Limit', value: limit !== null ? String(limit) : 'Not in the export' },
      ],
      source: sourceOf(ctx, specialist),
      unknown: [
        ...(known ? [] : [`The export doesn't say who is on the ${label.toLowerCase()}.`]),
        ...(limit === null ? ['The league\'s limit is not in the export.'] : []),
      ],
      wouldChange: [],
      lean: null,
      certainty: 'fact',
    }),
  });
}

/** Major League Ops' items, key figures and unknowns. */
export function majorLeagueMaterial(ctx: DepartmentContext, input: MajorLeagueInput): DepartmentMaterial {
  const { overview, fortyMan } = input;
  const items = overview.needs.map((need) => needItem(ctx, need, overview));
  const unknowns = [...overview.unknowns];
  if (fortyMan.ok) {
    for (const player of fortyMan.body.players) for (const issue of player.issues) items.push(fortyManItem(ctx, player, issue));
  } else {
    unknowns.push('The export has no roster status, so the 40-man\'s clocks and options are not known.');
  }
  const crunch = fortyMan.ok ? fortyMan.body.crunch : null;
  const figures = [
    countFigure(ctx, 'Active roster', overview.roster.active.count, overview.roster.active.limit, NEEDS),
    countFigure(ctx, '40-man roster', crunch?.counts.fortyMan ?? overview.roster.fortyMan.count, crunch?.limits.fortyMan ?? overview.roster.fortyMan.limit, 'Player State'),
    claim({
      text: 'On the injured list',
      tone: 'neutral',
      value: servedValue(overview.roster.injuredList, 'count', String(overview.roster.injuredList)),
      basis: basis({
        because: [{ label: 'Major league players on the injured list', value: String(overview.roster.injuredList) }],
        source: sourceOf(ctx, NEEDS),
        unknown: [],
        wouldChange: [],
        lean: null,
        certainty: 'fact',
      }),
    }),
  ];
  return { specialist: NEEDS, items, figures, unknowns };
}
