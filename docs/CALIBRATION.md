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
The hardening (2026-09-23, section 6.3) rebuilt the central and the gate under method `production-3h.1`; the table and
the method below describe 3b.1 where section 6.3 says what changed.

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
  (no hold-out widening chosen on the held-out cases, B-05, B-16). Each horizon keeps its own prior weight and
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
