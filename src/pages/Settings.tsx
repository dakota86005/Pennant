import { useEffect, useState } from 'react';
import {
  apiDelete, apiGet, apiPost, desktopBridge, exportStaticSite, getExportProgress, triggerImport,
  type ExportProgress, type Org, type SaveInfo, type SiteExportResult, type Status,
} from '../api';
import { FolderPicker } from '../FolderPicker';
import { UpdatePanel } from '../Updater';

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'opencode' | 'ollama';

export type AiFeatureId = 'briefing' | 'trade' | 'storylines' | 'chat';

interface AiFeatureSettings {
  provider?: ProviderId;
  model?: string;
}

const AI_FEATURE_OPTIONS: Array<{
  id: AiFeatureId;
  label: string;
  description: string;
}> = [
  {
    id: 'briefing',
    label: 'GM Briefing',
    description: 'Weekly organizational analysis and recommendations.',
  },
  {
    id: 'trade',
    label: 'Trade Analysis',
    description: 'Trade verdicts and follow-up discussion with the trade desk.',
  },
  {
    id: 'storylines',
    label: 'Storylines / Beat Writer',
    description: 'Generated club stories from the current save.',
  },
  {
    id: 'chat',
    label: 'Staff Chat',
    description: 'Peter and the staff-room tool-using chat.',
  },
];

interface ApiKeyStatus {
  configured: boolean;
  source: 'env' | 'stored' | 'keychain' | null;
  hint: string | null;
  encrypted: boolean;
  storageLabel?: string;
}
interface ProviderInfo {
  id: ProviderId;
  label: string;
  keyLabel: string;
  console: string;
  requiresKey: boolean;
  /** What this provider would use right now, chosen or defaulted. */
  model: string;
}
interface ProvidersResponse {
  providers: ProviderInfo[];
  keys: Record<ProviderId, ApiKeyStatus>;
}
export interface AppSettings {
  autoImport: boolean;
  useTeamColors: boolean;
  defaultOrgId: number | null;
  theme: 'system' | 'dark' | 'light';
  model: string;
  provider: ProviderId;
  models: Partial<Record<ProviderId, string>>;
  aiFeatures: Partial<Record<AiFeatureId, AiFeatureSettings>>;
  roundRatingsToFive: boolean;
  autoGenerateAfterImport: boolean;
}
interface SettingsResponse {
  settings: AppSettings;
  apiKey: ApiKeyStatus;
  dataDir: string;
}

/** The placeholder for each provider's key, so the field looks like the real thing. */
/** Named in the notice about an environment variable taking priority. */
const ENV_VAR: Partial<Record<ProviderId, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  opencode: 'OPENCODE_API_KEY',
};

const KEY_PLACEHOLDER: Partial<Record<ProviderId, string>> = {
  anthropic: 'sk-ant-…',
  openai: 'sk-…',
  gemini: 'AIza…',
  // Zen publishes no prefix, so nothing is implied about one
  opencode: 'Your Zen key',
};
interface ModelChoice {
  id: string;
  name: string;
  contextTokens: number | null;
  adaptiveThinking: boolean | null;
  /** Listed by the service but refused on this key when it was last tried. */
  unusable?: boolean;
}
interface ModelsResponse {
  models: ModelChoice[];
  /** False when the API could not be reached and this is the built-in short list. */
  live: boolean;
}

export function Settings({
  status, orgs, orgId, onSettingsChanged, onSaveChanged,
}: {
  status: Status;
  orgs: Org[];
  orgId: number | null;
  onSettingsChanged: (s: AppSettings) => void;
  onSaveChanged: (save: SaveInfo) => void;
}) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [modelsByProvider, setModelsByProvider] =
    useState<Partial<Record<ProviderId, ModelsResponse>>>({});
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMessage, setKeyMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [changingSave, setChangingSave] = useState(false);
  const [reimporting, setReimporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<SiteExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const desktop = desktopBridge();

  /** The default provider's list, also cached for feature routing below. */
  const loadModels = (provider?: ProviderId) => {
    const q = provider ? `?provider=${provider}` : '';
    apiGet<ModelsResponse>(`/api/models${q}`)
      .then((result) => {
        setModels(result);
        if (provider) {
          setModelsByProvider((current) => ({ ...current, [provider]: result }));
        }
      })
      .catch(() => {});
  };

  /** Fetch a model list without changing the default provider's picker. */
  const loadProviderModels = (provider: ProviderId) => {
    apiGet<ModelsResponse>(`/api/models?provider=${provider}`)
      .then((result) => {
        setModelsByProvider((current) => ({ ...current, [provider]: result }));
      })
      .catch(() => {});
  };

  const loadProviders = () => {
    apiGet<ProvidersResponse>('/api/settings/providers').then(setProviders).catch(() => {});
  };

  useEffect(() => {
    apiGet<SettingsResponse>('/api/settings').then((r) => {
      setData(r);
      loadModels(r.settings.provider);

      const featureProviders = new Set(
        Object.values(r.settings.aiFeatures ?? {})
          .map((feature) => feature?.provider)
          .filter((provider): provider is ProviderId => Boolean(provider))
      );
      featureProviders.forEach((provider) => {
        if (provider !== r.settings.provider) loadProviderModels(provider);
      });
    }).catch(() => {});
    loadProviders();
  }, []);

  const update = async (patch: Partial<AppSettings>) => {
    if (!data) return;
    const next = { ...data.settings, ...patch };
    setData({ ...data, settings: next });
    onSettingsChanged(next);
    await apiPost('/api/settings', patch);
  };

  const saveKey = async () => {
    if (!data) return;
    const provider = data.settings.provider;
    setKeyBusy(true);
    setKeyMessage(null);
    try {
      const r = await apiPost<{ ok: boolean; apiKey: ApiKeyStatus; keys: ProvidersResponse['keys'] }>(
        '/api/settings/api-key',
        { key: keyInput, provider }
      );
      setKeyInput('');
      setKeyMessage({ ok: true, text: 'Key verified and saved. The AI features are ready to use.' });
      setData({ ...data, apiKey: r.apiKey });
      if (providers) setProviders({ ...providers, keys: r.keys });
      // The real model list needs a working key, so fetch it again now there is one
      loadModels(provider);
    } catch (e) {
      setKeyMessage({ ok: false, text: (e as Error).message });
    } finally {
      setKeyBusy(false);
    }
  };

  const removeKey = async () => {
    if (!data) return;
    const provider = data.settings.provider;
    setKeyBusy(true);
    try {
      const r = await apiDelete<{ apiKey: ApiKeyStatus; keys: ProvidersResponse['keys'] }>(
        `/api/settings/api-key?provider=${provider}`
      );
      setData({ ...data, apiKey: r.apiKey });
      if (providers) setProviders({ ...providers, keys: r.keys });
      setKeyMessage({ ok: true, text: 'Key removed.' });
      loadModels(provider);
    } finally {
      setKeyBusy(false);
    }
  };

  /**
   * Switching service. Each remembers its own model, so this only changes
   * which one is in use — nothing is lost by looking at another and coming back.
   */
  const switchProvider = async (provider: ProviderId) => {
    if (!data) return;
    setKeyMessage(null);
    setKeyInput('');
    const next = { ...data.settings, provider };
    setData({ ...data, settings: next, apiKey: providers?.keys[provider] ?? data.apiKey });
    onSettingsChanged(next);
    setModels(null);
    await apiPost('/api/settings', { provider });
    loadModels(provider);
    // The status carries the storage label, which the per-provider list omits
    apiGet<SettingsResponse>('/api/settings').then(setData).catch(() => {});
  };

  const setFeatureProvider = async (
    feature: AiFeatureId,
    provider: ProviderId | null
  ) => {
    if (!data) return;

    const aiFeatures = {
      ...data.settings.aiFeatures,
      [feature]: provider ? { provider } : {},
    };

    const next = { ...data.settings, aiFeatures };
    setData({ ...data, settings: next });
    onSettingsChanged(next);

    await apiPost('/api/settings', {
      aiFeatures: {
        [feature]: provider ? { provider } : {},
      },
    });

    if (provider) loadProviderModels(provider);
  };

  const setFeatureModel = async (
    feature: AiFeatureId,
    provider: ProviderId,
    model: string | null
  ) => {
    if (!data) return;

    const override: AiFeatureSettings = model
      ? { provider, model }
      : { provider };

    const aiFeatures = {
      ...data.settings.aiFeatures,
      [feature]: override,
    };

    const next = { ...data.settings, aiFeatures };
    setData({ ...data, settings: next });
    onSettingsChanged(next);

    await apiPost('/api/settings', {
      aiFeatures: {
        [feature]: override,
      },
    });
  };

  const runExport = async () => {
    if (orgId === null) return;
    setExporting(true);
    setExported(null);
    setExportError(null);
    setProgress(null);
    // The request does not return until the export finishes, so progress comes
    // from a second endpoint rather than leaving the button looking stuck
    const poll = setInterval(() => {
      getExportProgress()
        .then((p) => setProgress(p.running ? p : null))
        .catch(() => {});
    }, 600);
    try {
      setExported(await exportStaticSite(orgId));
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      clearInterval(poll);
      setProgress(null);
      setExporting(false);
    }
  };

  const reimport = async () => {
    setReimporting(true);
    try {
      await triggerImport();
      window.location.reload();
    } finally {
      setReimporting(false);
    }
  };

  if (!data) return <p className="muted">Loading settings…</p>;
  const { settings, apiKey } = data;
  const current = providers?.providers.find((p) => p.id === settings.provider);
  const requiresKey = current?.requiresKey !== false;
  const isOllama = settings.provider === 'ollama';
  // Falls back to what the server says this provider would use — a provider
  // never chosen before has no entry here, and a blank select is not an answer
  const activeModel = settings.models?.[settings.provider] ?? current?.model ?? '';

  return (
    <div className="settings">
      <section className="settings-block">
        <h2>AI Features</h2>
        <p className="muted hint-line">
          Storylines, the GM Briefing, and AI trade verdicts use the AI service selected below.
          Cloud services use your own API key; Ollama runs models locally without one.
        </p>

        <div className="settings-row">
          <div>
            <strong>Default service</strong>
            <div className="muted">
              Anthropic is what the app was originally built against. OpenAI, Gemini, and
              OpenCode Zen provide cloud alternatives. Ollama runs compatible models directly on
              this computer, with no API key or per-generation charge.
            </div>
          </div>
          <select
            value={settings.provider}
            onChange={(e) => void switchProvider(e.target.value as ProviderId)}
          >
            {(providers?.providers ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {providers?.keys[p.id]?.configured ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </div>

        {requiresKey ? (
          <>
            {apiKey.configured ? (
              <div className="key-state">
                <span className="badge promote">Key saved</span>
                <span className="muted">
                  ending in <code>…{apiKey.hint}</code>
                  {apiKey.source === 'env'
                    ? ` — coming from a ${ENV_VAR[settings.provider] ?? 'provider'} environment variable, which takes priority over anything set here.`
                    : apiKey.encrypted
                      ? ` — encrypted with ${apiKey.storageLabel}.`
                      : ` — stored in ${apiKey.storageLabel}.`}
                </span>
                {apiKey.source !== 'env' && (
                  <button onClick={removeKey} disabled={keyBusy}>Remove key</button>
                )}
              </div>
            ) : (
              <p className="muted">
                No {current?.keyLabel ?? 'API key'} set — the AI features will explain this instead
                of failing.
              </p>
            )}

            {apiKey.source !== 'env' && (
              <div className="folder-row">
                <input
                  className="trade-search folder-input"
                  type="password"
                  placeholder={KEY_PLACEHOLDER[settings.provider] ?? ''}
                  value={keyInput}
                  autoComplete="off"
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && keyInput.trim() && void saveKey()}
                />
                <button
                  className="btn-feature"
                  onClick={saveKey}
                  disabled={keyBusy || !keyInput.trim()}
                >
                  {keyBusy ? 'Verifying…' : apiKey.configured ? 'Replace key' : 'Verify and save'}
                </button>
              </div>
            )}

            {keyMessage && (
              <div className={`banner ${keyMessage.ok ? 'success' : 'error'}`}>
                {keyMessage.text}
              </div>
            )}

            <p className="muted hint-line">
              Get your {current?.keyLabel ?? 'API key'} at{' '}
              <a href={`https://${current?.console ?? ''}`} target="_blank" rel="noreferrer">
                {current?.console}
              </a>. It is checked against the API before saving. Keys are kept per service, so
              switching providers does not remove the others.
            </p>
          </>
        ) : (
          <div className="key-state">
            <span className="badge promote">
              {models === null ? 'Checking…' : models.live ? 'Connected' : 'Offline'}
            </span>
            <span className="muted">
              {models === null
                ? 'Checking the local Ollama server.'
                : models.live
                  ? `Ollama is running locally and reported ${models.models.length} installed model${models.models.length === 1 ? '' : 's'}.`
                  : 'Could not reach Ollama. Start the Ollama service and refresh this page.'}
            </span>
          </div>
        )}

        <div className="settings-row">
          <div>
            <strong>Default model</strong>
            <div className="muted">
              Used by any AI feature that does not have an override below. Larger cloud models
              generally reason better and cost more; local models have no per-generation charge.
            </div>
            {models && !models.live && (
              <div className="muted">
                {isOllama
                  ? 'Showing the built-in fallback because the local Ollama server could not be reached.'
                  : 'Showing a short built-in list — add a key to read the current one from the API.'}
              </div>
            )}
            {models?.models.some((m) => m.id === activeModel && m.unusable) && (
              <div className="muted">
                This one was refused the last time it was tried, so generations run on another
                model and say so. Replacing the key clears this.
              </div>
            )}
          </div>
          <select
            value={activeModel}
            onChange={(e) => void update({
              model: e.target.value,
              models: { ...settings.models, [settings.provider]: e.target.value },
            })}
          >
            {/* A model saved earlier may no longer be listed; keep it selectable
                rather than silently snapping the user onto a different one */}
            {models && !models.models.some((m) => m.id === activeModel) && (
              <option value={activeModel}>{activeModel}</option>
            )}
            {/* Marked rather than removed: a model you chose should not
                quietly disappear, and knowing why is the point */}
            {(models?.models ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.unusable ? ' — not available on your key' : ''}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginTop: '1.5rem' }}>
          <h3>Feature routing</h3>
          <p className="muted hint-line">
            Leave a feature on Default to use the service and model above. Choose a service here
            only when this workload should use something different.
          </p>

          {AI_FEATURE_OPTIONS.map((feature) => {
            const override = settings.aiFeatures?.[feature.id] ?? {};
            const explicitProvider = override.provider;
            const resolvedProvider = explicitProvider ?? settings.provider;
            const providerInfo = providers?.providers.find((p) => p.id === resolvedProvider);
            const catalogue =
              modelsByProvider[resolvedProvider] ??
              (resolvedProvider === settings.provider ? models : null);

            const providerDefaultModel =
              settings.models?.[resolvedProvider] ??
              providerInfo?.model ??
              '';

            const resolvedModel = override.model ?? providerDefaultModel;
            const needsKey = providerInfo?.requiresKey !== false;
            const credentialReady =
              !needsKey || providers?.keys[resolvedProvider]?.configured === true;

            return (
              <div className="settings-row" key={feature.id}>
                <div>
                  <strong>{feature.label}</strong>
                  <div className="muted">{feature.description}</div>

                  {!credentialReady && (
                    <div className="muted">
                      This provider does not currently have an API key configured.
                    </div>
                  )}

                  {explicitProvider && catalogue && !catalogue.live && (
                    <div className="muted">
                      {resolvedProvider === 'ollama'
                        ? 'Ollama is offline; showing the built-in fallback model list.'
                        : 'Showing the built-in model list because the provider catalogue is unavailable.'}
                    </div>
                  )}
                </div>

                <div className="folder-row">
                  <select
                    value={explicitProvider ?? ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      void setFeatureProvider(
                        feature.id,
                        value ? (value as ProviderId) : null
                      );
                    }}
                  >
                    <option value="">
                      Default — {current?.label ?? settings.provider}
                    </option>
                    {(providers?.providers ?? []).map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </select>

                  {explicitProvider ? (
                    <select
                      value={override.model ?? ''}
                      onChange={(e) =>
                        void setFeatureModel(
                          feature.id,
                          explicitProvider,
                          e.target.value || null
                        )
                      }
                    >
                      <option value="">
                        Provider default — {providerDefaultModel || 'automatic'}
                      </option>

                      {(catalogue?.models ?? []).map((model) => (
                        <option
                          key={model.id}
                          value={model.id}
                          disabled={model.unusable}
                        >
                          {model.name}
                          {model.unusable ? ' — unavailable' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted">
                      {resolvedModel || 'Provider default'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

      </section>

      <section className="settings-block">
        <h2>Data</h2>
        <div className="settings-row">
          <div>
            <strong>Current save</strong>
            <div className="muted">{status.saveName ?? 'None selected'}</div>
            <div className="muted small-path">{status.csvDir ?? ''}</div>
          </div>
          <button onClick={() => setChangingSave((v) => !v)}>
            {changingSave ? 'Cancel' : 'Change save…'}
          </button>
        </div>

        {changingSave && (
          <FolderPicker
            onResolved={(save) => {
              setChangingSave(false);
              onSaveChanged(save);
            }}
          />
        )}

        <div className="settings-row">
          <div>
            <strong>Watch for new exports</strong>
            <div className="muted">
              Notice when OOTP writes a fresh export and offer to load it. Importing a full league
              takes a while, so the app asks rather than interrupting you.
            </div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.autoImport}
              onChange={(e) => void update({ autoImport: e.target.checked })}
            />
            <span>{settings.autoImport ? 'On' : 'Off'}</span>
          </label>
        </div>

        <div className="settings-row">
          <div>
            <strong>Data folder</strong>
            <div className="muted small-path">{data.dataDir}</div>
            <div className="muted">Holds the imported database, rating history, watchlist, and caches.</div>
          </div>
          <div className="settings-actions">
            {desktop && (
              <button onClick={() => void desktop.openPath(data.dataDir)}>Open folder</button>
            )}
            <button onClick={reimport} disabled={reimporting}>
              {reimporting ? 'Importing…' : 'Re-import now'}
            </button>
          </div>
        </div>
      </section>

      <section className="settings-block">
        <h2>Share</h2>
        <p className="muted hint-line">
          Writes your club&rsquo;s pages out as a plain website — a folder you can upload to any
          host so other people can browse your league. It is a snapshot of the current export
          rather than a live view, and it contains league data only: your API key and settings are
          never written into it.
        </p>
        <div className="settings-row">
          <div>
            <strong>Export as a website</strong>
            <div className="muted">
              The AI features, watchlist, player search and settings all need a running server, so
              they are left out of the exported copy.
            </div>
          </div>
          <button className="btn-feature" onClick={runExport} disabled={exporting || orgId === null}>
            {exporting ? 'Exporting…' : 'Export website'}
          </button>
        </div>
        {exporting && (
          <div className="settings-row">
            <div className="muted">
              {progress
                ? `${progress.phase}${progress.total ? ` — ${progress.done} of ${progress.total}` : '…'}`
                : 'Starting…'}
            </div>
          </div>
        )}
        {exportError && <div className="banner error">{exportError}</div>}
        {exported && (
          <div className="banner success">
            Wrote {exported.files} files ({(exported.bytes / 1024 / 1024).toFixed(1)} MB), including{' '}
            {exported.players} player cards.
            <div className="muted small-path">{exported.outDir}</div>
            {desktop && (
              <button onClick={() => void desktop.openPath(exported.outDir)}>Open folder</button>
            )}
            {exported.warnings.length > 0 && (
              <ul className="muted">
                {exported.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="settings-block">
        <h2>Display</h2>
        <div className="settings-row">
          <div>
            <strong>Use team colors</strong>
            <div className="muted">
              Theme the interface with the selected club's colors. Turn off for a neutral look.
            </div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.useTeamColors}
              onChange={(e) => void update({ useTeamColors: e.target.checked })}
            />
            <span>{settings.useTeamColors ? 'On' : 'Off'}</span>
          </label>
        </div>

        <div className="settings-row">
          <div>
            <strong>Write storylines and the briefing after each import</strong>
            <div className="muted">
              Both are generated in the background as soon as new data is read, so they are already
              waiting when you open the app. Off by default: each one costs money on your own API
              key, and nothing should spend it without being asked. Does nothing until a key is set.
            </div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.autoGenerateAfterImport}
              onChange={(e) => void update({ autoGenerateAfterImport: e.target.checked })}
            />
            <span>{settings.autoGenerateAfterImport ? 'On' : 'Off'}</span>
          </label>
        </div>

        <div className="settings-row">
          <div>
            <strong>Round overall and potential to fives</strong>
            <div className="muted">
              Scouting talks in fives — a man is a 55 or a 60, not a 57. Turn this on to read the
              grades that way. Display only: sorting and every calculation keep the exact number,
              so a 57 still ranks above a 56 when both are shown as 55.
            </div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.roundRatingsToFive}
              onChange={(e) => void update({ roundRatingsToFive: e.target.checked })}
            />
            <span>{settings.roundRatingsToFive ? 'On' : 'Off'}</span>
          </label>
        </div>

        <div className="settings-row">
          <div>
            <strong>Appearance</strong>
            <div className="muted">
              System follows your computer's setting and changes with it.
            </div>
          </div>
          <div className="tabs">
            {(['system', 'light', 'dark'] as const).map((m) => (
              <button
                key={m}
                className={settings.theme === m ? 'active' : ''}
                onClick={() => void update({ theme: m })}
              >
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <div>
            <strong>Organization to open with</strong>
            <div className="muted">Defaults to the club you manage in the save.</div>
          </div>
          <select
            value={settings.defaultOrgId ?? ''}
            onChange={(e) => void update({ defaultOrgId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Your club (automatic)</option>
            {orgs.map((o) => (
              <option key={o.team_id} value={o.team_id}>{o.label}</option>
            ))}
          </select>
        </div>
      </section>

      <UpdatePanel />
    </div>
  );
}
