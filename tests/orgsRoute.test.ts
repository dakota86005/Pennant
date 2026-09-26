import { describe, expect, it } from 'vitest';
import { tableColumns } from '../server/db.js';
import { buildSave, dropColumn, exec, type SaveSpec } from './syntheticSave';
import request from './request';

/*
 * GET /api/orgs on an export whose `teams` table does not carry the team colours. OOTP exports vary by
 * version and save, so the route reads the colour columns it finds and serves null for the rest: an
 * unknown colour, never a stand-in. The payload shape is the same either way. Built on a synthetic save;
 * the colour columns are removed (or added) explicitly, since the builder's teams table may carry them.
 */

const spec: SaveSpec = { season: 2040, historySeasons: 0, gamesPerTeam: 162, playedShare: 0.2, clubs: 3, seed: 11 };
const COLOR_COLUMNS = ['background_color_id', 'text_color_id', 'jersey_secondary_color_id', 'ballcaps_main_color_id'];

function buildWithoutColors(): void {
  buildSave(spec);
  for (const column of COLOR_COLUMNS) dropColumn('teams', column);
}

describe('GET /api/orgs tolerates an export without team colours', () => {
  it('serves every club with null colours when the teams table has none of the colour columns', async () => {
    buildWithoutColors();
    expect(tableColumns('teams').filter((c) => COLOR_COLUMNS.includes(c))).toEqual([]);

    const orgs = await request('/api/orgs');
    expect(orgs).toHaveLength(3);
    for (const org of orgs) {
      expect(Object.keys(org).sort()).toEqual(['colors', 'isHuman', 'label', 'team_id']);
      expect(org.colors).toEqual({ bg: null, fg: null, secondary: null, cap: null });
    }
    expect(orgs.filter((o: { isHuman: boolean }) => o.isHuman)).toHaveLength(1);
  });

  it('serves the colours the export carries and null for the one it lacks', async () => {
    buildWithoutColors();
    exec(`ALTER TABLE teams ADD COLUMN background_color_id TEXT`);
    exec(`ALTER TABLE teams ADD COLUMN text_color_id TEXT`);
    exec(`ALTER TABLE teams ADD COLUMN ballcaps_main_color_id TEXT`);
    exec(`UPDATE teams SET background_color_id = '#112233', text_color_id = '#ffffff', ballcaps_main_color_id = '#445566'`);

    const orgs = await request('/api/orgs');
    expect(orgs).toHaveLength(3);
    for (const org of orgs) {
      expect(org.colors).toEqual({ bg: '#112233', fg: '#ffffff', secondary: null, cap: '#445566' });
    }
  });
});
