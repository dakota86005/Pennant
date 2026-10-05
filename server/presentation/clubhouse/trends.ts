/**
 * Season Trends (N9): the season game by game, worded from `computeTrends` (the React page's `/api/trends`). The server
 * serves the lines and what each means; the app draws them (Swift Charts) and writes nothing. A rolling line has no
 * point before its window fills (no value, never zero, D-018), a club with no game played says so rather than drawing
 * an empty chart, and nothing here is odds or a posture (D-060).
 */
import type { Trends } from '../../trends.js';
import { cell } from '../claim.js';
import { factClaim, head, plural, type ClubhouseContext } from './common.js';
import type { MlbSeasonTrendsView, MlbTrendChart, MlbTrendPoint, MlbTrendSeries } from './types.js';

const TRENDS = 'The season\'s games';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The route's axis label ("5/9") in words ("May 9"). */
const labelWords = (label: string): string => {
  const [m, d] = label.split('/').map(Number);
  return m >= 1 && m <= 12 && d ? `${MONTHS[m - 1]} ${d}` : label;
};

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))}`;

function points(labels: string[], values: Array<number | null>, display: (n: number) => string): MlbTrendPoint[] {
  return values.map((value, i) => ({
    game: i + 1,
    date: labelWords(labels[i] ?? ''),
    value: value === null || !Number.isFinite(value) ? null : value,
    display: value === null || !Number.isFinite(value) ? 'No point yet' : display(value),
  }));
}

function series(id: string, title: string, role: string, pts: MlbTrendPoint[]): MlbTrendSeries {
  return { id, title: cell(title), role, points: pts };
}

export interface TrendsInput {
  trends: Trends | string;
}

export function seasonTrendsView(v: ClubhouseContext, input: TrendsInput): MlbSeasonTrendsView {
  const base = head(v, 'Season Trends', {
    text: 'The season game by game: run differential, scoring and winning percentage',
    full: 'How the season has gone, one game at a time: the run differential as it built, runs scored and allowed smoothed over a rolling window so single blowouts don\'t swing them, and the winning percentage to date.',
    specialist: TRENDS,
  });
  const t = input.trends;
  if (typeof t === 'string') return { ...base, summary: null, charts: [], empty: cell(`${t}.`) };
  if (t.games === 0 || !('totals' in t)) return { ...base, summary: null, charts: [], empty: cell('No games played yet in this save.') };
  const w = t.window;
  const diff = t.series.cumulativeDiff;
  const final = diff[diff.length - 1] ?? 0;
  const summary = factClaim(v, `${plural(t.games, 'game')} played · ${t.totals.perGameScored.toFixed(2)} runs scored a game, ${t.totals.perGameAllowed.toFixed(2)} allowed`, {
    specialist: TRENDS,
    because: [
      { label: 'Runs scored', value: String(t.totals.scored) },
      { label: 'Runs allowed', value: String(t.totals.allowed) },
      { label: 'Smoothing', value: `The scoring lines are a rolling ${w}-game average, so single blowouts don't swing them.` },
    ],
  });
  const charts: MlbTrendChart[] = [
    {
      id: 'differential',
      title: cell('Run differential'),
      headline: cell(`${signed(final)} on the season`, { tone: final > 0 ? 'good' : final < 0 ? 'bad' : 'neutral' }),
      caption: factClaim(v, 'Every game moves the line by that game\'s margin', {
        specialist: TRENDS,
        because: [{ label: 'How to read it', value: 'A line drifting down while the record looks fine is the classic sign of a club winning close games, which rarely holds.' }],
      }),
      axis: cell('Run differential'),
      baseline: 0,
      series: [series('differential', 'Run differential', 'main', points(t.labels, diff, signed))],
      summary: `Run differential over ${plural(t.games, 'game')}, ending at ${signed(final)}.`,
    },
    {
      id: 'scoring',
      title: cell('Scoring and run prevention'),
      headline: null,
      caption: factClaim(v, `The lines start once ${w} games are in the books`, {
        specialist: TRENDS,
        because: [{ label: 'Why', value: `Each point is the average of the last ${w} games; a rolling average has nothing to say before then.` }],
      }),
      axis: cell('Runs per game'),
      baseline: null,
      series: [
        series('scored', `Runs scored (${w}-game average)`, 'scored', points(t.labels, t.series.runsScoredRolling, (n) => n.toFixed(1))),
        series('allowed', `Runs allowed (${w}-game average)`, 'allowed', points(t.labels, t.series.runsAllowedRolling, (n) => n.toFixed(1))),
      ],
      summary: `Runs scored and allowed a game, averaged over ${w} games, across ${plural(t.games, 'game')}: ${t.totals.perGameScored.toFixed(2)} scored and ${t.totals.perGameAllowed.toFixed(2)} allowed on the season.`,
    },
    {
      id: 'winning',
      title: cell('Winning percentage'),
      headline: null,
      caption: factClaim(v, 'Season to date, not a rolling window; the rule marks .500', {
        specialist: TRENDS,
        because: [{ label: 'How to read it', value: 'Each point is the share of games won up to that game.' }],
      }),
      axis: cell('Win percentage'),
      baseline: 50,
      series: [series('winning', 'Win %', 'main', points(t.labels, t.series.winPct, (n) => `${Math.round(n)}%`))],
      summary: `Winning percentage over ${plural(t.games, 'game')}, ending at ${Math.round(t.series.winPct[t.series.winPct.length - 1] ?? 0)}%.`,
    },
  ];
  return { ...base, summary, charts, empty: null };
}
