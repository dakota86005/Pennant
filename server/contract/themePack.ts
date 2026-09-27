/**
 * Theme packs (D-062, SWIFTUI_REBUILD.md section 3.7): how a club looks in the Mac app, as data. A pack names the colours
 * every coloured piece draws (the masthead, the club card, the one tinted control, chart accents later), in light and
 * dark and each again for Increase Contrast, with optional art. Swift reads them from here through the generated
 * client and never holds a club colour of its own.
 *
 * Every club has one pack without any file: its own colours, derived from the save's team colours
 * (`server/presentation/themePacks.ts`), so a fictional league looks like itself too. Other packs are folders in the
 * data folder (`theme-packs/<id>/pack.json`), checked when they are read: one that fails is refused whole, with a
 * sentence, and never drawn in part.
 */
import type { Cell } from './presentation.js';
import type { Integer } from './primitives.js';

/** A colour as `#rrggbb`. */
export type HexColor = string;

/**
 * The colours one appearance draws. Each colour that text sits on comes with its text, and every pair reads (4.5:1, or
 * 7:1 for Increase Contrast): the server checks them before it serves a pack.
 */
export interface ThemeTokens {
  /**
   * The top of the masthead, under the toolbar, where macOS writes the window's title and subtitle in its own label
   * colour: nearly white in light, nearly black in dark, so the title reads as it does on a plain window.
   */
  mastheadTop: HexColor;
  /** The masthead's colours, from its leading top to its trailing bottom (one to four), under its text. */
  masthead: HexColor[];
  /** The masthead's headline text (the view's title, the club, the record). */
  mastheadText: HexColor;
  /** The masthead's second line. */
  mastheadSecondaryText: HexColor;
  /** The club's one accent, as a colour on the window's background (a link, a mark, a chart's own series). */
  accent: HexColor;
  /** Text on the accent. */
  accentText: HexColor;
  /** The tint of the one floating control a view may have. */
  tint: HexColor;
  /** Text on the tint. */
  tintText: HexColor;
  /** The club card's fill in the sidebar, and its text. */
  card: HexColor;
  cardText: HexColor;
}

/** A pack's colours for each appearance. */
export interface ThemeVariants {
  light: ThemeTokens;
  dark: ThemeTokens;
  /** Light with Increase Contrast on: every pair at 7:1. */
  lightIncreasedContrast: ThemeTokens;
  /** Dark with Increase Contrast on. */
  darkIncreasedContrast: ThemeTokens;
}

/** Where a pack comes from: the club's own colours (derived from the save), or a pack installed in the data folder. */
export type ThemePackKind = 'clubColors' | 'installed';

/** A theme pack as served: checked, with every appearance's colours resolved. */
export interface ThemePack {
  /** `club-colors` for the club's own colours; an installed pack's folder name. */
  id: string;
  /** The pack's name as its file gives it, or "Team colors" for the club's own (as Settings lists it). */
  name: string;
  kind: ThemePackKind;
  /** The pack's own version, as its file gives it (the club's own colours: the format's). */
  version: string;
  /** The club the pack is made for; null when it is made for any club. */
  teamId: Integer | null;
  tokens: ThemeVariants;
  /** Where to fetch the pack's logo, else the save's own logo for the club; null when there is neither. */
  logo: string | null;
  /** Where to fetch the pack's masthead art; null when it has none. */
  art: string | null;
}

/** A pack in the data folder that was refused, and why, in a sentence (the details in its help tag). */
export interface RefusedThemePack {
  /** The pack's folder name. */
  folder: string;
  /** The first thing wrong, as the GM reads it. */
  problem: Cell;
  /** Everything wrong with it, one sentence each, for whoever fixes the file. */
  details: string[];
}

/** The themes a club can wear (`GET /api/v2/theme-packs/:org`): its own colours first, then each installed pack that fits. */
export interface ThemeChoices {
  teamId: Integer;
  /** The pack the club wears now (`club-colors` unless another was chosen and is still installed and sound). */
  active: string;
  choices: ThemePack[];
  /** Packs in the data folder that were refused. */
  refused: RefusedThemePack[];
  /** A chosen pack that is no longer installed or no longer passes, so the club wears its own colours; null when none. */
  unavailable: Cell | null;
  /** Where packs go, for the GM to find: the data folder's `theme-packs` folder. */
  folder: string;
}

/** What `POST /api/v2/theme-packs/:org` takes: the pack the club should wear (`club-colors` for its own colours). */
export interface ThemeChoice {
  packId: string;
}
