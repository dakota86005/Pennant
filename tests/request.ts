import type { AddressInfo } from 'node:net';
import { serverApp } from '../server/serverApp.js';

/**
 * Exercises the endpoints through HTTP rather than calling handlers directly,
 * so a test covers the route, the query and the JSON shape the pages actually
 * receive — the layer where every bug in this suite lived. The app is
 * production's own request chain (`serverApp`: the Host and other-site checks,
 * the token where one is set, the bodies within their limits), never a copy of
 * it (B-75, SRVHEALTH-18).
 */
let base: string | null = null;

async function server(): Promise<string> {
  if (base) return base;
  const app = serverApp();
  const listening = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => listening.once('listening', resolve));
  const { port } = listening.address() as AddressInfo;
  process.env.OOTP_FO_PORT = String(port);
  base = `http://127.0.0.1:${port}`;
  return base;
}

export default async function request(path: string): Promise<any> {
  const res = await fetch(`${await server()}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

export async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${await server()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}
