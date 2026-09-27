/**
 * What runs after an import's swap (N3.5, D-061): the post-import hook list.
 *
 * The import's own work ends at the swap. Everything that follows from a new export (the rating, roster-state and
 * market snapshots, the refits, the AI generations, a warm-up of the pages the GM opens first) is a hook, run in
 * the order registered, once per import, after the new database is the league and `import-finished` has been sent.
 * A hook never fails the import: each is caught and logged, and the next still runs. A hook that returns a promise
 * is awaited before the next starts, so a hook that must not overlap another (the snapshots write `history.db`, the
 * refits later record into it) is ordered by registration; a hook that should not hold the others up starts its work
 * and returns.
 *
 * Modules register themselves (`registerPostImportHook`); the importer knows none of them. N4's Front Office warm-up
 * registers here too (`warmFrontOffice`).
 */
export interface PostImportContext {
  /** The import's generation (`currentImportGeneration`); a hook's result for an older one is stale. */
  generation: number;
  /** When the import started (its identity in `last-import.json`). */
  importStartedAt: string;
  /** False when the hooks re-run at start-up for an import whose hooks never finished (the server stopped). */
  fresh: boolean;
}

export type PostImportHook = (context: PostImportContext) => void | Promise<void>;

const hooks: Array<{ name: string; run: PostImportHook }> = [];

/** Adds a hook, run after every import in registration order; registering a name twice replaces the first. */
export function registerPostImportHook(name: string, run: PostImportHook): void {
  const at = hooks.findIndex((h) => h.name === name);
  if (at >= 0) hooks[at] = { name, run };
  else hooks.push({ name, run });
}

/** The hooks' names, in order (for the tests and the log). */
export const postImportHookNames = (): string[] => hooks.map((h) => h.name);

/** Runs every hook in order; resolves with each one's outcome and time. Never rejects. */
export async function runPostImportHooks(context: PostImportContext): Promise<Array<{ name: string; ok: boolean; ms: number }>> {
  const outcomes: Array<{ name: string; ok: boolean; ms: number }> = [];
  for (const hook of [...hooks]) {
    const started = performance.now();
    let ok = true;
    try {
      await hook.run(context);
    } catch (err) {
      ok = false;
      console.error(`[import] after-import step "${hook.name}" failed:`, err);
    }
    outcomes.push({ name: hook.name, ok, ms: Math.round(performance.now() - started) });
  }
  return outcomes;
}
