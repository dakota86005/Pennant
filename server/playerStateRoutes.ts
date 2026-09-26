import { Router, type Response } from 'express';
import type { ApiError } from './api.js';
import fs from 'node:fs';
import { loadConfig, saveConfig } from './config.js';
import { getDataStatus, resetTransactionLogCache, type DataStatus } from './dataStatus.js';
import { locateSave } from './ootpSave.js';
import { playerPicture } from './playerContext.js';

export const playerStateRoutes = Router();

/** Set by the import pipeline so the status can say when data was last loaded. */
export const importedAt: { value: string | null } = { value: null };

/**
 * How current each source is, and where the save and its live transaction
 * database were found. The save is derived from the CSV export's location;
 * nothing here needs configuring in normal use.
 */
playerStateRoutes.get('/data-status', (_req, res: Response<DataStatus>) => {
  res.json(getDataStatus({ importedAt: importedAt.value }));
});

/** Current state, assignment context, and explicit chronology for one player. */
playerStateRoutes.get('/player-state/:playerId', (req, res) => {
  const picture = playerPicture(Number(req.params.playerId));
  if (!picture) return res.status(404).json({ error: 'Player not found' });
  res.json(picture);
});

/** The `<save>.lg` folder named by hand (`POST /api/save-source`); empty or null returns to automatic. */
export interface SaveSourceRequest {
  lgPath?: string | null;
}

/** What `POST /api/save-source` answers once the save folder is set or cleared. */
export interface SaveSourceResult {
  ok: true;
  status: DataStatus;
}

/**
 * Fallback only: names the `<save>.lg` folder by hand when it cannot be derived
 * from the export's location. Clearing it (empty path) returns to automatic.
 */
playerStateRoutes.post('/save-source', (req, res: Response<SaveSourceResult | ApiError>) => {
  const { lgPath } = req.body as SaveSourceRequest;
  const config = loadConfig();
  if (!lgPath?.trim()) {
    saveConfig({ ...config, lgPath: null });
    resetTransactionLogCache();
    return res.json({ ok: true, status: getDataStatus({ importedAt: importedAt.value }) });
  }
  const candidate = locateSave({ csvDir: null, manualLgPath: lgPath });
  if (!candidate.found || !fs.existsSync(candidate.lgPath!)) {
    return res.status(400).json({ error: 'That folder is not an OOTP save (.lg) folder.' });
  }
  saveConfig({ ...config, lgPath: candidate.lgPath });
  resetTransactionLogCache();
  res.json({ ok: true, status: getDataStatus({ importedAt: importedAt.value }) });
});
