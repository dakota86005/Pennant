/**
 * Which kind of ratings an export carries (D-061): OOTP's CSV export settings, read as the import runs.
 *
 * OOTP writes a save's CSV-dump settings to `<save>.lg/settings/db_dump_standard_csv.cfg`, a plain-text file of lines
 * such as `73 0 Show OSA player ratings` and `74 1 Show real player ratings`: an id, a value, then the option's label.
 * Pennant reads the options by their LABEL, never by the number alone (the ids are OOTP's and nothing documents them),
 * and records which kind of ratings the export was written with:
 *
 *   scouted  none of "OSA", "real" or "no ratings" is switched on: the export shows the ratings as the club's scouts see them
 *   real     "Show real player ratings" is on: true ratings, as OOTP names the option
 *   osa      "Show OSA player ratings" is on: the league's shared scouting service's view
 *   none     "Show no player ratings" is on: the export carries no ratings, and every rating reads as unknown
 *   unknown  the file is missing or unreadable, a label is missing, or more than one of them is on
 *
 * And one kind no export setting names (D-067): `scouted-complete`, our own scouts' complete reports, read from the
 * export's `players_scouted_ratings` file when it carries rows for our club. The settings never produce it: it is the
 * kind of the EVIDENCE (and of a snapshot taken from it), decided in `scoutedEvidence.ts`, while an import's record
 * keeps the main tables' kind.
 *
 * The app works on any of them (the owner's decision 9, 2026-09-26): the mode is noted, never enforced. What it changes
 * is what a rating is said to be (its source, in the basis) and how rating history is read: two snapshots taken in
 * different known modes are a switch, never development. An unreadable setting is `unknown`, never assumed to be the
 * scouts' view (D-018). Nothing here writes to OOTP's files.
 */
import fs from 'node:fs';
import path from 'node:path';

export type RatingMode = 'scouted' | 'real' | 'osa' | 'none' | 'unknown' | 'scouted-complete';

/** The export's rating mode as the import recorded it, with how it was read. */
export interface RatingModeRecord {
  mode: RatingMode;
  /** "Additional complete scouted ratings" (OOTP's option), when the file says; null when it does not. */
  additionalScouted: boolean | null;
  /** Where the mode came from: the save's export settings, or why they could not be read. */
  source: 'export_settings' | 'settings_missing' | 'settings_unreadable' | 'save_not_found' | 'settings_changed_after_export';
  /** Why the mode is unknown, in a sentence; null when it is known. */
  reason: string | null;
}

/** The export settings' file, inside the save. */
export const EXPORT_SETTINGS_FILE = path.join('settings', 'db_dump_standard_csv.cfg');

const LABELS = {
  osa: 'show osa player ratings',
  real: 'show real player ratings',
  none: 'show no player ratings',
  additional: 'additional complete scouted ratings',
} as const;

/** One option's value by its label: true, false, or null when the label is absent or its value is not 0 or 1. */
function optionsByLabel(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*\d+\s+(\S+)\s+(.+?)\s*$/.exec(raw);
    if (!m) continue;
    out.set(m[2].toLowerCase().replace(/\s+/g, ' '), m[1]);
  }
  return out;
}

const flag = (value: string | undefined): boolean | null => (value === '1' ? true : value === '0' ? false : null);

/** The rating mode an export-settings file describes. Pure: the text in, the record out. */
export function parseRatingMode(text: string): RatingModeRecord {
  const options = optionsByLabel(text);
  const osa = flag(options.get(LABELS.osa));
  const real = flag(options.get(LABELS.real));
  const none = flag(options.get(LABELS.none));
  const additionalScouted = flag(options.get(LABELS.additional));
  const unknown = (reason: string): RatingModeRecord => ({ mode: 'unknown', additionalScouted, source: 'export_settings', reason });
  const on = [osa && 'osa', real && 'real', none && 'none'].filter((m): m is 'osa' | 'real' | 'none' => !!m);
  if (on.length > 1) return unknown('OOTP\'s export settings have more than one kind of ratings switched on.');
  if (on.length === 1) return { mode: on[0], additionalScouted, source: 'export_settings', reason: null };
  // Nothing is on: the scouts' view, but only when every one of the three options was read as off
  if (osa === false && real === false && none === false) return { mode: 'scouted', additionalScouted, source: 'export_settings', reason: null };
  return unknown('OOTP\'s export settings don\'t say which kind of ratings the export carries.');
}

/**
 * The rating mode of the save at `lgPath` (its export settings, read now); `unknown` with the reason when they can't be
 * read. OOTP writes the settings file when the setting changes, not at each export, so a file written after the export
 * (`exportWrittenAtMs`, its newest CSV) may describe a later setting than the export was made with: then the kind is
 * unknown for that export (N3.5 review, finding 6), never the later setting's.
 */
export function readRatingMode(lgPath: string | null, exportWrittenAtMs: number | null = null): RatingModeRecord {
  if (!lgPath) return { mode: 'unknown', additionalScouted: null, source: 'save_not_found', reason: 'Pennant couldn\'t find the save, so it couldn\'t read its export settings.' };
  const file = path.join(lgPath, EXPORT_SETTINGS_FILE);
  let text: string;
  try {
    if (exportWrittenAtMs !== null && fs.statSync(file).mtimeMs > exportWrittenAtMs) {
      return {
        mode: 'unknown', additionalScouted: null, source: 'settings_changed_after_export',
        reason: 'OOTP\'s export settings changed after this export was written, so which kind of ratings it carries isn\'t known.',
      };
    }
    text = fs.readFileSync(file, 'latin1');
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
    return {
      mode: 'unknown',
      additionalScouted: null,
      source: missing ? 'settings_missing' : 'settings_unreadable',
      reason: missing ? 'The save has no export settings file, so the kind of ratings isn\'t known.' : 'Pennant couldn\'t read the save\'s export settings.',
    };
  }
  return parseRatingMode(text);
}

/**
 * The mode in the GM's words, for the data status and a rating's basis: a name, a help tag (75 characters at most), a
 * sentence, and the name a switch between two kinds uses where two kinds share a short name.
 */
export const RATING_MODE_WORDS: Record<RatingMode, { short: string; hint: string; long: string; named?: string }> = {
  scouted: {
    short: 'Your scouts\' view',
    hint: 'OOTP\'s export shows the ratings as your scouts see them',
    long: 'The ratings are your scouts\' view (OOTP\'s export shows scouted ratings).',
  },
  real: {
    short: 'True ratings',
    hint: 'OOTP\'s export setting "Show real player ratings" is on',
    long: 'The ratings are true ratings (OOTP\'s export setting "Show real player ratings" is on).',
  },
  osa: {
    short: 'OSA\'s view',
    hint: 'OOTP\'s export setting "Show OSA player ratings" is on',
    long: 'The ratings are the league scouting service\'s view (OOTP\'s export setting "Show OSA player ratings" is on).',
  },
  none: {
    short: 'No ratings',
    hint: 'The export carries no ratings, so every rating is unknown',
    long: 'The export carries no ratings (OOTP\'s export setting "Show no player ratings" is on), so every rating is unknown.',
  },
  'scouted-complete': {
    short: 'Your scouts\' view',
    hint: 'Your scouts\' full reports, from the export\'s scouted ratings file',
    long: 'The ratings are your own scouts\' full reports (OOTP\'s export option "Additional complete scouted ratings").',
    named: 'your scouts\' full reports',
  },
  unknown: {
    short: 'Not known',
    hint: 'Pennant couldn\'t tell which kind of ratings the export carries',
    long: 'Which kind of ratings the export carries isn\'t known.',
  },
};

/** Whether two recorded modes are a switch: both known and different. An unrecorded or unknown mode is never evidence of one. */
export function isModeSwitch(a: RatingMode | null | undefined, b: RatingMode | null | undefined): boolean {
  return !!a && !!b && a !== 'unknown' && b !== 'unknown' && a !== b;
}

/** A kind's name inside a sentence about a switch: its own name where two kinds share a short one. */
export const ratingModeNamed = (mode: RatingMode): string => RATING_MODE_WORDS[mode].named ?? RATING_MODE_WORDS[mode].short.toLowerCase();

/**
 * The stamp of a snapshot read from our scouts' full reports (D-067): their kind, with what the export's settings said
 * kept beside it. Never the main tables' kind: the two are not established to be the same numbers.
 */
export function ourScoutsRecord(record: RatingModeRecord | null): RatingModeRecord {
  return { mode: 'scouted-complete', additionalScouted: record?.additionalScouted ?? null, source: record?.source ?? 'settings_missing', reason: null };
}

/**
 * The stamp of a snapshot read in the evidence's kind (D-067): our scouts' full reports, or OSA's view read from the file in
 * place of true ratings (review L6), stamped as that kind with what the export's settings said kept beside it; otherwise
 * the import's own record.
 */
export function evidenceRecord(record: RatingModeRecord | null, evidenceMode: RatingMode | null): RatingModeRecord | null {
  if (evidenceMode === 'scouted-complete') return ourScoutsRecord(record);
  if (evidenceMode === 'osa' && record && record.mode !== 'osa') {
    return { mode: 'osa', additionalScouted: record.additionalScouted ?? null, source: record.source ?? 'settings_missing', reason: null };
  }
  return record;
}

/**
 * Whether two ratings sources a fit records are the same ratings (D-068, the owner's decision): equal, or OSA's view either
 * way (in the main tables, `export:osa`, or in the file, `osa_file`). An unrecorded source is never assumed to be the same.
 */
export function sameRatingSource(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const osa = (id: string) => id === 'osa_file' || id === 'export:osa';
  return a === b || (osa(a) && osa(b));
}

/** A recorded ratings source in the GM's words, for a basis that says a fit rests on other ratings. */
export function ratingSourceNamed(id: string | null | undefined): string {
  if (!id) return 'ratings whose source wasn\'t recorded';
  if (id === 'osa_file' || id === 'evidence:osa' || id === 'export:osa') return 'OSA\'s view';
  if (id === 'our_scouts_file' || id === 'evidence:scouted-complete') return 'your scouts\' full reports';
  const mode = /^(?:export|evidence):(.+)$/.exec(id)?.[1] as RatingMode | undefined;
  return mode && RATING_MODE_WORDS[mode] ? ratingModeNamed(mode) : id;
}
