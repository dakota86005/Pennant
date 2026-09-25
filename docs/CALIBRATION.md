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
The scouting constants in sections 1 to 5 keep their run-1 stamps until they are migrated (ROADMAP). Since cycle 2 (section 13) the
results lens's season weights and stabilization are per save, and run 1's values are their provisional fallback.

```bash
OOTP_FO_DATA_DIR=<dir containing league.db> npm run calibrate               # every section
OOTP_FO_DATA_DIR=<dir containing league.db> npx tsx scripts/calibrate.ts tools platoon
```

Sections: `results pitchers tools platoon aging running defense leverage standards production` (production: section 6), `roster-review` when named (sections 12 to 14: every per-save yardstick of the roster review, including the platoon fit and the long-man line), `detector` when named (section 13: the "clearly better" rule's error rates, measured on simulated leagues), and `platoon-detector` when named (section 14: the platoon fit's error rates under the same rule). The harness reads objective statistics
directly and ratings only through `scoutedEvidence.ts` (D-017, D-035). It never writes to `league.db`. Its sections 1 to 9 change
no behavior by themselves: a person reads the output, edits the one declaration, and records the run here. `production --refit` and
`roster-review --refit` are the exception: they record a per-save fit in `history.db`, which changes what the application serves
(through the same gate as the automatic refit).

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
| Baserunning weight (.05) and the run value of a steal | Derived from a spread of about 1.4 runs per 600 PA against the bat's 10 to 15, so it is small in this game; the steal weights are the standard ones. Since cycle 2 a caught stealing is valued at each league-season's own runs per out (section 13.5); a stolen base stays +0.2. |
| Park share of a run factor (.5) | The park factor is the app's existing one (`stats.ts`); the share that reaches wOBA is not fitted. Cycle 2 measured the elasticity of club runs on wOBA at 1.92 ± 0.03 (a share of 0.52) and kept 0.5: the park factor it multiplies is not per season (section 13.6). |
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
stamp. Player Value's expected production (phases 3a and 3b) is the first subsystem built this way; the scouting
constants above keep their run-1 stamps until they are migrated (ROADMAP). Phase 3b adds a second fitted model, the
ratings model (section 6.2), and changed the results method to `production-3b.1`: playing time conditional on quality.
The hardening (2026-09-23, section 6.3) rebuilt the central and the gate under method `production-3h.1`, and the
owner's option C (the same day) replaced its block hold-out with a rolling-origin backtest under `production-3h.2`; the
table and the method below describe 3b.1 where section 6.3 says what changed.

**What is in code, and what is the save's.**

| Kind | Where | What |
|---|---|---|
| Method | `server/playerValueProductionFit.ts` | The fit and its backtest (below) |
| Policy | `PRODUCTION_POLICY` in `server/playerValueCalibration.ts` | Coverage targets 80% and 50%; the era rule (the most recent 20 completed seasons, a season under 90% of the schedule skipped); the hold-out share (the most recent 45% of them); the gate (held-out coverage within 10 points of each target at every horizon with 200+ cases, horizon 1 required); minimum samples (100 opportunities per season in an aging pair, 30 pairs, 50 cases per component); the prior's strength (250 cases, 100 aging pairs) and widening (half its weight); three usage tiers; the two-way minimum (100 opportunities); the starter share (half his games); the usage pivot age (30); proneness in three equal-count bands, an effect used only at two standard errors, aging read apart under and over 30; since phase 3b the tails also by quality tier (the bottom tenth, middle and top tenth of projected rate) |
| Ratings policy | `RATINGS_POLICY` in `server/playerValueCalibration.ts` | Phase 3b (section 6.2): 200 opportunities for a major leaguer to enter the same-time mapping, 5 folds, 15 players for a position's own intercept, prior strength 150; arrival age bands of 60 player-seasons, 10 nodes, 10 arrivals; snapshot pairs 300–430 days apart with a gap of 2, 300 pairs for the save's own development path, bands of 30 pairs, 300 linked seasons for the chance by potential (thirds, two standard errors); the prior's development range up to twice its central share; an unknown grade anywhere on 20-80 |
| Fallback prior | `PRODUCTION_PRIOR` in `server/playerValueCalibration.ts`, stamped **provisional** | The same method run with no prior and no hold-out on the real major-league history 2006–2025 the Arizona save imports. Real-world stability and aging, not OOTP's engine and not any save. It carries no proneness effect |
| Ratings fallback prior | `RATINGS_PRIOR`, stamped **provisional** | The ratings method with no prior on the Arizona import: the mapping, the batting hands' exposure, the stamina cut, the largest development by age, and the development path read from one cross-section of scouted gaps (not a path). **No arrivals**: measured per save or unknown |
| The save's fit | `value_production_fits` in `history.db` (`server/playerValueFitStore.ts`) | Everything fitted: the aging curve, the regression, season noise, drift, usage, the band tails, the proneness effects, with the run record; and, under `ratings-3b.1`, the ratings model with its own record |

**The method.** From each origin season O (a window of O, O−1 and O−2), every player with major-league results is
projected for O+1 … O+7 and compared with what he produced; a player who did not play in a target season produced 0
wins there. The fit sees only targets up to the last training season; the held-out seasons are predicted from
origins at or after it. It fits, in order: the aging curve (delta method on consecutive training seasons, a weighted
quadratic in age, hitters and pitchers apart); the regression per kind (recency weights, K and the mean, by grid on
horizon-1 cases, weighted by opportunities); season noise (the model's own moments); playing time per kind and
horizon as attrition × playing time when he plays (since `production-3b.1`: a logistic for the chance of any
major-league playing time and least squares on those who played, each on the window's three slots, his projected
quality, his regressed rate above replacement aged to that horizon and never below zero, and his age; coefficients on
usage and quality never below zero) with its spread and tails; the proneness effects; drift (the rate variance no
sample removes, from the excess squared residual on usage to the fourth power); and the band tails per kind, quality
tier, usage tier and horizon (a cell with too few cases takes its usage tier's), the quantiles of
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

**Superseded by method `production-3h.1` (section 6.3).**

**Method `production-3b.1` (phase 3b).** Fit `203:2025:production-3b.1`, same window, hold-out and
sample as below; **gate passed**, adopted; fit 4.8–5.0 s. The aging curve, the regression and season noise are
unchanged (hitters K 153, mean 2.01; starters K 385, mean 1.38; relievers K 400, mean 0.93). Playing time now depends
on quality: at horizon 1 a hitter who plays gets about 34 more plate appearances per WAR per 600 of projected quality,
a starter about 92 more batters faced, and a reliever's chance of pitching at all rises (logit +1.48 per WAR per 600).
Held-out coverage, 80% / 50%, as served: horizon 1 82.1 / 56.0, 2 81.1 / 52.8, 3 81.2 / 52.9, 4 82.4 / 55.6, 5 82.2 /
58.3, 6 83.3 / 61.5, 7 84.7 / 64.9 (as fitted 77.8–81.3 / 49.8–60.0). **By projected rate** (tenths within each kind),
served, and the central's bias (actual − central, wins), horizons 1 to 7:

| Tier | 80% band | 50% band | Bias before (3a) | Bias after (3b) |
|---|---|---|---|---|
| Top tenth | 77.7–80.6 | 48.1–52.3 | +0.20, +0.33, +0.37, +0.41, +0.44, +0.44, +0.41 | −0.12, −0.01, −0.00, +0.05, +0.11, +0.14, +0.16 |
| Middle | 81.8–85.5 | 53.3–67.9 | −0.00, +0.06, +0.10, +0.12, +0.13, +0.14, +0.14 | −0.01, +0.05, +0.09, +0.10, +0.12, +0.12, +0.12 |
| Bottom tenth | 78.6–84.3 | 51.2–60.6 | +0.07, +0.12, +0.15, +0.17, +0.18, +0.17, +0.18 | +0.05, +0.09, +0.11, +0.12, +0.13, +0.11, +0.12 |

Before the change the top tenth was covered 64–72% (80% band) and 30–40% (50% band). An intermediate build that made
playing time depend on quality but kept tails by usage tier only fixed the stars' bias and left the bottom tenth
overconfident (65–71% and 22–32%): that is why the tails are now set by quality tier too. Served coverage at horizons
6 and 7 of the 50% band (61.5%, 64.9%) is higher than 3a's: the hold-out widening now acts per cell. Injury proneness
under the new playing-time model: hitters in the most injury-prone third play 94.8% ± 1.2 of the league's rate for the
same expected usage, pitchers 95.0% ± 1.4; the middle third of pitchers 104.7% ± 1.3; no aging effect is distinguishable.

**Method `production-3a.1` (phase 3a, superseded).** The run the rest of this section describes.

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

### 6.3 The hardening run (method `production-3h.1`, 2026-09-23)

Four reviewers audited phases 1–3b (findings B-01 to B-17, C-03 to C-11, D-01 to D-16, A-01 to A-24). The central was
biased low and the bias grew with the horizon: pooled +0.05 to +0.12 wins at horizons 2–7, starters +0.08 to +0.26,
regulars +0.19 at horizon 7, the save's established cohort projected 10% / 21% / 32% / 43% / 54% / 66% below what its
own history gives the same cohort one to six seasons on. The gate passed it because it read pooled coverage only, with a
10-point tolerance, and the drift term had absorbed the bias as variance. What changed:

- **The central is E[rate × playing time].** Talent drifts, and the players who keep playing are the ones who stayed
  good, so the expected rate of a player who plays at a horizon is fitted apart from the chance he plays (the
  `survivor` terms per kind and horizon: his regressed rate now, his age and his window playing time, weighted by the
  opportunities played). Expected wins = chance × playing time when he plays × that rate. The survivors' terms read his
  regressed rate NOW and carry their own aging: a first build that fed them the rate aged by the curve compounded the
  curve's decline for seven seasons (starters who played at horizon 7 predicted at 0.54 WAR per 600 against 1.53 actual).
  The pooled held-out bias is now −0.03 to −0.05 at every horizon.
- **Playing time per scheduled game,** each past season at its own schedule (the standings' modal games per club, or
  the most any player played), each future season at the rules' schedule; a season is short against its neighbours'
  schedules, never today's (D-05, D-06, B-11). A 2020 origin projected at 60 games for every later season was the
  source of the part-timers' apparent under-projection in the first build of this run.
- **A physical ceiling:** the most opportunities per scheduled game any player of the kind played in the window
  (hitters 4.77 PA, starters 6.31 BF, relievers 3.88 BF on this save), times the season's schedule; the wins high
  edge is at most the ceiling at the high edge of his rate (C-05).
- **The band is a mixture** of no playing time and the wins when he plays, as quantiles of the fitted distribution
  of each cell (15 points, `tailGrid`), so a point mass at nothing is exact (B-12); its shape is read from the usage
  lines alone and moved to the central, so thinner evidence only widens it and proneness moves it whole. Young
  players (25 and under) have cells and a drift of their own (B-04). Backtest coverage of an outcome of no playing time
  is scored by the share of the point mass the band holds (a discrete outcome).
- **A listed pitcher's batting is not a hitter's case** (A-01, B-02): hitters' K rose from 153 to 400 and their mean
  from 2.01 to 2.28 WAR per 600.
- **What is measured is what is served.** The held-out origins are projected in blocks of three, each by the method
  refit through the block's first origin, and the model served is the method refit through the last completed season
  (no hold-out widening chosen on the held-out cases, B-05, B-16). Under `production-3h.2` every origin is its own
  refit (the rolling-origin backtest below). Each horizon keeps its own prior weight and
  widening (B-10). A prior fitted on the same seasons as the save's held-out ones (matched by their season totals) is
  not used (B-09): on this save the fit uses no prior at all.
- **The gate** reads, as fitted, pooled coverage within 5 points and every subgroup (kind, usage third, quality tier,
  age band) within 10 points, and a bias that is material (over 10% of the mean outcome and over 0.05 wins) and
  significant (over three standard errors, clustered by player) fails it, at every horizon with 200 held-out cases
  (B-03, D-09).
- **Statistics.** Proneness effects are clustered by player and held to Holm's rule across the family of 18 tests,
  and a playing-time effect applies only at horizons 1–3 (B-08). The attrition logistic is ridge-penalized, pulled
  toward the prior's predictions by pseudo-cases rather than by blending coefficients, and flagged when it separates or
  fails to converge (B-14). A target season with a blank WAR is not scored (A-24).

**The run on the Arizona import** (read-only, scratch `history.db`): fit `203:2025:production-3h.1`, window 2006–2025
(2020 skipped at 37% of its neighbours' schedule), held out 2016–2025 and projected by refits through 2015, 2018 and
2021; the model served is fitted through 2025. 5,948 players. The prior was fitted on these same seasons, so it is not
used. Fit 9.6 s (four fits), in a worker thread (Part 7). **Gate: not passed**, so the fallback prior stays in force.

Held-out, as fitted (80% / 50%, bias in wins, actual − central), before (3b.1 as served) and after:

| Horizon | Cases | Before 80 / 50 | Before bias | After 80 / 50 | After bias | After, players who played (80 / 50, bias against the band when he plays) |
|---|---|---|---|---|---|---|
| 1 | 11,963 | 82.1 / 56.0 | −0.01 | 80.8 / 50.3 | −0.03 | 79.8 / 50.9, −0.05 |
| 2 | 9,859 | 81.1 / 52.8 | +0.05 | 80.4 / 50.4 | −0.03 | 80.0 / 50.6, −0.07 |
| 3 | 7,694 | 81.2 / 52.9 | +0.08 | 80.3 / 50.2 | −0.04 | 80.7 / 51.9, −0.11 |
| 4 | 7,724 | 82.4 / 55.6 | +0.10 | 80.0 / 50.1 | −0.05 | 80.7 / 50.0, −0.14 |
| 5 | 7,763 | 82.2 / 58.3 | +0.12 | 79.6 / 50.2 | −0.04 | 81.7 / 53.0, −0.14 |
| 6 | 9,635 | 83.3 / 61.5 | +0.12 | 79.3 / 49.9 | −0.04 | 81.2 / 53.3, −0.15 |
| 7 | 7,675 | 84.7 / 64.9 | +0.12 | 79.6 / 50.1 | −0.04 | 81.8 / 52.3, −0.17 |

By subgroup, after (80 / 50, bias; horizons 1, 3, 5, 7); the "before" column is the 3b.1 fit as served, bias at the
same horizons (age from reviewer B's independent rebuild):

| Subgroup | h1 | h3 | h5 | h7 | Bias before (h1 / h3 / h5 / h7) |
|---|---|---|---|---|---|
| Hitters | 82.6/52.6, −0.05 | 82.1/52.0, −0.08 | 81.6/51.3, −0.09 | 80.8/50.8, −0.08 | −0.02 / +0.09 / +0.12 / +0.12 |
| Starters | 80.1/48.2, −0.02 | 79.4/50.1, −0.00 | 78.9/49.7, +0.01 | 79.1/49.6, +0.05 | −0.02 / +0.16 / +0.22 / +0.26 |
| Relievers | 78.9/48.7, −0.01 | 78.7/48.1, −0.02 | 77.5/49.1, −0.01 | 78.5/49.3, −0.02 | −0.01 / +0.03 / +0.06 / +0.06 |
| Usage: fringe third | 83.2/53.1, −0.02 | 82.0/51.6, −0.00 | 81.7/51.6, −0.01 | 81.7/51.1, +0.00 | −0.02 / +0.02 / +0.03 / +0.03 |
| Usage: part-time third | 80.0/49.3, −0.01 | 79.1/49.0, −0.03 | 78.7/50.0, −0.01 | 79.8/50.8, −0.01 | −0.00 / +0.09 / +0.14 / +0.13 |
| Usage: regular third | 79.4/49.0, −0.05 | 80.0/49.9, −0.10 | 78.1/48.8, −0.11 | 77.9/48.7, −0.09 | −0.02 / +0.13 / +0.17 / +0.19 |
| Quality: top tenth | 78.2/50.1, −0.08 | 80.1/47.9, −0.10 | 75.3/45.7, −0.07 | 75.0/46.6, −0.05 | −0.12 / −0.00 / +0.11 / +0.16 |
| Quality: middle | 81.5/50.6, −0.03 | 80.5/50.4, −0.04 | 79.8/50.4, −0.04 | 79.9/50.3, −0.04 | −0.01 / +0.09 / +0.12 / +0.12 |
| Quality: bottom tenth | 77.6/48.4, +0.05 | 79.4/51.0, −0.00 | 81.9/53.1, −0.02 | 82.5/52.3, −0.02 | +0.05 / +0.11 / +0.13 / +0.12 |
| Age 25 and under | 79.3/47.0, −0.02 | 77.9/47.1, −0.05 | 80.0/51.1, −0.13 | 77.6/48.3, −0.14 | +0.03 / — / — / +0.21 (72.8/32.4 at h3, 61.2/31.2 at h7) |
| Age 26–29 | 80.6/51.4, −0.06 | 80.5/50.9, −0.06 | 77.9/48.9, −0.05 | 78.5/49.5, −0.03 | −0.03 / — / — / +0.17 |
| Age 30–33 | 81.0/49.9, −0.00 | 79.9/49.1, −0.02 | 80.4/50.6, −0.01 | 81.7/51.5, −0.02 | −0.01 / — / — / +0.06 |
| Age 34 and over | 82.0/51.3, −0.02 | 82.7/52.8, −0.03 | 81.7/51.5, −0.01 | 80.4/50.3, −0.01 | −0.03 / — / — / +0.03 (97.6/91.6 at h7) |

Every subgroup's coverage is within 5 points of the targets. The gate fails on 13 subgroup-horizon cells, every one
an over-projection: hitters at horizons 3–7 (−0.075 to −0.110 wins, 11–27% of the mean outcome), the regular third at
horizons 4–7 (−0.09 to −0.12), players aged 26–29 at horizons 3–4 and 34 and over at horizon 2, and the bottom tenth at
horizon 1 (+0.05). **In sample** (the served fit scored on its own training seasons) every one of these subgroups is
within 0.02 wins; out of time it is not, because 2016–2025 hitters produced less at long horizons than 2006–2015 did
(regulars' rate when they played 2.75 against 2.88 projected at horizon 5). That is era drift the save's own seasons will
replace, and the gate reports it rather than tolerate it: until a refit passes, the fallback prior is served (labelled
"not yet calibrated on this save", widened by its weight). Whether the subgroup tolerance should admit this drift is
the owner's decision (PLAYER_VALUE.md Part 12).

**The cohort, summed** (the 1,721 players projected from results, against what the save's own history gives the cohort
with a major-league line in a three-season window, h seasons on): 2027 974.5 against ~969 (+1%; before −10%), 2028
877.2 against ~879 (−0%; before −21%), 2029 748.7 against ~769 (−3%; before −32%), 2030 618.8 against ~654 (−5%;
before −43%), 2031 501.4 against ~549 (−9%; before −54%), 2032 398.7 against ~442 (−10%; before −66%).

**Components** (the served fit, through 2025): hitters K 400, mean 2.28; starters K 300, mean 1.29; relievers K 400,
mean 0.87. At horizon 1 a hitter who plays keeps 0.50 of his most recent slot's playing time per game plus 0.25 PA a
game per WAR per 600 of quality; the survivors' rate is −0.75 + 0.90 × his regressed rate (horizon 7: −0.46 + 0.63 ×).
Injury proneness: no effect survives Holm's correction with player-clustered errors (the largest, pitchers ≤ 56 at
92.3% ± 3.0 of expected playing time); proneness moves nothing on this save. The attrition logistic converged and did
not separate at every kind and horizon. The rest of this season is measured on this season's own games: of the players
who played in the first 22 games per club, hitters kept 97%, starters 98% and relievers 92% of their playing time per
game in the next 23, carried to the 72% of the season left at the same rate of loss per game.

#### The rolling-origin backtest (method `production-3h.2`, owner option C, 2026-09-23)

The 3h.1 gate failed on era drift: one hold-out block, 2016–2025, scored against a fit through 2015, so a single era
decided every long horizon. The owner kept the gate's tolerances (pooled coverage within 5 points, every subgroup
within 10, a bias failing at 10% of the mean outcome AND 0.05 wins AND three standard errors, 200 cases) and chose a
rolling-origin backtest instead of looser tolerances:

- **Origins.** Every completed season from the window's start + 5 to the season before the last is an origin; at most
  8 are used, evenly spaced and always including the first and the last (`PRODUCTION_POLICY.rolling`). Each origin Y
  is scored by the method fitted on seasons up to Y (its own refit), for Y+1 … Y+7 up to the last completed season.
- **What is scored.** A horizon of an origin is scored only where that origin's own fit has at least 200 cases and at
  least 3 origin cohorts at that horizon (`minimumOrigins`): a horizon the method could only fit on one or two seasons'
  cohorts is the prior's, not a test of the save's method. The pooled cases are clustered by player AND by origin
  (two-way: V = max(Vp + Vo − Vpo, Vp, Vo)), so one bad era widens the error instead of deciding the verdict.
- **Recency.** Each fit weights a season by 0.5^(age / half-life), the half-life a policy (2 seasons; `null` turns it
  off). The prior's pseudo-cases are scaled by the mean weight so the down-weighting does not hand the prior more pull.
  With the minimum-origins rule, the Arizona gate fails on 7 cells with no recency weighting, 5 at half-lives 4 and 3,
  and 2 at 2, every other result nearly unchanged; 2 was adopted. The owner's four approvals of 2026-09-23 (the serving
  rule, a career-ending injury, the rest of this season, the same-time ratings' pull) are recorded in PLAYER_VALUE.md
  Part 12 and D-053.
- **Serving.** The model served is the method refit through the last completed season; the origin refits exist only
  to measure it. The origins' horizon-1 cases sum to the pooled horizon-1 cases, and each origin's coverage and bias is
  reported on its own (`origin:` rows, not gated).

**The run on the Arizona import** (read-only, scratch `history.db`, fit `203:2025:production-3h.2`): window 2006–2025
(19 seasons, 2020 skipped); origins 2011, 2012, 2014, 2015, 2017, 2018, 2023, 2024 (horizon-1 cases 1,814 to 2,175
each; scored cases per origin 1,814 to 11,706); 5,948 players; the prior was fitted on these same seasons, so it is not
used. Nine fits (eight origins and the served one) take 17.2–17.4 s in the refit worker, 20.4 s with the ratings fit;
the server's event loop lagged at most 2 ms while it ran, and recording took 81 ms. **Gate: not passed** (two cells),
so the fallback prior stays in force, fitted to this league's own WAR scale.

Held-out, as fitted (80% / 50%, bias in wins, actual − central):

| Horizon | Cases | 80 / 50 | Bias | Hitters | Starters | Relievers |
|---|---|---|---|---|---|---|
| 1 | 15,497 | 80.6 / 50.4 | −0.01 | 81.7 / 51.5, −0.02 | 80.2 / 49.1, −0.01 | 79.4 / 49.6, −0.00 |
| 2 | 9,619 | 80.9 / 50.9 | −0.03 | 81.8 / 51.9, −0.06 | 80.3 / 49.7, +0.01 | 80.0 / 50.2, −0.01 |
| 3 | 5,661 | 81.1 / 50.7 | −0.03 | 82.5 / 52.5, −0.06 | 79.2 / 49.8, −0.03 | 80.2 / 48.8, −0.01 |
| 4 | 7,602 | 80.3 / 50.2 | −0.04 | 81.3 / 51.0, −0.08 | 80.5 / 50.4, +0.03 | 79.1 / 49.2, −0.02 |
| 5 | 3,892 | 79.6 / 50.0 | −0.04 | 80.7 / 50.6, **−0.10** | 79.3 / 50.0, +0.03 | 78.5 / 49.3, −0.01 |
| 6 | 3,892 | 79.3 / 49.9 | −0.04 | 80.9 / 51.4, **−0.10** | 78.9 / 48.7, +0.03 | 77.6 / 48.7, −0.00 |
| 7 | 3,892 | 79.2 / 49.7 | −0.02 | 81.3 / 50.9, −0.05 | 76.5 / 48.1, +0.06 | 77.9 / 49.0, −0.01 |

Every subgroup's coverage is within 10 points at every horizon (the lowest, the top tenth of projected rate at horizon
5, 72.7 / 43.7 on 377 cases); usage thirds, quality tiers and age bands are within −0.14 to +0.11 wins of the outcome
and pass the bias rule. Each origin's horizon-1 bias is between −0.04 and +0.00. Players who played at the target
horizon: 80.0–82.3 / 50.7–53.8, bias −0.03 to −0.17.

**The two failing cells** are hitters at horizons 5 and 6: −0.096 wins each, against mean outcomes of 0.45 and 0.36
(21% and 27%), over three clustered standard errors. They are scored from origins 2017 and 2018 only (the earlier
origins' fits have fewer than 3 cohorts that far ahead, and the later origins have no season 5 or 6 years on), with
targets 2022–2024: hitters after the universal designated hitter produced less five and six seasons on than the
2006–2017 history that fitted them. Nothing was loosened. What would pass them: more of the save's own seasons (each
completed season adds an origin and dilutes one era's long horizons), or an owner decision on the subgroup bias rule at
long horizons. A half-life shorter than 2 was not tried.

**Injury proneness under 3h.2:** no effect is distinguishable from none under player-clustered errors and Holm's rule
(hitters above 75: 97.9% ± 1.7 of the league's playing time; pitchers at 56 and under: 91.8% ± 3.1). The phase 3b
reading that the most injury-prone third of hitters played about 6% less (94.8% ± 1.2, section 6.1) used errors that
treated each player-season as independent; with a player's seasons clustered it does not survive, so proneness moves
nothing on this save.

### 6.2 The ratings model (phase 3b): what was fittable on this save, and what was not

`server/playerValueRatingsFit.ts` fits the ratings model per save; it is stored in `value_production_fits` under
`ratings-3b.1` with its run record and adopted through the same gate. Fit `203:2025:ratings-3b.1` on the Arizona
import (2026-05-16): **gate passed**, adopted; 1.5–1.6 s (reading 1.1–1.7 s, fitting 0.5 s).

**Fitted on this save now:**

- **Ratings → rate, same-time.** 1,147 major leaguers with scouted ratings and 200+ opportunities in the projection
  window (515 hitters, 240 starters, 390 relievers). Hitters (per point, WAR per 600): contact .098, power .083, eye
  .046, gap .011, avoid-K .007, running .006, glove at his position .010, with an intercept by position; starters stuff
  .082, movement .089, control .047; relievers .058, .095, .057. Held-out coverage over 5 folds of players, the variance
  judged on the other folds: 84.5% / 57.2% (hitters 85.5 / 57.8, starters 79.6 / 56.7, relievers 85.9 / 56.4). **The
  leakage caveat, measured:** for hitters and relievers the held-out residuals are *smaller than their own season noise*
  (the 80% band covers 85–86% with no true-rate uncertainty at all): a historical start set these ratings from these
  seasons, so the same-time fit describes, it does not forecast. Consequently the ratings are not given a reliability
  the same-time fit claims: until the save's snapshots can measure it, what is not known about a player's rate given
  his ratings is the kind's population variance (noise × 600 ÷ K), and in a blend the ratings weigh K ÷ (n + K), the
  weight the kind's mean had.
- **How often each batting hand faces left-handers** (major-league plate appearances 2023–2026): left .199, right .320,
  switch .279. A hitter's bat is his splits weighted by it.
- **The stamina cut** for a pitcher with no professional games: 50 (misclassifies 11.1% of 630 major-league pitchers).
- **Arrival rates**, from the minor-league usage lines (never WAR) of 42,598 players, 571,079 player-seasons at levels
  2, 3, 4 and 6, window 2006–2025, trained through 2015, held out 2016–2025; 78 level-and-age cells. Held-out, the
  chance of any major-league playing time predicted and observed: the same season 4.6% / 4.7%, one season on 4.4% /
  4.7%, two 7.2% / 7.7%, three 8.9% / 10.3%, four 9.4% / 11.5%, five 9.4% / 11.9%, six 8.7% / 11.1% (within the gate's 10
  points; the fit slightly under-predicts later arrivals, recorded, not tuned away). The imported minor-league history
  is the real world's, as the major-league history is.
- **The largest scouted development by age** (the widening when a player's potential is unknown), from the save's
  cross-section.

**Not fittable on this save yet** (it holds one rating snapshot, 2026-5-16; R-9), each labelled and fitted
automatically when the evidence exists:

- **The development path** (ratings at t against ratings at t + h): 0 of the 300 snapshot pairs a season apart it
  needs. In force: the provisional prior, one cross-section's mean scouted gap by age (hitters 20.8 at 16, 12.2 at 19,
  10.8 at 21, 6.8 at 24, 3.1 at 25, none from 26; pitchers 15.7, 13.3, 10.5, 8.2, 4.3, none from 26), read as the share
  of the gap closed from one age to a later one, with a range from no further development to twice that share. A
  cross-section is not a path (players who do not develop leave it), so its central likely overstates development;
  its range is wide on purpose.
- **The ratings' reliability as a forecast** (this season's snapshot against next season's rate): 0 of the 50 seasons
  per kind it needs.
- **The arrival chance by potential**: 0 of the 300 linked snapshot seasons it needs; arrival is by level and age only.

When the snapshots arrive, the refit after an import picks them up by itself (a ratings key that fitted before the
snapshots were enough is refitted once when they become so), and the record says which parts are the save's.

### 6.4 The ratings model after hardening F4 (method `ratings-3h.1`, 2026-09-23)

Four changes to the arrival part (PLAYER_VALUE.md 2.3, "What hardening F4 changed"), one to the blend, and a tighter
gate. The method version moved, so the phase 3b fit is not read any more and every save refits once.

- **C-01, the condition.** A player called up in his origin season stays in the later seasons' cases, kept apart
  with his share; a projected player not yet called up at share f of his season is read with 1 − f of the season's
  call-ups still to come (a call-up equally likely at any point of the season's games: policy, since the export dates
  no past call-up), and the band reaches none and all of them. The held-out check is read on the same unconditioned
  cases, each at the start of its season.
- **D-07, the population.** Where the export names parents, lines in another market league's farm or an independent
  league are left out; a league the export no longer lists (the Arizona import's defunct short-season and rookie
  leagues, 214, 215, 216, 219, 235) is kept as not known to be another's; any top-level league is arriving. On the
  Arizona import this changes nothing (one market league); the synthetic two-league save
  (`playerValueCrossSave.test.ts`, D-07) pins it.
- **C-02, quality.** The fit records the results fit's quality coefficients at the same usage (hitters' chance logit
  0.20 / 0.20 / 0.32 / 0.66 / 0.89 / 1.00 / 0.91 per WAR per 600 above replacement for the rest of this season and
  horizons 1 to 6; starters 0.52 to 0.92; relievers 1.42 falling to 0.38; playing time about 0.3 opportunities per
  scheduled game), and each cell's players now at every horizon (20 sampled in order of quality). On the Arizona import
  these are the fallback production prior's coefficients, because the results fit (F1's `production-3h.2`) is not
  adopted on this save.
- **The serving rule.** The arrival model served is the method refit through the last completed season (it was the
  training seasons' fit); the held-out seasons are scored by the method fitted through the training seasons.
- **B-15, the gate.** Beside the absolute 10 points, a held-out chance or expected playing time (opportunities per
  case) biased beyond 10% of what happened AND beyond three standard errors clustered by player fails, the production
  gate's rule (`RATINGS_POLICY.gate.arrivalBias`). A tightening only: every fit the absolute rule failed still fails. A
  synthetic league predicting 12% where 4% happened (an 8-point miss) passed before and fails now
  (`playerValueRatings.test.ts`).
- **A-15, the blend.** Covered in PLAYER_VALUE.md; no fitted number.

**The Arizona run** (`203:2025:ratings-3h.1`, `npx tsx scripts/calibrate.ts production --refit`, scratch data dir,
`league.db` read-only): 42,598 players with minor-league usage, 592,916 player-seasons at levels 2, 3, 4 and 6 (571,079
before: the origin season's call-ups now stay in the later cases), window 2006–2025, trained through 2015, held out
2016–2025, 93 level-and-age cells. The mapping is unchanged (84.5% / 58.1% on 1,147). Held out, the chance predicted
against what happened (± its standard error, clustered by player) and the expected opportunities per case:

| Horizon | Cases | Chance predicted | Happened | Bias / happened | Opportunities predicted | Happened | Bias / happened |
|---|---|---|---|---|---|---|---|
| 0 (the same season) | 53,445 | 4.6% | 4.7% (± 0.1) | 0.7% | 5.2 | 5.2 | −0.1% |
| 1 | 46,503 | 7.5% | 7.9% (± 0.1) | 4.4% | 12.4 | 12.7 | 2.4% |
| 2 | 41,004 | 9.6% | 10.2% (± 0.2) | 6.2% | 18.9 | 19.0 | 1.0% |
| 3 | 34,251 | 10.9% | 12.4% (± 0.2) | 12.1% | 23.9 | 24.5 | 2.7% |
| 4 | 28,739 | 11.1% | 13.1% (± 0.3) | 15.8% | 25.8 | 27.3 | 5.5% |
| 5 | 22,301 | 10.8% | 13.4% (± 0.3) | 19.4% | 26.8 | 29.3 | 8.4% |
| 6 | 27,906 | 9.9% | 12.3% (± 0.3) | 19.8% | 25.4 | 28.1 | 9.6% |

Before (method `ratings-3b.1`, which dropped the origin season's call-ups from horizons 1 to 6 in both the fit and the
check): 4.6 / 4.7, 4.4 / 4.7, 7.2 / 7.7, 8.9 / 10.3, 9.4 / 11.5, 9.4 / 11.9, 8.7 / 11.1, all inside the absolute 10
points; under the new rule the same numbers would also have failed at horizons 3 to 6.

**Gate: FAILED** at horizons 3 to 6 (the chance 12–20% low, 7 to 9 standard errors). The save's arrival rates rose
from the training seasons to the held-out ones, and the arrival method weighs every season alike; it is recorded, not
tuned away. The fit is not adopted: the provisional ratings prior is in force, which measures no arrivals, so on this
import a player not in the majors has production `unknown`, with the gate's reason in his basis. The results path's
blend with ratings is unaffected in kind (the prior's mapping is this import's own, fitted with no prior).

**Read as if adopted** (a diagnostic copy of the store with the fit forced in; never the served state):

| Season | Prospects' summed central, before | C-01 alone | C-01 and C-02 | The save's own history, a population this size |
|---|---|---|---|---|
| 2027 | 15.2 | 69.2 | 101.6 | about 144 |
| 2028 | 22.2 | 106.9 | 168.9 | about 260 |
| 2029 | 23.6 | 116.8 | 211.4 | about 362 |
| 2030 | 21.4 | 101.2 | 234.8 | about 426 |

The history column is the recent origins' (2016–2025) total major-league WAR one to four seasons on of players at
levels 2, 3, 4 and 6 with no major-league line in the two seasons before (22.7, 41.0, 57.0 and 67.0 wins per 1,000 such
players), scaled to the 6,351 players projected from ratings. The prospects' expected playing time is close to that
history's (17.8 opportunities per prospect one season on against 13.0 per case, the difference being who is in the
population now); what remains short is their rate when they play, about 0.55–0.6 WAR per 600 against the save's real
arrivals' 1.0–1.6, which is the ratings path's (the same-time mapping and the provisional development prior), not the
arrival model's. Negative centrals: 4,480 in 2029 (4,348 before), almost all within a few hundredths of a win; 642
players have some season below −0.1 wins (750 before), the worst Santiago Pereira (130821, 17, level 4) at −1.19 in 2031.
Low edges below −1 in some season: 365 (574 before); below −3: 35 (6 before, the youngest weak prospects, whose
chance C-01 raised). The regression sweep holds: 53 checks pass in the served state and 55 as if adopted, none failing.
A full valuation of the league takes about 1.9 s as if adopted (1.5 s before), 1.0 s served.

#### The arrival model under option C (hardening F5, method `ratings-3h.2`, owner 2026-09-23)

The owner approved applying option C to the arrival model: the same rolling-origin backtest and 2-season recency
weighting as the results fit, judged by the same (tightened) gate, the gate not loosened. The method version moved, so
every save refits its ratings model once.

- **Origins.** The results fit's rule, shared (`rollingOrigins`, `RATINGS_POLICY.backtest.origins` is
  `PRODUCTION_POLICY.rolling`): every completed season Y from the window's start + 5 to the season before the last whose
  next season is in the window, at most 8, evenly spaced with the first and last kept. Each origin is fitted through Y
  and scored on season Y + 1's minor leaguers at horizons 0 to 6 (the served model is fitted through the last season and
  projects the season under way, so this is its analogue); a horizon of an origin is scored only where the fit through
  Y holds the gate's 200 cases on that side from at least 3 origin cohorts.
- **Recency.** Each arrival fit weights a case by 0.5^((the fit's last season − its target season) / 2) in its chance,
  playing time, nodes and call-up share (`RATINGS_POLICY.backtest.recencyHalfLife`). Age bands are still sized on the
  cases themselves, and the arrival fit has no prior's pseudo-cases to rescale (the results fit's mean-weight rule has
  nothing to apply to). Within one horizon, weighting by target season and by origin season are the same.
- **Errors.** The gate's standard errors are clustered by player and by origin (two-way, the results gate's
  `twoWayClusteredSe`, shared). The tolerances are F4's, unchanged: the absolute 10 points, and a bias beyond 10% of
  what happened AND three standard errors, on the chance and on the expected opportunities per case.
- **A tightening that the change needs.** Arrivals, once measured, are adopted only where the next season (horizon 1)
  could be checked on held-out cases: with rolling origins a history shorter than seven seasons has no origin, where F4's
  single split still checked it. Without this the change would have loosened the gate for short saves.
- **Serving** is unchanged: the model served is the method refit through the last completed season.

**The Arizona run** (`203:2025:ratings-3h.2`, `npx tsx scripts/calibrate.ts production --refit`, scratch data dir,
`league.db` read-only): origins 2011, 2013, 2014, 2016, 2017, 2021, 2022, 2024 (2019 is not an origin: 2020 is short and
out of the window), scored cases per origin 6,517 to 35,016. The mapping is unchanged (84.5% / 58.1% on 1,147).

| Horizon | Cases | Origins | Chance predicted | Happened (± SE, player and origin) | Bias / happened | Opportunities predicted | Happened (± SE) | Bias / happened |
|---|---|---|---|---|---|---|---|---|
| 0 (the same season) | 46,504 | 8 | 4.7% | 4.6% (± 0.1) | −1.7% | 5.3 | 5.3 (± 0.15) | 1.4% |
| 1 | 39,987 | 7 | 7.8% | 7.8% (± 0.4) | 0.3% | 12.6 | 12.9 (± 0.43) | 2.4% |
| 2 | 34,655 | 6 | 10.0% | 10.0% (± 0.6) | 0.0% | 18.8 | 19.0 (± 0.61) | 1.1% |
| 3 | 27,902 | 5 | 11.4% | 12.3% (± 0.7) | 7.5% | 24.0 | 24.8 (± 1.08) | 3.0% |
| 4 | 22,243 | 4 | 11.4% | 13.7% (± 0.3) | **16.7%** | 26.4 | 28.7 (± 1.24) | 7.9% |
| 5 | 16,638 | 3 | 11.1% | 13.3% (± 0.3) | **16.8%** | 27.4 | 30.0 (± 1.43) | 8.9% |
| 6 | 16,773 | 3 | 10.1% | 12.2% (± 0.4) | **16.9%** | 26.0 | 27.8 (± 0.98) | 6.6% |

**Gate: FAILED** at horizons 4 to 6: the chance is 17% below what happened, about 7 standard errors clustered by player
and origin. Horizons 0 to 3 pass (F4's single split failed horizon 3 as well). The fit is not adopted; the provisional
ratings prior stays in force, and a player not in the majors remains `unknown` on this import with the gate's reason.

The half-life, compared (`--arrival-half-life=`, the same origins; the chance's bias as a share of what happened at
horizons 3 / 4 / 5 / 6): none 11.4 / 19.2 / 19.0 / 18.3%; 4 seasons 9.2 / 17.9 / 17.9 / 17.6%; 3 seasons 8.5 / 17.5 /
17.5 / 17.3%; 2 seasons (the policy) 7.5 / 16.7 / 16.8 / 16.9%. As a diagnostic only, not policy, a half-life of 1
season still fails horizons 4 to 6 (15.0 / 15.2 / 15.7%). Recency cannot close it, and the reason is structural: at
horizon h the fit through Y can hold no cohort later than Y − h, so a long horizon is always read from cohorts five or
more seasons older than the one it is scored on, and on this save the long-horizon arrival rate rose cohort after cohort
(horizons 4 to 6 are scored only from origins 2013 to 2017, targets 2018 to 2024, every one under-predicted). Nothing was
loosened.

**Read as if adopted** (a diagnostic copy with the failing fit forced in, never served): the prospects' summed central
for 2027 / 2028 / 2029 / 2030 is 111 / 201 / 256 / 258 wins (F4's method as if adopted 102 / 169 / 211 / 235; the save's
own history for a population this size about 144 / 260 / 362 / 426). 563 players have some season's central below −0.1
(642 under F4's), 35 some low edge below −3 (35). Aidan Miller (41278) reads a chance of 0.59 for the rest of 2026, then
0.81, 0.84, 0.91, 0.91, 0.97 and 0.92 (F4's 0.58, 0.77, 0.83, 0.90). The regression sweep holds: 53 checks pass served and
55 as if adopted, none failing. The ratings refit takes 4.8 s in the worker (3.1 s before: nine arrival fits where there
were two); a full league valuation 1.0 s served, 1.8 s as if adopted.

#### The arrival model adopted horizon by horizon (hardening F6, method `ratings-3h.3`, owner 2026-09-23)

The owner chose option (b): "The arrival model is adopted horizon by horizon: a horizon whose held-out check passes the
(unchanged, tightened) gate is served; later horizons are shown as not established. The gate is not loosened." It applies
to the arrival model only; the results fit keeps its all-horizons rule. The method version moved, so every save refits
its ratings model once.

- **The rule** (`RATINGS_POLICY.adoption`, policy). Each horizon's held-out check is judged by F4's tolerances as before.
  The horizons served are the contiguous run from horizon 0 through the last horizon k whose check, and every check before
  it, passed. A horizon after one that failed, or after one with fewer than the gate's 200 held-out cases, is never
  served, even where its own check passes. Nothing is adopted unless the run reaches horizon 1, and the mapping must still
  pass its own gate.
- **Serving.** The model served carries nothing past k. A prospect's seasons 0 to k are projected exactly as before; each
  season after k is not established, with the gate's finding at its horizon as its reason, and has no band, central or
  zero. A total over seasons that include one is not a number (`productionTotal`). The fit's label and the cone say
  "calibrated through N seasons out".
- **A tightening for saves whose later horizons could not be checked.** Before, a horizon with too few held-out cases was
  not judged and was served. Now it ends the run, so seasons past it are not established.

**The Arizona run** (`203:2025:ratings-3h.3`, `npx tsx scripts/calibrate.ts production --refit`, scratch data dir,
`league.db` read-only): the held-out figures are F5's to the digit, because the method is unchanged apart from adoption.
Horizons 0 to 3 pass (bias / happened −1.7%, 0.3%, 0.0% and 7.5%) and 4 to 6 fail (16.7%, 16.8% and 16.9% low, about 7
standard errors). **Gate: PASSED**, and the arrival model is **adopted through 3 seasons out**. The record reads, for
example, "4 seasons out: the save's held-out arrival chance ran 17% low (predicted 11.4%, observed 13.7% ± 0.3%),
outside the gate". The ratings refit takes 4.8 s in the worker. The results fit (`production-3h.2`) still fails its own
gate (hitters' bias at horizons 5 and 6), so the fallback prior stays in force for results.

Served (the first served state, not a diagnostic): 6,351 prospects are projected. The 149 players on the ratings path
who stay `unknown` are on a major-league club with no major-league line in the window. All 6,351 are projected for the rest of 2026 and
2027 to 2029; 2030 to 2032 are not established for every one of them.

| Season | Prospects' summed central | F5 as if adopted | The save's own history, a population this size |
|---|---|---|---|
| 2026 (the rest of it) | 24.4 | — | — |
| 2027 | 111.0 | 111 | about 144 |
| 2028 | 201.4 | 201 | about 260 |
| 2029 | 256.0 | 256 | about 362 |
| 2030 to 2032 | not established | 258 (2030) | about 426 (2030) |

- 262 players have an established season with a central below −0.1 wins (563 over all seven seasons as if adopted under F5).
- 1 has a low edge below −3 (35).
- No player's horizon total is a number, because each prospect has seasons that are not established.
- Aidan Miller (41278, 21, level 2): chance 0.585 / 0.813 / 0.837 / 0.907 for 2026 to 2029, centrals 0.23 / 0.93 / 1.58
  / 3.04 wins. 2030 to 2032 are not established, each with its horizon's finding.

The regression sweep: 65 checks pass and none fails. These are F5's 53, with "7 seasons" re-read as seven consecutive
seasons, established and then not established, plus 12 checks for this change. The prospect checks now have subjects:
25,404 arrival chances.
A league valuation takes 2.1 s.

## 7. Player Value's opening price of a win: policy minimums (hardening, B-13)

The opening price of a win (PLAYER_VALUE.md Part 4.1) is a spread of defensible bases, not a fit, so it has nothing
fitted to calibrate. What the hardening added are two **policy** minimums, `OPENING_PRICE_MINIMUMS` in
`server/playerValueCalibration.ts`, stamped `OPENING_PRICE_MINIMUMS_CALIBRATION`, and one mechanism.

| What | Value | Stamp | Why |
|---|---|---|---|
| A season's WAR on this season's footing | share of this season's schedule it covered | mechanism, no constant | A 60-game season (2020) is 37% of a 162-game schedule; read as a full season it made bases A, B, C and C2 about 2.7 times the price. Each past season's WAR is divided by its games per club over this season's games per team, both ways, and a season whose share is not established is not assumed full |
| Least share of a schedule a basis may rest on | a quarter (0.25) | policy | A pace's noise grows as the share shrinks (the pace at 5% of a season is noise); below a quarter the scaled reading is more noise than price. Applies to a past season and to this season's pace alike |
| Fewest contracts one basis may rest on | 20 | policy | A basis is salaries over WAR; one player's season WAR scatters by about a win around what he was paid for, so a basis on n contracts moves by roughly 0.6 ÷ √n of itself (about 13% at 20). Fewer, and bases differ by who is in them, not by what they measure |

Below either minimum a basis is not computed and says why; with fewer than two bases left the price is `unknown`, never a
point. On the Arizona import (2026-05-16, 27.6% of the season played, 253 market contracts, 124 starting 2026, prior
seasons 2024 and 2025 at 99.96% and 100% of the schedule) every basis clears both minimums and the price is unchanged:
central $7.25M, band $6.57M–$9.78M, floor $4.22M–$4.33M. Basis B2's WAR moves from 454.6 to 454.7 (2024's rain-outs)
and rounds to the same $7.32M. The pace bases stand on 27.6%, just over the quarter: a save exported two weeks earlier
would drop them and price from the four prior-season bases alone. The sampling component B-13 also asks for (a
bootstrap over contracts before the opening band is compared with a measured one) belongs to phase 4, where that
comparison is built.

## 8. Player Value's cost of controlled seasons: the renewal spread and the arbitration ladder (phase 4a)

The cost of a pre-arbitration or arbitration season (PLAYER_VALUE.md 2.2 and 4.4, `server/playerValueCost.ts`) is
**measured on each import** from the save's own contracts, like the opening price of a win (section 7), and snapshotted
with the market (`value_market_snapshots.basis_json.costs`) so its drift is visible. It is not a D-053 fit with a gate:
one import holds one cross-section of salaries set last winter and no outcome to hold out, so there is nothing to
backtest until arbitration awards are observed across an off-season (phase 4b, which tests this ladder against them).
Code holds the method and its policy (`COST_POLICY`, stamped policy) and a provisional fallback prior (`COST_PRIOR`,
stamped provisional); the numbers served are the save's. Status and class come from Player Rights
(`evaluateContractControl`, `arbitrationRegimeOf`), never from service compared with a threshold here.

| What | Value | Stamp | Why |
|---|---|---|---|
| The renewal band's high edge | the 90% upper confidence bound (an order statistic) of the 90th percentile of the save's pre-arbitration one-year renewals | policy | Nine renewals in ten stay under it; the bound makes a thinner class read higher, never lower. It is itself one of the renewals: below 38 renewals it is the largest, so there one unusual renewal does set it, and the band's text says which renewal bounds it (review R2-06: the text was fixed, not the number) |
| The renewal band's central | the median renewal | policy | A band is three numbers (PLAYER_VALUE.md Part 3); on Arizona $780K |
| The arbitration performance basis | the mean WAR of the two seasons before the arbitration winter, each on its schedule's footing; a season with no line counts 0; a platform season must cover a quarter of its schedule (`OPENING_PRICE_MINIMUMS.seasonShare`, the price of a win's policy, reused: review R1-03) | policy | Arbitration pays for a body of work; on the Arizona import the two-season platform explains each class's pay better than the platform season alone (R² 0.715 against 0.619, 0.300 against 0.096, 0.626 against 0.549 for classes 1–3, least squares). A future season's platform seasons are projections, meaned edge with edge |
| The ladder's form | per class, a robust (Theil–Sen) line of pay above the minimum on the platform: a base and a pay per platform win, in the import's own dollars | policy | Least squares let one free-agent-market contract Player Rights reads in the class (Imanaga, $22.0M on a 1.6-win platform in class 2; Kim, $20.0M on 1.2 in class 3) and one star (Skubal, $32.0M on 6.6) move a rung: class 3 read $3.54M a win, $2.61M without Skubal (review R2-04). Theil–Sen is the median of the slopes between every two contracts: deterministic, no tuning, and one case moves it no further than it moves a median. R-6's ratio (pay over positive WAR, no base) reads low-WAR players as costing the minimum, which arbitration does not pay. The line is in the import's dollars, so the price of a win's band never applies to it (supervisor, phase 4a) and an unknown price leaves it standing (review R1-10) |
| The class's spread | the 10th to 90th percentile of its pay around the line (an inverted-CDF quantile, unchanged by duplicating the class) | policy | The same 80% as production's outer band. One pair of dollar figures across the class's platforms, although pay scatters more at a middle platform (review R2-09; a log line fits worse); recorded below, revisited in phase 4b |
| The line's own uncertainty | the robust line refitted on 200 bootstrap resamples of the class (a fixed seed): the spread of its level at the class's median platform and of its rung, and their correlation; 1.28 of the resulting standard errors on each side, added to the spread edge against edge | policy | The closed form belongs to least squares; the bootstrap reads the same fit's own uncertainty. Added linearly, not in quadrature, so wider. Fewer contracts read wider, never narrower |
| Its floor | the least the class was paid above the minimum; the league minimum for a season whose platform low edge reaches as low as the class's contracts at the minimum | measured | Pay at the minimum is held at the floor, not set by the platform, so those contracts are kept out of the line; but the save shows them (8–12% of each class on Arizona, all at platforms of −0.3 to +0.3 wins), so a season with such a platform can cost the minimum, and says so (review R1-04) |
| Which contracts | one-year major-league deals set this winter, held by players Player Rights finds in arbitration, by class (the class his service puts him in); a contract at the minimum is kept out of the line and counted with its platform | policy | Which transaction produced a one-year deal at the minimum (an award, a non-tender re-signed) is not in the export and is never named. One-year deals whose holder's standing this season is open (the Super Two window: 110 on Arizona) are read by neither the renewal spread nor the ladder, and the ladder says how many (review R2-14). Extensions are left out, and they select: in class 2 the extended players' platforms average 3.1 wins (7 of 15 at or above 3) against 1.3 for the one-year deals (2 of 51), so the line above 3 wins rests on few contracts and a season priced there says it is extrapolated (review R2-08) |
| Minimum sample | 30 contracts a class (30 renewals) | policy | Below it a class has no line of its own: the provisional prior's reading hulled with the range the save paid the class, only where the regime as read is MLB's; elsewhere unknown (review R1-01, R2-02) |
| Never below the previous salary | an arbitration season's low edge, central and each class's central at least the previous season's salary where known (this season's contract salary for next season; the season before's low edge after that) | policy (owner-attested, 2026-09-24) | The owner: "I've never seen a drop". Player Rights states the rule (`arbitrationSalaryFloor`, basis `owner_attested`) for every league with arbitration; not MLB's 80% cap on a cut. Where the ladder's every reading is below it the season is his previous salary, said; where it is not known the rule cannot bind, said; a non-tender stays possible, said |
| Payroll's sum over players | the sum of centrals; each player's distance beyond his non-noise edges combined as independent (root sum of squares, low and high apart); which status, which class of a range and whether he is held stay at their edges, added | policy (owner, 2026-09-24; `COST_COMBINATION_POLICY`) | R2-01: every player at his edge at once is no club's reading. Labelled "players combined as independent; not a calibrated interval"; the edge-to-edge sum in the details; one player's range is his own band. A class's line error, shared by its players, is read as independent too |
| The fallback prior | the review's method on the Arizona import's imported real-world contracts, in minimums and shares of the price | provisional | `COST_PRIOR`; never presented as the save's measurement, never used where the regime is not MLB's or the minimum is $0, and the only reading the price of a win's band multiplies |

**The Arizona import (2026-05-16).** Minimum $780,000; price of a win $7.25M (band $6.57M–$9.78M).

- **Renewals:** 249 pre-arbitration one-year renewals, 220 at the minimum; the band is **$780K–$790K**, central $780K
  (the median). The upper bound is the 19th largest of the 249 renewals, leaving out the 18 largest: the eight above
  $900K (Sugano $5.1M, Villar $3.36M) look like one-year signings of players with little service rather than renewals.
- **Arbitration ladder (measured, every class above the minimum sample; the review's robust line):**

| Class | Contracts | At the minimum, kept out (platforms up to) | Base (pay above the minimum at no platform wins) | Per platform win (share of the price's central) | Spread (10th–90th) | Line's bootstrap SD (level; rung) | Least squares (base, per win) |
|---|---|---|---|---|---|---|---|
| 1 | 74 | 10 (0.3 wins) | $0.38M | $0.96M (13.3%) | −$0.66M to +$1.25M | $0.14M; $0.09M | $0.44M, $1.04M |
| 2 | 51 | 6 (0.3) | $1.04M | $1.75M (24.1%) | −$1.23M to +$2.56M | $0.26M; $0.21M | $1.35M, $1.92M |
| 3 | 47 | 4 (0.2) | $0.65M | $2.54M (35.1%) | −$1.14M to +$5.43M | $0.35M; $0.33M | $0.41M, $3.54M |

  The robust line sits under the market contracts and the star, so they now show in the spread's high edge (class 3's
  90th percentile rose from +$3.46M to +$5.43M) rather than in the rung. R-6's own figures (one-season platform,
  service at the winter, the minimum cases in) were about 22%, 42% and 53% of the price; the same statistic on this
  method's cases reads 19%, 40% and 52%. The line's share is lower than the ratio because the base carries what a class
  is paid whatever its platform. The class band (line, spread and 1.28 bootstrap standard errors, at a known platform)
  covers its own contracts 63 of 74, 44 of 51 and 42 of 47, as least squares did; by platform tercile 24/25, 19/25,
  20/24 (class 1), 15/17, 13/17, 16/17 (class 2), 16/16, 13/16, 13/15 (class 3): over-covered at a low platform,
  under-covered in the middle (R2-09), recorded for phase 4b.
- **Worked examples** (80% production band; the save's own lines in this import's dollars; before the owner's
  decisions of 2026-09-24, whose effect follows): Gunnar Henderson, a
  first-year arbitration player at $8.5M, 2027 is trip 2–3 and, optioned for the rest of 2026, would be read in class 1:
  **$2.7M–$22.2M**, central $8.9M (least squares: $4.6M–$25.3M; before the supervisor's fix $4.1M–$31.7M); 2028
  $3.2M–$27.4M, central $12.7M; 2029 may be free agency, $5.3M–$30.6M if held, central $14.2M. Paul Skenes (Super Two not
  decided): 2027 between pre-arbitration and arbitration, **$0.78M–$18.3M**, no single central (each status's named).
  Nick Kurtz (a pre-arbitration star, 6.0 WAR in 2025): 2027 **$780K–$790K**, 2028 open $0.78M–$11.1M, 2029 arbitration
  1–2 $3.4M–$24.6M, central $7.7M. Trevor Megill, 2027 trip 3–4 (a fourth trip is priced in class 3): $1.24M–$9.9M,
  central $3.2M. Dane Dunning ($780K now, a platform near 0): 2027 **$780K–$7.4M**, its low edge at the minimum because
  class 3's four at-minimum deals sit at platforms up to 0.2 wins and his reaches as low (before: $1.2M–$5.7M).
- **Counts** (the rostered league's controlled seasons): 1,465 arbitration seasons and 359 renewals priced, 1,101 open
  seasons priced across their statuses; 16 arbitration seasons unknown (the platform's production unknown); 192 priced
  on a platform beyond the platforms a class was measured on, said. Arizona's Payroll 2027: committed $133.2M; the
  range $12.9M–$75.8M for 16 controlled players (two may reach free agency), central $22.7M–$27.6M (the two counted
  as leaving, then as held).

The bands are wide by construction: every corner of the production band, the class's spread and the line's error is
taken (and the price band, where the provisional prior is in the reading), and a range of trips covers each class and
the class his service puts him in. They are ranges of reasonable readings, not calibrated intervals, until phase 4b can
score them against observed awards.

**The owner's decisions (2026-09-24).** *An arbitration salary is never below the previous season's salary*
(owner-attested). On the Arizona save 526 of the 2,566 arbitration-priced seasons move (median lift $0.83M, largest
$20.8M), 127 centrals rise, 9 high edges rise and 9 seasons become a point at the previous salary (market contracts read
as arbitration by service: Imanaga 2027 $1.20M–$12.05M → $22.02M; Kim 2027, if held, → $20.00M). Before, 196 of the 234
2027 arbitration seasons had a low edge below the 2026 salary and 74 a central below it, and 112 held players' low edges
fell from one arbitration season to the next; after, none. In the Arizona organization 10 of 68 arbitration-priced
seasons move. Examples: Trevor Megill ($4.70M in 2026) 2027 $1.24M–$9.92M, central $3.24M → **$4.70M–$9.92M, central
$4.70M**, 2028 (if held) $0.78M → $4.70M at the low edge; Gunnar Henderson ($8.50M) 2027 $2.75M → **$8.50M**–$22.16M, 2028
$3.15M → $8.50M, 2029 (if held) $5.33M → $8.50M, centrals unchanged; Dane Dunning ($780K, the minimum) unchanged,
$780K–$7.40M; Ryne Nelson ($3.00M, Arizona) 2027 $1.80M → $3.00M, 2028 $0.78M → $3.00M; Steven Kwan ($7.72M) 2027
$2.34M → $7.72M, central $6.23M → $7.72M. *Payroll combines players as independent*, what is not noise at its edges:

| Club | Season | Edge to edge (low edges if he leaves) | Players combined as independent | Sum of centrals |
|---|---|---|---|---|
| Arizona | 2027 | $15.8M–$75.8M | **$16.4M–$49.0M** | $22.7M–$29.7M |
| Arizona | 2028 | $13.5M–$92.8M | **$15.1M–$50.2M** | $18.7M–$27.9M |
| Arizona | 2029 | $7.8M–$111.6M | **$8.1M–$57.1M** | $9.3M–$25.0M |
| Arizona | 2030 | $7.8M–$108.0M | **$12.7M–$52.1M** | $15.9M |
| Arizona | 2031 | $7.0M–$97.6M | **$14.6M–$48.7M** | $21.7M |
| Pittsburgh | 2029 | $17.8M–$228.2M | **$37.6M–$113.0M** | $48.2M–$58.3M |
| Cincinnati | 2029 | $16.7M–$233.0M | **$27.6M–$114.0M** | $37.0M–$60.4M |

(The edge-to-edge columns include the floor; before the decisions Arizona 2027 read $12.9M–$75.8M, central
$22.7M–$27.6M.) The combined range is 36–57% of the edge-to-edge width, as R2's simulation had it (35–56%): most
arbitration players' bands cover a range of classes (the trip and his service's class), so only the distance beyond the
range's lowest and highest class central is combined, and the class choice stays at its edges.

## 9. Player Value's measured price of a win across imports (phase 4b)

The measured price (PLAYER_VALUE.md 4.2 to 4.4, `server/playerValueSignings.ts`) is **measured across the save's own
imports**, never fitted in code: each import records its contracts (`playerValueContractStore.ts`, table
`value_contract_snapshots`, keyed by the save's identity), and two consecutive imports are compared. Every rule is
policy (`SIGNINGS_POLICY`, stamped `SIGNINGS_POLICY_CALIBRATION`); each minimum is an existing one, reused. It is not a
D-053 fit with a gate either: it is a ratio read on what the save's clubs did, and its band says how much the signings
observed support it.

| What | Value | Stamp | Why |
|---|---|---|---|
| Which changes are read | a contract whose first season, length or club changed between two consecutive imports | mechanism | R-6. A snapshot difference proves the contract changed, never which transaction did it (D-020) |
| How a change is read | Player Rights' standing at the EARLIER import for the new contract's first season | mechanism | The standing the salary was set under; nothing compares service with a threshold here |
| A free agent re-signed by the club that held him | counted, left out of the price | policy | Whether he re-signed before or after he reached the market is not exported |
| A free agent signed by an organization his lines show held him during the season before | counted, left out of the price | policy (review R3-04) | A deadline acquisition re-signed is not the open market; where his lines cannot be read he is left out and it says why |
| A deal whose first season was under way at the earlier import | left out of the price | policy | Its salary pays for part of a season the export does not date. A season is under way only once it has begun: an import before Opening Day, or with no line of the season in the export (the season number moved on beside last season's standings, D-08), records a share played of 0 (review R3-01) |
| A winter | read by the calendar: an import in a season under way precedes the next winter; one before its season began is inside it; a pair spanning more than one winter is counted and not measured | mechanism (review R3-01, R3-11, R4-12) | Several imports across one winter are one winter, never one per pair |
| The timeline | imports paired in the order recorded; a date at or before the one recorded before it, or a date imported again with its season's play different, starts a new timeline, and what the abandoned one observed after the new one's start is left out | mechanism (review R3-05) | Differences between two timelines are not transactions (D-020) |
| The estimator | a set of bases, each a ratio of sums of salary above the minimum (never clipped): over the deal, per win projected at signing (deals past the projection's horizon left out and counted); the first season, per win projected; the first season, per win expected if he plays (one side projected: expected wins ÷ his chance of any playing time); the first season, per win produced in it once completed (WAR on its schedule's footing) | policy (review R4-01 to R4-03, R4-07) | Read like the opening price, a spread of defensible bases. A ratio of sums does not blow up on a signing expected to produce nearly nothing. The projected bases read expected wins that include the chance he does not play at all, so for signed players the price per projected win reads high; the realized basis has no projection in it |
| The price, its band and its check | **per win produced** (owner, 2026-09-24): the realized basis's ratio of sums and its 1,000 resamples (10th to 90th percentile), resampled by winter, then by signing within each, once two winters are observed; not measured until it exists. The projected bases are the check: their median and spread with each one's sampling, and the ratio of that median to the price | policy (review R4-05; owner decision 1) | The opening's own unit, and the unit every consumer multiplies by production in the export's WAR. The check shows how far Pennant's expected wins sat from what the signed players produced (the Arizona free-agency class: $10.60M per projected win against $6.42M per win produced, 1.65). A price that moved between winters is wide, never precise. A percentile bootstrap covers less than 80% at 20 to 40 signings (about 75%; R4-09), and says so. A fixed seed |
| The fewest signings | 20 (`OPENING_PRICE_MINIMUMS.contracts`) | policy (reused) | The opening basis's minimum (B-13) |
| The opening band compared | the spread of the bases with each market basis resampled over its own contracts the same way (1,000, 10th–90th) | policy | B-13's deferred sampling component, so the two bands are compared like for like; the served opening band is unchanged |
| Adoption | the measured band narrower, in dollars, than the opening band with its sampling (an unbounded opening sampling band is wider than any bounded one; a failed resampling is unbounded, never dropped) | policy (owner Q-4; review R3-07, R4-04) | The evidence decides, no fixed count |
| Before any comparison | the measured price exists per win produced, and the priced signings number at least 5 in each third of the winter's free-agent class by expected wins | policy (review R4-01, R4-02: tightenings; owner decision 1) | A price per projected win is never the price in force (owner, 2026-09-24); a winter of cheap deals alone never sets the price. A central below the opening floor or outside its band is flagged |
| Observed arbitration salaries | scored against the band the earlier import priced, beside the bands' width (median top ÷ bottom, width ÷ salary); read in the ladder's class (lowest class of the trip, a later trip in the top class; no trip, no class); a class reading at 30 (`COST_POLICY.ladder.minimumCases`); one below the player's previous salary (as the earlier import recorded his contract) flagged, counted and named | policy (reused; review R4-08, R3-10; owner decision 3) | The ladder's own method and minimum; the cross-section stays (this winter's salaries in this import's dollars) and the band covers both. Coverage alone says little when the bands are wide. A salary below the previous one contradicts the owner-attested rule and is shown, never absorbed; one whose previous salary is not recorded is counted as not checked |
| Reserve-clause renewals | the renewal spread's method at 30 (`COST_POLICY.renewal`) | policy (reused) | One method for a renewal |
| Replacement from freely available talent | WAR per 600 opportunities, for the club that took him, in the season he joined it, of players acquired for nothing with a major-league record; 30 players; how many did not play is shown | policy (review R4-06) | Below it the export's convention stays (provisional). Shown, never applied: the price, the ladder and production stay in the export's WAR until surplus applies one level to both sides (review R3-06, R4-06) |
| Storage and reading | each import's pair with the import recorded before it is observed once and stored with the reading's method (`signings-4b.3`); the market reads the stored pairs | mechanism (review R3-03) | Recording an import reads one earlier import: flat in the number of imports (3.65 s with 29 earlier imports before, 2.43 s after, as with one) |
| Retention | full snapshots kept for the imports that bracket a winter and the latest; the others pruned at capture after the new pair is stored (one transaction, a `pruned` event); every pair and event kept | policy (owner decision 4, 2026-09-24) | About 3.2 MB an import otherwise. On R3's 30-import probe the snapshot table holds 8,229 rows (2.9 MB) against 246,870 (86.1 MB), pages in use 5.6 MB against 103.1 MB. A later method change re-reads only the pairs whose snapshots were kept; the others are read as stored, under their own method |
| Rights recorded per import | 3 seasons (this one and the two after it) | policy | A deal starting later than that is read as not established |

**The Arizona save (one import, 2026-05-16).** The import records 8,229 players (1,841 with standing, production and next
season's cost: 1,057 major-league deals, placed players on other rows, and 220 unsigned players whose production is
established; 6,388 minor-league deals or rows with no term, their terms only), about 3.2 MB in `history.db` (2.7 MB of
rows and 0.5 MB of key index). The capture takes about 2.5 s inside the import (a league-wide valuation with production);
a second capture writes nothing. No off-season is observed: the measured price says "No off-season observed yet: the
measured price needs two imports across a winter (one before its signings and one after). This save has 1 import recorded
(2026-05-16)", and the opening price stays in force: **$7.25M, band $6.57M–$9.78M, floor $4.22M–$4.33M** (unchanged).
Its bases resampled: B $7.02M–$8.03M, B2 $6.90M–$7.80M, B3 $8.59M–$11.22M, C $5.95M–$7.23M, C2 $6.28M–$7.59M, C3
$6.10M–$8.53M, so **the opening band with its sampling is $5.95M–$11.22M ($5.27M wide)**: the band a measured price must
beat. No arbitration salary, reserve-clause renewal or freely acquired player is observed yet, and each says so.

**Synthetic sequences** (`tests/playerValueCrossSave.test.ts`, 16 clubs and 8 seasons unless noted; one winter between an
import at mid-season and one a fifth into the next):

| Sequence | What was observed | Reading |
|---|---|---|
| A full off-season | 197 free-agent signings, 2 free agents re-signed by their club, 7 arbitration salaries, 2 at the minimum, 2 controlled players no club holds, 2 extensions, 9 renewals, 1 contract moved | Measured $6.37M, band $6.17M–$6.60M on 197; 7 of 7 arbitration salaries inside the band priced for them; the measured price in force (narrower than $4.40M–$6.67M) |
| A narrower measured band | 115 one-year signings at $4.0M a win (±2%) | Measured $4.00M, band $3.99M–$4.01M; in force (the opening band with its sampling $2.79M–$3.90M) |
| A wider measured band | 21 signings at $0.1M or $40M a win; every other free agent re-signed by his club | Measured band $12.72M–$25.28M ($12.56M wide) wider than the opening $5.67M–$11.40M ($5.73M wide): the opening stays and says so |
| Too few signings | 12 signings (4 clubs) | "Not measured: 12 free-agent signings observed over 1 winter, 12 priced; a measured reading rests on at least 20"; the opening stays |
| No arbitration | 12 renewals | No arbitration salary observed; "This league has no salary arbitration" |
| A reserve clause | 60 reserve-clause renewals | $0.70M–$1.75M; a reserve-clause season priced from it, unknown before |
| Freely available talent | 40 players signed at the minimum from no club | 0.13 WAR per 600 opportunities (band 0.09–0.16) on 6,012 opportunities; the measured price, now in wins above it, $5.63M on 220 signings |

The bands are sampling bands of what was observed, not calibrated intervals: nothing held out checks them, and a price
that drifts from winter to winter is pooled across them (each signing in its own winter's dollars), which the price
history shows.

**Phase 4b review (2026-09-24).** The table above was read with the estimator as first built (one basis, per projected
win; adoption on width alone), and several of its readings recovered their inputs by construction: every synthetic
market priced salary on Pennant's own expected wins (R4-10). "Measured $6.37M" on the full off-season was constructed at
$5.00M per expected next-season win; the difference is the deal's later seasons (expected wins decline under a flat
salary, +11%) and the construction's 0.3-win floor (+13%). R4's probes (`scratchpad/review4b/r4`), re-run on the review:

| Probe (constructed truth) | Before: measured, in force | After: bases, in force |
|---|---|---|
| S1: $5.00M per expected win, 199 signings, one winter | $6.27M, band $6.11M–$6.45M; adopted | over the deal $6.27M, first season $5.65M, if he plays $5.51M; realized not yet; **opening stays** (no realized reading) |
| S1 carried one more winter | n/a | realized $5.54M (band $4.87M–$6.60M); **adopted at $5.54M** (narrower than $3.76M–$6.60M) |
| S2: convex market, only players expected under 1 win sign (a 3-win player costs $7.50M a win) | $4.02M, band $3.96M–$4.08M; adopted | $4.03M projected; with the realized reading $4.12M; **opening stays**: 2, 47 and 0 signings in the class's thirds |
| S3: $5.00M per true win, Pennant over-projects by 30% | $3.85M, band $3.85M–$3.85M; adopted | $3.85M projected, $3.73M if he plays; **opening stays** (no realized reading; carried a winter, the class's lowest third is empty) |
| S5: 25 signings and a 10-season $300M deal | $6.79M, band $4.49M–$8.45M; opening stays | the deal left out of the whole-deal basis (past the horizon): $4.59M on 24; first season $4.87M; opening stays |
| S6: an economy that doubles ($4M then $8M a win) | $6.08M pooled, band $5.78M–$6.36M; adopted (winter 2 alone $7.99M) | first season $6.08M, band $3.89M–$8.02M by winter; **opening stays** (wider; coverage) |
| S7: $5.00M per win produced (salary set on what he goes on to produce) | $6.76M; adopted | projected $7.59M; carried a winter, realized **$4.97M** (band $4.93M–$5.00M); **adopted at $4.97M** |

**The owner's decisions (2026-09-24).** The price in force, once measured, is per win produced: S1 carried one more
winter is adopted at its realized $5.54M (band $4.87M–$6.60M; check $5.65M per projected win, 1.02 times), S7 at $4.97M
with band $4.93M–$5.00M (it had been $4.93M–$8.19M with the projected bases in it; check $7.59M, 1.53 times); S2 and S3
stay out on coverage (re-run of the two-winter probe on the decisions). Before the realized reading exists, the measured
price is not measured and the check is shown.

On the Arizona market (Monte Carlo, 400 draws of n signings from the 252 free-agency contracts with a 2027 projection;
the realized reading their 2025 WAR, the projected their expected 2027 wins; the free agents' salaries are $10.60M per
projected win and $6.42M per win produced): before, at 20 signings the measured price was adopted 91-93% of the time
with its band covering the truth 74-76%; after, with the realized reading, it is adopted 2% of the time (5% at 80, 18%
at 150), its band covers the per-realized-win truth 88% (93% at 80 and 150) and its central errs by -24% to +32% at the
10th and 90th percentiles, centred (-8% to +9% at 150). With projected bases alone it is never compared. The low adoption
is the evidence speaking: Pennant's projection and what the signings produced disagree by 65% on this market, so the
measured band holds both until the owner rules which one the price should be read in (he ruled on 2026-09-24: per win produced, above).

## 10. Player Value's neutral surplus and the retention margin (phase 5a)

The surplus (PLAYER_VALUE.md 5.1, `server/playerValueSurplus.ts`) fits nothing and measures nothing of its own: it combines
production (fitted per save, D-053), the cost path (measured per import) and the price of a win in force (opening, or
measured across imports). Its rules are policy (`SURPLUS_POLICY`, stamped `SURPLUS_POLICY_CALIBRATION`), chosen and stated:

| What | Value | Stamp | Why |
|---|---|---|---|
| The discount rate | 5% a season; a season *s* seasons out weighs 1/1.05^*s*, this season's remaining part 1 | policy (owner, 2026-09-24) | A time preference. No backtest can call a discount rate optimal (Q-3) |
| The price of a win in later seasons | the price in force, held flat, its whole band in every season | policy (owner, 2026-09-24) | No salary inflation is assumed unless the save's own measured price history shows drift |
| The rest of this season | production's rest-of-season band, and the share of the league's games still to play of his salary and a replacement's minimum | policy | Banked wins and paid salary are sunk for the forward view; how OOTP pays salary within a season is not exported |
| Money owed whatever the club does | a major-league contract's salary for each season it covers | policy | It cancels in the retention margin; a minor-league deal's is not established |
| An option's buyout the export does not populate | nothing to the option's salary | policy | A buyout above the salary would make declining dearer than exercising |
| Production value | the minimum plus wins × the price | mechanism | The price is salary above the minimum per win above the export's replacement level |

On the Arizona import (2026-05-16): 1,048 players have a known sum; contract surplus central median $1.0M (10th to 90th
percentile −$17.7M to $32.7M); 76 major-league deals read below −$20M in contract surplus with a positive retention
margin. Re-running: `npm run value:report` is unchanged; the regression sweep (`sweep-c.mts`, supervisor's scratch) holds
the phase's 31 checks.

## 11. Player Value's philosophy lens and the club's value of a win (phase 5b)

Neither fits anything. The lens (PLAYER_VALUE.md 6.1, `server/playerValueLens.ts`) is policy: how far a stated preference
leans "our view", shown with every lean and the neutral figure it started from (`LENS_POLICY`, stamped
`LENS_POLICY_CALIBRATION`). The club's value of a win (4.5, `server/playerValueWinValue.ts`) reads the deadline read's odds
model, which is provisional and not fitted on the save (`WIN_CURVE_CALIBRATION`).

| What | Value | Stamp | Why |
|---|---|---|---|
| Where a dimension leans | outside 40–60, linearly to its limit at 0 or 100 | policy | D-036's lean thresholds: a middling preference is not a lean |
| The competitive window's discount | 0% (building) to 15% (win-now) a season, against the neutral 5% | policy | A time preference stated by the organization (Q-3); this season's part weighs 1 |
| Risk tolerance | up to half way from each range's centre to its low edge; never above the centre | policy | Part 6: the band may be read nearer its low edge or its centre, never beyond |
| Team control, cost efficiency, payroll flexibility | ±20% on their part | policy | A lean, not a verdict; payroll flexibility in the contract view only |
| An aging season | 33 or older (words only) | policy | Moves no number |
| The win curve | three wins fewer to five more | policy | A display choice |
| The odds model | Pythagorean talent from this season's runs, a .520 rival, a normal difference over the games left | provisional | The deadline read's model; not fitted on the save. In playoff odds only (Q-6) |

On the Arizona import (2026-05-16) the owner's configured philosophy leans on nothing for any player (every dimension 50,
the default policies). One more win moves Arizona's odds by 3.9 points (75% now, with the leader's wild-card route); the tightest races about 5.1 to 5.2; the
clubs far out under 0.1. The regression sweep holds the phase's 24 checks.

## 12. The roster review's yardsticks, per save (D-053, cycle 1, 2026-09-24)

MLB Operations' roster review judges each holder against three groups of numbers. Since this cycle each group is the save's own
once it has passed its checks, and the built-in values are the provisional fallback prior (`ROSTER_REVIEW_PRIOR` in
`server/mlbCalibrationFit.ts`), never presented as a save's calibration. The plumbing is subsystem-neutral and serves cycles 2 to 4
(`saveIdentity.ts`, `saveCalibrationStore.ts`, `saveCalibration.ts`; ARCHITECTURE "Per-save calibration").

**Owner decisions, 2026-09-24:** the role standards are re-measured from the current export at each import; each lens (tools,
results) has its own line on its own scale; relievers are checked against the league's history as one pool.

| Group | What is fitted | Policy (stays in code, `ROSTER_REVIEW_FIT_POLICY`) | Fallback prior |
|---|---|---|---|
| Role standards (`roleStandards.ts`) | each role's typical estimate and a hitter position's typical bat; the pooled 10th/5th percentile gaps by group; each lens's own typical and gap | FLOOR_QUANTILE 0.10 and DEEP_QUANTILE 0.05 (unchanged); 20 clubs; 15 games per club (median club) first; a role joins its group's gap with 10 holders; shrinkage 10 holders (a role), 30 (a gap); club split 400 fixed-seed halvings; tolerance 5 points (floor), 4 (deep); history check: at most 8 origins t→t+1 over completed full seasons (90% of a schedule), 100 held-out holders per group | The Arizona import's measurement (2026-05-16) |
| Aging (`roleReview.ts` `AGING_CURVE`) | the expected annual change by age, hitters (league-relative wOBA) and pitchers (league-relative FIP), ages 20–42 | pairs of consecutive full seasons with 300+ PA/BF in both; the last 20 completed seasons; ages 22–40 fitted; shrinkage 150 pairs per age; 1,000 pairs per kind; rolling origin (at most 8, from the window's start + 5); bands 22–25 … 38+ scored with 50+ pairs; a band fails beyond 3 wOBA points (hitters) or 0.08 runs (pitchers) AND 3 standard errors clustered by player; must beat "no aging". `concernAge` (34) is policy | The piecewise rows (harness section 5, 2000–2025) |
| Glove weights (`roleReview.ts` `DEFENSE_WEIGHT`) | each position's share of a hitter's estimate that is glove; DH 0 by definition | fielding results only: 300 innings and 300 PA; 20 fielders per position; shrinkage 60 pairs; the fitted weight's next-season rank correlation may trail the built-in weight's by 0.02. GLOVE_MATTERS stays policy | Run-1 figures (section 3) |

**The methods.**

- *Standards (`standards-1`).* At each import the production review is run on every club of the league (the same ports as the
  page; the league's own clubs, all-star sides excluded) and each holder's role, working estimate, bat, tools lens and results lens
  are taken. Each role's median and each group's pooled 10th and 5th percentile deviation are measured on the estimate scale, and
  each lens's median and pooled 10th percentile deviation on its own scale; each is shrunk toward the prior by its holders.
  A lens's line is the role's lens median plus the group's pooled lens gap: roughly, not exactly, the lowest tenth of that role's
  holders on that lens (the gap is pooled across the group's roles, as the estimate's is). Two checks, both required, each scoring
  the lines **as they would be served** (shrunk toward the prior with the training half's, or season's, own holders):
  (1) *club split*: the standards measured on half the clubs, 400 times, must put 10% ± 5 of the other half's holders under the
  floor per group, on the estimate scale and on each lens, and 5% ± 4 under the deep line on the estimate scale only (a lens has no
  deep line); (2) *history*: the same method run on the league's own past seasons on the results lens (the one lens the history
  holds: regulars by starts at a position against that season's own schedule, rotations, relievers as one pool, ranked as the review
  ranks results at a season's end) must put 10% ± 5 (5% ± 4) of the next season's holders under a line set on this one. A past
  season whose schedule is not established is left out with its reason. **What the history check proves is modest:** past holders
  are ranked within their own season, so wherever the league's holders are steady a line from one season nearly always leaves about
  a tenth of the next under it. In practice it is an "enough steady past seasons" gate, not strong evidence that the served
  standards are right; the club split is the check that bears on the served values. A league with too few past seasons to check
  fails (2) and keeps the starting values, and says so. The key is the export's game date: a re-import at the same game date after
  roster moves is not re-measured (accepted; the next game date is).
- *Aging (`aging-1`; since cycle 2 `aging-3`, section 13).* The delta method of section 5, per completed season: a weighted mean change per age over the fit ages
  (22–40), a weighted quadratic in age, each age shrunk toward the prior by its pairs, then made monotone over the fit ages; ages
  20–21 and 41–42 hold the end values (they are never pooled with the prior's zeros). The window is the last 20 completed seasons
  (a pair's first season from the window's first). Rolling-origin backtest: each origin fitted only on pairs it could have seen,
  scored on the pair (t, t+1), **twice**: the curve as served (shrunk toward the prior) and the curve fitted without the prior
  ("unshrunk"). Both must pass the band and "no aging" checks. The prior was fitted on the Arizona import's 2000–2025 history, so
  **on that league the shrunk check is not out-of-sample** (the prior has seen the held-out seasons); the unshrunk check is, and the
  record says so. A backtest in which no age band has enough held-out pairs fails ("not enough seasons").
- *Glove weights (`defense-1`).* On consecutive completed seasons whose fielding rows carry zone-rating runs (detected from the
  data): the repeatable spread of fielding runs per 1,300 innings (year-to-year covariance) against the repeatable spread of
  batting runs per 600 PA, weight = sd(glove) / (sd(glove) + sd(bat)). Batting runs use each season's own wOBA scale (derived from its totals since cycle 2, section 13.5; 1.2 only where the totals cannot give one), which sets the glove-to-bat ratio. Checked on the next
  season: among a position's regulars, (1 − w) × bat percentile + w × glove percentile (both from results) is rank-correlated with
  what they produced the season after. Results only on both sides: no rating is read.

**Not built, against the Stage A design** (recorded so nobody assumes them): the standards' third check (the previous import's
standards scored on the current holders once two measurements exist) is not implemented and not recorded as "not yet measured";
the glove weights' paired-bootstrap "not significantly worse" condition is not implemented (only the tolerance on the rank
correlation); the results-lens history check is re-run at every standards measurement (about 15 s in the worker), not cached per
completed season. Nothing prunes `save_calibration_fits`: each import at a new game date adds a standards row per top league
(including early-season rows that measured nothing); cycles 2 to 4 should add retention.

**The record** (`CalibrationRecord`, `save_calibration_fits.record_json`): basis (completed season or game date), window and
sample, every check with its expected and observed values (and the prior's, where it can be scored), the share still the prior
(overall and by part), the gate's verdict and reason, the prior's source, and notes on what could not be measured.

**Re-running.** Automatic after an import (in `calibrationRefitWorker.ts`, after Player Value's refit; never for an import already superseded, and skipped with a logged reason when no worker thread can start, so it never runs on the server's event loop). A developer can force it:

```bash
OOTP_FO_DATA_DIR=<dir with league.db and a scratch history.db> OOTP_FO_DB_READONLY=1 npm run calibrate roster-review            # fit and print, write nothing
... roster-review --refit                                   # record the fits in history.db (a failing refit never replaces an adopted one)
OOTP_FO_DATA_DIR=<dir> OOTP_FO_DB_READONLY=1 npm run review:calibration-report   # before and after, for the organization and league-wide
```

### 12.1 The run on the Arizona import (2026-05-16, through 2025)

Re-run after the independent review's fixes (checks score the lines as served; the aging window is exactly 20 seasons; the unshrunk
aging check; the league's own schedules). The headline did not change.

- **Standards: adopted.** Measured from 30 clubs (e.g. first base 77.0 against 77 built-in, 28 holders, weight 0.74; starters 53.0,
  150 holders, 0.94); gaps −20.2/−25.7 (hitters), −22.3/−25.0 (starters), −18.2/−21.2 (relievers), against −20/−26, −22/−25, −18/−21.
  The same snapshot the built-in values were measured on, so they agree within half a point. Share still the starting values 0.15.
  Club split on the lines as served: hitters 11.2% / 5.4%, starters 11.4% / 5.2%, relievers 11.8% / 6.3% (tools lens 13.5 / 8.7 /
  11.9%; results lens 12.6 / 12.1 / 13.0%). History, origins 2015→16 … 2024→25 (8; 2020 left out, a short season): hitters 12.1% /
  7.1% (n 1,677), starters 11.6% / 6.8% (n 1,200), relievers 11.5% / 6.7% (n 2,166). Each lens's own gap is far wider than the
  estimate's: tools −33.1 (hitters), −16.6 (starters), −12.4 (relievers); results −34.9, −33.8, −30.4.
- **Aging: adopted** under cycle 1's rule; under cycle 2's "clearly better" rule (section 13.4) the starting curve held up and serves. 5,594 pairs of back-to-back seasons (2006–2025). Hitters −2.4 wOBA points a year at 26 (built-in −3.0),
  −6.1 at 30 (−6.5), −8.9 at 34 (−9.5); pitchers +0.10 FIP at 28 (+0.12), +0.14 at 34 (+0.12), +0.20 at 35 (+0.20). Share still the
  starting curve 0.44. Backtest on 2016–2024 (1,410 hitter and 851 pitcher held-out pairs), as served and unshrunk: every scored band
  unbiased (largest: hitters 34–37 −2.2 points shrunk, −2.8 unshrunk, se 2.6; pitchers within 0.03 runs, se 0.035 to 0.07); both
  beat "no aging". On this league the shrunk check is not out-of-sample (the starting curve was fitted on these seasons); the
  unshrunk check is, and passes.
- **Glove weights: not fitted.** No two seasons in a row with zone rating (only 2026, which is not complete; historical WAR carries
  no fielding runs). The built-in weights serve, and the page says why.
- **Effect on the roster review** (`npm run review:calibration-report`): the lens change alone (each lens against its own line)
  removes 6 of the league's 21 flags (4 moderate, 2 strong; e.g. regulars whose results were ordinary for their position) and moves
  8 more between kinds of watch; Arizona's one flag is unchanged. Everything else (the measured standards and the aging curve)
  moves findings only at the margin (1 flag appears at a line that moved by a fraction of a point, 6 watches change) and changes the
  stated size of the decline in 31 age explanations league-wide (2 on Arizona) by about a point; while the starting curve serves,
  the explanation says "players his age usually lose about ...", and "in this league's history" only once the save's own curve is in
  force.


## 13. How much recent seasons count, the "clearly better" rule, and the wOBA scale (D-053, cycle 2, 2026-09-25)

**Owner decision, 2026-09-25:** a save's own fitted tuning value replaces the starting value only if it is CLEARLY better on held-out
seasons; otherwise the starting value stays, and the page says it was checked on this league and held up. The owner's focus was
whether the system that decides this is robust enough, so the detector is the centrepiece and its error rates are measured
(13.3). A MEASUREMENT of the league as it stands (the role standards) has no rival value set and keeps its measure-and-check rule
(section 12).

### 13.1 The detector (`server/calibrationDetector.ts`, `detector-3`, policy `DETECTOR_POLICY`)

The caller hands it paired held-out cases: each held-out player-season (or aging pair) scored under the save's values and under
the starting values. The save's values are **clearly better** when all three hold:

1. **Enough:** at least 4 held-out seasons, each with at least 50 cases.
2. **Worth it, at a confidence:** the LOWER one-sided 97.5% confidence bound of the gain is at least 1% of the starting values'
   error. The gain is measured on two units of evidence, and the smaller bound counts:
   - *Across players:* the pooled difference, with standard errors clustered by player, because a player's seasons are one piece of
     evidence.
   - *Across seasons:* each held-out season's own relative gain, with Student's t on seasons − 1 degrees of freedom. Everything a
     season shares (how noisy it was, how fast talent moved, a break between imported and simulated history) moves all its players
     together. The player-clustered error alone was overconfident when seasons differ (the independent review's finding 1).

   A very large sample therefore cannot adopt a trivially small gain, and a gain near the minimum is not adopted on a lucky estimate
   (finding 2). Both z and t are also reported.
3. **Consistent:** the save's values have the lower loss in at least two-thirds of the held-out seasons, and in at least 3.

- **Confirmed.** The save's values first replace the starting ones only when clearly better at **two consecutive completed-season
  refits**. The count is carried only from the adopted verdict of the season just before. A refit that is not clearly better, or that
  fails and leaves an older verdict in force, starts the count again.
  - The decision carries the confirmation count.
  - Until confirmed, the page says: "this league's own did better at the last check and must do so once more before they are
    used".
- **No selection optimism.** The caller chooses every free parameter (the grid point) inside each rolling origin, on seasons up to
  it only, and scores that choice on the next season. A season never takes part in choosing what it judges (pinned by a test that
  scrambles a held-out season and finds the choice unchanged).
- **Unshrunk and as served, both.** Unshrunk is out of sample on every league. As served (shrunk toward the starting values) is not
  out of sample on the Arizona import, where the starting values were fitted on these seasons, and it can be flattered either way
  there. What keeps adoption honest is that it also needs the unshrunk comparison, which owes nothing to the starting values.
- **Hysteresis, asymmetric** (supervisor's call after the re-review: adopting is hard, giving up is easy).
  - Once the save's values serve, a later refit returns to the starting values when THEY are better than the save's values as
    served. It uses the same two-bound test and consistency, with the minimum at **0**: the lower bound of the starting values' gain
    above zero, not the 1% adoption bar.
  - Values that stopped helping (after a break between imported real seasons and the game's own engine, say) give way as soon as
    the starting values are surely better at all.
  - The record carries the previous state, the confirmation count and the rule applied.
- **Fails closed.** A comparison with no measured spread is not evidence (no infinite z).

- **Method versions.** The rule is `detector-3`; the fits are `results-2` and `aging-3`, so every save refits once under it.

**The target** (supervisor's call, 2026-09-25): over a save's LIFETIME (sequential yearly refits of a growing league, from 10 to 22
seasons of history, with hysteresis), the rate of adopting the save's values when their TRUE gain is under the 1% practical minimum
must be at most 5%. This holds at the exact null and at the least-favourable nulls (a true excess of the starting values of 0.5% and
0.9%), stationary and with season-to-season heterogeneity (a season's noise ±25%, its drift ±0.3). Power is secondary, and the
owner accepts losing it for robustness.

**Tuned by the simulation, not intuition.** The confidence level, the minimum and the confirmations were chosen on lifetimes of 150
leagues each (hitters at a true 1.0% excess, stationary and heterogeneous; relievers at 1.0% heterogeneous; power at 2% and 3%):

| Level, minimum, refits in a row | Hitters 1.0% | Hitters 1.0%, seasons differ | Relievers 1.0%, seasons differ | Power, hitters 2% / 3% |
|---|---|---|---|---|
| 5%, 1%, 1 | 12.0% | 9.3% | 14.7% | 81% / 99% |
| 2.5%, 1%, 1 | 6.0% | 4.0% | 5.3% | 61% / 97% |
| 1%, 1%, 1 | 0.7% | 0.7% | 0.7% | 36% / 84% |
| **2.5%, 1%, 2 (chosen)** | **0.0%** | **0.7%** | **2.0%** | **43% / 92%** |
| 2.5%, 0.5%, 1 | 34.7% | 15.3% | — | — |

The chosen rule meets the target with a margin and keeps more power than the 1%-level rule that also meets it.

### 13.2 The results lens's season weights and stabilization (`server/mlbResultsFit.ts`, `results-2`, trigger: a new completed season)

- **Cases.** Every player-season in the last 20 completed full seasons (a season under 90% of its schedule is not a target; its
  lines still count as a prior season, as in the review), predicted from his three seasons before it by the production arithmetic
  (`weightedBatting` + `reliability`). Hitters predict park-adjusted wOBA relative to the league (250 PA or more). Starters (350 BF)
  and relievers (150 BF) predict park-adjusted ERA relative to the league from `PITCHER_RESULTS_MIX` of peripherals and runs; a
  pitcher's kind is read from his prior seasons and must hold in the target. Both sides are centred on the kind's own mean that
  season, because the review ranks a player among his kind. The fit scores raw centred values, while the review serves percentiles
  (and mixes pitchers' peripherals and runs on the percentile scale). Requiring a pitcher's kind to hold in the target also selects
  on the outcome. Both affect the candidate and the rival alike, so they do not bias the verdict, but the fitted K is not exactly the
  served lens's K.
- **The fit.** A grid (policy): the season before at 0.1–1 of this one, the one before that at 0–1 and never above it, and K from 100
  to 3,000. It chooses the least opportunity-weighted squared error, and is shrunk toward the starting values by n/(n+500) training
  cases.
- **The backtest.** Rolling origins (at most 8, from the window's start + 5), nested, judged by the detector per kind. Judging needs
  at least 10 completed full seasons of targets (4 origins).
  - Too few seasons to judge, for any of the three kinds, is not a verdict: nothing is recorded as adopted, and the values in force
    stay.
  - One verdict per refit: a thin kind (relievers in a small fictional league, say) holds the others back. The record's notes name
    the kind that blocked.
- **Baserunning and defensive stabilization** fit K only. Each is judged against a rival with the SAME fixed weights at the starting
  K, so the comparison is of K alone (`tests/mlbResultsFit.test.ts`).
  - Baserunning is weighted at each origin by the hitters' weights as they would have served then. That is the save's own chosen
    inside that origin if the detector, run on the hitters' held-out seasons before it, finds them clearly better; else the
    starting ones. It never uses the final weights or the final verdict, which saw the held-out seasons.
  - Defense is weighted evenly, as `defenseResult` sums a fielder's seasons.
  - Both are judged only on seasons whose export carries UBR or zone rating, and need **10** such completed seasons (the same
    count).
  - On this save UBR and zone rating exist only for 2026, so both are inactive, and the record says so.
- **Reported, not gated:** the error against assuming every player is his kind's average, and the calibration slope (next season on
  the prediction).
- **Served** through `rosterReviewCalibration(...).results` into every holder read. The evidence's stabilization fields are
  required, so a lens builder cannot silently fall back to the starting values. It reaches the review, responses, plans,
  scenarios, the report and the platoon record weight, through one set of ports per request (`tests/resultsParamsInForce.test.ts`).
  The standards measured in the same refit are measured under the results verdict just made (the results component is registered
  first).

### 13.3 The detector's measured error rates (`npm run calibrate detector`, `detector-3`, 2026-09-25)

**The simulated leagues.** They are sized like the Arizona import's majors: about 300 hitter, 120 starter and 190 reliever target
seasons a year, with careers, part-timers and turnover.
- A player's true level is a permanent part plus a part that drifts from season to season (first order). A season's result is his
  level plus noise that shrinks with his opportunities.
- "Seasons differ" adds season-to-season heterogeneity: a season's noise is scaled by exp(0.25 × a normal draw), and its drift
  carry-over varies by ±0.3.
- Each null's talent spread is set so that the starting values' TRUE excess error (measured on a very large league over 40 seasons,
  two seeds) is the stated amount.
- **A lifetime** is one league refitted after every completed season from 10 to 22 seasons of history (the refit's 20-season
  window), with hysteresis and confirmation exactly as the refit carries them.
- **A break** has the owner's save shape: imported real-history seasons, then the game's own engine. The seasons before the 11th
  target season are noisier (×1.4, or ×1.3 with seasons differing), and the league is as stated from then on. Its true excess is
  that of the new regime.
- Runs: 400 leagues for a null and 200 for a power scenario. The worst standard error is about 1%.

**False adoption over a save's lifetime** (the target: at most 5% under every null):

| Kind and null | True excess of the starting values | Stationary | Seasons differ |
|---|---|---|---|
| Hitters: the starting values exactly right | 0.0% / 0.1% | 0.0% | 0.0% |
| Hitters: about 0.5% worse | 0.5% | 0.0% | 0.0% |
| Hitters: about 0.9% worse | 0.9% | 0.5% | **3.0%** |
| Starters: exactly right / about 0.9% worse | 0.1% / 0.9% | — | 0.0% / 1.3% |
| Relievers: exactly right / about 1.0% worse | 0.0% / 1.0% | — | 0.0% / 2.3% |

At a single refit, a null was found clearly better at most 1.5% of the time (relievers, 20 seasons). Under every null above, what is
adopted is still serving at 22 seasons.

**After a break** (hitters; 400 leagues each):

| Scenario | True excess in the new regime | Ever adopted | Still serving the save's values at 22 seasons | What they serve then costs in the new regime |
|---|---|---|---|---|
| Noisier before the break (×1.4); the starting values exactly right after it | 0.0% | 5.3% | **2.3%** | 0.2% to 0.9% more error (median 0.7%) |
| Noisier before the break (×1.3), seasons differ; the starting values about 0.9% worse after it | 0.9% | 10.3% | 10.3% | −1.0% to +0.4% (median −0.4%: better than the starting values) |

- **First row (the review's R1 case).** Adoptions come at the break, from the old regime's seasons: at 11 to 12 seasons, while the
  held-out seasons are still pre-break.
  - Under `detector-2` they never went back. Under the asymmetric return, more than half of them do (5.3% down to 2.3%).
  - What is still served at the end is refitted on a window mostly of the new regime. It costs less than the 1% practical minimum.
- **Second row.** The adoption is not stale: what serves at the end is, on median, better than the starting values in the league as
  it now plays. It still counts as adoption under a null, and at 10.3% it is above the 5% target, which covers only the leagues
  without a break.
  - Adoptions come early (median 13 seasons), when the pre-break seasons made the gain look larger.
  - This is reported, not tuned away: tightening the rule further would cost power everywhere else.

**Power over a lifetime** (the save's values ever adopted by 22 seasons), with the median season of first adoption:

| Scenario | True excess | Lifetime adoption | Median first adopted | Clearly better at one refit (12 / 16 / 20 seasons) |
|---|---|---|---|---|
| Hitters: a fictional-league-sized shift (best 5/3/2, K 1,500) | 5.1% | 100% | 12 seasons | 91% / 98% / 98% |
| Hitters: the same, seasons differ | 5.7% | 92.5% | 13 | 48% / 71% / 71% |
| Hitters: recent seasons count far more (5/1.5/1, K 1,000) | 4.4% | 100% | 12 | 74% / 94% / 92% |
| Hitters: results much noisier (K 1,250) | 3.1% | 92.5% | 13 | 49% / 66% / 74% |
| Hitters: results much steadier (K 300) | 2.1% | 38.5% | 16 | 8% / 18% / 19% |
| Hitters: results noisier (K 1,000) | 1.9% | 48.0% | 16 | 13% / 27% / 27% |
| Hitters: the same, seasons differ | 2.4% | 29.5% | 16 | 6% / 11% / 17% |
| Starters: a fictional-league-sized shift (5/2/1, K 2,000) | 2.1% | 26.0% | 17 | 6% / 13% / 14% |
| Relievers: a fictional-league-sized shift (5/2.5/1, K 1,500) | 1.3% | 6.5% | 18 | 2% / 1% / 4% |

**A wrong return** (once the save's values serve, a refit sends them back although they are right): 0.0% in every power scenario,
under the asymmetric return too.

**Reading the rates.**
- **The target is met with a margin.** The worst lifetime false adoption is 3.0% (hitters with a true 0.9% excess, seasons
  differing). It is 0.0% at every exact null. After a break, see the table above.
- **Power is where it drops.**
  - A shift that costs 4% to 6% of prediction error is adopted in 92% to 100% of lifetimes, typically by 12 to 14 seasons.
  - At 2% to 3% it is adopted in 27% to 92% of lifetimes, typically at 13 to 16 seasons.
  - Pitchers' fictional-league shifts cost only 1.3% to 2.1% (their results are noisier), and are adopted in 10% to 30% of
    lifetimes.
  - This is the trade the owner chose: a difference that costs about 2% of error or less is, more often than not, left at the
    starting values.
- **Seasons needed.** A decision needs 10 seasons of targets (4 held-out seasons), and confirmation adds a refit, so the earliest
  adoption is at 11 seasons.
- **Not simulated:**
  - the aging curve's own rates (same rule, different data; ROADMAP);
  - leagues much smaller than the Arizona import. A thin league has wider bounds, so it adopts less, not more.

### 13.4 The run on the Arizona import (through 2025)

- **Season weights and stabilization: the starting values held up** (re-run under `detector-3`: the lower bounds of the gain are
  −0.52% to −0.21% as served, far from the 1% minimum).
  - Fitted: hitters 5/3.5/3 K 500, starters 5/3.5/1 K 600, relievers 5/3/2.5 K 400. The starting values are 5/3/3 K 500, 5/3/1 K 700
    and 5/3/2 K 500.
  - Held out (8 seasons, 2016→17 … 2024→25; 2,391, 947 and 1,552 player-seasons):
    - hitters: the save's own had 0.17% MORE error (z +0.81, better in 4 of 8 seasons);
    - starters: 0.20% less (z −0.79, 5 of 8);
    - relievers: 0.33% less (z −1.42, 5 of 8).
  - None is clearly better, as served or unshrunk, so the starting values serve, labelled "checked on this league's seasons and held
    up".
  - Had the league's own values served, 21 reads league-wide would have moved on noise: 2 strong flags appear and 3 disappear
    (`npm run review:calibration-report` section 7b).
- **Aging: the starting curve held up.**
  - Hitters: the save's curve had 0.13% more error as served (z +1.11, better in 3 of 7 seasons). Pitchers: 0.00% (z 0.02).
  - Cycle 1 served the league's own curve here. Now the starting curve serves, and no flag changes.
  - 78 age explanations league-wide change from "in this league's history hitters his age have lost about 9 points" to "hitters his
    age usually lose about 10 points". 31 of them change the stated size by about a point, 2 of those on Arizona.
- **Reported, not gated:**
  - Relievers' next-season runs follow the prediction with a slope of 0.65 (0.74 under the starting values). A reliever predicted a
    run better turned out about two thirds of a run better: the record is trusted too much.
  - No weight or K fixes it: the mix, centring and recency were all tried in Stage A.
  - It is a model-form question for `PITCHER_RESULTS_MIX` and the bullpen roles (ROADMAP finding). Supervisor's call: record it, do
    not gate on it.
- **Refit time in the worker:** results 2.3 s, standards 6.6 s, aging 1.0 s.

### 13.5 The run environment: the wOBA scale and a caught stealing (`server/stats.ts`, supervisor's call: app-wide, one source)

- **The derivation.** `leagueBaseline(league, year, level)` derives each league-season's wOBA scale from its own totals: BaseRuns
  linear weights, with the formula's multiplier set to reproduce the league's runs. An out is valued relative to average by
  subtracting the league's runs per out, counting batting outs as AB − H + SF + SH + CS + GDP. The scale is the fixed-weight wOBA
  numerator over the run-value numerator.
- **Where it is read.** wRC+ (roster and stats tables, the team form read, league leaders, the Lineup page, trade screens) and cycle
  1's glove-weight fit read it. Neither holds a literal any longer.
- **A caught stealing** is −(2 × runs per out + 0.075), the wSB form. A stolen base stays +0.2, the convention's constant
  (provisional: deriving it needs play-by-play).
- **The fallback.** 1.2 and −0.4 serve, labelled, where the totals cannot give a value:
  - SF, CS, GDP, IBB, HBP or SB is unrecorded (a zero league total is unknown, never zero);
  - there are fewer than 10,000 PA (policy);
  - the formula does not fit.
- **Validation (Stage A).**
  - On MLB 2025 the derived run values above an out, times 1.207, are .70/.70/.88/1.24/1.59/2.02 against the fixed
    .69/.72/.88/1.25/1.58/2.03.
  - Club runs follow them with a slope of 0.84 over club seasons 2005–2025.
- **On this save:**
  - MLB 2026: 1.209 (2025: 1.207). wRC+ moves by at most 1.
  - The minors range from 1.16 to 1.26 in 2026 (their 2025 real-history seasons: 1.01 to 1.17; the simulated 2026 minors score
    fewer runs per PA). wRC+ moves by up to 5 points, 0.1 to 1.5 on average by league.
  - 5 form verdicts change league-wide, none on Arizona's clubs.
  - One level-4 league has fewer than 10,000 PA so far in 2026, so the fallback serves there, labelled.
  - Minor League Operations' own results lens ranks wOBA within the league and does not change.

### 13.6 The rest of the results lens

- **Tools information** (`TOOLS_INFORMATION`): deferred to cycle 4 with the tools model it describes. The save has one rating
  snapshot, and a same-time fit is contaminated.
- **The park share** (`PARK_WOBA_SHARE`): stays provisional. Club runs give an elasticity of 1.92 ± 0.03 (a share of 0.52), but the
  park factor it multiplies is today's park ratings applied to every season. Minor League Operations shares the value.
- **The peer-population minimums** (`POPULATION_MINIMUM`, `DEFENSE_POPULATION_MINIMUM`): policy.

## 14. Platoon and the bullpen, per save (D-053, cycle 3, 2026-09-25)

Every decision below is the **supervisor's call, pending owner review** (the owner was away and authorized best judgment). The
Stage A investigation behind them is on this save (league 203, through 2025, game date 2026-5-16).

| Number | Was | Now | Why |
|---|---|---|---|
| `PLATOON_SHRINK_K` (5,000) | calibrated (run 1) | Around the league norm (his platoon ratings not visible): **fitted per save** (`platoon-1`), served only where clearly better. Around his ratings: the provisional starting value (`PLATOON_PRIOR.shrinkAroundRatings`) | A hitter's future split can be predicted from his past one on held-out seasons (batting splits by hand exist in every season), but only with the league norm as the prior. Around his ratings the right K is larger (a better prior leaves less for his record to find), and whether ratings forecast splits cannot be checked on a save whose one rating snapshot is dated at its own export (cycle 4) |
| `RATING_PRIOR_WEIGHT` (1.0) | calibrated (run 1) | Provisional starting value (`PLATOON_PRIOR.ratingWeight`), deferred to cycle 4 | Same-time ratings against past splits: slopes 0.43 ± .14 (2006–10), 0.67 ± .13, 0.64 ± .16, 0.83 ± .19 (2021–25); the error is flat from 0.5 to 1.0. Contaminated (OOTP formed the ratings from those results): evidence, not a fit |
| `DEFAULT_LEFT_SHARE` (0.3) | provisional | **Deleted** | `leaguePlatoon` already derives each batting hand's share from the league's own splits (R .323, L .200, S .284, 2022–2026). The constant was unreachable from production. An unknown share now states no cost (never 0.3) |
| `MIN_SPLIT_PA`, `PROBLEM_EXCESS`, `COMPLEMENT_MARGIN` | "provisional (policy)" | **Policy**, rationale corrected | The margins are costs worth raising, not rarities. The stamps claimed "1.4 sd" and "3 sd" of run 1's spread (.0087); the current league measures .0075. A margin in standard deviations would flag the same share of hitters in every league, whatever it cost them |
| `LEVERAGE` (closer 1.6 with a save, high 1.3, low 0.9) | calibrated | **Policy on the league's own leverage scale**, with a unit check (`LEVERAGE_UNIT_TOLERANCE` 5%, policy) | Leverage is already the league's own unit (1.0 is an average plate appearance there). The cut-offs are rescaled only when the league's mean leverage per batter faced is off 1.0 by more than 5%. This save: 1.0225, so they serve as written; a 2% rescale would have moved 12 tiers on nothing but the season's wobble. A quantile form was rejected: it would always call a third of relievers high-leverage, and its club split spans 24–40% |
| `LONG_INNINGS` (1.6) | "provisional (policy)" | Split: `MULTI_INNING` 1.6 (**policy**: what "throws multiple innings" means, in the pen-wide finding) and the **long-man line** (a **measurement** of the league, `LONG_LINE_PRIOR` 1.6 the provisional fallback) | The game works this save's relievers about a quarter longer than the real seasons it imported (1.28 innings a relief appearance in 2026, in both halves of the season, against 1.04 in 2025). 1.6 sat at the 84th–88th percentile of relievers in 2019–2025 and at the 78th now |
| `CREDIBLE_HIGH_LEVERAGE`, `MIN_APPEARANCES`, `DEPLOYMENT_GAP`, `CROWDED`, `MIN_READ_ARMS` | policy / provisional (policy) | **Policy** | On the percentile scale or counts of pen construction. Evidence for `MIN_APPEARANCES`: from the game logs, a reliever's leverage over his first 8 appearances has split-half reliability 0.65, and only 49% of relievers read the same band (high, middle, low) from both halves (56% at 16) |

### 14.1 How much a hitter's own split counts (`server/mlbPlatoonFit.ts`, `platoon-1`, trigger: a new completed season)

- **Cases.** Every hitter-season in the last 20 completed full seasons (a season under 90% of its schedule is not a target; its lines
  still count as a season before one). His split (wOBA against right-handers minus against left-handers) over his five seasons before
  the target, with at least `MIN_SPLIT_PA` against each hand (below it production does not read his split, so K cannot matter),
  predicts the target season's split (30 PA or more against each hand), weighted by its effective PA (l·r/(l+r)). The prior is the
  league's split for his hand over the same five seasons, as production pools it. Objective lines only; no rating is read.
- **The fit.** K on a grid (policy: 250 to 50,000; the top means "his own split barely moves the read"), least weighted squared
  error; served shrunk toward the starting 5,000 by n/(n+1,000) training cases on the log scale.
- **The backtest and the verdict.** Rolling origins (at most 8, from the window's start + 5), nested: at each origin K is chosen on
  targets up to it and scored on the next season, paired with the starting K on the same hitter-seasons, unshrunk and as served.
  Cycle 2's detector decides, **with its policy unchanged** (`detector-3`: the lower bound of the gain at least 1% across players and
  across seasons, consistent, two consecutive refits, the easy return). Reported, not gated: the error of the league norm alone.
- **Served** through `rosterReviewCalibration(...).platoon` into every platoon read (`PlatoonInput.platoon` is required): the save's
  K replaces `shrinkAroundLeague` only; `shrinkAroundRatings` and `ratingWeight` stay the starting values. A read that uses the
  save's K says "checked on this league's past seasons"; otherwise it says what a hitter's own split usually says, and never claims
  the league's history.
- **Does the 1% minimum suit platoon K?** Yes: the minimum was kept (`npm run calibrate platoon-detector`). A split's noise dwarfs the
  skill, so K moves the error little, and the simulation shows the rule still separates what matters from what does not. Simulated
  leagues shaped like the Arizona import (about 330 hitter-seasons a year, careers, five seasons of split), refitted from 10 to 22
  seasons with hysteresis; the true excess of the starting K is computed exactly on the case mix:

| True K (what the league's hitters' splits are like) | True excess of the starting K | Lifetime adoption | Median first adopted |
|---|---|---|---|
| 5,000 (the starting value exactly right) | 0.00% | **0.0%** (400 leagues) | — |
| 20,000 (less individual than assumed) | 0.08% | **0.0%** | — |
| 2,000 (somewhat more individual) | 0.25% | **0.0%** | — |
| 1,200 (just under the practical minimum: the least favourable null) | 0.97% | **1.0%** (se 0.5%) | 15 seasons |
| 1,000 (just over it) | 1.46% | 14.5% (200 leagues) | 17 |
| 500 (much more individual) | 5.51% | 99.5% | 11 |
| 250 (far more individual) | 16.3% | 100% | 11 |

  False adoption is at most 1.0% (target 5%); a league whose splits are twice as individual as the starting value assumes (K 500 or
  less) is adopted almost always, from the first refit that can decide.

### 14.2 The long-man line (`server/mlbBullpenLines.ts`, measured with the reliever standards, `standards-2`)

- **The measurement.** The innings per appearance of the league's longest-working 15% of relievers this season (`LONG_LINE_POLICY`:
  the 85th percentile). The population is the clubs' active relievers with 8 or more appearances as the standards sample reviews them:
  a club with fewer than 5 lineup regulars reviewed, or a reliever with no working estimate, is not in it. Appearances and innings are
  all of them, starts included, as his tier counts them. The 85th percentile is where the league's real seasons 2019–2025 put 1.6.
- **Served as measured** (review finding A1, supervisor's call). Nothing sits between the check and the served line: with 150 or
  more relievers the quantile serves as measured; below that the starting 1.6 serves, labelled as the starting line with that reason.
  (The first build shrank the line toward 1.6 and checked a shrunk half-line against the unshrunk 15%, which failed leagues far
  from 1.6: exactly the ones the measurement is for.)
- **Never below multiple innings.** A measurement under `MULTI_INNING` (1.6) serves 1.6 with its own reason: "this league's relievers
  rarely work multiple innings, so the line stays at 1.6 innings". It is never described as the league's longest-working 15 in 100.
- **Checks** (each draws the same quantile on part of the league and asks that it leave 15% of the rest at or above it):
  1. *Minimums:* 150 relievers; the standards' own minimums (20 clubs, 15 games) apply to the measurement they travel with.
  2. *Club split:* 400 seeded halvings; pooled over them, the line drawn from half the clubs leaves 15% ± 5 of the other half's
     relievers at or above it (bias).
  3. *Stability:* in at least 90% of the halvings that share is within 15% ± 10, so a line that swings with which clubs drew it
     (clubs using their pens very differently, or too few relievers) fails.
  4. *Season split:* from the game logs, the line drawn from the first half of the season's game dates leaves 15% ± 6 of the second
     half's relievers at or above it, each with 4 or more appearances in the half (half the 8 the tiers need; the same appearances,
     starts included). It runs only where the logs hold at least 90% of the season's appearances; otherwise it is "not measured",
     with why, and not required, and the hover says the season could not be split.
- **When a measurement does not hold up** (a failed check, or too few relievers), the line in force stays (supervisor's call, as
  Stage A said): the league's own line from an earlier measurement, with the standards measured under it (the record's basis
  `carried`, and the hover says the latest measurement did not hold up); else the starting line and the standards measured under it.
  One failed import never flips the tiers back to 1.6.
- **In force together with the standards.** The reliever standards (`rel:<tier>`) are measured on tiers, so the line changes whom each
  describes. The standards refit reviews every club once under the starting lines, measures the lines on the same review, re-reads
  each reliever's tier under them, measures the standards on those tiers and records the lines in the standards' model
  (`standards-2`). The yardsticks serve the lines of the standards in force: never one line for the tiers and another for the
  standards. The line's own checks never decide whether the standards are adopted. A `standards-1` row (measured before the lines
  were) is read as measured under the starting lines until a `standards-2` row exists (supervisor's call). The leverage unit check
  travels with them the same way.
- **Served** through `rosterReviewCalibration(...).bullpen` (`BullpenLines`) into the review's tiers and pen-wide findings
  (`ReviewPorts.bullpen`, required), a reliever's usage notes (which responses, plans and the report read), and the standards refit
  (`reviewPorts(..., { bullpen })`). `roleOf` and `penFindings` take the lines as a required argument
  (`tests/platoonBullpenInForce.test.ts`).

### 14.3 The run on the Arizona import (through 2025; 2026-5-16)

- **Platoon K: the starting value held up.** Fitted K 3,000 (as served 3,208; every origin chose 3,000 except the first, 2,000).
  Held out (8 seasons, 2016→17 … 2024→25; 2,633 hitter-seasons, 814 hitters): the league's own had 0.11% MORE error unshrunk (z +1.17,
  t +1.10, better in 2 of 8 seasons) and 0.07% more as served. The starting K serves, "checked on this league's seasons and held up".
  Reported: a hitter's own past split predicts his next season's split no better than the league norm for his hand (the starting
  K against the norm alone: −0.04%, z −0.32), as run 1 found. No lineup regular's read moves: all 250 have visible platoon ratings,
  so none is read around the league norm alone, where the league's K would apply.
- **The long-man line: measured and served, 1.73** (the 85th percentile of 219 active relievers, served as measured). Club split
  15.6% (aim 15 ± 5); stability 96% of halvings within 15% ± 10 (the other half's share 8–24% at the 5th to 95th percentile);
  season split 13.4% (aim 15 ± 6; the first half's line 1.74 on 205 relievers, all appearances counted). The leverage lines serve as
  written (the league's mean 1.0225). (The first build served 1.705, shrunk toward 1.6; see 14.2.)
- **Effect** (`npm run review:calibration-report`, section 10: everything the save serves, with the standards measured under the
  starting line and the starting lines, against the standards measured under the league's line and served with it):
  - 15 relievers move from long man to low-leverage arm (13) or middle reliever (2); long men 47 → 32 of 238. (The first build's
    shrunk line, 1.705, moved 13.)
  - Two strong flags appear (Senzatela, COL; Falter, KC: former long men now measured against low-leverage arms, whose standard is
    higher) and one disappears (Fedde, CWS, low-leverage arm: the low-leverage standard fell once the weaker former long men joined
    it). Eight watches change. League-wide flags 16 → 17.
  - "Crowded: long men" fires on 3 clubs instead of 6 (BOS, CHC, NYM leave it). "Nobody throws multiple innings" is unchanged (4
    clubs): it keeps its absolute line.
  - Arizona: Joe Ross (1.63 innings an appearance, leverage 0.60) moves from long man to low-leverage arm and from no concern to
    "tools lag his results" (watch). Arizona's pen has no pen-wide finding under either line.
- **Refit time in the worker:** platoon under 1 s; the standards measurement (with the lines) about 7 s, as before.
- **Also fixed after the review:** a platoon read whose hand has no league split is not established (never a prior of zero, never
  the save's K, never a problem); the platoon fit tolerates a missing optional batting column as production's league split does; the
  simulation carries the confirmation count only from a verdict adopted the season before, as the refit does (its rates did not move).

### 14.4 Not done, and why

- The ratings-anchored K and the rating weight (cycle 4, with the tools model): no forecast check exists on a one-snapshot save.
- The leverage cut-offs are not measured per save (a policy on the league's own scale; the quantile alternative is in Stage A).
- Relievers' over-trusted results (13.4) are untouched: the leverage lines do not enter the results lens.
- Tiers at 8 appearances are noisy (above); `MIN_APPEARANCES` is policy, and changing it is the owner's call.
