/**
 * A decision, worded (the React `Decision.tsx`, moved): one need opened, in the GM's order: the problem, why it was
 * flagged and on what evidence, the staff's call, the ways to respond followed through to their consequences, and only
 * then every candidate and the roster mechanics behind them. It words Major League Ops' response packet
 * (`mlbResponses`) and nothing else: no candidate is ranked here, no right or development answer is rebuilt, and the
 * farm's consequence is shown as Minor League Operations served it (D-024, D-045). The staff's call is advice with its
 * rubric in the basis; the move is the GM's (D-001).
 *
 * The packet's season read and odds are never read (D-060): the club's philosophy and season appear only as the leans
 * the specialists already wrote, in a claim's basis.
 */
import type { Cell, Tone } from '../../contract/presentation.js';
import type { FarmConsequence } from '../../mlbEvidence.js';
import type { MlbNeed } from '../../mlbNeeds.js';
import type { Plan } from '../../mlbPlans.js';
import type { Pathway, Recommendation, RolePicture } from '../../mlbReport.js';
import type { ChainLink, ConstraintClearing, ResponseCandidate, ResponsePacket } from '../../mlbResponses.js';
import { basis, cell, claim } from '../claim.js';
import { sourceOf } from '../frontOffice/desk.js';
import {
  block, because, column, head, line, linesOf, numberCell, player, RESPONSES, REVIEW, reviewCertainty, tableRow, type ViewContext,
} from './common.js';
import type {
  MlbBlock, MlbCall, MlbCandidates, MlbChoices, MlbConstraint, MlbDecisionQuery, MlbDecisionView, MlbGauge, MlbLine, MlbMechanics,
  MlbPerson, MlbPicture, MlbPlan, MlbResponses, MlbRow, MlbWhy,
} from './types.js';
import {
  BASIS, chip, codeWords, COMPARE_TEXT, COMPARE_TONE, CONFIDENCE_TEXT, DEV, DEV_TONE, DIMENSION_LABEL, DURATIONS, FARM_STATUS, FARM_TONE,
  hintIf, horizonText, KIND_LABEL, labelOf, needBadge, onScale, rankOf, DEV_ORDER, FIT_ORDER, PATH_ORDER, PREFERENCE_ORDER, RESPONSE_ORDER, scaleNumber, SCALE_HINT, PATH, PATH_LABEL, PATH_TONE, PREFERENCE, RIGHTS_TONE, ROLE_CHOICES, sentences,
  CERTAINTY_TEXT, EVIDENCE_TEXT, FIT_TEXT, FIT_TONE, GROUP_TEXT, STAKES_TIER, stakesWords, STANCE_TEXT, STANCE_TONE, STEP_STATUS, VERDICT_TEXT, VERDICT_TONE,
} from './words.js';

/** What the GM chose so far, as the request carried it. */
export interface DecisionAsk {
  need: string;
  role?: string;
  context?: string;
  days?: number | null;
}

const query = (ask: DecisionAsk, change: Partial<DecisionAsk>): MlbDecisionQuery => {
  const merged = { ...ask, ...change };
  const out: MlbDecisionQuery = { need: merged.need };
  if (merged.role) out.role = merged.role;
  if (merged.context) out.context = merged.context;
  if (merged.days !== undefined && merged.days !== null) out.days = merged.days;
  return out;
};

const rightsChip = (status: string, label: string, hint?: string) => chip(label.trim() || labelOf(STEP_STATUS, status), RIGHTS_TONE[status] ?? 'unknown', hint);

// ── the problem ──────────────────────────────────────────────────────────────

function problemBlock(v: ViewContext, need: MlbNeed): MlbBlock {
  const lines: MlbLine[] = [line(need.summary.trim() || need.title)];
  for (const c of need.causes) {
    const how = c.assumed ? 'assumed unavailable (your scenario)' : `${c.status}${c.daysLeft ? `, ${c.daysLeft} days left` : ''}`;
    lines.push(line(`${c.name}: ${how}`, { players: [player(v, c.playerId, c.name)] }));
  }
  for (const f of need.facts) if (f.label.trim() && f.value.trim()) lines.push(line(`${f.label.trim()}: ${f.value.trim()}`, { quiet: true }));
  if (need.horizon.basis.trim()) lines.push(line(need.horizon.basis, { quiet: true }));
  lines.push(...linesOf(need.unknowns));
  return block(need.explanation ? 'The problem' : 'Why Pennant says this', lines);
}

// ── why it was flagged ───────────────────────────────────────────────────────

function gaugeOf(need: MlbNeed): MlbGauge | null {
  const x = need.explanation;
  const s = x?.why.standard;
  if (!x || !s || x.why.estimate === null) return null;
  const him = Math.round(x.why.estimate);
  return {
    deepFloor: s.deepFloor,
    floor: s.floor,
    typical: s.typical,
    estimate: x.why.estimate,
    typicalLabel: cell(`typical ${Math.round(s.typical)}`),
    estimateLabel: cell(`him ${him}`),
    key: cell(`${s.label}: unusually weak under ${Math.round(s.floor)}, well under ${Math.round(s.deepFloor)}.`),
    spoken: `His working estimate ${him} against a line of ${Math.round(s.floor)} and a typical ${Math.round(s.typical)}`,
  };
}

function whyOf(v: ViewContext, need: MlbNeed): MlbWhy | null {
  const x = need.explanation;
  if (!x) return null;
  const neutral = x.neutralSeverity === 'elevated' ? 'needs attention' : 'watch';
  const shaded = need.severity === 'elevated' ? 'needs attention' : need.severity === 'critical' ? 'urgent' : 'watch';
  const changed = x.context.changed;
  const text = x.why.text.trim() || need.title;
  const headline = claim({
    text,
    tone: 'neutral',
    links: need.subject ? [player(v, need.subject.playerId, need.subject.name).open].filter((t): t is NonNullable<typeof t> => t !== null) : [],
    basis: basis({
      because: [
        ...x.parts.map((p) => ({
          label: p.label.trim() || 'Part',
          value: `${onScale(p.value) ?? 'not known'}${p.weight !== null && p.weight > 0 ? `, ${Math.round(p.weight * 100)}% of the estimate` : ''}${p.basis.trim() ? `: ${p.basis.trim()}` : ''}`,
        })),
        ...because('Not changed by your club\'s context', x.context.notChanged),
      ],
      source: sourceOf(v.ctx, REVIEW),
      unknown: sentences(x.unknown),
      wouldChange: sentences(x.wouldChange),
      // What the club's philosophy and season did, beside what a club with none would have seen (D-036)
      lean: changed.length
        ? { neutral: `A club with no philosophy would have seen this as "${neutral}"; yours sees it as "${shaded}".`, why: sentences(changed.map((c) => `${labelOf(DIMENSION_LABEL, c.dimension)}: ${c.text}`)) }
        : null,
      ...reviewCertainty(v.overview),
    }),
  });
  const parts = x.parts.map((p) => line(
    `${p.label.trim() || 'Part'} ${onScale(p.value) ?? 'not known'}${p.weight !== null && p.weight > 0 ? ` · ${Math.round(p.weight * 100)}% of the estimate` : ''}`,
    { hint: hintIf(p.basis), tone: p.value === null ? 'unknown' : undefined },
  ));
  // The club's lean lives only in the claim's basis, never on the decision's face (D-060, D-065)
  const blocks: MlbBlock[] = [block('What the estimate is made of', parts)];
  blocks.push(block('What the context never changes', linesOf(x.context.notChanged), { collapsed: true }));
  if (x.unknown.length) blocks.push(block('Not known', linesOf(x.unknown, false)));
  if (x.explanations.length) blocks.push(block('What could explain it', linesOf(x.explanations, false)));
  if (x.wouldChange.length) blocks.push(block('What would change this', linesOf(x.wouldChange, false)));
  return { title: cell('Why it was flagged'), claim: headline, gauge: gaugeOf(need), blocks };
}

// ── the evidence: the role's picture ─────────────────────────────────────────

function pictureOf(v: ViewContext, pic: RolePicture): MlbPicture {
  const people: MlbPerson[] = pic.rows.map((r) => {
    const lines: MlbLine[] = [];
    if (r.estimate !== null && r.composite !== null && r.resultsPct !== null) {
      lines.push(line(`His estimate is ${Math.round(r.weightOnResults * 100)}% results, ${Math.round((1 - r.weightOnResults) * 100)}% tools.`, { quiet: true }));
    }
    if (r.weakestCore !== null) {
      lines.push(line(`Weakest core tool: ${onScale(r.weakestCore)}${r.evidenceStatus !== 'complete' ? ` · ratings ${labelOf(EVIDENCE_TEXT, r.evidenceStatus)}` : ''}`, { quiet: true }));
    }
    const p = r.performance;
    lines.push(line(p ? `This season: ${p.lines.map((l) => `${l.label} ${l.value}`).join(' · ')} (${p.sample} ${p.sampleUnit})` : 'This season: no line yet', { quiet: !p }));
    lines.push(...linesOf(r.usage));
    if (r.comparison) {
      const delta = r.comparison.delta !== null ? ` ${r.comparison.delta >= 0 ? '+' : ''}${Math.round(r.comparison.delta)} over him · read ${labelOf(CERTAINTY_TEXT, r.comparison.certainty)}` : '';
      lines.push(line(`Against the man under review${delta}`, {
        chips: [chip(labelOf(COMPARE_TEXT, r.comparison.verdict), COMPARE_TONE[r.comparison.verdict] ?? 'unknown')],
      }));
      if (r.group) lines.push(line(labelOf(GROUP_TEXT, r.group), { quiet: true }));
    }
    if (r.complement) {
      const side = r.complement.weakSide === 'L' ? 'left' : 'right';
      const expected = r.complement.expected === null ? 'no read' : `${r.complement.expected.toFixed(3).replace(/^0/, '')} expected wOBA`;
      const advantage = r.complement.advantage !== null ? ` · ${r.complement.advantage >= 0 ? '+' : ''}${Math.round(r.complement.advantage * 1000)} points` : '';
      lines.push(line(`Against ${side}-handers: ${expected}${advantage}`, {
        chips: r.complement.advantage !== null ? [chip(r.complement.fits ? 'Complements him' : 'Not enough', r.complement.fits ? 'good' : 'neutral')] : [],
      }));
    }
    if (r.standing) {
      lines.push(line(r.standing.rank !== null ? `Ranks ${r.standing.rank} of ${r.standing.assessed + 1} in the group` : 'Where he would rank is not established', {
        chips: [chip(labelOf(VERDICT_TEXT, r.standing.verdict), VERDICT_TONE[r.standing.verdict] ?? 'unknown')],
        quiet: r.standing.rank === null,
      }));
    }
    return {
      player: player(v, r.playerId, r.name),
      status: cell(`${r.age ?? 'Age not known'} · ${r.relation === 'subject' ? r.status : r.underReview ? 'Under review' : 'Current'}`),
      subject: r.relation === 'subject' || r.underReview === true,
      lenses: [
        { label: cell('Estimate'), value: r.estimate, display: cell(scaleNumber(r.estimate) ?? 'No evidence', r.estimate === null ? { tone: 'unknown' } : { hint: SCALE_HINT }) },
        { label: cell('Tools'), value: r.composite, display: cell(scaleNumber(r.composite) ?? 'No evidence', r.composite === null ? { tone: 'unknown' } : { hint: SCALE_HINT }) },
        { label: cell('Results'), value: r.resultsPct, display: cell(scaleNumber(r.resultsPct) ?? 'No evidence', r.resultsPct === null ? { tone: 'unknown' } : { hint: SCALE_HINT }) },
      ],
      lines,
    };
  });
  return {
    title: cell(`The evidence: the ${pic.role} picture`),
    note: pic.standard ? cell(`${pic.standard.healthy} healthy on the active roster against a minimum of ${pic.standard.count}.`) : null,
    people,
    basisNote: cell(pic.basis.trim() || 'Each man read the same way, against the same peers.'),
  };
}

// ── the staff's call ─────────────────────────────────────────────────────────

function callOf(v: ViewContext, r: Recommendation): MlbCall {
  const shading = r.shading ?? [];
  const headline = claim({
    text: r.headline.trim() || labelOf(STANCE_TEXT, r.stance),
    tone: STANCE_TONE[r.stance] ?? 'neutral',
    links: [],
    basis: basis({
      because: [...because('Because', r.because), ...because('How the staff decides', [r.basis])],
      source: sourceOf(v.ctx, 'Major League Ops\' staff'),
      unknown: sentences(r.toSettle),
      wouldChange: sentences(r.wouldChange),
      lean: shading.length
        ? {
          neutral: r.neutralStance ? `A club with no stated philosophy would have seen "${labelOf(STANCE_TEXT, r.neutralStance)}".` : 'A club with no stated philosophy would have seen the same call.',
          why: sentences(shading.map((s) => `${labelOf(DIMENSION_LABEL, s.dimension)}: ${s.text}`)),
        }
        : null,
      certainty: 'policy',
      stamp: 'The staff\'s call follows a stated rubric; it is advice, and the move is yours',
    }),
  });
  const blocks: MlbBlock[] = [block('Because', linesOf(r.because, false))];
  if (r.toSettle.length) blocks.push(block('To settle first', linesOf(r.toSettle, false)));
  // How the philosophy leaned is in the headline's basis only, never a block on the face (D-060, D-065)
  blocks.push(block('What would change this', linesOf(r.wouldChange, false), { collapsed: true }));
  return {
    title: cell('The staff\'s call'),
    stance: cell(labelOf(STANCE_TEXT, r.stance), { tone: STANCE_TONE[r.stance] ?? 'neutral' }),
    confidence: cell(labelOf(CONFIDENCE_TEXT, r.confidence)),
    headline,
    blocks,
  };
}

// ── the ways to respond ──────────────────────────────────────────────────────

const PLAN_STATUS: Readonly<Record<string, string>> = { eligible: 'Allowed', indeterminate: 'Not established', ineligible: 'Not allowed' };

function planOf(p: Plan): MlbPlan {
  const steps = p.steps.map((st) => line(st.text, {
    chips: st.status === 'not_a_transaction' ? [] : [chip(labelOf(PLAN_STATUS, st.status), RIGHTS_TONE[st.status] ?? 'unknown')],
  }));
  for (const st of p.steps) if (st.note?.trim()) steps.push(line(st.note, { quiet: true }));
  const blocks: MlbBlock[] = [block(null, [line(p.summary, { quiet: true })]), block('Steps', steps)];
  if (p.followUp) {
    const alternatives = p.followUp.alternatives.map((a) => `${a.name}${a.estimate === null ? '' : ` (${onScale(a.estimate)})`}`).join(', ');
    blocks.push(block('What follows', [
      line(p.followUp.text),
      ...(alternatives ? [line(`Or: ${alternatives}.`, { quiet: true })] : []),
    ]));
  }
  const effects: MlbLine[] = p.groups.flatMap((g) => {
    const out = [line(`${g.label}: healthy ${g.healthyBefore} → ${g.healthyAfter}${g.floor !== null ? ` (minimum ${g.floor})` : ''}`)];
    const change = g.change !== null && Math.abs(g.change) >= 0.5 ? ` (${g.change >= 0 ? '+' : ''}${g.change.toFixed(1)})` : '';
    out.push(line(`Mean estimate ${scaleNumber(g.meanBefore) ?? 'not known'} → ${onScale(g.meanAfter) ?? 'not known'}${change}`, { quiet: true }));
    if (g.weakestBefore && g.weakestAfter && g.weakestBefore.name !== g.weakestAfter.name) {
      out.push(line(`Weakest: ${g.weakestBefore.name} (${scaleNumber(g.weakestBefore.estimate)}) → ${g.weakestAfter.name} (${onScale(g.weakestAfter.estimate)})`, { quiet: true }));
    }
    if (g.unknown > 0) out.push(line(`${g.unknown} without an estimate`, { quiet: true }));
    return out;
  });
  effects.push(line(`Active roster: ${p.counts.active}`), line(`40-man: ${p.counts.fortyMan}`));
  blocks.push(block('What it does to the roster', effects));
  if (p.problems.length) blocks.push(block('Problems', linesOf(p.problems, false)));
  if (p.costs.length) blocks.push(block('Costs and risks', linesOf(p.costs, false), { collapsed: true }));
  if (p.certaintyNote.trim()) blocks.push(block(null, [line(p.certaintyNote, { quiet: true })]));
  return { title: cell(p.title.trim() || 'A way to respond'), pathState: chip(labelOf(PATH, p.certainty), PATH_TONE[p.certainty] ?? 'unknown', p.certaintyNote), blocks };
}

function pathwayOf(v: ViewContext, p: Pathway): MlbPlan {
  const blocks: MlbBlock[] = [];
  if (p.why.length) blocks.push(block('Why', linesOf(p.why, false)));
  if (p.steps.length) blocks.push(block('Steps', linesOf(p.steps, false)));
  if (p.moves.length) {
    const moves = p.moves.map((m) => line(`${m.name} · ${[m.role, m.transaction, m.class].filter((x) => x && x.trim()).join(' · ')}`, {
      players: [player(v, m.playerId, m.name)],
      hint: hintIf(m.rights),
    }));
    for (const m of p.moves) if (m.note.trim()) moves.push(line(`${m.name}: ${m.note}`, { quiet: true }));
    if (p.moreMoves > 0) moves.push(line(`And ${p.moreMoves} more of the same kind, in every way to clear a spot below.`, { quiet: true }));
    blocks.push(block('The moves', moves));
  }
  if (p.consequences.length) blocks.push(block('What follows', linesOf(p.consequences, false)));
  if (p.certaintyNote.trim()) blocks.push(block(null, [line(p.certaintyNote, { quiet: true })]));
  return { title: cell(p.title.trim() || 'A pathway'), pathState: chip(labelOf(PATH, p.certainty), PATH_TONE[p.certainty] ?? 'unknown', p.certaintyNote), blocks };
}

// ── the farm's answer, displayed ─────────────────────────────────────────────

/** Minor League Operations' answer as it served it: never recomputed here (D-045). */
export function farmLines(v: ViewContext, farm: FarmConsequence | null): MlbLine[] {
  if (!farm) return [line('Not known: Minor League Operations could not read it.', { quiet: true, tone: 'unknown' })];
  const out: MlbLine[] = [];
  const status = (s: string) => chip(labelOf(FARM_STATUS, s), FARM_TONE[s] ?? 'neutral');
  const where = `${farm.affiliate.label} (${farm.affiliate.levelName})`;
  out.push(farm.overall.before === farm.overall.after
    ? line(`${where} stays as it is, by Minor League Operations' own reading.`, { chips: [status(farm.overall.after)] })
    : line(`${where} goes from one state to the other, by Minor League Operations' own reading.`, { chips: [status(farm.overall.before), cell('→'), status(farm.overall.after)] }));
  const f = farm.farm;
  if (f?.summary.trim()) out.push(line(f.summary));
  const now = f?.currentOpportunity;
  if (now && (now.recentArrival || now.disagrees || now.evidence === 'thin') && now.detail.trim()) {
    out.push(line(`At ${farm.affiliate.label} now: ${now.detail.trim()}`, { quiet: true }));
  }
  const a = farm.arrival;
  if (a?.summary.trim()) out.push(line(a.summary));
  if (a && (a.timing === 'uncertain' || a.timing === 'recently_resolved')) {
    out.push(line(a.timing === 'uncertain'
      ? 'Who holds that job there cannot be read yet from the club\'s recent games.'
      : 'The man who held that job there has recently left it; the club\'s recent games show no shortage.', { quiet: true }));
  }
  for (const c of farm.changes) if (c.before !== c.after) out.push(line(`${c.label}: ${c.before} → ${c.after}`));
  for (const p of f?.playingTimeImpact.slice(0, 3) ?? []) out.push(line(p.effect, { quiet: true, players: [player(v, p.playerId, p.name)] }));
  if (f?.replacementOptions.length) {
    out.push(line(`Could take the job: ${f.replacementOptions.map((r) => `${r.name} (${r.from}, ${labelOf(DEV, r.judgment).toLowerCase()})`).join('; ')}.`, {
      quiet: true, players: f.replacementOptions.map((r) => player(v, r.playerId, r.name)),
    }));
  }
  for (const u of sentences(f?.unresolvedIssues ?? [])) out.push(line(`Left open: ${u}`, { quiet: true }));
  if (f?.cascade && f.cascade.certainty === 'indeterminate') {
    out.push(line('The chain below is only as certain as its least certain step, and one step cannot be judged.', { quiet: true }));
  }
  out.push(...linesOf(farm.issuesAfter));
  out.push(...sentences(farm.rosterNotes).map((n) => line(n, { quiet: true, chips: [cell('Roster note', { tone: 'caution' })] })));
  return out;
}

// ── candidates ───────────────────────────────────────────────────────────────

function chainLines(chain: ChainLink[]): MlbLine[] {
  return chain.map((l) => line(l.detail.trim() || l.label, {
    chips: [chip(l.label.trim() || codeWords(l.action), RIGHTS_TONE[l.status] ?? 'unknown')],
    quiet: !l.detail.trim(),
  }));
}

function candidateDetail(v: ViewContext, c: ResponseCandidate): MlbBlock[] {
  const blocks: MlbBlock[] = [];
  blocks.push(block('Why he is here', [...linesOf(c.why, false), ...linesOf(c.discovery.evidence)]));
  const d = c.development;
  const dev: MlbLine[] = [];
  let devTitle = 'Development';
  if (d.status === 'unassessed' || d.status === 'not_applicable') {
    dev.push(line(stakesWords(d.message)));
  } else {
    devTitle = d.duration ? 'Development: judged for each duration' : d.contextual ? `Development: assessed as ${d.contextual.contextLabel.toLowerCase()}` : d.context === 'durable_role' ? 'Development: assessed as a durable role' : 'Development';
    if (d.duration) {
      dev.push(line(stakesWords(d.duration.explanation)));
      for (const verdict of d.duration.verdicts) {
        dev.push(line(`${verdict.label}: ${verdict.assessed ? labelOf(DEV, verdict.judgment) : 'not assessed'}`, {
          quiet: true, chips: verdict.assessed ? [chip(labelOf(DEV, verdict.judgment), DEV_TONE[verdict.judgment] ?? 'unknown')] : [],
        }));
        for (const t of sentences([...verdict.blockers, ...verdict.missing])) dev.push(line(stakesWords(t), { quiet: true }));
      }
      if (d.duration.resolvedBy?.trim()) dev.push(line(stakesWords(d.duration.resolvedBy), { quiet: true }));
    }
    if (d.contextual) {
      const k = d.contextual;
      const parts = [`Developmental stakes: ${k.stakesTier ? labelOf(STAKES_TIER, k.stakesTier) : 'not known'}`];
      if (k.requiredReadiness !== null) parts.push(`readiness bar ${k.requiredReadiness} (durable role: ${k.durableReadiness ?? 'not known'})`);
      if (k.experience) parts.push(`Triple-A and major league career ${Math.round(k.experience.plateAppearances)} PA, ${Math.round(k.experience.inningsPitched)} IP`);
      dev.push(line(parts.join(' · '), { quiet: true }));
      dev.push(...linesOf(k.stakesReasons.map(stakesWords)));
    }
    dev.push(...linesOf(d.reasons.map(stakesWords), false), ...linesOf(d.blockers.map(stakesWords), false));
    dev.push(...sentences(d.missing).map((m) => line(`Missing: ${stakesWords(m)}`, { quiet: true })));
  }
  blocks.push(block(devTitle, dev.length ? dev : [line('Nothing more from Player Development.', { quiet: true })]));
  if (c.roleFit) {
    const e = c.roleFit.evidence;
    blocks.push(block('Fit at the major league level', [
      line(`${c.roleFit.classification ? labelOf(FIT_TEXT, c.roleFit.classification) : 'Not computable'}${e.compositePercentile !== null ? ` · his tools ${onScale(e.compositePercentile)} against major league peers` : ''}`),
      line(`Visible tool ratings: ${labelOf(EVIDENCE_TEXT, e.evidenceStatus)}${e.unassessed.length ? `; not assessed: ${e.unassessed.join(', ')}` : ''}`, { quiet: true }),
    ]));
  }
  if (c.performance) {
    const p = c.performance;
    blocks.push(block(`Season line (${p.sample} ${p.sampleUnit}, level ${p.level})`, [line(p.lines.map((l) => `${l.label} ${l.value}`).join(' · ') || 'No line yet')]));
  }
  const path: MlbLine[] = [];
  if (c.path.chain.some((l) => l.kind === 'clear_spot')) path.push(...chainLines(c.path.chain));
  for (const s of c.path.steps) {
    path.push(line(`${s.seq}. ${s.label.trim() || codeWords(s.action)}`, {
      chips: s.status === 'not_a_transaction' ? [] : [chip(labelOf(STEP_STATUS, s.status), RIGHTS_TONE[s.status] ?? 'unknown')],
    }));
    for (const r of s.reasons) if (r.message.trim()) path.push(line(`${r.message.trim()} (${labelOf(BASIS, r.basis)})`, { quiet: true }));
    for (const r of s.requirements) if (r.status !== 'met' && r.message.trim()) path.push(line(`Requires: ${r.message.trim()}`));
    for (const m of s.missing) if (m.message.trim()) path.push(line(`Missing: ${m.message.trim()}`, { quiet: true }));
    if (s.limitation?.trim()) path.push(line(s.limitation, { quiet: true }));
  }
  blocks.push(block('Transaction path', path.length ? path : [line('No transaction: a change of role.', { quiet: true })]));
  const cons = c.consequences;
  const roster: MlbLine[] = [
    line(`Active roster: ${cons.active.before ?? 'not known'} of ${cons.active.limit ?? 'not known'}${cons.active.change ? ' (+1)' : ' (no change)'}${cons.active.note ? ` (${cons.active.note.trim()})` : ''}`),
    line(`40-man: ${cons.fortyMan.before ?? 'not known'} of ${cons.fortyMan.limit ?? 'not known'}${cons.fortyMan.change ? ' (+1)' : ' (no change)'}`),
  ];
  if (cons.vacatedRole) {
    const vr = cons.vacatedRole;
    roster.push(line(`Leaves ${vr.role} with ${vr.availableAfter} available against a minimum of ${vr.floor}${vr.belowFloor ? ', below it' : ''}.`, { tone: vr.belowFloor ? 'bad' : undefined }));
  }
  blocks.push(block('Roster effect', roster));
  if (c.pathKind !== 'role_change') blocks.push(block('Minor-league consequence', farmLines(v, cons.farm)));
  blocks.push(block('Contract and control', cons.facts.length
    ? cons.facts.filter((f) => f.label.trim() && f.value.trim()).map((f) => line(`${f.label.trim()}: ${f.value.trim()}`))
    : [line('Nothing on record.', { quiet: true })]));
  const pref = c.philosophy;
  blocks.push(block('Organizational preference', pref.status === 'applied' && pref.reasons.length
    ? pref.reasons.map((r) => line(`${r.message.trim()} (${labelOf(DIMENSION_LABEL, r.dimension)})`))
    : [line(pref.note?.trim() || 'No preference applies.', { quiet: true })]));
  return blocks;
}

function candidateRow(v: ViewContext, c: ResponseCandidate, mode: ResponsePacket['direction'], index: number): MlbRow {
  const stance = c.philosophy.status === 'applied' ? c.philosophy.stance : null;
  const devHint = hintIf(stakesWords(c.development.status === 'unassessed' || c.development.status === 'not_applicable' ? c.development.message : c.development.reasons[0] ?? ''));
  const spots = [c.requiresClearing.fortyMan ? '40-man spot' : null, c.requiresClearing.active ? 'active spot' : null].filter(Boolean).join(', ');
  const cells: Record<string, Cell> = {
    player: cell(c.name),
    age: c.age === null ? cell('Not known', { tone: 'unknown' }) : cell(String(c.age)),
    response: cell(labelOf(PATH_LABEL, c.pathKind)),
    development: cell(labelOf(DEV, c.development.status), { tone: DEV_TONE[c.development.status] ?? 'unknown', ...(devHint ? { hint: devHint } : {}) }),
    transaction: cell(`${labelOf(PATH, c.path.status)}${spots ? ` · needs ${spots}` : ''}`, { tone: PATH_TONE[c.path.status] ?? 'unknown' }),
    fit: c.roleFit?.classification ? cell(labelOf(FIT_TEXT, c.roleFit.classification), { tone: FIT_TONE[c.roleFit.classification] ?? 'unknown' }) : cell('Not read', { tone: 'unknown' }),
    organization: stance ? cell(labelOf(PREFERENCE, stance)) : cell('No preference'),
  };
  const sort: Record<string, number | string | null> = {
    // Codes sort by their served order, an unknown last (M6)
    player: c.name, age: c.age, response: rankOf(RESPONSE_ORDER, c.pathKind), development: rankOf(DEV_ORDER, c.development.status),
    transaction: rankOf(PATH_ORDER, c.path.status), fit: rankOf(FIT_ORDER, c.roleFit?.classification), organization: rankOf(PREFERENCE_ORDER, stance ?? 'no_preference'),
  };
  if (mode === 'replace') {
    const cmp = c.comparison ?? null;
    cells.against = cmp
      ? cell(`${labelOf(COMPARE_TEXT, cmp.verdict)}${cmp.delta !== null ? ` (${cmp.delta >= 0 ? '+' : ''}${Math.round(cmp.delta)})` : ''}`, { tone: COMPARE_TONE[cmp.verdict] ?? 'unknown', ...(hintIf(cmp.reasons[0]) ? { hint: hintIf(cmp.reasons[0]) } : {}) })
      : cell('No read', { tone: 'unknown' });
    sort.against = cmp?.delta ?? null;
  }
  if (mode === 'complement') {
    const fit = c.complement?.fit ?? null;
    cells.against = fit
      ? cell(`${fit.fits ? 'Complements' : 'Not enough'}${fit.advantage !== null ? ` (${fit.advantage >= 0 ? '+' : ''}${Math.round(fit.advantage * 1000)})` : ''}`, { tone: fit.fits ? 'good' : 'neutral', ...(hintIf(fit.reasons[0]) ? { hint: hintIf(fit.reasons[0]) } : {}) })
      : cell('No read', { tone: 'unknown' });
    sort.against = fit?.advantage ?? null;
  }
  void index;
  return tableRow(`candidate-${c.pathKind}-${c.playerId}`, cells, sort, { player: player(v, c.playerId, c.name), detail: candidateDetail(v, c) });
}

const OPEN_GROUPS = new Set(['open', 'open_requires_clearing', 'creates_shortfall', 'role_concern', 'context_dependent', 'evaluation_incomplete', 'indeterminate']);

function candidatesOf(v: ViewContext, packet: ResponsePacket): MlbCandidates {
  const mode = packet.direction;
  const columns = [
    column('player', 'Player'), column('age', 'Age', true), column('response', 'Response'),
    ...(mode === 'replace' ? [column('against', 'Against him')] : mode === 'complement' ? [column('against', 'Against the weak hand')] : []),
    column('development', 'Development'), column('transaction', 'Transaction'), column('fit', 'MLB fit'), column('organization', 'Organization'),
  ];
  const count = packet.groups.reduce((n, g) => n + g.candidates.length, 0);
  return {
    title: cell('Every candidate, with the evidence behind each verdict'),
    count,
    groups: packet.groups.filter((g) => g.candidates.length).map((g) => ({
      title: cell(g.label.trim() || codeWords(g.group)),
      collapsed: !OPEN_GROUPS.has(g.group),
      table: { columns, rows: g.candidates.map((c, i) => candidateRow(v, c, mode, i)), empty: null },
    })),
    notConsidered: packet.notConsidered.filter((x) => x.reason.trim()).map((x) => cell(`Not considered (${x.count}): ${x.reason.trim()}`)),
    empty: count ? null : cell('No player in the organization was found who could take this role.'),
  };
}

// ── the roster mechanics ─────────────────────────────────────────────────────

function constraintOf(v: ViewContext, k: ConstraintClearing): MlbConstraint {
  const flags: Cell[] = [];
  if (k.feasibility === 'unresolved_only') flags.push(cell('Every way to clear this is one Player Rights can\'t establish yet.', { tone: 'unknown' }));
  if (k.feasibility === 'none') flags.push(cell('No player can be moved to clear this.', { tone: 'bad' }));
  const count = `${k.count ?? 'not known'} of ${k.limit ?? 'not known'}`;
  return {
    title: cell(k.state === 'clearing_needed'
      ? `${k.constraint === 'active_roster' ? 'Every way to clear an active-roster spot' : 'Every way to clear a 40-man spot'} · ${k.label}: ${count}`
      : `${k.label}: ${count}`),
    note: cell(k.note.trim() || k.label),
    flags,
    classes: k.state !== 'clearing_needed' ? [] : k.classes.map((c) => ({
      title: cell(`${c.label} (${c.options.length})`),
      description: cell(c.description.trim() || c.label),
      collapsed: !(c.class === 'routine' || c.class === 'higher_cost'),
      options: c.options.map((o) => {
        const opens = [o.rosterEffect.activeSpot === 'opens' ? 'an active spot' : '', o.rosterEffect.fortyManSpot === 'opens' ? 'a 40-man spot' : ''].filter(Boolean).join(' and ') || 'nothing';
        const lines: MlbLine[] = [
          ...o.rights.reasons.filter((r) => r.message.trim()).map((r) => line(`${r.message.trim()} (${labelOf(BASIS, r.basis)})`, { quiet: true })),
          ...o.rights.missing.filter((m) => m.message.trim()).map((m) => line(`Missing: ${m.message.trim()}`, { quiet: true })),
          line(`Opens: ${opens}.`),
        ];
        if (o.roleEffect) {
          lines.push(line(`${o.roleEffect.role}: ${o.roleEffect.availableAfter} available against a minimum of ${o.roleEffect.floor}${o.roleEffect.belowFloor ? ', below it' : ''}.`, { tone: o.roleEffect.belowFloor ? 'bad' : undefined }));
        }
        lines.push(...linesOf(o.costs, false));
        if (o.farm) lines.push(line('Minor-league effect', { quiet: true }), ...farmLines(v, o.farm));
        if (o.facts.length) lines.push(line(o.facts.filter((f) => f.label.trim() && f.value.trim()).map((f) => `${f.label.trim()}: ${f.value.trim()}`).join(' · ') || 'No contract facts', { quiet: true }));
        return block(null, lines, {
          player: player(v, o.playerId, o.name),
          chips: [cell(o.role?.label ?? 'Role not known', o.role ? {} : { tone: 'unknown' }), rightsChip(o.rights.status, o.rights.label)],
        });
      }),
    })),
  };
}

function mechanicsOf(v: ViewContext, packet: ResponsePacket, hasCandidates: boolean): MlbMechanics | null {
  const c = packet.clearing;
  if (!c) return null;
  if (packet.direction === 'clear') {
    const blocks: MlbBlock[] = [];
    if (c.activation) {
      const a = c.activation;
      blocks.push(block('Bringing him back', [
        ...a.requirements.filter((q) => q.message.trim()).map((q) => line(q.status === 'unmet' ? `Requires: ${q.message.trim()}` : q.message.trim(), { quiet: q.status !== 'unmet' })),
        ...a.missing.filter((m) => m.message.trim()).map((m) => line(m.message, { quiet: true, tone: 'unknown' })),
        ...(a.limitation?.trim() ? [line(a.limitation, { quiet: true })] : []),
      ], { chips: [rightsChip(a.status, a.label)] }));
    }
    const chain = chainLines(c.chain);
    if (c.chainStatus) chain.unshift(line('Only as certain as its least certain link.', { quiet: true, chips: [chip(`Whole path: ${labelOf(PATH, c.chainStatus)}`, PATH_TONE[c.chainStatus] ?? 'unknown')] }));
    if (chain.length) blocks.push(block('The path', chain));
    if (c.note.trim()) blocks.push(block(null, [line(c.note, { quiet: true })]));
    return {
      title: cell(`The full path for ${c.returning?.name ?? 'him'}, and every option`),
      blocks,
      constraints: c.constraints.map((k) => constraintOf(v, k)),
    };
  }
  if (hasCandidates && c.constraints.some((k) => k.state === 'clearing_needed')) {
    return { title: cell('Every way to clear a roster spot'), blocks: [], constraints: c.constraints.map((k) => constraintOf(v, k)) };
  }
  return null;
}

// ── the decision ─────────────────────────────────────────────────────────────

/** A need's decision, worded from its response packet, for the choices the GM made (`ask`). */
export function decisionView(v: ViewContext, packet: ResponsePacket, ask: DecisionAsk): MlbDecisionView {
  const n = packet.need;
  const r = packet.report;
  const scenario = n.origin === 'hypothetical';
  const neutral = n.explanation?.neutralSeverity ?? n.severity;
  const hasCandidates = packet.direction === 'fill' || packet.direction === 'replace' || packet.direction === 'complement';
  const plans = packet.plans ?? [];
  const lineupOnly = plans.length > 0 && plans.every((p) => p.id === 'platoon' || p.id === 'shift' || p.id === 'lineup_change');
  const kicker = `${labelOf(KIND_LABEL, n.kind)}${n.role ? ` · ${n.role.label}` : ''}`;
  // The packet's unknowns the problem's own lines don't already say (React showed both; one is enough)
  const unknownsShown = (n.explanation ? packet.unknowns.slice(0, 1) : packet.unknowns).filter((u) => !n.unknowns.includes(u));

  const headline = claim({
    text: (r?.headline ?? n.title).trim() || kicker,
    tone: 'neutral',
    links: [],
    basis: basis({
      because: [
        ...n.facts.filter((f) => f.label.trim() && f.value.trim()).map((f) => ({ label: f.label.trim(), value: f.value.trim() })),
        { label: 'When', value: n.urgency.label.trim() || horizonText(n) },
        ...because('The situation', r?.situation ?? []),
      ],
      source: sourceOf(v.ctx, RESPONSES),
      unknown: sentences([...n.unknowns, ...packet.unknowns]),
      wouldChange: sentences(n.explanation?.wouldChange ?? []),
      lean: null,
      certainty: n.kind === 'open_active_spot' || n.kind === 'il_return_crunch' ? 'fact' : reviewCertainty(v.overview).certainty,
      ...(n.kind === 'open_active_spot' || n.kind === 'il_return_crunch' ? {} : { stamp: reviewCertainty(v.overview).stamp }),
    }),
  });

  const duration: MlbChoices | null = scenario
    ? {
      title: cell('How long would he be out?'),
      note: null,
      choices: DURATIONS.map(([days, text]) => ({ text: cell(text), selected: (ask.days ?? null) === days, query: query(ask, { days }) })),
    }
    : null;

  const assignment: MlbChoices | null = packet.assignment
    ? {
      title: cell(`Player Development is judging: ${packet.assignment.label.trim().toLowerCase() || 'the assignment'}`),
      note: cell(`${packet.assignment.explanation.trim()} A temporary assignment can be defensible where a durable role is not. Pennant does not assume how long a player would be needed: where the answer depends on it, it says so. What is defensible is Player Development's call, not this page's.`.trim()),
      choices: [
        ...(packet.assignment.basis !== 'derived_from_horizon' || packet.assignment.context === null
          ? [{ text: cell('Duration unknown: judge both'), selected: packet.assignment.basis === 'duration_unknown', query: query(ask, { context: undefined }) }]
          : []),
        ...packet.assignment.choices.map((c) => ({ text: cell(c.label.trim() || codeWords(c.context)), selected: packet.assignment?.context === c.context, query: query(ask, { context: c.context }) })),
      ],
    }
    : null;

  const responses: MlbResponses | null = plans.length || (r && r.pathways.length)
    ? {
      title: cell(plans.length ? (lineupOnly ? 'The lineup options, followed through' : 'Ways to respond, followed through') : 'Pathways'),
      order: r?.orderingNote.trim() ? cell(r.orderingNote.trim()) : null,
      plans: [...plans.map(planOf), ...(r?.pathways ?? []).map((p) => pathwayOf(v, p))],
    }
    : null;

  const roleChoice: MlbChoices | null = packet.direction === 'role_needed'
    ? {
      title: cell('Which role should Pennant explore for the open spot?'),
      note: null,
      choices: ROLE_CHOICES.map(([role, text]) => ({ text: cell(text), selected: ask.role === role, query: query(ask, { role }) })),
    }
    : null;

  const read: MlbBlock | null = r
    ? block('The staff read', [line(r.read.text.trim() || r.headline), ...sentences(r.read.caveats).map((c) => line(c, { quiet: true }))], {
      chips: r.read.verdict ? [chip(labelOf(VERDICT_TEXT, r.read.verdict), VERDICT_TONE[r.read.verdict] ?? 'unknown')] : [],
    })
    : null;

  const badges: Cell[] = [needBadge(n, neutral), cell(n.urgency.label.trim() || 'When not stated'), cell(horizonText(n))];

  return {
    ...head(v, 'Decision', {
      text: scenario ? 'A scenario you posed, followed through' : 'One need, opened: the problem, the staff\'s call, every way to respond',
      full: 'Pennant lists options and their consequences in the order a GM weighs them. It does not rank the players or make the move: that decision is yours.',
    }),
    needId: n.id,
    scenario,
    kicker: cell(kicker),
    headline,
    badges,
    notes: sentences(unknownsShown).map((u) => cell(u, { tone: 'unknown' })),
    duration,
    problem: problemBlock(v, n),
    why: whyOf(v, n),
    picture: r?.rolePicture ? pictureOf(v, r.rolePicture) : null,
    read,
    call: r?.recommendation ? callOf(v, r.recommendation) : null,
    assignment,
    responses,
    roleChoice,
    candidates: hasCandidates ? candidatesOf(v, packet) : null,
    mechanics: mechanicsOf(v, packet, hasCandidates),
    footnote: cell(`Pennant lists options and their consequences. It does not rank them or make the move: that decision is yours as GM.${scenario ? ' This is a scenario you posed, not a current problem.' : ''}`),
  };
}

/** The tone a need's badge takes, for tests that read it. */
export const badgeTone = (n: MlbNeed): Tone => needBadge(n, n.explanation?.neutralSeverity ?? n.severity).tone ?? 'neutral';
