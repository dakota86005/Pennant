import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_NAME, PROJECT_URL, UPSTREAM_URL } from './project.js';

/**
 * The product's name and version, read from one place: `package.json`.
 *
 * From source the file sits at the repository root. In the packaged desktop app it is
 * inside the asar archive rather than beside the server, so Electron reads it with
 * `app.getVersion()` and hands the answer over in `OOTP_FO_APP_VERSION`; nothing else
 * in the codebase keeps a copy of the number. Read lazily and once, because the
 * desktop shell sets that variable after this module has been imported.
 */
let cached: string | null = null;

export function appVersion(): string {
  if (cached !== null) return cached;
  const fromShell = process.env.OOTP_FO_APP_VERSION?.trim();
  if (fromShell) return (cached = fromShell);
  const root = process.env.OOTP_FO_APP_ROOT
    ? path.resolve(process.env.OOTP_FO_APP_ROOT)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version) return (cached = pkg.version);
  } catch {
    // Fall through: a bundle with no readable package.json still starts
  }
  return (cached = 'unknown');
}

export interface AppInfo {
  name: string;
  version: string;
  projectUrl: string;
  /** The project this one began as a fork of; shown as credit, never used as a feed. */
  upstreamUrl: string;
}

export function appInfo(): AppInfo {
  return { name: PRODUCT_NAME, version: appVersion(), projectUrl: PROJECT_URL, upstreamUrl: UPSTREAM_URL };
}
