import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, tableColumns, tableExists } from './db.js';
import { loadConfig } from './config.js';

export const logoRoutes = Router();

/**
 * OOTP writes team logos into the save at
 *   <save>.lg/news/html/images/team_logos/<logo_file_name>
 * Using these instead of fetching from the web keeps the app offline-capable
 * and correct for custom/fictional leagues, which have no logo on the internet.
 */
function logoDir(): string | null {
  const { csvDir } = loadConfig();
  if (!csvDir) return null;
  // csvDir is <save>.lg/import_export/csv — walk up to the save root
  const saveRoot = path.resolve(csvDir, '..', '..');
  const dir = path.join(saveRoot, 'news', 'html', 'images', 'team_logos');
  return fs.existsSync(dir) ? dir : null;
}

/**
 * A token that changes when the save does.
 *
 * Team ids repeat across saves — team 18 is one club in one league and quite
 * another elsewhere — so a URL of /api/logo/18 names two different pictures
 * depending on which save is loaded. With a day's cache on it the browser went
 * on showing the first one, which is how logos from an old save turned up
 * against the clubs of a new one. Folding the save's own path into the URL
 * gives each save its own cache entry.
 */
export function logoToken(): string {
  const { csvDir } = loadConfig();
  if (!csvDir) return 'none';
  let hash = 0;
  for (let i = 0; i < csvDir.length; i++) hash = (hash * 31 + csvDir.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/** Guard against a malicious logo_file_name escaping the logo directory. */
function safeJoin(dir: string, name: string): string | null {
  const resolved = path.resolve(dir, name);
  return resolved.startsWith(path.resolve(dir) + path.sep) ? resolved : null;
}

/** The logo file the save holds for a club (a size variant first when one is asked for), or null. */
function logoFile(teamId: number, size: string): string | null {
  const dir = logoDir();
  if (!dir || !tableExists('teams')) return null;

  const row = db.prepare(`SELECT logo_file_name FROM teams WHERE team_id = ?`).get(teamId) as
    | { logo_file_name: string | null }
    | undefined;
  if (!row?.logo_file_name) return null;

  // Optional size variant: OOTP ships <name>_50.png, _110.png, etc.
  const base = row.logo_file_name.replace(/\.png$/i, '');
  const candidates = size ? [`${base}_${size}.png`, row.logo_file_name] : [row.logo_file_name];

  for (const candidate of candidates) {
    const file = safeJoin(dir, candidate);
    if (file && fs.existsSync(file)) return file;
  }
  return null;
}

/**
 * Where the Mac app fetches a club's logo (`GET /api/logo/:teamId`, with the save's token so a new save never shows an
 * old one's art), or null when the save holds none for the club.
 */
export function logoReference(teamId: number): string | null {
  // An export without the column has no logos to point at (the route itself answers as it always has)
  if (!tableExists('teams') || !tableColumns('teams').includes('logo_file_name')) return null;
  return logoFile(teamId, '') ? `/api/logo/${teamId}?v=${logoToken()}` : null;
}

logoRoutes.get('/logo/:teamId', (req, res) => {
  const file = logoFile(Number(req.params.teamId), String(req.query.size ?? ''));
  if (!file) return res.status(404).end();
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(file);
});
