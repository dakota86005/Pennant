import { describe, expect, it } from 'vitest';
import * as neutral from '../server/saveIdentity';
import * as valueHistory from '../server/playerValueHistory';
import { saveIdentity as valueSaveIdentity } from '../server/playerValueFitStore';

/**
 * The save's identity moved from Player Value to a neutral module (per-save calibration, cycle 1). A changed identity would
 * orphan every fit a save has stored and refit it, so the move must be byte-identical.
 */
describe('the save identity is unchanged by the move to the neutral module', () => {
  it('the fixture league keeps the fingerprint the pre-move code computed', () => {
    // Computed with server/playerValueHistory.ts at ab7de2a (before the move) on the same fixture
    expect(neutral.leagueFingerprint(100)).toBe('a814bd46');
  });

  it('Player Value reads the very same functions, not copies', () => {
    expect(valueHistory.leagueFingerprint).toBe(neutral.leagueFingerprint);
    expect(valueHistory.leagueSeasons).toBe(neutral.leagueSeasons);
    expect(valueHistory.hasSeasonLines).toBe(neutral.hasSeasonLines);
    expect(valueSaveIdentity).toBe(neutral.saveIdentity);
  });

  it('the identity is the configured save name and the fingerprint', () => {
    expect(neutral.saveIdentity(100)).toMatch(/\|a814bd46$/);
  });

  it('the last completed season is established or null, never a guess', () => {
    const done = neutral.completedThrough(100);
    expect(done.season === null || Number.isInteger(done.season)).toBe(true);
    expect(neutral.completedThrough(999_999)).toEqual({ season: null, current: false });
  });
});
