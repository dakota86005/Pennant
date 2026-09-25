/**
 * The roster review's per-save calibration from the harness (D-053, cycle 1; docs/CALIBRATION.md section 12):
 *
 *   npm run calibrate roster-review            fit and print every group, write nothing
 *   npm run calibrate roster-review --refit    force a refit and record it in history.db (a failing refit never replaces an adopted one)
 *
 * The same code the refit worker runs (`mlbCalibrationRefit.ts` registrations, `saveCalibration.ts`).
 */

import '../../server/mlbCalibrationRefit.js';
import { computeCalibrationRefits, recordCalibrationRefits, type PendingCalibration } from '../../server/saveCalibration.js';

const f = (n: number | null | undefined, d = 3) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(d));

export function printPending(pending: PendingCalibration[]): void {
  for (const p of pending) {
    const o = p.outcome;
    console.log(`\n${o.subsystem}/${o.component} (${o.method}), league ${o.leagueId}, basis ${o.basis ?? '—'}: ${o.refit ? (o.adopted ? 'WOULD ADOPT' : 'NOT ADOPTED') : 'not fitted'} (${Math.round(o.ms ?? 0)} ms)`);
    console.log(`  ${o.reason}`);
    if (!p.run) continue;
    const r = p.run.record;
    console.log(`  window: ${r.window.seasons.length ? `${r.window.seasons[0]}–${r.window.seasons[r.window.seasons.length - 1]}` : '—'}, ${r.window.sample} ${r.window.unit}; share still the starting values ${f(r.priorWeight.overall, 2)}`);
    for (const c of r.heldOut) {
      console.log(`    ${c.kind.padEnd(10)} ${c.part.padEnd(34)} n ${String(c.n).padStart(5)}  expected ${f(c.expected, 4)}  observed ${f(c.observed, 4)}${c.se != null ? ` (se ${f(c.se, 4)})` : ''}${c.prior != null ? `  starting values ${f(c.prior, 4)}` : ''}  ${c.passed === null ? 'not scored' : c.passed ? 'pass' : 'FAIL'}`);
    }
    for (const n of r.notes) console.log(`  note: ${n}`);
  }
}

export function rosterReviewSection(league: number, argv: string[]): void {
  console.log(`\n${'='.repeat(78)}\n12. Roster review: the save's own yardsticks (standards, aging, glove weights)\n${'='.repeat(78)}`);
  const refit = argv.includes('--refit');
  const pending = computeCalibrationRefits({ leagues: [league], force: true });
  printPending(pending);
  if (refit) {
    const out = recordCalibrationRefits(pending);
    console.log(`\nrecorded: ${out.filter((o) => o.refit).map((o) => `${o.component} ${o.adopted ? 'adopted' : 'not adopted'}`).join(', ')}`);
  } else {
    console.log('\n(nothing written; --refit records these fits in history.db)');
  }
}
