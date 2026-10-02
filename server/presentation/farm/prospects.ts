/**
 * Farm & Development ▸ Prospects (N10; React's Player Development page, `Prospects.tsx`): Player Development's calls on
 * the organization's minor leaguers, the development meetings it raises, and the board of every one of them.
 *
 * No hidden score orders anything (D-044): React sorted the board by the internal readiness score; here the board is
 * in the roster's stated order (level, then name) and every column sorts by a served key the GM chooses, while the
 * evidence scores appear only in a player's breakdown. The meetings are the calls Player Development raised, as served.
 * The developmental stakes are not on this view (React never showed them here either).
 */
import type { ScoutedDevelopmentPlayer } from '../../scoutedDevelopment.js';
import { cell, claim, row, servedValue, unknownValue } from '../claim.js';
import { decisionTarget, factBasis, factRow, headOf, judgmentBasis, policyCalled, sentenceCells } from './common.js';
import type { FarmContext, ProspectEvaluationInput, ProspectInput } from './input.js';
import type { FarmEvaluationRow, FarmFilter, FarmNextAssignment, FarmProspectCard, FarmProspectRow, FarmProspectsView } from './types.js';
import {
  CALL_ORDER, EVALUATION, MEETING_CALLS, PLAYER_DEVELOPMENT, callWord, fitWord, moveWord, paceWords, plain, plainAll, plural, preferenceWord,
  ratingPair, roleWords, type RatingDisplay,
} from './words.js';

const CALLED = policyCalled('Player Development\'s prospect model: performance sets readiness, age the urgency, the club\'s philosophy the bar for a promotion');

/** His season at his level, as the Prospects page put it: "62.1 IP · 3.48 ERA · 24.3% K", "212 PA · .812 OPS · 9 HR". */
function seasonLine(p: ProspectInput): string {
  if (p.ip !== null && p.ip !== undefined) {
    return [`${p.ip.toFixed(1)} IP`, p.era != null ? `${p.era.toFixed(2)} ERA` : null, p.kpct != null ? `${p.kpct.toFixed(1)}% K` : null].filter(Boolean).join(' · ');
  }
  return [p.pa != null ? `${p.pa} PA` : null, p.opsVal != null ? `${p.opsVal.toFixed(3).replace(/^0/, '')} OPS` : null, p.hr != null ? `${p.hr} HR` : null].filter(Boolean).join(' · ');
}

/** "Double-A → Triple-A", "Double-A · stay" or "Double-A · not settled": the nearest defensible move, in the engine's order. */
function queueLine(player: ScoutedDevelopmentPlayer, p: ProspectInput | null): string {
  if (!p) return player.levelName;
  const first = p.assignments.eligible[0];
  if (!first) return p.assignments.indeterminate.length > 0 ? `${player.levelName} · not settled` : `${player.levelName} · stay`;
  return `${player.levelName} → ${first.target.levelName}`;
}

function nextAssignments(p: ProspectInput): FarmNextAssignment[] {
  return p.assignments.eligible.map((e) => {
    const fits = e.destinationFit?.teams ?? [];
    const eligibleIds = new Set(e.destinationFit?.eligibleTeamIds ?? []);
    const named = fits.filter((t) => eligibleIds.has(t.fit.destinationTeamId));
    const destinations = named.length
      ? named.map((t) => cell(`${t.fit.destinationTeam} · ${fitWord(t.fit.classification)}`))
      : e.target.teams.map((t) => cell(t.label));
    return { move: cell(`${moveWord(e.kind)} to ${e.target.levelName}`), destinations };
  });
}

function evaluationRows(p: ProspectInput): FarmEvaluationRow[] {
  return p.assignments.evaluations.map((e: ProspectEvaluationInput, i) => {
    const j = EVALUATION[e.judgment] ?? { text: plain(e.judgment), tone: 'neutral' as const };
    const pref = preferenceWord(e.preference);
    return {
      ...row(
        `evaluation:${p.player_id}:${i}`,
        {
          move: cell(`${moveWord(e.kind)} to ${e.target.levelName}`),
          judgment: cell(j.text, { tone: j.tone }),
          philosophy: pref ? cell(pref) : cell('No preference', { tone: 'neutral' }),
        },
        { move: e.target.level, judgment: e.judgment, philosophy: e.preference },
      ),
      notes: sentenceCells([...e.missingEvidence.map((m) => m.detail), ...e.blockers]),
    };
  });
}

const score = (n: number | null): string => (n === null ? 'Not known' : String(Math.round(n)));

function card(ctx: FarmContext, player: ScoutedDevelopmentPlayer, p: ProspectInput, rating: RatingDisplay): FarmProspectCard {
  const call = callWord(p.decision.recommendation);
  const pace = paceWords(player.evidence.peerDevelopment.pace, player.evidence.peerDevelopment.percentile);
  const ratings = ratingPair(player.current, player.potential, rating);
  const mlb = p.decision.recommendation === 'mlb_ready_discussion';
  const next = nextAssignments(p);
  return {
    playerId: player.playerId,
    name: player.name,
    line: cell([String(player.age), roleWords(player.kind, player.role), player.levelName, player.team, player.transaction.onInjuredList ? 'Injured' : null].filter(Boolean).join(' · ')),
    queueLine: cell(queueLine(player, p), { hint: 'The nearest move Player Development finds defensible' }),
    call: claim({
      text: call.text,
      tone: call.tone,
      hint: call.means.length <= 75 ? call.means : undefined,
      basis: judgmentBasis(ctx, PLAYER_DEVELOPMENT, {
        because: [
          { label: 'What it means', value: call.means },
          ...plainAll(p.decision.positives).map((v) => ({ label: 'For', value: v })),
          ...plainAll(p.decision.cautions).map((v) => ({ label: 'Against', value: v })),
          { label: 'How sure', value: p.decision.confidence === 'high' ? 'High' : p.decision.confidence === 'moderate' ? 'Moderate' : 'Limited' },
        ],
        unknown: p.decision.missingEvidence.map((m) => m.detail),
        called: CALLED,
      }),
      links: [decisionTarget(player.playerId)],
    }),
    means: cell(call.means),
    facts: [
      factRow('fact:ratings', 'Scouted now → ceiling', ratings ?? 'Not seen', ratings ? {} : { tone: 'unknown', hint: 'Some of his ratings aren\'t visible to our scouts' }),
      factRow('fact:season', 'Season at this level', seasonLine(p) || 'Not known'),
      factRow('fact:pace', 'Development against his peers', pace.text, { tone: pace.tone }),
    ],
    supporting: sentenceCells(p.decision.positives),
    cautions: sentenceCells(p.decision.cautions),
    next,
    nextEmpty: next.length ? null : cell('No move up or down is supported by the evidence yet.'),
    placeTitle: cell(mlb ? 'A major-league opportunity to weigh' : 'A Minor League Operations question'),
    place: cell(mlb
      ? 'Player Development has raised him for discussion, but the roster need, the 40-man, his options and his service time are Major League Ops\' to weigh.'
      : 'Whether he can get the work where he is, who is ahead of him, and what follows if he moves are answered on his Decision, from the same Player Development judgment shown here.'),
    scoresNote: cell('Player Development\'s own 0 to 100 evidence scores, not OOTP ratings.'),
    scores: [
      factRow('score:readiness', 'Readiness', score(p.decision.evidence.readiness), p.decision.evidence.readiness === null ? { tone: 'unknown' } : {}, p.decision.evidence.readiness),
      factRow('score:performance', 'Results at the level', score(p.decision.evidence.performance), {}, p.decision.evidence.performance),
      factRow('score:maturity', 'How settled his ratings are', score(p.decision.evidence.ratingsMaturity), p.decision.evidence.ratingsMaturity === null ? { tone: 'unknown' } : {}, p.decision.evidence.ratingsMaturity),
      factRow('score:sample', 'How much he has played', score(p.decision.evidence.sampleConfidence), {}, p.decision.evidence.sampleConfidence),
    ],
    evaluations: evaluationRows(p),
    open: decisionTarget(player.playerId),
  };
}

export function prospectsView(
  ctx: FarmContext,
  players: readonly ScoutedDevelopmentPlayer[],
  prospects: readonly ProspectInput[],
  rating: RatingDisplay,
): FarmProspectsView {
  const byId = new Map(prospects.map((p) => [p.player_id, p]));
  const rows: FarmProspectRow[] = [];
  const meetings: FarmProspectCard[] = [];
  const counts: Record<string, number> = { attention: 0, eligible: 0, watch: 0, behind: 0, all: 0 };
  for (const player of players) {
    const p = byId.get(player.playerId) ?? null;
    const filters: string[] = [];
    if (p && MEETING_CALLS.has(p.decision.recommendation)) filters.push('attention');
    if (p && p.assignments.eligible.length > 0) filters.push('eligible');
    if (p && p.decision.recommendation === 'watch') filters.push('watch');
    if (player.evidence.peerDevelopment.pace === 'behind') filters.push('behind');
    for (const f of [...filters, 'all']) counts[f] += 1;
    const pace = paceWords(player.evidence.peerDevelopment.pace, player.evidence.peerDevelopment.percentile);
    const ratings = ratingPair(player.current, player.potential, rating);
    const call = p ? callWord(p.decision.recommendation) : null;
    rows.push({
      ...row(
        `prospect:${player.playerId}`,
        {
          player: cell(player.transaction.onInjuredList ? `${player.name} · injured` : player.name, player.transaction.onInjuredList ? { hint: 'On the injured list' } : {}),
          age: cell(String(player.age)),
          club: cell(`${player.levelName} · ${player.team}`),
          role: cell(roleWords(player.kind, player.role)),
          ratings: ratings ? cell(ratings) : cell('Not seen', { tone: 'unknown', hint: 'Some of his ratings aren\'t visible to our scouts' }),
          pace: cell(pace.text, { tone: pace.tone }),
          call: call
            ? cell(call.text, { tone: call.tone, hint: call.means.length <= 75 ? call.means : undefined })
            : cell('Not enough at this level yet', { tone: 'neutral', hint: 'Too few plate appearances or innings at his level for a call' }),
        },
        {
          player: player.name,
          age: player.age,
          club: `${String(player.level).padStart(2, '0')} ${player.team}`,
          role: roleWords(player.kind, player.role),
          ratings: player.current,
          pace: player.evidence.peerDevelopment.pace === 'insufficient' ? null : player.evidence.peerDevelopment.percentile,
          call: p ? CALL_ORDER[p.decision.recommendation] ?? null : null,
        },
      ),
      playerId: player.playerId,
      teamId: player.teamId,
      levelId: String(player.level),
      filters,
      open: decisionTarget(player.playerId),
    });
    if (p && MEETING_CALLS.has(p.decision.recommendation)) meetings.push(card(ctx, player, p, rating));
  }

  // Behind his peers needs a pace: the basis says how many on the board have none yet, and with none at all the count is
  // "Not yet", never zero (D-018)
  const noPace = players.filter((p) => p.evidence.peerDevelopment.pace === 'insufficient').length;
  const anyPace = noPace < players.length;
  const filter = (id: string, name: string): FarmFilter => ({
    id, name, count: counts[id], label: id === 'behind' && !anyPace ? `${name} · not yet` : `${name} · ${counts[id]}`,
  });
  const filters: FarmFilter[] = [
    filter('attention', 'Meetings'), filter('eligible', 'A move supported'), filter('watch', 'Watching'), filter('behind', 'Behind his peers'), filter('all', 'All'),
  ];
  const levels = [...new Map(players.map((p) => [p.level, p.levelName])).entries()].sort((a, b) => a[0] - b[0]).map(([id, name]) => ({ id: String(id), name }));
  const figure = (text: string, n: number, hint: string, because: string) => claim({
    text,
    tone: 'neutral',
    hint,
    value: servedValue(n, 'count', String(n)),
    basis: factBasis(ctx, PLAYER_DEVELOPMENT, [{ label: because, value: String(n) }, { label: 'Minor leaguers on the board', value: String(players.length) }]),
  });
  const behindFigure = claim({
    text: 'Behind their peers',
    tone: anyPace ? 'neutral' : 'unknown',
    hint: 'Our scouts\' read is moving slower than similar players\'',
    value: anyPace ? servedValue(counts.behind, 'count', String(counts.behind)) : unknownValue('count', 'Not yet'),
    basis: factBasis(ctx, PLAYER_DEVELOPMENT, [
      { label: 'Behind comparable minor leaguers', value: anyPace ? String(counts.behind) : 'Not yet' },
      { label: 'Minor leaguers on the board', value: String(players.length) },
      { label: 'No pace yet', value: String(noPace) },
    ], noPace ? [`${plural(noPace, 'player has', 'players have')} too little scouting history for a pace yet, so they can't be counted ahead or behind.`] : []),
  });
  return {
    ...headOf(ctx),
    summary: claim({
      text: 'Player Development asks what level each player\'s evidence supports. Whether to move him now is Minor League Operations\' question, on his Decision.',
      tone: 'neutral',
      basis: factBasis(ctx, PLAYER_DEVELOPMENT, [
        { label: 'Minor leaguers', value: String(players.length) },
        { label: 'With a call', value: String(prospects.length) },
      ], players.length > prospects.length ? [`${plural(players.length - prospects.length, 'player has', 'players have')} too little at their level for a call yet.`] : []),
    }),
    figures: [
      figure('Development meetings', counts.attention, 'A promotion, a lower level or a major-league discussion', 'Raised for a meeting'),
      figure('Players with a move supported', counts.eligible, 'A level up or down supported by the evidence now', 'With a defensible move'),
      behindFigure,
    ],
    guide: [
      factRow('guide:call', 'Player Development\'s call', 'What assignment his evidence supports now.'),
      factRow('guide:move', 'A move supported', 'A level or a club his evidence clears. It is not a transaction, and not one the staff is asking for.'),
      factRow('guide:ops', 'His Decision', 'Whether moving him now helps the organization: who takes his job, and what follows.'),
      factRow('guide:pace', 'Against his peers', 'How fast our scouts\' read of him is changing against similar players over the history there is. It is what we have seen, not what he truly is.'),
    ],
    meetingsNote: cell('Player Development\'s discussions, not transactions.'),
    meetings,
    meetingsEmpty: meetings.length ? null : cell('No development case needs a meeting.'),
    boardNote: cell('Players without enough at their level for a call stay on the board rather than disappearing.'),
    order: cell('By level, then by last name', { hint: 'The roster\'s own order; no score orders the board' }),
    filters,
    levels,
    rows,
    empty: cell('No players match this view.'),
    model: cell('Results set readiness, age the urgency, and the club\'s philosophy the bar for a promotion; scouting history says what our scouts have seen; Minor League Operations says whether a move is useful now.'),
    unknowns: [],
  };
}
