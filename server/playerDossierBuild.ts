/**
 * The player window's reader (N11): reads what the dossier says through the specialists' public modules and hands it to
 * the words (`presentation/player/`). One batch shares its reads: the card's dossier (`computePlayerDossier`, the same
 * function `/api/player/:id` answers with), Player Value's valuation (its cone, surplus and our view, through the entry
 * point), Player Rights and the assignment context (`rightsFor`), the current state (`playerStates`), the transaction
 * log's lines about him, and his rating history (`playerRatingHistory`). Pure reads: it writes nothing and decides nothing.
 * It runs in the Front Office's worker for our club's players after each import (`playerViewService.ts`), and on the
 * request for any other player.
 */
import { db, tableExists } from './db.js';
import { currentTransactionLog } from './dataStatus.js';
import { playerRatingHistory } from './history.js';
import { resolvePhilosophy } from './philosophy.js';
import { computePlayerDossier, dossierShared } from './player.js';
import { lensPhilosophyFrom, ourViewOf, productionCone } from './playerValue.js';
import { playerStates } from './playerState.js';
import { dossierView } from './presentation/player/dossier.js';
import type { PlayerDossierView } from './presentation/player/types.js';
import { ratingSource } from './scoutedEvidence.js';
import { loadSettings, philosophyForOrg } from './settings.js';
import { ratingScaleMax } from './valuation.js';

export interface PlayerDossiersRequest {
  /** The club the window reads them for (our view, our scouts). */
  orgId: number;
  importStamp: string | null;
  reportStamp: string;
  playerIds: number[];
}

export interface PlayerDossiersResult {
  views: PlayerDossierView[];
  /** The ids the export has no such player for. */
  missing: number[];
  ms: number;
}

/** A club's name as the export writes it ("Arizona Diamondbacks"); null when it doesn't. */
export function clubNameOf(teamId: number): string | null {
  if (!tableExists('teams')) return null;
  const row = db.prepare(`SELECT name, nickname FROM teams WHERE team_id = ?`).get(teamId) as { name?: unknown; nickname?: unknown } | undefined;
  if (!row) return null;
  const parts = [row.name, row.nickname].filter((x): x is string => typeof x === 'string' && x.length > 0);
  if (parts.length === 2 && parts[0] === parts[1]) return parts[0];
  return parts.join(' ') || null;
}

/** Players' dossiers, read together (their shared reads once). */
export function buildPlayerDossiers(request: PlayerDossiersRequest): PlayerDossiersResult {
  const started = performance.now();
  const ids = [...new Set(request.playerIds)].filter((id) => Number.isInteger(id) && id > 0);
  const views: PlayerDossierView[] = [];
  const missing: number[] = [];
  if (ids.length === 0 || !tableExists('players')) return { views, missing: ids, ms: 0 };
  const shared = dossierShared(ids);
  const states = playerStates(ids);
  const { log } = currentTransactionLog();
  const logState = shared.status.freshness.log;
  const chronologyNote = !log
    ? 'The OOTP transaction log is unavailable, so no transaction history is shown.'
    : logState.state === 'behind'
      ? `The transaction log is ${logState.lagDays} day(s) behind the save; recent moves may be missing.`
      : null;
  const philosophy = lensPhilosophyFrom(resolvePhilosophy(philosophyForOrg(request.orgId)));
  const orgName = clubNameOf(request.orgId);
  const rating = { scaleMax: ratingScaleMax(), roundToFive: loadSettings().roundRatingsToFive === true };
  const source = ratingSource();
  const gameDate = shared.status.freshness.csv.currentDate ?? null;
  for (const id of ids) {
    const computed = computePlayerDossier(id, shared);
    if (!computed.ok) {
      missing.push(id);
      continue;
    }
    const valuation = shared.valuation(id);
    const surplus = valuation?.surplus ?? null;
    const holder = valuation?.control.holder.value ?? null;
    const ours = !valuation || valuation.control.standing === 'unknown' ? null : holder === request.orgId;
    const events = log ? [...(log.byPlayer.get(id) ?? [])].reverse() : null;
    views.push(dossierView({
      playerId: id,
      orgId: request.orgId,
      orgName,
      importStamp: request.importStamp,
      reportStamp: request.reportStamp,
      gameDate,
      body: computed.body,
      state: states.get(id) ?? null,
      chronology: events,
      chronologyNote,
      cone: valuation ? productionCone(valuation.production, valuation.control) : null,
      surplus,
      ourView: surplus ? ourViewOf({ neutral: surplus, philosophy, ours }) : null,
      history: playerRatingHistory(id),
      rating,
      ratingSource: { short: source.short, text: source.text },
    }));
  }
  return { views, missing, ms: Math.round((performance.now() - started) * 10) / 10 };
}
