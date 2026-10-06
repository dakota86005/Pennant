/**
 * What the player window's words are handed (N11): the card's dossier as `/api/player/:id` computes it, Player Value's
 * cone, surplus and our view, Player State's current state, the transaction log's lines about him, his rating history,
 * and how ratings are shown. The reader (`server/playerDossierBuild.ts`) reads them through the specialists' public
 * modules; the words below decide nothing (D-001) and read no table.
 */
import type { PlayerDossierBody } from '../../player.js';
import type { OurView, PlayerSurplus, ProductionCone } from '../../playerValue.js';
import type { PlayerState } from '../../playerState.js';
import type { TransactionEvent } from '../../transactionLog.js';
import type { PlayerHistoryRow } from '../../history.js';
import type { RatingMode } from '../../ratingMode.js';

export interface DossierInput {
  playerId: number;
  /** The club the window reads him for (our view, the "ours" of a lean). */
  orgId: number;
  orgName: string | null;
  importStamp: string | null;
  reportStamp: string;
  /** The export's game date, as OOTP writes it. */
  gameDate: string | null;
  body: PlayerDossierBody;
  state: PlayerState | null;
  /** His lines in the transaction log, newest first; null when the log can't be read. */
  chronology: TransactionEvent[] | null;
  chronologyNote: string | null;
  cone: ProductionCone | null;
  surplus: PlayerSurplus | null;
  /** Our view, and the club's name it is read for; null when he isn't valued. */
  ourView: OurView | null;
  /**
   * His rating history: the comparable rows, and what was set aside and why (review M2): a change of his source, the
   * save's changes of kind when any of his snapshots is of another kind, the reason for snapshots of an unknown kind.
   */
  history: { rows: PlayerHistoryRow[]; sourceSwitch: string | null; modeSwitches: string[]; unknownKind: string | null; setAside: number };
  rating: { scaleMax: number; roundToFive: boolean };
  /** Whose ratings the evidence reads, in words ("Your scouts' view") and its sentence. */
  ratingSource: { mode: RatingMode | null; short: string; text: string };
}
