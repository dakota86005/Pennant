import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Two distinct roots:
 *
 *  APP_ROOT  — where bundled read-only assets live (the built frontend). Inside a
 *              packaged desktop app this is within the app bundle and NOT writable.
 *  DATA_DIR  — where everything we write goes (databases, caches, config, .env).
 *              Electron points this at the OS user-data directory; in plain `npm
 *              run dev` it defaults to ./data alongside the source.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const APP_ROOT = process.env.OOTP_FO_APP_ROOT
  ? path.resolve(process.env.OOTP_FO_APP_ROOT)
  : path.resolve(moduleDir, '..');

export const DATA_DIR = process.env.OOTP_FO_DATA_DIR
  ? path.resolve(process.env.OOTP_FO_DATA_DIR)
  : path.join(APP_ROOT, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

/** @deprecated Use APP_ROOT for assets or DATA_DIR for writable files. */
export const PROJECT_ROOT = APP_ROOT;

const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
/** Older versions kept config.json in the project root — migrate it once. */
const LEGACY_CONFIG_PATH = path.join(APP_ROOT, 'config.json');

/**
 * The `OOTP_FO_*` settings a `.env` may set: the user-facing ones (DEVELOPMENT.md "Application id and compatibility
 * holds"). Every other `OOTP_FO_*` name is a switch for tests and tools (`OOTP_FO_DB_WRITABLE` opens the served league
 * writable, `OOTP_FO_EXPORT_QUIET_MS=0` imports half-written exports, ...) and is read only from the real environment,
 * never from a file in the data folder (B-101, SRVINFRA-28).
 */
export const ENV_FILE_SETTINGS = new Set(['OOTP_FO_BIND', 'OOTP_FO_ALLOWED_HOSTS', 'OOTP_FO_API_PORT', 'OOTP_FO_UPDATER_LOG']);

/**
 * A `.env` file's settings, in order: `NAME=value` lines, Windows line endings or not, with an optional `export `, a
 * value in matching single or double quotes taken as written inside them, and an unquoted value trimmed and cut at a
 * ` #` comment. Lines that are not settings are skipped.
 */
export function parseEnvFile(text: string): Array<[name: string, value: string]> {
  const settings: Array<[string, string]> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, '');
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2];
    const quoted = /^(["'])(.*)\1$/.exec(value);
    settings.push([m[1], quoted ? quoted[2] : value.replace(/\s+#.*$/, '')]);
  }
  return settings;
}

/** Whether a `.env` may set a name: anything but an `OOTP_FO_*` switch outside `ENV_FILE_SETTINGS`. */
export const envFileMaySet = (name: string): boolean => !name.startsWith('OOTP_FO_') || ENV_FILE_SETTINGS.has(name);

// Minimal .env loader. Checks the writable data directory first so a packaged
// app's user can drop a key beside their data without touching the app bundle.
// A variable already set in the environment wins.
for (const envPath of [path.join(DATA_DIR, '.env'), path.join(APP_ROOT, '.env')]) {
  let envText: string;
  try {
    envText = fs.readFileSync(envPath, 'utf8');
  } catch {
    continue; // no .env at this location — fine
  }
  for (const [name, value] of parseEnvFile(envText)) {
    if (!envFileMaySet(name)) {
      console.warn(`[config] ${envPath}: ${name} is ignored here; set it in the environment if it is meant`);
      continue;
    }
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

export interface AppConfig {
  /** Directory containing the OOTP CSV export files. */
  csvDir: string | null;
  /** Display name of the selected save. */
  saveName: string | null;
  /**
   * A `<save>.lg` folder the user chose by hand. Only ever a fallback: the save
   * is normally derived from where the CSV export lives, so nothing here needs
   * setting unless that derivation genuinely fails.
   */
  lgPath?: string | null;
}

export function loadConfig(): AppConfig {
  for (const p of [CONFIG_PATH, LEGACY_CONFIG_PATH]) {
    try {
      return { csvDir: null, saveName: null, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
    } catch {
      // try the next location
    }
  }
  return { csvDir: null, saveName: null };
}

/**
 * Where the configuration stands, as one string (its file's size and time, both places): what the save's place is kept
 * against (N9, `currentSaveLocation`), so a change of save or folder is never missed and nothing re-reads it otherwise.
 */
export function configStamp(): string {
  return [CONFIG_PATH, LEGACY_CONFIG_PATH].map((p) => {
    try {
      const st = fs.statSync(p);
      return `${st.size}:${st.mtimeMs}`;
    } catch {
      return 'absent';
    }
  }).join('|');
}

export function saveConfig(config: AppConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
