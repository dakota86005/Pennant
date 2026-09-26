import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { loadConfig, saveConfig } from '../server/config.js';
import { catalogClubs, majorLeagueClubs } from '../server/org.js';
import { buildCatalog, servedDepartments, servedGlossary, servedStats } from '../server/presentation/catalog.js';
import { REACT_ONLY_TERMS } from '../server/presentation/glossary.js';
import { clubPalette, derivePalette, toHex } from '../server/presentation/palette.js';
import { define } from '../src/glossary';
import { BATTING_STATS, CONTACT_STATS, FIELDING_STATS, PITCHING_STATS } from '../src/stats';
import { derivePalette as reactPalette } from '../src/theme';
import { IDS } from './fixture';

/**
 * `GET /api/v2/catalog` (SWIFTUI_REBUILD.md section 4.2): the glossary and stat catalog both clients read, each club's
 * palette as the Mac app is served it, and the departments with their heads from the save's staff. Built on the fixture
 * league, whose front office has a general manager and an assistant (tests/fixture.ts).
 */

describe('the glossary and the stat catalog are one copy for both clients', () => {
  it('serves every term the React app defines, with the same words, but the React-only ones', () => {
    const served = servedGlossary();
    expect(served.length).toBeGreaterThan(60);
    for (const entry of served) expect(define(entry.display), entry.display).toBe(entry.text);
    for (const term of REACT_ONLY_TERMS) {
      expect(define(term), `${term} is still the React app's`).toBeDefined();
      expect(served.map((e) => e.display)).not.toContain(term);
    }
  });

  it('serves every stat the React app offers, with its label, words, format and direction', () => {
    const served = servedStats();
    const react = [
      ...BATTING_STATS.map((d) => ({ d, group: 'batting' })), ...PITCHING_STATS.map((d) => ({ d, group: 'pitching' })),
      ...FIELDING_STATS.map((d) => ({ d, group: 'fielding' })), ...CONTACT_STATS.map((d) => ({ d, group: 'contact' })),
    ];
    expect(served).toHaveLength(react.length);
    for (const { d, group } of react) {
      expect(served).toContainEqual({ key: d.key, group, display: d.label, text: d.desc, format: d.format, section: d.section, lowerIsBetter: d.lowerIsBetter === true });
    }
  });
});

describe('each club\'s palette, as the Mac app is served it', () => {
  it('is the React app\'s palette, as hex tokens in both modes', () => {
    expect(reactPalette).toBe(derivePalette);
    const colors = { bg: '#0c2340', fg: '#ffffff', secondary: '#bd3039', cap: '#0c2340' };
    for (const mode of ['light', 'dark'] as const) {
      const css = derivePalette(colors, mode);
      const served = clubPalette(colors, mode);
      expect(served.accent).toBe(toHex(css['--accent']));
      expect(served.team).toBe(toHex(css['--team']));
      for (const [token, value] of Object.entries(served)) expect(value, token).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('writes an hsl() colour as the hex it is', () => {
    expect(toHex('hsl(0, 100%, 50%)')).toBe('#ff0000');
    expect(toHex('hsl(120, 100%, 25%)')).toBe('#008000');
    expect(toHex('#ABCDEF')).toBe('#abcdef');
    expect(() => toHex('red')).toThrow();
  });

  it('gives a club with no colours in the export the default palette, never a guess of its own', () => {
    expect(clubPalette({ bg: null, fg: null, secondary: null, cap: null }, 'dark')).toEqual(clubPalette(null, 'dark'));
  });
});

describe('the departments and their heads, from the save\'s staff table (review S6)', () => {
  const STAFF = 'team_id INTEGER, manager INTEGER, general_manager INTEGER, pitching_coach INTEGER, hitting_coach INTEGER, bench_coach INTEGER, head_scout INTEGER, doctor INTEGER';
  const withStaff = (row: Record<string, number>, run: () => void, ddl = STAFF) => {
    db.exec(`CREATE TABLE team_roster_staff (${ddl})`);
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO team_roster_staff (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
    try {
      run();
    } finally {
      db.exec('DROP TABLE team_roster_staff');
    }
  };
  const head = (id: string) => servedDepartments(IDS.mlbTeam).find((d) => d.id === id)!;

  it('lists the nine departments in the sidebar\'s order, with the Mac app\'s ids', () => {
    expect(servedDepartments(IDS.mlbTeam).map((d) => d.id)).toEqual([
      'frontOffice', 'majorLeague', 'farm', 'scouting', 'trades', 'finance', 'medical', 'league', 'philosophy',
    ]);
  });

  it('names the person in each seat the staff table fills, under the staff page\'s own name for the seat', () => {
    // The fixture's coaches: 900 Skip Ratchet, 901 Web Ivey, 902 Del Faraday
    withStaff({ team_id: IDS.mlbTeam, general_manager: 901, bench_coach: 900, head_scout: 902, doctor: 900 }, () => {
      expect(head('frontOffice').head).toEqual({ name: 'Web Ivey', role: 'General Manager', coachId: 901 });
      expect(head('frontOffice').preparedBy.display).toBe('Prepared by Web Ivey, general manager');
      expect(head('majorLeague').head).toMatchObject({ name: 'Skip Ratchet', role: 'Bench Coach' });
      expect(head('scouting').head).toMatchObject({ name: 'Del Faraday', role: 'Head Scout' });
      expect(head('medical').head).toMatchObject({ name: 'Skip Ratchet', role: 'Team Doctor' });
      expect(head('medical').preparedBy.display).toBe('Prepared by Skip Ratchet, team doctor');
    });
  });

  it('says a seat the staff table leaves empty is empty, and never names anyone', () => {
    withStaff({ team_id: IDS.mlbTeam, general_manager: 901, bench_coach: 0, head_scout: 0, doctor: 424242 }, () => {
      for (const id of ['majorLeague', 'scouting', 'medical']) {
        expect(head(id).head, id).toBeNull();
        expect(head(id).preparedBy.tone).toBe('unknown');
        expect(head(id).preparedBy.hint).toMatch(/The save's staff has no .+ for this club/);
      }
    });
  });

  it('says nothing is known when the export has no staff table, no such seat, or no row for the club', () => {
    // No table (the fixture has none)
    for (const id of ['frontOffice', 'majorLeague', 'scouting', 'medical']) {
      expect(head(id).head).toBeNull();
      expect(head(id).preparedBy.hint).toBe('The export does not include the club\'s staff');
    }
    // A table without the doctor's seat, and a table with no row for this club
    withStaff({ team_id: IDS.mlbTeam, general_manager: 901 }, () => {
      expect(head('frontOffice').head).toMatchObject({ name: 'Web Ivey' });
      expect(head('medical').preparedBy.hint).toBe('The export does not include the club\'s staff');
    }, 'team_id INTEGER, general_manager INTEGER');
    withStaff({ team_id: 999_999, general_manager: 901 }, () => {
      expect(head('frontOffice').head).toBeNull();
    });
  });

  it('names nobody when no club is known, and never a head for a department with no one seat', () => {
    expect(servedDepartments(null).every((d) => d.head === null)).toBe(true);
    for (const id of ['farm', 'trades', 'finance', 'league', 'philosophy']) expect(head(id).head).toBeNull();
  });
});

describe('each club\'s record and logo', () => {
  const previous = loadConfig();
  let saveRoot = '';
  afterEach(() => {
    saveConfig(previous);
    if (saveRoot) fs.rmSync(saveRoot, { recursive: true, force: true });
    saveRoot = '';
  });

  it('writes the record as the export has it, and says so when the export has none', () => {
    // The fixture's standings table has no row for the club: write one, as an export would
    db.prepare('DELETE FROM team_record WHERE team_id = ?').run(IDS.mlbTeam);
    db.prepare('INSERT INTO team_record (team_id, g, w, l, pos, gb) VALUES (?, 83, 45, 38, 2, 3)').run(IDS.mlbTeam);
    try {
      const ours = buildCatalog(majorLeagueClubs(), IDS.mlbTeam).clubs.find((c) => c.teamId === IDS.mlbTeam)!;
      expect(ours.record).toEqual({ display: '45–38', hint: '45 wins, 38 losses, 2nd in the division, 3 games back' });
    } finally {
      db.prepare('DELETE FROM team_record WHERE team_id = ?').run(IDS.mlbTeam);
    }
    db.exec('ALTER TABLE team_record RENAME TO zz_team_record');
    try {
      const without = buildCatalog(majorLeagueClubs(), IDS.mlbTeam).clubs.find((c) => c.teamId === IDS.mlbTeam)!;
      expect(without.record).toMatchObject({ display: 'No record in the export yet', tone: 'unknown' });
    } finally {
      db.exec('ALTER TABLE zz_team_record RENAME TO team_record');
    }
  });

  it('points at the logo only when the save holds one', () => {
    expect(buildCatalog(majorLeagueClubs(), IDS.mlbTeam).clubs.every((c) => c.logo === null)).toBe(true);
    saveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-logo-'));
    const csv = path.join(saveRoot, 'Test.lg', 'import_export', 'csv');
    const logos = path.join(saveRoot, 'Test.lg', 'news', 'html', 'images', 'team_logos');
    fs.mkdirSync(csv, { recursive: true });
    fs.mkdirSync(logos, { recursive: true });
    fs.writeFileSync(path.join(logos, 'club.png'), 'png');
    saveConfig({ ...previous, csvDir: csv, saveName: 'Test' });
    // The fixture's export has no logo column; an export without it has no logos to point at
    expect(buildCatalog(majorLeagueClubs(), IDS.mlbTeam).clubs.every((c) => c.logo === null)).toBe(true);
    db.exec('ALTER TABLE teams ADD COLUMN logo_file_name TEXT');
    db.prepare('UPDATE teams SET logo_file_name = ? WHERE team_id = ?').run('club.png', IDS.mlbTeam);
    try {
      const clubs = buildCatalog(majorLeagueClubs(), IDS.mlbTeam).clubs;
      expect(clubs.find((c) => c.teamId === IDS.mlbTeam)!.logo).toMatch(new RegExp(`^/api/logo/${IDS.mlbTeam}\\?v=[a-z0-9]+$`));
      expect(clubs.filter((c) => c.teamId !== IDS.mlbTeam).every((c) => c.logo === null)).toBe(true);
    } finally {
      db.exec('ALTER TABLE teams DROP COLUMN logo_file_name');
    }
  });
});

describe('a club list without every column (review N1)', () => {
  it('serves the catalog from a teams table without nickname or human_team: the name alone, who runs it unknown', () => {
    const cols = ['nickname', 'human_team', 'human_id'].filter((c) => (db.prepare('PRAGMA table_info(teams)').all() as Array<{ name: string }>).some((r) => r.name === c));
    const saved = db.prepare(`SELECT team_id, ${cols.join(', ')} FROM teams`).all() as Array<Record<string, unknown>>;
    for (const c of cols) db.exec(`ALTER TABLE teams DROP COLUMN ${c}`);
    try {
      const clubs = catalogClubs();
      expect(clubs.length).toBeGreaterThan(0);
      for (const club of clubs) expect(club.isHuman).toBeNull();
      const catalog = buildCatalog(clubs, IDS.mlbTeam);
      expect(catalog.clubs.find((c) => c.teamId === IDS.mlbTeam)?.name).toBe((db.prepare('SELECT name FROM teams WHERE team_id = ?').get(IDS.mlbTeam) as { name: string }).name);
      expect(catalog.glossary.length).toBeGreaterThan(0);
    } finally {
      for (const c of cols) db.exec(`ALTER TABLE teams ADD COLUMN ${c} ${c === 'nickname' ? 'TEXT' : 'INTEGER DEFAULT 0'}`);
      for (const row of saved) {
        db.prepare(`UPDATE teams SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE team_id = ?`).run(...cols.map((c) => row[c] as never), row.team_id as never);
      }
    }
  });
});

describe('the departments\' names and views, served to the sidebar (review N11)', () => {
  it('matches the Mac app\'s registry: every department and view id, in its order, with its structural fallback title', () => {
    const sources = path.join(process.cwd(), 'macos', 'Packages', 'PennantFeatures', 'Sources');
    const registry: Record<string, { title: string; views: Array<{ id: string; name: string }> }> = {};
    for (const dir of fs.readdirSync(sources)) {
      for (const file of fs.readdirSync(path.join(sources, dir)).filter((f) => f.endsWith('Department.swift'))) {
        const swift = fs.readFileSync(path.join(sources, dir, file), 'utf8');
        const id = /static let id: DeptID = "([^"]+)"/.exec(swift)?.[1];
        const title = /static let title: LocalizedStringResource = "([^"]+)"/.exec(swift)?.[1];
        if (!id || !title) continue;
        registry[id] = { title, views: [...swift.matchAll(/placeholder\(id: "([^"]+)", title: "([^"]+)"/g)].map((m) => ({ id: m[1], name: m[2] })) };
      }
    }
    const served = servedDepartments(null);
    expect(Object.keys(registry).sort()).toEqual(served.map((d) => d.id).sort());
    for (const d of served) {
      expect(d.name, d.id).toBe(registry[d.id].title);
      expect(d.views, d.id).toEqual(registry[d.id].views);
    }
  });
});
