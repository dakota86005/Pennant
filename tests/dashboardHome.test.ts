import { describe, expect, it } from 'vitest';
import request from './request.js';
import { IDS } from './fixture.js';
import { mlbOverview } from '../server/mlbOperations.js';

/**
 * The home page is a front door, not a second analysis.
 *
 * Its two operations chips count what the workspaces themselves list, taken from the
 * modules that own the answer — so the number on the door and the number behind it
 * cannot disagree, and the dashboard holds no roster logic of its own.
 */
describe('dashboard attention chips', () => {
  it('counts MLB Operations\' open needs exactly as its workspace lists them', async () => {
    const dash = await request(`/api/dashboard/${IDS.mlbTeam}`);
    const overview = mlbOverview(IDS.mlbTeam);
    expect(typeof dash.pending.mlbNeeds).toBe('number');
    expect(dash.pending.mlbNeeds).toBe(overview.needs.length);
  });

  it('still carries the farm\'s attention count and the older desk counts', async () => {
    const { pending } = await request(`/api/dashboard/${IDS.mlbTeam}`);
    for (const key of ['farmAttention', 'expiring', 'extensionCandidates', 'crunchIssues', 'injuredCount', 'tradeTalk']) {
      expect(typeof pending[key], key).toBe('number');
    }
  });
});
