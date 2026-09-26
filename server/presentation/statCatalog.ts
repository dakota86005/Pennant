/**
 * The catalog of every statistic the app can show: its key (the key of the computed stat block the server returns), its
 * column label, what it means, how it is formatted and which way is better. One copy, served to the Mac app through
 * `GET /api/v2/catalog` and read by the React app's `src/stats.ts`, so the two cannot drift (SWIFTUI_REBUILD.md
 * section 4). Pure data: no imports, so both the server and the browser bundle load it.
 */

export type StatGroup = 'batting' | 'pitching';
export type StatFormat = 'int' | 'avg3' | 'dec1' | 'dec2' | 'pct' | 'plus';

export interface StatDef {
  key: string;
  label: string;
  desc: string;
  format: StatFormat;
  section: 'Counting' | 'Rate' | 'Advanced' | 'Fielding' | 'Contact';
  /** Lower is better — flips the color scale on plus/rate stats. */
  lowerIsBetter?: boolean;
}

export const BATTING_STATS: StatDef[] = [
  { key: 'pa', label: 'PA', desc: 'Plate appearances', format: 'int', section: 'Counting' },
  { key: 'ab', label: 'AB', desc: 'At bats', format: 'int', section: 'Counting' },
  { key: 'h', label: 'H', desc: 'Hits', format: 'int', section: 'Counting' },
  { key: 'd', label: '2B', desc: 'Doubles', format: 'int', section: 'Counting' },
  { key: 't3', label: '3B', desc: 'Triples', format: 'int', section: 'Counting' },
  { key: 'hr', label: 'HR', desc: 'Home runs', format: 'int', section: 'Counting' },
  { key: 'xbh', label: 'XBH', desc: 'Extra-base hits (2B + 3B + HR)', format: 'int', section: 'Counting' },
  { key: 'r', label: 'R', desc: 'Runs scored', format: 'int', section: 'Counting' },
  { key: 'rbi', label: 'RBI', desc: 'Runs batted in', format: 'int', section: 'Counting' },
  { key: 'bb', label: 'BB', desc: 'Walks', format: 'int', section: 'Counting' },
  { key: 'k', label: 'K', desc: 'Strikeouts', format: 'int', section: 'Counting', lowerIsBetter: true },
  { key: 'sb', label: 'SB', desc: 'Stolen bases', format: 'int', section: 'Counting' },
  { key: 'cs', label: 'CS', desc: 'Caught stealing', format: 'int', section: 'Counting', lowerIsBetter: true },

  { key: 'avg', label: 'AVG', desc: 'Batting average — hits per at bat', format: 'avg3', section: 'Rate' },
  { key: 'obp', label: 'OBP', desc: 'On-base percentage. The single best simple measure of a hitter avoiding outs.', format: 'avg3', section: 'Rate' },
  { key: 'slg', label: 'SLG', desc: 'Slugging percentage — total bases per at bat', format: 'avg3', section: 'Rate' },
  { key: 'ops', label: 'OPS', desc: 'On-base plus slugging. A quick read of a hitter\'s whole offense, but unadjusted for league or park.', format: 'avg3', section: 'Rate' },
  { key: 'iso', label: 'ISO', desc: 'Isolated power (SLG − AVG) — extra-base ability with singles stripped out', format: 'avg3', section: 'Rate' },
  { key: 'babip', label: 'BABIP', desc: 'Batting average on balls in play. Far from league average (~.300) often signals luck that will regress.', format: 'avg3', section: 'Rate' },
  { key: 'bbPct', label: 'BB%', desc: 'Walk rate — walks per plate appearance', format: 'pct', section: 'Rate' },
  { key: 'kPct', label: 'K%', desc: 'Strikeout rate — strikeouts per plate appearance', format: 'pct', section: 'Rate', lowerIsBetter: true },
  { key: 'sbPct', label: 'SB%', desc: 'Stolen base success rate. Below ~70% costs more runs than it creates.', format: 'pct', section: 'Rate' },

  { key: 'woba', label: 'wOBA', desc: 'Weighted on-base average. Like OBP, but each way of reaching base is weighted by how many runs it actually produces. Scaled so league average matches league OBP.', format: 'avg3', section: 'Advanced' },
  { key: 'opsPlus', label: 'OPS+', desc: 'OPS adjusted for league run environment and ballpark, scaled so 100 = league average. 130 means 30% better than average.', format: 'plus', section: 'Advanced' },
  { key: 'wrcPlus', label: 'wRC+', desc: 'Weighted Runs Created Plus — the most complete rate stat here. Total offense per plate appearance, park- and league-adjusted, where 100 = league average.', format: 'plus', section: 'Advanced' },
  { key: 'war', label: 'WAR', desc: 'Wins Above Replacement, as calculated by OOTP', format: 'dec1', section: 'Advanced' },
];

export const PITCHING_STATS: StatDef[] = [
  { key: 'g', label: 'G', desc: 'Games pitched', format: 'int', section: 'Counting' },
  { key: 'gs', label: 'GS', desc: 'Games started', format: 'int', section: 'Counting' },
  { key: 'w', label: 'W', desc: 'Wins', format: 'int', section: 'Counting' },
  { key: 'l', label: 'L', desc: 'Losses', format: 'int', section: 'Counting', lowerIsBetter: true },
  { key: 'sv', label: 'SV', desc: 'Saves', format: 'int', section: 'Counting' },
  { key: 'hld', label: 'HLD', desc: 'Holds', format: 'int', section: 'Counting' },
  { key: 'ip', label: 'IP', desc: 'Innings pitched', format: 'dec1', section: 'Counting' },
  { key: 'h', label: 'H', desc: 'Hits allowed', format: 'int', section: 'Counting', lowerIsBetter: true },
  { key: 'er', label: 'ER', desc: 'Earned runs allowed', format: 'int', section: 'Counting', lowerIsBetter: true },
  { key: 'hr', label: 'HR', desc: 'Home runs allowed', format: 'int', section: 'Counting', lowerIsBetter: true },
  { key: 'bb', label: 'BB', desc: 'Walks allowed', format: 'int', section: 'Counting', lowerIsBetter: true },
  { key: 'k', label: 'K', desc: 'Strikeouts', format: 'int', section: 'Counting' },

  { key: 'era', label: 'ERA', desc: 'Earned run average per nine innings', format: 'dec2', section: 'Rate', lowerIsBetter: true },
  { key: 'whip', label: 'WHIP', desc: 'Walks and hits per inning pitched — baserunners allowed', format: 'dec2', section: 'Rate', lowerIsBetter: true },
  { key: 'k9', label: 'K/9', desc: 'Strikeouts per nine innings', format: 'dec1', section: 'Rate' },
  { key: 'bb9', label: 'BB/9', desc: 'Walks per nine innings', format: 'dec1', section: 'Rate', lowerIsBetter: true },
  { key: 'hr9', label: 'HR/9', desc: 'Home runs per nine innings', format: 'dec1', section: 'Rate', lowerIsBetter: true },
  { key: 'kbb', label: 'K/BB', desc: 'Strikeout-to-walk ratio. Around 3.0 is excellent command.', format: 'dec2', section: 'Rate' },
  { key: 'kPct', label: 'K%', desc: 'Strikeouts per batter faced', format: 'pct', section: 'Rate' },
  { key: 'bbPct', label: 'BB%', desc: 'Walks per batter faced', format: 'pct', section: 'Rate', lowerIsBetter: true },

  { key: 'fip', label: 'FIP', desc: 'Fielding Independent Pitching — what ERA would be based only on strikeouts, walks, and home runs, with defense and batted-ball luck removed. Scaled to the league ERA.', format: 'dec2', section: 'Advanced', lowerIsBetter: true },
  { key: 'eraPlus', label: 'ERA+', desc: 'ERA adjusted for league run environment and ballpark, scaled so 100 = league average. 130 means 30% better than average.', format: 'plus', section: 'Advanced' },
  { key: 'war', label: 'WAR', desc: 'Wins Above Replacement, as calculated by OOTP', format: 'dec1', section: 'Advanced' },
];

/**
 * Season fielding, summed across every position a man played.
 *
 * A utility player's total workload is what belongs in a roster row; the split
 * by position lives on his card, where there is room for it.
 */
export const FIELDING_STATS: StatDef[] = [
  { key: 'fg', label: 'G', desc: 'Games played in the field', format: 'int', section: 'Fielding' },
  { key: 'fgs', label: 'GS', desc: 'Games started in the field', format: 'int', section: 'Fielding' },
  { key: 'finn', label: 'Inn', desc: 'Innings played in the field', format: 'int', section: 'Fielding' },
  { key: 'po', label: 'PO', desc: 'Putouts', format: 'int', section: 'Fielding' },
  { key: 'a', label: 'A', desc: 'Assists', format: 'int', section: 'Fielding' },
  { key: 'e', label: 'E', desc: 'Errors', format: 'int', section: 'Fielding' },
  { key: 'dp', label: 'DP', desc: 'Double plays turned', format: 'int', section: 'Fielding' },
  {
    key: 'fpct',
    label: 'FPCT',
    desc:
      'Fielding percentage — putouts plus assists over total chances. It says how often a player ' +
      'handled what he reached, and nothing about how much he reached, so a statue with safe hands ' +
      'can lead the league in it.',
    format: 'avg3',
    section: 'Fielding',
  },
  {
    key: 'rf9',
    label: 'RF/9',
    desc:
      'Range factor — putouts plus assists per nine innings. It measures how much a fielder is ' +
      'involved, which is the part fielding percentage misses. Compare it only within a position: ' +
      'a first baseman handles far more chances than a left fielder.',
    format: 'dec2',
    section: 'Fielding',
  },
];

/**
 * Contact quality, measured from every batted ball rather than inferred from
 * the line. OOTP records the exit velocity and launch angle of each one and
 * shows none of it, so these are the columns the game itself cannot give you.
 */
export const CONTACT_STATS: StatDef[] = [
  { key: 'avgExitVelo', label: 'EV', desc: 'Average exit velocity in mph across every batted ball. League average is around 86-87; 92 and up is genuine thump.', format: 'dec1', section: 'Contact' },
  { key: 'maxExitVelo', label: 'Max EV', desc: 'His hardest-hit ball of the season, in mph. A high peak with a modest average means the power is real but intermittent.', format: 'dec1', section: 'Contact' },
  { key: 'hardHitPct', label: 'Hard%', desc: 'Share of batted balls struck at 95 mph or more. The most stable contact-quality number there is — it settles long before batting average does.', format: 'dec1', section: 'Contact' },
  { key: 'barrelPct', label: 'Brl%', desc: 'Share of batted balls hit hard enough, at an angle good enough, to be near-certain damage. The window opens at 98 mph and widens as the ball is hit harder.', format: 'dec1', section: 'Contact' },
  { key: 'sweetSpotPct', label: 'Sweet%', desc: 'Share of batted balls launched between 8 and 32 degrees, the angles that produce line drives rather than choppers and popups.', format: 'dec1', section: 'Contact' },
  { key: 'gbPct', label: 'GB%', desc: 'Share of batted balls hit on the ground (under 10 degrees).', format: 'dec1', section: 'Contact' },
  { key: 'fbPct', label: 'FB%', desc: 'Share of batted balls hit in the air (25 to 50 degrees).', format: 'dec1', section: 'Contact' },
  { key: 'sprintSpeed', label: 'Sprint', desc: 'Measured speed on the bases, averaged across his batted balls — what he actually does, rather than the scouted speed rating.', format: 'dec1', section: 'Contact' },
  { key: 'xslg', label: 'xSLG', desc: 'What his contact usually produces: every batted ball scored by how balls of that speed and angle actually fared at his level this season.', format: 'avg3', section: 'Contact' },
  { key: 'slgLuck', label: 'SLG±', desc: 'Actual slugging on batted balls minus expected. Strongly negative means he has hit the ball well and been robbed; strongly positive means the results have outrun the contact.', format: 'avg3', section: 'Contact' },
];
