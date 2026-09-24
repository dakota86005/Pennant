import { useEffect, useState } from 'react';
import {
  getOurView, getPlayerSurplus, isStaticSite,
  type ClubWinValue, type LensFigure, type OurTotal, type OurViewResponse, type PlayerSurplus, type SurplusFigure, type SurplusSeason,
  type SurplusTotal, type SurplusView,
} from './api';
import { costMoney } from './costBand';
import { formatWins } from './productionConeGeometry';
import { Tip } from './Tip';
import { viewerOrg } from './viewerOrg';

/**
 * The player card's Value section (Player Value phases 5a and 5b, PLAYER_VALUE.md Parts 5, 6 and 4.5): the contract value
 * (the API's contract surplus) and the value of keeping him (its retention margin) side by side, each most likely with the
 * range it could be; "our view" beside them, the same figures read through the selected organization's philosophy with
 * each lean as a short phrase; this club's value of a win as context from the standings; then season by season with what
 * it rests on. Plain words on the card, the explanations in the hovers. Everything shown is Player Value's answer as
 * served (`/api/player-value/:id/surplus` and `/our-view`); the browser computes nothing about the player, and nothing
 * here is a verdict.
 */

/** Signed money at the pages' precision: "$28.0M", "−$9.0M", "$780K". */
const money = (v: number): string => (v < 0 ? `−${costMoney(-v)}` : costMoney(v));
/** A price of a win to the hundredth of a million: "$7.25M". */
const perWin = (v: number): string => `$${(v / 1_000_000).toFixed(2)}M`;
const range = (low: number, high: number, fmt: (v: number) => string = money): string => (low === high ? fmt(low) : `${fmt(low)} to ${fmt(high)}`);
const seasonsText = (t: { from: number | null; to: number | null }): string =>
  (t.from === null ? '' : t.from === t.to ? `${t.from}` : `${t.from}–${t.to}`);
const listSeasons = (ys: number[]): string => {
  if (ys.length <= 1) return ys.join('');
  const sorted = [...ys].sort((a, b) => a - b);
  return sorted.every((y, i) => i === 0 || y === sorted[i - 1] + 1) ? `${sorted[0]}–${sorted[sorted.length - 1]}` : sorted.join(', ');
};
const isAre = (ys: number[]) => (ys.length === 1 ? "isn't" : "aren't");

// ── the hovers: what each figure means, in the GM's words ──────────────────────

export const TIP_CONTRACT_VALUE =
  "What this contract is worth to any team that holds it: the wins he's projected to add, priced at what a win costs on " +
  "this league's free-agent market, minus the salary still to be paid. Seasons further out count a little less (5% a " +
  "year). Positive means he's worth more than he's paid; negative means he's being overpaid. This is the view that " +
  'matters in a trade.';
export const TIP_KEEPING_HIM =
  'Keeping him compared with replacing him with a minimum-salary player. Money you owe either way (a guaranteed contract ' +
  "is paid even if he's released) doesn't count, because it's spent no matter what; so a big contract never makes " +
  "keeping him look better or worse. Only costs you'd avoid by moving on count, like future arbitration raises or an " +
  "option you'd pick up. Positive means he's still the better use of the roster spot. Salary already paid this season " +
  'counts in neither view.';
const TIP_RANGE =
  "The range covers every reasonable combination of how he plays, what a win costs and what he'll be paid. It is " +
  'deliberately wide: a range of outcomes, not a forecast.';
const TIP_IF_KEPT = 'Counts only if the club keeps him that season: he could leave, or be let go, first.';
const TIP_WINS = 'Projected wins above replacement (WAR) that season, with the likely range.';
const TIP_PRICE = "What a win costs on this league's free-agent market.";
const TIP_COST = 'His salary that season — projected for arbitration and pre-arbitration years.';
const TIP_DISCOUNT = 'How much the season counts today: 5% less for each year out.';
const TIP_CONTRACT_SHORT = "His wins priced at the market rate, minus his salary: what the contract is worth to any team that holds it.";
const TIP_KEEPING_SHORT = "His wins priced at the market rate, minus only the costs you'd avoid by letting him go: money owed either way doesn't count.";
const TIP_WINS_ONLY_FINANCES = 'This league has no finances, so value is shown in wins only.';
const TIP_WINS_ONLY_OTHER = "The price of a win or the league minimum isn't known here, so value is shown in wins only.";

// ── the totals ────────────────────────────────────────────────────────────────

/** What a total with no single most-likely figure depends on: an option, a status, or whether he stays. */
function dependsOn(seasons: SurplusSeason[], pick: (s: SurplusSeason) => SurplusView): string {
  const open = seasons.filter((s) => {
    const v = pick(s);
    return v.status === 'known' && v.band !== null && v.band.central === null;
  });
  if (open.length === 0) return 'how an open season goes';
  const words = open.map((s) => (/option|opt_out/.test(s.status) ? `the ${s.season} option`
    : s.status === 'indeterminate' ? `his ${s.season} status` : `whether he stays in ${s.season}`));
  return words.filter((w, i) => words.indexOf(w) === i).join(' and ');
}

/** The short reason a total is not valued: which seasons lack his pay or his production. */
function notValuedLine(s: PlayerSurplus, total: SurplusTotal): string {
  if (total.missing.length === 0) {
    if (s.status === 'unknown') return "Not valued yet: his production isn't established.";
    return 'Not valued yet.';
  }
  const seasons = s.seasons.filter((x) => total.missing.includes(x.season));
  const noWins = seasons.filter((x) => x.wins === null).map((x) => x.season);
  const noPay = seasons.filter((x) => x.wins !== null && x.cost === null).map((x) => x.season);
  const lastWins = s.seasons.filter((x) => x.wins !== null).map((x) => x.season).pop();
  const parts: string[] = [];
  if (noPay.length > 0) parts.push(`his pay for ${listSeasons(noPay)} isn't known`);
  if (noWins.length > 0) parts.push(lastWins !== undefined && noWins.every((y) => y > lastWins) ? `his production is only projected through ${lastWins}` : `his production for ${listSeasons(noWins)} isn't established`);
  const other = total.missing.filter((y) => !noWins.includes(y) && !noPay.includes(y));
  if (other.length > 0) parts.push(`${listSeasons(other)} ${isAre(other)} established`);
  return `Not valued yet: ${parts.join(', and ')}.`;
}

function TotalView({ title, tip, gloss, total, unit, surplus, pick }: {
  title: string; tip: string; gloss: string; total: SurplusTotal; unit: 'dollars' | 'wins'; surplus: PlayerSurplus; pick: (s: SurplusSeason) => SurplusView;
}) {
  const fmt = unit === 'dollars' ? money : (v: number) => `${formatWins(v)} wins`;
  const known = total.status === 'known' && total.low !== null && total.high !== null;
  const heldSeasons = surplus.seasons.filter((x) => pick(x).ifHeld || x.ifHeld).map((x) => x.season);
  return (
    <div className="value-view">
      <div className="value-view-title"><Tip label={title} tip={tip} focusable /></div>
      {known ? (
        <>
          <div className="value-view-central">
            {total.central !== null ? (
              <><span className="value-view-lead">Most likely</span> {fmt(total.central)}</>
            ) : (
              <>{total.centralRange ? range(total.centralRange.low, total.centralRange.high, fmt) : fmt(total.low as number)} <span className="value-view-lead">depending on {dependsOn(surplus.seasons, pick)}</span></>
            )}
          </div>
          <div className="muted">
            <Tip label="could be" tip={TIP_RANGE} focusable /> {range(total.low as number, total.high as number, fmt)} ({seasonsText(total)})
            {total.ifHeld && heldSeasons.length > 0 && <> · {listSeasons(heldSeasons)} <Tip label="if kept" tip={TIP_IF_KEPT} focusable /></>}
          </div>
        </>
      ) : (
        <>
          <div className="value-view-central value-view-unknown">
            <Tip label={notValuedLine(surplus, total)} tip={total.reason ?? 'Not established.'} focusable />
          </div>
          {total.established && (
            <div className="muted">
              The known seasons ({total.established.from === total.established.to ? `${total.established.from} only` : `${total.established.from}–${total.established.to}`}):{' '}
              {total.established.central !== null ? `most likely ${fmt(total.established.central)}` : total.established.centralRange ? range(total.established.centralRange.low, total.established.centralRange.high, fmt) : ''}
              , could be {range(total.established.low, total.established.high, fmt)}. Not a total over his control.
            </div>
          )}
        </>
      )}
      <div className="muted value-view-gloss">{gloss}</div>
    </div>
  );
}

// ── our view and the club's value of a win ─────────────────────────────────────

/** A lens figure in a few words: most likely, or the range of readings where there is no single one. */
function lensText(f: LensFigure | null, fmt: (v: number) => string): string {
  if (!f) return 'not valued';
  if (f.central !== null) return fmt(f.central);
  if (f.centralRange) return range(f.centralRange.low, f.centralRange.high, fmt);
  return range(f.low, f.high, fmt);
}

function OurFigure({ label, total, fmt }: { label: string; total: OurTotal; fmt: (v: number) => string }) {
  if (total.status !== 'known') return <span>{label}: not valued yet</span>;
  return <span>{label}: <strong>{lensText(total.ours, fmt)}</strong> (neutral {lensText(total.neutral, fmt)})</span>;
}

const possessive = (club: string | null): string => (club ? `the ${club}${club.endsWith('s') ? "'" : "'s"}` : "this club's");

const TIP_WIN_VALUE =
  "Context from the standings, not part of the value: how much one more win this season changes this club's chance of " +
  'reaching the playoffs, on the same odds model as the deadline read (its record, run differential and games left). ' +
  "It isn't converted to dollars, and it isn't added to any value figure.";

/** This club's value of a win now, as context: in playoff odds, never part of any value. */
export function ClubWinValueLine({ value }: { value: ClubWinValue }) {
  const club = possessive(value.club);
  if (value.status === 'known' && value.perWin !== null) {
    const pts = value.perWin * 100;
    const points = pts > 0 && pts < 0.05 ? 'less than 0.1' : pts.toFixed(1);
    return (
      <div className="muted value-win">
        <Tip label={`A win right now moves ${club} playoff odds by about ${points} points`} tip={`${TIP_WIN_VALUE} ${value.text}`} focusable />
        {value.odds !== null ? ` (now ${Math.round(value.odds * 100)}%)` : ''}.
      </div>
    );
  }
  if (value.status === 'decided') {
    return <div className="muted value-win"><Tip label={`A win right now doesn't move ${club} playoff odds`} tip={TIP_WIN_VALUE} focusable />: {value.reason}</div>;
  }
  if (value.status === 'no_games_left') {
    return <div className="muted value-win"><Tip label="No games left this season" tip={TIP_WIN_VALUE} focusable />: a win can no longer be added.</div>;
  }
  return <div className="muted value-win"><Tip label={`${club.charAt(0).toUpperCase()}${club.slice(1)} value of a win now isn't known`} tip={TIP_WIN_VALUE} focusable />: {value.reason}</div>;
}

function OurViewBlock({ ours: r, unit }: { ours: OurViewResponse; unit: 'dollars' | 'wins' }) {
  const v = r.ourView;
  const whose = r.organization.name ?? 'This organization';
  const whoseOwn = r.organization.name ? possessive(r.organization.name) : "this organization's";
  const WhoseOwn = `${whoseOwn.charAt(0).toUpperCase()}${whoseOwn.slice(1)}`;
  const fmt = unit === 'dollars' ? money : (x: number) => `${formatWins(x)} wins`;
  const tip =
    `The same figures read through ${whoseOwn} philosophy: it can weigh near seasons against far ones, read the ranges more ` +
    'cautiously, and weigh his salary, club control and guaranteed money more or less. It never changes the figures ' +
    'above, and every difference is listed with how much it moved.';
  const amount = (d: { low: number; high: number } | null): string =>
    (d === null || (Math.abs(d.low) < 500 && Math.abs(d.high) < 500 && unit === 'dollars') ? '' : ` (${d.low === d.high ? (d.low > 0 ? '+' : '') + fmt(d.low) : `${fmt(d.low)} to ${fmt(d.high)}`})`);
  return (
    <div className="value-ours">
      <div className="value-view-title"><Tip label="Our view" tip={tip} focusable /> <span className="value-ours-whose">{whose}</span></div>
      {v.status === 'not_held' || (v.contract.status !== 'known' && v.retention.status !== 'known' && v.wins.status !== 'known') ? (
        <div className="muted">Not valued yet, so the philosophy has nothing to lean on.</div>
      ) : v.leaning ? (
        <>
          <div className="value-ours-figures">
            {unit === 'dollars' ? (
              <>
                <OurFigure label="Contract value" total={v.contract} fmt={fmt} /> · <OurFigure label="Keeping him" total={v.retention} fmt={fmt} />
              </>
            ) : <OurFigure label="Wins above replacement" total={v.wins} fmt={fmt} />}
          </div>
          <ul className="value-leans">
            {v.leans.map((l) => (
              <li key={l.id}><Tip label={l.short} tip={l.text} focusable />{amount(unit === 'dollars' ? l.by.contract : l.by.wins)}</li>
            ))}
          </ul>
        </>
      ) : (
        <div className="muted">{WhoseOwn} philosophy doesn't lean on him: our view is the same as above.</div>
      )}
      {v.notes.length > 0 && (
        <ul className="value-leans">
          {v.notes.map((n) => <li key={n.id}><Tip label={n.short} tip={n.text} focusable /></li>)}
        </ul>
      )}
    </div>
  );
}

// ── the breakdown ───────────────────────────────────────────────────────────────

const figure = (f: SurplusFigure | null): string => {
  if (!f) return 'not known';
  if (f.low === f.high) return money(f.low);
  return f.central === null ? range(f.low, f.high) : `${money(f.central)} (${range(f.low, f.high)})`;
};
const winsText = (w: SurplusSeason['wins']): string =>
  (w ? `${formatWins(w.central)} (${formatWins(w.low)} to ${formatWins(w.high)})` : 'not established');

function Cell({ v }: { v: SurplusView }) {
  if (v.status !== 'known') return <>not known</>;
  return <>{figure(v.band)}{v.ifHeld ? <> <Tip label="if kept" tip={TIP_IF_KEPT} /></> : null}</>;
}

/** Lower-case the first letter of a served reason, so it reads after a colon. */
const afterColon = (t: string): string => (t.length > 0 ? `${t.charAt(0).toLowerCase()}${t.slice(1)}` : t);

/**
 * What each season lacks, or what it depends on, in plain words under the table. A reason both views share is said once,
 * and seasons in a row with the same reason are said together ("2027–2029 aren't valued: ...").
 */
function seasonNotes(seasons: SurplusSeason[]): string[] {
  const unknown: Array<{ season: number; view: string | null; text: string }> = [];
  const open: string[] = [];
  for (const s of seasons) {
    const reasonOf = (v: SurplusView) => afterColon((v.reason ?? 'not established').replace(/^\d{4}: /, ''));
    const c = s.contract.status === 'unknown' ? reasonOf(s.contract) : null;
    const r = s.retention.status === 'unknown' ? reasonOf(s.retention) : null;
    if (c !== null && c === r) unknown.push({ season: s.season, view: null, text: c });
    else {
      if (c !== null) unknown.push({ season: s.season, view: 'contract value', text: c });
      if (r !== null) unknown.push({ season: s.season, view: 'value of keeping him', text: r });
    }
    const views: Array<[string, SurplusView]> = [['contract value', s.contract], ['value of keeping him', s.retention]];
    for (const [name, v] of views) {
      if (v.status === 'known' && v.band && v.band.central === null && v.centrals.length > 0) {
        open.push(`${s.season} (${name}) depends on how the season goes: ${v.centrals.map((x) => `${x.reading}: ${range(x.low, x.high)}`).join('; ')}.`);
      }
    }
  }
  // Seasons in a row with the same reason, said together
  const grouped: string[] = [];
  let run: { from: number; to: number; view: string | null; text: string } | null = null;
  const flush = () => {
    if (!run) return;
    const view = run.view ? ` (${run.view})` : '';
    const ys = run.from === run.to ? `${run.from}${view} isn't` : `${run.from}–${run.to}${view} aren't`;
    grouped.push(`${ys} valued: ${run.text}`);
    run = null;
  };
  for (const u of unknown) {
    if (run && run.text === u.text && run.view === u.view && u.season === run.to + 1) run.to = u.season;
    else {
      flush();
      run = { from: u.season, to: u.season, view: u.view, text: u.text };
    }
  }
  flush();
  return [...grouped, ...open].filter((x, i, all) => all.indexOf(x) === i);
}

/** What the figures rest on, in plain words (the server's precise basis stays in the API for the staff and the AI). */
function restsOn(s: PlayerSurplus): string[] {
  const out: string[] = [];
  const first = s.seasons[0];
  if (first && first.part === 'rest_of_season' && (first.banked !== null || first.paid !== null)) {
    const banked = first.banked !== null ? `${formatWins(first.banked)} wins` : null;
    const paid = first.paid !== null ? `${money(first.paid)} of salary` : null;
    out.push(`Already banked in ${first.season}: ${[banked, paid].filter(Boolean).join(' and ')}. That's spent either way, so it isn't counted${first.share !== null ? `; the rest of ${first.season} counts ${Math.round(first.share * 100)}% of his salary` : ''}.`);
  }
  for (const e of s.excluded) {
    if (/^What he has banked/.test(e)) continue;
    const past = /^Control continues past (\d{4})/.exec(e);
    if (past) out.push(`Seasons after ${past[1]} aren't counted: the value looks at most seven seasons ahead.`);
    else out.push(e);
  }
  if (s.price) {
    out.push(`A win costs about ${perWin(s.price.band.central)} on this league's market (reasonable range ${perWin(s.price.band.low)} to ${perWin(s.price.band.high)}), ${s.price.stage === 'measured' ? 'measured from the signings seen across imports' : "read from the contracts in this league's export"}, and the same in every season.`);
  }
  out.push(`Seasons further out count ${Math.round(s.discount.rate * 100)}% less for each year.`);
  if (s.minimum !== null) out.push(`A replacement is a minimum-salary player (${money(s.minimum)}) who adds no wins above replacement.`);
  out.push(s.fortyMan.onFortyMan === true
    ? "Keeping him uses a 40-man spot; that isn't priced here."
    : s.fortyMan.onFortyMan === false
      ? "He isn't on the 40-man, so keeping him uses no 40-man spot now."
      : "Whether he's on the 40-man isn't in the export.");
  return out;
}

/** The section's body: the two views side by side, our view and the club's value of a win, then the breakdown. Pure: renders what it is given. */
export function ValueView({ surplus: s, ours = null }: { surplus: PlayerSurplus; ours?: OurViewResponse | null }) {
  if (s.status === 'not_held') return <p className="muted">{s.reason}</p>;
  const notes = seasonNotes(s.seasons);
  const winsOnly = s.status === 'wins_only';
  return (
    <>
      <div className="value-views">
        {winsOnly ? (
          <TotalView
            title="Wins above replacement"
            tip={/financ/i.test(s.reason ?? '') ? TIP_WINS_ONLY_FINANCES : TIP_WINS_ONLY_OTHER}
            gloss="His wins over a minimum-salary replacement, later seasons counting a little less."
            total={s.wins} unit="wins" surplus={s} pick={(x) => x.contract}
          />
        ) : (
          <>
            <TotalView
              title="Contract value" tip={TIP_CONTRACT_VALUE} gloss="What he's worth beyond what he's paid."
              total={s.contract} unit="dollars" surplus={s} pick={(x) => x.contract}
            />
            <TotalView
              title="Value of keeping him" tip={TIP_KEEPING_HIM} gloss="What you'd give up by letting him go."
              total={s.retention} unit="dollars" surplus={s} pick={(x) => x.retention}
            />
          </>
        )}
      </div>
      {ours && <OurViewBlock ours={ours} unit={winsOnly ? 'wins' : 'dollars'} />}
      {ours && <ClubWinValueLine value={ours.winValue} />}
      {s.seasons.length > 0 && (
        <details className="value-details">
          <summary>Season-by-season breakdown</summary>
          <div className="history-scroll">
            <table className="mini value-table">
              <thead>
                <tr>
                  <th>Season</th>
                  <th><Tip label="Wins" tip={TIP_WINS} /></th>
                  <th><Tip label="Price" tip={TIP_PRICE} /></th>
                  <th><Tip label="Cost" tip={TIP_COST} /></th>
                  <th><Tip label="Discount" tip={TIP_DISCOUNT} /></th>
                  <th><Tip label="Contract value" tip={TIP_CONTRACT_SHORT} /></th>
                  <th><Tip label="Keeping him" tip={TIP_KEEPING_SHORT} /></th>
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
                    <td className="num">{x.price ? perWin(x.price.central as number) : 'not known'}</td>
                    <td className="num">{figure(x.cost)}{x.ifHeld ? ' if kept' : ''}</td>
                    <td className="num">{Math.round(x.weight * 100)}%</td>
                    <td className="num"><Cell v={x.contract} /></td>
                    <td className="num"><Cell v={x.retention} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="value-basis">
            {notes.map((n) => <li key={n}>{n}</li>)}
            {restsOn(s).map((n) => <li key={n}>{n}</li>)}
          </ul>
        </details>
      )}
    </>
  );
}

/** The card's section: fetches the value and our view and renders them. A static export does not carry the routes, so it omits it. */
export function ValueSection({ playerId }: { playerId: number }) {
  const [surplus, setSurplus] = useState<PlayerSurplus | null>(null);
  const [ours, setOurs] = useState<OurViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isStaticSite()) return;
    let live = true;
    setSurplus(null);
    setOurs(null);
    setError(null);
    getPlayerSurplus(playerId)
      .then((v) => { if (live) setSurplus(v); })
      .catch((e: Error) => { if (live) setError(e.message); });
    // Our view is beside the neutral value, never in place of it: the section stands without it
    getOurView(playerId, viewerOrg())
      .then((v) => { if (live) setOurs(v); })
      .catch(() => { if (live) setOurs(null); });
    return () => { live = false; };
  }, [playerId]);

  if (isStaticSite()) return null;
  return (
    <section className="value-section">
      <h3>Value</h3>
      {error && <p className="muted">Value could not be loaded: {error}</p>}
      {!surplus && !error && <p className="muted">Loading value…</p>}
      {surplus && <ValueView surplus={surplus} ours={ours} />}
    </section>
  );
}
