import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import type { ProviderId } from './providers.js';

/**
 * Models the service lists but will not run.
 *
 * Google's catalogue is not a list of models you may call — gemini-2.5-pro and
 * gemini-2.5-flash are both offered by it and both answer a real request with
 * 404 on a newer key. The app already recovers by asking a model that works,
 * but it was learning that lesson afresh every time: each set of storylines,
 * each briefing, each turn of a conversation paid for the doomed request first
 * and then paid again for the real one.
 *
 * So the refusal is remembered. It is written to disk rather than kept in
 * memory because the fact does not stop being true when the app is closed, and
 * a wasted call at every launch is the same waste on a slower schedule.
 *
 * Remembered against the key that was refused, not against the app. A model
 * unavailable on a new key may be perfectly available on an older one, and
 * somebody who changes keys to fix exactly this should not find the app still
 * refusing to try.
 */

export interface Unusable {
  model: string;
  /** Which key was refused, so another key starts with a clean slate. */
  keyFingerprint: string;
  reason: string;
  notedAt: string;
}

type Store = Partial<Record<ProviderId, Unusable[]>> & {
  /** This install's random salt for the fingerprints: no part of a key, and nothing that matches it elsewhere. */
  salt?: string;
};

const STORE_PATH = path.join(DATA_DIR, 'unusable-models.json');

/** The fingerprints' prefix: an entry without it is from an earlier build, which kept the key's last characters. */
const FINGERPRINT_PREFIX = 'hmac-sha256:';

/**
 * Identifies a key without storing any of it (B-101, SRVAI-17, SRVSTATS-26): a salted SHA-256 HMAC of the whole key,
 * with this install's own salt, so two keys never share a fingerprint by their ends and the file says nothing about
 * any key.
 */
export const fingerprint = (key: string, salt: string): string =>
  FINGERPRINT_PREFIX + createHmac('sha256', salt).update(key, 'utf8').digest('hex');

/** The store's entries for each provider, minus any an earlier build wrote with part of the key in it. */
function withoutLegacy(store: Store): { store: Store; dropped: boolean } {
  let dropped = false;
  const kept: Store = typeof store.salt === 'string' ? { salt: store.salt } : {};
  for (const [provider, entries] of Object.entries(store)) {
    if (provider === 'salt' || !Array.isArray(entries)) continue;
    const current = (entries as Unusable[]).filter((u) => typeof u?.keyFingerprint === 'string' && u.keyFingerprint.startsWith(FINGERPRINT_PREFIX));
    if (current.length !== entries.length) dropped = true;
    kept[provider as ProviderId] = current;
  }
  return { store: kept, dropped };
}

function read(): Store {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const { store, dropped } = withoutLegacy(parsed as Store);
  // An earlier build's file kept part of each key: it is rewritten without them the first time it is read
  if (dropped) write(store);
  return store;
}

/** This install's salt, made and kept the first time a fingerprint is needed. */
function saltOf(store: Store): string {
  if (typeof store.salt === 'string' && store.salt.length >= 32) return store.salt;
  store.salt = randomBytes(32).toString('hex');
  return store.salt;
}

function write(store: Store): void {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  } catch {
    // Losing this only costs a repeated wasted call, which is what the app did
    // before it existed — never worth failing a generation over
  }
}

export function markUnusable(
  provider: ProviderId,
  model: string,
  key: string,
  reason: string
): void {
  const store = read();
  const fp = fingerprint(key, saltOf(store));
  const existing = (store[provider] ?? []).filter(
    (u) => !(u.model === model && u.keyFingerprint === fp)
  );
  existing.push({ model, keyFingerprint: fp, reason, notedAt: new Date().toISOString() });
  store[provider] = existing;
  write(store);
}

export function isUnusable(provider: ProviderId, model: string, key: string): boolean {
  const store = read();
  if (typeof store.salt !== 'string') return false;
  const fp = fingerprint(key, store.salt);
  return (store[provider] ?? []).some((u) => u.model === model && u.keyFingerprint === fp);
}

/** Every model refused on the key currently in use, for the Settings picker. */
export function unusableModels(provider: ProviderId, key: string | null): string[] {
  if (!key) return [];
  const store = read();
  if (typeof store.salt !== 'string') return [];
  const fp = fingerprint(key, store.salt);
  return (store[provider] ?? []).filter((u) => u.keyFingerprint === fp).map((u) => u.model);
}

/**
 * Forgets everything recorded for a provider.
 *
 * Called when its key is replaced. The entries are already scoped to a
 * fingerprint so a stale one would never match, but leaving them to accumulate
 * against keys nobody holds any more serves no purpose.
 */
export function forgetUnusable(provider: ProviderId): void {
  const store = read();
  delete store[provider];
  write(store);
}
