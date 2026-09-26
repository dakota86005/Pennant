import { Router, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadConfig } from './config.js';
import {
  DEFAULT_MODEL, PROVIDERS, isProviderId, providerFor, type ProviderId, type ProviderInfo,
} from './providers.js';
import { forgetUnusable } from './unusable.js';
import { startWatcher, stopWatcher } from './watcher.js';
import {
  PHILOSOPHY_DIMENSIONS,
  PHILOSOPHY_POLICY_OPTIONS,
  mergePhilosophyProfile,
  normalizePhilosophyProfile,
  resolvePhilosophy,
  type PhilosophyProfile,
} from './philosophy.js';
import type { Integer } from './contract/primitives.js';
import { currentOrganization, type CurrentOrganization } from './viewingOrganization.js';

export const AI_FEATURES = ['briefing', 'trade', 'storylines', 'chat'] as const;
export type AiFeatureId = (typeof AI_FEATURES)[number];

export interface AiFeatureSettings {
  /** Override the global provider for this feature. */
  provider?: ProviderId;
  /** Override the resolved model for this feature. */
  model?: string;
}

export function isAiFeatureId(value: unknown): value is AiFeatureId {
  return (
    typeof value === 'string' &&
    (AI_FEATURES as readonly string[]).includes(value)
  );
}

/**
 * User preferences, plus the Anthropic API key.
 *
 * The key is a real secret, so it is never written in plain text when we can
 * avoid it: the desktop app hands us Electron's safeStorage, which encrypts
 * against the OS keychain (Keychain on macOS, DPAPI on Windows). Running from
 * source in a browser there is no keychain available, so the key falls back to
 * a 0600 file and the UI says so plainly rather than implying it is protected.
 */

export interface Settings {
  autoImport: boolean;
  useTeamColors: boolean;
  defaultOrgId: Integer | null;
  /** 'system' follows the OS setting and changes with it. */
  theme: 'system' | 'dark' | 'light';
  /** Model id used by every AI feature. See models.ts for the picker's list. */
  model: string;
  /**
   * Which service the AI features talk to. Anthropic unless changed — it is
   * what the app was built against and the only one the chat's tool loop and
   * prompt caching are native to.
   */
  provider: ProviderId;
  /**
   * The model chosen for each provider, remembered separately. Switching
   * provider would otherwise leave a model id the new one has never heard of.
   */
  models: Partial<Record<ProviderId, string>>;
  /**
   * Optional provider/model overrides for individual AI workloads.
   *
   * Missing entries inherit the global provider and that provider's selected
   * model, preserving the behaviour of existing settings files.
   */
  aiFeatures: Partial<Record<AiFeatureId, AiFeatureSettings>>;
  /**
   * Write overall and potential in fives, the way scouts talk. Display only —
   * sorting and every calculation keep the exact grade.
   */
  roundRatingsToFive: boolean;
  /**
   * Keep pitchers on the injured list in the bullpen table.
   *
   * Off unless asked for. That page answers one question — who can throw
   * tonight — and a man six weeks from a rehab start is not an answer to it.
   * Nothing vanishes quietly: the heading says how many are being held back
   * and hands them over in a click.
   */
  showUnavailablePitchers: boolean;
  /**
   * Write the storylines and the briefing by themselves after each import.
   *
   * Off unless asked for. Both cost money on someone else's API key, and a
   * setting that quietly spends it would be a poor default however convenient.
   */
  autoGenerateAfterImport: boolean;
  /**
   * What you expect the owner to hand you next season, per club, in dollars.
   *
   * OOTP does not publish a future budget — it is not set until the offseason —
   * so future headroom had to assume this year's holds flat. On a club whose
   * budget swings, that is the wrong number to plan against, and you are the
   * one who knows which way the owner leans. Absent an entry, flat it stays.
   */
  nextSeasonBudget: Record<string, number>;

  /**
   * Organizational philosophy is saved per club. The string key is the OOTP
   * organization/team id so different clubs and saves may think differently.
   */
  organizationPhilosophies: Record<string, PhilosophyProfile>;
}

const DEFAULTS: Settings = {
  provider: 'anthropic',
  models: {},
  aiFeatures: {},
  autoImport: true,
  useTeamColors: true,
  nextSeasonBudget: {},
  organizationPhilosophies: {},
  roundRatingsToFive: false,
  showUnavailablePitchers: false,
  autoGenerateAfterImport: false,
  defaultOrgId: null,
  theme: 'system',
  model: 'claude-opus-5',
};

/** Which service the AI features talk to. */
export function activeProvider(): ProviderId {
  const chosen: unknown = loadSettings().provider;
  return isProviderId(chosen) ? chosen : DEFAULTS.provider;
}

/**
 * The globally selected model for whichever provider is active.
 *
 * Feature-specific callers should use featureModel() below. Keeping this
 * resolver preserves the existing global default and backwards compatibility.
 *
 * A hand-edited or truncated settings.json can put anything here, and every AI
 * feature would fail on it — fall back rather than throw. The legacy top-level
 * "model" is still honoured for Anthropic, so an existing choice survives.
 */
export function aiModel(provider: ProviderId = activeProvider()): string {
  const settings = loadSettings();
  const perProvider: unknown = settings.models?.[provider];
  if (typeof perProvider === 'string' && perProvider.trim()) return perProvider.trim();
  if (provider === 'anthropic') {
    const legacy: unknown = settings.model;
    if (typeof legacy === 'string' && legacy.trim()) return legacy.trim();
  }
  return DEFAULT_MODEL[provider];
}

/**
 * Resolve the provider for one AI workload.
 *
 * No override means exactly what the application did before this feature was
 * added: use the globally selected provider.
 */
export function featureProvider(feature: AiFeatureId): ProviderId {
  const chosen: unknown = loadSettings().aiFeatures?.[feature]?.provider;
  return isProviderId(chosen) ? chosen : activeProvider();
}

/**
 * Resolve the model for one AI workload.
 *
 * A feature-level model wins. Otherwise use the model already remembered for
 * the resolved provider, including the legacy Anthropic setting.
 */
export function featureModel(feature: AiFeatureId): string {
  const selected: unknown = loadSettings().aiFeatures?.[feature]?.model;
  if (typeof selected === 'string' && selected.trim()) return selected.trim();
  return aiModel(featureProvider(feature));
}

const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const KEY_PATH = path.join(DATA_DIR, 'credentials.json');

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeSettings(next: Settings): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
}

/** The normalized philosophy currently attached to one organization. */
export function philosophyForOrg(orgId: number): PhilosophyProfile {
  const stored = loadSettings().organizationPhilosophies?.[String(orgId)];
  return normalizePhilosophyProfile(stored);
}

// ── Secret storage ──────────────────────────────────────────────────────

interface SecretCrypto {
  /**
   * Whether OS-backed encryption works. On macOS this reaches into the
   * Keychain, which can raise a password prompt — so it must only be called
   * when a secret is actually being written or read, never on startup.
   */
  available(): boolean;
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
  label: string;
}
let crypto: SecretCrypto | null = null;

/** Called by the Electron main process at startup with safeStorage. */
export function setSecretCrypto(impl: SecretCrypto): void {
  crypto = impl;
}

/**
 * Keys handed over by the Mac app (D-055), which keeps them in the macOS Keychain and passes them to the sidecar
 * on stdin (`server/sidecar.ts`), never in an environment variable another process could read. Once set, this
 * server never writes a key to disk: a key saved in Settings is held here in memory, and the app stores it in the
 * Keychain itself. `null` (the Electron build and `npm run dev`) keeps the `credentials.json` file as before.
 */
let injected: Partial<Record<ProviderId, string>> | null = null;
let injectedLabel = 'your macOS Keychain';

/** Replaces every injected key at once (a provider left out has none). Called by the sidecar only. */
export function setInjectedKeys(keys: Partial<Record<string, unknown>>, label = injectedLabel): void {
  const next: Partial<Record<ProviderId, string>> = {};
  for (const [id, value] of Object.entries(keys)) {
    if (isProviderId(id) && typeof value === 'string' && value.trim()) next[id] = value.trim();
  }
  injected = next;
  injectedLabel = label;
}

/** Resolves the crypto only when there is a secret to protect. */
function activeCrypto(): SecretCrypto | null {
  if (!crypto) return null;
  try {
    return crypto.available() ? crypto : null;
  } catch {
    return null;
  }
}

interface StoredKey {
  encrypted: boolean;
  value: string;
  /** Last four characters, so the UI can show which key is saved. */
  hint: string;
}

/**
 * Where each provider's key lives.
 *
 * The file used to hold one key, from when there was only one provider. That
 * shape is still read and moved under "anthropic" the first time a key is
 * touched, so nobody has to re-enter a key they already saved.
 */
type KeyFile = Partial<Record<ProviderId, StoredKey>>;

/** The environment variable each provider honours, as its own SDK names it. */
const ENV_VAR: Partial<Record<ProviderId, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  opencode: 'OPENCODE_API_KEY',
};

function readKeyFile(): KeyFile {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object') return {};
  // The old one-key file, recognised by having a value at the top level
  if ('value' in (raw as Record<string, unknown>)) return { anthropic: raw as StoredKey };
  return raw as KeyFile;
}

function writeKeyFile(next: KeyFile): void {
  fs.writeFileSync(KEY_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
}

export function saveApiKey(key: string, provider: ProviderId = 'anthropic'): void {
  const trimmed = key.trim();
  if (injected) {
    injected = { ...injected, [provider]: trimmed };
    return;
  }
  const active = activeCrypto();
  const record: StoredKey = active
    ? { encrypted: true, value: active.encrypt(trimmed), hint: trimmed.slice(-4) }
    : { encrypted: false, value: trimmed, hint: trimmed.slice(-4) };
  writeKeyFile({ ...readKeyFile(), [provider]: record });
}

export function clearApiKey(provider: ProviderId = 'anthropic'): void {
  if (injected) {
    const { [provider]: _removed, ...rest } = injected;
    injected = rest;
    return;
  }
  const next = readKeyFile();
  delete next[provider];
  writeKeyFile(next);
}

function decrypt(stored: StoredKey): string | null {
  if (!stored.encrypted) return stored.value;
  try {
    const active = activeCrypto();
    return active ? active.decrypt(stored.value) : null;
  } catch {
    // Encrypted on another machine or by another user account
    return null;
  }
}

/**
 * The key a provider should use. An environment variable still wins, so anyone
 * already using a .env file keeps working exactly as before.
 */
export function getApiKey(provider: ProviderId = activeProvider()): string | null {
  const envVar = ENV_VAR[provider];
  const fromEnv = envVar ? process.env[envVar] : undefined;
  if (fromEnv) return fromEnv;
  if (injected) return injected[provider] ?? null;
  const stored = readKeyFile()[provider];
  return stored ? decrypt(stored) : null;
}

/**
 * Credential used when invoking a provider.
 *
 * Cloud providers return their real API key. Keyless local providers receive
 * an internal sentinel so existing readiness checks can remain truthy without
 * storing or exposing a fake API key.
 */
export function providerCredential(
  provider: ProviderId = activeProvider()
): string | null {
  const info = PROVIDERS.find((p) => p.id === provider);
  return info?.requiresKey === false ? 'local-provider' : getApiKey(provider);
}

export interface KeyStatus {
  configured: boolean;
  /** `keychain`: handed over by the Mac app from the macOS Keychain. */
  source: 'env' | 'stored' | 'keychain' | null;
  /** Where the key comes from, in words ("From the Keychain"); null when there is no key. */
  sourceText: string | null;
  hint: string | null;
  encrypted: boolean;
}

/** Where a key comes from, in words (the Mac app's Settings shows it). */
const KEY_SOURCE_WORDS: Record<NonNullable<KeyStatus['source']>, string> = {
  keychain: 'From the Keychain',
  env: 'From the environment',
  stored: 'Saved in the data folder',
};

const keyStatus = (status: Omit<KeyStatus, 'sourceText'>): KeyStatus => ({
  configured: status.configured,
  source: status.source,
  sourceText: status.source ? KEY_SOURCE_WORDS[status.source] : null,
  hint: status.hint,
  encrypted: status.encrypted,
});

/** The active provider's key state, with where keys are kept (`GET /api/settings`). */
export interface ApiKeyStatus extends KeyStatus {
  storageLabel: string;
}

export function apiKeyStatus(provider: ProviderId = activeProvider()): ApiKeyStatus {
  const storageLabel = injected ? injectedLabel : crypto ? crypto.label : 'a permission-restricted file (no OS keychain available)';
  return { ...statusOf(provider), storageLabel };
}

function statusOf(provider: ProviderId): KeyStatus {
  const envVar = ENV_VAR[provider];
  const fromEnv = envVar ? process.env[envVar] : undefined;
  if (fromEnv) {
    return keyStatus({ configured: true, source: 'env', hint: fromEnv.slice(-4), encrypted: false });
  }
  if (injected) {
    const key = injected[provider];
    return key
      ? keyStatus({ configured: true, source: 'keychain', hint: key.slice(-4), encrypted: true })
      : keyStatus({ configured: false, source: null, hint: null, encrypted: false });
  }
  const stored = readKeyFile()[provider];
  if (stored) {
    return keyStatus({ configured: true, source: 'stored', hint: stored.hint, encrypted: stored.encrypted });
  }
  return keyStatus({ configured: false, source: null, hint: null, encrypted: false });
}

/** Every provider's key state at once, for the Settings screen. */
export function allKeyStatus(): Record<ProviderId, KeyStatus> {
  return Object.fromEntries(PROVIDERS.map((p) => [p.id, statusOf(p.id)])) as Record<ProviderId, KeyStatus>;
}

// ── Routes ──────────────────────────────────────────────────────────────

/** What `GET /api/settings` serves. */
export interface SettingsResponse {
  settings: Settings;
  apiKey: ApiKeyStatus;
  dataDir: string;
  /** The club the app is about: the configured organization, else the human-managed one (`viewingOrganization.ts`). */
  organization: CurrentOrganization | null;
}

/** A provider on offer, with the model it would use (`GET /api/settings/providers`). */
export interface ProviderChoice extends ProviderInfo {
  model: string;
}

/** What `GET /api/settings/providers` serves: the providers on offer and every provider's key state. */
export interface ProvidersResponse {
  providers: ProviderChoice[];
  keys: Record<ProviderId, KeyStatus>;
}

export const settingsRoutes = Router();

settingsRoutes.get('/settings', (_req, res: Response<SettingsResponse>) => {
  res.json({ settings: loadSettings(), apiKey: apiKeyStatus(), dataDir: DATA_DIR, organization: currentOrganization() });
});

/**
 * Organizational philosophy for one club.
 *
 * Metadata travels with the response so the eventual UI does not duplicate
 * slider labels, endpoint meanings, or policy choices.
 */
settingsRoutes.get('/settings/philosophy/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!Number.isFinite(orgId) || orgId <= 0) {
    return res.status(400).json({ error: 'Invalid organization id.' });
  }

  const profile = philosophyForOrg(orgId);

  res.json({
    orgId,
    profile,
    effective: resolvePhilosophy(profile),
    dimensions: PHILOSOPHY_DIMENSIONS,
    policyOptions: PHILOSOPHY_POLICY_OPTIONS,
  });
});

settingsRoutes.put('/settings/philosophy/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!Number.isFinite(orgId) || orgId <= 0) {
    return res.status(400).json({ error: 'Invalid organization id.' });
  }

  const current = loadSettings();
  const profile = mergePhilosophyProfile(
    philosophyForOrg(orgId),
    req.body
  );

  writeSettings({
    ...current,
    organizationPhilosophies: {
      ...current.organizationPhilosophies,
      [String(orgId)]: profile,
    },
  });

  res.json({
    orgId,
    profile,
    effective: resolvePhilosophy(profile),
    dimensions: PHILOSOPHY_DIMENSIONS,
    policyOptions: PHILOSOPHY_POLICY_OPTIONS,
  });
});

settingsRoutes.delete('/settings/philosophy/:orgId', (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!Number.isFinite(orgId) || orgId <= 0) {
    return res.status(400).json({ error: 'Invalid organization id.' });
  }

  const current = loadSettings();
  const next = { ...current.organizationPhilosophies };
  delete next[String(orgId)];

  writeSettings({
    ...current,
    organizationPhilosophies: next,
  });

  const profile = philosophyForOrg(orgId);

  res.json({
    orgId,
    profile,
    effective: resolvePhilosophy(profile),
    dimensions: PHILOSOPHY_DIMENSIONS,
    policyOptions: PHILOSOPHY_POLICY_OPTIONS,
  });
});

/**
 * The budget you expect next season for one club. Zero or null clears it and
 * returns that club to assuming this year's budget holds flat.
 */
settingsRoutes.put('/next-season-budget/:orgId', (req, res) => {
  const orgId = String(Number(req.params.orgId));
  const raw = (req.body as { amount?: unknown }).amount;
  const amount = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
  const current = loadSettings();
  const next = { ...current.nextSeasonBudget };
  if (amount === null) delete next[orgId];
  else next[orgId] = amount;
  writeSettings({ ...current, nextSeasonBudget: next });
  res.json({ ok: true, nextSeasonBudget: amount });
});

/**
 * What `POST /api/settings` takes: the preferences to change. A field left out keeps its value, and a value the
 * handler cannot use is ignored. (Philosophy and next season's budget have routes of their own.)
 *
 * `clubChoice: 'automatic'` forgets the chosen club, so the app follows the club the save's human manages
 * (`viewingOrganization.ts`). It is the Mac app's way back to automatic: its generated client never sends an explicit
 * null, so it cannot clear `defaultOrgId` by sending one (SWIFTUI_REBUILD.md section 4.3). It wins over a `defaultOrgId`
 * sent beside it.
 */
export type SettingsUpdate = SettingsFields & {
  clubChoice?: 'automatic';
};

type SettingsFields = Partial<
  Pick<
    Settings,
    | 'autoImport'
    | 'useTeamColors'
    | 'roundRatingsToFive'
    | 'showUnavailablePitchers'
    | 'autoGenerateAfterImport'
    | 'defaultOrgId'
    | 'theme'
    | 'provider'
    | 'model'
    | 'models'
    | 'aiFeatures'
  >
>;

/** What `POST /api/settings` answers: the preferences as saved. */
export interface SettingsSaved {
  ok: true;
  settings: Settings;
}

settingsRoutes.post('/settings', (req, res: Response<SettingsSaved>) => {
  const body = req.body as SettingsUpdate;
  const previous = loadSettings();
  const next: Settings = { ...previous };
  /*
   * Every boolean setting, taken from the defaults rather than listed here.
   *
   * They used to be copied across one line at a time, and the two toggles
   * added after that was written were simply left out — the request answered
   * 200, the switch stayed on until the page was reloaded, and the setting was
   * never written at all. Reading the names from DEFAULTS means a new toggle
   * is saved the moment it is declared.
   */
  for (const field of Object.keys(DEFAULTS) as Array<keyof Settings>) {
    const value = (body as Partial<Settings>)[field];
    if (typeof DEFAULTS[field] === 'boolean' && typeof value === 'boolean') {
      (next[field] as boolean) = value;
    }
  }
  if (body.defaultOrgId === null || typeof body.defaultOrgId === 'number') {
    next.defaultOrgId = body.defaultOrgId;
  }
  if (body.clubChoice === 'automatic') next.defaultOrgId = null;
  if (body.theme === 'system' || body.theme === 'dark' || body.theme === 'light') {
    next.theme = body.theme;
  }
  if (isProviderId(body.provider)) next.provider = body.provider;
  // Model ids are validated by shape only. The catalogue comes from the API and
  // grows over time, so refusing anything not on today's list would block a
  // model released after this build shipped — the API rejects a bad id anyway.
  const modelShape = /^[a-z0-9._:/-]{3,128}$/i;
  if (typeof body.model === 'string' && modelShape.test(body.model.trim())) {
    // Sent without a provider, this means "the one I am using"
    next.models = { ...next.models, [next.provider]: body.model.trim() };
    if (next.provider === 'anthropic') next.model = body.model.trim();
  }
  if (body.models && typeof body.models === 'object') {
    const models = { ...next.models };
    for (const [id, value] of Object.entries(body.models)) {
      if (isProviderId(id) && typeof value === 'string' && modelShape.test(value.trim())) {
        models[id] = value.trim();
      }
    }
    next.models = models;
  }

  if (body.aiFeatures && typeof body.aiFeatures === 'object') {
    const features = { ...next.aiFeatures };

    for (const [id, raw] of Object.entries(
      body.aiFeatures as Record<string, unknown>
    )) {
      if (!isAiFeatureId(id) || typeof raw !== 'object' || raw === null) continue;

      const candidate = raw as {
        provider?: unknown;
        model?: unknown;
      };
      const override: AiFeatureSettings = {};

      if (isProviderId(candidate.provider)) {
        override.provider = candidate.provider;
      }

      if (
        typeof candidate.model === 'string' &&
        modelShape.test(candidate.model.trim())
      ) {
        override.model = candidate.model.trim();
      }

      if (override.provider || override.model) {
        features[id] = override;
      } else {
        delete features[id];
      }
    }

    next.aiFeatures = features;
  }

  writeSettings(next);

  // Take the auto-import toggle into effect immediately, not on next launch
  if (next.autoImport !== previous.autoImport) {
    const { csvDir } = loadConfig();
    if (next.autoImport && csvDir) startWatcher(csvDir);
    else if (!next.autoImport) stopWatcher();
  }
  res.json({ ok: true, settings: next });
});

/** Which key each provider expects, so a pasted one can be checked early. */
const KEY_SHAPE: Partial<Record<ProviderId, { test: RegExp; hint: string }>> = {
  anthropic: { test: /^sk-ant-/, hint: 'Anthropic keys begin with "sk-ant-".' },
  openai: { test: /^sk-/, hint: 'OpenAI keys begin with "sk-".' },
  // Google's are a plain token with no prefix worth checking beyond length
  gemini: { test: /^.{20,}$/, hint: 'That looks too short for a Gemini key.' },
  /*
   * Zen does not document a prefix, so nothing is asserted about one. A guess
   * here would reject a perfectly good key and the user would have no way to
   * tell it was this check rather than the service — and the key is validated
   * against the API a line later anyway, which is the test that matters.
   */
  opencode: { test: /^.{16,}$/, hint: 'That looks too short for an OpenCode Zen key.' },
};

/** Verifies a key against the API before saving, so a typo is caught here. */
settingsRoutes.post('/settings/api-key', async (req, res) => {
  const { key, provider: raw } = req.body as { key?: string; provider?: string };
  const provider: ProviderId = isProviderId(raw) ? raw : 'anthropic';
  if (!key?.trim()) return res.status(400).json({ ok: false, error: 'Enter a key first.' });
  const candidate = key.trim();
  const shape = KEY_SHAPE[provider];
  if (!shape) {
    return res.status(400).json({
      ok: false,
      error: `${provider} does not use an API key.`,
    });
  }
  if (!shape.test.test(candidate)) {
    return res.status(400).json({
      ok: false,
      error: `That does not look right — ${shape.hint}`,
    });
  }
  try {
    // A models list is the cheapest call that proves the key works
    await providerFor(provider).validateKey(candidate);
  } catch (err) {
    const e = err as Error & { status?: number };
    if (e.status === 401 || e.status === 403) {
      return res.status(400).json({ ok: false, error: 'The API rejected that key. Check it and try again.' });
    }
    return res.status(400).json({ ok: false, error: `Could not verify the key: ${e.message}` });
  }
  saveApiKey(candidate, provider);
  // A new key may well be able to run what the old one refused, which is one
  // of the reasons somebody changes key in the first place
  forgetUnusable(provider);
  res.json({ ok: true, apiKey: apiKeyStatus(), keys: allKeyStatus() });
});

settingsRoutes.delete('/settings/api-key', (req, res) => {
  const raw = (req.query.provider ?? req.body?.provider) as string | undefined;
  clearApiKey(isProviderId(raw) ? raw : 'anthropic');
  res.json({ ok: true, apiKey: apiKeyStatus(), keys: allKeyStatus() });
});

/** The choice on offer, so the Settings screen does not hard-code the list. */
settingsRoutes.get('/settings/providers', (_req, res: Response<ProvidersResponse>) => {
  res.json({
    // Each provider's resolved model travels with it, so a provider that has
    // never been chosen still shows what it would use rather than a blank
    providers: PROVIDERS.map((p) => ({ ...p, model: aiModel(p.id) })),
    keys: allKeyStatus(),
  });
});
