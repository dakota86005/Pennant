import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { loadScoutedAbilities } from '../server/scoutedEvidence.js';
import { clearValuationCaches } from '../server/valuation.js';
import request from './request';
import { IDS } from './fixture';
import { visibleText } from './visibleText';

/*
 * Player Value phase 6a: the player card's header (BEHAVIOR_CASES.md "Player Value", phase 6a row; PLAYER_VALUE.md
 * Part 8). The header's Value and Talent percentiles and its Overall / Potential were OOTP's `players_value` figures,
 * which fog of war forbids (D-017): they are gone. The header now says his contract in a phrase and the Value section's
 * headline, the same valuation the section below is served, and the one scouting figure it shows is the
 * organization's own scouted tools, through the evidence boundary. It says the game date the data is from.
 */

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A figure no scout of ours gave: planted in players_value, it must never reach the card. */
const PLANTED = 77;

beforeAll(() => {
  db.prepare(`UPDATE players_value SET oa = ?, pot = ?, oa_rating = ?, pot_rating = ?, overall_value = 9999, talent_value = 9999 WHERE player_id = ?`)
    .run(PLANTED, PLANTED, PLANTED, PLANTED, IDS.starter);
  clearValuationCaches();
});

describe('the card header never shows a hidden value figure (D-017)', () => {
  it('carries no Value or Talent percentile and no Overall or Potential from players_value', async () => {
    const d = await request(`/api/player/${IDS.starter}`);
    for (const key of ['overallPct', 'talentPct', 'oaRating', 'potRating']) expect(d, key).not.toHaveProperty(key);
    expect(JSON.stringify(d.header ?? {})).not.toMatch(new RegExp(`\\b${PLANTED}\\b`));
    expect(JSON.stringify(d.scouted ?? {})).not.toMatch(new RegExp(`\\b${PLANTED}\\b`));
  });

  it('shows the organization\'s scouted tools, now and at their ceiling, exactly as the evidence boundary serves them', async () => {
    const d = await request(`/api/player/${IDS.starter}`);
    const ability = loadScoutedAbilities([IDS.starter]).for(IDS.starter);
    expect(d.scouted).toEqual({ now: ability.current, ceiling: ability.potential, status: ability.status, missing: { now: [...ability.missing.current], ceiling: [...ability.missing.potential] } });
  });

  it('the server reads no players_value figure for the card', () => {
    const source = fs.readFileSync('server/player.ts', 'utf8');
    expect(source).not.toMatch(/valuesByPlayer|mlbPercentiler|oaRating|potRating|overallPct|talentPct/);
    const card = fs.readFileSync('src/playerModal.tsx', 'utf8') + fs.readFileSync('src/playerHover.tsx', 'utf8');
    expect(card).not.toMatch(/overallPct|talentPct|oaRating|potRating|TIP_VALUE|TIP_TALENT/);
  });
});

describe('the header says what the Value section says', () => {
  it('its contract value and value of keeping him are the section\'s own totals', async () => {
    for (const id of [IDS.starter, IDS.extended, IDS.boundary, IDS.optioned]) {
      const d = await request(`/api/player/${id}`);
      const surplus = await request(`/api/player-value/${id}/surplus`);
      expect(d.header.value.status, `${id}`).toBe(surplus.status);
      expect(d.header.value.contract).toEqual(surplus.contract);
      expect(d.header.value.retention).toEqual(surplus.retention);
    }
  });

  it('his contract in a phrase comes from Player Value\'s contract facts: this season\'s salary, how long he is signed, what happens after this season', async () => {
    const d = await request(`/api/player/${IDS.extended}`);
    const value = await request(`/api/player-value/${IDS.extended}`);
    const covered = [...(value.contract.term?.seasons ?? []), ...(value.contract.extension?.seasons ?? [])].map((s: Any) => s.season);
    expect(d.header.contract.signedThrough).toBe(Math.max(...covered));
    expect(d.header.contract.extension).not.toBeNull();
    const now = value.contract.term.seasons.find((s: Any) => s.season === value.control.thisSeason);
    expect(d.header.contract.salaryNow).toBe(now?.salary.value ?? null);
    expect(d.header.contract.after).not.toBeNull();
  });

  it('says the game date the data is from', async () => {
    const d = await request(`/api/player/${IDS.starter}`);
    expect(d.header.freshness.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('the card\'s contract table comes from the contract facts, and a salary the export does not state is unknown, never $0', async () => {
    const d = await request(`/api/player/${IDS.extended}`);
    expect(d.contract.salarySchedule.length).toBeGreaterThan(1);
    for (const s of d.contract.salarySchedule) expect(s.salary === null || s.salary > 0).toBe(true);
  });
});

describe('the header, as the GM reads it', () => {
  const header = (over: Any = {}): Any => ({
    freshness: { state: 'current', asOf: '2026-05-16', lagDays: 0, line: null, detail: 'The export is from May 16, 2026.', limitations: [] },
    contract: {
      standing: 'signed', kind: 'major_league', thisSeason: 2026, salaryNow: 18_700_000, salaryNote: null, signedThrough: 2028,
      extension: null, clauses: ['no-trade'], after: { status: 'signed', label: 'Signed', detail: 'Under contract in 2027.' },
      controlEnd: { low: 2028, high: 2028, pastHorizon: false, reason: null },
    },
    value: {
      status: 'valued', reason: null, unit: 'dollars',
      contract: { status: 'known', from: 2026, to: 2028, low: -9_000_000, central: 28_000_000, high: 100_000_000, centralRange: null, missing: [], reason: null, established: null, ifHeld: false },
      retention: { status: 'known', from: 2026, to: 2028, low: 25_000_000, central: 63_000_000, high: 130_000_000, centralRange: null, missing: [], reason: null, established: null, ifHeld: false },
      wins: { status: 'known', from: 2026, to: 2028, low: 3.4, central: 8.9, high: 13.8, centralRange: null, missing: [], reason: null, established: null, ifHeld: false },
    },
    ...over,
  });
  const scouted = { now: 52, ceiling: 60, status: 'complete', missing: { now: [], ceiling: [] } };

  it('says his contract and his contract value in plain words, the explanations in hovers', async () => {
    const { HeaderValue } = await import('../src/PlayerHeaderValue');
    const html = renderToStaticMarkup(createElement(HeaderValue, { header: header(), scouted }));
    const text = visibleText(html);
    expect(text).toMatch(/\$18\.7M in 2026/);
    expect(text).toMatch(/through 2028/);
    expect(text).toMatch(/Contract value/);
    expect(text).toMatch(/Most likely \$28\.0M/);
    expect(text).toMatch(/52/);
    expect(text).not.toMatch(/percentile|\bTalent\b|\bOA\b|\bPOT\b|\bcentral\b|surplus|retention|indeterminate/i);
    // Each figure explains itself on hover, and a keyboard reaches the explanation
    expect((html.match(/class="tip" tabindex="0"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('a player not valued gets one short line, the reason on hover', async () => {
    const { HeaderValue } = await import('../src/PlayerHeaderValue');
    const unknown = { status: 'unknown', from: 2026, to: 2030, low: null, central: null, high: null, centralRange: null, missing: [2029, 2030], reason: 'His production is only projected through 2028.', established: null, ifHeld: false };
    const html = renderToStaticMarkup(createElement(HeaderValue, { header: header({ value: { status: 'unknown', reason: null, unit: 'dollars', contract: unknown, retention: unknown, wins: unknown } }), scouted }));
    expect(visibleText(html)).toMatch(/Not valued yet/);
    expect(html).toMatch(/His production is only projected through 2028\./);
  });

  it('says when the data may be out of date, or could not be checked', async () => {
    const { HeaderValue } = await import('../src/PlayerHeaderValue');
    const behind = renderToStaticMarkup(createElement(HeaderValue, { header: header({ freshness: { state: 'behind', asOf: '2026-05-13', lagDays: 3, line: 'Data may be out of date: the export is 3 days behind your save', detail: 'x', limitations: [] } }), scouted }));
    expect(visibleText(behind)).toMatch(/out of date/);
    const current = renderToStaticMarkup(createElement(HeaderValue, { header: header(), scouted }));
    expect(visibleText(current)).toMatch(/As of May 16, 2026/);
  });

  it('a missing scouting grade leaves the scouted figure unknown, never a stand-in', async () => {
    const { HeaderValue } = await import('../src/PlayerHeaderValue');
    const html = renderToStaticMarkup(createElement(HeaderValue, { header: header(), scouted: { now: null, ceiling: 60, status: 'partial', missing: { now: ['eye'], ceiling: [] } } }));
    expect(visibleText(html)).toMatch(/not scouted/i);
  });
});
