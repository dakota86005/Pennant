/**
 * The player window's dossier, in words (N11; SWIFTUI_REBUILD.md section 9): the React card (`src/playerModal.tsx` and
 * its sections) served as sections a Mac window draws: the header, Overview, Ratings, Value, Contract & rights and
 * History. Every sentence is authored here with its basis; every figure is the specialists' as handed in
 * (`DossierInput`). Nothing here ranks, judges or authorizes (D-001, D-052): value is ranges with their basis, rights are
 * Player Rights' answers, ratings are the organization's scouted view (D-017, D-067), and the club's playoff odds are not
 * on it (D-060).
 */
import type { BasisLine, Cell, DeptId, Tone } from '../../contract/presentation.js';
import { gameDateWords } from '../../dataStatus.js';
import { parseGameDate } from '../../dataFreshness.js';
import { basis, cell, claim, row, servedValue, target, unknownValue } from '../claim.js';
import { plain, plainAll, ratingText, type RatingDisplay } from '../farm/words.js';
import type { DossierInput } from './input.js';
import type {
  PlayerColumn, PlayerConeSeason, PlayerConeView, PlayerContactView, PlayerContractView, PlayerDossierView, PlayerFact,
  PlayerHeaderView, PlayerHistoryPoint, PlayerHistoryView, PlayerLogEntry, PlayerOurView, PlayerOverview, PlayerRatingGroup,
  PlayerRatingRow, PlayerRatingsView, PlayerRightsAction, PlayerTable, PlayerTableRow, PlayerTile, PlayerValueTotal, PlayerValueView,
} from './types.js';
import {
  TIP_CONTACT, TIP_CONTRACT, TIP_CONTRACT_VALUE, TIP_OPTION_YEARS, TIP_COULD_BE, TIP_IF_KEPT, TIP_KEEPING_HIM, TIP_NO_SINGLE, TIP_OUR_VIEW, TIP_SCOUTED,
  TIP_SPLITS, TIP_WINS_ONLY, afterColon, afterLine, capitalized, coneCostText, coneRangeWords, controlEndWords, costRangeText, heldText,
  listSeasons, money, notValuedLine, ordinal, perWin, plural, rangeText, rate3, salaryLine, scaleLow, scaleWords, seasonsText, sentence,
  signedMoney, signedTenths, termLine, totalHeadline, usageText, winsText, type SeasonInput, type TotalInput, type ViewInput,
} from './words.js';

type Body = DossierInput['body'];

// ── bases ───────────────────────────────────────────────────────────────────

const PLAYER_VALUE = 'Player Value';
const PLAYER_RIGHTS = 'Player Rights';
const THE_EXPORT = 'The export';
const SCOUTING = 'Our scouts';

function sourceOf(ctx: DossierInput, department: DeptId, specialist: string) {
  return { department, specialist, asOf: ctx.importStamp, gameDate: ctx.gameDate };
}

/** Lines with a value: an empty value is left out (a basis line is never blank). */
const lines = (pairs: ReadonlyArray<readonly [string, string | null | undefined]>): BasisLine[] =>
  pairs.filter((p): p is readonly [string, string] => typeof p[1] === 'string' && p[1].trim().length > 0)
    .map(([label, value]) => ({ label, value: value.trim() }));

/** Objective facts the export states (a record, a contract term, a date). */
function factBasis(ctx: DossierInput, because: BasisLine[], unknown: string[] = [], department: DeptId = 'frontOffice', specialist = THE_EXPORT) {
  return basis({
    because: because.length ? because : [{ label: 'Read from', value: 'The imported export' }],
    source: sourceOf(ctx, department, specialist),
    unknown: plainAll(unknown), wouldChange: [], lean: null, certainty: 'fact',
  });
}

/** How Player Value's figures are called: the save's own fit, or the starting numbers until it has one (D-041, D-053). */
function valueCalled(ctx: DossierInput): { certainty: 'calibrated' | 'provisional' | 'policy'; stamp: string } {
  const stamp = ctx.surplus?.stamp;
  if (stamp) return { certainty: stamp.status, stamp: stamp.run ?? (stamp.basis || 'Player Value') };
  const checked = ctx.cone?.calibration.calibrated === true;
  return { certainty: checked ? 'calibrated' : 'provisional', stamp: ctx.cone?.calibration.status || 'Player Value' };
}

function valueBasis(ctx: DossierInput, because: BasisLine[], unknown: string[] = [], wouldChange: string[] = []) {
  return basis({
    because: because.length ? because : [{ label: 'From', value: PLAYER_VALUE }],
    source: sourceOf(ctx, 'finance', PLAYER_VALUE),
    unknown: plainAll(unknown), wouldChange: plainAll(wouldChange), lean: null, ...valueCalled(ctx),
  });
}

/** A help tag is one short line; a longer one goes in the basis only. */
const tag = (text: string | null | undefined): { hint?: string } => (text && text.length <= 75 ? { hint: text } : {});

const fact = (label: string, value: string, extra: { hint?: string; tone?: Tone } = {}): PlayerFact => ({
  label: cell(label), value: cell(value, extra), claim: null,
});

const dateWords = (raw: string | null | undefined): string | null => {
  const parsed = parseGameDate(raw ?? null);
  return parsed ? gameDateWords(parsed) : null;
};

// ── tables ──────────────────────────────────────────────────────────────────

type Col = readonly [id: string, title: string, numeric: boolean];

/** A table from rows of display strings and sort keys; a blank display is "—" with a null sort (never a zero). */
function table(
  id: string, title: string, cols: readonly Col[],
  rows: ReadonlyArray<{ id: string; cells: Record<string, string | null>; sort?: Record<string, number | string | null> }>,
  extra: { empty?: string; note?: string; hint?: string } = {},
): PlayerTable {
  const columns: PlayerColumn[] = cols.map(([cid, t, numeric]) => ({ id: cid, title: cell(t), numeric }));
  const out: PlayerTableRow[] = rows.map((r) => {
    const cells: Record<string, Cell> = {};
    const sort: Record<string, number | string | null> = {};
    for (const [cid] of cols) {
      const shown = r.cells[cid];
      cells[cid] = cell(shown && shown.trim() ? shown : '—');
      const key = r.sort?.[cid];
      sort[cid] = key === undefined ? (shown && shown.trim() ? shown : null) : key;
    }
    return row(r.id, cells, sort);
  });
  return {
    id, title: cell(title, tag(extra.hint)), columns, rows: out,
    empty: out.length ? null : cell(extra.empty ?? 'Nothing recorded'), note: extra.note ? cell(extra.note) : null,
  };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);

// ── the header ──────────────────────────────────────────────────────────────

function header(ctx: DossierInput): PlayerHeaderView {
  const d = ctx.body;
  const role = d.roleName ?? d.positionName;
  const lineParts = [role, d.twoWay ? 'Two-way' : null, `Bats ${d.bats}, throws ${d.throws}`, d.age !== null && d.age !== undefined ? `Age ${d.age}` : null, d.heightWeight];
  const tiles: PlayerTile[] = [];
  const c = d.header.contract;
  if (c && c.standing !== 'unsigned') {
    const salary = salaryLine(c);
    const term = termLine(c);
    const after = afterLine(c);
    const tileLines: Cell[] = [];
    if (term) tileLines.push(cell(term));
    if (after) tileLines.push(cell(after.text, tag(after.why ? 'Why: see the basis' : null)));
    if (c.clauses.length) tileLines.push(cell(c.clauses.join(' · ')));
    if ((c.clauseNotes ?? []).length) tileLines.push(cell('Some terms not in the export', tag('Clauses the export does not fill in are not known, never none')));
    tiles.push({
      id: 'contract',
      title: cell('Contract', { hint: 'His deal as the export states it' }),
      figure: claim({
        text: salary.text, tone: salary.why ? 'unknown' : 'neutral',
        ...(c.salaryNow !== null ? { value: servedValue(c.salaryNow, 'dollars', money(c.salaryNow)) } : {}),
        basis: factBasis(ctx, lines([
          ['What it is', TIP_CONTRACT], ['This season', salary.text], ['Term', term], ['After this season', after?.text],
          ['Why', after?.why ?? null], ['Clauses', c.clauses.join(' · ') || null],
        ]), [...(salary.why ? [salary.why] : []), ...(c.clauseNotes ?? [])], 'finance', PLAYER_VALUE),
      }),
      lines: tileLines,
    });
  }
  const v = d.header.value;
  if (v && v.status !== 'not_held') {
    const winsOnly = v.unit === 'wins';
    const total = winsOnly ? v.wins : v.contract;
    const fmt = winsOnly ? winsText : signedMoney;
    const known = total.status === 'known' && total.low !== null && total.high !== null;
    const head = known ? totalHeadline(total, fmt, ctx.surplus?.seasons ?? [], (s) => s.contract) : null;
    tiles.push({
      id: 'value',
      title: cell(winsOnly ? 'Wins above replacement' : 'Contract value', { hint: winsOnly ? 'His projected wins above a minimum-salary player' : "What he's worth beyond what he's paid" }),
      figure: claim({
        text: head ? head.text : 'Not valued yet', tone: head ? 'neutral' : 'unknown',
        value: known
          ? (total.central !== null
            ? servedValue(total.central, winsOnly ? 'wins' : 'dollars', fmt(total.central), { low: total.low!, high: total.high! })
            : unknownValue(winsOnly ? 'wins' : 'dollars', rangeText(total.low!, total.high!, fmt)))
          : unknownValue(winsOnly ? 'wins' : 'dollars', 'Not valued yet'),
        basis: valueBasis(ctx, lines([
          ['What it is', winsOnly ? TIP_WINS_ONLY : TIP_CONTRACT_VALUE], ['The range', head?.couldBe ? `${capitalized(head.couldBe)}. ${TIP_COULD_BE}` : null],
          ['No single figure', head && !head.mostLikely ? TIP_NO_SINGLE : null],
        ]), known ? [] : [total.reason ?? v.reason ?? 'Not established.']),
      }),
      lines: head?.couldBe ? [cell(head.couldBe, { hint: 'A range of outcomes, not a forecast' })] : [],
    });
  }
  const s = d.scouted;
  if (s) {
    const part = (n: number | null) => (n === null ? 'not scouted' : ratingText(n, ctx.rating));
    const text = s.now === null && s.ceiling === null ? 'Not scouted' : `${part(s.now)} → ${part(s.ceiling)}`;
    tiles.push({
      id: 'scouted',
      title: cell('Scouted', { hint: "Your scouts' grades for his tools, averaged" }),
      figure: claim({
        text, tone: s.now === null && s.ceiling === null ? 'unknown' : 'neutral',
        basis: basis({
          because: lines([['What it is', TIP_SCOUTED], ['Whose grades', d.ratingsFill?.hint ?? ctx.ratingSource.text], ['Now', part(s.now)], ['Ceiling', part(s.ceiling)]]),
          source: sourceOf(ctx, 'scouting', SCOUTING),
          unknown: [...s.missing.now.map((t) => `Now: ${t} not graded.`), ...s.missing.ceiling.map((t) => `Ceiling: ${t} not graded.`)],
          wouldChange: ['A new scouting report on him.'], lean: null, certainty: 'fact',
        }),
      }),
      lines: [cell('now → ceiling')],
    });
  }
  const cue = d.header.freshness;
  const asOf = cue.asOf ? `As of ${gameDateWords(cue.asOf)}` : null;
  const freshness = claim({
    text: [asOf, cue.line].filter(Boolean).join(' · ') || 'Date not known',
    tone: cue.state === 'behind' || cue.state === 'unavailable' ? 'bad' : cue.state === 'unverified' ? 'caution' : 'neutral',
    basis: basis({
      because: lines([['How current', cue.detail], ['The export is from', asOf]]),
      source: sourceOf(ctx, 'frontOffice', 'Data status'),
      unknown: plainAll(cue.limitations), wouldChange: ['A newer export.'], lean: null,
      certainty: cue.asOf ? 'fact' : 'unknown',
    }),
  });
  const injury = d.currentInjury
    ? claim({
      text: `${d.currentInjury.status}${d.currentInjury.daysLeft ? ` · about ${plural(d.currentInjury.daysLeft, 'day')} left` : ''}`,
      tone: 'caution',
      basis: factBasis(ctx, lines([['Status', d.currentInjury.status], ['Days left', d.currentInjury.daysLeft ? String(d.currentInjury.daysLeft) : null]]), [], 'medical'),
    })
    : null;
  const clubId = ctx.state?.organizationId.value ?? null;
  return {
    name: d.name,
    number: d.uniform !== null && d.uniform !== undefined && String(d.uniform).trim() !== '' ? cell(`#${d.uniform}`) : null,
    nickname: d.nickname || null,
    line: cell(lineParts.filter((x): x is string => typeof x === 'string' && x.length > 0).join(' · ')),
    club: cell(d.team ?? 'No club', d.organization && d.organization !== d.team ? tag(`Organization: ${d.organization}`) : {}),
    clubOpen: clubId !== null && clubId > 0 ? target({ kind: 'club', teamId: clubId }) : null,
    injury,
    tiles,
    freshness,
    ratingsFill: d.ratingsFill ? cell(d.ratingsFill.mark, { hint: d.ratingsFill.hint }) : null,
  };
}

// ── rights (`src/PlayerRights.tsx`) ─────────────────────────────────────────

/** Reasons that only restate where he already is: true, but no GM needs "cannot option: he is in the minors". */
const STRUCTURAL = new Set([
  'not_on_major_league_club', 'not_on_active_roster', 'already_with_major_league_club', 'not_on_forty_man',
  'already_on_forty_man', 'not_designated', 'not_on_injured_list',
]);

const RULE_BASIS: Record<string, string> = {
  export_state: 'Stated by the export',
  observed: 'Observed in OOTP',
  documented: 'OOTP documentation',
  observed_and_documented: 'Observed in OOTP and documented',
  owner_attested: "The owner's statement of how OOTP behaves",
};

const RIGHTS_STATUS: Record<string, { text: string; tone: Tone }> = {
  eligible: { text: 'Can be done', tone: 'good' },
  ineligible: { text: "Can't be done now", tone: 'neutral' },
  indeterminate: { text: 'Not established', tone: 'unknown' },
};

type Rights = NonNullable<Body['rights']>;
type ActionRights = Rights['actions'][keyof Rights['actions']];

function rightsAction(ctx: DossierInput, a: ActionRights): PlayerRightsAction {
  const status = RIGHTS_STATUS[a.status] ?? { text: 'Not established', tone: 'unknown' as Tone };
  const because: BasisLine[] = a.reasons.map((r) => ({ label: RULE_BASIS[r.basis] ?? 'Basis', value: plain(r.message) }))
    .filter((l) => l.value.length > 0);
  for (const r of a.requirements.filter((q) => q.status !== 'met')) because.push({ label: 'First', value: plain(r.message) });
  return {
    action: a.action,
    status: cell(status.text, { tone: status.tone }),
    claim: claim({
      text: plain(a.label), tone: status.tone,
      basis: basis({
        because: because.length ? because : [{ label: 'From', value: PLAYER_RIGHTS }],
        source: sourceOf(ctx, 'majorLeague', PLAYER_RIGHTS),
        unknown: plainAll([...a.missing.map((m) => m.message), ...(a.limitation ? [a.limitation] : [])]),
        wouldChange: [], lean: null,
        certainty: a.status === 'indeterminate' ? 'unknown' : 'fact',
      }),
    }),
  };
}

/**
 * Option years left, as Player Rights states them (`optionYearsOf`), behind the same current-state gate as the actions:
 * an export behind the save or not read states none. An `indeterminate` standing is "Not established" with Rights'
 * reason; never a count guessed from the parts that are known (review M1, N11).
 */
function optionYearsFact(ctx: DossierInput): PlayerFact | null {
  const rights = ctx.body.rights;
  if (!rights) return null;
  const oy = rights.optionYears;
  const stale = rights.evidence.currentState === 'behind' || rights.evidence.currentState === 'unavailable';
  const label = 'Option years left';
  const hint = 'Seasons he can still be sent down without passing through waivers';
  const because = (lines: BasisLine[], unknown: string[], certainty: 'fact' | 'unknown') => basis({
    because: [{ label: 'What it is', value: TIP_OPTION_YEARS }, ...lines],
    source: sourceOf(ctx, 'majorLeague', PLAYER_RIGHTS),
    unknown: plainAll(unknown), wouldChange: [], lean: null, certainty,
  });
  if (stale || oy.standing === 'indeterminate') {
    const why = stale
      ? plain(rights.actions.option.missing[0]?.message ?? 'Rights cannot be stated: roster data is not current.')
      : plain(oy.reason ?? 'Player Rights does not establish his option years.');
    return {
      label: cell(label), value: cell('Not established', { tone: 'unknown', hint }),
      claim: claim({ text: 'Option years not established', tone: 'unknown', basis: because([], [why], 'unknown') }),
    };
  }
  const used = oy.used ?? 0;
  const text = oy.standing === 'available' ? String(oy.remaining ?? 0) : 'None left';
  const lines: BasisLine[] = [{ label: 'Used', value: plural(used, 'option year') }];
  if (oy.usedThisSeason !== null) lines.push({ label: 'This season', value: oy.usedThisSeason > 0 ? 'Optioned this season' : 'Not optioned this season' });
  return {
    label: cell(label), value: cell(text, { hint }),
    claim: claim({ text: `${label}: ${text}`, tone: 'neutral', basis: because(lines, [], 'fact') }),
  };
}

/** The actions worth showing: not a plain restatement of where he is (the React card's rule). */
function relevantRights(ctx: DossierInput): { actions: PlayerRightsAction[]; note: string | null } {
  const rights = ctx.body.rights;
  if (!rights) return { actions: [], note: 'Player Rights has nothing to say about him: he is not on a club the export places.' };
  const stale = rights.evidence.currentState === 'behind' || rights.evidence.currentState === 'unavailable';
  if (stale) return { actions: [], note: plain(rights.actions.option.missing[0]?.message ?? 'Rights cannot be stated: roster data is not current.') };
  const actions = Object.values(rights.actions)
    .filter((a) => a.status !== 'ineligible' || a.reasons.some((r) => !STRUCTURAL.has(r.code)))
    .map((a) => rightsAction(ctx, a));
  const chronology = rights.evidence.chronology === 'behind'
    ? 'The transaction log is behind the save, so moves that depend on his history are not stated.'
    : null;
  return { actions, note: chronology };
}

// ── overview ────────────────────────────────────────────────────────────────

const LEVEL_ORDER = ['MLB', 'AAA', 'AA', 'A', 'R'];

/** This season's line at his highest level (the hover card's), newest season first in the export's rows. */
function thisSeasonLine(ctx: DossierInput): string | null {
  const d = ctx.body;
  const rows = ((d.isPitcher ? d.pitchingYears : d.battingYears) ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return null;
  const latest = rows[0]?.year;
  const same = rows.filter((r) => r.year === latest);
  const best = same.sort((a, b) => LEVEL_ORDER.indexOf(String(a.levelName)) - LEVEL_ORDER.indexOf(String(b.levelName)))[0];
  if (!best) return null;
  const level = best.levelName && best.levelName !== 'MLB' ? `${best.levelName} · ` : '';
  if (d.isPitcher) {
    const ip = num(best.ip);
    const era = num(best.era);
    if (ip === null && era === null) return null;
    return `${latest}: ${level}${ip ?? '—'} IP · ${era === null ? '—' : era.toFixed(2)} ERA · ${num(best.k) ?? '—'} K`;
  }
  const pa = num(best.pa);
  if (pa === null) return null;
  return `${latest}: ${level}${pa} PA · ${rate3(num(best.avg)) ?? '—'}/${rate3(num(best.obp)) ?? '—'}/${rate3(num(best.slg)) ?? '—'} · ${num(best.hr) ?? 0} HR`;
}

/** Honours grouped as the card groups them: "3× All-Star (2031, 2030, 2028)", the server's order (MVP first). */
function honoursRows(d: Body): Array<{ label: string; years: number[]; rank: number }> {
  const groups = new Map<string, { years: number[]; rank: number }>();
  for (const a of d.awards ?? []) {
    const label = a.positionName ? `${a.award} (${a.positionName})` : a.award;
    const g = groups.get(label) ?? { years: [], rank: a.rank };
    g.years.push(a.year);
    g.rank = Math.min(g.rank, a.rank);
    groups.set(label, g);
  }
  return [...groups].map(([label, g]) => ({ label, years: g.years.sort((x, y) => y - x), rank: g.rank })).sort((a, b) => a.rank - b.rank);
}

function overview(ctx: DossierInput): PlayerOverview {
  const d = ctx.body;
  const facts: PlayerFact[] = [];
  facts.push(fact('Position', d.roleName ?? d.positionName ?? 'Not known'));
  facts.push(fact('Bats / throws', `${d.bats} / ${d.throws}`));
  if (d.age !== null && d.age !== undefined) facts.push(fact('Age', String(d.age)));
  const born = dateWords(typeof d.dob === 'string' ? d.dob : null);
  if (born) facts.push(fact('Born', born));
  if (d.heightWeight) facts.push(fact('Height, weight', d.heightWeight));
  facts.push(fact('Club', d.team ?? 'No club'));
  if (d.organization && d.organization !== d.team) facts.push(fact('Organization', d.organization));
  facts.push(fact('Major-league service', d.serviceYears === null || d.serviceYears === undefined ? 'Not in the export' : plural(d.serviceYears, 'year'),
    d.serviceYears === null || d.serviceYears === undefined ? { tone: 'unknown' } : {}));
  if (typeof d.careerEarnings === 'number' && d.careerEarnings > 0) facts.push(fact('Career earnings', money(d.careerEarnings), { hint: 'Salary the export records him paid, every season' }));
  const a = d.assignment;
  const assignment = a
    ? {
      claim: claim({
        text: plain(a.label), tone: a.kind === 'unattributed' ? 'unknown' as Tone : 'neutral' as Tone,
        basis: factBasis(ctx, lines([
          ['Why he is there', plain(a.label)], ['Since', a.sinceLabel && a.since ? `${plain(a.sinceLabel)}: ${dateWords(a.since) ?? a.since}` : null],
          ['Source', a.source], ['Note', a.note ? plain(a.note) : null],
        ]), a.kind === 'unattributed' ? ['Why he is there is not established: the export and the log together do not say.'] : [], 'majorLeague', 'Player State'),
      }),
      lines: [
        ...(a.sinceLabel && a.since ? [cell(`${plain(a.sinceLabel)}: ${dateWords(a.since) ?? a.since}`)] : []),
        ...(a.kind === 'rehab_assignment' ? [cell('Not an option or a demotion')] : []),
        ...(a.note ? [cell(plain(a.note))] : []),
        cell(`Source: ${a.source}`),
      ],
    }
    : null;
  const season = thisSeasonLine(ctx);
  const honours = honoursRows(d);
  return {
    facts,
    assignment,
    thisSeason: season
      ? claim({ text: season, tone: 'neutral', basis: factBasis(ctx, [{ label: 'From', value: 'His season statistics in the export, at his highest level this season' }], [], 'league', 'Statistics') })
      : null,
    honours: honours.length ? cell(honours.slice(0, 4).map((h) => `${h.years.length > 1 ? `${h.years.length}× ` : ''}${h.label}`).join(' · ')) : null,
    rights: relevantRights(ctx).actions.filter((r) => r.status.tone !== 'neutral').slice(0, 4),
  };
}

// ── ratings ─────────────────────────────────────────────────────────────────

const RATING_LABELS: Record<string, string> = {
  contact: 'Contact', gap: 'Gap power', power: 'Power', eye: 'Eye', avoidK: 'Avoiding strikeouts',
  speed: 'Speed', stealing: 'Stealing', baserunning: 'Baserunning',
  stuff: 'Stuff', movement: 'Movement', control: 'Control', stamina: 'Stamina',
  infieldRange: 'Infield range', infieldArm: 'Infield arm', turnDP: 'Turning two',
  outfieldRange: 'Outfield range', outfieldArm: 'Outfield arm', catcherArm: 'Catcher arm', catcherAbility: 'Catcher ability',
};
const PITCH_LABELS: Record<string, string> = {
  fastball: 'Fastball', sinker: 'Sinker', cutter: 'Cutter', slider: 'Slider', curveball: 'Curveball',
  changeup: 'Changeup', splitter: 'Splitter', forkball: 'Forkball', screwball: 'Screwball',
  circlechange: 'Circle change', knucklecurve: 'Knuckle curve', knuckleball: 'Knuckleball',
};

function ratingRow(id: string, label: string, now: number | null, ceiling: number | null, display: RatingDisplay, fill: Cell | null): PlayerRatingRow {
  const shown = now === null ? 'Not scouted' : ceiling !== null && ceiling > now && ratingText(ceiling, display) !== ratingText(now, display)
    ? `${ratingText(now, display)} → ${ratingText(ceiling, display)}` : ratingText(now, display);
  const hint = fill?.hint ?? (ceiling !== null && now !== null && ceiling > now ? 'Now, then his ceiling' : undefined);
  return {
    ...row(id, { tool: cell(label), grade: cell(shown, { ...(now === null ? { tone: 'unknown' as Tone } : {}), ...(hint ? { hint } : {}) }) }, { tool: label, grade: now }),
    now, ceiling,
  };
}

function ratingGroups(ctx: DossierInput, fill: Cell | null): PlayerRatingGroup[] {
  const d = ctx.body;
  const display = ctx.rating;
  const groups: PlayerRatingGroup[] = [];
  const pairs = (r: Record<string, number[]> | null | undefined) => Object.entries(r ?? {})
    .map(([k, [cur, pot]]) => ratingRow(k, RATING_LABELS[k] ?? capitalized(k), num(cur), num(pot), display, fill));
  if (d.isPitcher && d.pitchingRatings) groups.push({ id: 'pitching', title: cell('Pitching'), rows: pairs(d.pitchingRatings as Record<string, number[]>), note: null });
  if (d.pitches.length) {
    groups.push({
      id: 'arsenal', title: cell('Arsenal'),
      rows: d.pitches.map((p) => ratingRow(p.name, PITCH_LABELS[p.name] ?? capitalized(p.name), num(p.rating), num(p.talent), display, fill)),
      note: null,
    });
  }
  if (!d.isPitcher && d.battingRatings) groups.push({ id: 'batting', title: cell('Batting'), rows: pairs(d.battingRatings as Record<string, number[]>), note: null });
  if ((d.positionRatings ?? []).length) {
    groups.push({
      id: 'positions', title: cell('Positions', { hint: 'Only positions OOTP has rated him at' }),
      rows: (d.positionRatings ?? []).map((p) => {
        const r = ratingRow(`pos-${p.position}`, `${p.code}${p.isPrimary ? ' · listed' : ''}${p.experience > 0 ? ' · has played here' : ''}`, num(p.current), num(p.potential), display, fill);
        return r;
      }),
      note: cell('Only positions OOTP has rated him at. Others stay blank until he plays there.'),
    });
  }
  if (!d.isPitcher && d.fieldingRatings) {
    const rows = Object.entries(d.fieldingRatings).filter(([, v]) => typeof v === 'number' && v > 0)
      .map(([k, v]) => ratingRow(k, RATING_LABELS[k] ?? capitalized(k), num(v), num(v), display, fill));
    if (rows.length) groups.push({ id: 'fielding', title: cell('Fielding'), rows, note: null });
  }
  return groups;
}

function ratingHistory(ctx: DossierInput): PlayerRatingsView['history'] {
  const rows = ctx.history.rows;
  const display = ctx.rating;
  const points: PlayerHistoryPoint[] = rows.map((r, i) => ({
    index: i,
    date: r.game_date,
    label: cell(dateWords(r.game_date) ?? r.game_date),
    now: num(r.cur),
    ceiling: num(r.pot),
  }));
  const composite = (n: number | null) => (n === null ? 'Not seen' : display.roundToFive && display.scaleMax === 80 ? ratingText(n, display) : (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, ''));
  const switchClaim = ctx.history.sourceSwitch
    ? claim({
      text: plain(ctx.history.sourceSwitch), tone: 'unknown',
      basis: basis({
        because: [{ label: 'What changed', value: plain(ctx.history.sourceSwitch) }],
        source: sourceOf(ctx, 'scouting', 'Rating history'),
        unknown: ["His snapshots from the other source are left out of the chart: a change of source isn't development."],
        wouldChange: [], lean: null, certainty: 'recorded',
      }),
    })
    : null;
  const setAsideBasis = (because: BasisLine[]) => basis({
    because, source: sourceOf(ctx, 'scouting', 'Rating history'),
    unknown: ['Snapshots of another kind of ratings are left out of the chart: a change of kind isn\'t development.'],
    wouldChange: [], lean: null, certainty: 'recorded',
  });
  const setAside = [
    ...ctx.history.modeSwitches.map((text) => claim({
      text: plain(text), tone: 'unknown', basis: setAsideBasis([{ label: 'What changed', value: plain(text) }]),
    })),
    ...(ctx.history.unknownKind
      ? [claim({ text: plain(ctx.history.unknownKind), tone: 'unknown', basis: setAsideBasis([{ label: 'Why', value: plain(ctx.history.unknownKind) }]) })]
      : []),
  ];
  const summary = points.length
    ? `Scouted now and ceiling at each snapshot: ${points.map((p) => `${p.label.display}, ${composite(p.now)} now, ${composite(p.ceiling)} ceiling`).join('; ')}.`
    : 'No rating history for him in this save yet.';
  const aside = ctx.history.setAside > 0;
  const empty = points.length >= 2
    ? null
    : points.length === 1
      ? (aside ? 'One comparable snapshot so far: his others are set aside' : 'One snapshot so far: the history builds with each import')
      : (aside ? 'No comparable rating history yet: his snapshots are set aside' : 'No rating history for him in this save yet');
  return {
    title: cell('Rating history', { hint: historyHint(ctx) }),
    points,
    table: points.length
      ? table('ratingHistory', 'Snapshots', [['date', 'Date', false], ['level', 'Level', false], ['now', 'Now', true], ['ceiling', 'Ceiling', true]],
        rows.map((r, i) => ({
          id: `${i}`,
          cells: { date: dateWords(r.game_date) ?? r.game_date, level: ctx.levelNames[r.level ?? -1] ?? null, now: composite(num(r.cur)), ceiling: composite(num(r.pot)) },
          sort: { date: i, level: r.level, now: num(r.cur), ceiling: num(r.pot) },
        })))
      : null,
    empty: empty ? cell(empty) : null,
    sourceSwitch: switchClaim,
    setAside,
    summary,
  };
}

/** Whose grades the chart draws (review M2): our scouts', OSA's view filling in for him, or the export's kind. */
function historyHint(ctx: DossierInput): string {
  if (ctx.body.ratingsFill) return 'OSA\'s average grades at each import: our scouts haven\'t rated him';
  if (ctx.ratingSource.mode === 'scouted-complete' || ctx.ratingSource.mode === 'scouted') return 'Your scouts\' average grades at each import';
  if (ctx.ratingSource.mode === 'osa') return 'OSA\'s average grades at each import';
  return `${ctx.ratingSource.short}: the average grades at each import`;
}


function ratings(ctx: DossierInput): PlayerRatingsView {
  const d = ctx.body;
  const fill = d.ratingsFill ? cell(d.ratingsFill.mark, { hint: d.ratingsFill.hint }) : null;
  const high = ctx.rating.scaleMax;
  const low = scaleLow(high);
  const groups = ratingGroups(ctx, fill);
  return {
    scale: { low, high, words: cell(scaleWords(low, high)) },
    source: claim({
      text: d.ratingsFill ? d.ratingsFill.hint : ctx.ratingSource.short,
      tone: d.ratingsFill ? 'caution' : 'neutral',
      basis: basis({
        because: lines([['Whose grades', d.ratingsFill ? d.ratingsFill.hint : ctx.ratingSource.text], ['The scale', scaleWords(low, high)]]),
        source: sourceOf(ctx, 'scouting', SCOUTING),
        unknown: d.ratingsFill ? ["Our scouts haven't filed a report on him, so these are OSA's grades, the league's shared scouting service."] : [],
        wouldChange: ['A new scouting report on him.'], lean: null, certainty: 'fact',
      }),
    }),
    ratingsFill: fill,
    velocity: d.velocity ? cell(`Velocity: ${d.velocity}`) : null,
    groups,
    empty: groups.length ? null : cell('No scouting grades for him in this export'),
    history: ratingHistory(ctx),
  };
}

// ── value ───────────────────────────────────────────────────────────────────

type Surplus = NonNullable<DossierInput['surplus']>;

function seasonNotes(ctx: DossierInput, seasons: readonly Surplus['seasons'][number][]): PlayerValueView['seasonNotes'] {
  const unknown: Array<{ season: number; view: string | null; text: string }> = [];
  const open: string[] = [];
  for (const s of seasons) {
    const reasonOf = (v: ViewInput) => afterColon(plain((v.reason ?? 'not established').replace(/^\d{4}: /, '')));
    const c = s.contract.status === 'unknown' ? reasonOf(s.contract) : null;
    const r = s.retention.status === 'unknown' ? reasonOf(s.retention) : null;
    if (c !== null && c === r) unknown.push({ season: s.season, view: null, text: c });
    else {
      if (c !== null) unknown.push({ season: s.season, view: 'contract value', text: c });
      if (r !== null) unknown.push({ season: s.season, view: 'value of keeping him', text: r });
    }
    for (const [name, v] of [['contract value', s.contract], ['value of keeping him', s.retention]] as const) {
      if (v.status === 'known' && v.band && v.band.central === null && v.centrals.length > 0) {
        open.push(`${s.season} (${name}) depends on how the season goes: ${v.centrals.map((x) => `${plain(x.reading)}: ${rangeText(x.low, x.high, signedMoney)}`).join('; ')}.`);
      }
    }
  }
  const grouped: string[] = [];
  let run: { from: number; to: number; view: string | null; text: string } | null = null;
  const flush = () => {
    if (!run) return;
    const view = run.view ? ` (${run.view})` : '';
    grouped.push(`${run.from === run.to ? `${run.from}${view} isn't valued yet` : `${run.from}–${run.to}${view} aren't valued yet`}: ${sentence(run.text)}`);
    run = null;
  };
  for (const u of unknown) {
    if (run !== null && (run as { text: string }).text === u.text && (run as { view: string | null }).view === u.view && u.season === (run as { to: number }).to + 1) (run as { to: number }).to = u.season;
    else {
      flush();
      run = { from: u.season, to: u.season, view: u.view, text: u.text };
    }
  }
  flush();
  const said = [...grouped.map((g) => ({ text: g.split(': ')[0], why: g })), ...open.map((o) => ({ text: o.split(': ')[0], why: o }))];
  const seen = new Set<string>();
  return said.filter((x) => (seen.has(x.why) ? false : (seen.add(x.why), true))).map((x) => claim({
    text: x.text, tone: 'unknown',
    basis: valueBasis(ctx, [{ label: 'Why', value: x.why }], []),
  }));
}

function restsOn(s: Surplus): string[] {
  const out: string[] = [];
  const first = s.seasons[0];
  if (first && first.part === 'rest_of_season' && (first.banked !== null || first.paid !== null)) {
    const banked = first.banked !== null ? `${signedTenths(first.banked)} wins` : null;
    const paid = first.paid !== null ? `${money(first.paid)} of salary` : null;
    out.push(`Already banked in ${first.season}: ${[banked, paid].filter(Boolean).join(' and ')}. That's spent either way, so it isn't counted${first.share !== null ? `; the rest of ${first.season} counts ${Math.round(first.share * 100)}% of his salary` : ''}.`);
  }
  for (const e of s.excluded) {
    if (/^What he has banked/.test(e)) continue;
    const past = /^Control continues past (\d{4})/.exec(e);
    out.push(past ? `Seasons after ${past[1]} aren't counted: the value looks at most seven seasons ahead.` : sentence(plain(e)));
  }
  if (s.price) {
    out.push(`A win costs about ${perWin(s.price.band.central)} on this league's market (could be ${perWin(s.price.band.low)} to ${perWin(s.price.band.high)}), ${s.price.stage === 'measured' ? 'measured from the signings seen across imports' : "read from the contracts in this league's export"}, and the same in every season.`);
  }
  out.push(`Seasons further out count ${Math.round(s.discount.rate * 100)}% less for each year.`);
  if (s.minimum !== null) out.push(`A replacement is a minimum-salary player (${money(s.minimum)}) who adds no wins above replacement.`);
  out.push(s.fortyMan.onFortyMan === true
    ? "Keeping him uses a 40-man spot; that isn't priced here."
    : s.fortyMan.onFortyMan === false
      ? "He isn't on the 40-man, so keeping him uses no 40-man spot now."
      : "Whether he's on the 40-man isn't in the export.");
  return out;
}

function valueTotal(ctx: DossierInput, s: Surplus, id: PlayerValueTotal['id'], total: TotalInput): PlayerValueTotal {
  const unit = id === 'wins' ? 'wins' : 'dollars';
  const fmt = unit === 'wins' ? winsText : signedMoney;
  const pick = (x: SeasonInput) => (id === 'keeping' ? x.retention : x.contract);
  const titles = {
    contract: { title: 'Contract value', hint: "What he's worth beyond what he's paid", tip: TIP_CONTRACT_VALUE, gloss: "What he's worth beyond what he's paid." },
    keeping: { title: 'Value of keeping him', hint: "What you'd give up by letting him go", tip: TIP_KEEPING_HIM, gloss: "What you'd give up by letting him go." },
    wins: { title: 'Wins above replacement', hint: 'His wins over a minimum-salary replacement', tip: TIP_WINS_ONLY, gloss: 'His wins over a minimum-salary replacement, later seasons counting a little less.' },
  }[id];
  const known = total.status === 'known' && total.low !== null && total.high !== null;
  const seasons = s.seasons as unknown as SeasonInput[];
  const held = s.seasons.filter((x) => pick(x as unknown as SeasonInput).ifHeld || x.ifHeld).map((x) => x.season);
  if (known) {
    const head = totalHeadline(total, fmt, seasons, pick);
    const keptLine = total.ifHeld && held.length ? ` · ${listSeasons(held)} if kept` : '';
    return {
      id, title: cell(titles.title, { hint: titles.hint }),
      headline: claim({
        text: head.text, tone: 'neutral',
        value: total.central !== null
          ? servedValue(total.central, unit, fmt(total.central), { low: total.low!, high: total.high! })
          : unknownValue(unit, rangeText(total.low!, total.high!, fmt)),
        basis: valueBasis(ctx, lines([
          ['What it is', titles.tip], ['The range', TIP_COULD_BE], ['No single figure', head.mostLikely ? null : TIP_NO_SINGLE],
          ['If kept', keptLine ? TIP_IF_KEPT : null], ['Seasons', seasonsText(total.from, total.to)],
        ]), [], held.length ? [`Whether he is kept in ${listSeasons(held)}.`] : []),
      }),
      couldBe: head.couldBe ? cell(`${head.couldBe}${keptLine}`, { hint: 'A range of outcomes, not a forecast' }) : null,
      established: null,
      gloss: cell(titles.gloss),
      known: true,
    };
  }
  const line = notValuedLine(s.status, seasons, total);
  const e = total.established;
  return {
    id, title: cell(titles.title, { hint: titles.hint }),
    headline: claim({
      text: line, tone: 'unknown', value: unknownValue(unit, 'Not valued yet'),
      basis: valueBasis(ctx, lines([['What it is', titles.tip]]), [total.reason ?? 'Not established.']),
    }),
    couldBe: null,
    established: e
      ? cell(`The known seasons (${e.from === e.to ? `${e.from} only` : `${e.from}–${e.to}`}): ${e.central !== null ? `most likely ${fmt(e.central)}` : e.centralRange ? rangeText(e.centralRange.low, e.centralRange.high, fmt) : ''}, could be ${rangeText(e.low, e.high, fmt)}. Not a total over his control.`)
      : null,
    gloss: cell(titles.gloss),
    known: false,
  };
}

function ourViewBlock(ctx: DossierInput, unit: 'dollars' | 'wins'): PlayerOurView | null {
  const v = ctx.ourView;
  if (!v) return null;
  const whose = ctx.orgName ?? 'This organization';
  const fmt = unit === 'dollars' ? signedMoney : winsText;
  const lensText = (f: { low: number; central: number | null; high: number; centralRange: { low: number; high: number } | null } | null) => {
    if (!f) return 'not valued';
    if (f.central !== null) return fmt(f.central);
    if (f.centralRange) return rangeText(f.centralRange.low, f.centralRange.high, fmt);
    return rangeText(f.low, f.high, fmt);
  };
  const figure = (label: string, t: typeof v.contract) => (t.status !== 'known' ? `${label}: not valued yet` : `${label}: ${lensText(t.ours)} (neutral ${lensText(t.neutral)})`);
  const amount = (d: { low: number; high: number } | null): string =>
    (d === null || (Math.abs(d.low) < 500 && Math.abs(d.high) < 500 && unit === 'dollars') ? '' : ` (${d.low === d.high ? `${d.low > 0 ? '+' : ''}${fmt(d.low)}` : `${fmt(d.low)} to ${fmt(d.high)}`})`);
  const nothing = v.status === 'not_held' || (v.contract.status !== 'known' && v.retention.status !== 'known' && v.wins.status !== 'known');
  const leanClaim = (l: (typeof v.leans)[number]) => claim({
    text: `${capitalized(plain(l.short))}${amount(unit === 'dollars' ? l.by.contract : l.by.wins)}`, tone: 'neutral',
    basis: basis({
      because: [{ label: 'The lean', value: plain(l.text) }, { label: 'Setting', value: `${l.label}: ${String(l.value)}` }],
      source: sourceOf(ctx, 'philosophy', 'Organizational philosophy'),
      unknown: [], wouldChange: ['A change to the club\'s philosophy settings.'],
      lean: { neutral: 'The figures above, which no philosophy changes.', why: [plain(l.text)] },
      certainty: 'policy', stamp: 'The club\'s philosophy settings',
    }),
  });
  return {
    title: cell(`Our view · ${whose}`, { hint: 'The same figures read through our philosophy' }),
    figures: nothing ? [] : unit === 'dollars'
      ? [cell(figure('Contract value', v.contract)), cell(figure('Keeping him', v.retention))]
      : [cell(figure('Wins above replacement', v.wins))],
    leans: nothing || !v.leaning ? [] : [...v.leans, ...v.notes].map(leanClaim),
    line: nothing
      ? cell('Not valued yet, so the philosophy has nothing to lean on')
      : v.leaning ? cell(TIP_OUR_VIEW.split(':')[0], { hint: 'It never changes the figures above' })
        : cell(`${ctx.orgName ? `The ${ctx.orgName}${ctx.orgName.endsWith('s') ? "'" : "'s"}` : "This organization's"} philosophy doesn't lean on him: our view is the same as above`),
  };
}

function cone(ctx: DossierInput): PlayerConeView {
  const c = ctx.cone;
  const title = cell('Expected production', { hint: 'Wins above replacement each season, with two ranges' });
  if (!c || c.status !== 'projected' || c.seasons.length === 0) {
    const reason = c?.reason ?? 'Player Value states no projection for him.';
    return {
      title, established: false,
      empty: claim({
        text: 'Expected production not yet established', tone: 'unknown',
        basis: valueBasis(ctx, [{ label: 'From', value: PLAYER_VALUE }], [reason]),
      }),
      seasons: [], legend: { outer: cell('80% range'), inner: cell('50% range'), expected: cell('Expected wins'), replacement: cell('Replacement level') },
      pending: null,
      axis: { low: -1, high: 1 }, checked: null, notes: [], summary: `Expected production not yet established: ${plain(reason)}`,
    };
  }
  const checked = c.calibration.calibrated;
  const words = coneRangeWords(checked);
  const ageOf = (age: number) => `age ${age}`;
  const known: PlayerConeSeason[] = c.seasons.map((s) => {
    const cost = s.control.costDetail !== undefined ? coneCostText(s.control) : null;
    return {
      season: s.season,
      label: cell(String(s.season), { hint: `${ageOf(s.age)} · ${s.control.label}` }),
      established: true,
      expected: s.central,
      outer: { low: s.outer.low, high: s.outer.high },
      inner: { low: s.inner.low, high: s.inner.high },
      banked: s.toDate,
      control: cell(s.control.label),
      cost: cost ? cell(cost) : null,
      detail: claim({
        text: `${s.season}: ${winsText(s.central)} expected (${rangeText(s.inner.low, s.inner.high, signedTenths)} half the time)`,
        tone: 'neutral',
        value: servedValue(s.central, 'wins', winsText(s.central), { low: s.outer.low, high: s.outer.high }),
        basis: valueBasis(ctx, lines([
          ['Season', `${s.season} · ${ageOf(s.age)} · ${s.control.label}${s.control.after ? ` · ${s.control.after.label.toLowerCase()}` : ''}`],
          ['Expected', winsText(s.central)],
          [words.outer, `${rangeText(s.outer.low, s.outer.high, signedTenths)} (${heldText(s.coverage.outer.target, s.coverage.outer.observed)})`],
          [words.inner, `${rangeText(s.inner.low, s.inner.high, signedTenths)} (${heldText(s.coverage.inner.target, s.coverage.inner.observed)})`],
          ['Banked', s.toDate !== null ? `${signedTenths(s.toDate)} so far this season` : null],
          ['Playing time', s.usage.length ? s.usage.map(usageText).join('; ') : null],
          ['Cost', cost], ['Control', plain(s.control.detail || s.control.label)],
          ['Rests on', c.basis ? plain(c.basis) : null],
        ]), [...(s.coverage.cases === null ? [s.coverage.note] : []), ...s.notes]),
      }),
    };
  });
  const pending: PlayerConeSeason[] = (c.notEstablished ?? []).map((s) => {
    const cost = s.control.costDetail !== undefined ? coneCostText(s.control) : null;
    return {
      season: s.season,
      label: cell(String(s.season), { hint: `${ageOf(s.age)} · ${s.control.label}` }),
      established: false, expected: null, outer: null, inner: null, banked: null,
      control: cell(s.control.label),
      cost: cost ? cell(cost) : null,
      detail: claim({
        text: `${s.season}: production not established`, tone: 'unknown', value: unknownValue('wins', 'Not established'),
        basis: valueBasis(ctx, lines([['Season', `${s.season} · ${ageOf(s.age)} · ${s.control.label}`], ['Cost', cost], ['Control', plain(s.control.detail || s.control.label)]]), [s.reason]),
      }),
    };
  });
  const all = [...known, ...pending];
  const lows = c.seasons.map((s) => s.outer.low);
  const highs = c.seasons.map((s) => s.outer.high);
  const summarized = [
    ...c.seasons.map((x) => `${x.season}, ${x.control.label.toLowerCase()}: ${signedTenths(x.central)} wins expected; 80% range ${rangeText(x.outer.low, x.outer.high, signedTenths)}, 50% range ${rangeText(x.inner.low, x.inner.high, signedTenths)}`),
    ...(c.notEstablished ?? []).map((x) => `${x.season}, ${x.control.label.toLowerCase()}: expected production not established`),
  ];
  return {
    title, established: true, empty: null, seasons: all,
    legend: {
      outer: cell(words.outer, { hint: 'Meant to hold 8 seasons in 10' }), inner: cell(words.inner, { hint: 'Meant to hold 5 seasons in 10' }),
      expected: cell('Expected wins'), replacement: cell('Replacement level', { hint: 'A minimum-salary player adds no wins above it' }),
    },
    pending: pending.length ? cell('Production not established', { hint: 'No range is drawn: those seasons are not projected yet' }) : null,
    axis: { low: Math.min(0, ...lows), high: Math.max(0, ...highs) },
    checked: claim({
      text: checked ? "Checked against this save's own seasons" : "Not yet checked against this save's own seasons",
      tone: checked ? 'neutral' : 'caution',
      basis: valueBasis(ctx, lines([['The ranges', words.tip], ['How it is fitted', plain(c.calibration.status)], ['Detail', c.calibration.detail ? plain(c.calibration.detail) : null]])),
    }),
    notes: [...(c.control.note ? [cell(plain(c.control.note))] : [])],
    summary: `Expected wins above replacement per season. ${summarized.join('. ')}.`,
  };
}

function valueView(ctx: DossierInput): PlayerValueView {
  const s = ctx.surplus;
  const coneView = cone(ctx);
  if (!s) {
    return {
      status: 'unknown',
      note: claim({ text: 'Not valued yet', tone: 'unknown', basis: valueBasis(ctx, [{ label: 'From', value: PLAYER_VALUE }], ['Player Value has no valuation of him in this export.']) }),
      totals: [], ourView: null, cone: coneView, breakdown: null, seasonNotes: [], restsOn: [],
    };
  }
  if (s.status === 'not_held') {
    return {
      status: 'not_held',
      note: claim({ text: plain(s.reason ?? 'No club holds his contract, so it has no contract value.'), tone: 'neutral', basis: valueBasis(ctx, [{ label: 'Why', value: plain(s.reason ?? 'No club holds him.') }]) }),
      totals: [], ourView: null, cone: coneView, breakdown: null, seasonNotes: [], restsOn: [],
    };
  }
  const winsOnly = s.status === 'wins_only';
  const totals = winsOnly ? [valueTotal(ctx, s, 'wins', s.wins)] : [valueTotal(ctx, s, 'contract', s.contract), valueTotal(ctx, s, 'keeping', s.retention)];
  const cellOf = (v: ViewInput): string => {
    if (v.status !== 'known' || !v.band) return 'not known';
    const f = v.band;
    const body = f.low === f.high ? signedMoney(f.low) : f.central === null ? rangeText(f.low, f.high, signedMoney) : `${signedMoney(f.central)} (${rangeText(f.low, f.high, signedMoney)})`;
    return `${body}${v.ifHeld ? ' if kept' : ''}`;
  };
  const costOf = (f: { low: number; central: number | null; high: number } | null): string => {
    if (!f) return 'not known';
    if (f.low === f.high) return money(f.low);
    return f.central === null ? rangeText(f.low, f.high, money) : `${money(f.central)} (${rangeText(f.low, f.high, money)})`;
  };
  const breakdown = s.seasons.length
    ? table('valueSeasons', 'Season by season', [
      ['season', 'Season', false], ['wins', 'Wins', true], ['price', 'Price of a win', true], ['cost', 'Cost', true],
      ['counts', 'Counts', true], ['contract', 'Contract value', true], ['keeping', 'Keeping him', true],
    ], s.seasons.map((x) => ({
      id: String(x.season),
      cells: {
        season: `${x.season}${x.part === 'rest_of_season' ? ` (rest of season${x.share !== null ? `, ${Math.round(x.share * 100)}%` : ''})` : ''}`,
        wins: x.wins ? `${signedTenths(x.wins.central)} (${rangeText(x.wins.low, x.wins.high, signedTenths)})` : 'not established',
        price: x.price?.central !== null && x.price?.central !== undefined ? perWin(x.price.central) : 'not known',
        cost: `${costOf(x.cost)}${x.ifHeld ? ' if kept' : ''}`,
        counts: `${Math.round(x.weight * 100)}%`,
        contract: winsOnly ? 'not known' : cellOf(x.contract),
        keeping: winsOnly ? 'not known' : cellOf(x.retention),
      },
      sort: {
        season: x.season, wins: x.wins?.central ?? null, price: x.price?.central ?? null, cost: x.cost?.central ?? x.cost?.low ?? null,
        counts: x.weight, contract: x.contract.band?.central ?? null, keeping: x.retention.band?.central ?? null,
      },
    })), { hint: 'Each season: his wins, their price, his cost and what is left' })
    : null;
  return {
    status: s.status,
    note: s.status === 'unknown' ? claim({ text: "Not valued yet: his production isn't established", tone: 'unknown', basis: valueBasis(ctx, [{ label: 'From', value: PLAYER_VALUE }], [s.reason ?? 'Not established.']) }) : null,
    totals,
    ourView: ourViewBlock(ctx, winsOnly ? 'wins' : 'dollars'),
    cone: coneView,
    breakdown,
    // In a league valued in wins only, the dollar views are not known for any season; the wins total says what is
    seasonNotes: winsOnly ? [] : seasonNotes(ctx, s.seasons),
    restsOn: restsOn(s).map((t) => cell(t)),
  };
}

// ── contract & rights ───────────────────────────────────────────────────────

function contractView(ctx: DossierInput): PlayerContractView {
  const d = ctx.body;
  const c = d.header.contract;
  const facts: PlayerFact[] = [];
  if (c && c.standing !== 'unsigned') {
    const salary = salaryLine(c);
    facts.push({ label: cell('This season'), value: cell(salary.text, salary.why ? { tone: 'unknown' } : {}), claim: salary.why ? claim({ text: salary.text, tone: 'unknown', basis: factBasis(ctx, [{ label: 'This season', value: salary.text }], [salary.why], 'finance', PLAYER_VALUE) }) : null });
    const term = termLine(c);
    if (term) facts.push(fact('Term', term));
    const after = afterLine(c);
    if (after) {
      facts.push({
        label: cell('After this season'), value: cell(after.text),
        claim: after.why ? claim({ text: after.text, tone: 'neutral', basis: factBasis(ctx, [{ label: 'Why', value: plain(after.why) }], [], 'finance', PLAYER_VALUE) }) : null,
      });
    }
    const end = controlEndWords(c.controlEnd);
    if (!after || !after.text.includes(end.text)) facts.push(fact('Control ends', end.text, end.known ? {} : { tone: 'unknown' }));
    if (c.clauses.length) facts.push(fact('Clauses', c.clauses.join(' · ')));
    if ((c.clauseNotes ?? []).length) {
      facts.push({ label: cell('Other terms'), value: cell('Some not in the export', { tone: 'unknown' }), claim: claim({ text: 'Some terms not in the export', tone: 'unknown', basis: factBasis(ctx, [{ label: 'Read from', value: 'The imported export' }], c.clauseNotes ?? [], 'finance', PLAYER_VALUE) }) });
    }
  }
  if (d.contract?.noTrade) facts.push(fact('No-trade clause', 'Yes'));
  const schedule = d.contract && d.contract.salarySchedule.length
    ? table('salarySchedule', 'Seasons covered', [['year', 'Season', false], ['salary', 'Salary', true], ['terms', 'Terms', false]],
      d.contract.salarySchedule.map((sch) => ({
        id: String(sch.year),
        cells: {
          year: String(sch.year),
          salary: sch.salary === null ? 'not in the export' : money(sch.salary),
          terms: [sch.extension ? 'extension' : null, sch.option ? `${sch.option} option` : null].filter(Boolean).join(' · ') || null,
        },
        sort: { year: sch.year, salary: sch.salary, terms: null },
      })))
    : null;
  const rights = relevantRights(ctx);
  const option = optionYearsFact(ctx);
  const rightsFacts: PlayerFact[] = option ? [option] : [];
  return {
    facts,
    schedule,
    empty: facts.length || schedule ? null : cell(c?.standing === 'unsigned' ? 'No club holds his contract' : 'No contract terms in the export'),
    rightsNote: rights.note ? cell(rights.note, { tone: 'unknown' }) : null,
    rights: rights.actions,
    rightsFacts,
  };
}

// ── history ─────────────────────────────────────────────────────────────────

function historyNow(ctx: DossierInput): PlayerFact[] {
  const st = ctx.state;
  if (!st) return [fact('Where he is', 'Not in the export', { tone: 'unknown' })];
  const yesNo = (v: { value: boolean | null }, yes: string, no: string) => (v.value === null ? 'Not in the export' : v.value ? yes : no);
  const out = [
    fact('Club', ctx.body.team ?? 'No club'),
    fact('Active roster', yesNo(st.activeRoster, 'On it', 'Not on it')),
    fact('40-man roster', yesNo(st.fortyMan, 'On it', 'Not on it')),
    fact('Injured list', st.injuredList.onIl.value === null ? 'Not in the export' : st.injuredList.onIl.value ? (st.injuredList.onIl60.value ? 'On the 60-day list' : 'On it') : 'Not on it'),
  ];
  if (st.dfa.designated.value) out.push(fact('Designated', st.dfa.daysLeft.value !== null ? `Yes · ${plural(st.dfa.daysLeft.value, 'day')} left` : 'Yes'));
  return out;
}

function historyLog(ctx: DossierInput): PlayerLogEntry[] {
  return (ctx.chronology ?? []).slice(0, 25).map((e) => ({
    id: e.id,
    date: cell(e.date ? gameDateWords(e.date) : e.rawDate || 'Date not known'),
    line: claim({
      text: e.text.trim() || 'A line the log holds without words',
      tone: 'neutral',
      basis: basis({
        because: lines([['The log says', e.text], ['On', e.date ? gameDateWords(e.date) : e.rawDate]]),
        source: sourceOf(ctx, 'league', 'OOTP transaction log'),
        unknown: e.supported ? [] : ['Pennant does not read this wording, so it draws no conclusion from it.'],
        wouldChange: [], lean: null, certainty: 'fact',
      }),
    }),
  }));
}

function statTables(ctx: DossierInput): PlayerTable[] {
  const d = ctx.body;
  const out: PlayerTable[] = [];
  const battingYears = (d.battingYears ?? []) as Array<Record<string, unknown>>;
  const pitchingYears = (d.pitchingYears ?? []) as Array<Record<string, unknown>>;
  const showBatting = !d.isPitcher || battingYears.length > 0;
  if (showBatting && battingYears.length) {
    out.push(table('batting', 'Batting', [
      ['year', 'Year', false], ['team', 'Team', false], ['level', 'Level', false], ['pa', 'PA', true], ['hr', 'HR', true], ['rbi', 'RBI', true],
      ['sb', 'SB', true], ['avg', 'AVG', true], ['obp', 'OBP', true], ['slg', 'SLG', true], ['war', 'WAR', true],
    ], battingYears.map((y, i) => ({
      id: `b${i}`,
      cells: {
        year: str(y.year), team: str(y.team), level: str(y.levelName), pa: str(y.pa), hr: str(y.hr), rbi: str(y.rbi), sb: str(y.sb),
        avg: rate3(num(y.avg)), obp: rate3(num(y.obp)), slg: rate3(num(y.slg)), war: num(y.war) === null ? null : signedTenths(num(y.war)!),
      },
      sort: { year: num(y.year), team: str(y.team), level: str(y.levelName), pa: num(y.pa), hr: num(y.hr), rbi: num(y.rbi), sb: num(y.sb), avg: num(y.avg), obp: num(y.obp), slg: num(y.slg), war: num(y.war) },
    }))));
  }
  if (pitchingYears.length) {
    out.push(table('pitching', 'Pitching', [
      ['year', 'Year', false], ['team', 'Team', false], ['level', 'Level', false], ['g', 'G', true], ['gs', 'GS', true], ['wl', 'W-L', true],
      ['sv', 'SV', true], ['ip', 'IP', true], ['era', 'ERA', true], ['whip', 'WHIP', true], ['k', 'K', true], ['bb', 'BB', true], ['war', 'WAR', true],
    ], pitchingYears.map((y, i) => ({
      id: `p${i}`,
      cells: {
        year: str(y.year), team: str(y.team), level: str(y.levelName), g: str(y.g), gs: str(y.gs), wl: `${num(y.w) ?? '—'}-${num(y.l) ?? '—'}`,
        sv: str(y.sv), ip: num(y.ip) === null ? null : num(y.ip)!.toFixed(1), era: num(y.era) === null ? null : num(y.era)!.toFixed(2),
        whip: num(y.whip) === null ? null : num(y.whip)!.toFixed(2), k: str(y.k), bb: str(y.bb), war: num(y.war) === null ? null : signedTenths(num(y.war)!),
      },
      sort: { year: num(y.year), team: str(y.team), level: str(y.levelName), g: num(y.g), gs: num(y.gs), wl: num(y.w), sv: num(y.sv), ip: num(y.ip), era: num(y.era), whip: num(y.whip), k: num(y.k), bb: num(y.bb), war: num(y.war) },
    }))));
  }
  const fielding = d.fieldingYears ?? [];
  if (fielding.length) {
    out.push(table('fielding', 'Fielding', [
      ['year', 'Year', false], ['level', 'Level', false], ['pos', 'Pos', false], ['g', 'G', true], ['inn', 'Inn', true], ['po', 'PO', true],
      ['a', 'A', true], ['e', 'E', true], ['dp', 'DP', true], ['fpct', 'FPCT', true], ['rf9', 'RF/9', true],
    ], fielding.slice(0, 14).map((f, i) => ({
      id: `f${i}`,
      cells: {
        year: str(f.year), level: str(f.levelName), pos: str(f.positionName), g: str(f.g), inn: String(Math.round(f.innings)), po: str(f.po),
        a: str(f.a), e: str(f.e), dp: str(f.dp), fpct: rate3(f.fpct), rf9: f.rf9 === null ? null : f.rf9.toFixed(2),
      },
      sort: { year: f.year, level: str(f.levelName), pos: str(f.positionName), g: f.g, inn: f.innings, po: f.po, a: f.a, e: f.e, dp: f.dp, fpct: f.fpct, rf9: f.rf9 },
    })), { note: fielding.length > 14 ? 'His 14 most recent lines' : undefined }));
  }
  const games = (d.gameLogs ?? []) as Array<Record<string, unknown>>;
  if (games.length && !d.isPitcher) {
    out.push(table('games', `Last ${plural(games.length, 'game')}`, [
      ['date', 'Date', false], ['opp', 'Opp', false], ['ab', 'AB', true], ['h', 'H', true], ['hr', 'HR', true], ['rbi', 'RBI', true],
      ['bb', 'BB', true], ['k', 'K', true], ['sb', 'SB', true],
    ], games.map((g, i) => ({
      id: `g${i}`,
      cells: { date: dateWords(str(g.date)) ?? str(g.date), opp: str(g.opp), ab: str(g.ab), h: str(g.h), hr: str(g.hr), rbi: str(g.rbi), bb: str(g.bb), k: str(g.k), sb: str(g.sb) },
      sort: { date: i, opp: str(g.opp), ab: num(g.ab), h: num(g.h), hr: num(g.hr), rbi: num(g.rbi), bb: num(g.bb), k: num(g.k), sb: num(g.sb) },
    }))));
  }
  const outings = (d.pitchingGameLogs ?? []) as Array<Record<string, unknown>>;
  if (outings.length) {
    out.push(table('outings', 'Recent outings', [
      ['date', 'Date', false], ['opp', 'Opp', false], ['gs', 'GS', true], ['ip', 'IP', true], ['er', 'ER', true], ['h', 'H', true], ['bb', 'BB', true], ['k', 'K', true],
    ], outings.map((g, i) => ({
      id: `o${i}`,
      cells: { date: dateWords(str(g.date)) ?? str(g.date), opp: str(g.opp), gs: str(g.gs), ip: str(g.ip), er: str(g.er), h: str(g.ha), bb: str(g.bb), k: str(g.k) },
      sort: { date: i, opp: str(g.opp), gs: num(g.gs), ip: num(g.ip), er: num(g.er), h: num(g.ha), bb: num(g.bb), k: num(g.k) },
    }))));
  }
  const injuries = d.injuryHistory ?? [];
  if (injuries.length) {
    out.push(table('injuries', 'Injury history', [['date', 'Date', false], ['missed', 'Missed', true], ['kind', 'Kind', false]],
      (injuries as Array<Record<string, unknown>>).map((h, i) => ({
        id: `i${i}`,
        cells: { date: dateWords(str(h.date)) ?? str(h.date), missed: num(h.length) ? plural(num(h.length)!, 'day') : null, kind: h.day_to_day === 1 ? 'Day-to-day' : 'Injured list' },
        sort: { date: i, missed: num(h.length), kind: h.day_to_day === 1 ? 'Day-to-day' : 'Injured list' },
      }))));
  }
  const honours = honoursRows(d);
  if (honours.length) {
    out.push(table('honours', 'Honours', [['award', 'Award', false], ['times', 'Times', true], ['years', 'Seasons', false]],
      honours.map((h, i) => ({ id: `h${i}`, cells: { award: h.label, times: String(h.years.length), years: h.years.join(', ') }, sort: { award: h.rank, times: h.years.length, years: h.years[0] ?? null } }))));
  }
  const leader = d.leagueLeader ?? [];
  if (leader.length) {
    out.push(table('leader', 'Led the league', [['year', 'Year', false], ['place', 'Place', true], ['category', 'Category', false], ['amount', 'Figure', true]],
      leader.slice(0, 12).map((l, i) => ({
        id: `l${i}`,
        cells: { year: str(l.year), place: ordinal(l.place), category: str(l.category), amount: str(l.amount) },
        sort: { year: num(l.year), place: num(l.place), category: str(l.category), amount: num(l.amount) },
      }))));
  }
  const splits = d.splits ?? [];
  if (splits.length > 1) {
    out.push(table('splits', 'Situational', [['situation', 'Situation', false], ['pa', 'PA', true], ['avg', 'AVG', true], ['ops', 'OPS', true]],
      splits.map((s, i) => ({ id: `s${i}`, cells: { situation: s.label === 'Overall' ? 'All situations' : s.label, pa: str(s.pa), avg: rate3(s.ba), ops: rate3(s.ops) }, sort: { situation: i, pa: s.pa, avg: s.ba, ops: s.ops } })),
      { hint: 'Single-season splits are small samples', note: TIP_SPLITS }));
  }
  return out;
}

function contact(ctx: DossierInput): PlayerContactView | null {
  const c = ctx.body.contact;
  if (!c || (c.battedBalls ?? 0) <= 0) return null;
  const lg = ctx.body.contactLeague;
  const figure = (label: string, value: number | null, unit: string, league?: number | null): PlayerFact => ({
    label: cell(label),
    value: cell(value === null ? 'Not measured' : `${value}${unit}`, { ...(value === null ? { tone: 'unknown' as Tone } : {}), ...(league !== undefined && league !== null ? { hint: `League: ${league}${unit}` } : {}) }),
    claim: null,
  });
  const luck = c.slgLuck;
  const reading = luck !== null && luck !== undefined && c.slg !== null && c.xslg !== null
    ? claim({
      text: `Slugging ${rate3(c.slg)} against ${rate3(c.xslg)} expected from his contact${luck <= -0.06 ? ': he has hit the ball better than the results show' : luck >= 0.06 ? ': the results have outrun the contact' : ': his results match his contact'}`,
      tone: luck <= -0.06 ? 'good' : luck >= 0.06 ? 'caution' : 'neutral',
      basis: factBasis(ctx, lines([['What it is', TIP_CONTACT], ['Batted balls', String(c.battedBalls)], ['The line', 'A gap of 0.060 or more either way is said; less reads as matching.']]), [], 'league', 'Batted balls'),
    })
    : null;
  return {
    title: claim({ text: 'Contact quality', tone: 'neutral', basis: factBasis(ctx, [{ label: 'What it is', value: TIP_CONTACT }], [], 'league', 'Batted balls') }),
    figures: [
      figure('Average exit velocity', c.avgExitVelo, ' mph', lg?.avgExitVelo),
      figure('Hardest hit', c.maxExitVelo, ' mph'),
      figure('Hard-hit', c.hardHitPct, '%', lg?.hardHitPct),
      figure('Barrels', c.barrelPct, '%', lg?.barrelPct),
      figure('Sweet spot', c.sweetSpotPct, '%'),
      figure('Sprint speed', c.sprintSpeed, '', lg?.sprintSpeed),
    ],
    line: cell(`Ground balls ${c.gbPct ?? '—'}% · line drives ${c.ldPct ?? '—'}% · fly balls ${c.fbPct ?? '—'}% · ${plural(c.battedBalls, 'batted ball')}`),
    reading,
  };
}

function historyView(ctx: DossierInput): PlayerHistoryView {
  const tables = statTables(ctx);
  return {
    now: historyNow(ctx),
    nowSource: cell('Where he is now, as the export states it', { hint: 'The export outranks the log about where he is now' }),
    log: historyLog(ctx),
    logNote: ctx.chronology === null
      ? cell(plain(ctx.chronologyNote ?? 'The OOTP transaction log is unavailable, so no transaction history is shown.'), { tone: 'unknown' })
      : ctx.chronologyNote ? cell(plain(ctx.chronologyNote), { tone: 'caution' })
        : (ctx.chronology.length ? null : cell('The transaction log has no lines about him this season')),
    tables,
    tablesEmpty: tables.length ? null : cell('No record of him in the export yet'),
    contact: contact(ctx),
  };
}

// ── the dossier ─────────────────────────────────────────────────────────────

export function dossierView(ctx: DossierInput): PlayerDossierView {
  return {
    playerId: ctx.playerId,
    orgId: ctx.orgId,
    importStamp: ctx.importStamp,
    reportStamp: ctx.reportStamp,
    name: ctx.body.name,
    open: target({ kind: 'player', playerId: ctx.playerId, teamId: ctx.state?.organizationId.value ?? null }),
    header: header(ctx),
    overview: overview(ctx),
    ratings: ratings(ctx),
    value: valueView(ctx),
    contract: contractView(ctx),
    history: historyView(ctx),
  };
}
