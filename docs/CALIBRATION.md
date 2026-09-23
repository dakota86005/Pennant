# Calibration: tuning the scouting layer against outcomes

Status: **run 1 recorded** (2026-09-20, on the 2026-05-16 Arizona save). Every number that steers a
scouting conclusion is declared once, in the module that owns it, and stamped `calibrated` (tuned against
outcomes, with what it was tuned on) or `provisional` (a first-pass or policy judgment). The stamp lives in
[`server/calibration.ts`](../server/calibration.ts); [`scripts/calibrate.ts`](../scripts/calibrate.ts) is the
harness that produces the evidence. The full output of this run is [CALIBRATION_RUN.txt](CALIBRATION_RUN.txt).
See D-037 in [DECISIONS.md](DECISIONS.md).

**Amended by D-053 (2026-09-22): calibration belongs to the save.** New work is fitted on each save's own outcomes,
automatically, stored per save with its run record as the stamp; code holds the method, the policy and a
provisional fallback prior. Player Value's expected production is the first subsystem built this way (section 6).
The scouting constants in sections 1 to 5 keep their run-1 stamps until they are migrated (ROADMAP).

```bash
OOTP_FO_DATA_DIR=<dir containing league.db> npm run calibrate               # every section
OOTP_FO_DATA_DIR=<dir containing league.db> npx tsx scripts/calibrate.ts tools platoon
```

Sections: `results pitchers tools platoon aging running defense leverage standards production` (production: section 6). The harness reads objective statistics
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

## 6. Calibration belongs to the save (D-053): Player Value's expected production

From D-053 on, "calibrated" means fitted on the save's own outcomes, automatically, with the run record as the
stamp. Player Value's expected production (phase 3a) is the first subsystem built this way; the scouting constants
above keep their run-1 stamps until they are migrated (ROADMAP).

**What is in code, and what is the save's.**

| Kind | Where | What |
|---|---|---|
| Method | `server/playerValueProductionFit.ts` | The fit and its backtest (below) |
| Policy | `PRODUCTION_POLICY` in `server/playerValueCalibration.ts` | Coverage targets 80% and 50%; the era rule (the most recent 20 completed seasons, a season under 90% of the schedule skipped); the hold-out share (the most recent 45% of them); the gate (held-out coverage within 10 points of each target at every horizon with 200+ cases, horizon 1 required); minimum samples (100 opportunities per season in an aging pair, 30 pairs, 50 cases per component); the prior's strength (250 cases, 100 aging pairs) and widening (half its weight); three usage tiers; the two-way minimum (100 opportunities); the starter share (half his games); the usage pivot age (30); proneness in three equal-count bands, an effect used only at two standard errors, aging read apart under and over 30 |
| Fallback prior | `PRODUCTION_PRIOR` in `server/playerValueCalibration.ts`, stamped **provisional** | The same method run with no prior and no hold-out on the real major-league history 2006–2025 the Arizona save imports. Real-world stability and aging, not OOTP's engine and not any save. It carries no proneness effect |
| The save's fit | `value_production_fits` in `history.db` (`server/playerValueFitStore.ts`) | Everything fitted: the aging curve, the regression, season noise, drift, usage, the band tails, the proneness effects, with the run record |

**The method.** From each origin season O (a window of O, O−1 and O−2), every player with major-league results is
projected for O+1 … O+7 and compared with what he produced; a player who did not play in a target season produced 0
wins there. The fit sees only targets up to the last training season; the held-out seasons are predicted from
origins at or after it. It fits, in order: the aging curve (delta method on consecutive training seasons, a weighted
quadratic in age, hitters and pitchers apart); the regression per kind (recency weights, K and the mean, by grid on
horizon-1 cases, weighted by opportunities); season noise (the model's own moments); the usage regression per kind
and horizon (least squares on the window's three slots and age, zeros included, coefficients on usage never below
zero) with its spread and tails; the proneness effects; drift (the rate variance no sample removes, from the excess
squared residual on usage to the fourth power); and the band tails per kind, usage tier and horizon, the quantiles of
each horizon's own training outcomes (each season's wins band is its own; only the rate band, WAR per 600
opportunities, is carried forward so it is never narrower further out, owner 2026-09-23). Each component is shrunk toward the prior by its sample. The gate then reads the held-out coverage of the fit
itself; if it passes, a horizon still short of a target on the held-out seasons is widened until it is met, and the
bands are served wider by the prior's weight.

**Re-running.** The refit is automatic: after an import whose export holds a completed season newer than the last
fit's, `runImport` refits in the background, once, and the gate decides adoption. A developer can force it:

```bash
OOTP_FO_DATA_DIR=<dir with league.db and a scratch history.db> OOTP_FO_DB_READONLY=1 npx tsx scripts/calibrate.ts production            # fit and print, write nothing
... production --refit    # force a refit and record it in history.db (replaces the row for the same key)
... production --prior    # also fit the fallback prior and print it as the literal for playerValueCalibration.ts
```

### 6.1 The run on the Arizona import (2026-05-16)

Fit `203:2025:production-3a.1`: window 2006–2025 (19 seasons; 2020 skipped at 37% of the schedule), trained through
2015, held out 2016–2019 and 2021–2025. 5,956 players; 3,143 hitter and 3,019 pitcher aging pairs; horizon-1 training
cases 6,482 hitters, 2,159 starters, 4,492 relievers. Prior weight 0.02 overall (hitters 0.06, starters 0.15,
relievers 0.10). **Gate passed**; adopted. Time: history read 0.16 s, fit 4.5 s (4.6 s end to end through
`refitProductionIfNeeded`).

**This history is real major-league history, not OOTP's simulation** (a historical start, R-1). The fit describes
real-world stability and aging as a stand-in. It is refitted by itself as the save's own completed seasons arrive
(each one enters the window and, from the next season on, the held-out seasons), and the record names the seasons
it rests on (`window`, `trainingThrough`, `holdout` in `record_json`).

Held-out coverage (cases are player-sides), pooled over hitters, starters and relievers, and served by third of
expected usage:

| Horizon | Cases | 80% / 50% as fitted | 80% / 50% as served | Fringe (served) | Part-time (served) | Regulars (served) | Bias (wins) |
|---|---|---|---|---|---|---|---|
| 1 | 12,203 | 80.4 / 53.3 | 82.9 / 55.4 | 85.2 / 64.2 | 81.1 / 51.5 | 82.4 / 50.4 | +0.03 |
| 2 | 10,100 | 79.2 / 52.7 | 81.8 / 54.7 | 83.6 / 61.7 | 80.3 / 50.8 | 81.6 / 51.8 | +0.09 |
| 3 | 7,934 | 78.4 / 52.0 | 81.1 / 53.5 | 82.1 / 58.1 | 80.0 / 51.1 | 81.4 / 51.6 | +0.13 |
| 4 | 7,963 | 80.1 / 54.2 | 82.4 / 56.5 | 84.8 / 68.7 | 79.8 / 50.6 | 82.9 / 51.0 | +0.15 |
| 5 | 7,997 | 80.5 / 55.1 | 82.3 / 57.6 | 86.4 / 71.3 | 80.2 / 51.4 | 80.7 / 50.9 | +0.17 |
| 6 | 9,933 | 80.9 / 57.2 | 82.6 / 59.2 | 86.8 / 71.6 | 80.5 / 53.3 | 80.7 / 53.4 | +0.18 |
| 7 | 7,914 | 81.6 / 59.0 | 83.6 / 61.1 | 88.4 / 70.8 | 81.9 / 56.7 | 80.7 / 56.4 | +0.17 |

Served coverage is higher than fitted by the prior's widening (half its weight) and the hold-out widening. The fringe
third over-covers because most of its outcomes are exactly zero (no playing time), which any band around a small
central contains. An earlier build of this phase carried the wins band forward (no season narrower than the one
before), which forced held-out coverage up to 93% / 80% at horizon 7; the owner moved the invariant to the rate
(2026-09-23). Before the tails were set per usage tier (an intermediate run), regulars were covered 65–71%
and 20–28%: that finding is why the tiers exist. The positive bias at longer horizons (the central below what
happened) is recorded, not tuned away: playing time is not modelled as depending on performance, so a player
projected below replacement keeps his expected usage (PLAYER_VALUE.md 2.3).

**Aging** (WAR per 600 opportunities, from each age to the next): hitters gain +0.23 a year to 21, +0.07 at 23, none from
24 to 25 (the peak), then decline −0.19 at 27, −0.35 at 30, −0.51 at 34 and −0.62 from 39; pitchers gain +0.15 to 21,
none from 24 (the peak), then −0.16 at 27, −0.28 at 30, −0.41 at 34 and −0.52 from 40. Mean change 30–33: hitters −0.41,
pitchers −0.34; 34–37: −0.55 and −0.45. `roleReview.ts`'s `AGING_CURVE` (wOBA and FIP) is not reused.

**Regression** (per kind): hitters weights 1 / 0.99 / 0.80, K 153, mean 2.01 WAR per 600 PA; starters 1 / 0.50 / 0.30, K
385, mean 1.38 per 600 BF; relievers 1 / 0.50 / 0.22, K 400, mean 0.93. Drift at horizon 1: hitters 1.18, starters 0.62,
relievers 1.27 (WAR per 600)².

**Injury proneness** (`prone_overall`, bands ≤ 59, 59–86, > 86 on this save): playing time relative to the league's
rate for the same expected usage, horizons 1–3: hitters 102.2% ± 1.2 (not used), 102.5% ± 1.1, 94.1% ± 1.3;
pitchers 97.6% ± 1.8 (not used), 104.2% ± 1.3, 96.9% ± 1.5. Aging against the curve: none of the twelve cells (two
groups × three bands × under/over 30) is distinguishable from none (the largest relative to its error, pitchers > 86 and 30 or
over, +0.062 ± 0.069 per 600 a year), so proneness does not move aging on this save, and the record says why.
