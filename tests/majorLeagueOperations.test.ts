import { describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { majorLeagueRosterContext } from '../server/majorLeagueOperations.js';
import { IDS } from './fixture';

describe('Major League Operations roster context', () => {
  it('reports imported roster, health, and service facts without evaluating a transaction', () => {
    const context = majorLeagueRosterContext(IDS.mlbTeam);
    const injured = context.known.players.find((player) => player.playerId === IDS.injured);
    const optioned = context.known.players.find((player) => player.playerId === IDS.optioned);

    expect(context.organization).toMatchObject({ orgId: IDS.mlbTeam, label: 'Test Nine' });
    expect(context.known.activeRosterCount).toBeGreaterThan(0);
    expect(context.known.fortyManCount).toBeGreaterThanOrEqual(context.known.activeRosterCount ?? 0);
    expect(context.known.serviceTimeRemainingThisSeason).toBeCloseTo((172 - 40) / 172, 5);
    expect(injured?.roster).toMatchObject({
      active: false,
      fortyMan: true,
      health: { status: 'IL', playable: false },
      standing: { label: 'IL', available: false },
    });
    expect(optioned?.roster).toMatchObject({ active: false, fortyMan: true });
    expect(optioned?.serviceTime).toMatchObject({ years: 1, days: 172, daysThisSeason: 40 });
    expect(context.transactionUnknowns.map((gap) => gap.code)).toEqual(expect.arrayContaining([
      'active_roster_limit_not_modeled',
      'secondary_roster_limit_not_modeled',
      'transaction_rules_not_modeled',
      'option_eligibility_not_derivable',
      'rule5_eligibility_not_derivable',
    ]));
    expect(context.scoutingValuePolicy).toBe('prohibited_pending_provenance');
  });

  it('keeps missing transaction columns unknown instead of inventing a result', () => {
    const context = majorLeagueRosterContext(IDS.mlbTeam);
    const optioned = context.known.players.find((player) => player.playerId === IDS.optioned);

    // The fixture intentionally has no options-used or Rule 5 columns. Those
    // facts stay null; zero would falsely mean the player has every option.
    expect(optioned?.transactionStatus.optionsUsed).toBeNull();
    expect(optioned?.transactionStatus.yearsProtectedFromRule5).toBeNull();
    expect(optioned?.transactionStatus.professionalServiceYears).toBeNull();
  });

  it('does not turn a missing roster-status table into an empty roster', () => {
    db.exec('ALTER TABLE players_roster_status RENAME TO players_roster_status_missing');
    try {
      const context = majorLeagueRosterContext(IDS.mlbTeam);
      expect(context.known.players).toEqual([]);
      expect(context.known.activeRosterCount).toBeNull();
      expect(context.transactionUnknowns).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'missing_roster_status_table' }),
      ]));
    } finally {
      db.exec('ALTER TABLE players_roster_status_missing RENAME TO players_roster_status');
    }
  });
});
