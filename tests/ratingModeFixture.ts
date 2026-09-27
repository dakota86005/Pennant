import { db, forgetImportRecord } from '../server/db.js';
import type { RatingMode } from '../server/ratingMode.js';

/**
 * Records, in the test league, which kind of ratings its "import" carried: the `pennant_import` record an N3.5 import
 * writes into its own database (D-061). Null removes it (an import from before the kind was recorded).
 */
export function setExportRatingMode(mode: RatingMode | null): void {
  db.exec('CREATE TABLE IF NOT EXISTS pennant_import (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare(`DELETE FROM pennant_import WHERE key = 'import'`).run();
  if (mode !== null) {
    const record = { startedAt: '2040-07-01T12:00:00.000Z', ratingMode: { mode, additionalScouted: null, source: 'export_settings', reason: null } };
    db.prepare(`INSERT INTO pennant_import (key, value) VALUES ('import', ?)`).run(JSON.stringify(record));
  }
  forgetImportRecord();
}
