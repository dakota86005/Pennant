/**
 * Caches that last one import (N3.5, D-061): for figures that depend on the export alone, never on the club, the
 * philosophy or the request. The league's rating populations are the case measured (N3.5 Stage A: about half the
 * dashboard, the farm and the prospects pages recomputed them for every player and every request).
 *
 * MINOR_LEAGUE_OPERATIONS.md section 7.8 chose "nothing cached across requests" so a changed export or philosophy is
 * always seen. That still holds: a cache here is keyed on the served database (`databaseGeneration`, bumped by every
 * swap), so a new import is never read through an old cache; and nothing keyed on a philosophy input may live here
 * (`tests/importCache.test.ts` changes the philosophy and asserts the answer changes).
 */
import { databaseGeneration } from './db.js';

const caches = new Set<Map<string, unknown>>();
let generation = -1;

/** Drops every per-import cache (the swap does it through the generation; a test that edits its league by hand calls it). */
export function clearImportCaches(): void {
  for (const cache of caches) cache.clear();
}

/** A cache for one kind of export-only figure: `get(key, compute)` computes once per import and key. */
export function importCache<V>(): { get(key: string, compute: () => V): V } {
  const cache = new Map<string, unknown>();
  caches.add(cache);
  return {
    get(key, compute) {
      const now = databaseGeneration();
      if (now !== generation) {
        clearImportCaches();
        generation = now;
      }
      if (cache.has(key)) return cache.get(key) as V;
      const value = compute();
      cache.set(key, value);
      return value;
    },
  };
}
