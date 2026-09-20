/**
 * The bench: is the club covered when a regular sits, and who is on it for what?
 *
 * A bench is judged differently from a lineup. Nobody expects a bench player to hit like a regular;
 * the questions are whether the positions that cannot be covered by anyone are covered by somebody
 * (a catcher, a shortstop, a center fielder), what each man is for (the backup catcher, the
 * utility infielder, the outfielder, the bat off the bench), and which hand he hits from.
 *
 * Pure: bench players and who can play where in, coverage and findings out. Who CAN play a position
 * is Player Development's cross-role evidence (visible grade above the playable line); this only
 * reads it.
 *
 * PROVISIONAL (policy): which positions must have a bench cover. Catcher, shortstop and center field
 * are the positions nobody plays without practice; the corners are covered by anyone.
 */

import { provisional, type CalibrationStamp } from './calibration.js';
import { POSITION_LABELS } from './lineupPicture.js';

export const BENCH_CALIBRATION: CalibrationStamp = provisional('Which positions must have a bench cover is a roster-construction policy, not a fact of the game.');

/** PROVISIONAL (policy). Positions that need somebody on the bench who can play them. */
export const REQUIRED_COVER: ReadonlyArray<{ key: string; label: string; positions: readonly number[] }> = [
  { key: 'catcher', label: 'a catcher', positions: [2] },
  { key: 'middle_infield', label: 'a middle infielder (second base or shortstop)', positions: [4, 6] },
  { key: 'center_field', label: 'a center fielder', positions: [8] },
];

export interface BenchPlayer {
  playerId: number;
  name: string;
  bats: 'R' | 'L' | 'S' | null;
  pa: number;
  /** Positions (2-9) where his visible grade supports playing there. */
  covers: number[];
  /** His bat as a working value (percentile of MLB hitters); null when unknown. */
  batValue: number | null;
  listed: number | null;
}

export type BenchRoleLabel = 'backup catcher' | 'utility infielder' | 'outfielder' | 'corner bat' | 'role not established';

export interface BenchRow extends BenchPlayer {
  role: BenchRoleLabel;
  coverLabels: string[];
}

export interface CoverageGap {
  key: string;
  label: string;
  positions: number[];
  text: string;
}

export interface BenchReview {
  rows: BenchRow[];
  gaps: CoverageGap[];
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

export function reviewBench(players: BenchPlayer[]): BenchReview {
  const rows: BenchRow[] = players
    .map((p) => ({ ...p, role: benchRole(p), coverLabels: p.covers.map((c) => POSITION_LABELS[c] ?? String(c)) }))
    .sort((a, b) => b.pa - a.pa || a.name.localeCompare(b.name));
  const gaps: CoverageGap[] = [];
  for (const need of REQUIRED_COVER) {
    if (rows.some((r) => r.covers.some((c) => need.positions.includes(c)))) continue;
    gaps.push({ key: need.key, label: need.label, positions: [...need.positions], text: `No bench player has a visible grade that supports playing ${need.positions.map((p) => POSITION_LABELS[p]).join(' or ')}: if a regular there is hurt or rests, the position is covered by somebody out of place.` });
  }
  const hands = { L: 0, R: 0, S: 0 };
  for (const r of rows) if (r.bats) hands[r.bats] += 1;
  const findings = gaps.map((g) => g.text);
  if (rows.length > 0 && hands.L === 0 && hands.S === 0) findings.push('Nobody on the bench bats left-handed or from both sides: there is no left-handed bat to send up.');
  if (rows.length > 0 && hands.R === 0 && hands.S === 0) findings.push('Nobody on the bench bats right-handed or from both sides: there is no right-handed bat to send up.');
  if (rows.length === 0) findings.push('There is no bench: every active position player is a regular.');
  return { rows, gaps, hands, findings, calibration: BENCH_CALIBRATION };
}
