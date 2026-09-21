/**
 * The API half of `npm run dev`: the ordinary server, pinned to the dev API port.
 *
 * `server/index.ts` starts itself on `PORT` when run directly, which is right for
 * `npm start` and wrong here (see devPorts.ts). This entry point overwrites `PORT`
 * before the server module loads so the watch process cannot land on Vite's port.
 */
import { resolveDevPorts } from './devPorts.js';

process.env.PORT = String(resolveDevPorts(process.env).api);
await import('../server/index.js');
