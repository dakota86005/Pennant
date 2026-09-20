# Calibration: tuning the scouting layer against outcomes

Status: **run 1 recorded** (2026-09-20, on the 2026-05-16 Arizona save). Every number that steers a
scouting conclusion is declared once, in the module that owns it, and stamped `calibrated` (tuned against
outcomes, with what it was tuned on) or `provisional` (a first-pass or policy judgment). The stamp lives in
[`server/calibration.ts`](../server/calibration.ts); [`scripts/calibrate.ts`](../scripts/calibrate.ts) is the
harness that produces the evidence. The full output of this run is [CALIBRATION_RUN.txt](CALIBRATION_RUN.txt).
See D-037 in [DECISIONS.md](DECISIONS.md).

```bash
OOTP_FO_DATA_DIR=<dir containing league.db> npm run calibrate               # every section
OOTP_FO_DATA_DIR=<dir containing league.db> npx tsx scripts/calibrate.ts tools platoon
```

Sections: `results pitchers tools platoon aging running defense leverage standards`. The harness reads objective statistics
directly and ratings only through `scoutedEvidence.ts` (D-017, D-035). It never writes to the database and changes
no behavior by itself: a person reads the output, edits the one declaration, and records the run here.

## 1. Method

The data is the league's own history: the save imports real major-league seasons back to 1871, so modern-era
seasons (2003 to 2025, skipping the shortened 2020) give about 6,000 qualified hitter-seasons and 7,000 pitcher-seasons.
Each test **predicts a later season from earlier ones with the production functions** (`weightedBatting`,
`weightedPitching`, `reliability`) under candidate parameters, and keeps the parameters with the smallest
plate-appearance-weighted RMSE. Each is compared with a no-information guess, so an improvement is visible against a
baseline.

**One limit to keep in view.** Ratings exist for the current moment only, and OOTP formed them from recent real
results, so a test of "do tools predict results" is contaminated by leakage for recent windows. The harness therefore
reports the tools model on four result windows, oldest to newest, and the constants use the lagged windows (the honest
predictive skill), not the newest (which is flattered).

## 2. What was found, and what changed

| Constant | Before | After | Evidence |
|---|---|---|---|
| Hitter season weights (this, last, before) | 5 / 4 / 3 | **5 / 3 / 3** | grid over 4 x 5 weight pairs and 9 stabilization constants; rmse .03067 against .03112 and .03804 for no information |
| Hitter stabilization (PA) | 250 | **500** | same grid; flat from 400 to 600 |
| Starter weights / stabilization (BF) | 5 / 4 / 3, 300 | **5 / 3 / 1, 700** | predicting next-season ERA; rmse .8562 against .8696 |
| Reliever weights / stabilization (BF) | 5 / 4 / 3, 300 | **5 / 3 / 2, 500** | rmse 1.2544 against 1.2629 |
| Pitcher results mix (peripherals / runs) | 0.7 / 0.3 | **0.85 / 0.15** | peripherals predict NEXT season's runs allowed at least as well as past runs (best share 0.9 to 1.0 for both roles) |
| Tools lens for hitters | unweighted mean of five tools | **calibrated tools model** (expected wOBA) | R2 .40 to .45 at lag against .35 to .37 for the flat mean; pooled slopes contact .00155, power .00122, eye .00086, gap .00033, strikeout avoidance 0 |
| Weight of results against tools | n / (n + K) with K alone | **K x (1 - information)**: hitters 300, starters 560, relievers 400 | when tools are known, results are shrunk toward the tools, not the league average; the tools explain .40 (hitters) and .20 (pitchers) of true talent at lag |
| Platoon prior | league norm for the hand | **league norm + the hitter's rating-implied departure (weight 1.0)** | slope 1.06 against 2023 to 2025 results (1.0 is exact); beats the league norm alone (rmse .03651 against .03757) |
| Platoon shrinkage of a hitter's own split | K 1,500 | **K 5,000** | his own past split adds almost nothing beyond ratings and the league (best K 5,000; combined coefficient 0.10) |
| Aging | one age (34) | **an aging curve** from the data | hitters lose about 3 points of wOBA a year from 26, 6.5 from 30, 9.5 from 34; pitchers gain about 0.12 runs per nine of FIP from 28 and 0.20 from 35 |
| Baserunning stabilization | none | **550 PA** | year-to-year correlation of baserunning runs r = .50; running ratings explain .43 of it |
| Bullpen leverage cut-offs | none (3 fixed words) | **closer 1.6, high 1.3, low 0.9** | distribution of relievers' leverage: median 1.10, top quartile 1.39; closers average 2.09, setup men 1.23 |

**A real bug found by the harness.** `resultsMetrics` multiplied its FIP-style measure by nine. FIP is already
expressed per nine innings by its constant, so the displayed FIP surrogate was nine times too spread out. The ranking
(percentiles among peers) was unaffected, which hid it; the harness's rmse on the pitcher scale exposed it. Fixed at
the source, with the test that pins the ERA scale.

## 3. What is still provisional, and why

| Constant | Why it is not yet calibrated |
|---|---|
| Position glove weights (`DEFENSE_WEIGHT`) | Derived shares (C .42, 1B .18, 2B .38, 3B .31, SS .42, LF .38, CF .51, RF .40) come from one partial season of zone ratings. The stated weights average them with the earlier priors (.40, .05, .30, .25, .35, .10, .30, .20) so one season does not move them all the way. The slope of zone-rating runs on the visible glove grade is solid (r .37 to .82 by position); the bat spread it is compared with is the tools model's, which is attenuated. |
| Defensive stabilization (1,000 innings) | Zone rating exists for the current season only (and for catchers' history), so its repeatability cannot be measured. |
| Baserunning weight (.05) and the run value of a steal | Derived from a spread of about 1.4 runs per 600 PA against the bat's 10 to 15, so it is small in this game; the steal weights are the standard ones. |
| Park share of a run factor (.5) | The park factor is the app's existing one (`stats.ts`); the share that reaches wOBA is not fitted. |
| Concern thresholds (`CONCERN`, `MEANINGFUL_GAP`), platoon problem and complement margins, regular share, lineup and shift thresholds, bench cover policy, and every philosophy threshold | These are policy: they say when to raise something, not how baseball works. The platoon margins are set against the measured spread of the effect (sd .0087): a problem is about 1.4 sd, a complement about 3 sd. |

## 4. Re-running

Re-run after a fresh import, after the season has grown (defense and baserunning gain sample, and the glove weights
should be re-derived), and after any change to the results or tools code. The stamp names the run
(`CALIBRATION_RUN` in `server/calibration.ts`): editing it re-points every stamp. A recalibration that moves a constant
by a meaningful amount is a change to record here and, if it changes what the tool tells a GM, in DECISIONS.md.

## 5. Addendum (hardening phase): corners, populations and role standards

Three additions, none of which re-fit a constant. The run behind them is in [CALIBRATION_RUN.txt](CALIBRATION_RUN.txt) (addendum).

**3c. Extreme profiles.** The straight-line tools model was checked at the corners by profile class (pooled residuals, per-window
intercepts): power-led (power 60+, contact 45-) -3.1 wOBA points (+/- 2.0); contact-led -1.9 (+/- 2.3); eye-led -3.6 (+/- 2.1); three
true outcomes -2.1 (+/- 3.3); all bat tools 40 or under +7.8 (+/- 4.0), which is survivorship (a hitter with poor tools reaches 500 PA only
by hitting). Adding contact x power, contact x eye and power x eye terms moves R2 from 0.5343 to 0.5391. The straight line is kept.

**Peer populations (D-039).** The population a hitter's tools, running and glove are ranked against excludes amateur signings (a negative
`players.league_id`). It was 12% of the pool. The harness's fits use players with results, so they were never affected; the percentiles
built on the pool were.

**9. Role standards.** `standards` runs the PRODUCTION review on every club and describes the estimates it produces: the median
estimate of each role (position for hitters, rotation member, bullpen tier) and the pooled 10th and 5th percentile deviation from
it. These are descriptive, not fitted to outcomes: they are the peer standard a concern is measured against (`server/roleStandards.ts`,
D-040). The typical levels are provisional (one snapshot); the pooled gaps are stable; the quantiles are policy (D-041). Re-run it after a
fresh import and after the season has grown, and edit the declarations.
