/**
 * Farm & Development ▸ Affiliates (N10; React's Affiliates view and the Overview's strip of clubs): the organization
 * from the major-league club down, and each affiliate read twice. Operational health is "can this club field a team and
 * cover a schedule"; developmental health is "are the players here developing". The two are separate states, never one
 * (D-045): a club is often fine on one and not the other.
 */
import type { Cell } from '../../contract/presentation.js';
import type { FarmSystemView } from '../../farmOperations.js';
import { cell, claim, row, target } from '../claim.js';
import { affiliateTarget, decisionTarget, findingView, headOf, judgmentBasis, linesCalled, playerLine } from './common.js';
import type { FarmContext, MajorLeagueClub } from './input.js';
import type { FarmAffiliateDetail, FarmAffiliatesView, FarmClubStep, FarmConcernRow, FarmCoverRow } from './types.js';
import { MINOR_LEAGUE_OPS, PLAYER_DEVELOPMENT, plain, plainAll, plural, statusWord, verdictWord, type Toned } from './words.js';

type Affiliate = FarmSystemView['affiliates'][number];

/** Are the players here developing, from Player Development's findings on the club: costing, worth a look, or none. */
function developmentalWord(a: Affiliate): Toned {
  const findings = a.developmental.findings;
  if (findings.some((f) => f.severity === 'critical')) return { text: 'Costing development', tone: 'bad' };
  if (findings.some((f) => f.severity === 'attention')) return { text: 'Worth a look', tone: 'caution' };
  return { text: 'No issue found', tone: 'good' };
}

const FIELD_ORDER = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

function affiliateDetail(ctx: FarmContext, a: Affiliate, called: ReturnType<typeof linesCalled>): FarmAffiliateDetail {
  const op = a.operational;
  const dev = a.developmental;
  const status = statusWord(op.status);
  const devWord = developmentalWord(a);
  const roster = op.roster;

  const cover: FarmCoverRow[] = op.coverage.map((c) => {
    const bodies = c.graded + c.listedOnly;
    return row(
      `cover:${a.teamId}:${c.position}`,
      {
        position: cell(c.critical ? `${c.position} *` : c.position, c.critical ? { hint: 'A shortage here can\'t be covered by moving somebody else' } : {}),
        graded: cell(String(c.graded), { tone: bodies === 0 ? 'bad' : bodies === 1 ? 'caution' : 'good' }),
        listedOnly: c.listedOnly > 0 ? cell(String(c.listedOnly)) : cell('None', { tone: 'neutral' }),
        strong: cell(String(c.strong)),
      },
      { position: FIELD_ORDER.indexOf(c.position), graded: c.graded, listedOnly: c.listedOnly, strong: c.strong },
    );
  });

  const concerns: FarmConcernRow[] = dev.concerns.map((c) => {
    const verdict = verdictWord(c.verdict);
    return {
      ...row(
        `concern:${c.playerId}`,
        {
          player: cell(c.name),
          age: cell(String(c.age)),
          verdict: cell(verdict.text, { tone: verdict.tone }),
          question: c.question === 'none' ? cell('No one\'s yet', { tone: 'neutral' }) : cell(c.question === 'developmental' ? 'Player Development\'s' : 'The organization\'s'),
          summary: cell(plain(c.summary) || verdict.text),
        },
        { player: c.name, age: c.age, verdict: c.verdict, question: c.question, summary: plain(c.summary) },
      ),
      playerId: c.playerId,
      open: decisionTarget(c.playerId),
    };
  });

  const treatment = a.rosterTreatment;
  const rosterContext = [
    ...treatment.injured.map((p) => playerLine(
      p.playerId,
      p.name,
      `${p.name} (${p.listedPosition}): injured${p.daysLeft !== null ? `, ${plural(p.daysLeft, 'day')} left` : ''}. Not counted as cover or as a man taking starts, and he competes for no job while he is out.`,
    )),
    ...treatment.rehab.map((p) => playerLine(p.playerId, p.name, `${p.name}: on an injury-rehab assignment from the major-league club. He is here, and he is not counted in anything above.`)),
    ...treatment.ambiguous.map((p) => playerLine(
      p.playerId,
      p.name,
      `${p.name}: ${plain(p.reason)} He is counted, because nothing establishes otherwise; if he is in fact on rehab, this club's depth is overstated.`,
    )),
  ];

  const assessment = [
    `Player Development can read ${dev.assessment.assessed} of this club's players.`,
    dev.assessment.indeterminate > 0 ? `${dev.assessment.indeterminate} can't be judged on the evidence there is.` : '',
    dev.assessment.notAssessable > 0 ? `${dev.assessment.notAssessable} have no season to read yet.` : '',
  ].filter(Boolean).join(' ');

  return {
    teamId: a.teamId,
    name: a.label,
    line: cell(`${a.levelName} · ${a.leagueName} · ${plural(a.games, 'game')} played · ${roster.total} on the active list (${plural(roster.positionPlayers, 'position player')}, ${plural(roster.pitchers, 'pitcher')})`),
    operational: claim({
      text: status.text,
      tone: status.tone,
      hint: 'Can the club field a team and cover a schedule?',
      basis: judgmentBasis(ctx, MINOR_LEAGUE_OPS, {
        because: [
          { label: 'Active list', value: `${roster.total} (${roster.positionPlayers} position players, ${roster.pitchers} pitchers)` },
          { label: 'Positions it can fill at once', value: `${op.fieldablePositions} of 8` },
          { label: 'Starters against rotation spots', value: `${op.pitching.starters} against ${op.pitching.rotationSpots}` },
          { label: 'Relief arms', value: String(op.pitching.relievers) },
          ...op.findings.map((f) => ({ label: 'Finding', value: plain(f.headline) })),
        ],
        unknown: op.unknowns,
        called,
      }),
    }),
    developmental: claim({
      text: devWord.text,
      tone: devWord.tone,
      hint: 'Are the players here developing?',
      basis: judgmentBasis(ctx, PLAYER_DEVELOPMENT, {
        because: [
          { label: 'Players read', value: String(dev.assessment.assessed) },
          ...dev.findings.map((f) => ({ label: 'Finding', value: plain(f.headline) })),
        ],
        called,
      }),
    }),
    operationalFindings: op.findings.map((f) => findingView(ctx, f, called)),
    operationalEmpty: op.findings.length ? null : cell('Nothing is short: the club can field its eight positions and cover a pitching schedule.'),
    cover,
    coverNote: cell('A graded cover has a visible fielding grade at the position; one covered only by a roster label is counted apart, since the label is a fact and the grade says how well he plays there. * marks a position whose loss can\'t be covered by moving somebody else.'),
    pitching: cell(`Pitching: ${op.pitching.starters} assigned to start against ${op.pitching.rotationSpots} rotation spots, ${plural(op.pitching.relievers, 'relief arm')}. ${op.fieldablePositions} of 8 positions can be filled at once.`),
    assessment: cell(assessment),
    developmentalFindings: dev.findings.map((f) => findingView(ctx, f, called)),
    developmentalEmpty: dev.findings.length ? null : cell('No developmental issue was found on this club.'),
    concerns,
    rosterContext,
    rosterContextNote: rosterContext.length
      ? cell('Players not counted as ordinary members of this club: a major-league player on rehab is passing through, not depth, and an injured man is not cover today.')
      : null,
    unknowns: plainAll(a.unknowns).map((u) => cell(u)),
  };
}

export function affiliatesView(ctx: FarmContext, system: FarmSystemView, majorLeague: MajorLeagueClub | null): FarmAffiliatesView {
  const called = linesCalled(system.calibration);
  const sorted = [...system.affiliates].sort((x, y) => x.level - y.level || x.label.localeCompare(y.label));
  const clubs: FarmClubStep[] = [];
  if (majorLeague) {
    clubs.push({
      teamId: majorLeague.teamId,
      name: majorLeague.name,
      level: cell('Major leagues'),
      league: majorLeague.league ? cell(majorLeague.league) : null,
      operational: null,
      developmental: null,
      players: majorLeague.activePlayers === null ? null : cell(`${majorLeague.activePlayers} on the active roster`),
      majorLeague: true,
      open: target({ kind: 'view', department: 'majorLeague', view: 'report' }),
    });
  }
  for (const a of sorted) {
    const status = statusWord(a.operational.status);
    const dev = developmentalWord(a);
    clubs.push({
      teamId: a.teamId,
      name: a.label,
      level: cell(a.levelName),
      league: a.leagueName ? cell(a.leagueName) : null,
      operational: cell(status.text, { tone: status.tone, hint: 'Can the club field a team and cover a schedule?' }),
      developmental: cell(dev.text, { tone: dev.tone, hint: 'Are the players here developing?' }),
      players: cell(`${a.operational.roster.total} on the active list`),
      majorLeague: false,
      open: affiliateTarget(a.teamId),
    });
  }
  const empty: Cell | null = sorted.length ? null : cell('This organization has no minor-league affiliates in the export.');
  return {
    ...headOf(ctx),
    clubs,
    order: cell('From the major-league club down, by level', { hint: 'Clubs at one level are in name order' }),
    affiliates: sorted.map((a) => affiliateDetail(ctx, a, called)),
    empty,
  };
}
