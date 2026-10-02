/**
 * Farm & Development ▸ Decision (N10; React's Decision view): one player's assignment in the order a GM decides. Why
 * it is being reviewed; what Player Development says; what else is defensible and what the club prefers among it; what
 * he is getting where he is; what follows if he moves (Minor League Operations' cascade, a chain of steps that stops);
 * whether he still has an organizational case; what is uncertain; and what remains the GM's. Nothing on it is a
 * transaction, and an unresolved hole is information, never a refusal (D-045).
 */
import type { FarmConsequenceV2 } from '../../farmConsequence.js';
import type { FarmSystemView } from '../../farmOperations.js';
import type { ConflictTiming, GoneHolder, WorkShare } from '../../playingTime.js';
import type { Tenure } from '../../farmRecentUsage.js';
import { cell, claim, row } from '../claim.js';
import { decisionTarget, evidenceRow, factRow, headOf, judgmentBasis, linesCalled, playerLine, policyCalled, sentenceCell, sentenceCells } from './common.js';
import type { FarmContext } from './input.js';
import type { FarmAlternativeRow, FarmCascadeStepView, FarmCascadeView, FarmConsequenceView, FarmDecisionView, FarmRetentionView, FarmWorkRow } from './types.js';
import {
  LEAN, MINOR_LEAGUE_OPS, OUTLOOK, PLAYER_DEVELOPMENT, PRESSURE, RETENTION_CONCLUSION, TIER, TIMING, conclusionWord, jobWords, judgmentWord,
  moveWord, ordinal, plain, plainAll, plural, preferenceWord, standingWord, statusWord, stopWord, tierWord, verdictWord, windowWord, workWord,
} from './words.js';

type Review = FarmSystemView['assignments'][number];
type Retention = FarmSystemView['retention'][number];

const games = (n: number): string => plural(n, 'game');

/** "joined 4 games ago", for a man who arrived inside the recent window. */
const tenureTag = (tenure: Tenure | null): string | null =>
  tenure?.status === 'recent_arrival' ? `joined ${tenure.clubGamesSince === 0 ? 'after the last game' : `${games(tenure.clubGamesSince ?? 0)} ago`}` : null;

const share = (x: number | null): string => (x === null ? 'Not known' : `${Math.round(x * 100)}%`);

const EVIDENCE_WORDS: Record<string, string> = {
  thin: 'too few games to establish his role',
  none: 'no game can be counted for him yet',
};
const LEVEL_FROM: Record<string, string> = {
  recent: 'from the club\'s recent games',
  season: 'from the season to date',
  current_state: 'from OOTP\'s projected rotation',
};

/** One man's work read three ways and kept apart: the season, the recent games, and the reading that follows (D-048). */
function workRows(work: WorkShare, timing: ConflictTiming | null): FarmWorkRow[] {
  const season = workWord(work.season.level);
  const rows: FarmWorkRow[] = [
    row(
      'work:season',
      { read: cell('Season'), level: cell(`${season.text} · ${share(work.season.share)}`, { tone: season.tone }), why: cell(plain(work.season.basis) || 'The season to date') },
      { read: 0, level: work.season.share, why: null },
    ),
  ];
  if (work.recent) {
    const recent = workWord(work.recent.level);
    const arrived = tenureTag(work.tenure);
    const thin = EVIDENCE_WORDS[work.recent.evidence];
    const basisText = [
      plain(work.recent.basis),
      thin ? `${work.recent.games} of the last ${work.recent.windowGames} counted: ${thin}.` : '',
      arrived ? `He ${arrived}${work.tenure?.from ? `, from ${work.tenure.from}` : ''}.` : '',
    ].filter(Boolean).join(' ');
    rows.push(row(
      'work:recent',
      { read: cell('Recent'), level: cell(`${recent.text} · ${share(work.recent.share)}`, { tone: recent.tone }), why: cell(basisText || 'The club\'s recent games') },
      { read: 1, level: work.recent.share, why: null },
    ));
  }
  const now = workWord(work.level);
  const nowBasis = [
    `Read ${LEVEL_FROM[work.levelFrom] ?? 'from what there is'}${work.disagrees ? '; the season and the recent games disagree, and both are shown.' : '.'}`,
    timing && TIMING[timing] ? `The competition at his job: ${TIMING[timing]}.` : '',
  ].filter(Boolean).join(' ');
  rows.push(row('work:now', { read: cell('Now'), level: cell(now.text, { tone: now.tone }), why: cell(nowBasis) }, { read: 2, level: work.share, why: null }));
  return rows;
}

/** The men with work at a job who are not competing for it now: history, said as history. */
function goneLine(gone: readonly GoneHolder[]): string | null {
  const worth = gone.filter((g) => g.material || g.windowStarts > 0 || (g.seasonShare ?? 0) >= 0.15);
  if (!worth.length) return null;
  const one = (g: GoneHolder): string => {
    const where = g.why === 'departed' ? `now at ${g.nowAt ?? 'another club'}` : g.why === 'inactive' ? 'off the active list' : g.why === 'rehab' ? 'on a rehab assignment' : 'injured';
    const held = g.seasonShare !== null && g.seasonShare > 0 ? `${Math.round(g.seasonShare * 100)}% of the season's work here` : 'work here this season';
    const last = g.lastStartGamesAgo !== null ? `, last started there ${games(g.lastStartGamesAgo)} ago` : '';
    return `${g.name} (${where}; ${held}${last})`;
  };
  return `No longer competing for it: ${worth.map(one).join('; ')}. Their work here is history, not competition.`;
}

function cascadeView(ctx: FarmContext, cascade: NonNullable<FarmConsequenceV2['cascade']>): FarmCascadeView {
  const steps: FarmCascadeStepView[] = cascade.steps.map((s) => {
    const judgment = s.usable ? { text: 'Defensible', tone: 'good' as const } : judgmentWord(s.development.judgment);
    const preference = preferenceWord(s.preference);
    const job = jobWords(s.vacancy.job);
    return {
      index: s.index,
      judgment: cell(judgment.text, { tone: judgment.tone }),
      vacancy: cell(`${s.vacancy.team} needs ${job} (${s.vacancy.after} of ${s.vacancy.floor})`),
      candidate: s.candidate
        ? playerLine(s.candidate.playerId, s.candidate.name, `${s.candidate.name} (${s.candidate.age}, ${s.candidate.fromLevelName} ${s.candidate.fromTeam})`)
        : null,
      noCandidate: s.candidate
        ? null
        : cell(s.development.judgment === 'not_evaluated' && s.uncertainty.length > 0 ? 'Nobody below could be judged for it.' : 'Nobody below is a defensible replacement.', { tone: 'neutral' }),
      // Philosophy's preference only beside a defensible step: it orders defensible choices and nothing else (D-019)
      preference: preference && s.usable ? cell(preference) : null,
      alternatives: s.alternatives.length
        ? cell(`As defensible: ${s.alternatives.map((a) => `${a.name} (${a.age}, ${a.fromTeam}${a.preference ? `, ${(preferenceWord(a.preference) ?? '').toLowerCase()}` : ''})`).join('; ')}. The chain follows the first in readiness order; which to use is your decision.`)
        : null,
      consequences: sentenceCells([s.consequence.destination, s.consequence.source, s.consequence.destinationOpportunity]),
      notes: sentenceCells([
        ...(s.development.blockers.length ? [`Player Development: ${s.development.blockers.join(' ')}`] : []),
        ...s.development.missingEvidence.map((m) => m.detail),
        ...s.uncertainty,
        ...(s.preferenceBasis ? [s.preferenceBasis] : []),
      ]),
    };
  });
  const stop = stopWord(cascade.stop);
  return {
    steps,
    noSteps: steps.length ? null : cell(`No move follows: ${plain(cascade.stopDetail)}`),
    // Where the chain stops and why; its basis is the steps followed and what the chain leaves open
    stop: claim({
      text: `${stop.text}. ${plain(cascade.stopDetail)}`.replace(/\.\s*\./g, '.').trim(),
      tone: cascade.unresolved.length === 0 ? stop.tone : 'neutral',
      basis: judgmentBasis(
        ctx,
        MINOR_LEAGUE_OPS,
        {
          because: [
            { label: 'Where it stops', value: stop.text },
            { label: 'Steps followed', value: String(cascade.steps.length) },
            ...cascade.unresolved.map((u) => ({ label: 'Left open', value: plain(`${u.team} at ${u.job}: ${u.detail}`) })),
          ],
          unknown: cascade.certainty === 'indeterminate' ? ['One step can\'t be judged, so the chain is only as certain as that step.'] : [],
          called: policyCalled('Each step defensible on its own, or the chain stops there'),
        },
      ),
    }),
    unresolved: cascade.unresolved.map((u) => cell(plain(`${u.team} at ${u.job}: ${u.detail}`))),
    unresolvedNote: cascade.unresolved.length
      ? cell('A hole the chain leaves open is information, not an illegality: it doesn\'t make a major-league move impossible.')
      : null,
    howSure: cascade.certainty === 'indeterminate' ? cell('The chain is only as certain as its least certain step, and one step can\'t be judged.', { tone: 'unknown' }) : null,
  };
}

/** What follows if he moves, worded; the cascade's basis takes this build's source. */
export function consequenceView(ctx: FarmContext, c: FarmConsequenceV2): FarmConsequenceView {
  const impact = c.affiliateImpact;
  const before = impact ? statusWord(impact.statusBefore) : null;
  const after = impact ? statusWord(impact.statusAfter) : null;
  const club = c.sourceAffiliate?.label ?? 'His club';
  const cascade = c.cascade ? cascadeView(ctx, c.cascade) : null;
  return {
    summary: claim({
      text: plain(c.summary) || 'What follows could not be read.',
      tone: c.confidence === 'established' ? 'neutral' : 'unknown',
      basis: judgmentBasis(ctx, MINOR_LEAGUE_OPS, {
        because: [
          { label: 'How sure', value: c.confidence === 'established' ? 'Established' : c.confidence === 'indeterminate' ? 'Can\'t be judged yet' : 'Can\'t be established' },
          ...(c.lostRole ? [{ label: 'The job he leaves', value: plain(c.lostRole) }] : []),
          ...(c.currentOpportunity ? [{ label: 'What he holds now', value: plain(c.currentOpportunity.detail) }] : []),
        ],
        unknown: c.unresolvedIssues,
        called: policyCalled('Minor League Operations\' consequence of a departure'),
      }),
    }),
    impact: impact
      ? [
        factRow('impact:now', `${club} now`, `${before!.text}: ${impact.before}`, { tone: before!.tone }),
        factRow('impact:after', 'Without him', `${after!.text}: ${impact.after}${impact.findingsAfter.length ? `. ${impact.findingsAfter.join(' ')}` : ''}`.replace(/\.\./g, '.'), { tone: after!.tone }),
        factRow('impact:job', 'The job he leaves', `${c.lostRole ?? 'Not known'} · ${impact.absorbed ? 'can be absorbed' : 'leaves a hole'}`, { tone: impact.absorbed ? 'good' : 'caution' }),
      ]
      : [],
    playingTime: sentenceCells(c.playingTimeImpact.map((p) => p.effect)),
    replacements: c.replacementOptions.map((r) => {
      const j = judgmentWord(r.judgment);
      const pref = preferenceWord(r.preference);
      return { playerId: r.playerId, name: r.name, judgment: cell(j.text, { tone: j.tone }), from: cell(plain(r.from) || 'Not known'), preference: pref ? cell(pref) : null, open: decisionTarget(r.playerId) };
    }),
    cascade,
    measured: sentenceCells(c.evidence),
  };
}

function retentionView(r: Retention): FarmRetentionView {
  const outlook = OUTLOOK[r.outlook.state] ?? { text: plain(r.outlook.state), tone: 'neutral' as const };
  const pressure = PRESSURE[r.pressure.state] ?? { text: plain(r.pressure.state), tone: 'neutral' as const };
  const lean = LEAN[r.stance.lean] ?? plain(r.stance.lean);
  const stanceText = [
    ...r.stance.reasons.map((x) => `${plain(x.dimension)} at ${x.value}: ${plain(x.effect)}`),
    `A club with no stated philosophy would hear: ${RETENTION_CONCLUSION[r.stance.neutralWouldSay] ?? plain(r.stance.neutralWouldSay)}.`,
  ].join(' ');
  return {
    note: cell('Three questions with three owners, never one score.'),
    rows: [
      evidenceRow('retention:outlook', 'Developmental outlook', outlook.text, `${plainAll(r.outlook.reasons).join(' ')} Player Development.`.trim(), { tone: outlook.tone }),
      evidenceRow('retention:pressure', 'Who needs his spot', pressure.text, `${plainAll(r.pressure.reasons).join(' ')} Minor League Operations.`.trim(), { tone: pressure.tone }),
      evidenceRow('retention:stance', 'The club\'s lean', lean, stanceText),
    ],
    guardrails: r.guardrails.map((g) => cell(`${plain(g.owner)}: ${plain(g.detail)}`)),
  };
}

/** One player's Decision; the consequence is worded from what the build or the click read (a problem is said, not hidden). */
export function decisionView(
  ctx: FarmContext,
  system: FarmSystemView,
  review: Review,
  consequence: FarmConsequenceV2 | { problem: string } | null,
): FarmDecisionView {
  const called = linesCalled(system.calibration);
  const retention = system.retention.find((r) => r.playerId === review.playerId);
  const conclusion = conclusionWord(review.conclusion);
  const verdict = verdictWord(review.current.verdict);
  const tier = tierWord(review.protection.tier);
  const p = review.production;
  const op = review.opportunity;

  const results = [
    factRow('results:league', `Against the ${p.leagueName}`, p.percentile !== null ? `${ordinal(p.percentile)} of 100` : plain(p.unassessableDetail ?? '') || 'Not established', {
      tone: p.percentile === null ? 'unknown' : undefined,
      hint: p.percentile !== null ? 'Park-adjusted, against his own league: 50th is the middle' : undefined,
    }, p.percentile),
    factRow('results:sample', 'Sample', `${Math.round(p.sample.opportunities)} ${review.kind === 'pitcher' ? 'innings' : 'plate appearances'} over ${games(p.sample.clubGames)} of his club's; ${Math.round(p.sample.reliability * 100)}% trusted`),
    ...(p.rates.woba !== null ? [factRow('results:woba', 'wOBA', `${p.rates.woba.toFixed(3)} against the league's ${p.leagueContext.woba.toFixed(3)}`)] : []),
    ...(p.rates.era !== null ? [factRow('results:era', 'ERA', `${p.rates.era.toFixed(2)} against the league's ${p.leagueContext.era.toFixed(2)}`)] : []),
  ];

  const alternatives: FarmAlternativeRow[] = review.alternatives.map((alt, i) => {
    const j = judgmentWord(alt.judgment);
    const pref = preferenceWord(alt.preference);
    return {
      ...row(
        `alternative:${i}`,
        {
          assignment: cell(`${moveWord(alt.kind)} to ${alt.levelName}`),
          development: cell(j.text, { tone: j.tone }),
          philosophy: pref ? cell(pref) : cell('No preference: not defensible', { tone: 'neutral' }),
          play: cell(plain(alt.destinationOpportunity?.detail ?? '') || 'Not established', alt.destinationOpportunity ? {} : { tone: 'unknown' }),
        },
        { assignment: alt.level, development: alt.judgment, philosophy: alt.preference, play: alt.destinationOpportunity ? (alt.destinationOpportunity.open ? 0 : 1) : null },
      ),
      notes: sentenceCells([...alt.blockers, ...alt.missingEvidence.map((m) => m.detail)]),
    };
  });
  const unassessable = p.unassessableDetail ? plain(p.unassessableDetail) : null;

  // The men ahead of him are named once, below; his own basis and the season's are in the work rows, not said twice
  const opportunityText = op.reasons.filter((r) => !/ahead of him at/.test(r) && r !== op.work?.basis && !/^Over the season:/.test(r)).map(plain).join(' ');
  const ahead = op.ahead.length
    ? `Ahead of him at ${jobWords(op.job)}: ${op.ahead.map((a) => {
      const notes = [String(a.age), workWord(a.level).text.toLowerCase(), a.claimant ? null : 'covering it from another position', tenureTag(a.tenure)].filter(Boolean);
      return `${a.name} (${notes.join(', ')})`;
    }).join('; ')}.${op.ahead.some((a) => a.level === 'regular') ? ' A regular there holds the job.' : ' Nobody is regular there: the job is split, not held.'}`
    : null;

  let consequenceCard: FarmConsequenceView | null = null;
  let consequenceProblem = null;
  if (consequence && 'problem' in consequence) consequenceProblem = cell(consequence.problem, { tone: 'unknown' });
  else if (consequence) consequenceCard = consequenceView(ctx, consequence);
  else consequenceProblem = cell('What follows if he moves is being worked out.', { tone: 'unknown' });

  const uncertain = plainAll([...review.missing, ...review.current.unknowns]);
  return {
    ...headOf(ctx),
    playerId: review.playerId,
    teamId: review.teamId,
    name: review.name,
    line: cell(`${review.age}, ${review.kind === 'pitcher' ? 'pitcher' : 'position player'} · ${review.levelName} · ${review.team} · ${review.leagueName}`),
    conclusion: claim({
      text: conclusion.text,
      tone: conclusion.tone,
      basis: judgmentBasis(ctx, MINOR_LEAGUE_OPS, {
        because: review.reasons.map((r, i) => ({ label: i === 0 ? 'Why' : 'And', value: plain(r) })),
        unknown: review.missing,
        wouldChange: review.wouldResolve,
        called,
      }),
      links: [decisionTarget(review.playerId)],
    }),
    stakes: claim({
      text: review.protection.tier ? `Developmental stakes: ${tier}` : 'Developmental stakes not known',
      tone: review.protection.tier ? 'neutral' : 'unknown',
      hint: 'How careful to be with his development; never where he plays',
      basis: judgmentBasis(ctx, PLAYER_DEVELOPMENT, {
        because: plainAll(review.protection.reasons).map((r, i) => ({ label: i === 0 ? 'Why' : 'And', value: r })),
        unknown: review.protection.missingEvidence.map((m) => m.detail),
        called: policyCalled('Player Development\'s stakes (D-050): a ceiling, lowered by how much development is left'),
      }),
    }),
    stakesReasons: sentenceCells(review.protection.reasons),
    why: sentenceCells(review.reasons),
    verdict: claim({
      text: `${verdict.text}: his results are ${standingWord(review.current.standing)}, and he is ${windowWord(review.current.window)}.`,
      tone: verdict.tone,
      hint: 'The same answer at every club: no philosophy enters it',
      basis: judgmentBasis(ctx, PLAYER_DEVELOPMENT, {
        because: review.current.parts.map((x) => ({ label: plain(x.label), value: plain(`${x.value}${x.basis ? ` (${x.basis})` : ''}`) })),
        unknown: [...review.current.unknowns, ...review.current.missingEvidence.map((m) => m.detail)],
        called,
      }),
    }),
    verdictParts: review.current.parts.map((x, i) => evidenceRow(`part:${i}`, x.label, tierLabel(x.value), x.basis)),
    results,
    alternativesNote: cell('Philosophy orders only what is defensible. A move the club leans against is exactly as defensible as one it prefers.'),
    alternatives,
    alternativesEmpty: alternatives.length
      ? null
      : cell(unassessable
        ? `Player Development hasn't looked at another assignment for him: ${unassessable.charAt(0).toLowerCase()}${unassessable.slice(1)} An assignment can't be judged without a line at his current level to judge it against.`
        : 'No other assignment was looked at: the organization has no other level to move him to.'),
    opportunityNote: cell('What he is actually doing now, with the season beside it.'),
    opportunity: sentenceCell(opportunityText),
    work: op.work ? workRows(op.work, op.timing) : [],
    workMissing: op.work ? null : sentenceCell(op.unknowns[0] ?? 'His work at his job can\'t be read yet.', { tone: 'unknown' }),
    roleChange: review.roleChange ? cell(`His role has changed: ${plain(review.roleChange.detail)}`) : null,
    ahead: ahead ? cell(plain(ahead)) : null,
    aheadPlayers: op.ahead.map((a) => playerLine(a.playerId, a.name, `${a.name}, ${a.age}: ${workWord(a.level).text.toLowerCase()}`)),
    gone: sentenceCell(goneLine(op.gone)),
    consequenceNote: cell('Minor League Operations follows the chain; each step is defensible on its own or the chain stops there.'),
    consequence: consequenceCard,
    consequenceProblem,
    retention: retention && retention.conclusion !== 'retain' ? retentionView(retention) : null,
    uncertain: uncertain.map((u) => cell(u)),
    uncertainEmpty: uncertain.length ? null : cell('Nothing this reading needs is missing.'),
    wouldSettle: sentenceCells(review.wouldResolve),
    yours: sentenceCells(review.gmDecision),
    owners: review.ownership.map((o, i) => evidenceRow(`owner:${i}`, o.question, o.owner, o.answer)),
  };
}

/** A part's value in the GM's words (a tier's code reads as its name). */
const tierLabel = (value: string): string => TIER[value] ?? value;
