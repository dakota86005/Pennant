import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveDevPorts } from './scripts/devPorts';

// `npm run dev` starts this and the API together; both read their ports from here
// so they cannot be given the same one (scripts/devPorts.ts).
const ports = resolveDevPorts(process.env);

export default defineConfig({
  plugins: [react()],
  server: {
    port: ports.web,
    // A busy port is an error worth seeing: silently moving to another one leaves
    // the address the developer, the docs and any preview tool expect dead.
    strictPort: true,
    proxy: {
      // `changeOrigin: false`, said outright: Vite's string shorthand turns it on, which rewrites the Host to the API's
      // own `127.0.0.1:<api>` while the browser's `Origin` stays `http://localhost:<web>`, and the server's other-site
      // check (`server/sameOrigin.ts`) then refuses every write the page makes (batch 7 review H1). Kept off, the API
      // sees the page's own Host, which matches its Origin and passes the loopback Host check
      '/api': { target: `http://127.0.0.1:${ports.api}`, changeOrigin: false },
    },
  },
});
