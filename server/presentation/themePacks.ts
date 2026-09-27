/**
 * Theme packs (D-062): the club's own colours as a pack, derived from the save's team colours, and the check every
 * installed pack passes before it is served. Pure: the files are read by `server/themePackStore.ts`, which hands this
 * module what it read.
 *
 * The one rule every pack keeps, derived or installed: every piece of text reads on the colour it sits on, at WCAG's
 * 4.5:1, and at 7:1 with Increase Contrast, in light and in dark (the bar `npm run check:theme` holds the palettes to).
 * The masthead is drawn as a gradient, so its text is checked against each colour and against the lightest (or darkest)
 * blend of each neighbouring pair, not only the ends. Its top sits under the toolbar, where macOS writes the window's
 * title in its own label colour, so the top must be nearly white in light and nearly black in dark.
 *
 * A pack that fails any of it is refused whole, with a sentence saying what failed and the rest in its details: a club
 * never wears half a pack.
 */
import type { HexColor, ThemePack, ThemeTokens, ThemeVariants } from '../contract/themePack.js';
import { derivePalette, hexToHsl, relativeLuminance, toHex, type HSL, type TeamColors } from './palette.js';

/** The id of the pack every club has without a file: its own colours. */
export const CLUB_COLORS_ID = 'club-colors';
/** The name the club's own colours go by in Settings. */
export const CLUB_COLORS_NAME = 'Team colors';
/** The pack format this server reads (`format` in `pack.json`). */
export const THEME_PACK_FORMAT = 1;

/** Text on a colour: WCAG AA for body text, and 7:1 (AAA) with Increase Contrast. */
export const TEXT_CONTRAST = 4.5;
export const INCREASED_CONTRAST = 7;

/**
 * The masthead's top against the colour macOS writes the window's title in (black in light, white in dark): as close to
 * a plain window as a tint allows, so the title and the lighter subtitle both read.
 */
export const TITLE_BAR: Record<Appearance, { against: HexColor; at: number }> = {
  light: { against: '#000000', at: 17 },
  dark: { against: '#ffffff', at: 14 },
};

/** The window's own backgrounds the accent is read on: the content's, and a grouped section's. */
export const WINDOW_BACKGROUNDS: Record<Appearance, HexColor[]> = {
  light: ['#ffffff', '#ececec'],
  dark: ['#1e1e1e', '#323232'],
};

export type Appearance = 'light' | 'dark';
export type VariantName = keyof ThemeVariants;

/** Each variant: its appearance and the contrast its text needs. */
export const VARIANTS: ReadonlyArray<{ name: VariantName; appearance: Appearance; increased: boolean; words: string }> = [
  { name: 'light', appearance: 'light', increased: false, words: 'in light' },
  { name: 'dark', appearance: 'dark', increased: false, words: 'in dark' },
  { name: 'lightIncreasedContrast', appearance: 'light', increased: true, words: 'in light with Increase Contrast' },
  { name: 'darkIncreasedContrast', appearance: 'dark', increased: true, words: 'in dark with Increase Contrast' },
];

/** The token names, in the file's order. */
export const TOKEN_KEYS: ReadonlyArray<keyof ThemeTokens> = [
  'mastheadTop', 'masthead', 'mastheadText', 'mastheadSecondaryText', 'accent', 'accentText', 'tint', 'tintText', 'card', 'cardText',
];

// ── Colour arithmetic ───────────────────────────────────────────────────

type RGB = [number, number, number];

const rgb = (hex: HexColor): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hexOf = ([r, g, b]: RGB): HexColor =>
  `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

/** WCAG's contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: HexColor, b: HexColor): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const isLight = (hex: HexColor): boolean => relativeLuminance(hex) > 0.18;

const hslHex = (c: HSL): HexColor => toHex(`hsl(${c.h.toFixed(0)}, ${c.s.toFixed(0)}%, ${c.l.toFixed(0)}%)`);

/**
 * The colour a gradient between two stops comes closest to its text at: under light text the channel-wise lightest
 * blend (each channel's larger value), under dark text the darkest. No colour on the line between the stops is nearer
 * the text than this one, so text that reads on it reads on the whole blend.
 */
export function worstBlend(a: HexColor, b: HexColor, text: HexColor): HexColor {
  const [x, y] = [rgb(a), rgb(b)];
  const pick = isLight(text) ? Math.max : Math.min;
  return hexOf([pick(x[0], y[0]), pick(x[1], y[1]), pick(x[2], y[2])]);
}

/**
 * Walks a colour's lightness away from its text (darker under light text, lighter under dark) until the pair reads at
 * the target, keeping its hue; the last step if none does (black or white), which the check then refuses.
 */
export function readableUnder(color: HexColor, text: HexColor, target: number): HexColor {
  if (contrastRatio(color, text) >= target) return color;
  const hsl = hexToHsl(color) ?? { h: 0, s: 0, l: 50 };
  const darker = isLight(text);
  let candidate = color;
  for (let l = hsl.l; darker ? l >= 0 : l <= 100; l += darker ? -1 : 1) {
    candidate = hslHex({ ...hsl, l });
    if (contrastRatio(candidate, text) >= target) return candidate;
  }
  return candidate;
}

/** Walks a colour's lightness away from a background (darker on a light one) until it reads on every one given. */
function readableOn(color: HexColor, backgrounds: HexColor[], target: number): HexColor {
  const passes = (c: HexColor) => backgrounds.every((bg) => contrastRatio(c, bg) >= target);
  if (passes(color)) return color;
  const hsl = hexToHsl(color) ?? { h: 0, s: 0, l: 50 };
  const darker = isLight(backgrounds[0]);
  let candidate = color;
  for (let l = hsl.l; darker ? l >= 0 : l <= 100; l += darker ? -1 : 1) {
    candidate = hslHex({ ...hsl, l });
    if (passes(candidate)) return candidate;
  }
  return candidate;
}

/** Stops walked, all together, until the text reads on each and on each neighbouring blend. */
function readableStops(stops: HexColor[], text: HexColor, target: number): HexColor[] {
  let out = stops.map((s) => readableUnder(s, text, target));
  for (let step = 0; step < 100 && mastheadProblems(out, text, target).length > 0; step++) {
    out = out.map((s) => {
      const hsl = hexToHsl(s) ?? { h: 0, s: 0, l: 50 };
      return hslHex({ ...hsl, l: Math.min(100, Math.max(0, hsl.l + (isLight(text) ? -1 : 1))) });
    });
  }
  return out;
}

/** The masthead's text against each stop and each neighbouring blend: the pairs that fail, with their ratio. */
function mastheadProblems(stops: HexColor[], text: HexColor, target: number): Array<{ where: string; ratio: number }> {
  const out: Array<{ where: string; ratio: number }> = [];
  stops.forEach((stop, i) => {
    const ratio = contrastRatio(stop, text);
    if (ratio < target) out.push({ where: `its ${ORDINALS[i]} colour`, ratio });
    if (i > 0) {
      const blend = contrastRatio(worstBlend(stops[i - 1], stop, text), text);
      if (blend < target) out.push({ where: `the blend of its ${ORDINALS[i - 1]} and ${ORDINALS[i]} colours`, ratio: blend });
    }
  });
  return out;
}

const ORDINALS = ['first', 'second', 'third', 'fourth'];

/** A colour moved toward another by a share (0: the first, 1: the second). */
const mix = (a: HexColor, b: HexColor, share: number): HexColor => {
  const [x, y] = [rgb(a), rgb(b)];
  return hexOf([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * share) as RGB);
};

// ── The club's own colours ──────────────────────────────────────────────

/** The team colour a second masthead stop comes from: the secondary, else the cap, when it is a colour at all. */
function secondStop(colors: TeamColors | null, plate: HexColor): HexColor {
  const plateHsl = hexToHsl(plate) ?? { h: 0, s: 0, l: 30 };
  for (const candidate of [colors?.secondary, colors?.cap]) {
    const hsl = candidate ? hexToHsl(candidate) : null;
    if (!hsl || hsl.s < 20) continue;
    const hueApart = Math.min(Math.abs(hsl.h - plateHsl.h), 360 - Math.abs(hsl.h - plateHsl.h));
    if (hueApart >= 12 || Math.abs(hsl.l - plateHsl.l) >= 10) return toHex(candidate!);
  }
  // A club of one colour: the same hue, a shade apart
  return hslHex({ ...plateHsl, l: Math.min(100, Math.max(0, plateHsl.l + (plateHsl.l > 50 ? -10 : 10))) });
}

/**
 * One appearance of the club's own colours, from the palette the React app draws (`derivePalette`), so both clients
 * agree on a club's plate and accent. The masthead runs from the club's plate to its second colour; its top is the
 * plate's hue, lightened nearly to white in light and darkened nearly to black in dark, so the title reads.
 */
function clubVariant(colors: TeamColors | null, appearance: Appearance, increased: boolean): ThemeTokens {
  const target = increased ? INCREASED_CONTRAST : TEXT_CONTRAST;
  const palette = derivePalette(colors, appearance);
  const plate = toHex(palette['--team']);
  const plateText = toHex(palette['--team-fg']);
  // With Increase Contrast the text goes to pure white or black, which leaves the colours the most room
  const text = increased ? (isLight(plateText) ? '#ffffff' : '#000000') : plateText;
  const masthead = readableStops([plate, secondStop(colors, plate)], text, target);
  const secondary = mix(text, masthead[0], 0.18);
  const secondaryOk = masthead.every((s, i) => contrastRatio(s, secondary) >= target
    && (i === 0 || contrastRatio(worstBlend(masthead[i - 1], s, secondary), secondary) >= target));
  const hue = hexToHsl(plate) ?? { h: 0, s: 0, l: 30 };
  const top = readableTop(hslHex({ h: hue.h, s: Math.min(hue.s, appearance === 'light' ? 40 : 50), l: appearance === 'light' ? 95 : 9 }), appearance);
  const accent = readableOn(toHex(palette['--accent']), WINDOW_BACKGROUNDS[appearance], target);
  const inkCandidate = toHex(palette['--accent-ink']);
  const accentText = contrastRatio(accent, inkCandidate) >= target ? inkCandidate : bestText(accent);
  const tint = readableUnder(accent, accentText, target);
  return {
    mastheadTop: top,
    masthead,
    mastheadText: text,
    mastheadSecondaryText: secondaryOk && !increased ? secondary : text,
    accent,
    accentText,
    tint,
    tintText: accentText,
    card: readableUnder(plate, text, target),
    cardText: text,
  };
}

/** Black or white, whichever reads better on a colour. */
const bestText = (color: HexColor): HexColor => (contrastRatio(color, '#000000') >= contrastRatio(color, '#ffffff') ? '#000000' : '#ffffff');

/** The masthead's top walked toward white (light) or black (dark) until the window's title reads on it. */
function readableTop(color: HexColor, appearance: Appearance): HexColor {
  const bar = TITLE_BAR[appearance];
  if (contrastRatio(color, bar.against) >= bar.at) return color;
  const hsl = hexToHsl(color) ?? { h: 0, s: 0, l: 50 };
  const lighter = appearance === 'light';
  let candidate = color;
  for (let l = hsl.l; lighter ? l <= 100 : l >= 0; l += lighter ? 1 : -1) {
    candidate = hslHex({ ...hsl, l });
    if (contrastRatio(candidate, bar.against) >= bar.at) return candidate;
  }
  return candidate;
}

/** Every appearance of the club's own colours. */
export function clubColorVariants(colors: TeamColors | null): ThemeVariants {
  return {
    light: clubVariant(colors, 'light', false),
    dark: clubVariant(colors, 'dark', false),
    lightIncreasedContrast: clubVariant(colors, 'light', true),
    darkIncreasedContrast: clubVariant(colors, 'dark', true),
  };
}

/** The pack every club has without a file: its own colours, with the save's logo when it holds one. */
export function clubColorsPack(teamId: number, colors: TeamColors | null, saveLogo: string | null): ThemePack {
  return {
    id: CLUB_COLORS_ID,
    name: CLUB_COLORS_NAME,
    kind: 'clubColors',
    version: String(THEME_PACK_FORMAT),
    teamId,
    tokens: clubColorVariants(colors),
    logo: saveLogo,
    art: null,
  };
}

// ── The check ───────────────────────────────────────────────────────────

const fmt = (ratio: number): string => `${ratio.toFixed(1)}:1`;

/**
 * Every pair in one appearance that does not read, in plain sentences ("The masthead's text on its second colour reads
 * at 3.1:1 in dark; it needs 4.5:1."). Empty when the appearance passes.
 */
export function contrastProblems(tokens: ThemeTokens, variant: (typeof VARIANTS)[number]): string[] {
  const target = variant.increased ? INCREASED_CONTRAST : TEXT_CONTRAST;
  const out: string[] = [];
  const need = (what: string, ratio: number, at: number) => {
    if (ratio < at) out.push(`${what} reads at ${fmt(ratio)} ${variant.words}; it needs ${fmt(at)}.`);
  };
  const bar = TITLE_BAR[variant.appearance];
  need(`The window's title on the masthead's top`, contrastRatio(tokens.mastheadTop, bar.against), bar.at);
  for (const [label, text] of [['text', tokens.mastheadText], ['second line', tokens.mastheadSecondaryText]] as const) {
    for (const p of mastheadProblems(tokens.masthead, text, target)) need(`The masthead's ${label} on ${p.where}`, p.ratio, target);
  }
  for (const bg of WINDOW_BACKGROUNDS[variant.appearance]) {
    need(`The accent on the window's background (${bg})`, contrastRatio(tokens.accent, bg), target);
  }
  need('The text on the accent', contrastRatio(tokens.accent, tokens.accentText), target);
  need('The text on the tint', contrastRatio(tokens.tint, tokens.tintText), target);
  need('The club card\'s text', contrastRatio(tokens.card, tokens.cardText), target);
  return out;
}

/**
 * An appearance with Increase Contrast made from its plain one, for a pack that gives none: each colour text sits on
 * is walked away from its text until the pair reads at 7:1, the text kept as the pack wrote it.
 */
export function strengthened(tokens: ThemeTokens, appearance: Appearance): ThemeTokens {
  const accent = readableOn(tokens.accent, WINDOW_BACKGROUNDS[appearance], INCREASED_CONTRAST);
  const text = tokens.mastheadText;
  const masthead = readableStops(tokens.masthead, text, INCREASED_CONTRAST);
  return {
    mastheadTop: tokens.mastheadTop,
    masthead,
    mastheadText: text,
    // The second line takes the headline's colour: a lighter shade of it would give back the contrast just gained
    mastheadSecondaryText: text,
    accent: readableUnder(accent, tokens.accentText, INCREASED_CONTRAST),
    accentText: tokens.accentText,
    tint: readableUnder(tokens.tint, tokens.tintText, INCREASED_CONTRAST),
    tintText: tokens.tintText,
    card: readableUnder(tokens.card, tokens.cardText, INCREASED_CONTRAST),
    cardText: tokens.cardText,
  };
}

/** What the store can say about a pack's asset file. */
export interface AssetProbe {
  /** The file's size in bytes, or null when the pack's folder has no such file. */
  size(file: string): number | null;
  /** Whether the name is a link (a symbolic link) rather than a file in the folder: never followed, so refused. */
  link?(file: string): boolean;
}

/** A pack read and checked: served, or refused with a sentence (the first thing wrong) and every finding. */
export type PackReading =
  | { ok: true; pack: ThemePack }
  | { ok: false; problem: string; details: string[] };

const PACK_KEYS = ['format', 'id', 'name', 'version', 'club', 'light', 'dark', 'lightIncreasedContrast', 'darkIncreasedContrast', 'logo', 'art'];
const HEX = /^#[0-9a-fA-F]{6}$/;
const ASSET = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.(png|jpe?g)$/i;
/** The largest asset a pack may carry. */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
/** A pack's id: its folder's name, in lower case letters, digits and dashes. */
export const PACK_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

const refuse = (problem: string, details: string[] = [problem]): PackReading => ({ ok: false, problem, details });

/** One appearance's tokens from the file, or the sentences for what is wrong with them. */
function readTokens(raw: unknown, name: string): { tokens: ThemeTokens } | { problems: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problems: [`"${name}" must list the pack's colours.`] };
  const record = raw as Record<string, unknown>;
  const problems: string[] = [];
  const extra = Object.keys(record).filter((k) => !(TOKEN_KEYS as readonly string[]).includes(k));
  if (extra.length) problems.push(`"${name}" has colours this version doesn't know: ${extra.join(', ')}.`);
  for (const key of TOKEN_KEYS) {
    const value = record[key];
    if (key === 'masthead') {
      if (!Array.isArray(value) || value.length < 1 || value.length > 4 || !value.every((v) => typeof v === 'string' && HEX.test(v))) {
        problems.push(`"${name}.masthead" must be one to four colours written #rrggbb.`);
      }
    } else if (typeof value !== 'string' || !HEX.test(value)) {
      problems.push(`"${name}.${key}" must be a colour written #rrggbb.`);
    }
  }
  if (problems.length) return { problems };
  const t = record as unknown as ThemeTokens;
  const lower = (c: string) => c.toLowerCase();
  return {
    tokens: {
      mastheadTop: lower(t.mastheadTop), masthead: t.masthead.map(lower), mastheadText: lower(t.mastheadText),
      mastheadSecondaryText: lower(t.mastheadSecondaryText), accent: lower(t.accent), accentText: lower(t.accentText),
      tint: lower(t.tint), tintText: lower(t.tintText), card: lower(t.card), cardText: lower(t.cardText),
    },
  };
}

/**
 * Reads and checks one installed pack (`theme-packs/<folder>/pack.json`, already parsed): its shape, its id against its
 * folder, its assets, and every appearance's contrast. A pack that gives no Increase Contrast colours gets them made
 * from its plain ones (`strengthened`), which are checked like the rest.
 *
 * The served pack's `logo` is its own file or null; the store puts the save's logo for the club wearing it in its place.
 *
 * @param assetPath where the app fetches one of the pack's files (`/api/theme-packs/<id>/<file>`).
 */
export function readPack(raw: unknown, folder: string, assets: AssetProbe, assetPath: (file: string) => string): PackReading {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return refuse('Its pack.json is not a pack: it should be one JSON object.');
  const pack = raw as Record<string, unknown>;
  if (pack.format !== THEME_PACK_FORMAT) {
    return typeof pack.format === 'number' && pack.format > THEME_PACK_FORMAT
      ? refuse(`It is written for a newer version of Pennant (format ${pack.format}).`)
      : refuse(`Its pack.json needs "format": ${THEME_PACK_FORMAT}.`);
  }
  const problems: string[] = [];
  const extra = Object.keys(pack).filter((k) => !PACK_KEYS.includes(k));
  if (extra.length) problems.push(`It has settings this version doesn't know: ${extra.join(', ')}.`);
  if (typeof pack.id !== 'string' || !PACK_ID.test(pack.id)) {
    problems.push('Its "id" must be lower case letters, digits and dashes.');
  } else if (pack.id === CLUB_COLORS_ID) {
    problems.push(`Its "id" can't be "${CLUB_COLORS_ID}", which names every club's own colors.`);
  } else if (pack.id !== folder) {
    problems.push(`Its "id" ("${pack.id}") must match its folder's name ("${folder}").`);
  }
  const name = typeof pack.name === 'string' ? pack.name.trim() : '';
  if (!name || name.length > 40) problems.push('Its "name" must be one to 40 characters.');
  const version = typeof pack.version === 'string' ? pack.version.trim() : '';
  if (!version || version.length > 20) problems.push('Its "version" must be one to 20 characters ("1.0").');
  const club = pack.club;
  if (!(club === 'any' || (typeof club === 'number' && Number.isInteger(club) && club > 0))) {
    problems.push('Its "club" must be a team id from the save, or "any".');
  }
  const files: Record<'logo' | 'art', string | null> = { logo: null, art: null };
  for (const key of ['logo', 'art'] as const) {
    const value = pack[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !ASSET.test(value)) {
      problems.push(`Its "${key}" must name a .png or .jpg file in the pack's folder.`);
      continue;
    }
    if (assets.link?.(value)) {
      problems.push(`Its ${key}, ${value}, is a link to a file elsewhere; put the picture itself in the pack's folder.`);
      continue;
    }
    const size = assets.size(value);
    if (size === null) problems.push(`Its ${key}, ${value}, isn't in the pack's folder.`);
    else if (size > MAX_ASSET_BYTES) problems.push(`Its ${key}, ${value}, is larger than 2 MB.`);
    else files[key] = value;
  }
  const read: Partial<ThemeVariants> = {};
  for (const variant of VARIANTS) {
    const given = pack[variant.name];
    if (given === undefined && variant.increased) continue;
    const result = readTokens(given, variant.name);
    if ('problems' in result) problems.push(...result.problems);
    else read[variant.name] = result.tokens;
  }
  if (problems.length) return refuse(problems[0], problems);

  const tokens: ThemeVariants = {
    light: read.light!,
    dark: read.dark!,
    lightIncreasedContrast: read.lightIncreasedContrast ?? strengthened(read.light!, 'light'),
    darkIncreasedContrast: read.darkIncreasedContrast ?? strengthened(read.dark!, 'dark'),
  };
  const contrast = VARIANTS.flatMap((v) => contrastProblems(tokens[v.name], v));
  if (contrast.length) return refuse(contrast[0], contrast);

  const teamId = club === 'any' ? null : (club as number);
  const id = pack.id as string;
  return {
    ok: true,
    pack: {
      id,
      name,
      kind: 'installed',
      version,
      teamId,
      tokens,
      logo: files.logo ? assetPath(files.logo) : null,
      art: files.art ? assetPath(files.art) : null,
    },
  };
}
