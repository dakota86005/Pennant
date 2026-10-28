import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { briefingContext, briefingSystem, tradeSystem } from '../server/ai.js';
import { TOOLS, runTool } from '../server/chat.js';
import { tradeVoice } from '../server/staff.js';
import { assembleContext, storylinesSystem } from '../server/storylines.js';
import { tradeContext } from '../server/trade.js';
import request from './request.js';
import { IDS } from './fixture.js';

/*
 * D-060, amended 2026-10-28 (B-62, SRVAI-02): no AI surface is handed the postseason odds, the deadline posture or a
 * playoff chance. Not the Staff room's or the Mac AI desk's tools (`TOOLS`), not the trade desk's context, not the
 * briefing's or the storylines'. The odds are Standings' alone. BEHAVIOR_CASES.md "The AI never quotes odds".
 */

/** Keys an AI payload never carries, at any depth. */
const BANNED_KEYS = new Set(['deadline', 'odds', 'playoffs', 'posture']);
/** Words of the odds and the buy/hold/sell read, in a tool's description or a writer's prompt. */
const ODDS_WORDS = /postseason odds|playoff odds|\bodds\b|\bposture\b|buy\/hold|buy or sell|chance of (?:reaching|making) the (?:postseason|playoffs)/i;

function bannedKeysIn(value: unknown, at = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => bannedKeysIn(v, `${at}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
    ...(BANNED_KEYS.has(k) ? [`${at}.${k}`] : []),
    ...bannedKeysIn(v, `${at}.${k}`),
  ]);
}

const argsFor = (name: string): Record<string, unknown> => {
  if (name === 'search_players') return { q: 'Fill', limit: 5 };
  if (name === 'get_player') return { player_id: IDS.starter };
  return { team_id: IDS.mlbTeam };
};

beforeAll(async () => {
  // The tools answer by calling the app's own API, so it has to be listening
  await request('/api/status');
}, 30_000);

describe('the AI tools offer no odds and no posture (D-060)', () => {
  it('offers no dashboard tool, and no tool says odds, posture or buy/sell', () => {
    expect(TOOLS.map((t) => t.name)).not.toContain('get_dashboard');
    for (const t of TOOLS) expect(String(t.description), t.name).not.toMatch(ODDS_WORDS);
  });

  it('no tool payload carries a deadline read, odds, playoffs or posture key, at any depth', async () => {
    const found: string[] = [];
    for (const t of TOOLS) {
      let out: string;
      try { out = await runTool(t.name, argsFor(t.name)); } catch { continue; } // no data for this fixture: nothing handed over
      let parsed: unknown;
      try { parsed = JSON.parse(out); } catch { expect(out, `${t.name} returned text`).not.toMatch(ODDS_WORDS); continue; }
      found.push(...bannedKeysIn(parsed, t.name));
    }
    expect(found).toEqual([]);
  }, 60_000);
});

describe('the writers\' and the trade desk\'s context carry no odds and no posture (D-060)', () => {
  it('the briefing, the storylines and the trade desk are handed no such key', () => {
    expect(bannedKeysIn(briefingContext(IDS.mlbTeam), 'briefing')).toEqual([]);
    expect(bannedKeysIn(assembleContext(IDS.mlbTeam), 'storylines')).toEqual([]);
    const desk = tradeContext(IDS.mlbTeam, [IDS.starter], [IDS.tradedAway]);
    expect(bannedKeysIn(desk, 'trade')).toEqual([]);
    expect(JSON.stringify(desk)).not.toMatch(/clubValueOfAWin/);
  });

  it('no writer\'s or desk\'s prompt asks about the odds or the buy/hold/sell read', () => {
    for (const system of [briefingSystem('the Club', 'MLB rules.'), storylinesSystem('the Club', 'MLB rules.'), tradeSystem(tradeVoice(IDS.mlbTeam), 'the Club', IDS.league)]) {
      expect(system).not.toMatch(ODDS_WORDS);
      expect(system).not.toMatch(/clubValueOfAWin/);
    }
  });
});

describe('no AI module, nor what assembles its payloads, reads the odds model (D-060)', () => {
  /*
   * A chain of imports is not the test here: every module reaches the whole app through the route registry. The payloads
   * above are the boundary; this holds the modules that build them off the odds model by name.
   */
  const ASSEMBLERS = ['chat.ts', 'ai.ts', 'storylines.ts', 'aiGuardrails.ts', 'aiSurfacesService.ts', 'trade.ts', 'tradeDeskService.ts', 'dashboard.ts', 'playerValue.ts'];
  it.each(ASSEMBLERS)('%s imports no posture and names no odds read', (file) => {
    const source = fs.readFileSync(path.join(process.cwd(), 'server', file), 'utf8');
    expect(source).not.toMatch(/from '\.\/posture\.js'|deadlineRead|oddsModelOf|oddsAt\(|shownOdds/);
  });
});
