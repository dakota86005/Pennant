/**
 * Farm & Development ▸ Organization (N10; React's Organization view and the Overview's reading of the system): the
 * farm as one organization, where it is piled up and where it is thin. Counts, never quality: whether a player is good
 * is Player Development's, beside the count. The depth's tone reads Minor League Operations' own line for the upper
 * minors (`UPPER_MINORS_DEPTH_FLOOR`, served with the reading), never a line of the app's own.
 */
import type { FarmSystemView } from '../../farmOperations.js';
import { cell, claim, row } from '../claim.js';
import { decisionTarget, factBasis, findingsWorstFirst, findingView, headOf, lastNameKey, linesCalled } from './common.js';
import type { FarmContext } from './input.js';
import type { FarmDepthRow, FarmLineRow, FarmOrganizationView, FarmPlayerRow, FarmStartersRow } from './types.js';
import { MINOR_LEAGUE_OPS, plain, plural } from './words.js';

const FIELD_ORDER = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

/** The farm's own line for the upper minors' depth, read from what the reading says it used. */
function depthFloor(system: FarmSystemView): number | null {
  const line = system.calibration.find((c) => c.name === 'UPPER_MINORS_DEPTH_FLOOR');
  const n = line ? Number.parseFloat(line.value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** The line's kind, in words ("Policy", "Starting value", "Fitted"). */
const KIND: Record<string, string> = { policy: 'Policy', provisional: 'Starting value', measured: 'Measured on this save', calibrated: 'Fitted to this save' };

/** "thin below 7 · critical below 5 · crowded at 9" for a line stated as an object; the value itself otherwise. */
function lineValue(value: string): string {
  const words = (v: unknown, sep: string): string => (v !== null && typeof v === 'object' && !Array.isArray(v)
    ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()} ${words(x, ', ')}`).join(sep)
    : Array.isArray(v) ? v.join(', ') : String(v));
  if (!value.startsWith('{') && !value.startsWith('[')) return plain(value);
  try {
    return plain(words(JSON.parse(value), ' · '));
  } catch {
    return plain(value);
  }
}

export function organizationView(ctx: FarmContext, system: FarmSystemView): FarmOrganizationView {
  const called = linesCalled(system.calibration);
  const { scope } = system.organization;
  const affiliates = system.affiliates.length;
  const parts = [
    `${plural(scope.players, 'player')} across ${plural(affiliates, 'affiliate')}.`,
    `Player Development can read ${scope.assessed} of them; ${scope.indeterminate} can't be judged on the evidence there is and ${scope.notAssessable} have no season to read yet.`,
    scope.rehab > 0 ? `${plural(scope.rehab, 'player')} on rehab from the major-league club ${scope.rehab === 1 ? 'is' : 'are'} not counted as affiliate depth.` : '',
  ].filter(Boolean);
  const scopeClaim = claim({
    text: parts.join(' '),
    tone: 'neutral',
    basis: factBasis(ctx, MINOR_LEAGUE_OPS, [
      { label: 'Players', value: String(scope.players) },
      { label: 'Affiliates', value: String(affiliates) },
      { label: 'Read by Player Development', value: String(scope.assessed) },
      { label: 'Can\'t be judged yet', value: String(scope.indeterminate) },
      { label: 'No season to read', value: String(scope.notAssessable) },
      { label: 'On rehab from the major-league club', value: String(scope.rehab) },
    ]),
  });

  const levels = system.organization.startersByLevel.map((l) => ({ id: String(l.level), name: l.levelName }));
  const floor = depthFloor(system);
  const depth: FarmDepthRow[] = system.organization.distribution.map((d) => {
    const at = levels.map((l) => d.byLevel.find((b) => String(b.level) === l.id) ?? null);
    const tone = floor === null ? 'neutral' as const : d.upperMinors < floor ? 'bad' as const : d.upperMinors === floor ? 'caution' as const : 'good' as const;
    return {
      id: `depth:${d.position}`,
      position: cell(d.position),
      atLevels: at.map((b) => (b === null || b.players === 0
        ? cell('0', { tone: 'neutral' })
        : cell(b.priority > 0 ? `${b.players} (${b.priority} with high stakes)` : String(b.players), b.priority > 0 ? { hint: 'High stakes: a core or protected prospect, or development-sensitive' } : {}))),
      upperMinors: cell(String(d.upperMinors), {
        tone,
        hint: floor === null ? undefined : d.upperMinors < floor ? `Below the farm's line of ${floor} in the upper minors` : d.upperMinors === floor ? `At the farm's line of ${floor} in the upper minors` : undefined,
      }),
      sort: {
        position: FIELD_ORDER.indexOf(d.position) >= 0 ? FIELD_ORDER.indexOf(d.position) : FIELD_ORDER.length,
        atLevels: at.map((b) => b?.players ?? 0),
        upperMinors: d.upperMinors,
      },
    };
  });

  const starters: FarmStartersRow[] = system.organization.startersByLevel.map((l) => {
    const over = l.developmentalStarters - l.rotationSpots;
    return row(
      `starters:${l.level}`,
      {
        level: cell(l.levelName),
        starters: cell(String(l.developmentalStarters)),
        spots: cell(String(l.rotationSpots)),
        state: over > 0 ? cell(`${over} without a spot`, { tone: 'caution' }) : cell('Every man has a spot', { tone: 'good' }),
      },
      { level: l.level, starters: l.developmentalStarters, spots: l.rotationSpots, state: over },
    );
  });

  const past = system.assignments.filter((a) => a.conclusion === 'organizational_question');
  const pastRows: FarmPlayerRow[] = past.map((a) => ({
    ...row(
      `past:${a.playerId}`,
      { player: cell(a.name), age: cell(String(a.age)), level: cell(a.levelName), club: cell(a.team) },
      { player: lastNameKey(a.name), age: a.age, level: a.level, club: a.team },
    ),
    playerId: a.playerId,
    open: decisionTarget(a.playerId),
  }));

  const lines: FarmLineRow[] = system.calibration.map((c) => row(
    `line:${c.name}`,
    {
      // The line's own name is a code term: the plain sentence of what it is leads (the name stays in the old route)
      name: cell(plain(c.basis) || 'A line Minor League Operations states'),
      value: cell(lineValue(c.value)),
      kind: cell(KIND[c.status] ?? plain(c.status)),
      why: cell(KIND[c.status] === 'Policy' ? 'Chosen by the club\'s staff, not fitted' : c.status === 'measured' ? 'Measured on this save\'s own players' : 'A starting value until this save can show better'),
    },
    { name: c.name, value: c.value, kind: c.status, why: c.basis },
  ));

  return {
    ...headOf(ctx),
    scope: scopeClaim,
    findings: findingsWorstFirst(system.organization.findings).map((f) => findingView(ctx, f, called)),
    findingsEmpty: system.organization.findings.length
      ? null
      : cell('No system-wide congestion or depth problem is visible: no position has two high-stakes prospects on the same path at one level, and no level is developing more starters than it has rotation spots.'),
    levels,
    depth,
    depthNote: cell('Players who can play each position, by level. Depth counts what a man can play; congestion counts the one path he is on.'),
    starters,
    startersNote: cell('Pitchers each club is using as starters, against the spots the level has. A man past the spots is a man not starting.'),
    pastWindow: past.length
      ? {
        title: cell(`${plural(past.length, 'player')} ${past.length === 1 ? 'is' : 'are'} past the level's developmental window`),
        note: cell('The level has no developmental value left for them, so where each plays is a question of what the organization needs and who else needs the work, not of his development.'),
        rows: pastRows,
      }
      : null,
    lines,
    unknowns: [...new Set([...system.unknowns].map(plain).filter(Boolean))].map((u) => cell(u)),
  };
}

