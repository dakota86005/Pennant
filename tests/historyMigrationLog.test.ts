import { describe, expect, it } from 'vitest';
import { legacyReviewLogLine } from '../server/historyIdentity.js';

/**
 * What the rating history's move to keys by save (D-064) says in `server.log` (N6 polish: the real-save check found only
 * the backup's file named): how many dates it looked at, how many it brought over and how many rows it copied, and
 * each reason the rest stayed where they were, in plain words.
 */
describe("the history migration's log line", () => {
  it('counts the dates brought over and the rows copied, and each reason the rest stayed', () => {
    const line = legacyReviewLogLine('New Game 6', 12, 9, 71_000, new Map([
      ['different_league', { dates: 2, rows: 16_000 }],
      ['after_league_date', { dates: 1, rows: 8_000 }],
      ['unclear_rows', { dates: 0, rows: 40 }],
    ] as const));
    expect(line).toContain('looked at 12 dates of the rating history kept under the name "New Game 6"');
    expect(line).toContain("brought 9 dates over as this save's (71000 rows copied)");
    expect(line).toContain("2 dates (16000 rows) that had another league's players");
    expect(line).toContain("1 date (8000 rows) that were later than this save's own date");
    expect(line).toContain("40 rows of the dates brought over, whose players aren't in this league under the same name");
    expect(line).toMatch(/left in place, under the name:/);
  });

  it('says so when nothing was brought over, and names no reason when everything was', () => {
    expect(legacyReviewLogLine('X', 3, 0, 0, new Map([['twin_exists', { dates: 3, rows: 9 }]]))).toContain('brought none over');
    const all = legacyReviewLogLine('X', 2, 2, 10, new Map());
    expect(all).not.toContain('left in place');
  });
});
