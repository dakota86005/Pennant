import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { clearProductionCaches } from '../server/playerValue.js';
import { costBandText, costMoney } from '../src/costBand';
import { buildSave, type BuiltSave, type SaveSpec } from './syntheticSave';
import request from './request';
import { visibleText } from './visibleText';

/*
 * Player Value phase 6e: Payroll in plain words (BEHAVIOR_CASES.md "Player Value", phase 6e row; AGENTS.md "Writing for the
 * GM"). The page talks like a front office: what a controlled season could cost reads "most likely $X · could be $A to $B",
 * a season he may leave "if kept", and no method word (central, band, edge against edge, combined as independent, calibrated,
 * ladder, class, prior, provisional, "if held") is in what the GM reads. Every figure the page showed is still on it, and the
 * basis (how the club's range combines players, the every-player-at-his-edge sum, how a controlled season is priced, what
 * the price of a win rests on) is in the hovers and breakdowns. Built on a synthetic save; no case names a player or a figure.
 */

const SLOW = 120_000;
const spec: SaveSpec = { season: 2040, historySeasons: 6, gamesPerTeam: 162, playedShare: 0.4, clubs: 8, minors: true, seed: 7 };

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let save: BuiltSave;
let data: Any;
let finance: Any;

/** Method words the GM never reads on Payroll's face; they may stand in a hover or a breakdown. */
const JARGON = [
  /\bcentrals?\b/i, /edge against edge/i, /\bedges?\b/i, /combined as independent/i, /calibrat/i, /\bband\b/i, /\bladder\b/i,
  /\bclass \d/i, /\bprovisional\b/i, /\bprior\b/i, /if held/i, /\bindeterminate\b/i, /\bpre-arb\b/i, /\barb\b/i,
  /range of reasonable readings/i, /players_value/, /\b[DQRA]-\d/, /\bnull\b/, /\bundefined\b/, /\bNaN\b/,
];

/** What the GM reads without opening anything: hovers' popups and the bodies of closed breakdowns taken out. */
const face = (html: string): string =>
  visibleText(html.replace(/<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, '<span>$1</span>'));

/** Everything the page carries, the hovers and closed breakdowns included: where the basis must still be. */
const everything = (html: string): string =>
  html.replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');

/** A price per win as the page prints it: one figure where the ends print alike. */
const perWin = (v: number) => `$${(v / 1_000_000).toFixed(2)}M`;
const perWinRange = (low: number, high: number) => (perWin(low) === perWin(high) ? perWin(low) : `${perWin(low)} to ${perWin(high)}`);

/** "$A to $B", as Payroll now prints a range. */
const words = (low: number, high: number): string => costBandText(low, high).replace('–', ' to ');

async function render(overrides: { data?: Any; finance?: Any } = {}): Promise<string> {
  const { PayrollView } = await import('../src/pages/Payroll');
  return renderToStaticMarkup(createElement(PayrollView, { data: overrides.data ?? data, finance: overrides.finance ?? finance, onSaveBudget: () => {} }));
}

beforeAll(async () => {
  save = buildSave(spec);
  // A club option and a player option on the club's books, the way the export writes them, so both branches are on the page
  const ours = db.prepare(`SELECT c.player_id FROM players_contract c JOIN players p ON p.player_id = c.player_id
    WHERE p.organization_id = ? AND c.is_major = 1 AND c.years >= 2 ORDER BY c.player_id`).all(save.org) as Array<{ player_id: number }>;
  db.prepare(`UPDATE players_contract SET last_year_team_option = 1 WHERE player_id = ?`).run(ours[0].player_id);
  db.prepare(`UPDATE players_contract SET last_year_player_option = 1 WHERE player_id = ?`).run(ours[1].player_id);
  clearProductionCaches();
  data = await request(`/api/payroll/${save.org}`);
  finance = await request(`/api/club-finances/${save.org}`);
}, SLOW);

describe('Payroll talks like a front office (phase 6e)', () => {
  it('has projected seasons and options to show, so the cases below read something', () => {
    expect(data.commitments.some((c: Any) => c.projected?.players > 0)).toBe(true);
    expect(data.players.some((p: Any) => (p.optionYears ?? []).some((o: Any) => !o.committed))).toBe(true);
    expect(finance.league.priceOfWin.price.value).not.toBeNull();
  });

  it('carries no method word in what the GM reads', async () => {
    const text = face(await render());
    for (const jargon of JARGON) expect(text, String(jargon)).not.toMatch(jargon);
  }, SLOW);

  it('reads a controlled season\'s cost the way the other pages do: most likely, what it could be, "if kept"', async () => {
    const text = face(await render());
    expect(text).toMatch(/most likely/i);
    expect(text).toMatch(/could be/);
    const mayLeave = data.commitments.some((c: Any) => c.projected?.mayLeave > 0)
      || data.players.some((p: Any) => (p.projected ?? []).some((c: Any) => c?.ifHeld));
    if (mayLeave) expect(text).toMatch(/if kept/);
  }, SLOW);

  it('keeps every figure: the club\'s range and its most likely each season, the price of a win and what a controlled season costs', async () => {
    const html = await render();
    const text = face(html);
    for (const c of data.commitments) {
      if (!(c.projected?.players > 0)) continue;
      expect(text, `${c.year}`).toContain(words(c.projected.low, c.projected.high));
      const m = c.projected.central;
      expect(text, `${c.year}`).toContain(m.low === m.high ? costMoney(m.low) : words(m.low, m.high));
    }
    const p = finance.league.priceOfWin.price.value;
    expect(text).toContain(perWin(p.central));
    expect(text).toContain(`could be ${perWinRange(p.low, p.high)}`);
    // The floor under the price, the range it is, on the price's hover
    const floor = finance.league.priceOfWin.floor.value;
    if (floor) expect(everything(html)).toContain(perWinRange(floor.low, floor.high));
    const renewal = finance.league.costs?.preArbitration.band.value;
    if (renewal) expect(text).toContain(words(renewal.low, renewal.high));
  }, SLOW);

  it('keeps the basis in the hovers and breakdowns: how players are combined, the every-player-at-his-edge sum, and how each season is priced', async () => {
    const html = await render();
    const all = everything(html);
    expect(all).toMatch(/combined as independent/);
    expect(all).toMatch(/not a calibrated interval/);
    for (const c of data.commitments) {
      if (!c.projected?.edges) continue;
      expect(all, `${c.year}`).toContain(words(c.projected.edges.low, c.projected.edges.high));
    }
    // Each projected season's own basis, as the timeline served it, is in its hover
    const priced = data.players.flatMap((p: Any) => (p.projected ?? []).filter(Boolean));
    expect(priced.length).toBeGreaterThan(0);
    for (const c of priced.slice(0, 10)) expect(all).toContain(c.text);
    // The price of a win's rules and the cost of controlled seasons' rules stay in the breakdowns
    expect(all).toContain(finance.league.priceOfWin.rules.central);
    if (finance.league.costs) expect(all).toContain(finance.league.costs.rules.renewal);
  }, SLOW);

  it('an option season shows both branches in plain words', async () => {
    const text = face(await render());
    expect(text).toMatch(/\boption\b/);
    expect(text).not.toMatch(/\bopt \$/);
  }, SLOW);

  it('an unknown stays a short word, never $0', async () => {
    const unknownPrice = { ...finance, league: { ...finance.league, priceOfWin: { ...finance.league.priceOfWin, price: { value: null, source: null, note: 'No market contracts.' } } } };
    const text = face(await render({ finance: unknownPrice }));
    expect(text).toMatch(/isn.t known|not known/i);
    expect(text).not.toMatch(/\$0\.00M/);
  }, SLOW);
});
