# Player Value hardening: review, findings and fixes

Status: historical record of the hardening cycle for Player Value phases 1 to 3b (2026-09-23, branch
`hardening/player-value` from `f1e0911`). It records what the review found, what each fix did and what was left, and
it is not edited to match later code. Current truth lives in the canonical documents:
[PLAYER_VALUE.md](PLAYER_VALUE.md) (design, Part 9 exit evidence, Part 12 owner answers),
[DECISIONS.md](DECISIONS.md) (D-052 and D-053 and their 2026-09-23 amendments), [CALIBRATION.md](CALIBRATION.md)
(sections 6.3, 6.4 and 7) and [BEHAVIOR_CASES.md](BEHAVIOR_CASES.md) ("Player Value", the hardening rows).

Nothing in this cycle asked the owner to run an OOTP experiment or wrote to a save. Every check ran against the
read-only Arizona import (league 203, game date 2026-5-16, about 45 games played), scratch `history.db` files,
synthetic saves and the production functions.

## 1. Scope and method

**Scope.** Everything Player Value had built through phase 3b: contract facts and the control timeline (phase 1),
Club Finances and the opening price of a win (phase 2), expected production from results (3a) and from ratings,
with playing time conditional on quality (3b), the fit store and the refit, the player card's production cone, and
the consumers that read them (Contracts, Payroll, Free Agents, the Trade Center, the AI context).

**Method.** Four reviewers worked independently on `f1e0911`, each with a distinct brief:

| Reviewer | Brief | Findings |
|---|---|---|
| A | Correctness and doctrine: probes against the import and synthetic fixtures | 24 (2 high, 15 medium, 7 low) |
| B | Statistics and calibration: an independent rebuild of the backtest, then checks the code does not run | 17 (1 critical, 4 high, 10 medium, 2 low) |
| C | Full-save sweep: every active player, 30-club base rate, hand checks, a rerunnable sweep script | 15 (4 high, 4 medium, 7 low or low–medium) |
| D | Cross-save robustness (synthetic saves of every shape) and the UI code | 26 (6 high, 9 medium, 11 low) |
| S | Supervisor's browser checks, before and after the UI fixes | 6 (2 medium, 4 low) |

That is 88 finding IDs. The supervisor triaged them into fixers who worked in waves, each on its own branch merged
into `hardening/player-value`. Every fix followed the same order: the behavior case in BEHAVIOR_CASES.md first,
stated as a baseball invariant; a test that failed on the unfixed code for the expected reason (the fail-first
output was kept with the fixer's notes); then the fix. A finding whose fix belonged to another fixer was held as an
`it.todo` or a `PENDING` boundary entry naming it, so the list could only shrink.

| Fixer | Area | Commits on `hardening/player-value` |
|---|---|---|
| F3 | Finances, league rules, the parser-based boundary test, the cross-save suite | `0dd09ab` |
| F2 | Contracts, control, Player Rights, the pages, the card UI | `8b2c337`; supervisor integration `b9380eb` (service arithmetic moved into Player Rights' `serviceReading`) |
| F1 | Production's central, the gate, the fit store, the refit worker, injuries; then the rolling-origin gate | `6a7b2c6`, `00ea0bc` |
| S | Payroll wording (S-05, S-06) | `6c615f5` |
| F4 | Prospects: the arrival chance, quality, two top-level leagues, the arrival gate, partial ratings | `a32245f` |
| F5 | The arrival model on rolling origins | Running when this record was drafted (section 6) |

Method versions moved to `production-3h.2` and `ratings-3h.1`, so every save refits both models once.

## 2. Outcomes

**The central was biased low, and it was rebuilt.** Reviewer B showed that expected wins were the product of an
expected rate and an expected playing time. Talent drifts, and the players who keep playing are the ones who stayed
good, so the product understates what happens: summed over a control horizon the central was about 24% low, and
40–90% low for starters and relievers at horizons 5–7. Reviewer C found the same thing from the other end: the
established cohort's summed central fell 10% to 66% short of what the save's own history gives the same cohort one
to six seasons on. The gate had not seen it because it read pooled coverage only, with a 10-point tolerance, and the
drift term had absorbed the bias as variance. F1 rebuilt the central as the chance he plays × his playing time per
scheduled game when he plays × the rate of those who play at that horizon, each fitted per kind and horizon, with a
physical ceiling on playing time and a band that mixes the chance of no playing time with the playing distribution.
Held out on the Arizona import the pooled bias is now −0.01 to −0.04 wins at every horizon, and the cohort sums are
within 1–10% of the save's history.

**The gate was rebuilt, and on this save it still says no.** The gate now reads coverage as fitted, pooled and in
every subgroup the method serves differently (kind, usage third, quality tier, age band), and fails a central that is
materially and significantly biased in any of them. Under the first rebuild (`production-3h.1`, one hold-out block
2016–2025) it failed on 13 cells from era drift between the imported 2006–2015 and 2016–2025 seasons. The owner chose
option C: the tolerances stay, and the backtest becomes rolling-origin (up to eight origins, each scored by the
method refit through it, clustered by player and origin) with a 2-season recency half-life. Under `production-3h.2`
every subgroup is within 10 points of the targets, and the gate fails on two cells only: hitters at horizons 5 and 6,
−0.096 wins (21% and 27% of the mean outcome), scored from the 2017 and 2018 origins alone. The tolerances were not
loosened, so the fallback prior, fitted to the league's own WAR scale, stays in force on Arizona, labelled "not yet
calibrated on this save".

**Prospects are `unknown` on Arizona, by the gate.** F4 fixed the arrival chance (C-01), tied a prospect's chance and
playing time to his projected quality (C-02, partly) and tightened the arrival gate to the production gate's
relative bias rule (B-15). The ratings fit `ratings-3h.1` then fails at horizons 3–6: the chance is 12–20% low, 7 to 9
clustered standard errors, because the save's arrival rates rose between the training and held-out seasons and the
arrival method weighs every season alike. It is not adopted, so a player not in the majors has production `unknown`
with the gate's reason. Whether rolling origins fix this is F5's question (section 6). Both outcomes are the honest
result of a strict gate; neither gate was loosened to get a fit adopted.

**The fit is the save's by identity.** The fit store is keyed by the save's configured name and a fingerprint of the
league's own history, never serves a fit through a season the league has not completed, and never lets a refit that
fails the gate replace the fit in force (A-02, D-01, A-21, D-08). The refit runs in a worker thread: nine fits and the
ratings fit take about 20 s, and the server's event loop lagged at most 2 ms while it ran (A-17).

**Injury proneness has no surviving effect on this save.** Phase 3b read the most injury-prone third of hitters as
playing about 6% less (94.8% ± 1.2). That standard error treated each of a player's seasons as independent. With a
player's seasons clustered and Holm's rule across the family of 18 tests, no playing-time or aging effect is
distinguishable from none (the same third plays 97.9% ± 1.7), so proneness moves nothing on Arizona (B-08; D-053
amendment).

**Contracts and control now say what the export says.** Opt-outs reach the timeline and the cone as both branches;
the season under way is under contract, not an open option; consumers see an option as an option, never "signed";
the blank contract row is no longer read as a minor-league deal; arbitration trips count winters; the Super Two
cutoff carries a policy margin; service is capped by the schedule and projected from the schedule's calendar. Reviewer
C's sweep check "an exported opt-out is visible in the control timeline" went from 58 of 58 failing to none.

## 3. Owner decisions made during the cycle

All on 2026-09-23. Where a decision is not attributed to the owner in the canonical documents, the entry says so;
the mechanism it approved is recorded where named.

| Decision | Recorded |
|---|---|
| Known injury days out lower expected playing time, so the central moves; a season lost to injury is never read as evidence of less future usage (supersedes the phase 3a "a stated injury only widens") | PLAYER_VALUE.md Part 12 "Injuries" and 2.3; D-052 amendment |
| Super Two: a 10-day policy margin around the computed cutoff range, within which the year is `indeterminate` (`SUPER_TWO_MARGIN_DAYS`) | PLAYER_VALUE.md Part 12, 2.2 and Part 11; D-052 owner answers |
| A-20 (the `unverified` limitation and freshness on consumer routes) and D-26 (pre-fork consumer routes on older export shapes) are deferred to phase 6 | D-26: `it.todo` "(deferred)" in `playerValueCrossSave.test.ts` and a comment in `payrollControl.test.ts`. A-20: not recorded in the repository; this record is the only place |
| Arbitration trips are shown as ranges where the projection leaves a winter open ("arb 2–3") | Mechanism in PLAYER_VALUE.md 2.2 and BEHAVIOR_CASES.md (Super Two hardening row); the owner's approval is not attributed there |
| Club, vesting and mutual option seasons sit outside committed payroll, shown apart ("+$23.0M in 2 club options, not counted"); a player option or opt-out season is committed, flagged | Mechanism in PLAYER_VALUE.md Part 8 and BEHAVIOR_CASES.md (`payrollControl.test.ts` row); the owner's approval is not attributed there |
| The opt-out reading applies inside extensions: the seasons an opt-out can cut include a signed extension's | In code (`playerValueControl.ts`: the covered seasons are the term's and the extension's); not stated as such in the canonical documents |
| Price-of-win policy minimums: a basis rests on at least 0.25 of a schedule and at least 20 market contracts (`OPENING_PRICE_MINIMUMS`) | PLAYER_VALUE.md 4.1 and Part 11; CALIBRATION.md section 7, stamped policy; the owner's approval is not attributed there |
| A short season is priced in proportion to its schedule: its WAR is put on this season's footing by the share of the schedule it covered, so its pay is read as scaling with the schedule | CALIBRATION.md section 7 (a mechanism, no constant); PLAYER_VALUE.md 4.1; the owner's approval is not attributed there |
| Gate option C: rolling-origin backtest, recency weighting (half-life 2 seasons), the strict tolerances kept; never loosened without the owner | PLAYER_VALUE.md Part 12; D-053 amendment; CALIBRATION.md 6.3 |
| The serving rule: the model served is the method refit through the last completed season; held-out seasons are scored by refits of the method | PLAYER_VALUE.md Part 12; D-053 amendment |
| A career-ending injury: the central goes to zero for the seasons it covers, and the band keeps its high edge | PLAYER_VALUE.md Part 12; D-053 amendment |
| The rest of this season is measured from this season's own games so far, never next season's attrition | PLAYER_VALUE.md Part 12; D-053 amendment |
| Same-time ratings pull less: until the save measures them as a forecast they pull the regression target only by their own weight | PLAYER_VALUE.md Part 12; D-053 amendment |
| The arrival model gets option C too (rolling origins and recency weighting, judged by the tightened gate) | Not yet recorded; F5 records it with its result (section 6) |

## 4. Findings log

Outcomes: **fixed**; **partially fixed** (what remains is in section 5); **deferred** (to a named phase, with the
reason); **duplicate of X** (the same defect, fixed under X); **no change** (with the reason). Severity is the reviewer's own. "Where" names
the fixer and the test file (or document) that pins the fix. Test files are under `tests/`.

### Reviewer A: correctness and doctrine

| ID | Sev. | Finding | Outcome | Where |
|---|---|---|---|---|
| A-01 | high | Pitchers' batting lines (5% of cases, −5.3 WAR/600) trained the hitter model; hitters' K 153 was an artefact | fixed | F1. `playerValueProduction.test.ts`, `playerValueProductionFit.test.ts` ("a listed pitcher's batting…"); CALIBRATION.md 6.3 (K 153 → 400) |
| A-02 | high | A forced ratings refit that failed the gate overwrote the adopted row (`INSERT OR REPLACE`) | fixed | F1. `playerValueProductionFit.test.ts` ("a refit that fails the gate never replaces the fit in force, even when forced") |
| A-03 | med | The season under way was shown as an open option with a declined branch | fixed | F2. `playerValueControl.test.ts` |
| A-04 | med | Consumers collapsed an option season into "signed"; the AI had no word for an option | fixed | F2. `payrollControl.test.ts`; `ai.ts` and `chat.ts` prompts |
| A-05 | med | Opt-outs never reached the control timeline | fixed | F2. `playerValueControl.test.ts`, `playerValueCone.test.ts`; verified in the browser (Soto) |
| A-06 | med | An unpopulated vesting flag read as "no option"; a mutual option read as the club's | fixed | F2. `playerValueControl.test.ts` |
| A-07 | med | Results-and-ratings projections claimed the results fit's measured coverage | duplicate of B-05 | F1 |
| A-08 | med | A prospect's cone "rests on Major-league results : 0 PA" and calls itself calibrated | fixed | F1. `playerValueCone.test.ts` (hardening block) |
| A-09 | med | Injury calendar broke at the season's edges (after the last game, before Opening Day) | fixed | F1. `injuryShares` spills days past a completed schedule into the next season and, before Opening Day, first spends the days to Opening Day; pinned in `playerValueProduction.test.ts` ("days out that end before Opening Day…"). The commit's "partial" is the one residual: where the export does not state the off-season's length, later seasons are widened, not moved (D-018), which is the intended reading |
| A-10 | med | `injury_left = 1000` (54 players) read as 1000 literal days, inconsistently | fixed | F1. Read as a duration not established (`injuryDurationSentinels`); `playerValueProduction.test.ts` |
| A-11 | med | Injury notes disappeared when no edge moved | fixed | F1. `playerValueProduction.test.ts` ("a stated injury is always named in the basis…") |
| A-12 | med | Arbitration years after a Super Two year numbered as if he had not been one | fixed | F2. Trips count winters; `playerValueSuperTwo.test.ts` |
| A-13 | med | Definite "pre-arbitration" one day under a cutoff edge that is a reading, not a bound | fixed | F2, with the owner's 10-day margin; `playerValueSuperTwo.test.ts` (tie included) |
| A-14 | med | Payroll rebuilt contract facts from raw columns: dead money silently $0, reads unguarded, wall-clock year | fixed | F2, then `b9380eb`. `payrollControl.test.ts`; its `PENDING` entry removed |
| A-15 | med | Partial ratings did not widen a thin-record player's blended band | fixed | F4. `playerValueRatings.test.ts` ("an unknown glove or running grade spans the scale's ends…") |
| A-16 | med | The boundary test was weaker than it looked (template SQL, dynamic imports, service arithmetic, contract queries) | fixed | F3. Parser-based checks; 22 deliberate mutations, 20 of which passed the old test, all fail the new one. One `PENDING` entry remains (section 5) |
| A-17 | med | The "background" refit froze the server for about 10 s; a possible import race | fixed | F1. Worker thread with an in-process fallback; `playerValueProductionFit.test.ts` ("the refit runs off the event loop and never records a result read across an import") |
| A-18 | low | "extended" when next season is still the current deal | fixed | F2. `payrollControl.test.ts` |
| A-19 | low | A player free at k = 0 read as `indeterminate` rather than leaving | fixed | F2. `payrollControl.test.ts` |
| A-20 | low | The `unverified` limitation never reaches the GM, and no route passes freshness | deferred | Phase 6, owner decision: it is a consumer-migration question. Not recorded in the repository (section 3) |
| A-21 | low | Fit and snapshot keys lean on the save name; a "future" fit can be in force | fixed | F1. Save identity plus league fingerprint, `throughMax`; `playerValueProductionFit.test.ts`, `playerValueCrossSave.test.ts` (D-01) |
| A-22 | low | The Contracts "Svc" column showed decimal years | fixed | F2, then `b9380eb` (Player Rights' `serviceReading`). `contracts.test.ts`, `payrollControl.test.ts` |
| A-23 | low | Free Agents silently dropped option-year contracts | fixed | F2. `payrollControl.test.ts` |
| A-24 | low | Two unknown-to-zero reads in the fits (`played ?? 0`, `war ?? 0`) | fixed | F1. `playerValueProductionFit.test.ts` (blank WAR), `playerValueCrossSave.test.ts` (`ratingsHistory`) |

### Reviewer B: statistics and calibration

| ID | Sev. | Finding | Outcome | Where |
|---|---|---|---|---|
| B-01 | critical | The central multiplied expected rate by expected playing time and ran about a quarter low, worse for pitchers | fixed | F1. `playerValueProductionFit.test.ts` ("the held-out central is unbiased at every horizon"); CALIBRATION.md 6.3 |
| B-02 | high | The hitter regression was fitted on a population that was 7.3% pitchers batting | duplicate of A-01 | F1 |
| B-03 | high | The gate read pooled coverage only, with a 10-point tolerance | fixed | F1. `playerValueProductionFit.test.ts` ("the gate cannot pass a miscalibrated fit") |
| B-04 | high | Miscalibrated subgroups (age ≤ 25 and 34+, the second and ninth deciles) | fixed | F1. Age cells and drift; the subgroup gate; CALIBRATION.md 6.3 tables |
| B-05 | high | Observed coverage shown beside a projection belonged to a different estimator, at the wrong horizon, and was in-sample | fixed | F1. The serving rule; "not measured" for blends and the rest of this season; `playerValueProduction.test.ts` |
| B-06 | med | Blending with same-time ratings partly undid the results regression | fixed | F1, owner-approved rule; `playerValueProduction.test.ts` ("the same-time ratings never undo the results regression") |
| B-07 | med | The rest of the current season used next-season attrition | fixed | F1, owner-approved rule; `playerValueProduction.test.ts` ("the rest of this season is in-season") |
| B-08 | med | Proneness standard errors about half their size; 18 uncorrected tests | fixed | F1. Clustered by player, Holm; horizons 1–3 only; `playerValueProductionFit.test.ts`. Result: no effect survives on Arizona |
| B-09 | med | The fallback prior contained the held-out seasons | fixed | F1. A prior fitted on the save's own held-out seasons is not used; `playerValueProductionFit.test.ts` |
| B-10 | med | "Calibrated on this save" decided from the horizon-1 sample alone | fixed | F1. Per-horizon prior weight, widening and label; `playerValueProductionFit.test.ts`, `playerValueCone.test.ts` |
| B-11 | med | The prior and the era rule assumed a 162-game schedule | fixed | F1. Playing time per scheduled game; `playerValueProduction.test.ts`, `playerValueCrossSave.test.ts` (D-05, D-06) |
| B-12 | med | Zero-inflated outcomes gave degenerate bands (an edge at the central) | fixed | F1. Mixture band; CALIBRATION.md 6.3 |
| B-13 | med | Price of a win: a short prior season, the pace bases with no floor, no minimum market | partially fixed | F3. Schedule scaling and the two policy minimums; `playerValueFinances.test.ts`, `playerValueCrossSave.test.ts`. The bootstrap over contracts is deferred to phase 4, where the comparison it serves is built |
| B-14 | med | The logistic neither detected separation nor reported non-convergence; coefficients blended linearly | fixed | F1. Ridge, a flag, pseudo-cases; `playerValueProductionFit.test.ts` |
| B-15 | med | The arrival gate's tolerance was an absolute 10 points on rates of 4–12% | fixed | F4. Relative bias beyond 10% and three clustered SEs; `playerValueRatings.test.ts`. Arizona's ratings fit now fails it |
| B-16 | low | The hold-out widening reached its cap silently | fixed | F1. No widening is chosen on held-out cases any more, so there is no cap to reach; CALIBRATION.md 6.3 |
| B-17 | low | Small items: the ratings mapping's held-out variance is circular; two-way sides are added comonotone, untested; CALIBRATION.md 6.1 omits one proneness effect | deferred | Supervisor triage: the mapping's variance is not served (K replaces it until snapshots measure reliability), so the circularity changes nothing shown; the comonotone two-way sum is conservative (wider, never narrower); the proneness item is overtaken by B-08 (no effect survives). Carried forward (section 5) |

### Reviewer C: full-save sweep

| ID | Sev. | Finding | Outcome | Where |
|---|---|---|---|---|
| C-01 | high | The arrival chance for h ≥ 1 dropped every player called up in his origin season (Aidan Miller 0.61 then 0.42) | fixed | F4. `playerValueRatings.test.ts` ("C-01…"); prospects whose chance falls after this season 653 → 34 |
| C-02 | high | A prospect's playing time ignored his projected quality; prospects about 10× short in aggregate | partially fixed | F4. `playerValueRatings.test.ts` (C-02 block). Quality is floored at replacement, and the rate when prospects play is about half of real arrivals' (section 5) |
| C-03 | high | The established cohort's central was biased low and the bias grew with the horizon; the gate checked coverage only | duplicate of B-01 and B-03 | F1. Cohort sums now within 1–10% of history (CALIBRATION.md 6.3) |
| C-04 | high | A season lost to injury read as usage evidence; the band ruled out a healthy return (Gerrit Cole) | fixed | F1, owner rule; `playerValueProduction.test.ts` ("a season lost to injury is never read as evidence…") |
| C-05 | med | Playing-time high edges had no physical ceiling (Witt 1,153 PA) | fixed | F1. The save's measured ceiling per scheduled game; CALIBRATION.md 6.3 |
| C-06 | med | Opt-outs read but never shown in the timeline or the cone | duplicate of A-05 | F2. The sweep check 58/58 → 0 |
| C-07 | med | 24 major leaguers on the 60-day IL with a blank contract row read as minor-league contracts | fixed | F2. `playerValueControl.test.ts` |
| C-08 | low–med | Pooled served coverage hid that low-usage cells are over-covered by construction | fixed | F1. The record reports coverage for players who played; CALIBRATION.md 6.3; `playerValueProductionFit.test.ts` |
| C-09 | med | The top-tenth figures described stars while the pooled bias applied to everyone | fixed | F1. Pooled and by-kind bias recorded in CALIBRATION.md 6.3 and PLAYER_VALUE.md Part 9, and gated |
| C-10 | low–med | The cone basis for a ratings-only projection read "Major-league results : 0 PA" | duplicate of A-08 | F1 |
| C-11 | low | The cone's calibration line said "Calibrated on this save" while its flag was false | duplicate of A-08 | F1 |
| C-12 | low–med | "Free agent after X" when season X may itself be free agency | fixed | F2. `playerValueCone.test.ts` |
| C-13 | low | The service projection's low edge assumed an injured player banks nothing, but the IL accrues service | fixed | F2. `playerValueControl.test.ts` |
| C-14 | low | Minor inconsistencies: ability evidence `complete` while listing a missing glove (21 DHs and two-way players); Jase Bowen's reason text | partially fixed | The reason text already reads "a signed amateur not yet assigned, or a player yet to appear" (phase 3b), which covers Bowen. The DH `complete`-beside-a-missing-glove item is carried forward (section 5): it changes no number, and the file is F5's |
| C-15 | low | The arbitration label counted service classes and could repeat a trip already taken | fixed | F2, with A-12; `playerValueSuperTwo.test.ts`, `payrollControl.test.ts` |

### Reviewer D: cross-save robustness and the UI

| ID | Sev. | Finding | Outcome | Where |
|---|---|---|---|---|
| D-01 | high | A new save under a reused name inherited the previous save's fit, labelled "Calibrated on this save" | fixed | F1. `playerValueCrossSave.test.ts` (D-01), `playerValueProductionFit.test.ts` |
| D-02 | high | Seasons before the league existed counted as zero playing time | fixed | F1. `playerValueCrossSave.test.ts` (D-02), `playerValueProduction.test.ts` |
| D-03 | med | In a short schedule, days after the last game counted as "remaining this season"; the Super Two class built from phantom days | fixed | F2. `playerValueControl.test.ts`, `playerValueSuperTwo.test.ts`. The cross-save `it.todo` was not converted (section 5) |
| D-04 | high | Every later season projected as a full service year, so free agency came seasons early in a short-schedule league | fixed | F2. Later seasons from the schedule's calendar; `playerValueControl.test.ts`. The cross-save `it.todo` was not converted |
| D-05 | high | Playing time in absolute PA and BF: short schedules got impossible playing time | fixed | F1. `playerValueCrossSave.test.ts` (D-05), `playerValueProduction.test.ts` |
| D-06 | med | A season's schedule share measured against today's schedule; a lengthened schedule lost its history | fixed | F1. `playerValueCrossSave.test.ts` (D-06) |
| D-07 | high | Two top-level leagues: arrival rates counted the other league's farm as never arriving | fixed | F4. `playerValueCrossSave.test.ts` (D-07); Arizona unchanged |
| D-08 | med | A `season_year` bump beside last season's standings marked the new season complete | fixed | F1 (`00ea0bc`). `playerValueCrossSave.test.ts` (D-08), `playerValueProductionFit.test.ts` |
| D-09 | low–med | An adopted fit that is mostly the prior was stamped `calibrated` | fixed | F1. `playerValueCrossSave.test.ts` (D-09), `playerValueProductionFit.test.ts` |
| D-10 | high | A ratings projection's cone status read "Calibrated on this save…" while `calibrated` was false | duplicate of A-08 | F1. `playerValueCone.test.ts`; also confirmed by the supervisor in the browser before the fix |
| D-11 | med–high | A prospect's "Rests on" line read "Major-league results : 0 PA as a hitter" | duplicate of A-08 | F1 |
| D-12 | med | Under the prior, a thin record in another WAR environment was regressed toward MLB's mean | fixed | F1 (`00ea0bc`). The league's own WAR scale as a unit; `playerValueCrossSave.test.ts` (D-12), `playerValueProduction.test.ts` |
| D-13 | med | One missing column in either career table blanked every player's production | fixed | F1. `playerValueCrossSave.test.ts` (D-13) |
| D-14 | low–med | "This season" read only through the parent chain; a doubled full stop | partially fixed | F3. `playerValueCrossSave.test.ts`, `playerValueControl.test.ts`. The doubled full stop is an open `it.todo` (F2's) |
| D-15 | low | A missing schedule length or standings made every production `unknown`, labelled "(0 seasons)" | fixed | F1 (`6a7b2c6` partly, completed in `00ea0bc`). `playerValueCrossSave.test.ts` (D-15) |
| D-16 | low | An independent top-level league whose level is not 1 had no production | fixed | F1 (completed in `00ea0bc`). `playerValueCrossSave.test.ts` (D-16) |
| D-17 | low | With financials off, club budget and payroll still shown in dollars | fixed | F3. `playerValueCrossSave.test.ts`, `playerValueFinances.test.ts` |
| D-18 | med | Contracts and Free Agents showed missing finance figures as $0 | fixed | F2. `payrollControl.test.ts` |
| D-19 | med | The legend said "80% of outcomes fall inside" under the prior | fixed | F2. `productionCone.test.ts`; PLAYER_VALUE.md Part 8 |
| D-20 | med | The hidden table and the tooltip's accessibility left out values the tooltip shows | fixed | F2. `productionCone.test.ts` |
| D-21 | low–med | At narrow widths the key merged "Signed" and "Signed (extension)" | fixed | F2. `playerValueCone.test.ts` |
| D-22 | low | Keyboard and dismissal problems; a 1px focus ring | fixed | F2, with S-01. `productionCone.test.ts`, `playerCard.test.ts` |
| D-23 | low | `formatWins` printed ±0.04 as "0.0" | fixed | F2. "<0.1"; `productionCone.test.ts` |
| D-24 | low | One non-finite number from the server would blank the app | fixed | F2. `productionCone.test.ts` |
| D-25 | low | Payroll's price-of-win block: the floor's low edge only, a hard-coded label, a hover-only run-on basis | fixed | F2. `playerCard.test.ts` |
| D-26 | low | Consumer routes on the Player Value pages failed on older export shapes (pre-fork queries) | deferred | Phase 6, owner decision: pre-fork consumer code, out of Player Value's scope. `playerValueCrossSave.test.ts` `it.todo` |

### Supervisor: browser checks

| ID | Sev. | Finding | Outcome | Where |
|---|---|---|---|---|
| S-01 | med | The player card had no focus trap; Tab left the card | fixed | F2. `src/focusTrap.ts`; `playerCard.test.ts`; verified in the browser (25 Tabs, 40 Shift+Tabs) |
| S-02 | med | The card was a fixed 820 px; the cone's narrow layout was never reached | fixed | F2. `playerCard.test.ts`; verified at 640 and 375 px. Off-centre under touch emulation only (section 5) |
| S-03 | low | Payroll's price line showed the floor's low edge only; the basis was hover-only | duplicate of D-25 | F2 |
| S-04 | low | The underlying pages overflow at phone widths | no change | Out of scope: Pennant is desktop-first; pre-existing |
| S-05 | low | Payroll's price label had two colons | fixed | Supervisor, `6c615f5` |
| S-06 | low | Payroll's dead-money note showed internal jargon and nested parentheses | fixed | Supervisor, `6c615f5`; verified in the browser on the integration branch (the note's unexported-column reading is its own sentence). The doc citation "(R-6)" is kept: citing the basis in user-facing text is the app-wide convention (MLB Operations and the farm cite D-numbers in their unknowns) |

**By outcome:** fixed 71; partially fixed 4 (B-13, C-02, C-14, D-14); duplicate 9 (A-07, B-02, C-03, C-06, C-10,
C-11, D-10, D-11, S-03); deferred 3 (A-20, D-26, B-17); no change 1 (S-04).

## 5. Found, not fixed, carried forward

**Prospects (F4's list).**
- The prospects' rate when they play is about 0.55–0.6 WAR per 600, against 1.0–1.6 for the save's real arrivals.
  It comes from the ratings path (the same-time mapping and the provisional development prior, a cross-section rather
  than a path), not the arrival model, and by doctrine waits on the save's rating snapshots. It caps how far C-02 can go.
- The quality effect is floored at replacement (policy). Weak young prospects in cells where most players project at
  or below replacement keep negative centrals, down to −1.19 wins (Santiago Pereira, 2031). Low edges below −3 rose
  from 6 to 35, because C-01 raised these players' chance.
- The arrival method weighs every season alike and uses a single split; this drift is why Arizona's ratings fit fails
  the gate. F5 (section 6).
- `linkedArrivals` reads the expected chance at the season's start, so a mid-season snapshot would overstate it. No
  save is affected yet (0 linked snapshots).
- An unknown ratings-only player's `basis.source` reads undefined. Predates F4.
- On Arizona the results fit is not adopted, so the quality coefficients the arrival model carries are the fallback
  prior's.

**Production and the fit.**
- The two failing gate cells (hitters, horizons 5 and 6, −0.096 wins). What would pass them is more of the save's own
  seasons, or an owner decision on the subgroup bias rule at long horizons. A half-life shorter than 2 was not tried.
- Refit isolation: one league's or model's exception during a refit still skips the rest
  (`playerValueCrossSave.test.ts` `it.todo`, reviewer D's minor note).
- A-09's residual: where the export does not state the off-season's length, an injury's later seasons are widened, not moved.
- B-17: the ratings mapping's held-out variance is set on the residuals it is scored on (not served, since K replaces
  it), and the comonotone two-way sum is untested (conservative). Deferred by the supervisor.
- Reviewer D's minor note: the replacement level from very little data (13 games a club) is a point with no band,
  labelled "to date". No change found.

**Contracts, consumers and the UI.**
- A-20 and D-26, to phase 6 (section 3). The rest of the `players_value` reads on the card (Value, Talent), the
  Contracts recommendations and the Free Agents "≥40 Value" filter are phase 6's as planned; they can contradict the
  cone on the same card until then.
- B-13's bootstrap over contracts, to phase 4.
- A-16's sweep left one `PENDING` boundary entry: the player card (`player.ts`) reads `players_contract` directly.
  Phase 6 (the player card's migration).
- The cross-save `it.todo`s for D-03 and D-04 were not converted into cases, although F2's fixes are pinned in
  `playerValueControl.test.ts` and `playerValueSuperTwo.test.ts`; the D-14 doubled full stop is still a todo.
- C-14: a DH's ability evidence reads `complete` beside a missing glove (`playerValueRatings.ts`): `partial`, or no glove item for a DH.
- S-02: under touch emulation the card is off-centre (the layout viewport grows to the page's overflow). S-04: the
  pages behind the card overflow at phone widths. Pennant is desktop-first.

## 6. F5 and F6: the arrival model

**F5 (`56a563e`): rolling origins for arrivals.** The owner extended option C to the arrival model (2026-09-23;
D-053 amendment, PLAYER_VALUE.md Part 12). Each origin is fitted through that season with the 2-season recency
half-life and scored on the next season's minor leaguers; the gate's errors are clustered by player and by origin, and
F4's tolerances are unchanged. The code is shared with the results fit (`rollingOrigins`, `recencyWeight`,
`twoWayClusteredSe`). One tightening: a history too short for any rolling origin must still check horizon 1 before
measured arrivals are adopted, so the change could not loosen the gate for short saves. Method `ratings-3h.2`.
Also: `basis.source` is `ratings` or `none` for an unknown ratings-only player (F4's leftover), and `linkedArrivals`
reads the expected chance at the snapshot's own point in the season (a range where the schedule is not exported).

On Arizona (origins 2011, 2013, 2014, 2016, 2017, 2021, 2022, 2024), the held-out chance of reaching the majors:

| Horizon | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| Predicted / observed | 4.7 / 4.6% | 7.8 / 7.8% | 10.0 / 10.0% | 11.4 / 12.3% | 11.4 / 13.7% | 11.1 / 13.3% | 10.1 / 12.2% |
| Bias share of observed | −1.7% | 0.3% | 0.0% | 7.5% | **16.7%** | **16.8%** | **16.9%** |

Expected opportunities are within 9% at every horizon. Half-lives from none to 1 (the last diagnostic only) moved the
long-range miss only from about 19% to 15%: a fit through season Y contains only classes that began four to six or
more seasons earlier, and on this save each class reached the majors more often than the last. The gate was not
loosened, so the whole arrival fit was still rejected and prospects stayed `unknown`.

**F6: horizon-by-horizon adoption.** The owner chose to serve the horizons that pass (option (b), 2026-09-23), with
year-by-year arrival rates (option (c)) left for later.

F6 (`b7223f8`, method `ratings-3h.3`) serves the arrival model horizon by horizon, recorded in D-053 and
PLAYER_VALUE.md Part 12 and stated in `RATINGS_POLICY.adoption`. The horizons served are a contiguous run from the
rest of this season: a horizon after one that failed or could not be checked is never served, even if its own check
passes; horizon 1 must be in the run; the ratings mapping's own gate must still pass; every tolerance is unchanged.
The results fit keeps its all-horizons rule.

- **Per season, never a guess.** A prospect's seasons past the run are listed as not established, each with no band,
  no central and no zero, and a reason naming its horizon's finding ("4 seasons out: the save's held-out arrival chance
  ran 17% low …"). Seasons inside the run are exactly what a fully adopted model gives (tested).
- **Totals.** `productionTotal` is unknown, naming the missing seasons, whenever a season in the range is not
  established; it never counts one as 0. `player-value-report.ts` counts established and not-established seasons apart.
- **The cone.** Bands, central and axis come from the established seasons; each later season of control keeps its slot
  under an outlined "Production not established" mark with its reason. The calibration line reads "arrival calibrated
  through 3 seasons out (2030–2032 not established)". The supervisor renamed the control label for an unknown control
  season to "Control not established" (short label unchanged) so the two cannot be read as one.
- **Arizona.** Served through 3 seasons out (2026–2029). Summed prospect centrals 111 / 201 / 256 for 2027–2029
  (the cohort history is about 144 / 260 / 362: still low, see section 5); 262 players have an established season
  below −0.1 wins; one low edge is below −3. Aidan Miller (41278): chance 0.585 / 0.813 / 0.837 / 0.907 and centrals
  0.23 / 0.93 / 1.58 / 3.04 for 2026–2029, then 2030–2032 not established.
- **Stricter for other saves.** A horizon with too few held-out cases now ends the run, where before it was served
  unchecked.
- **Owner question left open.** Whether the results fit should also be adopted horizon by horizon (on Arizona it
  fails only hitters at horizons 5–6). F6 recommended not now: a failing results fit serves the labelled prior, not
  `unknown`, and a literal per-horizon rule would blank the last seasons of nearly every major leaguer.

**Browser check (supervisor, integration `b7223f8`, scratch data, startup refit in the worker: "adopted horizon by
horizon through 3 seasons out").** Aidan Miller and Sebastian Walcott: 2026–2029 drawn with both bands, 2030–2032 under
the "Production not established" mark with the reason in the screen-reader table; Shohei Ohtani unchanged (seven signed
seasons, no mark); at 560 px wide the card fits with no horizontal overflow.

## 7. Validation

**Baseline.** On the integration branch after F6 and the supervisor's last edits: see the pull request (F4 at `a32245f`:
2,301 passed; F5: 2,308; F6: 2,319, 8 todo). `npx tsc --noEmit` clean; `npm run build` and `npm run desktop:build` succeed (the desktop build bundles
`value-refit-worker.cjs`). For comparison, F3's branch ran 155 files, 2,200 passed, 20 todo; the todo count fell as
the cross-save suite's held cases became real ones. The 8 remaining todos are the five cross-save ones in section 5
and three pre-existing ones for phases 2, 4 and 5 (`playerValueCost.test.ts`, `playerValueFinances.test.ts`).

**Fail-first.** Each fixer's new cases failed on the unfixed code for the expected reason: F1's 42 cases on `f1e0911`
and 2 more for the rolling-origin gate; F2's control, Super Two, payroll, cone and UI cases; F3's cross-save suite and
22 boundary mutations; F4's 6 ratings cases and the D-07 cross-save case. The outputs were kept in the session's working notes, not in the repository; the tests themselves are the durable record.

**The regression sweep.** Reviewer C's `sweep-c.mts` runs every structural check over the whole import (12,575
valued; bands ordered and nested, no non-finite number, contracts against `players_contract`, the cone against
control, and the anomaly checks behind C-05, C-06, C-10 and C-11).

| State | Pass | Fail |
|---|---|---|
| `f1e0911`, before the hardening | 52 | 4 (playing-time ceiling 282; cone basis 6,351; cone status 6,351; opt-outs 58) |
| F2's branch, with the sweep updated for F2's rule that the season under way is under contract | 53 | 3 (F1's three) |
| Integration before F4, with F2's sweep (the supervisor's run) | 55 | 0 |
| After F4, served state (the prospect checks have no subjects: prospects are `unknown`) | 53 | 0 |
| After F4, as if the ratings fit were adopted (a diagnostic copy of the store, never served) | 55 | 0 |
| After F5, served state | 53 | 0 |
| After F6, served (the arrival model served through 3 seasons out; 12 new checks, 25,404 arrival chances) | 65 | 0 |

A league-wide valuation takes about 1.0 s served and 1.9 s as if adopted (1.5 s before F4).

**Browser checks (supervisor).** Before the fixes, on `f1e0911` with a fresh scratch `history.db` fitted at startup:
Carroll's cone bands nest and his coverage reads "80% target · 81% observed"; no horizontal overflow at desktop width;
S-01, S-02 and S-03 found, and D-10 confirmed on a prospect. After F2 (`8b2c337`): the focus trap, Escape order and
focus return (S-01), the responsive card and the cone's narrow layout (S-02), Soto's opt-out seasons (A-05, C-06) and
the "80% band (target)" legend were verified; S-04 to S-06 were found. S-05 and S-06 were fixed in `6c615f5` and verified in the browser on the integration branch, with Zac Gallen's cone
(one contract season, both bands) after F1's rolling-origin change.
