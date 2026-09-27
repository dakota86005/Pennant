/**
 * Finding the save, in words (N3.5 Stage B2, D-063): the save you're playing and why, why none was picked, and how to
 * switch an export on. `saveDiscovery.ts` decides; this only says what it decided, with the basis.
 */
import type { Claim } from '../contract/presentation.js';
import { EXPORT_OFF_NOTE, type SaveInfo, type SearchLocation } from '../paths.js';
import { STANDOUT_WINDOW_MS, type NoPickReason, type SavePick } from '../saveDiscovery.js';
import { timestampWords } from '../timeWords.js';
import { basis, claim, type BasisInput } from './claim.js';

/** What `GET /api/v2/saves` serves: the saves, most recently played first, and the one that stands out or why none does. */
export interface SaveDiscovery {
  /** Every save found, most recently played first (a save OOTP has never saved last). */
  saves: SaveInfo[];
  /** The save you're playing, when one clearly stands out; null when the app asks. */
  pick: SaveDiscoveryPick | null;
  /** Why nothing was picked, when nothing was: a code, and the line with its basis. */
  noPick: SaveDiscoveryNoPick | null;
  /** How to switch the export on, with OOTP's documentation as the basis, when the save played most recently has none. */
  exportHelp: Claim | null;
  /** Where the server looked (the same as `GET /api/search-locations`). */
  searched: SearchLocation[];
}

/** The save that clearly stands out, and the line saying why. */
export interface SaveDiscoveryPick {
  saveId: string;
  claim: Claim;
}

/** Why nothing was picked. */
export interface SaveDiscoveryNoPick {
  reason: NoPickReason;
  claim: Claim;
}

/** The policy line, as the evidence view shows it (D-041). */
export const STANDOUT_STAMP =
  'Chosen only when it clearly stands out: played most recently of all your saves, with an export, and no other save played in the two days before it';

/** OOTP's own documentation of its export (the wiki names the menu; the manual says what it writes and where). */
export const OOTP_EXPORT_DOCS = {
  wiki: 'https://wiki.ootpdevelopments.com/index.php?title=OOTP_Baseball%3AImportant_Game_Concepts%2FTools%2C_Functions%2C_and_Editors%2FLeague_Functions%2FImport%2FExport_Functions',
  manual: 'https://manuals.ootpdevelopments.com/index.php?man=ootp23&page=data_export',
};

const DAY_MS = 24 * 60 * 60_000;
const WINDOW_DAYS = Math.round(STANDOUT_WINDOW_MS / DAY_MS);

const played = (s: SaveInfo): string => timestampWords(s.lastPlayedAt) ?? 'not known';
const playedMs = (s: SaveInfo | null): number | null => (s?.lastPlayedAt ? Date.parse(s.lastPlayedAt) : null);
/** "Sep 22" from a save's last-played time. */
const day = (s: SaveInfo): string => {
  const at = playedMs(s);
  return at === null ? 'at an unknown time' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(at));
};
const gap = (a: SaveInfo, b: SaveInfo): string => {
  const ms = playedMs(a)! - playedMs(b)!;
  if (ms < DAY_MS) {
    const hours = Math.max(1, Math.round(ms / 3_600_000));
    return `${hours} hour${hours === 1 ? '' : 's'} earlier`;
  }
  const days = Math.floor(ms / DAY_MS);
  return `${days} day${days === 1 ? '' : 's'} earlier`;
};

function exportLine(s: SaveInfo): { label: string; value: string } {
  if (!s.hasExport) return { label: 'Export', value: s.exportConfigured ? 'Set up in OOTP, but no files written yet' : 'None yet' };
  return { label: 'Export', value: `Written ${timestampWords(s.exportedAt) ?? 'at an unknown time'} · ${s.csvCount} files` };
}

function source(gameDate: string | null): BasisInput['source'] {
  return { department: 'frontOffice', specialist: 'Data status', asOf: new Date().toISOString(), gameDate };
}

/** The pick's line: the save you're playing, and why. */
export function pickClaim(pick: SavePick) {
  const s = pick.pick!;
  const because = [
    { label: 'Last played', value: `${played(s)} (when OOTP last saved it)` },
    exportLine(s),
    pick.runnerUp
      ? { label: 'Next most recent', value: `${pick.runnerUp.name}, last played ${played(pick.runnerUp)} (${gap(s, pick.runnerUp)})` }
      : { label: 'Next most recent', value: 'No other save has been saved in OOTP' },
    { label: 'Found in', value: s.location ?? s.lgPath },
  ];
  return claim({
    text: `Last played ${day(s)}, the most recent of your saves, and it has an export`,
    hint: `No other save was played in the ${WINDOW_DAYS} days before it.`,
    tone: 'good',
    basis: basis({
      because,
      source: source(s.simulatedThrough ?? null),
      unknown: s.simulatedThrough ? [] : ['The last day this save has played couldn\'t be read from the save.'],
      wouldChange: ['Playing another save in OOTP: Pennant then says so and offers to switch.'],
      lean: null,
      certainty: 'policy',
      stamp: STANDOUT_STAMP,
    }),
    links: [],
  });
}

/** Why nothing was picked, in a line with its basis. */
export function noPickClaim(pick: SavePick, saves: readonly SaveInfo[]) {
  const reason = pick.reason!;
  const top = saves.filter((s) => s.lastPlayedAt).slice(0, 3);
  const because = top.length
    ? top.map((s) => ({ label: s.name, value: `Last played ${played(s)}${s.hasExport ? '' : ', no export'}` }))
    : [{ label: 'Saves found', value: saves.length === 0 ? 'None' : `${saves.length}, none saved in OOTP yet` }];
  const text: Record<NoPickReason, string> = {
    noSaves: 'No OOTP saves were found on this Mac',
    neverPlayed: 'None of these saves has been saved in OOTP yet',
    noExport: `${pick.latest?.name ?? 'Your most recent save'}, your most recent save, has no export yet`,
    tooClose: pick.latest && pick.runnerUp
      ? `You've played ${pick.latest.name} and ${pick.runnerUp.name} within ${WINDOW_DAYS} days of each other`
      : `Two saves were played within ${WINDOW_DAYS} days of each other`,
  };
  const hint: Record<NoPickReason, string> = {
    noSaves: 'Choose the folder that holds your saves.',
    neverPlayed: 'Choose the save to use.',
    noExport: 'Export the league from OOTP, or choose another save.',
    tooClose: 'Choose the save to use.',
  };
  return claim({
    text: text[reason],
    hint: hint[reason],
    tone: reason === 'noSaves' ? 'unknown' : 'caution',
    basis: basis({
      because,
      source: source(null),
      unknown: [],
      wouldChange: reason === 'noExport'
        ? ['An export of that save, written by OOTP.']
        : reason === 'tooClose'
          ? [`No other save played in the ${WINDOW_DAYS} days before the most recent one.`]
          : ['A save saved in OOTP, with an export.'],
      lean: null,
      certainty: 'policy',
      stamp: STANDOUT_STAMP,
    }),
    links: [],
  });
}

/** How to switch an export on, as OOTP's own documentation puts it, cited. */
export function exportHelpClaim(save: SaveInfo) {
  return claim({
    text: EXPORT_OFF_NOTE,
    hint: 'Pennant imports it by itself once OOTP has written it.',
    tone: 'neutral',
    basis: basis({
      because: [
        { label: 'This save', value: save.exportConfigured ? 'Export set up in OOTP, but no CSV files written yet' : 'No export settings and no CSV files in its import_export folder' },
        { label: 'Where OOTP puts it', value: `OOTP's wiki: Game, Game Settings, the Database tab, the Database Tools menu (${OOTP_EXPORT_DOCS.wiki})` },
        { label: 'What OOTP writes', value: `OOTP's manual: the league as CSV files in the save's import_export folder, with a choice of tables (${OOTP_EXPORT_DOCS.manual})` },
      ],
      source: source(save.simulatedThrough ?? null),
      unknown: ['OOTP\'s documentation for this version doesn\'t name the menus; they come from its wiki and an earlier manual, so a name may differ slightly.'],
      wouldChange: [],
      lean: null,
      certainty: 'fact',
    }),
    links: [],
  });
}

/** The discovery payload: the ranked saves, the pick or why none, and the export help when it applies. */
export function saveDiscoveryView(saves: SaveInfo[], pick: SavePick, searched: SearchLocation[]): SaveDiscovery {
  const latest = pick.latest;
  return {
    saves,
    pick: pick.pick ? { saveId: pick.pick.id!, claim: pickClaim(pick) } : null,
    noPick: pick.reason ? { reason: pick.reason, claim: noPickClaim(pick, saves) } : null,
    exportHelp: latest && !latest.hasExport ? exportHelpClaim(latest) : null,
    searched,
  };
}
