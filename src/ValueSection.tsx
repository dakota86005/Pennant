import { useEffect, useState } from 'react';
import { getPlayerSurplus, isStaticSite, type PlayerSurplus, type SurplusFigure, type SurplusSeason, type SurplusTotal, type SurplusView } from './api';
import { costMoney } from './costBand';
import { formatWins } from './productionConeGeometry';

/**
 * The player card's Value section (Player Value phase 5a, PLAYER_VALUE.md Part 5): the neutral contract surplus and
 * the retention margin side by side, each a band with its central, then season by season (wins, price, cost, discount
 * and both views) with the basis and what is unknown. Everything shown is Player Value's answer as served
 * (`/api/player-value/:id/surplus`); the browser computes nothing about the player, and neither view is a verdict.
 */

/** Signed money at the pages' precision: "$28.0M", "−$9.0M", "$780K". */
const money = (v: number): string => (v < 0 ? `−${costMoney(-v)}` : costMoney(v));

const range = (low: number, high: number): string => (low === high ? money(low) : `${money(low)} to ${money(high)}`);

const figure = (f: SurplusFigure | null): string => {
  if (!f) return 'unknown';
  if (f.low === f.high) return money(f.low);
  return f.central === null ? `${range(f.low, f.high)} (no single central)` : `${money(f.central)} (${range(f.low, f.high)})`;
};

const winsText = (w: SurplusSeason['wins']): string =>
  (w ? `${formatWins(w.central)} (${formatWins(w.low)} to ${formatWins(w.high)})` : 'not established');

const seasonsText = (t: { from: number | null; to: number | null }): string =>
  (t.from === null ? '' : t.from === t.to ? `${t.from}` : `${t.from}–${t.to}`);

/** One view's total: its central (or the range of its centrals), its band and the seasons it covers; or why it is unknown. */
function TotalView({ title, gloss, total, unit }: { title: string; gloss: string; total: SurplusTotal; unit: 'dollars' | 'wins' }) {
  const fmt = unit === 'dollars' ? money : (v: number) => `${formatWins(v)} wins`;
  const known = total.status === 'known' && total.low !== null && total.high !== null;
  return (
    <div className="value-view">
      <div className="value-view-title">{title}</div>
      {known ? (
        <>
          <div className="value-view-central">
            {total.central !== null ? fmt(total.central) : total.centralRange ? `${fmt(total.centralRange.low)} to ${fmt(total.centralRange.high)}` : 'no central'}
          </div>
          <div className="muted">
            {total.central === null ? 'No single central: it depends on how an open season goes. ' : 'Central. '}
            Range {fmt(total.low as number)} to {fmt(total.high as number)}, {seasonsText(total)}, discounted
            {total.ifHeld ? '; a season in it counts only if he is held' : ''}.
          </div>
        </>
      ) : (
        <>
          <div className="value-view-central">unknown</div>
          <div className="muted">{total.reason}</div>
          {total.established && (
            <div className="muted">
              The known seasons ({total.established.from === total.established.to ? `${total.established.from} only` : `${total.established.from}–${total.established.to}`}):{' '}
              {total.established.central !== null ? fmt(total.established.central) : 'no single central'}, range {fmt(total.established.low)} to {fmt(total.established.high)}. Not a sum over his control.
            </div>
          )}
        </>
      )}
      <div className="muted value-view-gloss">{gloss}</div>
    </div>
  );
}

/** A season's view in a table cell: the band and its central, "if held", or "unknown". */
const cell = (v: SurplusView): string =>
  (v.status === 'known' ? `${figure(v.band)}${v.ifHeld ? ' if held' : ''}` : 'unknown');

/** What each season rests on or lacks, in words, under the table. */
function seasonNotes(s: SurplusSeason): string[] {
  const out: string[] = [];
  const views: Array<[string, SurplusView]> = [['contract surplus', s.contract], ['retention margin', s.retention]];
  for (const [name, v] of views) {
    if (v.status === 'unknown') out.push(`${s.season} ${name}: unknown. ${v.reason ?? ''}`.trim());
    else if (v.band && v.band.central === null && v.centrals.length > 0) {
      out.push(`${s.season} ${name}, no central chosen: ${v.centrals.map((c) => `${c.reading} ${range(c.low, c.high)}`).join('; ')}.`);
    }
  }
  return out.filter((x, i) => out.indexOf(x) === i);
}

/** The section's body: both views side by side, then season by season with the basis. Pure: renders what it is given. */
export function ValueView({ surplus: s }: { surplus: PlayerSurplus }) {
  if (s.status === 'not_held') return <p className="muted">{s.reason}</p>;
  const notes = s.seasons.flatMap(seasonNotes);
  return (
    <>
      {s.status !== 'valued' && s.reason && <p className="muted value-reason">{s.reason}</p>}
      <div className="value-views">
        <TotalView
          title="Contract surplus"
          gloss="His production value less his cost, season by season: what the contract is worth to whoever holds it."
          total={s.contract}
          unit="dollars"
        />
        <TotalView
          title="Retention margin"
          gloss="His wins over a replacement's, less what exists only if he is kept: money owed whatever the club does cancels, money already paid counts in neither."
          total={s.retention}
          unit="dollars"
        />
        {s.status === 'wins_only' && (
          <TotalView title="Wins over a replacement" gloss="His wins above the export's replacement level over the seasons counted, discounted like the dollars." total={s.wins} unit="wins" />
        )}
      </div>
      {s.seasons.length > 0 && (
        <details className="value-details">
          <summary>Season by season, and what it rests on</summary>
          <div className="history-scroll">
            <table className="mini value-table">
              <thead>
                <tr>
                  <th>Season</th><th>Wins</th><th>Price</th><th>Cost</th><th>Discount</th><th>Contract surplus</th><th>Retention margin</th>
                </tr>
              </thead>
              <tbody>
                {s.seasons.map((x) => (
                  <tr key={x.season} title={x.control}>
                    <td>
                      {x.season}
                      {x.part === 'rest_of_season' && <div className="muted">rest of season{x.share !== null ? ` (${Math.round(x.share * 100)}%)` : ''}</div>}
                    </td>
                    <td className="num">{winsText(x.wins)}</td>
                    <td className="num">{x.price ? money(x.price.central as number) : 'unknown'}</td>
                    <td className="num" title={x.costText}>{figure(x.cost)}{x.ifHeld ? ' if held' : ''}</td>
                    <td className="num">{x.weight.toFixed(3)}</td>
                    <td className="num" title={x.contract.text}>{cell(x.contract)}</td>
                    <td className="num" title={x.retention.text}>{cell(x.retention)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="value-basis">
            {notes.map((n) => <li key={n}>{n}</li>)}
            {s.excluded.map((n) => <li key={n}>{n}</li>)}
            {s.price && <li>{s.price.text}</li>}
            <li>{s.discount.text}</li>
            <li>{s.replacement.text}{s.replacement.measured ? ` ${s.replacement.measured}` : ''}</li>
            <li>{s.fortyMan.text}</li>
            {s.basis.filter((b) => b !== s.discount.text && b !== s.price?.text).map((b) => <li key={b}>{b}</li>)}
          </ul>
        </details>
      )}
    </>
  );
}

/** The card's section: fetches the surplus and renders it. A static export does not carry the route, so it omits it. */
export function ValueSection({ playerId }: { playerId: number }) {
  const [surplus, setSurplus] = useState<PlayerSurplus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isStaticSite()) return;
    let live = true;
    setSurplus(null);
    setError(null);
    getPlayerSurplus(playerId)
      .then((v) => { if (live) setSurplus(v); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [playerId]);

  if (isStaticSite()) return null;
  return (
    <section className="value-section">
      <h3>Value</h3>
      {error && <p className="muted">Value could not be loaded: {error}</p>}
      {!surplus && !error && <p className="muted">Loading value…</p>}
      {surplus && <ValueView surplus={surplus} />}
    </section>
  );
}
