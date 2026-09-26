import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { claimTrail, departmentReport, frontOfficeSummary, resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { REPORTING } from '../server/presentation/frontOffice/desk.js';
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
const WINDOW_LABELS = [/\bcontend/i, /win-now/i, /\bwin now\b/i, /\brebuild/i, /building for the future/i, /\bwindow\b/i, /\bin the race\b/i];

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
