import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { apiGet, apiPost } from '../api';
import { costMoney } from '../costBand';
import { FallbackNotice, type FallbackNoticeData } from '../FallbackNotice';
import { formatWins } from '../productionConeGeometry';
import { PlayerLink } from '../playerModal';
import { Tip } from '../Tip';
import { TradeAnalysisPanel } from '../TradeAnalysis';
import type { TradeAnalysis, TradeDifference, TradeFits, TradePick, TradeProposal, TradeTalkItem, TradeUnit, ValueGlance } from '../tradeApi';

interface SearchResult { player_id: number; name: string; age: number | null; positionName: string; team: string | null }

interface Voice {
  name: string;
  role: string;
}

/** Sent when the chosen model could not be used and another answered. */
type Notice = FallbackNoticeData | null;

interface TradeTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Money or wins, signed as the analyser prints them. */
const amount = (v: number, unit: TradeUnit | null): string =>
  (unit === 'wins' ? `${formatWins(v)} wins` : v < 0 ? `−${costMoney(-v)}` : costMoney(v));
const signedAmount = (v: number, unit: TradeUnit | null): string => (v > 0 ? `+${amount(v, unit)}` : amount(v, unit));

/** A difference in one line: most likely and what it could be, or why there is none. */
function differenceLine(d: TradeDifference, unit: TradeUnit | null): string {
  if (d.status !== 'known' || !d.figure) return 'Not a number yet: no one on one side could be valued.';
  const f = d.figure;
  const likely = f.central !== null ? signedAmount(f.central, unit)
    : f.centralRange ? `${signedAmount(f.centralRange.low, unit)} to ${signedAmount(f.centralRange.high, unit)}` : '';
  return `Coming in less going out: most likely ${likely} · could be ${signedAmount(f.low, unit)} to ${signedAmount(f.high, unit)}`;
}

/** A player's contract value in a few words, or the short reason it is not known. */
function glance(v: ValueGlance): string {
  if (v.status !== 'known' || v.low === null || v.high === null) return v.reason ?? 'Not valued yet.';
  const likely = v.central !== null ? amount(v.central, v.unit)
    : v.centralRange ? `${amount(v.centralRange.low, v.unit)} to ${amount(v.centralRange.high, v.unit)}` : '';
  return `Contract value most likely ${likely} (could be ${amount(v.low, v.unit)} to ${amount(v.high, v.unit)})`;
}

const TIP_OFFER =
  "The same reading the analyser gives: what you'd receive less what you'd send, each player at his contract value. " +
  "The sides are worked out from who each player plays for now, since the message doesn't store them. It isn't a verdict.";
const TIP_FITS =
  'Expected wins this season (the part still to be played, most likely), from each player\'s projection. A match is a player ' +
  "who isn't his club's starter at a position yet is expected to add more wins than the other club's best there. Players " +
  "whose production isn't established are left out. A lead to look into, not a verdict: the ranges behind these figures are wide.";

export function TradeCenter({ orgId, orgLabel }: { orgId: number; orgLabel: string }) {
  const [fits, setFits] = useState<TradeFits | null>(null);
  const [fitsError, setFitsError] = useState<string | null>(null);
  const [sideA, setSideA] = useState<TradePick[]>([]);
  const [sideB, setSideB] = useState<TradePick[]>([]);
  const [analysis, setAnalysis] = useState<TradeAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The conversation about the deal on screen, held here rather than on the
  // server: it belongs to these two lists of players, and they change with
  // every click
  const [thread, setThread] = useState<TradeTurn[]>([]);
  const [voice, setVoice] = useState<Voice | null>(null);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [talk, setTalk] = useState<TradeTalkItem[]>([]);
  const [proposals, setProposals] = useState<TradeProposal[]>([]);
  const builderRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    // Who answers, so the button can carry his name before he has said anything
    setVoice(null);
    apiGet<Voice>(`/api/trade/voice/${orgId}`).then(setVoice).catch(() => setVoice(null));
  }, [orgId]);

  useEffect(() => {
    setFits(null);
    setFitsError(null);
    apiGet<TradeFits>(`/api/trade/fits/${orgId}`).then(setFits).catch((e) => setFitsError((e as Error).message));
  }, [orgId]);

  useEffect(() => {
    setProposals([]);
    apiGet<{ proposals: TradeProposal[] }>(`/api/trade-proposals/${orgId}`)
      .then((r) => setProposals(r.proposals))
      .catch(() => setProposals([]));
  }, [orgId]);

  useEffect(() => {
    setTalk([]);
    apiGet<{ items: TradeTalkItem[] }>(`/api/trade-talk/${orgId}`)
      .then((r) => setTalk(r.items))
      // The inbox is a bonus on top of the analyser, so a save without it
      // should cost the page nothing
      .catch(() => setTalk([]));
  }, [orgId]);

  /*
   * The deal is weighed as it is built: every change to either side asks again, and an answer to an older deal is
   * dropped. Nothing is weighed until both sides have somebody on them.
   */
  const ask = useRef(0);
  useEffect(() => {
    if (sideA.length === 0 || sideB.length === 0) {
      setLoading(false);
      setAnalysisError(null);
      return;
    }
    const mine = ++ask.current;
    setLoading(true);
    setAnalysisError(null);
    const timer = setTimeout(() => {
      apiPost<TradeAnalysis>('/api/trade/analyze', { sideA: sideA.map((p) => p.player_id), sideB: sideB.map((p) => p.player_id), orgId })
        .then((a) => { if (ask.current === mine) setAnalysis(a); })
        .catch((e) => { if (ask.current === mine) setAnalysisError((e as Error).message); })
        .finally(() => { if (ask.current === mine) setLoading(false); });
    }, 150);
    return () => clearTimeout(timer);
  }, [sideA, sideB, orgId, attempt]);

  const resetDesk = () => {
    setThread([]);
    setDraft('');
    setAiError(null);
  };

  const jumpToBuilder = () =>
    // After the paint, not before it: loading the players re-renders the builder,
    // and a scroll begun in the same tick is cancelled by the layout change.
    // Instant rather than smooth — smooth silently does nothing in some
    // embedded browsers, and a jump that sometimes fails to happen is worse
    // than one that always does.
    requestAnimationFrame(() => builderRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' }));

  /** Loads a real offer into the builder, both sides as they were proposed. */
  const reviewProposal = (p: TradeProposal) => {
    resetDesk();
    setSideA(p.weSend.players.map((x) => ({ ...x, team: x.team ?? orgLabel })));
    setSideB(p.theySend.players.map((x) => ({ ...x, team: x.team ?? p.from.label })));
    jumpToBuilder();
  };

  /**
   * Load a suggested target into the builder and take the user to it.
   *
   * A staff note only names the man you would receive — what he costs is the
   * open question, so the other side is left empty for you to fill in. An
   * actual offer is different and goes through reviewProposal above, which
   * carries both sides.
   */
  const review = (item: TradeTalkItem) => {
    resetDesk();
    setSideB([{
      player_id: item.player.player_id, name: item.player.name, age: item.player.age,
      positionName: item.player.positionName, team: item.otherTeam.label,
    }]);
    jumpToBuilder();
  };

  const add = (side: 'sent' | 'received', r: SearchResult) => {
    const set = side === 'sent' ? setSideA : setSideB;
    const list = side === 'sent' ? sideA : sideB;
    const other = side === 'sent' ? sideB : sideA;
    // A player can be on one side only
    if (list.some((p) => p.player_id === r.player_id) || other.some((p) => p.player_id === r.player_id)) return;
    resetDesk();
    set([...list, r]);
  };
  const remove = (side: 'sent' | 'received', id: number) => {
    resetDesk();
    if (side === 'sent') setSideA(sideA.filter((p) => p.player_id !== id));
    else setSideB(sideB.filter((p) => p.player_id !== id));
  };

  /** The two sides as ids, which every request about this deal needs. */
  const deal = () => ({
    sideA: sideA.map((p) => p.player_id),
    sideB: sideB.map((p) => p.player_id),
    // The club matters: the desk weighs the incoming men against whoever
    // already holds their jobs here
    orgId,
    orgLabel,
  });

  const askAI = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      const r = await apiPost<{ verdict: string; voice: Voice; notice: Notice }>('/api/trade/ai-eval', deal());
      setVoice(r.voice);
      setNotice(r.notice ?? null);
      setThread([{ role: 'assistant', content: r.verdict }]);
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  const reply = async () => {
    const message = draft.trim();
    if (!message || aiBusy) return;
    const asked: TradeTurn[] = [...thread, { role: 'user', content: message }];
    setThread(asked);
    setDraft('');
    setAiBusy(true);
    setAiError(null);
    try {
      // The thread sent is the one without the new line in it — that goes as
      // the question, and sending it twice would have him answer it twice
      const r = await apiPost<{ reply: string; voice: Voice; notice: Notice }>(
        '/api/trade/ai-reply', { ...deal(), thread, message }
      );
      setNotice(r.notice ?? null);
      setThread([...asked, { role: 'assistant', content: r.reply }]);
    } catch (e) {
      setAiError((e as Error).message);
      // Put the question back rather than lose what was typed
      setThread(thread);
      setDraft(message);
    } finally {
      setAiBusy(false);
    }
  };

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const both = sideA.length > 0 && sideB.length > 0;

  return (
    <div className="trade-center">
      {proposals.length > 0 && (
        <>
          <h2>Offers on the Table</h2>
          <p className="muted hint-line">
            Proposals in your OOTP inbox. The message doesn't store which way each player goes, so the sides are worked out
            from who each one plays for now: check them against the mail.
          </p>
          <div className="talk-grid">
            {proposals.map((p) => (
              <div key={p.message_id} className="talk-card proposal-card">
                <span className="talk-date">{p.date} · {p.from.label}</span>
                <p className="talk-subject">{p.subject}</p>
                <p className="proposal-side">
                  <span className="proposal-label">They send</span>{' '}
                  {p.theySend.players.map((x, i) => (
                    <span key={x.player_id}>
                      {i > 0 && ', '}
                      <PlayerLink id={x.player_id}>{x.name}</PlayerLink>
                      <span className="muted"> {x.positionName} {x.age ?? ''}</span>
                    </span>
                  ))}
                </p>
                <p className="proposal-side">
                  <span className="proposal-label">You send</span>{' '}
                  {p.weSend.players.map((x, i) => (
                    <span key={x.player_id}>
                      {i > 0 && ', '}
                      <PlayerLink id={x.player_id}>{x.name}</PlayerLink>
                      <span className="muted"> {x.positionName} {x.age ?? ''}</span>
                    </span>
                  ))}
                </p>
                <p className="muted talk-line">
                  <Tip label={differenceLine(p.difference, p.unit)} tip={TIP_OFFER} focusable />
                </p>
                <button type="button" onClick={() => reviewProposal(p)}>Review this offer</button>
              </div>
            ))}
          </div>
        </>
      )}

      {talk.length > 0 && (
        <>
          <h2>Trade Talk in Your Inbox</h2>
          <p className="muted hint-line">
            Targets your staff has raised, newest first. OOTP's messages name the player and the club but never the price,
            so "Review" loads him as the player you'd receive and leaves what you give up to you.
          </p>
          <div className="talk-grid">
            {talk.map((t) => (
              <div key={t.message_id} className="talk-card">
                <span className="talk-date">{t.date}</span>
                <p className="talk-subject">{t.subject}</p>
                <p className="talk-player">
                  <PlayerLink id={t.player.player_id}>{t.player.name}</PlayerLink>{' '}
                  <span className="muted">
                    {t.player.positionName} · {t.player.age ?? '?'} · {t.otherTeam.label}
                  </span>
                </p>
                <p className="muted talk-line">{glance(t.player.value)}</p>
                <p className="muted talk-line">
                  {t.player.control}
                  {t.player.salaryNow ? ` · ${costMoney(t.player.salaryNow.amount)} in ${t.player.salaryNow.season}` : ''}
                </p>
                <button type="button" onClick={() => review(t)}>Review this target</button>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 ref={builderRef}>Trade Analyzer</h2>
      <p className="muted hint-line">
        Add the players you'd send and the ones you'd receive. Each player shows what his contract is worth; below, the
        difference between the sides.
      </p>
      <div>
        <TradeAnalysisPanel
          orgLabel={orgLabel}
          sent={sideA}
          received={sideB}
          loading={loading}
          error={analysisError}
          analysis={analysis}
          onRetry={retry}
          onRemove={remove}
          searchSent={<PlayerSearch label={`Add a player ${orgLabel} would send`} onPick={(r) => add('sent', r)} />}
          searchReceived={<PlayerSearch label={`Add a player ${orgLabel} would receive`} onPick={(r) => add('received', r)} />}
          middle={
            <button type="button" onClick={() => void askAI()} disabled={aiBusy || !both}>
              {aiBusy && thread.length === 0 ? 'Thinking…' : `Ask ${voice ? voice.name : 'the front office'}`}
            </button>
          }
        />
      </div>

      {aiError && <div className="banner error" role="alert">{aiError}</div>}
      {notice && <FallbackNotice notice={notice} />}
      {thread.length > 0 && (
        <div className="ai-verdict">
          {thread.map((turn, i) =>
            turn.role === 'user' ? (
              <p key={i} className="trade-question">
                {turn.content}
              </p>
            ) : (
              <div key={i} className="trade-answer">
                {voice && (
                  <span className="trade-speaker">
                    {voice.name} · {voice.role}
                  </span>
                )}
                {renderAnswer(turn.content)}
              </div>
            )
          )}
          {aiBusy && <p className="muted">Thinking…</p>}
          {/* A read you cannot argue with is the less useful half of one */}
          <div className="trade-reply">
            <input
              value={draft}
              aria-label="Ask a follow-up"
              placeholder={`Ask ${voice ? voice.name.split(' ')[0] : 'a follow-up'}…`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void reply();
              }}
              disabled={aiBusy}
            />
            <button type="button" onClick={() => void reply()} disabled={aiBusy || !draft.trim()}>
              Send
            </button>
          </div>
        </div>
      )}

      <h2>Trade Fits Around the League</h2>
      {fitsError ? (
        <p className="muted">The league's fits couldn't be read: {fitsError}</p>
      ) : !fits ? (
        <p className="muted">Reading every club's depth…</p>
      ) : (
        <>
          <p className="muted hint-line">
            Your weakest spots by <Tip label="expected wins" tip={`${TIP_FITS} ${fits.basis}`} focusable />:{' '}
            {fits.myWeakest.map((w) => `${w.positionName} (${w.best.name}, ${formatWins(w.best.wins)})`).join(', ')}
            {fits.notEstablished.length > 0 && ` · not established: ${fits.notEstablished.join(', ')}`}.
          </p>
          {fits.fits.length === 0 && <p className="muted">No club has a match either way right now.</p>}
          <div className="fit-grid">
            {fits.fits.map((f) => (
              <div key={f.orgId} className="fit-card">
                <h3>{f.label}</h3>
                {f.theyNeed.map((n, i) => (
                  <p key={`n${i}`}>
                    They're thin at <strong>{n.positionName}</strong> (best: {n.theirBest.name}, {formatWins(n.theirBest.wins)}); you
                    have{' '}
                    {n.myCandidates.map((c, j) => (
                      <span key={c.player_id}>
                        {j > 0 && ', '}
                        <PlayerLink id={c.player_id}>{c.name}</PlayerLink> ({formatWins(c.wins)})
                      </span>
                    ))}
                  </p>
                ))}
                {f.theyOffer.map((o, i) => (
                  <p key={`o${i}`}>
                    You're thin at <strong>{o.positionName}</strong> ({o.myBest.name}, {formatWins(o.myBest.wins)}); they have{' '}
                    {o.players.map((c, j) => (
                      <span key={c.player_id}>
                        {j > 0 && ', '}
                        <PlayerLink id={c.player_id}>{c.name}</PlayerLink> ({formatWins(c.wins)})
                      </span>
                    ))}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** The search box for one side: type two letters, pick with the mouse or the keyboard (arrows, Enter, Escape). */
function PlayerSearch({ label, onPick }: { label: string; onPick: (r: SearchResult) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (q: string) => {
    setQuery(q);
    setActive(0);
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(() => {
      apiGet<SearchResult[]>(`/api/search-players?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => setResults([]));
    }, 250);
  };
  const pick = (r: SearchResult) => {
    onPick(r);
    setQuery('');
    setResults([]);
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && results.length > 0) { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp' && results.length > 0) { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active]); }
    else if (e.key === 'Escape') { setResults([]); }
  };

  return (
    <>
      <input
        className="trade-search"
        placeholder="Search a player…"
        aria-label={label}
        value={query}
        onChange={(e) => search(e.target.value)}
        onKeyDown={keys}
      />
      {results.length > 0 && (
        <div className="trade-results" role="listbox" aria-label={label}>
          {results.map((r, i) => (
            <button
              type="button"
              key={r.player_id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onClick={() => pick(r)}
            >
              {r.name} · {r.positionName} · {r.age ?? '?'} · {r.team ?? ''}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The model writes markdown. Only the bold and heading markers ever show up
 * here, and "## Read" was being printed with its hashes on the page.
 */
function renderAnswer(text: string) {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((line, i) => {
      const heading = /^#{1,6}\s+/.test(line);
      const body = line.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '');
      return heading ? <h4 key={i}>{body}</h4> : <p key={i}>{body}</p>;
    });
}
