import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetFrontOfficeCache } from '../server/frontOfficeService.js';
import {
  NOT_A_CHANGE, NOT_OFFERED, OFF_THE_SCALE, PhilosophyRefusal, UNKNOWN_SETTING, coachingStaffNow, philosophyNow, resetPhilosophyNow,
  resetPhilosophyViews, setPhilosophyNow,
} from '../server/philosophyViewService.js';
import { DEFAULT_PHILOSOPHY_VALUES, PHILOSOPHY_DIMENSIONS } from '../server/philosophy.js';
import { comparablesOf, identityOf, positionWords } from '../server/presentation/philosophy/identity.js';
import { computeStaff } from '../server/rosterops.js';
import { philosophyForOrg, savePhilosophyForOrg } from '../server/settings.js';
import { bannedInPayload } from './bannedJargon';
import request from './request';
import { buildSave, type BuiltSave } from './syntheticSave';

/*
 * Philosophy & Staff on the Mac (N12 Track C, D-073; BEHAVIOR_CASES.md "Pennant for Mac", the `philosophyViews.test.ts`
 * rows): the editor orders, never permits; the identity is the server's, from the settings alone; a change is checked whole
 * and undone through what it answers; Coaching Staff is the export's staff.
 */

let save: BuiltSave;

beforeAll(() => {
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true, minors: true, lineups: true });
  resetFrontOfficeCache();
  resetPhilosophyViews();
  savePhilosophyForOrg(save.org, null);
}, 120_000);

afterAll(() => savePhilosophyForOrg(save.org, null));

function visible(value: unknown, at = '$'): Array<{ at: string; text: string }> {
  if (Array.isArray(value)) return value.flatMap((x, i) => visible(x, `${at}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, x]) =>
    typeof x === 'string' && ['display', 'text', 'hint'].includes(k) ? [{ at: `${at}.${k}`, text: x }] : visible(x, `${at}.${k}`));
}

/** Words that would say a setting decides whether a move is allowed (D-003, D-019, D-045), or that read the season (D-060). */
const PERMITS = [/\b(?:allow|permit|forbid|eligib|block)s?\b(?! or rule)/i, /\bdefensib/i];
const SEASON = [/postseason/i, /playoff/i, /\bodds\b/i, /\bposture\b/i, /\brecord\b/i];

describe('the philosophy editor orders, never permits (N12)', () => {
  it('says what the settings do and never do, plain, with every preference and policy as the settings hold them', () => {
    const view = philosophyNow(String(save.org));
    expect(view.lede.text).toMatch(/order the choices your staff already finds sound; they never make a move allowed or rule one out/);
    expect(view.lede.basis.because.map((b) => b.label)).toEqual(['What they do', 'What they never do']);
    const ids = view.groups.flatMap((g) => g.dimensions.map((d) => d.id)).sort();
    expect(ids).toEqual(PHILOSOPHY_DIMENSIONS.map((d) => d.id).sort());
    expect(view.groups.flatMap((g) => g.dimensions).every((d) => d.value === 50 && d.position.display === 'Balanced')).toBe(true);
    expect(view.policies.items.map((p) => p.id).sort()).toEqual(['agingContracts', 'arbitrationExtensions', 'rentalAcquisitions', 'salaryDumps']);
    expect(bannedInPayload(view, 'getOrganizationalPhilosophy')).toEqual([]);
    // Outside the lede's own sentence, no word says a setting allows or forbids anything
    const rest = visible({ ...view, lede: null });
    expect(rest.filter((v) => PERMITS.some((p) => p.test(v.text)))).toEqual([]);
    expect(visible(view).filter((v) => SEASON.some((p) => p.test(v.text)))).toEqual([]);
  });

  it('reads the identity from the settings alone, the way the React page did', () => {
    expect(identityOf({ ...DEFAULT_PHILOSOPHY_VALUES })).toMatchObject({ headline: 'Balanced operation', tags: ['Balanced'] });
    const tb = identityOf({ ...DEFAULT_PHILOSOPHY_VALUES, competitiveWindow: 85, teamControl: 85, prospectPreservation: 85 });
    expect(tb.headline).toBe('Sustainable contender');
    expect(tb.summary).toMatch(/^This organization tries to win now while protecting/);
    expect(positionWords('competitiveWindow', 10)).toBe('Strongly — Build for the future');
    expect(positionWords('competitiveWindow', 60)).toBe('Leans — Maximize current wins');
    const near = comparablesOf({ ...DEFAULT_PHILOSOPHY_VALUES, competitiveWindow: 82, payrollFlexibility: 95, costEfficiency: 100, teamControl: 92, prospectPreservation: 78, starConcentration: 30 });
    expect(near[0].name).toBe('2002 Oakland Athletics');
    expect(near).toHaveLength(3);
  });

  it('writes a change, says what it did, and undoes it through the request it answers', () => {
    const changed = setPhilosophyNow(String(save.org), { dimensions: [{ id: 'competitiveWindow', value: 70 }] });
    expect(changed.said.display).toBe('Competitive window set to 70: Maximize current wins.');
    expect(changed.undoName.display).toBe('Change Competitive Window');
    expect(philosophyForOrg(save.org).manual.competitiveWindow).toBe(70);
    expect(changed.view.groups[0].dimensions[0]).toMatchObject({ id: 'competitiveWindow', value: 70 });
    expect(changed.undo).toEqual({ dimensions: [{ id: 'competitiveWindow', value: 50 }], policies: [] });
    const undone = setPhilosophyNow(String(save.org), changed.undo);
    expect(undone.said.display).toBe('Competitive window set to 50: Balanced.');
    expect(philosophyForOrg(save.org).manual.competitiveWindow).toBe(50);
    const policy = setPhilosophyNow(String(save.org), { policies: [{ id: 'rentalAcquisitions', value: 'never' }] });
    expect(policy.said.display).toBe('Rental acquisitions: Never.');
    const reset = resetPhilosophyNow(String(save.org));
    expect(reset.said.display).toBe('Every setting is back to neutral.');
    expect(philosophyForOrg(save.org).policies.rentalAcquisitions).toBe('contending');
    // The reset's undo puts every setting back as it was
    setPhilosophyNow(String(save.org), reset.undo);
    expect(philosophyForOrg(save.org).policies.rentalAcquisitions).toBe('never');
    resetPhilosophyNow(String(save.org));
  });

  it('refuses a change it cannot make, in words, and writes nothing (never clamped or dropped silently)', () => {
    const before = JSON.stringify(philosophyForOrg(save.org));
    for (const [body, words] of [
      [{ dimensions: [{ id: 'competitiveWindow', value: 101 }] }, OFF_THE_SCALE],
      [{ dimensions: [{ id: 'competitiveWindow', value: 55.5 }] }, OFF_THE_SCALE],
      [{ dimensions: [{ id: 'competitiveWindow', value: 60 }, { id: 'clubhouseVibes', value: 60 }] }, UNKNOWN_SETTING],
      [{ policies: [{ id: 'salaryDumps', value: 'always' }] }, NOT_OFFERED],
      [{}, NOT_A_CHANGE],
      ['competitiveWindow=70', NOT_A_CHANGE],
    ] as const) {
      expect(() => setPhilosophyNow(String(save.org), body), JSON.stringify(body)).toThrow(PhilosophyRefusal);
      expect(() => setPhilosophyNow(String(save.org), body)).toThrow(words);
    }
    expect(JSON.stringify(philosophyForOrg(save.org))).toBe(before);
  });

  it('keeps the React page\'s routes answering as before, through the same settings', async () => {
    setPhilosophyNow(String(save.org), { dimensions: [{ id: 'riskTolerance', value: 30 }] });
    const old = await request(`/api/settings/philosophy/${save.org}`);
    expect(old.profile.manual.riskTolerance).toBe(30);
    expect(old.dimensions.map((d: { id: string }) => d.id)).toEqual(PHILOSOPHY_DIMENSIONS.map((d) => d.id));
    resetPhilosophyNow(String(save.org));
  });
});

describe('Coaching Staff is the save\'s staff as exported (N12)', () => {
  it('lists the major-league staff, the farm coaches ready for a seat, and the farm staff as computeStaff reads them', () => {
    const reading = computeStaff(save.org);
    expect(reading.status).toBe('read');
    if (reading.status !== 'read') return;
    const view = coachingStaffNow(String(save.org));
    expect(view.sections.map((s) => s.id)).toEqual(['major', 'ready', 'farm']);
    expect(view.sections[0].table.rows.map((r) => r.id)).toEqual(reading.staff.map((s) => `major-${s.coach_id}`));
    expect(view.sections[2].table.rows.length).toBe(reading.farmStaff.reduce((n, c) => n + c.coaches.length, 0));
    expect(bannedInPayload(view, 'getCoachingStaff')).toEqual([]);
  });

  it('says a rating the export doesn\'t carry is not known, never zero, and never reads it as nobody out-rating a coach', () => {
    const view = coachingStaffNow(String(save.org));
    const reading = computeStaff(save.org);
    if (reading.status !== 'read') throw new Error('no staff');
    if (reading.seatsUnread.length > 0) {
      expect(view.sections[1].table.empty?.display).toMatch(/^Not known: the export doesn't rate coaches for /);
      expect(view.sections[1].table.empty?.tone).toBe('unknown');
    }
    for (const r of view.sections[2].table.rows) {
      for (const key of ['teachHitting', 'teachPitching', 'handleRookies']) {
        const shown = r.cells[key];
        if (r.sort[key] === null) expect(shown).toMatchObject({ display: 'Not known', tone: 'unknown' });
        else expect(Number(shown.display)).toBeGreaterThan(0);
      }
    }
  });
});
