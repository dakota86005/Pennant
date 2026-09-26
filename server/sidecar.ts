/**
 * The Mac app's server: the same Express server, run as a child process of Pennant for Mac (D-055,
 * SWIFTUI_REBUILD.md section 5).
 *
 * The app (`ServerController`) starts this with `OOTP_FO_DATA_DIR`, `OOTP_FO_APP_ROOT` and `OOTP_FO_APP_VERSION`
 * set, then talks to it like this:
 *
 * 1. **stdin, first line:** `{"token":"<64 hex>","keys":{"anthropic":"sk-ant-..."}}`. The token is required on every
 *    `/api` request from then on (`apiToken.ts`); the keys come from the Keychain (`settings.ts`
 *    `setInjectedKeys`). Secrets travel on stdin because another process run by the same user can read this
 *    one's environment. Nothing arrives within 30 seconds: the server exits.
 * 2. **stdout:** `PENNANT_READY {"port":N,"pid":N,"version":"..."}` once it is listening on 127.0.0.1 at a port
 *    the system chose, or `PENNANT_FAILED {"reason":"...","message":"..."}` before exiting when it cannot start.
 *    Every other line is the server's ordinary log.
 * 3. **stdin, later lines:** `{"keys":{...}}` replaces the keys (the GM changed one in Settings).
 * 4. **Stopping:** SIGTERM or SIGINT stops cleanly and exits 0. So does stdin closing, which is how a crashed app
 *    is noticed (macOS has no parent-death signal, but the pipe closes whatever happens to the parent), and a
 *    parent that has gone (the child re-parented to launchd, pid 1).
 *
 * Exit codes: 0 stopped cleanly, 1 failed to start, 2 no usable handshake, 3 the data folder is in use.
 */
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// Before any server module loads: config.ts reads these at import time, and its `.env` loader only fills variables
// that are unset, so setting them here means a `.env` in the data folder cannot open the server to the network.
process.env.OOTP_FO_EMBEDDED = '1';
process.env.OOTP_FO_SIDECAR = '1';
process.env.OOTP_FO_BIND = '127.0.0.1';
process.env.OOTP_FO_ALLOWED_HOSTS = '';
// Bundled (`build/sidecar/server.cjs`, `Contents/Resources/server/`), the root is the bundle's own folder, which holds
// its package.json; config.ts's default (the parent of the module's folder) is right only from source
const entryFile = fileURLToPath(import.meta.url);
if (entryFile.endsWith('.cjs')) process.env.OOTP_FO_APP_ROOT ??= path.dirname(entryFile);

export const READY_PREFIX = 'PENNANT_READY ';
export const FAILED_PREFIX = 'PENNANT_FAILED ';
const HANDSHAKE_TIMEOUT_MS = 30_000;
/** How long a clean stop may take before the process exits anyway (the app waits 5 s, then kills). */
const SHUTDOWN_GRACE_MS = 4_000;
const PARENT_CHECK_MS = 2_000;

type Stop = (why: string) => void;

function fail(reason: string, message: string, code: number): never {
  process.stdout.write(`${FAILED_PREFIX}${JSON.stringify({ reason, message })}\n`);
  process.exit(code);
}

interface Handshake {
  token: string;
  keys: Record<string, unknown>;
}

function parseHandshake(line: string): Handshake | null {
  try {
    const parsed = JSON.parse(line) as { token?: unknown; keys?: unknown };
    if (typeof parsed.token !== 'string') return null;
    const keys = parsed.keys && typeof parsed.keys === 'object' ? (parsed.keys as Record<string, unknown>) : {};
    return { token: parsed.token, keys };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (!process.env.OOTP_FO_DATA_DIR) {
    fail('configuration', 'OOTP_FO_DATA_DIR is not set; the sidecar never falls back to a folder inside the app.', 1);
  }

  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let stop: Stop = () => process.exit(0);

  const first = await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), HANDSHAKE_TIMEOUT_MS);
    lines.once('line', (line) => {
      clearTimeout(timer);
      resolve(line);
    });
    lines.once('close', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
  const handshake = first === null ? null : parseHandshake(first);
  if (!handshake) fail('handshake', 'No token arrived on stdin.', 2);

  // Only now load the server: its modules open the databases as they are imported
  const { setApiToken, MIN_TOKEN_LENGTH } = await import('./apiToken.js');
  if (handshake.token.length < MIN_TOKEN_LENGTH) fail('handshake', `The token must be at least ${MIN_TOKEN_LENGTH} characters.`, 2);
  setApiToken(handshake.token);
  const { setInjectedKeys } = await import('./settings.js');
  setInjectedKeys(handshake.keys);

  lines.on('line', (line) => {
    try {
      const update = JSON.parse(line) as { keys?: unknown };
      if (update.keys && typeof update.keys === 'object') {
        setInjectedKeys(update.keys as Record<string, unknown>);
        console.log('[sidecar] keys updated');
      }
    } catch {
      console.warn('[sidecar] ignored a stdin line that is not JSON');
    }
  });
  lines.on('close', () => stop('stdin closed'));

  const { startServer, shutdownServer } = await import('./index.js');
  const { DataFolderLocked } = await import('./dataLock.js');
  const { appVersion } = await import('./appInfo.js');

  let stopping = false;
  stop = (why) => {
    if (stopping) return;
    stopping = true;
    console.log(`[sidecar] stopping: ${why}`);
    setTimeout(() => {
      console.error('[sidecar] clean stop took too long; exiting');
      process.exit(0);
    }, SHUTDOWN_GRACE_MS).unref();
    shutdownServer()
      .catch((err) => console.error('[sidecar] stop failed:', err))
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  setInterval(() => {
    if (process.ppid === 1) stop('the app that started this server has gone');
  }, PARENT_CHECK_MS).unref();

  let port: number;
  try {
    port = await startServer(0);
  } catch (err) {
    if (err instanceof DataFolderLocked) fail('locked', err.message, 3);
    fail('start', err instanceof Error ? err.message : String(err), 1);
  }
  // stdin closed or a signal arrived while starting: the stop is already under way
  if (stopping) return;
  process.stdout.write(`${READY_PREFIX}${JSON.stringify({ port, pid: process.pid, version: appVersion() })}\n`);
}

main().catch((err) => fail('start', err instanceof Error ? err.message : String(err), 1));
