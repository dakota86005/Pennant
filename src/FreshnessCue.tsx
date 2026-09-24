import type { FreshnessCue } from './api';
import { Tip } from './Tip';
import { freshnessWords } from './valueWords';

/**
 * How current a page's figures are (A-20; Player Value phases 6a and 6c): "As of May 16, 2026", then the warning where the
 * export is behind the save or could not be checked against it, in the warning's tone, with what it means on hover. The
 * same words Contracts and the card's header use, on Payroll, Free Agents and the Trade Center. Renders nothing where the
 * server sent no cue (an older payload).
 */
export function FreshnessCueLine({ freshness }: { freshness: FreshnessCue | null | undefined }) {
  if (!freshness) return null;
  const fresh = freshnessWords(freshness);
  return (
    <span className={`contracts-asof dossier-asof-${fresh.tone}`}>
      <Tip label={[fresh.asOf, fresh.warning].filter(Boolean).join(' · ') || 'Date not known'} tip={fresh.tip || 'How current the league data is.'} focusable />
    </span>
  );
}
