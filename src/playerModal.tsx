import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { apiDelete, apiGet, apiPost, getPlayer, type PlayerDossier } from './api';
import { focusablesIn, focusTrapTarget } from './focusTrap';
import { PlayerHover } from './playerHover';
import { AssignmentBlock } from './AssignmentContext';
import { RightsBlock } from './PlayerRights';
import { ProductionConeSection } from './ProductionCone';
import { ValueSection } from './ValueSection';
import { HeaderValue } from './PlayerHeaderValue';
import { Tip } from './Tip';
import { formatRatingPair, ratingFraction } from './ratingScale';

// Tiny pub/sub so any table cell can open the player card without prop drilling
type Listener = (id: number | null) => void;
let listener: Listener | null = null;
export function openPlayer(id: number): void {
  listener?.(id);
}

/** Clickable player name — use anywhere a player appears. */
export function PlayerLink({ id, children }: { id: number; children: ReactNode }) {
  return (
    <PlayerHover id={id}>
      <button className="player-link" onClick={() => openPlayer(id)} title="Open player card">
        {children}
      </button>
    </PlayerHover>
  );
}

/** Hoverable explainer — dotted underline with a styled popup (its own module, so the card's sections can use it too). */
export { Tip };

/**
 * The Roster's scouting column (Player Value phase 6d). It was OOTP's own Overall and Potential, read from players_value,
 * which nothing establishes is the organization's view (D-017); it is now the card header's "Scouted" figure.
 */
export const TIP_OA =
  "Your scouts' grades for his tools, averaged on the 20–80 scale: what he is now, then his ceiling. For a hitter " +
  'that is contact, gap power, power, eye and avoiding strikeouts; for a pitcher, stuff, movement and control. It is the ' +
  "same figure as \"Scouted\" on his card.\n\n" +
  "It's the organization's own view, not OOTP's Overall or Potential: those weigh the tools by position and aren't " +
  'something your front office can see. A plain average also leaves out defence, speed and a pitcher\'s stamina, so a ' +
  'glove-first shortstop or a starter who goes deep reads lower here than his value to the club.\n\n' +
  'The grades sit on one major-league scale at every level, so a good Triple-A regular reads well below 50 here. Where a ' +
  'tool has not been graded the average says "not scouted" rather than guessing, and those players sort to the bottom ' +
  'either way.';

export const TIP_CURPOT =
  'Current → potential scout ratings (20-80 scale), averaged across the main rating categories. 45→60 means an average-ish player today with above-average upside.';

const money = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`;
const fmt3 = (n: number | null) => (n === null ? '' : n.toFixed(3).replace(/^0/, ''));

const RATING_LABELS: Record<string, string> = {
  contact: 'Contact', gap: 'Gap', power: 'Power', eye: 'Eye', avoidK: 'Avoid K',
  speed: 'Speed', stealing: 'Stealing', baserunning: 'Baserunning',
  stuff: 'Stuff', movement: 'Movement', control: 'Control', stamina: 'Stamina',
  infieldRange: 'IF Range', infieldArm: 'IF Arm', turnDP: 'Turn DP',
  outfieldRange: 'OF Range', outfieldArm: 'OF Arm', catcherArm: 'C Arm', catcherAbility: 'C Ability',
};
const PITCH_LABELS: Record<string, string> = {
  fastball: 'Fastball', sinker: 'Sinker', cutter: 'Cutter', slider: 'Slider', curveball: 'Curveball',
  changeup: 'Changeup', splitter: 'Splitter', forkball: 'Forkball', screwball: 'Screwball',
  circlechange: 'Circle Change', knucklecurve: 'Knuckle Curve', knuckleball: 'Knuckleball',
};

/**
 * The card's frame: a labelled modal dialog over a backdrop, with a named close button (S-01). The
 * keyboard handling lives in `PlayerModal`; this is the markup, rendered alone in tests.
 */
export function PlayerCardFrame({ onClose, label, dialogRef, children }: {
  onClose: () => void;
  label: string;
  dialogRef?: RefObject<HTMLDivElement>;
  children?: ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close the player card" onClick={onClose}>✕</button>
        {children}
      </div>
    </div>
  );
}

export function PlayerModal() {
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [dossier, setDossier] = useState<PlayerDossier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  /** Whatever had focus when the card opened, to hand focus back to on close. */
  const opener = useRef<HTMLElement | null>(null);
  const open = useRef(false);

  useEffect(() => {
    listener = (id) => {
      // A card opened from inside the card keeps the first opener
      if (id !== null && !open.current && document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
      setPlayerId(id);
    };
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    if (playerId === null) return;
    setDossier(null);
    setError(null);
    getPlayer(playerId).then(setDossier).catch((e) => setError(e.message));
  }, [playerId]);

  // Focus moves into the card when it opens and back to whatever opened it when it closes
  useEffect(() => {
    if (playerId !== null) {
      if (!open.current) dialog.current?.focus();
      open.current = true;
      return;
    }
    if (open.current) {
      open.current = false;
      const back = opener.current;
      opener.current = null;
      if (back && back.isConnected) back.focus();
    }
  }, [playerId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open.current) return;
      // A season's detail in the cone takes the first Escape (it marks the event handled)
      if (e.key === 'Escape' && !e.defaultPrevented) {
        setPlayerId(null);
        return;
      }
      if (e.key !== 'Tab' || !dialog.current) return;
      const items = focusablesIn(dialog.current);
      const current = document.activeElement instanceof HTMLElement && dialog.current.contains(document.activeElement)
        ? document.activeElement
        : null;
      const target = focusTrapTarget(items, current, e.shiftKey);
      if (target) {
        e.preventDefault();
        target.focus();
      } else if (items.length === 0) {
        e.preventDefault();
        dialog.current.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (playerId === null) return null;

  return (
    <PlayerCardFrame onClose={() => setPlayerId(null)} label={dossier ? `Player card: ${dossier.name}` : 'Player card'} dialogRef={dialog}>
      {error && <div className="banner error">{error}</div>}
      {!dossier && !error && <p className="muted">Loading player…</p>}
      {dossier && <Dossier d={dossier} />}
    </PlayerCardFrame>
  );
}

function WatchControls({ playerId, name }: { playerId: number; name: string }) {
  const [watched, setWatched] = useState(false);
  const [note, setNote] = useState('');
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    apiGet<{ watched: boolean; note: string }>(`/api/watchlist/${playerId}`)
      .then((w) => {
        setWatched(w.watched);
        setNote(w.note);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [playerId]);

  const toggle = async () => {
    if (watched) {
      await apiDelete(`/api/watchlist/${playerId}`);
      setWatched(false);
    } else {
      await apiPost('/api/watchlist', { player_id: playerId, name, note });
      setWatched(true);
    }
  };

  const onNote = (value: string) => {
    setNote(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void apiPost('/api/watchlist', { player_id: playerId, name, note: value });
      setWatched(true);
    }, 600);
  };

  if (!loaded) return null;
  return (
    <div className="watch-controls">
      <button className={`watch-star ${watched ? 'on' : ''}`} onClick={toggle} title="Watchlist">
        {watched ? '★ Watching' : '☆ Watch'}
      </button>
      {watched && (
        <textarea
          className="watch-note"
          placeholder="Your notes on this player…"
          value={note}
          onChange={(e) => onNote(e.target.value)}
          rows={2}
        />
      )}
    </div>
  );
}

function Dossier({ d }: { d: PlayerDossier }) {
  const showBatting = !d.isPitcher || d.battingYears.length > 0;
  return (
    <div>
      <div className="dossier-head">
        <div>
          <h2 className="dossier-name">
            {d.uniform !== null && <span className="dossier-number">#{d.uniform}</span>} {d.name}
          </h2>
          {d.nickname && <div className="dossier-nick">“{d.nickname}”</div>}
          <div className="muted">
            {d.roleName ?? d.positionName}{d.twoWay ? ' · Two-way' : ''} · B/T {d.bats}/{d.throws} · Age {d.age}
            {d.heightWeight ? ` · ${d.heightWeight}` : ''}
          </div>
          <div className="muted">{d.team ?? 'No club'}{d.serviceYears !== null ? ` · ${d.serviceYears} yrs MLB service` : ''}</div>
          {d.currentInjury && (
            <div className="injury-note">
              🩹 {d.currentInjury.status}
              {d.currentInjury.daysLeft ? ` — ~${d.currentInjury.daysLeft} days remaining` : ''}
            </div>
          )}
          <AssignmentBlock assignment={d.assignment} />
          <RightsBlock rights={d.rights} />
          <WatchControls playerId={d.player_id} name={d.name} />
        </div>
        {/* Phase 6a: his contract, the Value section's headline and his scouted tools, with how current the data is.
            The Value and Talent percentiles and OOTP's Overall / Potential were players_value figures (D-017) and are gone. */}
        <HeaderValue header={d.header} scouted={d.scouted} />
      </div>

      <div className="dossier-columns">
        {d.isPitcher && d.pitchingRatings && (
          <section>
            <h3>Pitching</h3>
            {d.velocity && <p className="muted velo">Velocity: <strong>{d.velocity}</strong></p>}
            <RatingRows ratings={d.pitchingRatings} />
            {d.pitches.length > 0 && (
              <>
                <h3>Arsenal</h3>
                <RatingRows
                  ratings={Object.fromEntries(d.pitches.map((p) => [p.name, [p.rating, p.talent] as [number, number]]))}
                  labels={PITCH_LABELS}
                />
              </>
            )}
          </section>
        )}
        {!d.isPitcher && d.battingRatings && (
          <section>
            <h3>Batting</h3>
            <RatingRows ratings={d.battingRatings} />
          </section>
        )}
        <section>
          {/* The grades a coach reads before moving anybody, which the card
              never carried — only the components underneath them. Only the
              positions OOTP has revealed appear: it prints a dash at the rest,
              and what the dash hides is not ours to print. */}
          {(d.positionRatings?.length ?? 0) > 0 && (
            <>
              <h3>Positions</h3>
              <table className="mini">
                <tbody>
                  {(d.positionRatings ?? []).map((p) => (
                    <tr key={p.position} className={p.isPrimary ? 'row-us' : ''}>
                      <td>
                        {p.code}
                        {p.isPrimary && <span className="muted"> · listed</span>}
                      </td>
                      <td className="num">{formatRatingPair(p.current, p.potential, ' → ')}</td>
                      <td className="num muted">{p.experience > 0 ? 'has played here' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <span className="muted">
                Only positions OOTP has rated him at. Others stay blank until he plays there.
              </span>
            </>
          )}
          {!d.isPitcher && d.fieldingRatings && (
            <>
              <h3>Fielding</h3>
              <RatingRows
                ratings={Object.fromEntries(
                  Object.entries(d.fieldingRatings)
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => [k, [v, v] as [number, number]])
                )}
              />
            </>
          )}
          {d.contract && d.contract.salarySchedule.length > 0 && (
            <>
              <h3>Contract{d.contract.noTrade ? ' · no-trade' : ''}</h3>
              <table className="mini">
                <tbody>
                  {d.contract.salarySchedule.map((s) => (
                    <tr key={s.year}>
                      <td>{s.year}{s.extension ? <span className="muted"> · extension</span> : null}</td>
                      <td className="num">
                        {s.salary === null ? <span className="muted">not in the export</span> : money(s.salary)}
                        {s.option ? <span className="muted"> · {s.option} option</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>

      <ProductionConeSection playerId={d.player_id} />
      <ValueSection playerId={d.player_id} />

      {showBatting && d.battingYears.length > 0 && (
        <section>
          <h3>Batting History</h3>
          <div className="history-scroll">
            <table className="mini">
              <thead>
                <tr>
                  <th>Year</th><th>Team</th><th>Lvl</th><th>PA</th><th>HR</th><th>RBI</th><th>SB</th>
                  <th>AVG</th><th>OBP</th><th>SLG</th><th>WAR</th>
                </tr>
              </thead>
              <tbody>
                {d.battingYears.map((y, i) => (
                  <tr key={i}>
                    <td>{y.year}</td>
                    <td>{y.team ?? '—'}</td>
                    <td><span className="level-tag">{y.levelName}</span></td>
                    <td className="num">{y.pa}</td>
                    <td className="num">{y.hr}</td>
                    <td className="num">{y.rbi}</td>
                    <td className="num">{y.sb}</td>
                    <td className="num">{fmt3(y.avg as number | null)}</td>
                    <td className="num">{fmt3(y.obp as number | null)}</td>
                    <td className="num">{fmt3(y.slg as number | null)}</td>
                    <td className="num">{y.war}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {d.gameLogs.length > 0 && !d.isPitcher && (
        <section>
          <h3>Last {d.gameLogs.length} Games</h3>
          <div className="history-scroll">
            <table className="mini">
              <thead>
                <tr><th>Date</th><th>Opp</th><th>AB</th><th>H</th><th>HR</th><th>RBI</th><th>BB</th><th>K</th><th>SB</th></tr>
              </thead>
              <tbody>
                {d.gameLogs.map((g, i) => (
                  <tr key={i}>
                    <td>{g.date}</td><td>{g.opp}</td>
                    <td className="num">{g.ab}</td>
                    <td className="num">{g.h}</td>
                    <td className="num">{g.hr}</td>
                    <td className="num">{g.rbi}</td>
                    <td className="num">{g.bb}</td>
                    <td className="num">{g.k}</td>
                    <td className="num">{g.sb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {d.pitchingGameLogs.length > 0 && (
        <section>
          <h3>Recent Outings</h3>
          <div className="history-scroll">
            <table className="mini">
              <thead>
                <tr><th>Date</th><th>Opp</th><th>GS</th><th>IP</th><th>ER</th><th>H</th><th>BB</th><th>K</th></tr>
              </thead>
              <tbody>
                {d.pitchingGameLogs.map((g, i) => (
                  <tr key={i}>
                    <td>{g.date}</td><td>{g.opp}</td>
                    <td className="num">{g.gs}</td>
                    <td className="num">{g.ip}</td>
                    <td className="num">{g.er}</td>
                    <td className="num">{g.ha}</td>
                    <td className="num">{g.bb}</td>
                    <td className="num">{g.k}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(d.fieldingYears?.length ?? 0) > 0 && (
        <section>
          <h3>Fielding</h3>
          <table>
            <thead>
              <tr>
                <th>Year</th><th>Lvl</th><th>Pos</th>
                <th className="num">G</th><th className="num">Inn</th>
                <th className="num">PO</th><th className="num">A</th><th className="num">E</th>
                <th className="num">DP</th><th className="num">FPCT</th><th className="num">RF/9</th>
              </tr>
            </thead>
            <tbody>
              {(d.fieldingYears ?? []).slice(0, 14).map((f, i) => (
                <tr key={i}>
                  <td className="num">{f.year}</td>
                  <td><span className="lvl-badge">{f.levelName}</span></td>
                  <td>{f.positionName}</td>
                  <td className="num">{f.g}</td>
                  <td className="num">{Math.round(f.innings)}</td>
                  <td className="num">{f.po}</td>
                  <td className="num">{f.a}</td>
                  <td className="num">{f.e}</td>
                  <td className="num">{f.dp}</td>
                  <td className="num">{f.fpct !== null ? f.fpct.toFixed(3).replace(/^0\./, '.') : ''}</td>
                  <td className="num">{f.rf9 !== null ? f.rf9.toFixed(2) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Honours first: what a player WAS is the headline of a career page */}
      {(d.awards?.length ?? 0) > 0 && (
        <section>
          <h3>Honours</h3>
          <div className="award-list">
            {Object.entries(
              (d.awards ?? []).reduce<Record<string, number[]>>((acc, a) => {
                const label = a.positionName ? `${a.award} (${a.positionName})` : a.award;
                (acc[label] ??= []).push(a.year);
                return acc;
              }, {})
            )
              // Keep the server's ordering: MVP before an All-Star nod
              .sort(
                (a, b) =>
                  ((d.awards ?? []).find((x) =>
                    (x.positionName ? `${x.award} (${x.positionName})` : x.award) === a[0]
                  )?.rank ?? 99) -
                  ((d.awards ?? []).find((x) =>
                    (x.positionName ? `${x.award} (${x.positionName})` : x.award) === b[0]
                  )?.rank ?? 99)
              )
              .map(([label, years]) => (
                <div key={label} className="award-row">
                  <span className="award-name">
                    {years.length > 1 && <strong>{years.length}× </strong>}
                    {label}
                  </span>
                  <span className="muted">{years.sort((a, b) => b - a).join(', ')}</span>
                </div>
              ))}
          </div>
        </section>
      )}

      {(d.leagueLeader?.length ?? 0) > 0 && (
        <section>
          <h3>Led the League</h3>
          <table className="mini">
            <tbody>
              {(d.leagueLeader ?? []).slice(0, 12).map((l, i) => (
                <tr key={i}>
                  <td className="num muted">{l.year}</td>
                  <td className="num">{l.place === 1 ? '1st' : l.place === 2 ? '2nd' : '3rd'}</td>
                  <td>{l.category}</td>
                  <td className="num">{l.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <StaffNotes playerId={d.player_id} />

      {d.contact && (d.contact.battedBalls ?? 0) > 0 && (
        <section>
          <h3>
            <Tip
              label="Contact Quality"
              tip="Measured from every batted ball he has hit — OOTP records the exit velocity and launch angle of each one and shows none of it. Strikeouts and walks are excluded: they have no batted ball, so they belong in neither the numerator nor the denominator."
            />
          </h3>
          <div className="contact-grid">
            <ContactStat label="Avg exit velo" value={d.contact.avgExitVelo} unit=" mph" league={d.contactLeague?.avgExitVelo} />
            <ContactStat label="Hardest hit" value={d.contact.maxExitVelo} unit=" mph" />
            <ContactStat label="Hard-hit" value={d.contact.hardHitPct} unit="%" league={d.contactLeague?.hardHitPct} />
            <ContactStat label="Barrels" value={d.contact.barrelPct} unit="%" league={d.contactLeague?.barrelPct} />
            <ContactStat label="Sweet spot" value={d.contact.sweetSpotPct} unit="%" />
            <ContactStat label="Sprint speed" value={d.contact.sprintSpeed} unit="" league={d.contactLeague?.sprintSpeed} />
          </div>
          <p className="muted contact-line">
            Ground balls {d.contact.gbPct ?? '—'}% · line drives {d.contact.ldPct ?? '—'}% · fly balls{' '}
            {d.contact.fbPct ?? '—'}% &middot; {d.contact.battedBalls} batted balls
          </p>
          {d.contact.slgLuck !== null && d.contact.slgLuck !== undefined && (
            <p className={`contact-luck ${d.contact.slgLuck <= -0.06 ? 'good-text' : d.contact.slgLuck >= 0.06 ? 'bad-text' : 'muted'}`}>
              {/* Framed as what to expect next, since that is the only reason
                  the gap is worth knowing */}
              Slugging {fmt3(d.contact.slg)} against {fmt3(d.contact.xslg)} expected from his contact
              {d.contact.slgLuck <= -0.06 && ' — he has hit the ball better than the results show, and should improve without changing anything.'}
              {d.contact.slgLuck >= 0.06 && ' — the results have outrun the contact, so expect some giveback.'}
              {d.contact.slgLuck > -0.06 && d.contact.slgLuck < 0.06 && ' — his results match his contact.'}
            </p>
          )}
        </section>
      )}

      {d.splits.length > 1 && (
        <section>
          <h3>
            <Tip
              label="Situational"
              tip="Cut from the base-out state recorded on every plate appearance. Single-season splits are small samples — read the plate-appearance column before drawing a conclusion from any line here."
            />
          </h3>
          <div className="history-scroll">
            <table className="mini">
              <thead>
                <tr><th>Situation</th><th>PA</th><th>AVG</th><th>OPS</th></tr>
              </thead>
              <tbody>
                {d.splits.map((s) => (
                  <tr key={s.label}>
                    <td>{s.label}</td>
                    <td className="num">{s.pa}</td>
                    <td className="num">{fmt3(s.ba)}</td>
                    <td className="num">{fmt3(s.ops)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {d.injuryHistory.length > 0 && (
        <section>
          <h3>Injury History</h3>
          <div className="history-scroll">
            <table className="mini">
              <thead>
                <tr><th>Date</th><th>Missed</th><th>Type</th></tr>
              </thead>
              <tbody>
                {d.injuryHistory.map((h, i) => (
                  <tr key={i}>
                    <td>{h.date}</td>
                    <td className="num">{h.length ? `${h.length} days` : '—'}</td>
                    <td>{h.day_to_day === 1 ? 'Day-to-day' : 'IL stint'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {d.pitchingYears.length > 0 && (
        <section>
          <h3>Pitching History</h3>
          <div className="history-scroll">
            <table className="mini">
              <thead>
                <tr>
                  <th>Year</th><th>Team</th><th>Lvl</th><th>G</th><th>GS</th><th>W-L</th><th>SV</th>
                  <th>IP</th><th>ERA</th><th>WHIP</th><th>K</th><th>BB</th><th>WAR</th>
                </tr>
              </thead>
              <tbody>
                {d.pitchingYears.map((y, i) => (
                  <tr key={i}>
                    <td>{y.year}</td>
                    <td>{y.team ?? '—'}</td>
                    <td><span className="level-tag">{y.levelName}</span></td>
                    <td className="num">{y.g}</td>
                    <td className="num">{y.gs}</td>
                    <td className="num">{y.w}-{y.l}</td>
                    <td className="num">{y.sv}</td>
                    <td className="num">{y.ip}</td>
                    <td className="num">{y.era}</td>
                    <td className="num">{y.whip}</td>
                    <td className="num">{y.k}</td>
                    <td className="num">{y.bb}</td>
                    <td className="num">{y.war}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function RatingRows({
  ratings, labels = RATING_LABELS,
}: { ratings: Record<string, [number, number]>; labels?: Record<string, string> }) {
  return (
    <div className="rating-rows">
      {Object.entries(ratings).map(([key, [cur, pot]]) => (
        <div key={key} className="rating-row">
          <span className="rating-row-label">{labels[key] ?? key}</span>
          <div className="rating wide">
            <div
              className="rating-bar"
              style={{
                width: `${ratingFraction(cur) * 100}%`,
                background: `hsl(${ratingFraction(cur) * 120}, 65%, 45%)`,
              }}
            />
            {pot > cur && (
              <div className="rating-pot" style={{ left: `${ratingFraction(pot) * 100}%` }} />
            )}
            <span>{cur}{pot > cur ? ` / ${pot}` : ''}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * One contact number, with the league's for scale. A raw "39.1% hard-hit"
 * means nothing to anyone who does not already know the league sits at 29.4.
 */
function ContactStat({
  label, value, unit, league,
}: { label: string; value: number | null | undefined; unit: string; league?: number }) {
  return (
    <div className="contact-stat">
      <span className="contact-label">{label}</span>
      <span className="contact-value">{value === null || value === undefined ? '—' : `${value}${unit}`}</span>
      {league !== undefined && <span className="contact-league">lg {league}{unit}</span>}
    </div>
  );
}

interface Note {
  id: number;
  source: string | null;
  body: string;
  game_date: string | null;
}

/**
 * What the staff have said about this man, kept on his page.
 *
 * Advice given in a chat window is only useful while you can still see it. A
 * plan for a pitcher coming back from the injured list is needed weeks later,
 * at the moment he is activated, which is exactly when the conversation is
 * long gone — so it is filed here, with who said it and the date of the game
 * when they did.
 */
function StaffNotes({ playerId }: { playerId: number }) {
  const [notes, setNotes] = useState<Note[]>([]);

  const load = useCallback(() => {
    apiGet<{ notes: Note[] }>(`/api/player-notes/${playerId}`)
      .then((r) => setNotes(r.notes))
      // Notes live in the history database, which a save exported elsewhere may
      // not have; the rest of the card should not care
      .catch(() => setNotes([]));
  }, [playerId]);

  useEffect(load, [load]);

  const remove = async (id: number) => {
    try {
      await apiDelete(`/api/player-notes/${id}`);
      load();
    } catch {
      /* leave it on screen rather than lying about having removed it */
    }
  };

  if (notes.length === 0) return null;

  return (
    <section>
      <h3>Staff Notes</h3>
      {notes.map((n) => (
        <div key={n.id} className="staff-note">
          <div className="staff-note-head">
            <strong>{n.source ?? 'You'}</strong>
            {n.game_date && <span className="muted"> · {n.game_date}</span>}
            <button className="link-button staff-note-x" onClick={() => void remove(n.id)}>
              Remove
            </button>
          </div>
          {n.body.split('\n').filter((l) => l.trim()).map((line, i) => (
            <p key={i}>{line.replace(/\*\*/g, '')}</p>
          ))}
        </div>
      ))}
    </section>
  );
}
