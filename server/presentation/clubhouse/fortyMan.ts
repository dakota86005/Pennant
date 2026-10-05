/**
 * 40-Man & Options (N9): the roster crunch, worded from `computeRosterCrunchIssues` (the React page's
 * `/api/roster-crunch` and the Front Office's 40-man items, one read). Options, Rule 5 and what can be done come only
 * from Player Rights (D-023), the clocks and roster spots only from Player State (D-020): nothing here counts an option
 * or guesses a rule. What the export does not state is "not known" and sorts last (D-018), and no transaction is named
 * from a difference between exports; an assignment's words are the transaction log's, as Player Context read them.
 */
import type { Cell, Tone } from '../../contract/presentation.js';
import type { CrunchIssue, CrunchIssues } from '../../rosterops.js';
import { cell, servedValue, unknownValue } from '../claim.js';
import { block, column, line, tableRow } from '../majorLeague/common.js';
import type { MlbBlock, MlbLine, MlbRow } from '../majorLeague/types.js';
import { BASIS, RIGHTS_TONE } from '../majorLeague/words.js';
import { factClaim, head, hintIf, plural, player, type ClubhouseContext } from './common.js';
import type { MlbFortyManView, MlbTableSection } from './types.js';

const STATE = 'Player State';
const RIGHTS = 'Player Rights';

type Crunch = CrunchIssues['crunch'];
type CrunchPlayer = Crunch['fortyMan'][number];
type Rights = NonNullable<CrunchPlayer['rights']>;
type Action = Rights['actions'][keyof Rights['actions']];

/** Reasons that only restate where he already is (the React page leaves them out, as `relevantActions` does). */
const STRUCTURAL = new Set([
  'not_on_major_league_club', 'not_on_active_roster', 'already_with_major_league_club', 'not_on_forty_man',
  'already_on_forty_man', 'not_designated', 'not_on_injured_list',
]);

/** The actions worth showing: not a plain restatement of where he is. */
const relevant = (rights: Rights): Action[] =>
  Object.values(rights.actions).filter((a) => a.status !== 'ineligible' || a.reasons.some((r) => !STRUCTURAL.has(r.code)));

/** An issue in words, with its tone: a running clock is the urgent kind, an option note is to know. */
function issueWords(issue: CrunchIssue): { text: string; tone: Tone } {
  switch (issue.kind) {
    case 'designated':
      return { text: issue.daysLeft === null ? 'Designated for assignment: days left not in the export' : `Designated for assignment: ${plural(issue.daysLeft, 'day')} to resolve`, tone: 'bad' };
    case 'waivers':
      return { text: issue.daysLeft === null ? 'On waivers: days left not in the export' : `On waivers: ${plural(issue.daysLeft, 'day')} left`, tone: 'bad' };
    case 'out_of_options': return { text: 'Out of options', tone: 'caution' };
    case 'third_option_year': return { text: 'Third option year in use', tone: 'caution' };
    case 'last_option_year': return { text: 'Last option year', tone: 'neutral' };
  }
}

/** Where a rule comes from, in words. */
const basisWords = (b: string): string => BASIS[b] ?? b.replace(/_/g, ' ');

/** One action's full reasoning as lines (the React chip's tooltip, served). */
function actionLines(a: Action): MlbLine[] {
  return [
    line(a.label, { tone: RIGHTS_TONE[a.status] ?? 'neutral' }),
    ...a.reasons.map((r) => line(`${r.message} (${basisWords(r.basis)})`, { quiet: true })),
    ...a.requirements.filter((r) => r.status !== 'met').map((r) => line(r.message, { quiet: true })),
    ...a.missing.map((m) => line(`Not known: ${m.message}`, { quiet: true, tone: 'unknown' })),
    ...(a.limitation ? [line(a.limitation, { quiet: true })] : []),
  ];
}

const ROW_KINDS = new Set(['rehab_assignment', 'optioned', 'restricted_list']);

function statusCell(p: CrunchPlayer): Cell {
  const where = p.on26 ? 'Active' : 'On the 40-man';
  const a = p.assignment;
  const extra = a && ROW_KINDS.has(a.kind) ? ` · ${a.kind === 'rehab_assignment' ? 'Rehab' : a.label}` : '';
  return cell(`${where}${extra}`, { tone: 'neutral', ...(a && ROW_KINDS.has(a.kind) ? { hint: hintIf(`${a.label}, from ${a.source}`) } : {}) });
}

function optionsCell(rights: Rights | null): { cell: Cell; sort: number | null } {
  const y = rights?.optionYears;
  if (!y || y.used === null) return { cell: cell('Not known', { tone: 'unknown', hint: 'His option years aren\'t in the export' }), sort: null };
  const left = y.remaining === null ? 'remaining not known' : `${y.remaining} left`;
  const tone: Tone = y.standing === 'exhausted' || y.standing === 'exhausted_charged_this_season' ? 'caution' : 'neutral';
  return { cell: cell(`${y.used} used · ${left}`, { tone }), sort: y.used };
}

const RULE5: Record<string, [string, Tone]> = {
  protected_by_forty_man: ['Protected', 'neutral'],
  not_applicable: ['Doesn\'t apply', 'neutral'],
  indeterminate: ['Not known', 'unknown'],
};

function rule5Cell(rights: Rights | null): { cell: Cell; sort: number | null } {
  const r = rights?.ruleFive;
  if (!r) return { cell: cell('Not known', { tone: 'unknown' }), sort: null };
  const [text, tone] = RULE5[r.status] ?? ['Not known', 'unknown'];
  return { cell: cell(text, { tone, ...(hintIf(r.message) ? { hint: hintIf(r.message) } : {}) }), sort: r.status === 'indeterminate' ? null : r.status === 'protected_by_forty_man' ? 0 : 1 };
}

/** The move that matters for him (option while active, recall while below), as the React page shows it. */
function nowCell(p: CrunchPlayer): { cell: Cell; sort: number | null } {
  if (!p.rights) return { cell: cell('Not known', { tone: 'unknown', hint: 'Rights can\'t be read for him' }), sort: null };
  const a = relevant(p.rights).find((x) => x.action === (p.on26 ? 'option' : 'recall'));
  if (!a) return { cell: cell(p.on26 ? 'No option question' : 'No recall question', { tone: 'neutral' }), sort: 3 };
  const first = a.reasons[0]?.message ?? a.missing[0]?.message ?? null;
  const order: Record<string, number> = { eligible: 0, ineligible: 1, indeterminate: 2 };
  return { cell: cell(a.label, { tone: RIGHTS_TONE[a.status] ?? 'neutral', ...(hintIf(first) ? { hint: hintIf(first) } : {}) }), sort: order[a.status] ?? null };
}

function detail(p: CrunchPlayer, issues: CrunchIssue[]): MlbBlock[] {
  const out: MlbBlock[] = [];
  if (issues.length) out.push(block('Needs attention', issues.map((i) => { const w = issueWords(i); return line(w.text, { tone: w.tone }); })));
  const a = p.assignment;
  if (a) {
    out.push(block('Why he is where he is', [
      line(a.label),
      ...(a.sinceLabel && a.since ? [line(`${a.sinceLabel}: ${a.since}`, { quiet: true })] : []),
      line(`From ${a.source}`, { quiet: true }),
      ...(a.ordinaryOption === false && a.kind === 'rehab_assignment' ? [line('Not an option or a demotion.', { quiet: true })] : []),
      ...(a.note ? [line(a.note, { quiet: true })] : []),
    ]));
  }
  if (p.rights) {
    const stale = p.rights.evidence.currentState === 'behind' || p.rights.evidence.currentState === 'unavailable';
    if (stale) {
      out.push(block('What can be done', [line(p.rights.actions.option.missing[0]?.message ?? 'Rights can\'t be stated: the roster data is not current.', { quiet: true, tone: 'unknown' })]));
    } else {
      for (const action of relevant(p.rights)) out.push(block(null, actionLines(action)));
      if (p.rights.ruleFive.message.trim()) out.push(block('Rule 5', [line(p.rights.ruleFive.message, { quiet: true })]));
      if (p.rights.evidence.chronology === 'behind') {
        out.push(block(null, [line('The transaction log is behind the save, so moves that depend on his history are not stated.', { quiet: true, tone: 'unknown' })]));
      }
    }
  }
  return out;
}

function playerRow(v: ClubhouseContext, p: CrunchPlayer, issues: CrunchIssue[], prefix: string, withIssues: boolean): MlbRow {
  const options = optionsCell(p.rights);
  const rule5 = rule5Cell(p.rights);
  const now = nowCell(p);
  const words = issues.map(issueWords);
  const worst = words.some((w) => w.tone === 'bad') ? 'bad' : words.some((w) => w.tone === 'caution') ? 'caution' : 'neutral';
  const cells: Record<string, Cell> = {
    player: cell(p.name),
    position: cell(p.positionName),
    age: cell(String(p.age)),
    level: cell(p.levelName),
    status: statusCell(p),
    options: options.cell,
    rule5: rule5.cell,
    now: now.cell,
  };
  const sort: Record<string, number | string | null> = {
    player: p.name, position: p.positionName, age: p.age, level: p.levelName, status: p.on26 ? 0 : 1,
    options: options.sort, rule5: rule5.sort, now: now.sort,
  };
  if (withIssues) {
    cells.issues = cell(words.map((w) => w.text).join('; ') || 'None', { tone: worst });
    sort.issues = issues.length;
  }
  return tableRow(`${prefix}-${p.player_id}`, cells, sort, { player: player(p.player_id, p.name, v.ctx.build.orgId), detail: detail(p, issues) });
}

const COLUMNS = [
  column('player', 'Player'), column('position', 'Pos'), column('age', 'Age', true), column('level', 'Level'), column('status', 'Status'),
  column('options', 'Options', true), column('rule5', 'Rule 5'), column('now', 'What can be done'),
];

function countFigure(v: ClubhouseContext, label: string, count: number | null, limit: number | null) {
  const full = count !== null && limit !== null && count >= limit;
  return factClaim(v, label, {
    specialist: STATE,
    tone: count === null ? 'unknown' : full ? 'bad' : 'neutral',
    value: count === null
      ? unknownValue('count', 'Not in the export')
      : limit !== null && limit > 0 ? servedValue(count, 'count', `${count} of ${limit}`, { whole: limit }) : servedValue(count, 'count', `${count} of a limit not in the export`),
    because: [
      { label: 'Players', value: count === null ? 'Not in the export' : String(count) },
      { label: 'The league\'s limit', value: limit === null ? 'Not in the export' : String(limit) },
    ],
    unknown: limit === null ? ['The league\'s limit is not in the export.'] : [],
  });
}

export interface FortyManInput {
  crunch: CrunchIssues | string;
}

export function fortyManView(v: ClubhouseContext, input: FortyManInput): MlbFortyManView {
  const base = head(v, '40-Man & Options', {
    text: 'The 40-man roster, its clocks and options, and what can be done with each player',
    full: 'Who is on the active roster and the 40-man against the league\'s limits, the running designation and waiver clocks, the option notes, and for each player what Player Rights says can be done, with every reason and where the rule comes from in the row\'s detail. Nothing here is a move: the decision is yours, made in OOTP.',
    specialist: RIGHTS,
  });
  const c = input.crunch;
  if (typeof c === 'string') return { ...base, figures: [], sections: [], empty: cell(`${c}.`) };
  const crunch = c.crunch;
  const issuesOf = new Map(c.players.map((p) => [p.playerId, p.issues]));
  const attention: MlbTableSection = {
    id: 'attention',
    title: cell('Needs attention'),
    summary: crunch.issues.length ? cell(plural(crunch.issues.length, 'player')) : null,
    table: {
      columns: [column('player', 'Player'), column('position', 'Pos'), column('age', 'Age', true), column('level', 'Level'), column('issues', 'Issues', true), column('status', 'Status'), column('options', 'Options', true), column('rule5', 'Rule 5'), column('now', 'What can be done')],
      rows: crunch.issues.map((p) => playerRow(v, p, issuesOf.get(p.player_id) ?? [], 'attention', true)),
      empty: cell('No clocks running and no option notes.'),
    },
    note: null,
  };
  const forty: MlbTableSection = {
    id: 'fortyMan',
    title: cell('40-man roster'),
    summary: cell(`${crunch.fortyMan.filter((p) => p.on26).length} active · ${crunch.fortyMan.filter((p) => !p.on26).length} below`),
    table: { columns: COLUMNS, rows: crunch.fortyMan.map((p) => playerRow(v, p, issuesOf.get(p.player_id) ?? [], 'forty', false)), empty: cell('Nobody is on the 40-man in this export.') },
    note: factClaim(v, 'Where these answers come from', {
      specialist: RIGHTS,
      because: [
        { label: 'Roster spots and clocks', value: 'Player State: what the export says is true now.' },
        { label: 'Options, Rule 5 and moves', value: 'Player Rights: each answer with its reasons and where the rule comes from (the export, OOTP\'s documentation, or what was observed in OOTP).' },
        { label: 'Assignments', value: 'The transaction log, where it says why he is where he is; without it, nothing is assumed.' },
      ],
      unknown: ['A rule nobody has observed is not known, never a guess from the major league rules.'],
    }),
  };
  return {
    ...base,
    figures: [
      countFigure(v, 'Active roster', crunch.counts.active, crunch.limits.active),
      countFigure(v, '40-man roster', crunch.counts.fortyMan, crunch.limits.fortyMan),
      factClaim(v, 'Needs attention', {
        specialist: STATE,
        tone: crunch.counts.issues > 0 ? 'caution' : 'good',
        value: servedValue(crunch.counts.issues, 'count', String(crunch.counts.issues)),
        because: [{ label: 'Players with a clock running or an option note', value: String(crunch.counts.issues) }],
      }),
    ],
    sections: [attention, forty],
    empty: null,
  };
}
