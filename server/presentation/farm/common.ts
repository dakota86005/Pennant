/**
 * What the farm's views share (N10): the head every view carries, a claim's source, a finding in the GM's words, a
 * player's line and where it opens. Pure: it words what it is handed.
 */
import type { BasisLine, Cell, Certainty, Target } from '../../contract/presentation.js';
import type { FarmFinding } from '../../farmAffiliate.js';
import { asOfCell } from '../frontOffice/desk.js';
import { basis, cell, row, target } from '../claim.js';
import type { FarmContext } from './input.js';
import type { FarmEvidenceRow, FarmFactRow, FarmFindingView, FarmPlayerLine, FarmViewHead } from './types.js';
import { claim } from '../claim.js';
import { ownerWord, plain, plainAll, severityWord } from './words.js';

export function headOf(ctx: FarmContext): FarmViewHead {
  return {
    orgId: ctx.orgId,
    importStamp: ctx.importStamp,
    reportStamp: ctx.reportStamp,
    asOf: asOfCell({ orgId: ctx.orgId, club: null, importStamp: ctx.importStamp, reportStamp: ctx.reportStamp, gameDate: ctx.gameDate }),
    preparedBy: ctx.preparedBy,
  };
}

/** The source a farm claim names. */
export function sourceOf(ctx: FarmContext, specialist: string, sample?: string) {
  return { department: ctx.department, specialist, asOf: ctx.importStamp, gameDate: ctx.gameDate, ...(sample ? { sample } : {}) };
}

/** A basis of objective facts read from the export (or the farm's count of them). */
export function factBasis(ctx: FarmContext, specialist: string, because: BasisLine[], unknown: string[] = []) {
  return basis({ because: because.length ? because : [{ label: 'Read from', value: 'The imported export' }], source: sourceOf(ctx, specialist), unknown: plainAll(unknown), wouldChange: [], lean: null, certainty: 'fact' });
}

/** A basis for a specialist's judgment, called as the farm calls its lines (policy, or provisional while any line is). */
export function judgmentBasis(
  ctx: FarmContext,
  specialist: string,
  input: { because: BasisLine[]; unknown?: string[]; wouldChange?: string[]; called: { certainty: Certainty; stamp: string } },
) {
  return basis({
    because: input.because.length ? input.because : [{ label: 'From', value: specialist }],
    source: sourceOf(ctx, specialist),
    unknown: plainAll(input.unknown ?? []),
    wouldChange: plainAll(input.wouldChange ?? []),
    lean: null,
    ...input.called,
  });
}

/** A judgment called on a stated policy (its stamp in the GM's words). */
export const policyCalled = (stamp: string): { certainty: Certainty; stamp: string } => ({ certainty: 'policy', stamp });

/** How the farm's lines are called: provisional when any line it used is, else policy (MINOR_LEAGUE_OPERATIONS.md Part 7). */
export function linesCalled(calibration: ReadonlyArray<{ status: string }>): { certainty: Certainty; stamp: string } {
  const provisional = calibration.filter((c) => c.status === 'provisional').length;
  return {
    certainty: provisional > 0 ? 'provisional' : 'policy',
    stamp: provisional > 0
      ? `The farm's stated lines, ${provisional} of ${calibration.length} still starting values`
      : `The farm's stated lines (${calibration.length})`,
  };
}

/** Where a player opens in Farm & Development: his Decision (the view, keyed by his id). */
export const decisionTarget = (playerId: number): Target => target({ kind: 'decision', department: 'farm', key: String(playerId) });

/** An affiliate opened on the Affiliates view. */
export const affiliateTarget = (teamId: number): Target => target({ kind: 'view', department: 'farm', view: 'affiliates', key: String(teamId) });

export function playerLine(playerId: number, name: string, line: string, open: Target = decisionTarget(playerId)): FarmPlayerLine {
  return { playerId, name, line: cell(plain(line) || name), open };
}

/** A sentence cell, plain; null when there is nothing to say. */
export function sentenceCell(text: string | null | undefined, extra: { tone?: Cell['tone']; hint?: string } = {}): Cell | null {
  const t = text ? plain(text) : '';
  return t ? cell(t, extra) : null;
}

/** Sentence cells, plain, with the empty ones and repeats left out. */
export const sentenceCells = (lines: readonly string[]): Cell[] => plainAll(lines).map((l) => cell(l));

export function factRow(id: string, label: string, value: string, extra: { tone?: Cell['tone']; hint?: string } = {}, sortValue: number | string | null = value): FarmFactRow {
  return row(id, { label: cell(plain(label)), value: cell(plain(value) || 'Not known', extra) }, { label: plain(label), value: sortValue });
}

export function evidenceRow(id: string, label: string, value: string, basisText: string, extra: { tone?: Cell['tone'] } = {}): FarmEvidenceRow {
  const b = plain(basisText);
  return row(
    id,
    { label: cell(plain(label) || 'Evidence'), value: cell(plain(value) || 'Not known', extra), why: b ? cell(b) : cell('No more to it', { tone: 'neutral' }) },
    { label: plain(label), value: plain(value), why: b || null },
  );
}

/** One finding in the GM's words: its severity, its sentence (with its evidence as the basis), who raised it. */
export function findingView(ctx: FarmContext, f: FarmFinding, called: { certainty: Certainty; stamp: string }): FarmFindingView {
  const sev = severityWord(f.severity);
  const owner = ownerWord(f.owner);
  return {
    id: f.id,
    severity: cell(sev.text, { tone: sev.tone }),
    headline: claim({
      text: plain(f.headline),
      tone: sev.tone,
      basis: judgmentBasis(ctx, owner, {
        because: f.evidence.map((e) => ({ label: plain(e.label), value: plain(`${e.value}${e.basis ? ` (${e.basis})` : ''}`) })),
        unknown: f.missing,
        wouldChange: f.wouldResolve,
        called,
      }),
      links: f.players.length === 1 ? [decisionTarget(f.players[0].playerId)] : [],
    }),
    owner: cell(owner),
    evidence: f.evidence.map((e, i) => evidenceRow(`${f.id}:e${i}`, e.label, e.value, e.basis)),
    players: f.players.map((p) => playerLine(p.playerId, p.name, p.note)),
    missing: sentenceCells(f.missing),
    wouldSettle: sentenceCells(f.wouldResolve),
    expanded: f.severity === 'critical',
  };
}

/** Findings, worst first, in the farm's own order within a severity. */
export function findingsWorstFirst<T extends { severity: string }>(findings: readonly T[]): T[] {
  const rank: Record<string, number> = { critical: 0, attention: 1, noted: 2 };
  return findings.map((f, i) => ({ f, i })).sort((a, b) => (rank[a.f.severity] ?? 3) - (rank[b.f.severity] ?? 3) || a.i - b.i).map((x) => x.f);
}
