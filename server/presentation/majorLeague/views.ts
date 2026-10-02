/**
 * Major League Ops' standing views, worded from the overview the department answered (`mlbOverview`): the report's
 * companion (the staff at a glance, the what-if, the open needs), Position players, Pitching staff and Bench & Backups.
 * The React pages' client-side words (`src/pages/mlb/`) moved here (D-056). Nothing is re-derived: every row is a
 * player the specialist read, in its own order, with the finding it served; an unknown is a sentence and sorts last.
 */
import type { Cell, Tone } from '../../contract/presentation.js';
import type { MlbNeed } from '../../mlbNeeds.js';
import type { RoleGroupReview } from '../../mlbReview.js';
import { ratingFillOf } from '../../scoutedEvidence.js';
import { basis, cell, claim } from '../claim.js';
import { sourceOf } from '../frontOffice/desk.js';
import {
  action, block, because, column, decision, head, line, linesOf, numberCell, player, REVIEW, reviewClaim, tableRow, view, type OverviewContext,
} from './common.js';
import type {
  MlbBenchFunction, MlbBenchView, MlbBlock, MlbGlance, MlbLine, MlbNeedEntry, MlbNeedGroup, MlbOverviewView, MlbPitchingStaffView,
  MlbPositionPlayersView, MlbRow, MlbStaffSection, MlbTable,
} from './types.js';
import {
  chip, codeWords, FINDING_TEXT, FUNCTION_STRENGTH, FUNCTION_TONE, SOFT_FUNCTION_STRENGTH, hintIf, horizonText, KIND_LABEL, labelOf, needBadge, rankOf, FINDING_ORDER, PLATOON_ORDER, TIER_ORDER, betterThan, onScale, scaleNumber, SCALE_HINT, PEN_HEADING,
  PLATOON_BASIS, platoonChip, platoonHeadline, positionAbbr, QUALITY_TEXT, QUALITY_TONE, REQUIRED_COVERS, sentences, share, signed,
  STRENGTH_TONE, TAG_TEXT, TIER_TEXT,
} from './words.js';

type Holder = RoleGroupReview['holders'][number];

const lineupGroup = (v: OverviewContext) => v.overview.review.find((g) => g.role === 'lineup regular');
const rotationGroup = (v: OverviewContext) => v.overview.review.find((g) => g.kind === 'starting_pitcher');
const penGroup = (v: OverviewContext) => v.overview.review.find((g) => g.kind === 'relief_pitcher');
const benchReview = (v: OverviewContext) => v.overview.review.find((g) => g.bench)?.bench;

/** A case worth a look: the strong and moderate ones (the ones that become needs). */
const flagged = (holders: ReadonlyArray<{ strength: string }> | undefined): number =>
  (holders ?? []).filter((h) => h.strength === 'strong' || h.strength === 'moderate').length;

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// ── the report's companion ───────────────────────────────────────────────────

const STATE_KINDS = new Set(['il_return_crunch', 'role_below_standard', 'open_active_spot']);

/** The need's philosophy-free severity: the department states it beside the shaded one. */
const neutralSeverity = (n: MlbNeed): string => n.explanation?.neutralSeverity ?? n.severity;

function needEntry(n: MlbNeed): MlbNeedEntry {
  const first = (n.summary.split(/(?<=[.!?])\s/)[0] ?? n.summary).trim() || n.title;
  const kind = `${labelOf(KIND_LABEL, n.kind)}${n.role && n.kind !== 'role_below_standard' ? ` · ${n.role.label}` : ''}`;
  return {
    needId: n.id,
    badge: needBadge(n, neutralSeverity(n)),
    kind: cell(kind),
    title: cell(n.title.trim() || kind),
    summary: cell(first.length > 190 ? `${first.slice(0, 187).trimEnd()}…` : first),
    open: decision(n.id),
  };
}

/** The open needs as the department groups them: the roster first, then the strongest cases, then the rest. */
export function inbox(needs: readonly MlbNeed[]): MlbNeedGroup[] {
  const state = needs.filter((n) => STATE_KINDS.has(n.kind));
  const strong = needs.filter((n) => n.kind === 'role_holder_review' && n.review?.strength === 'strong');
  const rest = needs.filter((n) => !state.includes(n) && !strong.includes(n));
  const groups: MlbNeedGroup[] = [];
  if (state.length) groups.push({ title: cell('Roster'), collapsed: false, needs: state.map(needEntry) });
  if (strong.length) groups.push({ title: cell('Scouting review: the strongest cases'), collapsed: false, needs: strong.map(needEntry) });
  if (rest.length) {
    groups.push({
      title: cell(`Also worth a look (${rest.length})`, { hint: 'Moderate cases, platoon flags and bench backups' }),
      collapsed: !(rest.length <= 3 && state.length + strong.length === 0),
      needs: rest.map(needEntry),
    });
  }
  return groups;
}

function glances(v: OverviewContext): MlbGlance[] {
  const needs = v.overview.needs;
  const lineup = lineupGroup(v);
  const rotation = rotationGroup(v);
  const pen = penGroup(v);
  const bench = benchReview(v);
  const platoons = needs.filter((n) => n.kind === 'platoon_complement').length;
  const unsettled = lineup?.lineup ? [...lineup.lineup.spots, lineup.lineup.dh].filter((s) => !s.settled).map((s) => positionAbbr(s.position)) : [];
  const notes = (pen?.deployment?.length ?? 0) + (pen?.pen?.length ?? 0);
  const out: MlbGlance[] = [];
  out.push({
    title: cell('Position players'),
    count: lineup ? flagged(lineup.holders) : null,
    countLabel: lineup ? cell(plural(flagged(lineup.holders), 'regular flagged', 'regulars flagged')) : null,
    lines: lineup
      ? [
        cell(`${plural(lineup.holders.length, 'regular')} reviewed · ${flagged(lineup.holders)} flagged`),
        cell(platoons > 0 ? plural(platoons, 'platoon flag') : 'No platoon problems'),
        cell(unsettled.length ? `Unsettled: ${unsettled.join(', ')}` : 'Every position has a regular'),
      ]
      : [cell('No lineup usage yet', { tone: 'unknown' })],
    open: view('positionPlayers'),
  });
  out.push({
    title: cell('Pitching staff'),
    count: rotation || pen ? flagged(rotation?.holders) + flagged(pen?.holders) + notes : null,
    countLabel: rotation || pen
      ? cell(plural(flagged(rotation?.holders) + flagged(pen?.holders) + notes, 'arm flagged or note on the pen', 'arms flagged and notes on the pen'))
      : null,
    lines: [
      cell(`${plural(rotation?.holders.length ?? 0, 'starter')} · ${flagged(rotation?.holders)} flagged`),
      cell(`${plural(pen?.holders.length ?? 0, 'reliever')} · ${flagged(pen?.holders)} flagged`),
      cell(notes > 0 ? plural(notes, 'note on how the pen is used', 'notes on how the pen is used') : 'No notes on how the pen is used'),
    ],
    open: view('pitchingStaff'),
  });
  const missing = bench?.functions.filter((f) => f.strength === 'none' && !(REQUIRED_COVERS as readonly string[]).includes(f.key)) ?? [];
  out.push({
    title: cell('Bench & Backups'),
    count: bench ? bench.gaps.length : null,
    countLabel: bench ? cell(plural(bench.gaps.length, 'position without a backup', 'positions without a backup')) : null,
    lines: bench
      ? [
        cell(`${plural(bench.rows.length, 'player')} on the bench`),
        cell(bench.gaps.length ? `No backup: ${bench.gaps.map((g) => g.label.replace(/^an? /, '')).join('; ')}` : 'Catcher, middle infield and center field have a backup'),
        cell(missing.length ? `No ${missing.map((f) => f.label.toLowerCase().replace(/^an? /, '')).join(', ')}` : 'Every bench job has someone'),
      ]
      : [cell('No bench review yet', { tone: 'unknown' })],
    open: view('benchBackups'),
  });
  return out;
}

/** How the club's philosophy leans on the department's advice: one plain line, what it reads (and how) in its basis. */
function philosophy(v: OverviewContext) {
  const c = v.overview.context;
  if (!c) return null;
  // The season's line and the conflict carry the postseason odds: never served (D-060). What the window says stays in the basis.
  const read = c.lines.filter((l) => !/^The season:/.test(l));
  return claim({
    text: 'Your philosophy shades the order and wording of this advice',
    hint: 'Never a scouting read, a right or a development finding',
    tone: 'neutral',
    links: [],
    basis: basis({
      because: [
        ...read.map((value) => ({ label: 'Read', value })),
        { label: 'Used', value: c.used.join(', ') || 'Nothing' },
        { label: 'Not used yet', value: `${c.notUsed.join(', ') || 'Nothing'} (contract and prospect-capital data are not part of the review)` },
      ],
      source: sourceOf(v.ctx, 'Major League Ops and your philosophy'),
      unknown: [],
      wouldChange: ['Changing your philosophy changes how urgently a flag is raised, which equivalent option leads and how high the bar for acting is.'],
      lean: { neutral: 'A club with no stated philosophy gets the same reads, rights and development findings.', why: sentences([c.headline]) },
      certainty: 'policy',
      stamp: 'How a philosophy leans on advice is a stated policy, never fitted',
    }),
  });
}

/** The report's companion view: the staff at a glance, the open needs, the what-if and what can't be seen. */
export function overviewView(v: OverviewContext): MlbOverviewView {
  const o = v.overview;
  const fresh = o.freshness.level === 'current'
    ? null
    : cell(`Roster data: ${o.freshness.headline.replace(/\.$/, '')}. Rights that depend on the transaction log are said to be not established.`, { tone: 'caution' });
  const floors = o.coverage.floors.map((f) => f.label).join(', ');
  return {
    ...head(v, 'Major League Ops', {
      text: 'What needs your attention, and the staff\'s read on the roster',
      full: 'Nothing here ranks players or chooses a move: every finding is the specialist\'s that made it, and the decision is yours.',
    }),
    freshness: fresh,
    glances: glances(v),
    philosophy: philosophy(v),
    inbox: inbox(o.needs),
    inboxEmpty: o.needs.length
      ? null
      : cell('Nothing needs your attention: no role is below its minimum and the scouting review raises no case.', { hint: hintIf(floors ? `Minimums: ${floors}` : undefined) }),
    whatIf: {
      title: cell('Ask a what-if'),
      prompt: cell('If this player is unavailable…'),
      note: cell('A scenario to see how the club would respond if a player were out. It is a scenario, not a current problem.'),
      players: o.activePlayers.map((p) => ({
        player: player(v, p.playerId, p.name),
        role: p.role ? cell(p.role) : null,
        open: decision(`mlb:what_if:${p.playerId}`),
      })),
    },
    unknowns: sentences(o.unknowns).map((u) => cell(u)),
  };
}

// ── position players ─────────────────────────────────────────────────────────

/** A finding's tone: nothing to judge is unknown (never "fine"); otherwise the case's strength. */
const findingTone = (h: Holder): Tone => (h.kind === 'cannot_judge' || h.kind === 'too_early' ? 'unknown' : STRENGTH_TONE[h.strength] ?? 'neutral');

const standardLine = (h: Holder): string | null => (h.standard
  ? `${h.standard.label}: typical ${Math.round(h.standard.typical)}, unusually weak under ${Math.round(h.standard.floor)}, well under ${Math.round(h.standard.deepFloor)}.`
  : null);

/** The finding's chip and its claim: what the review read, with its reasons and what would change it. */
function readClaim(v: OverviewContext, h: Holder) {
  const words = labelOf(FINDING_TEXT, h.kind);
  return reviewClaim(v, words, {
    tone: findingTone(h),
    hint: hintIf(h.reasons[0]),
    because: [...because('Why', h.reasons), ...because('What could explain it', h.explanations)],
    wouldChange: h.wouldChange,
    links: [],
  });
}

/**
 * A row whose grades are OSA's view filling in for our scouts (D-067): every cell that rests on his grades carries the
 * sentence in its hint, and his detail opens with it as a quiet line, so the Mac can draw the mark ("OSA") beside them.
 * Nothing changes for a player our scouts rate.
 */
function markFill(playerId: number, cells: Record<string, Cell>, ratingKeys: readonly string[], detail: MlbBlock[]): MlbBlock[] {
  const note = ratingFillOf(playerId)?.hint ?? null;
  if (!note) return detail;
  for (const k of ratingKeys) {
    const c = cells[k];
    if (c) cells[k] = { ...c, hint: c.hint ? `${c.hint}. ${note}` : note };
  }
  const [first, ...rest] = detail;
  return first ? [{ ...first, lines: [line(note, { quiet: true }), ...first.lines] }, ...rest] : [block(null, [line(note, { quiet: true })])];
}

function hitterDetail(v: OverviewContext, h: Holder, spot: { position: number; label: string; partner: { playerId: number; name: string; share: number } | null }): MlbBlock[] {
  const e = h.evidence;
  const est = h.estimate;
  const prof = e.toolsProfile ?? null;
  const p = h.platoon ?? null;
  const tools = onScale(est.ratingsPct);
  const results = est.resultsPct === null ? 'no sample' : `${onScale(est.resultsPct)} (trusted ${share(e.reliability)})`;
  const bat: MlbLine[] = [];
  if (prof?.text.trim()) bat.push(line(prof.text));
  const contributions = (prof?.contributions ?? []).filter((c) => c.tool !== 'avoidK');
  if (contributions.length) {
    bat.push(line('His tools, and what each adds', {
      chips: contributions.map((c) => chip(`${c.tool === 'gap' ? 'gap' : c.tool} ${c.rating} ${signed(c.points)}`, c.points >= 9 ? 'good' : c.points <= -9 ? 'bad' : 'neutral')),
    }));
  }
  bat.push(line(`Tools ${tools ?? 'not known'} · results ${results}`, { hint: SCALE_HINT }));
  if (e.toolsExpected != null) bat.push(line(`His visible tools imply ${signed(e.toolsExpected * 1000)} points of wOBA against the league average.`, { quiet: true }));
  const std = standardLine(h);
  if (std) bat.push(line(std, { quiet: true }));

  const glove: MlbLine[] = [];
  if ((est.weightOnDefense ?? 0) > 0 && est.defensePct != null) {
    glove.push(line(`Glove ${onScale(est.defensePct)} at ${spot.label}, ${share(est.weightOnDefense ?? 0)} of his estimate.`));
  } else {
    glove.push(line(spot.position === 10 ? 'A designated hitter is his bat alone.' : 'His glove at the position is not visible: the estimate is his bat alone.', { quiet: true }));
  }
  if (e.defense?.visible) {
    const zone = e.defense.resultsPct != null ? `; zone results ${onScale(e.defense.resultsPct)} over ${Math.round(e.defense.resultsInnings ?? 0)} innings` : '';
    glove.push(line(`Visible grade ${e.defense.grade ?? 'not shown'} (${betterThan(e.defense.pct, 'those listed there') ?? 'not placed among those listed there'})${zone}.`, { quiet: true }));
  }
  if (est.runningPct != null) {
    const runs = e.running?.perSixHundred != null ? `; ${signed(e.running.perSixHundred)} baserunning runs per 600 PA` : '';
    glove.push(line(`Running ${onScale(est.runningPct)}, ${share(est.weightOnRunning ?? 0)} of his estimate${runs}.`));
  } else {
    glove.push(line('No running evidence.', { quiet: true }));
  }
  glove.push(...linesOf(h.usage.filter((u) => !u.startsWith('His visible tools imply'))));

  const platoon: MlbLine[] = [];
  if (p) {
    platoon.push(line(`${platoonHeadline(p)} Read from ${labelOf(PLATOON_BASIS, p.basis ?? 'none')}.`, { chips: [platoonChip(p)] }));
    if (p.drivers && p.drivers.league !== null && p.difference != null) {
      const parts = [`league norm ${signed(p.drivers.league * 1000)}`];
      if (p.drivers.ratings !== null) parts.push(`his ratings ${signed(p.drivers.ratings * 1000)}`);
      if (p.drivers.record !== null) parts.push(`his record ${signed(p.drivers.record * 1000)}`);
      platoon.push(line(`Against right minus left, ${signed(p.difference * 1000)} points: ${parts.join(', ')}.`, { quiet: true }));
    }
    platoon.push(...linesOf(p.reasons));
  } else {
    platoon.push(line('No platoon read.', { quiet: true }));
  }
  if (spot.partner) {
    platoon.push(line(`Shares the spot with ${spot.partner.name} (${share(spot.partner.share)} of the innings).`, { players: [player(v, spot.partner.playerId, spot.partner.name)] }));
  }
  return [block('The bat', bat), block('Glove and running', glove), block('Platoon', platoon)];
}

function hitterActions(h: Holder) {
  const out = [];
  if (h.strength === 'strong' || h.strength === 'moderate') out.push(action('Replacement options', decision(`mlb:role_holder_review:${h.playerId}`)));
  if (h.platoon?.verdict === 'problem') out.push(action('Platoon partner', decision(`mlb:platoon_complement:${h.playerId}`)));
  return out;
}

const LINEUP_COLUMNS = [
  column('spot', 'Spot'), column('player', 'Regular'), column('bats', 'Bats'), column('plays', 'Plays', true), column('estimate', 'Estimate', true),
  column('bat', 'Bat', true), column('glove', 'Glove', true), column('run', 'Run', true), column('platoon', 'Platoon'), column('read', 'Read'),
];

/** Position players: the lineup as usage shows it, each regular read on his bat, his glove at the position and his running. */
export function positionPlayersView(v: OverviewContext): MlbPositionPlayersView {
  const g = lineupGroup(v);
  const viewHead = head(v, 'Position players', {
    text: 'Each regular read against the standard for the job he is doing',
    full: 'Each regular is read on two lenses, his tools against major league peers and his results (league-relative, park-adjusted, '
      + 'several seasons, weighted by sample), blended into a working estimate: his bat, his glove at the position he plays and a little '
      + 'for running. A flag means he is unusually weak for the job he is doing, with what regulars at his position typically are shown '
      + 'beside him. It is a reason to look, not a move.',
  });
  if (!g || !g.lineup) {
    return {
      ...viewHead,
      lineup: { columns: LINEUP_COLUMNS, rows: [], empty: cell('No lineup usage is available yet, so the lineup can\'t be reviewed.', { tone: 'unknown' }) },
      basisNote: null,
    };
  }
  const byId = new Map(g.holders.map((h) => [h.playerId, h]));
  const spots = [...g.lineup.spots, g.lineup.dh];
  const rows: MlbRow[] = spots.map((sp, index) => {
    if (!sp.regular) {
      const who = sp.backups.length ? sp.backups.map((b) => `${b.name} (${share(b.share)})`).join(', ') : 'nobody has played it';
      // Nobody to read: the spot's own row says so once; its other columns are empty of a player, not unknown values
      const quiet = cell('—', { tone: 'unknown', hint: 'No regular here to read' });
      return tableRow(`spot-${sp.position}`, {
        spot: cell(sp.label), player: cell('Unsettled', { tone: 'unknown', hint: hintIf(`Played by ${who}`) }), bats: quiet, plays: quiet, estimate: quiet,
        bat: quiet, glove: quiet, run: quiet, platoon: quiet, read: cell('Unsettled', { tone: 'unknown' }),
      }, { spot: index, player: null, bats: null, plays: null, estimate: null, bat: null, glove: null, run: null, platoon: null, read: null }, {
        detail: [block('Unsettled', [line(`Nobody is the regular here: ${who}.`, { players: sp.backups.map((b) => player(v, b.playerId, b.name)) })])],
      });
    }
    const r = sp.regular;
    const h = byId.get(r.playerId);
    const est = h?.estimate;
    const notRead = cell('Not reviewed', { tone: 'unknown' });
    const gloveShown = est?.defensePct != null && (est.weightOnDefense ?? 0) > 0;
    const cells: Record<string, Cell> = {
      spot: cell(sp.label),
      player: cell(r.name, sp.partner ? { hint: hintIf(`Shares the spot with ${sp.partner.name}`) } : {}),
      bats: r.bats ? cell(r.bats) : cell('Not known', { tone: 'unknown' }),
      plays: cell(share(r.share), { hint: 'His share of the innings at the position' }),
      estimate: h
        ? numberCell(scaleNumber(est?.value), 'Not known', { hint: h.standard ? `Typical for the role: ${Math.round(h.standard.typical)} on the 0–100 scale` : SCALE_HINT })
        : notRead,
      bat: h ? numberCell(scaleNumber(est?.batValue ?? est?.value), 'Not known', { hint: SCALE_HINT }) : notRead,
      glove: gloveShown ? cell(scaleNumber(est?.defensePct) as string, { hint: SCALE_HINT }) : cell(sp.position === 10 ? 'Not used' : 'Not shown', { tone: 'unknown', hint: sp.position === 10 ? 'A designated hitter is his bat alone' : 'His glove at the position is not visible' }),
      run: numberCell(scaleNumber(est?.runningPct), 'No read', { hint: SCALE_HINT }),
      platoon: h ? platoonChip(h.platoon) : notRead,
      read: h ? cell(labelOf(FINDING_TEXT, h.kind), { tone: findingTone(h), hint: hintIf(h.reasons[0]) }) : notRead,
    };
    const sort: Record<string, number | string | null> = {
      spot: index,
      player: r.name,
      bats: r.bats,
      plays: r.share,
      estimate: est?.value ?? null,
      bat: est?.batValue ?? est?.value ?? null,
      glove: gloveShown ? est?.defensePct ?? null : null,
      run: est?.runningPct ?? null,
      platoon: rankOf(PLATOON_ORDER, h?.platoon?.verdict),
      read: rankOf(FINDING_ORDER, h?.kind),
    };
    return tableRow(`spot-${sp.position}`, cells, sort, {
      player: player(v, r.playerId, r.name),
      detail: markFill(r.playerId, cells, ['estimate', 'bat', 'glove', 'run'],
        h ? hitterDetail(v, h, sp) : [block(null, [line('The review has no read on him.', { quiet: true })])]),
      actions: h ? hitterActions(h) : [],
      ...(h ? { claim: readClaim(v, h) } : {}),
    });
  });
  return { ...viewHead, lineup: { columns: LINEUP_COLUMNS, rows, empty: null }, basisNote: g.lineup.basis.trim() ? cell(g.lineup.basis.trim()) : null };
}

// ── the pitching staff ───────────────────────────────────────────────────────

function armDetail(h: Holder): MlbBlock[] {
  const read = linesOf(h.reasons, false);
  const std = standardLine(h);
  if (std) read.push(line(std, { quiet: true }));
  const explain = h.explanations.length ? linesOf(h.explanations, false) : [line('Nothing unusual.', { quiet: true })];
  explain.push(...linesOf(h.usage));
  return [block('The read', read.length ? read : [line('No read.', { quiet: true })]), block('What could explain it', explain)];
}

function armTable(v: OverviewContext, g: RoleGroupReview, relief: boolean): MlbTable {
  const columns = [
    column('pitcher', 'Pitcher'), column('age', 'Age', true), ...(relief ? [column('usedAs', 'Used as')] : []), column('estimate', 'Estimate', true),
    column('tools', 'Tools', true), column('results', 'Results', true), column('read', 'Read'),
  ];
  const rows = g.holders.map((h, index) => {
    const results = h.estimate.resultsPct === null
      ? cell('No sample', { tone: 'unknown' })
      : cell(scaleNumber(h.estimate.resultsPct) as string, { hint: `On the 0–100 scale; his results carry ${share(h.evidence.reliability)} of the trust in his estimate` });
    const cells: Record<string, Cell> = {
      pitcher: cell(h.name),
      age: h.age === null ? cell('Not known', { tone: 'unknown' }) : cell(String(h.age)),
      estimate: numberCell(scaleNumber(h.estimate.value), 'Not known', { hint: relief && h.standard ? `Typical for the role: ${Math.round(h.standard.typical)} on the 0–100 scale` : SCALE_HINT }),
      tools: numberCell(scaleNumber(h.estimate.ratingsPct), 'Not known', { hint: SCALE_HINT }),
      results,
      read: cell(labelOf(FINDING_TEXT, h.kind), { tone: findingTone(h), hint: hintIf(h.reasons[0]) }),
    };
    const sort: Record<string, number | string | null> = {
      pitcher: h.name, age: h.age, estimate: h.estimate.value, tools: h.estimate.ratingsPct, results: h.estimate.resultsPct, read: index,
    };
    if (relief) {
      const tier = h.tier ? labelOf(TIER_TEXT, h.tier) : 'Not yet clear';
      cells.usedAs = cell(h.stakes ? `${tier} · ${h.stakes} stakes` : tier, { hint: hintIf(h.usage[0]), ...(h.tier ? {} : { tone: 'unknown' as const }) });
      sort.usedAs = rankOf(TIER_ORDER, h.tier);
    }
    const actions = h.strength === 'strong' || h.strength === 'moderate' ? [action('Replacement options', decision(`mlb:role_holder_review:${h.playerId}`))] : [];
    const detail = markFill(h.playerId, cells, ['estimate', 'tools'], armDetail(h));
    return tableRow(`arm-${h.playerId}`, cells, sort, { player: player(v, h.playerId, h.name), detail, actions, claim: readClaim(v, h) });
  });
  return { columns, rows, empty: rows.length ? null : cell('No arms to review.', { tone: 'unknown' }) };
}

/** Pitching staff: the rotation and the bullpen, each arm read against the standard for his job, the pen read as it is used. */
export function pitchingStaffView(v: OverviewContext): MlbPitchingStaffView {
  const rotation = rotationGroup(v);
  const pen = penGroup(v);
  const viewHead = head(v, 'Pitching staff', {
    text: 'Each arm read against the standard for the job he is doing',
    full: 'Each arm is read on his tools against major league pitchers of his kind and on his results (strikeouts, walks and home runs '
      + 'first; runs allowed keep a small share), blended by how much sample stands behind the results. A flag means he is unusually '
      + 'weak for the job he is doing: a long man is measured against long men, a closer against closers.',
  });
  const sections: MlbStaffSection[] = [];
  if (rotation) sections.push({ title: cell('Rotation'), findings: [], findingsEmpty: null, table: armTable(v, rotation, false), note: null });
  if (pen) {
    const findings: MlbBlock[] = [
      ...(pen.deployment ?? []).map((d) => block('A better arm in a lower role', [
        line(d.current, { chips: [cell('Now')] }), line(d.supported, { chips: [cell('Evidence says')] }), line(d.why, { chips: [cell('Why it matters')], quiet: true }),
      ], { chips: [cell('Usage, not a roster move', { tone: 'neutral' })] })),
      ...(pen.pen ?? []).map((f) => block(labelOf(PEN_HEADING, f.kind), [
        line(f.current, { chips: [cell('Now')], players: f.players.map((p) => player(v, p.playerId, p.name)) }),
        line(f.supported, { chips: [cell('Evidence says')] }),
        line(f.why, { chips: [cell('Why it matters')], quiet: true }),
      ])),
    ];
    const y = v.overview.yardsticks;
    sections.push({
      title: cell('Bullpen'),
      findings,
      findingsEmpty: findings.length ? null : cell('No notes on how the pen is used: the arms are used about where the evidence puts them.'),
      table: armTable(v, pen, true),
      note: reviewClaim(v, 'A reliever\'s role is what his usage shows this season: the leverage of his innings, how long he throws, and saves and holds', {
        hint: 'Too few appearances, or no exported leverage, is "not yet clear"',
        because: [
          { label: 'How long he throws', value: y.longMan },
          { label: 'Not yet clear', value: 'Too few appearances, or no exported leverage, is "not yet clear", never a guess.' },
        ],
      }),
    });
  }
  return { ...viewHead, sections, empty: sections.length ? null : cell('There are no available pitchers to review.', { tone: 'unknown' }) };
}

// ── the bench ────────────────────────────────────────────────────────────────

/** Bench & Backups: what the bench is for, who covers each job and how well, and the bench itself. Never a bench score. */
export function benchView(v: OverviewContext): MlbBenchView {
  const b = benchReview(v);
  const viewHead = head(v, 'Bench & Backups', {
    text: 'What the bench is for, and who can really play where',
    full: 'A bench is for something. Three positions need somebody who can really play them (catcher, middle infield, center field); '
      + 'the rest of what a bench does, a bat to send up, a glove for late innings, a runner, flexibility, is shown as jobs that someone '
      + 'does or nobody does. Being able to stand at a position is not being a backup for it: backups are read against the peers who '
      + 'actually play the position. Nothing here is a bench score.',
  });
  const columns = [
    column('player', 'Player'), column('bats', 'Bats'), column('for', 'For'), column('canPlay', 'Can play'), column('also', 'Also'),
    column('bat', 'Bat', true), column('pa', 'PA', true),
  ];
  if (!b) {
    return {
      ...viewHead, functions: [], bench: { columns, rows: [], empty: null }, findings: [], hands: null,
      empty: cell('No bench review is available yet.', { tone: 'unknown' }),
    };
  }
  const gapOf = (key: string) => b.gaps.find((g) => g.key === key);
  const functions: MlbBenchFunction[] = b.functions.map((f) => {
    const required = (REQUIRED_COVERS as readonly string[]).includes(f.key);
    return {
      key: f.key,
      title: cell(f.label.trim() || codeWords(f.key)),
      strength: cell(labelOf(required ? FUNCTION_STRENGTH : SOFT_FUNCTION_STRENGTH, f.strength), { tone: FUNCTION_TONE[f.strength] ?? 'unknown' }),
      text: cell(f.text.trim() || labelOf(required ? FUNCTION_STRENGTH : SOFT_FUNCTION_STRENGTH, f.strength)),
      by: f.by.slice(0, 4).map((x) => line(`${x.name}${x.note.trim() ? ` · ${x.note.trim()}` : ''}`, {
        players: [player(v, x.playerId, x.name)],
        chips: x.quality && required ? [cell(labelOf(QUALITY_TEXT, x.quality), { tone: QUALITY_TONE[x.quality] ?? 'unknown' })] : [],
      })),
      action: required && gapOf(f.key) ? action('Who could back it up?', decision(`mlb:bench_coverage:${f.key}`)) : null,
    };
  });
  const rows = b.rows.map((r) => {
    const covers = r.coverReads.map((c) => `${positionAbbr(c.position)}${c.quality === 'emergency' ? ' (emergency)' : ''}`);
    const tags = r.tags.filter((t) => t !== 'platoon_partner').map((t) => labelOf(TAG_TEXT, t));
    const cells: Record<string, Cell> = {
      player: cell(r.name),
      bats: r.bats ? cell(r.bats) : cell('Not known', { tone: 'unknown' }),
      for: cell(`${r.role}${r.partnerAt ? ` · shares ${positionAbbr(r.partnerAt)}` : ''}`),
      canPlay: covers.length ? cell(covers.join(', ')) : cell('No visible grade', { tone: 'unknown' }),
      also: tags.length ? cell(tags.join(', ')) : cell('Nothing else'),
      bat: numberCell(scaleNumber(r.batValue), 'Not known', { hint: SCALE_HINT }),
      pa: cell(String(r.pa)),
    };
    const sort: Record<string, number | string | null> = {
      player: r.name, bats: r.bats, for: r.role, canPlay: covers.length ? covers.join(', ') : null, also: tags.length ? tags.join(', ') : null,
      bat: r.batValue, pa: r.pa,
    };
    const reads = r.coverReads.map((c) => line(
      `${positionAbbr(c.position)}: ${labelOf(QUALITY_TEXT, c.quality)}${c.pct !== null ? `, ${betterThan(c.pct, 'those listed there')}` : ''}`,
      { chips: [cell(positionAbbr(c.position), { tone: QUALITY_TONE[c.quality] ?? 'unknown' })] },
    ));
    return tableRow(`bench-${r.playerId}`, cells, sort, {
      player: player(v, r.playerId, r.name),
      detail: markFill(r.playerId, cells, ['canPlay', 'bat'], [block('Where he can play', reads.length ? reads : [line('No visible grade at any position.', { quiet: true })])]),
    });
  });
  return {
    ...viewHead,
    functions,
    bench: { columns, rows, empty: rows.length ? null : cell('There is no bench: every active position player is a regular.') },
    findings: sentences(b.findings.filter((f) => !b.gaps.some((g) => g.text === f))).map((f) => cell(f)),
    hands: cell(`Bench hands: ${b.hands.L} left, ${b.hands.R} right, ${b.hands.S} switch.`),
    empty: null,
  };
}

/** Every standing view, from one overview (built together with the department's report, once per import). */
export interface MajorLeagueViews {
  overview: MlbOverviewView;
  positionPlayers: MlbPositionPlayersView;
  pitchingStaff: MlbPitchingStaffView;
  benchBackups: MlbBenchView;
}

export function majorLeagueViews(v: OverviewContext): MajorLeagueViews {
  return { overview: overviewView(v), positionPlayers: positionPlayersView(v), pitchingStaff: pitchingStaffView(v), benchBackups: benchView(v) };
}

export { REVIEW };
