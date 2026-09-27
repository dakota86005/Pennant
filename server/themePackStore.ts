/**
 * Theme packs on disk (D-062): the packs installed in the data folder (`theme-packs/<id>/pack.json` and its images),
 * which pack each club wears (`themePacks` in settings.json), and the pack's files. The checks themselves are pure and
 * live in `server/presentation/themePacks.ts`; this module reads the files and hands them over.
 *
 * A pack is read fresh on every request: there are only ever a few, each a small file, so a pack dropped into the
 * folder (or fixed) is seen at once, with no watcher. A pack that fails its check is refused whole and listed with its
 * sentence; a club that had chosen it wears its own colours, and its choices say so.
 */
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import type { Cell } from './contract/presentation.js';
import type { RefusedThemePack, ThemeChoices, ThemePack } from './contract/themePack.js';
import { logoReference } from './logos.js';
import { cell } from './presentation/claim.js';
import type { TeamColors } from './presentation/palette.js';
import { CLUB_COLORS_ID, PACK_ID, clubColorsPack, readPack } from './presentation/themePacks.js';
import { loadSettings, saveThemePackChoice } from './settings.js';

/** Where installed packs live: the data folder's `theme-packs`. */
export const themePacksFolder = (): string => path.join(DATA_DIR, 'theme-packs');

/** Every pack in the data folder: those that passed their check, and those refused, with why. */
export interface InstalledPacks {
  packs: ThemePack[];
  refused: RefusedThemePack[];
}

/** Where the app fetches one of a pack's files. */
export const packFilePath = (id: string, file: string): string => `/api/theme-packs/${id}/${file}`;

const refused = (folder: string, problem: string, details: string[]): RefusedThemePack => ({
  folder,
  problem: cell(problem, { tone: 'caution', hint: 'Pennant leaves the pack off until its pack.json is fixed' }),
  details,
});

/** Whether a path is a symbolic link (never followed: a pack is only what is in its own folder). */
function isLink(file: string): boolean {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Reads and checks every pack folder, in name order. A folder that is not a pack is refused, never skipped quietly; so
 * is a link standing in for a pack folder, which is never followed (a pack is the files in its own folder).
 */
export function installedPacks(): InstalledPacks {
  const root = themePacksFolder();
  const out: InstalledPacks = { packs: [], refused: [] };
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  const candidates = entries.filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.'));
  for (const entry of candidates.sort((a, b) => a.name.localeCompare(b.name))) {
    const folder = entry.name;
    const dir = path.join(root, folder);
    if (entry.isSymbolicLink()) {
      const problem = 'It is a link to a folder elsewhere; put the pack\'s folder itself in theme-packs.';
      out.refused.push(refused(folder, problem, [problem]));
      continue;
    }
    if (isLink(path.join(dir, 'pack.json'))) {
      const problem = 'Its pack.json is a link to a file elsewhere; put the file itself in the pack\'s folder.';
      out.refused.push(refused(folder, problem, [problem]));
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
    } catch (err) {
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
      const problem = missing ? 'It has no pack.json.' : 'Its pack.json could not be read as JSON.';
      out.refused.push(refused(folder, problem, missing ? [problem] : [problem, (err as Error).message]));
      continue;
    }
    const probe = { size: (file: string) => fileSize(dir, file), link: (file: string) => isLink(path.resolve(dir, file)) };
    const reading = readPack(raw, folder, probe, (file) => packFilePath(folder, file));
    if (reading.ok) out.packs.push(reading.pack);
    else out.refused.push(refused(folder, reading.problem, reading.details));
  }
  return out;
}

/**
 * A file's size inside a pack's folder, or null when it is not there, would reach outside the folder, or is a link (a
 * link is never followed, so a pack can never serve a file from elsewhere on the Mac).
 */
function fileSize(dir: string, file: string): number | null {
  const resolved = path.resolve(dir, file);
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) return null;
  if (isLink(dir)) return null;
  try {
    const stat = fs.lstatSync(resolved);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

/** Every club's chosen pack as settings.json has it (team id to pack id), read once for a request that needs several. */
export type ChosenPacks = Readonly<Record<string, unknown>>;

export function chosenPacks(): ChosenPacks {
  const chosen: unknown = loadSettings().themePacks;
  return chosen && typeof chosen === 'object' ? (chosen as ChosenPacks) : {};
}

/** The pack id a club was set to wear, or the club's own colours when none was chosen. */
export function chosenPack(teamId: number, chosen: ChosenPacks = chosenPacks()): string {
  const id = chosen[String(teamId)];
  return typeof id === 'string' && id ? id : CLUB_COLORS_ID;
}

/** Whether a pack may be worn by a club: one made for any club, or for that one. */
const fits = (pack: ThemePack, teamId: number): boolean => pack.teamId === null || pack.teamId === teamId;

/** A club, as the theme needs it: its team id and its colours as the export has them. */
export interface ThemedClub {
  team_id: number;
  colors: TeamColors | null;
}

/**
 * The pack a club wears now, and a sentence when the one it chose cannot be worn. A request that asks for several clubs
 * reads the installed packs and the choices once and passes them in.
 */
export function activePack(
  club: ThemedClub,
  installed: InstalledPacks = installedPacks(),
  choices: ChosenPacks = chosenPacks(),
): { pack: ThemePack; unavailable: Cell | null } {
  const saveLogo = logoReference(club.team_id);
  const own = clubColorsPack(club.team_id, club.colors, saveLogo);
  const chosen = chosenPack(club.team_id, choices);
  if (chosen === CLUB_COLORS_ID) return { pack: own, unavailable: null };
  const pack = installed.packs.find((p) => p.id === chosen && fits(p, club.team_id));
  if (pack) return { pack: { ...pack, logo: pack.logo ?? saveLogo }, unavailable: null };
  const wasRefused = installed.refused.some((r) => r.folder === chosen);
  return {
    pack: own,
    unavailable: cell('The theme chosen for this club isn\'t available, so it wears its team colors.', {
      tone: 'caution',
      hint: wasRefused ? 'The pack was refused when it was read: see Settings, Appearance' : 'The pack is no longer in the theme-packs folder',
    }),
  };
}

/** The themes a club can wear: its own colours first, then every installed pack made for it or for any club. */
export function themeChoices(club: ThemedClub): ThemeChoices {
  const installed = installedPacks();
  const { pack, unavailable } = activePack(club, installed);
  const saveLogo = logoReference(club.team_id);
  return {
    teamId: club.team_id,
    active: pack.id,
    choices: [
      clubColorsPack(club.team_id, club.colors, saveLogo),
      ...installed.packs.filter((p) => fits(p, club.team_id)).map((p) => ({ ...p, logo: p.logo ?? saveLogo })),
    ],
    refused: installed.refused,
    unavailable,
    folder: themePacksFolder(),
  };
}

/** A choice the server will not record, in a sentence (answered as a 400). */
export class ThemeChoiceRefusal extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ThemeChoiceRefusal';
  }
}

/**
 * Records the pack a club wears: `club-colors` forgets the choice, anything else must be an installed pack that passed
 * its check and fits the club. Answers the club's choices as they now are.
 */
export function chooseTheme(club: ThemedClub, packId: unknown): ThemeChoices {
  if (typeof packId !== 'string' || !packId) throw new ThemeChoiceRefusal('Choose a theme to wear.');
  if (packId === CLUB_COLORS_ID) {
    saveThemePackChoice(club.team_id, null);
    return themeChoices(club);
  }
  const installed = installedPacks();
  const pack = installed.packs.find((p) => p.id === packId);
  if (!pack) {
    throw new ThemeChoiceRefusal(installed.refused.some((r) => r.folder === packId)
      ? 'That theme pack was refused when it was read, so it can\'t be worn until it is fixed.'
      : 'There is no theme pack by that name in the theme-packs folder.');
  }
  if (!fits(pack, club.team_id)) throw new ThemeChoiceRefusal('That theme pack is made for another club.');
  saveThemePackChoice(club.team_id, packId);
  return themeChoices(club);
}

/** A pack's logo and art, for the app to draw: only the files a pack that passed its check names. */
export const themePackFileRoutes = Router();

themePackFileRoutes.get('/theme-packs/:id/:file', (req, res) => {
  const id = String(req.params.id);
  const file = String(req.params.file);
  if (!PACK_ID.test(id)) return res.status(404).end();
  const pack = installedPacks().packs.find((p) => p.id === id);
  const served = pack && [pack.logo, pack.art].includes(packFilePath(id, file));
  if (!served) return res.status(404).end();
  const dir = path.join(themePacksFolder(), id);
  if (fileSize(dir, file) === null) return res.status(404).end();
  res.setHeader('Content-Type', /\.png$/i.test(file) ? 'image/png' : 'image/jpeg');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.resolve(dir, file));
});
