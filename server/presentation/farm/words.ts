/**
 * Farm & Development's words (N10): the label maps and word builders the React farm pages kept on the client
 * (`src/pages/farm/common.tsx`, the farm views, `Prospects.tsx`, `Development.tsx`), moved to the server so the Mac app
 * shows the same words and writes none (D-056). Each maps a specialist's code to the GM's words and a tone; none decides
 * anything. A code this build does not know reads as itself, never as another code's words.
 *
 * `plain()` is the one place the specialists' own sentences are put in the GM's words where they use an internal term
 * the plain-language rule keeps off the screen (AGENTS.md "Writing for the GM"): a phrase-for-phrase table, each with
 * its reason, never a weakened pattern in `tests/bannedJargon.ts`.
 */
import type { Tone } from '../../contract/presentation.js';

export const MINOR_LEAGUE_OPS = 'Minor League Operations';
export const PLAYER_DEVELOPMENT = 'Player Development';

/** A label and the tone it is drawn in. */
export interface Toned {
  text: string;
  tone: Tone;
}

const toned = (map: Record<string, Toned>, code: string | null | undefined, fallback: Toned): Toned =>
  (code !== null && code !== undefined ? map[code] : undefined) ?? (code ? { text: plain(code.replace(/_/g, ' ')), tone: fallback.tone } : fallback);

/** Can the club field a team (only a shortage is operational, D-045). */
export const STATUS: Record<string, Toned> = {
  critical: { text: 'Short', tone: 'bad' },
  thin: { text: 'Thin', tone: 'caution' },
  healthy: { text: 'Able', tone: 'good' },
};
export const statusWord = (code: string): Toned => toned(STATUS, code, { text: 'Not known', tone: 'unknown' });

/** A finding's severity, on the farm's own scale. */
export const SEVERITY: Record<string, Toned> = {
  critical: { text: 'Short', tone: 'bad' },
  attention: { text: 'Needs attention', tone: 'caution' },
  noted: { text: 'Noted', tone: 'neutral' },
};
export const severityWord = (code: string): Toned => toned(SEVERITY, code, { text: 'Noted', tone: 'neutral' });

/** What Player Development says about where a man is (D-044). */
export const VERDICT: Record<string, Toned> = {
  appropriate: { text: 'The level is developing him', tone: 'good' },
  too_advanced: { text: 'The level is ahead of him', tone: 'bad' },
  no_longer_developmental: { text: 'Nothing left to learn here', tone: 'caution' },
  indeterminate: { text: 'Can\'t be judged', tone: 'unknown' },
  not_assessable: { text: 'Nothing to read yet', tone: 'neutral' },
};
export const verdictWord = (code: string): Toned => toned(VERDICT, code, { text: 'Not known', tone: 'unknown' });

export const STANDING: Record<string, string> = {
  mastered: 'clearly better than the league',
  holding: 'holding his own',
  overmatched: 'clearly worse than the league',
  indeterminate: 'not established',
};
export const standingWord = (code: string): string => STANDING[code] ?? plain(code.replace(/_/g, ' '));

export const WINDOW: Record<string, string> = {
  ample: 'young for the level',
  normal: 'ordinary for the level',
  closing: 'old for the level',
  closed: 'past the developmental window',
  indeterminate: 'not established',
};
export const windowWord = (code: string): string => WINDOW[code] ?? plain(code.replace(/_/g, ' '));

/** The farm's conclusion about an assignment. */
export const CONCLUSION: Record<string, Toned> = {
  current_assignment_defensible: { text: 'Assignment defensible', tone: 'good' },
  promotion_direction_defensible: { text: 'Ready for more', tone: 'good' },
  demotion_direction_defensible: { text: 'Level too advanced', tone: 'bad' },
  opportunity_conflict: { text: 'Not getting the work', tone: 'bad' },
  organizational_blockage: { text: 'Blocked', tone: 'bad' },
  organizational_question: { text: 'Organizational question', tone: 'caution' },
  indeterminate: { text: 'Can\'t be judged', tone: 'unknown' },
  not_assessable: { text: 'Nothing to read yet', tone: 'neutral' },
};
export const conclusionWord = (code: string): Toned => toned(CONCLUSION, code, { text: 'Not known', tone: 'unknown' });

/** How much of a job a man holds. */
export const WORK: Record<string, Toned> = {
  regular: { text: 'Regular', tone: 'good' },
  part_time: { text: 'Sharing', tone: 'neutral' },
  occasional: { text: 'Occasional', tone: 'caution' },
  not_used: { text: 'Not playing', tone: 'bad' },
  bat_only: { text: 'Batting, not fielding', tone: 'caution' },
  unknown: { text: 'Not yet readable', tone: 'unknown' },
};
export const workWord = (code: string): Toned => toned(WORK, code, { text: 'Not yet readable', tone: 'unknown' });

/** The playing-time read of his own job (`OpportunityVerdict`), which React showed as its code. */
export const OPPORTUNITY: Record<string, Toned> = {
  regular_work: { text: 'Regular work', tone: 'good' },
  shared_work: { text: 'Sharing the job', tone: 'neutral' },
  insufficient_work: { text: 'Short of work', tone: 'caution' },
  not_playing: { text: 'Not playing', tone: 'bad' },
  bat_only: { text: 'Batting, not fielding', tone: 'caution' },
  indeterminate: { text: 'Not yet readable', tone: 'unknown' },
};
export const opportunityWord = (code: string): Toned => toned(OPPORTUNITY, code, { text: 'Not yet readable', tone: 'unknown' });

/**
 * Developmental stakes in the GM's words (D-050). `development_priority` reads "Development-sensitive" (the owner's
 * name, 2026-10-02): the word "priority" is a verdict word the plain-language rule keeps off every screen, and the tier
 * is a stake, never an instruction.
 */
export const TIER: Record<string, string> = {
  core_prospect: 'Core prospect',
  protected_prospect: 'Protected prospect',
  development_priority: 'Development-sensitive',
  normal: 'Ordinary',
  organizational_depth: 'Organizational depth',
};
export const tierWord = (tier: string | null): string => (tier === null ? 'Stakes not known' : TIER[tier] ?? plain(tier.replace(/_/g, ' ')));

export const ATTENTION: Record<string, Toned> = {
  needs_attention: { text: 'Needs attention', tone: 'caution' },
  worth_a_look: { text: 'Worth a look', tone: 'neutral' },
  routine: { text: 'Routine', tone: 'neutral' },
};
/** The farm's stated order of attention: needs attention, worth a look, routine. */
export const ATTENTION_ORDER: Record<string, number> = { needs_attention: 0, worth_a_look: 1, routine: 2 };

export const OWNER: Record<string, string> = {
  minor_league_operations: MINOR_LEAGUE_OPS,
  player_development: PLAYER_DEVELOPMENT,
};
export const ownerWord = (code: string): string => OWNER[code] ?? plain(code.replace(/_/g, ' '));

/** Whether a conflict is the present, the past or not yet readable; the ordinary present carries no word. */
export const TIMING: Record<string, string> = {
  emerging: 'newly emerging',
  historical: 'earlier this season',
  recently_resolved: 'recently resolved',
  uncertain: 'not yet readable',
};

/** Player Development on one exact move. */
export const JUDGMENT: Record<string, Toned> = {
  defensible: { text: 'Defensible', tone: 'good' },
  indefensible: { text: 'Not defensible', tone: 'bad' },
  indeterminate: { text: 'Can\'t be judged', tone: 'unknown' },
  not_evaluated: { text: 'Not looked at', tone: 'unknown' },
};
export const judgmentWord = (code: string): Toned => toned(JUDGMENT, code, { text: 'Not known', tone: 'unknown' });

/** Philosophy's preference among defensible moves (never a judgment). */
export const PREFERENCE: Record<string, string> = {
  preferred: 'The club prefers it',
  acceptable: 'Fine by the club',
  disfavored: 'The club leans against it',
};
export const preferenceWord = (code: string | null): string | null => (code === null ? null : PREFERENCE[code] ?? plain(code));

/** Where a cascade stops, and why (D-045). */
export const STOP: Record<string, Toned> = {
  absorbed: { text: 'The club can absorb it', tone: 'good' },
  no_defensible_move: { text: 'No defensible move exists', tone: 'caution' },
  indeterminate: { text: 'The next step can\'t be judged', tone: 'unknown' },
  relocates_the_same_shortage: { text: 'It would only move the same shortage', tone: 'caution' },
  reached_lowest_level: { text: 'There is nothing below to draw from', tone: 'caution' },
  step_limit: { text: 'Followed as far as is useful', tone: 'neutral' },
};
export const stopWord = (code: string): Toned => toned(STOP, code, { text: 'The chain stops here', tone: 'neutral' });

/** A pitcher's or a position player's job. */
export function jobWords(job: { kind: 'position'; position: string } | { kind: 'rotation' } | { kind: 'relief' } | null): string {
  if (!job) return 'his job';
  return job.kind === 'position' ? job.position : job.kind === 'rotation' ? 'the rotation' : 'the bullpen';
}

// ── Retention, in words (React showed the codes) ───────────────────────────

export const OUTLOOK: Record<string, Toned> = {
  developing: { text: 'Still developing', tone: 'good' },
  plateaued: { text: 'Levelled off', tone: 'caution' },
  exhausted: { text: 'No development case left', tone: 'caution' },
  indeterminate: { text: 'Can\'t be judged', tone: 'unknown' },
};
export const PRESSURE: Record<string, Toned> = {
  none: { text: 'Nobody waiting on his spot', tone: 'good' },
  some: { text: 'Some waiting on his spot', tone: 'caution' },
  acute: { text: 'Others need his spot', tone: 'bad' },
};
export const LEAN: Record<string, string> = {
  patient: 'Leans patient',
  neutral: 'No lean',
  willing: 'Leans toward moving on',
};
export const RETENTION_CONCLUSION: Record<string, string> = {
  retain: 'keep him',
  review: 'a roster question to look at',
  not_a_farm_decision: 'not the farm\'s to decide',
  indeterminate: 'can\'t be judged',
};

// ── Prospects (Player Development's calls) ──────────────────────────────────

/** Player Development's call on a prospect, what it means, and its tone. */
export const CALL: Record<string, Toned & { means: string }> = {
  strong_promotion_case: { text: 'Strong promotion case', tone: 'good', means: 'Current-level evidence strongly supports a higher-level challenge.' },
  consider_promotion: { text: 'Consider promotion', tone: 'good', means: 'He has done enough to discuss a normal promotion, but the case is not overwhelming.' },
  mlb_ready_discussion: {
    text: 'Review for a major-league chance',
    tone: 'good',
    means: 'His development supports a major-league discussion; the roster opening and the moves it takes are a separate review.',
  },
  consider_demotion: { text: 'Consider a lower level', tone: 'caution', means: 'His results at this level and his sample support discussing a lower-level assignment.' },
  watch: { text: 'Hold and keep watching', tone: 'neutral', means: 'Keep the current assignment and keep collecting evidence.' },
  indeterminate: {
    text: 'Can\'t be judged: ratings not seen',
    tone: 'unknown',
    means: 'The scouting ratings this call rests on are not visible to us, so Player Development can\'t say. It is neither a hold nor an approval.',
  },
  hold: { text: 'Current level right', tone: 'neutral', means: 'The current level is still a sound place to develop him.' },
};
/** A call Pennant has no words for is said as not known, never as another call (D-018). */
export const callWord = (code: string): Toned & { means: string } =>
  CALL[code] ?? { text: 'Call not known', tone: 'unknown', means: 'Player Development made a call Pennant has no words for yet.' };
/** The calls the development meetings raise (React's "needs attention" set): a move to discuss, either way. */
export const MEETING_CALLS: ReadonlySet<string> = new Set(['strong_promotion_case', 'consider_promotion', 'consider_demotion', 'mlb_ready_discussion']);
/** The board's call column sorts like with like, in this stated order: a move to discuss first, then watch, then hold. */
export const CALL_ORDER: Record<string, number> = {
  strong_promotion_case: 0, consider_promotion: 1, mlb_ready_discussion: 2, consider_demotion: 3, watch: 4, hold: 5, indeterminate: 6,
};

export const MOVE_KIND: Record<string, string> = {
  normal_promotion: 'Normal promotion',
  skip_level_promotion: 'Skip-level challenge',
  demotion: 'Lower-level assignment',
  mlb_discussion: 'Major-league discussion',
};
export const moveWord = (kind: string): string => MOVE_KIND[kind] ?? plain(kind.replace(/_/g, ' '));

export const FIT: Record<string, string> = {
  strong: 'Strong fit',
  viable: 'Workable fit',
  borderline: 'Borderline fit',
  indeterminate: 'Fit not looked at',
  poor: 'Poor fit',
};
export const fitWord = (code: string): string => FIT[code] ?? FIT.poor;

/** Prospect evaluation judgments, as the Prospects page said them. */
export const EVALUATION: Record<string, Toned> = {
  defensible: { text: 'Defensible', tone: 'good' },
  indefensible: { text: 'Not supported', tone: 'bad' },
  indeterminate: { text: 'Can\'t be judged', tone: 'unknown' },
};

// ── Small word builders ────────────────────────────────────────────────────

/** 1st, 2nd, 3rd, 11th, 21st. */
export function ordinal(n: number): string {
  const r = Math.round(n);
  const tens = r % 100;
  if (tens >= 11 && tens <= 13) return `${r}th`;
  return `${r}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[r % 10] ?? 'th'}`;
}

/** "1 game", "4 games". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** A signed change to one decimal, a whole number without one: "+2", "−1.5", "0". */
export function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return '0';
  const body = Number.isInteger(r) ? String(Math.abs(r)) : Math.abs(r).toFixed(1);
  return `${r > 0 ? '+' : '−'}${body}`;
}

/** How a rating is shown on the save's own scale, rounded to fives only on the 20–80 scale when the GM asks for it. */
export interface RatingDisplay {
  scaleMax: number;
  roundToFive: boolean;
}

export function ratingText(value: number, display: RatingDisplay): string {
  const round = display.roundToFive && display.scaleMax === 80;
  return String(round ? Math.round(value / 5) * 5 : Math.round(value));
}

/** "45 → 60", or "45" when the two read the same; null when either is not seen. */
export function ratingPair(current: number | null, ceiling: number | null, display: RatingDisplay): string | null {
  if (current === null || ceiling === null) return null;
  const a = ratingText(current, display);
  const b = ratingText(ceiling, display);
  return a === b ? a : `${a} → ${b}`;
}

/** A man's role on the boards: a developmental starter or reliever, or his listed position. */
export function roleWords(kind: string, role: { listedPosition: string; developmentalPitcherRole: string | null }): string {
  if (kind === 'pitcher') return role.developmentalPitcherRole === 'starter' ? 'Developing as a starter' : 'Developing as a reliever';
  return role.listedPosition || 'Position player';
}

/** Peer pace in words: "Ahead · 85th", "Typical · 50th", "History still building". */
export function paceWords(pace: string, place: number | null): Toned {
  if (pace === 'insufficient') return { text: 'History still building', tone: 'unknown' };
  const at = place === null ? '' : ` · ${ordinal(place)}`;
  if (pace === 'ahead') return { text: `Ahead${at}`, tone: 'good' };
  if (pace === 'behind') return { text: `Behind${at}`, tone: 'bad' };
  return { text: `Typical${at}`, tone: 'neutral' };
}

// ── The specialists' own sentences, in the GM's words ──────────────────────

/**
 * Each phrase the farm's and Player Development's sentences use that the plain-language rule keeps off the screen,
 * and what the GM reads instead. Phrase for phrase: the sentence's meaning is the specialist's.
 */
export const PLAIN: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/\b(developmental )?stakes (?:are|is) (?:indeterminate|unknown)\b/gi, '$1stakes are not known', 'an unknown tier is said as not known'],
  [/\b(developmental )?stakes indeterminate\b/gi, '$1stakes not known', 'as above'],
  [/\bdevelopment[ -]priorities\b/gi, 'development-sensitive players', 'the tier\'s name (the owner\'s, 2026-10-02); "priority" is a verdict word'],
  [/\bdevelopment[ -]priority\b/gi, 'development-sensitive', 'as above'],
  [/\bpriority prospects\b/gi, 'high-stakes prospects', '"priority" is a verdict word; the count is of the higher tiers'],
  [/\bpriority prospect\b/gi, 'high-stakes prospect', '"priority" is a verdict word'],
  [/\b(\d+(?:\.\d+)?)(?:st|nd|rd|th) percentile\b/g, '#place#', 'a place out of a hundred, without the method word (rounded)'],
  [/\bpercentile\b/gi, 'place out of 100', 'the method word, said plainly'],
  [/\bis indeterminate\b/gi, 'can\'t be judged', 'the GM\'s words for a judgment the evidence cannot make'],
  [/\bare indeterminate\b/gi, 'can\'t be judged', 'as above'],
  [/\bindeterminate\b/gi, 'not settled', 'the GM\'s words for an answer the evidence cannot give'],
  [/\bcoverage\b/gi, 'cover', '"coverage" is kept for interval coverage'],
  [/\bpotential\b/gi, 'ceiling', 'OOTP\'s rating name; the scouts\' ceiling'],
  [/\bretention\b/gi, 'keeping a roster spot', 'the farm\'s question in plain words'],
  [/\bprovisional\b/gi, 'starting', 'a line not yet fitted to the save is a starting value'],
  [/\s*\((?:see )?[DQRA]-\d+[^)]*\)/g, '', 'a decision\'s number belongs in the docs, not on the screen'],
  [/\bthe organization's ladder\b/g, 'the organization\'s levels', '"ladder" is kept off the screen'],
  [/\bladder\b/gi, 'levels', 'as above'],
  [/\bsurplus at\b/gi, 'plenty at', 'the stakes lines\' upper mark, without the Player Value word'],
  [/\bwhether he should be starting\b/g, 'whether he starts', 'a question, said without a verdict word'],
  [/\bshould get the reps\b/g, 'gets the reps', 'a question, said without a verdict word'],
  [/\bwhen a GM should be told\b/g, 'when a GM is told', 'as above'],
  [/\bconsequences must be evaluated separately\b/g, 'consequences are weighed separately', 'as above'],
  [/\bmust have\b/g, 'needs to have', 'a line\'s condition, said without a verdict word'],
  [/\bmust be\b/g, 'needs to be', 'as above'],
  [/\bmust appear\b/g, 'needs to appear', 'as above'],
  [/\brecommendations\b/gi, 'calls', 'Player Development\'s calls, without the verdict word'],
  [/\brecommendation\b/gi, 'call', 'Player Development\'s call, without the verdict word'],
];

/** The words put in for a phrase, starting with a capital where the phrase did (a sentence keeps its capital letter). */
function inPlaceOf(match: string, pattern: RegExp, words: string): string {
  const put = match.replace(new RegExp(pattern.source, pattern.flags.replace('g', '')), words);
  return /^[A-Z]/.test(match) && /^[a-z]/.test(put) ? `${put.charAt(0).toUpperCase()}${put.slice(1)}` : put;
}

/** A specialist's sentence in the GM's words (see `PLAIN`). */
export function plain(text: string): string {
  let out = text;
  for (const [pattern, words] of PLAIN) {
    out = words === '#place#'
      ? out.replace(pattern, (_m, n: string) => `${ordinal(Number(n))} of 100`)
      : out.replace(pattern, (m: string) => inPlaceOf(m, pattern, words));
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Sentences, plain, with the empty ones and repeats left out. */
export function plainAll(lines: readonly string[]): string[] {
  return [...new Set(lines.map(plain).filter((l) => l.length > 0))];
}

/** Upper-cases a sentence's first letter. */
export const capitalized = (text: string): string => (text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text);
