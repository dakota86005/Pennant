import express from 'express';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '../server/api.js';
import { DATA_DIR } from '../server/config.js';
import type { Catalog } from '../server/presentation/catalog.js';
import { relativeLuminance } from '../server/presentation/palette.js';
import {
  CLUB_COLORS_ID, INCREASED_CONTRAST, MAX_ASSET_BYTES, TEXT_CONTRAST, TITLE_BAR, VARIANTS, clubColorVariants, contrastProblems,
  contrastRatio, readPack, worstBlend,
} from '../server/presentation/themePacks.js';
import type { ThemeChoices, ThemeTokens, ThemeVariants } from '../server/contract/themePack.js';
import { loadSettings } from '../server/settings.js';
import { activePack, chooseTheme, installedPacks, themeChoices, themePacksFolder } from '../server/themePackStore.js';
import { buildSave } from './syntheticSave.js';
import { IDS } from './fixture';

/**
 * Theme packs (D-062, SWIFTUI_REBUILD.md section 3.7): every club's own colours as a pack derived from the save, the
 * check an installed pack passes (its shape, its files, and every piece of text on its colour in light, dark and with
 * Increase Contrast), which pack each club wears, and the catalog serving it.
 */

const EXAMPLE = path.join(process.cwd(), 'docs', 'theme-packs', 'sunset-series', 'pack.json');
const example = (): Record<string, unknown> => JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
const noFiles = { size: () => null };
const assetPath = (file: string) => `/api/theme-packs/x/${file}`;

/** Every text pair of every appearance reads (the check reports nothing). */
function allRead(tokens: ThemeVariants): string[] {
  return VARIANTS.flatMap((v) => contrastProblems(tokens[v.name], v));
}

describe('a club\'s own colours, from the save', () => {
  const clubs: Record<string, { bg: string | null; fg: string | null; secondary: string | null; cap: string | null } | null> = {
    'the synthetic league': { bg: '#1d2d44', fg: '#f0ebd8', secondary: '#748cab', cap: null },
    'navy and red': { bg: '#0c2340', fg: '#ffffff', secondary: '#bd3039', cap: '#0c2340' },
    'gold and black': { bg: '#fdb827', fg: '#27251f', secondary: '#27251f', cap: null },
    'black and white': { bg: '#000000', fg: '#ffffff', secondary: '#c4ced4', cap: null },
    'white': { bg: '#ffffff', fg: '#000000', secondary: '#ffffff', cap: null },
    'a bright red': { bg: '#e81828', fg: '#ffffff', secondary: '#002d72', cap: null },
    'no colours in the export': null,
  };

  it.each(Object.entries(clubs))('reads in every appearance: %s', (_name, colors) => {
    expect(allRead(clubColorVariants(colors))).toEqual([]);
  });

  it('lightens the top of the light masthead so the window\'s title reads, and darkens the dark one', () => {
    const tokens = clubColorVariants(clubs['the synthetic league']);
    // The light top is nearly white, far lighter than the club's colour beneath it
    expect(relativeLuminance(tokens.light.mastheadTop)).toBeGreaterThan(relativeLuminance(tokens.light.masthead[0]) + 0.5);
    expect(contrastRatio(tokens.light.mastheadTop, TITLE_BAR.light.against)).toBeGreaterThanOrEqual(TITLE_BAR.light.at);
    expect(contrastRatio(tokens.dark.mastheadTop, TITLE_BAR.dark.against)).toBeGreaterThanOrEqual(TITLE_BAR.dark.at);
    // Still the club's hue, not a plain grey: its blue channel leads, as the navy's does
    const [r, , b] = [1, 3, 5].map((i) => parseInt(tokens.light.mastheadTop.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
  });

  it('holds its text to 7:1 with Increase Contrast', () => {
    const tokens = clubColorVariants(clubs['a bright red']);
    for (const stop of tokens.lightIncreasedContrast.masthead) {
      expect(contrastRatio(stop, tokens.lightIncreasedContrast.mastheadText)).toBeGreaterThanOrEqual(INCREASED_CONTRAST);
    }
    expect(contrastRatio(tokens.darkIncreasedContrast.card, tokens.darkIncreasedContrast.cardText)).toBeGreaterThanOrEqual(INCREASED_CONTRAST);
  });

  it('is the club\'s for any league: every club of a synthetic save, and of the fixture league', async () => {
    const { catalogClubs } = await import('../server/org.js');
    const clubsInSave = catalogClubs();
    expect(clubsInSave.length).toBeGreaterThan(0);
    for (const club of clubsInSave) expect(allRead(clubColorVariants(club.colors)), club.label).toEqual([]);
  });

  it('checks a gradient\'s blend, not only its ends', () => {
    // Two stops that each read under white can blend into a lighter colour than either (green and red make yellow)
    const blend = worstBlend('#008a00', '#d00000', '#ffffff');
    expect(blend).toBe('#d08a00');
    expect(contrastRatio(blend, '#ffffff')).toBeLessThan(Math.min(contrastRatio('#008a00', '#ffffff'), contrastRatio('#d00000', '#ffffff')));
  });
});

describe('an installed pack is checked before it is served', () => {
  it('serves the example pack, and makes its Increase Contrast colours when it gives none', () => {
    const reading = readPack(example(), 'sunset-series', noFiles, assetPath);
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.pack).toMatchObject({ id: 'sunset-series', name: 'Sunset Series', kind: 'installed', version: '1.0', teamId: null, logo: null, art: null });
    expect(allRead(reading.pack.tokens)).toEqual([]);
    // Made from its plain colours, darker where the text is white
    const made = reading.pack.tokens.lightIncreasedContrast;
    expect(contrastRatio(made.masthead[1], made.mastheadText)).toBeGreaterThanOrEqual(INCREASED_CONTRAST);
    expect(made.mastheadText).toBe('#ffffff');
  });

  const refusedFor = (edit: (pack: Record<string, unknown>) => void, folder = 'sunset-series', files = noFiles) => {
    const pack = example();
    edit(pack);
    const reading = readPack(pack, folder, files, assetPath);
    expect(reading.ok).toBe(false);
    return reading.ok ? { problem: '', details: [] } : reading;
  };

  it('refuses a pack in the wrong shape, in a sentence', () => {
    expect(refusedFor((p) => { p.format = 2; }).problem).toBe('It is written for a newer version of Pennant (format 2).');
    expect(refusedFor((p) => { delete p.format; }).problem).toBe('Its pack.json needs "format": 1.');
    expect(refusedFor((p) => { p.colour = 'red'; }).problem).toBe('It has settings this version doesn\'t know: colour.');
    expect(refusedFor(() => {}, 'another-folder').problem).toBe('Its "id" ("sunset-series") must match its folder\'s name ("another-folder").');
    expect(refusedFor((p) => { p.id = CLUB_COLORS_ID; }, CLUB_COLORS_ID).problem).toContain('can\'t be "club-colors"');
    expect(refusedFor((p) => { p.club = 'mine'; }).problem).toBe('Its "club" must be a team id from the save, or "any".');
    expect(refusedFor((p) => { (p.light as ThemeTokens).accent = 'red'; }).problem).toBe('"light.accent" must be a colour written #rrggbb.');
    expect(refusedFor((p) => { (p.dark as ThemeTokens).masthead = ['#000000', '#000000', '#000000', '#000000', '#000000']; }).problem)
      .toBe('"dark.masthead" must be one to four colours written #rrggbb.');
    expect(refusedFor((p) => { delete p.dark; }).problem).toBe('"dark" must list the pack\'s colours.');
  });

  it('refuses a pack whose text does not read, naming the pair, the appearance and the ratio', () => {
    const { problem, details } = refusedFor((p) => { (p.dark as ThemeTokens).masthead = ['#5e0c1a', '#ff8a65']; });
    expect(problem).toMatch(/^The masthead's text on its second colour reads at \d\.\d:1 in dark; it needs 4\.5:1\.$/);
    // And every other failing pair in its details, the blend included
    expect(details.some((d) => d.includes('the blend of its first and second colours'))).toBe(true);
  });

  it('refuses a light masthead top the window\'s title would not read on', () => {
    const { problem } = refusedFor((p) => { (p.light as ThemeTokens).mastheadTop = '#7a1020'; });
    expect(problem).toMatch(/^The window's title on the masthead's top reads at .* in light; it needs 17\.0:1\.$/);
  });

  it('refuses a pack whose own Increase Contrast colours fall short of 7:1', () => {
    const { problem } = refusedFor((p) => { p.lightIncreasedContrast = p.light; });
    expect(problem).toContain('in light with Increase Contrast; it needs 7.0:1.');
  });

  it('refuses a missing, misnamed or oversized picture', () => {
    expect(refusedFor((p) => { p.logo = 'logo.png'; }).problem).toBe('Its logo, logo.png, isn\'t in the pack\'s folder.');
    expect(refusedFor((p) => { p.art = '../outside.png'; }).problem).toBe('Its "art" must name a .png or .jpg file in the pack\'s folder.');
    expect(refusedFor((p) => { p.logo = 'logo.gif'; }).problem).toBe('Its "logo" must name a .png or .jpg file in the pack\'s folder.');
    expect(refusedFor((p) => { p.logo = 'big.png'; }, 'sunset-series', { size: () => MAX_ASSET_BYTES + 1 }).problem)
      .toBe('Its logo, big.png, is larger than 2 MB.');
    const reading = readPack({ ...example(), logo: 'logo.png' }, 'sunset-series', { size: () => 1200 }, assetPath);
    expect(reading.ok && reading.pack.logo).toBe('/api/theme-packs/x/logo.png');
  });

  it('holds every pair to the same bar in the check and in the made colours', () => {
    expect(TEXT_CONTRAST).toBe(4.5);
    expect(INCREASED_CONTRAST).toBe(7);
  });
});

describe('which pack each club wears', () => {
  const folder = themePacksFolder();
  const settingsFile = path.join(DATA_DIR, 'settings.json');
  let savedSettings: string | null = null;
  const club = { team_id: IDS.mlbTeam, colors: { bg: '#1d2d44', fg: '#f0ebd8', secondary: '#748cab', cap: null } };
  const other = { team_id: IDS.otherMlbTeam, colors: null };

  const install = (id: string, pack: Record<string, unknown>, files: Record<string, Buffer> = {}) => {
    fs.mkdirSync(path.join(folder, id), { recursive: true });
    fs.writeFileSync(path.join(folder, id, 'pack.json'), JSON.stringify(pack));
    for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(folder, id, name), bytes);
  };

  beforeAll(() => {
    savedSettings = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : null;
  });
  afterEach(() => {
    fs.rmSync(folder, { recursive: true, force: true });
    if (savedSettings === null) fs.rmSync(settingsFile, { force: true });
    else fs.writeFileSync(settingsFile, savedSettings);
  });

  it('wears its own colours with no pack installed, and lists only them', () => {
    const choices = themeChoices(club);
    expect(choices.active).toBe(CLUB_COLORS_ID);
    expect(choices.choices.map((c) => c.id)).toEqual([CLUB_COLORS_ID]);
    expect(choices.choices[0]).toMatchObject({ kind: 'clubColors', name: 'Team colors', teamId: IDS.mlbTeam });
    expect(choices.refused).toEqual([]);
    expect(choices.unavailable).toBeNull();
    expect(choices.folder).toBe(folder);
  });

  it('wears a chosen pack, per club, and forgets it on "club-colors"', () => {
    install('sunset-series', example());
    const chosen = chooseTheme(club, 'sunset-series');
    expect(chosen.active).toBe('sunset-series');
    expect(loadSettings().themePacks).toEqual({ [String(IDS.mlbTeam)]: 'sunset-series' });
    expect(activePack(club).pack.id).toBe('sunset-series');
    // Another club is untouched
    expect(activePack(other).pack.id).toBe(CLUB_COLORS_ID);
    expect(chooseTheme(club, CLUB_COLORS_ID).active).toBe(CLUB_COLORS_ID);
    expect(loadSettings().themePacks).toEqual({});
  });

  it('refuses a pack that is not installed, was refused, or is made for another club', () => {
    expect(() => chooseTheme(club, 'nothing-here')).toThrow('There is no theme pack by that name in the theme-packs folder.');
    install('broken', { ...example(), id: 'broken', dark: { ...(example().dark as object), cardText: '#5e0c1a' } });
    expect(() => chooseTheme(club, 'broken')).toThrow('That theme pack was refused when it was read, so it can\'t be worn until it is fixed.');
    install('theirs', { ...example(), id: 'theirs', club: IDS.otherMlbTeam });
    expect(() => chooseTheme(club, 'theirs')).toThrow('That theme pack is made for another club.');
    expect(chooseTheme(other, 'theirs').active).toBe('theirs');
    expect(themeChoices(club).choices.map((c) => c.id)).toEqual([CLUB_COLORS_ID]);
    expect(() => chooseTheme(club, 42)).toThrow('Choose a theme to wear.');
  });

  it('never half-applies a pack that breaks after it was chosen: the club wears its own colours, and says why', () => {
    install('sunset-series', example());
    chooseTheme(club, 'sunset-series');
    install('sunset-series', { ...example(), dark: { ...(example().dark as object), mastheadText: '#5e0c1a' } });
    const choices = themeChoices(club);
    expect(choices.active).toBe(CLUB_COLORS_ID);
    expect(choices.unavailable?.display).toBe('The theme chosen for this club isn\'t available, so it wears its team colors.');
    expect(choices.refused).toHaveLength(1);
    expect(choices.refused[0].folder).toBe('sunset-series');
    expect(choices.refused[0].problem.display).toMatch(/^The masthead's text on its first colour reads at .* in dark; it needs 4\.5:1\.$/);
  });

  it('refuses a folder with no pack.json or with a file that is not JSON, rather than skipping it', () => {
    fs.mkdirSync(path.join(folder, 'empty'), { recursive: true });
    install('garbled', {});
    fs.writeFileSync(path.join(folder, 'garbled', 'pack.json'), '{ not json');
    const { refused } = installedPacks();
    expect(refused.map((r) => [r.folder, r.problem.display])).toEqual([
      ['empty', 'It has no pack.json.'],
      ['garbled', 'Its pack.json could not be read as JSON.'],
    ]);
  });

  it('follows no link: a linked picture, a linked pack.json or a linked pack folder is refused and listed (review S4)', () => {
    const outside = fs.mkdtempSync(path.join(path.dirname(folder), 'outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'secret.png'), Buffer.from([137, 80, 78, 71]));
      install('linked-logo', { ...example(), id: 'linked-logo', logo: 'logo.png' });
      fs.symlinkSync(path.join(outside, 'secret.png'), path.join(folder, 'linked-logo', 'logo.png'));
      fs.mkdirSync(path.join(folder, 'linked-json'), { recursive: true });
      fs.writeFileSync(path.join(outside, 'pack.json'), JSON.stringify({ ...example(), id: 'linked-json' }));
      fs.symlinkSync(path.join(outside, 'pack.json'), path.join(folder, 'linked-json', 'pack.json'));
      fs.mkdirSync(path.join(outside, 'elsewhere'));
      fs.writeFileSync(path.join(outside, 'elsewhere', 'pack.json'), JSON.stringify({ ...example(), id: 'linked-folder' }));
      fs.symlinkSync(path.join(outside, 'elsewhere'), path.join(folder, 'linked-folder'));
      const { packs, refused } = installedPacks();
      expect(packs).toEqual([]);
      expect(refused.map((r) => [r.folder, r.problem.display])).toEqual([
        ['linked-folder', 'It is a link to a folder elsewhere; put the pack\'s folder itself in theme-packs.'],
        ['linked-json', 'Its pack.json is a link to a file elsewhere; put the file itself in the pack\'s folder.'],
        ['linked-logo', 'Its logo, logo.png, is a link to a file elsewhere; put the picture itself in the pack\'s folder.'],
      ]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('puts the save\'s logo on a pack that has none, and its own on one that has', () => {
    install('with-logo', { ...example(), id: 'with-logo', logo: 'mark.png' }, { 'mark.png': Buffer.from([137, 80, 78, 71]) });
    expect(installedPacks().packs[0].logo).toBe('/api/theme-packs/with-logo/mark.png');
  });
});

describe('the routes (a synthetic save)', () => {
  let base = '';
  let close = (): void => {};
  const folder = themePacksFolder();
  const settingsFile = path.join(DATA_DIR, 'settings.json');
  let savedSettings: string | null = null;
  let org = 0;

  beforeAll(async () => {
    org = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 20, playedShare: 0.5, clubs: 4, seed: 5 }).org;
    savedSettings = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : null;
    const app = express();
    app.use(express.json());
    app.use('/api', api);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => {
      server.closeAllConnections();
      server.close();
    };
    fs.mkdirSync(path.join(folder, 'sunset-series'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'sunset-series', 'pack.json'), JSON.stringify({ ...example(), logo: 'mark.png' }));
    fs.writeFileSync(path.join(folder, 'sunset-series', 'mark.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    fs.writeFileSync(path.join(folder, 'sunset-series', 'notes.png'), Buffer.from([137, 80, 78, 71]));
  });

  afterAll(() => {
    close();
    fs.rmSync(folder, { recursive: true, force: true });
    if (savedSettings === null) fs.rmSync(settingsFile, { force: true });
    else fs.writeFileSync(settingsFile, savedSettings);
  });

  const catalogTheme = async (teamId: number) => {
    const catalog = await (await fetch(`${base}/api/v2/catalog`)).json() as Catalog;
    return catalog.clubs.find((c) => c.teamId === teamId)!.theme;
  };

  it('serves each club\'s own colours in the catalog until another pack is chosen, then that pack', async () => {
    expect((await catalogTheme(org)).id).toBe(CLUB_COLORS_ID);
    const choices = await (await fetch(`${base}/api/v2/theme-packs/automatic`)).json() as ThemeChoices;
    expect(choices.teamId).toBe(org);
    expect(choices.choices.map((c) => c.id)).toEqual([CLUB_COLORS_ID, 'sunset-series']);

    const res = await fetch(`${base}/api/v2/theme-packs/${org}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packId: 'sunset-series' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ThemeChoices).active).toBe('sunset-series');
    const theme = await catalogTheme(org);
    expect(theme).toMatchObject({ id: 'sunset-series', kind: 'installed', logo: '/api/theme-packs/sunset-series/mark.png' });
    // The other clubs still wear their own
    const catalog = await (await fetch(`${base}/api/v2/catalog`)).json() as Catalog;
    expect(catalog.clubs.filter((c) => c.teamId !== org).every((c) => c.theme.id === CLUB_COLORS_ID)).toBe(true);
  });

  it('refuses a choice it cannot make in a sentence, and an unknown club', async () => {
    const res = await fetch(`${base}/api/v2/theme-packs/${org}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packId: 'nothing-here' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'There is no theme pack by that name in the theme-packs folder.' });
    expect((await fetch(`${base}/api/v2/theme-packs/9999`)).status).toBe(404);
  });

  it('serves a pack\'s named pictures, and nothing else in its folder', async () => {
    const logo = await fetch(`${base}/api/theme-packs/sunset-series/mark.png`);
    expect(logo.status).toBe(200);
    expect(logo.headers.get('content-type')).toBe('image/png');
    expect((await fetch(`${base}/api/theme-packs/sunset-series/notes.png`)).status).toBe(404);
    expect((await fetch(`${base}/api/theme-packs/sunset-series/pack.json`)).status).toBe(404);
    expect((await fetch(`${base}/api/theme-packs/..%2F..%2Fsettings.json/x.png`)).status).toBe(404);
  });

  it('reads each club\'s choice once for the whole catalog, not once a club (review nit)', async () => {
    const reads = vi.spyOn(fs, 'readFileSync');
    try {
      const catalog = await (await fetch(`${base}/api/v2/catalog`)).json() as Catalog;
      expect(catalog.clubs.length).toBeGreaterThan(2);
      const settingsReads = reads.mock.calls.filter(([file]) => String(file) === settingsFile).length;
      // One for the choices, one for the club the app is about; never one a club
      expect(settingsReads).toBeLessThanOrEqual(2);
    } finally {
      reads.mockRestore();
    }
  });

  it('never serves a file a link points to (review S4)', async () => {
    fs.mkdirSync(path.join(folder, 'linked'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'linked', 'pack.json'), JSON.stringify({ ...example(), id: 'linked', logo: 'logo.png' }));
    fs.symlinkSync('/etc/hosts', path.join(folder, 'linked', 'logo.png'));
    try {
      expect((await fetch(`${base}/api/theme-packs/linked/logo.png`)).status).toBe(404);
      const choices = await (await fetch(`${base}/api/v2/theme-packs/${org}`)).json() as ThemeChoices;
      expect(choices.refused.map((r) => r.folder)).toContain('linked');
    } finally {
      fs.rmSync(path.join(folder, 'linked'), { recursive: true, force: true });
    }
  });
});
