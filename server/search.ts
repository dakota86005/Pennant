/**
 * Search, for the ⌘K palette and the toolbar (N7 Stage A; SWIFTUI_REBUILD.md section 3.6 "Search"): players (ours and
 * the league's), clubs and views, each with where it opens.
 *
 * - **An index built once per import**, never the league read on every keystroke: the players still in the game, the
 *   major-league clubs and the views the catalog serves, each with its words split and folded (case and accents set
 *   aside). Built on the first search after an import (or warmed after it) and kept until the served league changes.
 * - **Every word of the query** must begin a word of the entry, as the palette matches views.
 * - **A stated order, no hidden score:** what the GM follows first, then entries whose name starts with what was typed,
 *   then our organization's players, then by name (`presentation/searchWords.ts` says so).
 *
 * It reads names, clubs and positions only: no rating, no value.
 */
import type { DeptId } from './contract/presentation.js';
import { databaseGeneration, db, tableColumns, tableExists } from './db.js';
import { servedDepartments } from './presentation/catalog.js';
import { POSITION_NAMES } from './positionNeeds.js';

export type SearchEntryKind = 'player' | 'club' | 'view';

export interface SearchEntry {
  kind: SearchEntryKind;
  /** A player or team id, or a view's `department/view`. */
  id: string;
  name: string;
  /** The name's words, folded, for matching. */
  words: string[];
  /** The whole name, folded, for "starts with what was typed". */
  folded: string;
  // A player's
  playerId?: number;
  teamId?: number | null;
  orgId?: number | null;
  position?: string | null;
  level?: number | null;
  clubName?: string | null;
  // A club's
  abbr?: string | null;
  division?: string | null;
  // A view's
  department?: DeptId;
  view?: string;
  departmentName?: string;
}

/** Case, accents and punctuation set aside: "José Ramírez" and "jose ramirez" read the same. */
export function fold(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const wordsOf = (...parts: Array<string | null | undefined>): string[] =>
  [...new Set(parts.filter((p): p is string => !!p).flatMap((p) => fold(p).split(' ')).filter(Boolean))];

let index: { key: string; entries: SearchEntry[]; ms: number } | null = null;
let builds = 0;

/** How many times the index was built (the tests' "never a scan per keystroke"). */
export const searchIndexBuilds = (): number => builds;

/** Forgets the index (a test changed the league in place). */
export function forgetSearchIndex(): void {
  index = null;
}

function buildIndex(): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const teams = tableExists('teams') ? new Set(tableColumns('teams')) : new Set<string>();
  const clubs = new Map<number, { name: string; abbr: string | null; level: number | null; org: number | null }>();
  if (teams.has('team_id') && teams.has('name')) {
    const label = teams.has('nickname') ? `CASE WHEN nickname IS NULL OR nickname = '' OR name = nickname THEN name ELSE name || ' ' || nickname END` : 'name';
    for (const r of db.prepare(`SELECT team_id, ${label} AS label, ${teams.has('abbr') ? 'abbr' : 'NULL'} AS abbr, ${teams.has('level') ? 'level' : 'NULL'} AS level,
        ${teams.has('parent_team_id') ? 'parent_team_id' : 'NULL'} AS parent, ${teams.has('allstar_team') ? 'allstar_team' : '0'} AS allstar FROM teams`).all() as Array<Record<string, unknown>>) {
      const id = Number(r.team_id);
      const level = typeof r.level === 'number' ? r.level : null;
      const parent = typeof r.parent === 'number' && r.parent > 0 ? r.parent : null;
      clubs.set(id, { name: String(r.label), abbr: typeof r.abbr === 'string' ? r.abbr : null, level, org: level === 1 ? id : parent });
      if (level === 1 && !Number(r.allstar)) {
        entries.push({ kind: 'club', id: String(id), name: String(r.label), words: wordsOf(String(r.label), typeof r.abbr === 'string' ? r.abbr : null), folded: fold(String(r.label)), teamId: id, abbr: typeof r.abbr === 'string' ? r.abbr : null, division: null });
      }
    }
  }
  // The clubs' divisions ("NL West"), for their line
  if (teams.has('division_id') && tableExists('divisions') && tableExists('sub_leagues')) {
    try {
      const subAbbr = new Set(tableColumns('sub_leagues')).has('abbr') ? 's.abbr' : 'NULL';
      for (const r of db.prepare(`SELECT t.team_id, ${subAbbr} AS sub, d.name AS division FROM teams t
          LEFT JOIN sub_leagues s ON s.league_id = t.league_id AND s.sub_league_id = t.sub_league_id
          LEFT JOIN divisions d ON d.league_id = t.league_id AND d.sub_league_id = t.sub_league_id AND d.division_id = t.division_id
          WHERE t.level = 1`).all() as Array<Record<string, unknown>>) {
        const entry = entries.find((e) => e.kind === 'club' && e.teamId === Number(r.team_id));
        const div = typeof r.division === 'string' ? r.division.replace(/\s+Division$/i, '') : null;
        if (entry && div) entry.division = [typeof r.sub === 'string' ? r.sub : null, div].filter(Boolean).join(' ');
      }
    } catch {
      // An export without the division tables: the clubs keep their names
    }
  }
  const players = tableExists('players') ? new Set(tableColumns('players')) : new Set<string>();
  if (players.has('player_id') && players.has('first_name') && players.has('last_name')) {
    const rows = db.prepare(`SELECT player_id, first_name, last_name, ${players.has('team_id') ? 'team_id' : 'NULL'} AS team_id,
        ${players.has('organization_id') ? 'organization_id' : 'NULL'} AS org, ${players.has('position') ? 'position' : 'NULL'} AS position
      FROM players ${players.has('retired') ? 'WHERE COALESCE(retired, 0) = 0' : ''}`).all() as Array<Record<string, unknown>>;
    for (const r of rows) {
      const name = `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim();
      if (!name) continue;
      const teamId = typeof r.team_id === 'number' && r.team_id > 0 ? r.team_id : null;
      const club = teamId !== null ? clubs.get(teamId) : undefined;
      entries.push({
        kind: 'player', id: String(r.player_id), name, words: wordsOf(name), folded: fold(name), playerId: Number(r.player_id),
        teamId, orgId: typeof r.org === 'number' && r.org > 0 ? r.org : club?.org ?? null,
        position: typeof r.position === 'number' ? POSITION_NAMES[r.position] ?? null : null,
        level: club?.level ?? null, clubName: club?.name ?? null,
      });
    }
  }
  for (const d of servedDepartments(null)) {
    for (const v of d.views) {
      entries.push({ kind: 'view', id: `${d.id}/${v.id}`, name: v.name, words: wordsOf(v.name, d.name), folded: fold(v.name), department: d.id, view: v.id, departmentName: d.name });
    }
  }
  return entries;
}

/** The index for the served league: kept until an import (or anything that swaps the league) changes it. */
export function searchIndex(importStamp: string | null): { entries: SearchEntry[]; ms: number } {
  const key = `${databaseGeneration()}|${importStamp ?? 'none'}`;
  if (index?.key === key) return index;
  const started = performance.now();
  const entries = buildIndex();
  builds += 1;
  index = { key, entries, ms: Math.round(performance.now() - started) };
  return index;
}

/** Whether every word of the query begins a word of the entry. */
export function matches(entry: SearchEntry, queryWords: readonly string[]): boolean {
  return queryWords.every((q) => entry.words.some((w) => w.startsWith(q)));
}

export interface SearchQuery {
  words: string[];
  folded: string;
}

export const queryOf = (q: string): SearchQuery => {
  const folded = fold(q);
  return { words: folded ? folded.split(' ') : [], folded };
};
