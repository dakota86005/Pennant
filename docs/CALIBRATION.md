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
- **Worked examples** (80% production band; the save's own lines in this import's dollars): Gunnar Henderson, a
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
score them against observed awards. Payroll sums them edge against edge; whether to combine players statistically
instead (R2 simulated 35–56% of the width) is an owner question, and until it is answered the edges are summed.

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
| A deal whose first season was under way at the earlier import | left out of the price | policy | Its salary pays for part of a season the export does not date |
| The estimator | Σ(salary above the minimum over the deal's seasons) ÷ Σ(expected wins over the same seasons, the earlier import's central) | policy | A ratio of sums does not blow up on a signing expected to produce nearly nothing, as a mean of each deal's price would; seasons are priced only where the earlier import established his production |
| Its band | the signings resampled with replacement 1,000 times, 10th to 90th percentile | policy | The sampling uncertainty of the ratio: how far another draw of the same market's signings would move it. The same 80% as production's outer band. A fixed seed, so an import always reads the same |
| The fewest signings | 20 (`OPENING_PRICE_MINIMUMS.contracts`) | policy (reused) | The opening basis's minimum (B-13) |
| The opening band compared | the spread of the bases with each market basis resampled over its own contracts the same way (1,000, 10th–90th) | policy | B-13's deferred sampling component, so the two bands are compared like for like; the served opening band is unchanged |
| Adoption | the measured band narrower, in dollars, than the opening band with its sampling | policy (owner Q-4) | The evidence decides, no fixed count |
| Observed arbitration salaries | scored against the band the earlier import priced; a class reading at 30 (`COST_POLICY.ladder.minimumCases`) | policy (reused) | The ladder's own method and minimum; the cross-section stays (this winter's salaries in this import's dollars) and the band covers both |
| Reserve-clause renewals | the renewal spread's method at 30 (`COST_POLICY.renewal`) | policy (reused) | One method for a renewal |
| Replacement from freely available talent | WAR per 600 opportunities, for the club that took him, from the season he joined it, of players acquired for nothing with a major-league record; 30 players | policy | Below it the export's convention stays (provisional). Once measured, the measured price counts wins above it; production stays in the export's WAR |
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
