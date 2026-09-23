/**
 * Injury proneness: the one declared reader of `players.prone_overall`, `prone_leg`, `prone_back`
 * and `prone_arm` (D-053).
 *
 * Status: a KNOWN FACT, like personality. The owner states that injury proneness is shown in game
 * (owner, 2026-09-22), so it is read as an exported fact with the basis `owner_attested`, not as a
 * hidden true-talent value (D-017 does not apply to it). It is not a rating and never reaches a
 * judgment of ability.
 *
 * Schema-tolerant (D-007): a missing column, a null, or a 0 is unknown, never "normal". On the
 * imported save no active player has a 0 and the retired players the export did not fill in are
 * exactly the ones at 0 (15,389 of 118,654), so 0 is read as "not filled in", not as a level.
 *
 * Every other module obtains proneness from here (`tests/playerValueBoundary.test.ts`).
 */

import { db, tableColumns, tableExists } from './db.js';
import { fromExport, unknownBecause, type Sourced } from './provenance.js';

export const PRONENESS_COLUMNS = ['prone_overall', 'prone_leg', 'prone_back', 'prone_arm'] as const;

export const PRONENESS_ATTESTATION = 'Injury proneness is shown in game (owner, 2026-09-22): a known fact, basis owner_attested';

export interface InjuryProneness {
  overall: Sourced<number>;
  leg: Sourced<number>;
  back: Sourced<number>;
  arm: Sourced<number>;
  basis: 'owner_attested';
  attestation: string;
}

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Proneness for the players asked about (or every player when `ids` is null), keyed by id. */
export function readInjuryProneness(ids: number[] | null): Map<number, InjuryProneness> {
  const out = new Map<number, InjuryProneness>();
  const present = tableExists('players') ? new Set(tableColumns('players')) : null;
  if (!present?.has('player_id')) return out;
  const columns = PRONENESS_COLUMNS.filter((c) => present.has(c));
  const of = (row: Record<string, unknown>, column: (typeof PRONENESS_COLUMNS)[number]): Sourced<number> => {
    const source = `players.${column}`;
    if (!present.has(column)) return unknownBecause('not_exported_by_ootp', source, `The export has no ${column} column.`);
    const v = numberOrNull(row[column]);
    if (v === null) return unknownBecause('not_exported_by_ootp', source, `${column} is blank.`);
    if (v <= 0) return unknownBecause('not_exported_by_ootp', source, `${column} is 0: not filled in by the export.`);
    return { ...fromExport(v, source), note: PRONENESS_ATTESTATION };
  };
  const build = (row: Record<string, unknown>) => ({
    overall: of(row, 'prone_overall'), leg: of(row, 'prone_leg'), back: of(row, 'prone_back'), arm: of(row, 'prone_arm'),
    basis: 'owner_attested' as const, attestation: PRONENESS_ATTESTATION,
  });
  const select = `SELECT player_id${columns.map((c) => `, "${c}"`).join('')} FROM players`;
  const read = (rows: Array<Record<string, unknown>>) => {
    for (const row of rows) {
      const id = numberOrNull(row.player_id);
      if (id !== null) out.set(id, build(row));
    }
  };
  if (ids === null) read(db.prepare(select).all() as Array<Record<string, unknown>>);
  else {
    for (let at = 0; at < ids.length; at += 500) {
      const chunk = ids.slice(at, at + 500);
      read(db.prepare(`${select} WHERE player_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as Array<Record<string, unknown>>);
    }
    // A player the export does not have at all: every figure unknown
    for (const id of ids) if (!out.has(id)) out.set(id, build({}));
  }
  return out;
}
