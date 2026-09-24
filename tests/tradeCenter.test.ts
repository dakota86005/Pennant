import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { DEFAULT_PHILOSOPHY_POLICIES, DEFAULT_PHILOSOPHY_VALUES } from '../server/philosophy.js';
import { playerSurplus } from '../server/playerValue.js';
import { analyzeTrade } from '../server/trade.js';
import { TradeAnalysisPanel } from '../src/TradeAnalysis';
import type { TradeAnalysis, TradePick } from '../src/tradeApi';
import { differenceGeometry } from '../src/tradeDifferenceGeometry';
import { buildSave, type SaveSpec } from './syntheticSave';

/*
 * The Trade Center's analysis (phase 6b; BEHAVIOR_CASES.md "Player Value", phase 6b; AGENTS.md "Writing for the GM"):
 * the two sides side by side, each player a compact row, the side totals, and the difference as a band around zero with
 * its parts. Plain words on the page, the explanations in the hovers; no verdict and no jargon in what is visible. The
 * page computes nothing: it renders the analysis the server serves (here, the real one on a synthetic save).
 */

const SLOW = 120_000;
const spec: SaveSpec = { season: 2040, historySeasons: 6, gamesPerTeam: 162, playedShare: 0.4, clubs: 8, minors: true, seed: 7 };

let served: { deal: TradeAnalysis; withUnknown: TradeAnalysis; leaning: TradeAnalysis } | null = null;
function analyses() {
  if (served) return served;
  const save = buildSave(spec);
  const orgOf = db.prepare(`SELECT organization_id AS org FROM players WHERE player_id = ?`);
  const known = (id: number) => playerSurplus(id)?.contract.status === 'known';
  const org = (id: number) => (orgOf.get(id) as { org: number } | undefined)?.org;
  const ours = [...new Set([save.regular, ...save.hitters, ...save.pitchers])].filter((id) => org(id) === save.org && known(id));
  const theirs = [...save.hitters, ...save.pitchers].filter((id) => org(id) !== save.org && (org(id) ?? 0) > 0 && known(id));
  const unknown = [...save.prospects, ...save.hitters, ...save.pitchers].find((id) => playerSurplus(id) !== null && !known(id))!;
  const neutral = { dimensions: { ...DEFAULT_PHILOSOPHY_VALUES }, policies: { ...DEFAULT_PHILOSOPHY_POLICIES } };
  const winNow = { dimensions: { ...DEFAULT_PHILOSOPHY_VALUES, competitiveWindow: 95, riskTolerance: 90, costEfficiency: 10 }, policies: { ...DEFAULT_PHILOSOPHY_POLICIES } };
  const json = (x: unknown) => JSON.parse(JSON.stringify(x)) as TradeAnalysis;
  served = {
    deal: json(analyzeTrade(ours.slice(0, 2), theirs.slice(0, 2), { orgId: save.org, philosophy: neutral })),
    withUnknown: json(analyzeTrade(ours.slice(0, 1), [...theirs.slice(0, 1), unknown], { orgId: save.org, philosophy: neutral })),
    leaning: json(analyzeTrade(ours.slice(0, 2), theirs.slice(0, 2), { orgId: save.org, philosophy: winNow })),
  };
  return served;
}

type PanelProps = Parameters<typeof TradeAnalysisPanel>[0];
const pick = (id: number): TradePick => ({ player_id: id, name: `Player ${id}`, age: 27, positionName: 'SS', team: 'C1' });
const html = (props: Partial<PanelProps>) => decode(renderToStaticMarkup(createElement(TradeAnalysisPanel, {
  orgLabel: 'Club 1', loading: false, error: null, analysis: null, onRetry: () => {}, ...props,
})));
/** The markup with its entities decoded, so words with apostrophes can be matched. */
const decode = (markup: string) => markup.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** What the page shows before any hover: the markup without the hover popups, as text. */
const visible = (markup: string) => markup
  .replace(/<span class="tip-pop">[^<]*<\/span>/g, ' ')
  .replace(/<caption[\s\S]*?<\/caption>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

const JARGON = [
  /\bcentrals?\b/i, /retention margin/i, /edge against edge/i, /\bsurplus\b/i, /\bindependent\b/i, /\bcalibrat/i,
  /\b[DQR]-\d/, /players_value/, /overall_value/, /percentile/i, /\bband\b/i, /\bnull\b/, /\bundefined\b/, /\bNaN\b/,
];
const VERDICT = [
  /\b(?:win|wins|won|lose|loses|lost|winning|losing)\s+(?:the|this)\s+(?:trade|deal)\b/i, /\baccept/i, /\breject/i, /\bshould\b/i,
  /\brecommend/i, /\bfair\b/i, /\bsteal\b/i, /\bfleec/i, /\brip-?off\b/i, /\bgood deal\b/i, /\bbad deal\b/i,
];

describe('the Trade Center\'s analysis', () => {
  it('shows the two sides side by side, each player a compact row, the side totals and the difference as a band with its parts', () => {
    const a = analyses().deal;
    const out = html({ analysis: a });
    const text = visible(out);
    for (const p of [...a.sent, ...a.received]) expect(text).toContain(p.name);
    expect(text).toMatch(/Contract value/);
    expect(text).toMatch(/Most likely/);
    expect(text).toMatch(/could be/);
    expect(text).toMatch(/Keeping him/);
    expect(text).toMatch(/Coming in less going out/);
    expect(text).toMatch(/What makes up the difference/);
    // The explanations are in the hovers
    expect(out).toMatch(/tip-pop">What you'd receive less what you'd send/);
    expect(out).toMatch(/tip-pop">[^<]*players combined as independent; not a calibrated interval/);
    expect(out).toMatch(/tip-pop">[^<]*isn't a verdict/);
    // The difference drawn around zero: an image with a sentence for a name, and every value in a hidden table
    expect(out).toMatch(/role="img" aria-label="[^"]*most likely[^"]*"/);
    expect(out).toMatch(/class="visually-hidden"/);
  }, SLOW);

  it('names a player whose value is unknown in one short sentence and says the sums leave him out, never a zero', () => {
    const a = analyses().withUnknown;
    const text = visible(html({ analysis: a }));
    expect(text).toMatch(/Not valued yet/);
    expect(text).toMatch(/Leaves out/);
  }, SLOW);

  it('shows our view beside the neutral figures, named for the club whose philosophy it is', () => {
    const lean = visible(html({ analysis: analyses().leaning }));
    expect(lean).toMatch(/Our view/);
    const quiet = visible(html({ analysis: analyses().deal }));
    expect(quiet).toMatch(/doesn't lean/);
  }, SLOW);

  it('carries no jargon and no verdict in its visible text', () => {
    for (const a of Object.values(analyses())) {
      const text = visible(html({ analysis: a }));
      for (const w of [...JARGON, ...VERDICT]) expect(text, String(w)).not.toMatch(w);
    }
    for (const state of [html({ sent: [], received: [] }), html({ loading: true, sent: [pick(1)], received: [pick(2)] }), html({ error: 'The server could not be reached.', sent: [pick(1)], received: [pick(2)] })]) {
      const text = visible(state);
      for (const w of [...JARGON, ...VERDICT]) expect(text, String(w)).not.toMatch(w);
    }
  }, SLOW);

  it('has designed empty, loading and error states', () => {
    expect(visible(html({ sent: [], received: [] }))).toMatch(/Add players to each side/);
    expect(visible(html({ sent: [pick(1)], received: [] }))).toMatch(/Add a player to the side you'd receive/);
    expect(visible(html({ loading: true, sent: [pick(1)], received: [pick(2)] }))).toMatch(/Weighing the deal/);
    const error = html({ error: 'The server could not be reached.', sent: [pick(1)], received: [pick(2)] });
    expect(visible(error)).toMatch(/couldn't be weighed/);
    expect(error).toMatch(/<button[^>]*>Try again<\/button>/);
  });
});

describe('the difference bar\'s geometry', () => {
  it('places zero, the range and the most likely reading inside the width, in order, with zero always on the scale', () => {
    const cases = [
      { low: -40e6, central: 12e6, high: 71e6, centralRange: null },
      { low: 5e6, central: 20e6, high: 30e6, centralRange: null },
      { low: -90e6, central: null, high: -10e6, centralRange: { low: -60e6, high: -40e6 } },
      { low: 0, central: 0, high: 0, centralRange: null },
    ];
    for (const f of cases) {
      const g = differenceGeometry(f, 400);
      for (const x of [g.zero, g.low, g.high, g.likelyLow, g.likelyHigh]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(400);
      }
      expect(g.low).toBeLessThanOrEqual(g.likelyLow);
      expect(g.likelyLow).toBeLessThanOrEqual(g.likelyHigh);
      expect(g.likelyHigh).toBeLessThanOrEqual(g.high);
      expect(g.domain[0]).toBeLessThanOrEqual(0);
      expect(g.domain[1]).toBeGreaterThanOrEqual(0);
      // Symmetric about zero, so left and right read the same distance
      expect(g.domain[0]).toBeCloseTo(-g.domain[1], 6);
    }
  });
});
