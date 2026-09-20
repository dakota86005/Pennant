/**
 * The bench: is the club covered when a regular sits, and what is each bench player FOR?
 *
 * A bench is judged differently from a lineup. Nobody expects a bench player to hit like a regular. It is a
 * collection of FUNCTIONS, and a club needs some of them and not others:
 *
 *   cover          somebody who can play the positions nobody plays without practice (catcher, middle infield, center field)
 *   pinch hit      a bat to send up
 *   defensive      a glove to put in late
 *   pinch run      a runner
 *   partner        a man who already shares a regular's spot
 *   flexibility    a man who can credibly play several positions
 *
 * There is no bench score, on purpose. Each function says who covers it, how well, and where nobody does.
 *
 * "Can play there" is not one thing. A middle infielder listed at second base with a visible grade of 38 at center field
 * "can stand" in center; he is not a center-field backup. The grade is read against the peers listed at the position: a
 * cover is `regular_quality` (about the median regular there), `credible` (a real backup: not in the bottom tenth of the
 * position) or `emergency` (playable, no more). A required position covered only by an emergency cover is reported as
 * exactly that, not as covered.
 *
 * Pure: bench players and who can play where in, coverage and findings out. Who CAN play a position is Player
 * Development's cross-role evidence (the visible grade above the playable line, ranked among the position's peers by the
 * adapter); this only reads it. The functions are policy: they say what a bench is usually for, not a fact about baseball.
 */

import { policy, type CalibrationStamp } from './calibration.js';
import { POSITION_LABELS } from './lineupPicture.js';

export const BENCH_CALIBRATION: CalibrationStamp = policy('Which positions must have a bench cover, what counts as a credible cover, and which functions a bench is for are roster-construction policies, not facts of the game.');

/** POLICY. Positions that need somebody on the bench who can play them. Catcher, shortstop/second and center field are the positions nobody plays without practice; the corners are covered by anyone. */
export const REQUIRED_COVER: ReadonlyArray<{ key: string; label: string; positions: readonly number[] }> = [
  { key: 'catcher', label: 'a catcher', positions: [2] },
  { key: 'middle_infield', label: 'a middle infielder (second base or shortstop)', positions: [4, 6] },
  { key: 'center_field', label: 'a center fielder', positions: [8] },
];

/**
 * POLICY. A cover's percentile of the peers listed at the position: at or above `regular` he is about what a regular there is; at or above
 * `credible` he is a real backup; below it, an emergency. The credible line is the bottom tenth, the same "unusually weak" line the role
 * standards use, and is about 10 to 16 runs per 1,300 innings below an average fielder at catcher, shortstop and center field (grade sd times the
 * calibrated runs per grade point, docs/CALIBRATION.md section 7). A first version put it at the bottom fifth; measured across the 30 clubs the
 * typical bench center fielder sits at the 12th percentile of those listed there, so that line called 19 of 30 benches "emergency only" and told
 * a GM nothing. At the tenth, the flag separates the benches that are unusually thin.
 */
export const COVER_PCT = { regular: 50, credible: 10 } as const;
/** POLICY. Bat percentile (of MLB hitters) from which a bench player is a bat worth sending up. */
export const PINCH_HIT_PCT = 60;
/** POLICY. Glove percentile (among the position's peers) from which a bench player is a late-inning defensive replacement. */
export const DEFENSIVE_PCT = 65;
/** POLICY. Running percentile from which a bench player is a runner worth using. */
export const RUNNER_PCT = 70;
/** POLICY. Positions a player must cover credibly to count as flexible. */
export const FLEXIBLE_POSITIONS = 3;

export type CoverQuality = 'regular_quality' | 'credible' | 'emergency' | 'unknown';

/** One position a player can play, and how well: the visible grade and where it ranks among the peers listed there. */
export interface CoverRead {
  position: number;
  grade: number | null;
  /** Percentile among the MLB players listed at the position; null when no peer population or no grade. */
  pct: number | null;
  quality: CoverQuality;
}

export interface BenchPlayer {
  playerId: number;
  name: string;
  bats: 'R' | 'L' | 'S' | null;
  pa: number;
  /** Positions (2-9) where his visible grade supports playing there at all. */
  covers: number[];
  /** How well he plays each of them, against the peers listed there; absent when the adapter did not rank them (the quality is then unknown). */
  coverReads?: CoverRead[];
  /** His bat as a working value (percentile of MLB hitters); null when unknown. */
  batValue: number | null;
  /** His baserunning as a working value (percentile); null when unknown. */
  runningPct?: number | null;
  listed: number | null;
  /** The position he shares with a regular, when he has played a real share of it. */
  partnerAt?: number;
}

export type BenchRoleLabel = 'backup catcher' | 'utility infielder' | 'outfielder' | 'corner bat' | 'role not established';
export type BenchTag = 'pinch_hitter' | 'defensive_replacement' | 'pinch_runner' | 'platoon_partner' | 'flexible';

export const TAG_LABEL: Record<BenchTag, string> = {
  pinch_hitter: 'pinch-hit bat', defensive_replacement: 'defensive replacement', pinch_runner: 'runner', platoon_partner: 'platoon partner', flexible: 'flexible',
};

export interface BenchRow extends BenchPlayer {
  role: BenchRoleLabel;
  coverLabels: string[];
  /** What else he is for, each from a stated piece of evidence. */
  tags: BenchTag[];
  /** Covers ranked best first, with their quality. */
  coverReads: CoverRead[];
}

export type FunctionStrength = 'covered' | 'thin' | 'none' | 'unknown';

export interface BenchFunction {
  key: string;
  label: string;
  strength: FunctionStrength;
  /** Who covers it, best first, each with how well. */
  by: Array<{ playerId: number; name: string; quality: CoverQuality | null; note: string }>;
  text: string;
}

export interface CoverageGap {
  key: string;
  label: string;
  positions: number[];
  /** `none`: nobody can play it. `emergency_only`: somebody can stand there, and that is all. */
  kind: 'none' | 'emergency_only';
  text: string;
}

export interface BenchReview {
  rows: BenchRow[];
  /** The required positions nobody covers credibly. */
  gaps: CoverageGap[];
  /** Each function a bench is for, with who covers it and how well: the bench as a collection of functions, never one score. */
  functions: BenchFunction[];
  /** Which hands the bench bats from, so a lineup that needs a left-handed bat off the bench is not left with none. */
  hands: { L: number; R: number; S: number };
  findings: string[];
  calibration: typeof BENCH_CALIBRATION;
}

const isOutfield = (p: number) => p >= 7 && p <= 9;

export function benchRole(p: Pick<BenchPlayer, 'covers' | 'listed'>): BenchRoleLabel {
  if (p.covers.includes(2)) return 'backup catcher';
  if (p.covers.some((c) => c === 4 || c === 5 || c === 6)) return 'utility infielder';
  if (p.covers.some(isOutfield)) return 'outfielder';
  if (p.covers.includes(3) || p.listed === 3 || p.listed === 10) return 'corner bat';
  return 'role not established';
}

export function coverQuality(pct: number | null): CoverQuality {
  if (pct === null) return 'unknown';
  return pct >= COVER_PCT.regular ? 'regular_quality' : pct >= COVER_PCT.credible ? 'credible' : 'emergency';
}

const QUALITY_RANK: Record<CoverQuality, number> = { regular_quality: 3, credible: 2, unknown: 1, emergency: 0 };
const QUALITY_WORD: Record<CoverQuality, string> = { regular_quality: 'regular quality', credible: 'a credible backup', emergency: 'an emergency cover', unknown: 'quality not established' };

/** The reads for a player: the adapter's ranked reads where it gave them, the bare playable positions (quality unknown) where it did not. */
function readsOf(p: BenchPlayer): CoverRead[] {
  const given = new Map((p.coverReads ?? []).map((r) => [r.position, r]));
  return p.covers
    .map((position): CoverRead => given.get(position) ?? { position, grade: null, pct: null, quality: 'unknown' })
    .sort((a, b) => QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality] || (b.pct ?? -1) - (a.pct ?? -1) || a.position - b.position);
}

const positionsWord = (positions: readonly number[]) => positions.map((p) => POSITION_LABELS[p]).join(' or ');

export function reviewBench(players: BenchPlayer[]): BenchReview {
  const rows: BenchRow[] = players
    .map((p): BenchRow => {
      const reads = readsOf(p);
      const credible = reads.filter((r) => r.quality === 'regular_quality' || r.quality === 'credible');
      const tags: BenchTag[] = [];
      if (p.batValue !== null && p.batValue !== undefined && p.batValue >= PINCH_HIT_PCT) tags.push('pinch_hitter');
      if (reads.some((r) => r.pct !== null && r.pct >= DEFENSIVE_PCT)) tags.push('defensive_replacement');
      if (p.runningPct !== null && p.runningPct !== undefined && p.runningPct >= RUNNER_PCT) tags.push('pinch_runner');
      if (p.partnerAt !== undefined) tags.push('platoon_partner');
      if (credible.length >= FLEXIBLE_POSITIONS) tags.push('flexible');
      return { ...p, coverReads: reads, role: benchRole(p), coverLabels: p.covers.map((c) => POSITION_LABELS[c] ?? String(c)), tags };
    })
    .sort((a, b) => b.pa - a.pa || a.name.localeCompare(b.name));

  const gaps: CoverageGap[] = [];
  const functions: BenchFunction[] = [];
  for (const need of REQUIRED_COVER) {
    const by = rows
      .flatMap((r) => r.coverReads.filter((c) => need.positions.includes(c.position)).map((c) => ({ row: r, read: c })))
      .sort((a, b) => QUALITY_RANK[b.read.quality] - QUALITY_RANK[a.read.quality] || (b.read.pct ?? -1) - (a.read.pct ?? -1) || a.row.name.localeCompare(b.row.name));
    const best = by[0]?.read.quality ?? null;
    const strength: FunctionStrength = by.length === 0 ? 'none' : best === 'emergency' ? 'thin' : best === 'unknown' ? 'unknown' : 'covered';
    const fnBy = by.map(({ row, read }) => ({
      playerId: row.playerId, name: row.name, quality: read.quality,
      note: `${POSITION_LABELS[read.position]}: ${read.grade !== null ? `grade ${read.grade}` : 'playable'}${read.pct !== null ? `, ${Math.round(read.pct)}th percentile of those listed there` : ''}`,
    }));
    const label = `Cover ${positionsWord(need.positions)}`;
    if (strength === 'none') {
      const text = `No bench player has a visible grade that supports playing ${positionsWord(need.positions)}: if a regular there is hurt or rests, the position is covered by somebody out of place.`;
      gaps.push({ key: need.key, label: need.label, positions: [...need.positions], kind: 'none', text });
      functions.push({ key: need.key, label, strength, by: fnBy, text });
    } else if (strength === 'thin') {
      const who = by.filter((b) => b.read.quality === 'emergency').map((b) => b.row.name).join(', ');
      const text = `The only bench cover for ${positionsWord(need.positions)} is an emergency one (${who}): the grade clears the playable line but sits in the bottom tenth of those listed there, so he can stand at the position without being a backup for it.`;
      gaps.push({ key: need.key, label: need.label, positions: [...need.positions], kind: 'emergency_only', text });
      functions.push({ key: need.key, label, strength, by: fnBy, text });
    } else {
      // A function that names two positions (second base or shortstop) is covered when either is; say so where one of them is not.
      const thinAt = need.positions.length > 1
        ? need.positions.filter((pos) => !by.some((b) => b.read.position === pos && b.read.quality !== 'emergency')).map((pos) => {
          const only = by.filter((b) => b.read.position === pos);
          return `${POSITION_LABELS[pos].replace(/^./, (c) => c.toUpperCase())} itself has ${only.length ? 'only an emergency cover' : 'no cover'}.`;
        })
        : [];
      functions.push({
        key: need.key, label, strength, by: fnBy,
        text: `${strength === 'unknown'
          ? `${by[0].row.name} can play ${positionsWord(need.positions)}, but how well against the position's peers is not established.`
          : `${by[0].row.name} is ${QUALITY_WORD[by[0].read.quality]} at ${POSITION_LABELS[by[0].read.position]}.`}${thinAt.length ? ` ${thinAt.join(' ')}` : ''}`,
      });
    }
  }

  const tagged = (tag: BenchTag) => rows.filter((r) => r.tags.includes(tag));
  const soft = (key: string, label: string, tag: BenchTag, none: string, some: (names: string, many: boolean) => string) => {
    const who = tagged(tag);
    functions.push({
      key, label, strength: who.length > 0 ? 'covered' : 'none',
      by: who.map((r) => ({ playerId: r.playerId, name: r.name, quality: null, note: TAG_LABEL[tag] })),
      text: who.length > 0 ? some(who.map((r) => r.name).join(', '), who.length > 1) : none,
    });
  };
  soft('pinch_hit', 'A bat to send up', 'pinch_hitter', 'Nobody on the bench is a bat that would be sent up for a regular.', (n, many) => `${n} ${many ? 'are' : 'is'} a bat worth sending up.`);
  soft('defensive', 'A glove to put in late', 'defensive_replacement', 'Nobody on the bench is a clear defensive upgrade at a position.', (n, many) => `${n} ${many ? 'are' : 'is'} a defensive upgrade at a position.`);
  soft('runner', 'A runner', 'pinch_runner', 'Nobody on the bench is a running threat.', (n, many) => `${n} ${many ? 'are' : 'is'} a runner.`);
  soft('flexibility', 'Positional flexibility', 'flexible', `Nobody on the bench can credibly play ${FLEXIBLE_POSITIONS} or more positions.`, (n) => `${n} can credibly play ${FLEXIBLE_POSITIONS} or more positions.`);

  const hands = { L: 0, R: 0, S: 0 };
  for (const r of rows) if (r.bats) hands[r.bats] += 1;
  const findings = gaps.map((g) => g.text);
  if (rows.length > 0 && hands.L === 0 && hands.S === 0) findings.push('Nobody on the bench bats left-handed or from both sides: there is no left-handed bat to send up.');
  if (rows.length > 0 && hands.R === 0 && hands.S === 0) findings.push('Nobody on the bench bats right-handed or from both sides: there is no right-handed bat to send up.');
  if (rows.length === 0) findings.push('There is no bench: every active position player is a regular.');
  return { rows, gaps, functions, hands, findings, calibration: BENCH_CALIBRATION };
}
