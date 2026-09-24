import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { scoutedGloves } from '../server/scoutedEvidence.js';
import { clearValuationCaches } from '../server/valuation.js';
import { LineupView } from '../src/pages/Lineup';
import type { LineupResponse } from '../src/api';
import request from './request';
import { IDS } from './fixture';
import { visibleText } from './visibleText';

/*
 * Player Value phase 6d: the lineup reads every rating through the scouted-evidence adapter (BEHAVIOR_CASES.md "Player
 * Value", phase 6d row; PLAYER_VALUE.md Part 8, consumer 6: "a lineup's quality of cover moves to scoutedEvidence.ts under
 * its owner, not to Player Value"). It used OOTP's own offensive value (`players_value.offensive_value_vsr / _vsl`) as the
 * bat and read the rating columns itself. The bat is now what the scouts' hitting tools against that hand say (the
 * calibrated tools model, D-035's split grades), the glove the scouts' revealed grade; the solver is unchanged. Changing
 * OOTP's figures changes nothing; a bat with no split grades is read on his overall grades and says so; a hitter with no
 * graded bat is named and never ranked as though his bat were average or zero.
 */

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const SPLITS = ['contact', 'gap', 'power', 'eye', 'strikeouts'];
const card = (vs: 'r' | 'l', style = 'saber', sort = 'talent'): Promise<LineupResponse & Any> =>
  request(`/api/lineup/${IDS.mlbTeam}?vs=${vs}&style=${style}&sort=${sort}&dh=auto`);

/** The fixture's eight fielders: 20 (C) to 27 (DH). */
const FIELDERS = [20, 21, 22, 23, 24, 25, 26, 27];
/** Crushes right-handers, helpless against left-handers. */
const PLATOON_R = 27;
/** The mirror image. */
const PLATOON_L = 20;

function setSplits(id: number, vsl: number, vsr: number): void {
  const sets = SPLITS.flatMap((t) => [`batting_ratings_vsl_${t} = ${vsl}`, `batting_ratings_vsr_${t} = ${vsr}`]).join(', ');
  db.prepare(`UPDATE players_batting SET ${sets} WHERE player_id = ?`).run(id);
}

function plantOffense(seed: number): void {
  // OOTP's valuation says the opposite of the scouts: the two platoon bats are the worst, everyone else the best
  db.prepare(`UPDATE players_value SET offensive_value = ?, offensive_value_vsl = ?, offensive_value_vsr = ?`).run(5000 + seed, 5000 + seed, 5000 + seed);
  db.prepare(`UPDATE players_value SET offensive_value = 1, offensive_value_vsl = 1, offensive_value_vsr = 1 WHERE player_id IN (?, ?)`).run(PLATOON_R, PLATOON_L);
  // An import clears the valuation caches; so does this, so a reader of OOTP's figures would see the new ones
  clearValuationCaches();
}

beforeAll(() => {
  const have = new Set((db.prepare(`PRAGMA table_info(players_batting)`).all() as Array<{ name: string }>).map((c) => c.name));
  for (const side of ['vsl', 'vsr']) {
    for (const t of SPLITS) {
      const c = `batting_ratings_${side}_${t}`;
      if (!have.has(c)) db.exec(`ALTER TABLE players_batting ADD COLUMN ${c} INTEGER`);
    }
  }
  for (const id of FIELDERS) setSplits(id, 50, 50);
  setSplits(PLATOON_R, 25, 75);
  setSplits(PLATOON_L, 75, 25);
  // The regular has overall grades and no split grades at all; the boundary player has none of either
  db.prepare(`UPDATE players_batting SET batting_ratings_overall_contact = 0, batting_ratings_overall_gap = 0, batting_ratings_overall_power = 0,
    batting_ratings_overall_eye = 0, batting_ratings_overall_strikeouts = 0 WHERE player_id = ?`).run(IDS.boundary);
  plantOffense(0);
});

describe('the lineup reads ratings only through the scouted-evidence adapter (phase 6d)', () => {
  it('builds the talent order from the scouts\' view of each bat against that hand, never from OOTP\'s offensive value', async () => {
    const vsR = await card('r');
    const vsL = await card('l');
    // The Book: the best bat hits second
    expect(vsR.lineup.find((l: Any) => l.slot === 2).player_id).toBe(PLATOON_R);
    expect(vsL.lineup.find((l: Any) => l.slot === 2).player_id).toBe(PLATOON_L);
    // ...and each is the weakest bat against the other hand
    const weakest = (c: Any) => [...c.lineup].filter((l: Any) => l.off !== null).sort((a: Any, b: Any) => a.off - b.off)[0].player_id;
    expect(weakest(vsR)).toBe(PLATOON_L);
    expect(weakest(vsL)).toBe(PLATOON_R);
  });

  it('does not move when OOTP\'s offensive value does', async () => {
    for (const vs of ['r', 'l'] as const) {
      for (const style of ['saber', 'trad']) {
        plantOffense(1);
        const first = await card(vs, style);
        plantOffense(2);
        db.prepare(`UPDATE players_value SET offensive_value_vsr = 9999, offensive_value_vsl = 9999 WHERE player_id = ?`).run(21);
        clearValuationCaches();
        const second = await card(vs, style);
        expect(second, `${vs} ${style}`).toEqual(first);
        plantOffense(0);
      }
    }
  });

  it('carries no players_value figure, and says each bat is read against that hand in points above the league', async () => {
    const c = await card('r');
    expect(JSON.stringify(c)).not.toMatch(/offensive_value|overall_value|talent_value|oaRating|potRating/);
    for (const l of c.lineup.filter((x: Any) => x.positionName !== 'P')) {
      expect(typeof l.off === 'number' || l.off === null, l.name).toBe(true);
      expect(l.batBasis, l.name).toMatch(/^(vs_hand|overall)$/);
    }
    const r = c.lineup.find((l: Any) => l.player_id === PLATOON_R);
    const avg = c.lineup.find((l: Any) => l.player_id === 21);
    expect(r.batBasis).toBe('vs_hand');
    expect(r.off).toBeGreaterThan(avg.off);
  });

  it('reads a bat with no split grades on his overall grades, and says so', async () => {
    const c = await card('r');
    const all = [...c.lineup, ...c.bench];
    const regular = all.find((l: Any) => l.player_id === IDS.starter);
    expect(regular, 'the regular is on the card or the bench').toBeDefined();
    expect(regular.batBasis).toBe('overall');
  });

  it('names a hitter with no graded bat and never ranks him as though his bat were average or zero', async () => {
    const c = await card('r');
    const ids = [...c.lineup, ...c.bench].map((l: Any) => l.player_id);
    expect(ids).not.toContain(IDS.boundary);
    const named = c.notScouted.find((n: Any) => n.player_id === IDS.boundary);
    expect(named).toBeDefined();
    expect(named.reason).toMatch(/grad|scout/i);
  });

  it('plays each fielder on the scouts\' revealed grade at his position', async () => {
    const c = await card('r');
    for (const l of c.lineup.filter((x: Any) => x.positionName !== 'P' && x.positionName !== 'DH')) {
      const glove = scoutedGloves(l.player_id)?.positions.find((p) => p.code === l.positionName);
      expect(l.defRating, `${l.name} at ${l.positionName}`).toBe(glove?.current ?? null);
    }
  });

  it('keeps the production order and the traditional order working on the scouted reading', async () => {
    for (const [style, sort] of [['trad', 'talent'], ['saber', 'production'], ['trad', 'production']]) {
      const c = await card('r', style, sort);
      const ids = c.lineup.map((l: Any) => l.player_id);
      expect(new Set(ids).size, `${style} ${sort}`).toBe(ids.length);
      expect(ids.length, `${style} ${sort}`).toBe(9);
    }
  });
});

describe('the Lineup page talks like a front office (phase 6d)', () => {
  it('names the bat plainly, with no players_value or OOTP-value words on the page', async () => {
    const data = await card('r');
    const text = visibleText(renderToStaticMarkup(createElement(LineupView, { data, vs: 'r', style: 'saber', sort: 'talent' })));
    expect(text).toMatch(/Bat vs RHP/);
    expect(text).not.toMatch(/players_value|offensive value|Off Value|OOTP's own/i);
    // A hitter the scouts have not graded is named, in one short line
    expect(text).toMatch(/Not scouted:/);
  });
});
