import { useEffect, useState } from 'react';
import { getFreeAgents, type FreeAgentRow, type FreeAgentsResponse } from '../api';
import { FinanceCards, money } from './Contracts';
import { PlayerLink, Tip } from '../playerModal';
import { Th } from '../Th';

/*
 * OOTP's Value and Talent percentiles, which Free Agents still shows until its own Player Value migration (PLAYER_VALUE.md
 * Part 8, consumer 4). The player card and Contracts dropped them in phase 6a; they live here with their last reader and
 * go when it migrates.
 */
const TIP_VALUE =
  "OOTP's evaluation of the player's current worth to a club, shown as a percentile against others " +
  'in his own role — position players, starters and relievers are ranked separately. 86 means better ' +
  'right now than 86% of MLB-rostered players doing his job.\n\n' +
  'The split matters because the underlying number includes playing time: a closer throws around 65 ' +
  'innings, so ranking him against starters and everyday players would bury even an excellent one.';
const TIP_TALENT =
  'The scouted ceiling (potential), as a percentile against MLB-rostered players in the same role. ' +
  'Talent well below Value suggests decline risk; well above suggests untapped upside still to develop. ' +
  'A settled veteran often sits lower here than on Value simply because most of the league still has ' +
  'projection left and he does not.';

function Pct({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>;
  const hue = (value / 100) * 120;
  return <span style={{ color: `hsl(${hue}, 65%, 55%)` }}>{value}</span>;
}

export function FreeAgents({ orgId }: { orgId: number }) {
  const [data, setData] = useState<FreeAgentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posFilter, setPosFilter] = useState<string>('');

  useEffect(() => {
    setData(null);
    getFreeAgents(orgId).then(setData).catch((e) => setError(e.message));
  }, [orgId]);

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <p className="muted">Loading free agents…</p>;

  const positions = [...new Set(data.upcomingFAs.concat(data.currentFAs).map((p) => p.positionName))].sort();
  const filter = (rows: FreeAgentRow[]) => (posFilter ? rows.filter((p) => p.positionName === posFilter) : rows);

  return (
    <div>
      <FinanceCards finances={data.finances} />
      <div className="toolbar">
        <span className="muted">
          Weakest positions by best available player:{' '}
          {data.holes.slice(0, 3).map((h) => h.positionName).join(', ')}
        </span>
        <select value={posFilter} onChange={(e) => setPosFilter(e.target.value)}>
          <option value="">All positions</option>
          {positions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      <h2>Available now</h2>
      {filter(data.currentFAs).length === 0 ? (
        <p className="muted">Nobody worth a look on the open market right now.</p>
      ) : (
        <FATable rows={filter(data.currentFAs)} holes={data.holes} />
      )}

      <h2>Hitting the market after this season</h2>
      <p className="muted hint-line">
        Players around the league on expiring deals with enough service time to reach free agency — your
        offseason shopping list. Team-controlled players (pre-arb/arb) are excluded.
        {data.upcomingLeaving !== undefined && <> {data.upcomingLeaving} reach free agency in all; the list shows those above the value cut.</>}
        {(data.upcomingIndeterminate ?? 0) > 0 && (
          <> {data.upcomingIndeterminate} more expiring deal{data.upcomingIndeterminate === 1 ? '' : 's'} could
            go either way: the save cannot yet establish whether {data.upcomingIndeterminate === 1 ? 'he reaches' : 'they reach'} free
            agency, so {data.upcomingIndeterminate === 1 ? 'he is' : 'they are'} not listed.</>
        )}
        {(data.upcomingUndecided ?? 0) > 0 && (
          <> {data.upcomingUndecided} more {data.upcomingUndecided === 1 ? 'player has' : 'players have'} an option or an opt-out
            on next season: whether {data.upcomingUndecided === 1 ? 'he reaches' : 'they reach'} the market is a decision still to be
            made, so {data.upcomingUndecided === 1 ? 'he is' : 'they are'} not listed.</>
        )}
      </p>
      <FATable rows={filter(data.upcomingFAs)} holes={data.holes} />
    </div>
  );
}

function FATable({
  rows, holes,
}: { rows: FreeAgentRow[]; holes: FreeAgentsResponse['holes'] }) {
  const holeSet = new Set(holes.slice(0, 3).map((h) => h.positionName));
  return (
    <table>
      <thead>
        <tr>
          <Th>Pos</Th>
          <Th>Player</Th>
          <Th>Age</Th>
          <th><Tip label="Value" tip={TIP_VALUE} /></th>
          <th><Tip label="Talent" tip={TIP_TALENT} /></th>
          <Th>Current salary</Th>
          <Th>Team</Th>
          <Th>Fit</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.player_id}>
            <td>{p.positionName}</td>
            <td className="name"><PlayerLink id={p.player_id}>{p.name}</PlayerLink></td>
            <td>{p.age}</td>
            <td className="num"><Pct value={p.overallPct} /></td>
            <td className="num"><Pct value={p.talentPct} /></td>
            <td className="num">{money(p.lastSalary)}</td>
            <td>{p.team ?? '—'}</td>
            <td>{holeSet.has(p.positionName) && <span className="badge promote">fills hole</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
