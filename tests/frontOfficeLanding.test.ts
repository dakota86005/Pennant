import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { claimTrail, departmentReport, frontOfficeSummary, resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { reviewClub, reviewNeeds, type ReviewPorts } from '../server/mlbReview.js';
import type { LensEvidence } from '../server/roleReview.js';
import { readContext } from '../server/staffPreference.js';
import { departmentOffice, servedDepartments } from '../server/presentation/catalog.js';
import { REPORTING, assemble, type BuildContext } from '../server/presentation/frontOffice/desk.js';
import { majorLeagueMaterial } from '../server/presentation/frontOffice/majorLeague.js';
import { healthy26, viewOf } from './mlbFixtures';
import { basisStrings, shownStrings } from './bannedJargon';
import { buildSave, type BuiltSave } from './syntheticSave';

/**
 * The landing payload (BEHAVIOR_CASES.md "Pennant for Mac", `frontOfficeLanding.test.ts`; D-060): the Morning Report's
 * desk and cards, and every department report behind them, carry no postseason odds, no deadline posture and no
 * season-window label. The landing folders import neither `posture` nor the playoff odds by any chain of imports
 * (`presentationBoundary.test.ts`); this holds the payload itself.
 */

/** Words of the odds and the posture: nowhere in the payload, its basis included. */
const ODDS_OR_POSTURE = [/postseason/i, /playoff/i, /\bodds\b/i, /\bbuy(?:er|ing)?\b/i, /\bsell(?:er|ing)?\b/i, /\bposture\b/i, /\d+% to reach/i];
/** The window's labels: never on the face (a lean in the basis may say how the club's situation shaded a flag). */
const WINDOW_LABELS = [
  /\bcontend/i, /win-now/i, /\bwin now\b/i, /\brebuild/i, /building for the future/i, /\bwindow\b/i, /\bin the race\b/i,
  // The words the season's shading of a flag uses (`staffPreference.ts`): a lean, never a line on the face
  /does not press/i, /soft spot/i, /\bpatient\b/i, /still developing/i,
];

describe('the landing payload shows no odds, posture or window label (D-060)', () => {
  let save: BuiltSave;
  let payloads: unknown[] = [];
  beforeAll(async () => {
    save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 6, seed: 11, minors: true });
    resetFrontOfficeCache();
    const summary = await frontOfficeSummary(save.org);
    const reports = await Promise.all([...REPORTING, 'frontOffice'].map((d) => departmentReport(save.org, d)));
    const evidence = reports.flatMap((r) => [...r.toDecide.items, ...r.watching.items]).find((it) => it.evidence)?.evidence;
    payloads = [summary, ...reports, ...(evidence ? [await claimTrail(evidence)] : [])];
  }, 60_000);

  it('has payloads to check', () => {
    expect(payloads.length).toBeGreaterThan(8);
    expect(shownStrings(payloads).length).toBeGreaterThan(50);
  });

  it('names no postseason odds and no deadline posture anywhere, basis included', () => {
    const everything = [...shownStrings(payloads), ...basisStrings(payloads)];
    const found = everything.filter(({ text }) => ODDS_OR_POSTURE.some((p) => p.test(text)));
    expect(found).toEqual([]);
  });

  it('shows no season-window label on its face', () => {
    const found = shownStrings(payloads).filter(({ text }) => WINDOW_LABELS.some((p) => p.test(text)));
    expect(found).toEqual([]);
  });

  it('keeps the season\'s read out of what it serves: no field of the club\'s context is copied in', () => {
    const json = JSON.stringify(payloads);
    for (const field of ['"posture"', '"odds"', '"season"', '"window"', '"urgency":"high"', '"conflict"']) expect(json).not.toContain(field);
  });

  it('reads the specialists only in the service, never in the landing folders', () => {
    const folder = path.join(process.cwd(), 'server', 'presentation', 'frontOffice');
    for (const file of fs.readdirSync(folder)) {
      const source = fs.readFileSync(path.join(folder, file), 'utf8');
      expect(source, file).not.toMatch(/from '\.\.\/\.\.\/(?:posture|playoffs|staffPreference)\.js'/);
    }
  });
});

/**
 * The season's odds decide nothing on the desk (D-060; review S-1, S-2). Real review needs from the roster review, shaded by
 * the real `readContext` at odds that raise a moderate flag (.60) and lower a strong one on a young player (.20): what is on
 * the desk, what is watched and in which order are the same as with no season at all; the shaded reading is only the lean.
 */
describe('the season\'s odds never decide the desk', () => {
  const ev = (v: number): LensEvidence => ({ ratingsPct: v, ratingsEvidence: 'complete', skillsPct: v, runsPct: v, sample: 900, sampleUnit: 'BF', toolsWeight: 1, reliability: 0.75, currentSample: 180, usage: [] });
  const table: Record<number, LensEvidence> = {};
  for (let id = 100; id <= 112; id += 1) table[id] = ev(55);
  table[103] = ev(28); // a moderate case: the season raises it at high odds
  table[104] = ev(15); // a strong case on a young starter: the season lowers it at low odds
  const ports: ReviewPorts = { holderEvidence: (ids) => new Map(ids.filter((id) => table[id]).map((id) => [id, table[id]] as const)) };
  const view = viewOf(healthy26().map((spec) => (spec.id === 104 ? { ...spec, age: 23 } : spec)));
  const groups = reviewClub(view, ports);
  const build: BuildContext = { orgId: 1, club: 'Test Club', importStamp: null, reportStamp: 'r1', gameDate: '2040-7-1' };
  const departments = servedDepartments(null);
  const at = (odds: number | null) => {
    const context = readContext({ dimensions: { competitiveWindow: 50 }, posture: odds === null ? null : { posture: 'hold', odds, gamesLeft: 80, deadlinePassed: false, headline: 'x' } });
    const needs = reviewNeeds(view, groups, context);
    const material = majorLeagueMaterial({ build, department: departments.find((d) => d.id === 'majorLeague')!, office: departmentOffice('majorLeague') }, {
      overview: { needs, roster: { active: { count: 26, limit: 26 }, fortyMan: { count: 40, limit: 40 }, injuredList: 0 }, unknowns: [], yardsticks: { line: 'x', tip: 'x', groups: [], longMan: 'x' } },
      fortyMan: { ok: false, status: 400, error: 'x' },
    });
    const empty = { status: 'available' as const, items: [{ specialist: 'x', items: [], figures: [], unknowns: [] }] };
    return { needs, ...assemble(build, departments, departmentOffice, { majorLeague: { status: 'available', items: [material] }, farm: empty, finance: empty, medical: empty }) };
  };
  const plain = at(null);
  const high = at(0.6);
  const low = at(0.2);

  it('meets real shaded flags: the season raises one and lowers another', () => {
    expect(high.needs.find((n) => n.subject?.playerId === 103)).toMatchObject({ severity: 'elevated', explanation: { neutralSeverity: 'watch' } });
    expect(low.needs.find((n) => n.subject?.playerId === 104)).toMatchObject({ severity: 'watch', explanation: { neutralSeverity: 'elevated' } });
  });

  it('keeps the desk, the watch list and their order the same at any odds', () => {
    const shape = (r: typeof plain) => ({
      desk: r.summary.desk.items.map((it) => [it.key, it.neutralSeverity, it.urgency.text]),
      watching: r.reports.get('majorLeague')!.watching.items.map((it) => it.key),
    });
    expect(shape(high)).toEqual(shape(plain));
    expect(shape(low)).toEqual(shape(plain));
    expect(shape(plain).desk.map((d) => d[0])).toContain('majorLeague:need:mlb:role_holder_review:104');
  });

  it('shows the shaded reading only as the lean, never on the face', () => {
    for (const r of [high, low]) {
      const items = [...r.reports.get('majorLeague')!.toDecide.items, ...r.reports.get('majorLeague')!.watching.items];
      expect(items.some((it) => it.urgency.basis.lean !== null)).toBe(true);
      const face = shownStrings([r.summary, ...r.reports.values()]).filter(({ text }) => [...ODDS_OR_POSTURE, ...WINDOW_LABELS].some((p) => p.test(text)));
      expect(face).toEqual([]);
      const basis = basisStrings([r.summary, ...r.reports.values()]).filter(({ text }) => ODDS_OR_POSTURE.some((p) => p.test(text)));
      expect(basis).toEqual([]);
    }
  });
});
