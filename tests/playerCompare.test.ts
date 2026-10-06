import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api } from '../server/api.js';
import { resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { buildPlayerDossiers } from '../server/playerDossierBuild.js';
import { resetPlayerViews } from '../server/playerViewService.js';
import { compareView } from '../server/presentation/player/compare.js';
import type { PlayerDossierView } from '../server/presentation/player/types.js';
import { BANNED_VERDICTS, basisStrings, bannedIn, bannedInPayload } from './bannedJargon';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * Comparing players (N11, the Compare window; BEHAVIOR_CASES.md "Player card"): the same field lined up for each, as his
 * own dossier serves it; ranges compared only by overlap, expected wins on the range each lands in half the time (the
 * roster map's rule, D-057); a player with no figure named and left out; no verdict, rank or combined score (D-052).
 */

let save: BuiltSave;
let views: PlayerDossierView[];
let base = '';
let close = (): void => {};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A dossier with its first value total set to a range (or not valued), and its first cone season's two ranges. */
function shaped(v: PlayerDossierView, total: { low: number; high: number } | null, wins: { inner: [number, number]; outer: [number, number] } | null): PlayerDossierView {
  const out = clone(v);
  const t = out.value.totals[0];
  if (total) {
    t.known = true;
    t.headline.text = `Most likely ${(total.low + total.high) / 2}`;
    t.headline.value = { n: (total.low + total.high) / 2, unit: 'wins', low: total.low, high: total.high, display: 'x' };
  } else {
    t.known = false;
    t.headline.text = 'Not valued yet: his production isn\'t established.';
    t.headline.value = { n: null, unit: 'wins', display: 'Not valued yet' };
  }
  const s = out.value.cone.seasons[0];
  if (wins) Object.assign(s, { established: true, expected: (wins.inner[0] + wins.inner[1]) / 2, inner: { low: wins.inner[0], high: wins.inner[1] }, outer: { low: wins.outer[0], high: wins.outer[1] } });
  else Object.assign(s, { established: false, expected: null, inner: null, outer: null });
  return out;
}

beforeAll(async () => {
  save = buildSave({ season: 2040, historySeasons: 2, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, minors: true });
  resetFrontOfficeCache();
  resetPlayerViews();
  views = buildPlayerDossiers({ orgId: save.org, importStamp: null, reportStamp: 'r1', playerIds: [save.regular, ...save.hitters.filter((h) => h !== save.regular).slice(0, 2)] }).views;
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => { server.closeAllConnections(); server.close(); };
}, 120_000);

afterAll(() => close());

describe('comparing players lines up what each is, and never says who is better (D-052, D-057)', () => {
  it('has players with a valued total and a cone, so the checks cannot pass vacuously', () => {
    expect(views.length).toBe(3);
    for (const v of views) {
      expect(v.value.totals.length).toBeGreaterThan(0);
      expect(v.value.cone.seasons.length).toBeGreaterThan(0);
    }
  });

  it('shows each player\'s figure exactly as his own dossier serves it', () => {
    const c = compareView(views, save.org, null);
    expect(c.players.map((p) => p.playerId)).toEqual(views.map((v) => v.playerId));
    const total = c.sections.flatMap((s) => s.rows).find((r) => r.id.startsWith('value-'))!;
    views.forEach((v, i) => {
      const own = v.value.totals.find((t) => `value-${t.id}` === total.id)!;
      expect(total.cells[i].display.display).toBe(own.known ? own.headline.text : 'Not valued yet');
    });
  });

  it('says two ranges that overlap can\'t be told apart, and which sits wholly above when they don\'t', () => {
    const [a, b] = views;
    const overlap = compareView([shaped(a, { low: 1, high: 4 }, null), shaped(b, { low: 3, high: 6 }, null)], save.org, null);
    const row = (c: typeof overlap) => c.sections.flatMap((s) => s.rows).find((r) => r.id.startsWith('value-'))!;
    expect(row(overlap).reading?.text).toBe('Can\'t tell apart: the ranges overlap');
    const apart = compareView([shaped(a, { low: 1, high: 2 }, null), shaped(b, { low: 3, high: 6 }, null)], save.org, null);
    expect(row(apart).reading?.text).toBe(`${b.name}'s range sits wholly above ${a.name}'s`);
    // A range above another says which figure is higher, never who is the better player
    expect(row(apart).reading?.basis.because.at(-1)?.value).toMatch(/not who is the better player/);
  });

  it('tells expected wins apart on the range each lands in half the time, drawing the wider one', () => {
    const [a, b] = views;
    const season = a.value.cone.seasons[0].season;
    const wins = (c: ReturnType<typeof compareView>) => c.sections.flatMap((s) => s.rows).find((r) => r.id === `wins-${season}`)!;
    // The 80% bars drawn overlap, the 50% ranges don't (review M3): the roster map's words, "clearly ahead of", and the
    // hover says which band is drawn and which decides, so the words and the picture agree
    const apart = compareView([shaped(a, null, { inner: [2, 3], outer: [0, 5] }), shaped(b, null, { inner: [0.5, 1.5], outer: [-1, 3] })], save.org, null);
    expect(wins(apart).reading?.text).toBe(`${a.name} is clearly ahead of ${b.name}`);
    expect(wins(apart).reading?.text).not.toMatch(/wholly above/);
    expect(wins(apart).cells[0].range).toEqual({ low: 0, high: 5, mid: 2.5 });
    expect(wins(apart).cells[1].range).toEqual({ low: -1, high: 3, mid: 1 });
    expect(wins(apart).reading?.hint).toMatch(/8 seasons in 10.*5 in 10/);
    expect(wins(apart).reading?.basis.because.find((l) => l.label === 'What is drawn')?.value).toMatch(/8 seasons in 10.*half the time/);
    // The half-the-time ranges meet: not separable, as the map says it
    const together = compareView([shaped(a, null, { inner: [1, 3], outer: [0, 5] }), shaped(b, null, { inner: [2, 4], outer: [0, 6] })], save.org, null);
    expect(wins(together).reading?.text).toBe('Not separable: their half-time ranges meet');
  });

  it('names a player with no figure as not known and leaves him out of the reading', () => {
    const [a, b, c] = views;
    const read = compareView([shaped(a, { low: 1, high: 2 }, null), shaped(b, { low: 3, high: 4 }, null), shaped(c, null, null)], save.org, null);
    const row = read.sections.flatMap((s) => s.rows).find((r) => r.id.startsWith('value-'))!;
    expect(row.cells[2].display).toMatchObject({ display: 'Not valued yet', tone: 'unknown' });
    expect(row.cells[2].range).toBeNull();
    expect(row.reading?.text).toBe(`${b.name}'s range sits wholly above ${a.name}'s. Not known for ${c.name}`);
    const alone = compareView([shaped(a, { low: 1, high: 2 }, null), shaped(c, null, null)], save.org, null);
    expect(alone.sections.flatMap((s) => s.rows).find((r) => r.id.startsWith('value-'))!.reading?.text).toBe(`Nothing to compare: ${c.name} isn't valued here`);
    // Two or more unknown: each named (review L2)
    const none = compareView([shaped(a, null, null), shaped(b, null, null), shaped(c, null, null)], save.org, null);
    expect(none.sections.flatMap((s) => s.rows).find((r) => r.id.startsWith('value-'))!.reading?.text)
      .toBe(`Nothing to compare: ${a.name}, ${b.name} and ${c.name} aren't valued here`);
  });

  it('carries no verdict, rank or combined score, its bases included', async () => {
    const c = compareView(views, save.org, null);
    expect(bannedInPayload(c, 'getPlayerCompare')).toEqual([]);
    for (const s of basisStrings(c)) expect(bannedIn(s.text, [BANNED_VERDICTS]), s.path).toEqual([]);
    expect(JSON.stringify(c)).not.toMatch(/\bbest\b|\brank|\bscore\b|combined/i);
  });

  it('compares two to four players, and refuses one or five in a sentence', async () => {
    const two = await fetch(`${base}/api/v2/compare?players=${views[0].playerId},${views[1].playerId}`);
    expect(two.status).toBe(200);
    expect(((await two.json()) as { players: unknown[] }).players.length).toBe(2);
    for (const ids of [[views[0].playerId], [...save.hitters.slice(0, 5)]]) {
      const res = await fetch(`${base}/api/v2/compare?players=${ids.join(',')}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/two to four/);
    }
  });
});
