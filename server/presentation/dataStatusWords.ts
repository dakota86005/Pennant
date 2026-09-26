/**
 * The data status in words (`GET /api/v2/data-status`): the React panel's lines (`src/dataStatusModel.ts`) ported to the
 * server, plus what the Mac app's shell wanted to say at N3 and could not (SWIFTUI_REBUILD.md section 12): the level, each
 * source's state and lag, why the transaction log is unavailable, how the save was found, a display form of every date,
 * and a sentence wherever a value is missing. It reads the same `DataStatus` `/api/data-status` serves and decides
 * nothing new: every state and lag is the freshness model's (`dataFreshness.ts`, D-022).
 *
 * The React panel keeps its own copy (`src/dataStatusModel.ts`) until cutover: the Mac app's words are plainer in two places
 * (the headline says what the level means instead of naming it, and dates spell the month), so the two are not held to
 * the same strings; both read the same states and lags.
 */
import type { Cell, Claim, Row, Tone } from '../contract/presentation.js';
import { gameDateWords, type DataStatus } from '../dataStatus.js';
import { parseGameDate, type GameDate, type RosterEvidenceLevel } from '../dataFreshness.js';
import type { SaveDiscoveryMethod } from '../ootpSave.js';
import { timestampWords } from '../timeWords.js';
import { basis, cell, claim, row } from './claim.js';

/** A game date as served (unpadded, as OOTP writes it, or null) and as the app shows it. */
export interface GameDateText {
  served: GameDate | null;
  display: string;
}

/** One line of the data status: a source ("League data") and its state ("Behind by 2 days"). */
export interface DataStatusRow extends Row<'source' | 'state'> {}
/** One fact of the data status: what it is ("Game date") and its value ("May 15, 2026"), or why it is missing. */
export interface DataStatusFact extends Row<'label' | 'value'> {}

export interface DataStatusView {
  /** The freshness model's level, for the symbol beside the headline (`current`, `partial`, `stale`, `unavailable`). */
  level: RosterEvidenceLevel;
  /** The headline, with the reasons and what would change it in its basis. */
  headline: Claim;
  /** The window's subtitle, short enough for the title bar: the game date and a word or two ("May 15, 2026 · Log behind"). */
  subtitle: string;
  /** The subtitle in full, for its help tag: the game date and the headline ("May 15, 2026 · Transactions 2 days behind"). */
  subtitleHint: string;
  gameDate: GameDateText;
  /** League data, transactions, the OOTP save and roster evidence. */
  sources: DataStatusRow[];
  /** Dates and places, every one present: a missing value says why. */
  facts: DataStatusFact[];
  /** What to do about it, when there is something to do. */
  action: Cell | null;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** An OOTP game date (padded or not) in words; null stays null. */
export function gameDateDisplay(raw: string | null | undefined): string | null {
  const parsed = parseGameDate(raw);
  return parsed ? gameDateWords(parsed) : null;
}


/** How the save was found, in words. */
export const DISCOVERY_WORDS: Record<SaveDiscoveryMethod, string> = {
  csv_layout: 'Found from the export\'s folder',
  ancestor_lg: 'Found in a folder above the export',
  save_name_match: 'Found by the save\'s name',
  manual_override: 'Named by hand in Settings',
  not_found: 'Not found',
};

/** Why the transaction log cannot be read, in words. */
function logUnavailableWords(status: DataStatus): string {
  const code = status.transactionLog.error?.code;
  if (code === 'torn') return 'OOTP was writing it; Pennant tries again shortly';
  if (code === 'invalid') return 'The save\'s log isn\'t one Pennant can read';
  if (code === 'copy_failed') return 'Pennant couldn\'t copy it to read';
  switch (status.freshness.log.unavailableReason ?? status.transactionLog.unavailableReason) {
    case 'save_not_found':
      return 'The save\'s folder wasn\'t found';
    case 'database_missing':
      return 'The save has no transaction log yet';
    default:
      return 'It couldn\'t be read';
  }
}

type Line = { id: string; source: string; state: string; tone: Tone; hint?: string; order: number };

/** The four lines, as the React panel's `statusRows` has them, with why the log is unavailable in its help tag. */
function sourceLines(s: DataStatus): Line[] {
  const f = s.freshness;
  const day = (iso: string | null) => gameDateDisplay(iso) ?? 'an unknown date';
  const league: Line =
    f.csv.state === 'current'
      ? { id: 'league', source: 'League data', state: 'Current', tone: 'good', order: 0 }
      : f.csv.state === 'behind'
        ? { id: 'league', source: 'League data', state: `Behind by ${plural(f.csv.lagDays, 'day')}`, tone: 'bad', order: f.csv.lagDays }
        : f.csv.state === 'unavailable'
          ? { id: 'league', source: 'League data', state: 'Not imported', tone: 'bad', order: -1 }
          : { id: 'league', source: 'League data', state: 'Not checked against the save', tone: 'caution', order: -2 };

  const log = s.transactionLog;
  const transactions: Line = !log.readable
    ? {
        id: 'transactions',
        source: 'Transactions',
        state: s.save.found ? 'Unavailable' : 'Unavailable: save not found',
        tone: 'caution',
        hint: logUnavailableWords(s),
        order: -1,
      }
    : f.log.state === 'behind'
      ? { id: 'transactions', source: 'Transactions', state: `Through ${day(f.log.through)} (${plural(f.log.lagDays, 'day')} behind)`, tone: 'caution', order: f.log.lagDays }
      : { id: 'transactions', source: 'Transactions', state: `Through ${day(f.log.through)}`, tone: 'good', order: 0 };

  const save: Line = {
    id: 'save',
    source: 'OOTP save',
    state: s.save.simulatedThrough ? `Through ${day(s.save.simulatedThrough)}` : s.save.found ? 'Date unreadable' : 'Not found',
    tone: s.save.simulatedThrough ? 'neutral' : 'caution',
    order: 0,
  };

  const evidence: Line = {
    id: 'evidence',
    source: 'Roster evidence',
    state: HEADLINES[f.level](s),
    tone: f.level === 'current' ? 'good' : f.level === 'partial' ? 'caution' : 'bad',
    order: 0,
  };
  return [league, transactions, save, evidence];
}

/** The headline for each level, in the GM's words, from the freshness model's own states and lags. */
const HEADLINES: Record<RosterEvidenceLevel, (s: DataStatus) => string> = {
  current: () => 'Up to date',
  stale: (s) => `League data is ${plural(s.freshness.csv.lagDays, 'day')} behind the save`,
  partial: (s) =>
    s.freshness.log.state === 'behind'
      ? `Transactions ${plural(s.freshness.log.lagDays, 'day')} behind`
      : s.freshness.log.state === 'unavailable'
        ? 'Transaction history unavailable'
        : 'Not checked against the save',
  unavailable: () => 'No league data imported yet',
};

/** What to do, in the GM's words, when there is something to do (the freshness model's own action is React's). */
const ACTIONS: Record<RosterEvidenceLevel, string | null> = {
  current: null,
  partial: null,
  stale: 'Export the database from OOTP again and import it, so Pennant reads the save\'s latest day.',
  unavailable: 'Export your OOTP database and import it to begin.',
};

/** The headline in a word or two, for the title bar's subtitle (the headline itself is its help tag). */
const SHORT: Record<RosterEvidenceLevel, (s: DataStatus) => string> = {
  current: () => 'Up to date',
  stale: () => 'Behind the save',
  partial: (s) => (s.freshness.log.state === 'behind' ? 'Log behind' : s.freshness.log.state === 'unavailable' ? 'No log' : 'Not checked'),
  unavailable: () => 'Not imported',
};

const HEADLINE_TONE: Record<RosterEvidenceLevel, Tone> = { current: 'good', partial: 'caution', stale: 'bad', unavailable: 'bad' };

/** One fact; its sort key is `order` when given (an ISO time or date sorts as written), else its shown value. */
function fact(id: string, label: string, value: string | null, missing: string, hint?: string, order?: string | null): DataStatusFact {
  return row(
    id,
    { label: cell(label), value: value ? cell(value, hint ? { hint } : {}) : cell(missing, { tone: 'unknown' }) },
    { label, value: value ? (order ?? value) : null },
  );
}

/** The data status in words. */
export function dataStatusView(s: DataStatus): DataStatusView {
  const level = s.freshness.level;
  const lines = sourceLines(s);
  const headlineText = HEADLINES[level](s);
  const gameDate = gameDateDisplay(s.csv.currentDate);
  const action = ACTIONS[level];
  // The breakdown: each source's line, how the save was found and where Pennant looked, and what the log reader said
  const because = [
    ...lines.map((l) => ({ label: l.source, value: l.state })),
    { label: 'How the save was found', value: DISCOVERY_WORDS[s.save.discovery] ?? 'Not known' },
    ...s.save.discoveryNotes.map((note) => ({ label: 'Where Pennant looked', value: note })),
    ...(s.transactionLog.error?.message ? [{ label: 'What the log reader said', value: s.transactionLog.error.message }] : []),
  ];
  const headline = claim({
    text: headlineText,
    tone: HEADLINE_TONE[level],
    hint: 'How current Pennant\'s copy of the league is against your OOTP save',
    basis: basis({
      because,
      source: { department: 'frontOffice', specialist: 'Data status', asOf: s.csv.importedAt, gameDate: s.csv.currentDate },
      unknown: [...new Set(s.freshness.reasons)],
      wouldChange: action ? [action] : [],
      lean: null,
      certainty: 'fact',
    }),
  });

  const noImport = 'Not imported yet';
  const facts: DataStatusFact[] = [
    fact('gameDate', 'Game date', gameDate, noImport, undefined, parseGameDate(s.csv.currentDate)),
    fact('importedThrough', 'Imported data through', gameDateDisplay(s.csv.simulatedThrough), noImport, undefined, parseGameDate(s.csv.simulatedThrough)),
    fact('saveThrough', 'Save through', gameDateDisplay(s.save.simulatedThrough), s.save.found ? 'Date unreadable' : 'Save not found', undefined, parseGameDate(s.save.simulatedThrough)),
    fact('exported', 'Exported', timestampWords(s.csv.exportedAt), s.configured ? 'Export not found' : 'No save chosen', undefined, s.csv.exportedAt),
    fact('imported', 'Imported', timestampWords(s.csv.importedAt), noImport, undefined, s.csv.importedAt),
    fact('saveFolder', 'Save folder', s.save.lgPath, DISCOVERY_WORDS.not_found, s.save.lgPath ? DISCOVERY_WORDS[s.save.discovery] : undefined),
  ];

  return {
    level,
    headline,
    subtitle: [gameDate, SHORT[level](s)].filter((p): p is string => !!p).join(' · '),
    subtitleHint: [gameDate, headlineText].filter((p): p is string => !!p).join(' · '),
    gameDate: { served: s.csv.currentDate, display: gameDate ?? noImport },
    sources: lines.map((l) =>
      row(l.id, { source: cell(l.source), state: cell(l.state, { tone: l.tone, ...(l.hint ? { hint: l.hint } : {}) }) }, { source: l.source, state: l.order }),
    ),
    facts,
    action: action ? cell(action) : null,
  };
}
