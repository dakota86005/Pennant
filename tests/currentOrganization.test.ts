import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DATA_DIR } from '../server/config.js';
import { db } from '../server/db.js';
import { settingsRoutes } from '../server/settings.js';
import { currentOrganization, viewingOrganization } from '../server/viewingOrganization.js';
import { IDS } from './fixture';

/**
 * The current club, served to the Mac app on `GET /api/settings` so no client re-implements the rule: the configured
 * organization, else the one the save's human manages (AGENTS.md). One resolver for every view (`viewingOrganization`).
 */
const settingsFile = path.join(DATA_DIR, 'settings.json');
let saved: string | null = null;

beforeEach(() => {
  saved = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : null;
});
afterEach(() => {
  if (saved === null) fs.rmSync(settingsFile, { force: true });
  else fs.writeFileSync(settingsFile, saved);
});

const configure = (defaultOrgId: number | null): void => {
  const current = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
  fs.writeFileSync(settingsFile, JSON.stringify({ ...current, defaultOrgId }));
};

describe('the current organization', () => {
  it('is the human-managed club when none is configured', () => {
    configure(null);
    expect(currentOrganization()).toMatchObject({ id: IDS.mlbTeam, source: 'human' });
  });

  it('is the configured club when one is', () => {
    configure(IDS.otherMlbTeam);
    expect(currentOrganization()).toMatchObject({ id: IDS.otherMlbTeam, source: 'configured' });
  });

  it('keeps a configured club the league no longer has, as every view does, rather than switching clubs', () => {
    configure(9999);
    expect(currentOrganization()).toMatchObject({ id: 9999, source: 'configured' });
    expect(viewingOrganization(undefined)).toEqual({ id: 9999, source: 'configured' });
  });

  it('is never a requested club: nothing names one here', () => {
    configure(null);
    expect(currentOrganization()?.source).not.toBe('requested');
  });
});

describe('going back to automatic (the clearing rule, SWIFTUI_REBUILD.md section 12)', () => {
  const post = async (body: unknown) => {
    const app = express();
    app.use(express.json());
    app.use('/api', settingsRoutes);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/settings`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      return (await res.json()) as { settings: { defaultOrgId: number | null } };
    } finally {
      server.close();
    }
  };

  it('forgets the chosen club with an explicit field, so the app follows the club the save\'s human manages', async () => {
    configure(IDS.otherMlbTeam);
    expect((await post({ clubChoice: 'automatic' })).settings.defaultOrgId).toBeNull();
    expect(currentOrganization()).toMatchObject({ id: IDS.mlbTeam, source: 'human' });
  });

  it('lets the explicit field win over a club sent beside it, and leaves the club alone when it is absent', async () => {
    configure(IDS.otherMlbTeam);
    expect((await post({ clubChoice: 'automatic', defaultOrgId: IDS.otherMlbTeam })).settings.defaultOrgId).toBeNull();
    configure(IDS.otherMlbTeam);
    expect((await post({ theme: 'dark' })).settings.defaultOrgId).toBe(IDS.otherMlbTeam);
  });
});

describe('several clubs managed by the save\'s human (review S1)', () => {
  it('follows the first by team id every time, and says which in a sentence', () => {
    configure(null);
    const before = db.prepare('SELECT team_id, human_team FROM teams').all() as Array<{ team_id: number; human_team: number }>;
    try {
      // Two human clubs, the higher id written first so row order would pick it
      db.prepare('UPDATE teams SET human_team = 0').run();
      db.prepare('UPDATE teams SET human_team = 1 WHERE team_id IN (?, ?)').run(IDS.mlbTeam, IDS.otherMlbTeam);
      const first = Math.min(IDS.mlbTeam, IDS.otherMlbTeam);
      const org = currentOrganization()!;
      expect(org).toMatchObject({ id: first, source: 'human', humanClubs: 2 });
      expect(org.note).toMatch(/You manage 2 clubs in this save\. Pennant follows .+; choose another in Settings\./);
      // One human club: no note
      db.prepare('UPDATE teams SET human_team = 0 WHERE team_id = ?').run(Math.max(IDS.mlbTeam, IDS.otherMlbTeam));
      expect(currentOrganization()).toMatchObject({ id: first, humanClubs: 1, note: null });
    } finally {
      const put = db.prepare('UPDATE teams SET human_team = ? WHERE team_id = ?');
      for (const r of before) put.run(r.human_team, r.team_id);
    }
  });
});
