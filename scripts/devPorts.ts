/**
 * The two ports `npm run dev` uses, decided once and read by both halves.
 *
 *   web  — Vite, the page you open. Takes the conventional `PORT` when a tool hands
 *          one over (a preview harness, a hosting shell), else 5173.
 *   api  — the Express server Vite proxies `/api` to. Always its own port, 5178 unless
 *          `OOTP_FO_API_PORT` says otherwise, and NEVER `PORT`.
 *
 * The server used to read `PORT` for itself, so a tool that exported `PORT=5173` to
 * the whole `npm run dev` process started the API and Vite on the same number: the
 * API answered on Vite's port, Vite's proxy pointed at 5178 where nothing listened,
 * and every `/api` call failed with a proxy error. Production (`npm start`) keeps
 * honoring `PORT` — there is one process there, so nothing can collide.
 *
 * Pure so a test can pin it; no I/O and no imports.
 */

export const DEFAULT_WEB_PORT = 5173;
export const DEFAULT_API_PORT = 5178;

export interface DevPorts {
  web: number;
  api: number;
}

const asPort = (raw: string | undefined): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
};

export function resolveDevPorts(env: Record<string, string | undefined>): DevPorts {
  const web = asPort(env.PORT) ?? DEFAULT_WEB_PORT;
  let api = asPort(env.OOTP_FO_API_PORT) ?? DEFAULT_API_PORT;
  // Two listeners cannot share a port, whatever was asked for
  if (api === web) api = web + 1;
  return { web, api };
}
