import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { briefingContext, briefingSystem } from '../server/ai.js';
import { runTool, systemPrompt } from '../server/chat.js';
import { playerSurplus } from '../server/playerValue.js';
import { personasFor } from '../server/staff.js';
import request from './request';
import { IDS } from './fixture';

/*
 * Player Value phase 6c: the AI's value context (BEHAVIOR_CASES.md "Player Value", phase 6c row; D-001, D-052). The
 * briefing's and the staff chat's context carry Player Value's figures (the same totals the card and Contracts show, a
 * free agent's market figure), never a `players_value` figure or a percentile, and the prompts no longer explain one.
 * The assistants explain: they quote the ranges, produce no value number of their own and give no verdict.
 */

const SLOW = 60_000;
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Field names that carry OOTP's value or a percentile of it. */
const BANNED_FIELDS = ['overallPct', 'talentPct', 'valuePct', 'oaRating', 'potRating', 'overall_value', 'talent_value', 'bestValue', 'lastSalary'];

beforeAll(async () => {
  // The tools call back into the app over HTTP: start the server they reach
  await request('/api/status');
}, SLOW);

describe('the AI\'s value context carries Player Value\'s figures and no players_value figure', () => {
  it('no prompt explains a percentile of OOTP\'s value any more: the note is gone from the server', () => {
    const server = path.join(process.cwd(), 'server');
    for (const file of fs.readdirSync(server).filter((f) => f.endsWith('.ts'))) {
      expect(fs.readFileSync(path.join(server, file), 'utf8'), file).not.toMatch(/VALUE_PERCENTILE_NOTE/);
    }
  });

  it('the briefing\'s context carries each contract\'s Player Value figures, the same totals the card shows, and how current the data is', () => {
    const ctx = briefingContext(IDS.mlbTeam) as Any;
    const text = JSON.stringify(ctx);
    for (const banned of BANNED_FIELDS) expect(text, banned).not.toContain(`"${banned}"`);
    expect(ctx.contractSituations.length).toBeGreaterThan(0);
    for (const row of ctx.contractSituations) {
      const s = playerSurplus(row.player_id);
      if (s) expect(row.value.contract).toEqual(JSON.parse(JSON.stringify(s.contract)));
    }
    expect(ctx.dataFreshness).toBeDefined();
    expect(ctx.dataFreshness).toHaveProperty('asOf');
  }, SLOW);

  it('the briefing is told to quote Pennant\'s figures as ranges, never to make up a value, and gives no percentile note', () => {
    const system = briefingSystem('Club 1', 'Free agency requires 6 years of major-league service.');
    expect(system).not.toMatch(/overallPct|talentPct|percentile/i);
    expect(system).toMatch(/never (?:produce|give|state|make up) a (?:value|valuation) (?:number|figure) of your own/i);
  });

  it('the staff chat is told the same, in every voice', () => {
    for (const persona of personasFor(IDS.mlbTeam)) {
      const system = systemPrompt(IDS.mlbTeam, persona);
      expect(system, persona.id).not.toMatch(/overallPct|talentPct|percentile/i);
      expect(system, persona.id).toMatch(/never (?:produce|give|state|make up) a (?:value|valuation) (?:number|figure) of your own/i);
    }
  });

  it('the free agents tool hands the AI Player Value\'s figures, in a stated order, and no percentile', async () => {
    const out = await runTool('get_free_agents', { team_id: IDS.mlbTeam });
    expect(out).not.toMatch(/^\[TRUNCATED/);
    const data = JSON.parse(out);
    for (const banned of BANNED_FIELDS) expect(out, banned).not.toContain(`"${banned}"`);
    expect(data.order).toMatch(/expected wins/i);
    expect(data).toHaveProperty('needs');
    for (const row of [...data.currentFAs, ...data.upcomingFAs]) {
      expect(row).toHaveProperty('winsNext');
      expect(row).toHaveProperty('market');
      expect(row).toHaveProperty('scouted');
    }
  }, SLOW);

  it('the chat\'s free agents tool describes the figures it carries, and names no percentile', async () => {
    const { TOOLS } = await import('../server/chat.js');
    const tool = TOOLS.find((t) => t.name === 'get_free_agents')!;
    expect(tool.description).toMatch(/expected wins/i);
    expect(tool.description).toMatch(/market/i);
    expect(tool.description).not.toMatch(/percentile/i);
  });
});
