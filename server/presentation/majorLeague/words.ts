/**
 * Major League Ops' vocabulary, moved from the React pages (`src/pages/mlb/common.tsx`, `platoonCopy.ts`, the views'
 * label maps and badges) so the Mac app's every word is served (D-056). Each map turns a specialist's code into the words
 * a GM reads, with the tone the app pairs with a symbol; a code this build does not know falls back to plain words from
 * the code itself, never to a blank.
 *
 * Plain language (AGENTS.md "Writing for the GM"): a place on the 0 to 100 scale is said as one ("62 on the 0–100 scale"),
 * never as an ordinal or the method; "not established" stands for the evidence vocabulary's code; the staff's call is advice, never a verdict word.
 */
import type { Cell, Tone } from '../../contract/presentation.js';
import { cell } from '../claim.js';

/** A code made readable when no map has it ("upgrade_uncertain" becomes "upgrade uncertain"). */
export const codeWords = (code: string): string => code.replace(/_/g, ' ').trim() || 'not stated';

/** A label from a map, else the code in plain words. */
export const labelOf = (map: Readonly<Record<string, string>>, code: string | null | undefined): string =>
  (code && map[code]) || codeWords(code ?? '');

/**
 * A place on the 0 to 100 scale against peers, bare ("62"), for a table cell or a lens whose label names the measure;
 * null when unknown. A working estimate is a blend of tools and results on that scale, not a percentile, so it is never
 * said as "62nd" or "better than 62%" (the review of 2026-10-02, M3 and M4).
 */
export function scaleNumber(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return String(Math.round(n));
}

/** The same place in a sentence: "62 on the 0–100 scale"; null when unknown. */
export function onScale(n: number | null | undefined): string | null {
  const v = scaleNumber(n);
  return v === null ? null : `${v} on the 0–100 scale`;
}

/** A true share of peers (a percentile among them): "better than 62% of those listed there"; null when unknown. */
export function betterThan(n: number | null | undefined, peers: string): string | null {
  const v = scaleNumber(n);
  return v === null ? null : `better than ${v}% of ${peers}`;
}

/** The hint a scale's cell carries. */
export const SCALE_HINT = 'On a 0–100 scale against major league peers; 50 is typical';

/** "+12" or "−4", rounded. */
export const signed = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n))}`;

/** "40%" from a share of one. */
export const share = (n: number): string => `${Math.round(n * 100)}%`;

/** A list of sentences, trimmed, blanks and repeats left out, in order. */
export const sentences = (lines: ReadonlyArray<string | null | undefined>): string[] =>
  [...new Set(lines.map((l) => (l ?? '').trim()).filter(Boolean))];

/** A cell from a specialist's sentence (trimmed). */
export const said = (text: string, extra: { tone?: Tone; hint?: string } = {}): Cell => cell(text.trim(), extra);

const HINT_MAX = 75;
/** A help tag only when it fits one line; a longer reason goes in a line or the basis, never cut. */
export const hintIf = (text: string | null | undefined): string | undefined => {
  const t = (text ?? '').trim();
  return t && t.length <= HINT_MAX ? t : undefined;
};

/** A chip: a short word with its tone. */
export const chip = (text: string, tone: Tone, hint?: string): Cell => cell(text, hint ? { tone, hint: hintIf(hint) } : { tone });

// ── the staff's call ────────────────────────────────────────────────────────

/**
 * The staff's stance, as the staff's view and never an order (the move is the GM's, D-001): the owner's wording of
 * 2026-10-02 (D-065).
 */
export const STANCE_TEXT: Readonly<Record<string, string>> = {
  act: 'Staff\'s view: act', explore: 'Staff\'s view: worth pursuing', monitor: 'Staff\'s view: keep watching', hold: 'Staff\'s view: hold',
};
export const STANCE_TONE: Readonly<Record<string, Tone>> = { act: 'good', explore: 'caution', monitor: 'neutral', hold: 'neutral' };
export const CONFIDENCE_TEXT: Readonly<Record<string, string>> = { high: 'High confidence', moderate: 'Moderate confidence', low: 'Low confidence' };

// ── Player Development, Player Rights and the org's preference ────────────────

export const PREFERENCE: Readonly<Record<string, string>> = {
  preferred: 'Org prefers', acceptable: 'No objection', disfavored: 'Org disfavors', no_preference: 'No preference',
};
export const DEV: Readonly<Record<string, string>> = {
  defensible: 'Defensible', indefensible: 'Not defensible', indeterminate: 'Incomplete', unassessed: 'Incomplete',
  not_applicable: 'Not applicable', context_dependent: 'Depends on how long',
};
export const DEV_TONE: Readonly<Record<string, Tone>> = {
  defensible: 'good', indefensible: 'bad', indeterminate: 'unknown', unassessed: 'unknown', not_applicable: 'neutral', context_dependent: 'caution',
};
export const PATH: Readonly<Record<string, string>> = {
  open: 'Open', open_with_requirements: 'Needs a clearing move', indeterminate: 'Not established', blocked: 'Blocked',
};
export const PATH_TONE: Readonly<Record<string, Tone>> = { open: 'good', open_with_requirements: 'good', indeterminate: 'unknown', blocked: 'bad' };
/** Where a rule comes from (Player Rights' basis). */
export const BASIS: Readonly<Record<string, string>> = {
  export_state: 'stated by the export', observed: 'observed in OOTP', documented: 'OOTP documentation',
  observed_and_documented: 'observed and documented', owner_attested: 'attested by the owner',
};
export const PATH_LABEL: Readonly<Record<string, string>> = { role_change: 'Change role', recall: 'Recall (40-man)', add_to_forty_man: 'Add to 40-man' };
/** A transaction's status, as Player Rights answered (a status not established is never "allowed"). */
export const RIGHTS_TONE: Readonly<Record<string, Tone>> = { eligible: 'good', ineligible: 'bad', indeterminate: 'unknown', not_a_transaction: 'neutral' };
export const STEP_STATUS: Readonly<Record<string, string>> = { eligible: 'Allowed', ineligible: 'Not allowed', indeterminate: 'Not established' };

// ── the scouting review ────────────────────────────────────────────────────

export const COMPARE_TEXT: Readonly<Record<string, string>> = {
  clear_upgrade: 'Clear upgrade', upgrade_uncertain: 'Upgrade, not firm', marginal: 'Marginal upgrade', sidegrade: 'Sidegrade',
  downgrade: 'Downgrade', cannot_judge: 'Cannot compare',
};
export const COMPARE_TONE: Readonly<Record<string, Tone>> = {
  clear_upgrade: 'good', upgrade_uncertain: 'caution', marginal: 'caution', sidegrade: 'neutral', downgrade: 'bad', cannot_judge: 'unknown',
};
export const FINDING_TEXT: Readonly<Record<string, string>> = {
  ratings_and_results_weak: 'Tools and results agree: weak', weak_estimate: 'Weak for the role', tools_weak_results_fine: 'Tools lag results (watch)',
  results_weak_tools_fine: 'Results lag tools (watch)', too_early: 'Too early to read', no_concern: 'No concern', cannot_judge: 'Cannot judge',
};
/** A finding's tone is its case's strength (strong and moderate cases are the ones that become needs). */
export const STRENGTH_TONE: Readonly<Record<string, Tone>> = { strong: 'bad', moderate: 'caution', watch: 'caution', none: 'good' };
export const STRENGTH_WORD: Readonly<Record<string, string>> = { strong: 'Strong case', moderate: 'Moderate case', watch: 'Watch', none: 'No concern' };
export const TIER_TEXT: Readonly<Record<string, string>> = {
  closer: 'Closer', high_leverage: 'High leverage', middle: 'Middle', low_leverage: 'Low leverage', long: 'Long man', unknown: 'Not yet clear',
};
export const VERDICT_TEXT: Readonly<Record<string, string>> = {
  strengthens: 'Improves the group', comparable: 'Comparable to the back of the group', behind: 'Would not improve the group', cannot_judge: 'Cannot be placed',
};
export const VERDICT_TONE: Readonly<Record<string, Tone>> = { strengthens: 'good', comparable: 'caution', behind: 'bad', cannot_judge: 'unknown' };
export const QUALITY_TEXT: Readonly<Record<string, string>> = {
  regular_quality: 'regular quality', credible: 'credible backup', emergency: 'emergency only', unknown: 'quality not established',
};
export const QUALITY_TONE: Readonly<Record<string, Tone>> = { regular_quality: 'good', credible: 'good', emergency: 'bad', unknown: 'unknown' };
export const DIMENSION_LABEL: Readonly<Record<string, string>> = {
  competitiveWindow: 'Window and season', riskTolerance: 'Risk tolerance', ageCurveSensitivity: 'Age-curve sensitivity', upsidePreference: 'Upside preference',
  defenseEmphasis: 'Defense emphasis', rosterDepth: 'Roster depth', pitchingDepth: 'Pitching depth', versatility: 'Versatility', usage: 'How he is used',
  promotionAggressiveness: 'Promotion aggressiveness',
};
export const POSITION_ABBR: Readonly<Record<number, string>> = { 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH' };
export const positionAbbr = (p: number | null | undefined): string => (p != null && POSITION_ABBR[p]) || 'a position';

// ── needs ──────────────────────────────────────────────────────────────────

export const KIND_LABEL: Readonly<Record<string, string>> = {
  role_below_standard: 'Roster floor', open_active_spot: 'Open spot', il_return_crunch: 'IL return', role_holder_review: 'Scouting review',
  platoon_complement: 'Platoon', bench_coverage: 'Bench backups',
};

/** The shape of a need the badge reads (the department's own need, `MlbNeed`). */
export interface BadgeNeed {
  kind: string;
  origin: string;
  severity: string;
  review?: { strength: string };
}

/**
 * A need's badge: the strength of the case, or what kind of flag it is. Its tone is the department's own severity read
 * without the club's philosophy or season (`neutral`, when the need states it): the shaded urgency is a lean, said in
 * the basis, never the colour (D-060's rule for the desk, kept here).
 */
export function needBadge(n: BadgeNeed, neutral: string = n.severity): Cell {
  const strength = n.review?.strength === 'strong' ? 'Strong case' : n.review?.strength === 'moderate' ? 'Moderate case' : 'Case';
  const label = n.origin === 'hypothetical'
    ? 'What-if'
    : n.kind === 'role_holder_review'
      ? strength
      : n.kind === 'platoon_complement'
        ? 'Platoon'
        : n.kind === 'bench_coverage'
          ? 'Bench backup'
          : neutral === 'critical' ? 'Urgent' : neutral === 'elevated' ? 'Needs attention' : 'Watch';
  const tone: Tone = neutral === 'critical' ? 'bad' : neutral === 'elevated' ? 'caution' : 'neutral';
  return cell(label, { tone });
}

/** How long a need is expected to last, as the department states it (a duration is never assumed, D-027). */
export function horizonText(n: { kind: string; horizon: { kind: string; days: number | null } }): string {
  const h = n.horizon;
  if (n.kind === 'role_holder_review') return 'Duration not assumed';
  if (h.kind === 'unknown' || h.days === null) return 'Duration not established';
  const word = h.kind === 'temporary' ? 'Short-term' : h.kind === 'extended' ? 'Extended' : 'Long-term';
  return `${word} · about ${h.days} day${h.days === 1 ? '' : 's'}`;
}

/** The platoon read's one line (`platoonCopy.ts`, moved). */
export function platoonHeadline(p: { verdict: string; weakSide?: string | null; drivers?: { league: number | null } | null }): string {
  if (p.verdict === 'problem') return `Weak against ${p.weakSide === 'L' ? 'left' : 'right'}-handers.`;
  if (p.verdict === 'no_issue') return 'No platoon problem.';
  if (p.drivers && p.drivers.league === null) return 'Can\'t judge a platoon split: the usual split for his hand isn\'t known in this league.';
  return 'Not enough to read a platoon split.';
}

/** The platoon read's chip. */
export function platoonChip(p: { verdict: string; weakSide?: string | null } | null | undefined): Cell {
  if (!p) return cell('No read', { tone: 'unknown' });
  if (p.verdict === 'problem') return cell(`Weak vs ${p.weakSide === 'L' ? 'LHP' : 'RHP'}`, { tone: 'bad' });
  if (p.verdict === 'no_issue') return cell('No issue', { tone: 'good' });
  return cell('Not enough', { tone: 'unknown' });
}

/** The platoon read's basis, in words. */
export const PLATOON_BASIS: Readonly<Record<string, string>> = {
  ratings_and_splits: 'his ratings and his splits', ratings: 'his ratings', splits: 'his splits', league_norm: 'the league\'s usual split', none: 'nothing yet',
};

// ── the bench ──────────────────────────────────────────────────────────────

/** How well a bench job is done, in plain words that avoid "cover" (N8 review): a backup position is "Backed up", another job "Has someone". */
export const FUNCTION_STRENGTH: Readonly<Record<string, string>> = { covered: 'Backed up', thin: 'Thin', none: 'Nobody', unknown: 'Not established' };
export const SOFT_FUNCTION_STRENGTH: Readonly<Record<string, string>> = { covered: 'Has someone', thin: 'Thin', none: 'Nobody', unknown: 'Not established' };
export const FUNCTION_TONE: Readonly<Record<string, Tone>> = { covered: 'good', thin: 'bad', none: 'bad', unknown: 'unknown' };
export const TAG_TEXT: Readonly<Record<string, string>> = {
  pinch_hitter: 'pinch-hit bat', defensive_replacement: 'defensive replacement', pinch_runner: 'runner', platoon_partner: 'platoon partner', flexible: 'flexible',
};
/** The three positions a bench must cover with somebody who can really play them. */
export const REQUIRED_COVERS = ['catcher', 'middle_infield', 'center_field'] as const;

// ── the pen ────────────────────────────────────────────────────────────────

export const PEN_HEADING: Readonly<Record<string, string>> = {
  no_credible_high_leverage: 'No credible high-leverage arm', no_multi_inning: 'Nobody throws multiple innings', crowded_role: 'A crowded role',
  starter_conflict: 'The rotation and the pen compete for an arm',
};

// ── the farm (Minor League Operations' answer, displayed) ─────────────────────

export const FARM_STATUS: Readonly<Record<string, string>> = { critical: 'short', thin: 'thin', healthy: 'able', surplus: 'carrying extra' };
export const FARM_TONE: Readonly<Record<string, Tone>> = { critical: 'bad', thin: 'caution', healthy: 'good', surplus: 'neutral' };

/** The assignment durations a what-if can assume (none by default: a duration is never assumed, D-027). */
export const DURATIONS: ReadonlyArray<[number | null, string]> = [
  [null, 'Duration not stated'], [6, 'About a week'], [14, 'Two weeks'], [40, 'About six weeks'], [120, 'Rest of the season'],
];

/** The roles an open spot can be explored for. */
export const ROLE_CHOICES: ReadonlyArray<[string, string]> = [['starting_pitcher', 'Starting pitcher'], ['relief_pitcher', 'Relief pitcher'], ['catcher', 'Catcher']];

/**
 * Developmental stakes' tiers in the words these views use (D-050: a consequence, never a rank). The tier Player
 * Development calls "development priority" reads "development-sensitive" here, the owner's name for it (2026-10-02):
 * "priority" is on the verdict list for every shown string, and the tier is a consequence, not an instruction. The farm
 * adopts the same name.
 */
export const STAKES_TIER: Readonly<Record<string, string>> = {
  core_prospect: 'core prospect', protected_prospect: 'protected prospect', development_priority: 'development-sensitive', normal: 'ordinary',
  organizational_depth: 'organizational depth',
};
/** A stakes sentence with the tier's name as these views say it. */
export const stakesWords = (text: string): string =>
  text.replace(/\b([Dd])evelopment priority\b/g, (_m, d: string) => `${d}evelopment-sensitive`);

/** Player Development's fit at the major league level (`DestinationFitClassification`), in words. */
export const FIT_TEXT: Readonly<Record<string, string>> = {
  poor: 'Poor fit', borderline: 'Borderline', viable: 'Viable', strong: 'Strong fit', indeterminate: 'Not established',
};
export const FIT_TONE: Readonly<Record<string, Tone>> = { poor: 'bad', borderline: 'caution', viable: 'good', strong: 'good', indeterminate: 'unknown' };
/** How complete the visible tool ratings are. */
export const EVIDENCE_TEXT: Readonly<Record<string, string>> = { complete: 'complete', partial: 'partial', unknown: 'not known' };
/** How firm a comparison is. */
export const CERTAINTY_TEXT: Readonly<Record<string, string>> = { adequate: 'firm', limited: 'limited', thin: 'thin' };

/** A response group (`ResponseGroup`) in words: what the path would take (the Front Office's trail says it the same way). */
export const GROUP_TEXT: Readonly<Record<string, string>> = {
  open: 'Can be done now', open_requires_clearing: 'Can be done once a spot is cleared', role_concern: 'Can be done, but a poor fit for the role',
  creates_shortfall: 'Can be done, but it opens a hole behind him', context_dependent: 'Depends on how long he\'d be needed',
  evaluation_incomplete: 'Player Development can\'t say yet', indeterminate: 'Whether the move is allowed isn\'t known',
  blocked_by_development: 'Player Development doesn\'t support it', blocked_by_rights: 'Not a move the rules allow', unavailable: 'Not available',
};

// ── sort keys ───────────────────────────────────────────────────────────────

/**
 * A code's place for sorting a column (N8 review, M6): an ordinal number, so a sort means something ("defensible"
 * before "not defensible", a closer before a long man) rather than the alphabet of codes, and null for what is not
 * known (indeterminate, unassessed, not read), so an unknown always sorts last and is never placed as if it were a
 * reading. An order is display only: it ranks no player and decides nothing.
 */
export const rankOf = (order: Readonly<Record<string, number>>, code: string | null | undefined): number | null =>
  code != null && order[code] !== undefined ? order[code] : null;
export const DEV_ORDER: Readonly<Record<string, number>> = { defensible: 0, context_dependent: 1, indefensible: 2, not_applicable: 3 };
export const PATH_ORDER: Readonly<Record<string, number>> = { open: 0, open_with_requirements: 1, blocked: 2 };
export const FIT_ORDER: Readonly<Record<string, number>> = { strong: 0, viable: 1, borderline: 2, poor: 3 };
export const PREFERENCE_ORDER: Readonly<Record<string, number>> = { preferred: 0, acceptable: 1, no_preference: 2, disfavored: 3 };
/** A response by how far the player has to come: a role change, a recall, an addition to the 40-man. */
export const RESPONSE_ORDER: Readonly<Record<string, number>> = { role_change: 0, recall: 1, add_to_forty_man: 2 };
/** How a reliever is used, highest leverage first. */
export const TIER_ORDER: Readonly<Record<string, number>> = { closer: 0, high_leverage: 1, middle: 2, low_leverage: 3, long: 4 };
/** A read's finding, the strongest concern first. */
export const FINDING_ORDER: Readonly<Record<string, number>> = {
  ratings_and_results_weak: 0, weak_estimate: 1, tools_weak_results_fine: 2, results_weak_tools_fine: 3, no_concern: 4,
};
/** The platoon read: a problem first, then no issue; not enough to read is not known. */
export const PLATOON_ORDER: Readonly<Record<string, number>> = { problem: 0, no_issue: 1 };
