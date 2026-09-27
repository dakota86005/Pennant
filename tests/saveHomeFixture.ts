import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A pretend Mac home folder with OOTP saves in it (N3.5 Stage B2), so finding saves reads neither the real disk nor
 * nothing at all. Each save gets the files OOTP writes (`players.dat`, `flag_save_completed.dat`), an export, its export
 * settings and its game date, with file times set to say when it was "played" and "exported".
 */
export interface PretendSave {
  lg: string;
  csvDir: string;
}

export const APP_STORE_27 = 'Library/Containers/com.ootpdevelopments.ootp27macqlm/Data/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games';
export const DIRECT_28 = 'Library/Application Support/Out of the Park Developments/OOTP Baseball 28/saved_games';
export const HOME_APP_SUPPORT_27 = 'Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games';

const HOUR = 3_600_000;

export class PretendHome {
  readonly dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-home-'));

  /**
   * A save under `root`. `playedHoursAgo` sets both files OOTP writes on a save (null: OOTP never saved it);
   * `exportedHoursAgo` writes an export (null: none); `configured` writes OOTP's export settings.
   */
  save(root: string, name: string, opts: {
    playedHoursAgo?: number | null; exportedHoursAgo?: number | null; configured?: boolean;
    humanClubs?: Array<[number, string, string]>; now?: number;
  } = {}): PretendSave {
    const now = opts.now ?? Date.now();
    const lg = path.join(this.dir, root, `${name}.lg`);
    const csvDir = path.join(lg, 'import_export', 'csv');
    fs.mkdirSync(path.join(lg, 'settings'), { recursive: true });
    fs.mkdirSync(path.join(lg, 'import_export'), { recursive: true });
    // 15 May 2030: day, month, year (little-endian), then zeros
    fs.writeFileSync(path.join(lg, 'settings', 'last_date_simulated.dat'), Buffer.from([15, 5, 0xee, 0x07, 0, 0, 0]));
    const played = opts.playedHoursAgo === undefined ? 1 : opts.playedHoursAgo;
    if (played !== null) {
      for (const f of ['players.dat', 'flag_save_completed.dat']) {
        const file = path.join(lg, f);
        fs.writeFileSync(file, 'x');
        const at = new Date(now - played * HOUR);
        fs.utimesSync(file, at, at);
      }
    }
    const exported = opts.exportedHoursAgo === undefined ? played : opts.exportedHoursAgo;
    if (exported !== null && exported !== undefined) {
      fs.mkdirSync(csvDir, { recursive: true });
      const clubs = opts.humanClubs ?? [[1, 'Arizona', 'Diamondbacks']];
      const rows = [[1, 'Arizona', 'Diamondbacks'], [2, 'Reno', 'Aces'], [3, 'Boston', 'Red Sox'], ...clubs]
        .filter((c, i, all) => all.findIndex((d) => d[0] === c[0]) === i)
        .map(([id, place, nick]) => `${id},${place},${nick},${clubs.some((c) => c[0] === id) ? 1 : 0}`);
      const files: Record<string, string> = {
        'players.csv': 'player_id,team_id\n1,1\n',
        'teams.csv': `team_id,name,nickname,human_team\n${rows.join('\n')}\n`,
        'leagues.csv': 'league_id,name\n100,Major\n',
      };
      for (const [f, body] of Object.entries(files)) {
        const file = path.join(csvDir, f);
        fs.writeFileSync(file, body);
        const at = new Date(now - exported * HOUR);
        fs.utimesSync(file, at, at);
      }
    }
    if (opts.configured ?? exported !== null) fs.writeFileSync(path.join(lg, 'settings', 'db_dump_standard_csv.cfg'), 'Show real player ratings,1\n');
    return { lg, csvDir };
  }

  /** A folder named like a save that OOTP never wrote (no players file, no flag). */
  stray(root: string, name: string): string {
    const lg = path.join(this.dir, root, `${name}.lg`);
    fs.mkdirSync(lg, { recursive: true });
    return lg;
  }

  cleanup(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}
