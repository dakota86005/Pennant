import { useCallback, useEffect, useRef, useState } from 'react';
import { desktopBridge, getDataStatus, isStaticSite, setSaveSource, type DataStatus } from './api';
import { LEVEL_LABEL, statusRows } from './dataStatusModel';

/** One request at a time: mount, a changed key and focus can all ask at once. */
let inflight: Promise<DataStatus | null> | null = null;

/**
 * Loads data status, and reloads it when a new import lands, when the window
 * regains focus, and once a minute. The server answers from a cache keyed on
 * the source files, so this is cheap.
 */
export function useDataStatus(refreshKey: string | null): DataStatus | null {
  const [data, setData] = useState<DataStatus | null>(null);
  // `fresh` is for a new import: a request already under way began before it
  const load = useCallback((fresh = false) => {
    if (isStaticSite()) return;
    if (fresh) inflight = null;
    if (!inflight) {
      const request: Promise<DataStatus | null> = getDataStatus().catch(() => null);
      inflight = request;
      void request.finally(() => {
        if (inflight === request) inflight = null;
      });
    }
    void inflight.then(setData);
  }, []);
  useEffect(() => {
    load(true);
  }, [load, refreshKey]);
  useEffect(() => {
    if (isStaticSite()) return;
    const poll = () => load();
    const timer = setInterval(poll, 60_000);
    window.addEventListener('focus', poll);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', poll);
    };
  }, [load]);
  return data;
}

/**
 * Shown only when the save could not be derived from the export's location.
 * Normal use never sees it: nothing needs choosing when discovery works.
 */
function SaveFolderFallback({ onStatus }: { onStatus: (s: DataStatus) => void }) {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = desktopBridge();

  const use = async (candidate: string) => {
    if (!candidate.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onStatus((await setSaveSource(candidate)).status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const browse = async () => {
    const picked = await desktop?.selectFolder(path || undefined);
    if (picked) {
      setPath(picked);
      void use(picked);
    }
  };

  return (
    <div className="data-status-fallback">
      <label className="data-status-note" htmlFor="save-folder">
        If you know where it is, choose the save's <code>.lg</code> folder:
      </label>
      <div className="data-status-fallback-row">
        <input
          id="save-folder"
          value={path}
          placeholder="…/saved_games/My Save.lg"
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void use(path)}
        />
        {desktop && <button onClick={browse} disabled={busy}>Browse…</button>}
        <button onClick={() => void use(path)} disabled={busy || !path.trim()}>Use</button>
      </div>
      {error && <p className="data-status-note error">{error}</p>}
    </div>
  );
}

/** Compact persistent indicator; opens a short panel of what each source says. */
export function DataStatusChip({ data: loaded }: { data: DataStatus | null }) {
  const [open, setOpen] = useState(false);
  // A folder chosen by hand answers with the new status; show it until the next load
  const [chosen, setChosen] = useState<DataStatus | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const data = chosen ?? loaded;
  useEffect(() => setChosen(null), [loaded]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!data) return null;
  const level = data.freshness.level;
  const rows = statusRows(data);

  return (
    <div className="data-status" ref={box}>
      <button
        className={`data-status-chip level-${level}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={data.freshness.headline}
      >
        <span className="data-status-dot" aria-hidden />
        Roster data: {LEVEL_LABEL[level]}
      </button>
      {open && (
        <div className="data-status-panel" role="dialog" aria-label="Data status">
          <div className="data-status-title">{data.save.name ?? 'No save selected'}</div>
          <dl className="data-status-rows">
            {rows.map((r) => (
              <div key={r.label} className="data-status-row">
                <dt>{r.label}</dt>
                <dd className={`tone-${r.tone}`}>{r.value}</dd>
              </div>
            ))}
          </dl>
          {data.freshness.action && <p className="data-status-action">{data.freshness.action}</p>}
          {data.freshness.reasons.map((r) => (
            <p key={r} className="data-status-note">{r}</p>
          ))}
          <p className="data-status-note">
            {data.save.found
              ? `Save found automatically${
                  data.save.discovery === 'manual_override' ? ' (folder chosen by hand)' : ' from your export'
                }.`
              : 'Pennant could not locate the OOTP save folder for this export, so transaction history is unavailable. Everything else keeps working from the CSV.'}
          </p>
          {data.transactionLog.error && (
            <p className="data-status-note">{data.transactionLog.error.message}</p>
          )}
          {!data.save.found && !isStaticSite() && <SaveFolderFallback onStatus={setChosen} />}
        </div>
      )}
    </div>
  );
}

/** The action-oriented message for a snapshot that is behind the save. */
export function DataStatusBanner({ data }: { data: DataStatus | null }) {
  if (!data || data.freshness.level !== 'stale' || !data.freshness.action) return null;
  return (
    <div className="banner data-stale" role="status">
      <span>{data.freshness.action}</span>
    </div>
  );
}
