import type { ActionRights, PlayerRights } from './api';

/**
 * Reasons that only restate where the player already is. They are true, but a
 * GM reading a player card does not need "cannot option: he is in the minors".
 */
const STRUCTURAL = new Set([
  'not_on_major_league_club', 'not_on_active_roster', 'already_with_major_league_club', 'not_on_forty_man',
  'already_on_forty_man', 'not_designated', 'not_on_injured_list',
]);

const BASIS: Record<string, string> = {
  export_state: 'stated by the export',
  observed: 'observed in OOTP',
  documented: 'OOTP documentation',
  observed_and_documented: 'observed in OOTP and documented',
};

/** The actions worth showing: not a plain restatement of where he is. */
export function relevantActions(rights: PlayerRights): ActionRights[] {
  return Object.values(rights.actions).filter(
    (a) => a.status !== 'ineligible' || a.reasons.some((r) => !STRUCTURAL.has(r.code))
  );
}

const detail = (a: ActionRights): string =>
  [
    a.label,
    ...a.reasons.map((r) => `${r.message} (${BASIS[r.basis] ?? r.basis})`),
    ...a.requirements.filter((r) => r.status !== 'met').map((r) => r.message),
    ...a.missing.map((m) => `Missing: ${m.message}`),
    a.limitation,
  ].filter(Boolean).join('\n');

/** One action as a small mark; the full reasoning is in its tooltip. */
export function RightsChip({ action }: { action: ActionRights }) {
  return (
    <span className={`rights-chip ${action.status}`} title={detail(action)}>
      {action.label}
    </span>
  );
}

/**
 * The player card's statement of what can be done, with uncertainty shown as
 * uncertainty. When the export is behind the save it says so once instead of
 * repeating "unknown" for every action.
 */
export function RightsBlock({ rights }: { rights: PlayerRights | null | undefined }) {
  if (!rights) return null;
  const stale = rights.evidence.currentState === 'behind' || rights.evidence.currentState === 'unavailable';
  const actions = stale ? [] : relevantActions(rights);
  if (!stale && actions.length === 0) return null;
  return (
    <div className="rights-block">
      <div className="rights-block-title">Roster rights</div>
      {stale && (
        <div className="muted">
          {rights.actions.option.missing[0]?.message ?? 'Rights cannot be stated: roster data is not current.'}
        </div>
      )}
      {actions.map((a) => (
        <div key={a.action} className="rights-row" title={detail(a)}>
          <span className={`rights-dot ${a.status}`} aria-hidden />
          <span>{a.label}</span>
        </div>
      ))}
      {rights.evidence.chronology === 'behind' && (
        <div className="muted">The transaction log is behind the save, so history-dependent moves are not stated.</div>
      )}
    </div>
  );
}
