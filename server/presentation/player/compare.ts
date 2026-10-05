/**
 * Two to four players side by side (N11, the Compare window), in words. Built only from each player's dossier as served
 * (`dossier.ts`), so a figure in the comparison is the same figure his own window shows; nothing is recomputed. The same
 * field is lined up for every player; a range is compared only by whether it overlaps another (D-052: no verdict, no
 * combined score, no rank). Expected wins are told apart on the range each player lands in half the time and drawn on the
 * wider one, as the roster map places players (D-057); a total of value on its range of reasonable outcomes. A player
 * with no figure is named as not known and left out of the reading (D-018).
 */
import type { Cell } from '../../contract/presentation.js';
import { basis, cell, claim } from '../claim.js';
import type { CompareCell, CompareRow, CompareSection, PlayerCompareView, PlayerDossierView } from './types.js';
import { rangeText, signedMoney, signedTenths, winsText } from './words.js';

interface Ranged {
  name: string;
  /** The range compared (for expected wins, the one he lands in half the time). */
  low: number;
  high: number;
}

const OVERLAP_STAMP = 'Compared by overlap only';

/** Players with a range, read by overlap: which pairs are told apart, the rest said to overlap. */
function overlapWords(ranged: readonly Ranged[], unknown: readonly string[], what: string, fmt: (v: number) => string, comparedOn: string) {
  if (ranged.length + unknown.length < 2) return null;
  const apart: string[] = [];
  let overlapping = 0;
  for (let i = 0; i < ranged.length; i++) {
    for (let j = i + 1; j < ranged.length; j++) {
      const a = ranged[i];
      const b = ranged[j];
      if (a.low > b.high) apart.push(`${a.name}'s range sits wholly above ${b.name}'s`);
      else if (b.low > a.high) apart.push(`${b.name}'s range sits wholly above ${a.name}'s`);
      else overlapping += 1;
    }
  }
  const pairs = (ranged.length * (ranged.length - 1)) / 2;
  let text: string;
  if (ranged.length < 2) text = `Nothing to compare: ${unknown.length === 1 ? `${unknown[0]} isn't` : 'they aren\'t'} valued here`;
  else if (apart.length === 0) text = pairs === 1 ? "Can't tell apart: the ranges overlap" : "Can't tell apart: every range overlaps";
  else text = `${apart.join('; ')}${overlapping > 0 ? '; the rest overlap' : ''}`;
  if (unknown.length && ranged.length >= 2) text = `${text}. Not known for ${unknown.join(' and ')}`;
  return claim({
    text, tone: apart.length ? 'neutral' : 'unknown',
    basis: basis({
      because: [
        ...ranged.map((r) => ({ label: r.name, value: rangeText(r.low, r.high, fmt) })),
        { label: 'How it is read', value: `Two players are told apart on ${what} only when their ranges don't overlap (${comparedOn}). A range sitting above another says which figure is higher, not who is the better player.` },
      ],
      source: { department: 'finance', specialist: 'Player Value', asOf: null, gameDate: null },
      unknown: unknown.map((n) => `${n} has no figure here, so he is left out of the reading.`),
      wouldChange: ['A new export that moves either range.'], lean: null, certainty: 'policy', stamp: OVERLAP_STAMP,
    }),
  });
}

const dash = (hint?: string): CompareCell => ({ display: cell('—', hint ? { hint, tone: 'unknown' } : { tone: 'unknown' }), range: null });
const shown = (c: Cell, range: CompareCell['range'] = null): CompareCell => ({ display: c, range });

/** One fact row, by its served label, for every player ("Age", "Club"); a player without it reads "—". */
function factRow(views: readonly PlayerDossierView[], id: string, label: string, from: 'overview' | 'contract'): CompareRow | null {
  const cells = views.map((v) => {
    const f = (from === 'overview' ? v.overview.facts : v.contract.facts).find((x) => x.label.display === label);
    return f ? shown(f.value) : dash();
  });
  return cells.every((c) => c.range === null && c.display.display === '—') ? null : { id, label: cell(label), cells, reading: null };
}

function totalRow(views: readonly PlayerDossierView[], id: 'contract' | 'keeping' | 'wins'): CompareRow | null {
  const totals = views.map((v) => v.value.totals.find((t) => t.id === id) ?? null);
  if (totals.every((t) => t === null)) return null;
  const title = totals.find((t) => t !== null)!.title;
  const fmt = id === 'wins' ? winsText : signedMoney;
  const ranged: Ranged[] = [];
  const unknown: string[] = [];
  const cells = views.map((v, i) => {
    const t = totals[i];
    const value = t?.headline.value;
    if (!t || !t.known || !value || value.low === undefined || value.high === undefined) {
      unknown.push(v.name);
      return t ? shown(cell('Not valued yet', { tone: 'unknown', hint: t.headline.text.length <= 75 ? t.headline.text : 'Not valued yet' })) : dash('Not valued here');
    }
    ranged.push({ name: v.name, low: value.low, high: value.high });
    return shown(cell(t.headline.text, t.couldBe ? { hint: t.couldBe.display.length <= 75 ? t.couldBe.display : undefined } : {}), { low: value.low, high: value.high, mid: value.n });
  });
  return {
    id: `value-${id}`, label: title, cells,
    reading: overlapWords(ranged, unknown, title.display.toLowerCase(), fmt, 'the range of reasonable outcomes'),
  };
}

function winsRows(views: readonly PlayerDossierView[]): CompareRow[] {
  const seasons = [...new Set(views.flatMap((v) => v.value.cone.seasons.map((s) => s.season)))].sort((a, b) => a - b).slice(0, 3);
  return seasons.map((season) => {
    const ranged: Ranged[] = [];
    const unknown: string[] = [];
    const cells = views.map((v) => {
      const s = v.value.cone.seasons.find((x) => x.season === season);
      if (!s || !s.established || s.expected === null || !s.inner || !s.outer) {
        unknown.push(v.name);
        return dash(s ? 'Production not established' : 'Not projected that season');
      }
      ranged.push({ name: v.name, low: s.inner.low, high: s.inner.high });
      return shown(cell(winsText(s.expected), { hint: `Half the time ${rangeText(s.inner.low, s.inner.high, signedTenths)}` }), { low: s.outer.low, high: s.outer.high, mid: s.expected });
    });
    return {
      id: `wins-${season}`, label: cell(`Expected wins, ${season}`), cells,
      reading: overlapWords(ranged, unknown, `expected wins in ${season}`, signedTenths, 'the range each lands in half the time, as the roster map places players'),
    };
  });
}

function scoutedRows(views: readonly PlayerDossierView[]): CompareRow[] {
  const rows: CompareRow[] = [];
  const tile = views.map((v) => v.header.tiles.find((t) => t.id === 'scouted') ?? null);
  if (tile.some((t) => t !== null)) {
    rows.push({
      id: 'scouted', label: cell('Scouted, now → ceiling'),
      cells: views.map((v, i) => (tile[i] ? shown(cell(tile[i]!.figure.text, v.header.ratingsFill?.hint ? { hint: v.header.ratingsFill.hint } : {})) : dash('Not scouted'))),
      reading: null,
    });
  }
  // Every grade any of them has, in the first player's order, then the others' new ones
  const order: Array<{ group: string; id: string; label: Cell }> = [];
  for (const v of views) {
    for (const g of v.ratings.groups.filter((x) => x.id !== 'positions')) {
      for (const r of g.rows) if (!order.some((o) => o.group === g.id && o.id === r.id)) order.push({ group: g.id, id: r.id, label: r.cells.tool });
    }
  }
  for (const o of order) {
    rows.push({
      id: `grade-${o.group}-${o.id}`, label: o.label,
      cells: views.map((v) => {
        const r = v.ratings.groups.find((g) => g.id === o.group)?.rows.find((x) => x.id === o.id);
        return r ? shown(r.cells.grade, r.now === null ? null : { low: r.now, high: r.ceiling ?? r.now, mid: r.now }) : dash(`No ${o.group} grades for him`);
      }),
      reading: null,
    });
  }
  return rows;
}

/** The comparison: the players, and the same fields lined up for each, in sections. */
export function compareView(views: readonly PlayerDossierView[], orgId: number, importStamp: string | null): PlayerCompareView {
  const who = [factRow(views, 'position', 'Position', 'overview'), factRow(views, 'age', 'Age', 'overview'), factRow(views, 'club', 'Club', 'overview'),
    factRow(views, 'bt', 'Bats / throws', 'overview'), factRow(views, 'service', 'Major-league service', 'overview')].filter((r): r is CompareRow => r !== null);
  const thisSeason: CompareRow = {
    id: 'thisSeason', label: cell('This season'),
    cells: views.map((v) => (v.overview.thisSeason ? shown(cell(v.overview.thisSeason.text)) : dash('No statistics this season'))),
    reading: null,
  };
  const contract = [factRow(views, 'salary', 'This season', 'contract'), factRow(views, 'term', 'Term', 'contract'),
    factRow(views, 'after', 'After this season', 'contract')].filter((r): r is CompareRow => r !== null);
  const value = [totalRow(views, 'contract'), totalRow(views, 'keeping'), totalRow(views, 'wins')].filter((r): r is CompareRow => r !== null);
  const sections: CompareSection[] = [
    { id: 'who', title: cell('Who'), rows: [...who, thisSeason] },
    { id: 'contract', title: cell('Contract'), rows: contract },
    { id: 'value', title: cell('Value'), rows: [...value, ...winsRows(views)] },
    { id: 'scouted', title: cell('Scouted grades'), rows: scoutedRows(views) },
  ].filter((s) => s.rows.length > 0);
  return {
    orgId,
    importStamp,
    players: views.map((v) => ({
      playerId: v.playerId, name: v.name, line: v.header.line, open: v.open, ratingsFill: v.header.ratingsFill,
    })),
    note: cell('Each figure is his own, as his window shows it; ranges are compared only by whether they overlap', { hint: 'Nothing here says who is the better player' }),
    sections,
  };
}
