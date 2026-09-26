/**
 * The import in words (SWIFTUI_REBUILD.md section 12, the N3 gaps): what an import is doing and which table it is on,
 * named for a person rather than by OOTP's file name; why an import did not finish; why a chosen save did not start
 * importing. The importer and the status decide nothing here: these are sentences about what they reported.
 */
import type { ImportStep, ImportWords } from '../importer.js';

/** OOTP's export files a GM would recognize, named in words (lower case: the name sits inside a sentence). */
const TABLE_NAMES: Record<string, string> = {
  players: 'players',
  players_batting: 'hitting ratings',
  players_pitching: 'pitching ratings',
  players_fielding: 'fielding ratings',
  players_contract: 'contracts',
  players_contract_extension: 'contract extensions',
  players_roster_status: 'roster status',
  players_injury_history: 'injury history',
  players_career_batting_stats: 'career hitting',
  players_career_pitching_stats: 'career pitching',
  players_career_fielding_stats: 'career fielding',
  players_game_batting: 'game logs (hitting)',
  players_game_pitching_stats: 'game logs (pitching)',
  players_streak: 'streaks',
  players_awards: 'awards',
  teams: 'clubs',
  team_record: 'standings',
  team_history_record: 'past standings',
  team_batting_stats: 'team hitting',
  team_pitching_stats: 'team pitching',
  team_fielding_stats_stats: 'team fielding',
  team_financials: 'club finances',
  team_roster: 'rosters',
  team_roster_staff: 'staff assignments',
  coaches: 'coaches and staff',
  leagues: 'leagues',
  sub_leagues: 'conferences',
  divisions: 'divisions',
  games: 'the schedule',
  games_score: 'box scores',
  trade_history: 'trades',
  messages: 'league news',
  projected_starting_pitchers: 'probable starters',
  human_managers: 'managers',
  parks: 'ballparks',
  cities: 'cities',
  nations: 'nations',
};

/** A table's name for a person, or null for a file this list does not name (its OOTP file name stays in the help tag). */
export function tableName(table: string): string | null {
  return TABLE_NAMES[table] ?? null;
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** An import step in words; a file with no name for a person reads as the export. */
export function importWords(step: ImportStep): ImportWords {
  if (step.phase === 'indexing') {
    return { phase: 'Getting the league ready', table: 'The league', display: 'Getting the league ready' };
  }
  const name = tableName(step.table) ?? 'the export';
  const verb = step.phase === 'reading' ? 'Reading' : 'Writing';
  return {
    phase: step.phase === 'reading' ? 'Reading the export' : 'Writing the league',
    table: capitalize(name),
    display: `${verb} ${name} · ${step.fileIndex} of ${step.files}`,
  };
}

/** Why an import is not where the GM expects it, in a sentence, with the raw message kept for the log. */
export interface ImportNote {
  /** What happened: `failed` (it stopped on an error), `interrupted` (the server stopped partway), `exportMissing`. */
  kind: 'failed' | 'interrupted' | 'exportMissing';
  text: string;
  /** The raw message behind it, for the log and a help tag; never the visible line. */
  detail: string | null;
}

/** A failed import's message as a sentence the GM can act on. */
export function failedImportText(message: string): string {
  if (/No \.csv files found/i.test(message)) return 'The export folder has no files to import. Export the league from OOTP again, then import.';
  if (/SQLITE_BUSY|database is locked/i.test(message)) return 'Another program was using Pennant\'s league file. Import again in a moment.';
  if (/EACCES|EPERM|permission/i.test(message)) return 'Pennant wasn\'t allowed to read the export. Check the folder\'s permissions, then import again.';
  if (/ENOENT|no such file/i.test(message)) return 'A file in the export went missing while it was read. Export the league from OOTP again, then import.';
  if (/ENOSPC|disk is full|SQLITE_FULL/i.test(message)) return 'The disk is full, so the import couldn\'t finish. Free some space, then import again.';
  return 'The import stopped before it finished. Import again; the details are in the server log.';
}

/** What the status says about the import, when something is not as it should be; null when nothing is. */
export function importNote(state: {
  importing: boolean;
  lastError: string | null;
  interruptedSince: string | null;
  configured: boolean;
  csvDirExists: boolean;
}): ImportNote | null {
  if (state.lastError) return { kind: 'failed', text: failedImportText(state.lastError), detail: state.lastError };
  if (state.interruptedSince) {
    return {
      kind: 'interrupted',
      text: state.importing
        ? 'The last import stopped before it finished, so Pennant is importing the export again.'
        : 'The last import stopped before it finished. Import again to finish it.',
      detail: null,
    };
  }
  if (state.configured && !state.csvDirExists && !state.importing) {
    return {
      kind: 'exportMissing',
      text: 'Pennant can\'t find the save\'s export folder. Export the league from OOTP, or choose the save again.',
      detail: null,
    };
  }
  return null;
}

/** Why a chosen save did not start importing: its export folder is not there yet. */
export const EXPORT_NOT_FOUND =
  'That save has no export yet. In OOTP, export the league\'s database, then choose the save again.';
