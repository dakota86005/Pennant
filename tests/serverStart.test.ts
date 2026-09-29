import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import { LEAGUE_DB_PATH, leagueUpgradeUnderWay, noteLeagueUpgrade } from '../server/db.js';
import { resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { lookAtTheServedSave, seedServedSaveId, servedSaveId } from '../server/saveDiscovery.js';
import { SERVED_FACTS_PATH, rememberFact, rememberedFact, servedFactKey } from '../server/servedFacts.js';
import {
  afterFirstAnswers, releaseAfterFirstAnswers, releaseStartupWork, resetStartupWork, startupWorkClock, startupWorkReleased,
} from '../server/startupWork.js';
import { clearScaleCache, ratingScaleMax } from '../server/valuation.js';
import request from './request';

/**
 * The server's start (N6 polish: launch to the kept report in a second on a 1.1 GB league). The first answers the Mac
 * app needs (the status, the settings, the clubs) wait on nothing the start does: its looks and upkeep are queued until
 * those three are answered; what the status serves about the league is remembered across starts; the one-time upgrade
 * of an earlier build's league runs behind the answers, and the Front Office is built only on the upgraded file.
 */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

function fakeRequest(path: string): { req: Request; res: Response & EventEmitter } {
  const res = new EventEmitter() as Response & EventEmitter;
  return { req: { method: 'GET', path } as Request, res };
}

describe("the start-up's own work", () => {
  afterEach(() => resetStartupWork());

  it('waits until the status, the settings and the clubs have each been answered, then runs in order, one job a turn', async () => {
    resetStartupWork();
    const ran: string[] = [];
    afterFirstAnswers('first', () => ran.push('first'));
    afterFirstAnswers('second', () => ran.push('second'));
    const next: NextFunction = () => undefined;
    for (const path of ['/status', '/settings']) {
      const { req, res } = fakeRequest(path);
      releaseAfterFirstAnswers(req, res, next);
      res.emit('finish');
    }
    await turn();
    await turn();
    // The clubs not yet answered: nothing has run
    expect(ran).toEqual([]);
    expect(startupWorkReleased()).toBe(false);
    const { req, res } = fakeRequest('/orgs');
    releaseAfterFirstAnswers(req, res, next);
    await turn();
    expect(ran).toEqual([]);
    res.emit('finish');
    expect(startupWorkReleased()).toBe(true);
    // One job a turn, in the order queued, so a request arriving meanwhile is answered between two
    await turn();
    expect(ran).toEqual(['first']);
    await turn();
    expect(ran).toEqual(['first', 'second']);
    // Queued once it has begun: the next turn
    afterFirstAnswers('late', () => ran.push('late'));
    await turn();
    expect(ran).toEqual(['first', 'second', 'late']);
  });

  it('begins by itself for a client that never asks (the Electron app, a script)', async () => {
    resetStartupWork();
    let ran = false;
    afterFirstAnswers('job', () => { ran = true; });
    startupWorkClock(20);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await turn();
    expect(ran).toBe(true);
  });

  it('a job that throws does not stop the rest', async () => {
    resetStartupWork();
    const ran: string[] = [];
    afterFirstAnswers('broken', () => { throw new Error('no'); });
    afterFirstAnswers('after', () => ran.push('after'));
    releaseStartupWork('test');
    await turn();
    await turn();
    await turn();
    expect(ran).toEqual(['after']);
  });
});

describe('what the status serves about the league, remembered across starts', () => {
  afterEach(() => {
    fs.rmSync(SERVED_FACTS_PATH, { force: true });
    clearScaleCache();
    lookAtTheServedSave();
  });

  it('is read back only for the league, import and configuration it was worked out for', () => {
    rememberFact('ratingScaleMax', 20);
    expect(rememberedFact('ratingScaleMax')).toBe(20);
    // Another league file (an import or an upgrade swaps one in): not this league's any more, so worked out again
    const before = fs.statSync(LEAGUE_DB_PATH);
    try {
      const later = new Date(before.mtimeMs + 5_000);
      fs.utimesSync(LEAGUE_DB_PATH, later, later);
      expect(rememberedFact('ratingScaleMax')).toBeUndefined();
    } finally {
      fs.utimesSync(LEAGUE_DB_PATH, before.atimeMs / 1000, before.mtimeMs / 1000);
    }
    expect(rememberedFact('ratingScaleMax')).toBe(20);
    // The save's id also depends on the configuration: its key is not the scale's
    expect(servedFactKey('saveId')).not.toBe(servedFactKey('ratingScaleMax'));
  });

  it('a file that is missing or unreadable is ignored, never a guess', () => {
    fs.rmSync(SERVED_FACTS_PATH, { force: true });
    expect(rememberedFact('saveId')).toBeUndefined();
    fs.writeFileSync(SERVED_FACTS_PATH, 'not json');
    expect(rememberedFact('saveId')).toBeUndefined();
  });

  it('the rating scale is served from what was remembered for this league, without reading the league', () => {
    rememberFact('ratingScaleMax', 5);
    clearScaleCache();
    expect(ratingScaleMax()).toBe(5);
  });

  it("the served save's id is served at once from what was remembered, and worked out again by the look", () => {
    lookAtTheServedSave();
    const real = servedSaveId();
    rememberFact('saveId', 'remembered-id');
    expect(seedServedSaveId()).toBe(true);
    expect(servedSaveId()).toBe('remembered-id');
    // The look after the first answers works it out again (a remembered id is never taken for good)
    lookAtTheServedSave();
    expect(servedSaveId()).toBe(real);
    fs.rmSync(SERVED_FACTS_PATH, { force: true });
    expect(seedServedSaveId()).toBe(false);
  });
});

describe("an earlier build's league being upgraded", () => {
  afterEach(() => noteLeagueUpgrade(null));

  it('holds the Front Office build until the upgraded file is served (built on the old one, it takes minutes)', async () => {
    resetFrontOfficeCache();
    let finish!: () => void;
    const upgrade = new Promise<void>((resolve) => { finish = resolve; });
    noteLeagueUpgrade(upgrade);
    expect(leagueUpgradeUnderWay()).toBe(upgrade);
    let answered = false;
    const asked = request('/api/v2/front-office/automatic').then((summary) => { answered = true; return summary; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(answered).toBe(false);
    noteLeagueUpgrade(null);
    finish();
    const summary = await asked;
    expect(answered).toBe(true);
    expect(summary).toHaveProperty('orgId');
  }, 60_000);
});
