import { describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { DEFAULT_PHILOSOPHY_POLICIES, DEFAULT_PHILOSOPHY_VALUES } from '../server/philosophy.js';
import { playerSurplus, type LensPhilosophy } from '../server/playerValue.js';
import { analyzeTrade, tradeContext } from '../server/trade.js';
import { TRADE_ANSWER_FORMAT, tradeSystem } from '../server/ai.js';
import type { Persona } from '../server/staff.js';
import { buildSave, type BuiltSave, type SaveSpec } from './syntheticSave';
import { post } from './request';

/*
 * The Trade Center on Player Value (phase 6b; PLAYER_VALUE.md Part 8, consumer 3; BEHAVIOR_CASES.md "Player Value",
 * phase 6b), on a synthetic save: each player in a deal carries the valuation every read serves; the neutral reading of a
 * deal is the same whoever looks and under any philosophy; an unknown player is named and left out; the AI's trade context
 * carries Player Value's decomposition and never `players_value`. No case names a player or says who is worth more.
 */

const SLOW = 120_000;
const spec: SaveSpec = { season: 2040, historySeasons: 6, gamesPerTeam: 162, playedShare: 0.4, clubs: 8, minors: true, seed: 7 };

/** Held players of one organization and of another, valued in dollars, and one whose value is unknown. */
function cast(save: BuiltSave) {
  const orgOf = db.prepare(`SELECT organization_id AS org FROM players WHERE player_id = ?`);
  const ours = [...new Set([save.regular, ...save.hitters, ...save.pitchers])]
    .filter((id) => (orgOf.get(id) as { org: number } | undefined)?.org === save.org && playerSurplus(id)?.contract.status === 'known');
  const theirs = [...save.hitters, ...save.pitchers]
    .filter((id) => { const o = (orgOf.get(id) as { org: number } | undefined)?.org; return o !== undefined && o !== save.org && o > 0; })
    .filter((id) => playerSurplus(id)?.contract.status === 'known');
  const unknown = [...save.prospects, ...save.hitters, ...save.pitchers].find((id) => {
    const s = playerSurplus(id);
    return s !== null && s.contract.status !== 'known';
  });
  return { ours, theirs, unknown };
}

const figure = (t: { low: number | null; central: number | null; high: number | null; centralRange: { low: number; high: number } | null }) =>
  ({ low: t.low, central: t.central, high: t.high, centralRange: t.centralRange });

const neutralOf = (a: ReturnType<typeof analyzeTrade>) => ({
  unit: a.value.unit,
  sent: a.value.sent.players.map((p) => [p.playerId, p.contract, p.keeping, p.counted]),
  received: a.value.received.players.map((p) => [p.playerId, p.contract, p.keeping, p.counted]),
  sentTotal: a.value.sent.total, receivedTotal: a.value.received.total, difference: a.value.difference,
});

const PHILOSOPHIES: LensPhilosophy[] = [
  { dimensions: { ...DEFAULT_PHILOSOPHY_VALUES }, policies: { ...DEFAULT_PHILOSOPHY_POLICIES } },
  { dimensions: { ...DEFAULT_PHILOSOPHY_VALUES, competitiveWindow: 95, riskTolerance: 80, payrollFlexibility: 10, costEfficiency: 20, teamControl: 30 }, policies: { ...DEFAULT_PHILOSOPHY_POLICIES, rentalAcquisitions: 'aggressive' } },
  { dimensions: { ...DEFAULT_PHILOSOPHY_VALUES, competitiveWindow: 5, riskTolerance: 10, payrollFlexibility: 90, costEfficiency: 90, teamControl: 90 }, policies: { ...DEFAULT_PHILOSOPHY_POLICIES, salaryDumps: 'willing' } },
];

describe('the Trade Center reads Player Value', () => {
  it('each player in a deal carries the contract value and the value of keeping him that the card serves, and the route serves the same', async () => {
    const save = buildSave(spec);
    const { ours, theirs } = cast(save);
    expect(ours.length).toBeGreaterThan(1);
    expect(theirs.length).toBeGreaterThan(1);
    const sent = ours.slice(0, 2);
    const received = theirs.slice(0, 2);
    const a = analyzeTrade(sent, received, { orgId: save.org, philosophy: PHILOSOPHIES[0] });
    for (const [ids, side] of [[sent, a.value.sent], [received, a.value.received]] as const) {
      expect(side.players.map((p) => p.playerId)).toEqual(ids);
      for (const p of side.players) {
        const card = playerSurplus(p.playerId)!;
        expect(p.contract).toEqual(figure(card.contract));
        expect(p.keeping).toEqual(figure(card.retention));
      }
    }
    // Each row: who he is, his control with its cost season by season, his expected production
    for (const row of [...a.sent, ...a.received]) {
      expect(row.name).toBeTruthy();
      expect(row.position).toBeTruthy();
      expect(row.control.text.length).toBeGreaterThan(0);
      expect(row.production).toBeDefined();
    }
    expect(a.value.difference.status).toBe('known');
    const served = await post('/api/trade/analyze', { sideA: sent, sideB: received, orgId: save.org });
    expect(served.value.sent.players.map((p: { contract: unknown }) => p.contract)).toEqual(JSON.parse(JSON.stringify(a.value.sent.players.map((p) => p.contract))));
    expect(served.value.difference.figure).toEqual(JSON.parse(JSON.stringify(a.value.difference.figure)));
  }, SLOW);

  it('the same deal reads the same whoever looks and under any philosophy: a contender and a seller see one set of neutral numbers', () => {
    const save = buildSave(spec);
    const { ours, theirs } = cast(save);
    const sent = ours.slice(0, 2);
    const received = theirs.slice(0, 1);
    const clubs = [save.org, ...save.clubs.filter((c) => c !== save.org).slice(0, 2)];
    const base = neutralOf(analyzeTrade(sent, received, { orgId: save.org, philosophy: PHILOSOPHIES[0] }));
    for (const orgId of clubs) {
      for (const philosophy of PHILOSOPHIES) {
        const a = analyzeTrade(sent, received, { orgId, philosophy });
        expect(neutralOf(a)).toEqual(base);
        // The club's value of a win is context, named for the club that reads it, never inside a figure
        expect(a.winValues[0]?.teamId).toBe(orgId);
      }
    }
    expect(neutralOf(analyzeTrade(sent, received, { orgId: null, philosophy: null }))).toEqual(base);
  }, SLOW);

  it('a player whose value is unknown is named with his reason and left out of the sums, which say so', () => {
    const save = buildSave(spec);
    const { ours, theirs, unknown } = cast(save);
    expect(unknown).toBeDefined();
    const without = analyzeTrade(ours.slice(0, 1), theirs.slice(0, 1), { orgId: save.org, philosophy: null });
    const withHim = analyzeTrade(ours.slice(0, 1), [...theirs.slice(0, 1), unknown!], { orgId: save.org, philosophy: null });
    expect(withHim.value.difference.figure).toEqual(without.value.difference.figure);
    expect(withHim.value.received.total.excluded.map((x) => x.playerId)).toEqual([unknown]);
    const row = withHim.received.find((r) => r.playerId === unknown)!;
    expect(row.name).toBeTruthy();
    expect(withHim.value.received.players.find((p) => p.playerId === unknown)?.notCounted).toMatch(/^Not valued yet/);
  }, SLOW);

  it('the AI\'s trade context carries Player Value\'s decomposition and the difference band, never players_value, a percentile or an OOTP rating', () => {
    const save = buildSave(spec);
    const { ours, theirs } = cast(save);
    const ctx = tradeContext(save.org, ours.slice(0, 2), theirs.slice(0, 1));
    const text = JSON.stringify(ctx);
    for (const banned of ['oaRating', 'potRating', 'overallPct', 'talentPct', 'valuePct', 'valueSent', 'valueReceived', 'talentSent', 'totalValue', 'totalTalent']) {
      expect(text, banned).not.toContain(`"${banned}"`);
    }
    expect(ctx.value.difference.status).toBe('known');
    expect(ctx.value.difference.figure).not.toBeNull();
    for (const p of [...ctx.weGive, ...ctx.weReceive]) {
      expect(p).toHaveProperty('value');
      expect(p).toHaveProperty('expectedWins');
    }
  }, SLOW);

  it('the desk is told to explain Pennant\'s figures: never a valuation number of its own, never a percentile, never an accept-or-reject verdict', () => {
    const voice = { id: 'gm', name: 'the front office', role: 'front office', facts: [] } as unknown as Persona;
    const system = tradeSystem(voice, 'Club 1') + TRADE_ANSWER_FORMAT;
    expect(system).not.toMatch(/overallPct|talentPct|percentile/i);
    expect(system).not.toMatch(/Accept \/ Reject|Needs a sweetener|\*\*Verdict\*\*/);
    expect(system).toMatch(/never (?:produce|give|state) a (?:value|valuation) (?:number|figure) of your own/i);
    expect(system).toMatch(/difference/i);
  });
});
