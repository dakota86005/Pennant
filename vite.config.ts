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
      '/api': `http://127.0.0.1:${ports.api}`,
    },
  },
});
