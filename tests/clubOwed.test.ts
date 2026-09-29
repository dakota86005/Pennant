import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { api } from '../server/api.js';
import { clearClubOwed, clubOwed, importLandedForClubQuestion, oweClubWhenImported, owedText } from '../server/clubOwed.js';
import { DATA_DIR } from '../server/config.js';
import { FrontOfficeRefusal, resolveOrg } from '../server/frontOfficeService.js';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * The club owed across a relaunch (BEHAVIOR_CASES.md "Pennant for Mac", `clubOwed.test.ts`; N6 Stage B2's open item):
 * a save chosen whose club isn't settled owes the question from its import on, until the GM chooses, whatever relaunches.
 */

describe('the club owed across a relaunch', () => {
  let save: BuiltSave;

  beforeAll(() => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11 });
  });
  afterEach(() => clearClubOwed());

  it('is owed only once the save\'s import lands, and is written where a relaunch reads it', () => {
    oweClubWhenImported({ csvDir: '/saves/Two Clubs.lg/import_export/csv', humanClubs: 2 });
    expect(clubOwed()).toBeNull();
    // Another save's import landing owes nothing
    expect(importLandedForClubQuestion('/saves/Other.lg/import_export/csv')).toBe(false);
    oweClubWhenImported({ csvDir: '/saves/Two Clubs.lg/import_export/csv', humanClubs: 2 });
    expect(importLandedForClubQuestion('/saves/Two Clubs.lg/import_export/csv')).toBe(true);
    expect(clubOwed()).toMatchObject({ humanClubs: 2, text: 'You manage 2 clubs in this save. Choose the one to follow.' });
    expect(fs.existsSync(path.join(DATA_DIR, 'club-owed.json'))).toBe(true);
    // The same save imported again keeps the question open; another save's import settles it
    expect(importLandedForClubQuestion('/saves/Two Clubs.lg/import_export/csv')).toBe(true);
    expect(importLandedForClubQuestion('/saves/Other.lg/import_export/csv')).toBe(false);
    expect(clubOwed()).toBeNull();
  });

  it('serves the automatic club\'s report as if chosen only once the GM chooses', async () => {
    oweClubWhenImported({ csvDir: '/saves/None.lg/import_export/csv', humanClubs: 0 });
    importLandedForClubQuestion('/saves/None.lg/import_export/csv');
    expect(() => resolveOrg('automatic')).toThrow(FrontOfficeRefusal);
    expect(() => resolveOrg('automatic')).toThrow(owedText(0));
    // A club named by its id is still served
    expect(resolveOrg(String(save.org))).toBe(save.org);

    const app = express();
    app.use(express.json());
    app.use('/api', api);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await (await fetch(`${base}/api/status`)).json()).clubOwed).toMatchObject({ humanClubs: 0 });
      expect((await (await fetch(`${base}/api/settings`)).json()).clubOwed).toMatchObject({ humanClubs: 0 });
      const refused = await fetch(`${base}/api/v2/front-office/automatic`);
      expect(refused.status).toBe(404);
      expect((await refused.json()).error).toBe(owedText(0));
      // The GM chooses Automatic: the question is answered, across a relaunch too
      await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clubChoice: 'automatic' }) });
      expect(clubOwed()).toBeNull();
      expect((await (await fetch(`${base}/api/status`)).json()).clubOwed).toBeNull();
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
