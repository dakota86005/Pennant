import type { ContractSummary, FreshnessCue, PlayerHeader, ScoutedFigure } from './api';
import { costMoney } from './costBand';
import { Tip } from './Tip';
import { TIP_CONTRACT_VALUE } from './ValueSection';
import { controlEndWords, freshnessWords, totalWords } from './valueWords';

/**
 * The player card's header (Player Value phase 6a, PLAYER_VALUE.md Part 8): his contract in a phrase, the Value section's
 * headline and his scouted tools, with how current the data is. It replaces the Value and Talent percentiles and OOTP's
 * Overall / Potential, which were `players_value` figures the organization cannot see (D-017). Plain words on the card,
 * the explanations in hovers any keyboard can reach. Everything shown is served; nothing here is a verdict.
 */

export const TIP_CONTRACT =
  "His deal as the export states it: this season's salary, the last season it covers (a signed extension included), and " +
  "what happens after this season: signed, an option, arbitration, pre-arbitration or free agency, with when the club's " +
  "control of him ends. Options and a no-trade clause are listed where the export records them.";
export const TIP_SCOUTED =
  "Your scouts' grades for his tools, averaged on the 20–80 scale: what he is now, and his ceiling. It's the " +
  "organization's own view. It isn't OOTP's Overall or Potential, which weigh the tools by position and aren't something " +
  "your front office can see. Where a tool hasn't been graded, the average is left blank rather than guessed.";
const TIP_COULD_BE =
  'The range covers every reasonable combination of how he plays, what a win costs and what he will be paid. It is ' +
  'deliberately wide: a range of outcomes, not a forecast.';
const TIP_NO_SINGLE =
  "There's no single most likely figure: it depends on a season that could go more than one way (an option, or whether " +
  'he stays). The Value section below says which.';
const TIP_WINS_ONLY = "This league's dollars aren't known here, so his value is his projected wins above a minimum-salary replacement.";

/** "$18.7M in 2026", or why this season's salary isn't shown. */
function salaryLine(c: ContractSummary): { text: string; tip: string | null } {
  if (c.salaryNow !== null && c.thisSeason !== null) return { text: `${costMoney(c.salaryNow)} in ${c.thisSeason}`, tip: null };
  if (c.kind === 'minor_league') return { text: 'Minor-league deal', tip: c.salaryNote };
  if (c.standing !== 'signed') return { text: 'No contract terms', tip: c.salaryNote };
  return { text: 'Salary not known', tip: c.salaryNote };
}

/** "Signed through 2028 (extension from 2027)", "Signed for 2026 only". */
function termLine(c: ContractSummary): string | null {
  if (c.signedThrough === null) return null;
  const ext = c.extension ? ` (extension from ${c.extension.from})` : '';
  return c.signedThrough === c.thisSeason ? `Signed for ${c.signedThrough} only` : `Signed through ${c.signedThrough}${ext}`;
}

/** What happens after this season, and when control ends, without saying the same thing twice. */
function afterLine(c: ContractSummary): { text: string; tip: string | null } | null {
  const end = controlEndWords(c.controlEnd);
  const parts: string[] = [];
  if (c.after && c.after.status !== 'signed' && c.after.status !== 'extended') parts.push(c.after.phrase);
  if (!parts.includes(end.text)) parts.push(end.known ? end.text : 'end of control not known');
  if (parts.length === 0) return null;
  const text = parts.join(' · ');
  const tip = [c.after?.detail, c.controlEnd.reason].filter(Boolean).join(' ') || null;
  return { text: text.charAt(0).toUpperCase() + text.slice(1), tip };
}

function Freshness({ cue }: { cue: FreshnessCue }) {
  const w = freshnessWords(cue);
  return (
    <div className={`dossier-asof dossier-asof-${w.tone}`}>
      <Tip label={[w.asOf, w.warning].filter(Boolean).join(' · ') || 'Date not known'} tip={w.tip} focusable />
    </div>
  );
}

function ContractTile({ c }: { c: ContractSummary }) {
  const salary = salaryLine(c);
  const term = termLine(c);
  const after = afterLine(c);
  return (
    <div className="card dossier-tile">
      <span className="card-label"><Tip label="Contract" tip={TIP_CONTRACT} focusable /></span>
      <span className="card-value">{salary.tip ? <Tip label={salary.text} tip={salary.tip} /> : salary.text}</span>
      {term && <span className="dossier-tile-line">{term}</span>}
      {after && <span className="dossier-tile-line muted">{after.tip ? <Tip label={after.text} tip={after.tip} /> : after.text}</span>}
      {c.clauses.length > 0 && <span className="dossier-tile-line muted">{c.clauses.join(' · ')}</span>}
      {(c.clauseNotes ?? []).length > 0 && (
        <span className="dossier-tile-line muted"><Tip label="Some terms not in the export" tip={(c.clauseNotes ?? []).join(' ')} /></span>
      )}
    </div>
  );
}

function ValueTile({ value }: { value: NonNullable<PlayerHeader['value']> }) {
  const winsOnly = value.unit === 'wins';
  const w = totalWords(winsOnly ? value.wins : value.contract, winsOnly ? 'wins' : 'dollars', value.reason);
  return (
    <div className="card dossier-tile">
      <span className="card-label">
        <Tip label={winsOnly ? 'Wins above replacement' : 'Contract value'} tip={winsOnly ? TIP_WINS_ONLY : TIP_CONTRACT_VALUE} focusable />
      </span>
      {w.known ? (
        <>
          <span className="card-value">
            {w.mostLikely ? <><span className="dossier-tile-lead">Most likely</span> {w.figure}</> : <Tip label={w.figure} tip={TIP_NO_SINGLE} />}
          </span>
          <span className="dossier-tile-line muted">
            <Tip label="could be" tip={TIP_COULD_BE} focusable /> {w.couldBe}{w.seasons ? ` (${w.seasons})` : ''}
          </span>
        </>
      ) : (
        <span className="card-value dossier-tile-unknown"><Tip label="Not valued yet" tip={w.reason ?? 'Not established.'} focusable /></span>
      )}
    </div>
  );
}

function ScoutedTile({ s }: { s: ScoutedFigure }) {
  const part = (v: number | null) => (v === null ? 'not scouted' : `${v}`);
  const text = s.now === null && s.ceiling === null ? 'Not scouted' : `${part(s.now)} → ${part(s.ceiling)}`;
  return (
    <div className="card dossier-tile">
      <span className="card-label"><Tip label="Scouted" tip={TIP_SCOUTED} focusable /></span>
      <span className="card-value">{text}</span>
      <span className="dossier-tile-line muted">now → ceiling</span>
    </div>
  );
}

/** The header's right side: pure, renders what it is given. */
export function HeaderValue({ header, scouted }: { header: PlayerHeader | undefined; scouted: ScoutedFigure | null | undefined }) {
  if (!header) return null;
  return (
    <div className="dossier-value">
      <div className="dossier-tiles">
        {header.contract && header.contract.standing !== 'unsigned' && <ContractTile c={header.contract} />}
        {header.value && header.value.status !== 'not_held' && <ValueTile value={header.value} />}
        {scouted && <ScoutedTile s={scouted} />}
      </div>
      <Freshness cue={header.freshness} />
    </div>
  );
}
