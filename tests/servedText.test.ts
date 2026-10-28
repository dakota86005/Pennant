/**
 * No developer or code text on screen (B-01, B-11; SRVPRES-06). Every string the server sends to the Mac app, on every
 * committed contract fixture, is read: a shown field against the jargon list as before, and every string, a basis's
 * stamp and source included, against the developer-provenance and code-text lists. Only the code fields (`CODE_FIELDS`:
 * ids, keys, sort keys, URLs, a folder's path) and a single token outside a shown field (an enum's code, a date, a
 * colour) are left out.
 *
 * The fixtures are what the Swift tests decode and the previews draw, written by the live routes on the synthetic save
 * (`npm run contract:fixtures`), so a leak a route serves lands here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODE_TEXT, PROVENANCE, bannedIn, bannedInPayload, servedStrings } from './bannedJargon';

const ROOT = path.join(process.cwd(), 'contract', 'fixtures');

function fixtureFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const at = path.join(dir, e.name);
    if (e.isDirectory()) return fixtureFiles(at);
    return e.name.endsWith('.json') && e.name !== 'sort-cases.json' ? [at] : [];
  });
}

/** Each operation's id from a fixture's file name (`getFarmDecision-what-if.json` → `getFarmDecision`), for the scoped exceptions. */
const SPEC = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'contract', 'openapi.json'), 'utf8')) as {
  paths: Record<string, Record<string, { operationId: string }>>;
};
const OPERATIONS = Object.values(SPEC.paths).flatMap((methods) => Object.values(methods).map((o) => o.operationId));
const operationOf = (file: string): string | undefined => {
  const name = path.basename(file, '.json');
  return OPERATIONS.filter((op) => name === op || name.startsWith(`${op}-`)).sort((a, b) => b.length - a.length)[0];
};

describe('served text: no developer provenance and no code words (B-01, B-11)', () => {
  const files = fixtureFiles(ROOT);

  it('reads the fixtures (something to check)', () => {
    expect(files.length).toBeGreaterThan(150);
    const stamps = files.flatMap((f) => servedStrings(JSON.parse(fs.readFileSync(f, 'utf8'))).filter((s) => /\.basis\.stamp$/.test(s.path)));
    expect(stamps.length).toBeGreaterThan(100);
  });

  it.each(fixtureFiles(ROOT).map((f) => [path.relative(ROOT, f), f]))('%s serves no developer provenance or code text', (_name, file) => {
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    const found = bannedInPayload(body, operationOf(file)).map((f) => `${f.path} ${f.pattern}: ${f.text.slice(0, 160)}`);
    expect(found).toEqual([]);
  });
});

describe('the provenance and code-text lists', () => {
  it('catch what shipped in the stamps and lines (B-01, B-11)', () => {
    for (const leak of [
      'Fallback prior, fitted by the production method production-3b.1 (playerValueProductionFit.ts, no prior, no hold-out)',
      'with `npm run calibrate production -- --prior`',
      'that the Arizona historical save imports (export of 2026-05-16, league 203)',
      'Chosen and stated, never fitted (Q-3).',
      "Player Development's stakes (D-050): a ceiling, lowered by how much development is left",
      'Owner decision (2026-09-24): the neutral view discounts at 5% a season',
      'value_production_fits 12, fitted at game date 2040-5-6',
      'scripts/calibrate.ts on the 2026-05-16 Arizona save',
    ]) expect(bannedIn(leak, [PROVENANCE]), leak).not.toEqual([]);
    for (const code of ['Season line (55 PA, level 2)', 'Recall, level 2', 'rules_minor_league_fa_minimum_years', 'protected_prospect', 'CEILING_LINES', 'p10 / p50 / p90']) {
      expect(bannedIn(code, [CODE_TEXT]), code).not.toEqual([]);
    }
  });

  it('pass the plain lines a stamp should carry', () => {
    for (const plain of [
      "Pennant's starting value; this league hasn't been measured yet",
      "Measured on this save's own seasons",
      'Season line (55 PA, Double-A)',
      'Mike Trout, 2040: Arizona Diamondbacks',
    ]) expect(bannedIn(plain, [PROVENANCE, CODE_TEXT]), plain).toEqual([]);
  });

  it('read a stamp, a source and a title, and leave the code fields and an enum code alone', () => {
    const payload = {
      id: 'mlb:role_below_standard:catcher', sort: { name: 'players_value' }, url: 'pennant://player/1', status: 'pre_arbitration',
      title: 'Recall, level 2',
      claim: { text: 'Fine', basis: { because: [{ label: 'Why', value: 'ok' }], stamp: 'See D-053', source: { specialist: 'npm run calibrate' }, certainty: 'policy' } },
    };
    expect(bannedInPayload(payload).map((f) => f.path)).toEqual(['$.title', '$.claim.basis.stamp', '$.claim.basis.source.specialist']);
  });
});
